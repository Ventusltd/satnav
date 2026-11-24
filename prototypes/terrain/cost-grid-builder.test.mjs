import {decodeGgh1,buildFixtureGrid} from './cost-grid-builder.mjs';
function syntheticTile({missing=[],flat=false,baseCm=-150}={}){
  const n=257,bytes=new Uint8Array(32+n*n*2),v=new DataView(bytes.buffer),omit=new Set(missing);
  v.setUint32(0,0x47474831,false);v.setUint16(4,1,true);v.setUint16(6,n,true);v.setUint16(8,1000,true);v.setInt32(12,400000,true);v.setInt32(16,210000,true);
  let min=Infinity,max=-Infinity,values=[];
  for(let i=0;i<n*n;i++){let h=omit.has(i)?null:baseCm+(flat?0:(i%n)*10+Math.floor(i/n)*20);values.push(h);if(h!==null){min=Math.min(min,h);max=Math.max(max,h);}}
  if(!Number.isFinite(min))min=max=0;
  v.setInt32(20,min,true);v.setUint16(26,max-min,true);v.setUint32(28,values.filter(x=>x===null).length,true);
  for(let i=0;i<values.length;i++)v.setUint16(32+2*i,values[i]===null?65535:values[i]-min,true);
  return bytes;
}
function runTests(decodeGgh1,buildFixtureGrid,syntheticTile){
  let n=0;const ok=(b,l)=>{if(!b)throw new Error(l);n++;},reject=(f,l)=>{let threw=false;try{f();}catch{threw=true;}ok(threw,l);};
  const a=decodeGgh1(syntheticTile({missing:[258]}));
  ok(a.originE===400000&&a.originN===210000&&a.crs==="EPSG:27700","metadata");ok(a.elevation[0]===-1.5,"negative");ok(Math.abs(a.elevation[1]+1.4)<1e-12,"east");ok(Math.abs(a.elevation[257]+1.3)<1e-12,"north");ok(Number.isNaN(a.elevation[258]),"nodata");
  ok(decodeGgh1(syntheticTile({flat:true,baseCm:0})).elevation[66048]===0,"zero");ok(decodeGgh1(syntheticTile({missing:Array.from({length:66049},(_,i)=>i)})).elevation.every(Number.isNaN),"all nodata");
  reject(()=>decodeGgh1(new Uint8Array(32)),"truncated");
  for(const o of [0,4,6,8,10,24,26,28]){const b=syntheticTile();b[o]^=1;reject(()=>decodeGgh1(b),"header "+o);}
  const buf=new Uint8Array(10+syntheticTile().length);buf.set(syntheticTile(),10);ok(decodeGgh1(buf.subarray(10)).elevation[0]===-1.5,"offset");
  const g=buildFixtureGrid(a);ok(g.rows===51&&g.cols===51&&g.provenance.excludedEdgeM===1,"coverage");ok(g.cost.every(x=>x===Infinity),"unknown access");ok(Number.isNaN(g.elevation[0]),"unknown terrain");
  const size=g.rows*g.cols,access=new Uint8Array(size).fill(1),surface=new Uint8Array(size).fill(4),hazard=new Uint8Array(size).fill(1),relativeCost=new Float32Array(size).fill(2);
  access[2]=2;hazard[3]=2;hazard[4]=0;surface[5]=0;hazard[6]=3;
  const p=buildFixtureGrid(a,{access,surface,hazard,relativeCost});
  for(const [i,c] of [[0,Infinity],[1,2],[2,Infinity],[3,Infinity],[4,Infinity],[5,Infinity],[6,2]])ok(p.cost[i]===c,"cost "+i);
  ok(p.access!==access&&p.hazard!==hazard,"source retained");reject(()=>buildFixtureGrid(a,{access:new Uint8Array(1)}),"length");reject(()=>buildFixtureGrid(a,{relativeCost:new Float32Array(size)}),"zero cost");reject(()=>buildFixtureGrid(a,{cellSizeM:0}),"resolution");
  return n;
}
console.log(`${runTests(decodeGgh1,buildFixtureGrid,syntheticTile)} synthetic checks passed`);
