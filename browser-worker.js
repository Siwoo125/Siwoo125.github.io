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
      else if(action==='restore')state=engine.restore(data.bytes,data.checkpoint);
      else {
        if(!engine.cpu)throw Error('Open a binary first.');
        if(action==='step'){engine.runTarget=null;state=engine.run(1);}
        else if(action==='step-over')state=engine.stepOver();
        else if(action==='run-to')state=engine.runTo(data.address);
        else if(action==='cancel-target')engine.runTarget=null;
        else if(action==='continue')state=engine.run(10000);
        else if(action==='nop')engine.nop(data.address);
        else if(action==='memory-write')engine.memoryWrite(data.address,data.bytes);
        else if(action==='register-write')engine.setRegister(data.name,data.value);
        else if(action==='input')engine.feed(data.bytes);
        else if(action==='breakpoint-add'){
          const at=DBGCPU.address(data.address);
          if(!engine.breakpoints.has(at)&&engine.breakpoints.size>=128)throw Error('At most 128 breakpoints.');
          engine.breakpoints.add(at);engine.disabledBreakpoints.delete(at);
        } else if(action==='breakpoint-remove'){
          const at=DBGCPU.address(data.address);engine.breakpoints.delete(at);engine.disabledBreakpoints.delete(at);
        } else if(action==='breakpoint-toggle'){
          const at=DBGCPU.address(data.address);if(!engine.breakpoints.has(at))throw Error('Breakpoint does not exist.');
          if(engine.disabledBreakpoints.has(at))engine.disabledBreakpoints.delete(at);else engine.disabledBreakpoints.add(at);
        }
        else if(action!=='state' && action!=='checkpoint')throw Error('Unknown browser action.');
        state=engine.snapshot(data.memoryAddress);
      }
      const checkpoint=(data.captureSession || action==='checkpoint')?engine.checkpoint():undefined;
      postMessage({id,ok:true,state,checkpoint});
    } catch(error){postMessage({id,ok:false,error:String(error.message||error)});}
  });
};
