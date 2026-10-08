(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./grid/rect-geometry.js'):root.WarmRectGeometry,typeof module==='object'&&module.exports?require('./project.js'):root.WarmProject);if(typeof module==='object'&&module.exports)module.exports=api;else root.WarmGeometry=api;})(typeof globalThis!=='undefined'?globalThis:this,function(E,P){
'use strict';
function engineInput(raw,overrides={}){const p=P.create(raw);return{sections:p.room.sections,obstacles:[...p.room.removedAreas,...p.exclusions.areas],supply:p.collector.supply,returnPoint:p.collector.returnPoint,pipeStepMm:p.grid.cellSizeMm,pipeDiameterMm:p.pipe.diameterMm,wallOffsetMm:p.settings.wallOffsetMm,minBendRadiusMm:p.settings.bendRadiusMm,maxCircuitLengthMm:p.settings.maxCircuitLengthMm,pattern:p.settings.pattern,...overrides};}
function physicalSpace(raw){return E.freeSpace({...engineInput(raw),wallOffsetMm:0,pipeDiameterMm:0});}
function workingSpace(raw){return E.freeSpace({...engineInput(raw),pipeDiameterMm:0});}
function area(space){return (space?.rects||[]).reduce((n,r)=>n+r.width*r.height,0);}
return{engineInput,physicalSpace,workingSpace,area};
});
