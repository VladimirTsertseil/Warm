importScripts('grid-core.js?v=350','engine-unified.js?v=350','spiral-core.js?v=350','circuit-core.js?v=350','auto-geometry.js?v=350','multi-core.js?v=350','auto-core.js?v=350');
onmessage=({data})=>{
  try {postMessage({result:WarmAuto.plan(data.project,data.options,p=>postMessage({progress:p}))});}
  catch(e){postMessage({result:{ok:false,reason:e.message}});}
};
