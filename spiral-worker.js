importScripts('./grid-core.js?v=340', './engine-unified.js?v=340', './spiral-core.js?v=340');
self.onmessage = ({data}) => {
  try { self.postMessage(WarmSpiral.plan(data.project, data.settings)); }
  catch { self.postMessage({ok: false, status: 'SPIRAL_IMPOSSIBLE', reason: 'CALCULATION_FAILED', circuits: []}); }
};
