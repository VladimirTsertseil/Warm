const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine-unified.js');
const C=require('../editor-core.js');
const fixtures=require('./fixtures.cjs');

const input={...fixtures[0].input,pattern:'spiral'};
const plan=E.plan(input);

function makeCut(){
  const route=plan.circuits[0].route;
  let seg=E.segments(route).findIndex(([a,b])=>C.dist(a,b)>700);
  if(seg<0)seg=E.segments(route).findIndex(([a,b])=>C.dist(a,b)>450);
  assert.ok(seg>=0);
  const a=route[seg],b=route[seg+1],p=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const cut=C.prepareCut(plan,0,{circuit:0,seg,at:p(.18)},{circuit:0,seg,at:p(.82)},[]);
  assert.equal(cut.ok,true,cut.message);
  return cut;
}

test('guided replacement turns a rough finger gesture into a fully valid route',()=>{
  const cut=makeCut(),r=cut.plan.circuits[0].route,a=r[cut.start],b=r[cut.end];
  const horizontal=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y);
  const offset=320;
  const guide=horizontal
    ? [a,{x:a.x+(b.x-a.x)*.2,y:a.y+offset},{x:a.x+(b.x-a.x)*.8,y:a.y+offset},b]
    : [a,{x:a.x+offset,y:a.y+(b.y-a.y)*.2},{x:a.x+offset,y:a.y+(b.y-a.y)*.8},b];
  const result=C.guidedReplace(input,cut.plan,0,cut.start,cut.end,guide,[]);
  assert.equal(result.ok,true,result.message);
  assert.equal(E.validate(input,result.plan).ok,true);
  assert.ok(C.same(result.path[0],a));
  assert.ok(C.same(result.path.at(-1),b));
});

test('guided replacement preserves every uncut route point',()=>{
  const cut=makeCut(),before=cut.plan.circuits[0].route,a=before[cut.start],b=before[cut.end];
  const guide=[a,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},b];
  const result=C.guidedReplace(input,cut.plan,0,cut.start,cut.end,guide,[]);
  assert.equal(result.ok,true,result.message);
  const after=result.plan.circuits[0].route;
  assert.deepEqual(after.slice(0,cut.start),before.slice(0,cut.start));
  const tailCount=before.length-cut.end-1;
  assert.deepEqual(after.slice(after.length-tailCount),before.slice(cut.end+1));
});
