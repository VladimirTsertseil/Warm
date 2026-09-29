importScripts('./grid-core.js?v=310-recovery1', './engine-unified.js?v=310-recovery1', './spiral-core.js?v=310-recovery1');
self.onmessage = ({data}) => {
  try { self.postMessage(WarmSpiral.plan(data.project, data.settings)); }
  catch { self.postMessage({ok: false, status: 'SPIRAL_IMPOSSIBLE', reason: 'CALCULATION_FAILED', circuits: []}); }
};
