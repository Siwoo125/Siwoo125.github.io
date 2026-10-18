'use strict';

function composeIssueURL(endpoint, topic, subject, message) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/new$/.test(endpoint)) {
    throw new Error('Invalid contact destination');
  }
  return endpoint + '?title=' + encodeURIComponent('[DBG Desk · ' + topic + '] ' + subject)
    + '&body=' + encodeURIComponent(message);
}

if (typeof document !== 'undefined') {
  const form = document.getElementById('contact-form');
  const english = document.documentElement?.lang === 'en';
  const T = text => english ? ((window.DBG_I18N || {})[text] || text) : text;
  if (form) form.addEventListener('submit', event => {
    event.preventDefault();
    const subject = document.getElementById('contact-subject').value.trim();
    const message = document.getElementById('contact-message').value.trim();
    const topic = document.getElementById('contact-topic').value;
    const status = document.getElementById('contact-status');
    if (!subject || !message) {
      status.textContent = T('제목과 내용을 입력해주세요.');
      return;
    }
    try {
      const link = document.createElement('a');
      link.href = composeIssueURL(form.dataset.issueUrl, topic, subject, message);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
      status.textContent = T('GitHub에서 내용을 확인한 뒤 등록해주세요. 등록한 문의는 공개됩니다.');
    } catch (_) {
      status.textContent = T('문의 작성 화면을 열 수 없습니다. 기존 문의 보기를 이용해주세요.');
    }
  });
}
