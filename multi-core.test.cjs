const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../grid-core.js'), S = require('../spiral-core.js'), C = require('../circuit-core.js'), M = require('../multi-core.js'), E = require('../grid-editor-core.js');
const settings = {radiusMm: 40, spacingCells: 2, wallOffsetMm: 100, method: 'auto'};
const rect = (x, y, width, height) => ({x, y, width, height});
const p = G.createProject({room: {sections: [rect(0, 0, 4800, 3600)]}, collector: {supply: {x: 600, y: 3600}, returnPoint: {x: 650, y: 3600}}});
const defs = [{id: 'grid-circuit-1', name: 'Первый', zone: null, supply: p.collector.supply, returnPoint: p.collector.returnPoint}];
const base = C.plan(p, settings), draft = E.create(p, settings, defs, base);
const sel = {id: draft.circuits[0].id, part: 'heating', start: 1, end: 2};
const inspect = d => E.inspect(p, d), good = d => {const r = inspect(d); assert.equal(r.ok, true, JSON.stringify(r.issues)); return r;};
test('3.2 import preserves exact geometry and length; full circuit required', () => {
  const c = good(draft).circuits[0].circuit; assert.deepEqual(c.segments, base.circuits[0].segments); assert.equal(c.lengthMm, base.lengthMm);
  assert.throws(() => E.create(p, settings, defs, S.plan(p, settings)), /FULL_CIRCUIT_REQUIRED/);
});
test('one physical cell move inside a two-cell pattern preserves radius and ports', () => {
  const before = JSON.stringify(draft), moved = E.shift(draft, sel, -1, p.grid); assert.equal(moved.ok, true);
  const c = good(moved.draft).circuits[0].circuit;
  assert.equal(moved.draft.circuits[0].paths.heating[1].y, draft.circuits[0].paths.heating[1].y - 150);
  assert.ok(c.segments.filter(s => s.type === 'curve').every(s => s.radiusMm === 40));
  assert.deepEqual(c.supply, p.collector.supply); assert.deepEqual(c.returnPoint, p.collector.returnPoint); assert.equal(JSON.stringify(draft), before);
});
test('invalid move stays in draft without silent clamping; endpoints locked', () => {
  const moved = E.shift(draft, sel, -30, p.grid); assert.equal(moved.ok, true); assert.ok(inspect(moved.draft).issues.some(i => i.code === 'OUTSIDE_ALLOWED_AREA')); assert.equal(moved.draft.settings.radiusMm, 40);
  assert.equal(E.shift(draft, {...sel, start: 0, end: 1}, 1, p.grid).reason, 'ENDPOINT_LOCKED'); assert.equal(E.shift(draft, sel, .5, p.grid).ok, false);
});
test('gap survives serialization; restore returns original arcs and length', () => {
  const gap = E.toggle(draft, sel, false).draft, r = inspect(gap); assert.equal(r.ok, false); assert.ok(r.issues.some(i => i.code === 'GAP' && i.edges.includes(1))); assert.equal(r.lengthMm, null);
  const restored = E.toggle(JSON.parse(JSON.stringify(gap)), sel, true).draft; assert.deepEqual(good(restored).circuits[0].circuit.segments, base.circuits[0].segments);
});
test('join endpoints repairs a deleted section', () => {
  const result = E.connect(p, E.toggle(draft, sel, false).draft, sel); assert.equal(result.ok, true); good(result.draft);
});
test('replacement preserves anchors and remaps later gaps', () => {
  const route = draft.circuits[0].paths.heating, a = route[1], b = route[2], mid = {x: 1800, y: a.y};
  const later = E.toggle(draft, {...sel, start: 5, end: 6}, false).draft, result = E.replace(later, sel, [a, mid, b]);
  assert.equal(result.ok, true); assert.deepEqual(result.draft.circuits[0].disabled.heating, [6]); good(E.replace(draft, sel, [a, mid, b]).draft);
  assert.equal(E.replace(draft, sel, [{x: a.x + 1, y: a.y}, b]).reason, 'REPLACEMENT_ENDPOINTS'); assert.equal(E.replace(draft, sel, [a, {x: NaN, y: a.y}, b]).ok, false);
});
test('local detour compiles exact arcs and includes both transits in length', () => {
  const route = draft.circuits[0].paths.heating, a = route[1], b = route[2];
  const points = [a, {x: 1500, y: a.y}, {x: 1500, y: a.y - 150}, {x: 3000, y: a.y - 150}, {x: 3000, y: a.y}, b];
  const c = good(E.replace(draft, sel, points).draft).circuits[0].circuit;
  const measured = c.segments.reduce((n, s) => n + (s.type === 'straight' ? Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) : Math.abs(s.sweepAngle) * s.radiusMm), 0);
  assert.ok(Math.abs(measured - c.lengthMm) < 1e-6); assert.ok(c.lengthMm > base.lengthMm);
});
test('diagonal, off-grid and tight turns are reported without altering control points', () => {
  const route = draft.circuits[0].paths.heating, a = route[1], b = route[2];
  for (const points of [[a, {x: 1501, y: a.y - 1}, b], [a, {x: 1501, y: a.y}, {x: 1501, y: a.y - 150}, {x: 3000, y: a.y - 150}, {x: 3000, y: a.y}, b]]) {const r = E.replace(draft, sel, points); assert.equal(r.ok, true); assert.equal(inspect(r.draft).ok, false);}
  const r = E.replace(draft, sel, [a, {x: a.x, y: a.y - 150}, {x: a.x + 150, y: a.y - 150}, {x: a.x + 150, y: a.y}, b]); r.draft.settings.radiusMm = 100; assert.equal(inspect(r.draft).ok, false); assert.equal(r.draft.settings.radiusMm, 100);
});
test('reverse swaps actual ports, all parts and gaps; twice restores original draft', () => {
  const swapped = E.reverse(draft, sel.id), c = good(swapped.draft).circuits[0].circuit;
  assert.deepEqual(c.supply, p.collector.returnPoint); assert.deepEqual(c.returnPoint, p.collector.supply); assert.ok(Math.abs(c.lengthMm - base.lengthMm) < 1e-6); assert.deepEqual(E.reverse(swapped.draft, sel.id).draft, draft);
  const gap = E.toggle(draft, sel, false).draft; assert.deepEqual(E.reverse(E.reverse(gap, sel.id).draft, sel.id).draft, gap);
});
test('method replacement affects only selected circuit and preserves explicit settings', () => {
  const q = G.createProject({room: {sections: [rect(0, 0, 4800, 2400)]}}), options = {...settings, spacingCells: 1};
  const definitions = [0, 1].map(i => ({id: `c${i}`, name: `Контур ${i}`, zone: rect(2400 * i, 0, 2400, 2400), supply: {x: 600 + 100 * i, y: 2400}, returnPoint: {x: 650 + 100 * i, y: 2400}}));
  const d = E.create(q, options, definitions, M.plan(q, options, definitions)), result = E.replan(q, d, 'c1', 'double-snake');
  assert.equal(result.ok, true, result.reason); assert.equal(E.inspect(q, result.draft).ok, true); assert.equal(result.draft.circuits[1].method, 'double-snake'); assert.deepEqual(result.draft.circuits[0], d.circuits[0]); assert.deepEqual(result.draft.settings, options);
});
test('mutual crossings affect both circuits and prevent completion', () => {
  const definitions = [0, 1].map(i => ({id: `c${i}`, name: `Контур ${i}`, zone: rect(i * 2400, 0, 2400, 3600), supply: {x: 600 + i * 2400, y: 3600}, returnPoint: {x: 650 + i * 2400, y: 3600}}));
  const d = E.create(p, settings, definitions, M.plan(p, settings, definitions)), lead = d.circuits[1].paths.supply;
  lead.splice(1, 0, {x: lead[0].x, y: 3500}, {x: 600, y: 3500}, {x: 600, y: 3600}, {x: lead[0].x, y: 3600});
  const r = inspect(d); assert.equal(r.ok, false); assert.ok(r.issues.filter(i => i.code === 'CIRCUIT_INTERSECTION').length >= 2);
});
test('reopening checks new obstacles on arcs and missing coverage', () => {
  const saved = JSON.parse(JSON.stringify(draft)), arc = base.circuits[0].segments.find(s => s.type === 'curve'), at = S.arcAt(arc, .5), q = structuredClone(p);
  q.exclusions.areas.push(rect(at.x - .1, at.y - .1, .2, .2)); assert.equal(E.inspect(q, saved).ok, false);
  const missing = structuredClone(saved); missing.circuits[0].paths.heating = [{x: 600, y: 3300}, {x: 600, y: 2700}, {x: 900, y: 2700}, {x: 900, y: 3300}]; assert.ok(inspect(missing).issues.some(i => i.code === 'INCOMPLETE_COVERAGE'));
});
test('malformed drafts rejected; saved fake lengths and segments ignored', () => {
  for (const edit of [d => d.circuits[0].disabled.heating = [900], d => d.circuits[0].paths.heating[0].x = Infinity, d => d.circuits[0].id = 'wrong', d => d.settings = null]) {const bad = structuredClone(draft); edit(bad); assert.equal(inspect(bad).ok, false);}
  const fake = structuredClone(draft); fake.lengthMm = 1; fake.segments = []; assert.equal(good(fake).lengthMm, base.lengthMm);
});
test('hit selection includes deleted segments for restoration', () => {
  const gap = E.toggle(draft, sel, false).draft, a = gap.circuits[0].paths.heating[1], b = gap.circuits[0].paths.heating[2];
  const hit = E.nearest(gap, {x: (a.x + b.x) / 2, y: a.y}, 10, sel.id, 'heating')[0]; assert.equal(hit.start, 1); assert.equal(hit.part, 'heating');
});
test('manual editor imports 14 circuits without a count ceiling', () => {
  const q = G.createProject({room: {sections: [rect(0, 0, 14 * 2400, 2400)]}}), options = {...settings, spacingCells: 1};
  const definitions = Array.from({length: 14}, (_, i) => ({id: `c${i}`, name: `Контур ${i}`, zone: rect(i * 2400, 0, 2400, 2400), supply: {x: 600 + i * 2400, y: 2400}, returnPoint: {x: 650 + i * 2400, y: 2400}}));
  const d = E.create(q, options, definitions, M.plan(q, options, definitions)), r = E.inspect(q, E.reverse(d, 'c13').draft);
  assert.equal(r.ok, true); assert.equal(r.circuits.length, 14);
});
test('manual total retains the 80m warning including both transits', () => {
  const q = G.createProject({room: {sections: [rect(0, 0, 4500, 3000)]}, collector: {supply: {x: 0, y: 0}, returnPoint: {x: 4500, y: 3000}}}), options = {...settings, spacingCells: 1};
  const definitions = [{id: 'grid-circuit-1', name: 'Длинный', zone: null, supply: q.collector.supply, returnPoint: q.collector.returnPoint}];
  const d = E.create(q, options, definitions, C.plan(q, options)), r = E.inspect(q, d); assert.equal(r.ok, true); assert.ok(r.lengthMm > 80000); assert.equal(r.warnings[0].id, definitions[0].id);
});
test('changed empty zone retains a visible invalid preview', () => {
  const d = structuredClone(draft); d.definitions[0].zone = rect(9000, 9000, 1000, 1000);
  const r = inspect(d); assert.equal(r.ok, false); assert.ok(r.circuits[0].preview.length); assert.equal(r.circuits[0].circuit, null);
});
