'use strict';
/* Warm hybrid: original 3.6 UI, Warm 5.0 automatic engine.
   The worker converts the V5 result back to the metadata contract expected
   by the existing 3.3/3.4 renderer and manual editor. */
importScripts(
  './engine-v5/core/grid/model.js?v=501-release-20261001',
  './engine-v5/core/grid/rect-geometry.js?v=501-release-20261001',
  './engine-v5/core/grid/patterns.js?v=501-release-20261001',
  './engine-v5/core/grid/circuit.js?v=501-release-20261001',
  './engine-v5/core/grid/coverage.js?v=501-release-20261001',
  './engine-v5/core/grid/multi.js?v=501-release-20261001',
  './engine-v5/core/grid/allocator.js?v=501-engine022',
  './engine-v5/core/project.js?v=501-release-20261001',
  './engine-v5/core/geometry.js?v=501-release-20261001',
  './engine-v5/core/validator.js?v=501-release-20261001',
  './engine-v5/core/grid/router.js?v=501-engine022',
  './engine-v5/core/grid/topology.js?v=501-engine022',
  './engine-v5/core/planner.js?v=501-engine022',
  './engine-v5/core/api.js?v=501-release-20261001',
  './grid-core.js?v=501-release-20261001', './engine-unified.js?v=501-release-20261001', './spiral-core.js?v=501-release-20261001',
  './circuit-core.js?v=501-release-20261001', './auto-geometry.js?v=501-release-20261001', './multi-core.js?v=501-release-20261001', './auto-core.js?v=501-release-20261001'
);

const copy=x=>structuredClone(x);

function v5Project(project,options={}){
  const cell=Number(project?.grid?.cellSizeMm)||150;
  const maxCircuitLengthMm=Number(options.maxCircuitLengthMm??80000);
  if(!Number.isFinite(maxCircuitLengthMm)||maxCircuitLengthMm<20000)throw new Error('INVALID_MAX_LENGTH');
  return {
    room:copy(project.room),
    exclusions:copy(project.exclusions||{areas:[]}),
    grid:copy(project.grid),
    pipe:copy(project.pipe||{diameterMm:16}),
    collector:copy(project.collector||{}),
    settings:{
      wallOffsetMm:Number.isFinite(Number(options.wallOffsetMm))?Number(options.wallOffsetMm):100,
      bendRadiusMm:Math.min(cell/2,50),
      maxCircuitLengthMm,
      pattern:'auto'
    }
  };
}

function legacyCompatible(result){
  if(!result?.ok){
    return {ok:false,status:'AUTO_NOT_FOUND',reason:result?.reason||'NO_VERIFIED_LAYOUT',circuits:[],
      engineVersion:'5.0.1-engine022',attempts:copy(result?.attempts||[])};
  }
  const out=copy(result.gridAuto);
  // The underlying circuit geometry stays untouched. Only the historical
  // metadata labels are restored so Warm 3.6's existing independent
  // validators/editor can verify and consume the V5 result.
  out.planner='grid-auto-v35';
  out.engineVersion='5.0.1-engine022';
  out.selectedPattern=result.selectedPattern;
  out.v5Attempts=copy(result.attempts||[]);
  if(out.multi){
    out.multi.planner='grid-multi-v33';
    for(const item of out.multi.results||[]){
      if(item?.plan)item.plan.planner='grid-circuit-v32';
    }
  }
  return out;
}

onmessage=({data})=>{
  try{
    const p=v5Project(data.project,data.options||{});
    const result=WarmCore.planAuto(p,{pattern:'auto',pairedLeads:data.options?.pairedLeads===true,timeBudgetMs:data.options?.timeBudgetMs??45000},progress=>{
      const count=Number.isFinite(progress?.count)?progress.count:Number.isFinite(progress?.attempt)?progress.attempt:1;
      postMessage({progress:{count,pattern:progress?.pattern||null}});
    });
    const compatible=legacyCompatible(result);
    if(compatible.ok){
      const checked=WarmAuto.validate(data.project,compatible);
      if(!checked.ok)throw new Error('LEGACY_VALIDATION_'+checked.reason);
    }
    postMessage({result:compatible});
  }catch(e){
    postMessage({result:{ok:false,status:'AUTO_NOT_FOUND',reason:e?.message||String(e),circuits:[],engineVersion:'5.0.1-engine022'}});
  }
};
