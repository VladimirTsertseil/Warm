/* Clean grid engine module used by Warm 5.0. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WarmGridModel = api;
})(globalThis, function() {
  'use strict';
  const CELL_SIZES = Object.freeze([100, 150, 200]);
  const PIPE_DIAMETERS = Object.freeze([16, 17, 20]);
  const EPS = 1e-7;
  const copy = value => structuredClone(value);
  const nodeId = (column, row) => `${column},${row}`;
  function rectangle(r) {
    const result = Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, Number(r[k])]));
    if (!Object.values(result).every(Number.isFinite) || result.width <= 0 || result.height <= 0)
      throw new TypeError('Invalid room or exclusion rectangle');
    return result;
  }
  function point(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new TypeError('Invalid point');
    return {x: p.x, y: p.y};
  }
  function createProject(options = {}) {
    const cellSizeMm = options.grid?.cellSizeMm ?? 150;
    const diameterMm = options.pipe?.diameterMm ?? 16;
    if (!CELL_SIZES.includes(cellSizeMm)) throw new RangeError('Grid must be 100, 150 or 200 mm');
    if (!PIPE_DIAMETERS.includes(diameterMm)) throw new RangeError('Pipe must be 16, 17 or 20 mm');
    return {
      schemaVersion: 5, units: 'mm',
      room: {sections: (options.room?.sections || []).map(rectangle), removedAreas: (options.room?.removedAreas || []).map(rectangle)},
      grid: {cellSizeMm, origin: point(options.grid?.origin || {x: 0, y: 0})},
      exclusions: {areas: (options.exclusions?.areas || []).map(rectangle)},
      collector: {supply: options.collector?.supply ? copy(options.collector.supply) : null,
        returnPoint: options.collector?.returnPoint ? copy(options.collector.returnPoint) : null,
        ...(options.collector?.portPairs ? {portPairs: copy(options.collector.portPairs)} : {})},
      pipe: {diameterMm},
      // A dynamic list. No circuit allocation, bend radius or diameter-dependent rules.
      circuits: copy(options.circuits || []),
      ...(options.circuitDefinitions ? {circuitDefinitions: copy(options.circuitDefinitions)} : {}),
      migration: copy(options.migration || {warnings: []})
    };
  }
  const contains = (r, p) => p.x >= r.x - EPS && p.x <= r.x + r.width + EPS && p.y >= r.y - EPS && p.y <= r.y + r.height + EPS;
  function cellRect(key, step) {
    const [column, row] = key.split(',').map(Number);
    return rectangle({x: column * step, y: row * step, width: step, height: step});
  }
  function classifyPoint(project, p) {
    if (!project.room.sections.some(r => contains(r, p)) || project.room.removedAreas.some(r => contains(r, p))) return 'unavailable';
    return project.exclusions.areas.some(r => contains(r, p)) ? 'excluded' : 'available';
  }
  // Clip a whole axis-aligned segment to a rectangle. Endpoint/midpoint sampling
  // misses narrow columns and gaps, so all decisions below use exact intervals.
  function interval(r, a, b) {
    const horizontal = Math.abs(a.y - b.y) < EPS;
    const fixed = horizontal ? a.y : a.x;
    const fixedMin = horizontal ? r.y : r.x, fixedSize = horizontal ? r.height : r.width;
    if (fixed < fixedMin - EPS || fixed > fixedMin + fixedSize + EPS) return null;
    const start = horizontal ? a.x : a.y, end = horizontal ? b.x : b.y;
    const lo = Math.max(Math.min(start, end), horizontal ? r.x : r.y);
    const hi = Math.min(Math.max(start, end), horizontal ? r.x + r.width : r.y + r.height);
    return hi >= lo - EPS ? [lo, hi] : null;
  }
  function classifySegment(project, a, b) {
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) return 'unavailable';
    if (project.room.removedAreas.some(r => interval(r, a, b))) return 'unavailable';
    const horizontal = Math.abs(a.y - b.y) < EPS;
    const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const intervals = project.room.sections.map(r => interval(r, a, b)).filter(Boolean).sort((a, b) => a[0] - b[0]);
    let covered = lo;
    for (const [start, end] of intervals) {
      if (start > covered + EPS) break;
      covered = Math.max(covered, end);
    }
    if (!intervals.length || covered < hi - EPS) return 'unavailable';
    if (project.exclusions.areas.some(r => interval(r, a, b))) return 'excluded';
    return 'available';
  }
  function buildGrid(project) {
    const {cellSizeMm: step, origin} = project.grid;
    if (!CELL_SIZES.includes(step)) throw new RangeError('Unsupported mounting grid');
    const sections = project.room.sections;
    const graph = {cellSizeMm: step, origin: copy(origin), nodes: [], edges: [], bounds: null,
      counts: {nodes: {available: 0, unavailable: 0, excluded: 0}, edges: {available: 0, unavailable: 0, excluded: 0}}};
    if (!sections.length) return graph;
    const bounds = sections.reduce((b, r) => ({minX: Math.min(b.minX, r.x), minY: Math.min(b.minY, r.y),
      maxX: Math.max(b.maxX, r.x + r.width), maxY: Math.max(b.maxY, r.y + r.height)}), {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity});
    graph.bounds = bounds;
    const c0 = Math.floor((bounds.minX - origin.x) / step), c1 = Math.ceil((bounds.maxX - origin.x) / step);
    const r0 = Math.floor((bounds.minY - origin.y) / step), r1 = Math.ceil((bounds.maxY - origin.y) / step);
    const at = (c, r) => ({x: origin.x + c * step, y: origin.y + r * step});
    function edge(c, r, dc, dr) {
      const from = nodeId(c, r), to = nodeId(c + dc, r + dr), a = at(c, r), b = at(c + dc, r + dr);
      const status = classifySegment(project, a, b);
      graph.edges.push({id: `${from}:${to}`, from, to, axis: dc ? 'x' : 'y', lengthMm: step, status});
      graph.counts.edges[status]++;
    }
    for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) {
      const p = at(column, row), status = classifyPoint(project, p);
      graph.nodes.push({id: nodeId(column, row), column, row, ...p, status});
      graph.counts.nodes[status]++;
      if (column < c1) edge(column, row, 1, 0);
      if (row < r1) edge(column, row, 0, 1);
    }
    return graph;
  }
  function straightSegment(graph, fromId, toId) {
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const from = nodes.get(fromId), to = nodes.get(toId);
    if (!from || !to || fromId === toId || (from.column !== to.column && from.row !== to.row)) throw new Error('Straight segment needs two aligned grid nodes');
    const dc = Math.sign(to.column - from.column), dr = Math.sign(to.row - from.row);
    const count = Math.abs(to.column - from.column) + Math.abs(to.row - from.row);
    const edges = new Map(graph.edges.map(e => [e.id, e])), edgeIds = [];
    for (let i = 0; i < count; i++) {
      const a = nodeId(from.column + dc * i, from.row + dr * i), b = nodeId(from.column + dc * (i + 1), from.row + dr * (i + 1));
      const edge = edges.get(`${a}:${b}`) || edges.get(`${b}:${a}`);
      if (!edge || edge.status !== 'available') throw new Error('Straight segment crosses an unavailable guide');
      edgeIds.push(edge.id);
    }
    return {type: 'straight', fromNodeId: fromId, toNodeId: toId, edgeIds, lengthMm: count * graph.cellSizeMm};
  }
  return {CELL_SIZES, PIPE_DIAMETERS, createProject, buildGrid, classifyPoint, classifySegment, straightSegment};
});
