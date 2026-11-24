import {createRouteFollower} from '../src/router/route-follower.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const maths=await import(pathToFileURL(resolve(process.argv[2]??'vendor/grid-distance-maths/src/geodesy.mjs')).href);
function runFollowerTests(createRouteFollower,maths){
  let count=0;const check=(p,m)=>{if(!p)throw Error(m);count++;};
  for(const [name,lon,lat] of [["England",-0.45,51.5],["Scotland",-4.25,55.86],["Wales",-3.18,51.48],["Northern Ireland",-5.93,54.6]]){
    const start=[lon,lat],end=maths.destinationPoint(lon,lat,.2,0),mid=maths.destinationPoint(lon,lat,.1,0),east=maths.destinationPoint(...mid,.05,90),west=maths.destinationPoint(...mid,.05,270);
    const locate=createRouteFollower({type:"LineString",coordinates:[start,end]},maths),fix=(p,accuracyM=3,timestampMs=1000)=>({longitude:p[0],latitude:p[1],accuracyM,timestampMs});
    const a=locate(fix(mid),1000),b=locate(fix(east),1000),c=locate(fix(west),1000);
    check(a.status==="ok"&&Math.abs(a.progressM-100)<.1&&Math.abs(a.remainingM-100)<.1,name+" progress");
    check(b.signedCrossTrackM>49&&b.signedCrossTrackM<51&&b.offRoute,name+" right");
    check(c.signedCrossTrackM<-49&&c.signedCrossTrackM>-51,name+" left");
    check(locate(fix(east,30),1000).offRoute===false,name+" accuracy margin");
    check(locate(fix(mid,31),1000).status==="uncertain",name+" poor accuracy");
    check(locate(fix(mid),12000).status==="stale",name+" stale");
    check(locate(fix(mid),999).status==="stale",name+" future");
    const loop=createRouteFollower({type:"LineString",coordinates:[start,end,start]},maths);
    check(loop(fix(mid),1000).reason==="AMBIGUOUS_ROUTE_POSITION",name+" out/back ambiguity");
    check(locate(fix(start),1000).signedCrossTrackM===null,name+" endpoint sign unavailable");
    check(a.trackingOnly===true,name+" tracking only");
  }
  for(const g of [{type:"Point",coordinates:[0,0]},{type:"LineString",coordinates:[[0,0],[0,0]]},{type:"LineString",coordinates:[[0,0],[0,10]]}]){let rejected=false;try{createRouteFollower(g,maths);}catch{rejected=true;}check(rejected,"bad geometry");}
  return count;
}
console.log('PASS: '+runFollowerTests(createRouteFollower,maths)+' route-following assertions');
