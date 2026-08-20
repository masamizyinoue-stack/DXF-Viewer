// ui.js — UI状態管理関数
// DXF Viewer V0_63
// 依存グローバル: savedViews (var宣言)
// DOM依存: snap-hint, undoBtn, redoBtn, .vbm(V1_234: .mem-btn/.show-btnから変更)

// =========================================================
// ガイドメッセージ
// =========================================================
let _guideTimer = null;

function showGuide(msg, autoHideMs){
  const el = document.getElementById('snap-hint');
  if(!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
  clearTimeout(_guideTimer);
  if(msg && autoHideMs) _guideTimer = setTimeout(hideGuide, autoHideMs);
}

function hideGuide(){
  const el = document.getElementById('snap-hint');
  if(el) el.style.display = 'none';
  clearTimeout(_guideTimer);
}

// =========================================================
// ビュー記憶ボタン状態更新
// =========================================================
// V1_234: 記憶/表示の2ボタン(.mem-btn/.show-btn)方式から、M_Viewer_V7.09仕様の
// 1〜5単一ボタン(.vbm)方式へ変更。関数名・呼び出し箇所(storage.js等)は変更せず、
// 内部の対象DOM/表示内容だけを新しいボタンに合わせて書き換えた
function updateViewmemoState(i){
  const btn=document.querySelector('.vbm[data-vi="'+i+'"]');
  if(!btn) return;
  const sv=savedViews[i];
  btn.classList.toggle('vm-saved',!!sv);
  let tip=btn.querySelector('.vbm-tip');
  if(!tip){tip=document.createElement('span');tip.className='vbm-tip';btn.appendChild(tip);}
  if(sv){
    // V1_206由来: 長いファイル名は右側を省略表示。title属性にフルネームを入れておく
    const _vfName206=sv.fileName||'';
    const _short=_vfName206.length>10?_vfName206.slice(0,9)+'…':_vfName206;
    let t=_short?(_short+' '):'';
    if(sv.pdfPageNum) t+='P'+sv.pdfPageNum+' ';
    t+=Math.round(sv.scale*100)+'%';
    tip.textContent=t;
    tip.title=_vfName206;
  } else {
    tip.textContent='空 — タップで保存';
    tip.removeAttribute('title');
  }
}

