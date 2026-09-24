/* Regression: draw an off-grid column through the real editor and calculate it.
   WARM_TEST_ROOT may point to an older compatible UI with the patched adapter. */
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(process.env.WARM_TEST_ROOT||path.join(__dirname,'..')),E=require(path.join(root,'engine-unified.js'));
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.WARM_BROWSER?{executablePath:process.env.WARM_BROWSER}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.evaluate(()=>newScheme());await page.waitForSelector('#shapeSheet.open');await page.evaluate(()=>{closeSheetV5();state.supply={x:600,y:3000,side:'bottom'};state.returnPoint={x:650,y:3000,side:'bottom'};state.pipeStepMm=150;state.pipeDiameterMm=16;state.wallOffsetMm=100;state.maxCircuitLengthM=100;state.bendRadiusMode='auto';syncInputs();syncBendUiV10();renderPlan();});
  await page.locator('#obstacleToolBtn').click();
  const screen=async p=>page.evaluate(p=>{const m=planSvg.getScreenCTM();return{x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};},p);
  const a=await screen({x:1730,y:1170}),b=await screen({x:2180,y:1720});
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();
  const drawn=await page.evaluate(()=>({physical:state.obstacles.map(({x,y,width,height})=>({x,y,width,height})),input:WarmV260.input(),mask:state.excluded.size}));
  assert.deepEqual(drawn.physical,[{x:1730,y:1170,width:450,height:550}]);assert.ok(drawn.mask>0,'exercise the real raster mask');assert.deepEqual(drawn.input.obstacles,drawn.physical,'derived cells must not widen the physical column');
  console.log('PASS real column gesture / exact obstacle footprint');

  const masks=await page.evaluate(()=>{
   const saved={obstacles:structuredClone(state.obstacles),grid:state.gridStepMm,excluded:new Set(state.excluded)},results=[];
   // Centimetre snapping has several phases relative to the visual grid.
   for(const grid of [20,50,100])for(const dx of [0,10,20,30,40])for(const dy of [0,10,20,30,40]){
    state.gridStepMm=grid;state.obstacles=[{id:'column',x:1700+dx,y:1100+dy,width:450,height:550}];syncExcludedFromObstaclesV6();
    results.push({grid,dx,dy,expected:state.obstacles.map(({x,y,width,height})=>({x,y,width,height})),actual:WarmV260.input().obstacles});
   }
   const extras=[];
   for(const obstacles of [[{x:0,y:1130,width:430,height:560}],[{x:1130,y:1270,width:430,height:550},{x:2710,y:930,width:470,height:560}],[{x:1530,y:1170,width:450,height:550},{x:1730,y:1330,width:610,height:420}]]){
    state.gridStepMm=50;state.obstacles=obstacles;syncExcludedFromObstaclesV6();extras.push({actual:WarmV260.input().obstacles,expected:WarmEngine.decomposition(obstacles)});
   }
   state.obstacles=saved.obstacles;state.gridStepMm=saved.grid;syncExcludedFromObstaclesV6();state.excluded.add('2,2');state.roomRemoved.add('30,20');
   const independent=WarmV260.input();state.roomRemoved.clear();state.excluded=saved.excluded;
   return{results,extras,independent};
  });
  for(const c of masks.results)assert.deepEqual(c.actual,c.expected,JSON.stringify({grid:c.grid,dx:c.dx,dy:c.dy}));
  for(const c of masks.extras)assert.deepEqual(c.actual,c.expected);
  assert.ok(masks.independent.obstacles.some(r=>r.x===100&&r.y===100&&r.width===50&&r.height===50),'independent painted exclusions must survive');
  assert.ok(masks.independent.obstacles.some(r=>r.x===3000&&r.y===2000&&r.width===100&&r.height===100),'removed room cells must survive');
  console.log('PASS 75 grid phases / wall obstacle / two obstacles / overlapping obstacles / independent painted cells');

  for(const pattern of process.env.WARM_COLUMNS_SMOKE?['spiral']:['auto','snake','double-snake','spiral','adaptive']){
   await page.locator('#generateBtn').click();await page.locator(`[data-layout-choice-v221="${pattern}"]`).click();await page.locator('#calculateLayoutV221').click();await page.waitForFunction(()=>!state.engineBusyV1,null,{timeout:305000});
   const result=await page.evaluate(()=>({ok:state.routeComplete,input:WarmV260.input(),plan:state.enginePlanV1,status:document.getElementById('status').textContent,candidates:state.routeCandidates.length}));
   assert.equal(result.ok,true,JSON.stringify({pattern,status:result.status}));assert.equal(result.candidates,1);if(pattern!=='auto')assert.equal(result.plan.kind,pattern);
   const exact={...result.input,obstacles:drawn.physical};assert.equal(E.validate(exact,result.plan).ok,true);assert.ok(result.plan.quality.coverage>=.8,'reasonable coverage around the column');
   for(const c of result.plan.circuits){assert.deepEqual(c.route[0],c.supply);assert.deepEqual(c.route.at(-1),c.returnPoint);assert.ok(E.length(c.route)<=exact.maxCircuitLengthMm);const curve=E.rounded(c.route,c.bendRadiusMm);assert.ok(curve);for(const part of curve.primitives)for(const q of part.points){assert.ok(q.x>=0&&q.y>=0&&q.x<=4000&&q.y<=3000);assert.ok(!drawn.physical.some(o=>q.x>o.x&&q.x<o.x+o.width&&q.y>o.y&&q.y<o.y+o.height),'rounded pipe enters column');}}
   console.log('PASS off-grid column',pattern,`coverage ${(result.plan.quality.coverage*100).toFixed(1)}%`,`${(result.plan.totalLength/1000).toFixed(1)} m`);
   if(process.env.WARM_SCREENSHOTS&&pattern==='spiral'){fs.mkdirSync(process.env.WARM_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WARM_SCREENSHOTS,'column-fixed.png')});}
  }
  const restored=await page.evaluate(()=>{const raw=serializeState();loadScheme(raw);return{obstacles:WarmV260.input().obstacles,ok:state.routeComplete&&WarmEngine.validate(WarmV260.input(),state.enginePlanV1).ok};});assert.deepEqual(restored.obstacles,drawn.physical);assert.equal(restored.ok,true);
  assert.deepEqual(errors,[]);console.log('PASS save / reload / common validation / console');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
