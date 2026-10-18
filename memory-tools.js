(function(root){
  'use strict';
  root.DBGMemoryTools=class {
    constructor(){
      this.$=id=>document.getElementById(id);this.blocks=[];this.address=null;this.target=null;
      this.en=document.documentElement.lang==='en';
      this.$('memory-search-form').onsubmit=event=>{event.preventDefault();this.search();};
      this.$('memory-endian').onchange=()=>this.inspect();
      this.$('memory').addEventListener('click',event=>{
        const button=event.target.closest('[data-memory-address]');
        if(button){this.address=button.dataset.memoryAddress;this.$('memory-search-form').closest('details').open=true;this.inspect();}
      });
    }
    say(ko,en){return this.en?en:ko;}
    update(data){
      if(this.target!==data.target_id){this.address=null;this.$('memory-query').value='';}
      this.target=data.target_id;this.blocks=data.state==='stopped'?data.memory:[];
      this.search();this.inspect();
    }
    search(){
      const matches=this.$('memory-matches');matches.replaceChildren();
      const query=this.$('memory-query').value;
      let message=this.say('현재 읽은 범위만 검색합니다.','Searches only the currently loaded memory range.');
      if(query){
        try{
          const results=root.DBGInspector.findMemory(this.blocks,query,this.$('memory-search-mode').value);
          message=this.say('일치 주소: ','Matching addresses: ')+results.length;
          for(const address of results.slice(0,64)){
            const button=document.createElement('button');button.type='button';button.textContent=address;
            button.onclick=()=>{this.address=address;this.inspect();};matches.append(button);
          }
        }catch(error){message=this.en?error.message:this.say('HEX는 48 8B ?? FF 형식으로 최대 256바이트, 문자열은 1~256자로 입력하세요.','');}
      }
      this.$('memory-search-status').textContent=message;
    }
    inspect(){
      const output=this.$('memory-value');output.replaceChildren();
      document.querySelectorAll('.memory-byte').forEach(button=>button.classList.toggle('selected',button.dataset.memoryAddress===this.address));
      if(!this.address)return;
      const values=root.DBGInspector.interpretMemory(this.blocks,this.address,this.$('memory-endian').value==='little');
      const title=document.createElement('p');title.textContent=this.address;output.append(title);
      if(!Object.keys(values).length){title.textContent+=this.say(' — 현재 읽은 범위 밖입니다.',' — outside the loaded range.');return;}
      const list=document.createElement('dl');
      for(const [type,value] of Object.entries(values)){
        const label=document.createElement('dt'),content=document.createElement('dd');label.textContent=type;content.textContent=value;list.append(label,content);
      }
      output.append(list);
    }
  };
})(window);
