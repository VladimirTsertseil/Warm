/* Warm 3.1. Grid guides -> paired inward/outward passes -> exact line/arc geometry.
   No diameter/radius rule, circuit allocation or collector transit is inferred here. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grid-core.js'), require('./engine-unified.js'));
  else root.WarmSpiral = factory(root.WarmGrid, root.WarmEngine);
})(globalThis, function(G, Geometry) {
  'use strict';
  const EPS = 1e-6, TAU = 2 * Math.PI;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const same = (a, b) => distance(a, b) < EPS;
  const key = (x, y) => `${x},${y}`;
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const fail = reason => ({ok: false, status: 'SPIRAL_IMPOSSIBLE', reason, circuits: []});

  function options(input) {
    const result = {radiusMm: Number(input?.radiusMm), spacingCells: Number(input?.spacingCells ?? 1), wallOffsetMm: Number(input?.wallOffsetMm ?? 100)};
    if (!Number.isFinite(result.radiusMm) || result.radiusMm <= 0) throw new Error('RADIUS_REQUIRED');
    if (!Number.isSafeInteger(result.spacingCells) || result.spacingCells < 1) throw new Error('INVALID_SPACING');
    if (!Number.isFinite(result.wallOffsetMm) || result.wallOffsetMm < 0) throw new Error('INVALID_OFFSET');
    return result;
  }
  function prepare(project, settings) {
    const p = G.createProject(project), o = options(settings), step = p.grid.cellSizeMm * o.spacingCells;
    if (o.radiusMm > step / 2 + EPS) throw new Error('RADIUS_DOES_NOT_FIT');
    // Only reuse the union/erosion geometry helpers. Setting diameter to zero is
    // deliberate: the new contract has no approved diameter-dependent rules.
    const space = Geometry.freeSpace({sections: p.room.sections, obstacles: [...p.room.removedAreas, ...p.exclusions.areas], wallOffsetMm: o.wallOffsetMm, pipeDiameterMm: 0});
    const bounds = p.room.sections.reduce((b, r) => ({minX: Math.min(b.minX, r.x), minY: Math.min(b.minY, r.y), maxX: Math.max(b.maxX, r.x + r.width), maxY: Math.max(b.maxY, r.y + r.height)}), {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity});
    const estimate = ((bounds.maxX - bounds.minX) / p.grid.cellSizeMm + 3) * ((bounds.maxY - bounds.minY) / p.grid.cellSizeMm + 3);
    // Resource guard, not a mounting/circuit-count rule. The UI worker also has a timeout.
    if (estimate > 120000) throw new Error('AREA_TOO_LARGE');
    const graph = G.buildGrid(p), nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const edges = new Map(graph.edges.map(e => [edgeKey(e.from, e.to), e]));
    const usable = n => n?.status === 'available' && space.contains(n);
    const guide = (a, b) => a && b && G.classifySegment(p, a, b) === 'available' && space.covers(a, b);
    const at = (x, y) => nodes.get(key(x * o.spacingCells, y * o.spacingCells));
    const lattice = new Map();
    for (const n of graph.nodes) if (n.column % o.spacingCells === 0 && n.row % o.spacingCells === 0 && usable(n)) lattice.set(key(n.column / o.spacingCells, n.row / o.spacingCells), n);
    return {p, o, step, graph, nodes, edges, space, usable, guide, at, lattice};
  }
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  function connectedRects(rects) {
    if (!rects.length) return false;
    const seen = new Set([0]), queue = [0];
    for (let i = 0; i < queue.length; i++) {
      const a = rects[queue[i]];
      for (let j = 0; j < rects.length; j++) {
        if (seen.has(j)) continue;
        const b = rects[j], x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        // A point contact is not a passage. Include islands too small to hold a grid node.
        if (x >= -EPS && y >= -EPS && (x > EPS || y > EPS)) {seen.add(j); queue.push(j);}
      }
    }
    return seen.size === rects.length;
  }
  function connected(ctx) {
    if (!connectedRects(ctx.space.raw) || !connectedRects(ctx.space.rects)) return false;
    const first = ctx.lattice.keys().next().value;
    if (!first) return false;
    const seen = new Set([first]), queue = [first];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i], [x, y] = id.split(',').map(Number), a = ctx.lattice.get(id);
      for (const [dx, dy] of directions) {
        const next = key(x + dx, y + dy), b = ctx.lattice.get(next);
        if (b && !seen.has(next) && ctx.guide(a, b)) {seen.add(next); queue.push(next);}
      }
    }
    return seen.size === ctx.lattice.size;
  }
  function coversLattice(ctx, points) {
    const near = new Set();
    for (const p of points) {
      const x = (p.x - ctx.p.grid.origin.x) / ctx.step, y = (p.y - ctx.p.grid.origin.y) / ctx.step;
      if (Math.abs(x - Math.round(x)) > EPS || Math.abs(y - Math.round(y)) > EPS) return false;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.add(key(Math.round(x) + dx, Math.round(y) + dy));
    }
    return [...ctx.lattice.keys()].every(id => near.has(id));
  }
  function routeGridPoints(ctx, route) {
    const points = [route[0]];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], count = distance(a, b) / ctx.step;
      if (Math.abs(count - Math.round(count)) > EPS) throw new Error('OFF_GRID');
      for (let j = 1; j <= Math.round(count); j++) points.push({x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count});
    }
    return points;
  }
  function squareCovered(ctx, a, b) {
    const area = (b.x - a.x) * (b.y - a.y);
    let covered = 0;
    for (const r of ctx.space.rects) covered += Math.max(0, Math.min(b.x, r.x + r.width) - Math.max(a.x, r.x)) * Math.max(0, Math.min(b.y, r.y + r.height) - Math.max(a.y, r.y));
    return Math.abs(covered - area) < EPS * Math.max(1, area);
  }
  function cellsFor(ctx, phaseX, phaseY) {
    const cells = new Map();
    for (const [id, a] of ctx.lattice) {
      const [x, y] = id.split(',').map(Number);
      if (((x - phaseX) % 2 + 2) % 2 || ((y - phaseY) % 2 + 2) % 2) continue;
      const ps = [a, ctx.at(x + 1, y), ctx.at(x + 1, y + 1), ctx.at(x, y + 1)];
      if (!ps.every(n => ctx.usable(n)) || !ps.every((n, i) => ctx.guide(n, ps[(i + 1) % 4])) || !squareCovered(ctx, ps[0], ps[2])) continue;
      cells.set(id, {id, x, y, ps});
    }
    return cells;
  }
  function joins(ctx, a, b) {
    if (b.x > a.x) return [[a.ps[1], a.ps[2]], [b.ps[0], b.ps[3]], [a.ps[1], b.ps[0]], [a.ps[2], b.ps[3]]];
    if (b.x < a.x) return joins(ctx, b, a);
    if (b.y > a.y) return [[a.ps[3], a.ps[2]], [b.ps[0], b.ps[1]], [a.ps[3], b.ps[0]], [a.ps[2], b.ps[1]]];
    return joins(ctx, b, a);
  }
  function makeCycle(ctx, cells, clockwise) {
    if (!cells.size) return null;
    const adjacency = new Map(), visited = new Set();
    const add = (a, b) => {adjacency.get(a.id).add(b.id); adjacency.get(b.id).add(a.id);};
    const remove = (a, b) => {adjacency.get(a.id).delete(b.id); adjacency.get(b.id).delete(a.id);};
    for (const c of cells.values()) {
      for (const p of c.ps) adjacency.set(p.id, new Set());
      for (let i = 0; i < 4; i++) add(c.ps[i], c.ps[(i + 1) % 4]);
    }
    const seed = [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    const stack = [{cell: seed, direction: 0}]; visited.add(seed.id);
    // Following straight runs then clockwise boundary turns peels a rectangle
    // inward. At branches, the stack retains the return pass instead of dropping
    // unvisited arms. Splicing the cycles along this tree keeps one simple circuit.
    while (stack.length) {
      const current = stack.at(-1), turn = clockwise ? 1 : -1;
      const order = [current.direction, (current.direction + turn + 4) % 4, (current.direction - turn + 4) % 4, (current.direction + 2) % 4];
      let found = false;
      for (const d of order) {
        const [dx, dy] = directions[d], next = cells.get(key(current.cell.x + dx * 2, current.cell.y + dy * 2));
        if (!next || visited.has(next.id)) continue;
        const [e1, e2, bridge1, bridge2] = joins(ctx, current.cell, next);
        if (!ctx.guide(...bridge1) || !ctx.guide(...bridge2)) continue;
        remove(...e1); remove(...e2); add(...bridge1); add(...bridge2);
        visited.add(next.id); stack.push({cell: next, direction: d}); found = true; break;
      }
      if (!found) stack.pop();
    }
    if (visited.size !== cells.size) return null;
    const first = seed.ps[0].id, cycle = []; let previous = null, current = first;
    do {
      cycle.push(ctx.nodes.get(current));
      const links = adjacency.get(current); if (links?.size !== 2) return null;
      const next = [...links].find(id => id !== previous); previous = current; current = next;
    } while (current !== first && cycle.length <= adjacency.size);
    if (cycle.length !== adjacency.size) return null;
    // A phase must not omit long arms or isolated pockets. Every usable lattice
    // node needs a pass in its own or an immediately adjacent grid cell. This is
    // a geometric completeness check, not an estimate of thermal coverage.
    if (!coversLattice(ctx, cycle)) return null;
    return cycle;
  }
  function openCycle(ctx, cycle) {
    const target = ctx.p.collector.supply || cycle[0];
    let best = 0, score = Infinity;
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i], b = cycle[(i + 1) % cycle.length];
      const d = distance(target, {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});
      if (d < score) {score = d; best = i;}
    }
    let route = [...cycle.slice(best + 1), ...cycle.slice(0, best + 1)].map(({x, y}) => ({x, y}));
    if (distance(route.at(-1), target) < distance(route[0], target)) route.reverse();
    return Geometry.clean(route);
  }
  function guideRecord(ctx, a, b) {
    const g = ctx.p.grid, ca = (a.x - g.origin.x) / g.cellSizeMm, ra = (a.y - g.origin.y) / g.cellSizeMm;
    const cb = (b.x - g.origin.x) / g.cellSizeMm, rb = (b.y - g.origin.y) / g.cellSizeMm;
    if (![ca, ra, cb, rb].every(v => Math.abs(v - Math.round(v)) < EPS) || !ctx.guide(a, b)) throw new Error('OFF_GRID');
    const x = Math.round(ca), y = Math.round(ra), tx = Math.round(cb), ty = Math.round(rb);
    if ((x !== tx && y !== ty) || (x === tx && y === ty)) throw new Error('OFF_GRID');
    const dx = Math.sign(tx - x), dy = Math.sign(ty - y), count = Math.abs(tx - x) + Math.abs(ty - y), edgeIds = [];
    for (let i = 0; i < count; i++) {
      const edge = ctx.edges.get(edgeKey(key(x + dx * i, y + dy * i), key(x + dx * (i + 1), y + dy * (i + 1))));
      if (edge?.status !== 'available') throw new Error('OFF_GRID');
      edgeIds.push(edge.id);
    }
    return {fromNodeId: key(x, y), toNodeId: key(tx, ty), edgeIds};
  }
  function compile(ctx, route) {
    if (!Array.isArray(route) || route.length < 4 || route.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('INVALID_ROUTE');
    const guides = route.slice(1).map((b, i) => guideRecord(ctx, route[i], b));
    const R = ctx.o.radiusMm, segments = []; let cursor = route[0];
    const line = (b, guide) => {if (distance(cursor, b) > EPS) segments.push({type: 'straight', from: {...cursor}, to: {...b}, guide, lengthMm: distance(cursor, b)}); cursor = b;};
    for (let i = 1; i < route.length - 1; i++) {
      const a = route[i - 1], b = route[i], c = route[i + 1], ab = distance(a, b), bc = distance(b, c);
      const u = {x: (b.x - a.x) / ab, y: (b.y - a.y) / ab}, v = {x: (c.x - b.x) / bc, y: (c.y - b.y) / bc};
      if (Math.abs(u.x * v.x + u.y * v.y) > EPS) throw new Error('INVALID_TURN');
      const from = {x: b.x - u.x * R, y: b.y - u.y * R}, to = {x: b.x + v.x * R, y: b.y + v.y * R};
      if ((from.x - cursor.x) * u.x + (from.y - cursor.y) * u.y < -EPS || bc < R - EPS) throw new Error('RADIUS_DOES_NOT_FIT');
      line(from, guides[i - 1]);
      const center = {x: from.x + v.x * R, y: from.y + v.y * R}, delta = (u.x * v.y - u.y * v.x) * Math.PI / 2;
      segments.push({type: 'curve', from, to, center, radiusMm: R, startAngle: Math.atan2(from.y - center.y, from.x - center.x), sweepAngle: delta, lengthMm: Math.abs(delta) * R});
      cursor = to;
    }
    line(route.at(-1), guides.at(-1));
    return segments;
  }
  function arcParameter(arc, angle) {
    let d = (angle - arc.startAngle) % TAU;
    if (arc.sweepAngle > 0 && d < -EPS) d += TAU;
    if (arc.sweepAngle < 0 && d > EPS) d -= TAU;
    return d / arc.sweepAngle;
  }
  const arcAt = (arc, t) => ({x: arc.center.x + arc.radiusMm * Math.cos(arc.startAngle + t * arc.sweepAngle), y: arc.center.y + arc.radiusMm * Math.sin(arc.startAngle + t * arc.sweepAngle)});
  const onArc = (arc, p) => {const t = arcParameter(arc, Math.atan2(p.y - arc.center.y, p.x - arc.center.x)); return t >= -EPS && t <= 1 + EPS;};
  function arcInside(ctx, arc) {
    const ts = [0, 1], all = [...ctx.space.rects, ...ctx.p.exclusions.areas, ...ctx.p.room.removedAreas];
    const add = angle => {const t = arcParameter(arc, angle); if (t > 0 && t < 1) ts.push(t);};
    for (const r of all) {
      for (const x of [r.x, r.x + r.width]) {const v = (x - arc.center.x) / arc.radiusMm; if (Math.abs(v) <= 1) {const a = Math.acos(v); add(a); add(-a);}}
      for (const y of [r.y, r.y + r.height]) {const v = (y - arc.center.y) / arc.radiusMm; if (Math.abs(v) <= 1) {const a = Math.asin(v); add(a); add(Math.PI - a);}}
    }
    ts.sort((a, b) => a - b);
    const inside = t => {const p = arcAt(arc, t); return ctx.space.contains(p) && G.classifyPoint(ctx.p, p) === 'available';};
    // Include boundary-event points: a tangential touch of an exclusion is forbidden.
    return ts.every(inside) && ts.slice(1).every((t, i) => inside((t + ts[i]) / 2));
  }
  function lineArc(line, arc) {
    const a = line.from, b = line.to, dx = b.x - a.x, dy = b.y - a.y, x = a.x - arc.center.x, y = a.y - arc.center.y;
    const A = dx * dx + dy * dy, B = 2 * (x * dx + y * dy), C = x * x + y * y - arc.radiusMm ** 2, disc = B * B - 4 * A * C;
    if (disc < -EPS) return false;
    return [(-B - Math.sqrt(Math.max(0, disc))) / (2 * A), (-B + Math.sqrt(Math.max(0, disc))) / (2 * A)]
      .some(t => t >= -EPS && t <= 1 + EPS && onArc(arc, {x: a.x + t * dx, y: a.y + t * dy}));
  }
  function arcArc(a, b) {
    const d = distance(a.center, b.center), r = a.radiusMm, s = b.radiusMm;
    if (d < EPS) return Math.abs(r - s) < EPS && [a.from, a.to, arcAt(a, .5)].some(p => onArc(b, p)) || d < EPS && Math.abs(r - s) < EPS && [b.from, b.to, arcAt(b, .5)].some(p => onArc(a, p));
    if (d > r + s + EPS || d < Math.abs(r - s) - EPS) return false;
    const x = (d * d + r * r - s * s) / (2 * d), h = Math.sqrt(Math.max(0, r * r - x * x));
    const ux = (b.center.x - a.center.x) / d, uy = (b.center.y - a.center.y) / d;
    return [-1, 1].some(sign => {const p = {x: a.center.x + ux * x - sign * uy * h, y: a.center.y + uy * x + sign * ux * h}; return onArc(a, p) && onArc(b, p);});
  }
  function intersections(segments, binSize) {
    const bins = new Map(), tested = new Set();
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i], ps = [a.from, a.to];
      if (a.type === 'curve') for (let j = 0; j < 4; j++) {const angle = j * Math.PI / 2, t = arcParameter(a, angle); if (t > 0 && t < 1) ps.push(arcAt(a, t));}
      const x0 = Math.floor((Math.min(...ps.map(p => p.x)) - EPS) / binSize), x1 = Math.floor((Math.max(...ps.map(p => p.x)) + EPS) / binSize);
      const y0 = Math.floor((Math.min(...ps.map(p => p.y)) - EPS) / binSize), y1 = Math.floor((Math.max(...ps.map(p => p.y)) + EPS) / binSize);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const id = key(x, y), others = bins.get(id) || [];
        for (const j of others) {
          if (i - j <= 1 || tested.has(`${j}:${i}`)) continue;
          tested.add(`${j}:${i}`); const b = segments[j];
          const hit = a.type === 'straight' ? (b.type === 'straight' ? Geometry.intersect(a.from, a.to, b.from, b.to) : lineArc(a, b)) : (b.type === 'straight' ? lineArc(b, a) : arcArc(a, b));
          if (hit) return true;
        }
        others.push(i); bins.set(id, others);
      }
    }
    return false;
  }
  function checkSegments(ctx, segments) {
    if (!segments.length || segments.slice(1).some((s, i) => !same(segments[i].to, s.from))) throw new Error('DISCONTINUOUS');
    for (const s of segments) {
      if (s.type === 'straight' ? !ctx.guide(s.from, s.to) : !arcInside(ctx, s)) throw new Error('OUTSIDE_ALLOWED_AREA');
    }
    if (intersections(segments, ctx.step)) throw new Error('SELF_INTERSECTION');
  }
  function plan(project, settings) {
    let ctx;
    try {ctx = prepare(project, settings);} catch (e) {return fail(e.message);}
    if (!connected(ctx)) return fail('DISCONNECTED_OR_EMPTY_GRID');
    const candidates = [];
    for (const px of [0, 1]) for (const py of [0, 1]) {
      const cells = cellsFor(ctx, px, py);
      for (const clockwise of [true, false]) {
        const cycle = makeCycle(ctx, cells, clockwise); if (!cycle) continue;
        try {
          const route = openCycle(ctx, cycle), segments = compile(ctx, route); checkSegments(ctx, segments);
          const lengthMm = segments.reduce((s, p) => s + p.lengthMm, 0);
          candidates.push({id: 'grid-spiral-1', number: 1, method: 'spiral', scope: 'heating', status: 'SPIRAL_OK',
            diameterMm: ctx.p.pipe.diameterMm, route, segments, entry: {...segments[0].from}, exit: {...segments.at(-1).to},
            lengthMm, supplyTransit: null, returnTransit: null, visitedGridNodes: cycle.length, clockwise});
        } catch { /* A candidate is never displayed unless every geometric check passes. */ }
      }
    }
    candidates.sort((a, b) => b.visitedGridNodes - a.visitedGridNodes || a.lengthMm - b.lengthMm);
    if (!candidates.length) return fail('NO_VALID_SPIRAL');
    const circuit = candidates[0];
    return {ok: true, status: 'SPIRAL_OK', planner: 'grid-spiral-v31', scope: 'heating', settings: ctx.o, circuits: [circuit],
      lengthMm: circuit.lengthMm, needsTransit: true, overLength: circuit.lengthMm > 80000,
      warnings: circuit.lengthMm > 80000 ? ['HEATING_LENGTH_OVER_80M'] : []};
  }
  function validate(project, settings, result) {
    try {
      const ctx = prepare(project, settings);
      if (!result?.ok || result.status !== 'SPIRAL_OK' || result.circuits?.length !== 1) throw new Error('INVALID_PLAN');
      const c = result.circuits[0], expected = compile(ctx, c.route); checkSegments(ctx, expected);
      if (!connected(ctx)) throw new Error('DISCONNECTED_OR_EMPTY_GRID');
      if (!coversLattice(ctx, routeGridPoints(ctx, c.route))) throw new Error('INCOMPLETE_COVERAGE');
      if (JSON.stringify(expected) !== JSON.stringify(c.segments)) throw new Error('GEOMETRY_CHANGED');
      const lengthMm = expected.reduce((sum, p) => sum + p.lengthMm, 0);
      if (![c.lengthMm, result.lengthMm].every(Number.isFinite) || Math.abs(lengthMm - c.lengthMm) > EPS || Math.abs(lengthMm - result.lengthMm) > EPS) throw new Error('INVALID_LENGTH');
      if (!same(c.entry, expected[0].from) || !same(c.exit, expected.at(-1).to)) throw new Error('INVALID_ENDPOINTS');
      if (result.planner !== 'grid-spiral-v31' || result.scope !== 'heating' || result.needsTransit !== true ||
          c.scope !== 'heating' || c.method !== 'spiral' || c.status !== 'SPIRAL_OK' || c.diameterMm !== ctx.p.pipe.diameterMm ||
          c.supplyTransit !== null || c.returnTransit !== null || JSON.stringify(result.settings) !== JSON.stringify(ctx.o) ||
          result.overLength !== (lengthMm > 80000) || JSON.stringify(result.warnings) !== JSON.stringify(lengthMm > 80000 ? ['HEATING_LENGTH_OVER_80M'] : [])) throw new Error('INVALID_METADATA');
      return {ok: true, lengthMm};
    } catch (e) {return {ok: false, reason: e.message};}
  }
  function svgPath(segments) {
    if (!segments.length) return '';
    return `M ${segments[0].from.x} ${segments[0].from.y}` + segments.map(s => s.type === 'straight' ? ` L ${s.to.x} ${s.to.y}` : ` A ${s.radiusMm} ${s.radiusMm} 0 0 ${s.sweepAngle > 0 ? 1 : 0} ${s.to.x} ${s.to.y}`).join('');
  }
  function pathRange(segments, from, to) {
    const parts = []; let offset = 0;
    for (const s of segments) {
      const lo = Math.max(0, from - offset), hi = Math.min(s.lengthMm, to - offset);
      if (hi > lo + EPS) {
        const at = t => s.type === 'curve' ? arcAt(s, t) : ({x: s.from.x + (s.to.x - s.from.x) * t, y: s.from.y + (s.to.y - s.from.y) * t});
        const part = {...s, from: at(lo / s.lengthMm), to: at(hi / s.lengthMm)};
        parts.push(part);
      }
      offset += s.lengthMm;
    }
    return svgPath(parts);
  }
  return {plan, validate, svgPath, pathRange, arcAt};
});
