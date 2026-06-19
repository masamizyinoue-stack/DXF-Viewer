// export.js — ファイル出力・エクスポート機能
// DXF Viewer V0_66
// 依存グローバル: cv, ov, doc, hiddenLayers, tx, ty, scale, bwMode, pdfImage, currentFileName (viewer.js)
//               buildPDF, draw, scheduleDraw, scheduleOverlay (viewer.js)
//               strokes, dims (var, HTML inline script)
//               hiddenLayers (layer.js)
//               rgbToAci, dxfEncText (utils.js)
//               showGuide, hideGuide (ui.js)
//               drawOverlay (HTML inline script)

// =========================================================
// 範囲指定PDF保存（A4固定、buildPDF使用）
// =========================================================
async function savePDF(){
  // ② 高解像度レンダリング（PSCALE倍で再描画）
  const PSCALE = 3;
  const dpr = window.devicePixelRatio || 1;

  // 高解像度キャンバス作成（DXF描画用・オーバーレイ用）
  const hCv = document.createElement('canvas');
  hCv.width = cv.width * PSCALE;
  hCv.height = cv.height * PSCALE;
  const hCtx = hCv.getContext('2d');

  const hOv = document.createElement('canvas');
  hOv.width = ov.width * PSCALE;
  hOv.height = ov.height * PSCALE;
  const hOctx = hOv.getContext('2d');

  // グローバル変数を一時退避・置換
  const [sCv,sCtx,sOv,sOctx] = [cv,ctx,ov,octx];
  const [sTx,sTy,sScale] = [tx,ty,scale];

  window.cv=hCv; window.ctx=hCtx;
  window.ov=hOv; window.octx=hOctx;
  tx=sTx*PSCALE; ty=sTy*PSCALE; scale=sScale*PSCALE;
  window._pdfScale=PSCALE;  // lineWidth/arrow/text スケール用

  try{
    draw();         // DXF/PDF描画（viewer.js）
    drawOverlay();  // strokes・寸法・スナップ描画
  }finally{
    // 必ず復元
    window.cv=sCv; window.ctx=sCtx;
    window.ov=sOv; window.octx=sOctx;
    tx=sTx; ty=sTy; scale=sScale;
    window._pdfScale=undefined;
  }

  // 合成して高品質JPEG化
  const tmp=document.createElement('canvas');
  tmp.width=hCv.width; tmp.height=hCv.height;
  const tctx=tmp.getContext('2d');
  tctx.drawImage(hCv,0,0);
  tctx.drawImage(hOv,0,0);
  const jpeg=tmp.toDataURL('image/jpeg',0.97).split(',')[1];
  const pdf=buildPDF(jpeg,tmp.width,tmp.height);
  const fname=(currentFileName||'dxf_view').replace(/\.[^.]+$/,'')
    +'_'+new Date().toISOString().slice(2,10).replace(/-/g,'')+'.pdf';
  if(window.showSaveFilePicker){
    try{
      const fh=await showSaveFilePicker({suggestedName:fname,types:[{description:'PDF',accept:{'application/pdf':['.pdf']}}]});
      const w=await fh.createWritable();await w.write(pdf);await w.close();return;
    }catch(e){}
  }
  const blob=new Blob([pdf],{type:'application/pdf'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fname;a.click();
}

// =========================================================
// DXF書き出し（元データ + 書き込みストローク）
// dxfEncText / rgbToAci / arrayBufferToB64 → utils.js
// =========================================================
function exportSketchDxf(){
  if(!doc&&(!strokes||strokes.length===0)){showGuide('データがありません',1500);return;}

  // レイヤー一覧を収集
  const layerSet=new Set(['SKETCH']);
  if(doc){
    for(const e of [...(doc.sen||[]),...(doc.enko||[]),...(doc.ten||[]),...(doc.moji||[])]){
      if(e.layer) layerSet.add(e.layer);
    }
  }

  const L=[];  // DXF行バッファ

  // ── HEADER ──
  L.push('0','SECTION','2','HEADER',
    '9','$ACADVER','1','AC1009',
    '9','$INSUNITS','70','4',
    '0','ENDSEC');

  // ── TABLES（レイヤー定義） ──
  L.push('0','SECTION','2','TABLES',
    '0','TABLE','2','LAYER',
    '70',String(layerSet.size));
  for(const lname of layerSet){
    L.push('0','LAYER','2',lname,'70','0','62','7','6','CONTINUOUS');
  }
  L.push('0','ENDTAB','0','ENDSEC');

  // ── ENTITIES ──
  L.push('0','SECTION','2','ENTITIES');

  if(doc){
    // 線分 → LINE
    for(const e of (doc.sen||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','LINE',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x1),'20',String(e.y1),'30','0',
        '11',String(e.x2),'21',String(e.y2),'31','0');
    }
    // 円弧・円 → ARC or CIRCLE
    for(const e of (doc.enko||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      const isCircle=(Math.abs(e.a2-e.a1-360)<0.01)||(e.a1===0&&e.a2===360);
      if(isCircle){
        L.push('0','CIRCLE',
          '8',e.layer||'0','62',String(ci),
          '10',String(e.cx),'20',String(e.cy),'30','0',
          '40',String(e.r||e.rx));
      } else {
        L.push('0','ARC',
          '8',e.layer||'0','62',String(ci),
          '10',String(e.cx),'20',String(e.cy),'30','0',
          '40',String(e.r||e.rx),
          '50',String(e.a1),'51',String(e.a2));
      }
    }
    // 点 → POINT
    for(const e of (doc.ten||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','POINT',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x),'20',String(e.y),'30','0');
    }
    // 文字 → TEXT
    for(const e of (doc.moji||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','TEXT',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x),'20',String(e.y),'30','0',
        '40',String(e.h||1),
        '50',String(e.angle||0),
        '1',dxfEncText(e.text||''));
    }
  }

  // ── 書き込みストローク → POLYLINE+VERTEX+SEQEND（R12互換）──
  for(const s of (strokes||[])){
    if(!s.pts||s.pts.length<2) continue;
    const ci=rgbToAci(s.color.r,s.color.g,s.color.b);
    L.push('0','POLYLINE',
      '8','SKETCH','62',String(ci),
      '66','1',
      '10','0','20','0','30','0',
      '70','0');
    for(const p of s.pts){
      L.push('0','VERTEX',
        '8','SKETCH',
        '10',String(p.x),'20',String(p.y),'30','0',
        '70','0');
    }
    L.push('0','SEQEND','8','SKETCH');
  }

  L.push('0','ENDSEC','0','EOF');
  const content=L.join('\n');
  const blob=new Blob([content],{type:'application/octet-stream'});
  const baseName=(currentFileName||'export').replace(/\.[^.]+$/,'');
  const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,16);
  const fileName=`${baseName}_export_${ts}.dxf`;
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=fileName;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showGuide('DXF書き出し完了',2000);
}

// =========================================================
// PDF出力ボタン（高解像度・jsPDF使用）
// =========================================================
document.getElementById('savePDFBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('savePDFBtn');
  btn.disabled = true;
  showGuide('PDFを生成中...');
  try{
    // ── 1. バウンディングボックス計算 ────────────────────
    let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
    function upd(x,y){if(!isFinite(x)||!isFinite(y))return;mnX=Math.min(mnX,x);mxX=Math.max(mxX,x);mnY=Math.min(mnY,y);mxY=Math.max(mxY,y);}
    const allEnts=[...(doc?.sen||[]),...(doc?.enko||[]),...(doc?.ten||[]),...(doc?.moji||[]),...(doc?.solid||[])];
    for(const e of allEnts){
      if(hiddenLayers.has(e.layer))continue;
      if(e.x1!=null){upd(e.x1,e.y1);upd(e.x2!=null?e.x2:e.x1,e.y2!=null?e.y2:e.y1);}
      if(e.cx!=null){const r=e.r||Math.max(e.rx||0,e.ry||0)||0;upd(e.cx-r,e.cy-r);upd(e.cx+r,e.cy+r);}
      if(e.pts){for(const p of e.pts)upd(p.x,p.y);}
      if(e.x!=null&&e.y!=null)upd(e.x,e.y);
    }
    if(pdfImage){upd(pdfImage.wx,pdfImage.wy);upd(pdfImage.wx+pdfImage.ww,pdfImage.wy-pdfImage.wh);}
    for(const s of strokes)for(const p of s.pts)upd(p.x,p.y);
    for(const d of dims){
      for(const l of(d.lines||[]))upd(l.x1,l.y1),upd(l.x2,l.y2);
      if(d.tx!=null&&d.ty!=null)upd(d.tx,d.ty);
    }
    if(!isFinite(mnX)){showGuide('描画データがありません',2000);return;}

    // ── 2. キャンバスサイズ決定（約450DPI相当）───────────────
    const PAD=0.03;
    const eW=mxX-mnX, eH=mxY-mnY;
    const extMinX=mnX-eW*PAD, extMinY=mnY-eH*PAD;
    const extW=eW*(1+2*PAD), extH=eH*(1+2*PAD);

    // 長辺を5000pxに（約450DPI相当）
    const LONG_PX=5000;
    const aspect=extW/extH;
    const CW=aspect>=1?LONG_PX:Math.round(LONG_PX*aspect);
    const CH=aspect>=1?Math.round(LONG_PX/aspect):LONG_PX;

    // PDF ページサイズ（長辺=297mm → ~427DPI）
    const PDF_LONG_MM=297;
    const pageMM_W=aspect>=1?PDF_LONG_MM:Math.round(PDF_LONG_MM*aspect);
    const pageMM_H=aspect>=1?Math.round(PDF_LONG_MM/aspect):PDF_LONG_MM;

    // ── 3. グローバル状態を退避してPDF用に上書き ──────────
    const sv={tx,ty,scale};
    const cvEl=document.getElementById('cv');
    const ovEl=document.getElementById('ov');
    const sv_cw=cvEl.width,sv_ch=cvEl.height;
    const sv_ow=ovEl.width,sv_oh=ovEl.height;

    const pdfScale=Math.min(CW/extW,CH/extH);
    tx=-extMinX*pdfScale;
    ty=CH+extMinY*pdfScale;  // Y反転: w2s(wx,wy)=[wx*scale+tx, -wy*scale+ty]
    scale=pdfScale;

    // draw()はctx.scale(dpr,dpr)を内部で呼ぶため、PDF用は物理=CSSに統一するためdprを1に
    const dprSave=window.devicePixelRatio||1;
    Object.defineProperty(window,'devicePixelRatio',{get:()=>1,configurable:true});

    cvEl.width=CW; cvEl.height=CH;
    ovEl.width=CW; ovEl.height=CH;

    // V0_73: PDF書出し時のストローク線幅スケール設定（画面表示と比例一致）
    // sv_ow(物理px) / dprSave = 画面CSSキャンバス幅。CW/その値=PDF拡大率
    window._pdfScale = CW * dprSave / sv_ow;

    // ── 4. 描画実行 ────────────────────────────────────
    if(typeof draw==='function') draw();
    if(typeof drawOverlay==='function') drawOverlay();

    // ── 5. 合成 ────────────────────────────────────────
    const comp=document.createElement('canvas');
    comp.width=CW; comp.height=CH;
    const cctx=comp.getContext('2d');
    cctx.fillStyle=bwMode?'#fff':'#1e2430';
    cctx.fillRect(0,0,CW,CH);
    cctx.drawImage(cvEl,0,0);
    cctx.drawImage(ovEl,0,0);

    // ── 6. グローバル状態を復元 ────────────────────────
    Object.defineProperty(window,'devicePixelRatio',{get:()=>dprSave,configurable:true});
    window._pdfScale = undefined;  // V0_73: PDF線幅スケールをリセット
    tx=sv.tx; ty=sv.ty; scale=sv.scale;
    cvEl.width=sv_cw; cvEl.height=sv_ch;
    ovEl.width=sv_ow; ovEl.height=sv_oh;
    if(typeof scheduleDraw==='function')scheduleDraw();
    if(typeof scheduleOverlay==='function')scheduleOverlay();

    // ── 7. jsPDF でカスタムサイズ PDF 生成 ──────────────
    if(typeof window.jspdf==='undefined'){
      // フォールバック: PNG として保存
      const url=URL.createObjectURL(await new Promise(r=>comp.toBlob(r,'image/png')));
      const a=document.createElement('a');
      a.href=url; a.download=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+`_${new Date().toISOString().slice(0,10)}.png`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      showGuide('画像として保存しました',2000); return;
    }
    const {jsPDF}=window.jspdf;
    const orient=pageMM_W>=pageMM_H?'l':'p';
    const pdf=new jsPDF({orientation:orient,unit:'mm',format:[pageMM_W,pageMM_H],compress:true});
    const imgData=comp.toDataURL('image/jpeg',0.96);
    pdf.addImage(imgData,'JPEG',0,0,pageMM_W,pageMM_H,undefined,'FAST');
    const ts=new Date().toISOString().slice(0,10);
    const fname=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+`_${ts}.pdf`;
    pdf.save(fname);
    showGuide('PDFを保存しました',2000);

  }catch(err){
    console.error('PDF export error:',err);
    showGuide('PDF出力に失敗しました: '+err.message,3000);
  }finally{
    document.getElementById('savePDFBtn').disabled=false;
  }
});

// =========================================================
// スクリーンショット保存ボタン（PNG、html2canvas使用）
// =========================================================
document.getElementById('screenshotBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('screenshotBtn');
  btn.disabled = true;
  showGuide('スクリーンショットを保存中...');
  try{
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const scale = Math.max(4, dpr * 2);  // 約2倍の解像度

    let imageBlob;

    if(typeof html2canvas !== 'undefined'){
      // html2canvas でアプリ全体（ヘッダー含む）をキャプチャ
      const captureCanvas = await html2canvas(document.body, {
        scale: scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#0b0f16',
        logging: false,
        imageTimeout: 0
      });
      imageBlob = await new Promise(res => captureCanvas.toBlob(res, 'image/png'));
    } else {
      // フォールバック: cv + ov の合成（ヘッダーなし）
      const cv = document.getElementById('cv');
      const ov = document.getElementById('ov');
      const W = cv.width, H = cv.height;
      const comp = document.createElement('canvas');
      comp.width = W * scale; comp.height = H * scale;
      const ctx2 = comp.getContext('2d');
      ctx2.scale(scale, scale);
      ctx2.fillStyle = '#0b0f16';
      ctx2.fillRect(0, 0, W, H);
      ctx2.drawImage(cv, 0, 0);
      ctx2.drawImage(ov, 0, 0);
      imageBlob = await new Promise(res => comp.toBlob(res, 'image/png'));
    }

    const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const baseName = (currentFileName||'screenshot').replace(/\.[^.]+$/,'');
    const fileName = `${baseName}_${ts}.png`;
    const file = new File([imageBlob], fileName, {type:'image/png'});

    // 保存先: Web Share API（iOS共有ダイアログ）→ <a download>
    let shared = false;
    if(navigator.share && typeof navigator.canShare === 'function' && navigator.canShare({files:[file]})){
      try{
        await navigator.share({files:[file], title:fileName});
        shared = true;
      }catch(shareErr){
        if(shareErr.name === 'AbortError'){ return; } // ユーザーキャンセル→何もしない
        // Share失敗 → downloadにフォールバック
      }
    }
    if(!shared){
      const url = URL.createObjectURL(imageBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    }
    showGuide('保存しました', 2000);
  }catch(err){
    if(err.name !== 'AbortError'){
      console.error('Screenshot error:', err);
      hideGuide();
    } else {
      hideGuide();
    }
  }finally{
    btn.disabled = false;
  }
});

// =========================================================
// PDFボタン（V0_75: 範囲PDF保存を削除、PDF書出のみ維持）
// =========================================================
document.getElementById('savePDFBtn').addEventListener('click',savePDF);

// =========================================================
// DXF\u66f8\u304d\u51fa\u3057\u30dc\u30bf\u30f3
// =========================================================
document.getElementById('exportDxfBtn').addEventListener('click',exportSketchDxf);
