importScripts('./grid-core.js?v=501-release-20261001', './engine-unified.js?v=501-release-20261001', './spiral-core.js?v=501-release-20261001', './circuit-core.js?v=501-release-20261001', './auto-geometry.js?v=501-release-20261001', './multi-core.js?v=501-release-20261001', './grid-editor-core.js?v=501-release-20261001');
self.onmessage = ({data}) => {
  try {self.postMessage(WarmGridEditor.replan(data.project, data.draft, data.id, data.method));}
  catch {self.postMessage({ok: false, reason: 'CALCULATION_FAILED'});}
};
