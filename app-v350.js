/* Automatic creation is the default; legacy calculation and edits stay available. */
(()=>{
  'use strict';
  const el=id=>document.getElementById(id),copy=x=>structuredClone(x),metres=n=>(n/1000).toFixed(2).replace('.',',');
  const maxCircuitM=()=>Math.max(20,Number(state.maxCircuitLengthM)||80);
  const maxCircuitMm=()=>Math.round(maxCircuitM()*1000);
  state.autoPlanV35=null;state.autoOffsetV35=100;if(typeof state.pairedLeadsV35!=='boolean')state.pairedLeadsV35=false;
  let worker=null,generation=0,savedKey='',timer=null,finishPending=null;
  const project=()=>WarmGrid.createProject({...WarmGrid.legacyGeometry(state),grid:state.mountingGridV3,pipe:{diameterMm:state.pipeDiameterMm},collector:{supply:state.supply,returnPoint:state.returnPoint}});
  const signature=()=>JSON.stringify([project(),state.autoOffsetV35,maxCircuitM(),!!state.pairedLeadsV35]);
  const bar=document.createElement('div');bar.className='auto-bar-v35';
  bar.innerHTML=`<div class="auto-grid-v35"><span>Сетка, мм</span><div role="group" aria-label="Монтажная сетка"><button data-auto-grid="100">100</button><button data-auto-grid="150">150</button><button data-auto-grid="200">200</button></div><button id="autoInfoV35" class="auto-info-v35" aria-label="Результат и параметры автоматического расчёта">Раскладка ⓘ</button></div><div id="autoSummaryV35" class="auto-summary-v35" aria-live="polite">Форма → сетка → коллектор → Создать</div>`;
  bar.hidden=true;el('editorFeedback').after(bar);
  const lengthStrip=document.createElement('div');lengthStrip.className='auto-lengths-v35';lengthStrip.setAttribute('aria-label','Полные длины контуров');bar.append(lengthStrip);

  // Compact master-facing summary of the completed automatic layout.
  const infoBtn=document.createElement('button');
  infoBtn.id='layoutInfoBtnV35';infoBtn.className='round-btn layout-info-btn-v35';infoBtn.type='button';
  infoBtn.setAttribute('aria-label','Информация об укладке');infoBtn.title='Информация об укладке';infoBtn.textContent='ⓘ';infoBtn.hidden=true;
  el('settingsBtn').before(infoBtn);
  const infoSheet=document.createElement('section');infoSheet.id='layoutInfoSheetV35';infoSheet.className='bottom-sheet layout-info-sheet-v35';infoSheet.setAttribute('aria-label','Информация об укладке');
  infoSheet.innerHTML=`<div class="sheet-grabber"></div><div class="sheet-head"><div><strong>Укладка готова</strong><span>Основные данные для монтажа</span></div><button id="closeLayoutInfoV35" class="round-btn mini" type="button" aria-label="Закрыть">×</button></div><div id="layoutInfoBodyV35"></div>`;
  el('editorView').append(infoSheet);
  const methodName=m=>m==='spiral'?'Улитка':m==='double-snake'?'Двойная змейка':m==='snake'?'Змейка':'Укладка';
  const areaMetres=n=>(n/1e6).toFixed(1).replace('.',',');
  function updateLayoutInfo(){
    const m=state.multiPlanV33,circuits=m?.circuits||[],ready=!!circuits.length&&!!state.routeComplete;
    infoBtn.hidden=!ready;
    const body=el('layoutInfoBodyV35');if(!body)return;body.replaceChildren();
    if(!ready){const p=document.createElement('p');p.className='sheet-help';p.textContent='Сначала создайте раскладку.';body.append(p);return;}
    const lengths=circuits.map(c=>c.lengthMm),total=m.lengthMm??lengths.reduce((a,b)=>a+b,0),spread=Math.max(...lengths)-Math.min(...lengths);
    const area=m.coverage?.availableAreaMm2;
    const summary=document.createElement('div');summary.className='layout-info-summary-v35';
    const facts=[['Контуров',String(circuits.length)],['Труба',`Ø${state.pipeDiameterMm} мм`],['Шаг',`${state.mountingGridV3.cellSizeMm} мм`],['Подводы',state.pairedLeadsV35?'подача и обратка рядом':'раздельно'],['Макс. длина контура',`${maxCircuitM()} м`],['Всего трубы',`${metres(total)} м`]];
    if(Number.isFinite(area)&&area>0)facts.splice(3,0,['Площадь укладки',`${areaMetres(area)} м²`]);
    for(const [label,value] of facts){const d=document.createElement('div');d.innerHTML=`<span>${label}</span><strong>${value}</strong>`;summary.append(d);}
    body.append(summary);
    if(circuits.length>1){const balance=document.createElement('div');balance.className='layout-info-balance-v35';balance.innerHTML=`<span>Разница между самым длинным и коротким контуром</span><strong>${metres(spread)} м</strong>`;body.append(balance);}
    const list=document.createElement('div');list.className='layout-info-circuits-v35';
    for(const c of circuits){
      const card=document.createElement('article');card.className='layout-info-circuit-v35';
      const supply=c.supplyTransit?.lengthMm||0,heat=c.heating?.lengthMm||0,ret=c.returnTransit?.lengthMm||0;
      card.innerHTML=`<div class="layout-info-circuit-head-v35"><strong>${c.name||`Контур ${c.number||''}`}</strong><b>${metres(c.lengthMm)} м</b></div><div class="layout-info-circuit-meta-v35"><span>${methodName(c.method)}</span><span>Рабочая часть ${metres(heat)} м</span><span>Подача ${metres(supply)} м</span><span>Обратка ${metres(ret)} м</span></div>`;
      list.append(card);
    }
    body.append(list);
    const limit=maxCircuitMm();const note=document.createElement('p');note.className='layout-info-note-v35';note.textContent=`Длины контуров включают подачу и обратку. ${lengths.every(n=>n<=limit)?`Все контуры укладываются в заданный лимит ${maxCircuitM()} м.`:`Есть контур длиннее заданного лимита ${maxCircuitM()} м.`}`;body.append(note);
  }
  function openLayoutInfo(){updateLayoutInfo();if(!infoBtn.hidden)openSheetV5('layoutInfoSheetV35');}
  infoBtn.onclick=openLayoutInfo;el('closeLayoutInfoV35').onclick=()=>closeSheetV5();
  const sheet=document.createElement('section');sheet.id='autoSheetV35';sheet.className='bottom-sheet auto-sheet-v35';sheet.setAttribute('aria-label','Автоматическая раскладка');
  sheet.innerHTML=`<div class="sheet-grabber"></div><div class="sheet-head"><div><strong>Создать раскладку</strong><span>Обновление 022</span></div><button id="closeAutoV35" class="round-btn mini" aria-label="Закрыть">×</button></div><div id="autoResultsV35"></div><label class="paired-leads-toggle-v35"><input id="pairedLeadsV35" type="checkbox"><span><b>Подача и обратка рядом</b><em>Только подводы одного контура</em></span></label><div class="settings-grid" hidden><label>Отступ рабочей трубы, мм<input id="autoOffsetV35" type="number" min="0" max="1000" step="10" value="100"></label><label>Труба, мм<select id="autoDiameterV35"><option>16</option><option>17</option><option>20</option></select></label></div><button id="autoCreateV35" class="primary-btn wide">Создать</button><details class="auto-legacy-v35" hidden><summary>Прежние способы расчёта</summary><button id="autoLegacyV35" class="secondary-btn wide">Открыть прежний расчёт</button></details>`;
  el('editorView').append(sheet);
  const messages={COLLECTOR_REQUIRED:'Укажите коллектор на стене, затем нажмите «Создать».',COLLECTOR_OUTSIDE:'Коллектор вне доступной комнаты. Установите его на свободном участке стены.',ROOM_REQUIRED:'Сначала задайте форму комнаты.',NO_WORKING_AREA:'После отступов не осталось рабочей площади. Проверьте размеры и препятствия.',INVALID_OFFSET:'Отступ должен быть неотрицательным числом.',SEARCH_LIMIT:'Поиск достиг ограничения по времени. Проверенная раскладка пока не найдена.',SEARCH_COMPLEXITY_LIMIT:'Достигнут предел перебора вариантов разбиения. Проверенная раскладка пока не найдена.',AREA_TOO_LARGE:'Для этой площади и шага сетки превышен размер расчёта.',COLLECTOR_WALL_NOT_FOUND:'Установите коллектор на свободный участок стены, затем повторите расчёт.',NO_VERIFIED_LAYOUT:'Проверенная раскладка для этой формы и положения коллектора пока не найдена. Попробуйте другое положение коллектора. Частичная схема не сохранена.'};
  function resultText(){const m=state.multiPlanV33;return m?.definitions?.every(d=>d.automatic)?`${m.circuits.length} контур(а) · ${metres(m.lengthMm)} м с подводами`:null;}
  function sync(){
    bar.querySelectorAll('[data-auto-grid]').forEach(b=>{const on=Number(b.dataset.autoGrid)===state.mountingGridV3.cellSizeMm;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
    el('autoDiameterV35').value=String(state.pipeDiameterMm);el('autoOffsetV35').value=state.autoOffsetV35;el('pairedLeadsV35').checked=!!state.pairedLeadsV35;
    el('generateBtn').querySelector('span:last-child').textContent=worker?'Стоп':'Создать';
    const text=resultText();el('autoSummaryV35').textContent=worker?'Подбираю число контуров и подводы…':WarmV340.draft?(state.routeComplete?'Ручная схема проверена':'Ручной черновик · требует проверки'):text||'Форма → сетка → коллектор → Создать';
    updateLayoutInfo();
    lengthStrip.replaceChildren();
    if(text&&!worker)for(const c of state.multiPlanV33.circuits){const tag=document.createElement('span');tag.textContent=`К${c.number}: ${metres(c.lengthMm)} м`;lengthStrip.append(tag);}
    const list=el('autoResultsV35');list.replaceChildren();
    const add=(t,cls)=>{const p=document.createElement('p');p.textContent=t;if(cls)p.className=cls;list.append(p);};
    if(text){
      add(text,'auto-result-title-v35');
      for(const c of state.multiPlanV33.circuits)add(`${c.name}: ${metres(c.lengthMm)} м · ${c.method==='spiral'?'улитка':'двойная змейка'}. Подача ${metres(c.supplyTransit.lengthMm)}, рабочая часть ${metres(c.heating.lengthMm)}, обратка ${metres(c.returnTransit.lengthMm)} м.`);
      add('Проверены границы, исключения, непрерывность, пересечения, полные длины и геометрическое покрытие.');
      add(`Геометрический радиус: ${Number(state.circuitSettingsV32.radiusMm.toFixed(1))} мм. Число контуров подобрано поиском; минимальность не гарантируется.`,'sheet-help');
      if(state.autoPlanV35)add(`Контроль покрытия: точки с интервалом не более ${state.autoPlanV35.coverage.pitchMm} мм; допуск ${Math.round(state.autoPlanV35.coverage.limitMm)} мм до оси трубы. Это геометрическая проверка, не теплотехнический расчёт.`,'sheet-help');
    }else add('Нарисуйте помещение и установите коллектор.');
  }
  function cancel(){generation++;worker?.terminate();worker=null;clearTimeout(timer);finishPending?.();finishPending=null;state.engineBusyV1=false;}
  const resetBase=resetRoute;
  resetRoute=function(...args){cancel();state.autoPlanV35=null;savedKey='';return resetBase(...args);};
  const renderBase=renderPlan;
  renderPlan=function(...args){
    if(state.autoPlanV35&&signature()!==savedKey){state.autoPlanV35=null;state.multiPlanV33=null;state.routeComplete=false;}
    renderBase(...args);sync();
  };
  async function calculate(){
    if(worker){resetRoute();renderPlan();setStatus('Поиск остановлен. Комната и параметры сохранены.');return;}
    if(!state.supply){closeSheetV5();el('collectorToolBtn').click();setStatus(messages.COLLECTOR_REQUIRED);return;}
    if(WarmEditor.active)manualExitV2A();WarmV340.clearForAutomatic();resetRoute();
    state.editorDraft=null;state.manualV2=blankManualStateV2A();
    const p=project(),key=signature(),request=++generation;
    closeSheetV5();state.engineBusyV1=true;setModeV6('inspect');
    try{
      const result=await new Promise((resolve,reject)=>{
        const done=(r,e)=>{clearTimeout(timer);worker?.terminate();worker=null;finishPending=null;e?reject(e):resolve(r);};
        finishPending=()=>resolve(null);
        worker=new Worker('./auto-worker.js?v=501-engine022');
        timer=setTimeout(()=>done(null,new Error('SEARCH_LIMIT')),65000);
        worker.onmessage=({data})=>{if(data.progress)setStatus(`Проверяю ${data.progress.count} контур(а), подводы и длины…`,false,{kind:'progress'});else done(data.result);};
        worker.onerror=()=>done(null,new Error('CALCULATION_FAILED'));
        worker.postMessage({project:p,options:{wallOffsetMm:state.autoOffsetV35,maxCircuitLengthMm:maxCircuitMm(),pairedLeads:!!state.pairedLeadsV35,timeBudgetMs:45000}});renderPlan();
      });
      if(request!==generation)return;
      if(key!==signature()){setStatus('Комната или параметры изменились. Нажмите «Создать» ещё раз.',true);return;}
      if(!result?.ok){setStatus(messages[result?.reason]||'Поиск не завершён. Повторите попытку.',true);return;}
      if(!WarmAuto.validate(p,result).ok)throw new Error('INVALID_PLAN');
      WarmV330.accept(result.multi);state.autoPlanV35=copy(result);savedKey=signature();state.routeComplete=true;
      setStatus(`Готово: ${resultText()}. Заданный максимум — ${maxCircuitM()} м на контур. «Правка» позволяет изменить предложение.`);
      setTimeout(openLayoutInfo,0);
    }catch(e){if(request===generation)setStatus(messages[e.message]||'Результат не прошёл проверку. Повторите расчёт.',true);}
    finally{if(request===generation){state.engineBusyV1=false;renderPlan();}}
  }
  const old=el('generateBtn');old.replaceWith(old.cloneNode(true));el('generateBtn').onclick=calculate;
  el('autoCreateV35').onclick=calculate;
  // The main workflow exposes dimensions on the first tap, including after a
  // calculation (the legacy button only switched modes on its first tap).
  el('shapeToolBtn').addEventListener('click',()=>{syncShapeUiV5();openSheetV5('shapeSheet');});
  el('autoInfoV35').onclick=()=>{sync();openSheetV5('autoSheetV35');};el('closeAutoV35').onclick=()=>closeSheetV5();
  el('autoLegacyV35').onclick=()=>{closeSheetV5();WarmV320.open();};
  bar.querySelectorAll('[data-auto-grid]').forEach(b=>b.onclick=()=>{el('mountingGridInput').value=b.dataset.autoGrid;el('mountingGridInput').dispatchEvent(new Event('change',{bubbles:true}));});
  el('autoDiameterV35').onchange=()=>{el('pipeDiameterInput').value=el('autoDiameterV35').value;el('pipeDiameterInput').dispatchEvent(new Event('change',{bubbles:true}));};
  el('autoOffsetV35').onchange=()=>{const n=Number(el('autoOffsetV35').value);if(!Number.isFinite(n)||n<0||n>1000){setStatus(messages.INVALID_OFFSET,true);sync();return;}state.autoOffsetV35=n;resetRoute();renderPlan();};
  el('pairedLeadsV35').onchange=()=>{const next=el('pairedLeadsV35').checked;if(next===!!state.pairedLeadsV35)return;state.pairedLeadsV35=next;resetRoute();renderPlan();setStatus(next?'Подача и обратка одного контура могут идти рядом. Нажмите «Создать».':'Компактный подвод выключен. Нажмите «Создать».');};
  // Legacy material assumptions are kept only in the explicitly labelled legacy UI.
  const settings=el('settingsSheet').querySelector('.settings-grid'),legacy=document.createElement('details');legacy.className='auto-legacy-settings-v35';legacy.innerHTML='<summary>Параметры прежних схем 2.x</summary><div class="settings-grid"></div>';
  const keep=['mountingGridInput','pipeDiameterInput','mountingGridSummary','nameInput','objectInput'];
  [...settings.children].forEach(n=>{if(!keep.some(id=>n.id===id||n.querySelector('#'+id)))legacy.lastElementChild.append(n);});settings.after(legacy);
  const quick=document.createElement('button');quick.className='secondary-btn wide';quick.textContent='Автоматическая раскладка';quick.onclick=()=>{sync();openSheetV5('autoSheetV35');};settings.after(quick);
  const saveBase=serializeState;
  serializeState=function(){const raw=saveBase();raw.versionLabel='3.5.0';raw.autoOffsetV35=state.autoOffsetV35;raw.pairedLeadsV35=!!state.pairedLeadsV35;if(state.autoPlanV35&&signature()===savedKey&&!raw.gridEditV34)raw.autoPlanV35=copy(state.autoPlanV35);return raw;};
  const loadBase=loadScheme;
  loadScheme=function(raw){cancel();state.autoPlanV35=null;savedKey='';state.autoOffsetV35=Number.isFinite(raw.autoOffsetV35)&&raw.autoOffsetV35>=0?raw.autoOffsetV35:100;const paired=raw.pairedLeadsV35===true;loadBase(raw);state.pairedLeadsV35=paired;
    if(raw.autoPlanV35&&!raw.gridEditV34){if(WarmAuto.validate(project(),raw.autoPlanV35).ok){WarmV330.accept(raw.autoPlanV35.multi);state.autoPlanV35=copy(raw.autoPlanV35);savedKey=signature();}else{state.multiPlanV33=null;state.routeComplete=false;setStatus('Сохранённая автоматическая схема не прошла проверку. Нажмите «Создать».',true);}}
    renderPlan();};
  const newBase=newScheme;
  newScheme=function(...args){cancel();state.autoPlanV35=null;savedKey='';state.autoOffsetV35=100;state.pairedLeadsV35=false;newBase(...args);sync();};
  document.title='Warm 3.5 · автоматическая раскладка';document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V3.5 · автоматическая раскладка'));
  document.querySelector('#homeView .hero p').textContent='Выберите параметры, нарисуйте помещение и укажите коллектор — Warm предложит раскладку.';
  globalThis.WarmV350={calculate,project,get plan(){return state.autoPlanV35;},get busy(){return !!worker;}};
  sync();
})();
