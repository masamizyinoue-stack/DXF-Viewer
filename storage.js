// storage.js — ローカルストレージ保存・復元
// DXF Viewer V0_65
// 依存グローバル: strokes, dims, savedViews (var), tx, ty, scale, bwMode, currentFileName (viewer.js)
//               hiddenLayers (layer.js)
//               currentTool, currentColor, currentLW (var, HTML inline script)
// 依存関数: arrayBufferToB64 (utils.js)
//           loadPDF, parseDXF, detectScale, updateFileNameDisplay, scheduleDraw, scheduleOverlay (viewer.js)
//           buildLayerModal (layer.js)
//           updateViewmemoState (ui.js)
//           updateUndoRedo (HTML inline script)

const SAVE_KEY='dxfview_v1';
const FILE_KEY='dxfview_v1_file';
let saveTimer=null;

// =========================================================
// 自動保存スケジュール
// =========================================================
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(doSave,800);}

// =========================================================
// localStorage へ保存
// =========================================================
function doSave(){
  try{
    const sd=parseFloat(document.getElementById('scaleDenom').value)||1;
    localStorage.setItem(SAVE_KEY,JSON.stringify({
      strokes,dims,savedViews,tx,ty,scale,
      bwMode,scaleDenom:sd,hiddenLayers:[...hiddenLayers],
      currentTool,currentColor,currentLW,currentFileName,
      currentHL_Color,currentHL_LW,currentDimColor
    }));
  }catch(e){}
}

// =========================================================
// ファイルを localStorage へ保存（1.5MB 超は保存しない）
// =========================================================
function saveFile(buf,name){
  if(!buf||buf.byteLength>1.5*1024*1024){localStorage.removeItem(FILE_KEY);return;}
  try{localStorage.setItem(FILE_KEY,JSON.stringify({name,b64:arrayBufferToB64(buf)}));}
  catch(e){localStorage.removeItem(FILE_KEY);}
}

// =========================================================
// ページ読み込み時の復元
// =========================================================
async function tryRestore(){
  try{
    const fr=localStorage.getItem(FILE_KEY);
    if(fr){
      const{name,b64}=JSON.parse(fr);
      const bin=atob(b64);const buf=new ArrayBuffer(bin.length);const arr=new Uint8Array(buf);
      for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
      currentFileName=name;
      if(name.toLowerCase().endsWith('.pdf')){
        await loadPDF(buf);
      } else {
        doc=parseDXF(buf);detectScale();
      }
      const nd=document.getElementById('noDrawingMsg');if(nd)nd.style.display='none';
      updateFileNameDisplay();
    }
    const raw=localStorage.getItem(SAVE_KEY);if(!raw){buildLayerModal();return;}
    const d=JSON.parse(raw);
    strokes=d.strokes||[];dims=d.dims||[];
    // V0_76: 旧バージョン(3スロット)との後方互換を保ちつつ5スロットに拡張
    {const sv=d.savedViews||[];savedViews=[sv[0]||null,sv[1]||null,sv[2]||null,sv[3]||null,sv[4]||null];}
    tx=d.tx||0;ty=d.ty||0;scale=d.scale||1;
    bwMode=!!d.bwMode;
    if(d.hiddenLayers)hiddenLayers=new Set(d.hiddenLayers);
    currentTool=d.currentTool||'sketch';
    if(currentTool==='dx'||currentTool==='dy')currentTool='dxdy';
    if(d.currentColor)currentColor=d.currentColor;
    // V0_76: スケッチ色ボタンのactive状態を復元
    document.querySelectorAll('.color-btn').forEach(b=>{
      const[r,g,b_]=b.dataset.color.split(',').map(Number);
      b.classList.toggle('active',r===currentColor.r&&g===currentColor.g&&b_===currentColor.b);
    });
    if(d.currentLW)currentLW=d.currentLW;
    // ④ lw-btn active 状態を currentLW に合わせて更新
    document.querySelectorAll('.lw-btn').forEach(b=>{
      b.classList.toggle('active',parseFloat(b.dataset.lw)===currentLW);
    });
    const lwl=document.getElementById('lwLabel');if(lwl)lwl.textContent=currentLW;
    // ⑨ 蛍光ペン色・線幅、寸法色 復元（V0_70）
    if(d.currentHL_Color)currentHL_Color=d.currentHL_Color;
    if(d.currentHL_LW)currentHL_LW=d.currentHL_LW;
    if(d.currentDimColor)currentDimColor=d.currentDimColor;
    document.querySelectorAll('.hl-color-btn').forEach(b=>{
      const[r,g,b_]=b.dataset.color.split(',').map(Number);
      b.classList.toggle('active',r===currentHL_Color.r&&g===currentHL_Color.g&&b_===currentHL_Color.b);
    });
    document.querySelectorAll('.hl-lw-btn').forEach(b=>{
      b.classList.toggle('active',parseFloat(b.dataset.lw)===currentHL_LW);
    });
    document.querySelectorAll('.dim-color-btn').forEach(b=>{
      b.classList.toggle('active',b.dataset.color===currentDimColor);
    });
    if(d.scaleDenom)document.getElementById('scaleDenom').value=d.scaleDenom;
    if(bwMode){
      document.getElementById('bwWhite').classList.add('active');
      document.getElementById('bwBlack').classList.remove('active');
    } else {
      document.getElementById('bwBlack').classList.add('active');
      document.getElementById('bwWhite').classList.remove('active');
    }
    document.querySelectorAll('.tool-btn').forEach(b=>{
      b.classList.toggle('active',b.dataset.tool===currentTool);
    });
    [0,1,2,3,4].forEach(i=>updateViewmemoState(i)); // V0_76: 5スロット対応
    buildLayerModal();  // hiddenLayers復元後に呼ぶ（チェックボックス状態を正しく反映）
    scheduleDraw();scheduleOverlay();updateUndoRedo();
    if(typeof updateToolColorDots==='function')updateToolColorDots();
  }catch(e){console.warn('restore:',e);}
}
