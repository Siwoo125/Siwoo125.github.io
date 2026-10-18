(function (root) {
  'use strict';
  const I = root.DBGInspector;
  root.DBGWorkbench = class {
    constructor(adapter) {
      this.adapter=adapter; this.records=[]; this.lastStop=''; this.pending=[]; this.latest=null;
      this.$=id=>document.getElementById(id);
      this.en=document.documentElement.lang==='en';
      this.t=text=>this.en?(root.DBG_I18N[text]||text):text;
      this.$('snapshot-now').onclick=()=>this.saveSnapshot();
      this.$('report-save').onclick=()=>this.saveReport();
      this.$('workspace-save').onclick=()=>this.saveWorkspace();
      this.$('workspace-open').onclick=()=>this.$('workspace-file').click();
      this.$('workspace-file').onchange=event=>this.importWorkspace(event.target.files[0]);
      this.$('workspace-apply').onclick=()=>this.applyWorkspace();
      this.$('snapshot-a').onchange=()=>this.renderComparison();
      this.$('snapshot-b').onchange=()=>this.renderComparison();
      this.$('palette-open').onclick=()=>this.openPalette();
      this.$('palette-query').oninput=()=>this.renderPalette();
      this.$('palette-close').onclick=()=>this.$('command-palette').close();
      this.$('palette-query').onkeydown=event=>{
        if(event.key==='Enter'){event.preventDefault();this.$('palette-results').querySelector('button')?.click();}
        if(event.key==='ArrowDown'){event.preventDefault();this.$('palette-results').querySelector('button')?.focus();}
      };
      document.addEventListener('keydown',event=>{
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
          event.preventDefault();this.$('command-palette').open?this.$('command-palette').close():this.openPalette();
        }
      });
      this.update(null);
    }
    element(tag,text,cls) {
      const node=document.createElement(tag);if(text!==undefined)node.textContent=this.t(text);if(cls)node.className=cls;return node;
    }
    download(name,text,type) {
      const url=URL.createObjectURL(new Blob([text],{type}));
      const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    errorText(text) {
      if(this.en)return text;
      return ({'Unsupported workspace format.':'지원하지 않는 작업공간 형식입니다.',
        'Invalid executable path.':'실행 파일 경로가 올바르지 않습니다.',
        'Invalid argument list.':'프로그램 인수 형식이 올바르지 않습니다.',
        'Invalid memory address.':'메모리 주소가 올바르지 않습니다.',
        'Invalid breakpoint list.':'중단점 목록이 올바르지 않습니다.',
        'Detach before importing a workspace.':'작업공간을 열기 전에 현재 대상에서 Detach 하세요.',
        'Workspace files must be at most 256 KiB.':'작업공간 파일은 256 KiB 이하여야 합니다.',
        'Invalid workspace JSON.':'작업공간 JSON 문법이 올바르지 않습니다.'})[text]||text;
    }
    context() { return this.adapter.context(); }
    update(data) {
      if(data)this.latest=data;
      const stopped=this.latest?.state==='stopped';
      this.$('snapshot-now').disabled=!stopped||this.adapter.busy();
      this.$('report-save').disabled=!this.records.length;
      this.$('workspace-open').disabled=this.adapter.busy()||['running','stopped'].includes(this.latest?.state);
      this.$('workspace-save').disabled=this.adapter.busy()||this.latest?.state==='running';
      this.$('workspace-apply').disabled=!this.pending.length||!['loaded','stopped'].includes(this.latest?.state)||this.adapter.busy();
      if(stopped&&!this.adapter.busy()){
        const key=String(this.latest.target_id)+':'+String(this.latest.stop_sequence);
        if(this.latest.stop_sequence!==undefined&&key!==this.lastStop){this.lastStop=key;this.saveSnapshot(true);}
      }
      if(this.$('command-palette').open)this.renderPalette();
    }
    saveSnapshot(automatic=false) {
      if(this.latest?.state!=='stopped'||this.adapter.busy())return;
      const snapshot=I.capture(this.latest,this.adapter.memoryAddress());
      snapshot.id=String(Date.now())+'-'+Math.random().toString(16).slice(2);
      this.records.push(snapshot);if(this.records.length>50)this.records.shift();
      const first=this.$('snapshot-a'),second=this.$('snapshot-b');const previous=first.value;
      for(const select of [first,second]){
        select.replaceChildren();
        this.records.forEach((item,index)=>{
          const label=(index+1)+' · '+new Date(item.at).toLocaleTimeString(this.en?'en-US':'ko-KR')+' · '+(item.stop.frame?.addr||'?')+' · '+(item.stop.reason||'');
          const option=this.element('option',label);option.value=item.id;select.append(option);
        });
      }
      first.value=this.records.some(r=>r.id===previous)?previous:this.records[0].id;
      second.value=snapshot.id;
      this.$('snapshot-count').textContent=String(this.records.length);
      this.$('report-save').disabled=false;this.renderComparison();
      if(!automatic){this.$('analysis-panel').open=true;this.adapter.notice(this.t('현재 정지 상태를 기록했습니다.'));}
    }
    renderComparison() {
      const a=this.records.find(r=>r.id===this.$('snapshot-a').value),b=this.records.find(r=>r.id===this.$('snapshot-b').value);
      const target=this.$('snapshot-diff');target.replaceChildren();
      if(!a||!b)return;
      const changes=I.compare(a,b);
      this.$('snapshot-target').textContent=(I.basename(a.path)||'PID')+' → '+(I.basename(b.path)||'PID');
      const rows=[];
      changes.registers.forEach(r=>rows.push([r.name,r.before,r.after]));
      changes.memory.forEach(m=>rows.push([m.address,m.before,m.after]));
      rows.slice(0,2048).forEach(values=>{const row=this.element('tr');values.forEach(value=>row.append(this.element('td',value===null?'—':value)));target.append(row);});
      const notes=[this.t('변경된 레지스터')+': '+changes.registers.length, this.t('변경된 바이트')+': '+changes.memory.length];
      if(!changes.memoryAvailable)notes.push(this.t('두 기록 모두에서 메모리를 읽어야 비교할 수 있습니다.'));
      if(changes.differentTarget)notes.push(this.t('서로 다른 대상 또는 실행의 기록입니다.'));
      if(changes.differentContext)notes.push(this.t('서로 다른 스레드 또는 프레임입니다.'));
      if(changes.differentRange)notes.push(this.t('조회한 메모리 범위가 다릅니다.'));
      this.$('comparison-status').textContent=notes.join(' · ');
    }
    saveReport() {
      const snapshot=this.records.find(r=>r.id===this.$('snapshot-b').value);
      if(!snapshot)return;
      const options={language:this.en?'en':'ko',memory:this.$('report-memory').checked,logs:this.$('report-logs').checked};
      this.download('dbgdesk-report-'+snapshot.at.replace(/[:.]/g,'-')+'.md',I.report(snapshot,options),'text/markdown;charset=utf-8');
      this.adapter.notice(this.t('선택한 정지 기록의 보고서를 저장했습니다. 공유 전에 내용을 확인하세요.'));
    }
    saveWorkspace() {
      try{
        const workspace=I.workspace(this.latest,this.context());
        this.download('dbgdesk-workspace.json',JSON.stringify(workspace,null,2)+'\n','application/json');
        this.adapter.notice(this.t('작업공간을 저장했습니다. 경로와 프로그램 인수가 포함됩니다.'));
      }catch(error){this.adapter.notice(this.errorText(error.message),true);}
    }
    async importWorkspace(file) {
      if(!file)return;
      try{
        if(this.adapter.busy()||['running','stopped'].includes(this.latest?.state))throw Error('Detach before importing a workspace.');
        if(file.size>256*1024)throw Error('Workspace files must be at most 256 KiB.');
        const workspace=I.validateWorkspace(JSON.parse(await file.text()));
        this.adapter.prepareWorkspace(workspace);this.pending=[...workspace.breakpoints];
        this.$('workspace-pending').textContent=(I.basename(workspace.path)||this.t('대상 미지정'))+' · '+this.t('대기 중단점')+': '+this.pending.length;
        this.adapter.notice(this.t('설정을 불러왔습니다. 파일을 연 뒤 중단점을 적용하세요. 자동 실행하지 않습니다.'));
        this.update(null);
      }catch(error){this.adapter.notice(this.errorText(error instanceof SyntaxError?'Invalid workspace JSON.':error.message),true);}
      finally{this.$('workspace-file').value='';}
    }
    async applyWorkspace() {
      if(!this.pending.length||this.adapter.busy()||!['loaded','stopped'].includes(this.latest?.state))return;
      const existing=new Set((this.latest?.breakpoints||[]).map(item=>(item.bkpt||item)['original-location']).filter(Boolean));
      const remaining=this.pending.filter(location=>!existing.has(location));
      this.pending=await this.adapter.applyBreakpoints(remaining);
      this.$('workspace-pending').textContent=this.t('대기 중단점')+': '+this.pending.length;
      this.update(null);
    }
    openPalette() {
      const dialog=this.$('command-palette');if(!dialog.open)dialog.showModal();
      this.$('palette-query').value='';this.renderPalette();this.$('palette-query').focus();
    }
    renderPalette() {
      const target=this.$('palette-results');target.replaceChildren();
      const query=this.$('palette-query').value.trim().toLowerCase();
      const entries=[];
      const commands=[['run','실행'],['continue','계속'],['pause','일시 정지'],['step','Step into'],['next','Step over'],['finish','Step out'],['source-step','소스 줄 안으로'],['source-next','소스 줄 넘기기'],['detach','Detach']];
      commands.forEach(([action,label])=>{if(this.adapter.can(action))entries.push({label:this.t(label),run:()=>this.adapter.action(action)});});
      if(!document.getElementById('choose-file').disabled)entries.push({label:this.t('파일 열기…'),run:()=>document.getElementById('choose-file').click()});
      if(/^0x[0-9a-f]+$/i.test(query))entries.push({label:this.t('메모리로 이동')+' '+query,run:()=>this.adapter.memory(query)});
      if(query){
        (this.latest?.registers||[]).filter(r=>(r.name+' '+r.value).toLowerCase().includes(query)).slice(0,20).forEach(r=>entries.push({label:r.name+' = '+r.value,run:()=>this.adapter.focusRegister(r.name)}));
        (this.latest?.assembly||[]).filter(a=>(a.address+' '+a.inst).toLowerCase().includes(query)).slice(0,20).forEach(a=>entries.push({label:a.address+' '+a.inst,run:()=>this.adapter.focusInstruction(a.address)}));
        (this.latest?.stack||[]).map(item=>item.frame||item).filter(f=>(f.func+' '+f.addr).toLowerCase().includes(query)).slice(0,10).forEach(f=>entries.push({label:'#'+f.level+' '+f.func+' '+f.addr,run:()=>this.adapter.focusStack(f.level)}));
      }
      const matches=entries.filter(entry=>!query||entry.label.toLowerCase().includes(query)).slice(0,40);
      if(!matches.length)target.append(this.element('li','검색 결과 없음'));
      matches.forEach(entry=>{const item=this.element('li');const button=this.element('button',entry.label);button.type='button';button.onclick=()=>{this.$('command-palette').close();entry.run();};item.append(button);target.append(item);});
    }
  };
})(window);
