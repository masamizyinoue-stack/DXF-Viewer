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

// =========================================================
// ポインタ座標取得
// =========================================================
function getPos(e){const r=ov.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}

// =========================================================
// ポインタダウン処理
// =========================================================
function handlePointerDown(sx,sy,isPenInput){
  // DIMシステムがアクティブな場合は DIM の pointerup ハンドラに任せる
  if(window.DIM&&window.DIM.active)return;
  if(window.LP&&window.LP.active)return;
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
      hideGuide();
      showGuide('寸法を追加しました ↩ で取消', 2000);
    }
    scheduleOverlay();return;
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
  if(typeof _dimTextDrag!=='undefined'&&_dimTextDrag&&typeof _dimTextDragMove==='function'&&_dimTextDragMove(sx,sy)) return; // V0_102
  // DIMシステムがアクティブな場合は DIM の pointermove ハンドラに任せる
  if(window.DIM&&window.DIM.active)return;
  if(window.LP&&window.LP.active)return;
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
  if(typeof _dimTextDragUp==='function'&&_dimTextDragUp()) return; // V0_102
  // DIMシステムがアクティブな場合は DIM の pointerup ハンドラに任せる
  if(window.DIM&&window.DIM.active)return;
  if(window.LP&&window.LP.active)return;
  if(dimPendingDown&&isPenInput){
    dimPendingDown=false;
    if(currentTool==='dx'||currentTool==='dy'||currentTool==='dxdy'||currentTool==='diag'){
      const[wx2,wy2]=s2w(sx,sy);
      const pt=snapPt||{x:wx2,y:wy2};
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
        doSave(); // V0_103: 即時保存
        hideGuide();
        showGuide('寸法を追加しました ↩ で取消', 2000);
      }
      scheduleOverlay();return;
    }
  }
  if(currentTool==='eraser'){eraserPos=null;scheduleOverlay();scheduleSave();return;}
  if(isPenInput||currentTool==='sketch'||currentTool==='hl'){
    if(sketching&&sketchPts.length>1){
      snapshot();
      if(currentTool==='hl'){
        // 蛍光ペン: hl:true フラグ付きで保存（V0_70）
        strokes.push({pts:[...sketchPts],color:{...currentHL_Color},lw:currentHL_LW,hl:true});
        if(typeof verify==='function')verify('蛍光追加',{len:strokes.length});
      } else {
        strokes.push({pts:[...sketchPts],color:{...currentColor},lw:currentLW}); // ③ 絶対px値で保存
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
  strokes=strokes.filter(s=>!s.pts.some(p=>Math.hypot(p.x-wx,p.y-wy)<r));
  dims=dims.filter(d=>Math.hypot(d.tx-wx,d.ty-wy)>=r);
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
  } else { handlePointerDown(p.x,p.y,false); }
});
window.addEventListener('mousemove',e=>{
  const p=getPos(e);
  if(window.DIM&&window.DIM.active){
    window.DIM.handleMove(p.x,p.y); // mouseDown不要: ホバー中も_hoverPos更新
  } else if(window.LP&&window.LP.active){
    window.LP.handleMove(p.x,p.y);
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
    // V0_79: 手書きモード + スケッチ/蛍光ペン → 指で描画
    if(inputMode==='freehand'
        &&(currentTool==='sketch'||currentTool==='hl'||currentTool==='eraser')
        &&!(window.DIM&&window.DIM.active)
        &&!(window.LP&&window.LP.active)){
      panning=false;
      handlePointerDown(sx,sy,false); // currentTool===sketch/hlなので描画開始
    } else {
      // ペンモード or 手書きモード+非描画ツール: パンのみ（既存動作）
      if(sketching){sketching=false;sketchPts=[];}
      panning=true;
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
  } else if(fingers.length===1&&mouseDown&&!panning&&(sketching||(inputMode==='freehand'&&currentTool==='eraser'))){
    // V0_79: 手書きモード 指1本描画中
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
    // V0_79: 手書きモードで指描画中だった場合はストロークを確定
    if(!isPen&&(sketching||(inputMode==='freehand'&&currentTool==='eraser'))){
      handlePointerUp(lastMX,lastMY,false);
    }
    if(!isPen){panning=false;mouseDown=false;}
    pinchDist=null;pinchMid=null;return;
  }
  // 2本指→1本指への移行
  if(remFing.length===1&&pinchDist!==null&&!isPen){
    pinchDist=null;pinchMid=null;
    const t=remFing[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    mouseDown=true;lastMX=sx;lastMY=sy;
    // V0_79: 手書きモード+描画ツールなら描画再開、そうでなければパン
    if(inputMode==='freehand'&&(currentTool==='sketch'||currentTool==='hl')
        &&!(window.DIM&&window.DIM.active)&&!(window.LP&&window.LP.active)){
      panning=false;
      handlePointerDown(sx,sy,false); // 新しい指で描画再開
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
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');currentTool=btn.dataset.tool;
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
