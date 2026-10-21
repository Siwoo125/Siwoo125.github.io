/* SPDX-License-Identifier: GPL-2.0-only
 * DBG Desk browser CPU engine. See vendor/NOTICE.txt for third-party sources.
 */
(function (root) {
  'use strict';
  const MAX_FILE = 32 * 1024 * 1024, MAX_MEMORY = 64 * 1024 * 1024;
  const PAGE = 4096, STACK = 0x7fc00000, STACK_SIZE = 2 * 1024 * 1024;
  const hex = n => '0x' + BigInt(n).toString(16);
  function address(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value.trim())) throw Error('Use a numeric address.');
    const n = Number(BigInt(value.trim()));
    if (!Number.isSafeInteger(n) || n < 0) throw Error('Address is outside the supported range.');
    return n;
  }
  function parseBinary(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 64 || bytes.length > MAX_FILE) throw Error('Choose an ELF or PE file between 64 bytes and 32 MiB.');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function span(offset, size) {
      if (![offset, size].every(Number.isSafeInteger) || offset < 0 || size < 0 || offset + size > bytes.length) throw Error('The file contains a truncated or invalid range.');
    }
    function u64(offset) { span(offset,8); const n=Number(v.getBigUint64(offset,true)); if (!Number.isSafeInteger(n)) throw Error('Address exceeds the supported range.'); return n; }
    let format, bits, entry, segments=[], notes=[];
    if (v.getUint32(0,false) === 0x7f454c46) {
      if (bytes[5] !== 1 || ![1,2].includes(bytes[4])) throw Error('Only little-endian x86/x64 ELF is supported.');
      bits=bytes[4]===1?32:64; format='ELF';
      const type=v.getUint16(16,true), machine=v.getUint16(18,true);
      if (![2,3].includes(type) || machine !== (bits===32?3:62)) throw Error('Only executable x86/x64 ELF files are supported.');
      const bias=type===3?0x400000:0;
      if(type===3)notes.push('ELF relocations are not applied.');
      entry=(bits===32?v.getUint32(24,true):u64(24))+bias;
      const offset=bits===32?v.getUint32(28,true):u64(32);
      const size=v.getUint16(bits===32?42:54,true), count=v.getUint16(bits===32?44:56,true);
      if (size<(bits===32?32:56) || count>512) throw Error('Invalid ELF program headers.');
      span(offset,size*count);
      for (let i=0;i<count;i++) {
        const p=offset+i*size, kind=v.getUint32(p,true);
        if (kind===3) notes.push('ELF interpreter and shared libraries are not loaded.');
        if (kind!==1) continue;
        const file=bits===32?v.getUint32(p+4,true):u64(p+8);
        const start=(bits===32?v.getUint32(p+8,true):u64(p+16))+bias;
        const fileSize=bits===32?v.getUint32(p+16,true):u64(p+32);
        const memorySize=bits===32?v.getUint32(p+20,true):u64(p+40);
        const flags=v.getUint32(p+(bits===32?24:4),true);
        span(file,fileSize);
        if (fileSize>memorySize) throw Error('ELF data exceeds its memory segment.');
        segments.push({start,size:memorySize,data:bytes.slice(file,file+fileSize),executable:!!(flags&1)});
      }
    } else if (bytes[0]===0x4d && bytes[1]===0x5a) {
      const pe=v.getUint32(60,true); span(pe,24);
      if (v.getUint32(pe,true)!==0x4550) throw Error('Invalid PE signature.');
      const machine=v.getUint16(pe+4,true), count=v.getUint16(pe+6,true), optionalSize=v.getUint16(pe+20,true), opt=pe+24;
      span(opt,optionalSize); const magic=v.getUint16(opt,true);
      bits=magic===0x10b?32:magic===0x20b?64:0; format='PE';
      if (!bits || machine!==(bits===32?0x14c:0x8664) || optionalSize<(bits===32?96:112) || count>96) throw Error('Only x86/x64 PE images are supported.');
      const base=bits===32?v.getUint32(opt+28,true):u64(opt+24);
      const imageSize=v.getUint32(opt+56,true), headers=v.getUint32(opt+60,true);
      if (!imageSize || imageSize>MAX_MEMORY || headers>imageSize) throw Error('PE image is too large or invalid.');
      span(0,headers); entry=base+v.getUint32(opt+16,true);
      const data=new Uint8Array(imageSize); data.set(bytes.subarray(0,headers));
      span(opt+optionalSize,count*40);
      let executableEntry=false;
      for (let i=0;i<count;i++) {
        const p=opt+optionalSize+i*40, rva=v.getUint32(p+12,true), raw=v.getUint32(p+16,true), file=v.getUint32(p+20,true), virtual=v.getUint32(p+8,true);
        if (rva+Math.max(raw,virtual)>imageSize) throw Error('PE section exceeds the image.');
        span(file,raw); data.set(bytes.subarray(file,file+raw),rva);
        if ((v.getUint32(p+36,true)&0x20000000) && entry>=base+rva && entry<base+rva+Math.max(raw,virtual)) executableEntry=true;
      }
      segments.push({start:base,size:imageSize,data,executable:executableEntry});
      const directories=bits===32?96:112;
      if (optionalSize>=directories+16 && v.getUint32(opt+directories+8,true)) notes.push('Windows DLL imports are not resolved.');
      notes.push('Windows APIs, TLS callbacks and process services are not emulated.');
    } else throw Error('Choose an ELF or PE executable.');
    if (!segments.length || segments.length>512) throw Error('No loadable code segments.');
    let total=0;
    for (const s of segments) {
      if (!Number.isSafeInteger(s.start+s.size) || s.start<PAGE || s.size<0 || s.size>MAX_MEMORY || (bits===32 && s.start+s.size>0x100000000)) throw Error('Invalid memory range.');
      total+=s.size;
      if (total>MAX_MEMORY) throw Error('Loadable memory exceeds 64 MiB.');
      if (s.start<STACK+STACK_SIZE && s.start+s.size>STACK) throw Error('The image overlaps the browser stack.');
    }
    if (!segments.some(s=>s.executable && entry>=s.start && entry<s.start+s.size)) throw Error('Entry point is outside executable memory.');
    return {format,bits,entry,segments,notes};
  }
  class BrowserEngine {
    constructor(uc,cs) { this.uc=uc; this.cs=cs; this.breakpoints=new Set(); this.output=''; this.input=[]; this.status='empty'; }
    close() { if(this.cpu)this.cpu.close(); if(this.decoder)this.decoder.close(); this.cpu=null;this.decoder=null; }
    load(bytes) {
      const image=parseBinary(bytes); this.close(); this.image=image; this.output='';this.input=[];this.breakpoints.clear();this.instructions=0;
      const u=this.uc; this.cpu=new u.Unicorn(u.ARCH_X86,image.bits===32?u.MODE_32:u.MODE_64);
      this.decoder=new this.cs.Capstone(this.cs.ARCH_X86,image.bits===32?this.cs.MODE_32:this.cs.MODE_64);
      try {
        const ranges=image.segments.filter(s=>s.size).map(s=>[Math.floor(s.start/PAGE)*PAGE,Math.ceil((s.start+s.size)/PAGE)*PAGE]).sort((a,b)=>a[0]-b[0]);
        this.ranges=[];
        for (const range of ranges) { const last=this.ranges.at(-1); if(last && range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else this.ranges.push(range); }
        if (this.ranges.reduce((n,r)=>n+r[1]-r[0],0)>MAX_MEMORY) throw Error('Mapped image exceeds 64 MiB.');
        this.ranges.push([STACK,STACK+STACK_SIZE]);
        const zeros=new Uint8Array(1024*1024);
        for (const [start,end] of this.ranges) {
          this.cpu.mem_map(start,end-start,u.PROT_ALL);
          for(let at=start;at<end;at+=zeros.length)this.cpu.mem_write(at,zeros.subarray(0,Math.min(zeros.length,end-at)));
        }
        for (const s of image.segments)if(s.data.length)this.cpu.mem_write(s.start,s.data);
        this.names=image.bits===32?['eax','ebx','ecx','edx','esi','edi','ebp','esp','eip','eflags']:['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15','rip','eflags'];
        this.pcName=image.bits===32?'eip':'rip'; this.spName=image.bits===32?'esp':'rsp';
        const sp=STACK+STACK_SIZE-512;
        this.setRegister(this.spName,BigInt(sp)); this.setRegister(this.pcName,BigInt(image.entry));
        if(image.format==='ELF') {
          const width=image.bits/8, stack=new Uint8Array(8*width), view=new DataView(stack.buffer);
          [1,sp+128,0,0,6,PAGE,0,0].forEach((value,i)=>{if(width===8)view.setBigUint64(i*width,BigInt(value),true);else view.setUint32(i*width,value,true);});
          this.cpu.mem_write(sp,stack); this.cpu.mem_write(sp+128,new TextEncoder().encode('binary\0'));
        }
        this.status='ready';this.reason='Loaded at entry point.';
        return this.snapshot();
      } catch(error) {this.close();this.status='empty';throw error;}
    }
    registerId(name) {if(!this.names.includes(name))throw Error('Unknown register.');return this.uc['X86_REG_'+name.toUpperCase()];}
    getRegister(name) {const id=this.registerId(name);return this.image.bits===64 && name!=='eflags'?this.cpu.reg_read_i64(id):BigInt(this.cpu.reg_read_i32(id)>>>0);}
    setRegister(name,value) {
      const bits=name==='eflags'?32:this.image.bits;value=BigInt(value);
      if(value<0n || value>=(1n<<BigInt(bits)))throw Error('Register value is outside its unsigned range.');
      const id=this.registerId(name);
      if(bits===64)this.cpu.reg_write_i64(id,value);else this.cpu.reg_write_i32(id,Number(value)|0);
    }
    read(start,count) {const r=this.ranges.find(r=>start>=r[0] && start<r[1]);if(!r)throw Error('Address is not mapped.');return Array.from(this.cpu.mem_read(start,Math.min(count,r[1]-start)));}
    memoryWrite(start,bytes) {
      start=address(start);
      if(!bytes.length||bytes.length>256||bytes.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('Write 1–256 HEX bytes.');
      if(!this.ranges.some(r=>start>=r[0]&&start+bytes.length<=r[1]))throw Error('Write is outside mapped memory.');
      const pageStart=Math.floor(start/PAGE)*PAGE, end=Math.ceil((start+bytes.length)/PAGE)*PAGE;
      const pages=this.cpu.mem_read(pageStart,end-pageStart);
      pages.set(bytes,start-pageStart);
      // This binding does not export uc_ctl_remove_cache. Re-map the affected
      // pages to discard translated instructions, retaining all surrounding bytes.
      this.cpu.mem_unmap(pageStart,end-pageStart);
      this.cpu.mem_map(pageStart,end-pageStart,this.uc.PROT_ALL);
      this.cpu.mem_write(pageStart,pages);
    }
    feed(bytes) {if(bytes.length>65536 || this.input.length+bytes.length>65536 || bytes.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('Input is limited to 64 KiB.');this.input.push(...bytes);if(this.status==='waiting')this.status='ready';}
    syscall(pc,size) {
      const x64=this.image.bits===64;
      const number=Number(this.getRegister(x64?'rax':'eax'));
      const args=(x64?['rdi','rsi','rdx']:['ebx','ecx','edx']).map(n=>Number(this.getRegister(n)));
      const [fd,buffer,count]=args;
      let result=0;
      if(number===(x64?60:1)||number===(x64?231:252)) {this.status='exited';this.reason='Exit code '+fd;}
      else if(number===(x64?1:4) && [1,2].includes(fd)) {
        if(count>65536 || !Number.isSafeInteger(count))throw Error('Write exceeds 64 KiB.');
        const bytes=this.read(buffer,count);if(bytes.length!==count)throw Error('Write reads outside mapped memory.');
        this.output=(this.output+new TextDecoder().decode(new Uint8Array(bytes))).slice(-65536);result=count;
      } else if(number===(x64?0:3) && fd===0) {
        if(count>65536 || !Number.isSafeInteger(count))throw Error('Read exceeds 64 KiB.');
        if(count && !this.input.length){this.status='waiting';this.reason='Waiting for input. Add input, then Continue.';return false;}
        const available=this.input.slice(0,count);
        if(available.length && !this.ranges.some(r=>buffer>=r[0]&&buffer+available.length<=r[1]))throw Error('Read writes outside mapped memory.');
        if(available.length)this.cpu.mem_write(buffer,available);
        this.input.splice(0,available.length);result=available.length;
      } else {this.status='unsupported';this.reason='Unsupported Linux syscall '+number+'. This browser mode does not provide a full operating system.';return false;}
      this.setRegister(x64?'rax':'eax',BigInt(result));
      if(x64){this.setRegister('rcx',BigInt(pc+size));this.setRegister('r11',this.getRegister('eflags'));}
      this.setRegister(this.pcName,BigInt(pc+size));return true;
    }
    stepOne() {
      const pc=Number(this.getRegister(this.pcName)), b=this.read(pc,2);
      if ((this.image.bits===64&&b[0]===0x0f&&b[1]===5)||(this.image.bits===32&&b[0]===0xcd&&b[1]===0x80)) {
        if(this.image.format!=='ELF'){this.status='unsupported';this.reason='System calls are supported only for the limited Linux ELF interface.';return false;}
        if(!this.syscall(pc,2))return false;
      } else if(b[0]===0xcc) {this.setRegister(this.pcName,BigInt(pc+1));this.status='paused';this.reason='INT3 breakpoint.';}
      else {
        this.cpu.emu_start(pc,0,0,1);
        if(b[0]===0xf4){this.status='halted';this.reason='CPU halted (HLT).';}
      }
      this.instructions++;return true;
    }
    run(count) {
      if(!this.cpu || ['exited','halted','unsupported'].includes(this.status))throw Error('Reload the file to start again.');
      this.status='ready';this.reason='Step complete.';const began=Date.now();
      try {
        for(let i=0;i<count;i++) {
          const pc=Number(this.getRegister(this.pcName));
          if(i && this.breakpoints.has(pc)){this.status='paused';this.reason='Address breakpoint '+hex(pc);break;}
          if(!this.stepOne() || this.status!=='ready')break;
          if(i===count-1 || Date.now()-began>150){if(count>1)this.reason='Execution budget reached. Continue to run more.';break;}
        }
      } catch(error){this.status='paused';this.reason='Execution stopped: '+String(error.message||error)+'. A required library, API or memory region may be unavailable.';}
      return this.snapshot();
    }
    extraRegisterNames() {
      return ['CR0','CR2','CR3','CR4',...(this.image.bits===64?['CR8']:[]),'GDTR','IDTR','LDTR','TR','CS','DS','ES','FS','GS','SS','FS_BASE',...(this.image.bits===64?['GS_BASE']:[]),
        'DR0','DR1','DR2','DR3','DR6','DR7','FPCW','FPSW','FPTAG','FIP','FCS','FDP','FDS','FOP','MXCSR',
        ...Array.from({length:8},(_,i)=>'FP'+i),
        ...(this.image.bits===64?['XMM','YMM','ZMM']:['XMM','YMM']).flatMap(prefix=>Array.from({length:this.image.bits===64?32:8},(_,i)=>prefix+i))];
    }
    rawRegister(name, data) {
      // Public register APIs re-create CPU state without serializing WASM pointers.
      const u=this.uc, id=u['X86_REG_'+name];
      if(id===undefined)throw Error('Unsupported register.');
      const ptr=u._malloc(64);
      try {
        for(let i=0;i<64;i++)u.setValue(ptr+i,data?data[i]:0,'i8');
        const result=u.ccall(data?'uc_reg_write':'uc_reg_read','number',['number','number','number'],[u.getValue(this.cpu.handle_ptr,'*'),id,ptr]);
        if(result!==u.ERR_OK)throw Error('Register '+name+' is unavailable.');
        return data?undefined:Uint8Array.from({length:64},(_,i)=>u.getValue(ptr+i,'i8')&255);
      } finally {u._free(ptr);}
    }
    checkpoint() {
      if(!this.cpu)throw Error('Open a binary first.');
      const pages=[];
      for(const [start,end] of this.ranges) {
        for(let offset=start;offset<end;offset+=1024*1024) {
          const block=this.cpu.mem_read(offset,Math.min(1024*1024,end-offset));
          for(let i=0;i<block.length;i+=PAGE) {
            const page=block.subarray(i,i+PAGE);
            if(page.some(value=>value!==0))pages.push({start:offset+i,data:page.slice()});
          }
        }
      }
      const extra=[];
      for(const name of this.extraRegisterNames()) {
        try {extra.push({name,data:this.rawRegister(name)});}catch(_){}
      }
      return {version:1,engine:'unicorn-x86-2.1.4',format:this.image.format,bits:this.image.bits,entry:this.image.entry,
        registers:Object.fromEntries(this.names.map(name=>[name,hex(this.getRegister(name))])),extra,pages,
        status:this.status,reason:this.reason,instructions:this.instructions,breakpoints:[...this.breakpoints],
        output:this.output,input:new Uint8Array(this.input)};
    }
    restore(bytes, saved) {
      const candidate=new BrowserEngine(this.uc,this.cs);
      try {
        candidate.load(bytes);
        candidate.applyCheckpoint(saved);
      } catch(error) {candidate.close();throw error;}
      this.close();Object.assign(this,candidate);
      return this.snapshot();
    }
    applyCheckpoint(saved) {
      if(!saved || saved.version!==1 || saved.engine!=='unicorn-x86-2.1.4' || saved.format!==this.image.format || saved.bits!==this.image.bits || saved.entry!==this.image.entry)throw Error('The saved session is incompatible with this engine or file.');
      if(!['ready','paused','waiting','halted','exited','unsupported'].includes(saved.status) || typeof saved.reason!=='string' || saved.reason.length>4096 || !Number.isSafeInteger(saved.instructions) || saved.instructions<0)throw Error('Invalid saved execution state.');
      if(typeof saved.output!=='string' || saved.output.length>65536 || !(saved.input instanceof Uint8Array) || saved.input.length>65536)throw Error('Invalid saved input/output.');
      if(!Array.isArray(saved.breakpoints) || saved.breakpoints.length>128 || saved.breakpoints.some(value=>address(value)!==value))throw Error('Invalid saved breakpoints.');
      if(!saved.registers || Object.keys(saved.registers).length!==this.names.length || this.names.some(name=>typeof saved.registers[name]!=='string' || !/^0x[0-9a-f]{1,16}$/i.test(saved.registers[name])))throw Error('Invalid saved registers.');
      const maxPages=this.ranges.reduce((n,r)=>n+(r[1]-r[0])/PAGE,0), seen=new Set();
      if(!Array.isArray(saved.pages) || saved.pages.length>maxPages)throw Error('Invalid saved memory.');
      for(const page of saved.pages) {
        if(!page || !Number.isSafeInteger(page.start) || page.start%PAGE || !(page.data instanceof Uint8Array) || page.data.length!==PAGE || seen.has(page.start) || !this.ranges.some(r=>page.start>=r[0]&&page.start+PAGE<=r[1]))throw Error('Invalid saved memory page.');
        seen.add(page.start);
      }
      const allowed=new Set(this.extraRegisterNames()), names=new Set();
      if(!Array.isArray(saved.extra) || saved.extra.length>allowed.size)throw Error('Invalid saved CPU context.');
      for(const reg of saved.extra) {
        if(!reg || !allowed.has(reg.name) || names.has(reg.name) || !(reg.data instanceof Uint8Array) || reg.data.length!==64)throw Error('Invalid saved CPU register.');
        names.add(reg.name);
      }
      // Clear every mapped page so a page that was deliberately zeroed stays zero.
      const zeros=new Uint8Array(1024*1024);
      for(const [start,end] of this.ranges)for(let at=start;at<end;at+=zeros.length)this.cpu.mem_write(at,zeros.subarray(0,Math.min(zeros.length,end-at)));
      for(const page of saved.pages)this.cpu.mem_write(page.start,page.data);
      for(const reg of saved.extra) {
        const current=this.rawRegister(reg.name);
        if(reg.data.some((byte,i)=>byte!==current[i]))this.rawRegister(reg.name,reg.data);
      }
      for(const name of this.names)this.setRegister(name,saved.registers[name]);
      this.status=saved.status;this.reason=saved.reason;this.instructions=saved.instructions;
      this.breakpoints=new Set(saved.breakpoints);this.output=saved.output;this.input=Array.from(saved.input);
    }
    snapshot(memoryAddress) {
      if(!this.cpu)return {status:'empty'};
      const registers=Object.fromEntries(this.names.map(name=>[name,hex(this.getRegister(name))]));
      const pc=Number(this.getRegister(this.pcName));let assembly=[],memory=[],memoryError='';
      try {assembly=this.decoder.disasm(this.read(pc,160),pc).slice(0,24).map(i=>({address:hex(i.address),bytes:Array.from(i.bytes||[]),mnemonic:i.mnemonic,operands:i.op_str,size:i.size}));}catch(_){}
      const start=memoryAddress===undefined?Number(this.getRegister(this.spName)):address(memoryAddress);
      try {memory=this.read(start,128);}catch(e){memoryError=e.message;}
      return {status:this.status,reason:this.reason,format:this.image.format,bits:this.image.bits,entry:hex(this.image.entry),notes:this.image.notes,registers,assembly,memoryAddress:hex(start),memory,memoryError,output:this.output,instructions:this.instructions,breakpoints:[...this.breakpoints].map(hex),inputBytes:this.input.length};
    }
  }
  const api={BrowserEngine,parseBinary,address,MAX_FILE};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.DBGCPU=api;
})(typeof self!=='undefined'?self:globalThis);
