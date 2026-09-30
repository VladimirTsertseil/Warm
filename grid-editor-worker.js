importScripts('./grid-core.js?v=360', './engine-unified.js?v=360', './spiral-core.js?v=360', './circuit-core.js?v=360', './auto-geometry.js?v=360', './multi-core.js?v=360', './grid-editor-core.js?v=360');
self.onmessage = ({data}) => {
  try {self.postMessage(WarmGridEditor.replan(data.project, data.draft, data.id, data.method));}
  catch {self.postMessage({ok: false, reason: 'CALCULATION_FAILED'});}
};
