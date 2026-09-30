/* Warm 3.3 extends the working 3.2 editor. Draft zones are independent of Room. */
(() => {
  'use strict';
  const M = WarmMulti, S = WarmSpiral, copy = x => structuredClone(x), el = id => document.getElementById(id);
  const initial = () => [{id: 'grid-circuit-1', name: 'Контур 1', zone: null, portsFromMain: true, supply: null, returnPoint: null}];
  state.circuitDefinitionsV33 = initial(); state.multiPlanV33 = null;
  let selected = 'grid-circuit-1', savedKey = '', generation = 0, worker = null, cancelPending = null, picking = null;
  const current = () => state.circuitDefinitionsV33.find(d => d.id === selected) || state.circuitDefinitionsV33[0];
  const definitions = () => state.circuitDefinitionsV33.map(d => ({id: d.id, name: d.name, zone: copy(d.zone),
    supply: copy(d.portsFromMain ? state.supply : d.supply), returnPoint: copy(d.portsFromMain ? state.returnPoint : d.returnPoint)}));
  const project = () => WarmV300.project();
  const signature = () => {const p = project(); return JSON.stringify([p.room, p.grid, p.exclusions, p.pipe, definitions(), state.circuitSettingsV32]);};
  const metre = mm => (mm / 1000).toFixed(1).replace('.', ','), area = mm => (mm / 1e6).toFixed(2).replace('.', ',');
  const errors = {
    ZONES_REQUIRED: 'Для нескольких контуров выделите отдельную зону каждому. Нажмите «Выбрать зону на плане».',
    INVALID_ZONE: 'У зоны должны быть положительные ширина и высота.', EMPTY_ZONE: 'Одна из зон не попадает в доступную часть комнаты.',
    ZONES_OVERLAP: 'Рабочие зоны перекрываются. Измените их границы.', COLLECTOR_REQUIRED: 'Укажите координаты подачи и обратки этого контура.',
    COINCIDENT_PORTS: 'Подача и обратка совпадают. Укажите две разные точки.', COLLECTOR_OUTSIDE: 'Точка подачи или обратки вне комнаты либо в исключении.',
    NO_COMPLETE_CIRCUIT: 'Маршрут с подводами не найден. Проверьте зону, точки коллектора и пересечения с предыдущими контурами.',
    DISCONNECTED_OR_EMPTY_GRID: 'В зоне нет связной сетки. Проверьте размер, проходы, шаг и отступ.',
    RADIUS_DOES_NOT_FIT: 'Радиус не помещается между проходами. Проверьте радиус и шаг.', RADIUS_REQUIRED: 'Введите радиус поворота.',
    INVALID_SPACING: 'Шаг должен быть целым числом ячеек не меньше одной.', INVALID_OFFSET: 'Отступ должен быть неотрицательным числом.',
    SEARCH_LIMIT: 'Поиск этого контура исчерпал время. Измените его зону или точки подключения.', AREA_TOO_LARGE: 'Зона слишком велика для одного расчёта.',
    TIMEOUT: 'Расчёт контура не завершился. Измените параметры и повторите.', CIRCUIT_INTERSECTION: 'Обнаружено пересечение контуров.'
  };
  const reason = code => errors[code] || 'Проверьте параметры и повторите расчёт.';
  const title = p => `${p.complete ? 'Готово' : 'Схема не завершена'} · контуров ${p.circuits.length} из ${p.definitions.length} · всего ${metre(p.lengthMm)} м с подводами`;
  function description(p) {
    return p.results.map((r, i) => {
      const d = p.definitions[i], c = r.plan?.circuits[0];
      return c ? `${d.name}: ${metre(c.lengthMm)} м${c.lengthMm > 80000 ? ' — превышает 80 м' : ''}; подача ${metre(c.supplyTransit.lengthMm)}, рабочая часть ${metre(c.heating.lengthMm)}, обратка ${metre(c.returnTransit.lengthMm)} м.` : `${d.name}: ${reason(r.reason)}`;
    }).concat(p.coverage.unassignedAreaMm2 > 1e-6 ? [`Без рабочей зоны: ${area(p.coverage.unassignedAreaMm2)} м².`] : []);
  }
  const host = el('spiralSheetV31');
  host.querySelector('.sheet-head strong').textContent = 'Контуры по сетке';
  host.setAttribute('aria-label', 'Контуры по сетке');
  const section = document.createElement('div'); section.className = 'circuits-v33';
  section.innerHTML = `<div class="circuit-toolbar-v33"><label>Рабочий контур<select id="circuitSelectV33"></select></label><button id="addCircuitV33" class="secondary-btn" type="button">+ Добавить контур</button></div>
    <label>Название<input id="circuitNameV33" maxlength="80" placeholder="Название контура"></label>
    <p id="zoneInfoV33" class="sheet-help"></p>
    <div class="circuit-toolbar-v33"><button id="pickZoneV33" class="secondary-btn" type="button">Выбрать зону на плане</button><button id="wholeZoneV33" class="secondary-btn" type="button">Вся комната</button></div>
    <details><summary>Точные границы зоны, м</summary><div class="settings-grid"><label>X начала<input id="zoneXV33" type="number" step="0.001"></label><label>Y начала<input id="zoneYV33" type="number" step="0.001"></label><label>Ширина<input id="zoneWV33" type="number" min="0.001" step="0.001"></label><label>Высота<input id="zoneHV33" type="number" min="0.001" step="0.001"></label></div></details>
    <details id="portsDetailsV33"><summary>Подача и обратка этого контура</summary><p class="sheet-help">Координаты в метрах от начала плана: X вправо, Y вниз. Укажите фактические точки подключения. Расстояние между выходами автоматически не назначается.</p><div class="settings-grid"><label>Подача X<input id="supplyXV33" type="number" step="0.001"></label><label>Подача Y<input id="supplyYV33" type="number" step="0.001"></label><label>Обратка X<input id="returnXV33" type="number" step="0.001"></label><label>Обратка Y<input id="returnYV33" type="number" step="0.001"></label></div><button id="copyPortsV33" class="secondary-btn wide" type="button">Взять точки установленного коллектора</button></details>
    <div class="circuit-toolbar-v33"><button id="earlierCircuitV33" class="secondary-btn" type="button">Выше в списке</button><button id="laterCircuitV33" class="secondary-btn" type="button">Ниже в списке</button></div>
    <button id="removeCircuitV33" class="secondary-btn wide top-gap" type="button">Удалить выбранный контур</button>
    <p class="sheet-help">Зоны выбираются двумя углами и обрезаются по форме комнаты. Подводы могут идти за пределами своей зоны. Параметры укладки ниже общие для всех контуров.</p><div id="circuitResultsV33" role="status"></div>`;
  host.querySelector('.settings-grid').before(section);
  const stop = document.createElement('button'); stop.id = 'stopCalculationV33'; stop.className = 'secondary-btn wide top-gap'; stop.type = 'button'; stop.textContent = 'Остановить расчёт';
  host.querySelector('.sheet-head').after(stop);
  stop.onclick = () => {resetRoute(); renderPlan(); setStatus('Расчёт остановлен. Зоны и параметры сохранены.');};
  function sync() {
    const d = current(); selected = d.id;
    const select = el('circuitSelectV33'); select.replaceChildren(...state.circuitDefinitionsV33.map(c => new Option(c.name, c.id))); select.value = d.id;
    el('circuitNameV33').value = d.name;
    el('removeCircuitV33').disabled = state.circuitDefinitionsV33.length === 1;
    el('wholeZoneV33').disabled = state.circuitDefinitionsV33.length > 1;
    const index = state.circuitDefinitionsV33.indexOf(d);
    el('earlierCircuitV33').disabled = index === 0; el('laterCircuitV33').disabled = index === state.circuitDefinitionsV33.length - 1;
    el('zoneInfoV33').textContent = d.zone ? `Зона: ${metre(d.zone.width)} × ${metre(d.zone.height)} м. X ${metre(d.zone.x)}, Y ${metre(d.zone.y)} м.` : (state.circuitDefinitionsV33.length === 1 ? 'Рабочая зона — вся комната.' : 'Рабочая зона пока не выбрана.');
    for (const [id, key] of [['zoneXV33', 'x'], ['zoneYV33', 'y'], ['zoneWV33', 'width'], ['zoneHV33', 'height']]) el(id).value = d.zone ? d.zone[key] / 1000 : '';
    const ports = definitions().find(c => c.id === d.id);
    for (const [id, port, axis] of [['supplyXV33', 'supply', 'x'], ['supplyYV33', 'supply', 'y'], ['returnXV33', 'returnPoint', 'x'], ['returnYV33', 'returnPoint', 'y']]) el(id).value = ports[port]?.[axis] != null ? ports[port][axis] / 1000 : '';
    el('calculateSpiralV31').textContent = `Построить: ${state.circuitDefinitionsV33.length} контур(а)`;
    if (!globalThis.WarmV330?.plan) el('spiralResultV31').textContent = 'Число контуров и зоны задаются вручную. В режиме «Авто» сначала проверяется улитка, затем двойная змейка.';
    results();
  }
  function results() {
    const list = el('circuitResultsV33'); list.replaceChildren();
    if (!state.multiPlanV33) return;
    for (const text of [title(state.multiPlanV33), ...description(state.multiPlanV33)]) {const p = document.createElement('p'); p.textContent = text; list.append(p);}
  }
  function cancel() {generation++; worker?.terminate(); worker = null; cancelPending?.(); cancelPending = null;}
  const resetBase = resetRoute;
  resetRoute = function(...args) {cancel(); state.multiPlanV33 = null; savedKey = ''; results(); return resetBase(...args);};
  function change(fn) {pushHistoryV5(); fn(); resetRoute(); sync(); renderPlan();}
  el('circuitSelectV33').onchange = () => {selected = el('circuitSelectV33').value; sync(); renderPlan();};
  el('addCircuitV33').onclick = () => change(() => {
    let n = state.circuitDefinitionsV33.length + 1; while (state.circuitDefinitionsV33.some(c => c.id === `circuit-${n}`)) n++;
    selected = `circuit-${n}`; state.circuitDefinitionsV33.push({id: selected, name: `Контур ${n}`, zone: null, portsFromMain: false, supply: null, returnPoint: null}); el('portsDetailsV33').open = true;
  });
  el('removeCircuitV33').onclick = () => {if (state.circuitDefinitionsV33.length > 1) change(() => {state.circuitDefinitionsV33 = state.circuitDefinitionsV33.filter(c => c.id !== current().id); selected = state.circuitDefinitionsV33[0].id;});};
  for (const [id, shift] of [['earlierCircuitV33', -1], ['laterCircuitV33', 1]]) el(id).onclick = () => {
    const index = state.circuitDefinitionsV33.indexOf(current()), next = index + shift;
    if (next >= 0 && next < state.circuitDefinitionsV33.length) change(() => {const list = state.circuitDefinitionsV33; [list[index], list[next]] = [list[next], list[index]];});
  };
  el('circuitNameV33').onchange = () => change(() => {current().name = el('circuitNameV33').value.trim() || 'Контур';});
  el('wholeZoneV33').onclick = () => {if (state.circuitDefinitionsV33.length === 1) change(() => {current().zone = null;});};
  for (const id of ['zoneXV33', 'zoneYV33', 'zoneWV33', 'zoneHV33']) el(id).onchange = () => {
    const values = ['zoneXV33', 'zoneYV33', 'zoneWV33', 'zoneHV33'].map(key => el(key).value === '' ? null : Number(el(key).value) * 1000);
    if (values.some(v => v === null)) return;
    if (values.some(v => !Number.isFinite(v)) || values[2] <= 0 || values[3] <= 0) {setStatus(errors.INVALID_ZONE, true); return;}
    change(() => {current().zone = Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, values[i]]));});
  };
  for (const id of ['supplyXV33', 'supplyYV33', 'returnXV33', 'returnYV33']) el(id).onchange = () => {
    const read = (a, b) => el(a).value !== '' && el(b).value !== '' ? {x: Number(el(a).value) * 1000, y: Number(el(b).value) * 1000} : null;
    // Do not refresh partially entered coordinate pairs until both points are entered.
    pushHistoryV5(); current().portsFromMain = false; current().supply = read('supplyXV33', 'supplyYV33'); current().returnPoint = read('returnXV33', 'returnYV33'); resetRoute(); renderPlan();
  };
  el('copyPortsV33').onclick = () => change(() => {current().portsFromMain = false; current().supply = copy(state.supply); current().returnPoint = copy(state.returnPoint);});
  el('pickZoneV33').onclick = () => {picking = {id: current().id, first: null}; closeSheetV5(); setStatus('Укажите два противоположных угла зоны. «Расчёт» или Esc отменяет выбор.');};
  planSvg.addEventListener('pointerdown', event => {
    if (!picking) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const p = planSvg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const world = p.matrixTransform(planSvg.getScreenCTM().inverse()), {cellSizeMm: step, origin} = state.mountingGridV3;
    const q = {x: origin.x + Math.round((world.x - origin.x) / step) * step, y: origin.y + Math.round((world.y - origin.y) / step) * step};
    if (!picking.first) {picking.first = q; renderPlan(); setStatus('Теперь укажите противоположный угол зоны.'); return;}
    const a = picking.first, zone = {x: Math.min(a.x, q.x), y: Math.min(a.y, q.y), width: Math.abs(a.x - q.x), height: Math.abs(a.y - q.y)};
    if (!zone.width || !zone.height) {setStatus('Выберите угол по диагонали от первой точки.', true); return;}
    const id = picking.id; picking = null; change(() => {state.circuitDefinitionsV33.find(d => d.id === id).zone = zone;}); WarmV320.open(); sync();
  }, true);
  planSvg.addEventListener('click', event => {if (picking) {event.preventDefault(); event.stopImmediatePropagation();}}, true);
  document.addEventListener('keydown', e => {if (e.key === 'Escape' && picking) {picking = null; renderPlan(); setStatus('Выбор зоны отменён.');}});
  el('generateBtn').addEventListener('click', () => {picking = null; sync(); renderPlan(); host.scrollTop = 0;});
  const renderBase = renderPlan;
  const colors = ['#8b5cf6', '#0891b2', '#db2777', '#b45309', '#059669', '#4f46e5'];
  renderPlan = function(...args) {
    renderBase(...args);
    stop.hidden = !state.engineBusyV1;
    if (state.multiPlanV33 && savedKey !== signature()) {state.multiPlanV33 = null; state.routeComplete = false; results();}
    const scale = state.scale || .1, width = state.pipeRenderMode === 'scheme' ? 2.5 / scale : state.pipeDiameterMm;
    if (picking?.first) planSvg.insertAdjacentHTML('beforeend', `<circle pointer-events="none" cx="${picking.first.x}" cy="${picking.first.y}" r="${5 / scale}" fill="#8b5cf6"/>`);
    if (state.circuitDefinitionsV33.length > 1 || current().zone) {
      state.circuitDefinitionsV33.forEach((d, i) => {if (!d.zone) return; const z = d.zone;
        planSvg.insertAdjacentHTML('beforeend', `<g class="circuit-zone-v33" pointer-events="none"><rect x="${z.x}" y="${z.y}" width="${z.width}" height="${z.height}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="${(d.id === selected ? 2 : 1) / scale}" stroke-dasharray="${6 / scale} ${4 / scale}"/><text x="${z.x + 12 / scale}" y="${z.y + 20 / scale}" fill="${colors[i % colors.length]}" font-size="${13 / scale}">${i + 1}</text></g>`);
      });
    }
    const plan = state.multiPlanV33; if (!plan || WarmEditor.active) return;
    el('manualToolBtn').disabled = true; el('manualToolBtn').title = 'Правка сеточных маршрутов — следующий этап 3.4';
    for (const c of plan.circuits) {
      const heat = c.heating, split = Math.max(0, Math.min(heat.lengthMm, c.lengthMm / 2 - c.supplyTransit.lengthMm));
      planSvg.insertAdjacentHTML('beforeend', `<g class="grid-circuit-v33" pointer-events="none"><path d="${S.svgPath(c.segments)}" fill="none" stroke="white" stroke-width="${width + 2 / scale}"/><path d="${S.pathRange(heat.segments, 0, split)}" fill="none" stroke="#dc4c43" stroke-width="${width}"/><path d="${S.pathRange(heat.segments, split, heat.lengthMm)}" fill="none" stroke="#2673c7" stroke-width="${width}"/><path class="circuit-transit-supply" d="${S.svgPath(c.supplyTransit.segments)}" fill="none" stroke="#dc4c43" stroke-width="${width}" stroke-dasharray="${5 / scale} ${3 / scale}"/><path class="circuit-transit-return" d="${S.svgPath(c.returnTransit.segments)}" fill="none" stroke="#2673c7" stroke-width="${width}" stroke-dasharray="${5 / scale} ${3 / scale}"/><circle cx="${c.supply.x}" cy="${c.supply.y}" r="${4 / scale}" fill="#dc4c43"/><circle cx="${c.returnPoint.x}" cy="${c.returnPoint.y}" r="${4 / scale}" fill="#2673c7"/></g>`);
    }
    el('gridInfo').textContent = el('routeInfo').textContent = title(plan);
    el('spiralResultV31').textContent = description(plan).join(' '); results();
  };
  function inWorker(p, settings, defs) {
    return new Promise((resolve, reject) => {
      const w = worker = new Worker('./multi-worker.js?v=340'); let timer;
      const finish = (error, result) => {clearTimeout(timer); w.terminate(); if (worker === w) {worker = null; cancelPending = null;} error ? reject(error) : resolve(result);};
      const arm = () => {clearTimeout(timer); timer = setTimeout(() => finish(new Error('TIMEOUT')), 30000);};
      cancelPending = () => finish(null, null); arm();
      w.onmessage = ({data}) => {if (data.progress) {arm(); setStatus(`Строю контур ${data.progress.index + 1} из ${data.progress.total}: ${data.progress.name}…`, false, {kind: 'progress'});} else finish(null, data.result);};
      w.onerror = () => finish(new Error('CALCULATION_FAILED')); w.postMessage({project: p, settings, definitions: defs});
    });
  }
  async function calculate() {
    if (state.engineBusyV1) return;
    const defs = definitions();
    // A whole-room circuit preserves the proven 3.2 workflow and its 3.1 migration.
    if (defs.length === 1 && defs[0].zone === null && current().portsFromMain) return WarmV320.calculate();
    if (!(state.circuitSettingsV32.radiusMm > 0)) {setStatus(errors.RADIUS_REQUIRED, true); el('spiralRadiusInput').focus(); return;}
    if (WarmEditor.active) manualExitV2A(); resetRoute(); state.editorDraft = null; state.manualV2 = blankManualStateV2A();
    const p = project(), settings = copy(state.circuitSettingsV32), key = signature(), request = ++generation;
    closeSheetV5(); state.engineBusyV1 = true; renderPlan();
    try {
      const result = await inWorker(p, settings, defs);
      if (request !== generation) return;
      if (key !== signature()) {setStatus('Параметры изменились. Повторите расчёт.', true); return;}
      if (!result?.ok) {setStatus(reason(result?.reason), true); return;}
      if (!M.validate(p, settings, defs, result).ok) {setStatus('Маршруты не прошли проверку. Повторите расчёт.', true); return;}
      state.multiPlanV33 = result; savedKey = key; state.routeComplete = result.complete;
      renderPlan(); setStatus(title(result) + (result.overLength ? ' Есть контуры длиннее 80 м.' : '') + ' Подробности — в «Расчёт».', !result.complete || result.overLength);
    } catch (e) {if (request === generation) setStatus(reason(e.message), true);}
    finally {if (request === generation) state.engineBusyV1 = false;}
  }
  const oldCalculate = el('calculateSpiralV31'); oldCalculate.replaceWith(oldCalculate.cloneNode(true)); el('calculateSpiralV31').onclick = calculate;
  const snapshotBase = snapshotV5;
  snapshotV5 = function() {return {...snapshotBase(), circuitDefinitionsV33: copy(state.circuitDefinitionsV33)};};
  el('undoBtn').addEventListener('click', () => {const s = historyV5.at(-1); if (!WarmEditor.active && s?.circuitDefinitionsV33) {state.circuitDefinitionsV33 = copy(s.circuitDefinitionsV33); resetRoute(); sync();}}, true);
  const serializeBase = serializeState;
  const projectBase = WarmV300.project;
  WarmV300.project = function(...args) {
    const p = projectBase(...args); p.circuitDefinitions = definitions();
    p.collector.portPairs = p.circuitDefinitions.map(d => ({circuitId: d.id, supply: copy(d.supply), returnPoint: copy(d.returnPoint)}));
    if (state.multiPlanV33) p.circuits = copy(state.multiPlanV33.circuits);
    else if (state.circuitPlanV32) p.circuits = copy(state.circuitPlanV32.circuits);
    return p;
  };
  serializeState = function() {
    const raw = serializeBase(); raw.versionLabel = '3.3.0'; raw.circuitDefinitionsV33 = copy(state.circuitDefinitionsV33);
    raw.projectV3.collector.portPairs = definitions().map(d => ({circuitId: d.id, supply: d.supply, returnPoint: d.returnPoint}));
    raw.projectV3.circuitDefinitions = definitions();
    if (state.multiPlanV33 && savedKey === signature()) {
      raw.multiPlanV33 = copy(state.multiPlanV33); raw.projectV3.circuits = copy(state.multiPlanV33.circuits);
      raw.route = []; raw.routeComplete = state.multiPlanV33.complete; delete raw.unifiedPlan; delete raw.editorDraft; delete raw.manualPlanV2;
    }
    return raw;
  };
  const loadBase = loadScheme;
  loadScheme = function(raw) {
    cancel(); picking = null; state.multiPlanV33 = null; savedKey = ''; state.circuitDefinitionsV33 = initial();
    loadBase(raw);
    const defs = raw.circuitDefinitionsV33;
    if (Array.isArray(defs) && defs.length && defs.every(d => d && typeof d.id === 'string' && typeof d.name === 'string' && (d.zone === null || d.zone && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(d.zone[k]))))) state.circuitDefinitionsV33 = copy(defs);
    if (state.circuitPlanV32 && !(state.circuitDefinitionsV33.length === 1 && state.circuitDefinitionsV33[0].zone === null && state.circuitDefinitionsV33[0].portsFromMain)) {
      state.circuitPlanV32 = null; state.routeComplete = false; setStatus('Зоны или точки подключения изменились. Пересчитайте контуры.', true);
    }
    if (raw.multiPlanV33) {
      state.circuitPlanV32 = null;
      const checked = M.validate(project(), state.circuitSettingsV32, definitions(), raw.multiPlanV33);
      if (checked.ok) {state.multiPlanV33 = copy(raw.multiPlanV33); savedKey = signature(); state.routeComplete = checked.complete;}
      else {state.routeComplete = false; setStatus('Сохранённые контуры не прошли проверку. Пересчитайте схему.', true);}
    }
    selected = state.circuitDefinitionsV33[0].id; sync(); renderPlan();
  };
  const newBase = newScheme;
  newScheme = function() {cancel(); picking = null; state.multiPlanV33 = null; savedKey = ''; state.circuitDefinitionsV33 = initial(); selected = 'grid-circuit-1'; newBase(); sync();};
  const exportBase = exportPng;
  exportPng = async function() {
    if (!state.multiPlanV33) return exportBase();
    renderPlan(); if (!state.multiPlanV33) {setStatus('Пересчитайте схему перед сохранением изображения.', true); return;}
    const plan = state.multiPlanV33, lines = [title(plan), ...description(plan)], clone = planSvg.cloneNode(true);
    const originals = [planSvg, ...planSvg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
    const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'visibility', 'display'];
    originals.forEach((node, i) => {const style = getComputedStyle(node); props.forEach(p => copies[i].style.setProperty(p, style.getPropertyValue(p)));});
    const width = 1600, box = planSvg.viewBox.baseVal, height = Math.round(width * box.height / box.width);
    clone.setAttribute('xmlns', SVG_NS); clone.setAttribute('width', width); clone.setAttribute('height', height);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type: 'image/svg+xml;charset=utf-8'}));
    try {
      const img = new Image(); await new Promise((resolve, reject) => {img.onload = resolve; img.onerror = reject; img.src = url;});
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height + 30 + lines.length * 30;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, width, height); ctx.fillStyle = '#172534'; ctx.font = '20px sans-serif';
      lines.forEach((line, i) => ctx.fillText(line, 24, height + 30 + i * 30, width - 48));
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!png) throw new Error('PNG_FAILED');
      const download = URL.createObjectURL(png), link = document.createElement('a'); link.href = download; link.download = `${state.name || 'warm-3.3'}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(download), 1500); setStatus('Изображение контуров сохранено.');
    } catch {setStatus('Не удалось создать изображение. Повторите экспорт.', true);} finally {URL.revokeObjectURL(url);}
  };
  document.title = 'Тёплый пол — V3.3'; document.querySelector('.eyebrow').textContent = 'V3.3 · несколько контуров';
  globalThis.WarmV330 = {calculate, get definitions() {return definitions();}, get plan() {return state.multiPlanV33 || WarmV320.plan;}};
  sync();
})();
