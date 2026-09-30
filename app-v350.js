/* Automatic creation is the default; legacy calculation and edits stay available. */
(()=>{
  'use strict';
  const el=id=>document.getElementById(id),copy=x=>structuredClone(x),metres=n=>(n/1000).toFixed(2).replace('.',',');
  state.autoPlanV35=null;state.autoOffsetV35=100;
  let worker=null,generation=0,savedKey='',timer=null,finishPending=null;
  const project=()=>WarmGrid.createProject({...WarmGrid.legacyGeometry(state),grid:state.mountingGridV3,pipe:{diameterMm:state.pipeDiameterMm},collector:{supply:state.supply,returnPoint:state.returnPoint}});
  const signature=()=>JSON.stringify([project(),state.autoOffsetV35]);
  const bar=document.createElement('div');bar.className='auto-bar-v35';
  bar.innerHTML=`<div class="auto-grid-v35"><span>Сетка, мм</span><div role="group" aria-label="Монтажная сетка"><button data-auto-grid="100">100</button><button data-auto-grid="150">150</button><button data-auto-grid="200">200</button></div><button id="autoInfoV35" class="auto-info-v35" aria-label="Результат и параметры автоматического расчёта">Раскладка ⓘ</button></div><div id="autoSummaryV35" class="auto-summary-v35" aria-live="polite">Форма → сетка → коллектор → Создать</div>`;
  el('editorFeedback').after(bar);
  const lengthStrip=document.createElement('div');lengthStrip.className='auto-lengths-v35';lengthStrip.setAttribute('aria-label','Полные длины контуров');bar.append(lengthStrip);
  const sheet=document.createElement('section');sheet.id='autoSheetV35';sheet.className='bottom-sheet auto-sheet-v35';sheet.setAttribute('aria-label','Автоматическая раскладка');
  sheet.innerHTML=`<div class="sheet-grabber"></div><div class="sheet-head"><div><strong>Автоматическая раскладка</strong><span>Полные контуры до 80 м</span></div><button id="closeAutoV35" class="round-btn mini" aria-label="Закрыть">×</button></div><div id="autoResultsV35"></div><div class="settings-grid"><label>Отступ рабочей трубы, мм<input id="autoOffsetV35" type="number" min="0" max="1000" step="10" value="100"></label><label>Труба, мм<select id="autoDiameterV35"><option>16</option><option>17</option><option>20</option></select></label></div><p class="sheet-help">Число контуров, зоны, точки подключения и плавные повороты подбираются автоматически. Длины включают оба подвода и дуги.</p><p class="sheet-help">Показанные радиус и выходы коллектора — геометрическое предложение. Допустимость изгиба для выбранной трубы проверьте по данным её производителя; размер реального коллектора уточните при монтаже.</p><button id="autoCreateV35" class="primary-btn wide">Создать</button><details class="auto-legacy-v35"><summary>Прежние способы расчёта</summary><p class="sheet-help">Для сохранённых схем и особых задач доступны прежние параметры и ручное задание зон.</p><button id="autoLegacyV35" class="secondary-btn wide">Открыть прежний расчёт</button></details>`;
  el('editorView').append(sheet);
  const messages={COLLECTOR_REQUIRED:'Укажите коллектор на стене, затем нажмите «Создать».',COLLECTOR_OUTSIDE:'Коллектор вне доступной комнаты. Установите его на свободном участке стены.',ROOM_REQUIRED:'Сначала задайте форму комнаты.',NO_WORKING_AREA:'После отступов не осталось рабочей площади. Проверьте размеры и препятствия.',INVALID_OFFSET:'Отступ должен быть неотрицательным числом.',SEARCH_LIMIT:'Поиск не успел найти проверенную раскладку. Попробуйте снова или измените положение коллектора. Это не означает, что укладка невозможна.',NO_VERIFIED_LAYOUT:'Проверенная раскладка для этой формы и положения коллектора пока не найдена. Попробуйте другое положение коллектора. Частичная схема не сохранена.'};
  function resultText(){const m=state.multiPlanV33;return m?.definitions?.every(d=>d.automatic)?`${m.circuits.length} контур(а) · ${metres(m.lengthMm)} м с подводами`:null;}
  function sync(){
    bar.querySelectorAll('[data-auto-grid]').forEach(b=>{const on=Number(b.dataset.autoGrid)===state.mountingGridV3.cellSizeMm;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
    el('autoDiameterV35').value=String(state.pipeDiameterMm);el('autoOffsetV35').value=state.autoOffsetV35;
    el('generateBtn').querySelector('span:last-child').textContent=worker?'Стоп':'Создать';
    const text=resultText();el('autoSummaryV35').textContent=worker?'Подбираю число контуров и подводы…':WarmV340.draft?(state.routeComplete?'Ручная схема проверена':'Ручной черновик · требует проверки'):text||'Форма → сетка → коллектор → Создать';
    lengthStrip.replaceChildren();
    if(text&&!worker)for(const c of state.multiPlanV33.circuits){const tag=document.createElement('span');tag.textContent=`К${c.number}: ${metres(c.lengthMm)} м`;lengthStrip.append(tag);}
    const list=el('autoResultsV35');list.replaceChildren();
    const add=(t,cls)=>{const p=document.createElement('p');p.textContent=t;if(cls)p.className=cls;list.append(p);};
    if(text){
      add(text,'auto-result-title-v35');
      for(const c of state.multiPlanV33.circuits)add(`${c.name}: ${metres(c.lengthMm)} м · ${c.method==='spiral'?'улитка':'двойная змейка'}. Подача ${metres(c.supplyTransit.lengthMm)}, рабочая часть ${metres(c.heating.lengthMm)}, обратка ${metres(c.returnTransit.lengthMm)} м.`);
      add('Проверены границы, исключения, непрерывность, пересечения, полные длины и геометрическое покрытие.');
      add(`Геометрический радиус: ${Number(state.circuitSettingsV32.radiusMm.toFixed(1))} мм. Найдено наименьшее число контуров среди проверенных вариантов; глобальный оптимум не доказан.`,'sheet-help');
      if(state.autoPlanV35)add(`Контроль покрытия: точки с интервалом не более ${state.autoPlanV35.coverage.pitchMm} мм; допуск ${Math.round(state.autoPlanV35.coverage.limitMm)} мм до оси трубы. Это геометрическая проверка, не теплотехнический расчёт.`,'sheet-help');
    }else add('Задайте примерную форму и размеры, выберите сетку 100, 150 или 200 мм и установите коллектор.');
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
        worker=new Worker('./auto-worker.js?v=350');
        timer=setTimeout(()=>done(null,new Error('SEARCH_LIMIT')),65000);
        worker.onmessage=({data})=>{if(data.progress)setStatus(`Проверяю ${data.progress.count} контур(а), подводы и длины…`,false,{kind:'progress'});else done(data.result);};
        worker.onerror=()=>done(null,new Error('CALCULATION_FAILED'));
        worker.postMessage({project:p,options:{wallOffsetMm:state.autoOffsetV35,timeBudgetMs:45000}});renderPlan();
      });
      if(request!==generation)return;
      if(key!==signature()){setStatus('Комната или параметры изменились. Нажмите «Создать» ещё раз.',true);return;}
      if(!result?.ok){setStatus(messages[result?.reason]||'Поиск не завершён. Повторите попытку.',true);return;}
      if(!WarmAuto.validate(p,result).ok)throw new Error('INVALID_PLAN');
      WarmV330.accept(result.multi);state.autoPlanV35=copy(result);savedKey=signature();state.routeComplete=true;
      setStatus(`Готово: ${resultText()}. Каждый контур — до 80 м. «Правка» позволяет изменить предложение.`);
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
  // Legacy material assumptions are kept only in the explicitly labelled legacy UI.
  const settings=el('settingsSheet').querySelector('.settings-grid'),legacy=document.createElement('details');legacy.className='auto-legacy-settings-v35';legacy.innerHTML='<summary>Параметры прежних схем 2.x</summary><div class="settings-grid"></div>';
  const keep=['mountingGridInput','pipeDiameterInput','mountingGridSummary','nameInput','objectInput'];
  [...settings.children].forEach(n=>{if(!keep.some(id=>n.id===id||n.querySelector('#'+id)))legacy.lastElementChild.append(n);});settings.after(legacy);
  const quick=document.createElement('button');quick.className='secondary-btn wide';quick.textContent='Автоматическая раскладка';quick.onclick=()=>{sync();openSheetV5('autoSheetV35');};settings.after(quick);
  const saveBase=serializeState;
  serializeState=function(){const raw=saveBase();raw.versionLabel='3.5.0';raw.autoOffsetV35=state.autoOffsetV35;if(state.autoPlanV35&&signature()===savedKey&&!raw.gridEditV34)raw.autoPlanV35=copy(state.autoPlanV35);return raw;};
  const loadBase=loadScheme;
  loadScheme=function(raw){cancel();state.autoPlanV35=null;savedKey='';state.autoOffsetV35=Number.isFinite(raw.autoOffsetV35)&&raw.autoOffsetV35>=0?raw.autoOffsetV35:100;loadBase(raw);
    if(raw.autoPlanV35&&!raw.gridEditV34){if(WarmAuto.validate(project(),raw.autoPlanV35).ok){WarmV330.accept(raw.autoPlanV35.multi);state.autoPlanV35=copy(raw.autoPlanV35);savedKey=signature();}else{state.multiPlanV33=null;state.routeComplete=false;setStatus('Сохранённая автоматическая схема не прошла проверку. Нажмите «Создать».',true);}}
    renderPlan();};
  const newBase=newScheme;
  newScheme=function(...args){cancel();state.autoPlanV35=null;savedKey='';state.autoOffsetV35=100;newBase(...args);sync();};
  document.title='Warm 3.5 · автоматическая раскладка';document.querySelector('.eyebrow').textContent='V3.5 · автоматическая раскладка';
  document.querySelector('#homeView .hero p').textContent='Форма комнаты, монтажная сетка и коллектор — Warm сам предложит контуры до 80 м с подводами.';
  globalThis.WarmV350={calculate,project,get plan(){return state.autoPlanV35;},get busy(){return !!worker;}};
  sync();
})();
