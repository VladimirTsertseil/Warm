/* Warm 2.9.1: UI adapter for the single, independently testable planner. */
(()=>{
'use strict';
const Engine=globalThis.WarmEngine;
const titles={auto:'Авто',snake:'Змейка','double-snake':'Двойная змейка',spiral:'Улитка',adaptive:'Комбинированная'};
const baseRender=renderPlan,baseCircuit=engineeringCircuitSvgV21;
let generation=0,cancelWorker=null;
function input(){
 const shapeCell=k=>{const [x,y]=k.split(',').map(Number),g=Number(state.shapeStepMm)||100;return{x:x*g,y:y*g,width:g,height:g};};
 const gridCell=k=>{const [x,y]=k.split(',').map(Number),g=Number(state.gridStepMm)||50;return{x:x*g,y:y*g,width:g,height:g};};
 const obstacles=state.obstacles||[];
 // The editor rasterizes each exact obstacle into `excluded` for display and
 // legacy hit testing (syncExcludedFromObstaclesV6). Those cells are a derived
 // mask, not additional physical obstacles. Unioning both creates narrow false
 // ledges whenever a centimetre-snapped rectangle is off the drawing grid.
 // Keep independent painted exclusions: only cells owned by an exact obstacle
 // under the same centre-in-rectangle rule are omitted from the engine input.
 const excluded=[...(state.excluded||[])].map(gridCell).filter(r=>{
  const x=r.x+r.width/2,y=r.y+r.height/2;
  return !obstacles.some(o=>x>=o.x&&x<=o.x+o.width&&y>=o.y&&y<=o.y+o.height);
 });
 return {
  sections:[...(state.sections||[]),...[...(state.roomAdded||[])].map(shapeCell)].map(({x,y,width,height})=>({x,y,width,height})),
  obstacles:Engine.decomposition([...obstacles,...[...(state.roomRemoved||[])].map(shapeCell),...excluded]),
  supply:state.supply?{...state.supply}:null,returnPoint:state.returnPoint?{...state.returnPoint}:null,
  pipeStepMm:Number(state.pipeStepMm)||150,pipeDiameterMm:Number(state.pipeDiameterMm)||16,
  wallOffsetMm:Number(state.wallOffsetMm)||0,minBendRadiusMm:requestedBendRadiusV10(),
  maxCircuitLengthMm:(Number(state.maxCircuitLengthM)||100)*1000,
  pattern:state.layoutUserChoiceV221||'auto',
  deformationJoints:state.deformationJointsV260||state.deformationJoints||[],
  coldWalls:typeof v222ColdWalls==='function'?v222ColdWalls():[],coldBandMm:Number(state.coldBandMm)||800,coldStepMm:Number(state.coldStepMm)||100
 };
}
function evaluate(candidate,params=input()){
 const plan=candidate.plan||{circuits:candidate.route?[{route:candidate.route,supply:params.supply,returnPoint:params.returnPoint}]:[]};
 const hard=Engine.validate(params,plan),quality=hard.ok?Engine.quality(params,plan):{score:0,values:{}};
 return candidate.engineeringV260={version:'2.9.1',hardOK:hard.ok,hard,score:quality.score,quality:quality.values,proven:hard.ok};
}
function lengths(plan){return plan.circuits.map(c=>(c.length/1000).toFixed(1)).join(' + ');}
function word(n){return n===1?'контур':n<5?'контура':'контуров';}
function clear(){state.route=[];state.routeCandidates=[];state.selectedRouteCandidate=null;state.enginePlanV1=null;state.routeComplete=false;state.v260Engineering=null;}
function failure(message='Допустимый вариант не найден. Измените параметры или положение коллектора.'){
 clear();renderPlan();setStatus(message,true);
}
runEngineWorkerV1=function(params){return new Promise((resolve,reject)=>{
 const worker=new Worker('./engine-worker-v120.js?v=290-worker1');
 const finish=(error,result)=>{clearTimeout(timer);worker.terminate();if(cancelWorker===cancel)cancelWorker=null;error?reject(error):resolve(result);};
 const cancel=()=>finish(new Error('planner-cancelled'));
 const timer=setTimeout(()=>finish(new Error('planner-timeout')),300000);
 cancelWorker=cancel;
 worker.onmessage=e=>{const data=e.data,result=data?.result||data;finish(result?.ok?null:new Error(data?.error||result?.error||'planner-error'),result);};
 worker.onerror=e=>finish(new Error(e.message||'worker-error'));
 worker.postMessage(params);
});};
const reset=resetRoute;resetRoute=function(){generation++;cancelWorker?.();reset();};
v221UpdateVariantButton=function(){const b=$('variantSwitchBtnV221');if(b)b.hidden=true;};
v221RenderAlternatives=function(){
 const host=$('routeCandidates'),c=state.routeCandidates?.[0];if(!host)return;
 host.innerHTML=c?.engineeringV260?.proven?`<div class="route-card-v221 active"><span><b>${titles[c.kind]}</b><br>Проверенный вариант</span><span>${lengths(c.plan)} м</span></div>`:'';
 if($('routeSheetSubtitle'))$('routeSheetSubtitle').textContent='Результат';
 if($('routeSheetHelp'))$('routeSheetHelp').textContent='Warm показывает один проверенный вариант.';
};
renderPlan=function(){baseRender();v221UpdateVariantButton();const p=state.enginePlanV1;if(p?.planner==='unified-bcd'&&$('routeInfo'))$('routeInfo').textContent=`${p.circuits.length} ${word(p.circuits.length)} · ${lengths(p)} м`;};
engineeringCircuitSvgV21=function(c,index){
 if(!c.bendRadiusMm)return baseCircuit(c,index);
 const curve=Engine.rounded(c.route,c.bendRadiusMm);if(!curve)return'';
 const points=curve.primitives.flatMap(p=>p.points.slice(0,-1)).concat(c.route.at(-1)),half=engineeringSplitRouteV21(points,.5);
 return `<g class="engineering-route-v21"><path class="pipe-halo" d="${curve.svg}"/><path class="pipe-supply" d="${curve.hotSvg}"/><path class="pipe-return" d="${curve.coldSvg}"/>${engineeringArrowSvgV21(half[0],'flow-arrow-supply')}${engineeringArrowSvgV21(half[1],'flow-arrow-return')}${engineeringFastenersSvgV21(points)}${engineeringCircuitLabelV21(points,index)}</g>`;
};
v221GenerateWithChoice=async function(){
 if(state.engineBusyV1)return;
 if(state.manualV2?.active)manualExitV2A();state.manualV2=blankManualStateV2A();
 collectInputs();recomputeGeometry();
 if(!state.supply||!state.returnPoint){setStatus('Укажите коллектор.',true);return;}
 const params=input(),snapshot=JSON.stringify(params),request=++generation;
 closeSheetV5();clear();state.engineBusyV1=true;renderPlan();setStatus('Рассчитываю схему…',false,{kind:'progress'});
 try{
  const plan=await runEngineWorkerV1(params);
  if(request!==generation)return;
  if(snapshot!==JSON.stringify(input())){failure('Параметры изменились. Повторите расчёт.');return;}
  if(!plan?.ok){failure();return;}
  const candidate={id:'unified-best',kind:plan.kind,name:titles[plan.kind],plan,length:plan.totalLength,physicalReady:true};
  if(!evaluate(candidate,params).proven){failure();return;}
  state.routeCandidates=[candidate];state.selectedRouteCandidate=candidate.id;state.enginePlanV1=plan;state.routeKind=titles[plan.kind];state.routeComplete=true;state.v260Engineering=candidate.engineeringV260;
  v221RenderAlternatives();renderPlan();setStatus(`Готово · проверено · ${plan.circuits.length} ${word(plan.circuits.length)}: ${lengths(plan)} м`);
 }catch(err){if(request===generation){console.error('Warm planner',err);failure('Расчёт не завершён. Попробуйте ещё раз.');}}
 finally{if(request===generation)state.engineBusyV1=false;v221UpdateVariantButton();}
};
// Remove any captured legacy callback, then bind the common entry point.
const old=$('calculateLayoutV221');if(old)old.replaceWith(old.cloneNode(true));
$('calculateLayoutV221')?.addEventListener('click',()=>v221GenerateWithChoice());
globalThis.WarmV260={input,evaluateCandidate:evaluate,hardChecks:circuits=>Engine.validate(input(),{circuits})};
document.querySelector('[data-layout-choice-v221="auto"] small')?.replaceChildren(document.createTextNode('Warm сам выберет проверенный вариант'));
if($('calculateLayoutV221'))$('calculateLayoutV221').textContent='Рассчитать лучший вариант';
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.9.1 · точки излома'));
document.title='Тёплый пол — V2.9.1';
const serialize=serializeState;serializeState=function(){const r=serialize();r.versionLabel='2.9.1';r.roomAdded=[...(state.roomAdded||[])];r.roomRemoved=[...(state.roomRemoved||[])];r.shapeStepMm=state.shapeStepMm;
 if(state.enginePlanV1?.planner==='unified-bcd')r.unifiedPlan=structuredClone(state.enginePlanV1);
 return r;
};
const load=loadScheme;loadScheme=function(raw){
 generation++;cancelWorker?.();state.engineBusyV1=false;clear();load(raw);state.roomAdded=new Set(raw?.roomAdded||[]);state.roomRemoved=new Set(raw?.roomRemoved||[]);state.shapeStepMm=Number(raw?.shapeStepMm)||100;recomputeGeometry();
 if(raw?.unifiedPlan){
  const plan=structuredClone(raw.unifiedPlan);
  for(const c of plan.circuits||[]){c.length=Engine.length(c.route||[]);c.coreLength=Engine.length(c.core||[]);}
  plan.totalLength=(plan.circuits||[]).reduce((s,c)=>s+c.length,0);
  const candidate={id:'unified-best',kind:plan.kind,name:titles[plan.kind],plan,length:plan.totalLength,physicalReady:true};
  try{if(evaluate(candidate).proven){state.enginePlanV1=plan;state.routeCandidates=[candidate];state.selectedRouteCandidate=candidate.id;state.route=[];state.routeComplete=true;state.v260Engineering=candidate.engineeringV260;}else clear();}catch{clear();}
 }
 v221RenderAlternatives();renderPlan();
};
// The legacy flow button reverses points; maintain the new physical-outlet
// metadata too, then revalidate the same geometry.
const reverseFlow=v222ReverseCurrentFlow;v222ReverseCurrentFlow=function(){
 reverseFlow();const plan=state.enginePlanV1;if(plan?.planner!=='unified-bcd')return;
 for(const c of plan.circuits){const supply=c.supply;c.supply=c.returnPoint;c.returnPoint=supply;}
 const params=input();plan.manifold=Engine.manifoldPorts(Engine.normalize(params),plan.circuits.length,Engine.freeSpace(Engine.normalize(params)));
 const candidate=state.routeCandidates?.[0];if(candidate){state.v260Engineering=evaluate(candidate,params);state.routeComplete=state.v260Engineering.proven;}
 renderPlan();
};
const reverseButton=$('reverseFlowV222');if(reverseButton)reverseButton.replaceWith(reverseButton.cloneNode(true));
$('reverseFlowV222')?.addEventListener('click',()=>v222ReverseCurrentFlow());
})();
