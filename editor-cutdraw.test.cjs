const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine-unified.js');
const C=require('../editor-core.js');
const fixtures=require('./fixtures.cjs');

const input={...fixtures[0].input,pattern:'spiral'};
const plan=E.plan(input);

test('eraser can cut at arbitrary projected points, not only existing corners',()=>{
  assert.equal(plan.ok,true);
  const route=plan.circuits[0].route;
  let seg=E.segments(route).findIndex(([a,b])=>C.dist(a,b)>500);
  assert.ok(seg>=0);
  const a=route[seg],b=route[seg+1];
  const p=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const first={circuit:0,seg,at:p(.2)},second={circuit:0,seg,at:p(.8)};
  const cut=C.prepareCut(plan,0,first,second,[]);
  assert.equal(cut.ok,true,cut.message);
  assert.deepEqual(cut.plan.circuits[0].route[cut.start],first.at);
  assert.deepEqual(cut.plan.circuits[0].route[cut.end],second.at);
  assert.ok(cut.end>cut.start);
  assert.equal(Math.round(E.length(cut.plan.circuits[0].route)),Math.round(E.length(route)));
});

test('free replacement reconnects the exact cut endpoints and preserves the rest of the route',()=>{
  const route=plan.circuits[0].route;
  const seg=E.segments(route).findIndex(([a,b])=>C.dist(a,b)>500);
  const a=route[seg],b=route[seg+1],point=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const cut=C.prepareCut(plan,0,{circuit:0,seg,at:point(.2)},{circuit:0,seg,at:point(.8)},[]);
  assert.equal(cut.ok,true);
  const start=cut.plan.circuits[0].route[cut.start],end=cut.plan.circuits[0].route[cut.end];
  const mid={x:(start.x+end.x)/2+80,y:(start.y+end.y)/2+80};
  const replaced=C.replace(cut.plan,0,cut.start,cut.end,[start,mid,end],[]);
  assert.equal(replaced.ok,true,replaced.message);
  assert.deepEqual(replaced.plan.circuits[0].route.slice(0,cut.start),cut.plan.circuits[0].route.slice(0,cut.start));
  assert.deepEqual(replaced.plan.circuits[0].route.slice(-(cut.plan.circuits[0].route.length-cut.end-1)),cut.plan.circuits[0].route.slice(cut.end+1));
});

test('eraser refuses to remove a locked piece of pipe',()=>{
  const route=plan.circuits[0].route;
  const seg=E.segments(route).findIndex(([a,b])=>C.dist(a,b)>500);
  const a=route[seg],b=route[seg+1],point=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const locks=[{circuit:plan.circuits[0].id,edge:C.edgeKey(a,b)}];
  const cut=C.prepareCut(plan,0,{circuit:0,seg,at:point(.2)},{circuit:0,seg,at:point(.8)},locks);
  assert.equal(cut.ok,false);
});

test('eraser accepts reversed picks across different segments',()=>{
  const route=plan.circuits[0].route,segments=E.segments(route);
  const usable=segments.map(([a,b],i)=>({i,len:C.dist(a,b),a,b})).filter(x=>x.len>200);
  assert.ok(usable.length>2);
  const first=usable[0],second=usable[Math.min(usable.length-1,2)];
  const p=(s,t)=>({x:s.a.x+(s.b.x-s.a.x)*t,y:s.a.y+(s.b.y-s.a.y)*t});
  const cut=C.prepareCut(plan,0,{circuit:0,seg:second.i,at:p(second,.65)},{circuit:0,seg:first.i,at:p(first,.35)},[]);
  assert.equal(cut.ok,true,cut.message);
  assert.ok(cut.start<cut.end);
  assert.ok(C.same(cut.plan.circuits[0].route[cut.start],p(first,.35)));
  assert.ok(C.same(cut.plan.circuits[0].route[cut.end],p(second,.65)));
});
