(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const basename = value => String(value || '').split(/[\\/]/).pop();
  const addressPattern = /^(?:0x[0-9a-f]+|\d+|\$(?:sp|pc|rsp|esp|rbp|ebp))$/i;
  const clipped = (value, n) => String(value ?? '').slice(0, n);

  function capture(data, address, now = new Date().toISOString()) {
    if (data.state !== 'stopped') throw Error('A stopped target is required.');
    const result = {
      at: now, state: data.state, target_id: data.target_id, stop_sequence: data.stop_sequence,
      path: clipped(data.path, 4096), engine: basename(data.engine), memoryAddress: address,
      stop: clone(data.stop || {}), errors: clone(data.errors || {}),
      current_thread: clipped(data.current_thread,32), selected_frame:data.selected_frame??0, frame:clone(data.frame||{}),
    };
    for (const [key, limit] of Object.entries({registers:1024, assembly:512, stack:32, breakpoints:128, memory:4})) {
      result[key] = clone((Array.isArray(data[key]) ? data[key] : []).slice(0, limit));
    }
    result.events = (data.events || []).slice(-50).map(text => clipped(text, 2000));
    return result;
  }
  function normalize(value) {
    if (typeof value === 'string' && /^(?:0x[0-9a-f]+|-?\d+)$/i.test(value)) {
      try { return BigInt(value).toString(); } catch (_) { /* Preserve noninteger formats. */ }
    }
    return value;
  }
  function memoryBytes(blocks) {
    const map = new Map();
    for (const block of blocks || []) {
      if (!/^0x[0-9a-f]+$/i.test(block.begin) || !/^(?:[0-9a-f]{2})+$/i.test(block.contents)) continue;
      const bytes = block.contents.slice(0, 8192).match(/../g);
      bytes.forEach((byte, i) => map.set(BigInt(block.begin) + BigInt(i), byte.toLowerCase()));
    }
    return map;
  }
  function compare(a, b) {
    const ar = new Map((a.registers || []).map(r => [r.name, r.value]));
    const br = new Map((b.registers || []).map(r => [r.name, r.value]));
    const registers = [];
    for (const name of new Set([...ar.keys(), ...br.keys()])) {
      if (normalize(ar.get(name)) !== normalize(br.get(name))) registers.push({name, before:ar.get(name) ?? null, after:br.get(name) ?? null});
    }
    const am = memoryBytes(a.memory), bm = memoryBytes(b.memory), memory = [];
    const addresses = [...new Set([...am.keys(), ...bm.keys()])].sort((x,y)=>x<y?-1:x>y?1:0);
    for (const address of addresses) {
      if (am.get(address) !== bm.get(address)) memory.push({address:'0x'+address.toString(16), before:am.get(address) ?? null, after:bm.get(address) ?? null});
    }
    return {registers, memory, memoryAvailable:am.size>0&&bm.size>0,
      differentTarget:a.target_id!==b.target_id||a.path!==b.path,
      differentContext:a.current_thread!==b.current_thread||a.selected_frame!==b.selected_frame,
      differentRange:a.memoryAddress!==b.memoryAddress};
  }
  function workspace(data, context) {
    if ((data?.breakpoints||[]).some(item=>{const b=item.bkpt||item;return b.cond||Number(b.ignore)>0||b.disp==='del'||b.enabled==='n'||(b.type&&b.type!=='breakpoint');})) {
      throw Error('Workspace v1 supports only enabled, unconditional breakpoints. Advanced breakpoint settings would be lost.');
    }
    const locations=(data?.breakpoints||[]).map(item=>item.bkpt||item).map(b=>b['original-location']||b.func||(b.addr&&b.addr.startsWith('0x')?'*'+b.addr:null)).filter(Boolean);
    return validateWorkspace({type:'dbgdesk-workspace',version:1,path:context.path||data?.path||'',args:context.args,
      memoryAddress:context.memoryAddress,breakpoints:[...new Set(locations)]});
  }
  function validateWorkspace(value) {
    if (!value || value.type!=='dbgdesk-workspace'||value.version!==1) throw Error('Unsupported workspace format.');
    if (typeof value.path!=='string'||value.path.length>4096||/[\x00-\x1f]/.test(value.path)) throw Error('Invalid executable path.');
    if (!Array.isArray(value.args)||value.args.length>64||value.args.some(a=>typeof a!=='string'||a.length>4096||a.includes('\0'))) throw Error('Invalid argument list.');
    if (typeof value.memoryAddress!=='string'||!addressPattern.test(value.memoryAddress)) throw Error('Invalid memory address.');
    if (!Array.isArray(value.breakpoints)||value.breakpoints.length>128||value.breakpoints.some(s=>typeof s!=='string'||!s.trim()||s.length>300||/[\x00-\x1f]/.test(s))) throw Error('Invalid breakpoint list.');
    return {type:'dbgdesk-workspace',version:1,path:value.path,args:[...value.args],memoryAddress:value.memoryAddress,
      breakpoints:[...new Set(value.breakpoints.map(s=>s.trim()))]};
  }
  function codeBlock(text) {
    const runs = String(text).match(/`+/g)||[];
    const fence = '`'.repeat(Math.max(3,...runs.map(run=>run.length+1)));
    return fence+'\n'+text+'\n'+fence;
  }
  function report(snapshot, options = {}) {
    const ko=options.language==='ko';
    const labels={'Captured':'기록 시각','Target':'대상','Engine':'엔진','Reason':'정지 원인','Signal':'신호','Memory query':'메모리 조회',
      'Registers':'레지스터','Disassembly':'디스어셈블리','Call stack':'호출 스택','Memory bytes':'메모리 바이트','Debugger output':'디버거 출력','Inspection errors':'조회 오류'};
    const L=text=>ko?(labels[text]||text):text;
    const metadata = [L('Captured')+': '+snapshot.at,L('Target')+': '+(basename(snapshot.path)||'(attached process)'),
      L('Engine')+': '+snapshot.engine, L('Reason')+': '+(snapshot.stop.reason||''), L('Signal')+': '+(snapshot.stop['signal-name']||''),
      'PC: '+(snapshot.frame?.addr||snapshot.stop.frame?.addr||''),
      'Thread: '+(snapshot.current_thread||'?')+' / Frame: '+(snapshot.selected_frame??0), L('Memory query')+': '+snapshot.memoryAddress];
    const sections = [ko?'# DBG Desk — 정지 상태 보고서':'# DBG Desk — stopped-state report', codeBlock(metadata.join('\n')),
      '## '+L('Registers'),codeBlock(snapshot.registers.map(r=>r.name+' = '+r.value).join('\n')||'(unavailable)'),
      '## '+L('Disassembly'),codeBlock(snapshot.assembly.map(a=>a.address+'  '+(a.opcodes||'')+'  '+a.inst).join('\n')||'(unavailable)'),
      '## '+L('Call stack'),codeBlock(snapshot.stack.map(item=>{const f=item.frame||item;return '#'+f.level+' '+(f.func||'??')+' '+f.addr+(f.file?' '+basename(f.file)+':'+f.line:'');}).join('\n')||'(unavailable)')];
    if (options.memory) sections.push('## '+L('Memory bytes'),codeBlock(snapshot.memory.map(b=>b.begin+' '+b.contents).join('\n')||'(unavailable)'));
    if (options.logs) sections.push('## '+L('Debugger output'),codeBlock(snapshot.events.join('\n')||'(empty)'));
    if (Object.keys(snapshot.errors).length) sections.push('## '+L('Inspection errors'),codeBlock(JSON.stringify(snapshot.errors,null,2)));
    sections.push((ko?'저장된 관찰 기록이며 실행을 되돌리거나 재현하지 않습니다. 실행 파일 경로와 인수 필드는 제외했지만 다른 조회 값에도 민감한 정보가 있을 수 있습니다. 공유 전에 내용을 확인하세요.':'This is a recorded observation. It does not rewind or reproduce execution.\nThe executable-path and command-line-argument fields are omitted. Other inspected values may contain sensitive data. Review all contents before sharing.'));
    return sections.join('\n\n')+'\n';
  }
  function findMemory(blocks, query, mode='hex') {
    let pattern;
    if (mode === 'text') {
      if (!query || query.length > 256) throw Error('Enter 1–256 characters.');
      pattern = [...new TextEncoder().encode(query)];
    } else {
      const compact = query.replace(/\s/g, '');
      if (!/^(?:[0-9a-fA-F]{2}|\?\?){1,256}$/.test(compact)) throw Error('Use byte pairs such as 48 8B ?? FF (up to 256 bytes).');
      pattern = compact.match(/../g).map(b => b === '??' ? null : parseInt(b,16));
    }
    const bytes = memoryBytes(blocks), results = [];
    for (const address of bytes.keys()) {
      if (pattern.every((byte,i) => {
        const actual = bytes.get(address+BigInt(i));
        return actual !== undefined && (byte === null || parseInt(actual,16) === byte);
      })) results.push('0x'+address.toString(16));
    }
    return results.sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
  }
  function interpretMemory(blocks, address, littleEndian=true) {
    const start = BigInt(address), bytes = memoryBytes(blocks), data = [];
    for(let i=0;i<8;i++) {
      const byte=bytes.get(start+BigInt(i)); if(byte===undefined)break;
      data.push(parseInt(byte,16));
    }
    const view=new DataView(Uint8Array.from(data).buffer), result={};
    for(const size of [1,2,4,8]) {
      if(data.length<size)continue;
      let unsigned=0n;
      for(let i=0;i<size;i++)unsigned=(unsigned<<8n)|BigInt(data[littleEndian?size-1-i:i]);
      result['uint'+size*8]=unsigned.toString();
      result['int'+size*8]=(unsigned>=(1n<<BigInt(size*8-1))?unsigned-(1n<<BigInt(size*8)):unsigned).toString();
    }
    if(data.length>=4)result.float32=String(view.getFloat32(0,littleEndian));
    if(data.length>=8)result.float64=String(view.getFloat64(0,littleEndian));
    return result;
  }
  const api={capture,compare,workspace,validateWorkspace,report,memoryBytes,basename,findMemory,interpretMemory};
  if (typeof module==='object'&&module.exports) module.exports=api;
  else root.DBGInspector=api;
})(typeof window!=='undefined'?window:globalThis);
