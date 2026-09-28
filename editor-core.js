/* Warm 3.0: bridge the existing shape editor to the independent mounting grid. */
(() => {
  'use strict';
  const G = globalThis.WarmGrid;
  const clone = value => structuredClone(value);
  let cachedKey = '', cachedGraph = null;
  state.mountingGridV3 = {cellSizeMm: 150, origin: {x: 0, y: 0}};
  state.gridMigrationV3 = {warnings: []};

  function project(raw = state) {
    const geometry = G.legacyGeometry(raw);
    return G.createProject({...geometry, grid: state.mountingGridV3,
      pipe: {diameterMm: state.pipeDiameterMm},
      collector: {supply: raw.supply, returnPoint: raw.returnPoint},
      circuits: G.legacyCircuits(raw, state.pipeDiameterMm), migration: state.gridMigrationV3});
  }
  function grid() {
    const p = project();
    const key = JSON.stringify([p.room, p.exclusions, p.grid]);
    if (key !== cachedKey) { cachedGraph = G.buildGrid(p); cachedKey = key; }
    return cachedGraph;
  }
  function sync() {
    $('mountingGridInput').value = String(state.mountingGridV3.cellSizeMm);
    $('pipeDiameterInput').value = String(state.pipeDiameterMm);
  }
  const syncBase = syncInputs;
  syncInputs = function() { syncBase(); sync(); };

  function drawGrid() {
    if (!state.sections.length) return;
    const graph = grid(), nodes = new Map(graph.nodes.map(n => [n.id, n]));
    // Replace only the old grid fill, leaving masks, obstacles and room handles intact.
    const host = planSvg.querySelector('[fill="url(#gridPatternV72)"]');
    if (host) {
      const paths = {available: [], excluded: []};
      for (const e of graph.edges) if (paths[e.status]) {
        const a = nodes.get(e.from), b = nodes.get(e.to);
        paths[e.status].push(`M${a.x},${a.y}L${b.x},${b.y}`);
      }
      host.insertAdjacentHTML('afterend', `<g class="mounting-grid-v3" pointer-events="none" aria-label="Монтажная сетка ${graph.cellSizeMm} мм"><path d="${paths.available.join('')}" fill="none" stroke="#cbd5e1" stroke-width="0.65" vector-effect="non-scaling-stroke"/><path d="${paths.excluded.join('')}" fill="none" stroke="#e8a3a3" stroke-width="0.65" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/></g>`);
      host.remove();
    }
    const counts = graph.counts.edges;
    $('mountingGridSummary').textContent = `Сетка ${graph.cellSizeMm} мм · Ø${state.pipeDiameterMm} мм · доступных направляющих: ${counts.available} · исключённых: ${counts.excluded}`;
  }
  const renderBase = renderPlan;
  renderPlan = function(...args) { renderBase(...args); drawGrid(); };

  const snapshotBase = snapshotV5;
  snapshotV5 = function() { return {...snapshotBase(), mountingGridV3: clone(state.mountingGridV3), pipeDiameterMm: state.pipeDiameterMm}; };
  // The old undo handler is captured by the button. Restore the additional fields
  // before it runs; keep all existing shape/obstacle restoration in that handler.
  $('undoBtn').addEventListener('click', () => {
    const snapshot = historyV5.at(-1);
    if (!snapshot || globalThis.WarmEditor?.active) return;
    if (snapshot.mountingGridV3) state.mountingGridV3 = clone(snapshot.mountingGridV3);
    if (snapshot.pipeDiameterMm) state.pipeDiameterMm = snapshot.pipeDiameterMm;
    sync();
  }, true);
  $('mountingGridInput').addEventListener('change', () => {
    const cellSizeMm = Number($('mountingGridInput').value);
    if (!G.CELL_SIZES.includes(cellSizeMm)) { sync(); return; }
    pushHistoryV5();
    state.mountingGridV3 = {...state.mountingGridV3, cellSizeMm};
    resetRoute(); renderPlan();
    setStatus(`Монтажная сетка: ${cellSizeMm} мм. Размеры помещения сохранены.`);
  });
  // Replace captured diameter callbacks so one edit creates one history record.
  const oldDiameter = $('pipeDiameterInput');
  oldDiameter.replaceWith(oldDiameter.cloneNode(true));
  $('pipeDiameterInput').addEventListener('change', () => {
    const diameterMm = Number($('pipeDiameterInput').value);
    if (!G.PIPE_DIAMETERS.includes(diameterMm)) { sync(); return; }
    pushHistoryV5(); state.pipeDiameterMm = diameterMm;
    // This remains the legacy planner's own setting, not a rule in the new core.
    syncBendUiV10(); updatePipeGeometryInfoV9(); resetRoute(); renderPlan();
  });

  const serializeBase = serializeState;
  serializeState = function() {
    const raw = serializeBase();
    raw.versionLabel = '3.0.0';
    raw.projectV3 = project(raw);
    return raw;
  };
  const loadBase = loadScheme;
  loadScheme = function(raw) {
    const model = G.fromLegacy(raw);
    state.mountingGridV3 = clone(model.grid);
    state.gridMigrationV3 = clone(model.migration);
    // Preserve independent old painted exclusions: old loadScheme drops their set.
    // Turn only these exact physical footprints into editor obstacles on import.
    const geometry = G.legacyGeometry(raw);
    const obstacles = geometry.exclusions.areas.map((r, i) => ({...r, id: raw.obstacles?.[i]?.id || `imported-${i}`}));
    const adjusted = {...raw, pipeDiameterMm: model.pipe.diameterMm, obstacles};
    state.pipeDiameterMm = model.pipe.diameterMm;
    loadBase(adjusted);
    if (Number(raw.pipeDiameterMm || 16) !== model.pipe.diameterMm) resetRoute();
    syncInputs(); renderPlan();
    if (!raw.projectV3 && model.migration.warnings.length) setStatus(model.migration.warnings.join(' '));
  };
  const newBase = newScheme;
  newScheme = function() {
    state.mountingGridV3 = {cellSizeMm: 150, origin: {x: 0, y: 0}};
    state.gridMigrationV3 = {warnings: []};
    newBase(); state.maxCircuitLengthM = 80; syncInputs(); renderPlan();
  };
  document.title = 'Тёплый пол — V3.0';
  document.querySelector('.eyebrow').textContent = 'V3.0 · монтажная сетка';
  globalThis.WarmV300 = {project, grid};
  sync();
})();
