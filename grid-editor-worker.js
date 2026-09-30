importScripts('./grid-core.js?v=350', './engine-unified.js?v=350', './spiral-core.js?v=350', './circuit-core.js?v=350', './auto-geometry.js?v=350', './multi-core.js?v=350', './grid-editor-core.js?v=350');
self.onmessage = ({data}) => {
  try {self.postMessage(WarmGridEditor.replan(data.project, data.draft, data.id, data.method));}
  catch {self.postMessage({ok: false, reason: 'CALCULATION_FAILED'});}
};
