(function(root){
  'use strict';
  root.DBGAdvanced=class {
    constructor(adapter){
      this.adapter=adapter;this.latest=null;this.$=id=>document.getElementById(id);
      this.en=document.documentElement.lang==='en';
      this.$('thread-select').onchange=()=>adapter.action('thread-select',{thread:this.$('thread-select').value});
      this.$('watch-form').onsubmit=event=>{event.preventDefault();adapter.action('watch-add',{address:this.$('watch-address').value.trim(),size:this.$('watch-size').value,mode:this.$('watch-mode').value});};
    }
    text(ko,en){return this.en?en:ko;}
    node(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
    breakOptions(){return {condition:this.$('break-condition').value,ignore:this.$('break-ignore').value||'0',temporary:this.$('break-temporary').checked};}
    update(data,busy,state){
      if(data)this.latest=data;
      const stopped=state==='stopped'&&!busy,editable=['loaded','stopped','exited'].includes(state)&&!busy;
      for(const id of ['break-condition','break-ignore','break-temporary','watch-address','watch-size','watch-mode'])this.$(id).disabled=!editable;
      this.$('watch-form').querySelector('button').disabled=!editable;
      this.$('thread-select').disabled=!stopped;
      document.querySelectorAll('.frame-select,.run-to').forEach(button=>button.disabled=!stopped);
      document.querySelectorAll('.break-toggle,.break-delete').forEach(button=>button.disabled=!editable);
      if(!data)return;
      const select=this.$('thread-select');
      if(document.activeElement!==select){
        select.replaceChildren();
        for(const thread of data.threads||[]){
          const option=this.node('option','#'+thread.id+' '+(thread.name||thread['target-id']||'')+' '+(thread.frame?.func||thread.state||''));option.value=String(thread.id);select.append(option);
        }
        select.value=String(data.current_thread||'');
      }
      this.$('context-label').textContent=state==='stopped'?'T'+(data.current_thread||'?')+' / #'+(data.selected_frame??0):'—';
      const variables=this.$('local-variables');variables.replaceChildren();
      for(const variable of data.locals||[]){
        const row=this.node('div');row.className='variable-row';row.append(this.node('strong',variable.name),this.node('small',variable.type||''),this.node('code',variable.value??this.text('복합 값 · 심볼 필요','Aggregate value · symbols required')));variables.append(row);
      }
      if(!(data.locals||[]).length)variables.append(this.node('p',data.errors?.locals||this.text('정지 상태와 디버그 심볼이 필요합니다.','Requires a stopped target and debug symbols.')));
      const stack=this.$('stack');stack.replaceChildren();
      for(const entry of data.stack||[]){
        const frame=entry.frame||entry,button=this.node('button');button.className='frame frame-select';button.type='button';button.dataset.level=frame.level;button.disabled=!stopped;
        button.setAttribute('aria-pressed',String(Number(frame.level)===Number(data.selected_frame||0)));
        button.append(this.node('span','#'+frame.level+' '+(frame.func||'??')),this.node('small',(frame.addr||'')+' '+(frame.file?frame.file+':'+frame.line:'')));
        button.onclick=()=>this.adapter.action('frame-select',{frame:frame.level});stack.append(button);
      }
      if(!(data.stack||[]).length)stack.append(this.node('p',data.errors?.stack||this.text('스택 없음','No stack')));
      const breaks=this.$('breakpoints');breaks.replaceChildren();
      for(const entry of data.breakpoints||[]){
        const b=entry.bkpt||entry,row=this.node('div');row.className='break-row';
        const toggle=this.node('button',b.enabled==='y'?'●':'○');toggle.className='break-toggle';toggle.disabled=!editable;toggle.type='button';toggle.title=this.text('중단점 켜기·끄기','Toggle breakpoint');toggle.setAttribute('aria-label',toggle.title+' '+b.number);toggle.setAttribute('aria-pressed',String(b.enabled==='y'));toggle.onclick=()=>this.adapter.action(b.enabled==='y'?'break-disable':'break-enable',{number:b.number});
        const description=this.node('span');description.append(this.node('strong','#'+b.number+' '+(b['original-location']||b.what||b.exp||b.func||b.addr||'')));
        description.append(this.node('small',[b.type,b.cond,b.times!==undefined?this.text('적중 ','Hits ')+b.times:'',b.ignore?this.text('건너뛰기 ','Ignore ')+b.ignore:'',b.disp==='del'?this.text('한 번만','Once'):''].filter(Boolean).join(' · ')));
        const del=this.node('button','×');del.className='break-delete';del.type='button';del.disabled=!editable;del.setAttribute('aria-label',this.text('중단점 삭제 ','Delete breakpoint ')+b.number);del.onclick=()=>this.adapter.action('break-delete',{number:b.number});row.append(toggle,description,del);breaks.append(row);
      }
      if(!(data.breakpoints||[]).length)breaks.append(this.node('p',this.text('설정된 중단점이 없습니다.','No breakpoints configured.')));
    }
  };
})(window);
