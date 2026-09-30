importScripts('./grid-core.js?v=340', './engine-unified.js?v=340', './spiral-core.js?v=340', './circuit-core.js?v=340', './multi-core.js?v=340', './grid-editor-core.js?v=340');
self.onmessage = ({data}) => {
  try {self.postMessage(WarmGridEditor.replan(data.project, data.draft, data.id, data.method));}
  catch {self.postMessage({ok: false, reason: 'CALCULATION_FAILED'});}
};
