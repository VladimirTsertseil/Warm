importScripts('./grid-core.js?v=501-release-20261001', './engine-unified.js?v=501-release-20261001', './spiral-core.js?v=501-release-20261001', './circuit-core.js?v=501-release-20261001', './auto-geometry.js?v=501-release-20261001', './multi-core.js?v=501-release-20261001');
self.onmessage = ({data}) => {
  try {self.postMessage({result: WarmMulti.plan(data.project, data.settings, data.definitions, progress => self.postMessage({progress}))});}
  catch {self.postMessage({result: {ok: false, reason: 'CALCULATION_FAILED', circuits: []}});}
};
