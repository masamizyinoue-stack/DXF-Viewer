// dialog.js — ダイアログ・ポップアップ関数
// DXF Viewer V0_63
// 依存グローバル: savedViews (var宣言), tx, ty, scale (viewer.js)
// 依存関数: scheduleSave, showGuide (ui.js), updateViewmemoState (ui.js)

// =========================================================
// ビュー記憶メニュー（上書き保存・リセット）
// =========================================================
function _showMemMenu(idx,anchorBtn){
  var existing=document.getElementById('_memMenu');
  if(existing){existing.remove();return;}
  var menu=document.createElement('div');
  menu.id='_memMenu';
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:180px;box-shadow:0 4px 20px rgba(0,0,0,.7);';
  var r=anchorBtn.getBoundingClientRect();
  menu.style.top=(r.bottom+6)+'px';
  menu.style.left=Math.max(4,r.left-60)+'px';
  menu.innerHTML='<div style="color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;margin-bottom:4px;">記憶'+(idx+1)+'</div>'
    +'<button id="_memOvr" style="background:#1a7a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">上書き保存</button>'
    +'<button id="_memRst" style="background:#8B0000;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">記憶リセット</button>'
    +'<button id="_memCnl" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">キャンセル</button>';
  document.body.appendChild(menu);
  function closeMenu(){if(document.getElementById('_memMenu'))menu.remove();}
  document.getElementById('_memOvr').onclick=function(){
    savedViews[idx]={tx:tx,ty:ty,scale:scale};updateViewmemoState(idx);scheduleSave();
    closeMenu();showGuide('記憶'+(idx+1)+'を上書き保存しました',1500);
  };
  document.getElementById('_memRst').onclick=function(){
    if(confirm('記憶'+(idx+1)+'をリセットしますか？')){
      savedViews[idx]=null;updateViewmemoState(idx);scheduleSave();
      closeMenu();showGuide('記憶'+(idx+1)+'をリセットしました',1500);
    }
  };
  document.getElementById('_memCnl').onclick=closeMenu;
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}
