importScripts('./grid-core.js?v=350', './engine-unified.js?v=350', './spiral-core.js?v=350');
self.onmessage = ({data}) => {
  try { self.postMessage(WarmSpiral.plan(data.project, data.settings)); }
  catch { self.postMessage({ok: false, status: 'SPIRAL_IMPOSSIBLE', reason: 'CALCULATION_FAILED', circuits: []}); }
};
