/* Warm 3.2. One complete grid circuit: supply transit, heating, return transit.
   Explicit radius/spacing only. No diameter rules or automatic circuit allocation. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grid-core.js'), require('./spiral-core.js'), require('./engine-unified.js'));
  else root.WarmCircuit = factory(root.WarmGrid, root.WarmSpiral, root.WarmEngine);
})(globalThis, function(G, S, Geo) {
  'use strict';
  const H = S.geometry, EPS = 1e-6, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const point = p => ({x: p.x, y: p.y}), same = (a, b) => a && b && dist(a, b) < EPS;
  const fail = (reason, extra = {}) => ({ok: false, status: 'ROUTE_IMPOSSIBLE', reason, circuits: [], ...extra});
  function prepare(project, settings) {
    const ctx = H.prepare(project, settings), method = settings?.method ?? 'auto';
    if (!['auto', 'spiral', 'double-snake'].includes(method)) throw new Error('INVALID_METHOD');
    ctx.settings = {...ctx.o, method};
    const {supply, returnPoint} = ctx.p.collector;
    if (![supply, returnPoint].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('COLLECTOR_REQUIRED');
    if (same(supply, returnPoint)) throw new Error('COINCIDENT_PORTS');
    if ([supply, returnPoint].some(p => G.classifyPoint(ctx.p, p) !== 'available')) throw new Error('COLLECTOR_OUTSIDE');
    if (!H.connected(ctx)) throw new Error('DISCONNECTED_OR_EMPTY_GRID');
    // Transit must reach ports on the wall. Only the heating area has the user's inset.
    const space = Geo.freeSpace({sections: ctx.p.room.sections, obstacles: [...ctx.p.room.removedAreas, ...ctx.p.exclusions.areas], wallOffsetMm: 0, pipeDiameterMm: 0});
    ctx.transit = {...ctx, space, guide: (a, b) => G.classifySegment(ctx.p, a, b) === 'available' && space.covers(a, b)};
    return ctx;
  }
  function assemble(ctx, heatingRoute, supplyRoute, returnRoute, method, complete = true) {
    if (!['spiral', 'double-snake'].includes(method)) throw new Error('INVALID_METHOD');
    H.checkSegments(ctx, H.compile(ctx, heatingRoute));
    if (!H.coversLattice(ctx, H.routeGridPoints(ctx, heatingRoute))) throw new Error('INCOMPLETE_COVERAGE');
    const entries = [['supply', supplyRoute], ['heating', heatingRoute], ['return', returnRoute]], route = [], parts = [], guides = [];
    for (const [part, path] of entries) {
      if (!Array.isArray(path)) throw new Error('INVALID_ROUTE');
      if (!path.length && !complete) continue;
      if (path.length < 2 || path.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('INVALID_ROUTE');
      if (route.length && !same(route.at(-1), path[0])) throw new Error('DISCONTINUOUS');
      if (!route.length) route.push(point(path[0]));
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        if (same(a, b) || (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS)) throw new Error('INVALID_TURN');
        route.push(point(b)); parts.push(part);
        guides.push(part === 'heating' ? H.guideRecord(ctx, a, b) : null);
      }
    }
    if (complete && (!same(route[0], ctx.p.collector.supply) || !same(route.at(-1), ctx.p.collector.returnPoint))) throw new Error('INVALID_ENDPOINTS');
    const segments = H.roundPath(route, ctx.o.radiusMm, guides, parts);
    // One validation of all three parts, including both hand-off bends and mutual crossings.
    H.checkSegments(ctx.transit, segments);
    const heatingSegments = segments.filter(s => s.part === 'heating');
    H.checkSegments(ctx, heatingSegments);
    const section = (part, path) => {const ss = segments.filter(s => s.part === part); return {route: path.map(point), segments: ss, lengthMm: ss.reduce((n, s) => n + s.lengthMm, 0)};};
    const supplyTransit = section('supply', supplyRoute), heating = section('heating', heatingRoute), returnTransit = section('return', returnRoute);
    return {id: 'grid-circuit-1', number: 1, method, scope: 'complete', status: 'CIRCUIT_OK', diameterMm: ctx.p.pipe.diameterMm,
      supply: point(ctx.p.collector.supply), returnPoint: point(ctx.p.collector.returnPoint), route, segments,
      supplyTransit, heating, returnTransit, lengthMm: supplyTransit.lengthMm + heating.lengthMm + returnTransit.lengthMm};
  }
  function cycles(ctx, method) {
    const result = [], seen = new Set();
    for (const x of [0, 1]) for (const y of [0, 1]) {
      const cells = H.cellsFor(ctx, x, y);
      for (const variant of [false, true]) {
        const cycle = H.makeCycle(ctx, cells, variant, method, variant);
        if (!cycle) continue;
        const signature = cycle.map(p => p.id).join(';');
        if (!seen.has(signature)) {result.push(cycle); seen.add(signature);}
      }
    }
    return result.sort((a, b) => b.length - a.length);
  }
  function openings(ctx, cycle) {
    const {supply, returnPoint} = ctx.p.collector;
    const edges = cycle.map((a, i) => ({i, score: dist(supply, a) + dist(returnPoint, cycle[(i + 1) % cycle.length])}));
    edges.sort((a, b) => a.score - b.score);
    return edges.slice(0, 12).flatMap(({i}) => {
      const route = Geo.clean([...cycle.slice(i + 1), ...cycle.slice(0, i + 1)].map(point));
      const reversed = route.slice().reverse();
      return [route, reversed].sort((a, b) => dist(a[0], supply) + dist(a.at(-1), returnPoint) - dist(b[0], supply) - dist(b.at(-1), returnPoint));
    });
  }
  function simplePaths(ctx, a, b) {
    const result = [], seen = new Set(), R = ctx.o.radiusMm;
    const add = path => {
      const p = Geo.clean(path), signature = JSON.stringify(p);
      if (p.length < 2 || seen.has(signature) || p.slice(1).some((q, i) => !ctx.transit.guide(p[i], q))) return;
      seen.add(signature); result.push(p);
    };
    if (Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS) add([a, b]);
    add([a, {x: a.x, y: b.y}, b]); add([a, {x: b.x, y: a.y}, b]);
    // Candidate lane coordinates are search choices, not prescribed mounting distances.
    const coords = axis => [...new Set([a[axis], b[axis], (a[axis] + b[axis]) / 2,
      ...[a[axis], b[axis]].flatMap(v => [v - 2 * R, v - R, v + R, v + 2 * R]),
      ...ctx.transit.space.rects.flatMap(r => [r[axis] + R, r[axis] + (axis === 'x' ? r.width : r.height) - R])])];
    for (const x of coords('x')) add([a, {x, y: a.y}, {x, y: b.y}, b]);
    for (const y of coords('y')) add([a, {x: a.x, y}, {x: b.x, y}, b]);
    return result.sort((a, b) => Geo.length(a) - Geo.length(b));
  }
  function connect(ctx, heating, method) {
    const {supply, returnPoint} = ctx.p.collector;
    const leads = [], tails = [];
    for (const path of simplePaths(ctx, point(supply), heating[0])) {
      try {assemble(ctx, heating, path, [], method, false); leads.push(path); if (leads.length === 5) break;} catch {}
    }
    if (!leads.length) return null;
    for (const path of simplePaths(ctx, point(returnPoint), heating.at(-1))) {
      const tail = path.slice().reverse();
      try {assemble(ctx, heating, [], tail, method, false); tails.push(tail); if (tails.length === 5) break;} catch {}
    }
    const pairs = leads.flatMap(lead => tails.map(tail => ({lead, tail, score: Geo.length(lead) + Geo.length(tail)}))).sort((a, b) => a.score - b.score);
    for (const {lead, tail} of pairs) {
      try {return assemble(ctx, heating, lead, tail, method);} catch {}
    }
    return null;
  }
  function plan(project, settings) {
    let ctx;
    try {ctx = prepare(project, settings);} catch (e) {return fail(e.message);}
    const methods = ctx.settings.method === 'auto' ? ['spiral', 'double-snake'] : [ctx.settings.method];
    const attempts = [], deadline = Date.now() + 18000;
    for (const method of methods) {
      const candidates = cycles(ctx, method);
      for (const cycle of candidates) for (const route of openings(ctx, cycle)) {
        if (Date.now() > deadline) return fail('SEARCH_LIMIT', {attempts});
        const circuit = connect(ctx, route, method);
        if (!circuit) continue;
        const overLength = circuit.lengthMm > 80000;
        return {ok: true, status: 'ROUTE_OK', planner: 'grid-circuit-v32', scope: 'complete', settings: ctx.settings,
          method, circuits: [circuit], lengthMm: circuit.lengthMm, needsTransit: false, overLength,
          warnings: overLength ? ['CIRCUIT_LENGTH_OVER_80M'] : [], fallbackUsed: ctx.settings.method === 'auto' && method === 'double-snake', attempts};
      }
      attempts.push({method, reason: candidates.length ? 'TRANSIT_NOT_FOUND' : 'HEATING_NOT_FOUND'});
    }
    return fail('NO_COMPLETE_CIRCUIT', {attempts});
  }
  function validate(project, settings, result) {
    try {
      const ctx = prepare(project, settings);
      if (!result?.ok || result.status !== 'ROUTE_OK' || result.planner !== 'grid-circuit-v32' || result.scope !== 'complete' || result.needsTransit !== false || result.circuits?.length !== 1) throw new Error('INVALID_PLAN');
      const c = result.circuits[0];
      if (ctx.settings.method !== 'auto' && ctx.settings.method !== c.method) throw new Error('INVALID_METHOD');
      const expected = assemble(ctx, c.heating?.route, c.supplyTransit?.route, c.returnTransit?.route, c.method);
      if (JSON.stringify(expected) !== JSON.stringify(c)) throw new Error('GEOMETRY_CHANGED');
      const overLength = expected.lengthMm > 80000;
      if (!Number.isFinite(result.lengthMm) || Math.abs(result.lengthMm - expected.lengthMm) > EPS) throw new Error('INVALID_LENGTH');
      if (result.method !== c.method || JSON.stringify(result.settings) !== JSON.stringify(ctx.settings) || result.overLength !== overLength ||
          JSON.stringify(result.warnings) !== JSON.stringify(overLength ? ['CIRCUIT_LENGTH_OVER_80M'] : []) || result.fallbackUsed !== (ctx.settings.method === 'auto' && c.method === 'double-snake')) throw new Error('INVALID_METADATA');
      return {ok: true, lengthMm: expected.lengthMm};
    } catch (e) {return {ok: false, reason: e.message};}
  }
  return {plan, validate};
});
