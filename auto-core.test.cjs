const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=process.env.WARM_ROOT?path.resolve(process.env.WARM_ROOT):path.resolve(__dirname,'..');
const out=process.env.WARM_ARTIFACTS?path.resolve(process.env.WARM_ARTIFACTS):path.resolve(root,'..','browser-checks');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.WARM_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport,isMobile:viewport.width<500,hasTouch:viewport.width<500}),errors=[],missing=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()===404&&!r.url().endsWith('/favicon.ico'))missing.push(r.url());});
   await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
   await page.locator('#createFirstBtn').click();await page.waitForSelector('#shapeSheet.open');await page.locator('#roomLegacyV36 > summary').click();await page.locator('#shapeWidthInput').fill('3.00');await page.locator('#shapeHeightInput').fill('2.50');await page.locator('#doneShapeV24').click();
   await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));fitPlan(false);renderPlan();});
   await page.locator('#collectorToolBtn').click();
   const tap=await page.evaluate(()=>{const p=planSvg.createSVGPoint();p.x=1000;p.y=0;const q=p.matrixTransform(planSvg.getScreenCTM());return{x:q.x,y:q.y};});
   await page.mouse.click(tap.x,tap.y);assert(await page.evaluate(()=>!!state.supply));
   assert.equal(await page.evaluate(()=>state.circuitSettingsV32.radiusMm),null);
   await page.locator('#generateBtn').click();await page.locator('[data-auto-grid="200"]').click();
   assert.equal(await page.evaluate(()=>WarmV350.busy||state.routeComplete),false);
   for(const step of [100,150,200]){
    await page.locator('[data-auto-grid="'+step+'"]').click();
    assert.equal(await page.evaluate(()=>WarmV350.plan),null);
    await page.locator('#generateBtn').click();
    await page.waitForFunction(()=>!WarmV350.busy&&!!WarmV350.plan,{},{timeout:60000});
    const info=await page.evaluate(()=>({valid:WarmAuto.validate(WarmV350.project(),WarmV350.plan),lengths:WarmV350.plan.multi.circuits.map(c=>c.lengthMm),complete:state.routeComplete,grid:state.mountingGridV3.cellSizeMm}));
    assert(info.valid.ok);assert(info.complete);assert.equal(info.lengths.length,1);assert(info.lengths.every(n=>n<=80000));assert.equal(info.grid,step);
   }
   await page.screenshot({path:path.join(out,'auto-'+viewport.width+'.png')});
   const saved=await page.evaluate(()=>serializeState());assert(saved.autoPlanV35);
   await page.reload();await page.evaluate(raw=>loadScheme(raw),saved);
   assert(await page.evaluate(()=>state.routeComplete&&WarmAuto.validate(WarmV350.project(),WarmV350.plan).ok));
   await page.locator('#autoInfoV35').click();await page.screenshot({path:path.join(out,'details-'+viewport.width+'.png')});
   assert(await page.locator('#autoResultsV35').innerText().then(t=>t.includes('Контур 1')));
   await page.locator('#closeAutoV35').click();
   const download=page.waitForEvent('download');await page.evaluate(()=>exportPng());const png=await download;await png.saveAs(path.join(out,'export-'+viewport.width+'.png'));
   await page.locator('#manualToolBtn').click();assert(await page.evaluate(()=>WarmV340.active));assert(await page.evaluate(()=>WarmV340.report.ok));
   await page.locator('#geMore').evaluate(n=>n.open=true);await page.locator('#geReverse').click();assert(await page.evaluate(()=>WarmV340.report.ok));
   await page.locator('#geDone').click();assert(await page.evaluate(()=>state.routeComplete&&!WarmV340.active));
   const manual=await page.evaluate(()=>serializeState());assert(manual.gridEditV34);await page.evaluate(raw=>loadScheme(raw),manual);assert(await page.evaluate(()=>WarmV340.report.ok&&state.routeComplete));
   await page.locator('#shapeToolBtn').click();await page.locator('#roomLegacyV36 > summary').click();await page.locator('#shapeWidthInput').fill('3.30');await page.locator('#doneShapeV24').click();assert.equal(await page.evaluate(()=>state.routeComplete),false);
   await page.locator('#generateBtn').click();await page.waitForFunction(()=>!WarmV350.busy&&!!WarmV350.plan,{},{timeout:60000});assert(await page.evaluate(()=>state.routeComplete&&!WarmV340.draft));
   await page.locator('#shapeToolBtn').click();await page.locator('#roomLegacyV36 > summary').click();await page.locator('#shapeWidthInput').fill('6.00');await page.locator('#shapeHeightInput').fill('5.00');
   await page.locator('#doneShapeV24').click();
   await page.evaluate(()=>{state.obstacles=[{id:'column',x:2700,y:2100,width:600,height:700}];state.supply={x:1000,y:0,side:'top'};state.returnPoint=null;state.mountingGridV3.cellSizeMm=150;recomputeGeometry();resetRoute();fitPlan(false);renderPlan();});
   await page.locator('#generateBtn').click();await page.waitForFunction(()=>!WarmV350.busy&&!!WarmV350.plan,{},{timeout:60000});
   const multiInfo=await page.evaluate(()=>({count:WarmV350.plan.multi.circuits.length,check:WarmAuto.validate(WarmV350.project(),WarmV350.plan),project:WarmV350.project(),search:WarmV350.plan.search}));
   assert(multiInfo.count===3&&multiInfo.check.ok,JSON.stringify(multiInfo));
   await page.screenshot({path:path.join(out,'multi-column-'+viewport.width+'.png')});
   const multiSaved=await page.evaluate(()=>serializeState());await page.evaluate(raw=>loadScheme(raw),multiSaved);assert(await page.evaluate(()=>state.routeComplete));
   await page.locator('#manualToolBtn').click();assert(await page.evaluate(()=>WarmV340.active&&WarmV340.report.ok));await page.locator('#geDone').click();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false,'horizontal overflow');
   assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);console.log('PASS viewport',viewport.width,'grid / auto / save / reopen / PNG / manual / changed room');await page.close();
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
