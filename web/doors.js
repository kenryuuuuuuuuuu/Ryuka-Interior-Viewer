// 室内ドア（2026-11-15、LIXIL ラシッサD）を選ぶ欄。左のメニューの「🚪 室内ドア」（編集画面と閲覧版の両方）。
// - 自宅と民泊は別々に選ぶ（表示中の案の doors）。「全体」はその区分の戸すべて、戸を選ぶとその戸だけを変える（戸ごとの上書き）。
// - 選んだ物はすぐ内覧の戸に出る（interior-white-model.html の refreshLasissaDoors）。保存は他の仕上げと同じ（PC の［保存］。
//   閲覧版は端末ごと）。正本は data/lasissa-d.json と data/finishes.json の案の doors。
(function(){
'use strict';
if(typeof LASISSA === 'undefined' || !window.RyukaFinishes || !window.RyukaLasissa) return;
const L = window.RyukaLasissa;
const el = (tag, attrs, ...children)=>{
  const node = document.createElement(tag);
  for(const [k, v] of Object.entries(attrs || {})){
    if(k === 'class') node.className = v;
    else if(k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if(k === 'selected' || k === 'open') node[k] = !!v;
    else if(v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for(const c of children.flat()) if(c !== null && c !== undefined && c !== false)
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
};
const byId = list=>Object.fromEntries(list.map(x=>[x.id, x]));
const SERIES = byId(LASISSA.series), COLORS = byId(LASISSA.colors), HANDLES = byId(LASISSA.handles);
const FINISHES = byId(LASISSA.handleFinishes), GLASS = byId(LASISSA.glass);
// ラシッサの戸（区分ごと、階・名前の順）
const DOORS = INTERIOR_DOORS.filter(d=>d.orientation !== 'D' && L.isLasissaDoor(LASISSA, d, d.operation));
const doorsOf = zone=>DOORS.filter(d=>(DOOR_ZONES[d.id] || 'home') === zone);

let zone = 'home', target = 'all';
const doorsDoc = ()=>JSON.parse(JSON.stringify(lasissaDoorsFor(zone)));
// 「全体」の選択（開き戸として見た値）と、戸ごとの選択（その戸の開き方で）
const allSelection = ()=>L.resolveSelection(LASISSA, zone, lasissaDoorsFor(zone), '\u0000all', 'swing');
const doorSelection = d=>L.resolveSelection(LASISSA, zone, lasissaDoorsFor(zone), d.id, d.operation);
const currentDoor = ()=>DOORS.find(d=>d.id === target);

function pick(field, value){
  const docs = doorsDoc(), door = currentDoor();
  const base = door ? doorSelection(door) : allSelection();
  const next = {...base, [field]: value === '' ? null : value};
  if(field === 'series'){ delete next.color; delete next.design; }
  if(field === 'handle') delete next.handleFinish;
  const fixed = L.resolveSelection(LASISSA, zone, {all: next}, '\u0000', door ? door.operation : 'swing');
  if(!fixed.glass) delete fixed.glass;
  if(door) docs.perDoor = {...(docs.perDoor || {}), [door.id]: fixed};
  else {
    // 全体で開き戸に選べないデザイン（引戸専用）は保たない。全体の値は開き戸の値
    docs.all = fixed;
  }
  RyukaFinishes.setDoors(zone, docs);
}
function resetDoor(){
  const docs = doorsDoc();
  if(docs.perDoor) delete docs.perDoor[target];
  RyukaFinishes.setDoors(zone, docs);
}
// 戸の前に立って戸を見る：戸の両側へ少しずつ下がり、壁・家具に当たる手前まで（最大2.0m。1.8mより近いと戸が開く）。
// 広く下がれる側に立つ
function lookAtDoor(d){
  const base = {x: d.orientation === 'H' ? d.center : d.wallAt, z: d.orientation === 'H' ? d.wallAt : d.center};
  const at = (s, k)=>d.orientation === 'H' ? {x: base.x, z: base.z + s*k} : {x: base.x + s*k, z: base.z};
  enterWalkMode({x: at(1, .5).x, z: at(1, .5).z, yaw: 0, level: d.floor, label: d.label});   // 当たり判定の壁・家具を用意する
  const segs = (wallSegmentsByLevel[d.floor] || []).concat(furnitureSegmentsByLevel[d.floor] || []);
  const reach = s=>{
    let k = .35;
    while(k < 2.0 && !segListBlocked(segs, at(s, k + .05).x, at(s, k + .05).z, PLAYER_RADIUS)) k += .05;
    return k;
  };
  const [r1, r2] = [reach(1), reach(-1)];
  const side = r1 >= r2 ? 1 : -1, pos = at(side, Math.max(r1, r2));
  walkPos.x = pos.x; walkPos.z = pos.z;
  walkYaw = Math.atan2(base.x - pos.x, base.z - pos.z); walkPitch = -0.05;
  updateWalkCamera();
}

const swatchStyle = c=>c.kind === 'wood'
  ? `background:repeating-linear-gradient(${c.grain === 'H' ? '0deg' : '90deg'},#${c.light} 0 3px,#${c.mean} 3px 7px,#${c.dark} 7px 8px,#${c.mean} 8px 12px)`
  : `background:#${c.mean}`;

const section = el('details', {id: 'doorSection', class: 'door-section'});
function render(){
  const sel = currentDoor() ? doorSelection(currentDoor()) : allSelection();
  const series = SERIES[sel.series], color = COLORS[sel.color], handle = HANDLES[sel.handle];
  const operation = currentDoor() ? currentDoor().operation : 'swing';
  const perDoor = (lasissaDoorsFor(zone).perDoor) || {};
  const designs = series.designs.filter(x=>(x.operations || ['swing', 'slide']).includes(operation === 'slide' ? 'slide' : 'swing'));
  const usesGlass = !!(L.designOf(LASISSA, sel).glass || L.designOf(LASISSA, sel).glassPanels);
  section.replaceChildren(...[
    el('summary', null, '🚪 室内ドア（LIXIL ラシッサD）'),
    el('div', {class: 'door-zones'}, ['home', 'guest'].map(z=>el('button', {class: z === zone ? 'on' : '',
      onclick: ()=>{ zone = z; target = 'all'; render(); }}, FINISH_ZONE_LABELS[z]))),
    el('div', {class: 'door-row'}, el('span', {class: 'door-label'}, '対象'),
      el('select', {'aria-label': '変える戸', onchange: e=>{ target = e.target.value; render(); }},
        el('option', {value: 'all', selected: target === 'all'}, `全体（${FINISH_ZONE_LABELS[zone]}の戸 ${doorsOf(zone).length}枚）`),
        doorsOf(zone).map(d=>el('option', {value: d.id, selected: target === d.id},
          `${d.floor}F ${d.label}${d.operation === 'slide' ? '（引戸）' : ''}${perDoor[d.id] ? ' ●' : ''}`)))),
    currentDoor() ? el('div', {class: 'door-row door-actions'},
      perDoor[target] ? el('button', {onclick: resetDoor}, '全体と同じに戻す') : el('span', {class: 'door-note'}, '今は全体と同じ。変えるとこの戸だけ変わります（●）'),
      el('button', {onclick: ()=>lookAtDoor(currentDoor())}, '🚶 この戸を見る')) : null,
    el('div', {class: 'door-row'}, el('span', {class: 'door-label'}, 'シリーズ'),
      el('select', {'aria-label': 'シリーズ', onchange: e=>pick('series', e.target.value)},
        LASISSA.series.map(s=>el('option', {value: s.id, selected: s.id === sel.series}, s.name)))),
    el('div', {class: 'door-sub'}, series.note),
    el('div', {class: 'door-label'}, `色：${color.name}（${color.id}）${color.kind === 'wood' ? (color.grain === 'H' ? '・横木目' : '・木目') : '・単色'}`),
    el('div', {class: 'door-swatches'}, series.colors.map(id=>{
      const c = COLORS[id];
      return el('button', {class: 'door-swatch' + (id === sel.color ? ' on' : ''), style: swatchStyle(c), title: `${c.name}（${c.id}）`,
        'aria-label': c.name, onclick: ()=>pick('color', id)}, el('span', null, c.name));
    })),
    el('div', {class: 'door-row'}, el('span', {class: 'door-label'}, 'デザイン'),
      el('select', {'aria-label': 'デザイン', onchange: e=>pick('design', e.target.value)},
        designs.map(x=>el('option', {value: x.code, selected: x.code === sel.design}, x.name)))),
    el('div', {class: 'door-row'}, el('span', {class: 'door-label'}, operation === 'slide' ? '引手' : 'ハンドル'),
      operation === 'slide' ? el('span', {class: 'door-note'}, '引戸は引手（色はハンドルの金物の色）') :
        el('select', {'aria-label': 'ハンドル', onchange: e=>pick('handle', e.target.value)},
          LASISSA.handles.map(h=>el('option', {value: h.id, selected: h.id === sel.handle}, h.name + (h.special ? '（特別仕様）' : ''))))),
    el('div', {class: 'door-row'}, el('span', {class: 'door-label'}, '金物の色'),
      el('select', {'aria-label': '金物の色', onchange: e=>pick('handleFinish', e.target.value)},
        handle.finishes.map(f=>el('option', {value: f, selected: f === sel.handleFinish}, FINISHES[f].name)))),
    usesGlass ? el('div', {class: 'door-row'}, el('span', {class: 'door-label'}, 'ガラス'),
      el('select', {'aria-label': 'ガラス', onchange: e=>pick('glass', e.target.value)},
        el('option', {value: '', selected: !sel.glass}, 'デザインの標準'),
        LASISSA.glass.map(g=>el('option', {value: g.id, selected: g.id === sel.glass}, g.name)))) : null,
    el('label', {class: 'door-row door-hold'}, el('input', {type: 'checkbox', checked: !!window.walkDoorsHeldClosed,
      onchange: e=>{ window.walkDoorsHeldClosed = e.target.checked; }}), '近づいても戸を開けない（閉じた面を見比べる）'),
    el('p', {class: 'door-note'}, '内覧（🚶）で戸に近づくと開きます。色・質感は公式の色見本に合わせた目安です。つや・手触りはショールームのサンプルで確かめてください。')
  ].filter(Boolean));
}
window.RyukaDoors = {refresh: render, render, lookAtDoor};
const ui = document.getElementById('ui');
if(ui){ render(); ui.appendChild(section); }
})();
