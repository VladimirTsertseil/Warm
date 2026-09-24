/* Pure editing operations. WarmEngine.validate is the only acceptance gate. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine-unified.js'));else root.WarmEditorCore=factory(root.WarmEngine);})(globalThis,function(E){
'use strict';
const copy=v=>structuredClone(v),dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),same=(a,b)=>dist(a,b)<1e-6;
const labels={H1_freeSpace:'Труба за границей отступа',H2_obstacles:'Труба в препятствии',H3_crossings:'Пересечение или касание труб',H4_bendRadius:'Слишком тесный поворот',H5_continuity:'Подключите подачу и обратку',H6_circuitLimit:'Превышена длина контура',H7_movementJoints:'Пересечение шва без защиты'};
function projection(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return{x:a.x+t*dx,y:a.y+t*dy};}
function edgeKey(a,b){return [a,b].map(p=>`${p.x},${p.y}`).sort().join('|');}
function locksPreserved(plan,locks=[]){return locks.every(l=>{const c=plan.circuits.find(c=>c.id===l.circuit);return c&&E.segments(c.route).some(([a,b])=>edgeKey(a,b)===l.edge);});}
function updated(plan,ci,route){const p=copy(plan),c=p.circuits[ci];c.route=copy(route);c.length=E.length(route);c.core=copy(route);c.coreLength=c.length;p.totalLength=p.circuits.reduce((s,c)=>s+E.length(c.route),0);p.manual=true;return p;}
function nearest(plan,p,tolerance){const hits=[];plan.circuits.forEach((c,ci)=>E.segments(c.route).forEach(([a,b],seg)=>{const at=projection(p,a,b),distance=dist(p,at);if(distance<=tolerance)hits.push({circuit:ci,seg,at,distance});}));return hits.sort((a,b)=>a.distance-b.distance||a.circuit-b.circuit||a.seg-b.seg);}
function prepareCut(plan,ci,first,second,locks=[]){
 const c=plan.circuits[ci],r=c?.route;if(!c||!first||!second||first.circuit!==ci||second.circuit!==ci)return{ok:false,message:'Выберите две точки одного контура'};
 const ss=E.segments(r),prefix=[0];for(const [a,b] of ss)prefix.push(prefix.at(-1)+dist(a,b));
 const pos=h=>prefix[h.seg]+dist(r[h.seg],h.at),aPos=pos(first),bPos=pos(second),lo=Math.min(aPos,bPos),hi=Math.max(aPos,bPos);
 if(hi-lo<1)return{ok:false,message:'Выберите две разные точки трубы'};
 const locked=new Set(locks.filter(l=>l.circuit===c.id).map(l=>l.edge));
 for(let i=0;i<ss.length;i++)if(locked.has(edgeKey(...ss[i]))&&Math.min(prefix[i+1],hi)-Math.max(prefix[i],lo)>1e-6)return{ok:false,message:'В выбранном участке есть закреплённая труба'};
 const marks=[{label:'a',p:copy(first.at),pos:aPos},{label:'b',p:copy(second.at),pos:bPos}],entries=r.map((p,i)=>({p:copy(p),pos:prefix[i]})).concat(marks).sort((x,y)=>x.pos-y.pos||(x.label?1:0)-(y.label?1:0));
 const route=[],where={};
 for(const e of entries){if(!route.length||!same(route.at(-1),e.p))route.push(copy(e.p));if(e.label)where[e.label]=route.length-1;}
 const start=Math.min(where.a,where.b),end=Math.max(where.a,where.b),p=updated(plan,ci,route);
 return{ok:true,plan:p,circuit:ci,start,end,a:copy(route[start]),b:copy(route[end])};
}
function moveSegment(plan,selection,delta,locks=[]){
 const {circuit:ci,seg}=selection,c=plan.circuits[ci],r=copy(c.route),a=r[seg],b=r[seg+1];
 if(!a||!b||seg===0||seg>=r.length-2)return{ok:false,message:'Подключения перемещаются вместе с коллектором'};
 const horizontal=Math.abs(a.y-b.y)<1e-6,vertical=Math.abs(a.x-b.x)<1e-6;
 if(!horizontal&&!vertical)return{ok:false,message:'Выберите прямой участок трубы'};
 if(!Number.isFinite(delta))return{ok:false,message:'Введите расстояние в миллиметрах'};
 const axis=horizontal?'y':'x';a[axis]+=delta;b[axis]+=delta;
 const p=updated(plan,ci,r);if(!locksPreserved(p,locks))return{ok:false,message:'Участок закреплён'};
 return{ok:true,plan:p};
}
function replace(plan,ci,start,end,path,locks=[]){
 const r=plan.circuits[ci]?.route;if(!r||start<0||end>=r.length||start>=end||!path?.length||!same(path[0],r[start])||!same(path.at(-1),r[end]))return{ok:false,message:'Отметьте две разные точки одного контура'};
 const p=updated(plan,ci,[...r.slice(0,start),...E.clean(path),...r.slice(end+1)]);
 if(!locksPreserved(p,locks))return{ok:false,message:'В выбранном участке есть закреплённая труба'};
 return{ok:true,plan:p};
}
function routeDistance(p,route){let best=Infinity;for(const [a,b] of E.segments(route))best=Math.min(best,dist(p,projection(p,a,b)));return best;}
function nearestFreePoint(p,space){let best=null;for(const r of space.rects){const pad=Math.min(2,Math.max(0,Math.min(r.width,r.height)/4)),q={x:Math.max(r.x+pad,Math.min(r.x+r.width-pad,p.x)),y:Math.max(r.y+pad,Math.min(r.y+r.height-pad,p.y))},d=dist(p,q);if(!best||d<best.distance)best={p:q,distance:d};}return best?.p||copy(p);}
function guidedReplace(input,plan,ci,start,end,guide=[],locks=[]){
 const r=plan.circuits[ci]?.route;if(!r||start<0||end>=r.length||start>=end)return{ok:false,message:'Отметьте две разные точки одного контура'};
 const n=E.normalize(input),space=E.freeSpace(n),a=r[start],b=r[end],occupied=[],clear=n.pipeDiameterMm*1.5+1;
 plan.circuits.forEach((c,cj)=>E.segments(c.route).forEach(([u,v],i)=>{
  if(cj===ci&&i>=start&&i<end)return;
  let p=copy(u),q=copy(v);
  if(cj===ci&&i===start-1){const d=dist(p,q);if(d<=clear)return;q={x:q.x+(p.x-q.x)*clear/d,y:q.y+(p.y-q.y)*clear/d};}
  if(cj===ci&&i===end){const d=dist(p,q);if(d<=clear)return;p={x:p.x+(q.x-p.x)*clear/d,y:p.y+(q.y-p.y)*clear/d};}
  occupied.push([p,q]);
 }));
 const candidates=[];
 const addCandidate=path=>{
  path=E.clean(path);if(path.length<2||!same(path[0],a)||!same(path.at(-1),b))return;
  const result=replace(plan,ci,start,end,path,locks);if(!result.ok||!E.validate(input,result.plan).ok)return;
  const g=guide?.length?guide:[a,b],guideCost=g.reduce((sum,p)=>sum+routeDistance(p,path),0)/Math.max(1,g.length);
  const turns=Math.max(0,path.length-2),score=guideCost*6+E.length(path)*.025+turns*n.minBendRadiusMm*.12;
  candidates.push({...result,path,score});
 };
 // A user's magnetic preview is accepted unchanged whenever it already satisfies
 // every engineering gate. Otherwise it becomes a guide for the router below.
 if(guide?.length){let raw=guide.map(copy);if(!same(raw[0],a))raw.unshift(copy(a));if(!same(raw.at(-1),b))raw.push(copy(b));addCandidate(raw);}
 const snap=p=>nearestFreePoint({x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10},space);
 let internal=(guide||[]).map(snap).filter(p=>dist(p,a)>n.minBendRadiusMm*1.6&&dist(p,b)>n.minBendRadiusMm*1.6);
 // Keep the gesture shape, but do not turn every finger sample into a mandatory
 // router waypoint. Direction changes/extrema survive because the live editor
 // has already reduced the gesture to an orthogonal magnetic polyline.
 const compact=[];for(const p of internal)if(!compact.length||dist(compact.at(-1),p)>n.minBendRadiusMm*1.25)compact.push(p);internal=compact;
 if(internal.length>5){const sampled=[];for(let i=0;i<5;i++)sampled.push(internal[Math.round(i*(internal.length-1)/4)]);internal=sampled;}
 const sets=[],seen=new Set(),pushSet=xs=>{const key=JSON.stringify(xs);if(!seen.has(key)){seen.add(key);sets.push(xs);}};
 pushSet(internal);
 if(internal.length>2)pushSet(internal.filter((_,i)=>i%2===0));
 if(internal.length>1)pushSet([internal[0],internal.at(-1)]);
 if(internal.length)pushSet([internal[Math.floor(internal.length/2)]]);
 pushSet([]);
 const advance=(p,q,d)=>{const len=dist(p,q);return len?{x:p.x+(p.x-q.x)*d/len,y:p.y+(p.y-q.y)*d/len}:copy(p);};
 const pre=r[start-1]||null,post=r[end+1]||null;
 const stems=[Math.max(n.pitch,2*n.minBendRadiusMm),2*n.minBendRadiusMm,0].filter((v,i,a)=>!a.slice(0,i).some(x=>Math.abs(x-v)<1e-6));
 for(const stem of stems){
  const aa=stem&&pre?advance(a,pre,stem):a,bb=stem&&post?advance(b,post,stem):b;
  for(const waypoints of sets){
   const chain=[aa,...waypoints,bb],middle=[];let failed=false;
   for(let i=1;i<chain.length;i++){
    const piece=E.connector(chain[i-1],chain[i],space,[],occupied,n);if(!piece){failed=true;break;}
    if(!middle.length)middle.push(...piece);else middle.push(...piece.slice(1));
   }
   if(!failed)addCandidate(E.clean([a,...middle,b]));
  }
 }
 candidates.sort((x,y)=>x.score-y.score||E.length(x.path)-E.length(y.path));
 if(candidates.length)return candidates[0];
 const fallback=bypass(input,plan,ci,start,end,locks);if(fallback.ok)return fallback;
 return{ok:false,message:'Здесь не получается безопасно уложить трубу. Проведите пальцем немного дальше от стены или соседней трубы.'};
}
function inspect(input,plan){
 let hard,n,space;try{n=E.normalize(input);space=E.freeSpace(n);hard=E.validate(input,plan,space);}catch{return{ok:false,checks:{H5_continuity:false},issues:[{key:'H5_continuity',message:'Укажите коллектор на стене',circuit:0,segments:[]}]};}
 const issues=[];
 if(hard.ok)return{...hard,issues};
 for(const [key,ok] of Object.entries(hard.checks)){
  if(ok)continue;
  let located=false;
  plan.circuits.forEach((c,ci)=>{
   const r=c.route,ss=E.segments(r),bad=new Set();
   const single=E.validate(input,{circuits:[c],manifold:plan.manifold?.length?plan.manifold:Array(plan.circuits.length).fill({})},space);
   if(key==='H3_crossings'){
    ss.forEach(([a,b],i)=>plan.circuits.forEach((other,cj)=>E.segments(other.route).forEach(([u,v],j)=>{if(ci===cj&&Math.abs(i-j)<2)return;if(E.intersect(a,b,u,v))bad.add(i);}))); 
   }else if(!single.checks[key]){
    if(key==='H1_freeSpace'||key==='H2_obstacles')ss.forEach(([a,b],i)=>{if(i>0&&i<ss.length-1&&!space.covers(a,b))bad.add(i);});
    else if(key==='H4_bendRadius'){
     const trim=r.map((p,i)=>{if(!i||i===r.length-1)return 0;const a=r[i-1],b=r[i+1],u=dist(a,p),v=dist(p,b),cos=((p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y))/(u*v||1);return n.minBendRadiusMm*Math.tan(Math.acos(Math.max(-1,Math.min(1,cos)))/2);});
     ss.forEach(([a,b],i)=>{if(dist(a,b)+1e-6<trim[i]+trim[i+1])bad.add(i);});
    }else if(key==='H5_continuity'){if(!c.supply||!same(r[0],c.supply))bad.add(0);if(!c.returnPoint||!same(r.at(-1),c.returnPoint))bad.add(ss.length-1);}
    if(!bad.size)ss.forEach((_,i)=>bad.add(i));
   }
   if(bad.size){issues.push({key,message:labels[key],circuit:ci,segments:[...bad]});located=true;}
  });
  // Arc proximity between circuits can fail even without polyline crossings.
  // Mark both complete circuits rather than inventing a point of collision.
  if(!located)plan.circuits.forEach((c,ci)=>issues.push({key,message:labels[key],circuit:ci,segments:E.segments(c.route).map((_,i)=>i)}));
  if(!plan.circuits.length)issues.push({key,message:'Нарисуйте или рассчитайте контур',circuit:0,segments:[]});
 }
 return{...hard,issues};
}
function bypass(input,plan,ci,start,end,locks=[]){
 const r=plan.circuits[ci]?.route;if(!r||start>=end)return{ok:false,message:'Отметьте начало и конец участка'};
 const n=E.normalize(input),space=E.freeSpace(n),a=r[start],b=r[end],occupied=[];
 plan.circuits.forEach((c,cj)=>E.segments(c.route).forEach(([u,v],i)=>{
  if(cj===ci&&i>=start&&i<end)return;
  // Reserve the unchanged route. Only the small joint at each endpoint is
  // opened for connection; the full assembled route is still hard-validated.
  let p={...u},q={...v};const gap=n.pipeDiameterMm*1.5+1;
  if(cj===ci&&i===start-1){const d=dist(p,q);if(d<=gap)return;q={x:q.x+(p.x-q.x)*gap/d,y:q.y+(p.y-q.y)*gap/d};}
  if(cj===ci&&i===end){const d=dist(p,q);if(d<=gap)return;p={x:p.x+(q.x-p.x)*gap/d,y:p.y+(q.y-p.y)*gap/d};}
  occupied.push([p,q]);
 }));
 const candidates=[];
 // Preserve tangent directions where possible, then try the unrestricted
 // connection. All candidates use the same obstacle-aware visibility search.
 for(const stem of [n.minBendRadiusMm*2,0]){
  const pre=start?r[start-1]:null,post=r[end+1];
  const advance=(p,q,d)=>{const len=dist(p,q);return{x:p.x+(p.x-q.x)*d/len,y:p.y+(p.y-q.y)*d/len};};
  const aa=stem&&pre?advance(a,pre,stem):a,bb=stem&&post?advance(b,post,stem):b;
  const path=E.connector(aa,bb,space,[],occupied,n);if(!path)continue;
  const result=replace(plan,ci,start,end,E.clean([a,...path,b]),locks);
  if(result.ok&&E.validate(input,result.plan).ok)candidates.push({...result,path:E.clean([a,...path,b])});
 }
 candidates.sort((a,b)=>E.length(a.path)-E.length(b.path));
 return candidates[0]||{ok:false,message:'Для этого участка свободного обхода нет. Выберите точки дальше от препятствия.'};
}
function boundaries(sections){
 const raw=E.freeSpace({sections,obstacles:[],wallOffsetMm:0,pipeDiameterMm:0}),out=[];
 for(const edge of raw.edges){const h=edge[0].y===edge[1].y,axis=h?'x':'y',fixed=h?'y':'x';let found=out.find(e=>e[0][fixed]===edge[0][fixed]&&e[1][fixed]===edge[1][fixed]&&e[1][axis]===edge[0][axis]);if(found)found[1]=edge[1];else out.push(copy(edge));}
 return out;
}
function reconnect(input,plan,locks=[]){
 const n=E.normalize(input),space=E.freeSpace(n),count=plan.circuits.length;
 if(!count)return{ok:false,message:'Сначала нарисуйте или рассчитайте контур'};
 const gap=n.pipeDiameterMm*1.5+1;
 const trimmed=(a,b,atStart,atEnd)=>{const d=dist(a,b);if(d<gap*((atStart?1:0)+(atEnd?1:0)))return null;return[{x:a.x+(b.x-a.x)*(atStart?gap/d:0),y:a.y+(b.y-a.y)*(atStart?gap/d:0)},{x:b.x+(a.x-b.x)*(atEnd?gap/d:0),y:b.y+(a.y-b.y)*(atEnd?gap/d:0)}];};
 for(const laneOrder of [1,-1]){
  const ports=E.manifoldPorts(n,count,space,laneOrder);if(!ports)continue;
  const next=copy(plan);let failed=false;
  for(let ci=0;ci<count;ci++){
   const old=plan.circuits[ci],r=old.route,p=ports[ci];let found=null;
   const other=next.circuits.flatMap((c,i)=>i===ci?[]:E.segments(c.route));
   for(const cut of [1,2,3,4]){if(found)break;for(const back of [1,2,3,4]){
    const end=r.length-1-back;if(cut>=end)continue;
    const core=r.slice(cut,end+1),occupied=E.segments(core).map(([a,b],i,ss)=>trimmed(a,b,i===0,i===ss.length-1)).filter(Boolean);
    const head=E.connector(p.innerSupply,core[0],space,[],[...other,...occupied,[p.returnPoint,p.innerReturn]],n);if(!head)continue;
    const tail=E.connector(core.at(-1),p.innerReturn,space,[],[...other,...occupied,...E.segments([p.supply,...head])],n);if(!tail)continue;
    // Preserve the untouched middle, including collinear points used by locks.
    const route=[p.supply,...head.slice(0,-1),...core,...tail.slice(1),p.returnPoint].filter((v,i,a)=>!i||!same(a[i-1],v));
    const c={...copy(old),route,supply:p.supply,returnPoint:p.returnPoint,length:E.length(route),bendRadiusMm:n.minBendRadiusMm};
    if(!E.validate(input,{circuits:[c],manifold:ports}).ok)continue;
    const candidate=copy(next);candidate.circuits[ci]=c;if(!locksPreserved(candidate,locks))continue;
    found=c;break;
   }}
   if(!found){failed=true;break;}next.circuits[ci]=found;
  }
  next.manifold=ports;next.totalLength=next.circuits.reduce((s,c)=>s+E.length(c.route),0);
  if(!failed&&E.validate(input,next).ok)return{ok:true,plan:next};
 }
 return{ok:false,message:'Свободный подвод к коллектору не найден. Попробуйте другое положение.'};
}
function resizeWall(sections,edge,length){
 const axis=edge[0].y===edge[1].y?'x':'y',dim=axis==='x'?'width':'height',lo=Math.min(edge[0][axis],edge[1][axis]),hi=Math.max(edge[0][axis],edge[1][axis]),old=hi-lo;
 if(!Number.isFinite(length)||length<100||length>30000||!old)throw new Error('Длина стены — от 100 до 30 000 мм');
 const map=v=>v<=lo?v:v>=hi?v+length-old:lo+(v-lo)*length/old;
 const result=sections.map(r=>({...r,[axis]:map(r[axis]),[dim]:map(r[axis]+r[dim])-map(r[axis])}));
 if(result.some(r=>r.width<50||r.height<50))throw new Error('Этот размер делает часть комнаты слишком узкой');
 return result;
}
return{copy,dist,same,projection,edgeKey,locksPreserved,updated,nearest,prepareCut,moveSegment,replace,guidedReplace,inspect,bypass,reconnect,boundaries,resizeWall,labels};
});
