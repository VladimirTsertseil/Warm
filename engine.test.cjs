const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine-unified.js');
const fixtures=require('./fixtures.cjs');
const results=[];
const cache=new Map();
const inside=(p,r)=>p.x>=r.x-1e-6&&p.y>=r.y-1e-6&&p.x<=r.x+r.width+1e-6&&p.y<=r.y+r.height+1e-6;
function pointSegment(p,a,b){const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
function verify(input,p){
 assert.equal(p.ok,true,JSON.stringify(p.diagnostics));
 assert.equal(p.hard.ok,true);
 assert.equal(E.validate(input,p).ok,true);
 assert.ok(p.circuits.length);
 const all=[];
 for(const c of p.circuits){
  assert.deepEqual(c.route[0],c.supply);assert.deepEqual(c.route.at(-1),c.returnPoint);
  let length=0;
  for(let i=1;i<c.route.length;i++){
   const a=c.route[i-1],b=c.route[i],d=Math.hypot(a.x-b.x,a.y-b.y);length+=d;
   assert.ok(d>0&&Number.isFinite(d));
   for(let j=0;j<=Math.ceil(d/15);j++){const t=j/Math.ceil(d/15),v={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};assert.ok(input.sections.some(r=>inside(v,r)),'segment leaves room');assert.ok(!input.obstacles.some(r=>v.x>r.x-7.99&&v.x<r.x+r.width+7.99&&v.y>r.y-7.99&&v.y<r.y+r.height+7.99),'pipe hits obstacle');}
   all.push([a,b]);
  }
  assert.ok(length<=input.maxCircuitLengthMm+1e-5,'length includes both connectors');
  assert.ok(Math.abs(c.length-length)<1e-5,'do not trust stale length metadata');
  const curve=E.rounded(c.route,c.bendRadiusMm);assert.ok(curve);assert.ok(curve.length<=length+1e-5);
  for(const part of curve.primitives)for(const q of part.points){assert.ok(input.sections.some(r=>inside(q,r)),'rounded pipe leaves room');assert.ok(!input.obstacles.some(r=>q.x>r.x&&q.x<r.x+r.width&&q.y>r.y&&q.y<r.y+r.height),'rounded pipe hits obstacle');}
 }
 // Independent, fixed-grid coverage oracle over the original input union. The
 // planner's reported percentage is not the acceptance oracle.
 const l=Math.min(...input.sections.map(r=>r.x)),r=Math.max(...input.sections.map(r=>r.x+r.width)),t=Math.min(...input.sections.map(r=>r.y)),b=Math.max(...input.sections.map(r=>r.y+r.height)),off=input.wallOffsetMm;
 let total=0,covered=0,sum=0;
 for(let y=t+37.5;y<b;y+=75)for(let x=l+37.5;x<r;x+=75){
  if(![-off,0,off].every(dx=>[-off,0,off].every(dy=>input.sections.some(r=>inside({x:x+dx,y:y+dy},r)))))continue;
  if(input.obstacles.some(r=>x>=r.x-off&&x<=r.x+r.width+off&&y>=r.y-off&&y<=r.y+r.height+off))continue;
  const d=Math.min(...all.map(([a,b])=>pointSegment({x,y},a,b)));total++;sum+=d;if(d<=input.pipeStepMm*.8)covered++;
 }
 const coverage=covered/total;assert.ok(coverage>=.8,`coverage ${(coverage*100).toFixed(1)}%`);assert.ok(sum/total<input.pipeStepMm*.65,'mean distance to pipe');
 assert.ok(p.quality.medianSpacing>=input.pipeStepMm*.75&&p.quality.medianSpacing<=input.pipeStepMm*1.65,'typical spacing');
 return coverage;
}
const patterns=['auto','snake','double-snake','spiral','adaptive'];
for(const f of fixtures)for(const pattern of patterns)test(`${f.name} / ${pattern}`,()=>{
 const input={...f.input,pattern},p=E.plan(input);const coverage=verify(input,p);cache.set(`${f.name}/${pattern}`,p);
 if(pattern!=='auto')assert.equal(p.kind,pattern,'explicit request must not silently change family');
 results.push({name:f.name,pattern,circuits:p.circuits.length,lengths:p.circuits.map(c=>+(c.length/1000).toFixed(2)),coverage:+coverage.toFixed(4),milliseconds:p.elapsedMs});
});
function rotate(input){const p=q=>({...q,x:-q.y,y:q.x,side:{top:'right',right:'bottom',bottom:'left',left:'top'}[q.side]});const rect=r=>({x:-r.y-r.height,y:r.x,width:r.height,height:r.width});return {...input,sections:input.sections.map(rect),obstacles:input.obstacles.map(rect),supply:p(input.supply),returnPoint:p(input.returnPoint)};}
// Rotation and translation exercise geometry, rather than names of presets.
for(const index of [0,1,2,3,6,8,9])test(`${fixtures[index].name} / rotated spiral`,()=>{const f=fixtures[index];verify({...rotate(f.input),pattern:'spiral'},E.plan({...rotate(f.input),pattern:'spiral'}));});
for(const step of [100,200])test(`rectangle / pitch ${step}`,()=>{const input={...fixtures[0].input,pattern:'auto',pipeStepMm:step};verify(input,E.plan(input));});
test('shorter length limit partitions before routing',()=>{const input={...fixtures[0].input,pattern:'spiral',maxCircuitLengthMm:50000};const p=E.plan(input);verify(input,p);assert.ok(p.circuits.length>=2);});
test('hard validation catches corrupted geometry and metadata',()=>{
 const input=fixtures[0].input,p=cache.get('rectangle/spiral')||E.plan({...input,pattern:'spiral'}),copy=()=>structuredClone(p);
 let q=copy();q.circuits[0].route[3].x=-100;assert.equal(E.validate(input,q).checks.H1_freeSpace,false);
 q=copy();q.circuits[0].length=0;assert.equal(E.validate({...input,maxCircuitLengthMm:1000},q).checks.H6_circuitLimit,false);
 q=copy();q.circuits.push(structuredClone(q.circuits[0]));assert.equal(E.validate(input,q).checks.H3_crossings,false);
 q=copy();q.circuits[0].supply.x+=10;assert.equal(E.validate(input,q).checks.H5_continuity,false);
 assert.equal(E.validate({...input,minBendRadiusMm:500},p).checks.H4_bendRadius,false);
 q=copy();q.circuits[0].bendRadiusMm=1;assert.equal(E.validate(input,q).checks.H4_bendRadius,false,'rendered and validated radius must agree');
 const diagonal={circuits:[{route:[input.supply,{x:1000,y:2600},input.returnPoint],supply:input.supply,returnPoint:input.returnPoint}]};
 assert.equal(E.validate({...input,obstacles:[{x:795,y:2795,width:10,height:10}]},diagonal).checks.H2_obstacles,false,'obstacles on diagonal cabinet connectors');
 const joint={a:{x:0,y:1500},b:{x:4000,y:1500}};
 assert.equal(E.validate({...input,deformationJoints:[joint]},p).checks.H7_movementJoints,false);
 assert.equal(E.validate({...input,deformationJoints:[{...joint,allowCrossing:true,sleeve:true}]},p).checks.H7_movementJoints,true);
 const arc=E.rounded(p.circuits[0].route,80).primitives.find(p=>p.type==='arc'),angle=arc.start+arc.delta/2;
 const at=r=>({x:arc.center.x+r*Math.cos(angle),y:arc.center.y+r*Math.sin(angle)});
 assert.equal(E.validate({...input,deformationJoints:[{a:at(78),b:at(82)}]},p).checks.H7_movementJoints,false,'detect crossings on the arc, not only on the corner polyline');
});
test('quality never acts as a hard constraint',()=>{
 const input={...fixtures[0].input,qualityWeights:Array(8).fill(0)},p=E.plan(input);assert.equal(p.ok,true);assert.equal(p.quality.score,0);assert.equal(p.hard.ok,true);
 assert.deepEqual(Object.keys(p.hard.checks).map(k=>k.slice(0,2)),['H1','H2','H3','H4','H5','H6','H7']);
});
test('impossible, invalid and disconnected inputs return no route',()=>{
 const input=fixtures[0].input;
 for(const x of [{...input,maxCircuitLengthMm:500},{...input,obstacles:[{x:0,y:0,width:4000,height:3000}]},{...input,sections:[{x:0,y:0,width:4000,height:3000},{x:6000,y:0,width:1000,height:1000}]},{...input,pipeStepMm:NaN},{...input,supply:{x:600,y:1500,side:'bottom'},returnPoint:{x:650,y:1500,side:'bottom'}}]){const p=E.plan(x);assert.equal(p.ok,false);assert.equal(p.circuits.length,0);}
});
test('offsets apply to the union, not artificial section seams',()=>{
 const input=fixtures[0].input,split={...input,sections:[{x:0,y:0,width:1500,height:3000},{x:1500,y:0,width:2500,height:3000}]};
 assert.deepEqual(E.freeSpace(E.normalize(input)).rects,E.freeSpace(E.normalize(split)).rects);
});
test.after(()=>{if(process.env.WARM_REPORT)require('node:fs').writeFileSync(process.env.WARM_REPORT,JSON.stringify(results,null,2));});
