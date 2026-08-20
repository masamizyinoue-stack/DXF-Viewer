// tool.js — ツール処理・ポインタ入力・イベントリスナー
// DXF Viewer V0_67
// 依存グローバル: ov, cv (viewer.js)
//               scale, tx, ty (viewer.js, var)
//               s2w, w2s, zoomAt, scheduleDraw, scheduleOverlay (viewer.js)
//               pdfDoc, pdfPageNum (viewer.js, var)
//               doc, hiddenLayers (viewer.js / layer.js, var)
//               currentTool, currentColor, currentLW (HTML, var)
//               strokes, dims, images, savedViews (HTML, var)
//               snapPt, currentCursorWorld, dimState, dimPendingDown (HTML, var)
//               sketching, sketchPts, eraserPos (HTML, var)
//               selectedImage, dragImageStart (HTML, var)
//               isPen, mouseDown, lastMX, lastMY, panning (HTML, var)
//               pinchDist, pinchMid (HTML, var)
//               buildDim, snapAt (measurement.js inline)
//               showGuide, hideGuide (ui.js)
//               snapshot (HTML inline — function宣言、グローバルにホイスト)
//               scheduleSave (storage.js)

// ERASER_RADIUS_PX: var宣言でグローバル公開（drawOverlayがHTMLから参照するため）
var ERASER_RADIUS_PX=20;
// V1_210: ペン等の他ツールから計測ボタンを1回押した時に、前回選んでいた計測ツールを
// 直接復元できるようにするため記憶する。var宣言でグローバル公開(index.html側の
// #measureToggleBtnクリックハンドラが参照するため)
var _lastMeasureTool=null;
// V1_46: 手書きモードで指計測時、指に隠れないようカーソルを上にずらすオフセット量(px)
var FINGER_CURSOR_OFFSET_Y=60;

// V1_47: 手書きモードでの指計測 対象判定・呼び分け（DIM=直径/半径、LP=線と点、LL=2線間、
// それ以外の水平/鉛直(dxdy)・斜め(diag)はDIM.active等の状態フラグを持たずcurrentToolで
// 判定するhandlePointerDown/Move/Up内蔵の仕組みのため、ここで一本化して呼び分ける）
function _fingerMeasureActive(){
  return (window.DIM&&window.DIM.active)||(window.LP&&window.LP.active)||(window.LL&&window.LL.active)
      ||currentTool==='dx'||currentTool==='dy'||currentTool==='dxdy'||currentTool==='diag';
}
function _fingerMeasureDown(sx,sy){
  if(window.DIM&&window.DIM.active) window.DIM.handleDown(sx,sy);
  else if(window.LP&&window.LP.active) window.LP.handleDown(sx,sy);
  else if(window.LL&&window.LL.active) window.LL.handleDown(sx,sy);
  else handlePointerDown(sx,sy,true); // dx/dy/dxdy/diag: ペン相当のダウン→ムーブ→アップで確定
}
function _fingerMeasureMove(sx,sy){
  if(window.DIM&&window.DIM.active) window.DIM.handleMove(sx,sy);
  else if(window.LP&&window.LP.active) window.LP.handleMove(sx,sy);
  else if(window.LL&&window.LL.active) window.LL.handleMove(sx,sy);
  else handlePointerMove(sx,sy,true);
}
function _fingerMeasureUp(sx,sy){
  if(window.DIM&&window.DIM.active) window.DIM.handleUp(sx,sy);
  else if(window.LP&&window.LP.active) window.LP.handleUp(sx,sy);
  else if(window.LL&&window.LL.active) window.LL.handleUp(sx,sy);
  else handlePointerUp(sx,sy,true);
}

// V1_48: 水平/鉛直・斜め(dimState方式)の点確定処理を一本化。
// handlePointerDown(指:即確定)・handlePointerUp(ペン:離して確定)の両方、および
// 「2線間の交点」ボタン(IPX)からの点供給からも共通で呼べるようにする。
// saveImmediately: 3点そろって寸法を確定した際に即時保存(doSave)するかどうか
// （従来、指操作時は呼ばれておらず、ペン操作時のみ呼ばれていた挙動をそのまま踏襲）
function _dimStateCommitPoint(pt,saveImmediately){
  dimState.pts.push(pt);
  // ガイドメッセージ更新
  if(currentTool==='dxdy'||currentTool==='diag'){
    if(dimState.pts.length===1) showGuide('2点目を選択してください');
    else if(dimState.pts.length===2) showGuide('寸法線の位置を指定してください');
  }
  const need=3; // diag も dxdy も 3ステップ（P1→P2→位置）
  if(dimState.pts.length>=need){
    const[p1,p2,p3]=dimState.pts;
    snapshot();
    let dimType=currentTool;
    if(currentTool==='dxdy'&&dimState.pts.length>=2){
      const p1_=dimState.pts[0], p2_=dimState.pts[1];
      const p3_=dimState.pts[2]||p2_;
      const midX=(p1_.x+p2_.x)/2, midY=(p1_.y+p2_.y)/2;
      const horizOfs=Math.abs(p3_.x-midX);
      const vertOfs=Math.abs(p3_.y-midY);
      dimType = vertOfs >= horizOfs ? 'dx' : 'dy';
    }
    dims.push(buildDim(p1,p2,p3||p2,dimType));
    if(typeof verify==='function')verify('寸法追加',{len:dims.length});
    dimState={pts:[]};
    if(saveImmediately) doSave(); // V0_103: 即時保存
    hideGuide();
    showGuide('寸法を追加しました ↩ で取消', 2000);
  }
  scheduleOverlay();
}

// V1_49: 手書きモードで指計測中、候補（線・円・スナップ点・交点）がまだ見つかって
// いない間、実際の指位置より少し上（V1_46のオフセット位置）に「指の形」の仮カーソルを
// 表示する。候補が見つかったら、各ツールが元々描画している専用のマーカー（スナップ
// マーカーやハイライト等）に表示を譲り、この仮カーソルは消す。
// ペン入力時はペン先そのものが正確なカーソルとして見えるため対象外（従来通り）。
function _fingerCursorInfo(){
  if(!(typeof inputMode!=='undefined'&&inputMode==='freehand'&&mouseDown&&!isPen)) return null;
  if(window.DIM&&window.DIM.active){
    var D=window.DIM;
    if(D.phase===0){
      if(!D._hoverPos) return null;
      var nearEnk=(typeof findNearestCircleEdge==='function')?findNearestCircleEdge(D._hoverPos.x,D._hoverPos.y):null;
      return nearEnk?null:{wx:D._hoverPos.x,wy:D._hoverPos.y};
    }
    if(D.phase===2){
      var c=D.cur;
      if(c&&c.type&&c.type!=='default') return null; // 何らかのスナップ済み
      var hp=D._hoverPos||c;
      return hp?{wx:hp.x,wy:hp.y}:null;
    }
    return null;
  }
  if(window.LP&&window.LP.active){
    var P=window.LP;
    if(P.phase===0) return P._hoverLine?null:(P._hoverPos?{wx:P._hoverPos.x,wy:P._hoverPos.y}:null);
    if(P.phase===1) return P.cur?null:(P._hoverPos?{wx:P._hoverPos.x,wy:P._hoverPos.y}:null);
    if(P.phase===2) return P._hoverPos?{wx:P._hoverPos.x,wy:P._hoverPos.y}:null;
    return null;
  }
  if(window.LL&&window.LL.active){
    var Q=window.LL;
    if(Q.phase===0||Q.phase===1) return Q._hoverLine?null:(Q._hoverPos?{wx:Q._hoverPos.x,wy:Q._hoverPos.y}:null);
    if(Q.phase===2) return Q._hoverPos?{wx:Q._hoverPos.x,wy:Q._hoverPos.y}:null;
    return null;
  }
  if(window.IPX&&window.IPX.active){
    var X=window.IPX;
    return X._hoverLine?null:(X._hoverPos?{wx:X._hoverPos.x,wy:X._hoverPos.y}:null);
  }
  if(currentTool==='dx'||currentTool==='dy'||currentTool==='dxdy'||currentTool==='diag'){
    if(typeof snapPt!=='undefined'&&snapPt) return null;
    if(typeof currentCursorWorld!=='undefined'&&currentCursorWorld) return {wx:currentCursorWorld.x,wy:currentCursorWorld.y};
    return null;
  }
  return null;
}

// V1_50: 見た目をシンプルな十字印に変更。白背景(bwMode)・黒背景のどちらでも
// 見えるよう、背景と反対系統の色のハロー（縁取り）を下地に描き、その上に
// 視認性の高い赤系の線を重ねる（ハロー色だけを背景で切り替える方式）
function _drawFingerCursor(){
  var info=_fingerCursorInfo();
  if(!info) return;
  var sc=w2s(info.wx,info.wy);
  var sx=sc[0],sy=sc[1];
  var dpr=window.devicePixelRatio||1;
  var r=11;
  var haloColor=(typeof bwMode!=='undefined'&&bwMode)?'rgba(255,255,255,0.95)':'rgba(0,0,0,0.6)';
  octx.save();
  octx.scale(dpr,dpr);
  octx.lineCap='round';
  // ハロー（背景色に応じた太めの縁取り）
  octx.strokeStyle=haloColor; octx.lineWidth=5;
  octx.beginPath();
  octx.moveTo(sx-r,sy); octx.lineTo(sx+r,sy);
  octx.moveTo(sx,sy-r); octx.lineTo(sx,sy+r);
  octx.stroke();
  // 十字本体
  octx.strokeStyle='#ff3b30'; octx.lineWidth=2.5;
  octx.beginPath();
  octx.moveTo(sx-r,sy); octx.lineTo(sx+r,sy);
  octx.moveTo(sx,sy-r); octx.lineTo(sx,sy+r);
  octx.stroke();
  octx.restore();
}
// V1_49: drawOverlayへの連結はindex.html側（DIM/LP/LL/IPXの後、最後尾）で行う。
// 理由: tool.jsはDIM/LP/LL/IPXより先に読み込まれるため、ここでwindow.drawOverlayを
// ラップすると各ツールの上書き(overlay)より先に描画されてしまい、指カーソルが
// 各ツールのマーカーの下に隠れてしまう。最前面に出すため一番最後に連結する。

// =========================================================
// ポインタ座標取得
// =========================================================
function getPos(e){const r=ov.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}

// =========================================================
// ポインタダウン処理
// =========================================================
function handlePointerDown(sx,sy,isPenInput){
  // V1_48: 「2線間の交点」ピック中は、通常のツール処理より優先してIPXへ渡す
  if(window.IPX&&window.IPX.active){window.IPX.handleDown(sx,sy);return;}
  // DIMシステムがアクティブな場合は DIM の pointerup ハンドラに任せる
  if(window.DIM&&window.DIM.active)return;
  if(window.LP&&window.LP.active)return;
  if(window.LL&&window.LL.active)return; // V0_153: 2線間
  if(window.SW&&window.SW.active){window.SW.handleDown(sx,sy);return;} // V0_150: サブ窓 矩形範囲選択
  const[wx,wy]=s2w(sx,sy);
  // V0_102: dim text drag (水・鉛/斜めツール)
  if((currentTool==='dxdy'||currentTool==='diag')&&typeof _dimTextHit==='function'){var _dth=_dimTextHit(sx,sy);if(_dth>=0){_dimTextDrag={idx:_dth,osx:sx,osy:sy,otx:dims[_dth].tx,oty:dims[_dth].ty,moved:false};return;}}
  // 寸法ツール: ペン入力のみ（指は touchstart でパン処理済み）
  if(currentTool==='dx'||currentTool==='dy'||currentTool==='dxdy'||currentTool==='diag'){
    if(isPenInput){
      snapPt=snapAt(wx,wy); // ペンダウン位置でスナップ初期化（touchmove不発火対策）
      dimPendingDown=true;return;
    }
    const snap=snapAt(wx,wy);const pt=snap||{x:wx,y:wy};
    _dimStateCommitPoint(pt,false);
    return;
  }
  // 消しゴム
  if(currentTool==='eraser'){
    snapshot();eraserPos={x:wx,y:wy};eraseAt(wx,wy);scheduleOverlay();return;
  }
  // スケッチ/蛍光ペン: ペンは常に描画（マウス時はsketch/hlツール時のみ）
  if(isPenInput||currentTool==='sketch'||currentTool==='hl'){
    sketchPts=[{x:wx,y:wy}];sketching=true;scheduleOverlay();return;
  }
  // 画像選択
  if(currentTool==='select'){
    selectedImage=null;
    for(const img of images){
      const[isx,isy]=w2s(img.wx,img.wy);
      if(Math.abs(sx-isx-img.ww*scale/2)<20&&Math.abs(sy-isy-img.wh*scale/2)<20){
        selectedImage=img;dragImageStart={sx,sy,iwx:img.wx,iwy:img.wy};scheduleOverlay();return;
      }
    }
  }
  // 指でパン
  if(!isPenInput){panning=true;}
}

// =========================================================
// ポインタムーブ処理
// =========================================================
function handlePointerMove(sx,sy,isPenInput){
  // V1_48: 「2線間の交点」ピック中は、通常のツール処理より優先してIPXへ渡す
  if(window.IPX&&window.IPX.active){window.IPX.handleMove(sx,sy);return;}
  if(typeof _dimTextDrag!=='undefined'&&_dimTextDrag&&typeof _dimTextDragMove==='function'&&_dimTextDragMove(sx,sy)) return; // V0_102
  // DIMシステムがアクティブな場合は DIM の pointermove ハンドラに任せる
  if(window.DIM&&window.DIM.active)return;
  if(window.LP&&window.LP.active)return;
  if(window.LL&&window.LL.active)return; // V0_153: 2線間
  if(window.SW&&window.SW.active){window.SW.handleMove(sx,sy);return;} // V0_150: サブ窓 矩形範囲選択
  const[wx,wy]=s2w(sx,sy);
  currentCursorWorld={x:wx,y:wy}; // 寸法プレビュー用カーソル世界座標を更新
  // 寸法ツール: ペン・指どちらでもスナップ更新
  if(currentTool==='dx'||currentTool==='dy'||currentTool==='dxdy'||currentTool==='diag'){
    snapPt=snapAt(wx,wy);scheduleOverlay();return;
  }
  snapPt=null;
  // 消しゴム
  if(currentTool==='eraser'){
    eraserPos={x:wx,y:wy};if(mouseDown)eraseAt(wx,wy);scheduleOverlay();return;
  }
  // スケッチ/蛍光ペン描画
  if(isPenInput||currentTool==='sketch'||currentTool==='hl'){
    if(sketching){sketchPts.push({x:wx,y:wy});scheduleOverlay();}return;
  }
  // パン
  // V1_102: このパン分岐はタッチ(iPad)側では別途直接tx/tyを操作しており経由しないため、
  // 実質的にPCのマウスドラッグ時のみを通る。大容量DXFでのPC操作時のカクつき対策として、
  // ドラッグパン中は簡略描画モード(_interacting)を有効にし、操作停止後に精密描画へ戻す
  if(panning){_beginInteraction();tx+=sx-lastMX;ty+=sy-lastMY;scheduleDraw();}
  if(selectedImage&&dragImageStart){
    const[nwx,nwy]=s2w(sx,sy);const[owx,owy]=s2w(dragImageStart.sx,dragImageStart.sy);
    selectedImage.wx=dragImageStart.iwx+(nwx-owx);selectedImage.wy=dragImageStart.iwy+(nwy-owy);
    scheduleOverlay();
  }
}

// =========================================================
// ポインタアップ処理
// =========================================================
function handlePointerUp(sx,sy,isPenInput){
  // V1_48: 「2線間の交点」ピック中は、通常のツール処理より優先してIPXへ渡す
  if(window.IPX&&window.IPX.active){window.IPX.handleUp(sx,sy);return;}
  if(typeof _dimTextDragUp==='function'&&_dimTextDragUp()) return; // V0_102
  // DIMシステムがアクティブな場合は DIM の pointerup ハンドラに任せる
  if(window.DIM&&window.DIM.active)return;
  if(window.LP&&window.LP.active)return;
  if(window.LL&&window.LL.active)return; // V0_153: 2線間
  if(window.SW&&window.SW.active){window.SW.handleUp(sx,sy);return;} // V0_150: サブ窓 矩形範囲選択
  if(dimPendingDown&&isPenInput){
    dimPendingDown=false;
    if(currentTool==='dx'||currentTool==='dy'||currentTool==='dxdy'||currentTool==='diag'){
      const[wx2,wy2]=s2w(sx,sy);
      const pt=snapPt||{x:wx2,y:wy2};
      _dimStateCommitPoint(pt,true);
      return;
    }
  }
  if(currentTool==='eraser'){eraserPos=null;scheduleOverlay();scheduleSave();return;}
  if(isPenInput||currentTool==='sketch'||currentTool==='hl'){
    if(sketching&&sketchPts.length>1){
      snapshot();
      if(currentTool==='hl'){
        // 蛍光ペン: hl:true フラグ付きで保存（V0_70）
        // V1_65: PDFの場合、現在ページ番号をpageとして付与（ページごとに書き込みを分離するため）
        strokes.push({pts:[...sketchPts],color:{...currentHL_Color},lw:currentHL_LW,hl:true,page:_curPage()});
        if(typeof verify==='function')verify('蛍光追加',{len:strokes.length});
      } else {
        strokes.push({pts:[...sketchPts],color:{...currentColor},lw:currentLW,page:_curPage()}); // ③ 絶対px値で保存
        if(typeof verify==='function')verify('ペン追加',{len:strokes.length});
      }
      sketching=false;sketchPts=[];scheduleOverlay();doSave(); // V0_103: 即時保存
    }return;
  }
  panning=false;dragImageStart=null;selectedImage=null;
}

// =========================================================
// 消しゴム処理
// =========================================================
function eraseAt(wx,wy){
  const r=ERASER_RADIUS_PX/scale;
  // V1_65: 現在表示中のページ(_curPage())のstrokes/dimsのみを消しゴム対象にする。
  // 他ページの要素は(s.page||1)!==curの条件で常にtrue（=残す）扱いになるため触れない
  var cur=_curPage();
  strokes=strokes.filter(s=>(s.page||1)!==cur||!s.pts.some(p=>Math.hypot(p.x-wx,p.y-wy)<r));
  dims=dims.filter(d=>(d.page||1)!==cur||Math.hypot(d.tx-wx,d.ty-wy)>=r);
  // V0_140: filter後は新配列になるためopenFiles[]に明示同期
  if(typeof openFiles!=='undefined'&&currentFileIdx>=0&&openFiles[currentFileIdx]){
    openFiles[currentFileIdx].strokes=strokes;
    openFiles[currentFileIdx].dims=dims;
  }
  if(typeof verify==='function')verify('ペン削除',{strokes:strokes.length,dims:dims.length});
}

// =========================================================
// マウスイベントリスナー
// =========================================================
var _mouseTextPickPending=false,_mouseTapStartTime=0,_mouseTapStartX=0,_mouseTapStartY=0; // V1_86
ov.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  // V1_86: 画面検索/検索して開くパネルが開いている間(_textPickTarget有効時)は、
  // マウスクリックでの書込み・消しゴム・計測操作を行わず、図面上の文字クリックでの
  // テキスト読込を最優先する（V1_83のタッチ操作(_textPickTarget)と同じ考え方をマウスにも適用）。
  // DIM/LP/LL.handleDown・handlePointerDownを一切呼ばないため、ドラッグ中もそれらの
  // hoverプレビュー更新以外の実際のデータ変更(点確定・描画・消しゴム)は発生しない
  if(typeof _textPickTarget!=='undefined'&&_textPickTarget){
    mouseDown=true;const p=getPos(e);lastMX=p.x;lastMY=p.y;
    _mouseTextPickPending=true;
    _mouseTapStartTime=Date.now();_mouseTapStartX=p.x;_mouseTapStartY=p.y;
    return;
  }
  mouseDown=true;const p=getPos(e);lastMX=p.x;lastMY=p.y;
  if(window.DIM&&window.DIM.active){
    window.DIM.handleDown(p.x,p.y);
  } else if(window.LP&&window.LP.active){
    window.LP.handleDown(p.x,p.y);
  } else if(window.LL&&window.LL.active){ // V0_153: 2線間
    window.LL.handleDown(p.x,p.y);
  } else { handlePointerDown(p.x,p.y,false); }
});
window.addEventListener('mousemove',e=>{
  const p=getPos(e);
  // V1_95: テキスト読込ピックモード中(_textPickTarget有効時)は、mousedown/mouseup
  // 側と同様にDIM/LP/LLのホバープレビュー更新・ペン/消しゴムのポインタ処理も
  // 一切行わない。従来はmousemoveだけこのチェックが漏れており、検索して開く等を
  // 開いた後も計測ツールのホバー候補が更新され続け、「操作がキャンセルされて
  // いない」ように見える一因になっていた
  if(typeof _textPickTarget!=='undefined'&&_textPickTarget){ lastMX=p.x;lastMY=p.y; return; }
  if(window.DIM&&window.DIM.active){
    window.DIM.handleMove(p.x,p.y); // mouseDown不要: ホバー中も_hoverPos更新
  } else if(window.LP&&window.LP.active){
    window.LP.handleMove(p.x,p.y);
  } else if(window.LL&&window.LL.active){ // V0_153: 2線間
    window.LL.handleMove(p.x,p.y);
  } else { handlePointerMove(p.x,p.y,false); }
  lastMX=p.x;lastMY=p.y;
});
window.addEventListener('mouseup',e=>{
  if(!mouseDown)return;mouseDown=false;
  const p=getPos(e);
  // V1_86: mousedown時にテキスト読込ピック待機中だった場合は、DIM/LP/LL/handlePointerUpを
  // 呼ばず、クリック相当(短時間・小移動)なら文字読込を試みる。ドラッグ的な動きだった場合や
  // 待機中に_textPickTargetが解除された場合は何もしない（元々handleDownを呼んでいないため
  // 安全に無視できる）
  if(_mouseTextPickPending){
    _mouseTextPickPending=false;
    if(typeof _textPickTarget!=='undefined'&&_textPickTarget&&_mouseTapStartTime){
      var _mDt=Date.now()-_mouseTapStartTime;
      var _mDd=Math.hypot(p.x-_mouseTapStartX,p.y-_mouseTapStartY);
      if(_mDt<600&&_mDd<6){ // マウスは指ほど誤差が無いため許容範囲は小さめ
        if(typeof _tapPickText==='function') _tapPickText(p.x,p.y);
      }
    }
    _mouseTapStartTime=0;
    return;
  }
  if(window.DIM&&window.DIM.active){
    window.DIM.handleUp(p.x,p.y);
  } else if(window.LP&&window.LP.active){
    window.LP.handleUp(p.x,p.y);
  } else if(window.LL&&window.LL.active){ // V0_153: 2線間
    window.LL.handleUp(p.x,p.y);
  } else { handlePointerUp(p.x,p.y,false); }
});
ov.addEventListener('wheel',e=>{
  e.preventDefault();
  const p=getPos(e);
  // V1_86: ホイール/トラックパッドを回す・動かす勢い(deltaYの大きさ)に応じて滑らかに
  // 拡大縮小の変化量を変える。従来は符号のみを見て常に固定倍率(15%)だったため、座標の
  // 大きい図面(建物全体等)では全体表示から詳細表示まで辿り着くのに必要なホイール回数が
  // 多く感じられていた（データの絶対座標によって倍率自体が変わっていたわけではない）。
  // deltaModeの違い(line/page単位)をpixel相当に正規化した上で、一般的なマウスホイール
  // 1ノッチ(deltaY=100前後)では従来と同じ約15%になるよう係数を合わせつつ、
  // 強く/速く回すほど大きく、そっと回すほど小さく変化するようにする
  var _wd=e.deltaY;
  if(e.deltaMode===1) _wd*=16; // DOM_DELTA_LINE→pixel相当
  else if(e.deltaMode===2) _wd*=800; // DOM_DELTA_PAGE→pixel相当(概算)
  _wd=Math.max(-800,Math.min(800,_wd)); // 極端な単発ジャンプの安全策
  const _wf=Math.pow(1.15,-_wd/100);
  // V1_102: 大容量DXFでのPC操作時のカクつき対策。ホイールズーム中は簡略描画モード
  // (_interacting)を有効にし、操作停止後に精密描画へ戻す
  _beginInteraction();
  zoomAt(p.x,p.y,_wf);scheduleDraw();
},{passive:false});

// =========================================================
// タッチイベントリスナー (ペン/指 完全分離設計)
// =========================================================
ov.addEventListener('touchstart',e=>{
  e.preventDefault();
  const r=ov.getBoundingClientRect();
  const all=Array.from(e.touches);
  const styli=all.filter(t=>t.touchType==='stylus');
  const fingers=all.filter(t=>t.touchType!=='stylus');
  if(styli.length>0){
    // Apple Pencil: ペン入力を優先、指は無視（パームリジェクション）
    if(!isPen||!mouseDown){
      const t=styli[0];
      const sx=t.clientX-r.left,sy=t.clientY-r.top;
      isPen=true;mouseDown=true;lastMX=sx;lastMY=sy;
      panning=false;
      if(window.DIM&&window.DIM.active){
        window.DIM.handleDown(sx,sy);

      } else if(window.LP&&window.LP.active){
        window.LP.handleDown(sx,sy);
      } else if(window.LL&&window.LL.active){ // V0_153: 2線間
        window.LL.handleDown(sx,sy);
      } else { handlePointerDown(sx,sy,true); }
    }
  } else if(fingers.length>=2){
    // 2本指: ピンチズーム+パン
    if(sketching){sketching=false;sketchPts=[];}
    // V1_97: 2本指ピンチは、指Aが単独で触れた直後(fingers.length===1の
    // touchstartが1回発火した後)に指Bが加わって初めて成立することが多い。
    // このわずかな間に、手書きモード+計測ツール(DIM/LP/LL)選択中だと
    // 指Aの単独touchstartだけで既にhandleDown()が呼ばれ、penDown=trueの
    // まま「候補位置(cur/_hoverLine)が確定待ち」の状態になっていた。
    // ピンチ中は_fingerMeasureMove()が一切呼ばれないためこの候補位置は
    // 更新されずピンチ開始前の古い位置のまま残り、ピンチ終了後に指を
    // 離すと(penDownがtrueのままのため)その古い候補位置で計測点が
    // 確定してしまう不具合があった（「離れた2点を測定する場合、2点目を
    // 選ぶ前に手でズームすると点が打たれてしまう」）。sketchingと同様に、
    // 2本指が揃った時点でDIM/LP/LLのpenDownを強制的に解除し、指Aの
    // 単独touchstartが与えた影響を無効化する（各ツールのhandleUpは
    // penDown===falseなら何もしないため、これだけで安全にキャンセルできる）
    if(window.DIM) window.DIM.penDown=false;
    if(window.LP) window.LP.penDown=false;
    if(window.LL) window.LL.penDown=false;
    mouseDown=false;panning=false;
    // V1_101: 2本指が揃った時点で「このタッチセッションはジェスチャー(ピンチ/パン)
    // である」ことを示すセッション全体フラグを立てる。従来(V1_99/V1_100)の
    // 時間ベースの猶予(0.3秒→0.8秒)と異なり時間で自動解除されないため、
    // 全指が完全に離れて新しいタッチセッションが始まるまで、書き込み・計測の
    // 確定が一切行われなくなる（詳細はtouchendのremaining.length===0側を参照）
    _gestureSessionActive=true;
    const t0=fingers[0],t1=fingers[1];
    const x0=t0.clientX-r.left,y0=t0.clientY-r.top;
    const x1=t1.clientX-r.left,y1=t1.clientY-r.top;
    pinchDist=Math.hypot(x1-x0,y1-y0);
    pinchMid={x:(x0+x1)/2,y:(y0+y1)/2};
  } else if(fingers.length===1){
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    isPen=false;mouseDown=true;lastMX=sx;lastMY=sy;
    // V1_83: 画面検索/検索して開くパネルが開いている間(_textPickTarget有効時)は、
    // 手書きモードでの描画・消しゴム・指計測より、文字タップでのテキスト読込ピックを
    // 優先する。パン扱いにしてtouchend側の既存のテキスト読込ピック判定(_textPickTarget)
    // に委ねる。サブ窓作成のドラッグ操作(SW.active)は対象外とし従来通り動作する
    if(typeof _textPickTarget!=='undefined'&&_textPickTarget
        &&inputMode==='freehand'&&!(window.SW&&window.SW.active)
        &&(_fingerMeasureActive()||currentTool==='sketch'||currentTool==='hl'||currentTool==='eraser')){
      if(sketching){sketching=false;sketchPts=[];}
      panning=true;
      _panAnchorX=null;_panAnchorY=null; // V1_101: 移動距離判定の起点をパン開始のたびにリセット
      _tapStartTime=Date.now();_tapStartX=sx;_tapStartY=sy;
    } else if(inputMode==='freehand'&&_fingerMeasureActive()){
      panning=false;
      const fy=sy-FINGER_CURSOR_OFFSET_Y;
      _fingerMeasureDown(sx,fy);
      lastMX=sx;lastMY=fy;
    } else if(inputMode==='freehand'
        &&(currentTool==='sketch'||currentTool==='hl'||currentTool==='eraser'||(window.SW&&window.SW.active))){
      // V0_79: 手書きモード + スケッチ/蛍光ペン → 指で描画
      // V0_152.2: 手書きモード + サブ窓作成中(SW.active) → 指1本で対角ドラッグできるように追加
      panning=false;
      handlePointerDown(sx,sy,false); // currentTool===sketch/hl/サブ窓作成中 なので描画(操作)開始
    } else {
      // ペンモード or 手書きモード+非描画ツール: パンのみ（既存動作）
      if(sketching){sketching=false;sketchPts=[];}
      panning=true;
      _panAnchorX=null;_panAnchorY=null; // V1_101: 移動距離判定の起点をパン開始のたびにリセット
      _tapStartTime=Date.now();_tapStartX=sx;_tapStartY=sy; // V1_18: ダブルタップ全体表示の起点記録
    }
  }
},{passive:false});

ov.addEventListener('touchmove',e=>{
  e.preventDefault();
  const r=ov.getBoundingClientRect();
  const all=Array.from(e.touches);
  const styli=all.filter(t=>t.touchType==='stylus');
  const fingers=all.filter(t=>t.touchType!=='stylus');
  if(styli.length>0&&mouseDown&&isPen){
    // Apple Pencil移動: ツール操作
    const t=styli[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    if(window.DIM&&window.DIM.active){
      window.DIM.handleMove(sx,sy);
    } else if(window.LP&&window.LP.active){
      window.LP.handleMove(sx,sy);
    } else if(window.LL&&window.LL.active){ // V0_153: 2線間
      window.LL.handleMove(sx,sy);
    } else { handlePointerMove(sx,sy,true); }
    lastMX=sx;lastMY=sy;
  } else if(fingers.length>=2&&pinchDist!==null){
    // 2本指: 正確なパン+ピンチ（世界座標ピボット）
    const t0=fingers[0],t1=fingers[1];
    const x0=t0.clientX-r.left,y0=t0.clientY-r.top;
    const x1=t1.clientX-r.left,y1=t1.clientY-r.top;
    const dist=Math.hypot(x1-x0,y1-y0);
    const mid={x:(x0+x1)/2,y:(y0+y1)/2};
    // 旧中点の世界座標を新しい中点スクリーン位置に移動（パン+ズーム統合）
    const[wx,wy]=s2w(pinchMid.x,pinchMid.y);
    if(pinchDist>5){
      const f=dist/pinchDist;
      if(f>0.5&&f<2.0) scale*=f;
    }
    tx=mid.x-wx*scale;ty=mid.y+wy*scale;
    pinchDist=dist;pinchMid=mid;scheduleDraw();
  } else if(fingers.length===1&&mouseDown&&!panning&&inputMode==='freehand'&&_fingerMeasureActive()){
    // V1_46/V1_47: 手書きモード 指1本での計測継続（DIM/LP/LL・水平鉛直・斜め）。
    // 指位置より少し上をカーソルとして扱う
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top-FINGER_CURSOR_OFFSET_Y;
    _fingerMeasureMove(sx,sy);
    lastMX=sx;lastMY=sy;
  } else if(fingers.length===1&&mouseDown&&!panning&&(sketching||(inputMode==='freehand'&&currentTool==='eraser')||(window.SW&&window.SW.active))){
    // V0_79: 手書きモード 指1本描画中 / V0_152.2: サブ窓作成の対角ドラッグ中も含む
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    if(window.DIM&&window.DIM.active){
      window.DIM.handleMove(sx,sy);
    } else if(window.LP&&window.LP.active){
      window.LP.handleMove(sx,sy);
    } else { handlePointerMove(sx,sy,false); }
    lastMX=sx;lastMY=sy;
  } else if(fingers.length===1&&mouseDown&&panning){
    // 1本指パン（既存動作）
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    tx+=sx-lastMX;ty+=sy-lastMY;scheduleDraw();
    // V1_101: 移動距離判定。パン中の指がパン開始位置から一定距離
    // (GESTURE_MOVE_THRESHOLD_PX)以上動いたら、2本指ジェスチャーの本数変化
    // イベントだけでは検知できなかった場合の保険として_gestureSessionActiveを
    // 立てる（本数ベースの判定(touchstartのfingers>=2分岐)と組み合わせることで、
    // どちらか一方でも「ジェスチャー中」と判定されれば書き込み・計測を確定しない）
    if(_panAnchorX===null){_panAnchorX=sx;_panAnchorY=sy;}
    else if(Math.hypot(sx-_panAnchorX,sy-_panAnchorY)>GESTURE_MOVE_THRESHOLD_PX){
      _gestureSessionActive=true;
    }
    lastMX=sx;lastMY=sy;
  }
},{passive:false});

ov.addEventListener('touchend',e=>{
  e.preventDefault();
  const r=ov.getBoundingClientRect();
  const remaining=Array.from(e.touches);
  const changed=Array.from(e.changedTouches);
  const remFing=remaining.filter(t=>t.touchType!=='stylus');
  const liftedStylus=changed.filter(t=>t.touchType==='stylus');
  // Apple Pencilが離れた
  if(liftedStylus.length>0&&isPen&&mouseDown){
    if(window.DIM&&window.DIM.active){
      window.DIM.handleUp(lastMX,lastMY);

    } else if(window.LP&&window.LP.active){
      window.LP.handleUp(lastMX,lastMY);
    } else if(window.LL&&window.LL.active){ // V0_153: 2線間
      window.LL.handleUp(lastMX,lastMY);
    } else { handlePointerUp(lastMX,lastMY,true); }
    mouseDown=false;isPen=false;
    if(remFing.length>=2){
      const t0=remFing[0],t1=remFing[1];
      const x0=t0.clientX-r.left,y0=t0.clientY-r.top;
      const x1=t1.clientX-r.left,y1=t1.clientY-r.top;
      pinchDist=Math.hypot(x1-x0,y1-y0);
      pinchMid={x:(x0+x1)/2,y:(y0+y1)/2};
    } else if(remFing.length===1){
      const t=remFing[0];
      const sx=t.clientX-r.left,sy=t.clientY-r.top;
      mouseDown=true;lastMX=sx;lastMY=sy;panning=true;
    }
    return;
  }
  // 全タッチ終了
  if(remaining.length===0){
    // V1_101: V1_99/V1_100の時間ベースの猶予(0.3秒→0.8秒)でも実機で誤操作が
    // 続いたため、時間で区切る方式をやめ、_gestureSessionActive(このタッチ
    // セッション中に一度でも2本指以上・または一定距離以上のパン移動があったか)
    // の一点で判定するようにした。時間切れによる取りこぼしがなくなる
    // （詳細はグローバル変数宣言部・touchstartのfingers>=2分岐・
    // touchmoveの1本指パン分岐を参照）
    // V1_46/V1_47: 手書きモードで指計測中（DIM/LP/LL・水平鉛直・斜め）だった場合は
    // 指を離した位置で確定
    if(!_gestureSessionActive&&!isPen&&inputMode==='freehand'&&_fingerMeasureActive()){
      _fingerMeasureUp(lastMX,lastMY);
    }
    // V0_79: 手書きモードで指描画中だった場合はストロークを確定
    // V0_152.2: サブ窓作成の対角ドラッグ中(指を離して矩形確定)も含む
    if(!_gestureSessionActive&&!isPen&&(sketching||(inputMode==='freehand'&&currentTool==='eraser')||(window.SW&&window.SW.active))){
      handlePointerUp(lastMX,lastMY,false);
    }
    // V1_18: ダブルタップ全体表示（V0_80で誤操作防止のため一旦廃止したが再要望により復活）。
    // パン中(panning===true)の単純タップに限定して判定することで、描画・計測ツール
    // 操作中（DIM/LP/LL/sketch/SW等）の誤爆は起きない設計にしている
    // V1_34: DIM/LP/LLはツールボタンを選ぶと即座にactive=trueになる仕様のため、
    // 「ツールを選んだだけでまだ何も点を拾っていない(phase===0)」段階まで一律で
    // ダブルタップ全体表示を禁止すると、例えば「2線間」を選んだだけの状態でも
    // 全体表示できなくなってしまっていた。実際に誤操作防止が必要なのは「計測が
    // 進行中（1本目の線や1点目を選択済み＝phase>0）」の場合のみのため、
    // phase>0の時だけダブルタップ全体表示を禁止するよう条件を絞り込んだ
    // V1_93: 「テキスト読込」ピックモード中(_textPickTarget有効時)にDIM/LP/LLが
    // 計測途中(phase>0)だと、このif自体がまるごと成立せず_tapPickText呼び出しにすら
    // 到達できず、手書きモード+検索して開く/画面検索でテキスト読込が反応しない不具合が
    // あった。V1_27のコメント通り本来テキスト読込はダブルタップ全体表示より優先される
    // 設計のため、phase>0ガードはダブルタップ全体表示の判定にのみ適用し、テキスト読込
    // 側は独立してphase>0でも実行されるよう分離した
    if(!isPen&&panning&&!sketching&&!(window.SW&&window.SW.active)&&_tapStartTime){
      var _tapDt=Date.now()-_tapStartTime;
      var _tapDd=Math.hypot(lastMX-_tapStartX,lastMY-_tapStartY);
      if(_tapDt<300&&_tapDd<12){ // 短時間・小移動＝ドラッグではなくタップ
        // V1_27: 「テキスト読込」ピックモード中は、ダブルタップ全体表示より優先して
        // タップ位置の文字要素を拾い、画面検索/全図面検索の入力欄へ自動入力する
        if(typeof _textPickTarget!=='undefined'&&_textPickTarget){
          if(typeof _tapPickText==='function') _tapPickText(lastMX,lastMY);
          _lastTapTime=0;
        } else if(!(window.DIM&&window.DIM.active&&window.DIM.phase>0)
            &&!(window.LP&&window.LP.active&&window.LP.phase>0)
            &&!(window.LL&&window.LL.active&&window.LL.phase>0)){
          var _tapNow=Date.now();
          if(_tapNow-_lastTapTime<400&&Math.hypot(lastMX-_lastTapX,lastMY-_lastTapY)<40){
            fit();scheduleDraw();scheduleSave(); // V0_74のfitBtnと同じ処理
            _lastTapTime=0; // 3連続タップ等での誤爆防止
          } else {
            _lastTapTime=_tapNow;_lastTapX=lastMX;_lastTapY=lastMY;
          }
        }
      }
    }
    _tapStartTime=0;
    _gestureSessionActive=false; // V1_101: このタッチセッションの判定はここで使い切り、次回に持ち越さない
    _panAnchorX=null;_panAnchorY=null;
    if(!isPen){panning=false;mouseDown=false;}
    pinchDist=null;pinchMid=null;return;
  }
  // 2本指→1本指への移行
  if(remFing.length===1&&pinchDist!==null&&!isPen){
    pinchDist=null;pinchMid=null;
    const t=remFing[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    mouseDown=true;lastMX=sx;lastMY=sy;
    // V1_96: ピンチズーム終了時、2本の指がぴったり同時に離れることは少なく、
    // 片方がわずかに早く離れて一瞬「2本指→1本指」の状態を経由することがよくある。
    // 従来はこの瞬間を「指を持ち替えて手書き描画・計測を続けたい」意図とみなし、
    // 残った指の位置でスケッチ再開(V0_79)・計測ツールの指計測再開(V1_46/V1_47)を
    // 自動的に行っていた。しかし実際には「ズームイン・ズームアウトすると誤操作で
    // ペンの線が残る」「離れた2点を測る際、2点目を選ぶ前にズームすると意図しない
    // 位置に点が打たれる」不具合の原因になっていたため、この自動再開を廃止し、
    // ピンチ終了直後は常にパン継続として扱うよう変更した。描画・計測を続けたい
    // 場合は、指を完全に離してから改めてタップ/ドラッグする（通常のtouchstartの
    // 1本指分岐を経由するため、意図した位置で正しく再開できる）
    panning=true;
    // V1_99/V1_100: この時点から一定時間(0.3秒→0.8秒)以内に全指が離れた場合は
    // 確定しない、という時間ベースの猶予を設けていたが、実機で誤操作が続いた。
    // V1_101: 2本指を経由した時点で既にtouchstart側の_gestureSessionActive=trueが
    // 立っているため、時間経過に関わらず全タッチ終了まで確定は抑止される。ここでは
    // 移動距離判定(GESTURE_MOVE_THRESHOLD_PX)の起点をリセットするのみでよい
    _panAnchorX=null;_panAnchorY=null;
  }
},{passive:false});

// ポインタ予測イベント: V0_13で廃止（描画品質改善のため）
// getPredictedEventsはスケッチ追従を悪化させるため削除。将来の参照用としてコメントで残す。
// ov.addEventListener('pointermove',e=>{ ... getPredictedEvents ... });

// =========================================================
// ツール切替ボタン
// =========================================================
// V1_45: 色丸ボタン廃止に伴い、「選択中のツールアイコンをもう一度押すと
// 色・太さの選択ポップアップが開く」という操作に統合した。対象はペン・蛍光・
// 寸法系ツール（色/太さ設定を持つもの）のみで、それ以外（消しゴム等）は
// 従来通り再選択の動作のみとなる。
// V1_207: 消しゴム(eraser)を追加し、ペン・蛍光ペンと同じ「選択中のアイコンを再タップ
// すると範囲選択ポップアップが開く」動作にした。計測系6ツール(dxdy等)は従来通り'dim'を
// 維持する(下のクリックハンドラでこの値を見て「状態リセットをしない」保護を掛けている
// ため)が、色選択が#measureToolPopupに常時表示されるようになったので、再タップ時に
// 別ポップアップを開く処理自体は行わない(下のif(_mode==='dim')分岐を参照)
const _TOOL_COLOR_MODE={sketch:'sketch',hl:'hl',eraser:'eraser',dxdy:'dim',diag:'dim',ll:'dim',lp:'dim',circDim:'dim',radDim:'dim'};
// V1_205: 計測ツール選択ポップアップ(#measureToolPopup、index.html)用。6つの計測ツールの
// うちどれかが新たに選択された時、ヘッダーの計測ボタン(#measureCurrentLabel、3段表示の
// 3段目)に選択中のツール名を表示し、ポップアップを閉じる。すでに選択中のツールの
// アイコンを再タップした場合(下のstopImmediatePropagation分岐)はこの処理には来ない
// (色/太さポップアップが開くだけで、選択自体は変わらないため表示更新も不要)
const _MEASURE_TOOL_LABELS={dxdy:'水・鉛',diag:'斜め',ll:'2線間',lp:'線と点',circDim:'直径',radDim:'半径'};
// V1_219: 「計測ボタンのアイコンを、選択中の計測ツールのアイコンにしてほしい」との
// 依頼への対応。ヘッダーの計測ボタン(#measureToolIcon)は従来ずっと定規アイコン固定
// だったが、計測ツールが選択されている間はそのツール専用のアイコン(下記、
// #measureToolPopup内の各.dimToolIconと全く同じ形状)に差し替え、未選択(ペン等の
// 他ツール選択中)の時は定規アイコンに戻す。style.color(選択中の計測線色)は
// svg要素自身に付くため、innerHTML(子要素)だけを差し替えるこの方式なら
// updateToolColorDots()側の色反映処理には一切影響しない。
// var(constではない)で宣言し、index.html/storage.jsの別スクリプトタグからも
// 直接参照できるようにする(_MEASURE_TOOL_LABELS等のconstは別タグから参照できず
// 過去にハードコード重複が必要だった前例があるため、今回は最初からvarにした)
var _MEASURE_RULER_ICON_INNER='<rect x="2" y="9" width="20" height="6" rx="1"/><line x1="6" y1="9" x2="6" y2="12"/><line x1="10" y1="9" x2="10" y2="12"/><line x1="14" y1="9" x2="14" y2="12"/><line x1="18" y1="9" x2="18" y2="12"/>';
var _MEASURE_TOOL_ICON_INNER={
  dxdy:'<line x1="3" y1="9" x2="15" y2="9"/><line x1="3" y1="6" x2="3" y2="12"/><line x1="15" y1="6" x2="15" y2="12"/><line x1="18" y1="9" x2="18" y2="21"/><line x1="15" y1="9" x2="21" y2="9"/><line x1="15" y1="21" x2="21" y2="21"/>',
  diag:'<line x1="5" y1="19" x2="19" y2="5"/><polyline points="5 13 5 19 11 19"/><polyline points="13 5 19 5 19 11"/>',
  ll:'<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="12" y1="7" x2="12" y2="17"/><polyline points="9 10 12 7 15 10"/><polyline points="9 14 12 17 15 14"/>',
  lp:'<line x1="3" y1="21" x2="21" y2="3"/><circle cx="17" cy="17" r="3"/><line x1="17" y1="14" x2="12" y2="9" stroke-dasharray="2,2"/>',
  circDim:'<circle cx="12" cy="12" r="8"/><line x1="4" y1="12" x2="20" y2="12"/>',
  radDim:'<circle cx="12" cy="12" r="8"/><line x1="12" y1="12" x2="20" y2="12"/><text x="14" y="11" font-size="5" fill="currentColor" stroke="none">R</text>'
};
// V1_227: 「計測ボタンの3段目ラベル(#measureCurrentLabel)は、ペン等へ切り替えた後も
// 前回選んでいた計測ツール名(例:水・鉛)が表示されたままなのに、アイコンだけ定規に
// 戻ってしまい、ラベルとアイコンの表示が食い違う」との指摘への対応。ラベルは
// 新たに計測ツールが選ばれた時にしか更新されず、ペン等へ切り替えても文言はそのまま
// 残る仕様(_lastMeasureTool、V1_210)になっているため、アイコン側もcurrentToolが
// 計測ツールでない場合はラベルと同じ基準(_lastMeasureTool)を参照するようにし、
// 一度も計測ツールを使っていない場合にのみ定規アイコンへフォールバックする
// V1_236: 「アプリ再起動時に計測ボタンが『未選択』のままなのに、アイコンは水・鉛など
// 選択中ツールの形になっていて文字とアイコンが食い違う」との指摘への対応。原因は
// storage.jsの復元処理(2箇所)がcurrentTool/_lastMeasureToolを復元した後、この関数を
// 呼んでアイコンだけは同期していたが、#measureCurrentLabelのテキストは上のtool-btn
// クリックハンドラ内(currentTool新規選択時のみ)でしか更新されず、復元時には一切
// 呼ばれていなかったため、ラベルがHTML初期値の「未選択」のまま残っていた。
// アイコンとラベルを同じ関数・同じ判定基準(currentTool→_lastMeasureToolの順で
// フォールバック)でまとめて更新することで、以後どちらか一方だけが更新されて
// 食い違う事態が起きないようにした
function _syncMeasureToggleBtnIcon(){
  var el=document.getElementById('measureToolIcon');
  if(el) el.innerHTML=_MEASURE_TOOL_ICON_INNER[currentTool]||_MEASURE_TOOL_ICON_INNER[_lastMeasureTool]||_MEASURE_RULER_ICON_INNER;
  var _mtLabel236=document.getElementById('measureCurrentLabel');
  if(_mtLabel236) _mtLabel236.textContent=_MEASURE_TOOL_LABELS[currentTool]||_MEASURE_TOOL_LABELS[_lastMeasureTool]||'未選択';
}
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click',(e)=>{
    const _mode=_TOOL_COLOR_MODE[btn.dataset.tool];
    if(btn.classList.contains('active')&&_mode){
      // 既に選択中のアイコンの再タップ：ツールの再選択・状態リセットは行わず、
      // 色・太さの選択ポップアップだけを開く。DIM/LP/LL等、同じボタンに登録された
      // 他のフックリスナー（計測状態のリセットを行う）が発火して計測途中の状態を
      // 壊してしまわないよう、stopImmediatePropagation()で止める
      if(e&&e.stopImmediatePropagation)e.stopImmediatePropagation();
      // V1_207: 計測系ツール('dim')は色選択が#measureToolPopupに常時表示されている
      // ため、再タップで別ポップアップを開く必要がない。ここでは「状態リセットを
      // しない」保護だけを効かせ、それ以外は何もしない(何も起きないのが正しい)
      if(_mode==='dim') return;
      if(typeof openContextPopup==='function')openContextPopup(_mode,btn);
      return;
    }
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');currentTool=btn.dataset.tool;
    // V1_205: 計測ツールが新たに選択されたら、計測ボタンの3段目ラベルを更新し、
    // 計測ツール選択ポップアップ(#measureToolPopup)を閉じる
    if(_MEASURE_TOOL_LABELS[currentTool]){
      var _mtLabel205=document.getElementById('measureCurrentLabel');
      if(_mtLabel205) _mtLabel205.textContent=_MEASURE_TOOL_LABELS[currentTool];
      if(typeof _closeMeasureToolPopup==='function') _closeMeasureToolPopup();
      // V1_210: 次に他ツールから計測ボタンを押した時にこのツールを直接復元できるよう記憶
      // (この下のscheduleSave()で一緒に保存される)
      _lastMeasureTool=currentTool;
    }
    // V1_207: 計測ボタン(#measureToggleBtn)の枠は、計測系ツールがcurrentToolの時だけ
    // 色付きにする(常時色付きだと選択中かどうか分かりにくいとの指摘のため)。
    // どのツールが選ばれてもここを通るので、計測系以外に切り替えた時は正しく外れる
    var _measureBtn207=document.getElementById('measureToggleBtn');
    if(_measureBtn207) _measureBtn207.classList.toggle('tool-active',!!_MEASURE_TOOL_LABELS[currentTool]);
    _syncMeasureToggleBtnIcon(); // V1_219: 計測ボタンのアイコンを選択中ツールの形状に同期
    if(window.IPX&&window.IPX.active&&typeof ipxCancel==='function')ipxCancel(); // V1_48: ツール切替時は交点ピックを中止
    dimState={pts:[]};dimPendingDown=false;sketching=false;sketchPts=[];snapPt=null;scheduleOverlay();
    if(typeof updateToolColorDots==='function')updateToolColorDots();

    // ガイドメッセージ
    const guideMap={
      'sketch':'Apple Pencilまたはマウスでスケッチ',
      'hl':'蛍光ペン：Apple Pencilまたはマウスでハイライト',
      'eraser':'消去したい線をなぞってください',
      'dxdy':'1点目を選択してください',
      'diag':'1点目を選択してください',
      'circDim':'円の円周にペンを近づける→離して確定→位置を指定',
      'radDim':'円または円弧を選択→離して確定→半径線の位置を指定'
    };
    if(currentTool==='sketch'||currentTool==='hl'||currentTool==='eraser'){
      showGuide(guideMap[currentTool]||'', 2000);
    } else if(guideMap[currentTool]){
      showGuide(guideMap[currentTool]);
    } else {
      hideGuide();
    }
    scheduleSave(); // V0_135: ツール切替を保存
  });
});

// =========================================================
// カラー選択ボタン
// =========================================================
document.querySelectorAll('.color-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.color-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const[r,g,b]=btn.dataset.color.split(',').map(Number);currentColor={r,g,b};document.getElementById('colorOverlay').classList.remove('open');if(typeof updateToolColorDots==='function')updateToolColorDots();
    scheduleSave(); // V0_135: スケッチ色変更を保存
  });
});

// =========================================================
// 線幅選択ボタン
// =========================================================
document.querySelectorAll('.lw-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.lw-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentLW=parseFloat(btn.dataset.lw);
    // ① 色選択と同じくポップアップを閉じる
    document.getElementById('colorOverlay').classList.remove('open');
    // ④ ボタン内の現在値表示を更新
    const lwl=document.getElementById('lwLabel');if(lwl)lwl.textContent=currentLW;
    scheduleSave(); // V0_135: ペン線幅変更を保存
  });
});

// =========================================================
// 蛍光ペン色選択ボタン（V0_70）
// =========================================================
document.querySelectorAll('.hl-color-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.hl-color-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const[r,g,b]=btn.dataset.color.split(',').map(Number);
    currentHL_Color={r,g,b};
    document.getElementById('colorOverlay').classList.remove('open');
    if(typeof updateToolColorDots==='function')updateToolColorDots();
    scheduleSave(); // V0_135: 蛍光ペン色変更を保存
  });
});

// =========================================================
// 蛍光ペン線幅選択ボタン（V0_70）
// =========================================================
document.querySelectorAll('.hl-lw-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.hl-lw-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentHL_LW=parseFloat(btn.dataset.lw);
    document.getElementById('colorOverlay').classList.remove('open');
    // V1_207: 蛍光ペンボタンの3段目(id="hlLwLabel")に現在の線幅を表示する
    const hlwl=document.getElementById('hlLwLabel');if(hlwl)hlwl.textContent=currentHL_LW;
    scheduleSave(); // V0_135: 蛍光ペン線幅変更を保存
  });
});

// =========================================================
// V1_207: 消しゴム範囲選択ボタン
// =========================================================
document.querySelectorAll('.er-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.er-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ERASER_RADIUS_PX=parseFloat(btn.dataset.er);
    document.getElementById('colorOverlay').classList.remove('open');
    const erl=document.getElementById('eraserSizeLabel');if(erl)erl.textContent=ERASER_RADIUS_PX;
    if(typeof scheduleOverlay==='function')scheduleOverlay(); // 消しゴム範囲の可視化円を即反映
    scheduleSave(); // 消しゴム範囲を保存
  });
});

// =========================================================
// 寸法色選択ボタン（V0_70）
// =========================================================
document.querySelectorAll('.dim-color-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.dim-color-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentDimColor=btn.dataset.color;
    document.getElementById('colorOverlay').classList.remove('open');
    if(typeof updateToolColorDots==='function')updateToolColorDots();
    scheduleSave(); // V0_135: 寸法色変更を保存
  });
});
