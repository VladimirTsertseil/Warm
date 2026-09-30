importScripts('./grid-core.js?v=360', './engine-unified.js?v=360', './spiral-core.js?v=360', './circuit-core.js?v=360', './auto-geometry.js?v=360', './multi-core.js?v=360');
self.onmessage = ({data}) => {
  try {self.postMessage({result: WarmMulti.plan(data.project, data.settings, data.definitions, progress => self.postMessage({progress}))});}
  catch {self.postMessage({result: {ok: false, reason: 'CALCULATION_FAILED', circuits: []}});}
};
