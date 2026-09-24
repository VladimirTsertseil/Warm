/* Warm 2.6.1: pure geometry -> cells -> regions -> patterns -> connectors -> H -> Q. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WarmEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const EPS=1e-7;
const point=(x,y)=>({x,y});
const same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<EPS;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const length=r=>r.slice(1).reduce((s,p,i)=>s+distance(r[i],p),0);
const inRect=(p,r)=>p.x>=r.x-EPS&&p.y>=r.y-EPS&&p.x<=r.x+r.width+EPS&&p.y<=r.y+r.height+EPS;
const unique=a=>[...new Set(a)].sort((a,b)=>a-b);
function clean(route){const r=[];for(const p of route){if(r.length&&same(r.at(-1),p))continue;while(r.length>1){const a=r.at(-2),b=r.at(-1);if(Math.abs((b.x-a.x)*(p.y-b.y)-(b.y-a.y)*(p.x-b.x))>EPS||(b.x-a.x)*(p.x-b.x)+(b.y-a.y)*(p.y-b.y)<0)break;r.pop();}r.push({...p});}return r;}
function intersect(a,b,c,d){
 const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
 const on=(p,q,r)=>Math.abs(cross(p,q,r))<EPS&&r.x>=Math.min(p.x,q.x)-EPS&&r.x<=Math.max(p.x,q.x)+EPS&&r.y>=Math.min(p.y,q.y)-EPS&&r.y<=Math.max(p.y,q.y)+EPS;
 const p=cross(a,b,c),q=cross(a,b,d),r=cross(c,d,a),s=cross(c,d,b);
 return (p*q<-EPS&&r*s<-EPS)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function pointDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return distance(p,point(a.x+t*dx,a.y+t*dy));}
function segmentDistance(a,b,c,d){return intersect(a,b,c,d)?0:Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));}
function segments(route){return route.slice(1).map((b,i)=>[route[i],b]);}
function subtract(r,b){
 const l=Math.max(r.x,b.x),t=Math.max(r.y,b.y),h=Math.min(r.y+r.height,b.y+b.height),w=Math.min(r.x+r.width,b.x+b.width);
 if(w<=l+EPS||h<=t+EPS)return[r];
 return [{x:r.x,y:r.y,width:r.width,height:t-r.y},{x:r.x,y:h,width:r.width,height:r.y+r.height-h},{x:r.x,y:t,width:l-r.x,height:h-t},{x:w,y:t,width:r.x+r.width-w,height:h-t}].filter(r=>r.width>EPS&&r.height>EPS);
}
// Event sweep over a union, not erosion of individual input rectangles. Shared
// section boundaries disappear before offsets are applied.
function decomposition(rects,axis='horizontal'){
 const swap=r=>({x:r.y,y:r.x,width:r.height,height:r.width});
 if(axis==='vertical')return decomposition(rects.map(swap)).map(swap);
 const ys=unique(rects.flatMap(r=>[r.y,r.y+r.height])),out=[];let previous=[];
 for(let j=1;j<ys.length;j++){
  const y=ys[j-1],h=ys[j]-y,mid=y+h/2;
  const intervals=rects.filter(r=>mid>r.y&&mid<r.y+r.height).map(r=>[r.x,r.x+r.width]).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const x of intervals){if(merged.length&&x[0]<=merged.at(-1)[1]+EPS)merged.at(-1)[1]=Math.max(merged.at(-1)[1],x[1]);else merged.push(x.slice());}
  const current=[];for(const [x,end] of merged){let r=previous.find(r=>Math.abs(r.x-x)<EPS&&Math.abs(r.width-(end-x))<EPS&&Math.abs(r.y+r.height-y)<EPS);if(r)r.height+=h;else{r={x,y,width:end-x,height:h};out.push(r);}current.push(r);}previous=current;
 }
 return out;
}
function freeSpace(input){
 let raw=decomposition(input.sections);
 for(const o of decomposition(input.obstacles||[]))raw=raw.flatMap(r=>subtract(r,o));
 raw=decomposition(raw);
 const edges=[];
 // Split rectangle edges at every union event, retaining only exposed spans.
 const xs=unique(raw.flatMap(r=>[r.x,r.x+r.width])),ys=unique(raw.flatMap(r=>[r.y,r.y+r.height]));
 const inside=p=>raw.some(r=>inRect(p,r));
 for(const x of xs)for(let j=1;j<ys.length;j++){const a=point(x,ys[j-1]),b=point(x,ys[j]),m=(a.y+b.y)/2;if(inside(point(x-.001,m))!==inside(point(x+.001,m)))edges.push([a,b]);}
 for(const y of ys)for(let i=1;i<xs.length;i++){const a=point(xs[i-1],y),b=point(xs[i],y),m=(a.x+b.x)/2;if(inside(point(m,y-.001))!==inside(point(m,y+.001)))edges.push([a,b]);}
 const inset=Math.max(input.wallOffsetMm,input.pipeDiameterMm/2);
 let rects=raw;
 for(const [a,b] of edges){const box={x:Math.min(a.x,b.x)-inset,y:Math.min(a.y,b.y)-inset,width:Math.abs(a.x-b.x)+2*inset,height:Math.abs(a.y-b.y)+2*inset};rects=rects.flatMap(r=>subtract(r,box));}
 rects=decomposition(rects);
 const covers=(a,b,rs=rects)=>{
  if(![a.x,a.y,b.x,b.y].every(Number.isFinite))return false;
  let intervals=[];const dx=b.x-a.x,dy=b.y-a.y;
  for(const r of rs){let lo=0,hi=1;for(const [v,d,min,max] of [[a.x,dx,r.x,r.x+r.width],[a.y,dy,r.y,r.y+r.height]]){if(Math.abs(d)<EPS){if(v<min-EPS||v>max+EPS){hi=-1;break;}}else{const t1=(min-v)/d,t2=(max-v)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}}if(lo<=hi+EPS)intervals.push([lo,hi]);}
  intervals.sort((a,b)=>a[0]-b[0]);let end=0;for(const [lo,hi] of intervals){if(lo>end+EPS)return false;end=Math.max(end,hi);if(end>=1-EPS)return true;}return false;
 };
 return {raw,rects,edges,inside,contains:p=>rects.some(r=>inRect(p,r)),covers};
}
function normalize(input){
 const n={pipeStepMm:150,pipeDiameterMm:16,wallOffsetMm:100,maxCircuitLengthMm:100000,pattern:'auto',...input};
 n.minBendRadiusMm=input.minBendRadiusMm??n.pipeDiameterMm*5;
 n.pitch=Math.max(n.pipeStepMm,2*n.minBendRadiusMm);
 if(!n.sections?.length||!n.supply||!n.returnPoint||![n.pipeStepMm,n.pipeDiameterMm,n.maxCircuitLengthMm,n.minBendRadiusMm].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(n.wallOffsetMm)||n.wallOffsetMm<0||n.sections.concat(n.obstacles||[]).some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0))throw new Error('invalid-input');
 if(![n.supply.x,n.supply.y,n.returnPoint.x,n.returnPoint.y].every(Number.isFinite))throw new Error('invalid-ports');
 return n;
}
// BCD cells can always form a path cover of singleton cells; no Hamiltonian
// order is required. Long cells split before routing, including connector budget.
function regions(space,n,axis,reserve){
 const cells=decomposition(space.rects,axis),out=[];
 for(const cell of cells){const alongX=cell.width>=cell.height;let count=1;
  // Estimate the actual inset region plus distance to its nearest access point,
  // not the bounding room's area with a fixed percentage reserved everywhere.
  for(;count<=16;count++){
   let fits=true;
   for(let k=0;k<count;k++){
    const w=(alongX?cell.width/count:cell.width)-2*reserve,h=(alongX?cell.height:cell.height/count)-2*reserve;
    const x=cell.x+(alongX?k*cell.width/count:0)+reserve,y=cell.y+(alongX?0:k*cell.height/count)+reserve;
    const tail=2*(Math.max(x-n.supply.x,0,n.supply.x-x-w)+Math.max(y-n.supply.y,0,n.supply.y-y-h));
    const estimate=Math.max(n.pitch,w)*Math.max(n.pitch,h)/n.pitch+(Math.max(0,w)+Math.max(0,h))*.5+6*n.pitch+tail;
    if(estimate>n.maxCircuitLengthMm*.95){fits=false;break;}
   }
   if(fits)break;
  }
  if(count>16)return null;
  for(let k=0;k<count;k++){
  const r={...cell};if(alongX){r.width/=count;r.x+=k*r.width;}else{r.height/=count;r.y+=k*r.height;}
  // Obstacle decomposition can leave very thin slivers that are valid free
  // space for connector routing but cannot hold a complete heating loop. Such
  // a sliver must not invalidate the whole room.
  if(r.width<n.pitch-EPS||r.height<n.pitch-EPS)continue;
  const mx=Math.min(reserve,(r.width-n.pitch)/2),my=Math.min(reserve,(r.height-n.pitch)/2);
  if(mx<0||my<0)continue;
  r.x+=mx;r.y+=my;r.width-=2*mx;r.height-=2*my;
  if(r.width<n.pitch-EPS||r.height<n.pitch-EPS)continue;
  // Very small remnants around obstacle corners are better left as
  // connector-only free space than promoted to a separate 1–3 m circuit.
  // Six pitch-squares is below the useful area of an independent heating
  // region but still leaves those cells available to `connector()`.
  if(r.width*r.height<6*n.pitch*n.pitch)continue;
  out.push(r);
 }}return out;
}
function rectangularCycle(rect,pitch,kind,transpose=false){
 const r=transpose?{x:rect.y,y:rect.x,width:rect.height,height:rect.width}:rect;
 // A 2x2 cycle per macro cell, with cycle splicing along a spanning tree.
 // Branches are allowed. A comb gives a snake, a serpentine tree paired passes,
 // a peeling tree concentric paired turns. The resulting cycle is simple.
 const nx=Math.max(1,Math.floor((r.width+pitch)/(2*pitch))),ny=Math.max(1,Math.floor((r.height+pitch)/(2*pitch)));
 const sx=nx===1?Math.min(r.width,pitch):(r.width-pitch)/(nx*2-2),sy=ny===1?Math.min(r.height,pitch):(r.height-pitch)/(ny*2-2);
 const px=nx===1?r.width:Math.min(pitch,sx),py=ny===1?r.height:Math.min(pitch,sy);
 const dx=nx===1?0:(r.width-px)/(nx-1),dy=ny===1?0:(r.height-py)/(ny-1);
 const adj=new Map(),coords=new Map();const key=(i,j,k)=>`${i},${j},${k}`;
 const add=(a,b)=>{adj.get(a).add(b);adj.get(b).add(a);};
 const remove=(a,b)=>{adj.get(a).delete(b);adj.get(b).delete(a);};
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const x=r.x+i*dx,y=r.y+j*dy;
  const ps=[point(x,y),point(x+px,y),point(x+px,y+py),point(x,y+py)];
  for(let k=0;k<4;k++){const id=key(i,j,k);adj.set(id,new Set());coords.set(id,transpose?point(ps[k].y,ps[k].x):ps[k]);}
  for(let k=0;k<4;k++)add(key(i,j,k),key(i,j,(k+1)%4));
 }
 const join=(a,b)=>{let [i,j]=a,[u,v]=b;if(u<i||v<j){[i,j,u,v]=[u,v,i,j];}if(u>i){remove(key(i,j,1),key(i,j,2));remove(key(u,v,0),key(u,v,3));add(key(i,j,1),key(u,v,0));add(key(i,j,2),key(u,v,3));}else{remove(key(i,j,2),key(i,j,3));remove(key(u,v,0),key(u,v,1));add(key(i,j,3),key(u,v,0));add(key(i,j,2),key(u,v,1));}};
 if(kind==='snake'){
  for(let j=0;j<ny;j++){for(let i=1;i<nx;i++)join([i-1,j],[i,j]);if(j)join([0,j-1],[0,j]);}
 }else{
  const order=[];
  if(kind==='double-snake'){for(let j=0;j<ny;j++)for(let k=0;k<nx;k++)order.push([j%2?nx-1-k:k,j]);}
  else {let l=0,t=0,h=ny-1,w=nx-1;while(l<=w&&t<=h){for(let i=l;i<=w;i++)order.push([i,t]);t++;for(let j=t;j<=h;j++)order.push([w,j]);w--;if(t<=h){for(let i=w;i>=l;i--)order.push([i,h]);h--;}if(l<=w){for(let j=h;j>=t;j--)order.push([l,j]);l++;}}}
  for(let k=1;k<order.length;k++)join(order[k-1],order[k]);
 }
 const start=key(0,0,0),route=[];let current=start,previous=null;
 do{route.push(coords.get(current));const next=[...adj.get(current)].find(x=>x!==previous);previous=current;current=next;}while(current!==start&&route.length<=nx*ny*4);
 route.push(route[0]);return clean(route);
}
function coreVariants(rect,n,kind){
 const out=[];for(const transpose of [false,true]){
  const cycle=rectangularCycle(rect,n.pitch,kind,transpose),s=segments(cycle);
  for(let i=0;i<s.length;i++){
   const [a,b]=s[i],horizontal=Math.abs(a.y-b.y)<EPS;
   const outer=horizontal?(Math.abs(a.y-rect.y)<EPS||Math.abs(a.y-rect.y-rect.height)<EPS):(Math.abs(a.x-rect.x)<EPS||Math.abs(a.x-rect.x-rect.width)<EPS);
   if(!outer||distance(a,b)<n.pitch-EPS)continue;
   // Open one pitch in an outer edge; retain the rest of a long boundary run.
   for(const f of [.5]){
    const t=(distance(a,b)-n.pitch)*f/distance(a,b),u=t+n.pitch/distance(a,b);
    const p=point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t),q=point(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u);
    const route=clean([q,...cycle.slice(i+1,-1),...cycle.slice(0,i+1),p]);
    const normal=horizontal?point(0,Math.abs(a.y-rect.y)<EPS?-1:1):point(Math.abs(a.x-rect.x)<EPS?-1:1,0);
    out.push({route,normal});out.push({route:route.slice().reverse(),normal});
   }
  }
 }return out;
}

function openCycle(cycle,index,p,q){return clean([q,...cycle.slice(index+1,-1),...cycle.slice(0,index+1),p]);}
function joinCycles(A,B,space,n,otherCycles){
 const as=segments(A),bs=segments(B),possibilities=[];
 for(let i=0;i<as.length;i++)for(let j=0;j<bs.length;j++){
  const [a,b]=as[i],[c,d]=bs[j],h=Math.abs(a.y-b.y)<EPS;
  if(h!==(Math.abs(c.y-d.y)<EPS))continue;
  const sep=h?Math.abs(a.y-c.y):Math.abs(a.x-c.x);
  if(sep<n.pipeDiameterMm*2||sep>Math.max(n.pitch*3,2*(n.serviceReserve||0)+n.pitch))continue;
  const lo=Math.max(Math.min(h?a.x:a.y,h?b.x:b.y),Math.min(h?c.x:c.y,h?d.x:d.y)),hi=Math.min(Math.max(h?a.x:a.y,h?b.x:b.y),Math.max(h?c.x:c.y,h?d.x:d.y));
  if(hi-lo<n.pitch-EPS)continue;
  for(const f of [0,.5,1]){
  const start=lo+(hi-lo-n.pitch)*f,end=start+n.pitch;
  let p=h?point(start,a.y):point(a.x,start),q=h?point(end,a.y):point(a.x,end),u=h?point(start,c.y):point(c.x,start),v=h?point(end,c.y):point(c.x,end);
  if(!space.covers(p,u)||!space.covers(q,v))continue;
  if(otherCycles.some(C=>segments(C).some(([e,f])=>intersect(p,u,e,f)||intersect(q,v,e,f))))continue;
  if((h?b.x-a.x:b.y-a.y)<0)[p,q]=[q,p];
  if((h?d.x-c.x:d.y-c.y)<0)[u,v]=[v,u];
  const aa=openCycle(A,i,p,q),bb=openCycle(B,j,u,v);
  if(distance(aa.at(-1),bb[0])>sep+EPS)bb.reverse();
  const joined=clean([...aa,...bb,aa[0]]);
  const ss=segments(joined);let safe=true;
  for(let k=0;k<ss.length&&safe;k++)for(let z=k+2;z<ss.length;z++){if(k===0&&z===ss.length-1)continue;if(intersect(...ss[k],...ss[z])){safe=false;break;}}
  if(safe&&bendsOK([joined.at(-2),...joined,joined[1]],n.minBendRadiusMm))possibilities.push(joined);
  }
 }
 possibilities.sort((a,b)=>length(a)-length(b));return possibilities[0]||null;
}
function circuitRegions(rs,space,n,kind,transpose){
 const groups=rs.map((r,i)=>{const family=kind==='adaptive'?(r.width/r.height>2.5||r.height/r.width>2.5?'double-snake':'spiral'):kind;return {ids:[i],rects:[r],cycle:rectangularCycle(r,n.pitch,family,transpose),patterns:[family]};});
 let change=true;
 while(change){change=false;let best=null;
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   const A=groups[i],B=groups[j],budget=n.maxCircuitLengthMm-2*Math.min(...[...A.cycle,...B.cycle].map(p=>Math.abs(p.x-n.supply.x)+Math.abs(p.y-n.supply.y)))-4*n.pitch;
   if(length(A.cycle)+length(B.cycle)>budget)continue;
   const cycle=joinCycles(A.cycle,B.cycle,space,n,groups.filter((_,k)=>k!==i&&k!==j).map(g=>g.cycle));
   if(!cycle||length(cycle)>budget)continue;
   const rr=[...A.rects,...B.rects],w=Math.max(...rr.map(r=>r.x+r.width))-Math.min(...rr.map(r=>r.x)),h=Math.max(...rr.map(r=>r.y+r.height))-Math.min(...rr.map(r=>r.y));
   const cost=length(cycle)-length(A.cycle)-length(B.cycle)+(w*h-rr.reduce((s,r)=>s+r.width*r.height,0))/n.pitch;
   if(!best||cost<best.cost)best={i,j,cycle,cost};
  }
  if(best){const A=groups[best.i],B=groups[best.j];groups[best.i]={ids:[...A.ids,...B.ids],rects:[...A.rects,...B.rects],cycle:best.cycle,patterns:[...A.patterns,...B.patterns]};groups.splice(best.j,1);change=true;}
 }
 return groups;
}
function groupVariants(group,n){
 const cycle=group.cycle,out=[];
 for(let i=0;i<cycle.length-1;i++){
  const a=cycle[i],b=cycle[i+1],h=Math.abs(a.y-b.y)<EPS,L=distance(a,b);if(L<n.pitch-EPS)continue;
  for(const r of group.rects){
   const outer=h?(Math.abs(a.y-r.y)<EPS||Math.abs(a.y-r.y-r.height)<EPS):(Math.abs(a.x-r.x)<EPS||Math.abs(a.x-r.x-r.width)<EPS);if(!outer)continue;
   for(const f of [0,.5,1]){
    const t=(L-n.pitch)*f/L,u=t+n.pitch/L,p=point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t),q=point(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u);
    if(!inRect(p,r)||!inRect(q,r))continue;
    const route=openCycle(cycle,i,p,q),normal=h?point(0,Math.abs(a.y-r.y)<EPS?-1:1):point(Math.abs(a.x-r.x)<EPS?-1:1,0);
    out.push({route,normal,rect:r},{route:route.slice().reverse(),normal,rect:r});
   }
  }
 }const seen=new Set();return out.filter(v=>{const key=JSON.stringify(v.route);if(seen.has(key))return false;seen.add(key);return true;});
}

class Heap{constructor(){this.a=[];}push(v){let i=this.a.length;this.a.push(v);while(i){const p=(i-1)>>1;if(this.a[p][0]<=v[0])break;this.a[i]=this.a[p];i=p;}this.a[i]=v;}pop(){const first=this.a[0],v=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let c=i*2+1;if(c+1<this.a.length&&this.a[c+1][0]<this.a[c][0])c++;if(v[0]<=this.a[c][0])break;this.a[i]=this.a[c];i=c;}this.a[i]=v;}return first;}}
function connector(a,b,space,boxes,occupied,n){
 const gap=n.pipeDiameterMm*1.5,R=n.minBendRadiusMm;
 occupied=occupied.filter(([p,q])=>!boxes.some(r=>inRect(p,r)&&inRect(q,r)));
 const all=space.rects;
 const xs=unique([a.x,b.x,...all.flatMap(r=>[r.x,r.x+r.width]),...boxes.flatMap(r=>[r.x-gap,r.x+r.width+gap]),...occupied.flatMap(([p,q])=>[p.x-gap,p.x+gap,q.x-gap,q.x+gap])]);
 const ys=unique([a.y,b.y,...all.flatMap(r=>[r.y,r.y+r.height]),...boxes.flatMap(r=>[r.y-gap,r.y+r.height+gap]),...occupied.flatMap(([p,q])=>[p.y-gap,p.y+gap,q.y-gap,q.y+gap])]);
 const nx=xs.length,ny=ys.length,N=nx*ny;
 if(N>180000)return null;
 const points=new Array(N),allowed=new Uint8Array(N),edgeCache=new Map();
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const p=point(xs[i],ys[j]),k=j*nx+i;points[k]=p;allowed[k]=space.contains(p)&&!boxes.some(r=>p.x>r.x-EPS&&p.x<r.x+r.width+EPS&&p.y>r.y-EPS&&p.y<r.y+r.height+EPS)&&!occupied.some(([c,d])=>pointDistance(p,c,d)<gap-EPS)?1:0;}
 const start=ys.indexOf(a.y)*nx+xs.indexOf(a.x),end=ys.indexOf(b.y)*nx+xs.indexOf(b.x);
 if(!allowed[start]||!allowed[end])return null;
 const costs=new Float64Array(N*5).fill(Infinity),parents=new Int32Array(N*5).fill(-1),run=new Float64Array(N*5),heap=new Heap();
 const initial=start*5+4;costs[initial]=0;run[initial]=Infinity;heap.push([distance(a,b),initial]);let finish=-1;
 while(heap.a.length){const [priority,id]=heap.pop(),k=Math.floor(id/5),dir=id%5,p=points[k];if(priority>costs[id]+Math.abs(p.x-b.x)+Math.abs(p.y-b.y)+EPS)continue;if(k===end){finish=id;break;}
  const i=k%nx,j=Math.floor(k/nx);
  const options=[[i+1<nx?k+1:-1,0],[j+1<ny?k+nx:-1,1],[i?k-1:-1,2],[j?k-nx:-1,3]];
  for(const [v,d] of options){if(v<0||!allowed[v]||(dir<4&&(d+2)%4===dir))continue;
   const turn=dir<4&&d!==dir;if(turn&&run[id]<2*R-EPS)continue;
   const q=points[v],ek=Math.min(k,v)*N+Math.max(k,v);let valid=edgeCache.get(ek);
   if(valid===undefined){valid=space.covers(p,q)&&!boxes.some(r=>segmentHitsBox(p,q,r))&&!occupied.some(([c,d])=>segmentDistance(p,q,c,d)<gap-EPS);edgeCache.set(ek,valid);}if(!valid)continue;
   const len=distance(p,q),cost=costs[id]+len+(turn?R*3:0),next=v*5+d;
   if(cost>=costs[next]-EPS)continue;costs[next]=cost;parents[next]=id;run[next]=turn?len:Math.min(2*R,run[id]+len);heap.push([cost+Math.abs(q.x-b.x)+Math.abs(q.y-b.y),next]);
  }
 }
 if(finish<0)return null;const route=[];for(let id=finish;id>=0;id=parents[id])route.push(points[Math.floor(id/5)]);return clean(route.reverse());
}
function segmentHitsBox(a,b,r){
 if(Math.abs(a.x-b.x)<EPS)return a.x>r.x-EPS&&a.x<r.x+r.width+EPS&&Math.max(a.y,b.y)>r.y-EPS&&Math.min(a.y,b.y)<r.y+r.height+EPS;
 if(Math.abs(a.y-b.y)<EPS)return a.y>r.y-EPS&&a.y<r.y+r.height+EPS&&Math.max(a.x,b.x)>r.x-EPS&&Math.min(a.x,b.x)<r.x+r.width+EPS;
 // Slab clipping also covers the diagonal fan-out next to manifold outlets.
 let lo=0,hi=1;
 for(const [v,d,min,max] of [[a.x,b.x-a.x,r.x-EPS,r.x+r.width+EPS],[a.y,b.y-a.y,r.y-EPS,r.y+r.height+EPS]]){
  if(Math.abs(d)<EPS){if(v<min||v>max)return false;}
  else{const p=(min-v)/d,q=(max-v)/d;lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));}
 }
 return lo<=hi;
}
function portNormal(p){return p.side==='top'?point(0,1):p.side==='bottom'?point(0,-1):p.side==='left'?point(1,0):p.side==='right'?point(-1,0):null;}
function manifoldPorts(n,count,space,laneOrder=1){
 if(!Number.isInteger(count)||count<1||count>16)return null;
 const normal=portNormal(n.supply);if(!normal||n.returnPoint.side!==n.supply.side)return null;
 const horizontal=normal.y!==0,anchor=(horizontal?n.supply.x+n.returnPoint.x:n.supply.y+n.returnPoint.y)/2;
 const direction=Math.sign(horizontal?n.returnPoint.x-n.supply.x:n.returnPoint.y-n.supply.y)||1;
 const wall=horizontal?n.supply.y:n.supply.x,spacing=Math.max(n.pipeDiameterMm*3,50),ports=[];
 // Distinct physical outlets on the selected wall. The two editor handles locate
// the cabinet; they are not one coincident outlet shared by every circuit.
 for(let i=0;i<count;i++){
  const t=anchor+(i-(count-1)/2)*spacing*2*direction;
  const a=horizontal?point(t-spacing/2*direction,wall):point(wall,t-spacing/2*direction),b=horizontal?point(t+spacing/2*direction,wall):point(wall,t+spacing/2*direction);
  if(space.inside(point(a.x-normal.x*.01,a.y-normal.y*.01))||space.inside(point(b.x-normal.x*.01,b.y-normal.y*.01)))return null;
  // Try either nesting direction for the paired corridor lanes. Outlets keep
  // their physical order; only the depth at which each pipe leaves the wall
  // changes. This lets later circuits pass beside earlier ones constructively.
  const lane=laneOrder===1?i:count-1-i,gap=n.pipeDiameterMm*1.5;
  const depth=n.wallOffsetMm+lane*gap*2+(laneOrder===1?0:gap),returnDepth=depth+laneOrder*gap;
  const ai=point(a.x+normal.x*depth,a.y+normal.y*depth),bi=point(b.x+normal.x*returnDepth,b.y+normal.y*returnDepth);
  if(!space.covers(a,ai,space.raw)||!space.covers(b,bi,space.raw)||!space.contains(ai)||!space.contains(bi))return null;
  ports.push({supply:a,returnPoint:b,innerSupply:ai,innerReturn:bi,normal});
 }return ports;
}
function bendsOK(route,R){
 const trims=new Array(route.length).fill(0);
 for(let i=1;i<route.length-1;i++){
  const a=route[i-1],b=route[i],c=route[i+1],u=distance(a,b),v=distance(b,c);
  if(u<EPS||v<EPS)return false;
  const cosine=Math.max(-1,Math.min(1,((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))/(u*v)));
  if(cosine<-1+EPS)return false;
  trims[i]=R*Math.tan(Math.acos(cosine)/2);
 }
 for(let i=1;i<route.length;i++)if(distance(route[i-1],route[i])+EPS<trims[i-1]+trims[i])return false;
 return true;
}
function rounded(route,R){
 if(!bendsOK(route,R))return null;
 const primitives=[];let cursor=route[0],svg=`M ${cursor.x} ${cursor.y}`;
 const line=end=>{if(distance(cursor,end)>EPS){primitives.push({type:'line',a:cursor,b:end,points:[cursor,end]});svg+=` L ${end.x} ${end.y}`;}cursor=end;};
 for(let i=1;i<route.length-1;i++){
  const a=route[i-1],b=route[i],c=route[i+1],ab=distance(a,b),bc=distance(b,c),u=point((b.x-a.x)/ab,(b.y-a.y)/ab),v=point((c.x-b.x)/bc,(c.y-b.y)/bc),dot=Math.max(-1,Math.min(1,u.x*v.x+u.y*v.y)),angle=Math.acos(dot);
  if(angle<EPS)continue;
  const sign=u.x*v.y-u.y*v.x>0?1:-1,trim=R*Math.tan(angle/2),p=point(b.x-u.x*trim,b.y-u.y*trim),q=point(b.x+v.x*trim,b.y+v.y*trim),center=point(p.x-sign*u.y*R,p.y+sign*u.x*R),start=Math.atan2(p.y-center.y,p.x-center.x);
  line(p);const samples=Math.max(2,Math.ceil(angle/(2*Math.acos(1-.02/R)))),points=[];
  for(let k=0;k<=samples;k++){const t=start+sign*angle*k/samples;points.push(point(center.x+R*Math.cos(t),center.y+R*Math.sin(t)));}
  primitives.push({type:'arc',a:p,b:q,center,radius:R,start,delta:sign*angle,points});svg+=` A ${R} ${R} 0 0 ${sign>0?1:0} ${q.x} ${q.y}`;cursor=q;
 }
 line(route.at(-1));
 let offset=0;for(const p of primitives){p.offset=offset;p.length=p.type==='line'?distance(p.a,p.b):Math.abs(p.delta)*R;offset+=p.length;const xs=p.points.map(q=>q.x),ys=p.points.map(q=>q.y);p.bounds={x:Math.min(...xs)-.02,y:Math.min(...ys)-.02,maxX:Math.max(...xs)+.02,maxY:Math.max(...ys)+.02};}
 const pathRange=(from,to)=>{let out='';for(const p of primitives){const lo=Math.max(from,p.offset),hi=Math.min(to,p.offset+p.length);if(hi<=lo+EPS)continue;
  const at=t=>p.type==='line'?point(p.a.x+(p.b.x-p.a.x)*t,p.a.y+(p.b.y-p.a.y)*t):point(p.center.x+R*Math.cos(p.start+p.delta*t),p.center.y+R*Math.sin(p.start+p.delta*t));
  const a=at((lo-p.offset)/p.length),b=at((hi-p.offset)/p.length);if(!out)out=`M ${a.x} ${a.y}`;out+=p.type==='line'?` L ${b.x} ${b.y}`:` A ${R} ${R} 0 0 ${p.delta>0?1:0} ${b.x} ${b.y}`;
 }return out;};
 return {primitives,svg,length:offset,hotSvg:pathRange(0,offset/2),coldSvg:pathRange(offset/2,offset)};
}
function arcContained(arc,rects){
 const {center:c,radius:R,start,delta}=arc,tau=Math.PI*2,ts=[0,1];
 const add=angle=>{let d=(angle-start)%tau;if(delta>0){if(d<0)d+=tau;}else if(d>0)d-=tau;const t=d/delta;if(t>EPS&&t<1-EPS)ts.push(t);};
 for(const r of rects){for(const x of [r.x,r.x+r.width]){const v=(x-c.x)/R;if(Math.abs(v)<=1){const a=Math.acos(v);add(a);add(-a);}}for(const y of [r.y,r.y+r.height]){const v=(y-c.y)/R;if(Math.abs(v)<=1){const a=Math.asin(v);add(a);add(Math.PI-a);}}}
 ts.sort((a,b)=>a-b);const inside=t=>{const a=start+delta*t;return rects.some(r=>inRect(point(c.x+R*Math.cos(a),c.y+R*Math.sin(a)),r));};
 for(let i=1;i<ts.length;i++)if(!inside((ts[i-1]+ts[i])/2))return false;
 return inside(0)&&inside(1);
}
function curvesConflict(A,B,diameter,sameCircuit){
 for(let i=0;i<A.length;i++)for(let j=sameCircuit?i+2:0;j<B.length;j++){
  const a=A[i],b=B[j],x=a.bounds,y=b.bounds;
  if(x.maxX+diameter<y.x||y.maxX+diameter<x.x||x.maxY+diameter<y.y||y.maxY+diameter<x.y)continue;
  const threshold=diameter+(a.type==='arc'?.02:0)+(b.type==='arc'?.02:0);
  for(let k=1;k<a.points.length;k++)for(let z=1;z<b.points.length;z++){
   const gap=b.offset+(z-1)*b.length/(b.points.length-1)-(a.offset+k*a.length/(a.points.length-1));
   if(sameCircuit&&gap<diameter*2)continue; // Neighbouring cross-sections of one pipe.
   if(segmentDistance(a.points[k-1],a.points[k],b.points[z-1],b.points[z])<threshold-EPS)return true;
  }
 }return false;
}
function curveCrossesSegment(p,a,b){
 if(p.type==='line')return intersect(p.a,p.b,a,b);
 const dx=b.x-a.x,dy=b.y-a.y,x=a.x-p.center.x,y=a.y-p.center.y,A=dx*dx+dy*dy,B=2*(x*dx+y*dy),C=x*x+y*y-p.radius*p.radius,disc=B*B-4*A*C;
 if(A<EPS||disc<-EPS)return false;
 for(const t of [(-B-Math.sqrt(Math.max(0,disc)))/(2*A),(-B+Math.sqrt(Math.max(0,disc)))/(2*A)]){
  if(t<-EPS||t>1+EPS)continue;const angle=Math.atan2(a.y+t*dy-p.center.y,a.x+t*dx-p.center.x);let d=(angle-p.start)%(Math.PI*2);
  if(p.delta>0&&d<0)d+=Math.PI*2;if(p.delta<0&&d>0)d-=Math.PI*2;
  if(d/p.delta>=-EPS&&d/p.delta<=1+EPS)return true;
 }return false;
}
function attachAttempt(core,rect,index,rects,ports,space,occupied,n,aligned=false){
 const p=ports[index],R=n.minBendRadiusMm;
 const a=core.route[0],b=core.route.at(-1),normal=core.normal;
 const lead=n.serviceReserve??(2*R+n.pipeDiameterMm*1.5);
 const leadA=aligned?lead-distance(p.supply,p.innerSupply)+n.wallOffsetMm:lead,leadB=aligned?lead-distance(p.returnPoint,p.innerReturn)+n.wallOffsetMm:lead;
 if(Math.min(leadA,leadB)<R)return null;
 const ai=point(a.x+normal.x*leadA,a.y+normal.y*leadA),bi=point(b.x+normal.x*leadB,b.y+normal.y*leadB);
 if(!space.covers(a,ai)||!space.covers(b,bi))return null;
 const blocked=rects.filter(r=>r!==rect);
 if(blocked.some(r=>segmentHitsBox(a,ai,r)||segmentHitsBox(b,bi,r)))return null;
 if(occupied.some(([c,d])=>segmentDistance(a,ai,c,d)<n.pipeDiameterMm*1.5-EPS||segmentDistance(b,bi,c,d)<n.pipeDiameterMm*1.5-EPS))return null;
 const direct=(port,end,blocked)=>distance(port,end)<=n.pitch*4&&terminalFree(port,end,n,space)&&!rects.some(r=>segmentBoxInterior(port,end,r))&&!blocked.some(([c,d])=>segmentDistance(port,end,c,d)<n.pipeDiameterMm+.1);
 const blocked1=[...occupied,...segments(core.route),[b,bi],[p.returnPoint,p.innerReturn]];
 const tail1=direct(p.supply,ai,blocked1)?[ai]:connector(p.innerSupply,ai,space,rects,blocked1,n);if(!tail1)return null;
 const part=clean([p.supply,...tail1,a,...core.route.slice(1),bi]);
 const blocked2=[...occupied,...segments(core.route),[a,ai],...segments([p.supply,...tail1])];
 const tail2=direct(p.returnPoint,bi,blocked2)?[bi]:connector(p.innerReturn,bi,space,rects,blocked2,n);if(!tail2)return null;
 const route=clean([...part,...tail2.slice().reverse().slice(1),p.returnPoint]);
 if(!bendsOK(route,R))return null;
 const c={id:index+1,route,length:length(route),core:core.route,coreLength:length(core.route),supply:p.supply,returnPoint:p.returnPoint,region:rect,bendRadiusMm:R};
 if(c.length>n.maxCircuitLengthMm+EPS)return null;
 return c;
}
function attach(...args){return attachAttempt(...args,false)||attachAttempt(...args,true);}
function segmentBoxInterior(a,b,r){
 let lo=0,hi=1;for(const [v,d,min,max] of [[a.x,b.x-a.x,r.x+EPS,r.x+r.width-EPS],[a.y,b.y-a.y,r.y+EPS,r.y+r.height-EPS]]){if(Math.abs(d)<EPS){if(v<min||v>max)return false;}else{const x=(min-v)/d,y=(max-v)/d;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));}}return lo<hi-EPS;
}
function terminalFree(port,other,n,space){
 const normal=portNormal(n.supply);if(!normal)return false;
 const depth=(other.x-port.x)*normal.x+(other.y-port.y)*normal.y;
 if(depth<n.wallOffsetMm-EPS)return false;
 const t=n.wallOffsetMm/depth,inner=point(port.x+(other.x-port.x)*t,port.y+(other.y-port.y)*t);
 return space.covers(port,other,space.raw)&&space.covers(inner,other);
}
function validate(input,plan,prepared){
 const n=normalize(input),space=prepared||freeSpace(n),cs=plan?.circuits||[];
 const H={H1_freeSpace:cs.length>0,H2_obstacles:cs.length>0,H3_crossings:cs.length>0,H4_bendRadius:cs.length>0,H5_continuity:cs.length>0,H6_circuitLimit:cs.length>0,H7_movementJoints:true};
 const all=[],curves=[],ports=manifoldPorts(n,plan?.manifold?.length||cs.length,space)||[];
 const joints=(n.deformationJoints||[]).map(j=>({...j,a:j.a||point(j.x1,j.y1),b:j.b||point(j.x2,j.y2)}));
 if(joints.some(j=>![j.a.x,j.a.y,j.b.x,j.b.y].every(Number.isFinite)))H.H7_movementJoints=false;
 let obstacleFree=space.raw;for(const o of n.obstacles||[]){const pad=n.pipeDiameterMm/2;obstacleFree=obstacleFree.flatMap(r=>subtract(r,{x:o.x-pad,y:o.y-pad,width:o.width+2*pad,height:o.height+2*pad}));}
 for(const c of cs){
  const route=c.route||[],ss=segments(route);
  if(route.length<2||!route.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))){Object.keys(H).forEach(k=>H[k]=false);continue;}
  H.H5_continuity&&=!!c.supply&&!!c.returnPoint&&ports.some(p=>same(c.supply,p.supply)&&same(c.returnPoint,p.returnPoint))&&same(route[0],c.supply)&&same(route.at(-1),c.returnPoint)&&ss.every(([a,b])=>distance(a,b)>EPS);
  H.H6_circuitLimit&&=length(route)<=n.maxCircuitLengthMm+EPS;
  H.H4_bendRadius&&=Math.abs((c.bendRadiusMm??n.minBendRadiusMm)-n.minBendRadiusMm)<EPS&&bendsOK(route,n.minBendRadiusMm);
  for(let i=0;i<ss.length;i++){
   const [a,b]=ss[i];let free=space.covers(a,b);
   if(!free&&(i===0||i===ss.length-1)){
    free=terminalFree(i===0?a:b,i===0?b:a,n,space);
   }
   H.H1_freeSpace&&=free;
   H.H2_obstacles&&=!(n.obstacles||[]).some(o=>segmentHitsBox(a,b,{x:o.x-n.pipeDiameterMm/2,y:o.y-n.pipeDiameterMm/2,width:o.width+n.pipeDiameterMm,height:o.height+n.pipeDiameterMm}));
   for(let j=0;j<i-1;j++)if(intersect(a,b,...ss[j]))H.H3_crossings=false;
   for(const [p,q] of all)if(intersect(a,b,p,q))H.H3_crossings=false;
  }
  all.push(...ss);
  const curve=rounded(route,n.minBendRadiusMm);
  if(curve){
   for(const j of joints)if(!(j.allowCrossing===true&&(j.sleeve===true||j.protected===true))&&curve.primitives.some(p=>curveCrossesSegment(p,j.a,j.b)))H.H7_movementJoints=false;
   for(let k=0;k<curve.primitives.length;k++){
    const p=curve.primitives[k];if(p.type!=='arc')continue;
    // Cabinet entry bends may straddle the wall offset; all other arcs must be
    // contained in the same eroded free space, checked at analytic crossings.
    const terminal=k===1||k===curve.primitives.length-2;
    H.H1_freeSpace&&=arcContained(p,terminal?space.raw:space.rects);
    H.H2_obstacles&&=arcContained(p,obstacleFree);
   }
   H.H3_crossings&&=!curvesConflict(curve.primitives,curve.primitives,n.pipeDiameterMm,true)&&!curves.some(other=>curvesConflict(curve.primitives,other,n.pipeDiameterMm,false));
   curves.push(curve.primitives);
  }
 }
 return {ok:Object.values(H).every(Boolean),checks:H};
}
function quality(input,plan,prepared){
 const n=normalize(input),space=prepared||freeSpace(n),cs=plan.circuits,ss=cs.flatMap(c=>segments(c.route));
 let samples=0,covered=0,totalDistance=0,totalArea=0;const stride=Math.max(n.pipeStepMm*.65,80);
 for(const r of space.rects){const nx=Math.max(1,Math.ceil(r.width/stride)),ny=Math.max(1,Math.ceil(r.height/stride));for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const p=point(r.x+(i+.5)*r.width/nx,r.y+(j+.5)*r.height/ny);let d=Infinity;for(const [a,b] of ss)d=Math.min(d,pointDistance(p,a,b));const weight=r.width*r.height/(nx*ny);samples++;totalArea+=weight;if(d<=n.pipeStepMm*.8)covered+=weight;totalDistance+=d*weight;
 }}
 const lengths=cs.map(c=>length(c.route)),total=lengths.reduce((a,b)=>a+b,0),mean=total/Math.max(1,cs.length),spread=(Math.max(...lengths)-Math.min(...lengths))/mean;
 const clamp=x=>Math.max(0,Math.min(1,x));
 const coreSegments=[];cs.forEach((c,ci)=>{let at=0;for(const [a,b] of segments(c.core||c.route)){const len=distance(a,b),h=Math.abs(a.y-b.y)<EPS;coreSegments.push({a,b,len,h,ci,dir:h?Math.sign(b.x-a.x):Math.sign(b.y-a.y),fraction:(at+len/2)/Math.max(1,c.coreLength||c.length)});at+=len;}});
 const bounds={left:Math.min(...n.sections.map(r=>r.x)),right:Math.max(...n.sections.map(r=>r.x+r.width)),top:Math.min(...n.sections.map(r=>r.y)),bottom:Math.max(...n.sections.map(r=>r.y+r.height))};
 let spacingWeight=0,spacingSum=0,pairSum=0,coldWeight=0,coldSum=0;const separations=[];
 for(const s of coreSegments){if(s.len<n.pitch*2)continue;let best=null;
  for(const t of coreSegments){if(s===t||s.h!==t.h)continue;const sep=s.h?Math.abs(s.a.y-t.a.y):Math.abs(s.a.x-t.a.x);if(sep<n.pipeDiameterMm)continue;
   const overlap=Math.min(Math.max(s.h?s.a.x:s.a.y,s.h?s.b.x:s.b.y),Math.max(t.h?t.a.x:t.a.y,t.h?t.b.x:t.b.y))-Math.max(Math.min(s.h?s.a.x:s.a.y,s.h?s.b.x:s.b.y),Math.min(t.h?t.a.x:t.a.y,t.h?t.b.x:t.b.y));
   if(overlap<Math.min(n.pitch,Math.min(s.len,t.len)*.3))continue;if(!best||sep<best.sep)best={sep,t};
  }
  if(!best)continue;const x=(s.a.x+s.b.x)/2,y=(s.a.y+s.b.y)/2,band=n.coldBandMm||800;
  const cold=(n.coldWalls||[]).some(w=>w==='left'?x<bounds.left+band:w==='right'?x>bounds.right-band:w==='top'?y<bounds.top+band:w==='bottom'?y>bounds.bottom-band:false);
  const target=cold?(n.coldStepMm||n.pipeStepMm):n.pipeStepMm,q=clamp(1-Math.abs(best.sep-target)/target);
  spacingWeight+=s.len;spacingSum+=q*s.len;separations.push(best.sep);
  if(s.ci===best.t.ci&&s.dir!==best.t.dir)pairSum+=s.len*clamp(Math.abs(s.fraction-best.t.fraction)/.35);
  if(cold){coldWeight+=s.len;coldSum+=q*s.len;}
 }
 const compact=cs.reduce((sum,c)=>{const rr=(c.regionIds||[]).map(i=>plan.regions?.[i]).filter(Boolean);if(!rr.length)return sum+1;const w=Math.max(...rr.map(r=>r.x+r.width))-Math.min(...rr.map(r=>r.x)),h=Math.max(...rr.map(r=>r.y+r.height))-Math.min(...rr.map(r=>r.y));return sum+rr.reduce((s,r)=>s+r.width*r.height,0)/(w*h);},0)/cs.length;
 const q={Q1_coverage:totalArea?covered/totalArea:0,Q2_spacing:spacingWeight?spacingSum/spacingWeight:0,Q3_balance:clamp(1-spread),Q4_compactness:compact,Q5_connectors:clamp(cs.reduce((s,c)=>s+(c.coreLength||0),0)/total),Q6_pairing:spacingWeight?pairSum/spacingWeight:0,Q7_installability:clamp(1-ss.length/(total/1000)/4),Q8_peripheral:coldWeight?coldSum/coldWeight:1};
 const weights=n.qualityWeights||[40,17,8,5,10,10,5,5];
 const score=Object.values(q).reduce((s,q,i)=>s+q*weights[i],0);
 separations.sort((a,b)=>a-b);
 return {score,values:q,coverage:q.Q1_coverage,meanDistance:totalDistance/Math.max(1,totalArea),samples,medianSpacing:separations[Math.floor(separations.length/2)]||null};
}
function plan(input){
 const started=Date.now();let n;try{n=normalize(input);}catch(e){return {ok:false,error:e.message,circuits:[]};}
 const space=freeSpace(n),candidates=[],diagnostics=[];
 const kinds=n.pattern==='auto'?['spiral','double-snake','snake','adaptive']:[n.pattern];
 if(!kinds.every(k=>['spiral','double-snake','snake','adaptive'].includes(k)))return {ok:false,error:'unsupported-pattern',circuits:[]};
 const area=space.rects.reduce((s,r)=>s+r.width*r.height,0),expectedCircuits=Math.max(1,Math.ceil(area/(n.maxCircuitLengthMm*n.pitch*.8)));
 const expandedReserve=2*n.minBendRadiusMm+expectedCircuits*n.pipeDiameterMm*3;
 for(const reserve of [n.minBendRadiusMm+n.pipeDiameterMm*1.5,2*n.minBendRadiusMm+n.pipeDiameterMm*1.5,expandedReserve]){
 if(reserve===expandedReserve&&kinds.every(k=>candidates.some(p=>p.kind===k)))break;
 n.serviceReserve=reserve;
 const seenPartitions=new Set();
 for(const axis of ['horizontal','vertical']){
  const rs=regions(space,n,axis,reserve);if(!rs?.length||rs.length>16)continue;
  const partitionKey=JSON.stringify(rs.map(r=>[r.x,r.y,r.width,r.height]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]||a[3]-b[3]));
  if(seenPartitions.has(partitionKey))continue;seenPartitions.add(partitionKey);
  for(const kind of kinds){
   for(const transpose of [false,true]){
   const groups=circuitRegions(rs,space,n,kind,transpose);
   for(const laneOrder of [1,-1]){
   if(laneOrder===-1&&candidates.some(p=>p.kind===kind))continue;
   const ports=manifoldPorts(n,groups.length,space,laneOrder);if(!ports)continue;
   for(const portFlip of [false,true]){
   if(portFlip&&groups.length===1)continue;
   const assignedPorts=portFlip?ports.slice().reverse():ports;
   for(const reverse of [false,true]){
    if(reverse&&groups.length===1)continue;
    const order=groups.map((g,i)=>({g,i,d:Math.max(...g.cycle.map(p=>distance(p,n.supply)))})).sort((a,b)=>reverse?a.d-b.d:b.d-a.d);
    const selected=[],occupied=[];let failed=false;
    for(const {g,i} of order){
     const family=kind==='adaptive'?g.patterns[0]:kind;
     const vars=groupVariants(g,n).sort((a,b)=>distance(a.route[0],assignedPorts[i].innerSupply)+distance(a.route.at(-1),assignedPorts[i].innerReturn)-distance(b.route[0],assignedPorts[i].innerSupply)-distance(b.route.at(-1),assignedPorts[i].innerReturn));
     let best=null;
     for(const v of vars){
      const c=attach(v,v.rect,i,rs,assignedPorts,space,occupied,n);if(!c)continue;c.pattern=family;c.regionIds=g.ids;
      const hard=validate(n,{circuits:[...selected,c],manifold:ports},space);if(!hard.ok)continue;
      best=c;break;
     }
     if(!best){failed=true;diagnostics.push({axis,kind,reverse,region:i,reason:'connectors'});break;}
     selected.push(best);occupied.push(...segments(best.route));
    }
    if(failed)continue;
    const p={ok:true,version:'2.6.1',planner:'unified-bcd',kind,axis,circuits:selected.sort((a,b)=>a.id-b.id),regions:rs,pathCover:groups.map(g=>g.ids),manifold:ports,totalLength:selected.reduce((s,c)=>s+c.length,0)};
    p.hard=validate(n,p,space);if(!p.hard.ok)continue;p.quality=quality(n,p,space);p.coverage=p.quality.coverage;candidates.push(p);break;
   }
   }
   }
   }
  }
 }
 }
 candidates.sort((a,b)=>b.quality.score-a.quality.score||a.circuits.length-b.circuits.length||a.totalLength-b.totalLength);
 return candidates.length?{...candidates[0],candidatesChecked:candidates.length,elapsedMs:Date.now()-started}:{ok:false,error:'no-verified-layout',circuits:[],diagnostics,elapsedMs:Date.now()-started};
}
return {plan,validate,quality,normalize,freeSpace,decomposition,regions,rectangularCycle,coreVariants,clean,length,segments,intersect,segmentDistance,connector,manifoldPorts,bendsOK,attach,circuitRegions,groupVariants,rounded};
});
