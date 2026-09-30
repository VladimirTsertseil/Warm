importScripts('grid-core.js?v=360','engine-unified.js?v=360','spiral-core.js?v=360','circuit-core.js?v=360','auto-geometry.js?v=360','multi-core.js?v=360','auto-core.js?v=360');
onmessage=({data})=>{
  try {postMessage({result:WarmAuto.plan(data.project,data.options,p=>postMessage({progress:p}))});}
  catch(e){postMessage({result:{ok:false,reason:e.message}});}
};
