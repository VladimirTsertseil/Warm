const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine-unified.js');
const C=require('../editor-core.js');

const input={
  sections:[{x:0,y:0,width:4000,height:3000}],obstacles:[],
  supply:{x:1975,y:3000,side:'bottom'},returnPoint:{x:2025,y:3000,side:'bottom'},
  pipeStepMm:150,pipeDiameterMm:16,wallOffsetMm:100,minBendRadiusMm:80,
  maxCircuitLengthMm:100000,pattern:'auto',deformationJoints:[],coldWalls:[],coldBandMm:800,coldStepMm:100
};
function basePlan(){const p=E.plan(input);assert.equal(p.ok,true);return p;}
function interiorSegment(p){const r=p.circuits[0].route;for(let i=1;i<r.length-2;i++)if(C.dist(r[i],r[i+1])>200)return i;throw Error('no interior segment');}

test('2.9 can insert a visible control vertex without changing the pipe geometry',()=>{
  const p=basePlan(),i=interiorSegment(p),r=p.circuits[0].route,a=r[i],b=r[i+1];
  const at={x:(a.x+b.x)/2,y:(a.y+b.y)/2},beforeLen=E.length(r);
  const x=C.insertVertex(p,0,i,at,[]);
  assert.equal(x.ok,true);
  assert.equal(x.plan.circuits[0].route.length,r.length+1);
  assert.ok(Math.abs(E.length(x.plan.circuits[0].route)-beforeLen)<1e-6);
  assert.equal(E.validate(input,x.plan).ok,true);
});

test('2.9 vertex drag is permissive: invalid geometry is kept and reported instead of rejected',()=>{
  const p=basePlan(),r=p.circuits[0].route,index=Math.min(3,r.length-2);
  const x=C.moveVertex(p,0,index,{x:-600,y:-500},[]);
  assert.equal(x.ok,true);
  const check=C.inspect(input,x.plan);
  assert.equal(check.ok,false);
  assert.ok(check.issues.length>0);
  assert.ok(check.issues.some(i=>i.key==='H1_freeSpace'||i.key==='H2_obstacles'||i.key==='H4_bendRadius'));
});

test('2.9 deleting an internal vertex connects its two neighbours directly',()=>{
  const p=basePlan(),i=interiorSegment(p),r=p.circuits[0].route,a=r[i],b=r[i+1];
  const inserted=C.insertVertex(p,0,i,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},[]);
  assert.equal(inserted.ok,true);
  const index=inserted.index,rr=inserted.plan.circuits[0].route,left=rr[index-1],right=rr[index+1];
  const deleted=C.deleteVertex(inserted.plan,0,index,[]);
  assert.equal(deleted.ok,true);
  const out=deleted.plan.circuits[0].route;
  assert.equal(out.length,r.length);
  assert.deepEqual(out[index-1],left);
  assert.deepEqual(out[index],right);
});

test('2.9 exposes automatic route vertices for point-mode hit testing',()=>{
  const p=basePlan(),r=p.circuits[0].route,index=Math.min(2,r.length-2),v=r[index];
  const hits=C.nearestVertex(p,{x:v.x+2,y:v.y+2},10,true);
  assert.ok(hits.length>0);
  assert.equal(hits[0].circuit,0);
  assert.equal(hits[0].index,index);
});
