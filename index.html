const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../grid-core.js'), S = require('../spiral-core.js');
const rect = (x, y, width, height) => ({x, y, width, height});
const shapes = {
  rectangle: [rect(0, 0, 4000, 3000)],
  L: [rect(0, 0, 4000, 1800), rect(0, 1800, 2100, 1500)],
  ledges: [rect(0, 0, 4200, 1800), rect(900, 1800, 2400, 1800)],
  asymmetric: [rect(-900, -450, 4200, 2250), rect(-900, 1800, 1950, 1350)],
  narrow: [rect(0, 0, 900, 4500)]
};
function project(sections = shapes.rectangle, areas = [], cellSizeMm = 150, diameterMm = 16) {
  return G.createProject({room: {sections}, exclusions: {areas}, grid: {cellSizeMm}, pipe: {diameterMm},
    collector: {supply: {x: 600, y: 3000, side: 'bottom'}, returnPoint: {x: 650, y: 3000, side: 'bottom'}}});
}
const options = {radiusMm: 60, spacingCells: 1, wallOffsetMm: 100};
function verify(p, settings, plan) {
  assert.equal(plan.status, 'SPIRAL_OK', JSON.stringify(plan));
  assert.equal(plan.circuits.length, 1); assert.equal(plan.needsTransit, true);
  assert.equal(S.validate(p, settings, plan).ok, true);
  const c = plan.circuits[0], graph = G.buildGrid(p), edges = new Map(graph.edges.map(e => [e.id, e]));
  let length = 0;
  for (let i = 0; i < c.segments.length; i++) {
    const s = c.segments[i];
    if (i) assert.ok(Math.hypot(s.from.x - c.segments[i - 1].to.x, s.from.y - c.segments[i - 1].to.y) < 1e-6);
    if (s.type === 'straight') {
      assert.ok(s.guide.edgeIds.length && s.guide.edgeIds.every(id => edges.get(id)?.status === 'available'));
      assert.ok(Math.abs(s.from.x - s.to.x) < 1e-6 || Math.abs(s.from.y - s.to.y) < 1e-6);
      length += Math.hypot(s.from.x - s.to.x, s.from.y - s.to.y);
    } else {
      assert.equal(s.radiusMm, settings.radiusMm); assert.equal(Math.abs(s.sweepAngle), Math.PI / 2);
      length += Math.PI * s.radiusMm / 2;
    }
    // Independent dense probes of the rendered primitives, not just route vertices.
    for (let k = 0; k <= 40; k++) {
      const t = k / 40, point = s.type === 'straight' ? {x: s.from.x + (s.to.x - s.from.x) * t, y: s.from.y + (s.to.y - s.from.y) * t}
        : {x: s.center.x + s.radiusMm * Math.cos(s.startAngle + t * s.sweepAngle), y: s.center.y + s.radiusMm * Math.sin(s.startAngle + t * s.sweepAngle)};
      assert.equal(G.classifyPoint(p, point), 'available');
    }
  }
  assert.ok(Math.abs(length - c.lengthMm) < 1e-5);
  assert.match(S.svgPath(c.segments), / A /);
  assert.notEqual(S.pathRange(c.segments, 0, c.lengthMm / 2), S.pathRange(c.segments, c.lengthMm / 2, c.lengthMm));
}
for (const [name, sections] of Object.entries(shapes)) test(`continuous rounded spiral: ${name}`, () => {
  const p = project(sections), before = JSON.stringify(p), plan = S.plan(p, options);
  verify(p, options, plan); assert.equal(JSON.stringify(p), before);
});
test('all grid/diameter combinations; diameter does not choose radius or change geometry', () => {
  for (const size of [100, 150, 200]) {
    let route;
    for (const diameter of [16, 17, 20]) {
      const p = project(shapes.rectangle, [], size, diameter), o = {...options, radiusMm: 40}, plan = S.plan(p, o);
      verify(p, o, plan);
      if (route) assert.deepEqual(plan.circuits[0].route, route);
      route = plan.circuits[0].route;
    }
  }
});
test('internal exclusion, off-grid column and two staggered obstacles', () => {
  for (const areas of [[rect(1500, 900, 600, 600)], [rect(1730, 1170, 450, 550)], [rect(900, 600, 300, 450), rect(2100, 1600, 450, 350)]]) {
    const p = project(shapes.rectangle, areas); verify(p, options, S.plan(p, options));
  }
});
test('explicit radius, integral grid spacing, no silent radius shrinking or circuit split', () => {
  assert.equal(S.plan(project(), {}).reason, 'RADIUS_REQUIRED');
  assert.equal(S.plan(project(), {...options, radiusMm: 80}).reason, 'RADIUS_DOES_NOT_FIT');
  assert.equal(S.plan(project(), {...options, spacingCells: 1.5}).reason, 'INVALID_SPACING');
  const p = project(), o = {...options, spacingCells: 2, radiusMm: 100}; verify(p, o, S.plan(p, o));
  const big = project([rect(0, 0, 6000, 6000)]), plan = S.plan(big, options);
  verify(big, options, plan); assert.ok(plan.lengthMm > 80000); assert.equal(plan.overLength, true); assert.equal(plan.circuits.length, 1);
});
test('cannot silently discard a disconnected island, narrow neck or fully excluded zone', () => {
  for (const p of [project([...shapes.rectangle, rect(6000, 0, 1500, 1500)]), project([...shapes.rectangle, rect(6001, 1, 20, 20)]), project(shapes.rectangle, shapes.rectangle),
    project([rect(0, 0, 1200, 1200), rect(1200, 550, 900, 100), rect(2100, 0, 1200, 1200)]), project([rect(0, 0, 200, 3000)])]) {
    const plan = S.plan(p, options); assert.equal(plan.status, 'SPIRAL_IMPOSSIBLE'); assert.deepEqual(plan.circuits, []);
  }
});
test('crowded obstacle corridors reject unsupported topology, but work at an explicitly smaller offset', () => {
  const p = project(shapes.rectangle, [rect(400, 500, 300, 450), rect(900, 1400, 450, 350)]);
  assert.equal(S.plan(p, options).status, 'SPIRAL_IMPOSSIBLE');
  const o = {...options, wallOffsetMm: 0}; verify(p, o, S.plan(p, o));
});
test('serialized geometry, arcs, length and newly added obstacles are revalidated', () => {
  const p = project(), plan = S.plan(p, options), copy = () => JSON.parse(JSON.stringify(plan));
  assert.equal(S.validate(p, options, copy()).ok, true);
  let q = copy(); q.circuits[0].segments.find(s => s.type === 'curve').radiusMm = 1; assert.equal(S.validate(p, options, q).ok, false);
  q = copy(); q.circuits[0].lengthMm = 1; assert.equal(S.validate(p, options, q).ok, false);
  q = copy(); q.lengthMm = NaN; assert.equal(S.validate(p, options, q).ok, false);
  q = copy(); q.needsTransit = false; assert.equal(S.validate(p, options, q).reason, 'INVALID_METADATA');
  q = copy(); q.overLength = true; assert.equal(S.validate(p, options, q).reason, 'INVALID_METADATA');
  q = copy(); q.circuits[0].route[2].x += 7; assert.equal(S.validate(p, options, q).ok, false);
  const arc = plan.circuits[0].segments.find(s => s.type === 'curve'), at = S.arcAt(arc, .5);
  const obstacle = project(shapes.rectangle, [rect(at.x - .1, at.y - .1, .2, .2)]);
  assert.equal(S.validate(obstacle, {...options, wallOffsetMm: 0}, plan).ok, false, 'even a tiny obstacle on an arc must be detected');
});

test('reject a self-intersection and a valid route covering only a small part of the room', () => {
  const p = project(), plan = S.plan(p, options);
  plan.circuits[0].route = [{x: 300, y: 600}, {x: 1800, y: 600}, {x: 1800, y: 1800}, {x: 600, y: 1800}, {x: 600, y: 300}, {x: 2100, y: 300}];
  assert.equal(S.validate(p, options, plan).reason, 'SELF_INTERSECTION');
  const partial = S.plan(project([rect(0, 0, 1200, 1200)]), options);
  assert.equal(partial.ok, true);
  assert.equal(S.validate(p, options, partial).reason, 'INCOMPLETE_COVERAGE');
});
test('nested rectangle passes really progress inward before returning outward', () => {
  const plan = S.plan(project(), options), c = plan.circuits[0];
  const depth = p => Math.min(p.x, 4000 - p.x, p.y, 3000 - p.y);
  const depths = c.route.map(depth), max = Math.max(...depths), at = depths.indexOf(max);
  assert.ok(max >= 1200); assert.ok(at > 2 && at < depths.length - 3);
  assert.ok(depths[0] < max / 2 && depths.at(-1) < max / 2);
});
