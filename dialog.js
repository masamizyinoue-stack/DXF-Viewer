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
  // V1_234: 「メニューが画面からはみ出る・記憶VIEWボタンに被る」不具合の修正。
  // アンカー(.vbm)は画面右端固定の記憶VIEWポップアップ(#vbmPop)内にあるため、旧来の
  // 「アンカーの下・少し左」という位置決めでは画面右端をはみ出し、かつポップアップ本体
  // とも重なっていた。実際のメニューサイズを計測した上で、常にアンカーの「左側」に
  // 開き(ポップアップと重ならない)、縦位置はアンカーを中心に画面内へクランプする
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:180px;box-shadow:0 4px 20px rgba(0,0,0,.7);visibility:hidden;';
  menu.innerHTML='<div style="color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;margin-bottom:4px;">記憶'+(idx+1)+'</div>'
    +'<button id="_memOvr" style="background:#1a7a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">上書き保存</button>'
    +'<button id="_memRst" style="background:#8B0000;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">記憶リセット</button>'
    +'<button id="_memCnl" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">キャンセル</button>';
  document.body.appendChild(menu);
  var r=anchorBtn.getBoundingClientRect();
  var mw=menu.offsetWidth||180,mh=menu.offsetHeight||160;
  var left=r.left-mw-10; // 基本はアンカー(記憶VIEWポップアップ)の左側に開く
  if(left<4) left=Math.max(4,Math.min(r.left,window.innerWidth-mw-4));
  var top=r.top+(r.height/2)-(mh/2);
  top=Math.max(4,Math.min(top,window.innerHeight-mh-4));
  menu.style.left=left+'px';
  menu.style.top=top+'px';
  menu.style.visibility='';
  function closeMenu(){if(document.getElementById('_memMenu'))menu.remove();}
  document.getElementById('_memOvr').onclick=function(){
    // V0_160: savedViewsはファイル横断のグローバル項目。上書き保存時も現在ファイルの
    // fileKey/fileNameを記録し直す（表示時にどのファイルへ切り替えるか判定するため）
    var _fk160=(typeof currentFileIdx!=='undefined'&&currentFileIdx>=0&&openFiles[currentFileIdx])?openFiles[currentFileIdx].fileKey:null;
    // V1_161: 複数ページPDFで「今見ていたページ」も上書き保存時に記憶し直す
    var _pnOvr161=(typeof pdfDoc!=='undefined'&&pdfDoc&&typeof pdfPageNum!=='undefined')?pdfPageNum:null;
    savedViews[idx]={tx:tx,ty:ty,scale:scale,fileKey:_fk160,fileName:(typeof currentFileName!=='undefined'?currentFileName:null),pdfPageNum:_pnOvr161};
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
  // V1_223: 従来はmenu.style.right=(window.innerWidth-r.right)でアンカー(#pageInfo)の
  // 右端に揃えていたが、#pageInfoは#pdfPageCtrl(画面左上)内にあり右端が画面左端に近いため、
  // ポップアップ本体の幅(min-width:180px)がその位置に収まりきらず左側が画面外にはみ出して
  // 表示されてしまっていた(「移動」「キャンセル」ボタンの文字が欠けて見える不具合の原因)。
  // 他のダイアログ(_showIndexProfileNameDialog等)と同じ「アンカー左端に合わせつつ、
  // 画面端では4px以上・幅+16px分は必ず画面内に収まるようclamp」する方式に統一した
  menu.style.left=Math.max(4,Math.min(r.left,window.innerWidth-196))+'px';
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

// =========================================================
// V1_190: PDFを開いている時の「HD-PDF書出」用ページ選択ダイアログ。
// アップロードされたM_Viewer(V7.09、参考実装)の「現在のページ/全ページ」クイック
// ボタン+範囲テキスト入力(例: 1-3,5)方式を、本アプリの既存ダイアログ配色・構造
// (_showPageJumpDialog等)に合わせて実装したもの。
// 依存関数: _parsePageRange190(本ファイル), showGuide (ui.js)
// =========================================================
function _showPdfHdExportPageDialog190(anchorEl,onConfirm){
  if(!pdfDoc) return;
  var existing=document.getElementById('_pdfHdPageMenu190');
  if(existing){existing.remove();return;}
  var total=pdfDoc.numPages;
  var menu=document.createElement('div');
  menu.id='_pdfHdPageMenu190';
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:230px;box-shadow:0 4px 20px rgba(0,0,0,.7);';
  var r=anchorEl.getBoundingClientRect();
  menu.style.top=(r.bottom+6)+'px';
  menu.style.right=Math.max(4,window.innerWidth-r.right)+'px';
  menu.innerHTML='<div style="color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;">HD-PDF書出 — ページ指定（全'+total+'ページ）</div>'
    +'<div style="display:flex;gap:7px;">'
    +'<button type="button" id="_pdfHdCur190" style="flex:1;background:#0a0c10;color:#eee;border:1px solid #2a3040;border-radius:8px;padding:9px 4px;font-size:12px;cursor:pointer;">現在のページ</button>'
    +'<button type="button" id="_pdfHdAll190" style="flex:1;background:#0a0c10;color:#eee;border:1px solid #2a3040;border-radius:8px;padding:9px 4px;font-size:12px;cursor:pointer;">全ページ</button>'
    +'</div>'
    +'<input type="text" id="_pdfHdRangeInput190" placeholder="例: 1, 1-5, 1,3,5-8" style="width:100%;box-sizing:border-box;padding:10px;border-radius:9px;font-size:15px;background:#0a0c10;color:#eee;border:1px solid #2a3040;text-align:center">'
    +'<button id="_pdfHdGo190" style="background:#1a7a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">出力</button>'
    +'<button id="_pdfHdCnl190" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">キャンセル</button>';
  document.body.appendChild(menu);
  function closeMenu(){if(document.getElementById('_pdfHdPageMenu190'))menu.remove();}
  var inp=document.getElementById('_pdfHdRangeInput190');
  document.getElementById('_pdfHdCur190').onclick=function(){inp.value=String(pdfPageNum);};
  document.getElementById('_pdfHdAll190').onclick=function(){inp.value='1-'+total;};
  function doGo(){
    var pages=_parsePageRange190(inp.value.trim(),total);
    if(!pages.length){showGuide('ページ指定が無効です',2000);return;}
    closeMenu();
    onConfirm(pages);
  }
  document.getElementById('_pdfHdGo190').onclick=doGo;
  inp.addEventListener('keydown',function(ev){if(ev.key==='Enter'){ev.preventDefault();doGo();}});
  document.getElementById('_pdfHdCnl190').onclick=closeMenu;
  inp.focus();
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}

// V1_190: ページ範囲文字列("1, 1-5, 1,3,5-8"形式)を解析してページ番号配列を返す。
// M_Viewer(参考実装)と同じ記法・仕様(範囲外・不正値は無視、重複除去、昇順ソート)
function _parsePageRange190(str,total){
  var pages=[],seen={};
  (str||'').split(',').forEach(function(s){
    s=s.trim();
    if(!s) return;
    if(s.indexOf('-')>=0){
      var parts=s.split('-');
      var a=parseInt(parts[0],10), b=parseInt(parts[1],10);
      if(isNaN(a)||isNaN(b)) return;
      for(var i=Math.max(1,a);i<=Math.min(total,b);i++){ if(!seen[i]){seen[i]=true;pages.push(i);} }
    } else {
      var n=parseInt(s,10);
      if(n>=1&&n<=total&&!seen[n]){ seen[n]=true; pages.push(n); }
    }
  });
  pages.sort(function(a,b){return a-b;});
  return pages;
}

// =========================================================
// V1_69: インデックスパターンの登録名入力ダイアログ
// 依存関数: showGuide (ui.js)
// =========================================================
function _showIndexProfileNameDialog(anchorEl, onConfirm){
  var existing=document.getElementById('_idxNameMenu');
  if(existing){existing.remove();return;}
  var menu=document.createElement('div');
  menu.id='_idxNameMenu';
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:220px;box-shadow:0 4px 20px rgba(0,0,0,.7);';
  var r=anchorEl.getBoundingClientRect();
  menu.style.top=(r.bottom+6)+'px';
  menu.style.left=Math.max(4,Math.min(r.left,window.innerWidth-236))+'px';
  menu.innerHTML='<div style="color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;">インデックスの登録名</div>'
    +'<input type="text" id="_idxNameInput" placeholder="例：現場A" maxlength="30" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px;border-radius:9px;font-size:16px;background:#0a0c10;color:#eee;border:1px solid #2a3040">'
    +'<div id="_idxNameExisting" style="display:flex;flex-wrap:wrap;gap:4px;"></div>'
    +'<button id="_idxNameGo" style="background:#1a7a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">登録</button>'
    +'<button id="_idxNameCnl" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">キャンセル</button>';
  document.body.appendChild(menu);
  function closeMenu(){if(document.getElementById('_idxNameMenu'))menu.remove();}
  var inp=document.getElementById('_idxNameInput');
  inp.focus();
  // V1_112: 既存の登録名をタップで選択→上書き対象として入力欄に反映できるようにする
  // （名前を正確に覚えて打ち直さなくても、既存の登録を選んで上書き保存しやすくする）
  if(typeof _idbListProfiles==='function'){
    _idbListProfiles(function(list){
      var box=document.getElementById('_idxNameExisting');
      if(!box||!list||!list.length) return;
      var label=document.createElement('div');
      label.style.cssText='width:100%;color:#7a95b5;font-size:10px;';
      label.textContent='既存（タップで上書き選択）:';
      box.appendChild(label);
      list.forEach(function(p){
        var chip=document.createElement('button');
        chip.type='button';
        chip.textContent=p.name;
        chip.style.cssText='background:#0a0c10;color:#9ec3ea;border:1px solid #2a3040;border-radius:12px;padding:4px 10px;font-size:11px;cursor:pointer;';
        chip.addEventListener('click',function(){ inp.value=p.name; inp.focus(); });
        box.appendChild(chip);
      });
    });
  }
  function doConfirm(){
    var name=inp.value.trim();
    if(!name){showGuide('名前を入力してください',2000);return;}
    closeMenu();
    onConfirm(name);
  }
  document.getElementById('_idxNameGo').onclick=doConfirm;
  inp.addEventListener('keydown',function(ev){if(ev.key==='Enter'){ev.preventDefault();doConfirm();}});
  document.getElementById('_idxNameCnl').onclick=closeMenu;
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}

// =========================================================
// V1_146: PDF書き出しの品質(倍率)選択ダイアログ。
// V0_141で2x/3x/4xの選択ダイアログとして導入されたが、V0_154でいったん廃止され
// 3倍固定になっていた。「倍率設定を復活してほしい」との要望を受け復活させたもの。
// 選んだ倍率(2/3/4)をonConfirmへ渡す。実際のPDF生成処理自体はexport.js側
// (_runPdfExport)が担当し、このダイアログは倍率を選ばせるだけに専念する
// 依存関数: なし（showGuide等は呼び出し側のexport.jsで使用）
// =========================================================
function _showPdfQualityDialog(anchorEl, onConfirm){
  var existing=document.getElementById('_pdfQualityMenu');
  if(existing){existing.remove();return;}
  var menu=document.createElement('div');
  menu.id='_pdfQualityMenu';
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:220px;box-shadow:0 4px 20px rgba(0,0,0,.7);';
  var r=anchorEl.getBoundingClientRect();
  // V1_146: 開く方向は既存の_showPageJumpDialog等と同じ「アンカー直下」に統一する
  // （savePDFBtnは設定パネル内のスクロール領域にあり、画面上下どちらにも来うるが、
  // 他のダイアログと同じ単純な規則にした方が挙動が予測しやすいため）
  menu.style.top=(r.bottom+6)+'px';
  menu.style.left=Math.max(4,Math.min(r.left,window.innerWidth-236))+'px';
  menu.innerHTML='<div style="color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;">PDFの解像度を選択</div>'
    +'<button type="button" data-m="2" class="_pdfQBtn" style="background:#0a0c10;color:#eee;border:1px solid #2a3040;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;text-align:left;">2倍（軽量・高速）</button>'
    +'<button type="button" data-m="3" class="_pdfQBtn" style="background:#1a7a3a;color:#fff;border:1px solid #2a3040;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;text-align:left;">3倍（推奨）</button>'
    +'<button type="button" data-m="4" class="_pdfQBtn" style="background:#0a0c10;color:#eee;border:1px solid #2a3040;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;text-align:left;">4倍（高画質・低速）</button>'
    +'<div style="color:#7a95b5;font-size:10px;">※機種のメモリが不足する場合は自動的に倍率が下げられます</div>'
    +'<button type="button" id="_pdfQCnl" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">キャンセル</button>';
  document.body.appendChild(menu);
  function closeMenu(){if(document.getElementById('_pdfQualityMenu'))menu.remove();}
  menu.querySelectorAll('._pdfQBtn').forEach(function(b){
    b.addEventListener('click',function(){
      var m=parseInt(b.getAttribute('data-m'),10);
      closeMenu();
      onConfirm(m);
    });
  });
  document.getElementById('_pdfQCnl').onclick=closeMenu;
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}

// =========================================================
// V1_69: 登録済みインデックスパターンの一覧表示・切替・削除
// V1_77: チェックボックスで複数選択できるようにし、選択した複数パターンを
//        まとめて（結合して）現在のインデックスへ読み込めるようにした
//        （従来は1件タップで即座にそのパターンだけに置き換わる単一選択だった）
// 依存関数: _idbListProfiles/_idbLoadProfiles/_idbDeleteProfile/_idbCountByFolder/
//           _buildIndexSummaryText/doOpenFileSearch (index.html), showGuide (ui.js)
// =========================================================
function _showIndexProfileListMenu(anchorEl){
  var existing=document.getElementById('_idxListMenu');
  if(existing){existing.remove();return;}
  var menu=document.createElement('div');
  menu.id='_idxListMenu';
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;min-width:240px;max-width:320px;max-height:60vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,.7);';
  var r=anchorEl.getBoundingClientRect();
  menu.style.top=(r.bottom+6)+'px';
  menu.style.left=Math.max(4,Math.min(r.left,window.innerWidth-336))+'px';
  menu.innerHTML='<div style="color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;">登録インデックス（複数選択可）</div>'
    +'<div id="_idxListBody" style="color:#889;font-size:13px;text-align:center;padding:8px 0;">読み込み中…</div>'
    +'<button id="_idxListApply" disabled style="background:#1a7a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;opacity:.5;">選択したものを読込</button>'
    +'<button id="_idxListCnl" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">閉じる</button>';
  document.body.appendChild(menu);
  function closeMenu(){if(document.getElementById('_idxListMenu'))menu.remove();}
  document.getElementById('_idxListCnl').onclick=closeMenu;

  var selected=new Set(); // V1_77: チェック済みの登録名を保持（re-render後も維持する）
  var applyBtn=document.getElementById('_idxListApply');
  function updateApplyBtn(){
    var n=selected.size;
    applyBtn.disabled=(n===0);
    applyBtn.style.opacity=(n===0)?'.5':'1';
    applyBtn.textContent=(n===0)?'選択したものを読込':('選択した'+n+'件を読込');
  }
  applyBtn.onclick=function(){
    if(selected.size===0) return;
    var names=Array.from(selected);
    closeMenu();
    showGuide(names.length+'件のインデックスを読み込んでいます…',0);
    _idbLoadProfiles(names,function(err){
      if(err){showGuide('読込に失敗しました',2000);return;}
      var oprog=document.getElementById('openFolderProgress');
      var fprog=document.getElementById('folderProgress');
      _idbCountByFolder(function(counts){
        var txt=_buildIndexSummaryText(counts);
        if(oprog)oprog.textContent=txt;
        if(fprog)fprog.textContent=txt;
      });
      if(typeof doOpenFileSearch==='function')doOpenFileSearch();
      showGuide(names.length+'件のインデックスを読み込みました',2000);
    });
  };

  function render(list){
    var body=document.getElementById('_idxListBody');
    if(!body) return;
    if(!list||list.length===0){
      body.style.cssText='color:#889;font-size:13px;text-align:center;padding:8px 0;';
      body.textContent='登録済みのインデックスはありません';
      return;
    }
    body.style.cssText='';
    body.textContent='';
    list.forEach(function(p){
      var row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:6px;padding:6px 4px;border-bottom:1px solid #2a3d55;';
      var cb=document.createElement('input');
      cb.type='checkbox';
      cb.style.cssText='width:20px;height:20px;flex-shrink:0;cursor:pointer;';
      cb.checked=selected.has(p.name);
      cb.addEventListener('change',function(){
        if(cb.checked) selected.add(p.name); else selected.delete(p.name);
        updateApplyBtn();
      });
      var info=document.createElement('div');
      info.style.cssText='flex:1;min-width:0;cursor:pointer;';
      var dateStr=p.savedAt?new Date(p.savedAt).toLocaleDateString('ja-JP'):'';
      info.innerHTML='<div style="color:#eee;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+p.name+'</div>'
        +'<div style="color:#889;font-size:11px;">'+p.count+'件'+(dateStr?'・'+dateStr:'')+'</div>';
      // V1_77: 行タップでもチェックのon/offを切り替えられるようにする（チェックボックス自体は小さいため）
      info.onclick=function(){
        cb.checked=!cb.checked;
        cb.dispatchEvent(new Event('change'));
      };
      var delBtn=document.createElement('button');
      delBtn.textContent='×';
      delBtn.title='削除';
      delBtn.style.cssText='background:#8B0000;color:#fff;border:none;border-radius:6px;width:26px;height:26px;font-size:14px;cursor:pointer;flex-shrink:0;';
      delBtn.onclick=function(ev){
        ev.stopPropagation();
        if(!confirm('「'+p.name+'」を削除しますか？')) return;
        selected.delete(p.name);
        _idbDeleteProfile(p.name,function(){ _idbListProfiles(render); updateApplyBtn(); });
      };
      row.appendChild(cb);row.appendChild(info);row.appendChild(delBtn);
      body.appendChild(row);
    });
  }

  updateApplyBtn();
  if(typeof _idbListProfiles==='function') _idbListProfiles(render);
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}

// =========================================================
// V1_201: ファイル一覧「プレビュー付き一覧」用のサムネイル生成
// DXF/TDFはグローバルのcv/ctx/doc/hiddenLayers/tx/ty/scale/fitScale/pdfImage/imagesを
// 一時的にオフスクリーンcanvas用の値へ退避・差し替えてfit()→draw()を呼び、終わったら
// 復元する「退避→委譲→復元」方式(index.htmlの_diWithCtxと同じ考え方)。すべて同期処理
// のため他の描画(rAFループ等)と衝突する隙間は生まれない。
// PDFはpdfDoc(タブごとに独立したPDF.jsオブジェクト)から直接ページ取得・render。
// Excel/CSVはexcelWbから先頭数行×数列を簡易表として描画する。
// 生成結果はfileKeyでキャッシュし、同じセッション中は再利用する。
// 依存グローバル: cv, ctx, doc, hiddenLayers, tx, ty, scale, fitScale, pdfImage, images (viewer.js)
// 依存関数: fit, draw (viewer.js)
var _fileThumbCache201={};
// V1_234: サムネイル(ctx)へ、そのページの寸法・挿入画像・手書きストローク(書き込み)を
// ベース図面の上に重ねて描画する共通処理。呼び出し時点でグローバルのscale/tx/ty/dims/
// images/strokes/pdfPageNumが、このサムネイルを描く対象のページの値になっている前提
// (呼び出し元がfit();draw();の直後、またはそれに相当する設定を行った直後に呼ぶこと)。
// draw()はctx.restore()で変形行列を単位行列に戻して終わるため、w2s()前提のdrawDimEntity/
// 画像描画は自前でscale(dpr,dpr)を掛け直す。ストローク(drawAnnotation)は#ac同様CTM=identity
// 前提のため、変形をかけ直さず(単位行列のまま)呼び出す
function _drawWritingsOnThumb234(ctxTarget,dpr,curPg){
  ctxTarget.save();ctxTarget.scale(dpr,dpr);
  for(var _di=0;_di<dims.length;_di++){
    var _d=dims[_di];
    if((_d.page||1)!==curPg) continue;
    try{ drawDimEntity(ctxTarget,_d); }catch(e){}
  }
  for(var _ii=0;_ii<images.length;_ii++){
    var _im=images[_ii];
    if((_im.page||1)!==curPg) continue;
    try{ var _pw=w2s(_im.wx,_im.wy); ctxTarget.drawImage(_im.img,_pw[0],_pw[1],_im.ww*scale,_im.wh*scale); }catch(e){}
  }
  ctxTarget.restore();
  if(typeof drawAnnotation==='function'){ try{ drawAnnotation(ctxTarget,null,true); }catch(e){} }
}
function _genPdfThumb201(f,W,H,cb){
  try{
    if(!f.pdfDoc){cb(null);return;}
    var pnum=f.pdfPageNum||1;
    f.pdfDoc.getPage(pnum).then(function(page){
      var vp=page.getViewport({scale:PDF_BASE_SCALE});
      var offscreen=document.createElement('canvas');
      offscreen.width=Math.round(vp.width);offscreen.height=Math.round(vp.height);
      return page.render({canvasContext:offscreen.getContext('2d'),viewport:vp}).promise.then(function(){
        // V1_234: 「PDFのプレビューにも書き込み(寸法・ストローク)を表示してほしい」への対応。
        // 従来はpdf.jsの素のページ画像だけを描いていたが、DXFサムネイル(_genDxfThumb201)と
        // 同様にcv/ctx/pdfImage等を一時的に差し替えてfit();draw();を呼ぶことで、実際の
        // 画面表示(renderPdfPage)と同じ土俵でscale/tx/tyを算出し、その上にdims/images/
        // strokesを重ね描きできるようにした
        var dpr=window.devicePixelRatio||1;
        var c=document.createElement('canvas');
        c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);
        var _svCv=cv,_svCtx=ctx,_svDoc=doc,_svHidden=hiddenLayers,_svPdfImg=pdfImage,_svImages=images;
        var _svTx=tx,_svTy=ty,_svScale=scale,_svFit=fitScale;
        var _svStrokes=strokes,_svDims=dims,_svPdfDoc=(typeof pdfDoc!=='undefined'?pdfDoc:undefined),_svPn=(typeof pdfPageNum!=='undefined'?pdfPageNum:undefined);
        try{
          cv=c;ctx=c.getContext('2d');
          doc=null;hiddenLayers=new Set();
          pdfImage={img:offscreen,wx:0,wy:vp.height/PDF_BASE_SCALE,ww:vp.width/PDF_BASE_SCALE,wh:vp.height/PDF_BASE_SCALE};
          images=f.images||[];strokes=f.strokes||[];dims=f.dims||[];
          pdfDoc=f.pdfDoc;pdfPageNum=pnum; // _curPage()がこのサムネイルのページ番号を返すようにする
          fit();draw();
          _drawWritingsOnThumb234(ctx,dpr,pnum);
          cb(c.toDataURL());
        }finally{
          cv=_svCv;ctx=_svCtx;doc=_svDoc;hiddenLayers=_svHidden;pdfImage=_svPdfImg;images=_svImages;
          tx=_svTx;ty=_svTy;scale=_svScale;fitScale=_svFit;
          strokes=_svStrokes;dims=_svDims;pdfDoc=_svPdfDoc;pdfPageNum=_svPn;
        }
      });
    }).catch(function(){cb(null);});
  }catch(e){cb(null);}
}
function _genDxfThumb201(f,W,H,cb){
  try{
    if(!f.doc){cb(null);return;}
    var dpr=window.devicePixelRatio||1;
    var c=document.createElement('canvas');
    c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);
    var _svCv=cv,_svCtx=ctx,_svDoc=doc,_svHidden=hiddenLayers,_svPdfImg=pdfImage,_svImages=images;
    var _svTx=tx,_svTy=ty,_svScale=scale,_svFit=fitScale;
    var _svStrokes=strokes,_svDims=dims; // V1_234: 書き込み(寸法・挿入画像・手書きストローク)もプレビューに反映する
    try{
      cv=c;ctx=c.getContext('2d');
      doc=f.doc;hiddenLayers=new Set(f.hiddenLayersArr||[]);
      pdfImage=null;
      images=f.images||[];strokes=f.strokes||[];dims=f.dims||[];
      fit();draw();
      _drawWritingsOnThumb234(ctx,dpr,1); // DXFは常に1ページ扱い
      cb(c.toDataURL());
    }finally{
      cv=_svCv;ctx=_svCtx;doc=_svDoc;hiddenLayers=_svHidden;pdfImage=_svPdfImg;images=_svImages;
      tx=_svTx;ty=_svTy;scale=_svScale;fitScale=_svFit;
      strokes=_svStrokes;dims=_svDims;
    }
  }catch(e){cb(null);}
}
function _genExcelThumb201(f,W,H,cb){
  try{
    var wb=f.excelWb;
    if(!wb||typeof XLSX==='undefined'){cb(null);return;}
    var dpr=window.devicePixelRatio||1;
    var c=document.createElement('canvas');
    c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);
    var cx=c.getContext('2d');
    cx.scale(dpr,dpr);
    cx.fillStyle='#fff';cx.fillRect(0,0,W,H);
    var ws=wb.Sheets[wb.SheetNames[f.excelSheetIdx||0]];
    var rows=ws?XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false}):[];
    var R=Math.min(6,rows.length),C=rows[0]?Math.min(5,rows[0].length):0;
    if(R>0&&C>0){
      var cellW=W/C,cellH=H/R;
      cx.strokeStyle='#ccc';cx.lineWidth=1;
      cx.fillStyle='#333';cx.font='9px sans-serif';cx.textBaseline='middle';
      for(var r=0;r<R;r++){
        for(var col=0;col<C;col++){
          var x=col*cellW,y=r*cellH;
          cx.strokeRect(x,y,cellW,cellH);
          var txt=String(rows[r][col]==null?'':rows[r][col]).slice(0,8);
          cx.fillText(txt,x+2,y+cellH/2);
        }
      }
    }
    cb(c.toDataURL());
  }catch(e){cb(null);}
}
function _genFileThumb201(f,W,H,cb){
  if(f.fileKey&&_fileThumbCache201[f.fileKey]){cb(_fileThumbCache201[f.fileKey]);return;}
  function done(url){ if(url&&f.fileKey) _fileThumbCache201[f.fileKey]=url; cb(url); }
  if(f.pdfDoc)_genPdfThumb201(f,W,H,done);
  else if(f.excelWb)_genExcelThumb201(f,W,H,done);
  else if(f.doc)_genDxfThumb201(f,W,H,done);
  else cb(null);
}

// =========================================================
// V1_70: 開いているファイル一覧（タブが多い時に見失わないための一覧パネル）
// V1_80: 並び順を設定パネルと同じ4種類(名前順/開いた順/アクセス順/任意)から
//        選べるようにし(_computeTabOrder/_setTabSortMode(index.html)を共通利用)、
//        各行にチェックボックスを追加して複数タブをまとめて閉じられるようにした
// V1_201: 「文字一覧」に加え、全画面表示のサムネイル付き「プレビュー一覧」を選べるように
//        した(_mode='text'|'preview')。並び順・複数選択・一括操作(HD-PDF書出/バックアップ/
//        閉じる)は両モードで共有する。
// 依存グローバル: openFiles, currentFileIdx, _tabSortMode (index.html)
// 依存関数: switchToFile, _computeTabOrder, _setTabSortMode, doCloseTab (index.html)
// =========================================================
// =========================================================
// V1_217: お気に入りファイル機能
// 「開いているファイル一覧」の各行/カードに★トグルを付け、fileKey単位で
// localStorageに永続化する。タブを閉じても消えないようにするため、お気に入りに
// 追加した瞬間にそのタブのバイナリをsaveFile()経由でIndexedDB(dxfViewerFilesDB、
// storage.js既存)へも保存しておき、閉じた後でも再度開けるようにする。
// 既存のopenFiles/タブ管理・保存処理には一切手を加えない(お気に入り用の情報は
// 完全に別のlocalStorageキーに独立して保持する)
// =========================================================
var _FAV_KEY217='_dxfFavorites217';
function _favLoadAll217(){
  try{ return JSON.parse(localStorage.getItem(_FAV_KEY217)||'{}')||{}; }catch(e){ return {}; }
}
function _favSaveAll217(m){
  try{ localStorage.setItem(_FAV_KEY217,JSON.stringify(m)); }catch(e){}
}
function _favIsFav217(fileKey){
  if(!fileKey) return false;
  return !!_favLoadAll217()[fileKey];
}
// buf(ArrayBuffer)は「お気に入りに追加する」時だけ渡す(既存タブのバイナリを
// dxfViewerFilesDBへ保存し、閉じた後も再オープンできるようにするため)。
// 外す時はbuf不要(登録メタ情報を消すのみ。保存済みバイナリ自体は消さない＝
// 既存のdxfViewerFilesDBの他用途にも影響を与えないための安全策)
function _favToggle217(fileKey,name,folder,buf){
  if(!fileKey) return false;
  var m=_favLoadAll217();
  if(m[fileKey]){
    delete m[fileKey];
    _favSaveAll217(m);
    return false;
  } else {
    m[fileKey]={name:name||'',folder:folder||'',favAt:Date.now()};
    _favSaveAll217(m);
    if(buf&&typeof saveFile==='function') saveFile(buf,fileKey);
    return true;
  }
}
// お気に入りだが現在開いていない(タブが閉じられた)ファイルを再度開く。
// 保存済みバイナリが見つからない場合は既存のshowGuide()で案内するのみで、
// 既存の開く処理(openDxfFromDb)自体には一切手を加えない
function _favReopenClosed217(fileKey){
  var m=_favLoadAll217();
  var meta=m[fileKey];
  if(!meta) return;
  if(typeof _lsIdbGetP!=='function'){ if(typeof showGuide==='function') showGuide('再オープン機能が利用できません',2000); return; }
  _lsIdbGetP(fileKey,null).then(function(buf){
    if(!buf){
      if(typeof showGuide==='function') showGuide('「'+(meta.name||'')+'」の保存データが見つからず開けません。一度ファイルから開くと次回から開けるようになります',3500);
      return;
    }
    if(typeof openDxfFromDb==='function') openDxfFromDb(meta.name,buf,null,meta.folder);
  });
}

function _showOpenFilesListMenu(anchorEl){
  var existing=document.getElementById('_tabListMenu');
  if(existing){existing.remove();return;}
  var menu=document.createElement('div');
  menu.id='_tabListMenu';
  var _mode='text'; // V1_201: 'text'=文字一覧(既定・従来動作) / 'preview'=プレビュー付き全画面一覧
  // V1_104: ファイル数が多いとリストが伸び、末尾の「選択したタブを閉じる」ボタンが
  // スクロールしないと見えなかった。メニュー全体をスクロールさせるのではなく、
  // 一覧部分(listWrap)だけを内部スクロールさせるレイアウトに変更し、タイトル・並び順・
  // 全て選択・閉じるボタンは常に画面内に固定表示されるようにした
  // V1_201: プレビューモードはPDFページ一覧と同様に画面いっぱいに表示する
  function applyMenuStyle(){
    if(_mode==='preview'){
      menu.style.cssText='position:fixed;z-index:9999;inset:0;width:100%;height:100%;background:#14263c;border:none;border-radius:0;padding:14px;display:flex;flex-direction:column;gap:6px;box-shadow:none;';
    } else {
      menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px;min-width:240px;max-width:340px;max-height:70vh;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.7);';
      var r=anchorEl.getBoundingClientRect();
      menu.style.top=(r.bottom+6)+'px';
      menu.style.right=(window.innerWidth-r.right)+'px';
    }
  }
  applyMenuStyle();
  function closeMenu(){if(document.getElementById('_tabListMenu'))menu.remove();}

  // V1_201: タイトル行(タイトル＋プレビュー/文字一覧切替＋閉じる[プレビュー時のみ、
  // 全画面表示では外側クリックで閉じられないため必須])
  var headerRow=document.createElement('div');
  headerRow.style.cssText='display:flex;align-items:center;gap:6px;flex-shrink:0;';
  var title=document.createElement('div');
  title.style.cssText='color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;flex:1;';
  title.textContent='開いているファイル（'+openFiles.length+'件）';
  var modeBtn=document.createElement('button');
  modeBtn.type='button';
  modeBtn.style.cssText='background:none;border:1px solid #3a5578;color:#aac8e8;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer;flex-shrink:0;';
  var closeFullBtn=document.createElement('button');
  closeFullBtn.type='button';
  closeFullBtn.textContent='✕';
  closeFullBtn.style.cssText='background:none;border:none;color:#889;font-size:20px;padding:2px 6px;cursor:pointer;flex-shrink:0;';
  closeFullBtn.onclick=closeMenu;
  // V1_224: デザイン統一。従来はモード切替中でもボタンの見た目(枠線・背景)が一切変化せず
  // 文字だけが入れ替わっていたため「今どちらのモードか」が分かりにくかった。ペン/蛍光ペン等の
  // 標準ツールボタンや図面番号モードボタン(V1_224で統一済み)と同じ「選択中はシアン
  // (rgba(0,212,255,.22)+枠線#00d4ff)」の表現に合わせ、プレビュー表示中は同じシアンで
  // 強調表示するようにした
  function updateHeaderBtns(){
    modeBtn.textContent=(_mode==='preview')?'☰ 文字一覧':'🖼 プレビュー';
    modeBtn.style.background=(_mode==='preview')?'rgba(0,212,255,0.22)':'none';
    modeBtn.style.borderColor=(_mode==='preview')?'#00d4ff':'#3a5578';
    modeBtn.style.color=(_mode==='preview')?'#00d4ff':'#aac8e8';
    closeFullBtn.style.display=(_mode==='preview')?'':'none';
  }
  modeBtn.addEventListener('click',function(){
    _mode=(_mode==='preview')?'text':'preview';
    applyMenuStyle();
    updateHeaderBtns();
    applyListBodyStyle();
    render();
  });
  headerRow.appendChild(title);
  headerRow.appendChild(modeBtn);
  headerRow.appendChild(closeFullBtn);
  menu.appendChild(headerRow);
  updateHeaderBtns();

  // V1_80: 並び順選択（設定パネルの「タブの並び順」と同じ4択・同じ状態を共有する）
  var sortRow=document.createElement('div');
  sortRow.style.cssText='display:flex;flex-wrap:wrap;gap:4px;padding:2px 0 6px;justify-content:center;flex-shrink:0;';
  var _sortOptions=[['name','名前順'],['opened','開いた順'],['access','アクセス順'],['manual','任意'],['type','種類順']]; // V1_104: 種類順(DXF/PDF/エクセル)を追加
  var _sortBtns={};
  _sortOptions.forEach(function(opt){
    var b=document.createElement('button');
    b.type='button';
    b.textContent=opt[1];
    b.style.cssText='font-size:11px;padding:4px 8px;border-radius:12px;border:1px solid #3a5578;cursor:pointer;background:none;color:#aac8e8;';
    b.addEventListener('click',function(){
      if(typeof _setTabSortMode==='function') _setTabSortMode(opt[0]);
      updateSortBtns();
      render();
    });
    _sortBtns[opt[0]]=b;
    sortRow.appendChild(b);
  });
  // V1_224: デザイン統一。選択中の並び順チップも、同じポップアップ内の他のトグル
  // (プレビュー切替・お気に入りのみ表示)と同じシアン表現に揃えた
  function updateSortBtns(){
    _sortOptions.forEach(function(opt){
      var active=(typeof _tabSortMode!=='undefined')&&_tabSortMode===opt[0];
      _sortBtns[opt[0]].style.background=active?'rgba(0,212,255,0.22)':'none';
      _sortBtns[opt[0]].style.borderColor=active?'#00d4ff':'#3a5578';
      _sortBtns[opt[0]].style.color=active?'#00d4ff':'#aac8e8';
      _sortBtns[opt[0]].style.fontWeight=active?'700':'400';
    });
  }
  menu.appendChild(sortRow);

  // V1_217: 「お気に入りのみ表示」トグル。ONにすると、開いているタブのうち
  // お気に入り登録済みのものに絞り込み、さらに現在は閉じているお気に入りファイルも
  // (再度開けるボタンとして)一覧の末尾に表示する。OFF(既定)では従来通りの表示のまま
  var _favOnly217=false;
  var favOnlyRow=document.createElement('div');
  favOnlyRow.style.cssText='display:flex;justify-content:center;padding:0 0 4px;flex-shrink:0;';
  var favOnlyBtn=document.createElement('button');
  favOnlyBtn.type='button';
  favOnlyBtn.style.cssText='font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid #3a5578;cursor:pointer;background:none;color:#aac8e8;';
  // V1_224: デザイン統一。従来はON時に独自の青塗り(#4a9eff)+濃紺文字だったが、同じ
  // ポップアップ内のプレビュー切替ボタン(モードボタン、V1_224で統一済み)や図面番号モード
  // ボタン等、アプリ全体の「選択中」表現(シアンrgba(0,212,255,.22)+枠線#00d4ff)に揃えた
  function updateFavOnlyBtn(){
    favOnlyBtn.textContent=_favOnly217?'★ お気に入りのみ表示中':'☆ お気に入りのみ表示';
    favOnlyBtn.style.background=_favOnly217?'rgba(0,212,255,0.22)':'none';
    favOnlyBtn.style.borderColor=_favOnly217?'#00d4ff':'#3a5578';
    favOnlyBtn.style.color=_favOnly217?'#00d4ff':'#aac8e8';
    favOnlyBtn.style.fontWeight=_favOnly217?'700':'400';
  }
  favOnlyBtn.addEventListener('click',function(){
    _favOnly217=!_favOnly217;
    updateFavOnlyBtn();
    render();
  });
  updateFavOnlyBtn();
  favOnlyRow.appendChild(favOnlyBtn);
  menu.appendChild(favOnlyRow);

  // V1_104: 「全て選択」チェックボックス。ファイル数が多い時に1件ずつタップせずに
  // まとめて選択・解除できるようにする
  var selectAllRow=document.createElement('label');
  selectAllRow.style.cssText='display:flex;align-items:center;gap:6px;padding:2px 4px 4px;cursor:pointer;font-size:12px;color:#aac8e8;flex-shrink:0;';
  var selectAllCb=document.createElement('input');
  selectAllCb.type='checkbox';
  selectAllCb.style.cssText='width:18px;height:18px;cursor:pointer;flex-shrink:0;';
  var selectAllLabel=document.createElement('span');
  selectAllLabel.textContent='全て選択';
  selectAllRow.appendChild(selectAllCb);
  selectAllRow.appendChild(selectAllLabel);
  menu.appendChild(selectAllRow);

  // V1_104: 一覧部分だけを内部スクロールさせるためのラッパー。listWrapにflex:1と
  // overflow-y:autoを持たせ、タイトル・並び順・全て選択・閉じるボタンはmenu(flex column)
  // 側に固定表示されたまま残る
  var listWrap=document.createElement('div');
  listWrap.style.cssText='flex:1;min-height:0;overflow-y:auto;';
  menu.appendChild(listWrap);

  var listBody=document.createElement('div');
  listWrap.appendChild(listBody);
  // V1_201: 文字一覧(縦積みの行)とプレビュー一覧(サムネイル付きグリッド)でlistBodyの
  // レイアウトを切り替える
  function applyListBodyStyle(){
    // V1_208: プレビューが小さいとの指摘のため、カード最小幅を150px→300px(約2倍)に拡大
    listBody.style.cssText=(_mode==='preview')
      ?'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;align-content:start;'
      :'display:flex;flex-direction:column;gap:2px;';
  }
  applyListBodyStyle();

  // V1_182: 複数選択したファイルへの一括「HD-PDF書出」「バックアップ」ボタン。
  // どちらもファイルを閉じない(選択したタブを閉じるボタンとは独立)。
  // exportHybridPDF/exportDxfviewManualはいずれもグローバル変数(doc/strokes/dims/
  // currentFileName等)を直接参照する実装のため、switchToFile(idx)で対象タブに
  // 切り替えた直後にそのまま呼び出せば、そのタブのデータを正しく処理できる
  // (switchToFileは同期関数でありrAFの描画完了を待つ必要はない)
  var batchRow=document.createElement('div');
  batchRow.style.cssText='display:flex;gap:6px;margin-top:4px;flex-shrink:0;';
  var batchPdfBtn=document.createElement('button');
  batchPdfBtn.type='button';
  batchPdfBtn.disabled=true;
  batchPdfBtn.style.cssText='flex:1;background:#f1c40f;color:#000;border:none;border-radius:8px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;opacity:.5;';
  batchPdfBtn.textContent='HD-PDF書出';
  var batchBackupBtn=document.createElement('button');
  batchBackupBtn.type='button';
  batchBackupBtn.disabled=true;
  batchBackupBtn.style.cssText='flex:1;background:#fff;color:#000;border:none;border-radius:8px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;opacity:.5;';
  batchBackupBtn.textContent='バックアップ';
  batchRow.appendChild(batchPdfBtn);
  batchRow.appendChild(batchBackupBtn);
  menu.appendChild(batchRow);

  var closeSelBtn=document.createElement('button');
  closeSelBtn.type='button';
  closeSelBtn.disabled=true;
  closeSelBtn.style.cssText='background:#8B0000;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;opacity:.5;margin-top:4px;flex-shrink:0;';
  closeSelBtn.textContent='選択したタブを閉じる';
  menu.appendChild(closeSelBtn);

  var selected=new Set(); // 選択中のfileKey（インデックスは閉じるたびにずれるためfileKeyで管理する）
  // V1_104: 「全て選択」チェックボックスの状態(全選択/一部選択/未選択)を、実際のselected
  // の中身に合わせて同期する。個別チェックボックスの変更・全体再描画のたびに呼ぶ
  function updateSelectAllCb(){
    var keyed=openFiles.filter(function(f){return !!f.fileKey;});
    var allSelected=keyed.length>0&&keyed.every(function(f){return selected.has(f.fileKey);});
    selectAllCb.checked=allSelected;
    selectAllCb.indeterminate=!allSelected&&selected.size>0;
  }
  selectAllCb.addEventListener('change',function(){
    if(selectAllCb.checked){
      openFiles.forEach(function(f){ if(f.fileKey) selected.add(f.fileKey); });
    } else {
      selected.clear();
    }
    updateCloseSelBtn();
    render();
  });
  function updateCloseSelBtn(){
    var n=selected.size;
    closeSelBtn.disabled=(n===0);
    closeSelBtn.style.opacity=(n===0)?'.5':'1';
    closeSelBtn.textContent=(n===0)?'選択したタブを閉じる':('選択した'+n+'件を閉じる');
    // V1_182: HD-PDF書出/バックアップボタンの有効/無効・件数表示もここで一緒に更新する
    batchPdfBtn.disabled=(n===0);
    batchPdfBtn.style.opacity=(n===0)?'.5':'1';
    batchPdfBtn.textContent=(n===0)?'HD-PDF書出':('HD-PDF書出('+n+'件)');
    batchBackupBtn.disabled=(n===0);
    batchBackupBtn.style.opacity=(n===0)?'.5':'1';
    batchBackupBtn.textContent=(n===0)?'バックアップ':('バックアップ('+n+'件)');
    updateSelectAllCb();
  }
  closeSelBtn.onclick=function(){
    if(selected.size===0) return;
    var keys=Array.from(selected);
    if(!confirm('選択した'+keys.length+'件のタブを閉じますか？')) return;
    // V1_80: fileKeyから現在のインデックスを都度引き直し、降順(インデックスが大きい方)から
    // 閉じることで、途中でopenFiles[]がsplice()されてもまだ処理していない選択項目の
    // インデックスに影響が出ないようにする
    var idxs=keys.map(function(k){return openFiles.findIndex(function(x){return x.fileKey===k;});})
      .filter(function(i){return i>=0;})
      .sort(function(a,b){return b-a;});
    idxs.forEach(function(i){ if(typeof doCloseTab==='function') doCloseTab(i); });
    closeMenu();
    if(typeof showGuide==='function') showGuide(idxs.length+'件のタブを閉じました',2000);
  };

  // V1_182: 選択したfileKey群を、閉じるたびにインデックスがずれても正しく引けるよう
  // 都度openFiles内のインデックスへ変換する共通処理
  function _selectedIdxs182(){
    var keys=Array.from(selected);
    return keys.map(function(k){return openFiles.findIndex(function(x){return x.fileKey===k;});})
      .filter(function(i){return i>=0;});
  }
  // V1_183: 複数選択時のHD-PDF書出/バックアップは、以前は1件ずつ個別に保存(pdf.save/
  // showSaveFilePicker等)していたが、iOS Safari等のブラウザは「1回のユーザー操作につき
  // 1回」しか保存/共有を許可しないため、1件目しか保存されず2件目以降が出てこない不具合が
  // あった。export.js側にexportHybridPDFBatch183/exportDxfviewManualBatch183を新設し、
  // 各ファイルの生成物をいったん集めて1つのZIPにまとめ、保存自体は1回だけ行うようにした
  batchPdfBtn.onclick=function(){
    if(selected.size===0) return;
    var n=selected.size;
    if(!confirm('選択した'+n+'件をHD-PDF書出します。よろしいですか？')) return;
    var idxs=_selectedIdxs182();
    closeMenu();
    if(typeof exportHybridPDFBatch183!=='function') return;
    exportHybridPDFBatch183(idxs).then(function(res){
      if(typeof showGuide==='function'){
        showGuide('HD-PDF書出完了: '+res.count+'件'+(res.skipped>0?(' (データなし等で'+res.skipped+'件スキップ)'):''),3000);
      }
    });
  };
  batchBackupBtn.onclick=function(){
    if(selected.size===0) return;
    var n=selected.size;
    if(!confirm('選択した'+n+'件をバックアップします。よろしいですか？')) return;
    var idxs=_selectedIdxs182();
    closeMenu();
    if(typeof exportDxfviewManualBatch183!=='function') return;
    exportDxfviewManualBatch183(idxs).then(function(res){
      if(typeof showGuide==='function'){
        showGuide('バックアップ完了: '+res.count+'件'+(res.skipped>0?(' (データなし等で'+res.skipped+'件スキップ)'):''),3000);
      }
    });
  };

  // V1_217: ★お気に入りトグルのボタンを1つ生成する共通ヘルパー(文字一覧・
  // プレビュー一覧の両方で使う)。isFav=現在お気に入りかどうか、onToggleは
  // トグル後に呼ぶコールバック(再描画用)
  function _makeFavStarBtn217(isFav,onToggle){
    var star=document.createElement('button');
    star.type='button';
    star.textContent=isFav?'★':'☆';
    star.title=isFav?'お気に入りから外す':'お気に入りに追加';
    star.style.cssText='background:none;border:none;font-size:18px;line-height:1;padding:2px 4px;cursor:pointer;flex-shrink:0;color:'+(isFav?'#ffd60a':'#889')+';';
    star.addEventListener('click',function(ev){
      ev.stopPropagation(); // 行/カードのクリック(タブ切替)を誘発しない
      onToggle();
    });
    return star;
  }
  // V1_217: 現在お気に入りだが、開いているタブには無い(閉じられた)ファイルの
  // 一覧を返す。{fileKey,name,folder}の配列
  function _closedFavEntries217(){
    var m=_favLoadAll217();
    var openKeys={};
    openFiles.forEach(function(f){ if(f.fileKey) openKeys[f.fileKey]=true; });
    var out=[];
    Object.keys(m).forEach(function(k){ if(!openKeys[k]) out.push({fileKey:k,name:m[k].name,folder:m[k].folder}); });
    return out;
  }

  function renderList(){
    listBody.innerHTML='';
    // V1_80: 設定パネルの「タブの並び順」と同じ並び順ロジックを共有する
    // （従来はこのパネルだけ常にアクセス順(_lastActiveTs降順)固定だった）
    var idxs=(typeof _computeTabOrder==='function')?_computeTabOrder():openFiles.map(function(f,i){return i;});
    // V1_217: 「お気に入りのみ表示」がONの場合、開いているタブはお気に入り登録済みの
    // ものだけに絞り込む(既存の並び順ロジック自体はそのまま利用する)
    if(_favOnly217) idxs=idxs.filter(function(idx){ var f=openFiles[idx]; return f.fileKey&&_favIsFav217(f.fileKey); });
    var closedFavs=_favOnly217?_closedFavEntries217():[];
    if(idxs.length===0&&closedFavs.length===0){
      var e=document.createElement('div');
      e.style.cssText='color:#889;font-size:13px;text-align:center;padding:8px 0;';
      e.textContent=_favOnly217?'お気に入りはまだありません':'開いているファイルはありません';
      listBody.appendChild(e);
      return;
    }
    // V1_71: タブバーと同じ配色（赤=アクティブ/黄=前回/青=前々回）を共通関数で判定し統一する
    var _ranks71=(typeof _getTabRecencyRanks==='function')?_getTabRecencyRanks():{recent1:-1,recent2:-1};
    idxs.forEach(function(idx){
      var f=openFiles[idx];
      var row=document.createElement('div');
      var isActive=(idx===currentFileIdx);
      var isRecent1=(idx===_ranks71.recent1), isRecent2=(idx===_ranks71.recent2);
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:8px;border-bottom:1px solid #2a3d55;cursor:pointer;'+(isActive?'background:rgba(255,85,85,.15);':'');

      var cb=document.createElement('input');
      cb.type='checkbox';
      cb.style.cssText='width:20px;height:20px;flex-shrink:0;cursor:pointer;';
      cb.checked=f.fileKey?selected.has(f.fileKey):false;
      cb.addEventListener('click',function(ev){ ev.stopPropagation(); }); // 行クリック(タブ切替)を誘発しない
      cb.addEventListener('change',function(){
        if(!f.fileKey) return; // fileKeyが無い異常系は選択対象にしない
        if(cb.checked) selected.add(f.fileKey); else selected.delete(f.fileKey);
        updateCloseSelBtn();
      });

      // V1_217: ★お気に入りトグル。追加時はopenFilesBufs[idx](このタブの
      // バイナリ)を渡し、閉じた後も再度開けるよう保存しておく
      var star217=_makeFavStarBtn217(f.fileKey?_favIsFav217(f.fileKey):false,function(){
        if(!f.fileKey) return;
        _favToggle217(f.fileKey,f.currentFileName||f.name,f.folder,openFilesBufs[idx]);
        render();
        if(typeof updateFileNavUI==='function') updateFileNavUI(); // V1_220: タブバーの★表示も即時反映
      });

      // V1_109: バッジのラベル・色は_fileTypeInfo()（index.html）に一元化。
      // タブバー側と同じ配色（DXF=青/PDF=紫/XLS=緑）になるようにするため
      var _typeInfo109=(typeof _fileTypeInfo==='function')?_fileTypeInfo(f.currentFileName||f.name):{label:'DXF',color:'#1565c0'};
      var badge=document.createElement('span');
      badge.textContent=_typeInfo109.label;
      badge.style.cssText='font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;flex-shrink:0;background:'+_typeInfo109.color+';color:#fff;';
      var info=document.createElement('div');
      info.style.cssText='flex:1;min-width:0;';
      var timeStr=f._lastActiveTs?'表示済み':'未表示';
      var sub=[f.folder||'',timeStr].filter(Boolean).join('・');
      var nameColor=isActive?'#ff5555':isRecent1?'#ffd60a':isRecent2?'#4da6ff':'#eee';
      info.innerHTML='<div style="color:'+nameColor+';font-size:13px;font-weight:'+(isActive?'700':'400')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(f.currentFileName||f.name||'---')+'</div>'
        +'<div style="color:#889;font-size:11px;">'+sub+'</div>';
      row.appendChild(cb);row.appendChild(star217);row.appendChild(badge);row.appendChild(info);
      row.addEventListener('click',function(){
        closeMenu();
        if(idx!==currentFileIdx&&typeof switchToFile==='function') switchToFile(idx);
      });
      listBody.appendChild(row);
    });
    // V1_217: 閉じているお気に入りファイル(再度開くボタンとして表示)
    closedFavs.forEach(function(cf){
      var row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:8px;border-bottom:1px dashed #2a3d55;cursor:pointer;opacity:.8;';
      var star217=_makeFavStarBtn217(true,function(){ _favToggle217(cf.fileKey,cf.name,cf.folder); render(); });
      var badge=document.createElement('span');
      badge.textContent='閉';
      badge.style.cssText='font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;flex-shrink:0;background:#555;color:#fff;';
      var info=document.createElement('div');
      info.style.cssText='flex:1;min-width:0;';
      info.innerHTML='<div style="color:#ccc;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(cf.name||'---')+'</div>'
        +'<div style="color:#889;font-size:11px;">'+(cf.folder||'')+'（タップで再度開く）</div>';
      row.appendChild(star217);row.appendChild(badge);row.appendChild(info);
      row.addEventListener('click',function(){ closeMenu(); _favReopenClosed217(cf.fileKey); });
      listBody.appendChild(row);
    });
  }

  // V1_201: プレビュー一覧(サムネイル付きグリッド)。並び順・選択状態・バッジ・クリックで
  // タブ切替という機能面はrenderList()と同じで、見た目だけをカード形式にしたもの。
  function renderGrid(){
    listBody.innerHTML='';
    var idxs=(typeof _computeTabOrder==='function')?_computeTabOrder():openFiles.map(function(f,i){return i;});
    // V1_217: 「お気に入りのみ表示」がONの場合、開いているタブはお気に入り登録済みの
    // ものだけに絞り込む
    if(_favOnly217) idxs=idxs.filter(function(idx){ var f=openFiles[idx]; return f.fileKey&&_favIsFav217(f.fileKey); });
    var closedFavs=_favOnly217?_closedFavEntries217():[];
    if(idxs.length===0&&closedFavs.length===0){
      var e=document.createElement('div');
      e.style.cssText='color:#889;font-size:13px;text-align:center;padding:8px 0;grid-column:1/-1;';
      e.textContent=_favOnly217?'お気に入りはまだありません':'開いているファイルはありません';
      listBody.appendChild(e);
      return;
    }
    var _ranks71=(typeof _getTabRecencyRanks==='function')?_getTabRecencyRanks():{recent1:-1,recent2:-1};
    idxs.forEach(function(idx){
      var f=openFiles[idx];
      var isActive=(idx===currentFileIdx);
      var isRecent1=(idx===_ranks71.recent1), isRecent2=(idx===_ranks71.recent2);
      var card=document.createElement('div');
      card.style.cssText='display:flex;flex-direction:column;background:#1e3a5f;border-radius:10px;overflow:hidden;cursor:pointer;border:2px solid '+(isActive?'#ff5555':'transparent')+';';

      // V1_208: プレビューが小さいとの指摘のため、サムネイル高さ・生成解像度を約2倍に拡大
      var thumbWrap=document.createElement('div');
      thumbWrap.style.cssText='position:relative;width:100%;height:200px;background:#04203f;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
      var img=document.createElement('img');
      img.style.cssText='max-width:100%;max-height:100%;object-fit:contain;';
      thumbWrap.appendChild(img);
      if(typeof _genFileThumb201==='function'){
        _genFileThumb201(f,300,200,function(url){ if(url) img.src=url; });
      }

      var cb=document.createElement('input');
      cb.type='checkbox';
      cb.style.cssText='position:absolute;top:4px;left:4px;width:22px;height:22px;cursor:pointer;';
      cb.checked=f.fileKey?selected.has(f.fileKey):false;
      cb.addEventListener('click',function(ev){ ev.stopPropagation(); });
      cb.addEventListener('change',function(){
        if(!f.fileKey) return;
        if(cb.checked) selected.add(f.fileKey); else selected.delete(f.fileKey);
        updateCloseSelBtn();
      });
      thumbWrap.appendChild(cb);

      var _typeInfo109=(typeof _fileTypeInfo==='function')?_fileTypeInfo(f.currentFileName||f.name):{label:'DXF',color:'#1565c0'};
      var badge=document.createElement('span');
      badge.textContent=_typeInfo109.label;
      badge.style.cssText='position:absolute;top:4px;right:4px;font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;background:'+_typeInfo109.color+';color:#fff;';
      thumbWrap.appendChild(badge);

      // V1_217: ★お気に入りトグル。サムネイル左下(チェックボックス=左上、種類
      // バッジ=右上と重ならない位置)に配置する
      var star217=_makeFavStarBtn217(f.fileKey?_favIsFav217(f.fileKey):false,function(){
        if(!f.fileKey) return;
        _favToggle217(f.fileKey,f.currentFileName||f.name,f.folder,openFilesBufs[idx]);
        render();
        if(typeof updateFileNavUI==='function') updateFileNavUI(); // V1_220: タブバーの★表示も即時反映
      });
      star217.style.position='absolute';star217.style.bottom='4px';star217.style.left='4px';
      star217.style.background='rgba(4,32,63,.7)';star217.style.borderRadius='6px';
      thumbWrap.appendChild(star217);
      card.appendChild(thumbWrap);

      var nameColor=isActive?'#ff5555':isRecent1?'#ffd60a':isRecent2?'#4da6ff':'#eee';
      var nameEl=document.createElement('div');
      nameEl.style.cssText='color:'+nameColor+';font-size:12px;font-weight:'+(isActive?'700':'400')+';padding:6px 6px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;';
      nameEl.textContent=f.currentFileName||f.name||'---';
      card.appendChild(nameEl);

      card.addEventListener('click',function(){
        closeMenu();
        if(idx!==currentFileIdx&&typeof switchToFile==='function') switchToFile(idx);
      });
      listBody.appendChild(card);
    });
    // V1_217: 閉じているお気に入りファイル(タップで再度開く、プレビューは生成できない
    // ためサムネイル欄にアイコンのみ表示するシンプルなカード)
    closedFavs.forEach(function(cf){
      var card=document.createElement('div');
      card.style.cssText='display:flex;flex-direction:column;background:#1e3a5f;border-radius:10px;overflow:hidden;cursor:pointer;border:2px dashed #556;opacity:.8;';
      var thumbWrap=document.createElement('div');
      thumbWrap.style.cssText='position:relative;width:100%;height:200px;background:#04203f;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#556;font-size:13px;';
      thumbWrap.textContent='（タップで再度開く）';
      var star217=_makeFavStarBtn217(true,function(){ _favToggle217(cf.fileKey,cf.name,cf.folder); render(); });
      star217.style.position='absolute';star217.style.bottom='4px';star217.style.left='4px';
      star217.style.background='rgba(4,32,63,.7)';star217.style.borderRadius='6px';
      thumbWrap.appendChild(star217);
      var badge=document.createElement('span');
      badge.textContent='閉';
      badge.style.cssText='position:absolute;top:4px;right:4px;font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;background:#555;color:#fff;';
      thumbWrap.appendChild(badge);
      card.appendChild(thumbWrap);
      var nameEl=document.createElement('div');
      nameEl.style.cssText='color:#ccc;font-size:12px;padding:6px 6px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;';
      nameEl.textContent=cf.name||'---';
      card.appendChild(nameEl);
      card.addEventListener('click',function(){ closeMenu(); _favReopenClosed217(cf.fileKey); });
      listBody.appendChild(card);
    });
  }

  // V1_201: 現在のモードに応じてどちらの一覧を描くかを振り分ける共通入口
  function render(){
    if(_mode==='preview') renderGrid(); else renderList();
  }

  updateSortBtns();
  updateCloseSelBtn();
  render();

  document.body.appendChild(menu);
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    // V1_201: プレビュー(全画面)表示中は外側クリックで閉じない(✕ボタンで閉じる)。
    // 画面いっぱいのオーバーレイのため「外側」がほぼ存在せず、誤操作で閉じやすいため
    if(_mode==='preview') return;
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}
