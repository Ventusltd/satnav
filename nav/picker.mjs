// Standalone, deterministic destination picker. GridAtlas-style result fields;
// opt-in map point selection mirrors Vicinity's WGS84 event.lngLat contract.
import {buildDestination,parseDestination} from './place.mjs';
const fixtures=[
  {label:'Testbury',sublabel:'North fixture',longitude:-0.4,latitude:51.5,provider:'local fixture'},
  {label:'Testbury',sublabel:'West fixture',longitude:-2.1,latitude:53.4,provider:'local fixture'},
  {label:'East fixture',sublabel:'Synthetic east point',longitude:0.4,latitude:51.5,provider:'local fixture'},
  {label:'West fixture',sublabel:'Synthetic west point',longitude:-4.2,latitude:55.2,provider:'local fixture'}
];
export const mapFixtures=Object.freeze(fixtures.map(x=>Object.freeze({...x})));
export async function fixtureLookup(query){
  await Promise.resolve();
  if(/^(fail|failure|timeout|503|429)$/i.test(query.trim()))throw Error('Fixture lookup unavailable');
  return fixtures.filter(x=>(x.label+' '+x.sublabel).toLowerCase().includes(query.trim().toLowerCase()));
}
export function normaliseChoice(raw){
  const coordinates=Array.isArray(raw?.at)?raw.at:[raw?.longitude,raw?.latitude];
  if(coordinates.length!==2||!coordinates.every(Number.isFinite))throw Error('Invalid point');
  const [lon,lat]=coordinates;
  if(Math.abs(lon)>180||Math.abs(lat)>90)throw Error('Point out of range');
  const label=String(raw?.label||'Chosen map point').trim().slice(0,120);
  const locality=String(raw?.sublabel||raw?.locality||'').trim().slice(0,120);
  if(!label)throw Error('Point label missing');
  // A visually picked location cannot assert stable asset identity or access.
  return {coordinates:[lon,lat],name:label,locality,asset:null};
}
export function createPicker({lookup=fixtureLookup,onConfirm=()=>{}}={}){
  let epoch=0,status='idle',message='',results=[],pending=null;
  const snapshot=()=>({status,message,results:results.map(x=>({...x,coordinates:x.coordinates.slice()})),pending:pending?{...pending,coordinates:pending.coordinates.slice()}:null});
  function cancel(){epoch++;status='cancelled';message='Selection cancelled; current destination unchanged.';results=[];pending=null;return snapshot();}
  async function search(query){
    const request=++epoch;pending=null;results=[];status='searching';message='Searching local fixtures…';
    if(typeof query!=='string'||!query.trim()){status='invalid';message='Enter a place or postcode.';return snapshot();}
    try{
      const raw=await lookup(query.trim());if(request!==epoch)return {stale:true};
      if(!Array.isArray(raw))throw Error('Invalid lookup response');
      results=raw.slice(0,20).map(normaliseChoice);
      status=results.length?'results':'no_results';
      message=results.length?'Choose a result, then confirm.':'No matching fixture results.';
    }catch(error){if(request!==epoch)return {stale:true};status='unavailable';message='Lookup unavailable: '+String(error?.message||'unknown failure');}
    return snapshot();
  }
  function chooseResult(index){
    if(!['results','selected'].includes(status)||!Number.isInteger(index)||index<0||index>=results.length)throw Error('Result unavailable');
    pending={...results[index],coordinates:results[index].coordinates.slice()};
    status='selected';message='Review destination, then confirm.';return snapshot();
  }
  function chooseMapPoint(point){
    epoch++;results=[];pending=null;
    try{pending=normaliseChoice(point);}catch(error){status='invalid';message=error.message;return snapshot();}
    status='selected';message='Review map point, then confirm.';return snapshot();
  }
  function confirm(){
    if(!pending)throw Error('Choose a destination first');
    const selected=parseDestination(buildDestination({coordinates:pending.coordinates,name:pending.name,asset:pending.asset,mode:'compass'}));
    onConfirm(selected);epoch++;pending=null;results=[];status='confirmed';message='Destination selected. Start location when ready.';return selected;
  }
  return Object.freeze({snapshot,search,chooseResult,chooseMapPoint,cancel,confirm});
}
