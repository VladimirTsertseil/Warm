const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine-unified.js'),C=require('../editor-core.js'),fixtures=require('./fixtures.cjs');
const input={...fixtures[0].input,pattern:'spiral'},plan=E.plan(input);
test('manual acceptance uses precisely the automatic H1–H7 validator',()=>{
 assert.equal(plan.ok,true);assert.deepEqual(C.inspect(input,plan).checks,E.validate(input,plan).checks);
 for(const index of [1,3,5,7])for(const delta of [-500,10,500]){const r=C.moveSegment(plan,{circuit:0,seg:index},delta);assert.equal(r.ok,true);const v=C.inspect(input,r.plan);assert.deepEqual(v.checks,E.validate(input,r.plan).checks);if(!v.ok)assert.ok(v.issues.length);}
 const invalid=C.copy(plan);invalid.circuits[0].route[3].x=-100;const v=C.inspect(input,invalid);assert.equal(v.ok,false);assert.ok(v.issues.some(i=>i.key==='H1_freeSpace'&&i.segments.includes(3)));
});
test('small moves preserve ports, metadata, other vertices and the source plan',()=>{
 const original=JSON.stringify(plan),m=C.moveSegment(plan,{circuit:0,seg:3},10);assert.equal(E.validate(input,m.plan).ok,true);
 const before=plan.circuits[0],after=m.plan.circuits[0];assert.deepEqual(after.supply,before.supply);assert.deepEqual(after.returnPoint,before.returnPoint);assert.equal(after.bendRadiusMm,before.bendRadiusMm);
 before.route.forEach((p,i)=>{if(i!==3&&i!==4)assert.deepEqual(after.route[i],p);});assert.equal(JSON.stringify(plan),original);assert.equal(after.length,E.length(after.route));
 assert.equal(C.moveSegment(plan,{circuit:0,seg:0},10).ok,false);
});
test('locks protect adjacent edits and local replacement as well as direct moves',()=>{
 const r=plan.circuits[0].route,lock=[{circuit:1,edge:C.edgeKey(r[4],r[5])}];
 assert.equal(C.moveSegment(plan,{circuit:0,seg:4},10,lock).ok,false);
 assert.equal(C.moveSegment(plan,{circuit:0,seg:3},10,lock).ok,false);
 assert.equal(C.replace(plan,0,4,7,[r[4],{x:r[7].x,y:r[4].y},r[7]],lock).ok,false);
 assert.equal(C.moveSegment(plan,{circuit:0,seg:8},10,lock).ok,true);
});
test('bypass is validated and preserves the route outside A–B byte for byte',()=>{
 const r=plan.circuits[0].route,result=C.bypass(input,plan,0,4,7);assert.equal(result.ok,true,result.message);assert.equal(E.validate(input,result.plan).ok,true);
 const route=result.plan.circuits[0].route;assert.deepEqual(route.slice(0,4),r.slice(0,4));assert.deepEqual(route.slice(-(r.length-8)),r.slice(8));
 const blocked=C.bypass({...input,obstacles:[{x:0,y:1000,width:4000,height:500}]},plan,0,4,7);assert.equal(blocked.ok,false);
});
test('drawing keeps invalid work as a draft, with useful failure locations',()=>{
 const r=plan.circuits[0].route,result=C.replace(plan,0,4,7,[r[4],{x:5000,y:r[4].y},{x:5000,y:r[7].y},r[7]]);assert.equal(result.ok,true);assert.equal(C.inspect(input,result.plan).ok,false);
 assert.equal(C.replace(plan,0,4,4,[r[4]]).ok,false);
 assert.equal(C.inspect({...input,supply:null},{circuits:[]}).ok,false);
});
test('collector reconnect preserves locked middle runs and validates physical outlets',()=>{
 const r=plan.circuits[0].route,locks=[{circuit:1,edge:C.edgeKey(r[4],r[5])}],changed={...input,supply:{...input.supply,x:775},returnPoint:{...input.returnPoint,x:825}};
 const next=C.reconnect(changed,plan,locks);assert.equal(next.ok,true,next.message);assert.equal(C.locksPreserved(next.plan,locks),true);assert.equal(E.validate(changed,next.plan).ok,true);
 assert.deepEqual(next.plan.circuits[0].route[0],{x:775,y:3000});assert.deepEqual(next.plan.circuits[0].route.at(-1),{x:825,y:3000});
 assert.equal(E.validate(changed,plan).ok,false,'old connections must never pass after moving the cabinet');
});
test('a new obstacle is bypassed constructively without changing the unselected pipe',()=>{
 const f={...input,pipeStepMm:500},p=E.plan(f),r=p.circuits[0].route;
 const changed={...f,obstacles:[{x:(r[4].x+r[5].x)/2-40,y:(r[4].y+r[5].y)/2-40,width:80,height:80}]};
 assert.equal(E.validate(changed,p).ok,false);const result=C.bypass(changed,p,0,4,7);assert.equal(result.ok,true,result.message);assert.equal(E.validate(changed,result.plan).ok,true);
 assert.deepEqual(result.plan.circuits[0].route.slice(0,4),r.slice(0,4));assert.deepEqual(result.plan.circuits[0].route.slice(-(r.length-8)),r.slice(8));
});
test('wall resizing applies to the coordinate grid, for every supported shape',()=>{
 for(const f of fixtures){const walls=C.boundaries(f.input.sections);assert.ok(walls.length>=4);const e=walls.find(([a,b])=>C.dist(a,b)>=1000);const changed=C.resizeWall(f.input.sections,e,C.dist(...e)+200);assert.equal(changed.length,f.input.sections.length);assert.ok(changed.every(r=>r.width>0&&r.height>0));}
 assert.throws(()=>C.resizeWall(input.sections,[{x:0,y:0},{x:4000,y:0}],NaN));
});
