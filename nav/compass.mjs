import {distanceKm,initialBearingDeg} from '../vendor/grid-distance-maths/src/geodesy.mjs';
export function guide(fix,target,now=Date.now()){
  if(!fix||!target)return null;
  const {longitude,latitude,accuracyM,timestampMs}=fix;
  if(![longitude,latitude,accuracyM,timestampMs,now].every(Number.isFinite)||accuracyM<0||Math.abs(longitude)>180||Math.abs(latitude)>90)return null;
  const age=now-timestampMs;if(age<0||age>15000)return null;
  const [lon,lat]=target.coordinates;
  if(![lon,lat].every(Number.isFinite)||Math.abs(lon)>180||Math.abs(lat)>90)return null;
  const distanceM=distanceKm(longitude,latitude,lon,lat)*1000;
  return {distanceM,bearingDeg:distanceM<=accuracyM?null:initialBearingDeg(longitude,latitude,lon,lat),accuracyM,fixAgeMs:age,withinAccuracy:distanceM<=accuracyM,kind:'straight_line',accessStatus:'unverified'};
}
