const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../grid-core.js'), M = require('../multi-core.js'), C = require('../circuit-core.js');
const rect = (x, y, width, height) => ({x, y, width, height});
const settings = {radiusMm: 40, spacingCells: 1, wallOffsetMm: 100, method: 'auto'};
const project = (n = 2) => G.createProject({room: {sections: [rect(0, 0, n * 2400, 2400)]}});
const definitions = (n = 2) => Array.from({length: n}, (_, i) => ({id: `c${i + 1}`, name: `Контур ${i + 1}`, zone: rect(i * 2400, 0, 2400, 2400), supply: {x: i * 2400 + 600, y: 2400}, returnPoint: {x: i * 2400 + 650, y: 2400}}));
function verify(p, defs, r, options = settings) {
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.complete, true, JSON.stringify(r.results.map(c => c.reason)));
  assert.equal(r.circuits.length, defs.length); assert.equal(M.validate(p, options, defs, r).ok, true);
  assert.equal(M.crossIntersections(r.circuits), false);
  assert.equal(r.lengthMm, r.circuits.reduce((n, c) => n + c.lengthMm, 0));
  r.circuits.forEach((c, i) => {assert.equal(c.id, defs[i].id); assert.deepEqual(c.supply, defs[i].supply); assert.deepEqual(c.returnPoint, defs[i].returnPoint);});
}
test('two independent zones, exact ports, no mutation, complete coverage', () => {
  const p = project(), defs = definitions(), before = JSON.stringify([p, defs]), r = M.plan(p, settings, defs); verify(p, defs, r); assert.equal(JSON.stringify([p, defs]), before);
});
test('14 user-selected circuits, no 10/13 count ceiling', () => {
  const p = project(14), defs = definitions(14), progress = [], r = M.plan(p, settings, defs, p => progress.push(p)); verify(p, defs, r); assert.equal(progress.length, 14);
});
test('four adjacent collector ports feed different zones through the full room', () => {
  const p = project(), defs = definitions(); defs[1].supply.x = 700; defs[1].returnPoint.x = 750;
  const r = M.plan(p, settings, defs); verify(p, defs, r);
  assert.ok(r.circuits[1].supplyTransit.segments.some(s => s.from.x < defs[1].zone.x));
});
test('disconnected rooms work as separately assigned circuits; transits cannot jump gaps', () => {
  const p = G.createProject({room: {sections: [rect(0, 0, 2400, 2400), rect(3000, 0, 2400, 2400)]}}), defs = definitions();
  defs[1].zone.x = 3000; defs[1].supply.x = 3600; defs[1].returnPoint.x = 3650;
  verify(p, defs, M.plan(p, settings, defs));
});
test('explicit double snake for multiple circuits', () => {
  const p = project(), defs = definitions(), options = {...settings, method: 'double-snake'}, r = M.plan(p, options, defs); verify(p, defs, r, options); assert.ok(r.circuits.every(c => c.method === 'double-snake'));
});
test('overlap, unset zones, empty zones and duplicate IDs are rejected', () => {
  const p = project();
  for (const [edit, reason] of [
    [d => d[1].zone.x = 2000, 'ZONES_OVERLAP'], [d => d[0].zone = null, 'ZONES_REQUIRED'],
    [d => d[1].zone.x = 9000, 'EMPTY_ZONE'], [d => d[1].id = d[0].id, 'INVALID_CIRCUIT_ID'],
    [d => d[0].zone.width = 0, 'INVALID_ZONE']]) {const defs = definitions(); edit(defs); assert.equal(M.plan(p, settings, defs).reason, reason);}
});
test('tiny unassigned strips are measured and do not claim completion', () => {
  const p = project(), defs = definitions(); defs[1].zone.x += 0.2; defs[1].zone.width -= 0.2;
  const r = M.plan(p, settings, defs); assert.equal(r.complete, false); assert.ok(Math.abs(r.coverage.unassignedAreaMm2 - 480) < 1e-6); assert.ok(r.warnings.includes('UNASSIGNED_AREA')); assert.equal(M.validate(p, settings, defs, r).ok, true);
});
test('failed circuit preserves valid neighbours and cannot be marked complete', () => {
  const p = project(), defs = definitions(); defs[1].supply = null;
  const r = M.plan(p, settings, defs); assert.equal(r.status, 'MULTI_PARTIAL'); assert.equal(r.circuits.length, 1); assert.equal(r.results[1].reason, 'COLLECTOR_REQUIRED'); assert.equal(M.validate(p, settings, defs, r).ok, true);
  r.complete = true; assert.equal(M.validate(p, settings, defs, r).ok, false);
});
test('independent intersection checks include adjacent array indices, shared endpoints, arcs and tangency', () => {
  const line = (a, b) => ({type: 'straight', from: a, to: b});
  const arc = {type: 'curve', from: {x: 10, y: 0}, to: {x: 0, y: 10}, center: {x: 0, y: 0}, radiusMm: 10, startAngle: 0, sweepAngle: Math.PI / 2};
  for (const [a, b] of [[line({x: 0, y: 0}, {x: 20, y: 0}), line({x: 10, y: -5}, {x: 10, y: 5})],
    [line({x: 0, y: 0}, {x: 10, y: 0}), line({x: 10, y: 0}, {x: 20, y: 0})],
    [arc, line({x: 10, y: -5}, {x: 10, y: 5})], [arc, structuredClone(arc)]]) assert.equal(M.crossIntersections([{segments: [a]}, {segments: [b]}]), true);
});
test('occupied circuits affect the search and are rechecked during validation', () => {
  const defs = definitions(1), p = project(1), zone = M.zoneProject(p, defs[0]), first = C.plan(zone, settings);
  assert.equal(first.ok, true); assert.equal(C.validate(zone, settings, first, {occupied: first.circuits[0].segments}).reason, 'CIRCUIT_INTERSECTION');
  // An occupied pipe along the entire port wall makes every possible connection invalid.
  const occupied = [{type: 'straight', from: {x: 0, y: 2400}, to: {x: 2400, y: 2400}}];
  assert.equal(C.plan(zone, settings, {occupied}).ok, false);
});
test('save validation rejects changed ports, exclusions, routes, totals and definitions', () => {
  const p = project(), defs = definitions(), r = M.plan(p, settings, defs);
  for (const edit of [r => r.lengthMm++, r => r.circuits[0].segments[0].lengthMm++, r => r.results[0].plan.circuits[0].supplyTransit.route[0].x++, r => r.coverage.unassignedAreaMm2 = 1, r => r.definitions[0].zone.width--]) {
    const q = structuredClone(r); edit(q); assert.equal(M.validate(p, settings, defs, q).ok, false);
  }
  const changed = structuredClone(defs); changed[0].supply.x++; assert.equal(M.validate(p, settings, changed, r).ok, false);
  const c = r.circuits[0].segments[0], at = {x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2}; p.exclusions.areas.push(rect(at.x - .1, at.y - .1, .2, .2)); assert.equal(M.validate(p, settings, defs, r).ok, false);
});
test('non-rectangular room clipping and excluded-only overlaps', () => {
  const p = G.createProject({room: {sections: [rect(0, 0, 2400, 2400), rect(2400, 0, 2400, 1200)]}}), defs = definitions(); defs[1].supply.y = defs[1].returnPoint.y = 1200;
  verify(p, defs, M.plan(p, settings, defs));
  const q = project(); q.exclusions.areas.push(rect(2300, 0, 200, 2400)); const d = definitions(); d[0].zone.width = 2500; d[1].zone.x = 2300; d[1].zone.width = 2500;
  assert.equal(M.measure(q, d).overlapAreaMm2, 0);
});
test('per-circuit 80m warning uses full length without choosing more circuits', () => {
  const p = G.createProject({room: {sections: [rect(0, 0, 9000, 3000)]}}), defs = [0, 1].map(i => ({id: `c${i}`, name: `Контур ${i + 1}`, zone: rect(i * 4500, 0, 4500, 3000), supply: {x: i * 4500, y: 0}, returnPoint: {x: (i + 1) * 4500, y: 3000}}));
  const r = M.plan(p, settings, defs); verify(p, defs, r); assert.equal(r.circuits.length, 2); assert.equal(r.overLength, true); assert.ok(r.circuits.some(c => c.lengthMm > 80000));
});
