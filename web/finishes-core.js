// 内装の仕上げの解決（画面に依存しない部分）。scripts/finishes.py の resolve() と同じ規則で、
// tests/test_finishes.py が両者の結果の一致を確認する。
//   面ごとの割当（壁のアクセントクロスと、天井の部分の面）→ 部屋×部位の割当 の順に決まり、割当のない面は含めない。
const FINISH_PARTS = ['floor', 'wall', 'ceiling'];
const FINISH_CANDIDATE_PARTS = {floor: ['floor'], cloth: ['wall', 'ceiling'], furniture: []};
const FINISH_PART_LABELS = {floor: '床', wall: '壁', ceiling: '天井'};
// 案は自宅の案（zone: home）と民泊の案（zone: guest）に分かれる（2026-11-10）。表示中の案は区分ごとに1つ（activeSchemes）
const FINISH_ZONES = ['home', 'guest'];
const FINISH_ZONE_LABELS = {home: '自宅', guest: '民泊'};

// 表示中の自宅の案と民泊の案を1つにまとめた案（scripts/finishes.py の active_scheme() と同じ。
// 案は自分の区分の分だけを持つので、割当・面・家具の色・設備の選択は重ならない）
function finishesActiveScheme(doc){
  const merged = {id: 'active', name: '表示中の案', assignments: {}, surfaces: {}, furniture: {}, productOptions: {}};
  for(const zone of FINISH_ZONES){
    const scheme = doc.schemes.find(s=>s.id === (doc.activeSchemes || {})[zone]);
    if(scheme) for(const key of Object.keys(merged).filter(k=>typeof merged[k] === 'object')) Object.assign(merged[key], scheme[key] || {});
  }
  return merged;
}
const finishesSchemeOf = (doc, schemeId)=>schemeId ? doc.schemes.find(s=>s.id === schemeId) : finishesActiveScheme(doc);

// 面ごとの割当（scheme.surfaces）で別の候補にできる面：壁（アクセントクロス）と、天井の部分の面
// （2026-11-11：自宅LDKのキッチン側の平らな天井）。scripts/finishes.py の takes_surface_override() と同じ
const finishesTakesSurface = surface=>surface.kind === 'wall' || (surface.kind === 'ceiling' && !!surface.part);

function finishesResolve(doc, registry, schemeId){
  const scheme = finishesSchemeOf(doc, schemeId);
  if(!scheme) return {};
  const candidates = Object.fromEntries(doc.candidates.map(c=>[c.id, c]));
  const result = {};
  for(const surface of registry){
    let cid = finishesTakesSurface(surface) ? (scheme.surfaces || {})[surface.id] : undefined;
    cid = cid || ((scheme.assignments || {})[surface.roomId] || {})[surface.kind];
    if(cid && candidates[cid]) result[surface.id] = candidates[cid];
  }
  return result;
}

// 家具・布の色：{家具id: {役割: 候補}}（scripts/finishes.py の furniture_colors() と同じ。
// 今ない家具・その形で変えられない役割は、描くとき（applyFurnitureColors）に除く）
function finishesFurnitureColors(doc, schemeId){
  const scheme = finishesSchemeOf(doc, schemeId);
  if(!scheme) return {};
  const candidates = Object.fromEntries(doc.candidates.map(c=>[c.id, c]));
  const result = {};
  for(const [furnitureId, roles] of Object.entries(scheme.furniture || {})){
    const picked = Object.fromEntries(Object.entries(roles).filter(([, cid])=>candidates[cid]).map(([role, cid])=>[role, candidates[cid]]));
    if(Object.keys(picked).length) result[furnitureId] = picked;
  }
  return result;
}

// 正本と比べて変わった項目の数（保存ボタン・編集ドックの件数表示用）
function finishesChangeCount(source, draft){
  if(!draft) return 0;
  source = source || {candidates: [], schemes: [], activeSchemes: {}};
  let n = 0;
  const key = c=>JSON.stringify(c);
  const sc = Object.fromEntries(source.candidates.map(c=>[c.id, key(c)]));
  const dc = Object.fromEntries(draft.candidates.map(c=>[c.id, key(c)]));
  for(const id of new Set([...Object.keys(sc), ...Object.keys(dc)])) if(sc[id] !== dc[id]) n++;
  const ss = Object.fromEntries(source.schemes.map(s=>[s.id, s]));
  const ds = Object.fromEntries(draft.schemes.map(s=>[s.id, s]));
  for(const id of new Set([...Object.keys(ss), ...Object.keys(ds)])){
    const a = ss[id], b = ds[id];
    if(!a || !b){ n++; continue; }
    if(a.name !== b.name) n++;
    const rooms = new Set([...Object.keys(a.assignments || {}), ...Object.keys(b.assignments || {})]);
    for(const r of rooms) for(const p of FINISH_PARTS)
      if(((a.assignments || {})[r] || {})[p] !== ((b.assignments || {})[r] || {})[p]) n++;
    const surfaces = new Set([...Object.keys(a.surfaces || {}), ...Object.keys(b.surfaces || {})]);
    for(const s of surfaces) if((a.surfaces || {})[s] !== (b.surfaces || {})[s]) n++;
    // 採用品の選択肢（例：キッチンのIH背面）。{家具id: {選択肢: 値}}
    const po = a.productOptions || {}, pd = b.productOptions || {};
    for(const f of new Set([...Object.keys(po), ...Object.keys(pd)]))
      for(const k of new Set([...Object.keys(po[f] || {}), ...Object.keys(pd[f] || {})]))
        if((po[f] || {})[k] !== (pd[f] || {})[k]) n++;
    // 家具・布の色。{家具id: {役割: 候補id}}
    const fo = a.furniture || {}, fd = b.furniture || {};
    for(const f of new Set([...Object.keys(fo), ...Object.keys(fd)]))
      for(const r of new Set([...Object.keys(fo[f] || {}), ...Object.keys(fd[f] || {})]))
        if((fo[f] || {})[r] !== (fd[f] || {})[r]) n++;
  }
  for(const zone of FINISH_ZONES) if((source.activeSchemes || {})[zone] !== (draft.activeSchemes || {})[zone]) n++;
  return n;
}
