const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../engine-unified.js');

// Regression for the 4 x 3 m editor case with two vertically staggered
// obstacles near the left wall. Before the hotfix, the 100 mm event-sweep
// sliver above the first obstacle made regions() reject the whole room.
test('4x3 room with two left-side obstacles remains routable',()=>{
  const input={
    sections:[{x:0,y:0,width:4000,height:3000}],
    obstacles:[
      {x:410,y:305,width:540,height:600},
      {x:360,y:1495,width:630,height:690},
    ],
    supply:{x:1395,y:3000,side:'bottom'},
    returnPoint:{x:1445,y:3000,side:'bottom'},
    pipeStepMm:150,pipeDiameterMm:16,wallOffsetMm:100,minBendRadiusMm:80,
    maxCircuitLengthMm:100000,pattern:'auto',
  };
  const plan=E.plan(input);
  assert.equal(plan.ok,true,plan.error||JSON.stringify(plan.diagnostics));
  assert.equal(E.validate(input,plan).ok,true);
  assert.ok(plan.quality.coverage>=0.9,`coverage=${plan.quality.coverage}`);
  assert.ok(plan.circuits.length<=2,`unexpected circuit count=${plan.circuits.length}`);
  assert.ok(plan.circuits.every(c=>c.length<=input.maxCircuitLengthMm));
});
