import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDestination,buildDestination} from './place.mjs';
import {guide} from './compass.mjs';
test('coordinate order',()=>{assert.deepEqual(parseDestination('?latitude=51.5&longitude=-0.4').coordinates,[-0.4,51.5]);assert.deepEqual(parseDestination('?to=51.5,-0.4').coordinates,[-0.4,51.5]);});
test('opaque identity and unverified access',()=>{const x={coordinates:[-0.4,51.5],mode:'foot_survey',name:'A & B',asset:{source:'fixture',id:'001'}};assert.deepEqual(parseDestination(buildDestination(x)),{...x,accessStatus:'unverified'});});
test('invalid inputs',()=>{for(const s of ['?to=91,0','?to=1,181','?to=,1','?latitude=2','?to=1,2&latitude=1','?to=1,2&to=3,4','?to=1,2&mode=unknown','?to=1,2&id=foo','?to=Infinity,0'])assert.throws(()=>parseDestination(s));});
test('zero and no destination',()=>{assert.deepEqual(parseDestination('?to=0,0').coordinates,[0,0]);assert.equal(parseDestination(''),null);});
test('straight line east and freshness',()=>{const f={longitude:0,latitude:0,accuracyM:5,timestampMs:1000};const x=guide(f,{coordinates:[0.01,0]},1000);assert.equal(x.kind,'straight_line');assert.ok(Math.abs(x.bearingDeg-90)<1e-9);assert.ok(x.distanceM>1100&&x.distanceM<1120);assert.equal(guide(f,{coordinates:[0.01,0]},17000),null);});
test('accuracy is not arrival or access',()=>{const x=guide({longitude:0,latitude:0,accuracyM:20,timestampMs:1000},{coordinates:[0,0]},1000);assert.equal(x.bearingDeg,null);assert.equal(x.withinAccuracy,true);assert.equal(x.accessStatus,'unverified');});

// D02/D07: successor destination selector must preserve the existing codec unchanged.
test('D02 signed west, east and zero survive canonical and legacy URLs',()=>{
  for(const coordinates of [[-0.4,51.5],[0.4,51.5],[0,0]]) {
    const selected={coordinates,mode:'compass',name:'Fixture destination'};
    const parsed=parseDestination(buildDestination(selected));
    assert.deepEqual(parsed.coordinates,coordinates);
    assert.equal(parsed.accessStatus,'unverified');
    assert.deepEqual(parseDestination('?to='+coordinates[1]+','+coordinates[0]).coordinates,coordinates);
  }
});
test('D07 encoded locality, Unicode and URL delimiters round-trip as plain data',()=>{
  const name='A & B / O’Test + % — Cymru';
  const selected={coordinates:[-2.1,53.4],name};
  const parsed=parseDestination(buildDestination(selected));
  assert.equal(parsed.name,name);
  assert.deepEqual(parsed.coordinates,selected.coordinates);
  assert.equal(parsed.asset,null);
});
test('D06 unverified map point has no implicit source identity or route promotion',()=>{
  const x=parseDestination(buildDestination({coordinates:[-0.4,51.5],name:'Tapped map point'}));
  assert.equal(x.mode,'compass');
  assert.equal(x.accessStatus,'unverified');
  assert.equal(x.asset,null);
});
test('D07 invalid, partial and duplicate selector handoff parameters reject',()=>{
  for(const s of ['?latitude=51.5&longitude=','?latitude=51.5&longitude=%E2%88%920.4','?latitude=51.5&longitude=-0.4&longitude=0.4','?latitude=51.5&longitude=-0.4&source=map','?latitude=91&longitude=-0.4','?latitude=51.5&longitude=NaN']) assert.throws(()=>parseDestination(s));
});

import {createPicker} from './picker.mjs';
test('picker allows reselection before confirmation',async()=>{
  const p=createPicker();await p.search('Testbury');p.chooseResult(1);p.chooseResult(0);
  assert.deepEqual(p.confirm().coordinates,[-0.4,51.5]);
});
test('invalid replacement clears pending choice and cannot confirm stale target',async()=>{
  const p=createPicker();await p.search('Testbury');p.chooseResult(1);
  assert.equal(p.chooseMapPoint({at:[181,51]}).status,'invalid');
  assert.equal(p.snapshot().pending,null);assert.throws(()=>p.confirm());
});
