/* Warm V2.3.2. Keep the V2.3.1 collector and manual editor intact. */
'use strict';
const layoutClassesV232=['snake','double-snake','spiral','adaptive'];
const layoutTitlesV232={snake:'Змейка','double-snake':'Двойная змейка',spiral:'Улитка',adaptive:'Комбинированный',auto:'Авто'};
const layoutDescriptionsV232={snake:'Последовательные параллельные проходы', 'double-snake':'Встречные пары подачи и обратки по всей площади',spiral:'Подача к центру, обратка между витками',adaptive:'Локальные рисунки и направления по зонам'};

finalDoubleCoreV21=function doubleCoreV232(axis,reverse=false,flip=false){
  const result=WarmPatternsV232.doubleMeander({rect:betaInnerRectV21(),axis,lanes:finalEvenLaneSetV21(axis),reverse,flip});
  if(!result||!validRoute(result.route))return null;
  const route=cleanRouteV8(result.route);route._doubleV232=true;return route;
};
betaDoubleCoreV21=finalDoubleCoreV21;
generateDoubleSnake=function generateDoubleSnakeV232(){return betaSnakeCandidatesV21('double-snake')[0]?.route||null;};
betaSnakeCoreV21=function snakeCoreV232(axis,doubleMode=false,reverse=false,flip=false){
  return doubleMode?finalDoubleCoreV21(axis,reverse,flip):finalSnakeCoreV21(axis,false,reverse,flip);
};
const attachCoreV231=betaAttachCoreV21;
betaAttachCoreV21=function attachCoreV232(core){
  if(!core?._doubleV232)return attachCoreV231(core);
  // Free ends of a paired meander are adjacent at the same edge. Compare
  // both traversal directions and the existing orthogonal perimeter tails.
  const col=sameSideCollectorV8();if(!col)return null;
  const routes=[];
  for(const c of [core,[...core].reverse()]){
    routes.push(attachCollectorTailsV8(c,col,betaInnerRectV21(),state.bounds),betaAttachCoreSmartV21(c,col));
    const a=c[0],z=c.at(-1),s=col.supply,r=col.ret;
    routes.push(cleanRouteV8([s,{x:s.x,y:a.y},...c,{x:r.x,y:z.y},r]),cleanRouteV8([s,{x:a.x,y:s.y},...c,{x:z.x,y:r.y},r]));
  }
  return routes.filter(r=>r?.length>3&&r.every((p,i)=>!i||Math.abs(p.x-r[i-1].x)<.1||Math.abs(p.y-r[i-1].y)<.1)&&validRoute(r)).sort((a,b)=>routeLength(a)-routeLength(b))[0]||null;
};

function previewPathV232(route){
  const cut=route.slice(1).reduce((n,p,i)=>n+dist(route[i],p),0)/2;
  const hot=route.length?[route[0]]:[],cold=[];let length=0;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],l=dist(a,b);
    if(!cold.length&&length+l>=cut){
      const t=l?(cut-length)/l:0,m={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      hot.push(m);cold.push(m,b);
    }else (cold.length?cold:hot).push(b);
    length+=l;
  }
  // Plan rendering uses millimetres and the requested pipe bend radius.
  // Miniatures use their own viewBox units; never apply that physical radius.
  const path=points=>{
    if(!points.length)return'';let d=`M${points[0].x} ${points[0].y}`;
    for(let i=1;i<points.length-1;i++){
      const a=points[i-1],b=points[i],c=points[i+1],ab=dist(a,b),bc=dist(b,c),r=Math.min(1.8,ab/2,bc/2);
      if(ab<.001||bc<.001)continue;
      const p={x:b.x+(a.x-b.x)*r/ab,y:b.y+(a.y-b.y)*r/ab},q={x:b.x+(c.x-b.x)*r/bc,y:b.y+(c.y-b.y)*r/bc};
      d+=` L${p.x} ${p.y} Q${b.x} ${b.y} ${q.x} ${q.y}`;
    }
    const z=points.at(-1);return d+` L${z.x} ${z.y}`;
  };
  return [hot,cold].map((p,i)=>`<path d="${path(p)}" fill="none" stroke="${i?'#2563eb':'#ef4444'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
}
function previewV232(kind){
  const lanes=Array.from({length:10},(_,i)=>6+i*5.5),rect={left:6,right:58,top:6,bottom:58};
  let content='';
  if(kind==='double-snake')content=previewPathV232(WarmPatternsV232.doubleMeander({rect,lanes}).route);
  else if(kind==='snake')content=previewPathV232(lanes.flatMap((y,i)=>i%2?[{x:58,y},{x:6,y}]:[{x:6,y},{x:58,y}]));
  else if(kind==='spiral'){
    const route=spiralCoreCandidatesV8(520,520,55)[0];
    if(route)content=previewPathV232(route.map(p=>({x:6+p.x/10,y:6+p.y/10})));
  }else if(kind==='adaptive'){
    const a=WarmPatternsV232.doubleMeander({rect:{left:5,right:59,top:5,bottom:31},lanes:[6,11,16,21,26,31]}).route;
    const b=[{x:8,y:38},{x:56,y:38},{x:56,y:58},{x:8,y:58},{x:8,y:44},{x:50,y:44},{x:50,y:52},{x:14,y:52}];
    content=previewPathV232(a)+previewPathV232(b)+'<path d="M3 35H61" stroke="#94a3b8" stroke-dasharray="2 2"/>';
  }else content='<text x="32" y="42" font-size="36" text-anchor="middle" fill="#2563eb">✦</text>';
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${content}</svg>`;
}

v221ChoiceTitle=mode=>layoutTitlesV232[mode]||'Авто';
v221CandidateKind=c=>layoutClassesV232.includes(c?.kind)?c.kind:c?.plan?.planner==='multi-cell-spiral'?'spiral':'adaptive';
v221CandidateFriendly=c=>v221ChoiceTitle(v221CandidateKind(c));
v221FamilyKey=c=>v221CandidateKind(c);
v221FamilyTitle=v221CandidateFriendly;
v221CandidateSub=c=>layoutDescriptionsV232[v221CandidateKind(c)];
betaPatternLabelV21=c=>v221CandidateSub(c);
function scoreCandidateV232(c){
  const n=c.plan?.circuits?.length||1;
  return (n-1)*25000+betaRouteScoreV21(c);
}
function planCandidateV232(plan,kind){
  if(!plan?.ok||!plan.circuits?.length)return null;
  kind=kind||plan.kind||(plan.planner==='multi-cell-spiral'?'spiral':plan.planner==='global-scanline'?'snake':'adaptive');
  const limit=(Number(state.maxCircuitLengthM)||100)*1000;
  if(plan.circuits.some(c=>c.length>limit*1.015))return null;
  const bendWarning=plan.planner==='paired-meander-strips'&&plan.circuits.some(c=>cornerRadiusStatsV10(c.route,3).bad>0);
  const c={id:`v232-${kind}-${plan.planner}`,kind,name:v221ChoiceTitle(kind),plan,length:plan.totalLength,
    axis:plan.axis,bends:plan.circuits.reduce((n,c)=>n+betaCountBendsV21(c.route),0),
    diagnostics:{ratio:plan.coverage||1,bendOK:!bendWarning},bendWarning,physicalReady:!bendWarning};
  c.score=scoreCandidateV232(c);return c;
}
function chooseV232(list,kind){
  const candidates=kind==='auto'?list:list.filter(c=>v221CandidateKind(c)===kind);
  return [...candidates].sort((a,b)=>Number(!!a.bendWarning)-Number(!!b.bendWarning)||a.score-b.score)[0]||null;
}
function splitDoubleV232(){
  if(!v221SimpleShape())return null;
  const b=state.bounds,col=sameSideCollectorV8();if(!col)return null;
  const side=col.side,vertical=side==='left'||side==='right';
  const width=vertical?b.height:b.width,depth=vertical?b.width:b.height;
  const step=Math.max(50,Number(state.pipeStepMm)||150),off=Math.max(0,Number(state.wallOffsetMm)||0);
  const limit=(Number(state.maxCircuitLengthM)||100)*1000;
  const map=(t,d)=>side==='bottom'?{x:b.minX+t,y:b.maxY-d}:side==='top'?{x:b.minX+t,y:b.minY+d}:side==='left'?{x:b.minX+d,y:b.minY+t}:{x:b.maxX-d,y:b.minY+t};
  const along=p=>vertical?p.y-b.minY:p.x-b.minX;
  const mainS=along(col.supply),mainR=along(col.ret),middle=(mainS+mainR)/2;
  // Local meanders remain complete patterns; only hydraulic length splits
  // them into strips. Paired approach lanes occupy a shared edge corridor.
  for(let count=2;count<=8;count++){
    const tailGap=Math.max(32,Number(state.pipeDiameterMm)*2),gutter=off+(2*count+1)*tailGap;
    if(depth-gutter-off<step*4||width/count-2*off<step*3)break;
    const order=Array.from({length:count},(_,i)=>i).sort((a,z)=>Math.abs((a+.5)*width/count-middle)-Math.abs((z+.5)*width/count-middle));
    const portStart=clamp(middle-(2*count-1)*tailGap/2,tailGap,width-2*count*tailGap);
    const circuits=[];let failed=false;
    for(let rank=0;rank<count;rank++){
      const i=order[rank],left=i*width/count+off,right=(i+1)*width/count-off;
      // One manifold has a dedicated pair of outlets for each circuit.
      // Reusing the exact same two points would overlap the approach pipes.
      const p0=portStart+2*i*tailGap,p1=p0+tailGap;
      const s=mainS<=mainR?p0:p1,r=mainS<=mainR?p1:p0;
      const runAxis=vertical?'horizontal':'vertical',origin=vertical?b.minY:b.minX;
      const lanes=v222ColdActive()?finalVariableLanePositionsV21(runAxis).map(v=>v-origin).filter(v=>v>=left&&v<=right):betaLanePositionsV21(left,right,step);
      const result=WarmPatternsV232.doubleMeander({rect:{left:gutter,right:depth-off,top:left,bottom:right},lanes});
      if(!result){failed=true;break;}
      const core=result.route.map(p=>map(p.y,p.x));
      const near=off+(count-rank)*2*tailGap,far=near-tailGap;
      const routes=[];
      for(const q of [core,[...core].reverse()])for(const swap of [false,true]){
        const a=q[0],z=q.at(-1),sd=swap?near:far,rd=swap?far:near;
        const route=cleanRouteV8([map(s,0),map(s,sd),map(along(a),sd),...q,map(along(z),rd),map(r,rd),map(r,0)]);
        const crosses=circuits.some(c=>route.some((p,j)=>j&&c.route.some((q,k)=>k&&segmentsIntersect(route[j-1],p,c.route[k-1],q))));
        if(!crosses&&validRoute(route)&&routeLength(route)<=limit)routes.push(route);
      }
      if(!routes.length){failed=true;break;}
      const route=routes.sort((a,z)=>routeLength(a)-routeLength(z))[0];
      circuits.push({id:circuits.length+1,route,length:routeLength(route),pattern:'double-snake',collectorIndex:0,supply:route[0],returnPoint:route.at(-1)});
    }
    if(!failed){
      const totalLength=circuits.reduce((n,c)=>n+c.length,0);
      return {ok:true,kind:'double-snake',planner:'paired-meander-strips',axis:vertical?'horizontal':'vertical',circuits,totalLength,zones:count,coverage:.94,warnings:v222ColdActive()?['Проверьте заполнение краевой зоны после разделения на контуры.']:[]};
    }
  }
  return null;
}
v221BestRequested=list=>chooseV232(list,state.layoutUserChoiceV221||'auto');
v221FriendlyCandidates=function friendlyCandidatesV232(){
  return layoutClassesV232.map(k=>{
    const group=(state.routeCandidates||[]).filter(c=>v221CandidateKind(c)===k);
    return group.find(c=>c.id===state.selectedRouteCandidate)||chooseV232(group,k);
  }).filter(Boolean);
};
v221UpdateVariantButton=function updateVariantV232(){
  const btn=$('variantSwitchBtnV221'),lab=$('variantSwitchLabelV221');if(!btn||!lab)return;
  const selected=(state.routeCandidates||[]).find(c=>c.id===state.selectedRouteCandidate);
  lab.textContent=selected?v221CandidateFriendly(selected):state.enginePlanV1?.planner==='multi-cell-spiral'?'Улитка':state.routeKind||'Авто';
  btn.hidden=!(state.route?.length||state.enginePlanV1?.ok);
};
betaSelectCandidateV21=function selectCandidateV232(id){
  const c=(state.routeCandidates||[]).find(c=>c.id===id);if(!c)return;
  betaApplyCandidatePortsV21(c);state.selectedRouteCandidate=id;
  state.enginePlanV1=c.plan||null;state.route=c.plan?[]:clonePointsV2A(c.route);
  state.routeKind=v221CandidateFriendly(c);state.routeComplete=c.physicalReady!==false;
  renderPlan();v221RenderAlternatives();v221UpdateVariantButton();
  setStatus(`${state.routeKind}: ${(c.length/1000).toFixed(1)} м.${c.bendWarning?' Радиус поворота меньше заданного — увеличьте шаг или уточните Rmin.':''}`,!!c.bendWarning);
};
v221RenderAlternatives=function alternativesV232(){
  const host=$('routeCandidates');if(!host)return;
  const family=v221FriendlyCandidates(),recommended=chooseV232(family,'auto');
  host.innerHTML=family.map(c=>`<button type="button" class="route-card-v221${c.id===state.selectedRouteCandidate?' active':''}" data-v232-candidate="${c.id}"><span class="route-preview-v232"><span class="layout-mini-v232">${previewV232(c.kind)}</span><span><span class="r-title">${v221CandidateFriendly(c)}${recommended===c&&state.layoutUserChoiceV221==='auto'?'<span class="r-rec">Авто рекомендует</span>':''}</span><span class="r-sub">${v221CandidateSub(c)}</span>${c.bendWarning?'<span class="route-warning-v232">Проверьте радиус изгиба</span>':''}</span></span><span><span class="r-len">${(c.length/1000).toFixed(1)} м</span><span class="r-meta">${c.plan?.circuits?.length||1} контур(а)</span></span></button>`).join('')||'<div class="route-empty">Допустимый вариант выбранной схемы не найден. Проверьте шаг, лимит длины и положение коллектора.</div>';
  host.querySelectorAll('[data-v232-candidate]').forEach(b=>b.addEventListener('click',()=>{betaSelectCandidateV21(b.dataset.v232Candidate);closeSheetV5();}));
  if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent='Змейка · Двойная змейка · Улитка · Комбинированный';
  if($('routeSheetHelp'))$('routeSheetHelp').textContent='Показан один лучший вариант каждого доступного класса. Направление, старт и подводки выбраны автоматически.';
};
v221SyncChooser=function syncChooserV232(){
  document.querySelectorAll('[data-layout-choice-v221]').forEach(b=>{
    const active=b.dataset.layoutChoiceV221===state.layoutUserChoiceV221;
    b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
  });
  // Orientation/start are optimizer details, never additional user classes.
  $('layoutDirectionBlockV221')?.classList.add('hidden');$('layoutTurnBlockV221')?.classList.add('hidden');
  if($('layoutCalcSummaryV221'))$('layoutCalcSummaryV221').textContent=v221Summary();
};
v221OpenChooser=function openChooserV232(){collectInputs();recomputeGeometry();v221SyncChooser();openSheetV5('layoutChooserSheetV221');};
v221GenerateWithChoice=async function generateWithChoiceV232(){
  if(state.engineBusyV1)return;
  if(state.manualV2?.active)manualExitV2A();state.manualV2=blankManualStateV2A();
  collectInputs();recomputeGeometry();
  if(!state.supply||!state.returnPoint){setStatus('Сначала укажите коллектор.',true);return;}
  const requested=state.layoutUserChoiceV221||'auto';closeSheetV5();state.engineBusyV1=true;
  setStatus('Сравниваю схемы укладки…');
  try{
    state.layoutSchemeV21='auto';state.layoutOrientationV21='auto';state.layoutEntryV21='auto';state.layoutTurnV21='auto';
    const limit=(Number(state.maxCircuitLengthM)||100)*1000;
    let list=v221SimpleShape()?betaPatternCandidatesV21().filter(c=>c.length<=limit):[];
    list.forEach(c=>{c.name=v221ChoiceTitle(c.kind);c.score=scoreCandidateV232(c);});
    if(v221SimpleShape()&&!list.some(c=>c.kind==='double-snake')){
      const p=splitDoubleV232(),c=planCandidateV232(p,'double-snake');if(c)list.push(c);
    }
    const result=await runEngineWorkerV1({...engineInputV1(),layoutFamiliesV232:true});
    if(result?.ok){
      for(const p of result.familyPlansV232||[result]){const c=planCandidateV232(p);if(c)list.push(c);}
    }
    if(v23PresetComplexSpiralPossible()){
      const p=v23ComplexSpiralPlan();const c=planCandidateV232(p,'spiral');if(c)list.push(c);
    }
    state.routeCandidates=list;state.layoutSchemeV21=requested;
    if($('layoutSchemeInput'))$('layoutSchemeInput').value=requested;
    const chosen=chooseV232(list,requested);
    if(chosen)betaSelectCandidateV21(chosen.id);
    else{
      state.selectedRouteCandidate=null;state.route=[];state.enginePlanV1=null;state.routeComplete=false;renderPlan();
      v221RenderAlternatives();setStatus(`${v221ChoiceTitle(requested)}: допустимый контур не найден при текущем шаге и лимите длины. Выберите другой рисунок или измените параметры.`,true);openSheetV5('routeSheet');
    }
  }catch(err){setStatus(`Не удалось завершить расчёт: ${err.message}`,true);}
  finally{state.engineBusyV1=false;v221UpdateVariantButton();}
};
v221RecalculateFamily=async function recalculateV232(kind){state.layoutUserChoiceV221=kind;v221SyncChooser();await v221GenerateWithChoice();};

// Remove old callbacks that captured older generator functions, including the
// complex-spiral capture handler. All four classes now use the same selection.
for(const id of ['calculateLayoutV221']){const old=$(id);if(old)old.replaceWith(old.cloneNode(true));}
$('calculateLayoutV221')?.addEventListener('click',()=>v221GenerateWithChoice());
document.querySelectorAll('[data-layout-choice-v221]').forEach(old=>{
  const b=old.cloneNode(true);old.replaceWith(b);
  b.addEventListener('click',()=>{state.layoutUserChoiceV221=b.dataset.layoutChoiceV221;v221SyncChooser();});
});
document.querySelectorAll('[data-preview-v232]').forEach(el=>el.innerHTML=previewV232(el.dataset.previewV232));
const serializeV231For232=serializeState;
serializeState=function serializeV232(){const result=serializeV231For232();result.versionLabel='2.3.2';return result;};
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.3.2 · схемы укладки'));
v221SyncChooser();
