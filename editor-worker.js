importScripts('./engine-unified.js?v=280-base1','./editor-core.js?v=290-points1');
self.onmessage=({data})=>{
 try{
  const {operation,input,plan,locks,range,guide,mode,pin}=data;
  const result=operation==='reconnect'
   ? WarmEditorCore.reconnect(input,plan,locks)
   : operation==='guided'
    ? WarmEditorCore.guidedReplace(input,plan,range.circuit,range.start,range.end,guide||[],locks,{mode,pin})
    : WarmEditorCore.bypass(input,plan,range.circuit,range.start,range.end,locks);
  self.postMessage(result);
 }catch{self.postMessage({ok:false,message:'Не удалось построить участок. Выберите другие точки.'});}
};
