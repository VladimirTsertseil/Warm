/* Warm 2.3.2: paired counterflow meander. No DOM or application state. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WarmPatternsV232=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function doubleMeander({rect,axis='horizontal',lanes,reverse=false,flip=false}){
    if(!rect||!Array.isArray(lanes)||lanes.length<4)return null;
    const rows=lanes.slice(0,lanes.length-lanes.length%2);
    if(reverse)rows.reverse();
    const lo=axis==='horizontal'?rect.left:rect.top;
    const hi=axis==='horizontal'?rect.right:rect.bottom;
    const gap=Math.max(...rows.slice(1).map((v,i)=>Math.abs(v-rows[i])));
    if(!Number.isFinite(gap)||gap<=0||hi-lo<gap*4)return null;
    const count=rows.length/2;
    // Each pair contains one outward and one return pass. At alternating
    // ends the U-turns are nested: outer spans three pitches, inner one.
    // Sorting ALL passes yields H,C,C,H,H,C,C,H (as in the reference),
    // while EACH paired pass has opposite flow and complementary temperature.
    const branch=hot=>{
      const points=[];
      const turn=i=>i%2===0?(hot?hi:hi-gap):(hot?lo+gap:lo);
      for(let i=0;i<count;i++){
        const row=rows[2*i+((i%2===0)===hot?0:1)];
        points.push({x:i===0?lo:turn(i-1),y:row});
        points.push({x:i===count-1?(i%2===0?hi:lo):turn(i),y:row});
      }
      return points;
    };
    const hot=branch(true),cold=branch(false).reverse();
    const map=p=>{const x=flip?lo+hi-p.x:p.x;return axis==='horizontal'?{x,y:p.y}:{x:p.y,y:x};};
    const route=[...hot,...cold].map(map);
    return {route,hot:hot.map(map),cold:cold.map(map),pairs:count,axis};
  }
  return {doubleMeander};
});
