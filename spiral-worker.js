importScripts('./grid-core.js?v=360', './engine-unified.js?v=360', './spiral-core.js?v=360');
self.onmessage = ({data}) => {
  try { self.postMessage(WarmSpiral.plan(data.project, data.settings)); }
  catch { self.postMessage({ok: false, status: 'SPIRAL_IMPOSSIBLE', reason: 'CALCULATION_FAILED', circuits: []}); }
};
