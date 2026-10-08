(function(root,factory){
 const api=factory(
  typeof module==='object'&&module.exports?require('./grid/allocator.js'):root.WarmGridAllocator,
  typeof module==='object'&&module.exports?require('./project.js'):root.WarmProject,
  typeof module==='object'&&module.exports?require('./grid/topology.js'):root.WarmGridTopology
 );
 if(typeof module==='object'&&module.exports)module.exports=api;else root.WarmPlanner=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(A,P,T){
'use strict';
const copy=x=>structuredClone(x),EPS=1e-6;
function patterns(requested){
 if(requested==='auto')return['spiral','double-snake'];
 if(['spiral','double-snake'].includes(requested))return[requested];
 return[];
}
function gridProject(p){
 return {schemaVersion:5,units:'mm',room:copy(p.room),exclusions:copy(p.exclusions),grid:copy(p.grid),pipe:copy(p.pipe),collector:copy(p.collector),circuits:[]};
}
function displayPlan(auto,selectedPattern){
 const circuits=auto.multi.circuits.map((c,i)=>({
  id:c.id??`circuit-${i+1}`,number:i+1,route:copy(c.route),length:c.lengthMm,
  core:copy(c.heating?.route||c.route),coreLength:c.heating?.lengthMm??c.lengthMm,
  bendRadiusMm:auto.settings.radiusMm,supply:copy(c.supply),returnPoint:copy(c.returnPoint),
  pattern:c.method||selectedPattern,method:c.method||selectedPattern,diameterMm:c.diameterMm,
  supplyTransit:copy(c.supplyTransit),heating:copy(c.heating),returnTransit:copy(c.returnTransit),zone:copy(c.zone??null)
 }));
 return {ok:true,version:'5.0.0',coreVersion:'5.0.0',planner:'grid',kind:selectedPattern,
  circuits,totalLength:circuits.reduce((n,c)=>n+c.length,0),warnings:[],
  gridSettings:{cellSizeMm:auto.multi?.definitions?.length?undefined:undefined,radiusMm:auto.settings.radiusMm,spacingCells:auto.settings.spacingCells,wallOffsetMm:auto.settings.wallOffsetMm}};
}
function onGrid(p,q){const s=p.grid.cellSizeMm,o=p.grid.origin;return Math.abs((q.x-o.x)/s-Math.round((q.x-o.x)/s))<EPS&&Math.abs((q.y-o.y)/s-Math.round((q.y-o.y)/s))<EPS;}
function heatingOnGrid(p,auto){return auto.multi.circuits.every(c=>Array.isArray(c.heating?.route)&&c.heating.route.every(q=>onGrid(p,q)));}
function plan(raw,options={},progress=()=>{}){
 const started=Date.now(),attempts=[];let p;try{p=P.create(raw);}catch(e){return{ok:false,status:'NO_LAYOUT',reason:e.message,attempts};}
 if(!p.collector.supply)return{ok:false,status:'NO_LAYOUT',reason:'COLLECTOR_REQUIRED',attempts};
 const requested=options.pattern||p.settings.pattern,tries=patterns(requested);
 if(!tries.length)return{ok:false,status:'NO_LAYOUT',reason:'UNSUPPORTED_GRID_PATTERN',coreVersion:'5.0.0',planner:'planner',attempts,projectSignature:P.signature(p)};
 for(const requestedPattern of (requested==='auto'?['auto']:tries)){
  let pattern=requestedPattern;
  progress({pattern,attempt:attempts.length+1});
  const budget=options.timeBudgetMs??30000,gp=gridProject(p),opts={maxCircuitLengthMm:p.settings.maxCircuitLengthMm,wallOffsetMm:p.settings.wallOffsetMm,pairedLeads:options.pairedLeads===true,...(requestedPattern!=='auto'?{method:requestedPattern}:{})};
  const q=p.collector.supply,rs=p.room.sections;
  const inner=q.x>Math.min(...rs.map(r=>r.x))+EPS&&q.x<Math.max(...rs.map(r=>r.x+r.width))-EPS&&q.y>Math.min(...rs.map(r=>r.y))+EPS&&q.y<Math.max(...rs.map(r=>r.y+r.height))-EPS;
  const topologyFirst=inner&&!!T,firstBudget=(topologyFirst?budget*.8:Math.min(24000,budget*.55))-(Date.now()-started);
  let source=topologyFirst?T.plan(gp,{...opts,timeBudgetMs:firstBudget},A.partitions,x=>progress({pattern,...x})):A.plan(gp,{...opts,timeBudgetMs:firstBudget},x=>progress({pattern,...x}));
  if(!source?.ok){
   attempts.push({pattern,engine:topologyFirst?'topology':'compact',ok:false,reason:source?.reason||'NO_VERIFIED_LAYOUT',search:source?.search});
   if(Date.now()-started<budget&&T)source=topologyFirst?A.plan(gp,{...opts,timeBudgetMs:budget-(Date.now()-started)},x=>progress({pattern,...x})):T.plan(gp,{...opts,timeBudgetMs:budget-(Date.now()-started)},A.partitions,x=>progress({pattern,...x}));
  }
  if(!source?.ok){attempts.push({pattern,engine:topologyFirst?'compact':'topology',ok:false,reason:source?.reason||'NO_VERIFIED_LAYOUT',search:source?.search});continue;}
  pattern=source.multi.circuits[0].method;
  const checked=A.validate(gridProject(p),source);
  if(!checked.ok){attempts.push({pattern,ok:false,reason:checked.reason});continue;}
  if(!heatingOnGrid(p,source)){attempts.push({pattern,ok:false,reason:'HEATING_OFF_MOUNTING_GRID'});continue;}
  if(source.multi.circuits.some(c=>c.lengthMm>p.settings.maxCircuitLengthMm+EPS)){attempts.push({pattern,ok:false,reason:'CIRCUIT_TOO_LONG'});continue;}
  const out=displayPlan(source,pattern);attempts.push({pattern,ok:true,circuits:out.circuits.length,totalLength:out.totalLength});
  return{ok:true,status:'PLAN_OK',coreVersion:'5.0.0',planner:'planner',selectedPattern:pattern,attempts,
   elapsedMs:Date.now()-started,projectSignature:P.signature(p),plan:out,gridAuto:source};
 }
 return{ok:false,status:'NO_LAYOUT',reason:attempts.some(a=>a.reason==='SEARCH_LIMIT')?'SEARCH_LIMIT':attempts.at(-1)?.reason||'NO_VERIFIED_LAYOUT',coreVersion:'5.0.0',planner:'planner',attempts,elapsedMs:Date.now()-started,projectSignature:P.signature(p)};
}
function validate(raw,result){
 try{
  const p=P.create(raw);if(!result?.ok||result.status!=='PLAN_OK'||result.planner!=='planner'||!result.plan||!result.gridAuto)return{ok:false,reason:'INVALID_RESULT'};
  if(result.projectSignature!==P.signature(p))return{ok:false,reason:'PROJECT_CHANGED'};
  const a=A.validate(gridProject(p),result.gridAuto);if(!a.ok)return a;
  if(!heatingOnGrid(p,result.gridAuto))return{ok:false,reason:'HEATING_OFF_MOUNTING_GRID'};
  if(result.gridAuto.multi.circuits.some(c=>c.lengthMm>p.settings.maxCircuitLengthMm+EPS))return{ok:false,reason:'CIRCUIT_TOO_LONG'};
  const expected=displayPlan(result.gridAuto,result.selectedPattern);
  if(JSON.stringify(expected)!==JSON.stringify(result.plan))return{ok:false,reason:'PLAN_CHANGED'};
  return{ok:true,status:'ACCEPTED',checks:{grid:true,geometry:true,coverage:true,length:true},totalLength:expected.totalLength};
 }catch(e){return{ok:false,reason:e.message};}
}
return{plan,validate,patterns,displayPlan,heatingOnGrid};
});
