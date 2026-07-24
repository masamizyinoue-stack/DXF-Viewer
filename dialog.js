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
    // V0_160: savedViewsはファイル横断のグローバル項目。上書き保存時も現在ファイルの
    // fileKey/fileNameを記録し直す（表示時にどのファイルへ切り替えるか判定するため）
    var _fk160=(typeof currentFileIdx!=='undefined'&&currentFileIdx>=0&&openFiles[currentFileIdx])?openFiles[currentFileIdx].fileKey:null;
    savedViews[idx]={tx:tx,ty:ty,scale:scale,fileKey:_fk160,fileName:(typeof currentFileName!=='undefined'?currentFileName:null)};
    updateViewmemoState(idx);scheduleSave();if(typeof verify==='function')verify('savedViews変更',{slot:idx,action:'overwrite'});
    closeMenu();showGuide('記憶'+(idx+1)+'を上書き保存しました',1500);
  };
  document.getElementById('_memRst').onclick=function(){
    savedViews[idx]=null;updateViewmemoState(idx);scheduleSave();if(typeof verify==='function')verify('savedViews変更',{slot:idx,action:'reset'});
    closeMenu();showGuide('記憶'+(idx+1)+'をリセットしました',1500); // V0_75: confirm廃止・即リセット
  };
  document.getElementById('_memCnl').onclick=closeMenu;
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}

// =========================================================
// V1_64: PDFページ番号ジャンプ（#pageInfoタップで表示）
// 依存グローバル: pdfDoc, pdfPageNum (viewer.js)
// 依存関数: renderPdfPage (viewer.js), scheduleSave, showGuide (ui.js)
// =========================================================
function _showPageJumpDialog(anchorEl){
  if(!pdfDoc) return;
  var existing=document.getElementById('_pageJumpMenu');
  if(existing){existing.remove();return;}
  var total=pdfDoc.numPages;
  var menu=document.createElement('div');
  menu.id='_pageJumpMenu';
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:180px;box-shadow:0 4px 20px rgba(0,0,0,.7);';
  var r=anchorEl.getBoundingClientRect();
  menu.style.top=(r.bottom+6)+'px';
  menu.style.right=(window.innerWidth-r.right)+'px';
  menu.innerHTML='<div style="color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;">ページ移動（全'+total+'ページ）</div>'
    +'<input type="number" id="_pageJumpInput" min="1" max="'+total+'" value="'+pdfPageNum+'" style="width:100%;box-sizing:border-box;padding:10px;border-radius:9px;font-size:16px;background:#0a0c10;color:#eee;border:1px solid #2a3040;text-align:center">'
    +'<button id="_pageJumpGo" style="background:#1a7a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">移動</button>'
    +'<button id="_pageJumpCnl" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">キャンセル</button>';
  document.body.appendChild(menu);
  function closeMenu(){if(document.getElementById('_pageJumpMenu'))menu.remove();}
  var inp=document.getElementById('_pageJumpInput');
  inp.focus();inp.select();
  async function doJump(){
    var n=parseInt(inp.value,10);
    if(!n||n<1||n>total){showGuide('1〜'+total+'の範囲でページ番号を入力してください',2000);return;}
    closeMenu();
    if(n===pdfPageNum) return;
    pdfPageNum=n;
    var pi=document.getElementById('pageInfo');if(pi)pi.textContent=pdfPageNum+'/'+total;
    await renderPdfPage(pdfPageNum);
    scheduleSave(); // V1_64: PDFページジャンプを保存
  }
  document.getElementById('_pageJumpGo').onclick=doJump;
  inp.addEventListener('keydown',function(ev){if(ev.key==='Enter'){ev.preventDefault();doJump();}});
  document.getElementById('_pageJumpCnl').onclick=closeMenu;
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}
