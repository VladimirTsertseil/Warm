const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(process.env.WARM_TEST_ROOT || path.join(__dirname, '..'));
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
    try {res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));} catch {res.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({headless: true, ...(process.env.WARM_BROWSER ? {executablePath: process.env.WARM_BROWSER} : {})});
    for (const mobile of [false, true]) {
      const page = await browser.newPage({viewport: mobile ? {width: 390, height: 844} : {width: 1280, height: 900}, isMobile: mobile, hasTouch: mobile});
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
      await page.locator('#createFirstBtn').click(); await page.waitForSelector('#shapeSheet.open');await page.locator('#roomLegacyV36 > summary').click();
      await page.locator('#shapeWidthInput').fill('4.80'); await page.locator('#shapeHeightInput').fill('3.60'); await page.locator('#doneShapeV24').click();
      await page.evaluate(async () => {await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); state.supply = {x: 600, y: 3600, side: 'bottom'}; state.returnPoint = {x: 650, y: 3600, side: 'bottom'}; state.circuitSettingsV32 = {radiusMm: 40, spacingCells: 2, wallOffsetMm: 100, method: 'auto'}; renderPlan(); await WarmV320.calculate();});
      assert.equal(await page.evaluate(() => WarmV330.plan?.ok), true, await page.locator('#status').innerText());
      const original = await page.evaluate(() => serializeState());
      await page.locator('#manualToolBtn').click(); assert.equal(await page.evaluate(() => WarmV340.active), true); assert.equal(await page.evaluate(() => WarmEditor.active), false);
      assert.equal(await page.locator('.grid-manual-v34').count(), 1); assert.equal(await page.evaluate(() => WarmV340.report.ok), true, await page.locator('#geReport').innerText());
      const tap = async (x, y) => {
        const at = await page.locator('#planSvg').evaluate((svg, p) => {const q = svg.createSVGPoint(); q.x = p.x; q.y = p.y; const screen = q.matrixTransform(svg.getScreenCTM()), box = svg.getBoundingClientRect(); return {x: screen.x - box.x, y: screen.y - box.y};}, {x, y});
        await page.locator('#planSvg').click({position: at});
      };
      await tap(2250, 1200); assert.equal(await page.evaluate(() => WarmV340.selection?.start), 1);
      const before = await page.evaluate(() => WarmV340.draft);
      assert.equal(await page.evaluate(() => {const p = planSvg.createSVGPoint(); p.x = 4800; p.y = 3600; return p.matrixTransform(planSvg.getScreenCTM()).y < document.getElementById('gridEditorPanelV34').getBoundingClientRect().top;}), true, 'the inspector must not cover the fitted room');
      await page.locator('#gePan').click(); await tap(2250, 1200); assert.deepEqual(await page.evaluate(() => WarmV340.draft), before); await page.locator('#gePan').click();
      await page.locator('#geMinus').click(); assert.equal(await page.evaluate(() => WarmV340.draft.circuits[0].paths.heating[1].y), 1050); assert.equal(await page.evaluate(() => WarmV340.report.ok), true);
      assert.equal(await page.evaluate(() => state.routeComplete), false);
      await page.locator('#geUndo').click(); assert.deepEqual(await page.evaluate(() => WarmV340.draft), before);
      await page.locator('#geRedo').click(); assert.equal(await page.evaluate(() => WarmV340.draft.circuits[0].paths.heating[1].y), 1050);
      // Select through the accessible list, then delete and persist an actual gap.
      await page.locator('#geMore').evaluate(n => n.open = true); await page.locator('#geEdge').selectOption('1'); await page.locator('#geDelete').click();
      assert.equal(await page.evaluate(() => WarmV340.report.ok), false); assert.equal(await page.locator('.ge-gap').count(), 1); await page.locator('#geDone').click(); assert.equal(await page.evaluate(() => WarmV340.active), true);
      assert.equal(await page.evaluate(() => WarmV340.saveDraft()), true); const gap = await page.evaluate(() => serializeState()); assert.equal(gap.routeComplete, false);
      const draftDownload = page.waitForEvent('download'); await page.evaluate(() => exportPng()); const draftPng = await draftDownload; assert.match(draftPng.suggestedFilename(), /-draft\.png$/);
      if (process.env.WARM_SCREENSHOTS) await draftPng.saveAs(path.join(process.env.WARM_SCREENSHOTS, `edit-draft-${mobile ? 'mobile' : 'desktop'}.png`));
      await page.reload(); await page.locator('#resumeGridDraftV34').click(); assert.equal(await page.evaluate(() => WarmV340.active), true); assert.equal(await page.locator('.ge-gap').count(), 1); assert.equal(await page.evaluate(() => state.routeComplete), false);
      await page.locator('#geRestore').click(); assert.equal(await page.evaluate(() => WarmV340.report.ok), true);
      await page.locator('#geMore').evaluate(n => n.open = true); await page.locator('#geReverse').click(); assert.deepEqual(await page.evaluate(() => WarmV340.draft.definitions[0].supply), {x: 650, y: 3600, side: 'bottom'});
      await page.locator('#geUndo').click(); assert.deepEqual(await page.evaluate(() => WarmV340.draft.definitions[0].supply), {x: 600, y: 3600, side: 'bottom'});
      await page.locator('#geEdge').selectOption('1'); await page.locator('#geDelete').click(); await page.locator('#geConnect').click(); assert.equal(await page.evaluate(() => WarmV340.report.ok), true);
      // Local path drawing, with explicit aligned corners and unchanged endpoints.
      await page.locator('#geDraw').click();
      const scratch = await page.evaluate(() => serializeState()); assert.equal(scratch.routeComplete, false); assert.ok(scratch.gridEditV34.scratch.drawing);
      for (const [x, y] of [[1500, 1050], [1500, 900], [3000, 900], [3000, 1050], [3900, 1050]]) await tap(x, y);
      await page.locator('#geApplyPath').click(); assert.equal(await page.evaluate(() => WarmV340.draft.circuits[0].paths.heating.length), before.circuits[0].paths.heating.length + 4);
      // This route may hit another pass; draft is retained and Undo repairs it.
      await page.locator('#geUndo').click(); assert.equal(await page.evaluate(() => WarmV340.report.ok), true);
      await page.locator('#geMore').evaluate(n => n.open = true); await page.locator('#geMethod').selectOption('double-snake'); await page.locator('#geReplan').click(); await page.waitForFunction(() => !WarmV340.busy);
      assert.equal(await page.evaluate(() => WarmV340.draft.circuits[0].method), 'double-snake', await page.locator('#status').innerText()); assert.equal(await page.evaluate(() => WarmV340.report.ok), true);
      if (process.env.WARM_SCREENSHOTS) {fs.mkdirSync(process.env.WARM_SCREENSHOTS, {recursive: true}); await page.locator('#geMore').evaluate(n => n.open = false); await page.screenshot({path: path.join(process.env.WARM_SCREENSHOTS, `edit-${mobile ? 'mobile' : 'desktop'}.png`)});}
      await page.locator('#geDone').click(); assert.equal(await page.evaluate(() => WarmV340.active), false); assert.equal(await page.evaluate(() => state.routeComplete), true);
      await page.locator('#settingsBtn').click(); const downloading = page.waitForEvent('download'); await page.locator('#shareBtn').click(); const download = await downloading;
      const png = fs.readFileSync(await download.path()); assert.equal(png.readUInt32BE(16), 1600); if (process.env.WARM_SCREENSHOTS) await download.saveAs(path.join(process.env.WARM_SCREENSHOTS, `edit-export-${mobile ? 'mobile' : 'desktop'}.png`));
      await page.locator('#saveBtn').click(); const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY))[0]); assert.equal(saved.versionLabel, '3.6.0'); assert.equal(saved.gridEditV34.committed, true);
      await page.reload(); await page.getByRole('button', {name: 'Открыть', exact: true}).click(); assert.equal(await page.evaluate(() => state.routeComplete), true, await page.locator('#status').innerText());
      await page.evaluate(raw => {raw.gridEditV34.draft.circuits[0].paths.heating[1].x += 1; loadScheme(raw);}, saved); assert.equal(await page.evaluate(() => state.routeComplete), false);
      await page.evaluate(raw => {raw.gridEditV34.draft.settings.radiusMm = 50; loadScheme(raw);}, saved); assert.equal(await page.evaluate(() => state.routeComplete), false);
      await page.evaluate(raw => loadScheme(raw), saved); await page.locator('#shapeToolBtn').click();await page.locator('#roomLegacyV36 > summary').click(); await page.locator('#shapeWidthInput').fill('4.65'); await page.locator('#doneShapeV24').click();
      assert.equal(await page.evaluate(() => state.routeComplete), false); assert.ok(await page.evaluate(() => WarmV340.report.issues.some(i => i.code === 'CONTEXT_CHANGED')));
      await page.locator('#manualToolBtn').click(); await page.locator('#geRecheck').click(); assert.equal(await page.evaluate(() => WarmV340.report.issues.some(i => i.code === 'CONTEXT_CHANGED')), false);
      // Worker completion cannot overwrite a new scheme.
      await page.evaluate(raw => loadScheme(raw), saved); await page.locator('#manualToolBtn').click(); await page.locator('#geMore').evaluate(n => n.open = true);
      await page.evaluate(() => {document.getElementById('geReplan').click(); newScheme();}); await page.waitForSelector('#shapeSheet.open');await page.locator('#roomLegacyV36 > summary').click(); await page.locator('#doneShapeV24').click(); assert.equal(await page.evaluate(() => WarmV340.draft), null); assert.equal(await page.evaluate(() => WarmV340.busy), false);
      await page.evaluate(raw => loadScheme(raw), original); assert.equal(await page.evaluate(() => WarmV340.draft), null); assert.equal(await page.evaluate(() => WarmV330.plan.ok), true);
      await page.evaluate(async () => {
        state.circuitDefinitionsV33 = [0, 1].map(i => ({id: `test-c${i}`, name: `Контур ${i + 1}`, portsFromMain: false, zone: {x: i * 2400, y: 0, width: 2400, height: 3600}, supply: {x: 600 + i * 2400, y: 3600}, returnPoint: {x: 650 + i * 2400, y: 3600}}));
        await WarmV330.calculate();
      });
      assert.equal(await page.evaluate(() => WarmV330.plan?.complete), true, await page.locator('#status').innerText());
      await page.locator('#manualToolBtn').click(); const first = await page.evaluate(() => WarmV340.draft.circuits[0]);
      await page.locator('#geCircuit').selectOption('test-c1'); await page.locator('#geMore').evaluate(n => n.open = true); await page.locator('#geReverse').click();
      assert.deepEqual(await page.evaluate(() => WarmV340.draft.circuits[0]), first); assert.equal(await page.evaluate(() => WarmV340.report.ok), true); assert.equal(await page.locator('.grid-manual-v34').count(), 2);
      await page.locator('#geDone').click(); const manualMulti = await page.evaluate(() => serializeState()); await page.evaluate(raw => loadScheme(raw), manualMulti);
      assert.equal(await page.evaluate(() => state.routeComplete), true); assert.equal(await page.evaluate(() => WarmV340.draft.circuits.length), 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
      console.log(`PASS ${mobile ? 'mobile' : 'desktop'} tap / grid shift / undo-redo / gaps / reload / swap / connect / draw / replan / finish / save / PNG / geometry change / cancellation / 3.3 compatibility`); await page.close();
    }
  } finally {if (browser) await browser.close(); server.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
