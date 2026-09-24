const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('./engine-unified.js');
const C=require('./editor-core.js');

const input={
  sections:[{x:0,y:0,width:4000,height:3000}],obstacles:[],
  supply:{x:1975,y:3000,side:'bottom'},returnPoint:{x:2025,y:3000,side:'bottom'},
  pipeStepMm:150,pipeDiameterMm:16,wallOffsetMm:100,minBendRadiusMm:80,
  maxCircuitLengthMm:100000,pattern:'auto',deformationJoints:[],coldWalls:[],coldBandMm:800,coldStepMm:100
};
function basePlan(){const p=E.plan(input);assert.equal(p.ok,true);return p;}

test('2.8 keeps the base 4x3 automatic layout valid',()=>{
 const p=basePlan();
 assert.ok(p.circuits.length>=1);
 assert.equal(E.validate(input,p).ok,true);
});

test('two points on one straight create a span and a safe perpendicular offset can be found',()=>{
 const p=basePlan(),r=p.circuits[0].route;
 let success=null;
 for(let i=1;i<r.length-2&&!success;i++){
  const a=r[i],b=r[i+1],len=C.dist(a,b);if(len<900)continue;
  const first={circuit:0,seg:i,at:{x:a.x+(b.x-a.x)*.25,y:a.y+(b.y-a.y)*.25}};
  const second={circuit:0,seg:i,at:{x:a.x+(b.x-a.x)*.75,y:a.y+(b.y-a.y)*.75}};
  const prep=C.prepareSpan(input,p,0,first,second,[]);if(!prep.ok)continue;
  const span={circuit:prep.circuit,start:prep.start,end:prep.end,a:prep.a,b:prep.b};
  for(const d of [250,-250,350,-350,500,-500]){
   const moved=C.offsetSpanClamped(input,prep.basePlan,span,d,[]);
   if(moved.ok&&Math.abs(moved.delta||0)>=2*input.minBendRadiusMm-1){success=moved;break;}
  }
 }
 assert.ok(success,'expected at least one editable interior span');
 assert.equal(E.validate(input,success.plan).ok,true);
});

test('one point chooses the nearest turn from the side of the drag and can move it safely',()=>{
 const p=basePlan(),r=p.circuits[0].route;
 let checked=false;
 for(let i=1;i<r.length-2&&!checked;i++){
  const a=r[i],b=r[i+1],len=C.dist(a,b);if(len<400)continue;
  const at={x:(a.x+b.x)/2,y:(a.y+b.y)/2},anchor={circuit:0,seg:i,at};
  for(const side of [1,-1]){
   const toward={x:at.x+(b.x-a.x)*.2*side,y:at.y+(b.y-a.y)*.2*side};
   const sel=C.turnSelectionFromAnchor(p,anchor,toward);if(!sel)continue;
   assert.equal(sel.side,side);
   for(const d of [50,-50,100,-100,150,-150]){
    const moved=C.moveSegmentNormalClamped(input,p,sel,d,[]);
    if(Math.abs(moved.delta||0)>1){assert.equal(E.validate(input,moved.plan).ok,true);checked=true;break;}
   }
   if(checked)break;
  }
 }
 assert.equal(checked,true);
});
