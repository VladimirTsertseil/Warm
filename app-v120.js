const STORAGE_KEY = 'ufp-schemes-v06';
const V4_STORAGE_KEY = 'ufp-schemes-v04';
const V3_STORAGE_KEY = 'ufp-schemes-v03';
const PREV_STORAGE_KEY = 'ufp-schemes-v02';
const LEGACY_STORAGE_KEY = 'ufp-schemes';

const state = {
  id: null,
  sections: [],
  excluded: new Set(),
  supply: null,
  returnPoint: null,
  roomAdded: new Set(),
  roomRemoved: new Set(),
  shapeStepMm: 100,
  route: [],
  routeKind: '',
  routeComplete: false,
  mode: 'exclude',
  name: '',
  object: '',
  gridStepMm: 50,
  pipeStepMm: 150,
  pipeDiameterMm: 16,
  pipeRenderMode: 'scale',
  wallOffsetMm: 100,
  scale: 0.09,
  bounds: { minX: 0, minY: 0, maxX: 4000, maxY: 3000, width: 4000, height: 3000 },
};

const $ = (id) => document.getElementById(id);
const homeView = $('homeView');
const editorView = $('editorView');
const planSvg = $('planSvg');
const diagramScroll = $('diagramScroll');
const status = $('status');
const modeHint = $('modeHint');

const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const fmt = (v) => Math.round(v).toLocaleString('ru-RU');
const fmtM = (mm, digits = 2) => (mm / 1000).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const manhattanWorld = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const nearly = (a, b, eps = 0.001) => Math.abs(a - b) <= eps;

function makeBaseSection(width = 4000, height = 3000) {
  return { id: uuid(), name: 'Основной', x: 0, y: 0, width, height, base: true };
}

function baseSection() {
  return state.sections.find(s => s.base) || state.sections[0];
}

function showView(name) {
  homeView.classList.toggle('active', name === 'home');
  editorView.classList.toggle('active', name === 'editor');
  if (name === 'home') renderSchemes();
}

function newScheme() {
  Object.assign(state, {
    id: uuid(),
    sections: [makeBaseSection()],
    excluded: new Set(),
    supply: null,
    returnPoint: null,
    roomAdded: new Set(),
    roomRemoved: new Set(),
    shapeStepMm: 100,
    route: [],
    routeKind: '',
    routeComplete: false,
    mode: 'exclude',
    name: '',
    object: '',
    gridStepMm: 50,
    pipeStepMm: 150,
    wallOffsetMm: 100,
    scale: 0.09,
  });
  recomputeGeometry();
  syncInputs();
  setMode('room');
  showView('editor');
  requestAnimationFrame(() => {
    fitPlan(false);
    renderPlan();
  });
  setStatus('');
}

function shapeCellKeyFromPoint(x, y) {
  const g = state.shapeStepMm;
  return `${Math.floor(x / g)},${Math.floor(y / g)}`;
}
function shapeCellRectFromKey(k) {
  const [gx, gy] = k.split(',').map(Number);
  const g = state.shapeStepMm;
  return { x: gx * g, y: gy * g, width: g, height: g };
}

function computeBounds() {
  if (!state.sections.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  const rects = [...state.sections, ...[...state.roomAdded].map(shapeCellRectFromKey)];
  const minX = Math.min(...rects.map(s => s.x));
  const minY = Math.min(...rects.map(s => s.y));
  const maxX = Math.max(...rects.map(s => s.x + s.width));
  const maxY = Math.max(...rects.map(s => s.y + s.height));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function pointInSection(x, y, s, inclusive = true) {
  const e = 0.001;
  if (inclusive) return x >= s.x - e && x <= s.x + s.width + e && y >= s.y - e && y <= s.y + s.height + e;
  return x > s.x + e && x < s.x + s.width - e && y > s.y + e && y < s.y + s.height - e;
}

function insideRoom(x, y, inclusive = true) {
  const k = shapeCellKeyFromPoint(x, y);
  if (state.roomRemoved.has(k)) return false;
  if (state.roomAdded.has(k)) return true;
  return state.sections.some(s => pointInSection(x, y, s, inclusive));
}

function gridKey(gx, gy) { return `${gx},${gy}`; }
function parseGridKey(k) { return k.split(',').map(Number); }
function cellIndexFromPoint(x, y) {
  const g = state.gridStepMm;
  return { gx: Math.floor(x / g), gy: Math.floor(y / g) };
}
function cellRect(gx, gy) {
  const g = state.gridStepMm;
  return { x: gx * g, y: gy * g, width: g, height: g };
}
function cellIntersectsRoom(gx, gy) {
  const r = cellRect(gx, gy);
  return insideRoom(r.x + r.width / 2, r.y + r.height / 2, true);
}
function pointExcluded(x, y) {
  const { gx, gy } = cellIndexFromPoint(x, y);
  return state.excluded.has(gridKey(gx, gy));
}

function recomputeGeometry() {
  state.bounds = computeBounds();
  state.excluded = new Set([...state.excluded].filter(k => {
    const [gx, gy] = parseGridKey(k);
    return cellIntersectsRoom(gx, gy);
  }));
  for (const key of ['supply', 'returnPoint']) {
    const point = state[key];
    if (!point) continue;
    const near = nearestBoundaryPoint(point.x, point.y);
    if (!near || near.distance > Math.max(state.gridStepMm * 3, 350)) state[key] = null;
    else state[key] = { x: near.x, y: near.y, side: near.side };
  }
}

function resetRoute() {
  state.route = [];
  state.routeKind = '';
  state.routeComplete = false;
  state.routeCandidates = [];
  state.selectedRouteCandidate = null;
}

function syncInputs() {
  const base = baseSection();
  $('widthInput').value = (base.width / 1000).toFixed(2);
  $('heightInput').value = (base.height / 1000).toFixed(2);
  $('baseSizeLabel').textContent = `${fmtM(base.width)} × ${fmtM(base.height)} м`;
  $('nameInput').value = state.name;
  $('objectInput').value = state.object;
  $('gridStepInput').value = (state.gridStepMm / 1000).toFixed(2);
  $('pipeStepInput').value = (state.pipeStepMm / 1000).toFixed(2);
  if ($('pipeDiameterInput')) $('pipeDiameterInput').value = String(state.pipeDiameterMm || 16);
  if ($('pipeRenderModeInput')) $('pipeRenderModeInput').value = state.pipeRenderMode || 'scale';
  if (typeof updatePipeGeometryInfoV9 === 'function') updatePipeGeometryInfoV9();
  $('wallOffsetInput').value = (state.wallOffsetMm / 1000).toFixed(2);
  $('schemeTitle').textContent = state.name || 'Новая схема';
  const edits = state.roomAdded.size + state.roomRemoved.size;
  if ($('shapeEditsInfo')) $('shapeEditsInfo').textContent = edits ? `Изменено участков: ${edits}` : 'Прямоугольник можно дорисовать или подрезать пальцем';
}

function resetRoomShape() {
  state.roomAdded.clear();
  state.roomRemoved.clear();
  state.excluded.clear();
  state.supply = null;
  state.returnPoint = null;
  resetRoute();
  recomputeGeometry();
  fitPlan(false);
  syncInputs();
  renderPlan();
  setStatus('Форма снова соответствует основному прямоугольнику.');
}

function renderAll() {
  recomputeGeometry();
  syncInputs();
  renderPlan();
}

function sectionOverlapAlongSide(anchor, side, x, y, width, height) {
  if (side === 'left' || side === 'right') {
    return Math.min(anchor.y + anchor.height, y + height) - Math.max(anchor.y, y) > 0.5;
  }
  return Math.min(anchor.x + anchor.width, x + width) - Math.max(anchor.x, x) > 0.5;
}

function addSection() {
  const anchor = state.sections.find(s => s.id === $('anchorSectionSelect').value) || baseSection();
  const side = $('sideSelect').value;
  const width = clamp(Number($('sectionWidthInput').value) || 1500, 200, 30000);
  const height = clamp(Number($('sectionHeightInput').value) || 1500, 200, 30000);
  const offset = clamp(Number($('offsetInput').value) || 0, -30000, 30000);
  let x = anchor.x, y = anchor.y;
  if (side === 'right') { x = anchor.x + anchor.width; y = anchor.y + offset; }
  if (side === 'left') { x = anchor.x - width; y = anchor.y + offset; }
  if (side === 'bottom') { x = anchor.x + offset; y = anchor.y + anchor.height; }
  if (side === 'top') { x = anchor.x + offset; y = anchor.y - height; }

  if (!sectionOverlapAlongSide(anchor, side, x, y, width, height)) {
    setStatus('Эта часть касается комнаты только углом или не касается её. Измените смещение.', true);
    return;
  }

  state.sections.push({ id: uuid(), name: 'Часть', x, y, width, height, base: false });
  resetRoute();
  recomputeGeometry();
  $('addSectionPanel').classList.add('hidden');
  syncSectionControls();
  fitPlan(false);
  renderPlan();
  setStatus('Часть комнаты добавлена. Размеры на схеме указаны в миллиметрах.');
}

function removeSection(id) {
  state.sections = state.sections.filter(s => s.id !== id || s.base);
  resetRoute();
  recomputeGeometry();
  syncSectionControls();
  fitPlan(false);
  renderPlan();
}

function updateOffsetHint() {
  const side = $('sideSelect').value;
  const text = {
    right: 'Справа: положительное смещение сдвигает новую часть вниз.',
    left: 'Слева: положительное смещение сдвигает новую часть вниз.',
    top: 'Сверху: положительное смещение сдвигает новую часть вправо.',
    bottom: 'Снизу: положительное смещение сдвигает новую часть вправо.',
  }[side];
  $('offsetHint').textContent = text;
  document.querySelectorAll('.side-picker button').forEach(b => b.classList.toggle('active', b.dataset.side === side));
}

function setMode(mode) {
  endPaintGesture();
  endRoomGesture();
  state.mode = mode;
  planSvg.classList.toggle('paint-mode', mode === 'exclude' || mode === 'room');
  planSvg.classList.toggle('entrance-mode', mode === 'supply' || mode === 'return');
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const hints = {
    room: 'Рисуйте форму прямо пальцем. Начните на пустом месте — добавляете площадь; начните внутри комнаты — стираете.',
    exclude: 'Проведите пальцем по монтажной сетке: пустые ячейки исключаются, исключённые — возвращаются.',
    supply: 'Коснитесь стены в точке, где подача входит в комнату.',
    return: 'Коснитесь стены в точке, где обратка выходит из комнаты.',
    inspect: 'Просмотр схемы. Увеличенную схему можно прокручивать пальцем.',
  };
  modeHint.textContent = hints[mode] || '';
  renderPlan();
}

function computeOuterBoundarySegments() {
  const editRects = [...state.roomAdded, ...state.roomRemoved].map(shapeCellRectFromKey);
  const allRects = [...state.sections, ...editRects];
  const xs = [...new Set(allRects.flatMap(s => [s.x, s.x + s.width]))].sort((a, b) => a - b);
  const ys = [...new Set(allRects.flatMap(s => [s.y, s.y + s.height]))].sort((a, b) => a - b);
  const occ = [];
  for (let j = 0; j < ys.length - 1; j++) {
    occ[j] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      occ[j][i] = insideRoom(cx, cy, false);
    }
  }
  const segs = [];
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      if (!occ[j][i]) continue;
      if (j === 0 || !occ[j - 1][i]) segs.push({ x1: xs[i], y1: ys[j], x2: xs[i + 1], y2: ys[j], side: 'top' });
      if (j === ys.length - 2 || !occ[j + 1][i]) segs.push({ x1: xs[i], y1: ys[j + 1], x2: xs[i + 1], y2: ys[j + 1], side: 'bottom' });
      if (i === 0 || !occ[j][i - 1]) segs.push({ x1: xs[i], y1: ys[j], x2: xs[i], y2: ys[j + 1], side: 'left' });
      if (i === xs.length - 2 || !occ[j][i + 1]) segs.push({ x1: xs[i + 1], y1: ys[j], x2: xs[i + 1], y2: ys[j + 1], side: 'right' });
    }
  }
  return mergeBoundarySegments(segs);
}

function mergeBoundarySegments(segs) {
  const out = [];
  const groups = new Map();
  segs.forEach(s => {
    const horiz = nearly(s.y1, s.y2);
    const k = horiz ? `h:${s.side}:${s.y1}` : `v:${s.side}:${s.x1}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  });
  for (const arr of groups.values()) {
    const horiz = nearly(arr[0].y1, arr[0].y2);
    arr.sort((a, b) => horiz ? a.x1 - b.x1 : a.y1 - b.y1);
    let cur = { ...arr[0] };
    for (let i = 1; i < arr.length; i++) {
      const s = arr[i];
      const joins = horiz ? nearly(cur.x2, s.x1) : nearly(cur.y2, s.y1);
      if (joins) {
        cur.x2 = s.x2; cur.y2 = s.y2;
      } else {
        out.push(cur); cur = { ...s };
      }
    }
    out.push(cur);
  }
  return out;
}

function projectToSegment(px, py, s) {
  if (nearly(s.y1, s.y2)) {
    const x = clamp(px, Math.min(s.x1, s.x2), Math.max(s.x1, s.x2));
    return { x, y: s.y1 };
  }
  const y = clamp(py, Math.min(s.y1, s.y2), Math.max(s.y1, s.y2));
  return { x: s.x1, y };
}

function nearestBoundaryPoint(x, y) {
  const segs = computeOuterBoundarySegments();
  let best = null;
  for (const seg of segs) {
    const p = projectToSegment(x, y, seg);
    const d = Math.hypot(p.x - x, p.y - y);
    if (!best || d < best.distance) best = { ...p, side: seg.side, seg, distance: d };
  }
  return best;
}

function routePorts() {
  if (!state.supply || !state.returnPoint) return null;
  const s = nearestBoundaryPoint(state.supply.x, state.supply.y);
  const r = nearestBoundaryPoint(state.returnPoint.x, state.returnPoint.y);
  if (!s || !r) return null;
  return {
    supply: { x: s.x, y: s.y },
    ret: { x: r.x, y: r.y },
    supplySide: s.side,
    returnSide: r.side,
  };
}

function fitPlan(render = true) {
  recomputeGeometry();
  const b = state.bounds;
  const availableW = Math.max(260, diagramScroll.clientWidth - 24);
  const availableH = Math.max(320, Math.min(520, window.innerHeight * 0.5));
  const marginPx = 60;
  const sx = (availableW - marginPx * 2) / Math.max(1, b.width);
  const sy = (availableH - marginPx * 2) / Math.max(1, b.height);
  state.scale = clamp(Math.min(sx, sy), 0.025, 0.32);
  if (render) {
    renderPlan();
    requestAnimationFrame(() => diagramScroll.scrollTo({ top: 0, left: 0, behavior: 'smooth' }));
  }
}

function zoomBy(factor) {
  state.scale = clamp(state.scale * factor, 0.02, 0.6);
  renderPlan();
}

function svgPointFromEvent(e) {
  const pt = planSvg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const matrix = planSvg.getScreenCTM();
  if (!matrix) return null;
  const p = pt.matrixTransform(matrix.inverse());
  return { x: p.x, y: p.y };
}

function routePointAllowed(x, y) {
  if (!insideRoom(x, y, false) || pointExcluded(x, y)) return false;
  const d = Math.max(0, state.wallOffsetMm * 0.92);
  if (!d) return true;
  return insideRoom(x - d, y, true) && insideRoom(x + d, y, true) && insideRoom(x, y - d, true) && insideRoom(x, y + d, true);
}

function axisPositions(min, max, step) {
  if (max < min) return [];
  const out = [];
  for (let v = min; v <= max + 0.001; v += step) out.push(v);
  if (!out.length) out.push((min + max) / 2);
  return out;
}

function makeEvenPositions(min, max, step) {
  let arr = axisPositions(min, max, step);
  if (arr.length > 2 && arr.length % 2 === 1) arr = arr.slice(0, -1);
  return arr;
}

function sequenceEvenOdd(values, reverseBase = false) {
  const base = reverseBase ? [...values].reverse() : [...values];
  const out = [];
  for (let i = 0; i < base.length; i += 2) out.push(base[i]);
  let lastOdd = base.length % 2 === 0 ? base.length - 1 : base.length - 2;
  for (let i = lastOdd; i >= 1; i -= 2) out.push(base[i]);
  return out;
}

function cleanPolyline(points) {
  const dedup = points.filter((p, i) => i === 0 || !nearly(p.x, points[i - 1].x) || !nearly(p.y, points[i - 1].y));
  if (dedup.length < 3) return dedup;
  const out = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1], b = dedup[i], c = dedup[i + 1];
    const collinear = (nearly(a.x, b.x) && nearly(b.x, c.x)) || (nearly(a.y, b.y) && nearly(b.y, c.y));
    if (!collinear) out.push(b);
  }
  out.push(dedup[dedup.length - 1]);
  return out;
}

function connectorForSide(port, lane, side) {
  if (side === 'left' || side === 'right') return [port, { x: lane.x, y: port.y }, lane];
  return [port, { x: port.x, y: lane.y }, lane];
}

function generateDoubleSnake() {
  if (state.sections.length !== 1 || state.excluded.size) return null;
  const s = baseSection();
  const off = state.wallOffsetMm;
  const step = state.pipeStepMm;
  const left = s.x + off, right = s.x + s.width - off;
  const top = s.y + off, bottom = s.y + s.height - off;
  if (right - left < step || bottom - top < step) return null;
  const ports = routePorts();
  if (!ports) return null;
  const side = ports.supplySide;
  let options = [];

  if (side === 'left' || side === 'right') {
    const ys = makeEvenPositions(top, bottom, step);
    if (ys.length < 2) return null;
    const startX = side === 'left' ? left : right;
    const endX = side === 'left' ? right : left;
    for (const reverseBase of [false, true]) {
      const order = sequenceEvenOdd(ys, reverseBase);
      const lanes = [];
      order.forEach((y, i) => {
        const a = i % 2 === 0 ? { x: startX, y } : { x: endX, y };
        const b = i % 2 === 0 ? { x: endX, y } : { x: startX, y };
        lanes.push(a, b);
      });
      const startConn = connectorForSide(ports.supply, lanes[0], side);
      const endConn = connectorForSide(ports.ret, lanes[lanes.length - 1], ports.returnSide).reverse();
      const route = cleanPolyline([...startConn, ...lanes.slice(1), ...endConn.slice(1)]);
      options.push({ route, cost: manhattanWorld(ports.supply, lanes[0]) + manhattanWorld(ports.ret, lanes[lanes.length - 1]) });
    }
  } else {
    const xs = makeEvenPositions(left, right, step);
    if (xs.length < 2) return null;
    const startY = side === 'top' ? top : bottom;
    const endY = side === 'top' ? bottom : top;
    for (const reverseBase of [false, true]) {
      const order = sequenceEvenOdd(xs, reverseBase);
      const lanes = [];
      order.forEach((x, i) => {
        const a = i % 2 === 0 ? { x, y: startY } : { x, y: endY };
        const b = i % 2 === 0 ? { x, y: endY } : { x, y: startY };
        lanes.push(a, b);
      });
      const startConn = connectorForSide(ports.supply, lanes[0], side);
      const endConn = connectorForSide(ports.ret, lanes[lanes.length - 1], ports.returnSide).reverse();
      const route = cleanPolyline([...startConn, ...lanes.slice(1), ...endConn.slice(1)]);
      options.push({ route, cost: manhattanWorld(ports.supply, lanes[0]) + manhattanWorld(ports.ret, lanes[lanes.length - 1]) });
    }
  }
  options.sort((a, b) => a.cost - b.cost);
  return options[0]?.route || null;
}

function buildLattice() {
  const b = state.bounds, off = state.wallOffsetMm, step = state.pipeStepMm;
  const xs = axisPositions(b.minX + off, b.maxX - off, step);
  const ys = axisPositions(b.minY + off, b.maxY - off, step);
  if (!xs.length || !ys.length) return null;
  const allowed = ys.map(y => xs.map(x => pointAllowedAtInsetV12(x, y, off)));
  return { xs, ys, allowed, rows: ys.length, cols: xs.length };
}

function latticeKey(r, c) { return `${r},${c}`; }

function nearestAllowedNode(point, lattice) {
  let best = null;
  for (let r = 0; r < lattice.rows; r++) {
    for (let c = 0; c < lattice.cols; c++) {
      if (!lattice.allowed[r][c]) continue;
      const p = { x: lattice.xs[c], y: lattice.ys[r] };
      const d = dist(point, p);
      if (!best || d < best.d) best = { r, c, d };
    }
  }
  return best;
}

function buildSequences(lattice, axis = 'horizontal') {
  const seqs = [];
  let parity = 0;
  if (axis === 'horizontal') {
    for (let r = 0; r < lattice.rows; r++) {
      const runs = [];
      let c = 0;
      while (c < lattice.cols) {
        while (c < lattice.cols && !lattice.allowed[r][c]) c++;
        if (c >= lattice.cols) break;
        const start = c;
        while (c + 1 < lattice.cols && lattice.allowed[r][c + 1]) c++;
        runs.push([start, c]); c++;
      }
      if (!runs.length) continue;
      const dirForward = parity % 2 === 0;
      const orderedRuns = dirForward ? runs : [...runs].reverse();
      orderedRuns.forEach(([a, b]) => {
        const seq = [];
        if (dirForward) for (let cc = a; cc <= b; cc++) seq.push({ r, c: cc });
        else for (let cc = b; cc >= a; cc--) seq.push({ r, c: cc });
        seqs.push(seq);
      });
      parity++;
    }
  } else {
    for (let c = 0; c < lattice.cols; c++) {
      const runs = [];
      let r = 0;
      while (r < lattice.rows) {
        while (r < lattice.rows && !lattice.allowed[r][c]) r++;
        if (r >= lattice.rows) break;
        const start = r;
        while (r + 1 < lattice.rows && lattice.allowed[r + 1][c]) r++;
        runs.push([start, r]); r++;
      }
      if (!runs.length) continue;
      const dirForward = parity % 2 === 0;
      const orderedRuns = dirForward ? runs : [...runs].reverse();
      orderedRuns.forEach(([a, b]) => {
        const seq = [];
        if (dirForward) for (let rr = a; rr <= b; rr++) seq.push({ r: rr, c });
        else for (let rr = b; rr >= a; rr--) seq.push({ r: rr, c });
        seqs.push(seq);
      });
      parity++;
    }
  }
  return seqs;
}

function nodeWorld(node, lattice) {
  return { x: lattice.xs[node.c], y: lattice.ys[node.r] };
}

function shortestGridPath(start, goal, lattice, blocked = new Set()) {
  const sk = latticeKey(start.r, start.c), gk = latticeKey(goal.r, goal.c);
  if (sk === gk) return [start];
  const q = [start];
  let qi = 0;
  const parent = new Map();
  const seen = new Set([sk]);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (qi < q.length) {
    const cur = q[qi++];
    for (const [dr, dc] of dirs) {
      const r = cur.r + dr, c = cur.c + dc;
      if (r < 0 || c < 0 || r >= lattice.rows || c >= lattice.cols || !lattice.allowed[r][c]) continue;
      const k = latticeKey(r, c);
      if (seen.has(k)) continue;
      if (blocked.has(k) && k !== gk) continue;
      seen.add(k); parent.set(k, cur);
      const n = { r, c };
      if (k === gk) {
        const path = [n]; let walk = cur;
        while (true) {
          path.push(walk);
          const wk = latticeKey(walk.r, walk.c);
          if (wk === sk) break;
          walk = parent.get(wk);
        }
        return path.reverse();
      }
      q.push(n);
    }
  }
  return null;
}

function constructCandidate(seqs, lattice, entrancePoint) {
  if (!seqs.length) return null;
  const firstP = nodeWorld(seqs[0][0], lattice);
  const lastSeq = seqs[seqs.length - 1];
  const lastP = nodeWorld(lastSeq[lastSeq.length - 1], lattice);
  let ordered = seqs;
  if (dist(entrancePoint, lastP) < dist(entrancePoint, firstP)) {
    ordered = [...seqs].reverse().map(seq => [...seq].reverse());
  }

  const used = new Set();
  const nodes = [];
  let skipped = 0;
  let current = ordered[0][0];
  nodes.push(current); used.add(latticeKey(current.r, current.c));

  for (const seq of ordered) {
    const target = seq[0];
    if (current.r !== target.r || current.c !== target.c) {
      let connector = shortestGridPath(current, target, lattice, used);
      if (!connector) connector = shortestGridPath(current, target, lattice, new Set());
      if (!connector) { skipped += seq.length; continue; }
      for (const n of connector.slice(1)) { nodes.push(n); used.add(latticeKey(n.r, n.c)); }
      current = target;
    }
    for (const n of seq) {
      if (n.r === current.r && n.c === current.c) continue;
      nodes.push(n); used.add(latticeKey(n.r, n.c)); current = n;
    }
  }
  const unique = new Set(nodes.map(n => latticeKey(n.r, n.c))).size;
  return { nodes, coverage: unique, skipped };
}

function orthogonalConnector(a, b, prefer = 'x') {
  const c1 = [a, { x: b.x, y: a.y }, b];
  const c2 = [a, { x: a.x, y: b.y }, b];
  return prefer === 'x' ? c1 : c2;
}

function pointSafeForConnector(x, y, endpoints = []) {
  if (endpoints.some(p => dist(p, {x,y}) < 2)) return true;
  return insideRoom(x, y, true) && !pointExcluded(x, y);
}

function segmentSafe(a, b, endpoints = []) {
  if (!nearly(a.x, b.x) && !nearly(a.y, b.y)) return false;
  const len = dist(a, b);
  const n = Math.max(2, Math.ceil(len / 30));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (!pointSafeForConnector(x, y, endpoints)) return false;
  }
  return true;
}

function segmentsIntersect(a,b,c,d) {
  const h1 = nearly(a.y,b.y), h2 = nearly(c.y,d.y);
  if (h1 && h2) {
    if (!nearly(a.y,c.y)) return false;
    const a0=Math.min(a.x,b.x), a1=Math.max(a.x,b.x), c0=Math.min(c.x,d.x), c1=Math.max(c.x,d.x);
    return Math.min(a1,c1) - Math.max(a0,c0) > 0.5;
  }
  if (!h1 && !h2) {
    if (!nearly(a.x,c.x)) return false;
    const a0=Math.min(a.y,b.y), a1=Math.max(a.y,b.y), c0=Math.min(c.y,d.y), c1=Math.max(c.y,d.y);
    return Math.min(a1,c1) - Math.max(a0,c0) > 0.5;
  }
  const h = h1 ? [a,b] : [c,d], v = h1 ? [c,d] : [a,b];
  const x=v[0].x, y=h[0].y;
  return x >= Math.min(h[0].x,h[1].x)-0.5 && x <= Math.max(h[0].x,h[1].x)+0.5 &&
         y >= Math.min(v[0].y,v[1].y)-0.5 && y <= Math.max(v[0].y,v[1].y)+0.5;
}

function validRoute(points) {
  if (!points || points.length < 2) return false;
  const endpoints = [points[0], points[points.length-1]];
  for (let i=1;i<points.length;i++) if (!segmentSafe(points[i-1], points[i], endpoints)) return false;
  for (let i=0;i<points.length-1;i++) {
    for (let j=i+2;j<points.length-1;j++) {
      if (j === i+1) continue;
      if (segmentsIntersect(points[i],points[i+1],points[j],points[j+1])) {
        const shared = nearly(points[i+1].x,points[j].x) && nearly(points[i+1].y,points[j].y);
        if (!shared) return false;
      }
    }
  }
  return true;
}

function connectEndpoint(port, node, side, reverse = false) {
  let pts;
  if (side === 'left' || side === 'right') pts = [port, {x: node.x, y: port.y}, node];
  else pts = [port, {x: port.x, y: node.y}, node];
  pts = cleanPolyline(pts);
  return reverse ? [...pts].reverse() : pts;
}

function generateComplexRoute() {
  const lattice = buildLattice();
  const ports = routePorts();
  if (!lattice || !ports) return null;
  const candidates = [];
  for (const axis of ['horizontal', 'vertical']) {
    const baseSeqs = buildSequences(lattice, axis);
    for (const reverse of [false,true]) {
      const seqs = reverse ? [...baseSeqs].reverse().map(x=>[...x].reverse()) : baseSeqs;
      const c = constructCandidate(seqs, lattice, ports.supply);
      if (!c || c.skipped) continue;
      const core = c.nodes.map(n => nodeWorld(n, lattice));
      if (!core.length) continue;
      const start = connectEndpoint(ports.supply, core[0], ports.supplySide, false);
      const finish = connectEndpoint(ports.ret, core[core.length-1], ports.returnSide, true);
      const route = cleanPolyline([...start, ...core.slice(1), ...finish.slice(1)]);
      if (!validRoute(route)) continue;
      candidates.push({route, score: routeLength(route)});
    }
  }
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0] || null;
}


// ===== v0.8: генерация нескольких физически проверяемых вариантов =====
function evenLanePositionsV8(min, max, step, wantEven = true) {
  const span = max - min;
  if (span < step * 0.5) return [];
  let count = Math.floor(span / step) + 1;
  if (wantEven && count % 2 === 1) count -= 1;
  if (!wantEven && count % 2 === 0) count -= 1;
  if (count < 2) return [];
  const used = (count - 1) * step;
  const start = min + (span - used) / 2;
  return Array.from({ length: count }, (_, i) => start + i * step);
}

function cleanRouteV8(points) {
  return cleanPolyline((points || []).filter(Boolean));
}

function spiralInwardCoreV8(width, height, step) {
  const pitch = step * 2;
  let l = 0, t = 0, r = width, b = height;
  const pts = [{ x: l, y: t }];
  let guard = 0;
  while (guard++ < 500) {
    if (!nearly(pts[pts.length - 1].x, r) || !nearly(pts[pts.length - 1].y, t)) pts.push({ x: r, y: t });
    t += pitch;
    if (t > b + 0.001) break;
    pts.push({ x: r, y: b });
    r -= pitch;
    if (r < l - 0.001) break;
    pts.push({ x: l, y: b });
    b -= pitch;
    if (b < t - 0.001) break;
    pts.push({ x: l, y: t });
    l += pitch;
    if (l > r + 0.001) break;
  }
  return cleanRouteV8(pts);
}

function spiralCoreCandidatesV8(width, height, step) {
  if (width < step * 2.4 || height < step * 2.4) return [];
  const supply = spiralInwardCoreV8(width, height, step);
  const returnInnerRaw = spiralInwardCoreV8(width - step * 2, height - step * 2, step);
  if (supply.length < 2 || returnInnerRaw.length < 2) return [];
  const returnInner = returnInnerRaw.map(p => ({ x: p.x + step, y: p.y + step }));
  const a = supply[supply.length - 1];
  const b = returnInner[returnInner.length - 1];
  const bends = [
    { x: a.x, y: b.y },
    { x: b.x, y: a.y },
  ];
  const out = [];
  for (const bend of bends) {
    const middle = (nearly(a.x, b.x) || nearly(a.y, b.y) ||
      (nearly(bend.x, a.x) && nearly(bend.y, a.y)) ||
      (nearly(bend.x, b.x) && nearly(bend.y, b.y))) ? [] : [bend];
    const route = cleanRouteV8([...supply, ...middle, ...[...returnInner].reverse()]);
    // Проверяем только сам узор; координаты пока локальные, поэтому внутриRoom здесь неприменим.
    let selfCross = false;
    for (let i = 0; i < route.length - 1 && !selfCross; i++) {
      for (let j = i + 2; j < route.length - 1; j++) {
        if (segmentsIntersect(route[i], route[i + 1], route[j], route[j + 1])) {
          const shared = nearly(route[i + 1].x, route[j].x) && nearly(route[i + 1].y, route[j].y);
          if (!shared) { selfCross = true; break; }
        }
      }
    }
    if (!selfCross) out.push(route);
  }
  return out;
}

function snakeCoreV8(width, height, step) {
  const ys = evenLanePositionsV8(0, height, step, true);
  if (ys.length < 2) return null;
  const pts = [];
  ys.forEach((y, i) => {
    if (i % 2 === 0) pts.push({ x: 0, y }, { x: width, y });
    else pts.push({ x: width, y }, { x: 0, y });
  });
  return cleanRouteV8(pts);
}

function transformCoreV8(core, side, farCorner, inner) {
  const { left, top, right, bottom } = inner;
  const W = right - left, H = bottom - top;
  return core.map(({ x: u, y: v }) => {
    if (side === 'left') return { x: left + u, y: farCorner ? bottom - v : top + v };
    if (side === 'right') return { x: right - u, y: farCorner ? bottom - v : top + v };
    if (side === 'top') return { x: farCorner ? right - v : left + v, y: top + u };
    return { x: farCorner ? right - v : left + v, y: bottom - u };
  });
}

function sameSideCollectorV8() {
  if (!state.supply) return null;
  const s = nearestBoundaryPoint(state.supply.x, state.supply.y);
  if (!s) return null;
  let r = state.returnPoint ? nearestBoundaryPoint(state.returnPoint.x, state.returnPoint.y) : null;
  const maxPairGap = Math.max(500, state.pipeStepMm * 4);
  if (!r || r.side !== s.side || dist(s, r) > maxPairGap) {
    const rp = adjacentReturnForSupply(s);
    state.returnPoint = rp;
    r = nearestBoundaryPoint(rp.x, rp.y);
  }
  return { supply: { x: s.x, y: s.y }, ret: { x: r.x, y: r.y }, side: s.side };
}

function tailCorridorOffsetsV8(roomEdge, innerEdge, positive) {
  const gap = Math.abs(innerEdge - roomEdge);
  if (gap < 24) return [roomEdge, roomEdge];
  const a = Math.min(gap * 0.34, Math.max(18, gap - 18));
  const b = Math.min(gap * 0.68, Math.max(a + 18, gap - 5));
  return positive ? [roomEdge + a, roomEdge + b] : [roomEdge - a, roomEdge - b];
}

function attachCollectorTailsV8(core, collector, inner, room) {
  if (!core?.length || !collector) return null;
  const start = core[0], end = core[core.length - 1];
  const s = collector.supply, r = collector.ret, side = collector.side;
  let lead = [], finish = [];
  if (side === 'left') {
    const [x1, x2] = tailCorridorOffsetsV8(room.minX, inner.left, true);
    lead = [s, { x: x1, y: s.y }, { x: x1, y: start.y }, start];
    finish = [end, { x: x2, y: end.y }, { x: x2, y: r.y }, r];
  } else if (side === 'right') {
    const [x1, x2] = tailCorridorOffsetsV8(room.maxX, inner.right, false);
    lead = [s, { x: x1, y: s.y }, { x: x1, y: start.y }, start];
    finish = [end, { x: x2, y: end.y }, { x: x2, y: r.y }, r];
  } else if (side === 'top') {
    const [y1, y2] = tailCorridorOffsetsV8(room.minY, inner.top, true);
    lead = [s, { x: s.x, y: y1 }, { x: start.x, y: y1 }, start];
    finish = [end, { x: end.x, y: y2 }, { x: r.x, y: y2 }, r];
  } else {
    const [y1, y2] = tailCorridorOffsetsV8(room.maxY, inner.bottom, false);
    lead = [s, { x: s.x, y: y1 }, { x: start.x, y: y1 }, start];
    finish = [end, { x: end.x, y: y2 }, { x: r.x, y: y2 }, r];
  }
  return cleanRouteV8([...lead, ...core.slice(1), ...finish.slice(1)]);
}

function buildRectPatternVariantsV8(coreFactory) {
  if (state.shapeType && state.shapeType !== 'rect') return [];
  if (state.sections.length !== 1 || state.excluded.size) return [];
  const collector = sameSideCollectorV8();
  if (!collector) return [];
  const b = state.bounds;
  const off = Math.max(0, state.wallOffsetMm);
  const inner = { left: b.minX + off, top: b.minY + off, right: b.maxX - off, bottom: b.maxY - off };
  const W = inner.right - inner.left, H = inner.bottom - inner.top;
  if (W < state.pipeStepMm * 1.5 || H < state.pipeStepMm * 1.5) return [];
  const localW = (collector.side === 'left' || collector.side === 'right') ? W : H;
  const localH = (collector.side === 'left' || collector.side === 'right') ? H : W;
  const coreOptions = coreFactory(localW, localH, state.pipeStepMm) || [];
  const cores = Array.isArray(coreOptions?.[0]) ? coreOptions : (coreOptions ? [coreOptions] : []);
  const candidates = [];
  for (const coreLocal of cores) {
    for (const farCorner of [false, true]) {
      const core = transformCoreV8(coreLocal, collector.side, farCorner, inner);
      const route = attachCollectorTailsV8(core, collector, inner, b);
      if (!route || route.length < 4 || !validRoute(route)) continue;
      candidates.push(route);
    }
  }
  candidates.sort((a, b2) => routeLength(a) - routeLength(b2));
  return candidates;
}

function createRouteCandidatesV8() {
  const out = [];
  const push = (id, name, desc, route) => {
    if (!route || route.length < 2 || !validRoute(route)) return;
    out.push({ id, name, desc, route, length: routeLength(route) });
  };

  if ((!state.shapeType || state.shapeType === 'rect') && state.sections.length === 1 && !state.excluded.size) {
    const spiral = buildRectPatternVariantsV8(spiralCoreCandidatesV8)[0];
    push('spiral', 'Улитка', 'Подача идёт к центру, обратка возвращается между витками.', spiral);

    const snake = buildRectPatternVariantsV8((w, h, step) => snakeCoreV8(w, h, step))[0];
    push('snake', 'Змейка', 'Последовательные параллельные проходы поперёк помещения.', snake);
  }

  // Для сложной формы оставляем только старый генератор, если он действительно проходит валидацию.
  if (state.shapeType !== 'rect' || state.sections.length !== 1 || state.excluded.size) {
    const complex = generateComplexRoute();
    if (complex?.route && validRoute(complex.route)) push('shape-snake', 'Змейка по форме', 'Черновой вариант для сложной геометрии; показывается только после проверки пересечений.', complex.route);
  }

  return out;
}

function selectRouteCandidateV8(id, close = false) {
  const c = (state.routeCandidates || []).find(x => x.id === id);
  if (!c) return;
  state.selectedRouteCandidate = id;
  state.route = c.route.map(p => ({ ...p }));
  state.routeKind = c.name;
  state.routeComplete = true;
  renderPlan();
  renderRouteCandidatesV8();
  if (close) closeSheetV5();
}

function renderRouteCandidatesV8() {
  const host = $('routeCandidates');
  if (!host) return;
  const list = state.routeCandidates || [];
  if (!list.length) {
    host.innerHTML = '<div class="route-empty">Для этой геометрии пока не найден физически проверенный маршрут. Приложение не будет рисовать сомнительную трассу.</div>';
    return;
  }
  const minLen = Math.min(...list.map(x => x.length));
  host.innerHTML = list.map(c => {
    const delta = c.length - minLen;
    const deltaText = delta < 50 ? 'самый короткий из построенных' : `+ ${(delta / 1000).toFixed(1)} м к самому короткому`;
    return `<button class="route-card${state.selectedRouteCandidate === c.id ? ' active' : ''}" data-route-candidate="${c.id}">`+
      `<span class="route-card-main"><span class="route-card-title">${c.name}</span><span class="route-card-desc">${c.desc}</span></span>`+
      `<span class="route-card-metrics"><span class="route-card-length">${(c.length / 1000).toFixed(1)} м</span><span class="route-card-delta">${deltaText}</span></span>`+
      `</button>`;
  }).join('');
  host.querySelectorAll('[data-route-candidate]').forEach(btn => btn.addEventListener('click', () => selectRouteCandidateV8(btn.dataset.routeCandidate)));
}

function openRouteSheetV8() {
  renderRouteCandidatesV8();
  const subtitle = $('routeSheetSubtitle');
  if (subtitle) subtitle.textContent = state.routeCandidates?.length > 1 ? 'Нажмите вариант — схема сразу изменится' : 'Показан только проверенный вариант';
  openSheetV5('routeSheet');
}

function generateRoute() {
  collectInputs();
  recomputeGeometry();
  if (!state.supply) {
    setStatus('Сначала укажите «Коллектор» на стене помещения.', true);
    return;
  }
  sameSideCollectorV8();
  state.routeCandidates = createRouteCandidatesV8();
  if (!state.routeCandidates.length) {
    resetRoute();
    renderPlan();
    openRouteSheetV8();
    setStatus('Корректный маршрут пока не найден. Для сложной формы генератор ещё дорабатывается.', true);
    return;
  }
  const preferred = state.routeCandidates.find(c => c.id === 'spiral') || state.routeCandidates[0];
  state.selectedRouteCandidate = preferred.id;
  state.route = preferred.route.map(p => ({ ...p }));
  state.routeKind = preferred.name;
  state.routeComplete = true;
  renderPlan();
  openRouteSheetV8();
  setStatus(state.routeCandidates.length > 1 ? `Построено вариантов: ${state.routeCandidates.length}. Сравните длину и выберите рисунок.` : `Построен проверенный вариант: ${preferred.name}.`);
}

function routeLength(route = state.route) {
  let sum = 0;
  for (let i = 1; i < route.length; i++) sum += dist(route[i - 1], route[i]);
  return sum;
}

function roundedPathD(points, radiusMm) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (l1 < 0.001 || l2 < 0.001 || Math.abs(cross) < 0.001) {
      d += ` L ${b.x} ${b.y}`;
      continue;
    }
    const r = Math.min(radiusMm, l1 * 0.45, l2 * 0.45);
    const p1 = { x: b.x + v1.x / l1 * r, y: b.y + v1.y / l1 * r };
    const p2 = { x: b.x + v2.x / l2 * r, y: b.y + v2.y / l2 * r };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function arrowSamples(points, every = 2400) {
  const total = routeLength(points);
  if (total < every * 0.75) return [];
  const targets = [];
  for (let d = Math.min(500, total * 0.25); d < total - 250; d += every) targets.push(d);
  const out = [];
  let segStartD = 0;
  let targetIndex = 0;
  for (let i = 1; i < points.length && targetIndex < targets.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = dist(a, b);
    while (targetIndex < targets.length && targets[targetIndex] <= segStartD + len) {
      const t = len ? (targets[targetIndex] - segStartD) / len : 0;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      out.push({ x, y, angle }); targetIndex++;
    }
    segStartD += len;
  }
  return out;
}

function planMetrics() {
  const scale = state.scale;
  const marginPx = state.shapeType === 'L' ? 86 : 62;
  const margin = marginPx / scale;
  const b = state.bounds;
  return {
    scale, margin,
    viewX: b.minX - margin,
    viewY: b.minY - margin,
    viewW: b.width + margin * 2,
    viewH: b.height + margin * 2,
    pxW: Math.ceil((b.width + margin * 2) * scale),
    pxH: Math.ceil((b.height + margin * 2) * scale),
  };
}

function renderPlan() {
  recomputeGeometry();
  const m = planMetrics();
  planSvg.setAttribute('viewBox', `${m.viewX} ${m.viewY} ${m.viewW} ${m.viewH}`);
  planSvg.setAttribute('width', m.pxW);
  planSvg.setAttribute('height', m.pxH);
  planSvg.style.width = `${m.pxW}px`;
  planSvg.style.height = `${m.pxH}px`;

  const b = state.bounds;
  const scale = state.scale;
  const sw = 1 / scale;
  const textSize = 12 / scale;
  const smallText = 10 / scale;
  const dimOffset = 24 / scale;
  const tick = 6 / scale;
  const boundary = computeOuterBoundarySegments();
  const pattern = `<pattern id="excludedPattern" patternUnits="userSpaceOnUse" width="${10/scale}" height="${10/scale}" patternTransform="rotate(45)"><rect width="100%" height="100%" fill="#fee2e2"/><line x1="0" y1="0" x2="0" y2="${10/scale}" stroke="#fca5a5" stroke-width="${4/scale}"/></pattern>`;
  const baseMask = state.sections.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="white"/>`).join('');
  const addMask = [...state.roomAdded].map(k => { const r=shapeCellRectFromKey(k); return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="white"/>`; }).join('');
  const removeMask = [...state.roomRemoved].map(k => { const r=shapeCellRectFromKey(k); return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="black"/>`; }).join('');
  let html = `<defs><mask id="roomMask"><rect x="${m.viewX}" y="${m.viewY}" width="${m.viewW}" height="${m.viewH}" fill="black"/>${baseMask}${addMask}${removeMask}</mask>${pattern}</defs>`;
  if (state.mode === 'room') {
    const sg = state.shapeStepMm;
    const sx0=Math.floor(m.viewX/sg)*sg, sy0=Math.floor(m.viewY/sg)*sg;
    html += `<g opacity="0.55">`;
    for(let x=sx0;x<=m.viewX+m.viewW;x+=sg) html += `<line x1="${x}" y1="${m.viewY}" x2="${x}" y2="${m.viewY+m.viewH}" stroke="#d1d5db" stroke-width="${0.6/scale}"/>`;
    for(let y=sy0;y<=m.viewY+m.viewH;y+=sg) html += `<line x1="${m.viewX}" y1="${y}" x2="${m.viewX+m.viewW}" y2="${y}" stroke="#d1d5db" stroke-width="${0.6/scale}"/>`;
    html += `</g>`;
  }
  html += `<rect x="${m.viewX}" y="${m.viewY}" width="${m.viewW}" height="${m.viewH}" fill="#ffffff" mask="url(#roomMask)"/>`;

  const rawGridStep = state.gridStepMm;
  const minVisualPx = 4;
  const mult = Math.max(1, Math.ceil(minVisualPx / Math.max(0.1, rawGridStep * scale)));
  const visibleStep = rawGridStep * mult;
  // v0.7.2: сетка рисуется одним SVG-pattern вместо сотен отдельных line.
  // На iPhone это заметно снижает стоимость каждого кадра во время перетягивания.
  const majorStep = visibleStep * 5;
  const minorSw = 0.55 / scale, majorSw = 0.9 / scale;
  let gridPattern = `<pattern id="gridPatternV72" patternUnits="userSpaceOnUse" width="${majorStep}" height="${majorStep}" x="0" y="0">`;
  for (let i = 1; i < 5; i++) {
    const q = i * visibleStep;
    gridPattern += `<line x1="${q}" y1="0" x2="${q}" y2="${majorStep}" stroke="#dde1e6" stroke-width="${minorSw}"/>`;
    gridPattern += `<line x1="0" y1="${q}" x2="${majorStep}" y2="${q}" stroke="#dde1e6" stroke-width="${minorSw}"/>`;
  }
  gridPattern += `<path d="M 0 0 H ${majorStep} M 0 0 V ${majorStep}" fill="none" stroke="#c5cad1" stroke-width="${majorSw}"/></pattern>`;
  html = html.replace('</defs>', `${gridPattern}</defs>`);
  html += `<g mask="url(#roomMask)"><rect x="${b.minX}" y="${b.minY}" width="${b.width}" height="${b.height}" fill="url(#gridPatternV72)"/>`;
  for (const k of state.excluded) {
    const [gx, gy] = parseGridKey(k), r = cellRect(gx, gy);
    html += `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="url(#excludedPattern)"/>`;
  }
  html += `</g>`;

  html += `<g>`;
  boundary.forEach(s => {
    html += `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="#374151" stroke-width="${1.7/scale}" stroke-linecap="square"/>`;
  });
  html += `</g>`;


  // Общие габариты помещения.
  const topY = b.minY - dimOffset;
  html += `<g stroke="#6b7280" fill="#4b5563" stroke-width="${0.9/scale}">`;
  html += `<line x1="${b.minX}" y1="${topY}" x2="${b.maxX}" y2="${topY}"/>`;
  html += `<line x1="${b.minX}" y1="${topY-tick}" x2="${b.minX}" y2="${topY+tick}"/><line x1="${b.maxX}" y1="${topY-tick}" x2="${b.maxX}" y2="${topY+tick}"/>`;
  html += `<text class="legacy-dim-text" x="${(b.minX+b.maxX)/2}" y="${topY-7/scale}" text-anchor="middle" stroke="none" font-size="${textSize}" font-weight="800">${fmtM(b.width)} м</text>`;
  const rightX = b.maxX + dimOffset;
  html += `<line x1="${rightX}" y1="${b.minY}" x2="${rightX}" y2="${b.maxY}"/>`;
  html += `<line x1="${rightX-tick}" y1="${b.minY}" x2="${rightX+tick}" y2="${b.minY}"/><line x1="${rightX-tick}" y1="${b.maxY}" x2="${rightX+tick}" y2="${b.maxY}"/>`;
  html += `<text class="legacy-dim-text" x="${rightX+11/scale}" y="${(b.minY+b.maxY)/2}" text-anchor="middle" stroke="none" font-size="${textSize}" font-weight="800" transform="rotate(90 ${rightX+11/scale} ${(b.minY+b.maxY)/2})">${fmtM(b.height)} м</text>`;
  html += `</g>`;

  // Масштабная линейка 1 м (или 0,5 м для маленькой комнаты).
  const bar = b.width < 1800 ? 500 : 1000;
  const barY = b.maxY + dimOffset;
  html += `<g stroke="#4b5563" fill="#4b5563" stroke-width="${2/scale}"><line x1="${b.minX}" y1="${barY}" x2="${b.minX+bar}" y2="${barY}"/><line x1="${b.minX}" y1="${barY-tick/2}" x2="${b.minX}" y2="${barY+tick/2}"/><line x1="${b.minX+bar}" y1="${barY-tick/2}" x2="${b.minX+bar}" y2="${barY+tick/2}"/><text x="${b.minX+bar/2}" y="${barY+17/scale}" text-anchor="middle" stroke="none" font-size="${smallText}" font-weight="700">${fmtM(bar, bar < 1000 ? 1 : 0)} м</text></g>`;

  if (state.route.length) {
    const d = roundedPathD(state.route, Math.min(75, state.pipeStepMm * 0.45));
    const pipeSw = pipeStrokeWorldV9(scale);
    const haloSw = pipeSw + Math.max(2.2 / scale, pipeSw * 0.28);
    html += `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${haloSw}" stroke-linecap="round" stroke-linejoin="round" opacity="0.94"/>`;
    html += `<path d="${d}" fill="none" stroke="#2563eb" stroke-width="${pipeSw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    for (const a of arrowSamples(state.route, 3200)) {
      const size = Math.max(4.2 / scale, pipeSw * 0.7);
      html += `<g transform="translate(${a.x} ${a.y}) rotate(${a.angle})"><path d="M ${-size} ${-size*0.72} L ${size} 0 L ${-size} ${size*0.72} Z" fill="#2563eb" stroke="#ffffff" stroke-width="${1/scale}"/></g>`;
    }
    const start = state.route[0], end = state.route[state.route.length - 1];
    html += `<circle cx="${start.x}" cy="${start.y}" r="${7/scale}" fill="#10b981" stroke="#ffffff" stroke-width="${2/scale}"/>`;
    html += `<circle cx="${end.x}" cy="${end.y}" r="${7/scale}" fill="#f59e0b" stroke="#ffffff" stroke-width="${2/scale}"/>`;
    html += `<text x="${start.x}" y="${start.y-12/scale}" text-anchor="middle" font-size="${textSize}" font-weight="850" fill="#047857">Подача</text>`;
    html += `<text x="${end.x}" y="${end.y-12/scale}" text-anchor="middle" font-size="${textSize}" font-weight="850" fill="#b45309">Обратка</text>`;
  } else {
    if (state.supply) {
      html += `<circle cx="${state.supply.x}" cy="${state.supply.y}" r="${7/scale}" fill="#10b981" stroke="#fff" stroke-width="${2/scale}"/>`;
      html += `<text x="${state.supply.x}" y="${state.supply.y-12/scale}" text-anchor="middle" font-size="${smallText}" font-weight="800" fill="#047857">Подача</text>`;
    }
    if (state.returnPoint) {
      html += `<circle cx="${state.returnPoint.x}" cy="${state.returnPoint.y}" r="${7/scale}" fill="#f59e0b" stroke="#fff" stroke-width="${2/scale}"/>`;
      html += `<text x="${state.returnPoint.x}" y="${state.returnPoint.y-12/scale}" text-anchor="middle" font-size="${smallText}" font-weight="800" fill="#b45309">Обратка</text>`;
    }
  }

  planSvg.innerHTML = html;
  $('gridInfo').textContent = `${fmtM(b.width)} × ${fmtM(b.height)} м · Ø${Math.round(state.pipeDiameterMm || 16)} · шаг ${Math.round(state.pipeStepMm)} мм`;
  $('routeInfo').textContent = state.route.length
    ? `${state.routeKind} · ≈ ${(routeLength()/1000).toFixed(1)} м${state.routeComplete ? ' · подача → обратка' : ''}`
    : 'Маршрут не построен';
}

const paintGesture = { active: false, pointerId: null, exclude: true, visited: new Set() };
const roomGesture = { active: false, pointerId: null, add: true, visited: new Set() };

function paintAtPoint(p) {
  if (!p || !insideRoom(p.x, p.y, true)) return;
  const { gx, gy } = cellIndexFromPoint(p.x, p.y);
  if (!cellIntersectsRoom(gx, gy)) return;
  const k = gridKey(gx, gy);
  if (paintGesture.visited.has(k)) return;
  paintGesture.visited.add(k);
  if (paintGesture.exclude) state.excluded.add(k); else state.excluded.delete(k);
}

function roomPaintAtPoint(p) {
  if (!p) return;
  const k = shapeCellKeyFromPoint(p.x, p.y);
  if (roomGesture.visited.has(k)) return;
  roomGesture.visited.add(k);
  if (roomGesture.add) {
    state.roomAdded.add(k); state.roomRemoved.delete(k);
  } else {
    state.roomRemoved.add(k); state.roomAdded.delete(k);
  }
}

function endPaintGesture(e) {
  if (!paintGesture.active || (e?.pointerId != null && e.pointerId !== paintGesture.pointerId)) return;
  paintGesture.active = false;
  paintGesture.pointerId = null;
  paintGesture.visited.clear();
  try { if (e?.pointerId != null) planSvg.releasePointerCapture(e.pointerId); } catch {}
}
function endRoomGesture(e) {
  if (!roomGesture.active || (e?.pointerId != null && e.pointerId !== roomGesture.pointerId)) return;
  roomGesture.active = false;
  roomGesture.pointerId = null;
  roomGesture.visited.clear();
  try { if (e?.pointerId != null) planSvg.releasePointerCapture(e.pointerId); } catch {}
  recomputeGeometry(); syncInputs(); renderPlan();
}

function adjacentReturnForSupply(near) {
  const seg = near.seg;
  const gap = Math.max(100, state.pipeStepMm * 0.7);
  if (nearly(seg.y1, seg.y2)) {
    const lo=Math.min(seg.x1,seg.x2), hi=Math.max(seg.x1,seg.x2);
    let x=near.x+gap; if(x>hi) x=near.x-gap;
    return {x:clamp(x,lo,hi), y:near.y, side:near.side};
  }
  const lo=Math.min(seg.y1,seg.y2), hi=Math.max(seg.y1,seg.y2);
  let y=near.y+gap; if(y>hi) y=near.y-gap;
  return {x:near.x, y:clamp(y,lo,hi), side:near.side};
}

planSvg.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  const p = svgPointFromEvent(e);
  if (!p) return;
  if (state.mode === 'room') {
    e.preventDefault();
    roomGesture.active=true; roomGesture.pointerId=e.pointerId;
    roomGesture.add=!insideRoom(p.x,p.y,true); roomGesture.visited.clear();
    resetRoute();
    try { planSvg.setPointerCapture(e.pointerId); } catch {}
    roomPaintAtPoint(p); recomputeGeometry(); renderPlan();
    return;
  }
  if (state.mode === 'exclude') {
    if (!insideRoom(p.x, p.y, true)) return;
    e.preventDefault();
    const { gx, gy } = cellIndexFromPoint(p.x, p.y);
    paintGesture.active = true;
    paintGesture.pointerId = e.pointerId;
    paintGesture.exclude = !state.excluded.has(gridKey(gx, gy));
    paintGesture.visited.clear();
    resetRoute();
    try { planSvg.setPointerCapture(e.pointerId); } catch {}
    paintAtPoint(p);
    renderPlan();
    return;
  }
  if (state.mode === 'supply' || state.mode === 'return') {
    e.preventDefault();
    const near = nearestBoundaryPoint(p.x, p.y);
    if (!near) return;
    if (state.mode === 'supply') {
      state.supply = { x: near.x, y: near.y, side: near.side };
      if (!state.returnPoint) state.returnPoint = adjacentReturnForSupply(near);
      setStatus('Подача выбрана. Обратка поставлена рядом автоматически — при необходимости выберите «Обратка» и переставьте её.');
    } else {
      state.returnPoint = { x: near.x, y: near.y, side: near.side };
      setStatus('Обратка выбрана отдельно.');
    }
    resetRoute(); renderPlan();
  }
});

planSvg.addEventListener('pointermove', (e) => {
  if (roomGesture.active && e.pointerId === roomGesture.pointerId) {
    e.preventDefault(); roomPaintAtPoint(svgPointFromEvent(e)); recomputeGeometry(); renderPlan(); return;
  }
  if (!paintGesture.active || e.pointerId !== paintGesture.pointerId) return;
  e.preventDefault(); paintAtPoint(svgPointFromEvent(e)); renderPlan();
});
planSvg.addEventListener('pointerup', (e)=>{endPaintGesture(e); endRoomGesture(e);});
planSvg.addEventListener('pointercancel', (e)=>{endPaintGesture(e); endRoomGesture(e);});
planSvg.addEventListener('lostpointercapture', (e)=>{endPaintGesture(e); endRoomGesture(e);});

function collectInputs() {
  state.name = $('nameInput').value.trim();
  state.object = $('objectInput').value.trim();
  state.pipeStepMm = clamp((Number($('pipeStepInput').value) || 0.15) * 1000, 50, 500);
  if ($('pipeDiameterInput')) state.pipeDiameterMm = clamp(Number($('pipeDiameterInput').value) || 16, 8, 32);
  if ($('pipeRenderModeInput')) state.pipeRenderMode = $('pipeRenderModeInput').value === 'scheme' ? 'scheme' : 'scale';
  if (typeof updatePipeGeometryInfoV9 === 'function') updatePipeGeometryInfoV9();
  state.wallOffsetMm = clamp((Number($('wallOffsetInput').value) || 0.10) * 1000, 0, 1000);
  state.gridStepMm = clamp((Number($('gridStepInput').value) || 0.05) * 1000, 20, 500);
  $('schemeTitle').textContent = state.name || 'Новая схема';
}

function serializeState() {
  collectInputs();
  return {
    version: 4, id: state.id, sections: state.sections, excluded: [...state.excluded],
    roomAdded: [...state.roomAdded], roomRemoved: [...state.roomRemoved], shapeStepMm: state.shapeStepMm,
    supply: state.supply, returnPoint: state.returnPoint,
    route: state.route, routeKind: state.routeKind, routeComplete: state.routeComplete,
    name: state.name, object: state.object, gridStepMm: state.gridStepMm, pipeStepMm: state.pipeStepMm, wallOffsetMm: state.wallOffsetMm,
    updatedAt: new Date().toISOString(),
  };
}

function saveScheme() {
  const item = serializeState();
  const all = loadAll();
  const idx = all.findIndex(x => x.id === item.id);
  if (idx >= 0) all[idx] = item; else all.unshift(item);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  setStatus('Схема сохранена на устройстве.');
}

function migrateItem(item) {
  if (!item) return null;
  if (item.version === 4 && item.sections?.[0]?.width != null) return item;
  if (item.version === 3 && item.sections?.[0]?.width != null) {
    const supply = item.supply || item.entrance || null;
    return {
      ...item, version: 4, supply, returnPoint: item.returnPoint || null,
      roomAdded: item.roomAdded || [], roomRemoved: item.roomRemoved || [], shapeStepMm: item.shapeStepMm || 100,
      route: [], routeKind: '', routeComplete: false,
    };
  }
  const cell = Number(item.cellSizeMm) || 50;
  let sections = item.sections;
  if (!sections?.length) sections = [{ id: uuid(), r: 0, c: 0, rows: item.rows || 14, cols: item.cols || 20, base: true }];
  const v3sections = sections.map((sec, i) => ({
    id: sec.id || uuid(), name: sec.name || (i ? 'Часть' : 'Основной'),
    x: (sec.c || 0) * cell, y: (sec.r || 0) * cell,
    width: (sec.cols || 20) * cell, height: (sec.rows || 14) * cell,
    base: !!sec.base || i === 0,
  }));
  const excluded = (item.excluded || []).map(k => {
    const [r, c] = String(k).split(',').map(Number);
    return gridKey(c, r);
  });
  const supply = item.entrance ? { x: (item.entrance.c + 0.5) * cell, y: (item.entrance.r + 0.5) * cell, side: 'left' } : null;
  return {
    version: 4, id: item.id || uuid(), sections: v3sections, excluded,
    roomAdded: [], roomRemoved: [], shapeStepMm: 100, supply, returnPoint: null,
    route: [], routeKind: '', routeComplete: false,
    name: item.name || '', object: item.object || '', gridStepMm: cell, pipeStepMm: 150, wallOffsetMm: 100,
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

function loadAll() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (current.length) return current.map(migrateItem).filter(Boolean);
    const v3 = JSON.parse(localStorage.getItem(V3_STORAGE_KEY) || '[]');
    const prev = JSON.parse(localStorage.getItem(PREV_STORAGE_KEY) || '[]');
    const legacy = v3.length ? v3 : (prev.length ? prev : JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]'));
    const migrated = legacy.map(migrateItem).filter(Boolean);
    if (migrated.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch { return []; }
}

function loadScheme(raw) {
  const item = migrateItem(raw);
  state.id = item.id;
  state.sections = item.sections.map(sec => ({ ...sec }));
  state.excluded = new Set(item.excluded || []);
  state.roomAdded = new Set(item.roomAdded || []);
  state.roomRemoved = new Set(item.roomRemoved || []);
  state.shapeStepMm = Number(item.shapeStepMm) || 100;
  state.supply = item.supply || null;
  state.returnPoint = item.returnPoint || null;
  state.route = item.route || [];
  state.routeKind = item.routeKind || '';
  state.routeComplete = !!item.routeComplete;
  state.name = item.name || '';
  state.object = item.object || '';
  state.gridStepMm = Number(item.gridStepMm) || 50;
  state.pipeStepMm = Number(item.pipeStepMm) || 150;
  state.wallOffsetMm = Number(item.wallOffsetMm) || 100;
  state.scale = 0.09;
  state.mode = 'room';
  recomputeGeometry(); syncInputs(); setMode('room'); showView('editor');
  requestAnimationFrame(() => { fitPlan(false); renderPlan(); });
}

function deleteScheme(id) {
  const all = loadAll().filter(x => x.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  renderSchemes();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
}

function renderSchemes() {
  const list = $('schemesList');
  const q = $('searchInput').value.trim().toLowerCase();
  const items = loadAll().filter(x => `${x.name || ''} ${x.object || ''}`.toLowerCase().includes(q));
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div class="card empty-card">Пока нет сохранённых схем.</div>'; return; }
  for (const item of items) {
    const b = (() => {
      const ss = item.sections || [];
      if (!ss.length) return { width: 0, height: 0 };
      const minX = Math.min(...ss.map(s => s.x)), minY = Math.min(...ss.map(s => s.y));
      const maxX = Math.max(...ss.map(s => s.x + s.width)), maxY = Math.max(...ss.map(s => s.y + s.height));
      return { width: maxX - minX, height: maxY - minY };
    })();
    const card = document.createElement('div'); card.className = 'scheme-card';
    const left = document.createElement('div');
    left.innerHTML = `<h4>${escapeHtml(item.name || 'Без названия')}</h4><div class="scheme-meta">${escapeHtml(item.object || 'Без объекта')} · ${fmtM(b.width)}×${fmtM(b.height)} м</div>`;
    const actions = document.createElement('div');
    const open = document.createElement('button'); open.className = 'ghost-btn small'; open.textContent = 'Открыть'; open.addEventListener('click', () => loadScheme(item));
    const del = document.createElement('button'); del.className = 'ghost-btn small'; del.textContent = '×'; del.addEventListener('click', () => deleteScheme(item.id));
    actions.append(open, del); card.append(left, actions); list.appendChild(card);
  }
}

function setStatus(text, isError = false) {
  status.textContent = text;
  status.style.color = isError ? '#b91c1c' : '#6b7280';
}

async function exportPng() {
  if (!state.route.length) { setStatus('Сначала постройте раскладку.', true); return; }
  const clone = planSvg.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  const svgText = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const width = Math.min(2400, Math.max(800, planSvg.width.baseVal.value * 2));
    const ratio = planSvg.height.baseVal.value / Math.max(1, planSvg.width.baseVal.value);
    const height = Math.max(600, Math.round(width * ratio));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(png => {
      const pngUrl = URL.createObjectURL(png); const a = document.createElement('a');
      a.href = pngUrl; a.download = `${state.name || 'warm-floor-layout'}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1200);
    }, 'image/png');
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); setStatus('Не удалось создать PNG.', true); };
  img.src = url;
}


// ===== v0.5: полноэкранный редактор и крупные геометрические примитивы =====
const legacyRenderPlanV4 = renderPlan;
const legacyLoadAllV4 = loadAll;
const SNAP_MM = 50;
const historyV5 = [];
const shapeDragV5 = { active:false, pointerId:null, handle:null };
const rectGestureV5 = { active:false, pointerId:null, kind:null, start:null, current:null };
let statusTimerV5 = null;

Object.assign(state, {
  shapeType: 'rect',
  shapeOrientation: 0,
  shapeParams: { w:4000, h:3000, notchW:1500, notchH:1300, stemW:1400, barH:900 },
  selectedPreset: 'rect',
});

const snapV5 = v => Math.round(v / SNAP_MM) * SNAP_MM;
function cloneV5(v){ return JSON.parse(JSON.stringify(v)); }

function snapshotV5(){
  return {
    sections: cloneV5(state.sections), shapeType: state.shapeType, shapeOrientation: state.shapeOrientation,
    shapeParams: cloneV5(state.shapeParams), excluded:[...state.excluded], supply:cloneV5(state.supply), returnPoint:cloneV5(state.returnPoint),
    gridStepMm:state.gridStepMm, pipeStepMm:state.pipeStepMm, wallOffsetMm:state.wallOffsetMm,
  };
}
function pushHistoryV5(){
  historyV5.push(snapshotV5());
  if(historyV5.length>30) historyV5.shift();
  $('undoBtn')?.classList.toggle('disabled', !historyV5.length);
}
function undoV5(){
  const s=historyV5.pop(); if(!s){ setStatus('Отменять пока нечего.'); return; }
  state.sections=cloneV5(s.sections); state.shapeType=s.shapeType; state.shapeOrientation=s.shapeOrientation;
  state.shapeParams=cloneV5(s.shapeParams); state.excluded=new Set(s.excluded||[]); state.supply=s.supply; state.returnPoint=s.returnPoint;
  state.gridStepMm=s.gridStepMm; state.pipeStepMm=s.pipeStepMm; state.wallOffsetMm=s.wallOffsetMm;
  resetRoute(); recomputeGeometry(); syncShapeUiV5(); fitPlan(false); renderPlan();
  $('undoBtn')?.classList.toggle('disabled', !historyV5.length);
  setStatus('Последнее изменение отменено.');
}

function clampShapeParamsV5(){
  const p=state.shapeParams;
  p.w=clamp(snapV5(p.w||4000),500,30000); p.h=clamp(snapV5(p.h||3000),500,30000);
  p.notchW=clamp(snapV5(p.notchW||p.w*.38),300,Math.max(300,p.w-500));
  p.notchH=clamp(snapV5(p.notchH||p.h*.42),300,Math.max(300,p.h-500));
  p.stemW=clamp(snapV5(p.stemW||p.w*.35),300,Math.max(300,p.w-300));
  p.barH=clamp(snapV5(p.barH||p.h*.3),300,Math.max(300,p.h-300));
}

function sectionsForShapeV5(type=state.shapeType){
  clampShapeParamsV5();
  const p=state.shapeParams, W=p.w, H=p.h, o=((state.shapeOrientation%4)+4)%4;
  const mk=(x,y,width,height,base=false)=>({id:uuid(),name:base?'Основной':'Часть',x,y,width,height,base});
  if(type==='rect') return [mk(0,0,W,H,true)];
  if(type==='L'){
    const nw=p.notchW, nh=p.notchH;
    if(o===0) return [mk(0,0,W-nw,H,true), mk(W-nw,nh,nw,H-nh,false)];       // вырез сверху справа
    if(o===1) return [mk(0,0,W-nw,H,true), mk(W-nw,0,nw,H-nh,false)];       // снизу справа
    if(o===2) return [mk(nw,0,W-nw,H,true), mk(0,0,nw,H-nh,false)];         // снизу слева
    return [mk(nw,0,W-nw,H,true), mk(0,nh,nw,H-nh,false)];                  // сверху слева
  }
  if(type==='T'){
    const sw=Math.min(p.stemW,o%2===0?W-300:H-300), bh=p.barH;
    if(o===0){ const x=(W-sw)/2; return [mk(0,0,W,bh,true),mk(x,bh,sw,H-bh,false)]; }
    if(o===2){ const x=(W-sw)/2; return [mk(0,H-bh,W,bh,true),mk(x,0,sw,H-bh,false)]; }
    if(o===1){ const y=(H-sw)/2; return [mk(W-bh,0,bh,H,true),mk(0,y,W-bh,sw,false)]; }
    const y=(H-sw)/2; return [mk(0,0,bh,H,true),mk(bh,y,W-bh,sw,false)];
  }
  return state.sections;
}

function applyShapeV5(type=state.shapeType, preserveSize=true){
  if(type==='custom') return;
  if(!preserveSize){
    state.shapeParams={w:4000,h:3000,notchW:1500,notchH:1300,stemW:1400,barH:900};
  }
  state.shapeType=type; state.selectedPreset=type;
  state.sections=sectionsForShapeV5(type);
  state.roomAdded.clear(); state.roomRemoved.clear(); state.excluded.clear();
  state.supply=null; state.returnPoint=null; resetRoute(); recomputeGeometry(); syncShapeUiV5();
}

function shapeHandlesV5(){
  if(state.shapeType==='custom') return [];
  const p=state.shapeParams,W=p.w,H=p.h,o=state.shapeOrientation;
  const hs=[
    {id:'width',x:W,y:H/2,label:`${fmtM(W)} м`},
    {id:'height',x:W/2,y:H,label:`${fmtM(H)} м`},
    {id:'both',x:W,y:H,label:''},
  ];
  if(state.shapeType==='L'){
    let x,y;
    if(o===0){x=W-p.notchW;y=p.notchH;} if(o===1){x=W-p.notchW;y=H-p.notchH;}
    if(o===2){x=p.notchW;y=H-p.notchH;} if(o===3){x=p.notchW;y=p.notchH;}
    hs.push({id:'inner',x,y,label:'вырез',inner:true});
  }
  if(state.shapeType==='T'){
    let x,y;
    if(o===0){x=(W-p.stemW)/2;y=p.barH;} if(o===2){x=(W-p.stemW)/2;y=H-p.barH;}
    if(o===1){x=W-p.barH;y=(H-p.stemW)/2;} if(o===3){x=p.barH;y=(H-p.stemW)/2;}
    hs.push({id:'inner',x,y,label:'форма',inner:true});
  }
  return hs;
}

function dragShapeHandleV5(handle,pnt){
  const p=state.shapeParams; const o=state.shapeOrientation;
  const x=snapV5(pnt.x), y=snapV5(pnt.y);
  if(handle==='width'||handle==='both') p.w=clamp(x,500,30000);
  if(handle==='height'||handle==='both') p.h=clamp(y,500,30000);
  clampShapeParamsV5();
  if(handle==='inner' && state.shapeType==='L'){
    if(o===0){p.notchW=clamp(p.w-x,300,p.w-500);p.notchH=clamp(y,300,p.h-500);}
    if(o===1){p.notchW=clamp(p.w-x,300,p.w-500);p.notchH=clamp(p.h-y,300,p.h-500);}
    if(o===2){p.notchW=clamp(x,300,p.w-500);p.notchH=clamp(p.h-y,300,p.h-500);}
    if(o===3){p.notchW=clamp(x,300,p.w-500);p.notchH=clamp(y,300,p.h-500);}
  }
  if(handle==='inner' && state.shapeType==='T'){
    if(o===0){p.stemW=clamp(p.w-2*x,300,p.w-300);p.barH=clamp(y,300,p.h-300);}
    if(o===2){p.stemW=clamp(p.w-2*x,300,p.w-300);p.barH=clamp(p.h-y,300,p.h-300);}
    if(o===1){p.barH=clamp(p.w-x,300,p.w-300);p.stemW=clamp(p.h-2*y,300,p.h-300);}
    if(o===3){p.barH=clamp(x,300,p.w-300);p.stemW=clamp(p.h-2*y,300,p.h-300);}
  }
  state.sections=sectionsForShapeV5(); resetRoute(); recomputeGeometry(); syncShapeUiV5();
}

function syncShapeUiV5(){
  if(!$('shapeWidthInput')) return;
  $('shapeWidthInput').value=(state.bounds.width/1000).toFixed(2);
  $('shapeHeightInput').value=(state.bounds.height/1000).toFixed(2);
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.shapeType));
  $('orientationRow')?.classList.toggle('hidden', state.shapeType==='rect'||state.shapeType==='custom');
  document.querySelectorAll('[data-orient]').forEach(b=>b.classList.toggle('active',Number(b.dataset.orient)===state.shapeOrientation));
  if($('gridInfo')) $('gridInfo').textContent=`${fmtM(state.bounds.width)} × ${fmtM(state.bounds.height)} м · шаг ${fmtM(state.pipeStepMm)} м`;
}

function showView(name){
  homeView.classList.toggle('active',name==='home'); editorView.classList.toggle('active',name==='editor');
  document.body.classList.toggle('editor-open',name==='editor');
  if(name==='home'){ closeSheetV5(); renderSchemes(); }
}

function newScheme(){
  Object.assign(state,{
    id:uuid(), sections:[], excluded:new Set(), supply:null, returnPoint:null, roomAdded:new Set(), roomRemoved:new Set(), shapeStepMm:100,
    route:[],routeKind:'',routeComplete:false,mode:'shape',name:'',object:'',gridStepMm:50,pipeStepMm:150,wallOffsetMm:100,scale:0.09,
    shapeType:'rect',shapeOrientation:0,shapeParams:{w:4000,h:3000,notchW:1500,notchH:1300,stemW:1400,barH:900}
  });
  historyV5.length=0; applyShapeV5('rect',true); syncInputs(); syncShapeUiV5(); setMode('shape'); showView('editor');
  requestAnimationFrame(()=>{fitPlan(false);renderPlan();centerPlanV5();}); setStatus('');
}

function resetRoomShape(){
  pushHistoryV5(); state.shapeOrientation=0; state.shapeParams={w:4000,h:3000,notchW:1500,notchH:1300,stemW:1400,barH:900};
  applyShapeV5('rect',true); fitPlan(false); renderPlan(); setStatus('Форма сброшена до прямоугольника 4,00 × 3,00 м.');
}

function setMode(mode){
  state.mode=mode;
  planSvg.classList.toggle('shape-mode',mode==='shape'||mode==='inspect');
  planSvg.classList.toggle('draw-mode',mode==='addBlock'||mode==='obstacle');
  planSvg.classList.toggle('collector-mode',mode==='collector');
  const hints={
    shape:'Тяните синие маркеры — размер меняется сразу.',
    addBlock:'Проведите прямоугольник нового участка.',
    obstacle:'Проведите прямоугольник препятствия.',
    collector:'Коснитесь стены у коллектора.',
    inspect:'',
  };
  if(modeHint) modeHint.textContent=hints[mode]||'';
  $('shapeToolBtn')?.classList.toggle('active',mode==='shape'||mode==='addBlock');
  $('obstacleToolBtn')?.classList.toggle('active',mode==='obstacle');
  $('collectorToolBtn')?.classList.toggle('active',mode==='collector');
  renderPlan();
}

function fitPlan(render=true){
  recomputeGeometry(); const b=state.bounds;
  const availableW=Math.max(260,diagramScroll.clientWidth-24); const availableH=Math.max(300,diagramScroll.clientHeight-34);
  const marginPx=58; const sx=(availableW-marginPx*2)/Math.max(1,b.width); const sy=(availableH-marginPx*2)/Math.max(1,b.height);
  state.scale=clamp(Math.min(sx,sy),0.025,0.45);
  if(render){renderPlan();requestAnimationFrame(centerPlanV5);}
}
function centerPlanV5(){
  diagramScroll.scrollLeft=Math.max(0,(planSvg.scrollWidth-diagramScroll.clientWidth)/2);
  diagramScroll.scrollTop=Math.max(0,(planSvg.scrollHeight-diagramScroll.clientHeight)/2);
}

renderPlan = function renderPlanV5(){
  legacyRenderPlanV4(); syncShapeUiV5();
  let extra=''; const sc=state.scale||0.1;
  if(state.mode==='shape' && state.shapeType!=='custom'){
    for(const h of shapeHandlesV5()){
      const r=13/sc, hit=26/sc;
      extra+=`<circle class="shape-handle-hit" data-shape-handle="${h.id}" cx="${h.x}" cy="${h.y}" r="${hit}"/>`;
      extra+=`<circle class="shape-handle${h.inner?' inner':''}" data-shape-handle="${h.id}" cx="${h.x}" cy="${h.y}" r="${r}"/>`;
    }
  }
  if(rectGestureV5.active && rectGestureV5.start && rectGestureV5.current){
    const a=rectGestureV5.start,b=rectGestureV5.current,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);
    extra+=`<rect class="preview-rect" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    if(w>100&&h>100) extra+=`<text class="handle-label" x="${x+w/2}" y="${y+h/2}" text-anchor="middle" font-size="${13/sc}">${fmtM(w)} × ${fmtM(h)} м</text>`;
  }
  if(extra) planSvg.insertAdjacentHTML('beforeend',extra);
}

function setStatus(text,isError=false){
  if(statusTimerV5){clearTimeout(statusTimerV5);statusTimerV5=null;}
  status.textContent=text||''; status.classList.toggle('error',!!isError); status.classList.toggle('visible',!!text);
  if(text) statusTimerV5=setTimeout(()=>status.classList.remove('visible'),4200);
}

function applyShapeSizeFromInputsV5(){
  if(state.shapeType==='custom'){setStatus('Для составной комнаты общий размер меняется отдельными участками.',true);return;}
  pushHistoryV5(); state.shapeParams.w=clamp((Number($('shapeWidthInput').value)||4)*1000,500,30000); state.shapeParams.h=clamp((Number($('shapeHeightInput').value)||3)*1000,500,30000);
  state.sections=sectionsForShapeV5(); resetRoute(); recomputeGeometry(); fitPlan(false); renderPlan(); closeSheetV5();
}

function rectTouchesRoomV5(r){
  const eps=1;
  return state.sections.some(s=>{
    const ox=Math.min(r.x+r.width,s.x+s.width)-Math.max(r.x,s.x);
    const oy=Math.min(r.y+r.height,s.y+s.height)-Math.max(r.y,s.y);
    // Разрешаем реальное перекрытие или касание целым отрезком, но не одним углом.
    return (ox>eps && oy>=-eps) || (oy>eps && ox>=-eps);
  });
}
function commitBlockV5(a,b){
  const x=snapV5(Math.min(a.x,b.x)),y=snapV5(Math.min(a.y,b.y)); const x2=snapV5(Math.max(a.x,b.x)),y2=snapV5(Math.max(a.y,b.y));
  const r={x,y,width:x2-x,height:y2-y}; if(r.width<200||r.height<200){setStatus('Участок слишком маленький.',true);return;}
  if(!rectTouchesRoomV5(r)){setStatus('Новый участок должен касаться существующей комнаты.',true);return;}
  pushHistoryV5(); state.sections.push({id:uuid(),name:'Участок',...r,base:false}); state.shapeType='custom'; state.selectedPreset='custom'; state.supply=null;state.returnPoint=null;resetRoute();recomputeGeometry();syncShapeUiV5();fitPlan(false);renderPlan();
  setStatus(`Участок ${fmtM(r.width)} × ${fmtM(r.height)} м добавлен.`);
}
function commitObstacleV5(a,b){
  const x1=Math.min(a.x,b.x),y1=Math.min(a.y,b.y),x2=Math.max(a.x,b.x),y2=Math.max(a.y,b.y); if(x2-x1<50||y2-y1<50)return;
  pushHistoryV5(); const g=state.gridStepMm;
  for(let gx=Math.floor(x1/g);gx<=Math.floor((x2-0.01)/g);gx++) for(let gy=Math.floor(y1/g);gy<=Math.floor((y2-0.01)/g);gy++){
    const r=cellRect(gx,gy),cx=r.x+r.width/2,cy=r.y+r.height/2; if(insideRoom(cx,cy,true)) state.excluded.add(gridKey(gx,gy));
  }
  resetRoute();renderPlan();setStatus('Препятствие добавлено.');
}

function openSheetV5(id){
  closeSheetV5(false); const el=$(id); if(!el)return; el.classList.add('open'); $('sheetBackdrop')?.classList.add('open');
}
function closeSheetV5(hideBackdrop=true){
  document.querySelectorAll('.bottom-sheet.open').forEach(x=>x.classList.remove('open'));
  if(hideBackdrop)$('sheetBackdrop')?.classList.remove('open');
}

function serializeState(){
  collectInputs(); return {
    version:5,id:state.id,sections:state.sections,excluded:[...state.excluded],roomAdded:[],roomRemoved:[],shapeStepMm:100,
    supply:state.supply,returnPoint:state.returnPoint,route:state.route,routeKind:state.routeKind,routeComplete:state.routeComplete,
    name:state.name,object:state.object,gridStepMm:state.gridStepMm,pipeStepMm:state.pipeStepMm,wallOffsetMm:state.wallOffsetMm,
    shapeType:state.shapeType,shapeOrientation:state.shapeOrientation,shapeParams:state.shapeParams,updatedAt:new Date().toISOString()
  };
}
function migrateItem(item){
  if(!item)return null;
  if(item.version===5)return item;
  const migrated=(item.version===4&&item.sections?.length)?{...item}:{...item,version:4};
  const ss=migrated.sections||[makeBaseSection()];
  const minX=Math.min(...ss.map(s=>s.x)),minY=Math.min(...ss.map(s=>s.y)),maxX=Math.max(...ss.map(s=>s.x+s.width)),maxY=Math.max(...ss.map(s=>s.y+s.height));
  return {...migrated,version:5,shapeType:ss.length===1?'rect':'custom',shapeOrientation:0,shapeParams:{w:maxX-minX,h:maxY-minY,notchW:1500,notchH:1300,stemW:1400,barH:900},roomAdded:migrated.roomAdded||[],roomRemoved:migrated.roomRemoved||[]};
}
loadAll = function loadAllV5(){
  try{
    const cur=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); if(cur.length)return cur.map(migrateItem).filter(Boolean);
    const old=JSON.parse(localStorage.getItem(V4_STORAGE_KEY)||'[]'); if(old.length){const m=old.map(migrateItem).filter(Boolean);localStorage.setItem(STORAGE_KEY,JSON.stringify(m));return m;}
    return legacyLoadAllV4().map(migrateItem).filter(Boolean);
  }catch{return [];}
}
function loadScheme(raw){
  const item=migrateItem(raw); state.id=item.id;state.sections=item.sections.map(s=>({...s}));state.excluded=new Set(item.excluded||[]);state.roomAdded=new Set();state.roomRemoved=new Set();state.shapeStepMm=100;
  state.supply=item.supply||null;state.returnPoint=item.returnPoint||null;state.route=item.route||[];state.routeKind=item.routeKind||'';state.routeComplete=!!item.routeComplete;state.name=item.name||'';state.object=item.object||'';
  state.gridStepMm=Number(item.gridStepMm)||50;state.pipeStepMm=Number(item.pipeStepMm)||150;state.pipeDiameterMm=Number(item.pipeDiameterMm)||16;state.pipeRenderMode=item.pipeRenderMode==='scheme'?'scheme':'scale';state.wallOffsetMm=Number(item.wallOffsetMm)||100;state.scale=.09;state.mode='shape';
  state.shapeType=item.shapeType||'custom';state.shapeOrientation=Number(item.shapeOrientation)||0;state.shapeParams=cloneV5(item.shapeParams||{w:4000,h:3000,notchW:1500,notchH:1300,stemW:1400,barH:900});
  historyV5.length=0;recomputeGeometry();syncInputs();syncShapeUiV5();setMode('shape');showView('editor');requestAnimationFrame(()=>{fitPlan(false);renderPlan();centerPlanV5();});
}

// Дополнительные pointer events v0.5. Старые обработчики не срабатывают для новых mode-значений.
planSvg.addEventListener('pointerdown',(e)=>{
  if(e.button>0)return;
  const p=svgPointFromEvent(e);if(!p)return;
  const handle=e.target?.dataset?.shapeHandle;
  if(state.mode==='shape'&&handle){
    e.preventDefault();pushHistoryV5();shapeDragV5.active=true;shapeDragV5.pointerId=e.pointerId;shapeDragV5.handle=handle;try{planSvg.setPointerCapture(e.pointerId)}catch{};return;
  }
  if(state.mode==='addBlock'||state.mode==='obstacle'){
    e.preventDefault();rectGestureV5.active=true;rectGestureV5.pointerId=e.pointerId;rectGestureV5.kind=state.mode;rectGestureV5.start={x:snapV5(p.x),y:snapV5(p.y)};rectGestureV5.current={...rectGestureV5.start};try{planSvg.setPointerCapture(e.pointerId)}catch{};renderPlan();return;
  }
  if(state.mode==='collector'){
    e.preventDefault();const near=nearestBoundaryPoint(p.x,p.y);if(!near)return;pushHistoryV5();state.supply={x:near.x,y:near.y,side:near.side};state.returnPoint=adjacentReturnForSupply(near);resetRoute();setMode('inspect');setStatus('Коллектор установлен: подача и обратка рядом на одной стене.');return;
  }
},true);
planSvg.addEventListener('pointermove',(e)=>{
  if(shapeDragV5.active&&e.pointerId===shapeDragV5.pointerId){e.preventDefault();const p=svgPointFromEvent(e);if(p){dragShapeHandleV5(shapeDragV5.handle,p);renderPlan();}return;}
  if(rectGestureV5.active&&e.pointerId===rectGestureV5.pointerId){e.preventDefault();const p=svgPointFromEvent(e);if(p){rectGestureV5.current={x:snapV5(p.x),y:snapV5(p.y)};renderPlan();}return;}
},true);
function finishV5Pointer(e){
  if(shapeDragV5.active&&e.pointerId===shapeDragV5.pointerId){try{planSvg.releasePointerCapture(e.pointerId)}catch{};shapeDragV5.active=false;shapeDragV5.pointerId=null;shapeDragV5.handle=null;syncShapeUiV5();renderPlan();return;}
  if(rectGestureV5.active&&e.pointerId===rectGestureV5.pointerId){
    try{planSvg.releasePointerCapture(e.pointerId)}catch{};const {kind,start,current}=rectGestureV5;rectGestureV5.active=false;rectGestureV5.pointerId=null;rectGestureV5.kind=null;
    if(kind==='addBlock')commitBlockV5(start,current); else if(kind==='obstacle')commitObstacleV5(start,current);
    setMode('shape');return;
  }
}
planSvg.addEventListener('pointerup',finishV5Pointer,true);planSvg.addEventListener('pointercancel',finishV5Pointer,true);

// Интерфейс v0.5
$('shapeToolBtn')?.addEventListener('click',handleShapeToolV6);
$('obstacleToolBtn')?.addEventListener('click',handleObstacleToolV6);
$('collectorToolBtn')?.addEventListener('click',handleCollectorToolV6);
$('settingsBtn')?.addEventListener('click',()=>openSheetV5('settingsSheet'));
$('sheetBackdrop')?.addEventListener('click',()=>closeSheetV5());
document.querySelectorAll('[data-close-sheet]').forEach(b=>b.addEventListener('click',()=>closeSheetV5()));
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{
  pushHistoryV5(); const type=b.dataset.preset; state.shapeOrientation=0; applyShapeV5(type,true); fitPlan(false);renderPlan();
}));
document.querySelectorAll('[data-orient]').forEach(b=>b.addEventListener('click',()=>{
  if(state.shapeType==='rect'||state.shapeType==='custom')return;pushHistoryV5();state.shapeOrientation=Number(b.dataset.orient)||0;state.sections=sectionsForShapeV5();state.supply=null;state.returnPoint=null;resetRoute();recomputeGeometry();syncShapeUiV5();fitPlan(false);renderPlan();
}));
$('applyShapeSizeBtn')?.addEventListener('click',applyShapeSizeFromInputsV5);
$('addBlockBtn')?.addEventListener('click',()=>{closeSheetV5();setMode('addBlock');});
$('drawObstacleBtn')?.addEventListener('click',handleDrawObstacleV6);
$('clearObstaclesBtn')?.addEventListener('click',handleClearObstaclesV6);
$('undoBtn')?.addEventListener('click',undoV6Bridge);


// UI bindings
$('toggleBaseEditBtn')?.addEventListener('click', () => $('baseEditPanel').classList.toggle('hidden'));
$('resizeBtn')?.addEventListener('click', () => {
  const base = baseSection();
  base.width = clamp((Number($('widthInput').value) || 4) * 1000, 200, 30000);
  base.height = clamp((Number($('heightInput').value) || 3) * 1000, 200, 30000);
  state.roomAdded.clear(); state.roomRemoved.clear(); state.excluded.clear();
  state.supply = null; state.returnPoint = null;
  resetRoute(); recomputeGeometry(); syncInputs(); fitPlan(false); renderPlan();
  setStatus('Основной прямоугольник обновлён. Теперь форму можно дорисовать пальцем.');
});
$('resetShapeBtn')?.addEventListener('click', resetRoomShapeV6);

document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('generateBtn')?.addEventListener('click', generateRoute);
$('saveBtn')?.addEventListener('click', saveScheme);
$('shareBtn')?.addEventListener('click', exportPng);
$('createFirstBtn')?.addEventListener('click', ()=>newScheme());
$('newSchemeBtn')?.addEventListener('click', ()=>newScheme());
$('backBtn')?.addEventListener('click', () => showView('home'));
$('searchInput')?.addEventListener('input', renderSchemes);
$('fitBtn')?.addEventListener('click', () => fitPlan(true));
$('zoomInBtn')?.addEventListener('click', () => zoomBy(1.25));
$('zoomOutBtn')?.addEventListener('click', () => zoomBy(0.8));
$('nameInput')?.addEventListener('input', () => { state.name = $('nameInput').value; $('schemeTitle').textContent = state.name || 'Новая схема'; });
$('objectInput')?.addEventListener('input', () => state.object = $('objectInput').value);
$('pipeStepInput')?.addEventListener('change', () => { state.pipeStepMm = clamp((Number($('pipeStepInput').value) || 0.15)*1000, 50, 500); resetRoute(); renderPlan(); });
$('wallOffsetInput')?.addEventListener('change', () => { state.wallOffsetMm = clamp((Number($('wallOffsetInput').value) || 0.10)*1000, 0, 1000); resetRoute(); renderPlan(); });
$('gridStepInput')?.addEventListener('change', () => {
  const next = clamp((Number($('gridStepInput').value) || 0.05)*1000, 20, 500);
  if (next !== state.gridStepMm && state.excluded.size) {
    state.excluded.clear();
    setStatus('Размер монтажной сетки изменён, поэтому исключённые клетки сброшены.');
  }
  state.gridStepMm = next; resetRoute(); renderPlan();
});

window.addEventListener('resize', () => { if (editorView.classList.contains('active')) renderPlan(); });
$('rotateBtn')?.addEventListener('click', rotatePlanV6);
$('applyDimensionBtn')?.addEventListener('click', applyExactDimensionV6);
// Development build: disable Service Worker caching so every GitHub Pages update is visible immediately.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      const scope = new URL('./', location.href).href; await Promise.all(regs.filter(r => r.scope === scope).map(r => r.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => /^(ufp[-_]|warm[-_])/i.test(k)).map(k => caches.delete(k)));
      }
    } catch (_) {}
  });
}

renderSchemes();

// ===== v0.6: точные углы, редактируемые препятствия, поворот и размеры по нажатию =====
const V5_STORAGE_KEY = 'ufp-schemes-v05';
const SNAP_V6 = 10; // 1 см
const MIN_AXIS_GAP_V6 = 200;
const roomDragV6 = {active:false,pointerId:null,handle:null,sectionId:null,corner:null};
const obstacleDragV6 = {active:false,pointerId:null,kind:null,id:null,handle:null,startPoint:null,startRect:null,current:null};
const blockDragV6 = {active:false,pointerId:null,start:null,current:null};
let editingDimensionV6 = null;
let liveMeasureTimerV6 = null;

Object.assign(state, {
  shapeAxes: null,
  obstacles: [],
  selectedObstacleId: null,
});

const snapV6 = v => Math.round(v / SNAP_V6) * SNAP_V6;
const uniqueIdV6 = () => uuid();

function defaultAxesV6(type='rect', minX=0, minY=0, width=4000, height=3000){
  width=Math.max(800,width); height=Math.max(800,height);
  if(type==='L') return {xs:[minX, minX+Math.round(width*.62), minX+width], ys:[minY, minY+Math.round(height*.42), minY+height]};
  if(type==='T') return {xs:[minX, minX+Math.round(width*.28), minX+Math.round(width*.66), minX+width], ys:[minY, minY+Math.round(height*.30), minY+height]};
  return {xs:[minX,minX+width],ys:[minY,minY+height]};
}
function cloneAxesV6(a){ return a ? {xs:[...a.xs],ys:[...a.ys]} : null; }
function axesBoundsV6(a=state.shapeAxes){
  if(!a||!a.xs?.length||!a.ys?.length) return {...state.bounds};
  const minX=a.xs[0], maxX=a.xs[a.xs.length-1], minY=a.ys[0], maxY=a.ys[a.ys.length-1];
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
function normalizeAxesV6(a=state.shapeAxes){
  if(!a) return;
  a.xs=a.xs.map(snapV6); a.ys=a.ys.map(snapV6);
  for(let i=1;i<a.xs.length;i++) if(a.xs[i]<a.xs[i-1]+MIN_AXIS_GAP_V6) a.xs[i]=a.xs[i-1]+MIN_AXIS_GAP_V6;
  for(let i=1;i<a.ys.length;i++) if(a.ys[i]<a.ys[i-1]+MIN_AXIS_GAP_V6) a.ys[i]=a.ys[i-1]+MIN_AXIS_GAP_V6;
}
function rotatePointV6(p,o=state.shapeOrientation,a=state.shapeAxes){
  const b=axesBoundsV6(a), lx=p.x-b.minX, ly=p.y-b.minY;
  o=((o%4)+4)%4;
  if(o===1) return {x:b.minX+b.height-ly,y:b.minY+lx};
  if(o===2) return {x:b.minX+b.width-lx,y:b.minY+b.height-ly};
  if(o===3) return {x:b.minX+ly,y:b.minY+b.width-lx};
  return {x:p.x,y:p.y};
}
function inverseRotatePointV6(p,o=state.shapeOrientation,a=state.shapeAxes){
  const b=axesBoundsV6(a), rx=p.x-b.minX, ry=p.y-b.minY;
  o=((o%4)+4)%4;
  if(o===1) return {x:b.minX+ry,y:b.minY+b.height-rx};
  if(o===2) return {x:b.minX+b.width-rx,y:b.minY+b.height-ry};
  if(o===3) return {x:b.minX+b.width-ry,y:b.minY+rx};
  return {x:p.x,y:p.y};
}
function rotateRectBetweenOrientationsV6(r,oldO,newO){
  if(!state.shapeAxes) return {...r};
  const pts=[
    {x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}
  ].map(p=>rotatePointV6(inverseRotatePointV6(p,oldO,state.shapeAxes),newO,state.shapeAxes));
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  return {id:r.id,x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
function canonicalRectsV6(type=state.shapeType,a=state.shapeAxes){
  if(!a) return [];
  const x=a.xs,y=a.ys;
  if(type==='rect') return [{x:x[0],y:y[0],width:x[1]-x[0],height:y[1]-y[0]}];
  if(type==='L') return [
    {x:x[0],y:y[0],width:x[1]-x[0],height:y[2]-y[0]},
    {x:x[1],y:y[1],width:x[2]-x[1],height:y[2]-y[1]},
  ];
  if(type==='T') return [
    {x:x[0],y:y[0],width:x[3]-x[0],height:y[1]-y[0]},
    {x:x[1],y:y[1],width:x[2]-x[1],height:y[2]-y[1]},
  ];
  return [];
}
function rotateRectCanonicalV6(r,o=state.shapeOrientation,a=state.shapeAxes){
  const pts=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}].map(p=>rotatePointV6(p,o,a));
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
function sectionsForShapeV6(type=state.shapeType){
  if(type==='custom'||!state.shapeAxes) return state.sections;
  normalizeAxesV6();
  return canonicalRectsV6(type).map((r,i)=>({id:`preset-${i}`,name:i?'Часть':'Основной',...rotateRectCanonicalV6(r),base:i===0}));
}
sectionsForShapeV5 = sectionsForShapeV6;

function ensureShapeAxesV6(){
  if(state.shapeType==='custom') return;
  if(state.shapeAxes) return;
  const p=state.shapeParams||{};
  const b=state.bounds?.width>1?state.bounds:{minX:0,minY:0,width:p.w||4000,height:p.h||3000};
  if(state.shapeType==='L' && !state.shapeOrientation){
    const W=p.w||b.width,H=p.h||b.height;
    state.shapeAxes={xs:[b.minX,b.minX+W-(p.notchW||Math.round(W*.38)),b.minX+W],ys:[b.minY,b.minY+(p.notchH||Math.round(H*.42)),b.minY+H]};
  } else if(state.shapeType==='T' && !state.shapeOrientation){
    const W=p.w||b.width,H=p.h||b.height,sw=p.stemW||Math.round(W*.35),x1=b.minX+(W-sw)/2;
    state.shapeAxes={xs:[b.minX,x1,x1+sw,b.minX+W],ys:[b.minY,b.minY+(p.barH||Math.round(H*.30)),b.minY+H]};
  } else {
    state.shapeAxes=defaultAxesV6(state.shapeType,b.minX||0,b.minY||0,b.width||4000,b.height||3000);
    if(state.shapeOrientation && state.shapeType!=='rect'){
      // Старые сохранения с поворотом оставляем геометрически корректными, но переводим в свободную форму.
      state.shapeType='custom'; state.shapeAxes=null;
    }
  }
}

function applyShapeV5(type=state.shapeType,preserveSize=true){
  const b=state.bounds?.width>10?state.bounds:{minX:0,minY:0,width:4000,height:3000};
  const W=preserveSize?b.width:4000,H=preserveSize?b.height:3000;
  state.shapeType=type; state.selectedPreset=type; state.shapeOrientation=0;
  state.shapeAxes=defaultAxesV6(type,b.minX||0,b.minY||0,W,H);
  state.sections=sectionsForShapeV6(type);
  state.roomAdded.clear();state.roomRemoved.clear();state.excluded.clear();state.obstacles=[];state.selectedObstacleId=null;
  state.supply=null;state.returnPoint=null;resetRoute();recomputeGeometry();syncShapeUiV5();
}

function presetVerticesV6(){
  if(!state.shapeAxes||state.shapeType==='custom') return [];
  const a=state.shapeAxes,x=a.xs,y=a.ys;
  let idx=[];
  if(state.shapeType==='rect') idx=[[0,0],[1,0],[1,1],[0,1]];
  if(state.shapeType==='L') idx=[[0,0],[1,0],[1,1],[2,1],[2,2],[0,2]];
  if(state.shapeType==='T') idx=[[0,0],[3,0],[3,1],[2,1],[2,2],[1,2],[1,1],[0,1]];
  return idx.map(([xi,yi],i)=>{
    const p=rotatePointV6({x:x[xi],y:y[yi]});
    return {id:`v${i}`,xi,yi,x:p.x,y:p.y};
  });
}
function customVerticesV6(){
  if(state.shapeType!=='custom') return [];
  const out=[];
  state.sections.forEach(sec=>{
    [['tl',sec.x,sec.y],['tr',sec.x+sec.width,sec.y],['br',sec.x+sec.width,sec.y+sec.height],['bl',sec.x,sec.y+sec.height]].forEach(([corner,x,y])=>out.push({id:`${sec.id}:${corner}`,sectionId:sec.id,corner,x,y}));
  });
  return out;
}
function setAxisAtV6(arr,i,v){
  const min=i>0?arr[i-1]+MIN_AXIS_GAP_V6:-30000;
  const max=i<arr.length-1?arr[i+1]-MIN_AXIS_GAP_V6:30000;
  arr[i]=clamp(snapV6(v),min,max);
}
function dragPresetCornerV6(handle,p){
  const cp=inverseRotatePointV6(p);
  setAxisAtV6(state.shapeAxes.xs,handle.xi,cp.x);
  setAxisAtV6(state.shapeAxes.ys,handle.yi,cp.y);
  state.sections=sectionsForShapeV6(); resetRoute(); recomputeGeometry(); syncShapeUiV5();
}
function resizeCustomSectionCornerV6(sec,corner,p){
  const min=200,x=snapV6(p.x),y=snapV6(p.y); let x1=sec.x,y1=sec.y,x2=sec.x+sec.width,y2=sec.y+sec.height;
  if(corner.includes('l')) x1=Math.min(x,x2-min); else x2=Math.max(x,x1+min);
  if(corner.includes('t')) y1=Math.min(y,y2-min); else y2=Math.max(y,y1+min);
  sec.x=x1;sec.y=y1;sec.width=x2-x1;sec.height=y2-y1;resetRoute();recomputeGeometry();
}

function lWallSizesV7(){
  if(state.shapeType!=='L'||!state.shapeAxes) return null;
  const x=state.shapeAxes.xs,y=state.shapeAxes.ys;
  return {
    wallA:x[1]-x[0],
    wallB:y[2]-y[1],
    cutA:x[2]-x[1],
    cutB:y[1]-y[0],
  };
}
function roomMeasureTextV6(){
  const b=state.bounds; let text=`${fmtM(b.width)} × ${fmtM(b.height)} м`;
  if(state.shapeType==='T'&&state.shapeAxes){
    const x=state.shapeAxes.xs;
    text+=`  ·  слева ${fmtM(x[1]-x[0])} · середина ${fmtM(x[2]-x[1])} · справа ${fmtM(x[3]-x[2])} м`;
  }
  if(state.shapeType==='L'&&state.shapeAxes){
    const v=presetVerticesV6(), inner=v[2];
    if(inner){
      text+=`  ·  ↔ ${fmtM(inner.x-b.minX)} | ${fmtM(b.maxX-inner.x)} м  ·  ↕ ${fmtM(inner.y-b.minY)} | ${fmtM(b.maxY-inner.y)} м`;
    }
  }
  return text;
}
// v0.7.2: отдельную всплывающую плашку размеров убрали.
// Размеры остаются непосредственно на размерных линиях и обновляются при перетягивании.
function ensureLiveMeasureV6(){ return null; }
function showLiveMeasureV6(){ }
function hideLiveMeasureV6(){ }

function excludedComponentsToObstaclesV6(keys){
  const todo=new Set(keys||[]),out=[],g=state.gridStepMm||50;
  while(todo.size){
    const first=todo.values().next().value;todo.delete(first);const q=[first],comp=[];
    while(q.length){const k=q.pop();comp.push(k);const [gx,gy]=parseGridKey(k);for(const nk of [gridKey(gx+1,gy),gridKey(gx-1,gy),gridKey(gx,gy+1),gridKey(gx,gy-1)]) if(todo.delete(nk)) q.push(nk);}
    const cells=comp.map(parseGridKey),xs=cells.map(c=>c[0]),ys=cells.map(c=>c[1]);
    out.push({id:uniqueIdV6(),x:Math.min(...xs)*g,y:Math.min(...ys)*g,width:(Math.max(...xs)-Math.min(...xs)+1)*g,height:(Math.max(...ys)-Math.min(...ys)+1)*g});
  }
  return out;
}
function syncExcludedFromObstaclesV6(){
  if(!Array.isArray(state.obstacles)) state.obstacles=[];
  const set=new Set(),g=state.gridStepMm;
  for(const o of state.obstacles){
    const gx1=Math.floor(o.x/g),gy1=Math.floor(o.y/g),gx2=Math.ceil((o.x+o.width)/g)-1,gy2=Math.ceil((o.y+o.height)/g)-1;
    for(let gx=gx1;gx<=gx2;gx++) for(let gy=gy1;gy<=gy2;gy++){
      const r=cellRect(gx,gy),cx=r.x+r.width/2,cy=r.y+r.height/2;
      if(cx>=o.x&&cx<=o.x+o.width&&cy>=o.y&&cy<=o.y+o.height&&insideRoom(cx,cy,true)) set.add(gridKey(gx,gy));
    }
  }
  state.excluded=set;
}
function selectedObstacleV6(){ return state.obstacles?.find(o=>o.id===state.selectedObstacleId)||null; }
function obstacleMeasureV6(o){return `${fmtM(o.width)} × ${fmtM(o.height)} м  ·  x ${fmtM(o.x-state.bounds.minX)} · y ${fmtM(o.y-state.bounds.minY)} м`;}

function snapshotV6(){
  return {sections:cloneV5(state.sections),shapeType:state.shapeType,shapeOrientation:state.shapeOrientation,shapeParams:cloneV5(state.shapeParams),shapeAxes:cloneAxesV6(state.shapeAxes),obstacles:cloneV5(state.obstacles||[]),selectedObstacleId:state.selectedObstacleId,excluded:[...state.excluded],supply:cloneV5(state.supply),returnPoint:cloneV5(state.returnPoint),gridStepMm:state.gridStepMm,pipeStepMm:state.pipeStepMm,wallOffsetMm:state.wallOffsetMm};
}
snapshotV5 = snapshotV6;
function undoV6Bridge(){
  const s=historyV5.pop();if(!s){setStatus('Отменять пока нечего.');return;}
  state.sections=cloneV5(s.sections);state.shapeType=s.shapeType;state.shapeOrientation=s.shapeOrientation;state.shapeParams=cloneV5(s.shapeParams||{});state.shapeAxes=cloneAxesV6(s.shapeAxes);state.obstacles=cloneV5(s.obstacles||[]);state.selectedObstacleId=s.selectedObstacleId||null;state.excluded=new Set(s.excluded||[]);state.supply=s.supply;state.returnPoint=s.returnPoint;state.gridStepMm=s.gridStepMm;state.pipeStepMm=s.pipeStepMm;state.wallOffsetMm=s.wallOffsetMm;
  resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();syncShapeUiV5();fitPlan(false);renderPlan();$('undoBtn')?.classList.toggle('disabled',!historyV5.length);setStatus('Последнее изменение отменено.');
}

function syncShapeUiV6(){
  if(!$('shapeWidthInput'))return;
  recomputeGeometry();
  $('shapeWidthInput').value=(state.bounds.width/1000).toFixed(2);$('shapeHeightInput').value=(state.bounds.height/1000).toFixed(2);
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.shapeType));
  $('orientationRow')?.classList.toggle('hidden',state.shapeType==='rect'||state.shapeType==='custom');
  document.querySelectorAll('[data-orient]').forEach(b=>b.classList.toggle('active',Number(b.dataset.orient)===state.shapeOrientation));
  if($('gridInfo'))$('gridInfo').textContent=`${fmtM(state.bounds.width)} × ${fmtM(state.bounds.height)} м · шаг ${fmtM(state.pipeStepMm)} м`;
}
syncShapeUiV5 = syncShapeUiV6;

function setModeV6(mode){
  const map={shape:'shape6',obstacle:'obstacle6',collector:'collector6',addBlock:'addBlock6'}; mode=map[mode]||mode;
  state.mode=mode;
  planSvg.classList.toggle('shape-mode',mode==='shape6'||mode==='inspect');
  planSvg.classList.toggle('draw-mode',mode==='obstacle6'||mode==='addBlock6'||mode==='collector6');
  planSvg.classList.toggle('collector-mode',mode==='collector6');
  const hints={shape6:'',obstacle6:'Проведите по пустому месту — добавить. Коснитесь препятствия — изменить.',addBlock6:'Проведите прямоугольник нового участка.',collector6:'Коснитесь стены в месте подключения.',inspect:''};
  if(modeHint){modeHint.textContent=hints[mode]||'';modeHint.classList.toggle('visible',!!hints[mode]);}
  $('shapeToolBtn')?.classList.toggle('active',mode==='shape6'||mode==='addBlock6');$('obstacleToolBtn')?.classList.toggle('active',mode==='obstacle6');$('collectorToolBtn')?.classList.toggle('active',mode==='collector6');
  renderPlan();
}
setMode = setModeV6;

function handleShapeToolV6(){
  if(state.mode==='shape6'){openSheetV5('shapeSheet');return;}
  closeSheetV5();state.selectedObstacleId=null;setModeV6('shape6');
}
function handleObstacleToolV6(){
  if(state.mode==='obstacle6'){openSheetV5('obstacleSheet');return;}
  closeSheetV5();setModeV6('obstacle6');setStatus('Препятствие: проведите по пустому месту или коснитесь уже созданного.',false);
}
function handleCollectorToolV6(){closeSheetV5();state.selectedObstacleId=null;setModeV6('collector6');}
function handleDrawObstacleV6(){closeSheetV5();state.selectedObstacleId=null;setModeV6('obstacle6');setStatus('Проведите пальцем от одного угла препятствия к другому.');}
function handleClearObstaclesV6(){pushHistoryV5();state.obstacles=[];state.selectedObstacleId=null;state.excluded.clear();resetRoute();renderPlan();closeSheetV5();setStatus('Препятствия удалены.');}
function resetRoomShapeV6(){pushHistoryV5();state.shapeType='rect';state.shapeOrientation=0;state.shapeAxes=defaultAxesV6('rect',0,0,4000,3000);state.sections=sectionsForShapeV6();state.obstacles=[];state.selectedObstacleId=null;state.excluded.clear();state.supply=null;state.returnPoint=null;resetRoute();recomputeGeometry();fitPlan(false);syncShapeUiV5();renderPlan();setStatus('Форма сброшена до прямоугольника 4,00 × 3,00 м.');}

function applyShapeSizeFromInputsV5(){
  const w=clamp(Math.round((Number($('shapeWidthInput').value)||4)*1000/10)*10,500,30000),h=clamp(Math.round((Number($('shapeHeightInput').value)||3)*1000/10)*10,500,30000);
  pushHistoryV5();resizeOverallV6('width',w);resizeOverallV6('height',h);resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();fitPlan(false);renderPlan();closeSheetV5();
}
function resizeOverallV6(kind,newMm){
  recomputeGeometry();const b={...state.bounds};newMm=clamp(snapV6(newMm),500,30000);
  if(state.shapeType!=='custom'){
    ensureShapeAxesV6();const arr=kind==='width'?state.shapeAxes.xs:state.shapeAxes.ys;const min=arr[0],old=arr[arr.length-1]-min,ratio=newMm/Math.max(1,old);
    for(let i=1;i<arr.length;i++) arr[i]=snapV6(min+(arr[i]-min)*ratio);arr[arr.length-1]=min+newMm;normalizeAxesV6();state.sections=sectionsForShapeV6();
  }else{
    const min=kind==='width'?b.minX:b.minY,old=kind==='width'?b.width:b.height,ratio=newMm/Math.max(1,old);
    state.sections.forEach(s=>{
      if(kind==='width'){const x1=min+(s.x-min)*ratio,x2=min+(s.x+s.width-min)*ratio;s.x=snapV6(x1);s.width=Math.max(200,snapV6(x2)-s.x);}
      else{const y1=min+(s.y-min)*ratio,y2=min+(s.y+s.height-min)*ratio;s.y=snapV6(y1);s.height=Math.max(200,snapV6(y2)-s.y);}
    });
  }
}
function openDimensionEditorV6(kind){
  editingDimensionV6=kind;recomputeGeometry();
  let val=kind==='width'?state.bounds.width:state.bounds.height;
  let title=kind==='width'?'Ширина комнаты':'Высота комнаты';
  let label='Размер, м', min=.50;
  if((kind==='lwallA'||kind==='lwallB')&&state.shapeType==='L'&&state.shapeAxes){
    const m=lWallSizesV7();
    val=kind==='lwallA'?m.wallA:m.wallB;
    title='Стена до выреза'; label='Длина стены до выреза, м'; min=.20;
  }
  if(/^lseg(Left|Right|Top|Bottom)$/.test(kind)&&state.shapeType==='L'&&state.shapeAxes){
    const v=presetVerticesV6(),inner=v[2],b=state.bounds;
    if(inner){
      if(kind==='lsegLeft'){val=inner.x-b.minX;title='Размер слева до выреза';}
      if(kind==='lsegRight'){val=b.maxX-inner.x;title='Размер справа до выреза';}
      if(kind==='lsegTop'){val=inner.y-b.minY;title='Размер сверху до выреза';}
      if(kind==='lsegBottom'){val=b.maxY-inner.y;title='Размер снизу до выреза';}
      label='Введите измеренный участок, м'; min=.20;
    }
  }
  $('dimensionTitle').textContent=title;$('dimensionLabel').textContent=label;
  $('dimensionInput').min=String(min);$('dimensionInput').value=(val/1000).toFixed(2);
  openSheetV5('dimensionSheet');setTimeout(()=>$('dimensionInput')?.select(),80);
}
function applyExactDimensionV6(){
  if(!editingDimensionV6)return;
  const mm=Math.round((Number($('dimensionInput').value)||0)*1000/10)*10;
  if(/^lseg(Left|Right|Top|Bottom)$/.test(editingDimensionV6)){
    if(state.shapeType!=='L'||!state.shapeAxes){closeSheetV5();return;}
    recomputeGeometry();
    const b={...state.bounds},v=presetVerticesV6(),inner=v[2];
    const horizontal=editingDimensionV6==='lsegLeft'||editingDimensionV6==='lsegRight';
    const total=horizontal?b.width:b.height;
    if(mm<200||mm>total-MIN_AXIS_GAP_V6){setStatus(`Введите размер от 0,20 до ${fmtM(total-MIN_AXIS_GAP_V6)} м.`,true);return;}
    const target={x:inner.x,y:inner.y};
    if(editingDimensionV6==='lsegLeft') target.x=b.minX+mm;
    if(editingDimensionV6==='lsegRight') target.x=b.maxX-mm;
    if(editingDimensionV6==='lsegTop') target.y=b.minY+mm;
    if(editingDimensionV6==='lsegBottom') target.y=b.maxY-mm;
    const canonical=inverseRotatePointV6(target);
    pushHistoryV5();
    setAxisAtV6(state.shapeAxes.xs,1,canonical.x);
    setAxisAtV6(state.shapeAxes.ys,1,canonical.y);
    normalizeAxesV6();state.sections=sectionsForShapeV6();resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();syncShapeUiV5();renderPlan();closeSheetV5();return;
  }
  if(editingDimensionV6==='lwallA'||editingDimensionV6==='lwallB'){
    if(state.shapeType!=='L'||!state.shapeAxes){closeSheetV5();return;}
    const a=state.shapeAxes,total=editingDimensionV6==='lwallA'?a.xs[2]-a.xs[0]:a.ys[2]-a.ys[0];
    if(mm<200||mm>total-MIN_AXIS_GAP_V6){setStatus(`Введите размер от 0,20 до ${fmtM(total-MIN_AXIS_GAP_V6)} м.`,true);return;}
    pushHistoryV5();
    if(editingDimensionV6==='lwallA') a.xs[1]=a.xs[0]+mm;
    else a.ys[1]=a.ys[2]-mm;
    normalizeAxesV6();state.sections=sectionsForShapeV6();resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();syncShapeUiV5();renderPlan();closeSheetV5();return;
  }
  if(mm<500||mm>30000){setStatus('Введите размер от 0,50 до 30,00 м.',true);return;}
  pushHistoryV5();resizeOverallV6(editingDimensionV6,mm);resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();fitPlan(false);renderPlan();closeSheetV5();
}

function rotatePointCWCustomV6(p,b){return{x:b.minX+b.height-(p.y-b.minY),y:b.minY+(p.x-b.minX)}}
function rotateRectCWCustomV6(r,b){const pts=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}].map(p=>rotatePointCWCustomV6(p,b));const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);return{...r,x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}}
function rotatePlanV6(){
  closeSheetV5();pushHistoryV5();recomputeGeometry();const oldB={...state.bounds};
  if(state.shapeType!=='custom'&&state.shapeAxes){
    const oldO=state.shapeOrientation,newO=(oldO+1)%4;
    state.obstacles=(state.obstacles||[]).map(o=>rotateRectBetweenOrientationsV6(o,oldO,newO));
    for(const k of ['supply','returnPoint']) if(state[k]) state[k]=rotatePointV6(inverseRotatePointV6(state[k],oldO,state.shapeAxes),newO,state.shapeAxes);
    state.shapeOrientation=newO;state.sections=sectionsForShapeV6();
  } else {
    state.sections=state.sections.map(s=>rotateRectCWCustomV6(s,oldB));state.obstacles=(state.obstacles||[]).map(o=>rotateRectCWCustomV6(o,oldB));
    for(const k of ['supply','returnPoint']) if(state[k]) state[k]=rotatePointCWCustomV6(state[k],oldB);
  }
  resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();syncShapeUiV5();fitPlan(false);renderPlan();
}

function obstacleOverlayV6(sc){
  let out='';
  for(const o of state.obstacles||[]){
    const selected=o.id===state.selectedObstacleId;
    out+=`<rect class="obstacle-touch${selected?' selected':''}" data-v6-obstacle-id="${o.id}" x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}"/>`;
    if(selected){
      const hs=[['tl',o.x,o.y],['tr',o.x+o.width,o.y],['br',o.x+o.width,o.y+o.height],['bl',o.x,o.y+o.height]];
      for(const [h,x,y] of hs){out+=`<circle class="edit-handle-hit" data-v6-obstacle-handle="${h}" data-v6-obstacle-id="${o.id}" cx="${x}" cy="${y}" r="${25/sc}"/><circle class="edit-handle obstacle" data-v6-obstacle-handle="${h}" data-v6-obstacle-id="${o.id}" cx="${x}" cy="${y}" r="${11/sc}"/>`;}
      out+=`<g class="measure-chip-svg" data-v6-obstacle-id="${o.id}"><rect x="${o.x+o.width/2-45/sc}" y="${o.y-32/sc}" width="${90/sc}" height="${24/sc}" rx="${12/sc}"/><text x="${o.x+o.width/2}" y="${o.y-16/sc}" text-anchor="middle" font-size="${11/sc}">${fmtM(o.width)} × ${fmtM(o.height)} м</text></g>`;
    }
  }
  return out;
}
function roomHandlesOverlayV6(sc){
  if(state.mode!=='shape6')return'';let out='';
  const hs=state.shapeType==='custom'?customVerticesV6():presetVerticesV6();
  for(const h of hs){
    const data=h.sectionId?`data-v6-section-id="${h.sectionId}" data-v6-section-corner="${h.corner}"`:`data-v6-room-handle="${h.id}"`;
    out+=`<circle class="edit-handle-hit" ${data} cx="${h.x}" cy="${h.y}" r="${27/sc}"/><circle class="edit-handle room" ${data} cx="${h.x}" cy="${h.y}" r="${11/sc}"/>`;
  }
  return out;
}
function lChainChipV71(kind,cx,cy,value,sc,vertical=false){
  const chipW=vertical?64/sc:76/sc,chipH=24/sc;
  return `<g class="l-wall-dimension l-chain-chip" data-v6-dim="${kind}">`+
    `<rect data-v6-dim="${kind}" x="${cx-chipW/2}" y="${cy-chipH/2}" width="${chipW}" height="${chipH}" rx="${12/sc}"/>`+
    `<text data-v6-dim="${kind}" x="${cx}" y="${cy+4/sc}" text-anchor="middle" font-size="${10/sc}">${fmtM(value)} м ✎</text></g>`;
}
function lWallDimensionsOverlayV7(sc){
  if(state.shapeType!=='L'||!state.shapeAxes)return'';
  const v=presetVerticesV6(),inner=v[2],b=state.bounds;if(!inner)return'';
  const off=24/sc,tick=6/sc;
  const topY=b.minY-off,rightX=b.maxX+off;
  const leftLen=Math.max(0,inner.x-b.minX),rightLen=Math.max(0,b.maxX-inner.x);
  const topLen=Math.max(0,inner.y-b.minY),bottomLen=Math.max(0,b.maxY-inner.y);
  let out=`<g class="l-dim-chain">`;
  out+=`<line x1="${b.minX}" y1="${topY}" x2="${b.maxX}" y2="${topY}"/>`;
  for(const x of [b.minX,inner.x,b.maxX]) out+=`<line x1="${x}" y1="${topY-tick}" x2="${x}" y2="${topY+tick}"/>`;
  out+=`<line x1="${rightX}" y1="${b.minY}" x2="${rightX}" y2="${b.maxY}"/>`;
  for(const y of [b.minY,inner.y,b.maxY]) out+=`<line x1="${rightX-tick}" y1="${y}" x2="${rightX+tick}" y2="${y}"/>`;
  out+=`</g>`;
  if(leftLen>=100) out+=lChainChipV71('lsegLeft',(b.minX+inner.x)/2,topY-15/sc,leftLen,sc,false);
  if(rightLen>=100) out+=lChainChipV71('lsegRight',(inner.x+b.maxX)/2,topY-15/sc,rightLen,sc,false);
  if(topLen>=100) out+=lChainChipV71('lsegTop',rightX+24/sc,(b.minY+inner.y)/2,topLen,sc,true);
  if(bottomLen>=100) out+=lChainChipV71('lsegBottom',rightX+24/sc,(inner.y+b.maxY)/2,bottomLen,sc,true);
  return out;
}

function dimensionOverlayV6(sc){
  const b=state.bounds,dim=24/sc,topY=b.minY-dim,rightX=b.maxX+dim;
  const w=96/sc,h=28/sc;
  if(state.shapeType==='L'){
    const bottomY=b.maxY+50/sc,leftX=b.minX-48/sc;
    return `<g class="dimension-tap" data-v6-dim="width"><rect data-v6-dim="width" x="${(b.minX+b.maxX)/2-w/2}" y="${bottomY-h/2}" width="${w}" height="${h}" rx="${14/sc}"/><text data-v6-dim="width" x="${(b.minX+b.maxX)/2}" y="${bottomY+4/sc}" text-anchor="middle" font-size="${12/sc}">${fmtM(b.width)} м ✎</text></g>`+
      `<g class="dimension-tap" data-v6-dim="height"><rect data-v6-dim="height" x="${leftX-31/sc}" y="${(b.minY+b.maxY)/2-14/sc}" width="${62/sc}" height="${28/sc}" rx="${14/sc}"/><text data-v6-dim="height" x="${leftX}" y="${(b.minY+b.maxY)/2+4/sc}" text-anchor="middle" font-size="${10.5/sc}">${fmtM(b.height)} м ✎</text></g>`+
      lWallDimensionsOverlayV7(sc);
  }
  return `<g class="dimension-tap" data-v6-dim="width"><rect data-v6-dim="width" x="${(b.minX+b.maxX)/2-w/2}" y="${topY-25/sc}" width="${w}" height="${h}" rx="${14/sc}"/><text data-v6-dim="width" x="${(b.minX+b.maxX)/2}" y="${topY-7/sc}" text-anchor="middle" font-size="${12/sc}">${fmtM(b.width)} м ✎</text></g>`+
  `<g class="dimension-tap" data-v6-dim="height"><rect data-v6-dim="height" x="${rightX-31/sc}" y="${(b.minY+b.maxY)/2-14/sc}" width="${62/sc}" height="${28/sc}" rx="${14/sc}"/><text data-v6-dim="height" x="${rightX}" y="${(b.minY+b.maxY)/2+4/sc}" text-anchor="middle" font-size="${10.5/sc}">${fmtM(b.height)} м ✎</text></g>`;
}

const renderPlanV5ForV6 = renderPlan;
renderPlan = function renderPlanV6(){
  if(state.shapeType!=='custom')ensureShapeAxesV6();
  if(state.shapeType!=='custom'&&state.shapeAxes)state.sections=sectionsForShapeV6();
  if(!roomDragV6.active && !obstacleDragV6.active && !blockDragV6.active) syncExcludedFromObstaclesV6();
  renderPlanV5ForV6();
  const sc=state.scale||.1;let extra=dimensionOverlayV6(sc)+roomHandlesOverlayV6(sc)+obstacleOverlayV6(sc);
  if(blockDragV6.active&&blockDragV6.start&&blockDragV6.current){const a=blockDragV6.start,b=blockDragV6.current,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);extra+=`<rect class="preview-rect" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="handle-label" x="${x+w/2}" y="${y+h/2}" text-anchor="middle" font-size="${13/sc}">${fmtM(w)} × ${fmtM(h)} м</text>`;}
  if(obstacleDragV6.active&&obstacleDragV6.kind==='new'&&obstacleDragV6.startPoint&&obstacleDragV6.current){const a=obstacleDragV6.startPoint,b=obstacleDragV6.current,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);extra+=`<rect class="preview-rect obstacle-preview" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="handle-label" x="${x+w/2}" y="${y+h/2}" text-anchor="middle" font-size="${13/sc}">${fmtM(w)} × ${fmtM(h)} м</text>`;}
  if(extra)planSvg.insertAdjacentHTML('beforeend',extra);
};

let dragRenderPendingV72=false;
let dragRenderLastV72=0;
function scheduleDragRenderV72(){
  if(dragRenderPendingV72) return;
  dragRenderPendingV72=true;
  requestAnimationFrame((ts)=>{
    dragRenderPendingV72=false;
    if(ts-dragRenderLastV72<28){ setTimeout(scheduleDragRenderV72, 28-(ts-dragRenderLastV72)); return; }
    dragRenderLastV72=ts;
    renderPlan();
  });
}

function startObstacleResizeV6(id,handle,p,e){
  const o=state.obstacles.find(x=>x.id===id);if(!o)return;pushHistoryV5();state.selectedObstacleId=id;obstacleDragV6.active=true;obstacleDragV6.pointerId=e.pointerId;obstacleDragV6.kind='resize';obstacleDragV6.id=id;obstacleDragV6.handle=handle;obstacleDragV6.startPoint=p;obstacleDragV6.startRect=cloneV5(o);try{planSvg.setPointerCapture(e.pointerId)}catch{};
}
function startObstacleMoveV6(id,p,e){
  const o=state.obstacles.find(x=>x.id===id);if(!o)return;pushHistoryV5();state.selectedObstacleId=id;obstacleDragV6.active=true;obstacleDragV6.pointerId=e.pointerId;obstacleDragV6.kind='move';obstacleDragV6.id=id;obstacleDragV6.startPoint=p;obstacleDragV6.startRect=cloneV5(o);try{planSvg.setPointerCapture(e.pointerId)}catch{};
}
function updateObstacleDragV6(p){
  const o=state.obstacles.find(x=>x.id===obstacleDragV6.id);if(!o)return;const s=obstacleDragV6.startRect,min=100;
  if(obstacleDragV6.kind==='move'){o.x=snapV6(s.x+p.x-obstacleDragV6.startPoint.x);o.y=snapV6(s.y+p.y-obstacleDragV6.startPoint.y);}
  if(obstacleDragV6.kind==='resize'){
    let x1=s.x,y1=s.y,x2=s.x+s.width,y2=s.y+s.height,h=obstacleDragV6.handle;
    if(h.includes('l'))x1=Math.min(snapV6(p.x),x2-min);else x2=Math.max(snapV6(p.x),x1+min);
    if(h.includes('t'))y1=Math.min(snapV6(p.y),y2-min);else y2=Math.max(snapV6(p.y),y1+min);
    o.x=x1;o.y=y1;o.width=x2-x1;o.height=y2-y1;
  }
  resetRoute();scheduleDragRenderV72();
}
function commitNewObstacleV6(a,b){
  const x=snapV6(Math.min(a.x,b.x)),y=snapV6(Math.min(a.y,b.y)),x2=snapV6(Math.max(a.x,b.x)),y2=snapV6(Math.max(a.y,b.y));if(x2-x<100||y2-y<100){setStatus('Препятствие слишком маленькое.',true);return;}
  const o={id:uniqueIdV6(),x,y,width:x2-x,height:y2-y};pushHistoryV5();state.obstacles.push(o);state.selectedObstacleId=o.id;syncExcludedFromObstaclesV6();resetRoute();renderPlan();
}
function commitBlockV6(a,b){
  const x=snapV6(Math.min(a.x,b.x)),y=snapV6(Math.min(a.y,b.y)),x2=snapV6(Math.max(a.x,b.x)),y2=snapV6(Math.max(a.y,b.y));const r={x,y,width:x2-x,height:y2-y};if(r.width<200||r.height<200){setStatus('Участок слишком маленький.',true);return;}
  if(!rectTouchesRoomV5(r)){setStatus('Новый участок должен касаться комнаты.',true);return;}
  pushHistoryV5();state.sections.push({id:uniqueIdV6(),name:'Участок',...r,base:false});state.shapeType='custom';state.shapeAxes=null;state.supply=null;state.returnPoint=null;resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();fitPlan(false);renderPlan();
}

planSvg.addEventListener('pointerdown',(e)=>{
  if(e.button>0)return;const p=svgPointFromEvent(e);if(!p)return;
  const dim=e.target?.dataset?.v6Dim;if(dim){e.preventDefault();openDimensionEditorV6(dim);return;}
  const oh=e.target?.dataset?.v6ObstacleHandle,oid=e.target?.dataset?.v6ObstacleId;
  if(oh&&oid){e.preventDefault();startObstacleResizeV6(oid,oh,p,e);return;}
  if(oid&&state.mode==='obstacle6'){e.preventDefault();startObstacleMoveV6(oid,p,e);return;}
  const rh=e.target?.dataset?.v6RoomHandle;
  if(rh&&state.mode==='shape6'){
    const h=presetVerticesV6().find(x=>x.id===rh);if(!h)return;e.preventDefault();pushHistoryV5();roomDragV6.active=true;roomDragV6.pointerId=e.pointerId;roomDragV6.handle=h;try{planSvg.setPointerCapture(e.pointerId)}catch{};return;
  }
  const sid=e.target?.dataset?.v6SectionId,corner=e.target?.dataset?.v6SectionCorner;
  if(sid&&corner&&state.mode==='shape6'){
    e.preventDefault();pushHistoryV5();roomDragV6.active=true;roomDragV6.pointerId=e.pointerId;roomDragV6.sectionId=sid;roomDragV6.corner=corner;try{planSvg.setPointerCapture(e.pointerId)}catch{};return;
  }
  if(state.mode==='obstacle6'){
    e.preventDefault();obstacleDragV6.active=true;obstacleDragV6.pointerId=e.pointerId;obstacleDragV6.kind='new';obstacleDragV6.startPoint={x:snapV6(p.x),y:snapV6(p.y)};obstacleDragV6.current={...obstacleDragV6.startPoint};try{planSvg.setPointerCapture(e.pointerId)}catch{};return;
  }
  if(state.mode==='addBlock6'){
    e.preventDefault();blockDragV6.active=true;blockDragV6.pointerId=e.pointerId;blockDragV6.start={x:snapV6(p.x),y:snapV6(p.y)};blockDragV6.current={...blockDragV6.start};try{planSvg.setPointerCapture(e.pointerId)}catch{};return;
  }
  if(state.mode==='collector6'){
    e.preventDefault();const near=nearestBoundaryPoint(p.x,p.y);if(!near)return;pushHistoryV5();state.supply={x:near.x,y:near.y,side:near.side};state.returnPoint=adjacentReturnForSupply(near);resetRoute();setModeV6('inspect');setStatus('Коллектор установлен: подача и обратка рядом.');return;
  }
},true);
planSvg.addEventListener('pointermove',(e)=>{
  const p=svgPointFromEvent(e);if(!p)return;
  if(roomDragV6.active&&e.pointerId===roomDragV6.pointerId){e.preventDefault();if(roomDragV6.handle)dragPresetCornerV6(roomDragV6.handle,p);else{const sec=state.sections.find(s=>s.id===roomDragV6.sectionId);if(sec)resizeCustomSectionCornerV6(sec,roomDragV6.corner,p);}scheduleDragRenderV72();return;}
  if(obstacleDragV6.active&&e.pointerId===obstacleDragV6.pointerId){e.preventDefault();if(obstacleDragV6.kind==='new'){obstacleDragV6.current={x:snapV6(p.x),y:snapV6(p.y)};scheduleDragRenderV72();}else updateObstacleDragV6(p);return;}
  if(blockDragV6.active&&e.pointerId===blockDragV6.pointerId){e.preventDefault();blockDragV6.current={x:snapV6(p.x),y:snapV6(p.y)};scheduleDragRenderV72();return;}
},true);
function finishPointerV6(e){
  if(roomDragV6.active&&e.pointerId===roomDragV6.pointerId){try{planSvg.releasePointerCapture(e.pointerId)}catch{};roomDragV6.active=false;roomDragV6.pointerId=null;roomDragV6.handle=null;roomDragV6.sectionId=null;roomDragV6.corner=null;syncExcludedFromObstaclesV6();renderPlan();return;}
  if(obstacleDragV6.active&&e.pointerId===obstacleDragV6.pointerId){try{planSvg.releasePointerCapture(e.pointerId)}catch{};if(obstacleDragV6.kind==='new')commitNewObstacleV6(obstacleDragV6.startPoint,obstacleDragV6.current);obstacleDragV6.active=false;obstacleDragV6.pointerId=null;obstacleDragV6.kind=null;obstacleDragV6.id=null;obstacleDragV6.handle=null;syncExcludedFromObstaclesV6();renderPlan();hideLiveMeasureV6();return;}
  if(blockDragV6.active&&e.pointerId===blockDragV6.pointerId){try{planSvg.releasePointerCapture(e.pointerId)}catch{};commitBlockV6(blockDragV6.start,blockDragV6.current);blockDragV6.active=false;blockDragV6.pointerId=null;blockDragV6.start=null;blockDragV6.current=null;setModeV6('shape6');hideLiveMeasureV6();return;}
}
planSvg.addEventListener('pointerup',finishPointerV6,true);planSvg.addEventListener('pointercancel',finishPointerV6,true);

function serializeState(){
  collectInputs();return{version:6,id:state.id,sections:state.sections,excluded:[...state.excluded],obstacles:cloneV5(state.obstacles||[]),roomAdded:[],roomRemoved:[],shapeStepMm:100,supply:state.supply,returnPoint:state.returnPoint,route:state.route,routeKind:state.routeKind,routeComplete:state.routeComplete,name:state.name,object:state.object,gridStepMm:state.gridStepMm,pipeStepMm:state.pipeStepMm,pipeDiameterMm:state.pipeDiameterMm||16,pipeRenderMode:state.pipeRenderMode||'scale',wallOffsetMm:state.wallOffsetMm,shapeType:state.shapeType,shapeOrientation:state.shapeOrientation,shapeParams:state.shapeParams,shapeAxes:cloneAxesV6(state.shapeAxes),updatedAt:new Date().toISOString()};
}
function migrateItemV6(item){
  if(!item)return null;if(item.version===6)return item;
  const migrated=migrateItem(item);if(!migrated)return null;
  const sections=(migrated.sections||[]).map(s=>({...s}));let shapeType=migrated.shapeType||((sections.length===1)?'rect':'custom'),shapeOrientation=Number(migrated.shapeOrientation)||0,shapeAxes=null;
  if(shapeType==='rect'&&sections.length===1){const s=sections[0];shapeAxes={xs:[s.x,s.x+s.width],ys:[s.y,s.y+s.height]};shapeOrientation=0;}
  else if((shapeType==='L'||shapeType==='T')&&shapeOrientation===0){const p=migrated.shapeParams||{},b={minX:Math.min(...sections.map(s=>s.x)),minY:Math.min(...sections.map(s=>s.y)),width:Math.max(...sections.map(s=>s.x+s.width))-Math.min(...sections.map(s=>s.x)),height:Math.max(...sections.map(s=>s.y+s.height))-Math.min(...sections.map(s=>s.y))};shapeAxes=defaultAxesV6(shapeType,b.minX,b.minY,b.width,b.height);if(shapeType==='L'&&p.notchW&&p.notchH)shapeAxes={xs:[b.minX,b.minX+b.width-p.notchW,b.minX+b.width],ys:[b.minY,b.minY+p.notchH,b.minY+b.height]};if(shapeType==='T'&&p.stemW&&p.barH){const x1=b.minX+(b.width-p.stemW)/2;shapeAxes={xs:[b.minX,x1,x1+p.stemW,b.minX+b.width],ys:[b.minY,b.minY+p.barH,b.minY+b.height]};}}
  else shapeType='custom';
  const tmpExcluded=new Set(migrated.excluded||[]);const oldExcluded=state.excluded;state.excluded=tmpExcluded;const obstacles=migrated.obstacles?.length?migrated.obstacles:excludedComponentsToObstaclesV6(tmpExcluded);state.excluded=oldExcluded;
  return{...migrated,version:6,sections,shapeType,shapeOrientation,shapeAxes,obstacles};
}
loadAll = function loadAllV6(){
  try{
    const cur=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');if(cur.length)return cur.map(migrateItemV6).filter(Boolean);
    const v5=JSON.parse(localStorage.getItem(V5_STORAGE_KEY)||'[]');if(v5.length){const m=v5.map(migrateItemV6).filter(Boolean);localStorage.setItem(STORAGE_KEY,JSON.stringify(m));return m;}
    const old=JSON.parse(localStorage.getItem(V4_STORAGE_KEY)||'[]');if(old.length){const m=old.map(migrateItemV6).filter(Boolean);localStorage.setItem(STORAGE_KEY,JSON.stringify(m));return m;}
    return [];
  }catch{return[];}
};
loadScheme = function loadSchemeV6(raw){
  const item=migrateItemV6(raw);state.id=item.id;state.sections=item.sections.map(s=>({...s}));state.obstacles=cloneV5(item.obstacles||[]);state.selectedObstacleId=null;state.excluded=new Set();state.roomAdded=new Set();state.roomRemoved=new Set();state.shapeStepMm=100;state.supply=item.supply||null;state.returnPoint=item.returnPoint||null;state.route=item.route||[];state.routeKind=item.routeKind||'';state.routeComplete=!!item.routeComplete;state.name=item.name||'';state.object=item.object||'';state.gridStepMm=Number(item.gridStepMm)||50;state.pipeStepMm=Number(item.pipeStepMm)||150;state.wallOffsetMm=Number(item.wallOffsetMm)||100;state.scale=.09;state.shapeType=item.shapeType||'custom';state.shapeOrientation=Number(item.shapeOrientation)||0;state.shapeParams=cloneV5(item.shapeParams||{});state.shapeAxes=cloneAxesV6(item.shapeAxes);historyV5.length=0;recomputeGeometry();syncExcludedFromObstaclesV6();syncInputs();syncShapeUiV5();setModeV6('shape6');showView('editor');requestAnimationFrame(()=>{fitPlan(false);renderPlan();centerPlanV5();});
};
newScheme = function newSchemeV6(){
  Object.assign(state,{id:uuid(),sections:[],excluded:new Set(),obstacles:[],selectedObstacleId:null,supply:null,returnPoint:null,roomAdded:new Set(),roomRemoved:new Set(),shapeStepMm:100,route:[],routeKind:'',routeComplete:false,routeCandidates:[],selectedRouteCandidate:null,mode:'shape6',name:'',object:'',gridStepMm:50,pipeStepMm:150,pipeDiameterMm:16,pipeRenderMode:'scale',wallOffsetMm:100,scale:.09,shapeType:'rect',shapeOrientation:0,shapeParams:{},shapeAxes:defaultAxesV6('rect',0,0,4000,3000)});
  state.sections=sectionsForShapeV6();historyV5.length=0;recomputeGeometry();syncInputs();syncShapeUiV5();setModeV6('shape6');showView('editor');requestAnimationFrame(()=>{fitPlan(false);renderPlan();centerPlanV5();setTimeout(()=>openSheetV5('shapeSheet'),120);});setStatus('');
};

// Кнопки ориентации остаются в нижнем листе, но верхняя ↻ доступна всегда.
// Для дорисовки комнаты используем точность 1 см.
$('addBlockBtn')?.addEventListener('click',()=>{closeSheetV5();setModeV6('addBlock6');});
$('gridStepInput')?.addEventListener('change',()=>{setTimeout(()=>{syncExcludedFromObstaclesV6();renderPlan();},0);});

// Повторно отрисовываем список уже через миграцию v0.6.
renderSchemes();

// ===== v0.9: физический диаметр, выравнивание шага и более плотный центр улитки =====
function updatePipeGeometryInfoV9(){
  const d = clamp(Number(state.pipeDiameterMm) || 16, 8, 32);
  const step = clamp(Number(state.pipeStepMm) || 150, 50, 500);
  const gap = Math.max(0, step - d);
  const el = $('pipeGeometryInfo');
  if (el) el.textContent = `Ø${Math.round(d)} мм · межосевой шаг ${Math.round(step)} мм · чистый зазор ${Math.round(gap)} мм`;
}

function pipeStrokeWorldV9(scale){
  const d = clamp(Number(state.pipeDiameterMm) || 16, 8, 32);
  if ((state.pipeRenderMode || 'scale') === 'scale') return d;
  // Схематический режим чуть утолщает трубу для чтения на телефоне, но уже не как в v0.8.
  return Math.max(d, 2.6 / Math.max(0.001, scale));
}

function alignAxisToStepV9(min, max, step){
  const span = Math.max(0, max - min);
  const intervals = Math.max(1, Math.floor(span / step));
  const used = intervals * step;
  const pad = Math.max(0, (span - used) / 2);
  return { min: min + pad, max: max - pad, span: used, intervals, pad };
}

// Улитка строится по центровым линиям, выровненным по заданному шагу.
// Остаток размера комнаты распределяется поровну по краям: это уменьшает случайно большой центральный «карман».
buildRectPatternVariantsV8 = function buildRectPatternVariantsV9(coreFactory) {
  if (state.shapeType && state.shapeType !== 'rect') return [];
  if (state.sections.length !== 1 || state.excluded.size) return [];
  const collector = sameSideCollectorV8();
  if (!collector) return [];
  const b = state.bounds;
  const off = Math.max(0, state.wallOffsetMm);
  const raw = { left: b.minX + off, top: b.minY + off, right: b.maxX - off, bottom: b.maxY - off };
  const ax = alignAxisToStepV9(raw.left, raw.right, state.pipeStepMm);
  const ay = alignAxisToStepV9(raw.top, raw.bottom, state.pipeStepMm);
  const inner = { left: ax.min, top: ay.min, right: ax.max, bottom: ay.max };
  const W = inner.right - inner.left, H = inner.bottom - inner.top;
  if (W < state.pipeStepMm * 1.5 || H < state.pipeStepMm * 1.5) return [];
  const localW = (collector.side === 'left' || collector.side === 'right') ? W : H;
  const localH = (collector.side === 'left' || collector.side === 'right') ? H : W;
  const coreOptions = coreFactory(localW, localH, state.pipeStepMm) || [];
  const cores = Array.isArray(coreOptions?.[0]) ? coreOptions : (coreOptions ? [coreOptions] : []);
  const candidates = [];
  for (const coreLocal of cores) {
    for (const farCorner of [false, true]) {
      const core = transformCoreV8(coreLocal, collector.side, farCorner, inner);
      const route = attachCollectorTailsV8(core, collector, inner, b);
      if (!route || route.length < 4 || !validRoute(route)) continue;
      candidates.push(route);
    }
  }
  candidates.sort((a, b2) => routeLength(a) - routeLength(b2));
  return candidates;
};

function spiralCenterQualityV9(route){
  if (!route?.length) return 0;
  // Чем ближе маршрут подходит к геометрическому центру, тем меньше необоснованная пустота.
  const c = { x: (state.bounds.minX + state.bounds.maxX) / 2, y: (state.bounds.minY + state.bounds.maxY) / 2 };
  let best = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = route[i-1], b = route[i];
    const vx=b.x-a.x, vy=b.y-a.y, l2=vx*vx+vy*vy;
    const t=l2 ? clamp(((c.x-a.x)*vx+(c.y-a.y)*vy)/l2,0,1) : 0;
    best=Math.min(best, Math.hypot(c.x-(a.x+vx*t), c.y-(a.y+vy*t)));
  }
  return best;
}

createRouteCandidatesV8 = function createRouteCandidatesV9(){
  const out=[];
  const push=(id,name,desc,route,badge='')=>{
    if(!route||route.length<2||!validRoute(route))return;
    out.push({id,name,desc,route,length:routeLength(route),badge});
  };
  if((!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size){
    const spirals=buildRectPatternVariantsV8(spiralCoreCandidatesV8);
    if(spirals.length){
      spirals.sort((a,b)=>routeLength(b)-routeLength(a)||spiralCenterQualityV9(a)-spiralCenterQualityV9(b));
      push('spiral','Улитка','Подача идёт к центру, обратка возвращается между витками.',spirals[0],'центр выровнен по шагу');
    }
    const snake=buildRectPatternVariantsV8((w,h,step)=>snakeCoreV8(w,h,step))[0];
    push('snake','Змейка','Последовательные параллельные проходы поперёк помещения.',snake,'базовый вариант');
  }
  if(state.shapeType!=='rect'||state.sections.length!==1||state.excluded.size){
    const complex=generateComplexRoute();
    if(complex?.route&&validRoute(complex.route))push('shape-snake','Змейка по форме','Черновой вариант для сложной геометрии; показывается только после проверки пересечений.',complex.route,'сложная форма');
  }
  return out;
};

renderRouteCandidatesV8 = function renderRouteCandidatesV9(){
  const host=$('routeCandidates'); if(!host)return;
  const list=state.routeCandidates||[];
  if(!list.length){host.innerHTML='<div class="route-empty">Для этой геометрии пока не найден физически проверенный маршрут. Приложение не будет рисовать сомнительную трассу.</div>';return;}
  const minLen=Math.min(...list.map(x=>x.length));
  host.innerHTML=list.map(c=>{
    const delta=c.length-minLen;
    const deltaText=delta<50?'самый короткий из построенных':`+ ${(delta/1000).toFixed(1)} м к самому короткому`;
    const badge=c.badge?`<span class="route-card-badge">${c.badge}</span>`:'';
    return `<button class="route-card${state.selectedRouteCandidate===c.id?' active':''}" data-route-candidate="${c.id}">`+
      `<span class="route-card-main"><span class="route-card-title">${c.name}</span><span class="route-card-desc">${c.desc}</span>${badge}</span>`+
      `<span class="route-card-metrics"><span class="route-card-length">${(c.length/1000).toFixed(1)} м</span><span class="route-card-delta">${deltaText}</span></span></button>`;
  }).join('');
  host.querySelectorAll('[data-route-candidate]').forEach(btn=>btn.addEventListener('click',()=>selectRouteCandidateV8(btn.dataset.routeCandidate)));
};

// Дополняем сохранение v0.6 новыми параметрами, сохраняя совместимость старых схем.
const serializeStateV9Base = serializeState;
serializeState = function serializeStateV9(){
  const item=serializeStateV9Base();
  item.pipeDiameterMm=Number(state.pipeDiameterMm)||16;
  item.pipeRenderMode=(state.pipeRenderMode==='scheme')?'scheme':'scale';
  return item;
};

const syncInputsV9Base = syncInputs;
syncInputs = function syncInputsV9(){
  syncInputsV9Base();
  if($('pipeDiameterInput'))$('pipeDiameterInput').value=String(Number(state.pipeDiameterMm)||16);
  if($('pipeRenderModeInput'))$('pipeRenderModeInput').value=state.pipeRenderMode==='scheme'?'scheme':'scale';
  updatePipeGeometryInfoV9();
};

const collectInputsV9Base = collectInputs;
collectInputs = function collectInputsV9(){
  collectInputsV9Base();
  if($('pipeDiameterInput'))state.pipeDiameterMm=clamp(Number($('pipeDiameterInput').value)||16,8,32);
  if($('pipeRenderModeInput'))state.pipeRenderMode=$('pipeRenderModeInput').value==='scheme'?'scheme':'scale';
  updatePipeGeometryInfoV9();
};

const loadSchemeV9Base = loadScheme;
loadScheme = function loadSchemeV9(raw){
  loadSchemeV9Base(raw);
  state.pipeDiameterMm=Number(raw?.pipeDiameterMm)||16;
  state.pipeRenderMode=raw?.pipeRenderMode==='scheme'?'scheme':'scale';
  syncInputs(); renderPlan();
};

const newSchemeV9Base = newScheme;
newScheme = function newSchemeV9(){
  newSchemeV9Base();
  state.pipeDiameterMm=16;
  state.pipeRenderMode='scale';
  syncInputs(); renderPlan();
};

$('pipeDiameterInput')?.addEventListener('change',()=>{
  state.pipeDiameterMm=clamp(Number($('pipeDiameterInput').value)||16,8,32);
  updatePipeGeometryInfoV9(); resetRoute(); renderPlan();
});
$('pipeRenderModeInput')?.addEventListener('change',()=>{
  state.pipeRenderMode=$('pipeRenderModeInput').value==='scheme'?'scheme':'scale';
  renderPlan();
});
$('pipeStepInput')?.addEventListener('input',()=>{
  const n=Number($('pipeStepInput').value);
  if(Number.isFinite(n)&&n>0){state.pipeStepMm=clamp(n*1000,50,500);updatePipeGeometryInfoV9();}
});

// Уточняем заголовок и строку параметров после загрузки скрипта.
state.pipeDiameterMm=Number(state.pipeDiameterMm)||16;
state.pipeRenderMode=state.pipeRenderMode==='scheme'?'scheme':'scale';
updatePipeGeometryInfoV9();

// Центральный шаблон v0.9: если в ядре остаётся длинный прямой участок,
// пробуем добавить компактный П-образный заход на один шаг. Это уменьшает
// пустой прямоугольник в центре без изменения основного шага между параллельными нитками.
const spiralCoreCandidatesV8BaseV9 = spiralCoreCandidatesV8;
function selfCrossLocalV9(route){
  for(let i=0;i<route.length-1;i++)for(let j=i+2;j<route.length-1;j++){
    if(segmentsIntersect(route[i],route[i+1],route[j],route[j+1])){
      const shared=nearly(route[i+1].x,route[j].x)&&nearly(route[i+1].y,route[j].y);
      if(!shared)return true;
    }
  }
  return false;
}
function compactCenterTemplatesV9(route,width,height,step){
  const out=[route]; if(!route||route.length<3)return out;
  const cx=width/2,cy=height/2;
  let best=-1,bestScore=Infinity;
  for(let i=0;i<route.length-1;i++){
    const a=route[i],b=route[i+1],len=dist(a,b); if(len<step*4.2)continue;
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    const score=Math.hypot(mx-cx,my-cy);
    if(score<bestScore){best=i;bestScore=score;}
  }
  if(best<0)return out;
  const a=route[best],b=route[best+1];
  const horizontal=nearly(a.y,b.y);
  const dir=horizontal?Math.sign(b.x-a.x):Math.sign(b.y-a.y);
  const len=dist(a,b), notchHalf=Math.min(step, Math.max(step*.75,(len-step*2)/4));
  if(notchHalf<step*.65)return out;
  for(const side of [-1,1]){
    let p1,p2,p3,p4;
    if(horizontal){
      const mid=(a.x+b.x)/2, xNear=mid-dir*notchHalf, xFar=mid+dir*notchHalf, y2=a.y+side*step;
      p1={x:xNear,y:a.y};p2={x:xNear,y:y2};p3={x:xFar,y:y2};p4={x:xFar,y:a.y};
    }else{
      const mid=(a.y+b.y)/2, yNear=mid-dir*notchHalf, yFar=mid+dir*notchHalf, x2=a.x+side*step;
      p1={x:a.x,y:yNear};p2={x:x2,y:yNear};p3={x:x2,y:yFar};p4={x:a.x,y:yFar};
    }
    const pts=[p1,p2,p3,p4];
    if(pts.some(p=>p.x<-0.01||p.y<-0.01||p.x>width+0.01||p.y>height+0.01))continue;
    const candidate=cleanRouteV8([...route.slice(0,best+1),...pts,...route.slice(best+1)]);
    if(!selfCrossLocalV9(candidate))out.push(candidate);
  }
  return out;
}
spiralCoreCandidatesV8 = function spiralCoreCandidatesV9(width,height,step){
  const bases=spiralCoreCandidatesV8BaseV9(width,height,step)||[];
  const out=[];
  for(const r of bases) for(const c of compactCenterTemplatesV9(r,width,height,step)) out.push(c);
  return out;
};

// ===== v0.10: физическая проверка маршрута, радиус изгиба, длина контура, холодная стена =====
state.bendRadiusMode = state.bendRadiusMode || 'auto';
state.minBendRadiusMm = Number(state.minBendRadiusMm) || 80;
state.maxCircuitLengthM = Number(state.maxCircuitLengthM) || 100;
state.coldWall = state.coldWall || 'none';
state.rejectedRouteReasons = state.rejectedRouteReasons || [];

function requestedBendRadiusV10(){
  const d = clamp(Number(state.pipeDiameterMm) || 16, 8, 32);
  if ((state.bendRadiusMode || 'auto') === 'auto') return Math.round(d * 5);
  return clamp(Number(state.minBendRadiusMm) || d * 5, 20, 500);
}

function syncBendUiV10(){
  const mode = state.bendRadiusMode === 'manual' ? 'manual' : 'auto';
  const r = requestedBendRadiusV10();
  state.minBendRadiusMm = r;
  if ($('bendRadiusModeInput')) $('bendRadiusModeInput').value = mode;
  if ($('minBendRadiusInput')) {
    $('minBendRadiusInput').value = String(Math.round(r));
    $('minBendRadiusInput').disabled = mode === 'auto';
  }
  if ($('maxCircuitLengthInput')) $('maxCircuitLengthInput').value = String(Number(state.maxCircuitLengthM) || 100);
  if ($('coldWallInput')) $('coldWallInput').value = state.coldWall || 'none';
}

const updatePipeGeometryInfoV9BaseV10 = updatePipeGeometryInfoV9;
updatePipeGeometryInfoV9 = function updatePipeGeometryInfoV10(){
  const d = clamp(Number(state.pipeDiameterMm) || 16, 8, 32);
  const step = clamp(Number(state.pipeStepMm) || 150, 50, 500);
  const gap = Math.max(0, step - d);
  const r = requestedBendRadiusV10();
  const el = $('pipeGeometryInfo');
  if (el) el.textContent = `Ø${Math.round(d)} мм · шаг ${Math.round(step)} мм · зазор ${Math.round(gap)} мм · Rmin ${Math.round(r)} мм`;
  syncBendUiV10();
};

function cornerRadiusStatsV10(points, skipEnds = 3){
  const target = requestedBendRadiusV10();
  let minR = Infinity, cornerCount = 0, bad = 0;
  if (!points || points.length < 3) return {minR:Infinity, cornerCount:0, bad:0, target};
  const start = Math.min(skipEnds, Math.max(1, points.length - 2));
  const end = Math.max(start, points.length - 1 - skipEnds);
  for (let i = start; i <= end; i++) {
    const a=points[i-1], b=points[i], c=points[i+1];
    if (!a || !b || !c) continue;
    const v1={x:b.x-a.x,y:b.y-a.y}, v2={x:c.x-b.x,y:c.y-b.y};
    const l1=Math.hypot(v1.x,v1.y), l2=Math.hypot(v2.x,v2.y);
    if (l1 < 0.5 || l2 < 0.5) continue;
    const cross=Math.abs(v1.x*v2.y-v1.y*v2.x);
    const dot=v1.x*v2.x+v1.y*v2.y;
    if (cross < 0.01 || dot > 0.01) continue;
    cornerCount++;
    const r=Math.min(target,l1*0.45,l2*0.45);
    minR=Math.min(minR,r);
    if (r + 0.5 < target) bad++;
  }
  return {minR, cornerCount, bad, target};
}

function routeDistanceToWallV10(route, wall){
  if (!route?.length || !wall || wall==='none') return Infinity;
  const b=state.bounds;
  const n=Math.max(2,Math.ceil(route.length*0.28));
  let sum=0,count=0;
  for(let i=0;i<n && i<route.length;i++){
    const p=route[i];
    let d=Infinity;
    if(wall==='top')d=Math.abs(p.y-b.minY);
    if(wall==='bottom')d=Math.abs(b.maxY-p.y);
    if(wall==='left')d=Math.abs(p.x-b.minX);
    if(wall==='right')d=Math.abs(b.maxX-p.x);
    if(Number.isFinite(d)){sum+=d;count++;}
  }
  return count?sum/count:Infinity;
}

function expectedLengthV10(){
  if (state.shapeType && state.shapeType !== 'rect') return null;
  const b=state.bounds, off=Math.max(0,Number(state.wallOffsetMm)||0), step=Math.max(1,Number(state.pipeStepMm)||150);
  const w=Math.max(0,b.width-2*off), h=Math.max(0,b.height-2*off);
  if(!w||!h)return null;
  return (w*h)/step;
}

function centerGapV10(route){
  if(!route?.length)return Infinity;
  const c={x:(state.bounds.minX+state.bounds.maxX)/2,y:(state.bounds.minY+state.bounds.maxY)/2};
  let best=Infinity;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],vx=b.x-a.x,vy=b.y-a.y,l2=vx*vx+vy*vy;
    const t=l2?clamp(((c.x-a.x)*vx+(c.y-a.y)*vy)/l2,0,1):0;
    best=Math.min(best,Math.hypot(c.x-(a.x+vx*t),c.y-(a.y+vy*t)));
  }
  return best;
}

function physicalDiagnosticsV10(route, kind){
  const length=routeLength(route);
  const bend=cornerRadiusStatsV10(route,3);
  const expected=expectedLengthV10();
  const ratio=expected?length/expected:null;
  const centerGap=kind==='spiral'?centerGapV10(route):null;
  const maxLen=(Number(state.maxCircuitLengthM)||100)*1000;
  const endpointsOK=!!state.supply && !!state.returnPoint && dist(route[0],state.supply)<5 && dist(route[route.length-1],state.returnPoint)<5;
  const geometryOK=validRoute(route);
  const bendOK=bend.bad===0;
  const coverageOK=ratio==null || (ratio>=0.76 && ratio<=1.42);
  const centerOK=centerGap==null || centerGap<=Math.max(state.pipeStepMm*1.15,requestedBendRadiusV10()*1.25);
  const lengthOK=length<=maxLen;
  return {length,bend,expected,ratio,centerGap,maxLen,endpointsOK,geometryOK,bendOK,coverageOK,centerOK,lengthOK,hardOK:geometryOK&&endpointsOK&&coverageOK&&centerOK,physicalReady:geometryOK&&endpointsOK&&bendOK&&coverageOK&&centerOK&&lengthOK};
}

function rejectionReasonV10(name, d){
  const r=[];
  if(!d.geometryOK)r.push('пересечение или выход за помещение');
  if(!d.endpointsOK)r.push('оба конца не возвращаются к коллектору');
  if(!d.bendOK)r.push(`поворот требует R≈${Math.round(d.bend.minR)} мм при заданном Rmin ${Math.round(d.bend.target)} мм`);
  if(!d.coverageOK)r.push('плотность заполнения не согласуется с площадью и шагом');
  if(!d.centerOK)r.push('слишком большая незаполненная зона в центре');
  return `${name}: ${r.join('; ')}`;
}

function physicalCandidateV10(id,name,desc,route,badge=''){
  if(!route||route.length<2)return null;
  const d=physicalDiagnosticsV10(route,id);
  if(!d.hardOK){state.rejectedRouteReasons.push(rejectionReasonV10(name,d));return null;}
  return {id,name,desc,route,length:d.length,badge,diagnostics:d,needsSplit:!d.lengthOK,bendWarning:!d.bendOK,physicalReady:d.physicalReady};
}

createRouteCandidatesV8 = function createRouteCandidatesV10(){
  const out=[]; state.rejectedRouteReasons=[];
  if((!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size){
    const spirals=buildRectPatternVariantsV8(spiralCoreCandidatesV8);
    const spiralValid=[];
    for(const route of spirals){
      const c=physicalCandidateV10('spiral','Улитка','Подача идёт к центру, обратка возвращается между витками.',route,'counter-flow');
      if(c)spiralValid.push(c);
    }
    spiralValid.sort((a,b)=>{
      const ag=a.diagnostics.centerGap||Infinity,bg=b.diagnostics.centerGap||Infinity;
      return ag-bg || a.length-b.length;
    });
    if(spiralValid[0])out.push(spiralValid[0]);

    const snakes=buildRectPatternVariantsV8((w,h,step)=>snakeCoreV8(w,h,step));
    const snakeValid=[];
    for(const route of snakes){
      const c=physicalCandidateV10('snake','Змейка','Последовательные проходы. При заданной холодной стене горячее начало стараемся ориентировать к ней.',route,'meander');
      if(c){c.coldScore=routeDistanceToWallV10(route,state.coldWall);snakeValid.push(c);}
    }
    snakeValid.sort((a,b)=>a.coldScore-b.coldScore||a.length-b.length);
    if(snakeValid[0])out.push(snakeValid[0]);

    const doubleSnakeRoute = generateDoubleSnake();
    if(doubleSnakeRoute){
      const c=physicalCandidateV10('double-snake','Двойная змейка','Чередует соседние ветви подачи и обратки; вариант показывается только если маршрут не пересекается.',doubleSnakeRoute,'double meander');
      if(c)out.push(c);
    }
  } else {
    const complex=generateComplexRoute();
    if(complex?.route){
      const c=physicalCandidateV10('shape-snake','Змейка по форме','Экспериментальный вариант для сложной геометрии.',complex.route,'сложная форма');
      if(c)out.push(c);
    }
  }
  return out;
};

function diagChipV10(text,cls='ok'){return `<span class="diag-chip ${cls}">${text}</span>`;}
renderRouteCandidatesV8 = function renderRouteCandidatesV10(){
  const host=$('routeCandidates'); if(!host)return;
  const list=state.routeCandidates||[];
  let html='';
  if(list.length){
    const minLen=Math.min(...list.map(x=>x.length));
    html+=list.map(c=>{
      const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
      const delta=c.length-minLen;
      const deltaText=delta<50?'самый короткий из построенных':`+ ${(delta/1000).toFixed(1)} м к самому короткому`;
      const rtxt=Number.isFinite(d.bend.minR)?`${Math.round(d.bend.minR)} мм`:`≥${Math.round(d.bend.target)} мм`;
      const ratio=d.ratio?Math.round(d.ratio*100):null;
      const chips=[diagChipV10(`R ${rtxt}`,'ok'),diagChipV10(`шаг ${Math.round(state.pipeStepMm)} мм`,'ok')];
      if(ratio)chips.push(diagChipV10(`заполнение ${ratio}%`,d.coverageOK?'ok':'bad'));
      if(c.id==='spiral'&&Number.isFinite(d.centerGap))chips.push(diagChipV10(`центр ${Math.round(d.centerGap)} мм`,d.centerOK?'ok':'bad'));
      chips.push(diagChipV10(d.bendOK?'радиус OK':`Rmin ${Math.round(d.bend.target)} мм`,d.bendOK?'ok':'warn'));
      chips.push(diagChipV10(c.needsSplit?`>${Math.round(state.maxCircuitLengthM)} м`:'длина OK',c.needsSplit?'warn':'ok'));
      const badge=c.badge?`<span class="route-card-badge">${c.badge}</span>`:'';
      return `<button class="route-card${state.selectedRouteCandidate===c.id?' active':''}${(c.needsSplit||c.bendWarning)?' needs-split':''}" data-route-candidate="${c.id}">`+
        `<span class="route-card-main"><span class="route-card-title">${c.name}</span><span class="route-card-desc">${c.desc}</span>${badge}<span class="route-card-diagnostics">${chips.join('')}</span><span class="route-card-status ${(c.needsSplit||c.bendWarning)?'warn':'ok'}">${c.needsSplit?'Нужна разбивка на несколько контуров':(c.bendWarning?'Нужен больший радиус / balloon bend':'Физическая проверка пройдена')}</span></span>`+
        `<span class="route-card-metrics"><span class="route-card-length">${(c.length/1000).toFixed(1)} м</span><span class="route-card-delta">${deltaText}</span></span></button>`;
    }).join('');
  }
  if(state.rejectedRouteReasons?.length){
    html+=`<div class="route-empty"><strong>Не показаны:</strong><br>${state.rejectedRouteReasons.map(x=>`• ${x}`).join('<br>')}<br><br>При тесном шаге змейка может требовать «balloon bend»; такой разворот пока не генерируется автоматически.</div>`;
  }
  if(!html)html='<div class="route-empty">Проверенный маршрут не найден. Измените шаг, радиус изгиба, положение коллектора или геометрию.</div>';
  host.innerHTML=html;
  host.querySelectorAll('[data-route-candidate]').forEach(btn=>btn.addEventListener('click',()=>selectRouteCandidateV10(btn.dataset.routeCandidate)));
};

function updatePhysicalStatusV10(c){
  const el=$('physicalStatusInfo'); if(!el)return;
  el.className='physical-status-info';
  if(!c){el.textContent='Проверка выполняется после построения маршрута.';return;}
  const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
  const bits=[];
  if(Number.isFinite(d.bend.minR))bits.push(`минимальный фактический R ${Math.round(d.bend.minR)} мм`);
  if(d.ratio)bits.push(`заполнение ${Math.round(d.ratio*100)}% от контрольной длины площадь/шаг`);
  bits.push(`длина ${(d.length/1000).toFixed(1)} м`);
  if(c.needsSplit||c.bendWarning){el.classList.add('warn');if(c.needsSplit)bits.push(`выше лимита ${Math.round(state.maxCircuitLengthM)} м — нужна разбивка`);if(c.bendWarning)bits.push(`R меньше заданного ${Math.round(d.bend.target)} мм — нужен другой разворот`);}else{el.classList.add('ok');bits.push('физическая проверка пройдена');}
  el.textContent=bits.join(' · ');
}

function selectRouteCandidateV10(id,close=false){
  const c=(state.routeCandidates||[]).find(x=>x.id===id); if(!c)return;
  state.selectedRouteCandidate=id; state.route=c.route.map(p=>({...p})); state.routeKind=c.name; state.routeComplete=!!c.physicalReady;
  renderPlan(); renderRouteCandidatesV8(); updatePhysicalStatusV10(c); if(close)closeSheetV5();
}
selectRouteCandidateV8 = selectRouteCandidateV10;

const roundedPathDV9BaseV10 = roundedPathD;
roundedPathD = function roundedPathDV10(points,ignoredRadiusMm){
  return roundedPathDV9BaseV10(points,requestedBendRadiusV10());
};

const generateRouteV9BaseV10 = generateRoute;
generateRoute = function generateRouteV10(){
  collectInputs(); recomputeGeometry();
  if(!state.supply){setStatus('Сначала укажите «Коллектор» на стене помещения.',true);return;}
  sameSideCollectorV8();
  state.routeCandidates=createRouteCandidatesV8();
  if(!state.routeCandidates.length){resetRoute();renderPlan();renderRouteCandidatesV8();openRouteSheetV8();updatePhysicalStatusV10(null);setStatus('Нет маршрута, который проходит текущую физическую проверку.',true);return;}
  const preferred=state.routeCandidates.find(c=>c.id==='spiral')||state.routeCandidates[0];
  state.selectedRouteCandidate=preferred.id;state.route=preferred.route.map(p=>({...p}));state.routeKind=preferred.name;state.routeComplete=!!preferred.physicalReady;
  renderPlan();renderRouteCandidatesV8();openRouteSheetV8();updatePhysicalStatusV10(preferred);
  setStatus(preferred.needsSplit?`Маршрут построен, но ${(preferred.length/1000).toFixed(1)} м превышает заданный лимит контура.`:(preferred.bendWarning?`${preferred.name}: геометрия построена, но текущий разворот не выдерживает Rmin ${Math.round(requestedBendRadiusV10())} мм.`:`${preferred.name}: физическая проверка пройдена.`),preferred.needsSplit||preferred.bendWarning);
};
const genBtnV10=$('generateBtn');
if(genBtnV10){genBtnV10.removeEventListener('click',generateRouteV9BaseV10);genBtnV10.addEventListener('click',generateRoute);}

const serializeStateV10Base=serializeState;
serializeState=function serializeStateV10(){
  const item=serializeStateV10Base();
  item.bendRadiusMode=state.bendRadiusMode||'auto';item.minBendRadiusMm=requestedBendRadiusV10();item.maxCircuitLengthM=Number(state.maxCircuitLengthM)||100;item.coldWall=state.coldWall||'none';
  return item;
};

const syncInputsV10Base=syncInputs;
syncInputs=function syncInputsV10(){syncInputsV10Base();syncBendUiV10();updatePipeGeometryInfoV9();};

const collectInputsV10Base=collectInputs;
collectInputs=function collectInputsV10(){
  collectInputsV10Base();
  state.bendRadiusMode=$('bendRadiusModeInput')?.value==='manual'?'manual':'auto';
  if(state.bendRadiusMode==='manual')state.minBendRadiusMm=clamp(Number($('minBendRadiusInput')?.value)||80,20,500); else state.minBendRadiusMm=Math.round((Number(state.pipeDiameterMm)||16)*5);
  state.maxCircuitLengthM=clamp(Number($('maxCircuitLengthInput')?.value)||100,20,300);
  state.coldWall=$('coldWallInput')?.value||'none';
  syncBendUiV10();updatePipeGeometryInfoV9();
};

const loadSchemeV10Base=loadScheme;
loadScheme=function loadSchemeV10(raw){
  loadSchemeV10Base(raw);
  state.bendRadiusMode=raw?.bendRadiusMode==='manual'?'manual':'auto';state.minBendRadiusMm=Number(raw?.minBendRadiusMm)||Math.round((Number(state.pipeDiameterMm)||16)*5);state.maxCircuitLengthM=Number(raw?.maxCircuitLengthM)||100;state.coldWall=raw?.coldWall||'none';
  syncInputs();updatePhysicalStatusV10(null);renderPlan();
};

const newSchemeV10Base=newScheme;
newScheme=function newSchemeV10(){
  newSchemeV10Base();state.bendRadiusMode='auto';state.minBendRadiusMm=Math.round((Number(state.pipeDiameterMm)||16)*5);state.maxCircuitLengthM=100;state.coldWall='none';syncInputs();updatePhysicalStatusV10(null);renderPlan();
};

function resetPhysicalRouteV10(){resetRoute();updatePhysicalStatusV10(null);renderPlan();}
$('bendRadiusModeInput')?.addEventListener('change',()=>{state.bendRadiusMode=$('bendRadiusModeInput').value==='manual'?'manual':'auto';if(state.bendRadiusMode==='auto')state.minBendRadiusMm=Math.round((Number(state.pipeDiameterMm)||16)*5);syncBendUiV10();updatePipeGeometryInfoV9();resetPhysicalRouteV10();});
$('minBendRadiusInput')?.addEventListener('change',()=>{if(state.bendRadiusMode==='manual')state.minBendRadiusMm=clamp(Number($('minBendRadiusInput').value)||80,20,500);updatePipeGeometryInfoV9();resetPhysicalRouteV10();});
$('maxCircuitLengthInput')?.addEventListener('change',()=>{state.maxCircuitLengthM=clamp(Number($('maxCircuitLengthInput').value)||100,20,300);resetPhysicalRouteV10();});
$('coldWallInput')?.addEventListener('change',()=>{state.coldWall=$('coldWallInput').value||'none';resetPhysicalRouteV10();});
$('pipeDiameterInput')?.addEventListener('input',()=>{if((state.bendRadiusMode||'auto')==='auto'){state.minBendRadiusMm=Math.round((Number($('pipeDiameterInput').value)||16)*5);syncBendUiV10();}updatePipeGeometryInfoV9();});

syncBendUiV10();updatePipeGeometryInfoV9();updatePhysicalStatusV10(null);

// Показываем выбранную холодную стену прямо на плане.
const renderPlanV10Base = renderPlan;
renderPlan = function renderPlanV10(){
  renderPlanV10Base();
  if(!planSvg || !state.coldWall || state.coldWall==='none') return;
  const b=state.bounds, side=state.coldWall;
  const line=document.createElementNS(SVG_NS,'line');
  let x1,y1,x2,y2;
  if(side==='top'){x1=b.minX;y1=b.minY;x2=b.maxX;y2=b.minY;}
  if(side==='bottom'){x1=b.minX;y1=b.maxY;x2=b.maxX;y2=b.maxY;}
  if(side==='left'){x1=b.minX;y1=b.minY;x2=b.minX;y2=b.maxY;}
  if(side==='right'){x1=b.maxX;y1=b.minY;x2=b.maxX;y2=b.maxY;}
  line.setAttribute('x1',x1);line.setAttribute('y1',y1);line.setAttribute('x2',x2);line.setAttribute('y2',y2);
  line.setAttribute('stroke','#f97316');line.setAttribute('stroke-width',String(Math.max(4,5/Math.max(.001,state.scale))));line.setAttribute('stroke-linecap','round');line.setAttribute('opacity','.82');line.setAttribute('pointer-events','none');
  planSvg.appendChild(line);
};

$('pipeDiameterInput')?.addEventListener('change',()=>updatePhysicalStatusV10(null));
$('pipeStepInput')?.addEventListener('change',()=>updatePhysicalStatusV10(null));
$('wallOffsetInput')?.addEventListener('change',()=>updatePhysicalStatusV10(null));

// ===== v0.11: понятные карточки + автоматическое расширение тесных U-разворотов =====

function doglegSpecV11(points, i, radius) {
  // Автокоррекция v0.11 пока разрешена только для чистого прямоугольника: рядом с препятствиями
  // и во вогнутых углах нужен отдельный collision-aware генератор.
  if ((state.shapeType && state.shapeType !== 'rect') || state.sections.length !== 1 || state.excluded.size || (state.obstacles && state.obstacles.length)) return null;
  if (!points || i < 1 || i + 2 >= points.length) return null;
  const A = points[i - 1], B = points[i], C = points[i + 1], D = points[i + 2];
  const abH = nearly(A.y, B.y), bcH = nearly(B.y, C.y), cdH = nearly(C.y, D.y);
  if (abH === bcH || abH !== cdH) return null;
  const dirAB = abH ? Math.sign(B.x - A.x) : Math.sign(B.y - A.y);
  const dirCD = cdH ? Math.sign(D.x - C.x) : Math.sign(D.y - C.y);
  if (!dirAB || dirCD !== -dirAB) return null;
  const gap = dist(B, C);
  if (gap <= 1 || gap >= radius * 2 - 0.5) return null;
  const centerDistance = gap + 2 * radius;
  const h2 = 4 * radius * radius - (centerDistance * centerDistance) / 4;
  if (h2 <= 0) return null;
  const h = Math.sqrt(h2);
  const trim = radius + h; // максимальный вынос омега-разворота от его входа
  const inLen = dist(A, B), outLen = dist(C, D);
  if (inLen < trim + 20 || outLen < trim + 20) return null;

  if (abH) {
    const side = Math.sign(C.y - B.y);
    const start = { x: B.x - dirAB * trim, y: B.y };
    const end = { x: C.x - dirAB * trim, y: C.y };
    return { A, B, C, D, horizontal: true, dir: dirAB, side, gap, radius, h, trim, start, end };
  }
  const side = Math.sign(C.x - B.x);
  const start = { x: B.x, y: B.y - dirAB * trim };
  const end = { x: C.x, y: C.y - dirAB * trim };
  return { A, B, C, D, horizontal: false, dir: dirAB, side, gap, radius, h, trim, start, end };
}

function arcSamplesV11(cx, cy, r, a0, a1, direction, maxStep = Math.PI / 18) {
  let delta = a1 - a0;
  if (direction > 0) while (delta < 0) delta += Math.PI * 2;
  else while (delta > 0) delta -= Math.PI * 2;
  const n = Math.max(2, Math.ceil(Math.abs(delta) / maxStep));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + delta * (k / n);
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

function balloonSamplesV11(spec) {
  const R = spec.radius, s = spec.gap, h = spec.h;
  // Нормализованный R-L-R разворот: начало (0,0), конец (0,s), вынос по +X.
  const c1 = { x: 0, y: -R };
  const c2 = { x: h, y: s / 2 };
  const c3 = { x: 0, y: s + R };
  const t12 = { x: h / 2, y: (c1.y + c2.y) / 2 };
  const t23 = { x: h / 2, y: (c2.y + c3.y) / 2 };
  const a1s = Math.PI / 2;
  const a1e = Math.atan2(t12.y - c1.y, t12.x - c1.x);
  const a2s = Math.atan2(t12.y - c2.y, t12.x - c2.x);
  const a2e = Math.atan2(t23.y - c2.y, t23.x - c2.x);
  const a3s = Math.atan2(t23.y - c3.y, t23.x - c3.x);
  const a3e = -Math.PI / 2;
  let local = [
    ...arcSamplesV11(c1.x, c1.y, R, a1s, a1e, -1),
    ...arcSamplesV11(c2.x, c2.y, R, a2s, a2e, +1).slice(1),
    ...arcSamplesV11(c3.x, c3.y, R, a3s, a3e, -1).slice(1),
  ];
  // Небольшая нормализация концов против накопления floating point.
  local[0] = { x: 0, y: 0 };
  local[local.length - 1] = { x: 0, y: s };
  return local.map(p => {
    if (spec.horizontal) return {
      x: spec.start.x + spec.dir * p.x,
      y: spec.start.y + spec.side * p.y,
    };
    return {
      x: spec.start.x + spec.side * p.y,
      y: spec.start.y + spec.dir * p.x,
    };
  });
}

function autoBendAnalysisV11(points, radius = requestedBendRadiusV10()) {
  const correctedCorners = new Set();
  const specs = [];
  for (let i = 1; i + 2 < (points?.length || 0); i++) {
    const spec = doglegSpecV11(points, i, radius);
    if (!spec) continue;
    correctedCorners.add(i);
    correctedCorners.add(i + 1);
    specs.push({ i, spec });
    i += 1;
  }
  return { correctedCorners, specs, count: specs.length };
}

// Диагностика v0.11 знает, что тесный U-разворот может быть автоматически заменён
// омега-разворотом с фактическим радиусом Rmin.
cornerRadiusStatsV10 = function cornerRadiusStatsV11(points, skipEnds = 3) {
  const target = requestedBendRadiusV10();
  const auto = autoBendAnalysisV11(points, target);
  let minR = Infinity, cornerCount = 0, bad = 0;
  if (!points || points.length < 3) return { minR: Infinity, cornerCount: 0, bad: 0, target, autoCount: 0 };
  const start = Math.min(skipEnds, Math.max(1, points.length - 2));
  const end = Math.max(start, points.length - 1 - skipEnds);
  for (let i = start; i <= end; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    if (!a || !b || !c) continue;
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 0.5 || l2 < 0.5) continue;
    const cross = Math.abs(v1.x * v2.y - v1.y * v2.x), dot = v1.x * v2.x + v1.y * v2.y;
    if (cross < 0.01 || dot > 0.01) continue;
    cornerCount++;
    if (auto.correctedCorners.has(i)) {
      minR = Math.min(minR, target);
      continue;
    }
    const r = Math.min(target, l1 * 0.45, l2 * 0.45);
    minR = Math.min(minR, r);
    if (r + 0.5 < target) bad++;
  }
  return { minR, cornerCount, bad, target, autoCount: auto.count };
};

const physicalDiagnosticsV10BaseV11 = physicalDiagnosticsV10;
physicalDiagnosticsV10 = function physicalDiagnosticsV11(route, kind) {
  const d = physicalDiagnosticsV10BaseV11(route, kind);
  const a = autoBendAnalysisV11(route, requestedBendRadiusV10());
  d.autoBends = a.count;
  return d;
};

// Фактическая длина с учётом автоматически расширенных U-разворотов.
const routeLengthBaseV11 = routeLength;
routeLength = function routeLengthV11(route = state.route) {
  if (!route || route.length < 2) return 0;
  const R = requestedBendRadiusV10();
  let total = 0, current = route[0], i = 1;
  while (i < route.length) {
    if (i < route.length - 2) {
      const spec = doglegSpecV11(route, i, R);
      if (spec) {
        total += dist(current, spec.start);
        const samples = balloonSamplesV11(spec);
        for (let k = 1; k < samples.length; k++) total += dist(samples[k - 1], samples[k]);
        current = spec.end;
        i += 2;
        continue;
      }
    }
    total += dist(current, route[i]);
    current = route[i];
    i++;
  }
  return total;
};

// Рендер: обычные 90° углы скругляются как раньше, а тесные U-развороты
// автоматически заменяются расширенным омега-разворотом.
roundedPathD = function roundedPathDV11(points, radiusMm) {
  if (!points?.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const R = requestedBendRadiusV10();
  let d = `M ${points[0].x} ${points[0].y}`;
  let current = { ...points[0] };
  let i = 1;
  while (i < points.length - 1) {
    if (i + 2 < points.length) {
      const spec = doglegSpecV11(points, i, R);
      if (spec) {
        d += ` L ${spec.start.x} ${spec.start.y}`;
        const samples = balloonSamplesV11(spec);
        for (let k = 1; k < samples.length; k++) d += ` L ${samples[k].x} ${samples[k].y}`;
        current = { ...spec.end };
        i += 2;
        continue;
      }
    }
    const b = points[i], c = points[i + 1];
    const v1 = { x: current.x - b.x, y: current.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (l1 < 0.001 || l2 < 0.001 || Math.abs(cross) < 0.001) {
      d += ` L ${b.x} ${b.y}`;
      current = { ...b };
      i++;
      continue;
    }
    const r = Math.min(R, l1 * 0.45, l2 * 0.45);
    const p1 = { x: b.x + v1.x / l1 * r, y: b.y + v1.y / l1 * r };
    const p2 = { x: b.x + v2.x / l2 * r, y: b.y + v2.y / l2 * r };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
    current = p2;
    i++;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
};

function simpleCandidateStatusV11(c) {
  const d = c.diagnostics || physicalDiagnosticsV10(c.route, c.id);
  if (c.needsSplit) return { cls: 'warn', text: `Нужно разделить на несколько контуров` };
  if (c.bendWarning) return { cls: 'warn', text: `Есть поворот, который не удалось исправить автоматически` };
  if (d.autoBends > 0) return { cls: 'ok', text: `✓ Тесные развороты исправлены автоматически` };
  return { cls: 'ok', text: `✓ Можно укладывать` };
}

function routeTechnicalHtmlV11(c) {
  if (!c) return '';
  const d = c.diagnostics || physicalDiagnosticsV10(c.route, c.id);
  const ratio = d.ratio ? `${Math.round(d.ratio * 100)}%` : '—';
  const minR = Number.isFinite(d.bend?.minR) ? `${Math.round(d.bend.minR)} мм` : `≥ ${Math.round(d.bend?.target || requestedBendRadiusV10())} мм`;
  return `<details class="route-tech"><summary>Техническая информация</summary><div class="route-tech-grid">`+
    `<span>Труба</span><b>Ø${Math.round(Number(state.pipeDiameterMm)||16)} мм</b>`+
    `<span>Шаг</span><b>${Math.round(state.pipeStepMm)} мм</b>`+
    `<span>Мин. радиус</span><b>${minR}</b>`+
    `<span>Авторазворотов</span><b>${d.autoBends || 0}</b>`+
    `<span>Контроль заполнения</span><b>${ratio}</b>`+
    `<span>Лимит контура</span><b>${Math.round(state.maxCircuitLengthM || 100)} м</b>`+
    `</div></details>`;
}

renderRouteCandidatesV8 = function renderRouteCandidatesV11() {
  const host = $('routeCandidates'); if (!host) return;
  const list = state.routeCandidates || [];
  let html = '';
  if (list.length) {
    const minLen = Math.min(...list.map(x => x.length));
    html += list.map(c => {
      // Пересчитываем после внедрения авторазворотов.
      c.length = routeLength(c.route);
      c.diagnostics = physicalDiagnosticsV10(c.route, c.id);
      c.bendWarning = !c.diagnostics.bendOK;
      c.physicalReady = c.diagnostics.physicalReady;
      const delta = c.length - minLen;
      const deltaText = Math.abs(delta) < 50 ? 'самый короткий' : `${delta > 0 ? '+' : ''}${(delta / 1000).toFixed(1)} м`;
      const st = simpleCandidateStatusV11(c);
      return `<button class="route-card simple${state.selectedRouteCandidate===c.id?' active':''}${(c.needsSplit||c.bendWarning)?' needs-split':''}" data-route-candidate="${c.id}">`+
        `<span class="route-card-main"><span class="route-card-title">${c.name}</span><span class="route-card-desc">${c.desc}</span><span class="route-card-status ${st.cls}">${st.text}</span></span>`+
        `<span class="route-card-metrics"><span class="route-card-length">${(c.length/1000).toFixed(1)} м</span><span class="route-card-delta">${deltaText}</span></span></button>`;
    }).join('');
    const selected = list.find(c => c.id === state.selectedRouteCandidate) || list[0];
    html += routeTechnicalHtmlV11(selected);
  }
  if (state.rejectedRouteReasons?.length) {
    const names = state.rejectedRouteReasons.map(x => String(x).split(':')[0]).filter((v,i,a)=>a.indexOf(v)===i);
    if (names.length) html += `<div class="route-empty compact"><strong>Пока не удалось построить:</strong> ${names.join(', ')}. Эти варианты скрыты, чтобы не показывать сомнительную схему.</div>`;
  }
  if (!html) html = '<div class="route-empty">Пока не удалось построить корректную раскладку. Попробуйте изменить шаг трубы или положение коллектора.</div>';
  host.innerHTML = html;
  host.querySelectorAll('[data-route-candidate]').forEach(btn => btn.addEventListener('click', () => selectRouteCandidateV10(btn.dataset.routeCandidate)));
};

updatePhysicalStatusV10 = function updatePhysicalStatusV11(c) {
  const el = $('physicalStatusInfo'); if (!el) return;
  el.className = 'physical-status-info';
  if (!c) { el.textContent = 'После построения здесь будет краткий итог проверки.'; return; }
  const d = c.diagnostics || physicalDiagnosticsV10(c.route, c.id);
  if (c.needsSplit) { el.classList.add('warn'); el.textContent = `Контур ${(c.length/1000).toFixed(1)} м — лучше разделить помещение на несколько контуров.`; return; }
  if (!d.bendOK) { el.classList.add('warn'); el.textContent = 'Один из поворотов пока не удалось сделать достаточно плавным.'; return; }
  el.classList.add('ok');
  el.textContent = d.autoBends ? `✓ Схема проверена. ${d.autoBends} тесн. разворот${d.autoBends===1?'':'а'} расширен${d.autoBends===1?'':'ы'} автоматически.` : '✓ Схема прошла проверку.';
};

// Более понятные сообщения после генерации.
const generateRouteV10BaseV11 = generateRoute;
generateRoute = function generateRouteV11(){
  collectInputs(); recomputeGeometry();
  if(!state.supply){setStatus('Сначала укажите коллектор на стене помещения.',true);return;}
  sameSideCollectorV8();
  state.routeCandidates=createRouteCandidatesV8();
  // После создания кандидатов обновляем диагностику с авторазворотами.
  state.routeCandidates.forEach(c=>{
    c.length=routeLength(c.route); c.diagnostics=physicalDiagnosticsV10(c.route,c.id);
    c.needsSplit=!c.diagnostics.lengthOK; c.bendWarning=!c.diagnostics.bendOK; c.physicalReady=c.diagnostics.physicalReady;
  });
  if(!state.routeCandidates.length){resetRoute();renderPlan();renderRouteCandidatesV8();openRouteSheetV8();updatePhysicalStatusV10(null);setStatus('Корректную раскладку пока построить не удалось.',true);return;}
  const preferred=state.routeCandidates.find(c=>c.id==='spiral')||state.routeCandidates[0];
  state.selectedRouteCandidate=preferred.id;state.route=preferred.route.map(p=>({...p}));state.routeKind=preferred.name;state.routeComplete=!!preferred.physicalReady;
  renderPlan();renderRouteCandidatesV8();openRouteSheetV8();updatePhysicalStatusV10(preferred);
  const st=simpleCandidateStatusV11(preferred);
  setStatus(`${preferred.name}: ${(preferred.length/1000).toFixed(1)} м. ${st.text.replace('✓ ','')}`,st.cls==='warn');
};
const genBtnV11=$('generateBtn');
if(genBtnV11){genBtnV11.removeEventListener('click',generateRouteV10BaseV11);genBtnV11.addEventListener('click',generateRoute);}

if ($('routeSheetSubtitle')) $('routeSheetSubtitle').textContent='Выберите рисунок — длина посчитана автоматически';
if ($('routeSheetHelp')) $('routeSheetHelp').textContent='Приложение само проверяет повороты и, где возможно, расширяет тесные развороты. Подробные инженерные показатели спрятаны в «Технической информации».';

updatePhysicalStatusV10(null);

// ===== v0.12: сложные формы — зональная змейка для L/T и ортогонально-монотонных помещений =====
// Идея: не искать случайный путь по всей сетке. Сначала раскладываем помещение на
// поперечные зоны одинакового профиля, затем подбираем чётность проходов в каждой
// зоне так, чтобы труба непрерывно переходила между ними. Это первый слой схемы
// Routing + Coverage для сложной геометрии.

function sweepAxisPositionsV12(min, max, step, phase = 0) {
  const out = [];
  let v = min + phase;
  while (v <= max + 0.001) { out.push(v); v += step; }
  return out;
}

function pointAllowedAtInsetV12(x,y,inset){
  // Внутренние границы между прямоугольными частями — не стены. Поэтому здесь
  // используем inclusive-union: внешний край всё равно отсечётся проверкой ±d.
  if(!insideRoom(x,y,true)||pointExcluded(x,y))return false;
  const d=Math.max(0,inset*.92);
  if(!d)return true;
  return insideRoom(x-d,y,true)&&insideRoom(x+d,y,true)&&insideRoom(x,y-d,true)&&insideRoom(x,y+d,true) && !pointExcluded(x-d,y)&&!pointExcluded(x+d,y)&&!pointExcluded(x,y-d)&&!pointExcluded(x,y+d);
}

function buildSweepProfilesV12(axis, phase = 0, extraInset = 0) {
  // v0.13: допускаем препятствия. Если они разрезают поперечную линию на
  // несколько независимых интервалов, этот конкретный sweep отклоняется,
  // но другая ориентация или резервный графовый routing всё ещё могут сработать.
  const b = state.bounds;
  const off = Math.max(0, Number(state.wallOffsetMm) || 0) + Math.max(0,extraInset);
  const step = Math.max(40, Number(state.pipeStepMm) || 150);
  const xs = sweepAxisPositionsV12(b.minX + off, b.maxX - off, step, axis === 'vertical' ? phase : 0);
  const ys = sweepAxisPositionsV12(b.minY + off, b.maxY - off, step, axis === 'horizontal' ? phase : 0);
  if (!xs.length || !ys.length) return null;
  const allowed = ys.map(y => xs.map(x => pointAllowedAtInsetV12(x, y, off)));
  const ports=routePorts();
  const corridorMatches=!!ports && ((axis==='vertical'&&(ports.supplySide==='top'||ports.supplySide==='bottom')) || (axis==='horizontal'&&(ports.supplySide==='left'||ports.supplySide==='right')));
  const corridorCoord=corridorMatches ? (axis==='vertical'?ports.supply.x:ports.supply.y) : null;
  const corridorHalf=Math.max((Number(state.pipeDiameterMm)||16)*2.2, step*.52);
  const farSide = !corridorMatches ? null : (ports.supplySide==='bottom'||ports.supplySide==='right' ? 0 : 1);
  const lanes = [];

  if (axis === 'horizontal') {
    for (let r = 0; r < ys.length; r++) {
      if(corridorMatches && Math.abs(ys[r]-corridorCoord)<corridorHalf) continue;
      const runs = [];
      let c = 0;
      while (c < xs.length) {
        while (c < xs.length && !allowed[r][c]) c++;
        if (c >= xs.length) break;
        const a = c;
        while (c + 1 < xs.length && allowed[r][c + 1]) c++;
        runs.push([a, c]); c++;
      }
      if (!runs.length) continue;
      if (runs.length !== 1) return null;
      const [a, z] = runs[0];
      lanes.push({ coord: ys[r], low: xs[a], high: xs[z], naturalCount: z - a + 1 });
    }
  } else {
    for (let c = 0; c < xs.length; c++) {
      if(corridorMatches && Math.abs(xs[c]-corridorCoord)<corridorHalf) continue;
      const runs = [];
      let r = 0;
      while (r < ys.length) {
        while (r < ys.length && !allowed[r][c]) r++;
        if (r >= ys.length) break;
        const a = r;
        while (r + 1 < ys.length && allowed[r + 1][c]) r++;
        runs.push([a, r]); r++;
      }
      if (!runs.length) continue;
      if (runs.length !== 1) return null;
      const [a, z] = runs[0];
      lanes.push({ coord: xs[c], low: ys[a], high: ys[z], naturalCount: z - a + 1 });
    }
  }
  if (lanes.length < 2) return null;

  // Последовательные проходы с одинаковыми концами образуют одну геометрическую зону.
  let groups = [];
  for (const lane of lanes) {
    const g = groups[groups.length - 1];
    const coordGap=g?Math.abs(lane.coord-g.coords[g.coords.length-1]):0;
    const sameProfile=!!g&&nearly(g.low,lane.low,1)&&nearly(g.high,lane.high,1);
    if (!g || !sameProfile || coordGap > step*1.55) {
      groups.push({ low: lane.low, high: lane.high, coords: [lane.coord], gapBefore:!!g&&sameProfile&&coordGap>step*1.55 });
    } else g.coords.push(lane.coord);
  }
  // Вогнутый угол после учёта отступа иногда создаёт переходную полоску шириной ровно
  // в один проход. Она не является самостоятельной зоной: если соседние зоны имеют
  // общий край, поглощаем эту полоску переходом между ними. Это убирает ложную
  // «третью зону» у Т-образной комнаты и сохраняет непрерывность змейки.
  let changed=true;
  while(changed && groups.length>2){
    changed=false;
    for(let i=1;i<groups.length-1;i++){
      const g=groups[i];
      if(g.coords.length>1) continue;
      if(sharedProfileSidesV12(groups[i-1],groups[i+1]).length){
        groups=[...groups.slice(0,i),...groups.slice(i+1)]; changed=true; break;
      }
    }
  }
  return { axis, groups, step, inset: off, corridorSide:farSide };
}

function sharedProfileSidesV12(a, b) {
  const s = [];
  if (nearly(a.low, b.low, 1)) s.push(0);
  if (nearly(a.high, b.high, 1)) s.push(1);
  return s;
}

function chooseLaneCountV12(group, parity, step) {
  const natural = group.coords.length;
  const span = Math.abs(group.coords[group.coords.length - 1] - group.coords[0]);
  const choices = [];
  for (let n = Math.max(1, natural - 3); n <= natural + 3; n++) {
    if ((n & 1) !== parity) continue;
    if (n === 1) {
      if (span <= step * 0.7) choices.push({ n, spacing: step, penalty: Math.abs(n - natural) * step });
      continue;
    }
    const spacing = span / (n - 1);
    if (spacing < step * 0.72 || spacing > step * 1.28) continue;
    choices.push({ n, spacing, penalty: Math.abs(spacing - step) + Math.abs(n - natural) * step * 0.15 });
  }
  choices.sort((a, b) => a.penalty - b.penalty);
  return choices[0] || null;
}

function linspaceV12(a, b, n) {
  if (n <= 1) return [(a + b) / 2];
  return Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
}

function coreSegmentSafeV12(a, b, inset = Math.max(0,Number(state.wallOffsetMm)||0)) {
  if (!nearly(a.x, b.x, 1) && !nearly(a.y, b.y, 1)) return false;
  const len = dist(a, b), n = Math.max(2, Math.ceil(len / 30));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (!pointAllowedAtInsetV12(x, y, inset)) return false;
  }
  return true;
}

function buildZoneSweepCoresV12() {
  const step = Math.max(40, Number(state.pipeStepMm) || 150);
  const phases = [0, step * 0.25, step * 0.5, step * 0.75];
  const out = [];

  const insetExtras=[0,step*.35,step*.60];
  for (const extraInset of insetExtras) {
   for (const axis of ['horizontal', 'vertical']) {
    for (const phase of phases) {
      const profile = buildSweepProfilesV12(axis, phase, extraInset);
      if (!profile) continue;
      for (const reverseGroups of [false, true]) {
        const groups = (reverseGroups ? [...profile.groups].reverse() : profile.groups).map(g => ({...g, coords: [...g.coords]}));
        if (reverseGroups) groups.forEach(g => g.coords.reverse());
        const shared = [];
        let possible = true;
        for (let i = 0; i < groups.length - 1; i++) {
          let s = sharedProfileSidesV12(groups[i], groups[i + 1]);
          const splitGap=!!groups[i].gapBefore||!!groups[i+1].gapBefore;
          if(splitGap && profile.corridorSide!=null && s.includes(profile.corridorSide)) s=[profile.corridorSide];
          if (!s.length) { possible = false; break; }
          shared.push(s);
        }
        if (!possible) continue;

        const sharedChoices = [];
        const walkShared = (i, arr) => {
          if (i >= shared.length) { sharedChoices.push([...arr]); return; }
          for (const side of shared[i]) { arr.push(side); walkShared(i + 1, arr); arr.pop(); }
        };
        walkShared(0, []);
        if (!sharedChoices.length) sharedChoices.push([]);

        for (const bridges of sharedChoices) {
          for (const firstEntry of [0, 1]) {
            for (const lastExit of [0, 1]) {
              const entries = new Array(groups.length), exits = new Array(groups.length);
              entries[0] = firstEntry;
              for (let i = 0; i < groups.length - 1; i++) { exits[i] = bridges[i]; entries[i + 1] = bridges[i]; }
              exits[groups.length - 1] = lastExit;

              const counts = [];
              let penalty = 0, countsOK = true;
              for (let i = 0; i < groups.length; i++) {
                // N нечётное => конец на противоположной стороне; N чётное => на той же.
                const parity = entries[i] === exits[i] ? 0 : 1;
                const pick = chooseLaneCountV12(groups[i], parity, step);
                if (!pick) { countsOK = false; break; }
                counts.push(pick.n); penalty += pick.penalty;
              }
              if (!countsOK) continue;

              const points = [];
              let ok = true;
              for (let gi = 0; gi < groups.length; gi++) {
                const g = groups[gi];
                const coords = linspaceV12(g.coords[0], g.coords[g.coords.length - 1], counts[gi]);
                let side = entries[gi];
                for (let li = 0; li < coords.length; li++) {
                  const q = coords[li];
                  const a = axis === 'horizontal' ? {x:g.low,y:q} : {x:q,y:g.low};
                  const b = axis === 'horizontal' ? {x:g.high,y:q} : {x:q,y:g.high};
                  const start = side === 0 ? a : b, end = side === 0 ? b : a;
                  if (points.length) {
                    const prev = points[points.length - 1];
                    if (!coreSegmentSafeV12(prev, start, profile.inset)) { ok = false; break; }
                  }
                  points.push(start, end);
                  side = 1 - side;
                }
                if (!ok) break;
              }
              if (!ok) continue;
              const core = cleanPolyline(points);
              if (core.length < 4 || !validRoute(core)) continue;
              out.push({ core, axis, phase, penalty:penalty+extraInset*.4, zones: groups.length, inset:profile.inset });
            }
          }
        }
      }
    }
   }
  }

  // Удаляем геометрически одинаковые варианты и оставляем наиболее ровный шаг.
  const seen = new Set(), unique = [];
  out.sort((a,b)=>a.penalty-b.penalty || routeLength(a.core)-routeLength(b.core));
  for (const c of out) {
    const s=c.core[0], e=c.core[c.core.length-1];
    const key=`${c.axis}:${Math.round(s.x/10)},${Math.round(s.y/10)}:${Math.round(e.x/10)},${Math.round(e.y/10)}:${c.zones}`;
    if (seen.has(key)) continue; seen.add(key); unique.push(c);
    if (unique.length >= 20) break;
  }
  return unique;
}

function connectorVariantsV12(port, target, side) {
  const variants = [];
  const add = pts => {
    const c = cleanPolyline(pts);
    if (c.length >= 2 && c.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) variants.push(c);
  };
  if (nearly(port.x,target.x,1) || nearly(port.y,target.y,1)) add([port,target]);
  add([port,{x:target.x,y:port.y},target]);
  add([port,{x:port.x,y:target.y},target]);
  const inset = Math.max(25, Math.min(Math.max(state.wallOffsetMm * .55, 35), Math.max(45, state.pipeStepMm * .45)));
  if (side === 'left') {
    const x=port.x+inset; add([port,{x,y:port.y},{x,y:target.y},target]);
  } else if (side === 'right') {
    const x=port.x-inset; add([port,{x,y:port.y},{x,y:target.y},target]);
  } else if (side === 'top') {
    const y=port.y+inset; add([port,{x:port.x,y},{x:target.x,y},target]);
  } else if (side === 'bottom') {
    const y=port.y-inset; add([port,{x:port.x,y},{x:target.x,y},target]);
  }
  return variants;
}

function samePointV12(a,b,eps=1){return !!a&&!!b&&dist(a,b)<=eps;}

function segmentBlockedByPolylineV12(a,b,poly,allowPoint=null){
  if(!poly||poly.length<2)return false;
  for(let i=1;i<poly.length;i++){
    const c=poly[i-1],d=poly[i];
    if(!segmentsIntersect(a,b,c,d))continue;
    // Касание в единственной разрешённой точке (вход в core) допустимо.
    if(allowPoint && (samePointV12(a,allowPoint,1)||samePointV12(b,allowPoint,1)) &&
       (samePointV12(c,allowPoint,1)||samePointV12(d,allowPoint,1))) continue;
    return true;
  }
  return false;
}

function inwardPortPointV12(port,side,factor=1){
  const d=Math.max(35,(Number(state.wallOffsetMm)||100)*factor);
  if(side==='left')return{x:port.x+d,y:port.y};
  if(side==='right')return{x:port.x-d,y:port.y};
  if(side==='top')return{x:port.x,y:port.y+d};
  return{x:port.x,y:port.y-d};
}

function routeGridPathV12(source,target,blockedPolys=[]){
  const b=state.bounds, span=Math.max(b.width,b.height);
  const grid=Math.max(40,Math.min(90,Math.ceil((span/150)/10)*10));
  const off=Math.max(0,Number(state.wallOffsetMm)||0);
  const xs=[],ys=[];
  for(let x=b.minX+off;x<=b.maxX-off+.1;x+=grid)xs.push(x);
  for(let y=b.minY+off;y<=b.maxY-off+.1;y+=grid)ys.push(y);
  const addUnique=(arr,v,lo,hi)=>{if(v>=lo-1&&v<=hi+1&&!arr.some(q=>nearly(q,v,1)))arr.push(v);};
  addUnique(xs,source.x,b.minX+off,b.maxX-off);addUnique(xs,target.x,b.minX+off,b.maxX-off);
  addUnique(ys,source.y,b.minY+off,b.maxY-off);addUnique(ys,target.y,b.minY+off,b.maxY-off);
  // Полезные координаты около граней прямоугольных частей помогают BFS идти вдоль сложной стены.
  for(const r of state.sections){
    for(const x of [r.x+off,r.x+r.width-off])addUnique(xs,x,b.minX+off,b.maxX-off);
    for(const y of [r.y+off,r.y+r.height-off])addUnique(ys,y,b.minY+off,b.maxY-off);
  }
  xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
  const xi=xs.findIndex(x=>nearly(x,source.x,1)), yi=ys.findIndex(y=>nearly(y,source.y,1));
  const xt=xs.findIndex(x=>nearly(x,target.x,1)), yt=ys.findIndex(y=>nearly(y,target.y,1));
  if(xi<0||yi<0||xt<0||yt<0)return null;
  const key=(i,j)=>`${i},${j}`, startKey=key(xi,yi), goalKey=key(xt,yt);
  const allowed=(i,j)=>{
    const p={x:xs[i],y:ys[j]};
    if(key(i,j)===startKey||key(i,j)===goalKey)return true;
    return pointAllowedAtInsetV12(p.x,p.y,Math.max(0,Number(state.wallOffsetMm)||0));
  };
  const edgeCache=new Map();
  const edgeOK=(i,j,ni,nj)=>{
    const ek=`${i},${j}:${ni},${nj}`,rk=`${ni},${nj}:${i},${j}`;
    if(edgeCache.has(ek))return edgeCache.get(ek);
    const a={x:xs[i],y:ys[j]},c={x:xs[ni],y:ys[nj]};
    let ok=coreSegmentSafeV12(a,c);
    if(ok){for(const poly of blockedPolys){if(segmentBlockedByPolylineV12(a,c,poly,target)){ok=false;break;}}}
    edgeCache.set(ek,ok);edgeCache.set(rk,ok);return ok;
  };
  const q=[[xi,yi]], parent=new Map(),seen=new Set([startKey]);let qi=0,found=false;
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  while(qi<q.length&&q.length<40000){
    const [i,j]=q[qi++];if(key(i,j)===goalKey){found=true;break;}
    for(const [di,dj] of dirs){const ni=i+di,nj=j+dj;if(ni<0||nj<0||ni>=xs.length||nj>=ys.length)continue;const k=key(ni,nj);if(seen.has(k)||!allowed(ni,nj)||!edgeOK(i,j,ni,nj))continue;seen.add(k);parent.set(k,[i,j]);q.push([ni,nj]);}
  }
  if(!found)return null;
  const nodes=[];let cur=[xt,yt];
  while(true){nodes.push({x:xs[cur[0]],y:ys[cur[1]]});const k=key(cur[0],cur[1]);if(k===startKey)break;cur=parent.get(k);if(!cur)return null;}
  return cleanPolyline(nodes.reverse());
}

function routedConnectorV12(port,target,side,blockedPolys=[]){
  for(const factor of [1,.82,1.25]){
    const source=inwardPortPointV12(port,side,factor);
    if(!pointAllowedAtInsetV12(source.x,source.y,Math.max(0,Number(state.wallOffsetMm)||0)))continue;
    if(segmentBlockedByPolylineV12(port,source,blockedPolys[0],target))continue;
    const path=routeGridPathV12(source,target,blockedPolys);
    if(path){const result=cleanPolyline([port,...path]);if(result.every((p,i)=>!i||segmentSafe(result[i-1],p,[port,target])))return result;}
  }
  return null;
}

function attachComplexPortsV12(core, ports) {
  if (!core?.length || !ports) return null;
  const start = core[0], end = core[core.length - 1];
  const supplyOpts = connectorVariantsV12(ports.supply, start, ports.supplySide);
  const returnOpts = connectorVariantsV12(ports.ret, end, ports.returnSide).map(x => [...x].reverse());
  const candidates=[];
  for(const lead of supplyOpts){
    for(const tail of returnOpts){
      const route=cleanPolyline([...lead,...core.slice(1),...tail.slice(1)]);
      if(!validRoute(route)) continue;
      candidates.push(route);
    }
  }
  if(candidates.length){candidates.sort((a,b)=>routeLength(a)-routeLength(b));return candidates[0];}

  // Если простой Г-образный подвод пересекает заполнение, ищем два независимых пути
  // по свободному пространству вокруг уже построенного core.
  const lead=routedConnectorV12(ports.supply,start,ports.supplySide,[core]);
  if(lead){
    const tailFromPort=routedConnectorV12(ports.ret,end,ports.returnSide,[core,lead]);
    if(tailFromPort){
      const tail=[...tailFromPort].reverse();
      const route=cleanPolyline([...lead,...core.slice(1),...tail.slice(1)]);
      if(validRoute(route))return route;
    }
  }
  // Иногда выгоднее сначала зарезервировать коридор обратки.
  const tailFirst=routedConnectorV12(ports.ret,end,ports.returnSide,[core]);
  if(tailFirst){
    const leadSecond=routedConnectorV12(ports.supply,start,ports.supplySide,[core,tailFirst]);
    if(leadSecond){
      const route=cleanPolyline([...leadSecond,...core.slice(1),...[...tailFirst].reverse().slice(1)]);
      if(validRoute(route))return route;
    }
  }
  return null;
}

function generateZonedComplexRouteV12() {
  const ports = routePorts();
  if (!ports) return null;
  const cores = buildZoneSweepCoresV12();
  const candidates=[];
  for (const c of cores) {
    const route = attachComplexPortsV12(c.core, ports);
    if (!route) continue;
    candidates.push({route, zones:c.zones, axis:c.axis, score:routeLength(route)+c.penalty*4});
  }
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]||null;
}

// Подменяем только ветку сложной геометрии. Прямоугольные улитка/змейка v0.11 остаются без изменений.
const createRouteCandidatesV11BaseV12 = createRouteCandidatesV8;
createRouteCandidatesV8 = function createRouteCandidatesV12(){
  const simpleRect = (!state.shapeType || state.shapeType==='rect') && state.sections.length===1 && !state.excluded.size && !(state.obstacles&&state.obstacles.length);
  if (simpleRect) return createRouteCandidatesV11BaseV12();

  const out=[]; state.rejectedRouteReasons=[];
  // Новый генератор рассчитан на ортогональные L/T и составные комнаты без внутренних препятствий.
  const zoned = generateZonedComplexRouteV12();
  if (zoned?.route) {
    const c=physicalCandidateV10('zoned-snake','Змейка по зонам',`Помещение разбито на ${zoned.zones} геометрические зоны; труба проходит их одним непрерывным контуром.`,zoned.route,'сложная форма');
    if(c){c.zones=zoned.zones;c.axis=zoned.axis;out.push(c);}
  }

  // Старый графовый генератор оставляем резервным: он показывается только если проходит ту же валидацию.
  if(!out.length){
    const fallback=generateComplexRoute();
    if(fallback?.route){
      const c=physicalCandidateV10('shape-snake','Змейка по форме','Резервный маршрут по дискретной сетке.',fallback.route,'сложная форма');
      if(c)out.push(c);
    }
  }
  if(!out.length && (state.obstacles?.length || state.excluded?.size)) {
    state.rejectedRouteReasons.push('Препятствия в сложной комнате: новый зональный routing ещё не подключён');
  }
  return out;
};

// Для сложной формы поясняем, что это первый этап зонального алгоритма.
const simpleCandidateStatusV11BaseV12 = simpleCandidateStatusV11;
simpleCandidateStatusV11 = function simpleCandidateStatusV12(c){
  if(c?.id==='zoned-snake'){
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(!d.bendOK)return{cls:'warn',text:'Маршрут построен; плавность поворотов ещё требует проверки'};
    return{cls:'ok',text:'✓ Непрерывный маршрут по сложной форме построен'};
  }
  return simpleCandidateStatusV11BaseV12(c);
};

if ($('routeSheetHelp')) $('routeSheetHelp').textContent='Для Г- и Т-образных комнат приложение сначала делит площадь на простые зоны, затем соединяет их одним непрерывным маршрутом. Вариант показывается только без пересечений и выхода за стены.';


// ===== v0.13: сложные формы + препятствия =====
// Цель: не отбрасывать всю Г/Т-комнату из-за препятствия. Сначала пробуем
// несколько зональных sweep-кандидатов в обеих ориентациях. Если препятствие
// примыкает к стене, оно просто меняет профиль свободной зоны. Для внутренних
// островков дополнительно остаётся резервный графовый routing.

function obstacleTouchesOuterBoundaryV13(o, eps = 3) {
  if (!o) return false;
  const segs = computeOuterBoundarySegments();
  const r = {x1:o.x,y1:o.y,x2:o.x+o.width,y2:o.y+o.height};
  for (const s of segs) {
    if (nearly(s.y1,s.y2)) {
      const y=s.y1;
      if ((Math.abs(r.y1-y)<=eps || Math.abs(r.y2-y)<=eps) && Math.min(r.x2,Math.max(s.x1,s.x2))-Math.max(r.x1,Math.min(s.x1,s.x2))>eps) return true;
    } else {
      const x=s.x1;
      if ((Math.abs(r.x1-x)<=eps || Math.abs(r.x2-x)<=eps) && Math.min(r.y2,Math.max(s.y1,s.y2))-Math.max(r.y1,Math.min(s.y1,s.y2))>eps) return true;
    }
  }
  return false;
}

function complexObstacleSummaryV13(){
  const obs=state.obstacles||[];
  if(!obs.length) return {count:0,edge:0,interior:0};
  let edge=0;
  for(const o of obs) if(obstacleTouchesOuterBoundaryV13(o,5)) edge++;
  return {count:obs.length,edge,interior:obs.length-edge};
}

function generateZonedComplexRoutesV13(limit=6){
  const ports=routePorts();
  if(!ports) return [];
  const cores=buildZoneSweepCoresV12();
  const candidates=[];
  for(const c of cores){
    const route=attachComplexPortsV12(c.core,ports);
    if(!route || !validRoute(route)) continue;
    const d=physicalDiagnosticsV10(route,'zoned-snake');
    // Сначала предпочитаем маршруты без самопересечений/выхода за границы,
    // затем более ровные по шагу и короткие. bendOK пока только влияет на ранг.
    const score=routeLength(route)+c.penalty*4+(d.bendOK?0:1500)+(d.lengthOK?0:100000);
    candidates.push({route,zones:c.zones,axis:c.axis,score,diagnostics:d});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const out=[],seen=[];
  for(const c of candidates){
    // Оставляем геометрически разные варианты: по оси и заметно отличающейся длине.
    if(seen.some(x=>x.axis===c.axis && Math.abs(x.len-routeLength(c.route))<250)) continue;
    seen.push({axis:c.axis,len:routeLength(c.route)}); out.push(c);
    if(out.length>=limit) break;
  }
  return out;
}

function complexCandidateNameV13(axis, idx){
  const base=axis==='horizontal'?'Змейка вдоль комнаты':'Поперечная змейка';
  return idx?`${base} ${idx+1}`:base;
}

const createRouteCandidatesV12BaseV13=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV13(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect) return createRouteCandidatesV12BaseV13();

  const out=[]; state.rejectedRouteReasons=[];
  const info=complexObstacleSummaryV13();
  const zoned=generateZonedComplexRoutesV13(6);
  let perAxis={horizontal:0,vertical:0};
  for(const z of zoned){
    const n=perAxis[z.axis]++;
    // Пользователю достаточно максимум двух вариантов на направление.
    if(n>1) continue;
    const badge=info.count ? (info.interior?'обход препятствий':'обход препятствия у стены') : 'сложная форма';
    const c=physicalCandidateV10(`zoned-${z.axis}-${n}`,complexCandidateNameV13(z.axis,n),
      info.count?`Непрерывный маршрут по сложной форме с обходом ${info.count===1?'препятствия':'препятствий'}.`:`Непрерывный маршрут по сложной форме.`,z.route,badge);
    if(c){c.zones=z.zones;c.axis=z.axis;out.push(c);}
  }

  // Для внутренних препятствий зональный sweep может разорваться на два прохода.
  // Тогда пробуем графовый маршрут как резервный кандидат.
  if(!out.length){
    const fallback=generateComplexRoute();
    if(fallback?.route&&validRoute(fallback.route)){
      const c=physicalCandidateV10('shape-graph','Маршрут с обходом','Резервный маршрут по свободной сетке помещения.',fallback.route,'обход');
      if(c)out.push(c);
    }
  }

  if(!out.length){
    if(info.interior) state.rejectedRouteReasons.push('Внутреннее препятствие разрывает проходы: для этой конфигурации непрерывный маршрут пока не найден');
    else if(info.count) state.rejectedRouteReasons.push('Не удалось провести непрерывный контур вокруг препятствия с текущим шагом и отступом');
    else state.rejectedRouteReasons.push('Не удалось связать зоны комнаты одним непрерывным контуром');
  }
  out.sort((a,b)=>{
    const ar=a.diagnostics?.bendOK?0:1, br=b.diagnostics?.bendOK?0:1;
    return ar-br || a.length-b.length;
  });
  return out;
};

const simpleCandidateStatusV12BaseV13=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV13(c){
  if(c && String(c.id||'').startsWith('zoned-')){
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(!d.bendOK)return{cls:'warn',text:'Маршрут непрерывный, но часть разворотов ещё слишком тесная'};
    return{cls:'ok',text:'✓ Маршрут по сложной форме прошёл проверку'};
  }
  return simpleCandidateStatusV12BaseV13(c);
};

if($('routeSheetHelp')) $('routeSheetHelp').textContent='Для сложной комнаты приложение пробует несколько направлений укладки. Препятствия у стены уже входят в геометрию маршрута; внутренние препятствия дополнительно проверяются резервным поиском пути. Сомнительная трасса не показывается.';

// ===== v0.14: качество сложной трассы — прижим к стенам, без дублей, без длинного хода вдоль стены =====
// Пользовательская проблема v0.13: некоторые валидные маршруты выглядели плохо —
// оставляли большой незаполненный пояс у стены, повторно шли по той же линии или
// слишком долго вели подвод вдоль внешней стены. В v0.14 такие варианты либо
// получают большой штраф, либо полностью отбрасываются.

function collinearOverlapLengthV14(a,b,c,d){
  const h1=nearly(a.y,b.y,1), h2=nearly(c.y,d.y,1);
  if(h1&&h2&&nearly(a.y,c.y,1)){
    return Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)));
  }
  if(!h1&&!h2&&nearly(a.x,c.x,1)){
    return Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)));
  }
  return 0;
}

function routeHasRetraceV14(points){
  if(!points||points.length<4)return false;
  for(let i=0;i<points.length-1;i++){
    for(let j=i+2;j<points.length-1;j++){
      // Соседние сегменты могут касаться концами, но не должны повторять один и тот же участок.
      const ov=collinearOverlapLengthV14(points[i],points[i+1],points[j],points[j+1]);
      if(ov>3)return true;
    }
  }
  return false;
}

const validRouteV13BaseV14=validRoute;
validRoute=function validRouteV14(points){
  return validRouteV13BaseV14(points) && !routeHasRetraceV14(points);
};

function pointSegDistV14(p,a,b){
  const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y;
  const vv=vx*vx+vy*vy;
  if(vv<1e-9)return dist(p,a);
  const t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/vv));
  return Math.hypot(p.x-(a.x+vx*t),p.y-(a.y+vy*t));
}

function pointPolylineDistV14(p,poly){
  let best=Infinity;
  for(let i=1;i<(poly?.length||0);i++)best=Math.min(best,pointSegDistV14(p,poly[i-1],poly[i]));
  return best;
}

function boundaryCoverageV14(core){
  const segs=computeOuterBoundarySegments();
  const step=Math.max(50,Number(state.pipeStepMm)||150);
  const off=Math.max(0,Number(state.wallOffsetMm)||0);
  const desired=off;
  const softMax=off+step*.55;
  const sampleEvery=Math.max(60,step*.55);
  let sumExcess=0,maxGap=0,count=0,far=0;
  for(const s of segs){
    const len=Math.hypot(s.x2-s.x1,s.y2-s.y1);
    const n=Math.max(1,Math.ceil(len/sampleEvery));
    for(let i=0;i<=n;i++){
      const t=i/n;
      const p={x:s.x1+(s.x2-s.x1)*t,y:s.y1+(s.y2-s.y1)*t};
      const d=pointPolylineDistV14(p,core);
      if(!Number.isFinite(d))continue;
      maxGap=Math.max(maxGap,d);count++;
      const excess=Math.max(0,d-softMax);
      if(excess>0){sumExcess+=excess;far++;}
      // Слишком близко к стене тоже нежелательно, но штраф мягкий: подводы к коллектору сюда не входят.
      if(d<desired*.45)sumExcess+=(desired*.45-d)*.35;
    }
  }
  return {maxGap,farFraction:count?far/count:0,penalty:sumExcess,count};
}

function firstNonzeroSegmentV14(route,fromStart=true){
  if(!route||route.length<2)return null;
  if(fromStart){
    for(let i=1;i<route.length;i++)if(dist(route[i-1],route[i])>2)return [route[i-1],route[i]];
  }else{
    for(let i=route.length-1;i>0;i--)if(dist(route[i],route[i-1])>2)return [route[i-1],route[i]];
  }
  return null;
}

function segmentParallelToWallV14(a,b,side){
  const horizontal=nearly(a.y,b.y,1);
  return (side==='top'||side==='bottom')?horizontal:!horizontal;
}

function portDirectionPenaltyV14(route,ports){
  let p=0;
  const first=firstNonzeroSegmentV14(route,true), last=firstNonzeroSegmentV14(route,false);
  if(first&&segmentParallelToWallV14(first[0],first[1],ports.supplySide) && dist(first[0],first[1])>(state.pipeStepMm||150)*.35)p+=7000;
  if(last&&segmentParallelToWallV14(last[0],last[1],ports.returnSide) && dist(last[0],last[1])>(state.pipeStepMm||150)*.35)p+=7000;
  return p;
}

function routeCrowdingV14(points){
  const step=Math.max(50,Number(state.pipeStepMm)||150);
  const diameter=Math.max(8,Number(state.pipeDiameterMm)||16);
  const minSep=Math.max(diameter*1.2,step*.36);
  let bad=0,min=Infinity;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],h1=nearly(a.y,b.y,1);
    for(let j=i+2;j<points.length-1;j++){
      const c=points[j],d=points[j+1],h2=nearly(c.y,d.y,1);
      if(h1!==h2)continue;
      let overlap=0,sep=Infinity;
      if(h1){
        overlap=Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)));
        sep=Math.abs(a.y-c.y);
      }else{
        overlap=Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)));
        sep=Math.abs(a.x-c.x);
      }
      if(overlap>step*.8){min=Math.min(min,sep);if(sep>3&&sep<minSep)bad++;}
    }
  }
  return {bad,minSep:Number.isFinite(min)?min:null};
}

function connectorQualityV14(route,core,ports){
  const connectorLen=Math.max(0,routeLength(route)-routeLength(core));
  const step=Math.max(50,Number(state.pipeStepMm)||150);
  const expectedLead=Math.max(step*1.2,(Number(state.wallOffsetMm)||100)*2.2);
  const excess=Math.max(0,connectorLen-expectedLead);
  return {connectorLen,penalty:excess*3.2+portDirectionPenaltyV14(route,ports)};
}

// Подводы выбираем не просто по минимальной длине: сначала труба должна уйти от стены
// внутрь помещения, а не ехать вдоль периметра. Затем минимизируем длину подвода.
function attachComplexPortsV14(core,ports){
  if(!core?.length||!ports)return null;
  const start=core[0],end=core[core.length-1];
  const supplyOpts=connectorVariantsV12(ports.supply,start,ports.supplySide);
  const returnOpts=connectorVariantsV12(ports.ret,end,ports.returnSide).map(x=>[...x].reverse());
  const candidates=[];
  for(const lead of supplyOpts){
    for(const tail of returnOpts){
      const route=cleanPolyline([...lead,...core.slice(1),...tail.slice(1)]);
      if(!validRoute(route))continue;
      const q=connectorQualityV14(route,core,ports);
      const crowd=routeCrowdingV14(route);
      candidates.push({route,score:q.penalty+routeLength(route)+crowd.bad*6000});
    }
  }
  if(candidates.length){candidates.sort((a,b)=>a.score-b.score);return candidates[0].route;}

  // Резервный поиск пути остаётся, но и его результат проходит более строгую проверку дублей.
  const lead=routedConnectorV12(ports.supply,start,ports.supplySide,[core]);
  if(lead){
    const tailFromPort=routedConnectorV12(ports.ret,end,ports.returnSide,[core,lead]);
    if(tailFromPort){
      const tail=[...tailFromPort].reverse();
      const route=cleanPolyline([...lead,...core.slice(1),...tail.slice(1)]);
      if(validRoute(route))return route;
    }
  }
  const tailFirst=routedConnectorV12(ports.ret,end,ports.returnSide,[core]);
  if(tailFirst){
    const leadSecond=routedConnectorV12(ports.supply,start,ports.supplySide,[core,tailFirst]);
    if(leadSecond){
      const route=cleanPolyline([...leadSecond,...core.slice(1),...[...tailFirst].reverse().slice(1)]);
      if(validRoute(route))return route;
    }
  }
  return null;
}
attachComplexPortsV12=attachComplexPortsV14;

// Переранжируем зональные варианты: 1) реальный отступ от стен, 2) отсутствие дублей,
// 3) короткий подвод от коллектора, 4) только затем небольшая разница длины.
generateZonedComplexRoutesV13=function generateZonedComplexRoutesV14(limit=8){
  const ports=routePorts();
  if(!ports)return[];
  const cores=buildZoneSweepCoresV12();
  const candidates=[];
  const off=Math.max(0,Number(state.wallOffsetMm)||0),step=Math.max(50,Number(state.pipeStepMm)||150);
  for(const c of cores){
    const route=attachComplexPortsV12(c.core,ports);
    if(!route||!validRoute(route)||routeHasRetraceV14(route))continue;
    const boundary=boundaryCoverageV14(c.core);
    const connector=connectorQualityV14(route,c.core,ports);
    const crowd=routeCrowdingV14(route);
    const d=physicalDiagnosticsV10(route,'zoned-snake');
    const extraInset=Math.max(0,(c.inset||off)-off);
    // Сильный приоритет исходному отступу и нулевой фазе. Смещённую сетку используем только
    // если она действительно нужна для непрерывности.
    const phasePenalty=Math.abs(c.phase||0)*16;
    const insetPenalty=extraInset*28;
    const wallPenalty=boundary.penalty*18 + Math.max(0,boundary.maxGap-(off+step*.9))*20;
    const crowdPenalty=crowd.bad*7000;
    const bendPenalty=d.bendOK?0:1800;
    const score=routeLength(route)+c.penalty*4+phasePenalty+insetPenalty+wallPenalty+connector.penalty+crowdPenalty+bendPenalty+(d.lengthOK?0:100000);
    candidates.push({route,core:c.core,zones:c.zones,axis:c.axis,phase:c.phase,inset:c.inset,score,diagnostics:d,boundary,connector,crowd});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const out=[],seen=[];
  for(const c of candidates){
    // Не показываем явно плохой край: если более четверти внешней границы дальше
    // чем целевой отступ + ~полшага, это визуально и монтажно уже сомнительно.
    if(c.boundary.farFraction>.28 && c.boundary.maxGap>off+step*1.15)continue;
    if(seen.some(x=>x.axis===c.axis&&Math.abs(x.len-routeLength(c.route))<180&&Math.abs((x.gap||0)-c.boundary.maxGap)<45))continue;
    seen.push({axis:c.axis,len:routeLength(c.route),gap:c.boundary.maxGap});out.push(c);
    if(out.length>=limit)break;
  }
  return out;
};

// Версия v0.14 выводит пользователю только лучшие варианты на каждое направление,
// а в статусе подчёркивает, что отступ от стены тоже проверен.
const createRouteCandidatesV13BaseV14=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV14(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect)return createRouteCandidatesV13BaseV14();

  const out=[];state.rejectedRouteReasons=[];
  const info=complexObstacleSummaryV13();
  const zoned=generateZonedComplexRoutesV13(8);
  const perAxis={horizontal:0,vertical:0};
  for(const z of zoned){
    const n=perAxis[z.axis]++;
    if(n>0)continue;
    const badge=info.count?(info.interior?'обход препятствий':'обход препятствия у стены'):'сложная форма';
    const c=physicalCandidateV10(`zoned-${z.axis}-${n}`,complexCandidateNameV13(z.axis,n),
      'Приоритет: равномерный отступ от стен, без повторного прохода по той же линии и без длинного подвода вдоль периметра.',z.route,badge);
    if(c){c.zones=z.zones;c.axis=z.axis;c.boundary=z.boundary;c.connector=z.connector;c.crowd=z.crowd;out.push(c);}
  }
  if(!out.length){
    const fallback=generateComplexRoute();
    if(fallback?.route&&validRoute(fallback.route)&&!routeHasRetraceV14(fallback.route)){
      const c=physicalCandidateV10('shape-graph','Маршрут с обходом','Резервный маршрут по свободной сетке помещения.',fallback.route,'обход');
      if(c)out.push(c);
    }
  }
  if(!out.length){
    if(info.interior)state.rejectedRouteReasons.push('Для внутреннего препятствия пока не найден маршрут с нормальным отступом от стен без наложения трубы');
    else if(info.count)state.rejectedRouteReasons.push('Не найден аккуратный непрерывный маршрут вокруг препятствия с текущим шагом и отступом');
    else state.rejectedRouteReasons.push('Не найден аккуратный маршрут: варианты с наложением трубы или слишком большим поясом у стены скрыты');
  }
  out.sort((a,b)=>{
    const ar=a.diagnostics?.bendOK?0:1,br=b.diagnostics?.bendOK?0:1;
    return ar-br || (a.boundary?.maxGap||0)-(b.boundary?.maxGap||0) || a.length-b.length;
  });
  return out;
};

const simpleCandidateStatusV13BaseV14=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV14(c){
  if(c&&String(c.id||'').startsWith('zoned-')){
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(!d.bendOK)return{cls:'warn',text:'Маршрут аккуратный, но часть разворотов ещё слишком тесная'};
    return{cls:'ok',text:'✓ Без наложений, с контролем отступа от стен'};
  }
  return simpleCandidateStatusV13BaseV14(c);
};

if($('routeSheetHelp'))$('routeSheetHelp').textContent='Для сложной комнаты приложение теперь отбрасывает варианты, где труба повторно идёт по той же линии, оставляет большой необогреваемый пояс у стены или слишком долго тянется вдоль периметра до рабочей зоны.';

// ===== v0.15: точный отступ от стен/препятствий и нормальный выход от коллектора =====
// 1) Препятствие рассматривается как реальная граница рабочей зоны, а не как набор ячеек.
// 2) Концы проходов вычисляются по фактической границе с заданным wallOffset, а не округляются
//    до ближайшего шага трубы. Это убирает лишнюю пустую полосу перед препятствием.
// 3) После коллектора первый участок обязан уходить внутрь перпендикулярно стене. Длинный ход
//    параллельно стене в зоне отступа запрещён.

function pointInsideInflatedObstacleV15(x,y,pad=0){
  const eps=.5;
  for(const o of state.obstacles||[]){
    if(x>o.x-pad+eps && x<o.x+o.width+pad-eps && y>o.y-pad+eps && y<o.y+o.height+pad-eps) return true;
  }
  return false;
}

function pointAllowedAtInsetV15(x,y,inset){
  if(!insideRoom(x,y,true)) return false;
  const d=Math.max(0,Number(inset)||0);
  if(pointInsideInflatedObstacleV15(x,y,d)) return false;
  // legacy excluded cells that are not represented by editable obstacles
  if(pointExcluded(x,y) && !(state.obstacles||[]).some(o=>x>=o.x&&x<=o.x+o.width&&y>=o.y&&y<=o.y+o.height)) return false;
  if(!d) return true;
  // Для ортогональной комнаты проверяем не только четыре стороны, но и диагонали —
  // это не даёт центру трубы срезать вогнутый угол.
  const q=d*.995;
  const probes=[[q,0],[-q,0],[0,q],[0,-q],[q,q],[q,-q],[-q,q],[-q,-q]];
  for(const [dx,dy] of probes){
    const px=x+dx,py=y+dy;
    if(!insideRoom(px,py,true) || pointInsideInflatedObstacleV15(px,py,0)) return false;
  }
  return true;
}
pointAllowedAtInsetV12=pointAllowedAtInsetV15;

function uniqueNumsV15(arr,eps=.5){
  const s=[...arr].filter(Number.isFinite).sort((a,b)=>a-b),out=[];
  for(const v of s) if(!out.length||Math.abs(v-out[out.length-1])>eps) out.push(v);
  return out;
}

function axisBreaksV15(axis,inset){
  const b=state.bounds,d=Math.max(0,inset),vals=[];
  const add=v=>{if(Number.isFinite(v)) vals.push(v);};
  if(axis==='x'){add(b.minX);add(b.maxX);add(b.minX+d);add(b.maxX-d);} else {add(b.minY);add(b.maxY);add(b.minY+d);add(b.maxY-d);}
  for(const r of state.sections||[]){
    const lo=axis==='x'?r.x:r.y, hi=axis==='x'?r.x+r.width:r.y+r.height;
    for(const e of [lo,hi]){add(e-d);add(e);add(e+d);}
  }
  for(const o of state.obstacles||[]){
    const lo=axis==='x'?o.x:o.y, hi=axis==='x'?o.x+o.width:o.y+o.height;
    add(lo-d);add(lo);add(hi);add(hi+d);
  }
  // custom 10cm room edits are rare now, but include their edges as breakpoints.
  for(const k of [...(state.roomAdded||[]),...(state.roomRemoved||[])]){
    const r=shapeCellRectFromKey(k),lo=axis==='x'?r.x:r.y,hi=axis==='x'?r.x+r.width:r.y+r.height;
    for(const e of [lo,hi]){add(e-d);add(e);add(e+d);}
  }
  const lo=axis==='x'?b.minX:b.minY,hi=axis==='x'?b.maxX:b.maxY;
  return uniqueNumsV15(vals.map(v=>clamp(v,lo,hi)));
}

function allowedIntervalsAtV15(axis,coord,inset){
  const breaks=axisBreaksV15(axis,inset),out=[];
  for(let i=1;i<breaks.length;i++){
    const a=breaks[i-1],z=breaks[i];
    if(z-a<1) continue;
    const m=(a+z)/2;
    const ok=axis==='x'?pointAllowedAtInsetV15(m,coord,inset):pointAllowedAtInsetV15(coord,m,inset);
    if(!ok) continue;
    if(out.length && a-out[out.length-1][1]<1.5) out[out.length-1][1]=z;
    else out.push([a,z]);
  }
  return out;
}

function balancedPositionsV15(min,max,step,phase=0){
  if(max<min-1)return[];
  const span=max-min;
  if(span<1)return[(min+max)/2];
  if(Math.abs(phase)<1){
    let best=null;
    for(const n of [Math.max(2,Math.floor(span/step)+1),Math.max(2,Math.round(span/step)+1),Math.max(2,Math.ceil(span/step)+1)]){
      const spacing=span/(n-1);
      if(spacing<step*.72||spacing>step*1.28)continue;
      const p=Math.abs(spacing-step);
      if(!best||p<best.p)best={n,spacing,p};
    }
    if(best)return Array.from({length:best.n},(_,i)=>min+i*best.spacing);
  }
  const out=[];let v=min+phase;
  while(v<=max+.01){out.push(v);v+=step;}
  if(out.length && max-out[out.length-1]>step*.72)out.push(max);
  return out;
}

buildSweepProfilesV12=function buildSweepProfilesV15(axis,phase=0,extraInset=0){
  const b=state.bounds;
  const off=Math.max(0,Number(state.wallOffsetMm)||0)+Math.max(0,extraInset);
  const step=Math.max(40,Number(state.pipeStepMm)||150);
  const coords=axis==='horizontal'
    ?balancedPositionsV15(b.minY+off,b.maxY-off,step,phase)
    :balancedPositionsV15(b.minX+off,b.maxX-off,step,phase);
  if(!coords.length)return null;
  const ports=routePorts();
  const corridorMatches=!!ports&&((axis==='vertical'&&(ports.supplySide==='top'||ports.supplySide==='bottom'))||(axis==='horizontal'&&(ports.supplySide==='left'||ports.supplySide==='right')));
  const corridorCoord=corridorMatches?(axis==='vertical'?ports.supply.x:ports.supply.y):null;
  const corridorHalf=Math.max((Number(state.pipeDiameterMm)||16)*2.2,step*.52);
  const farSide=!corridorMatches?null:(ports.supplySide==='bottom'||ports.supplySide==='right'?0:1);
  const lanes=[];
  for(const coord of coords){
    if(corridorMatches&&Math.abs(coord-corridorCoord)<corridorHalf)continue;
    const intervals=allowedIntervalsAtV15(axis==='horizontal'?'x':'y',coord,off);
    if(!intervals.length)continue;
    // Внутренний остров всё ещё требует отдельного алгоритма разветвления. Краевое препятствие
    // даёт ровно один свободный интервал и обрабатывается здесь точно.
    if(intervals.length!==1)return null;
    const [low,high]=intervals[0];
    if(high-low<Math.max(step*.35,(state.pipeDiameterMm||16)*3))continue;
    lanes.push({coord,low,high,naturalCount:Math.max(1,Math.round((high-low)/step)+1)});
  }
  if(lanes.length<2)return null;

  let groups=[];
  for(const lane of lanes){
    const g=groups[groups.length-1];
    const coordGap=g?Math.abs(lane.coord-g.coords[g.coords.length-1]):0;
    const sameProfile=!!g&&nearly(g.low,lane.low,1.5)&&nearly(g.high,lane.high,1.5);
    if(!g||!sameProfile||coordGap>step*1.55)groups.push({low:lane.low,high:lane.high,coords:[lane.coord],gapBefore:!!g&&sameProfile&&coordGap>step*1.55});
    else g.coords.push(lane.coord);
  }
  let changed=true;
  while(changed&&groups.length>2){
    changed=false;
    for(let i=1;i<groups.length-1;i++){
      const g=groups[i];if(g.coords.length>1)continue;
      if(sharedProfileSidesV12(groups[i-1],groups[i+1]).length){groups=[...groups.slice(0,i),...groups.slice(i+1)];changed=true;break;}
    }
  }
  return{axis,groups,step,inset:off,corridorSide:farSide};
};

function inwardVectorV15(side){
  if(side==='left')return{x:1,y:0};if(side==='right')return{x:-1,y:0};if(side==='top')return{x:0,y:1};return{x:0,y:-1};
}
function sideWallCoordinateV15(side){
  const b=state.bounds;return side==='left'?b.minX:side==='right'?b.maxX:side==='top'?b.minY:b.maxY;
}
function distanceToCollectorWallV15(p,side){
  const w=sideWallCoordinateV15(side);return(side==='left'||side==='right')?Math.abs(p.x-w):Math.abs(p.y-w);
}
function connectorHugsWallV15(poly,side){
  if(!poly||poly.length<3)return false;
  const off=Math.max(0,Number(state.wallOffsetMm)||0),step=Math.max(50,Number(state.pipeStepMm)||150);
  let parallelNear=0;
  // segment 0 is the intentional perpendicular exit from the collector.
  for(let i=2;i<poly.length;i++){
    const a=poly[i-1],b=poly[i],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    if(!segmentParallelToWallV14(a,b,side))continue;
    if(distanceToCollectorWallV15(mid,side)<=off+step*.48)parallelNear+=dist(a,b);
  }
  return parallelNear>step*1.15;
}

connectorVariantsV12=function connectorVariantsV15(port,target,side){
  const out=[],off=Math.max(35,Number(state.wallOffsetMm)||100),step=Math.max(50,Number(state.pipeStepMm)||150),v=inwardVectorV15(side);
  const inner={x:port.x+v.x*off,y:port.y+v.y*off};
  const deep={x:port.x+v.x*(off+step*.95),y:port.y+v.y*(off+step*.95)};
  const add=pts=>{const c=cleanPolyline(pts);if(c.length>=2&&!connectorHugsWallV15(c,side))out.push(c);};
  if(pointAllowedAtInsetV15(inner.x,inner.y,off)){
    if(nearly(inner.x,target.x,1)||nearly(inner.y,target.y,1))add([port,inner,target]);
    add([port,inner,{x:target.x,y:inner.y},target]);
    add([port,inner,{x:inner.x,y:target.y},target]);
  }
  if(pointAllowedAtInsetV15(deep.x,deep.y,off)){
    if(nearly(deep.x,target.x,1)||nearly(deep.y,target.y,1))add([port,inner,deep,target]);
    add([port,inner,deep,{x:target.x,y:deep.y},target]);
    add([port,inner,deep,{x:deep.x,y:target.y},target]);
  }
  return out;
};

function exposedObstacleBoundarySegmentsV15(){
  const out=[],eps=6;
  for(const o of state.obstacles||[]){
    const defs=[
      {x1:o.x,y1:o.y,x2:o.x+o.width,y2:o.y,nx:0,ny:-1},
      {x1:o.x,y1:o.y+o.height,x2:o.x+o.width,y2:o.y+o.height,nx:0,ny:1},
      {x1:o.x,y1:o.y,x2:o.x,y2:o.y+o.height,nx:-1,ny:0},
      {x1:o.x+o.width,y1:o.y,x2:o.x+o.width,y2:o.y+o.height,nx:1,ny:0},
    ];
    for(const s of defs){
      const mx=(s.x1+s.x2)/2+s.nx*eps,my=(s.y1+s.y2)/2+s.ny*eps;
      if(insideRoom(mx,my,true)&&!pointInsideInflatedObstacleV15(mx,my,0))out.push(s);
    }
  }
  return out;
}

function boundaryCoverageV15(core){
  const segs=[...computeOuterBoundarySegments(),...exposedObstacleBoundarySegmentsV15()];
  const step=Math.max(50,Number(state.pipeStepMm)||150),off=Math.max(0,Number(state.wallOffsetMm)||0),softMax=off+step*.45,sampleEvery=Math.max(50,step*.45);
  let sumExcess=0,maxGap=0,count=0,far=0;
  for(const s of segs){
    const len=Math.hypot(s.x2-s.x1,s.y2-s.y1),n=Math.max(1,Math.ceil(len/sampleEvery));
    for(let i=0;i<=n;i++){
      const t=i/n,p={x:s.x1+(s.x2-s.x1)*t,y:s.y1+(s.y2-s.y1)*t};
      const d=pointPolylineDistV14(p,core);if(!Number.isFinite(d))continue;
      maxGap=Math.max(maxGap,d);count++;
      const excess=Math.max(0,d-softMax);if(excess>0){sumExcess+=excess;far++;}
      if(d<off*.60)sumExcess+=(off*.60-d)*1.5;
    }
  }
  return{maxGap,farFraction:count?far/count:0,penalty:sumExcess,count};
}
boundaryCoverageV14=boundaryCoverageV15;

function leadLeavesWallNormallyV15(poly,side){
  if(!poly||poly.length<2)return false;
  const a=poly[0],b=poly[1],v=inwardVectorV15(side),dx=b.x-a.x,dy=b.y-a.y;
  const along=dx*v.x+dy*v.y,sideways=Math.abs(dx*v.y-dy*v.x);
  return along>Math.max(20,(Number(state.wallOffsetMm)||100)*.55)&&sideways<8;
}

attachComplexPortsV12=function attachComplexPortsV15(core,ports){
  if(!core?.length||!ports)return null;
  const start=core[0],end=core[core.length-1],supplyOpts=connectorVariantsV12(ports.supply,start,ports.supplySide),returnOpts=connectorVariantsV12(ports.ret,end,ports.returnSide).map(x=>[...x].reverse()),candidates=[];
  for(const lead of supplyOpts){
    if(!leadLeavesWallNormallyV15(lead,ports.supplySide)||connectorHugsWallV15(lead,ports.supplySide))continue;
    for(const tail of returnOpts){
      const tailPort=[...tail].reverse();
      if(!leadLeavesWallNormallyV15(tailPort,ports.returnSide)||connectorHugsWallV15(tailPort,ports.returnSide))continue;
      const route=cleanPolyline([...lead,...core.slice(1),...tail.slice(1)]);
      if(!validRoute(route)||routeHasRetraceV14(route))continue;
      const q=connectorQualityV14(route,core,ports),crowd=routeCrowdingV14(route);
      candidates.push({route,score:q.penalty+routeLength(route)+crowd.bad*9000});
    }
  }
  if(candidates.length){candidates.sort((a,b)=>a.score-b.score);return candidates[0].route;}

  // Fallback graph path is accepted only if it obeys the same collector rule.
  const tryFallback=(firstReturn=false)=>{
    if(!firstReturn){
      const lead=routedConnectorV12(ports.supply,start,ports.supplySide,[core]);if(!lead||connectorHugsWallV15(lead,ports.supplySide)||!leadLeavesWallNormallyV15(lead,ports.supplySide))return null;
      const t=routedConnectorV12(ports.ret,end,ports.returnSide,[core,lead]);if(!t)return null;
      const tail=[...t].reverse(),tailPort=[...tail].reverse();if(connectorHugsWallV15(tailPort,ports.returnSide)||!leadLeavesWallNormallyV15(tailPort,ports.returnSide))return null;
      const route=cleanPolyline([...lead,...core.slice(1),...tail.slice(1)]);return validRoute(route)&&!routeHasRetraceV14(route)?route:null;
    }
    return null;
  };
  return tryFallback(false);
};

// Re-run ranking with the new exact geometry. A candidate that leaves an excessive band at an
// exposed obstacle edge is no longer considered "good enough".
generateZonedComplexRoutesV13=function generateZonedComplexRoutesV15(limit=8){
  const ports=routePorts();if(!ports)return[];
  const cores=buildZoneSweepCoresV12(),candidates=[];
  const off=Math.max(0,Number(state.wallOffsetMm)||0),step=Math.max(50,Number(state.pipeStepMm)||150);
  for(const c of cores){
    const route=attachComplexPortsV12(c.core,ports);if(!route||!validRoute(route)||routeHasRetraceV14(route))continue;
    const boundary=boundaryCoverageV14(c.core),connector=connectorQualityV14(route,c.core,ports),crowd=routeCrowdingV14(route),d=physicalDiagnosticsV10(route,'zoned-snake');
    const extraInset=Math.max(0,(c.inset||off)-off),phasePenalty=Math.abs(c.phase||0)*20,insetPenalty=extraInset*36;
    const wallPenalty=boundary.penalty*26+Math.max(0,boundary.maxGap-(off+step*.70))*32,crowdPenalty=crowd.bad*9000,bendPenalty=d.bendOK?0:1800;
    const score=routeLength(route)+c.penalty*4+phasePenalty+insetPenalty+wallPenalty+connector.penalty+crowdPenalty+bendPenalty+(d.lengthOK?0:100000);
    candidates.push({route,core:c.core,zones:c.zones,axis:c.axis,phase:c.phase,inset:c.inset,score,diagnostics:d,boundary,connector,crowd});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const out=[],seen=[];
  for(const c of candidates){
    if(c.boundary.farFraction>.22&&c.boundary.maxGap>off+step*.95)continue;
    if(seen.some(x=>x.axis===c.axis&&Math.abs(x.len-routeLength(c.route))<160&&Math.abs((x.gap||0)-c.boundary.maxGap)<35))continue;
    seen.push({axis:c.axis,len:routeLength(c.route),gap:c.boundary.maxGap});out.push(c);if(out.length>=limit)break;
  }
  return out;
};

if($('routeSheetHelp'))$('routeSheetHelp').textContent='Для сложной комнаты крайние проходы теперь привязаны к фактическим стенам и препятствиям: заданный отступ выдерживается без округления к шагу трубы. От коллектора трасса сначала уходит внутрь помещения, а длинный ход вдоль стены отбрасывается.';

// ===== v0.16: внутренние препятствия — непрерывная змейка по разрезанным проходам =====
// Каждый поперечный проход может состоять из нескольких свободных интервалов.
// Вместо отказа строим граф интервалов соседних рядов и ищем непрерывный путь,
// который проходит каждый интервал ровно один раз. Это позволяет обходить
// прямоугольные «островные» препятствия с обеих сторон без наложения трубы.

function intervalSweepSegmentsV16(axis, phase=0, extraInset=0){
  const b=state.bounds, off=Math.max(0,Number(state.wallOffsetMm)||0)+Math.max(0,extraInset);
  const step=Math.max(50,Number(state.pipeStepMm)||150);
  const lo=axis==='horizontal'?b.minY+off:b.minX+off;
  const hi=axis==='horizontal'?b.maxY-off:b.maxX-off;
  const coords=balancedPositionsV15(lo,hi,step,phase);
  if(!coords.length)return null;
  const lanes=[]; let sid=0;
  for(let li=0;li<coords.length;li++){
    const coord=coords[li];
    const ints=allowedIntervalsAtV15(axis==='horizontal'?'x':'y',coord,off)
      .filter(([a,z])=>z-a>=Math.max(step*.34,(Number(state.pipeDiameterMm)||16)*3));
    if(!ints.length){lanes.push({coord,segments:[]});continue;}
    const segments=ints.map(([low,high],ii)=>({id:sid++,lane:li,index:ii,coord,low,high,axis}));
    lanes.push({coord,segments});
  }
  const segments=lanes.flatMap(l=>l.segments);
  return segments.length>=2?{axis,lanes,segments,step,inset:off,phase}:null;
}

function segEndsV16(s,orientation){
  const a=s.axis==='horizontal'?{x:s.low,y:s.coord}:{x:s.coord,y:s.low};
  const b=s.axis==='horizontal'?{x:s.high,y:s.coord}:{x:s.coord,y:s.high};
  return orientation?{start:b,end:a}:{start:a,end:b};
}

function intervalConnectorV16(a,oa,b,ob,inset){
  const laneGap=Math.abs(a.lane-b.lane); if(laneGap<1||laneGap>2)return null;
  const A=segEndsV16(a,oa),B=segEndsV16(b,ob),p=A.end,q=B.start;
  const safePoly=pts=>{
    const c=cleanPolyline(pts);
    if(c.length<2)return null;
    for(let i=1;i<c.length;i++)if(!coreSegmentSafeV12(c[i-1],c[i],inset))return null;
    return c;
  };
  // Обычный U-переход: одинаковая граница соседних проходов.
  if(a.axis==='horizontal' && Math.abs(p.x-q.x)<=2.5){const c=safePoly([p,q]);if(c)return c;}
  if(a.axis==='vertical' && Math.abs(p.y-q.y)<=2.5){const c=safePoly([p,q]);if(c)return c;}
  // На входе в ножку T-комнаты или при расщеплении вокруг препятствия граница
  // может сместиться. Смещаемся в свободном коридоре МЕЖДУ рядами, а не вдоль
  // уже уложенной трубы. Несколько положений нужны, если середина попала в угол.
  for(const f of [.5,.32,.68,.18,.82]){
    let pts;
    if(a.axis==='horizontal'){
      const y=p.y+(q.y-p.y)*f;
      pts=[p,{x:p.x,y},{x:q.x,y},q];
    }else{
      const x=p.x+(q.x-p.x)*f;
      pts=[p,{x,y:p.y},{x,y:q.y},q];
    }
    const c=safePoly(pts);if(c)return c;
  }
  return null;
}

function buildIntervalTransitionsV16(model){
  const n=model.segments.length, trans=Array.from({length:n*2},()=>[]);
  for(let i=0;i<n;i++)for(let oi=0;oi<2;oi++){
    for(let j=0;j<n;j++){
      if(i===j||Math.abs(model.segments[i].lane-model.segments[j].lane)!==1)continue;
      for(let oj=0;oj<2;oj++){
        const c=intervalConnectorV16(model.segments[i],oi,model.segments[j],oj,model.inset);
        if(c)trans[i*2+oi].push({j,oj,connector:c});
      }
    }
  }
  return trans;
}

function endpointWallDistanceV16(p){
  const ports=routePorts(); if(!ports)return 1e9;
  return Math.min(dist(p,ports.supply),dist(p,ports.ret));
}

function intervalHamiltonianRouteV16(model, budget=90000){
  const n=model.segments.length;
  if(n<2||n>64)return null;
  const trans=buildIntervalTransitionsV16(model),ports=routePorts(); if(!ports)return null;
  const conn=new Map();
  for(let i=0;i<n;i++)for(let o=0;o<2;o++)for(const t of trans[i*2+o])conn.set(`${i}:${o}:${t.j}:${t.oj}`,t.connector);
  const adj=Array.from({length:n},()=>new Set());
  for(let i=0;i<n;i++)for(let o=0;o<2;o++)for(const t of trans[i*2+o])adj[i].add(t.j);
  if(adj.some(x=>!x.size))return null;

  // Fast connectivity test. If the segment graph is disconnected no Hamiltonian path exists.
  {const seen=new Set([0]),q=[0];for(let k=0;k<q.length;k++)for(const j of adj[q[k]])if(!seen.has(j)){seen.add(j);q.push(j);}if(seen.size!==n)return null;}

  let steps=0,best=null;
  const collectorScore=i=>{
    const s=model.segments[i],a=segEndsV16(s,0),b=segEndsV16(s,1);
    return Math.min(endpointWallDistanceV16(a.start),endpointWallDistanceV16(b.start));
  };
  const starts=[...Array(n).keys()].sort((a,b)=>adj[a].size-adj[b].size||collectorScore(a)-collectorScore(b));

  function orientedCoreForOrder(order){
    // DP over only two orientations per segment.
    for(const firstO of [0,1]){
      let states=[{o:firstO,points:[segEndsV16(model.segments[order[0]],firstO).start,segEndsV16(model.segments[order[0]],firstO).end]}];
      for(let k=1;k<order.length && states.length;k++){
        const i=order[k-1],j=order[k],next=[];
        for(const st of states)for(const oj of [0,1]){
          const c=conn.get(`${i}:${st.o}:${j}:${oj}`);if(!c)continue;
          const e=segEndsV16(model.segments[j],oj);
          next.push({o:oj,points:cleanPolyline([...st.points,...c.slice(1),e.end])});
        }
        // At most two genuinely different orientation states are useful.
        states=next.slice(0,4);
      }
      for(const st of states){
        const core=cleanPolyline(st.points);
        if(core.length<4||!validRoute(core)||routeHasRetraceV14(core))continue;
        const route=attachComplexPortsV12(core,ports);
        if(!route||!validRoute(route)||routeHasRetraceV14(route))continue;
        const crowd=routeCrowdingV14(route);if(crowd.bad>0)continue;
        return {route,core};
      }
    }
    return null;
  }

  function residualConnected(current,visited){
    let seed=-1,count=0;
    for(let i=0;i<n;i++)if(!visited[i]){if(seed<0)seed=i;count++;}
    if(count<=1)return true;
    const seen=new Set([seed]),q=[seed];
    for(let k=0;k<q.length;k++)for(const j of adj[q[k]])if((!visited[j]||j===current)&&!seen.has(j)){seen.add(j);q.push(j);}
    let got=0;for(const i of seen)if(!visited[i])got++;
    return got===count;
  }

  const visited=new Uint8Array(n),order=[];
  function dfs(cur,depth){
    if(++steps>budget)return false;
    if(depth===n){const solved=orientedCoreForOrder(order);if(solved){best=solved;return true;}return false;}
    let opts=[...adj[cur]].filter(j=>!visited[j]);
    opts=opts.map(j=>{
      let onward=0;for(const q of adj[j])if(!visited[q])onward++;
      return{j,onward,deg:adj[j].size,finish:collectorScore(j)};
    }).sort((a,b)=>a.onward-b.onward||a.deg-b.deg||(depth>n*.7?a.finish-b.finish:0));
    for(const x of opts){
      const j=x.j;visited[j]=1;order.push(j);
      // Degree pruning: an unvisited vertex may not become isolated before the end.
      let dead=false;
      if(depth<n-1){for(let u=0;u<n;u++)if(!visited[u]){let avail=0;for(const v of adj[u])if(!visited[v]||v===j)avail++;if(!avail){dead=true;break;}}}
      if(!dead && (depth%5!==0||residualConnected(j,visited)) && dfs(j,depth+1))return true;
      order.pop();visited[j]=0;
      if(steps>budget)return false;
    }
    return false;
  }

  const maxStarts=Math.min(n,24);
  for(let k=0;k<maxStarts&&steps<=budget;k++){
    const s=starts[k];visited.fill(0);order.length=0;visited[s]=1;order.push(s);
    if(dfs(s,1))break;
  }
  return best;
}


function deterministicDoubleSweepV16(model){
  // Fast path for a profile that has one free interval per row/column. It uses
  // even rows on the outward pass and odd rows on the return pass, so both ends
  // remain near the same side of the room instead of requiring a long return
  // line along a wall.
  if(!model||model.lanes.some(l=>l.segments.length!==1))return null;
  const segs=model.lanes.map(l=>l.segments[0]);
  const ports=routePorts();if(!ports||segs.length<4)return null;
  const candidates=[];
  for(const rev of [false,true]){
    const order=sequenceEvenOdd(segs,rev);
    for(const firstO of [0,1]){
      const walk=(k,o,pts)=>{
        if(k===order.length){
          const core=cleanPolyline(pts);if(!validRoute(core)||routeHasRetraceV14(core))return;
          const route=attachComplexPortsV12(core,ports);if(!route||!validRoute(route)||routeHasRetraceV14(route))return;
          const crowd=routeCrowdingV14(route);if(crowd.bad)return;
          candidates.push({route,core,score:routeLength(route)+crowd.bad*10000});return;
        }
        const prev=order[k-1],cur=order[k];
        for(const no of [0,1]){
          const c=intervalConnectorV16(prev,o,cur,no,model.inset);if(!c)continue;
          const e=segEndsV16(cur,no),next=cleanPolyline([...pts,...c.slice(1),e.end]);
          if(!validRoute(next)||routeHasRetraceV14(next))continue;
          walk(k+1,no,next);
        }
      };
      const e=segEndsV16(order[0],firstO);walk(1,firstO,[e.start,e.end]);
    }
  }
  candidates.sort((a,b)=>a.score-b.score);return candidates[0]||null;
}

function generateIslandObstacleRoutesV16(limit=4){
  const out=[],step=Math.max(50,Number(state.pipeStepMm)||150);
  for(const axis of ['vertical','horizontal']){
    for(const phase of [0,step*.25,step*.5,step*.75]){
      const model=intervalSweepSegmentsV16(axis,phase,0); if(!model)continue;
      const hasSplit=model.lanes.some(l=>l.segments.length>1);
      const solved=hasSplit?intervalHamiltonianRouteV16(model,70000):deterministicDoubleSweepV16(model);
      if(!solved)continue;
      const d=physicalDiagnosticsV10(solved.route,'island-snake');
      const boundary=boundaryCoverageV15(solved.core),crowd=routeCrowdingV14(solved.route);
      const score=routeLength(solved.route)+boundary.penalty*18+crowd.bad*10000+(d.bendOK?0:1800)+(d.lengthOK?0:100000);
      out.push({route:solved.route,core:solved.core,axis,phase,score,diagnostics:d,boundary,crowd});
    }
  }
  out.sort((a,b)=>a.score-b.score);
  const uniq=[];
  for(const c of out){
    if(uniq.some(x=>x.axis===c.axis&&Math.abs(routeLength(x.route)-routeLength(c.route))<180))continue;
    uniq.push(c); if(uniq.length>=limit)break;
  }
  return uniq;
}

const createRouteCandidatesV15BaseV16=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV16(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect)return createRouteCandidatesV15BaseV16();

  // First retain all routes that the exact zonal planner can already build.
  const base=createRouteCandidatesV15BaseV16()||[];
  const info=complexObstacleSummaryV13();
  if(!info.interior)return base;

  const islands=generateIslandObstacleRoutesV16(4),out=[...base];
  let n=0;
  for(const z of islands){
    const id=`island-${z.axis}-${n}`;
    const name=z.axis==='vertical'?'Змейка с обходом препятствий':'Поперечная змейка с обходом';
    const c=physicalCandidateV10(id,name,'Непрерывный маршрут огибает внутренние препятствия и заполняет свободные проходы.',z.route,'обход препятствий');
    if(c){c.axis=z.axis;c.diagnostics=z.diagnostics;c.boundary=z.boundary;out.push(c);n++;}
  }
  if(out.length){
    state.rejectedRouteReasons=(state.rejectedRouteReasons||[]).filter(x=>!String(x).includes('внутреннего препятствия')&&!String(x).includes('Внутреннее препятствие'));
    // prefer routes that really cover obstacle boundaries and have no tight spacing.
    out.sort((a,b)=>{
      const da=a.diagnostics||physicalDiagnosticsV10(a.route,a.id),db=b.diagnostics||physicalDiagnosticsV10(b.route,b.id);
      return (da.bendOK?0:1)-(db.bendOK?0:1) || routeLength(a.route)-routeLength(b.route);
    });
  }
  return out;
};

const simpleCandidateStatusV11BaseV16=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV16(c){
  if(c&&String(c.id||'').startsWith('island-')){
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(!d.bendOK)return{cls:'warn',text:'Препятствия обойдены; часть разворотов ещё требует увеличения радиуса'};
    return{cls:'ok',text:'✓ Внутренние препятствия обойдены одним непрерывным контуром'};
  }
  return simpleCandidateStatusV11BaseV16(c);
};

if($('routeSheetHelp'))$('routeSheetHelp').textContent='Внутреннее препятствие больше не должно останавливать построение: приложение разбивает каждый ряд на свободные участки и ищет один непрерывный путь вокруг препятствий. Если такой путь не существует при выбранном шаге и отступе, вариант не показывается.';

// ===== v0.16b: гибкие переходы между зонами разной ширины =====
// Старый зональный генератор требовал, чтобы соседние зоны имели совпадающий левый
// или правый край. Это слишком жёстко: у T-комнаты и препятствия у стены профиль
// часто сдвигается. Теперь переход делается в свободном промежутке между рядами.

function transitionBetweenGroupsV16(p,q,axis,inset){
  const safe=pts=>{const c=cleanPolyline(pts);for(let i=1;i<c.length;i++)if(!coreSegmentSafeV12(c[i-1],c[i],inset))return null;return c;};
  if(nearly(p.x,q.x,2)||nearly(p.y,q.y,2)){const c=safe([p,q]);if(c)return c;}
  for(const f of [.5,.3,.7,.15,.85]){
    const pts=axis==='horizontal'
      ?[p,{x:p.x,y:p.y+(q.y-p.y)*f},{x:q.x,y:p.y+(q.y-p.y)*f},q]
      :[p,{x:p.x+(q.x-p.x)*f,y:p.y},{x:p.x+(q.x-p.x)*f,y:q.y},q];
    const c=safe(pts);if(c)return c;
  }
  return null;
}

function groupCountChoicesV16(g,step){
  const natural=Math.max(1,g.coords.length),span=Math.abs(g.coords[g.coords.length-1]-g.coords[0]);
  const out=[];
  for(let n=Math.max(1,natural-2);n<=natural+2;n++){
    const spacing=n<=1?step:span/(n-1);
    if(n>1&&(spacing<step*.68||spacing>step*1.32))continue;
    out.push({n,penalty:Math.abs(spacing-step)+Math.abs(n-natural)*step*.12});
  }
  if(!out.length)out.push({n:natural,penalty:0});
  return out.sort((a,b)=>a.penalty-b.penalty);
}

function groupSnakeV16(g,axis,entrySide,n,inset){
  const coords=linspaceV12(g.coords[0],g.coords[g.coords.length-1],n),pts=[];let side=entrySide,endSide=entrySide;
  for(const q of coords){
    const a=axis==='horizontal'?{x:g.low,y:q}:{x:q,y:g.low};
    const b=axis==='horizontal'?{x:g.high,y:q}:{x:q,y:g.high};
    const st=side===0?a:b,en=side===0?b:a;
    if(pts.length){const c=transitionBetweenGroupsV16(pts[pts.length-1],st,axis,inset);if(!c)return null;pts.push(...c.slice(1));}
    else pts.push(st);
    pts.push(en);endSide=1-side;side=1-side;
  }
  return{points:cleanPolyline(pts),exitSide:endSide};
}

function flexibleProfileCoresV16(limit=24){
  const step=Math.max(50,Number(state.pipeStepMm)||150),phases=[0,step*.25,step*.5,step*.75],outs=[];
  for(const extra of [0,step*.25])for(const axis of ['horizontal','vertical'])for(const phase of phases){
    const prof=buildSweepProfilesV12(axis,phase,extra);if(!prof||!prof.groups?.length)continue;
    for(const rev of [false,true]){
      const gs=(rev?[...prof.groups].reverse():prof.groups).map(g=>({...g,coords:rev?[...g.coords].reverse():[...g.coords]}));
      let states=[];
      for(const entry of [0,1])for(const ch of groupCountChoicesV16(gs[0],step).slice(0,3)){
        const loc=groupSnakeV16(gs[0],axis,entry,ch.n,prof.inset);if(!loc)continue;
        states.push({points:loc.points,exitSide:loc.exitSide,penalty:ch.penalty});
      }
      for(let gi=1;gi<gs.length&&states.length;gi++){
        const next=[];
        for(const st of states)for(const entry of [0,1])for(const ch of groupCountChoicesV16(gs[gi],step).slice(0,3)){
          const loc=groupSnakeV16(gs[gi],axis,entry,ch.n,prof.inset);if(!loc)continue;
          const c=transitionBetweenGroupsV16(st.points[st.points.length-1],loc.points[0],axis,prof.inset);if(!c)continue;
          const pts=cleanPolyline([...st.points,...c.slice(1),...loc.points.slice(1)]);
          if(!validRoute(pts)||routeHasRetraceV14(pts))continue;
          next.push({points:pts,exitSide:loc.exitSide,penalty:st.penalty+ch.penalty+routeLength(c)*.02});
        }
        next.sort((a,b)=>a.penalty-b.penalty||routeLength(a.points)-routeLength(b.points));
        states=next.slice(0,10);
      }
      for(const st of states){
        if(st.points.length<4||!validRoute(st.points)||routeHasRetraceV14(st.points))continue;
        outs.push({core:st.points,axis,phase,inset:prof.inset,zones:gs.length,penalty:st.penalty});
      }
    }
  }
  outs.sort((a,b)=>a.penalty-b.penalty||routeLength(a.core)-routeLength(b.core));
  const uniq=[];
  for(const x of outs){const s=x.core[0],e=x.core[x.core.length-1];const k=`${x.axis}:${Math.round(s.x/20)},${Math.round(s.y/20)}:${Math.round(e.x/20)},${Math.round(e.y/20)}:${x.zones}`;if(uniq.some(u=>u.k===k))continue;uniq.push({...x,k});if(uniq.length>=limit)break;}
  return uniq;
}

function generateFlexibleComplexRoutesV16(limit=6){
  const ports=routePorts();if(!ports)return[];const out=[];
  for(const c of flexibleProfileCoresV16(30)){
    const route=attachComplexPortsV12(c.core,ports);if(!route||!validRoute(route)||routeHasRetraceV14(route))continue;
    const crowd=routeCrowdingV14(route);if(crowd.bad)continue;
    const boundary=boundaryCoverageV15(c.core),d=physicalDiagnosticsV10(route,'flex-zoned');
    const score=routeLength(route)+c.penalty*4+boundary.penalty*20+(d.bendOK?0:1500)+(d.lengthOK?0:100000);
    out.push({route,core:c.core,axis:c.axis,zones:c.zones,score,diagnostics:d,boundary});
  }
  out.sort((a,b)=>a.score-b.score);return out.slice(0,limit);
}

const createRouteCandidatesV16BaseFlex=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV16Flex(){
  const base=createRouteCandidatesV16BaseFlex()||[];
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect||base.length)return base;
  const flex=generateFlexibleComplexRoutesV16(6),out=[];let n=0;
  for(const z of flex){const c=physicalCandidateV10(`flex-${z.axis}-${n}`,z.axis==='horizontal'?'Змейка по контуру':'Поперечная змейка по контуру','Переходы между частями комнаты проходят через свободные проёмы между рядами.',z.route,'сложная форма');if(c){c.axis=z.axis;c.diagnostics=z.diagnostics;c.boundary=z.boundary;out.push(c);n++;}}
  if(out.length)state.rejectedRouteReasons=[];
  return out;
};

const simpleCandidateStatusV16BaseFlex=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV16Flex(c){
  if(c&&String(c.id||'').startsWith('flex-')){const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};if(!d.bendOK)return{cls:'warn',text:'Маршрут построен; часть разворотов ещё слишком тесная'};return{cls:'ok',text:'✓ Сложная форма и препятствия учтены'};}
  return simpleCandidateStatusV16BaseFlex(c);
};

// ===== v0.16c: T-образная комната — двухзонная змейка с возвратом к коллектору =====
// Для T-формы оставляем у стены коллектора один полноценный верхний/боковой проход.
// Основная площадь делится швом, проходящим через «ножку» T. Одна половина идёт
// от коллектора к дальней стене, вторая возвращается обратно; поэтому не нужен
// случайный длинный подвод через уже заполненную площадь.

function oddLaneCountV16(span,step){
  const natural=Math.max(3,Math.round(span/step)+1),opts=[];
  for(let n=Math.max(3,natural-3);n<=natural+3;n++){
    if(n%2===0)continue;const sp=span/(n-1);if(sp<step*.72||sp>step*1.28)continue;opts.push({n,sp,pen:Math.abs(sp-step)});
  }
  opts.sort((a,b)=>a.pen-b.pen);return opts[0]||null;
}

function seamCoordModelV16(side){
  const b=state.bounds,tb=side==='top'||side==='bottom';
  const inward=(side==='top'||side==='left')?1:-1;
  return{
    tb,inward,
    depthMin:tb?b.minY:b.minX,depthMax:tb?b.maxY:b.maxX,
    crossMin:tb?b.minX:b.minY,crossMax:tb?b.maxX:b.maxY,
    world:(cross,depth)=>tb?{x:cross,y:depth}:{x:depth,y:cross},
    intervals:depth=>allowedIntervalsAtV15(tb?'x':'y',depth,Math.max(0,Number(state.wallOffsetMm)||0)),
  };
}

function clippedSingleIntervalV16(ints,lo,hi,minLen){
  const arr=[];for(const [a,z] of ints){const x=Math.max(a,lo),y=Math.min(z,hi);if(y-x>=minLen)arr.push([x,y]);}
  if(arr.length!==1)return null;return arr[0];
}

function buildSideSnakeV16(model,depths,seam,gap,which,forward){
  const step=Math.max(50,Number(state.pipeStepMm)||150),off=Math.max(0,Number(state.wallOffsetMm)||0),minLen=Math.max(step*.42,(Number(state.pipeDiameterMm)||16)*3);
  const arr=[];
  for(let i=0;i<depths.length;i++){
    const d=depths[i],ints=model.intervals(d);
    const clip=which==='low'
      ?clippedSingleIntervalV16(ints,model.crossMin+off,seam-gap/2,minLen)
      :clippedSingleIntervalV16(ints,seam+gap/2,model.crossMax-off,minLen);
    if(!clip)return null;
    arr.push({id:i,lane:i,index:0,coord:d,low:clip[0],high:clip[1],axis:model.tb?'horizontal':'vertical'});
  }
  const seq=forward?arr:[...arr].reverse();
  // outer->seam on the outward half; seam->outer on the return half.
  let o;
  if(forward)o=which==='low'?0:1; else o=which==='low'?1:0;
  const first=segEndsV16(seq[0],o),pts=[first.start,first.end];
  for(let i=1;i<seq.length;i++){
    const no=1-o,c=intervalConnectorV16(seq[i-1],o,seq[i],no,off);if(!c)return null;
    const e=segEndsV16(seq[i],no);pts.push(...c.slice(1),e.end);o=no;
  }
  const core=cleanPolyline(pts);return validRoute(core)&&!routeHasRetraceV14(core)?core:null;
}

function safePolylineInsetV16(pts,inset){
  const c=cleanPolyline(pts);for(let i=1;i<c.length;i++)if(!coreSegmentSafeV12(c[i-1],c[i],inset))return null;return c;
}

function generateTSeamRoutesV16(limit=6){
  if(state.shapeType!=='T')return[];
  const ports=routePorts();if(!ports||ports.supplySide!==ports.returnSide)return[];
  const side=ports.supplySide,model=seamCoordModelV16(side),off=Math.max(0,Number(state.wallOffsetMm)||0),step=Math.max(50,Number(state.pipeStepMm)||150);
  const wallDepth=(side==='top'||side==='left')?model.depthMin:model.depthMax;
  const returnDepth=wallDepth+model.inward*off;
  const nearDepth=wallDepth+model.inward*(off+step);
  const farDepth=(side==='top'||side==='left')?model.depthMax-off:model.depthMin+off;
  const span=Math.abs(farDepth-nearDepth),pick=oddLaneCountV16(span,step);if(!pick)return[];
  const depths=linspaceV12(nearDepth,farDepth,pick.n),gap=step;
  // Candidate seams sampled inside the cross-section shared by all rows.
  const seamCandidates=[];
  for(let c=model.crossMin+off+gap;c<=model.crossMax-off-gap;c+=Math.max(25,step*.25)){
    let ok=true,minSide=Infinity;
    for(const d of depths){
      const ints=model.intervals(d),L=clippedSingleIntervalV16(ints,model.crossMin+off,c-gap/2,step*.4),R=clippedSingleIntervalV16(ints,c+gap/2,model.crossMax-off,step*.4);
      if(!L||!R){ok=false;break;}minSide=Math.min(minSide,L[1]-L[0],R[1]-R[0]);
    }
    if(ok)seamCandidates.push({c,score:-minSide+Math.abs(c-(model.crossMin+model.crossMax)/2)*.05});
  }
  seamCandidates.sort((a,b)=>a.score-b.score);
  const collectorCross=model.tb?ports.supply.x:ports.supply.y,out=[];
  for(const sc of seamCandidates.slice(0,12)){
    const seam=sc.c,collectorLow=collectorCross<seam,firstSide=collectorLow?'low':'high',secondSide=collectorLow?'high':'low';
    const first=buildSideSnakeV16(model,depths,seam,gap,firstSide,true),second=buildSideSnakeV16(model,depths,seam,gap,secondSide,false);if(!first||!second)continue;
    const farJoin=transitionBetweenGroupsV16(first[first.length-1],second[0],model.tb?'horizontal':'vertical',off);if(!farJoin)continue;
    const main=cleanPolyline([...first,...farJoin.slice(1),...second.slice(1)]);if(!validRoute(main)||routeHasRetraceV14(main))continue;
    const firstStart=main[0],last=main[main.length-1],midDepth=wallDepth+model.inward*(off+step*.5);
    const supplyCross=model.tb?ports.supply.x:ports.supply.y,retCross=model.tb?ports.ret.x:ports.ret.y;
    const firstCross=model.tb?firstStart.x:firstStart.y,lastCross=model.tb?last.x:last.y;
    const leadPts=[ports.supply,model.world(supplyCross,midDepth),model.world(firstCross,midDepth),firstStart];
    const tailPts=[last,model.world(lastCross,returnDepth),model.world(retCross,returnDepth),ports.ret];
    const lead=safePolylineInsetV16(leadPts,0),tail=safePolylineInsetV16(tailPts,0);if(!lead||!tail)continue;
    const route=cleanPolyline([...lead,...main.slice(1),...tail.slice(1)]);if(!validRoute(route)||routeHasRetraceV14(route))continue;
    const crowd=routeCrowdingV14(route);if(crowd.bad>2)continue;
    const d=physicalDiagnosticsV10(route,'t-seam'),boundary=boundaryCoverageV15(main);
    const score=routeLength(route)+boundary.penalty*16+crowd.bad*5000+(d.bendOK?0:1600)+(d.lengthOK?0:100000)+sc.score;
    out.push({route,core:main,axis:model.tb?'horizontal':'vertical',score,diagnostics:d,boundary,seam});
  }
  out.sort((a,b)=>a.score-b.score);return out.slice(0,limit);
}

const createRouteCandidatesV16FlexBaseSeam=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV16Seam(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect)return createRouteCandidatesV16FlexBaseSeam()||[];

  // T-форма сначала идёт в специализированный быстрый генератор. Это важно на телефоне:
  // не запускаем дорогой общий поиск, если двухзонная топология уже даёт валидный маршрут.
  if(state.shapeType==='T'){
    const sr=generateTSeamRoutesV16(6),out=[];let i=0;
    for(const z of sr){const c=physicalCandidateV10(`t-seam-${i}`,'Двухзонная змейка','Труба проходит одну половину комнаты к дальней стене и возвращается по второй; оба конца остаются у коллектора.',z.route,'сложная T-форма');if(c){c.diagnostics=z.diagnostics;c.boundary=z.boundary;out.push(c);i++;}}
    if(out.length){state.rejectedRouteReasons=[];return out;}
  }

  return createRouteCandidatesV16FlexBaseSeam()||[];
};

const simpleCandidateStatusV16FlexBaseSeam=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV16Seam(c){
  if(c&&String(c.id||'').startsWith('t-seam-')){const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};if(!d.bendOK)return{cls:'warn',text:'Маршрут построен; часть разворотов ещё требует увеличения радиуса'};return{cls:'ok',text:'✓ Оба конца возвращаются к коллектору без прохода поверх уложенной трубы'};}
  return simpleCandidateStatusV16FlexBaseSeam(c);
};

if($('routeSheetHelp'))$('routeSheetHelp').textContent='Для T-образной комнаты приложение сначала пробует двухзонную схему: одна половина ведёт трубу к дальней стене, вторая возвращает её к коллектору. Это уменьшает длинные подводы вдоль стен и позволяет учитывать несколько препятствий без наложения трубы.';

// ===== v0.17: препятствие, примыкающее к ЛЮБОЙ стене T/L-комнаты =====
// В предыдущих версиях часть препятствий у вогнутых стен ошибочно считалась
// "внутренними островами", потому что проверялась в основном внешняя рамка комнаты.
// Теперь проверяем фактическую границу свободной области: если сразу за любой
// стороной препятствия находится пространство вне комнаты, препятствие считается
// примыкающим к стене и просто изменяет профиль доступной зоны.
function obstacleTouchesRoomBoundaryV17(o, eps = 12) {
  if (!o) return false;
  const x1=o.x, x2=o.x+o.width, y1=o.y, y2=o.y+o.height;
  const n=Math.max(6,Math.min(24,Math.ceil(Math.max(o.width,o.height)/120)));
  const outside = (x,y) => !insideRoom(x,y,true);
  for(let i=0;i<=n;i++){
    const t=i/n, x=x1+(x2-x1)*t, y=y1+(y2-y1)*t;
    if(outside(x,y1-eps) || outside(x,y2+eps) || outside(x1-eps,y) || outside(x2+eps,y)) return true;
  }
  // Fallback to exact boundary-segment intersection for numerically exact contacts.
  return obstacleTouchesOuterBoundaryV13(o,Math.max(3,eps));
}

complexObstacleSummaryV13=function complexObstacleSummaryV17(){
  const obs=state.obstacles||[];
  if(!obs.length)return{count:0,edge:0,interior:0};
  let edge=0;
  for(const o of obs)if(obstacleTouchesRoomBoundaryV17(o,12))edge++;
  return{count:obs.length,edge,interior:obs.length-edge};
};

// Для граничных препятствий не запускаем тяжёлый "островной" Hamiltonian search:
// они уже должны быть учтены как часть изменённого профиля комнаты.
const generateIslandObstacleRoutesV16BaseV17=generateIslandObstacleRoutesV16;
generateIslandObstacleRoutesV16=function generateIslandObstacleRoutesV17(limit=4){
  const info=complexObstacleSummaryV13();
  if(!info.interior)return[];
  return generateIslandObstacleRoutesV16BaseV17(limit);
};

if($('routeSheetHelp')) $('routeSheetHelp').textContent='Препятствие, которое касается любой стены — в том числе внутренней вогнутой стены Г/T-комнаты — теперь считается частью границы помещения. Труба огибает такую зону как стену; отдельный поиск вокруг «острова» запускается только для действительно внутренних препятствий.';

// ===== v0.17b: STC coverage — общий непрерывный контур для сложной формы и препятствий =====
// Идея Spanning Tree Coverage: свободная площадь разбивается на крупные клетки 2×шаг.
// В каждой клетке есть четыре точки, отстоящие друг от друга на один шаг трубы.
// Локальные циклы клеток сшиваются по рёбрам остовного дерева в один общий цикл.
// Затем цикл разрывается возле коллектора — получаем один непрерывный контур,
// у которого подача и обратка находятся рядом, а препятствия обходятся автоматически.

function stcNodeKeyV17(p){return `${Math.round(p.x*10)/10},${Math.round(p.y*10)/10}`;}
function stcCellKeyV17(r,c){return `${r},${c}`;}
function stcEdgeKeyV17(a,b){const A=stcNodeKeyV17(a),B=stcNodeKeyV17(b);return A<B?`${A}|${B}`:`${B}|${A}`;}

function stcCellValidV17(cx,cy,step,inset){
  const h=step/2;
  const pts=[{x:cx-h,y:cy-h},{x:cx+h,y:cy-h},{x:cx+h,y:cy+h},{x:cx-h,y:cy+h}];
  for(const p of pts)if(!pointAllowedAtInsetV15(p.x,p.y,inset))return null;
  for(let i=0;i<4;i++)if(!coreSegmentSafeV12(pts[i],pts[(i+1)%4],inset))return null;
  return pts;
}

function stcGridV17(phaseX=0,phaseY=0){
  const b=state.bounds,step=Math.max(50,Number(state.pipeStepMm)||150),inset=Math.max(0,Number(state.wallOffsetMm)||0),pitch=step*2;
  const x0=b.minX+inset+step/2+phaseX, y0=b.minY+inset+step/2+phaseY;
  const cells=[],map=new Map(); let r=0;
  for(let cy=y0;cy<=b.maxY-inset-step/2+1;cy+=pitch,r++){
    let c=0;
    for(let cx=x0;cx<=b.maxX-inset-step/2+1;cx+=pitch,c++){
      const pts=stcCellValidV17(cx,cy,step,inset); if(!pts)continue;
      const cell={r,c,cx,cy,pts,key:stcCellKeyV17(r,c)};cells.push(cell);map.set(cell.key,cell);
    }
  }
  if(cells.length<2)return null;
  const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
  for(const cell of cells){cell.neighbors=[];for(const [dr,dc] of dirs){const n=map.get(stcCellKeyV17(cell.r+dr,cell.c+dc));if(n)cell.neighbors.push(n);}}
  return{cells,map,step,inset,pitch,phaseX,phaseY};
}

function stcConnectedV17(grid){
  if(!grid?.cells?.length)return false;const seen=new Set([grid.cells[0].key]),q=[grid.cells[0]];
  for(let i=0;i<q.length;i++)for(const n of q[i].neighbors)if(!seen.has(n.key)){seen.add(n.key);q.push(n);}
  return seen.size===grid.cells.length;
}

function stcRootV17(grid){
  const ports=routePorts();if(!ports)return grid.cells[0];
  const target=inwardPortPointV12(ports.supply,ports.supplySide,1);
  return [...grid.cells].sort((a,b)=>dist({x:a.cx,y:a.cy},target)-dist({x:b.cx,y:b.cy},target))[0];
}

function stcTreeV17(grid,mode=0){
  const root=stcRootV17(grid),seen=new Set([root.key]),tree=[],work=[root];
  const vectorOrder=(cell,neighbors)=>{
    const ports=routePorts(),target=ports?ports.supply:{x:grid.cells[0].cx,y:grid.cells[0].cy};
    return [...neighbors].sort((a,b)=>{
      if(mode===1)return (a.cy-b.cy)||(a.cx-b.cx);
      if(mode===2)return (b.cy-a.cy)||(b.cx-a.cx);
      if(mode===3)return (a.cx-b.cx)||(a.cy-b.cy);
      return dist({x:a.cx,y:a.cy},target)-dist({x:b.cx,y:b.cy},target);
    });
  };
  while(work.length){const cur=mode===0?work.shift():work.pop();for(const n of vectorOrder(cur,cur.neighbors)){if(seen.has(n.key))continue;seen.add(n.key);tree.push([cur,n]);work.push(n);}}
  return seen.size===grid.cells.length?tree:null;
}

function stcCycleV17(grid,tree){
  const nodes=new Map(),adj=new Map();
  const node=p=>{const k=stcNodeKeyV17(p);if(!nodes.has(k))nodes.set(k,{x:p.x,y:p.y});if(!adj.has(k))adj.set(k,new Set());return k;};
  const add=(a,b)=>{const A=node(a),B=node(b);adj.get(A).add(B);adj.get(B).add(A);};
  const rem=(a,b)=>{const A=node(a),B=node(b);adj.get(A)?.delete(B);adj.get(B)?.delete(A);};
  for(const c of grid.cells){const [tl,tr,br,bl]=c.pts;add(tl,tr);add(tr,br);add(br,bl);add(bl,tl);}
  for(const [a,b] of tree){
    const dr=b.r-a.r,dc=b.c-a.c;
    const [atl,atr,abr,abl]=a.pts,[btl,btr,bbr,bbl]=b.pts;
    if(dc===1){rem(atr,abr);rem(btl,bbl);add(atr,btl);add(abr,bbl);} // b справа
    else if(dc===-1){rem(atl,abl);rem(btr,bbr);add(atl,btr);add(abl,bbr);} // b слева
    else if(dr===1){rem(abl,abr);rem(btl,btr);add(abl,btl);add(abr,btr);} // b снизу
    else if(dr===-1){rem(atl,atr);rem(bbl,bbr);add(atl,bbl);add(atr,bbr);} // b сверху
  }
  // После сшивки каждую точку должны соединять ровно два ребра.
  for(const [k,ns] of adj)if(ns.size!==2)return null;
  const start=adj.keys().next().value,order=[start];let prev=null,cur=start;
  for(let guard=0;guard<adj.size+3;guard++){
    const ns=[...adj.get(cur)],next=ns[0]===prev?ns[1]:ns[0];
    if(next===start){if(order.length===adj.size)break;return null;}
    order.push(next);prev=cur;cur=next;
  }
  if(order.length!==adj.size)return null;
  return order.map(k=>nodes.get(k));
}

function stcOpenCandidatesV17(cycle,limit=12){
  const ports=routePorts();if(!ports||!cycle?.length)return[];
  const n=cycle.length,rank=[];
  for(let i=0;i<n;i++){
    const a=cycle[i],b=cycle[(i+1)%n],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const d=Math.min(dist(mid,ports.supply),dist(mid,ports.ret));
    rank.push({i,d});
  }
  rank.sort((a,b)=>a.d-b.d);const out=[];
  for(const {i} of rank.slice(0,Math.min(limit,n))){
    // Удаляем ребро i→i+1 и получаем открытый путь от i+1 до i.
    const seq=[];for(let k=1;k<=n;k++)seq.push(cycle[(i+k)%n]);
    for(const rev of [false,true]){
      const core=rev?[...seq].reverse():seq;
      const route=attachComplexPortsV12(core,ports);if(!route||!validRoute(route)||routeHasRetraceV14(route))continue;
      const crowd=routeCrowdingV14(route);if(crowd.bad>2)continue;
      out.push({route,core,crowd,cut:i});
    }
  }
  out.sort((a,b)=>routeLength(a.route)-routeLength(b.route));return out;
}

function generateSTCRoutesV17(limit=5){
  const step=Math.max(50,Number(state.pipeStepMm)||150),phases=[0,step*.5,step,step*1.5],all=[];
  for(const px of phases)for(const py of phases){
    const grid=stcGridV17(px,py);if(!grid||!stcConnectedV17(grid))continue;
    for(const mode of [0,1,2,3]){
      const tree=stcTreeV17(grid,mode);if(!tree)continue;const cycle=stcCycleV17(grid,tree);if(!cycle)continue;
      const opens=stcOpenCandidatesV17(cycle,10);for(const o of opens.slice(0,2)){
        const d=physicalDiagnosticsV10(o.route,'stc-coverage'),boundary=boundaryCoverageV15(o.core);
        const expectedCells=grid.cells.length,score=-expectedCells*100000+boundary.penalty*12+routeLength(o.route)*.02+(d.bendOK?0:1800)+(d.lengthOK?0:100000);
        all.push({...o,grid,diagnostics:d,boundary,score,cells:expectedCells});
      }
    }
  }
  all.sort((a,b)=>a.score-b.score);const uniq=[];
  for(const x of all){if(uniq.some(u=>Math.abs(u.cells-x.cells)<1&&Math.abs(routeLength(u.route)-routeLength(x.route))<180))continue;uniq.push(x);if(uniq.length>=limit)break;}
  return uniq;
}

const createRouteCandidatesV16SeamBaseV17STC=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV17STC(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  const base=createRouteCandidatesV16SeamBaseV17STC()||[];if(simpleRect)return base;
  const stc=generateSTCRoutesV17(5),out=[...base];let i=0;
  for(const z of stc){
    const c=physicalCandidateV10(`stc-${i}`,'Контурный обход','Непрерывная сеточная трасса строится вокруг препятствий и сложной формы одним контуром.',z.route,'сложная форма');
    if(c){c.diagnostics=z.diagnostics;c.boundary=z.boundary;c.stcCells=z.cells;out.push(c);i++;}
  }
  if(out.length)state.rejectedRouteReasons=[];
  out.sort((a,b)=>{
    const as=String(a.id||'').startsWith('stc-')?0:1,bs=String(b.id||'').startsWith('stc-')?0:1;
    const ad=a.diagnostics||physicalDiagnosticsV10(a.route,a.id),bd=b.diagnostics||physicalDiagnosticsV10(b.route,b.id);
    return (ad.bendOK?0:1)-(bd.bendOK?0:1)||as-bs||(a.boundary?.penalty||0)-(b.boundary?.penalty||0)||a.length-b.length;
  });
  return out.slice(0,8);
};

const simpleCandidateStatusV16SeamBaseV17STC=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV17STC(c){
  if(c&&String(c.id||'').startsWith('stc-')){
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(!d.bendOK)return{cls:'warn',text:'Препятствия обойдены; часть углов ещё требует увеличения радиуса'};
    return{cls:'ok',text:'✓ Один непрерывный контур вокруг сложной формы и препятствий'};
  }
  return simpleCandidateStatusV16SeamBaseV17STC(c);
};

if($('routeSheetHelp'))$('routeSheetHelp').textContent='Для сложной формы теперь есть резервный контурный алгоритм: свободная площадь разбивается на сеточные зоны, они соединяются остовным деревом в один непрерывный контур, а цикл разрывается возле коллектора. Это позволяет обходить несколько препятствий без наложения трубы.';

// v0.17c: добираем узкие остаточные полосы вокруг STC-ядра.
// Базовый STC покрывает только полные блоки 2×2 шага. У сложной стены остаются
// полосы шириной около одного шага. Если рядом с ребром цикла есть две свободные
// точки тонкой сетки, вставляем их как "ухо" A→U→V→B. Так сохраняется один цикл,
// но покрытие заметно приближается к площади/шагу.
function stcFineGridV17(phaseX,phaseY){
  const b=state.bounds,s=Math.max(50,Number(state.pipeStepMm)||150),off=Math.max(0,Number(state.wallOffsetMm)||0),nodes=new Map();
  const x0=b.minX+off+phaseX,y0=b.minY+off+phaseY;
  for(let y=y0;y<=b.maxY-off+1;y+=s)for(let x=x0;x<=b.maxX-off+1;x+=s){
    if(pointAllowedAtInsetV15(x,y,off))nodes.set(stcNodeKeyV17({x,y}),{x,y});
  }
  return{nodes,s,off};
}
function stcExpandCycleV17(cycle,phaseX,phaseY){
  if(!cycle?.length)return{cycle,ratio:0,used:0,total:0};
  const fg=stcFineGridV17(phaseX,phaseY),s=fg.s,used=new Set(cycle.map(stcNodeKeyV17)),pts=[...cycle];
  const safe=(a,b)=>coreSegmentSafeV12(a,b,fg.off);
  let changed=true,passes=0;
  while(changed&&passes++<12){changed=false;
    for(let i=0;i<pts.length;i++){
      const a=pts[i],b=pts[(i+1)%pts.length];
      if(Math.abs(dist(a,b)-s)>2)continue;
      const horizontal=nearly(a.y,b.y,2),vertical=nearly(a.x,b.x,2);if(!horizontal&&!vertical)continue;
      const normals=horizontal?[[0,s],[0,-s]]:[[s,0],[-s,0]];
      for(const [dx,dy] of normals){
        const u={x:a.x+dx,y:a.y+dy},v={x:b.x+dx,y:b.y+dy},ku=stcNodeKeyV17(u),kv=stcNodeKeyV17(v);
        if(used.has(ku)||used.has(kv)||!fg.nodes.has(ku)||!fg.nodes.has(kv))continue;
        if(!safe(a,u)||!safe(u,v)||!safe(v,b))continue;
        pts.splice(i+1,0,u,v);used.add(ku);used.add(kv);changed=true;i+=2;break;
      }
    }
  }
  return{cycle:pts,ratio:fg.nodes.size?used.size/fg.nodes.size:0,used:used.size,total:fg.nodes.size};
}

const generateSTCRoutesV17BaseExpand=generateSTCRoutesV17;
generateSTCRoutesV17=function generateSTCRoutesV17Expanded(limit=5){
  const step=Math.max(50,Number(state.pipeStepMm)||150),phases=[0,step*.5,step,step*1.5],all=[];
  for(const px of phases)for(const py of phases){
    const grid=stcGridV17(px,py);if(!grid||!stcConnectedV17(grid))continue;
    for(const mode of [0,1,2,3]){
      const tree=stcTreeV17(grid,mode);if(!tree)continue;let cycle=stcCycleV17(grid,tree);if(!cycle)continue;
      const ex=stcExpandCycleV17(cycle,px,py);cycle=ex.cycle;
      const opens=stcOpenCandidatesV17(cycle,8);for(const o of opens.slice(0,2)){
        const d=physicalDiagnosticsV10(o.route,'stc-coverage'),boundary=boundaryCoverageV15(o.core);
        // Coverage ratio is primary: a short route that misses strips is never preferred.
        const score=-(ex.ratio*10000000)-ex.used*15000+boundary.penalty*12+routeLength(o.route)*.02+(d.bendOK?0:1800)+(d.lengthOK?0:100000);
        all.push({...o,grid,diagnostics:d,boundary,score,cells:grid.cells.length,coverageRatio:ex.ratio,fineUsed:ex.used,fineTotal:ex.total});
      }
    }
  }
  all.sort((a,b)=>a.score-b.score);const uniq=[];
  for(const x of all){if(uniq.some(u=>Math.abs(u.coverageRatio-x.coverageRatio)<.01&&Math.abs(routeLength(u.route)-routeLength(x.route))<180))continue;uniq.push(x);if(uniq.length>=limit)break;}
  return uniq;
};

// ===== v0.17d: Boustrophedon cell decomposition =====
// Более «монтажный» вариант для сложных помещений: вместо мелкого сеточного лабиринта
// разбиваем пространство на длинные монотонные ячейки между событиями split/merge,
// каждую ячейку заполняем обычной крупной змейкой и затем сшиваем ячейки через
// свободные переходы между соседними рядами.
function bcdCellsV17(axis,phase=0){
  const model=intervalSweepSegmentsV16(axis,phase,0);if(!model)return null;
  const cells=[],cellById=new Map();let nextId=0,prevSegs=[],prevMap=new Map();
  const newCell=(seg)=>{const c={id:nextId++,axis,slices:[{lane:seg.lane,coord:seg.coord,low:seg.low,high:seg.high,axis}],neighbors:new Set()};cells.push(c);cellById.set(c.id,c);return c;};
  for(const lane of model.lanes){
    const cur=lane.segments||[];
    if(!prevSegs.length){prevMap=new Map();for(const s of cur){const c=newCell(s);prevMap.set(s.id,c.id);}prevSegs=cur;continue;}
    const pred=new Map(),succ=new Map();for(const s of cur)pred.set(s.id,[]);for(const p of prevSegs)succ.set(p.id,[]);
    for(const p of prevSegs)for(const s of cur){const ov=Math.min(p.high,s.high)-Math.max(p.low,s.low);if(ov>Math.max(8,(Number(state.pipeDiameterMm)||16)*.7)){succ.get(p.id).push(s.id);pred.get(s.id).push(p.id);}}
    const curMap=new Map();
    for(const s of cur){
      const ps=pred.get(s.id)||[];
      if(ps.length===1 && (succ.get(ps[0])||[]).length===1){
        const cid=prevMap.get(ps[0]);const c=cellById.get(cid);c.slices.push({lane:s.lane,coord:s.coord,low:s.low,high:s.high,axis});curMap.set(s.id,cid);
      }else{
        const c=newCell(s);curMap.set(s.id,c.id);
        for(const pid of ps){const old=cellById.get(prevMap.get(pid));if(old){old.neighbors.add(c.id);c.neighbors.add(old.id);}}
      }
    }
    // A previous branch that splits into several current intervals: connect all new children.
    for(const p of prevSegs){const ss=succ.get(p.id)||[];if(ss.length>1){const old=cellById.get(prevMap.get(p.id));for(const sid of ss){const cid=curMap.get(sid);const c=cellById.get(cid);if(old&&c&&old.id!==c.id){old.neighbors.add(c.id);c.neighbors.add(old.id);}}}}
    prevSegs=cur;prevMap=curMap;
  }
  return{...model,cells};
}

function bcdCellVariantV17(cell,reverse=false,startSide=0,inset=Math.max(0,Number(state.wallOffsetMm)||0)){
  const slices=reverse?[...cell.slices].reverse():cell.slices;let side=startSide,pts=[];
  for(let i=0;i<slices.length;i++){
    const s=slices[i],a=s.axis==='horizontal'?{x:s.low,y:s.coord}:{x:s.coord,y:s.low},b=s.axis==='horizontal'?{x:s.high,y:s.coord}:{x:s.coord,y:s.high};
    const st=side===0?a:b,en=side===0?b:a;
    if(!pts.length)pts=[st,en];
    else{
      const c=transitionBetweenGroupsV16(pts[pts.length-1],st,s.axis,inset);if(!c)return null;pts.push(...c.slice(1),en);
    }
    side=1-side;
  }
  pts=cleanPolyline(pts);if(pts.length<2||!validRoute(pts)||routeHasRetraceV14(pts))return null;
  return{points:pts,start:pts[0],end:pts[pts.length-1],reverse,startSide};
}

function bcdVariantsV17(cell,inset){
  const out=[];for(const rev of [false,true])for(const side of [0,1]){const v=bcdCellVariantV17(cell,rev,side,inset);if(v)out.push(v);}return out;
}

function bcdHamiltonianOrdersV17(model,limit=20){
  const n=model.cells.length;if(!n||n>18)return[];const ports=routePorts();
  const endpointScore=c=>{if(!ports)return 0;let best=1e9;for(const s of c.slices){const ps=s.axis==='horizontal'?[{x:s.low,y:s.coord},{x:s.high,y:s.coord}]:[{x:s.coord,y:s.low},{x:s.coord,y:s.high}];for(const p of ps)best=Math.min(best,dist(p,ports.supply),dist(p,ports.ret));}return best;};
  const starts=[...model.cells].sort((a,b)=>a.neighbors.size-b.neighbors.size||endpointScore(a)-endpointScore(b));
  const out=[],vis=new Set(),order=[];
  function dfs(c){if(out.length>=limit)return;if(order.length===n){out.push(order.map(x=>x.id));return;}
    const opts=[...c.neighbors].map(id=>model.cells.find(x=>x.id===id)).filter(x=>x&&!vis.has(x.id)).sort((a,b)=>{const aa=[...a.neighbors].filter(id=>!vis.has(id)).length,bb=[...b.neighbors].filter(id=>!vis.has(id)).length;return aa-bb||a.neighbors.size-b.neighbors.size;});
    for(const nx of opts){vis.add(nx.id);order.push(nx);dfs(nx);order.pop();vis.delete(nx.id);if(out.length>=limit)return;}
  }
  for(const s of starts){vis.clear();order.length=0;vis.add(s.id);order.push(s);dfs(s);if(out.length>=limit)break;}
  return out;
}

function connectBcdPartsV17(a,b,axis,inset,blocked){
  // Prefer a simple corridor between adjacent scan rows/columns; fall back to grid routing.
  const c=transitionBetweenGroupsV16(a,b,axis,inset);if(c && !segmentBlockedByPolylineV12(c[0],c[c.length-1],blocked||[],b))return c;
  return routeGridPathV12(a,b,blocked||[]);
}

function generateBCDRoutesV17(limit=6){
  const ports=routePorts();if(!ports)return[];const step=Math.max(50,Number(state.pipeStepMm)||150),all=[];
  for(const axis of ['horizontal','vertical'])for(const phase of [0,step*.25,step*.5,step*.75]){
    const model=bcdCellsV17(axis,phase);if(!model||model.cells.length<1||model.cells.length>14)continue;
    const orders=bcdHamiltonianOrdersV17(model,16);if(!orders.length)continue;
    const variants=new Map(model.cells.map(c=>[c.id,bcdVariantsV17(c,model.inset)]));if([...variants.values()].some(v=>!v.length))continue;
    for(const ord of orders){
      let states=variants.get(ord[0]).map(v=>({points:v.points,penalty:0}));
      for(let oi=1;oi<ord.length&&states.length;oi++){
        const next=[];for(const st of states.slice(0,8))for(const v of variants.get(ord[oi])){
          const p=st.points[st.points.length-1],q=v.points[0];
          const conn=connectBcdPartsV17(p,q,axis,model.inset,[st.points,v.points]);if(!conn)continue;
          const pts=cleanPolyline([...st.points,...conn.slice(1),...v.points.slice(1)]);if(!validRoute(pts)||routeHasRetraceV14(pts))continue;
          const crowd=routeCrowdingV14(pts);if(crowd.bad>1)continue;
          next.push({points:pts,penalty:st.penalty+routeLength(conn)*.04+crowd.bad*5000});
        }
        next.sort((a,b)=>a.penalty-b.penalty||routeLength(a.points)-routeLength(b.points));states=next.slice(0,10);
      }
      for(const st of states.slice(0,4)){
        const route=attachComplexPortsV12(st.points,ports);if(!route||!validRoute(route)||routeHasRetraceV14(route))continue;
        const crowd=routeCrowdingV14(route);if(crowd.bad>1)continue;
        const d=physicalDiagnosticsV10(route,'bcd'),boundary=boundaryCoverageV15(st.points);
        const score=boundary.penalty*18+st.penalty+routeLength(route)*.03+(d.bendOK?0:1600)+(d.lengthOK?0:100000);
        all.push({route,core:st.points,axis,phase,cells:model.cells.length,score,diagnostics:d,boundary,crowd});
      }
    }
  }
  all.sort((a,b)=>a.score-b.score);const uniq=[];for(const x of all){if(uniq.some(u=>u.axis===x.axis&&Math.abs(routeLength(u.route)-routeLength(x.route))<220))continue;uniq.push(x);if(uniq.length>=limit)break;}return uniq;
}

const createRouteCandidatesV17STCBaseBCD=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV17BCD(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect)return createRouteCandidatesV17STCBaseBCD()||[];
  // First ask the large-cell boustrophedon planner. It produces much fewer turns
  // than STC and is preferred whenever it can make one continuous contour.
  const bcd=generateBCDRoutesV17(5),out=[];let i=0;
  for(const z of bcd){const c=physicalCandidateV10(`bcd-${i}`,z.axis==='horizontal'?'Зональная змейка':'Поперечная зональная змейка','Комната разбита на крупные свободные зоны; каждая заполняется длинными проходами, затем зоны соединяются одним контуром.',z.route,'сложная форма');if(c){c.diagnostics=z.diagnostics;c.boundary=z.boundary;c.bcdCells=z.cells;out.push(c);i++;}}
  if(out.length){state.rejectedRouteReasons=[];return out;}
  // If BCD cannot form a single cell order, use the robust STC fallback from the previous layer.
  return createRouteCandidatesV17STCBaseBCD()||[];
};

const simpleCandidateStatusV17STCBaseBCD=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV17BCD(c){
  if(c&&String(c.id||'').startsWith('bcd-')){const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};if(!d.bendOK)return{cls:'warn',text:'Зоны заполнены; часть разворотов ещё требует увеличения радиуса'};return{cls:'ok',text:'✓ Крупные зоны соединены одним непрерывным контуром'};}return simpleCandidateStatusV17STCBaseBCD(c);
};

// ===== v0.17-zones: визуальная декомпозиция + ручной редактор зон =====
// На сложной геометрии кнопка «Труба» сначала показывает разбиение свободной
// площади. Пользователь видит зоны, задаёт порядок и способ укладки, может
// объединить соседние зоны или вернуть объединённую группу к исходным ячейкам.
// Финальная сшивка разных паттернов в одну трубу — отдельный следующий слой.

state.zoneEditor = state.zoneEditor || { active:false, confirmed:false, axis:'auto', model:null, groups:[], selectedGid:null, signature:'' };

const zonePaletteV17=['#93c5fd','#86efac','#fcd34d','#c4b5fd','#f9a8d4','#67e8f9','#fdba74','#a7f3d0','#ddd6fe','#fecaca'];
const zoneLettersV17='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function zoneComplexCaseV17(){
  return !((!state.shapeType||state.shapeType==='rect') && state.sections.length===1 && !state.excluded.size && !(state.obstacles&&state.obstacles.length));
}
function zoneGeometrySignatureV17(){
  const obs=(state.obstacles||[]).map(o=>[Math.round(o.x),Math.round(o.y),Math.round(o.width),Math.round(o.height)]);
  const sec=(state.sections||[]).map(s=>[Math.round(s.x),Math.round(s.y),Math.round(s.width),Math.round(s.height)]);
  return JSON.stringify([state.shapeType,state.shapeOrientation,sec,obs,Math.round(state.pipeStepMm||150),Math.round(state.wallOffsetMm||100)]);
}
function zoneCellBoundsV17(cell){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const s of cell.slices||[]){
    if(s.axis==='horizontal'){minX=Math.min(minX,s.low);maxX=Math.max(maxX,s.high);minY=Math.min(minY,s.coord);maxY=Math.max(maxY,s.coord);}
    else{minX=Math.min(minX,s.coord);maxX=Math.max(maxX,s.coord);minY=Math.min(minY,s.low);maxY=Math.max(maxY,s.high);}
  }
  if(!Number.isFinite(minX)) return {minX:0,minY:0,maxX:0,maxY:0,width:0,height:0};
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
function zoneCellAreaV17(cell,model){
  const t=Math.max(20,Number(model?.step)||Number(state.pipeStepMm)||150);
  let mm2=0; for(const s of cell.slices||[]) mm2+=Math.max(0,s.high-s.low)*t;
  return mm2/1e6;
}
function zoneCellRectangularV17(cell){
  const ss=cell.slices||[]; if(ss.length<2)return false;
  const lo=ss.map(s=>s.low),hi=ss.map(s=>s.high);
  return Math.max(...lo)-Math.min(...lo)<35 && Math.max(...hi)-Math.min(...hi)<35;
}
function zoneSuggestedPatternV17(cell){
  const b=zoneCellBoundsV17(cell),mn=Math.max(1,Math.min(b.width,b.height)),mx=Math.max(b.width,b.height),aspect=mx/mn;
  if(zoneCellRectangularV17(cell) && mn>=Math.max(700,(state.pipeStepMm||150)*5) && aspect<2.25) return 'spiral';
  if(aspect>3.0) return 'double';
  return 'snake';
}
function zonePatternNameV17(p){return p==='spiral'?'Улитка':p==='double'?'Двойная змейка':p==='snake'?'Змейка':'Авто';}
function zoneGroupCellsV17(g){const by=new Map((state.zoneEditor.model?.cells||[]).map(c=>[c.id,c]));return (g.cellIds||[]).map(id=>by.get(id)).filter(Boolean);}
function zoneGroupAreaV17(g){return zoneGroupCellsV17(g).reduce((s,c)=>s+zoneCellAreaV17(c,state.zoneEditor.model),0);}
function zoneGroupBoundsV17(g){
  const cs=zoneGroupCellsV17(g);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const c of cs){const b=zoneCellBoundsV17(c);minX=Math.min(minX,b.minX);minY=Math.min(minY,b.minY);maxX=Math.max(maxX,b.maxX);maxY=Math.max(maxY,b.maxY);}
  if(!Number.isFinite(minX))return {minX:0,minY:0,maxX:0,maxY:0,width:0,height:0};return{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
function zoneGroupCentroidV17(g){const b=zoneGroupBoundsV17(g);return{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};}
function zoneGroupsAdjacentV17(a,b){
  const bm=new Set(b.cellIds||[]),by=new Map((state.zoneEditor.model?.cells||[]).map(c=>[c.id,c]));
  for(const id of a.cellIds||[]){const c=by.get(id);if(!c)continue;for(const n of c.neighbors||[])if(bm.has(n))return true;}return false;
}
function zoneCellCollectorDistanceV17(c){
  const p=state.supply||state.returnPoint||{x:state.bounds.minX,y:state.bounds.minY},b=zoneCellBoundsV17(c);
  const x=clamp(p.x,b.minX,b.maxX),y=clamp(p.y,b.minY,b.maxY);return Math.hypot(x-p.x,y-p.y);
}
function zoneDefaultCellOrderV17(model){
  const cells=model?.cells||[];if(!cells.length)return[];
  const start=[...cells].sort((a,b)=>zoneCellCollectorDistanceV17(a)-zoneCellCollectorDistanceV17(b))[0];
  const by=new Map(cells.map(c=>[c.id,c])),vis=new Set(),out=[];
  function walk(c){if(!c||vis.has(c.id))return;vis.add(c.id);out.push(c.id);const ns=[...(c.neighbors||[])].map(id=>by.get(id)).filter(Boolean).sort((a,b)=>zoneCellCollectorDistanceV17(a)-zoneCellCollectorDistanceV17(b));for(const n of ns)walk(n);}
  walk(start);for(const c of cells)walk(c);return out;
}
function zoneModelScoreV17(model){
  if(!model||!model.cells?.length)return 1e12;
  // Для редактора зон важнее получить понятные простые области, чем минимальное
  // количество ячеек. Одна Г-образная «зона» хуже двух прямоугольных.
  let tiny=0,ragged=0;
  for(const c of model.cells){
    const a=zoneCellAreaV17(c,model);
    if(a<.35) tiny++;
    if(!zoneCellRectangularV17(c)) ragged++;
  }
  return ragged*50000 + tiny*7000 + model.cells.length*1800;
}
function analyzeZonesV17(forceAxis){
  collectInputs();recomputeGeometry();
  const pref=forceAxis||state.zoneEditor.axis||'auto',axes=pref==='auto'?['horizontal','vertical']:[pref],step=Math.max(50,Number(state.pipeStepMm)||150);
  const tries=[];for(const axis of axes)for(const phase of [0,step*.5]){const m=bcdCellsV17(axis,phase);if(m)tries.push(m);}
  tries.sort((a,b)=>zoneModelScoreV17(a)-zoneModelScoreV17(b));const model=tries[0]||null;
  state.zoneEditor.active=true;state.zoneEditor.confirmed=false;state.zoneEditor.axis=pref;state.zoneEditor.model=model;state.zoneEditor.signature=zoneGeometrySignatureV17();
  if(!model){state.zoneEditor.groups=[];state.zoneEditor.selectedGid=null;renderZoneEditorV17();renderPlan();return false;}
  const order=zoneDefaultCellOrderV17(model);
  state.zoneEditor.groups=order.map((id,i)=>{const c=model.cells.find(x=>x.id===id);return{gid:`zg-${Date.now().toString(36)}-${i}`,cellIds:[id],pattern:'auto',suggested:zoneSuggestedPatternV17(c)};});
  state.zoneEditor.selectedGid=state.zoneEditor.groups[0]?.gid||null;
  renderZoneEditorV17();renderPlan();return true;
}
function zoneResolvedPatternV17(g){
  if(g.pattern&&g.pattern!=='auto')return g.pattern;const cells=zoneGroupCellsV17(g);if(cells.length===1)return g.suggested||zoneSuggestedPatternV17(cells[0]);
  const b=zoneGroupBoundsV17(g),mn=Math.max(1,Math.min(b.width,b.height)),mx=Math.max(b.width,b.height);return mx/mn>2.6?'snake':'spiral';
}
function renderZoneEditorV17(){
  const host=$('zoneEditorList'),sum=$('zoneEditorSummary');if(!host||!sum)return;const ed=state.zoneEditor,m=ed.model;
  document.querySelectorAll('[data-zone-axis]').forEach(b=>b.classList.toggle('active',b.dataset.zoneAxis===ed.axis));
  if(!m){sum.textContent='Не удалось устойчиво разделить свободную площадь. Попробуйте другое направление разбиения или измените препятствие.';host.innerHTML='';return;}
  const total=ed.groups.reduce((s,g)=>s+zoneGroupAreaV17(g),0);sum.innerHTML=`Найдено <b>${ed.groups.length}</b> зон · примерно <b>${total.toFixed(1)} м²</b> · направление: <b>${m.axis==='horizontal'?'горизонтальные проходы':'вертикальные проходы'}</b>${ed.confirmed?' · <span class="zone-confirm-badge">подтверждено</span>':''}`;
  host.innerHTML=ed.groups.map((g,i)=>{const area=zoneGroupAreaV17(g),pat=zoneResolvedPatternV17(g),sel=ed.selectedGid===g.gid,canMerge=i<ed.groups.length-1&&zoneGroupsAdjacentV17(g,ed.groups[i+1]),merged=(g.cellIds||[]).length>1,color=zonePaletteV17[i%zonePaletteV17.length];return `<div class="zone-card${sel?' selected':''}" data-zone-card="${g.gid}">`+
    `<div class="zone-card-head"><button type="button" class="zone-swatch" data-zone-select="${g.gid}" style="background:${color}">${zoneLettersV17[i]||i+1}</button><div class="zone-card-title"><strong>Зона ${zoneLettersV17[i]||i+1} · ${area.toFixed(1)} м²</strong><span>${merged?`объединено частей: ${g.cellIds.length}`:'отдельная геометрическая область'} · предложение: ${zonePatternNameV17(pat)}</span></div><div class="zone-order"><button type="button" class="zone-mini-btn" data-zone-up="${g.gid}" ${i===0?'disabled':''}>↑</button><button type="button" class="zone-mini-btn" data-zone-down="${g.gid}" ${i===ed.groups.length-1?'disabled':''}>↓</button></div></div>`+
    `<div class="zone-pattern-row"><label>Способ укладки<select data-zone-pattern="${g.gid}"><option value="auto"${g.pattern==='auto'?' selected':''}>Авто → ${zonePatternNameV17(pat)}</option><option value="spiral"${g.pattern==='spiral'?' selected':''}>Улитка</option><option value="snake"${g.pattern==='snake'?' selected':''}>Змейка</option><option value="double"${g.pattern==='double'?' selected':''}>Двойная змейка</option></select></label><div class="zone-actions-row"><button type="button" class="zone-action" data-zone-merge="${g.gid}" ${canMerge?'':'disabled'}>Объединить ↓</button>${merged?`<button type="button" class="zone-action" data-zone-split="${g.gid}">Разделить</button>`:''}</div></div></div>`;}).join('');
  host.querySelectorAll('[data-zone-select]').forEach(b=>b.addEventListener('click',()=>{ed.selectedGid=b.dataset.zoneSelect;renderZoneEditorV17();renderPlan();}));
  host.querySelectorAll('[data-zone-card]').forEach(c=>c.addEventListener('click',e=>{if(e.target.closest('button,select'))return;ed.selectedGid=c.dataset.zoneCard;renderZoneEditorV17();renderPlan();}));
  host.querySelectorAll('[data-zone-pattern]').forEach(s=>s.addEventListener('change',()=>{const g=ed.groups.find(x=>x.gid===s.dataset.zonePattern);if(g){g.pattern=s.value;ed.confirmed=false;renderZoneEditorV17();renderPlan();}}));
  host.querySelectorAll('[data-zone-up]').forEach(b=>b.addEventListener('click',()=>zoneMoveGroupV17(b.dataset.zoneUp,-1)));
  host.querySelectorAll('[data-zone-down]').forEach(b=>b.addEventListener('click',()=>zoneMoveGroupV17(b.dataset.zoneDown,1)));
  host.querySelectorAll('[data-zone-merge]').forEach(b=>b.addEventListener('click',()=>zoneMergeNextV17(b.dataset.zoneMerge)));
  host.querySelectorAll('[data-zone-split]').forEach(b=>b.addEventListener('click',()=>zoneSplitGroupV17(b.dataset.zoneSplit)));
}
function zoneMoveGroupV17(gid,d){const ed=state.zoneEditor,i=ed.groups.findIndex(g=>g.gid===gid),j=i+d;if(i<0||j<0||j>=ed.groups.length)return;[ed.groups[i],ed.groups[j]]=[ed.groups[j],ed.groups[i]];ed.confirmed=false;renderZoneEditorV17();renderPlan();}
function zoneMergeNextV17(gid){const ed=state.zoneEditor,i=ed.groups.findIndex(g=>g.gid===gid);if(i<0||i>=ed.groups.length-1)return;const a=ed.groups[i],b=ed.groups[i+1];if(!zoneGroupsAdjacentV17(a,b)){setStatus('Эти зоны не соприкасаются — объединять их нельзя.',true);return;}a.cellIds=[...new Set([...a.cellIds,...b.cellIds])];a.pattern='auto';ed.groups.splice(i+1,1);ed.selectedGid=a.gid;ed.confirmed=false;renderZoneEditorV17();renderPlan();}
function zoneSplitGroupV17(gid){const ed=state.zoneEditor,i=ed.groups.findIndex(g=>g.gid===gid);if(i<0)return;const g=ed.groups[i];if((g.cellIds||[]).length<2)return;const parts=g.cellIds.map((id,k)=>{const c=ed.model.cells.find(x=>x.id===id);return{gid:`zg-${Date.now().toString(36)}-${i}-${k}`,cellIds:[id],pattern:'auto',suggested:c?zoneSuggestedPatternV17(c):'snake'};});ed.groups.splice(i,1,...parts);ed.selectedGid=parts[0].gid;ed.confirmed=false;renderZoneEditorV17();renderPlan();}
function zoneBandRectsV17(cell,model){
  const ss=[...(cell.slices||[])].sort((a,b)=>a.coord-b.coord),step=Math.max(20,Number(model.step)||150),out=[];
  for(let i=0;i<ss.length;i++){const s=ss[i],prev=i?ss[i-1].coord:s.coord-step,next=i+1<ss.length?ss[i+1].coord:s.coord+step,loC=(prev+s.coord)/2,hiC=(s.coord+next)/2;if(s.axis==='horizontal')out.push({x:s.low,y:loC,width:Math.max(1,s.high-s.low),height:Math.max(1,hiC-loC)});else out.push({x:loC,y:s.low,width:Math.max(1,hiC-loC),height:Math.max(1,s.high-s.low)});}
  return out;
}
function zoneOverlayHtmlV17(){
  const ed=state.zoneEditor,m=ed.model;
  // Цветные зоны нужны только во время редактирования. После подтверждения
  // они не должны перекрывать готовую трассу.
  if(!ed.active||!m||!ed.groups?.length)return'';
  const sc=Math.max(.001,state.scale||.1);let h='<g class="zone-overlay">';
  ed.groups.forEach((g,i)=>{const color=zonePaletteV17[i%zonePaletteV17.length],selected=ed.selectedGid===g.gid;for(const c of zoneGroupCellsV17(g))for(const r of zoneBandRectsV17(c,m))h+=`<rect class="zone-band${selected?' selected':''}" data-zone-gid="${g.gid}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${color}"/>`;const p=zoneGroupCentroidV17(g),rad=16/sc;h+=`<circle class="zone-label-bg" cx="${p.x}" cy="${p.y}" r="${rad}" fill="${color}"/><text class="zone-label" x="${p.x}" y="${p.y+1/sc}" font-size="${12/sc}">${zoneLettersV17[i]||i+1}</text>`;});
  return h+'</g>';
}
const renderPlanV17ZonesBase=renderPlan;
renderPlan=function renderPlanV17Zones(){renderPlanV17ZonesBase();const z=zoneOverlayHtmlV17();if(z)planSvg.insertAdjacentHTML('beforeend',z);};

function openZoneEditorV17(force=false){
  if(!zoneComplexCaseV17())return false;
  const sig=zoneGeometrySignatureV17();if(force||!state.zoneEditor.model||state.zoneEditor.signature!==sig)analyzeZonesV17(state.zoneEditor.axis||'auto');else{state.zoneEditor.active=true;renderZoneEditorV17();renderPlan();}
  openSheetV5('zoneSheet');setStatus(state.zoneEditor.model?'Проверьте зоны и порядок их прохождения.':'Не удалось получить устойчивое разбиение.',!state.zoneEditor.model);return true;
}
$('reanalyzeZonesBtn')?.addEventListener('click',()=>{analyzeZonesV17(state.zoneEditor.axis||'auto');});
$('confirmZonesBtn')?.addEventListener('click',()=>{
  if(!state.zoneEditor.model||!state.zoneEditor.groups.length){
    setStatus('Сначала нужно получить разбиение на зоны.',true);return;
  }
  state.zoneEditor.confirmed=true;
  state.zoneEditor.active=false;
  renderZoneEditorV17();
  closeSheetV5();
  // В v0.17 кнопка только сохраняла зоны, поэтому визуально «ничего не происходило».
  // Теперь после подтверждения сразу запускаем построение трассы.
  generateRoute();
});
document.querySelectorAll('[data-zone-axis]').forEach(b=>b.addEventListener('click',()=>{state.zoneEditor.axis=b.dataset.zoneAxis||'auto';analyzeZonesV17(state.zoneEditor.axis);openSheetV5('zoneSheet');}));

// Tap on a coloured zone selects its card. Use capture so the normal shape/obstacle tools
// do not interpret the same tap while the zone editor is active.
planSvg.addEventListener('pointerdown',e=>{const gid=e.target?.dataset?.zoneGid;if(!gid||!state.zoneEditor.active)return;e.preventDefault();e.stopImmediatePropagation();state.zoneEditor.selectedGid=gid;renderZoneEditorV17();renderPlan();},true);

// Complex geometry now enters the zone editor first. Simple rectangles keep the existing
// spiral/snake candidate workflow.
$('generateBtn')?.addEventListener('click',e=>{
  if(!zoneComplexCaseV17())return;
  e.preventDefault();e.stopImmediatePropagation();
  const sig=zoneGeometrySignatureV17();
  if(state.zoneEditor.confirmed && state.zoneEditor.signature===sig){
    generateRoute();
  }else{
    openZoneEditorV17(false);
  }
},true);

// Persist operator choices with a saved scheme. The cell decomposition itself is regenerated
// from current geometry when the editor opens, so only high-level preferences are stored.
const serializeStateV17ZonesBase=serializeState;
serializeState=function serializeStateV17Zones(){const item=serializeStateV17ZonesBase();if(state.zoneEditor?.model&&state.zoneEditor?.groups?.length)item.zonePlan={axis:state.zoneEditor.axis,confirmed:!!state.zoneEditor.confirmed,groups:state.zoneEditor.groups.map(g=>({cellIds:[...(g.cellIds||[])],pattern:g.pattern||'auto'}))};return item;};

if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent='Для сложной комнаты: проверьте зоны → «Построить по зонам»';


// ===== v0.17.2: быстрый маршрутизатор подтверждённых зон =====
// Причина: прежний BCD/STC перебор мог блокировать мобильный Safari на секунды и дольше.
// После ручного подтверждения зон больше не запускаем экспоненциальный поиск. Вместо этого
// берём порядок зон оператора, для каждой выбираем один из 4 локальных вариантов змейки
// и соединяем только простыми безопасными переходами. Никаких DFS/Hamiltonian/STC fallback.

function fastZoneVariantV172(cell, fromPoint, inset){
  const vars=bcdVariantsV17(cell,inset)||[];
  if(!vars.length)return null;
  vars.sort((a,b)=>{
    const da=fromPoint?dist(fromPoint,a.start):0, db=fromPoint?dist(fromPoint,b.start):0;
    return da-db || routeLength(a.points)-routeLength(b.points);
  });
  return vars[0]||null;
}

function fastZoneGroupPathV172(group, fromPoint, inset){
  const cells=zoneGroupCellsV17(group);
  if(!cells.length)return null;
  // Для объединённой группы идём по ближайшей следующей ячейке. Это жадный O(n²),
  // но n здесь обычно 1–5, то есть на телефоне практически мгновенно.
  const left=[...cells], points=[]; let current=fromPoint||null;
  while(left.length){
    let best=null,bestIdx=-1,bestScore=Infinity;
    for(let i=0;i<left.length;i++){
      const v=fastZoneVariantV172(left[i],current,inset); if(!v)continue;
      const s=(current?dist(current,v.start):0)+routeLength(v.points)*.0001;
      if(s<bestScore){bestScore=s;best={cell:left[i],variant:v};bestIdx=i;}
    }
    if(!best)return null;
    if(!points.length) points.push(...best.variant.points);
    else{
      const a=points[points.length-1], b=best.variant.start;
      const axis=state.zoneEditor.model?.axis||'horizontal';
      const conn=transitionBetweenGroupsV16(a,b,axis,inset);
      if(!conn)return null;
      const trial=cleanPolyline([...points,...conn.slice(1),...best.variant.points.slice(1)]);
      if(routeHasRetraceV14(trial)||!validRoute(trial))return null;
      points.length=0;points.push(...trial);
    }
    current=points[points.length-1];left.splice(bestIdx,1);
  }
  return cleanPolyline(points);
}

function directPortConnectorV172(port,target,side,inset,blocked=[]){
  if(!port||!target)return null;
  const inner=inwardPortPointV12(port,side,1);
  const choices=[];
  const add=pts=>{const c=cleanPolyline(pts);if(c.length<2)return;for(let i=1;i<c.length;i++){
    if(!segmentSafe(c[i-1],c[i],[port,target]))return;
    for(const poly of blocked){if(segmentBlockedByPolylineV12(c[i-1],c[i],poly,target))return;}
  }choices.push(c);};
  // Сначала строго внутрь, потом к цели — это также визуально лучше, чем длинный ход по стене.
  add([port,inner,{x:target.x,y:inner.y},target]);
  add([port,inner,{x:inner.x,y:target.y},target]);
  // Если цель находится на той же нормали — прямой подвод.
  add([port,inner,target]);
  choices.sort((a,b)=>routeLength(a)-routeLength(b));
  return choices[0]||null;
}

function generateConfirmedZonesFastV172(){
  const ed=state.zoneEditor,ports=routePorts();
  if(!ed?.confirmed||!ed.model||!ed.groups?.length||!ports)return null;
  const inset=Math.max(0,Number(ed.model.inset ?? state.wallOffsetMm)||0);
  const parts=[];let current=null;
  for(const g of ed.groups){
    const p=fastZoneGroupPathV172(g,current,inset);if(!p)return null;
    if(!parts.length)parts.push(p);
    else{
      const a=parts[parts.length-1][parts[parts.length-1].length-1],b=p[0];
      const conn=transitionBetweenGroupsV16(a,b,ed.model.axis||'horizontal',inset);
      if(!conn)return null;
      parts.push(conn,p);
    }
    current=p[p.length-1];
  }
  let core=[];for(const p of parts){if(!core.length)core=[...p];else core=cleanPolyline([...core,...p.slice(1)]);}
  if(core.length<2||routeHasRetraceV14(core)||!validRoute(core))return null;

  const lead=directPortConnectorV172(ports.supply,core[0],ports.supplySide,inset,[core]);
  if(!lead)return null;
  const tailFromPort=directPortConnectorV172(ports.ret,core[core.length-1],ports.returnSide,inset,[core,lead]);
  if(!tailFromPort)return null;
  const tail=[...tailFromPort].reverse();
  const route=cleanPolyline([...lead,...core.slice(1),...tail.slice(1)]);
  if(route.length<4||routeHasRetraceV14(route)||!validRoute(route))return null;
  return {route, zones:ed.groups.length, axis:ed.model.axis||'horizontal'};
}

const createRouteCandidatesV17_1BaseV172=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV172(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect)return createRouteCandidatesV17_1BaseV172()||[];
  const sig=zoneGeometrySignatureV17();
  if(state.zoneEditor?.confirmed && state.zoneEditor.signature===sig){
    const z=generateConfirmedZonesFastV172();
    state.rejectedRouteReasons=[];
    if(!z){state.rejectedRouteReasons.push('Быстрый маршрут по выбранному порядку зон не найден. Измените порядок зон или направление разбиения.');return[];}
    const c=physicalCandidateV10('zones-fast','Змейка по подтверждённым зонам',`Быстрый маршрут по ${z.zones} зонам без перебора тысяч вариантов.`,z.route,'быстрый режим');
    if(!c){state.rejectedRouteReasons.push('Маршрут по зонам не прошёл геометрическую проверку.');return[];}
    c.zones=z.zones;c.axis=z.axis;return[c];
  }
  // Пока зоны не подтверждены тяжёлый маршрут вообще не считаем: пользователь сначала
  // должен увидеть декомпозицию. Это устраняет случайные подвисания при открытии редактора.
  state.rejectedRouteReasons=[];
  return[];
};

const simpleCandidateStatusV172Base=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV172(c){
  if(c?.id==='zones-fast'){
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(!d.bendOK)return{cls:'warn',text:'Маршрут построен быстро; часть разворотов ещё требует проверки радиуса'};
    return{cls:'ok',text:'✓ Быстрый маршрут по подтверждённым зонам построен'};
  }
  return simpleCandidateStatusV172Base(c);
};

if($('routeSheetHelp'))$('routeSheetHelp').textContent='Быстрый режим: после подтверждения зон приложение не перебирает тысячи вариантов. Оно использует выбранный порядок зон и строит один детерминированный маршрут. Если он не проходит, измените порядок или направление зон.';

// ===== v0.18: монтажный приоритет вместо "покрыть любой ценой" =====
// Тёплый пол — не робот-пылесос. Для сложной комнаты хороший маршрут должен
// состоять прежде всего из длинных регулярных проходов. Короткие зубцы,
// лестницы возле препятствий и лишние развороты получают большой штраф.

function medianV18(a){
  if(!a?.length)return 0;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);
  return b.length%2?b[m]:(b[m-1]+b[m])/2;
}

function cellConstructionStatsV18(cell, model){
  const step=Math.max(50,Number(model?.step)||Number(state.pipeStepMm)||150);
  const ss=[...(cell?.slices||[])].sort((a,b)=>a.coord-b.coord);
  const lens=ss.map(s=>Math.max(0,s.high-s.low));
  const med=Math.max(step,medianV18(lens));
  let short=0,veryShort=0,jitter=0,abrupt=0;
  for(let i=0;i<ss.length;i++){
    const len=lens[i];
    if(len<Math.max(step*3,med*.45))short++;
    if(len<Math.max(step*2,med*.28))veryShort++;
    if(i){
      const dl=Math.abs(ss[i].low-ss[i-1].low),dh=Math.abs(ss[i].high-ss[i-1].high);
      jitter+=Math.max(0,dl-step*.55)+Math.max(0,dh-step*.55);
      if(dl>step*1.4||dh>step*1.4)abrupt++;
    }
  }
  const rectangular=zoneCellRectangularV17(cell);
  const score=veryShort*15000+short*4500+abrupt*3200+(jitter/step)*650+ss.length*75+(rectangular?0:900);
  return{score,short,veryShort,jitter,abrupt,rows:ss.length,medianRun:med};
}

const zoneModelScoreV17BaseV18=zoneModelScoreV17;
zoneModelScoreV17=function zoneModelScoreV18(model){
  if(!model||!model.cells?.length)return 1e12;
  // Базовая оценка сохраняет предпочтение простых прямоугольных зон.
  let score=zoneModelScoreV17BaseV18(model);
  let rows=0,short=0,veryShort=0,jitter=0;
  for(const c of model.cells){
    const q=cellConstructionStatsV18(c,model);
    score+=q.score; rows+=q.rows; short+=q.short; veryShort+=q.veryShort; jitter+=q.jitter;
  }
  // Слишком много отдельных зон — тоже дополнительная монтажная сложность,
  // но значительно менее важная, чем короткие зубцы.
  score+=model.cells.length*600+rows*35;
  model.installationStatsV18={score,short,veryShort,jitter,rows};
  return score;
};

function routeConstructionStatsV18(route, axis='horizontal'){
  const step=Math.max(50,Number(state.pipeStepMm)||150);
  const pts=cleanPolyline(route||[]);let turns=0,shortMain=0,veryShortMain=0,micro=0,totalMain=0;
  const seg=[];
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y),len=Math.hypot(dx,dy);
    const ori=dx>=dy?'horizontal':'vertical';seg.push({ori,len});
    if(ori===axis){totalMain++;if(len<step*3)shortMain++;if(len<step*2)veryShortMain++;}
  }
  for(let i=1;i<seg.length;i++)if(seg[i].ori!==seg[i-1].ori)turns++;
  for(let i=1;i<seg.length-1;i++){
    // короткий участок, зажатый между двумя поворотами, визуально выглядит как зубец/ступенька.
    if(seg[i].len<step*1.35 && seg[i-1].ori===seg[i+1].ori && seg[i-1].ori!==seg[i].ori)micro++;
  }
  const score=veryShortMain*18000+shortMain*6000+micro*7500+turns*55+routeLength(pts)*.006;
  return{score,turns,shortMain,veryShortMain,micro,totalMain};
}

const fastZoneVariantV172BaseV18=fastZoneVariantV172;
fastZoneVariantV172=function fastZoneVariantV18(cell,fromPoint,inset){
  const vars=bcdVariantsV17(cell,inset)||[];if(!vars.length)return null;
  const axis=cell?.axis||state.zoneEditor.model?.axis||'horizontal';
  vars.sort((a,b)=>{
    const qa=routeConstructionStatsV18(a.points,axis),qb=routeConstructionStatsV18(b.points,axis);
    const da=fromPoint?dist(fromPoint,a.start):0,db=fromPoint?dist(fromPoint,b.start):0;
    // Монтажная простота важнее пары лишних десятков сантиметров подвода.
    return (qa.score+da*.18)-(qb.score+db*.18) || routeLength(a.points)-routeLength(b.points);
  });
  return vars[0]||fastZoneVariantV172BaseV18(cell,fromPoint,inset);
};

const generateConfirmedZonesFastV172BaseV18=generateConfirmedZonesFastV172;
generateConfirmedZonesFastV172=function generateConfirmedZonesFastV18(){
  const z=generateConfirmedZonesFastV172BaseV18();if(!z)return null;
  const q=routeConstructionStatsV18(z.route,z.axis||state.zoneEditor.model?.axis||'horizontal');
  z.installation=q;
  // Не выдаём явно "гребёнчатый" маршрут за хороший. Оператору лучше изменить
  // разбиение/направление, чем получить формально валидную, но плохую монтажную карту.
  const maxShort=Math.max(2,Math.ceil(q.totalMain*.18));
  if(q.veryShortMain>1 || q.shortMain>maxShort || q.micro>3){
    state.rejectedRouteReasons=state.rejectedRouteReasons||[];
    state.rejectedRouteReasons.push(`Маршрут геометрически возможен, но слишком сложен для монтажа: коротких проходов ${q.shortMain}, мелких ступенек ${q.micro}. Попробуйте направление разбиения «Авто» или поверните проходы.`);
    return null;
  }
  return z;
};

const simpleCandidateStatusV172BaseV18=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV18(c){
  if(c?.id==='zones-fast'){
    const q=routeConstructionStatsV18(c.route,c.axis||state.zoneEditor.model?.axis||'horizontal');
    if(q.micro||q.shortMain)return{cls:'warn',text:`Маршрут построен, но есть ${q.shortMain} коротких прохода и ${q.micro} мелких перехода`};
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(!d.bendOK)return{cls:'warn',text:'Регулярная трасса построена; часть разворотов требует проверки радиуса'};
    return{cls:'ok',text:'✓ Монтажно простой маршрут: длинные регулярные проходы'};
  }
  return simpleCandidateStatusV172BaseV18(c);
};

// Переписываем пояснение редактора зон: «Авто» теперь выбирает направление не по
// минимальной длине, а по минимальному числу коротких проходов и рваных границ.
if($('routeSheetHelp'))$('routeSheetHelp').textContent='Режим «Авто» теперь предпочитает монтажно простую раскладку: длинные регулярные проходы, минимум коротких зубцов и лишних разворотов. Если геометрически допустимый маршрут получается слишком рваным, приложение его не показывает.';
if($('zoneEditorSummary'))$('zoneEditorSummary').setAttribute('data-v18','installation-priority');

// ===== v0.19: цельная монотонная раскладка до зон =====
// Если свободная область при сканировании имеет ровно один непрерывный интервал
// в каждом ряду/столбце, делить её на зоны не нужно. Для Г-образной комнаты и
// препятствия, примыкающего к стене, это типичный случай. Строим одну регулярную
// двойную змейку по всей свободной области, а редактор зон используем только
// для настоящих split/merge (островных препятствий и нескольких интервалов).

function monotoneWholeRoomCandidatesV19(limit=4){
  const out=[];
  const step=Math.max(50,Number(state.pipeStepMm)||150);
  for(const axis of ['horizontal','vertical']){
    for(const phase of [0,step*.25,step*.5,step*.75]){
      const model=intervalSweepSegmentsV16(axis,phase,0);
      if(!model||model.lanes.length<4)continue;
      const nonEmpty=model.lanes.filter(l=>l.segments.length);
      if(nonEmpty.length<4)continue;
      // Ключевое условие: никакого разветвления свободной области.
      if(nonEmpty.some(l=>l.segments.length!==1))continue;
      // Пустая полоса внутри диапазона означает разрыв комнаты — такой случай оставляем зонам.
      const first=model.lanes.findIndex(l=>l.segments.length), last=model.lanes.length-1-[...model.lanes].reverse().findIndex(l=>l.segments.length);
      let internalGap=false;for(let i=first;i<=last;i++)if(!model.lanes[i].segments.length){internalGap=true;break;}
      if(internalGap)continue;
      const solved=deterministicDoubleSweepV16(model);
      if(!solved?.route||!validRoute(solved.route)||routeHasRetraceV14(solved.route))continue;
      const q=routeConstructionStatsV18(solved.route,axis), d=physicalDiagnosticsV10(solved.route,'monotone-whole');
      const boundary=boundaryCoverageV15(solved.core||solved.route), crowd=routeCrowdingV14(solved.route);
      if(crowd.bad>0)continue;
      // Регулярность важнее нескольких лишних сантиметров.
      const score=q.score + boundary.penalty*20 + routeLength(solved.route)*.01 + (d.bendOK?0:1400);
      out.push({route:solved.route,core:solved.core||solved.route,axis,phase,score,diagnostics:d,boundary,installation:q});
    }
  }
  out.sort((a,b)=>a.score-b.score);
  const uniq=[];
  for(const x of out){
    if(uniq.some(u=>u.axis===x.axis&&Math.abs(routeLength(u.route)-routeLength(x.route))<120))continue;
    uniq.push(x);if(uniq.length>=limit)break;
  }
  return uniq;
}

function monotoneCandidateV19(){
  const list=monotoneWholeRoomCandidatesV19(3);
  if(!list.length)return null;
  const z=list[0];
  const c=physicalCandidateV10('monotone-whole',z.axis==='horizontal'?'Регулярная двойная змейка':'Вертикальная двойная змейка',
    'Свободная площадь имеет один непрерывный профиль, поэтому приложение строит цельную регулярную трассу без искусственного деления на зоны.',z.route,'цельная сложная форма');
  if(!c)return null;
  c.axis=z.axis;c.diagnostics=z.diagnostics;c.boundary=z.boundary;c.installation=z.installation;
  return c;
}

const createRouteCandidatesV18BaseV19=createRouteCandidatesV8;
createRouteCandidatesV8=function createRouteCandidatesV19(){
  const simpleRect=(!state.shapeType||state.shapeType==='rect')&&state.sections.length===1&&!state.excluded.size&&!(state.obstacles&&state.obstacles.length);
  if(simpleRect)return createRouteCandidatesV18BaseV19()||[];

  // Сначала пробуем цельную монотонную раскладку. Она быстрее, проще и монтажно
  // естественнее, чем разбиение на зоны, когда реального split/merge нет.
  const mono=monotoneCandidateV19();
  if(mono){
    state.rejectedRouteReasons=[];
    return [mono];
  }

  // Только если свободная область действительно разветвляется — используем подтверждённые зоны.
  return createRouteCandidatesV18BaseV19()||[];
};

const simpleCandidateStatusV18BaseV19=simpleCandidateStatusV11;
simpleCandidateStatusV11=function simpleCandidateStatusV19(c){
  if(c?.id==='monotone-whole'){
    const q=c.installation||routeConstructionStatsV18(c.route,c.axis||'horizontal');
    const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.id);
    if(c.needsSplit)return{cls:'warn',text:'Нужно разделить на несколько контуров'};
    if(q.micro||q.veryShortMain)return{cls:'warn',text:'Трасса цельная, но есть локально короткие переходы'};
    if(!d.bendOK)return{cls:'warn',text:'Цельная регулярная трасса построена; часть разворотов требует проверки радиуса'};
    return{cls:'ok',text:'✓ Цельная регулярная трасса без лишнего деления на зоны'};
  }
  return simpleCandidateStatusV18BaseV19(c);
};

// Для монотонной сложной формы редактор зон больше не обязателен: если цельный
// маршрут уже строится, кнопка «Труба» сразу покажет его. Зоны остаются для
// островных препятствий и настоящего ветвления свободного пространства.
const zoneComplexCaseV17BaseV19=zoneComplexCaseV17;
function monotoneGeometryAvailableV19(){return !!monotoneWholeRoomCandidatesV19(1).length;}

if($('routeSheetHelp'))$('routeSheetHelp').textContent='Сначала приложение пытается построить одну цельную регулярную трассу по всей свободной площади. Деление на зоны используется только когда препятствия или форма действительно разрывают проходы.';

// ===== v1.0: новый движок сложной геометрии (Web Worker + несколько контуров) =====
state.enginePlanV1 = null;
state.engineBusyV1 = false;
const resetRouteV1Base = resetRoute;
resetRoute = function resetRouteV100(){
  resetRouteV1Base();
  state.enginePlanV1 = null;
  state.engineBusyV1 = false;
};

function isComplexForEngineV1(){
  return (state.sections?.length||0)>1 || (state.obstacles?.length||0)>0 || state.shapeType==='L' || state.shapeType==='T' || state.shapeType==='custom';
}
function excludedAsObstaclesV1(){
  const out=[]; const g=state.gridStepMm||50;
  for(const k of state.excluded||[]){const [gx,gy]=parseGridKey(k);out.push({x:gx*g,y:gy*g,width:g,height:g});}
  return out;
}
function engineInputV1(){
  collectInputs();
  const supply=state.supply?{...state.supply}:null;
  const ret=state.returnPoint?{...state.returnPoint}:null;
  return {
    sections:(state.sections||[]).map(s=>({x:s.x,y:s.y,width:s.width,height:s.height})),
    obstacles:[...(state.obstacles||[]).map(o=>({x:o.x,y:o.y,width:o.width,height:o.height})),...excludedAsObstaclesV1()],
    supply,returnPoint:ret,collector:supply,collectorSide:supply?.side,
    pipeStepMm:Number(state.pipeStepMm)||150,
    pipeDiameterMm:Number(state.pipeDiameterMm)||16,
    wallOffsetMm:Number(state.wallOffsetMm)||100,
    minBendRadiusMm:Number(state.minBendRadiusMm)||Math.round((Number(state.pipeDiameterMm)||16)*5),
    maxCircuitLengthMm:(Number(state.maxCircuitLengthM)||100)*1000,
  };
}
function runEngineWorkerV1(input){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(`./engine-worker-v120.js?v=2200-${Date.now()}`);
    const timer=setTimeout(()=>{try{worker.terminate();}catch{} reject(new Error('Расчёт занял больше 30 секунд'));},30000);
    worker.onmessage=(e)=>{clearTimeout(timer);worker.terminate();if(!e.data?.ok)reject(new Error(e.data?.error||'Ошибка движка'));else resolve(e.data.result);};
    worker.onerror=(e)=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message||'Ошибка Web Worker'));};
    worker.postMessage(input);
  });
}

function engineCircuitColorsV1(i){return ['#2563eb','#059669','#d97706','#7c3aed','#0891b2','#be123c','#4f46e5','#0f766e'][i%8];}
function enginePlanOverlayV1(){
  const p=state.enginePlanV1;if(!p?.ok||!p.circuits?.length)return '';
  const scale=Math.max(.001,state.scale||.1), sw=pipeStrokeWorldV9(scale), halo=sw+Math.max(2.2/scale,sw*.32);let h='<g class="engine-plan-v1">';
  p.circuits.forEach((c,i)=>{const col=engineCircuitColorsV1(i), parts=[c.supplyTail||[],c.core||c.route||[],c.returnTail||[]].filter(x=>x&&x.length>1);
    for(const part of parts){const d=roundedPathD(part,Math.min(75,(state.pipeStepMm||150)*.45));h+=`<path d="${d}" fill="none" stroke="#fff" stroke-width="${halo}" stroke-linecap="round" stroke-linejoin="round" opacity=".96"/>`+`<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;}
    const arrows=c.core?.length?c.core:(c.route||[]);for(const a of arrowSamples(arrows,4200)){const z=Math.max(3.7/scale,sw*.63);h+=`<g transform="translate(${a.x} ${a.y}) rotate(${a.angle})"><path d="M ${-z} ${-z*.7} L ${z} 0 L ${-z} ${z*.7} Z" fill="${col}" stroke="#fff" stroke-width="${.9/scale}"/></g>`;}
  });
  h+='</g>';return h;
}
const renderPlanV1Base=renderPlan;
renderPlan=function renderPlanV100(){
  renderPlanV1Base();
  const ov=enginePlanOverlayV1();if(ov)planSvg.insertAdjacentHTML('beforeend',ov);
  if(state.enginePlanV1?.ok){const p=state.enginePlanV1,total=(p.totalLength/1000).toFixed(1),parts=p.circuits.map(c=>(c.length/1000).toFixed(1)).join(' + ');$('routeInfo').textContent=`${p.circuits.length} контур${p.circuits.length===1?'':p.circuits.length<5?'а':'ов'} · ${parts} м · всего ${total} м`;}
};

function showEngineResultV1(plan){
  const host=$('routeCandidates');if(!host)return;
  if(!plan?.ok){host.innerHTML=`<div class="route-empty"><strong>Не удалось построить:</strong> ${plan?.error||'неизвестная ошибка'}</div>`;return;}
  const total=(plan.totalLength/1000).toFixed(1), cov=Math.round((plan.coverage||0)*100);
  const isGlobal=plan.planner==='global-scanline',isAdaptive=plan.planner==='adaptive-zones',isMulti=plan.planner==='multi-cell';
  const desc=isMulti
    ? `Multi-cell: свободная площадь разбита на крупные локальные области, в каждой отдельно выбрано направление проходов; области соединены от того же коллектора.`
    : isAdaptive
    ? `Адаптивная укладка: направление проходов выбирается отдельно для частей помещения; контуры балансируются по фактической длине.`
    : isGlobal
      ? `${plan.axis==='horizontal'?'Горизонтальная':'Вертикальная'} глобальная змейка: проходы делятся на контуры с выравниванием их фактической длины.`
      : `Резервный планировщик для геометрии с внутренними островами или разветвлением проходов.`;
  const balPct=plan.circuits.length>1&&plan.balance?Math.round((plan.balance.spread||0)*100):0;
  const q=plan.quality||{}, checked=plan.candidatesChecked||0;
  const qualityBits=[];if(checked)qualityBits.push(`сравнено ${checked} вариант${checked===1?'':checked<5?'а':'ов'}`);if(Number.isFinite(q.bends))qualityBits.push(`поворотов ${q.bends}`);if(q.short)qualityBits.push(`коротких проходов ${q.short}`);
  let html=`<div class="route-card active"><span class="route-card-main"><span class="route-card-title">Лучший план · ${plan.circuits.length} контур${plan.circuits.length===1?'':plan.circuits.length<5?'а':'ов'}</span><span class="route-card-desc">${desc}</span><span class="route-card-status ok">✓ ${qualityBits.length?qualityBits.join(' · ')+' · ':''}${plan.elapsedMs} мс</span></span><span class="route-card-metrics"><span class="route-card-length">${total} м</span><span class="route-card-delta">покрытие ≈ ${cov}%${plan.circuits.length>1?` · разброс ${balPct}%`:''}</span></span></div>`;
  html+=plan.circuits.map((c,i)=>`<div class="route-card"><span class="route-card-main"><span class="route-card-title"><span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${engineCircuitColorsV1(i)};margin-right:7px"></span>Контур ${i+1}</span><span class="route-card-desc">От коллектора → рабочая зона → обратно к коллектору</span></span><span class="route-card-metrics"><span class="route-card-length">${(c.length/1000).toFixed(1)} м</span></span></div>`).join('');
  if(plan.warnings?.length)html+=`<div class="route-empty"><strong>Проверить:</strong><br>${plan.warnings.map(x=>`• ${x}`).join('<br>')}</div>`;
  if(plan.alternatives?.length)html+=`<div class="route-empty"><strong>Также проверены:</strong><br>${plan.alternatives.map(x=>`${x.planner==='multi-cell'?'multi-cell · ':''}${x.axis==='mixed'?'смешанное направление':x.axis==='horizontal'?'горизонтальный':'вертикальный'} · ${x.circuits} контур(а) · ${(x.totalLength/1000).toFixed(1)} м${Number.isFinite(x.bends)?` · поворотов ${x.bends}`:''}`).join('<br>')}</div>`;
  host.innerHTML=html;
  if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent=isMulti?'Декомпозиция → локальные рисунки → соединение областей → балансировка':isAdaptive?'Локальные направления → единый маршрут → балансировка контуров':isGlobal?'Глобальные параллельные проходы → балансировка → возврат к коллектору':'Резервный план для геометрии с разветвлением проходов';
  if($('routeSheetHelp'))$('routeSheetHelp').textContent=isMulti?'Warm сравнил глобальную укладку с multi-cell вариантами. Локальное разбиение выбирается только если оно даёт лучший инженерный результат; количество коллекторов при этом не увеличивается.':isAdaptive?'V2.2 сравнивает несколько глобальных и локально-адаптивных вариантов, включая разные направления вокруг ниш и пристенных препятствий. Лучший валидный план выбирается по покрытию, балансу контуров, числу поворотов, коротким проходам, длине подводок и общей длине трубы.':isGlobal?'Лимит контура теперь используется как верхнее ограничение, а не как цель для первого контура: длинный маршрут делится около равных целевых длин.':'При внутренних островах и сложном разветвлении используется консервативный резервный планировщик.';
}

const legacyGenerateRouteV1 = generateRoute;
async function generateRouteV100(){
  if(!isComplexForEngineV1()){
    // Для простого прямоугольника сохраняем проверенные улитку/змейку предыдущего движка.
    state.enginePlanV1=null;
    return legacyGenerateRouteV1();
  }
  if(!state.supply){setStatus('Сначала укажите коллектор.',true);return;}
  state.engineBusyV1=true;state.enginePlanV1=null;state.route=[];state.routeComplete=false;renderPlan();
  const host=$('routeCandidates');if(host)host.innerHTML='<div class="route-empty"><strong>Строю план…</strong><br>Интерфейс можно продолжать прокручивать: расчёт выполняется отдельно.</div>';
  if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent='Анализ свободной площади и разбиение на контуры';openSheetV5('routeSheet');setStatus('Строю новый план сложной комнаты…');
  try{
    const result=await runEngineWorkerV1(engineInputV1());state.engineBusyV1=false;
    if(!result?.ok){state.enginePlanV1=null;showEngineResultV1(result);setStatus(result?.error||'Новый движок не нашёл корректного плана.',true);renderPlan();return;}
    state.enginePlanV1=result;state.route=[];state.routeKind=`План v1.4.0 · ${result.circuits.length} контур(а)`;state.routeComplete=!result.warnings?.length;showEngineResultV1(result);renderPlan();setStatus(`Готово: ${result.circuits.length} контур(а), всего ${(result.totalLength/1000).toFixed(1)} м. Расчёт ${result.elapsedMs} мс.`);
  }catch(err){state.engineBusyV1=false;state.enginePlanV1=null;showEngineResultV1({ok:false,error:err.message});renderPlan();setStatus(`Ошибка нового движка: ${err.message}`,true);}
}

// Последним обработчиком заменяем накопившуюся цепочку старых генераторов/редактора зон.
const genBtnV100=$('generateBtn');
if(genBtnV100){
  try{genBtnV100.replaceWith(genBtnV100.cloneNode(true));}catch{}
  const fresh=$('generateBtn');fresh?.addEventListener('click',generateRouteV100);
}

// В v1 редактор зон больше не перехватывает касания и не требуется для автоматического плана.
if(state.zoneEditor)state.zoneEditor.active=false;

// ===== V2.0-alpha: touch-first manual route editor =====
// Goals of this alpha:
// 1) keep the automatic plan as an immutable baseline;
// 2) allow parallel dragging of straight pipe runs on a phone;
// 3) allow rough manual strokes that are orthogonalised and snapped;
// 4) keep an independent manual undo/redo stack and basic engineering checks;
// 5) compare Auto / Manual / Overlay without destroying either version.

function clonePointsV2A(points){return (points||[]).map(p=>({x:Number(p.x),y:Number(p.y)}));}
function cloneManualCircuitsV2A(cs){return (cs||[]).map((c,i)=>({id:c.id??i+1,route:clonePointsV2A(c.route||[])}));}
function currentAutoCircuitsV2A(){
  if(state.enginePlanV1?.ok&&state.enginePlanV1.circuits?.length)return state.enginePlanV1.circuits.map((c,i)=>({id:c.id??i+1,route:clonePointsV2A(c.route||c.core||[])})).filter(c=>c.route.length);
  if(state.route?.length)return[{id:1,route:clonePointsV2A(state.route)}];
  return[];
}
function blankManualStateV2A(){return{active:false,view:'manual',tool:'edit',circuits:[],baseline:[],selected:null,undo:[],redo:[],dirty:false,loaded:false,validation:null,currentCircuit:0,detachedTail:null,locked:[]};}
state.manualV2=state.manualV2||blankManualStateV2A();
const manualDragV2A={active:false,pointerId:null,circuit:-1,seg:-1,orientation:null,original:null,changed:false,target:null};
const manualDrawV2A={active:false,pointerId:null,raw:[],preview:[],target:null};

function manualTotalLengthV2A(circuits){return (circuits||[]).reduce((s,c)=>s+routeLength(c.route||[]),0);}
function manualBendsV2A(route){let n=0,last=null;for(let i=1;i<(route?.length||0);i++){const a=route[i-1],b=route[i],dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);if(dx<1&&dy<1)continue;const o=dx>=dy?'h':'v';if(last&&last!==o)n++;last=o;}return n;}
function manualHardRouteV2A(route){
  if(!route||route.length<1)return false;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i];if(Math.abs(a.x-b.x)>1&&Math.abs(a.y-b.y)>1)return false;
    const len=dist(a,b),n=Math.max(2,Math.ceil(len/25));
    for(let k=0;k<=n;k++){
      const t=k/n,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
      if(!insideRoom(x,y,true)||pointExcluded(x,y))return false;
    }
  }
  for(let i=0;i<route.length-1;i++)for(let j=i+2;j<route.length-1;j++){
    if(j===i+1)continue;
    if(segmentsIntersect(route[i],route[i+1],route[j],route[j+1])){
      const shared=dist(route[i+1],route[j])<2||dist(route[i],route[j+1])<2;
      if(!shared)return false;
    }
  }
  return true;
}
function manualSpacingWarningsV2A(route){
  const step=Math.max(50,Number(state.pipeStepMm)||150),minGap=step*.62;let close=0;
  for(let i=0;i<(route?.length||0)-1;i++)for(let j=i+2;j<route.length-1;j++){
    const a=route[i],b=route[i+1],c=route[j],d=route[j+1];
    const h1=Math.abs(a.y-b.y)<1,h2=Math.abs(c.y-d.y)<1;
    if(h1!==h2)continue;
    if(h1){const overlap=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x));if(overlap>40&&Math.abs(a.y-c.y)<minGap)close++;}
    else{const overlap=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y));if(overlap>40&&Math.abs(a.x-c.x)<minGap)close++;}
  }
  return close;
}
function manualInsetWarningsV2A(route){
  if(!route?.length)return 0;const off=Math.max(0,Number(state.wallOffsetMm)||0);if(!off)return 0;let bad=0;
  const supply=state.supply,ret=state.returnPoint;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],len=dist(a,b),n=Math.max(1,Math.ceil(len/80));
    for(let k=0;k<=n;k++){
      const t=k/n,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      if((supply&&dist(p,supply)<Math.max(220,off*1.7))||(ret&&dist(p,ret)<Math.max(220,off*1.7)))continue;
      if(typeof pointAllowedAtInsetV12==='function'&&!pointAllowedAtInsetV12(p.x,p.y,off))bad++;
    }
  }
  return bad;
}
function manualValidateV2A(circuits=state.manualV2.circuits){
  const maxLen=(Number(state.maxCircuitLengthM)||100)*1000;let hard=0,incomplete=0,bendBad=0,spacing=0,inset=0,bends=0,total=0;
  const lengths=[];
  for(const c of circuits||[]){
    const r=c.route||[],L=routeLength(r);lengths.push(L);total+=L;bends+=manualBendsV2A(r);
    if(r.length>1&&!manualHardRouteV2A(r))hard++;
    const end=r[r.length-1];if(!end||!state.returnPoint||dist(end,state.returnPoint)>80)incomplete++;
    if(r.length>2&&typeof cornerRadiusStatsV10==='function')bendBad+=cornerRadiusStatsV10(r,1).bad||0;
    spacing+=manualSpacingWarningsV2A(r);inset+=manualInsetWarningsV2A(r);
    if(L>maxLen+1)hard++;
  }
  const mean=lengths.length?total/lengths.length:0,spread=(lengths.length>1&&mean)?(Math.max(...lengths)-Math.min(...lengths))/mean:0;
  const level=hard?'bad':(incomplete||bendBad||spacing||inset)?'warn':'ok';
  return{level,hard,incomplete,bendBad,spacing,inset,bends,total,lengths,spread};
}
function manualSnapshotV2B(){const m=state.manualV2;return{circuits:cloneManualCircuitsV2A(m.circuits),detachedTail:m.detachedTail?{circuit:m.detachedTail.circuit,points:clonePointsV2A(m.detachedTail.points||[])}:null,locked:[...(m.locked||[])],currentCircuit:m.currentCircuit||0,tool:m.tool||'edit'};}
function manualRestoreSnapshotV2B(snap){const m=state.manualV2;if(Array.isArray(snap)){m.circuits=cloneManualCircuitsV2A(snap);m.detachedTail=null;m.locked=[];return;}m.circuits=cloneManualCircuitsV2A(snap?.circuits||[]);m.detachedTail=snap?.detachedTail?{circuit:snap.detachedTail.circuit,points:clonePointsV2A(snap.detachedTail.points||[])}:null;m.locked=[...(snap?.locked||[])];m.currentCircuit=Math.max(0,Math.min(Number(snap?.currentCircuit)||0,Math.max(0,m.circuits.length-1)));m.tool=snap?.tool||m.tool||'edit';}
function manualPushHistoryV2A(){const m=state.manualV2;m.undo.push(manualSnapshotV2B());if(m.undo.length>60)m.undo.shift();m.redo=[];}
function manualUndoV2A(){const m=state.manualV2;if(!m.undo.length)return;m.redo.push(manualSnapshotV2B());manualRestoreSnapshotV2B(m.undo.pop());m.selected=null;m.dirty=true;manualRefreshV2A();}
function manualRedoV2A(){const m=state.manualV2;if(!m.redo.length)return;m.undo.push(manualSnapshotV2B());manualRestoreSnapshotV2B(m.redo.pop());m.selected=null;m.dirty=true;manualRefreshV2A();}

function manualEnsureV2A(fromBlank=false){
  const m=state.manualV2;if(!Array.isArray(m.locked))m.locked=[];if(!('detachedTail' in m))m.detachedTail=null;
  if(!m.loaded){m.baseline=currentAutoCircuitsV2A();m.circuits=fromBlank?[]:cloneManualCircuitsV2A(m.baseline);m.loaded=true;m.currentCircuit=Math.max(0,m.circuits.length-1);}
  if(fromBlank){m.baseline=m.baseline.length?m.baseline:currentAutoCircuitsV2A();m.circuits=[];m.undo=[];m.redo=[];m.selected=null;m.currentCircuit=0;}
  if(!m.circuits.length&&state.supply)m.circuits=[{id:1,route:[{x:state.supply.x,y:state.supply.y}]}];
  return m;
}
function manualEnterV2A(){
  if(!state.supply){setStatus('Сначала укажите коллектор.',true);return;}
  const m=manualEnsureV2A(false);m.active=true;m.view='manual';m.tool='edit';m.validation=manualValidateV2A();state.mode='manualV2';
  planSvg.classList.add('manual-v2-mode');document.body.classList.add('manual-v2-active');$('manualToolBtn')?.classList.add('active');openSheetV5('manualSheetV2');manualRefreshV2A();setStatus(m.baseline.length?'Ручная копия автоматического плана создана. Авто-план сохранён для сравнения.':'Ручной режим: можно начать контур от коллектора.');
}
function manualExitV2A(){state.manualV2.active=false;state.manualV2.selected=null;state.mode='inspect';planSvg.classList.remove('manual-v2-mode');document.body.classList.remove('manual-v2-active');$('manualToolBtn')?.classList.remove('active');renderPlan();}
function manualSetViewV2A(view){state.manualV2.view=view;manualRefreshV2A();}
function manualSetToolV2A(tool){state.manualV2.tool=tool;state.manualV2.view='manual';state.manualV2.selected=null;manualRefreshV2A();if(window.innerWidth<760)closeSheetV5();const gap=!!state.manualV2.detachedTail;const msg=tool==='draw'?(gap?'Разрыв открыт: рисуйте от синей точки к оранжевой. Палец можно вести приблизительно — Warm выпрямит и привяжет трассу.':'Карандаш: ведите пальцем примерно по желаемому пути. Warm выпрямит жест и привяжет проходы.'):tool==='erase'?'Ластик: коснитесь участка. Трасса разорвётся здесь, а неизменённый хвост останется серым для последующего соединения.':tool==='lock'?'Фиксация: коснитесь прохода, который нельзя менять. Повторное касание снимает фиксацию.':'Правка: коснитесь прямого прохода и тяните его поперёк.';setStatus(msg);}

function manualSummaryHtmlV2A(){
  const m=state.manualV2,v=manualValidateV2A(),auto=manualValidateV2A(m.baseline),manualLen=v.total/1000,autoLen=auto.total/1000;
  const delta=m.baseline.length?manualLen-autoLen:null;
  let msg=`Ручной: <b>${manualLen.toFixed(1)} м</b> · ${v.bends} поворотов`;
  if(v.lengths.length>1)msg+=` · разброс ${Math.round(v.spread*100)}%`;
  if(m.baseline.length)msg+=`<br>Авто: <b>${autoLen.toFixed(1)} м</b> · ${auto.bends} поворотов${delta==null?'':` · ручной ${delta>=0?'+':''}${delta.toFixed(1)} м`}`;
  if(v.hard)msg+=`<br>⛔ Есть геометрическое нарушение или превышение лимита.`;
  else if(v.incomplete)msg+=`<br>⚠ ${v.incomplete} контур(а) ещё не возвращены к обратке.`;
  else if(v.bendBad||v.spacing||v.inset)msg+=`<br>⚠ Проверить: радиусы ${v.bendBad}, тесные интервалы ${v.spacing}, отступы ${v.inset}.`;
  else msg+=`<br>✓ Базовая проверка пройдена.`;
  return{html:msg,level:v.level,v};
}
function manualUpdateUiV2A(){
  const m=state.manualV2,s=manualSummaryHtmlV2A(),sum=$('manualSummaryV2');if(sum){sum.innerHTML=s.html;sum.className=`manual-summary-v2 ${s.level}`;}
  for(const [id,v] of [['manualViewAutoV2','auto'],['manualViewManualV2','manual'],['manualViewOverlayV2','overlay']])$(id)?.classList.toggle('active',m.view===v);
  $('manualEditModeV2')?.classList.toggle('active',m.tool==='edit');$('manualDrawModeV2')?.classList.toggle('active',m.tool==='draw');
  const sel=$('manualSelectionV2');if(sel){if(m.selected){const c=m.circuits[m.selected.circuit],a=c?.route[m.selected.seg],b=c?.route[m.selected.seg+1],o=a&&b?(Math.abs(a.x-b.x)>=Math.abs(a.y-b.y)?'горизонтальный':'вертикальный'):'';sel.textContent=`Выбран контур ${m.selected.circuit+1}, ${o} участок ${m.selected.seg+1}. Тяните поперёк; положение защёлкнется на шаг трубы.`;sel.classList.add('selected');}else{sel.textContent=m.tool==='draw'?'Рисуйте грубо. Линия идёт со смещением от пальца, затем выпрямляется и привязывается.':'Коснитесь прохода трубы, затем тяните его поперёк. На телефоне рабочая точка смещается от пальца.';sel.classList.remove('selected');}}
  $('manualUndoV2')?.toggleAttribute('disabled',!m.undo.length);$('manualRedoV2')?.toggleAttribute('disabled',!m.redo.length);
}
function manualRefreshV2A(){state.manualV2.validation=manualValidateV2A();manualUpdateUiV2A();manualUpdateSideUiV2B();renderPlan();}

function manualPathOverlayV2A(circuits,ghost=false,interactive=false){
  if(!circuits?.length)return'';const sc=Math.max(.001,state.scale||.1),sw=pipeStrokeWorldV9(sc),halo=sw+Math.max(2.2/sc,sw*.32);let h=`<g class="${ghost?'manual-auto-ghost-v2':'manual-route-v2'}">`;
  circuits.forEach((c,ci)=>{const r=c.route||[];if(r.length<1)return;const col=engineCircuitColorsV1(ci);if(r.length>1){const d=roundedPathD(r,Math.min(75,(state.pipeStepMm||150)*.45));h+=`<path class="manual-pipe-visible" d="${d}" fill="none" stroke="#fff" stroke-width="${halo}" stroke-linecap="round" stroke-linejoin="round"/>`+`<path class="manual-pipe-visible" d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;}
    if(interactive&&['edit','erase','lock'].includes(state.manualV2.tool))for(let i=0;i<r.length-1;i++){const a=r[i],b=r[i+1],selected=state.manualV2.selected?.circuit===ci&&state.manualV2.selected?.seg===i;if(selected)h+=`<line class="manual-seg-selected" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${Math.max(sw*1.7,4/sc)}"/>`;h+=`<line class="manual-seg-hit" data-v2-c="${ci}" data-v2-s="${i}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${Math.max(36/sc,sw*4)}"/>`;}
    if(r.length){const e=r[r.length-1];h+=`<circle class="manual-node" cx="${e.x}" cy="${e.y}" r="${Math.max(5/sc,sw*.8)}" fill="${col}" stroke="#fff" stroke-width="${1.5/sc}"/>`;}
  });h+='</g>';return h;
}
function manualPreviewOverlayV2A(){
  if(!manualDrawV2A.active||manualDrawV2A.preview.length<2)return'';const d='M '+manualDrawV2A.preview.map(p=>`${p.x} ${p.y}`).join(' L '),t=manualDrawV2A.target,sc=Math.max(.001,state.scale||.1);return`<g><path class="manual-draw-preview-v2" d="${d}"/><circle class="manual-touch-target-v2" cx="${t?.x||0}" cy="${t?.y||0}" r="${9/sc}"/></g>`;
}
const renderPlanV2ABase=renderPlan;
renderPlan=function renderPlanV2Alpha(){
  const m=state.manualV2;
  if(!m?.active){renderPlanV2ABase();return;}
  const savedRoute=state.route,savedKind=state.routeKind,savedEngine=state.enginePlanV1;
  state.route=[];state.enginePlanV1=null;renderPlanV2ABase();state.route=savedRoute;state.routeKind=savedKind;state.enginePlanV1=savedEngine;
  let ov='';if(m.view==='auto'||m.view==='overlay')ov+=manualPathOverlayV2A(m.baseline,m.view==='overlay',false);if(m.view==='manual'||m.view==='overlay')ov+=manualPathOverlayV2A(m.circuits,false,m.view==='manual');if(m.view!=='auto'){ov+=manualDetachedOverlayV2B();ov+=manualGapEndpointOverlayV2B1();ov+=manualLockedOverlayV2B();}ov+=manualPreviewOverlayV2A();if(ov)planSvg.insertAdjacentHTML('beforeend',ov);
  const v=manualValidateV2A();$('routeInfo').textContent=`Ручной режим · ${m.circuits.length} контур(а) · ${(v.total/1000).toFixed(1)} м${v.level==='ok'?' · проверка ✓':v.level==='bad'?' · ошибка':' · есть предупреждения'}`;
  planSvg.classList.add('manual-v2-mode');
};

function manualScreenPointV2A(e,dx=0,dy=0){const pt=planSvg.createSVGPoint();pt.x=e.clientX+dx;pt.y=e.clientY+dy;const matrix=planSvg.getScreenCTM();if(!matrix)return null;const p=pt.matrixTransform(matrix.inverse());return{x:p.x,y:p.y};}
function manualDragIntentPointV2A(e,ori){const touch=e.pointerType==='touch';const px=touch?54:20;return ori==='h'?manualScreenPointV2A(e,0,-px):manualScreenPointV2A(e,px,0);}
function manualDrawIntentPointV2A(e){return manualScreenPointV2A(e,0,e.pointerType==='touch'?-58:-18);}
function manualLaneSnapV2A(v,axis){const step=Math.max(50,Number(state.pipeStepMm)||150),off=Math.max(0,Number(state.wallOffsetMm)||0),b=state.bounds,base=(axis==='x'?b.minX:b.minY)+off;return base+Math.round((v-base)/step)*step;}
function manualTenSnapV2A(v){return Math.round(v/10)*10;}

function rdpV2A(points,eps){if((points?.length||0)<3)return clonePointsV2A(points);const a=points[0],b=points[points.length-1];let best=-1,idx=-1;for(let i=1;i<points.length-1;i++){const d=pointSegDistV14(points[i],a,b);if(d>best){best=d;idx=i;}}if(best>eps){const l=rdpV2A(points.slice(0,idx+1),eps),r=rdpV2A(points.slice(idx),eps);return[...l.slice(0,-1),...r];}return[{...a},{...b}];}
function manualCleanOrthoV2A(points){
  const out=[];for(const p of points||[]){if(!out.length){out.push({...p});continue;}const q=out[out.length-1];if(dist(p,q)<3)continue;out.push({...p});}
  let changed=true;while(changed&&out.length>2){changed=false;for(let i=1;i<out.length-1;i++){const a=out[i-1],b=out[i],c=out[i+1];if((Math.abs(a.x-b.x)<1&&Math.abs(b.x-c.x)<1)||(Math.abs(a.y-b.y)<1&&Math.abs(b.y-c.y)<1)||dist(a,b)<25||dist(b,c)<25){out.splice(i,1);changed=true;break;}}}return out;
}
function manualOrthogonaliseStrokeV2A(raw,start){
  if(!raw?.length||!start)return[];const step=Math.max(50,Number(state.pipeStepMm)||150),simp=rdpV2A(raw,Math.max(22,step*.18));let out=[{...start}],lastRaw=simp[0];let lastOri=null;
  for(let i=1;i<simp.length;i++){
    const t=simp[i],dx=t.x-lastRaw.x,dy=t.y-lastRaw.y;if(Math.hypot(dx,dy)<Math.max(24,step*.18)){lastRaw=t;continue;}const ori=Math.abs(dx)>=Math.abs(dy)?'h':'v',cur=out[out.length-1];let p;
    if(ori==='h'){
      let y=cur.y;if(lastOri==='v'&&out.length>=3){const prevH=[...out].reverse().find((p0,j,a)=>j<a.length-1&&Math.abs(p0.y-a[j+1].y)<1&&Math.abs(p0.x-a[j+1].x)>1);if(prevH)y=prevH.y+Math.round((t.y-prevH.y)/step)*step;}
      y=manualTenSnapV2A(y);
      // When a new horizontal lane is snapped to the pitch, extend the preceding
      // vertical leg to that exact lane instead of creating a tiny diagonal.
      if(lastOri==='v'&&Math.abs(cur.y-y)>0.5)cur.y=y;
      p={x:manualTenSnapV2A(t.x),y};
    }else{
      let x=cur.x;if(lastOri==='h'&&out.length>=3){const prevV=[...out].reverse().find((p0,j,a)=>j<a.length-1&&Math.abs(p0.x-a[j+1].x)<1&&Math.abs(p0.y-a[j+1].y)>1);if(prevV)x=prevV.x+Math.round((t.x-prevV.x)/step)*step;}
      x=manualTenSnapV2A(x);
      if(lastOri==='h'&&Math.abs(cur.x-x)>0.5)cur.x=x;
      p={x,y:manualTenSnapV2A(t.y)};
    }
    if(dist(cur,p)>=Math.max(30,step*.22))out.push(p);lastOri=ori;lastRaw=t;
  }
  if(out.length===1){const t=raw[raw.length-1],dx=t.x-start.x,dy=t.y-start.y;out.push(Math.abs(dx)>=Math.abs(dy)?{x:manualTenSnapV2A(t.x),y:start.y}:{x:start.x,y:manualTenSnapV2A(t.y)});}
  return manualCleanOrthoV2A(out);
}
function manualSegmentCandidateV2A(ci,si,p){
  const m=state.manualV2,c=m.circuits[ci];if(!c)return null;const r=clonePointsV2A(c.route),a=r[si],b=r[si+1];if(!a||!b)return null;const h=Math.abs(a.y-b.y)<=Math.abs(a.x-b.x);
  if(h){const y=manualLaneSnapV2A(p.y,'y');a.y=y;b.y=y;}else{const x=manualLaneSnapV2A(p.x,'x');a.x=x;b.x=x;}
  return manualCleanOrthoV2A(r);
}

function manualLockKeyV2B(ci,si){return `${ci}:${si}`;}
function manualIsLockedV2B(ci,si){return (state.manualV2.locked||[]).includes(manualLockKeyV2B(ci,si));}
function manualTouchesLockedV2B(ci,si){return [si-1,si,si+1].some(x=>x>=0&&manualIsLockedV2B(ci,x));}
function manualToggleLockV2B(ci,si){
  const m=state.manualV2,key=manualLockKeyV2B(ci,si),set=new Set(m.locked||[]);manualPushHistoryV2A();if(set.has(key)){set.delete(key);setStatus('Фиксация участка снята.');}else{set.add(key);setStatus('Участок зафиксирован. Движение и ластик его не изменят.');}m.locked=[...set];m.dirty=true;manualRefreshV2A();
}
function manualDetachedOverlayV2B(){
  const d=state.manualV2?.detachedTail;if(!d?.points?.length)return'';const sc=Math.max(.001,state.scale||.1),sw=pipeStrokeWorldV9(sc),pts=d.points;if(pts.length<2)return'';const path=roundedPathD(pts,Math.min(75,(state.pipeStepMm||150)*.45));return`<g class="manual-detached-tail-v2b"><path d="${path}" stroke-width="${Math.max(sw,2/sc)}"/></g>`;
}
function manualLockedOverlayV2B(){
  const m=state.manualV2;if(!m?.locked?.length)return'';const sc=Math.max(.001,state.scale||.1),sw=pipeStrokeWorldV9(sc);let h='<g class="manual-locks-v2b">';for(const key of m.locked){const [ci,si]=key.split(':').map(Number),r=m.circuits?.[ci]?.route||[],a=r[si],b=r[si+1];if(!a||!b)continue;h+=`<line class="manual-locked-v2b" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${Math.max(sw*1.35,3/sc)}"/>`;const x=(a.x+b.x)/2,y=(a.y+b.y)/2;h+=`<circle class="manual-lock-mark-v2b" cx="${x}" cy="${y}" r="${5.5/sc}" stroke-width="${1.2/sc}"/>`; }return h+'</g>';
}
function manualEraseSegmentV2B(ci,si){
  const m=manualEnsureV2A(false),c=m.circuits?.[ci],r=c?.route||[];if(!c||si<0||si>=r.length-1)return;if(manualIsLockedV2B(ci,si)){setStatus('Этот участок зафиксирован. Сначала снимите фиксацию.',true);return;}
  manualPushHistoryV2A();const tail=clonePointsV2A(r.slice(si+1));c.route=clonePointsV2A(r.slice(0,si+1));m.detachedTail=tail.length?{circuit:ci,points:tail}:null;m.locked=(m.locked||[]).filter(k=>{const [kc,ks]=k.split(':').map(Number);return kc!==ci||ks<si;});m.currentCircuit=ci;m.selected=null;m.tool='draw';m.dirty=true;manualRefreshV2A();setStatus(tail.length?'Разрыв создан. Синяя точка — начало ручной правки, оранжевая — цель. Рисуйте от синей точки или нажмите «Мост».':'Конец трассы удалён. Продолжайте карандашом от синей точки.');
}
function manualBridgeCandidatesV2B(ci){
  const m=state.manualV2,d=m.detachedTail,c=m.circuits?.[ci];if(!d||d.circuit!==ci||!c?.route?.length||!d.points?.length)return[];const A=c.route[c.route.length-1],B=d.points[0],step=Math.max(50,Number(state.pipeStepMm)||150);const bridges=[];
  const add=pts=>{const br=manualCleanOrthoV2A([A,...pts,B]);const merged=manualCleanOrthoV2A([...clonePointsV2A(c.route),...br.slice(1),...clonePointsV2A(d.points).slice(1)]);if(manualHardRouteV2A(merged))bridges.push({route:merged,bridge:br,length:routeLength(br)});};
  add([{x:B.x,y:A.y}]);add([{x:A.x,y:B.y}]);
  for(const off of [step,-step,step*2,-step*2]){add([{x:A.x+off,y:A.y},{x:A.x+off,y:B.y}]);add([{x:A.x,y:A.y+off},{x:B.x,y:A.y+off}]);}
  bridges.sort((x,y)=>x.length-y.length);return bridges;
}
function manualReconnectGapV2B(push=true){
  const m=state.manualV2,d=m.detachedTail;if(!d){setStatus('Нет вырезанного хвоста для соединения.');return false;}const cs=manualBridgeCandidatesV2B(d.circuit);if(!cs.length){setStatus('Автоматический мост не найден. Дорисуйте путь карандашом ближе к оранжевой точке.',true);return false;}if(push)manualPushHistoryV2A();m.circuits[d.circuit].route=cs[0].route;m.currentCircuit=d.circuit;m.detachedTail=null;m.dirty=true;manualRefreshV2A();setStatus(`Участок соединён автоматически · мост ${(cs[0].length/1000).toFixed(1)} м.`);return true;
}
function manualTryAttachTailV2B(ci){
  const m=state.manualV2,d=m.detachedTail,c=m.circuits?.[ci];if(!d||d.circuit!==ci||!c?.route?.length||!d.points?.length)return false;const A=c.route[c.route.length-1],B=d.points[0],step=Math.max(50,Number(state.pipeStepMm)||150);if(dist(A,B)>Math.max(130,step*1.15))return false;const cs=manualBridgeCandidatesV2B(ci);if(!cs.length)return false;c.route=cs[0].route;m.detachedTail=null;setStatus('Ручной участок защёлкнулся к сохранённому хвосту.');return true;
}

// ===== V2.0-beta.1: reliable drawing after a cut =====
// A cut is an intentionally incomplete intermediate state.  While the gray tail is
// detached we validate only the live blue prefix; the tail becomes part of the hard
// validation again when it is actually reconnected.
function manualGapEndpointsV2B1(){
  const m=state.manualV2,d=m?.detachedTail,c=d?m.circuits?.[d.circuit]:null;
  if(!d||!c?.route?.length||!d.points?.length)return null;
  return{circuit:d.circuit,head:c.route[c.route.length-1],tail:d.points[0]};
}
function manualGapEndpointOverlayV2B1(){
  const g=manualGapEndpointsV2B1();if(!g)return'';const sc=Math.max(.001,state.scale||.1),r=10/sc;
  return `<g class="manual-gap-ends-v2b1"><circle class="manual-gap-head-v2b1" cx="${g.head.x}" cy="${g.head.y}" r="${r}" stroke-width="${2.3/sc}"/><circle class="manual-gap-tail-v2b1" cx="${g.tail.x}" cy="${g.tail.y}" r="${r}" stroke-width="${2.3/sc}"/></g>`;
}
function manualAppendPreserveBaseV2B1(base,add){
  const out=clonePointsV2A(base||[]);if(!out.length)return clonePointsV2A(add||[]);const start=out[out.length-1];
  for(const p of add||[]){if(dist(start,p)<2&&out.length===base.length)continue;const q=out[out.length-1];if(dist(q,p)<3)continue;out.push({...p});}
  return out;
}
function manualDrawVariantsV2B1(ci,add){
  const m=state.manualV2,c=m.circuits?.[ci],base=clonePointsV2A(c?.route||[]);if(!base.length||!add?.length)return[];
  const A=base[base.length-1],T=add[add.length-1],step=Math.max(50,Number(state.pipeStepMm)||150),variants=[];
  const push=(pts,kind)=>{const a=manualCleanOrthoV2A([{...A},...clonePointsV2A(pts)]);if(a.length<2)return;const route=manualAppendPreserveBaseV2B1(base,a);if(manualHardRouteV2A(route))variants.push({route,add:a,kind,length:routeLength(a)});};
  // First respect the user's interpreted stroke exactly.
  push(add.slice(1),'gesture');
  // If the first few touch samples wobble back along the previous pipe, provide
  // deterministic orthogonal fallbacks toward the final intended point.
  push([{x:T.x,y:A.y}],'horizontal');
  push([{x:A.x,y:T.y}],'vertical');
  push([{x:T.x,y:A.y},{x:T.x,y:T.y}],'hv');
  push([{x:A.x,y:T.y},{x:T.x,y:T.y}],'vh');
  // One-pitch doglegs are useful when the direct L-path would touch the old route.
  for(const off of [step,-step]){
    push([{x:A.x+off,y:A.y},{x:A.x+off,y:T.y},{x:T.x,y:T.y}],'dogleg-v');
    push([{x:A.x,y:A.y+off},{x:T.x,y:A.y+off},{x:T.x,y:T.y}],'dogleg-h');
  }
  // Deduplicate by rounded point signature, preserving the gesture candidate first.
  const seen=new Set();return variants.filter(v=>{const k=v.route.map(p=>`${Math.round(p.x)}:${Math.round(p.y)}`).join('|');if(seen.has(k))return false;seen.add(k);return true;});
}
function manualLongestValidPrefixV2B1(ci,add){
  const m=state.manualV2,c=m.circuits?.[ci],base=clonePointsV2A(c?.route||[]);if(!base.length||!add?.length)return null;
  let best=null;
  for(let n=2;n<=add.length;n++){
    const part=manualCleanOrthoV2A(add.slice(0,n));if(part.length<2)continue;const route=manualAppendPreserveBaseV2B1(base,part);
    if(manualHardRouteV2A(route))best={route,add:part,kind:'prefix',length:routeLength(part)};else break;
  }
  return best;
}
function manualCommitDrawV2B1(ci,add){
  const m=state.manualV2,c=m.circuits?.[ci];if(!c||!add?.length||add.length<2)return{ok:false};
  const variants=manualDrawVariantsV2B1(ci,add);let choice=variants[0]||manualLongestValidPrefixV2B1(ci,add);
  if(!choice)return{ok:false};
  manualPushHistoryV2A();c.route=choice.route;m.currentCircuit=ci;m.dirty=true;
  const attached=manualTryAttachTailV2B(ci);
  return{ok:true,attached,partial:choice.kind==='prefix',kind:choice.kind,length:choice.length};
}
function manualDrawStatusV2B1(result){
  if(!result?.ok)return'Не удалось добавить даже первый безопасный участок. Начните движение поперёк последнего синего прохода или используйте «Мост».';
  if(result.attached)return'Разрыв закрыт: ручная трасса соединена с сохранённым хвостом.';
  if(result.partial)return`Добавлена безопасная часть ${(result.length/1000).toFixed(1)} м. Остальная часть жеста остановлена перед препятствием/пересечением — продолжайте следующим жестом.`;
  return`Добавлено ${(result.length/1000).toFixed(1)} м. Продолжайте к оранжевой точке.`;
}
function manualUpdateSideUiV2B(){
  const m=state.manualV2;if(!m)return;for(const [id,t] of [['manualToolMoveV2B','edit'],['manualToolDrawV2B','draw'],['manualToolEraseV2B','erase'],['manualToolLockV2B','lock']])$(id)?.classList.toggle('active',m.tool===t);const cmp=$('manualCompareSideV2B');if(cmp){cmp.classList.toggle('active',m.view!=='manual');const sp=cmp.querySelector('span');if(sp)sp.textContent=m.view==='overlay'?'Налож.':m.view==='auto'?'Авто':'Сравн.';cmp.title=m.view==='manual'?'Показать наложение Auto + Manual':m.view==='overlay'?'Показать только Auto':'Вернуться к ручному варианту';}$('manualBridgeV2B')?.toggleAttribute('disabled',!m.detachedTail);$('manualUndoSideV2B')?.toggleAttribute('disabled',!m.undo?.length);$('manualRedoSideV2B')?.toggleAttribute('disabled',!m.redo?.length);
}

function manualPointerDownV2A(e){
  const m=state.manualV2;if(!m?.active||m.view==='auto')return;
  if(e.button>0)return;
  const hitCi=Number(e.target?.dataset?.v2C),hitSi=Number(e.target?.dataset?.v2S),hasHit=Number.isInteger(hitCi)&&Number.isInteger(hitSi);
  if(m.tool==='erase'){if(!hasHit)return;e.preventDefault();e.stopImmediatePropagation();manualEraseSegmentV2B(hitCi,hitSi);return;}
  if(m.tool==='lock'){if(!hasHit)return;e.preventDefault();e.stopImmediatePropagation();manualToggleLockV2B(hitCi,hitSi);return;}
  if(m.tool==='edit'){
    const ci=hitCi,si=hitSi;if(!hasHit)return;
    e.preventDefault();e.stopImmediatePropagation();if(manualTouchesLockedV2B(ci,si)){setStatus('Этот проход или соседний узел зафиксирован.',true);return;}const r=m.circuits[ci]?.route,a=r?.[si],b=r?.[si+1];if(!a||!b)return;const ori=Math.abs(a.x-b.x)>=Math.abs(a.y-b.y)?'h':'v';m.selected={circuit:ci,seg:si};manualDragV2A.active=true;manualDragV2A.pointerId=e.pointerId;manualDragV2A.circuit=ci;manualDragV2A.seg=si;manualDragV2A.orientation=ori;manualDragV2A.original=clonePointsV2A(r);manualDragV2A.changed=false;try{planSvg.setPointerCapture(e.pointerId)}catch{};manualUpdateUiV2A();manualUpdateSideUiV2B();renderPlan();return;
  }
  if(m.tool==='draw'){
    e.preventDefault();e.stopImmediatePropagation();manualEnsureV2A(false);let ci=Math.min(m.currentCircuit,m.circuits.length-1);if(ci<0){m.circuits=[{id:1,route:[{...state.supply}]}];ci=0;m.currentCircuit=0;}const c=m.circuits[ci];if(!c.route.length)c.route=[{...state.supply}];manualDrawV2A.active=true;manualDrawV2A.pointerId=e.pointerId;manualDrawV2A.raw=[];manualDrawV2A.preview=[];const p=manualDrawIntentPointV2A(e);if(p)manualDrawV2A.raw.push(p);manualDrawV2A.target=p;try{planSvg.setPointerCapture(e.pointerId)}catch{};renderPlan();
  }
}
function manualPointerMoveV2A(e){
  const m=state.manualV2;if(!m?.active)return;
  if(manualDragV2A.active&&e.pointerId===manualDragV2A.pointerId){e.preventDefault();e.stopImmediatePropagation();const p=manualDragIntentPointV2A(e,manualDragV2A.orientation);if(!p)return;manualDragV2A.target=p;const cand=manualSegmentCandidateV2A(manualDragV2A.circuit,manualDragV2A.seg,p);if(!cand)return;const c=m.circuits[manualDragV2A.circuit];if(manualHardRouteV2A(cand)){c.route=cand;manualDragV2A.changed=true;m.dirty=true;renderPlan();}return;}
  if(manualDrawV2A.active&&e.pointerId===manualDrawV2A.pointerId){e.preventDefault();e.stopImmediatePropagation();const p=manualDrawIntentPointV2A(e);if(!p)return;manualDrawV2A.target=p;const last=manualDrawV2A.raw[manualDrawV2A.raw.length-1];if(!last||dist(last,p)>Math.max(8,20/Math.max(.02,state.scale||.1)))manualDrawV2A.raw.push(p);const ci=Math.min(m.currentCircuit,m.circuits.length-1),c=m.circuits[ci],start=c?.route?.[c.route.length-1];manualDrawV2A.preview=manualOrthogonaliseStrokeV2A(manualDrawV2A.raw,start);if(m.detachedTail&&manualDrawV2A.preview.length>1&&c?.route?.length>1){const prev=c.route[c.route.length-2],A=start,P=manualDrawV2A.preview[1],prevH=Math.abs(prev.y-A.y)<=Math.abs(prev.x-A.x),firstH=Math.abs(P.y-A.y)<=Math.abs(P.x-A.x);if(prevH===firstH){const T=manualDrawV2A.preview[manualDrawV2A.preview.length-1];const forced=prevH?{x:A.x,y:manualTenSnapV2A(T.y)}:{x:manualTenSnapV2A(T.x),y:A.y};if(dist(A,forced)>25)manualDrawV2A.preview=manualCleanOrthoV2A([A,forced,...manualDrawV2A.preview.slice(1)]);}}renderPlan();}
}
function manualPointerFinishV2A(e,cancel=false){
  const m=state.manualV2;if(!m?.active)return;
  if(manualDragV2A.active&&e.pointerId===manualDragV2A.pointerId){e.preventDefault();e.stopImmediatePropagation();try{planSvg.releasePointerCapture(e.pointerId)}catch{};const c=m.circuits[manualDragV2A.circuit];if(manualDragV2A.changed){const snap=manualSnapshotV2B();snap.circuits[manualDragV2A.circuit]={id:c.id,route:clonePointsV2A(manualDragV2A.original)};m.undo.push(snap);if(m.undo.length>60)m.undo.shift();m.redo=[];}else if(cancel&&c)c.route=clonePointsV2A(manualDragV2A.original);manualDragV2A.active=false;manualDragV2A.pointerId=null;manualDragV2A.original=null;manualRefreshV2A();return;}
  if(manualDrawV2A.active&&e.pointerId===manualDrawV2A.pointerId){e.preventDefault();e.stopImmediatePropagation();try{planSvg.releasePointerCapture(e.pointerId)}catch{};const ci=Math.min(m.currentCircuit,m.circuits.length-1),c=m.circuits[ci],add=manualDrawV2A.preview;if(!cancel&&c&&add?.length>1){const result=manualCommitDrawV2B1(ci,add);setStatus(manualDrawStatusV2B1(result),!result.ok);}manualDrawV2A.active=false;manualDrawV2A.pointerId=null;manualDrawV2A.raw=[];manualDrawV2A.preview=[];manualDrawV2A.target=null;manualRefreshV2A();}
}
planSvg.addEventListener('pointerdown',manualPointerDownV2A,true);planSvg.addEventListener('pointermove',manualPointerMoveV2A,true);planSvg.addEventListener('pointerup',e=>manualPointerFinishV2A(e,false),true);planSvg.addEventListener('pointercancel',e=>manualPointerFinishV2A(e,true),true);

function manualFinishCurrentCircuitV2A(){
  const m=manualEnsureV2A(false),ci=Math.min(m.currentCircuit,m.circuits.length-1),c=m.circuits[ci];if(!c?.route?.length||!state.returnPoint)return;const last=c.route[c.route.length-1];if(dist(last,state.returnPoint)<80){setStatus('Контур уже возвращён к обратке.');return;}
  const variants=[[last,{x:state.returnPoint.x,y:last.y},state.returnPoint],[last,{x:last.x,y:state.returnPoint.y},state.returnPoint]].map(cleanPolyline);
  const base=clonePointsV2A(c.route);for(const v of variants){const cand=manualCleanOrthoV2A([...base,...v.slice(1)]);if(manualHardRouteV2A(cand)){manualPushHistoryV2A();c.route=cand;m.dirty=true;manualRefreshV2A();setStatus('Контур соединён с обраткой.');return;}}setStatus('Не удалось безопасно соединить конец с обраткой двумя прямыми участками. В beta добавим локальный обход.',true);
}
function manualNewCircuitV2A(){if(!state.supply)return;const m=manualEnsureV2A(false);manualPushHistoryV2A();m.circuits.push({id:m.circuits.length+1,route:[{...state.supply}]});m.currentCircuit=m.circuits.length-1;m.tool='draw';m.selected=null;m.dirty=true;manualRefreshV2A();setStatus(`Контур ${m.currentCircuit+1}: рисуйте от коллектора.`);}
function manualDeleteLastV2A(){const m=manualEnsureV2A(false),c=m.circuits[Math.min(m.currentCircuit,m.circuits.length-1)];if(!c||c.route.length<=1)return;manualPushHistoryV2A();c.route.pop();m.dirty=true;manualRefreshV2A();}
function manualResetAutoV2A(){const m=manualEnsureV2A(false);manualPushHistoryV2A();m.circuits=cloneManualCircuitsV2A(m.baseline);if(!m.circuits.length&&state.supply)m.circuits=[{id:1,route:[{...state.supply}]}];m.currentCircuit=Math.max(0,m.circuits.length-1);m.selected=null;m.dirty=false;manualRefreshV2A();}
function manualStartBlankV2A(){const m=manualEnsureV2A(false);manualPushHistoryV2A();m.circuits=state.supply?[{id:1,route:[{...state.supply}]}]:[];m.currentCircuit=0;m.selected=null;m.tool='draw';m.dirty=true;manualRefreshV2A();}
function manualValidateButtonV2A(){const v=manualValidateV2A();manualRefreshV2A();if(v.level==='ok')setStatus(`Ручной вариант прошёл базовую проверку: ${(v.total/1000).toFixed(1)} м.`);else if(v.level==='bad')setStatus('Есть недопустимая геометрия или превышение длины контура.',true);else setStatus('Геометрия допустима, но есть предупреждения по завершённости, радиусам, шагу или отступам.',true);}

$('manualToolBtn')?.addEventListener('click',manualEnterV2A);
$('manualViewAutoV2')?.addEventListener('click',()=>manualSetViewV2A('auto'));$('manualViewManualV2')?.addEventListener('click',()=>manualSetViewV2A('manual'));$('manualViewOverlayV2')?.addEventListener('click',()=>manualSetViewV2A('overlay'));
$('manualEditModeV2')?.addEventListener('click',()=>manualSetToolV2A('edit'));$('manualDrawModeV2')?.addEventListener('click',()=>manualSetToolV2A('draw'));
$('manualUndoV2')?.addEventListener('click',manualUndoV2A);$('manualRedoV2')?.addEventListener('click',manualRedoV2A);$('manualFinishCircuitV2')?.addEventListener('click',manualFinishCurrentCircuitV2A);$('manualNewCircuitV2')?.addEventListener('click',manualNewCircuitV2A);$('manualDeleteLastV2')?.addEventListener('click',manualDeleteLastV2A);$('manualValidateV2')?.addEventListener('click',manualValidateButtonV2A);$('manualResetAutoV2')?.addEventListener('click',manualResetAutoV2A);$('manualStartBlankV2')?.addEventListener('click',manualStartBlankV2A);$('manualDoneV2')?.addEventListener('click',()=>{manualValidateButtonV2A();closeSheetV5();manualExitV2A();});

// In manual mode the top undo button controls the route, not the room geometry.
$('undoBtn')?.addEventListener('click',e=>{if(!state.manualV2?.active)return;e.preventDefault();e.stopImmediatePropagation();manualUndoV2A();},true);
// Generating a new automatic plan intentionally leaves manual mode and clears the old manual derivative.
$('generateBtn')?.addEventListener('click',()=>{if(state.manualV2?.active)manualExitV2A();state.manualV2=blankManualStateV2A();},true);

// Geometry changes invalidate a derivative manual route.
const resetRouteV2ABase=resetRoute;
resetRoute=function resetRouteV2Alpha(){resetRouteV2ABase();state.manualV2=blankManualStateV2A();};

// Save/load the editable route. Baseline is stored too, so Auto/Manual comparison survives reopening.
const serializeStateV2ABase=serializeState;
serializeState=function serializeStateV2Alpha(){const item=serializeStateV2ABase();const m=state.manualV2;if(m?.loaded&&m.circuits?.length)item.manualPlanV2={circuits:cloneManualCircuitsV2A(m.circuits),baseline:cloneManualCircuitsV2A(m.baseline),dirty:!!m.dirty,detachedTail:m.detachedTail?{circuit:m.detachedTail.circuit,points:clonePointsV2A(m.detachedTail.points||[])}:null,locked:[...(m.locked||[])]};return item;};
const loadSchemeV2ABase=loadScheme;
loadScheme=function loadSchemeV2Alpha(raw){loadSchemeV2ABase(raw);const mp=raw?.manualPlanV2;if(mp?.circuits?.length){state.manualV2=blankManualStateV2A();state.manualV2.circuits=cloneManualCircuitsV2A(mp.circuits);state.manualV2.baseline=cloneManualCircuitsV2A(mp.baseline||[]);state.manualV2.loaded=true;state.manualV2.dirty=!!mp.dirty;state.manualV2.detachedTail=mp.detachedTail?{circuit:mp.detachedTail.circuit,points:clonePointsV2A(mp.detachedTail.points||[])}:null;state.manualV2.locked=[...(mp.locked||[])];state.manualV2.currentCircuit=Math.max(0,state.manualV2.circuits.length-1);}else state.manualV2=blankManualStateV2A();};
const newSchemeV2ABase=newScheme;
newScheme=function newSchemeV2Alpha(){state.manualV2=blankManualStateV2A();return newSchemeV2ABase();};

// Version marker shown even when an old saved scheme is opened.
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.0-beta.1 · свободное дорисовывание'));


// ===== V2.0-beta side toolbar bindings =====
$('manualToolMoveV2B')?.addEventListener('click',()=>manualSetToolV2A('edit'));
$('manualToolDrawV2B')?.addEventListener('click',()=>manualSetToolV2A('draw'));
$('manualToolEraseV2B')?.addEventListener('click',()=>manualSetToolV2A('erase'));
$('manualToolLockV2B')?.addEventListener('click',()=>manualSetToolV2A('lock'));
$('manualBridgeV2B')?.addEventListener('click',()=>manualReconnectGapV2B(true));
$('manualCompareSideV2B')?.addEventListener('click',()=>{const v=state.manualV2.view;manualSetViewV2A(v==='manual'?'overlay':v==='overlay'?'auto':'manual');});
$('manualUndoSideV2B')?.addEventListener('click',manualUndoV2A);
$('manualRedoSideV2B')?.addEventListener('click',manualRedoV2A);
$('manualDoneSideV2B')?.addEventListener('click',()=>{manualValidateButtonV2A();closeSheetV5();manualExitV2A();});
// Alpha opens a bottom sheet on entry. Beta immediately returns the canvas to the user;
// detailed comparison remains available by tapping "Правка" again while already active.
$('manualToolBtn')?.addEventListener('click',()=>{if(state.manualV2?.active)setTimeout(()=>{closeSheetV5();manualUpdateSideUiV2B();},0);});
manualUpdateSideUiV2B();

// ===== V2.0 final: intent drawing, zone fill, local rebuild, locked recalculation, rich comparison =====
const manualZoneGestureV20={active:false,pointerId:null,raw:[],targetRect:null,axis:null};

function manualSegOrientationV20(a,b){return Math.abs((b?.x||0)-(a?.x||0))>=Math.abs((b?.y||0)-(a?.y||0))?'h':'v';}
function manualSegDirV20(a,b){const o=manualSegOrientationV20(a,b);return o==='h'?Math.sign((b?.x||0)-(a?.x||0)):Math.sign((b?.y||0)-(a?.y||0));}
function manualUTurnsV20(route){let n=0;for(let i=0;i<(route?.length||0)-3;i++){const a=route[i],b=route[i+1],c=route[i+2],d=route[i+3];const o1=manualSegOrientationV20(a,b),o2=manualSegOrientationV20(b,c),o3=manualSegOrientationV20(c,d);if(o1===o3&&o1!==o2&&manualSegDirV20(a,b)*manualSegDirV20(c,d)<0)n++;}return n;}
function manualShortPassesV20(route){const step=Math.max(50,Number(state.pipeStepMm)||150),lim=Math.max(600,step*4);let n=0;for(let i=1;i<(route?.length||0);i++){const L=dist(route[i-1],route[i]);if(L>40&&L<lim)n++;}return n;}
function manualCollectorLeadV20(route){if(!route?.length)return 0;const rad=Math.max(650,(Number(state.pipeStepMm)||150)*4.2),s=state.supply,r=state.returnPoint;let L=0;for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if((s&&dist(m,s)<rad)||(r&&dist(m,r)<rad))L+=dist(a,b);}return L;}
function manualMinRadiusV20(circuits){let min=Infinity,bad=0;for(const c of circuits||[]){const q=typeof cornerRadiusStatsV10==='function'?cornerRadiusStatsV10(c.route||[],1):null;if(q){if(Number.isFinite(q.minR))min=Math.min(min,q.minR);bad+=q.bad||0;}}return{minR:min,bad};}
function manualFreeAreaV20(){let a=0;for(const s of state.sections||[])a+=Math.max(0,s.width)*Math.max(0,s.height);for(const o of state.obstacles||[])a-=Math.max(0,o.width)*Math.max(0,o.height);a-=(state.excluded?.size||0)*Math.pow(state.gridStepMm||50,2);return Math.max(1,a);}
function manualCoverageV20(circuits){
  const segs=[];for(const c of circuits||[])for(let i=1;i<(c.route?.length||0);i++)segs.push([c.route[i-1],c.route[i]]);if(!segs.length)return 0;
  const b=state.bounds||boundsOfSections(state.sections||[]),step=Math.max(50,Number(state.pipeStepMm)||150),sample=Math.max(100,Math.min(180,step*.8)),off=Math.max(0,Number(state.wallOffsetMm)||0);let free=0,cov=0;
  const nx=Math.max(1,Math.ceil((b.maxX-b.minX)/sample)),ny=Math.max(1,Math.ceil((b.maxY-b.minY)/sample)),scale=Math.max(1,Math.ceil(Math.sqrt((nx*ny)/2600)));
  for(let y=b.minY+sample*.5;y<=b.maxY;y+=sample*scale)for(let x=b.minX+sample*.5;x<=b.maxX;x+=sample*scale){if(!insideRoom(x,y,true)||pointExcluded(x,y))continue;if(typeof pointAllowedAtInsetV12==='function'&&off>0&&!pointAllowedAtInsetV12(x,y,off))continue;free++;let md=Infinity;for(const [a,c] of segs){const d=pointSegDistV14({x,y},a,c);if(d<md)md=d;if(md<=step*.62)break;}if(md<=step*.62)cov++;}
  return free?cov/free:0;
}
function manualRouteMetricsV20(circuits){const v=manualValidateV2A(circuits),rad=manualMinRadiusV20(circuits);let u=0,short=0,lead=0;for(const c of circuits||[]){u+=manualUTurnsV20(c.route||[]);short+=manualShortPassesV20(c.route||[]);lead+=manualCollectorLeadV20(c.route||[]);}return{...v,coverage:manualCoverageV20(circuits),uTurns:u,short,lead,minR:rad.minR,radiusBad:rad.bad,violations:v.hard+v.spacing+v.inset+rad.bad};}
function manualFmtRadiusV20(v){return Number.isFinite(v)?`${Math.round(v)} мм`:'—';}
function manualDeltaClassV20(a,b,lowerBetter=true){if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)<1e-6)return'';const better=lowerBetter?a<b:a>b;return better?'better':'worse';}
function manualCompareHtmlV20(){
  const m=state.manualV2;if(!m?.baseline?.length)return'<div>Автоматический вариант ещё не построен.</div>';const A=manualRouteMetricsV20(m.baseline),M=manualRouteMetricsV20(m.circuits),pct=x=>`${Math.round(x*100)}%`,fm=x=>`${(x/1000).toFixed(1)} м`;
  const rows=[
    ['Длина',fm(A.total),fm(M.total),manualDeltaClassV20(M.total,A.total,true)],
    ['Покрытие',pct(A.coverage),pct(M.coverage),manualDeltaClassV20(M.coverage,A.coverage,false)],
    ['Контуры',String(A.lengths.length),String(M.lengths.length),manualDeltaClassV20(M.lengths.length,A.lengths.length,true)],
    ['Разброс длин',pct(A.spread),pct(M.spread),manualDeltaClassV20(M.spread,A.spread,true)],
    ['U-развороты',String(A.uTurns),String(M.uTurns),manualDeltaClassV20(M.uTurns,A.uTurns,true)],
    ['Короткие участки',String(A.short),String(M.short),manualDeltaClassV20(M.short,A.short,true)],
    ['Подводки у коллектора',fm(A.lead),fm(M.lead),manualDeltaClassV20(M.lead,A.lead,true)],
    ['Мин. радиус',manualFmtRadiusV20(A.minR),manualFmtRadiusV20(M.minR),manualDeltaClassV20(M.minR,A.minR,false)],
    ['Нарушения',String(A.violations),String(M.violations),manualDeltaClassV20(M.violations,A.violations,true)],
  ];
  let h='<div class="manual-compare-grid-v20"><div class="head">Показатель</div><div class="head">Авто</div><div class="head">Ручной</div>';for(const [n,a,b,c] of rows)h+=`<div class="metric">${n}</div><div>${a}</div><div class="${c}">${b}</div>`;return h+'</div>';
}
function manualUpdateCompareV20(){const el=$('manualCompareDetailsV20');if(!el)return;el.innerHTML=manualCompareHtmlV20();el.classList.toggle('open',!!state.manualV2?.active);}

const manualUpdateUiV2ABaseFinal=manualUpdateUiV2A;
manualUpdateUiV2A=function manualUpdateUiV20(){manualUpdateUiV2ABaseFinal();const m=state.manualV2;$('manualZoneModeV20')?.classList.toggle('active',m?.tool==='zone');manualUpdateCompareV20();};
const manualUpdateSideUiV2BBaseFinal=manualUpdateSideUiV2B;
manualUpdateSideUiV2B=function manualUpdateSideUiV20(){manualUpdateSideUiV2BBaseFinal();const m=state.manualV2;$('manualToolZoneV20')?.classList.toggle('active',m?.tool==='zone');$('manualRebuildV20')?.toggleAttribute('disabled',!(m?.detachedTail||m?.selected));$('manualRecalcUnlockedV20')?.toggleAttribute('disabled',!(m?.locked?.length));};
const manualSetToolV2ABaseFinal=manualSetToolV2A;
manualSetToolV2A=function manualSetToolV20(tool){manualSetToolV2ABaseFinal(tool);if(tool==='zone')setStatus('Зона: проведите пальцем внутри нужной свободной области в направлении будущих проходов. Warm выберет локальную область и заполнит её с текущим шагом.');};

function manualRegularizePitchV20(route){
  const r=clonePointsV2A(route||[]),step=Math.max(50,Number(state.pipeStepMm)||150);if(r.length<4)return r;
  for(let i=0;i<r.length-3;i++){
    const a=r[i],b=r[i+1],c=r[i+2],d=r[i+3],o1=manualSegOrientationV20(a,b),o2=manualSegOrientationV20(b,c),o3=manualSegOrientationV20(c,d);if(o1!==o3||o1===o2||manualSegDirV20(a,b)*manualSegDirV20(c,d)>=0)continue;
    if(o1==='h'){const target=b.y+Math.round((c.y-b.y)/step)*step;if(Math.abs(target-b.y)>=step*.55&&Math.abs(target-b.y)<=step*3.5){c.y=target;d.y=target;}}
    else{const target=b.x+Math.round((c.x-b.x)/step)*step;if(Math.abs(target-b.x)>=step*.55&&Math.abs(target-b.x)<=step*3.5){c.x=target;d.x=target;}}
  }
  return manualCleanOrthoV2A(r);
}
const manualOrthogonaliseStrokeV2ABaseFinal=manualOrthogonaliseStrokeV2A;
manualOrthogonaliseStrokeV2A=function manualOrthogonaliseStrokeV20(raw,start){return manualRegularizePitchV20(manualOrthogonaliseStrokeV2ABaseFinal(raw,start));};

function manualPointAllowedV20(x,y){if(!insideRoom(x,y,true)||pointExcluded(x,y))return false;const off=Math.max(0,Number(state.wallOffsetMm)||0);if(typeof pointAllowedAtInsetV12==='function'&&off>0&&!pointAllowedAtInsetV12(x,y,off))return false;return true;}
function manualLineSpanV20(rect,axis,q){const ds=25,vals=[];if(axis==='horizontal'){for(let x=rect.x;x<=rect.x+rect.width+1;x+=ds)if(manualPointAllowedV20(x,q))vals.push(x);}else{for(let y=rect.y;y<=rect.y+rect.height+1;y+=ds)if(manualPointAllowedV20(q,y))vals.push(y);}if(!vals.length)return null;let best=null,s=vals[0],prev=vals[0];for(let i=1;i<=vals.length;i++){const v=vals[i];if(i===vals.length||v-prev>ds*1.6){const seg=[s,prev];if(!best||seg[1]-seg[0]>best[1]-best[0])best=seg;s=v;}prev=v;}return best;}
function manualZoneAxisV20(raw){if(!raw?.length)return'horizontal';const a=raw[0],b=raw[raw.length-1];return Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?'horizontal':'vertical';}
function manualZoneRectV20(raw,axis){if(!raw?.length)return null;const a=raw[0],b=raw[raw.length-1],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};let rects=[];try{rects=globalThis.UFHEngine?._internals?.decomposeFreeRectsV6?.(engineInputV1(),axis)||[];}catch{}if(!rects.length)return null;const inside=rects.filter(r=>mid.x>=r.x&&mid.x<=r.x+r.width&&mid.y>=r.y&&mid.y<=r.y+r.height);if(inside.length)return inside.sort((x,y)=>x.width*x.height-y.width*y.height)[0];return rects.sort((x,y)=>{const cx=x.x+x.width/2,cy=x.y+x.height/2,dx=cx-mid.x,dy=cy-mid.y;const ex=y.x+y.width/2,ey=y.y+y.height/2;return dx*dx+dy*dy-((ex-mid.x)**2+(ey-mid.y)**2);})[0];}
function manualZoneCoreVariantsV20(rect,axis){
  const step=Math.max(50,Number(state.pipeStepMm)||150),off=Math.max(35,Math.min(Number(state.wallOffsetMm)||100,step*.7)),lanes=[];
  if(axis==='horizontal')for(let q=rect.y+off;q<=rect.y+rect.height-off+1;q+=step){const sp=manualLineSpanV20(rect,axis,q);if(sp&&sp[1]-sp[0]>Math.max(350,step*2.4))lanes.push({q,a:sp[0],b:sp[1]});}
  else for(let q=rect.x+off;q<=rect.x+rect.width-off+1;q+=step){const sp=manualLineSpanV20(rect,axis,q);if(sp&&sp[1]-sp[0]>Math.max(350,step*2.4))lanes.push({q,a:sp[0],b:sp[1]});}
  const variants=[];for(const rev of [false,true])for(const startHigh of [false,true]){const ls=rev?[...lanes].reverse():[...lanes],pts=[];let high=startHigh;for(const l of ls){const A=axis==='horizontal'?{x:l.a,y:l.q}:{x:l.q,y:l.a},B=axis==='horizontal'?{x:l.b,y:l.q}:{x:l.q,y:l.b},s=high?B:A,e=high?A:B;if(!pts.length)pts.push(s,e);else{const p=pts[pts.length-1];if(axis==='horizontal'){if(Math.abs(p.x-s.x)>1)pts.push({x:s.x,y:p.y});pts.push(s,e);}else{if(Math.abs(p.y-s.y)>1)pts.push({x:p.x,y:s.y});pts.push(s,e);}}high=!high;}const clean=manualCleanOrthoV2A(pts);if(clean.length>1)variants.push(clean);}return variants;
}
function manualConnectorVariantsV20(A,B){const step=Math.max(50,Number(state.pipeStepMm)||150),out=[];const add=p=>out.push(manualCleanOrthoV2A([A,...p,B]));add([{x:B.x,y:A.y}]);add([{x:A.x,y:B.y}]);for(const k of [1,-1,2,-2,3,-3]){add([{x:A.x+k*step,y:A.y},{x:A.x+k*step,y:B.y}]);add([{x:A.x,y:A.y+k*step},{x:B.x,y:A.y+k*step}]);}return out.filter(x=>x.length>1);}
function manualSimpleRouteScoreV20(route){const q=manualValidateV2A([{id:1,route}]);return routeLength(route)+manualBendsV2A(route)*65+manualUTurnsV20(route)*110+manualShortPassesV20(route)*240+q.spacing*1400+q.inset*1700+q.bendBad*8000+q.hard*1e9;}
function manualAppendZoneV20(raw){
  const m=manualEnsureV2A(false),ci=Math.min(m.currentCircuit,m.circuits.length-1),c=m.circuits[ci];if(!c?.route?.length)return false;const axis=manualZoneAxisV20(raw),rect=manualZoneRectV20(raw,axis);if(!rect){setStatus('Не удалось определить свободную локальную зону.',true);return false;}const cores=manualZoneCoreVariantsV20(rect,axis);if(!cores.length){setStatus('В выбранной области недостаточно места для регулярных проходов.',true);return false;}const base=clonePointsV2A(c.route),A=base[base.length-1],cand=[];
  for(const core of cores){for(const conn of manualConnectorVariantsV20(A,core[0])){const route=manualCleanOrthoV2A([...base,...conn.slice(1),...core.slice(1)]);if(manualHardRouteV2A(route))cand.push({route,score:manualSimpleRouteScoreV20(route),axis,rect});}}
  if(!cand.length){setStatus('Зона распознана, но от активного конца к ней нет безопасного соединения. При необходимости сначала удалите мешающий участок.',true);return false;}cand.sort((a,b)=>a.score-b.score);manualPushHistoryV2A();c.route=cand[0].route;m.currentCircuit=ci;m.dirty=true;const attached=manualTryAttachTailV2B(ci);manualRefreshV2A();setStatus(`Зона заполнена ${axis==='horizontal'?'горизонтально':'вертикально'} · сравнено ${cand.length} вариантов${attached?' · разрыв закрыт':''}.`);return true;
}
function manualZonePreviewV20(){if(!manualZoneGestureV20.active||manualZoneGestureV20.raw.length<2)return'';const raw=manualZoneGestureV20.raw,axis=manualZoneAxisV20(raw),rect=manualZoneRectV20(raw,axis),a=raw[0],b=raw[raw.length-1],sc=Math.max(.001,state.scale||.1);let h='<g class="manual-zone-v20">';if(rect)h+=`<rect class="manual-zone-preview-v20" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}"/>`;h+=`<line class="manual-zone-arrow-v20" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;const ang=Math.atan2(b.y-a.y,b.x-a.x),r=12/sc,p1={x:b.x-Math.cos(ang-.55)*r,y:b.y-Math.sin(ang-.55)*r},p2={x:b.x-Math.cos(ang+.55)*r,y:b.y-Math.sin(ang+.55)*r};h+=`<path class="manual-zone-arrow-tip-v20" d="M ${b.x} ${b.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z"/>`;return h+'</g>';}
const manualPreviewOverlayV2ABaseFinal=manualPreviewOverlayV2A;
manualPreviewOverlayV2A=function manualPreviewOverlayV20(){return manualPreviewOverlayV2ABaseFinal()+manualZonePreviewV20();};

function manualZonePointerDownV20(e){const m=state.manualV2;if(!m?.active||m.tool!=='zone'||m.view==='auto'||e.button>0)return;e.preventDefault();e.stopImmediatePropagation();const p=manualDrawIntentPointV2A(e);if(!p)return;manualZoneGestureV20.active=true;manualZoneGestureV20.pointerId=e.pointerId;manualZoneGestureV20.raw=[p];try{planSvg.setPointerCapture(e.pointerId)}catch{};renderPlan();}
function manualZonePointerMoveV20(e){if(!manualZoneGestureV20.active||e.pointerId!==manualZoneGestureV20.pointerId)return;e.preventDefault();e.stopImmediatePropagation();const p=manualDrawIntentPointV2A(e),last=manualZoneGestureV20.raw.at(-1);if(p&&(!last||dist(last,p)>25))manualZoneGestureV20.raw.push(p);renderPlan();}
function manualZonePointerFinishV20(e,cancel=false){if(!manualZoneGestureV20.active||e.pointerId!==manualZoneGestureV20.pointerId)return;e.preventDefault();e.stopImmediatePropagation();try{planSvg.releasePointerCapture(e.pointerId)}catch{};const raw=clonePointsV2A(manualZoneGestureV20.raw);manualZoneGestureV20.active=false;manualZoneGestureV20.pointerId=null;manualZoneGestureV20.raw=[];if(!cancel&&raw.length>1)manualAppendZoneV20(raw);else renderPlan();}
planSvg.addEventListener('pointerdown',manualZonePointerDownV20,true);planSvg.addEventListener('pointermove',manualZonePointerMoveV20,true);planSvg.addEventListener('pointerup',e=>manualZonePointerFinishV20(e,false),true);planSvg.addEventListener('pointercancel',e=>manualZonePointerFinishV20(e,true),true);

function manualBridgeCandidatesV20(ci){
  const m=state.manualV2,d=m.detachedTail,c=m.circuits?.[ci];if(!d||d.circuit!==ci||!c?.route?.length||!d.points?.length)return[];const A=c.route.at(-1),B=d.points[0],base=clonePointsV2A(c.route),tail=clonePointsV2A(d.points),step=Math.max(50,Number(state.pipeStepMm)||150),out=[];
  const push=mid=>{const br=manualCleanOrthoV2A([A,...mid,B]),merged=manualCleanOrthoV2A([...base,...br.slice(1),...tail.slice(1)]);if(manualHardRouteV2A(merged))out.push({route:merged,bridge:br,score:manualSimpleRouteScoreV20(merged),length:routeLength(br)});};
  push([]);push([{x:B.x,y:A.y}]);push([{x:A.x,y:B.y}]);for(let k=1;k<=6;k++)for(const s of [1,-1]){const o=k*s*step;push([{x:A.x+o,y:A.y},{x:A.x+o,y:B.y}]);push([{x:A.x,y:A.y+o},{x:B.x,y:A.y+o}]);push([{x:A.x+o,y:A.y},{x:A.x+o,y:B.y-o},{x:B.x,y:B.y-o}]);push([{x:A.x,y:A.y+o},{x:B.x-o,y:A.y+o},{x:B.x-o,y:B.y}]);}
  const seen=new Set();return out.filter(x=>{const k=x.route.map(p=>`${Math.round(p.x)}:${Math.round(p.y)}`).join('|');if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.score-b.score);
}
function manualLocalRebuildV20(){
  const m=state.manualV2;if(m.detachedTail){const ci=m.detachedTail.circuit,cs=manualBridgeCandidatesV20(ci);if(!cs.length){setStatus('Для разрыва не найден допустимый локальный обход.',true);return false;}manualPushHistoryV2A();m.circuits[ci].route=cs[0].route;m.detachedTail=null;m.currentCircuit=ci;m.dirty=true;m.lastRebuildAlternatives=cs.length;manualRefreshV2A();setStatus(`Локальный участок A→B перестроен · сравнено ${cs.length} вариантов · мост ${(cs[0].length/1000).toFixed(1)} м.`);return true;}
  const s=m.selected;if(!s){setStatus('Сначала выберите участок или создайте разрыв ластиком.');return false;}if(manualTouchesLockedV2B(s.circuit,s.seg)){setStatus('Выбранный участок примыкает к зафиксированной части.',true);return false;}const c=m.circuits[s.circuit],r=clonePointsV2A(c?.route||[]),A=r[s.seg],B=r[s.seg+1];if(!A||!B)return false;const step=Math.max(50,Number(state.pipeStepMm)||150),prefix=r.slice(0,s.seg+1),suffix=r.slice(s.seg+1),out=[];
  const push=mid=>{const br=manualCleanOrthoV2A([A,...mid,B]),route=manualCleanOrthoV2A([...prefix,...br.slice(1),...suffix.slice(1)]);if(manualHardRouteV2A(route)){const same=route.length===r.length&&route.every((p,i)=>dist(p,r[i])<2);if(!same)out.push({route,score:manualSimpleRouteScoreV20(route)});}};
  for(let k=1;k<=5;k++)for(const sg of [1,-1]){const o=k*sg*step;if(manualSegOrientationV20(A,B)==='h')push([{x:A.x,y:A.y+o},{x:B.x,y:A.y+o}]);else push([{x:A.x+o,y:A.y},{x:A.x+o,y:B.y}]);}
  if(!out.length){setStatus('Для выбранного прохода нет более подходящего локального обхода.');return false;}out.sort((a,b)=>a.score-b.score);manualPushHistoryV2A();c.route=out[0].route;m.selected=null;m.dirty=true;m.lastRebuildAlternatives=out.length;manualRefreshV2A();setStatus(`Выбранный участок перестроен · сравнено ${out.length} допустимых вариантов.`);return true;
}

function manualRecalcUnlockedV20(){
  const m=state.manualV2;if(!m?.locked?.length){setStatus('Сначала зафиксируйте хотя бы один хороший участок.');return false;}if(m.detachedTail){setStatus('Сначала закройте текущий разрыв — вручную или «Перестроить A→B».',true);return false;}manualPushHistoryV2A();let changed=0,skipped=0;const next=cloneManualCircuitsV2A(m.circuits);
  for(let ci=0;ci<next.length;ci++){const cur=next[ci]?.route||[],base=m.baseline?.[ci]?.route||[];if(!base.length||base.length!==cur.length){skipped++;continue;}const keep=new Set();for(const key of m.locked||[]){const [kc,ks]=key.split(':').map(Number);if(kc!==ci)continue;for(const pi of [ks-1,ks,ks+1,ks+2])if(pi>=0&&pi<cur.length)keep.add(pi);}const cand=cur.map((p,i)=>keep.has(i)?{...p}:{...base[i]});if(manualHardRouteV2A(cand)){next[ci].route=cand;changed++;}else skipped++;}
  if(!changed){m.undo.pop();setStatus('Незакреплённые участки структурно отличаются от Auto; безопасный автоматический возврат невозможен. Используйте локальное A→B.',true);return false;}m.circuits=next;m.dirty=true;m.selected=null;manualRefreshV2A();setStatus(`Пересчитано незакреплённых частей: ${changed}${skipped?` · ${skipped} контур(а) оставлены без изменений`:''}. Зафиксированные проходы сохранены.`);return true;
}

// Protect locked endpoints from erase too.
const manualEraseSegmentV2BBaseFinal=manualEraseSegmentV2B;
manualEraseSegmentV2B=function manualEraseSegmentV20(ci,si){if(manualTouchesLockedV2B(ci,si)){setStatus('Этот участок примыкает к зафиксированной части. Сначала снимите фиксацию.',true);return;}return manualEraseSegmentV2BBaseFinal(ci,si);};

$('manualToolZoneV20')?.addEventListener('click',()=>manualSetToolV2A('zone'));
$('manualZoneModeV20')?.addEventListener('click',()=>manualSetToolV2A('zone'));
$('manualRebuildV20')?.addEventListener('click',manualLocalRebuildV20);
$('manualRebuildSheetV20')?.addEventListener('click',manualLocalRebuildV20);
$('manualRecalcUnlockedV20')?.addEventListener('click',manualRecalcUnlockedV20);
$('manualRecalcSheetV20')?.addEventListener('click',manualRecalcUnlockedV20);

// Reclaim the bottom sheet as the detailed Auto/Manual comparison when the user taps "Правка" again.
$('manualToolBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(state.manualV2?.active){openSheetV5('manualSheetV2');manualUpdateCompareV20();}else manualEnterV2A();},true);

// Final comparison view opens the details sheet when cycling back from Auto.
$('manualCompareSideV2B')?.addEventListener('dblclick',e=>{e.preventDefault();openSheetV5('manualSheetV2');manualUpdateCompareV20();});

// Save/load final state additions without changing the project format for older versions.
const serializeStateV20Base=serializeState;
serializeState=function serializeStateV20(){const item=serializeStateV20Base();if(item.manualPlanV2)item.manualPlanV2.finalVersion='2.0';return item;};

// Version marker shown even when an older saved scheme is opened.
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.0 · ручной + автоматический режим'));
manualUpdateCompareV20();manualUpdateSideUiV2B();

// V2.0 final uses the richer A→B candidate set for the existing "Мост" action
// and for automatic tail snapping after manual drawing.
manualBridgeCandidatesV2B=manualBridgeCandidatesV20;

// ===== V2.1-alpha: professional drawing + length-driven circuit count =====
// The renderer is intentionally independent from the route planner: V2.1-alpha
// changes the engineering presentation and only changes the planner choice for a
// simple rectangle when the actually generated single loop exceeds the user's
// maximum circuit length. A small rectangle remains one continuous circuit.

if(!Number.isFinite(state.fastenerStepMm))state.fastenerStepMm=500;
if(!state.layoutSchemeV21)state.layoutSchemeV21='auto';
if(typeof state.showFastenersV21!=='boolean')state.showFastenersV21=true;

function engineeringRoutePointAtV21(points,target){
  if(!points?.length)return null;if(target<=0)return{...points[0],angle:0};let d=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=dist(a,b);if(d+l>=target){const t=l?Math.max(0,Math.min(1,(target-d)/l)):0;return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};}d+=l;}
  const a=points[Math.max(0,points.length-2)],b=points[points.length-1];return{x:b.x,y:b.y,angle:Math.atan2(b.y-a.y,b.x-a.x)};
}
function engineeringSplitRouteV21(points,fraction=.5){
  const total=routeLength(points||[]);if(!points?.length||total<=0)return[clonePointsV2A(points||[]),[]];const cut=total*Math.max(.05,Math.min(.95,fraction));let d=0,left=[{...points[0]}],right=[];
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=dist(a,b);if(!right.length&&d+l>=cut){const t=l?Math.max(0,Math.min(1,(cut-d)/l)):0,m={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(dist(left.at(-1),m)>1)left.push(m);right=[{...m}];if(dist(m,b)>1)right.push({...b});}else if(right.length)right.push({...b});else left.push({...b});d+=l;}
  if(!right.length)right=[{...left.at(-1)}];return[manualCleanOrthoV2A(left),manualCleanOrthoV2A(right)];
}
function engineeringFastenerSamplesV21(points,spacing){
  const total=routeLength(points||[]),step=Math.max(100,Number(spacing)||500),out=[];if(total<1)return out;
  for(let d=step*.5;d<total-step*.18;d+=step){const p=engineeringRoutePointAtV21(points,d);if(p)out.push(p);}
  // Corners need restraint too; deduplicate against regular samples.
  for(let i=1;i<(points?.length||0)-1;i++){const p=points[i],a=points[i-1],b=points[i+1];if(!nearly(a.x,p.x,2)&&!nearly(a.y,p.y,2))continue;const prevH=Math.abs(a.y-p.y)<=Math.abs(a.x-p.x),nextH=Math.abs(b.y-p.y)<=Math.abs(b.x-p.x);if(prevH===nextH)continue;if(!out.some(q=>dist(q,p)<Math.min(90,step*.28)))out.push({x:p.x,y:p.y,angle:Math.atan2(b.y-p.y,b.x-p.x)});}
  return out;
}
function engineeringFastenersSvgV21(points){
  if(!state.showFastenersV21||!points?.length)return'';const samples=engineeringFastenerSamplesV21(points,state.fastenerStepMm);let h='<g class="engineering-fasteners-v21">';
  for(const p of samples){const ang=(p.angle||0)+Math.PI/2,half=3.3/Math.max(.001,state.scale||.1),dx=Math.cos(ang)*half,dy=Math.sin(ang)*half,r=1.55/Math.max(.001,state.scale||.1);h+=`<line class="fastener-tick" x1="${p.x-dx}" y1="${p.y-dy}" x2="${p.x+dx}" y2="${p.y+dy}"/><circle class="fastener-dot" cx="${p.x}" cy="${p.y}" r="${r}"/>`;}
  return h+'</g>';
}
function engineeringArrowSvgV21(points,cls){
  const total=routeLength(points||[]);if(total<1200)return'';let h='';for(let d=Math.min(900,total*.28);d<total-500;d+=3200){const p=engineeringRoutePointAtV21(points,d);if(!p)continue;const sc=Math.max(.001,state.scale||.1),z=4.1/sc,deg=(p.angle||0)*180/Math.PI;h+=`<g transform="translate(${p.x} ${p.y}) rotate(${deg})"><path class="${cls}" d="M ${-z} ${-z*.68} L ${z} 0 L ${-z} ${z*.68} Z"/></g>`;}return h;
}
function engineeringCircuitLabelV21(route,index){
  if(!route?.length)return'';const p=engineeringRoutePointAtV21(route,routeLength(route)*.54)||route[Math.floor(route.length/2)],sc=Math.max(.001,state.scale||.1),w=30/sc,h=17/sc,y=p.y-11/sc;return`<g class="engineering-circuit-label-v21"><rect x="${p.x-w/2}" y="${y-h/2}" width="${w}" height="${h}"/><text x="${p.x}" y="${y+0.5/sc}">K${index+1}</text></g>`;
}
function engineeringCircuitSvgV21(c,index){
  const route=(c?.route||c?.core||[]).map(p=>({x:p.x,y:p.y}));if(route.length<2)return'';const [hot,cold]=engineeringSplitRouteV21(route,.5),r=Math.min(75,(state.pipeStepMm||150)*.45);let h='<g class="engineering-route-v21">';
  for(const part of [hot,cold])if(part.length>1)h+=`<path class="pipe-halo" d="${roundedPathD(part,r)}"/>`;
  if(hot.length>1)h+=`<path class="pipe-supply" d="${roundedPathD(hot,r)}"/>${engineeringArrowSvgV21(hot,'flow-arrow-supply')}`;
  if(cold.length>1)h+=`<path class="pipe-return" d="${roundedPathD(cold,r)}"/>${engineeringArrowSvgV21(cold,'flow-arrow-return')}`;
  h+=engineeringFastenersSvgV21(route)+engineeringCircuitLabelV21(route,index);
  const sc=Math.max(.001,state.scale||.1),rr=4.8/sc;h+=`<circle class="engineering-end-v21 supply" cx="${route[0].x}" cy="${route[0].y}" r="${rr}"/><circle class="engineering-end-v21 return" cx="${route.at(-1).x}" cy="${route.at(-1).y}" r="${rr}"/>`;
  return h+'</g>';
}
function engineeringPlanSvgV21(circuits){return(circuits||[]).map((c,i)=>engineeringCircuitSvgV21(c,i)).join('');}
function engineeringFastenerCountV21(circuits){return(circuits||[]).reduce((n,c)=>n+engineeringFastenerSamplesV21(c.route||c.core||[],state.fastenerStepMm).length,0);}

function engineeringAxisStepV21(){const sc=Math.max(.001,state.scale||.1),want=18/sc,choices=[100,200,250,500,1000,2000,5000];return choices.find(x=>x>=want)||5000;}
function engineeringFmtCoordV21(mm){const m=mm/1000;return Number.isInteger(m)?String(m):m.toFixed(m<1?2:1).replace(/0$/,'').replace(/\.$/,'');}
function engineeringAxesSvgV21(){
  const b=state.bounds,sc=Math.max(.001,state.scale||.1),step=engineeringAxisStepV21(),tick=4/sc,top=b.minY-8/sc,left=b.minX-9/sc,fs=8.5/sc;let h='<g class="engineering-axis-v21">';
  for(let x=b.minX;x<=b.maxX+1;x+=step){const v=x-b.minX;h+=`<line class="axis-tick" x1="${x}" y1="${b.minY}" x2="${x}" y2="${b.minY-tick}"/><text class="axis-label" x="${x}" y="${top}" text-anchor="middle" font-size="${fs}" transform="rotate(-90 ${x} ${top})">${engineeringFmtCoordV21(v)}</text>`;}
  if((b.maxX-b.minX)%step>1){const x=b.maxX;h+=`<line class="axis-tick" x1="${x}" y1="${b.minY}" x2="${x}" y2="${b.minY-tick}"/><text class="axis-label" x="${x}" y="${top}" text-anchor="middle" font-size="${fs}" transform="rotate(-90 ${x} ${top})">${engineeringFmtCoordV21(b.width)}</text>`;}
  for(let y=b.minY;y<=b.maxY+1;y+=step){const v=y-b.minY;h+=`<line class="axis-tick" x1="${b.minX}" y1="${y}" x2="${b.minX-tick}" y2="${y}"/><text class="axis-label" x="${left}" y="${y+2.8/sc}" text-anchor="end" font-size="${fs}">${engineeringFmtCoordV21(v)}</text>`;}
  if((b.maxY-b.minY)%step>1){const y=b.maxY;h+=`<line class="axis-tick" x1="${b.minX}" y1="${y}" x2="${b.minX-tick}" y2="${y}"/><text class="axis-label" x="${left}" y="${y+2.8/sc}" text-anchor="end" font-size="${fs}">${engineeringFmtCoordV21(b.height)}</text>`;}
  return h+'</g>';
}

function simpleRectangleV21(){return(!state.shapeType||state.shapeType==='rect')&&(state.sections?.length||0)===1&&!state.excluded?.size&&!(state.obstacles?.length);}
function estimatedSimpleLengthV21(){
  if(!simpleRectangleV21())return null;const s=state.sections[0],off=Math.max(0,Number(state.wallOffsetMm)||0),step=Math.max(50,Number(state.pipeStepMm)||150),w=Math.max(0,s.width-2*off),h=Math.max(0,s.height-2*off),area=w*h;let estimate=area/step;
  // Turning arcs and the short collector approach make the area/spacing estimate a little optimistic.
  estimate*=1.025;if(state.supply){const cx=s.x+s.width/2,cy=s.y+s.height/2;estimate+=Math.min(1600,Math.hypot(state.supply.x-cx,state.supply.y-cy)*.18);}return estimate;
}
function updateCircuitSizingInfoV21(){
  const el=$('circuitSizingInfoV21');if(!el)return;el.classList.remove('good','split');const max=(Number(state.maxCircuitLengthM)||100)*1000;
  if(state.enginePlanV1?.ok){const p=state.enginePlanV1,ls=p.circuits.map(c=>(c.length/1000).toFixed(1)).join(' + ');el.textContent=`По фактической трассе: ${p.circuits.length} контур(а) · ${ls} м · лимит ${Math.round(max/1000)} м.`;el.classList.add(p.circuits.length>1?'split':'good');return;}
  if(state.route?.length>1){const L=routeLength(state.route);el.textContent=`Фактическая длина: ${(L/1000).toFixed(1)} м · ${L<=max?'один контур, деление не требуется':'длина выше лимита — при пересчёте Warm разделит площадь на несколько контуров'}.`;el.classList.add(L<=max?'good':'split');return;}
  const est=estimatedSimpleLengthV21();if(est!=null){const n=Math.max(1,Math.ceil(est/Math.max(1,max)));el.textContent=`Оценка по площади и шагу: ≈ ${(est/1000).toFixed(0)} м · ${n===1?'1 контур, искусственное зонирование не нужно':`ориентировочно ${n} контура — окончательно по фактической трассе`}.`;el.classList.add(n===1?'good':'split');}else el.textContent='Сложная форма: число контуров определяется по фактической трассе и заданному лимиту длины.';
}

// Replace the old coloured-per-circuit engine overlay with engineering red/blue flow rendering.
enginePlanOverlayV1=function enginePlanOverlayV21(){const p=state.enginePlanV1;if(!p?.ok||!p.circuits?.length)return'';return engineeringPlanSvgV21(p.circuits);};

const renderPlanV21Base=renderPlan;
renderPlan=function renderPlanV21(){
  const manual=!!state.manualV2?.active,hasEngine=!!state.enginePlanV1?.ok,legacyRoute=!manual&&!hasEngine&&state.route?.length>1?clonePointsV2A(state.route):null;
  if(legacyRoute){const saved=state.route;state.route=[];renderPlanV21Base();state.route=saved;}else renderPlanV21Base();
  planSvg.classList.add('engineering-v21');
  if(legacyRoute)planSvg.insertAdjacentHTML('beforeend',engineeringPlanSvgV21([{id:1,route:legacyRoute,length:routeLength(legacyRoute)}]));
  // Keep editing overlays visually simple; axes still remain useful while manually correcting a plan.
  const ax=engineeringAxesSvgV21();if(ax)planSvg.insertAdjacentHTML('beforeend',ax);
  if(!manual){let circuits=[];if(state.enginePlanV1?.ok)circuits=state.enginePlanV1.circuits||[];else if(legacyRoute)circuits=[{route:legacyRoute,length:routeLength(legacyRoute)}];if(circuits.length){const total=circuits.reduce((s,c)=>s+(Number(c.length)||routeLength(c.route||[])),0);const lengths=circuits.map((c,i)=>`K${i+1} ${((Number(c.length)||routeLength(c.route||[]))/1000).toFixed(1)} м`).join(' · '),fast=engineeringFastenerCountV21(circuits);$('routeInfo').textContent=`${lengths} · всего ${(total/1000).toFixed(1)} м${state.showFastenersV21?` · крепёж ≈ ${fast} шт.`:''}`;}}
  updateCircuitSizingInfoV21();
};

const syncInputsV21Base=syncInputs;
syncInputs=function syncInputsV21(){syncInputsV21Base();if($('fastenerStepInput'))$('fastenerStepInput').value=((Number(state.fastenerStepMm)||500)/1000).toFixed(2);if($('showFastenersInput'))$('showFastenersInput').value=state.showFastenersV21===false?'no':'yes';if($('layoutSchemeInput'))$('layoutSchemeInput').value=state.layoutSchemeV21||'auto';updateCircuitSizingInfoV21();};
const collectInputsV21Base=collectInputs;
collectInputs=function collectInputsV21(){collectInputsV21Base();state.fastenerStepMm=clamp((Number($('fastenerStepInput')?.value)||.5)*1000,100,1500);state.showFastenersV21=$('showFastenersInput')?.value!=='no';state.layoutSchemeV21=$('layoutSchemeInput')?.value||'auto';updateCircuitSizingInfoV21();};

const serializeStateV21Base=serializeState;
serializeState=function serializeStateV21(){const item=serializeStateV21Base();item.fastenerStepMm=Number(state.fastenerStepMm)||500;item.showFastenersV21=state.showFastenersV21!==false;item.layoutSchemeV21=state.layoutSchemeV21||'auto';item.v21='2.1-alpha';return item;};
const loadSchemeV21Base=loadScheme;
loadScheme=function loadSchemeV21(raw){loadSchemeV21Base(raw);state.fastenerStepMm=clamp(Number(raw?.fastenerStepMm)||500,100,1500);state.showFastenersV21=raw?.showFastenersV21!==false;state.layoutSchemeV21=raw?.layoutSchemeV21||'auto';syncInputs();renderPlan();};
const newSchemeV21Base=newScheme;
newScheme=function newSchemeV21(){newSchemeV21Base();state.fastenerStepMm=500;state.showFastenersV21=true;state.layoutSchemeV21='auto';syncInputs();renderPlan();};

$('fastenerStepInput')?.addEventListener('change',()=>{state.fastenerStepMm=clamp((Number($('fastenerStepInput').value)||.5)*1000,100,1500);renderPlan();});
$('showFastenersInput')?.addEventListener('change',()=>{state.showFastenersV21=$('showFastenersInput').value!=='no';renderPlan();});
$('layoutSchemeInput')?.addEventListener('change',()=>{state.layoutSchemeV21=$('layoutSchemeInput').value||'auto';setStatus('Параметр укладки изменён. Нажмите «Построить», чтобы пересчитать варианты.');});
$('maxCircuitLengthInput')?.addEventListener('change',()=>setTimeout(updateCircuitSizingInfoV21,0));
$('pipeStepInput')?.addEventListener('change',()=>setTimeout(updateCircuitSizingInfoV21,0));
$('wallOffsetInput')?.addEventListener('change',()=>setTimeout(updateCircuitSizingInfoV21,0));

async function runEnginePlanV21(){
  if(!state.supply){setStatus('Сначала укажите коллектор.',true);return false;}state.engineBusyV1=true;state.enginePlanV1=null;state.route=[];state.routeComplete=false;renderPlan();
  const host=$('routeCandidates');if(host)host.innerHTML='<div class="route-empty"><strong>Строю инженерный план…</strong><br>Подбираю количество контуров по фактической длине и заданному лимиту.</div>';
  if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent='Фактическая длина → минимальное число контуров → балансировка';openSheetV5('routeSheet');setStatus('Строю план и проверяю длину каждого контура…');
  try{const result=await runEngineWorkerV1(engineInputV1());state.engineBusyV1=false;if(!result?.ok){state.enginePlanV1=null;showEngineResultV1(result);setStatus(result?.error||'Движок не нашёл корректного плана.',true);renderPlan();return false;}state.enginePlanV1=result;state.route=[];state.routeKind=`План V2.2 · ${result.circuits.length} контур(а)`;state.routeComplete=!result.warnings?.length;showEngineResultV1(result);renderPlan();setStatus(`Готово: ${result.circuits.length} контур(а), ${(result.totalLength/1000).toFixed(1)} м. Деление выполнено только по необходимости.`);return true;}catch(err){state.engineBusyV1=false;state.enginePlanV1=null;showEngineResultV1({ok:false,error:err.message});renderPlan();setStatus(`Ошибка расчёта: ${err.message}`,true);return false;}
}

async function generateRouteV21(){
  if(state.manualV2?.active&&typeof manualExitV2A==='function')manualExitV2A();if(typeof blankManualStateV2A==='function')state.manualV2=blankManualStateV2A();collectInputs();
  if(simpleRectangleV21()){
    // First build the proven single-loop rectangle route. Its ACTUAL length, not room area,
    // decides whether the room must be split. This keeps small squares as one continuous drawing.
    state.enginePlanV1=null;legacyGenerateRouteV1();const L=routeLength(state.route||[]),max=(Number(state.maxCircuitLengthM)||100)*1000;
    if(L>0&&L<=max*1.005){state.routeKind=`Авто · 1 контур · ${(L/1000).toFixed(1)} м`;renderPlan();setStatus(`Готово: один контур ${(L/1000).toFixed(1)} м ≤ лимита ${(max/1000).toFixed(0)} м. Деление не требуется.`);return;}
    if(L>max*1.005){setStatus(`Один контур получился ${(L/1000).toFixed(1)} м — выше лимита ${(max/1000).toFixed(0)} м. Делим площадь по фактической длине…`);await runEnginePlanV21();return;}
    return;
  }
  await runEnginePlanV21();
}

// Replace all accumulated Generate listeners with the V2.1-alpha length-aware entry point.
const genBtnV21=$('generateBtn');if(genBtnV21){try{genBtnV21.replaceWith(genBtnV21.cloneNode(true));}catch{}$('generateBtn')?.addEventListener('click',generateRouteV21);}

// Make the result cards use engineering terminology without changing the optimizer itself.
const showEngineResultV21Base=showEngineResultV1;
showEngineResultV1=function showEngineResultV21(plan){showEngineResultV21Base(plan);if(!plan?.ok)return;const host=$('routeCandidates');if(!host)return;const note=document.createElement('div');note.className='route-empty compact';note.innerHTML=`<strong>V2.2:</strong> площадь не делится искусственно. ${plan.circuits?.length===1?'Фактическая длина помещается в один контур.':'Несколько контуров нужны из-за лимита длины или геометрии; optimizer балансирует их по фактической трассе.'}`;host.appendChild(note);};

// Version marker and initial settings sync.
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.1-alpha · инженерный чертёж'));
if(state.sections?.length){syncInputs();renderPlan();}

// ===== V2.1-beta: real layout modes + orientation / entry / direction =====
// V2.1-beta keeps V1.4 as the complex-geometry optimizer and adds a dedicated
// pattern comparator for a single simple rectangle. A rectangle is NOT split
// unless every valid one-loop candidate exceeds the configured circuit limit.

if(!state.layoutOrientationV21)state.layoutOrientationV21='auto';
if(!state.layoutEntryV21)state.layoutEntryV21='auto';
if(!state.layoutTurnV21)state.layoutTurnV21='auto';

function betaOtherAxisV21(axis){return axis==='horizontal'?'vertical':'horizontal';}
function betaLongAxisV21(){return state.bounds.width>=state.bounds.height?'horizontal':'vertical';}
function betaAxesV21(){
  const pref=state.layoutOrientationV21||'auto',long=betaLongAxisV21();
  if(pref==='along')return[long];
  if(pref==='across')return[betaOtherAxisV21(long)];
  return[long,betaOtherAxisV21(long)];
}
function betaInnerRectV21(){
  const b=state.bounds,off=Math.max(0,Number(state.wallOffsetMm)||0);
  return{left:b.minX+off,top:b.minY+off,right:b.maxX-off,bottom:b.maxY-off,width:b.width-2*off,height:b.height-2*off};
}
function betaStraightAxisV21(a,b){return Math.abs(a.x-b.x)>=Math.abs(a.y-b.y)?'horizontal':'vertical';}
function betaCountBendsV21(route){
  let n=0;for(let i=1;i<(route?.length||0)-1;i++){const a=route[i-1],b=route[i],c=route[i+1];if(betaStraightAxisV21(a,b)!==betaStraightAxisV21(b,c))n++;}return n;
}
function betaFirstTurnV21(core){
  if(!core||core.length<3)return'auto';
  for(let i=1;i<core.length-1;i++){
    const a=core[i-1],b=core[i],c=core[i+1],v1={x:b.x-a.x,y:b.y-a.y},v2={x:c.x-b.x,y:c.y-b.y},cross=v1.x*v2.y-v1.y*v2.x;
    if(Math.abs(cross)>1)return cross>0?'cw':'ccw'; // SVG y grows downward: positive is visually clockwise.
  }
  return'auto';
}
function betaEntryClassV21(start){
  const col=sameSideCollectorV8();if(!col||!start)return'near';
  const d=dist(col.supply,start),b=state.bounds,far=Math.hypot(b.width,b.height);
  return d<far*.55?'near':'far';
}
function betaRouteScoreV21(c){
  const d=c.diagnostics||physicalDiagnosticsV10(c.route,c.kind==='spiral'?'spiral':c.kind),ratio=Number.isFinite(d.ratio)?d.ratio:1;
  const prior=c.kind==='spiral'?0:c.kind==='double-snake'?2800:c.kind==='snake'?5200:8000;
  const cold=(state.coldWall&&state.coldWall!=='none')?routeDistanceToWallV10(c.route,state.coldWall):0;
  const bendPenalty=(d.bendOK?0:120000);
  return prior+c.length*.035+c.bends*130+Math.abs(1-ratio)*65000+(Number.isFinite(cold)?cold*.18:0)+bendPenalty;
}
function betaCandidateV21(kind,name,desc,route,meta={}){
  if(!route||route.length<4||!validRoute(route))return null;
  const d=physicalDiagnosticsV10(route,kind==='spiral'?'spiral':kind);
  if(!d.geometryOK||!d.endpointsOK||!d.coverageOK||(kind==='spiral'&&!d.centerOK))return null;
  const c={id:`${kind}-${meta.axis||'na'}-${meta.entry||'na'}-${meta.turn||'na'}-${meta.variant||0}`,kind,name,desc,route:clonePointsV2A(route),length:routeLength(route),diagnostics:d,
    bends:betaCountBendsV21(route),axis:meta.axis||null,entry:meta.entry||null,turn:meta.turn||null,variant:meta.variant||0};
  c.needsSplit=!d.lengthOK;c.bendWarning=!d.bendOK;c.physicalReady=d.physicalReady;c.score=betaRouteScoreV21(c);return c;
}
function betaFilterEntryV21(list){
  const pref=state.layoutEntryV21||'auto';if(pref==='auto'||list.length<2)return list;
  const col=sameSideCollectorV8();if(!col)return list;
  const sorted=[...list].sort((a,b)=>dist(col.supply,a.route[1]||a.route[0])-dist(col.supply,b.route[1]||b.route[0]));
  const n=Math.max(1,Math.ceil(sorted.length/2));return pref==='near'?sorted.slice(0,n):sorted.slice(-n);
}
function betaLanePositionsV21(min,max,step){
  const span=max-min;if(span<step*.55)return[];let count=Math.floor(span/step)+1;if(count%2===1)count--;if(count<2)count=2;
  const used=(count-1)*step,start=min+(span-used)/2;return Array.from({length:count},(_,i)=>start+i*step);
}
function betaDoubleCoreV21(axis,reverseLanes=false,flipRun=false){
  // True double meander: first travel every second lane inward, then return
  // through the skipped lanes. Side turn corridors are separated, so the two
  // arms do not retrace each other as the old experimental generator did.
  const r=betaInnerRectV21(),step=Math.max(50,Number(state.pipeStepMm)||150),pts=[];
  const push=p=>{if(!pts.length||dist(pts.at(-1),p)>1)pts.push(p);};
  if(axis==='horizontal'){
    let lanes=betaLanePositionsV21(r.top,r.bottom,step);if(reverseLanes)lanes=[...lanes].reverse();if(lanes.length<4)return null;
    const sgn=lanes[1]>lanes[0]?1:-1,even=lanes.filter((_,i)=>i%2===0),odd=lanes.filter((_,i)=>i%2===1).reverse();
    const eL=r.left+step,eR=r.right-step,oL=r.left+2*step,oR=r.right-2*step;
    if(oR-oL<step*1.5)return null;
    let side=flipRun?'left':'right';
    // Supply arm on even lanes; turns use the outer safe boundary.
    even.forEach((y,i)=>{const start=side==='right'?eL:eR,end=side==='right'?eR:eL;push({x:start,y});push({x:end,y});if(i<even.length-1){const yn=even[i+1],xo=side==='right'?r.right:r.left;push({x:xo,y});push({x:xo,y:yn});push({x:end,y:yn});side=side==='right'?'left':'right';}});
    // Shift one pitch to the return arm through the outside corridor.
    if(odd.length){const y=even.at(-1),yn=odd[0],endEven=side==='right'?eL:eR,startOdd=side==='right'?oL:oR,xo=side==='right'?r.left:r.right;push({x:xo,y});push({x:xo,y:yn});push({x:startOdd,y:yn});
      // Return arm; use a separate column half a pitch from the boundary.
      odd.forEach((yy,i)=>{const start=side==='right'?oL:oR,end=side==='right'?oR:oL;if(i===0){/* already at start */}else push({x:start,y:yy});push({x:end,y:yy});if(i<odd.length-1){const y2=odd[i+1],xo2=side==='right'?r.right-step*.5:r.left+step*.5;push({x:xo2,y:yy});push({x:xo2,y:y2});push({x:end,y:y2});side=side==='right'?'left':'right';}});
    }
  }else{
    let lanes=betaLanePositionsV21(r.left,r.right,step);if(reverseLanes)lanes=[...lanes].reverse();if(lanes.length<4)return null;
    const even=lanes.filter((_,i)=>i%2===0),odd=lanes.filter((_,i)=>i%2===1).reverse();
    const eT=r.top+step,eB=r.bottom-step,oT=r.top+2*step,oB=r.bottom-2*step;if(oB-oT<step*1.5)return null;
    let side=flipRun?'top':'bottom';
    even.forEach((x,i)=>{const start=side==='bottom'?eT:eB,end=side==='bottom'?eB:eT;push({x,y:start});push({x,y:end});if(i<even.length-1){const xn=even[i+1],yo=side==='bottom'?r.bottom:r.top;push({x,y:yo});push({x:xn,y:yo});push({x:xn,y:end});side=side==='bottom'?'top':'bottom';}});
    if(odd.length){const x=even.at(-1),xn=odd[0],endEven=side==='bottom'?eT:eB,startOdd=side==='bottom'?oT:oB,yo=side==='bottom'?r.top:r.bottom;push({x,y:yo});push({x:xn,y:yo});push({x:xn,y:startOdd});
      odd.forEach((xx,i)=>{const start=side==='bottom'?oT:oB,end=side==='bottom'?oB:oT;if(i>0)push({x:xx,y:start});push({x:xx,y:end});if(i<odd.length-1){const x2=odd[i+1],yo2=side==='bottom'?r.bottom-step*.5:r.top+step*.5;push({x:xx,y:yo2});push({x:x2,y:yo2});push({x:x2,y:end});side=side==='bottom'?'top':'bottom';}});
    }
  }
  return cleanRouteV8(pts);
}
function betaSnakeCoreV21(axis,doubleMode=false,reverseLanes=false,flipRun=false){
  if(doubleMode)return betaDoubleCoreV21(axis,reverseLanes,flipRun);
  const r=betaInnerRectV21(),step=Math.max(50,Number(state.pipeStepMm)||150),pts=[];
  if(axis==='horizontal'){
    let lanes=betaLanePositionsV21(r.top,r.bottom,step);if(reverseLanes)lanes=[...lanes].reverse();lanes.forEach((y,i)=>{const lr=((i%2===0)!==flipRun);pts.push(lr?{x:r.left,y}:{x:r.right,y},lr?{x:r.right,y}:{x:r.left,y});});
  }else{
    let lanes=betaLanePositionsV21(r.left,r.right,step);if(reverseLanes)lanes=[...lanes].reverse();lanes.forEach((x,i)=>{const tb=((i%2===0)!==flipRun);pts.push(tb?{x,y:r.top}:{x,y:r.bottom},tb?{x,y:r.bottom}:{x,y:r.top});});
  }
  return cleanRouteV8(pts);
}
function betaAttachCoreSmartV21(core,collector){
  if(!core?.length||!collector)return null;const b=state.bounds,mid={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2},s=collector.supply,r=collector.ret,start=core[0],end=core.at(-1),off=Math.max(24,Number(state.wallOffsetMm)||100),q1=Math.min(off*.34,55),q2=Math.min(off*.68,90);let lead=[],finish=[];
  const side=collector.side;
  if(side==='bottom'||side==='top'){
    const yy1=side==='bottom'?b.maxY-q1:b.minY+q1,yy2=side==='bottom'?b.maxY-q2:b.minY+q2;
    const sx=start.x<=mid.x?b.minX+q1:b.maxX-q1,ex=end.x<=mid.x?b.minX+q2:b.maxX-q2;
    lead=[s,{x:s.x,y:yy1},{x:sx,y:yy1},{x:sx,y:start.y},start];
    finish=[end,{x:ex,y:end.y},{x:ex,y:yy2},{x:r.x,y:yy2},r];
  }else{
    const xx1=side==='right'?b.maxX-q1:b.minX+q1,xx2=side==='right'?b.maxX-q2:b.minX+q2;
    const sy=start.y<=mid.y?b.minY+q1:b.maxY-q1,ey=end.y<=mid.y?b.minY+q2:b.maxY-q2;
    lead=[s,{x:xx1,y:s.y},{x:xx1,y:sy},{x:start.x,y:sy},start];
    finish=[end,{x:end.x,y:ey},{x:xx2,y:ey},{x:xx2,y:r.y},r];
  }
  return cleanRouteV8([...lead,...core.slice(1),...finish.slice(1)]);
}
function betaAttachCoreV21(core){
  const collector=sameSideCollectorV8();if(!collector||!core?.length)return null;const inner=betaInnerRectV21(),direct=attachCollectorTailsV8(core,collector,inner,state.bounds),smart=betaAttachCoreSmartV21(core,collector),valid=[direct,smart].filter(r=>r&&r.length>3&&validRoute(r));if(valid.length)return valid.sort((a,b)=>routeLength(a)-routeLength(b))[0];return direct||smart;
}
function betaSnakeCandidatesV21(kind){
  const isDouble=kind==='double-snake',name=isDouble?'Двойная змейка':'Обычная змейка',desc=isDouble?'Соседние горячие и обратные ветви чередуются, уменьшая температурную полосатость.':'Последовательные параллельные проходы с минимально сложной геометрией.';
  let out=[];for(const axis of betaAxesV21())for(const reverse of [false,true])for(const flip of [false,true]){
    const core=betaSnakeCoreV21(axis,isDouble,reverse,flip),route=betaAttachCoreV21(core);if(!route)continue;
    const c=betaCandidateV21(kind,name,desc,route,{axis,entry:betaEntryClassV21(core?.[0]),variant:(reverse?2:0)+(flip?1:0)});if(c)out.push(c);
  }
  out=betaFilterEntryV21(out);out.sort((a,b)=>a.score-b.score);return out;
}
function betaSpiralCoreTransformV21(core,mx,my){
  const r=betaInnerRectV21(),W=r.width,H=r.height;
  return core.map(p=>({x:r.left+(mx?W-p.x:p.x),y:r.top+(my?H-p.y:p.y)}));
}
function betaSpiralCandidatesV21(){
  // Reuse the proven inward-offset spiral generator. To expose both winding
  // directions we may swap the two adjacent manifold ports; physically this
  // only decides which neighbouring port is flow and which is return.
  const originalSupply=state.supply?{...state.supply}:null,originalReturn=state.returnPoint?{...state.returnPoint}:null;if(!originalSupply||!originalReturn)return[];
  let out=[],variant=0;
  for(const swap of [false,true]){
    state.supply=swap?{...originalReturn}:{...originalSupply};state.returnPoint=swap?{...originalSupply}:{...originalReturn};sameSideCollectorV8();
    const routes=buildRectPatternVariantsV8(spiralCoreCandidatesV8)||[];
    for(const route of routes){
      const turn=betaFirstTurnV21(route);if(state.layoutTurnV21!=='auto'&&turn!==state.layoutTurnV21)continue;
      const c=betaCandidateV21('spiral','Улитка / спираль','Подача идёт к центру, обратка возвращается между витками: горячие и более холодные ветви чередуются.',route,{entry:betaEntryClassV21(route[2]||route[1]),turn,variant:variant++});
      if(c){c.supplyPoint={...state.supply};c.returnPoint={...state.returnPoint};c.portsSwapped=swap;out.push(c);}
    }
  }
  state.supply=originalSupply;state.returnPoint=originalReturn;sameSideCollectorV8();
  // Entry preference is evaluated against each candidate's actual hot port.
  const ep=state.layoutEntryV21||'auto';if(ep!=='auto'&&out.length>1){const sorted=[...out].sort((a,b)=>dist(a.supplyPoint,a.route[2]||a.route[1])-dist(b.supplyPoint,b.route[2]||b.route[1]));const n=Math.max(1,Math.ceil(sorted.length/2));out=ep==='near'?sorted.slice(0,n):sorted.slice(-n);}
  out.sort((a,b)=>a.score-b.score);return out;
}
function betaApplyCandidatePortsV21(c){if(c?.supplyPoint&&c?.returnPoint){state.supply={...c.supplyPoint};state.returnPoint={...c.returnPoint};}}
function betaPatternCandidatesV21(){
  if(!simpleRectangleV21())return[];const mode=state.layoutSchemeV21||'auto',all=[];
  if(mode==='auto'||mode==='spiral')all.push(...betaSpiralCandidatesV21());
  if(mode==='auto'||mode==='double-snake')all.push(...betaSnakeCandidatesV21('double-snake'));
  if(mode==='auto'||mode==='snake')all.push(...betaSnakeCandidatesV21('snake'));
  // Collapse geometrically duplicate variants produced by equivalent centre templates.
  const seen=new Set(),uniq=[];for(const c of all){const sig=`${c.kind}|${c.axis||''}|${c.turn||''}|${c.entry||''}|${Math.round(c.length)}|${c.route.slice(0,8).map(p=>`${Math.round(p.x)},${Math.round(p.y)}`).join(';')}`;if(seen.has(sig))continue;seen.add(sig);uniq.push(c);}uniq.sort((a,b)=>a.score-b.score);return uniq;
}
function betaPatternLabelV21(c){
  const bits=[];if(c.axis)bits.push(c.axis==='horizontal'?'проходы горизонтально':'проходы вертикально');if(c.turn&&c.turn!=='auto')bits.push(c.turn==='cw'?'по часовой':'против часовой');if(c.entry)bits.push(c.entry==='near'?'ближний старт':'дальний старт');return bits.join(' · ');
}
function betaShowCandidatesV21(list,selected){
  const host=$('routeCandidates');if(!host)return;let html='';
  if(list?.length){html=list.slice(0,10).map((c,i)=>{const chosen=c.id===selected,meta=betaPatternLabelV21(c),st=c.needsSplit?`выше лимита ${Math.round(state.maxCircuitLengthM||100)} м`:c.bendWarning?'радиус поворота требует проверки':'валидный один контур';return`<button class="route-card simple${chosen?' active':''}${c.needsSplit?' needs-split':''}" data-beta-candidate="${c.id}"><span class="route-card-main"><span class="route-card-title">${c.name}${i===0&&state.layoutSchemeV21==='auto'?' · Auto':''}</span><span class="route-card-desc">${meta||c.desc}</span><span class="route-card-status ${c.needsSplit?'warn':'ok'}">${c.needsSplit?'⚠':'✓'} ${st}</span></span><span class="route-card-metrics"><span class="route-card-length">${(c.length/1000).toFixed(1)} м</span><span class="route-card-delta">${c.bends} поворотов</span></span></button>`;}).join('');}
  if(!html){const mode=state.layoutSchemeV21||'auto',name=mode==='double-snake'?'двойной змейки':mode==='spiral'?'улитки':mode==='snake'?'змейки':'выбранного режима';html=`<div class="route-empty"><strong>Нет корректного варианта ${name}.</strong><br>Измените направление, шаг, радиус изгиба или положение коллектора. Для двойной змейки особенно важен достаточный радиус 180° разворотов.</div>`;}
  host.innerHTML=html;host.querySelectorAll('[data-beta-candidate]').forEach(btn=>btn.addEventListener('click',()=>betaSelectCandidateV21(btn.dataset.betaCandidate)));
  if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent='Сравнение улитки, двойной и обычной змейки';
  if($('routeSheetHelp'))$('routeSheetHelp').textContent='Auto сравнивает физически допустимые варианты. Простая комната остаётся одним контуром, пока фактическая длина укладывается в установленный предел.';
}
function betaSelectCandidateV21(id){
  const c=(state.routeCandidates||[]).find(x=>x.id===id);if(!c)return;betaApplyCandidatePortsV21(c);state.selectedRouteCandidate=id;state.enginePlanV1=null;state.route=clonePointsV2A(c.route);state.routeKind=c.name;state.routeComplete=!!c.physicalReady;renderPlan();betaShowCandidatesV21(state.routeCandidates,id);setStatus(`${c.name}: ${(c.length/1000).toFixed(1)} м · ${betaPatternLabelV21(c)||'вариант выбран вручную'}.${c.needsSplit?' Длина выше лимита контура.':''}`,c.needsSplit);}

function betaPickAutoV21(list){
  const max=(Number(state.maxCircuitLengthM)||100)*1000,feasible=list.filter(c=>c.length<=max*1.005&&c.physicalReady!==false);
  return(feasible.length?feasible:list).sort((a,b)=>a.score-b.score)[0]||null;
}
async function generateRouteV21B(){
  if(state.manualV2?.active&&typeof manualExitV2A==='function')manualExitV2A();if(typeof blankManualStateV2A==='function')state.manualV2=blankManualStateV2A();collectInputs();recomputeGeometry();
  if(!state.supply){setStatus('Сначала укажите коллектор.',true);return;}
  const mode=state.layoutSchemeV21||'auto';
  if(simpleRectangleV21()&&mode!=='adaptive'){
    sameSideCollectorV8();const list=betaPatternCandidatesV21();state.routeCandidates=list;state.enginePlanV1=null;
    if(!list.length){state.route=[];renderPlan();betaShowCandidatesV21([],null);openSheetV5('routeSheet');setStatus('Для выбранного режима корректный маршрут не найден.',true);return;}
    const chosen=betaPickAutoV21(list),max=(Number(state.maxCircuitLengthM)||100)*1000;
    if(mode==='auto'&&chosen&&chosen.length>max*1.005){
      // No one-loop pattern fits: now, and only now, ask the balancing optimizer to split the room.
      setStatus(`Лучший цельный рисунок ${(chosen.length/1000).toFixed(1)} м > лимита ${(max/1000).toFixed(0)} м. Разделяю на минимальное число сбалансированных контуров…`);await runEnginePlanV21();return;
    }
    betaApplyCandidatePortsV21(chosen);state.selectedRouteCandidate=chosen.id;state.route=clonePointsV2A(chosen.route);state.routeKind=`${chosen.name} · V2.1-beta`;state.routeComplete=!!chosen.physicalReady;renderPlan();betaShowCandidatesV21(list,chosen.id);openSheetV5('routeSheet');
    const warn=chosen.needsSplit||chosen.bendWarning;setStatus(`${mode==='auto'?'Auto выбрал':'Построено'}: ${chosen.name}, ${(chosen.length/1000).toFixed(1)} м${chosen.needsSplit?' — выше лимита контура':''}${chosen.bendWarning?' — проверьте минимальный радиус поворота':''}.`,warn);return;
  }
  if(!simpleRectangleV21()&&mode==='spiral'){
    state.route=[];state.enginePlanV1=null;renderPlan();setStatus('V2.1-beta: цельная улитка сейчас поддерживается для прямоугольной свободной области. Для сложной формы выберите Auto или Адаптивную.',true);return;
  }
  // Complex shapes and explicit Adaptive continue to use the proven V1.4 optimizer.
  await runEnginePlanV21();
}

// Persist beta controls.
const serializeStateV21BBase=serializeState;
serializeState=function serializeStateV21B(){const item=serializeStateV21BBase();item.layoutSchemeV21=state.layoutSchemeV21||'auto';item.layoutOrientationV21=state.layoutOrientationV21||'auto';item.layoutEntryV21=state.layoutEntryV21||'auto';item.layoutTurnV21=state.layoutTurnV21||'auto';item.v21='2.1-beta';return item;};
const loadSchemeV21BBase=loadScheme;
loadScheme=function loadSchemeV21B(raw){loadSchemeV21BBase(raw);state.layoutSchemeV21=raw?.layoutSchemeV21||'auto';state.layoutOrientationV21=raw?.layoutOrientationV21||'auto';state.layoutEntryV21=raw?.layoutEntryV21||'auto';state.layoutTurnV21=raw?.layoutTurnV21||'auto';syncInputs();renderPlan();};
const newSchemeV21BBase=newScheme;
newScheme=function newSchemeV21B(){newSchemeV21BBase();state.layoutSchemeV21='auto';state.layoutOrientationV21='auto';state.layoutEntryV21='auto';state.layoutTurnV21='auto';syncInputs();renderPlan();};
const syncInputsV21BBase=syncInputs;
syncInputs=function syncInputsV21B(){syncInputsV21BBase();if($('layoutSchemeInput'))$('layoutSchemeInput').value=state.layoutSchemeV21||'auto';if($('layoutOrientationInput'))$('layoutOrientationInput').value=state.layoutOrientationV21||'auto';if($('layoutEntryInput'))$('layoutEntryInput').value=state.layoutEntryV21||'auto';if($('layoutTurnInput'))$('layoutTurnInput').value=state.layoutTurnV21||'auto';};
const collectInputsV21BBase=collectInputs;
collectInputs=function collectInputsV21B(){collectInputsV21BBase();state.layoutSchemeV21=$('layoutSchemeInput')?.value||'auto';state.layoutOrientationV21=$('layoutOrientationInput')?.value||'auto';state.layoutEntryV21=$('layoutEntryInput')?.value||'auto';state.layoutTurnV21=$('layoutTurnInput')?.value||'auto';};

for(const [id,key] of [['layoutSchemeInput','layoutSchemeV21'],['layoutOrientationInput','layoutOrientationV21'],['layoutEntryInput','layoutEntryV21'],['layoutTurnInput','layoutTurnV21']])$(''+id)?.addEventListener('change',()=>{state[key]=$(''+id).value||'auto';renderPlan();setStatus('Параметр укладки изменён. Нажмите «Построить», чтобы пересчитать варианты.');});

// Replace V2.1-alpha Generate entry point.
const genBtnV21B=$('generateBtn');if(genBtnV21B){try{genBtnV21B.replaceWith(genBtnV21B.cloneNode(true));}catch{}$('generateBtn')?.addEventListener('click',generateRouteV21B);}

document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.1-beta · улитка + змейки + Auto'));
if(state.sections?.length){syncInputs();renderPlan();}

// ===== V2.1 final: crossing-free double meander + cold-wall local pitch =====
// Final layer intentionally wraps V2.1-beta instead of changing the proven V1.4
// complex-geometry optimizer. Simple rectangles get the richer pattern engine;
// complex rooms keep the adaptive planner and the V2.0 manual editor.

if(!Number.isFinite(state.coldBandMm)) state.coldBandMm=800;
if(!Number.isFinite(state.coldStepMm)) state.coldStepMm=100;

function finalColdActiveV21(){
  return !!state.coldWall && state.coldWall!=='none' && Number(state.coldBandMm)>0 && Number(state.coldStepMm)>0 && Number(state.coldStepMm)<Number(state.pipeStepMm||150)-1;
}
function finalColdParallelAxisV21(){
  if(state.coldWall==='top'||state.coldWall==='bottom') return 'horizontal';
  if(state.coldWall==='left'||state.coldWall==='right') return 'vertical';
  return null;
}
function finalVariableLanePositionsV21(axis){
  const r=betaInnerRectV21(),main=Math.max(50,Number(state.pipeStepMm)||150);
  const min=axis==='horizontal'?r.top:r.left, max=axis==='horizontal'?r.bottom:r.right;
  if(max-min<main*.55) return [];
  const match=finalColdActiveV21() && finalColdParallelAxisV21()===axis;
  if(!match) return betaLanePositionsV21(min,max,main);
  const cold=Math.max(50,Math.min(main,Number(state.coldStepMm)||100));
  const band=Math.max(cold,Math.min(max-min,Number(state.coldBandMm)||800));
  const fromMin=(state.coldWall==='top'||state.coldWall==='left');
  const raw=[];
  if(fromMin){
    let x=min; raw.push(x);
    const edge=Math.min(max,min+band);
    while(x+cold<=edge+1){x+=cold;raw.push(x);}
    while(x+main<=max+1){x+=main;raw.push(x);}
    if(max-raw.at(-1)>main*.62) raw.push(max);
  }else{
    let x=max; raw.push(x);
    const edge=Math.max(min,max-band);
    while(x-cold>=edge-1){x-=cold;raw.push(x);}
    while(x-main>=min-1){x-=main;raw.push(x);}
    if(raw.at(-1)-min>main*.62) raw.push(min);
    raw.reverse();
  }
  // De-duplicate and keep a practical minimum gap around numeric joins.
  const out=[];for(const x of raw.sort((a,b)=>a-b)){if(!out.length||x-out.at(-1)>Math.min(cold,main)*.45)out.push(x);}
  return out;
}

function finalPolylineIntersectsV21(a,b,poly,allowA=null,allowB=null){
  if(!poly||poly.length<2)return false;
  for(let i=1;i<poly.length;i++){
    const c=poly[i-1],d=poly[i]; if(!segmentsIntersect(a,b,c,d))continue;
    const sharedAllowed=(p)=> (allowA&&samePointV12(p,allowA,1))||(allowB&&samePointV12(p,allowB,1));
    const touchOnly=(sharedAllowed(a)&&(samePointV12(c,a,1)||samePointV12(d,a,1))) || (sharedAllowed(b)&&(samePointV12(c,b,1)||samePointV12(d,b,1)));
    if(touchOnly)continue;
    return true;
  }
  return false;
}
function finalCorridorConnectorV21(source,target,side,blocked,mainInset){
  const r=betaInnerRectV21(),step=Math.max(50,Number(state.pipeStepMm)||150),g=Math.max(22,Math.min(42,step*.22));
  let minX=r.left,maxX=r.right,minY=r.top,maxY=r.bottom;
  if(side==='left'){maxX=Math.max(source.x,target.x);minY=Math.max(r.top,Math.min(source.y,target.y)-step*.62);maxY=Math.min(r.bottom,Math.max(source.y,target.y)+step*.62);}
  if(side==='right'){minX=Math.min(source.x,target.x);minY=Math.max(r.top,Math.min(source.y,target.y)-step*.62);maxY=Math.min(r.bottom,Math.max(source.y,target.y)+step*.62);}
  if(side==='top'){maxY=Math.max(source.y,target.y);minX=Math.max(r.left,Math.min(source.x,target.x)-step*.62);maxX=Math.min(r.right,Math.max(source.x,target.x)+step*.62);}
  if(side==='bottom'){minY=Math.min(source.y,target.y);minX=Math.max(r.left,Math.min(source.x,target.x)-step*.62);maxX=Math.min(r.right,Math.max(source.x,target.x)+step*.62);}
  const xs=[],ys=[],add=(arr,v)=>{if(!arr.some(q=>Math.abs(q-v)<1))arr.push(v);};
  for(let x=minX;x<=maxX+.1;x+=g)add(xs,x);for(let y=minY;y<=maxY+.1;y+=g)add(ys,y);
  for(const v of [minX,maxX,source.x,target.x])add(xs,v);for(const v of [minY,maxY,source.y,target.y])add(ys,v);
  xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
  const ix=v=>xs.findIndex(x=>Math.abs(x-v)<1),iy=v=>ys.findIndex(y=>Math.abs(y-v)<1),sx=ix(source.x),sy=iy(source.y),tx=ix(target.x),ty=iy(target.y);
  if(sx<0||sy<0||tx<0||ty<0)return null;
  const key=(i,j)=>`${i},${j}`,start=key(sx,sy),goal=key(tx,ty),q=[[sx,sy]],seen=new Set([start]),par=new Map(),dirs=[[1,0],[-1,0],[0,1],[0,-1]];let qi=0;
  const edgeOK=(a,b)=>{
    if(!coreSegmentSafeV12(a,b,Math.max(0,Number(state.wallOffsetMm)||0)))return false;
    for(const poly of blocked||[])if(finalPolylineIntersectsV21(a,b,poly,source,target))return false;
    return true;
  };
  while(qi<q.length&&q.length<12000){const [i,j]=q[qi++],k=key(i,j);if(k===goal)break;for(const [di,dj] of dirs){const ni=i+di,nj=j+dj;if(ni<0||nj<0||ni>=xs.length||nj>=ys.length)continue;const nk=key(ni,nj);if(seen.has(nk))continue;const a={x:xs[i],y:ys[j]},b={x:xs[ni],y:ys[nj]};if(!edgeOK(a,b))continue;seen.add(nk);par.set(nk,[i,j]);q.push([ni,nj]);}}
  if(!seen.has(goal))return null;const out=[];let cur=[tx,ty];while(true){out.push({x:xs[cur[0]],y:ys[cur[1]]});const k=key(cur[0],cur[1]);if(k===start)break;cur=par.get(k);if(!cur)return null;}return cleanPolyline(out.reverse());
}
function finalDoubleCoreV21(axis,reverseLanes=false,flipRun=false){
  const r=betaInnerRectV21(),step=Math.max(50,Number(state.pipeStepMm)||150),sideInset=Math.max(step*.82,requestedBendRadiusV10()*1.35,100);
  let lanes=finalVariableLanePositionsV21(axis);if(reverseLanes)lanes=[...lanes].reverse();if(lanes.length<4)return null;
  const lo=axis==='horizontal'?r.left+sideInset:r.top+sideInset,hi=axis==='horizontal'?r.right-sideInset:r.bottom-sideInset;
  if(hi-lo<step*2.2)return null;
  const lanePolys=lanes.map(v=>axis==='horizontal'?[{x:lo,y:v},{x:hi,y:v}]:[{x:v,y:lo},{x:v,y:hi}]);
  const ev=lanes.map((_,i)=>i).filter(i=>i%2===0),od=lanes.map((_,i)=>i).filter(i=>i%2===1).reverse(),seq=[...ev,...od];if(seq.length<4)return null;
  let side=flipRun?'high':'low',route=[],connectors=[];
  const endpoint=(idx,s)=>axis==='horizontal'?{x:s==='low'?lo:hi,y:lanes[idx]}:{x:lanes[idx],y:s==='low'?lo:hi};
  const sideName=s=>axis==='horizontal'?(s==='low'?'left':'right'):(s==='low'?'top':'bottom');
  for(let qi=0;qi<seq.length;qi++){
    const idx=seq[qi],start=endpoint(idx,side),end=endpoint(idx,side==='low'?'high':'low');
    if(!route.length)route.push(start);else if(dist(route.at(-1),start)>1){
      const blocked=[...lanePolys,...connectors];
      // Do not block the two lane segments that own source/target endpoints; endpoint touching is allowed anyway.
      const conn=finalCorridorConnectorV21(route.at(-1),start,sideName(side),blocked,sideInset);if(!conn)return null;
      connectors.push(conn);route=cleanPolyline([...route,...conn.slice(1)]);
    }
    route.push(end);side=side==='low'?'high':'low';
  }
  route=cleanPolyline(route);
  return routeHasRetraceV14(route)?null:route;
}
function finalSnakeCoreV21(axis,doubleMode=false,reverseLanes=false,flipRun=false){
  if(doubleMode)return finalDoubleCoreV21(axis,reverseLanes,flipRun);
  const r=betaInnerRectV21(),pts=[];let lanes=finalVariableLanePositionsV21(axis);if(reverseLanes)lanes=[...lanes].reverse();
  if(axis==='horizontal')lanes.forEach((y,i)=>{const lr=((i%2===0)!==flipRun);pts.push(lr?{x:r.left,y}:{x:r.right,y},lr?{x:r.right,y}:{x:r.left,y});});
  else lanes.forEach((x,i)=>{const tb=((i%2===0)!==flipRun);pts.push(tb?{x,y:r.top}:{x,y:r.bottom},tb?{x,y:r.bottom}:{x,y:r.top});});
  return cleanRouteV8(pts);
}
// Replace beta core generation with the final variable-pitch/crossing-free implementation.
betaSnakeCoreV21=finalSnakeCoreV21;
betaDoubleCoreV21=finalDoubleCoreV21;

function finalColdLengthInBandV21(route){
  if(!finalColdActiveV21()||!route?.length)return 0;const b=state.bounds,band=Number(state.coldBandMm)||800;let sum=0;
  const inside=p=>state.coldWall==='top'?p.y<=b.minY+band:state.coldWall==='bottom'?p.y>=b.maxY-band:state.coldWall==='left'?p.x<=b.minX+band:p.x>=b.maxX-band;
  for(let i=1;i<route.length;i++){const a=route[i-1],c=route[i],l=dist(a,c);if(inside(a)&&inside(c))sum+=l;else if(inside(a)||inside(c))sum+=l*.5;}return sum;
}
const betaRouteScoreV21BaseFinal=betaRouteScoreV21;
betaRouteScoreV21=function betaRouteScoreV21Final(c){
  let score=betaRouteScoreV21BaseFinal(c);if(!finalColdActiveV21())return score;
  const frac=finalColdLengthInBandV21(c.route)/Math.max(1,c.length),parallel=c.axis===finalColdParallelAxisV21();
  // Reward real extra pipe in the cold band and the orientation that can honour local pitch.
  score-=frac*15000;if(parallel)score-=5500;else if(c.kind!=='spiral')score+=6500;
  // A forced spiral remains available, but Auto should prefer a pattern that truly densifies the cold strip.
  if(c.kind==='spiral')score+=8000;
  return score;
};

function finalColdBandSvgV21(){
  if(!finalColdActiveV21())return'';const b=state.bounds,w=Math.min(Number(state.coldBandMm)||800,state.coldWall==='left'||state.coldWall==='right'?b.width:b.height),sc=Math.max(.001,state.scale||.1),fs=8/sc;let x=b.minX,y=b.minY,ww=b.width,hh=b.height;
  if(state.coldWall==='top')hh=w;else if(state.coldWall==='bottom'){y=b.maxY-w;hh=w;}else if(state.coldWall==='left')ww=w;else{x=b.maxX-w;ww=w;}
  const label=`Холодная зона ${(w/1000).toFixed(2).replace(/0$/,'')} м · шаг ${(Number(state.coldStepMm||100)/1000).toFixed(2)} м`;
  return `<g class="cold-band-v21"><rect x="${x}" y="${y}" width="${ww}" height="${hh}"/><text x="${x+10/sc}" y="${y+16/sc}" font-size="${fs}">${label}</text></g>`;
}
const renderPlanV21FinalBase=renderPlan;
renderPlan=function renderPlanV21Final(){renderPlanV21FinalBase();const g=finalColdBandSvgV21();if(g&&planSvg)planSvg.insertAdjacentHTML('beforeend',g);};

function finalColdUiInfoV21(){
  const el=$('coldWallInfoV21');if(!el)return;const active=finalColdActiveV21();el.classList.toggle('good',active);el.textContent=!state.coldWall||state.coldWall==='none'?'Холодная зона выключена.':'Холодная зона: '+(active?`${(state.coldBandMm/1000).toFixed(2)} м от стены · локальный шаг ${(state.coldStepMm/1000).toFixed(2)} м.`:'локальный шаг должен быть меньше основного шага трубы.');
}
const syncInputsV21FinalBase=syncInputs;
syncInputs=function syncInputsV21Final(){syncInputsV21FinalBase();if($('coldBandWidthInput'))$('coldBandWidthInput').value=((Number(state.coldBandMm)||800)/1000).toFixed(2);if($('coldStepInput'))$('coldStepInput').value=((Number(state.coldStepMm)||100)/1000).toFixed(2);finalColdUiInfoV21();};
const collectInputsV21FinalBase=collectInputs;
collectInputs=function collectInputsV21Final(){collectInputsV21FinalBase();state.coldBandMm=clamp((Number($('coldBandWidthInput')?.value)||.8)*1000,100,3000);state.coldStepMm=clamp((Number($('coldStepInput')?.value)||.1)*1000,50,Math.max(50,Number(state.pipeStepMm)||150));finalColdUiInfoV21();};
const serializeStateV21FinalBase=serializeState;
serializeState=function serializeStateV21Final(){const item=serializeStateV21FinalBase();item.coldBandMm=Number(state.coldBandMm)||800;item.coldStepMm=Number(state.coldStepMm)||100;item.v21='2.1-final';return item;};
const loadSchemeV21FinalBase=loadScheme;
loadScheme=function loadSchemeV21Final(raw){loadSchemeV21FinalBase(raw);state.coldBandMm=clamp(Number(raw?.coldBandMm)||800,100,3000);state.coldStepMm=clamp(Number(raw?.coldStepMm)||100,50,500);syncInputs();renderPlan();};
const newSchemeV21FinalBase=newScheme;
newScheme=function newSchemeV21Final(){newSchemeV21FinalBase();state.coldBandMm=800;state.coldStepMm=Math.min(100,Number(state.pipeStepMm)||150);syncInputs();renderPlan();};

for(const id of ['coldWallInput','coldBandWidthInput','coldStepInput'])$(id)?.addEventListener('change',()=>{collectInputs();renderPlan();setStatus('Параметры холодной зоны изменены. Нажмите «Построить», чтобы Auto сравнил варианты с локальным шагом.');});

const betaShowCandidatesV21BaseFinal=betaShowCandidatesV21;
betaShowCandidatesV21=function betaShowCandidatesV21Final(list,selected){betaShowCandidatesV21BaseFinal(list,selected);const host=$('routeCandidates');if(host&&finalColdActiveV21()){const n=document.createElement('div');n.className='route-empty compact';n.innerHTML=`<strong>Холодная зона:</strong> ${state.coldWall} · полоса ${(state.coldBandMm/1000).toFixed(2)} м · шаг ${(state.coldStepMm/1000).toFixed(2)} м. Auto отдаёт приоритет рисункам, которые реально уплотняют трубу в этой полосе.`;host.appendChild(n);}};

// Final Generate wrapper: keep beta comparison for simple rectangles and V1.4 for complex rooms.
async function generateRouteV21Final(){
  collectInputs();
  // If cold density is requested for a complex/multi-loop case, the adaptive engine still owns geometry.
  // The UI states this explicitly instead of silently pretending that the variable pitch survived splitting.
  await generateRouteV21B();
  if(finalColdActiveV21() && state.enginePlanV1?.ok && state.enginePlanV1.circuits?.length>1){
    setStatus(`Готово: ${state.enginePlanV1.circuits.length} контура. Уплотнение холодной стены учитывается при выборе цельного рисунка; после автоматического многоконтурного разбиения проверьте локальный шаг вручную.`,true);
  }
}
const genBtnV21Final=$('generateBtn');if(genBtnV21Final){try{genBtnV21Final.replaceWith(genBtnV21Final.cloneNode(true));}catch{}$('generateBtn')?.addEventListener('click',generateRouteV21Final);}

document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.2 · multi-cell optimizer'));
if(state.sections?.length){syncInputs();renderPlan();}

// V2.1-final double-meander stabilization: two interlocked serpentine fields.
// This construction is planar by design: each arm occupies its own half of the
// rectangle and they meet once at the far seam. It is deliberately preferred
// over a crossing-prone "skip every other row" polyline approximation.
function finalEvenLaneSetV21(axis){
  let a=finalVariableLanePositionsV21(axis);if(a.length%2===1){
    const cold=state.coldWall||'none';
    const removeFromStart=(axis==='horizontal'&&cold==='bottom')||(axis==='vertical'&&cold==='right');
    a=removeFromStart?a.slice(1):a.slice(0,-1);
  }
  return a;
}
function finalSnakeFieldV21(axis,lo,hi,lanes,startSeamSide){
  const pts=[];let seam=startSeamSide;
  if(axis==='horizontal'){
    for(let i=0;i<lanes.length;i++){
      const y=lanes[i],a=seam?{x:hi,y}:{x:lo,y},b=seam?{x:lo,y}:{x:hi,y};
      if(!pts.length)pts.push(a);pts.push(b);seam=!seam;
      if(i<lanes.length-1)pts.push({x:seam?hi:lo,y:lanes[i+1]});
    }
  }else{
    for(let i=0;i<lanes.length;i++){
      const x=lanes[i],a=seam?{x,y:hi}:{x,y:lo},b=seam?{x,y:lo}:{x,y:hi};
      if(!pts.length)pts.push(a);pts.push(b);seam=!seam;
      if(i<lanes.length-1)pts.push({x,y:seam?hi:lo});
    }
  }
  return cleanRouteV8(pts);
}
finalDoubleCoreV21=function finalDoubleCoreV21Stable(axis,reverseLanes=false,flipRun=false){
  const r=betaInnerRectV21(),step=Math.max(50,Number(state.pipeStepMm)||150),gap=Math.max(step*.72,requestedBendRadiusV10()*1.1,70);
  let lanes=finalEvenLaneSetV21(axis);if(lanes.length<4)return null;
  let a=reverseLanes?[...lanes]:[...lanes].reverse(),b=[...a].reverse();
  if(axis==='horizontal'){
    const mid=(r.left+r.right)/2,L1=r.left,L2=mid-gap/2,R1=mid+gap/2,R2=r.right;if(L2-L1<step*2||R2-R1<step*2)return null;
    const left=finalSnakeFieldV21('horizontal',L1,L2,a,true),right=finalSnakeFieldV21('horizontal',R1,R2,b,false);if(!left?.length||!right?.length)return null;
    let first=flipRun?right:left,second=flipRun?left:right;if(flipRun){first=[...first].reverse();second=[...second].reverse();}
    const bridge=[first.at(-1),{x:second[0].x,y:first.at(-1).y},second[0]];
    const route=cleanRouteV8([...first,...bridge.slice(1),...second.slice(1)]);return (!routeHasRetraceV14(route)&&validRoute(route))?route:null;
  }
  const mid=(r.top+r.bottom)/2,T1=r.top,T2=mid-gap/2,B1=mid+gap/2,B2=r.bottom;if(T2-T1<step*2||B2-B1<step*2)return null;
  const top=finalSnakeFieldV21('vertical',T1,T2,a,true),bottom=finalSnakeFieldV21('vertical',B1,B2,b,false);if(!top?.length||!bottom?.length)return null;
  let first=flipRun?bottom:top,second=flipRun?top:bottom;if(flipRun){first=[...first].reverse();second=[...second].reverse();}
  const bridge=[first.at(-1),{x:first.at(-1).x,y:second[0].y},second[0]];
  const route=cleanRouteV8([...first,...bridge.slice(1),...second.slice(1)]);return (!routeHasRetraceV14(route)&&validRoute(route))?route:null;
};
betaDoubleCoreV21=finalDoubleCoreV21;
betaSnakeCoreV21=function betaSnakeCoreV21FinalStable(axis,doubleMode=false,reverseLanes=false,flipRun=false){
  if(doubleMode)return finalDoubleCoreV21(axis,reverseLanes,flipRun);
  return finalSnakeCoreV21(axis,false,reverseLanes,flipRun);
};
const betaRouteScoreV21FinalColdBase=betaRouteScoreV21;
betaRouteScoreV21=function betaRouteScoreV21FinalCold(c){
  let score=betaRouteScoreV21FinalColdBase(c);if(!finalColdActiveV21())return score;
  if(c.kind==='spiral')score+=14000;
  else if(c.axis===finalColdParallelAxisV21())score-=12000;
  else score+=18000;
  return score;
};

// Keep the double-meander manifold connection simple when both free ends already
// arrive next to each other at the seam. This avoids artificial 30–70 mm doglegs
// introduced by the generic collector-tail helper.
const finalDoubleCoreV21StableBase=finalDoubleCoreV21;
finalDoubleCoreV21=function finalDoubleCoreV21Marked(axis,reverseLanes=false,flipRun=false){const r=finalDoubleCoreV21StableBase(axis,reverseLanes,flipRun);if(r)r._doubleV21=true;return r;};
betaDoubleCoreV21=finalDoubleCoreV21;
betaSnakeCoreV21=function betaSnakeCoreV21FinalMarked(axis,doubleMode=false,reverseLanes=false,flipRun=false){if(doubleMode)return finalDoubleCoreV21(axis,reverseLanes,flipRun);return finalSnakeCoreV21(axis,false,reverseLanes,flipRun);};
const betaAttachCoreV21FinalBase=betaAttachCoreV21;
betaAttachCoreV21=function betaAttachCoreV21Final(core){
  if(core?._doubleV21&&state.supply&&state.returnPoint){
    for(const c of [core,[...core].reverse()]){
      const direct=cleanRouteV8([state.supply,...c,state.returnPoint]);
      if(direct.length>3&&validRoute(direct))return direct;
    }
  }
  return betaAttachCoreV21FinalBase(core);
};

// Final orthogonal manifold tail for double meander. The two arms end on the
// seam close to the collector, so a single full-radius corner per port is enough.
const betaAttachCoreV21FinalOrthoBase=betaAttachCoreV21;
betaAttachCoreV21=function betaAttachCoreV21FinalOrtho(core){
  if(core?._doubleV21&&state.supply&&state.returnPoint){
    for(const c of [core,[...core].reverse()]){
      const s=state.supply,r=state.returnPoint,a=c[0],z=c.at(-1);
      const variants=[
        cleanRouteV8([s,{x:s.x,y:a.y},...c,{x:r.x,y:z.y},r]),
        cleanRouteV8([s,{x:a.x,y:s.y},...c,{x:z.x,y:r.y},r])
      ];
      for(const route of variants)if(route.length>3&&validRoute(route))return route;
    }
  }
  return betaAttachCoreV21FinalOrthoBase(core);
};

// Final naming polish for result cards / saved route labels.
const showEngineResultV21FinalNameBase=showEngineResultV1;
showEngineResultV1=function showEngineResultV21FinalName(plan){
  showEngineResultV21FinalNameBase(plan);
  const host=$('routeCandidates');if(!host)return;
  host.querySelectorAll('.route-empty').forEach(el=>{if(el.innerHTML.includes('V2.1-beta'))el.innerHTML=el.innerHTML.replaceAll('V2.1-beta','V2.2');});
};
async function generateRouteV21FinalRelease(){
  await generateRouteV21Final();
  if(typeof state.routeKind==='string')state.routeKind=state.routeKind.replaceAll('V2.1-beta','V2.2');
  if(state.enginePlanV1?.ok && state.enginePlanV1.circuits?.length){renderPlan();}
}
const genBtnV21FinalRelease=$('generateBtn');if(genBtnV21FinalRelease){try{genBtnV21FinalRelease.replaceWith(genBtnV21FinalRelease.cloneNode(true));}catch{}$('generateBtn')?.addEventListener('click',generateRouteV21FinalRelease);}


// ===== V2.2: automatic multi-cell comparison for concave / obstructed rooms =====
// Multi-cell does not mean multiple collectors. The same collector remains the
// hydraulic origin; cells are only local installation regions whose sweep
// direction may differ. Global and multi-cell candidates are compared first.
function multiCellOverlayV22(){
  const p=state.enginePlanV1;if(!p?.ok||p.planner!=='multi-cell'||!p.cellRects?.length)return'';
  const sc=Math.max(.001,state.scale||.1),fs=9/sc;
  let h='<g class="multi-cell-overlay-v22">';
  p.cellRects.forEach((r,i)=>{
    const ax=p.localAxes?.[i]?.axis||p.axis||'horizontal',arrow=ax==='vertical'?'↕':'↔';
    h+=`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/>`;
    h+=`<text x="${r.x+r.width/2}" y="${r.y+r.height/2}" font-size="${fs}">${String.fromCharCode(65+i)} · ${arrow}</text>`;
  });
  return h+'</g>';
}
const renderPlanV22Base=renderPlan;
renderPlan=function renderPlanV22(){renderPlanV22Base();const ov=multiCellOverlayV22();if(ov&&planSvg)planSvg.insertAdjacentHTML('beforeend',ov);};

const showEngineResultV22Base=showEngineResultV1;
showEngineResultV1=function showEngineResultV22(plan){
  showEngineResultV22Base(plan);if(!plan?.ok)return;
  const host=$('routeCandidates');if(!host)return;
  if(plan.planner==='multi-cell'&&plan.cellRects?.length){
    const axes=(plan.localAxes||[]).map((x,i)=>`${String.fromCharCode(65+i)}: ${x.axis==='vertical'?'вертикально':'горизонтально'}`).join(' · ');
    const note=document.createElement('div');note.className='route-empty compact multi-cell-note-v22';
    note.innerHTML=`<strong>Multi-cell:</strong> ${plan.cellRects.length} локальные области, один коллектор. ${axes||'Направления выбраны автоматически.'} Глобальный вариант тоже был проверен; локальная декомпозиция выбрана только потому, что дала лучший итог по качеству.`;
    host.appendChild(note);
  }
};

document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.2 · multi-cell optimizer'));

// ===== V2.2.1: понятный выбор укладки до расчёта =====
// Внутренние параметры (ось проходов, near/far и т.п.) остаются частью оптимизатора,
// но больше не показываются мастеру как основной UX.
state.layoutUserChoiceV221 = state.layoutUserChoiceV221 || 'auto';
state.layoutUserDirectionV221 = state.layoutUserDirectionV221 || 'auto';
state.layoutUserTurnV221 = state.layoutUserTurnV221 || 'auto';

function v221SimpleShape(){ try{return typeof simpleRectangleV21==='function' && simpleRectangleV21();}catch{return false;} }
function v221ChoiceTitle(mode){return mode==='spiral'?'Улитка':mode==='double-snake'?'Двойная змейка':mode==='snake'?'Обычная змейка':mode==='adaptive'?'Адаптивная':'Авто';}
function v221LongAxis(){try{return betaLongAxisV21();}catch{return (state.bounds?.width||0)>=(state.bounds?.height||0)?'horizontal':'vertical';}}
function v221AxisRelation(axis){if(!axis)return'';return axis===v221LongAxis()?'along':'across';}
function v221DirectionText(rel){return rel==='along'?'вдоль длинной стороны':rel==='across'?'поперёк длинной стороны':'';}
function v221CandidateKind(c){const k=c?.kind||'';if(k==='spiral')return'spiral';if(k==='double-snake')return'double-snake';if(k==='snake')return'snake';return k||'adaptive';}
function v221CandidateFriendly(c){
  if(!c)return'Авто';const k=v221CandidateKind(c),rel=v221AxisRelation(c.axis);
  if(k==='spiral')return'Улитка';
  if(k==='double-snake')return`Двойная змейка${rel?' · '+v221DirectionText(rel):''}`;
  if(k==='snake')return`Обычная змейка${rel?' · '+v221DirectionText(rel):''}`;
  return c.name?.replace(/V2\.1-beta|V2\.2/g,'').trim()||'Адаптивная';
}
function v221CandidateSub(c){
  if(!c)return'';const k=v221CandidateKind(c);
  if(k==='spiral') return c.turn==='cw'?'по часовой':c.turn==='ccw'?'против часовой':'направление выбрано автоматически';
  if(k==='snake'||k==='double-snake')return'точка начала выбрана автоматически от коллектора';
  return'локальная ориентация выбрана оптимизатором';
}
function v221Summary(){
  const step=((Number(state.pipeStepMm)||150)/1000).toFixed(2),lim=Math.round(Number(state.maxCircuitLengthM)||100),dia=Math.round(Number(state.pipeDiameterMm)||16);
  const cold=(state.coldWall&&state.coldWall!=='none')?` · холодная зона ${(Number(state.coldStepMm||100)/1000).toFixed(2)} м`:'';
  return `Труба Ø${dia} мм · шаг ${step} м · максимум ${lim} м на контур${cold}.`;
}
function v221SyncChooser(){
  document.querySelectorAll('[data-layout-choice-v221]').forEach(b=>b.classList.toggle('active',b.dataset.layoutChoiceV221===state.layoutUserChoiceV221));
  document.querySelectorAll('[data-layout-direction-v221]').forEach(b=>b.classList.toggle('active',b.dataset.layoutDirectionV221===state.layoutUserDirectionV221));
  document.querySelectorAll('[data-layout-turn-v221]').forEach(b=>b.classList.toggle('active',b.dataset.layoutTurnV221===state.layoutUserTurnV221));
  const m=state.layoutUserChoiceV221; $('layoutDirectionBlockV221')?.classList.toggle('hidden',!(m==='snake'||m==='double-snake'));
  $('layoutTurnBlockV221')?.classList.toggle('hidden',m!=='spiral');
  if($('layoutCalcSummaryV221'))$('layoutCalcSummaryV221').textContent=v221Summary();
}
function v221OpenChooser(){
  try{collectInputs();recomputeGeometry();}catch{}
  if(!v221SimpleShape() && !['auto','adaptive'].includes(state.layoutUserChoiceV221))state.layoutUserChoiceV221='auto';
  v221SyncChooser();openSheetV5('layoutChooserSheetV221');
}
function v221BestRequested(list){
  if(!list?.length)return null;const mode=state.layoutUserChoiceV221||'auto';
  if(mode==='auto')return betaPickAutoV21(list);
  let f=list.filter(c=>v221CandidateKind(c)===mode);
  if((mode==='snake'||mode==='double-snake')&&state.layoutUserDirectionV221!=='auto')f=f.filter(c=>v221AxisRelation(c.axis)===state.layoutUserDirectionV221);
  if(mode==='spiral'&&state.layoutUserTurnV221!=='auto')f=f.filter(c=>c.turn===state.layoutUserTurnV221);
  return [...f].sort((a,b)=>(a.score??a.length)-(b.score??b.length))[0]||null;
}
function v221UpdateVariantButton(){
  const btn=$('variantSwitchBtnV221'),lab=$('variantSwitchLabelV221');if(!btn||!lab)return;
  const list=state.routeCandidates||[],sel=list.find(c=>c.id===state.selectedRouteCandidate);
  let text=sel?v221CandidateFriendly(sel):state.enginePlanV1?.ok?'Адаптивная':state.route?.length?(state.routeKind||'Расчётный вариант'):'Авто';
  text=String(text).replace(/·\s*V2\.\d[^·]*/g,'').trim();lab.textContent=text;btn.hidden=!(state.route?.length||state.enginePlanV1?.ok);
}
function v221FamilyKey(c){
  const k=v221CandidateKind(c);if(k==='spiral')return'spiral';if(k==='snake'||k==='double-snake')return `${k}:${v221AxisRelation(c.axis)||'auto'}`;return k||c.id;
}
function v221FamilyTitle(c){return v221CandidateFriendly(c);}
function v221FriendlyCandidates(){
  const list=state.routeCandidates||[],groups=new Map();
  for(const c of list){const key=v221FamilyKey(c),old=groups.get(key),selected=c.id===state.selectedRouteCandidate;if(!old||selected||(!old.selected&&(c.score??c.length)<(old.c.score??old.c.length)))groups.set(key,{c,selected});}
  return [...groups.values()].map(x=>x.c).sort((a,b)=>(a.score??a.length)-(b.score??b.length));
}
function v221RenderAlternatives(){
  const host=$('routeCandidates');if(!host)return;const fam=v221FriendlyCandidates();let html='';
  const recommended=(fam[0]?.id)||null;
  for(const c of fam){const active=c.id===state.selectedRouteCandidate,rec=c.id===recommended&&state.layoutUserChoiceV221==='auto';html+=`<button type="button" class="route-card-v221${active?' active':''}" data-v221-candidate="${c.id}"><span><span class="r-title">${v221FamilyTitle(c)}${rec?'<span class="r-rec">Auto рекомендует</span>':''}</span><span class="r-sub">${v221CandidateSub(c)}</span></span><span><span class="r-len">${((Number(c.length)||routeLength(c.route||[]))/1000).toFixed(1)} м</span><span class="r-meta">${Number(c.bends)||0} поворотов</span></span></button>`;}
  const hasAdaptive=fam.some(c=>v221CandidateKind(c)==='adaptive')||state.enginePlanV1?.ok;
  if(v221SimpleShape()&&!hasAdaptive)html+=`<button type="button" class="route-card-v221" data-v221-family="adaptive"><span><span class="r-title">Адаптивная</span><span class="r-sub">проверить локальное разбиение и mixed-укладку</span></span><span><span class="r-meta">пересчитать</span></span></button>`;
  if(!html&&state.enginePlanV1?.ok)html=`<div class="route-empty compact"><strong>Адаптивная укладка</strong><br>Для сложной геометрии направление и локальные области выбраны автоматически.</div>`;
  host.innerHTML=html||'<div class="route-empty">Другие корректные варианты пока не найдены.</div>';
  host.querySelectorAll('[data-v221-candidate]').forEach(b=>b.addEventListener('click',()=>{betaSelectCandidateV21(b.dataset.v221Candidate);v221UpdateVariantButton();closeSheetV5();}));
  host.querySelectorAll('[data-v221-family]').forEach(b=>b.addEventListener('click',async()=>{closeSheetV5();await v221RecalculateFamily(b.dataset.v221Family);}));
  if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent='Выберите другой рисунок — схема изменится сразу';
  if($('routeSheetHelp'))$('routeSheetHelp').textContent='Warm скрывает технические дубли. Точку начала и подводку к коллектору оптимизатор выбирает автоматически.';
}
async function v221GenerateWithChoice(){
  const requested=state.layoutUserChoiceV221||'auto',dir=state.layoutUserDirectionV221||'auto',turn=state.layoutUserTurnV221||'auto';
  if(!v221SimpleShape()&&!['auto','adaptive'].includes(requested)){setStatus('Для сложной формы конкретную улитку/змейку пока лучше выбирать через Auto или «Адаптивная».',true);return;}
  closeSheetV5();
  // Генерируем полный набор внутренних вариантов; выбранные пользователем параметры
  // используются для выбора результата, а не для урезания списка альтернатив.
  state.layoutSchemeV21=requested==='adaptive'?'adaptive':'auto';state.layoutOrientationV21='auto';state.layoutEntryV21='auto';state.layoutTurnV21='auto';
  if($('layoutSchemeInput'))$('layoutSchemeInput').value=state.layoutSchemeV21;if($('layoutOrientationInput'))$('layoutOrientationInput').value='auto';if($('layoutEntryInput'))$('layoutEntryInput').value='auto';if($('layoutTurnInput'))$('layoutTurnInput').value='auto';
  setStatus(requested==='auto'?'Сравниваю способы укладки…':`Строю: ${v221ChoiceTitle(requested)}…`);
  await generateRouteV21FinalRelease();
  if(requested!=='adaptive'&&state.routeCandidates?.length){state.layoutUserDirectionV221=dir;state.layoutUserTurnV221=turn;const desired=v221BestRequested(state.routeCandidates);if(desired)betaSelectCandidateV21(desired.id);else if(requested!=='auto')setStatus(`${v221ChoiceTitle(requested)} с выбранным направлением не прошла геометрическую проверку. Показан лучший допустимый вариант.`,true);}
  state.layoutSchemeV21=requested;state.layoutOrientationV21=dir;state.layoutEntryV21='auto';state.layoutTurnV21=turn;
  if($('layoutSchemeInput'))$('layoutSchemeInput').value=requested;if($('layoutOrientationInput'))$('layoutOrientationInput').value=dir;if($('layoutEntryInput'))$('layoutEntryInput').value='auto';if($('layoutTurnInput'))$('layoutTurnInput').value=turn;
  closeSheetV5();v221RenderAlternatives();v221UpdateVariantButton();
  const sel=(state.routeCandidates||[]).find(c=>c.id===state.selectedRouteCandidate);if(sel)setStatus(`Готово: ${v221CandidateFriendly(sel)} · ${(sel.length/1000).toFixed(1)} м. Нажмите «Вариант», чтобы посмотреть другой рисунок.`);
}
async function v221RecalculateFamily(family){state.layoutUserChoiceV221=family;v221SyncChooser();await v221GenerateWithChoice();}

// Replace the old technical candidate sheet renderer with the friendly family list.
if(typeof betaShowCandidatesV21==='function'){
  const v221OldBetaShow=betaShowCandidatesV21;
  betaShowCandidatesV21=function v221BetaShow(list,selected){v221OldBetaShow(list,selected);v221RenderAlternatives();};
}

// Hide the old technical controls from the general settings. They remain in DOM
// for compatibility with the calculation core and saved schemes.
['layoutSchemeInput','layoutOrientationInput','layoutEntryInput','layoutTurnInput'].forEach(id=>$(id)?.closest('label')?.classList.add('legacy-layout-field-v221'));

// Main "Авто" button now opens the understandable pre-calculation chooser.
$('generateBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();v221OpenChooser();},true);
$('calculateLayoutV221')?.addEventListener('click',v221GenerateWithChoice);
$('variantSwitchBtnV221')?.addEventListener('click',()=>{v221RenderAlternatives();openSheetV5('routeSheet');});
document.querySelectorAll('[data-layout-choice-v221]').forEach(b=>b.addEventListener('click',()=>{state.layoutUserChoiceV221=b.dataset.layoutChoiceV221;if(!v221SimpleShape()&&!['auto','adaptive'].includes(state.layoutUserChoiceV221)){setStatus('Для сложной формы используйте Auto или «Адаптивная».',true);state.layoutUserChoiceV221='auto';}v221SyncChooser();}));
document.querySelectorAll('[data-layout-direction-v221]').forEach(b=>b.addEventListener('click',()=>{state.layoutUserDirectionV221=b.dataset.layoutDirectionV221;v221SyncChooser();}));
document.querySelectorAll('[data-layout-turn-v221]').forEach(b=>b.addEventListener('click',()=>{state.layoutUserTurnV221=b.dataset.layoutTurnV221;v221SyncChooser();}));

// Save only user-facing choices, not internal near/far candidate details.
const v221SerializeBase=serializeState;
serializeState=function serializeStateV221(){const o=v221SerializeBase();o.layoutUserChoiceV221=state.layoutUserChoiceV221||'auto';o.layoutUserDirectionV221=state.layoutUserDirectionV221||'auto';o.layoutUserTurnV221=state.layoutUserTurnV221||'auto';o.versionLabel='2.2.1';return o;};
const v221LoadBase=loadScheme;
loadScheme=function loadSchemeV221(raw){v221LoadBase(raw);state.layoutUserChoiceV221=raw?.layoutUserChoiceV221||raw?.layoutSchemeV21||'auto';state.layoutUserDirectionV221=raw?.layoutUserDirectionV221||raw?.layoutOrientationV21||'auto';state.layoutUserTurnV221=raw?.layoutUserTurnV221||raw?.layoutTurnV21||'auto';state.layoutEntryV21='auto';v221SyncChooser();v221UpdateVariantButton();};
const v221NewBase=newScheme;
newScheme=function newSchemeV221(){v221NewBase();state.layoutUserChoiceV221='auto';state.layoutUserDirectionV221='auto';state.layoutUserTurnV221='auto';state.layoutEntryV21='auto';v221SyncChooser();v221UpdateVariantButton();};

// Initial polish.
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.2.1 · понятный выбор укладки'));
v221SyncChooser();v221UpdateVariantButton();

// ===== V2.2.2: collector controls + one/two cold walls =====
// This layer keeps V2.2.1 planning intact and makes the manifold/edge-zone controls
// explicit for installers. Older saved projects remain compatible through state.coldWall.

if(!Array.isArray(state.coldWallsV222)){
  state.coldWallsV222=(state.coldWall&&state.coldWall!=='none')?[state.coldWall]:[];
}
if(typeof state.flowReversedV222!=='boolean')state.flowReversedV222=false;

function v222ColdWalls(){
  const valid=['top','right','bottom','left'];
  const src=Array.isArray(state.coldWallsV222)?state.coldWallsV222:[];
  return [...new Set(src.filter(x=>valid.includes(x)))].slice(0,2);
}
function v222SideLabel(s){return({top:'сверху',right:'справа',bottom:'снизу',left:'слева'})[s]||s;}
function v222WallAxis(side){return(side==='top'||side==='bottom')?'horizontal':'vertical';}
function v222SyncLegacyColdWall(){
  const walls=v222ColdWalls();
  state.coldWallsV222=walls;
  state.coldWall=walls[0]||'none';
  if($('coldWallInput'))$('coldWallInput').value=state.coldWall;
  if($('coldBandWidthInput'))$('coldBandWidthInput').value=((Number(state.coldBandMm)||800)/1000).toFixed(2);
  if($('coldStepInput'))$('coldStepInput').value=((Number(state.coldStepMm)||100)/1000).toFixed(2);
}
function v222ColdActive(){
  return v222ColdWalls().length>0&&Number(state.coldBandMm)>0&&Number(state.coldStepMm)>0&&Number(state.coldStepMm)<Number(state.pipeStepMm||150)-1;
}

// Generalise the V2.1 local-pitch helpers from one wall to one/two walls.
finalColdActiveV21=function finalColdActiveV222(){return v222ColdActive();};
finalColdParallelAxisV21=function finalColdParallelAxisV222(){const w=v222ColdWalls()[0];return w?v222WallAxis(w):null;};
finalVariableLanePositionsV21=function finalVariableLanePositionsV222(axis){
  const r=betaInnerRectV21(),main=Math.max(50,Number(state.pipeStepMm)||150);
  const min=axis==='horizontal'?r.top:r.left,max=axis==='horizontal'?r.bottom:r.right;
  if(max-min<main*.55)return[];
  const relevant=v222ColdWalls().filter(w=>v222WallAxis(w)===axis);
  if(!v222ColdActive()||!relevant.length)return betaLanePositionsV21(min,max,main);
  const cold=Math.max(50,Math.min(main,Number(state.coldStepMm)||100));
  const band=Math.max(cold,Math.min((max-min)/2,Number(state.coldBandMm)||800));
  const minSide=axis==='horizontal'?'top':'left',maxSide=axis==='horizontal'?'bottom':'right';
  const minCold=relevant.includes(minSide),maxCold=relevant.includes(maxSide);
  const raw=[min];let x=min;
  if(minCold){const edge=Math.min(max,min+band);while(x+cold<=edge+1){x+=cold;raw.push(x);}}
  const interiorEnd=maxCold?Math.max(x,max-band):max;
  while(x+main<=interiorEnd+1){x+=main;raw.push(x);}
  if(maxCold){
    const edge=Math.max(min,max-band);
    if(x<edge-cold*.45){x=edge;raw.push(x);}else x=raw.at(-1);
    while(x+cold<=max+1){x+=cold;raw.push(x);}
  }else if(max-raw.at(-1)>main*.62)raw.push(max);
  if(Math.abs(raw.at(-1)-max)>1&&maxCold)raw.push(max);
  const out=[];for(const q of raw.sort((a,b)=>a-b)){if(!out.length||q-out.at(-1)>Math.min(cold,main)*.42)out.push(q);}
  return out;
};
function v222PointInsideColdBand(p,side){
  const b=state.bounds,band=Math.max(0,Number(state.coldBandMm)||800);
  if(side==='top')return p.y<=b.minY+band;
  if(side==='bottom')return p.y>=b.maxY-band;
  if(side==='left')return p.x<=b.minX+band;
  return p.x>=b.maxX-band;
}
function v222ColdLengthForWall(route,side){
  if(!route?.length)return 0;let sum=0;
  for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],l=dist(a,b),ia=v222PointInsideColdBand(a,side),ib=v222PointInsideColdBand(b,side);if(ia&&ib)sum+=l;else if(ia||ib)sum+=l*.5;}
  return sum;
}
finalColdLengthInBandV21=function finalColdLengthInBandV222(route){
  if(!v222ColdActive())return 0;const walls=v222ColdWalls();let sum=0;
  // Sum per wall; corner overlap is intentionally modestly rewarded because it is the coldest area.
  for(const w of walls)sum+=v222ColdLengthForWall(route,w);return sum;
};
const betaRouteScoreV222Base=betaRouteScoreV21;
betaRouteScoreV21=function betaRouteScoreV222(c){
  let score=betaRouteScoreV222Base(c),walls=v222ColdWalls();if(!v222ColdActive()||walls.length<2)return score;
  const second=walls[1],frac=v222ColdLengthForWall(c.route,second)/Math.max(1,c.length),parallel=c.axis===v222WallAxis(second);
  score-=frac*12000;if(parallel)score-=3500;else if(c.kind!=='spiral')score+=3200;if(c.kind==='spiral')score+=2600;return score;
};
finalColdBandSvgV21=function finalColdBandSvgV222(){
  if(!v222ColdActive())return'';const b=state.bounds,walls=v222ColdWalls(),sc=Math.max(.001,state.scale||.1),fs=7.5/sc;let h='<g class="cold-band-v222">';
  walls.forEach((side,i)=>{const band=Math.min(Number(state.coldBandMm)||800,(side==='left'||side==='right')?b.width:b.height);let x=b.minX,y=b.minY,ww=b.width,hh=b.height;
    if(side==='top')hh=band;else if(side==='bottom'){y=b.maxY-band;hh=band;}else if(side==='left')ww=band;else{x=b.maxX-band;ww=band;}
    const lx=x+8/sc,ly=y+(i===0?14:27)/sc;h+=`<rect x="${x}" y="${y}" width="${ww}" height="${hh}"/><text x="${lx}" y="${ly}" font-size="${fs}">❄ ${v222SideLabel(side)} · ${(Number(state.coldStepMm||100)/1000).toFixed(2)} м</text>`;
  });return h+'</g>';
};
finalColdUiInfoV21=function finalColdUiInfoV222(){
  const el=$('coldWallInfoV21'),walls=v222ColdWalls(),active=v222ColdActive();if(!el)return;el.classList.toggle('good',active);
  el.textContent=!walls.length?'Холодные стены выключены.':active?`Холодные стены: ${walls.map(v222SideLabel).join(' + ')} · полоса ${(Number(state.coldBandMm||800)/1000).toFixed(2)} м · локальный шаг ${(Number(state.coldStepMm||100)/1000).toFixed(2)} м.`:'Локальный шаг у холодной стены должен быть меньше основного шага трубы.';
};

function v222SyncColdWallsUI(){
  const walls=v222ColdWalls();v222SyncLegacyColdWall();
  document.querySelectorAll('[data-cold-side-v222]').forEach(b=>b.classList.toggle('active',walls.includes(b.dataset.coldSideV222)));
  if($('coldWallCountV222'))$('coldWallCountV222').textContent=`${walls.length} / 2`;
  if($('coldBandWidthInputV222'))$('coldBandWidthInputV222').value=((Number(state.coldBandMm)||800)/1000).toFixed(2);
  if($('coldStepInputV222'))$('coldStepInputV222').value=((Number(state.coldStepMm)||100)/1000).toFixed(2);
  const names=walls.length?walls.map(v222SideLabel).join(' + '):'Не выбраны';
  if($('coldWallsSettingsSummaryV222'))$('coldWallsSettingsSummaryV222').textContent=walls.length?`${names} · шаг ${(Number(state.coldStepMm||100)/1000).toFixed(2)} м`:'Не выбраны';
  if($('coldWallHintV222'))$('coldWallHintV222').textContent=!walls.length?'Холодные стены не выбраны.':walls.length===1?`Выбрана одна стена: ${names}. Можно добавить ещё одну.`:`Выбраны две стены: ${names}. Для них используется общий локальный шаг.`;
  finalColdUiInfoV21();
}
function v222OpenColdWalls(){v222SyncColdWallsUI();openSheetV5('coldWallsSheetV222');}
document.querySelectorAll('[data-cold-side-v222]').forEach(btn=>btn.addEventListener('click',()=>{
  const side=btn.dataset.coldSideV222,walls=v222ColdWalls();
  if(walls.includes(side))state.coldWallsV222=walls.filter(x=>x!==side);else if(walls.length<2)state.coldWallsV222=[...walls,side];else{setStatus('Можно выбрать не более двух холодных стен.',true);return;}v222SyncColdWallsUI();
}));
$('coldWallsSettingsBtnV222')?.addEventListener('click',v222OpenColdWalls);
$('openColdWallsFromCollectorV222')?.addEventListener('click',()=>{closeSheetV5(false);v222OpenColdWalls();});
$('clearColdWallsV222')?.addEventListener('click',()=>{state.coldWallsV222=[];v222SyncColdWallsUI();});
$('applyColdWallsV222')?.addEventListener('click',()=>{
  state.coldBandMm=clamp((Number($('coldBandWidthInputV222')?.value)||.8)*1000,100,3000);
  state.coldStepMm=clamp((Number($('coldStepInputV222')?.value)||.1)*1000,50,Math.max(50,Number(state.pipeStepMm)||150));
  v222SyncLegacyColdWall();v222SyncColdWallsUI();renderPlan();closeSheetV5();setStatus(v222ColdWalls().length?'Холодные стены сохранены. Нажмите «Авто», чтобы пересчитать укладку с локальным шагом.':'Холодные стены отключены.');
});

function v222CollectorSide(){return state.supply?.side||state.returnPoint?.side||nearestBoundaryPoint(state.supply?.x||0,state.supply?.y||0)?.side||'bottom';}
function v222CollectorOrder(){
  if(!state.supply||!state.returnPoint)return[];const side=v222CollectorSide(),vertical=side==='left'||side==='right';
  return [{kind:'supply',p:state.supply},{kind:'return',p:state.returnPoint}].sort((a,b)=>vertical?a.p.y-b.p.y:a.p.x-b.p.x);
}
function v222CollectorOrderText(){
  const o=v222CollectorOrder(),side=v222CollectorSide();if(o.length<2)return'Коллектор ещё не установлен';const names={supply:'подача',return:'обратка'};
  return(side==='left'||side==='right')?`Сверху: ${names[o[0].kind]} · снизу: ${names[o[1].kind]}`:`Слева: ${names[o[0].kind]} · справа: ${names[o[1].kind]}`;
}
function v222SyncCollectorPreview(){
  const host=$('collectorPreviewV222');if(!host)return;if(!state.supply||!state.returnPoint){host.innerHTML='<div class="collector-preview-card-v222"><div class="collector-preview-title-v222"><b>Коллектор не установлен</b><small>Сначала выберите место на стене</small></div></div>';return;}
  const o=v222CollectorOrder();host.innerHTML=`<div class="collector-preview-card-v222"><div class="collector-preview-title-v222"><b>Коллектор</b><small>${v222CollectorOrderText()}</small></div><div class="collector-mini-line-v222">${o.map(q=>`<div class="collector-mini-port-v222 ${q.kind}"><span class="dot"></span><span>${q.kind==='supply'?'Подача':'Обратка'}</span><span class="flow">${q.kind==='supply'?'→':'←'}</span></div>`).join('')}</div></div>`;
}
function v222OpenCollectorSheet(){v222SyncCollectorPreview();openSheetV5('collectorSheetV222');}
function v222ResetManualIfSafe(){
  if(state.manualV2?.dirty){setStatus('Сначала завершите или сбросьте ручную правку: смена портов сделает её недействительной.',true);return false;}
  if(typeof blankManualStateV2A==='function')state.manualV2=blankManualStateV2A();return true;
}
function v222SwapPortsForRecalc(){
  if(!state.supply||!state.returnPoint)return;if(!v222ResetManualIfSafe())return;
  try{pushHistoryV5?.();}catch{}const a={...state.supply};state.supply={...state.returnPoint};state.returnPoint=a;resetRoute();state.routeCandidates=[];state.selectedRouteCandidate=null;v222SyncCollectorPreview();renderPlan();setStatus('Подача и обратка поменяны местами. Нажмите «Авто», чтобы построить раскладку для нового порядка портов.');
}
function v222RemapManualLocksAfterReverse(){
  const m=state.manualV2;if(!m?.locked?.length)return;const out=[];for(const key of m.locked){const [ci,si]=String(key).split(':').map(Number),n=m.circuits?.[ci]?.route?.length||0;if(n>=2&&si>=0&&si<n-1)out.push(`${ci}:${n-2-si}`);}m.locked=out;
}
function v222ReverseCurrentFlow(){
  if(!state.supply||!state.returnPoint)return;if(state.manualV2?.detachedTail){setStatus('Сначала закройте разрыв ручной трассы, затем разворачивайте поток.',true);return;}
  try{pushHistoryV5?.();}catch{}
  const a={...state.supply};state.supply={...state.returnPoint};state.returnPoint=a;
  if(state.enginePlanV1?.ok&&Array.isArray(state.enginePlanV1.circuits))for(const c of state.enginePlanV1.circuits){if(Array.isArray(c.route))c.route=[...c.route].reverse();if(Array.isArray(c.core))c.core=[...c.core].reverse();}
  if(Array.isArray(state.route)&&state.route.length)state.route=[...state.route].reverse();
  if(Array.isArray(state.routeCandidates))for(const c of state.routeCandidates){if(Array.isArray(c.route))c.route=[...c.route].reverse();const sp=c.supplyPoint;c.supplyPoint=c.returnPoint;c.returnPoint=sp;}
  if(state.manualV2?.circuits?.length){v222RemapManualLocksAfterReverse();for(const c of state.manualV2.circuits)if(Array.isArray(c.route))c.route=[...c.route].reverse();for(const c of state.manualV2.baseline||[])if(Array.isArray(c.route))c.route=[...c.route].reverse();}
  state.flowReversedV222=!state.flowReversedV222;v222SyncCollectorPreview();renderPlan();setStatus('Поток развёрнут: геометрия трубы сохранена, подача и обратка поменяли направление по текущей схеме.');
}
$('swapCollectorPortsV222')?.addEventListener('click',v222SwapPortsForRecalc);
$('reverseFlowV222')?.addEventListener('click',v222ReverseCurrentFlow);
$('moveCollectorV222')?.addEventListener('click',()=>{closeSheetV5(false);if(typeof setModeV6==='function')setModeV6('collector6');else setMode('collector');setStatus('Коснитесь стены в новом месте коллектора.');});

// If a collector already exists, the dock button opens its settings. If not, the old placement flow remains.
$('collectorToolBtn')?.addEventListener('click',e=>{if(state.supply&&state.returnPoint){e.preventDefault();e.stopImmediatePropagation();v222OpenCollectorSheet();}},true);

function v222CollectorBadgeSvg(){
  if(!state.supply||!state.returnPoint)return'';const sc=Math.max(.001,state.scale||.1),side=v222CollectorSide(),mid={x:(state.supply.x+state.returnPoint.x)/2,y:(state.supply.y+state.returnPoint.y)/2};
  const bw=108/sc,bh=36/sc,gap=34/sc;let cx=mid.x,cy=mid.y;if(side==='bottom')cy+=gap;else if(side==='top')cy-=gap;else if(side==='left')cx=state.bounds.minX+62/sc;else cx=state.bounds.maxX-62/sc;
  const x=cx-bw/2,y=cy-bh/2,leaderX=side==='left'?x+bw:side==='right'?x:cx,leaderY=side==='top'?y+bh:side==='bottom'?y:cy,fs=8/sc,small=6.8/sc,r=4.3/sc;
  const ordered=v222CollectorOrder(),slots=[cx-bw*.23,cx+bw*.23];let h=`<g class="engineering-collector-badge-v222"><line class="leader" x1="${mid.x}" y1="${mid.y}" x2="${leaderX}" y2="${leaderY}"/><rect class="card" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${9/sc}" ry="${9/sc}"/><text class="title" x="${cx}" y="${y+10/sc}" text-anchor="middle" font-size="${fs}">Коллектор</text>`;
  ordered.forEach((q,i)=>{const sx=slots[i],sy=y+25/sc,cls=q.kind==='supply'?'supply':'return',label=q.kind==='supply'?'Подача':'Обратка',arrow=q.kind==='supply'?'→':'←';h+=`<circle class="${cls}-dot" cx="${sx-19/sc}" cy="${sy-1.5/sc}" r="${r}"/><text class="port-label" x="${sx-11/sc}" y="${sy}" font-size="${small}">${label}</text><text class="${cls}-arrow" x="${sx+17/sc}" y="${sy}" font-size="${fs}" text-anchor="middle">${arrow}</text>`;});
  return h+'</g>';
}
function v222CleanLegacyCollectorMarks(){
  if(!planSvg)return;for(const t of [...planSvg.querySelectorAll('text')]){const s=(t.textContent||'').trim();if(s==='Подача'||s==='Обратка')t.remove();}
  planSvg.querySelectorAll('circle[fill="#10b981"],circle[fill="#f59e0b"]').forEach(n=>n.remove());planSvg.querySelectorAll('line[stroke="#f97316"]').forEach(n=>{if(!n.classList.length)n.remove();});
}
const renderPlanV222Base=renderPlan;
renderPlan=function renderPlanV222(){renderPlanV222Base();v222CleanLegacyCollectorMarks();const badge=v222CollectorBadgeSvg();if(badge&&planSvg)planSvg.insertAdjacentHTML('beforeend',badge);v222SyncColdWallsUI();};

// Persistence and backwards compatibility.
const serializeStateV222Base=serializeState;
serializeState=function serializeStateV222(){const o=serializeStateV222Base();o.coldWallsV222=v222ColdWalls();o.flowReversedV222=!!state.flowReversedV222;o.versionLabel='2.2.2';return o;};
const loadSchemeV222Base=loadScheme;
loadScheme=function loadSchemeV222(raw){loadSchemeV222Base(raw);state.coldWallsV222=Array.isArray(raw?.coldWallsV222)?raw.coldWallsV222.slice(0,2):((raw?.coldWall&&raw.coldWall!=='none')?[raw.coldWall]:[]);state.flowReversedV222=!!raw?.flowReversedV222;v222SyncLegacyColdWall();v222SyncColdWallsUI();v222SyncCollectorPreview();renderPlan();};
const newSchemeV222Base=newScheme;
newScheme=function newSchemeV222(){newSchemeV222Base();state.coldWallsV222=[];state.flowReversedV222=false;v222SyncLegacyColdWall();v222SyncColdWallsUI();v222SyncCollectorPreview();renderPlan();};

// Keep shared cold-zone inputs synchronised if their values are changed elsewhere.
for(const id of ['pipeStepInput','coldBandWidthInput','coldStepInput'])$(id)?.addEventListener('change',()=>{v222SyncLegacyColdWall();v222SyncColdWallsUI();});

document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.2.2 · коллектор + холодные стены'));
v222SyncLegacyColdWall();v222SyncColdWallsUI();v222SyncCollectorPreview();renderPlan();

// ===== V2.3: paired manual return, complex-room spiral and two collectors =====
// This layer keeps V2.2's optimizer intact and adds three orthogonal capabilities:
// 1) manual "paired return" for drawing a spiral-like feed path;
// 2) local spiral fields for preset L/T rooms;
// 3) optional second collector with automatic circuit assignment.

state.manualPairedReturnV23 = !!state.manualPairedReturnV23;
state.collectorCountV23 = Math.max(1, Math.min(2, Number(state.collectorCountV23)||1));
state.collectorsV23 = Array.isArray(state.collectorsV23) ? state.collectorsV23 : [];
state.collectorSetupV23 = state.collectorSetupV23 || {active:false,count:1,index:0};

function v23ClonePort(p){return p?{x:Number(p.x),y:Number(p.y),side:p.side}:null;}
function v23PrimaryCollector(){return state.supply&&state.returnPoint?{supply:v23ClonePort(state.supply),returnPoint:v23ClonePort(state.returnPoint),label:'К1'}:null;}
function v23SyncCollectors(){
  const p=v23PrimaryCollector();
  if(p){if(!state.collectorsV23[0])state.collectorsV23[0]=p;else state.collectorsV23[0]={...state.collectorsV23[0],...p,label:'К1'};}
  state.collectorsV23=state.collectorsV23.filter(Boolean).slice(0,2);
  state.collectorCountV23=Math.max(1,Math.min(2,Number(state.collectorCountV23)||state.collectorsV23.length||1));
  document.body.classList.toggle('v23-two-collectors',state.collectorCountV23===2);
  const st=$('secondCollectorStatusV23');if(st)st.textContent=state.collectorsV23[1]?'К2 установлен · коснитесь, чтобы перенести или удалить':'Добавить второй коллектор и распределить контуры между двумя точками';
}
function v23CollectorFromNear(near,label){return{supply:{x:near.x,y:near.y,side:near.side},returnPoint:adjacentReturnForSupply(near),label};}
function v23SetCollector(index,col){
  state.collectorsV23[index]={supply:v23ClonePort(col.supply),returnPoint:v23ClonePort(col.returnPoint),label:`К${index+1}`};
  if(index===0){state.supply=v23ClonePort(col.supply);state.returnPoint=v23ClonePort(col.returnPoint);}
  v23SyncCollectors();
}
function v23CollectorCountUI(){document.querySelectorAll('[data-collector-count-v23]').forEach(b=>b.classList.toggle('active',Number(b.dataset.collectorCountV23)===state.collectorCountV23));}
function v23OpenCollectorCount(){v23SyncCollectors();v23CollectorCountUI();openSheetV5('collectorCountSheetV23');}
function v23BeginCollectorSetup(count,index=0){
  count=Math.max(1,Math.min(2,Number(count)||1));state.collectorCountV23=count;state.collectorSetupV23={active:true,count,index};
  if(index===0){state.collectorsV23=[];state.supply=null;state.returnPoint=null;resetRoute();}
  closeSheetV5(false);if(typeof setModeV6==='function')setModeV6('collector6');else setMode('collector');
  setStatus(count===2?(index===0?'Поставьте первый коллектор К1 на стене. После этого сразу поставим К2.':'Поставьте второй коллектор К2 на стене.'):'Коснитесь стены в месте коллектора.');
}
document.querySelectorAll('[data-collector-count-v23]').forEach(b=>b.addEventListener('click',()=>{state.collectorCountV23=Number(b.dataset.collectorCountV23)||1;v23CollectorCountUI();}));
$('startCollectorSetupV23')?.addEventListener('click',()=>v23BeginCollectorSetup(state.collectorCountV23,0));
$('secondCollectorV23')?.addEventListener('click',()=>{
  if(state.collectorsV23[1]){if(confirm('Второй коллектор уже установлен. Перенести К2?'))v23BeginCollectorSetup(2,1);return;}
  state.collectorCountV23=2;v23BeginCollectorSetup(2,1);
});

// Ask how many collectors before the first collector is placed.
$('collectorToolBtn')?.addEventListener('click',e=>{
  if(!state.supply&&!state.collectorSetupV23?.active){e.preventDefault();e.stopImmediatePropagation();v23OpenCollectorCount();}
},true);

// Capture collector placement while the V2.3 setup wizard is active.
planSvg.addEventListener('pointerdown',e=>{
  const s=state.collectorSetupV23;if(!s?.active||state.mode!=='collector6'||e.button>0)return;
  const p=svgPointFromEvent(e);if(!p)return;const near=nearestBoundaryPoint(p.x,p.y);if(!near)return;
  e.preventDefault();e.stopImmediatePropagation();try{pushHistoryV5?.();}catch{}
  const idx=s.index,col=v23CollectorFromNear(near,`К${idx+1}`);v23SetCollector(idx,col);resetRoute();
  if(s.count===2&&idx===0){state.collectorSetupV23={active:true,count:2,index:1};setStatus('К1 установлен. Теперь поставьте второй коллектор К2.');renderPlan();return;}
  state.collectorSetupV23={active:false,count:s.count,index:0};if(typeof setModeV6==='function')setModeV6('inspect');else setMode('inspect');
  setStatus(s.count===2?'Оба коллектора установлены. При расчёте Warm распределит контуры между К1 и К2.':'Коллектор установлен.');renderPlan();
},true);

// ----- Manual paired return -------------------------------------------------
function v23SegNormal(a,b,sideSign){
  const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)>1&&Math.abs(dy)>1)return null;
  if(Math.abs(dx)>=Math.abs(dy)){const dir=dx>=0?1:-1;return{x:0,y:-dir*sideSign};}
  const dir=dy>=0?1:-1;return{x:dir*sideSign,y:0};
}
function v23OffsetOrtho(points,offset,sideSign){
  const p=manualCleanOrthoV2A(points);if(p.length<2)return null;const ns=[];
  for(let i=1;i<p.length;i++){const n=v23SegNormal(p[i-1],p[i],sideSign);if(!n)return null;ns.push(n);}
  const out=[];out.push({x:p[0].x+ns[0].x*offset,y:p[0].y+ns[0].y*offset});
  for(let i=1;i<p.length-1;i++){
    const n0=ns[i-1],n1=ns[i],a=p[i-1],v=p[i],b=p[i+1],h0=Math.abs(a.y-v.y)<1,h1=Math.abs(v.y-b.y)<1;
    if(h0===h1){if(n0.x*n1.x+n0.y*n1.y<-.5)return null;out.push({x:v.x+n1.x*offset,y:v.y+n1.y*offset});continue;}
    if(h0&&!h1)out.push({x:v.x+n1.x*offset,y:v.y+n0.y*offset});
    else out.push({x:v.x+n0.x*offset,y:v.y+n1.y*offset});
  }
  const nl=ns.at(-1),z=p.at(-1);out.push({x:z.x+nl.x*offset,y:z.y+nl.y*offset});return manualCleanOrthoV2A(out);
}
function v23PairedRouteCandidates(trace){
  if(!trace?.length||trace.length<2||!state.returnPoint)return[];const step=Math.max(50,Number(state.pipeStepMm)||150),out=[];
  for(const sign of [1,-1])for(const factor of [1,.92,1.08]){
    const off=v23OffsetOrtho(trace,step*factor,sign);if(!off?.length)continue;const rev=[...off].reverse(),end=trace.at(-1),mate=rev[0];
    const centerLinks=manualConnectorVariantsV20(end,mate).slice(0,4);
    for(const cl of centerLinks){
      let base=manualCleanOrthoV2A([...trace,...cl.slice(1),...rev.slice(1)]);if(!manualHardRouteV2A(base))continue;
      const tailStart=base.at(-1),tails=manualConnectorVariantsV20(tailStart,state.returnPoint);
      for(const tl of tails){const route=manualCleanOrthoV2A([...base,...tl.slice(1)]);if(manualHardRouteV2A(route))out.push({route,length:routeLength(route),offset:step*factor,sign});}
    }
  }
  out.sort((a,b)=>a.length-b.length);return out;
}
function v23SyncPairedUI(){const b=$('manualPairedReturnV23');if(!b)return;b.classList.toggle('active',!!state.manualPairedReturnV23);b.setAttribute('aria-pressed',state.manualPairedReturnV23?'true':'false');}
$('manualPairedReturnV23')?.addEventListener('click',()=>{state.manualPairedReturnV23=!state.manualPairedReturnV23;v23SyncPairedUI();setStatus(state.manualPairedReturnV23?'Парная обратка включена: на новом контуре рисуйте путь подачи внутрь — возврат появится автоматически.':'Парная обратка выключена.');});

const manualCommitDrawV23Base=manualCommitDrawV2B1;
manualCommitDrawV2B1=function manualCommitDrawV23(ci,add){
  const m=state.manualV2,c=m?.circuits?.[ci];
  if(state.manualPairedReturnV23&&c&&!m.detachedTail&&c.route?.length<=2){
    const trace=manualCleanOrthoV2A([...clonePointsV2A(c.route),...clonePointsV2A(add).slice(1)]),cand=v23PairedRouteCandidates(trace)[0];
    if(cand){manualPushHistoryV2A();c.route=cand.route;m.currentCircuit=ci;m.dirty=true;return{ok:true,paired:true,kind:'paired-return',length:cand.length};}
  }
  return manualCommitDrawV23Base(ci,add);
};
const manualDrawStatusV23Base=manualDrawStatusV2B1;
manualDrawStatusV2B1=function manualDrawStatusV23(result){return result?.paired?'Парная обратка построена: подача и возврат проложены рядом и контур возвращён к коллектору.':manualDrawStatusV23Base(result);};
const manualPreviewOverlayV23Base=manualPreviewOverlayV2A;
manualPreviewOverlayV2A=function manualPreviewOverlayV23(){let h=manualPreviewOverlayV23Base();if(state.manualPairedReturnV23&&manualDrawV2A.active&&manualDrawV2A.preview?.length>1){const off=v23OffsetOrtho(manualDrawV2A.preview,Math.max(50,Number(state.pipeStepMm)||150),1)||v23OffsetOrtho(manualDrawV2A.preview,Math.max(50,Number(state.pipeStepMm)||150),-1);if(off?.length){const d='M '+off.map(p=>`${p.x} ${p.y}`).join(' L ');h+=`<path class="manual-paired-preview-v23" d="${d}"/>`;}}return h;};

// Move local runs using a local snap origin rather than the global room origin.
// This fixes L/T/multi-cell plans whose lane phases differ between cells.
manualSegmentCandidateV2A=function manualSegmentCandidateV23(ci,si,p){
  const m=state.manualV2,c=m.circuits?.[ci];if(!c)return null;const original=clonePointsV2A(c.route),a0=original[si],b0=original[si+1];if(!a0||!b0)return null;const h=Math.abs(a0.y-b0.y)<=Math.abs(a0.x-b0.x),step=Math.max(50,Number(state.pipeStepMm)||150),target=manualTenSnapV2A(h?p.y:p.x),base=h?a0.y:a0.x;
  const vals=[target,base+Math.round((target-base)/step)*step,base+Math.floor((target-base)/step)*step,base+Math.ceil((target-base)/step)*step];
  const uniq=[...new Set(vals.map(v=>Math.round(v/10)*10))].sort((a,b)=>Math.abs(a-target)-Math.abs(b-target));
  for(const v of uniq){const r=clonePointsV2A(original),a=r[si],b=r[si+1];if(h){a.y=v;b.y=v;}else{a.x=v;b.x=v;}const cand=manualCleanOrthoV2A(r);if(manualHardRouteV2A(cand))return cand;}
  return null;
};

// ----- L/T local spiral -----------------------------------------------------
function v23PresetComplexSpiralPossible(){return ['L','T'].includes(state.shapeType)&&state.sections?.length===2&&!state.obstacles?.length;}
function v23EdgeShared(rect,side){const eps=4,mx=rect.x+rect.width/2,my=rect.y+rect.height/2;let p;if(side==='left')p={x:rect.x-eps,y:my};if(side==='right')p={x:rect.x+rect.width+eps,y:my};if(side==='top')p={x:mx,y:rect.y-eps};if(side==='bottom')p={x:mx,y:rect.y+rect.height+eps};return p?insideRoom(p.x,p.y,true)&&!pointExcluded(p.x,p.y):false;}
function v23CellInner(rect){const off=Math.max(0,Number(state.wallOffsetMm)||0),step=Math.max(50,Number(state.pipeStepMm)||150),shared=Math.max(25,step*.32);const L=v23EdgeShared(rect,'left')?shared:off,R=v23EdgeShared(rect,'right')?shared:off,T=v23EdgeShared(rect,'top')?shared:off,B=v23EdgeShared(rect,'bottom')?shared:off;return{left:rect.x+L,right:rect.x+rect.width-R,top:rect.y+T,bottom:rect.y+rect.height-B};}
function v23MirrorLocalCore(core,w,h,mx,my){return core.map(p=>({x:mx?w-p.x:p.x,y:my?h-p.y:p.y}));}
function v23CellSpiralVariants(rect){
  const i=v23CellInner(rect),w=i.right-i.left,h=i.bottom-i.top,step=Math.max(50,Number(state.pipeStepMm)||150);if(w<step*2.4||h<step*2.4)return[];const raw=spiralCoreCandidatesV8(w,h,step),out=[],seen=new Set();
  for(const base of raw)for(const mx of [false,true])for(const my of [false,true])for(const rev of [false,true]){let q=v23MirrorLocalCore(base,w,h,mx,my).map(p=>({x:p.x+i.left,y:p.y+i.top}));if(rev)q=[...q].reverse();q=cleanRouteV8(q);if(q.length<4||!manualHardRouteV2A(q))continue;const key=q.slice(0,6).map(p=>`${Math.round(p.x)},${Math.round(p.y)}`).join(';')+'|'+Math.round(routeLength(q));if(seen.has(key))continue;seen.add(key);out.push(q);}return out.sort((a,b)=>routeLength(b)-routeLength(a)).slice(0,8);
}
function v23SafeJoin(A,B,whole){
  const tries=manualConnectorVariantsV20(A,B);const grid=routeGridPathV12(A,B,whole?[whole]:[]);if(grid)tries.push(grid);
  for(const c of tries){if(c?.length>1&&c.every((p,i)=>!i||coreSegmentSafeV12(c[i-1],p,0)))return c;}return null;
}
function v23AttachCoreToCollector(core,col){if(!core?.length||!col)return null;return attachComplexPortsV12(core,{supply:col.supply,ret:col.returnPoint,supplySide:col.supply.side,returnSide:col.returnPoint.side});}
function v23ComplexSpiralPlan(){
  if(!v23PresetComplexSpiralPossible())return null;v23SyncCollectors();const col=state.collectorsV23[0]||v23PrimaryCollector();if(!col)return null;const cells=state.sections.map(r=>({...r})),vars=cells.map(v23CellSpiralVariants);if(vars.some(v=>!v.length))return null;const orders=[[0,1],[1,0]],combined=[];
  for(const ord of orders)for(const a of vars[ord[0]].slice(0,5))for(const b of vars[ord[1]].slice(0,5)){
    const lead=routedConnectorV12(col.supply,a[0],col.supply.side,[a,b])||connectorVariantsV12(col.supply,a[0],col.supply.side).find(c=>c.every((p,i)=>!i||coreSegmentSafeV12(c[i-1],p,0)));if(!lead)continue;
    const join=v23SafeJoin(a.at(-1),b[0],a);if(!join)continue;const core=manualCleanOrthoV2A([...lead,...a.slice(1),...join.slice(1),...b.slice(1)]);
    const tail0=routedConnectorV12(col.returnPoint,core.at(-1),col.returnPoint.side,[core]);if(!tail0)continue;const route=manualCleanOrthoV2A([...core,...[...tail0].reverse().slice(1)]);if(!manualHardRouteV2A(route))continue;combined.push(route);
  }
  combined.sort((a,b)=>routeLength(a)-routeLength(b));const max=(Number(state.maxCircuitLengthM)||100)*1000;
  if(combined.length&&routeLength(combined[0])<=max*1.015){const r=combined[0];return{ok:true,version:'2.3-complex-spiral',planner:'multi-cell-spiral',axis:'spiral',circuits:[{id:1,route:r,length:routeLength(r),collectorIndex:0}],totalLength:routeLength(r),coverage:.95,zones:2,warnings:[],candidatesChecked:combined.length};}
  // If one continuous spiral is too long or cannot be joined cleanly, use one local spiral per cell.
  const circuits=[];for(let ci=0;ci<vars.length;ci++){let best=null;for(const q of vars[ci]){const r=v23AttachCoreToCollector(q,col);if(r&&manualHardRouteV2A(r)){const L=routeLength(r);if(!best||L<best.length)best={id:ci+1,route:r,length:L,collectorIndex:0};}}if(!best||best.length>max*1.015)return null;circuits.push(best);}
  const total=circuits.reduce((s,c)=>s+c.length,0),mean=total/circuits.length,spread=(Math.max(...circuits.map(c=>c.length))-Math.min(...circuits.map(c=>c.length)))/Math.max(1,mean);
  return{ok:true,version:'2.3-complex-spiral',planner:'multi-cell-spiral',axis:'spiral',circuits,totalLength:total,coverage:.94,zones:2,balance:{spread,mean},warnings:['Сложная улитка построена как локальные спирали по областям.'],candidatesChecked:vars[0].length*vars[1].length};
}
async function v23GenerateComplexSpiral(){
  if(state.manualV2?.active)manualExitV2A();collectInputs();recomputeGeometry();if(!state.supply){setStatus('Сначала укажите коллектор.',true);return false;}const p=v23ComplexSpiralPlan();if(!p){setStatus('Для этой Г/Т-формы улитка не прошла проверку. Попробуйте Auto, меньший шаг или измените положение коллектора.',true);return false;}state.enginePlanV1=p;state.route=[];state.routeCandidates=[];state.selectedRouteCandidate=null;state.routeKind='Улитка по форме';renderPlan();v221UpdateVariantButton();setStatus(`Улитка по форме: ${p.circuits.length} контур(а) · ${(p.totalLength/1000).toFixed(1)} м.`);return true;
}

// Allow "Улитка" to remain selected for preset L/T rooms.
document.querySelectorAll('[data-layout-choice-v221="spiral"]').forEach(b=>b.addEventListener('click',e=>{if(!v23PresetComplexSpiralPossible())return;e.preventDefault();e.stopImmediatePropagation();state.layoutUserChoiceV221='spiral';v221SyncChooser();setStatus('Для Г/Т-формы Warm построит локальную улитку по областям и соединит её в минимальное число контуров.');},true));

// ----- Two-collector circuit assignment ------------------------------------
function v23CircuitCentroid(route){if(!route?.length)return{x:0,y:0};const pts=route.slice(Math.min(2,route.length-1),Math.max(3,route.length-2));return{x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length};}
function v23CollectorCenter(c){return{x:(c.supply.x+c.returnPoint.x)/2,y:(c.supply.y+c.returnPoint.y)/2};}
function v23TrimCoreFromCollector(route,oldCol){
  if(!route?.length||route.length<4)return route;const th=Math.max(260,(Number(state.wallOffsetMm)||100)+(Number(state.pipeStepMm)||150)*1.25);let a=1,b=route.length-2;
  while(a<b-1&&(dist(route[a],oldCol.supply)<th||!pointAllowedAtInsetV12(route[a].x,route[a].y,Math.max(0,Number(state.wallOffsetMm)||0))))a++;
  while(b>a+1&&(dist(route[b],oldCol.returnPoint)<th||!pointAllowedAtInsetV12(route[b].x,route[b].y,Math.max(0,Number(state.wallOffsetMm)||0))))b--;
  return route.slice(a,b+1);
}
function v23RerouteCircuitCollector(c,newCol,oldCol){
  const core=v23TrimCoreFromCollector(c.route||[],oldCol);if(core.length<2)return null;const variants=[core,[...core].reverse()];let best=null;
  for(const q of variants){const r=v23AttachCoreToCollector(q,newCol);if(!r||!manualHardRouteV2A(r))continue;const L=routeLength(r);if(!best||L<best.length)best={...c,route:r,length:L};}return best;
}
function v23AssignPlanCollectors(plan){
  v23SyncCollectors();if(state.collectorCountV23!==2||!state.collectorsV23[1]||!plan?.ok||!plan.circuits?.length)return plan;const cols=[state.collectorsV23[0]||v23PrimaryCollector(),state.collectorsV23[1]],centers=cols.map(v23CollectorCenter),cs=plan.circuits.map(c=>({...c,route:clonePointsV2A(c.route||[])}));if(!cols[0])return plan;
  const scores=cs.map((c,i)=>{const p=v23CircuitCentroid(c.route);return{i,d0:dist(p,centers[0]),d1:dist(p,centers[1])};});let assign=scores.map(s=>s.d1+80<s.d0?1:0);
  if(cs.length>=2){if(!assign.includes(1))assign[scores.slice().sort((a,b)=>(a.d1-a.d0)-(b.d1-b.d0))[0].i]=1;if(!assign.includes(0))assign[scores.slice().sort((a,b)=>(a.d0-a.d1)-(b.d0-b.d1))[0].i]=0;}
  let changed=0;for(let i=0;i<cs.length;i++){if(assign[i]===1){const r=v23RerouteCircuitCollector(cs[i],cols[1],cols[0]);if(r){cs[i]=r;cs[i].collectorIndex=1;changed++;}else cs[i].collectorIndex=0;}else cs[i].collectorIndex=0;}
  if(!changed)return plan;const total=cs.reduce((s,c)=>s+(c.length||routeLength(c.route)),0),mean=total/cs.length,spread=cs.length>1?(Math.max(...cs.map(c=>c.length))-Math.min(...cs.map(c=>c.length)))/Math.max(1,mean):0;
  return{...plan,circuits:cs,totalLength:total,balance:{...(plan.balance||{}),spread,mean},collectorsUsed:2,warnings:[...(plan.warnings||[]),'Контуры распределены между двумя коллекторами по длине подводок.']};
}
async function v23ForceTwoCircuitPlanIfNeeded(){
  v23SyncCollectors();if(state.collectorCountV23!==2||!state.collectorsV23[1])return false;let plan=state.enginePlanV1;
  if(!plan?.ok||plan.circuits?.length<2){const total=plan?.totalLength||(state.route?.length?routeLength(state.route):estimatedSimpleLengthV21()||0);if(total>25000){const inp=engineInputV1(),forced=Math.max(20000,Math.min((Number(state.maxCircuitLengthM)||100)*1000,total/2*1.12));inp.maxCircuitLengthMm=forced;try{const r=await runEngineWorkerV1(inp);if(r?.ok&&r.circuits?.length>=2)plan=r;}catch{}}
  }
  if(plan?.ok){state.enginePlanV1=v23AssignPlanCollectors(plan);state.route=[];renderPlan();return true;}return false;
}

const v23BaseGenerateWithChoice=v221GenerateWithChoice;
async function v23GenerateWithChoice(){
  const req=state.layoutUserChoiceV221||'auto';if(v23PresetComplexSpiralPossible()&&req==='spiral'){closeSheetV5();const ok=await v23GenerateComplexSpiral();if(ok&&state.collectorCountV23===2)await v23ForceTwoCircuitPlanIfNeeded();return;}
  await v23BaseGenerateWithChoice();if(state.collectorCountV23===2&&state.collectorsV23[1]){await v23ForceTwoCircuitPlanIfNeeded();v221UpdateVariantButton();setStatus(`Готово: ${state.enginePlanV1?.circuits?.length||1} контур(а), распределение по ${state.enginePlanV1?.collectorsUsed===2?'двум':'одному'} коллекторам.`);}
}
$('calculateLayoutV221')?.addEventListener('click',e=>{if((v23PresetComplexSpiralPossible()&&state.layoutUserChoiceV221==='spiral')||(state.collectorCountV23===2&&state.collectorsV23[1])){e.preventDefault();e.stopImmediatePropagation();v23GenerateWithChoice();}},true);

// Render one or two collector badges, replacing the V2.2.2 single badge.
function v23CollectorBadge(c,index){
  if(!c?.supply||!c?.returnPoint)return'';const sc=Math.max(.001,state.scale||.1),mid=v23CollectorCenter(c),side=c.supply.side||'bottom',bw=94/sc,bh=34/sc,gap=(34+index*10)/sc;let cx=mid.x,cy=mid.y;
  if(side==='bottom')cy+=gap;else if(side==='top')cy-=gap;else if(side==='left')cx-=gap;else cx+=gap;const x=cx-bw/2,y=cy-bh/2,fs=8/sc,small=6.5/sc,r=4/sc;const lx=side==='left'?x+bw:side==='right'?x:cx,ly=side==='top'?y+bh:side==='bottom'?y:cy;
  return `<g class="engineering-collector-badge-v23"><line class="leader" x1="${mid.x}" y1="${mid.y}" x2="${lx}" y2="${ly}"/><rect class="card" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${8/sc}"/><text class="title" x="${cx}" y="${y+10/sc}" text-anchor="middle" font-size="${fs}">Коллектор К${index+1}</text><circle class="supply" cx="${cx-29/sc}" cy="${y+24/sc}" r="${r}"/><text class="sub" x="${cx-22/sc}" y="${y+26/sc}" font-size="${small}">подача →</text><circle class="return" cx="${cx+10/sc}" cy="${y+24/sc}" r="${r}"/><text class="sub" x="${cx+17/sc}" y="${y+26/sc}" font-size="${small}">← обр.</text></g>`;
}
const renderPlanV23Base=renderPlan;
renderPlan=function renderPlanV23(){renderPlanV23Base();v23SyncCollectors();planSvg?.querySelectorAll('.engineering-collector-badge-v222,.engineering-collector-badge-v23').forEach(n=>n.remove());let h='';for(let i=0;i<Math.min(state.collectorCountV23,state.collectorsV23.length);i++)h+=v23CollectorBadge(state.collectorsV23[i],i);if(h)planSvg.insertAdjacentHTML('beforeend',h);v23SyncPairedUI();};

// Persistence.
const serializeStateV23Base=serializeState;
serializeState=function serializeStateV23(){const o=serializeStateV23Base();v23SyncCollectors();o.collectorCountV23=state.collectorCountV23;o.collectorsV23=state.collectorsV23.map(c=>({supply:v23ClonePort(c.supply),returnPoint:v23ClonePort(c.returnPoint),label:c.label}));o.manualPairedReturnV23=!!state.manualPairedReturnV23;o.versionLabel='2.3';return o;};
const loadSchemeV23Base=loadScheme;
loadScheme=function loadSchemeV23(raw){loadSchemeV23Base(raw);state.collectorCountV23=Math.max(1,Math.min(2,Number(raw?.collectorCountV23)||1));state.collectorsV23=Array.isArray(raw?.collectorsV23)?raw.collectorsV23.slice(0,2).map((c,i)=>({supply:v23ClonePort(c.supply),returnPoint:v23ClonePort(c.returnPoint),label:`К${i+1}`})):[];state.manualPairedReturnV23=!!raw?.manualPairedReturnV23;v23SyncCollectors();v23SyncPairedUI();renderPlan();};
const newSchemeV23Base=newScheme;
newScheme=function newSchemeV23(){newSchemeV23Base();state.collectorCountV23=1;state.collectorsV23=[];state.manualPairedReturnV23=false;state.collectorSetupV23={active:false,count:1,index:0};v23SyncCollectors();v23SyncPairedUI();renderPlan();};

// Friendly chooser: do not silently reset the spiral choice for L/T anymore.
const v23OpenChooserBase=v221OpenChooser;
v221OpenChooser=function v221OpenChooserV23(){try{collectInputs();recomputeGeometry();}catch{}if(!v23PresetComplexSpiralPossible()&&!v221SimpleShape()&&!['auto','adaptive'].includes(state.layoutUserChoiceV221))state.layoutUserChoiceV221='auto';v221SyncChooser();openSheetV5('layoutChooserSheetV221');};

v23SyncCollectors();v23SyncPairedUI();v23CollectorCountUI();
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.3 · парная обратка + сложная улитка + 2 коллектора'));
renderPlan();

// V2.3 spiral hardening: if serially joining two local spirals is not clean,
// build each cell as a proper local snail with a paired interface to the same manifold.
function v23PointOnRectEdge(p,rect,side,eps=4){
  if(side==='left'||side==='right'){const x=side==='left'?rect.x:rect.x+rect.width;return Math.abs(p.x-x)<=eps&&p.y>=rect.y-eps&&p.y<=rect.y+rect.height+eps;}
  const y=side==='top'?rect.y:rect.y+rect.height;return Math.abs(p.y-y)<=eps&&p.x>=rect.x-eps&&p.x<=rect.x+rect.width+eps;
}
function v23CellInterface(rect,col){
  for(const side of ['left','right','top','bottom'])if(v23PointOnRectEdge(col.supply,rect,side,6)&&v23PointOnRectEdge(col.returnPoint,rect,side,Math.max(80,state.pipeStepMm||150)))return{side,supply:col.supply,ret:col.returnPoint,actual:true};
  const cc=v23CollectorCenter(col),gap=Math.max(100,(Number(state.pipeStepMm)||150)*.7),opts=[];
  for(const side of ['left','right','top','bottom'])if(v23EdgeShared(rect,side)){
    let s,r,mid;
    if(side==='left'||side==='right'){const x=side==='left'?rect.x:rect.x+rect.width,y=clamp(cc.y,rect.y+gap,rect.y+rect.height-gap);s={x,y:y-gap/2,side};r={x,y:y+gap/2,side};mid={x,y};}
    else{const y=side==='top'?rect.y:rect.y+rect.height,x=clamp(cc.x,rect.x+gap,rect.x+rect.width-gap);s={x:x-gap/2,y,side};r={x:x+gap/2,y,side};mid={x,y};}
    opts.push({side,supply:s,ret:r,actual:false,d:dist(mid,cc)});
  }
  return opts.sort((a,b)=>a.d-b.d)[0]||null;
}
function v23LocalSpiralFromInterface(rect,intf){
  const inner=v23CellInner(rect),W=inner.right-inner.left,H=inner.bottom-inner.top,side=intf.side,localW=(side==='left'||side==='right')?W:H,localH=(side==='left'||side==='right')?H:W,cores=spiralCoreCandidatesV8(localW,localH,Math.max(50,Number(state.pipeStepMm)||150)),room={minX:rect.x,minY:rect.y,maxX:rect.x+rect.width,maxY:rect.y+rect.height},collector={supply:intf.supply,ret:intf.ret,side};let best=null;
  for(const cl of cores)for(const far of [false,true]){const core=transformCoreV8(cl,side,far,inner),r=attachCollectorTailsV8(core,collector,inner,room);if(!r||!manualHardRouteV2A(r))continue;const L=routeLength(r);if(!best||L<best.length)best={route:r,length:L};}
  return best;
}
function v23CellSpiralCircuit(rect,col,id){
  const intf=v23CellInterface(rect,col);if(!intf)return null;const local=v23LocalSpiralFromInterface(rect,intf);if(!local)return null;if(intf.actual)return{id,route:local.route,length:local.length,collectorIndex:0};
  const lead=routedConnectorV12(col.supply,intf.supply,col.supply.side,[local.route]);if(!lead)return null;const tailFromPort=routedConnectorV12(col.returnPoint,intf.ret,col.returnPoint.side,[local.route,lead]);if(!tailFromPort)return null;const route=manualCleanOrthoV2A([...lead,...local.route.slice(1),...[...tailFromPort].reverse().slice(1)]);if(!manualHardRouteV2A(route))return null;return{id,route,length:routeLength(route),collectorIndex:0};
}
const v23ComplexSpiralPlanBase=v23ComplexSpiralPlan;
v23ComplexSpiralPlan=function v23ComplexSpiralPlanHardened(){
  const serial=v23ComplexSpiralPlanBase();if(serial)return serial;if(!v23PresetComplexSpiralPossible())return null;v23SyncCollectors();const col=state.collectorsV23[0]||v23PrimaryCollector();if(!col)return null;const max=(Number(state.maxCircuitLengthM)||100)*1000,circuits=[];
  for(let i=0;i<state.sections.length;i++){const c=v23CellSpiralCircuit(state.sections[i],col,i+1);if(!c||c.length>max*1.015)return null;circuits.push(c);}
  const total=circuits.reduce((s,c)=>s+c.length,0),mean=total/circuits.length,spread=(Math.max(...circuits.map(c=>c.length))-Math.min(...circuits.map(c=>c.length)))/Math.max(1,mean);
  return{ok:true,version:'2.3-complex-spiral',planner:'multi-cell-spiral',axis:'spiral',circuits,totalLength:total,coverage:.94,zones:circuits.length,balance:{spread,mean},warnings:['Улитка построена локально по геометрическим областям и подключена к одному коллектору.'],candidatesChecked:circuits.length};
};

function v23Mid(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
function v23PairedCorridorRoute(col,intf,localRoute){
  const c0=v23Mid(col.supply,col.returnPoint),c1=v23Mid(intf.supply,intf.ret),gap=Math.max(70,Math.min(180,dist(col.supply,col.returnPoint)||Number(state.pipeStepMm)||150));
  const source=inwardPortPointV12({...c0,side:col.supply.side},col.supply.side,1.05),grid=routeGridPathV12(source,c1,[localRoute]);if(!grid)return null;
  const center=manualCleanOrthoV2A([c0,source,...grid.slice(1)]);if(center.length<2)return null;
  const p=v23OffsetOrtho(center,gap/2,1),m=v23OffsetOrtho(center,gap/2,-1);if(!p||!m)return null;
  const pairs=[[p,m],[m,p]];
  let best=null;
  for(const [sa,sb] of pairs){
    const lead=manualCleanOrthoV2A([col.supply,...sa.slice(1),intf.supply]);
    const back=manualCleanOrthoV2A([col.returnPoint,...sb.slice(1),intf.ret]);
    const route=manualCleanOrthoV2A([...lead,...localRoute.slice(1),...[...back].reverse().slice(1)]);
    if(!manualHardRouteV2A(route))continue;const L=routeLength(route);if(!best||L<best.length)best={route,length:L};
  }
  return best;
}
const v23CellSpiralCircuitBase=v23CellSpiralCircuit;
v23CellSpiralCircuit=function v23CellSpiralCircuitPaired(rect,col,id){
  const intf=v23CellInterface(rect,col);if(!intf)return null;const local=v23LocalSpiralFromInterface(rect,intf);if(!local)return null;if(intf.actual)return{id,route:local.route,length:local.length,collectorIndex:0};
  const paired=v23PairedCorridorRoute(col,intf,local.route);if(paired)return{id,route:paired.route,length:paired.length,collectorIndex:0};
  return v23CellSpiralCircuitBase(rect,col,id);
};

// V2.3 final hardening: preserve the short orthogonal interface legs generated
// by the snail builder. The generic manual cleaner intentionally removes very
// short edit segments, but those 15–25 mm interface stubs are required here to
// avoid turning a valid right angle into a diagonal.
function v23JoinExact(parts){
  const out=[];
  for(const part of parts||[])for(const p of part||[]){
    if(out.length&&dist(out[out.length-1],p)<1)continue;
    out.push({...p});
  }
  return out;
}
v23PairedCorridorRoute=function v23PairedCorridorRouteFinal(col,intf,localRoute){
  const c0=v23Mid(col.supply,col.returnPoint),c1=v23Mid(intf.supply,intf.ret),gap=Math.max(70,Math.min(180,dist(col.supply,col.returnPoint)||Number(state.pipeStepMm)||150));
  const source=inwardPortPointV12({...c0,side:col.supply.side},col.supply.side,1.05),grid=routeGridPathV12(source,c1,[localRoute]);if(!grid)return null;
  const center=manualCleanOrthoV2A([c0,source,...grid.slice(1)]);if(center.length<2)return null;
  const offsets=[v23OffsetOrtho(center,gap/2,1),v23OffsetOrtho(center,gap/2,-1)].filter(Boolean);if(offsets.length<2)return null;
  let best=null;
  // A 90° corridor may naturally swap the two lanes. Test both local-flow
  // directions and both lane assignments instead of forcing "near"/"far".
  for(const local of [localRoute,[...localRoute].reverse()]){
    const start=local[0],end=local[local.length-1];
    for(const a of [0,1]){
      const sa=offsets[a],sb=offsets[1-a];
      const err=dist(sa[0],col.supply)+dist(sa[sa.length-1],start)+dist(sb[0],col.returnPoint)+dist(sb[sb.length-1],end);
      if(err>Math.max(8,gap*.2))continue;
      const route=v23JoinExact([sa,local,[...sb].reverse()]);
      if(!manualHardRouteV2A(route))continue;
      const L=routeLength(route);if(!best||L<best.length)best={route,length:L};
    }
  }
  return best;
};

// V2.3 two-manifold hardening. If the geometrically closest circuit cannot be
// reattached to K2 without crossing the floor pattern, try the other circuits
// instead of silently leaving the second manifold unused.
v23AssignPlanCollectors=function v23AssignPlanCollectorsFinal(plan){
  v23SyncCollectors();
  if(state.collectorCountV23!==2||!state.collectorsV23[1]||!plan?.ok||!plan.circuits?.length)return plan;
  const cols=[state.collectorsV23[0]||v23PrimaryCollector(),state.collectorsV23[1]];if(!cols[0])return plan;
  const centers=cols.map(v23CollectorCenter),cs=plan.circuits.map(c=>({...c,route:clonePointsV2A(c.route||[]),collectorIndex:0}));
  const options=cs.map((c,i)=>{const p=v23CircuitCentroid(c.route),rerouted=v23RerouteCircuitCollector(c,cols[1],cols[0]);return{i,p,d0:dist(p,centers[0]),d1:dist(p,centers[1]),benefit:dist(p,centers[0])-dist(p,centers[1]),rerouted};});
  if(cs.length===1){const o=options[0];if(o.rerouted&&o.benefit>120){cs[0]={...o.rerouted,collectorIndex:1};}else return plan;}
  else{
    // Move every clearly K2-side circuit when a valid reattachment exists.
    let moved=[];
    for(const o of options.sort((a,b)=>b.benefit-a.benefit))if(o.rerouted&&o.benefit>80){cs[o.i]={...o.rerouted,collectorIndex:1};moved.push(o.i);}
    // Two selected manifolds should actually be useful. If no route had a strong
    // distance advantage, assign the best *valid* candidate to K2.
    if(!moved.length){const o=options.filter(x=>x.rerouted).sort((a,b)=>b.benefit-a.benefit||a.rerouted.length-b.rerouted.length)[0];if(o){cs[o.i]={...o.rerouted,collectorIndex:1};moved=[o.i];}}
    // Keep at least one circuit at K1. If every circuit migrated, return the one
    // that most strongly belongs to K1 to its original geometry.
    if(cs.every(c=>c.collectorIndex===1)){const keep=options.slice().sort((a,b)=>(a.d0-a.d1)-(b.d0-b.d1))[0];cs[keep.i]={...plan.circuits[keep.i],route:clonePointsV2A(plan.circuits[keep.i].route||[]),collectorIndex:0};}
    if(!cs.some(c=>c.collectorIndex===1))return plan;
  }
  const total=cs.reduce((s,c)=>s+(c.length||routeLength(c.route)),0),mean=total/cs.length,spread=cs.length>1?(Math.max(...cs.map(c=>c.length))-Math.min(...cs.map(c=>c.length)))/Math.max(1,mean):0;
  return{...plan,circuits:cs,totalLength:total,balance:{...(plan.balance||{}),spread,mean},collectorsUsed:2,warnings:[...(plan.warnings||[]),'Контуры распределены между двумя коллекторами с проверкой подводок.']};
};

// ===== V2.3.1: simpler collector + reliable touch move editor =====
// Goals:
// - keep only one user-placeable collector for now;
// - show the collector as two obvious ports (red supply / blue return);
// - remove the separate flow-direction command;
// - make manual segment selection geometric (nearest logical straight run),
//   not dependent on whichever transparent SVG hit-line happened to receive the tap;
// - move the chosen segment with local 10 mm snapping so L/T/multi-cell/spiral routes remain editable.

function v231ForceSingleCollector(){
  state.collectorCountV23=1;
  state.collectorSetupV23={active:false,count:1,index:0};
  const p=v23PrimaryCollector?.();
  state.collectorsV23=p?[p]:[];
  document.body.classList.remove('v23-two-collectors');
}
v231ForceSingleCollector();

// Neutralise the V2.3 two-collector synchroniser for the current UX.
v23SyncCollectors=function v23SyncCollectorsV231(){
  const p=v23PrimaryCollector?.();
  state.collectorCountV23=1;
  state.collectorSetupV23={active:false,count:1,index:0};
  state.collectorsV23=p?[p]:[];
  document.body.classList.remove('v23-two-collectors');
};

// Collector preview: two ports only, no arrows/direction control.
v222SyncCollectorPreview=function v222SyncCollectorPreviewV231(){
  const host=$('collectorPreviewV222');if(!host)return;
  if(!state.supply||!state.returnPoint){host.innerHTML='<div class="collector-preview-card-v222"><div class="collector-preview-title-v222"><b>Коллектор не установлен</b><small>Сначала выберите место на стене</small></div></div>';return;}
  const ordered=v222CollectorOrder();
  host.innerHTML=`<div class="collector-preview-card-v222 collector-preview-simple-v231"><div class="collector-preview-title-v222"><b>Коллектор</b><small>${v222CollectorOrderText()}</small></div><div class="collector-mini-line-v222">${ordered.map(q=>`<div class="collector-mini-port-v222 ${q.kind}"><span class="dot"></span><span>${q.kind==='supply'?'Подача':'Обратка'}</span></div>`).join('')}</div></div>`;
};

// Replace the V2.3 large badge with the old, immediately readable two-point convention.
v23CollectorBadge=function v23CollectorBadgeV231(c,index){
  if(index>0||!c?.supply||!c?.returnPoint)return'';
  const sc=Math.max(.001,state.scale||.1),s=c.supply,r=c.returnPoint,mid={x:(s.x+r.x)/2,y:(s.y+r.y)/2};
  const side=s.side||r.side||'bottom',dot=7/sc,fs=7/sc,labelGap=14/sc;
  let tx=mid.x,ty=mid.y;
  if(side==='bottom')ty+=labelGap; else if(side==='top')ty-=labelGap; else if(side==='left')tx-=labelGap; else tx+=labelGap;
  return `<g class="engineering-collector-badge-v23 engineering-collector-simple-v231"><circle class="port-supply-v231" cx="${s.x}" cy="${s.y}" r="${dot}"/><circle class="port-return-v231" cx="${r.x}" cy="${r.y}" r="${dot}"/><text class="port-letter-v231 supply" x="${s.x}" y="${s.y+2.4/sc}" text-anchor="middle" font-size="${fs}">П</text><text class="port-letter-v231 return" x="${r.x}" y="${r.y+2.4/sc}" text-anchor="middle" font-size="${fs}">О</text><text class="collector-name-v231" x="${tx}" y="${ty}" text-anchor="middle" font-size="${6.5/sc}">Коллектор</text></g>`;
};

// Rebuild the dock button to discard V2.3's anonymous "how many collectors?" listener.
(function v231RebindCollectorButton(){
  const old=$('collectorToolBtn');if(!old)return;
  const fresh=old.cloneNode(true);old.replaceWith(fresh);
  fresh.addEventListener('click',()=>{
    v231ForceSingleCollector();
    if(state.supply&&state.returnPoint){v222OpenCollectorSheet();return;}
    if(typeof setModeV6==='function')setModeV6('collector6');else setMode('collector');
    setStatus('Коснитесь стены в месте коллектора. Красная точка будет подачей, синяя — обраткой.');
  });
})();

// Persist old two-collector projects as a single active manifold in this version.
const v231SerializeBase=serializeState;
serializeState=function serializeStateV231(){const o=v231SerializeBase();o.collectorCountV23=1;o.collectorsV23=(state.supply&&state.returnPoint)?[{supply:v23ClonePort(state.supply),returnPoint:v23ClonePort(state.returnPoint),label:'К1'}]:[];o.flowReversedV222=false;o.versionLabel='2.3.1';return o;};
const v231LoadBase=loadScheme;
loadScheme=function loadSchemeV231(raw){v231LoadBase(raw);v231ForceSingleCollector();state.flowReversedV222=false;v222SyncCollectorPreview();renderPlan();};
const v231NewBase=newScheme;
newScheme=function newSchemeV231(){v231NewBase();v231ForceSingleCollector();state.flowReversedV222=false;v222SyncCollectorPreview();renderPlan();};

// Non-interactive recommendation only. A second manifold is no longer placeable by hand.
function v231SecondCollectorHint(){
  const p=state.enginePlanV1;
  if(!p?.ok)return'';
  const localSpirals=String(p.planner||'').includes('spiral')&&(Number(p.zones)||p.circuits?.length||0)>=2;
  if(localSpirals&&p.circuits?.length>=2)return' · несколько локальных улиток: можно рассмотреть 2 коллектора';
  return'';
}
const v231RenderBase=renderPlan;
renderPlan=function renderPlanV231(){
  v231ForceSingleCollector();
  v231RenderBase();
  const info=$('routeInfo');if(info&&state.enginePlanV1?.ok&&!info.textContent.includes('можно рассмотреть 2 коллектора'))info.textContent+=v231SecondCollectorHint();
};

// ----- Manual move editor: geometric nearest-pass selection -----------------
state.manualMoveV231=state.manualMoveV231||{active:false,pointerId:null,circuit:-1,seg:-1,orientation:null,start:null,original:null,historyPushed:false,changed:false};
function v231WorldPerPx(){const m=planSvg?.getScreenCTM?.();if(!m)return 1/Math.max(.001,state.scale||.1);const sx=Math.hypot(m.a,m.b)||1;return 1/sx;}
function v231ProjectionT(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,L2=dx*dx+dy*dy;if(L2<1)return 0;return Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/L2));}
function v231NearestMoveSegment(p){
  const m=state.manualV2;if(!m?.circuits?.length)return null;
  const step=Math.max(50,Number(state.pipeStepMm)||150),maxD=Math.max(step*.42,42*v231WorldPerPx());let best=null;
  for(let ci=0;ci<m.circuits.length;ci++){
    const r=m.circuits[ci]?.route||[];
    for(let si=0;si<r.length-1;si++){
      if(manualTouchesLockedV2B(ci,si))continue;
      const a=r[si],b=r[si+1],L=dist(a,b);if(L<35)continue;
      // Keep the manifold tails anchored; select the first real lane instead.
      if((si===0&&state.supply&&dist(a,state.supply)<90)||(si===r.length-2&&state.returnPoint&&dist(b,state.returnPoint)<90))continue;
      const d=pointSegDistV14(p,a,b);if(d>maxD)continue;
      const t=v231ProjectionT(p,a,b),shortPenalty=L<step*1.15?maxD*.42:0,endPenalty=(t<.08||t>.92)?maxD*.12:0;
      const score=d+shortPenalty+endPenalty;
      if(!best||score<best.score-1||(Math.abs(score-best.score)<1&&L>best.length))best={circuit:ci,seg:si,score,distance:d,length:L,orientation:Math.abs(a.x-b.x)>=Math.abs(a.y-b.y)?'h':'v'};
    }
  }
  return best;
}
function v231LocalMoveCandidate(drag,p){
  const r=clonePointsV2A(drag.original||[]),si=drag.seg,a=r[si],b=r[si+1];if(!a||!b)return null;
  const quantum=10;
  if(drag.orientation==='h'){
    const delta=Math.round((p.y-drag.start.y)/quantum)*quantum;if(Math.abs(delta)<1)return r;a.y+=delta;b.y+=delta;
  }else{
    const delta=Math.round((p.x-drag.start.x)/quantum)*quantum;if(Math.abs(delta)<1)return r;a.x+=delta;b.x+=delta;
  }
  return r;
}
function v231SegmentInside(a,b){
  if(Math.abs(a.x-b.x)>1&&Math.abs(a.y-b.y)>1)return false;
  if(dist(a,b)<4)return false;
  const n=Math.max(2,Math.ceil(dist(a,b)/25));
  for(let k=0;k<=n;k++){const t=k/n,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;if(!insideRoom(x,y,true)||pointExcluded(x,y))return false;}
  return true;
}
function v231LocalMoveValid(original,cand,si){
  if(!cand||cand.length!==original.length)return false;
  const affected=new Set([si-1,si,si+1].filter(i=>i>=0&&i<cand.length-1));
  for(const i of affected)if(!v231SegmentInside(cand[i],cand[i+1]))return false;
  // Reject only NEW intersections involving the moved neighbourhood. Existing
  // imperfections elsewhere in a generated multi-cell route do not block editing.
  for(const i of affected){
    for(let j=0;j<cand.length-1;j++){
      if(affected.has(j)||Math.abs(i-j)<=1)continue;
      const ca=cand[i],cb=cand[i+1],cc=cand[j],cd=cand[j+1];
      if(!segmentsIntersect(ca,cb,cc,cd))continue;
      const shared=dist(ca,cc)<2||dist(ca,cd)<2||dist(cb,cc)<2||dist(cb,cd)<2;if(shared)continue;
      const oa=original[i],ob=original[i+1],oc=original[j],od=original[j+1];
      if(!segmentsIntersect(oa,ob,oc,od))return false;
    }
  }
  return true;
}
function v231BeginMove(e){
  const m=state.manualV2;if(!m?.active||m.view==='auto'||m.tool!=='edit'||e.button>0)return false;
  const p=manualScreenPointV2A(e);if(!p)return false;const hit=v231NearestMoveSegment(p);
  if(!hit){m.selected=null;manualUpdateUiV2A();renderPlan();setStatus('Труба рядом не найдена. Коснитесь ближе к середине нужного прямого прохода.',true);return true;}
  const r=m.circuits[hit.circuit]?.route;if(!r)return true;
  m.selected={circuit:hit.circuit,seg:hit.seg};
  const d=state.manualMoveV231;Object.assign(d,{active:true,pointerId:e.pointerId,circuit:hit.circuit,seg:hit.seg,orientation:hit.orientation,start:p,original:clonePointsV2A(r),historyPushed:false,changed:false});
  try{planSvg.setPointerCapture(e.pointerId)}catch{}
  manualUpdateUiV2A();manualUpdateSideUiV2B();renderPlan();
  setStatus(`Выбран ${hit.orientation==='h'?'горизонтальный':'вертикальный'} проход. Тяните его ${hit.orientation==='h'?'вверх/вниз':'влево/вправо'}; шаг перемещения 1 см.`);
  return true;
}
function v231Move(e){
  const d=state.manualMoveV231,m=state.manualV2;if(!d.active||e.pointerId!==d.pointerId||!m?.active)return false;
  const p=manualScreenPointV2A(e);if(!p)return true;const cand=v231LocalMoveCandidate(d,p);if(!cand)return true;
  if(v231LocalMoveValid(d.original,cand,d.seg)){
    if(!d.historyPushed&&cand.some((q,i)=>dist(q,d.original[i])>1)){manualPushHistoryV2A();d.historyPushed=true;}
    m.circuits[d.circuit].route=cand;d.changed=cand.some((q,i)=>dist(q,d.original[i])>1);m.dirty=m.dirty||d.changed;renderPlan();
  }
  return true;
}
function v231FinishMove(e,cancel=false){
  const d=state.manualMoveV231;if(!d.active||e.pointerId!==d.pointerId)return false;
  try{planSvg.releasePointerCapture(e.pointerId)}catch{}
  if(cancel&&d.original&&state.manualV2?.circuits?.[d.circuit])state.manualV2.circuits[d.circuit].route=clonePointsV2A(d.original);
  const moved=d.changed;Object.assign(d,{active:false,pointerId:null,circuit:-1,seg:-1,orientation:null,start:null,original:null,historyPushed:false,changed:false});
  manualRefreshV2A();setStatus(moved?'Проход перемещён. При необходимости нажмите «Проверить» для контроля шага и радиусов.':'Проход выбран. Потяните его поперёк, чтобы изменить положение.');return true;
}

// Intercept edit-mode gestures one level above the SVG. This runs before the
// legacy transparent-hit-line listener and removes its ambiguous segment choice.
(function v231InstallMoveCapture(){
  const host=planSvg?.parentElement;if(!host)return;
  host.addEventListener('pointerdown',e=>{if(v231BeginMove(e)){e.preventDefault();e.stopPropagation();}},true);
  host.addEventListener('pointermove',e=>{if(v231Move(e)){e.preventDefault();e.stopPropagation();}},true);
  host.addEventListener('pointerup',e=>{if(v231FinishMove(e,false)){e.preventDefault();e.stopPropagation();}},true);
  host.addEventListener('pointercancel',e=>{if(v231FinishMove(e,true)){e.preventDefault();e.stopPropagation();}},true);
})();

// Friendlier manual instructions.
const v231ManualUpdateBase=manualUpdateUiV2A;
manualUpdateUiV2A=function manualUpdateUiV231(){
  v231ManualUpdateBase();const m=state.manualV2,sel=$('manualSelectionV2');if(!sel||m?.tool!=='edit')return;
  if(m.selected){const c=m.circuits[m.selected.circuit],a=c?.route[m.selected.seg],b=c?.route[m.selected.seg+1],o=a&&b?(Math.abs(a.x-b.x)>=Math.abs(a.y-b.y)?'горизонтальный':'вертикальный'):'';sel.textContent=`Выбран ${o} проход, контур ${m.selected.circuit+1}. Тяните его поперёк. Перемещение идёт локально с шагом 1 см.`;sel.classList.add('selected');}
  else{sel.textContent='Коснитесь середины нужного прямого прохода. Warm выберет ближайшую трубу и подсветит её; затем тяните поперёк.';sel.classList.remove('selected');}
};

// Keep the UI clean even when this patch is applied over V2.3 markup.
$('reverseFlowV222')?.remove();$('secondCollectorV23')?.remove();$('collectorCountSheetV23')?.remove();
state.flowReversedV222=false;v231ForceSingleCollector();v222SyncCollectorPreview();
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.3.1 · ручная правка + простой коллектор'));
renderPlan();

// Ensure the two-port marker is always drawn from the canonical primary ports,
// independent of the now-disabled V2.3 collector array.
const v231RenderSimpleCollectorBase=renderPlan;
renderPlan=function renderPlanV231SimpleCollector(){
  v231RenderSimpleCollectorBase();
  if(!planSvg)return;
  planSvg.querySelectorAll('.engineering-collector-badge-v222,.engineering-collector-badge-v23').forEach(n=>n.remove());
  if(state.supply&&state.returnPoint)planSvg.insertAdjacentHTML('beforeend',v23CollectorBadge({supply:state.supply,returnPoint:state.returnPoint,label:'К1'},0));
};
renderPlan();

// Tap either manifold port itself to open the simple swap panel.
(function v231InstallCollectorPortTap(){
  const host=planSvg?.parentElement;if(!host)return;
  host.addEventListener('pointerdown',e=>{
    if(state.manualV2?.active||!state.supply||!state.returnPoint)return;
    if(state.mode&&state.mode!=='inspect')return;
    const p=manualScreenPointV2A(e);if(!p)return;const hitR=30*v231WorldPerPx();
    if(Math.min(dist(p,state.supply),dist(p,state.returnPoint))<=hitR){e.preventDefault();e.stopPropagation();v222OpenCollectorSheet();}
  },true);
})();
