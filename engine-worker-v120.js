importScripts('./engine-unified.js?v=2611-obstacle-hotfix');
self.onmessage=e=>{try{const result=self.WarmEngine.plan(e.data);self.postMessage({ok:true,result});}catch(err){self.postMessage({ok:false,error:err?.message||String(err)});}};

