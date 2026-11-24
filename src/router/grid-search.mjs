// Agent 24: provisional synthetic-grid core; not a locked product interface.
// SPDX-License-Identifier: Apache-2.0
export function routeGrid(grid,start,goal,options={}){
  const {width:w,height:h,cellMetres:s,cost,known,access,blocked}=grid;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>1000000||!Number.isFinite(s)||s<=0)throw Error("INVALID_GRID");
  const n=w*h;
  if(!(cost instanceof Float32Array)||cost.length!==n||[known,access,blocked].some(a=>!(a instanceof Uint8Array)||a.length!==n))throw Error("INVALID_GRID_ARRAYS");
  if(!Number.isInteger(start)||!Number.isInteger(goal)||start<0||goal<0||start>=n||goal>=n)throw Error("INVALID_ENDPOINT");
  const pass=i=>known[i]===1&&access[i]===1&&blocked[i]===0&&Number.isFinite(cost[i])&&cost[i]>0;
  if(!pass(start)||!pass(goal))return {status:"no-route",reason:"ENDPOINT_NOT_PERMITTED"};
  let min=Infinity;
  for(let i=0;i<n;i++)if(pass(i))min=Math.min(min,cost[i]);
  const heuristic=i=>{const dx=Math.abs(i%w-goal%w),dy=Math.abs(Math.floor(i/w)-Math.floor(goal/w));return min*s*(Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy));};
  const g=new Float64Array(n);g.fill(Infinity);g[start]=0;
  const parent=new Int32Array(n);parent.fill(-1);
  const heap=[];
  const less=(a,b)=>a.f<b.f||(a.f===b.f&&(a.g<b.g||(a.g===b.g&&a.i<b.i)));
  function push(v){let j=heap.length;heap.push(v);while(j){const p=(j-1)>>1;if(!less(v,heap[p]))break;heap[j]=heap[p];j=p;}heap[j]=v;}
  function pop(){const v=heap[0],tail=heap.pop();if(heap.length){let j=0;while(2*j+1<heap.length){let k=2*j+1;if(k+1<heap.length&&less(heap[k+1],heap[k]))k++;if(!less(heap[k],tail))break;heap[j]=heap[k];j=k;}heap[j]=tail;}return v;}
  push({i:start,g:0,f:heuristic(start)});
  let expanded=0;
  while(heap.length){
    if(options.cancelled?.())return {status:"cancelled"};
    const cur=pop(),i=cur.i;if(cur.g!==g[i])continue;
    if(i===goal){const path=[];for(let k=goal,steps=0;k!==-1&&steps<=n;k=parent[k],steps++){path.push(k);if(k===start)break;}if(path.at(-1)!==start)throw Error("INVALID_PARENT_CHAIN");return {status:"ok",cells:path.reverse(),cost:g[goal],expanded};}
    if(++expanded>(options.maxExpanded??n))return {status:"no-route",reason:"SEARCH_BUDGET_EXCEEDED"};
    const x=i%w,y=Math.floor(i/w);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;const j=yy*w+xx;
      if(!pass(j)||(dx&&dy&&(!pass(y*w+xx)||!pass(yy*w+x))))continue;
      const next=g[i]+s*(dx&&dy?Math.SQRT2:1)*(cost[i]+cost[j])/2;
      if(next<g[j]){g[j]=next;parent[j]=i;push({i:j,g:next,f:next+heuristic(j)});}
    }
  }
  return {status:"no-route",reason:"DISCONNECTED"};
}
