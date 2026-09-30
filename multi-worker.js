importScripts('./grid-core.js?v=340', './engine-unified.js?v=340', './spiral-core.js?v=340', './circuit-core.js?v=340', './multi-core.js?v=340');
self.onmessage = ({data}) => {
  try {self.postMessage({result: WarmMulti.plan(data.project, data.settings, data.definitions, progress => self.postMessage({progress}))});}
  catch {self.postMessage({result: {ok: false, reason: 'CALCULATION_FAILED', circuits: []}});}
};
