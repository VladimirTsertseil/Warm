const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../grid-core'),A=require('../auto-core'),S=require('../spiral-core'),M=require('../multi-core'),E=require('../grid-editor-core');
const rect=(x,y,width,height)=>({x,y,width,height}),pointEqual=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-5;
const make=(step=150,sections=[rect(0,0,3000,2500)],areas=[],anchor={x:1000,y:0},diameter=16)=>G.createProject({room:{sections},exclusions:{areas},grid:{cellSizeMm:step},collector:{supply:anchor},pipe:{diameterMm:diameter}});
const cache=new Map();function solve(p){const key=JSON.stringify(p);if(!cache.has(key))cache.set(key,A.plan(p));return cache.get(key);}
function verify(p,r){
 assert(r.ok,JSON.stringify(r));assert(A.validate(p,r).ok);assert(r.multi.complete);assert(!r.multi.overLength);assert.equal(M.crossIntersections(r.multi.circuits,p.grid.cellSizeMm),false);
 for(const c of r.multi.circuits){
  assert(c.lengthMm<=80000);assert(pointEqual(c.segments[0].from,c.supply));assert(pointEqual(c.segments.at(-1).to,c.returnPoint));assert(c.supplyTransit.lengthMm>0&&c.returnTransit.lengthMm>0);
  let length=0;
  c.segments.forEach((s,i)=>{
   if(i)assert(pointEqual(c.segments[i-1].to,s.from));
   length+=s.type==='curve'?Math.abs(s.sweepAngle)*s.radiusMm:Math.hypot(s.to.x-s.from.x,s.to.y-s.from.y);
   for(let j=0;j<=16;j++){const t=j/16,q=s.type==='curve'?S.arcAt(s,t):{x:s.from.x+(s.to.x-s.from.x)*t,y:s.from.y+(s.to.y-s.from.y)*t};assert.equal(G.classifyPoint(p,q),'available');}
   if(s.type==='straight'&&s.part==='heating'){assert(s.guide);assert(s.guide.edgeIds.length);}
  });
  assert(Math.abs(length-c.lengthMm)<1e-5);assert(Math.abs(c.lengthMm-c.supplyTransit.lengthMm-c.heating.lengthMm-c.returnTransit.lengthMm)<1e-5);
 }
 assert(r.coverage.ok);assert.equal(r.coverage.missed,0);assert.equal(r.search.globallyOptimal,false);
}
for(const step of [100,150,200]){
 test('new project, no count/zones/radius: one circuit on '+step,()=>{const p=make(step),before=JSON.stringify(p),r=solve(p);verify(p,r);assert.equal(r.multi.circuits.length,1);assert.equal(JSON.stringify(p),before);});
 test('large room automatically divided on '+step,()=>{const p=make(step,[rect(0,0,6000,5000)]),r=solve(p);verify(p,r);assert(r.multi.circuits.length>1);assert(r.multi.circuits.length<={100:4,150:3,200:2}[step]);assert.deepEqual(r.search.countsTried,Array.from({length:r.multi.circuits.length},(_,i)=>i+1));});
 test('L shape automatically covered on '+step,()=>{const p=make(step,[rect(0,0,6000,3000),rect(0,3000,3000,2000)]);verify(p,solve(p));});
 test('central off-grid obstacle including transit and arcs on '+step,()=>{const p=make(step,[rect(0,0,6000,5000)],[rect(2700,2100,600,700)]);verify(p,solve(p));});
}
for(const [side,anchor] of [['top',{x:1500,y:0}],['bottom',{x:1500,y:2500}],['left',{x:0,y:1000}],['right',{x:3000,y:1000}]])test('automatic collector bank on '+side,()=>{const p=make(150,undefined,[],anchor);verify(p,solve(p));});
test('16 / 17 / 20 mm do not invent material radius rules',()=>{const routes=[];for(const diameter of [16,17,20]){const p=make(150,undefined,[],undefined,diameter),r=solve(p);verify(p,r);assert(r.multi.circuits.every(c=>c.diameterMm===diameter));routes.push(r.multi.circuits.map(c=>c.route));}assert.deepEqual(routes[0],routes[1]);assert.deepEqual(routes[1],routes[2]);});
test('saved result is revalidated, geometry and metadata tampering rejected',()=>{const p=make(),r=solve(p);verify(p,JSON.parse(JSON.stringify(r)));for(const alter of [x=>x.multi.circuits[0].lengthMm=1,x=>x.multi.results[0].plan.circuits[0].segments[0].to.x+=10,x=>x.coverage.missed=10,x=>x.collectorProposal.ports[0].supply.x+=50]){const bad=structuredClone(r);alter(bad);assert.equal(A.validate(p,bad).ok,false);}const moved=structuredClone(p);moved.collector.supply.x+=100;assert.equal(A.validate(moved,r).ok,false);const grid=structuredClone(p);grid.grid.cellSizeMm=100;assert.equal(A.validate(grid,r).ok,false);});
test('automatic result enters manual editor, gaps cannot be committed, restore and reverse stay valid',()=>{
 const p=make(),r=solve(p),d=E.create(p,r.settings,r.multi.definitions,r.multi);assert(E.inspect(p,d).ok);
 const selected={id:d.circuits[0].id,part:'heating',start:1,end:2};const cut=E.toggle(d,selected,false);assert(cut.ok);assert.equal(E.inspect(p,cut.draft).ok,false);
 const loaded=JSON.parse(JSON.stringify(cut.draft));const restored=E.toggle(loaded,selected,true);assert(E.inspect(p,restored.draft).ok);
 const reverse=E.reverse(restored.draft,d.circuits[0].id);assert(E.inspect(p,reverse.draft).ok);
 const moved=E.shift(d,selected,20,p.grid);assert(moved.ok);assert.equal(E.inspect(p,moved.draft).ok,false);
});
test('double snake fallback is real geometry, not a renamed spiral',()=>{const original=S.geometry.makeCycle;try{S.geometry.makeCycle=(ctx,cells,cw,method,vertical)=>method==='spiral'?null:original(ctx,cells,cw,method,vertical);const p=make(),r=A.plan(p);verify(p,r);assert(r.multi.circuits.every(c=>c.method==='double-snake'));}finally{S.geometry.makeCycle=original;}});
test('missing/blocked collector, empty room and search timeout never return a partial ready plan',()=>{
 const missing=make();missing.collector.supply=null;const blocked=make();blocked.exclusions.areas=[rect(950,0,200,300)];
 for(const p of [missing,blocked,G.createProject()]){const r=A.plan(p);assert.equal(r.ok,false);assert.deepEqual(r.circuits,[]);assert(!r.multi);}
 const exhausted=A.plan(make(),{timeBudgetMs:-1});assert.equal(exhausted.reason,'SEARCH_LIMIT');assert.equal(exhausted.ok,false);assert(!exhausted.multi);
});
