/* Optional integration checks: npm install --no-save playwright */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const fixtures=require('./fixtures.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.statusCode=403;res.end();return;}try{res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(p));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.WARM_BROWSER?{executablePath:process.env.WARM_BROWSER}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const scenarios=[[0,'auto'],[1,'spiral'],[1,'snake'],[1,'double-snake'],[1,'adaptive'],[6,'spiral'],[9,'spiral'],[8,'auto'],[10,'auto']];
  for(const [index,pattern] of process.env.WARM_SMOKE?scenarios.slice(0,1):scenarios){
   await page.evaluate(({input,name})=>{
    newScheme();
    Object.assign(state,{sections:input.sections,obstacles:input.obstacles,supply:input.supply,returnPoint:input.returnPoint,excluded:new Set(),roomAdded:new Set(),roomRemoved:new Set(),shapeType:'custom',shapeParams:{},shapeAxes:null,pipeStepMm:input.pipeStepMm,wallOffsetMm:input.wallOffsetMm,pipeDiameterMm:input.pipeDiameterMm,maxCircuitLengthM:input.maxCircuitLengthMm/1000,bendRadiusMode:'auto',name});
    recomputeGeometry();syncInputs();syncBendUiV10();showView('editor');fitPlan(false);renderPlan();
   },fixtures[index]);
   await page.waitForSelector('#shapeSheet.open');
   await page.evaluate(()=>closeSheetV5());
   await page.locator('#generateBtn').click();
   await page.locator(`[data-layout-choice-v221="${pattern}"]`).click();
   await page.locator('#calculateLayoutV221').click();
   await page.waitForFunction(()=>!state.engineBusyV1,null,{timeout:305000});
   const result=await page.evaluate(()=>({ok:state.routeComplete,kind:state.enginePlanV1?.kind,planner:state.enginePlanV1?.planner,candidates:state.routeCandidates.length,status:document.getElementById('status').textContent,arcs:document.querySelector('.engineering-route-v21 .pipe-supply')?.getAttribute('d'),cold:document.querySelector('.engineering-route-v21 .pipe-return')?.getAttribute('d'),version:serializeState().versionLabel}));
   assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.planner,'unified-bcd');assert.equal(result.candidates,1);assert.equal(result.version,'2.6.1');if(pattern!=='auto')assert.equal(result.kind,pattern);assert.match(result.arcs,/ A 80 80 /);assert.doesNotMatch(result.status,/BCD|score|fallback|V2\.3/);
   assert.notEqual(result.arcs,result.cold,'supply and return are different halves of the same curve');
   console.log('PASS',fixtures[index].name,pattern,result.status);
   if(process.env.WARM_SCREENSHOTS){fs.mkdirSync(process.env.WARM_SCREENSHOTS,{recursive:true});await page.locator('#planSvg').screenshot({path:path.join(process.env.WARM_SCREENSHOTS,`${fixtures[index].name}-${pattern}.png`)});}
  }
  const restored=await page.evaluate(()=>{const saved=serializeState(),count=saved.unifiedPlan.circuits.length;loadScheme(saved);const loaded=state.enginePlanV1?.circuits.length===count&&state.routeComplete;v222ReverseCurrentFlow();return{loaded,reversed:state.v260Engineering?.proven};});
  assert.deepEqual(restored,{loaded:true,reversed:true});console.log('PASS save / restore / reverse flow');
  // The adapter includes painted geometry, and a calculation that finishes after
  // an edit cannot publish a stale route.
  const stale=await page.evaluate(async()=>{
   state.roomAdded=new Set(['90,90']);state.roomRemoved=new Set(['1,1']);state.excluded=new Set(['2,2']);
   const painted=WarmV260.input();state.roomAdded.clear();state.roomRemoved.clear();state.excluded.clear();
   const original=runEngineWorkerV1;let release;runEngineWorkerV1=()=>new Promise(r=>release=r);
   const pending=v221GenerateWithChoice();state.pipeStepMm+=50;release({ok:false});await pending;runEngineWorkerV1=original;
   return{hasPaint:painted.sections.some(r=>r.x===9000)&&painted.obstacles.length>0,route:state.enginePlanV1,status:document.getElementById('status').textContent};
  });
  assert.equal(stale.hasPaint,true);assert.equal(stale.route,null);assert.match(stale.status,/Параметры изменились/);
  const overlapping=await page.evaluate(async()=>{
   const original=runEngineWorkerV1,releases=[];runEngineWorkerV1=()=>new Promise(r=>releases.push(r));
   const first=v221GenerateWithChoice();resetRoute();const second=v221GenerateWithChoice();
   releases[0]({ok:false});await first;const stillBusy=state.engineBusyV1;
   releases[1]({ok:false});await second;runEngineWorkerV1=original;
   return{stillBusy,finished:!state.engineBusyV1,route:state.enginePlanV1};
  });
  assert.deepEqual(overlapping,{stillBusy:true,finished:true,route:null});
  assert.deepEqual(errors,[]);console.log('PASS painted geometry / stale result / console');
 }finally{if(browser)await browser.close();server.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
