/* Plan-first editor. Legacy screens remain available outside manual editing. */
(()=>{
'use strict';
const E=WarmEngine,C=WarmEditorCore,workspace=document.querySelector('#editorView .workspace'),panel=$('editInspector');
const DRAFT_KEY='warm-editor-draft-v280',copy=C.copy,esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseRender=renderPlan,baseSerialize=serializeState,baseLoad=loadScheme,baseNew=newScheme,baseZoom=zoomBy;
let active=false,plan=null,baseline=null,locks=[],selection=null,hits=[],hitIndex=0,tool='select',returnTool='select',range=null,cutPick=null,gap=null,preview=null,drawPoints=[],pointPick=null,pointSpan=null,liveLine=null,compare=false,expanded=false,issues=[],validation=null;
let undo=[],redo=[],view=null,gesture=null,pointers=new Map(),persistTimer=null,frame=null,lastSize='',routing=null,cutBefore=null;
const magnifier=document.createElement('div');magnifier.className='edit-magnifier';magnifier.hidden=true;workspace.append(magnifier);
const resume=document.createElement('button');resume.className='secondary-btn edit-resume';resume.textContent='Продолжить черновик';resume.hidden=true;$('homeView').querySelector('.hero').append(resume);
const btn=(id,text,extra='')=>`<button type="button" id="${id}" ${extra}>${text}</button>`;
const field=(id,label,value,extra='')=>`<label>${label}<input id="${id}" type="number" inputmode="decimal" value="${Math.round(value*100)/100}" ${extra}></label>`;
function params(){return WarmV260.input();}
function pack(){return{plan:copy(plan),baseline:copy(baseline),locks:copy(locks),view:copy(view),scratch:{editorVersion:'2.8',tool:tool==='more'?returnTool:tool,range:copy(range),cutPick:copy(cutPick),gap:copy(gap),drawPoints:copy(drawPoints)}};}
function restoreScratch(s){tool=s?.tool||'select';range=copy(s?.range||null);cutPick=copy(s?.cutPick||null);gap=copy(s?.gap||null);drawPoints=copy(s?.drawPoints||[]);preview=null;pointPick=null;pointSpan=null;liveLine=null;if(s?.editorVersion!=='2.8'&&gap){const r=plan?.circuits?.[gap.circuit]?.route;drawPoints=r?[copy(r[gap.start])]:[];}}
function snapshot(){return{draft:pack(),geometry:{sections:copy(state.sections),obstacles:copy(state.obstacles||[]),supply:copy(state.supply),returnPoint:copy(state.returnPoint),shapeType:state.shapeType,shapeParams:copy(state.shapeParams),shapeAxes:copy(state.shapeAxes),roomAdded:[...state.roomAdded],roomRemoved:[...state.roomRemoved],excluded:[...state.excluded]}};}
function restore(s){cancelRouting();cutBefore=null;plan=copy(s.draft.plan);baseline=copy(s.draft.baseline);locks=copy(s.draft.locks);const g=copy(s.geometry);for(const k of ['roomAdded','roomRemoved','excluded'])g[k]=new Set(g[k]);Object.assign(state,g);syncCollectors();recomputeGeometry();syncInputs();syncShapeUiV5();selection=null;restoreScratch(s.draft.scratch);check();render();scheduleSave();}
function remember(before=snapshot()){undo.push(before);if(undo.length>60)undo.shift();redo=[];}
function history(back){const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;to.push(snapshot());restore(from.pop());}
function check(){validation=C.inspect(params(),plan);issues=validation.issues;plan.ok=validation.ok;plan.hard={ok:validation.ok,checks:copy(validation.checks)};state.manualV2.circuits=copy(plan.circuits);state.manualV2.validation={level:validation.ok?'ok':'bad',hard:issues.length};return validation;}
function commit(next,before=snapshot()){cancelRouting();before.draft.scratch=null;remember(before);plan=next;preview=null;check();render();scheduleSave();}
function scheduleSave(){clearTimeout(persistTimer);if(active)$('gridInfo').textContent='Сохраняю…';persistTimer=setTimeout(autosave,250);}
function autosave(){
 clearTimeout(persistTimer);if(!plan)return false;if(gesture){scheduleSave();return false;}
 state.editorDraft=pack();
 try{const raw=serializeState();localStorage.setItem(DRAFT_KEY,JSON.stringify({raw,undo:undo.slice(-20),redo:redo.slice(-20),time:Date.now(),pending:active||!validation?.ok}));resume.hidden=false;if(active)$('gridInfo').textContent='Черновик сохранён';return true;}
 catch{setStatus('Черновик не сохранился: память устройства заполнена.',true);return false;}
}
function syncCollectors(){state.collectorCountV23=1;state.collectorsV23=state.supply&&state.returnPoint?[{supply:copy(state.supply),returnPoint:copy(state.returnPoint),label:'К1'}]:[];}
function enter(){
 if(active)return;if(state.engineBusyV1)resetRoute();closeSheetV5();
 const saved=state.editorDraft;
 plan=copy(saved?.plan||state.enginePlanV1||{version:'2.8.0',planner:'unified-bcd',kind:'manual',circuits:[]});
 if(!saved&&state.manualV2?.loaded&&state.manualV2.dirty&&state.manualV2.circuits?.length){const old=state.manualV2;plan.circuits=old.circuits.map(c=>({...copy(plan.circuits.find(x=>x.id===c.id)||{}),...copy(c),bendRadiusMm:requestedBendRadiusV10()}));}
 if(!plan.circuits.length&&state.route?.length)plan.circuits=[{id:1,route:copy(state.route),supply:copy(state.supply),returnPoint:copy(state.returnPoint),bendRadiusMm:requestedBendRadiusV10()}];
 baseline=copy(saved?.baseline||plan);locks=copy(saved?.locks||[]);selection=null;hits=[];range=null;cutPick=null;gap=null;cutBefore=null;preview=null;drawPoints=[];pointPick=null;pointSpan=null;liveLine=null;undo=[];redo=[];tool='select';expanded=false;compare=false;
 active=true;state.manualV2=blankManualStateV2A();state.manualV2.active=true;state.mode='manualV2';document.body.classList.add('mobile-editor-active','manual-v2-active');
 $('editActions').hidden=false;$('editDock').hidden=false;panel.hidden=false;view=saved?.view?copy(saved.view):null;
 restoreScratch(saved?.scratch);check();renderPanel();if(!view)fit();else render();scheduleSave();
 $('schemeTitle').textContent=state.name||'Правка плана';$('gridInfo').textContent='Изменения сохраняются';
 modeHint.textContent='Правка 2.8: рисуйте прямые отрезки, ставьте точки и двигайте участки. Два пальца — масштаб.';modeHint.classList.add('visible');
}
function deactivate(){cancelRouting();active=false;gesture=null;pointers.clear();magnifier.hidden=true;state.manualV2=blankManualStateV2A();state.mode='inspect';document.body.classList.remove('mobile-editor-active','manual-v2-active');$('editActions').hidden=true;$('editDock').hidden=true;panel.hidden=true;planSvg.classList.remove('manual-v2-mode');planSvg.style.removeProperty('width');planSvg.style.removeProperty('height');}
function leave(draft=false){
 if(!active)return true;
 if(!draft&&(preview||gap||drawPoints.length)){setStatus('Примените новый участок или отмените вырез перед завершением.',true);return false;}
 if(!draft&&!check().ok){render();setStatus(issues[0]?.message||'Завершите контур или сохраните черновик.',true);return false;}
 if(!draft){plan.ok=true;plan.planner='unified-bcd';plan.circuits.forEach(c=>{c.length=E.length(c.route);c.bendRadiusMm=requestedBendRadiusV10();});plan.totalLength=plan.circuits.reduce((s,c)=>s+c.length,0);plan.quality=E.quality(params(),plan);state.enginePlanV1=copy(plan);state.route=[];state.routeComplete=true;state.routeCandidates=[];state.v260Engineering={proven:true,hardOK:true,hard:validation};}
 else{state.enginePlanV1=null;state.route=[];state.routeComplete=false;}
 if(!autosave())return false;
 try{saveScheme();}catch{setStatus('Не удалось сохранить схему на устройстве.',true);return false;}
 deactivate();if(!draft){try{const saved=JSON.parse(localStorage.getItem(DRAFT_KEY));saved.pending=false;localStorage.setItem(DRAFT_KEY,JSON.stringify(saved));resume.hidden=true;}catch{}}
 baseRender();fitPlan();setStatus(draft?'Черновик сохранён. Продолжите через «Правка».':'Схема проверена и сохранена.');return true;
}
function fit(){const b=state.bounds||{};const w=workspace.clientWidth,h=workspace.clientHeight;if(w<1||h<1)return;const scale=Math.max(.001,Math.min((w-64)/Math.max(1,b.width),(h-64)/Math.max(1,b.height)));view={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,scale};render();}
function point(e){const r=workspace.getBoundingClientRect();return{x:view.x+(e.clientX-r.left-r.width/2)/view.scale,y:view.y+(e.clientY-r.top-r.height/2)/view.scale};}
function zoom(factor,at){if(!view)return;const p=at?point(at):{x:view.x,y:view.y},old=view.scale;view.scale=Math.max(.002,Math.min(1.5,view.scale*factor));view.x=p.x-(p.x-view.x)*old/view.scale;view.y=p.y-(p.y-view.y)*old/view.scale;renderCanvas();}
function pathD(r){return r.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');}
function line(a,b,stroke,width=2,extra=''){return`<path d="M${a.x} ${a.y}L${b.x} ${b.y}" fill="none" stroke="${stroke}" stroke-width="${width}" vector-effect="non-scaling-stroke" ${extra}/>`;}
function dot(p,label,color='#1d4ed8'){const r=12/view.scale;return`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="white" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${p.x}" y="${p.y+4/view.scale}" text-anchor="middle" fill="white" font-size="${12/view.scale}" font-family="system-ui">${label}</text>`;}
function centerCollector(){return state.supply&&state.returnPoint?{x:(state.supply.x+state.returnPoint.x)/2,y:(state.supply.y+state.returnPoint.y)/2}:null;}
function renderCanvas(){
 if(!active||!view)return;
 const w=workspace.clientWidth,h=workspace.clientHeight;if(!w||!h)return;
 const vb=[view.x-w/view.scale/2,view.y-h/view.scale/2,w/view.scale,h/view.scale];planSvg.setAttribute('viewBox',vb.join(' '));planSvg.setAttribute('width',w);planSvg.setAttribute('height',h);state.scale=view.scale;
 const current=preview?.plan||plan,detail=view.scale*(Number(state.pipeStepMm)||150)>22,s=view.scale;
 let html=`<defs><pattern id="editGrid" width="${Math.max(100,Math.ceil(12/s/100)*100)}" height="${Math.max(100,Math.ceil(12/s/100)*100)}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="${.65/s}" fill="#cbd5e1"/></pattern></defs>`;
 const room=[...params().sections];for(const r of room)html+=`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="#fff"/><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="url(#editGrid)"/>`;
 const walls=C.boundaries(room);walls.forEach(([a,b],i)=>{html+=line(a,b,selection?.type==='wall'&&selection.index===i?'#2563eb':'#475569',selection?.type==='wall'&&selection.index===i?4:2);if(detail||selection?.type==='wall'&&selection.index===i){const p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};html+=`<text x="${p.x}" y="${p.y-9/s}" text-anchor="middle" font-size="${12/s}" fill="#475569" stroke="white" stroke-width="${3/s}" paint-order="stroke" font-family="system-ui">${Math.round(C.dist(a,b))} мм</text>`;}});
 for(const o of params().obstacles)html+=`<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
 if(compare)for(const c of baseline.circuits){html+=`<path class="edit-pipe" d="${pathD(c.route)}" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 5" opacity=".7"/>`;}
 current.circuits.forEach((c,ci)=>{
  const dim=selection?.type==='pipe',isGap=!!(gap&&!preview&&ci===gap.circuit);
  html+=`<g opacity="${dim ? .25 : 1}" data-edit-circuit="${ci}">`;
  if(isGap){
   const left=c.route.slice(0,gap.start+1),right=c.route.slice(gap.end);
   if(left.length>1)html+=`<path class="edit-pipe" d="${pathD(left)}" stroke="#e64d48" stroke-width="2.4"/>`;
   if(right.length>1)html+=`<path class="edit-pipe" d="${pathD(right)}" stroke="#2874d4" stroke-width="2.4"/>`;
   if(detail&&state.showFastenersV21!==false)for(const chunk of [left,right])for(const [a,b] of E.segments(chunk)){const len=C.dist(a,b);for(let d=250;d<len;d+=Number(state.fastenerStepMm)||500)html+=`<circle class="edit-detail" cx="${a.x+(b.x-a.x)*d/len}" cy="${a.y+(b.y-a.y)*d/len}" r="${1.7/s}" fill="#334155"/>`;}
  }else{
   const curve=E.rounded(c.route,c.bendRadiusMm||requestedBendRadiusV10());
   html+=`<path class="edit-pipe" d="${curve?.hotSvg||pathD(c.route)}" stroke="#e64d48" stroke-width="2.4"/><path class="edit-pipe" d="${curve?.coldSvg||''}" stroke="#2874d4" stroke-width="2.4"/>`;
   if(detail&&state.showFastenersV21!==false)for(const [a,b] of E.segments(c.route)){const len=C.dist(a,b);for(let d=250;d<len;d+=Number(state.fastenerStepMm)||500)html+=`<circle class="edit-detail" cx="${a.x+(b.x-a.x)*d/len}" cy="${a.y+(b.y-a.y)*d/len}" r="${1.7/s}" fill="#334155"/>`;}
  }
  html+='</g>';
 });
 for(const lock of locks){const c=current.circuits.find(c=>c.id===lock.circuit);const edge=c&&E.segments(c.route).find(([a,b])=>C.edgeKey(a,b)===lock.edge);if(edge)html+=line(...edge,'#64748b',5,'stroke-dasharray="2 6"');}
 for(const issue of preview?.validation?.issues||issues){const r=current.circuits[issue.circuit]?.route;if(!r)continue;for(const i of issue.segments)if(r[i+1])html+=line(r[i],r[i+1],'#b91c1c',6,'opacity=".42"');}
 if(selection?.type==='pipe'){
  const r=current.circuits[selection.circuit]?.route,a=r?.[selection.seg],b=r?.[selection.seg+1];
  if(a&&b){html+=line(a,b,'#153eaf',6);const p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};html+=`<circle cx="${p.x}" cy="${p.y}" r="${22/s}" fill="transparent" data-edit-handle="pipe"/>${dot(p,'↕')}`;}
 }
 if(cutPick&&!gap)html+=dot(cutPick.at,'А','#16a34a');
 if(range){const r=plan.circuits[range.circuit]?.route;if(r){html+=dot(r[range.start],'А','#16a34a');if(range.end!=null)html+=dot(r[range.end],'Б','#7c3aed');}}
 if(drawPoints.length&&!preview)html+=`<path class="edit-pipe edit-line-draft" d="${pathD(drawPoints)}" stroke="#7c3aed" stroke-width="4" opacity=".9"/>`;
 if(liveLine)html+=line(liveLine.a,liveLine.b,liveLine.ok===false?'#b91c1c':'#7c3aed',4,'stroke-dasharray="8 6" opacity=".9"');
 if(preview?.path)html+=`<path class="edit-pipe" d="${pathD(preview.path)}" stroke="${preview.validation.ok?'#059669':'#b91c1c'}" stroke-width="5" stroke-dasharray="8 6"/>`;
 if(pointPick&&!pointSpan)html+=dot(pointPick.at,'1','#f59e0b');
 if(pointSpan){html+=line(pointSpan.a,pointSpan.b,'#7c3aed',7,'opacity=".75"');html+=dot(pointSpan.a,'1','#7c3aed')+dot(pointSpan.b,'2','#7c3aed');}
 if(preview?.kind==='reconnect')preview.plan.circuits.forEach((c,ci)=>{const old=new Set(E.segments(plan.circuits[ci].route).map(e=>C.edgeKey(...e)));for(const edge of E.segments(c.route))if(!old.has(C.edgeKey(...edge)))html+=line(...edge,'#059669',5,'stroke-dasharray="8 6"');});
 const issue=(preview?.validation?.issues||issues)[0],badRoute=current.circuits[issue?.circuit]?.route,segment=issue?.segments[0];
 if(badRoute?.[segment+1]&&!gesture){const a=badRoute[segment],b=badRoute[segment+1],p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};html+=`<circle cx="${p.x}" cy="${p.y}" r="${7/s}" fill="#b91c1c"/><text x="${p.x}" y="${p.y-13/s}" text-anchor="middle" font-family="system-ui" font-size="${12/s}" fill="#991b1b" stroke="white" stroke-width="${4/s}" paint-order="stroke">${esc(issue.message)}</text>`;}
 const col=centerCollector();if(col){html+=`<g data-edit-collector="true"><rect x="${col.x-25/s}" y="${col.y-13/s}" width="${50/s}" height="${26/s}" rx="${7/s}" fill="#fff" stroke="${selection?.type==='collector'?'#2563eb':'#334155'}" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${col.x}" y="${col.y+4/s}" text-anchor="middle" font-size="${12/s}" fill="#334155" font-family="system-ui">К1</text></g>`;}
 planSvg.innerHTML=html;
}
function wallDistance(sel=selection){
 const r=plan.circuits[sel.circuit].route,a=r[sel.seg],b=r[sel.seg+1],horizontal=Math.abs(a.y-b.y)<1e-6,vertical=Math.abs(a.x-b.x)<1e-6,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
 if(!horizontal&&!vertical)return null;let best=null;for(const [u,v] of C.boundaries(params().sections)){
  if(horizontal!==(u.y===v.y))continue;
  const along=horizontal?'x':'y',axis=horizontal?'y':'x';if(mid[along]<Math.min(u[along],v[along])||mid[along]>Math.max(u[along],v[along]))continue;
  const d=Math.abs(mid[axis]-u[axis]);if(!best||d<best.distance)best={distance:d,coordinate:u[axis],axis,sign:Math.sign(mid[axis]-u[axis])||1};
 }return best;
}
function renderPanel(){
 if(!active)return;
 $('editUndo').disabled=!undo.length;$('editRedo').disabled=!redo.length;
 document.querySelectorAll('[data-edit-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.editTool===tool)));
 let html='';
 if(tool==='more'){
  html=`<div class="edit-context-head"><strong>Ещё</strong>${btn('editCloseMore','×','aria-label="Закрыть меню"')}</div><div class="edit-row">${btn('editLock',isLocked()?'Открепить':'Закрепить',selection?.type==='pipe'?'':'disabled')}${btn('editCompare',compare?'Скрыть сравнение':'Сравнить')}${btn('editFit','Весь план')}</div><div class="edit-row">${btn('editAutoBypass','Автообход')}${btn('editSaveDraft','Сохранить черновик')}${btn('editCheck','Проверить')}</div>`;
 }else if(preview){html=`<strong>${preview.kind==='reconnect'?'Подключение коллектора':'Линии А → Б готовы'}</strong><p class="${preview.validation.ok?'':'edit-error'}">${preview.validation.ok?'Маршрут собран из заданных вами прямых. Повороты построены с минимальным допустимым радиусом.':esc(preview.validation.issues[0]?.message||'Требуется правка')}</p><div class="edit-row">${btn('editApply','Применить',`class="edit-primary" ${preview.validation.ok?'':'disabled'}`)}${gap?btn('editResetDraw','Начать заново'):''}${btn('editCancelRange','Отмена')}</div>`;
 }else if(tool==='erase'){
  html=`<strong>${cutPick?'Теперь коснитесь конца Б':'Ластик: коснитесь начала А'}</strong><p>${cutPick?'Выберите вторую точку на этом же контуре. Участок между А и Б будет заменён вручную.':'Можно выбрать точку прямо посередине прямого участка — не только на повороте.'}</p><div class="edit-row">${btn('editCancelRange','Отмена')}</div>`;
 }else if(tool==='draw'&&gap){
  const started=drawPoints.length>1;
  html=`<strong>Линия А → Б</strong><p>Зажмите конец фиолетовой линии, протяните один прямой отрезок и отпустите. Повторяйте. Подведите конец к Б — он защёлкнется.</p><div class="edit-row">${started?btn('editUndoLine','Удалить последний отрезок'):''}${started?btn('editResetDraw','Сначала'):''}${btn('editCancelRange','Отмена')}</div>`;
 }else if(tool==='draw'){
  if(!plan.circuits.length)html=`<strong>Новый контур линиями</strong><p>${state.supply?'Зажмите активный конец трубы, протяните прямую и отпустите.':'Сначала укажите коллектор через основной экран.'}</p><div class="edit-row">${btn('editFinishNew','Соединить с обраткой',!drawPoints.length?'disabled':'')}${btn('editCancelRange','Отмена')}</div>`;
  else html=`<strong>Линия</strong><p>Чтобы перерисовать часть существующего контура, сначала вырежьте её ластиком.</p><div class="edit-row">${btn('editUseEraser','Открыть ластик','class="edit-primary"')}${btn('editCancelRange','Отмена')}</div>`;
 }else if(tool==='points'){
  if(pointSpan)html=`<strong>Выделен отрезок между точками 1–2</strong><p>Потяните выделенную часть перпендикулярно в сторону. Warm сам ограничит движение стенами, препятствиями и минимальным радиусом.</p><div class="edit-row">${btn('editClearPoints','Сбросить точки')}${btn('editCancelRange','Готово')}</div>`;
  else if(pointPick)html=`<strong>Точка 1 поставлена</strong><p>Коснитесь второй точки на этой же прямой — получите участок для смещения. Или зажмите трубу слева/справа от точки и потяните: изменится ближайший поворот с выбранной стороны.</p><div class="edit-row">${btn('editClearPoints','Убрать точку')}${btn('editCancelRange','Готово')}</div>`;
  else html=`<strong>Точки поворота</strong><p>Одна точка помогает сдвинуть ближайший поворот. Две точки на одной прямой выделяют участок, который можно оттянуть перпендикулярно.</p><div class="edit-row">${btn('editCancelRange','Готово')}</div>`;
 }else if(tool==='rebuild'){
  const instruction=!range?'Коснитесь начала участка А':range.end==null?'Коснитесь конца Б на том же контуре':'Выбран участок А → Б';
  html=`<strong>${instruction}</strong><p>Точки привязываются к ближайшему повороту трубы.</p><div class="edit-row">${range?.end!=null?btn('editBypass','Обойти препятствие','class="edit-primary"'):''}${btn('editCancelRange','Отмена')}</div>`;
 }else if(selection?.type==='pipe'){
  const d=wallDistance(),c=plan.circuits[selection.circuit],locked=isLocked();
  html=`<div class="edit-context-head"><strong>Контур ${esc(c.id)} · ${d?'от стены '+Math.round(d.distance)+' мм':'участок трубы'}${locked?' · закреплён':''}</strong>${btn('editExpand',expanded?'⌄':'Точно',`aria-label="${expanded?'Свернуть':'Точный ввод'}" aria-expanded="${expanded}"`)}</div><div class="edit-row">${btn('editPrev','‹','class="edit-cycle" aria-label="Предыдущий проход" '+(hits.length<2?'disabled':''))}${btn('editMinus','−10 мм',locked?'disabled':'')}${btn('editPlus','+10 мм',locked?'disabled':'')}${btn('editNext','›','class="edit-cycle" aria-label="Следующий проход" '+(hits.length<2?'disabled':''))}</div>`;
  if(expanded)html+=`<div class="edit-fields">${field('editDistance',d?'От стены, мм':'Сдвиг, мм',d?.distance||0,'step="10"')}<label>Точное положение${btn('editSetDistance','Применить',locked?'disabled':'')}</label></div>`;
 }else if(selection?.type==='wall'){
  const edge=C.boundaries(params().sections)[selection.index];
  html=`<div class="edit-context-head"><strong>Стена · ${edge?Math.round(C.dist(...edge)):0} мм</strong>${btn('editExpand',expanded?'Свернуть':'Размер',`aria-expanded="${expanded}"`)}</div>`;
  if(expanded&&edge)html+=`<div class="edit-fields">${field('editWallLength','Длина, мм',C.dist(...edge),'min="100" max="30000"')}<label>Размер комнаты${btn('editSetWall','Применить')}</label></div>`;
 }else if(selection?.type==='obstacle'){
  const o=state.obstacles[selection.index],b=state.bounds;
  html=`<div class="edit-context-head"><strong>Препятствие · ${Math.round(o.width)} × ${Math.round(o.height)} мм</strong>${btn('editExpand',expanded?'Свернуть':'Размеры',`aria-expanded="${expanded}"`)}</div>`;
  if(expanded){const gaps=obstacleGaps(o);html+=`<div class="edit-fields">${field('editObstacleW','Ширина, мм',o.width,'min="50"')}${field('editObstacleH','Глубина, мм',o.height,'min="50"')}${field('editObstacleX','От левой стены, мм',gaps.left.distance,'min="0"')}${field('editObstacleY','От верхней стены, мм',gaps.top.distance,'min="0"')}</div><p>Справа ${Math.round(gaps.right.distance)} мм · снизу ${Math.round(gaps.bottom.distance)} мм</p><div class="edit-row">${btn('editSetObstacle','Применить','class="edit-primary"')}${btn('editDeleteObstacle','Удалить')}</div>`;}
 }else if(selection?.type==='collector'){
  html=`<div class="edit-context-head"><strong>Коллектор</strong>${btn('editExpand',expanded?'Свернуть':'Положение',`aria-expanded="${expanded}"`)}</div><p>Перетяните К1 на нужную стену.</p>${plan.circuits.length&&!validation?.checks.H5_continuity?`<div class="edit-row">${btn('editReconnect','Подключить трубы')}</div>`:''}`;
  if(expanded){const hit=nearestWall(centerCollector()),distance=C.dist(hit.edge[0],hit.at);html+=`<div class="edit-fields">${field('editCollectorOffset','От начала стены, мм',distance,'min="30"')}<label>Точное положение${btn('editSetCollector','Применить')}</label></div>`;}
 }else html=`<div class="edit-context-head"><strong>Выберите трубу, стену или препятствие</strong></div><p>${validation?.ok?'Схема прошла проверку':issues[0]?.message||'Перемещайте план одним пальцем'}</p>`;
 // Avoid destroying a focused numeric field during a viewport resize.
 panel.innerHTML=html;
 if(issues.length&&tool==='select'&&selection?.type==='pipe')panel.insertAdjacentHTML('beforeend',`<p class="edit-error">${esc(issues[0].message)}</p>`);
}
function render(){renderPanel();renderCanvas();}
function isLocked(){if(selection?.type!=='pipe')return false;const c=plan.circuits[selection.circuit],r=c.route;return locks.some(l=>l.circuit===c.id&&l.edge===C.edgeKey(r[selection.seg],r[selection.seg+1]));}
function move(delta){if(selection?.type!=='pipe')return;const result=C.moveSegment(plan,selection,delta,locks);if(!result.ok){setStatus(result.message,true);return;}commit(result.plan);}
function cycle(step){if(!hits.length)return;hitIndex=(hitIndex+step+hits.length)%hits.length;selection={type:'pipe',...hits[hitIndex]};render();}
function cancelRange(){cancelRouting();cutBefore=null;tool='select';range=null;cutPick=null;gap=null;preview=null;drawPoints=[];pointPick=null;pointSpan=null;liveLine=null;render();scheduleSave();}
function selectTool(next){
 cancelRouting();cancelGesture();liveLine=null;pointPick=null;pointSpan=null;
 if(next==='more'){if(tool==='more')tool=returnTool;else{returnTool=tool;tool='more';}render();scheduleSave();return;}
 if(gap&&next==='draw'){tool='draw';expanded=false;render();scheduleSave();return;}
 preview=null;drawPoints=[];range=null;cutPick=null;gap=null;cutBefore=null;tool=next;expanded=false;selection=null;
 if(next==='draw'&&!plan.circuits.length&&state.supply){try{const n=E.normalize(params()),ports=E.manifoldPorts(n,1,E.freeSpace(n));if(ports){drawPoints=[ports[0].supply,ports[0].innerSupply];}}catch{}}
 render();scheduleSave();
}
function setPreview(result,path,kind='local'){if(result.cancelled)return;if(!result.ok){setStatus(result.message,true);return;}preview={plan:result.plan,path,kind,validation:C.inspect(params(),result.plan)};render();scheduleSave();}
function cancelRouting(){routing?.cancel();routing=null;}
function search(operation,extra={}){
 cancelRouting();const data={operation,input:params(),plan:copy(plan),locks:copy(locks),range:copy(range),...copy(extra)},signature=JSON.stringify([data.input,data.plan,data.locks,data.range,data.guide||null]);
 return new Promise(resolve=>{const worker=new Worker('./editor-worker.js?v=280-cad1');let timer;const finish=result=>{clearTimeout(timer);worker.terminate();routing=null;resolve(active&&signature===JSON.stringify([params(),plan,locks,range,data.guide||null])?result:{cancelled:true});};routing={cancel:()=>finish({cancelled:true})};timer=setTimeout(()=>finish({ok:false,message:'Поиск занял слишком много времени. Проведите линию проще.'}),15000);worker.onmessage=e=>finish(e.data);worker.onerror=()=>finish({ok:false,message:'Не удалось построить участок.'});worker.postMessage(data);});
}
function appendDraw(p,snap=true){const last=drawPoints.at(-1);p=snap?{x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10}:copy(p);if(!last){drawPoints=[p];return;}if(Math.abs(p.x-last.x)>Math.abs(p.y-last.y))drawPoints.push({x:p.x,y:last.y},p);else drawPoints.push({x:last.x,y:p.y},p);drawPoints=E.clean(drawPoints);}
function lineContext(){
 const n=E.normalize(params()),space=E.freeSpace(n),clear=n.pipeDiameterMm*1.5+2,occupied=[];
 let r=null,a=null,b=null,pre=null,post=null;
 if(gap){r=plan.circuits[gap.circuit]?.route;a=r?.[gap.start];b=r?.[gap.end];pre=r?.[gap.start-1]||null;post=r?.[gap.end+1]||null;}
 plan.circuits.forEach((c,cj)=>E.segments(c.route).forEach(([u,v],i)=>{
  if(gap&&cj===gap.circuit&&i>=gap.start&&i<gap.end)return;
  let p=copy(u),q=copy(v);
  if(gap&&cj===gap.circuit&&i===gap.start-1){const d=C.dist(p,q);if(d<=clear)return;q={x:q.x+(p.x-q.x)*clear/d,y:q.y+(p.y-q.y)*clear/d};}
  if(gap&&cj===gap.circuit&&i===gap.end){const d=C.dist(p,q);if(d<=clear)return;p={x:p.x+(q.x-p.x)*clear/d,y:p.y+(q.y-p.y)*clear/d};}
  occupied.push([p,q]);
 }));
 const draft=E.segments(drawPoints);draft.forEach(([u,v],i)=>{let p=copy(u),q=copy(v);if(i===draft.length-1){const d=C.dist(p,q);if(d<=clear)return;q={x:q.x+(p.x-q.x)*clear/d,y:q.y+(p.y-q.y)*clear/d};}occupied.push([p,q]);});
 return{n,space,r,a,b,pre,post,occupied,clearance:n.pipeDiameterMm*1.5};
}
function clampFree(p,ctx,grid=10){
 let best=null;for(const r of ctx.space.rects){const pad=Math.min(2,Math.max(0,Math.min(r.width,r.height)/4)),q={x:Math.max(r.x+pad,Math.min(r.x+r.width-pad,p.x)),y:Math.max(r.y+pad,Math.min(r.y+r.height-pad,p.y))},d=C.dist(p,q);if(!best||d<best.d)best={p:q,d};}
 const q=best?best.p:copy(p);if(grid){q.x=Math.round(q.x/grid)*grid;q.y=Math.round(q.y/grid)*grid;}
 if(ctx.space.contains(q))return q;best=null;for(const r of ctx.space.rects){const x=Math.max(r.x+1,Math.min(r.x+r.width-1,q.x)),y=Math.max(r.y+1,Math.min(r.y+r.height-1,q.y)),d=Math.hypot(q.x-x,q.y-y);if(!best||d<best.d)best={p:{x,y},d};}return best?.p||q;
}
function segmentClear(a,b,ctx){return C.dist(a,b)<1||ctx.space.covers(a,b)&&!ctx.occupied.some(([u,v])=>E.segmentDistance(a,b,u,v)<ctx.clearance-1e-6);}
function safeEndpoint(a,b,ctx){
 if(segmentClear(a,b,ctx))return b;let lo=0,hi=1;for(let i=0;i<18;i++){const t=(lo+hi)/2,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(segmentClear(a,p,ctx))lo=t;else hi=t;}const t=Math.max(0,lo-.002),raw={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},q={x:Math.round(raw.x/10)*10,y:Math.round(raw.y/10)*10};return segmentClear(a,q,ctx)?q:raw;
}
function lineEndpoint(raw,ctx,start){
 if(ctx.b&&C.dist(raw,ctx.b)*view.scale<=48&&segmentClear(start,ctx.b,ctx))return{p:copy(ctx.b),snapped:true};
 const q=clampFree(raw,ctx,10),safe=safeEndpoint(start,q,ctx);return{p:safe,snapped:false};
}
function partialLineOK(path,ctx,closing=false){
 const check=[...(ctx.pre?[ctx.pre]:[]),...path,...(closing&&ctx.post?[ctx.post]:[])];
 if(!E.bendsOK(E.clean(check),ctx.n.minBendRadiusMm))return{ok:false,message:`Для поворота нужно больше места: Rmin ${Math.ceil(ctx.n.minBendRadiusMm)} мм`};
 const ss=E.segments(path);for(let i=0;i<ss.length;i++)for(let j=0;j<i-1;j++)if(E.intersect(...ss[i],...ss[j]))return{ok:false,message:'Новая линия пересекает уже нарисованный участок'};
 return{ok:true};
}
function finishLineSegment(g,tip){
 const start=g.startPoint,hit=lineEndpoint(tip,g.drawCtx,start),q=hit.p;if(C.dist(start,q)<5){setStatus('Протяните линию дальше.');return false;}
 const path=E.clean([...drawPoints,q]),test=partialLineOK(path,g.drawCtx,hit.snapped);if(!test.ok){setStatus(test.message,true);return false;}
 if(hit.snapped&&gap){const result=C.replace(plan,gap.circuit,gap.start,gap.end,path,locks);if(!result.ok){setStatus(result.message,true);return false;}const inspected=C.inspect(params(),result.plan);if(!inspected.ok){setStatus(inspected.issues[0]?.message||'Этот последний отрезок не помещается.',true);return false;}remember(g.before);drawPoints=path;preview={plan:result.plan,path:copy(path),kind:'line',validation:inspected};liveLine=null;render();scheduleSave();setStatus('Соединено с Б. Проверьте и нажмите «Применить».');return true;}
 remember(g.before);drawPoints=path;liveLine=null;render();scheduleSave();setStatus('Отрезок добавлен. Тяните следующий от его конца.');return true;
}
function pointTap(p){
 const found=C.nearest(plan,p,28/view.scale)[0];if(!found){pointPick=null;pointSpan=null;setStatus('Коснитесь прямого участка трубы.');render();return;}
 if(!pointPick){pointPick={circuit:found.circuit,seg:found.seg,at:copy(found.at)};pointSpan=null;selection=null;render();setStatus('Точка 1. Теперь поставьте точку 2 на этой же прямой или потяните вдоль трубы в сторону нужного поворота.');return;}
 if(found.circuit!==pointPick.circuit||found.seg!==pointPick.seg){setStatus('Для смещения участка поставьте вторую точку на той же прямой.',true);return;}
 const result=C.prepareSpan(params(),plan,pointPick.circuit,pointPick,found,locks);if(!result.ok){setStatus(result.message,true);return;}
 pointSpan={circuit:result.circuit,start:result.start,end:result.end,a:copy(result.a),b:copy(result.b),basePlan:copy(result.plan)};pointPick=null;selection=null;render();setStatus('Участок 1–2 выбран. Потяните его перпендикулярно в сторону.');
}
function spanHandleAt(p){if(!pointSpan)return false;const at=C.projection(p,pointSpan.a,pointSpan.b);return C.dist(p,at)*view.scale<=30;}
function eraseTap(p){
 const found=C.nearest(plan,p,28/view.scale).find(h=>!cutPick||h.circuit===cutPick.circuit);if(!found){setStatus(cutPick?'Коснитесь этой же трубы.':'Коснитесь трубы в месте начала выреза.');return;}
 if(!cutPick){cutBefore=snapshot();cutPick={circuit:found.circuit,seg:found.seg,at:copy(found.at)};selection=null;render();scheduleSave();return;}
 const before=cutBefore||snapshot(),result=C.prepareCut(plan,cutPick.circuit,cutPick,found,locks);if(!result.ok){setStatus(result.message,true);return;}
 plan=result.plan;range={circuit:result.circuit,start:result.start,end:result.end};gap=copy(range);cutPick=null;cutBefore=null;drawPoints=[copy(result.a)];preview=null;tool='draw';selection=null;remember(before);check();render();scheduleSave();setStatus('Участок вырезан. Рисуйте новый путь прямыми отрезками от А к Б.');
}
function rangeTap(p){
 if(!plan.circuits.length){if(tool==='draw'&&drawPoints.length){remember();appendDraw(p);renderCanvas();renderPanel();scheduleSave();}return;}
 if(range?.end!=null){if(tool==='draw'){remember();appendDraw(p);render();scheduleSave();}return;}
 const found=C.nearest(plan,p,26/view.scale).find(h=>!range||h.circuit===range.circuit);if(!found){setStatus('Коснитесь трубы выбранного контура.');return;}
 const r=plan.circuits[found.circuit].route,index=C.dist(p,r[found.seg])<C.dist(p,r[found.seg+1])?found.seg:found.seg+1;
 if(range&&index===range.start){setStatus('Выберите другой поворот.');return;}remember();
 if(!range)range={circuit:found.circuit,start:index,end:null};else{range.end=Math.max(index,range.start);range.start=Math.min(index,range.start);if(tool==='draw')drawPoints=[copy(r[range.start])];}selection=null;render();scheduleSave();
}
function nearestWall(p){let best=null;for(const edge of C.boundaries(params().sections)){const at=C.projection(p,...edge),d=C.dist(p,at);if(!best||d<best.distance)best={edge,at,distance:d};}return best;}
function obstacleGaps(o){const walls=C.boundaries(params().sections),cx=o.x+o.width/2,cy=o.y+o.height/2,b=state.bounds;const result={left:{coordinate:b.minX,distance:o.x-b.minX},right:{coordinate:b.maxX,distance:b.maxX-o.x-o.width},top:{coordinate:b.minY,distance:o.y-b.minY},bottom:{coordinate:b.maxY,distance:b.maxY-o.y-o.height}};for(const [a,z] of walls){if(a.x===z.x&&cy>=a.y&&cy<=z.y){if(a.x<=o.x&&o.x-a.x<result.left.distance)result.left={coordinate:a.x,distance:o.x-a.x};if(a.x>=o.x+o.width&&a.x-o.x-o.width<result.right.distance)result.right={coordinate:a.x,distance:a.x-o.x-o.width};}if(a.y===z.y&&cx>=a.x&&cx<=z.x){if(a.y<=o.y&&o.y-a.y<result.top.distance)result.top={coordinate:a.y,distance:o.y-a.y};if(a.y>=o.y+o.height&&a.y-o.y-o.height<result.bottom.distance)result.bottom={coordinate:a.y,distance:a.y-o.y-o.height};}}return result;}
function placeCollector(p){
 const hit=nearestWall(p);if(!hit)return;const [a,b]=hit.edge,h=a.y===b.y,axis=h?'x':'y',length=C.dist(a,b);if(length<100)return;
 const at=copy(hit.at);at[axis]=Math.max(a[axis]+30,Math.min(b[axis]-30,at[axis]));
 const raw=E.freeSpace({sections:params().sections,obstacles:[],wallOffsetMm:0,pipeDiameterMm:0});
 const side=h?(raw.inside({x:at.x,y:at.y+1})?'top':'bottom'):(raw.inside({x:at.x+1,y:at.y})?'left':'right');
 state.supply={...at,[axis]:at[axis]-25,side};state.returnPoint={...at,[axis]:at[axis]+25,side};syncCollectors();
 // Existing routes stay intact until their connections are checked/rebuilt.
 // Moving a cabinet cannot silently discard a locked or manually drawn run.
}
function geometryCommit(change){cancelRouting();const before=snapshot();try{change();recomputeGeometry();syncCollectors();syncExcludedFromObstaclesV6();syncShapeUiV5();syncInputs();remember(before);check();render();scheduleSave();}catch(e){restore(before);setStatus(e.message,true);}}
function editWall(){const edge=C.boundaries(params().sections)[selection.index],value=Number($('editWallLength').value);geometryCommit(()=>{state.sections=C.resizeWall(params().sections,edge,value);state.roomAdded.clear();state.roomRemoved.clear();state.shapeType='custom';state.shapeParams={};state.shapeAxes=null;const model=WarmShapeV24.inferFromSections(state.sections);if(model)state.shapeParams={v24:true,...model};const p=centerCollector();if(p)placeCollector(p);});}
function editObstacle(){const i=selection.index,o=state.obstacles[i],gaps=obstacleGaps(o),w=Number($('editObstacleW').value),h=Number($('editObstacleH').value),x=gaps.left.coordinate+Number($('editObstacleX').value),y=gaps.top.coordinate+Number($('editObstacleY').value);geometryCommit(()=>{if(![x,y,w,h].every(Number.isFinite)||w<50||h<50)throw Error('Размеры препятствия — не меньше 50 мм');const room=E.freeSpace({sections:params().sections,obstacles:[],wallOffsetMm:0,pipeDiameterMm:0}),candidate={x,y,width:w,height:h};const area=E.decomposition(room.raw.flatMap(r=>{const l=Math.max(r.x,x),t=Math.max(r.y,y),right=Math.min(r.x+r.width,x+w),bottom=Math.min(r.y+r.height,y+h);return right>l&&bottom>t?[{x:l,y:t,width:right-l,height:bottom-t}]:[];})).reduce((s,r)=>s+r.width*r.height,0);if(Math.abs(area-w*h)>1)throw Error('Препятствие выходит за границу комнаты');state.obstacles[i]={...o,...candidate};});}
function tap(p){
 if(tool==='more')tool=returnTool;
 if(tool==='erase'){eraseTap(p);return;}
 if(tool==='points'){pointTap(p);return;}
 if(tool==='rebuild'){rangeTap(p);return;}
 if(tool==='draw'){if(gap||!plan.circuits.length){setStatus('Зажмите активный конец линии, протяните прямой отрезок и отпустите.');return;}setStatus('Сначала вырежьте участок ластиком.');return;}
 const col=centerCollector();if(col&&C.dist(p,col)*view.scale<28){selection={type:'collector'};expanded=false;render();return;}
 const obstacle=(state.obstacles||[]).findIndex(o=>p.x>=o.x&&p.x<=o.x+o.width&&p.y>=o.y&&p.y<=o.y+o.height);
 if(obstacle>=0){selection={type:'obstacle',index:obstacle};expanded=false;render();return;}
 hits=C.nearest(plan,p,20/view.scale);hitIndex=0;
 const wall=nearestWall(p);
 if(wall&&wall.distance*view.scale<10&&(!hits.length||wall.distance<hits[0].distance)){selection={type:'wall',index:C.boundaries(params().sections).findIndex(e=>C.edgeKey(...e)===C.edgeKey(...wall.edge))};expanded=false;render();return;}
 selection=hits.length?{type:'pipe',...hits[0]}:null;expanded=false;render();
}
function handleAt(p){if(tool!=='select')return null;if(selection?.type==='pipe'){const r=plan.circuits[selection.circuit].route,a=r[selection.seg],b=r[selection.seg+1];if(C.dist(p,{x:(a.x+b.x)/2,y:(a.y+b.y)/2})*view.scale<=22)return'pipe';}if(selection?.type==='collector'&&C.dist(p,centerCollector())*view.scale<=28)return'collector';return null;}
function cancelGesture(){if(gesture?.before&&gesture.kind!=='pinch'){const b=gesture.before;plan=copy(b.draft.plan);state.supply=copy(b.geometry.supply);state.returnPoint=copy(b.geometry.returnPoint);syncCollectors();if(gesture.kind==='lineDraw')restoreScratch(b.draft.scratch);check();}gesture=null;liveLine=null;magnifier.hidden=true;}
function down(e){
 if(!active||e.target.closest('button')||e.button>0)return;e.preventDefault();e.stopPropagation();
 pointers.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY});try{diagramScroll.setPointerCapture(e.pointerId);}catch{}
 if(pointers.size===2){cancelGesture();const [a,b]=[...pointers.values()];gesture={kind:'pinch',distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),view:copy(view),mid:{clientX:(a.clientX+b.clientX)/2,clientY:(a.clientY+b.clientY)/2}};render();return;}
 if(pointers.size>2)return;
 const p=point(e);
 if(tool==='draw'&&!preview&&(gap||!plan.circuits.length)){
  cancelRouting();const start=drawPoints.at(-1);if(!start||C.dist(p,start)*view.scale>38){gesture={kind:'drawBlocked',pointerId:e.pointerId,start:{clientX:e.clientX,clientY:e.clientY},view:copy(view),moved:false};setStatus('Начните новый отрезок с конца фиолетовой линии.');return;}
  const ctx=lineContext();gesture={kind:'lineDraw',pointerId:e.pointerId,start:{clientX:e.clientX,clientY:e.clientY},world:p,startPoint:copy(start),view:copy(view),before:snapshot(),moved:false,drawCtx:ctx};liveLine={a:copy(start),b:copy(start),ok:true};return;
 }
 if(tool==='points'&&pointSpan&&spanHandleAt(p)){gesture={kind:'spanOffset',pointerId:e.pointerId,start:{clientX:e.clientX,clientY:e.clientY},world:p,view:copy(view),before:snapshot(),moved:false,span:copy(pointSpan),basePlan:copy(pointSpan.basePlan),lastDelta:0};return;}
 if(tool==='points'&&pointPick){const found=C.nearest(plan,p,30/view.scale).find(h=>h.circuit===pointPick.circuit&&h.seg===pointPick.seg);if(found){gesture={kind:'turnPick',pointerId:e.pointerId,start:{clientX:e.clientX,clientY:e.clientY},world:p,view:copy(view),before:snapshot(),moved:false,anchor:copy(pointPick),basePlan:copy(plan),target:null,lastDelta:0};return;}}
 const handle=handleAt(p);gesture={kind:handle||'pan',pointerId:e.pointerId,start:{clientX:e.clientX,clientY:e.clientY},world:p,view:copy(view),before:handle?snapshot():null,moved:false};
}
function showMagnifier(e,p){const r=workspace.getBoundingClientRect(),size=workspace.clientHeight<220?112:142;const left=Math.max(4,Math.min(r.width-size-4,e.clientX-r.left-size/2)),top=Math.max(4,e.clientY-r.top-size-36);magnifier.style.left=left+'px';magnifier.style.top=top+'px';magnifier.hidden=false;const side=size/(view.scale*2.5);magnifier.innerHTML=`<svg viewBox="${p.x-side/2} ${p.y-side/2} ${side} ${side}" xmlns="http://www.w3.org/2000/svg">${planSvg.innerHTML}</svg>`;}
function motion(e){
 if(!active||!pointers.has(e.pointerId))return;e.preventDefault();e.stopPropagation();pointers.set(e.pointerId,{clientX:e.clientX,clientY:e.clientY});if(!gesture)return;
 if(gesture.kind==='pinch'){
  if(pointers.size<2)return;const [a,b]=[...pointers.values()],mid={clientX:(a.clientX+b.clientX)/2,clientY:(a.clientY+b.clientY)/2},distance=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);view=copy(gesture.view);zoom(distance/Math.max(1,gesture.distance),gesture.mid);view.x-=(mid.clientX-gesture.mid.clientX)/view.scale;view.y-=(mid.clientY-gesture.mid.clientY)/view.scale;renderCanvas();return;
 }
 const dx=e.clientX-gesture.start.clientX,dy=e.clientY-gesture.start.clientY;if(Math.hypot(dx,dy)>5)gesture.moved=true;if(!gesture.moved)return;
 if(gesture.kind==='drawBlocked')return;
 if(gesture.kind==='pan'){view.x=gesture.view.x-dx/view.scale;view.y=gesture.view.y-dy/view.scale;renderCanvas();return;}
 if(gesture.kind==='lineDraw'){const hit=lineEndpoint(point(e),gesture.drawCtx,gesture.startPoint);liveLine={a:copy(gesture.startPoint),b:copy(hit.p),ok:true,snapped:hit.snapped};renderCanvas();showMagnifier(e,hit.p);return;}
 if(gesture.kind==='spanOffset'){
  const a=gesture.span.a,b=gesture.span.b,len=C.dist(a,b),nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len,w=point(e),delta=Math.round(((w.x-gesture.world.x)*nx+(w.y-gesture.world.y)*ny)/10)*10,result=C.offsetSpanClamped(params(),gesture.basePlan,gesture.span,delta,locks);
  if(result.ok){plan=result.plan;gesture.lastDelta=result.delta||0;renderCanvas();showMagnifier(e,w);}return;
 }
 if(gesture.kind==='turnPick'){
  const w=point(e);if(!gesture.target){gesture.target=C.turnSelectionFromAnchor(gesture.basePlan,gesture.anchor,w);if(!gesture.target)return;selection={type:'pipe',...gesture.target};}
  const rr=gesture.basePlan.circuits[gesture.target.circuit].route,a=rr[gesture.target.seg],b=rr[gesture.target.seg+1],len=C.dist(a,b),nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len,delta=Math.round(((w.x-gesture.world.x)*nx+(w.y-gesture.world.y)*ny)/10)*10,result=C.moveSegmentNormalClamped(params(),gesture.basePlan,gesture.target,delta,locks);
  if(result.ok){plan=result.plan;gesture.lastDelta=result.delta||0;renderCanvas();showMagnifier(e,w);}return;
 }
 if(gesture.kind==='pipe'){
  const r=gesture.before.draft.plan.circuits[selection.circuit].route,a=r[selection.seg],b=r[selection.seg+1],h=Math.abs(a.y-b.y)<1e-6,v=Math.abs(a.x-b.x)<1e-6,w=point(e),len=C.dist(a,b),nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len,raw=h?dy/view.scale:v?dx/view.scale:(w.x-gesture.world.x)*nx+(w.y-gesture.world.y)*ny,delta=Math.round(raw/10)*10,result=C.moveSegment(gesture.before.draft.plan,selection,delta,locks);
  if(result.ok){plan=result.plan;renderCanvas();showMagnifier(e,w);}
 }else if(gesture.kind==='collector'){placeCollector(point(e));renderCanvas();showMagnifier(e,point(e));}
}
function up(e){
 if(!active||!pointers.has(e.pointerId))return;e.preventDefault();e.stopPropagation();pointers.delete(e.pointerId);magnifier.hidden=true;
 if(gesture?.kind==='pinch'){if(!pointers.size){gesture=null;scheduleSave();}return;}
 const g=gesture;if(!g)return;gesture=null;
 if(e.type==='pointercancel'){if(g.before){plan=copy(g.before.draft.plan);state.supply=copy(g.before.geometry.supply);state.returnPoint=copy(g.before.geometry.returnPoint);syncCollectors();if(g.kind==='lineDraw')restoreScratch(g.before.draft.scratch);check();render();}liveLine=null;return;}
 if(g.kind==='drawBlocked')return;
 if(g.kind==='lineDraw'){liveLine=null;if(!g.moved){setStatus('Зажмите конец линии и протяните прямой отрезок.');render();return;}finishLineSegment(g,point(e));return;}
 if(g.kind==='spanOffset'){if(!g.moved||!g.lastDelta){plan=copy(g.before.draft.plan);render();return;}remember(g.before);check();pointPick=null;pointSpan=null;selection=null;render();scheduleSave();setStatus('Участок смещён. Радиусы и границы соблюдены.');return;}
 if(g.kind==='turnPick'){if(!g.moved){pointTap(point(e));return;}if(!g.target||!g.lastDelta){plan=copy(g.before.draft.plan);render();setStatus('В этой стороне нет доступного поворота для перемещения.');return;}remember(g.before);check();pointPick=null;pointSpan=null;selection={type:'pipe',...g.target};render();scheduleSave();setStatus('Положение ближайшего поворота изменено.');return;}
 if(!g.moved){tap(point(e));return;}
 if(g.before){if(JSON.stringify(g.before.draft.plan)!==JSON.stringify(plan)||JSON.stringify(g.before.geometry.supply)!==JSON.stringify(state.supply)){remember(g.before);check();scheduleSave();}render();}else scheduleSave();
}
workspace.addEventListener('pointerdown',down,{capture:true,passive:false});workspace.addEventListener('pointermove',motion,{capture:true,passive:false});workspace.addEventListener('pointerup',up,{capture:true,passive:false});workspace.addEventListener('pointercancel',up,{capture:true,passive:false});
workspace.addEventListener('click',e=>{if(active&&!e.target.closest('button')){e.preventDefault();e.stopPropagation();}},{capture:true});
workspace.addEventListener('wheel',e=>{if(!active)return;e.preventDefault();e.stopPropagation();zoom(Math.exp(-e.deltaY*.002),e);scheduleSave();},{capture:true,passive:false});
panel.addEventListener('click',async e=>{
 const id=e.target.closest('button')?.id;if(!id)return;
 if(id==='editExpand'){expanded=!expanded;renderPanel();}
 if(id==='editCloseMore'){tool=returnTool;render();scheduleSave();}
 if(id==='editMinus')move(-10);if(id==='editPlus')move(10);if(id==='editPrev')cycle(-1);if(id==='editNext')cycle(1);
 if(id==='editSetDistance'){const value=Number($('editDistance').value),d=wallDistance();if(Number.isFinite(value))move(d?(value-d.distance)*d.sign:value);}
 if(id==='editSetWall')editWall();if(id==='editSetObstacle')editObstacle();
 if(id==='editDeleteObstacle')geometryCommit(()=>{state.obstacles.splice(selection.index,1);selection=null;});
 if(id==='editSetCollector'){const hit=nearestWall(centerCollector()),value=Number($('editCollectorOffset').value),[a,b]=hit.edge;if(!Number.isFinite(value)||value<30||value>C.dist(a,b)-30){setStatus('Коллектор должен помещаться на выбранной стене.',true);return;}geometryCommit(()=>placeCollector({x:a.x+(b.x-a.x)*value/C.dist(a,b),y:a.y+(b.y-a.y)*value/C.dist(a,b)}));}
 if(id==='editLock'&&selection?.type==='pipe'){remember();const c=plan.circuits[selection.circuit],r=c.route,key=C.edgeKey(r[selection.seg],r[selection.seg+1]);if(isLocked())locks=locks.filter(l=>l.circuit!==c.id||l.edge!==key);else locks.push({circuit:c.id,edge:key});render();scheduleSave();}
 if(id==='editCompare'){compare=!compare;render();}if(id==='editFit')fit();if(id==='editSaveDraft')leave(true);
 if(id==='editAutoBypass')selectTool('rebuild');if(id==='editUseEraser')selectTool('erase');
 if(id==='editCheck'){check();render();setStatus(validation.ok?'Схема прошла проверку':issues[0]?.message,true&&!validation.ok);}
 if(id==='editCancelRange')cancelRange();
 if(id==='editClearPoints'){pointPick=null;pointSpan=null;selection=null;render();scheduleSave();}
 if(id==='editResetDraw'&&gap){remember();const r=plan.circuits[gap.circuit]?.route;drawPoints=r?[copy(r[gap.start])]:[];preview=null;liveLine=null;render();scheduleSave();}
 if(id==='editUndoLine'&&gap&&drawPoints.length>1){remember();drawPoints=drawPoints.slice(0,-1);preview=null;liveLine=null;render();scheduleSave();}
 if(id==='editBypass'&&range?.end!=null){e.target.disabled=true;e.target.textContent='Ищу обход…';const result=await search('bypass');setPreview(result,result.path);if(!preview)renderPanel();}
 if(id==='editReconnect'){e.target.disabled=true;e.target.textContent='Подключаю…';const result=await search('reconnect');setPreview(result,null,'reconnect');if(!preview)renderPanel();}
 if(id==='editFinishNew'&&drawPoints.length){try{const n=E.normalize(params()),ports=E.manifoldPorts(n,1,E.freeSpace(n));appendDraw(ports[0].innerReturn,false);drawPoints.push(ports[0].returnPoint);const path=E.clean(drawPoints),next=copy(plan);next.manifold=ports;next.circuits=[{id:1,route:path,core:path,supply:ports[0].supply,returnPoint:ports[0].returnPoint,bendRadiusMm:n.minBendRadiusMm,length:E.length(path)}];setPreview({ok:true,plan:next},path);}catch{setStatus('Укажите коллектор на стене.',true);}}
 if(id==='editApply'&&preview){const next=preview.plan;commit(next);cancelRange();}
});
$('editDock').addEventListener('click',e=>{const b=e.target.closest('[data-edit-tool]');if(b)selectTool(b.dataset.editTool);});
$('editUndo').addEventListener('click',()=>history(true));$('editRedo').addEventListener('click',()=>history(false));$('editDone').addEventListener('click',()=>leave(false));
// Bind above captured legacy listeners, so old drag/undo handlers cannot also run.
document.addEventListener('click',e=>{
 const id=e.target.closest('button')?.id;
 if(id==='manualToolBtn'){e.preventDefault();e.stopPropagation();enter();return;}
 if(active&&['zoomInBtn','zoomOutBtn','fitBtn','undoBtn','backBtn'].includes(id)){e.preventDefault();e.stopPropagation();if(id==='zoomInBtn')zoom(1.25);if(id==='zoomOutBtn')zoom(.8);if(id==='fitBtn')fit();if(id==='undoBtn')history(true);if(id==='backBtn')leave(true);}
},{capture:true});
document.addEventListener('keydown',e=>{if(!active||e.target.matches('input,textarea,select'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(!e.shiftKey);}if(e.key==='Escape'){cancelGesture();cancelRange();}});
new ResizeObserver(()=>{if(!active)return;const size=workspace.clientWidth+'x'+workspace.clientHeight;if(size===lastSize)return;lastSize=size;cancelAnimationFrame(frame);frame=requestAnimationFrame(renderCanvas);}).observe(workspace);
renderPlan=function(...args){if(active)render();else{baseRender(...args);planSvg.classList.toggle('plan-overview',state.scale*state.pipeStepMm<22);}};
fitPlan=function(draw=true){if(active){if(draw)fit();return;}recomputeGeometry();const b=state.bounds,w=diagramScroll.clientWidth-24,h=diagramScroll.clientHeight-34;state.scale=Math.max(.001,Math.min((w-128)/Math.max(1,b.width),(h-150)/Math.max(1,b.height),.45));if(draw){renderPlan();requestAnimationFrame(centerPlanV5);}};
zoomBy=function(factor){if(active)zoom(factor);else baseZoom(factor);};
manualEnterV2A=enter;manualExitV2A=function(){if(active){autosave();deactivate();baseRender();}else{state.manualV2.active=false;}};
manualValidateV2A=function(circuits=plan?.circuits||state.manualV2.circuits){const result=C.inspect(params(),{...(plan||state.enginePlanV1||{}),circuits});return{level:result.ok?'ok':'bad',hard:result.issues.length,incomplete:result.checks.H5_continuity?0:1,bendBad:result.checks.H4_bendRadius?0:1,spacing:0,inset:0,bends:0,total:circuits.reduce((s,c)=>s+E.length(c.route),0),lengths:circuits.map(c=>E.length(c.route)),spread:0,unified:result};};
serializeState=function(){const raw=baseSerialize();if(active||state.editorDraft){raw.editorDraft=active?pack():copy(state.editorDraft);delete raw.manualPlanV2;if(active){if(validation?.ok)raw.unifiedPlan=copy(plan);else delete raw.unifiedPlan;raw.route=[];raw.routeComplete=!!validation?.ok;}}return raw;};
loadScheme=function(raw){if(active)deactivate();plan=null;state.editorDraft=null;baseLoad(raw);state.editorDraft=raw?.editorDraft?copy(raw.editorDraft):null;};
newScheme=function(){if(active)deactivate();plan=null;state.editorDraft=null;return baseNew();};
const reset=resetRoute;resetRoute=function(...args){const result=reset(...args);if(!active)state.editorDraft=null;return result;};
const generate=v221GenerateWithChoice;v221GenerateWithChoice=async function(){state.editorDraft=null;const result=await generate();state.editorDraft=null;return result;};
resume.addEventListener('click',()=>{try{const saved=JSON.parse(localStorage.getItem(DRAFT_KEY));if(!saved?.raw)return;loadScheme(saved.raw);enter();undo=saved.undo||[];redo=saved.redo||[];render();}catch{setStatus('Черновик не удалось открыть.',true);}});
try{const saved=JSON.parse(localStorage.getItem(DRAFT_KEY));resume.hidden=!saved?.raw||saved.pending===false;}catch{}
function suspend(){if(!active)return;cancelGesture();pointers.clear();render();autosave();}
addEventListener('pagehide',suspend);addEventListener('blur',()=>{if(active){cancelGesture();pointers.clear();render();}});document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
globalThis.WarmEditor={enter,leave,get active(){return active;},get plan(){return plan;},get selection(){return selection;},get view(){return view;},get validation(){return validation;},get locks(){return copy(locks);},get history(){return{undo:undo.length,redo:redo.length};},inspect:check,autosave};
})();
