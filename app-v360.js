/* Orthogonal room drawing. The existing obstacle editor is unchanged. */
(()=>{
  'use strict';
  const C=WarmRoomDraw,$=id=>document.getElementById(id),copy=x=>structuredClone(x),metres=n=>(n/1000).toFixed(2).replace('.',',');
  const DRAW_GRID_MM=100; // internal drawing snap only; not a user setting
  let points=[],preview=null,closed=false,active=false,pan=false,down=null,multiTouch=false;
  const pointers=new Set();let camera={x:-1000,y:-1000,scale:.08},size={w:800,h:600},direction={x:1,y:0};
  const overlay=document.createElement('section');overlay.id='roomDrawV36';overlay.className='room-draw-v36';overlay.hidden=true;overlay.setAttribute('aria-label','Рисование помещения');
  overlay.innerHTML=`<header class="room-draw-head"><button id="roomCancelV36" aria-label="Отменить рисование">×</button><div><strong>Нарисуйте помещение</strong><small>Точка за точкой, вдоль стен</small></div><button id="roomUndoV36" aria-label="Отменить точку">↶</button></header>
    <div class="room-draw-canvas"><svg id="roomCanvasV36" xmlns="http://www.w3.org/2000/svg" aria-label="Поле построения стен"></svg><div class="room-draw-zoom"><button id="roomPanV36" aria-label="Перемещать поле" title="Перемещать поле">✥</button><button id="roomFitV36" aria-label="Показать весь контур">⌗</button><button id="roomMinusV36" aria-label="Уменьшить">−</button><button id="roomPlusV36" aria-label="Увеличить">+</button></div></div>
    <footer class="room-draw-footer"><div id="roomMeasureV36" class="room-draw-measure"><label for="roomLengthV36">Длина, м</label><input id="roomLengthV36" type="text" inputmode="decimal" autocomplete="off" aria-label="Точная длина стены в метрах" placeholder="0,00"><button id="roomLengthApplyV36">Задать</button><button id="roomDirectionV36" aria-label="Повернуть направление следующей стены">Направление →</button></div><div id="roomMessageV36" class="room-draw-message" role="status" aria-live="polite"></div><div class="room-draw-actions"><button id="roomCloseV36">Замкнуть</button><button id="roomFinishV36" class="primary-btn">Помещение готово</button></div></footer>`;
  document.body.append(overlay);const svg=$('roomCanvasV36');
  function message(text,error=false){$('roomMessageV36').textContent=text;$('roomMessageV36').classList.toggle('error',error);}
  const screen=p=>({x:(p.x-camera.x)*camera.scale,y:(p.y-camera.y)*camera.scale});
  function world(e){const r=svg.getBoundingClientRect();return{x:camera.x+(e.clientX-r.left)/camera.scale,y:camera.y+(e.clientY-r.top)/camera.scale};}
  function fit(){
    const p=points.length?points:[{x:0,y:0},{x:5000,y:4000}],xs=p.map(q=>q.x),ys=p.map(q=>q.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(3000,Math.max(...xs)-x),h=Math.max(2500,Math.max(...ys)-y);
    camera.scale=Math.max(.008,Math.min(.8,(size.w-90)/w,(size.h-140)/h));camera.x=x-(size.w/camera.scale-w)/2;camera.y=y-(size.h/camera.scale-h)/2;render();
  }
  function line(a,b,color,width=2,dash=''){return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${width}"${dash?` stroke-dasharray="${dash}"`:''}/>`;}
  function label(p,text,color='#284a5c',id=''){
    const w=Math.max(70,text.length*7+16),x=Math.max(w/2+4,Math.min(size.w-w/2-4,p.x)),y=Math.max(24,Math.min(size.h-64,p.y));
    return `<g ${id?`id="${id}" role="button" aria-label="Ввести точную длину" style="cursor:pointer"`:''}><rect x="${x-w/2}" y="${y-19}" width="${w}" height="28" rx="9" fill="white" stroke="${color}"/><text x="${x}" y="${y}" font-size="12" font-family="system-ui,sans-serif" font-weight="600" fill="${color}" text-anchor="middle">${text}</text></g>`;
  }
  function render(){
    if(!active)return;const r=svg.getBoundingClientRect();size={w:r.width||800,h:r.height||600};svg.setAttribute('viewBox',`0 0 ${size.w} ${size.h}`);
    const step=DRAW_GRID_MM,spacing=step*camera.scale,major=Math.max(step,500)*camera.scale;
    let out=`<defs><pattern id="roomFineGrid" width="${spacing}" height="${spacing}" x="${(-camera.x*camera.scale)%spacing}" y="${(-camera.y*camera.scale)%spacing}" patternUnits="userSpaceOnUse"><path d="M ${spacing} 0 L 0 0 0 ${spacing}" fill="none" stroke="#e2e9ee" stroke-width=".7"/></pattern><pattern id="roomMajorGrid" width="${major}" height="${major}" x="${(-camera.x*camera.scale)%major}" y="${(-camera.y*camera.scale)%major}" patternUnits="userSpaceOnUse"><path d="M ${major} 0 L 0 0 0 ${major}" fill="none" stroke="#c6d5df" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="#f4f7fa"/>`;
    if(spacing>=4)out+='<rect width="100%" height="100%" fill="url(#roomFineGrid)"/>';
    out+='<rect width="100%" height="100%" fill="url(#roomMajorGrid)"/>';
    const ps=points.map(screen);
    if(closed)out+=`<polygon points="${ps.map(p=>p.x+','+p.y).join(' ')}" fill="#16756819"/>`;
    for(let i=0;i<ps.length-(closed?0:1);i++){const a=ps[i],b=ps[(i+1)%ps.length];out+=line(a,b,'#225264',3);if(Math.hypot(b.x-a.x,b.y-a.y)>62)out+=label({x:(a.x+b.x)/2+(a.x===b.x?40:0),y:(a.y+b.y)/2-(a.y===b.y?12:0)},metres(C.length(points[i],points[(i+1)%points.length]))+' м');}
    let check=null;
    if(preview&&!closed){
      const q=screen(preview);check=points.length?C.candidate(points,preview):{ok:true};
      const color=check.ok?'#117c6e':'#c13528';
      for(const p of points){if(preview.x===p.x)out+=line({x:q.x,y:0},{x:q.x,y:size.h},'#8ca6b5',1,'3 6');if(preview.y===p.y)out+=line({x:0,y:q.y},{x:size.w,y:q.y},'#8ca6b5',1,'3 6');}
      if(points.length){out+=`<g id="roomPreviewV36">${line(ps.at(-1),q,color,2,'7 5')}</g>`;out+=label({x:(ps.at(-1).x+q.x)/2,y:(ps.at(-1).y+q.y)/2-35},check.closes?'Замкнуть':metres(C.length(points.at(-1),preview))+' м ✎',color,'roomLiveLengthV36');}
      out+=`<circle cx="${q.x}" cy="${q.y}" r="7" fill="white" stroke="${color}" stroke-width="2"/>`;
    }
    ps.forEach((p,i)=>{out+=`<circle cx="${p.x}" cy="${p.y}" r="${i===0?8:4}" fill="${i===0?'#117c6e':'white'}" stroke="${i===0&&check?.closes?'#35b39d':'#225264'}" stroke-width="${i===0&&check?.closes?5:2}"/>`;});
    out+=line({x:18,y:size.h-24},{x:18+500*camera.scale,y:size.h-24},'#546878',2)+`<text x="18" y="${size.h-33}" font-size="11" fill="#546878">50 см</text>`;
    svg.innerHTML=out;
    $('roomUndoV36').disabled=!points.length;$('roomFinishV36').disabled=!closed;$('roomCloseV36').disabled=closed||points.length<4;
    $('roomMeasureV36').hidden=closed;$('roomLengthV36').disabled=!points.length;$('roomLengthApplyV36').disabled=!points.length;$('roomDirectionV36').disabled=!points.length;
    if(document.activeElement!==$('roomLengthV36'))$('roomLengthV36').value=preview&&points.length?metres(C.length(points.at(-1),preview)):'';
    $('roomDirectionV36').textContent='Направление '+(direction.x===1?'→':direction.y===1?'↓':direction.x===-1?'←':'↑');
    if(closed){const v=C.validate(points);message(`Площадь ${(v.areaMm2/1e6).toFixed(2).replace('.',',')} м² · ${points.length} углов`);}
  }
  function updatePreview(raw){
    preview=C.snap(points,raw,DRAW_GRID_MM,Math.min(150,12/camera.scale));
    if(points.length&&!C.equal(preview,points.at(-1))){const a=points.at(-1);direction={x:Math.sign(preview.x-a.x),y:Math.sign(preview.y-a.y)};}
    render();
  }
  function accept(q){
    if(closed)return;
    if(!points.length){points.push(q);preview=null;message('Ведите указатель и нажмите. На телефоне можно вести палец и отпустить.');render();return;}
    const check=C.candidate(points,q);if(!check.ok){message(check.error,true);render();return;}
    if(check.closes){closed=true;preview=null;}else{points.push({...q});preview=null;message('Добавьте следующую стену или вернитесь к начальной точке.');}
    render();
  }
  function undo(){if(closed)closed=false;else points.pop();preview=null;message('Последнее действие отменено.');render();}
  function close(){if(points.length<4)return;const check=C.candidate(points,points[0]);if(!check.ok){message('Для замыкания последняя точка должна быть на одной горизонтали или вертикали с первой, без пересечений.',true);return;}closed=true;preview=null;render();}
  function hide(){active=false;down=null;pointers.clear();overlay.hidden=true;document.body.classList.remove('room-drawing-v36');$('shapeToolBtn').focus();}
  function start(edit=false){
    closeSheetV5();points=edit&&state.shapeParams?.v36?copy(state.shapeParams.points):[];closed=!!points.length;preview=null;pan=false;down=null;active=true;overlay.hidden=false;document.body.classList.add('room-drawing-v36');$('roomPanV36').classList.remove('active');svg.classList.remove('panning');
    message('Размеры в метрах.');
    $('roomMeasureV36').hidden=closed;render();fit();$('roomCancelV36').focus();
  }
  function finish(){
    if(!closed)return;const result=C.build(points);if(!result.ok){message(result.error,true);return;}
    pushHistoryV5();WarmV340.clearForAutomatic();if(WarmEditor.active)manualExitV2A();
    state.sections=result.sections;state.shapeType='custom';state.shapeOrientation=0;state.shapeAxes=null;state.shapeParams={v36:true,points:result.points};state.roomAdded?.clear();state.roomRemoved?.clear();
    state.editorDraft=null;resetRoute();recomputeGeometry();syncExcludedFromObstaclesV6();syncInputs();syncShapeUiV5();hide();setModeV6('inspect');fitPlan(false);renderPlan();
    setStatus(`Помещение готово: ${(result.areaMm2/1e6).toFixed(2).replace('.',',')} м². Установите коллектор и нажмите «Создать».`);
  }
  svg.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    if(e.target.closest('#roomLiveLengthV36')){e.preventDefault();$('roomLengthV36').focus();$('roomLengthV36').select();return;}
    e.preventDefault();pointers.add(e.pointerId);if(pointers.size>1){multiTouch=true;down=null;return;}
    down={id:e.pointerId,x:e.clientX,y:e.clientY,camera:{...camera}};svg.setPointerCapture(e.pointerId);if(!pan&&!closed)updatePreview(world(e));
  });
  svg.addEventListener('pointermove',e=>{
    if(multiTouch)return;
    if(e.target.closest('#roomLiveLengthV36')&&!down)return;
    if(pan){if(down&&down.id===e.pointerId){camera.x=down.camera.x-(e.clientX-down.x)/camera.scale;camera.y=down.camera.y-(e.clientY-down.y)/camera.scale;render();}return;}
    if(!closed&&(e.pointerType==='mouse'||down?.id===e.pointerId))updatePreview(world(e));
  });
  svg.addEventListener('pointerup',e=>{
    pointers.delete(e.pointerId);if(multiTouch){if(!pointers.size)multiTouch=false;down=null;return;}
    if(down?.id!==e.pointerId)return;const wasPan=pan;down=null;try{svg.releasePointerCapture(e.pointerId);}catch{}
    if(!wasPan&&!closed){updatePreview(world(e));accept(preview);}
  });
  svg.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);down=null;preview=null;if(!pointers.size)multiTouch=false;render();});
  function zoom(f){const c={x:camera.x+size.w/2/camera.scale,y:camera.y+size.h/2/camera.scale};camera.scale=Math.max(.008,Math.min(1,camera.scale*f));camera.x=c.x-size.w/2/camera.scale;camera.y=c.y-size.h/2/camera.scale;render();}
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15);},{passive:false});
  $('roomPlusV36').onclick=()=>zoom(1.3);$('roomMinusV36').onclick=()=>zoom(1/1.3);$('roomFitV36').onclick=fit;
  $('roomPanV36').onclick=()=>{pan=!pan;preview=null;$('roomPanV36').classList.toggle('active',pan);$('roomPanV36').setAttribute('aria-pressed',String(pan));svg.classList.toggle('panning',pan);render();};
  $('roomUndoV36').onclick=undo;$('roomCancelV36').onclick=hide;$('roomCloseV36').onclick=close;$('roomFinishV36').onclick=finish;
  $('roomDirectionV36').onclick=()=>{direction={x:-direction.y,y:direction.x};if(points.length){const a=points.at(-1),n=preview?C.length(a,preview):1000;preview={x:a.x+direction.x*n,y:a.y+direction.y*n};}render();};
  function exact(){const n=Number($('roomLengthV36').value.replace(',','.'))*1000;if(!Number.isFinite(n)||n<100||n>30000){message('Введите длину от 0,10 до 30,00 м.',true);return;}const a=points.at(-1);if(!a)return;const mm=Math.round(n);preview={x:a.x+direction.x*mm,y:a.y+direction.y*mm};accept(preview);}
  $('roomLengthApplyV36').onclick=exact;$('roomLengthV36').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();exact();}});
  overlay.addEventListener('keydown',e=>{if(e.target.matches('input,select'))return;if(e.key==='Escape'){e.preventDefault();hide();}if(e.key==='Backspace'||e.key==='Delete'||e.key==='z'&&(e.ctrlKey||e.metaKey)){e.preventDefault();undo();}});
  new ResizeObserver(()=>{if(active)render();}).observe(svg);
  const sheet=$('shapeSheet'),choice=document.createElement('div');choice.className='room-choice-v36 room-setup-v36';
  choice.innerHTML=`<div class="room-setup-field-v36"><span>Диаметр трубы</span><div class="room-setup-chips-v36" role="group" aria-label="Диаметр трубы"><button type="button" data-room-pipe-v36="16">16 мм</button><button type="button" data-room-pipe-v36="17">17 мм</button><button type="button" data-room-pipe-v36="20">20 мм</button></div></div>
    <div class="room-setup-field-v36"><span>Шаг сетки</span><div class="room-setup-chips-v36" role="group" aria-label="Шаг сетки"><button type="button" data-room-grid-v36="100">100 мм</button><button type="button" data-room-grid-v36="150">150 мм</button><button type="button" data-room-grid-v36="200">200 мм</button></div></div>
    <label class="room-setup-field-v36 room-setup-limit-v36"><span>Макс. длина контура</span><div><input id="roomMaxCircuitV36" type="number" min="20" step="5" inputmode="numeric"><b>м</b></div></label>
    <label class="room-setup-toggle-v36"><input id="roomPairedLeadsV36" type="checkbox"><span><b>Подача и обратка рядом</b><small>Подводы одного контура прокладываются компактной парой</small></span></label>
    <button id="roomStartV36" class="primary-btn room-start-single-v36">Нарисовать помещение</button>`;
  const head=sheet.querySelector('.sheet-head');head.after(choice);head.querySelector('strong').textContent='Новая схема';const sub=head.querySelector('span');if(sub){sub.textContent='';sub.hidden=true;}
  for(const selector of ['#legacyShapeNoticeV24','.shape-base-grid-v24','.corner-editor-v24','.shape-actions-v24']){const n=sheet.querySelector(selector);if(n)n.hidden=true;}
  function setupSyncV36(){
    const pipe=Number(state.pipeDiameterMm)||16,grid=Number(state.mountingGridV3?.cellSizeMm)||150,max=Math.max(20,Number(state.maxCircuitLengthM)||80);
    choice.querySelectorAll('[data-room-pipe-v36]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.roomPipeV36)===pipe));
    choice.querySelectorAll('[data-room-grid-v36]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.roomGridV36)===grid));
    choice.dataset.pipe=String(pipe);choice.dataset.grid=String(grid);$('roomMaxCircuitV36').value=String(max);
    if($('roomPairedLeadsV36'))$('roomPairedLeadsV36').checked=state.pairedLeadsV35===true;
    $('roomStartV36').textContent=state.shapeParams?.v36?'Редактировать помещение':'Нарисовать помещение';
  }
  function setupSelectV36(selector,key){
    choice.querySelectorAll(selector).forEach(b=>b.onclick=()=>{
      choice.dataset[key]=b.dataset[key==='pipe'?'roomPipeV36':'roomGridV36'];
      choice.querySelectorAll(selector).forEach(x=>x.classList.toggle('selected',x===b));
    });
  }
  setupSelectV36('[data-room-pipe-v36]','pipe');setupSelectV36('[data-room-grid-v36]','grid');
  function applySetupV36(){
    const pipe=Number(choice.dataset.pipe)||16,grid=Number(choice.dataset.grid)||150,max=Math.max(20,Number($('roomMaxCircuitV36').value)||80);
    const pipeInput=$('pipeDiameterInput'),gridInput=$('mountingGridInput'),maxInput=$('maxCircuitLengthInput');
    if(pipeInput&&Number(pipeInput.value)!==pipe){pipeInput.value=String(pipe);pipeInput.dispatchEvent(new Event('change',{bubbles:true}));}
    if(gridInput&&Number(gridInput.value)!==grid){gridInput.value=String(grid);gridInput.dispatchEvent(new Event('change',{bubbles:true}));}
    state.maxCircuitLengthM=max;
    if(maxInput){maxInput.value=String(max);maxInput.dispatchEvent(new Event('change',{bubbles:true}));}
    state.pairedLeadsV35=$('roomPairedLeadsV36')?.checked===true;
  }
  if($('roomPairedLeadsV36'))$('roomPairedLeadsV36').onchange=()=>{
    const next=$('roomPairedLeadsV36').checked===true;
    if(next===!!state.pairedLeadsV35)return;
    state.pairedLeadsV35=next;
    resetRoute();
    renderPlan();
    if(state.sections?.length)setStatus(next?'Подача и обратка одного контура будут проложены рядом. Нажмите «Создать».':'Подача и обратка будут проложены раздельно. Нажмите «Создать».');
  };
  $('roomStartV36').onclick=()=>{applySetupV36();start(!!state.shapeParams?.v36);};
  const openBase=openSheetV5;openSheetV5=function(id){if(active&&id==='shapeSheet')return;if(id==='shapeSheet')setupSyncV36();return openBase(id);};
  const renderBase=renderPlan;renderPlan=function(...args){
    // A new project has no invented 4 × 3 m room. Until the user draws one,
    // keep the workspace genuinely empty and only show the creation sheet.
    if(!state.sections?.length){
      if(planSvg){
        planSvg.innerHTML='';
        planSvg.setAttribute('viewBox','0 0 1000 700');
        planSvg.setAttribute('width','100%');
        planSvg.setAttribute('height','100%');
        planSvg.style.width='100%';
        planSvg.style.height='100%';
      }
      if($('gridInfo'))$('gridInfo').textContent='Помещение не задано';
      if($('routeInfo'))$('routeInfo').textContent='Сначала нарисуйте помещение';
      return;
    }
    renderBase(...args);
    // Keep the header compact: room dimensions only; the selected laying pitch
    // is configured at scheme creation and does not need to occupy the canvas header.
    if($('gridInfo'))$('gridInfo').textContent=$('gridInfo').textContent.replace(/\s*·\s*шаг.*$/i,'');
    if(state.shapeParams?.v36&&state.mode==='shape6'){
      planSvg.querySelectorAll('[data-v6-room-handle],[data-v6-section-id],.edit-handle.room').forEach(n=>n.remove());
    }
  };
  // Dimension taps for a drawn room reopen its contour instead of resizing its decomposition.
  document.addEventListener('pointerdown',e=>{if(!active&&state.shapeParams?.v36&&state.mode==='shape6'&&e.target.closest('#planSvg [data-v6-dim]')){e.preventDefault();e.stopImmediatePropagation();start(true);}},true);
  const loadBase=loadScheme;loadScheme=function(raw){if(active)hide();return loadBase(raw);};
  const rotateBase=rotatePlanV6;rotatePlanV6=function(){const drawn=state.shapeParams?.v36?copy(state.shapeParams.points):null,b={...state.bounds};rotateBase();if(drawn){state.shapeParams={v36:true,points:drawn.map(p=>rotatePointCWCustomV6(p,b))};renderPlan();}};
  const newBase=newScheme;newScheme=function(...args){
    if(active)hide();
    const result=newBase(...args);
    // Older layers create a default 4 × 3 m rectangle for compatibility.
    // Remove it immediately: geometry appears only after explicit drawing.
    state.sections=[];
    state.shapeType='custom';
    state.shapeAxes=null;
    state.shapeParams={};
    state.obstacles=[];
    state.selectedObstacleId=null;
    state.excluded=new Set();
    state.roomAdded=new Set();
    state.roomRemoved=new Set();
    state.supply=null;
    state.returnPoint=null;
    state.maxCircuitLengthM=80;
    if($('maxCircuitLengthInput'))$('maxCircuitLengthInput').value='80';
    resetRoute();
    recomputeGeometry();
    renderPlan();
    setTimeout(()=>{if(!active&&!state.sections.length)openSheetV5('shapeSheet');},0);
    return result;
  };
  const saveBase=serializeState;serializeState=function(){const r=saveBase();r.versionLabel='3.6.0';return r;};
  document.title='Warm 3.6 · рисование помещений';document.querySelector('.eyebrow')?.replaceChildren(document.createTextNode('V3.6 · рисование помещений'));document.querySelector('#homeView .hero p')?.replaceChildren(document.createTextNode('Задайте параметры, нарисуйте помещение и укажите коллектор.'));
  setupSyncV36();

  // UI 018: the simplified home page may omit legacy home controls.
  // Bind the one visible creation button after all newScheme wrappers are installed,
  // so it always starts the final V3.6 creation flow.
  const homeCreateV36=$('createFirstBtn');
  if(homeCreateV36){
    const freshHomeCreateV36=homeCreateV36.cloneNode(true);
    homeCreateV36.replaceWith(freshHomeCreateV36);
    freshHomeCreateV36.addEventListener('click',()=>newScheme());
  }

  globalThis.WarmV360={start,get active(){return active;},get points(){return copy(points);},get closed(){return closed;},get camera(){return{...camera};}};
})();
