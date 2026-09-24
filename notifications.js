/* One notification channel for status messages and legacy tool hints. */
(() => {
  'use strict';
  const row = $('editorFeedback');
  if (!row) return;
  const caption = $('feedbackMode');
  const icon = $('feedbackIcon');
  const dismissButton = $('feedbackDismiss');
  const detailsButton = $('feedbackDetails');
  const dialog = $('feedbackDialog');
  const labels = {
    shape6: 'Форма комнаты', shape: 'Форма комнаты',
    obstacle6: 'Препятствия', exclude: 'Препятствия',
    collector6: 'Коллектор', collector: 'Коллектор',
    addBlock6: 'Добавление участка', manualV2: 'Правка трубы',
    inspect: 'Просмотр плана'
  };
  let current = null;
  let lastMessage = null;
  let timer = null;
  let lastKey = '';
  let lastShownAt = -Infinity;
  let currentMode = '';
  let shownHint = '';

  // The old timer must not hide a newer message after this controller takes over.
  if (typeof statusTimerV5 !== 'undefined') {
    clearTimeout(statusTimerV5);
    statusTimerV5 = null;
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    current = null;
    row.removeAttribute('data-kind');
    status.classList.remove('visible', 'error');
    status.textContent = '';
    caption.hidden = false;
    icon.hidden = true;
    dismissButton.hidden = true;
  }

  function show(text, kind = 'info') {
    text = String(text || '').trim();
    if (!text) { hide(); lastKey = ''; return; }
    const now = performance.now();
    const key = `${kind}:${text}`;
    // Repeated events neither extend the deadline nor immediately resurrect
    // a message dismissed by the user. There is no queue of obsolete messages.
    if (key === lastKey && now - lastShownAt < 6000 && (kind !== 'progress' || current?.kind === 'progress')) return;
    if (kind === 'hint' && current && current.kind !== 'hint') return;
    clearTimeout(timer);
    current = { text, kind };
    if (kind !== 'hint' && kind !== 'progress') lastMessage = current;
    lastKey = key;
    lastShownAt = now;
    row.dataset.kind = kind;
    caption.hidden = true;
    status.textContent = text;
    status.classList.add('visible');
    status.classList.toggle('error', kind === 'error');
    icon.textContent = kind === 'progress' ? '' : kind === 'error' ? '!' : kind === 'hint' ? '?' : 'i';
    icon.hidden = false;
    dismissButton.hidden = false;
    if (kind !== 'progress') timer = setTimeout(hide, kind === 'error' ? 4000 : 2000);
  }

  setStatus = function (text, isError = false, options = {}) {
    show(text, options.kind === 'progress' ? 'progress' : isError ? 'error' : 'info');
  };

  function updateMode() {
    if (current?.kind === 'progress' && !state.engineBusyV1) hide();
    const mode = state.manualV2?.active ? 'manualV2' : state.mode;
    caption.textContent = labels[mode] || 'План комнаты';
    if (mode === currentMode) return;
    currentMode = mode;
    shownHint = '';
    lastKey = '';
    if (current?.kind !== 'progress') hide();
  }

  const render = renderPlan;
  renderPlan = function (...args) { const result = render(...args); updateMode(); return result; };
  const reset = resetRoute;
  resetRoute = function (...args) {
    const result = reset(...args);
    if (current?.kind === 'progress') hide();
    return result;
  };

  // Tool hints use the same reserved row and can never cover a status/error.
  new MutationObserver(() => {
    updateMode();
    const text = modeHint.textContent.trim();
    const key = `${currentMode}:${text}`;
    if (text && modeHint.classList.contains('visible') && key !== shownHint) {
      shownHint = key;
      show(text, 'hint');
    }
  }).observe(modeHint, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });

  dismissButton.addEventListener('click', hide);
  // Resume drawing immediately; this listener never cancels the gesture.
  document.querySelector('#editorView .workspace').addEventListener('pointerdown', () => {
    if (current?.kind !== 'progress') hide();
  }, { passive: true, capture: true });

  detailsButton.addEventListener('click', () => {
    const hint = modeHint.classList.contains('visible') ? modeHint.textContent.trim() : '';
    const message = current || lastMessage;
    $('feedbackDialogTitle').textContent = !message || message.kind === 'hint' ? 'Подсказка' : 'Последнее сообщение';
    let text = message?.text || hint || 'Выберите объект на плане или инструмент внизу.';
    if (message && hint && hint !== message.text) text += `\n\nПодсказка инструмента:\n${hint}`;
    $('feedbackDialogText').textContent = text;
    hide();
    if (!dialog.open) dialog.showModal();
  });
  $('feedbackDialogClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => detailsButton.focus({ preventScroll: true }));
  updateMode();
  hide();
})();
