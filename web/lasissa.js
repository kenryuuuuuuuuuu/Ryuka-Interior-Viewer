// ラシッサD（LIXIL の室内ドア）の選び方と、戸本体の部品（2026-11-15）。
// 正本は data/lasissa-d.json（色・デザイン・ハンドル・ガラス）と data/finishes.json の案の doors（自宅・民泊ごとの選択と戸ごとの上書き）。
// ブラウザ（interior-white-model.html の内覧の戸）と、Blender 用の生成（scripts/build-web-data.mjs → generated/door-leaves.json）が
// 同じ部品を使う。
//
// 戸本体の座標（部品の box は [x0, x1, y0, y1, z0, z1]、単位 m）：
//   x：吊り元（開き戸の蝶番の側、引戸は引いて逃げる側）が 0、取っ手の側が w。
//   y：戸の下端が 0、上端が h。 z：戸の厚みの中心が 0（両面とも同じ作り）。
// デザインの割合（data/lasissa-d.json）は「取っ手の側から」の割合 → x = w × (1 − 割合)。
(function(root){
  const GROOVE_W = .003, GROOVE_PROUD = .0006, BEAD_W = .012, BEAD_PROUD = .003, MOLD_W = .02, MOLD_PROUD = .004;
  const MUNTIN_W = .014, PANEL_RECESS = .002, GLASS_T = .005;

  const byId = list=>Object.fromEntries(list.map(x=>[x.id, x]));

  // 案の doors（{all:{…}, perDoor:{戸id:{…}}}）と区分の既定から、その戸の選択を決める。
  // 選べない組み合わせ（シリーズにない色・デザイン、開き方に合わないデザイン、ハンドルにない色）は、そのシリーズの最初の物にする
  function resolveSelection(lasissa, zone, schemeDoors, doorId, operation){
    const pick = Object.assign({}, lasissa.defaults[zone] || lasissa.defaults.home, (schemeDoors || {}).all || {},
      ((schemeDoors || {}).perDoor || {})[doorId] || {});
    const series = byId(lasissa.series)[pick.series] || lasissa.series[0];
    const color = series.colors.includes(pick.color) ? pick.color : series.colors[0];
    const kind = operation === 'slide' ? 'slide' : 'swing';
    const usable = series.designs.filter(d=>(d.operations || ['swing', 'slide']).includes(kind));
    const design = (usable.find(d=>d.code === pick.design) || usable[0]).code;
    const handle = byId(lasissa.handles)[pick.handle] || lasissa.handles[0];
    const handleFinish = handle.finishes.includes(pick.handleFinish) ? pick.handleFinish : handle.finishes[0];
    const glass = pick.glass && byId(lasissa.glass)[pick.glass] ? pick.glass : null;
    return {series: series.id, color, design, handle: handle.id, handleFinish, glass};
  }

  function designOf(lasissa, sel){
    return byId(lasissa.series)[sel.series].designs.find(d=>d.code === sel.design);
  }

  // 長方形 r から穴（長方形の一覧）を除いた残りを、重ならない長方形に分ける（格子に切って隣り合う物を横につなぐ）
  function subtractRects(r, holes){
    const xs = [...new Set([r[0], r[1], ...holes.flatMap(h=>[h[0], h[1]])].filter(v=>v >= r[0] && v <= r[1]))].sort((a, b)=>a - b);
    const ys = [...new Set([r[2], r[3], ...holes.flatMap(h=>[h[2], h[3]])].filter(v=>v >= r[2] && v <= r[3]))].sort((a, b)=>a - b);
    const out = [];
    for(let j = 0; j < ys.length - 1; j++){
      let run = null;
      for(let i = 0; i < xs.length - 1; i++){
        const cx = (xs[i] + xs[i + 1])/2, cy = (ys[j] + ys[j + 1])/2;
        const inHole = holes.some(h=>cx > h[0] && cx < h[1] && cy > h[2] && cy < h[3]);
        if(!inHole && xs[i + 1] - xs[i] > 1e-6 && ys[j + 1] - ys[j] > 1e-6){
          if(run && Math.abs(run[1] - xs[i]) < 1e-9) run[1] = xs[i + 1];
          else { run = [xs[i], xs[i + 1], ys[j], ys[j + 1]]; out.push(run); }
        } else run = null;
      }
    }
    return out;
  }

  // 戸本体の部品。sel は resolveSelection() の結果、w・h は戸の幅・高さ、operation は 'swing' か 'slide'
  // 材質：door（面材の色・木目。grain は 'leaf'＝色の木目の向き、'x'／'y'＝部材の長い向き）、groove（溝の影）、
  // glass（ガラス。glass に種類）、metal（取っ手の金物。handleFinish の色）
  function leafParts(lasissa, sel, w, h, operation){
    const T = lasissa.leaf.thickness, d = designOf(lasissa, sel), parts = [];
    const X = f=>w*(1 - f), Y = f=>h*f;
    const add = (name, box, mat, extra)=>parts.push(Object.assign({name, box: box.map(v=>Math.round(v*1e6)/1e6), mat}, extra || {}));
    const both = (fn)=>[1, -1].forEach(s=>fn(s));
    const grooveStrip = (name, x0, x1, y0, y1)=>both(s=>add(`${name}-${s > 0 ? 'f' : 'b'}`,
      [x0, x1, y0, y1, ...(s > 0 ? [T/2 - .001, T/2 + GROOVE_PROUD] : [-T/2 - GROOVE_PROUD, -T/2 + .001])], 'groove'));
    const glassOf = g=>sel.glass || g.glass;
    const holes = [], glassAreas = [];   // {rect:[x0,x1,y0,y1], spec}
    // 框（かまち）組み：縦框・横框（上・下・中）と、その間のパネル（板）またはガラス
    if(d.frame){
      const f = d.frame, s = w*f.stile, top = h*f.top, bottom = h*f.bottom;
      const rails = [[0, bottom], ...(f.rails || []).map(r=>[Y(r[0]), Y(r[1])]), [h - top, h]].sort((a, b)=>a[0] - b[0]);
      add('stile-hinge', [0, s, 0, h, -T/2, T/2], 'door', {grain: 'y'});
      add('stile-latch', [w - s, w, 0, h, -T/2, T/2], 'door', {grain: 'y'});
      rails.forEach((r, i)=>add(`rail-${i}`, [s, w - s, r[0], r[1], -T/2, T/2], 'door', {grain: 'x'}));
      const panels = [];
      for(let i = 0; i < rails.length - 1; i++) panels.push([s, w - s, rails[i][1], rails[i + 1][0]]);
      const glassPanel = {};
      for(const g of d.glassPanels || []){
        const index = g.panel === 'top' ? panels.length - 1 : g.panel === 'bottom' ? 0 : -1;
        if(index >= 0) glassPanel[index] = g; else panels.forEach((_, i)=>{ glassPanel[i] = g; });
      }
      panels.forEach((p, i)=>{
        if(glassPanel[i]){ glassAreas.push({rect: p, spec: glassPanel[i], beads: true}); return; }
        add(`panel-${i}`, [p[0], p[1], p[2], p[3], -T/2 + PANEL_RECESS, T/2 - PANEL_RECESS], 'door', {grain: 'y'});
        // パネルの縁の溝と、板張りの溝
        grooveStrip(`panel-${i}-edge-l`, p[0], p[0] + GROOVE_W, p[2], p[3]);
        grooveStrip(`panel-${i}-edge-r`, p[1] - GROOVE_W, p[1], p[2], p[3]);
        grooveStrip(`panel-${i}-edge-b`, p[0], p[1], p[2], p[2] + GROOVE_W);
        grooveStrip(`panel-${i}-edge-t`, p[0], p[1], p[3] - GROOVE_W, p[3]);
        for(let k = 1; k < (d.planks || 0); k++){
          const x = p[0] + (p[1] - p[0])*k/d.planks;
          grooveStrip(`panel-${i}-plank-${k}`, x - GROOVE_W/2, x + GROOVE_W/2, p[2], p[3]);
        }
      });
    } else {
      for(const g of d.glass || []){
        const rect = [X(g.x[1]), X(g.x[0]), Y(g.y[0]), Y(g.y[1])];
        holes.push(rect); glassAreas.push({rect, spec: g, beads: !!g.bead, molding: !!g.molding});
      }
      subtractRects([0, w, 0, h], holes).forEach((r, i)=>add(`slab-${i}`, [r[0], r[1], r[2], r[3], -T/2, T/2], 'door', {grain: 'leaf'}));
      // 縦の溝（板張り風・ライン）：ガラスの所は切る
      (d.grooves || []).forEach((g, i)=>{
        const gw = g.width || GROOVE_W, x = X(g.x);
        const pieces = [[0, h]];
        for(const hole of holes) if(x > hole[0] - gw && x < hole[1] + gw){
          for(let k = pieces.length - 1; k >= 0; k--){
            const [a, b] = pieces[k];
            if(hole[3] <= a || hole[2] >= b) continue;
            pieces.splice(k, 1, ...[[a, hole[2]], [hole[3], b]].filter(([p, q])=>q - p > 1e-6));
          }
        }
        pieces.forEach(([a, b], k)=>grooveStrip(`groove-${i}-${k}`, x - gw/2, x + gw/2, a, b));
      });
      // 鏡板の縁取り（浮き出た細い枠）
      (d.moldings || []).forEach((m, i)=>moldingFrame(`molding-${i}`, [X(m[1]), X(m[0]), Y(m[2]), Y(m[3])]));
    }
    function moldingFrame(name, r){
      both(s=>{
        const z = s > 0 ? [T/2, T/2 + MOLD_PROUD] : [-T/2 - MOLD_PROUD, -T/2], tag = s > 0 ? 'f' : 'b';
        add(`${name}-l-${tag}`, [r[0] - MOLD_W, r[0], r[2] - MOLD_W, r[3] + MOLD_W, ...z], 'door', {grain: 'y'});
        add(`${name}-r-${tag}`, [r[1], r[1] + MOLD_W, r[2] - MOLD_W, r[3] + MOLD_W, ...z], 'door', {grain: 'y'});
        add(`${name}-b-${tag}`, [r[0], r[1], r[2] - MOLD_W, r[2], ...z], 'door', {grain: 'x'});
        add(`${name}-t-${tag}`, [r[0], r[1], r[3], r[3] + MOLD_W, ...z], 'door', {grain: 'x'});
      });
    }
    // ガラス：板ガラス、押縁（細い木の縁）または鏡板の縁取り、格子
    glassAreas.forEach((g, i)=>{
      const r = g.rect;
      add(`glass-${i}`, [r[0], r[1], r[2], r[3], -GLASS_T/2, GLASS_T/2], 'glass', {glass: glassOf(g.spec)});
      if(g.molding) moldingFrame(`glass-${i}-molding`, r);
      else if(g.beads) both(s=>{
        const z = s > 0 ? [T/2 - .004, T/2 + BEAD_PROUD] : [-T/2 - BEAD_PROUD, -T/2 + .004], tag = s > 0 ? 'f' : 'b';
        add(`glass-${i}-bead-l-${tag}`, [r[0], r[0] + BEAD_W, r[2], r[3], ...z], 'door', {grain: 'y'});
        add(`glass-${i}-bead-r-${tag}`, [r[1] - BEAD_W, r[1], r[2], r[3], ...z], 'door', {grain: 'y'});
        add(`glass-${i}-bead-b-${tag}`, [r[0] + BEAD_W, r[1] - BEAD_W, r[2], r[2] + BEAD_W, ...z], 'door', {grain: 'x'});
        add(`glass-${i}-bead-t-${tag}`, [r[0] + BEAD_W, r[1] - BEAD_W, r[3] - BEAD_W, r[3], ...z], 'door', {grain: 'x'});
      });
      const m = g.spec.muntins;
      if(m){
        const gx = f=>r[1] - (r[1] - r[0])*f, gy = f=>r[2] + (r[3] - r[2])*f, tz = [-T/2 + .004, T/2 - .004];
        (m.v || []).forEach((f, k)=>add(`glass-${i}-muntin-v${k}`, [gx(f) - MUNTIN_W/2, gx(f) + MUNTIN_W/2, r[2], r[3], ...tz], 'door', {grain: 'y'}));
        (m.h || []).forEach((f, k)=>add(`glass-${i}-muntin-h${k}`, [r[0], r[1], gy(f) - MUNTIN_W/2, gy(f) + MUNTIN_W/2, ...tz], 'door', {grain: 'x'}));
        (m.segments || []).forEach((sg, k)=>{
          if(sg.v !== undefined) add(`glass-${i}-seg${k}`, [gx(sg.v) - MUNTIN_W/2, gx(sg.v) + MUNTIN_W/2, gy(sg.from), gy(sg.to), ...tz], 'door', {grain: 'y'});
          else { const a = gx(sg.to), b = gx(sg.from); add(`glass-${i}-seg${k}`, [Math.min(a, b), Math.max(a, b), gy(sg.h) - MUNTIN_W/2, gy(sg.h) + MUNTIN_W/2, ...tz], 'door', {grain: 'x'}); }
        });
      }
    });
    handleParts(lasissa, sel, w, h, operation).forEach(p=>parts.push(p));
    return parts;
  }

  // 取っ手。開き戸はレバー（両面、レバーは吊り元の側へ向く）・握り玉・プッシュプル、引戸は引手（両面、取っ手の側の端の近く）
  function handleParts(lasissa, sel, w, h, operation){
    const T = lasissa.leaf.thickness, hy = lasissa.leaf.handleHeight, out = [];
    const add = (name, box, kind)=>out.push({name, box: box.map(v=>Math.round(v*1e6)/1e6), mat: 'metal', kind: kind || 'box', finish: sel.handleFinish});
    if(operation === 'slide'){
      const x = w - lasissa.leaf.pullFromEdge;
      [1, -1].forEach(s=>add(`pull-${s > 0 ? 'f' : 'b'}`, [x - .0125, x + .0125, hy - .07, hy + .07,
        ...(s > 0 ? [T/2 - .002, T/2 + .0008] : [-T/2 - .0008, -T/2 + .002])]));
      return out;
    }
    const shape = (lasissa.handles.find(x=>x.id === sel.handle) || lasissa.handles[0]).shape;
    const x = w - lasissa.leaf.handleBackset;
    [1, -1].forEach(s=>{
      const tag = s > 0 ? 'f' : 'b', z0 = s*T/2, zz = (a, b)=>s > 0 ? [z0 + a, z0 + b] : [z0 - b, z0 - a];
      if(shape === 'push-pull'){ add(`plate-${tag}`, [x - .018, x + .018, hy - .09, hy + .09, ...zz(0, .022)]); return; }
      if(shape.startsWith('square')) add(`rose-${tag}`, [x - .026, x + .026, hy - .026, hy + .026, ...zz(0, .009)]);
      else add(`rose-${tag}`, [x - .026, x + .026, hy - .026, hy + .026, ...zz(0, .009)], 'cylZ');
      if(shape === 'knob'){
        add(`neck-${tag}`, [x - .01, x + .01, hy - .01, hy + .01, ...zz(.009, .035)], 'cylZ');
        add(`knob-${tag}`, [x - .028, x + .028, hy - .028, hy + .028, ...zz(.03, .086)], 'sphere');
        return;
      }
      add(`neck-${tag}`, [x - .009, x + .009, hy - .009, hy + .009, ...zz(.009, .055)], 'cylZ');
      const len = shape === 'square-long' ? .14 : .125;
      if(shape === 'circle-bar') add(`lever-${tag}`, [x - len, x + .009, hy - .0095, hy + .0095, ...zz(.04, .059)], 'cylX');
      else add(`lever-${tag}`, [x - len, x + .009, hy - (shape === 'circle-taper' ? .008 : .009), hy + .009, ...zz(.042, .058)]);
    });
    return out;
  }

  // 戸がつなぐ部屋から、自宅（home）か民泊（guest）かを決める。どちらかが民泊の部屋なら民泊
  function doorZone(door, rooms){
    const pts = door.orientation === 'H' ? [[door.center, door.wallAt - .2], [door.center, door.wallAt + .2]]
      : [[door.wallAt - .2, door.center], [door.wallAt + .2, door.center]];
    const inside = (x, z, poly)=>{
      let hit = false;
      for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const [x1, z1] = poly[i], [x2, z2] = poly[j];
        if((z1 > z) !== (z2 > z) && x < (x2 - x1)*(z - z1)/(z2 - z1) + x1) hit = !hit;
      }
      return hit;
    };
    const zones = pts.map(([x, z])=>{ const r = rooms.find(r=>r.level === door.floor && inside(x, z, r.polygon)); return r ? (r.zone || 'home') : null; });
    return zones.includes('guest') ? 'guest' : 'home';
  }

  // ラシッサの戸か（扉本体がある室内の戸で、対象外の戸でない）
  const isLasissaDoor = (lasissa, door, operation)=>['swing', 'slide'].includes(operation) && !(door.id in lasissa.excludedDoors);

  const api = {resolveSelection, designOf, leafParts, handleParts, subtractRects, doorZone, isLasissaDoor};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RyukaLasissa = api;
})(typeof window !== 'undefined' ? window : globalThis);
