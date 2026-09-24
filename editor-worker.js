importScripts('./engine-unified.js?v=2611-obstacle-hotfix','./editor-core.js?v=261-magnetic1');
self.onmessage=({data})=>{
 try{
  const {operation,input,plan,locks,range,guide}=data;
  const result=operation==='reconnect'?WarmEditorCore.reconnect(input,plan,locks):operation==='guided'?WarmEditorCore.guidedReplace(input,plan,range.circuit,range.start,range.end,guide||[],locks):WarmEditorCore.bypass(input,plan,range.circuit,range.start,range.end,locks);
  self.postMessage(result);
 }catch{self.postMessage({ok:false,message:'Не удалось построить участок. Выберите другие точки.'});}
};
