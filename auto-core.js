/* Warm 3.5. Bounded automatic allocation. Counts ascend without a fixed circuit
   cap; exhaustion is SEARCH_LIMIT / NO_VERIFIED_LAYOUT, never impossibility.
   Ports and bend radii are geometric proposals, not manufacturer specifications. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./grid-core.js'),require('./spiral-core.js'),require('./circuit-core.js'),require('./multi-core.js'),require('./engine-unified.js'),require('./auto-geometry.js'));
  else root.WarmAuto=factory(root.WarmGrid,root.WarmSpiral,root.WarmCircuit,root.WarmMulti,root.WarmEngine,root.WarmAutoGeometry);
})(globalThis,function(G,S,C,M,Geo,V){
  'use strict';
  const H=S.geometry,copy=x=>structuredClone(x),EPS=1e-6;
  const bounds=rs=>rs.reduce((b,r)=>({x:Math.min(b.x,r.x),y:Math.min(b.y,r.y),right:Math.max(b.right,r.x+r.width),bottom:Math.max(b.bottom,r.y+r.height)}),{x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity});
  function frame(side){
    const to=p=>side==='bottom'?{x:p.x,y:-p.y}:side==='left'?{x:p.y,y:p.x}:side==='right'?{x:p.y,y:-p.x}:{x:p.x,y:p.y};
    const from=p=>side==='bottom'?{x:p.x,y:-p.y}:side==='left'?{x:p.y,y:p.x}:side==='right'?{x:-p.y,y:p.x}:{x:p.x,y:p.y};
    const rect=(r,fn)=>{const a=fn(r),b=fn({x:r.x+r.width,y:r.y+r.height});return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};};
    return {to,from,rect};
  }
  function transform(p,f){return G.createProject({...p,room:{sections:p.room.sections.map(r=>f.rect(r,f.to)),removedAreas:p.room.removedAreas.map(r=>f.rect(r,f.to))},exclusions:{areas:p.exclusions.areas.map(r=>f.rect(r,f.to))},grid:{...p.grid,origin:f.to(p.grid.origin)},collector:{supply:f.to(p.collector.supply),returnPoint:p.collector.returnPoint?f.to(p.collector.returnPoint):null}});}
  function cuts(p,n,shift=0){
    const b=bounds(p.room.sections), space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm:0,pipeDiameterMm:0});
    const total=space.raw.reduce((v,r)=>v+r.width*r.height,0), result=[b.x];
    for(let i=1;i<n;i++){
      const target=total*(i/n+shift*Math.sin(Math.PI*i/n)/n);let lo=b.x,hi=b.right;
      for(let j=0;j<35;j++){const mid=(lo+hi)/2,area=space.raw.reduce((v,r)=>v+Math.max(0,Math.min(r.width,mid-r.x))*r.height,0);if(area<target)lo=mid;else hi=mid;}
      const s=p.grid.cellSizeMm; result.push(p.grid.origin.x+Math.round(((lo+hi)/2-p.grid.origin.x)/s)*s);
    }
    result.push(b.right);return result;
  }
  function openings(ctx,method,target,side,targetY){
    const result=[];
    const lattice=[...ctx.lattice.values()];
    const limits={x:[Math.min(...lattice.map(p=>p.x)),Math.max(...lattice.map(p=>p.x))],y:[Math.min(...lattice.map(p=>p.y)),Math.max(...lattice.map(p=>p.y))]};
    for(const px of [0,1])for(const py of [0,1])for(const cw of [true,false]){
      const cycle=H.makeCycle(ctx,H.cellsFor(ctx,px,py),cw,method,!cw);if(!cycle)continue;
      // Even rounding every vertex cannot make this candidate short enough.
      if((cycle.length-1)*ctx.step-cycle.length*(2-Math.PI/2)*ctx.o.radiusMm-2*ctx.o.radiusMm>80000)continue;
      const edges=cycle.map((a,i)=>({a,b:cycle[(i+1)%cycle.length],i})).filter(({a,b})=>a.y===b.y&&a.y>=targetY-EPS&&a.y<=targetY+ctx.step*2&&a.x!==b.x)
        .sort((u,v)=>Math.abs((u.a.x+u.b.x)/2-target)+Math.abs(u.a.y-targetY)*2-Math.abs((v.a.x+v.b.x)/2-target)-Math.abs(v.a.y-targetY)*2).slice(0,4);
      for(const {i} of edges){
        const a=cycle[i],b=cycle[(i+1)%cycle.length];
        if(a.y!==b.y||a.y<targetY-EPS||a.y>targetY+ctx.step*2||a.x===b.x)continue;
        let route=Geo.clean([...cycle.slice(i+1),...cycle.slice(0,i+1)].map(p=>({x:p.x,y:p.y})));
        if(route[0].x>route.at(-1).x)route.reverse();
        let expanded=copy(route);
        // A paired-cell cycle can leave an odd outer grid row unused. Extend
        // its boundary run onto that row when every new guide remains valid.
        for(const axis of ['x','y'])for(const edge of [0,1]){
          const extreme=(edge?Math.max:Math.min)(...expanded.map(p=>p[axis])),limit=limits[axis][edge];
          if(Math.abs(extreme-limit)<EPS||Math.abs(extreme-limit)>ctx.step+EPS)continue;
          const next=expanded.map(p=>({...p,[axis]:Math.abs(p[axis]-extreme)<EPS?limit:p[axis]}));
          if(next.slice(1).every((p,i)=>ctx.guide(next[i],p)))expanded=next;
        }
        const score=Math.abs((a.x+b.x)/2-target)+Math.abs(a.y-targetY)*2;
        result.push({route:expanded,size:cycle.length,score,side});
        result.push({route,size:cycle.length,score:score+ctx.step*100,side});
      }
    }
    return result.sort((a,b)=>b.size-a.size||a.score-b.score).slice(0,24);
  }
  function attempt(original,p,f,n,settings,shift,method,deadline,search){
    const reject=why=>{search.rejections[why]=(search.rejections[why]||0)+1;return null;};
    const b=bounds(p.room.sections),xs=cuts(p,n,shift),anchor=p.collector.supply;
    const R=settings.radiusMm,lane=2*R,step=p.grid.cellSizeMm;
    if(xs.slice(1).some((x,i)=>x-xs[i]<2*settings.wallOffsetMm+step))return null;
    // A contiguous geometric collector bank centred at the chosen point.
    // Its proposed ports are explicit in the result and remain manually editable.
    const bankWidth=(2*n-1)*lane;
    if(bankWidth>b.right-b.x-2*R)return null;
    const bankStart=Math.max(b.x+R,Math.min(anchor.x-bankWidth/2,b.right-R-bankWidth));
    const bankCentre=bankStart+bankWidth/2;
    const zones=xs.slice(0,-1).map((x,i)=>({x,y:b.y,width:xs[i+1]-x,height:b.bottom-b.y}));
    const assignments=zones.map((z,i)=>({i,z,side:z.x+z.width/2<bankCentre?'left':'right'}));
    const headers=[];
    for(const side of ['left','right']){
      const list=assignments.filter(d=>d.side===side).sort((a,b)=>side==='right'?a.i-b.i:b.i-a.i);
      list.forEach(({i,z},j)=>{
        const port0=bankStart+2*i*lane,port1=port0+lane,depth=2*(list.length-j)*lane;
        const x=side==='right'?port0-settings.wallOffsetMm:z.x;
        const right=side==='right'?z.x+z.width:port1+settings.wallOffsetMm;
        const height=anchor.y+depth+2*R-settings.wallOffsetMm-b.y;
        if(height>0)headers.push({x,y:b.y,width:right-x,height});
      });
    }
    const defs=[],results=[],occupied=[];
    for(const side of ['left','right']){
      const list=assignments.filter(d=>d.side===side).sort((a,b)=>side==='right'?a.i-b.i:b.i-a.i);
      for(let j=0;j<list.length;j++){
        if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
        const {i,z}=list[j],port0=bankStart+2*i*lane,port1=port0+lane;
        const depths=side==='right'?[2*(list.length-j)*lane,(2*(list.length-j)-1)*lane]:[(2*(list.length-j)-1)*lane,2*(list.length-j)*lane];
        const top=anchor.y+Math.max(...depths)+2*R;
        const cutX=side==='right'?Math.max(z.x,bankStart-settings.wallOffsetMm):z.x;
        const cutRight=side==='right'?z.x+z.width:Math.min(z.x+z.width,bankStart+bankWidth+settings.wallOffsetMm);
        const cut={x:cutX,y:z.y,width:cutRight-cutX,height:top-settings.wallOffsetMm-z.y};
        if(top>=b.bottom-settings.wallOffsetMm)return null;
        const removed=headers.map(h=>{const x=Math.max(h.x,z.x),right=Math.min(h.x+h.width,z.x+z.width);return {...h,x,width:right-x};}).filter(h=>h.width>0);
        const d={id:'auto-'+(i+1),name:'Контур '+(i+1),zone:z,heatingRemoved:removed,automatic:true,supply:{x:port0,y:anchor.y},returnPoint:{x:port1,y:anchor.y}};
        let ctx;try{ctx=H.prepare(M.zoneProject(p,d),settings);}catch{return null;}
        if(!H.connected(ctx))return null;
        const candidates=openings(ctx,method,side==='right'?z.x+z.width-settings.wallOffsetMm-step:z.x+settings.wallOffsetMm+step,side,top);
        let accepted=null;
        for(const {route} of candidates){
          if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
          const ends=[route[0],route.at(-1)],ports=[d.supply,d.returnPoint];
          if(side==='right'&&ends.some((e,k)=>e.x<ports[k].x+2*R)||side==='left'&&ends.some((e,k)=>e.x>ports[k].x-2*R))continue;
          const lead=(k)=>Geo.clean([ports[k],{x:ports[k].x,y:anchor.y+depths[k]},{x:ends[k].x,y:anchor.y+depths[k]},ends[k]]);
          const supply=lead(0),tail=lead(1).reverse();
          try {
            const length=H.roundPath([...supply,...route.slice(1),...tail.slice(1)],R).reduce((sum,s)=>sum+s.lengthMm,0);
            if(length>80000){reject('OVER_LENGTH');continue;}
          } catch {continue;}
          const world={...d,zone:f.rect(d.zone,f.from),heatingRemoved:d.heatingRemoved.map(r=>f.rect(r,f.from)),supply:f.from(d.supply),returnPoint:f.from(d.returnPoint)};
          const r=C.fromPaths(M.zoneProject(original,world),settings,{supply:supply.map(f.from),heating:route.map(f.from),return:tail.map(f.from)},method,{transitProject:original,occupied});
          if(r.ok&&!r.overLength){accepted={d:world,r};break;}
          reject(r.reason||'OVER_LENGTH');
        }
        if(!accepted)return reject('NO_CONNECTED_CANDIDATE');
        defs.push(accepted.d);results.push({id:accepted.d.id,plan:accepted.r});occupied.push(...accepted.r.circuits[0].segments);
      }
    }
    const ordered=defs.map((d,i)=>({d,r:results[i]})).sort((a,b)=>Number(a.d.id.slice(5))-Number(b.d.id.slice(5)));
    const multi=M.compose(original,settings,ordered.map(x=>x.d),ordered.map(x=>x.r));
    const coverage=V.coverage(original,settings,multi.circuits);if(!coverage.ok){search.lastGaps=coverage.gaps;
      if(!search.coverageFailures[n])search.coverageFailures[n]={settings,shift,missed:coverage.missed,max:coverage.maxDistanceMm,gaps:coverage.gaps};
      return reject('COVERAGE');}
    const lengths=multi.circuits.map(c=>c.lengthMm);
    return {multi,coverage,spreadMm:Math.max(...lengths)-Math.min(...lengths)};
  }
  function plan(project,options={},progress=()=>{}){
    const started=Date.now(),deadline=started+(options.timeBudgetMs??45000);let p;
    const search={attempts:0,countsTried:[],globallyOptimal:false,rejections:{},coverageFailures:{}};
    try{
      p=G.createProject(project);if(!p.room.sections.length)throw new Error('ROOM_REQUIRED');
      if(!p.collector.supply)throw new Error('COLLECTOR_REQUIRED');
      if(G.classifyPoint(p,p.collector.supply)!=='available')throw new Error('COLLECTOR_OUTSIDE');
      const wallOffsetMm=options.wallOffsetMm??100;
      if(!Number.isFinite(wallOffsetMm)||wallOffsetMm<0)throw new Error('INVALID_OFFSET');
      const s=p.grid.cellSizeMm,b=bounds(p.room.sections),q=p.collector.supply;
      const sides=[['top',Math.abs(q.y-b.y)],['bottom',Math.abs(q.y-b.bottom)],['left',Math.abs(q.x-b.x)],['right',Math.abs(q.x-b.right)]].sort((a,b)=>a[1]-b[1]);
      const space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm,pipeDiameterMm:0});
      const area=space.rects.reduce((sum,r)=>sum+r.width*r.height,0);
      if(!area)throw new Error('NO_WORKING_AREA');
      if((b.right-b.x)*(b.bottom-b.y)/(s*s)>100000)throw new Error('SEARCH_LIMIT');
      // Resource bound follows available geometry, never a fixed circuit limit.
      const maxZones=Math.max(1,Math.floor(Math.max(b.right-b.x,b.bottom-b.y)/(2*wallOffsetMm+s)));
      for(let n=1;n<=maxZones;n++){
        search.countsTried.push(n);progress({count:n,attempts:search.attempts});let best=null;
        for(const method of ['spiral','double-snake']){
          for(const [side] of sides.slice(0,1))for(const ratio of [.5,1/3,.25])for(const shift of n===1?[0]:[0,-.25,.25]){
            if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
            const f=frame(side),local=transform(p,f),settings={radiusMm:s*ratio,spacingCells:1,wallOffsetMm,method:'auto'};
            search.attempts++;const candidate=attempt(p,local,f,n,settings,shift,method,deadline,search);
            if(candidate&&(!best||candidate.spreadMm<best.spreadMm-EPS||Math.abs(candidate.spreadMm-best.spreadMm)<EPS&&candidate.multi.lengthMm<best.multi.lengthMm))best={...candidate,settings,side};
            // Balance all three zone shifts at the first feasible radius.
          }
          if(best)break;
        }
        if(best){
          const result={ok:true,status:'AUTO_OK',planner:'grid-auto-v35',multi:best.multi,settings:best.settings,coverage:best.coverage,
            search:{...search,elapsedMs:Date.now()-started},collectorProposal:{anchor:copy(p.collector.supply),side:best.side,ports:best.multi.definitions.map(d=>({id:d.id,supply:d.supply,returnPoint:d.returnPoint}))}};
          const checked=validate(p,result);if(checked.ok)return result;
        }
      }
      throw new Error('NO_VERIFIED_LAYOUT');
    }catch(e){return {ok:false,status:'AUTO_NOT_FOUND',reason:e.message,circuits:[],search:{...search,elapsedMs:Date.now()-started}};}
  }
  function validate(project,result){
    try{
      if(!result?.ok||result.planner!=='grid-auto-v35'||result.status!=='AUTO_OK')throw new Error('INVALID_PLAN');
      const p=G.createProject(project),m=result.multi;
      const anchor=result.collectorProposal?.anchor;
      if(!anchor||!p.collector.supply||anchor.x!==p.collector.supply.x||anchor.y!==p.collector.supply.y)throw new Error('COLLECTOR_CHANGED');
      if(!m?.complete||m.overLength||m.circuits.some(c=>c.lengthMm>80000)||!m.definitions.every(d=>d.automatic===true))throw new Error('INCOMPLETE_PLAN');
      const valid=M.validate(p,result.settings,m.definitions,m);if(!valid.ok)throw new Error(valid.reason);
      const coverage=V.coverage(p,result.settings,m.circuits);if(!coverage.ok)throw new Error('INCOMPLETE_COVERAGE');
      if(JSON.stringify(coverage)!==JSON.stringify(result.coverage))throw new Error('INVALID_COVERAGE');
      const ports=m.definitions.map(d=>({id:d.id,supply:d.supply,returnPoint:d.returnPoint}));
      if(JSON.stringify(ports)!==JSON.stringify(result.collectorProposal.ports))throw new Error('INVALID_PORTS');
      return {ok:true};
    }catch(e){return {ok:false,reason:e.message};}
  }
  return {plan,validate};
});
