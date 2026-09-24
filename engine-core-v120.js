(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.UFHEngine=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const EPS=1e-6;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const hypot=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

  function boundsOf(rects){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const r of rects||[]){minX=Math.min(minX,r.x);minY=Math.min(minY,r.y);maxX=Math.max(maxX,r.x+r.width);maxY=Math.max(maxY,r.y+r.height);}
    if(!isFinite(minX)) return {minX:0,minY:0,maxX:1,maxY:1,width:1,height:1};
    return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
  }
  function inRect(x,y,r){return x>=r.x-EPS&&x<=r.x+r.width+EPS&&y>=r.y-EPS&&y<=r.y+r.height+EPS;}
  function inRoom(x,y,sections){for(const r of sections)if(inRect(x,y,r))return true;return false;}
  function inObstacle(x,y,obs){for(const r of obs||[])if(inRect(x,y,r))return true;return false;}

  function chooseResolution(b){
    let res=25;
    const cells=Math.ceil((b.width+600)/res)*Math.ceil((b.height+600)/res);
    if(cells>650000)res=50;
    if(Math.ceil((b.width+600)/res)*Math.ceil((b.height+600)/res)>900000)res=75;
    return res;
  }

  function makeGrid(input){
    const sections=input.sections||[], obstacles=input.obstacles||[];
    const b=boundsOf(sections); const res=chooseResolution(b);
    const pad=Math.max(250,input.wallOffsetMm||100,input.pipeStepMm||150);
    const ox=Math.floor((b.minX-pad)/res)*res, oy=Math.floor((b.minY-pad)/res)*res;
    const maxX=Math.ceil((b.maxX+pad)/res)*res, maxY=Math.ceil((b.maxY+pad)/res)*res;
    const cols=Math.max(3,Math.ceil((maxX-ox)/res)), rows=Math.max(3,Math.ceil((maxY-oy)/res));
    const inside=new Uint8Array(cols*rows);
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const x=ox+(i+.5)*res,y=oy+(j+.5)*res,k=j*cols+i;
      inside[k]=(inRoom(x,y,sections)&&!inObstacle(x,y,obstacles))?1:0;
    }
    const dist=new Float32Array(cols*rows); const INF=1e9;
    for(let k=0;k<dist.length;k++)dist[k]=inside[k]?INF:0;
    const wDiag=Math.SQRT2;
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const k=j*cols+i;if(!inside[k])continue;let d=dist[k];
      if(i>0)d=Math.min(d,dist[k-1]+1); if(j>0)d=Math.min(d,dist[k-cols]+1);
      if(i>0&&j>0)d=Math.min(d,dist[k-cols-1]+wDiag);if(i+1<cols&&j>0)d=Math.min(d,dist[k-cols+1]+wDiag);dist[k]=d;
    }
    for(let j=rows-1;j>=0;j--)for(let i=cols-1;i>=0;i--){
      const k=j*cols+i;if(!inside[k])continue;let d=dist[k];
      if(i+1<cols)d=Math.min(d,dist[k+1]+1); if(j+1<rows)d=Math.min(d,dist[k+cols]+1);
      if(i+1<cols&&j+1<rows)d=Math.min(d,dist[k+cols+1]+wDiag);if(i>0&&j+1<rows)d=Math.min(d,dist[k+cols-1]+wDiag);dist[k]=d;
    }
    function maskFor(clearance){const cells=clearance/res;const out=new Uint8Array(cols*rows);for(let k=0;k<out.length;k++)out[k]=inside[k]&&dist[k]>=cells?1:0;return out;}
    const coverageClearance=Math.max(0,(input.wallOffsetMm||100)+(input.pipeDiameterMm||16)/2);
    const tailClearance=Math.max((input.pipeDiameterMm||16)*1.6,Math.min(input.wallOffsetMm||100,Math.max(50,(input.pipeStepMm||150)*.45)));
    return {res,ox,oy,cols,rows,bounds:b,inside,dist,coverage:maskFor(coverageClearance),tail:maskFor(tailClearance),coverageClearance,tailClearance};
  }

  function intervalRows(grid,axis,phase,stepCells){
    const {coverage,cols,rows}=grid; const lanes=[];
    const outer=axis==='horizontal'?rows:cols, inner=axis==='horizontal'?cols:rows;
    for(let q=phase;q<outer;q+=stepCells){
      const ints=[];let s=-1;
      for(let p=0;p<=inner;p++){
        const on=p<inner?(axis==='horizontal'?coverage[q*cols+p]:coverage[p*cols+q]):0;
        if(on&&s<0)s=p;
        if((!on||p===inner)&&s>=0){const e=p-1;if(e>=s)ints.push({a:s,b:e});s=-1;}
      }
      if(ints.length)lanes.push({q,intervals:ints});
    }
    return lanes;
  }

  function overlapLen(a,b){return Math.max(0,Math.min(a.b,b.b)-Math.max(a.a,b.a)+1);}
  function decompose(lanes,grid,axis,stepCells){
    let nextId=1; const zones=new Map(); let prev=[]; const tol=Math.max(1,Math.floor(stepCells*.25));
    for(let li=0;li<lanes.length;li++){
      const lane=lanes[li]; const curr=lane.intervals.map((iv,idx)=>({iv,idx,zone:null}));
      const pDeg=prev.map(()=>0), cDeg=curr.map(()=>0), links=[];
      for(let pi=0;pi<prev.length;pi++)for(let ci=0;ci<curr.length;ci++){
        const ov=overlapLen(prev[pi].iv,curr[ci].iv); if(ov>=Math.max(1,Math.floor(stepCells*.4))){pDeg[pi]++;cDeg[ci]++;links.push([pi,ci]);}
      }
      for(const [pi,ci] of links){
        const p=prev[pi],c=curr[ci];
        const endpointShift=Math.max(Math.abs(p.iv.a-c.iv.a),Math.abs(p.iv.b-c.iv.b));
        if(pDeg[pi]===1&&cDeg[ci]===1&&endpointShift<=tol)c.zone=p.zone;
      }
      for(const c of curr){
        if(!c.zone)c.zone=nextId++;
        if(!zones.has(c.zone))zones.set(c.zone,{id:c.zone,axis,lanes:[]});
        zones.get(c.zone).lanes.push({q:lane.q,a:c.iv.a,b:c.iv.b});
      }
      prev=curr;
    }
    const minCells=Math.max(2,Math.floor(stepCells*.7));
    return [...zones.values()].filter(z=>{
      let sum=0;for(const l of z.lanes)sum+=l.b-l.a+1;
      return sum>=minCells;
    });
  }

  function lanePoint(grid,axis,q,p){
    if(axis==='horizontal')return{x:grid.ox+(p+.5)*grid.res,y:grid.oy+(q+.5)*grid.res};
    return{x:grid.ox+(q+.5)*grid.res,y:grid.oy+(p+.5)*grid.res};
  }
  function routeLength(route){let s=0;for(let i=1;i<route.length;i++)s+=hypot(route[i-1],route[i]);return s;}
  function simplify(route){
    const out=[];for(const p of route){const q=out[out.length-1];if(q&&Math.abs(q.x-p.x)<EPS&&Math.abs(q.y-p.y)<EPS)continue;out.push({...p});while(out.length>=3){const a=out[out.length-3],b=out[out.length-2],c=out[out.length-1];if((Math.abs(a.x-b.x)<EPS&&Math.abs(b.x-c.x)<EPS)||(Math.abs(a.y-b.y)<EPS&&Math.abs(b.y-c.y)<EPS))out.splice(out.length-2,1);else break;}}
    return out;
  }
  function buildZoneRoute(zone,grid,reverse=false,startRight=false){
    const ls=reverse?[...zone.lanes].reverse():[...zone.lanes]; if(!ls.length)return[];
    const route=[];let toRight=startRight;
    for(let i=0;i<ls.length;i++){
      const l=ls[i]; const pa=lanePoint(grid,zone.axis,l.q,l.a), pb=lanePoint(grid,zone.axis,l.q,l.b);
      const start=toRight?pa:pb,end=toRight?pb:pa;
      if(!route.length)route.push(start);else{
        const last=route[route.length-1];
        if(zone.axis==='horizontal'){
          if(Math.abs(last.x-start.x)>grid.res*.75)route.push({x:last.x,y:start.y});
        }else{
          if(Math.abs(last.y-start.y)>grid.res*.75)route.push({x:start.x,y:last.y});
        }
        route.push(start);
      }
      route.push(end);toRight=!toRight;
    }
    return simplify(route);
  }

  function splitZone(zone,grid,maxCircuitMm){
    const target=Math.max(5000,maxCircuitMm*.68); const chunks=[];let start=0;
    while(start<zone.lanes.length){let best=start+1;let len=0;
      for(let end=start+1;end<=zone.lanes.length;end++){
        const test={...zone,lanes:zone.lanes.slice(start,end)};const r=buildZoneRoute(test,grid,false,false);const L=routeLength(r);
        if(L<=target||end===start+1){best=end;len=L;}else break;
      }
      chunks.push({...zone,id:`${zone.id}-${chunks.length+1}`,lanes:zone.lanes.slice(start,best)});start=best;
    }
    if(chunks.length>1){const last=chunks[chunks.length-1],prev=chunks[chunks.length-2];const l1=routeLength(buildZoneRoute(last,grid,false,false)),l2=routeLength(buildZoneRoute(prev,grid,false,false));if(l1<target*.22&&l1+l2<maxCircuitMm*.82){prev.lanes=[...prev.lanes,...last.lanes];chunks.pop();}}
    return chunks;
  }

  class Heap{constructor(){this.a=[];}push(x){const a=this.a;a.push(x);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=x.f)break;a[i]=a[p];i=p;}a[i]=x;}pop(){const a=this.a;if(!a.length)return null;const top=a[0],last=a.pop();if(a.length){let i=0;a[0]=last;for(;;){let l=i*2+1,r=l+1,b=i;if(l<a.length&&a[l].f<a[b].f)b=l;if(r<a.length&&a[r].f<a[b].f)b=r;if(b===i)break;[a[i],a[b]]=[a[b],a[i]];i=b;}}return top;}get length(){return this.a.length;}}
  function nearestCell(grid,mask,p,maxR=14){
    const ci=Math.round((p.x-grid.ox)/grid.res-.5),cj=Math.round((p.y-grid.oy)/grid.res-.5);let best=null,bd=Infinity;
    for(let r=0;r<=maxR;r++)for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++){if(Math.max(Math.abs(di),Math.abs(dj))!==r)continue;const i=ci+di,j=cj+dj;if(i<0||j<0||i>=grid.cols||j>=grid.rows)continue;const k=j*grid.cols+i;if(!mask[k])continue;const x=grid.ox+(i+.5)*grid.res,y=grid.oy+(j+.5)*grid.res,d=(x-p.x)**2+(y-p.y)**2;if(d<bd){bd=d;best={i,j,k,x,y};}}
    return best;
  }
  function astar(grid,startP,goalP,usedPenalty){
    const mask=grid.tail, s=nearestCell(grid,mask,startP),g=nearestCell(grid,mask,goalP);if(!s||!g)return null;
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]], C=grid.cols,R=grid.rows, N=C*R*5,INF=1e30;
    const distA=new Float64Array(N);distA.fill(INF);const parent=new Int32Array(N);parent.fill(-1);const heap=new Heap();
    const sid=(s.k*5+4);distA[sid]=0;heap.push({id:sid,k:s.k,i:s.i,j:s.j,dir:4,g:0,f:Math.abs(s.i-g.i)+Math.abs(s.j-g.j)});let found=-1,iter=0,maxIter=Math.min(350000,C*R*18);
    while(heap.length&&iter++<maxIter){const cur=heap.pop();if(cur.g!==distA[cur.id])continue;if(cur.k===g.k){found=cur.id;break;}
      for(let nd=0;nd<4;nd++){const ni=cur.i+dirs[nd][0],nj=cur.j+dirs[nd][1];if(ni<0||nj<0||ni>=C||nj>=R)continue;const nk=nj*C+ni;if(!mask[nk])continue;let cost=1;if(cur.dir<4&&cur.dir!==nd)cost+=2.2;const dd=grid.dist[nk];const desired=(grid.coverageClearance/grid.res);if(dd<desired)cost+=(desired-dd)*.32;if(usedPenalty&&usedPenalty.has(nk)&&nk!==g.k)continue;const nid=nk*5+nd,ng=cur.g+cost;if(ng+1e-9<distA[nid]){distA[nid]=ng;parent[nid]=cur.id;const h=Math.abs(ni-g.i)+Math.abs(nj-g.j);heap.push({id:nid,k:nk,i:ni,j:nj,dir:nd,g:ng,f:ng+h});}}
    }
    if(found<0)return null;const cells=[];for(let id=found;id>=0;id=parent[id]){const k=Math.floor(id/5),i=k%C,j=Math.floor(k/C);cells.push({i,j,k,x:grid.ox+(i+.5)*grid.res,y:grid.oy+(j+.5)*grid.res});if(k===s.k)break;}cells.reverse();return simplify(cells.map(c=>({x:c.x,y:c.y,k:c.k})));
  }

  function nearestCellBox(grid,mask,p,maxR=14){
    const ci=Math.round((p.x-grid.ox)/grid.res-.5),cj=Math.round((p.y-grid.oy)/grid.res-.5);
    const i0=Math.max(0,ci-maxR),i1=Math.min(grid.cols-1,ci+maxR),j0=Math.max(0,cj-maxR),j1=Math.min(grid.rows-1,cj+maxR);
    let best=null,bd=Infinity;
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const k=j*grid.cols+i;if(!mask[k])continue;
      const x=grid.ox+(i+.5)*grid.res,y=grid.oy+(j+.5)*grid.res,d=(x-p.x)**2+(y-p.y)**2;
      if(d<bd){bd=d;best={i,j,k,x,y};}
    }
    return best;
  }

  function collectorEntry(input,grid,p){
    const side=(p&&p.side)||input.collectorSide||'left';const d=Math.max(input.wallOffsetMm||100,grid.tailClearance+grid.res);
    const q={x:p.x,y:p.y};if(side==='top')q.y+=d;else if(side==='bottom')q.y-=d;else if(side==='left')q.x+=d;else q.x-=d;
    // A manifold is often mounted inside a service cabinet or behind a fixed
    // furniture footprint. In that case the first free floor cell can be much
    // farther than the old 20-cell (500 mm) search radius. Search the whole
    // practical room extent and treat the direct manifold lead as an access
    // lead, not as a floor-heating pass.
    const maxR=Math.min(Math.max(grid.cols,grid.rows),Math.max(24,Math.ceil(1800/grid.res)));
    const c=nearestCellBox(grid,grid.tail,q,maxR);return c?{x:c.x,y:c.y}:q;
  }
  function synthReturn(supply,input){
    if(input.returnPoint)return input.returnPoint;const pitch=Math.max(40,(input.pipeDiameterMm||16)*2.6);const p={...supply};if(supply.side==='top'||supply.side==='bottom')p.x+=pitch;else p.y+=pitch;return p;
  }

  function pointSegmentDistance(p,a,b){
    const vx=b.x-a.x,vy=b.y-a.y,l2=vx*vx+vy*vy;if(l2<1e-9)return hypot(p,a);const t=clamp(((p.x-a.x)*vx+(p.y-a.y)*vy)/l2,0,1);return Math.hypot(p.x-(a.x+t*vx),p.y-(a.y+t*vy));
  }
  function segmentAxisCross(a,b,c,d){
    const ah=Math.abs(a.y-b.y)<EPS,bh=Math.abs(c.y-d.y)<EPS;
    if(ah===bh)return false;const h1=ah?a:c,h2=ah?b:d,v1=ah?c:a,v2=ah?d:b;const minx=Math.min(h1.x,h2.x),maxx=Math.max(h1.x,h2.x),miny=Math.min(v1.y,v2.y),maxy=Math.max(v1.y,v2.y);return v1.x>minx+EPS&&v1.x<maxx-EPS&&h1.y>miny+EPS&&h1.y<maxy-EPS;
  }
  function selfCross(route){for(let i=0;i<route.length-1;i++)for(let j=i+2;j<route.length-1;j++){if(j===i+1)continue;if(segmentAxisCross(route[i],route[i+1],route[j],route[j+1]))return true;}return false;}
  function validateInside(route,input){
    const step=25;
    for(let i=1;i<route.length;i++){
      const a=route[i-1],b=route[i],L=hypot(a,b),n=Math.max(1,Math.ceil(L/step));
      // The first and last segment are manifold access leads. They may pass
      // through a wall-attached service cabinet / excluded furniture zone;
      // all actual floor-heating geometry remains strictly outside obstacles.
      const accessLead=(i===1||i===route.length-1);
      for(let t=0;t<=n;t++){
        const u=t/n,x=a.x+(b.x-a.x)*u,y=a.y+(b.y-a.y)*u;
        if(!inRoom(x,y,input.sections))return false;
        if(!accessLead&&inObstacle(x,y,input.obstacles||[]))return false;
      }
    }
    return true;
  }
  function markRouteCells(route,grid,set){for(let s=1;s<route.length;s++){const a=route[s-1],b=route[s],L=hypot(a,b),n=Math.max(1,Math.ceil(L/grid.res));for(let t=0;t<=n;t++){const u=t/n,p={x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};const c=nearestCell(grid,grid.tail,p,1);if(c)set.add(c.k);}}}


  function reserveAccessCorridor(zone,grid,input){
    const s=input.supply||input.collector;if(!s||!zone?.lanes?.length)return zone;
    const corridor=Math.max(1,Math.round((input.pipeStepMm||150)/grid.res));
    let minP=Infinity,maxP=-Infinity;for(const l of zone.lanes){minP=Math.min(minP,l.a);maxP=Math.max(maxP,l.b);}const midP=(minP+maxP)/2;
    const firstQ=zone.lanes[0].q,lastQ=zone.lanes[zone.lanes.length-1].q,midQ=(firstQ+lastQ)/2;
    let side='none';
    if(zone.axis==='horizontal'){
      const midX=grid.ox+(midP+.5)*grid.res;side=s.x<=midX?'low':'high';
    }else{
      const midY=grid.oy+(midP+.5)*grid.res;side=s.y<=midY?'low':'high';
    }
    const lanes=zone.lanes.map(l=>{let a=l.a,b=l.b;if(side==='low'&&b-a>corridor+3)a+=corridor;else if(side==='high'&&b-a>corridor+3)b-=corridor;return{...l,a,b};});
    return {...zone,lanes,accessSide:side};
  }

  function routeCircuit(chunk,grid,input,used){
    const supply=input.supply||input.collector;if(!supply)return null;const ret=synthReturn(supply,input);const sEntry=collectorEntry(input,grid,supply),rEntry=collectorEntry(input,grid,ret);
    const prepared=reserveAccessCorridor(chunk,grid,input);
    const variants=[];for(const rev of [false,true])for(const right of [false,true])variants.push(buildZoneRoute(prepared,grid,rev,right));
    let best=null;
    for(const core of variants){if(core.length<2)continue;
      const avoid=new Set(used||[]);markRouteCells(core,grid,avoid);
      // Несколько контуров могут идти рядом у коллектора, поэтому небольшой общий входной коридор не блокируем.
      const shareR=Math.max(400,(input.pipeStepMm||150)*3.2);for(const k of [...avoid]){const i=k%grid.cols,j=Math.floor(k/grid.cols),x=grid.ox+(i+.5)*grid.res,y=grid.oy+(j+.5)*grid.res;if(Math.hypot(x-supply.x,y-supply.y)<shareR||Math.hypot(x-ret.x,y-ret.y)<shareR)avoid.delete(k);}
      // Оставляем небольшие окна у обоих концов локальной змейки, чтобы подвод мог войти в зону.
      for(const ep of [core[0],core[core.length-1]]){const c=nearestCell(grid,grid.tail,ep,2);if(c)for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const ii=c.i+di,jj=c.j+dj;if(ii>=0&&jj>=0&&ii<grid.cols&&jj<grid.rows)avoid.delete(jj*grid.cols+ii);}}
      const p1=astar(grid,sEntry,core[0],avoid);if(!p1)continue;
      const avoid2=new Set(avoid);markRouteCells(p1,grid,avoid2);for(const k of [...avoid2]){const i=k%grid.cols,j=Math.floor(k/grid.cols),x=grid.ox+(i+.5)*grid.res,y=grid.oy+(j+.5)*grid.res;if(Math.hypot(x-supply.x,y-supply.y)<shareR||Math.hypot(x-ret.x,y-ret.y)<shareR)avoid2.delete(k);}
      const p2=astar(grid,core[core.length-1],rEntry,avoid2);if(!p2)continue;
      const route=simplify([supply,...p1,...core.slice(1),...p2.slice(1),ret]);if(!validateInside(route,input)||selfCross(route))continue;const L=routeLength(route);const score=L+((p1.length+p2.length)*grid.res)*.2;if(!best||score<best.score)best={route,core,length:L,score};
    }
    return best;
  }

  function planOrientation(input,grid,axis){
    const stepCells=Math.max(2,Math.round((input.pipeStepMm||150)/grid.res));const phases=[];for(let p=0;p<stepCells;p++)phases.push(p);
    let best=null;
    for(const phase of phases){const lanes=intervalRows(grid,axis,phase,stepCells);if(!lanes.length)continue;const zones=decompose(lanes,grid,axis,stepCells);if(!zones.length)continue;
      let laneLen=0,short=0,areaEst=0;for(const z of zones)for(const l of z.lanes){const len=(l.b-l.a)*grid.res;laneLen+=len;areaEst+=(l.b-l.a+1)*grid.res*(input.pipeStepMm||150);if(len<Math.max(600,(input.pipeStepMm||150)*4))short++;}
      const score=zones.length*7000+short*1700-laneLen*.12; if(!best||score<best.score)best={axis,phase,lanes,zones,score,areaEst};
    }
    return best;
  }

  function freeArea(grid){let n=0;for(const x of grid.coverage)n+=x?1:0;return n*grid.res*grid.res;}
  function crossCircuits(circuits){
    for(let a=0;a<circuits.length;a++)for(let b=a+1;b<circuits.length;b++){
      const A=circuits[a].route,B=circuits[b].route;for(let i=0;i<A.length-1;i++)for(let j=0;j<B.length-1;j++){if(segmentAxisCross(A[i],A[i+1],B[j],B[j+1]))return true;}
    }return false;
  }

  function plan(input){
    const t0=Date.now(); if(!input||!input.sections?.length)return{ok:false,error:'Нет геометрии помещения'};if(!(input.supply||input.collector))return{ok:false,error:'Сначала укажите коллектор'};
    const grid=makeGrid(input);const options=[planOrientation(input,grid,'horizontal'),planOrientation(input,grid,'vertical')].filter(Boolean);if(!options.length)return{ok:false,error:'После учёта отступов не осталось области для укладки'};
    const maxCircuit=Math.max(20000,(input.maxCircuitLengthMm||100000));const plans=[];
    for(const opt of options){const chunks=[];for(const z of opt.zones)chunks.push(...splitZone(z,grid,maxCircuit));chunks.sort((a,b)=>{
      const ra=buildZoneRoute(a,grid,false,false),rb=buildZoneRoute(b,grid,false,false),s=input.supply||input.collector;const da=Math.min(hypot(ra[0],s),hypot(ra[ra.length-1],s)),db=Math.min(hypot(rb[0],s),hypot(rb[rb.length-1],s));return da-db;
    });
      const used=new Set(),circuits=[];let failed=false;const queue=[...chunks];let guard=0;
      while(queue.length&&guard++<40){const ch=queue.shift();let c=routeCircuit(ch,grid,input,used);
        if(!c && ch.lanes.length>=2){const mid=Math.ceil(ch.lanes.length/2);const a={...ch,id:String(ch.id)+'a',lanes:ch.lanes.slice(0,mid)},b={...ch,id:String(ch.id)+'b',lanes:ch.lanes.slice(mid)};queue.unshift(b);queue.unshift(a);continue;}
        if(!c){failed=true;break;}markRouteCells(c.route,grid,used);circuits.push(c);if(circuits.length>14){failed=true;break;}
      }
      if(failed||!circuits.length)continue;const total=circuits.reduce((s,c)=>s+c.length,0);const area=freeArea(grid);const coverage=Math.min(1,opt.areaEst/Math.max(1,area));const crossings=crossCircuits(circuits);const maxLen=Math.max(...circuits.map(c=>c.length));const score=(crossings?1e8:0)+circuits.length*10000+total+(1-coverage)*60000+Math.max(0,maxLen-maxCircuit)*20;plans.push({axis:opt.axis,circuits,totalLength:total,coverage,crossings,score,zones:opt.zones.length,resolution:grid.res});
    }
    if(!plans.length)return{ok:false,error:'Не удалось построить проходы к зонам без самопересечения. Попробуйте изменить положение коллектора или шаг трубы.',elapsedMs:Date.now()-t0};plans.sort((a,b)=>a.score-b.score);const p=plans[0];
    const warnings=[];if(p.crossings)warnings.push('Есть пересечение между подводящими трассами отдельных контуров.');if(p.coverage<.86)warnings.push('Часть доступной площади покрывается хуже заданного шага.');for(const c of p.circuits)if(c.length>maxCircuit)warnings.push('Один из контуров длиннее заданного максимума.');
    return{ok:true,version:'1.0',axis:p.axis,circuits:p.circuits.map((c,i)=>({id:i+1,route:c.route,length:c.length,coverageLength:routeLength(c.core)})),totalLength:p.totalLength,coverage:p.coverage,zones:p.zones,resolution:p.resolution,warnings,elapsedMs:Date.now()-t0,alternatives:plans.slice(1,3).map(x=>({axis:x.axis,circuits:x.circuits.length,totalLength:x.totalLength,coverage:x.coverage,score:x.score}))};
  }


  // v1.0 core-2: общий routing-tree. Подводящие трубы разных контуров
  // используют один и тот же коридор как пучок параллельных труб, вместо
  // независимого A* с взаимными пересечениями.
  function buildRoutingTreeV2(grid,input,blockedCore,endpoints){
    const mask=new Uint8Array(grid.tail);
    for(const k of blockedCore) if(k>=0&&k<mask.length) mask[k]=0;
    // Окна в покрытии около входов/выходов зон.
    for(const ep of endpoints){const c=nearestCell(grid,grid.tail,ep,3);if(!c)continue;for(let dj=-3;dj<=3;dj++)for(let di=-3;di<=3;di++){const i=c.i+di,j=c.j+dj;if(i>=0&&j>=0&&i<grid.cols&&j<grid.rows){const k=j*grid.cols+i;if(grid.tail[k])mask[k]=1;}}}
    const supply=input.supply||input.collector, entry=collectorEntry(input,grid,supply);const start=nearestCell(grid,mask,entry,30);if(!start)return null;
    const C=grid.cols,R=grid.rows,N=C*R,INF=1e30,distA=new Float64Array(N),prev=new Int32Array(N);distA.fill(INF);prev.fill(-1);
    const heap=new Heap();distA[start.k]=0;heap.push({f:0,k:start.k,i:start.i,j:start.j});const dirs=[[1,0],[-1,0],[0,1],[0,-1]];let iter=0,maxIter=Math.min(N*5,1500000);
    while(heap.length&&iter++<maxIter){const cur=heap.pop();if(cur.f!==distA[cur.k])continue;for(const [di,dj] of dirs){const i=cur.i+di,j=cur.j+dj;if(i<0||j<0||i>=C||j>=R)continue;const k=j*C+i;if(!mask[k])continue;const dd=grid.dist[k],desired=grid.coverageClearance/grid.res;let cost=1;if(dd<desired)cost+=(desired-dd)*.22;const ng=cur.f+cost;if(ng<distA[k]){distA[k]=ng;prev[k]=cur.k;heap.push({f:ng,k,i,j});}}}
    return {mask,start,entry,dist:distA,prev};
  }
  function treePathToV2(tree,grid,p){
    const c0=nearestCell(grid,tree.mask,p,8);if(!c0||!isFinite(tree.dist[c0.k])||tree.dist[c0.k]>=1e29)return null;
    let k=c0.k;const rev=[];let guard=0;while(k>=0&&guard++<grid.cols*grid.rows+5){const i=k%grid.cols,j=Math.floor(k/grid.cols);rev.push({x:grid.ox+(i+.5)*grid.res,y:grid.oy+(j+.5)*grid.res,k});if(k===tree.start.k)break;k=tree.prev[k];if(k<0)return null;}rev.reverse();return simplify(rev);
  }
  function prepareChunksV2(opt,grid,input,maxCircuit){
    const chunks=[];for(const z of opt.zones)for(const ch of splitZone(z,grid,maxCircuit))chunks.push(reserveAccessCorridor(ch,grid,input));return chunks;
  }
  function chunkVariantsV2(ch,grid){const v=[];for(const rev of [false,true])for(const right of [false,true]){const core=buildZoneRoute(ch,grid,rev,right);if(core.length>=2)v.push({core,rev,right});}return v;}
  function buildPlanFromChunksV2(opt,chunks,grid,input,maxCircuit){
    const allVars=chunks.map(ch=>chunkVariantsV2(ch,grid));if(allVars.some(v=>!v.length))return null;
    const blocked=new Set(),endpoints=[];
    for(const vars of allVars){markRouteCells(vars[0].core,grid,blocked);for(const v of vars){endpoints.push(v.core[0],v.core[v.core.length-1]);}}
    const tree=buildRoutingTreeV2(grid,input,blocked,endpoints);if(!tree)return null;
    const supply=input.supply||input.collector,ret=synthReturn(supply,input);const circuits=[];
    for(let idx=0;idx<chunks.length;idx++){
      let best=null;for(const v of allVars[idx]){const ps=treePathToV2(tree,grid,v.core[0]),pe=treePathToV2(tree,grid,v.core[v.core.length-1]);if(!ps||!pe)continue;const supplyTail=simplify([supply,tree.entry,...ps.slice(1)]);const returnTail=simplify([v.core[v.core.length-1],...pe.slice().reverse().slice(1),ret]);const L=routeLength(supplyTail)+routeLength(v.core)+routeLength(returnTail);const score=L+(ps.length+pe.length)*grid.res*.12;if(!best||score<best.score)best={supplyTail,core:v.core,returnTail,length:L,score};}
      if(!best)return null;circuits.push(best);
    }
    const total=circuits.reduce((s,c)=>s+c.length,0),area=freeArea(grid),coverage=Math.min(1,opt.areaEst/Math.max(1,area)),maxLen=Math.max(...circuits.map(c=>c.length));
    const over=circuits.filter(c=>c.length>maxCircuit*1.02).length;
    return {axis:opt.axis,circuits,totalLength:total,coverage,zones:opt.zones.length,resolution:grid.res,maxLen,over,score:circuits.length*9000+total+(1-coverage)*70000+over*200000};
  }
  function splitOverlongChunksV2(chunks,plan,maxCircuit){
    if(!plan)return chunks;let changed=false;const out=[];for(let i=0;i<chunks.length;i++){const ch=chunks[i],c=plan.circuits[i];if(c&&c.length>maxCircuit*1.02&&ch.lanes.length>=3){const mid=Math.ceil(ch.lanes.length/2);out.push({...ch,id:String(ch.id)+'a',lanes:ch.lanes.slice(0,mid)},{...ch,id:String(ch.id)+'b',lanes:ch.lanes.slice(mid)});changed=true;}else out.push(ch);}return changed?out:chunks;
  }
  function planV2(input){
    const t0=Date.now();if(!input||!input.sections?.length)return{ok:false,error:'Нет геометрии помещения'};if(!(input.supply||input.collector))return{ok:false,error:'Сначала укажите коллектор'};
    const grid=makeGrid(input),maxCircuit=Math.max(20000,input.maxCircuitLengthMm||100000);const opts=[planOrientation(input,grid,'horizontal'),planOrientation(input,grid,'vertical')].filter(Boolean);if(!opts.length)return{ok:false,error:'После учёта отступов не осталось области для укладки'};
    const plans=[];for(const opt of opts){let chunks=prepareChunksV2(opt,grid,input,maxCircuit),p=null;for(let pass=0;pass<4;pass++){p=buildPlanFromChunksV2(opt,chunks,grid,input,maxCircuit);if(!p)break;const next=splitOverlongChunksV2(chunks,p,maxCircuit);if(next===chunks)break;chunks=next;}if(p)plans.push(p);}
    if(!plans.length)return{ok:false,error:'Не удалось связать рабочие зоны с коллектором. Попробуйте изменить положение коллектора или увеличить шаг трубы.',elapsedMs:Date.now()-t0};plans.sort((a,b)=>a.score-b.score);const p=plans[0],warnings=[];if(p.coverage<.86)warnings.push('Покрытие свободной площади ниже 86%.');if(p.over)warnings.push(`${p.over} контур(а) длиннее заданного лимита.`);
    const circuits=p.circuits.map((c,i)=>({id:i+1,supplyTail:c.supplyTail,core:c.core,returnTail:c.returnTail,route:simplify([...c.supplyTail,...c.core.slice(1),...c.returnTail.slice(1)]),length:c.length,coverageLength:routeLength(c.core)}));
    return{ok:true,version:'1.0-core2',axis:p.axis,circuits,totalLength:p.totalLength,coverage:p.coverage,zones:p.zones,resolution:p.resolution,warnings,elapsedMs:Date.now()-t0,alternatives:plans.slice(1,3).map(x=>({axis:x.axis,circuits:x.circuits.length,totalLength:x.totalLength,coverage:x.coverage,score:x.score}))};
  }


  // ===== v1.1: circuit-first planner ======================================
  // Coverage zones are internal geometry only. We first try to combine all
  // zones into the minimum number of complete hydraulic circuits. Only when a
  // complete circuit would exceed the requested length (or cannot be routed)
  // do we increase the number of circuits.

  function coreVariantsV3(zone,grid){
    const variants=[];
    for(const rev of [false,true]) for(const right of [false,true]){
      const core=buildZoneRoute(zone,grid,rev,right);
      if(core.length>=2) variants.push({core,length:routeLength(core),rev,right});
    }
    variants.sort((a,b)=>a.length-b.length);
    return variants;
  }

  function zoneCenterV3(zone,grid){
    let sx=0,sy=0,n=0;
    for(const l of zone.lanes){
      const a=lanePoint(grid,zone.axis,l.q,l.a),b=lanePoint(grid,zone.axis,l.q,l.b);
      sx+=(a.x+b.x)/2;sy+=(a.y+b.y)/2;n++;
    }
    return n?{x:sx/n,y:sy/n}:{x:0,y:0};
  }

  function orderedZonesV3(zones,grid,input){
    const remaining=zones.map((z,i)=>({z,i,c:zoneCenterV3(z,grid)}));
    const out=[];let p=input.supply||input.collector||{x:0,y:0};
    while(remaining.length){
      let bi=0,bd=Infinity;
      for(let i=0;i<remaining.length;i++){
        const q=remaining[i].c,d=hypot(p,q);
        if(d<bd){bd=d;bi=i;}
      }
      const it=remaining.splice(bi,1)[0];out.push(it.z);p=it.c;
    }
    return out;
  }

  function partitionZonesV3(zones,grid,count){
    if(count<=1)return [zones];
    const weights=zones.map(z=>Math.max(1,coreVariantsV3(z,grid)[0]?.length||1));
    const total=weights.reduce((a,b)=>a+b,0),groups=[];let start=0,acc=0,target=total/count;
    for(let g=0;g<count;g++){
      if(g===count-1){groups.push(zones.slice(start));break;}
      let end=start,sum=0;
      const remainGroups=count-g-1;
      while(end<zones.length-remainGroups){
        const next=sum+weights[end];
        if(end>start && Math.abs(sum-target)<Math.abs(next-target))break;
        sum=next;end++;
      }
      if(end<=start)end=start+1;
      groups.push(zones.slice(start,end));start=end;acc+=sum;
      target=(total-acc)/Math.max(1,remainGroups);
    }
    return groups.filter(g=>g.length);
  }

  function cellKeyV3(grid,p){
    const c=nearestCell(grid,grid.tail,p,3);return c?c.k:-1;
  }

  function routeCellsV3(route,grid,out=new Set()){
    markRouteCells(route,grid,out);return out;
  }

  function openEndpointWindowV3(blocked,grid,p,r=2){
    const c=nearestCell(grid,grid.tail,p,4);if(!c)return;
    for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++){
      const i=c.i+di,j=c.j+dj;if(i>=0&&j>=0&&i<grid.cols&&j<grid.rows)blocked.delete(j*grid.cols+i);
    }
  }

  function segmentTailSafeV3(grid,a,b,blocked){
    if(Math.abs(a.x-b.x)>EPS&&Math.abs(a.y-b.y)>EPS)return false;
    const L=hypot(a,b),n=Math.max(1,Math.ceil(L/(grid.res*.65)));
    for(let q=0;q<=n;q++){
      const t=q/n,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      const c=nearestCell(grid,grid.tail,p,1);if(!c)return false;
      if(blocked?.has(c.k)&&q>0&&q<n)return false;
    }
    return true;
  }

  function connectorV3(grid,a,b,blocked){
    // Prefer a clean one- or two-bend orthogonal connector. A* is only a
    // fallback for concave walls/obstacles, so the visible result does not
    // become a staircase unless geometry really requires it.
    const mids=[{x:b.x,y:a.y},{x:a.x,y:b.y}];
    if(segmentTailSafeV3(grid,a,b,blocked))return [a,b];
    for(const m of mids){
      if(segmentTailSafeV3(grid,a,m,blocked)&&segmentTailSafeV3(grid,m,b,blocked))return simplify([a,m,b]);
    }
    const p=astar(grid,a,b,blocked);return p?simplify(p):null;
  }

  function buildCircuitV3(zones,grid,input,externalUsed){
    if(!zones.length)return null;
    const supply=input.supply||input.collector;if(!supply)return null;
    const ret=synthReturn(supply,input),sEntry=collectorEntry(input,grid,supply),rEntry=collectorEntry(input,grid,ret);
    const variants=zones.map(z=>coreVariantsV3(z,grid));
    if(variants.some(v=>!v.length))return null;

    // Keep the complete coverage geometry blocked while routing connectors.
    // We open small windows only at the endpoint currently being connected.
    const allCore=new Set();
    for(const vs of variants) routeCellsV3(vs[0].core,grid,allCore);
    const used=new Set(externalUsed||[]);
    let current=sEntry,route=[supply,sEntry],remaining=zones.map((z,i)=>i),coreLength=0;

    while(remaining.length){
      let best=null;
      // Prefer spatially nearby zones but evaluate all four sweep directions.
      for(const zi of remaining){
        for(const v of variants[zi]){
          for(const reversedCore of [false,true]){
            const core=reversedCore?[...v.core].reverse():v.core;
            const blocked=new Set([...allCore,...used]);
            openEndpointWindowV3(blocked,grid,current,2);openEndpointWindowV3(blocked,grid,core[0],3);
            const conn=connectorV3(grid,current,core[0],blocked);if(!conn)continue;
            const cLen=routeLength(conn),score=cLen+v.length*.015;
            if(!best||score<best.score)best={zi,core,conn,score};
          }
        }
      }
      if(!best)return null;
      route.push(...best.conn.slice(1),...best.core.slice(1));
      route=simplify(route);routeCellsV3(best.conn,grid,used);routeCellsV3(best.core,grid,used);
      coreLength+=routeLength(best.core);current=best.core[best.core.length-1];
      remaining=remaining.filter(x=>x!==best.zi);
    }

    // Return to the collector on a separate free corridor.
    const blocked=new Set([...allCore,...used]);
    openEndpointWindowV3(blocked,grid,current,3);openEndpointWindowV3(blocked,grid,rEntry,4);
    // Near the collector the two tails may run next to each other; release a
    // small local fan-out area, but never the rest of the already-laid route.
    const shareR=Math.max(260,(input.pipeStepMm||150)*2.2);
    for(const k of [...blocked]){
      const i=k%grid.cols,j=Math.floor(k/grid.cols),x=grid.ox+(i+.5)*grid.res,y=grid.oy+(j+.5)*grid.res;
      if(Math.hypot(x-supply.x,y-supply.y)<shareR)blocked.delete(k);
    }
    const back=connectorV3(grid,current,rEntry,blocked);if(!back)return null;
    route=simplify([...route,...back.slice(1),ret]);
    if(!validateInside(route,input)||selfCross(route))return null;
    const length=routeLength(route);
    return {route,length,coreLength};
  }

  function buildCircuitsForGroupsV3(groups,grid,input){
    const circuits=[],used=new Set();
    for(const group of groups){
      const c=buildCircuitV3(group,grid,input,used);if(!c)return null;
      routeCellsV3(c.route,grid,used);circuits.push(c);
    }
    return circuits;
  }

  function planOrientationV3(input,grid,opt,maxCircuit){
    const ordered=orderedZonesV3(opt.zones,grid,input);
    const minCore=ordered.reduce((s,z)=>s+(coreVariantsV3(z,grid)[0]?.length||0),0);
    // Start from the hydraulically minimal count. A small reserve is left for
    // the two collector tails and inter-zone connectors.
    let minCount=Math.max(1,Math.ceil(minCore/(maxCircuit*.88)));
    minCount=Math.min(minCount,Math.max(1,ordered.length));
    for(let count=minCount;count<=Math.min(Math.max(minCount+3,1),ordered.length);count++){
      const groups=partitionZonesV3(ordered,grid,count),circuits=buildCircuitsForGroupsV3(groups,grid,input);if(!circuits)continue;
      const maxLen=Math.max(...circuits.map(c=>c.length));
      if(maxLen>maxCircuit*1.02)continue;
      const total=circuits.reduce((s,c)=>s+c.length,0),area=freeArea(grid),coverage=Math.min(1,opt.areaEst/Math.max(1,area));
      return {axis:opt.axis,circuits,totalLength:total,coverage,zones:opt.zones.length,resolution:grid.res,maxLen,count,
        score:count*200000+total+(1-coverage)*90000};
    }
    return null;
  }

  function planV3(input){
    const t0=Date.now();
    if(!input||!input.sections?.length)return{ok:false,error:'Нет геометрии помещения'};
    if(!(input.supply||input.collector))return{ok:false,error:'Сначала укажите коллектор'};
    const grid=makeGrid(input),maxCircuit=Math.max(20000,input.maxCircuitLengthMm||100000);
    const opts=[planOrientation(input,grid,'horizontal'),planOrientation(input,grid,'vertical')].filter(Boolean);
    if(!opts.length)return{ok:false,error:'После учёта отступов не осталось области для укладки'};
    const plans=[];
    for(const opt of opts){const p=planOrientationV3(input,grid,opt,maxCircuit);if(p)plans.push(p);}
    if(!plans.length){
      // Keep the previous core as a conservative fallback rather than return a
      // questionable partial circuit.
      const old=planV2(input);if(old?.ok)return{...old,version:'1.1-fallback',warnings:[...(old.warnings||[]),'Использован резервный многоконтурный план: единый контур построить не удалось.'],elapsedMs:Date.now()-t0};
      return{ok:false,error:'Не удалось собрать полный контур с возвратом к коллектору. Попробуйте изменить положение коллектора или шаг трубы.',elapsedMs:Date.now()-t0};
    }
    plans.sort((a,b)=>a.score-b.score);const p=plans[0],warnings=[];
    if(p.coverage<.86)warnings.push('Часть свободной площади покрывается хуже заданного шага.');
    const circuits=p.circuits.map((c,i)=>({id:i+1,route:c.route,length:c.length,coverageLength:c.coreLength}));
    return{ok:true,version:'1.1-circuit-first',axis:p.axis,circuits,totalLength:p.totalLength,coverage:p.coverage,zones:p.zones,resolution:p.resolution,warnings,elapsedMs:Date.now()-t0,
      alternatives:plans.slice(1,3).map(x=>({axis:x.axis,circuits:x.circuits.length,totalLength:x.totalLength,coverage:x.coverage,score:x.score}))};
  }



  // ===== v1.2: Global Scanline Serpentine ================================
  // Primary strategy: do NOT decompose the room into independent coverage
  // zones. Instead, scan the whole free-space mask with equally-spaced global
  // lines and connect those lines into one regular serpentine. A scan
  // direction is considered "clean" only when every sampled line intersects
  // the free area in a single continuous interval. This makes wall-attached
  // notches/obstacles simply shorten individual passes instead of creating
  // artificial hydraulic zones. The older circuit-first planner remains a
  // fallback for true island obstacles that split scan lines into branches.

  function coverageCellAtV4(grid,p){
    const i=Math.round((p.x-grid.ox)/grid.res-.5),j=Math.round((p.y-grid.oy)/grid.res-.5);
    if(i<0||j<0||i>=grid.cols||j>=grid.rows)return false;
    return !!grid.coverage[j*grid.cols+i];
  }

  function segmentCoverageSafeV4(grid,a,b){
    if(Math.abs(a.x-b.x)>EPS&&Math.abs(a.y-b.y)>EPS)return false;
    const L=hypot(a,b),n=Math.max(1,Math.ceil(L/(grid.res*.45)));
    for(let q=0;q<=n;q++){
      const t=q/n,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      if(!coverageCellAtV4(grid,p))return false;
    }
    return true;
  }

  function countBendsV4(route){
    let n=0;
    for(let i=1;i<route.length-1;i++){
      const a=route[i-1],b=route[i],c=route[i+1];
      const d1x=Math.sign(b.x-a.x),d1y=Math.sign(b.y-a.y),d2x=Math.sign(c.x-b.x),d2y=Math.sign(c.y-b.y);
      if(d1x!==d2x||d1y!==d2y)n++;
    }
    return n;
  }

  function cleanConnectorV4(grid,a,b,allowTail=false){
    const safe=allowTail?
      (x,y)=>segmentTailSafeV3(grid,x,y,null):
      (x,y)=>segmentCoverageSafeV4(grid,x,y);
    if(safe(a,b))return [a,b];
    const mids=[{x:a.x,y:b.y},{x:b.x,y:a.y}];
    for(const m of mids)if(safe(a,m)&&safe(m,b))return simplify([a,m,b]);
    // Try one extra dog-leg. This is still a deliberate orthogonal connector,
    // not a cell-by-cell staircase.
    const d=Math.max(grid.res*2,grid.res*Math.round(150/grid.res));
    const xs=[a.x-d,a.x+d,b.x-d,b.x+d,(a.x+b.x)/2];
    const ys=[a.y-d,a.y+d,b.y-d,b.y+d,(a.y+b.y)/2];
    for(const x of xs){const p={x,y:a.y},q={x,y:b.y};if(safe(a,p)&&safe(p,q)&&safe(q,b))return simplify([a,p,q,b]);}
    for(const y of ys){const p={x:a.x,y},q={x:b.x,y};if(safe(a,p)&&safe(p,q)&&safe(q,b))return simplify([a,p,q,b]);}
    return null;
  }

  function scanCandidateV4(input,grid,axis,phase){
    const stepCells=Math.max(2,Math.round((input.pipeStepMm||150)/grid.res));
    const lanes=intervalRows(grid,axis,phase,stepCells);
    if(lanes.length<2)return null;
    let totalPass=0,short=0,multi=0;
    for(const lane of lanes){
      multi+=Math.max(0,lane.intervals.length-1);
      for(const iv of lane.intervals){
        const len=(iv.b-iv.a)*grid.res;totalPass+=len;
        if(len<Math.max(650,(input.pipeStepMm||150)*4.2))short++;
      }
    }
    const free=freeArea(grid),covered=Math.min(1,(totalPass*(input.pipeStepMm||150))/Math.max(1,free));
    return {axis,phase,lanes,multi,totalPass,short,coverage:covered};
  }

  function buildGlobalCoreV4(cand,grid,reverse=false,startPositive=false){
    // V1.2 primary mode deliberately accepts only one free interval per scan
    // line. This is the key simplification that produces regular construction
    // geometry. If an island splits a scan line, another orientation or the
    // conservative fallback handles it.
    if(cand.lanes.some(l=>l.intervals.length!==1))return null;
    const ls=reverse?[...cand.lanes].reverse():[...cand.lanes];
    const route=[];let positive=startPositive;
    for(let idx=0;idx<ls.length;idx++){
      const l=ls[idx],iv=l.intervals[0];
      const a=lanePoint(grid,cand.axis,l.q,iv.a),b=lanePoint(grid,cand.axis,l.q,iv.b);
      const start=positive?a:b,end=positive?b:a;
      if(!route.length){route.push(start,end);}
      else{
        const last=route[route.length-1];
        const conn=cleanConnectorV4(grid,last,start,false);
        if(!conn)return null;
        route.push(...conn.slice(1),end);
      }
      positive=!positive;
    }
    const r=simplify(route);
    if(selfCross(r))return null;
    return r;
  }

  function tailBlockedSetV4(core,grid){
    const s=new Set();routeCellsV3(core,grid,s);
    // release tiny windows at both ends for entry/exit
    openEndpointWindowV3(s,grid,core[0],3);openEndpointWindowV3(s,grid,core[core.length-1],3);
    return s;
  }

  function cleanTailV4(grid,a,b,blocked){
    // First try visually clean orthogonal tails.
    const safe=(p,q)=>segmentTailSafeV3(grid,p,q,blocked);
    if(safe(a,b))return [a,b];
    const mids=[{x:a.x,y:b.y},{x:b.x,y:a.y}];
    for(const m of mids)if(safe(a,m)&&safe(m,b))return simplify([a,m,b]);
    // A limited A* fallback is acceptable only for access tails. Collapse its
    // output to the minimum set of axis-aligned bends; never use it for the
    // coverage passes themselves.
    const p=astar(grid,a,b,blocked);return p?simplify(p):null;
  }

  function buildCompleteCircuitV4(core,grid,input,externalUsed){
    const supply=input.supply||input.collector;if(!supply||!core?.length)return null;
    const ret=synthReturn(supply,input),sEntry=collectorEntry(input,grid,supply),rEntry=collectorEntry(input,grid,ret);
    const blocked=tailBlockedSetV4(core,grid);
    for(const k of externalUsed||[])blocked.add(k);
    // Near the collector supply/return are allowed to fan out next to each
    // other; release only a compact local area.
    const shareR=Math.max(250,(input.pipeStepMm||150)*2.0);
    for(const k of [...blocked]){
      const i=k%grid.cols,j=Math.floor(k/grid.cols),x=grid.ox+(i+.5)*grid.res,y=grid.oy+(j+.5)*grid.res;
      if(Math.hypot(x-supply.x,y-supply.y)<shareR)blocked.delete(k);
    }
    const t1=cleanTailV4(grid,sEntry,core[0],blocked);if(!t1)return null;
    const blocked2=new Set(blocked);routeCellsV3(t1,grid,blocked2);openEndpointWindowV3(blocked2,grid,core[core.length-1],3);openEndpointWindowV3(blocked2,grid,rEntry,4);
    for(const k of [...blocked2]){
      const i=k%grid.cols,j=Math.floor(k/grid.cols),x=grid.ox+(i+.5)*grid.res,y=grid.oy+(j+.5)*grid.res;
      if(Math.hypot(x-supply.x,y-supply.y)<shareR)blocked2.delete(k);
    }
    const t2=cleanTailV4(grid,core[core.length-1],rEntry,blocked2);if(!t2)return null;
    const route=simplify([supply,sEntry,...t1.slice(1),...core.slice(1),...t2.slice(1),ret]);
    if(!validateInside(route,input)||selfCross(route))return null;
    const tailLen=routeLength(t1)+routeLength(t2),coreLen=routeLength(core),bends=countBendsV4(route);
    return {route,length:routeLength(route),coverageLength:coreLen,tailLength:tailLen,bends};
  }

  // ===== v1.3: balanced circuits + local sweep orientation ==============
  // Two improvements over V1.2:
  // 1) split long sweeps around an equal hydraulic target instead of greedily
  //    filling the first circuit up to a percentage of the limit;
  // 2) for composite non-overlapping rectangular rooms (T/L/custom made from
  //    abutting rectangles), choose the sweep axis independently per section
  //    and connect those local sweeps into complete hydraulic circuits.

  function lanePassLengthV5(lane,grid){
    if(!lane?.intervals?.length)return 0;
    return lane.intervals.reduce((s,iv)=>s+Math.max(0,(iv.b-iv.a)*grid.res),0);
  }

  function balancedContiguousGroupsV5(items,weights,count){
    const n=items.length;if(!n)return[];count=Math.max(1,Math.min(count,n));
    if(count===1)return [items.slice()];
    const pref=new Float64Array(n+1);for(let i=0;i<n;i++)pref[i+1]=pref[i]+Math.max(1,weights[i]||1);
    const total=pref[n],target=total/count,INF=1e30;
    const dp=Array.from({length:count+1},()=>new Float64Array(n+1));
    const prev=Array.from({length:count+1},()=>new Int32Array(n+1));
    for(let g=0;g<=count;g++)for(let i=0;i<=n;i++){dp[g][i]=INF;prev[g][i]=-1;}dp[0][0]=0;
    for(let g=1;g<=count;g++){
      for(let i=g;i<=n-(count-g);i++){
        let best=INF,bj=-1;
        for(let j=g-1;j<i;j++){
          if(dp[g-1][j]>=INF/2)continue;
          const w=pref[i]-pref[j],dev=(w-target)/Math.max(1,target);
          // Squared deviation produces balanced groups while the tiny boundary
          // term avoids unstable equal-cost splits.
          const cost=dp[g-1][j]+dev*dev+(i-j===1?0.002:0);
          if(cost<best){best=cost;bj=j;}
        }
        dp[g][i]=best;prev[g][i]=bj;
      }
    }
    const cuts=[];let i=n;for(let g=count;g>0;g--){const j=prev[g][i];if(j<0)return [items.slice()];cuts.push([j,i]);i=j;}cuts.reverse();
    return cuts.map(([a,b])=>items.slice(a,b)).filter(x=>x.length);
  }

  function circuitBalanceV5(circuits){
    if(!circuits?.length)return{mean:0,spread:0,cv:0};
    const a=circuits.map(c=>c.length),mean=a.reduce((s,x)=>s+x,0)/a.length;
    if(a.length===1)return{mean,spread:0,cv:0};
    const mn=Math.min(...a),mx=Math.max(...a),spread=(mx-mn)/Math.max(1,mean);
    const variance=a.reduce((s,x)=>s+(x-mean)*(x-mean),0)/a.length;
    return{mean,spread,cv:Math.sqrt(variance)/Math.max(1,mean)};
  }

  function coveragePenaltyV5(c){
    c=clamp(Number(c)||0,0,1);
    return Math.max(0,.95-c)*180000+(1-c)*12000;
  }

  function candidateMountingScoreV5(circuits,shortCount=0){
    let bends=0,tails=0;for(const c of circuits){bends+=c.bends??countBendsV4(c.route||[]);tails+=c.tailLength||Math.max(0,(c.length||0)-(c.coverageLength||c.coreLength||0));}
    return shortCount*2400+bends*520+tails*.45;
  }

  function balancedLaneGroupsV5(cand,grid,maxCircuit,count){
    const lanes=cand.lanes;if(!lanes.length)return[];
    const gap=lanes.length>1?Math.max(grid.res,Math.abs(lanes[1].q-lanes[0].q)*grid.res):grid.res;
    const weights=lanes.map(l=>lanePassLengthV5(l,grid)+gap*.75);
    return balancedContiguousGroupsV5(lanes,weights,count);
  }

  function buildScanGroupsV5(input,grid,cand,maxCircuit,groups){
    // Try scan order and reverse scan order. This keeps the visible geometry
    // regular while giving the collector a second chance if shared tails block
    // one ordering.
    const orders=[groups,[...groups].reverse()];let bestPlan=null;
    for(const ordered of orders){
      const used=new Set(),circuits=[];let failed=false;
      for(const lanes of ordered){
        const local={...cand,lanes};let best=null;
        for(const rev of [false,true])for(const pos of [false,true]){
          const core=buildGlobalCoreV4(local,grid,rev,pos);if(!core)continue;
          const c=buildCompleteCircuitV4(core,grid,input,used);if(!c||c.length>maxCircuit*1.015)continue;
          const supply=input.supply||input.collector;
          const nearStart=Math.min(hypot(core[0],supply),hypot(core[core.length-1],supply));
          const tinyLoopPenalty=nearStart<(input.pipeStepMm||150)*1.5?2500:0;
          const score=c.length+c.tailLength*1.45+c.bends*480+tinyLoopPenalty;
          if(!best||score<best.score)best={...c,score};
        }
        if(!best){failed=true;break;}
        routeCellsV3(best.route,grid,used);circuits.push(best);
      }
      if(failed||!circuits.length)continue;
      const totalLength=circuits.reduce((s,c)=>s+c.length,0),bal=circuitBalanceV5(circuits);
      const mounting=candidateMountingScoreV5(circuits,cand.short);
      const score=circuits.length*220000+totalLength+mounting+coveragePenaltyV5(cand.coverage)+bal.spread*170000+bal.cv*90000;
      const p={axis:cand.axis,phase:cand.phase,circuits,totalLength,coverage:cand.coverage,resolution:grid.res,score,global:true,multi:cand.multi,short:cand.short,balance:bal};
      if(!bestPlan||p.score<bestPlan.score)bestPlan=p;
    }
    return bestPlan;
  }

  function neighborPartitionsV5(groups,maxShift=2){
    const out=[];if(groups.length<2)return out;
    for(let b=0;b<groups.length-1;b++)for(const d of [-2,-1,1,2]){
      if(Math.abs(d)>maxShift)continue;
      const g=groups.map(x=>x.slice());
      if(d>0){if(g[b+1].length<=d)continue;g[b].push(...g[b+1].splice(0,d));}
      else {const n=-d;if(g[b].length<=n)continue;g[b+1].unshift(...g[b].splice(g[b].length-n,n));}
      out.push(g);
    }
    return out;
  }

  function buildScanPlanV4(input,grid,cand,maxCircuit){
    if(cand.multi>0)return null;
    const gap=cand.lanes.length>1?Math.max(grid.res,Math.abs(cand.lanes[1].q-cand.lanes[0].q)*grid.res):grid.res;
    const approx=cand.lanes.reduce((s,l)=>s+lanePassLengthV5(l,grid)+gap*.75,0);
    let minCount=Math.max(1,Math.ceil(approx/(maxCircuit*.92)));
    minCount=Math.min(minCount,cand.lanes.length);
    let best=null;
    // Prefer the minimum feasible hydraulic count. Within that count, choose
    // the most balanced contiguous split. Only add circuits if the length limit
    // cannot be respected.
    for(let count=minCount;count<=Math.min(cand.lanes.length,minCount+4);count++){
      const groups=balancedLaneGroupsV5(cand,grid,maxCircuit,count);
      const attempts=[groups];
      // On ordinary 2–3 circuit rooms, inspect nearby lane boundaries using
      // the *actual* routed lengths (including collector tails). This fixes the
      // common 90 m + 35 m greedy-looking split without making large plans slow.
      if(count>=2&&count<=3&&cand.lanes.length<=90)attempts.push(...neighborPartitionsV5(groups,2));
      let localBest=null;
      for(const gg of attempts){const p=buildScanGroupsV5(input,grid,cand,maxCircuit,gg);if(p&&(!localBest||p.score<localBest.score))localBest=p;}
      if(!localBest)continue;
      if(!best||localBest.circuits.length<best.circuits.length||(localBest.circuits.length===best.circuits.length&&localBest.score<best.score))best=localBest;
      if(localBest.circuits.length===count)break;
    }
    return best;
  }

  function rectsHaveInteriorOverlapV5(rects){
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j],w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      if(w>EPS&&h>EPS)return true;
    }
    return false;
  }

  function inRectHalfOpenV5(x,y,r){
    return x>=r.x-EPS&&y>=r.y-EPS&&x<r.x+r.width-EPS&&y<r.y+r.height-EPS;
  }

  function sectionSweepCandidateV5(input,grid,rect,axis,phase,sectionId){
    const stepCells=Math.max(2,Math.round((input.pipeStepMm||150)/grid.res));
    const outer=axis==='horizontal'?grid.rows:grid.cols,inner=axis==='horizontal'?grid.cols:grid.rows,lanes=[];
    for(let q=phase;q<outer;q+=stepCells){
      const qCoord=axis==='horizontal'?grid.oy+(q+.5)*grid.res:grid.ox+(q+.5)*grid.res;
      const qMin=axis==='horizontal'?rect.y:rect.x,qMax=qMin+(axis==='horizontal'?rect.height:rect.width);
      if(qCoord<qMin-EPS||qCoord>=qMax-EPS)continue;
      const ints=[];let s=-1;
      for(let p=0;p<=inner;p++){
        let on=false;
        if(p<inner){
          const x=axis==='horizontal'?grid.ox+(p+.5)*grid.res:qCoord;
          const y=axis==='horizontal'?qCoord:grid.oy+(p+.5)*grid.res;
          const k=axis==='horizontal'?q*grid.cols+p:p*grid.cols+q;
          on=!!grid.coverage[k]&&inRectHalfOpenV5(x,y,rect);
        }
        if(on&&s<0)s=p;
        if((!on||p===inner)&&s>=0){const e=p-1;if(e>=s)ints.push({a:s,b:e});s=-1;}
      }
      if(ints.length>1)return null; // a true internal split belongs to fallback
      if(ints.length)lanes.push({q,intervals:ints});
    }
    if(lanes.length<2)return null;
    let totalPass=0,short=0;for(const l of lanes){const len=lanePassLengthV5(l,grid);totalPass+=len;if(len<Math.max(650,(input.pipeStepMm||150)*4.2))short++;}
    const zone={id:`sec-${sectionId}`,axis,lanes:lanes.map(l=>({q:l.q,a:l.intervals[0].a,b:l.intervals[0].b}))};
    const variants=coreVariantsV3(zone,grid);if(!variants.length)return null;
    const bestCore=variants[0].length,avg=totalPass/lanes.length;
    // Every lane implies a U-turn; this is the main signal that makes the stem
    // of a T sweep vertically while its crossbar sweeps horizontally.
    const score=lanes.length*540+short*2400-bestCore*.018-avg*.025;
    return{zone,totalPass,short,score,axis,phase,coreLength:bestCore};
  }

  function bestSectionSweepV5(input,grid,rect,sectionId){
    const stepCells=Math.max(2,Math.round((input.pipeStepMm||150)/grid.res));let best=null;
    for(const axis of ['horizontal','vertical'])for(let phase=0;phase<stepCells;phase++){
      const c=sectionSweepCandidateV5(input,grid,rect,axis,phase,sectionId);if(c&&(!best||c.score<best.score))best=c;
    }
    return best;
  }

  function splitAdaptiveZoneV5(zone,grid,target){
    const vars=coreVariantsV3(zone,grid);if(!vars.length)return[];const L=vars[0].length;
    let count=Math.max(1,Math.ceil(L/Math.max(5000,target*1.12)));count=Math.min(count,zone.lanes.length);
    if(count<=1)return [zone];
    const weights=zone.lanes.map(l=>Math.max(1,(l.b-l.a)*grid.res));
    const groups=balancedContiguousGroupsV5(zone.lanes,weights,count);
    return groups.map((lanes,i)=>({...zone,id:`${zone.id}-${i+1}`,lanes}));
  }

  function partitionAdaptiveZonesV5(zones,grid,count){
    if(count<=1)return[zones];
    const weights=zones.map(z=>Math.max(1,coreVariantsV3(z,grid)[0]?.length||1));
    return balancedContiguousGroupsV5(zones,weights,count);
  }

  function buildAdaptivePlanV5(input,grid,maxCircuit){
    const sections=input.sections||[];
    if(sections.length<2||(input.obstacles&&input.obstacles.length)||rectsHaveInteriorOverlapV5(sections))return null;
    // Internal island obstacles need the conservative branch-aware fallback.
    // Wall-attached obstacles may still work, but skip the adaptive candidate
    // whenever a section sweep is split rather than produce questionable gaps.
    const chosen=[];for(let i=0;i<sections.length;i++){const c=bestSectionSweepV5(input,grid,sections[i],i);if(!c)return null;chosen.push(c);}
    const totalPass=chosen.reduce((s,c)=>s+c.totalPass,0),short=chosen.reduce((s,c)=>s+c.short,0),free=freeArea(grid);
    const coverage=Math.min(1,totalPass*(input.pipeStepMm||150)/Math.max(1,free));
    const totalCore=chosen.reduce((s,c)=>s+c.coreLength,0);
    let minCount=Math.max(1,Math.ceil(totalCore/(maxCircuit*.90))),best=null;
    for(let count=minCount;count<=Math.min(12,minCount+3);count++){
      const target=totalCore/count;let chunks=[];for(const c of chosen)chunks.push(...splitAdaptiveZoneV5(c.zone,grid,target));
      const ordered=orderedZonesV3(chunks,grid,input),groups=partitionAdaptiveZonesV5(ordered,grid,count);
      if(groups.length!==count)continue;
      const circuits=buildCircuitsForGroupsV3(groups,grid,input);if(!circuits)continue;
      if(circuits.some(c=>c.length>maxCircuit*1.015))continue;
      for(const c of circuits){c.coverageLength=c.coreLength;c.bends=countBendsV4(c.route);c.tailLength=Math.max(0,c.length-c.coreLength);}
      const totalLength=circuits.reduce((s,c)=>s+c.length,0),bal=circuitBalanceV5(circuits),mounting=candidateMountingScoreV5(circuits,short);
      const score=circuits.length*220000+totalLength+mounting+coveragePenaltyV5(coverage)+bal.spread*170000+bal.cv*90000;
      const p={axis:'mixed',circuits,totalLength,coverage,resolution:grid.res,score,adaptive:true,short,balance:bal,zones:chosen.length,
        localAxes:chosen.map((c,i)=>({section:i,axis:c.axis}))};
      if(!best||p.score<best.score)best=p;
      if(best&&best.circuits.length===count)break;
    }
    return best;
  }

  // ===== v1.4: multi-candidate optimizer =================================
  // V1.4 does not assume that one sweep orientation is best for the whole
  // room. It evaluates several global scan phases plus multiple rectangular
  // decompositions of the actual free space (including wall-attached
  // obstacles). All feasible candidates are then rescored with the same
  // mounting-quality objective.

  function uniqSortedV6(a){
    const x=[...a].filter(Number.isFinite).sort((m,n)=>m-n),out=[];
    for(const v of x)if(!out.length||Math.abs(v-out[out.length-1])>EPS)out.push(v);
    return out;
  }

  function freeAtRawV6(x,y,input){return inRoom(x,y,input.sections||[])&&!inObstacle(x,y,input.obstacles||[]);}

  function geometryBreaksV6(input){
    const all=[...(input.sections||[]),...(input.obstacles||[])],b=boundsOf(input.sections||[]);
    const xs=[b.minX,b.maxX],ys=[b.minY,b.maxY];
    for(const r of all){xs.push(r.x,r.x+r.width);ys.push(r.y,r.y+r.height);}
    return{xs:uniqSortedV6(xs.filter(x=>x>=b.minX-EPS&&x<=b.maxX+EPS)),ys:uniqSortedV6(ys.filter(y=>y>=b.minY-EPS&&y<=b.maxY+EPS))};
  }

  // Exact rectilinear partition of the raw free-space union. Horizontal and
  // vertical decompositions are both produced because each exposes different
  // useful local sweep choices around notches and wall-attached furniture.
  function decomposeFreeRectsV6(input,mode='horizontal'){
    const {xs,ys}=geometryBreaksV6(input);if(xs.length<2||ys.length<2)return[];
    const rects=[];
    if(mode==='horizontal'){
      for(let j=0;j<ys.length-1;j++){
        const y0=ys[j],y1=ys[j+1],ym=(y0+y1)/2;if(y1-y0<EPS)continue;
        let run=-1;
        for(let i=0;i<=xs.length-1;i++){
          const on=i<xs.length-1&&freeAtRawV6((xs[i]+xs[i+1])/2,ym,input);
          if(on&&run<0)run=i;
          if((!on||i===xs.length-1)&&run>=0){
            const x0=xs[run],x1=xs[i];if(x1-x0>EPS)rects.push({x:x0,y:y0,width:x1-x0,height:y1-y0});run=-1;
          }
        }
      }
      // Merge vertically adjacent strips with identical horizontal extent.
      rects.sort((a,b)=>a.y-b.y||a.x-b.x||a.width-b.width);const out=[];
      for(const r of rects){let m=null;for(let k=out.length-1;k>=0;k--){const q=out[k];if(q.y+q.height<r.y-EPS)break;if(Math.abs(q.x-r.x)<EPS&&Math.abs(q.width-r.width)<EPS&&Math.abs(q.y+q.height-r.y)<EPS){m=q;break;}}if(m)m.height+=r.height;else out.push({...r});}
      return out;
    }
    for(let i=0;i<xs.length-1;i++){
      const x0=xs[i],x1=xs[i+1],xm=(x0+x1)/2;if(x1-x0<EPS)continue;
      let run=-1;
      for(let j=0;j<=ys.length-1;j++){
        const on=j<ys.length-1&&freeAtRawV6(xm,(ys[j]+ys[j+1])/2,input);
        if(on&&run<0)run=j;
        if((!on||j===ys.length-1)&&run>=0){const y0=ys[run],y1=ys[j];if(y1-y0>EPS)rects.push({x:x0,y:y0,width:x1-x0,height:y1-y0});run=-1;}
      }
    }
    rects.sort((a,b)=>a.x-b.x||a.y-b.y||a.height-b.height);const out=[];
    for(const r of rects){let m=null;for(let k=out.length-1;k>=0;k--){const q=out[k];if(q.x+q.width<r.x-EPS)break;if(Math.abs(q.y-r.y)<EPS&&Math.abs(q.height-r.height)<EPS&&Math.abs(q.x+q.width-r.x)<EPS){m=q;break;}}if(m)m.width+=r.width;else out.push({...r});}
    return out;
  }

  function sectionAxisOptionsV6(input,grid,rect,sectionId){
    const stepCells=Math.max(2,Math.round((input.pipeStepMm||150)/grid.res)),out=[];
    for(const axis of ['horizontal','vertical']){
      let best=null;for(let phase=0;phase<stepCells;phase++){
        const c=sectionSweepCandidateV5(input,grid,rect,axis,phase,sectionId);if(c&&(!best||c.score<best.score))best=c;
      }
      if(best)out.push(best);
    }
    return out.sort((a,b)=>a.score-b.score);
  }

  function planQualityV6(plan,input,maxCircuit){
    const circuits=plan.circuits||[],bal=circuitBalanceV5(circuits);let bends=0,tails=0,nearLimit=0;
    for(const c of circuits){
      bends+=c.bends??countBendsV4(c.route||[]);
      tails+=c.tailLength??Math.max(0,(c.length||0)-(c.coverageLength??c.coreLength??0));
      const u=(c.length||0)/Math.max(1,maxCircuit);if(u>.90)nearLimit+=(u-.90)*42000;
    }
    const short=Math.max(0,plan.short||0),orientationChanges=Math.max(0,plan.orientationChanges||0),coverage=clamp(plan.coverage||0,0,1);
    const totalLength=plan.totalLength??circuits.reduce((s,c)=>s+(c.length||0),0);
    // Unified score for candidates with the SAME hydraulic circuit count.
    // Coverage and hydraulic balance dominate; then mounting simplicity,
    // collector tails and total pipe length decide between otherwise valid
    // plans. Mixed orientation has only a small transition cost, so it wins
    // whenever it genuinely removes many short passes/U-turns.
    const score=totalLength
      +coveragePenaltyV5(coverage)
      +bal.spread*185000+bal.cv*85000
      +short*3600+bends*720+tails*.60
      +orientationChanges*900+nearLimit;
    return{score,balance:bal,bends,tailLength:tails,short,orientationChanges,coverage,totalLength,maxUtil:circuits.length?Math.max(...circuits.map(c=>c.length/Math.max(1,maxCircuit))):0};
  }

  function rescorePlanV6(plan,input,maxCircuit){
    const q=planQualityV6(plan,input,maxCircuit);plan.score=q.score;plan.balance=q.balance;plan.quality=q;return plan;
  }

  function buildAdaptiveFromChosenV6(input,grid,maxCircuit,chosen,label){
    if(!chosen?.length)return null;
    const totalPass=chosen.reduce((s,c)=>s+c.totalPass,0),short=chosen.reduce((s,c)=>s+c.short,0),free=freeArea(grid);
    const coverage=Math.min(1,totalPass*(input.pipeStepMm||150)/Math.max(1,free));
    const totalCore=chosen.reduce((s,c)=>s+c.coreLength,0);
    let minCount=Math.max(1,Math.ceil(totalCore/(maxCircuit*.90))),best=null;
    for(let count=minCount;count<=Math.min(12,minCount+3);count++){
      const target=totalCore/count;let chunks=[];for(const c of chosen)chunks.push(...splitAdaptiveZoneV5(c.zone,grid,target));
      const ordered=orderedZonesV3(chunks,grid,input),groups=partitionAdaptiveZonesV5(ordered,grid,count);if(groups.length!==count)continue;
      const circuits=buildCircuitsForGroupsV3(groups,grid,input);if(!circuits)continue;
      if(circuits.some(c=>c.length>maxCircuit*1.015))continue;
      for(const c of circuits){c.coverageLength=c.coreLength;c.bends=countBendsV4(c.route);c.tailLength=Math.max(0,c.length-c.coreLength);}
      const totalLength=circuits.reduce((s,c)=>s+c.length,0);
      let orientationChanges=0;for(let i=1;i<chosen.length;i++)if(chosen[i].axis!==chosen[i-1].axis)orientationChanges++;
      const p={axis:new Set(chosen.map(c=>c.axis)).size>1?'mixed':chosen[0].axis,circuits,totalLength,coverage,resolution:grid.res,adaptive:true,short,zones:chosen.length,
        decomposition:label,orientationChanges,localAxes:chosen.map((c,i)=>({section:i,axis:c.axis}))};
      rescorePlanV6(p,input,maxCircuit);
      if(!best||p.score<best.score)best=p;
      if(best&&best.circuits.length===count)break;
    }
    return best;
  }

  function adaptiveRectPlansV6(input,grid,maxCircuit,rects,label){
    if(!rects?.length||rects.length>12)return[];
    const sets=[];for(let i=0;i<rects.length;i++){const o=sectionAxisOptionsV6(input,grid,rects[i],`${label}-${i}`);if(!o.length)return[];sets.push(o);}
    // Beam search over local H/V choices. Eight assignments are enough for the
    // common 2–6 zone plans while keeping iPhone calculation time bounded.
    let beam=[{chosen:[],localScore:0}];
    for(const opts of sets){const next=[];for(const b of beam)for(const o of opts)next.push({chosen:[...b.chosen,o],localScore:b.localScore+o.score});next.sort((a,b)=>a.localScore-b.localScore);beam=next.slice(0,4);}
    const plans=[];for(const b of beam){const p=buildAdaptiveFromChosenV6(input,grid,maxCircuit,b.chosen,label);if(p){p.cellRects=rects.map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}));plans.push(p);}}return plans;
  }

  function rectOrientationConflictV6(rects){
    let h=false,v=false;
    for(const r of rects||[]){
      const ar=Math.max(r.width,r.height)/Math.max(1,Math.min(r.width,r.height));
      if(ar<1.22)continue;
      if(r.width>r.height)h=true;else v=true;
    }
    return h&&v;
  }

  function candidateKeyV6(p){
    const axes=(p.localAxes||[]).map(x=>x.axis[0]).join('');return `${p.planner||''}|${p.axis}|${p.circuits?.length||0}|${p.decomposition||''}|${axes}|${Math.round((p.totalLength||0)/250)}`;
  }

  function planV6(input){
    const t0=Date.now();
    if(!input||!input.sections?.length)return{ok:false,error:'Нет геометрии помещения'};
    if(!(input.supply||input.collector))return{ok:false,error:'Сначала укажите коллектор'};
    const grid=makeGrid(input),maxCircuit=Math.max(20000,input.maxCircuitLengthMm||100000),stepCells=Math.max(2,Math.round((input.pipeStepMm||150)/grid.res));
    const candidates=[],raw=[];
    for(const axis of ['horizontal','vertical'])for(let phase=0;phase<stepCells;phase++){const cand=scanCandidateV4(input,grid,axis,phase);if(cand&&cand.multi===0)raw.push(cand);}
    const geomScore=c=>c.lanes.length*700+c.short*2600+coveragePenaltyV5(c.coverage)-c.totalPass*.01;
    const selected=[];
    // First route the single best phase of BOTH global orientations. The
    // orientation decision matters much more than shifting the same lane set
    // by 25–50 mm, and this keeps repeated mobile calculations responsive.
    for(const axis of ['horizontal','vertical']){
      const a=raw.filter(c=>c.axis===axis).sort((x,y)=>geomScore(x)-geomScore(y));if(a.length)selected.push(a[0]);
    }
    const seenScan=new Set();for(const c of selected){const key=`${c.axis}:${c.phase}`;seenScan.add(key);const p=buildScanPlanV4(input,grid,c,maxCircuit);if(p){p.planner='global-scanline';p.short=c.short;p.orientationChanges=0;rescorePlanV6(p,input,maxCircuit);candidates.push(p);}}
    // If preferred phases fail, progressively try the rest until both
    // orientations have had a fair chance.
    if(!candidates.length)for(const c of raw.sort((a,b)=>geomScore(a)-geomScore(b))){const key=`${c.axis}:${c.phase}`;if(seenScan.has(key))continue;seenScan.add(key);const p=buildScanPlanV4(input,grid,c,maxCircuit);if(p){p.planner='global-scanline';p.short=c.short;rescorePlanV6(p,input,maxCircuit);candidates.push(p);if(candidates.length>=2)break;}}

    const decH=decomposeFreeRectsV6(input,'horizontal'),decV=decomposeFreeRectsV6(input,'vertical');
    const sectionConflict=rectOrientationConflictV6(input.sections||[]),freeConflict=rectOrientationConflictV6(decH)||rectOrientationConflictV6(decV);
    const bestGlobal=candidates.length?[...candidates].sort((a,b)=>a.circuits.length-b.circuits.length||a.score-b.score)[0]:null;
    // V2.2: a concavity / wall-attached obstacle is itself a reason to compare
    // a cell-first plan even when one global scanline happens to be valid. This
    // does NOT force zoning: the common score still decides whether the local
    // cell layout is actually better. Keep the search bounded on mobile.
    const compactDecomposition=[decH,decV].some(rs=>rs.length>=2&&rs.length<=8);
    const geometrySuggestsCells=compactDecomposition&&((input.obstacles||[]).length>0||(input.sections||[]).length>1);
    // Local orientation is expensive. Run it when geometry actually contains
    // competing long axes (classic T/Z/L-with-notch cases), when no clean
    // global sweep exists (islands/branches), or when the global sweep shows
    // obvious quality symptoms. Plain L rooms with one sensible direction no
    // longer pay several seconds for candidates that cannot beat the global
    // plan.
    const needAdaptive=input.layoutFamiliesV232||!bestGlobal||sectionConflict||freeConflict||geometrySuggestsCells||(bestGlobal.short||0)>0||(bestGlobal.coverage||0)<.93;
    if(needAdaptive){
      if(!(input.obstacles&&input.obstacles.length)&&!rectsHaveInteriorOverlapV5(input.sections||[])){
        const legacyAdaptive=buildAdaptivePlanV5(input,grid,maxCircuit);if(legacyAdaptive){legacyAdaptive.planner='adaptive-zones';legacyAdaptive.decomposition='input-sections';rescorePlanV6(legacyAdaptive,input,maxCircuit);candidates.push(legacyAdaptive);}
      }
      // Explicit combined mode may compare local orientations even in a rectangle.
      if(input.layoutFamiliesV232&&decH.length===1){
        const r=decH[0],split=r.width>=r.height;
        const cells=split?[{...r,width:r.width/2},{...r,x:r.x+r.width/2,width:r.width/2}]:[{...r,height:r.height/2},{...r,y:r.y+r.height/2,height:r.height/2}];
        for(const p of adaptiveRectPlansV6(input,grid,maxCircuit,cells,'combined-rect'))if(p.axis==='mixed'){p.planner='multi-cell';candidates.push(p);}
      }
      for(const p of adaptiveRectPlansV6(input,grid,maxCircuit,decH,'free-H')){p.planner='multi-cell';candidates.push(p);}
      const sigH=decH.map(r=>`${r.x},${r.y},${r.width},${r.height}`).join(';'),sigV=decV.map(r=>`${r.x},${r.y},${r.width},${r.height}`).join(';');
      if(sigV!==sigH)for(const p of adaptiveRectPlansV6(input,grid,maxCircuit,decV,'free-V')){p.planner='multi-cell';candidates.push(p);}
    }
    // A second phase is worthwhile only when the first global solution is
    // visibly marginal. This retains the V1.4 phase improvement without a 2x
    // runtime penalty on ordinary rooms.
    if(bestGlobal&&((bestGlobal.short||0)>0||(bestGlobal.coverage||0)<.95)){
      const axis=bestGlobal.axis,a=raw.filter(c=>c.axis===axis).sort((x,y)=>geomScore(x)-geomScore(y));
      if(a.length>1){const c=a[1],key=`${c.axis}:${c.phase}`;if(!seenScan.has(key)){const p=buildScanPlanV4(input,grid,c,maxCircuit);if(p){p.planner='global-scanline';p.short=c.short;rescorePlanV6(p,input,maxCircuit);candidates.push(p);}}}
    }

    // De-duplicate near-identical candidates before final comparison.
    const uniq=[];const keys=new Set();for(const p of candidates){const k=candidateKeyV6(p);if(keys.has(k))continue;keys.add(k);uniq.push(p);}
    if(uniq.length){
      // Minimum feasible hydraulic circuit count remains the primary rule.
      // Within that count the common quality function decides the winner.
      uniq.sort((a,b)=>a.circuits.length-b.circuits.length||a.score-b.score);let p=uniq[0];
      // V2.2 multi-cell tie-breaker. Do not force decomposition: only prefer a
      // local-cell candidate when it is essentially tied with the global plan
      // and buys a meaningful coverage gain without adding a bend penalty.
      // This captures L/T/notched rooms where two simple local layouts are
      // easier to install, while keeping the shorter global sweep when it is
      // clearly superior.
      if(p?.planner==='global-scanline'){
        const m=uniq.filter(x=>x.planner==='multi-cell'&&x.circuits.length===p.circuits.length).sort((a,b)=>a.score-b.score)[0];
        if(m){
          const pq=p.quality||planQualityV6(p,input,maxCircuit),mq=m.quality||planQualityV6(m,input,maxCircuit);
          const near=m.score<=p.score*1.04;
          const coverageGain=(m.coverage||0)-(p.coverage||0);
          const bendOK=(mq.bends||0)<=(pq.bends||0)+2;
          const muchSimpler=(mq.bends||0)+6<=(pq.bends||0)&&m.score<=p.score*1.07;
          if((near&&coverageGain>=.015&&bendOK)||muchSimpler)p=m;
        }
      }
      const warnings=[];
      if(p.coverage<.86)warnings.push('Часть свободной площади покрывается хуже заданного шага.');
      const bal=p.balance||circuitBalanceV5(p.circuits);if(p.circuits.length>1&&bal.spread>.18)warnings.push('Контуры удалось построить, но их длины отличаются более чем на 18%.');
      if(p.quality?.maxUtil>.98)warnings.push('Самый длинный контур близок к установленному пределу; проверьте допустимую длину для выбранной трубы и насоса.');
      const circuits=p.circuits.map((c,i)=>({id:i+1,route:c.route,length:c.length,coverageLength:c.coverageLength??c.coreLength}));
      return{ok:true,version:'1.5-multicell-optimizer',planner:p.planner,axis:p.axis,decomposition:p.decomposition||null,localAxes:p.localAxes||null,cellRects:p.cellRects||null,circuits,totalLength:p.totalLength,coverage:p.coverage,zones:p.zones||1,resolution:p.resolution,
        familyPlansV232:input.layoutFamiliesV232?['snake','adaptive'].map(kind=>{
          const isFamily=x=>kind==='snake'?x.planner==='global-scanline':x.planner!=='global-scanline'&&(x.zones||1)>1;
          const q=isFamily(p)?p:uniq.find(isFamily);if(!q)return null;
          return {ok:true,kind,planner:q.planner,axis:q.axis,cellRects:q.cellRects,localAxes:q.localAxes,decomposition:q.decomposition,
            circuits:q.circuits.map((c,i)=>({id:i+1,route:c.route,length:c.length})),totalLength:q.totalLength,coverage:q.coverage,zones:q.zones,
            balance:q.balance,quality:q.quality,warnings:[],candidatesChecked:uniq.length};
        }).filter(Boolean):undefined,
        balance:{spread:bal.spread,cv:bal.cv,mean:bal.mean},quality:p.quality,warnings,elapsedMs:Date.now()-t0,candidatesChecked:uniq.length,
        alternatives:uniq.slice(1,5).map(x=>({planner:x.planner,axis:x.axis,decomposition:x.decomposition||null,circuits:x.circuits.length,totalLength:x.totalLength,coverage:x.coverage,score:x.score,balance:x.balance?.spread||0,bends:x.quality?.bends||0,short:x.quality?.short||0}))};
    }
    const old=planV3(input);
    if(old?.ok){const bal=circuitBalanceV5(old.circuits||[]);return{...old,version:'1.4-fallback-circuit-first',planner:'fallback',balance:bal,warnings:[...(old.warnings||[]),'Оптимизатор не собрал полный регулярный маршрут; использован резервный планировщик.'],elapsedMs:Date.now()-t0};}
    return{ok:false,error:'Не удалось построить полный контур с допустимыми проходами и возвратом к коллектору.',elapsedMs:Date.now()-t0};
  }

  return {plan:planV6,_internals:{makeGrid,intervalRows,scanCandidateV4,buildGlobalCoreV4,buildAdaptivePlanV5,decomposeFreeRectsV6,adaptiveRectPlansV6,planQualityV6,balancedContiguousGroupsV5,planV3,planV2,routeLength}};
});
