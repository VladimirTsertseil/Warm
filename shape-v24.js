(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.WarmShapeV24=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const CORNERS=['tl','tr','br','bl'];
  const clone=v=>JSON.parse(JSON.stringify(v));
  function blankCut(){return{active:false,width:1000,depth:1000};}
  function defaultModel(width=4000,height=3000,x=0,y=0){
    return{x,y,width,height,cuts:{tl:blankCut(),tr:blankCut(),br:blankCut(),bl:blankCut()}};
  }
  function normalizeModel(raw){
    const src=raw||{};const m=defaultModel(Number(src.width)||4000,Number(src.height)||3000,Number(src.x)||0,Number(src.y)||0);
    m.width=Math.max(500,Number(src.width)||m.width);m.height=Math.max(500,Number(src.height)||m.height);
    for(const k of CORNERS){const c=src.cuts?.[k]||{};m.cuts[k]={active:!!c.active,width:Math.max(100,Number(c.width)||Math.min(1000,m.width*.25)),depth:Math.max(100,Number(c.depth)||Math.min(1000,m.height*.25))};}
    return m;
  }
  function validateModel(raw,minBridge=200){
    const m=normalizeModel(raw),errors=[];
    for(const k of CORNERS){const c=m.cuts[k];if(!c.active)continue;if(c.width<100||c.depth<100)errors.push(`${k}: вырез слишком мал`);if(c.width>m.width-minBridge)errors.push(`${k}: ширина выреза слишком велика`);if(c.depth>m.height-minBridge)errors.push(`${k}: глубина выреза слишком велика`);}
    const top=(m.cuts.tl.active?m.cuts.tl.width:0)+(m.cuts.tr.active?m.cuts.tr.width:0);
    const bottom=(m.cuts.bl.active?m.cuts.bl.width:0)+(m.cuts.br.active?m.cuts.br.width:0);
    const left=(m.cuts.tl.active?m.cuts.tl.depth:0)+(m.cuts.bl.active?m.cuts.bl.depth:0);
    const right=(m.cuts.tr.active?m.cuts.tr.depth:0)+(m.cuts.br.active?m.cuts.br.depth:0);
    if(top>m.width-minBridge)errors.push('Верхние вырезы пересекаются');
    if(bottom>m.width-minBridge)errors.push('Нижние вырезы пересекаются');
    if(left>m.height-minBridge)errors.push('Левые вырезы пересекаются');
    if(right>m.height-minBridge)errors.push('Правые вырезы пересекаются');
    return{ok:errors.length===0,errors,model:m};
  }
  function buildSections(raw,minBridge=200){
    const v=validateModel(raw,minBridge);if(!v.ok)return{...v,sections:[]};const m=v.model,{x,y,width:W,height:H,cuts:c}=m;
    const active=CORNERS.filter(k=>c[k].active);
    // Preserve a useful two-cell decomposition for classic L rooms. This keeps
    // the existing local-spiral planner effective after migrating away from L presets.
    if(active.length===1){const k=active[0],q=c[k],sections=[];
      if(k==='tl')sections.push({x:x+q.width,y,width:W-q.width,height:H},{x,y:y+q.depth,width:q.width,height:H-q.depth});
      if(k==='tr')sections.push({x,y,width:W-q.width,height:H},{x:x+W-q.width,y:y+q.depth,width:q.width,height:H-q.depth});
      if(k==='br')sections.push({x,y,width:W-q.width,height:H},{x:x+W-q.width,y,width:q.width,height:H-q.depth});
      if(k==='bl')sections.push({x:x+q.width,y,width:W-q.width,height:H},{x,y,width:q.width,height:H-q.depth});
      return{ok:true,errors:[],model:m,sections};
    }
    const ys=[y,y+H];
    if(c.tl.active)ys.push(y+c.tl.depth);if(c.tr.active)ys.push(y+c.tr.depth);
    if(c.bl.active)ys.push(y+H-c.bl.depth);if(c.br.active)ys.push(y+H-c.br.depth);
    const b=[...new Set(ys.map(n=>Math.round(n*1000)/1000))].sort((a,z)=>a-z),sections=[];
    for(let i=0;i<b.length-1;i++){
      const y0=b[i],y1=b[i+1];if(y1-y0<1e-6)continue;const mid=(y0+y1)/2;
      let li=0,ri=0;
      if(c.tl.active&&mid<y+c.tl.depth)li=Math.max(li,c.tl.width);
      if(c.bl.active&&mid>y+H-c.bl.depth)li=Math.max(li,c.bl.width);
      if(c.tr.active&&mid<y+c.tr.depth)ri=Math.max(ri,c.tr.width);
      if(c.br.active&&mid>y+H-c.br.depth)ri=Math.max(ri,c.br.width);
      const w=W-li-ri;if(w<minBridge)return{ok:false,errors:['Вырезы пересекаются внутри помещения'],model:m,sections:[]};
      const r={x:x+li,y:y0,width:w,height:y1-y0};const prev=sections.at(-1);
      if(prev&&Math.abs(prev.x-r.x)<1e-6&&Math.abs(prev.width-r.width)<1e-6&&Math.abs(prev.y+prev.height-r.y)<1e-6)prev.height+=r.height;else sections.push(r);
    }
    return{ok:true,errors:[],model:m,sections};
  }
  function rotateCW(raw){
    const m=normalizeModel(raw),n=defaultModel(m.height,m.width,m.x,m.y),map={tl:'tr',tr:'br',br:'bl',bl:'tl'};
    for(const k of CORNERS){const c=m.cuts[k];n.cuts[map[k]]={active:c.active,width:c.depth,depth:c.width};}
    return normalizeModel(n);
  }
  function contains(sections,x,y,eps=.5){return(sections||[]).some(s=>x>=s.x-eps&&x<=s.x+s.width+eps&&y>=s.y-eps&&y<=s.y+s.height+eps);}
  function boundsOf(sections){if(!sections?.length)return null;const minX=Math.min(...sections.map(s=>s.x)),minY=Math.min(...sections.map(s=>s.y)),maxX=Math.max(...sections.map(s=>s.x+s.width)),maxY=Math.max(...sections.map(s=>s.y+s.height));return{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};}
  function inferFromSections(sections){
    const b=boundsOf(sections);if(!b)return null;const m=defaultModel(b.width,b.height,b.minX,b.minY),tol=2,eps=Math.max(2,Math.min(b.width,b.height)*.0005);
    const edge={top:(sections||[]).filter(s=>Math.abs(s.y-b.minY)<tol),bottom:(sections||[]).filter(s=>Math.abs(s.y+s.height-b.maxY)<tol),left:(sections||[]).filter(s=>Math.abs(s.x-b.minX)<tol),right:(sections||[]).filter(s=>Math.abs(s.x+s.width-b.maxX)<tol)};
    const cornerData={
      tl:()=>({missing:!contains(sections,b.minX+eps,b.minY+eps),width:Math.min(...edge.top.map(s=>s.x),b.maxX)-b.minX,depth:Math.min(...edge.left.map(s=>s.y),b.maxY)-b.minY}),
      tr:()=>({missing:!contains(sections,b.maxX-eps,b.minY+eps),width:b.maxX-Math.max(...edge.top.map(s=>s.x+s.width),b.minX),depth:Math.min(...edge.right.map(s=>s.y),b.maxY)-b.minY}),
      br:()=>({missing:!contains(sections,b.maxX-eps,b.maxY-eps),width:b.maxX-Math.max(...edge.bottom.map(s=>s.x+s.width),b.minX),depth:b.maxY-Math.max(...edge.right.map(s=>s.y+s.height),b.minY)}),
      bl:()=>({missing:!contains(sections,b.minX+eps,b.maxY-eps),width:Math.min(...edge.bottom.map(s=>s.x),b.maxX)-b.minX,depth:b.maxY-Math.max(...edge.left.map(s=>s.y+s.height),b.minY)}),
    };
    for(const k of CORNERS){const d=cornerData[k]();if(d.missing&&d.width>50&&d.depth>50)m.cuts[k]={active:true,width:d.width,depth:d.depth};}
    const built=buildSections(m,50);if(!built.ok)return null;
    // Compare occupancy on every rectangular cell induced by both decompositions.
    const xs=[b.minX,b.maxX],ys=[b.minY,b.maxY];for(const s of [...sections,...built.sections]){xs.push(s.x,s.x+s.width);ys.push(s.y,s.y+s.height);}const ux=[...new Set(xs)].sort((a,z)=>a-z),uy=[...new Set(ys)].sort((a,z)=>a-z);
    for(let i=0;i<ux.length-1;i++)for(let j=0;j<uy.length-1;j++){const x=(ux[i]+ux[i+1])/2,y=(uy[j]+uy[j+1])/2;if(contains(sections,x,y)!==contains(built.sections,x,y))return null;}
    return m;
  }
  function activeCount(raw){const m=normalizeModel(raw);return CORNERS.filter(k=>m.cuts[k].active).length;}
  return{CORNERS,defaultModel,normalizeModel,validateModel,buildSections,rotateCW,inferFromSections,activeCount,clone};
});
