// 閲覧版（claude.ai の非公開ページ。scripts/build-viewer.mjs が組み立てる）だけで読み込む。
//
// - 編集・保存・UE操作のスクリプト（web/editor-shell.js・web/local-app.js）は閲覧版に入れない。
//   本体に残る編集用の部品は web/viewer.css で隠す（ボタンが無いので編集モードには入れない）。
// - 左のメニューに、仕上げの案の切り替え（自宅の案・民泊の案を別々に）・仕様一覧・部屋を選んで内覧、を足す
//   （ショールームでスマホから見る用途）。
// - web/finishes.js が使う確認窓（RyukaLocalApp.dialog）の代わりを用意する（閲覧版では仕様一覧だけが使う）。
(function(){
'use strict';
const info = window.RYUKA_VIEWER || {};
const el = (tag, attrs = {}, ...children)=>{
  const node = document.createElement(tag);
  for(const [k, v] of Object.entries(attrs || {})){
    if(k === 'class') node.className = v;
    else if(k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if(v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for(const c of children.flat()) if(c !== null && c !== undefined && c !== false)
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
};

// 確認窓（仕様一覧の表示用）。結果はボタンの value で返す
function dialog(title, body, buttons){
  return new Promise(resolve=>{
    const close = value=>{ overlay.remove(); resolve(value); };
    const overlay = el('div', {class: 'vw-overlay', onclick: e=>{ if(e.target === overlay) close(null); }},
      el('div', {class: 'vw-dialog', role: 'dialog', 'aria-label': title},
        el('div', {class: 'vw-dialog-title'}, title),
        el('div', {class: 'vw-dialog-body'}, body),
        el('div', {class: 'vw-dialog-buttons'}, (buttons || [{label: '閉じる', value: null}])
          .map(b=>el('button', {class: b.kind === 'primary' ? 'primary' : '', onclick: ()=>close(b.value)}, b.label)))));
    document.body.appendChild(overlay);
  });
}
window.RyukaLocalApp = {dialog};

// 上部：閲覧専用の表示と版
const topBar = document.getElementById('topBar');
if(topBar) topBar.appendChild(el('span', {id: 'vwBadge', title: '編集・保存はPCの編集画面で行います'},
  '👀 閲覧専用', info.builtAt ? el('small', null, ` ${info.builtAt}`) : null));

// 左のメニュー：見るための操作をまとめる
const ui = document.getElementById('ui');
const finishes = window.RyukaFinishes;
if(ui && finishes){
  // 自宅の案・民泊の案を別々の選択欄に（案の名前は区分ごとの一覧。先頭がいちばん有力な案）
  const schemeSelects = FINISH_ZONES.map(zone=>el('select', {id: 'vwScheme-' + zone, 'data-zone': zone, 'aria-label': FINISH_ZONE_LABELS[zone] + 'の案',
    onchange: e=>{ const d = finishes.getDoc(); d.activeSchemes = {...d.activeSchemes, [zone]: e.target.value}; finishes.setDoc(d); }}));
  const fillSchemes = ()=>{
    const d = finishes.getDoc();
    for(const select of schemeSelects){
      const zone = select.dataset.zone;
      select.replaceChildren(...d.schemes.filter(s=>s.zone === zone).map(s=>el('option', {value: s.id, selected: s.id === d.activeSchemes[zone]}, s.name)));
    }
  };
  fillSchemes();
  const roomSelect = el('select', {id: 'vwRoom', 'aria-label': '部屋を選んで内覧'},
    el('option', {value: ''}, '部屋を選ぶ…'),
    // 自宅（1F・2F）と民泊に分けて並べる（案の選択欄と同じ区分）
    [['自宅 1F', 'home', 1], ['自宅 2F', 'home', 2], ['民泊', 'guest', 1]].map(([label, zone, level])=>el('optgroup', {label},
      (ROOMS_APPROX[level] || []).filter(r=>r.id && (r.zone || 'home') === zone).map(r=>el('option', {value: r.id}, r.name)))));
  const walk = ()=>{ if(roomSelect.value) finishes.walkIntoRoom(roomSelect.value); };
  const section = el('div', {id: 'vwSection'},
    el('div', {class: 'section-title'}, '内装の案'),
    schemeSelects.flatMap(select=>[el('label', {class: 'vw-zone', for: select.id}, FINISH_ZONE_LABELS[select.dataset.zone] + 'の案'), select]),
    el('div', {class: 'vw-row'}, el('button', {id: 'vwSpec', onclick: ()=>finishes.showSpecList()}, '📋 仕様一覧')),
    el('div', {class: 'section-title'}, '部屋を選んで内覧'),
    el('div', {class: 'vw-row'}, roomSelect, el('button', {id: 'vwWalk', onclick: walk}, '🚶 入る')),
    el('div', {class: 'sub'}, '自宅と民泊の案は別々に選べます（PCでは、内覧の上部の選択欄でも、今いる部屋の側の案を切り替えられます）。画面の色は目安です。'));
  const title = ui.querySelector('h1');
  if(title) title.textContent = 'Ryuka 内装ビューア';
  (title ? title.after.bind(title) : ui.prepend.bind(ui))(section);
  // 編集の案内を閲覧版の言葉に置き換える
  for(const sub of ui.querySelectorAll('.sub'))
    if(sub.textContent.includes('編集')) sub.textContent = '閲覧専用です。家具・窓・電気・仕上げの編集と保存は、PCの編集画面で行います。';
  // 内覧の上部で案を切り替えたときも、メニューの表示をそろえる
  const hud = document.getElementById('walkSchemeSelect');
  if(hud) hud.addEventListener('change', ()=>setTimeout(fillSchemes, 0));
}

// ---- スマホ幅（本体の @media (max-width:640px) と同じ）だけの調整（2026-11-08 施主指示） ----
const phone = window.matchMedia('(max-width:640px)');
// 開いたときは左のメニュー（☰）を閉じておく。開くのは☰を押したとき
if(ui && phone.matches) ui.classList.add('hidden');

// 内覧の上部は「三人称に切替」「終了」だけにする（部屋名・玄関の選び直し・案の切替は web/viewer.css で隠す。
// 案の切替は☰メニュー、玄関の選び直しは「終了」して内覧をやり直す）。
// ロールスクリーンの上げ下げは、スクリーンのある部屋（民泊の寝室）に入ったときだけ、画面下の中ほどに出す。
const rollBtn = el('button', {id: 'vwRoll', hidden: true, onclick: ()=>setRollScreensDown(!rollScreensDown)});
document.body.appendChild(rollBtn);
function rollRoomIds(){
  return new Set(FURNITURE_ITEMS.filter(item=>(FURNITURE_CATALOG[item.type] || {}).shape === 'rollScreen')
    .map(item=>item.room).filter(Boolean));
}
setInterval(()=>{
  document.body.classList.toggle('vw-walk', mode === 'walk');   // 内覧中は「閲覧専用」の表示も隠す（web/viewer.css）
  let show = false;
  try{
    if(phone.matches && mode === 'walk'){
      const ids = rollRoomIds();
      show = (ROOMS_APPROX[walkLevel] || []).some(r=>ids.has(r.id)
        && pointInPolygon(walkPos.x, walkPos.z, roomPolygonPoints(r)));
    }
  }catch(e){ show = false; }
  rollBtn.hidden = !show;
  if(show) rollBtn.textContent = rollScreensDown ? '🪟 スクリーンを上げる' : '🪟 スクリーンを下ろす';
}, 300);
})();
