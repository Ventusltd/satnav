import {parseDestination,buildDestination} from './place.mjs';
import {guide,fixQuality} from './compass.mjs';
import {createPicker,mapFixtures} from './picker.mjs';
const el=id=>document.getElementById(id);
let target=null,fix=null,watch=null,wake=null,generation=0,wakePending=false;
function setTarget(t){
  target=t;el('destination').textContent=t?(t.name||'Selected coordinates'):'No destination selected';
  if(t){el('latitude').value=t.coordinates[1];el('longitude').value=t.coordinates[0];el('name').value=t.name;}
  render();
}
function render(){
  const now=Date.now(),quality=fixQuality(fix,now);
  const usable=quality==='usable',fresh=usable||quality==='poor';
  const g=usable?guide(fix,target,now):null;
  el('distance').textContent=g?(g.distanceM>=1000?(g.distanceM/1000).toFixed(2)+' km':Math.round(g.distanceM)+' m'):'—';
  el('bearing').textContent=g?.bearingDeg!=null?Math.round(g.bearingDeg)%360+'°':'—';
  el('arrow').style.visibility=g?.bearingDeg!=null?'visible':'hidden';
  if(g?.bearingDeg!=null)el('arrow').style.transform='rotate('+g.bearingDeg+'deg)';
  el('position').textContent=fresh?'Position '+fix.latitude.toFixed(5)+', '+fix.longitude.toFixed(5):'Position unavailable';
  el('accuracy').textContent=fresh?'Accuracy ±'+Math.round(fix.accuracyM)+' m'+(!usable?' — too uncertain for guidance':g?.withinAccuracy?' — target within uncertainty; access unverified':''):'Accuracy unavailable';
  el('course').textContent=usable&&fix.heading!==null?'Course over ground '+Math.round(fix.heading)%360+'° (north-up display)':'North-up; course unavailable';
  if(watch!==null&&fix)el('status').textContent=!fresh?'Location stale':!usable?'Poor location accuracy':'Location fix received';
}
function setFromChoice(t){setTarget(t);history.replaceState(null,'',location.pathname+buildDestination(t));}
const picker=createPicker({onConfirm:setFromChoice});
function showPicker(){
  const state=picker.snapshot();el('searchStatus').textContent=state.message||'Search when ready.';
  const results=el('results');results.replaceChildren();
  state.results.forEach((r,i)=>{
    const button=document.createElement('button');button.type='button';button.className='choice';
    const label=document.createElement('span'),sub=document.createElement('small');
    label.textContent=r.name;sub.textContent=r.locality||'Local fixture';button.append(label,sub);
    button.onclick=()=>{picker.chooseResult(i);showPicker();el('confirm').focus();};results.append(button);
  });
  el('selection').hidden=!state.pending;
  el('pending').textContent=state.pending?`${state.pending.name}${state.pending.locality?' · '+state.pending.locality:''} · ${state.pending.coordinates[1]}, ${state.pending.coordinates[0]} · access unverified`:'';
}
el('placeSearch').addEventListener('submit',async e=>{
  e.preventDefault();const current=picker.search(el('query').value);showPicker();const response=await current;if(!response.stale)showPicker();
});
el('cancel').onclick=()=>{picker.cancel();showPicker();};
el('confirm').onclick=()=>{try{picker.confirm();el('targetError').textContent='';}catch(e){el('searchStatus').textContent=e.message;}showPicker();};
function pickMap(at,label='Chosen map point'){
  picker.chooseMapPoint({at,label,sublabel:'Schematic map selection'});showPicker();
}
const pins=el('mapPins');mapFixtures.forEach((r,i)=>{
  const b=document.createElement('button');b.type='button';b.textContent=r.label+' · '+r.sublabel;
  b.onclick=()=>pickMap([r.longitude,r.latitude],r.label);pins.append(b);
});
// Vicinity selection equivalent: a map click supplies event.lngLat → [lng, lat].
el('map').addEventListener('click',event=>{
  const svg=el('map'),matrix=svg.getScreenCTM();if(!matrix)return;
  const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
  const local=point.matrixTransform(matrix.inverse());
  if(local.x<0||local.x>360||local.y<0||local.y>185)return;
  const x=local.x/360,y=local.y/185;
  pickMap([Number((-8+10*x).toFixed(5)),Number((59-9*y).toFixed(5))]);
});
el('map').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();pickMap([-0.4,51.5]);}});
try{const t=parseDestination(location.search);if(t){if(t.mode!=='compass')throw new Error('Only compass mode is available');setTarget(t);}}catch(e){el('targetError').textContent=e.message;el('advanced').open=true;}
el('target').addEventListener('submit',e=>{
  e.preventDefault();
  try{
    const p=new URLSearchParams({latitude:el('latitude').value,longitude:el('longitude').value,name:el('name').value});
    const parsed=parseDestination(p.toString());setFromChoice(parsed);el('targetError').textContent='';
  }catch(err){el('targetError').textContent=err.message;}
});
async function acquire(){
  const token=generation;if(watch===null||wake||wakePending||document.hidden)return;
  wakePending=true;
  try{const w=await navigator.wakeLock?.request('screen');if(token!==generation||watch===null){await w?.release();return;}wake=w;w?.addEventListener('release',()=>{if(wake===w)wake=null;});}
  catch{}finally{wakePending=false;}
}
function stop(message='Location stopped'){
  generation++;if(watch!==null)navigator.geolocation?.clearWatch(watch);
  watch=null;fix=null;wake?.release().catch(()=>{});wake=null;
  el('status').textContent=message;el('start').disabled=false;el('stop').disabled=true;render();
}
el('start').onclick=()=>{
  if(watch!==null)return;
  if(!isSecureContext||!navigator.geolocation){stop('Location unsupported or insecure context');return;}
  const token=++generation;el('status').textContent='Requesting location';
  try{
    watch=navigator.geolocation.watchPosition(p=>{
      if(token!==generation)return;
      const c=p.coords;
      if(![c.longitude,c.latitude,c.accuracy,p.timestamp].every(Number.isFinite)||Math.abs(c.longitude)>180||Math.abs(c.latitude)>90||c.accuracy<0){fix=null;el('status').textContent='Invalid location fix';render();return;}
      fix={longitude:c.longitude,latitude:c.latitude,accuracyM:c.accuracy,timestampMs:p.timestamp,heading:Number.isFinite(c.heading)&&c.heading>=0&&c.heading<360&&Number.isFinite(c.speed)&&c.speed>0?c.heading:null};
      render();
    },e=>{
      if(token!==generation)return;
      if(e.code===1){stop('Location permission denied');return;}
      fix=null;el('status').textContent=e.code===3?'Location request timed out':'Location unavailable';render();
    },{enableHighAccuracy:true,maximumAge:1000,timeout:10000});
    el('start').disabled=true;el('stop').disabled=false;acquire();
  }catch{stop('Location request unavailable');}
};
el('stop').onclick=()=>stop();
document.addEventListener('visibilitychange',()=>{if(!document.hidden){acquire();render();}});
window.addEventListener('pagehide',()=>stop());setInterval(render,1000);
