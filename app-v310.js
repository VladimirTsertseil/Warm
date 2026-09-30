/* Warm 3.1: isolated grid-spiral workflow. Legacy routes/editor remain explicit. */
(() => {
  'use strict';
  const S = WarmSpiral, copy = value => structuredClone(value);
  const defaults = () => ({radiusMm: null, spacingCells: 1, wallOffsetMm: 100});
  state.spiralSettingsV31 = defaults(); state.spiralPlanV31 = null;
  let generation = 0, worker = null, cancelPending = null, savedKey = '';
  const project = () => WarmV300.project();
  const signature = () => {const p = project(); return JSON.stringify([p.room, p.grid, p.exclusions, p.collector, p.pipe, state.spiralSettingsV31]);};
  const messages = {
    RADIUS_REQUIRED: 'Укажите радиус поворота вручную — правила для диаметра трубы пока не заданы.',
    INVALID_SPACING: 'Шаг должен быть целым числом ячеек, не меньше одной.',
    INVALID_OFFSET: 'Отступ должен быть неотрицательным числом.',
    RADIUS_DOES_NOT_FIT: 'Заданный радиус не помещается между проходами. Увеличьте шаг по сетке или проверьте допустимый радиус трубы.',
    DISCONNECTED_OR_EMPTY_GRID: 'В этой зоне нет связной монтажной сетки для выбранного шага и отступа. Проверьте узкие проходы и отдельные участки.',
    NO_VALID_SPIRAL: 'Для этой формы и параметров корректная улитка не найдена. Проверьте проходы, исключения и шаг.',
    AREA_TOO_LARGE: 'Область слишком велика для одного расчёта. Разделите рабочую зону.',
    TIMEOUT: 'Расчёт не завершился за отведённое время. Уменьшите рабочую зону и повторите.'
  };
  function syncSettings() {
    $('spiralRadiusInput').value = state.spiralSettingsV31.radiusMm ?? '';
    $('spiralSpacingInput').value = state.spiralSettingsV31.spacingCells;
    $('spiralOffsetInput').value = state.spiralSettingsV31.wallOffsetMm;
    $('spiralPitchInfo').textContent = `Сетка ${state.mountingGridV3.cellSizeMm} мм · проходы через ${state.mountingGridV3.cellSizeMm * state.spiralSettingsV31.spacingCells} мм`;
  }
  function cancel() {
    generation++; worker?.terminate(); worker = null; cancelPending?.(); cancelPending = null;
    state.engineBusyV1 = false;
  }
  const resetBase = resetRoute;
  resetRoute = function(...args) {cancel(); state.spiralPlanV31 = null; savedKey = ''; return resetBase(...args);};

  function summary(plan) {
    const length = (plan.lengthMm / 1000).toFixed(1).replace('.', ',');
    return `Улитка · ${length} м без подводов${plan.overLength ? ' · более 80 м, требуется разделение' : ''}`;
  }
  function draw() {
    let plan = state.spiralPlanV31;
    if (plan && signature() !== savedKey) {state.spiralPlanV31 = null; plan = null;}
    $('manualToolBtn').disabled = !!plan;
    $('manualToolBtn').title = plan ? 'Редактирование сеточной трубы появится на этапе 3.4' : 'Правка прежнего маршрута';
    if (!plan || WarmEditor.active) return;
    const c = plan.circuits[0], half = c.lengthMm / 2, scale = state.scale || .1;
    const width = state.pipeRenderMode === 'scheme' ? 2.5 / scale : state.pipeDiameterMm;
    planSvg.insertAdjacentHTML('beforeend', `<g class="grid-spiral-v31" pointer-events="none"><title>Рабочая улитка. Подключение к коллектору не построено.</title><path d="${S.svgPath(c.segments)}" fill="none" stroke="white" stroke-width="${width + 2 / scale}"/><path class="grid-spiral-supply" d="${S.pathRange(c.segments, 0, half)}" fill="none" stroke="#dc4c43" stroke-width="${width}"/><path class="grid-spiral-return" d="${S.pathRange(c.segments, half, c.lengthMm)}" fill="none" stroke="#2673c7" stroke-width="${width}"/><circle cx="${c.entry.x}" cy="${c.entry.y}" r="${4 / scale}" fill="#dc4c43"><title>Начало рабочей части</title></circle><circle cx="${c.exit.x}" cy="${c.exit.y}" r="${4 / scale}" fill="#2673c7"><title>Конец рабочей части</title></circle></g>`);
    $('routeInfo').textContent = summary(plan);
    $('gridInfo').textContent = summary(plan);
    $('spiralResultV31').textContent = `${summary(plan)}. Подводы к коллектору будут добавлены на этапе 3.2.`;
  }
  const renderBase = renderPlan;
  renderPlan = function(...args) {renderBase(...args); draw();};
  const legacyExport = exportPng;
  $('shareBtn').removeEventListener('click', legacyExport);
  exportPng = async function() {
    if (!state.spiralPlanV31) return legacyExport();
    renderPlan();
    if (!state.spiralPlanV31) {setStatus('Параметры изменились. Сначала пересчитайте улитку.', true); return;}
    const caption = summary(state.spiralPlanV31), clone = planSvg.cloneNode(true);
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
      context.font = '20px sans-serif'; context.fillText('Рабочая часть. Подключение к коллектору пока не построено.', 24, height + 62);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('PNG_FAILED');
      const downloadUrl = URL.createObjectURL(png), link = document.createElement('a');
      link.href = downloadUrl; link.download = `${state.name || 'warm-spiral-3.1'}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500); setStatus('Изображение улитки сохранено. Длина указана без подводов.');
    } catch {setStatus('Не удалось создать PNG. Повторите экспорт.', true);}
    finally {URL.revokeObjectURL(url);}
  };
  $('shareBtn').addEventListener('click', () => exportPng());
  function open() {
    if (WarmEditor.active) manualExitV2A();
    syncSettings();
    $('spiralResultV31').textContent = state.spiralPlanV31 ? `${summary(state.spiralPlanV31)}. Подключение к коллектору пока не построено.` : 'Одна рабочая улитка. Подводы к коллектору — следующий этап.';
    openSheetV5('spiralSheetV31');
  }
  const oldGenerate = $('generateBtn'); oldGenerate.replaceWith(oldGenerate.cloneNode(true));
  $('generateBtn').addEventListener('click', open);
  $('generateBtn').querySelector('span:last-child').textContent = 'Улитка';
  $('closeSpiralV31').addEventListener('click', () => closeSheetV5());
  $('legacyCalculationV31').addEventListener('click', () => {resetRoute(); closeSheetV5(); renderPlan(); v221OpenChooser();});
  for (const [id, field] of [['spiralRadiusInput', 'radiusMm'], ['spiralSpacingInput', 'spacingCells'], ['spiralOffsetInput', 'wallOffsetMm']]) {
    $(id).addEventListener('change', () => {
      const value = $(id).value === '' ? null : Number($(id).value);
      if (value === state.spiralSettingsV31[field]) return;
      pushHistoryV5(); state.spiralSettingsV31[field] = value;
      resetRoute(); syncSettings(); renderPlan();
    });
  }
  const snapshotBase = snapshotV5;
  snapshotV5 = function() {return {...snapshotBase(), spiralSettingsV31: copy(state.spiralSettingsV31)};};
  $('undoBtn').addEventListener('click', () => {const s = historyV5.at(-1); if (!WarmEditor.active && s?.spiralSettingsV31) {state.spiralSettingsV31 = copy(s.spiralSettingsV31); syncSettings();}}, true);
  function calculateInWorker(p, settings) {
    return new Promise((resolve, reject) => {
      worker = new Worker('./spiral-worker.js?v=340');
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
    const settings = copy(state.spiralSettingsV31);
    if (!(Number.isFinite(settings.radiusMm) && settings.radiusMm > 0)) {setStatus(messages.RADIUS_REQUIRED, true); $('spiralRadiusInput').focus(); return;}
    if (WarmEditor.active) manualExitV2A();
    resetRoute(); state.editorDraft = null; state.manualV2 = blankManualStateV2A();
    const p = project(), inputKey = signature(), request = ++generation;
    closeSheetV5(); state.engineBusyV1 = true; renderPlan(); setStatus('Строю улитку по монтажной сетке…', false, {kind: 'progress'});
    try {
      const result = await calculateInWorker(p, settings);
      if (request !== generation) return;
      if (inputKey !== signature()) {setStatus('Параметры изменились. Повторите расчёт.', true); return;}
      if (!result?.ok) {setStatus(messages[result?.reason] || 'Корректная улитка не найдена. Измените параметры рабочей зоны.', true); return;}
      // Recheck the worker result before showing it or allowing it to be saved.
      if (!S.validate(p, settings, result).ok) {setStatus('Улитка не прошла проверку геометрии.', true); return;}
      state.spiralPlanV31 = result; savedKey = inputKey;
      state.routeComplete = false; // The collector transits do not exist in this stage.
      renderPlan(); setStatus(`${summary(result)}. Подключение к коллектору пока не построено.`, result.overLength);
    } catch (e) {if (request === generation) setStatus(messages[e.message] || 'Расчёт не завершён. Повторите попытку.', true);}
    finally {if (request === generation) state.engineBusyV1 = false;}
  }
  $('calculateSpiralV31').addEventListener('click', calculate);
  const serializeBase = serializeState;
  serializeState = function() {
    const raw = serializeBase(); raw.versionLabel = '3.1.0'; raw.spiralSettingsV31 = copy(state.spiralSettingsV31);
    if (state.spiralPlanV31 && signature() === savedKey) {
      raw.gridSpiralPlanV31 = copy(state.spiralPlanV31); raw.projectV3.circuits = copy(state.spiralPlanV31.circuits);
      raw.route = []; raw.routeComplete = false; delete raw.unifiedPlan; delete raw.editorDraft; delete raw.manualPlanV2;
    }
    return raw;
  };
  const loadBase = loadScheme;
  loadScheme = function(raw) {
    cancel(); state.spiralPlanV31 = null; savedKey = '';
    state.spiralSettingsV31 = raw.spiralSettingsV31 ? {...defaults(), ...copy(raw.spiralSettingsV31)} : defaults();
    loadBase(raw);
    if (raw.gridSpiralPlanV31) {
      if (S.validate(project(), state.spiralSettingsV31, raw.gridSpiralPlanV31).ok) {
        state.spiralPlanV31 = copy(raw.gridSpiralPlanV31); savedKey = signature(); state.routeComplete = false;
      } else setStatus('Сохранённая улитка не прошла проверку. Рассчитайте её заново.', true);
    }
    syncSettings(); renderPlan();
  };
  const newBase = newScheme;
  newScheme = function() {cancel(); state.spiralPlanV31 = null; savedKey = ''; state.spiralSettingsV31 = defaults(); newBase(); syncSettings();};
  // Legacy methods invoked from their own dialog cannot coexist with a displayed spiral.
  const legacyGenerate = v221GenerateWithChoice;
  v221GenerateWithChoice = async function(...args) {state.spiralPlanV31 = null; savedKey = ''; return legacyGenerate(...args);};
  document.title = 'Тёплый пол — V3.1'; document.querySelector('.eyebrow').textContent = 'V3.1 · улитка по сетке';
  globalThis.WarmV310 = {calculate, open, get plan() {return state.spiralPlanV31;}, get settings() {return copy(state.spiralSettingsV31);}};
  syncSettings();
})();
