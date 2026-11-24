// Cross-agent synthetic fixture. This is NOT a field-ready route.
import assert from 'node:assert/strict';
import {buildFixtureGrid} from '../prototypes/terrain/cost-grid-builder.mjs';
import {routeWithContract} from '../src/router/contract-adapter.mjs';
const elevation=new Float64Array(257*257).fill(100);
const tile={width:257,height:257,spacingM:1,crs:'EPSG:27700',originE:0,originN:0,elevation};
const n=51*51,access=new Uint8Array(n).fill(1),surface=new Uint8Array(n).fill(3),hazard=new Uint8Array(n).fill(1),relativeCost=new Float32Array(n).fill(1);
const grid=buildFixtureGrid(tile,{cellSizeM:5,access,surface,hazard,relativeCost});
const req={schema:'satnav.route.request.v1',requestId:'synthetic-only',mode:'foot_survey',grid,startCell:0,targetCell:52};
const fixtureTransform=(x,y)=>[x/100000,y/100000]; // synthetic coordinate transform only
const ok=routeWithContract(req,{toWgs84:fixtureTransform});
assert.equal(ok.status,'ok');assert.equal(ok.provenance.synthetic,true);
assert.equal(ok.vertices.length,ok.route.geometry.coordinates.length);
assert.ok(Math.abs(ok.stats.distance2dM-Math.sqrt(50))<1e-6);
assert.ok(Math.abs(ok.stats.weightedCost-Math.sqrt(50))<1e-6);
const blocked=buildFixtureGrid(tile,{cellSizeM:5,access:new Uint8Array(n),surface,hazard,relativeCost});
assert.notEqual(routeWithContract({...req,grid:blocked},{toWgs84:fixtureTransform}).status,'ok');
assert.equal(routeWithContract(req).status,'unavailable');
assert.equal(routeWithContract({...req,mode:'road_to_field'},{toWgs84:fixtureTransform}).status,'unavailable');
console.log('Synthetic terrain → router contract smoke: 8 assertions passed; no real navigation claim.');
