(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WarmRoomDraw=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const equal=(a,b)=>a.x===b.x&&a.y===b.y;
  const length=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const horizontal=(a,b)=>a.y===b.y;
  const between=(v,a,b)=>v>=Math.min(a,b)&&v<=Math.max(a,b);
  function intersects(a,b,c,d){
    const h=horizontal(a,b),k=horizontal(c,d);
    if(h===k)return h?a.y===c.y&&Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x)):a.x===c.x&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
    if(!h)return intersects(c,d,a,b);
    return between(c.x,a.x,b.x)&&between(a.y,c.y,d.y);
  }
  function validate(points,closed=true){
    if(!Array.isArray(points)||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6))return{ok:false,error:'Некорректные координаты.'};
    if(points.length>100)return{ok:false,error:'Не более 100 углов в одном помещении.'};
    if(closed&&points.length<4)return{ok:false,error:'Для помещения нужны хотя бы четыре угла.'};
    const edges=[];
    for(let i=0;i<points.length-(closed?0:1);i++){
      const a=points[i],b=points[(i+1)%points.length];
      if(length(a,b)<100)return{ok:false,error:'Минимальная длина стены — 10 см.'};
      if(a.x!==b.x&&a.y!==b.y)return{ok:false,error:'Стены должны идти по горизонтали или вертикали.'};
      edges.push([a,b]);
    }
    for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
      const [a,b]=edges[i],[c,d]=edges[j];if(!intersects(a,b,c,d))continue;
      const adjacent=j===i+1||closed&&i===0&&j===edges.length-1;
      if(adjacent){
        if(horizontal(a,b)!==horizontal(c,d))continue;
        const overlap=horizontal(a,b)?Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)):Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y));
        if(overlap===0)continue;
      }
      return{ok:false,error:'Стена пересекает или перекрывает уже построенную стену.'};
    }
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    if(points.length&&(Math.max(...xs)-Math.min(...xs)>30000||Math.max(...ys)-Math.min(...ys)>30000))return{ok:false,error:'Габариты помещения — не более 30 × 30 м.'};
    const area=closed?Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0))/2:0;
    if(closed&&area<250000)return{ok:false,error:'Площадь помещения должна быть не меньше 0,25 м².'};
    return{ok:true,areaMm2:area};
  }
  function simplify(points){
    const p=points.map(q=>({...q}));let change=true;
    while(change&&p.length>4){change=false;for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];if(a.x===b.x&&b.x===c.x||a.y===b.y&&b.y===c.y){p.splice(i,1);change=true;break;}}}
    return p;
  }
  function build(points){
    const check=validate(points);if(!check.ok)return check;
    const p=simplify(points),ys=[...new Set(p.map(q=>q.y))].sort((a,b)=>a-b),sections=[];
    for(let j=0;j<ys.length-1;j++){
      const y=ys[j],height=ys[j+1]-y,mid=y+height/2,xs=[];
      p.forEach((a,i)=>{const b=p[(i+1)%p.length];if(a.x===b.x&&mid>Math.min(a.y,b.y)&&mid<Math.max(a.y,b.y))xs.push(a.x);});
      xs.sort((a,b)=>a-b);
      for(let i=0;i<xs.length;i+=2){const x=xs[i],width=xs[i+1]-x,prev=sections.find(s=>s.x===x&&s.width===width&&s.y+s.height===y);
        if(prev)prev.height+=height;else sections.push({x,y,width,height});
      }
    }
    return{...check,points:p,sections:sections.map((s,i)=>({...s,id:'draw-room-'+i,name:i?'Часть':'Основной',base:i===0}))};
  }
  function snap(points,raw,step=100,tolerance=100){
    const q={x:Math.round(raw.x/step)*step,y:Math.round(raw.y/step)*step};
    if(!points.length)return q;
    const a=points.at(-1),axis=Math.abs(raw.x-a.x)>=Math.abs(raw.y-a.y)?'x':'y',other=axis==='x'?'y':'x';q[other]=a[other];
    let nearest=null,dist=tolerance;
    for(const p of points){const d=Math.abs(raw[axis]-p[axis]);if(d<dist){dist=d;nearest=p[axis];}}
    if(nearest!==null)q[axis]=nearest;
    return q;
  }
  function candidate(points,q){
    const closes=points.length>=4&&equal(q,points[0]);
    return{...validate(closes?points:[...points,q],closes),closes};
  }
  return{equal,length,validate,build,snap,candidate};
});
