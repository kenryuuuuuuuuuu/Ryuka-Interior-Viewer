// 採用品（製品）の描画（2026-10）。部品は generated/house-data.js の PRODUCT_PARTS
// （scripts/product-parts.mjs が data/products/*.json から作る。Blenderの blender/product_assets.py と同じ部品）。
//
// - 色を見比べる目的のため、照明を受けない素材で「役割の色そのもの」を出し、面の向きで少しだけ陰影を付ける
//   （内装の仕上げ web/finishes.js と同じ考え方。照明を受ける素材だと天板などが白飛びする）。
// - 部品は色の役割ごとに1つの形へまとめて描く（キッチン1台で数十〜百の部品があるため）。
// - productFinish（家具ごとの色の上書き）と、案の選択肢（data/finishes.json の productOptions。
//   例：キッチンのIH背面）で見た目が変わる。案の選択肢は productOptionsFor(家具id) で受け取る
//   （既定は正本の表示中の案。web/finishes.js が下書きの案に差し替える）。
// 本体（interior-white-model.html）より先に読み込む。
(function(){
'use strict';
const HEX = /^[0-9a-f]{6}$/;
const SHADE = {top: 1, bottom: 0.72, sideX: 0.9, sideZ: 0.96};

function productSettings(id, w, d, h, finish, options){
  const product = PRODUCT_PARTS[id];
  if(!product) throw Error('未知の製品です: ' + id);
  if([w, d, h].some((v, i)=>!Number.isFinite(v) || Math.abs(v - product.dimensions[i]) > 1e-6))
    throw Error(`${product.label}は幅${product.dimensions[0].toFixed(3)}・奥行${product.dimensions[1].toFixed(3)}・高さ${product.dimensions[2].toFixed(3)}m専用です`);
  finish = finish || {};
  if(typeof finish !== 'object' || Array.isArray(finish)) throw Error('商品の色の指定が不正です');
  for(const [role, value] of Object.entries(finish)){
    if(!product.roles[role]) throw Error(`${product.label}に色の役割「${role}」はありません`);
    if(typeof value !== 'string' || !HEX.test(value)) throw Error('色は6桁の16進数で指定してください');
  }
  options = options || {};
  for(const [key, value] of Object.entries(options))
    if(!product.options[key] || !product.options[key].choices[value]) throw Error(`${product.label}の選択肢「${key}=${value}」はありません`);
  const chosen = Object.fromEntries(Object.entries(product.options).map(([key, o])=>[key, options[key] ?? o.default]));
  // 選んだ案の選択肢（例：扉カラー）が役割の色・柄を変える。家具ごとの色の上書き（productFinish）が最優先
  const eff = effectiveRoles(product, chosen);
  const colors = Object.fromEntries(Object.entries(product.roles).map(([role])=>[role, finish[role] || eff[role].color]));
  const patterns = Object.fromEntries(Object.entries(eff).map(([role, v])=>[role, v.pattern || null]));
  return {product, colors, patterns, options: chosen};
}

function effectiveRoles(product, chosen){
  const out = Object.fromEntries(Object.entries(product.roles).map(([k, v])=>[k, {color: v.color, pattern: v.pattern}]));
  for(const [key, o] of Object.entries(product.options)){
    const choice = o.choices[(chosen || {})[key] ?? o.default];
    for(const [role, v] of Object.entries((choice && choice.roles) || {})){
      if(v.color !== undefined) out[role].color = v.color;
      if(v.pattern !== undefined) out[role].pattern = v.pattern === 'plain' ? undefined : v.pattern;
    }
  }
  return out;
}

function partsFor(product, chosen){
  return product.parts.filter(p=>!p.when || Object.entries(p.when).every(([k, cs])=>cs.includes(chosen[k])));
}

// 横向きの木目（1枚＝1m四方。色は材質の色を掛ける）
let woodMap = null;
function woodTexture(){
  if(woodMap !== null) return woodMap || null;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext && canvas.getContext('2d');
  if(!g){ woodMap = false; return null; }   // テスト環境など、描けないときは模様なし
  canvas.width = canvas.height = 512;
  for(let y = 0; y < 512; y++){
    const t = y/512*130;
    const v = 0.93 + 0.045*Math.sin(t) + 0.025*Math.sin(t*3.3 + 1.1) - 0.05*Math.pow(Math.max(0, Math.sin(t*0.71 + 1.3)), 14);
    const c = Math.round(255*Math.min(1, v));
    g.fillStyle = `rgb(${c},${c},${c})`; g.fillRect(0, y, 512, 1);
  }
  for(let i = 0; i < 260; i++){   // 細い木目の揺らぎ
    const y = Math.random()*512, len = 40 + Math.random()*200, x = Math.random()*512;
    g.strokeStyle = `rgba(0,0,0,${0.02 + Math.random()*0.04})`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len*0.3, y + 1.5, x + len*0.7, y - 1.5, x + len, y + 0.5); g.stroke();
  }
  woodMap = new THREE.CanvasTexture(canvas);
  woodMap.wrapS = woodMap.wrapT = THREE.RepeatWrapping;
  return woodMap;
}

const materialCache = new Map();
function materialFor(role, color){
  const key = `${color}|${role.pattern || ''}|${role.opacity ?? 1}`;
  if(!materialCache.has(key)){
    const options = {color: new THREE.Color('#' + color), vertexColors: true};
    if(role.pattern === 'wood'){ const map = woodTexture(); if(map) options.map = map; }
    if(role.opacity !== undefined){ Object.assign(options, {transparent: true, opacity: role.opacity, depthWrite: false, side: THREE.DoubleSide}); }
    materialCache.set(key, new THREE.MeshBasicMaterial(options));
  }
  return materialCache.get(key);
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 28).toNonIndexed();

// yaw：家具グループのY軸回転（ラジアン）。陰影は部屋の中での面の向きで決める
function drawProduct(group, id, w, d, h, finish, options, yaw = 0){
  const {product, colors, patterns, options: chosen} = productSettings(id, w, d, h, finish, options);
  const buffers = {};
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  for(const part of partsFor(product, chosen)){
    const [x0, x1, z0, z1, y0, y1] = part.bounds;
    const src = part.kind === 'ellipse' ? UNIT_CYL : UNIT_BOX;
    const pos = src.attributes.position, nor = src.attributes.normal;
    const buf = buffers[part.material] || (buffers[part.material] = {pos: [], col: [], uv: []});
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0, cx = (x0 + x1)/2, cy = (y0 + y1)/2, cz = (z0 + z1)/2;
    for(let i = 0; i < pos.count; i++){
      const x = cx + pos.getX(i)*sx, y = cy + pos.getY(i)*sy, z = cz + pos.getZ(i)*sz;
      buf.pos.push(x, y, z);
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      const wx = nx*cos + nz*sin, wz = -nx*sin + nz*cos;   // 回転後の向き
      const s = ny > 0.5 ? SHADE.top : ny < -0.5 ? SHADE.bottom : Math.abs(wx) > Math.abs(wz) ? SHADE.sideX : SHADE.sideZ;
      buf.col.push(s, s, s);
      // 実寸の平面UV（木目は横向き）：上下面は x・z、正面/背面は x・y、側面は z・y
      if(Math.abs(ny) > 0.5) buf.uv.push(x, z); else if(Math.abs(nz) > Math.abs(nx)) buf.uv.push(x, y); else buf.uv.push(z, y);
    }
  }
  for(const [role, buf] of Object.entries(buffers)){
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    const mesh = new THREE.Mesh(geo, materialFor({...product.roles[role], pattern: patterns[role] || undefined}, colors[role]));
    mesh.name = `product-${role}`;
    if(product.roles[role].opacity !== undefined) mesh.renderOrder = 2;
    group.add(mesh);
  }
}

// 家具の編集パネル：製品名と、色の役割ごとの色（上書きは家具ごと。空にすると製品の色）
function buildFinishPanel(container, item, onChange){
  const product = PRODUCT_PARTS[FURNITURE_CATALOG[item.type].product];
  const finish = {...(item.productFinish || {})};
  const el = (tag, attrs = {}, ...children)=>{
    const node = document.createElement(tag);
    for(const [k, v] of Object.entries(attrs)){
      if(k === 'class') node.className = v; else if(k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v);
    }
    for(const c of children) if(c !== null && c !== undefined) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return node;
  };
  // 選んだ案の選択肢（扉カラーなど）が変えた色を「製品の色」として扱う
  const optionPicks = typeof productOptionsFor === 'function' ? productOptionsFor(item.id) : {};
  const eff = effectiveRoles(product, optionPicks);
  const rows = Object.entries(product.roles).filter(([role])=>!['shadow', 'mark', 'glass'].includes(role)).map(([role, r])=>{
    const base = eff[role].color;
    const input = el('input', {type: 'color', value: '#' + (finish[role] || base), title: r.label,
      onchange: e=>{
        const v = e.target.value.slice(1).toLowerCase();
        if(v === base) delete finish[role]; else finish[role] = v;
        onChange(Object.keys(finish).length ? {...finish} : undefined);
      }});
    const reset = finish[role] ? el('button', {class: 'pp-reset', title: '製品の色に戻す', onclick: ()=>{ delete finish[role]; onChange(Object.keys(finish).length ? {...finish} : undefined); }}, '戻す') : null;
    return el('div', {class: 'pp-row'}, input, el('span', {class: 'pp-label'}, r.label + (finish[role] ? '（変更）' : '')), reset);
  });
  const optionNotes = Object.values(product.options).map(o=>el('p', {class: 'pp-note'}, `${o.label}は「仕上げ」タブの案で切り替えます。`));
  container.replaceChildren(...[
    el('div', {class: 'pp-title'}, `${product.maker} ${product.label}`),
    el('p', {class: 'pp-note'}, '寸法は製品どおりで変えられません。色はカタログやサンプルに合わせて直せます（画面の色は実物と一致しません）。'),
    ...rows, ...optionNotes,
  ]);
}

globalThis.RyukaProducts = {settings: productSettings, draw: drawProduct, partsFor, effectiveRoles, buildFinishPanel};
// 案の選択肢（既定は正本の表示中の案。web/finishes.js が下書きの案に差し替える）
if(typeof globalThis.productOptionsFor !== 'function'){
  globalThis.productOptionsFor = function(furnitureId){
    const doc = typeof FINISHES_DOC !== 'undefined' ? FINISHES_DOC : null;
    const scheme = doc && doc.schemes.find(s=>s.id === doc.activeScheme);
    return (scheme && scheme.productOptions && scheme.productOptions[furnitureId]) || {};
  };
}
})();
