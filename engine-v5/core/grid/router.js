/* Direction-aware rectilinear A*: arbitrary orthogonal free space, exact bend tests. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./patterns.js'),require('./rect-geometry.js'));else root.WarmGridRouter=factory(root.WarmGridPatterns,root.WarmRectGeometry);})(globalThis,function(S,Geo){
'use strict';
const EPS=1e-6,dirs=[[1,0],[0,1],[-1,0],[0,-1]],unique=a=>[...new Set(a)].sort((a,b)=>a-b);
const direction=n=>Math.abs(n.x)>.5?(n.x>0?0:2):(n.y>0?1:3);
class Heap{constructor(){this.a=[];}push(v){let i=this.a.length;this.a.push(v);while(i){const p=(i-1)>>1;if(this.a[p].f<=v.f)break;this.a[i]=this.a[p];i=p;}this.a[i]=v;}pop(){const f=this.a[0],v=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let c=i*2+1;if(c+1<this.a.length&&this.a[c+1].f<this.a[c].f)c++;if(v.f<=this.a[c].f)break;this.a[i]=this.a[c];i=c;}this.a[i]=v;}return f;}}
function route(a,b,ctx,boxes,occupied,o){
 const {space,p}=ctx,R=o.radiusMm,gap=o.clearanceMm??Math.max(p.pipe.diameterMm*1.5,24),startDir=direction(o.startNormal),endDir=direction(o.endNormal),deadline=o.deadline,workBudget=o.workBudget;
 const soft=o.softBoxes||[],events=[...boxes,...soft];
 const xs=unique([a.x,b.x,a.x-R,a.x+R,b.x-R,b.x+R,...space.rects.flatMap(r=>[r.x,r.x+r.width].flatMap(v=>[v,v-R,v+R])),...events.flatMap(r=>[r.x-gap,r.x+r.width+gap]),...occupied.flatMap(([c,d])=>[c.x-gap,c.x+gap,d.x-gap,d.x+gap])]);
 const ys=unique([a.y,b.y,a.y-R,a.y+R,b.y-R,b.y+R,...space.rects.flatMap(r=>[r.y,r.y+r.height].flatMap(v=>[v,v-R,v+R])),...events.flatMap(r=>[r.y-gap,r.y+r.height+gap]),...occupied.flatMap(([c,d])=>[c.y-gap,c.y+gap,d.y-gap,d.y+gap])]);
 const nx=xs.length,ny=ys.length,N=nx*ny;if(N>120000)return null;
 const point=k=>({x:xs[k%nx],y:ys[Math.floor(k/nx)]});
 const ix=v=>xs.findIndex(x=>Math.abs(x-v)<EPS),iy=v=>ys.findIndex(y=>Math.abs(y-v)<EPS);
 const start=iy(a.y)*nx+ix(a.x),end=iy(b.y)*nx+ix(b.x);if(start<0||end<0)return null;
 const blocked=(q)=>boxes.some(r=>q.x>=r.x-EPS&&q.x<=r.x+r.width+EPS&&q.y>=r.y-EPS&&q.y<=r.y+r.height+EPS);
 const allowed=new Map(),edges=new Map(),turns=new Map();
 const nodeOK=k=>{if(!allowed.has(k)){const q=point(k);allowed.set(k,space.contains(q)&&!blocked(q)&&occupied.every(([c,d])=>Geo.segmentDistance(q,q,c,d)>=gap-EPS));}return allowed.get(k);};
 const hit=(c,d,r)=>c.x===d.x?c.x>=r.x-EPS&&c.x<=r.x+r.width+EPS&&Math.max(c.y,d.y)>=r.y-EPS&&Math.min(c.y,d.y)<=r.y+r.height+EPS:c.y>=r.y-EPS&&c.y<=r.y+r.height+EPS&&Math.max(c.x,d.x)>=r.x-EPS&&Math.min(c.x,d.x)<=r.x+r.width+EPS;
 const edgeOK=(k,v)=>{const key=Math.min(k,v)*N+Math.max(k,v);if(!edges.has(key)){const c=point(k),d=point(v);edges.set(key,space.covers(c,d)&&!boxes.some(r=>hit(c,d,r))&&occupied.every(([e,f])=>Geo.segmentDistance(c,d,e,f)>=gap-EPS));}return edges.get(key);};
 const turnOK=(k,d,e)=>{const key=k*16+d*4+e;if(!turns.has(key)){const q=point(k),u=dirs[d],v=dirs[e],path=[{x:q.x-u[0]*R,y:q.y-u[1]*R},q,{x:q.x+v[0]*R,y:q.y+v[1]*R}];
   const arc=S.geometry.roundPath(path,R).find(s=>s.type==='curve');
   let ok=!!arc&&S.geometry.arcInside({space,p},arc);
   if(ok)for(let i=0;i<=12&&ok;i++){const t=arc.startAngle+arc.sweepAngle*i/12,c={x:arc.center.x+R*Math.cos(t),y:arc.center.y+R*Math.sin(t)};if(occupied.some(([a,b])=>Geo.segmentDistance(c,c,a,b)<gap+R*(1-Math.cos(Math.PI/48))-EPS))ok=false;}
   turns.set(key,ok);
  }return turns.get(key);};
 if(!nodeOK(start)||!nodeOK(end))return null;
 const costs=new Map(),heap=new Heap(),key=(k,d,run)=>k+'/'+d+'/'+Math.round(Math.min(2*R,run)*1e5);
 const initial={k:start,d:startDir,run:2*R,g:0,f:Math.abs(a.x-b.x)+Math.abs(a.y-b.y),prev:null};initial.key=key(start,startDir,2*R);costs.set(initial.key,0);heap.push(initial);let expanded=0;
 while(heap.a.length){
  if(workBudget&&workBudget.consumed>=workBudget.limit)throw new Error('DIAGNOSTIC_WORK_BUDGET');
  if((++expanded&127)===0){
   if(workBudget&&Date.now()>workBudget.emergencyDeadline)throw new Error('DIAGNOSTIC_WALL_GUARD');
   if(!workBudget&&(Date.now()>deadline||expanded>80000))return null;
   if(workBudget&&expanded>80000)return null;
  }
  const s=heap.pop();if(s.g>costs.get(s.key)+EPS)continue;
  if(workBudget)workBudget.consumed++;
  const q=point(s.k);
  if(s.k===end&&s.d!==(endDir+2)%4&&(s.d===endDir||s.run>=2*R-EPS&&turnOK(s.k,s.d,endDir))){const out=[];for(let r=s;r;r=r.prev)out.push(point(r.k));const candidate=Geo.clean(out.reverse());if(!o.goalFilter||o.goalFilter(candidate))return candidate;}
  const x=s.k%nx,y=Math.floor(s.k/nx),vs=[x+1<nx?s.k+1:-1,y+1<ny?s.k+nx:-1,x?s.k-1:-1,y?s.k-nx:-1];
  for(let d=0;d<4;d++){
   const k=vs[d];if(k<0||d===(s.d+2)%4||!nodeOK(k))continue;
   const turn=d!==s.d;if(turn&&(s.run<2*R-EPS||!turnOK(s.k,s.d,d)))continue;if(!edgeOK(s.k,k))continue;
   const v=point(k),len=Math.abs(v.x-q.x)+Math.abs(v.y-q.y),run=Math.min(2*R,turn?len:s.run+len);
   const penalty=soft.reduce((sum,r)=>sum+(q.x===v.x?(q.x>r.x&&q.x<r.x+r.width?Math.max(0,Math.min(Math.max(q.y,v.y),r.y+r.height)-Math.max(Math.min(q.y,v.y),r.y)):0):(q.y>r.y&&q.y<r.y+r.height?Math.max(0,Math.min(Math.max(q.x,v.x),r.x+r.width)-Math.max(Math.min(q.x,v.x),r.x)):0)),0);
   const g=s.g+len+(turn?R*3:0)+penalty*30,id=key(k,d,run);
   if(g>=(costs.get(id)??Infinity)-EPS)continue;costs.set(id,g);heap.push({k,d,run,g,f:g+Math.abs(v.x-b.x)+Math.abs(v.y-b.y),prev:s,key:id});
  }
 }
 return null;
}
return{route};
});
