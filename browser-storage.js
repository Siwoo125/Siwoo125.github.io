/* SPDX-License-Identifier: GPL-2.0-only */
(function(root) {
  'use strict';
  class SessionStore {
    constructor(factory=root.indexedDB) {this.factory=factory;this.queue=Promise.resolve();this.database=null;}
    open() {
      if(this.database)return this.database;
      this.database=new Promise((resolve,reject)=>{
        if(!this.factory){reject(Error('Browser storage is unavailable.'));return;}
        const request=this.factory.open('dbgdesk-browser-session',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('local');
        request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(Error('Close other DBG Desk tabs to open browser storage.'));
      });
      return this.database;
    }
    transaction(mode,operation) {
      const next=this.queue.then(async()=>{
        const db=await this.open();
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('local',mode),store=tx.objectStore('local');let result;
          tx.oncomplete=()=>resolve(result);
          tx.onabort=()=>reject(tx.error||Error('Browser storage transaction was aborted.'));
          tx.onerror=()=>{};
          operation(store,value=>{result=value;});
        });
      });
      this.queue=next.catch(()=>{});return next;
    }
    read() {return this.transaction('readonly',(store,done)=>{const r=store.get('session');r.onsuccess=()=>{const session=r.result,p=store.get('autoSave');p.onsuccess=()=>done({session,autoSave:p.result!==false});};});}
    save(session) {return this.transaction('readwrite',store=>store.put(session,'session'));}
    preference(enabled) {return this.transaction('readwrite',store=>store.put(enabled,'autoSave'));}
    clear() {return this.transaction('readwrite',store=>{store.delete('session');store.put(false,'autoSave');});}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=SessionStore;
  else root.DBGSessionStore=SessionStore;
})(typeof self!=='undefined'?self:globalThis);
