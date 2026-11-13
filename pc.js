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
  // V3_74: PDFのページ送りをキーボードで行う(PC向け)
  //   ←/PageUp=前のページ、→/PageDown=次のページ、Home=最初、End=最後
  //   画面右上の◀▶ボタンと同じ処理を呼ぶ(ボタンのクリックを発火)。入力中・修飾キー併用・
  //   ダイアログ表示中は何もしない
  // =========================================================
  document.addEventListener('keydown', function(e){
    if(e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    var k = e.key;
    if(k!=='ArrowLeft' && k!=='ArrowRight' && k!=='PageUp' && k!=='PageDown' && k!=='Home' && k!=='End') return;
    var ae = document.activeElement, tag = (ae && ae.tagName) || '';
    if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (ae && ae.isContentEditable)) return;
    if(typeof pdfDoc==='undefined' || !pdfDoc || !(pdfDoc.numPages>1)) return;
    if(typeof currentTool!=='undefined' && currentTool==='image' && typeof _imgDrag72!=='undefined' && _imgDrag72) return; // 画像をドラッグ中
    var ctrl = document.getElementById('pdfPageCtrl');
    if(!ctrl || ctrl.style.display==='none') return;
    // 開いているポップアップ/ダイアログ(固定表示のオーバーレイ)があれば何もしない
    var ovs = document.querySelectorAll('.modal.open, .overlay.open, #pdfThumbOverlay, [id$="Overlay"].open');
    for(var i=0;i<ovs.length;i++){ if(ovs[i].offsetParent!==null || getComputedStyle(ovs[i]).position==='fixed' && getComputedStyle(ovs[i]).display!=='none') return; }
    var n = pdfPageNum;
    if(k==='ArrowLeft' || k==='PageUp') n = pdfPageNum-1;
    else if(k==='ArrowRight' || k==='PageDown') n = pdfPageNum+1;
    else if(k==='Home') n = 1;
    else n = pdfDoc.numPages;
    if(n<1 || n>pdfDoc.numPages || n===pdfPageNum) { e.preventDefault(); return; }
    e.preventDefault();
    if(k==='ArrowLeft' || k==='PageUp'){ var pb=document.getElementById('prevPage'); if(pb){ pb.click(); return; } }
    if(k==='ArrowRight' || k==='PageDown'){ var nb=document.getElementById('nextPage'); if(nb){ nb.click(); return; } }
    // Home/End: サムネイル選択と同じ手順で移動
    pdfPageNum = n;
    var pi = document.getElementById('pageInfo'); if(pi) pi.textContent = pdfPageNum+'/'+pdfDoc.numPages;
    Promise.resolve(typeof renderPdfPage==='function' ? renderPdfPage(pdfPageNum) : null).then(function(){ if(typeof scheduleSave==='function') scheduleSave(); });
  });

  // =========================================================
  // V3_75: コマンドのキーボードショートカット(PC向け)。V3_84で数字キー(上段1〜7)とFに変更
  //   1=ペン、2=蛍光、3=文字、4=図形、5=消しゴム、6=なげわ、7=画像、F=全体表示
  //   (戻る/進むは従来通りCtrl+Z/Ctrl+Y)。ツールバーのボタンのクリックを呼ぶだけなので、
  //   画面タップ時と同じ処理になる。既に選択中のツールのキーをもう一度押すと、
  //   ボタンの再タップと同じく色/太さ等のポップアップが開く(V3_77)。入力中・修飾キー併用・計算機表示中・
  //   日本語入力変換中は何もしない。e.codeで判定するので全角入力状態でも動く
  // =========================================================
  // V3_84: ショートカットを「画面上部の並び順の数字キー(キーボード上段の1〜7。テンキーではない)」に変更。
  //   1=ペン 2=蛍光 3=文字 4=図形 5=消しゴム 6=なげわ 7=画像 8=サブ窓 9=全体 0=記憶VIEW、Z=DXF計測、Q=前ページ W=次ページ E=ページ一覧、A=計算機、S=追寸、D=読込(V3_98)。
  //   4(図形)は図形ボタンと同じ動作(前回の図形を選ぶ/選択中にもう一度でポップアップ)。図形ポップアップが開いている間は
  //   数字キー1〜6で図形(1四角 2矢印 3丸 4楕円 5雲印 6水・鉛線)を選べる(選ぶとポップアップは閉じる)
  var _PC_KEYS75 = {Digit1:'sketch', Digit2:'hl', Digit3:'text', Digit4:'#shapeToggleBtn', Digit5:'eraser', Digit6:'lasso', Digit7:'image', Digit8:'#subWinBtn', Digit9:'#fitBtn', Digit0:'#vbmToggleBtn', KeyZ:'#measureToggleBtn', KeyQ:'#prevPage', KeyW:'#nextPage', KeyE:'#pdfThumbBtn', KeyA:'#calcBtn', KeyS:'#calcTsuizunBtn98', KeyD:'#calcPickBtn'};
  // V3_98: 計算機の「追寸」ボタンにidを付ける(S=追寸 D=読込。計算機が開いている時だけ有効)
  try{ var _tz98=document.querySelector('#calc [data-cfn="tsuizun"]'); if(_tz98) _tz98.id='calcTsuizunBtn98'; }catch(e){}
  var _PC_LABEL75 = {sketch:'ペン', hl:'蛍光', text:'文字', eraser:'消しゴム', lasso:'なげわ', image:'画像'};
  var _PC_SHAPEKEYS84 = {Digit1:'rect', Digit2:'arrow', Digit3:'circle', Digit4:'ellipse', Digit5:'cloud', Digit6:'hvline'};
  // V3_91: 計測ポップアップが開いている間は数字キー1〜8で計測ツールを選ぶ(選ぶとポップアップは閉じる)
  var _PC_MEASKEYS91 = {Digit1:'dxdy', Digit2:'ll', Digit3:'diag', Digit4:'lp', Digit5:'circDim', Digit6:'radDim', Digit7:'lineLen', Digit8:'ang'};
  try{
    if(!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)){
      Object.keys(_PC_MEASKEYS91).forEach(function(code){
        var b=document.querySelector('#measureToolPopup .tool-btn[data-tool="'+_PC_MEASKEYS91[code]+'"]');
        if(b) b.setAttribute('data-key',code.replace('Digit',''));
      });
    }
  }catch(e){}
  // V3_76: ボタンの角にキー文字を表示し、マウスを乗せた時の説明にもキーを足す(PCのみ。タッチ端末では付けない)
  try{
    if(!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)){
      Object.keys(_PC_KEYS75).forEach(function(code){
        var tgt=_PC_KEYS75[code], key=code.replace(/^(Key|Digit)/,'');
        var b=(tgt.charAt(0)==='#')?document.querySelector(tgt):document.querySelector('.tool-btn[data-tool="'+tgt+'"]');
        if(!b) return;
        b.setAttribute('data-key',key);
        var t=b.getAttribute('title')||''; if(t.indexOf('（'+key+'キー）')<0) b.setAttribute('title',t+'（'+key+'キー）');
      });
    }
  }catch(e){}
  // V3_84: 図形ポップアップ内の各図形ボタンにも、選択用の数字キーを表示する(PCのみ)
  try{
    if(!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)){
      Object.keys(_PC_SHAPEKEYS84).forEach(function(code){
        var b=document.querySelector('#shapeToolPopup .tool-btn[data-tool="'+_PC_SHAPEKEYS84[code]+'"]');
        if(b) b.setAttribute('data-key',code.replace('Digit',''));
      });
    }
  }catch(e){}
  document.addEventListener('keydown', function(e){
    if(e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.repeat) return;
    var tgt = _PC_KEYS75[e.code]; if(!tgt) return;
    var ae = document.activeElement, tag = (ae && ae.tagName) || '';
    if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (ae && ae.isContentEditable)) return;
    // V3_84: 図形ポップアップが開いている間は、数字キーで図形の種類を選ぶ(選んだらポップアップを閉じる)
    var _sp84 = document.getElementById('shapeToolPopup');
    if(_sp84 && _sp84.classList.contains('open') && _PC_SHAPEKEYS84[e.code]){
      var _sb84 = _sp84.querySelector('.tool-btn[data-tool="'+_PC_SHAPEKEYS84[e.code]+'"]');
      if(_sb84){ e.preventDefault(); _sb84.click(); var _done84=document.getElementById('shapeToolPopupDoneBtn'); if(_done84) _done84.click(); }
      return;
    }
    var _mp91 = document.getElementById('measureToolPopup');
    if(_mp91 && _mp91.classList.contains('open') && _PC_MEASKEYS91[e.code]){
      var _mb91 = _mp91.querySelector('.tool-btn[data-tool="'+_PC_MEASKEYS91[e.code]+'"]');
      if(_mb91){ e.preventDefault(); _mb91.click(); var _dn91=document.getElementById('measureToolPopupDoneBtn'); if(_dn91) _dn91.click(); }
      return;
    }
    if((typeof currentFileName==='undefined' || !currentFileName) && e.code!=='KeyA' && e.code!=='KeyS' && e.code!=='KeyD') return;   // 図面(V3_97: 計算機Aは図面なしでも可)を開いていない時は何もしない
    // V3_99: 計算機が開いていてもツールのショートカットは使える(計算機の数字入力はテンキーのみ)   // V3_97: 計算機が開いている間はAで閉じられる(V3_98: S/Dも)
    if(typeof _isOpeningFileBusy!=='undefined' && _isOpeningFileBusy) return;
    var btn = (tgt.charAt(0)==='#') ? document.querySelector(tgt) : document.querySelector('.tool-btn[data-tool="'+tgt+'"]');
    if(!btn || btn.offsetParent===null) return;                             // 非表示のボタン(例:タッチ端末の画像)は無視
    // ポップアップ/ダイアログが開いている間は何もしない
    var ovs = document.querySelectorAll('.modal.open, .overlay.open, #pdfThumbOverlay, [id$="Overlay"].open');
    for(var i=0;i<ovs.length;i++){ if(ovs[i].id==='colorOverlay') continue; /* V3_77: 色/太さポップアップは、同じキーで閉じる・別キーでツール切替できるよう対象外 */ var st=getComputedStyle(ovs[i]); if(st.display!=='none' && (ovs[i].offsetParent!==null || st.position==='fixed')) return; }
    // V3_77: 既に選択中のツールのキーをもう一度押すと、ボタンの再タップと同じ動作(色/太さ等のポップアップを開く)になる
    var _already75 = (tgt.charAt(0)!=='#' && typeof currentTool!=='undefined' && currentTool===tgt);
    e.preventDefault();
    btn.click();
    if(!_already75 && tgt.charAt(0)!=='#' && typeof showGuide==='function') showGuide(_PC_LABEL75[tgt]+'に切替',700);
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
  //
  // V3_07: メイン画面(#ov)だけでなく、サブ窓(#subWinBtn)内でも中央ボタンドラッグで
  // パンできるように拡張。サブ窓は自身のtx/ty/scaleを持つため、mousedown時の
  // e.targetがどのサブ窓のcanvas(ovEl)かをwindow._swFindOwnerOfOv()で判定し、
  // 該当すればそのサブ窓自身のtx/tyを直接書き換える(index.htmlのwheelズーム対応(V3_06)
  // のようなwithCtxによるグローバル差し替えは不要。rafLoopが毎フレームサブ窓を再描画する
  // 際にsw.tx/tyを直接参照するため、これだけで正しく反映される)。
  // =========================================================
  var _pcMidPanning = false, _pcMidLastX = 0, _pcMidLastY = 0, _pcMidSubWin = null;

  document.addEventListener('mousedown', function(e){
    if(e.button !== 1) return;
    if(window.SW && window.SW.active) return; // サブ窓「新規作成」の範囲ドラッグ選択中は横取りしない
    var ov = document.getElementById('ov');
    var swOwner = (typeof window._swFindOwnerOfOv === 'function') ? window._swFindOwnerOfOv(e.target) : null;
    if(!(ov && ov.contains(e.target)) && !swOwner) return;
    e.preventDefault(); // ブラウザ既定の中央ボタン自動スクロールアイコンを抑止
    _pcMidSubWin = swOwner; // null=メイン画面、オブジェクト=対象サブ窓
    if(swOwner){
      var r = swOwner.ovEl.getBoundingClientRect();
      _pcMidLastX = e.clientX - r.left; _pcMidLastY = e.clientY - r.top;
      // V3_07: 中央ボタンでパンを開始したサブ窓を最前面に持ってくる
      // (index.html側の_swBringToFrontはcreateSubWindowのローカル関数でwindow公開
      // されていないため、簡易的にこのサブ窓のz-indexだけ引き上げる)
      if(swOwner.el) swOwner.el.style.zIndex = '5001';
    } else {
      if(typeof getPos !== 'function') return;
      var p = getPos(e);
      _pcMidLastX = p.x; _pcMidLastY = p.y;
    }
    _pcMidPanning = true;
  });

  document.addEventListener('mousemove', function(e){
    if(!_pcMidPanning) return;
    if(_pcMidSubWin){
      var sw = _pcMidSubWin;
      // サブ窓が既に閉じられていたら安全に中断する(異常系対策)
      if(typeof window._swFindOwnerOfOv !== 'function' || !window._swFindOwnerOfOv(sw.ovEl)){
        _pcMidPanning = false; _pcMidSubWin = null; return;
      }
      var r = sw.ovEl.getBoundingClientRect();
      var p = {x: e.clientX - r.left, y: e.clientY - r.top};
      // V0_79等の既存パン処理(tool.js)と同じ「移動量をそのまま加算するだけ」の式。
      // 減速・継続処理を一切行わないため、慣性は付かない
      sw.tx += p.x - _pcMidLastX;
      sw.ty += p.y - _pcMidLastY;
      sw._userNavigated = true; // V0_153.1: 手動操作済みフラグ(既存のピンチ/ホイールズーム処理と同じ扱い)
      _pcMidLastX = p.x; _pcMidLastY = p.y;
      if(typeof scheduleDraw === 'function') scheduleDraw();
    } else {
      if(typeof getPos !== 'function') return;
      var p = getPos(e);
      tx += p.x - _pcMidLastX;
      ty += p.y - _pcMidLastY;
      _pcMidLastX = p.x; _pcMidLastY = p.y;
      if(typeof scheduleDraw === 'function') scheduleDraw();
    }
  });

  document.addEventListener('mouseup', function(e){
    if(e.button === 1){ _pcMidPanning = false; _pcMidSubWin = null; }
  });
  // ウィンドウ外でボタンを離した場合や、フォーカスが外れた場合もパン状態を残さない
  window.addEventListener('blur', function(){ _pcMidPanning = false; _pcMidSubWin = null; });


  // V3_95: 検索系パネルの表示開始位置(--ovtop95)を、画面エリア(#stage)の上端に合わせる(ツールバー・ファイルタブに被らない)
  (function(){
    function upd(){ try{ var st=document.getElementById('stage'); if(st) document.documentElement.style.setProperty('--ovtop95', Math.max(0,Math.round(st.getBoundingClientRect().top))+'px'); }catch(e){} }
    upd(); window.addEventListener('resize',upd);
    ['searchOverlay','allSearchOverlay','openFileOverlay'].forEach(function(id){
      var el=document.getElementById(id); if(!el||!window.MutationObserver) return;
      new MutationObserver(upd).observe(el,{attributes:true,attributeFilter:['class']});
    });
  })();

})();
