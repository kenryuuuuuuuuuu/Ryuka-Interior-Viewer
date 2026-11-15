// 玄関ドア（LIXIL ジエスタ2、2026-11-15）の選び方と、戸本体の部品。
// 正本は data/giesta-doors.json（型・色・割当）と data/finishes.json の案の entranceDoors（戸ごとの上書き）。
// 今は施主がショールームで絞った2点（自宅 P12型×ハンドダウンチェリー、民泊 G13型×チーク）を決め打ちで当てはめている。
// 型・色を足せば選べる（左メニューの「玄関ドア」）。ブラウザ（interior-white-model.html の内覧の戸）と、Blender 用の生成
// （scripts/build-web-data.mjs → generated/door-leaves.json の entrance）が同じ部品を使う。web/lasissa.js と同じ作りで、
// 違いは「戸の外側と室内側で見た目が違う」こと：
//   部品の座標（box は [x0, x1, y0, y1, z0, z1]、m）：x＝吊り元0〜取っ手の側 w、y＝下端0〜上端 h、
//   z＝戸の厚みの中心0、+z が外側（外開きの戸の開く側）、−z が室内側。
//   デザインの割合 u は「取っ手の側から」の戸の幅に対する割合（画像の左から）、v は下から：x = w×(1−u)、y = h×v。
(function(root){
  const byId = list=>Object.fromEntries(list.map(x=>[x.id, x]));
  const SLAB_SKIN = .0008;   // 溝（凹んだ所）の暗い面の厚み
  const rnd6 = v=>Math.round(v*1e6)/1e6;

  // 戸の選択：data の割当（戸ごと）→ 案の entranceDoors の上書き。選べない組み合わせは、その型の最初の色・金物の最初の色にする
  function resolveSelection(giesta, doorId, overrides){
    const base = giesta.assignments[doorId];
    if(!base) return null;
    const pick = Object.assign({}, base, ((overrides || {})[doorId]) || {});
    const model = byId(giesta.models)[pick.model] || giesta.models[0];
    const known = byId(giesta.colors);
    const colors = model.colors.filter(c=>known[c]);
    const color = colors.includes(pick.color) ? pick.color : colors[0];
    const finish = byId(giesta.handleFinishes)[pick.handleFinish] ? pick.handleFinish : giesta.handleFinishes[0].id;
    return {model: model.id, color, handleFinish: finish};
  }

  // [a, b] の区間の並びから、[lo, hi] の中で区間に入らない所を返す
  function complement(intervals, lo, hi){
    const sorted = intervals.map(r=>[Math.max(lo, r[0]), Math.min(hi, r[1])]).filter(r=>r[1] > r[0]).sort((a, b)=>a[0] - b[0]);
    const out = []; let cur = lo;
    for(const [a, b] of sorted){ if(a > cur + 1e-6) out.push([cur, a]); cur = Math.max(cur, b); }
    if(hi > cur + 1e-6) out.push([cur, hi]);
    return out;
  }

  // 長方形 r から穴を除いた残りを、重ならない長方形に分ける（web/lasissa.js の subtractRects と同じ）
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

  // 戸本体の部品。sel は resolveSelection() の結果、w・h は戸の幅・高さ（枠の内側）
  // 材質：door（面材の色・木目。grain は 'y'＝縦木目）、groove（溝の暗い面）、glass（ガラス。glass に種類）、
  // metal（金物。finish の色。kind は box／cylZ）
  function leafParts(giesta, sel, w, h){
    const T = giesta.leaf.thickness, t2 = T/2, model = byId(giesta.models)[sel.model], out = model.outside, parts = [];
    const X = u=>w*(1 - u), Y = v=>h*v;
    const add = (name, box, mat, extra)=>parts.push(Object.assign({name, box: box.map(rnd6), mat}, extra || {}));
    const black = {finish: 'matte-black'}, silver = {finish: 'blast-silver'};
    const finish = {finish: sel.handleFinish};

    // 1. 戸の板：スリットの穴を空けた面材（縦木目）。ガラスと、スリットの上下の黒い部分（ツートーン）
    const slit = out.slit, hole = [X(slit.u[1]), X(slit.u[0]), Y(slit.v[0]), Y(slit.v[1])];
    subtractRects([0, w, 0, h], [hole]).forEach((r, i)=>add(`slab-${i}`, [r[0], r[1], r[2], r[3], -t2, t2], 'door', {grain: 'y'}));
    add('glass', [hole[0], hole[1], hole[2], hole[3], -.003, .003], 'glass', {glass: 'slit'});
    const st = slit.strip, sx = [X(st.u[1]), X(st.u[0])];
    add('strip-bottom', [sx[0], sx[1], Y(st.v[0]), hole[2], t2, t2 + .004], 'metal', black);
    add('strip-top', [sx[0], sx[1], hole[3], Y(st.v[1]), t2, t2 + .004], 'metal', black);

    // 2. 外側の浮き出し（リブ・板・モール）と、その間の溝（暗い面）
    const raised = [[st.u[0], st.u[1]]];
    (out.faces || []).forEach((f, i)=>{
      const g = f.step ? f.step.grow : 0, a = Math.max(0, f.u[0] - g), b = Math.min(1, f.u[1] + g);   // 段は戸の幅の内側に収める
      if(f.step) add(`face-${i}-step`, [X(b), X(a), 0, h, t2, t2 + f.step.rel/1000], 'door', {grain: 'y'});
      add(`face-${i}`, [X(f.u[1]), X(f.u[0]), 0, h, t2, t2 + f.rel/1000], 'door', {grain: 'y'});
      raised.push([a, b]);
    });
    (out.lobes || []).forEach((lb, i)=>{
      // 反りのある隆起を段で表す：外側ほど低く、中心ほど高い（inset は幅に対する内側への寄り）
      const span = lb.u[1] - lb.u[0];
      lb.rel.forEach((rel, k)=>{
        const a = lb.u[0] + span*lb.inset[k]/2, b = lb.u[1] - span*lb.inset[k]/2;
        add(`lobe-${i}-${k}`, [X(b), X(a), 0, h, t2, t2 + rel/1000], 'door', {grain: 'y'});
      });
      raised.push([lb.u[0], lb.u[1]]);
    });
    complement(raised, 0, 1).forEach((r, i)=>add(`groove-${i}`, [X(r[1]), X(r[0]), 0, h, t2, t2 + SLAB_SKIN], 'groove'));

    // 3. 外側の金物：ハンドル（縦の長い棒）、錠のシリンダー、丁番（吊り元の縁）
    const hd = out.handle, hx = X(hd.u), hrel = hd.rel/1000, y0 = Y(hd.v[0]), y1 = Y(hd.v[1]);
    add('handle-bar', [hx - .0095, hx + .0095, y0, y1, t2 + hrel + .02, t2 + hrel + .044], 'metal', finish);
    add('handle-post-0', [hx - .0075, hx + .0075, y0, y0 + .03, t2 + hrel, t2 + hrel + .02], 'metal', finish);
    add('handle-post-1', [hx - .0075, hx + .0075, y1 - .03, y1, t2 + hrel, t2 + hrel + .02], 'metal', finish);
    (out.cylinders || []).forEach((c, i)=>add(`cylinder-${i}`, [X(c.u) - .014, X(c.u) + .014, Y(c.v) - .014, Y(c.v) + .014, t2 + hrel, t2 + hrel + .005], 'metal', Object.assign({kind: 'cylZ'}, silver)));
    (giesta.hinges || []).forEach((hg, i)=>add(`hinge-${i}`, [-.012, .004, Y(hg.v[0]), Y(hg.v[1]), t2 - .004, t2 + .012], 'metal', black));

    // 4. 室内側：スリットの縁取り、内側のグリップ、サムターン、錠のシリンダー、ドアクローザー（吊り元の上）
    const ins = giesta.inside, b = ins.slit_surround.border, ir = ins.slit_surround.rel/1000;
    add('in-surround-l', [hole[0] - b, hole[0], hole[2] - b, hole[3] + b, -t2 - ir, -t2], 'door', {grain: 'y'});
    add('in-surround-r', [hole[1], hole[1] + b, hole[2] - b, hole[3] + b, -t2 - ir, -t2], 'door', {grain: 'y'});
    add('in-surround-b', [hole[0], hole[1], hole[2] - b, hole[2], -t2 - ir, -t2], 'door', {grain: 'x'});
    add('in-surround-t', [hole[0], hole[1], hole[3], hole[3] + b, -t2 - ir, -t2], 'door', {grain: 'x'});
    const gx = X(ins.grip.u), g0 = Y(ins.grip.v[0]), g1 = Y(ins.grip.v[1]);
    add('in-grip-bar', [gx - .0095, gx + .0095, g0, g1, -t2 - .044, -t2 - .02], 'metal', finish);
    add('in-grip-post-0', [gx - .0075, gx + .0075, g0, g0 + .03, -t2 - .02, -t2], 'metal', finish);
    add('in-grip-post-1', [gx - .0075, gx + .0075, g1 - .03, g1, -t2 - .02, -t2], 'metal', finish);
    const tt = ins.thumbturn, ty = Y(tt.v), bx = Math.min(X(tt.u[0]), w - .025);   // 土台は戸の縁から2.5cm内側
    add('in-thumbturn', [X(tt.u[1]), bx, ty - .007, ty + .007, -t2 - .022, -t2 - .01], 'metal', black);
    add('in-thumbturn-base', [bx - .02, bx + .02, ty - .02, ty + .02, -t2 - .01, -t2], 'metal', Object.assign({kind: 'cylZ'}, silver));
    (ins.cylinders || []).forEach((c, i)=>add(`in-cylinder-${i}`, [X(c.u) - .014, X(c.u) + .014, Y(c.v) - .014, Y(c.v) + .014, -t2 - .006, -t2], 'metal', Object.assign({kind: 'cylZ'}, silver)));
    const cl = ins.closer;
    add('in-closer-body', [w*cl.body.x[0], w*cl.body.x[1], Y(cl.body.v[0]), Y(cl.body.v[1]), -t2 - .045, -t2], 'metal', black);
    add('in-closer-arm', [w*cl.arm.x[0], w*cl.arm.x[1], Y(cl.arm.v) - .006, Y(cl.arm.v) + .006, -t2 - .04, -t2 - .03], 'metal', black);
    return parts;
  }

  const api = {resolveSelection, leafParts, complement, subtractRects};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RyukaGiesta = api;
})(typeof window !== 'undefined' ? window : globalThis);
