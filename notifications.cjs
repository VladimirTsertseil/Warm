/* Browser regression for mobile feedback; npm install --no-save playwright. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.WARM_BROWSER ? { executablePath: process.env.WARM_BROWSER } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.evaluate(() => newScheme());
    await page.waitForSelector('#shapeSheet.open');
    await page.evaluate(() => closeSheetV5());

    const boxes = () => page.evaluate(() => {
      const box = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      return { canvas: box('.workspace'), row: box('#editorFeedback'), dock: box('.editor-dock'), button: box('#feedbackDismiss'), scroll: document.documentElement.scrollWidth, width: innerWidth };
    });
    for (const size of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(size);
      await page.evaluate(() => { setStatus(''); fitPlan(false); });
      const before = await boxes();
      await page.evaluate(() => setStatus('Участок сохранён. ' + 'Дополнительное описание для длинного сообщения. '.repeat(15), true));
      const after = await boxes();
      assert.deepEqual(after.canvas, before.canvas, 'feedback must never shift the canvas');
      assert.ok(after.row.bottom <= after.canvas.y + .5, 'feedback is outside the drawing area');
      assert.ok(after.canvas.bottom <= after.dock.y + .5, 'canvas stays above navigation');
      assert.equal(after.row.height, 44);
      assert.ok(after.button.width >= 44 && after.button.height >= 44);
      assert.ok(after.row.right <= after.width && after.scroll <= after.width, 'no horizontal overflow');
      assert.equal(await page.locator('#modeHint').isVisible(), false);
      await page.evaluate(() => openSheetV5('settingsSheet'));
      await page.waitForTimeout(220);
      const panel = await page.locator('#settingsSheet').boundingBox();
      assert.ok(panel.y >= after.row.bottom, 'settings must not cover the feedback row');
      await page.locator('#feedbackDismiss').click();
      assert.equal(await page.locator('#status').isVisible(), false);
      await page.evaluate(() => closeSheetV5());
      console.log('PASS fixed notification row', size.width, size.height);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => setStatus('Сохранено'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => setStatus('Сохранено'));
    await page.waitForTimeout(1050);
    assert.equal(await page.locator('#status').isVisible(), false, 'duplicate must not restart the two-second timer');
    await page.evaluate(() => setStatus('Сохранено'));
    assert.equal(await page.locator('#status').isVisible(), false, 'duplicate must not resurrect the expired message');
    console.log('PASS expiration / duplicate suppression');

    await page.evaluate(() => setStatus('Первое сообщение'));
    await page.waitForTimeout(1100);
    await page.evaluate(() => setStatus('Невозможно переместить трубу: препятствие.', true));
    await page.waitForTimeout(1150);
    assert.equal(await page.locator('#status').isVisible(), true, 'old timer must not hide a newer error');
    await page.waitForTimeout(3100);
    assert.equal(await page.locator('#status').isVisible(), false, 'error expires after four seconds');
    await page.locator('#feedbackDetails').click();
    assert.equal(await page.locator('#feedbackDialog').isVisible(), true);
    assert.equal(await page.locator('#feedbackDialogText').textContent(), 'Невозможно переместить трубу: препятствие.');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#feedbackDialog').isVisible(), false);
    assert.equal(await page.locator('#feedbackDetails').evaluate(el => document.activeElement === el), true);
    console.log('PASS error duration / accessible message details');

    await page.evaluate(() => { setStatus('Новая ошибка', true); modeHint.textContent = 'Подсказка инструмента'; modeHint.classList.add('visible'); });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#status').textContent(), 'Новая ошибка', 'hint must not replace an error');
    await page.locator('#feedbackDismiss').click();
    await page.evaluate(() => { setModeV6('collector6'); });
    await page.waitForTimeout(100);
    assert.match(await page.locator('#status').textContent(), /Коснитесь стены/);
    await page.waitForTimeout(2150);
    assert.equal(await page.locator('#status').isVisible(), false, 'tool hint is temporary');
    console.log('PASS one channel for hints and messages');

    await page.evaluate(() => {
      setModeV6('inspect');
      window.noticeGestureSeen = false;
      diagramScroll.addEventListener('pointerdown', () => { window.noticeGestureSeen = true; }, { once: true });
      setStatus('Подсказка перед жестом');
    });
    await page.locator('#diagramScroll').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 50, clientX: 25, clientY: 140, bubbles: true });
    assert.equal(await page.locator('#status').isVisible(), false);
    assert.equal(await page.evaluate(() => window.noticeGestureSeen), true, 'dismissing must not consume the canvas gesture');
    console.log('PASS drawing gesture immediately dismisses feedback');

    await page.evaluate(() => { state.engineBusyV1 = true; setStatus('Рассчитываю схему…', false, { kind: 'progress' }); });
    await page.waitForTimeout(2300);
    assert.equal(await page.locator('#status').isVisible(), true, 'active calculation stays visible');
    await page.evaluate(() => resetRoute());
    assert.equal(await page.locator('#status').isVisible(), false, 'cancelled calculation clears feedback');
    await page.evaluate(() => { state.engineBusyV1 = true; setStatus('Рассчитываю схему…', false, { kind: 'progress' }); });
    assert.equal(await page.locator('#status').isVisible(), true, 'a restarted calculation may reuse its progress message');
    await page.evaluate(() => { state.engineBusyV1 = false; renderPlan(); });
    assert.equal(await page.locator('#status').isVisible(), false, 'finished or loaded state cannot retain progress');
    console.log('PASS progress / cancellation');

    await page.evaluate(async () => {
      state.supply = { x: 600, y: 3000, side: 'bottom' };
      state.returnPoint = { x: 650, y: 3000, side: 'bottom' };
      state.layoutUserChoiceV221 = 'auto';
      syncInputs();
      await v221GenerateWithChoice();
    });
    assert.equal(await page.evaluate(() => state.routeComplete), true, 'real calculation still completes');
    await page.locator('#manualToolBtn').click();
    await page.waitForSelector('body.manual-v2-active');
    await page.evaluate(() => {
      closeSheetV5(); setStatus('Участок выбран');
      document.querySelector('#editorView .workspace').addEventListener('pointerdown', () => {
        window.manualNoticeCleared = !document.getElementById('status').classList.contains('visible');
      }, { capture: true, once: true });
    });
    assert.equal(await page.locator('#feedbackMode').textContent(), 'Правка трубы');
    await page.locator('#diagramScroll').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 55, clientX: 25, clientY: 140, bubbles: true });
    assert.equal(await page.evaluate(() => window.manualNoticeCleared), true, 'old feedback is dismissed before the manual handler runs');
    assert.notEqual(await page.locator('#status').textContent(), 'Участок выбран', 'a new action may display its own relevant feedback');
    await page.evaluate(() => { manualExitV2A(); setModeV6('inspect'); });
    console.log('PASS manual editing / real worker calculation');

    if (process.env.WARM_SCREENSHOTS) {
      fs.mkdirSync(process.env.WARM_SCREENSHOTS, { recursive: true });
      await page.evaluate(() => { fitPlan(false); setStatus('Схема сохранена'); });
      await page.screenshot({ path: path.join(process.env.WARM_SCREENSHOTS, 'notifications-mobile.png') });
      await page.evaluate(() => setStatus('Этот участок пересекает препятствие. Выберите другое положение трубы.', true));
      await page.screenshot({ path: path.join(process.env.WARM_SCREENSHOTS, 'notifications-mobile-error.png') });
    }
    assert.deepEqual(errors, []);
    console.log('PASS notification browser checks / console');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
