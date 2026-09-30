/* Warm 3.3. User-defined zones and port pairs; no automatic circuit count. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grid-core.js'), require('./circuit-core.js'), require('./spiral-core.js'));
  else root.WarmMulti = factory(root.WarmGrid, root.WarmCircuit, root.WarmSpiral);
})(globalThis, function(G, C, S) {
  'use strict';
  const EPS = 1e-6, copy = x => structuredClone(x), equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fail = reason => ({ok: false, status: 'MULTI_IMPOSSIBLE', reason, circuits: []});
  const inside = (r, x, y) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height;
  function clip(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
    return width > EPS && height > EPS ? {x, y, width, height} : null;
  }
  function zoneProject(p, d) {
    const sections = d.zone ? p.room.sections.map(r => clip(r, d.zone)).filter(Boolean) : p.room.sections;
    return G.createProject({...p, room: {...p.room, sections}, collector: {supply: d.supply, returnPoint: d.returnPoint}, circuits: []});
  }
  function prepare(project, definitions) {
    const p = G.createProject(project);
    if (!Array.isArray(definitions) || !definitions.length) throw new Error('CIRCUITS_REQUIRED');
    const ids = new Set(), defs = copy(definitions);
    for (const d of defs) {
      if (!d || typeof d.id !== 'string' || !d.id || ids.has(d.id)) throw new Error('INVALID_CIRCUIT_ID');
      ids.add(d.id);
      if (typeof d.name !== 'string') throw new Error('INVALID_CIRCUIT_NAME');
      if (d.zone == null) {if (defs.length !== 1) throw new Error('ZONES_REQUIRED');}
      else if (!['x', 'y', 'width', 'height'].every(k => Number.isFinite(d.zone[k])) || d.zone.width <= 0 || d.zone.height <= 0) throw new Error('INVALID_ZONE');
    }
    const coverage = measure(p, defs);
    if (coverage.overlapAreaMm2 > EPS) throw new Error('ZONES_OVERLAP');
    if (coverage.zoneAreasMm2.some(a => a <= EPS)) throw new Error('EMPTY_ZONE');
    return {p, defs, coverage};
  }
  // Exact rectangular arrangement, including sub-grid gaps and tiny exclusions.
  // Area is assigned before the explicit wall offset; it is not a thermal calculation.
  function measure(p, defs) {
    const holes = [...p.room.removedAreas, ...p.exclusions.areas], rects = [...p.room.sections, ...holes, ...defs.map(d => d.zone).filter(Boolean)];
    const xs = [...new Set(rects.flatMap(r => [r.x, r.x + r.width]))].sort((a, b) => a - b);
    const ys = [...new Set(rects.flatMap(r => [r.y, r.y + r.height]))].sort((a, b) => a - b);
    let availableAreaMm2 = 0, assignedAreaMm2 = 0, overlapAreaMm2 = 0;
    const zoneAreasMm2 = defs.map(() => 0);
    for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++) {
      const x = (xs[i - 1] + xs[i]) / 2, y = (ys[j - 1] + ys[j]) / 2;
      if (!p.room.sections.some(r => inside(r, x, y)) || holes.some(r => inside(r, x, y))) continue;
      const area = (xs[i] - xs[i - 1]) * (ys[j] - ys[j - 1]); availableAreaMm2 += area;
      let n = 0;
      defs.forEach((d, k) => {if (!d.zone || inside(d.zone, x, y)) {n++; zoneAreasMm2[k] += area;}});
      if (n) assignedAreaMm2 += area;
      if (n > 1) overlapAreaMm2 += area;
    }
    return {availableAreaMm2, assignedAreaMm2, unassignedAreaMm2: Math.max(0, availableAreaMm2 - assignedAreaMm2), overlapAreaMm2, zoneAreasMm2};
  }
  function resultFor(ctx, settings, results) {
    const circuits = results.flatMap((r, i) => r.plan ? [{...copy(r.plan.circuits[0]), id: ctx.defs[i].id, number: i + 1, name: ctx.defs[i].name, zone: copy(ctx.defs[i].zone ?? null)}] : []);
    const complete = circuits.length === ctx.defs.length && ctx.coverage.unassignedAreaMm2 <= EPS;
    const overLength = circuits.some(c => c.lengthMm > 80000), warnings = [];
    if (overLength) warnings.push('CIRCUIT_LENGTH_OVER_80M');
    if (ctx.coverage.unassignedAreaMm2 > EPS) warnings.push('UNASSIGNED_AREA');
    if (circuits.length !== ctx.defs.length) warnings.push('UNBUILT_CIRCUITS');
    return {ok: true, status: complete ? 'MULTI_OK' : 'MULTI_PARTIAL', planner: 'grid-multi-v33', scope: 'complete',
      complete, needsTransit: !complete, settings: copy(settings), definitions: copy(ctx.defs), results,
      circuits, coverage: ctx.coverage, lengthMm: circuits.reduce((n, c) => n + c.lengthMm, 0), overLength, warnings};
  }
  function plan(project, settings, definitions, progress = () => {}) {
    let ctx;
    try {ctx = prepare(project, definitions);} catch (e) {return fail(e.message);}
    const occupied = [], results = [];
    for (let i = 0; i < ctx.defs.length; i++) {
      const d = ctx.defs[i]; progress({index: i, total: ctx.defs.length, name: d.name});
      const result = C.plan(zoneProject(ctx.p, d), settings, {transitProject: ctx.p, occupied});
      if (result.ok) {results.push({id: d.id, plan: result}); occupied.push(...result.circuits[0].segments);}
      else results.push({id: d.id, reason: result.reason});
    }
    return resultFor(ctx, settings, results);
  }
  function validate(project, settings, definitions, result) {
    try {
      const ctx = prepare(project, definitions), occupied = [];
      if (!result?.ok || !Array.isArray(result.results) || result.results.length !== ctx.defs.length) throw new Error('INVALID_PLAN');
      for (let i = 0; i < ctx.defs.length; i++) {
        const d = ctx.defs[i], r = result.results[i];
        if (!r || r.id !== d.id) throw new Error('INVALID_CIRCUIT_ID');
        if (r.plan) {
          const checked = C.validate(zoneProject(ctx.p, d), settings, r.plan, {transitProject: ctx.p, occupied});
          if (!checked.ok) throw new Error(checked.reason);
          occupied.push(...r.plan.circuits[0].segments);
        } else if (typeof r.reason !== 'string' || !r.reason) throw new Error('INVALID_RESULT');
      }
      if (!equal(result, resultFor(ctx, settings, result.results))) throw new Error('INVALID_METADATA');
      return {ok: true, complete: result.complete};
    } catch (e) {return {ok: false, reason: e.message};}
  }
  function crossIntersections(circuits, binSize = 150) {
    return S.geometry.intersections(circuits.flatMap(c => c.segments), binSize, circuits.flatMap((c, i) => c.segments.map(() => i)));
  }
  return {plan, validate, measure, zoneProject, crossIntersections, prepare};
});
