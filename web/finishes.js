// 内装の仕上げ（2026-10 UI整理・段階3a）：床・壁・天井の色をブラウザで選び、内覧で確かめる。
//
// - 正本は data/finishes.json（generated/house-data.js の FINISHES_DOC）。画面での変更は下書きとして
//   localStorage（ryuka-finishes-draft-v2）に置き、［保存］（web/local-app.js）で正本へ反映する。
// - 表示は内覧（一人称）の部屋の内側だけ：既存の壁・天井・床の上に、部屋ごとの薄い「仕上げの面」を
//   重ねる（壁は窓を切り欠き、勾配天井の部屋は天井なりの高さにする）。壁の本体は2部屋で共有のため、
//   色を変えると反対側の部屋まで変わらないよう、面は部屋の内側に別に置く。
// - 案は自宅の案（zone: home）と民泊の案（zone: guest）に分かれ、表示中の案も区分ごとに1つ（2026-11-10）。
//   編集は選んだ部屋の区分の案に書く。内覧の上部の「案」切替は、今いる部屋の区分の案だけを出す。
// - 編集ドックの「仕上げ」タブ（web/editor-shell.js）と、内覧の上部の「案」切替をここで作る。
// 解決の規則は web/finishes-core.js（Pythonの scripts/finishes.py と同じ）。
(function(){
'use strict';

const DRAFT_KEY = 'ryuka-finishes-draft-v2';
try{ localStorage.removeItem('ryuka-finishes-draft-v1'); }catch(e){}   // 家全体で1つの案だった頃の下書き（形が違うので使えない）
const EMPTY_DOC = {schemaVersion: '2.0.0', note: '', candidates: [],
  schemes: [{id: 'home-a', name: '標準', zone: 'home', assignments: {}, surfaces: {}},
    {id: 'guest-a', name: '標準', zone: 'guest', assignments: {}, surfaces: {}}], activeSchemes: {home: 'home-a', guest: 'guest-a'}};
const SOURCE = FINISHES_DOC || EMPTY_DOC;
const clone = v=>JSON.parse(JSON.stringify(v));

let doc = (()=>{
  try{
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if(saved && saved.schemaVersion === '2.0.0' && Array.isArray(saved.candidates) && Array.isArray(saved.schemes)) return saved;
  }catch(e){}
  return clone(SOURCE);
})();

// 下書きの保存（web/editor-shell.js が包んで「元に戻す」の記録に使う）
window.saveFinishesDraft = function(){
  try{
    if(JSON.stringify(doc) === JSON.stringify(SOURCE)) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
  }catch(e){}
};
// 左パネルの「商品の色・サイズ」（interior-white-model.html）も、案の選択肢の変化に合わせて作り直す
const refreshProductControlsNow = ()=>{ if(typeof refreshProductControls === 'function') refreshProductControls(); };
function commit(){ saveFinishesDraft(); render(); refreshProducts(); refreshFurnitureColors(); refreshPanel(); refreshWalkHud(); refreshProductControlsNow(); }

// ---------- 採用品の選択肢（例：キッチンのIH背面）。案ごとに productOptions {家具id: {選択肢: 値}} ----------
// 選択肢のある採用品（data/products/*.json の options）。家具の描画（web/products.js）はこの案の値で作る
const optionItems = (typeof PRODUCT_PARTS === 'undefined' ? [] : FURNITURE_ITEMS)
  .map(item=>({item, product: FURNITURE_CATALOG[item.type] && PRODUCT_PARTS[FURNITURE_CATALOG[item.type].product]}))
  .filter(x=>x.product && Object.keys(x.product.options).length);
window.productOptionsFor = id=>(finishesActiveScheme(doc).productOptions[id]) || {};
let drawnOptions = null;
function refreshProducts(){
  const now = JSON.stringify(optionItems.map(x=>productOptionsFor(x.item.id)));
  if(now === drawnOptions) return;
  drawnOptions = now;
  optionItems.forEach(x=>rebuildFurnitureItem(x.item.id));
  if(typeof selectedFurnitureId !== 'undefined' && optionItems.some(x=>x.item.id === selectedFurnitureId)) setSelectedFurniture(selectedFurnitureId);
}
function setProductOption(id, key, value, fallback){
  const s = schemeForItem(id);
  const picks = {...((s.productOptions || {})[id] || {})};
  if(value === fallback) delete picks[key]; else picks[key] = value;
  s.productOptions = {...(s.productOptions || {}), [id]: picks};
  if(!Object.keys(picks).length) delete s.productOptions[id];
  if(!Object.keys(s.productOptions).length) delete s.productOptions;
  commit();
}

// ---------- 家具・布の色。案ごとに furniture {家具id: {役割: 候補id}}（役割は data/furniture-color-roles.json） ----------
window.furnitureColorsFor = id=>finishesFurnitureColors(doc)[id] || {};
let drawnColors = null;
function refreshFurnitureColors(){
  const now = finishesFurnitureColors(doc);
  if(drawnColors && JSON.stringify(now) === JSON.stringify(drawnColors)) return;
  const before = drawnColors || {};
  drawnColors = now;
  const changed = [...new Set([...Object.keys(before), ...Object.keys(now)])]
    .filter(id=>JSON.stringify(before[id]) !== JSON.stringify(now[id]));
  changed.forEach(id=>rebuildFurnitureItem(id));
  if(typeof selectedFurnitureId !== 'undefined' && changed.includes(selectedFurnitureId)) setSelectedFurniture(selectedFurnitureId);
}
// 色を変えられる役割（家具の形と、付けた小物の役割。interior-white-model.html の furnitureColorRoles()）。ない家具は null
const colorRolesOf = item=>{ const roles = furnitureColorRoles(item); return Object.keys(roles).length ? roles : null; };
function setFurnitureColor(id, role, candidateId){
  const s = schemeForItem(id);
  const roles = {...((s.furniture || {})[id] || {})};
  if(candidateId) roles[role] = candidateId; else delete roles[role];
  s.furniture = {...(s.furniture || {}), [id]: roles};
  if(!Object.keys(roles).length) delete s.furniture[id];
  if(!Object.keys(s.furniture).length) delete s.furniture;
  commit();
}

// ---------- 部屋・面の情報 ----------
const roomsById = {};
for(const level of [1, 2]) for(const r of (ROOMS_APPROX[level] || [])) if(r.id) roomsById[r.id] = {...r, level};
const roomName = id=>(roomsById[id] && roomsById[id].name) || id;

// ---------- 自宅の案・民泊の案 ----------
const zoneOfRoom = id=>(roomsById[id] && roomsById[id].zone) === 'guest' ? 'guest' : 'home';
const schemesOf = zone=>doc.schemes.filter(s=>s.zone === zone);
const schemeOfZone = zone=>doc.schemes.find(s=>s.id === (doc.activeSchemes || {})[zone]) || schemesOf(zone)[0];
const schemeForRoom = roomId=>schemeOfZone(zoneOfRoom(roomId));
function schemeForItem(furnitureId){   // 家具の案は、その家具がある部屋の区分の案
  const item = activeFurnitureItems().find(i=>i.id === furnitureId);
  return schemeForRoom(item && item.room);
}

function wallInfo(surface){
  // 壁の向き（H=東西に延びる／V=南北に延びる）、位置、範囲、部屋の内側の向き(+1/-1)、部屋から見た方角
  const room = roomsById[surface.roomId];
  if(!room || !surface.edge || surface.edge.length !== 2) return null;
  const [[x0, z0], [x1, z1]] = surface.edge;
  let orientation, at, from, to;
  if(Math.abs(z0 - z1) < 1e-6){ orientation = 'H'; at = z0; from = Math.min(x0, x1); to = Math.max(x0, x1); }
  else if(Math.abs(x0 - x1) < 1e-6){ orientation = 'V'; at = x0; from = Math.min(z0, z1); to = Math.max(z0, z1); }
  else return null;   // 斜めの境界（開口だけの框）は仕上げの対象外
  const poly = roomPolygonPoints(room), mid = (from + to)/2;
  const inside = d=>orientation === 'H' ? pointInPolygon(mid, at + d, poly) : pointInPolygon(at + d, mid, poly);
  const side = inside(0.15) ? 1 : inside(-0.15) ? -1 : 0;
  if(!side) return null;
  // 部屋の内側が+側（南／東）なら、その壁は部屋の北／西の壁
  const direction = orientation === 'H' ? (side > 0 ? '北' : '南') : (side > 0 ? '西' : '東');
  return {orientation, at, from, to, side, direction, length: to - from, level: room.level, room};
}
const walls = SURFACE_REGISTRY.filter(s=>s.kind === 'wall').map(s=>({surface: s, info: wallInfo(s)})).filter(w=>w.info);

// ---------- 見た目（内覧の部屋の内側に重ねる仕上げの面） ----------
const group = new THREE.Group();
walkGroup.add(group);
const materials = new Map();
function woodTexture(){
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
  const g = canvas.getContext('2d');
  const plank = 512/(1/0.15);   // 幅150mmの板（1枚=1m四方の模様）
  for(let row = 0; row*plank < 512; row++){
    const offset = (row % 3)*170;
    for(let x = -512; x < 512; x += 340){
      const shade = 234 + Math.floor(Math.random()*18);   // 板ごとの濃淡は控えめに（強いとまだらに見える）
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(x + offset, row*plank, 340, plank);
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2;
      g.strokeRect(x + offset, row*plank, 340, plank);
    }
    for(let i = 0; i < 18; i++){   // 木目の細い線
      g.strokeStyle = `rgba(0,0,0,${0.03 + Math.random()*0.05})`; g.lineWidth = 1;
      const y = row*plank + Math.random()*plank;
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y + 4, 340, y - 4, 512, y + 2); g.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
let woodMap = null;
// 面の向きごとの陰影（候補の色にかける係数）。この画面の照明は白模型を白く見せる強さで、
// 照明を受ける素材だと中間色が白飛びする（床は約1.7倍・天井は0.75倍）。色を見比べる目的のため、
// 仕上げの面は照明を受けない素材で「候補の色そのもの」を出し、形がわかる程度の陰影だけ付ける。
// ツヤ（roughness）の違いはここでは出さない（UEで確認）。
const SHADE = {floor: 1, ceiling: 0.95, H: 0.92, V: 0.86};
function materialFor(candidate, shade){
  const key = `${candidate.colorHex}|${candidate.pattern}|${shade}`;
  if(!materials.has(key)){
    const options = {color: new THREE.Color('#' + candidate.colorHex).multiplyScalar(shade), side: THREE.DoubleSide};
    if(candidate.pattern === 'wood') options.map = woodMap || (woodMap = woodTexture());
    if(candidate.pattern === 'tile') options.map = tileMap;   // 本体の30cm角タイルの模様
    materials.set(key, new THREE.MeshBasicMaterial(options));
  }
  return materials.get(key);
}
function addRect(orientation, offsetAt, from, to, y0, y1, material){
  const geo = new THREE.PlaneGeometry(to - from, y1 - y0);
  // 模様（木目・タイル）を1m=1枚でそろえる：窓で切り分けた面どうしでも柄がつながるよう実寸の座標にする
  const uv = geo.attributes.uv;
  for(let i = 0; i < uv.count; i++) uv.setXY(i, from + uv.getX(i)*(to - from), y0 + uv.getY(i)*(y1 - y0));
  const mesh = new THREE.Mesh(geo, material);
  const mid = (from + to)/2;
  const [sx, sz] = orientation === 'H' ? toScene(mid, offsetAt) : toScene(offsetAt, mid);
  mesh.position.set(sx, (y0 + y1)/2, sz);
  if(orientation === 'V') mesh.rotation.y = Math.PI/2;
  group.add(mesh);
}
function addWallSkin(info, material){
  const baseY = info.level === 1 ? LEVELS.fl1 : LEVELS.fl2;
  const bottom = Math.min(0, info.room.floorOffsetM || 0);   // 一段下がった土間・玄関は床から貼る
  const segs = (wallSegmentsByLevel[info.level] || []).filter(s=>s.orientation === info.orientation
    && Math.abs(s.at - info.at) < 0.05 && s.guardHeight === undefined && s.to > info.from + 0.01 && s.from < info.to - 0.01);
  const niches = nicheGapsForLevel(info.level).filter(n=>n.orientation === info.orientation
    && Math.abs(n.at - info.at) < WALL_WINDOW_TOL);
  // くぼみの開く面は穴を開ける。反対の面は、壁より深いニッチ（箱が張り出す）のときだけ開ける
  const wins = windowGapsForLevel(info.level, true).filter(w=>w.orientation === info.orientation
    && Math.abs(w.at - info.at) < WALL_WINDOW_TOL)
    .concat(niches.filter(n=>{ const s = nicheWallSegment(n); return n.side === info.side || (s && n.depth >= s.thick - 1e-6); }));
  // 1つのニッチを2つの面で二重に貼らないよう、中心がこの面の範囲にあるものだけ内側を貼る
  for(const n of niches) if(n.center >= info.from && n.center < info.to) addNicheSkin(n, info, material);
  for(const s of segs){
    const a = Math.max(s.from, info.from), b = Math.min(s.to, info.to);
    if(b - a < 0.01) continue;
    const offsetAt = s.at + info.side*(s.thick/2 + 0.004);
    if(info.level === 1 && nearSlopedCeiling(s)){
      if(info.orientation === 'V'){   // 勾配天井：上端が傾いた台形の面
        ceilingProfileRuns(s.at, a, b).forEach(run=>
          slopedTopWallPanel(offsetAt, run.from, run.to, baseY, run.topA, run.topB, 0.004, material, null, group));
        continue;
      }
      heightRunsForHWall({...s, from: a, to: b}).forEach(run=>{
        let rects = [{x0: run.from, x1: run.to, z0: bottom, z1: run.height}];
        wins.forEach(w=>{ rects = rects.flatMap(r=>rectMinusRect(r, {x0: w.from, x1: w.to, z0: w.sill, z1: w.sill + w.h})); });
        rects.forEach(r=>addRect('H', offsetAt, r.x0, r.x1, baseY + r.z0, baseY + r.z1, material));
      });
      continue;
    }
    let rects = [{x0: a, x1: b, z0: bottom, z1: CEIL_H}];
    wins.forEach(w=>{ rects = rects.flatMap(r=>rectMinusRect(r, {x0: w.from, x1: w.to, z0: w.sill, z1: w.sill + w.h})); });
    rects.forEach(r=>addRect(info.orientation, offsetAt, r.x0, r.x1, baseY + r.z0, baseY + r.z1, material));
  }
}
// ニッチ：開く面の部屋の仕上げをくぼみの内側（奥・上下・左右）に貼る。反対の面の部屋は、
// 壁より深いニッチなら張り出した箱の外側に貼る（浅いニッチは壁の面がそのまま残る）
function addNicheSkin(n, info, material){
  const s = nicheWallSegment(n);
  if(!s) return;
  const baseY = n.level === 1 ? LEVELS.fl1 : LEVELS.fl2, E = 0.004;
  const y0 = baseY + n.sill, y1 = baseY + n.sill + n.h, cross = n.orientation === 'H' ? 'V' : 'H';
  const flat = (u0, u1, c0, c1, y)=>floorPolygonMesh(n.orientation === 'H'
    ? [[u0, c0], [u1, c0], [u1, c1], [u0, c1]] : [[c0, u0], [c1, u0], [c1, u1], [c0, u1]], y, material, group);
  const open = n.at + n.side*s.thick/2, back = open - n.side*n.depth;
  if(n.side === info.side){
    const c0 = Math.min(open, back), c1 = Math.max(open, back);
    addRect(n.orientation, back + n.side*E, n.from, n.to, y0, y1, material);
    addRect(cross, n.from + E, c0, c1, y0, y1, material);
    addRect(cross, n.to - E, c0, c1, y0, y1, material);
    flat(n.from, n.to, c0, c1, y0 + E);
    flat(n.from, n.to, c0, c1, y1 - E);
  }else if(n.depth >= s.thick - 1e-6){
    const S = NICHE_SHELL + E, far = n.at - n.side*s.thick/2, c0 = Math.min(far, back), c1 = Math.max(far, back);
    addRect(n.orientation, back - n.side*S, n.from - S, n.to + S, y0 - S, y1 + S, material);
    addRect(cross, n.from - S, c0, c1, y0, y1, material);
    addRect(cross, n.to + S, c0, c1, y0, y1, material);
    flat(n.from - S, n.to + S, c0, c1, y0 - S);
    flat(n.from - S, n.to + S, c0, c1, y1 + S);
  }
}
function overlapsStairOpening(room, level){
  const xs = roomPolygonPoints(room).map(p=>p[0]), zs = roomPolygonPoints(room).map(p=>p[1]);
  const box = {x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs)};
  return STAIRS.some(s=>s.opening && s.levelFrom === level && s.opening.x0 < box.x1 && s.opening.x1 > box.x0
    && s.opening.z0 < box.z1 && s.opening.z1 > box.z0);
}
function addFloorSkin(room, material){
  if(room.level === 2 && overlapsStairOpening(room, 1)) return;   // 吹き抜けを床でふさがない
  const y = (room.level === 1 ? LEVELS.fl1 : LEVELS.fl2) + (room.floorOffsetM || 0) + 0.006;
  floorPolygonMesh(roomPolygonPoints(room), y, material, group);
}
function addCeilingSkin(room, material){
  if(overlapsStairOpening(room, room.level)) return;   // 階段の上は吹き抜け
  const baseY = room.level === 1 ? LEVELS.fl1 : LEVELS.fl2;
  const pieces = room.level === 1 ? SLOPED_CEILING_PIECES.filter(p=>p.roomId === room.id) : [];
  if(!pieces.length){
    floorPolygonMesh(roomPolygonPoints(room), baseY + CEIL_H - 0.02, material, group);
    return;
  }
  for(const p of pieces){
    if(p.sloped){
      const yN = yAtHiraya(p.z0, p.base, p.pitch) - p.roofThickness/2 - CEILING_ALLOWANCE - 0.02;
      const yS = yAtHiraya(p.z1, p.base, p.pitch) - p.roofThickness/2 - CEILING_ALLOWANCE - 0.02;
      walkSlopedCeilingPanel(p.x0, p.x1, p.z0, yN, p.z1, yS, 0.004, material, group);
    }else{
      floorPolygonMesh([[p.x0, p.z0], [p.x1, p.z0], [p.x1, p.z1], [p.x0, p.z1]], baseY + CEIL_H - 0.02, material, group);
    }
  }
}
function render(){
  group.children.slice().forEach(child=>{ group.remove(child); if(child.geometry) child.geometry.dispose(); });
  const resolved = finishesResolve(doc, SURFACE_REGISTRY);
  for(const surface of SURFACE_REGISTRY){
    const candidate = resolved[surface.id];
    if(!candidate) continue;
    const room = roomsById[surface.roomId];
    if(!room) continue;
    if(surface.kind === 'floor') addFloorSkin(room, materialFor(candidate, SHADE.floor));
    else if(surface.kind === 'ceiling') addCeilingSkin(room, materialFor(candidate, SHADE.ceiling));
    else{
      const w = walls.find(x=>x.surface.id === surface.id);
      if(w) addWallSkin(w.info, materialFor(candidate, SHADE[w.info.orientation]));
    }
  }
}
// 窓・ドアの編集で壁が作り直されたら、仕上げの面（窓の切り欠き）も合わせる
const originalRebuildWalkWalls = window.rebuildWalkWalls;
window.rebuildWalkWalls = function(...args){ const r = originalRebuildWalkWalls.apply(this, args); render(); return r; };

// ---------- 編集ドックの「仕上げ」タブ ----------
let panel = null, selectedRoom = null;
const el = (tag, attrs, ...children)=>{
  const node = document.createElement(tag);
  for(const [k, v] of Object.entries(attrs || {})){
    if(k === 'class') node.className = v;
    else if(k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if(v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for(const c of children.flat()) if(c !== null && c !== undefined && c !== false)
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
};
const candidateById = id=>doc.candidates.find(c=>c.id === id);
const swatch = c=>el('span', {class: 'fin-swatch', style: c ? `background:#${c.colorHex}` : 'background:repeating-linear-gradient(45deg,#fff,#fff 3px,#e3e6e9 3px,#e3e6e9 6px)'});
const candidateLabel = c=>c ? `${c.name}${c.status === 'provisional' ? '（仮）' : ''}${c.code ? ' ' + c.code : ''}` : '（標準のまま）';
function dialog(...args){ return window.RyukaLocalApp.dialog(...args); }

function candidateSelect(parts, value, onChange, emptyLabel){
  const kinds = Object.entries(FINISH_CANDIDATE_PARTS).filter(([, ps])=>parts.some(p=>ps.includes(p))).map(([k])=>k);
  const select = el('select', {onchange: e=>onChange(e.target.value || null)},
    el('option', {value: ''}, emptyLabel || '（標準のまま）'),
    doc.candidates.filter(c=>kinds.includes(c.kind)).map(c=>el('option', {value: c.id, selected: c.id === value}, candidateLabel(c))));
  return select;
}
function setAssignment(roomId, part, candidateId){
  const s = schemeForRoom(roomId);
  s.assignments = s.assignments || {};
  const parts = {...(s.assignments[roomId] || {})};
  if(candidateId) parts[part] = candidateId; else delete parts[part];
  if(Object.keys(parts).length) s.assignments[roomId] = parts; else delete s.assignments[roomId];
  commit();
}
function setAccent(surfaceId, candidateId){
  const s = schemeForRoom((walls.find(w=>w.surface.id === surfaceId) || {surface: {}}).surface.roomId);
  s.surfaces = {...(s.surfaces || {})};
  if(candidateId) s.surfaces[surfaceId] = candidateId; else delete s.surfaces[surfaceId];
  commit();
}

async function editScheme(action, zone){
  const current = schemeOfZone(zone);
  if(action === 'copy'){
    const id = zone + '-' + Date.now().toString(36);
    let name = current.name + 'のコピー';
    for(let n = 2; schemesOf(zone).some(s=>s.name === name); n++) name = `${current.name}のコピー${n}`;
    const at = doc.schemes.indexOf(current) + 1;   // 元の案の次に置く
    doc.schemes.splice(at, 0, {...clone(current), id, name});
    doc.activeSchemes = {...doc.activeSchemes, [zone]: id};
  }else if(action === 'rename'){
    const input = el('input', {type: 'text', value: current.name, class: 'fin-input'});
    const v = await dialog('案の名前を変える', input, [{label: 'やめる', value: null}, {label: '変える', value: 'ok', kind: 'primary'}]);
    if(v !== 'ok' || !input.value.trim()) return;
    current.name = input.value.trim();
  }else if(action === 'delete'){
    if(schemesOf(zone).length < 2){ await dialog('削除できません', el('p', null, `${FINISH_ZONE_LABELS[zone]}の案が1つだけのときは削除できません。`), [{label: '閉じる', value: null, kind: 'primary'}]); return; }
    const v = await dialog(`「${current.name}」を削除しますか？`, el('p', null, `この${FINISH_ZONE_LABELS[zone]}の案の割当がすべて消えます（保存前なら「元に戻す」で戻せます）。`),
      [{label: 'やめる', value: null}, {label: '削除する', value: 'ok', kind: 'danger'}]);
    if(v !== 'ok') return;
    doc.schemes = doc.schemes.filter(s=>s.id !== current.id);
    doc.activeSchemes = {...doc.activeSchemes, [zone]: schemesOf(zone)[0].id};
  }
  commit();
}

async function editCandidate(existing){
  const c = existing ? clone(existing) : {id: '', kind: 'cloth', name: '', maker: '', code: '', colorHex: 'f3f2ee',
    roughness: 0.85, pattern: 'plain', status: 'product', note: ''};
  const f = {
    kind: el('select', null, el('option', {value: 'floor', selected: c.kind === 'floor'}, '床材（フローリング等）'),
      el('option', {value: 'cloth', selected: c.kind === 'cloth'}, 'クロス（壁・天井）'),
      el('option', {value: 'furniture', selected: c.kind === 'furniture'}, '家具・布（ソファ・木部・カーテンなど）')),
    name: el('input', {type: 'text', value: c.name, class: 'fin-input', placeholder: '例：ナチュラルオーク'}),
    maker: el('input', {type: 'text', value: c.maker || '', class: 'fin-input', placeholder: '例：サンゲツ'}),
    code: el('input', {type: 'text', value: c.code || '', class: 'fin-input', placeholder: '例：SP-2101'}),
    color: el('input', {type: 'color', value: '#' + c.colorHex}),
    gloss: el('select', null, ...[[0.9, 'つや消し'], [0.6, 'ふつう'], [0.35, 'つやあり']].map(([v, l])=>
      el('option', {value: v, selected: Math.abs(c.roughness - v) < 0.13}, l))),
    pattern: el('select', null, ...[['wood', '木目'], ['plain', '無地'], ['tile', 'タイル']].map(([v, l])=>
      el('option', {value: v, selected: c.pattern === v}, l))),
    product: el('input', {type: 'checkbox', checked: c.status === 'product'}),
    note: el('input', {type: 'text', value: c.note || '', class: 'fin-input'}),
  };
  const row = (label, input)=>el('label', {class: 'fin-form-row'}, el('span', null, label), input);
  const body = el('div', {class: 'fin-form'}, row('種類', f.kind), row('名前', f.name), row('メーカー', f.maker), row('品番', f.code),
    row('色', f.color), row('光沢', f.gloss), row('柄', f.pattern),
    el('label', {class: 'fin-form-row'}, f.product, el('span', null, '実際の商品（カタログ・サンプルで確認した品番）')),
    row('メモ', f.note),
    el('p', {class: 'ra-note'}, '色はカタログやメーカーサイトの画像に近い色を選んでください。画面の色は実物と一致しません。'));
  const buttons = [{label: 'やめる', value: null}];
  if(existing) buttons.push({label: '削除', value: 'delete', kind: 'danger'});
  buttons.push({label: existing ? '変更する' : '追加する', value: 'ok', kind: 'primary'});
  const v = await dialog(existing ? '候補を変える' : '候補を追加', body, buttons);
  if(v === 'delete'){
    const used = doc.schemes.filter(s=>Object.values(s.assignments || {}).some(p=>Object.values(p).includes(existing.id))
      || Object.values(s.surfaces || {}).includes(existing.id)
      || Object.values(s.furniture || {}).some(r=>Object.values(r).includes(existing.id)));
    if(used.length){
      await dialog('削除できません', el('p', null, `「${existing.name}」は ${used.map(s=>s.name).join('・')} で使われています。先に割当を外してください。`),
        [{label: '閉じる', value: null, kind: 'primary'}]);
      return;
    }
    doc.candidates = doc.candidates.filter(x=>x.id !== existing.id);
    commit(); return;
  }
  if(v !== 'ok') return;
  if(!f.name.value.trim()){ await dialog('名前を入れてください', el('p', null, '候補には名前が必要です。'), [{label: '閉じる', value: null, kind: 'primary'}]); return; }
  const updated = {...c, id: existing ? existing.id : 'cand-' + Date.now().toString(36), kind: f.kind.value,
    name: f.name.value.trim(), maker: f.maker.value.trim(), code: f.code.value.trim(),
    colorHex: f.color.value.replace('#', '').toLowerCase(), roughness: Number(f.gloss.value), pattern: f.pattern.value,
    status: f.product.checked ? 'product' : 'provisional', note: f.note.value.trim()};
  if(existing && existing.kind !== updated.kind){
    // 種類を変えると、合わない部位に付いた割当が無効になるため外す
    for(const s of doc.schemes){
      for(const parts of Object.values(s.assignments || {}))
        for(const [p, id] of Object.entries(parts)) if(id === updated.id && !FINISH_CANDIDATE_PARTS[updated.kind].includes(p)) delete parts[p];
      for(const [sid, id] of Object.entries(s.surfaces || {})) if(id === updated.id && updated.kind !== 'cloth') delete s.surfaces[sid];
      for(const [fid, roles] of Object.entries(s.furniture || {})){
        for(const [r, id] of Object.entries(roles)) if(id === updated.id && updated.kind !== 'furniture') delete roles[r];
        if(!Object.keys(roles).length) delete s.furniture[fid];
      }
    }
  }
  if(existing) doc.candidates = doc.candidates.map(x=>x.id === existing.id ? updated : x);
  else doc.candidates.push(updated);
  commit();
}

// 仕様一覧：全部屋を並べ、決まっていない部位は「未定」と出す（打ち合わせ前の確認表を兼ねる）
function specList(){
  const rooms = Object.values(roomsById).sort((a, b)=>FINISH_ZONES.indexOf(zoneOfRoom(a.id)) - FINISH_ZONES.indexOf(zoneOfRoom(b.id))
    || a.level - b.level || a.name.localeCompare(b.name, 'ja'));
  const cell = id=>{ const c = candidateById(id); return c ? `${c.name}${c.maker || c.code ? `（${[c.maker, c.code].filter(Boolean).join(' ')}）` : ''}${c.status === 'provisional' ? '〔仮〕' : ''}` : ''; };
  const decided = {home: 0, guest: 0}, total = {home: 0, guest: 0};
  const rows = rooms.map(room=>{
    const s = schemeForRoom(room.id), zone = zoneOfRoom(room.id);
    const parts = (s.assignments || {})[room.id] || {};
    const used = FINISH_PARTS.map(p=>candidateById(parts[p]));
    total[zone]++;
    if(used.every(Boolean)) decided[zone]++;
    const accents = walls.filter(w=>w.surface.roomId === room.id && (s.surfaces || {})[w.surface.id])
      .map(w=>`${w.info.direction}の壁（${w.info.length.toFixed(2)}m）：${cell(s.surfaces[w.surface.id])}`);
    return [`${FINISH_ZONE_LABELS[zone]} ${room.level}F ${room.name}`, cell(parts.floor), cell(parts.wall), cell(parts.ceiling), accents.join('／')];
  });
  const equipment = optionItems.flatMap(({item, product})=>Object.entries(product.options).map(([key, o])=>
    `${item.label}・${o.label}：${o.choices[productOptionsFor(item.id)[key] ?? o.default].label}`));
  // 家具・布の色（この案で決めたもの）。部屋の順に「部屋 家具・部品：候補」
  const furniture = rooms.flatMap(room=>activeFurnitureItems().filter(item=>item.room === room.id && colorRolesOf(item))
    .flatMap(item=>{ const s = schemeForRoom(room.id); return Object.entries(colorRolesOf(item)).filter(([role])=>((s.furniture || {})[item.id] || {})[role])
      .map(([role, label])=>`${room.name} ${item.label}・${label}：${cell(s.furniture[item.id][role])}`); }));
  const label = FINISH_ZONES.map(z=>`${FINISH_ZONE_LABELS[z]}：${schemeOfZone(z).name}`).join('／');
  return {title: `内装仕上げ一覧（${label}）`, head: ['部屋', '床', '壁', '天井', 'アクセント壁'], rows, equipment, furniture,
    summary: FINISH_ZONES.map(z=>`${FINISH_ZONE_LABELS[z]}の床・壁・天井がすべて決まった部屋：${decided[z]}／${total[z]}`).join('　')};
}
const specText = (c, i)=>c || (i >= 1 && i <= 3 ? '未定' : '—');
async function showSpecList(){
  const spec = specList();
  const table = el('table', {class: 'fin-spec'}, el('thead', null, el('tr', null, spec.head.map(h=>el('th', null, h)))),
    el('tbody', null, spec.rows.map(r=>el('tr', null, r.map((c, i)=>el('td', {class: c || i === 0 ? null : 'fin-undecided'}, specText(c, i)))))));
  const v = await dialog(spec.title, el('div', null, el('p', {class: 'fin-spec-summary'}, spec.summary),
    spec.equipment.map(t=>el('p', {class: 'fin-spec-summary'}, t)),
    el('div', {class: 'fin-spec-wrap'}, table),
    spec.furniture.length ? el('div', {class: 'ra-sub-title'}, '家具・布の色') : null,
    spec.furniture.map(t=>el('p', {class: 'fin-spec-summary'}, t)),
    el('p', {class: 'ra-note'}, '〔仮〕は一般的な定番色の仮候補です。施工会社のカタログで品番を決めたら、候補を実際の商品に置き換えてください。')),
    // 閲覧版（claude.aiのページ）は印刷・別ウィンドウを開けないので、印刷用のボタンを出さない
    window.RYUKA_VIEWER ? [{label: '閉じる', value: null, kind: 'primary'}]
      : [{label: '閉じる', value: null}, {label: '印刷用に開く', value: 'print', kind: 'primary'}]);
  if(v !== 'print') return;
  const w = window.open('', '_blank');
  if(!w) return;
  const esc = t=>String(t).replace(/[&<>]/g, ch=>({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[ch]));
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(spec.title)}</title>
<style>body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;padding:24px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #999;padding:6px 8px;font-size:12px;text-align:left;vertical-align:top}th{background:#eee}
.u{color:#999}</style>
<h2>${esc(spec.title)}</h2><p style="font-size:12px">${esc(spec.summary)}</p>
${spec.equipment.map(t=>`<p style="font-size:12px">${esc(t)}</p>`).join('')}
<table><tr>${spec.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>
${spec.rows.map(r=>`<tr>${r.map((c, i)=>`<td${c || i === 0 ? '' : ' class="u"'}>${esc(specText(c, i))}</td>`).join('')}</tr>`).join('')}</table>
${spec.furniture.length ? `<h3 style="font-size:14px">家具・布の色</h3>${spec.furniture.map(t=>`<p style="font-size:12px;margin:2px 0">${esc(t)}</p>`).join('')}` : ''}
<p style="font-size:11px;color:#666">〔仮〕は仮候補。画面の色は実物と一致しません。</p>`);
  w.document.close(); w.focus(); w.print();
}

function walkIntoRoom(roomId){
  const room = roomsById[roomId];
  if(!room) return;
  const poly = roomPolygonPoints(room);
  let p = centroid(poly);
  if(!pointInPolygon(p.x, p.z, poly)){
    const xs = poly.map(q=>q[0]), zs = poly.map(q=>q[1]);
    p = {x: (Math.min(...xs) + Math.max(...xs))/2, z: (Math.min(...zs) + Math.max(...zs))/2};
  }
  enterWalkMode({x: p.x, z: p.z, yaw: 0, level: room.level, label: room.name});
}

function refreshPanel(){
  if(!panel) return;
  if(!selectedRoom || !roomsById[selectedRoom]) selectedRoom = (typeof focusedRoomId !== 'undefined' && focusedRoomId) || 'room-1f-11';
  const zone = zoneOfRoom(selectedRoom), s = schemeOfZone(zone);   // 編集は選んだ部屋の区分の案に書く
  const parts = (s.assignments || {})[selectedRoom] || {};
  const roomItems = optionItems.filter(x=>x.item.room === selectedRoom);
  const roomWalls = walls.filter(w=>w.surface.roomId === selectedRoom);
  const roomFurniture = activeFurnitureItems().filter(item=>item.room === selectedRoom && colorRolesOf(item));
  // 部屋は自宅（1F・2F）と民泊に分けて並べる。●はその区分の表示中の案で決まっている部屋
  const roomGroups = [['自宅 1F', 'home', 1], ['自宅 2F', 'home', 2], ['民泊', 'guest', 1]];
  const roomSelect = el('select', {onchange: e=>{ selectedRoom = e.target.value; refreshPanel(); }},
    roomGroups.map(([label, z, level])=>el('optgroup', {label}, Object.values(roomsById).filter(r=>r.level === level && zoneOfRoom(r.id) === z)
      .map(r=>el('option', {value: r.id, selected: r.id === selectedRoom}, r.name + (((schemeOfZone(z).assignments || {})[r.id]) ? ' ●' : ''))))));
  const zoneRow = z=>el('div', {class: 'fin-zone' + (z === zone ? ' fin-zone-on' : '')},
    el('div', {class: 'fin-zone-head'}, el('span', {class: 'fin-zone-name'}, FINISH_ZONE_LABELS[z] + 'の案'),
      z === zone ? el('span', {class: 'fin-zone-badge'}, '選んだ部屋の案（編集中）') : null),
    el('div', {class: 'fin-row'},
      el('select', {'aria-label': FINISH_ZONE_LABELS[z] + 'の案', onchange: e=>{ doc.activeSchemes = {...doc.activeSchemes, [z]: e.target.value}; commit(); }},
        schemesOf(z).map(x=>el('option', {value: x.id, selected: x.id === schemeOfZone(z).id}, x.name))),
      el('button', {title: '今の案を複製して新しい案を作る', onclick: ()=>editScheme('copy', z)}, '複製'),
      el('button', {title: '名前を変える', onclick: ()=>editScheme('rename', z)}, '名前'),
      el('button', {title: 'この案を削除', onclick: ()=>editScheme('delete', z)}, '削除')));
  panel.replaceChildren(...[
    el('div', {class: 'ra-sub-title'}, '表示中の案（内覧とUEに反映されます。自宅と民泊は別々に選べます）'),
    FINISH_ZONES.map(zoneRow),
    el('div', {class: 'ra-sub-title'}, `部屋（${FINISH_ZONE_LABELS[zone]}の案「${s.name}」に書き込みます）`),
    roomSelect,
    FINISH_PARTS.map(part=>el('div', {class: 'fin-part'},
      el('span', {class: 'fin-part-label'}, FINISH_PART_LABELS[part]),
      swatch(candidateById(parts[part])),
      candidateSelect([part], parts[part], v=>setAssignment(selectedRoom, part, v)))),
    roomWalls.length ? el('details', {class: 'fin-accents', open: roomWalls.some(w=>(s.surfaces || {})[w.surface.id])},
      el('summary', null, `アクセントクロス（壁を1面ずつ変える・${roomWalls.length}面）`),
      roomWalls.map(w=>el('div', {class: 'fin-part'},
        el('span', {class: 'fin-part-label fin-wall-label'}, `${w.info.direction}の壁 ${w.info.length.toFixed(2)}m`),
        swatch(candidateById((s.surfaces || {})[w.surface.id]) || candidateById(parts.wall)),
        candidateSelect(['wall'], (s.surfaces || {})[w.surface.id], v=>setAccent(w.surface.id, v), '（部屋の壁と同じ）')))) : null,
    roomFurniture.length ? el('details', {class: 'fin-accents', open: roomFurniture.some(item=>(s.furniture || {})[item.id])},
      el('summary', null, `家具・布の色（この部屋・${roomFurniture.length}点）`),
      roomFurniture.flatMap(item=>Object.entries(colorRolesOf(item)).map(([role, label])=>{
        const picked = ((s.furniture || {})[item.id] || {})[role];
        return el('div', {class: 'fin-part'},
          el('span', {class: 'fin-part-label fin-wall-label'}, `${item.label}・${label}`),
          swatch(candidateById(picked)),
          el('select', {onchange: e=>setFurnitureColor(item.id, role, e.target.value || null)},
            el('option', {value: ''}, '（標準のまま）'),
            doc.candidates.filter(c=>c.kind === 'furniture').map(c=>el('option', {value: c.id, selected: c.id === picked}, candidateLabel(c)))));
      }))) : null,
    // 設備（採用品の選択肢：キッチン・カップボードの扉の色など）は、選んだ部屋にあるものだけ
    roomItems.length ? el('div', {class: 'ra-sub-title'}, '設備（この部屋）') : null,
    roomItems.flatMap(({item, product})=>Object.entries(product.options).map(([key, o])=>el('label', {class: 'fin-option'},
      el('span', null, `${item.label}・${o.label}`),
      el('select', {onchange: e=>setProductOption(item.id, key, e.target.value, o.default)},
        Object.entries(o.choices).map(([c, cv])=>el('option', {value: c, selected: (productOptionsFor(item.id)[key] ?? o.default) === c}, cv.label)))))),
    el('div', {class: 'fin-actions'},
      el('button', {class: 'primary', onclick: ()=>walkIntoRoom(selectedRoom)}, '🚶 この部屋を内覧で見る'),
      el('button', {onclick: showSpecList}, '📋 仕様一覧')),
    el('details', {class: 'fin-candidates'},
      el('summary', null, `候補の一覧・追加（${doc.candidates.length}件）`),
      ['floor', 'cloth', 'furniture'].map(kind=>el('div', null,
        el('div', {class: 'hand-label'}, {floor: '床材', cloth: 'クロス（壁・天井）', furniture: '家具・布'}[kind]),
        doc.candidates.filter(c=>c.kind === kind).map(c=>el('button', {class: 'fin-cand', title: c.note || '', onclick: ()=>editCandidate(c)},
          swatch(c), el('span', null, candidateLabel(c)), c.maker ? el('span', {class: 'ra-id'}, c.maker) : null)))),
      el('button', {class: 'fin-add', onclick: ()=>editCandidate(null)}, '＋ 候補を追加'),
      el('p', {class: 'ra-note'}, '（仮）は一般的な定番色です。カタログで決めた商品は「実際の商品」として登録し、品番を入れてください。'))
  ].flat().filter(Boolean));
}

// 内覧中は、歩いて入った部屋を「部屋」欄で自動的に選ぶ（手で選んだ部屋は、次に別の部屋へ入るまで保つ）
let walkerRoom = null;
setInterval(()=>{
  if(mode !== 'walk'){ walkerRoom = null; return; }
  const here = Object.values(roomsById).find(r=>r.level === walkLevel
    && pointInPolygon(walkPos.x, walkPos.z, roomPolygonPoints(r)));
  if(!here || here.id === walkerRoom) return;
  walkerRoom = here.id;
  if(selectedRoom !== here.id){ selectedRoom = here.id; refreshPanel(); }
  refreshWalkHud();   // 内覧の上部の案の切替は、今いる部屋の区分（自宅／民泊）の案に切り替わる
}, 400);

// ---------- 内覧中の「案」切替（ブラウザで切り替えて見比べる） ----------
let hudZone = 'home';   // 今いる部屋の区分（部屋の外では、最後にいた区分のまま）
const hudLabel = el('span', {id: 'walkSchemeZone'});
const hudSelect = el('select', {id: 'walkSchemeSelect', title: '仕上げの案を切り替えて見比べる（今いる部屋の側の案）',
  onchange: e=>{ doc.activeSchemes = {...doc.activeSchemes, [hudZone]: e.target.value}; commit(); }});
function refreshWalkHud(){
  if(walkerRoom) hudZone = zoneOfRoom(walkerRoom);
  const options = schemesOf(hudZone).map(s=>el('option', {value: s.id, selected: s.id === schemeOfZone(hudZone).id}, s.name));
  const now = options.map(o=>o.value + (o.selected ? '*' : '') + o.textContent).join('|');
  if(hudSelect.dataset.shown !== hudZone + '/' + now){   // 変わったときだけ作り直す（内覧中に開いた選択欄を閉じないため）
    hudSelect.dataset.shown = hudZone + '/' + now;
    hudSelect.replaceChildren(...options);
    hudLabel.textContent = FINISH_ZONE_LABELS[hudZone] + 'の案';
  }
  hudSelect.hidden = hudLabel.hidden = schemesOf(hudZone).length < 2;
}
document.getElementById('walkExit').before(hudLabel, hudSelect);

refreshWalkHud();
render();
refreshProducts();   // 下書きの案の選択肢で採用品を描き直す（本体の初回描画は正本の案）
refreshFurnitureColors();   // 本体の初回描画は標準の色なので、案の家具の色で描き直す

window.RyukaFinishes = {
  getDoc: ()=>clone(doc),
  setDoc: next=>{ doc = clone(next); saveFinishesDraft(); render(); refreshProducts(); refreshFurnitureColors(); refreshPanel(); refreshWalkHud(); refreshProductControlsNow(); },
  setProductOption,   // 左パネル「商品の色・サイズ」（閲覧版のスマホ含む）から、キッチン・カップボードの扉カラーなどを選ぶ
  sourceDoc: ()=>clone(SOURCE),
  changeCount: ()=>finishesChangeCount(SOURCE, doc),
  buildPanel: ()=>{ panel = el('div', {class: 'fin-panel'}); refreshPanel(); return panel; },
  refreshPanel,
  showSpecList,     // 閲覧版（web/viewer.js）のメニューからも使う
  walkIntoRoom,
};
})();
