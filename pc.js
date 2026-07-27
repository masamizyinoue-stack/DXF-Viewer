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
// 依存関数・変数: undo, redo, fit, scheduleDraw, history, redoStack (index.html)
//               showGuide (ui.js)
(function(){
  'use strict';

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

})();
