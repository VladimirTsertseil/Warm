importScripts('./engine-unified.js?v=2611-obstacle-hotfix','./editor-core.js?v=261-editor');
self.onmessage=({data})=>{
 try{
  const {operation,input,plan,locks,range}=data;
  const result=operation==='reconnect'?WarmEditorCore.reconnect(input,plan,locks):WarmEditorCore.bypass(input,plan,range.circuit,range.start,range.end,locks);
  self.postMessage(result);
 }catch{self.postMessage({ok:false,message:'Не удалось построить участок. Выберите другие точки.'});}
};
