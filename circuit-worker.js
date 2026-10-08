'use strict';
/* V5 circuit engine behind the original Warm 3.6 calculation UI. */
importScripts(
  './engine-v5/core/grid/model.js?v=501-release-20261001',
  './engine-v5/core/grid/rect-geometry.js?v=501-release-20261001',
  './engine-v5/core/grid/patterns.js?v=501-release-20261001',
  './engine-v5/core/grid/circuit.js?v=501-release-20261001'
);
self.onmessage=({data})=>{
  try{
    const result=WarmGridCircuit.plan(data.project,data.settings);
    if(result?.ok)result.planner='grid-circuit-v32';
    self.postMessage(result);
  }catch(e){self.postMessage({ok:false,status:'ROUTE_IMPOSSIBLE',reason:e?.message||'CALCULATION_FAILED',circuits:[]});}
};
