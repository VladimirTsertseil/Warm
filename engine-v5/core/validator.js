(function(root,factory){const api=factory(
 typeof module==='object'&&module.exports?require('./grid/rect-geometry.js'):root.WarmRectGeometry,
 typeof module==='object'&&module.exports?require('./project.js'):root.WarmProject,
 typeof module==='object'&&module.exports?require('./geometry.js'):root.WarmGeometry
);if(typeof module==='object'&&module.exports)module.exports=api;else root.WarmValidator=api;})(typeof globalThis!=='undefined'?globalThis:this,function(E,P,G){
'use strict';
const EPS=1e-6,finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y),same=(a,b)=>a&&b&&Math.hypot(a.x-b.x,a.y-b.y)<EPS;
const baseChecks=()=>({H1_freeSpace:true,H2_obstacles:true,H3_crossings:true,H4_bendRadius:true,H5_continuity:true,H6_circuitLimit:true,H7_movementJoints:true,_mountingGrid:true});
function structural(plan){
 if(!plan?.ok||!Array.isArray(plan.circuits)||!plan.circuits.length)return{ok:false,reason:'EMPTY_PLAN'};
 for(const c of plan.circuits){if(!Array.isArray(c.route)||c.route.length<2||c.route.some(p=>!finite(p)))return{ok:false,reason:'INVALID_ROUTE'};for(let i=1;i<c.route.length;i++){const a=c.route[i-1],b=c.route[i];if(Math.hypot(a.x-b.x,a.y-b.y)<EPS)return{ok:false,reason:'ZERO_SEGMENT'};if(Math.abs(a.x-b.x)>EPS&&Math.abs(a.y-b.y)>EPS)return{ok:false,reason:'INVALID_TURN'};}}
 return{ok:true};
}
function inputFor(p,supply,returnPoint,R,wallOffsetMm){return G.engineInput(p,{supply,returnPoint,wallOffsetMm,minBendRadiusMm:R,maxCircuitLengthMm:p.settings.maxCircuitLengthMm});}
function onePlan(c,route,R){const supply=route[0],returnPoint=route.at(-1),length=E.length(route);return{circuits:[{...c,route,length,supply,returnPoint,bendRadiusMm:R}],manifold:[{supply,returnPoint}]};}
function locateCore(route,core){
 if(!Array.isArray(core)||core.length<2)return null;const a=core[0],b=core.at(-1);let i=route.findIndex(p=>same(p,a));if(i<0)return null;let j=-1;for(let k=route.length-1;k>i;k--)if(same(route[k],b)){j=k;break;}if(j>i)return route.slice(i,j+1);
 i=route.findIndex(p=>same(p,b));if(i<0)return null;for(let k=route.length-1;k>i;k--)if(same(route[k],a)){j=k;break;}return j>i?route.slice(i,j+1):null;
}
function onGridLine(p,a,b){const s=p.grid.cellSizeMm,o=p.grid.origin;if(Math.abs(a.y-b.y)<EPS)return Math.abs((a.y-o.y)/s-Math.round((a.y-o.y)/s))<EPS;if(Math.abs(a.x-b.x)<EPS)return Math.abs((a.x-o.x)/s-Math.round((a.x-o.x)/s))<EPS;return false;}
function mergeChecks(into,from){for(const k of Object.keys(into))if(k in from)into[k]&&=!!from[k];}
function curveInside(route,R,space){const rounded=E.rounded(route,R);if(!rounded)return false;return rounded.primitives.every(pr=>(pr.points||[pr.a,pr.b]).every(space.contains));}
function selfCross(route){const ss=E.segments(route);for(let i=0;i<ss.length;i++)for(let j=0;j<i-1;j++)if(E.intersect(...ss[i],...ss[j]))return true;return false;}
function validate(raw,plan){
 try{
  const p=P.create(raw),s=structural(plan);if(!s.ok)return{ok:false,reason:s.reason,checks:baseChecks()};const checks=baseChecks(),physical=G.physicalSpace(p),working=G.workingSpace(p),routes=[];let totalLength=0;
  for(const c0 of plan.circuits){
   const c={...c0},route=c.route,R=Number(c.bendRadiusMm)||p.settings.bendRadiusMm,rounded=E.rounded(route,R),length=rounded?.length??E.length(route);c.length=length;totalLength+=length;
   if(length>p.settings.maxCircuitLengthMm+EPS)checks.H6_circuitLimit=false;
   if(c.supply&&!same(route[0],c.supply)||c.returnPoint&&!same(route.at(-1),c.returnPoint))checks.H5_continuity=false;
   if(route.slice(1).some((b,i)=>!physical.covers(route[i],b)))checks.H1_freeSpace=false;
   if(!E.bendsOK(route,R)||!curveInside(route,R,physical))checks.H4_bendRadius=false;
   if(selfCross(route))checks.H3_crossings=false;
   const core=locateCore(route,c.heating?.route||c.core);
   if(core){
    if(core.slice(1).some((b,i)=>!working.covers(core[i],b)))checks.H1_freeSpace=false;
    if(!E.bendsOK(core,R)||!curveInside(core,R,working))checks.H4_bendRadius=false;
    if(selfCross(core))checks.H3_crossings=false;
    for(let i=1;i<core.length;i++)checks._mountingGrid&&=onGridLine(p,core[i-1],core[i]);
   } else {
    checks.H1_freeSpace=false;checks._mountingGrid=false;
   }
   routes.push(route);
  }
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)for(const a of E.segments(routes[i]))for(const b of E.segments(routes[j])){
   if(E.intersect(...a,...b)||E.segmentDistance(...a,...b)<p.pipe.diameterMm-EPS)checks.H3_crossings=false;
  }
  const ok=Object.values(checks).every(Boolean),reason=ok?null:(Object.keys(checks).find(k=>!checks[k])||'GEOMETRY_REJECTED');
  return{ok,status:ok?'ACCEPTED':'REJECTED',reason,checks,totalLength};
 }catch(e){return{ok:false,reason:e.message,checks:baseChecks()};}
}
return{validate,structural,onGridLine,locateCore};
});
