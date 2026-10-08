(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WarmProject=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const CELLS=[100,150,200],DIAMETERS=[16,17,20];
const copy=x=>structuredClone(x);
function number(v,name,{min=-Infinity,max=Infinity,positive=false}={}){v=Number(v);if(!Number.isFinite(v)||(positive?v<=0:v<min)||v>max)throw new Error('INVALID_'+name.toUpperCase());return v;}
function point(p,name='POINT',optional=false){if(p==null&&optional)return null;if(!p||!Number.isFinite(Number(p.x))||!Number.isFinite(Number(p.y)))throw new Error('INVALID_'+name);const q={x:Number(p.x),y:Number(p.y)};if(p.side!=null)q.side=String(p.side);return q;}
function rect(r){if(!r)throw new Error('INVALID_RECT');const q={x:number(r.x,'RECT_X'),y:number(r.y,'RECT_Y'),width:number(r.width,'RECT_WIDTH',{positive:true}),height:number(r.height,'RECT_HEIGHT',{positive:true})};return q;}
function sortRects(rs){return rs.map(rect).sort((a,b)=>a.x-b.x||a.y-b.y||a.width-b.width||a.height-b.height);}
function create(raw={}){
 const cellSizeMm=Number(raw.grid?.cellSizeMm??150),diameterMm=Number(raw.pipe?.diameterMm??16);
 if(!CELLS.includes(cellSizeMm))throw new Error('INVALID_GRID');if(!DIAMETERS.includes(diameterMm))throw new Error('INVALID_PIPE_DIAMETER');
 const sections=sortRects(raw.room?.sections||[]);if(!sections.length)throw new Error('ROOM_REQUIRED');
 const p={schemaVersion:5,units:'mm',room:{sections,removedAreas:sortRects(raw.room?.removedAreas||[])},exclusions:{areas:sortRects(raw.exclusions?.areas||[])},grid:{cellSizeMm,origin:point(raw.grid?.origin||{x:0,y:0},'GRID_ORIGIN')},pipe:{diameterMm},collector:{supply:point(raw.collector?.supply,'SUPPLY',true),returnPoint:point(raw.collector?.returnPoint,'RETURN',true)},settings:{
   wallOffsetMm:number(raw.settings?.wallOffsetMm??100,'WALL_OFFSET',{min:0,max:5000}),
   bendRadiusMm:number(raw.settings?.bendRadiusMm??Math.min(cellSizeMm/2,50),'BEND_RADIUS',{positive:true,max:5000}),
   maxCircuitLengthMm:number(raw.settings?.maxCircuitLengthMm??80000,'MAX_CIRCUIT_LENGTH',{positive:true}),
   pattern:String(raw.settings?.pattern??'auto')
 }};
 if(!['auto','spiral','double-snake','snake','adaptive'].includes(p.settings.pattern))throw new Error('INVALID_PATTERN');
 if(raw.collector?.portPairs) p.collector.portPairs=copy(raw.collector.portPairs);
 return p;
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function signature(raw){return JSON.stringify(canonical(create(raw)));}
return{CELLS,DIAMETERS,create,signature,canonical};
});
