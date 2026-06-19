// ui.js — UI状態管理関数
// DXF Viewer V0_63
// 依存グローバル: savedViews (var宣言)
// DOM依存: guideMsg, undoBtn, redoBtn, .mem-btn, .show-btn

// =========================================================
// ガイドメッセージ
// =========================================================
let _guideTimer = null;

function showGuide(msg, autoHideMs){
  const el = document.getElementById('guideMsg');
  if(!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
  clearTimeout(_guideTimer);
  if(msg && autoHideMs) _guideTimer = setTimeout(hideGuide, autoHideMs);
}

function hideGuide(){
  const el = document.getElementById('guideMsg');
  if(el) el.style.display = 'none';
  clearTimeout(_guideTimer);
}

// =========================================================
// ビュー記憶ボタン状態更新
// =========================================================
function updateViewmemoState(i){
  const mb=document.querySelector('.mem-btn[data-vi="'+i+'"]');
  const sb=document.querySelector('.show-btn[data-vs="'+i+'"]');
  if(mb) mb.classList.toggle('vm-saved',!!savedViews[i]);
  if(sb) sb.classList.toggle('vm-saved',!!savedViews[i]);
}
