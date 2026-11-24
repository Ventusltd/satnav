// SPDX-License-Identifier: Apache-2.0
// Agent 24 candidate adapter; NL-084; transform injected by reviewed contract owner.
import { routeGrid } from './grid-search.mjs';
export function routeWithContract(request,{toWgs84, cancelled}={}){
  const requestId=request?.requestId??null;
  const reply=(status,reason,extra={})=>({schema:"satnav.route.response.v1",requestId,status,...(reason?{reason}:{}),...extra});
  if(request?.schema!=="satnav.route.request.v1"||typeof requestId!=="string"||!requestId||!["road_to_field","foot_survey","cable_trench"].includes(request.mode))return reply("invalid","BAD_REQUEST");
  if(cancelled?.())return reply("cancelled","CANCELLED");
  const a=request.grid??{}, {rows,cols,cellSizeM,originX,originY,crs,elevation,cost,access,surface,hazard}=a;
  const n=rows*cols;
  if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||n>360000||!Number.isFinite(cellSizeM)||cellSizeM<=0||!Number.isFinite(originX)||!Number.isFinite(originY)||typeof crs!=="string"||!crs.trim())return reply("invalid","BAD_GRID");
  if([cost,elevation].some(x=>!(x instanceof Float32Array)||x.length!==n)||[access,surface,hazard].some(x=>!(x instanceof Uint8Array)||x.length!==n))return reply("invalid","BAD_GRID_ARRAYS");
  if(!Number.isInteger(request.startCell)||!Number.isInteger(request.targetCell)||[request.startCell,request.targetCell].some(i=>i<0||i>=n))return reply("invalid","BAD_ENDPOINT");
  if(!a.provenance||typeof a.provenance!=="object")return reply("invalid","MISSING_PROVENANCE");
  if(request.mode==="road_to_field")return reply("unavailable","ROAD_GRAPH_NOT_INTEGRATED");
  if(typeof toWgs84!=="function")return reply("unavailable","VERIFIED_CRS_TRANSFORM_REQUIRED");
  const known=new Uint8Array(n),blocked=new Uint8Array(n);
  for(let i=0;i<n;i++){known[i]=Number.isFinite(elevation[i])&&surface[i]>=1&&surface[i]<=6?1:0;blocked[i]=hazard[i]===1||hazard[i]===3?0:1;}
  let result;
  try{result=routeGrid({width:cols,height:rows,cellMetres:cellSizeM,cost,known,access,blocked},request.startCell,request.targetCell,{cancelled});}catch{return reply("invalid","GRID_SEARCH_ERROR");}
  if(result.status==="cancelled")return reply("cancelled","CANCELLED");
  if(result.status!=="ok")return reply("no_route",result.reason);
  const cells=result.cells.length===1?[result.cells[0],result.cells[0]]:result.cells;
  const coordinates=[],vertices=[],manoeuvres=[];let cumulative2dM=0,cumulative3dM=0;
  for(let k=0;k<cells.length;k++){
    const i=cells[k],x=originX+(i%cols+0.5)*cellSizeM,y=originY+(Math.floor(i/cols)+0.5)*cellSizeM;
    let ll;try{ll=toWgs84(x,y,crs);}catch{return reply("unavailable","CRS_TRANSFORM_FAILED");}
    if(!Array.isArray(ll)||ll.length!==2||!ll.every(Number.isFinite)||Math.abs(ll[0])>180||Math.abs(ll[1])>90)return reply("unavailable","CRS_TRANSFORM_FAILED");
    coordinates.push(ll);
    let slopeDeg=null;
    if(k){const j=cells[k-1],distance=cellSizeM*Math.hypot(i%cols-j%cols,Math.floor(i/cols)-Math.floor(j/cols)),dz=elevation[i]-elevation[j];cumulative2dM+=distance;cumulative3dM+=Math.hypot(distance,dz);if(distance)slopeDeg=Math.atan2(dz,distance)*180/Math.PI;}
    vertices.push({elevationM:elevation[i],slopeDeg,surface:surface[i],cumulative2dM,cumulative3dM});
    if(k&&surface[i]!==surface[cells[k-1]])manoeuvres.push({vertexIndex:k,type:"surface_transition",text:"Mapped surface changes",evidence:{from:surface[cells[k-1]],to:surface[i]},distance:cumulative2dM});
    if(hazard[i]===3&&(!k||hazard[cells[k-1]]!==3))manoeuvres.push({vertexIndex:k,type:"caution",text:"Mapped caution area",evidence:{hazard:3},distance:cumulative2dM});
  }
  return reply("ok",null,{route:{type:"Feature",geometry:{type:"LineString",coordinates},properties:{mode:request.mode,indicative:request.mode==="cable_trench"}},vertices,manoeuvres,stats:{weightedCost:result.cost,expanded:result.expanded,distance2dM:cumulative2dM,distance3dM:cumulative3dM},provenance:a.provenance});
}
