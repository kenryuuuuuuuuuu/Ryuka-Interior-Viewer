// ラシッサD（LIXIL の室内ドア）の木目・単色の模様を計算で作る（2026-11-15）。
// 色と木目の数字は data/lasissa-d.json（公式の色見本と並べて合わせた）。画像は持たない。
// blender/lasissa_assets.py の wood_shade() と同じ計算（tests/test_lasissa_web.mjs が数字の一致を確かめる）。
//   模様の1枚＝木目に直交する方向 W/PX_PER_M m × 木目に沿った方向 H/PX_PER_M m（約1.07m × 2.13m。戸1枚に繰り返しが出ない）。
//   出力 shade は平均0の明暗。色は「明るい部分（light）と暗い部分（dark）」を、明暗の上位・下位10%に合わせて塗る。
(function(root){
  const W = 512, H = 1024, PX_PER_M = 480;

  function mulberry32(seed){
    let a = seed >>> 0;
    return function(){ a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // 継ぎ目なく繰り返す値ノイズ（0〜1）。横 cx 個 × 縦 cy 個の格子。x・y は画素（小数可、端で回り込む）
  function makeNoise(cx, cy, rnd){
    cx = Math.max(1, Math.round(cx)); cy = Math.max(1, Math.round(cy));
    const grid = new Float64Array(cx*cy);
    for(let i = 0; i < grid.length; i++) grid[i] = rnd();
    return function(x, y){
      const tx = (x/W)*cx, ty = (y/H)*cy;
      const ix = Math.floor(tx), iy = Math.floor(ty);
      let fx = tx - ix, fy = ty - iy;
      fx = fx*fx*(3 - 2*fx); fy = fy*fy*(3 - 2*fy);
      const x0 = ((ix % cx) + cx) % cx, x1 = (x0 + 1) % cx, y0 = ((iy % cy) + cy) % cy, y1 = (y0 + 1) % cy;
      const a = grid[y0*cx + x0], b = grid[y0*cx + x1], c = grid[y1*cx + x0], d = grid[y1*cx + x1];
      return (a*(1 - fx) + b*fx)*(1 - fy) + (c*(1 - fx) + d*fx)*fy;
    };
  }

  // 明暗（平均0）と凹凸（高さ）。p は data/lasissa-d.json の色の wood（木目）または plain（単色のむら）
  //   warp：縞が横へ揺れる量(m)、band：幅の広い縞（約2〜5cm）、mid：中くらいの筋（約0.6〜1.5cm）、fine：細い筋（画素の幅）、
  //   figure：板目の山形・炎形の線、rings：その線の間隔(m)、pores：道管の点、knots：節の数（1m²あたり）、seed：乱数の種
  function woodShade(p){
    const rnd = mulberry32(p.seed || 1);
    const A = W/PX_PER_M, L = H/PX_PER_M;   // 実寸(m)
    const warpLo = makeNoise(3, 2, rnd), warpHi = makeNoise(9, 5, rnd);
    const band1 = makeNoise(A/(p.bandScale || .035), 2, rnd), band2 = makeNoise(A/((p.bandScale || .035)/2.3), 3, rnd);
    const mid = makeNoise(A/.008, L/1.0, rnd), fine = makeNoise(W/2, L/.25, rnd);
    const figNoise = makeNoise(4, 3, rnd), figMask = makeNoise(3, 2, rnd);
    const pore = makeNoise(W/1, L/.006, rnd);
    const lineWiggle = makeNoise(A/.05, L/.5, rnd), lineVar = makeNoise(A/.02, L/.25, rnd);
    const knots = [];
    const nk = Math.round((p.knots || 0)*A*L);
    for(let k = 0; k < nk; k++) knots.push({x: rnd()*W, y: rnd()*H, r: (.008 + rnd()*.014)*PX_PER_M, e: 2.2 + rnd()*1.2});
    const gapPx = (p.lineGap || .005)*PX_PER_M;
    const shade = new Float64Array(W*H), height = new Float64Array(W*H);
    const ringPx = (p.rings || .012)*PX_PER_M;
    for(let y = 0; y < H; y++){
      for(let x = 0; x < W; x++){
        const warp = ((warpLo(x, y) - .5) + .2*(warpHi(x, y) - .5))*(p.warp || 0)*PX_PER_M;
        const xa = x + warp;
        let s = (p.band || 0)*((band1(xa, y) - .5) + .5*(band2(xa, y) - .5))
              + (p.mid || 0)*(mid(xa, y) - .5)
              + (p.fine || 0)*(fine(xa, y) - .5);
        let h = (p.fine || 0)*(fine(xa, y) - .5);
        if(p.figure){
          // 板目の線：揺れた座標を一定の間隔で区切った境目を細く暗くする（ゆるい曲がりで山形・炎形に見える）。
          // 出る場所は大きなむら（figMask）で限る（板目の出る板と柾目の板が混ざる）
          const f = (xa + (figNoise(x, y) - .5)*ringPx*1.6)/ringPx;
          const d = Math.abs(f - Math.round(f));
          const line = Math.max(0, 1 - d/.07);
          const m0 = Math.min(1, Math.max(0, (figMask(x, y) - .45)/.25)), mask = m0*m0*(3 - 2*m0);
          s -= p.figure*mask*line*line; h -= p.figure*.5*mask*line;
        }
        if(p.lines){
          // 細く長い木目の線（数mm間隔）。濃さは場所でむらがある
          const g = (xa + (lineWiggle(x, y) - .5)*gapPx*1.5)/gapPx;
          const dl = Math.abs(g - Math.round(g));
          const ln = Math.max(0, 1 - dl/.32), v = lineVar(x, y);
          s -= p.lines*ln*v*v; h -= p.lines*.4*ln*v;
        }
        if(p.pores){
          const v = pore(xa, y);
          const dot = Math.max(0, (v - .82)/.18);
          s -= p.pores*dot; h -= p.pores*dot;
        }
        for(const k of knots){
          let dx = x - k.x, dy = (y - k.y)/k.e;
          dx -= Math.round(dx/W)*W; dy -= Math.round(dy/H)*H;   // 端で回り込む
          const r2 = (dx*dx + dy*dy)/(k.r*k.r);
          if(r2 < 9){
            const core = Math.exp(-r2*1.6), ring = Math.exp(-Math.pow(Math.sqrt(r2) - 1.6, 2)*6);
            s -= .7*core + .25*ring; h -= .4*core;
          }
        }
        shade[y*W + x] = s; height[y*W + x] = h;
      }
    }
    // 平均0、明暗の上位・下位10%が ±1 になるように合わせる（色は light/dark に合わせて塗るため）
    let mean = 0; for(let i = 0; i < shade.length; i++) mean += shade[i]; mean /= shade.length;
    const sorted = Float64Array.from(shade).sort();
    const lo = sorted[Math.floor(sorted.length*.1)], hi = sorted[Math.floor(sorted.length*.9)];
    const k = hi > lo ? 2/(hi - lo) : 0, c = (hi + lo)/2;
    for(let i = 0; i < shade.length; i++) shade[i] = (shade[i] - c)*k;
    return {shade, height, width: W, height_px: H, pxPerM: PX_PER_M};
  }

  const hexRgb = h=>[0, 2, 4].map(i=>parseInt(h.slice(i, i + 2), 16)/255);
  // 色の画像（0〜1のRGB、Float32Array で W×H×3）。明暗 s を「light と dark の平均 ± 半分の差 × s」で塗る
  function woodColors(color, shadeResult){
    const light = hexRgb(color.light), dark = hexRgb(color.dark);
    const out = new Float32Array(W*H*3), s = shadeResult.shade;
    for(let i = 0; i < W*H; i++)
      for(let c = 0; c < 3; c++) out[i*3 + c] = Math.min(1, Math.max(0, (light[c] + dark[c])/2 + (light[c] - dark[c])/2*s[i]));
    return out;
  }

  const api = {W, H, PX_PER_M, mulberry32, woodShade, woodColors, hexRgb};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RyukaLasissaWood = api;
})(typeof window !== 'undefined' ? window : globalThis);
