importScripts('./grid-core.js?v=350', './engine-unified.js?v=350', './spiral-core.js?v=350', './circuit-core.js?v=350', './auto-geometry.js?v=350', './multi-core.js?v=350');
self.onmessage = ({data}) => {
  try {self.postMessage({result: WarmMulti.plan(data.project, data.settings, data.definitions, progress => self.postMessage({progress}))});}
  catch {self.postMessage({result: {ok: false, reason: 'CALCULATION_FAILED', circuits: []}});}
};
