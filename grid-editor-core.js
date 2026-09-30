/* Warm 3.4. Editable control points + explicit gaps. Compiled arcs are never trusted on load. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grid-core.js'), require('./spiral-core.js'), require('./circuit-core.js'), require('./multi-core.js'));
  else root.WarmGridEditor = factory(root.WarmGrid, root.WarmSpiral, root.WarmCircuit, root.WarmMulti);
})(globalThis, function(G, S, C, M) {
  'use strict';
  const H = S.geometry, EPS = 1e-6, parts = ['supply', 'heating', 'return'];
  const copy = x => structuredClone(x), distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), same = (a, b) => a && b && distance(a, b) < EPS;
  const point = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y), fail = reason => ({ok: false, reason});
  function check(draft) {
    if (!draft || draft.kind !== 'grid-editor-v34' || draft.schemaVersion !== 1 || !draft.settings || typeof draft.settings !== 'object' || !Array.isArray(draft.definitions) || !draft.definitions.length || !Array.isArray(draft.circuits) || draft.circuits.length !== draft.definitions.length) throw new Error('INVALID_DRAFT');
    const ids = new Set();
    draft.circuits.forEach((c, i) => {
      if (!c || typeof c.id !== 'string' || ids.has(c.id) || c.id !== draft.definitions[i]?.id || !['spiral', 'double-snake', 'manual'].includes(c.method)) throw new Error('INVALID_DRAFT'); ids.add(c.id);
      for (const part of parts) {
        const route = c.paths?.[part], disabled = c.disabled?.[part];
        if (!Array.isArray(route) || !route.every(point) || !Array.isArray(disabled) || new Set(disabled).size !== disabled.length || disabled.some(i => !Number.isSafeInteger(i) || i < 0 || i >= route.length - 1)) throw new Error('INVALID_DRAFT');
      }
    });
    return true;
  }
  function fromCircuit(id, c) {
    return {id, method: c?.method || 'manual', paths: {supply: copy(c?.supplyTransit?.route || []), heating: copy(c?.heating?.route || []), return: copy(c?.returnTransit?.route || [])}, disabled: {supply: [], heating: [], return: []}};
  }
  function create(project, settings, definitions, result) {
    const valid = result?.planner === 'grid-multi-v33' ? M.validate(project, settings, definitions, result) : C.validate(project, settings, result);
    if (!valid.ok || result.scope !== 'complete') throw new Error('FULL_CIRCUIT_REQUIRED');
    const draft = {schemaVersion: 1, kind: 'grid-editor-v34', settings: copy(settings), definitions: copy(definitions),
      circuits: definitions.map((d, i) => fromCircuit(d.id, result.circuits.find(c => c.id === d.id) || (definitions.length === 1 ? result.circuits[0] : null)))};
    check(draft); return draft;
  }
  function selection(draft, sel) {
    check(draft); const c = draft.circuits.find(c => c.id === sel?.id), path = c?.paths[sel?.part];
    if (!c || !parts.includes(sel.part) || !Number.isSafeInteger(sel.start) || !Number.isSafeInteger(sel.end) || sel.start < 0 || sel.end >= path.length || sel.start >= sel.end) throw new Error('SELECT_SPAN');
    return {c, path};
  }
  function shift(draft, sel, cells, grid) {
    try {
      const next = copy(draft), {c, path} = selection(next, sel);
      if (sel.end !== sel.start + 1) throw new Error('SELECT_ONE_SEGMENT');
      if (!Number.isSafeInteger(cells) || !G.CELL_SIZES.includes(grid.cellSizeMm)) throw new Error('INVALID_SHIFT');
      if (sel.start === 0 || sel.end === path.length - 1) throw new Error('ENDPOINT_LOCKED');
      const a = path[sel.start], b = path[sel.end], axis = Math.abs(a.x - b.x) < EPS ? 'x' : Math.abs(a.y - b.y) < EPS ? 'y' : null;
      if (!axis) throw new Error('INVALID_TURN');
      a[axis] += cells * grid.cellSizeMm; b[axis] += cells * grid.cellSizeMm; c.method = 'manual';
      return {ok: true, draft: next};
    } catch (e) {return fail(e.message);}
  }
  function toggle(draft, sel, enabled) {
    try {
      const next = copy(draft), {c} = selection(next, sel), disabled = new Set(c.disabled[sel.part]);
      for (let i = sel.start; i < sel.end; i++) enabled ? disabled.delete(i) : disabled.add(i);
      c.disabled[sel.part] = [...disabled].sort((a, b) => a - b); c.method = 'manual'; return {ok: true, draft: next};
    } catch (e) {return fail(e.message);}
  }
  function replace(draft, sel, points) {
    try {
      const next = copy(draft), {c, path} = selection(next, sel);
      if (!Array.isArray(points) || points.length < 2 || !points.every(point) || !same(points[0], path[sel.start]) || !same(points.at(-1), path[sel.end])) throw new Error('REPLACEMENT_ENDPOINTS');
      // Keep explicit control points; no silent coordinate or radius correction.
      const shift = points.length - 1 - (sel.end - sel.start);
      c.paths[sel.part] = [...path.slice(0, sel.start), ...copy(points), ...path.slice(sel.end + 1)];
      c.disabled[sel.part] = c.disabled[sel.part].filter(i => i < sel.start || i >= sel.end).map(i => i >= sel.end ? i + shift : i);
      c.method = 'manual'; return {ok: true, draft: next, selection: {...sel, end: sel.start + points.length - 1}};
    } catch (e) {return fail(e.message);}
  }
  function reverse(draft, id) {
    try {
      check(draft); const next = copy(draft), i = next.circuits.findIndex(c => c.id === id), c = next.circuits[i], d = next.definitions[i];
      if (!c) throw new Error('SELECT_CIRCUIT');
      const old = copy(c);
      for (const part of parts) {const src = part === 'supply' ? 'return' : part === 'return' ? 'supply' : part; c.paths[part] = old.paths[src].slice().reverse(); c.disabled[part] = old.disabled[src].map(i => old.paths[src].length - 2 - i).sort((a, b) => a - b);}
      [d.supply, d.returnPoint] = [d.returnPoint, d.supply]; return {ok: true, draft: next};
    } catch (e) {return fail(e.message);}
  }
  function preview(c, radius) {
    const result = [];
    for (const part of parts) {
      const path = c.paths[part], disabled = new Set(c.disabled[part]); let chunk = [];
      const flush = () => {
        if (chunk.length > 1) {
          try {result.push(...H.roundPath(chunk, radius, [], Array(chunk.length - 1).fill(part)));}
          catch {result.push(...chunk.slice(1).map((to, i) => ({type: 'straight', from: copy(chunk[i]), to: copy(to), part, lengthMm: distance(chunk[i], to)})));}
        }
        chunk = [];
      };
      for (let i = 0; i < path.length - 1; i++) {
        if (disabled.has(i)) {flush(); continue;}
        if (!chunk.length) chunk.push(path[i]); chunk.push(path[i + 1]);
      }
      flush();
    }
    return result;
  }
  function inspect(project, draft) {
    const issues = [], circuits = [], add = (code, id = null, part = null, edges = []) => issues.push({code, id, part, edges});
    let ctx, structured = false;
    try {check(draft); structured = true; ctx = M.prepare(project, draft.definitions);} catch (e) {
      return {ok: false, complete: false, issues: [{code: e.message, id: null, part: null, edges: []}],
        circuits: structured ? draft.circuits.map(c => ({id: c.id, valid: false, circuit: null, preview: preview(c, draft.settings.radiusMm), lengthMm: null})) : [], lengthMm: null, warnings: []};
    }
    for (let i = 0; i < draft.circuits.length; i++) {
      const c = draft.circuits[i], def = draft.definitions[i], zone = M.zoneProject(ctx.p, def); let heatingContext;
      try {heatingContext = H.prepare(zone, draft.settings);} catch (e) {add(e.message, c.id);}
      for (const part of parts) {
        const path = c.paths[part]; if (path.length < 2) add('MISSING_ROUTE', c.id, part);
        if (c.disabled[part].length) add('GAP', c.id, part, copy(c.disabled[part]));
        for (let j = 0; j < path.length - 1; j++) {
          if (c.disabled[part].includes(j)) continue;
          const a = path[j], b = path[j + 1];
          if (same(a, b) || Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {add('INVALID_TURN', c.id, part, [j]); continue;}
          if (G.classifySegment(part === 'heating' ? zone : ctx.p, a, b) !== 'available' || part === 'heating' && heatingContext && !heatingContext.guide(a, b)) add('OUTSIDE_ALLOWED_AREA', c.id, part, [j]);
          if (part === 'heating' && heatingContext) {try {H.guideRecord(heatingContext, a, b);} catch {add('OFF_GRID', c.id, part, [j]);}}
        }
      }
      const built = C.rebuild(zone, draft.settings, c.paths, {transitProject: ctx.p});
      if (!built.ok && !issues.some(e => e.id === c.id && e.code === built.reason)) add(built.reason, c.id);
      const valid = built.ok && !issues.some(e => e.id === c.id);
      const circuit = built.ok ? {...built.circuit, id: c.id, number: i + 1, name: def.name, zone: copy(def.zone)} : null;
      circuits.push({id: c.id, valid, circuit: valid ? circuit : null, preview: built.ok && !c.disabled.supply.length && !c.disabled.heating.length && !c.disabled.return.length ? built.circuit.segments : preview(c, draft.settings.radiusMm), lengthMm: valid ? circuit.lengthMm : null});
    }
    // Independently compiled circuits are compared even if a neighbour has a gap.
    // A broken route is never certified, and visible fragments still participate.
    for (let i = 0; i < circuits.length; i++) for (let j = i + 1; j < circuits.length; j++) {
      if (M.crossIntersections([{segments: circuits[i].preview}, {segments: circuits[j].preview}], ctx.p.grid.cellSizeMm)) {add('CIRCUIT_INTERSECTION', circuits[i].id); add('CIRCUIT_INTERSECTION', circuits[j].id); circuits[i].valid = circuits[j].valid = false;}
    }
    if (ctx.coverage.unassignedAreaMm2 > EPS) add('UNASSIGNED_AREA');
    const warnings = circuits.filter(c => c.lengthMm > 80000).map(c => ({code: 'CIRCUIT_LENGTH_OVER_80M', id: c.id}));
    const complete = issues.length === 0;
    return {ok: complete, complete, issues, warnings, circuits, coverage: ctx.coverage,
      lengthMm: circuits.every(c => c.lengthMm != null) ? circuits.reduce((n, c) => n + c.lengthMm, 0) : null};
  }
  function nearest(draft, p, tolerance, id, part) {
    const hits = [];
    for (const c of draft.circuits) {if (id && c.id !== id) continue; for (const k of parts) {if (part && k !== part) continue; const path = c.paths[k];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const at = {x: a.x + t * dx, y: a.y + t * dy}, d = distance(p, at);
        if (d <= tolerance) hits.push({id: c.id, part: k, start: i, end: i + 1, at, distance: d});
      }
    }}
    return hits.sort((a, b) => a.distance - b.distance || a.start - b.start);
  }
  function connect(project, draft, sel) {
    try {
      const {path} = selection(draft, sel), a = path[sel.start], b = path[sel.end], grid = project.grid.cellSizeMm;
      const candidates = [[a, b], [a, {x: a.x, y: b.y}, b], [a, {x: b.x, y: a.y}, b]];
      for (const delta of [-grid, grid, -2 * grid, 2 * grid]) {
        candidates.push([a, {x: a.x + delta, y: a.y}, {x: a.x + delta, y: b.y}, b], [a, {x: a.x, y: a.y + delta}, {x: b.x, y: a.y + delta}, b]);
      }
      for (const route of candidates) {
        const cleaned = route.filter((p, i) => !i || !same(p, route[i - 1])), result = replace(draft, sel, cleaned);
        if (result.ok && inspect(project, result.draft).ok) return result;
      }
      return fail('CONNECTION_NOT_FOUND');
    } catch (e) {return fail(e.message);}
  }
  function replan(project, draft, id, method) {
    try {
      check(draft); const i = draft.circuits.findIndex(c => c.id === id); if (i < 0) throw new Error('SELECT_CIRCUIT');
      const report = inspect(project, draft), others = report.circuits.filter(c => c.id !== id);
      if (others.some(c => !c.valid)) throw new Error('OTHER_CIRCUITS_INVALID');
      const plan = C.plan(M.zoneProject(project, draft.definitions[i]), {...draft.settings, method}, {transitProject: project, occupied: others.flatMap(c => c.circuit.segments)});
      if (!plan.ok) return fail(plan.reason);
      const next = copy(draft); next.circuits[i] = fromCircuit(id, plan.circuits[0]); return {ok: true, draft: next};
    } catch (e) {return fail(e.message);}
  }
  return {create, check, inspect, shift, toggle, replace, reverse, connect, replan, nearest, selection, parts};
});
