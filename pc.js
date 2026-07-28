// pc.js — PC(マウス・キーボード)向けの追加機能
// DXF Viewer V1_78
//
// 【設計方針・重要】
// このファイルはiPad+Apple Pencilの操作性を一切変更しないことを最優先とする。
// tool.js等の既存のtouchstart/touchmove/mousedown等のイベントリスナーは
// 一切変更・削除しない。ここでは「新規のイベントリスナーを追加するだけ」に徹する。
//   ・keydown（物理キーボード）: iPadのタッチ/Apple Pencil操作はkeydownを使わないため、
//     物理キーボードが無い環境では発火せず既存動作に影響しない。
//   ・contextmenu（右クリック）: iPadは通常発火しない。外付けトラックパッド接続時の
//     2本指タップ(iPadOSの右クリック相当ジェスチャー)で発火しうるが、これは新規追加の
//     挙動であり、既存のタッチ/Apple Pencilのdraw/pan/pinchロジック(tool.js)には
//     一切影響しない。
//   ・mousedown/mousemove/mouseup（中央ボタン、V1_86追加）: マウスの中央ボタン
//     (e.button===1、ホイール押し込み)はiPadのタッチ/Apple Pencilでは発生し得ない。
//     tool.js側の既存mousedownはe.button!==0で左クリック以外を即returnしており、
//     ここで追加するリスナーはtool.js側の処理と競合しない（tool.js側は素通りするだけ）。
//   ・#file/#folderInputのaccept属性削除（V1_89/V1_90）: イベントリスナーではなく
//     DOM属性の変更だが、判定にwindow.matchMedia('(hover:hover) and (pointer:fine)')
//     というPC専用の判定条件（V1_78のホバーCSSと同じ判定式）を使うため、
//     iPad(タッチのみ)では条件を満たさず一切実行されない。iPad側のaccept属性
//     (.dxf,application/octet-stream。iOSのFilesアプリで正しくDXFを選択できるよう
//     V1_08/V1_09で調整した経緯があるため変更しない)には一切手を加えない。
// 依存関数・変数: undo, redo, fit, scheduleDraw, history, redoStack (index.html)
//               showGuide (ui.js)
//               getPos, tx, ty (tool.js/viewer.js)
(function(){
  'use strict';

  // =========================================================
  // V1_89: 「ファイルを開く」のOSファイル選択ダイアログが、既定で「カスタムファイル」
  // フィルタ(拡張子が.dxfのみ)になり、PDF/Excelを選ぶ際に手動でフィルタを
  // 「すべてのファイル」へ切り替える一手間が必要という指摘への対応。
  // V1_90: 「フォルダを選択してインデックス作成」でも同様にPDF/Excelが見えにくい・
  // わかりにくいとの指摘があったため、folderInputにも同じ対応を追加した。
  // PC(マウス操作可能な環境、(hover:hover)and(pointer:fine))でのみ#file/#folderInputの
  // accept属性を外し、ダイアログの既定フィルタが最初から「すべてのファイル」になる
  // ようにする。iPadのFilesアプリ/写真アプリの選択シートは、accept属性の値によって
  // 表示内容や挙動が変わる既知の制約(V1_08/V1_09のコメント参照)があるため、
  // この変更はiPadには一切適用しない
  // =========================================================
  try{
    if(window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches){
      var _fileInputV189=document.getElementById('file');
      if(_fileInputV189) _fileInputV189.removeAttribute('accept');
      // V1_90: 「フォルダを選択してインデックス作成」(folderInput)も同様に、PDF/Excelが
      // 見えにくい・選びにくいとの指摘のためaccept属性(.dxf)を外す。folderInput自体は
      // 実際のファイル絞り込みをJS側(change イベント内、拡張子で.dxf/.pdf/Excelを判定)で
      // 行っており、accept属性の有無はここでの処理結果には影響しない
      var _folderInputV190=document.getElementById('folderInput');
      if(_folderInputV190) _folderInputV190.removeAttribute('accept');
    }
  }catch(e){}

  // =========================================================
  // Ctrl+Z / Ctrl+Y（Cmd+Z / Cmd+Shift+Z にも対応）
  // =========================================================
  document.addEventListener('keydown', function(e){
    // 検索欄・登録名入力等、テキスト入力中は何もしない
    // （入力中の文字をCtrl+Zで誤って消してしまう等の事故を防ぐため）
    var ae = document.activeElement;
    var tag = (ae && ae.tagName) || '';
    if(tag==='INPUT' || tag==='TEXTAREA' || (ae && ae.isContentEditable)) return;

    var mod = e.ctrlKey || e.metaKey;
    if(!mod) return;

    var key = (e.key||'').toLowerCase();
    if(key==='z' && !e.shiftKey){
      e.preventDefault();
      if(typeof undo==='function') undo();
    } else if(key==='y' || (key==='z' && e.shiftKey)){
      e.preventDefault();
      if(typeof redo==='function') redo();
    }
  });

  // =========================================================
  // 右クリックメニュー（描画キャンバス #ov 上のみ）
  // =========================================================
  document.addEventListener('contextmenu', function(e){
    var ov = document.getElementById('ov');
    if(!ov || !ov.contains(e.target)) return; // キャンバス以外は既定のブラウザメニューのまま
    e.preventDefault();
    _showPcContextMenu(e.clientX, e.clientY);
  });

  function _showPcContextMenu(x,y){
    var existing = document.getElementById('_pcCtxMenu');
    if(existing) existing.remove();

    var canUndo = (typeof history!=='undefined') && history.length>0;
    var canRedo = (typeof redoStack!=='undefined') && redoStack.length>0;

    var menu = document.createElement('div');
    menu.id = '_pcCtxMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:#1e3a5f;border:2px solid #4a9eff;'
      + 'border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:2px;'
      + 'min-width:170px;box-shadow:0 4px 20px rgba(0,0,0,.7);';
    document.body.appendChild(menu);
    // まず追加してから実測サイズでクランプ（画面外へのはみ出し防止）
    var mw = menu.offsetWidth || 170, mh = menu.offsetHeight || 130;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth-mw-4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight-mh-4)) + 'px';

    function closeMenu(){ if(document.getElementById('_pcCtxMenu')) menu.remove(); }

    function addItem(label, enabled, fn){
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = !enabled;
      b.style.cssText = 'background:none;border:none;text-align:left;padding:9px 12px;'
        + 'font-size:14px;border-radius:6px;cursor:'+(enabled?'pointer':'default')+';'
        + 'color:'+(enabled?'#eee':'#5a6b80')+';';
      if(enabled){
        b.addEventListener('mouseenter', function(){ b.style.background='#2a4a70'; });
        b.addEventListener('mouseleave', function(){ b.style.background='none'; });
        b.addEventListener('click', function(){ closeMenu(); fn(); });
      }
      menu.appendChild(b);
    }

    addItem('元に戻す (Ctrl+Z)', canUndo, function(){ if(typeof undo==='function') undo(); });
    addItem('やり直し (Ctrl+Y)', canRedo, function(){ if(typeof redo==='function') redo(); });
    addItem('全体表示', true, function(){
      if(typeof fit==='function') fit();
      if(typeof scheduleDraw==='function') scheduleDraw();
    });

    setTimeout(function(){
      document.addEventListener('click', function _dc(ev){
        if(!menu.contains(ev.target)){ closeMenu(); document.removeEventListener('click',_dc); }
      });
      document.addEventListener('contextmenu', function _dc2(ev){
        if(!menu.contains(ev.target)){ closeMenu(); document.removeEventListener('contextmenu',_dc2); }
      });
    },10);
  }

  // =========================================================
  // V1_86: マウスの中央ボタン(ホイール押し込み)を押しながらドラッグでスクロール(パン)。
  // 慣性(勢いで動き続ける効果)は付けない — ボタンを離した位置でぴたっと止まる。
  // 描画キャンバス(#ov)上のみで有効。左クリック(既存のtool.js側mousedown/mousemove/
  // mouseup)や右クリックメニューとは独立した、新規追加のイベントリスナーのみで完結する。
  // =========================================================
  var _pcMidPanning = false, _pcMidLastX = 0, _pcMidLastY = 0;

  document.addEventListener('mousedown', function(e){
    if(e.button !== 1) return;
    var ov = document.getElementById('ov');
    if(!ov || !ov.contains(e.target)) return;
    e.preventDefault(); // ブラウザ既定の中央ボタン自動スクロールアイコンを抑止
    if(typeof getPos !== 'function') return;
    var p = getPos(e);
    _pcMidPanning = true;
    _pcMidLastX = p.x; _pcMidLastY = p.y;
  });

  document.addEventListener('mousemove', function(e){
    if(!_pcMidPanning) return;
    if(typeof getPos !== 'function') return;
    var p = getPos(e);
    // V0_79等の既存パン処理(tool.js)と同じ「移動量をそのまま加算するだけ」の式。
    // 減速・継続処理を一切行わないため、慣性は付かない
    tx += p.x - _pcMidLastX;
    ty += p.y - _pcMidLastY;
    _pcMidLastX = p.x; _pcMidLastY = p.y;
    if(typeof scheduleDraw === 'function') scheduleDraw();
  });

  document.addEventListener('mouseup', function(e){
    if(e.button === 1) _pcMidPanning = false;
  });
  // ウィンドウ外でボタンを離した場合や、フォーカスが外れた場合もパン状態を残さない
  window.addEventListener('blur', function(){ _pcMidPanning = false; });

})();
