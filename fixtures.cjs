const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../grid-core.js'), C = require('../circuit-core.js'), S = require('../spiral-core.js');
const fixtures = require('./fixtures.cjs');
const options = {radiusMm: 60, spacingCells: 1, wallOffsetMm: 100, method: 'auto'};
const project = (input = fixtures[0].input) => G.createProject({room: {sections: input.sections}, exclusions: {areas: input.obstacles}, collector: {supply: input.supply, returnPoint: input.returnPoint}});
const same = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6);
function verify(p, result, settings = options) {
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.status, 'ROUTE_OK');
  assert.equal(C.validate(p, settings, result).ok, true); assert.equal(result.needsTransit, false);
  assert.equal(result.circuits.length, 1);
  const c = result.circuits[0]; same(c.segments[0].from, p.collector.supply); same(c.segments.at(-1).to, p.collector.returnPoint);
  assert.ok(c.supplyTransit.segments.length); assert.ok(c.returnTransit.segments.length); assert.ok(c.heating.segments.length);
  assert.deepEqual([...c.supplyTransit.segments, ...c.heating.segments, ...c.returnTransit.segments], c.segments);
  let measured = 0;
  const tangent = (s, end) => s.type === 'straight' ? {x: (s.to.x - s.from.x) / s.lengthMm, y: (s.to.y - s.from.y) / s.lengthMm}
    : {x: -Math.sin(s.startAngle + (end ? s.sweepAngle : 0)) * Math.sign(s.sweepAngle), y: Math.cos(s.startAngle + (end ? s.sweepAngle : 0)) * Math.sign(s.sweepAngle)};
  for (let i = 0; i < c.segments.length; i++) {
    const s = c.segments[i];
    if (i) {same(c.segments[i - 1].to, s.from); same(tangent(c.segments[i - 1], true), tangent(s, false));}
    measured += s.type === 'straight' ? Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) : Math.abs(s.sweepAngle) * s.radiusMm;
    if (s.type === 'curve') assert.equal(s.radiusMm, settings.radiusMm);
    if (s.type === 'straight' && s.part === 'heating') assert.ok(s.guide.edgeIds.length);
    for (let j = 0; j <= 20; j++) {
      const t = j / 20, at = s.type === 'curve' ? S.arcAt(s, t) : {x: s.from.x + t * (s.to.x - s.from.x), y: s.from.y + t * (s.to.y - s.from.y)};
      assert.equal(G.classifyPoint(p, at), 'available', `part ${s.part}`);
    }
  }
  assert.ok(Math.abs(measured - c.lengthMm) < 1e-5);
  assert.ok(Math.abs(c.lengthMm - c.supplyTransit.lengthMm - c.heating.lengthMm - c.returnTransit.lengthMm) < 1e-5);
  assert.equal(result.lengthMm, c.lengthMm); assert.equal(result.overLength, c.lengthMm > 80000);
}
for (const f of fixtures) test(`complete spiral and double snake: ${f.name}`, () => {
  const p = project(f.input), before = JSON.stringify(p), a = C.plan(p, options); verify(p, a); assert.equal(a.method, 'spiral');
  const settings = {...options, method: 'double-snake'}, b = C.plan(p, settings); verify(p, b, settings); assert.equal(b.method, 'double-snake');
  assert.equal(JSON.stringify(p), before, 'collector and room are not moved');
  if (f.name === 'rectangle') assert.notDeepEqual(a.circuits[0].heating.route, b.circuits[0].heating.route);
});
test('all mounting grids and diameters, manually entered radius and spacing', () => {
  for (const size of [100, 150, 200]) {
    let previous;
    for (const diameter of [16, 17, 20]) {
      const p = project(); p.grid.cellSizeMm = size; p.pipe.diameterMm = diameter;
      const settings = {...options, radiusMm: 40}, r = C.plan(p, settings); verify(p, r, settings);
      if (previous) assert.deepEqual(r.circuits[0].route, previous);
      previous = r.circuits[0].route;
    }
  }
  const settings = {...options, spacingCells: 2, radiusMm: 100}; verify(project(), C.plan(project(), settings), settings);
});
test('off-grid collector on all four walls, either port order', () => {
  for (const side of ['top', 'right', 'bottom', 'left']) for (const order of [1, -1]) {
    const p = project(), a = side === 'top' ? {x: 625, y: 0} : side === 'bottom' ? {x: 625, y: 3000} : side === 'left' ? {x: 0, y: 625} : {x: 4000, y: 625};
    const b = ['top', 'bottom'].includes(side) ? {x: a.x + 50 * order, y: a.y} : {x: a.x, y: a.y + 50 * order};
    p.collector = {supply: {...a, side}, returnPoint: {...b, side}}; verify(p, C.plan(p, options));
  }
});
test('never publish incomplete, disconnected, blocked, zero-radius or missing-port routes', () => {
  let p = project(); p.collector.supply = null; assert.equal(C.plan(p, options).reason, 'COLLECTOR_REQUIRED');
  p = project(); p.collector.returnPoint = {...p.collector.supply}; assert.equal(C.plan(p, options).reason, 'COINCIDENT_PORTS');
  p = project(); p.collector.supply.x = -50; assert.equal(C.plan(p, options).reason, 'COLLECTOR_OUTSIDE');
  p = project(); p.exclusions.areas = [{x: 590, y: 2900, width: 100, height: 100}]; assert.equal(C.plan(p, options).reason, 'COLLECTOR_OUTSIDE');
  p = project(); p.room.sections.push({x: 6001, y: 1, width: 10, height: 10}); assert.equal(C.plan(p, options).reason, 'DISCONNECTED_OR_EMPTY_GRID');
  p = project(); p.exclusions.areas = [{x: 1000, y: 0, width: 100, height: 3000}]; assert.equal(C.plan(p, options).reason, 'DISCONNECTED_OR_EMPTY_GRID');
  assert.equal(C.plan(project(), {...options, radiusMm: 0}).reason, 'RADIUS_REQUIRED');
  assert.equal(C.plan(project(), {...options, radiusMm: 80}).reason, 'RADIUS_DOES_NOT_FIT');
});
test('revalidation includes transit geometry, mutual intersections, arcs, lengths and collector endpoints', () => {
  const p = project(), plan = C.plan(p, options), copy = () => structuredClone(plan);
  let q = copy(); q.circuits[0].supplyTransit.route[0].x += 1; assert.equal(C.validate(p, options, q).ok, false);
  q = copy(); q.circuits[0].returnTransit.segments[0].lengthMm = 0; assert.equal(C.validate(p, options, q).ok, false);
  q = copy(); q.circuits[0].segments.find(s => s.type === 'curve' && s.part !== 'heating').radiusMm = 1; assert.equal(C.validate(p, options, q).ok, false);
  q = copy(); q.lengthMm = q.circuits[0].heating.lengthMm; assert.equal(C.validate(p, options, q).reason, 'INVALID_LENGTH');
  q = copy(); q.overLength = !q.overLength; assert.equal(C.validate(p, options, q).reason, 'INVALID_METADATA');
  q = copy(); q.needsTransit = true; assert.equal(C.validate(p, options, q).reason, 'INVALID_PLAN');
  const arc = plan.circuits[0].segments.find(s => s.type === 'curve' && s.part === 'return'), at = S.arcAt(arc, .5);
  const changed = structuredClone(p); changed.exclusions.areas.push({x: at.x - .1, y: at.y - .1, width: .2, height: .2});
  assert.equal(C.validate(changed, options, plan).ok, false, 'tiny obstacle on a transit arc');
  q = copy(); const end = q.circuits[0].supplyTransit.route.at(-1);
  q.circuits[0].supplyTransit.route = [p.collector.supply, {x: 600, y: 150}, {x: 900, y: 150}, {x: 900, y: end.y}, end];
  assert.equal(C.validate(p, options, q).reason, 'SELF_INTERSECTION');
});
test('over 80 m counts the entire single circuit without automatic allocation', () => {
  const p = project(fixtures.find(f => f.name === 'large-rectangle').input), plan = C.plan(p, options);
  verify(p, plan); assert.equal(plan.overLength, true); assert.deepEqual(plan.warnings, ['CIRCUIT_LENGTH_OVER_80M']);
  assert.equal(plan.circuits.length, 1); assert.ok(plan.lengthMm > plan.circuits[0].heating.lengthMm);
});
test('the 80 m warning includes transit even when heating alone is below the limit', () => {
  const p = G.createProject({room: {sections: [{x: 0, y: 0, width: 4500, height: 3000}]}, collector: {supply: {x: 0, y: 0}, returnPoint: {x: 4500, y: 3000}}});
  const result = C.plan(p, options); verify(p, result);
  assert.ok(result.circuits[0].heating.lengthMm < 80000); assert.ok(result.lengthMm > 80000); assert.equal(result.overLength, true);
});
test('auto tries double snake after a spiral generator failure; explicit spiral never changes method', () => {
  // Fault injection tests the fallback contract independently of which finite
  // search happens to succeed on today's fixture geometries. Snake remains real.
  const original = S.geometry.makeCycle, calls = [];
  S.geometry.makeCycle = (...args) => {calls.push(args[3]); return args[3] === 'spiral' ? null : original(...args);};
  try {
    const p = project(), result = C.plan(p, options); verify(p, result);
    assert.equal(result.method, 'double-snake'); assert.equal(result.fallbackUsed, true);
    assert.deepEqual(result.attempts, [{method: 'spiral', reason: 'HEATING_NOT_FOUND'}]);
    assert.ok(calls.indexOf('double-snake') > calls.lastIndexOf('spiral'));
    calls.length = 0;
    const explicit = C.plan(p, {...options, method: 'spiral'});
    assert.equal(explicit.ok, false); assert.deepEqual(explicit.circuits, []); assert.ok(calls.every(method => method === 'spiral'));
  } finally {S.geometry.makeCycle = original;}
});
