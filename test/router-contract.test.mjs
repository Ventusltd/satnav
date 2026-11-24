import {routeWithContract} from '../src/router/contract-adapter.mjs';
function testContract(routeWithContract){
  let count=0;const assert=(x,s)=>{if(!x)throw Error(s);count++;};
  const grid={rows:3,cols:3,originX:0,originY:0,cellSizeM:5,crs:"SYNTHETIC_LOCAL",elevation:new Float32Array(9).fill(10),cost:new Float32Array(9).fill(1),access:new Uint8Array(9).fill(1),surface:new Uint8Array(9).fill(3),hazard:new Uint8Array(9).fill(1),provenance:{fixture:"synthetic"}};
  const q={schema:"satnav.route.request.v1",requestId:"fixture",mode:"foot_survey",grid,startCell:0,targetCell:8};
  const transform=(x,y)=>[x/100000,y/100000],opts={toWgs84:transform};
  let a=routeWithContract(q,opts);
  assert(a.status==="ok"&&a.requestId==="fixture","success envelope");assert(a.route.geometry.coordinates.length===a.vertices.length,"vertex parity");assert(Math.abs(a.stats.distance2dM-10*Math.SQRT2)<1e-8,"metric distance");assert(a.provenance.fixture==="synthetic","provenance");
  assert(routeWithContract(q).status==="unavailable","no transform");assert(routeWithContract({...q,mode:"road_to_field"},opts).status==="unavailable","no graph");assert(routeWithContract({...q,targetCell:9},opts).status==="invalid","bounds");assert(routeWithContract(q,{...opts,cancelled:()=>true}).status==="cancelled","cancel");
  grid.hazard[1]=2;grid.hazard[3]=0;assert(routeWithContract(q,opts).status==="no_route","hard and unknown corner");grid.hazard.fill(1);grid.elevation[8]=NaN;assert(routeWithContract(q,opts).status==="no_route","unknown height");grid.elevation[8]=10;grid.surface[8]=0;assert(routeWithContract(q,opts).status==="no_route","unknown surface");grid.surface[8]=3;grid.access[8]=2;assert(routeWithContract(q,opts).status==="no_route","prohibited access");grid.access[8]=1;
  a=routeWithContract({...q,targetCell:0},opts);assert(a.status==="ok"&&a.route.geometry.coordinates.length===2&&a.stats.distance2dM===0,"zero-length GeoJSON");
  assert(routeWithContract(q,{toWgs84:()=>[Infinity,0]}).status==="unavailable","invalid transform");
  grid.surface[4]=2;grid.hazard[4]=3;grid.elevation[4]=13;a=routeWithContract(q,opts);assert(a.manoeuvres.some(x=>x.type==="caution"),"caution evidence");assert(a.manoeuvres.some(x=>x.type==="surface_transition"),"surface evidence");assert(a.stats.distance3dM>a.stats.distance2dM,"3d distance");
  a=routeWithContract({...q,mode:"cable_trench"},opts);assert(a.route.properties.indicative===true,"planning label");return count;
}
console.log('PASS: '+testContract(routeWithContract)+' contract adapter assertions');
