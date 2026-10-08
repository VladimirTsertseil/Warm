/* Clean grid engine module used by Warm 5.0. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./model.js'),require('./patterns.js'),require('./circuit.js'),require('./multi.js'),require('./rect-geometry.js'),require('./coverage.js'));
  else root.WarmGridAllocator=factory(root.WarmGridModel,root.WarmGridPatterns,root.WarmGridCircuit,root.WarmGridMulti,root.WarmRectGeometry,root.WarmGridCoverage);
})(globalThis,function(G,S,C,M,Geo,V){
  'use strict';
  const H=S.geometry,copy=x=>structuredClone(x),EPS=1e-6;
  const bounds=rs=>rs.reduce((b,r)=>({x:Math.min(b.x,r.x),y:Math.min(b.y,r.y),right:Math.max(b.right,r.x+r.width),bottom:Math.max(b.bottom,r.y+r.height)}),{x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity});
  // Optional paired lead geometry. With pairedLeads=false this reproduces the
  // historical 2R lane layout exactly. When enabled, supply and return of the
  // SAME circuit use a compact pair; different circuits still keep a full 2R
  // separation, so this does not create shared transit between circuits.
  function leadLayout(p,settings,pairedLeads=false){
    const R=settings.radiusMm,lane=2*R,D=Number(p.pipe?.diameterMm)||16;
    const pairPitch=pairedLeads?Math.min(lane,Math.max(30,2*D)):lane;
    const stride=lane+pairPitch;
    const bankWidth=n=>n>0?(n-1)*stride+pairPitch:0;
    const portX=(start,i,k)=>start+i*stride+(k?pairPitch:0);
    const depths=(rank,side)=>{const near=(rank-1)*stride+lane,far=near+pairPitch;return side==='right'?[far,near]:[near,far];};
    return {R,lane,pairPitch,stride,bankWidth,portX,depths};
  }
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
  const clip=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),width=Math.min(a.x+a.width,b.x+b.width)-x,height=Math.min(a.y+a.height,b.y+b.height)-y;return width>EPS&&height>EPS?{x,y,width,height}:null;};
  function rawSpace(p){return Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm:0,pipeDiameterMm:0}).raw;}
  function zoneMetrics(rects,z,step=150){
    const rs=rects.map(r=>clip(r,z)).filter(Boolean),area=rs.reduce((n,r)=>n+r.width*r.height,0);
    if(!area)return {area:0,connected:false,cost:Infinity};
    const b=bounds(rs),w=b.right-b.x,h=b.bottom-b.y,aspect=Math.max(w/h,h/w);
    const seen=new Set([0]),queue=[0];
    for(let k=0;k<queue.length;k++)for(let j=0;j<rs.length;j++)if(!seen.has(j)){
      const a=rs[queue[k]],c=rs[j],dx=Math.min(a.x+a.width,c.x+c.width)-Math.max(a.x,c.x),dy=Math.min(a.y+a.height,c.y+c.height)-Math.max(a.y,c.y);
      if(dx>=-EPS&&dy>=-EPS&&(dx>EPS||dy>EPS)){seen.add(j);queue.push(j);}
    }
    let perimeter=rs.reduce((n,r)=>n+2*(r.width+r.height),0);
    for(let i=0;i<rs.length;i++)for(let j=0;j<i;j++){
      const a=rs[i],c=rs[j];
      if(Math.abs(a.x+a.width-c.x)<EPS||Math.abs(c.x+c.width-a.x)<EPS)perimeter-=2*Math.max(0,Math.min(a.y+a.height,c.y+c.height)-Math.max(a.y,c.y));
      if(Math.abs(a.y+a.height-c.y)<EPS||Math.abs(c.y+c.height-a.y)<EPS)perimeter-=2*Math.max(0,Math.min(a.x+a.width,c.x+c.width)-Math.max(a.x,c.x));
    }
    const compactness=perimeter*perimeter/(16*area),narrow=Math.max(0,4*step/Math.min(w,h)-1);
    return {area,aspect,compactness,connected:seen.size===rs.length,cost:8*(compactness-1)+12*Math.max(0,aspect-2)**2+40*narrow*narrow,bounds:{x:b.x,y:b.y,width:w,height:h}};
  }
  // Bounded beam over recursive area-balanced cuts in BOTH axes. A zone is
  // its intersection with the room, not an atom of a rectangular decomposition.
  function partitions(p,n,limit=18,deadline=Infinity,topological=false){
    const rs=rawSpace(p),b=bounds(rs),step=p.grid.cellSizeMm,memo=new Map();let states=0;
    function split(z,k){
      const key=JSON.stringify([z,k]);if(memo.has(key))return memo.get(key);
      if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
      if(++states>25000)throw new Error('SEARCH_COMPLEXITY_LIMIT');
      const m=zoneMetrics(rs,z,step);if(!m.connected)return[];
      z=m.bounds;if(k===1)return[{zones:[z],cost:m.cost+(topological?12*(z.width*z.height-m.area)/(step*step):0)}];
      const found=[];
      for(const axis of ['x','y'])for(let left=1;left<k;left++){
        const dim=axis==='x'?'width':'height';
        let lo=z[axis],hi=lo+z[dim];
        for(let j=0;j<30;j++){const mid=(lo+hi)/2,a=zoneMetrics(rs,{...z,[dim]:mid-z[axis]},step).area;if(a<m.area*left/k)lo=mid;else hi=mid;}
        const snap=v=>p.grid.origin[axis]+Math.round((v-p.grid.origin[axis])/step)*step;
        const events=rs.flatMap(r=>[r[axis],r[axis]+r[dim]]).filter(v=>v>z[axis]+step&&v<z[axis]+z[dim]-step&&(topological||Math.abs(v-(lo+hi)/2)<z[dim]*.18));
        for(const cut of [...new Set([snap((lo+hi)/2),snap((lo+hi)/2-step),snap((lo+hi)/2+step),...events.map(snap)])]){
          if(cut-z[axis]<2*step||z[axis]+z[dim]-cut<2*step)continue;
          const a={...z,[dim]:cut-z[axis]},c={...z,[axis]:cut,[dim]:z[axis]+z[dim]-cut};
          const ma=zoneMetrics(rs,a,step),mc=zoneMetrics(rs,c,step);
          if(!ma.connected||!mc.connected||(!topological&&Math.abs(ma.area/m.area-left/k)>.16))continue;
          for(const aa of split(a,left).slice(0,4))for(const cc of split(c,k-left).slice(0,4)){
            const zones=[...aa.zones,...cc.zones],areas=zones.map(z=>zoneMetrics(rs,z,step).area),mean=m.area/k;
            found.push({zones,cost:aa.cost+cc.cost+20*areas.reduce((s,a)=>s+(a/mean-1)**2,0)});
          }
        }
      }
      const seen=new Set(),out=found.sort((a,b)=>a.cost-b.cost).filter(x=>{const key=JSON.stringify(x.zones.slice().sort((a,b)=>a.x-b.x||a.y-b.y));if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit);
      memo.set(key,out);return out;
    }
    return split({x:b.x,y:b.y,width:b.right-b.x,height:b.bottom-b.y},n);
  }
  function estimate(p,wallOffsetMm,maxLength){
    const space=Geo.freeSpace({sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],wallOffsetMm,pipeDiameterMm:0});
    const area=space.rects.reduce((sum,r)=>sum+r.width*r.height,0),heating=area/p.grid.cellSizeMm;
    // Area/pitch is a forecast, not a proof of infeasibility. Actual rounded
    // pipe and both leads are measured before accepting any candidate.
    return {workingAreaMm2:area,heatingLengthMm:heating,predictedLengthMm:heating,initialCount:Math.max(1,Math.ceil(heating/maxLength)),maxCircuitLengthMm:maxLength};
  }

  function openings(ctx,method,target,side,targetY,maxLength){
    const result=[];
    const lattice=[...ctx.lattice.values()];
    const limits={x:[Math.min(...lattice.map(p=>p.x)),Math.max(...lattice.map(p=>p.x))],y:[Math.min(...lattice.map(p=>p.y)),Math.max(...lattice.map(p=>p.y))]};
    for(const px of [0,1])for(const py of [0,1])for(const cw of [true,false]){
      const cycle=H.makeCycle(ctx,H.cellsFor(ctx,px,py),cw,method,!cw);if(!cycle)continue;
      // Even rounding every vertex cannot make this candidate short enough.
      if((cycle.length-1)*ctx.step-cycle.length*(2-Math.PI/2)*ctx.o.radiusMm-2*ctx.o.radiusMm>maxLength)continue;
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
  function attempt(original,p,f,n,settings,shift,method,deadline,search,partition,maxLength,pairedLeads=false){
    const reject=why=>{search.rejections[why]=(search.rejections[why]||0)+1;return null;};
    const b=bounds(p.room.sections),xs=cuts(p,n,shift),anchor=p.collector.supply;
    const lead=leadLayout(p,settings,pairedLeads),{R,lane}=lead,step=p.grid.cellSizeMm;
    if(xs.slice(1).some((x,i)=>x-xs[i]<2*settings.wallOffsetMm+step))return null;
    // A contiguous geometric collector bank centred at the chosen point.
    // Its proposed ports are explicit in the result and remain manually editable.
    const bankWidth=lead.bankWidth(n);
    if(bankWidth>b.right-b.x-2*R)return null;
    const bankStart=Math.max(b.x+R,Math.min(anchor.x-bankWidth/2,b.right-R-bankWidth));
    const bankCentre=bankStart+bankWidth/2;
    const zones=partition || xs.slice(0,-1).map((x,i)=>({x,y:b.y,width:xs[i+1]-x,height:b.bottom-b.y}));
    const assignments=zones.map((z,i)=>({i,z,side:z.x+z.width/2<bankCentre?'left':'right'}));
    const headers=[];
    for(const side of ['left','right']){
      const list=assignments.filter(d=>d.side===side).sort((a,b)=>side==='right'?a.i-b.i:b.i-a.i);
      list.forEach(({i,z},j)=>{
        const port0=lead.portX(bankStart,i,0),port1=lead.portX(bankStart,i,1),depth=Math.max(...lead.depths(list.length-j,side));
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
        const {i,z}=list[j],port0=lead.portX(bankStart,i,0),port1=lead.portX(bankStart,i,1);
        const depths=lead.depths(list.length-j,side);
        const top=anchor.y+Math.max(...depths)+2*R;
        const cutX=side==='right'?Math.max(z.x,bankStart-settings.wallOffsetMm):z.x;
        const cutRight=side==='right'?z.x+z.width:Math.min(z.x+z.width,bankStart+bankWidth+settings.wallOffsetMm);
        const cut={x:cutX,y:z.y,width:cutRight-cutX,height:top-settings.wallOffsetMm-z.y};
        if(top>=b.bottom-settings.wallOffsetMm)return null;
        const removed=headers.map(h=>{const x=Math.max(h.x,z.x),right=Math.min(h.x+h.width,z.x+z.width);return {...h,x,width:right-x};}).filter(h=>h.width>0);
        const d={id:'auto-'+(i+1),name:'Контур '+(i+1),zone:z,heatingRemoved:removed,automatic:true,supply:{x:port0,y:anchor.y},returnPoint:{x:port1,y:anchor.y}};
        let ctx;try{ctx=H.prepare(M.zoneProject(p,d),settings);}catch{return null;}
        if(!H.connected(ctx))return null;
        const candidates=openings(ctx,method,side==='right'?z.x+z.width-settings.wallOffsetMm-step:z.x+settings.wallOffsetMm+step,side,top,maxLength);
        let accepted=null;
        for(const {route} of candidates){
          if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
          const ends=[route[0],route.at(-1)],ports=[d.supply,d.returnPoint];
          if(side==='right'&&ends.some((e,k)=>e.x<ports[k].x+2*R)||side==='left'&&ends.some((e,k)=>e.x>ports[k].x-2*R))continue;
          const lead=(k)=>Geo.clean([ports[k],{x:ports[k].x,y:anchor.y+depths[k]},{x:ends[k].x,y:anchor.y+depths[k]},ends[k]]);
          const supply=lead(0),tail=lead(1).reverse();
          try {
            const length=H.roundPath([...supply,...route.slice(1),...tail.slice(1)],R).reduce((sum,s)=>sum+s.lengthMm,0);
            if(length>maxLength){reject('OVER_LENGTH');continue;}
          } catch {continue;}
          const world={...d,zone:f.rect(d.zone,f.from),heatingRemoved:d.heatingRemoved.map(r=>f.rect(r,f.from)),supply:f.from(d.supply),returnPoint:f.from(d.returnPoint)};
          const r=C.fromPaths(M.zoneProject(original,world),settings,{supply:supply.map(f.from),heating:route.map(f.from),return:tail.map(f.from)},method,{transitProject:original,occupied});
          if(r.ok&&r.lengthMm<=maxLength+EPS){accepted={d:world,r};break;}
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
  function compactAttempt(original,p,f,partition,settings,method,deadline,search,maxLength,variant=0,pairedLeads=false){
    const reject=why=>{search.rejections[why]=(search.rejections[why]||0)+1;return null;};
    const b=bounds(p.room.sections),anchor=p.collector.supply,lead=leadLayout(p,settings,pairedLeads),{R,lane,pairPitch,stride}=lead,n=partition.length;
    const bankWidth=lead.bankWidth(n),bankStart=Math.max(b.x+R,Math.min(anchor.x-bankWidth/2,b.right-R-bankWidth));
    if(bankWidth>b.right-b.x-2*R)return reject('BANK_TOO_WIDE');
    const targetX=z=>{
      const left=z.x+z.width/2<bankStart+bankWidth/2,low=z.y>anchor.y+n*stride+2*R;
      return low?(left?z.x+z.width-R-pairPitch/2:z.x+R+pairPitch/2):(left?z.x:z.x+z.width);
    };
    // Port order follows the actual branch of the transit tree. Sorting only
    // by zone x makes stacked zones cross at the collector bank.
    const zones=partition.slice().sort((a,b)=>targetX(a)-targetX(b)||b.y-a.y);
    const reservations=[],specs=[];
    const addBox=(x,y,right,bottom)=>{if(right-x>EPS&&bottom-y>EPS)reservations.push({x,y,width:right-x,height:bottom-y});};
    for(let i=0;i<n;i++){
      const z=zones[i],right=z.x+z.width,side=z.x+z.width/2<bankStart+bankWidth/2?'left':'right';
      const ports=[{x:lead.portX(bankStart,i,0),y:anchor.y},{x:lead.portX(bankStart,i,1),y:anchor.y}];
      const low=z.y>anchor.y+n*stride+2*R;
      const trunkSide=low?(targetX(z)<bankStart+bankWidth/2?'left':'right'):side;
      const rank=trunkSide==='right'?n-i:i+1,header=anchor.y+rank*stride;
      let ys=side==='right'?[header,header-pairPitch]:[header-pairPitch,header];
      const spine=side==='right'?[z.x+R,z.x+R+pairPitch]:[right-R-pairPitch,right-R];
      if(low)ys=(spine[0]+spine[1])/2<(ports[0].x+ports[1].x)/2?[header-pairPitch,header]:[header,header-pairPitch];
      const local=low?z.y+lane+pairPitch:header;
      const ly=side==='right'?[local,local-pairPitch]:[local-pairPitch,local];
      const top=Math.max(...ly)+2*R;
      if(top>=z.y+z.height-settings.wallOffsetMm)return reject('ZONE_TOO_SHALLOW');
      // Reserve a boundary corridor, never the complete area above a far zone.
      addBox(z.x,z.y,right,top-settings.wallOffsetMm);
      if(low){
        addBox(Math.min(...spine)-R,Math.min(...ys)-R,Math.max(...spine)+R,top-settings.wallOffsetMm);
        addBox(Math.min(...ports.map(p=>p.x),...spine)-R,anchor.y,Math.max(...ports.map(p=>p.x),...spine)+R,header+R-settings.wallOffsetMm);
      }else{
        addBox(Math.min(z.x,...ports.map(p=>p.x)),b.y,Math.max(right,...ports.map(p=>p.x)),top-settings.wallOffsetMm);
      }
      specs.push({z,side,ports,ys,ly,spine,top,low,i});
    }
    const defs=[],results=[],occupied=[];
    for(const a of specs){
      if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
      const {z,side,ports,ys,ly,spine,top,low,i}=a;
      const removed=reservations.map(r=>clip(r,z)).filter(Boolean);
      const d={id:'auto-'+(i+1),name:'Контур '+(i+1),zone:z,heatingRemoved:removed,automatic:true,supply:ports[0],returnPoint:ports[1]};
      let ctx;try{ctx=H.prepare(M.zoneProject(p,d),settings);}catch(e){return reject(e.message);}
      if(!H.connected(ctx))return reject('DISCONNECTED_HEATING');
      const target=side==='right'?z.x+z.width-settings.wallOffsetMm-p.grid.cellSizeMm:z.x+settings.wallOffsetMm+p.grid.cellSizeMm;
      const candidates=openings(ctx,method,target,side,top,maxLength);let accepted=null;
      for(const {route} of candidates){
        if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
        const ends=[route[0],route.at(-1)];
        const lead=k=>Geo.clean(low?[ports[k],{x:ports[k].x,y:ys[k]},{x:spine[k],y:ys[k]},{x:spine[k],y:ly[k]},{x:ends[k].x,y:ly[k]},ends[k]]:[ports[k],{x:ports[k].x,y:ys[k]},{x:ends[k].x,y:ys[k]},ends[k]]);
        const supply=lead(0),tail=lead(1).reverse();
        const world={...d,zone:f.rect(z,f.from),heatingRemoved:removed.map(r=>f.rect(r,f.from)),supply:f.from(ports[0]),returnPoint:f.from(ports[1])};
        const r=C.fromPaths(M.zoneProject(original,world),settings,{supply:supply.map(f.from),heating:route.map(f.from),return:tail.map(f.from)},method,{transitProject:original,occupied});
        if(r.ok&&r.lengthMm<=maxLength+EPS){accepted={d:world,r};break;}
        reject(r.ok?'OVER_LENGTH':r.reason);
      }
      if(!accepted)return reject('NO_COMPACT_ROUTE');
      defs.push(accepted.d);results.push({id:accepted.d.id,plan:accepted.r});occupied.push(...accepted.r.circuits[0].segments);
    }
    const multi=M.compose(original,settings,defs,results),coverage=V.coverage(original,settings,multi.circuits);
    if(!coverage.ok)return reject('COVERAGE');
    const lengths=multi.circuits.map(c=>c.lengthMm);
    return {multi,coverage,spreadMm:Math.max(...lengths)-Math.min(...lengths)};
  }
  function objective(p,candidate,initialCount){
    const rs=rawSpace(p),cs=candidate.multi.circuits,n=cs.length,lengths=cs.map(c=>c.lengthMm),mean=lengths.reduce((a,b)=>a+b,0)/n;
    const shape=candidate.multi.definitions.reduce((s,d)=>s+zoneMetrics(rs,d.zone,p.grid.cellSizeMm).cost,0);
    const transit=cs.reduce((s,c)=>s+c.supplyTransit.lengthMm+c.returnTransit.lengthMm,0);
    const imbalance=lengths.reduce((s,l)=>s+(l/mean-1)**2,0);
    const leads=cs.flatMap((c,id)=>[...c.supplyTransit.segments,...c.returnTransit.segments].filter(e=>e.type==='straight').map(e=>({...e,id})));
    let longParallel=leads.reduce((sum,e)=>sum+Math.max(0,e.lengthMm-2000)**2/1e6,0);
    for(let i=0;i<leads.length;i++)for(let j=0;j<i;j++){
      const a=leads[i],b=leads[j],horizontal=Math.abs(a.from.y-a.to.y)<EPS;
      if(a.id===b.id||horizontal!==(Math.abs(b.from.y-b.to.y)<EPS))continue;
      const axis=horizontal?'x':'y',fixed=horizontal?'y':'x';
      if(Math.abs(a.from[fixed]-b.from[fixed])>4*p.grid.cellSizeMm)continue;
      const overlap=Math.min(Math.max(a.from[axis],a.to[axis]),Math.max(b.from[axis],b.to[axis]))-Math.max(Math.min(a.from[axis],a.to[axis]),Math.min(b.from[axis],b.to[axis]));
      longParallel+=Math.max(0,overlap-1000)/1000;
    }
    return {total:10000*Math.max(0,n-initialCount)+shape+transit/1000*2+80*imbalance+longParallel,shape,transitMm:transit,imbalance,longParallel};
  }

  function plan(project,options={},progress=()=>{}){
    const started=Date.now(),deadline=started+(options.timeBudgetMs??45000);
    const search={attempts:0,countsTried:[],globallyOptimal:false,rejections:{},coverageFailures:{},compactCandidates:0,fallbackUsed:false};
    try{
      const p=G.createProject(project),maxLength=Number(options.maxCircuitLengthMm??80000),pairedLeads=options.pairedLeads===true;
      if(!Number.isFinite(maxLength)||maxLength<=0)throw new Error('INVALID_MAX_LENGTH');
      if(!p.room.sections.length)throw new Error('ROOM_REQUIRED');
      if(!p.collector.supply)throw new Error('COLLECTOR_REQUIRED');
      if(G.classifyPoint(p,p.collector.supply)!=='available')throw new Error('COLLECTOR_OUTSIDE');
      if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
      const wallOffsetMm=options.wallOffsetMm??100,s=p.grid.cellSizeMm,b=bounds(p.room.sections),q=p.collector.supply;
      if(!Number.isFinite(wallOffsetMm)||wallOffsetMm<0)throw new Error('INVALID_OFFSET');
      const forecast=estimate(p,wallOffsetMm,maxLength);search.estimate=forecast;
      if(!forecast.workingAreaMm2)throw new Error('NO_WORKING_AREA');
      if((b.right-b.x)*(b.bottom-b.y)/(s*s)>100000)throw new Error('AREA_TOO_LARGE');
      const sides=[['top',Math.abs(q.y-b.y)],['bottom',Math.abs(q.y-b.bottom)],['left',Math.abs(q.x-b.x)],['right',Math.abs(q.x-b.right)]].sort((a,b)=>a[1]-b[1]);
      const methods=options.method==null?['spiral','double-snake']:[String(options.method)];
      if(methods.some(m=>!['spiral','double-snake'].includes(m)))throw new Error('INVALID_METHOD');
      const maxZones=Math.min(forecast.initialCount+3,Math.max(1,Math.floor(forecast.workingAreaMm2/(9*s*s))));
      const f=frame(sides[0][0]),local=transform(p,f),side=sides[0][0];
      search.pairedLeads=pairedLeads;
      const finish=(best,fallback)=>{
        search.fallbackUsed=fallback;search.objective=best.score;
        const result={ok:true,status:'AUTO_OK',planner:'grid-auto',multi:best.multi,settings:best.settings,coverage:best.coverage,maxCircuitLengthMm:maxLength,pairedLeads,
          search:{...search,elapsedMs:Date.now()-started},collectorProposal:{anchor:copy(p.collector.supply),side,ports:best.multi.definitions.map(d=>({id:d.id,supply:d.supply,returnPoint:d.returnPoint}))}};
        const valid=validate(p,result);if(!valid.ok)throw new Error(valid.reason);return result;
      };
      // Complete the compact search at the estimated count before increasing it.
      // A timeout is not evidence that compact zones are impossible.
      for(let n=forecast.initialCount;n<=maxZones;n++){
        search.countsTried.push(n);progress({count:n,attempts:search.attempts});
        const variants=partitions(local,n,18,deadline);search.compactCandidates+=variants.length;let best=null;
        for(const ratio of [.5,1/3,.25])for(const method of methods)for(const candidate of variants){
          if(Date.now()>deadline){if(best)return finish(best,false);throw new Error('SEARCH_LIMIT');}
          if(candidate.cost>(variants[0]?.cost??0)+40)continue;
          const settings={radiusMm:s*ratio,spacingCells:1,wallOffsetMm,method:'auto',maxCircuitLengthMm:maxLength};
          search.attempts++;
          let r;try{r=compactAttempt(p,local,f,candidate.zones,settings,method,deadline,search,maxLength,0,pairedLeads);}catch(e){if(e.message==='SEARCH_LIMIT'&&best)return finish(best,false);throw e;}
          if(r){const score=objective(p,r,forecast.initialCount);if(!best||score.total<best.score.total)best={...r,settings,score};}
        }
        if(best)return finish(best,false);
        // Only now try the historical strip connector at this count. Reject
        // artificial slivers when the room admits substantially better zones.
        const bestShape=variants[0]?.cost??Infinity;
        for(const ratio of [.5,1/3,.25])for(const method of methods)for(const shift of [0,-.25,.25]){
          if(Date.now()>deadline)throw new Error('SEARCH_LIMIT');
          const settings={radiusMm:s*ratio,spacingCells:1,wallOffsetMm,method:'auto',maxCircuitLengthMm:maxLength};
          const xx=cuts(local,n,shift),bb=bounds(local.room.sections),rs=rawSpace(local);
          const stripCost=xx.slice(0,-1).reduce((sum,x,i)=>sum+zoneMetrics(rs,{x,y:bb.y,width:xx[i+1]-x,height:bb.bottom-bb.y},s).cost,0);
          if(n>=2&&stripCost>bestShape+40){search.rejections.ARTIFICIAL_STRIPS=(search.rejections.ARTIFICIAL_STRIPS||0)+1;continue;}
          search.attempts++;
          let r;try{r=attempt(p,local,f,n,settings,shift,method,deadline,search,null,maxLength,pairedLeads);}catch(e){if(e.message==='SEARCH_LIMIT'&&best)return finish(best,true);throw e;}
          if(r){const score=objective(p,r,forecast.initialCount);if(!best||score.total<best.score.total)best={...r,settings,score};}
        }
        if(best)return finish(best,true);
      }
      throw new Error('NO_VERIFIED_LAYOUT');
    }catch(e){return{ok:false,status:'AUTO_NOT_FOUND',reason:e.message,circuits:[],search:{...search,elapsedMs:Date.now()-started}};}
  }

  function validate(project,result){
    try{
      if(!result?.ok||result.planner!=='grid-auto'||result.status!=='AUTO_OK')throw new Error('INVALID_PLAN');
      const p=G.createProject(project),m=result.multi,maxLength=result.maxCircuitLengthMm??80000;
      if(!Number.isFinite(maxLength)||maxLength<=0||maxLength!==result.settings?.maxCircuitLengthMm)throw new Error('INVALID_MAX_LENGTH');
      const anchor=result.collectorProposal?.anchor;
      if(!anchor||!p.collector.supply||anchor.x!==p.collector.supply.x||anchor.y!==p.collector.supply.y)throw new Error('COLLECTOR_CHANGED');
      if(!m?.complete||m.overLength||m.circuits.some(c=>c.lengthMm>maxLength)||!m.definitions.every(d=>d.automatic===true))throw new Error('INCOMPLETE_PLAN');
      const valid=M.validate(p,result.settings,m.definitions,m);if(!valid.ok)throw new Error(valid.reason);
      const coverage=V.coverage(p,result.settings,m.circuits);if(!coverage.ok)throw new Error('INCOMPLETE_COVERAGE');
      if(JSON.stringify(coverage)!==JSON.stringify(result.coverage))throw new Error('INVALID_COVERAGE');
      const ports=m.definitions.map(d=>({id:d.id,supply:d.supply,returnPoint:d.returnPoint}));
      if(JSON.stringify(ports)!==JSON.stringify(result.collectorProposal.ports))throw new Error('INVALID_PORTS');
      return {ok:true};
    }catch(e){return {ok:false,reason:e.message};}
  }
  return {plan,validate,partitions,zoneMetrics,estimate};
});
