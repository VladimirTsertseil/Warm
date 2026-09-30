/* Warm 3.4: manual grid routes, persistent drafts, explicit completion. */
(() => {
  'use strict';
  const E = WarmGridEditor, S = WarmSpiral, copy = x => structuredClone(x), el = id => document.getElementById(id);
  const projectBase = WarmV300.project, project = () => projectBase(), DRAFT_KEY = 'warm-grid-editor-draft-v34';
  let edit = null, active = false, selection = null, rangeStart = null, drawing = null, baseline = null, undo = [], redo = [];
  let reportKey = '', report = null, saveTimer = null, worker = null, generation = 0, cancelPending = null;
  const partNames = {heating: 'Рабочая часть', supply: 'Подающий подвод', return: 'Обратный подвод'};
  const messages = {
    GAP: 'Разрыв трубы: восстановите участок или соедините концы.', MISSING_ROUTE: 'У этого контура ещё нет полного маршрута.',
    INVALID_TURN: 'Нулевой, диагональный участок или разворот без места для изгиба.', OFF_GRID: 'Рабочая труба должна идти по монтажным направляющим.',
    OUTSIDE_ALLOWED_AREA: 'Труба или изгиб выходит за разрешённую область.', SELF_INTERSECTION: 'Контур пересекает сам себя.',
    CIRCUIT_INTERSECTION: 'Пересечение или касание разных контуров.', RADIUS_DOES_NOT_FIT: 'Для заданного радиуса не хватает места.',
    DISCONTINUOUS: 'Части трубы не соединены.', INVALID_ENDPOINTS: 'Маршрут не соединён с заданной подачей и обраткой.',
    COLLECTOR_REQUIRED: 'Укажите подачу и обратку.', COLLECTOR_OUTSIDE: 'Точка коллектора вне доступной комнаты.', COINCIDENT_PORTS: 'Подача и обратка совпадают.',
    INCOMPLETE_COVERAGE: 'После правки часть рабочей зоны осталась без проходов.', UNASSIGNED_AREA: 'Не вся доступная площадь распределена по контурам.',
    ZONES_OVERLAP: 'Рабочие зоны перекрываются.', ZONES_REQUIRED: 'Назначьте отдельную зону каждому контуру.', EMPTY_ZONE: 'Рабочая зона вне комнаты.',
    DISCONNECTED_OR_EMPTY_GRID: 'В зоне нет связной монтажной сетки.', SELECT_SPAN: 'Выберите участок трубы.', SELECT_ONE_SEGMENT: 'Для сдвига выберите одну прямую.',
    ENDPOINT_LOCKED: 'Это соединение с другой частью трубы. Используйте замену участка, сохраняя его концы.',
    CONNECTION_NOT_FOUND: 'Короткое соединение не найдено. Нарисуйте замену вручную.', REPLACEMENT_ENDPOINTS: 'Замена должна соединять две отмеченные точки.',
    OTHER_CIRCUITS_INVALID: 'Сначала исправьте ошибки остальных контуров.', NO_COMPLETE_CIRCUIT: 'Контур с выбранным методом не найден. Правки сохранены.',
    FULL_CIRCUIT_REQUIRED: 'Сначала постройте полный контур с подводами через «Расчёт».', CONTEXT_CHANGED: 'Форма, зоны или параметры изменились. Нажмите «Проверить с текущими параметрами».',
    INVALID_DRAFT: 'Повреждены данные ручной правки.', RADIUS_REQUIRED: 'Укажите радиус поворота.', INVALID_SPACING: 'Укажите целый шаг в ячейках.',
    INVALID_OFFSET: 'Отступ не может быть отрицательным.', SEARCH_LIMIT: 'Поиск исчерпал время. Правки сохранены.', TIMEOUT: 'Поиск не завершился. Правки сохранены.'
  };
  const message = code => messages[code] || 'Проверьте геометрию и параметры контура.';
  const metres = n => n == null ? 'не определена' : `${(n / 1000).toFixed(1).replace('.', ',')} м`;
  function contextKey() {const p = project(); return JSON.stringify([p.room, p.grid, p.exclusions, p.pipe, state.circuitSettingsV32, WarmV330.definitions]);}
  function stale() {return !!edit && (edit.context !== contextKey() || JSON.stringify(edit.draft.settings) !== JSON.stringify(state.circuitSettingsV32) || JSON.stringify(edit.draft.definitions) !== JSON.stringify(WarmV330.definitions));}
  function inspect() {
    if (!edit) return null;
    const key = JSON.stringify([contextKey(), edit.draft]);
    if (key !== reportKey) {report = E.inspect(project(), edit.draft); reportKey = key;}
    const result = copy(report);
    if (stale()) {result.ok = result.complete = false; result.issues.unshift({code: 'CONTEXT_CHANGED', id: null, part: null, edges: []});}
    return result;
  }
  function syncDefinitions() {
    state.circuitSettingsV32 = copy(edit.draft.settings);
    state.circuitDefinitionsV33 = edit.draft.definitions.map(d => ({...copy(d), portsFromMain: false}));
    if (edit.draft.definitions.length === 1) {state.supply = copy(edit.draft.definitions[0].supply); state.returnPoint = copy(edit.draft.definitions[0].returnPoint);}
  }
  const panel = document.createElement('section'); panel.id = 'gridEditorPanelV34'; panel.hidden = true; panel.setAttribute('aria-label', 'Монтажная правка');
  panel.innerHTML = `<div class="ge-head"><strong>Монтажная правка</strong><button id="geUndo" title="Отменить правку">↶</button><button id="geRedo" title="Повторить правку">↷</button><button id="geDone" class="ge-primary">Готово</button><button id="geClose" aria-label="Закрыть, сохранив черновик">×</button></div>
    <div class="ge-body"><div class="ge-row"><label>Контур<select id="geCircuit"></select></label><label>Часть трубы<select id="gePart"><option value="heating">Рабочая часть</option><option value="supply">Подающий подвод</option><option value="return">Обратный подвод</option></select></label></div>
    <p id="geSelection" class="ge-hint"></p><div class="ge-row ge-actions"><button id="geMinus">← ячейка</button><button id="gePlus">ячейка →</button><button id="geDelete">Удалить</button><button id="geRestore">Восстановить</button></div>
    <div id="geDrawing" hidden><p class="ge-hint">Нажимайте узлы по порядку: следующий — на одной горизонтали или вертикали с предыдущим. Конец отмечен синим.</p><div class="ge-row"><button id="gePointUndo">Убрать точку</button><button id="geApplyPath" class="ge-primary">Применить замену</button><button id="geCancelPath">Отменить рисование</button></div></div>
    <p id="geReport" role="status"></p><button id="geRecheck" hidden>Проверить с текущими параметрами</button>
    <details id="geMore"><summary>Выбор участка и другие действия</summary><label>Прямой участок<select id="geEdge"></select></label><div class="ge-row"><button id="geRange">Выделить до другого участка</button><button id="geConnect">Соединить концы</button><button id="geDraw">Нарисовать замену</button><button id="geReverse">Поменять подачу и обратку</button></div>
    <div class="ge-row"><label>Способ укладки<select id="geMethod"><option value="spiral">Улитка</option><option value="double-snake">Двойная змейка</option><option value="auto">Авто</option></select></label><button id="geReplan">Перестроить этот контур</button><button id="geCancelSearch" hidden>Остановить поиск</button></div><p class="ge-hint">Перестроение заменяет правки только выбранного контура. Его можно отменить. Радиус, шаг и отступ сохраняются.</p><div class="ge-row"><button id="geRollback">Откатить правки сеанса</button><button id="geSave">Сохранить черновик</button></div></details></div>`;
  document.querySelector('#editorView .workspace').append(panel);
  let pan = false, panGesture = null;
  const panButton = document.createElement('button'); panButton.id = 'gePan'; panButton.textContent = '↔'; panButton.title = 'Перемещать вид'; panButton.setAttribute('aria-label', 'Перемещать вид'); panButton.setAttribute('aria-pressed', 'false');
  panel.querySelector('.ge-head').insertBefore(panButton, el('geUndo'));
  panButton.onclick = () => {pan = !pan; panGesture = null; panButton.setAttribute('aria-pressed', String(pan)); setStatus(pan ? 'Перетаскивайте план. Кнопка ↔ вернёт выбор трубы.' : 'Коснитесь участка трубы для правки.');};
  const resume = document.createElement('button'); resume.id = 'resumeGridDraftV34'; resume.className = 'secondary-btn'; resume.textContent = 'Продолжить монтажный черновик'; resume.hidden = true; el('homeView').querySelector('.hero').append(resume);
  const selectedId = () => selection?.id || el('geCircuit').value || edit?.draft.circuits[0]?.id;
  function snapshot() {return copy(edit);}
  function saveDraft(notify = false) {
    clearTimeout(saveTimer); if (!edit) return false;
    try {localStorage.setItem(DRAFT_KEY, JSON.stringify({raw: serializeState(), undo: undo.slice(-20), redo: redo.slice(-20)})); resume.hidden = false; if (notify) setStatus('Монтажный черновик сохранён.'); return true;}
    catch {setStatus('Черновик не сохранился: проверьте свободное место в памяти браузера.', true); return false;}
  }
  function scheduleSave() {clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDraft(), 250);}
  function cancelWorker() {generation++; worker?.terminate(); worker = null; cancelPending?.(); cancelPending = null;}
  function refresh() {reportKey = ''; renderPlan(); renderPanel(); scheduleSave();}
  function change(result) {
    if (!edit) return;
    if (stale()) {setStatus(messages.CONTEXT_CHANGED, true); return;}
    if (!result.ok) {setStatus(message(result.reason), true); return;}
    cancelWorker(); undo.push(snapshot()); if (undo.length > 30) undo.shift(); redo = [];
    edit.draft = result.draft; edit.committed = false; syncDefinitions(); edit.context = contextKey(); selection = result.selection || selection; refresh();
  }
  function history(back) {
    cancelWorker(); const from = back ? undo : redo, to = back ? redo : undo; if (!from.length || !edit) return;
    const next = from.pop(); try {E.check(next.draft);} catch {setStatus(messages.INVALID_DRAFT, true); return;}
    to.push(snapshot()); edit = copy(next); syncDefinitions(); selection = null; drawing = null; rangeStart = null; refresh();
  }
  function enter() {
    if (active) return; if (WarmEditor.active) manualExitV2A();
    if (!edit) {
      try {const source = WarmV330.plan, draft = E.create(project(), state.circuitSettingsV32, WarmV330.definitions, source);
        resetRoute(); edit = {draft, context: '', committed: !!source.ok && source.status !== 'MULTI_PARTIAL'}; syncDefinitions(); edit.context = contextKey(); undo = []; redo = [];
      } catch (e) {setStatus(message(e.message), true); return;}
    }
    baseline = snapshot(); active = true; state.mode = 'inspect'; closeSheetV5(); rangeStart = null;
    pan = false; panButton.setAttribute('aria-pressed', 'false'); document.body.classList.add('grid-editor-active-v34'); panel.hidden = false; fitPlan(false); renderPanel(); renderPlan(); scheduleSave();
    setStatus('Коснитесь прямого участка. Сдвиг — на одну монтажную ячейку. Ошибки можно сохранить в черновике.');
  }
  function leave(finish) {
    if (!edit) return true;
    if (finish && drawing) {setStatus('Примените замену или отмените рисование.', true); return false;}
    const r = inspect(); if (finish && !r.ok) {setStatus(message(r.issues[0]?.code), true); renderPanel(); return false;}
    cancelWorker(); if (finish) edit.committed = true; active = false; panel.hidden = true; document.body.classList.remove('grid-editor-active-v34');
    fitPlan(false); renderPlan(); saveDraft(); setStatus(finish ? `Правка завершена. Всего ${metres(r.lengthMm)}.${r.warnings.length ? ' Есть контуры длиннее 80 м.' : ''}` : 'Черновик сохранён. Кнопка «Правка» продолжит редактирование.'); return true;
  }
  function renderPanel() {
    panel.hidden = !active; if (!edit || !active) return;
    const id = selectedId(), select = el('geCircuit'); select.replaceChildren(...edit.draft.definitions.map(d => new Option(d.name, d.id))); select.value = id;
    if (!select.value) select.selectedIndex = 0;
    const c = edit.draft.circuits.find(c => c.id === select.value), part = selection?.part || el('gePart').value; el('gePart').value = part;
    const route = c.paths[part], edges = el('geEdge'); edges.replaceChildren(new Option('Выберите на плане или в списке', ''));
    route.slice(1).forEach((b, i) => edges.add(new Option(`${i + 1}. ${metres(Math.hypot(b.x - route[i].x, b.y - route[i].y))}${c.disabled[part].includes(i) ? ' · удалён' : ''}`, String(i))));
    edges.value = selection ? String(selection.start) : '';
    el('geSelection').textContent = drawing ? `Замена: отмечено ${drawing.points.length} точек.` : rangeStart ? 'Коснитесь последнего участка выделения в этой же части трубы.' : selection ? `${partNames[selection.part]} · участки ${selection.start + 1}–${selection.end}` : 'Коснитесь прямого участка трубы.';
    const horizontal = selection && route[selection.start]?.y === route[selection.start + 1]?.y;
    el('geMinus').textContent = horizontal ? '↑ ячейка' : '← ячейка'; el('gePlus').textContent = horizontal ? '↓ ячейка' : 'ячейка →';
    for (const id of ['geMinus', 'gePlus', 'geDelete', 'geRestore', 'geRange', 'geConnect', 'geDraw']) el(id).disabled = !selection || !!drawing || !!worker || stale();
    el('geUndo').disabled = !undo.length; el('geRedo').disabled = !redo.length; el('geDrawing').hidden = !drawing;
    el('geReplan').disabled = !!worker || !!drawing || stale(); el('geReverse').disabled = !!worker || !!drawing || stale(); el('geCancelSearch').hidden = !worker;
    const r = inspect(); el('geRecheck').hidden = !stale();
    const lines = r.circuits.map(item => `${edit.draft.definitions.find(d => d.id === item.id)?.name}: ${metres(item.lengthMm)}${item.lengthMm > 80000 ? ' — более 80 м' : ''}`);
    const unique = [...new Set(r.issues.map(i => message(i.code)))];
    el('geReport').textContent = (r.ok ? 'Геометрия проверена. ' : 'Черновик: есть ошибки. ') + lines.join(' · ') + (unique.length ? '\n' + unique.join('\n') : '');
    el('geReport').classList.toggle('ge-invalid', !r.ok);
  }
  const renderBase = renderPlan;
  renderPlan = function(...args) {
    renderBase(...args);
    if (!edit) {if (WarmV330.plan?.scope === 'complete') {el('manualToolBtn').disabled = false; el('manualToolBtn').title = 'Правка сеточных контуров';} else if (WarmV330.plan?.scope === 'heating') el('manualToolBtn').title = messages.FULL_CIRCUIT_REQUIRED; return;}
    const r = inspect(); state.routeComplete = !!edit.committed && r.ok;
    el('manualToolBtn').disabled = false; el('manualToolBtn').title = 'Продолжить монтажную правку';
    planSvg.querySelectorAll('.grid-circuit-v32,.grid-circuit-v33').forEach(n => n.remove());
    const scale = state.scale || .1, width = state.pipeRenderMode === 'scheme' ? 2.5 / scale : state.pipeDiameterMm;
    for (const c of edit.draft.circuits) {
      const item = r.circuits.find(x => x.id === c.id), invalid = r.issues.some(x => x.id === c.id || x.id === null), segments = item?.preview || [];
      let travelled = 0;
      // Separate SVG primitives keep deleted spans visibly open, never bridge a gap.
      const paths = segments.map(s => {const color = invalid ? '#d92b56' : s.part === 'supply' ? '#dc4c43' : s.part === 'return' ? '#2673c7' : travelled < (item.lengthMm || Infinity) / 2 ? '#dc4c43' : '#2673c7'; travelled += s.lengthMm; return `<path class="ge-pipe${invalid ? ' ge-bad' : ''}" d="${S.svgPath([s])}" fill="none" stroke="${color}" stroke-width="${width}" ${s.part !== 'heating' ? `stroke-dasharray="${5 / scale} ${3 / scale}"` : ''}/>`;}).join('');
      let gaps = '';
      for (const part of E.parts) for (const i of c.disabled[part]) {const a = c.paths[part][i], b = c.paths[part][i + 1]; gaps += `<path class="ge-gap" d="M${a.x},${a.y}L${b.x},${b.y}" fill="none" stroke="#d92b56" stroke-width="${1.5 / scale}" stroke-dasharray="${3 / scale} ${4 / scale}"/><circle cx="${a.x}" cy="${a.y}" r="${4 / scale}" fill="white" stroke="#d92b56"/><circle cx="${b.x}" cy="${b.y}" r="${4 / scale}" fill="white" stroke="#d92b56"/>`;}
      planSvg.insertAdjacentHTML('beforeend', `<g class="grid-manual-v34" pointer-events="none">${paths}${gaps}</g>`);
    }
    if (active && selection) {
      const c = edit.draft.circuits.find(c => c.id === selection.id), route = c?.paths[selection.part];
      if (route?.[selection.end]) {const span = route.slice(selection.start, selection.end + 1), a = span[0], b = span.at(-1);
        planSvg.insertAdjacentHTML('beforeend', `<g class="ge-selection" pointer-events="none"><path d="M${span.map(p => `${p.x},${p.y}`).join('L')}" fill="none" stroke="#e9a000" stroke-width="${6 / scale}" opacity=".55"/><circle cx="${a.x}" cy="${a.y}" r="${5 / scale}" fill="#13a463"/><circle cx="${b.x}" cy="${b.y}" r="${5 / scale}" fill="#275dd5"/></g>`);
      }
    }
    if (active && drawing?.points.length) planSvg.insertAdjacentHTML('beforeend', `<path class="ge-drawing" pointer-events="none" d="M${drawing.points.map(p => `${p.x},${p.y}`).join('L')}" fill="none" stroke="#e9a000" stroke-width="${3 / scale}"/>`);
    el('gridInfo').textContent = el('routeInfo').textContent = `${state.routeComplete ? 'Ручная схема проверена' : 'Монтажный черновик'} · ${metres(r.lengthMm)}${r.warnings.length ? ' · есть превышение 80 м' : ''}`;
  };
  function choose(hit) {
    if (!hit) {setStatus('Коснитесь прямого участка выбранного контура.', true); return;}
    if (rangeStart && rangeStart.id === hit.id && rangeStart.part === hit.part) selection = {...hit, start: Math.min(rangeStart.start, hit.start), end: Math.max(rangeStart.end, hit.end)};
    else selection = {id: hit.id, part: hit.part, start: hit.start, end: hit.end};
    rangeStart = null; renderPanel(); renderPlan();
  }
  planSvg.addEventListener('pointerdown', e => {
    if (!active || worker) return;
    if (pan) {e.preventDefault(); e.stopImmediatePropagation(); panGesture = {x: e.clientX, y: e.clientY, left: diagramScroll.scrollLeft, top: diagramScroll.scrollTop}; planSvg.setPointerCapture(e.pointerId); return;}
    e.preventDefault(); e.stopImmediatePropagation(); const pt = planSvg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(planSvg.getScreenCTM().inverse());
    if (drawing) {
      const {path} = E.selection(edit.draft, drawing.selection), end = path[drawing.selection.end], last = drawing.points.at(-1), {cellSizeMm: step, origin} = project().grid;
      let q = {x: origin.x + Math.round((p.x - origin.x) / step) * step, y: origin.y + Math.round((p.y - origin.y) / step) * step};
      if (Math.hypot(p.x - end.x, p.y - end.y) < 14 / state.scale) q = copy(end);
      else if (drawing.selection.part !== 'heating') {if (Math.abs(p.x - last.x) < step / 2) q.x = last.x; if (Math.abs(p.y - last.y) < step / 2) q.y = last.y;}
      if (Math.abs(q.x - last.x) > 1e-6 && Math.abs(q.y - last.y) > 1e-6) {setStatus('Добавьте угол: следующая точка должна лежать на одной горизонтали или вертикали с предыдущей.', true); return;}
      if (Math.hypot(q.x - last.x, q.y - last.y) > 1e-6) drawing.points.push(q);
      renderPanel(); renderPlan(); scheduleSave(); return;
    }
    choose(E.nearest(edit.draft, p, 14 / (state.scale || .1), el('geCircuit').value, el('gePart').value)[0]);
  }, true);
  planSvg.addEventListener('pointermove', e => {if (!active || !panGesture) return; e.preventDefault(); e.stopImmediatePropagation(); diagramScroll.scrollLeft = panGesture.left - (e.clientX - panGesture.x); diagramScroll.scrollTop = panGesture.top - (e.clientY - panGesture.y);}, true);
  for (const type of ['pointerup', 'pointercancel']) planSvg.addEventListener(type, () => {panGesture = null;}, true);
  for (const type of ['pointerup', 'click']) planSvg.addEventListener(type, e => {if (active) {e.preventDefault(); e.stopImmediatePropagation();}}, true);
  el('geCircuit').onchange = el('gePart').onchange = () => {selection = null; rangeStart = null; drawing = null; renderPanel(); renderPlan();};
  el('geEdge').onchange = () => {if (el('geEdge').value !== '') choose({id: el('geCircuit').value, part: el('gePart').value, start: Number(el('geEdge').value), end: Number(el('geEdge').value) + 1});};
  el('geMinus').onclick = () => change(E.shift(edit.draft, selection, -1, project().grid)); el('gePlus').onclick = () => change(E.shift(edit.draft, selection, 1, project().grid));
  el('geDelete').onclick = () => change(E.toggle(edit.draft, selection, false)); el('geRestore').onclick = () => change(E.toggle(edit.draft, selection, true));
  el('geConnect').onclick = () => change(E.connect(project(), edit.draft, selection));
  el('geRange').onclick = () => {rangeStart = copy(selection); el('geMore').open = false; renderPanel();};
  el('geDraw').onclick = () => {edit.committed = false; drawing = {selection: copy(selection), points: [copy(E.selection(edit.draft, selection).path[selection.start])]}; el('geMore').open = false; renderPanel(); renderPlan(); scheduleSave();};
  el('geCancelPath').onclick = () => {drawing = null; renderPanel(); renderPlan(); scheduleSave();};
  el('gePointUndo').onclick = () => {if (drawing.points.length > 1) drawing.points.pop(); renderPanel(); renderPlan(); scheduleSave();};
  el('geApplyPath').onclick = () => {const result = E.replace(edit.draft, drawing.selection, drawing.points); if (result.ok) drawing = null; change(result);};
  el('geReverse').onclick = () => {const result = E.reverse(edit.draft, selectedId()); selection = null; change(result);};
  el('geUndo').onclick = () => history(true); el('geRedo').onclick = () => history(false); el('geDone').onclick = () => leave(true); el('geClose').onclick = () => leave(false); el('geSave').onclick = () => saveDraft(true);
  el('geRollback').onclick = () => {if (baseline) {undo.push(snapshot()); edit = copy(baseline); syncDefinitions(); selection = null; drawing = null; redo = []; refresh();}};
  el('geRecheck').onclick = () => {
    undo.push(snapshot()); const defs = WarmV330.definitions;
    edit.draft.definitions = copy(defs); edit.draft.settings = copy(state.circuitSettingsV32);
    edit.draft.circuits = defs.map(d => edit.draft.circuits.find(c => c.id === d.id) || {id: d.id, method: 'manual', paths: {supply: [], heating: [], return: []}, disabled: {supply: [], heating: [], return: []}});
    edit.context = contextKey(); edit.committed = false; selection = null; drawing = null; redo = []; refresh();
  };
  el('geCancelSearch').onclick = () => {cancelWorker(); renderPanel(); setStatus('Поиск остановлен. Правки сохранены.');};
  el('geReplan').onclick = async () => {
    if (worker || stale()) return; const request = ++generation, key = contextKey(), id = selectedId();
    const work = new Promise((resolve, reject) => {const w = worker = new Worker('./grid-editor-worker.js?v=340'); const timer = setTimeout(() => finish(new Error('TIMEOUT')), 30000);
      const finish = (error, data) => {clearTimeout(timer); w.terminate(); if (worker === w) {worker = null; cancelPending = null;} error ? reject(error) : resolve(data);};
      cancelPending = () => finish(null, null); w.onmessage = e => finish(null, e.data); w.onerror = () => finish(new Error('CALCULATION_FAILED'));
      w.postMessage({project: project(), draft: copy(edit.draft), id, method: el('geMethod').value});
    });
    renderPanel(); setStatus('Перестраиваю выбранный контур…', false, {kind: 'progress'});
    try {const result = await work; if (request !== generation || !edit) return; if (key !== contextKey()) {setStatus(messages.CONTEXT_CHANGED, true); return;} if (result?.ok) {E.check(result.draft); selection = null;} change(result || {ok: false});}
    catch (e) {if (request === generation) setStatus(message(e.message), true);} finally {renderPanel();}
  };
  // Window capture runs before the older editor's document capture handlers.
  window.addEventListener('click', e => {
    const id = e.target.closest('button')?.id;
    if (id === 'manualToolBtn' && (edit || WarmV330.plan)) {e.preventDefault(); e.stopImmediatePropagation(); enter(); return;}
    if (active && id === 'undoBtn') {e.preventDefault(); e.stopImmediatePropagation(); history(true); return;}
    if (active && ['backBtn', 'shapeToolBtn', 'collectorToolBtn', 'settingsBtn', 'generateBtn', 'obstacleToolBtn'].includes(id)) leave(false);
    if (edit && ['calculateSpiralV31', 'legacyCalculationV31'].includes(id)) {saveDraft(); cancelWorker(); active = false; edit = null; drawing = null; panel.hidden = true; document.body.classList.remove('grid-editor-active-v34');}
  }, true);
  window.addEventListener('keydown', e => {if (!active || e.target.matches('input,textarea,select')) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {e.preventDefault(); e.stopImmediatePropagation(); history(!e.shiftKey);} if (e.key === 'Escape') {drawing = null; rangeStart = null; renderPanel(); renderPlan();}}, true);
  const resetBase = resetRoute;
  resetRoute = function(...args) {cancelWorker(); if (edit) {edit.committed = false; active = false; panel.hidden = true; document.body.classList.remove('grid-editor-active-v34'); scheduleSave();} return resetBase(...args);};
  const serializeBase = serializeState;
  serializeState = function() {
    const raw = serializeBase(); raw.versionLabel = '3.4.0';
    if (edit) {
      raw.gridEditV34 = {...copy(edit), scratch: {selection: copy(selection), drawing: copy(drawing)}};
      const r = inspect(); raw.routeComplete = !!edit.committed && r.ok && !drawing; raw.route = [];
      for (const key of ['gridCircuitPlanV32', 'gridSpiralPlanV31', 'multiPlanV33', 'unifiedPlan', 'editorDraft', 'manualPlanV2']) delete raw[key];
      raw.projectV3.circuits = r.circuits.filter(c => c.valid).map(c => copy(c.circuit)); raw.projectV3.circuitDefinitions = copy(edit.draft.definitions);
      raw.projectV3.collector.portPairs = edit.draft.definitions.map(d => ({circuitId: d.id, supply: copy(d.supply), returnPoint: copy(d.returnPoint)}));
    }
    return raw;
  };
  const loadBase = loadScheme;
  loadScheme = function(raw) {
    cancelWorker(); clearTimeout(saveTimer); active = false; edit = null; selection = null; drawing = null; undo = []; redo = []; panel.hidden = true; document.body.classList.remove('grid-editor-active-v34');
    loadBase(raw);
    if (raw.gridEditV34) {
      try {
        E.check(raw.gridEditV34.draft); if (typeof raw.gridEditV34.context !== 'string') throw new Error('INVALID_DRAFT');
        edit = {draft: copy(raw.gridEditV34.draft), context: raw.gridEditV34.context, committed: raw.gridEditV34.committed === true}; reportKey = '';
        const r = inspect(); edit.committed = edit.committed && r.ok; state.routeComplete = edit.committed;
        const scratch = raw.gridEditV34.scratch; if (scratch?.selection) {try {E.selection(edit.draft, scratch.selection); selection = copy(scratch.selection);} catch {}}
        if (scratch?.drawing && Array.isArray(scratch.drawing.points) && scratch.drawing.points.length && scratch.drawing.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {try {E.selection(edit.draft, scratch.drawing.selection); drawing = copy(scratch.drawing);} catch {}}
        if (drawing) {edit.committed = false; state.routeComplete = false;}
        setStatus(edit.committed ? 'Открыта проверенная ручная схема.' : 'Открыт монтажный черновик. Продолжить — кнопкой «Правка».');
      } catch {edit = null; state.routeComplete = false; setStatus(messages.INVALID_DRAFT, true);}
    }
    renderPlan();
  };
  const newBase = newScheme;
  newScheme = function(...args) {if (edit) saveDraft(); cancelWorker(); clearTimeout(saveTimer); edit = null; active = false; selection = drawing = null; panel.hidden = true; document.body.classList.remove('grid-editor-active-v34'); return newBase(...args);};
  WarmV300.project = function(...args) {const p = projectBase(...args); if (edit) {const r = inspect(); p.circuits = r.circuits.filter(c => c.valid).map(c => copy(c.circuit)); p.circuitDefinitions = copy(edit.draft.definitions); p.collector.portPairs = edit.draft.definitions.map(d => ({circuitId: d.id, supply: copy(d.supply), returnPoint: copy(d.returnPoint)}));} return p;};
  resume.onclick = () => {try {const saved = JSON.parse(localStorage.getItem(DRAFT_KEY)); if (!saved?.raw?.gridEditV34) return; loadScheme(saved.raw); if (!edit) return; enter(); undo = Array.isArray(saved.undo) ? saved.undo.slice(-20) : []; redo = Array.isArray(saved.redo) ? saved.redo.slice(-20) : []; renderPanel();} catch {setStatus(messages.INVALID_DRAFT, true);}};
  try {resume.hidden = !JSON.parse(localStorage.getItem(DRAFT_KEY))?.raw?.gridEditV34;} catch {}
  addEventListener('pagehide', () => {if (edit) saveDraft();});
  const exportBase = exportPng;
  exportPng = async function() {
    if (!edit) return exportBase();
    renderPlan(); const r = inspect(), lines = [state.routeComplete ? 'Warm 3.4 · ручная схема проверена' : 'Warm 3.4 · ЧЕРНОВИК — не завершён', ...r.circuits.map(c => `${edit.draft.definitions.find(d => d.id === c.id)?.name}: ${metres(c.lengthMm)}${c.lengthMm > 80000 ? ' — более 80 м' : ''}`), ...new Set(r.issues.map(i => message(i.code)))];
    const clone = planSvg.cloneNode(true), originals = [planSvg, ...planSvg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
    const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'text-anchor', 'visibility', 'display'];
    originals.forEach((n, i) => {const css = getComputedStyle(n); props.forEach(p => copies[i].style.setProperty(p, css.getPropertyValue(p)));});
    clone.querySelectorAll('.ge-selection,.ge-drawing').forEach(n => n.remove());
    const width = 1600, box = planSvg.viewBox.baseVal, height = Math.round(width * box.height / box.width); clone.setAttribute('xmlns', SVG_NS); clone.setAttribute('width', width); clone.setAttribute('height', height);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type: 'image/svg+xml;charset=utf-8'}));
    try {const img = new Image(); await new Promise((resolve, reject) => {img.onload = resolve; img.onerror = reject; img.src = url;}); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height + 36 + lines.length * 30;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, width, height); ctx.fillStyle = '#172534'; ctx.font = '20px sans-serif'; lines.forEach((s, i) => ctx.fillText(s, 24, height + 30 + i * 30, width - 48));
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!png) throw new Error(); const download = URL.createObjectURL(png), a = document.createElement('a'); a.href = download; a.download = `${state.name || 'warm-3.4'}${state.routeComplete ? '' : '-draft'}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(download), 1500); setStatus('Изображение сохранено.');
    } catch {setStatus('Не удалось создать изображение.', true);} finally {URL.revokeObjectURL(url);}
  };
  document.title = 'Тёплый пол — V3.4'; document.querySelector('.eyebrow').textContent = 'V3.4 · монтажная правка';
  globalThis.WarmV340 = {enter, leave, saveDraft, get active() {return active;}, get draft() {return edit ? copy(edit.draft) : null;}, get report() {return inspect();}, get selection() {return copy(selection);}, get busy() {return !!worker;}};
})();
