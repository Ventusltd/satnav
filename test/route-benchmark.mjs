import {createRouteFollower} from '../src/router/route-follower.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const maths=await import(pathToFileURL(resolve(process.argv[2])).href);
function benchmark(createRouteFollower,maths,clock){
  const n=20000,results=[];
  const quantile=(a,p)=>a[Math.ceil(a.length*p)-1];
  for(const kind of ["straight","bends","out-and-back"]){
    const coordinates=Array.from({length:n},(_,i)=>{
      const j=kind==="out-and-back"?Math.min(i,n-1-i):i;
      return [-0.4+(kind==="bends"?0.0002*Math.sin(j/300):0),51.5+j*0.000001];
    });
    const t=clock(),locate=createRouteFollower({type:"LineString",coordinates},maths),prepareMs=clock()-t;
    const timings=[],counts={ok:0,uncertain:0};
    for(let i=0;i<25;i++){
      const p=coordinates[2000+i*200],fix={longitude:p[0]+0.00002,latitude:p[1],accuracyM:3,timestampMs:1000};
      const start=clock(),result=locate(fix,1000),elapsed=clock()-start;
      if(i>=5)timings.push(elapsed);
      if(result.status==="ok"&&kind!=="out-and-back"&&result.trackingOnly&&Number.isFinite(result.remainingM))counts.ok++;
      else if(result.status==="uncertain"&&kind==="out-and-back"&&result.reason==="AMBIGUOUS_ROUTE_POSITION")counts.uncertain++;
      else throw Error("Unexpected "+kind+" status "+JSON.stringify(result));
    }
    timings.sort((a,b)=>a-b);
    results.push({kind,vertices:n,measuredFixes:timings.length,prepareMs,p50Ms:quantile(timings,.5),p95Ms:quantile(timings,.95),maxMs:timings.at(-1),counts});
  }
  const thresholdMs=1000;
  return {schema:"satnav.route.benchmark.v1",syntheticOnly:true,thresholdMs,thresholdBasis:"provisional CI per-fix p95 ceiling; not device acceptance",pass:results.every(r=>r.p95Ms<=thresholdMs),results};
}
const result=benchmark(createRouteFollower,maths,()=>performance.now());
console.log(JSON.stringify(result));
if(!result.pass)process.exitCode=1;
