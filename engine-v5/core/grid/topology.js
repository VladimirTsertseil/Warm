/* General free-space routing fallback. No room-shape templates. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./model.js'),require('./patterns.js'),require('./circuit.js'),require('./multi.js'),require('./rect-geometry.js'),require('./coverage.js'),require('./router.js'));
 else root.WarmGridTopology=factory(root.WarmGridModel,root.WarmGridPatterns,root.WarmGridCircuit,root.WarmGridMulti,root.WarmRectGeometry,root.WarmGridCoverage,root.WarmGridRouter);
})(globalThis,function(G,S,C,M,Geo,V,Router){
'use strict';
const H=S.geometry,EPS=1e-6,copy=x=>structuredClone(x),dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const add=(p,n,d)=>({x:p.x+n.x*d,y:p.y+n.y*d});
function contextKey(cache,ctx){let key=cache.contextKeys.get(ctx);if(!key){key=JSON.stringify([ctx.p,ctx.o,ctx.step]);cache.contextKeys.set(ctx,key);}return key;}
// Use the router's precision at joins as well. Fractional bend radii must not
// leave a microscopic extra segment between the spine and the entry fan.
const cleanTransit=route=>Geo.clean(route.map(q=>({x:Math.round(q.x*1e6)/1e6,y:Math.round(q.y*1e6)/1e6})));
const bounds=rs=>{const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return{x,y,width:Math.max(...rs.map(r=>r.x+r.width))-x,height:Math.max(...rs.map(r=>r.y+r.height))-y};};
function boundary(p){
 const space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm:0,pipeDiameterMm:0}),q=p.collector.supply,groups=new Map();
 for(const [a,b] of space.edges){
  const h=a.y===b.y,lo=Math.min(h?a.x:a.y,h?b.x:b.y),hi=Math.max(h?a.x:a.y,h?b.x:b.y),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  for(const sign of [-1,1]){
   const normal=h?{x:0,y:sign}:{x:sign,y:0};if(!space.contains(add(mid,normal,.001))||space.contains(add(mid,normal,-.001)))continue;
   const wall=h?a.y:a.x,key=[h,wall,sign].join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push({normal,h,lo,hi,wall});
  }
 }
 const merged=[];
 for(const spans of groups.values())for(const span of spans.sort((a,b)=>a.lo-b.lo)){
  const last=merged.at(-1);if(last&&last.h===span.h&&last.wall===span.wall&&last.normal.x===span.normal.x&&last.normal.y===span.normal.y&&span.lo<=last.hi+EPS)last.hi=Math.max(last.hi,span.hi);else merged.push({...span});
 }
 return merged.filter(b=>Math.abs((b.h?q.y:q.x)-b.wall)<EPS&&(b.h?q.x:q.y)>=b.lo-EPS&&(b.h?q.x:q.y)<=b.hi+EPS);
}
function bank(p,n,R,paired,b,ribbon=false){
 const D=p.pipe.diameterMm,pitch=paired?Math.max(2*D,32):ribbon?p.grid.cellSizeMm:2*R,stride=ribbon?Math.ceil((2*R+Math.max(pitch,p.grid.cellSizeMm))/p.grid.cellSizeMm)*p.grid.cellSizeMm:2*R+pitch,width=(n-1)*stride+pitch;
 if(width>b.hi-b.lo-2*D)return null;
 const anchor=b.h?p.collector.supply.x:p.collector.supply.y;let start=Math.max(b.lo+D,Math.min(anchor-width/2,b.hi-D-width));
 if(ribbon){const s=p.grid.cellSizeMm,o=b.h?p.grid.origin.x:p.grid.origin.y;start=o+Math.round((start-o)/s)*s;if(start<b.lo+D)start+=s;if(start+width>b.hi-D)start-=s;if(start<b.lo+D)return null;}
 return Array.from({length:n},(_,i)=>({supply:b.h?{x:start+i*stride,y:b.wall}:{x:b.wall,y:start+i*stride},returnPoint:b.h?{x:start+i*stride+pitch,y:b.wall}:{x:b.wall,y:start+i*stride+pitch},normal:b.normal}));
}
function growBoundary(ctx,route,cache){
 const key=cache?JSON.stringify([contextKey(cache,ctx),route]):null;
 if(cache&&cache.growBoundary.has(key)){cache.stats.cacheHits++;return copy(cache.growBoundary.get(key));}
 if(cache)cache.stats.cacheMisses++;
 if(cache)cache.stats.growBoundaryCalls++;
 let result=copy(route);
 const accept=next=>{try{const cleaned=Geo.clean(next);if(cleaned.slice(1).some((q,j)=>!ctx.guide(cleaned[j],q)))return false;H.checkSegments(ctx,H.compile(ctx,cleaned));result=cleaned;return true;}catch{return false;}};
 for(let i=1;i<result.length-2;i++)for(const sign of [-1,1]){
  const a=result[i],b=result[i+1];if(!a||!b)break;
  const horizontal=Math.abs(a.y-b.y)<EPS,normal=horizontal?{x:0,y:sign}:{x:sign,y:0};
  const aa=add(a,normal,ctx.step),bb=add(b,normal,ctx.step),middle={x:(aa.x+bb.x)/2,y:(aa.y+bb.y)/2};
  if(ctx.guide(aa,bb)&&![aa,middle,bb].some(q=>ctx.space.contains(add(q,normal,ctx.step)))){
   if(accept(result.map((q,j)=>j===i?aa:j===i+1?bb:q)))continue;
  }
  // A local obstruction may block only one end of a long boundary run.
  // Extend the free prefix and retain a grid-sized step around that obstruction.
  for(const reverse of [false,true]){
   const start=reverse?b:a,end=reverse?a:b,shift=add(start,normal,ctx.step),length=dist(start,end);
   if(length<3*ctx.step||!ctx.space.contains(shift)||ctx.space.contains(add(shift,normal,ctx.step)))continue;
   const dir={x:(end.x-start.x)/length,y:(end.y-start.y)/length};let cut=null;
   for(let d=ctx.step;d<=length-ctx.step+EPS;d+=ctx.step){const q=add(start,dir,d),sq=add(q,normal,ctx.step);if(!ctx.guide(shift,sq)||ctx.space.contains(add(sq,normal,ctx.step)))break;cut=q;}
   if(!cut||dist(start,cut)<2*ctx.o.radiusMm||dist(cut,end)<2*ctx.o.radiusMm)continue;
   const shiftedCut=add(cut,normal,ctx.step),part=reverse?[a,cut,shiftedCut,shift]:[shift,shiftedCut,cut,b];
   if(accept([...result.slice(0,i),...part,...result.slice(i+2)]))break;
  }
 }
 if(cache)cache.growBoundary.set(key,copy(result));
 return result;
}
function heatVariants(ctx,method,target,maxLength,localExpansion=true,cache){
 const key=cache?JSON.stringify([contextKey(cache,ctx),method,target,maxLength,localExpansion]):null;
 if(cache&&cache.heatVariants.has(key)){cache.stats.cacheHits++;return copy(cache.heatVariants.get(key));}
 if(cache)cache.stats.cacheMisses++;
 if(cache)cache.stats.heatVariantsCalls++;
 const variants=[],seen=new Set();
 const nodes=[...ctx.lattice.values()],limits={x:[Math.min(...nodes.map(q=>q.x)),Math.max(...nodes.map(q=>q.x))],y:[Math.min(...nodes.map(q=>q.y)),Math.max(...nodes.map(q=>q.y))]};
 for(const px of [0,1])for(const py of [0,1])for(const cw of [true,false]){
  const cycle=H.makeCycle(ctx,H.cellsFor(ctx,px,py),cw,method,!cw);if(!cycle)continue;
  if((cycle.length-1)*ctx.step-cycle.length*(2-Math.PI/2)*ctx.o.radiusMm>maxLength)continue;
  const entries=[];
  for(let i=0;i<cycle.length;i++){
   const a=cycle[i],b=cycle[(i+1)%cycle.length],h=a.y===b.y;
   for(const sign of [-1,1]){
    const normal=h?{x:0,y:sign}:{x:sign,y:0},da=add(a,normal,ctx.step),db=add(b,normal,ctx.step);
    if(ctx.space.contains(da)||ctx.space.contains(db))continue;
    entries.push({i,normal,score:dist(a,target)+dist(b,target)});
   }
  }
  entries.sort((a,b)=>a.score-b.score);
  for(const e of entries.slice(0,8))for(const reverse of [false,true]){
   if(variants.length>=32&&e.score>variants.map(v=>v.score).sort((a,b)=>a-b)[31])continue;
   let route=Geo.clean([...cycle.slice(e.i+1),...cycle.slice(0,e.i+1)].map(q=>({x:q.x,y:q.y})));if(reverse)route.reverse();
   let expanded=copy(route);
   for(const axis of ['x','y'])for(const edge of [0,1]){
    const extreme=(edge?Math.max:Math.min)(...expanded.map(q=>q[axis])),limit=limits[axis][edge];
    if(Math.abs(extreme-limit)<EPS||Math.abs(extreme-limit)>ctx.step+EPS)continue;
    const next=expanded.map(q=>({...q,[axis]:Math.abs(q[axis]-extreme)<EPS?limit:q[axis]}));
    if(next.slice(1).every((q,i)=>ctx.guide(next[i],q)))expanded=next;
   }
   for(const [r,penalty] of (localExpansion?[[growBoundary(ctx,expanded,cache),0],[expanded,ctx.step*4],[route,ctx.step*8]]:[[expanded,0],[route,ctx.step*4]])){
    const key=JSON.stringify(r);if(seen.has(key))continue;seen.add(key);
    let length;try{length=H.roundPath(r,ctx.o.radiusMm).reduce((sum,s)=>sum+s.lengthMm,0);}catch{continue;}
    if(length>maxLength)continue;
    variants.push({route:r,normal:e.normal,score:e.score+penalty,method,length});
   }
  }
 }
 const result=variants.sort((a,b)=>a.score-b.score).slice(0,32);
 if(cache)cache.heatVariants.set(key,copy(result));
 return result;
}
// Offset a common orthogonal spine so both leads choose the same passage.
function offsetPath(route,d,endDirection){
 const normal=(a,b)=>{const length=dist(a,b);return{x:-(b.y-a.y)/length,y:(b.x-a.x)/length};};
 return route.map((q,i)=>{
  const a=i?normal(route[i-1],q):null,b=i+1<route.length?normal(q,route[i+1]):endDirection?{x:-endDirection.y,y:endDirection.x}:null;
  const n=!a?b:!b?a:Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<EPS?a:{x:a.x+b.x,y:a.y+b.y};return add(q,n,d);
 });
}
function pairedRoute(p,v,ports,boxes,all,depth,R,deadline,diagnostics,workBudget,routingCache,occupiedSegments=[],finalizePaths=paths=>paths){
 const fail=reason=>{if(diagnostics)diagnostics[reason]=(diagnostics[reason]||0)+1;return null;};
 if(ports.fanAtCollector){
  const pitch=dist(ports.supply,ports.returnPoint),width=dist(v.route[0],v.route.at(-1));
  if(Math.abs(width-p.grid.cellSizeMm)>EPS||width-pitch<2*R-EPS)return fail('PAIR_COLLECTOR_FAN');
  const tangent={x:(ports.returnPoint.x-ports.supply.x)/pitch,y:(ports.returnPoint.y-ports.supply.y)/pitch},wideReturn=add(ports.supply,tangent,width);
  let collectorFanRejected=false;
  const addCollectorFan=paths=>{
   const ret=paths.return.slice(),fanDepth=Math.ceil(R);
   if(dist(ret.at(-2),wideReturn)<2*R+fanDepth-EPS){collectorFanRejected=true;return null;}
   ret.pop();ret.push(add(wideReturn,ports.normal,fanDepth),add(ports.returnPoint,ports.normal,fanDepth),ports.returnPoint);
   return finalizePaths({supply:paths.supply,return:cleanTransit(ret)});
  };
  const paths=pairedRoute(p,v,{...ports,fanAtCollector:false,returnPoint:wideReturn},boxes,all,depth,R,deadline,diagnostics,workBudget,routingCache,occupiedSegments,addCollectorFan);if(!paths)return collectorFanRejected?fail('PAIR_COLLECTOR_FAN_RETURN'):null;
  return paths;
 }
 const heatingEnds=[v.route[0],v.route.at(-1)],h=dist(ports.supply,ports.returnPoint)/2,width=dist(...heatingEnds),fan=width-2*h;
 if(fan<-EPS||fan>EPS&&fan<2*R-EPS)return fail('PAIR_END_WIDTH');
 const tangent={x:(heatingEnds[1].x-heatingEnds[0].x)/width,y:(heatingEnds[1].y-heatingEnds[0].y)/width};
 const ends=fan>EPS?[add(heatingEnds[0],v.normal,4*R),add(add(heatingEnds[0],tangent,2*h),v.normal,4*R)]:heatingEnds;
 const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2}),a=mid(ports.supply,ports.returnPoint),b=mid(...ends);
 const startN={x:-ports.normal.y,y:ports.normal.x},endN={x:v.normal.y,y:-v.normal.x};
 const side=(ports.supply.x-a.x)*startN.x+(ports.supply.y-a.y)*startN.y;
 if(dist(add(b,endN,side),ends[0])>EPS)return fail('PAIR_COMMON_AXIS');
 const margin=h+p.pipe.diameterMm/2+1,spaceKey=String(margin);let space=routingCache?.get(spaceKey);if(!space){space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm:margin,pipeDiameterMm:p.pipe.diameterMm});routingCache?.set(spaceKey,space);}
 const inflated=boxes.map(r=>({x:r.x-h,y:r.y-h,width:r.width+2*h,height:r.height+2*h}));
 const spineStart=add(a,ports.normal,depth),stubSupplyEnd=add(spineStart,startN,side),stubReturnEnd=add(spineStart,startN,-side);
 const supplyStub=H.roundPath([ports.supply,stubSupplyEnd],R),returnStub=H.roundPath([ports.returnPoint,stubReturnEnd],R);
 const stubGeometry=[...occupiedSegments,...supplyStub,...returnStub];
 const stubGroups=[...occupiedSegments.map(()=>0),...supplyStub.map(()=>1),...returnStub.map(()=>2)];
 if(H.intersections(stubGeometry,p.grid.cellSizeMm,stubGroups))return fail('PAIR_COLLECTOR_STUB');
 const makePaths=lead=>{
  const spine=cleanTransit([a,...lead,b]),endDirection={x:-v.normal.x,y:-v.normal.y},supply=offsetPath(spine,side,endDirection),ret=offsetPath(spine,-side,endDirection).reverse();
  if(fan>EPS){supply.push(heatingEnds[0]);ret.unshift(heatingEnds[1],add(heatingEnds[1],v.normal,2*R),add(add(heatingEnds[0],tangent,2*h),v.normal,2*R));}
  return{supply:cleanTransit(supply),return:cleanTransit(ret)};
 };
 const radiusFits=paths=>{
  if(!paths)return true;
  const joined=[...paths.supply,...v.route.slice(1),...paths.return.slice(1)];
  try{H.roundPath(joined,R);return true;}catch(e){if(e?.message==='RADIUS_DOES_NOT_FIT'){fail('ASTAR_RADIUS_REJECT');return false;}return true;}
 };
 let lead=null;
 for(const endDepth of [depth,depth+2*R,depth+p.grid.cellSizeMm,0]){
  lead=Router.route(add(a,ports.normal,depth),add(b,v.normal,endDepth),{space,p},inflated,all,{radiusMm:R+h,startNormal:ports.normal,endNormal:{x:-v.normal.x,y:-v.normal.y},clearanceMm:margin,softBoxes:ports.softBoxes,deadline,workBudget,goalFilter:path=>radiusFits(finalizePaths(makePaths(path)))});
  if(lead)break;
 }
 if(!lead)return fail('PAIR_NO_SPINE');
 const result=finalizePaths(makePaths(lead));
 if(!result&&ports.fanAtCollector)return fail('PAIR_COLLECTOR_FAN_RETURN');
 return result;
}
function ribbonBoxes(supply,ret,pad){
 const polygon=[...supply,...ret],edges=Geo.segments([...polygon,polygon[0]]),ys=[...new Set(polygon.map(q=>q.y))].sort((a,b)=>a-b),out=[];
 for(let i=1;i<ys.length;i++){
  const y=(ys[i-1]+ys[i])/2,xs=edges.filter(([a,b])=>a.x===b.x&&y>Math.min(a.y,b.y)&&y<Math.max(a.y,b.y)).map(([a])=>a.x).sort((a,b)=>a-b);
  for(let j=1;j<xs.length;j+=2)if(xs[j]>xs[j-1]+EPS)out.push({x:xs[j-1],y:ys[i-1],width:xs[j]-xs[j-1],height:ys[i]-ys[i-1]});
 }
 for(const [a,b] of edges)out.push({x:Math.min(a.x,b.x)-pad,y:Math.min(a.y,b.y)-pad,width:Math.abs(a.x-b.x)+2*pad,height:Math.abs(a.y-b.y)+2*pad});
 return Geo.decomposition(out);
}
// Start with the room's actual changes of width, then divide long cells by
// pipe capacity. This avoids a combinatorial cut search for the first layout.
function naturalPartitions(p,wallOffset,maxLength,axis,reserveRatio=.875,collectorWall=null){
 const space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm:0,pipeDiameterMm:0}),step=p.grid.cellSizeMm,out=[];
 for(const r of Geo.decomposition(space.raw,axis)){
  const length=Math.max(0,r.width-2*wallOffset)*Math.max(0,r.height-2*wallOffset)/step;
  const count=Math.max(1,Math.ceil(length/(maxLength*reserveRatio)));
  if(count+out.length>24)return null;
  const dimension=r.width>r.height?'width':'height',coordinate=dimension==='width'?'x':'y',origin=p.grid.origin[coordinate],cuts=[r[coordinate]];
  for(let i=1;i<count;i++){
   let cut=origin+Math.round((r[coordinate]+r[dimension]*i/count-origin)/step)*step;
   // Keep access to a branch before the collector wall ends. A cut directly
   // at its mouth would push the first heating row behind that wall.
   const normal=collectorWall?.normal[coordinate]||0,anchor=p.collector.supply[coordinate],clearance=wallOffset+step;
   if(normal&&Math.abs(cut-anchor)<clearance-EPS)cut=origin+Math.round((anchor+normal*clearance-origin)/step)*step;
   cuts.push(cut);
  }
  cuts.push(r[coordinate]+r[dimension]);
  for(let i=1;i<cuts.length;i++){
   if(cuts[i]-cuts[i-1]<=2*wallOffset+step)return null;
   out.push({...r,[coordinate]:cuts[i-1],[dimension]:cuts[i]-cuts[i-1]});
  }
 }
 return out;
}
function connect(p,def,ctx,settings,ports,otherBoxes,occupied,deadline,stats,generationCache,candidateIndex=0,searchMetrics,workBudget){
 const R=settings.radiusMm,D=p.pipe.diameterMm,space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm:D/2+1,pipeDiameterMm:D});
 const all=[...occupied.flatMap(c=>[...Geo.segments(c.supplyTransit.route),...Geo.segments(c.returnTransit.route)]),...(ports.reserved||[])];
 const occupiedSegments=occupied.flatMap(c=>c.segments);
 const reject=why=>{stats[why]=(stats[why]||0)+1;};
 let acceptedIndex=0;
 const takeCandidate=r=>{reject('ACCEPTED_CIRCUIT');if(searchMetrics)searchMetrics.acceptedCandidates++;const selected=acceptedIndex++===candidateIndex;if(selected&&candidateIndex>0&&searchMetrics)searchMetrics.alternativesTried++;return selected?r:null;};
 const vars=(settings.method==='auto'?['spiral','double-snake']:[settings.method]).flatMap(method=>heatVariants(ctx,method,ports.supply,settings.maxCircuitLengthMm,ports.expandBoundary??ports.ribbon,generationCache));
 for(const v of vars){
  if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
  const ends=[v.route[0],v.route.at(-1)];
  // An eroded zone may retain a narrow neck that contains no grid nodes.
  // Such a neck is an access passage, not an already occupied heating area.
  const left=Math.min(...v.route.map(q=>q.x)),right=Math.max(...v.route.map(q=>q.x)),top=Math.min(...v.route.map(q=>q.y)),bottom=Math.max(...v.route.map(q=>q.y));
  const ownBoxes=ports.ribbon||ports.expandBoundary?ports.ownBoxes.map(r=>{const x=Math.max(left,r.x),y=Math.max(top,r.y);return{x,y,width:Math.min(right,r.x+r.width)-x,height:Math.min(bottom,r.y+r.height)-y};}).filter(r=>r.width>EPS&&r.height>EPS):ports.ownBoxes;
  const boxes=[...otherBoxes,...ownBoxes];
  // Euclidean distance is a lower bound even after rounding the lead bends.
  if(v.length+dist(ends[0],ports.supply)+dist(ends[1],ports.returnPoint)-4*R>settings.maxCircuitLengthMm){reject('LENGTH_BOUND');continue;}
  for(const depth of ports.ribbon?(dist(ports.supply,ports.returnPoint)<p.grid.cellSizeMm-EPS?[R+p.grid.cellSizeMm/2+24,p.grid.cellSizeMm,2*(R+p.grid.cellSizeMm/2),3*(R+p.grid.cellSizeMm/2),R+dist(ports.supply,ports.returnPoint)/2+16,2*R]:[R+p.grid.cellSizeMm/2+24,p.grid.cellSizeMm,2*(R+p.grid.cellSizeMm/2),3*(R+p.grid.cellSizeMm/2)]):[R*2,R*3]){
   if(ports.ribbon){
    const paths=pairedRoute(p,v,ports,boxes,all,depth,R,deadline,stats,workBudget,generationCache.routingSpaces,occupiedSegments);if(!paths){reject('PAIRED_PATH');continue;}
    const r=C.fromPaths(M.zoneProject(p,def),settings,{...paths,heating:v.route},v.method,{transitProject:p,occupied:occupied.flatMap(c=>c.segments)});
    if(!r.ok){reject(r.reason);continue;}if(r.overLength){reject('OVER_LENGTH');continue;}const selected=takeCandidate(r);if(selected)return selected;
   }
   const stubs=ends.map(e=>add(e,v.normal,depth));
   if(stubs.some(q=>!space.contains(q)||boxes.some(r=>q.x>=r.x-EPS&&q.x<=r.x+r.width+EPS&&q.y>=r.y-EPS&&q.y<=r.y+r.height+EPS)))continue;
   for(const entryDepth of [R*2,R*3]){
    const inner=[add(ports.supply,ports.normal,entryDepth),add(ports.returnPoint,ports.normal,entryDepth)];
    if(inner.some(q=>!space.contains(q)))continue;
    const first=ports.reverseFirst?1:0,second=1-first,points=[ports.supply,ports.returnPoint],paths=[];
    const opts={radiusMm:R,startNormal:ports.normal,endNormal:{x:-v.normal.x,y:-v.normal.y},softBoxes:ports.softBoxes,deadline,workBudget};
    const lead=Router.route(inner[first],stubs[first],{space,p},boxes,[...all,[points[second],inner[second]]],opts);if(!lead){reject('SUPPLY_PATH');continue;}
    paths[first]=Geo.clean([points[first],...lead,ends[first]]);
    const tail=Router.route(inner[second],stubs[second],{space,p},boxes,[...all,...Geo.segments(paths[first])],opts);if(!tail){reject('RETURN_PATH');continue;}
    paths[second]=Geo.clean([points[second],...tail,ends[second]]);
    const supply=paths[0],ret=paths[1].reverse();
    const r=C.fromPaths(M.zoneProject(p,def),settings,{supply,heating:v.route,return:ret},v.method,{transitProject:p,occupied:occupied.flatMap(c=>c.segments)});
    if(!r.ok){reject(r.reason);continue;}if(r.overLength){reject('OVER_LENGTH');continue;}const selected=takeCandidate(r);if(selected)return selected;
   }
  }
 }
 // Separate leads can make staggered bends in a passage where a rigid pair
 // cannot turn. Preserve the selected heating geometry and all final checks.
 if(ports.ribbon&&ports.allowSeparate&&Date.now()<deadline){
  const r=connect(p,def,ctx,settings,{...ports,ribbon:false,expandBoundary:true,allowSeparate:false},otherBoxes,occupied,deadline,stats,generationCache,candidateIndex,searchMetrics,workBudget);
  if(r){ports.usedSeparate=true;return r;}
 }
 reject('TRANSIT_NOT_FOUND');return null;
}
function attemptOnce(p,zones,settings,paired,b,variant,deadline,stats,generationCache,choiceOffsets,trace,searchMetrics,searchStates,workBudget){
 const fanAtCollector=variant>=128;variant%=128;
 const nearFirst=variant>=64;variant%=64;
 const angular=variant>=32;variant%=32;
 const ribbon=variant>=16;variant%=16;const reserveHeader=variant>=8;variant%=8;const reserveTransit=variant>=4;variant%=4;
 const ports=bank(p,zones.length,settings.radiusMm,paired,b,ribbon);if(!ports)return null;
 let zs=zones.slice().sort((a,c)=>{const aa={x:a.x+a.width/2,y:a.y+a.height/2},cc={x:c.x+c.width/2,y:c.y+c.height/2};return variant<2?(b.h?aa.x-cc.x:aa.y-cc.y):dist(aa,p.collector.supply)-dist(cc,p.collector.supply);});
 if(angular){const angle=z=>{const dx=z.x+z.width/2-p.collector.supply.x,dy=z.y+z.height/2-p.collector.supply.y;return Math.atan2(b.h?dx:dy,dx*b.normal.x+dy*b.normal.y);};zs.sort((a,c)=>angle(a)-angle(c));}
 if(variant%2)zs.reverse();
 const defs=zs.map((zone,i)=>({id:'auto-'+(i+1),name:'Контур '+(i+1),zone,heatingRemoved:[],automatic:true,supply:ports[i].supply,returnPoint:ports[i].returnPoint}));
 const depth=Math.max(0,p.grid.cellSizeMm+2*settings.radiusMm-settings.wallOffsetMm);
 const header=b.h?{x:b.lo,y:b.wall+(b.normal.y<0?-depth:0),width:b.hi-b.lo,height:depth}:{x:b.wall+(b.normal.x<0?-depth:0),y:b.lo,width:depth,height:b.hi-b.lo};
 const clip=(r,z)=>{const x=Math.max(r.x,z.x),y=Math.max(r.y,z.y);return{x,y,width:Math.min(r.x+r.width,z.x+z.width)-x,height:Math.min(r.y+r.height,z.y+z.height)-y};};
 if(reserveHeader)for(const d of defs){const r=clip(header,d.zone);if(r.width>EPS&&r.height>EPS)d.heatingRemoved=[r];}
 const contexts=defs.map(d=>H.prepare(M.zoneProject(p,d),settings));if(contexts.some(c=>!H.connected(c)))return null;
 const boxFor=c=>ribbon?c.space.rects.map(r=>({...r})):c.space.rects.map(r=>{const s=p.grid.cellSizeMm,o=p.grid.origin,x=o.x+Math.ceil((r.x-o.x)/s)*s,y=o.y+Math.ceil((r.y-o.y)/s)*s,right=o.x+Math.floor((r.x+r.width-o.x)/s)*s,bottom=o.y+Math.floor((r.y+r.height-o.y)/s)*s;return{x,y,width:right-x,height:bottom-y};}).filter(r=>r.width>0&&r.height>0);
 const finishedBoxes=[],reservations=reserveHeader?[header]:[];
 const containsCollector=z=>p.collector.supply.x>=z.x-EPS&&p.collector.supply.x<=z.x+z.width+EPS&&p.collector.supply.y>=z.y-EPS&&p.collector.supply.y<=z.y+z.height+EPS;
 const order=defs.map((d,i)=>({i,d,distance:dist({x:d.zone.x+d.zone.width/2,y:d.zone.y+d.zone.height/2},p.collector.supply)})).sort((a,c)=>nearFirst?(Number(containsCollector(a.d.zone))-Number(containsCollector(c.d.zone))||a.distance-c.distance):c.distance-a.distance);
 const results=new Array(zones.length),occupied=[];
 for(let depthIndex=0;depthIndex<order.length;depthIndex++){
  const {i,d}=order[depthIndex];
  if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
  if(reserveTransit&&reservations.length){
   d.heatingRemoved=reservations.map(r=>{const z=d.zone,x=Math.max(r.x,z.x),y=Math.max(r.y,z.y);return{x,y,width:Math.min(r.x+r.width,z.x+z.width)-x,height:Math.min(r.y+r.height,z.y+z.height)-y};}).filter(r=>r.width>EPS&&r.height>EPS);
   contexts[i]=H.prepare(M.zoneProject(p,d),settings);
   // A transit corridor can isolate a pocket too small for a mounting-grid
   // node. It needs no separate heating loop; full-room coverage, including
   // the transits serving it, is still checked before accepting the result.
   const raw=contexts[i].space.raw,seen=new Set(),empty=[];
   for(let k=0;k<raw.length;k++)if(!seen.has(k)){
    const group=[k];seen.add(k);
    for(let j=0;j<group.length;j++)for(let m=0;m<raw.length;m++)if(!seen.has(m)){
     const a=raw[group[j]],c=raw[m],dx=Math.min(a.x+a.width,c.x+c.width)-Math.max(a.x,c.x),dy=Math.min(a.y+a.height,c.y+c.height)-Math.max(a.y,c.y);
     if(dx>=-EPS&&dy>=-EPS&&(dx>EPS||dy>EPS)){seen.add(m);group.push(m);}
    }
    if(!group.some(j=>[...contexts[i].lattice.values()].some(q=>{const r=raw[j];return q.x>=r.x-EPS&&q.x<=r.x+r.width+EPS&&q.y>=r.y-EPS&&q.y<=r.y+r.height+EPS;})))empty.push(...group.map(j=>raw[j]));
   }
   if(empty.length){d.heatingRemoved.push(...empty);contexts[i]=H.prepare(M.zoneProject(p,d),settings);}
   if(!H.connected(contexts[i])){stats.DISCONNECTED_AFTER_TRANSIT=(stats.DISCONNECTED_AFTER_TRANSIT||0)+1;trace.failureDepth=depthIndex;return null;}
  }
  const port={...ports[i],ribbon,fanAtCollector,allowSeparate:!paired,ownBoxes:boxFor(contexts[i]),reverseFirst:reserveTransit,softBoxes:reserveTransit?contexts.filter((c,j)=>j!==i&&!results[j]).flatMap(boxFor):[],reserved:ports.flatMap((a,j)=>{
   if(j===i||results[j])return[];
   const points=[a.supply,a.returnPoint];if(fanAtCollector)points.push(b.h?{x:a.supply.x+p.grid.cellSizeMm,y:b.wall}:{x:b.wall,y:a.supply.y+p.grid.cellSizeMm});
   return points.map(q=>[q,add(q,a.normal,ribbon?2*settings.radiusMm+1.5*p.grid.cellSizeMm:settings.radiusMm*3)]);
  })};
  const plan=connect(p,d,contexts[i],settings,port,reserveTransit?finishedBoxes:contexts.filter((c,j)=>j!==i).flatMap(boxFor),occupied,deadline,stats,generationCache,choiceOffsets[depthIndex]||0,searchMetrics,workBudget);if(!plan){trace.failureDepth=depthIndex;return null;}
  results[i]={id:d.id,plan};occupied.push(plan.circuits[0]);
  trace.completedDepths.push(depthIndex);searchMetrics.maxDepth=Math.max(searchMetrics.maxDepth,trace.completedDepths.length);
  const prefix=trace.completedDepths.map(depth=>{const zone=order[depth].i;return results[zone]?.plan?.circuits?.[0]?.segments||null;});
  searchStates.add(JSON.stringify([zones,settings,b,variant,choiceOffsets,prefix]));searchMetrics.uniqueSearchStates=searchStates.size;
  finishedBoxes.push(...boxFor(contexts[i]));
  const circuit=plan.circuits[0],pad=p.pipe.diameterMm/2;
  if(ribbon&&!port.usedSeparate){
   const a=circuit.supplyTransit.route,c=circuit.returnTransit.route.slice().reverse();
   if(paired)reservations.push(...ribbonBoxes(a,circuit.returnTransit.route,pad));
   else for(let k=1;k<a.length;k++){const ps=[a[k-1],a[k],c[k-1],c[k]],x=Math.min(...ps.map(q=>q.x))-pad,y=Math.min(...ps.map(q=>q.y))-pad;reservations.push({x,y,width:Math.max(...ps.map(q=>q.x))+pad-x,height:Math.max(...ps.map(q=>q.y))+pad-y});}
  }else for(const part of [circuit.supplyTransit,circuit.returnTransit])for(const [a,c] of Geo.segments(part.route))reservations.push({x:Math.min(a.x,c.x)-pad,y:Math.min(a.y,c.y)-pad,width:Math.abs(a.x-c.x)+2*pad,height:Math.abs(a.y-c.y)+2*pad});
 }
 const multi=M.compose(p,settings,defs,results),coverage=V.coverage(p,settings,multi.circuits);if(!coverage.ok){stats.COVERAGE=(stats.COVERAGE||0)+1;stats.lastGaps=coverage.gaps;trace.failureDepth=order.length;return null;}
 return{multi,coverage,settings};
}
function attempt(p,zones,settings,paired,b,variant,deadline,stats,generationCache,searchMetrics={backtrackEvents:0,returnDepths:[],alternativesTried:0,uniqueSearchStates:0,acceptedCandidates:0,maxDepth:0},searchStates=new Set(),workBudget){
 const maxBacktracksPerAttempt=4,queue=[],queued=new Set();let choices={};
 const run=selectedChoices=>{const trace={completedDepths:[],failureDepth:null};const result=attemptOnce(p,zones,settings,paired,b,variant,deadline,stats,generationCache,selectedChoices,trace,searchMetrics,searchStates,workBudget);return{result,trace,choices:selectedChoices};};
 const enqueueAlternatives=state=>{
  for(const depth of [...state.trace.completedDepths].reverse()){
   if((state.choices[depth]||0)>=1)continue;
   const next={};for(const [key,value] of Object.entries(state.choices))if(Number(key)<depth)next[key]=value;
   next[depth]=(state.choices[depth]||0)+1;
   const key=JSON.stringify(Object.entries(next).sort((a,c)=>Number(a[0])-Number(c[0])));
   if(!queued.has(key)){queued.add(key);queue.push({choices:next,depth});}
  }
 };
 let state=run(choices);if(state.result)return state.result;enqueueAlternatives(state);
 let events=0;
 while(queue.length&&events<maxBacktracksPerAttempt&&searchMetrics.backtrackEvents<4&&Date.now()<=deadline){
  const branch=queue.shift(),key=JSON.stringify(Object.entries(branch.choices).sort((a,c)=>Number(a[0])-Number(c[0])));
  if(key===JSON.stringify(Object.entries(choices).sort((a,c)=>Number(a[0])-Number(c[0]))))continue;
  choices=branch.choices;events++;searchMetrics.backtrackEvents++;searchMetrics.returnDepths.push(branch.depth+1);
  state=run(choices);if(state.result)return state.result;enqueueAlternatives(state);
 }
 return null;
}
function plan(p,options,partitioner,progress=()=>{}){
 const started=Date.now(),diagnostic=options.diagnosticWorkBudget||null,workBudget=diagnostic?{limit:diagnostic.limit,consumed:0,emergencyDeadline:started+(diagnostic.emergencyWallClockMs??180000)}:null,deadline=diagnostic?workBudget.emergencyDeadline:started+(options.timeBudgetMs??30000),stats={},generationStats={cacheHits:0,cacheMisses:0,growBoundaryCalls:0,heatVariantsCalls:0},backtracking={backtrackEvents:0,returnDepths:[],alternativesTried:0,uniqueSearchStates:0,acceptedCandidates:0,maxDepth:0},searchStates=new Set(),search={planner:'topology',attempts:0,rejections:stats,countsTried:[],globallyOptimal:false,generationCache:generationStats,backtracking,...(workBudget?{workBudget:{unit:'astar-state-pop',limit:workBudget.limit,consumed:0}}:{})};
 const syncWorkBudget=()=>{if(workBudget)search.workBudget.consumed=workBudget.consumed;};
 try{
  p=G.createProject(p);
  const generationCache={heatVariants:new Map(),growBoundary:new Map(),routingSpaces:new Map(),stats:generationStats,contextKeys:new WeakMap()};
  const step=p.grid.cellSizeMm,maxLength=options.maxCircuitLengthMm??80000,wallOffsetMm=options.wallOffsetMm??100;
  if(!Number.isFinite(maxLength)||maxLength<=0)throw new Error('INVALID_MAX_LENGTH');
  if(!Number.isFinite(wallOffsetMm)||wallOffsetMm<0)throw new Error('INVALID_OFFSET');
  const space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm,pipeDiameterMm:0});
  const forecast=Math.max(1,Math.ceil(space.rects.reduce((s,r)=>s+r.width*r.height,0)/step/maxLength)),walls=boundary(p);if(!walls.length)throw new Error('COLLECTOR_WALL_NOT_FOUND');
  const finish=(r,b)=>{syncWorkBudget();return{ok:true,status:'AUTO_OK',planner:'grid-auto',...r,maxCircuitLengthMm:maxLength,pairedLeads:options.pairedLeads===true,search:{...search,elapsedMs:Date.now()-started},collectorProposal:{anchor:copy(p.collector.supply),side:b.normal.y>0?'top':b.normal.y<0?'bottom':b.normal.x>0?'left':'right',ports:r.multi.definitions.map(d=>({id:d.id,supply:d.supply,returnPoint:d.returnPoint}))}};};
  const preferredAxis=walls[0].h?'vertical':'horizontal',naturalSeen=new Set();
  for(const [axis,ratio,access] of [[preferredAxis,.875,true],[preferredAxis,.875,false],[preferredAxis==='vertical'?'horizontal':'vertical',.875,true],[preferredAxis,.75,true]]){
   const zones=naturalPartitions(p,wallOffsetMm,maxLength,axis,ratio,access?walls[0]:null),key=JSON.stringify(zones);if(!zones||naturalSeen.has(key))continue;naturalSeen.add(key);
   if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
   if(!search.countsTried.includes(zones.length))search.countsTried.push(zones.length);
   const settings={radiusMm:step/3,spacingCells:1,wallOffsetMm,method:options.method||'auto',maxCircuitLengthMm:maxLength};
   progress({count:zones.length,planner:'topology'});
   const baseMode=zones.length>5?124:60,naturalModes=options.pairedLeads?[baseMode+128,124]:[baseMode];
   for(const b of walls)for(const [modeIndex,mode] of naturalModes.entries()){
    search.attempts++;
    try{
     const attemptDeadline=diagnostic?deadline:Math.min(deadline,Date.now()+(naturalSeen.size===1&&modeIndex===0?30000:7000));
     const r=attempt(p,zones,settings,options.pairedLeads===true,b,mode,attemptDeadline,stats,generationCache,backtracking,searchStates,workBudget);
     if(r)return finish(r,b);
    }catch(e){if(workBudget&&e.message==='DIAGNOSTIC_WORK_BUDGET')throw e;if(workBudget&&e.message==='DIAGNOSTIC_WALL_GUARD')throw e;stats[e.message]=(stats[e.message]||0)+1;}
   }
  }
  const counts=[...new Set([forecast,forecast+1,Math.max(1,forecast-1),forecast+2,forecast+3])],groups=[];
  for(const n of counts){
   if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
   try{groups.push({n,partitions:partitioner(p,n,18,diagnostic?deadline:Math.min(deadline,Date.now()+1200),true)});}catch(e){if(workBudget&&e.message==='DIAGNOSTIC_WORK_BUDGET')throw e;if(workBudget&&e.message==='DIAGNOSTIC_WALL_GUARD')throw e;stats.PARTITION_LIMIT=(stats.PARTITION_LIMIT||0)+1;}
  }
  // Interleave counts, radii and lead strategies; bound each attempt separately.
  const bb=bounds(p.room.sections),anchor=p.collector.supply,inner=anchor.x>bb.x+EPS&&anchor.x<bb.x+bb.width-EPS&&anchor.y>bb.y+EPS&&anchor.y<bb.y+bb.height-EPS;
  const modes=options.pairedLeads?[0,8,1,12]:inner?[0,28,8,29]:[28,0,29,8];
  const passes=modes.flatMap(variant=>[{ratio:1/3,variant},{ratio:.25,variant}]);
  const batchSize=inner?1:8;
  for(let batch=0;batch<Math.ceil(18/batchSize);batch++)for(const pass of passes)for(const group of groups)for(let index=batch*batchSize;index<Math.min(18,batch*batchSize+batchSize);index++){
   const partition=group.partitions[index];if(!partition)continue;
   if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
   if(!search.countsTried.includes(group.n))search.countsTried.push(group.n);
   progress({count:group.n,planner:'topology'});
   const settings={radiusMm:step*pass.ratio,spacingCells:1,wallOffsetMm,method:options.method||'auto',maxCircuitLengthMm:maxLength};
   for(const b of walls){
    search.attempts++;let r;
    try{r=attempt(p,partition.zones,settings,options.pairedLeads===true,b,pass.variant,diagnostic?deadline:Math.min(deadline,Date.now()+5000),stats,generationCache,backtracking,searchStates,workBudget);}catch(e){if(workBudget&&(e.message==='DIAGNOSTIC_WORK_BUDGET'||e.message==='DIAGNOSTIC_WALL_GUARD'))throw e;stats[e.message]=(stats[e.message]||0)+1;if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');continue;}
    if(!r)continue;
    return finish(r,b);
   }
  }
  throw new Error('NO_VERIFIED_LAYOUT');
 }catch(e){syncWorkBudget();const reason=workBudget&&e.message==='SEARCH_LIMIT'?'DIAGNOSTIC_WALL_GUARD':e.message;return{ok:false,status:'AUTO_NOT_FOUND',reason,circuits:[],search:{...search,elapsedMs:Date.now()-started}};}
}
return{plan,boundary,heatVariants,attempt};
});

















