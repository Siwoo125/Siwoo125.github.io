(function(root) {
  'use strict';
  root.DBGCTF = class {
    constructor(adapter) {
      this.adapter = adapter; this.latest = null;
      this.$ = id => document.getElementById(id);
      this.en = document.documentElement.lang === 'en';
      this.$('register-write-form').onsubmit = e => {
        e.preventDefault(); adapter.action('register-write', {name:this.$('register-write-name').value, value:this.$('register-write-value').value.trim()});
      };
      this.$('memory-write-form').onsubmit = e => {
        e.preventDefault(); adapter.action('memory-write', {address:this.$('memory-write-address').value.trim(), hex:this.$('memory-write-hex').value});
      };
      this.$('target-input-form').onsubmit = e => {
        e.preventDefault();
        const mode = this.$('target-input-mode').value;
        let value = this.$('target-input-value').value;
        if (mode === 'text' && this.$('target-input-newline').checked) value += '\n';
        adapter.action('input-send', {mode, value});
      };
      this.$('binary-string-filter').oninput = () => this.strings();
      this.$('symbol-address-form').onsubmit = async e => {
        e.preventDefault();
        const result=await adapter.action('symbol-address',{name:this.$('symbol-name').value.trim()});
        if(result?.address){this.$('symbol-result').textContent=result.address;this.$('memory-write-address').value=result.address;}
      };
    }
    text(ko,en) {return this.en ? en : ko;}
    node(tag,text) {const node=document.createElement(tag);node.textContent=text;return node;}
    strings() {
      const target=this.$('binary-strings');target.replaceChildren();
      const filter=this.$('binary-string-filter').value.toLowerCase();
      for(const item of this.latest?.binary?.strings||[]) {
        if(filter && !item.text.toLowerCase().includes(filter))continue;
        const row=this.node('div','');row.append(this.node('code',item.offset),this.node('span',item.text));target.append(row);
      }
    }
    update(data,busy,state) {
      if(data)this.latest=data;
      const stopped=state==='stopped'&&!busy;
      this.$('symbol-name').disabled=!stopped;
      this.$('symbol-address-form').querySelector('button').disabled=!stopped;
      for(const id of ['memory-write-address','memory-write-hex'])this.$(id).disabled=!stopped;
      this.$('memory-write-form').querySelector('button').disabled=!stopped;
      const frameZero=stopped && Number(this.latest?.selected_frame||0)===0;
      for(const id of ['register-write-name','register-write-value'])this.$(id).disabled=!frameZero;
      this.$('register-write-form').querySelector('button').disabled=!frameZero;
      const input=this.latest?.input;
      const canInput=!!input?.available && ['stopped','running'].includes(state)&&!busy;
      for(const id of ['target-input-mode','target-input-value','target-input-newline'])this.$(id).disabled=!canInput;
      this.$('target-input-form').querySelector('button').disabled=!canInput;
      if(!data)return;
      this.$('target-output').textContent=input?.output||'';
      this.$('target-input-status').textContent=(input?.mode==='console'
        ? this.text('Windows: 실행 시 열리는 대상 콘솔 창에서 입력하세요. 출력도 해당 창에 표시됩니다.','Windows: type in the target console opened when running. Output appears in that window.')
        : input?.mode==='pty' && input.available
          ? this.text('Linux/POSIX PTY · UTF-8 또는 HEX · 최대 4096바이트. 전체 터미널 에뮬레이터는 아닙니다.','Linux/POSIX PTY · UTF-8 or HEX · up to 4096 bytes. This is not a full terminal emulator.')
          : this.text('대상을 직접 실행한 로컬 엔진이 필요합니다. Attach 대상에는 입력을 보내지 않습니다.','Requires a locally launched target. Input is unavailable for attached processes.'))+(input?.error?' '+input.error:'');
      const select=this.$('register-write-name');
      if(document.activeElement!==select) {
        const selected=select.value;select.replaceChildren();
        for(const register of data.registers||[]) {
          if(!/^(?:[re]?(?:ax|bx|cx|dx|si|di|sp|bp|ip)|r(?:[0-9]|1[0-5])(?:d|w|b)?|[xw][0-9]+|pc|sp|[re]?flags|cpsr)$/.test(register.name))continue;
          const option=this.node('option',register.name+' = '+register.value);option.value=register.name;select.append(option);
        }
        if(Array.from(select.options||select.children).some(option=>option.value===selected))select.value=selected;
      }
      const binary=data.binary;
      this.$('binary-info').textContent=binary?.format ? [binary.format,binary.machine,binary.bits?binary.bits+' bit':'',binary.entry?'entry '+binary.entry:'',binary.image_type,binary.nx===undefined||binary.nx===null?'':('NX header: '+binary.nx),binary.aslr===undefined?'':('ASLR header: '+binary.aslr),binary.header_error].filter(Boolean).join(' · '):this.text('파일을 열면 ELF/PE 헤더와 문자열을 표시합니다.','Open a file to inspect ELF/PE headers and strings.');
      this.$('binary-string-status').textContent=binary?.size ? this.text('파일 오프셋 기준 · 최대 앞 16 MiB / 200개 / 문자열당 256자. 헤더 주소는 ASLR 적용 전 값입니다.','File offsets · first 16 MiB, up to 200 strings, 256 characters each. Header addresses are before ASLR.') : '';
      this.strings();
    }
  };
})(window);
