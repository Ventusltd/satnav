// Agent 23 synthetic-only candidate; no real access inference.
// GGH1: Ventusltd/lidar@2ddf7257e4847e5f387e03aaecbc1cc425c4e387.
export function decodeGgh1(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Uint8Array required");
  const n=257,count=n*n;
  if(bytes.byteLength!==32+count*2) throw new Error("invalid byte length");
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(v.getUint32(0,false)!==0x47474831||v.getUint16(4,true)!==1||v.getUint16(6,true)!==n||v.getUint16(8,true)!==1000||v.getUint16(10,true)!==0)throw new Error("invalid GGH1 header");
  const elevation=new Float64Array(count),base=v.getInt32(20,true);
  let missing=0,min=65535,max=0;
  for(let i=0;i<count;i++){
    const q=v.getUint16(32+2*i,true);
    if(q===65535){elevation[i]=NaN;missing++;continue;}
    elevation[i]=(base+q)/100;min=Math.min(min,q);max=Math.max(max,q);
  }
  if(missing===count)min=max=0;
  if(missing!==v.getUint32(28,true)||min!==v.getUint16(24,true)||max!==v.getUint16(26,true))throw new Error("header/body mismatch");
  return {originE:v.getInt32(12,true),originN:v.getInt32(16,true),spacingM:1,width:n,height:n,crs:"EPSG:27700",rowOrder:"south-to-north",elevation};
}
export function buildFixtureGrid(tile,{cellSizeM=5,access,surface,hazard,relativeCost}={}) {
  if(![5,10].includes(cellSizeM)||tile.width!==257||tile.height!==257||tile.spacingM!==1||tile.crs!=="EPSG:27700"||!(tile.elevation instanceof Float64Array)||tile.elevation.length!==66049||!Number.isFinite(tile.originE)||!Number.isFinite(tile.originN))throw new Error("invalid tile or cell size");
  const rows=Math.floor(256/cellSizeM),cols=rows,n=rows*cols;
  function mask(input,max){if(input===undefined)return new Uint8Array(n);if(!(input instanceof Uint8Array)||input.length!==n||input.some(x=>x>max))throw new Error("invalid mask");return input.slice();}
  const a=mask(access,2),s=mask(surface,6),h=mask(hazard,3);
  if(relativeCost!==undefined&&(!(relativeCost instanceof Float32Array)||relativeCost.length!==n||relativeCost.some(x=>!Number.isFinite(x)||x<=0)))throw new Error("invalid relative cost");
  const elevation=new Float32Array(n).fill(NaN),cost=new Float32Array(n).fill(Infinity);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const i=r*cols+c;let sum=0,valid=true;
    for(let dy=0;dy<cellSizeM;dy++)for(let dx=0;dx<cellSizeM;dx++){
      const z=tile.elevation[(r*cellSizeM+dy)*257+c*cellSizeM+dx];
      if(!Number.isFinite(z))valid=false;else sum+=z;
    }
    if(valid){elevation[i]=sum/(cellSizeM*cellSizeM);
      if(a[i]===1&&(h[i]===1||h[i]===3)&&s[i]!==0&&relativeCost!==undefined)cost[i]=relativeCost[i];
    }
  }
  return {crs:tile.crs,originX:tile.originE,originY:tile.originN,rows,cols,cellSizeM,elevation,cost,access:a,surface:s,hazard:h,provenance:{synthetic:true,source:"GGH1 synthetic fixture",coverageM:rows*cellSizeM,excludedEdgeM:256-rows*cellSizeM,transformAccuracyM:null,verticalDatum:null}};
}
