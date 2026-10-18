/* SPDX-License-Identifier: GPL-2.0-only */
'use strict';
importScripts('/vendor/unicorn.js', '/vendor/capstone.js', '/browser-engine.js');
const ready=Promise.all([MUnicorn(),MCapstone({locateFile:name=>'/vendor/'+name})]).then(([u,c])=>new DBGCPU.BrowserEngine(u,c));
let sequence=Promise.resolve();
onmessage=event=>{
  sequence=sequence.then(async()=>{
    const {id,action,data={}}=event.data;
    try {
      const engine=await ready;
      if(data.memoryAddress!==undefined)DBGCPU.address(data.memoryAddress);
      let state;
      if(action==='load')state=engine.load(data.bytes);
      else {
        if(!engine.cpu)throw Error('Open a binary first.');
        if(action==='step')state=engine.run(1);
        else if(action==='continue')state=engine.run(10000);
        else if(action==='memory-write')engine.memoryWrite(data.address,data.bytes);
        else if(action==='register-write')engine.setRegister(data.name,data.value);
        else if(action==='input')engine.feed(data.bytes);
        else if(action==='breakpoint-add'){
          if(engine.breakpoints.size>=128)throw Error('At most 128 breakpoints.');
          engine.breakpoints.add(DBGCPU.address(data.address));
        } else if(action==='breakpoint-remove')engine.breakpoints.delete(DBGCPU.address(data.address));
        else if(action!=='state')throw Error('Unknown browser action.');
        state=engine.snapshot(data.memoryAddress);
      }
      postMessage({id,ok:true,state});
    } catch(error){postMessage({id,ok:false,error:String(error.message||error)});}
  });
};
