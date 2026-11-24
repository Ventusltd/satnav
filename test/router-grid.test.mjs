import { routeGrid } from '../src/router/grid-search.mjs';
function runTests(routeGrid){
  let count=0;
  function check(v,msg){if(!v)throw Error(msg);count++;}
  function grid(w,h){return {width:w,height:h,cellMetres:5,cost:new Float32Array(w*h).fill(1),known:new Uint8Array(w*h).fill(1),access:new Uint8Array(w*h).fill(1),blocked:new Uint8Array(w*h)};}
  function reference(a,start,goal){const n=a.width*a.height,w=a.width;const d=Array(n).fill(Infinity),seen=new Set();
    function allowed(i){return a.known[i]===1&&a.access[i]===1&&!a.blocked[i]&&a.cost[i]>0&&Number.isFinite(a.cost[i]);}
    if(!allowed(start)||!allowed(goal))return Infinity;d[start]=0;
    while(true){let u=-1;for(let i=0;i<n;i++)if(!seen.has(i)&&Number.isFinite(d[i])&&(u===-1||d[i]<d[u]))u=i;if(u===-1||u===goal)return d[goal];seen.add(u);
      for(let v=0;v<n;v++){const ux=u%w,uy=Math.floor(u/w),vx=v%w,vy=Math.floor(v/w),dx=Math.abs(ux-vx),dy=Math.abs(uy-vy);if(dx>1||dy>1||!(dx+dy)||!allowed(v))continue;if(dx&&dy&&(!allowed(uy*w+vx)||!allowed(vy*w+ux)))continue;d[v]=Math.min(d[v],d[u]+a.cellMetres*Math.hypot(dx,dy)*(a.cost[u]+a.cost[v])/2);}
    }
  }
  let a=grid(3,3);check(Math.abs(routeGrid(a,0,8).cost-10*Math.SQRT2)<1e-9,"diagonal cost");check(routeGrid(a,4,4).cells.length===1,"same endpoint");a.blocked[1]=1;a.blocked[3]=1;check(routeGrid(a,0,8).status==="no-route","no corner cutting");
  a=grid(3,3);a.known[8]=0;check(routeGrid(a,0,8).reason==="ENDPOINT_NOT_PERMITTED","unknown endpoint");a.known[8]=1;a.access[8]=0;check(routeGrid(a,0,8).reason==="ENDPOINT_NOT_PERMITTED","no access");a.access[8]=1;a.cost[8]=NaN;check(routeGrid(a,0,8).status==="no-route","nodata cost");a=grid(4,4);check(routeGrid(a,0,15,{cancelled:()=>true}).status==="cancelled","cancel");check(routeGrid(a,0,15,{maxExpanded:0}).reason==="SEARCH_BUDGET_EXCEEDED","budget");
  let seed=24;function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
  for(let t=0;t<100;t++){a=grid(8,7);for(let i=1;i<55;i++){a.cost[i]=0.2+rand()*8;if(rand()<.19)a.blocked[i]=1;if(rand()<.04)a.known[i]=0;if(rand()<.04)a.access[i]=0;}const expected=reference(a,0,55),got=routeGrid(a,0,55);check(Number.isFinite(expected)?got.status==="ok"&&Math.abs(got.cost-expected)<1e-7:got.status==="no-route","reference "+t);if(got.status==="ok"){check(got.cells[0]===0&&got.cells.at(-1)===55,"endpoints "+t);check(got.cells.every(i=>a.known[i]===1&&a.access[i]===1&&a.blocked[i]===0),"route permission "+t);}}
  return count;
}
console.log('PASS: '+runTests(routeGrid)+' assertions, 100 seeded reference cases');
