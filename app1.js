
// ============================================================================
// Three.js セットアップ
// LEVELS/FLOOR1/FLOOR2/OPENINGS/SOUND_WALL/INTERIOR_DOORS/ROOMS_APPROX/ROOFS は
// generated/house-data.js (data/house.json から自動生成) が定義する。
// 建物データを変更する場合はここではなく data/house.json を編集し、
// node scripts/build-web-data.mjs を実行してから確認すること。詳細は docs/ARCHITECTURE.md
// ============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe4e8);
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
document.getElementById('canvas-wrap').appendChild(renderer.domElement);

// 光の合計が1を超えると白い面（床・マットレス・白い壁）が真っ白に飛ぶ。上向きの白い面でも約1.1（ほぼ白）に収める
// （2026-11-03：環境光0.75＋太陽0.9＋0.35では上面が1.4程度になり、色の違いが消えていた）。
// 半球光（上と下の色をわずかに変える）で天井や下向きの面にも光を回し、太陽で面の向きによる明るさの差を残す
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4cc, 0.76));
const sun = new THREE.DirectionalLight(0xffffff, 0.34);
sun.position.set(12, 18, 6);
scene.add(sun);
const sun2 = new THREE.DirectionalLight(0xffffff, 0.15);
sun2.position.set(-8, 10, -10);
scene.add(sun2);

// 建物中心を原点付近に置くための移動量（910mmグリッドに西端(x=0)・北端(z=0)が乗るよう調整）
const CX = 9.100, CZ = 3.640; // 9.100=910mm×10, 3.640=910mm×4
function toScene(x,z){ return [x-CX, z-CZ]; }

// カメラ初期位置
let camDist = 26, camTheta = 0.9, camPhi = 1.05;
const camTarget = new THREE.Vector3(0, 2, 0);
function updateCamera(){
  camera.position.x = camTarget.x + camDist*Math.sin(camPhi)*Math.sin(camTheta);
  camera.position.z = camTarget.z + camDist*Math.sin(camPhi)*Math.cos(camTheta);
  camera.position.y = camTarget.y + camDist*Math.cos(camPhi);
  camera.lookAt(camTarget);
}
updateCamera();

// ============================================================================
// 表示モード：'top'（平面図・正射投影）／'orbit'（俯瞰・自由回転）／'walk'（内覧・一人称）
// ============================================================================
let mode = 'top'; // デフォルトを平面図モードに（2026-08-13）
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ---- 俯瞰モード：簡易オービットコントロール（外部ライブラリ非依存） ----
let dragging=false, dragButton=0, lastX=0, lastY=0;
// ピンチズーム：2本指の距離変化をホイールズームと同じ処理に変換する
const activePointers = new Map();
let pinchDist = null;
// 2本指ドラッグでのパン（スライド）：ピンチ（指の間隔変化）はズームだけを見ていて、
// 2本指の中心点そのものの移動（＝スライド操作）を追跡していなかったため、俯瞰モードで
// 2本指スライドしても画面が追従しない不具合があった（2026-08-16、施主指摘）
let pinchMidX = null, pinchMidY = null;
function applyZoomDelta(delta){
  // delta>0（指を広げた＝ズームイン）でorthoHalfSize/camDistを縮める
  if(mode==='top'){
    orthoHalfSize = Math.min(Math.max(orthoHalfSize - delta*0.025, 1.5), 30);
    updateOrthoFrustum();
  } else if(mode==='orbit'){
    camDist = Math.min(Math.max(camDist - delta*0.06, 4), 70);
    updateCamera();
  }
}
// パン（平行移動）：平面図モードの単指ドラッグ／俯瞰モードの右ドラッグ／両モードの
// 2本指ドラッグから共通で呼ばれる
function panCamera(dx, dy){
  if(mode==='top'){
    const worldPerPx = (orthoHalfSize*2)/innerHeight;
    orthoTarget.x -= dx*worldPerPx;
    orthoTarget.z -= dy*worldPerPx;
    updateOrthoCam();
  } else if(mode==='orbit'){
    const right = new THREE.Vector3(); camera.getWorldDirection(right); right.cross(camera.up).normalize();
    camTarget.addScaledVector(right, -dx*0.02);
    camTarget.y += dy*0.02;
    updateCamera();
  }
}

// ---- 家具の配置編集（平面図モード限定）：選択・ドラッグ移動 ----
// furnitureMeshes/effectiveFurniture/FURNITURE_ITEMS 等はこの後ろで定義されるが、
// ここで作る関数は実際に呼ばれるのはユーザー操作時（全スクリプト実行後）なので問題ない。
let editMode = false;
let selectedFurnitureId = null;
let draggingFurniture = false;
let dragPlaneY = 0;
const editRaycaster = new THREE.Raycaster();
const editPointerNDC = new THREE.Vector2();
let selectionHelper = null;
// ---- 窓・ドアの配置編集（第2段階）の状態。家具編集と排他（同時にON にはしない） ----
let doorEditMode = false;
let selectedDoorWindowId = null;
let draggingDoorWindow = false;
let doorSelectionHelper = null;
// ---- 電気設備の配置編集（第2段階）の状態。家具編集・窓ドア編集と三者択一で排他 ----
let electricalEditMode = false;
let selectedElectricalId = null;
let draggingElectrical = false;
let electricalSelectionHelper = null;

function ndcFromClient(clientX, clientY){
  const rect = renderer.domElement.getBoundingClientRect();
  editPointerNDC.x = ((clientX-rect.left)/rect.width)*2-1;
  editPointerNDC.y = -((clientY-rect.top)/rect.height)*2+1;
  return editPointerNDC;
}
function isEffectivelyVisible(obj){
  // Three.js(r128)のRaycasterはvisible:falseのオブジェクトを自動的には除外しないため、
  // 祖先を辿って明示的に確認する。1F/2F表示切替で非表示中の家具が選択されてしまう不具合の対策。
  for(let node = obj; node; node = node.parent){
    if(node.visible === false) return false;
  }
  return true;
}
// 編集の選択・ドラッグは、いま表示中のカメラで判定する（2026-10 UI整理：以前は家具・窓ドアは
// 平面図（orthoCam）専用、電気設備は俯瞰（camera）専用で、種類ごとに使える視点が違っていた）
function editCam(){ return mode==='top' ? orthoCam : camera; }
function pickFurnitureAt(clientX, clientY){
  editRaycaster.setFromCamera(ndcFromClient(clientX, clientY), editCam());
  const hits = editRaycaster.intersectObject(furnitureAll, true);
  for(const hit of hits){
    if(!isEffectivelyVisible(hit.object)) continue;
    let obj = hit.object;
    while(obj){
      if(obj.userData && obj.userData.furnitureId) return obj.userData.furnitureId;
      obj = obj.parent;
    }
  }
  return null;
}
function groundPointAt(clientX, clientY, planeY, cam=editCam()){
  editRaycaster.setFromCamera(ndcFromClient(clientX, clientY), cam);
  const ro = editRaycaster.ray.origin, rd = editRaycaster.ray.direction;
  if(Math.abs(rd.y) < 1e-6) return null;
  const t = (planeY - ro.y) / rd.y;
  return { x: ro.x + rd.x*t, z: ro.z + rd.z*t };
}
function setSelectedFurniture(id){
  selectedFurnitureId = id;
  if(selectionHelper){ scene.remove(selectionHelper); selectionHelper = null; }
  if(id){
    const entry = furnitureMeshes.get(id);
    if(entry){
      selectionHelper = new THREE.BoxHelper(entry.holder, 0xffcf3a);
      selectionHelper.renderOrder = 10;
      scene.add(selectionHelper);
    }
  }
  updateFurniturePanel();
}
function moveSelectedFurnitureTo(clientX, clientY){
  if(!selectedFurnitureId) return;
  const p = groundPointAt(clientX, clientY, dragPlaneY);
  if(!p) return;
  const entry = furnitureMeshes.get(selectedFurnitureId);
  if(!entry) return;
  entry.holder.position.x = p.x; entry.holder.position.z = p.z;
  entry.label.pos.x = p.x; entry.label.pos.z = p.z;
  furnitureEdits[selectedFurnitureId] = {...(furnitureEdits[selectedFurnitureId]||{}), x: round2(p.x+CX), z: round2(p.z+CZ)};
  updateFurniturePanel();
}
function setEditMode(on){
  editMode = on;
  if(!on){ setSelectedFurniture(null); draggingFurniture=false; }
  else {
    setDoorEditMode(false); // 家具編集・窓ドア編集・電気設備編集は三者択一で排他
    setElectricalEditMode(false);
    furnitureAll.visible = true;
  }
  document.getElementById('editToggle').classList.toggle('active', editMode);
  document.getElementById('furniturePanel').style.display = (editMode && selectedFurnitureId) ? 'block' : 'none';
  document.getElementById('editHint').style.display = editMode ? 'block' : 'none';
  document.getElementById('furnitureBar').style.display = editMode ? 'flex' : 'none';
}

renderer.domElement.addEventListener('contextmenu', e=>e.preventDefault());
renderer.domElement.addEventListener('pointerdown', e=>{
  if(mode==='walk'){ onWalkPointerDown(e); return; }
  if(mode!=='orbit' && mode!=='top') return;
  activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(activePointers.size===2){
    dragging = false; draggingFurniture = false; draggingDoorWindow = false; draggingElectrical = false; // 2本指になったら単指ドラッグは止める
    const [p1,p2] = [...activePointers.values()];
    pinchDist = Math.hypot(p1.x-p2.x, p1.y-p2.y);
    pinchMidX = (p1.x+p2.x)/2; pinchMidY = (p1.y+p2.y)/2;
    return;
  }
  if(doorEditMode){
    const id = pickDoorWindowAt(e.clientX, e.clientY);
    selectDoorWindow(id);
    if(id){
      const sel = findDoorWindowBase(id);
      dragPlaneY = sel.isExterior ? (sel.base.level===1 ? LEVELS.fl1 : LEVELS.fl2) : (sel.base.floor===1 ? LEVELS.fl1 : LEVELS.fl2);
      draggingDoorWindow = true;
      return; // 窓・ドアを選択した場合はカメラのパンを発生させない
    }
  } else if(editMode){
    const id = pickFurnitureAt(e.clientX, e.clientY);
    setSelectedFurniture(id);
    if(id){
      const base = FURNITURE_ITEMS.find(f=>f.id===id);
      dragPlaneY = base.level===1 ? LEVELS.fl1 : LEVELS.fl2;
      draggingFurniture = true;
      return; // 家具を選択した場合はカメラのパンを発生させない
    }
  } else if(electricalEditMode){
    const id = pickElectricalAt(e.clientX, e.clientY);
    setSelectedElectrical(id);
    if(id){
      const base = findElectricalBase(id);
      dragPlaneY = base.level===1 ? LEVELS.fl1 : LEVELS.fl2;
      draggingElectrical = true;
      electricalDragSnapshotTaken = false;
      return; // 電気設備を選択した場合はカメラの回転/パンを発生させない
    }
  }
  dragging=true; dragButton=e.button; lastX=e.clientX; lastY=e.clientY;
});
window.addEventListener('pointerup', e=>{
  activePointers.delete(e.pointerId);
  if(activePointers.size<2){ pinchDist = null; pinchMidX = null; pinchMidY = null; }
  dragging=false;
  if(draggingFurniture){ draggingFurniture=false; saveFurnitureEdits(); }
  if(draggingDoorWindow){ draggingDoorWindow=false; saveDoorWindowEdits(); }
  if(draggingElectrical){ draggingElectrical=false; saveElectricalEdits(); }
  onWalkPointerUp(e);
});
window.addEventListener('pointermove', e=>{
  if(mode==='walk'){ onWalkPointerMove(e); return; }
  if(activePointers.has(e.pointerId)) activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(activePointers.size===2){
    const [p1,p2] = [...activePointers.values()];
    const dist = Math.hypot(p1.x-p2.x, p1.y-p2.y);
    if(pinchDist!==null) applyZoomDelta(dist-pinchDist);
    pinchDist = dist;
    // 2本指の中心点の移動でパン（スライド）。指を広げ縮めしつつ同時に動かしても、
    // ズームとパンは独立に効く
    const midX=(p1.x+p2.x)/2, midY=(p1.y+p2.y)/2;
    if(pinchMidX!==null) panCamera(midX-pinchMidX, midY-pinchMidY);
    pinchMidX = midX; pinchMidY = midY;
    return;
  }
  if(electricalEditMode && !draggingElectrical) updateElectricalHover(e.clientX, e.clientY);
  if(draggingFurniture){ moveSelectedFurnitureTo(e.clientX, e.clientY); return; }
  if(draggingDoorWindow){ moveSelectedDoorWindowTo(e.clientX, e.clientY); return; }
  if(draggingElectrical){ moveSelectedElectricalTo(e.clientX, e.clientY); return; }
  if(!dragging) return;
  const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
  if(mode==='top'){
    // 平面図モード：ドラッグで平行移動のみ
    panCamera(dx, dy);
    return;
  }
  if(dragButton===2){
    panCamera(dx, dy);
  } else {
    camTheta -= dx*0.005; camPhi = Math.min(Math.max(camPhi - dy*0.005, 0.15), 1.5);
    updateCamera();
  }
});
renderer.domElement.addEventListener('wheel', e=>{
  if(mode==='walk') return;
  if(mode==='top'){
    orthoHalfSize = Math.min(Math.max(orthoHalfSize + e.deltaY*0.01, 1.5), 30);
    updateOrthoFrustum();
    e.preventDefault();
    return;
  }
  camDist = Math.min(Math.max(camDist + e.deltaY*0.02, 4), 70); updateCamera(); e.preventDefault();
}, {passive:false});

// ---- 平面図モード（真上からの正射投影カメラ） ----
const orthoCam = new THREE.OrthographicCamera(-10,10,10,-10,0.1,200);
const orthoTarget = new THREE.Vector3(0,0,0);
let orthoHalfSize = 11; // 表示範囲の半径(m相当)。ホイールでズーム
function updateOrthoFrustum(){
  const aspect = innerWidth/innerHeight;
  orthoCam.left = -orthoHalfSize*aspect;
  orthoCam.right = orthoHalfSize*aspect;
  orthoCam.top = orthoHalfSize;
  orthoCam.bottom = -orthoHalfSize;
  orthoCam.updateProjectionMatrix();
}
function updateOrthoCam(){
  orthoCam.position.set(orthoTarget.x, 40, orthoTarget.z);
  orthoCam.up.set(0,0,-1); // 北(z小さい方)が画面上方に来るようにする
  orthoCam.lookAt(orthoTarget.x, 0, orthoTarget.z);
  updateOrthoFrustum();
}
updateOrthoCam();

// ---- モード切替UI ----
const modeButtons = { top: document.getElementById('modeTop'), orbit: document.getElementById('modeOrbit'), walk: document.getElementById('modeWalk') };
function setMode(next){
  if(next==='walk' && mode!=='walk'){
    openSpawnOverlay();
    return; // 実際のモード切替はスポーン選択後（enterWalkMode内）に行う
  }
  if(mode==='walk' && next!=='walk') exitWalkMode();
  mode = next;
  applyModeChrome(mode);
}
modeButtons.top.onclick = ()=> setMode('top');
modeButtons.orbit.onclick = ()=> setMode('orbit');
modeButtons.walk.onclick = ()=> setMode('walk');

// ---- 左メニューの表示/非表示 ----
const uiPanel = document.getElementById('ui');
document.getElementById('menuToggle').onclick = ()=>{
  uiPanel.classList.toggle('hidden');
};

// ============================================================================
// ジオメトリ生成
// ============================================================================
// フロアごとに独立したマテリアルを持たせる（床スラブの色を1F/2Fで変えるため。
// 1F/2F切替時の表示・非表示はマテリアルではなくグループのvisibleで行う）
function makeFloorMats(floorSlabColor){
  return {
    approx:     new THREE.MeshBasicMaterial({color:0xffd479, transparent:true, opacity:0.35, side:THREE.DoubleSide, depthWrite:false}), // Basic材質でライティング非依存に統一(矩形/L字ポリゴンの見た目差異を解消)
    approxEdge: new THREE.LineBasicMaterial({color:0xb07a00, transparent:true, opacity:1, depthTest:false}),
    opening:    new THREE.MeshStandardMaterial({color:0x6fb3e0, transparent:true, opacity:0.85, side:THREE.DoubleSide, depthWrite:false}), // 窓
    extDoor:    new THREE.MeshStandardMaterial({color:0xff1fb0, emissive:0xff1fb0, emissiveIntensity:0.35, transparent:true, opacity:0.95, side:THREE.DoubleSide, depthWrite:false}), // 外部ドア（室内ドアと同系色で統一）
    floorSlab:  new THREE.MeshStandardMaterial({color:floorSlabColor, side:THREE.DoubleSide, transparent:true, opacity:1, depthWrite:false}),
    sound:      new THREE.MeshStandardMaterial({color:0xe05252, transparent:true, opacity:0.85, side:THREE.DoubleSide, depthWrite:false}),
    roof:       new THREE.MeshStandardMaterial({color:0xa89f8f, transparent:true, opacity:0.9, side:THREE.DoubleSide, depthWrite:false}),
    roofEdge:   new THREE.LineBasicMaterial({color:0x6b6152, transparent:true, opacity:1, depthTest:false}),
    door:       new THREE.MeshStandardMaterial({color:0xff1fb0, emissive:0xff1fb0, emissiveIntensity:0.35, transparent:true, opacity:0.95, side:THREE.DoubleSide, depthWrite:false}),
    doorEdge:   new THREE.LineBasicMaterial({color:0x1a1a1a, transparent:true, opacity:1, depthTest:false})
  };
}
const M1 = makeFloorMats(0xf3f0e8); // 1F用マテリアル一式
const M2 = makeFloorMats(0xeef2f5); // 2F用マテリアル一式

// 各グループの入れ子構造は「レイヤー種別のチェックボックス」×「1F/2F表示」の
// 2軸を、Object3D.visible の階層ANDだけで表現するためのもの。
// 例: 屋根チェックボックス(roofAll.visible)がONでも、1F表示中はroofGableが
// 非表示なので2階の切妻屋根は出ない。逆に1F/2F=両方でもチェックボックスが
// OFFならroofAll自体が非表示になり何も出ない。
const groups = {
  approx1:new THREE.Group(), approx2:new THREE.Group(),
  openings1:new THREE.Group(), openings2:new THREE.Group(),
  doors1:new THREE.Group(), doors2:new THREE.Group(),
  sound:new THREE.Group(),
  roofHiraya:new THREE.Group(), roofGable:new THREE.Group(),
  furniture1:new THREE.Group(), furniture2:new THREE.Group(),
  electrical1:new THREE.Group(), electrical2:new THREE.Group(),
  floor1:new THREE.Group(), floor2:new THREE.Group()
};
const approxAll = new THREE.Group(); approxAll.add(groups.approx1, groups.approx2);
const openingsAll = new THREE.Group(); openingsAll.add(groups.openings1, groups.openings2);
const doorsAll = new THREE.Group(); doorsAll.add(groups.doors1, groups.doors2);
const roofAll = new THREE.Group(); roofAll.add(groups.roofHiraya, groups.roofGable);
roofAll.visible = false; // デフォルトで屋根を非表示に変更（2026-08-13）
const furnitureAll = new THREE.Group(); furnitureAll.add(groups.furniture1, groups.furniture2);
const electricalAll = new THREE.Group(); electricalAll.add(groups.electrical1, groups.electrical2);
const soundFloorGate = new THREE.Group(); soundFloorGate.add(groups.sound); // 防音壁は1F扱いなので1F/2F表示に連動させる
[approxAll, openingsAll, doorsAll, soundFloorGate, roofAll, furnitureAll, electricalAll, groups.floor1, groups.floor2].forEach(g=>scene.add(g));

function boxWire(x0,x1,y0,y1,z0,z1, mat, edgeMat, parent, renderOrder){
  const [sx0,sz0]=toScene(x0,z0), [sx1,sz1]=toScene(x1,z1);
  const w=sx1-sx0, d=sz1-sz0, h=y1-y0;
  const geo = new THREE.BoxGeometry(Math.max(w,0.02), Math.max(h,0.02), Math.max(d,0.02));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(sx0+w/2, y0+h/2, sz0+d/2);
  if(renderOrder!==undefined) mesh.renderOrder = renderOrder;
  parent.add(mesh);
  if(edgeMat){
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, edgeMat);
    line.position.copy(mesh.position);
    if(renderOrder!==undefined) line.renderOrder = renderOrder+0.5;
    parent.add(line);
  }
  return mesh;
}

// boxWireのY軸回転版（階段の段差など、進行方向に合わせて向きを変えたい箱に使う）。
// cx,czは箱の中心（建物ローカル座標）、angleYはラジアン
function boxWireRotated(cx, cz, angleY, width, depth, y0, y1, mat, edgeMat, parent, renderOrder){
  const [sx,sz] = toScene(cx, cz);
  const h = y1-y0;
  const geo = new THREE.BoxGeometry(Math.max(width,0.02), Math.max(h,0.02), Math.max(depth,0.02));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(sx, y0+h/2, sz);
  mesh.rotation.y = angleY;
  if(renderOrder!==undefined) mesh.renderOrder = renderOrder;
  parent.add(mesh);
  if(edgeMat){
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, edgeMat);
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    if(renderOrder!==undefined) line.renderOrder = renderOrder+0.5;
    parent.add(line);
  }
  return mesh;
}

// 矩形r(=\{x0,x1,z0,z1\})から矩形holeを引いた残り（最大4分割の矩形配列）を返す。
// 2F床スラブ・内覧モードの天井面から階段の吹き抜け穴を切り欠くのに使う。
function rectMinusRect(r, hole){
  if(hole.x1<=r.x0 || hole.x0>=r.x1 || hole.z1<=r.z0 || hole.z0>=r.z1) return [r];
  const hx0=Math.max(hole.x0,r.x0), hx1=Math.min(hole.x1,r.x1);
  const hz0=Math.max(hole.z0,r.z0), hz1=Math.min(hole.z1,r.z1);
  const out = [];
  if(r.z0 < hz0) out.push({x0:r.x0, x1:r.x1, z0:r.z0, z1:hz0});
  if(hz1 < r.z1) out.push({x0:r.x0, x1:r.x1, z0:hz1, z1:r.z1});
  if(r.x0 < hx0) out.push({x0:r.x0, x1:hx0, z0:hz0, z1:hz1});
  if(hx1 < r.x1) out.push({x0:hx1, x1:r.x1, z0:hz0, z1:hz1});
  return out;
}

// L字などの多角形の部屋を「1つの図形」として押し出す（内部の継ぎ目に余計な輪郭線が出ないようにする）
// pts: [[x,z], ...] 建物ローカル座標の頂点リスト（時計回り/反時計回りいずれも可）
function polyWire(pts, y0, y1, mat, edgeMat, parent, renderOrder){
  const shape = new THREE.Shape();
  pts.forEach(([x,z], i)=>{
    const [sx] = toScene(x,0);
    const sy = -(z - CZ); // toScene相当のz変換を符号反転して適用(回転後に正しい向きにするため)
    if(i===0) shape.moveTo(sx, sy); else shape.lineTo(sx, sy);
  });
  shape.closePath();
  const h = y1-y0;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(h,0.02), bevelEnabled:false });
  geo.rotateX(-Math.PI/2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, y0, 0);
  if(renderOrder!==undefined) mesh.renderOrder = renderOrder;
  parent.add(mesh);
  if(edgeMat){
    const edges = new THREE.EdgesGeometry(geo, 30); // 30度以上の角のみを輪郭線として抽出(内部の平坦な継ぎ目は無視)
    const line = new THREE.LineSegments(edges, edgeMat);
    line.position.copy(mesh.position);
    if(renderOrder!==undefined) line.renderOrder = renderOrder+0.5;
    parent.add(line);
  }
  return mesh;
}

function makeLabel(text, x, y, z, approx, dim){
  const div = document.createElement('div');
  div.className = 'labelDiv' + (approx ? ' approx' : '') + (dim ? ' dim' : '');
  div.textContent = text;
  document.getElementById('labelLayer').appendChild(div);
  return { div, pos:new THREE.Vector3(...toSceneY(x,y,z)) };
}
function toSceneY(x,y,z){ const [sx,sz]=toScene(x,z); return [sx,y,sz]; }

const labels = [];

// ---- 寸法値ラベル（1F。北辺沿いにx方向、西辺沿いにz方向の区間長をmmで表示） ----
// 出典: これまでの検算で確定した壁位置グリッド
const DIM_X_1F = [0, 0.910, 1.820, 2.730, 7.280, 9.100, 12.740, 16.380, 19.110];
const DIM_Z_1F = [0, 0.455, 0.910, 2.730, 3.691, 4.550, 6.370, 7.735];
const DIM_Y = 0.05; // 床すれすれの高さに配置(俯瞰モードで見やすい)
function buildDimLabels(){
  for(let i=0;i<DIM_X_1F.length-1;i++){
    const a=DIM_X_1F[i], b=DIM_X_1F[i+1];
    const mm = Math.round((b-a)*1000);
    const l = makeLabel(mm+'', (a+b)/2, DIM_Y, -0.45, false, true);
    l.floor = 1; l.isDim = true;
    labels.push(l);
  }
  for(let i=0;i<DIM_Z_1F.length-1;i++){
    const a=DIM_Z_1F[i], b=DIM_Z_1F[i+1];
    const mm = Math.round((b-a)*1000);
    const l = makeLabel(mm+'', -0.45, DIM_Y, (a+b)/2, false, true);
    l.floor = 1; l.isDim = true;
    labels.push(l);
  }
}
buildDimLabels();
document.getElementById('chkDims').onchange = refreshLabelVis;

function segAtX(lx){ return FLOOR1.find(s=>lx>=s.x0-1e-6 && lx<=s.x1+1e-6) || FLOOR1[0]; }

// ============================================================================
// 壁セグメント（内覧モードの当たり判定・実壁メッシュの共通データ）
// ============================================================================
// house.json の footprints は求積図のゾーン区分であり、隣接ゾーンの共有辺は
// 実在する壁ではない（区画境界壁レイヤーを削除した理由と同じ）。ここでは
// 「区間の引き算」方式で、共有辺を除いた真の外周だけを抽出する。
// 内壁（WALLS）は、data/house.json の rooms（部屋ポリゴン）を唯一の正本として
// scripts/build-web-data.mjs が自動導出したもの（2部屋のポリゴンが辺を共有する
// 区間＝壁）。手動保守の壁芯データは廃止した。詳細は docs/ARCHITECTURE.md を参照。
// 当たり判定は壁厚を考慮した円と線分の距離判定（プレイヤー半径+壁厚/2）。
// 実測の壁位置ではなく概算データからの導出のため、判定自体も概算である。
function subtractRanges(ranges, cutFrom, cutTo){
  const out = [];
  ranges.forEach(([a,b])=>{
    if(a < cutFrom) out.push([a, Math.min(b,cutFrom)]);
    if(b > cutTo) out.push([Math.max(a,cutTo), b]);
  });
  return out.filter(([a,b])=> b-a > 1e-4);
}
function exteriorSegmentsForLevel(rects){
  const segs = [];
  rects.forEach((r,i)=>{
    const edges = [
      {orientation:'H', at:r.z0, from:r.x0, to:r.x1},
      {orientation:'H', at:r.z1, from:r.x0, to:r.x1},
      {orientation:'V', at:r.x0, from:r.z0, to:r.z1},
      {orientation:'V', at:r.x1, from:r.z0, to:r.z1},
    ];
    edges.forEach(edge=>{
      let ranges = [[edge.from, edge.to]];
      rects.forEach((other,j)=>{
        if(j===i) return;
        let cf, ct, touches=false;
        if(edge.orientation==='H' && (other.z0===edge.at || other.z1===edge.at)){
          cf=Math.max(other.x0, edge.from); ct=Math.min(other.x1, edge.to); touches = cf<ct;
        } else if(edge.orientation==='V' && (other.x0===edge.at || other.x1===edge.at)){
          cf=Math.max(other.z0, edge.from); ct=Math.min(other.z1, edge.to); touches = cf<ct;
        }
        if(touches) ranges = subtractRanges(ranges, cf, ct);
      });
      ranges.forEach(([a,b])=> segs.push({orientation:edge.orientation, at:edge.at, from:a, to:b}));
    });
  });
  return segs;
}
function cutGaps(segs, gaps){
  let result = segs;
  gaps.forEach(g=>{
    result = result.flatMap(s=>{
      if(s.orientation!==g.orientation || Math.abs(s.at-g.at)>0.02) return [s];
      // {...s}で元のセグメントの全プロパティ（thick=壁厚など）を引き継ぐ。以前は
      // orientation/at/from/toだけを再構築していたため、ドアで一度でも切り欠かれた
      // セグメントはthickがundefinedになり、内覧モードで見た目（NaNジオメトリで
      // 描画されず透明になる）・当たり判定（PLAYER_RADIUS+NaN/2=NaNで常にすり抜け）の
      // 両方が壊れていた（ドア・開口の近くの壁だけ「壁が消える」不具合の原因）
      return subtractRanges([[s.from,s.to]], g.from, g.to).map(([a,b])=>({...s, from:a, to:b}));
    });
  });
  return result;
}
// 外壁の窓・ドア(OPENINGS)1件について、面する壁の{orientation, at, from, to}を返す。
// ドア(壁の全高の切り欠き)・窓(帯状の切り欠き)の両方の計算で共用する
function openingWallGeom(o, level){
  if(o.face==='N') return {orientation:'H', at:(level===2?FLOOR2.z0:segAtX(o.lx).z0), from:o.lx, to:o.lx+o.w};
  if(o.face==='S') return {orientation:'H', at:(level===2?FLOOR2.z1:segAtX(o.lx).z1), from:o.lx, to:o.lx+o.w};
  if(o.face==='E') return {orientation:'V', at:(o.x!==undefined?o.x:19.110), from:o.lz, to:o.lz+o.w};
  return {orientation:'V', at:(o.x!==undefined?o.x:0), from:o.lz, to:o.lz+o.w};
}
function doorGapsForLevel(level){
  const gaps = [];
  OPENINGS.forEach(o=>{
    if(o.category!=='door' || o.level!==level) return;
    gaps.push(openingWallGeom(o, level));
  });
  INTERIOR_DOORS.forEach(d=>{
    if(d.floor!==level) return;
    gaps.push({orientation:d.orientation, at:d.wallAt, from:d.center-d.width/2, to:d.center+d.width/2});
  });
  return gaps;
}
// 窓(OPENINGS、category!=='door')は壁を全高では切り欠かず、sill(下端高さ)〜sill+h(上端高さ)の
// 帯だけを内覧モードの壁メッシュ生成時に切り欠く（当たり判定用のwallSegmentsByLevelには含めない＝
// 窓は通り抜けられない、という現状の挙動は維持する）
function windowGapsForLevel(level, useEdits=false){
  const gaps = [];
  OPENINGS.forEach(base=>{
    const o = useEdits ? effectiveOpening(base) : base;
    if(o.category==='door' || o.level!==level) return;
    gaps.push({ ...openingWallGeom(o, level), sill:o.sill, h:o.h });
  });
  return gaps;
}
// ニッチ（NICHES＝data/niches.json、壁の片面だけのくぼみ）。窓と同じく壁の帯を切り抜き、奥を箱で閉じる。
// 壁より浅いニッチは奥から反対側の面までを埋め、壁より深いニッチは反対側の面から薄い箱が張り出す
// （模型の内壁6cmは実物の約13cmより薄いため）。blender/interior_geometry.py の niche_boxes() と同じ規則
const NICHE_SHELL = 0.012; // 張り出す箱の板厚(m)
function nicheGapsForLevel(level){
  return NICHES.filter(n=>n.level===level)
    .map(n=>({...n, at:n.wallAt, from:n.center-n.width/2, to:n.center+n.width/2, h:n.height}));
}
// 奥を閉じる箱を[u0,u1,n0,n1,y0,y1]で返す（uは壁沿い、nは壁を横切る向きの座標、yは床からの高さ）
function nicheBoxes(n, thick){
  const span = (a, b)=>[Math.min(a, b), Math.max(a, b)];
  const t = thick/2, open = n.at + n.side*t, far = n.at - n.side*t, back = open - n.side*n.depth;
  const y0 = n.sill, y1 = n.sill + n.h, S = NICHE_SHELL;
  if(n.depth < thick - 1e-6) return [[n.from, n.to, ...span(back, far), y0, y1]];
  const [f0, f1] = span(far, back);
  return [
    [n.from-S, n.to+S, ...span(back, back - n.side*S), y0-S, y1+S],
    [n.from-S, n.to+S, f0, f1, y1, y1+S], [n.from-S, n.to+S, f0, f1, y0-S, y0],
    [n.from-S, n.from, f0, f1, y0, y1], [n.to, n.to+S, f0, f1, y0, y1],
  ];
}
function nicheBoxWire(n, [u0, u1, n0, n1, y0, y1], baseY, mat, edgeMat, parent, renderOrder){
  if(n.orientation==='H') boxWire(u0, u1, baseY+y0, baseY+y1, n0, n1, mat, edgeMat, parent, renderOrder);
  else boxWire(n0, n1, baseY+y0, baseY+y1, u0, u1, mat, edgeMat, parent, renderOrder);
}
// ニッチがある壁の区間（内覧の壁・仕上げの面が厚みを知るため）
function nicheWallSegment(n){
  return (wallSegmentsByLevel[n.level] || []).find(s=> s.guardHeight===undefined && s.orientation===n.orientation
    && Math.abs(s.at - n.at) < 0.05 && s.from <= n.from + 1e-6 && s.to >= n.to - 1e-6);
}
const wallSegmentsByLevel = {};
[1,2].forEach(level=>{
  const rects = level===1 ? FLOOR1 : [FLOOR2];
  const ext = exteriorSegmentsForLevel(rects).map(s=>({...s, thick:WALL_T}));
  const interior = WALLS.filter(w=>w.level===level).map(w=> w.orientation==='H'
    ? {orientation:'H', at:w.z0, from:w.x0, to:w.x1, thick:INTERIOR_WALL_T}
    : {orientation:'V', at:w.x0, from:w.z0, to:w.z1, thick:INTERIOR_WALL_T});
  let segs = cutGaps([...ext, ...interior], doorGapsForLevel(level));
  if(level===1) segs.push({orientation:'V', at:SOUND_WALL.x, from:SOUND_WALL.z0, to:SOUND_WALL.z1, thick:WALL_T});
  // 腰壁（GUARD_WALLS）も当たり判定に加える。部屋の隣接関係からは導出されない（吹き抜けの
  // 縁に立てる転落防止用の壁のため）ので、防音壁と同様にここへ直接追加する。内覧モードでの
  // 見た目は、通常の壁と違い天井までではなくguardHeightまでの高さで別途描画する（後述）
  GUARD_WALLS.filter(g=>g.level===level).forEach(g=>{
    segs.push({orientation:g.orientation, at:g.at, from:g.from, to:g.to, thick:INTERIOR_WALL_T, guardHeight:g.height});
  });
  wallSegmentsByLevel[level] = segs;
});

// 内覧モードでの家具の当たり判定。家具の回転は0/90/180/270度のみ（data/furniture.jsonの
// 前提）なので、回転後の外形は必ず軸に沿った矩形になる。壁と同じ「線分＋当たり判定半径」の
// 仕組みをそのまま流用し、矩形の4辺をそれぞれ1本の壁（厚み0＝辺そのものが表面）として扱う。
// 「物との距離が狭いか広いか」を体感できるようにする目的なので、家具の種類を問わず一律に
// 当たり判定の対象にする
const furnitureSegmentsByLevel = { 1: [], 2: [] };
function rebuildFurnitureSegments(){
  furnitureSegmentsByLevel[1]=[]; furnitureSegmentsByLevel[2]=[];
  activeFurnitureItems().map(effectiveFurniture).forEach(f=>{
  if((f.elevation ?? 0)>=1.8) return; // provisional standing body height
  const swapped = (f.rotation===90 || f.rotation===270);
  const w = swapped ? f.depth : f.width;
  const d = swapped ? f.width : f.depth;
  const x0=f.x-w/2, x1=f.x+w/2, z0=f.z-d/2, z1=f.z+d/2;
  const segs = furnitureSegmentsByLevel[f.level];
  if(!segs) return;
  segs.push({orientation:'H', at:z0, from:x0, to:x1, thick:0});
  segs.push({orientation:'H', at:z1, from:x0, to:x1, thick:0});
  segs.push({orientation:'V', at:x0, from:z0, to:z1, thick:0});
  segs.push({orientation:'V', at:x1, from:z0, to:z1, thick:0});
  });
}

const PLAYER_RADIUS = 0.26; // 肩幅ぶんの当たり判定半径(m)
// segList内のいずれかの区間から半径r以内かどうか（プレイヤーの歩行判定・三人称カメラの
// 壁めり込み防止の両方で使う共通の点-区間距離判定）
function segListBlocked(list, px, pz, r){
  for(const s of list){
    const rr = r + s.thick/2;
    let d;
    if(s.orientation==='H'){ const cx=Math.max(s.from, Math.min(px, s.to)); d=Math.hypot(px-cx, pz-s.at); }
    else { const cz=Math.max(s.from, Math.min(pz, s.to)); d=Math.hypot(px-s.at, pz-cz); }
    if(d < rr) return true;
  }
  return false;
}
function resolveWalk(level, x, z, dx, dz){
  const segs = wallSegmentsByLevel[level] || [];
  const furnitureSegs = furnitureSegmentsByLevel[level] || [];
  function blocked(px,pz){ return segListBlocked(segs, px,pz, PLAYER_RADIUS) || segListBlocked(furnitureSegs, px,pz, PLAYER_RADIUS); }
  let nx = x+dx, nz = z+dz;
  if(blocked(nx, z)) nx = x; // X方向を軸ごとに判定してスライドさせる
  if(blocked(nx, nz)) nz = z;
  return [nx, nz];
}

// ---- 勾配天井（ceiling:sloped）：任意の(x,z)での天井高・壁の必要高さの計算 ----
// SLOPED_CEILING_PIECES（対象部屋を矩形群に分解し、片流れ屋根の範囲と交差判定した結果。
// generated/house-data.js、scripts/build-web-data.mjsのcomputeSlopedCeilingPieces()を参照）を
// 使って、任意の(x,z)における「その場所の天井高（床からの高さ）」を求める。対象範囲外はCEIL_H
function slopedCeilingHeightAt(x, z){
  for(const p of SLOPED_CEILING_PIECES){
    if(x>=p.x0-1e-6 && x<=p.x1+1e-6 && z>=p.z0-1e-6 && z<=p.z1+1e-6){
      if(!p.sloped) return CEIL_H;
      return yAtHiraya(z, p.base, p.pitch) - p.roofThickness/2 - CEILING_ALLOWANCE - LEVELS.fl1;
    }
  }
  return CEIL_H;
}
const SLOPED_CEILING_BOUNDS = SLOPED_CEILING_PIECES.reduce((b,p)=>({
  x0: Math.min(b.x0,p.x0), x1: Math.max(b.x1,p.x1), z0: Math.min(b.z0,p.z0), z1: Math.max(b.z1,p.z1),
}), { x0:Infinity, x1:-Infinity, z0:Infinity, z1:-Infinity });
const SLOPE_SAMPLE_EPS = 0.03; // 壁の両側の天井高をサンプリングする際の、壁面からのオフセット(m)
// 壁セグメントsが勾配天井の対象範囲付近にあるか（ほとんどの壁は対象外なので、まずここで弾く）
function nearSlopedCeiling(s){
  if(SLOPED_CEILING_PIECES.length===0) return false;
  const b = SLOPED_CEILING_BOUNDS, margin = 0.5;
  if(s.orientation==='H') return s.at>=b.z0-margin && s.at<=b.z1+margin && s.to>=b.x0-margin && s.from<=b.x1+margin;
  return s.at>=b.x0-margin && s.at<=b.x1+margin && s.to>=b.z0-margin && s.from<=b.z1+margin;
}
// H向き(z一定)の壁セグメントを、両側の必要高さが変わるx位置(SLOPED_CEILING_PIECESの境界)で
// 区間分割し、各区間の必要な高さ(両側のうち高い方)を返す。z一定の壁は片流れ屋根の高さ式が
// 変化しない（zが同じ＝高さの式も同じ）ため、区間の中では常に一定の高さになる
function heightRunsForHWall(s){
  const breaks = new Set([s.from, s.to]);
  SLOPED_CEILING_PIECES.forEach(p=>{
    if(p.z0<=s.at+0.2 && p.z1>=s.at-0.2){
      if(p.x0>s.from && p.x0<s.to) breaks.add(p.x0);
      if(p.x1>s.from && p.x1<s.to) breaks.add(p.x1);
    }
  });
  const xs = [...breaks].sort((a,b)=>a-b);
  const runs = [];
  for(let i=0;i<xs.length-1;i++){
    const a=xs[i], b=xs[i+1];
    if(b-a<1e-6) continue;
    const mid=(a+b)/2;
    const h1 = slopedCeilingHeightAt(mid, s.at-SLOPE_SAMPLE_EPS);
    const h2 = slopedCeilingHeightAt(mid, s.at+SLOPE_SAMPLE_EPS);
    runs.push({from:a, to:b, height:Math.max(h1,h2,CEIL_H)});
  }
  return runs;
}
// 指定したx（固定）に沿って、zFrom〜zToの範囲を「両側の天井高が変わらない区間」で分割し、
// 各区間の両端での必要な高さ(両側のうち高い方。floorからの相対高さ)を返す。H向きの
// heightRunsForHWall()と同じ考え方だが、V向きの壁は区間の中でも高さが連続的に傾斜しうる
// （z一定ではないため）ので、区間ごとに「両端の高さ」を返し、呼び出し側で直線でつなぐ。
// 区間の境界ちょうどの点は、フラット側・勾配側のどちらの値になるか曖昧（両方の区画の
// 端点に同時に該当しうる）なので、境界から少しだけ内側にずらしてサンプリングすることで、
// 「区間の中では常に片方の式だけが有効」という前提を保証する（これがないと、本来は
// フラットな区間の端点がたまたま隣の勾配区画の境界と一致し、勾配側の高い値を拾って
// 区間全体が誤って傾いてしまう）
function ceilingProfileRuns(x, zFrom, zTo){
  const breaks = new Set([zFrom, zTo]);
  SLOPED_CEILING_PIECES.forEach(p=>{
    if(p.x0<=x+0.2 && p.x1>=x-0.2){
      if(p.z0>zFrom && p.z0<zTo) breaks.add(p.z0);
      if(p.z1>zFrom && p.z1<zTo) breaks.add(p.z1);
    }
  });
  const zs = [...breaks].sort((a,b)=>a-b);
  const heightAt = (z)=> Math.max(slopedCeilingHeightAt(x-SLOPE_SAMPLE_EPS,z), slopedCeilingHeightAt(x+SLOPE_SAMPLE_EPS,z), CEIL_H);
  const runs = [];
  for(let i=0;i<zs.length-1;i++){
    const a=zs[i], b=zs[i+1];
    if(b-a<1e-6) continue;
    const inset = Math.min(0.01, (b-a)/3);
    runs.push({ from:a, to:b, topA:heightAt(a+inset), topB:heightAt(b-inset) });
  }
  return runs;
}
// V向きの壁の、上端が傾斜したパネル（沿い方向(u)×高さ(v)平面の台形をthickぶん押し出した形）を
// 1枚作る。archSpandrelShapes()/addWalkArchInfill()と同じ「ローカルXY平面のShapeをZ方向に
// 押し出し、position+rotation.yで配置する」手法を、傾斜する壁の上端に応用したもの。
// u軸はfromを原点(u=0)とした相対座標にする（三人称キャラの手足と同様、シェイプの原点と
// 実際に回転させたい基準点を一致させないと、回転で位置がずれてしまうため）。
// topA/topBはboxWireのz1引数などと同じく「baseYからの相対高さ」（floorからの相対高さ）で渡す
// （絶対高さではない。呼び出し側でbaseYを足す必要はなく、この関数がmesh.position.yに
// baseYそのものを設定するため、シェイプの高さ方向はtopA/topBをそのまま使えばよい）
function slopedTopWallPanel(at, from, to, baseY, topA, topB, thick, mat, edgeMat, parent){
  const shape = new THREE.Shape();
  const w = to - from;
  shape.moveTo(0, 0); shape.lineTo(0, topA); shape.lineTo(w, topB); shape.lineTo(w, 0); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled:false });
  geo.translate(0, 0, -thick/2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = -Math.PI/2;
  const [sx,sz] = toScene(at, from);
  mesh.position.set(sx, baseY, sz);
  parent.add(mesh);
  if(edgeMat){
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.rotation.copy(mesh.rotation); edges.position.copy(mesh.position);
    parent.add(edges);
  }
}

// 勾配天井の傾斜パネルを1枚描画する（roofPanel()と同じ「zA/yA→zB/yBの2点を結ぶ傾いた板」だが、
// 内覧モードの天井は平らな天井パネルと同様に輪郭線を持たないため、roofPanel()は使わず
// 専用の小さな関数にする（roofPanel()は屋根の描画にedgeMatを必須で使う実装のため流用しない）
function walkSlopedCeilingPanel(x0,x1,zA,yA,zB,yB, thickness, mat, parent){
  const dz = zB-zA, dy = yB-yA;
  const runLen = Math.sqrt(dz*dz+dy*dy);
  const angle = Math.atan2(dy,dz);
  const geo = new THREE.BoxGeometry(x1-x0, thickness, runLen);
  const mesh = new THREE.Mesh(geo, mat);
  const midX=(x0+x1)/2, midZ=(zA+zB)/2, midY=(yA+yB)/2;
  const [smx,smz] = toScene(midX, midZ);
  mesh.position.set(smx, midY, smz);
  mesh.rotation.x = -angle;
  parent.add(mesh);
}

// ---- 内覧モード用の実壁・天井メッシュ（衝突セグメントと同じデータから生成） ----
const walkGroup = new THREE.Group(); walkGroup.visible = false; scene.add(walkGroup);
const walkWallMat = new THREE.MeshStandardMaterial({color:0xf6f3ec, side:THREE.DoubleSide});
const walkCeilingMat = new THREE.MeshStandardMaterial({color:0xfbfaf7, side:THREE.DoubleSide});
const walkWindowMat = new THREE.MeshStandardMaterial({color:0x6fb3e0, transparent:true, opacity:0.45, side:THREE.DoubleSide});
const walkWindowFrameMat = new THREE.LineBasicMaterial({color:0x2a2a2a});
const WINDOW_GLASS_THICK = 0.04; // 窓ガラス面の厚み(m、壁の中心に配置する見た目上の値)
const WALL_WINDOW_TOL = 0.05; // 壁セグメントと窓の壁座標(at)の一致判定の許容誤差(m)
const walkWallGroups = {1:null, 2:null};
function rebuildWalkWalls(level, useEdits=true){
  const firstChild = walkGroup.children.length;
  const baseY = level===1 ? LEVELS.fl1 : LEVELS.fl2;
  const winGaps = windowGapsForLevel(level, useEdits);
  const nicheGaps = nicheGapsForLevel(level);
  wallSegmentsByLevel[level].forEach(s=>{
    const t = s.thick/2;
    if(s.guardHeight!==undefined){
      // 腰壁：天井までではなくguardHeightまでの高さで、窓の切り欠き判定はせずそのまま描画する
      if(s.orientation==='H') boxWire(s.from, s.to, baseY, baseY+s.guardHeight, s.at-t, s.at+t, walkWallMat, null, walkGroup);
      else boxWire(s.at-t, s.at+t, baseY, baseY+s.guardHeight, s.from, s.to, walkWallMat, null, walkGroup);
      return;
    }
    // 外壁は面積区分の境目で区間が分かれるため、境目をまたぐ窓（例：自宅の腰窓 op-008）は
    // 区間ごとに切り分けて開ける（以前は区間に収まる窓だけを開け、またぐ窓は壁で塞がっていた）
    const wins = winGaps.filter(w=> w.orientation===s.orientation && Math.abs(w.at-s.at)<WALL_WINDOW_TOL
      && w.from<s.to-1e-6 && w.to>s.from+1e-6)
      .map(w=>({...w, from:Math.max(w.from, s.from), to:Math.min(w.to, s.to)}));
    // ニッチも窓と同じく帯を切り抜く（ガラスは入れない。奥を閉じる箱は区間のループの後で足す）
    const cuts = [...wins, ...nicheGaps.filter(n=> n.orientation===s.orientation && Math.abs(n.at-s.at)<WALL_WINDOW_TOL
      && n.from<s.to-1e-6 && n.to>s.from+1e-6)];
    // 勾配天井（ceiling:sloped）の対象範囲に接する壁は、天井まで届くよう高さを伸ばす
    // （両側の天井高のうち高い方。段差はH向きの区間分割、傾斜はV向きの台形パネルで表現する）
    if(level===1 && nearSlopedCeiling(s)){
      if(s.orientation==='V'){
        if(cuts.length===0){
          ceilingProfileRuns(s.at, s.from, s.to).forEach(run=>{
            if(Math.abs(run.topA-run.topB)<0.01) boxWire(s.at-t, s.at+t, baseY, baseY+run.topA, run.from, run.to, walkWallMat, null, walkGroup);
            else slopedTopWallPanel(s.at, run.from, run.to, baseY, run.topA, run.topB, s.thick, walkWallMat, walkWallMat, walkGroup);
          });
          return;
        }
        // 窓付きの傾斜壁は現状のデータには存在しないため未対応（フラットな通常経路へフォールバック）
      } else {
        const runs = heightRunsForHWall(s);
        if(cuts.length===0){
          runs.forEach(run=> boxWire(run.from, run.to, baseY, baseY+run.height, s.at-t, s.at+t, walkWallMat, null, walkGroup));
          return;
        }
        runs.forEach(run=>{
          const runCuts = cuts.filter(w=> w.from<run.to-1e-6 && w.to>run.from+1e-6);
          const runWins = wins.filter(w=> w.from<run.to-1e-6 && w.to>run.from+1e-6);
          if(runCuts.length===0){ boxWire(run.from, run.to, baseY, baseY+run.height, s.at-t, s.at+t, walkWallMat, null, walkGroup); return; }
          let rects = [{x0:run.from, x1:run.to, z0:0, z1:run.height}];
          runCuts.forEach(w=>{ rects = rects.flatMap(rr=>rectMinusRect(rr, {x0:w.from, x1:w.to, z0:w.sill, z1:w.sill+w.h})); });
          rects.forEach(rr=> boxWire(rr.x0, rr.x1, baseY+rr.z0, baseY+rr.z1, s.at-t, s.at+t, walkWallMat, null, walkGroup));
          runWins.forEach(w=>{
            const gt = WINDOW_GLASS_THICK/2;
            boxWire(w.from, w.to, baseY+w.sill, baseY+w.sill+w.h, s.at-gt, s.at+gt, walkWindowMat, walkWindowFrameMat, walkGroup);
          });
        });
        return;
      }
    }
    if(cuts.length===0){
      if(s.orientation==='H') boxWire(s.from, s.to, baseY, baseY+CEIL_H, s.at-t, s.at+t, walkWallMat, null, walkGroup);
      else boxWire(s.at-t, s.at+t, baseY, baseY+CEIL_H, s.from, s.to, walkWallMat, null, walkGroup);
      return;
    }
    // 窓がある壁は、沿い方向(u=x0/x1)・高さ方向(v=z0/z1、baseYからの相対高さ)の矩形として
    // rectMinusRect()を流用し、窓の帯を切り欠いた残りだけを壁として描画する
    let rects = [{x0:s.from, x1:s.to, z0:0, z1:CEIL_H}];
    cuts.forEach(w=>{ rects = rects.flatMap(rr=>rectMinusRect(rr, {x0:w.from, x1:w.to, z0:w.sill, z1:w.sill+w.h})); });
    rects.forEach(rr=>{
      if(s.orientation==='H') boxWire(rr.x0, rr.x1, baseY+rr.z0, baseY+rr.z1, s.at-t, s.at+t, walkWallMat, null, walkGroup);
      else boxWire(s.at-t, s.at+t, baseY+rr.z0, baseY+rr.z1, rr.x0, rr.x1, walkWallMat, null, walkGroup);
    });
    wins.forEach(w=>{
      const gt = WINDOW_GLASS_THICK/2;
      if(s.orientation==='H') boxWire(w.from, w.to, baseY+w.sill, baseY+w.sill+w.h, s.at-gt, s.at+gt, walkWindowMat, walkWindowFrameMat, walkGroup);
      else boxWire(s.at-gt, s.at+gt, baseY+w.sill, baseY+w.sill+w.h, w.from, w.to, walkWindowMat, walkWindowFrameMat, walkGroup);
    });
  });
  nicheGaps.forEach(n=>{
    const s = nicheWallSegment(n);
    if(s) nicheBoxes(n, s.thick).forEach(box=> nicheBoxWire(n, box, baseY, walkWallMat, null, walkGroup));
  });
  const nextGroup = new THREE.Group();
  walkGroup.children.slice(firstChild).forEach(child=> nextGroup.add(child));
  if(walkWallGroups[level]){
    const previous = walkWallGroups[level];
    walkGroup.remove(previous);
    previous.traverse(obj=>{ if(obj.geometry) obj.geometry.dispose(); });
  }
  walkWallGroups[level] = nextGroup;
  walkGroup.add(nextGroup);
}
[1,2].forEach(level=>{
  const baseY = level===1 ? LEVELS.fl1 : LEVELS.fl2;
  rebuildWalkWalls(level, false);
  // 階段の吹き抜け：このlevelから上の階へ上る階段があれば、その真上のlevel+1側の
  // 床（＝このlevelから見た天井）に開口の穴を開ける（内覧モードで見上げたときに素通しになる）
  const stairHoles = STAIRS.filter(s=>s.levelFrom===level && s.opening).map(s=>s.opening);
  // 勾配天井（ceiling:sloped）の範囲も、平らな天井面からは切り欠いて、代わりに傾斜したパネルを
  // 別途描画する（sloped:falseの区画＝2階直下などは高さが同じCEIL_Hなので、切り欠かず
  // そのまま平らな天井面に任せてよい。区画の境界線が余計に増えるだけで見た目上のメリットがない）
  const slopedHoles = level===1 ? SLOPED_CEILING_PIECES.filter(p=>p.sloped).map(p=>({x0:p.x0,x1:p.x1,z0:p.z0,z1:p.z1})) : [];
  (level===1 ? FLOOR1 : [FLOOR2]).forEach(r=>{
    let rects = [r];
    stairHoles.forEach(hole=>{ rects = rects.flatMap(rr=>rectMinusRect(rr, hole)); });
    slopedHoles.forEach(hole=>{ rects = rects.flatMap(rr=>rectMinusRect(rr, hole)); });
    rects.forEach(rr=>{
      const [sx0,sz0]=toScene(rr.x0,rr.z0), [sx1,sz1]=toScene(rr.x1,rr.z1);
      const cgeo = new THREE.PlaneGeometry(sx1-sx0, sz1-sz0);
      const cmesh = new THREE.Mesh(cgeo, walkCeilingMat);
      cmesh.rotation.x = Math.PI/2;
      cmesh.position.set(sx0+(sx1-sx0)/2, baseY+CEIL_H-0.01, sz0+(sz1-sz0)/2);
      walkGroup.add(cmesh);
    });
  });
  if(level===1){
    SLOPED_CEILING_PIECES.filter(p=>p.sloped).forEach(p=>{
      const yN = yAtHiraya(p.z0,p.base,p.pitch) - p.roofThickness/2 - CEILING_ALLOWANCE;
      const yS = yAtHiraya(p.z1,p.base,p.pitch) - p.roofThickness/2 - CEILING_ALLOWANCE;
      walkSlopedCeilingPanel(p.x0, p.x1, p.z0, yN, p.z1, yS, 0.02, walkCeilingMat, walkGroup);
    });
    // 同じ部屋の中で「勾配」区画と「フラット」区画が壁を挟まずに接する境界（例：自宅LDKの
    // x=12.74）は、天井の高さが不連続に変わるのに何も塞ぐものがなく、内覧モードで見上げると
    // 隙間から2階側が見えてしまう（施主指摘：「片流れとフラット天井の境目が抜けて2Fが
    // 見えてしまっています」）。境界に沿って、フラット天井の高さ(CEIL_H)から勾配天井の
    // 高さまでを塞ぐ、垂直な「蹴込み」パネルを追加する
    const piecesByRoom = {};
    SLOPED_CEILING_PIECES.forEach(p=>{
      if(!piecesByRoom[p.roomId]) piecesByRoom[p.roomId] = [];
      piecesByRoom[p.roomId].push(p);
    });
    Object.values(piecesByRoom).forEach(pieces=>{
      const slopedPieces = pieces.filter(p=>p.sloped), flatPieces = pieces.filter(p=>!p.sloped);
      const riserZRanges = []; // {at, from, to}（V向きの境界線）
      slopedPieces.forEach(sp=>{
        flatPieces.forEach(fp=>{
          [sp.x0, sp.x1].forEach(edge=>{
            if(Math.abs(edge-fp.x0)>1e-6 && Math.abs(edge-fp.x1)>1e-6) return; // fpと接する境界のみ
            const z0 = Math.max(sp.z0, fp.z0), z1 = Math.min(sp.z1, fp.z1);
            if(z1-z0>1e-6) riserZRanges.push({ at:edge, from:z0, to:z1 });
          });
        });
      });
      const byAt = {};
      riserZRanges.forEach(r=>{
        const key = r.at.toFixed(6);
        if(!byAt[key]) byAt[key] = [];
        byAt[key].push(r);
      });
      Object.entries(byAt).forEach(([atKey, ranges])=>{
        const at = Number(atKey);
        ranges.sort((a,b)=>a.from-b.from);
        const merged = [];
        ranges.forEach(r=>{
          const last = merged[merged.length-1];
          if(last && r.from<=last.to+0.02) last.to = Math.max(last.to, r.to);
          else merged.push({from:r.from, to:r.to});
        });
        merged.forEach(range=>{
          ceilingProfileRuns(at, range.from, range.to).forEach(run=>{
            if(run.topA<=CEIL_H+0.01 && run.topB<=CEIL_H+0.01) return; // 段差がない区間は蹴込み不要
            slopedTopWallPanel(at, run.from, run.to, LEVELS.fl1+CEIL_H, run.topA-CEIL_H, run.topB-CEIL_H, 0.02, walkCeilingMat, null, walkGroup);
          });
        });
      });
    });
  }
});

// ---- 内覧モードのアーチ開口：迫り持ち（スパンドレル）の壁を復元する ----
// wallSegmentsByLevel/doorGapsForLevelは開口を「壁の全高を切り欠いた矩形の通路」として扱う
// （当たり判定はこれで十分。アーチの弧の形まで衝突判定する必要はない）。そのため、これまでは
// アーチ開口(operation:'open-arch')も内覧モードでは通常の開口と同じ、天井まで抜けた四角い
// 開口に見えていた。見た目だけ、archOpeningMesh()と同じ弧の形状を使って、弧の外側（左右の
// 迫り持ち部分）と弧の頂点から天井までの帯を、壁と同じ色で追加描画し、アーチらしい見た目に戻す
function archSpandrelShapes(hw, springHeight, archRise){
  // 迫り持ち＝矩形(-hw,springHeight)〜(hw,springHeight+archRise)から弧の内側(開口側)を除いた残り。
  // 弧が頂点(0,peak)で接するため、左右を別々のシェイプにして自己接触を避ける
  const peak = springHeight + archRise, segs = 12;
  const right = new THREE.Shape();
  right.moveTo(0, peak); right.lineTo(hw, peak); right.lineTo(hw, springHeight);
  for(let i=1;i<=segs;i++){ const ang=(i/segs)*(Math.PI/2); right.lineTo(hw*Math.cos(ang), springHeight+archRise*Math.sin(ang)); }
  right.closePath();
  const left = new THREE.Shape();
  left.moveTo(0, peak); left.lineTo(-hw, peak); left.lineTo(-hw, springHeight);
  for(let i=1;i<=segs;i++){ const ang=Math.PI-(i/segs)*(Math.PI/2); left.lineTo(hw*Math.cos(ang), springHeight+archRise*Math.sin(ang)); }
  left.closePath();
  return [left, right];
}
function addWalkArchInfill({ orientation, alongFrom, alongTo, wallAt, baseY, height, archRise, thick }){
  const hw = (alongTo-alongFrom)/2, alongCenter = (alongFrom+alongTo)/2;
  const springHeight = height-archRise;
  archSpandrelShapes(hw, springHeight, archRise).forEach(shape=>{
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled:false });
    geo.translate(0, 0, -thick/2);
    const mesh = new THREE.Mesh(geo, walkWallMat);
    if(orientation==='H'){ const [sx,sz]=toScene(alongCenter, wallAt); mesh.position.set(sx, baseY, sz); }
    else { mesh.rotation.y = -Math.PI/2; const [sx,sz]=toScene(wallAt, alongCenter); mesh.position.set(sx, baseY, sz); }
    walkGroup.add(mesh);
  });
  // 弧の頂点(height)から天井までの帯（ドアの高さが天井高より低い分の、通常の垂れ壁）。
  // 勾配天井の対象範囲に接する場合（1Fのみ）は、CEIL_Hではなくその場所の実際の天井高まで
  // 届かせる（H向きのみ対応。現状データにV向きの勾配天井対象アーチは存在しない）
  const t = thick/2;
  if(orientation==='H' && baseY===LEVELS.fl1 && nearSlopedCeiling({orientation, at:wallAt, from:alongFrom, to:alongTo})){
    heightRunsForHWall({orientation:'H', at:wallAt, from:alongFrom, to:alongTo}).forEach(run=>{
      if(height < run.height) boxWire(run.from, run.to, baseY+height, baseY+run.height, wallAt-t, wallAt+t, walkWallMat, null, walkGroup);
    });
  } else if(height < CEIL_H){
    if(orientation==='H') boxWire(alongFrom, alongTo, baseY+height, baseY+CEIL_H, wallAt-t, wallAt+t, walkWallMat, null, walkGroup);
    else boxWire(wallAt-t, wallAt+t, baseY+height, baseY+CEIL_H, alongFrom, alongTo, walkWallMat, null, walkGroup);
  }
}
INTERIOR_DOORS.forEach(d=>{
  if(d.operation!=='open-arch') return;
  const archRise = DOOR_WINDOW_CATALOG[d.type].archRise;
  addWalkArchInfill({
    orientation:d.orientation, alongFrom:d.center-d.width/2, alongTo:d.center+d.width/2, wallAt:d.wallAt,
    baseY:(d.floor===1?LEVELS.fl1:LEVELS.fl2), height:d.height, archRise, thick:INTERIOR_WALL_T,
  });
});
OPENINGS.forEach(o=>{
  if(o.category!=='door' || o.operation!=='open-arch') return;
  const { orientation, at, from, to } = openingWallGeom(o, o.level);
  const archRise = DOOR_WINDOW_CATALOG[o.type].archRise;
  addWalkArchInfill({
    orientation, alongFrom:from, alongTo:to, wallAt:at,
    baseY:(o.level===1?LEVELS.fl1:LEVELS.fl2)+o.sill, height:o.h, archRise, thick:WALL_T,
  });
});

// ---- 三人称視点用のキャラクター（成人男性の平均身長170cmを想定した簡易ブロック体型） ----
// 内覧モードで空間の広さ・狭さの実感をつかみやすくするための、あくまでスケール目安の人型。
// 局所座標は足元をy=0、正面を+Z向きとする（boxWireRotated等と同じ回転規約に合わせ、
// walkYawをそのままgroup.rotation.yに使えるようにするため）
const walkCharMat = new THREE.MeshStandardMaterial({color:0x4a7fd6, side:THREE.DoubleSide});
const walkCharHeadMat = new THREE.MeshStandardMaterial({color:0xe8b98a, side:THREE.DoubleSide});
const walkCharEdgeMat = new THREE.LineBasicMaterial({color:0x1a1a1a});
function walkCharPart(w, d, cx, cz, y0, y1, mat){
  const geo = new THREE.BoxGeometry(Math.max(w,0.02), Math.max(y1-y0,0.02), Math.max(d,0.02));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, (y0+y1)/2, cz);
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), walkCharEdgeMat);
  line.position.copy(mesh.position);
  const grp = new THREE.Group();
  grp.add(mesh, line);
  return grp;
}
// 歩行時に振れる手足（脚・腕）を作る。walkCharPart()と違い、関節（脚なら股関節、腕なら肩）の
// 高さpivotYを原点にしたグループを返す。このグループのrotation.xを変えることで、関節を
// 中心に前後（ローカルZ方向）へ振り子のように振れる（tを掛けて歩いていない間は自然に0へ戻す）
function walkCharLimb(w, d, cx, cz, pivotY, len, mat){
  const pivot = new THREE.Group();
  pivot.position.set(cx, pivotY, cz);
  const geo = new THREE.BoxGeometry(Math.max(w,0.02), Math.max(len,0.02), Math.max(d,0.02));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, -len/2, 0);
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), walkCharEdgeMat);
  line.position.copy(mesh.position);
  pivot.add(mesh, line);
  return pivot;
}
// 肩幅（腕を含めた最大幅）は日本人成人男性の平均的なbideltoid幅（約44-46cm）に合わせている。
// 胴体の幅(0.36m)に腕(各0.10m)をそのまま外側に足すと肩幅だけで64cmになり実寸より広すぎるため、
// 腕は自然に立った姿勢を想定して胴体の縁にほぼ重なる位置に置き、全体で約46cmに収める
// （2026-08-16、施主指摘により調整。調整前は胴体40cm＋腕で肩幅64cmだった）
const walkCharacterGroup = new THREE.Group();
const walkCharLeftLeg = walkCharLimb(0.14, 0.16, -0.09, 0, 0.85, 0.85, walkCharMat);
const walkCharRightLeg = walkCharLimb(0.14, 0.16, 0.09, 0, 0.85, 0.85, walkCharMat);
const walkCharLeftArm = walkCharLimb(0.10, 0.14, -0.18, 0, 1.40, 0.55, walkCharMat);
const walkCharRightArm = walkCharLimb(0.10, 0.14, 0.18, 0, 1.40, 0.55, walkCharMat);
walkCharacterGroup.add(walkCharLeftLeg);   // 左脚
walkCharacterGroup.add(walkCharRightLeg);  // 右脚
walkCharacterGroup.add(walkCharPart(0.36, 0.20,  0,    0, 0.85, 1.40, walkCharMat));  // 胴
walkCharacterGroup.add(walkCharLeftArm);   // 左腕
walkCharacterGroup.add(walkCharRightArm);  // 右腕
walkCharacterGroup.add(walkCharPart(0.24, 0.24,  0,    0, 1.40, 1.70, walkCharHeadMat)); // 頭（頭頂で身長1.70m）
walkCharacterGroup.visible = false;
scene.add(walkCharacterGroup);

// ---- 1F床スラブ ----
// FLOOR1は求積図の計算ゾーン(A1〜A4)であり実在する壁ではないため、表示上は
// 床面の参照プレーンだけを描画する（house.json側のfootprintsデータは
// Blenderの外壁生成・開口部の所属ゾーン判定に使うので保持する）。
// A convex polygon subtraction keeps the lower rooms out of the normal-height
// footprint plane, including the diagonal edge of the private entrance.
function clipFloorPolygon(poly,a,b,inside){
  const cross=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  const result=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],cp=cross(p),cq=cross(q);
    const keep=inside ? cp>=-1e-9 : cp<=1e-9;
    if(keep) result.push(p);
    if((cp>1e-9&&cq< -1e-9)||(cp< -1e-9&&cq>1e-9)){
      const t=cp/(cp-cq);result.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);
    }
  }
  return result;
}
function subtractFloorPolygon(poly,hole){
  let remaining=poly,outer=[];
  for(let i=0;i<hole.length;i++){
    if(remaining.length<3) break;
    const a=hole[i],b=hole[(i+1)%hole.length];
    const outside=clipFloorPolygon(remaining,a,b,false);
    if(outside.length>=3) outer.push(outside);
    remaining=clipFloorPolygon(remaining,a,b,true);
  }
  return outer;
}
function floorPolygonMesh(poly,y,material,group){
  const shape=new THREE.Shape();
  poly.forEach(([x,z],i)=>{const [sx,sz]=toScene(x,z);if(i===0)shape.moveTo(sx,-sz);else shape.lineTo(sx,-sz);});
  shape.closePath();
  const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),material);
  mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.renderOrder=0;group.add(mesh);
}
const loweredRooms=(ROOMS_APPROX[1]||[]).filter(r=>r.floorOffsetM<0);
const tileCanvas=document.createElement('canvas');tileCanvas.width=256;tileCanvas.height=256;
const tileCtx=tileCanvas.getContext('2d');
tileCtx.fillStyle='#c9c4ba';tileCtx.fillRect(0,0,256,256);
tileCtx.strokeStyle='#938f87';tileCtx.lineWidth=2;tileCtx.strokeRect(1,1,254,254);
const tileMap=new THREE.CanvasTexture(tileCanvas);
tileMap.wrapS=tileMap.wrapT=THREE.RepeatWrapping;tileMap.repeat.set(1/.3,1/.3);
const tileFloorMat=new THREE.MeshBasicMaterial({map:tileMap,side:THREE.DoubleSide});
const stepSideMat=new THREE.MeshBasicMaterial({color:0x8c8379,side:THREE.DoubleSide});
FLOOR1.forEach(seg=>{
  let pieces=[[[seg.x0,seg.z0],[seg.x1,seg.z0],[seg.x1,seg.z1],[seg.x0,seg.z1]]];
  for(const room of loweredRooms) pieces=pieces.flatMap(poly=>subtractFloorPolygon(poly,roomPolygonPoints(room)));
  pieces.forEach(poly=>floorPolygonMesh(poly,LEVELS.fl1+.005,M1.floorSlab,groups.floor1));
});
for(const room of loweredRooms){
  const poly=roomPolygonPoints(room),lo=LEVELS.fl1+room.floorOffsetM+.005,hi=LEVELS.fl1+.005;
  floorPolygonMesh(poly,lo,tileFloorMat,groups.floor1);
  for(let i=0;i<poly.length;i++){
    const [ax,az]=toScene(...poly[i]),[bx,bz]=toScene(...poly[(i+1)%poly.length]);
    const geom=new THREE.BufferGeometry();
    geom.setAttribute('position',new THREE.Float32BufferAttribute([ax,lo,az,bx,lo,bz,bx,hi,bz,ax,hi,az],3));
    geom.setIndex([0,1,2,0,2,3]);geom.computeVertexNormals();
    groups.floor1.add(new THREE.Mesh(geom,stepSideMat));
  }
}

// ---- 2F床スラブ（階段の吹き抜け部分は穴を開ける） ----
{
  const stairHoles2F = STAIRS.filter(s=>s.levelTo===2 && s.opening).map(s=>s.opening);
  let rects = [FLOOR2];
  stairHoles2F.forEach(hole=>{ rects = rects.flatMap(rr=>rectMinusRect(rr, hole)); });
  rects.forEach(seg=>{
    const [sx0,sz0]=toScene(seg.x0,seg.z0), [sx1,sz1]=toScene(seg.x1,seg.z1);
    const fgeo = new THREE.PlaneGeometry(sx1-sx0, sz1-sz0);
    const fmesh = new THREE.Mesh(fgeo, M2.floorSlab);
    fmesh.renderOrder = 0;
    fmesh.rotation.x = -Math.PI/2;
    fmesh.position.set(sx0+(sx1-sx0)/2, LEVELS.fl2+0.005, sz0+(sz1-sz0)/2);
    groups.floor2.add(fmesh);
  });
}

// ---- 民泊-自宅 防音壁（確定・1F扱い） ----
// 部屋フォーカス中は常に非表示にするため、roomMeshesByIdのroomGroupと同じ理由でGroupに包む
// （boxWire()は塗りつぶしメッシュしか返さず、輪郭線は別オブジェクトとしてparentに直接addされるため、
// メッシュのvisibleだけでは輪郭線が残ってしまう）
const soundWallGroup = new THREE.Group();
groups.sound.add(soundWallGroup);
boxWire(SOUND_WALL.x-WALL_T/2, SOUND_WALL.x+WALL_T/2, LEVELS.fl1, SOUND_WALL.topY, SOUND_WALL.z0, SOUND_WALL.z1, M1.sound, null, soundWallGroup, 2);
let soundWallLabel;
{
  const l = makeLabel('防音壁（小屋裏まで）', SOUND_WALL.x, SOUND_WALL.topY+0.25, (SOUND_WALL.z0+SOUND_WALL.z1)/2, false);
  l.floor = 1;
  labels.push(l);
  soundWallLabel = l;
}

// ---- 腰壁（吹き抜けの転落防止。roomsの隣接関係からは導出されないため、防音壁と同様に直接追加） ----
// 防音壁と同じ理由で、各要素ごとにGroupへ包んで部屋フォーカス中に一括非表示できるようにする
const guardWallGroups = [];
GUARD_WALLS.forEach(g=>{
  const baseY = g.level===1 ? LEVELS.fl1 : LEVELS.fl2;
  const mats = g.level===1 ? M1 : M2;
  const grp = g.level===1 ? groups.approx1 : groups.approx2;
  const t = INTERIOR_WALL_T/2;
  const wrapGroup = new THREE.Group();
  grp.add(wrapGroup);
  if(g.orientation==='H') boxWire(g.from, g.to, baseY, baseY+g.height, g.at-t, g.at+t, mats.approx, mats.approxEdge, wrapGroup, 2);
  else boxWire(g.at-t, g.at+t, baseY, baseY+g.height, g.from, g.to, mats.approx, mats.approxEdge, wrapGroup, 2);
  guardWallGroups.push(wrapGroup);
});

// ---- 屋根（確定：平屋部A1/A2の片流れ＋2階の切妻。data/house.json の roofs から生成） ----
// 出典: Ryuka-Landscape-Designer js/building-model.js の yAt()/slopeRoof() と同じ式
function yAtHiraya(z, base, pitch){ return base + (z + 0.500) * pitch; } // eave.north=0.500
// 傾斜する屋根の板を1枚描画する。zA/yA→zB/yBの2点を結ぶ面になる（切妻なら片側の面ごとに2回呼ぶ）。
function roofPanel(x0,x1,zA,yA,zB,yB, thickness, mat, edgeMat, parent, renderOrder){
  const dz = zB-zA, dy = yB-yA;
  const runLen = Math.sqrt(dz*dz+dy*dy);
  const angle = Math.atan2(dy,dz);
  const width = x1-x0;
  const geo = new THREE.BoxGeometry(width, thickness, runLen);
  const mesh = new THREE.Mesh(geo, mat);
  const midX=(x0+x1)/2, midZ=(zA+zB)/2, midY=(yA+yB)/2;
  const [smx,smz] = toScene(midX, midZ);
  mesh.position.set(smx, midY, smz);
  mesh.rotation.x = -angle;
  if(renderOrder!==undefined) mesh.renderOrder = renderOrder;
  parent.add(mesh);
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, edgeMat);
  line.rotation.copy(mesh.rotation); line.position.copy(mesh.position);
  if(renderOrder!==undefined) line.renderOrder = renderOrder+0.5;
  parent.add(line);
}
// renderOrder=4: 室内間仕切り(2)・ドア/開口部(3)より後に描画し、透明材質のdepthWrite:false
// (半透明レイヤー同士のちらつき対策で全体的に無効化している)の下でも屋根が一番手前に来るようにする。
// 実際の高さ(y座標)はここでは効かない――renderOrderの数値だけで前後関係が決まる。
ROOFS.forEach(r=>{
  if(r.kind==='gable'){
    // 棟(zRidge)を挟んで北面・南面の2枚。屋根は2F扱いなのでroofGable(2F表示に連動)へ。
    roofPanel(r.x0, r.x1, r.zNorth, r.yEave, r.zRidge, r.yRidge, r.thickness, M2.roof, M2.roofEdge, groups.roofGable, 4);
    roofPanel(r.x0, r.x1, r.zRidge, r.yRidge, r.zSouth, r.yEave, r.thickness, M2.roof, M2.roofEdge, groups.roofGable, 4);
  } else {
    const yN = yAtHiraya(r.zNorth, r.base, r.pitch), yS = yAtHiraya(r.zSouth, r.base, r.pitch);
    roofPanel(r.x0, r.x1, r.zNorth, yN, r.zSouth, yS, r.thickness, M1.roof, M1.roofEdge, groups.roofHiraya, 4);
  }
});
// 注記：A1/A2の継ぎ目(x=9.100)は北面の段差により屋根面の高さが微妙に異なるが、
// 破風の接合ディテールは未モデル化（簡略化）。見た目の目安としては十分だが、精密な意匠検討には使わない。

// ============================================================================
// 家具・設備（data/furniture-catalog.json / data/furniture.json から生成）
// ============================================================================
// 単純な箱・円柱の組み合わせで「それと分かる形」を作る。既製3Dモデル(GLB等)は
// 使わない — サイズを自由に調整できること、PWAのオフライン保存が軽いことを優先。
// 各shape関数は、幅w(ローカルX)・奥行d(ローカルZ)・高さh(ローカルY、床から)の
// 直方体1個ぶんの領域を基準に部品を組む。原点(0,0,0)は footprint 中心・床面。
// rotation(0/90/180/270度)は呼び出し側でグループごとY軸回転して適用する。
const FURNITURE_BOX = new THREE.BoxGeometry(1,1,1);
const FURNITURE_CYL = new THREE.CylinderGeometry(0.5,0.5,1,16);
function fPart(group, w,h,d, x,y,z, mat, cylinder){
  const mesh = new THREE.Mesh(cylinder ? FURNITURE_CYL : FURNITURE_BOX, mat);
  mesh.scale.set(w,h,d);
  mesh.position.set(x,y+h/2,z);
  group.add(mesh);
  return mesh;
}
const FMAT = {
  storageWood:new THREE.MeshStandardMaterial({color:0xd1b38a,roughness:.65}),
  storageFabric:new THREE.MeshStandardMaterial({color:0xc8c0b0,roughness:.9}),
  wood:      new THREE.MeshStandardMaterial({color:0xb98d5e, roughness:0.8}),
  fabricBlue:new THREE.MeshStandardMaterial({color:0x5c7d9e, roughness:0.9}),
  fabricTan: new THREE.MeshStandardMaterial({color:0xd8c39a, roughness:0.9}),
  metal:     new THREE.MeshStandardMaterial({color:0x9aa2a8, roughness:0.4, metalness:0.6}),
  white:     new THREE.MeshStandardMaterial({color:0xf2efe9, roughness:0.6}),
  counter:   new THREE.MeshStandardMaterial({color:0xc9cdd0, roughness:0.5}),
  dark:      new THREE.MeshStandardMaterial({color:0x3a3f45, roughness:0.5}),
  mirror:    new THREE.MeshStandardMaterial({color:0xaebfc9, roughness:0.2, metalness:0.3}),
  // カーテン（セージグリーンのリネン風）と絵の色。blender/furniture_assets.py の CURTAIN_COLOR／ART_COLOR と同じ値
  curtain:   new THREE.MeshStandardMaterial({color:0x9ea592, roughness:0.95}),
  art:       new THREE.MeshStandardMaterial({color:0x7d8f8a, roughness:0.85}),
  // フェイクの木の葉。blender/furniture_assets.py の PLANT_COLOR と同じ値
  plant:     new THREE.MeshStandardMaterial({color:0x6f7f5a, roughness:0.8}),
  // 和紙（照明のかさ・プリーツスクリーン）と焼き物。blender/furniture_assets.py の PAPER_COLOR／POTTERY_COLOR と同じ値
  paper:     new THREE.MeshStandardMaterial({color:0xebe3d1, roughness:0.9}),
  pottery:   new THREE.MeshStandardMaterial({color:0x7a4a2f, roughness:0.45}),
  // 麦わら帽子。blender/furniture_assets.py の STRAW_COLOR と同じ値
  straw:     new THREE.MeshStandardMaterial({color:0xd9c28a, roughness:0.9})
};
// 家具・布の色（data/finishes.json の案の furniture。2026-11-04）：描いた家具の部品を役割（木部・布・脚…、
// data/furniture-color-roles.json）で見分けて、案の候補の色に差し替える。役割はBlenderの部品の材質と同じ名前で、
// 材質から決まらない部品（例：食卓の脚は天板と同じ木の材質で描く）は userData.colorRole で印を付ける
const FMAT_ROLE=new Map([[FMAT.wood,'wood'],[FMAT.fabricBlue,'fabric'],[FMAT.fabricTan,'fabric'],[FMAT.curtain,'curtain'],[FMAT.art,'art'],[FMAT.plant,'plant']]);
const colorRole=(mesh,role)=>{mesh.userData.colorRole=role;return mesh;};
const furnitureColorMats=new Map();
// 色を変えられる役割：家具の形の役割と、その家具に付ける小物（data/visual/guest-decor.json、例：ソファの
// クッション・ひざ掛け）の役割。scripts/finishes.py の furniture_info() と同じ。web/finishes.js の編集欄もこれを使う
function furnitureColorRoles(item){
  const roles={...(FURNITURE_COLOR_ROLES.shapes[(FURNITURE_CATALOG[item.type]||{}).shape]||{})};
  for(const d of GUEST_DECOR.items) if(d.furnitureId===item.id) Object.assign(roles,(FURNITURE_COLOR_ROLES.decor||{})[d.kind]||{});
  return roles;
}
// 色を決めていない部品は、同じ家具のほかの部品に合わせる（fallbacks、data/furniture-color-roles.json。例：絵の額は地と同じ）
function applyFurnitureColors(group,roles,colors,fallbacks={}){
  group.traverse(o=>{
    if(!o.isMesh) return;
    const role=o.userData.colorRole||FMAT_ROLE.get(o.material), c=roles[role]&&(colors[role]||colors[fallbacks[role]]);
    if(!c) return;
    const key=c.colorHex+'/'+c.roughness;
    if(!furnitureColorMats.has(key)) furnitureColorMats.set(key,new THREE.MeshStandardMaterial({color:parseInt(c.colorHex,16),roughness:c.roughness}));
    o.material=furnitureColorMats.get(key);
  });
}
const STORAGE_SHAPES=['closetSingle','closetDouble','closetShelves','closetDrawers','closetMirror','storageBox'];
function storageSettings(shape,w,d,h,options={}){
  const limits=SHAPE_LIMITS; // data/shape-limits.json（Python側と共通）
  if(!STORAGE_SHAPES.includes(shape) || !limits[shape] || [w,d,h].some((v,i)=>!Number.isFinite(v)||v<limits[shape][i][0]||v>limits[shape][i][1])) throw Error('収納家具の寸法が対応範囲外です');
  if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(k=>!['railHeights','shelfHeights','contents'].includes(k))) throw Error('収納設定の項目が不正です');
  const round=v=>Math.round(v*1000)/1000;
  const rails=options.railHeights ?? (shape==='closetSingle'?[round(h-.35)]:shape==='closetDouble'?[round(h*.45),round(h-.25)]:[]);
  const count=Math.min(6,Math.floor((h-.15)/.28)+1);
  const shelves=options.shelfHeights ?? (shape==='closetShelves'?Array.from({length:count},(_,j)=>round(.10+j*(h-.15)/(count-1))):[]);
  const contents=options.contents ?? true;
  if(typeof contents!=='boolean') throw Error('収納物表示は真偽値で指定してください');
  for(const [values,lo,hi,gap] of [[rails,.45,h-.12,.65],[shelves,.04,h-.025,.28]]){
    if(!Array.isArray(values)||values.some(v=>!Number.isFinite(v)||v<lo||v>hi)) throw Error('パイプ・棚板の高さが範囲外です');
    if(values.some((v,i)=>i>0 && v-values[i-1]<gap-1e-6)) throw Error('高さは低い順に、パイプ65cm・棚板28cm以上の間隔で指定してください');
  }
  const expected=shape==='closetSingle'?1:shape==='closetDouble'?2:0;
  if(rails.length!==expected || (shape==='closetShelves'?(shelves.length<2||shelves.length>8):shelves.length>0)) throw Error('収納種類に合わないパイプ・棚板の数です');
  return {railHeights:rails,shelfHeights:shelves,contents};
}
function storageParts(shape,w,d,h,options){
  const cfg=storageSettings(shape,w,d,h,options),parts=[];
  const box=(name,x0,x1,z0,z1,y0,y1,material='cabinet',kind='box')=>parts.push({name,bounds:[x0,x1,z0,z1,y0,y1],material,kind,bevel:Math.min(.003,(x1-x0)/4,(z1-z0)/4,(y1-y0)/4)});
  function container(prefix,x,z,bottom,bw,bd,bh){
    box(prefix+'-body',x-bw/2,x+bw/2,z-bd/2,z+bd/2,bottom,bottom+bh-.012,'fabric');
    box(prefix+'-lid',x-bw/2,x+bw/2,z-bd/2,z+bd/2,bottom+bh-.012,bottom+bh,'cabinet');
    box(prefix+'-label',x-bw*.18,x+bw*.18,z+bd/2,z+bd/2+.001,bottom+bh*.5,bottom+bh*.7,'metal');
  }
  if(shape==='storageBox'){container('box',0,-.001,0,w,d-.002,h);return parts;}
  if(shape==='closetMirror'){
    box('back',-w/2,w/2,-d/2,d/2-.008,0,h,'wood');
    box('mirror',-w/2+.016,w/2-.016,d/2-.008,d/2,.016,h-.016,'mirror');return parts;
  }
  const t=.024;
  box('left',-w/2,-w/2+t,-d/2,d/2,0,h);box('right',w/2-t,w/2,-d/2,d/2,0,h);
  if(shape!=='closetSingle'&&shape!=='closetDouble') box('top',-w/2+t,w/2-t,-d/2,d/2,h-t,h,'wood');
  box('back',-w/2+t,w/2-t,-d/2,-d/2+.012,0,h-t);
  if(shape==='closetSingle'||shape==='closetDouble'){
    box('upper-shelf',-w/2+t,w/2-t,-d/2,d/2,h-.1,h-.076,'wood');
    cfg.railHeights.forEach((y,j)=>{
      box(`pipe-${j}`,-w/2+t,w/2-t,-.014,.014,y-.014,y+.014,'metal','cylinderX');
      if(cfg.contents){
        const length=Math.min(shape==='closetSingle'?1.3:.72,y-.12);
        for(let k=0;k<5;k++){
          const x=-w*.32+k*w*.16;
          box(`hanger-${j}-${k}`,x-.006,x+.006,-d*.38,d*.38,y-.06,y-.052,'metal');
          box(`garment-${j}-${k}`,x-.018,x+.018,-d*.28,d*.28,y-.06-length,y-.09,'fabric');
          box(`shoulder-${j}-${k}`,x-.018,x+.018,-d*.38,d*.38,y-.22,y-.09,'fabric');
        }
      }
    });
  }else if(shape==='closetShelves'){
    box('divider',-.012,.012,-d/2,d/2,0,h-t);
    cfg.shelfHeights.forEach((y,j)=>{
      box(`shelf-${j}`,-w/2+t,w/2-t,-d/2,d/2,y,y+t,'wood');
      if(cfg.contents && j<Math.min(4,cfg.shelfHeights.length-1)){
        const bw=Math.min(.35,(w-3*t)/2-.025),bd=Math.min(.4,d-.04),bh=Math.min(.25,cfg.shelfHeights[j+1]-y-t-.015);
        [-w/4,w/4].forEach((x,k)=>container(`box-${j}-${k}`,x,.002,y+t,bw,bd,bh));
      }
    });
  }else if(shape==='closetDrawers'){
    box('plinth',-w/2+t,w/2-t,-d/2+.025,d/2-.025,0,.06,'wood');
    for(let j=0;j<3;j++){
      const bottom=.07+j*(h-.10)/3,top=.07+(j+1)*(h-.10)/3-.008;
      box(`drawer-${j}`,-w/2+t+.003,w/2-t-.003,-d/2+.02,d/2-.008,bottom,top);
      box(`pull-${j}`,-w*.18,w*.18,d/2-.008,d/2,top-.024,top-.014,'metal');
    }
  }
  return parts;
}
function drawStorage(group,shape,w,d,h,options){
  const materials={wood:FMAT.storageWood,cabinet:FMAT.white,fabric:FMAT.storageFabric,metal:FMAT.metal,mirror:FMAT.mirror};
  for(const spec of storageParts(shape,w,d,h,options)){
    const [x0,x1,z0,z1,y0,y1]=spec.bounds;
    let mesh;
    if(spec.kind==='cylinderX'){
      mesh=new THREE.Mesh(FURNITURE_CYL,materials[spec.material]);
      mesh.scale.set(y1-y0,x1-x0,z1-z0);mesh.rotation.z=Math.PI/2;
      mesh.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);group.add(mesh);
    }else mesh=fPart(group,x1-x0,y1-y0,z1-z0,(x0+x1)/2,y0,(z0+z1)/2,materials[spec.material]);
    mesh.name=spec.name;
  }
}
// ---- 脱衣室の造作（blender/laundry_assets.py と同じ部品レシピ。板厚・パイプ径は推定）----
const LAUNDRY_SHAPES=['laundryCounter','laundryShelf','laundryRack','laundryBasket'];
const LAUNDRY_LIMITS=Object.fromEntries(LAUNDRY_SHAPES.map(s=>[s,SHAPE_LIMITS[s]])); // data/shape-limits.json
const LAUNDRY_BOARD=.025, LAUNDRY_TOP=.04, LAUNDRY_PIPE=.03, LAUNDRY_BASKET_WALL=.015, LAUNDRY_BASKET_RIM=.02;
function laundryParts(shape,w,d,h){
  const limits=LAUNDRY_LIMITS[shape];
  if(!limits || [w,d,h].some((v,i)=>!Number.isFinite(v)||v<limits[i][0]||v>limits[i][1]))
    throw Error('ランドリー造作の寸法が対応範囲外です: '+shape);
  const parts=[];
  const box=(name,x0,x1,z0,z1,y0,y1,material,bevel)=>parts.push({name,bounds:[x0,x1,z0,z1,y0,y1],material,kind:'box',bevel});
  if(shape==='laundryCounter'){
    const top=h-LAUNDRY_TOP;
    box('top',-w/2,w/2,-d/2,d/2,top,h,'wood',.004);
    box('side-left',-w/2,-w/2+LAUNDRY_BOARD,-d/2,d/2,0,top,'cabinet',.006);
    box('side-right',w/2-LAUNDRY_BOARD,w/2,-d/2,d/2,0,top,'cabinet',.006);
    box('rail-back',-w/2+LAUNDRY_BOARD,w/2-LAUNDRY_BOARD,-d/2,-d/2+LAUNDRY_BOARD,top-.09,top,'cabinet',.006);
  }else if(shape==='laundryShelf'){
    box('side-left',-w/2,-w/2+LAUNDRY_BOARD,-d/2,d/2,0,h,'cabinet',.006);
    box('side-right',w/2-LAUNDRY_BOARD,w/2,-d/2,d/2,0,h,'cabinet',.006);
    [['shelf-low',0],['shelf-mid',(h-LAUNDRY_BOARD)/2],['shelf-top',h-LAUNDRY_BOARD]].forEach(([name,y0])=>
      box(name,-w/2+LAUNDRY_BOARD,w/2-LAUNDRY_BOARD,-d/2,d/2,y0,y0+LAUNDRY_BOARD,'wood',.004));
  }else if(shape==='laundryRack'){
    const pipe=Math.min(LAUNDRY_PIPE,h);
    box('arm-left',-w/2,-w/2+pipe,-d/2,d/2,0,h,'metal',.004);
    box('arm-right',w/2-pipe,w/2,-d/2,d/2,0,h,'metal',.004);
    box('bar',-w/2,w/2,d/2-pipe,d/2,0,h,'metal',.004);
  }else{
    // laundryBasket: 蓋のない開放型（storageBox=蓋付き箱の流用は段ボール箱に見えるため専用形状）。
    // 側壁は常に薄板のまま（上端2cmだけ色違いのトリム）で、天面を塞ぐ板は置かない＝開口部を維持する。
    const t=LAUNDRY_BASKET_WALL, rim0=h-LAUNDRY_BASKET_RIM;
    box('bottom',-w/2,w/2,-d/2,d/2,0,t,'fabric',.004);
    [['front',-w/2,w/2,d/2-t,d/2],['back',-w/2,w/2,-d/2,-d/2+t],
     ['left',-w/2,-w/2+t,-d/2,d/2],['right',w/2-t,w/2,-d/2,d/2]].forEach(([name,x0,x1,z0,z1])=>{
      box('wall-'+name,x0,x1,z0,z1,0,rim0,'fabric',.004);
      box('rim-'+name,x0,x1,z0,z1,rim0,h,'wood',.004);
    });
  }
  return parts;
}
function drawLaundry(group,shape,w,d,h){
  const materials={wood:FMAT.storageWood,cabinet:FMAT.white,metal:FMAT.metal,fabric:FMAT.storageFabric};
  for(const spec of laundryParts(shape,w,d,h)){
    const [x0,x1,z0,z1,y0,y1]=spec.bounds;
    fPart(group,x1-x0,y1-y0,z1-z0,(x0+x1)/2,y0,(z0+z1)/2,materials[spec.material]).name=spec.name;
  }
}
// ---- 玄関・土間・シューズクロークの造作（blender/entry_assets.py と同じ部品レシピ）----
const ENTRY_SHAPES=['wallHookRail','wallPlankShelf'];
const ENTRY_LIMITS=Object.fromEntries(ENTRY_SHAPES.map(s=>[s,SHAPE_LIMITS[s]])); // data/shape-limits.json
const ENTRY_BOARD=.02, ENTRY_PEG_LEN=.07, ENTRY_PEG_W=.022, ENTRY_TIP_RISE=.045, ENTRY_SPACING=.17;
const ENTRY_RAIL_W=.04, ENTRY_RAIL_D=.025, ENTRY_PLANK_T=.02, ENTRY_PLANK_PITCH=.28, ENTRY_PLANK_FIRST=.28;
function entryPegCount(width){return Math.max(3,Math.min(8,Math.round(width/ENTRY_SPACING)+1));}
function entryPlankPositions(h){
  const ys=[];let y0=ENTRY_PLANK_FIRST;
  while(y0+ENTRY_PLANK_T<=h+1e-9 && ys.length<6){ys.push(y0);y0+=ENTRY_PLANK_PITCH;}
  if(!ys.length) ys.push(Math.max(0,h-ENTRY_PLANK_T));
  return ys;
}
function entryParts(shape,w,d,h){
  const limits=ENTRY_LIMITS[shape];
  if(!limits || [w,d,h].some((v,i)=>!Number.isFinite(v)||v<limits[i][0]||v>limits[i][1]))
    throw Error('エントリー造作の寸法が対応範囲外です: '+shape);
  const parts=[];
  const box=(name,x0,x1,z0,z1,y0,y1,material,bevel)=>parts.push({name,bounds:[x0,x1,z0,z1,y0,y1],material,kind:'box',bevel});
  if(shape==='wallHookRail'){
    const boardD=Math.min(ENTRY_BOARD,d*.4);
    box('board',-w/2,w/2,-d/2,-d/2+boardD,0,h,'wood',.004);
    const n=entryPegCount(w), pegH=Math.min(ENTRY_PEG_W,h*.5);
    const armY0=Math.min(.02,h*.15);
    const availableTop=h-armY0-pegH;
    const tipRise=Math.max(pegH,Math.min(ENTRY_TIP_RISE,availableTop-.008));
    for(let j=0;j<n;j++){
      const cx=-w/2+(j+.5)*w/n;
      box(`peg-${j}-arm`,cx-ENTRY_PEG_W/2,cx+ENTRY_PEG_W/2,-d/2+boardD,-d/2+boardD+ENTRY_PEG_LEN,armY0,armY0+pegH,'wood',.003);
      box(`peg-${j}-tip`,cx-ENTRY_PEG_W/2,cx+ENTRY_PEG_W/2,-d/2+boardD+ENTRY_PEG_LEN-ENTRY_PEG_W,-d/2+boardD+ENTRY_PEG_LEN,armY0+pegH,armY0+pegH+tipRise,'wood',.003);
    }
  }else if(shape==='wallPlankShelf'){
    const railD=Math.min(ENTRY_RAIL_D,d*.3);
    box('rail-left',-w/2,-w/2+ENTRY_RAIL_W,-d/2,-d/2+railD,0,h,'metal',.003);
    box('rail-right',w/2-ENTRY_RAIL_W,w/2,-d/2,-d/2+railD,0,h,'metal',.003);
    entryPlankPositions(h).forEach((y0,j)=>box(`plank-${j}`,-w/2,w/2,-d/2,d/2,y0,y0+ENTRY_PLANK_T,'wood',.004));
  }
  return parts;
}
function drawEntry(group,shape,w,d,h){
  const materials={wood:FMAT.storageWood,metal:FMAT.metal};
  for(const spec of entryParts(shape,w,d,h)){
    const [x0,x1,z0,z1,y0,y1]=spec.bounds;
    fPart(group,x1-x0,y1-y0,z1-z0,(x0+x1)/2,y0,(z0+z1)/2,materials[spec.material]).name=spec.name;
  }
}
// サイズ編集パネルの保存前チェック（W08-H）：STORAGE_SHAPES専用だったstorageSettingsの
// 事前検証を、laundry/entry系の形状にも同じ方式で広げる。各shapeFnが内部で投げる
// 「対応範囲外」系のエラーを保存前に捕まえ、fpStorageErrorに表示して保存を止める
// （でないと、範囲外の値がexport→再取込み後の初回描画で初めて例外を投げ、
// placeFurnitureItemの呼び出し元(未ガード)でスクリプト全体が止まり、画面が
// 真っ黒になる。実際にwallPlankShelfのdepthを0.22m未満へ縮めた編集でこれが起きた）。
function validateFurnitureShapeDims(shape,w,d,h,storage){
  // 範囲外の寸法は、どの寸法がいくつまでなら良いかを先に伝える（data/shape-limits.json）
  const limits=SHAPE_LIMITS[shape];
  if(limits){
    const bad=[['幅',w],['奥行',d],['高さ',h]].map(([name,v],i)=>[name,v,limits[i]])
      .filter(([,v,[lo,hi]])=>!Number.isFinite(v)||v<lo||v>hi);
    if(bad.length) return bad.map(([name,v,[lo,hi]])=>`${name} ${v}m は使えません（${lo.toFixed(2)}〜${hi.toFixed(2)}m）`).join('／');
  }
  if(shape==='product') return null;   // 採用品の寸法は製品どおりで、編集欄は使えない（描画時に確認）
  try{
    if(shape==='willticHalfRound') willticSettings(w,d,h);
    if(shape==='roundPedestalTable') marEaSettings(w,d,h);
    if(shape==='wq19Sofa') wq19Settings(w,d,h);
    if(STORAGE_SHAPES.includes(shape)) storageSettings(shape,w,d,h,storage);
    else if(LAUNDRY_SHAPES.includes(shape)) laundryParts(shape,w,d,h);
    else if(ENTRY_SHAPES.includes(shape)) entryParts(shape,w,d,h);
    return null;
  }catch(e){ return e.message; }
}
function willticSettings(w,d,h,finish={}){
  if([w,d,h].some((v,i)=>!Number.isFinite(v)||Math.abs(v-WILLTIC_PROFILE.dimensions[i])>1e-7)) throw Error('WILLTICは幅1.60・奥行0.85・高さ0.72m専用です');
  if(!finish||typeof finish!=='object'||Array.isArray(finish)||Object.keys(finish).some(k=>!['top','legs'].includes(k))) throw Error('商品仕上げが不正です');
  const value={top:'ivory',legs:'red-oak',...finish};
  for(const role of ['top','legs']) if(!Object.hasOwn(WILLTIC_PROFILE.finishes[role],value[role])) throw Error('未知の商品色です');
  return value;
}
const willticMaterials={};
function drawWilltic(g,w,d,h,finish){
  const cfg=willticSettings(w,d,h,finish);
  for(const p of WILLTIC_PROFILE.parts){
    const [x0,x1,z0,z1,y0,y1]=p.bounds;
    const key=p.material+'-'+cfg[p.material];
    if(!willticMaterials[key]) willticMaterials[key]=new THREE.MeshStandardMaterial({color:'#'+WILLTIC_PROFILE.finishes[p.material][cfg[p.material]].color,roughness:p.material==='top'?.48:.58});
    const shape=new THREE.Shape();
    const poly=p.polygon||Array.from({length:64},(_,i)=>[(x0+x1)/2+(x1-x0)/2*Math.cos(i*Math.PI/32),(z0+z1)/2+(z1-z0)/2*Math.sin(i*Math.PI/32)]);
    poly.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:y1-y0,bevelEnabled:false,steps:1});
    geo.rotateX(-Math.PI/2);geo.translate(0,y0,0);
    const mesh=new THREE.Mesh(geo,willticMaterials[key]);mesh.name=p.name;g.add(mesh);
  }
}
// ---- HOMESIC MAR_EA 円卓と、展示されていた椅子（2026-11-07）----
// 定義は data/products/homesic-mar-ea.json（MAREA_PROFILE）。Blender は blender/marea_assets.py が同じ値で作る。
// 天板はφ100/110/120（幅＝奥行＝直径）、脚は直径600→320mmの24面の円すい台（縦に板を張った見た目）。
// 色と模様は写真からの目安。ストーン調の石目と縦木目は、色を掛ける白っぽい模様の画像で表す（UEは画像材質）
function marEaSettings(w,d,h,finish={}){
  const P=MAREA_PROFILE;
  if(![w,d,h].every(Number.isFinite) || Math.abs(w-d)>1e-7 || !Object.values(P.sizes).some(s=>Math.abs(s.diameter-w)<1e-7)) throw Error('MAR_EA円卓は幅＝奥行＝直径が1.00・1.10・1.20mのいずれかです');
  if(Math.abs(h-P.height)>1e-7) throw Error('MAR_EA円卓は高さ0.72m専用です');
  if(!finish||typeof finish!=='object'||Array.isArray(finish)||Object.keys(finish).some(k=>!['top','legs'].includes(k))) throw Error('商品仕上げが不正です');
  const value={top:P.defaults.top,legs:P.defaults.legs,...finish};
  for(const role of ['top','legs']) if(!Object.hasOwn(P.finishes[role],value[role])) throw Error('未知の商品色です');
  return value;
}
function seededRandom(seed){ let a=seed>>>0; return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function drawingCanvas(w,h){
  const c=document.createElement('canvas');
  if(typeof c.getContext!=='function') return null;   // テスト環境など、描けないときは模様なし
  c.width=w; c.height=h;
  const g=c.getContext('2d');
  return g ? {c,g} : null;
}
let marEaStoneBase=null;
function marEaStoneTexture(diameter){
  if(marEaStoneBase===null){
    const cv=drawingCanvas(256,256);
    if(!cv){ marEaStoneBase=false; }
    else{
      const {c,g}=cv, rnd=seededRandom(1107);
      g.fillStyle='#efefef'; g.fillRect(0,0,256,256);
      for(let i=0;i<46;i++){   // 大きなむら
        const x=rnd()*256,y=rnd()*256,r=24+rnd()*70,dark=rnd()<.55,gr=g.createRadialGradient(x,y,0,x,y,r);
        gr.addColorStop(0,dark?'rgba(0,0,0,.07)':'rgba(255,255,255,.12)'); gr.addColorStop(1,'rgba(0,0,0,0)');
        g.fillStyle=gr; g.fillRect(x-r,y-r,r*2,r*2);
      }
      for(let i=0;i<2600;i++){   // 細かい斑点
        const x=rnd()*256,y=rnd()*256,s=.6+rnd()*1.6;
        g.fillStyle=rnd()<.62?`rgba(40,35,30,${.05+rnd()*.12})`:`rgba(255,255,255,${.1+rnd()*.2})`; g.fillRect(x,y,s,s);
      }
      marEaStoneBase=new THREE.CanvasTexture(c); marEaStoneBase.wrapS=marEaStoneBase.wrapT=THREE.RepeatWrapping;
    }
  }
  if(!marEaStoneBase) return null;
  const tex=marEaStoneBase.clone();   // 1枚＝1.2m四方。小さい天板は中央を切り出す
  tex.needsUpdate=true; tex.repeat.set(diameter/1.2,diameter/1.2); tex.offset.set((1-diameter/1.2)/2,(1-diameter/1.2)/2);
  return tex;
}
let marEaLegMap=null;
function marEaLegTexture(){
  if(marEaLegMap!==null) return marEaLegMap||null;
  const facets=MAREA_PROFILE.facets, cv=drawingCanvas(facets*32,256);
  if(!cv){ marEaLegMap=false; return null; }
  const {c,g}=cv, rnd=seededRandom(1108);
  for(let k=0;k<facets;k++){   // 円すい台の1面＝板1枚。板ごとに少し明るさを変え、縦の木目と継ぎ目を引く
    const v=Math.round(238+(rnd()-.5)*30);
    g.fillStyle=`rgb(${v},${v},${v})`; g.fillRect(k*32,0,32,256);
    for(let j=0;j<12;j++){
      const x=k*32+2+rnd()*28; g.strokeStyle=`rgba(0,0,0,${.05+rnd()*.1})`; g.lineWidth=.6+rnd()*1.2;
      g.beginPath(); g.moveTo(x,0); g.bezierCurveTo(x+(rnd()-.5)*5,80,x+(rnd()-.5)*5,170,x+(rnd()-.5)*3,256); g.stroke();
    }
    g.strokeStyle='rgba(0,0,0,.4)'; g.lineWidth=2; g.beginPath(); g.moveTo(k*32,0); g.lineTo(k*32,256); g.stroke();
  }
  marEaLegMap=new THREE.CanvasTexture(c); marEaLegMap.wrapS=THREE.RepeatWrapping;
  return marEaLegMap;
}
const marEaMats={};
function marEaMat(key,make){ return marEaMats[key] || (marEaMats[key]=make()); }
function drawMarEa(g,w,d,h,finish){
  const P=MAREA_PROFILE, cfg=marEaSettings(w,d,h,finish), r=w/2, t=P.topThickness, H=P.height;
  const edge=marEaMat('edge',()=>new THREE.MeshStandardMaterial({color:'#'+P.edge.color,roughness:.5}));
  const stone=marEaMat('top-'+cfg.top+'-'+w,()=>{ const map=marEaStoneTexture(w); return new THREE.MeshStandardMaterial({color:'#'+P.finishes.top[cfg.top].color,roughness:.58,...(map?{map}:{})}); });
  const top=new THREE.Mesh(new THREE.CylinderGeometry(r,r,t,72),[edge,stone,edge]);   // 側面・上面・下面
  top.position.y=H-t/2; top.name='top'; g.add(top);
  const legH=H-t-P.capThickness;
  const wood=marEaMat('legs-'+cfg.legs,()=>{ const map=marEaLegTexture(); return new THREE.MeshStandardMaterial({color:'#'+P.finishes.legs[cfg.legs].color,roughness:.5,flatShading:true,...(map?{map}:{})}); });
  const leg=new THREE.Mesh(new THREE.CylinderGeometry(P.legTop/2,P.legBase/2,legH,P.facets,1),wood);
  leg.position.y=legH/2; leg.name='leg'; g.add(leg);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(P.capRadius,P.capRadius,P.capThickness,48),marEaMat('cap-'+cfg.legs,()=>new THREE.MeshStandardMaterial({color:'#'+P.finishes.legs[cfg.legs].color,roughness:.5})));
  cap.position.y=legH+P.capThickness/2; cap.name='leg-cap'; g.add(cap);
}
// 展示されていた椅子（緑のブークレ張りの背と座、ミント色のスチール脚）。+zが正面。blender/marea_assets.py の chair_parts() と同じ形
const CHAIR_BOUCLE='3b5f52', CHAIR_MINT='9cc7ba';
let chairBoucleMap=null;
function chairBoucleTexture(){
  if(chairBoucleMap!==null) return chairBoucleMap||null;
  const cv=drawingCanvas(128,128);
  if(!cv){ chairBoucleMap=false; return null; }
  const {c,g}=cv, rnd=seededRandom(1109);
  g.fillStyle='#e2e2e2'; g.fillRect(0,0,128,128);
  for(let i=0;i<3200;i++){ const x=rnd()*128,y=rnd()*128,r=.5+rnd()*1.0; g.fillStyle=rnd()<.5?`rgba(255,255,255,${.1+rnd()*.15})`:`rgba(0,0,0,${.06+rnd()*.1})`; g.beginPath(); g.arc(x,y,r,0,7); g.fill(); }
  chairBoucleMap=new THREE.CanvasTexture(c); chairBoucleMap.wrapS=chairBoucleMap.wrapT=THREE.RepeatWrapping; chairBoucleMap.repeat.set(5,5);
  return chairBoucleMap;
}
function drawShellChair(g,w,d,h){
  const boucle=marEaMat('chair-boucle',()=>{ const map=chairBoucleTexture(); return new THREE.MeshStandardMaterial({color:'#'+CHAIR_BOUCLE,roughness:.95,...(map?{map}:{})}); });
  const mint=marEaMat('chair-mint',()=>new THREE.MeshStandardMaterial({color:'#'+CHAIR_MINT,roughness:.42}));
  const seatTop=.47, seatBottom=.42, zb=-d/2, zf=d/2;
  fPart(g,w,seatTop-seatBottom,d-.03,0,seatBottom,(zb+.03+zf)/2,boucle);
  const steps=14, xs=Array.from({length:steps+1},(_,i)=>-w/2+.01+(w-.02)*i/steps), curve=x=>zb+.075*Math.pow(2*x/w,2);
  const shape=new THREE.Shape();   // 背は背中を包む曲面（平面の帯を高さ方向へ押し出す）
  xs.forEach((x,i)=>i?shape.lineTo(x,-curve(x)):shape.moveTo(x,-curve(x)));
  [...xs].reverse().forEach(x=>shape.lineTo(x,-(curve(x)+.05)));
  shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth:h-(seatTop-.01),bevelEnabled:false,steps:1});
  geo.rotateX(-Math.PI/2); geo.translate(0,seatTop-.01,0);
  g.add(new THREE.Mesh(geo,boucle));
  for(const x of [-(w/2-.035), w/2-.035]){
    for(const z of [zf-.075, zb+.055]) fPart(g,.019,seatBottom,.019,x,0,z,mint,true);
    fPart(g,.019,.02,(zf-.075)-(zb+.055),x,seatBottom-.02,((zf-.075)+(zb+.055))/2,mint);
  }
}
// ---- 造作のデスク・低い台と、ワーキングチェア（2026-11-07、ヌックの書斎）----
// 部品は [名前,[x0,x1,z0,z1,y0,y1],材質,円柱か]。+zが正面。材質 wood は家具の木、frame は黒の金物、fabric は張り地
function builtInDeskParts(w,d,h){
  const t=.03, parts=[['top',[-w/2,w/2,-d/2,d/2,h-t,h],'wood'],['end-panel',[w/2-.02,w/2,-d/2,d/2-.01,0,h-t],'wood']];
  if(h>=.5) parts.push(['cable-tray',[-w/2+.1,w/2-.12,-d/2+.02,-d/2+.14,h-t-.08,h-t],'frame']);
  return parts;
}
function taskChairParts(w,d,h){
  const r=Math.min(w,d)/2;
  return [['base',[-r,r,-r,r,.04,.07],'frame',true],['column',[-.03,.03,-.03,.03,.07,.42],'frame',true],
    ['seat',[-.25,.25,-.22,.25,.42,.5],'fabric'],['back',[-.23,.23,-.27,-.22,.55,h],'fabric'],['back-bar',[-.025,.025,-.29,-.26,.45,.6],'frame'],
    ['arm-left',[-.29,-.25,-.12,.15,.62,.65],'frame'],['arm-right',[.25,.29,-.12,.15,.62,.65],'frame'],
    ['arm-post-left',[-.28,-.26,-.01,.02,.5,.62],'frame'],['arm-post-right',[.26,.28,-.01,.02,.5,.62],'frame']];
}
const STUDY_MATS={wood:()=>FMAT.wood, frame:()=>FMAT.dark, fabric:()=>marEaMat('task-chair-fabric',()=>new THREE.MeshStandardMaterial({color:0xb9b7b2,roughness:.85}))};
function addPartBoxes(g,parts){
  for(const [name,b,m,cyl] of parts){
    const mesh=fPart(g,b[1]-b[0],b[5]-b[4],b[3]-b[2],(b[0]+b[1])/2,b[4],(b[2]+b[3])/2,STUDY_MATS[m](),cyl);
    mesh.name=name;
    if(m==='wood') colorRole(mesh,'wood');
  }
}
// ---- ソファ WQ19CR（展示品の候補、片肘のカウチ。2026-11-07）----
// 形と色の定義は data/products/wq19-sofa.json（WQ19_PROFILE）。部品（箱・先細りの脚・断面を押し出したクッション）は
// Blender（blender/wq19_assets.py）と同じ。+zが正面、肘は-x側（正面から見て左）。寸法は固定、色はフレーム（N/B/U）とクッションの張り地
function wq19Settings(w,d,h,finish={}){
  const P=WQ19_PROFILE;
  if([w,d,h].some((v,i)=>!Number.isFinite(v)||Math.abs(v-P.dimensions[i])>1e-7)) throw Error('ソファWQ19CRは幅2.05・奥行0.90・高さ0.78m専用です');
  if(!finish||typeof finish!=='object'||Array.isArray(finish)||Object.keys(finish).some(k=>!['frame','fabric'].includes(k))) throw Error('商品仕上げが不正です');
  const value={frame:P.defaults.frame,fabric:P.defaults.fabric,...finish};
  for(const role of ['frame','fabric']) if(!Object.hasOwn(P.finishes[role],value[role])) throw Error('未知の商品色です');
  return value;
}
let wq19WoodMap=null, wq19FabricMap=null;
function wq19WoodTexture(){
  if(wq19WoodMap!==null) return wq19WoodMap||null;
  const cv=drawingCanvas(256,256);
  if(!cv){ wq19WoodMap=false; return null; }
  const {c,g}=cv, rnd=seededRandom(1110);
  g.fillStyle='#f1f1f1'; g.fillRect(0,0,256,256);
  for(let i=0;i<90;i++){ const y=rnd()*256; g.strokeStyle=`rgba(0,0,0,${.04+rnd()*.08})`; g.lineWidth=.5+rnd()*1.2; g.beginPath(); g.moveTo(0,y); g.bezierCurveTo(80,y+(rnd()-.5)*6,170,y+(rnd()-.5)*6,256,y+(rnd()-.5)*3); g.stroke(); }
  wq19WoodMap=new THREE.CanvasTexture(c); wq19WoodMap.wrapS=wq19WoodMap.wrapT=THREE.RepeatWrapping;
  return wq19WoodMap;
}
function wq19FabricTexture(){
  if(wq19FabricMap!==null) return wq19FabricMap||null;
  const cv=drawingCanvas(128,128);
  if(!cv){ wq19FabricMap=false; return null; }
  const {c,g}=cv, rnd=seededRandom(1111);
  g.fillStyle='#ececec'; g.fillRect(0,0,128,128);
  for(let i=0;i<2600;i++){ const x=rnd()*128,y=rnd()*128; g.fillStyle=rnd()<.5?`rgba(255,255,255,${.08+rnd()*.12})`:`rgba(0,0,0,${.05+rnd()*.08})`; g.fillRect(x,y,1+rnd()*1.4,1+rnd()*1.4); }
  wq19FabricMap=new THREE.CanvasTexture(c); wq19FabricMap.wrapS=wq19FabricMap.wrapT=THREE.RepeatWrapping; wq19FabricMap.repeat.set(4,4);
  return wq19FabricMap;
}
function drawWq19(g,w,d,h,finish){
  const P=WQ19_PROFILE, cfg=wq19Settings(w,d,h,finish);
  const mats={
    frame:marEaMat('wq19-frame-'+cfg.frame,()=>{ const map=wq19WoodTexture(); return new THREE.MeshStandardMaterial({color:'#'+P.finishes.frame[cfg.frame].color,roughness:.55,...(map?{map}:{})}); }),
    fabric:marEaMat('wq19-fabric-'+cfg.fabric,()=>{ const map=wq19FabricTexture(); return new THREE.MeshStandardMaterial({color:'#'+P.finishes.fabric[cfg.fabric].color,roughness:.95,...(map?{map}:{})}); }),
  };
  for(const p of P.parts){
    const [x0,x1,z0,z1,y0,y1]=p.bounds, mat=mats[p.material];
    let mesh;
    if(p.kind==='box'){ mesh=new THREE.Mesh(new THREE.BoxGeometry(x1-x0,y1-y0,z1-z0),mat); mesh.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2); }
    else if(p.kind==='frustum'){ mesh=new THREE.Mesh(new THREE.CylinderGeometry(p.topRadius,p.bottomRadius,y1-y0,p.facets),mat); mesh.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2); }
    else if(p.kind==='section'){   // 断面（台形など）を軸方向へ押し出す。axis x は断面が(z,高さ)、z は(x,高さ)
      const shape=new THREE.Shape();
      p.polygon.forEach(([u,v],i)=>{ const sx=p.axis==='x' ? -u : u; if(i) shape.lineTo(sx,v); else shape.moveTo(sx,v); });
      shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:p.axis==='x' ? x1-x0 : z1-z0,bevelEnabled:false,steps:1});
      if(p.axis==='x'){ geo.rotateY(Math.PI/2); geo.translate(x0,0,0); } else geo.translate(0,0,z0);
      mesh=new THREE.Mesh(geo,mat);
    }
    else continue;
    mesh.name=p.name; g.add(mesh);
  }
}
// 閉じたウェーブのカーテンの平面の輪郭（布の奥の線を+xから-xへ、手前の線を戻る）。blender/furniture_assets.py の curtain_wave() と同じ
const CURTAIN_PITCH=.12, CURTAIN_WAVE=.035, CURTAIN_CLOTH=.008;
// 低い本棚とフェイクの木の部品。blender/furniture_assets.py の bookshelf_parts()／plant_tree_parts() と同じ（[名前,[x0,x1,z0,z1,y0,y1],材質,円柱か]）
function bookshelfParts(w,d,h){
  const t=.02,base=.06,two=h<.75,tier=two?(h-2*t-base)/2:(h-t-base-2*t)/3,y1=base+tier,y2=y1+t+tier,bay=w/2-t-t/2;
  const p=[['side-left',[-w/2,-w/2+t,-d/2,d/2,0,h],'wood'],['side-right',[w/2-t,w/2,-d/2,d/2,0,h],'wood'],
    ['top',[-w/2+t,w/2-t,-d/2,d/2,h-t,h],'wood'],['plinth',[-w/2+t,w/2-t,-d/2,d/2-.02,0,base],'wood'],
    ['back',[-w/2+t,w/2-t,-d/2,-d/2+.01,base,h-t],'wood'],['divider',[-t/2,t/2,-d/2+.01,d/2,base,h-t],'wood'],
    ['shelf-1',[-w/2+t,w/2-t,-d/2+.01,d/2,y1,y1+t],'wood']];
  if(!two) p.push(['shelf-2',[-w/2+t,w/2-t,-d/2+.01,d/2,y2,y2+t],'wood']);
  const z0=-d/2+.02,z1=-d/2+.02+Math.min(.2,d-.05);
  [['books-1',-w/2+t+.03,-w/2+t+.03+bay*.6,base,tier*.85,'art'],['books-2',t/2+.05,t/2+.05+bay*.45,base,tier*.75,'curtain'],
   ...(two?[]:[['books-3',t/2+.04,t/2+.04+bay*.55,y1+t,tier*.8,'art']])].forEach(([n,a,b,y,hh,m])=>p.push([n,[a,b,z0,z1,y,y+hh],m]));
  const mw=Math.min(.21,bay*.4),mh=Math.min(.28,tier*.9);
  [[-w/2+t+.04,y1+t,'stone'],[-w/2+t+.08+mw,y1+t,'curtain'],...(two?[]:[[-w/2+t+.06,y2+t,'stone']])]
    .forEach(([a,y,m],k)=>p.push([`magazine-${k+1}`,[a,a+mw,-d/2+.012,-d/2+.022,y+.005,y+.005+mh],m]));
  // 地元の焼き物（2026-11-04）：上の段の右側に壺・鉢・湯のみの3点
  const shelfTop=(two?y1:y2)+t;
  [['pottery-jar',t/2+bay*.25,.055,Math.min(.16,tier*.7)],['pottery-bowl',t/2+bay*.5,.07,.06],['pottery-cup',t/2+bay*.72,.04,.085]]
    .forEach(([n,c,r,hh])=>p.push([n,[c-r,c+r,-r,r,shelfTop,shelfTop+hh],'pottery',true]));
  return p;
}
// 絵・プリーツスクリーン・和紙の照明・一輪挿しの部品。blender/furniture_assets.py の wall_art_parts()／
// pleated_screen_parts()／paper_lamp_parts()／bud_vase_parts() と同じ（2026-11-04）
function wallArtParts(w,d,h){
  const m=Math.min(w,h)*.08,b=Math.min(.02,m/2),fw=w-2*m,fh=h-2*m,z0=d/2-.002,z1=d/2;
  return [['canvas',[-w/2,w/2,-d/2,d/2-.002,0,h],'stone'],
    ['border-top',[-w/2,w/2,z0,z1,h-b,h],'border'],['border-bottom',[-w/2,w/2,z0,z1,0,b],'border'],
    ['border-left',[-w/2,-w/2+b,z0,z1,b,h-b],'border'],['border-right',[w/2-b,w/2,z0,z1,b,h-b],'border'],
    ['field',[-w/2+m,w/2-m,z0,z1-.001,m,h-m],'art'],
    ['mark',[-w/2+m+fw*.56,-w/2+m+fw*.8,z1-.001,z1,m+fh*.16,m+fh*.3],'accent']];
}
const PLEAT_HEAD=.04, PLEAT_RAIL=.02, PLEAT_PITCH=.025;
function pleatedScreenParts(w,d,h){
  const top=h-PLEAT_HEAD, n=Math.max(1,Math.round((top-PLEAT_RAIL)/PLEAT_PITCH)), step=(top-PLEAT_RAIL)/n;
  const p=[['pleat-head',[-w/2,w/2,-d/2,d/2,top,h],'stone']];
  for(let k=0;k<n;k++){ const z=k%2?.004:-.004; p.push([`pleat-${k+1}`,[-w/2+.01,w/2-.01,z-.004,z+.004,PLEAT_RAIL+k*step,PLEAT_RAIL+(k+1)*step],'paper']); }
  return p.concat([['pleat-rail',[-w/2+.005,w/2-.005,-.009,.009,0,PLEAT_RAIL],'stone']]);
}
function paperLampParts(w,d,h){
  const r=Math.min(w,d)/2, legs=h-2*r, n=8;
  if(legs<.03) throw Error('照明のかさの下に3cm以上の脚が要ります');
  const p=[[-r*.45,0],[r*.45,0],[0,-r*.45],[0,r*.45]].map(([x,z],k)=>[`leg-${k}`,[x-.004,x+.004,z-.004,z+.004,0,legs+.02],'frame']);
  for(let k=0;k<n;k++){
    const y0=legs+2*r*k/n, y1=legs+2*r*(k+1)/n, rk=Math.max(.02,Math.sqrt(Math.max(0,r*r-((y0+y1)/2-legs-r)**2)));
    p.push([`shade-${k+1}`,[-rk,rk,-rk,rk,y0,y1],'paper',true]);
  }
  return p;
}
// 民泊の玄関のくぼみの造作と、置く物。blender/furniture_assets.py の alcove_shelf_parts()／alcove_items_parts() と同じ（2026-11-05）
const ALCOVE_BOARD=.9, ALCOVE_ROD=.8;
function alcoveShelfParts(w,d,h){
  return [['board',[-w/2,w/2,-d/2,d/2,ALCOVE_BOARD-.03,ALCOVE_BOARD],'wood'],
    ['umbrella-bar',[-w/2,w/2,-.0125,.0125,ALCOVE_ROD-.0125,ALCOVE_ROD+.0125],'frame'],
    ['peg-rail',[-w/2+.04,w/2-.04,-d/2,-d/2+.02,h-.1,h],'wood'],
    ...[-.25,0,.25].map((x,k)=>[`peg-${k+1}`,[w*x-.012,w*x+.012,-d/2+.02,-d/2+.09,h-.062,h-.038],'wood']),
    ...[-.32,.32].flatMap((x,k)=>[[`arm-${k+1}`,[w*x-.01,w*x+.01,-d/2,d/2-.06,ALCOVE_BOARD-.05,ALCOVE_BOARD-.03],'frame'],
      [`bar-arm-${k+1}`,[w*x-.008,w*x+.008,-d/2,.0125,ALCOVE_ROD-.008,ALCOVE_ROD+.008],'frame']])];
}
function alcoveItemsParts(w,d,h){
  const top=ALCOVE_BOARD, hx=w*.25, hz=-d/2+.135;
  const disc=(n,x,z,r,y0,y1,m)=>[n,[x-r,x+r,z-r,z+r,y0,y1],m,true];
  return [disc('vase-body',w*.27,.03,.04,top,top+.13,'pottery'),disc('vase-neck',w*.27,.03,.015,top+.13,top+.165,'pottery'),
    disc('stem',w*.27,.03,.003,top+.16,top+.42,'plant'),disc('leaf',w*.27-.03,.03,.02,top+.3,top+.32,'plant'),
    disc('bowl',w*.06,.03,.065,top,top+.05,'pottery'),
    disc('hat-1-brim',-hx,hz,.12,h-.15,h-.138,'straw'),disc('hat-1-crown',-hx,hz,.07,h-.138,h-.05,'straw'),
    disc('hat-2-brim',0,hz,.12,h-.15,h-.138,'straw'),disc('hat-2-crown',0,hz,.07,h-.138,h-.05,'straw'),
    disc('torch',hx,-d/2+.09,.025,h-.14,h,'frame'),
    disc('umbrella-1',w*.3,0,.022,.06,ALCOVE_ROD,'frame'),disc('umbrella-2',w*.37,0,.022,.06,ALCOVE_ROD,'frame'),
    disc('stool-seat',-w*.25,0,.14,.42,.45,'wood'),
    ...[[-.09,-.09],[.09,-.09],[-.09,.09],[.09,.09]].map(([a,b],k)=>[`stool-leg-${k+1}`,[-w*.25+a-.012,-w*.25+a+.012,b-.012,b+.012,0,.42],'wood']),
    ['box',[w*.02,w*.2,-d/2+.02,-d/2+.2,0,.14],'wood']];
}
// 民泊のトイレ・洗面の小物。blender/furniture_assets.py の towel_bar_parts() などと同じ（2026-11-05）。ローカルの -z が壁
function towelBarParts(w,d,h){
  return [['post-1',[-w/2,-w/2+.016,-d/2,d/2,h-.03,h],'frame'],['post-2',[w/2-.016,w/2,-d/2,d/2,h-.03,h],'frame'],
    ['bar',[-w/2+.016,w/2-.016,d/2-.026,d/2-.01,h-.023,h-.007],'frame'],
    ['towel',[-w*.36,w*.36,d/2-.034,d/2,0,h-.004],'towel']];
}
function handWashParts(w,d,h){
  const top=h-.12,y0=top-.2,bowl=top-.06,back=-d/2+.05,front=d/2-.03,side=.16;
  return [['body',[-w/2,w/2,-d/2,d/2,y0,bowl],'stone'],
    ['rim-back',[-w/2,w/2,-d/2,back,bowl,top],'stone'],['rim-front',[-w/2,w/2,front,d/2,bowl,top],'stone'],
    ['rim-left',[-w/2,-side,back,front,bowl,top],'stone'],['rim-right',[side,w/2,back,front,bowl,top],'stone'],
    ['faucet-post',[-.012,.012,-d/2+.012,-d/2+.036,top,h],'frame',true],
    ['faucet-spout',[-.01,.01,-d/2+.02,-d/2+.1,h-.018,h],'frame']];
}
function paperHolderParts(w,d,h){
  return [['plate',[-w/2,w/2,-d/2,-d/2+.006,h*.35,h],'frame'],['top',[-w/2,w/2,-d/2,d/2,h-.005,h],'frame'],
    ['roll',[-.055,.055,-d/2+.012,d/2-.006,0,h-.012],'towel']];
}
const WASH_BOARD=.12, WASH_TOP=.145;
function washShelfParts(w,d,h){
  const disc=(n,x,z,r,y0,y1,m)=>[n,[x-r,x+r,z-r,z+r,y0,y1],m,true];
  return [['board',[-w/2,w/2,-d/2,d/2,WASH_BOARD,WASH_TOP],'wood'],
    ...[-1,1].flatMap((s,k)=>[[`bracket-${k+1}-arm`,[s*w*.36-.01,s*w*.36+.01,-d/2,d/2-.05,WASH_BOARD-.012,WASH_BOARD],'frame'],
      [`bracket-${k+1}-post`,[s*w*.36-.01,s*w*.36+.01,-d/2,-d/2+.012,0,WASH_BOARD],'frame']]),
    ['towel-1',[-w*.44,-w*.14,-d/2+.02,d/2-.015,WASH_TOP,WASH_TOP+.15],'towel'],
    ['towel-2',[-w*.1,w*.16,-d/2+.02,d/2-.015,WASH_TOP,WASH_TOP+.1],'towel'],
    disc('jar',w*.32,0,.045,WASH_TOP,WASH_TOP+.11,'pottery'),disc('jar-lid',w*.32,0,.047,WASH_TOP+.11,WASH_TOP+.125,'wood')];
}
function budVaseParts(w,d,h){
  const r=Math.min(w,d)/2, body=Math.min(.13,h*.4);
  return [['vase-body',[-r,r,-r,r,0,body],'pottery',true],['vase-neck',[-r*.38,r*.38,-r*.38,r*.38,body,body+.035],'pottery',true],
    ['stem',[-.003,.003,-.003,.003,body+.03,h],'plant',true],['leaf-1',[0,r,-.012,.012,h*.62,h*.68],'plant',true],
    ['leaf-2',[-r*.9,0,-.01,.01,h*.78,h*.83],'plant',true],['bud',[-.012,.012,-.012,.012,h-.025,h],'plant',true]];
}
const LEAF_MASSES=[[-.5,.1,-.2,.4,.48,.6],[-.1,.5,-.45,.15,.55,.67],[-.4,.3,-.5,.05,.64,.76],[-.25,.45,-.05,.5,.72,.85],[-.3,.25,-.25,.3,.84,1]]; // plant_tree_parts() の LEAF_MASSES と同じ
function plantTreeParts(w,d,h){
  const r=Math.min(w,d)*.34;
  return [['pot',[-r,r,-r,r,0,h*.2],'stone',true],['soil',[-r*.88,r*.88,-r*.88,r*.88,h*.2,h*.21],'frame',true],
    ['trunk',[-.02,.02,-.02,.02,h*.21,h*.8],'frame',true],
    ...LEAF_MASSES.map(([a,b,c,e,y0,y1],k)=>[`leaves-${k+1}`,[w*a,w*b,d*c,d*e,h*y0,h*y1],'plant',true])];
}
// 部品の材質→描く色。絵の額（border）は色を決めるまで地と同じ、絵の差し色（accent）は絵の色と同じ
const PART_FMAT={wood:'wood',art:'art',curtain:'curtain',stone:'white',frame:'dark',plant:'plant',paper:'paper',pottery:'pottery',
  border:'white',accent:'art',straw:'straw',towel:'white'};
function addParts(group,parts){
  for(const [,b,m,cyl] of parts) colorRole(fPart(group,b[1]-b[0],b[5]-b[4],b[3]-b[2],(b[0]+b[1])/2,b[4],(b[2]+b[3])/2,FMAT[PART_FMAT[m]],cyl),m);
}
function curtainWave(w){
  const n=Math.max(2,Math.round(w/CURTAIN_PITCH)), steps=n*8;
  const xs=Array.from({length:steps+1},(_,i)=>-w/2+w*i/steps);
  const mid=xs.map(x=>CURTAIN_WAVE*Math.sin(2*Math.PI*n*(x+w/2)/w));
  const back=xs.map((x,i)=>[x,mid[i]-CURTAIN_CLOTH/2]), front=xs.map((x,i)=>[x,mid[i]+CURTAIN_CLOTH/2]);
  return back.reverse().concat(front);
}
// ロールスクリーンを下ろした状態（夜・映画）か上げた状態（昼）か。見る人ごとの表示の好みなので端末に覚える
const ROLL_KEY = 'ryuka-roll-screens-down';
let rollScreensDown = true;
try{ rollScreensDown = localStorage.getItem(ROLL_KEY) !== '0'; }catch(e){}
function setRollScreensDown(on){
  rollScreensDown = on;
  try{ localStorage.setItem(ROLL_KEY, on ? '1' : '0'); }catch(e){}
  for(const item of FURNITURE_ITEMS)
    if((FURNITURE_CATALOG[item.type] || {}).shape === 'rollScreen') rebuildFurnitureItem(item.id);
  refreshRollControls();
}
function refreshRollControls(){
  const has = FURNITURE_ITEMS.some(item=>(FURNITURE_CATALOG[item.type] || {}).shape === 'rollScreen');
  const box = document.getElementById('chkRollDown');
  if(box){ box.checked = rollScreensDown; box.closest('label').style.display = has ? '' : 'none'; }
  const btn = document.getElementById('walkRollToggle');
  if(btn){ btn.style.display = has ? '' : 'none'; btn.textContent = rollScreensDown ? '🪟 スクリーンを上げる' : '🪟 スクリーンを下ろす'; }
}
// ロールスクリーンの生地の中に収まる最大の16:9の映像（上下左右に5cmの余白）。幅・高さ・中心の高さ(m)
function rollScreenImage(w,h){
  const y0=.03+.05, y1=h-.08-.05, iw=Math.min(w-.02-.1,(y1-y0)*16/9);
  return {iw, ih:iw*9/16, cy:(y0+y1)/2};
}
const FURNITURE_SHAPES = {
  willticHalfRound(g,w,d,h,finish){drawWilltic(g,w,d,h,finish);},
  roundPedestalTable(g,w,d,h,finish){drawMarEa(g,w,d,h,finish);},
  shellChair(g,w,d,h){drawShellChair(g,w,d,h);},
  wq19Sofa(g,w,d,h,finish){drawWq19(g,w,d,h,finish);},
  // 2026-11-07 造作のデスク・低い台と、ワーキングチェア（仮）。blender/furniture_assets.py の built_in_desk_parts()／task_chair_parts() と同じ
  builtInDesk(g,w,d,h){ addPartBoxes(g,builtInDeskParts(w,d,h)); },
  taskChair(g,w,d,h){ addPartBoxes(g,taskChairParts(w,d,h)); },
  // 採用品（web/products.js）：部品は data/products/*.json から。案の選択肢で見た目が変わる
  product(g,w,d,h,o){RyukaProducts.draw(g,o.product,w,d,h,o.finish,o.options,o.yaw);},
  closetSingle(g,w,d,h,o){drawStorage(g,'closetSingle',w,d,h,o);},
  closetDouble(g,w,d,h,o){drawStorage(g,'closetDouble',w,d,h,o);},
  closetShelves(g,w,d,h,o){drawStorage(g,'closetShelves',w,d,h,o);},
  closetDrawers(g,w,d,h,o){drawStorage(g,'closetDrawers',w,d,h,o);},
  closetMirror(g,w,d,h,o){drawStorage(g,'closetMirror',w,d,h,o);},
  storageBox(g,w,d,h,o){drawStorage(g,'storageBox',w,d,h,o);},
  raisedPlatform(group,w,d,h){
    fPart(group,w*.96,h*.9,d*.96,0,0,0,FMAT.wood);
    fPart(group,w,h*.1,d,0,h*.9,0,FMAT.wood);
  },
  mattress(group,w,d,h){
    fPart(group,w,h*.8,d,0,h*.1,0,FMAT.fabricTan);
    fPart(group,w*.98,h*.1,d*.98,0,0,0,FMAT.white);
    fPart(group,w*.98,h*.1,d*.98,0,h*.9,0,FMAT.white);
  },
  sofaWorkTable(group,w,d,h){
    const top=Math.min(.035,h*.1), foot=Math.min(.025,h*.08);
    fPart(group,w,top,d,0,h-top,0,FMAT.wood);
    fPart(group,w*.8,foot,d,0,0,0,FMAT.metal);
    fPart(group,w*.12,h-top-foot,d*.1,0,foot,-d*.45,FMAT.metal);
  },
  rangeHood(group,w,d,h){
    fPart(group,w,.078,d,0,.012,0,FMAT.metal);
    fPart(group,w*.76,.012,d*.7,0,0,0,FMAT.dark);
    fPart(group,w*.48,h-.09,d*.48,0,.09,-d*.26,FMAT.metal);
  },
  faucet(group,w,d,h){
    fPart(group,w,h*.12,d*.5,0,0,-d*.25,FMAT.metal,true);
    fPart(group,w*.32,h*.84,d*.2,0,h*.1,-d*.3,FMAT.metal,true);
    fPart(group,w*.32,h*.18,d*.8,0,h*.82,d*.1,FMAT.metal);
  },
  airConditioner(group,w,d,h){
    fPart(group,w,h,d*.96,0,0,-d*.02,FMAT.white);
    fPart(group,w*.96,h*.76,d*.04,0,h*.18,d*.48,FMAT.white);
    fPart(group,w*.86,h*.12,d*.04,0,h*.03,d*.48,FMAT.dark);
  },
  // 天井付けのロールスクリーンを下ろした状態。室内側の細い線が、プロジェクターで映せる範囲
  // （16:9、余白5cm）。blender/furniture_assets.py の roll_screen_parts() と同じ形
  rollScreen(group,w,d,h){
    const {iw,ih,cy}=rollScreenImage(w,h), t=.01, z=.007;
    fPart(group,w,.08,d,0,h-.08,0,FMAT.white);
    if(!rollScreensDown){ fPart(group,w-.02,.03,.024,0,h-.11,0,FMAT.metal); return; }   // 上げた状態：巻き取り箱の下にバーだけ
    fPart(group,w-.02,h-.11,.01,0,.03,0,FMAT.white);
    fPart(group,w-.02,.03,.024,0,0,0,FMAT.metal);
    fPart(group,iw,t,.004,0,cy+ih/2-t,z,FMAT.dark);
    fPart(group,iw,t,.004,0,cy-ih/2,z,FMAT.dark);
    fPart(group,t,ih,.004,-iw/2+t/2,cy-ih/2,z,FMAT.dark);
    fPart(group,t,ih,.004,iw/2-t/2,cy-ih/2,z,FMAT.dark);
  },
  // 天井の金具に吊るした市販のプロジェクター（blender/furniture_assets.py の ceiling_projector_parts() と同じ形）。レンズ側が+z
  ceilingProjector(group,w,d,h){
    const b=.115, r=.025;
    fPart(group,w,b,d,0,0,0,FMAT.white);
    const hood=fPart(group,(r+.008)*2,.008,(r+.008)*2,0,0,0,FMAT.dark,true);
    hood.rotation.x=Math.PI/2; hood.position.set(0,b/2,d/2+.004);
    fPart(group,.002,b*.4,d*.6,-w/2,b*.3,0,FMAT.dark);
    fPart(group,.002,b*.4,d*.6,w/2,b*.3,0,FMAT.dark);
    fPart(group,.032,h-b-.006,.032,0,b,0,FMAT.dark);
    fPart(group,.1,.006,.1,0,h-.006,0,FMAT.dark);
    fPart(group,.006,h-b*.6,.006,0,b*.6,-d/2-.009,FMAT.dark);
  },
  // 枕元の壁の造作（blender/furniture_assets.py の headboard_ledge_parts()／ceiling_cove_parts() と同じ形）
  headboardLedge(group,w,d,h){
    fPart(group,w,h-.03,.03,0,0,-d/2+.015,FMAT.wood);   // 壁に付ける板
    fPart(group,w,.03,d,0,h-.03,0,FMAT.wood);           // 上端の棚
  },
  ceilingCove(group,w,d,h){
    fPart(group,w,.02,d,0,h-.02,0,FMAT.white);          // 天井に付く板
    fPart(group,w,h,.02,0,0,d/2-.01,FMAT.white);        // 中の照明を隠す前の板
  },
  // 天井のレールと、閉じたウェーブのカーテン（床から1cm上まで）。blender/furniture_assets.py の curtain_parts() と同じ形
  curtain(group,w,d,h){
    fPart(group,w,.025,.03,0,h-.025,0,FMAT.white);
    const shape=new THREE.Shape();
    curtainWave(w).forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:h-.04,bevelEnabled:false,steps:1});
    geo.rotateX(-Math.PI/2);geo.translate(0,.01,0);
    const cloth=new THREE.Mesh(geo,FMAT.curtain);
    group.add(cloth);
    // 内覧モードで近づくと開く（updateWalkCurtains）。布を+x側（回転0のとき東、収納の南の端）へ寄せて束ねる
    group.userData.curtainCloth=cloth; group.userData.curtainWidth=w;
  },
  // 壁掛けの絵：淡いキャンバス、縁の細い額（色を決めるまで地と同じ）、くすんだ色の面と小さな差し色
  wallArt(group,w,d,h){ addParts(group,wallArtParts(w,d,h)); },
  lowBookshelf(group,w,d,h){ addParts(group,bookshelfParts(w,d,h)); },
  plantTree(group,w,d,h){ addParts(group,plantTreeParts(w,d,h)); },
  // 窓の上の和紙調のプリーツスクリーンを昼に少し下ろした状態（ロールスクリーンの上げ下げの切り替えとは別）
  pleatedScreen(group,w,d,h){ addParts(group,pleatedScreenParts(w,d,h)); },
  // 置き型の和紙の照明（光は出さない）と一輪挿し
  paperLamp(group,w,d,h){ addParts(group,paperLampParts(w,d,h)); },
  budVase(group,w,d,h){ addParts(group,budVaseParts(w,d,h)); },
  // 民泊の玄関のくぼみ：棚板・傘の丸棒・ペグの造作と、そこに置く物
  alcoveShelf(group,w,d,h){ addParts(group,alcoveShelfParts(w,d,h)); },
  alcoveItems(group,w,d,h){ addParts(group,alcoveItemsParts(w,d,h)); },
  // 民泊のトイレ・洗面の黒い金物と、洗濯機の上の棚
  towelBar(group,w,d,h){ addParts(group,towelBarParts(w,d,h)); },
  handWash(group,w,d,h){ addParts(group,handWashParts(w,d,h)); },
  paperHolder(group,w,d,h){ addParts(group,paperHolderParts(w,d,h)); },
  washShelf(group,w,d,h){ addParts(group,washShelfParts(w,d,h)); },
  refrigeratorFront(group,w,d,h){
    fPart(group,w,h,d*.94,0,0,-d*.03,FMAT.metal);
    fPart(group,w,h*.315,d*.06,0,0,d*.47,FMAT.white);
    fPart(group,w,h*.68,d*.06,0,h*.32,d*.47,FMAT.white);
  },
  roundTable(group,w,d,h){
    const top=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,1,64),FMAT.wood);
    top.scale.set(w,.035,d);top.position.y=h-.0175;group.add(top);
    for(const sx of [-1,1])for(const sz of [-1,1])
      colorRole(fPart(group,.052,h-.035,.052,sx*w*.25,0,sz*d*.25,FMAT.wood,true),'frame');
  },
  timberChair(group,w,d,h){
    const seat=h*.53;
    fPart(group,w,.045,d,0,seat-.045,0,FMAT.fabricTan);
    for(const sx of [-1,1])for(const sz of [-1,1])
      fPart(group,.036,seat-.045,.036,sx*(w/2-.035),0,sz*(d/2-.035),FMAT.wood,true);
    fPart(group,w*.96,h-seat,d*.06,0,seat,-d*.43,FMAT.wood);
  },
  television(group,w,d,h){
    fPart(group,w,h,d*.9,0,0,-d*.05,FMAT.dark);
    fPart(group,w*.96,h*.94,d*.1,0,h*.03,d*.45,FMAT.mirror);
  },
  boxAppliance(group,w,d,h){ fPart(group, w,h,d, 0,0,0, FMAT.metal); },
  kitchenCounter(group,w,d,h){
    fPart(group, w,h*0.85,d, 0,0,0, FMAT.counter);
    fPart(group, w*0.22,0.05,d*0.5, -w*0.28,h*0.85,0, FMAT.dark); // シンク
    fPart(group, w,h*0.15,d*0.12, 0,h*0.85,-d*0.44, FMAT.white); // 背面立ち上がり
  },
  vanity(group,w,d,h){
    fPart(group, w,h*0.42,d, 0,0,0, FMAT.white);
    fPart(group, w*0.85,h*0.5,0.04, 0,h*0.45,-d*0.45, FMAT.mirror);
  },
  toilet(group,w,d,h){
    fPart(group, w*0.75,h*0.45,d*0.35, 0,0,d*0.28, FMAT.white); // ボウル
    fPart(group, w*0.7,h*0.55,d*0.25, 0,h*0.45,-d*0.32, FMAT.white); // タンク
  },
  toiletTankless(group,w,d,h){
    fPart(group, w*0.8,h*0.85,d*0.7, 0,0,d*0.1, FMAT.white); // ボウル一体型（タンクなし）
    fPart(group, w*0.35,h*0.25,0.04, 0,h*0.55,-d*0.42, FMAT.dark); // 壁掛け操作パネル
  },
  bathtub(group,w,d,h){
    fPart(group, w,h,d, 0,0,0, FMAT.white);
    fPart(group, w*0.85,h*0.6,d*0.7, 0,h*0.35,0, FMAT.mirror);
  },
  bed(group,w,d,h){
    fPart(group, w,h,d*0.92, 0,0,-d*0.04, FMAT.fabricTan); // マットレス
    // 足元の帯（ベッドスロー）。色を決めるまでは寝具と同じ色。blender/furniture_assets.py の bed_parts() の runner と同じ位置
    colorRole(fPart(group, w+0.01,h*0.25+0.012,0.35, 0,h*0.75,d*0.42-0.195, FMAT.fabricTan),'accent');
    fPart(group, w,h*1.6,d*0.06, 0,0,-d*0.47, FMAT.wood); // ヘッドボード
    fPart(group, w*0.42,h*0.35,d*0.22, -w*0.24,h*0.65,-d*0.32, FMAT.white); // 枕
    fPart(group, w*0.42,h*0.35,d*0.22, w*0.24,h*0.65,-d*0.32, FMAT.white);
  },
  sofa(group,w,d,h){
    fPart(group, w,h*0.45,d, 0,0,0, FMAT.fabricBlue); // 座面
    fPart(group, w,h*0.55,d*0.22, 0,h*0.45,-d*0.39, FMAT.fabricBlue); // 背もたれ
    fPart(group, w*0.12,h*0.85,d, -w*0.44,0,0, FMAT.fabricBlue); // 肘掛け
    fPart(group, w*0.12,h*0.85,d, w*0.44,0,0, FMAT.fabricBlue);
  },
  table(group,w,d,h){
    fPart(group, w,h*0.08,d, 0,h*0.92,0, FMAT.wood);
    const legInset=0.06;
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
      colorRole(fPart(group, 0.06,h*0.92,0.06, sx*(w/2-legInset), 0, sz*(d/2-legInset), FMAT.wood),'frame');
    });
  },
  chair(group,w,d,h){
    colorRole(fPart(group, w,h*0.06,d, 0,h*0.5,0, FMAT.wood),'fabric'); // 座面
    fPart(group, w,h*0.5,0.05, 0,h*0.5,-d*0.45, FMAT.wood); // 背もたれ
    const legInset=0.04;
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
      fPart(group, 0.04,h*0.5,0.04, sx*(w/2-legInset), 0, sz*(d/2-legInset), FMAT.wood);
    });
  },
  lowCabinet(group,w,d,h){ fPart(group, w,h,d, 0,0,0, FMAT.wood); },
  cupboard(group,w,d,h){
    fPart(group, w,h*0.5,d, 0,0,0, FMAT.wood); // 下段収納
    fPart(group, w,0.04,d, 0,h*0.5,0, FMAT.dark); // 天板（家電置き場）
    fPart(group, w,h*0.42,d*0.85, 0,h*0.54,0, FMAT.mirror); // 上段（ガラス扉のイメージ）
  },
  // 2026-09-17: 脱衣室(room-1f-16)の造作。blender/laundry_assets.py と1対1で対応させ、
  // 部品レシピ(laundryParts)を両者で突き合わせられる形にする（収納家具と同じ方式）。
  laundryCounter(group,w,d,h){drawLaundry(group,'laundryCounter',w,d,h);},
  laundryShelf(group,w,d,h){drawLaundry(group,'laundryShelf',w,d,h);},
  laundryRack(group,w,d,h){drawLaundry(group,'laundryRack',w,d,h);},
  laundryBasket(group,w,d,h){drawLaundry(group,'laundryBasket',w,d,h);},
  wallHookRail(group,w,d,h){drawEntry(group,'wallHookRail',w,d,h);},
  wallPlankShelf(group,w,d,h){drawEntry(group,'wallPlankShelf',w,d,h);},
  shelf(group,w,d,h){
    fPart(group, w,h,0.04, 0,0,-d*0.45, FMAT.wood); // 背板
    fPart(group, 0.04,h,d, -w*0.47,0,0, FMAT.wood); // 側板
    fPart(group, 0.04,h,d, w*0.47,0,0, FMAT.wood);
    [0.02,0.35,0.68].forEach(t=> fPart(group, w*0.9,0.03,d*0.9, 0,h*t,0, FMAT.wood)); // 棚板
  }
};
// ---- 家具の配置編集（第2段階）：ブラウザ上のドラッグ・回転・サイズ変更をlocalStorageに保存する ----
// 正本由来の家具に、ブラウザで追加した家具をこのセッションの配列へ合流する。
// 差分だけを furnitureEdits に持ち、effectiveFurniture() で重ねて見た目に反映する。
// 「書き出し」ボタンで差分を反映した完全なJSONをダウンロードし、それをfurniture.jsonへ
// 手動でコミットする運用（Ryuka-Landscape-DesignerがlocalStorageのみで機種間同期されない
// 弱点を踏まえた設計。詳細はdocs/BACKGROUND.md）。
const FURNITURE_EDITS_KEY = 'ryuka-furniture-edits-v1';
let furnitureEdits = {};
try { furnitureEdits = JSON.parse(localStorage.getItem(FURNITURE_EDITS_KEY) || '{}') || {}; } catch(e){ furnitureEdits = {}; }
const FURNITURE_ADDED_KEY = 'ryuka-furniture-added-v1';
const FURNITURE_DELETED_KEY = 'ryuka-furniture-deleted-v1';
const sourceFurnitureIds = new Set(FURNITURE_ITEMS.map(i=>i.id));
let addedFurniture = [];
try {
  const saved = JSON.parse(localStorage.getItem(FURNITURE_ADDED_KEY) || '[]');
  if(Array.isArray(saved)) addedFurniture = saved.filter(i=>i && !sourceFurnitureIds.has(i.id) &&
    FURNITURE_CATALOG[i.type] && [1,2].includes(i.level) && Number.isFinite(i.x) && Number.isFinite(i.z));
} catch(e){}
FURNITURE_ITEMS.push(...addedFurniture);
let deletedFurniture = [];
try {
  const saved = JSON.parse(localStorage.getItem(FURNITURE_DELETED_KEY) || '[]');
  if(Array.isArray(saved)) deletedFurniture = [...new Set(saved.filter(id=>sourceFurnitureIds.has(id)))];
} catch(e){}
function saveAddedFurniture(){
  try { localStorage.setItem(FURNITURE_ADDED_KEY,JSON.stringify(addedFurniture)); } catch(e){}
}
function saveDeletedFurniture(){
  try { localStorage.setItem(FURNITURE_DELETED_KEY,JSON.stringify(deletedFurniture)); } catch(e){}
}
function saveFurnitureEdits(){ try{ localStorage.setItem(FURNITURE_EDITS_KEY, JSON.stringify(furnitureEdits)); } catch(e){} }
function effectiveFurniture(item){ const e = furnitureEdits[item.id]; return e ? {...item, ...e} : item; }
// ---- 入れ替えセット（data/furniture.json の variantSets。例：ダイニングの WILLTIC／MAR_EA）----
// 表示中の組は、正本の active を、furnitureEdits の特別なキー __variants（この端末の下書き）が上書きする。
// 家具・電気設備の set/variant が表示中の組と一致しないものは、配置・歩行の当たり判定・見積の数量に入らない
// （データには残り、保存でも消えない＝savedFurnitureItems／savedElectricalItems）。Python側は scripts/variant_sets.py
const VARIANTS_EDIT_KEY = '__variants';
function activeVariantOf(setId){
  const set = FURNITURE_VARIANT_SETS[setId];
  if(!set) return null;
  const draft = (furnitureEdits[VARIANTS_EDIT_KEY] || {})[setId];
  return draft && set.variants[draft] ? draft : set.active;
}
function isVariantActive(item){ return !item.set || activeVariantOf(item.set) === item.variant; }
function savedFurnitureItems(){ return FURNITURE_ITEMS.filter(item=>!deletedFurniture.includes(item.id)); }
function activeFurnitureItems(){ return savedFurnitureItems().filter(isVariantActive); }
function round2(n){ return Math.round(n*100)/100; }

// 家具に付ける小物（data/visual/guest-decor.json の furnitureId）。家具と同じ位置・向きで一緒に描き、色はその家具の
// 色として選ぶ（役割は furnitureColorRoles()）。Blender（blender/guest_decor.py・textile_assets.py）は丸みや布の
// 折れまで作り、ここは目安の形。anchor はその小物を付けられる家具の形
const DECOR_PILLOW = new THREE.SphereGeometry(0.5,24,16);
const DECOR_SHAPES = {
  // ソファのクッション2つと、背もたれの前から座面へ掛けたひざ掛け。座面と背もたれの位置は FURNITURE_SHAPES.sofa に
  // 合わせ、ソファの外形（幅・奥行き・高さ）の内側に収める（当たり判定・寸法の表示が外形で決まるため）
  'sofa-textiles': {anchor:'sofa', draw(group,w,d,h){
    const seat=h*.45, back=-d*.28, t=.012, x=w*.25, tw=.34;
    [[-.27,'cushion'],[-.015,'cushion2']].forEach(([f,role])=>{
      const m=colorRole(new THREE.Mesh(DECOR_PILLOW,FMAT.fabricTan),role);
      m.scale.set(.37,.34,.14); m.position.set(w*f,seat+.17,back+.08); m.rotation.x=-.18; group.add(m);
    });
    colorRole(fPart(group,tw,h-seat-.02,t,x,seat,back+t/2,FMAT.fabricTan),'accent');
    colorRole(fPart(group,tw,t,d/2-back-.03,x,seat,(back+d/2-.03)/2,FMAT.fabricTan),'accent');
  }}
};
const furnitureMeshes = new Map(); // id -> { holder, label }
function placeFurnitureItem(item){
  const profile = FURNITURE_CATALOG[item.type];
  if(!profile) return;
  const shapeFn = FURNITURE_SHAPES[profile.shape];
  if(!shapeFn) return;
  const holder = new THREE.Group();
  holder.userData.furnitureId = item.id;
  const yaw = (profile.rotationConvention==='source' ? 1 : -1) * item.rotation * Math.PI/180; // TVは正本の+zを正面とする。既存家具の向きは維持。
  const extra = profile.shape==='product'
    ? {product:profile.product, finish:item.productFinish, options:productOptionsFor(item.id), yaw}
    : (profile.shape==='willticHalfRound' || profile.shape==='roundPedestalTable' || profile.shape==='wq19Sofa') ? item.productFinish : item.storage;
  try{
    shapeFn(holder, item.width, item.depth, item.height, extra);
    for(const d of GUEST_DECOR.items){
      const decor=DECOR_SHAPES[d.kind];
      if(d.furnitureId===item.id && decor && decor.anchor===profile.shape) decor.draw(holder, item.width, item.depth, item.height);
    }
    // 案の家具・布の色（web/finishes.js が用意する。読み込み前の最初の描画は標準の色で、あとから描き直す）
    if(typeof furnitureColorsFor==='function')
      applyFurnitureColors(holder, furnitureColorRoles(item), furnitureColorsFor(item.id), (FURNITURE_COLOR_ROLES.fallbacks||{})[profile.shape]);
  }catch(e){
    // W08-H: 1件の寸法異常（範囲外の幅・奥行き・高さ等）でシーン全体の構築を止めない。
    // このtry/catchがない間、ここで投げた例外がこの関数の呼び出し元
    // (activeFurnitureItems().forEach(...)、ページ読込み時に無条件で実行される)まで
    // 伝播し、それ以降のスクリプト全体(床・壁・照明・カメラ操作・アニメーションループの
    // 初期化を含む)が実行されないまま止まり、画面が真っ黒になる不具合があった。
    console.error('家具の形状生成に失敗したため、この家具の表示をスキップします:', item.id, item.label||'', e.message);
    return;
  }
  const baseY = (item.level===1 ? LEVELS.fl1 : LEVELS.fl2) + (ROOMS_APPROX[item.level].find(r=>r.id===item.room)?.floorOffsetM ?? 0);
  const [sx,sz] = toScene(item.x, item.z);
  holder.position.set(sx, baseY + (item.elevation ?? 0), sz);
  holder.rotation.y = yaw;
  const grp = item.level===1 ? groups.furniture1 : groups.furniture2;
  grp.add(holder);
  const l = makeLabel(item.label, item.x, baseY+(item.elevation ?? 0)+item.height+0.12, item.z, false);
  l.floor = item.level; l.isFurniture = true;
  // 作り直した家具のラベルは、できたての状態だと必ず表示になってしまう（起動後に仕上げや製品の色を
  // 反映する作り直しで、民泊の家具やキッチンのラベルだけ出てしまっていた）。ここでチェックボックスと
  // 内覧中かどうかに合わせておき、作り直しの呼び出し側（rebuildFurnitureItem）が階・部屋フォーカスも反映する
  l.div.style.display = (document.getElementById('chkFurnitureLabels').checked && mode!=='walk') ? 'block' : 'none';
  labels.push(l);
  furnitureMeshes.set(item.id, { holder, label: l, baseY });
  // 開閉するカーテン：近づいたかの判定に使う位置と階、開き具合(t: 0=閉,1=開)
  if(holder.userData.curtainCloth) holder.userData.curtain = { x:item.x, z:item.z, level:item.level, t:0 };
  // 窓や開口を覆う布・スクリーンは壁の一部のように視界をふさぐので、三人称では壁と一緒に透かす
  if(['rollScreen','pleatedScreen','curtain'].includes(profile.shape)) holder.userData.fadeWithWalls = true;
}
function removeFurnitureMesh(id){
  const entry = furnitureMeshes.get(id);
  if(!entry) return;
  if(entry.holder.parent) entry.holder.parent.remove(entry.holder);
  const idx = labels.indexOf(entry.label);
  if(idx>=0){ entry.label.div.remove(); labels.splice(idx,1); }
  furnitureMeshes.delete(id);
}
function rebuildFurnitureItem(id){
  if(deletedFurniture.includes(id)) return;
  const base = FURNITURE_ITEMS.find(f=>f.id===id);
  if(!base) return;
  removeFurnitureMesh(id);
  if(!isVariantActive(base)) return;   // 入れ替えセットの表示中でない組は置かない
  placeFurnitureItem(effectiveFurniture(base));
  if(mode!=='walk') refreshLabelVis(); // 階の表示切替・部屋フォーカス中の隠し状態も、新しいラベルへ反映する
}
activeFurnitureItems().forEach(item=> placeFurnitureItem(effectiveFurniture(item)));

// ---- 家具編集パネルの表示・操作 ----
function updateFurniturePanel(){
  const panel = document.getElementById('furniturePanel');
  if(!editMode || !selectedFurnitureId){ panel.style.display = 'none'; return; }
  const base = FURNITURE_ITEMS.find(f=>f.id===selectedFurnitureId);
  if(!base){ panel.style.display = 'none'; return; }
  const eff = effectiveFurniture(base);
  document.getElementById('fpLabel').textContent = eff.label || eff.type;
  document.getElementById('fpWidth').value = eff.width;
  document.getElementById('fpDepth').value = eff.depth;
  document.getElementById('fpHeight').value = eff.height;
  document.getElementById('fpElevation').value = eff.elevation ?? 0;
  const shape=FURNITURE_CATALOG[eff.type].shape;
  const isProduct=shape==='willticHalfRound', isParts=shape==='product', isMarEa=shape==='roundPedestalTable', isWq19=shape==='wq19Sofa';
  document.getElementById('fpProduct').style.display=isProduct?'':'none';
  document.getElementById('fpProductParts').style.display=isParts?'':'none';
  document.getElementById('fpMarEa').style.display=isMarEa?'':'none';
  document.getElementById('fpWq19').style.display=isWq19?'':'none';
  for(const id of ['fpWidth','fpDepth','fpHeight']) document.getElementById(id).disabled=isProduct||isParts||isMarEa||isWq19;
  if(isWq19){const cfg=wq19Settings(eff.width,eff.depth,eff.height,eff.productFinish);document.getElementById('fpWqFrame').value=cfg.frame;document.getElementById('fpWqFabric').value=cfg.fabric;}
  if(isMarEa){const cfg=marEaSettings(eff.width,eff.depth,eff.height,eff.productFinish);document.getElementById('fpMarSize').value=String(Math.round(eff.width*100));document.getElementById('fpMarTop').value=cfg.top;document.getElementById('fpMarLegs').value=cfg.legs;}
  if(isProduct){const cfg=willticSettings(eff.width,eff.depth,eff.height,eff.productFinish);document.getElementById('fpProductTop').value=cfg.top;document.getElementById('fpProductLegs').value=cfg.legs;}
  if(isParts) RyukaProducts.buildFinishPanel(document.getElementById('fpProductParts'),eff,applyProductPartsFinish);
  const isStorage=STORAGE_SHAPES.includes(shape);
  document.getElementById('fpStorage').style.display=isStorage ? '' : 'none';
  if(isStorage){
    const cfg=storageSettings(shape,eff.width,eff.depth,eff.height,eff.storage);
    document.getElementById('fpRailsLabel').style.display=cfg.railHeights.length ? '' : 'none';
    document.getElementById('fpShelvesLabel').style.display=cfg.shelfHeights.length ? '' : 'none';
    document.getElementById('fpRails').value=cfg.railHeights.join(', ');
    document.getElementById('fpShelves').value=cfg.shelfHeights.join(', ');
    document.getElementById('fpContents').checked=cfg.contents;
    document.getElementById('fpContentsLabel').style.display=(cfg.railHeights.length||cfg.shelfHeights.length) ? '' : 'none';
  }
  panel.style.display = 'block';
}
function applyProductFinish(){
  const base=FURNITURE_ITEMS.find(f=>f.id===selectedFurnitureId);
  if(!base||FURNITURE_CATALOG[base.type].shape!=='willticHalfRound')return;
  const eff=effectiveFurniture(base);
  const productFinish=willticSettings(eff.width,eff.depth,eff.height,{top:document.getElementById('fpProductTop').value,legs:document.getElementById('fpProductLegs').value});
  furnitureEdits[base.id]={...(furnitureEdits[base.id]||{}),productFinish};
  saveFurnitureEdits();rebuildFurnitureItem(base.id);setSelectedFurniture(base.id);updateFurnitureBar();
}
// MAR_EA円卓：サイズ（幅＝奥行＝直径）と天板色・脚の木をまとめて反映する
// 家具を id で指定して変える（編集パネルと、左の「商品の色・サイズ」＝閲覧版のスマホからも使う）
function setMarEaChoice(id,patch){
  const base=FURNITURE_ITEMS.find(f=>f.id===id);
  if(!base||FURNITURE_CATALOG[base.type].shape!=='roundPedestalTable')return;
  const eff=effectiveFurniture(base), current=marEaSettings(eff.width,eff.depth,eff.height,eff.productFinish);
  const diameter=patch.size!==undefined ? Number(patch.size)/100 : eff.width;
  let productFinish;
  try{productFinish=marEaSettings(diameter,diameter,eff.height,{top:patch.top ?? current.top,legs:patch.legs ?? current.legs});}
  catch(e){updateFurniturePanel();return;}
  furnitureEdits[id]={...(furnitureEdits[id]||{}),productFinish,width:diameter,depth:diameter};
  saveFurnitureEdits();rebuildFurnitureItem(id);
  if(selectedFurnitureId===id) setSelectedFurniture(id);
  updateFurnitureBar();rebuildFurnitureSegments();
}
function applyMarEa(){
  if(!selectedFurnitureId) return;
  setMarEaChoice(selectedFurnitureId,{size:document.getElementById('fpMarSize').value,top:document.getElementById('fpMarTop').value,legs:document.getElementById('fpMarLegs').value});
}
// ソファWQ19CR：フレームの材質（N/B/U）とクッションの色。寸法は固定
function setWq19Choice(id,patch){
  const base=FURNITURE_ITEMS.find(f=>f.id===id);
  if(!base||FURNITURE_CATALOG[base.type].shape!=='wq19Sofa')return;
  const eff=effectiveFurniture(base), current=wq19Settings(eff.width,eff.depth,eff.height,eff.productFinish);
  let productFinish;
  try{productFinish=wq19Settings(eff.width,eff.depth,eff.height,{frame:patch.frame ?? current.frame,fabric:patch.fabric ?? current.fabric});}
  catch(e){updateFurniturePanel();return;}
  furnitureEdits[id]={...(furnitureEdits[id]||{}),productFinish};
  saveFurnitureEdits();rebuildFurnitureItem(id);
  if(selectedFurnitureId===id) setSelectedFurniture(id);
  updateFurnitureBar();
}
function applyWq19(){
  if(!selectedFurnitureId) return;
  setWq19Choice(selectedFurnitureId,{frame:document.getElementById('fpWqFrame').value,fabric:document.getElementById('fpWqFabric').value});
}
(function fillMarEaChoices(){
  const fill=(id,entries)=>{const select=document.getElementById(id);for(const [value,label] of entries){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}};
  fill('fpMarSize',Object.entries(MAREA_PROFILE.sizes).map(([key,size])=>[key,size.label]));
  fill('fpMarTop',Object.entries(MAREA_PROFILE.finishes.top).map(([key,finish])=>[key,finish.label]));
  fill('fpMarLegs',Object.entries(MAREA_PROFILE.finishes.legs).map(([key,finish])=>[key,finish.label]));
  fill('fpWqFrame',Object.entries(WQ19_PROFILE.finishes.frame).map(([key,finish])=>[key,finish.label]));
  fill('fpWqFabric',Object.entries(WQ19_PROFILE.finishes.fabric).map(([key,finish])=>[key,finish.label]));
})();
// 採用品の色（役割ごとの上書き。undefinedで製品の色に戻す）
function applyProductPartsFinish(productFinish){
  const base=FURNITURE_ITEMS.find(f=>f.id===selectedFurnitureId);
  if(!base||FURNITURE_CATALOG[base.type].shape!=='product')return;
  furnitureEdits[base.id]={...(furnitureEdits[base.id]||{}),productFinish};
  if(JSON.stringify(productFinish)===JSON.stringify(base.productFinish)) delete furnitureEdits[base.id].productFinish;
  if(!Object.keys(furnitureEdits[base.id]).length) delete furnitureEdits[base.id];
  saveFurnitureEdits();rebuildFurnitureItem(base.id);setSelectedFurniture(base.id);updateFurnitureBar();
}
// 左パネルの「商品の色・サイズ」：選べる商品（円卓・ソファ）を、表示中の家具から作る
const PRODUCT_CONTROL_SHAPES={
  roundPedestalTable:(eff)=>{
    const cfg=marEaSettings(eff.width,eff.depth,eff.height,eff.productFinish), P=MAREA_PROFILE;
    return [
      {label:'サイズ',value:String(Math.round(eff.width*100)),options:Object.entries(P.sizes).map(([k,s])=>[k,s.label]),set:(id,v)=>setMarEaChoice(id,{size:v})},
      {label:'天板の色',value:cfg.top,options:Object.entries(P.finishes.top).map(([k,f])=>[k,f.label]),set:(id,v)=>setMarEaChoice(id,{top:v})},
      {label:'脚の木',value:cfg.legs,options:Object.entries(P.finishes.legs).map(([k,f])=>[k,f.label]),set:(id,v)=>setMarEaChoice(id,{legs:v})},
    ];
  },
  // 案の選択肢のある採用品（オフェリアのキッチン・カップボード：扉カラー、キッチンはIHの背面）。この案の選択は仕上げの案に入る
  product:(eff)=>{
    const product=PRODUCT_PARTS[FURNITURE_CATALOG[eff.type].product], picks=productOptionsFor(eff.id), rows=[];
    for(const [key,o] of Object.entries(product.options)){
      rows.push({label:o.label,value:picks[key] ?? o.default,options:Object.entries(o.choices).map(([k,c])=>[k,c.label]),
        set:(id,v)=>{ if(window.RyukaFinishes && RyukaFinishes.setProductOption) RyukaFinishes.setProductOption(id,key,v,o.default); }});
    }
    return rows;
  },
  wq19Sofa:(eff)=>{
    const cfg=wq19Settings(eff.width,eff.depth,eff.height,eff.productFinish), P=WQ19_PROFILE;
    return [
      {label:'フレームの材質',value:cfg.frame,options:Object.entries(P.finishes.frame).map(([k,f])=>[k,f.label]),set:(id,v)=>setWq19Choice(id,{frame:v})},
      {label:'クッションの色',value:cfg.fabric,options:Object.entries(P.finishes.fabric).map(([k,f])=>[k,f.label]),set:(id,v)=>setWq19Choice(id,{fabric:v})},
    ];
  },
};
function refreshProductControls(){
  const box=document.getElementById('productControls');
  if(!box || typeof box.replaceChildren!=='function') return;
  const blocks=[];
  for(const item of activeFurnitureItems()){
    const spec=PRODUCT_CONTROL_SHAPES[(FURNITURE_CATALOG[item.type]||{}).shape];
    if(!spec) continue;
    let rows;
    try{ rows=spec(effectiveFurniture(item)); }catch(e){ continue; }
    const wrap=document.createElement('div');
    const title=document.createElement('div'); title.textContent=item.label||item.type; title.style.fontWeight='600'; title.style.margin='6px 0 2px';
    wrap.appendChild(title);
    for(const row of rows){
      const label=document.createElement('label'); label.textContent=row.label;
      const select=document.createElement('select');
      for(const [value,text] of row.options){ const option=document.createElement('option'); option.value=value; option.textContent=text; select.appendChild(option); }
      select.value=row.value;
      select.onchange=()=>row.set(item.id,select.value);
      label.appendChild(select); wrap.appendChild(label);
    }
    blocks.push(wrap);
  }
  box.replaceChildren(...blocks);
}
function updateFurnitureBar(){
  const n = new Set([...Object.keys(furnitureEdits),...addedFurniture.map(i=>i.id),...deletedFurniture]).size;
  document.getElementById('fbCount').textContent = n>0 ? `編集済み: ${n}件` : '編集なし';
  const picker=document.getElementById('fbDeleted'),restore=document.getElementById('fbRestoreDeleted');
  const previous=picker.value;
  picker.replaceChildren();
  for(const id of deletedFurniture){
    const base=FURNITURE_ITEMS.find(item=>item.id===id);
    if(!base) continue;
    const option=document.createElement('option');option.value=id;option.textContent=base.label||FURNITURE_CATALOG[base.type]?.label||id;
    picker.appendChild(option);
  }
  if(deletedFurniture.includes(previous)) picker.value=previous;
  picker.style.display=restore.style.display=deletedFurniture.length ? '' : 'none';
  refreshProductControls();
}
function populateFurnitureTypeOptions(query=''){
  const picker=document.getElementById('fbAddType');
  const previous=picker.value;
  const needle=query.trim().normalize('NFKC').toLocaleLowerCase('ja');
  picker.replaceChildren();
  const categories=Object.entries(FURNITURE_CATEGORIES);
  const categoryIds=[...categories.map(([id])=>id),...new Set(Object.values(FURNITURE_CATALOG).map(cat=>cat.category).filter(id=>!FURNITURE_CATEGORIES[id]))];
  let count=0;
  for(const categoryId of categoryIds){
    const matches=Object.entries(FURNITURE_CATALOG).filter(([type,cat])=>cat.category===categoryId &&
      (!needle || `${cat.label} ${type}`.normalize('NFKC').toLocaleLowerCase('ja').includes(needle)))
      .sort((a,b)=>a[1].label.localeCompare(b[1].label,'ja'));
    if(!matches.length) continue;
    const group=document.createElement('optgroup');
    group.label=(FURNITURE_CATEGORIES[categoryId]||categoryId).split('（')[0];
    for(const [type,cat] of matches){
      const option=document.createElement('option');option.value=type;option.textContent=cat.label;
      group.appendChild(option);count++;
    }
    picker.appendChild(group);
  }
  if(!count){
    const option=document.createElement('option');option.textContent='該当する家具がありません';option.disabled=true;
    picker.appendChild(option);
  }
  if([...picker.options].some(option=>option.value===previous)) picker.value=previous;
  document.getElementById('fbAdd').disabled=!count;
}
function rotateSelected(){
  if(!selectedFurnitureId) return;
  const base = FURNITURE_ITEMS.find(f=>f.id===selectedFurnitureId);
  const next = (effectiveFurniture(base).rotation + 90) % 360;
  furnitureEdits[selectedFurnitureId] = {...(furnitureEdits[selectedFurnitureId]||{}), rotation: next};
  const entry = furnitureMeshes.get(selectedFurnitureId);
  // 採用品は面の向きで陰影を付けているので作り直す（他の家具は向きだけ変える）
  if(FURNITURE_CATALOG[base.type].shape==='product') rebuildFurnitureItem(selectedFurnitureId);
  else if(entry) entry.holder.rotation.y = (FURNITURE_CATALOG[base.type].rotationConvention==='source' ? 1 : -1) * next * Math.PI/180;
  saveFurnitureEdits();
  setSelectedFurniture(selectedFurnitureId); // 選択枠(BoxHelper)を回転後の向きで作り直す
  updateFurnitureBar();
}
function applySizeEdit(field, value){
  if(!selectedFurnitureId) return;
  const v = parseFloat(value);
  if(!Number.isFinite(v) || (field==='elevation' ? v<0 : v<=0) || (field!=='elevation' && round2(v)<=0)){ updateFurniturePanel(); return; }
  const base=FURNITURE_ITEMS.find(f=>f.id===selectedFurnitureId);
  const eff={...effectiveFurniture(base),[field]:round2(v)};
  const shape=FURNITURE_CATALOG[eff.type].shape;
  const dimError=validateFurnitureShapeDims(shape,eff.width,eff.depth,eff.height,eff.storage);
  if(dimError){document.getElementById('fpStorageError').textContent=dimError;updateFurniturePanel();return;}
  document.getElementById('fpStorageError').textContent='';
  furnitureEdits[selectedFurnitureId] = {...(furnitureEdits[selectedFurnitureId]||{}), [field]: round2(v)};
  saveFurnitureEdits();
  rebuildFurnitureItem(selectedFurnitureId);
  setSelectedFurniture(selectedFurnitureId);
  updateFurnitureBar();
}
function resetSelected(){
  if(!selectedFurnitureId) return;
  delete furnitureEdits[selectedFurnitureId];
  saveFurnitureEdits();
  rebuildFurnitureItem(selectedFurnitureId);
  setSelectedFurniture(selectedFurnitureId);
  updateFurnitureBar();
}
function applyStorageEdit(){
  if(!selectedFurnitureId) return;
  const base=FURNITURE_ITEMS.find(f=>f.id===selectedFurnitureId),eff=effectiveFurniture(base);
  const shape=FURNITURE_CATALOG[eff.type].shape;
  if(!STORAGE_SHAPES.includes(shape)) return;
  const list=id=>document.getElementById(id).value.trim().split(/[,、\s]+/).filter(Boolean).map(Number);
  const options={contents:document.getElementById('fpContents').checked};
  if(shape==='closetSingle'||shape==='closetDouble') options.railHeights=list('fpRails');
  if(shape==='closetShelves') options.shelfHeights=list('fpShelves');
  try{storageSettings(shape,eff.width,eff.depth,eff.height,options);}
  catch(e){document.getElementById('fpStorageError').textContent=e.message;return;}
  document.getElementById('fpStorageError').textContent='';
  furnitureEdits[base.id]={...(furnitureEdits[base.id]||{}),storage:options};
  saveFurnitureEdits();rebuildFurnitureItem(base.id);setSelectedFurniture(base.id);updateFurnitureBar();
}
function addCatalogFurniture(type,roomId){
  const cat=FURNITURE_CATALOG[type];
  const level=[1,2].find(l=>(ROOMS_APPROX[l]||[]).some(r=>r.id===roomId));
  const room=(ROOMS_APPROX[level]||[]).find(r=>r.id===roomId);
  if(!cat || !room) return null;
  // Search inward from the bounding-box centre, including concave rooms.
  const candidates=[];
  for(let ix=1;ix<20;ix++) for(let iz=1;iz<20;iz++){
    const x=round2(room.x0+(room.x1-room.x0)*ix/20),z=round2(room.z0+(room.z1-room.z0)*iz/20);
    if(findRoomIdAt(x,z,level)===roomId) candidates.push({x,z,score:(ix-10)**2+(iz-10)**2});
  }
  candidates.sort((a,b)=>a.score-b.score);
  if(!candidates.length) return null;
  const {x,z}=candidates[0];
  let serial=Date.now();while(FURNITURE_ITEMS.some(i=>i.id===`fur-user-${serial}`)) serial++;
  const item={id:`fur-user-${serial}`,type,label:cat.label,room:roomId,level,x,z,rotation:0,
    width:cat.width,depth:cat.depth,height:cat.height,status:'estimated',
    note:'ブラウザで追加した仮家具。製品未選定。寸法・材質は推定。'};
  addedFurniture.push(item);FURNITURE_ITEMS.push(item);saveAddedFurniture();
  placeFurnitureItem(item);setSelectedFurniture(item.id);updateFurnitureBar();rebuildFurnitureSegments();
  return item.id;
}
function removeAddedFurniture(id){
  if(!addedFurniture.some(i=>i.id===id)) return false;
  removeFurnitureMesh(id);FURNITURE_ITEMS.splice(FURNITURE_ITEMS.findIndex(i=>i.id===id),1);
  addedFurniture=addedFurniture.filter(i=>i.id!==id);delete furnitureEdits[id];
  saveAddedFurniture();saveFurnitureEdits();setSelectedFurniture(null);updateFurnitureBar();rebuildFurnitureSegments();
  return true;
}
function deleteSelectedFurniture(){
  const id=selectedFurnitureId;
  if(!id || !FURNITURE_ITEMS.some(item=>item.id===id)) return false;
  if(addedFurniture.some(item=>item.id===id)) return removeAddedFurniture(id);
  if(deletedFurniture.includes(id)) return false;
  deletedFurniture.push(id);
  saveDeletedFurniture();
  removeFurnitureMesh(id);
  setSelectedFurniture(null);
  updateFurnitureBar();rebuildFurnitureSegments();
  return true;
}
function restoreDeletedFurniture(id){
  if(!deletedFurniture.includes(id)) return false;
  deletedFurniture=deletedFurniture.filter(value=>value!==id);
  saveDeletedFurniture();
  rebuildFurnitureItem(id);
  updateFurnitureBar();rebuildFurnitureSegments();
  return true;
}
// 書き出し（旧方式のダウンロード）とブラウザからの直接保存（web/local-app.js）が同じ内容を使う
function buildFurniturePayload(){
  const items = savedFurnitureItems().map(base=>{
    const eff = effectiveFurniture(base);
    const cat = FURNITURE_CATALOG[base.type];
    const out = { id: base.id, type: base.type };
    const moved=eff.x!==base.x || eff.z!==base.z || !sourceFurnitureIds.has(base.id);
    const room=moved ? findRoomIdAt(eff.x,eff.z,base.level) : base.room;
    if(moved && !room) throw new Error('部屋の外にある家具を室内へ移動してください：'+(base.label||base.id));
    if(room) out.room = room;
    if(base.label) out.label = base.label;
    out.level = base.level; out.x = round2(eff.x); out.z = round2(eff.z); out.rotation = eff.rotation;
    if(round2(eff.width) !== round2(cat.width)) out.widthOverride = round2(eff.width);
    if(round2(eff.depth) !== round2(cat.depth)) out.depthOverride = round2(eff.depth);
    if(round2(eff.height) !== round2(cat.height)) out.heightOverride = round2(eff.height);
    if((eff.elevation ?? 0)!==0) out.elevation = eff.elevation;
    if(eff.storage) out.storage = eff.storage;
    if(eff.productFinish) out.productFinish = eff.productFinish;
    if(base.set !== undefined){ out.set = base.set; out.variant = base.variant; }
    out.status = base.status;
    if(base.note) out.note = base.note;
    return out;
  });
  return {
    schemaVersion: '1.0.0', units: 'm',
    note: '家具・設備の配置インスタンス。type は data/furniture-catalog.json の type を参照する。x/z は建物ローカル座標での footprint 中心、rotation は0/90/180/270度のみ。ブラウザの配置編集機能から書き出したファイル。data/furniture.json に上書きしてコミットすること。',
    variantSets: Object.fromEntries(Object.entries(FURNITURE_VARIANT_SETS).map(([id, set])=>[id, {...set, active: activeVariantOf(id)}])),
    items,
  };
}
function exportFurnitureJSON(){
  const payload = buildFurniturePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'furniture.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.getElementById('fpClose').onclick = ()=> setSelectedFurniture(null);
document.getElementById('fpRotate').onclick = rotateSelected;
document.getElementById('fpReset').onclick = resetSelected;
document.getElementById('fpDelete').onclick = deleteSelectedFurniture;
document.getElementById('fpWidth').onchange = e=> applySizeEdit('width', e.target.value);
document.getElementById('fpDepth').onchange = e=> applySizeEdit('depth', e.target.value);
document.getElementById('fpHeight').onchange = e=> applySizeEdit('height', e.target.value);
document.getElementById('fpElevation').onchange = e=> applySizeEdit('elevation', e.target.value);
for(const id of ['fpRails','fpShelves','fpContents']) document.getElementById(id).onchange=applyStorageEdit;
document.getElementById('fbExport').onclick = ()=>{
  try { exportFurnitureJSON(); } catch(e){ alert(e.message); }
};
populateFurnitureTypeOptions();
document.getElementById('fbAddSearch').oninput = e=>populateFurnitureTypeOptions(e.target.value);
for(const level of [1,2]) for(const room of ROOMS_APPROX[level]){
  if(!room.id) continue;
  const option=document.createElement('option');option.value=room.id;option.textContent=`${level}F ${room.name}`;
  document.getElementById('fbAddRoom').appendChild(option);
}
document.getElementById('fbAdd').onclick = ()=>{
  const room=document.getElementById('fbAddRoom').value;
  clearFocus();
  const level=[1,2].find(l=>(ROOMS_APPROX[l]||[]).some(r=>r.id===room));
  if(level){floorMode=`${level}F`;setActiveBtn(level===1?'btn1F':'btn2F');applyFloorMode();}
  if(!addCatalogFurniture(document.getElementById('fbAddType').value,room)) alert('追加できる室内位置がありません。');
};
document.getElementById('fbRestoreDeleted').onclick = ()=>restoreDeletedFurniture(document.getElementById('fbDeleted').value);
document.getElementById('fbClearAll').onclick = ()=>{
  if(Object.keys(furnitureEdits).length===0 && addedFurniture.length===0 && deletedFurniture.length===0) return;
  if(!confirm('家具の編集内容をすべて取り消し、元の配置に戻します。よろしいですか？')) return;
  const ids = Object.keys(furnitureEdits);
  [...addedFurniture].forEach(i=>removeAddedFurniture(i.id));
  furnitureEdits = {};
  deletedFurniture = [];
  saveFurnitureEdits();saveDeletedFurniture();
  ids.forEach(id=> rebuildFurnitureItem(id));
  sourceFurnitureIds.forEach(id=>{ if(!furnitureMeshes.has(id)) rebuildFurnitureItem(id); });
  syncVariantMeshes();   // 入れ替えセットの表示も正本の組へ戻す
  setSelectedFurniture(null);
  updateFurnitureBar();
};
document.getElementById('editToggle').onclick = ()=> setEditMode(!editMode);
updateFurnitureBar();

// ---- 室内間仕切り（v2：確度付き） ----
// 部屋フォーカス機能（俯瞰モードで1部屋だけ表示）用に、部屋ごとのメッシュをroomMeshesByIdに
// 保存する。boxWire()/polyWire()は本体メッシュと輪郭線(EdgesGeometry)を別オブジェクトとして
// 同じparentに直接addするため、本体メッシュだけをvisible=falseにしても輪郭線が残ってしまう。
// これを避けるため、部屋ごとに小さなroomGroupで両方をまとめてから grp へ追加する
const roomMeshesById = new Map(); // id -> { mesh(=roomGroup), label, level, bbox:{x0,x1,z0,z1} }
[1,2].forEach(fl=>{
  const baseY = fl===1 ? LEVELS.fl1 : LEVELS.fl2;
  const mats = fl===1 ? M1 : M2;
  const grp = fl===1 ? groups.approx1 : groups.approx2;
  ROOMS_APPROX[fl].forEach(r=>{
    const roomGroup = new THREE.Group();
    grp.add(roomGroup);
    if(r.poly){
      polyWire(r.poly, baseY, baseY+CEIL_H, mats.approx, mats.approxEdge, roomGroup, 2);
    } else {
      boxWire(r.x0, r.x1, baseY, baseY+CEIL_H, r.z0, r.z1, mats.approx, r.noEdge ? null : mats.approxEdge, roomGroup, 2);
    }
    const confMark = r.conf==='高' ? '●' : (r.conf==='中' ? '◐' : '○');
    const l = makeLabel(`${confMark} ${r.name}`, (r.x0+r.x1)/2, baseY+CEIL_H+0.15, (r.z0+r.z1)/2, true);
    l.floor = fl;
    labels.push(l);
    if(r.id) roomMeshesById.set(r.id, { mesh: roomGroup, label: l, level: fl, bbox: {x0:r.x0, x1:r.x1, z0:r.z0, z1:r.z1} });
  });
});

// ---- 階段（3Dの段差ジオメトリ＋平面図の階段記号） ----
// data/house.json の stairs（STAIRS）は直進(straight)・廻り(arc)のセグメント列を
// 「経路」として持つだけで、実際の段ボックス・平面記号の位置はここで導出する。
// 経路を弧長でtotalSteps等分し、各段の中心位置・進行方向・高さを求める。
// この経路データは内覧モードの歩行（1F↔2F間の高さ補間）にも共用する。
function sampleStairPath(stair){
  const pts = []; let cum = 0;
  function add(x,z){
    if(pts.length){ const p=pts[pts.length-1]; cum += Math.hypot(x-p.x, z-p.z); }
    pts.push({x,z,cum});
  }
  stair.segments.forEach(seg=>{
    if(seg.type==='straight'){
      if(!pts.length) add(seg.x0, seg.z0);
      add(seg.x1, seg.z1);
    } else {
      const a0 = seg.startAngleDeg*Math.PI/180, a1 = seg.endAngleDeg*Math.PI/180;
      if(!pts.length) add(seg.pivotX+seg.radius*Math.cos(a0), seg.pivotZ+seg.radius*Math.sin(a0));
      const n = 16;
      for(let i=1;i<=n;i++){
        const a = a0 + (a1-a0)*(i/n);
        add(seg.pivotX+seg.radius*Math.cos(a), seg.pivotZ+seg.radius*Math.sin(a));
      }
    }
  });
  return { pts, total: cum };
}
// 経路上の弧長sにおける位置と進行方向（単位ベクトル）を返す
function stairPointAt(path, s){
  const pts = path.pts;
  s = Math.max(0, Math.min(path.total, s));
  for(let i=1;i<pts.length;i++){
    if(s <= pts[i].cum + 1e-9 || i===pts.length-1){
      const a=pts[i-1], b=pts[i];
      const segLen = b.cum-a.cum;
      const t = segLen>1e-9 ? (s-a.cum)/segLen : 0;
      const dx=b.x-a.x, dz=b.z-a.z;
      const len = Math.hypot(dx,dz) || 1;
      return { x:a.x+dx*t, z:a.z+dz*t, dx:dx/len, dz:dz/len };
    }
  }
  const last = pts[pts.length-1];
  return { x:last.x, z:last.z, dx:1, dz:0 };
}
// 段境界(0..totalSteps)・各段の中点、経路本体をまとめて返す
function stairLayout(stair){
  const path = sampleStairPath(stair);
  const stepLen = path.total / stair.totalSteps;
  const boundaries = [];
  for(let k=0;k<=stair.totalSteps;k++) boundaries.push(stairPointAt(path, k*stepLen));
  const mids = [];
  for(let k=0;k<stair.totalSteps;k++) mids.push(stairPointAt(path, (k+0.5)*stepLen));
  return { path, stepLen, boundaries, mids };
}
const stairMat = new THREE.MeshStandardMaterial({color:0xcbb896, side:THREE.DoubleSide});
// depthTest:false にしない。階段の3D実体(groups_stairs)は俯瞰・平面図・内覧の全モードで
// 常時sceneに存在するため、他の「平面図の線画」用マテリアル(depthTest:false が前提)と違い、
// 内覧モードでは手前の壁越しに輪郭線が透けて見えてしまう(壁があるのに階段が見える不具合)。
const stairEdgeMat = new THREE.LineBasicMaterial({color:0x1a1a1a, transparent:true, opacity:1});
const stairPlanMat = new THREE.LineBasicMaterial({color:0x1a1a1a, transparent:true, opacity:0.85, depthTest:false});
// 階段の一部が、その階から見て「別の部屋の天井の上を素通りしている」区間（例：階段下収納の直上）に
// 使う破線マテリアル。建築図面で「上階の構造が下階の天井裏に隠れて見えない」ことを示す破線の慣習を模す
const stairPlanDashedMat = new THREE.LineDashedMaterial({color:0x1a1a1a, transparent:true, opacity:0.85, depthTest:false, dashSize:0.06, gapSize:0.05});
function inRect(x,z,r){ return !!r && x>=r.x0 && x<=r.x1 && z>=r.z0 && z<=r.z1; }
// pts(=[[x,z],...]の折れ線)を、hiddenRectの内側を通る区間だけ破線にして描画する
function addStairPlanLine(pts, baseY, grp, hiddenRect){
  for(let i=1;i<pts.length;i++){
    const [x0,z0]=pts[i-1], [x1,z1]=pts[i];
    const hidden = inRect((x0+x1)/2, (z0+z1)/2, hiddenRect);
    const [s0x,s0z]=toScene(x0,z0), [s1x,s1z]=toScene(x1,z1);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s0x,baseY+0.02,s0z), new THREE.Vector3(s1x,baseY+0.02,s1z)]);
    const line = new THREE.Line(geo, hidden ? stairPlanDashedMat : stairPlanMat);
    if(hidden) line.computeLineDistances();
    line.renderOrder = 3;
    grp.add(line);
  }
}
const groups_stairs = new THREE.Group(); scene.add(groups_stairs); // 常時表示（俯瞰・平面図・内覧いずれでも階段の実体を見せる）
STAIRS.forEach(stair=>{
  const baseY0 = stair.levelFrom===1 ? LEVELS.fl1 : LEVELS.fl2;
  const baseY1 = stair.levelTo===1 ? LEVELS.fl1 : LEVELS.fl2;
  const layout = stairLayout(stair);
  stair._layout = layout; stair._baseY0 = baseY0; stair._baseY1 = baseY1; // 内覧モードの歩行判定で再利用する
  const riser = (baseY1-baseY0)/stair.totalSteps;
  // 3Dの段差ジオメトリ（俯瞰・内覧共通の実体）
  layout.mids.forEach((p,k)=>{
    const angleY = Math.atan2(p.dx, p.dz);
    boxWireRotated(p.x, p.z, angleY, stair.width, layout.stepLen+0.01, baseY0+k*riser, baseY0+(k+1)*riser, stairMat, stairEdgeMat, groups_stairs, 2);
  });
  // 平面図の階段記号（踏み面の境界線＋左右の側線）。1F/2Fの両方の平面に表示する
  [ {floor:stair.levelFrom, baseY:baseY0, grp:(stair.levelFrom===1?groups.approx1:groups.approx2)},
    {floor:stair.levelTo,   baseY:baseY1, grp:(stair.levelTo===1?groups.approx1:groups.approx2)} ].forEach(({floor,baseY,grp})=>{
    // levelFrom側の平面でのみ、hiddenBelow（例：階段下収納の直上）の区間を破線にする。
    // levelTo側では階段全体がその階の実体そのものなので、常に実線
    const hiddenRect = (floor===stair.levelFrom) ? stair.hiddenBelow : null;
    const halfW = stair.width/2;
    const leftPts=[], rightPts=[];
    layout.boundaries.forEach(p=>{
      const px=-p.dz, pz=p.dx;
      const lx=p.x+px*halfW, lz=p.z+pz*halfW, rx=p.x-px*halfW, rz=p.z-pz*halfW;
      leftPts.push([lx,lz]); rightPts.push([rx,rz]);
      addStairPlanLine([[lx,lz],[rx,rz]], baseY, grp, hiddenRect);
    });
    addStairPlanLine(leftPts, baseY, grp, hiddenRect);
    addStairPlanLine(rightPts, baseY, grp, hiddenRect);
    // UP/DN矢印＋ラベル：levelFromの平面ではUP（下→上へ進む向き）、levelToの平面ではDN（上→下へ進む向き）
    const isUp = floor===stair.levelFrom;
    const dirLabel = isUp ? 'UP' : 'DN';
    const N = 24;
    const arrowPts = [];
    for(let i=0;i<=N;i++){
      const s = isUp ? layout.path.total*(i/N) : layout.path.total*(1-i/N);
      const p = stairPointAt(layout.path, s);
      arrowPts.push([p.x, p.z]);
    }
    addStairPlanLine(arrowPts, baseY, grp, hiddenRect);
    const tipS = isUp ? layout.path.total : 0;
    const tip = stairPointAt(layout.path, tipS);
    const sign = isUp ? 1 : -1;
    const tdx = tip.dx*sign, tdz = tip.dz*sign;
    const px = -tdz, pz = tdx;
    const headLen = 0.18;
    [1,-1].forEach(side=>{
      const bx = tip.x - tdx*headLen + px*headLen*0.5*side;
      const bz = tip.z - tdz*headLen + pz*headLen*0.5*side;
      addStairPlanLine([[tip.x,tip.z],[bx,bz]], baseY, grp, hiddenRect);
    });
    const labelS = isUp ? layout.path.total*0.1 : layout.path.total*0.9;
    const lp = stairPointAt(layout.path, labelS);
    const l = makeLabel(dirLabel, lp.x, baseY+0.3, lp.z, false);
    l.floor = floor;
    labels.push(l);
  });
});

// ---- ドア本体（開き勝手・引き込み方向の表現） ----
// orientation: 'H'=z一定の壁を横切る(沿い方向=x, 壁に直交する方向=z)、'V'=x一定の壁を横切る(沿い方向=z, 直交=x)
// outSign: 壁に直交する方向のうち、どちらが「外開き(swingDir:'out')」に対応するか（+1/-1）。
//   外部の窓・ドアはface(N/S/E/W)から一意に決まる。室内ドアは「外」の概念がないため+1固定（簡易表現）
// hingeSide/swingDir(開き戸) または slideDir(引き戸) が未確定(undefined)の場合は扉本体を描かない
// 開き戸1枚ぶんの扉本体（直線）と床面の開閉軌跡（円弧）を描画する。
// hingeAt=蝶番の位置（沿い方向の座標）、alongSign=蝶番から扉が閉位置で伸びる向き（+1/-1）、
// openSign=壁に直交する方向のうち扉が開く向き（+1/-1）、w=この1枚の扉の幅
function drawSwingLeaf({ orientation, hingeAt, alongSign, wallCoord, baseY, openSign, w, edgeMat, grp }){
  const n0 = wallCoord, n1 = wallCoord + openSign*w;
  // 開いた状態の扉本体は、枠（閉位置、ピンクの太い箱）とは区別し、開閉軌跡と同じ黒線・同じ太さの
  // 直線で表現する（boxWire()は内部でtoScene()により建物中心(CX,CZ)ぶん再センタリングしているため、
  // ここでも同じ変換を通してからVector3化すること。忘れると建物の外に散らばって表示される）
  const [lfx,lfz] = orientation==='H' ? toScene(hingeAt, n0) : toScene(n0, hingeAt);
  const [ltx,ltz] = orientation==='H' ? toScene(hingeAt, n1) : toScene(n1, hingeAt);
  const leafLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(lfx, baseY+0.01, lfz), new THREE.Vector3(ltx, baseY+0.01, ltz),
  ]), edgeMat);
  leafLine.renderOrder = 3;
  grp.add(leafLine);
  // 床面の開閉軌跡（0度=壁面に沿う閉位置 → 90度=壁に直交する開位置）
  const segs = 12, arcPts = [];
  for(let i=0;i<=segs;i++){
    const t = i/segs * Math.PI/2;
    const along = hingeAt + alongSign*w*Math.cos(t);
    const normal = wallCoord + openSign*w*Math.sin(t);
    const [sx,sz] = orientation==='H' ? toScene(along, normal) : toScene(normal, along);
    arcPts.push(new THREE.Vector3(sx, baseY+0.01, sz));
  }
  const arcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts), edgeMat);
  arcLine.renderOrder = 3;
  grp.add(arcLine);
}
// 折れ戸1組(2枚)の扉本体（ハの字に折れた2本の直線）を描画する。
// hingeAt=固定側蝶番の位置、alongSign=蝶番から自由端へ向かう沿い方向(+1/-1)、
// openSign=壁に直交する方向のうち折れ戸が張り出す向き(+1/-1)、w=この1組の開口幅
// 建具表の図記号を模し、自由端(C)は沿い方向にw/2進んだ壁面上の位置とし、
// 折れ点(B)はA-B=B-C=A-C(=w/2)の正三角形になる位置（壁から(w/2)*sin60°張り出す）に置く
function drawFoldLeaf({ orientation, hingeAt, alongSign, wallCoord, baseY, openSign, w, edgeMat, grp }){
  const side = w/2;
  const aAlong = hingeAt, aNormal = wallCoord;
  const cAlong = hingeAt + alongSign*side, cNormal = wallCoord;
  const bAlong = hingeAt + alongSign*side/2, bNormal = wallCoord + openSign*side*Math.sin(Math.PI/3);
  const [ax,az] = orientation==='H' ? toScene(aAlong, aNormal) : toScene(aNormal, aAlong);
  const [bx,bz] = orientation==='H' ? toScene(bAlong, bNormal) : toScene(bNormal, bAlong);
  const [cx,cz] = orientation==='H' ? toScene(cAlong, cNormal) : toScene(cNormal, cAlong);
  const leafLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(ax, baseY+0.01, az),
    new THREE.Vector3(bx, baseY+0.01, bz),
    new THREE.Vector3(cx, baseY+0.01, cz),
  ]), edgeMat);
  leafLine.renderOrder = 3;
  grp.add(leafLine);
}
// 引き戸は壁の片側の面を走る（data/interior-doors.json の slideSide。L＝座標の小さい側＝西・北、R＝大きい側＝東・南）。
// 指定のない外部の引き戸は今までどおり壁の線の上に描く
const slideSideOffset = side => side==='L' ? -.06 : side==='R' ? .06 : 0;
function addDoorLeaf({ orientation, alongFrom, alongTo, wallCoord, baseY, height, operation, hingeSide, swingDir, slideDir, slideSide, outSign=1, mat, edgeMat, grp }){
  const thick = 0.04;
  const w = alongTo - alongFrom;
  if(operation==='slide'){
    if(!slideDir) return;
    const shiftSign = slideDir==='L' ? -1 : 1;
    const a0 = alongFrom + shiftSign*w, a1 = alongTo + shiftSign*w, c = wallCoord + slideSideOffset(slideSide);
    if(orientation==='H') boxWire(a0, a1, baseY, baseY+height, c-thick/2, c+thick/2, mat, edgeMat, grp, 3);
    else boxWire(c-thick/2, c+thick/2, baseY, baseY+height, a0, a1, mat, edgeMat, grp, 3);
    return;
  }
  if(operation==='double-swing'){
    // 両開き戸：開口の両端(alongFrom/alongTo)それぞれを蝶番にした2枚の扉が、
    // 同じ方向(swingDir)へ左右対称に開く（建築図面の両開き戸記号と同じ見た目）
    if(!swingDir) return;
    const half = w/2;
    const openSign = swingDir==='out' ? outSign : -outSign;
    drawSwingLeaf({ orientation, hingeAt: alongFrom, alongSign: 1, wallCoord, baseY, openSign, w: half, edgeMat, grp });
    drawSwingLeaf({ orientation, hingeAt: alongTo, alongSign: -1, wallCoord, baseY, openSign, w: half, edgeMat, grp });
    return;
  }
  if(operation==='fold'){
    // 片開き折れ戸：開口の片側(hingeSide)を固定蝶番にした1組の折れ戸
    if(!hingeSide || !swingDir) return;
    const hingeAt = hingeSide==='L' ? alongFrom : alongTo;
    const alongSign = hingeSide==='L' ? 1 : -1;
    const openSign = swingDir==='out' ? outSign : -outSign;
    drawFoldLeaf({ orientation, hingeAt, alongSign, wallCoord, baseY, openSign, w, edgeMat, grp });
    return;
  }
  if(operation==='double-fold'){
    // 両開き折れ戸：開口の両端それぞれを固定蝶番にした2組の折れ戸
    if(!swingDir) return;
    const half = w/2;
    const openSign = swingDir==='out' ? outSign : -outSign;
    drawFoldLeaf({ orientation, hingeAt: alongFrom, alongSign: 1, wallCoord, baseY, openSign, w: half, edgeMat, grp });
    drawFoldLeaf({ orientation, hingeAt: alongTo, alongSign: -1, wallCoord, baseY, openSign, w: half, edgeMat, grp });
    return;
  }
  if(operation!=='swing' || !hingeSide || !swingDir) return;
  const hingeAt = hingeSide==='L' ? alongFrom : alongTo;
  const alongSign = hingeSide==='L' ? 1 : -1; // 閉じた状態で蝶番から扉が伸びる向き（沿い方向）
  const openSign = swingDir==='out' ? outSign : -outSign; // 開いた状態で扉が伸びる向き（壁に直交する方向）
  drawSwingLeaf({ orientation, hingeAt, alongSign, wallCoord, baseY, openSign, w, edgeMat, grp });
}

// ---- 開口（アーチ）の枠：天端が円弧の平板を1枚描画する ----
// 通常の枠(boxWire)は直方体だが、アーチはシンプルに「厚みのない平板」で表現する
// （door系マテリアルはside:DoubleSideのため、厚みがなくても両面から見える）。
// orientation別の回転はtoScene()の符号と合わせて事前に検証済み：
//   H: 回転なし、位置は toScene(沿い中心, wallCoord)
//   V: rotation.y=-90°、位置は toScene(wallCoord, 沿い中心)
// ドア本体を持たない開口（open-arch）のアーチ形シルエットを黒線のみで描く（open系と同じく
// ピンクの塗りつぶしは使わない。塗りつぶしありのMeshだと、この板は完全に鉛直＝平面図モードの
// 真上からの正投影ではほぼ真横向きになり、色を塗っても実質見えなくなってしまうため）
function archOpeningMesh({ orientation, alongFrom, alongTo, wallCoord, baseY, springHeight, archRise, edgeMat, grp }){
  const w = alongTo - alongFrom, hw = w/2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(-hw, springHeight);
  const segs = 16;
  for(let i=0;i<=segs;i++){
    const ang = Math.PI - (i/segs)*Math.PI; // PI(左端)→0(右端)
    shape.lineTo(hw*Math.cos(ang), springHeight + archRise*Math.sin(ang));
  }
  shape.lineTo(hw, 0);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
  const alongCenter = (alongFrom+alongTo)/2;
  if(orientation==='H'){
    const [sx,sz] = toScene(alongCenter, wallCoord);
    edges.position.set(sx, baseY, sz);
  } else {
    edges.rotation.y = -Math.PI/2;
    const [sx,sz] = toScene(wallCoord, alongCenter);
    edges.position.set(sx, baseY, sz);
  }
  edges.renderOrder = 3.5;
  grp.add(edges);
}

// ---- 窓・ドアの配置編集（第2段階）：diffだけをlocalStorageに保存する（家具編集と同じ考え方） ----
// OPENINGS/INTERIOR_DOORS（生成データ）はこのセッションでは書き換えず、差分を
// doorWindowEdits に持ち、effectiveOpening()/effectiveInteriorDoor() で重ねて描画する。
const DOOR_WINDOW_EDITS_KEY = 'ryuka-door-window-edits-v1';
let doorWindowEdits = {};
try { doorWindowEdits = JSON.parse(localStorage.getItem(DOOR_WINDOW_EDITS_KEY) || '{}') || {}; } catch(e){ doorWindowEdits = {}; }
function saveDoorWindowEdits(){ try{ localStorage.setItem(DOOR_WINDOW_EDITS_KEY, JSON.stringify(doorWindowEdits)); } catch(e){} }
function cleanupHandFields(eff){
  // typeを切り替えた際、旧operationのhingeSide/swingDir/slideDirが残っていても
  // 現在のoperationに合わないものは無視する（addDoorLeafの分岐と矛盾しないように）
  if(eff.operation==='swing' || eff.operation==='fold'){ delete eff.slideDir; delete eff.slideSide; }
  else if(eff.operation==='double-swing' || eff.operation==='double-fold'){ delete eff.hingeSide; delete eff.slideDir; delete eff.slideSide; }
  else if(eff.operation==='slide'){ delete eff.hingeSide; delete eff.swingDir; }
  else { delete eff.hingeSide; delete eff.swingDir; delete eff.slideDir; delete eff.slideSide; }
  return eff;
}
function effectiveOpening(item){ const e = doorWindowEdits[item.id]; return cleanupHandFields(e ? {...item, ...e} : {...item}); }
function effectiveInteriorDoor(item){ const e = doorWindowEdits[item.id]; return cleanupHandFields(e ? {...item, ...e} : {...item}); }
// 保存済みの窓編集も、最初の内覧から壁の穴とガラスに反映する。
if(OPENINGS.some(o=>o.category!=='door' && doorWindowEdits[o.id])){
  [1,2].forEach(level=> rebuildWalkWalls(level));
}
function findDoorWindowBase(id){
  const o = OPENINGS.find(x=>x.id===id);
  if(o) return { base:o, isExterior:true };
  const d = INTERIOR_DOORS.find(x=>x.id===id);
  if(d) return { base:d, isExterior:false };
  return null;
}
// 壁線スライドの可動範囲。室内ドアはWALLS（重複統合済みの壁芯データ）、外部の窓・ドアは
// footprints（求積図のゾーン区分）から、対応する壁の区間を求める（tests/validate_openings.pyと同じ考え方）
function wallRangeForInteriorDoor(d){
  for(const w of WALLS){
    if(w.level!==d.floor || w.orientation!==d.orientation) continue;
    if(d.orientation==='H' && Math.abs(w.z0-d.wallAt)<0.01) return [w.x0, w.x1];
    if(d.orientation==='V' && Math.abs(w.x0-d.wallAt)<0.01) return [w.z0, w.z1];
  }
  return null;
}
function levelZRange(level){
  const arr = level===2 ? [FLOOR2] : FLOOR1;
  return [Math.min(...arr.map(f=>f.z0)), Math.max(...arr.map(f=>f.z1))];
}
function wallRangeForOpening(o){
  if(o.face==='N' || o.face==='S'){
    const current = o.level===2 ? FLOOR2 : segAtX(o.lx);
    // footprintは求積図のゾーン区分であり、隣接区画が同じ辺(z0/z1)を共有していれば
    // 実際には1本の連続した壁であることが多い（tests/validate_openings.pyの
    // check_opening_within_footprintと同じ考え方）。現在の区画だけで範囲を区切ると、
    // 区画の継ぎ目(例:x=9.100)を越えた瞬間に可動範囲が切り替わり、越えた側から
    // 元の区画側へドラッグで戻れなくなる「片道の罠」になるため、同じ辺を共有し
    // x方向に隙間なくつながっている区画をすべて合わせた範囲を返す。
    const edgeKey = o.face==='N' ? 'z0' : 'z1';
    const arr = o.level===2 ? [FLOOR2] : FLOOR1;
    const candidates = arr.filter(f => Math.abs(f[edgeKey]-current[edgeKey])<0.01);
    let x0 = current.x0, x1 = current.x1, changed = true;
    while(changed){
      changed = false;
      for(const f of candidates){
        if(Math.abs(f.x1-x0)<0.01 && f.x0<x0){ x0=f.x0; changed=true; }
        if(Math.abs(f.x0-x1)<0.01 && f.x1>x1){ x1=f.x1; changed=true; }
      }
    }
    return [x0, x1];
  }
  return levelZRange(o.level); // E/W面はfootprintの厳密な壁単位までは分解していないため、階全体のz範囲でゆるく制約する
}

const doorWindowMeshes = new Map(); // id -> { holder, isExterior }
// 斜め壁（orientation:'D'）の開口。今のところ door-open/door-open-arch のような
// 「扉本体を持たない」種類のみを想定し、開き戸・引き戸の軌跡計算は行わない。
// H/V専用のwallRangeForInteriorDoor()・moveSelectedDoorWindowTo()の対象外（壁線
// スライド編集はサポートしない。位置を変える場合はJSONを直接編集すること）。
function placeDiagonalInteriorDoor(d){
  const baseY = d.floor===1 ? LEVELS.fl1 : LEVELS.fl2;
  const mats = d.floor===1 ? M1 : M2;
  const grp = d.floor===1 ? groups.doors1 : groups.doors2;
  const holder = new THREE.Group();
  holder.userData.doorWindowId = d.id;
  const dx = d.x1-d.x0, dz = d.z1-d.z0;
  const len = Math.hypot(dx, dz);
  const theta = Math.atan2(-dz, dx); // toScene()は平行移動のみのため、建物ローカルの向きがそのままシーンの向きになる
  const thick = 0.06;
  const geo = new THREE.BoxGeometry(len, d.height, thick);
  // ドア本体を持たない開口(door-open系)であることを示すため、ドア色(ピンク)の
  // 塗りつぶしは使わず、通常の開口と同じ黒い枠線だけで表現する
  const [sx,sz] = toScene((d.x0+d.x1)/2, (d.z0+d.z1)/2);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mats.doorEdge);
  edges.position.set(sx, baseY+d.height/2, sz);
  edges.rotation.y = theta;
  edges.renderOrder = 3.5;
  holder.add(edges);
  grp.add(holder);
  const len2 = len || 1; // ゼロ除算防止（実データでは起こらないが念のため）
  doorWindowMeshes.set(d.id, { holder, isExterior:false, level: d.floor,
    probe: { orientation:'D', midX:(d.x0+d.x1)/2, midZ:(d.z0+d.z1)/2, perpX:-dz/len2, perpZ:dx/len2 } });
}
function placeInteriorDoor(d){
  if(d.orientation==='D') return placeDiagonalInteriorDoor(d);
  const baseY = d.floor===1 ? LEVELS.fl1 : LEVELS.fl2;
  const mats = d.floor===1 ? M1 : M2;
  const grp = d.floor===1 ? groups.doors1 : groups.doors2;
  const holder = new THREE.Group();
  holder.userData.doorWindowId = d.id;
  const thick = 0.06;
  let x0,x1,z0,z1;
  if(d.orientation==='H'){ // z一定の壁を横切る -> x方向に開口幅
    x0 = d.center - d.width/2; x1 = d.center + d.width/2;
    z0 = d.wallAt - thick/2; z1 = d.wallAt + thick/2;
  } else { // 'V': x一定の壁を横切る -> z方向に開口幅
    x0 = d.wallAt - thick/2; x1 = d.wallAt + thick/2;
    z0 = d.center - d.width/2; z1 = d.center + d.width/2;
  }
  if(d.operation==='open-arch'){
    // 平面図モード（真上からの正投影）ではアーチの板自体がほぼ真横向きになり見えなくなるため、
    // 視認性確保用の枠線を重ねる。ただしアーチ本体と同じ高さの箱にすると、springHeightより上の
    // 箱の角がアーチの外側にはみ出して見えてしまうため、床面近くの薄い箱に留める
    // （＝真上から見た範囲は同じだが、俯瞰・内覧ではアーチの輪郭だけが見えるようにする）
    const markerH = 0.05;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x1-x0, markerH, z1-z0)), mats.doorEdge);
    const [ecx,ecz] = toScene((x0+x1)/2, (z0+z1)/2);
    edges.position.set(ecx, baseY+markerH/2, ecz);
    edges.renderOrder = 3.5;
    holder.add(edges);
    const archRise = DOOR_WINDOW_CATALOG[d.type].archRise;
    archOpeningMesh({
      orientation: d.orientation, alongFrom: d.center-d.width/2, alongTo: d.center+d.width/2, wallCoord: d.wallAt,
      baseY, springHeight: d.height-archRise, archRise, edgeMat: mats.doorEdge, grp: holder,
    });
  } else if(d.operation==='open'){
    // ドア本体を持たない開口(door-open)は、斜め框の開口と同じく、ドア色(ピンク)の
    // 塗りつぶしは使わず黒い枠線だけで表現する（実際にドアが設置されていると誤解しないように）
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x1-x0, d.height, z1-z0)), mats.doorEdge);
    const [ecx,ecz] = toScene((x0+x1)/2, (z0+z1)/2);
    edges.position.set(ecx, baseY+d.height/2, ecz);
    edges.renderOrder = 3.5;
    holder.add(edges);
  } else {
    boxWire(x0, x1, baseY, baseY+d.height, z0, z1, mats.door, mats.doorEdge, holder, 3);
  }
  addDoorLeaf({
    orientation: d.orientation, alongFrom: d.center-d.width/2, alongTo: d.center+d.width/2, wallCoord: d.wallAt,
    baseY, height: d.height, operation: d.operation, hingeSide: d.hingeSide, swingDir: d.swingDir, slideDir: d.slideDir, slideSide: d.slideSide,
    mat: mats.door, edgeMat: mats.doorEdge, grp: holder,
  });
  grp.add(holder);
  doorWindowMeshes.set(d.id, { holder, isExterior:false, level: d.floor,
    probe: { orientation: d.orientation, center: d.center, wallAt: d.wallAt } });
}
function placeOpening(o){
  const baseFl = (o.level===2) ? LEVELS.fl2 : LEVELS.fl1;
  const y0 = baseFl + o.sill, y1 = y0 + o.h;
  const mats = (o.level===2) ? M2 : M1;
  const grp = (o.level===2) ? groups.openings2 : groups.openings1;
  const holder = new THREE.Group();
  holder.userData.doorWindowId = o.id;
  let x0,x1,z0,z1, orientation, alongFrom, alongTo, wallCoord, outSign;
  if(o.face==='N'){
    const seg = o.level===2 ? FLOOR2 : segAtX(o.lx);
    x0=o.lx; x1=o.lx+o.w; z0=seg.z0-0.03; z1=seg.z0+0.03;
    orientation='H'; alongFrom=o.lx; alongTo=o.lx+o.w; wallCoord=seg.z0; outSign=-1; // 北壁の外側は-z方向
  } else if(o.face==='S'){
    const seg = o.level===2 ? FLOOR2 : segAtX(o.lx);
    x0=o.lx; x1=o.lx+o.w; z0=seg.z1-0.03; z1=seg.z1+0.03;
    orientation='H'; alongFrom=o.lx; alongTo=o.lx+o.w; wallCoord=seg.z1; outSign=1; // 南壁の外側は+z方向
  } else if(o.face==='E'){
    const wallX = o.x!==undefined ? o.x : 19.110;
    x0=wallX-0.03; x1=wallX+0.03; z0=o.lz; z1=o.lz+o.w;
    orientation='V'; alongFrom=o.lz; alongTo=o.lz+o.w; wallCoord=wallX; outSign=1; // 東壁の外側は+x方向
  } else { // W
    const wallX = o.x!==undefined ? o.x : 0;
    x0=wallX-0.03; x1=wallX+0.03; z0=o.lz; z1=o.lz+o.w;
    orientation='V'; alongFrom=o.lz; alongTo=o.lz+o.w; wallCoord=wallX; outSign=-1; // 西壁の外側は-x方向
  }
  const mat = (o.category==='door') ? mats.extDoor : mats.opening;
  if(o.category==='door' && o.operation==='open-arch'){
    // 平面図モードではアーチの板自体がほぼ見えなくなるため、視認性確保用の枠線を重ねる。
    // アーチ本体と同じ高さの箱にするとspringHeightより上の角がはみ出して見えるため、
    // 床面近くの薄い箱に留める（俯瞰・内覧ではアーチの輪郭だけが見えるようにする）
    const markerH = 0.05;
    const edges0 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x1-x0, markerH, z1-z0)), mats.doorEdge);
    const [ecx,ecz] = toScene((x0+x1)/2, (z0+z1)/2);
    edges0.position.set(ecx, y0+markerH/2, ecz);
    edges0.renderOrder = 3.5;
    holder.add(edges0);
    const archRise = DOOR_WINDOW_CATALOG[o.type].archRise;
    archOpeningMesh({
      orientation, alongFrom, alongTo, wallCoord, baseY: y0, springHeight: o.h-archRise, archRise,
      edgeMat: mats.doorEdge, grp: holder,
    });
  } else if(o.category==='door' && o.operation==='open'){
    // ドア本体を持たない開口(door-open)は、ドア色(ピンク)の塗りつぶしは使わず黒い枠線だけで表現する
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x1-x0, y1-y0, z1-z0)), mats.doorEdge);
    const [ecx,ecz] = toScene((x0+x1)/2, (z0+z1)/2);
    edges.position.set(ecx, (y0+y1)/2, ecz);
    edges.renderOrder = 3.5;
    holder.add(edges);
  } else {
    boxWire(x0,x1,y0,y1,z0,z1, mat, null, holder, 3);
  }
  if(o.category==='door'){
    addDoorLeaf({
      orientation, alongFrom, alongTo, wallCoord, baseY: baseFl, height: o.h, outSign, operation: o.operation,
      hingeSide: o.hingeSide, swingDir: o.swingDir, slideDir: o.slideDir,
      mat: mats.extDoor, edgeMat: mats.doorEdge, grp: holder,
    });
  }
  grp.add(holder);
  doorWindowMeshes.set(o.id, { holder, isExterior:true, level: o.level,
    probe: { orientation, alongMid:(alongFrom+alongTo)/2, wallCoord, outSign } });
}
function removeDoorWindowMesh(id){
  const entry = doorWindowMeshes.get(id);
  if(!entry) return;
  if(entry.holder.parent) entry.holder.parent.remove(entry.holder);
  doorWindowMeshes.delete(id);
}
function rebuildDoorWindow(id, isExterior){
  const sel = findDoorWindowBase(id);
  if(!sel) return;
  removeDoorWindowMesh(id);
  if(isExterior){
    placeOpening(effectiveOpening(sel.base));
    if(sel.base.category!=='door') rebuildWalkWalls(sel.base.level);
  }
  else placeInteriorDoor(effectiveInteriorDoor(sel.base));
}
INTERIOR_DOORS.forEach(d=> placeInteriorDoor(effectiveInteriorDoor(d)));
OPENINGS.forEach(o=> placeOpening(effectiveOpening(o)));
// ニッチの印（俯瞰・平面図。窓と同じグループなので内覧では隠れる）：くぼみの範囲を開く面から奥まで
const nicheMarkMat = new THREE.MeshBasicMaterial({color:0x2a9d8f, transparent:true, opacity:0.6, side:THREE.DoubleSide, depthWrite:false});
NICHES.forEach(base=>{
  const n = nicheGapsForLevel(base.level).find(x=>x.id===base.id);
  const open = n.at + n.side*INTERIOR_WALL_T/2, back = open - n.side*n.depth;
  nicheBoxWire(n, [n.from, n.to, Math.min(open, back), Math.max(open, back), n.sill, n.sill+n.h],
    n.level===1 ? LEVELS.fl1 : LEVELS.fl2, nicheMarkMat, (n.level===1 ? M1 : M2).doorEdge,
    n.level===1 ? groups.openings1 : groups.openings2, 3);
});

// ============================================================================
// 内覧モード：ドアの扉本体（近づくと開く演出）
// ============================================================================
// 平面図モードのドア記号（groups.doors1/2・groups.openings1/2）は内覧モードでは
// 非表示にしている（enterWalkMode()参照）。代わりにここで、実際に厚みのある
// 扉パネルを閉位置で常設し、プレイヤーが近づくと開き、離れると閉じる演出をする。
// 施主指示により、これはあくまで見た目の演出であり、通行そのものは扉の開閉状態に
// 関わらず今まで通り可能（壁側の開口はdoorGapsForLevel()で常に開いている）。
const walkDoorMat = new THREE.MeshStandardMaterial({color:0xd9c9a3, side:THREE.DoubleSide});
const walkDoorEdgeMat = new THREE.LineBasicMaterial({color:0x2a2a2a});
const WALK_DOOR_OPEN_RADIUS = 1.8; // この距離(m)以内に近づくと開き始める
const WALK_DOOR_ANIM_SPEED = 4; // 開閉のイージング速度（大きいほど素早く開閉する）
const walkDoorAnimators = []; // {group, kind:'rotate'|'fold'|'slide', kindごとの角度/オフセット情報, anchorX, anchorZ, level, t}

// ローカルZ+方向がワールド上どちらを向くか、という角度（boxWireRotated等と同じ規約：
// rotation.y=θでローカル+Zはワールド(sinθ,cosθ)方向を向く）
function angleForDir(dx, dz){ return Math.atan2(dx, dz); }
// 2つの角度の差が180度を超えないよう最短経路で補間する（そのまま線形補間すると
// 蝶番側と開く向きの組み合わせによっては270度回転する遠回りになってしまうため）
function shortAngleLerp(a, b, t){
  let d = b - a;
  while(d > Math.PI) d -= Math.PI*2;
  while(d < -Math.PI) d += Math.PI*2;
  return a + d*t;
}
function makeWalkDoorLeafMesh(width, height, thick){
  const geo = new THREE.BoxGeometry(thick, height, width);
  const mesh = new THREE.Mesh(geo, walkDoorMat);
  mesh.position.set(0, height/2, width/2); // 蝶番側の端(ローカルZ=0)を原点に、+Z方向へ扉が伸びる
  const group = new THREE.Group();
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), walkDoorEdgeMat);
  edges.position.copy(mesh.position);
  group.add(edges);
  return group;
}
// 開き戸・折れ戸1枚ぶんの扉本体を作る（回転して開閉する）。hingeAt=蝶番の位置(沿い方向の座標)、
// alongSign=蝶番から扉が閉位置で伸びる向き、openSign=開いた状態で扉が伸びる向き（addDoorLeaf/
// drawSwingLeafと同じ規約）
function addWalkSwingLeaf(orientation, hingeAt, alongSign, wallCoord, baseY, height, w, thick, openSign, level, anchorX, anchorZ){
  const group = makeWalkDoorLeafMesh(w, height, thick);
  const [sx,sz] = orientation==='H' ? toScene(hingeAt, wallCoord) : toScene(wallCoord, hingeAt);
  group.position.set(sx, baseY, sz);
  const closedDir = orientation==='H' ? [alongSign, 0] : [0, alongSign];
  const openDir = orientation==='H' ? [0, openSign] : [openSign, 0];
  const thetaClosed = angleForDir(closedDir[0], closedDir[1]);
  const thetaOpen = angleForDir(openDir[0], openDir[1]);
  group.rotation.y = thetaClosed;
  walkGroup.add(group);
  walkDoorAnimators.push({ group, kind:'rotate', thetaClosed, thetaOpen, level, anchorX, anchorZ, t:0 });
}
// 折れ戸1組（2枚）の扉本体を作る。蝶番(A)は壁に固定、自由端(C)は沿い方向に壁面上を
// スライドする、という実際の折れ戸の機構をそのまま再現する。パネル1(A-B)はhingeAtを
// 中心に回転し、パネル2(B-C)はその子として折れ点Bに追従しつつ、パネル1に対して
// 逆向きに2倍の角度で回転する（＝鏡映の関係）。これにより自由端Cは常に壁面上
// （沿い方向の直線上）に留まり、かつ折れ点Bだけが壁から張り出す
function addWalkFoldLeaf(orientation, hingeAt, alongSign, wallCoord, baseY, height, w, thick, openSign, level, anchorX, anchorZ){
  const L = w/2; // パネル1枚ぶんの長さ
  const panel1 = makeWalkDoorLeafMesh(L, height, thick);
  const elbow = new THREE.Group();
  elbow.position.set(0, 0, L); // 折れ点(B)＝パネル1の自由端の位置（ローカル座標）
  const panel2 = makeWalkDoorLeafMesh(L, height, thick);
  elbow.add(panel2);
  const foldGroup = new THREE.Group();
  foldGroup.add(panel1);
  foldGroup.add(elbow);
  const [sx,sz] = orientation==='H' ? toScene(hingeAt, wallCoord) : toScene(wallCoord, hingeAt);
  foldGroup.position.set(sx, baseY, sz);
  const closedDir = orientation==='H' ? [alongSign, 0] : [0, alongSign];
  const openDir = orientation==='H' ? [0, openSign] : [openSign, 0];
  const thetaClosed = angleForDir(closedDir[0], closedDir[1]);
  const thetaFullOpen = angleForDir(openDir[0], openDir[1]);
  let d = thetaFullOpen - thetaClosed;
  while(d > Math.PI) d -= Math.PI*2;
  while(d < -Math.PI) d += Math.PI*2;
  // 平面図の折れ戸記号（drawFoldLeaf）は、A-B=B-C=A-C(=w/2)の正三角形になる位置
  // （壁からsin60°ぶん張り出す）を「開いた」状態として描いている。これはパネルが
  // 壁面から60度だけ回転した状態に相当する（closedDirとopenDirは直角なので、
  // 全開(90度=openDirそのもの)に対して2/3だけ回転させると60度になる）。
  // 内覧モードのアニメーションも同じ角度を終点にし、平面図と見た目を揃える
  const FOLD_OPEN_FRACTION = 2/3;
  const panel1DeltaOpen = d * FOLD_OPEN_FRACTION;
  const panel2LocalDeltaOpen = -2 * panel1DeltaOpen; // パネル2はパネル1に対して逆向きに2倍回転（鏡映）
  foldGroup.rotation.y = thetaClosed;
  walkGroup.add(foldGroup);
  walkDoorAnimators.push({
    group: foldGroup, elbow, kind:'fold', thetaClosed, panel1DeltaOpen, panel2LocalDeltaOpen,
    level, anchorX, anchorZ, t:0,
  });
}
// 引き戸1枚の扉本体を作る（沿い方向にスライドして開閉する）
function addWalkSlideLeaf(orientation, alongFrom, alongTo, wallCoord, baseY, height, thick, slideDir, level, anchorX, anchorZ, slideSide){
  const w = alongTo - alongFrom;
  const alongCenter = (alongFrom+alongTo)/2;
  const geo = orientation==='H' ? new THREE.BoxGeometry(w, height, thick) : new THREE.BoxGeometry(thick, height, w);
  const mesh = new THREE.Mesh(geo, walkDoorMat);
  const group = new THREE.Group();
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), walkDoorEdgeMat);
  group.add(edges);
  const c = wallCoord + slideSideOffset(slideSide);
  const [sx,sz] = orientation==='H' ? toScene(alongCenter, c) : toScene(c, alongCenter);
  group.position.set(sx, baseY+height/2, sz);
  walkGroup.add(group);
  const shiftSign = slideDir==='L' ? -1 : 1;
  walkDoorAnimators.push({
    group, kind:'slide', orientation, baseX:sx, baseZ:sz, closedOffset:0, openOffset:shiftSign*w,
    level, anchorX, anchorZ, t:0,
  });
}
// addDoorLeaf()と同じoperation別の分岐で、内覧モード用の実体を追加する
function addWalkDoorLeaves({ orientation, alongFrom, alongTo, wallCoord, baseY, height, operation, hingeSide, swingDir, slideDir, slideSide, outSign=1, level }){
  if(!['swing','fold','double-swing','double-fold','slide'].includes(operation)) return; // open系・窓は扉本体なし
  const w = alongTo - alongFrom;
  const thick = 0.04;
  const [anchorX, anchorZ] = orientation==='H' ? [(alongFrom+alongTo)/2, wallCoord] : [wallCoord, (alongFrom+alongTo)/2];
  if(operation==='slide'){
    if(!slideDir) return;
    addWalkSlideLeaf(orientation, alongFrom, alongTo, wallCoord, baseY, height, thick, slideDir, level, anchorX, anchorZ, slideSide);
    return;
  }
  if(operation==='double-swing'){
    if(!swingDir) return;
    const half = w/2;
    const openSign = swingDir==='out' ? outSign : -outSign;
    addWalkSwingLeaf(orientation, alongFrom, 1, wallCoord, baseY, height, half, thick, openSign, level, anchorX, anchorZ);
    addWalkSwingLeaf(orientation, alongTo, -1, wallCoord, baseY, height, half, thick, openSign, level, anchorX, anchorZ);
    return;
  }
  if(operation==='double-fold'){
    if(!swingDir) return;
    const half = w/2;
    const openSign = swingDir==='out' ? outSign : -outSign;
    addWalkFoldLeaf(orientation, alongFrom, 1, wallCoord, baseY, height, half, thick, openSign, level, anchorX, anchorZ);
    addWalkFoldLeaf(orientation, alongTo, -1, wallCoord, baseY, height, half, thick, openSign, level, anchorX, anchorZ);
    return;
  }
  if(!hingeSide || !swingDir) return; // swing/fold
  const hingeAt = hingeSide==='L' ? alongFrom : alongTo;
  const alongSign = hingeSide==='L' ? 1 : -1;
  const openSign = swingDir==='out' ? outSign : -outSign;
  if(operation==='fold'){
    addWalkFoldLeaf(orientation, hingeAt, alongSign, wallCoord, baseY, height, w, thick, openSign, level, anchorX, anchorZ);
    return;
  }
  addWalkSwingLeaf(orientation, hingeAt, alongSign, wallCoord, baseY, height, w, thick, openSign, level, anchorX, anchorZ);
}
INTERIOR_DOORS.forEach(d=>{
  if(d.orientation==='D') return; // 斜め壁は対象外（wallAt/centerを持たないため）
  const eff = effectiveInteriorDoor(d);
  addWalkDoorLeaves({
    orientation: eff.orientation, alongFrom: eff.center-eff.width/2, alongTo: eff.center+eff.width/2, wallCoord: eff.wallAt,
    baseY: eff.floor===1 ? LEVELS.fl1 : LEVELS.fl2, height: eff.height, operation: eff.operation,
    hingeSide: eff.hingeSide, swingDir: eff.swingDir, slideDir: eff.slideDir, slideSide: eff.slideSide, level: eff.floor,
  });
});
OPENINGS.forEach(o=>{
  if(o.category!=='door') return;
  const eff = effectiveOpening(o);
  const baseFl = eff.level===2 ? LEVELS.fl2 : LEVELS.fl1;
  let orientation, alongFrom, alongTo, wallCoord, outSign;
  if(eff.face==='N'){
    const seg = eff.level===2 ? FLOOR2 : segAtX(eff.lx);
    orientation='H'; alongFrom=eff.lx; alongTo=eff.lx+eff.w; wallCoord=seg.z0; outSign=-1;
  } else if(eff.face==='S'){
    const seg = eff.level===2 ? FLOOR2 : segAtX(eff.lx);
    orientation='H'; alongFrom=eff.lx; alongTo=eff.lx+eff.w; wallCoord=seg.z1; outSign=1;
  } else if(eff.face==='E'){
    const wallX = eff.x!==undefined ? eff.x : 19.110;
    orientation='V'; alongFrom=eff.lz; alongTo=eff.lz+eff.w; wallCoord=wallX; outSign=1;
  } else {
    const wallX = eff.x!==undefined ? eff.x : 0;
    orientation='V'; alongFrom=eff.lz; alongTo=eff.lz+eff.w; wallCoord=wallX; outSign=-1;
  }
  addWalkDoorLeaves({
    orientation, alongFrom, alongTo, wallCoord, baseY: baseFl, height: eff.h, operation: eff.operation,
    hingeSide: eff.hingeSide, swingDir: eff.swingDir, slideDir: eff.slideDir, outSign, level: eff.level,
  });
});
// 毎フレーム、プレイヤーとの距離に応じて開閉度(t: 0=閉,1=開)をなめらかに近づける
function updateWalkDoors(dt){
  walkDoorAnimators.forEach(a=>{
    if(a.level !== walkLevel){ a.t = 0; } // 別の階にいる間は開閉演出を進めない（閉位置に戻す）
    else {
      const dist = Math.hypot(walkPos.x - a.anchorX, walkPos.z - a.anchorZ);
      const target = dist < WALK_DOOR_OPEN_RADIUS ? 1 : 0;
      a.t += (target - a.t) * Math.min(1, dt * WALK_DOOR_ANIM_SPEED);
    }
    if(a.kind==='rotate'){
      a.group.rotation.y = shortAngleLerp(a.thetaClosed, a.thetaOpen, a.t);
    } else if(a.kind==='fold'){
      a.group.rotation.y = a.thetaClosed + a.panel1DeltaOpen * a.t;
      a.elbow.rotation.y = a.panel2LocalDeltaOpen * a.t;
    } else {
      const offset = a.closedOffset + (a.openOffset - a.closedOffset) * a.t;
      a.group.position.x = a.baseX + (a.orientation==='H' ? offset : 0);
      a.group.position.z = a.baseZ + (a.orientation==='H' ? 0 : offset);
    }
  });
  updateWalkCurtains(dt);
}
// 収納のカーテン：ドアと同じ距離まで近づくと布が束ねられて開き、離れると閉じる。
// 束ねた幅（閉じたときの幅に対する割合）と、束ねたときに厚みが増える分。見た目の演出で、通行には関係しない
const CURTAIN_OPEN_WIDTH_RATIO = 0.22;
const CURTAIN_OPEN_DEPTH_RATIO = 1.45;
function setCurtainOpenness(holder, t){
  const cloth = holder.userData.curtainCloth, w = holder.userData.curtainWidth;
  const sx = 1 + (CURTAIN_OPEN_WIDTH_RATIO - 1) * t;
  cloth.scale.set(sx, 1, 1 + (CURTAIN_OPEN_DEPTH_RATIO - 1) * t);
  cloth.position.x = (w/2) * (1 - sx); // +x側の端を固定して、そこへ布を寄せる
}
function updateWalkCurtains(dt){
  furnitureMeshes.forEach(({holder})=>{
    const c = holder.userData.curtain;
    if(!c) return;
    const target = (c.level===walkLevel && Math.hypot(walkPos.x - c.x, walkPos.z - c.z) < WALK_DOOR_OPEN_RADIUS) ? 1 : 0;
    let next = c.t + (target - c.t) * Math.min(1, dt * WALK_DOOR_ANIM_SPEED);
    if(Math.abs(next - target) < 1e-3) next = target;
    if(next !== c.t){ c.t = next; setCurtainOpenness(holder, next); }
  });
}
function resetWalkCurtains(){
  furnitureMeshes.forEach(({holder})=>{
    const c = holder.userData.curtain;
    if(c && c.t!==0){ c.t = 0; setCurtainOpenness(holder, 0); }
  });
}

// ---- 窓・ドア編集：選択・壁線スライド ----
function pickDoorWindowAt(clientX, clientY){
  editRaycaster.setFromCamera(ndcFromClient(clientX, clientY), editCam());
  const hits = editRaycaster.intersectObjects([openingsAll, doorsAll], true);
  for(const hit of hits){
    if(!isEffectivelyVisible(hit.object)) continue;
    let obj = hit.object;
    while(obj){
      if(obj.userData && obj.userData.doorWindowId) return obj.userData.doorWindowId;
      obj = obj.parent;
    }
  }
  return null;
}
function selectDoorWindow(id){
  selectedDoorWindowId = id;
  if(doorSelectionHelper){ scene.remove(doorSelectionHelper); doorSelectionHelper = null; }
  if(id){
    const entry = doorWindowMeshes.get(id);
    if(entry){
      doorSelectionHelper = new THREE.BoxHelper(entry.holder, 0xffcf3a);
      doorSelectionHelper.renderOrder = 10;
      scene.add(doorSelectionHelper);
    }
  }
  updateDoorPanel();
}
function moveSelectedDoorWindowTo(clientX, clientY){
  if(!selectedDoorWindowId) return;
  const sel = findDoorWindowBase(selectedDoorWindowId);
  if(!sel) return;
  const p = groundPointAt(clientX, clientY, dragPlaneY);
  if(!p) return;
  if(sel.isExterior){
    const eff = effectiveOpening(sel.base);
    const range = wallRangeForOpening(eff);
    const alongIsX = (eff.face==='N' || eff.face==='S');
    let along = alongIsX ? (p.x+CX) : (p.z+CZ);
    const halfW = eff.w/2;
    if(range) along = Math.min(Math.max(along, range[0]+halfW), range[1]-halfW);
    const field = alongIsX ? 'lx' : 'lz';
    doorWindowEdits[selectedDoorWindowId] = {...(doorWindowEdits[selectedDoorWindowId]||{}), [field]: round2(along-halfW)};
  } else {
    const eff = effectiveInteriorDoor(sel.base);
    if(eff.orientation==='D') return; // 斜め壁は壁線スライド編集の対象外
    const range = wallRangeForInteriorDoor(eff);
    const alongIsX = eff.orientation==='H';
    let along = alongIsX ? (p.x+CX) : (p.z+CZ);
    const halfW = eff.width/2;
    if(range) along = Math.min(Math.max(along, range[0]+halfW), range[1]-halfW);
    doorWindowEdits[selectedDoorWindowId] = {...(doorWindowEdits[selectedDoorWindowId]||{}), center: round2(along)};
  }
  rebuildDoorWindow(selectedDoorWindowId, sel.isExterior);
  selectDoorWindow(selectedDoorWindowId);
  updateDoorPanel();
  updateDoorBar();
}
function setDoorEditMode(on){
  doorEditMode = on;
  if(!on){ selectDoorWindow(null); draggingDoorWindow=false; }
  else {
    setEditMode(false); // 家具編集・窓ドア編集・電気設備編集は三者択一で排他
    setElectricalEditMode(false);
    openingsAll.visible = true;
    doorsAll.visible = true;
  }
  document.getElementById('doorEditToggle').classList.toggle('active', doorEditMode);
  document.getElementById('doorPanel').style.display = (doorEditMode && selectedDoorWindowId) ? 'block' : 'none';
  document.getElementById('doorEditHint').style.display = doorEditMode ? 'block' : 'none';
  document.getElementById('doorBar').style.display = doorEditMode ? 'flex' : 'none';
}

// ---- 窓・ドア編集パネルの表示・操作 ----
function doorFieldKey(logicalField, isExterior){
  if(logicalField==='sill') return isExterior ? 'sill' : null;
  if(isExterior) return logicalField==='width' ? 'w' : 'h';
  return logicalField; // 室内ドアは width/height のまま
}
function renderHandControls(eff){
  const area = document.getElementById('dpHandArea');
  if(eff.operation==='swing' || eff.operation==='fold'){
    area.innerHTML = `
      <div class="hand-label">蝶番側</div>
      <div class="hand-row"><button data-hand="hingeSide" data-val="L" class="${eff.hingeSide==='L'?'active':''}">左（L）</button><button data-hand="hingeSide" data-val="R" class="${eff.hingeSide==='R'?'active':''}">右（R）</button></div>
      <div class="hand-label">開く向き</div>
      <div class="hand-row"><button data-hand="swingDir" data-val="in" class="${eff.swingDir==='in'?'active':''}">内開き</button><button data-hand="swingDir" data-val="out" class="${eff.swingDir==='out'?'active':''}">外開き</button></div>`;
  } else if(eff.operation==='double-swing' || eff.operation==='double-fold'){
    area.innerHTML = `
      <div class="hand-label">開く向き（両側とも同じ向きに開く）</div>
      <div class="hand-row"><button data-hand="swingDir" data-val="in" class="${eff.swingDir==='in'?'active':''}">内開き</button><button data-hand="swingDir" data-val="out" class="${eff.swingDir==='out'?'active':''}">外開き</button></div>`;
  } else if(eff.operation==='slide'){
    area.innerHTML = `
      <div class="hand-label">引き込み方向</div>
      <div class="hand-row"><button data-hand="slideDir" data-val="L" class="${eff.slideDir==='L'?'active':''}">左（L）</button><button data-hand="slideDir" data-val="R" class="${eff.slideDir==='R'?'active':''}">右（R）</button></div>`+(eff.orientation ? `
      <div class="hand-label">戸が走る壁の側</div>
      <div class="hand-row"><button data-hand="slideSide" data-val="L" class="${eff.slideSide==='L'?'active':''}">${eff.orientation==='H'?'北':'西'}側</button><button data-hand="slideSide" data-val="R" class="${eff.slideSide==='R'?'active':''}">${eff.orientation==='H'?'南':'東'}側</button></div>` : '');
  } else if(eff.category==='door'){
    area.innerHTML = `<div class="hand-label">この種類は扉本体がありません（開口のみ）</div>`;
  } else {
    area.innerHTML = ''; // 窓には開き勝手の概念がない
  }
  area.querySelectorAll('button[data-hand]').forEach(btn=>{
    btn.onclick = ()=> setHand(btn.dataset.hand, btn.dataset.val);
  });
}
function updateDoorPanel(){
  const panel = document.getElementById('doorPanel');
  if(!doorEditMode || !selectedDoorWindowId){ panel.style.display = 'none'; return; }
  const sel = findDoorWindowBase(selectedDoorWindowId);
  if(!sel){ panel.style.display = 'none'; return; }
  const eff = sel.isExterior ? effectiveOpening(sel.base) : effectiveInteriorDoor(sel.base);
  document.getElementById('dpLabel').textContent = eff.label || eff.type;
  const typeSel = document.getElementById('dpType');
  typeSel.innerHTML = Object.entries(DOOR_WINDOW_CATALOG).filter(([k,p])=>p.category===eff.category)
    .map(([k,p])=>`<option value="${k}"${k===eff.type?' selected':''}>${p.label}</option>`).join('');
  const isDiagonal = !sel.isExterior && eff.orientation==='D';
  document.getElementById('dpWidth').value = sel.isExterior ? eff.w : eff.width;
  document.getElementById('dpHeight').value = sel.isExterior ? eff.h : eff.height;
  document.getElementById('dpWidth').disabled = isDiagonal;
  document.getElementById('dpHeight').disabled = isDiagonal;
  document.getElementById('dpSillLabel').style.display = sel.isExterior ? '' : 'none';
  if(sel.isExterior) document.getElementById('dpSill').value = eff.sill;
  renderHandControls(eff);
  if(isDiagonal){
    document.getElementById('dpHandArea').innerHTML = `<div class="hand-label">斜め壁の開口です。位置・幅は壁線スライド編集の対象外（data/interior-doors.jsonを直接編集）</div>`;
  }
  panel.style.display = 'block';
}
function updateDoorBar(){
  const n = Object.keys(doorWindowEdits).length;
  document.getElementById('dbCount').textContent = n>0 ? `編集済み: ${n}件` : '編集なし';
}
function applyDoorTypeChange(newType){
  if(!selectedDoorWindowId) return;
  const sel = findDoorWindowBase(selectedDoorWindowId);
  if(!sel) return;
  const profile = DOOR_WINDOW_CATALOG[newType];
  const patch = { type: newType, operation: profile.operation };
  if(sel.isExterior){ patch.w = profile.width; patch.h = profile.height; patch.sill = profile.sill; }
  else { patch.width = profile.width; patch.height = profile.height; }
  if(profile.operation==='swing' || profile.operation==='fold'){ patch.hingeSide = 'R'; patch.swingDir = 'in'; }
  else if(profile.operation==='double-swing' || profile.operation==='double-fold'){ patch.swingDir = 'in'; }
  else if(profile.operation==='slide'){ patch.slideDir = 'R'; if(!sel.isExterior) patch.slideSide = 'R'; }
  doorWindowEdits[selectedDoorWindowId] = {...(doorWindowEdits[selectedDoorWindowId]||{}), ...patch};
  saveDoorWindowEdits();
  rebuildDoorWindow(selectedDoorWindowId, sel.isExterior);
  selectDoorWindow(selectedDoorWindowId);
  updateDoorPanel();
  updateDoorBar();
}
function applyDoorDimEdit(logicalField, value){
  if(!selectedDoorWindowId) return;
  const v = parseFloat(value);
  const okRange = logicalField==='sill' ? v>=0 : v>0;
  if(!okRange || Number.isNaN(v)) return;
  const sel = findDoorWindowBase(selectedDoorWindowId);
  if(!sel) return;
  const key = doorFieldKey(logicalField, sel.isExterior);
  if(!key) return;
  doorWindowEdits[selectedDoorWindowId] = {...(doorWindowEdits[selectedDoorWindowId]||{}), [key]: round2(v)};
  saveDoorWindowEdits();
  rebuildDoorWindow(selectedDoorWindowId, sel.isExterior);
  selectDoorWindow(selectedDoorWindowId);
  updateDoorBar();
}
function setHand(field, value){
  if(!selectedDoorWindowId) return;
  doorWindowEdits[selectedDoorWindowId] = {...(doorWindowEdits[selectedDoorWindowId]||{}), [field]: value};
  saveDoorWindowEdits();
  const sel = findDoorWindowBase(selectedDoorWindowId);
  rebuildDoorWindow(selectedDoorWindowId, sel.isExterior);
  selectDoorWindow(selectedDoorWindowId);
  updateDoorBar();
}
function resetSelectedDoorWindow(){
  if(!selectedDoorWindowId) return;
  const sel = findDoorWindowBase(selectedDoorWindowId);
  delete doorWindowEdits[selectedDoorWindowId];
  saveDoorWindowEdits();
  if(sel) rebuildDoorWindow(selectedDoorWindowId, sel.isExterior);
  selectDoorWindow(selectedDoorWindowId);
  updateDoorPanel();
  updateDoorBar();
}
function downloadJSON(payload, filename){
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function buildOpeningsPayload(){
  const items = OPENINGS.map(base=>{
    const eff = effectiveOpening(base);
    const cat = DOOR_WINDOW_CATALOG[eff.type];
    const out = { id: base.id, type: eff.type, face: base.face };
    out.offset = round2((base.face==='N'||base.face==='S') ? eff.lx : eff.lz);
    if(base.x !== undefined) out.wallX = base.x;
    out.level = base.level;
    if(round2(eff.w) !== round2(cat.width)) out.widthOverride = round2(eff.w);
    if(round2(eff.h) !== round2(cat.height)) out.heightOverride = round2(eff.h);
    if(round2(eff.sill) !== round2(cat.sill)) out.sillOverride = round2(eff.sill);
    if(eff.hingeSide) out.hingeSide = eff.hingeSide;
    if(eff.swingDir) out.swingDir = eff.swingDir;
    if(eff.slideDir) out.slideDir = eff.slideDir;
    out.label = base.label;
    out.status = base.status;
    if(base.note) out.note = base.note; // 2026-09-16修正：以前は書き出されず、根拠メモが書き出しの度に消えていた
    return out;
  });
  return {
    schemaVersion:'1.0.0', units:'m',
    note: '外部の窓・ドアの配置インスタンス。type は data/door-catalog.json / data/window-catalog.json の type を参照する。face(N/S/E/W)+offset で位置を表す（offsetはその面に沿った建物ローカル座標の絶対値）。hingeSide/swingDirはドア(category:door)のみ意味を持つ。ブラウザの配置編集機能から書き出したファイル。data/openings.json に上書きしてコミットすること。',
    items,
  };
}
function exportOpeningsJSON(){ downloadJSON(buildOpeningsPayload(), 'openings.json'); }
function buildInteriorDoorsPayload(){
  const items = INTERIOR_DOORS.map(base=>{
    // orientation:'D'（斜め壁）はwallAt/centerを持たず、壁線スライド編集の対象外のため
    // base（元データ）のx0/z0/x1/z1をそのまま素通しする（effectiveInteriorDoor()で計算される
    // eff.centerはD向けには存在しないため、ここでcenterとして書き出すと壊れる）
    if(base.orientation === 'D'){
      const out = { id: base.id, type: base.type, orientation: 'D', x0: base.x0, z0: base.z0, x1: base.x1, z1: base.z1, floor: base.floor };
      out.label = base.label;
      out.status = base.status;
      if(base.note) out.note = base.note; // 2026-09-16修正：以前は書き出されず、根拠メモが書き出しの度に消えていた
      return out;
    }
    const eff = effectiveInteriorDoor(base);
    const cat = DOOR_WINDOW_CATALOG[eff.type];
    const out = { id: base.id, type: eff.type, wallAt: base.wallAt, orientation: base.orientation, center: round2(eff.center), floor: base.floor };
    if(round2(eff.width) !== round2(cat.width)) out.widthOverride = round2(eff.width);
    if(round2(eff.height) !== round2(cat.height)) out.heightOverride = round2(eff.height);
    if(eff.hingeSide) out.hingeSide = eff.hingeSide;
    if(eff.swingDir) out.swingDir = eff.swingDir;
    if(eff.slideDir) out.slideDir = eff.slideDir;
    if(eff.slideSide) out.slideSide = eff.slideSide;
    out.label = base.label;
    out.status = base.status;
    if(base.note) out.note = base.note; // 2026-09-16修正：以前は書き出されず、根拠メモが書き出しの度に消えていた
    return out;
  });
  return {
    schemaVersion:'1.0.0', units:'m',
    note: '室内ドアの配置インスタンス。type は data/door-catalog.json の type を参照する。wallAt+orientation+center で位置を表す（wallAtは壁の固定座標、centerはその壁沿いの位置）。ブラウザの配置編集機能から書き出したファイル。data/interior-doors.json に上書きしてコミットすること。',
    items,
  };
}
function exportInteriorDoorsJSON(){ downloadJSON(buildInteriorDoorsPayload(), 'interior-doors.json'); }
document.getElementById('dpClose').onclick = ()=> selectDoorWindow(null);
document.getElementById('dpType').onchange = e=> applyDoorTypeChange(e.target.value);
document.getElementById('dpWidth').onchange = e=> applyDoorDimEdit('width', e.target.value);
document.getElementById('dpHeight').onchange = e=> applyDoorDimEdit('height', e.target.value);
document.getElementById('dpSill').onchange = e=> applyDoorDimEdit('sill', e.target.value);
document.getElementById('dpReset').onclick = resetSelectedDoorWindow;
document.getElementById('dbExportOpenings').onclick = exportOpeningsJSON;
document.getElementById('dbExportDoors').onclick = exportInteriorDoorsJSON;
document.getElementById('dbClearAll').onclick = ()=>{
  if(Object.keys(doorWindowEdits).length===0) return;
  if(!confirm('窓・ドアの編集内容をすべて取り消し、元の配置に戻します。よろしいですか？')) return;
  const ids = Object.keys(doorWindowEdits);
  doorWindowEdits = {};
  saveDoorWindowEdits();
  ids.forEach(id=>{ const sel=findDoorWindowBase(id); if(sel) rebuildDoorWindow(id, sel.isExterior); });
  selectDoorWindow(null);
  updateDoorBar();
};
document.getElementById('doorEditToggle').onclick = ()=> setDoorEditMode(!doorEditMode);
updateDoorBar();

// ============================================================================
// 電気設備（data/electrical-catalog.json / data/electrical.json から生成）
// ============================================================================
// 家具と同じくfPart()（箱・円柱の組み合わせ）を使い、俯瞰・平面図・内覧の全モードで
// 同一メッシュを使い回す（ドアのような「平面図記号＋内覧用の別実装」の二重実装はしない。
// 電気設備には開閉のような動的状態がなく、常に同じ静的な位置表現で足りるため）。
// 壁付け(ePlate系)と天井/床付け(eDisc系)の2つの共有ジオメトリに集約する。
// Web UI編集（ドラッグ配置）は下記「電気設備編集」セクションで実装。当たり判定は持たない
// （電気設備は壁・天井付けで歩行の障害物にならないため、家具のような衝突判定は不要）。
// 施主指摘（2026-08-18）：初期配色（白/淡黄/淡青）が既存のカラフルな平面図
// （淡いオレンジの部屋・水色の窓・マゼンタのドア等）に埋もれて、小さい電気設備が
// どこにあるか全く見えなかった。淡色をやめ、既存の凡例色と衝突しない濃い彩度の
// 色をカテゴリごとに割り当てる（電源=紫、情報系=ティール、照明=琥珀、設備=濃紺）
const EMAT = {
  power: new THREE.MeshStandardMaterial({color:0x8e24aa, roughness:0.4}), // コンセント・スイッチ
  plateDark: new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:0.4}), // 差込口/トグル等の濃色パーツ
  light: new THREE.MeshStandardMaterial({color:0xffab00, emissive:0xff8f00, emissiveIntensity:0.6, roughness:0.35}), // 照明
  washi: new THREE.MeshStandardMaterial({color:0xefe6d6, emissive:0xffd9a0, emissiveIntensity:0.22, roughness:0.85, side:THREE.DoubleSide}), // 和紙のかさ
  equip: new THREE.MeshStandardMaterial({color:0x37474f, roughness:0.4, metalness:0.5}), // 分電盤・スリーブ・換気扇
  data: new THREE.MeshStandardMaterial({color:0x00897b, roughness:0.4}), // 情報系(LAN/TV/インターホン)
  reserve: new THREE.MeshStandardMaterial({color:0x2f6db5, roughness:0.5, transparent:true, opacity:.55}), // 予備の位置（まだ付けない）
  edge: new THREE.LineBasicMaterial({color:0x1a1a1a}) // 小さい形状でも輪郭がはっきり分かるよう全形状に付ける
};
const EDISC_EDGES = new THREE.EdgesGeometry(FURNITURE_CYL);
const EBOX_EDGES = new THREE.EdgesGeometry(FURNITURE_BOX);
// fPart()は共有の単位ジオメトリをスケールして使い回すため、輪郭線もscale/positionを
// 揃えたLineSegmentsを別途重ねる（boxWire()と同じ考え方）
function fPartEdged(group, w,h,d, x,y,z, mat, cylinder){
  const mesh = fPart(group, w,h,d, x,y,z, mat, cylinder);
  const line = new THREE.LineSegments(cylinder ? EDISC_EDGES : EBOX_EDGES, EMAT.edge);
  line.position.copy(mesh.position);
  line.scale.copy(mesh.scale);
  group.add(line);
  return mesh;
}
// 壁付け設備の共有ベース：ローカル原点=器具中心(mountHeightの点)、X=沿い方向(width)、
// Y=上下(height、中心基準)、Z=壁からの突き出し(depth)。fPart()は下端基準のため-h/2offsetで中心化する
function ePlate(group, w,d,h, mat){ fPartEdged(group, w,h,d, 0,-h/2,0, mat); }
// 天井/床付け設備の共有ベース：円盤。up=trueなら天井原点(mountHeightの点)から下向き(y=-h〜0)、
// falseなら床原点から上向き(y=0〜h、家具と同じ)
function eDisc(group, w,d,h, mat, up){ fPartEdged(group, w,h,d, 0, up ? -h : 0, 0, mat, true); }

const ELECTRICAL_SHAPES = {
  outletPlate(group,w,d,h){
    ePlate(group,w,d,h, EMAT.power);
    fPart(group, 0.012,0.012,0.006, -w*0.15, -0.02, d*0.4, EMAT.plateDark, true); // 差込口(2箇所)
    fPart(group, 0.012,0.012,0.006,  w*0.15, -0.02, d*0.4, EMAT.plateDark, true);
  },
  outletFloorPlate(group,w,d,h){ fPartEdged(group, w,h,d, 0,0,0, EMAT.power); }, // 床フラッシュの薄い円盤
  ceilingOutletPlate(group,w,d,h){ eDisc(group,w,d,h, EMAT.power, true); },     // 天井面に付くプレート（下向き）
  switchPlate(group,w,d,h){
    ePlate(group,w,d,h, EMAT.power);
    fPart(group, w*0.3,w*0.3,0.01, 0,0,d*0.4, EMAT.plateDark, true); // トグル/ボタン(JISの●相当)
  },
  downlight(group,w,d,h){ eDisc(group,w,d,h, EMAT.light, true); },
  ceilingLight(group,w,d,h){
    eDisc(group,w,d,h, EMAT.light, true);
    fPart(group, w*0.15,w*0.15,0.01, 0,-h-0.005,0, EMAT.plateDark, true); // 中心ドット
  },
  pendantLight(group,w,d,h){
    fPart(group, 0.02,h*0.7,0.02, 0,-h*0.35,0, EMAT.plateDark); // コード
    eDisc(group, w,d,h*0.5, EMAT.light, true); // シェード(下端寄り、簡易表現)
  },
  // 平たいだ円の和紙のかさ、黒い金物と布のコード。原点はかさの上端。blender/electrical_assets.py の washi_pendant_parts() と同じ比率
  washiPendant(group,w,d,h,item){
    const hw=w/2, hh=h/2, top=0.05, opening=0.11, points=[];
    const start=Math.asin(top/hw), end=Math.PI-Math.asin(opening/hw);
    for(let i=0;i<=24;i++){
      const t=start+(end-start)*i/24;
      points.push(new THREE.Vector2(hw*Math.sin(t), -hh+hh*Math.cos(t)));
    }
    group.add(new THREE.Mesh(new THREE.LatheGeometry(points,48), EMAT.washi));
    fPart(group, 0.11,0.02,0.11, 0,-0.008,0, EMAT.plateDark, true);  // 上の金物
    const bottom=-hh-hh*Math.sqrt(1-(opening/hw)**2);
    fPart(group, opening*2+0.006,0.008,opening*2+0.006, 0,bottom-0.004,0, EMAT.plateDark, true);  // 下の細い輪
    const cord=(item&&item.mountHeight)||0.6;
    fPart(group, 0.007,cord,0.007, 0,0,0, EMAT.plateDark, true);  // コード
  },
  bracketLight(group,w,d,h){ fPartEdged(group, w,h,d, 0,-h/2,0, EMAT.light); },
  indirectLight(group,w,d,h){ fPartEdged(group, w,h,d, 0,-h,0, EMAT.light); }, // 簡易な点/線マーカー
  dataJack(group,w,d,h){
    ePlate(group,w,d,h, EMAT.data);
    fPart(group, w*0.3,w*0.3,0.006, 0,-0.02,d*0.4, EMAT.plateDark, true);
  },
  intercomPanel(group,w,d,h){ ePlate(group,w,d,h, EMAT.data); },
  acSleeve(group,w,d,h){
    ePlate(group,w,d,h, EMAT.equip);
    fPart(group, w*0.55,d*0.55,0.01, 0,0,d*0.5, EMAT.plateDark, true); // 穴(暗色の円)
  },
  ventFan(group,w,d,h){
    eDisc(group,w,d,h, EMAT.equip, true);
    fPart(group, w*0.8,0.01,0.01, 0,-h*0.5,0, EMAT.plateDark); // 羽根の十字
    fPart(group, 0.01,0.01,d*0.8, 0,-h*0.5,0, EMAT.plateDark);
  },
  distributionBoard(group,w,d,h){ ePlate(group,w,d,h, EMAT.equip); },
  // 棚に置く機器。壁の面から部屋の側へ出す（中心に置くと、奥行きの分だけ壁の反対側へ突き出す）。
  // 0.062はBlenderのbuild_electrical_devices()と同じ、壁の中心から箱の背までの距離。
  shelfGear(group,w,d,h){ fPartEdged(group, w,h,d, 0,-h/2,.062+d/2, EMAT.equip); },
  spotLight(group,w,d,h){ fPartEdged(group, w,h,d, 0,-h,0, EMAT.plateDark, true); }, // レールに下がる黒いスポット
  footLight(group,w,d,h){ ePlate(group,w,d,h, EMAT.light); },
  lampMarker(group,w,d,h){ eDisc(group,w,d,h, EMAT.light, true); }, // 置き型の照明の光の位置（器具は家具）
  trackRail(group,w,d,h){ fPartEdged(group, w,h,d, 0,-h,0, EMAT.plateDark); },
  smokeAlarm(group,w,d,h){ eDisc(group,w,d,h, EMAT.equip, true); },
  reserveMark(group,w,d,h){ eDisc(group,w,d,h, EMAT.reserve, true); }
};

// ---- 電気設備の配置編集（第2段階）：diffだけをlocalStorageに保存する（家具・窓ドア編集と同じ考え方） ----
// ELECTRICAL_ITEMS（data/electrical.jsonから生成）はこのセッションでは書き換えず、差分を
// electricalEdits に持ち、effectiveElectrical() で重ねて描画する。mount:wallの型は
// wallAt/orientation/center/side、mount:ceiling/floorの型はx/zを差分として持つ（型が
// 同じmount同士でしか切り替えられないため、1つのitemの中でこの2系統が混在することはない）。
// 項目の増減（追加・削除）は electricalEdits では表現できないため、electricalAdded/electricalDeleted
// という別のdiffを持つ（下記）。既存項目の書き換えと項目自体の増減を1つの構造に混ぜると、
// 「削除したのに編集が残る」のような復元時の不整合が起きやすいため、意図的に分けている
const ELECTRICAL_EDITS_KEY = 'ryuka-electrical-edits-v1';
let electricalEdits = {};
try { electricalEdits = JSON.parse(localStorage.getItem(ELECTRICAL_EDITS_KEY) || '{}') || {}; } catch(e){ electricalEdits = {}; }
function saveElectricalEdits(){ try{ localStorage.setItem(ELECTRICAL_EDITS_KEY, JSON.stringify(electricalEdits)); } catch(e){} }
function effectiveElectrical(item){ const e = electricalEdits[item.id]; return e ? {...item, ...e} : item; }
// ---- 電気設備の追加・削除：electricalEdits（既存項目の位置・寸法パッチ）とは別に、
// 「項目の増減」をこの2つのdiffで表現する。追加は項目そのものを、削除はidだけ（墓標）を持つ
// （即座にデータを消さず、一覧モーダルから個別に復元できるようにするため）
const ELECTRICAL_ADDED_KEY = 'ryuka-electrical-added-v1';
const ELECTRICAL_DELETED_KEY = 'ryuka-electrical-deleted-v1';
let electricalAdded = [];
let electricalDeleted = [];
try { electricalAdded = JSON.parse(localStorage.getItem(ELECTRICAL_ADDED_KEY) || '[]') || []; } catch(e){ electricalAdded = []; }
try { electricalDeleted = JSON.parse(localStorage.getItem(ELECTRICAL_DELETED_KEY) || '[]') || []; } catch(e){ electricalDeleted = []; }
function saveElectricalAdded(){ try{ localStorage.setItem(ELECTRICAL_ADDED_KEY, JSON.stringify(electricalAdded)); } catch(e){} }
function saveElectricalDeleted(){ try{ localStorage.setItem(ELECTRICAL_DELETED_KEY, JSON.stringify(electricalDeleted)); } catch(e){} }
// 削除済みも含めた「存在しうる全アイテム」からidで探す（一覧モーダルの復元操作が使う）
function findElectricalBase(id){
  return ELECTRICAL_ITEMS.find(e=>e.id===id) || electricalAdded.find(e=>e.id===id);
}
// 表示・配置対象（追加分を加え、削除済みを除いた現在の全アイテム）。ELECTRICAL_ITEMS
// （data/electrical.jsonから生成された不変の元データ）への直接参照はこの関数を経由して置き換える
function savedElectricalItems(){
  return [...ELECTRICAL_ITEMS, ...electricalAdded].filter(e=> !electricalDeleted.includes(e.id));
}
// 表示・配置・見積の対象。入れ替えセットの表示中でない組（例：WILLTIC用のペンダント）は含めない
function allElectricalItems(){ return savedElectricalItems().filter(isVariantActive); }
// ---- 電気設備編集のUndo/Redo ----
// electricalEdits（既存項目の位置・寸法パッチ）／electricalAdded（追加分）／electricalDeleted
// （削除の墓標）の3状態をまとめて1つのスナップショットとして扱う（コマンドパターンで個々の
// 操作を反転するのではなく、状態を丸ごと複製・復元する方式。最大でも150件程度のJSONなので
// 毎回のディープコピーで十分軽量、かつ「何を戻すか」を個別に実装しないので確実）。
// 全ミューテーション関数は、実際に値を書き換える直前にpushElectricalUndoSnapshot()を呼ぶ
const ELECTRICAL_UNDO_LIMIT = 50;
let electricalUndoStack = [];
let electricalRedoStack = [];
function snapshotElectricalState(){
  return {
    edits: JSON.parse(JSON.stringify(electricalEdits)),
    added: JSON.parse(JSON.stringify(electricalAdded)),
    deleted: [...electricalDeleted],
  };
}
function pushElectricalUndoSnapshot(){
  electricalUndoStack.push(snapshotElectricalState());
  if(electricalUndoStack.length > ELECTRICAL_UNDO_LIMIT) electricalUndoStack.shift();
  electricalRedoStack = []; // 新しい操作をしたらredo履歴は破棄する（一般的なUndo/Redoの慣習）
}
// 3状態を復元し、全設備を作り直す（部分更新だと「何が増減したか」の追跡が要って複雑になるため、
// 初回描画ループ（ELECTRICAL_ITEMS.forEach...）と同じ「全部消して作り直す」方式に統一する）
function restoreElectricalSnapshot(snap){
  electricalEdits = snap.edits;
  electricalAdded = snap.added;
  electricalDeleted = snap.deleted;
  saveElectricalEdits(); saveElectricalAdded(); saveElectricalDeleted();
  const keepId = selectedElectricalId && allElectricalItems().some(it=>it.id===selectedElectricalId) ? selectedElectricalId : null;
  [...electricalMeshes.keys()].forEach(id=> removeElectricalMesh(id));
  allElectricalItems().forEach(item=> placeElectricalItem(effectiveElectrical(item)));
  setSelectedElectrical(keepId);
  if(focusedRoomId) refreshRoomFocusElecPanel();
  updateElectricalBar();
}
function undoElectrical(){
  if(!electricalUndoStack.length) return;
  electricalRedoStack.push(snapshotElectricalState());
  restoreElectricalSnapshot(electricalUndoStack.pop());
}
function redoElectrical(){
  if(!electricalRedoStack.length) return;
  electricalUndoStack.push(snapshotElectricalState());
  restoreElectricalSnapshot(electricalRedoStack.pop());
}
// mount:wallの器具中心Y座標(mountHeightの点)を求める共通計算。placeElectricalItem()の初回配置と
// repositionElectricalItem()（取付け高さだけの軽量更新）の両方から呼ぶことで、Y座標計算のロジックを
// 二重に持たないようにする
function electricalGroupY(eff, baseY){
  // W06レビューR1：勾配天井（room-1f-06等）では平坦なCEIL_Hと実際の天井高が
  // 異なるため、壁・天井生成が使っているのと同じslopedCeilingHeightAt()
  // （既存、内覧の当たり判定・輪郭表示等で使用）で実際の天井高を求める。
  // 対象外の地点・平坦天井の部屋ではCEIL_Hと同じ値を返すため、既存の見た目は変わらない。
  if(eff.mount==='ceiling') return baseY + slopedCeilingHeightAt(eff.x, eff.z) - eff.mountHeight;
  return baseY + eff.mountHeight; // wall・floorはFLからの高さ
}
// mount:'exterior'（屋外設置）のface+offsetから、実際のワールド座標(x,z)と外向きの
// 回転(rotY)を計算する。data/openings.jsonの外部窓・ドアと全く同じface/offset規約
// （openingWallGeom()参照）を踏襲する。offsetは面沿いの開始端（openingWallGeom()の
// lx/lzと同じ意味）、器具はその中心(offset+width/2)に置く。回転は常に建物の外側を向く
// （sideフィールドは持たない。壁付け(mount:wall)のside=+1/-1とは別の規約）
function exteriorElectricalGeom(item){
  const along = item.offset + item.width/2;
  if(item.face==='N'){
    return { x: along, z: item.level===2 ? FLOOR2.z0 : segAtX(item.offset).z0, rotY: Math.PI };
  }
  if(item.face==='S'){
    return { x: along, z: item.level===2 ? FLOOR2.z1 : segAtX(item.offset).z1, rotY: 0 };
  }
  if(item.face==='E'){
    return { x: item.wallX!==undefined ? item.wallX : 19.110, z: along, rotY: Math.PI/2 };
  }
  return { x: item.wallX!==undefined ? item.wallX : 0, z: along, rotY: -Math.PI/2 }; // 'W'
}

const electricalMeshes = new Map(); // id -> { holder, label }
function placeElectricalItem(item){
  const shapeFn = ELECTRICAL_SHAPES[item.shape];
  if(!shapeFn) return;
  const holder = new THREE.Group();
  holder.userData.electricalId = item.id;
  shapeFn(holder, item.width, item.depth, item.height, item);
  const baseY = item.level===1 ? LEVELS.fl1 : LEVELS.fl2;
  let alongX, alongZ, rotY = 0;
  if(item.mount === 'wall'){
    alongX = item.orientation==='H' ? item.center : item.wallAt;
    alongZ = item.orientation==='H' ? item.wallAt : item.center;
    // orientation(壁の向き)+side(壁のどちら側を向くか)からrotation.yを導出する。
    // boxWireRotated()等と同じ規約：rotation.y=θはローカル+Zをワールド(sinθ,cosθ)方向に向ける
    rotY = item.orientation==='H'
      ? (item.side>0 ? 0 : Math.PI)
      : (item.side>0 ? Math.PI/2 : -Math.PI/2);
  } else if(item.mount === 'exterior'){
    const g = exteriorElectricalGeom(item);
    alongX = g.x; alongZ = g.z; rotY = g.rotY;
  } else {
    alongX = item.x; alongZ = item.z;
  }
  const groupY = electricalGroupY(item, baseY);
  const [sx,sz] = toScene(alongX, alongZ);
  holder.position.set(sx, groupY, sz);
  holder.rotation.y = rotY;
  const grp = item.level===1 ? groups.electrical1 : groups.electrical2;
  grp.add(holder);
  const l = makeLabel(item.label, alongX, groupY + item.height/2 + 0.1, alongZ, false);
  l.floor = item.level; l.isElectrical = true;
  labels.push(l);
  electricalMeshes.set(item.id, { holder, label: l });
}
function removeElectricalMesh(id){
  const entry = electricalMeshes.get(id);
  if(!entry) return;
  if(entry.holder.parent) entry.holder.parent.remove(entry.holder);
  const idx = labels.indexOf(entry.label);
  if(idx>=0){ entry.label.div.remove(); labels.splice(idx,1); }
  electricalMeshes.delete(id);
}
function rebuildElectricalItem(id){
  const base = findElectricalBase(id);
  if(!base) return;
  removeElectricalMesh(id);
  placeElectricalItem(effectiveElectrical(base));
}
// 位置(x/y/z)だけの変更：形状(shape)は変わらないため完全な再構築は不要。
// holder/labelの座標だけを直接書き換える（ドラッグ中のholder.position直接更新と同じ考え方）。
// XYZ数値入力パネル（center/x/z/mountHeightの変更）とmountHeight単体編集の両方から呼ばれる
function repositionElectricalItem(id){
  const base = findElectricalBase(id);
  const entry = electricalMeshes.get(id);
  if(!base || !entry) return;
  const eff = effectiveElectrical(base);
  const baseY = eff.level===1 ? LEVELS.fl1 : LEVELS.fl2;
  const groupY = electricalGroupY(eff, baseY);
  let alongX, alongZ;
  if(eff.mount === 'wall'){
    alongX = eff.orientation==='H' ? eff.center : eff.wallAt;
    alongZ = eff.orientation==='H' ? eff.wallAt : eff.center;
  } else if(eff.mount === 'ceiling' || eff.mount === 'floor'){
    alongX = eff.x; alongZ = eff.z;
  }
  if(alongX !== undefined){
    const [sx,sz] = toScene(alongX, alongZ);
    entry.holder.position.x = sx; entry.holder.position.z = sz;
    entry.label.pos.x = sx; entry.label.pos.z = sz;
  }
  entry.holder.position.y = groupY;
  entry.label.pos.y = groupY + eff.height/2 + 0.1;
}
allElectricalItems().forEach(item=> placeElectricalItem(effectiveElectrical(item)));

// ---- 電気設備編集：選択・壁沿い/自由ドラッグ（俯瞰モード専用） ----
// 電気設備の全形状はfPartEdged()等で輪郭線(LineSegments)を必ず伴っており、editRaycasterは
// Three.jsのデフォルトparams.Line.threshold=1（1m）のままだったため、狙った設備から画面上
// 80〜120px（実寸9cmの器具に対して）離れた場所をクリックしても輪郭線がヒットして誤選択されて
// いた（施主報告・2026-08-28実測：中心1点のクリックで145ヒット・9個の異なる設備が候補に
// 挙がっていた）。isMeshで塗りつぶしメッシュだけに限定し、実際に器具本体の上をクリックした
// ときだけ反応するようにする
function pickElectricalAt(clientX, clientY){
  editRaycaster.setFromCamera(ndcFromClient(clientX, clientY), editCam());
  const hits = editRaycaster.intersectObject(electricalAll, true);
  for(const hit of hits){
    if(!hit.object.isMesh) continue;
    if(!isEffectivelyVisible(hit.object)) continue;
    let obj = hit.object;
    while(obj){
      if(obj.userData && obj.userData.electricalId) return obj.userData.electricalId;
      obj = obj.parent;
    }
  }
  return null;
}
// 選択中マーカー：BoxHelperだけだと実寸9cm前後の器具では俯瞰で見えづらいため、最低半径0.15mを
// 保証する円形リングを足で添える（施主指摘：狙った設備を正確に指定して編集したい）
const ELECTRICAL_MARKER_MIN_RADIUS = 0.15;
function makeElectricalRingMarker(entry, color){
  const box = new THREE.Box3().setFromObject(entry.holder);
  const size = new THREE.Vector3(); box.getSize(size);
  const radius = Math.max(size.x, size.z, ELECTRICAL_MARKER_MIN_RADIUS*2) / 2;
  const geo = new THREE.RingGeometry(radius*0.85, radius, 24);
  const mat = new THREE.MeshBasicMaterial({color, side:THREE.DoubleSide, transparent:true, opacity:0.85, depthTest:false});
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI/2;
  const center = new THREE.Vector3(); box.getCenter(center);
  ring.position.set(center.x, box.min.y+0.01, center.z);
  ring.renderOrder = 12;
  return ring;
}
function setSelectedElectrical(id){
  selectedElectricalId = id;
  if(electricalSelectionHelper){ scene.remove(electricalSelectionHelper); electricalSelectionHelper = null; }
  if(id){
    const entry = electricalMeshes.get(id);
    if(entry){
      electricalSelectionHelper = new THREE.Group();
      const box = new THREE.BoxHelper(entry.holder, 0xffcf3a);
      box.renderOrder = 10;
      electricalSelectionHelper.add(box);
      electricalSelectionHelper.add(makeElectricalRingMarker(entry, 0xffcf3a));
      scene.add(electricalSelectionHelper);
    }
  }
  updateElectricalHover(null); // 選択されたIDのホバー枠が残らないようにする
  updateElectricalPanel();
  updateElectricalChangeHighlights(); // 選択中は変更/追加リングを外すため、選択変更のたびに作り直す
}
// ホバー中の設備をカーソル変化＋薄い水色の枠で示す（選択色の黄色とは別系統にして区別する）。
// clientX/Y=nullで強制的にクリアする（選択直後・編集モードOFF時等）
let hoveredElectricalId = null;
let electricalHoverHelper = null;
function clearElectricalHover(){
  if(electricalHoverHelper){ scene.remove(electricalHoverHelper); electricalHoverHelper = null; }
  hoveredElectricalId = null;
  renderer.domElement.style.cursor = '';
}
function updateElectricalHover(clientX, clientY){
  const id = (clientX===null) ? null : pickElectricalAt(clientX, clientY);
  if(id === hoveredElectricalId){
    renderer.domElement.style.cursor = id ? 'pointer' : '';
    return;
  }
  clearElectricalHover();
  hoveredElectricalId = id;
  if(id && id !== selectedElectricalId){
    const entry = electricalMeshes.get(id);
    if(entry){
      electricalHoverHelper = new THREE.BoxHelper(entry.holder, 0x8fd3ff);
      electricalHoverHelper.renderOrder = 9;
      scene.add(electricalHoverHelper);
    }
  }
  renderer.domElement.style.cursor = id ? 'pointer' : '';
}
// 変更・追加ハイライト：electricalEdits/electricalAddedに含まれる設備へ、選択中でなくても
// 常時うっすらとしたリング（変更＝水色、追加＝緑）を表示し、「このセッションでどこを触ったか」を
// 一目で分かるようにする（施主の使い方＝部屋フォーカスで絞って編集→フォーカスを戻して
// 隣接部屋との兼ね合いを確認、を支えるため）。updateElectricalBar()は全ミューテーション後に
// 必ず通るため、そのたびに作り直す（wallHighlightMesh/electricalSelectionHelperと同じ
// 「クリアしてから作り直す」方式）。選択中の設備は選択マーカー(黄)と紛らわしくなるため除外する
let electricalChangeHighlights = [];
const ELECTRICAL_CHANGED_COLOR = 0x29b6f6;
const ELECTRICAL_ADDED_COLOR = 0x43a047;
function updateElectricalChangeHighlights(){
  electricalChangeHighlights.forEach(m=> scene.remove(m));
  electricalChangeHighlights = [];
  if(!electricalEditMode) return;
  const addedIds = new Set(electricalAdded.map(e=>e.id));
  allElectricalItems().forEach(item=>{
    if(item.id === selectedElectricalId) return;
    const isAdded = addedIds.has(item.id);
    if(!isAdded && !electricalEdits[item.id]) return;
    const entry = electricalMeshes.get(item.id);
    if(!entry) return;
    const ring = makeElectricalRingMarker(entry, isAdded ? ELECTRICAL_ADDED_COLOR : ELECTRICAL_CHANGED_COLOR);
    ring.material.opacity = 0.45;
    ring.renderOrder = 8;
    scene.add(ring);
    electricalChangeHighlights.push(ring);
  });
}
// 壁沿いの可動範囲。wallRangeForInteriorDoor()と同じ考え方だが、探索先は内壁のみのWALLSではなく
// wallSegmentsByLevel（内壁+外壁+ドア開口の切り欠き済み、内覧モードの当たり判定と共通）にする。
// これにより「外壁の室内側に付くコンセント」（間取り上いちばん多いケース）も表現できる。
// ドア等でセグメントが複数に分かれている場合は、item.centerを含む区間を優先し、無ければ
// 最も近い区間にフォールバックする
function wallRangeForElectrical(item){
  const segs = (wallSegmentsByLevel[item.level] || []).filter(w=>
    w.orientation===item.orientation && Math.abs(w.at-item.wallAt)<0.01);
  if(!segs.length) return null;
  const containing = segs.find(s=> item.center>=s.from-0.01 && item.center<=s.to+0.01);
  if(containing) return [containing.from, containing.to];
  const nearest = segs.reduce((best,s)=>{
    const mid = (s.from+s.to)/2, d = Math.abs(item.center-mid);
    return (!best || d<best.d) ? {s,d} : best;
  }, null);
  return nearest ? [nearest.s.from, nearest.s.to] : null;
}
// ドラッグ中の1回のジェスチャーにつきUndoスナップショットは1つだけにする（moveSelectedElectricalTo()は
// pointermoveのたびに何十回も呼ばれるため、毎回積むとCtrl+Zが1px単位でしか戻らなくなってしまう）。
// ドラッグ開始時(pointerdown)にfalseへ戻し、このジェスチャーで最初に実際に動いた瞬間だけ積む
let electricalDragSnapshotTaken = false;
function moveSelectedElectricalTo(clientX, clientY){
  if(!selectedElectricalId) return;
  const base = findElectricalBase(selectedElectricalId);
  if(!base) return;
  const eff = effectiveElectrical(base);
  if(eff.mount === 'exterior') return; // 屋外設備のドラッグ移動はスコープ外。選択・種類/寸法編集は可能。位置(face/offset)を変えたい場合はdata/electrical.jsonを直接編集する運用とする
  const entry = electricalMeshes.get(selectedElectricalId);
  if(!entry) return;
  const p = groundPointAt(clientX, clientY, dragPlaneY); // 平面図・俯瞰のどちらでも、表示中のカメラで判定
  if(!p) return;
  if(!electricalDragSnapshotTaken){ pushElectricalUndoSnapshot(); electricalDragSnapshotTaken = true; }
  if(eff.mount === 'wall'){
    // 壁付け：窓・ドア編集と同じ1次元クランプ（壁に沿った方向にしか動かせない）
    const range = wallRangeForElectrical(eff);
    const alongIsX = eff.orientation==='H';
    let along = alongIsX ? (p.x+CX) : (p.z+CZ);
    const halfW = eff.width/2;
    if(range) along = Math.min(Math.max(along, range[0]+halfW), range[1]-halfW);
    electricalEdits[selectedElectricalId] = {...(electricalEdits[selectedElectricalId]||{}), center: round2(along)};
    const alongX = alongIsX ? along : eff.wallAt;
    const alongZ = alongIsX ? eff.wallAt : along;
    const [sx,sz] = toScene(alongX, alongZ);
    entry.holder.position.x = sx; entry.holder.position.z = sz; // Yはmountの基準面のため触らない
    entry.label.pos.x = sx; entry.label.pos.z = sz;
  } else {
    // 天井/床付け：家具と同じ自由な2Dドラッグ（クランプなし）
    entry.holder.position.x = p.x; entry.holder.position.z = p.z;
    entry.label.pos.x = p.x; entry.label.pos.z = p.z;
    electricalEdits[selectedElectricalId] = {...(electricalEdits[selectedElectricalId]||{}), x: round2(p.x+CX), z: round2(p.z+CZ)};
  }
  updateElectricalPanel();
}
function setElectricalEditMode(on){
  electricalEditMode = on;
  if(!on){
    // 部屋フォーカスは家具・窓ドアの編集でも使う共通の表示機能になったため、ここでは解除しない
    // （編集そのものを閉じたときに web/editor-shell.js が解除する）
    setSelectedElectrical(null); draggingElectrical=false; clearElectricalHover();
  } else {
    setEditMode(false);     // 家具編集・窓ドア編集・電気設備編集は三者択一で排他
    setDoorEditMode(false);
    electricalAll.visible = true;
  }
  document.getElementById('electricalEditToggle').classList.toggle('active', electricalEditMode);
  document.getElementById('electricalDock').style.display = electricalEditMode ? 'flex' : 'none';
  updateElectricalChangeHighlights(); // ON: 前回までの変更/追加リングを復元、OFF: 一括クリア
}

// ---- 電気設備編集ドック：編集段・バーの表示・操作 ----
function updateElectricalPanel(){
  const panel = document.getElementById('edEditSection');
  if(!electricalEditMode || !selectedElectricalId){ panel.style.display = 'none'; updateWallHighlight(null); return; }
  const base = findElectricalBase(selectedElectricalId);
  if(!base){ panel.style.display = 'none'; updateWallHighlight(null); return; }
  const eff = effectiveElectrical(base);
  document.getElementById('epLabel').textContent = eff.label || eff.type;
  const typeSel = document.getElementById('epType');
  // 種類切替の候補はmountが同じもの同士だけに絞る（categoryでフィルタすると、
  // light-bracket(wall)と他の照明(ceiling)のように位置表現が異なる型が混ざってしまうため）
  typeSel.innerHTML = Object.entries(ELECTRICAL_CATALOG).filter(([,p])=>p.mount===eff.mount)
    .map(([k,p])=>`<option value="${k}"${k===eff.type?' selected':''}>${p.label}</option>`).join('');
  document.getElementById('epWidth').value = eff.width;
  document.getElementById('epDepth').value = eff.depth;
  document.getElementById('epHeight').value = eff.height;
  updateElectricalPositionFields(eff);
  const wallArea = document.getElementById('epWallArea');
  wallArea.style.display = eff.mount==='wall' ? '' : 'none';
  if(eff.mount==='wall') updateElectricalWallSelect(eff); else updateWallHighlight(null);
  const sideArea = document.getElementById('epSideArea');
  sideArea.style.display = eff.mount==='wall' ? '' : 'none';
  if(eff.mount==='wall'){
    document.getElementById('epSidePos').classList.toggle('active', eff.side>0);
    document.getElementById('epSideNeg').classList.toggle('active', eff.side<0);
  }
  panel.style.display = 'flex';
}
// 選択中アイテムの現在位置から所属する部屋を動的に判定し（部屋フォーカス中かどうかに関わらず
// 動作する）、その部屋に接する壁の候補をwallsForRoom()（電気設備「追加」機能で新設済み）から
// 取得してプルダウンに表示する。現在の壁が候補内にあれば選択状態にする
function updateElectricalWallSelect(eff){
  const sel = document.getElementById('epWallSelect');
  const p = electricalRoomProbePoint(eff);
  const roomId = p ? findRoomIdAt(p.x, p.z, eff.level) : null;
  const walls = roomId ? wallsForRoom(roomId, eff.level) : [];
  if(!walls.length){
    sel.innerHTML = '<option value="">（部屋を判定できません）</option>';
    sel.disabled = true;
    delete sel.dataset.walls;
    updateWallHighlight(null);
    return;
  }
  sel.disabled = false;
  sel.innerHTML = walls.map((w,i)=> `<option value="${i}">${w.dirLabel}の壁（幅${Math.round((w.to-w.from)*1000)}mm）</option>`).join('');
  sel.dataset.walls = JSON.stringify(walls);
  sel.dataset.level = eff.level;
  const curIdx = walls.findIndex(w=> w.orientation===eff.orientation && Math.abs(w.at-eff.wallAt)<0.01);
  if(curIdx>=0){ sel.value = String(curIdx); updateWallHighlight(walls[curIdx], eff.level); }
  else updateWallHighlight(null); // 今の壁がこの部屋の候補と一致しない（起こらない想定だが念のため）
}
// 壁を切り替えたときの処理。壁の向き(rotation.y)も変わるため、位置だけ書き換える
// repositionElectricalItem()ではなく、型変更(applyElectricalTypeChange)と同じ
// rebuildElectricalItem()（削除→作り直し）を使う
document.getElementById('epWallSelect').onchange = e=>{
  if(!selectedElectricalId) return;
  const sel = e.target;
  const walls = JSON.parse(sel.dataset.walls || '[]');
  const w = walls[Number(sel.value)];
  if(!w) return;
  const base = findElectricalBase(selectedElectricalId);
  if(!base) return;
  const eff = effectiveElectrical(base);
  const center = findFreeWallSlot(w, eff.width, eff.level, selectedElectricalId);
  if(center === null){
    alert('この壁には、既存の設備と重ならずに置ける空きがありません。別の壁を選んでください。');
    updateElectricalWallSelect(eff); // 選択を元の壁へ戻す
    return;
  }
  pushElectricalUndoSnapshot();
  electricalEdits[selectedElectricalId] = {...(electricalEdits[selectedElectricalId]||{}),
    wallAt: w.at, orientation: w.orientation, side: w.side, center};
  saveElectricalEdits();
  rebuildElectricalItem(selectedElectricalId);
  setSelectedElectrical(selectedElectricalId);
  updateElectricalBar();
};
// 選択中の壁を3D上でハイライトする（黄色半透明の板、electricalSelectionHelperと同じ色）。
// wall=nullで非表示にする
let wallHighlightMesh = null;
const WALL_HIGHLIGHT_MAT = new THREE.MeshBasicMaterial({color:0xffcf3a, transparent:true, opacity:0.35, depthWrite:false});
const WALL_HIGHLIGHT_EDGE_MAT = new THREE.LineBasicMaterial({color:0xffcf3a});
function updateWallHighlight(wall, level){
  if(wallHighlightMesh){ scene.remove(wallHighlightMesh); wallHighlightMesh = null; }
  if(!wall) return;
  const baseY = level===1 ? LEVELS.fl1 : LEVELS.fl2;
  const t = 0.05, y0 = baseY, y1 = baseY + 2.2;
  const holder = new THREE.Group();
  if(wall.orientation==='H') boxWire(wall.from, wall.to, y0, y1, wall.at-t, wall.at+t, WALL_HIGHLIGHT_MAT, WALL_HIGHLIGHT_EDGE_MAT, holder, 15);
  else boxWire(wall.at-t, wall.at+t, y0, y1, wall.from, wall.to, WALL_HIGHLIGHT_MAT, WALL_HIGHLIGHT_EDGE_MAT, holder, 15);
  scene.add(holder);
  wallHighlightMesh = holder;
}
// XYZ数値入力パネルの表示値・編集可否を更新する。Yは常に「その階の床(FL)からの高さ」に統一表示する
// （heightRef:ceilingの器具はCEIL_H-mountHeightに変換して表示・逆変換して書き込む。取付け高さという
// 別枠の入力欄を持たせると同じ値を2つの単位系で操作する二重管理になるため統合した）。mount:wallは
// 壁に沿う側だけ編集可・固定側(壁面)はdisabledにして壁ロックを可視化する。mount:exteriorは
// スコープ外（ドラッグ移動も未対応）のため3つとも参考表示のみでdisabledにする
function updateElectricalPositionFields(eff){
  const epX = document.getElementById('epPosX'), epY = document.getElementById('epPosY'), epZ = document.getElementById('epPosZ');
  epX.disabled = false; epY.disabled = false; epZ.disabled = false;
  if(eff.mount === 'wall'){
    const alongIsX = eff.orientation === 'H';
    epX.value = round2(alongIsX ? eff.center : eff.wallAt);
    epZ.value = round2(alongIsX ? eff.wallAt : eff.center);
    epY.value = round2(eff.mountHeight);
    epX.disabled = !alongIsX;
    epZ.disabled = alongIsX;
  } else if(eff.mount === 'exterior'){
    const g = exteriorElectricalGeom(eff);
    epX.value = round2(g.x); epZ.value = round2(g.z);
    epY.value = round2(eff.mountHeight); // heightRefは常にfloorのためそのまま
    epX.disabled = true; epY.disabled = true; epZ.disabled = true;
  } else { // ceiling・floor：自由座標、クランプなし
    epX.value = round2(eff.x); epZ.value = round2(eff.z);
    epY.value = round2(eff.mount==='ceiling' ? slopedCeilingHeightAt(eff.x, eff.z) - eff.mountHeight : eff.mountHeight);
  }
}
// XYZ数値入力の書き込み。applyElectricalDimEdit()と同じ構造（electricalEditsへパッチ→保存→
// 軽量再配置→選択枠再作成→バー更新）。mount:wallの沿い側はドラッグ(moveSelectedElectricalTo)と
// 同じ式でwallRangeForElectrical()の範囲内にクランプする。固定側の入力欄はdisabledのため通常は
// 呼ばれないが、防御的に無視する。skipSnapshot=trueは矢印キーの長押し中に使う
// （キーリピートのたびにUndoを1件ずつ積むと1cm単位でしか戻せなくなるため、ホールド中の
// 最初の1回だけ積む。nudgeSelectedElectrical()参照）
function applyElectricalPositionEdit(axis, value, skipSnapshot){
  if(!selectedElectricalId) return;
  const v = parseFloat(value);
  if(Number.isNaN(v)) return;
  const base = findElectricalBase(selectedElectricalId);
  if(!base) return;
  const eff = effectiveElectrical(base);
  let patch = null;
  if(eff.mount === 'wall'){
    const alongIsX = eff.orientation === 'H';
    if(axis==='x' && !alongIsX) return; // 固定側（壁面）は編集不可
    if(axis==='z' && alongIsX) return;
    if(axis==='x' || axis==='z'){
      const range = wallRangeForElectrical(eff);
      const halfW = eff.width/2;
      let along = range ? Math.min(Math.max(v, range[0]+halfW), range[1]-halfW) : v;
      patch = { center: round2(along) };
    } else if(axis==='y'){
      patch = { mountHeight: round2(Math.max(0, v)) };
    }
  } else if(eff.mount === 'ceiling' || eff.mount === 'floor'){
    if(axis==='x') patch = { x: round2(v) };
    else if(axis==='z') patch = { z: round2(v) };
    else if(axis==='y'){
      // W06レビューR1：逆変換（入力された「床からの高さ」→mountHeight）も
      // electricalGroupY()と同じ実際の天井高を使う（勾配天井での不一致を解消）。
      const ceilingHere = slopedCeilingHeightAt(eff.x, eff.z);
      const mh = eff.mount==='ceiling' ? THREE.MathUtils.clamp(ceilingHere - v, 0, ceilingHere) : Math.max(0, v);
      patch = { mountHeight: round2(mh) };
    }
  } else {
    return; // mount:exterior はスコープ外
  }
  if(!patch) return;
  if(!skipSnapshot) pushElectricalUndoSnapshot();
  electricalEdits[selectedElectricalId] = {...(electricalEdits[selectedElectricalId]||{}), ...patch};
  saveElectricalEdits();
  repositionElectricalItem(selectedElectricalId);
  setSelectedElectrical(selectedElectricalId);
  updateElectricalBar();
}
// 矢印キーでの微調整（施主指摘：本気で編集するときに使う機能なのでキーボードで効率化したい）。
// 壁付けは沿い方向のみ（←/↓で減、→/↑で増）、天井/床付けは←→=X、↑↓=Zに割り当てる
// （画面上の見た目とは必ずしも一致しないが、常に同じ軸に決め打ちする方が予測しやすいため）
function nudgeSelectedElectrical(code, step, isNewHold){
  if(!selectedElectricalId) return;
  const base = findElectricalBase(selectedElectricalId);
  if(!base) return;
  const eff = effectiveElectrical(base);
  if(eff.mount === 'exterior') return;
  const delta = (code==='ArrowRight'||code==='ArrowUp') ? step : -step;
  if(eff.mount === 'wall'){
    if(code==='ArrowUp'||code==='ArrowDown') return; // 壁付けは沿い方向1軸のみ（←→だけ使う）
    const axis = eff.orientation === 'H' ? 'x' : 'z';
    applyElectricalPositionEdit(axis, round2(eff.center + delta), !isNewHold);
  } else {
    const axis = (code==='ArrowLeft'||code==='ArrowRight') ? 'x' : 'z';
    const cur = axis==='x' ? eff.x : eff.z;
    applyElectricalPositionEdit(axis, round2(cur + delta), !isNewHold);
  }
}
function updateElectricalBar(){
  const editCount = Object.keys(electricalEdits).length;
  const addCount = electricalAdded.length;
  const delCount = electricalDeleted.length;
  const parts = [];
  if(editCount) parts.push(`変更${editCount}`);
  if(addCount) parts.push(`追加${addCount}`);
  if(delCount) parts.push(`削除${delCount}`);
  document.getElementById('ebCount').textContent = parts.length ? `編集済み: ${parts.join('・')}` : '編集なし';
  document.getElementById('ebUndo').disabled = electricalUndoStack.length===0;
  document.getElementById('ebRedo').disabled = electricalRedoStack.length===0;
  updateElectricalChangeHighlights();
}
// 部屋フォーカス中の右上パネルを、現在のfocusedRoomIdの内容で再描画する（追加・削除・復元の
// いずれの後でも、パネルの件数・内訳を最新に保つために呼ぶ）
function refreshRoomFocusElecPanel(){
  if(!focusedRoomId) return;
  const target = roomMeshesById.get(focusedRoomId);
  const level = target ? target.level : 1;
  const roomObj = (ROOMS_APPROX[level]||[]).find(r=>r.id===focusedRoomId);
  renderRoomFocusElecList(buildElectricalSummary(), focusedRoomId, roomObj ? roomObj.name : focusedRoomId);
}
function applyElectricalTypeChange(newType){
  if(!selectedElectricalId) return;
  const profile = ELECTRICAL_CATALOG[newType];
  if(!profile) return;
  // shape/category/heightRefも必ずパッチする。shapeを更新し忘れるとplaceElectricalItem()が
  // 旧タイプの形状関数を使い続け、見た目が変わらないバグになる。mountは候補が既に絞られているため
  // 変わらないはずだが、位置表現の整合を保証するため明示的にprofile.mountで揃えておく
  const patch = {
    type: newType, category: profile.category, mount: profile.mount, shape: profile.shape, heightRef: profile.heightRef,
    width: profile.width, depth: profile.depth, height: profile.height, mountHeight: profile.mountHeight,
  };
  pushElectricalUndoSnapshot();
  electricalEdits[selectedElectricalId] = {...(electricalEdits[selectedElectricalId]||{}), ...patch};
  saveElectricalEdits();
  rebuildElectricalItem(selectedElectricalId);
  setSelectedElectrical(selectedElectricalId);
  updateElectricalBar();
}
function applyElectricalDimEdit(field, value){
  if(!selectedElectricalId) return;
  const v = parseFloat(value);
  if(!(v>0) || Number.isNaN(v)) return;
  pushElectricalUndoSnapshot();
  electricalEdits[selectedElectricalId] = {...(electricalEdits[selectedElectricalId]||{}), [field]: round2(v)};
  saveElectricalEdits();
  rebuildElectricalItem(selectedElectricalId); // width/depth/heightはfPart()のスケールに直結するため再構築が必要
  setSelectedElectrical(selectedElectricalId);
  updateElectricalBar();
}
function setElectricalSide(value){
  if(!selectedElectricalId) return;
  const base = findElectricalBase(selectedElectricalId);
  const eff = effectiveElectrical(base);
  if(eff.mount !== 'wall') return;
  pushElectricalUndoSnapshot();
  electricalEdits[selectedElectricalId] = {...(electricalEdits[selectedElectricalId]||{}), side: value};
  const entry = electricalMeshes.get(selectedElectricalId);
  if(entry){
    entry.holder.rotation.y = eff.orientation==='H' ? (value>0?0:Math.PI) : (value>0?Math.PI/2:-Math.PI/2);
  }
  saveElectricalEdits();
  setSelectedElectrical(selectedElectricalId); // 選択枠(BoxHelper)を回転後の向きで作り直す
  updateElectricalBar();
}
// 高さプリセット：X/Z/壁面には触れず、Yだけ型の標準mountHeight（floor基準に換算した値）へ戻す。
// applyElectricalPositionEdit('y',...)を経由するので、ceiling/floor/wallの変換はそちら任せにできる
function resetSelectedElectricalHeight(){
  if(!selectedElectricalId) return;
  const base = findElectricalBase(selectedElectricalId);
  if(!base) return;
  const eff = effectiveElectrical(base);
  const catalogMountHeight = ELECTRICAL_CATALOG[eff.type].mountHeight;
  const yValue = eff.mount==='ceiling' ? slopedCeilingHeightAt(eff.x, eff.z) - catalogMountHeight : catalogMountHeight;
  applyElectricalPositionEdit('y', round2(yValue));
}
// 複製：壁付けは同じ壁の空き位置(findFreeWallSlot、範囲はwallRangeForElectricalで求める現在の
// 壁区間)、天井/床付けは少しオフセットした位置に、選択中と同じ型・寸法の設備を新規追加する
function duplicateSelectedElectrical(){
  if(!selectedElectricalId) return;
  const base = findElectricalBase(selectedElectricalId);
  if(!base) return;
  const eff = effectiveElectrical(base);
  if(eff.mount === 'exterior'){ alert('屋外設備の複製はスコープ外です。data/electrical.jsonを直接編集してください。'); return; }
  const item = {
    id: nextManualElectricalId(), type: eff.type, category: eff.category, mount: eff.mount, level: eff.level,
    width: eff.width, depth: eff.depth, height: eff.height, mountHeight: eff.mountHeight,
    heightRef: eff.heightRef, shape: eff.shape, status: 'estimated', label: eff.label,
  };
  if(eff.mount === 'wall'){
    const range = wallRangeForElectrical(eff) || [eff.center - eff.width, eff.center + eff.width];
    const wall = { orientation: eff.orientation, at: eff.wallAt, from: range[0], to: range[1], side: eff.side };
    const center = findFreeWallSlot(wall, eff.width, eff.level);
    if(center === null){ alert('この壁には、複製先の空きがありません。'); return; }
    item.wallAt = eff.wallAt; item.orientation = eff.orientation; item.center = center; item.side = eff.side;
  } else {
    item.x = round2(eff.x + 0.3); item.z = round2(eff.z + 0.3); // 天井/床付けは少しずらして重ならないようにする
  }
  pushElectricalUndoSnapshot();
  electricalAdded.push(item);
  saveElectricalAdded();
  placeElectricalItem(effectiveElectrical(item));
  refreshRoomFocusElecPanel();
  setSelectedElectrical(item.id);
  updateElectricalBar();
}
function resetSelectedElectrical(){
  if(!selectedElectricalId) return;
  pushElectricalUndoSnapshot();
  delete electricalEdits[selectedElectricalId];
  saveElectricalEdits();
  rebuildElectricalItem(selectedElectricalId);
  setSelectedElectrical(selectedElectricalId);
  updateElectricalBar();
}
// 削除：即座にデータを消さず、electricalDeletedへidを積む（墓標）だけにする。3Dからは消えるが、
// electrical-catalog.json側の型定義やdata/electrical.jsonの元データは変わらないため、
// 一覧モーダルの「削除した設備」から個別に復元できる
function deleteSelectedElectrical(){
  if(!selectedElectricalId) return;
  const base = findElectricalBase(selectedElectricalId);
  if(!base) return;
  const label = elecItemDisplayLabel(effectiveElectrical(base));
  if(!confirm(`「${label}」を削除します。一覧モーダルの「削除した設備」からいつでも復元できます。よろしいですか？`)) return;
  pushElectricalUndoSnapshot();
  const id = selectedElectricalId;
  electricalDeleted.push(id);
  saveElectricalDeleted();
  removeElectricalMesh(id);
  setSelectedElectrical(null);
  refreshRoomFocusElecPanel();
  updateElectricalBar();
}
// 復元：electricalDeletedからidを外し、元のデータ（editsが残っていればそれも含めて）で再配置する
function restoreDeletedElectrical(id){
  const idx = electricalDeleted.indexOf(id);
  if(idx<0) return;
  pushElectricalUndoSnapshot();
  electricalDeleted.splice(idx,1);
  saveElectricalDeleted();
  const base = findElectricalBase(id);
  if(base) placeElectricalItem(effectiveElectrical(base));
  refreshRoomFocusElecPanel();
  updateElectricalBar();
}
function buildElectricalPayload(){
  const items = savedElectricalItems().map(base=>{
    const eff = effectiveElectrical(base);
    const cat = ELECTRICAL_CATALOG[eff.type]; // 型を切り替えられるため、比較対象は必ず「現在の型」の既定値にする
    const out = { id: base.id, type: eff.type, level: base.level };
    if(eff.mount === 'wall'){
      out.wallAt = eff.wallAt; out.orientation = eff.orientation; out.center = round2(eff.center); out.side = eff.side;
    } else if(eff.mount === 'exterior'){
      out.face = eff.face; out.offset = round2(eff.offset);
      if(eff.wallX !== undefined) out.wallX = eff.wallX;
    } else {
      out.x = round2(eff.x); out.z = round2(eff.z);
    }
    if(base.room) out.room = base.room;
    if(base.aimDirection) out.aimDirection = base.aimDirection;
    if(base.set !== undefined){ out.set = base.set; out.variant = base.variant; }
    if(round2(eff.width) !== round2(cat.width)) out.widthOverride = round2(eff.width);
    if(round2(eff.depth) !== round2(cat.depth)) out.depthOverride = round2(eff.depth);
    if(round2(eff.height) !== round2(cat.height)) out.heightOverride = round2(eff.height);
    if(round2(eff.mountHeight) !== round2(cat.mountHeight)) out.mountHeightOverride = round2(eff.mountHeight);
    if(base.label) out.label = base.label;
    out.status = base.status;
    if(base.note) out.note = base.note; // 2026-09-16修正：以前は書き出されず、根拠メモが書き出しの度に消えていた
    return out;
  });
  return {
    schemaVersion: '1.0.0', units: 'm',
    note: '電気設備の配置インスタンス。typeはdata/electrical-catalog.jsonのtypeを参照する。mount:wallの型はwallAt+orientation+center+side（wallAt=壁の固定座標、centerは壁沿いの位置、side=+1/-1で壁のどちら側を向くか）、mount:ceiling/floorの型はx+z（footprint内の自由座標、furniture.jsonと同じ）で位置を表す。ブラウザの配置編集機能から書き出したファイル。data/electrical.json に上書きしてコミットすること。',
    items,
  };
}
function exportElectricalJSON(){ downloadJSON(buildElectricalPayload(), 'electrical.json'); }
document.getElementById('epClose').onclick = ()=> setSelectedElectrical(null);
document.getElementById('epType').onchange = e=> applyElectricalTypeChange(e.target.value);
document.getElementById('epWidth').onchange = e=> applyElectricalDimEdit('width', e.target.value);
document.getElementById('epDepth').onchange = e=> applyElectricalDimEdit('depth', e.target.value);
document.getElementById('epHeight').onchange = e=> applyElectricalDimEdit('height', e.target.value);
document.getElementById('epPosX').onchange = e=> applyElectricalPositionEdit('x', e.target.value);
document.getElementById('epPosY').onchange = e=> applyElectricalPositionEdit('y', e.target.value);
document.getElementById('epPosZ').onchange = e=> applyElectricalPositionEdit('z', e.target.value);
document.getElementById('epSidePos').onclick = ()=> setElectricalSide(1);
document.getElementById('epSideNeg').onclick = ()=> setElectricalSide(-1);
document.getElementById('epHeightPreset').onclick = resetSelectedElectricalHeight;
document.getElementById('epDuplicate').onclick = duplicateSelectedElectrical;
document.getElementById('epReset').onclick = resetSelectedElectrical;
document.getElementById('epDelete').onclick = deleteSelectedElectrical;
document.getElementById('ebUndo').onclick = undoElectrical;
document.getElementById('ebRedo').onclick = redoElectrical;
document.getElementById('ebExport').onclick = exportElectricalJSON;
document.getElementById('ebClearAll').onclick = ()=>{
  const hasEdits = Object.keys(electricalEdits).length>0 || electricalAdded.length>0 || electricalDeleted.length>0;
  if(!hasEdits) return;
  if(!confirm('電気設備の編集内容（変更・追加・削除）をすべて取り消し、元の配置に戻します。よろしいですか？')) return;
  pushElectricalUndoSnapshot();
  const addedIds = new Set(electricalAdded.map(a=>a.id));
  // 削除・変更は「元データ(ELECTRICAL_ITEMS)にあった項目」だけを差し戻し対象にする。
  // 追加してから削除した項目（addedIdsに含まれる）は、追加分ごと丸ごと撤去するので個別処理は不要
  const deletedOriginalIds = electricalDeleted.filter(id=> !addedIds.has(id));
  const editedIds = Object.keys(electricalEdits).filter(id=> !addedIds.has(id));
  electricalEdits = {};
  saveElectricalEdits();
  electricalDeleted = [];
  saveElectricalDeleted();
  electricalAdded.forEach(item=> removeElectricalMesh(item.id)); // 追加分の3Dを撤去
  electricalAdded = [];
  saveElectricalAdded();
  editedIds.forEach(id=> rebuildElectricalItem(id)); // 元データの変更を差し戻す
  deletedOriginalIds.forEach(id=>{ const base = ELECTRICAL_ITEMS.find(e=>e.id===id); if(base) placeElectricalItem(effectiveElectrical(base)); }); // 元データの削除を復元
  setSelectedElectrical(null);
  refreshRoomFocusElecPanel();
  updateElectricalBar();
};
document.getElementById('electricalEditToggle').onclick = ()=> setElectricalEditMode(!electricalEditMode);
document.getElementById('edCloseBtn').onclick = ()=> setElectricalEditMode(false);
updateElectricalBar();

// ============================================================================
// 部屋フォーカス（俯瞰モード限定）：1部屋だけを表示し、他室の壁に隠れず・邪魔されずに
// 家具・電気設備の配置を確認できるようにする
// ============================================================================
// 点(x,z)が多角形pts（[[x,z],...]）の内側にあるかを判定する（レイキャスティング法）
function pointInPolygon(x, z, pts){
  let inside = false;
  for(let i=0, j=pts.length-1; i<pts.length; j=i++){
    const [xi,zi] = pts[i], [xj,zj] = pts[j];
    const intersect = ((zi>z) !== (zj>z)) && (x < (xj-xi)*(z-zi)/(zj-zi)+xi);
    if(intersect) inside = !inside;
  }
  return inside;
}
// ROOMS_APPROXの1要素からポリゴン頂点を取り出す。polyがあればそれを、なければbboxの
// 4頂点を使う（判定ロジックを常に同じpointInPolygon経路に統一するための橋渡し）
function roomPolygonPoints(r){
  return r.poly || [[r.x0,r.z0],[r.x1,r.z0],[r.x1,r.z1],[r.x0,r.z1]];
}
// 多角形の頂点平均（重心近似）。L字部屋でbboxの中心が部屋の外に出てしまう場合の
// フォールバックに使う（scripts/seed-electrical.mjsのcentroid()と同じ考え方）
function centroid(polygon){
  let x=0, z=0;
  polygon.forEach(([px,pz])=>{ x+=px; z+=pz; });
  return { x: x/polygon.length, z: z/polygon.length };
}
// 点(x,z)がlevel階のどの部屋に属するかをROOMS_APPROXから動的に判定する。家具・電気設備の
// 既存roomフィールドは使わない（ドラッグで位置が変わってもroomフィールドは追随せず陳腐化するため）
function findRoomIdAt(x, z, level){
  const rooms = ROOMS_APPROX[level] || [];
  const hit = rooms.find(r=> r.id && pointInPolygon(x, z, roomPolygonPoints(r)));
  return hit ? hit.id : null;
}
// 壁付け電気設備の部屋所属判定用プローブ点：壁面からsideが向く方向へ0.1mオフセットした点。
// 天井/床付けはx/zそのまま。屋外(exterior)は対象外(null、フォーカス中は常に非表示)
const ROOM_PROBE_OFFSET = 0.1;
function electricalRoomProbePoint(eff){
  if(eff.mount === 'exterior') return null;
  if(eff.mount !== 'wall') return { x: eff.x, z: eff.z };
  const alongX = eff.orientation==='H' ? eff.center : eff.wallAt;
  const alongZ = eff.orientation==='H' ? eff.wallAt : eff.center;
  return eff.orientation==='H'
    ? { x: alongX, z: alongZ + eff.side*ROOM_PROBE_OFFSET }
    : { x: alongX + eff.side*ROOM_PROBE_OFFSET, z: alongZ };
}
// ドア・窓の部屋所属判定：doorWindowMeshesのentry.probe（placeInteriorDoor/placeDiagonalInteriorDoor/
// placeOpeningで設定済み）を使う。内部ドア(H/V)・斜め開口(D)は2部屋の境界にあり片側の情報(side相当)を
// 持たないため、壁の両側をプローブしていずれかが対象室ならtrueとする。外部開口(isExterior)は屋内側の
// 1点のみで判定する（outSignの逆方向が屋内側）
function doorMatchesFocusedRoom(entry, targetLevel, targetId){
  if(entry.level !== targetLevel || !entry.probe) return false;
  const pr = entry.probe;
  if(entry.isExterior){
    const inward = -pr.outSign;
    const x = pr.orientation==='H' ? pr.alongMid : pr.wallCoord + inward*ROOM_PROBE_OFFSET;
    const z = pr.orientation==='H' ? pr.wallCoord + inward*ROOM_PROBE_OFFSET : pr.alongMid;
    return findRoomIdAt(x, z, targetLevel) === targetId;
  }
  if(pr.orientation==='D'){
    const p1x = pr.midX + pr.perpX*ROOM_PROBE_OFFSET, p1z = pr.midZ + pr.perpZ*ROOM_PROBE_OFFSET;
    const p2x = pr.midX - pr.perpX*ROOM_PROBE_OFFSET, p2z = pr.midZ - pr.perpZ*ROOM_PROBE_OFFSET;
    return findRoomIdAt(p1x, p1z, targetLevel)===targetId || findRoomIdAt(p2x, p2z, targetLevel)===targetId;
  }
  const x1 = pr.orientation==='H' ? pr.center : pr.wallAt+ROOM_PROBE_OFFSET;
  const z1 = pr.orientation==='H' ? pr.wallAt+ROOM_PROBE_OFFSET : pr.center;
  const x2 = pr.orientation==='H' ? pr.center : pr.wallAt-ROOM_PROBE_OFFSET;
  const z2 = pr.orientation==='H' ? pr.wallAt-ROOM_PROBE_OFFSET : pr.center;
  return findRoomIdAt(x1, z1, targetLevel)===targetId || findRoomIdAt(x2, z2, targetLevel)===targetId;
}

// ============================================================================
// 電気設備一覧（型ごとの集計＋部屋ごとの内訳）。「電気計画を真剣に検討したい」という施主要望を受け、
// 型ごとの総数と部屋ごとの設置内訳を俯瞰できるようにする（2026-08-19）
// ============================================================================
// data/electrical-catalog.jsonのcategoriesと同じ5分類・同じ順序をここに固定で持つ（表示専用の
// ロジックのため、データパイプライン側は変更しない）。色は既存の凡例・EMAT（3D描画）と同じパレット
const ELEC_CATEGORY_ORDER = [
  ['outlet', 'コンセント', '#8e24aa'], ['switch', 'スイッチ', '#8e24aa'],
  ['lighting', '照明', '#ffab00'], ['data', '情報系配線', '#00897b'], ['equipment', '関連設備', '#37474f'], ['reserve', '予備の位置', '#2f6db5'],
];
function elecItemDisplayLabel(eff){
  return eff.label || (ELECTRICAL_CATALOG[eff.type]||{}).label || eff.type;
}
// 電気設備の集計：型ごとの総数、部屋ごとの内訳、屋外設備、部屋未判定（本来起こらない想定だが、
// 編集で部屋の外に出た場合の検知用に残す）をallElectricalItems()+effectiveElectrical()から
// 都度組み立てる。部屋所属はfocusRoom()と同じelectricalRoomProbePoint()+findRoomIdAt()の
// 動的判定を使う（ELECTRICAL_ITEMSの静的なroomフィールドはシードスクリプト由来で編集後は
// 追随しないため使わない）。あわせて、data/electrical-estimate.json（見積書の明細）と
// 現在数を明細単位で突き合わせる（削除・追加を始めると見積との差分が追いにくくなるため）
function buildElectricalSummary(){
  const byType = new Map(); // type -> {label, category, count}
  const roomBuckets = new Map(); // roomId -> row[]
  const exteriorItems = [];
  const unassigned = [];
  let count1 = 0, count2 = 0, total = 0;
  const typeToLine = new Map(); // type -> 見積明細id
  ELECTRICAL_ESTIMATE.forEach(line=> line.types.forEach(t=> typeToLine.set(t, line.id)));
  const lineCounts = new Map(ELECTRICAL_ESTIMATE.map(l=>[l.id, 0]));
  const outsideEstimateByType = new Map(); // 見積のどの明細にも属さない型 -> {label,category,count}
  allElectricalItems().forEach(base=>{
    const eff = effectiveElectrical(base);
    total++;
    if(!byType.has(eff.type)) byType.set(eff.type, { label: (ELECTRICAL_CATALOG[eff.type]||{}).label || eff.type, category: eff.category, count: 0 });
    byType.get(eff.type).count++;
    if(eff.level===1) count1++; else count2++;
    const lineId = typeToLine.get(eff.type);
    if(lineId){
      lineCounts.set(lineId, lineCounts.get(lineId)+1);
    } else {
      if(!outsideEstimateByType.has(eff.type)) outsideEstimateByType.set(eff.type, { label: (ELECTRICAL_CATALOG[eff.type]||{}).label || eff.type, category: eff.category, count: 0 });
      outsideEstimateByType.get(eff.type).count++;
    }
    const row = { id: eff.id, label: elecItemDisplayLabel(eff), category: eff.category, type: eff.type };
    if(eff.mount === 'exterior'){ exteriorItems.push(row); return; }
    const p = electricalRoomProbePoint(eff);
    const roomId = p ? findRoomIdAt(p.x, p.z, eff.level) : null;
    if(!roomId){ unassigned.push(row); return; }
    if(!roomBuckets.has(roomId)) roomBuckets.set(roomId, []);
    roomBuckets.get(roomId).push(row);
  });
  const estimateLines = ELECTRICAL_ESTIMATE.map(line=> ({
    id: line.id, label: line.label, quantity: line.quantity, current: lineCounts.get(line.id) || 0,
  }));
  const estimateTotal = ELECTRICAL_ESTIMATE.reduce((a,l)=>a+l.quantity, 0);
  return {
    byType, roomBuckets, exteriorItems, unassigned, total, count1, count2,
    estimateLines, estimateTotal, outsideEstimate: [...outsideEstimateByType.values()],
  };
}
// 削除済み設備（電気設備一覧モーダルの「削除した設備」欄・復元操作が使う）
function deletedElectricalItems(){
  return electricalDeleted.map(id=> findElectricalBase(id)).filter(Boolean).map(base=>{
    const eff = effectiveElectrical(base);
    return { id: eff.id, label: elecItemDisplayLabel(eff), category: eff.category };
  });
}
// rowの配列をカテゴリ順に並べ、クリック可能な行（data-elec-id）としてHTML化する共通レンダラー。
// 一覧モーダルの部屋別内訳・屋外設備・部屋未判定と、部屋フォーカスパネルの設置物リストの両方から使う
// カテゴリ見出しと個別設備が同じ見た目の行に並んで紛らわしい、という施主指摘（2026-08-19）を受けて
// 再設計。カテゴリごとに色付きの縦線でグルーピングし、見出しには「自分自身の件数」を明記して
// 「一覧の1項目」と誤読されないようにする（例：見出し「コンセント（3）」＋その下に個別設備3行）
function renderElecItemRows(items){
  let html = '';
  ELEC_CATEGORY_ORDER.forEach(([cat, catLabel, color])=>{
    const rows = items.filter(r=>r.category===cat);
    if(!rows.length) return;
    html += `<div class="elecCatGroup" style="border-left-color:${color};">`;
    html += `<div class="elecListCat">${catLabel}（${rows.length}）</div>`;
    rows.forEach(r=>{
      html += `<div class="elecListRow" data-elec-id="${r.id}">${r.label}</div>`;
    });
    html += '</div>';
  });
  return html;
}
// 見積書の明細ごとに「現在数 / 見積数」を表示する。各明細の下には、内訳として実際に
// 使われている型ごとの件数をぶら下げる（電灯配線41の中身がダウンライト30・シーリング7…と
// 分かるように）。差が出ている明細は.elecEstimateDiffで目立たせる
function renderEstimateLines(s){
  let html = '';
  s.estimateLines.forEach(line=>{
    const diff = line.current - line.quantity;
    const estLine = ELECTRICAL_ESTIMATE.find(l=>l.id===line.id);
    const typeRows = (estLine ? estLine.types : []).map(t=> s.byType.get(t)).filter(Boolean);
    html += `<div class="elecEstimateLine${diff!==0 ? ' elecEstimateDiff' : ''}">`;
    html += `<div class="elecEstimateLineHead"><span>${line.label}</span><span class="count">現在${line.current} / 見積${line.quantity}${diff!==0 ? `（${diff>0?'+':''}${diff}）` : ''}</span></div>`;
    if(typeRows.length) html += `<div class="elecEstimateLineTypes">${typeRows.map(v=>`${v.label} ${v.count}`).join('　')}</div>`;
    html += '</div>';
  });
  if(s.outsideEstimate.length){
    const outsideTotal = s.outsideEstimate.reduce((a,v)=>a+v.count, 0);
    html += `<div class="elecEstimateLine"><div class="elecEstimateLineHead"><span>見積外</span><span class="count">現在${outsideTotal}件</span></div>`;
    html += `<div class="elecEstimateLineTypes">${s.outsideEstimate.map(v=>`${v.label} ${v.count}`).join('　')}</div></div>`;
  }
  return html;
}
function renderElectricalSummary(){
  const s = buildElectricalSummary();
  const diffTotal = s.total - s.estimateTotal;
  let html = `<div class="elecSummaryTotal">合計 現在${s.total}件 / 見積${s.estimateTotal}件${diffTotal!==0 ? `（${diffTotal>0?'+':''}${diffTotal}）` : ''}（1F ${s.count1}件／2F ${s.count2}件／屋外${s.exteriorItems.length}件）</div>`;
  html += renderEstimateLines(s);
  // 部屋フォーカス中は、合計・見積差分（上記まで）はフィルタせず、階見出し以下だけを
  // フォーカス中の部屋1件に絞る（施主指摘：一覧を部屋フォーカスと連動させたい）
  if(focusedRoomId){
    const target = roomMeshesById.get(focusedRoomId);
    const level = target ? target.level : 1;
    const room = (ROOMS_APPROX[level]||[]).find(r=>r.id===focusedRoomId);
    const rows = s.roomBuckets.get(focusedRoomId) || [];
    html += `<div class="elecSummaryLevelTitle">${level}F</div>`;
    html += rows.length
      ? `<div class="elecSummaryRoom"><div class="elecSummaryRoomName">${room?room.name:focusedRoomId}（${rows.length}件）</div>${renderElecItemRows(rows)}</div>`
      : `<div class="elecSummaryRoom"><div class="elecSummaryRoomName empty">${room?room.name:focusedRoomId}：0件</div></div>`;
  } else {
    [1,2].forEach(level=>{
      html += `<div class="elecSummaryLevelTitle">${level}F</div>`;
      ROOMS_APPROX[level].forEach(r=>{
        if(!r.id) return;
        const rows = s.roomBuckets.get(r.id) || [];
        html += rows.length
          ? `<div class="elecSummaryRoom"><div class="elecSummaryRoomName">${r.name}（${rows.length}件）</div>${renderElecItemRows(rows)}</div>`
          : `<div class="elecSummaryRoom"><div class="elecSummaryRoomName empty">${r.name}：0件</div></div>`;
      });
    });
    if(s.exteriorItems.length){
      html += `<div class="elecSummaryLevelTitle">屋外設備</div><div class="elecSummaryRoom">${renderElecItemRows(s.exteriorItems)}</div>`;
    }
    if(s.unassigned.length){
      html += `<div class="elecSummaryLevelTitle">部屋未判定（${s.unassigned.length}件）</div><div class="elecSummaryRoom">${renderElecItemRows(s.unassigned)}</div>`;
    }
  }
  // 削除した設備：部屋フォーカスの絞り込みとは無関係に常に表示する（復元操作はどの部屋を
  // 見ていても行えるようにするため）
  const deleted = deletedElectricalItems();
  if(deleted.length){
    html += `<div class="elecSummaryLevelTitle">削除した設備（${deleted.length}件）</div><div class="elecSummaryRoom">`;
    html += deleted.map(r=> `<div class="elecDeletedRow"><span>${r.label}</span><button class="elecRestoreBtn" data-elec-restore-id="${r.id}">復元</button></div>`).join('');
    html += '</div>';
  }
  document.getElementById('electricalSummaryBody').innerHTML = html;
}
function openElectricalSummary(){
  renderElectricalSummary();
  document.getElementById('electricalSummaryOverlay').style.display = 'flex';
}
function closeElectricalSummary(){
  document.getElementById('electricalSummaryOverlay').style.display = 'none';
}
document.getElementById('electricalSummaryOpenBtn').onclick = openElectricalSummary;
document.getElementById('electricalSummaryClose').onclick = closeElectricalSummary;
document.getElementById('electricalSummaryOverlay').onclick = e=>{ if(e.target.id==='electricalSummaryOverlay') closeElectricalSummary(); };
// 一覧・部屋フォーカスの設置物リストの行から、該当設備を選択して編集パネルを開く共通処理。
// 俯瞰モードでなければ切り替え、部屋に属する設備なら部屋フォーカスも合わせて行う
function selectElectricalFromSummary(id){
  const base = findElectricalBase(id);
  if(!base) return;
  if(mode !== 'orbit') setMode('orbit');
  const eff = effectiveElectrical(base);
  if(eff.mount !== 'exterior'){
    const p = electricalRoomProbePoint(eff);
    const roomId = p ? findRoomIdAt(p.x, p.z, eff.level) : null;
    if(roomId && roomId !== focusedRoomId) focusRoom(roomId);
  }
  if(!electricalEditMode) setElectricalEditMode(true);
  setSelectedElectrical(id);
}
document.getElementById('electricalSummaryBody').addEventListener('click', e=>{
  // 復元ボタンを先に判定する（「削除した設備」欄はdata-elec-idを持たないクリック不可の行の中に
  // data-elec-restore-idを持つボタンだけを置いているため、実際には衝突しないが念のため先に見る）
  const restoreBtn = e.target.closest('[data-elec-restore-id]');
  if(restoreBtn){
    restoreDeletedElectrical(restoreBtn.dataset.elecRestoreId);
    renderElectricalSummary(); // 削除リストから消え、該当部屋の内訳に戻ったところまで反映する
    return;
  }
  const row = e.target.closest('[data-elec-id]');
  if(!row) return;
  closeElectricalSummary();
  selectElectricalFromSummary(row.dataset.elecId);
});
// 部屋フォーカス時の設置物リスト：電気設備編集ドックのリスト段（#edListSection）に表示する。
// focusRoom()/clearFocus()から表示/描画・非表示を行う。
// 既にその部屋へフォーカス済みのため、行クリックはfocusRoom()の再呼び出しなしで選択のみ行う
function renderRoomFocusElecList(summary, roomId, roomName){
  const rows = summary.roomBuckets.get(roomId) || [];
  document.getElementById('roomFocusElecPanelHead').textContent = `${roomName}の電気設備（${rows.length}件）`;
  document.getElementById('roomFocusElecPanelBody').innerHTML = rows.length
    ? renderElecItemRows(rows)
    : '<div class="sub" style="margin:0;">この部屋に電気設備はありません。</div>';
  document.getElementById('edListSection').style.display = 'flex';
}
document.getElementById('roomFocusElecPanelBody').addEventListener('click', e=>{
  const row = e.target.closest('[data-elec-id]');
  if(!row) return;
  if(!electricalEditMode) setElectricalEditMode(true);
  setSelectedElectrical(row.dataset.elecId);
});

// ============================================================================
// 電気設備の追加：どの壁面に付けるかを選ばせる。壁付け設備(mount:'wall')は追加後、
// XYZ編集パネルで壁面側の座標をロックする設計にしているため（前回実装）、「とりあえず
// 置いてから動かす」ができない。追加する時点で壁を選ばせ、side（壁のどちら側＝部屋の
// 内側を向くか）まで確定させる（2026-08-19、施主指摘）
// ============================================================================
// 部屋に接する壁セグメント（内壁+外壁+ドア切り欠き済みのwallSegmentsByLevel、腰壁は除く）を、
// 部屋の内側を向くside込みで返す。electricalRoomProbePoint()（壁面からsideの方向へ0.1mずらした
// 点で部屋所属を判定する）と同じ規約の逆変換：壁の両側をそれぞれ0.1mずらしてfindRoomIdAt()で
// 判定し、対象室に入った側をこの壁のsideとして採用する
function wallsForRoom(roomId, level){
  const target = roomMeshesById.get(roomId);
  if(!target) return [];
  const b = target.bbox;
  const segs = (wallSegmentsByLevel[level] || []).filter(s=> s.guardHeight === undefined); // 腰壁(転落防止用)は対象外
  const result = [];
  segs.forEach(s=>{
    const roomLo = s.orientation==='H' ? b.x0 : b.z0, roomHi = s.orientation==='H' ? b.x1 : b.z1;
    const lo = Math.max(s.from, roomLo), hi = Math.min(s.to, roomHi);
    if(hi - lo < 0.3) return; // 器具1つ分にも満たない短い重なりは候補から除く
    const mid = (lo+hi)/2;
    const p1 = s.orientation==='H' ? {x:mid, z:s.at+ROOM_PROBE_OFFSET} : {x:s.at+ROOM_PROBE_OFFSET, z:mid};
    const p2 = s.orientation==='H' ? {x:mid, z:s.at-ROOM_PROBE_OFFSET} : {x:s.at-ROOM_PROBE_OFFSET, z:mid};
    let side;
    if(findRoomIdAt(p1.x, p1.z, level) === roomId) side = 1;
    else if(findRoomIdAt(p2.x, p2.z, level) === roomId) side = -1;
    else return; // どちらの側からもこの部屋に届かない
    const dirLabel = s.orientation==='H' ? (side>0?'北側':'南側') : (side>0?'西側':'東側');
    result.push({ orientation:s.orientation, at:s.at, from:lo, to:hi, side, mid, dirLabel });
  });
  return result;
}
// 壁(wall、wallsForRoom()の1要素)の中で、既存の壁付け設備（元データ＋これまでの追加分の両方、
// 編集差分を反映した実効値）と重ならない空きcenter座標を探す。同じ壁に複数追加すると全て
// wall.mid（壁区間の中点）に重なって配置されてしまう不具合があったため新設（2026-08-20、
// 施主指摘：重なった状態だと常に手前の1つしかクリックで選択できず、削除しても見た目上
// 消えたように見えなかった）。当初は誤クリック防止の余裕を持たせてgap=0.4m（40cm、
// scripts/seed-electrical.mjsのplaceWallItems()が最初に採用した値を踏襲）だったが、
// 実際の住宅では3連スイッチ等、設備同士が数cm間隔で並ぶのが普通で、既にそのように密集
// 配置された壁（例：data/electrical.jsonの3連スイッチ群）に対してこの機能から1つ追加しよ
// うとすると、既存設備群の0.4m占有ゾーンが重なり合って壁のほぼ全域を覆ってしまい、実際には
// 見た目上まだ余裕がある壁でも「空きがありません」と拒否される問題があった。施主指摘により
// gap=0.03m（3cm、クリックで個別選択できる最低限の隙間）へ縮小（2026-09-14）
function findFreeWallSlot(wall, width, level, excludeId){
  const halfW = width/2, margin = 0.05, gap = 0.03;
  const occ = allElectricalItems()
    .filter(base => base.id !== excludeId)
    .map(base => effectiveElectrical(base))
    .filter(e => e.mount==='wall' && e.level===level && e.orientation===wall.orientation && Math.abs(e.wallAt-wall.at)<0.01)
    .map(e => [e.center-e.width/2-gap, e.center+e.width/2+gap])
    .filter(([lo,hi]) => hi>wall.from && lo<wall.to)
    .sort((a,b)=>a[0]-b[0]);
  const fitsAt = pos => pos-halfW>=wall.from+margin && pos+halfW<=wall.to-margin
    && occ.every(([lo,hi])=> pos+halfW<=lo || pos-halfW>=hi);
  if(fitsAt(wall.mid)) return round2(wall.mid); // 空いていれば中央に置く（見た目が自然なため）
  let pos = wall.from + halfW + margin; // 中央が塞がっていれば壁の端からfirst-fitで空きを探す
  for(const [lo,hi] of occ){
    if(pos + halfW <= lo) break;
    if(pos < hi) pos = hi + halfW;
  }
  if(pos + halfW > wall.to - margin) return null; // 空きなし
  return round2(pos);
}
let electricalAddRoomId = null; // 追加ダイアログを開いた時点のfocusedRoomIdを固定して持つ
function openElectricalAdd(){
  if(!focusedRoomId) return;
  electricalAddRoomId = focusedRoomId;
  const target = roomMeshesById.get(focusedRoomId);
  const roomObj = target ? (ROOMS_APPROX[target.level]||[]).find(r=>r.id===focusedRoomId) : null;
  document.getElementById('electricalAddRoomLabel').textContent = `追加先：${roomObj ? roomObj.name : focusedRoomId}`;
  const typeSel = document.getElementById('eaType');
  // 屋外設備(mount:'exterior')は既存のドラッグ移動・XYZ編集と同じくスコープ外のため候補から除く
  typeSel.innerHTML = ELEC_CATEGORY_ORDER.map(([cat,catLabel])=>{
    const opts = Object.entries(ELECTRICAL_CATALOG).filter(([,p])=>p.category===cat && p.mount!=='exterior')
      .map(([k,p])=>`<option value="${k}">${p.label}</option>`).join('');
    return opts ? `<optgroup label="${catLabel}">${opts}</optgroup>` : '';
  }).join('');
  updateElectricalAddForm();
  document.getElementById('electricalAddOverlay').style.display = 'flex';
}
function closeElectricalAdd(){
  document.getElementById('electricalAddOverlay').style.display = 'none';
}
// 型の切替に応じて、壁面選択欄の表示/候補・案内文を更新する
function updateElectricalAddForm(){
  const type = document.getElementById('eaType').value;
  const profile = ELECTRICAL_CATALOG[type];
  const wallArea = document.getElementById('eaWallArea');
  const ceilingHint = document.getElementById('eaCeilingHint');
  if(!profile) return;
  if(profile.mount === 'wall'){
    wallArea.style.display = '';
    ceilingHint.style.display = 'none';
    const target = roomMeshesById.get(electricalAddRoomId);
    const walls = target ? wallsForRoom(electricalAddRoomId, target.level) : [];
    const wallSel = document.getElementById('eaWall');
    wallSel.innerHTML = walls.length
      ? walls.map((w,i)=> `<option value="${i}">${w.dirLabel}の壁（幅${Math.round((w.to-w.from)*1000)}mm）</option>`).join('')
      : '<option value="">（この部屋に接する壁が見つかりません）</option>';
    wallSel.dataset.walls = JSON.stringify(walls);
  } else {
    wallArea.style.display = 'none';
    ceilingHint.style.display = '';
  }
}
document.getElementById('eaType').onchange = updateElectricalAddForm;
document.getElementById('roomFocusElecAddBtn').onclick = openElectricalAdd;
document.getElementById('electricalAddClose').onclick = closeElectricalAdd;
document.getElementById('electricalAddOverlay').onclick = e=>{ if(e.target.id==='electricalAddOverlay') closeElectricalAdd(); };
// id は elec-m01 のように「m(manual)+連番」で採番する。シードスクリプトのelec-001…や
// 復元可能な削除済みidとも衝突しないことを確認しながら採番する
let electricalAddSeq = 0;
function nextManualElectricalId(){
  const existingIds = new Set([...ELECTRICAL_ITEMS, ...electricalAdded].map(e=>e.id));
  let n = electricalAddSeq, id;
  do { n++; id = `elec-m${String(n).padStart(2,'0')}`; } while(existingIds.has(id));
  electricalAddSeq = n;
  return id;
}
document.getElementById('eaSubmit').onclick = ()=>{
  const roomId = electricalAddRoomId;
  const target = roomMeshesById.get(roomId);
  if(!roomId || !target) return;
  const type = document.getElementById('eaType').value;
  const profile = ELECTRICAL_CATALOG[type];
  if(!profile) return;
  const level = target.level;
  const roomObj = (ROOMS_APPROX[level]||[]).find(r=>r.id===roomId);
  // ELECTRICAL_ITEMS（scripts/build-web-data.mjsのbuildElectricalItems()がカタログのプロファイルを
  // 展開して生成したもの）と同じ形にする。プロファイルの値をそのまま複製しないと、shape/widthが
  // 欠けてplaceElectricalItem()が何も描画できずelectricalMeshesにも登録されない
  const item = {
    id: nextManualElectricalId(), type, category: profile.category, mount: profile.mount, level,
    width: profile.width, depth: profile.depth, height: profile.height, mountHeight: profile.mountHeight,
    heightRef: profile.heightRef, shape: profile.shape, status: 'estimated', room: roomId,
  };
  if(profile.mount === 'wall'){
    const walls = JSON.parse(document.getElementById('eaWall').dataset.walls || '[]');
    const idx = Number(document.getElementById('eaWall').value);
    const w = walls[idx];
    if(!w){ alert('この部屋に接する壁が見つからなかったため追加できません。'); return; }
    const center = findFreeWallSlot(w, profile.width, level);
    if(center === null){ alert('この壁には、既存の設備と重ならずに置ける空きがありません。別の壁を選ぶか、既存の設備を移動してから追加してください。'); return; }
    item.wallAt = w.at; item.orientation = w.orientation; item.center = center; item.side = w.side;
  } else {
    // 天井/床付け：部屋bboxの中心（L字部屋等でbbox中心が部屋の外に出る場合はpointInPolygon()で
    // 検知し重心へフォールバック。scripts/seed-electrical.mjsのplaceCeilingItem()と同じ考え方）
    const b = target.bbox;
    let px = (b.x0+b.x1)/2, pz = (b.z0+b.z1)/2;
    if(roomObj){
      const poly = roomPolygonPoints(roomObj);
      if(!pointInPolygon(px, pz, poly)){ const c = centroid(poly); px = c.x; pz = c.z; }
    }
    item.x = round2(px); item.z = round2(pz);
  }
  // 同室・同型の既存数（追加前時点の動的な部屋所属判定）から連番を振る
  // （家具ラベル・シードスクリプトと同じ命名規則。既存の1件目が無番号のままでも、
  // 2件目以降は付番することで見分けられるようにする単純化した近似）
  const roomRowsBefore = buildElectricalSummary().roomBuckets.get(roomId) || [];
  const sameTypeCount = roomRowsBefore.filter(r=> r.type===type).length;
  item.label = sameTypeCount>0 ? `${profile.label} ${sameTypeCount+1}` : profile.label;
  pushElectricalUndoSnapshot();
  electricalAdded.push(item);
  saveElectricalAdded();
  placeElectricalItem(effectiveElectrical(item));
  closeElectricalAdd();
  refreshRoomFocusElecPanel();
  updateElectricalBar();
  if(!electricalEditMode) setElectricalEditMode(true);
  setSelectedElectrical(item.id);
};

let focusedRoomId = null;
let savedFloorModeBeforeFocus = null;
const CAM_THETA_DEFAULT = 0.9, CAM_PHI_DEFAULT = 1.05; // ページ初期表示と同じ、見やすい俯瞰角度（フォーカス時のリセットにも使う）

function focusRoom(id){
  const target = roomMeshesById.get(id);
  if(!target) return;
  if(focusedRoomId === null) savedFloorModeBeforeFocus = floorMode; // 初回フォーカス時だけ元のフロア表示を退避

  // 表示フロアをフォーカス対象の階に強制（別階を見ていると対象グループごと非表示のまま）
  const wantFloorMode = target.level===1 ? '1F' : '2F';
  if(floorMode !== wantFloorMode){ floorMode = wantFloorMode; setActiveBtn(target.level===1?'btn1F':'btn2F'); applyFloorMode(); }

  focusedRoomId = id;

  // 部屋の外形：対象室以外を非表示。ラベル(DOM要素)はメッシュのvisibleに連動しないため
  // （updateLabels()は一度display:'none'にした要素をそのまま維持する仕組みで、
  // refreshLabelVis()はチェックボックスの状態だけを見て毎回block/noneを決め直すため、
  // 単純にstyle.displayへ直接'none'を書くと、後からチェックボックスを操作した際に
  // 部屋フォーカスと無関係に復活してしまう）、l.hiddenByFocusという専用フラグを立て、
  // refreshLabelVis()側でこのフラグも判定に含めることで恒久的に非表示を維持する
  roomMeshesById.forEach((entry, rid)=>{
    const show = rid === id;
    entry.mesh.visible = show;
    entry.label.hiddenByFocus = !show;
  });
  grid.visible = false;
  roofAll.visible = false;

  // 家具：座標(x/z)がフォーカス対象の部屋ポリゴン内にあるものだけ表示
  furnitureMeshes.forEach((entry, fid)=>{
    const base = FURNITURE_ITEMS.find(f=>f.id===fid);
    if(!base){ entry.holder.visible = false; entry.label.hiddenByFocus = true; return; }
    const eff = effectiveFurniture(base);
    const show = base.level===target.level && findRoomIdAt(eff.x, eff.z, base.level) === id;
    entry.holder.visible = show;
    entry.label.hiddenByFocus = !show;
  });

  // 電気設備：屋外(exterior)は常に対象外（非表示）。壁付けはオフセット点、天井/床付けは座標そのまま
  electricalMeshes.forEach((entry, eid)=>{
    const base = findElectricalBase(eid);
    if(!base){ entry.holder.visible = false; entry.label.hiddenByFocus = true; return; }
    const eff = effectiveElectrical(base);
    if(eff.mount === 'exterior' || base.level !== target.level){
      entry.holder.visible = false; entry.label.hiddenByFocus = true; return;
    }
    const p = electricalRoomProbePoint(eff);
    const show = !!p && findRoomIdAt(p.x, p.z, base.level) === id;
    entry.holder.visible = show;
    entry.label.hiddenByFocus = !show;
  });

  // ドア・窓：対象室の境界にあるもの（隣室との間仕切りも含む）だけ表示。防音壁・腰壁は
  // 特定の部屋に紐付かない構造物のため、フォーカス中は対象室に関わらず常に非表示にする
  doorWindowMeshes.forEach((entry, did)=>{
    entry.holder.visible = doorMatchesFocusedRoom(entry, target.level, id);
  });
  soundWallGroup.visible = false;
  soundWallLabel.hiddenByFocus = true;
  guardWallGroups.forEach(g=> g.visible = false);

  refreshRoomFocusElecPanel(); // この部屋の電気設備一覧を右上パネルに表示

  refreshLabelVis(); // 上で立てたhiddenByFocusフラグ＋寸法ラベル非表示を反映する

  // カメラを対象室のbboxにフィット
  const b = target.bbox;
  const [scx, scz] = toScene((b.x0+b.x1)/2, (b.z0+b.z1)/2);
  const baseY = target.level===1 ? LEVELS.fl1 : LEVELS.fl2;
  camTarget.set(scx, baseY + CEIL_H/2, scz);
  camTheta = CAM_THETA_DEFAULT; camPhi = CAM_PHI_DEFAULT;
  const maxSpan = Math.max(b.x1-b.x0, b.z1-b.z0, 1.5); // 極端に狭い部屋でも寄り過ぎないよう下限
  const halfFovRad = THREE.MathUtils.degToRad(camera.fov)/2;
  camDist = Math.min(Math.max((maxSpan/2)/Math.tan(halfFovRad) * 1.5, 3), 70);
  updateCamera();

  updateRoomFocusUI();
}

function clearFocus(){
  if(focusedRoomId === null) return;
  focusedRoomId = null;
  roomMeshesById.forEach(entry=>{ entry.mesh.visible = true; entry.label.hiddenByFocus = false; });
  furnitureMeshes.forEach(entry=>{ entry.holder.visible = true; entry.label.hiddenByFocus = false; });
  electricalMeshes.forEach(entry=>{ entry.holder.visible = true; entry.label.hiddenByFocus = false; });
  doorWindowMeshes.forEach(entry=>{ entry.holder.visible = true; });
  soundWallGroup.visible = true;
  soundWallLabel.hiddenByFocus = false;
  guardWallGroups.forEach(g=> g.visible = true);
  document.getElementById('edListSection').style.display = 'none';
  grid.visible = document.getElementById('chkGrid').checked;
  roofAll.visible = document.getElementById('chkRoof').checked;
  refreshLabelVis(); // 部屋ラベル・寸法ラベル等をチェックボックス通りの表示状態へ一括で戻す
  if(savedFloorModeBeforeFocus && savedFloorModeBeforeFocus !== floorMode){
    floorMode = savedFloorModeBeforeFocus;
    setActiveBtn(floorMode==='both' ? 'btnBoth' : (floorMode==='1F' ? 'btn1F' : 'btn2F'));
    applyFloorMode();
  }
  savedFloorModeBeforeFocus = null;
  updateRoomFocusUI();
}

function updateRoomFocusUI(){
  const sel = document.getElementById('roomFocusSelect');
  sel.value = focusedRoomId || '';
  sel.disabled = mode === 'walk'; // 平面図から選んでも俯瞰へ切り替えて表示する（focusRoom）
  document.getElementById('roomFocusClearBtn').disabled = !focusedRoomId;
}
// 1Fは民泊棟・自宅棟の2棟にまたがるため、部屋フォーカスのプルダウンも棟ごとに分ける
// （施主指摘：1F(民泊)/1F(自宅)で分けたい）。棟の境界はSOUND_WALL（民泊-自宅防音壁、x=7.28）の
// x座標を使い、部屋のbbox中心がその西側か東側かで機械的に判定する（部屋名の文字列一致に
// 頼らないため、部屋が増減しても追従する）。2Fは全室自宅棟のため分割しない
function populateRoomFocusSelect(){
  const sel = document.getElementById('roomFocusSelect');
  const groups = [
    { label:'1F（民泊）', rooms: ROOMS_APPROX[1].filter(r=>r.id && (r.x0+r.x1)/2 < SOUND_WALL.x) },
    { label:'1F（自宅）', rooms: ROOMS_APPROX[1].filter(r=>r.id && (r.x0+r.x1)/2 >= SOUND_WALL.x) },
    { label:'2F（自宅）', rooms: ROOMS_APPROX[2].filter(r=>r.id) },
  ];
  groups.forEach(({label, rooms})=>{
    const og = document.createElement('optgroup'); og.label = label;
    rooms.forEach(r=>{
      const o = document.createElement('option'); o.value = r.id; o.textContent = r.name;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
}
populateRoomFocusSelect();
document.getElementById('roomFocusSelect').onchange = e=>{
  if(mode==='walk'){ e.target.value=''; return; }
  e.target.value ? focusRoom(e.target.value) : clearFocus(); // focusRoom は俯瞰へ切り替えてから寄る
};
document.getElementById('roomFocusClearBtn').onclick = clearFocus;
updateRoomFocusUI();

// ---- 地面グリッド ----
const grid = new THREE.GridHelper(36.4, 40, 0x9aa4ab, 0xc7ced3); // 1マス=910mm(建築モジュール)
grid.position.y = -0.02;
scene.add(grid);

// ============================================================================
// UI連動
// ============================================================================
document.getElementById('chkSound').onchange = e=> groups.sound.visible = e.target.checked;
document.getElementById('chkRoof').onchange = e=> roofAll.visible = e.target.checked;
document.getElementById('chkLabels').onchange = refreshLabelVis;
document.getElementById('chkFurnitureLabels').onchange = refreshLabelVis;
document.getElementById('chkElectrical').onchange = e=> electricalAll.visible = e.target.checked;
document.getElementById('chkElectricalLabels').onchange = refreshLabelVis;
document.getElementById('chkGrid').onchange = e=> grid.visible = e.target.checked;
document.getElementById('chkRollDown').onchange = e=> setRollScreensDown(e.target.checked);
document.getElementById('walkRollToggle').onclick = ()=> setRollScreensDown(!rollScreensDown);
refreshRollControls();

let floorMode = '1F';
function applyFloorMode(){
  // 薄く表示ではなく完全に非表示にする（うすい表示だと紛らわしいとの指摘、2026-08-14）
  const show1 = floorMode !== '2F', show2 = floorMode !== '1F';
  groups.approx1.visible = show1; groups.approx2.visible = show2;
  groups.openings1.visible = show1; groups.openings2.visible = show2;
  groups.doors1.visible = show1; groups.doors2.visible = show2;
  groups.roofHiraya.visible = show1; groups.roofGable.visible = show2;
  groups.furniture1.visible = show1; groups.furniture2.visible = show2;
  groups.electrical1.visible = show1; groups.electrical2.visible = show2;
  groups.floor1.visible = show1; groups.floor2.visible = show2;
  soundFloorGate.visible = show1; // 防音壁は1F扱い
  refreshLabelVis();
}
document.getElementById('btnBoth').onclick = ()=>{ floorMode='both'; setActiveBtn('btnBoth'); applyFloorMode(); };
document.getElementById('btn1F').onclick = ()=>{ floorMode='1F'; setActiveBtn('btn1F'); applyFloorMode(); };
document.getElementById('btn2F').onclick = ()=>{ floorMode='2F'; setActiveBtn('btn2F'); applyFloorMode(); };
function setActiveBtn(id){ ['btnBoth','btn1F','btn2F'].forEach(b=>document.getElementById(b).classList.toggle('active', b===id)); }

function refreshLabelVis(){
  const showLabels = document.getElementById('chkLabels').checked;
  const showDims = document.getElementById('chkDims').checked;
  const showFurnitureLabels = document.getElementById('chkFurnitureLabels').checked;
  const showElectricalLabels = document.getElementById('chkElectricalLabels').checked;
  labels.forEach(l=>{
    let vis;
    if(l.isDim) vis = showDims;
    else if(l.isFurniture) vis = showFurnitureLabels;
    else if(l.isElectrical) vis = showElectricalLabels;
    else vis = showLabels;
    // 部屋フォーカス中は、チェックボックスの状態に関わらずその部屋の電気設備ラベルだけ強制表示する
    // （施主指摘：部屋を絞って編集する使い方が基本のため、絞った先ではラベルOFFの意味が薄い。
    // 33室中1室に絞った状態なら密集の心配もない＝デフォルトOFFの理由に抵触しない）
    if(focusedRoomId && l.isElectrical && !l.hiddenByFocus) vis = true;
    if(l.floor===1 && floorMode==='2F') vis=false;
    if(l.floor===2 && floorMode==='1F') vis=false;
    // 部屋フォーカス中は、対象室以外のラベル(furnitureMeshes/electricalMeshes/roomMeshesByIdが
    // focusRoom()でセットするhiddenByFocusフラグ)と、寸法ラベル全般を強制的に隠す
    if(l.hiddenByFocus) vis=false;
    if(focusedRoomId && l.isDim) vis=false;
    l.div.style.display = vis ? 'block' : 'none';
  });
}

// ============================================================================
// 内覧（一人称）モード：スポーン地点・カメラ・移動入力
// ============================================================================
function findOpening(labelSubstr){ return OPENINGS.find(o=>o.label.includes(labelSubstr)); }
// 玄関の開口部データから、建物内側を向いた状態でのスポーン地点を計算する。
// inset: 玄関の壁面から室内側へどれだけ入った位置にスポーンさせるか(m)
function spawnFromDoor(labelSubstr, label, inset){
  const o = findOpening(labelSubstr);
  if(!o) return { x:CX, z:CZ, yaw:0, level:1, label };
  const level = o.level || 1;
  let x,z,yaw;
  if(o.face==='N'){ x=o.lx+o.w/2; z=(level===2?FLOOR2.z0:segAtX(o.lx).z0)+inset; yaw=0; }
  else if(o.face==='S'){ x=o.lx+o.w/2; z=(level===2?FLOOR2.z1:segAtX(o.lx).z1)-inset; yaw=Math.PI; }
  else if(o.face==='E'){ x=(o.x!==undefined?o.x:19.110)-inset; z=o.lz+o.w/2; yaw=-Math.PI/2; }
  else { x=(o.x!==undefined?o.x:0)+inset; z=o.lz+o.w/2; yaw=Math.PI/2; }
  return { x, z, yaw, level, label };
}
const SPAWN_MINPAKU = spawnFromDoor('民泊 玄関ドア', '民泊棟 玄関から', 1.1);
const SPAWN_JITAKU = spawnFromDoor('自宅 玄関ドア', '自宅 玄関から', 1.1);

// 視野角（縦方向、度）。スマホの縦持ちは画面が細長く、同じ縦72°でも横は約40°しかなく狭いので、
// 2本指で広げる（ピンチアウト）と広角、狭める（ピンチイン）と標準に近づくようにする（施主指示 2026-11-07）。
// 端末ごとの好みなので覚えておく
const WALK_FOV_DEFAULT = 72, WALK_FOV_MIN = 45, WALK_FOV_MAX = 115;
const WALK_FOV_KEY = 'ryuka-walk-fov';
function loadWalkFov(){
  try{
    const v = parseFloat(localStorage.getItem(WALK_FOV_KEY));
    if(isFinite(v)) return Math.min(WALK_FOV_MAX, Math.max(WALK_FOV_MIN, v));
  }catch(e){}
  return WALK_FOV_DEFAULT;
}
const walkCamera = new THREE.PerspectiveCamera(loadWalkFov(), innerWidth/innerHeight, 0.05, 100);
let walkLevel = 1;
const walkPos = { x:0, z:0 };
let walkYaw = 0, walkPitch = 0;
let walkView = 'first'; // 'first'=一人称 / 'third'=三人称（マインクラフト風の背後追従カメラ）
const EYE_HEIGHT = 1.55; // 目線の高さ(m、床から)
const WALK_SPEED = 1.7;  // 歩行速度(m/s)
const WALK_CYCLE_SPEED = 8;         // 歩行アニメーションの周期の速さ（大きいほど手足が速く動く）
const WALK_CYCLE_LEG_AMPLITUDE = 0.5;  // 脚の振り角（ラジアン）
const WALK_CYCLE_ARM_AMPLITUDE = 0.35; // 腕の振り角（ラジアン。脚より小さめにして自然に見せる）
let walkCyclePhase = 0; // 歩行アニメーションの位相（歩いている間だけ進める）
let walkCycleAmount = 0; // 0=静止(手足を振らない)〜1=全振幅。動き出す/止まるでなめらかに切り替える
const THIRD_PERSON_DISTANCE = 1.7;      // 三人称カメラの距離(m、常に一定。壁・家具に応じた自動調整はしない)
const THIRD_PERSON_TARGET_HEIGHT = 1.5; // 注視点の高さ(m、床から。キャラの頭部付近)
const STAIR_CORRIDOR_MARGIN = 0.35; // 経路中心線からこの距離以内なら「階段に乗っている」とみなす

// (x,z)がいずれかの階段の経路付近にあるかを判定する。あれば
// {stair, t, y}（t=0がlevelFrom側の踏み始め、t=1がlevelTo側の踏み終わり）を返す。
// 内覧モードでの高さ補間・現在階の判定の両方に使う。
// currentLevel（呼び出し時点のwalkLevel）は、階段の一部が別の部屋（例：階段下収納）の
// 真上を通る区間（stair.hiddenBelow）で必要になる。まだ登っていない状態(currentLevel===levelFrom)で
// その区画に入った場合は、それは階段を登っているのではなく「下の部屋（階段下収納）を歩いている」
// ということなので、階段としては扱わない（＝床の高さが下の階のまま変わらないようにする）
function stairProgressAt(x, z, currentLevel){
  for(const stair of STAIRS){
    // stair.opening（階段の吹き抜け範囲）の外は、経路との距離だけでは判定しない。
    // 経路の端点（例：終端の直進部分）付近は、壁を挟んだ隣室（例：東の廊下）でも
    // width/2+STAIR_CORRIDOR_MARGIN以内に入ってしまうことがあり、そのまま距離だけで
    // 判定すると壁の向こうを歩いているだけで階段に乗っていると誤判定してしまう
    // （施主指摘：自宅LDKから東の廊下へ抜けようとすると突然2Fにワープする不具合）
    if(stair.opening && !inRect(x, z, stair.opening)) continue;
    const layout = stair._layout;
    const pts = layout.path.pts;
    let best = null;
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1], b=pts[i];
      const abx=b.x-a.x, abz=b.z-a.z;
      const abLen2 = abx*abx+abz*abz;
      let t = abLen2>1e-9 ? ((x-a.x)*abx+(z-a.z)*abz)/abLen2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px=a.x+abx*t, pz=a.z+abz*t;
      const d = Math.hypot(x-px, z-pz);
      const s = a.cum + (b.cum-a.cum)*t;
      if(!best || d<best.d) best = {d, s};
    }
    if(best && best.d <= stair.width/2 + STAIR_CORRIDOR_MARGIN){
      if(currentLevel===stair.levelFrom && inRect(x, z, stair.hiddenBelow)) continue;
      const tt = layout.path.total>1e-9 ? best.s/layout.path.total : 0;
      return { stair, t:tt, y: stair._baseY0 + tt*(stair._baseY1-stair._baseY0) };
    }
  }
  return null;
}
function currentWalkY(){
  const sp = stairProgressAt(walkPos.x, walkPos.z, walkLevel);
  if(sp) return sp.y;
  const room=(ROOMS_APPROX[walkLevel]||[]).find(r=>r.id && pointInPolygon(walkPos.x,walkPos.z,roomPolygonPoints(r)));
  return (walkLevel===1 ? LEVELS.fl1 : LEVELS.fl2) + (room?.floorOffsetM ?? 0);
}

// ---- 三人称：カメラとキャラクターの間にある壁・天井・扉・仕上げの面を半透明にする ----
// 壁に囲まれた部屋では、カメラが壁の向こうやめり込んだ位置に来て、壁しか見えず人が映らなかった
// （施主指摘 2026-11-07）。キャラクターの頭・胸・ひざの高さから左右にずらした12本の線をカメラへ伸ばし、
// 当たったものだけを薄くする。材質は元のものと半透明の複製を入れ替えるだけで、壁自体は変えない。
const WALK_FADE_OPACITY = 0.14;
const WALK_FADE_RAY_HEIGHTS = [0.3, 0.9, 1.55, 2.1]; // キャラクターの足元からの高さ(m)。2.1は頭上の欄間や天井ぎわの壁を拾う
const WALK_FADE_RAY_SIDES = [-0.3, 0, 0.3];     // 視線に対して左右へずらす量(m)
const walkFadeRaycaster = new THREE.Raycaster();
const walkFadedMeshes = new Map();    // 半透明にしているメッシュ -> 元の材質
const walkFadeMaterials = new Map();  // 元の材質 -> 半透明の複製
const walkFadeCandidates = [];
const walkFadeNearOnly = new Set();   // カメラの目の前に来たときだけ透かす家具のメッシュ
const WALK_FADE_NEAR_CAMERA = 0.8;    // この距離(m)以内にカメラがある家具は透かす
const WALK_FADE_FURNITURE_RANGE = 3.5; // カメラからこの水平距離(m)以内の家具だけ調べる
const _fadeOrigin = new THREE.Vector3(), _fadeTarget = new THREE.Vector3(), _fadeDir = new THREE.Vector3();
function walkFadeMaterialFor(orig){
  let f = walkFadeMaterials.get(orig);
  if(!f){
    f = orig.clone();
    f.transparent = true; f.opacity = Math.min(orig.opacity, WALK_FADE_OPACITY); f.depthWrite = false; // 窓ガラスはもともと透けているので、さらに薄くする
    walkFadeMaterials.set(orig, f);
  }
  if(orig.color) f.color.copy(orig.color);
  return f;
}
function resetWalkFades(){
  walkFadedMeshes.forEach((orig, mesh)=>{ mesh.material = orig; });
  walkFadedMeshes.clear();
}
function updateWalkFades(sx, baseY, sz, cam){
  walkFadeCandidates.length = 0;
  walkGroup.traverseVisible(o=>{
    if(!o.isMesh || Array.isArray(o.material)) return;
    walkFadeCandidates.push(o);
  });
  // 家具：窓を覆う布やスクリーンは壁と同じく常に対象。それ以外は、カメラの目の前（WALK_FADE_NEAR_CAMERA以内）に
  // 来て視界をふさいでいるときだけ対象にする（壁に掛けた絵の裏にカメラが回り込んだときなど）。
  // 距離で絞るのは、離れた家具まで毎フレーム調べないため
  walkFadeNearOnly.clear();
  furnitureMeshes.forEach(({holder})=>{
    if(!holder.parent || !holder.parent.visible || !holder.visible) return;
    const always = holder.userData.fadeWithWalls;
    if(!always && Math.hypot(holder.position.x - cam.x, holder.position.z - cam.z) > WALK_FADE_FURNITURE_RANGE) return;
    holder.traverseVisible(o=>{
      if(!o.isMesh || Array.isArray(o.material)) return;
      walkFadeCandidates.push(o);
      if(!always) walkFadeNearOnly.add(o);
    });
  });
  const hit = new Set();
  let px = cam.x - sx, pz = cam.z - sz;
  const len = Math.hypot(px, pz);
  if(len > 1e-4){ const nx = -pz/len; pz = px/len; px = nx; } else { px = 1; pz = 0; }
  for(const h of WALK_FADE_RAY_HEIGHTS){
    for(const side of WALK_FADE_RAY_SIDES){
      _fadeOrigin.set(sx + px*side, baseY + h, sz + pz*side);
      _fadeTarget.set(cam.x + px*side, cam.y, cam.z + pz*side);
      _fadeDir.subVectors(_fadeTarget, _fadeOrigin);
      const dist = _fadeDir.length();
      if(dist < 1e-3) continue;
      _fadeDir.divideScalar(dist);
      walkFadeRaycaster.set(_fadeOrigin, _fadeDir);
      walkFadeRaycaster.near = 0; walkFadeRaycaster.far = dist;
      walkFadeRaycaster.intersectObjects(walkFadeCandidates, false).forEach(r=>{
        if(walkFadeNearOnly.has(r.object) && dist - r.distance > WALK_FADE_NEAR_CAMERA) return; // 離れた家具は透かさない
        hit.add(r.object);
      });
    }
  }
  hit.forEach(mesh=>{
    if(!walkFadedMeshes.has(mesh)) walkFadedMeshes.set(mesh, mesh.material);
    mesh.material = walkFadeMaterialFor(walkFadedMeshes.get(mesh));
  });
  walkFadedMeshes.forEach((orig, mesh)=>{
    if(!hit.has(mesh)){ mesh.material = orig; walkFadedMeshes.delete(mesh); }
  });
}

function updateWalkCamera(){
  const baseY = currentWalkY();
  const [sx,sz] = toScene(walkPos.x, walkPos.z);
  const fx = Math.sin(walkYaw)*Math.cos(walkPitch);
  const fy = Math.sin(walkPitch);
  const fz = Math.cos(walkYaw)*Math.cos(walkPitch);

  walkCharacterGroup.visible = (walkView==='third');
  walkCharacterGroup.position.set(sx, baseY, sz);
  walkCharacterGroup.rotation.y = walkYaw;

  if(walkView==='third'){
    const targetY = baseY + THIRD_PERSON_TARGET_HEIGHT;
    // 注視点(キャラの頭部付近)からforwardと逆向きにTHIRD_PERSON_DISTANCE離れた位置に固定する。
    // 壁・家具に応じて距離を自動調整すると、歩くたびにカメラがズームイン/アウトを繰り返して
    // 落ち着かないため（施主指摘）、距離は常に一定にし、壁にめり込む場合はそのまま許容する
    const dist = THIRD_PERSON_DISTANCE;
    walkCamera.position.set(sx-fx*dist, targetY-fy*dist, sz-fz*dist);
    walkCamera.lookAt(sx, targetY, sz);
    updateWalkFades(sx, baseY, sz, walkCamera.position);
  } else {
    walkCamera.position.set(sx, baseY+EYE_HEIGHT, sz);
    walkCamera.lookAt(sx+fx, baseY+EYE_HEIGHT+fy, sz+fz);
    if(walkFadedMeshes.size) resetWalkFades();
  }
}
function toggleWalkView(){
  walkView = (walkView==='first') ? 'third' : 'first';
  document.getElementById('walkToggleView').textContent = (walkView==='first') ? '🧍 三人称に切替' : '👁 一人称に切替';
  document.getElementById('crosshair').style.display = (walkView==='first') ? 'block' : 'none'; // 三人称では照準の意味がないので隠す
  updateWalkCamera();
}
document.getElementById('walkToggleView').onclick = toggleWalkView;

// ---- 内覧モードのミニマップ：現在階の平面図・プレイヤーの位置と向き・クリックでのワープ ----
const minimapEl = document.getElementById('minimap');
const minimapCtx = minimapEl.getContext('2d');
const MINIMAP_W = minimapEl.width, MINIMAP_H = minimapEl.height, MINIMAP_MARGIN = 10;
function floorBounds(level){
  const rects = level===1 ? FLOOR1 : [FLOOR2];
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  rects.forEach(r=>{ x0=Math.min(x0,r.x0); x1=Math.max(x1,r.x1); z0=Math.min(z0,r.z0); z1=Math.max(z1,r.z1); });
  return { x0, x1, z0, z1 };
}
const MINIMAP_BOUNDS = { 1: floorBounds(1), 2: floorBounds(2) };
// 建物ローカル座標(x=西→東,z=北→南)を、そのままミニマップ上でも「上=北、右=東」になるようマッピングする
// （toScene()と違い、ミニマップは3D描画とは独立した2D投影なのでCX/CZのオフセットは使わない）
function minimapTransform(level){
  const b = MINIMAP_BOUNDS[level];
  const availW = MINIMAP_W - MINIMAP_MARGIN*2, availH = MINIMAP_H - MINIMAP_MARGIN*2;
  const scale = Math.min(availW/(b.x1-b.x0), availH/(b.z1-b.z0));
  const offX = MINIMAP_MARGIN + (availW - (b.x1-b.x0)*scale)/2;
  const offY = MINIMAP_MARGIN + (availH - (b.z1-b.z0)*scale)/2;
  return {
    scale,
    toPx:(x,z)=>[offX+(x-b.x0)*scale, offY+(z-b.z0)*scale],
    toWorld:(px,py)=>[b.x0+(px-offX)/scale, b.z0+(py-offY)/scale],
  };
}
function drawMinimap(){
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
  const t = minimapTransform(walkLevel);
  ctx.strokeStyle = '#4a5a68';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  (wallSegmentsByLevel[walkLevel] || []).forEach(s=>{
    let a, b;
    if(s.orientation==='H'){ a=t.toPx(s.from, s.at); b=t.toPx(s.to, s.at); }
    else { a=t.toPx(s.at, s.from); b=t.toPx(s.at, s.to); }
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  });
  // プレイヤーの位置(点)と向き(線、forwardベクトルと同じ規約: x=sin(yaw), z=cos(yaw))
  const [px, py] = t.toPx(walkPos.x, walkPos.z);
  const fx = Math.sin(walkYaw), fz = Math.cos(walkYaw);
  ctx.strokeStyle = '#2f7dd6';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px+fx*14, py+fz*14); ctx.stroke();
  ctx.fillStyle = '#2f7dd6';
  ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  // 現在階のラベル
  ctx.fillStyle = 'rgba(20,26,32,.8)';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(walkLevel+'F', 6, 15);
}
minimapEl.addEventListener('click', e=>{
  if(mode!=='walk') return;
  const rect = minimapEl.getBoundingClientRect();
  const px = (e.clientX-rect.left) * (MINIMAP_W/rect.width);
  const py = (e.clientY-rect.top) * (MINIMAP_H/rect.height);
  const [wx, wz] = minimapTransform(walkLevel).toWorld(px, py);
  if(segListBlocked(wallSegmentsByLevel[walkLevel] || [], wx, wz, PLAYER_RADIUS)) return; // 壁の中へはワープしない
  walkPos.x = wx; walkPos.z = wz;
  updateWalkCamera();
});

function applyModeChrome(m){
  Object.entries(modeButtons).forEach(([k,btn])=> btn.classList.toggle('active', k===m));
  document.getElementById('floorToggle').classList.toggle('disabled', m==='walk');
  document.getElementById('walkHud').style.display = m==='walk' ? 'flex' : 'none';
  document.getElementById('crosshair').style.display = m==='walk' ? 'block' : 'none';
  document.getElementById('moveHint').style.display = (m==='walk' && !isTouchDevice) ? 'block' : 'none';
  document.getElementById('minimap').style.display = m==='walk' ? 'block' : 'none';
  document.getElementById('joyBase').style.display = (m==='walk' && isTouchDevice) ? 'block' : 'none';
  document.getElementById('compass').style.display = m==='orbit' ? 'block' : 'none';
  // 2026-10 UI整理：編集は平面図・俯瞰のどちらでも続けられる（内覧に入るときだけ終える）。
  // 種類別だった編集ボタン（家具＝平面図のみ・窓ドア＝平面図のみ・電気＝俯瞰のみ）は
  // web/editor-shell.js の「✎ 編集」1つに統合した。
  if(m==='walk'){
    if(editMode) setEditMode(false);
    if(doorEditMode) setDoorEditMode(false);
    if(electricalEditMode) setElectricalEditMode(false);
  }
  if(m!=='orbit' && focusedRoomId) clearFocus(); // 部屋フォーカスは俯瞰で表示する（選ぶと俯瞰へ切り替わる）
  updateRoomFocusUI(); // セレクトのdisabled状態をモードに追従させる
}

function openSpawnOverlay(){ document.getElementById('spawnOverlay').style.display = 'flex'; }
function closeSpawnOverlay(){ document.getElementById('spawnOverlay').style.display = 'none'; }
document.getElementById('spawnCancel').onclick = closeSpawnOverlay;
document.getElementById('spawnMinpaku').onclick = ()=>{ closeSpawnOverlay(); enterWalkMode(SPAWN_MINPAKU); };
document.getElementById('spawnJitaku').onclick = ()=>{ closeSpawnOverlay(); enterWalkMode(SPAWN_JITAKU); };
document.getElementById('walkSwitchSpawn').onclick = openSpawnOverlay;
document.getElementById('walkExit').onclick = ()=> setMode('top');

let savedFloorMode = 'both';
function restoreLayerVisibility(){
  approxAll.visible = true;
  openingsAll.visible = true;
  groups.sound.visible = document.getElementById('chkSound').checked;
  roofAll.visible = document.getElementById('chkRoof').checked;
  doorsAll.visible = true;
  furnitureAll.visible = true;
  electricalAll.visible = document.getElementById('chkElectrical').checked;
  grid.visible = document.getElementById('chkGrid').checked;
}
function enterWalkMode(spawn){
  rebuildFurnitureSegments();
  clearFocus(); // 部屋フォーカス中に内覧へ入る場合は先に解除しておく（内覧側のgrid/roofAll設定が後で上書きされないように。focusedRoomId===nullなら即returnするので無害）
  savedFloorMode = floorMode;
  walkLevel = spawn.level; walkPos.x = spawn.x; walkPos.z = spawn.z; walkYaw = spawn.yaw; walkPitch = 0;
  walkView = 'first';
  document.getElementById('walkToggleView').textContent = '🧍 三人称に切替';
  document.getElementById('crosshair').style.display = 'block';
  // 概算の間仕切り・開口部・防音壁・屋根・グリッドを隠し、実壁+天井+床+家具だけを見せる
  // （家具は「実際に通れるか」を確認する内覧モードの主目的そのものなので隠さない）
  approxAll.visible = false; openingsAll.visible = false; doorsAll.visible = false;
  groups.sound.visible = false; roofAll.visible = false; grid.visible = false;
  groups.floor1.visible = walkLevel===1; groups.floor2.visible = walkLevel===2;
  groups.furniture1.visible = walkLevel===1; groups.furniture2.visible = walkLevel===2;
  const showElec = document.getElementById('chkElectrical').checked;
  groups.electrical1.visible = walkLevel===1 && showElec; groups.electrical2.visible = walkLevel===2 && showElec;
  walkGroup.visible = true;
  labels.forEach(l=> l.div.style.display = 'none');
  document.querySelector('#walkHud .room').textContent = spawn.label;
  mode = 'walk';
  applyModeChrome('walk');
  updateWalkCamera();
  drawMinimap();
}
function exitWalkMode(){
  walkGroup.visible = false;
  floorMode = savedFloorMode;
  applyFloorMode();
  restoreLayerVisibility();
  joyId = null; joyVec.x = 0; joyVec.y = 0;
  if(joyKnobEl) joyKnobEl.style.transform = 'translate(0,0)';
  lookDragId = null;
  walkLookPointers.clear(); walkPinchStartDist = null;
  resetWalkFades();          // 三人称で透かした壁を元に戻す
  resetWalkCurtains();       // 開いていたカーテンを閉じた状態に戻す（俯瞰・平面図ではUEと同じ閉じた姿）
}

// ---- 入力：キーボード（WASD / 矢印キー） ----
const keys = {};
window.addEventListener('keydown', e=>{
  // 入力欄・選択欄の操作（内覧中に開いた仕上げの編集など）では歩かない
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT' || tag==='SELECT' || tag==='TEXTAREA') return;
  keys[e.code]=true;
  if(e.code==='KeyV' && !e.repeat && mode==='walk') toggleWalkView();
});
window.addEventListener('keyup', e=>{ keys[e.code]=false; });

window.addEventListener('keydown', e=>{
  if(!editMode || mode==='walk' || !selectedFurnitureId) return;
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT' || tag==='SELECT' || tag==='TEXTAREA') return;
  if(e.code==='Delete' || e.code==='Backspace'){
    e.preventDefault();deleteSelectedFurniture();
  }
});

// ---- 電気設備編集のキーボードショートカット（施主指摘：本気で編集するときの効率化） ----
// Escape=選択解除／Delete・Backspace=削除／矢印=微調整（Shiftで10cm、通常1cm）／
// Ctrl+Z=Undo／Ctrl+Shift+ZまたはCtrl+Y=Redo。入力欄・セレクトにフォーカス中は素通しする
let electricalNudgeHoldCode = null;
window.addEventListener('keydown', e=>{
  if(!electricalEditMode || mode==='walk') return;
  const tag = document.activeElement && document.activeElement.tagName;
  if(tag==='INPUT' || tag==='SELECT' || tag==='TEXTAREA') return;
  // Ctrl+Z / Ctrl+Shift+Z は全種類共通の元に戻す（web/editor-shell.js）が受け持つ
  if(e.code==='Escape'){
    if(selectedElectricalId){ e.preventDefault(); setSelectedElectrical(null); }
    return;
  }
  if(!selectedElectricalId) return;
  if(e.code==='Delete' || e.code==='Backspace'){
    e.preventDefault();
    deleteSelectedElectrical();
    return;
  }
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){
    e.preventDefault();
    const isNewHold = electricalNudgeHoldCode !== e.code;
    electricalNudgeHoldCode = e.code;
    nudgeSelectedElectrical(e.code, e.shiftKey ? 0.1 : 0.01, isNewHold);
  }
});
window.addEventListener('keyup', e=>{ if(e.code===electricalNudgeHoldCode) electricalNudgeHoldCode = null; });

// ---- 入力：ポインタ（マウスドラッグ／タッチ）でのルック＋バーチャルジョイスティック ----
const joyBaseEl = document.getElementById('joyBase');
const joyKnobEl = document.getElementById('joyKnob');
const JOY_RADIUS = 45;
let joyId = null, joyBaseX = 0, joyBaseY = 0;
const joyVec = { x:0, y:0 };
let lookDragId = null, lookLastX = 0, lookLastY = 0;

function withinJoystick(clientX, clientY){
  if(!isTouchDevice || joyBaseEl.style.display==='none') return false;
  const r = joyBaseEl.getBoundingClientRect();
  return clientX>=r.left && clientX<=r.right && clientY>=r.top && clientY<=r.bottom;
}
// 視点操作の指（ジョイスティック以外）。2本になったら視点の回転をやめて、指の間隔で視野角を変える
const walkLookPointers = new Map(); // pointerId -> {x, y}
let walkPinchStartDist = null, walkPinchStartFov = WALK_FOV_DEFAULT;
let fovHintTimer = null;
function setWalkFov(fov){
  fov = Math.min(WALK_FOV_MAX, Math.max(WALK_FOV_MIN, fov));
  walkCamera.fov = fov;
  walkCamera.updateProjectionMatrix();
  try{ localStorage.setItem(WALK_FOV_KEY, String(Math.round(fov))); }catch(e){}
  const hint = document.getElementById('fovHint');
  hint.textContent = '視野 ' + Math.round(fov) + '°';
  hint.style.display = 'block';
  clearTimeout(fovHintTimer);
  fovHintTimer = setTimeout(()=>{ hint.style.display = 'none'; }, 900);
}
function walkPinchDistance(){
  const [p1, p2] = [...walkLookPointers.values()];
  return Math.hypot(p1.x-p2.x, p1.y-p2.y);
}
function onWalkPointerDown(e){
  if(withinJoystick(e.clientX, e.clientY)){
    joyId = e.pointerId; joyBaseX = e.clientX; joyBaseY = e.clientY;
    return;
  }
  walkLookPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(walkLookPointers.size===2){
    lookDragId = null; // 2本指の間は視点を回さない
    walkPinchStartDist = walkPinchDistance();
    walkPinchStartFov = walkCamera.fov;
  } else if(walkLookPointers.size===1){
    lookDragId = e.pointerId; lookLastX = e.clientX; lookLastY = e.clientY;
  }
}
function onWalkPointerMove(e){
  if(e.pointerId===joyId){
    let dx=e.clientX-joyBaseX, dy=e.clientY-joyBaseY;
    const len=Math.hypot(dx,dy);
    if(len>JOY_RADIUS){ dx=dx/len*JOY_RADIUS; dy=dy/len*JOY_RADIUS; }
    joyVec.x = dx/JOY_RADIUS; joyVec.y = -dy/JOY_RADIUS;
    joyKnobEl.style.transform = `translate(${dx}px,${dy}px)`;
    return;
  }
  if(walkLookPointers.has(e.pointerId)) walkLookPointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(walkLookPointers.size===2 && walkPinchStartDist){
    // 指を広げる（ピンチアウト）と広角、狭めると狭角。開始時の間隔に対する比で決める
    setWalkFov(walkPinchStartFov * walkPinchDistance() / walkPinchStartDist);
  } else if(e.pointerId===lookDragId){
    const dx=e.clientX-lookLastX, dy=e.clientY-lookLastY;
    lookLastX=e.clientX; lookLastY=e.clientY;
    // 広角のときは同じ指の動きで回りすぎないよう、視野角に比例させる
    const k = 0.0035 * walkCamera.fov / WALK_FOV_DEFAULT;
    walkYaw -= dx*k;
    walkPitch = Math.max(-1.3, Math.min(1.3, walkPitch - dy*k));
  }
}
function onWalkPointerUp(e){
  if(e.pointerId===joyId){ joyId=null; joyVec.x=0; joyVec.y=0; joyKnobEl.style.transform='translate(0,0)'; }
  const wasLook = walkLookPointers.delete(e.pointerId);
  if(e.pointerId===lookDragId){ lookDragId=null; }
  if(wasLook && walkLookPointers.size<2){
    walkPinchStartDist = null;
    if(walkLookPointers.size===1 && lookDragId===null){
      // 2本指の片方を離したら、残った指で視点操作に戻る（急に回らないよう基準位置を取り直す）
      const [[id, p]] = [...walkLookPointers.entries()];
      lookDragId = id; lookLastX = p.x; lookLastY = p.y;
    }
  }
}
window.addEventListener('pointercancel', onWalkPointerUp);

// ---- 毎フレームの移動更新（衝突判定つき） ----
function updateWalkMovement(dt){
  let fwd = 0, strafe = 0;
  if(keys['KeyW']||keys['ArrowUp']) fwd += 1;
  if(keys['KeyS']||keys['ArrowDown']) fwd -= 1;
  if(keys['KeyD']||keys['ArrowRight']) strafe += 1;
  if(keys['KeyA']||keys['ArrowLeft']) strafe -= 1;
  fwd += joyVec.y; strafe += joyVec.x;
  const len = Math.hypot(fwd, strafe);
  if(len > 1e-4){
    fwd/=Math.max(len,1); strafe/=Math.max(len,1);
    const dist = WALK_SPEED * dt;
    // カメラのyaw基準で前後・左右を建物ローカル(x,z)に変換。
    // forward=(sin(yaw),cos(yaw))、right=forward×up=(-cos(yaw),sin(yaw))
    const dx = (Math.sin(walkYaw)*fwd - Math.cos(walkYaw)*strafe) * dist;
    const dz = (Math.cos(walkYaw)*fwd + Math.sin(walkYaw)*strafe) * dist;
    const [nx,nz] = resolveWalk(walkLevel, walkPos.x, walkPos.z, dx, dz);
    walkPos.x = nx; walkPos.z = nz;
  }
  // 三人称視点のキャラクターの手足を、歩いている間だけ振り子のように振る（施主指摘：
  // 「歩くと手足が動くようにしてほしい」）。walkCycleAmountで、動き出す/止まる時に
  // 振り角が急に0や最大に切り替わらず、なめらかにフェードするようにする
  const moving = len > 1e-4;
  walkCycleAmount += ((moving?1:0) - walkCycleAmount) * Math.min(1, dt*8);
  if(moving) walkCyclePhase += dt * WALK_CYCLE_SPEED;
  const swing = Math.sin(walkCyclePhase) * walkCycleAmount;
  walkCharLeftLeg.rotation.x = swing * WALK_CYCLE_LEG_AMPLITUDE;
  walkCharRightLeg.rotation.x = -swing * WALK_CYCLE_LEG_AMPLITUDE;
  walkCharLeftArm.rotation.x = -swing * WALK_CYCLE_ARM_AMPLITUDE; // 右脚と同じ位相（左脚とは逆＝対側協調）
  walkCharRightArm.rotation.x = swing * WALK_CYCLE_ARM_AMPLITUDE; // 左脚と同じ位相
  // 階段上にいる間は経路の進み具合(t)で現在階を判定し、床・家具の表示をその階に切り替える
  // （t<0.5=まだ下の階、t>=0.5=上の階に到達したとみなす。経路の外にいる間はwalkLevelを維持する）
  const sp = stairProgressAt(walkPos.x, walkPos.z, walkLevel);
  if(sp){
    const newLevel = sp.t < 0.5 ? sp.stair.levelFrom : sp.stair.levelTo;
    if(newLevel !== walkLevel){
      walkLevel = newLevel;
      groups.floor1.visible = walkLevel===1; groups.floor2.visible = walkLevel===2;
      groups.furniture1.visible = walkLevel===1; groups.furniture2.visible = walkLevel===2;
    }
  }
  updateWalkCamera();
}

// ============================================================================
// レンダーループ
// ============================================================================
function updateLabels(activeCam){
  labels.forEach(l=>{
    const p = l.pos.clone().project(activeCam);
    l.div.style.left = ((p.x*0.5+0.5)*innerWidth)+'px';
    l.div.style.top = ((-p.y*0.5+0.5)*innerHeight)+'px';
    l.div.style.display = (p.z>1 || l.div.style.display==='none') ? 'none' : l.div.style.display;
  });
}
// ---- 入れ替えセット：切り替えと、表示中の組への同期 ----
function syncVariantMeshes(){
  [...furnitureMeshes.keys()].forEach(id=>{ const base=FURNITURE_ITEMS.find(f=>f.id===id); if(base && !isVariantActive(base)) removeFurnitureMesh(id); });
  if(selectedFurnitureId && !furnitureMeshes.has(selectedFurnitureId)) setSelectedFurniture(null);
  activeFurnitureItems().forEach(item=>{ if(!furnitureMeshes.has(item.id)) placeFurnitureItem(effectiveFurniture(item)); });
  rebuildFurnitureSegments();
  [...electricalMeshes.keys()].forEach(id=>{ const base=findElectricalBase(id); if(base && !isVariantActive(base)) removeElectricalMesh(id); });
  if(selectedElectricalId && !electricalMeshes.has(selectedElectricalId)) setSelectedElectrical(null);
  allElectricalItems().forEach(item=>{ if(!electricalMeshes.has(item.id)) placeElectricalItem(effectiveElectrical(item)); });
  updateFurnitureBar(); updateElectricalBar();
  if(focusedRoomId) refreshRoomFocusElecPanel();
  if(mode!=='walk') refreshLabelVis();
  refreshVariantControls();
}
function setVariant(setId, variant){
  const set=FURNITURE_VARIANT_SETS[setId];
  if(!set || !set.variants[variant] || activeVariantOf(setId)===variant) return;
  const draft={...(furnitureEdits[VARIANTS_EDIT_KEY]||{}), [setId]:variant};
  if(variant===set.active) delete draft[setId];
  if(Object.keys(draft).length) furnitureEdits[VARIANTS_EDIT_KEY]=draft; else delete furnitureEdits[VARIANTS_EDIT_KEY];
  saveFurnitureEdits();
  syncVariantMeshes();
}
function refreshVariantControls(){
  const box=document.getElementById('variantSets');
  if(!box) return;
  for(const [setId,set] of Object.entries(FURNITURE_VARIANT_SETS)){
    let select=document.getElementById('variantSelect-'+setId);
    if(!select){
      const label=document.createElement('label');
      label.append(set.label);
      select=document.createElement('select'); select.id='variantSelect-'+setId;
      for(const [key,variant] of Object.entries(set.variants)){ const option=document.createElement('option'); option.value=key; option.textContent=variant.label; select.appendChild(option); }
      select.onchange=()=>setVariant(setId,select.value);
      label.appendChild(select); box.appendChild(label);
    }
    select.value=activeVariantOf(setId);
  }
}
refreshVariantControls();
applyFloorMode();
applyModeChrome(mode); // 初期表示のモード関連UI（家具編集トグル等）をmodeの実値に同期させる
const clock = new THREE.Clock();
const compassDialEl = document.getElementById('compassDial');
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  let activeCam;
  if(mode==='walk'){ updateWalkMovement(dt); updateWalkDoors(dt); drawMinimap(); activeCam = walkCamera; }
  else activeCam = (mode==='top') ? orthoCam : camera;
  // 方位コンパス：回転はcamThetaのみに依存（詳細はCSSコメント参照）。俯瞰モード中だけ更新すれば足りる
  if(mode==='orbit') compassDialEl.style.transform = `rotate(${camTheta}rad)`;
  if(selectionHelper) selectionHelper.update(); // ドラッグ中の選択枠を追従させる
  if(doorSelectionHelper) doorSelectionHelper.update();
  renderer.render(scene, activeCam);
  updateLabels(activeCam);
}
animate();

window.addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  walkCamera.aspect = innerWidth/innerHeight; walkCamera.updateProjectionMatrix();
  updateOrthoFrustum();
  renderer.setSize(innerWidth, innerHeight);
});
