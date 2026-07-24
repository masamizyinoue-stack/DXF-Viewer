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
  if(panning){tx+=sx-lastMX;ty+=sy-lastMY;scheduleDraw();}
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
ov.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
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
  const p=getPos(e);zoomAt(p.x,p.y,e.deltaY<0?1.15:1/1.15);scheduleDraw();
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
    mouseDown=false;panning=false;
    const t0=fingers[0],t1=fingers[1];
    const x0=t0.clientX-r.left,y0=t0.clientY-r.top;
    const x1=t1.clientX-r.left,y1=t1.clientY-r.top;
    pinchDist=Math.hypot(x1-x0,y1-y0);
    pinchMid={x:(x0+x1)/2,y:(y0+y1)/2};
  } else if(fingers.length===1){
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    isPen=false;mouseDown=true;lastMX=sx;lastMY=sy;
    // V1_46/V1_47: 手書きモード + 計測ツール（DIM/LP/LL・水平鉛直・斜め）選択中 →
    // 指でも計測できるようにする。指先で候補点が隠れないよう、実際の指位置より
    // 少し上をカーソル位置として扱う。
    if(inputMode==='freehand'&&_fingerMeasureActive()){
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
    // V1_46/V1_47: 手書きモードで指計測中（DIM/LP/LL・水平鉛直・斜め）だった場合は
    // 指を離した位置で確定
    if(!isPen&&inputMode==='freehand'&&_fingerMeasureActive()){
      _fingerMeasureUp(lastMX,lastMY);
    }
    // V0_79: 手書きモードで指描画中だった場合はストロークを確定
    // V0_152.2: サブ窓作成の対角ドラッグ中(指を離して矩形確定)も含む
    if(!isPen&&(sketching||(inputMode==='freehand'&&currentTool==='eraser')||(window.SW&&window.SW.active))){
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
    if(!isPen&&panning
        &&!sketching&&!(window.SW&&window.SW.active)
        &&!(window.DIM&&window.DIM.active&&window.DIM.phase>0)
        &&!(window.LP&&window.LP.active&&window.LP.phase>0)
        &&!(window.LL&&window.LL.active&&window.LL.phase>0)
        &&_tapStartTime){
      var _tapDt=Date.now()-_tapStartTime;
      var _tapDd=Math.hypot(lastMX-_tapStartX,lastMY-_tapStartY);
      if(_tapDt<300&&_tapDd<12){ // 短時間・小移動＝ドラッグではなくタップ
        // V1_27: 「テキスト読込」ピックモード中は、ダブルタップ全体表示より優先して
        // タップ位置の文字要素を拾い、画面検索/全図面検索の入力欄へ自動入力する
        if(typeof _textPickTarget!=='undefined'&&_textPickTarget){
          if(typeof _tapPickText==='function') _tapPickText(lastMX,lastMY);
          _lastTapTime=0;
        } else {
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
    if(!isPen){panning=false;mouseDown=false;}
    pinchDist=null;pinchMid=null;return;
  }
  // 2本指→1本指への移行
  if(remFing.length===1&&pinchDist!==null&&!isPen){
    pinchDist=null;pinchMid=null;
    const t=remFing[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    mouseDown=true;lastMX=sx;lastMY=sy;
    // V1_46/V1_47: 手書きモード+計測ツール（DIM/LP/LL・水平鉛直・斜め）なら指計測を
    // 再開（カーソルは指の少し上）
    if(inputMode==='freehand'&&_fingerMeasureActive()){
      panning=false;
      const fy=sy-FINGER_CURSOR_OFFSET_Y;
      _fingerMeasureDown(sx,fy);
      lastMX=sx;lastMY=fy;
    } else if(inputMode==='freehand'&&(currentTool==='sketch'||currentTool==='hl'||(window.SW&&window.SW.active))){
      // V0_79: 手書きモード+描画ツールなら描画再開
      // V0_152.2: サブ窓作成中(SW.active)も対象に追加
      panning=false;
      handlePointerDown(sx,sy,false); // 新しい指で描画(操作)再開
    } else {
      panning=true;
    }
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
const _TOOL_COLOR_MODE={sketch:'sketch',hl:'hl',dxdy:'dim',diag:'dim',ll:'dim',lp:'dim',circDim:'dim',radDim:'dim'};
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click',(e)=>{
    const _mode=_TOOL_COLOR_MODE[btn.dataset.tool];
    if(btn.classList.contains('active')&&_mode){
      // 既に選択中のアイコンの再タップ：ツールの再選択・状態リセットは行わず、
      // 色・太さの選択ポップアップだけを開く。DIM/LP/LL等、同じボタンに登録された
      // 他のフックリスナー（計測状態のリセットを行う）が発火して計測途中の状態を
      // 壊してしまわないよう、stopImmediatePropagation()で止める
      if(e&&e.stopImmediatePropagation)e.stopImmediatePropagation();
      if(typeof openContextPopup==='function')openContextPopup(_mode,btn);
      return;
    }
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');currentTool=btn.dataset.tool;
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
    scheduleSave(); // V0_135: 蛍光ペン線幅変更を保存
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
