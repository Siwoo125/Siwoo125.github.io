/* SPDX-License-Identifier: GPL-2.0-only */
(() => {
  'use strict';
  const en=document.documentElement.lang==='en', $=id=>document.getElementById(id);
  const T=(ko,english)=>en?english:ko;
  let worker=null, serial=0, pending=null, original=null, state=null, memoryAddress, loading=true, saving=false, autoSave=true, history=[];
  const store=new DBGSessionStore(), saveStatus=$('cpu-save-status');
  const status=$('cpu-status'), notice=$('cpu-notice');
  function controls(busy=false) {
    busy=busy||loading||saving;
    $('cpu-save').disabled=busy||!original||!state;
    $('cpu-delete').disabled=busy;
    $('cpu-autosave').disabled=busy;
    const loaded=!!state && state.status!=='empty';
    for(const el of document.querySelectorAll('[data-cpu-action]'))el.disabled=busy||!loaded;
    $('cpu-step').disabled=busy||!loaded||['halted','exited','unsupported'].includes(state?.status);
    $('cpu-continue').disabled=$('cpu-step').disabled;
    $('cpu-reset').disabled=busy||!original;
    $('cpu-open').disabled=busy;
    for(const b of document.querySelectorAll('[data-example]'))b.disabled=busy;
  }
  function clearData() {
    for(const id of ['cpu-assembly','cpu-registers','cpu-register-name','cpu-breakpoints'])$(id).replaceChildren();
    for(const id of ['cpu-output','cpu-memory','cpu-file-info','cpu-runtime-notes','cpu-input-count'])$(id).textContent='';
  }
  function ensureWorker() {
    if(worker)return;
    worker=new Worker('/browser-worker.js');
    worker.onmessage=event=>{
      const reply=event.data;if(!pending||reply.id!==pending.id)return;
      clearTimeout(pending.timer);const p=pending;
      if(reply.ok){state=reply.state;render();p.resolve(reply);}else p.reject(Error(reply.error));
      pending=null;controls(true);
    };
    worker.onerror=()=>failWorker(T('브라우저 엔진을 불러오지 못했습니다. 페이지를 새로고침해주세요.','Could not load the browser engine. Reload the page.'));
  }
  function failWorker(message) {
    if(worker)worker.terminate();worker=null;state=null;clearData();
    if(pending){clearTimeout(pending.timer);pending.reject(Error(message));pending=null;}
    status.textContent=T('엔진 중단','Engine stopped');notice.textContent=message;controls();
  }
  function request(action,data={}) {
    if(loading&&!['load','restore','state'].includes(action))return Promise.reject(Error(T('파일을 여는 중입니다.','A file is being opened.')));
    if(pending)return Promise.reject(Error(T('이전 작업을 기다려주세요.','Wait for the current operation.')));
    ensureWorker();controls(true);status.textContent=T('처리 중','Working');
    return new Promise((resolve,reject)=>{
      const id=++serial;
      pending={id,resolve,reject,timer:setTimeout(()=>failWorker(T('실행 시간이 초과됐습니다. 파일을 다시 열어주세요.','Execution timed out. Open the file again.')),(['load','restore','checkpoint'].includes(action)||data.captureSession)?20000:3000)};
      worker.postMessage({id,action,data});
    });
  }
  async function act(action,data={}) {
    try {
      const reply=await request(action,{...data,memoryAddress,captureSession:autoSave});
      record(action);await persist(reply.checkpoint);
    }
    catch(e){notice.textContent=String(e.message||e);if(state)renderStatus();controls();}
  }
  function renderStatus() {
    const names={ready:T('정지','Stopped'),paused:T('정지','Stopped'),waiting:T('입력 대기','Waiting for input'),halted:T('HLT 정지','HLT'),exited:T('종료','Exited'),unsupported:T('지원 범위 밖에서 정지','Unsupported operation'),empty:T('파일 없음','No binary')};
    status.textContent=names[state.status]||state.status;
  }
  function reason(text) {
    if(en)return text;
    const translations={'Loaded at entry point.':'파일 진입점에서 정지했습니다.','Step complete.':'명령어 하나를 실행했습니다.','CPU halted (HLT).':'HLT 명령에서 CPU가 정지했습니다.','INT3 breakpoint.':'INT3 중단점에서 정지했습니다.','Waiting for input. Add input, then Continue.':'입력을 추가한 뒤 계속 실행을 누르세요.','Execution budget reached. Continue to run more.':'이번 실행 한도에 도달했습니다. 계속 실행으로 이어갈 수 있습니다.'};
    if(translations[text])return translations[text];
    if(text?.startsWith('Exit code '))return '종료 코드 '+text.slice(10);
    if(text?.startsWith('Address breakpoint '))return '주소 중단점 '+text.slice(19);
    if(text?.startsWith('Unsupported Linux syscall '))return '지원하지 않는 Linux 시스템 호출에서 정지했습니다. '+text;
    if(text?.startsWith('Execution stopped:'))return '명령 실행을 멈췄습니다. 라이브러리·API·메모리 지원 범위를 확인하세요. '+text;
    return text;
  }
  function render() {
    renderStatus();notice.textContent=reason(state.reason);
    $('cpu-file-info').textContent=`${state.format} · x${state.bits===64?'64':'86'} · entry ${state.entry} · ${state.instructions} ${T('명령 실행','instructions executed')}`;
    $('cpu-runtime-notes').textContent=(state.notes||[]).map(n=>en?n:({'ELF relocations are not applied.':'이 ELF의 재배치 정보는 적용하지 않습니다.','ELF interpreter and shared libraries are not loaded.':'이 ELF는 동적 로더를 요구합니다. 브라우저 모드는 해당 로더와 공유 라이브러리를 제공하지 않습니다.','Windows DLL imports are not resolved.':'이 PE가 요구하는 Windows DLL은 연결하지 않습니다.','Windows APIs, TLS callbacks and process services are not emulated.':'Windows API·TLS 콜백·프로세스 서비스는 제공하지 않습니다.'}[n]||n)).join(' ');
    const assembly=$('cpu-assembly');assembly.replaceChildren();
    for(const insn of state.assembly||[]) {
      const tr=document.createElement('tr');
      const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.textContent=insn.address;
      b.title=T('이 주소에 중단점 추가','Add a breakpoint here');b.addEventListener('click',()=>act('breakpoint-add',{address:insn.address}));td.append(b);tr.append(td);
      for(const text of [insn.bytes.map(b=>b.toString(16).padStart(2,'0')).join(' '),insn.mnemonic+' '+insn.operands]){const cell=document.createElement('td');cell.textContent=text;tr.append(cell);}
      assembly.append(tr);
    }
    const registers=$('cpu-registers');registers.replaceChildren();
    const selector=$('cpu-register-name'),selected=selector.value;selector.replaceChildren();
    for(const [name,value] of Object.entries(state.registers||{})) {
      const row=document.createElement('div'),label=document.createElement('strong'),text=document.createElement('code');label.textContent=name;text.textContent=value;row.append(label,text);registers.append(row);
      const option=document.createElement('option');option.value=name;option.textContent=name;selector.append(option);
    }
    if([...selector.options].some(o=>o.value===selected))selector.value=selected;
    const breaks=$('cpu-breakpoints');breaks.replaceChildren();
    for(const address of state.breakpoints||[]) {
      const button=document.createElement('button');button.type='button';button.textContent=address+' ×';button.addEventListener('click',()=>act('breakpoint-remove',{address}));breaks.append(button);
    }
    $('cpu-memory-address').value=state.memoryAddress;
    const lines=[];
    for(let i=0;i<(state.memory||[]).length;i+=16){const bytes=state.memory.slice(i,i+16);lines.push('0x'+(BigInt(state.memoryAddress)+BigInt(i)).toString(16)+'  '+bytes.map(b=>b.toString(16).padStart(2,'0')).join(' ')+'  '+bytes.map(b=>b>=32&&b<=126?String.fromCharCode(b):'.').join(''));}
    $('cpu-memory').textContent=state.memoryError||lines.join('\n');
    $('cpu-output').textContent=state.output||'';
    $('cpu-input-count').textContent=`${state.inputBytes} ${T('바이트 입력 대기열','bytes queued')}`;
  }
  async function load(bytes,name) {
    if(bytes.byteLength>32*1024*1024)throw Error(T('파일은 최대 32 MiB입니다.','Files are limited to 32 MiB.'));
    if(worker)worker.terminate();worker=null;pending=null;state=null;memoryAddress=undefined;original=null;
    clearData();$('cpu-filename').textContent=name;notice.textContent=T('브라우저 엔진을 준비하고 있습니다.','Preparing the browser engine.');
    try {const reply=await request('load',{bytes,captureSession:autoSave});original={bytes,name};history=[];record('load');await persist(reply.checkpoint);controls();}
    catch(e){notice.textContent=e.message;status.textContent=T('파일을 열 수 없음','Could not open file');controls();}
  }
  async function file(file) {
    if(!file)return;
    if(file.size>32*1024*1024){notice.textContent=T('파일은 최대 32 MiB입니다.','Files are limited to 32 MiB.');return;}
    if(loading||pending||saving)return;loading=true;controls(true);
    try {await load(await file.arrayBuffer(),file.name);}finally{loading=false;controls(!!pending);}
  }
  function bytesFromHex(value) {
    const clean=value.trim();if(!clean||!/^(?:[0-9a-f]{2})(?:\s*[0-9a-f]{2})*$/i.test(clean))throw Error(T('바이트를 HEX로 입력하세요. 예: 41 00 42 0a','Enter HEX bytes, for example 41 00 42 0a.'));
    return clean.replace(/\s/g,'').match(/../g).map(s=>parseInt(s,16));
  }
  $('cpu-open').addEventListener('click',()=>$('cpu-file').click());
  $('cpu-file').addEventListener('change',()=>file($('cpu-file').files[0]).catch(e=>{notice.textContent=e.message;}));
  const drop=$('cpu-drop');
  drop.addEventListener('dragover',event=>{event.preventDefault();});
  drop.addEventListener('drop',event=>{event.preventDefault();if(pending||loading||saving)return;if(event.dataTransfer.files.length!==1){notice.textContent=T('파일 하나만 넣어주세요.','Drop one file at a time.');return;}file(event.dataTransfer.files[0]).catch(e=>{notice.textContent=e.message;});});
  for(const b of document.querySelectorAll('[data-example]'))b.addEventListener('click',async()=>{
    if(pending||loading||saving)return;loading=true;
    try {controls(true);const response=await fetch('/browser-examples/'+b.dataset.example);if(!response.ok)throw Error('Example download failed.');await load(await response.arrayBuffer(),b.dataset.example);}
    catch(e){notice.textContent=e.message;}finally{loading=false;controls(!!pending);}
  });
  $('cpu-step').addEventListener('click',()=>act('step'));
  $('cpu-continue').addEventListener('click',()=>act('continue'));
  $('cpu-reset').addEventListener('click',async()=>{if(!original||pending||loading||saving)return;loading=true;controls();try{await load(original.bytes,original.name);}finally{loading=false;controls();}});
  $('cpu-break-form').addEventListener('submit',event=>{event.preventDefault();act('breakpoint-add',{address:$('cpu-break-address').value.trim()});});
  $('cpu-memory-form').addEventListener('submit',event=>{event.preventDefault();const candidate=$('cpu-memory-address').value.trim();if(!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(candidate)||BigInt(candidate)>BigInt(Number.MAX_SAFE_INTEGER)){notice.textContent=T('유효한 숫자 주소를 입력하세요.','Enter a valid numeric address.');return;}memoryAddress=candidate;act('state');});
  $('cpu-register-form').addEventListener('submit',event=>{event.preventDefault();const value=$('cpu-register-value').value.trim();if(!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)){notice.textContent=T('정수나 0x로 시작하는 값을 입력하세요.','Enter an integer or a value beginning with 0x.');return;}act('register-write',{name:$('cpu-register-name').value,value});});
  $('cpu-write-form').addEventListener('submit',event=>{event.preventDefault();try{act('memory-write',{address:$('cpu-write-address').value.trim(),bytes:bytesFromHex($('cpu-write-bytes').value)});}catch(e){notice.textContent=e.message;}});
  $('cpu-input-form').addEventListener('submit',event=>{event.preventDefault();try{const text=$('cpu-input').value;const bytes=$('cpu-input-mode').value==='hex'?bytesFromHex(text):Array.from(new TextEncoder().encode(text+($('cpu-newline').checked?'\n':'')));act('input',{bytes});}catch(e){notice.textContent=e.message;}});
  document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||pending)return;if(event.key==='F7'){event.preventDefault();if(!$('cpu-step').disabled)act('step');}else if(event.key==='F9'){event.preventDefault();if(!$('cpu-continue').disabled)act('continue');}});
  function record(action) {
    history.push({action,at:Date.now(),instructions:state.instructions,pc:state.registers[state.bits===64?'rip':'eip']});
    history=history.slice(-100);renderHistory();
  }
  function renderHistory() {
    const labels={load:T('파일 열기','Open file'),step:T('한 명령 실행','Step'),continue:T('계속 실행','Continue'),state:T('메모리 조회','Inspect memory'),'memory-write':T('메모리 수정','Write memory'),'register-write':T('레지스터 수정','Write register'),input:T('입력 추가','Queue input'),'breakpoint-add':T('중단점 추가','Add breakpoint'),'breakpoint-remove':T('중단점 삭제','Remove breakpoint')};
    $('cpu-history').replaceChildren();
    for(const item of [...history].reverse()) {const li=document.createElement('li');li.textContent=`${new Date(item.at).toLocaleTimeString(en?'en-US':'ko-KR')} · ${labels[item.action]||item.action} · ${item.pc} · ${item.instructions}`;$('cpu-history').append(li);}
  }
  function storageError(error) {saveStatus.textContent=T('저장 실패: 브라우저 저장소 권한이나 남은 공간을 확인하세요. 현재 실행은 계속 사용할 수 있습니다. ','Save failed: check browser storage permissions and free space. You can keep using the current session. ')+String(error.message||error);}
  function savedLabel(at) {saveStatus.textContent=T('이 기기에 저장됨 · ','Saved on this device · ')+new Date(at).toLocaleString(en?'en-US':'ko-KR');}
  async function persist(checkpoint) {
    if(!checkpoint||!original){controls();return;}
    saving=true;controls();saveStatus.textContent=T('저장 중…','Saving…');
    const at=Date.now();
    try {await store.save({version:1,at,name:original.name.slice(0,256),bytes:original.bytes,checkpoint,memoryAddress:state.memoryAddress,history});savedLabel(at);}
    catch(error){storageError(error);}finally{saving=false;controls(!!pending);}
  }
  $('cpu-save').addEventListener('click',async()=>{if(pending||loading||saving)return;try{const reply=await request('checkpoint',{memoryAddress});await persist(reply.checkpoint);}catch(error){storageError(error);}});
  $('cpu-delete').addEventListener('click',async()=>{
    if(pending||loading||saving)return;saving=true;controls();
    try{await store.clear();autoSave=false;$('cpu-autosave').checked=false;saveStatus.textContent=T('저장본을 삭제했습니다. 자동 저장은 꺼져 있습니다.','Saved session deleted. Auto-save is off.');}
    catch(error){storageError(error);}finally{saving=false;controls();}
  });
  $('cpu-autosave').addEventListener('change',async()=>{
    autoSave=$('cpu-autosave').checked;saving=true;controls();
    try{await store.preference(autoSave);saveStatus.textContent=autoSave?T('자동 저장 켜짐','Auto-save on'):T('자동 저장 꺼짐 · 기존 저장본은 유지됩니다.','Auto-save off · the previous save is kept.');}
    catch(error){storageError(error);}finally{saving=false;controls();}
    if(autoSave&&original){try{const reply=await request('checkpoint',{memoryAddress});await persist(reply.checkpoint);}catch(error){storageError(error);}}
  });
  async function start() {
    controls();
    try {
      const saved=await store.read();autoSave=saved.autoSave;$('cpu-autosave').checked=autoSave;
      const session=saved.session;
      if(session) {
        if(session.version!==1||!(session.bytes instanceof ArrayBuffer)||session.bytes.byteLength>32*1024*1024||typeof session.name!=='string'||session.name.length>256||!Number.isFinite(session.at))throw Error(T('저장본의 형식을 확인할 수 없습니다.','The saved session format is invalid.'));
        if(session.memoryAddress!==undefined&&!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(session.memoryAddress))throw Error('Invalid saved view.');
        saveStatus.textContent=T('이전 작업을 복원하는 중…','Restoring your previous session…');
        await request('restore',{bytes:session.bytes,checkpoint:session.checkpoint});
        original={bytes:session.bytes,name:session.name};$('cpu-filename').textContent=session.name;memoryAddress=session.memoryAddress;
        if(memoryAddress!==undefined)await request('state',{memoryAddress});
        history=Array.isArray(session.history)?session.history.slice(-100).filter(i=>i&&typeof i.action==='string'&&i.action.length<40&&Number.isFinite(i.at)&&Number.isSafeInteger(i.instructions)&&/^0x[0-9a-f]+$/i.test(i.pc)):[];
        renderHistory();savedLabel(session.at);notice.textContent=T('이전 작업을 복원했습니다. 실행 버튼을 누르면 이어서 실행합니다.','Previous session restored. Press Step or Continue to resume.');
      } else saveStatus.textContent=autoSave?T('자동 저장 켜짐 · 저장된 작업 없음','Auto-save on · no saved session'):T('자동 저장 꺼짐','Auto-save off');
    } catch(error){storageError(error);}
    finally{loading=false;controls();}
  }
  start();
})();
