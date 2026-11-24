// Candidate adapter: existing Vicinity performs geometry, voltage and radius maths.
// Source modules are injected by the integrator; no network or GPS access here.
export function buildAssetIndex({features, vicinity, geodesy, provenance, classifyUk}) {
  if (!Array.isArray(features) || !vicinity?.stationRecords || !vicinity?.exploreVicinity ||
      !vicinity?.validCoordinate || !geodesy?.distanceKm || !geodesy?.representativePoint ||
      !geodesy?.voltagesKv || typeof classifyUk !== 'function') throw Error('Missing producer dependencies');
  const {source, revision, coverage, licence, attribution} = provenance || {};
  if (typeof source !== 'string' || !source.trim() || !/^[a-f0-9]{40}$/.test(revision || '') ||
      !['partial','declared-complete','synthetic'].includes(coverage) ||
      typeof licence !== 'string' || !licence.trim() || typeof attribution !== 'string' || !attribution.trim())
    throw Error('Explicit source, pinned revision, coverage and rights required');
  const nations = new Set(['England','Scotland','Wales','Northern Ireland']);
  const rows = new Map(), rejected = {unlocated:0, unidentifiable:0, outsideOrUnknown:0, duplicate:0, conflict:0};
  const ambiguous = new Set();
  for (const f of features) {
    // Per-feature conversion avoids collapsing distinct IDs at coincident locations.
    const row = vicinity.stationRecords([f], geodesy)[0];
    if (!row) { rejected.unlocated++; continue; }
    const rawId = f?.id ?? f?.properties?.id;
    if (!((typeof rawId === 'string' && rawId.trim() === rawId && rawId.length > 0 && rawId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(rawId)) ||
        (typeof rawId === 'number' && Number.isSafeInteger(rawId)))) { rejected.unidentifiable++; continue; }
    const nation = classifyUk(row.at);
    if (!nations.has(nation)) { rejected.outsideOrUnknown++; continue; }
    const key = String(rawId);
    if (ambiguous.has(key)) { rejected.conflict++; continue; }
    const record = {...row, id:key, nation, identity:{source,id:key}, destinationKind:'mapped-asset-reference', accessStatus:'unknown', navigationPermitted:false};
    if (rows.has(key)) {
      if (JSON.stringify(rows.get(key)) === JSON.stringify(record)) rejected.duplicate++;
      else { rows.delete(key); ambiguous.add(key); rejected.conflict++; }
    } else rows.set(key, record);
  }
  const snapshot = [...rows.values()];
  const copy = row => ({...row, at:[...row.at], kv:[...row.kv], bands:[...row.bands], identity:{...row.identity}});
  return {
    provenance:{source,revision,coverage,licence,attribution},
    counts:{input:features.length,eligible:snapshot.length,...rejected},
    search({origin,radius,bands,limit=50}) {
      if (!vicinity.validCoordinate(origin?.at) || !nations.has(classifyUk(origin.at))) throw Error('Origin outside verified UK classification');
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Array.isArray(bands) ||
          bands.some(b=>!vicinity.VOLTAGE_BANDS.some(v=>v[0]===b))) throw Error('Invalid search bounds');
      const result = vicinity.exploreVicinity({origin,radius,bands,records:snapshot,geodesy,limit});
      return {...result, shown:result.shown.map(copy), coverage, navigable:false,
        statement:result.statement+' Mapped reference points are not entrances or permission to enter.'};
    },
    get(id) { const row=rows.get(String(id)); return row ? copy(row) : null; }
  };
}
