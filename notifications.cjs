const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../grid-core.js');
const rect = (x, y, width, height) => ({x, y, width, height});
const project = (sections, areas = [], size = 100) => G.createProject({room: {sections}, exclusions: {areas}, grid: {cellSizeMm: size}});
const status = (p, a, b) => G.classifySegment(p, {x: a[0], y: a[1]}, {x: b[0], y: b[1]});

test('physical scale, origin, stable node IDs and every supported grid/diameter', () => {
  for (const cellSizeMm of [100, 150, 200]) for (const diameterMm of [16, 17, 20]) {
    const p = G.createProject({room: {sections: [rect(-50, -25, 600, 600)]}, grid: {cellSizeMm, origin: {x: -50, y: -25}}, pipe: {diameterMm}});
    const graph = G.buildGrid(p);
    assert.equal(graph.nodes.length, (600 / cellSizeMm + 1) ** 2);
    assert.equal(graph.counts.nodes.unavailable, 0);
    assert.equal(graph.edges.every(e => e.lengthMm === cellSizeMm), true);
    const s = G.straightSegment(graph, '0,0', `0,${600 / cellSizeMm}`);
    assert.equal(s.lengthMm, 600);
    assert.equal(G.straightSegment(graph, `0,${600 / cellSizeMm}`, '0,0').lengthMm, 600);
  }
  assert.throws(() => G.createProject({grid: {cellSizeMm: 50}}), RangeError);
  assert.throws(() => G.createProject({pipe: {diameterMm: 18}}), RangeError);
  assert.throws(() => project([rect(0, 0, Infinity, 100)]), TypeError);
});
test('L room and shared section seams remain exact, without raster expansion', () => {
  const p = project([rect(0, 0, 400, 200), rect(0, 200, 200, 200)]);
  assert.equal(status(p, [100, 100], [100, 300]), 'available');
  assert.equal(status(p, [300, 100], [300, 300]), 'unavailable');
  assert.equal(status(p, [0, 200], [200, 200]), 'available');
  const g = G.buildGrid(p);
  assert.equal(g.nodes.find(n => n.id === '3,3').status, 'unavailable');
  assert.throws(() => G.straightSegment(g, '3,1', '3,3'));
  assert.throws(() => G.straightSegment(g, '1,1', '2,2'));
});
test('whole edges detect narrow gaps and obstacles between otherwise available nodes', () => {
  const obstacle = project([rect(0, 0, 200, 200)], [rect(21, 90, 2, 20)]);
  assert.equal(G.classifyPoint(obstacle, {x: 0, y: 100}), 'available');
  assert.equal(G.classifyPoint(obstacle, {x: 100, y: 100}), 'available');
  assert.equal(status(obstacle, [0, 100], [100, 100]), 'excluded');
  assert.equal(status(obstacle, [100, 100], [0, 100]), 'excluded');
  assert.throws(() => G.straightSegment(G.buildGrid(obstacle), '0,1', '1,1'));
  const gap = project([rect(0, 0, 21, 200), rect(23, 0, 177, 200)]);
  assert.equal(status(gap, [0, 100], [100, 100]), 'unavailable');
  assert.equal(status(project([rect(0, 0, 200, 200)], [rect(20, 100, 20, 20)]), [0, 100], [100, 100]), 'excluded', 'touching exclusion boundary is blocked');
});
test('removed cells belong to the room, while exclusions have their own status', () => {
  const p = G.createProject({room: {sections: [rect(0, 0, 400, 400)], removedAreas: [rect(100, 100, 100, 100)]},
    exclusions: {areas: [rect(300, 300, 50, 50)]}});
  assert.equal(G.classifyPoint(p, {x: 150, y: 150}), 'unavailable');
  assert.equal(G.classifyPoint(p, {x: 310, y: 310}), 'excluded');
  assert.equal(status(p, [50, 150], [250, 150]), 'unavailable');
});
test('legacy migration preserves exact obstacles, painted cells, room edits and collector', () => {
  const raw = {versionLabel: '2.9.1', gridStepMm: 50, pipeDiameterMm: 17, shapeStepMm: 100,
    sections: [rect(0, 0, 400, 400)], roomAdded: ['4,0'], roomRemoved: ['0,0'],
    obstacles: [rect(120, 120, 60, 60)], excluded: ['2,2', '3,3', '6,6'], supply: {x: 100, y: 0, side: 'top'}};
  const before = JSON.stringify(raw), p = G.fromLegacy(raw);
  assert.deepEqual(p.exclusions.areas, [rect(120, 120, 60, 60), rect(300, 300, 50, 50)]);
  assert.deepEqual(p.room.removedAreas, [rect(0, 0, 100, 100)]);
  assert.deepEqual(p.room.sections.at(-1), rect(400, 0, 100, 100));
  assert.deepEqual(p.collector.supply, raw.supply);
  assert.equal(p.grid.cellSizeMm, 150);
  assert.equal(p.pipe.diameterMm, 17);
  assert.equal(p.migration.warnings.length, 1);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(G.fromLegacy(JSON.parse(JSON.stringify({projectV3: p}))), p);
  const unsupported = G.fromLegacy({...raw, pipeDiameterMm: 18});
  assert.equal(unsupported.migration.legacyPipeDiameterMm, 18);
  assert.equal(unsupported.migration.warnings.length, 2);
});
test('grid and pipe changes never reshape geometry or select a number of circuits', () => {
  const p = project([rect(13, 7, 900, 430)], [rect(225, 35, 23, 270)]);
  const geometry = JSON.stringify([p.room, p.exclusions]);
  const counts = new Set();
  for (const size of G.CELL_SIZES) {
    p.grid.cellSizeMm = size; counts.add(G.buildGrid(p).nodes.length);
    for (const d of G.PIPE_DIAMETERS) {
      const before = G.buildGrid(p); p.pipe.diameterMm = d;
      assert.deepEqual(G.buildGrid(p), before);
      assert.equal(p.circuits.length, 0);
      assert.equal(JSON.stringify([p.room, p.exclusions]), geometry);
    }
  }
  assert.equal(counts.size, 3);
});
test('legacy circuits remain dynamic and explicitly unvalidated on the new grid', () => {
  const circuits = Array.from({length: 21}, (_, i) => ({id: i, length: 99999, route: [{x: 0, y: i}, {x: 100, y: i}]}));
  const p = G.fromLegacy({unifiedPlan: {kind: 'spiral', circuits}});
  assert.equal(p.circuits.length, 21);
  assert.equal(p.circuits.every(c => c.status === 'legacy-unvalidated' && c.lengthMm === 100 && c.segments.length === 0), true);
  assert.equal('minBendRadiusMm' in p.pipe, false);
  assert.deepEqual(G.buildGrid(G.createProject()).nodes, []);
});
