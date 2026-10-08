/* Geometric coverage of the complete pipe, including the collector leads.
   This is a spatial check, not a heat-output or pipe-material certification. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grid-core.js'), require('./spiral-core.js'), require('./engine-unified.js'));
  else root.WarmAutoGeometry = factory(root.WarmGrid, root.WarmSpiral, root.WarmEngine);
})(globalThis, function(G, S, Geo) {
  'use strict';
  const EPS = 1e-5;
  function distance(p, s) {
    const d = q => Math.hypot(p.x - q.x, p.y - q.y);
    if (s.type === 'straight') {
      const x = s.to.x - s.from.x, y = s.to.y - s.from.y;
      const t = Math.max(0, Math.min(1, ((p.x - s.from.x) * x + (p.y - s.from.y) * y) / (x*x+y*y)));
      return d({x:s.from.x+x*t,y:s.from.y+y*t});
    }
    let a = (Math.atan2(p.y-s.center.y,p.x-s.center.x)-s.startAngle) % (2*Math.PI);
    if (s.sweepAngle > 0 && a < -EPS) a += 2*Math.PI;
    if (s.sweepAngle < 0 && a > EPS) a -= 2*Math.PI;
    return a/s.sweepAngle >= 0 && a/s.sweepAngle <= 1 ? Math.abs(d(s.center)-s.radiusMm) : Math.min(d(s.from),d(s.to));
  }
  function coverage(project, settings, circuits) {
    // Match the inherited one-cell neighbourhood, including a cell diagonal.
    // Report the actual threshold; this does not imply a thermal coverage norm.
    const step = project.grid.cellSizeMm, limit = Math.SQRT2*step+(Math.SQRT2-1)*settings.radiusMm, pitch = step/2;
    const space = Geo.freeSpace({sections:project.room.sections, obstacles:[...project.room.removedAreas,...project.exclusions.areas], wallOffsetMm:settings.wallOffsetMm, pipeDiameterMm:0});
    const bins = new Map(), segments = circuits.flatMap(c=>c.segments);
    for (const s of segments) {
      const ps = [s.from,s.to]; if (s.type==='curve') ps.push({x:s.center.x-s.radiusMm,y:s.center.y-s.radiusMm},{x:s.center.x+s.radiusMm,y:s.center.y+s.radiusMm});
      const loX=Math.floor((Math.min(...ps.map(p=>p.x))-limit)/step), hiX=Math.floor((Math.max(...ps.map(p=>p.x))+limit)/step);
      const loY=Math.floor((Math.min(...ps.map(p=>p.y))-limit)/step), hiY=Math.floor((Math.max(...ps.map(p=>p.y))+limit)/step);
      for(let x=loX;x<=hiX;x++) for(let y=loY;y<=hiY;y++) {const k=x+','+y;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(s);}
    }
    let tested=0, missed=0, maxDistanceMm=0;
    const gaps=[];
    for(const r of space.rects) {
      const nx=Math.max(1,Math.ceil(r.width/pitch)),ny=Math.max(1,Math.ceil(r.height/pitch));
      for(let i=0;i<=nx;i++) for(let j=0;j<=ny;j++) {
        const p={x:r.x+r.width*i/nx,y:r.y+r.height*j/ny};
        const near=bins.get(Math.floor(p.x/step)+','+Math.floor(p.y/step))||[];
        let d=Infinity;for(const s of near)d=Math.min(d,distance(p,s));
        tested++;if(d>limit+EPS){missed++;if(gaps.length<8)gaps.push(p);} maxDistanceMm=Math.max(maxDistanceMm,d);
      }
    }
    return {ok:tested>0 && missed===0, tested, missed, pitchMm:pitch, limitMm:limit, maxDistanceMm:Number.isFinite(maxDistanceMm)?maxDistanceMm:null, gaps,
      workingAreaMm2:space.rects.reduce((a,r)=>a+r.width*r.height,0)};
  }
  return {coverage,distance};
});
