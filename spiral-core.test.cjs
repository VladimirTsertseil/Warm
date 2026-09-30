const test=require('node:test'),assert=require('node:assert/strict'),C=require('../room-draw-core');
const p=xy=>xy.map(([x,y])=>({x,y}));
const rect=p([[0,0],[3750,0],[3750,2500],[0,2500]]);
const l=p([[0,0],[5000,0],[5000,2000],[3000,2000],[3000,4000],[0,4000]]);
const u=p([[0,0],[6000,0],[6000,5000],[4000,5000],[4000,2000],[2000,2000],[2000,5000],[0,5000]]);
for(const [name,poly,area] of [['rectangle',rect,9375000],['L',l,16000000],['U',u,24000000]])test(name+' decomposes without changing boundary or area in either direction',()=>{
 for(const points of [poly,[...poly].reverse(),poly.map(q=>({x:q.y-2700,y:q.x-1250}))]){
  const r=C.build(points);assert(r.ok,r.error);assert.equal(r.areaMm2,area);assert.equal(r.sections.reduce((a,s)=>a+s.width*s.height,0),area);
  for(let i=0;i<r.sections.length;i++)for(let j=i+1;j<r.sections.length;j++){const a=r.sections[i],b=r.sections[j];assert(!(Math.max(a.x,b.x)<Math.min(a.x+a.width,b.x+b.width)&&Math.max(a.y,b.y)<Math.min(a.y+a.height,b.y+b.height)));}
 }
});
test('rejects crossed, overlapping, touching and diagonal walls',()=>{
 for(const points of [p([[0,0],[4000,0],[4000,4000],[2000,4000],[2000,-1000],[-1000,-1000],[-1000,2000],[0,2000]]),p([[0,0],[4000,0],[2000,0],[2000,2000],[0,2000]]),p([[0,0],[4000,0],[4000,2000],[2000,2000],[2000,0],[1000,0],[1000,3000],[0,3000]]),p([[0,0],[4000,100],[4000,2000],[0,2000]])])assert(!C.build(points).ok);
});
test('open polyline cannot cross itself or backtrack; closure checks final wall',()=>{
 const points=p([[0,0],[3000,0],[3000,2000],[1000,2000]]);
 assert(!C.candidate(points,{x:1000,y:-1000}).ok);assert(!C.candidate(points,{x:2000,y:2000}).ok);assert(!C.candidate(points,points[0]).ok);
 const check=C.candidate(rect,rect[0]);assert(check.ok&&check.closes);
});
test('grid snapping preserves orthogonality and exact off-grid alignment',()=>{
 assert.deepEqual(C.snap([],{x:231,y:177},100),{x:200,y:200});
 assert.deepEqual(C.snap([{x:3750,y:125}],{x:5000,y:211},100),{x:5000,y:125});
 assert.deepEqual(C.snap([{x:3750,y:125},{x:1000,y:125},{x:1000,y:2000}],{x:3741,y:2030},100,50),{x:3750,y:2000});
});
test('minimum wall, area, finite coordinates and maximum room dimensions enforced',()=>{
 assert(!C.build(p([[0,0],[50,0],[50,1000],[0,1000]])).ok);
 assert(!C.build(p([[0,0],[200,0],[200,200],[0,200]])).ok);
 assert(!C.build(p([[0,0],[31000,0],[31000,1000],[0,1000]])).ok);
 assert(!C.build([{x:NaN,y:0},...rect]).ok);
});
test('removes redundant collinear vertices without altering room',()=>{
 const r=C.build(p([[0,0],[1500,0],[3000,0],[3000,2000],[0,2000]]));assert(r.ok);assert.equal(r.points.length,4);assert.equal(r.areaMm2,6000000);
});
