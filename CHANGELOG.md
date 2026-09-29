const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..');
const fixture = require('./fixtures.cjs')[0].input;
const legacyPlan = require('../engine-unified.js').plan({...fixture, pattern: 'spiral'});
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({headless: true, ...(process.env.WARM_BROWSER ? {executablePath: process.env.WARM_BROWSER} : {})});
    for (const mobile of [false, true]) {
      const page = await browser.newPage({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900}, isMobile: mobile, hasTouch: mobile});
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const url = `http://127.0.0.1:${server.address().port}/index.html`;
      await page.goto(url);
      await page.locator('#createFirstBtn').click();
      await page.waitForSelector('#shapeSheet.open');
      await page.locator('#shapeWidthInput').fill('4.23');
      await page.locator('#shapeHeightInput').fill('3.17');
      await page.locator('#doneShapeV24').click();
      const initial = await page.evaluate(() => WarmV300.project());
      assert.equal(initial.room.sections[0].width, 4230);
      assert.equal(initial.room.sections[0].height, 3170);
      assert.equal(initial.grid.cellSizeMm, 150);
      assert.equal(await page.evaluate(() => state.maxCircuitLengthM), 80);
      assert.equal(await page.locator('.mounting-grid-v3').count(), 1);
      await page.locator('#settingsBtn').click();
      assert.deepEqual(await page.locator('#mountingGridInput option').evaluateAll(nodes => nodes.map(n => n.value)), ['100', '150', '200']);
      assert.deepEqual(await page.locator('#pipeDiameterInput option').evaluateAll(nodes => nodes.map(n => n.value)), ['16', '17', '20']);
      for (const size of ['100', '150', '200']) {
        await page.locator('#mountingGridInput').selectOption(size);
        assert.equal(await page.evaluate(() => WarmV300.grid().cellSizeMm), Number(size));
        assert.deepEqual(await page.evaluate(() => WarmV300.project().room), initial.room);
      }
      await page.locator('#pipeDiameterInput').selectOption('17');
      await page.evaluate(() => closeSheetV5());
      await page.locator('#undoBtn').click();
      assert.equal(await page.evaluate(() => state.pipeDiameterMm), 16);
      await page.locator('#undoBtn').click();
      assert.equal(await page.evaluate(() => state.mountingGridV3.cellSizeMm), 150);
      await page.locator('#settingsBtn').click();
      await page.locator('#mountingGridInput').selectOption('200');
      await page.locator('#pipeDiameterInput').selectOption('20');
      await page.locator('#nameInput').fill('Grid 3.0');
      if (process.env.WARM_SCREENSHOTS) {
        fs.mkdirSync(process.env.WARM_SCREENSHOTS, {recursive: true});
        await page.locator('#mountingGridInput').scrollIntoViewIfNeeded();
        await page.screenshot({path: path.join(process.env.WARM_SCREENSHOTS, `grid-settings-${mobile ? 'mobile' : 'desktop'}.png`)});
      }
      await page.locator('#saveBtn').click();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY))[0]);
      assert.equal(saved.versionLabel, fs.readFileSync(path.join(root, 'VERSION.txt'), 'utf8').trim());
      assert.equal(saved.projectV3.grid.cellSizeMm, 200);
      assert.equal(saved.projectV3.pipe.diameterMm, 20);
      assert.equal(saved.gridStepMm, 50, 'legacy raster precision stays independent');
      await page.reload();
      await page.getByRole('button', {name: 'Открыть', exact: true}).click();
      assert.deepEqual(await page.evaluate(() => WarmV300.project()), saved.projectV3);
      // Real shape tools still support corner cuts, rotation and undo.
      await page.locator('#shapeToolBtn').click();
      await page.locator('[data-v24-corner="tr"]').click();
      await page.locator('#toggleCornerCutV24').click();
      await page.locator('#doneShapeV24').click();
      assert.ok((await page.evaluate(() => WarmV300.project().room.sections.length)) > 1);
      const beforeRotate = await page.evaluate(() => WarmV300.project().room);
      await page.locator('#rotateBtn').click();
      assert.notDeepEqual(await page.evaluate(() => WarmV300.project().room), beforeRotate);
      await page.locator('#undoBtn').click();
      assert.deepEqual(await page.evaluate(() => WarmV300.project().room), beforeRotate);
      // Import a legacy project with an exact off-grid column and independent painted cell.
      const migration = await page.evaluate(() => {
        const raw = serializeState(); delete raw.projectV3;
        raw.versionLabel = '2.9.1'; raw.gridStepMm = 50; raw.pipeDiameterMm = 17;
        raw.obstacles = [{id: 'column', x: 120, y: 120, width: 60, height: 60}];
        raw.excluded = ['2,2', '3,3', '6,6']; raw.roomAdded = []; raw.roomRemoved = [];
        loadScheme(raw);
        const p = WarmV300.project(), again = serializeState(); loadScheme(again);
        return {p, restored: WarmV300.project(), input: WarmV260.input(), status: $('status').textContent};
      });
      assert.equal(migration.p.exclusions.areas.length, 2);
      assert.deepEqual(migration.p, migration.restored);
      assert.equal(migration.input.obstacles.length, 2);
      // Preserve the current route editor and serialize the live draft, not its
      // previous automatic plan, into the new circuit records.
      await page.evaluate(({fixture, legacyPlan}) => {
        newScheme();
        Object.assign(state, {sections: fixture.sections, obstacles: [], excluded: new Set(),
          supply: fixture.supply, returnPoint: fixture.returnPoint, shapeType: 'custom', shapeParams: {}, shapeAxes: null,
          enginePlanV1: legacyPlan, route: [], routeComplete: true});
        syncInputs(); recomputeGeometry(); renderPlan();
      }, {fixture, legacyPlan});
      await page.waitForSelector('#shapeSheet.open');
      await page.evaluate(() => closeSheetV5());
      await page.locator('#manualToolBtn').click();
      const midpoint = await page.evaluate(() => {
        const r = WarmEditor.plan.circuits[0].route, a = r[3], b = r[4], m = planSvg.getScreenCTM();
        return {x: m.a * (a.x + b.x) / 2 + m.e, y: m.d * (a.y + b.y) / 2 + m.f};
      });
      await page.mouse.click(midpoint.x, midpoint.y);
      await page.locator('#editPlus').click();
      const draft = await page.evaluate(() => {WarmEditor.autosave(); return serializeState();});
      assert.deepEqual(draft.projectV3.circuits[0].legacyRoute, draft.editorDraft.plan.circuits[0].route);
      assert.notDeepEqual(draft.projectV3.circuits[0].legacyRoute, legacyPlan.circuits[0].route);
      await page.reload();
      await page.locator('.edit-resume').click();
      assert.deepEqual(await page.evaluate(() => WarmEditor.plan.circuits[0].route), draft.projectV3.circuits[0].legacyRoute);
      await page.locator('#editUndo').click();
      assert.deepEqual(await page.evaluate(() => WarmEditor.plan.circuits[0].route), legacyPlan.circuits[0].route);
      await page.locator('#editDone').click();
      assert.equal(await page.evaluate(() => WarmEditor.active), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${mobile ? 'mobile' : 'desktop'} grid / diameter / save-reload / migration / shape / rotation / undo / manual draft`);
      await page.close();
    }
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
