/* Warm 3.2: complete grid circuits with separate supply/heating/return parts. */
(() => {
  'use strict';
  const S = WarmSpiral, C = WarmCircuit, copy = value => structuredClone(value);
  const defaults = () => ({radiusMm: null, spacingCells: 1, wallOffsetMm: 100, method: 'auto'});
  state.circuitSettingsV32 = defaults(); state.circuitPlanV32 = null;
  let generation = 0, worker = null, cancelPending = null, savedKey = '';
  const project = () => WarmV300.project();
  const signature = () => {const p = project(); return JSON.stringify([p.room, p.grid, p.exclusions, p.collector, p.pipe, state.circuitSettingsV32]);};
  const messages = {
    RADIUS_REQUIRED: 'Укажите радиус поворота вручную — правила для диаметра трубы пока не заданы.',
    INVALID_SPACING: 'Шаг должен быть целым числом ячеек, не меньше одной.',
    INVALID_OFFSET: 'Отступ должен быть неотрицательным числом.',
    RADIUS_DOES_NOT_FIT: 'Заданный радиус не помещается между проходами. Увеличьте шаг по сетке или проверьте допустимый радиус трубы.',
    DISCONNECTED_OR_EMPTY_GRID: 'В этой зоне нет связной монтажной сетки для выбранного шага и отступа. Проверьте узкие проходы и отдельные участки.',
    NO_VALID_SPIRAL: 'Для этой формы и параметров корректная улитка не найдена. Проверьте проходы, исключения и шаг.',
    COLLECTOR_REQUIRED: 'Сначала установите коллектор на стене: нужны подача и обратка.',
    COINCIDENT_PORTS: 'Подача и обратка должны быть в разных точках. Перенесите коллектор.',
    COLLECTOR_OUTSIDE: 'Выход коллектора оказался вне доступной зоны или в препятствии. Перенесите коллектор.',
    NO_COMPLETE_CIRCUIT: 'Полный контур с подводами не найден. Проверьте проходы, радиус, шаг или положение коллектора.',
    SEARCH_LIMIT: 'Поиск достиг ограничения времени. Измените параметры или положение коллектора и повторите.',
    AREA_TOO_LARGE: 'Область слишком велика для одного расчёта. Разделите рабочую зону.',
    TIMEOUT: 'Расчёт не завершился за отведённое время. Уменьшите рабочую зону и повторите.'
  };
  function syncSettings() {
    $('spiralRadiusInput').value = state.circuitSettingsV32.radiusMm ?? '';
    $('spiralSpacingInput').value = state.circuitSettingsV32.spacingCells;
    $('spiralOffsetInput').value = state.circuitSettingsV32.wallOffsetMm;
    $('circuitMethodV32').value = state.circuitSettingsV32.method;
    $('spiralPitchInfo').textContent = `Сетка ${state.mountingGridV3.cellSizeMm} мм · проходы через ${state.mountingGridV3.cellSizeMm * state.circuitSettingsV32.spacingCells} мм`;
  }
  function cancel() {
    generation++; worker?.terminate(); worker = null; cancelPending?.(); cancelPending = null;
    state.engineBusyV1 = false;
  }
  const resetBase = resetRoute;
  resetRoute = function(...args) {cancel(); state.circuitPlanV32 = null; savedKey = ''; return resetBase(...args);};

  const complete = plan => plan?.scope === 'complete';
  const metres = mm => (mm / 1000).toFixed(1).replace('.', ',');
  function summary(plan) {
    const name = plan.circuits[0].method === 'double-snake' ? 'Двойная змейка' : 'Улитка';
    return `${name} · ${metres(plan.lengthMm)} м ${complete(plan) ? 'с подводами' : 'без подводов (3.1)'}${plan.overLength ? ' · более 80 м' : ''}`;
  }
  function details(plan) {
    if (!complete(plan)) return 'Сохранённая рабочая улитка 3.1. Установите коллектор и пересчитайте полный контур.';
    const c = plan.circuits[0];
    return `Подача: ${metres(c.supplyTransit.lengthMm)} м · рабочая часть: ${metres(c.heating.lengthMm)} м · обратка: ${metres(c.returnTransit.lengthMm)} м. Подводы показаны пунктиром.${plan.fallbackUsed ? ' Улитка с подводами не найдена — построена двойная змейка.' : ''}${plan.overLength ? ' Длина контура превышает 80 м; требуется разделение.' : ''}`;
  }
  function draw() {
    let plan = state.circuitPlanV32;
    if (plan && signature() !== savedKey) {state.circuitPlanV32 = null; state.routeComplete = false; plan = null;}
    $('manualToolBtn').disabled = !!plan;
    $('manualToolBtn').title = plan ? 'Редактирование сеточной трубы появится на этапе 3.4' : 'Правка прежнего маршрута';
    if (!plan || WarmEditor.active) return;
    const c = plan.circuits[0], scale = state.scale || .1, heat = complete(plan) ? c.heating.segments : c.segments;
    const heatLength = complete(plan) ? c.heating.lengthMm : c.lengthMm;
    const split = complete(plan) ? Math.max(0, Math.min(heatLength, c.lengthMm / 2 - c.supplyTransit.lengthMm)) : heatLength / 2;
    const width = state.pipeRenderMode === 'scheme' ? 2.5 / scale : state.pipeDiameterMm;
    const entry = complete(plan) ? c.supply : c.entry, exit = complete(plan) ? c.returnPoint : c.exit;
    const transits = complete(plan) ? `<path class="circuit-transit-supply" d="${S.svgPath(c.supplyTransit.segments)}" fill="none" stroke="#dc4c43" stroke-width="${width}" stroke-dasharray="${5 / scale} ${3 / scale}"/><path class="circuit-transit-return" d="${S.svgPath(c.returnTransit.segments)}" fill="none" stroke="#2673c7" stroke-width="${width}" stroke-dasharray="${5 / scale} ${3 / scale}"/>` : '';
    planSvg.insertAdjacentHTML('beforeend', `<g class="grid-circuit-v32" pointer-events="none"><title>${complete(plan) ? 'Полный контур: подача, рабочая часть, обратка.' : 'Рабочая улитка 3.1 без подводов.'}</title><path d="${S.svgPath(c.segments)}" fill="none" stroke="white" stroke-width="${width + 2 / scale}"/><path class="grid-circuit-supply" d="${S.pathRange(heat, 0, split)}" fill="none" stroke="#dc4c43" stroke-width="${width}"/><path class="grid-circuit-return" d="${S.pathRange(heat, split, heatLength)}" fill="none" stroke="#2673c7" stroke-width="${width}"/>${transits}<circle cx="${entry.x}" cy="${entry.y}" r="${4 / scale}" fill="#dc4c43"/><circle cx="${exit.x}" cy="${exit.y}" r="${4 / scale}" fill="#2673c7"/></g>`);
    $('routeInfo').textContent = summary(plan);
    $('gridInfo').textContent = summary(plan);
    $('spiralResultV31').textContent = details(plan);
  }
  const renderBase = renderPlan;
  renderPlan = function(...args) {renderBase(...args); draw();};
  const legacyExport = exportPng;
  $('shareBtn').removeEventListener('click', legacyExport);
  exportPng = async function() {
    if (!state.circuitPlanV32) return legacyExport();
    renderPlan();
    if (!state.circuitPlanV32) {setStatus('Параметры изменились. Сначала пересчитайте контур.', true); return;}
    const caption = summary(state.circuitPlanV32), description = details(state.circuitPlanV32), clone = planSvg.cloneNode(true);
    // External styles do not travel with an SVG blob: preserve the visible room/grid.
    const originals = [planSvg, ...planSvg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
    const properties = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility', 'display'];
    originals.forEach((element, i) => {const style = getComputedStyle(element); properties.forEach(p => copies[i].style.setProperty(p, style.getPropertyValue(p)));});
    clone.setAttribute('xmlns', SVG_NS);
    const box = planSvg.viewBox.baseVal, width = 1600, height = Math.round(width * box.height / box.width);
    clone.setAttribute('width', width); clone.setAttribute('height', height);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type: 'image/svg+xml;charset=utf-8'}));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {img.onload = resolve; img.onerror = reject; img.src = url;});
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height + 84;
      const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, width, height);
      context.fillStyle = '#172534'; context.font = '24px sans-serif'; context.fillText(caption, 24, height + 32);
      context.font = '18px sans-serif'; context.fillText(description, 24, height + 62, width - 48);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('PNG_FAILED');
      const downloadUrl = URL.createObjectURL(png), link = document.createElement('a');
      link.href = downloadUrl; link.download = `${state.name || 'warm-circuit-3.2'}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500); setStatus('Изображение сохранено. ' + caption);
    } catch {setStatus('Не удалось создать PNG. Повторите экспорт.', true);}
    finally {URL.revokeObjectURL(url);}
  };
  $('shareBtn').addEventListener('click', () => exportPng());
  function open() {
    if (WarmEditor.active) manualExitV2A();
    syncSettings();
    $('spiralResultV31').textContent = state.circuitPlanV32 ? details(state.circuitPlanV32) : 'Один полный контур от подачи до обратки. В режиме «Авто» сначала проверяется улитка, затем двойная змейка.';
    openSheetV5('spiralSheetV31');
  }
  const oldGenerate = $('generateBtn'); oldGenerate.replaceWith(oldGenerate.cloneNode(true));
  $('generateBtn').addEventListener('click', open);
  $('generateBtn').querySelector('span:last-child').textContent = 'Расчёт';
  $('closeSpiralV31').addEventListener('click', () => closeSheetV5());
  $('legacyCalculationV31').addEventListener('click', () => {resetRoute(); closeSheetV5(); renderPlan(); v221OpenChooser();});
  $('setCollectorV32').addEventListener('click', () => {closeSheetV5(); $('collectorToolBtn').click();});
  $('circuitMethodV32').addEventListener('change', () => {pushHistoryV5(); state.circuitSettingsV32.method = $('circuitMethodV32').value; resetRoute(); renderPlan();});
  for (const [id, field] of [['spiralRadiusInput', 'radiusMm'], ['spiralSpacingInput', 'spacingCells'], ['spiralOffsetInput', 'wallOffsetMm']]) {
    $(id).addEventListener('change', () => {
      const value = $(id).value === '' ? null : Number($(id).value);
      if (value === state.circuitSettingsV32[field]) return;
      pushHistoryV5(); state.circuitSettingsV32[field] = value;
      resetRoute(); syncSettings(); renderPlan();
    });
  }
  const snapshotBase = snapshotV5;
  snapshotV5 = function() {return {...snapshotBase(), circuitSettingsV32: copy(state.circuitSettingsV32)};};
  $('undoBtn').addEventListener('click', () => {const s = historyV5.at(-1); if (!WarmEditor.active && s?.circuitSettingsV32) {state.circuitSettingsV32 = copy(s.circuitSettingsV32); syncSettings();}}, true);
  function calculateInWorker(p, settings) {
    return new Promise((resolve, reject) => {
      worker = new Worker('./circuit-worker.js?v=360');
      const w = worker;
      const finish = (error, result) => {clearTimeout(timer); w.terminate(); if (worker === w) {worker = null; cancelPending = null;} error ? reject(error) : resolve(result);};
      const timer = setTimeout(() => finish(new Error('TIMEOUT')), 30000);
      cancelPending = () => finish(null, null);
      w.onmessage = event => finish(null, event.data);
      w.onerror = () => finish(new Error('CALCULATION_FAILED'));
      w.postMessage({project: p, settings});
    });
  }
  async function calculate() {
    if (state.engineBusyV1) return;
    // Explicit radius is required even if the legacy automatic radius is present.
    const settings = copy(state.circuitSettingsV32);
    if (!(Number.isFinite(settings.radiusMm) && settings.radiusMm > 0)) {setStatus(messages.RADIUS_REQUIRED, true); $('spiralRadiusInput').focus(); return;}
    if (!state.supply || !state.returnPoint) {setStatus(messages.COLLECTOR_REQUIRED, true); return;}
    if (WarmEditor.active) manualExitV2A();
    resetRoute(); state.editorDraft = null; state.manualV2 = blankManualStateV2A();
    const p = project(), inputKey = signature(), request = ++generation;
    closeSheetV5(); state.engineBusyV1 = true; renderPlan(); setStatus('Строю рабочую часть и подводы к коллектору…', false, {kind: 'progress'});
    try {
      const result = await calculateInWorker(p, settings);
      if (request !== generation) return;
      if (inputKey !== signature()) {setStatus('Параметры изменились. Повторите расчёт.', true); return;}
      if (!result?.ok) {setStatus(messages[result?.reason] || 'Корректный контур не найден. Измените параметры рабочей зоны.', true); return;}
      // Recheck the worker result before showing it or allowing it to be saved.
      if (!C.validate(p, settings, result).ok) {setStatus('Контур не прошёл проверку геометрии.', true); return;}
      state.circuitPlanV32 = result; savedKey = inputKey;
      state.routeComplete = true;
      renderPlan(); setStatus(`${summary(result)}. ${details(result)}`, result.overLength);
    } catch (e) {if (request === generation) setStatus(messages[e.message] || 'Расчёт не завершён. Повторите попытку.', true);}
    finally {if (request === generation) state.engineBusyV1 = false;}
  }
  $('calculateSpiralV31').addEventListener('click', calculate);
  const serializeBase = serializeState;
  serializeState = function() {
    const raw = serializeBase(); raw.versionLabel = '3.2.0'; raw.circuitSettingsV32 = copy(state.circuitSettingsV32);
    if (state.circuitPlanV32 && signature() === savedKey) {
      if (complete(state.circuitPlanV32)) raw.gridCircuitPlanV32 = copy(state.circuitPlanV32);
      else {raw.gridSpiralPlanV31 = copy(state.circuitPlanV32); raw.spiralSettingsV31 = copy(state.circuitPlanV32.settings);}
      raw.projectV3.circuits = copy(state.circuitPlanV32.circuits);
      raw.route = []; raw.routeComplete = complete(state.circuitPlanV32); delete raw.unifiedPlan; delete raw.editorDraft; delete raw.manualPlanV2;
    }
    return raw;
  };
  const loadBase = loadScheme;
  loadScheme = function(raw) {
    cancel(); state.circuitPlanV32 = null; savedKey = '';
    state.circuitSettingsV32 = {...defaults(), ...copy(raw.circuitSettingsV32 || raw.spiralSettingsV31 || {})};
    loadBase(raw);
    if (raw.gridCircuitPlanV32) {
      if (C.validate(project(), state.circuitSettingsV32, raw.gridCircuitPlanV32).ok) {
        state.circuitPlanV32 = copy(raw.gridCircuitPlanV32); savedKey = signature(); state.routeComplete = true;
      } else {state.routeComplete = false; setStatus('Сохранённый контур не прошёл проверку. Рассчитайте его заново.', true);}
    } else if (raw.gridSpiralPlanV31) {
      if (S.validate(project(), state.circuitSettingsV32, raw.gridSpiralPlanV31).ok) {
        state.circuitPlanV32 = copy(raw.gridSpiralPlanV31); savedKey = signature(); state.routeComplete = false;
        setStatus('Открыта рабочая улитка 3.1. Установите коллектор и пересчитайте, чтобы добавить подводы.');
      } else {state.routeComplete = false; setStatus('Рабочая улитка 3.1 не прошла проверку. Повторите расчёт.', true);}
    }
    syncSettings(); renderPlan();
  };
  const newBase = newScheme;
  newScheme = function() {cancel(); state.circuitPlanV32 = null; savedKey = ''; state.circuitSettingsV32 = defaults(); newBase(); syncSettings();};
  // Legacy methods invoked from their own dialog cannot coexist with a displayed spiral.
  const legacyGenerate = v221GenerateWithChoice;
  v221GenerateWithChoice = async function(...args) {state.circuitPlanV32 = null; savedKey = ''; return legacyGenerate(...args);};
  const swapBase = v222SwapPortsForRecalc;
  $('swapCollectorPortsV222').removeEventListener('click', swapBase);
  v222SwapPortsForRecalc = function() {const native = !!state.circuitPlanV32; swapBase(); if (native) setStatus('Подача и обратка поменяны местами. Нажмите «Расчёт», чтобы обновить контур.');};
  $('swapCollectorPortsV222').addEventListener('click', () => v222SwapPortsForRecalc());
  document.title = 'Тёплый пол — V3.2'; document.querySelector('.eyebrow').textContent = 'V3.2 · контур с подводами';
  globalThis.WarmV320 = {calculate, open, get plan() {return state.circuitPlanV32;}, get settings() {return copy(state.circuitSettingsV32);}};
  syncSettings();
})();
