// export.js — ファイル出力・エクスポート機能
// DXF Viewer V0_92
// 依存グローバル: cv, ov, doc, hiddenLayers, tx, ty, scale, bwMode, pdfImage, currentFileName (viewer.js)
//               draw, drawAnnotation, scheduleDraw, scheduleOverlay (viewer.js)
//               strokes, dims (var, HTML inline script)
//               hiddenLayers (layer.js)
//               rgbToAci, dxfEncText (utils.js)
//               showGuide, hideGuide (ui.js)
//               drawOverlay (HTML inline script)
// V0_141: PDF高画質化 — _pdfQualityDialog / savePDFBtn ハンドラ変更のみ
//   - PDF専用Canvas解像度: 画面Canvas × 倍率（2x/3x/4x 選択ダイアログ）
//   - デフォルト: 3x（高画質・推奨）
//   - メモリ安全: 4x→3x→2x 自動調整（500MB上限）
//   - PDF作成後に Canvas 解放（pdfCv/pdfOv/pdfAc/pdfComp を width=1 でメモリ返却）
// V0_92: PDF黒画面バグ修正
//   - LONG_PX: 8000→6000（iPad安全canvas範囲: ~25.5MP、513DPI for A4）
//   - 出力形式: PNG→JPEG 0.98（大容量PNG→jsPDF失敗の回避、高品質維持）
// V0_91: PDF最高解像度対応（LONG_PX=8000、PNG、try-finally）
// V0_147: スクショ機能削除

// =========================================================
// DXF書き出し（元データ + 書き込みストローク）
// =========================================================
function exportSketchDxf(){
  if(!doc&&(!strokes||strokes.length===0)){showGuide('データがありません',1500);return;}

  const layerSet=new Set(['SKETCH']);
  if(doc){
    for(const e of [...(doc.sen||[]),...(doc.enko||[]),...(doc.ten||[]),...(doc.moji||[])]){
      if(e.layer) layerSet.add(e.layer);
    }
  }

  const L=[];

  L.push('0','SECTION','2','HEADER',
    '9','$ACADVER','1','AC1009',
    '9','$INSUNITS','70','4',
    '0','ENDSEC');

  L.push('0','SECTION','2','TABLES',
    '0','TABLE','2','LAYER',
    '70',String(layerSet.size));
  for(const lname of layerSet){
    L.push('0','LAYER','2',lname,'70','0','62','7','6','CONTINUOUS');
  }
  L.push('0','ENDTAB','0','ENDSEC');

  L.push('0','SECTION','2','ENTITIES');

  if(doc){
    for(const e of (doc.sen||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','LINE',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x1),'20',String(e.y1),'30','0',
        '11',String(e.x2),'21',String(e.y2),'31','0');
    }
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
    for(const e of (doc.ten||[])){
      const ci=rgbToAci(e.color.r,e.color.g,e.color.b);
      L.push('0','POINT',
        '8',e.layer||'0','62',String(ci),
        '10',String(e.x),'20',String(e.y),'30','0');
    }
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
// V0_141: PDF品質選択定数・ダイアログ
// 安全上限: 500MB（4 canvas × 4 bytes/px × CW × CH）
// =========================================================
var _PDF_SAFE_MEM_MB = 500;

// V0_154: 品質選択ダイアログ(_pdfQualityDialog)を削除。常に高画質(3倍)で出力する。

// =========================================================
// PDF出力ボタン（V0_141: 高画質オフスクリーンCanvas・品質選択ダイアログ）
// V0_117: PDF専用Canvas作成（pdfCv/pdfOv/pdfAc/pdfComp）
// V0_141: LONG_PX = 画面Canvas長辺 × 選択倍率（2x/3x/4x）
//         メモリ安全: 4x→3x→2x 自動調整（500MB上限）
//         PDF作成後: Canvas width=1 でピクセルバッファ即時解放
// =========================================================
document.getElementById('savePDFBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('savePDFBtn');
  btn.disabled = true;

  // ── V0_154: 品質選択ダイアログを廃止し、高画質(3倍)固定で出力 ──────
  const _dlgCvEl = document.getElementById('cv');
  const _dlgBaseLong = Math.max(_dlgCvEl.width, _dlgCvEl.height);
  const _dlgSel = 3;
  // ────────────────────────────────────────────────────────────────

  showGuide('PDFを生成中...');

  // V0_141: Canvas解放用参照（outer finally でクリア）
  let _rCv=null, _rOv=null, _rAc=null, _rComp=null;

  try{
    // ── 1. バウンディングボックス計算（V0_111: 全エンティティ対象・hiddenLayer無視）─
    // PDF出力はDXF全体を対象とするため、非表示レイヤも含めてBoundsを計算する
    function _expAll(x,y){if(!isFinite(x)||!isFinite(y))return;if(x<_allMnX)_allMnX=x;if(y<_allMnY)_allMnY=y;if(x>_allMxX)_allMxX=x;if(y>_allMxY)_allMxY=y;}
    var _allMnX=Infinity,_allMnY=Infinity,_allMxX=-Infinity,_allMxY=-Infinity;
    if(doc){
      for(const e of doc.sen){_expAll(e.x1,e.y1);_expAll(e.x2,e.y2);}
      for(const e of doc.enko){const r=e.rx||e.r||0;_expAll(e.cx-r,e.cy-r);_expAll(e.cx+r,e.cy+r);}
      for(const e of doc.ten){_expAll(e.x,e.y);}
      for(const e of doc.moji){_expAll(e.x,e.y);}
      for(const e of doc.solid){for(const p of e.pts)_expAll(p.x,p.y);}
    }
    if(pdfImage){_expAll(pdfImage.wx,pdfImage.wy);_expAll(pdfImage.wx+pdfImage.ww,pdfImage.wy-pdfImage.wh);}
    for(const img of images){_expAll(img.wx,img.wy);_expAll(img.wx+img.ww,img.wy-img.wh);}
    // データなし時はcomputeBBox()にフォールバック
    const _bbFull=isFinite(_allMnX)?{minx:_allMnX,miny:_allMnY,maxx:_allMxX,maxy:_allMxY}:computeBBox();
    let mnX=isFinite(_bbFull.minx)?_bbFull.minx:Infinity;
    let mnY=isFinite(_bbFull.miny)?_bbFull.miny:Infinity;
    let mxX=isFinite(_bbFull.maxx)?_bbFull.maxx:-Infinity;
    let mxY=isFinite(_bbFull.maxy)?_bbFull.maxy:-Infinity;
    function upd(x,y){if(!isFinite(x)||!isFinite(y))return;mnX=Math.min(mnX,x);mxX=Math.max(mxX,x);mnY=Math.min(mnY,y);mxY=Math.max(mxY,y);}
    // ペン・寸法（ユーザー追記）もboundsに含める
    for(const s of strokes)for(const p of s.pts)upd(p.x,p.y);
    for(const d of dims){
      for(const l of(d.lines||[]))upd(l.x1,l.y1),upd(l.x2,l.y2);
      if(d.tx!=null&&d.ty!=null)upd(d.tx,d.ty);
    }
    if(!isFinite(mnX)){showGuide('描画データがありません',2000);return;}

    // ── 2. V0_141: キャンバスサイズ決定（高画質オフスクリーンCanvas）────────
    const PAD=0.02;
    const eW=mxX-mnX, eH=mxY-mnY;
    const extMinX=mnX-eW*PAD, extMinY=mnY-eH*PAD;
    const extW=eW*(1+2*PAD), extH=eH*(1+2*PAD);
    const aspect=extW/extH;

    const PDF_LONG_MM=297;
    const pageMM_W=aspect>=1?PDF_LONG_MM:Math.round(PDF_LONG_MM*aspect);
    const pageMM_H=aspect>=1?Math.round(PDF_LONG_MM/aspect):PDF_LONG_MM;

    // V0_141: メモリ安全チェック（4x→3x→2x 自動調整）
    const _PDF_MAX_MEM_B = _PDF_SAFE_MEM_MB * 1024 * 1024;
    let _safeMulti = _dlgSel;
    while (_safeMulti >= 2) {
      const _lp = Math.round(_dlgBaseLong * _safeMulti);
      const _cW = aspect >= 1 ? _lp : Math.round(_lp * aspect);
      const _cH = aspect >= 1 ? Math.round(_lp / aspect) : _lp;
      if (_cW * _cH * 16 <= _PDF_MAX_MEM_B) break;
      _safeMulti--;
    }
    if (_safeMulti < 2) { showGuide('メモリ不足のため出力できません',3000); return; }
    if (_safeMulti !== _dlgSel) {
      console.warn('[PDF V0_141] メモリ制限: '+_dlgSel+'x → '+_safeMulti+'x に自動調整');
      showGuide(_dlgSel+'x → '+_safeMulti+'x に自動調整中...',1500);
      await new Promise(r=>setTimeout(r,800));
    }

    // ── 3. 状態退避・PDF用設定 ─────────────────────────────────────
    const sv={tx,ty,scale};
    const cvEl=document.getElementById('cv');
    const ovEl=document.getElementById('ov');
    const sv_ow=ovEl.width;  // _pdfScale計算用
    const dprSave=window.devicePixelRatio||1;

    // V0_141: LONG_PX = 画面Canvas長辺 × 選択倍率
    let LONG_PX = Math.round(_dlgBaseLong * _safeMulti);
    let CW = aspect>=1 ? LONG_PX : Math.round(LONG_PX*aspect);
    let CH = aspect>=1 ? Math.round(LONG_PX/aspect) : LONG_PX;
    let pdfScale = Math.min(CW/extW, CH/extH);
    tx=-extMinX*pdfScale; ty=CH+extMinY*pdfScale; scale=pdfScale;

    // V0_117: ④ Canvasサイズ制限の検知 / ⑤ 制限超過時はLONG_PX縮小で対応
    {
      const _tc=document.createElement('canvas');
      _tc.width=CW; _tc.height=CH;
      const _tc2=_tc.getContext('2d');
      _tc2.fillStyle='#f00'; _tc2.fillRect(CW-1,CH-1,1,1);
      if(_tc2.getImageData(CW-1,CH-1,1,1).data[3]===0){
        // Canvas制限超過。LONG_PXを0.75倍ずつ縮小して再探索
        let _lpx=Math.floor(LONG_PX*0.75);
        let _found=false;
        while(_lpx>=2000){
          const _tCW=aspect>=1?_lpx:Math.round(_lpx*aspect);
          const _tCH=aspect>=1?Math.round(_lpx/aspect):_lpx;
          const _tc3=document.createElement('canvas'); _tc3.width=_tCW; _tc3.height=_tCH;
          const _tc4=_tc3.getContext('2d');
          _tc4.fillStyle='#f00'; _tc4.fillRect(_tCW-1,_tCH-1,1,1);
          if(_tc4.getImageData(_tCW-1,_tCH-1,1,1).data[3]>0){CW=_tCW;CH=_tCH;_found=true;break;}
          _lpx=Math.floor(_lpx*0.75);
        }
        if(!_found){showGuide('Canvasサイズが不足しています',3000);return;}
        pdfScale=Math.min(CW/extW,CH/extH);
        tx=-extMinX*pdfScale; ty=CH+extMinY*pdfScale; scale=pdfScale;
        console.warn('[PDF V0_141] Canvasサイズ制限 → '+CW+'×'+CH+'px に縮小');
      }
    }

    // draw()内部のctx.scale(dpr,dpr)をdpr=1に固定してcanvas=CW×CHで正確に描画させる
    Object.defineProperty(window,'devicePixelRatio',{get:()=>1,configurable:true});
    // PDF用線幅スケール: CW/CSS_W（CSS幅比率）
    window._pdfScale=CW*dprSave/sv_ow;

    // 描画グローバル（cv/ctx/ov/octx）退避（finally で必ず復元）
    const _svCv=window.cv,_svCtx=window.ctx,_svOv=window.ov,_svOctx=window.octx;

    // V0_148.2: PDF専用Canvasを3枚同時に持たず「描画→合成→即解放」を1枚ずつ行う方式に変更。
    // 【背景】従来はpdfCv+pdfAc+pdfOv+pdfComp の計4枚(各CW×CH)を同時に保持していたため、
    // 高画質(3x/4x)選択時にiPadでメモリが逼迫し、Canvasへの描画が一部しか反映されない
    // （PDF範囲が部分的になる）不具合が発生していた。アプリ起動直後などメモリに余裕がない
    // タイミングで再現しやすく、キャンセルして再試行すると正常になる、という報告と一致する。
    // 1枚ずつ生成→drawImageで合成先へ焼き込み→即座にwidth=1で解放することで、
    // 同時に存在する大きなCanvasを最大2枚（作業用1枚+合成先pdfComp）まで削減する。
    // draw()はcv/ctxのみ、drawOverlay()はov/octxのみ、drawAnnotation()は引数ctxのみで
    // 完結しており、3者は互いに独立して呼び出せることを確認済み（既存の描画ロジックは無変更）。
    let pdfComp=null;
    try{
      pdfComp=document.createElement('canvas'); pdfComp.width=CW; pdfComp.height=CH;
      _rComp=pdfComp;
      const pctx=pdfComp.getContext('2d');
      pctx.fillStyle=bwMode?'#fff':'#1e2430';
      pctx.fillRect(0,0,CW,CH);

      // ① メインDXF図形（draw: cv/ctxのみ使用）
      {
        const pdfCv=document.createElement('canvas'); pdfCv.width=CW; pdfCv.height=CH;
        const pdfCtx=pdfCv.getContext('2d');
        _rCv=pdfCv;
        window.cv=pdfCv; window.ctx=pdfCtx;
        if(typeof draw==='function') draw();
        pctx.drawImage(pdfCv,0,0);
        pdfCv.width=1; pdfCv.height=1; _rCv=null; // 即解放
      }

      // ② 手書き・蛍光ペン（drawAnnotation: 引数ctxのみで完結、グローバル不要）
      {
        const pdfAc=document.createElement('canvas'); pdfAc.width=CW; pdfAc.height=CH;
        const pdfAcCtx=pdfAc.getContext('2d');
        _rAc=pdfAc;
        if(typeof drawAnnotation==='function') drawAnnotation(pdfAcCtx);
        pctx.drawImage(pdfAc,0,0);
        pdfAc.width=1; pdfAc.height=1; _rAc=null; // 即解放
      }

      // ③ 寸法（drawOverlay: ov/octxのみ使用）
      {
        const pdfOv=document.createElement('canvas'); pdfOv.width=CW; pdfOv.height=CH;
        const pdfOctx=pdfOv.getContext('2d');
        _rOv=pdfOv;
        window.ov=pdfOv; window.octx=pdfOctx;
        if(typeof drawOverlay==='function') drawOverlay();
        pctx.drawImage(pdfOv,0,0);
        pdfOv.width=1; pdfOv.height=1; _rOv=null; // 即解放
      }

      // 描画完了を待つ（V0_141由来の安全待機）
      await new Promise(r=>requestAnimationFrame(r));
    }finally{
      // 描画エラー時も必ず状態を復元（表示用Canvasへの影響ゼロ）
      try{Object.defineProperty(window,'devicePixelRatio',{get:()=>dprSave,configurable:true});}catch(e){}
      window._pdfScale=undefined;
      window.cv=_svCv; window.ctx=_svCtx; window.ov=_svOv; window.octx=_svOctx;
      tx=sv.tx; ty=sv.ty; scale=sv.scale;
      if(typeof scheduleDraw==='function') scheduleDraw();
      if(typeof scheduleOverlay==='function') scheduleOverlay();
    }
    if(!pdfComp){showGuide('描画に失敗しました',2000);return;}

    // ── 5. jsPDF で PDF 生成（JPEG 0.97: 高品質・大容量PNG回避）──────────
    if(typeof window.jspdf==='undefined'){
      const url=URL.createObjectURL(await new Promise(r=>pdfComp.toBlob(r,'image/png')));
      const a=document.createElement('a');
      a.href=url; a.download=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+`_${new Date().toISOString().slice(0,10)}.png`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      showGuide('画像として保存しました',2000); return;
    }
    const {jsPDF}=window.jspdf;
    const orient=pageMM_W>=pageMM_H?'l':'p';
    const pdf=new jsPDF({orientation:orient,unit:'mm',format:[pageMM_W,pageMM_H],compress:true});
    const imgData=pdfComp.toDataURL('image/jpeg',0.97);
    pdf.addImage(imgData,'JPEG',0,0,pageMM_W,pageMM_H);
    const fname=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+'.pdf'; // V0_96: DXFファイル名をそのまま使用
    pdf.save(fname);
    showGuide('PDFを保存しました（'+_safeMulti+'x / '+CW+'×'+CH+'px）',2500);
    if(typeof window._afterPDFExport==='function'){var _cb=window._afterPDFExport;window._afterPDFExport=null;setTimeout(_cb,600);}

  }catch(err){
    console.error('PDF export error:',err);
    showGuide('PDF出力に失敗しました: '+err.message,3000);
  }finally{
    // V0_141: Canvas解放（ピクセルバッファを即時返却して GC を促進）
    try{
      if(_rCv)  { _rCv.width=1;   _rCv.height=1;   } _rCv=null;
      if(_rOv)  { _rOv.width=1;   _rOv.height=1;   } _rOv=null;
      if(_rAc)  { _rAc.width=1;   _rAc.height=1;   } _rAc=null;
      if(_rComp){ _rComp.width=1; _rComp.height=1; } _rComp=null;
    }catch(e){}
    btn.disabled=false;
  }
});

// =========================================================
// V0_147: スクリーンショット機能削除（screenshotBtnハンドラ・html2canvas依存を廃止）
// =========================================================

// =========================================================
// DXF書き出しボタン
// =========================================================
// V0_154: 「DXF書き込み書出し」ボタンを削除（exportDxfBtn要素なし。exportSketchDxf関数自体は未使用のまま保持）

// =========================================================
// V0_122: .dxfview書出し（dims + strokes のみ）
// =========================================================
// V0_127: .dxfview自動保存対応。IDB(自動保存)→メモリの頪で読み込み、ダウンロード
async function exportDxfview(){
  try{
    const fk=(_fileKey?_fileKey(currentFileName,currentFileSize):null)||currentFileName||'';
    // IDBから自動保存データを読み込む
    let payload=await new Promise(function(resolve){
      try{
        var r=indexedDB.open('dxfViewerDxfviewDB',1);
        r.onupgradeneeded=function(e){e.target.result.createObjectStore('dv',{keyPath:'fk'});};
        r.onsuccess=function(e){
          try{
            var tx=e.target.result.transaction('dv','readonly');
            var gr=tx.objectStore('dv').get(fk);
            gr.onsuccess=function(){resolve(gr.result||null);};
            gr.onerror=function(){resolve(null);};
          }catch(er){resolve(null);}
        };
        r.onerror=function(){resolve(null);};
      }catch(e){resolve(null);}
    });
    // IDBになければメモリから取得
    if(!payload){
      if((!dims||dims.length===0)&&(!strokes||strokes.length===0)){
        showGuide('保存するデータがありません',2000);return;
      }
      payload={format:'dxfview',version:1,
        fileName:currentFileName||'',fileSize:currentFileSize||0,
        fileKey:fk,dims:dims,strokes:strokes};
    }
    payload.appVersion=APP_VERSION;
    payload.exportedAt=new Date().toISOString();
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    const base=(currentFileName||'export').replace(/\.[^.]+$/,'');
    const date=new Date().toISOString().slice(0,10);
    const fname=base+'_'+date+'.dxfview';
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=fname;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    showGuide('.dxfviewを保存しました',2000);
  }catch(e){
    console.warn('[dxfview export] failed',e);
    showGuide('.dxfview保存に失敗しました',2000);
  }
}
// V0_136: exportDxfviewBtnは削除（書込バックアップ/書込復元に置き換え）

// =========================================================
// V0_136: 書込バックアップ（ヘッダーボタン）
// strokes / dims / savedViews / hiddenLayers を .dxfview に保存
// =========================================================
// =========================================================
// V0_141.1: 書込バックアップ保存先フォルダ記憶
// File System Access API (showSaveFilePicker) が利用可能な環境では
// 前回のFileHandleをIDBに保存し、次回保存時のstartInに利用する。
// FileHandleをstartInに渡すと「そのファイルがあるフォルダ」で開く。
// API非対応環境（iPad Safari等）は従来の<a>ダウンロードへ自動フォールバック。
// =========================================================
var _BKDIR_IDB = 'dxfViewerSettingsDB'; // 既存DBとは分離した設定専用DB
var _BKDIR_KEY = 'backupFileHandle';     // IDB内キー（FileSystemFileHandle）

// 前回の保存FileHandleをIDBから非同期読み込み
function _bkHandleLoad() {
  return new Promise(function(resolve) {
    try {
      var r = indexedDB.open(_BKDIR_IDB, 1);
      r.onupgradeneeded = function(e) { e.target.result.createObjectStore('s'); };
      r.onsuccess = function(e) {
        try {
          var tx = e.target.result.transaction('s', 'readonly');
          var req = tx.objectStore('s').get(_BKDIR_KEY);
          req.onsuccess = function() { resolve(req.result || null); };
          req.onerror   = function() { resolve(null); };
        } catch(er) { resolve(null); }
      };
      r.onerror = function() { resolve(null); };
    } catch(e) { resolve(null); }
  });
}

// 今回の保存FileHandleをIDBに非同期書き込み（fire-and-forget）
function _bkHandleSave(handle) {
  try {
    var r = indexedDB.open(_BKDIR_IDB, 1);
    r.onupgradeneeded = function(e) { e.target.result.createObjectStore('s'); };
    r.onsuccess = function(e) {
      try {
        var tx = e.target.result.transaction('s', 'readwrite');
        tx.objectStore('s').put(handle, _BKDIR_KEY);
      } catch(er) { console.warn('[bkDir] IDB write failed', er); }
    };
  } catch(e) { console.warn('[bkDir] IDB open failed', e); }
}

// =========================================================
// V0_136: 書込バックアップ（ヘッダーボタン）
// strokes / dims / savedViews / hiddenLayers を .dxfview に保存
// V0_141.1: File System Access API 対応（保存先フォルダ記憶）
// =========================================================
async function exportDxfviewManual(){
  try{
    if((!dims||dims.length===0)&&(!strokes||strokes.length===0)&&
       (!savedViews||savedViews.every(function(v){return!v;}))&&
       (!hiddenLayers||hiddenLayers.size===0)){
      showGuide('保存するデータがありません',2000);return true; // V0_145: データなし=バックアップ不要なので閉じる処理は継続
    }
    // ── ペイロード作成（V0_136から変更なし）────────────────────────
    const fk=(typeof _fileKey==='function'?_fileKey(currentFileName,currentFileSize):null)||currentFileName||'';
    const payload={
      version:1,
      format:'dxfview-backup',
      createdAt:new Date().toISOString(),
      appVersion:(typeof APP_VERSION!=='undefined'?APP_VERSION:''),
      meta:{
        fileName:currentFileName||'',
        fileSize:currentFileSize||0,
        fileKey:fk
      },
      strokes:(typeof strokes!=='undefined'?strokes:[]),
      dims:(typeof dims!=='undefined'?dims:[]),
      savedViews:(typeof savedViews!=='undefined'?savedViews:[null,null,null,null,null]),
      hiddenLayers:(typeof hiddenLayers!=='undefined'?[...hiddenLayers]:[])
    };
    // V1_16: type:'application/json'のままだと、PWA(standalone)でのプレビュー画面
    // 経由の保存時にiOSがJSONと認識して勝手に「.json」を末尾に付与してしまい、
    // 「◯◯_書込み.dxfview.json」という名前で保存される不具合が判明した（書込復元側の
    // accept='.dxfview'と拡張子が一致せず、復元時に選べなくなる恐れがある）。
    // application/octet-stream（種類不明の汎用バイナリ）にすることで、iOSに拡張子を
    // 推測・付与させず、ダウンロード時のファイル名(fname)をそのまま使わせる
    const blob=new Blob([JSON.stringify(payload)],{type:'application/octet-stream'});
    const base=(currentFileName||'').replace(/\.[^.]+$/,'')||null;
    const fname=(base?base+'_書込み':'書込み')+'.dxfview';

    // ── V0_141.1: File System Access API でフォルダ記憶保存 ────────
    var _fsaSaved = false;
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        // 前回のFileHandleをIDBから取得（startInに渡すと前回フォルダで開く）
        var _prevHandle = await _bkHandleLoad();
        var opts = {
          suggestedName: fname,
          types: [{ description: 'DXFView Backup', accept: { 'application/octet-stream': ['.dxfview'] } }] // V1_16: blobのtype変更に合わせて一致させる
        };
        if (_prevHandle) {
          // 前回ハンドルをstartInに指定（無効な場合はブラウザが自動的にデフォルトへ）
          try { opts.startIn = _prevHandle; } catch(e) {}
        }
        var fh = await window.showSaveFilePicker(opts);
        var writable = await fh.createWritable();
        await writable.write(blob);
        await writable.close();
        _bkHandleSave(fh); // 今回のFileHandleを記憶（次回のstartIn用）
        _fsaSaved = true;
      } catch(e) {
        if (e && e.name === 'AbortError') return false; // ユーザーキャンセル → 静かに終了（V0_145: 閉じる連携用にfalseを返す）
        // APIエラー（権限・非対応等）→ 従来方式でフォールバック
        console.warn('[backup] showSaveFilePicker failed, fallback to <a>:', e);
      }
    }

    // ── V0_146: PWA（ホーム画面起動）時は Web Share API で共有シートを直接表示 ──
    // PWAでは<a download>が使えず、iOSのプレビュー画面→「その他...」→フォルダ選択という
    // 遠回りな動線になり、ファイル名にも勝手に「.json」が付く。
    // navigator.share(File) ならプレビューを飛ばして共有シート（ファイルに保存）へ直行し、
    // .dxfviewのファイル名もそのまま保持される。
    // 通常のSafari起動時は従来の<a>ダウンロードのまま（ダウンロード先設定で1タップ保存が最速のため）。
    //
    // 【V1_13〜V1_17での検討経緯・最終方針】
    // 実機検証の結果、以下3方式はいずれも一長一短でトレードオフの関係にあり、
    // 「タップ無し・共有シートの選択肢が豊富・余分なファイルも出ない」を同時に
    // 満たす方法はiOSの仕様上存在しないことを確認した：
    //   (a) Web Share + textなし(V1_13): タップ無し／選択肢少ない(コピー・Dropbox等が
    //       出ない)／余分ファイル無し
    //   (b) Web Share + text指定(V1_14): タップ無し／選択肢豊富／余分な「ファイル
    //       <日時>.txt」が毎回もう1つ保存される
    //   (c) <a>ダウンロードに統一(V1_15/V1_16): 保存前にiOS標準のプレビュー画面
    //       →「その他...」を押す一手間が必要／選択肢豊富／余分ファイル無し
    // ユーザーと相談の上、「保存の一手間が無いこと」を最優先し、(b)のWeb Share+text
    // 方式を最終採用とした（余分なテキストファイルが毎回1つ増える点は、ユーザーが
    // 把握・許容の上で受け入れ済み）。
    if (!_fsaSaved) {
      var _isStandalone = (window.navigator.standalone === true) ||
                          (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (_isStandalone && navigator.share && typeof navigator.canShare === 'function') {
        try {
          var shareFile = new File([blob], fname, { type: 'application/json' });
          if (navigator.canShare({ files: [shareFile] })) {
            // V1_17: text指定のWeb Share方式（上記経緯により最終採用）。
            // 余分なテキストファイルが毎回もう1つ保存されるのは既知・許容済みの
            // 仕様上の制約であり、不具合ではない
            await navigator.share({ files: [shareFile], text: fname });
            _fsaSaved = true; // 共有完了扱い
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return false; // 共有シートでキャンセル → 閉じ処理も中断
          console.warn('[backup] navigator.share failed, fallback to <a>:', e);
        }
      }
    }

    // ── フォールバック: 従来の <a> ダウンロード（Safari等）────
    if (!_fsaSaved) {
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=fname;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(function(){URL.revokeObjectURL(url);},2000);
    }

    if(typeof verify==='function')verify('バックアップ保存',{strokes:typeof strokes!=='undefined'?strokes.length:-1,dims:typeof dims!=='undefined'?dims.length:-1});
    _abMarkSaved(); // V0_141.2: バックアップ成功時に自動バックアップ促進タイマーをリセット
    showGuide('書込みデータを保存しました',2000);
    return true; // V0_145: 保存成功（閉じる連携用）
  }catch(e){
    console.warn('[dxfview backup] failed',e);
    showGuide('バックアップ保存に失敗しました',2000);
    return false; // V0_145: 保存失敗時は閉じない（データ消失防止）
  }
}
document.getElementById('writeBackupBtn').addEventListener('click',exportDxfviewManual);

// =========================================================
// V0_136: 書込復元（設定パネルボタン）
// .dxfview ファイルを選択して strokes / dims / savedViews / hiddenLayers を復元
// =========================================================
function importDxfviewManual(){
  if(!confirm('現在の書込み内容は上書きされます。よろしいですか？'))return;
  var input=document.createElement('input');
  input.type='file';
  input.accept='.dxfview';
  input.onchange=function(e){
    var file=e.target.files[0];
    if(!file)return;
    var reader=new FileReader();
    reader.onload=function(ev){
      try{
        var d=JSON.parse(ev.target.result);
        if(!d||!d.format||(d.format!=='dxfview'&&d.format!=='dxfview-backup')){
          showGuide('無効な.dxfviewファイルです',2000);return;
        }
        if(typeof snapshot==='function')snapshot();
        if(typeof strokes!=='undefined') strokes=d.strokes||[];
        if(typeof dims!=='undefined') dims=d.dims||[];
        if(typeof savedViews!=='undefined'){
          var sv=d.savedViews||[];
          savedViews=[sv[0]||null,sv[1]||null,sv[2]||null,sv[3]||null,sv[4]||null];
        }
        if(typeof hiddenLayers!=='undefined'&&d.hiddenLayers){
          hiddenLayers=new Set(d.hiddenLayers);
        }
        // V0_141.2: 再代入で参照エイリアスが切れるためopenFiles[]に明示同期（V0_140対応）
        // 同期しないと自動保存(_doBkSave/_dvAutoSave/doSave)が旧データを読み、
        // 復元内容が上書き消失・タブ切替で復元前に戻るバグが発生する
        if(typeof openFiles!=='undefined'&&typeof currentFileIdx!=='undefined'&&
           currentFileIdx>=0&&openFiles[currentFileIdx]){
          var _rf141=openFiles[currentFileIdx];
          if(typeof strokes!=='undefined')_rf141.strokes=strokes;
          if(typeof dims!=='undefined')_rf141.dims=dims;
          if(typeof savedViews!=='undefined')_rf141.savedViews=savedViews;
          if(typeof hiddenLayers!=='undefined')_rf141.hiddenLayersArr=Array.from(hiddenLayers);
        }
        // UI更新
        for(var i=0;i<5;i++){if(typeof updateViewmemoState==='function')updateViewmemoState(i);}
        if(typeof buildLayerModal==='function')buildLayerModal();
        if(typeof scheduleDraw==='function')scheduleDraw(); // V0_138: 書込復元後にDXF本体Canvasを再描画
        if(typeof scheduleOverlay==='function')scheduleOverlay();
        if(typeof updateUndoRedo==='function')updateUndoRedo();
        // V0_142: scheduleSave()→doSave()直接呼び出しに変更
        // 復元直後にSafariを閉じると800msデバウンスが間に合わずデータ消失するバグを修正
        if(typeof doSave==='function') doSave();
        else if(typeof scheduleSave==='function')scheduleSave();
        if(typeof verify==='function')verify('バックアップ復元:done');
        _abMarkSaved(); // V0_141.2: 復元後はバックアップ済みとしてリセット
        showGuide('書込みデータを復元しました',2000);
      }catch(err){
        console.warn('[dxfview import] failed',err);
        showGuide('.dxfview読み込みに失敗しました',2000);
      }
    };
    reader.readAsText(file,'UTF-8');
  };
  input.click();
}
document.getElementById('importDxfviewBtn').addEventListener('click',importDxfviewManual);

// =========================================================
// V0_141.2: 自動バックアップ促進システム
// iPad Safari ではプログラムからのファイル自動保存が不可能なため、
// 10分ごとに変更を検知し「今すぐ保存」バナーを表示する。
// ユーザーが1タップすると exportDxfviewManual() を実行。
// =========================================================
// V0_142: _AB_INTERVAL_MS 削除（visibilitychange方式に変更したため不要）
var _abLastSavedSig = null;            // 最後にバックアップした時点のシグネチャ (null=未計測)
var _abBannerEl    = null;             // バナー要素の参照

// 現在の書込み量をシグネチャ文字列で返す（strokes数:dims数）
function _abGetSig() {
  var s = (typeof strokes !== 'undefined' && strokes) ? strokes.length : 0;
  var d = (typeof dims    !== 'undefined' && dims)    ? dims.length    : 0;
  return s + ':' + d;
}

// バックアップ完了時に呼ぶ（タイマーリセット + バナー非表示）
function _abMarkSaved() {
  _abLastSavedSig = _abGetSig();
  _abHideBanner();
}

// バナーを非表示にして DOM から除去
function _abHideBanner() {
  if (_abBannerEl && _abBannerEl.parentNode) {
    _abBannerEl.parentNode.removeChild(_abBannerEl);
  }
  _abBannerEl = null;
}

// 「今すぐ保存」バナーを表示
function _abShowBanner() {
  if (_abBannerEl) return; // すでに表示中なら何もしない
  var el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'bottom:72px',          // ツールバー・ホームインジケータを避ける
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:99998',
    'background:rgba(20,26,38,0.97)',
    'border:2px solid #f5a623',
    'border-radius:14px',
    'padding:12px 14px 12px 16px',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'box-shadow:0 6px 32px rgba(0,0,0,0.75)',
    'font-family:-apple-system,Helvetica Neue,sans-serif',
    'max-width:92vw',
    'width:340px',
    'box-sizing:border-box'
  ].join(';');

  el.innerHTML =
    '<span style="color:#f5a623;font-size:20px;flex-shrink:0;">⚠</span>' +
    '<span style="color:#dde2f4;font-size:13px;line-height:1.5;flex:1;">' +
      '書込みデータが未バックアップです<br>' +
      '<span style="color:#8898bb;font-size:11px;">ファイルに保存してください（10分経過）</span>' +
    '</span>' +
    '<button id="_abSaveBtn" style="' +
      'background:#f5a623;color:#1e2430;border:none;border-radius:8px;' +
      'padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;' +
      'white-space:nowrap;flex-shrink:0;' +
    '">今すぐ保存</button>' +
    '<button id="_abDismissBtn" style="' +
      'background:transparent;color:#556;border:none;' +
      'font-size:20px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;' +
    '">×</button>';

  document.body.appendChild(el);
  _abBannerEl = el;

  // 「今すぐ保存」: exportDxfviewManual() を実行（成功時に _abMarkSaved が呼ばれる）
  el.querySelector('#_abSaveBtn').addEventListener('click', function() {
    exportDxfviewManual();
  });
  // 「×」: バナーを閉じる（次の10分チェックで再表示される可能性あり）
  el.querySelector('#_abDismissBtn').addEventListener('click', function() {
    _abHideBanner();
  });
}

// 10分ごとに変更の有無を確認
function _abCheck() {
  var cur = _abGetSig();
  // 初回チェック時: 現在の状態を「保存済み」として記録しバナーを出さない
  if (_abLastSavedSig === null) {
    _abLastSavedSig = cur;
    return;
  }
  // 変更があればバナーを表示
  if (cur !== _abLastSavedSig) {
    _abShowBanner();
  }
}

// V0_142: 10分タイマー → visibilitychange に変更
// ページが非表示になった時（Safari離脱・アプリ切替）にトリガー
// ① 未保存のdebounce中データを doSave() で即時フラッシュ
// ② 変更があれば「今すぐ保存」バナーを表示（ユーザーが戻った時に見える）
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    // 800msデバウンス中のsaveTimerが未発火でも即時保存（データ消失防止）
    // V0_144: currentFileNameガード追加（ファイル未読込時にdoSaveすると空データで保存を上書きし消失するため。V0_132のHTML側ハンドラと同一パターン）
    try { if(typeof doSave==='function' && typeof currentFileName!=='undefined' && currentFileName) doSave(); } catch(e) {}
    // 変更があればバナーを表示（ユーザーがSafariに戻った時に確認できる）
    _abCheck();
  }
});

// V0_154: HD-PDF書出（試験）機能(exportHybridPDF)・PDF解像度（試験）設定(_pdfResMulti)を削除
