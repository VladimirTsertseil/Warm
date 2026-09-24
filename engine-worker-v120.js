importScripts('./engine-unified.js?v=270-gesture-router1');
self.onmessage=e=>{try{self.postMessage(WarmEngine.plan(e.data));}catch(error){self.postMessage({ok:false,error:'worker-error',message:error?.message||String(error)})}};
