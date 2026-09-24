importScripts('./engine-unified.js?v=270-gesture-router1');
self.onmessage=e=>{
  try{
    const result=self.WarmEngine.plan(e.data);
    // 2.7.1 compatibility envelope:
    // - app-v260.js expects { ok, result }
    // - top-level plan fields are kept too for direct consumers.
    self.postMessage({...result,result});
  }catch(err){
    self.postMessage({ok:false,error:err?.message||String(err)});
  }
};
