'use strict';
const $ = id => document.getElementById(id);
const isEnglish = document.documentElement?.lang === 'en';
const publicHosting = document.documentElement?.dataset?.hosting === 'public';
const messages = window.DBG_I18N || {};
const T = text => isEnglish && typeof text === 'string' ? (messages[text] || text) : text;
const supplied = publicHosting ? null : new URLSearchParams(location.hash.slice(1)).get('token');
if (supplied) { sessionStorage.setItem('dbg-token', supplied); history.replaceState(null, '', location.pathname); }
let token = publicHosting ? '' : sessionStorage.getItem('dbg-token') || '';
let state = 'disconnected', busy = false, refreshing = false, memoryAddress = '$sp', assemblyAddress = '$pc';
let oldRegisters = {}, lastStopped = '', lastContext = '';
let latestSnapshot=null, workbench=null;
const memoryTools=window.DBGMemoryTools ? new window.DBGMemoryTools() : null;
const advanced=window.DBGAdvanced ? new window.DBGAdvanced({action:(action,data)=>act(action,data)}) : null;
const ctf=window.DBGCTF ? new window.DBGCTF({action:(action,data)=>act(action,data)}) : null;
const allowed = {entry:['loaded','exited'],'source-step':['stopped'],'source-next':['stopped'],run:['loaded','exited'],continue:['stopped'],pause:['running'],step:['stopped'],next:['stopped'],finish:['stopped'],detach:['stopped','running']};
function note(text, error=false) { $('notice').textContent = T(text); $('notice').classList.toggle('error',error); }
function el(tag, text, cls) { const e=document.createElement(tag); if(text!==undefined)e.textContent=T(text); if(cls)e.className=cls; return e; }
function controls() {
  document.querySelectorAll('[data-action]').forEach(b=>b.disabled=busy||!(allowed[b.dataset.action]||[]).includes(state));
  $('load').disabled=busy||!['idle','loaded','exited'].includes(state);
  $('choose-file').disabled=busy||!token||!['disconnected','idle','loaded','exited'].includes(state);
  $('binary-file').disabled=$('choose-file').disabled;
  $('file-drop').classList.toggle('file-busy',busy);
  $('attach').disabled=busy||!['idle','exited'].includes(state);
  $('connect').disabled=busy||state!=='disconnected';
  document.querySelectorAll('#break-form button,#break-location').forEach(e=>e.disabled=busy||!['loaded','stopped','exited'].includes(state));
  workbench?.update(null);
  advanced?.update(null,busy,state);
  ctf?.update(null,busy,state);
}
async function api(path, data) {
  if (publicHosting) throw Error(isEnglish ? 'Local engine is not connected. Use Engine connect for setup.' : '로컬 엔진이 연결되지 않았습니다. 엔진 연결에서 설치 방법을 확인하세요.');
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-UI-Language':isEnglish?'en':'ko'},body:JSON.stringify(data)});
  const body=await response.json(); if(!response.ok)throw Error(body.error||'연결 오류'); return body.result;
}
function render(data) {
  latestSnapshot=data;
  state=data.state; $('status').textContent=(isEnglish?{disconnected:'Disconnected',idle:'Idle',loaded:'Loaded',running:'Running',stopped:'Stopped',exited:'Exited'}:{disconnected:'연결 안 됨',idle:'대기',loaded:'파일 열림',running:'실행 중',stopped:'일시 정지',exited:'종료'})[state]||state; $('status').className='badge '+state;
  $('engine').textContent=data.engine?data.engine.split(/[\\/]/).pop()+' / MI ENGINE':'GDB NOT FOUND';
  const context=String(data.target_id)+':'+String(data.current_thread)+':'+String(data.selected_frame);
  if(context!==lastContext){oldRegisters={};lastContext=context;}
  const pc=data.frame?.addr||data.stop?.frame?.addr;
  const asm=$('assembly'); asm.replaceChildren(); $('assembly-empty').hidden=!!data.assembly.length;
  data.assembly.forEach(ins=>{
    const row=el('tr',undefined,ins.address===pc?'current':'');row.dataset.address=ins.address;
    const addr=el('td'); const button=el('button',(ins.address===pc?'→ ':'  ')+ins.address); button.title=T('이 주소에 중단점 추가');
    button.onclick=()=>act('break-add',{location:'*'+ins.address}); addr.append(button);
    if(advanced){const run=el('button','▶','run-to');run.title=T('이 주소까지 실행');run.disabled=busy||state!=='stopped';run.onclick=()=>act('run-to',{address:ins.address});addr.append(run);}
    row.append(addr,el('td',ins.opcodes||''),el('td',ins.inst)); asm.append(row);
  });
  const regs=$('registers'); regs.replaceChildren();
  data.registers.forEach(r=>{const changed=oldRegisters[r.name]!==undefined&&oldRegisters[r.name]!==r.value; const row=el('div',undefined,'reg'+(changed?' changed':''));row.dataset.register=r.name;row.append(el('span',r.name.toUpperCase()),el('span',r.value));regs.append(row);});
  if(data.registers.length)oldRegisters=Object.fromEntries(data.registers.map(r=>[r.name,r.value]));
  else regs.append(el('p',data.errors.registers||'실행 중인 대상 없음','placeholder'));
  const stack=$('stack'); stack.replaceChildren(); $('frame-count').textContent=data.stack.length+' frames';
  data.stack.forEach(item=>{const f=item.frame||item;const row=el('div',undefined,'frame');row.dataset.level=f.level;row.append(el('span','#'+f.level+'  '+(f.func||'??')),el('small',f.addr+'  '+(f.file?f.file+':'+f.line:'')));stack.append(row);});
  if(!data.stack.length)stack.append(el('p',data.errors.stack||'스택 없음','placeholder'));
  const mem=$('memory'); mem.replaceChildren();
  data.memory.forEach(block=>{
    const bytes=(block.contents||'').match(/../g)||[];
    for(let i=0;i<bytes.length;i+=16){const chunk=bytes.slice(i,i+16);const row=el('div');
      row.append(el('span','0x'+(BigInt(block.begin)+BigInt(i)).toString(16).padStart(8,'0')+'  ','addr'));
      if(memoryTools){
        chunk.forEach((byte,j)=>{const button=el('button',byte,'memory-byte');button.type='button';button.dataset.memoryAddress='0x'+(BigInt(block.begin)+BigInt(i+j)).toString(16);button.title=button.dataset.memoryAddress;row.append(button);});
      }else row.append(el('span',chunk.join(' ').padEnd(47,' ')+'  '));
      row.append(el('span',chunk.map(b=>{const n=parseInt(b,16);return n>=32&&n<=126?String.fromCharCode(n):'.';}).join(''),'ascii'));mem.append(row);
    }
  });
  if(!data.memory.length)mem.append(el('p',data.errors.memory||'읽을 메모리 없음','placeholder'));
  const breaks=$('breakpoints'); breaks.replaceChildren();
  data.breakpoints.forEach(item=>{const b=item.bkpt||item;const row=el('div',undefined,'break-row');const del=el('button','×');del.setAttribute('aria-label',isEnglish?'Delete breakpoint '+b.number:'중단점 '+b.number+' 삭제');del.onclick=()=>act('break-delete',{number:b.number});row.append(el('span','● '+b.number+'  '+(b['original-location']||b.func||b.addr)),del);breaks.append(row);});
  if(!data.breakpoints.length)breaks.append(el('p',data.errors.breakpoints||'설정된 중단점이 없습니다.','placeholder'));
  const log=$('console'), atEnd=log.scrollHeight-log.scrollTop-log.clientHeight<30;
  log.textContent=data.events.join('\n')||'';if(atEnd)log.scrollTop=log.scrollHeight;
  const stopped=JSON.stringify(data.stop);
  if(stopped!==lastStopped&&data.stop.reason){note((isEnglish?'Stop reason: ':'정지 원인: ')+data.stop.reason+(data.stop['signal-name']?' / '+data.stop['signal-name']:''));lastStopped=stopped;}
  memoryTools?.update(data);
  advanced?.update(data,busy,state);
  ctf?.update(data,busy,state);
  workbench?.update(data);
  controls();
}
async function refresh() {
  if(refreshing||busy)return; refreshing=true;
  try{render(await api('state',{address:memoryAddress,assembly_address:assemblyAddress}));}catch(e){note(e.message,true);}finally{refreshing=false;}
}
async function act(action, extra={}) {
  if(busy)return;busy=true;controls();note('명령 처리 중…');
  try{const result=await api('action',{action,...extra});if(action==='load')$('selected-file').textContent=extra.path.split(/[\\/]/).pop();note(({connect:'엔진이 연결되었습니다. 실행 파일 또는 PID를 선택하세요.',load:'실행 파일을 열었습니다. Run으로 시작하세요.',detach:'대상과의 연결을 해제했습니다.',entry:isEnglish?'Stopped at first instruction (may be the dynamic loader).':'첫 명령어에서 정지합니다. 동적 로더에서 멈출 수도 있습니다.', 'memory-write':isEnglish?'Memory written and read back.':'메모리를 쓰고 다시 읽어 확인했습니다.', 'register-write':isEnglish?'Register updated. Inspect the current value.':'레지스터를 수정했습니다. 현재 값을 확인하세요.', 'input-send':isEnglish?'Sent '+result.sent+' bytes to target input.':'대상 입력에 '+result.sent+'바이트를 보냈습니다.'})[action]||'명령을 전달했습니다.');return result;}
  catch(e){note(e.message,true);}finally{busy=false;await refresh();controls();}
}
$('connect').onclick=()=>{
  if (publicHosting) { $('engine-setup').open=true; $('engine-setup').scrollIntoView({block:'nearest'}); return; }
  act('connect');
};
function programArgs() {
  const args=JSON.parse($('args').value);
  if(!Array.isArray(args)||!args.every(a=>typeof a==='string'))throw Error('인수는 문자열 JSON 배열로 입력하세요. 예: ["hello"]');
  return args;
}
$('load').onclick=()=>{
  try{act('load',{path:$('path').value,args:programArgs()});}
  catch(e){note('인수는 문자열 JSON 배열로 입력하세요. 예: ["hello"]',true);}
};
async function openBinary(file) {
  if(!file||busy)return;
  if(!token){note('서버 터미널의 인증 URL로 접속해주세요.',true);return;}
  if(!['disconnected','idle','loaded','exited'].includes(state)){
    note('새 파일을 열기 전에 현재 프로세스에서 Detach 하세요.',true);return;
  }
  if(file.size===0||file.size>128*1024*1024){note('파일은 1바이트 이상, 128 MiB 이하여야 합니다.',true);return;}
  let args;
  try{args=programArgs();}catch{note('인수는 문자열 JSON 배열로 입력하세요.',true);return;}
  busy=true;controls();note(isEnglish?'Opening '+file.name+'…':file.name+' 여는 중…');
  try{
    const response=await fetch('/api/files',{
      method:'POST',headers:{'Content-Type':'application/octet-stream',Authorization:'Bearer '+token,'X-Filename':encodeURIComponent(file.name),'X-UI-Language':isEnglish?'en':'ko'},body:file
    });
    const payload=await response.json();
    if(!response.ok)throw Error(payload.error||'파일을 열지 못했습니다.');
    const opened=payload.result;
    $('path').value=opened.path;
    $('selected-file').textContent=opened.name+' · '+(opened.size<1024?opened.size+' B':(opened.size/1024/1024).toFixed(2)+' MiB');
    $('selected-file').title=opened.name;
    if(state==='disconnected')await api('action',{action:'connect'});
    await api('action',{action:'load',path:opened.path,args});
    oldRegisters={};lastStopped='';
    note(isEnglish?opened.name+' loaded. Choose Run to start.':opened.name+'을 열었습니다. 실행 버튼으로 시작하세요.');
  }catch(e){note(e.message,true);}
  finally{busy=false;$('binary-file').value='';await refresh();controls();}
}
$('choose-file').onclick=()=>$('binary-file').click();
$('binary-file').addEventListener('change',event=>openBinary(event.target.files[0]));
const dropZone=$('file-drop');
let dragDepth=0;
function hasFiles(event){return Array.from(event.dataTransfer?.types||[]).includes('Files');}
window.addEventListener('dragover',event=>{if(hasFiles(event))event.preventDefault();});
window.addEventListener('drop',event=>{if(hasFiles(event))event.preventDefault();});
dropZone.addEventListener('dragenter',event=>{
  if(!hasFiles(event))return;
  event.preventDefault();dragDepth++;dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragover',event=>{
  if(!hasFiles(event))return;
  event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';
});
dropZone.addEventListener('dragleave',()=>{
  dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop',event=>{
  event.preventDefault();dragDepth=0;dropZone.classList.remove('drag-over');
  const files=event.dataTransfer?.files;
  if(!files?.length)return;
  if(files.length!==1){note('바이너리 파일 하나만 선택해주세요.',true);return;}
  openBinary(files[0]);
});
$('attach').onclick=()=>act('attach',{pid:$('pid').value});
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>act(b.dataset.action));
$('break-form').onsubmit=e=>{e.preventDefault();act('break-add',{location:$('break-location').value,...(advanced?.breakOptions()||{})});};
if($('assembly-form'))$('assembly-form').onsubmit=e=>{e.preventDefault();assemblyAddress=$('assembly-address').value.trim();refresh();};
$('memory-form').onsubmit=e=>{e.preventDefault();memoryAddress=$('address').value.trim();refresh();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('main').forEach(m=>m.hidden=m.id!==b.dataset.view);document.querySelectorAll('[data-view]').forEach(t=>t.classList.toggle('active',t===b));});
document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;const action={F7:'step',F8:'next',F9:'continue'}[e.key];if(action){e.preventDefault();if(!busy&&allowed[action].includes(state))act(action);}});
if(window.DBGWorkbench){
  const focusRow=(selector,key,value)=>{
    const rows=document.querySelectorAll(selector);
    rows.forEach(row=>row.classList.remove('search-hit'));
    const row=Array.from(rows).find(item=>String(item.dataset[key])===String(value));
    if(row){row.classList.add('search-hit');row.scrollIntoView({block:'center',behavior:'smooth'});}
  };
  workbench=new window.DBGWorkbench({
    busy:()=>busy,
    memoryAddress:()=>memoryAddress,
    can:action=>!busy&&(allowed[action]||[]).includes(state),
    notice:note,action:act,
    context:()=>({path:$('path').value,args:programArgs(),memoryAddress}),
    memory:address=>{memoryAddress=address;$('address').value=address;refresh();},
    focusRegister:name=>focusRow('.reg','register',name),
    focusInstruction:address=>focusRow('#assembly tr','address',address),
    focusStack:level=>focusRow('.frame','level',level),
    prepareWorkspace:workspace=>{
      $('path').value=workspace.path;$('args').value=JSON.stringify(workspace.args);
      memoryAddress=workspace.memoryAddress;$('address').value=memoryAddress;
      document.querySelector('.path-option').open=true;
    },
    applyBreakpoints:async locations=>{
      if(busy||!['loaded','stopped'].includes(state))return locations;
      busy=true;controls();const failed=[];let firstError='';
      try{
        for(const location of locations){
          try{await api('action',{action:'break-add',location});}
          catch(error){failed.push(location);if(!firstError)firstError=error.message;}
        }
      }finally{busy=false;await refresh();controls();}
      note(failed.length?(isEnglish?'Some breakpoints failed: ':'일부 중단점 적용 실패: ')+firstError:T('중단점을 적용했습니다.'),!!failed.length);
      return failed;
    }
  });
}
controls();
if(publicHosting){
  $('status').textContent=isEnglish?'Engine not connected':'엔진 미연결';
  note(isEnglish?'Workspace open. Native execution requires a local GDB engine.':'디버거 화면이 열렸습니다. 실제 실행에는 로컬 GDB 엔진 연결이 필요합니다.');
}else if(token)refresh();else note('python server.py 실행 후 터미널에 표시된 인증 URL을 열어주세요.',true);
setInterval(()=>{if(token&&!document.hidden)refresh();},1600);
