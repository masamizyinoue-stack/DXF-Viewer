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
    +'<button id="_idxNameGo" style="background:#1a7a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;cursor:pointer;">登録</button>'
    +'<button id="_idxNameCnl" style="background:#333;color:#aaa;border:none;border-radius:8px;padding:8px;font-size:12px;cursor:pointer;">キャンセル</button>';
  document.body.appendChild(menu);
  function closeMenu(){if(document.getElementById('_idxNameMenu'))menu.remove();}
  var inp=document.getElementById('_idxNameInput');
  inp.focus();
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
// V1_70: 開いているファイル一覧（タブが多い時に見失わないための一覧パネル）
// V1_80: 並び順を設定パネルと同じ4種類(名前順/開いた順/アクセス順/任意)から
//        選べるようにし(_computeTabOrder/_setTabSortMode(index.html)を共通利用)、
//        各行にチェックボックスを追加して複数タブをまとめて閉じられるようにした
// 依存グローバル: openFiles, currentFileIdx, _tabSortMode (index.html)
// 依存関数: switchToFile, _computeTabOrder, _setTabSortMode, doCloseTab (index.html)
// =========================================================
function _showOpenFilesListMenu(anchorEl){
  var existing=document.getElementById('_tabListMenu');
  if(existing){existing.remove();return;}
  var menu=document.createElement('div');
  menu.id='_tabListMenu';
  // V1_104: ファイル数が多いとリストが伸び、末尾の「選択したタブを閉じる」ボタンが
  // スクロールしないと見えなかった。メニュー全体をスクロールさせるのではなく、
  // 一覧部分(listWrap)だけを内部スクロールさせるレイアウトに変更し、タイトル・並び順・
  // 全て選択・閉じるボタンは常に画面内に固定表示されるようにした
  menu.style.cssText='position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px;min-width:240px;max-width:340px;max-height:70vh;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.7);';
  var r=anchorEl.getBoundingClientRect();
  menu.style.top=(r.bottom+6)+'px';
  menu.style.right=(window.innerWidth-r.right)+'px';
  function closeMenu(){if(document.getElementById('_tabListMenu'))menu.remove();}

  var title=document.createElement('div');
  title.style.cssText='color:#aac8e8;font-size:12px;font-weight:bold;text-align:center;flex-shrink:0;';
  title.textContent='開いているファイル（'+openFiles.length+'件）';
  menu.appendChild(title);

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
      renderList();
    });
    _sortBtns[opt[0]]=b;
    sortRow.appendChild(b);
  });
  function updateSortBtns(){
    _sortOptions.forEach(function(opt){
      var active=(typeof _tabSortMode!=='undefined')&&_tabSortMode===opt[0];
      _sortBtns[opt[0]].style.background=active?'#4a9eff':'none';
      _sortBtns[opt[0]].style.color=active?'#04203f':'#aac8e8';
      _sortBtns[opt[0]].style.fontWeight=active?'700':'400';
    });
  }
  menu.appendChild(sortRow);

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
  listBody.style.cssText='display:flex;flex-direction:column;gap:2px;';
  listWrap.appendChild(listBody);

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
    renderList();
  });
  function updateCloseSelBtn(){
    var n=selected.size;
    closeSelBtn.disabled=(n===0);
    closeSelBtn.style.opacity=(n===0)?'.5':'1';
    closeSelBtn.textContent=(n===0)?'選択したタブを閉じる':('選択した'+n+'件を閉じる');
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

  function renderList(){
    listBody.innerHTML='';
    if(openFiles.length===0){
      var e=document.createElement('div');
      e.style.cssText='color:#889;font-size:13px;text-align:center;padding:8px 0;';
      e.textContent='開いているファイルはありません';
      listBody.appendChild(e);
      return;
    }
    // V1_80: 設定パネルの「タブの並び順」と同じ並び順ロジックを共有する
    // （従来はこのパネルだけ常にアクセス順(_lastActiveTs降順)固定だった）
    var idxs=(typeof _computeTabOrder==='function')?_computeTabOrder():openFiles.map(function(f,i){return i;});
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
      row.appendChild(cb);row.appendChild(badge);row.appendChild(info);
      row.addEventListener('click',function(){
        closeMenu();
        if(idx!==currentFileIdx&&typeof switchToFile==='function') switchToFile(idx);
      });
      listBody.appendChild(row);
    });
  }

  updateSortBtns();
  updateCloseSelBtn();
  renderList();

  document.body.appendChild(menu);
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}
