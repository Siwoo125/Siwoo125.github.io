(() => {
  'use strict';
  const preference = 'dbgdesk-download-choice';
  try { if (localStorage.getItem(preference)) return; } catch {}
  const english = document.documentElement.lang === 'en';
  const dialog = document.createElement('dialog');
  dialog.className = 'download-prompt';
  dialog.setAttribute('aria-labelledby', 'download-prompt-title');
  dialog.innerHTML = english
    ? '<h2 id="download-prompt-title">Download the local debugger?</h2><p>DBG Desk uses a local Python server and GDB to debug programs on your PC.</p><p>Allowing this download saves a source ZIP. Extract it and run the server to connect the engine. Python and GDB are installed separately; downloading does not install or start them.</p><div class="download-prompt-actions"><button type="button" data-later>Later</button><a class="debugger-link" data-download download href="/downloads/dbg-local-v0.1.zip">Allow and download ZIP</a></div><p class="download-prompt-note">You can also download it later from the engine connection panel.</p>'
    : '<h2 id="download-prompt-title">로컬 디버거를 내려받을까요?</h2><p>DBG Desk는 내 PC의 Python 서버와 GDB로 프로그램을 디버깅합니다.</p><p>허용하면 소스 ZIP을 내려받습니다. 압축을 풀고 서버를 실행하면 엔진에 연결됩니다. Python과 GDB는 별도로 설치해야 하며, 다운로드만으로 설치되거나 실행되지는 않습니다.</p><div class="download-prompt-actions"><button type="button" data-later>나중에</button><a class="debugger-link" data-download download href="/downloads/dbg-local-v0.1.zip">허용하고 ZIP 다운로드</a></div><p class="download-prompt-note">나중에도 엔진 연결 메뉴에서 내려받을 수 있습니다.</p>';
  function remember(choice) {
    try { localStorage.setItem(preference, choice); } catch {}
  }
  dialog.querySelector('[data-later]').addEventListener('click', () => {
    remember('later'); dialog.close();
  });
  dialog.querySelector('[data-download]').addEventListener('click', () => {
    remember('download'); dialog.close();
    // Keep the anchor's default download action within this user gesture.
  });
  dialog.addEventListener('cancel', () => remember('later'));
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
})();
