'use strict';
(() => {
  const dialog=document.getElementById('gdb-download-dialog');
  if(!dialog)return;
  document.getElementById('cpu-gdb-download')?.addEventListener('click',()=>dialog.showModal());
  for(const button of dialog.querySelectorAll('[data-gdb-close]'))button.addEventListener('click',()=>dialog.close('browser'));
  document.getElementById('gdb-download-link').addEventListener('click',()=>dialog.close('download'));
  document.getElementById('gdb-setup-link').addEventListener('click',()=>{
    const setup=document.getElementById('setup');
    if(setup)setup.open=true;
    dialog.close('setup');
  });
  dialog.showModal();
})();
