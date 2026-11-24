import {distanceKm,initialBearingDeg} from '../vendor/grid-distance-maths/src/geodesy.mjs';
// Source: immutable P1 compass policy (9698781539e549deaa6ecaa4a2b34610c1f9fd29, nav/compass.mjs).
// These are provisional product guardrails, not measured handset accuracy or a survey/safety standard.
// Boundary tests in nav/contracts.test.mjs preserve the 10 s / 30 m behavior until field review.
export const MAX_AGE_MS=10000, MAX_ACCURACY_M=30;
export function fixQuality(fix,now=Date.now()){
  if(!fix)return 'missing';
  const {longitude,latitude,accuracyM,timestampMs}=fix;
  if(![longitude,latitude,accuracyM,timestampMs,now].every(Number.isFinite)||accuracyM<0||Math.abs(longitude)>180||Math.abs(latitude)>90)return 'invalid';
  const age=now-timestampMs;
  if(age<0||age>MAX_AGE_MS)return 'stale';
  return accuracyM>MAX_ACCURACY_M?'poor':'usable';
}
export function guide(fix,target,now=Date.now()){
  if(fixQuality(fix,now)!=='usable'||!Array.isArray(target?.coordinates)||target.coordinates.length!==2)return null;
  const {longitude,latitude,accuracyM,timestampMs}=fix;
  const [lon,lat]=target.coordinates;
  if(![lon,lat].every(Number.isFinite)||Math.abs(lon)>180||Math.abs(lat)>90)return null;
  const distanceM=distanceKm(longitude,latitude,lon,lat)*1000;
  return {distanceM,bearingDeg:distanceM<=accuracyM?null:initialBearingDeg(longitude,latitude,lon,lat),accuracyM,fixAgeMs:now-timestampMs,withinAccuracy:distanceM<=accuracyM,kind:'straight_line',accessStatus:'unverified'};
}
