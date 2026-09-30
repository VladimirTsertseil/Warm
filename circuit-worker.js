importScripts('./grid-core.js?v=360', './engine-unified.js?v=360', './spiral-core.js?v=360', './circuit-core.js?v=360');
self.onmessage = ({data}) => {
  try {self.postMessage(WarmCircuit.plan(data.project, data.settings));}
  catch {self.postMessage({ok: false, status: 'ROUTE_IMPOSSIBLE', reason: 'CALCULATION_FAILED', circuits: []});}
};
