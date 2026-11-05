'use strict';

(() => {
  const settings=document.currentScript?.dataset;
  // Public exports can also be served as local previews. Never request an ad
  // on localhost, a preview deployment, or an origin not approved in config.
  if(!settings || location.origin!==settings.adOrigin ||
     !/^ca-pub-[0-9]{16}$/.test(settings.adClient) ||
     !/^https:\/\/[A-Za-z0-9.-]+$/.test(settings.adOrigin))return;
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
})();
