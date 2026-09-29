importScripts('./grid-core.js?v=320', './engine-unified.js?v=320', './spiral-core.js?v=320', './circuit-core.js?v=320');
self.onmessage = ({data}) => {
  try {self.postMessage(WarmCircuit.plan(data.project, data.settings));}
  catch {self.postMessage({ok: false, status: 'ROUTE_IMPOSSIBLE', reason: 'CALCULATION_FAILED', circuits: []});}
};
