'use strict';

(() => {
  const settings=document.currentScript?.dataset;
  // Public exports can also be served as local previews. Never request an ad
  // on localhost, a preview deployment, or an origin not approved in config.
  if(!settings || location.origin!==settings.adOrigin ||
     !/^ca-pub-[0-9]{16}$/.test(settings.adClient) ||
     !/^https:\/\/[A-Za-z0-9.-]+$/.test(settings.adOrigin))return;
  function startAds() {
  const slots=[...document.querySelectorAll('ins.adsbygoogle')].filter(slot=>slot.dataset.adClient===settings.adClient);
  if(!slots.length)return;
  const loader=document.createElement('script');
  loader.async=true;
  loader.crossOrigin='anonymous';
  loader.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+settings.adClient;
  document.head.append(loader);
  const queue=window.adsbygoogle=window.adsbygoogle||[];
  for(const slot of slots) {
    if(slot.dataset.adRequested)continue;
    slot.dataset.adRequested='true';
    queue.push({});
  }
  const privacy=window.googlefc=window.googlefc||{};
  privacy.callbackQueue=privacy.callbackQueue||[];
  let privacyButton;
  privacy.callbackQueue.push({CONSENT_API_READY:()=>{
    if(typeof window.__tcfapi!=='function')return;
    window.__tcfapi('addEventListener',0,(data,success)=>{
      if(privacyButton)privacyButton.hidden=!(success&&data?.gdprApplies);
      if(!success||!data?.gdprApplies||privacyButton)return;
      const footer=document.querySelector('.site-footer > div');
      if(!footer)return;
      privacyButton=document.createElement('button');
      privacyButton.type='button';
      privacyButton.className='privacy-options';
      privacyButton.textContent=document.documentElement.lang==='en'?'Privacy and cookie settings':'개인정보 및 쿠키 설정';
      privacyButton.addEventListener('click',()=>privacy.showRevocationMessage());
      footer.append(privacyButton);
    });
  }});
  }
  const entryDialog=document.getElementById('gdb-download-dialog');
  if(entryDialog)entryDialog.addEventListener('close',startAds,{once:true});
  else startAds();
})();
