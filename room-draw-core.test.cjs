const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');const root=path.resolve(process.env.WARM_ROOT||path.join(__dirname,'..')),out=path.resolve(process.env.WARM_ARTIFACTS||path.join(root,'..','room-browser'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+req.url.split('?')[0]);if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.WARM_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 for(const mobile of [false,true]){
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('#createFirstBtn').click();await page.waitForSelector('#shapeSheet.open');
  await page.locator('#roomStartV36').click();await page.waitForSelector('#roomDrawV36:not([hidden])');
  const at=async(x,y)=>page.evaluate(({x,y})=>{const c=WarmV360.camera,r=document.getElementById('roomCanvasV36').getBoundingClientRect();return{x:r.left+(x-c.x)*c.scale,y:r.top+(y-c.y)*c.scale};},{x,y});
  const tap=async(x,y)=>{const q=await at(x,y);if(mobile)await page.touchscreen.tap(q.x,q.y);else await page.mouse.click(q.x,q.y);};
  await tap(0,0);
  // Exact length is independent from the 10 cm grid.
  await page.locator('#roomLengthV36').fill('3,75');await page.locator('#roomLengthApplyV36').click();assert.equal(await page.evaluate(()=>WarmV360.points.at(-1).x),3750);
  if(mobile){const cdp=await page.context().newCDPSession(page),a=await at(3750,500),b=await at(3750,2500);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[b]});assert(await page.locator('#roomPreviewV36 line').getAttribute('stroke-dasharray'));await page.screenshot({path:path.join(out,'preview-mobile.png')});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{const q=await at(3750,2500);await page.mouse.move(q.x,q.y);assert(await page.locator('#roomPreviewV36 line').getAttribute('stroke-dasharray'));await page.screenshot({path:path.join(out,'preview-desktop.png')});await page.mouse.click(q.x,q.y);}
  await tap(0,2500);await tap(0,0);assert(await page.evaluate(()=>WarmV360.closed));await page.screenshot({path:path.join(out,'closed-'+(mobile?'mobile':'desktop')+'.png')});await page.locator('#roomFinishV36').click();
  assert.equal(await page.evaluate(()=>state.sections.reduce((a,s)=>a+s.width*s.height,0)),9375000);
  let saved=await page.evaluate(()=>serializeState());assert(saved.shapeParams.v36);await page.reload();await page.evaluate(r=>loadScheme(r),saved);assert.deepEqual(await page.evaluate(()=>state.shapeParams.points),saved.shapeParams.points);
  await page.locator('#rotateBtn').click();assert.equal(await page.evaluate(()=>state.shapeParams.points[1].y-state.shapeParams.points[0].y),3750);await page.evaluate(r=>loadScheme(r),saved);
  // Cancellation must preserve geometry and obstacles exactly.
  await page.locator('#shapeToolBtn').click();await page.locator('#roomStartV36').click();await tap(500,500);await page.locator('#roomCancelV36').click();assert.deepEqual(await page.evaluate(()=>state.sections),saved.sections);
  // Edit, undo closure, undo a corner, and cancel.
  await page.locator('#shapeToolBtn').click();await page.locator('#roomEditV36').click();await page.locator('#roomUndoV36').click();assert.equal(await page.evaluate(()=>WarmV360.closed),false);await page.locator('#roomUndoV36').click();assert.equal(await page.evaluate(()=>WarmV360.points.length),3);await page.locator('#roomCancelV36').click();
  // Existing obstacle tool still draws with its original gesture.
  await page.locator('#obstacleToolBtn').click();
  const planAt=async(x,y)=>page.evaluate(({x,y})=>{const p=planSvg.createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform(planSvg.getScreenCTM());return{x:q.x,y:q.y};},{x,y});
  const oa=await planAt(1500,1000),ob=await planAt(2000,1500);await page.mouse.move(oa.x,oa.y);await page.mouse.down();await page.mouse.move(ob.x,ob.y,{steps:4});await page.mouse.up();assert.equal(await page.evaluate(()=>state.obstacles.length),1);const obstacles=await page.evaluate(()=>structuredClone(state.obstacles));
  await page.locator('#shapeToolBtn').click();await page.locator('#roomStartV36').click();
  for(const [x,y] of [[0,0],[4000,0],[4000,2000],[2500,2000]])await tap(x,y);
  // This wall would cross the first wall; rejection must keep the draft.
  await tap(2500,0);assert.equal(await page.evaluate(()=>WarmV360.points.length),4);assert(await page.locator('#roomMessageV36').getAttribute('class').then(c=>c.includes('error')));
  await tap(2500,3000);await tap(0,3000);await page.locator('#roomCloseV36').click();assert(await page.evaluate(()=>WarmV360.closed),JSON.stringify(await page.evaluate(()=>({points:WarmV360.points,message:document.getElementById('roomMessageV36').textContent}))));await page.locator('#roomFinishV36').click();assert.deepEqual(await page.evaluate(()=>state.obstacles),obstacles);assert.equal(await page.evaluate(()=>state.sections.reduce((a,s)=>a+s.width*s.height,0)),10500000);
  // Restore the drawn rectangle and calculate through the normal app workflow.
  await page.evaluate(r=>loadScheme(r),saved);await page.locator('#collectorToolBtn').click();const collector=await planAt(1000,0);await page.mouse.click(collector.x,collector.y);await page.locator('#generateBtn').click();await page.waitForFunction(()=>!WarmV350.busy&&!!WarmV350.plan,{},{timeout:65000});assert(await page.evaluate(()=>WarmAuto.validate(WarmV350.project(),WarmV350.plan).ok));
  saved=await page.evaluate(()=>serializeState());await page.reload();await page.evaluate(r=>loadScheme(r),saved);assert(await page.evaluate(()=>state.routeComplete&&!!state.shapeParams.v36));
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,'result-'+(mobile?'mobile':'desktop')+'.png')});console.log('PASS',mobile?'mobile':'desktop','drawing / preview / exact length / closure / validation / undo / cancel / save / rotation / obstacles / auto');await page.close();
 }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
