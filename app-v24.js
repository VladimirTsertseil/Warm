// Warm V2.4.1 — corner-cut wall remainder dimensions.
(()=>{
'use strict';
const Shape=globalThis.WarmShapeV24;if(!Shape)return;
const V24_MIN_BRIDGE=200;
const cornerNamesV24={tl:'Верхний левый',tr:'Верхний правый',br:'Нижний правый',bl:'Нижний левый'};
let selectedCornerV24='bl';
let dragV24={active:false,pointerId:null,corner:null,kind:null};
let dragFrameV24=0;
const cloneV24=v=>JSON.parse(JSON.stringify(v));

function modelFromStateV24(){
  const p=state.shapeParams;
  if(!p?.v24)return null;
  return Shape.normalizeModel({x:p.x,y:p.y,width:p.width,height:p.height,cuts:p.cuts});
}
function paramsFromModelV24(m){m=Shape.normalizeModel(m);return{v24:true,x:m.x,y:m.y,width:m.width,height:m.height,cuts:cloneV24(m.cuts)};}
function sectionsFromModelV24(m){
  const b=Shape.buildSections(m,V24_MIN_BRIDGE);if(!b.ok)return b;
  b.sections=b.sections.map((r,i)=>({id:`v24-section-${i}`,name:i?'Часть':'Основной',...r,base:i===0}));return b;
}
function activeCutsV24(m=modelFromStateV24()){return m?Shape.activeCount(m):0;}
function updateUndoStateV24(){$('undoBtn')?.classList.toggle('disabled',!historyV5.length);}
function applyModelV24(raw,{history=false,reset=true,fit=false,render=true,statusText=''}={}){
  const built=sectionsFromModelV24(raw);if(!built.ok){showShapeErrorV24(built.errors.join('. '));return false;}
  if(history){pushHistoryV5();updateUndoStateV24();}
  const m=built.model;state.shapeParams=paramsFromModelV24(m);state.shapeOrientation=0;
  state.shapeType=Shape.activeCount(m)?'custom':'rect';state.shapeAxes=state.shapeType==='rect'?{xs:[m.x,m.x+m.width],ys:[m.y,m.y+m.height]}:null;
  state.sections=built.sections;state.roomAdded?.clear?.();state.roomRemoved?.clear?.();
  if(reset)resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();
  if(fit)fitPlan(false);refreshShapeUiV24();if(render)renderPlan();if(statusText)setStatus(statusText);return true;
}
function defaultV24FromBounds(){const b=state.bounds?.width>10?state.bounds:{minX:0,minY:0,width:4000,height:3000};return Shape.defaultModel(b.width,b.height,b.minX||0,b.minY||0);}
function adoptCurrentShapeV24(raw=null){
  if(state.shapeParams?.v24){applyModelV24(modelFromStateV24(),{reset:false,render:false});return true;}
  const originalType=raw?.shapeType||state.shapeType;
  if(originalType==='rect'&&(state.sections?.length||0)===1){applyModelV24(defaultV24FromBounds(),{reset:false,render:false});return true;}
  const inferred=Shape.inferFromSections(state.sections||[]);
  if(inferred&&(originalType==='L'||originalType==='T'||originalType==='custom')){applyModelV24(inferred,{reset:false,render:false});return true;}
  return false;
}
function showShapeErrorV24(msg=''){
  const el=$('cornerCutErrorV24');if(!el)return;el.textContent=msg;el.classList.toggle('hidden',!msg);
}
function maxCutWidthV24(m,corner){
  const other=corner==='tl'?'tr':corner==='tr'?'tl':corner==='bl'?'br':'bl';return Math.max(.1,m.width-(m.cuts[other].active?m.cuts[other].width:0)-V24_MIN_BRIDGE);
}
function maxCutDepthV24(m,corner){
  const other=corner==='tl'?'bl':corner==='bl'?'tl':corner==='tr'?'br':'tr';return Math.max(.1,m.height-(m.cuts[other].active?m.cuts[other].depth:0)-V24_MIN_BRIDGE);
}
function refreshShapeUiV24(){
  const m=modelFromStateV24(),legacy=!m;
  $('legacyShapeNoticeV24')?.classList.toggle('hidden',!legacy);
  for(const id of ['shapeWidthInput','shapeHeightInput','rotateShapeV24']) if($(id))$(id).disabled=legacy&&id!=='rotateShapeV24';
  const map=document.querySelector('.corner-map-v24'),panel=$('cornerCutPanelV24');if(map)map.classList.toggle('disabled',legacy);if(panel)panel.classList.toggle('disabled',legacy);
  if(!m){document.querySelectorAll('[data-v24-corner]').forEach(b=>{b.classList.remove('active','has-cut');});return;}
  if($('shapeWidthInput'))$('shapeWidthInput').value=(m.width/1000).toFixed(2);if($('shapeHeightInput'))$('shapeHeightInput').value=(m.height/1000).toFixed(2);
  document.querySelectorAll('[data-v24-corner]').forEach(b=>{const k=b.dataset.v24Corner,c=m.cuts[k];b.classList.toggle('active',k===selectedCornerV24);b.classList.toggle('has-cut',!!c.active);const ico=b.querySelector('b');if(ico)ico.textContent=c.active?'✓':'＋';});
  const c=m.cuts[selectedCornerV24],title=$('cornerCutTitleV24'),stateEl=$('cornerCutStateV24'),toggle=$('toggleCornerCutV24'),fields=$('cornerCutFieldsV24');
  if(title)title.textContent=cornerNamesV24[selectedCornerV24];if(stateEl)stateEl.textContent=c.active?'Вырез активен. Размеры можно менять здесь или на плане.':'В этом углу выреза нет.';
  if(toggle){toggle.textContent=c.active?'Удалить вырез':'Добавить вырез';toggle.classList.toggle('danger-lite-v24',c.active);}
  fields?.classList.toggle('hidden',!c.active);
  if(c.active){const wi=$('cornerCutWidthV24'),di=$('cornerCutDepthV24');if(wi){wi.value=(c.width/1000).toFixed(2);wi.max=(maxCutWidthV24(m,selectedCornerV24)/1000).toFixed(2);}if(di){di.value=(c.depth/1000).toFixed(2);di.max=(maxCutDepthV24(m,selectedCornerV24)/1000).toFixed(2);}}
  showShapeErrorV24('');
}
function readSheetIntoModelV24(){
  const m=modelFromStateV24();if(!m)return null;const n=cloneV24(m);n.width=Math.round((Number($('shapeWidthInput')?.value)||m.width/1000)*1000/10)*10;n.height=Math.round((Number($('shapeHeightInput')?.value)||m.height/1000)*1000/10)*10;
  if(n.width<500||n.width>30000||n.height<500||n.height>30000)return null;const c=n.cuts[selectedCornerV24];if(c.active){c.width=Math.round((Number($('cornerCutWidthV24')?.value)||c.width/1000)*1000/10)*10;c.depth=Math.round((Number($('cornerCutDepthV24')?.value)||c.depth/1000)*1000/10)*10;}
  return n;
}
function applySheetV24({history=true,close=false}={}){
  const n=readSheetIntoModelV24();if(!n){showShapeErrorV24('Проверьте размеры помещения.');return false;}const built=Shape.buildSections(n,V24_MIN_BRIDGE);if(!built.ok){showShapeErrorV24(built.errors.join('. '));return false;}
  const ok=applyModelV24(n,{history,fit:false,statusText:'Форма помещения обновлена.'});if(ok&&close)closeSheetV5();return ok;
}
function addOrRemoveCutV24(){
  let m=modelFromStateV24();if(!m)return;m=cloneV24(m);const c=m.cuts[selectedCornerV24];if(c.active)c.active=false;else{c.active=true;c.width=Math.min(1000,m.width*.28,maxCutWidthV24(m,selectedCornerV24));c.depth=Math.min(1000,m.height*.28,maxCutDepthV24(m,selectedCornerV24));}
  applyModelV24(m,{history:true,fit:false,statusText:c.active?'Вырез добавлен.':'Вырез удалён.'});
}
function rotateV24(){
  const m=modelFromStateV24();if(!m){rotatePlanV6();return;}pushHistoryV5();updateUndoStateV24();const oldB={minX:m.x,minY:m.y,width:m.width,height:m.height};
  state.obstacles=(state.obstacles||[]).map(o=>rotateRectCWCustomV6(o,oldB));for(const k of ['supply','returnPoint'])if(state[k])state[k]=rotatePointCWCustomV6(state[k],oldB);
  const n=Shape.rotateCW(m);applyModelV24(n,{history:false,fit:true,statusText:'Форма повернута на 90°.'});
}
function resetV24(){const m=modelFromStateV24()||defaultV24FromBounds();const n=Shape.defaultModel(4000,3000,m.x||0,m.y||0);state.obstacles=[];state.selectedObstacleId=null;state.excluded?.clear?.();state.supply=null;state.returnPoint=null;applyModelV24(n,{history:true,fit:true,statusText:'Форма сброшена до прямоугольника 4,00 × 3,00 м.'});}
function focusCutFieldV24(corner,kind){selectedCornerV24=corner;refreshShapeUiV24();openSheetV5('shapeSheet');setTimeout(()=>{const el=$(kind==='width'?'cornerCutWidthV24':'cornerCutDepthV24');el?.focus();el?.select();},100);}

function cutPositionsV24(m,k){const{x,y,width:W,height:H}=m,c=m.cuts[k];if(k==='tl')return{inner:{x:x+c.width,y:y+c.depth},w:{x:x+c.width,y},d:{x,y:y+c.depth},wc:{x:x+c.width/2,y:y+Math.min(c.depth*.42,260)},dc:{x:x+Math.min(c.width*.42,300),y:y+c.depth/2}};if(k==='tr')return{inner:{x:x+W-c.width,y:y+c.depth},w:{x:x+W-c.width,y},d:{x:x+W,y:y+c.depth},wc:{x:x+W-c.width/2,y:y+Math.min(c.depth*.42,260)},dc:{x:x+W-Math.min(c.width*.42,300),y:y+c.depth/2}};if(k==='br')return{inner:{x:x+W-c.width,y:y+H-c.depth},w:{x:x+W-c.width,y:y+H},d:{x:x+W,y:y+H-c.depth},wc:{x:x+W-c.width/2,y:y+H-Math.min(c.depth*.42,260)},dc:{x:x+W-Math.min(c.width*.42,300),y:y+H-c.depth/2}};return{inner:{x:x+c.width,y:y+H-c.depth},w:{x:x+c.width,y:y+H},d:{x,y:y+H-c.depth},wc:{x:x+c.width/2,y:y+H-Math.min(c.depth*.42,260)},dc:{x:x+Math.min(c.width*.42,300),y:y+H-c.depth/2}};}
function cutChipV24(corner,kind,p,value,sc){const w=74/sc,h=24/sc;return `<g class="v24-cut-dim" data-v24-dim="${corner}:${kind}"><rect data-v24-dim="${corner}:${kind}" x="${p.x-w/2}" y="${p.y-h/2}" width="${w}" height="${h}" rx="${12/sc}"/><text data-v24-dim="${corner}:${kind}" x="${p.x}" y="${p.y+4/sc}" text-anchor="middle" font-size="${10/sc}">${fmtM(value)} м ✎</text></g>`;}
function wallRemainChipV241(edge,p,value,sc){const w=76/sc,h=24/sc;return `<g class="v241-wall-remain" data-v241-wall="${edge}"><rect x="${p.x-w/2}" y="${p.y-h/2}" width="${w}" height="${h}" rx="${12/sc}"/><text x="${p.x}" y="${p.y+4/sc}" text-anchor="middle" font-size="${10/sc}">${fmtM(value)} м</text></g>`;}
function wallRemaindersV241(m,sc){
  const {x,y,width:W,height:H,cuts:c}=m;let out='';
  const topLeft=c.tl.active?c.tl.width:0,topRight=c.tr.active?c.tr.width:0;
  if(topLeft||topRight){const rem=W-topLeft-topRight;if(rem>0){const sx=x+topLeft,ex=x+W-topRight;out+=wallRemainChipV241('top',{x:(sx+ex)/2,y:y+145},rem,sc);}}
  const bottomLeft=c.bl.active?c.bl.width:0,bottomRight=c.br.active?c.br.width:0;
  if(bottomLeft||bottomRight){const rem=W-bottomLeft-bottomRight;if(rem>0){const sx=x+bottomLeft,ex=x+W-bottomRight;out+=wallRemainChipV241('bottom',{x:(sx+ex)/2,y:y+H-145},rem,sc);}}
  return out;
}
function shapeOverlayV24(){
  const m=modelFromStateV24();if(!m||state.mode!=='shape6')return'';const sc=state.scale||.1;let out='<g class="shape-v24-overlay">';
  for(const k of Shape.CORNERS){const c=m.cuts[k];if(!c.active)continue;const p=cutPositionsV24(m,k),r=11/sc,hit=28/sc;
    out+=`<line class="v24-cut-guide" x1="${p.w.x}" y1="${p.w.y}" x2="${p.inner.x}" y2="${p.inner.y}"/><line class="v24-cut-guide" x1="${p.d.x}" y1="${p.d.y}" x2="${p.inner.x}" y2="${p.inner.y}"/>`;
    out+=cutChipV24(k,'width',p.wc,c.width,sc)+cutChipV24(k,'depth',p.dc,c.depth,sc);
    out+=`<circle class="v24-cut-handle-hit" data-v24-handle="${k}:width" cx="${p.w.x}" cy="${p.w.y}" r="${hit}"/><circle class="v24-cut-handle" cx="${p.w.x}" cy="${p.w.y}" r="${r}"/>`;
    out+=`<circle class="v24-cut-handle-hit" data-v24-handle="${k}:depth" cx="${p.d.x}" cy="${p.d.y}" r="${hit}"/><circle class="v24-cut-handle" cx="${p.d.x}" cy="${p.d.y}" r="${r}"/>`;
  }
  out+=wallRemaindersV241(m,sc);
  return out+'</g>';
}
function scheduleDragV24(){if(dragFrameV24)return;dragFrameV24=requestAnimationFrame(()=>{dragFrameV24=0;renderPlan();});}
function updateDragV24(p){
  const m=modelFromStateV24();if(!m||!dragV24.active)return;const n=cloneV24(m),c=n.cuts[dragV24.corner],snap=v=>Math.round(v/10)*10;
  if(dragV24.kind==='width'){if(dragV24.corner==='tl'||dragV24.corner==='bl')c.width=snap(p.x-n.x);else c.width=snap(n.x+n.width-p.x);c.width=clamp(c.width,100,maxCutWidthV24(n,dragV24.corner));}
  else{if(dragV24.corner==='tl'||dragV24.corner==='tr')c.depth=snap(p.y-n.y);else c.depth=snap(n.y+n.height-p.y);c.depth=clamp(c.depth,100,maxCutDepthV24(n,dragV24.corner));}
  const built=sectionsFromModelV24(n);if(!built.ok)return;state.shapeParams=paramsFromModelV24(n);state.shapeType='custom';state.shapeAxes=null;state.sections=built.sections;resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();refreshShapeUiV24();scheduleDragV24();
}

const baseRenderV24=renderPlan;
renderPlan=function renderPlanV24(){
  baseRenderV24();const m=modelFromStateV24();if(!m||!planSvg)return;
  planSvg.querySelectorAll('circle[data-v6-room-handle],circle[data-v6-section-id],.edit-handle.room').forEach(n=>n.remove());
  const ov=shapeOverlayV24();if(ov)planSvg.insertAdjacentHTML('beforeend',ov);
};

planSvg?.addEventListener('pointerdown',e=>{
  const dim=e.target?.closest?.('[data-v24-dim]')?.dataset?.v24Dim;if(dim){e.preventDefault();e.stopImmediatePropagation();const[corner,kind]=dim.split(':');focusCutFieldV24(corner,kind);return;}
  const legacyDim=e.target?.closest?.('[data-v6-dim]')?.dataset?.v6Dim;if(modelFromStateV24()&&(legacyDim==='width'||legacyDim==='height')){e.preventDefault();e.stopImmediatePropagation();openSheetV5('shapeSheet');setTimeout(()=>{const el=$(legacyDim==='width'?'shapeWidthInput':'shapeHeightInput');el?.focus();el?.select();},80);return;}
  const h=e.target?.closest?.('[data-v24-handle]')?.dataset?.v24Handle;if(h&&modelFromStateV24()&&state.mode==='shape6'){e.preventDefault();e.stopImmediatePropagation();const[corner,kind]=h.split(':');selectedCornerV24=corner;pushHistoryV5();updateUndoStateV24();resetRoute();dragV24={active:true,pointerId:e.pointerId,corner,kind};try{planSvg.setPointerCapture(e.pointerId)}catch{};refreshShapeUiV24();return;}
},true);
planSvg?.addEventListener('pointermove',e=>{if(!dragV24.active||e.pointerId!==dragV24.pointerId)return;e.preventDefault();e.stopImmediatePropagation();const p=svgPointFromEvent(e);if(p)updateDragV24(p);},true);
function finishDragV24(e){if(!dragV24.active||e.pointerId!==dragV24.pointerId)return;e.preventDefault();e.stopImmediatePropagation();try{planSvg.releasePointerCapture(e.pointerId)}catch{};dragV24={active:false,pointerId:null,corner:null,kind:null};recomputeGeometry();syncExcludedFromObstaclesV6();fitPlan(false);refreshShapeUiV24();renderPlan();setStatus('Размер выреза обновлён.');}
planSvg?.addEventListener('pointerup',finishDragV24,true);planSvg?.addEventListener('pointercancel',finishDragV24,true);

function bindUiV24(){
  // Replace controls that already had legacy listeners attached by app-v120.js.
  const legacyReset=$('resetShapeBtn');if(legacyReset){const clean=legacyReset.cloneNode(true);legacyReset.replaceWith(clean);}
  $('closeShapeV24')?.addEventListener('click',()=>{if(modelFromStateV24())applySheetV24({history:false});closeSheetV5();});
  $('doneShapeV24')?.addEventListener('click',()=>{if(modelFromStateV24())applySheetV24({history:true,close:true});else closeSheetV5();});
  $('rotateShapeV24')?.addEventListener('click',rotateV24);$('resetShapeBtn')?.addEventListener('click',resetV24);$('toggleCornerCutV24')?.addEventListener('click',addOrRemoveCutV24);
  document.querySelectorAll('[data-v24-corner]').forEach(b=>b.addEventListener('click',()=>{selectedCornerV24=b.dataset.v24Corner;refreshShapeUiV24();}));
  for(const id of ['shapeWidthInput','shapeHeightInput','cornerCutWidthV24','cornerCutDepthV24'])$(id)?.addEventListener('change',()=>applySheetV24({history:true}));
  const oldRotate=$('rotateBtn');if(oldRotate){const n=oldRotate.cloneNode(true);oldRotate.replaceWith(n);n.addEventListener('click',()=>modelFromStateV24()?rotateV24():rotatePlanV6());}
}
bindUiV24();

const prevSyncShapeV24=syncShapeUiV5;syncShapeUiV5=function syncShapeUiV24(){prevSyncShapeV24?.();refreshShapeUiV24();};
const prevNewV24=newScheme;newScheme=function newSchemeV24(){prevNewV24();const b=state.bounds?.width>10?state.bounds:{minX:0,minY:0,width:4000,height:3000};applyModelV24(Shape.defaultModel(b.width,b.height,b.minX||0,b.minY||0),{reset:false,render:false});refreshShapeUiV24();};
const prevLoadV24=loadScheme;loadScheme=function loadSchemeV24(raw){prevLoadV24(raw);adoptCurrentShapeV24(raw);refreshShapeUiV24();requestAnimationFrame(()=>renderPlan());};
const prevSerializeV24=serializeState;serializeState=function serializeStateV24(){const r=prevSerializeV24();r.versionLabel='2.4.1';r.shapeParams=cloneV24(state.shapeParams||{});return r;};

// Keep the V2.3 local-spiral capability for migrated L rooms and symmetric T-like
// corner-cut rooms whenever the resulting geometry is still two clean rectangles.
if(typeof v23PresetComplexSpiralPossible==='function'){const prevComplexSpiralPossibleV24=v23PresetComplexSpiralPossible;v23PresetComplexSpiralPossible=function v24ComplexSpiralPossible(){const m=modelFromStateV24();if(m&&Shape.activeCount(m)>0&&state.sections?.length===2&&!state.obstacles?.length)return true;return prevComplexSpiralPossibleV24();};}

// If the current in-memory project came from an older preset during a hot update, migrate it too.
if(state.id||state.sections?.length)adoptCurrentShapeV24(null);
refreshShapeUiV24();
document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V2.4.1 · размеры стен'));
})();
