// 閲覧版の印（scripts/build-viewer.mjs が書く）。web/viewer.js と web/finishes.js が見る。
window.RYUKA_VIEWER = {"builtAt":"2026-11-14版","commit":"cbc2cdf","dataSig":"c156f9c1ed"};
try{ if(localStorage.getItem('ryuka-viewer-data-sig') !== "c156f9c1ed"){ ["ryuka-finishes-draft-v2","ryuka-furniture-edits-v1","ryuka-furniture-added-v1","ryuka-furniture-deleted-v1","ryuka-door-window-edits-v1","ryuka-electrical-edits-v1","ryuka-electrical-added-v1","ryuka-electrical-deleted-v1"].forEach(function(k){ localStorage.removeItem(k); }); localStorage.setItem('ryuka-viewer-data-sig', "c156f9c1ed"); } }catch(e){}
