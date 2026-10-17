'use strict';

function composeMailto(email, topic, subject, message) {
  return 'mailto:' + email + '?subject=' + encodeURIComponent('[DBG Desk · ' + topic + '] ' + subject)
    + '&body=' + encodeURIComponent(message);
}

if (typeof document !== 'undefined') {
  const form = document.getElementById('contact-form');
  const english = document.documentElement?.lang === 'en';
  const T = text => english ? ((window.DBG_I18N || {})[text] || text) : text;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const subject = document.getElementById('contact-subject').value.trim();
    const message = document.getElementById('contact-message').value.trim();
    const topic = document.getElementById('contact-topic').value;
    const status = document.getElementById('contact-status');
    if (!subject || !message) {
      status.textContent = T('제목과 내용을 입력해주세요.');
      return;
    }
    if (!form.dataset.email) {
      status.textContent = T('문의 이메일을 준비 중입니다.');
      return;
    }
    const link = document.createElement('a');
    link.href = composeMailto(form.dataset.email, topic, subject, message);
    link.click();
    status.textContent = T('메일 앱에서 내용을 확인한 뒤 전송해주세요. 앱이 열리지 않으면 위 주소로 직접 보내주세요.');
  });
}
