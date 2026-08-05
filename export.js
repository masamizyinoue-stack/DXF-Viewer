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
// V1_147: 「4倍を選んでも3倍と同じデータサイズになる」との指摘を受け見直した。
// 500MBという値はV0_148.2で同時使用Canvasを4枚→最大2枚に削減する前の想定
// （4 canvas×4bytes/px=16bytes/px）のまま据え置かれており、画面解像度の高い
// 機種(iPad Pro等)では2倍の時点で既にこの上限に達してしまい、3倍・4倍のどちらを
// 選んでも実質2倍まで自動格下げされ区別がつかない、という状態になっていた。
// 実態(最大2 canvas=8bytes/px)+エンコード時の一時バッファ分の余裕を見て
// 700MBまで緩和する（下記_PDF_BYTES_PER_PXの見直しと合わせて対応）。
// なお、これでも尚メモリが足りない高解像度機種では引き続き自動格下げが働き、
// 実際のCanvas確保失敗を検知する仕組み(下記のgetImageDataによる実測チェック)も
// 従来通り保護として残っているため、格下げが必要な場面で失敗する懸念はない
// =========================================================
var _PDF_SAFE_MEM_MB = 700;

// V0_154: 品質選択ダイアログ(_pdfQualityDialog)を削除。常に高画質(3倍)で出力する。

// =========================================================
// PDF出力ボタン（V0_141: 高画質オフスクリーンCanvas・品質選択ダイアログ）
// V0_117: PDF専用Canvas作成（pdfCv/pdfOv/pdfAc/pdfComp）
// V0_141: LONG_PX = 画面Canvas長辺 × 選択倍率（2x/3x/4x）
//         メモリ安全: 4x→3x→2x 自動調整（500MB上限）
//         PDF作成後: Canvas width=1 でピクセルバッファ即時解放
// =========================================================
// V1_146: 「PDFの倍率設定を復活させてほしい」との要望を受け、V0_154で廃止していた
// 品質(倍率)選択ダイアログを復活させた。ボタン押下時はまず_showPdfQualityDialogで
// 倍率(2/3/4)を選んでもらい、選択後に実際のPDF生成処理(_runPdfExport、旧ハンドラの
// 中身をそのまま関数化しただけで生成ロジック自体は変更していない)を呼ぶ。
// ダイアログをキャンセルした場合はボタンを再度押せる状態に戻すだけで何もしない
document.getElementById('savePDFBtn').addEventListener('click', function(){
  const btn = document.getElementById('savePDFBtn');
  if(typeof _showPdfQualityDialog!=='function'){
    // ダイアログ関数が無い場合のフォールバック（従来通り3倍固定で実行）
    btn.disabled = true;
    _runPdfExport(3).finally(function(){ btn.disabled=false; });
    return;
  }
  _showPdfQualityDialog(btn, function(multi){
    btn.disabled = true;
    _runPdfExport(multi).finally(function(){ btn.disabled=false; });
  });
});
async function _runPdfExport(_dlgSel){
  // ── V1_146: 倍率(_dlgSel)は呼び出し元(savePDFBtnハンドラ)がダイアログで選ばせた値を
  // 引数として受け取る。以下の生成ロジック自体はV0_141〜V0_154から変更していない ──
  const _dlgCvEl = document.getElementById('cv');
  const _dlgBaseLong = Math.max(_dlgCvEl.width, _dlgCvEl.height);

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
    // V1_147: 1px当たりの見積りバイト数(旧16)を見直した。この「16」は元々、
    // pdfCv/pdfAc/pdfOv/pdfCompの4枚のCanvas(各RGBA=4バイト/px)を同時に保持していた
    // 頃の実装を前提にした値だったが、V0_148.2で「1枚ずつ描画→合成→即解放」方式に
    // 変更され、同時に存在するCanvasは最大2枚(作業用1枚+合成先pdfComp)に削減された。
    // 実態は8バイト/px(2枚分)まで下がっているにも関わらず見積りだけが16バイト/pxの
    // ままだったため、4倍を選んでも3倍相当まで無駄に自動格下げされやすく、
    // 「4倍と3倍が同じデータサイズになる」との指摘につながった。実態(8バイト/px)に
    // toDataURL/JPEGエンコード時の一時バッファ分の余裕を見て10バイト/pxとし、
    // 過剰に保守的だった判定を緩和する（自機種でのメモリ不足時は引き続き
    // 2x以上での自動格下げ・下記の実測失敗検知(Canvasサイズ制限)で保護される）
    const _PDF_BYTES_PER_PX = 10;
    const _PDF_MAX_MEM_B = _PDF_SAFE_MEM_MB * 1024 * 1024;
    let _safeMulti = _dlgSel;
    while (_safeMulti >= 2) {
      const _lp = Math.round(_dlgBaseLong * _safeMulti);
      const _cW = aspect >= 1 ? _lp : Math.round(_lp * aspect);
      const _cH = aspect >= 1 ? Math.round(_lp / aspect) : _lp;
      if (_cW * _cH * _PDF_BYTES_PER_PX <= _PDF_MAX_MEM_B) break;
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
    // V1_147: 「4倍を選んだのに3倍と同じサイズになった」との指摘は、生成途中の
    // 自動調整メッセージ(1.5秒のみ表示)を見逃すと、保存完了メッセージだけでは
    // 実際に使われた倍率が選んだ倍率と違うことに気づけないのが原因だった。
    // 自動調整が起きた場合は保存完了メッセージ自体にも選択値→実際値を明記し、
    // 見逃しにくいよう表示時間も長くする
    var _multiNote147=(_safeMulti!==_dlgSel)?(_dlgSel+'x→'+_safeMulti+'xに自動調整・'):'';
    showGuide('PDFを保存しました（'+_multiNote147+_safeMulti+'x / '+CW+'×'+CH+'px）',_multiNote147?4000:2500);
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
    // V1_146: btn.disabled=falseは呼び出し元(savePDFBtnハンドラ)の.finally()側で
    // 行うよう変更した（この関数はボタン要素を引数に持たない独立関数のため）
  }
}

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

// V0_154で削除されたHD-PDF書出（試験）機能を、文字幅補正Phase1つきでV1_151で復元。
// V1_152: V1_151で報告された2つの不具合(生成直後にPDF閲覧側が黒画面になる/文字が
//   ほぼ見えない)に対応。
// V1_153: 文字サイズ計算の見直し(mm基準に変更)・A3化・線種(点線等)反映・
//   文字幅補正の安全域を狭めて太さを緩和。
// V1_154: 埋め込み日本語フォントを548文字サブセット→6886文字収録のNoto Sans JPに差替え。
// V1_155: 【書き込みのベクター化】これまで手書き(strokes)・寸法(dims)は透過PNG
//   ラスター画像として重ねていたが、大きなラスター画像を埋め込むこと自体が
//   V1_151〜152で対応した「閲覧側が黒画面になる」不具合の根本要因だった。
//   strokes・dimsは元々ワールド座標の点列・線分データとして保持されているため、
//   全てjsPDFのベクターパス(pdf.lines()での3次ベジェ近似・直線・矢印三角形)として
//   描画するよう変更した。これによりHD-PDFは（DXF由来の画像を除き）完全ベクターの
//   PDFになり、大きなラスター画像を一切埋め込まなくなったため、黒画面の原因となる
//   巨大画像の展開負荷そのものが構造的に無くなった。
//   あわせて、ラスター化のために用意していた作業用Canvas・メモリ見積り・実測
//   アロケーションテスト・devicePixelRatio/tx/ty/scaleの一時差し替えは全て不要に
//   なったため削除した(LONG_PXはCanvasを実際には作らない、スケール計算専用の
//   参照値に変更)。
//   埋め込みフォントもRegular(400)→Light(300)に変更し「文字が少し太い」との
//   指摘に対応した(文字セットのカバー範囲はV1_154と同じ)。
// V1_156: 【文字欠落】「～」(全角チルダ、Unicode U+FF5E)がPDFで表示されない不具合を
//   修正。DXFデータはWindows製CAD由来のためJIS/CP932の全角チルダ(U+FF5E)を使うことが
//   多いが、埋め込みフォント(Google Fonts Noto Sans JP)の日本語サブセットは
//   Unicode標準の波ダッシュ(U+301C)しか収録していない。jsPDFは埋め込みフォントに
//   無い文字を警告もなく無音で読み飛ばすため、「10～20」が「1020」のように文字が
//   消えたまま表示されていた(実測: PDFのTj内容を確認し、U+FF5Eのみ欠落してグリフが
//   1つ減っていることを確認)。フォントを追加せず、pdf.text()/getTextWidth()に渡す
//   直前でU+FF5E→U+301C、同種のU+2015(全角ダッシュ)→U+2014に置換するヘルパー
//   (_hpFixChars)を追加し、doc.moji・dims文字の両方に適用した。見た目はほぼ同一の
//   文字に単純置換するだけなので、実際の寸法値や記号の意味は変わらない。
//   【寸法の矢印・文字の重なり】ごく短い区間の寸法(例: 実寸2.75mm相当など)で、
//   矢印同士・矢印と文字が重なって判読できなくなる不具合を修正。V1_155では矢印長・
//   矢印幅・寸法線幅・センターマークを固定mm値としていたため、図面全体をA3用紙に
//   収める際の縮小率が大きい(＝一枚のシートに長大な図面を収める)場合、実寸が
//   小さい寸法ほど矢印サイズが相対的に大きくなり重なりやすかった。V1_151以前の
//   画面表示ロジック(dimensionTextMode='fixed'時、worldFontH*scaleに比例して矢印・
//   線幅も縮小する)と同じ考え方に戻し、矢印長・矢印幅・寸法線幅・センターマーク・
//   文字とのオフセットを全て寸法文字サイズ(fsMM、worldFontHに比例)基準の相対値に
//   変更した。これにより極小スケールの寸法では矢印・線も連動して小さくなり、
//   重なりを避けやすくなる。
// V1_157: 「スクショの画面表示とPDF印刷の文字の見た目の違いが大きい」との指摘に対応。
//   これまでDXF文字(doc.moji)・寸法文字(dims)とも、英数字を含む文字列全体を単一の
//   埋め込みフォント(Noto Sans JP Light300)で描画していた。画面側は英数字も含めて
//   ブラウザの既定sans-serif(Helvetica/Arial系)で表示されるため、特に数字の字形・
//   字幅がPDFと画面とで大きく異なって見えていた。本バージョンでは、文字列を
//   ASCII文字(半角英数字・記号、コードポイント0x7E以下)の連続部分と、それ以外
//   (漢字・かな・全角記号)の連続部分とに分割し、ASCII部分はjsPDF内蔵のHelvetica
//   フォントで、それ以外はNoto Sans JP埋め込みフォントで、それぞれ描画するように
//   変更した(_hpSplitRuns)。文字列中で複数回フォントが切り替わる場合も、各区間の
//   実測幅をjsPDFのネイティブ回転規約(角度θ度に対し水平方向の送りベクトルは
//   (cosθ, -sinθ)、実測してjsPDF自身のalign:'center'と一致することを確認済み)で
//   連続的に積み上げて描画位置を求めるため、回転や複数行が付いた文字でも隙間なく
//   連結して表示される。文字列全体の画面幅とPDF幅の比率(horizontalScale補正)も、
//   各区間をそれぞれ正しいフォントで実測した合計値を基準に計算し直すため、より
//   正確な補正になる。
// V1_158: 「文字がたくさん書いた図面になるとPDFの時に文字が大きくなりすぎて、
//   ぐちゃぐちゃになる」との指摘に対応。ユーザー提供のPDF(A1版・縮尺1/200を想定した
//   広域・高密度な部材リスト付きDXF、部材ラベルが約2000個)を実測したところ、
//   実に2024個中2001個のテキストが、DXF文字の最低文字高フロア(MIN_TEXT_MM=2.2mm、
//   V1_153で「文字が出てこない」不具合対策として導入)にちょうど張り付いていた。
//   図面全体を固定ページ長辺のA3に収める都合上、この図面のように広域・高密度な
//   図面ほど本来の縮尺で計算される文字サイズが小さくなるが、2.2mmという下限が
//   「完全に不可視化することを防ぐ安全弁」の役割を超えて、ほぼ全ての文字を
//   一律に本来より大きく引き伸ばしてしまい、狭い間隔に並ぶ多数のラベルが
//   重なり合って判読不能になっていた。DXF文字(doc.moji)のMIN_TEXT_MM、寸法文字
//   (dims)のDIM_MIN_TEXT_MMをともに2.2mm→1.1mmへ引き下げた。この下限値は
//   「完全な不可視化を防ぐ」目的に立ち返った安全弁として、密な図面での重なりを
//   大きく緩和しつつ、極端に小さい文字が完全に消えてしまうことは防ぐバランスで
//   設定している。なお、密な図面ほど本来の縮尺自体が小さいため、下限を下げても
//   なお文字が小さく感じられる場合はあり得るが、これは1枚のA3に図面全体を収める
//   という仕様上の制約によるものである。
// V1_159: V1_158(フロア1.1mm)適用後、ユーザーからPDFとアプリ画面のスクリーン
//   ショットを提供いただき比較した結果、「階段6」のように複数のDXF文字ラベルが
//   世界座標上で近接して並ぶ箇所で、PDF側はラベル同士がアプリ画面より詰まって
//   見えることを確認した。DXF原本は特定の縮尺(A1版1/200等)で重ならないよう
//   文字高と行間隔の比率が設計されているため、本来はフロアで引き伸ばさず
//   e.h*pdfScale*_sxをそのまま使えば、ラベル同士の間隔と文字高が同じ比率で
//   縮小されて重なりが生じないはずである。しかし前バージョンまでのフロア値
//   (1.1mm)がこの自然な比率より大きい場合、フロアで一律に引き伸ばされた文字が
//   本来の行間隔を超えてしまい、なお重なりが残っていた。PDFはベクター形式で
//   PDFビューア側から自由に拡大できるため、密な図面では「フロアで無理に読みやすい
//   大きさへ引き伸ばす」よりも「元の縮尺どおりの比率を保ち、必要なら閲覧側で
//   拡大してもらう」方が重なりを避けやすいと判断し、DXF文字(doc.moji)の
//   MIN_TEXT_MM、寸法文字(dims)のDIM_MIN_TEXT_MMをともに1.1mm→0.6mmへさらに
//   引き下げた。完全な不可視化(V1_152の実測不具合値は約0.1mm)を防ぐ安全弁としての
//   役割は0.6mmでも6倍以上の余裕があり十分に果たせる。
// V1_160: 「寸法の数字が若干PDFにすると小さくなります」との指摘に対応。ユーザー
//   提供のPDF(2B-034_hd.pdf)の内部データを実測したところ、寸法値(dims)の
//   テキスト13個のうち5個が、V1_159で0.6mmに揃えたDIM_MIN_TEXT_MMにちょうど
//   張り付いており(1.7007874pt=0.6mm)、周囲のDXF文字(黒、この図面では大半が
//   約4.08pt≒1.44mm相当)や、床に張り付いていない他の寸法値(約2.07〜6.57pt=
//   0.73〜2.3mm相当)より明らかに小さく浮いて見えていた。dimsはユーザーが寸法を
//   作成した時点のワールド座標系での文字高(worldFontH)を記録しており、画面表示
//   (dimensionTextMode='fixed')でもズームに依存せず一定の見やすさで表示される
//   設計になっているため、doc.moji(V1_159で密な図面での重なり対策として0.6mmに
//   下げた)とは別に、dims専用の下限を引き上げるのが適切と判断した。
//   DIM_MIN_TEXT_MM(dims専用)を0.6mm→1.2mmへ引き上げ、MIN_TEXT_MM(doc.moji用、
//   V1_158/159の密な図面対策)は0.6mmのまま変更していない。
// =========================================================
var _jpFontLoaded=false;
function _loadJPFont(){
  return new Promise(function(resolve){
    if(_jpFontLoaded||window._notoSansJPBase64){_jpFontLoaded=true;resolve();return;}
    var s=document.createElement('script');
    s.src='./fonts/NotoSansJP.js';
    s.onload=function(){_jpFontLoaded=true;resolve();};
    s.onerror=function(){console.warn('[HybridPDF] フォント読み込み失敗');resolve();};
    document.head.appendChild(s);
  });
}

// V1_151: 画面表示フォント(sans-serif)での文字列幅測定用の使い回しcanvas
var _hpMeasureCv=null,_hpMeasureCtx=null;

// V1_155: canvasのctx.rotate(angle)と同じ回転（Y下向き画面空間、標準的な回転行列）。
// 書き込み(矢印・寸法文字の下線)のベクター化で、画面描画と同じ見た目になるよう
// ローカル座標を回転させてから配置するために使用する
function _hpRotPt(lx,ly,angle){
  const c=Math.cos(angle),s=Math.sin(angle);
  return [lx*c-ly*s, lx*s+ly*c];
}

// V1_155: 寸法の色(d.color、'#rrggbb'形式のCSS16進文字列)をr,g,bに変換
function _hpHexColor(hex){
  var h=(hex||'#f39c12').replace('#','');
  if(h.length===3) h=h.split('').map(function(c){return c+c;}).join('');
  var r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  return [isFinite(r)?r:0, isFinite(g)?g:0, isFinite(b)?b:0];
}

// V1_156: 埋め込みフォント(Noto Sans JP 日本語サブセット)に収録が無く、jsPDFが
// 無音で読み飛ばしてしまう一部のWindows/CP932由来の記号を、見た目がほぼ同一の
// Unicode標準の文字へ置換してから描画・幅測定する。実測でU+FF5E(全角チルダ「～」)が
// 欠落することを確認したため対応。同種のU+2015(全角ダッシュ「―」)も念のため含める
function _hpFixChars(s){
  if(!s) return s;
  return s.replace(/～/g,'〜').replace(/―/g,'—');
}

// V1_157: 文字列をASCII文字(半角英数字・記号、コードポイント0x7E以下)の連続部分と
// それ以外(漢字・かな・全角記号)の連続部分に分割する。ASCII部分は画面と同じ
// 系統のHelveticaで、それ以外はNoto Sans JP埋め込みフォントで描画するための下準備
function _hpSplitRuns(s){
  const runs=[];
  let cur='', curFont=null;
  for(const ch of (s||'')){
    const cp=ch.codePointAt(0);
    const f=(cp<=0x7E)?'ascii':'jp';
    if(f!==curFont){
      if(cur) runs.push({text:cur,font:curFont});
      cur=ch; curFont=f;
    }else{
      cur+=ch;
    }
  }
  if(cur) runs.push({text:cur,font:curFont});
  return runs;
}
// V1_157: ランのフォント種別に応じてjsPDFの現在フォントを切り替える
function _hpSetRunFont(pdf,font){
  if(font==='ascii') pdf.setFont('helvetica','normal');
  else pdf.setFont('NotoSansJP','normal');
}
// V1_157: jsPDFのpdf.text()にoptions.angle(度)を渡した場合の実際の送りベクトルを
// 実測・検証済みの式で計算する(ローカル+x方向に距離wだけ進んだ位置は
// (w*cosθ, -w*sinθ)だけオフセットされる。jsPDFのalign:'center'と実測比較し一致を
// 確認済み)。フォントが途中で切り替わる文字列を区間ごとに連続して描画するために使う
function _hpPdfAdvance(w,angleDeg){
  const rad=(angleDeg||0)*Math.PI/180;
  return [w*Math.cos(rad), -w*Math.sin(rad)];
}

async function exportHybridPDF(){
  const btn=document.getElementById('hybridPDFBtn');
  btn.disabled=true;
  showGuide('HD-PDFを生成中...');
  try{
    // V0_124: 日本語フォントを事前ロード
    await _loadJPFont();

    // ── 1. バウンディングボックス（現行PDFと同じロジック）──
    var _hMnX=Infinity,_hMnY=Infinity,_hMxX=-Infinity,_hMxY=-Infinity;
    function _hExp(x,y){if(!isFinite(x)||!isFinite(y))return;if(x<_hMnX)_hMnX=x;if(y<_hMnY)_hMnY=y;if(x>_hMxX)_hMxX=x;if(y>_hMxY)_hMxY=y;}
    if(doc){
      for(const e of doc.sen){_hExp(e.x1,e.y1);_hExp(e.x2,e.y2);}
      for(const e of doc.enko){const r=e.rx||e.r||0;_hExp(e.cx-r,e.cy-r);_hExp(e.cx+r,e.cy+r);}
      for(const e of (doc.ten||[])){_hExp(e.x,e.y);}
      for(const e of (doc.moji||[])){_hExp(e.x,e.y);}
      for(const e of (doc.solid||[])){for(const p of e.pts)_hExp(p.x,p.y);}
    }
    if(typeof pdfImage!=='undefined'&&pdfImage){_hExp(pdfImage.wx,pdfImage.wy);_hExp(pdfImage.wx+pdfImage.ww,pdfImage.wy-pdfImage.wh);}
    for(const img of (typeof images!=='undefined'?images:[])){_hExp(img.wx,img.wy);_hExp(img.wx+img.ww,img.wy-img.wh);}
    for(const s of strokes)for(const p of s.pts)_hExp(p.x,p.y);
    for(const d of dims){
      for(const l of(d.lines||[])){_hExp(l.x1,l.y1);_hExp(l.x2,l.y2);}
      if(d.tx!=null&&d.ty!=null)_hExp(d.tx,d.ty);
    }
    if(!isFinite(_hMnX)){showGuide('描画データがありません',2000);return;}

    // ── 2. ページサイズ・スケール決定 ──
    const PAD=0.02;
    const eW=_hMxX-_hMnX, eH=_hMxY-_hMnY;
    const extMinX=_hMnX-eW*PAD, extMinY=_hMnY-eH*PAD;
    const extW=eW*(1+2*PAD), extH=eH*(1+2*PAD);
    const aspect=extW/extH;
    // V1_153: 「A4版ではなくA3版にして」との要望により、長辺を297mm(A4)→420mm(A3)に変更
    const PDF_LONG_MM=420;
    const pageMM_W=aspect>=1?PDF_LONG_MM:Math.round(PDF_LONG_MM*aspect);
    const pageMM_H=aspect>=1?Math.round(PDF_LONG_MM/aspect):PDF_LONG_MM;

    // V1_155: DXF線・円弧・文字・書き込み(手書き・寸法)を全てベクター描画するため、
    // 実際に大きなCanvasを作成する必要が無くなった。LONG_PXは「画面表示相当の
    // 線幅・文字サイズになるようスケール計算するための参照値」としてのみ使用し、
    // メモリ見積り・実測アロケーションテストは不要になったため削除した
    const LONG_PX=6500;
    const CW=aspect>=1?LONG_PX:Math.round(LONG_PX*aspect);
    const CH=aspect>=1?Math.round(LONG_PX/aspect):LONG_PX;
    const pdfScale=Math.min(CW/extW, CH/extH);

    // ── 3. 座標変換 ──
    const tx_p = -extMinX * pdfScale;
    const ty_p =  CH + extMinY * pdfScale;
    const _sx = pageMM_W / CW;
    const _sy = pageMM_H / CH;
    const w2mx = wx => ( wx * pdfScale + tx_p) * _sx;
    const w2my = wy => (-wy * pdfScale + ty_p) * _sy;

    // ── 5. jsPDF 生成 ──
    if(typeof window.jspdf==='undefined'){showGuide('jsPDFが読み込まれていません',2000);return;}
    const {jsPDF}=window.jspdf;
    const orient=pageMM_W>=pageMM_H?'l':'p';
    const pdf=new jsPDF({orientation:orient,unit:'mm',format:[pageMM_W,pageMM_H],compress:true});

    // 白背景
    pdf.setFillColor(255,255,255);
    pdf.rect(0,0,pageMM_W,pageMM_H,'F');

    // 色設定ヘルパー（e.color は {r,g,b} オブジェクト。白背景用に近白色は黒に変換）
    function _setPdfColor(col){
      const css=(typeof rgbCss==='function')?rgbCss(col,false):'rgb(0,0,0)';
      let r=0,g=0,b=0;
      const m=css.match(/rgb\((\d+),(\d+),(\d+)\)/);
      if(m){r=+m[1];g=+m[2];b=+m[3];}
      else if(css.length>=7&&css[0]==='#'){r=parseInt(css.slice(1,3),16);g=parseInt(css.slice(3,5),16);b=parseInt(css.slice(5,7),16);}
      pdf.setDrawColor(r,g,b);
    }

    // 線幅ヘルパー（現行canvas算出式と同じ: max(0.8, lw*scale*1.4) px → mm変換）
    function _lwMM(lw){
      return Math.max(0.1, Math.max(0.8,(lw||0)*pdfScale*1.4)*_sx);
    }

    // V1_153: 線種(点線・一点鎖線等)のダッシュパターンをmm単位に変換するヘルパー。
    // 画面描画(viewer.js)は ctx.setLineDash(e.dash.map(d=>d*scale)) で線種を反映して
    // いるが、旧HD-PDF実装(V0_123〜V0_153)にはこの処理が無く、全て実線になっていた
    function _dashMM(dashArr){
      if(!dashArr||dashArr.length===0) return [];
      return dashArr.map(function(d){ return Math.max(0.05, d*pdfScale*_sx); });
    }

    // ── 6. DXF線分（sen）ベクター描画 ──
    if(doc&&doc.sen){
      for(const e of doc.sen){
        if(hiddenLayers.has(e.layer)) continue;
        _setPdfColor(e.color);
        pdf.setLineWidth(_lwMM(e.lw));
        pdf.setLineDashPattern(_dashMM(e.dash),0); // V1_153
        pdf.line(w2mx(e.x1),w2my(e.y1),w2mx(e.x2),w2my(e.y2));
      }
    }

    // ── 7. DXF円・円弧（enko）ベクター描画 ──
    if(doc&&doc.enko){
      for(const e of doc.enko){
        if(hiddenLayers.has(e.layer)) continue;
        _setPdfColor(e.color);
        pdf.setLineWidth(_lwMM(e.lw));
        pdf.setLineDashPattern(_dashMM(e.dash),0); // V1_153
        const r=e.rx||e.r||0; if(r<=0) continue;
        const a1=e.a1!=null?e.a1:0, a2=e.a2!=null?e.a2:360;
        const cxmm=w2mx(e.cx), cymm=w2my(e.cy);
        const rMM=r*pdfScale*_sx;
        if(a1===0&&a2===360){
          // 真円: jsPDF circle()
          pdf.circle(cxmm,cymm,rMM,'S');
        }else{
          // 円弧: 36分割線分近似（DXF角度: X軸正から反時計回り）
          const rad1=a1*Math.PI/180;
          let rad2=a2*Math.PI/180;
          if(rad2<=rad1) rad2+=2*Math.PI; // 折り返しアーク対応
          const N=36;
          let px0=cxmm+rMM*Math.cos(rad1), py0=cymm-rMM*Math.sin(rad1);
          for(let i=1;i<=N;i++){
            const a=rad1+(rad2-rad1)*i/N;
            const px1=cxmm+rMM*Math.cos(a), py1=cymm-rMM*Math.sin(a);
            pdf.line(px0,py0,px1,py1);
            px0=px1; py0=py1;
          }
        }
      }
    }

    // V1_153: 線分・円弧の描画で設定したダッシュ状態が後続の描画に残らないよう解除
    pdf.setLineDashPattern([],0);

    // ── 7.5 文字（moji）をjsPDFベクター描画（V0_124: 日本語フォント対応、V1_151: 文字幅補正Phase1）──
    if(doc&&doc.moji&&doc.moji.length>0&&window._notoSansJPBase64){
      try{
        pdf.addFileToVFS('NotoSansJP.ttf',window._notoSansJPBase64);
        pdf.addFont('NotoSansJP.ttf','NotoSansJP','normal');
      }catch(er){/* 登録済みの場合は無視 */}
      for(const e of doc.moji){
        if(hiddenLayers.has(e.layer)) continue;
        if(!e.text||!e.text.trim()) continue;
        const xmm=w2mx(e.x);
        const ymm=w2my(e.y);
        // V1_153: V1_152の「最低6px相当」クランプは、6という数値がCanvas(CW)側の
        // ピクセル単位で、そのCanvas自体がメモリ安全策で数千pxに調整される一方
        // 固定ページ長辺(mm)へ縮小されるため、6px分が最終的に何mmになるかは
        // Canvas解像度に依存してしまい、結果的にほぼ改善しないケースがあった
        // (実際に報告されたPDFでもフォントサイズが変わっていなかった)。
        // 印刷後の見た目のmm寸法で直接下限を決める方式に変更する。
        // V1_158: 「文字がたくさん書いた図面になるとPDFの時に文字が大きくなり
        // すぎてぐちゃぐちゃになる」との指摘を受け、2.2mmから1.1mmへ引き下げ。
        // 実測したところ、A1版・縮尺1/200を想定した密なDXF(部材ラベル約2000個)
        // をA3に収める場合、ほぼ全ての文字(2024個中2001個)が2.2mmの下限に
        // 張り付いて重なり合っていた。この下限は「完全に見えなくなる」ことを
        // 防ぐための安全弁であり、必ずしも快適な可読性まで保証するものではない
        // (図面全体を1枚のA3に収める都合上、密な図面では本来の縮尺より文字が
        // 小さくなるのは避けられない)。下限を約半分に下げることで、密な図面での
        // 重なりを大きく緩和しつつ、完全な不可視化は防ぐバランスを取った
        // V1_159: V1_158(1.1mm)適用後もなお「PDFとアプリの文字の見た目差」が
        // 残っているとの報告(隣接する複数のDXF文字ラベルが密に並ぶ箇所で、
        // フロアによる引き伸ばしが元の行間隔を超えてしまい重なりが残っていた)。
        // PDFはベクター形式でありPDFビューア側で自由に拡大できるため、密な図面では
        // 「フロアで無理に読みやすい大きさへ引き伸ばす」よりも「元の縮尺どおりの
        // 比率を保ち、必要なら閲覧側で拡大してもらう」方が重なりを避けやすいと
        // 判断し、フロアをさらに約半分(1.1mm→0.6mm)に下げた。完全な不可視化(V1_152の実測不具合値は
        // 約0.1mm)を防ぐ安全弁としての役割は0.6mmでも十分に果たせる
        const MIN_TEXT_MM=0.6;
        const fsMM=Math.max(MIN_TEXT_MM, e.h*pdfScale*_sx);
        const fsPx=fsMM/_sx; // 画面実測(measureText)用の対応ピクセルサイズ
        if(fsMM<=0) continue;
        const css=(typeof rgbCss==='function')?rgbCss(e.color,false):'rgb(0,0,0)';
        const mc=css.match(/rgb\((\d+),(\d+),(\d+)\)/);
        if(mc) pdf.setTextColor(+mc[1],+mc[2],+mc[3]);
        pdf.setFontSize(fsMM*(72/25.4));
        // V1_156: 埋め込みフォント未収録の記号(全角チルダ等)を読み飛ばされる前に置換
        const lines=_hpFixChars(e.text).split('\n');
        const angleDeg=(e.angle&&Math.abs(e.angle)>0.1)?e.angle:0;
        for(let i=0;i<lines.length;i++){
          const ln=lines[i];
          if(!ln.trim()) continue;
          // V1_157: ASCII(半角英数字記号)とそれ以外(漢字・かな)でフォントを分けるため
          // 行をランに分割する
          const runs=_hpSplitRuns(ln);
          // V1_151→V1_152→V1_157: 文字幅補正Phase1 — 実際に描画されるサイズ(fsPx、
          // 6px下限適用後)でmeasureTextし、画面実測幅と「各ランを正しいフォントで
          // 実測した合計」との比率をhorizontalScale(PDFのTzオペレータ)として渡す
          var _hpRatio=1;
          try{
            var _pdfMM=0;
            for(const run of runs){ _hpSetRunFont(pdf,run.font); _pdfMM+=pdf.getTextWidth(run.text); }
            if(!_hpMeasureCv){_hpMeasureCv=document.createElement('canvas');_hpMeasureCtx=_hpMeasureCv.getContext('2d');}
            _hpMeasureCtx.font=fsPx+'px sans-serif';
            var _rawPx=_hpMeasureCtx.measureText(ln).width*(e.widthFactor||1);
            if(_rawPx>0&&_pdfMM>0){
              var _screenMM=_rawPx*_sx;
              _hpRatio=_screenMM/_pdfMM;
              if(!isFinite(_hpRatio)||_hpRatio<=0) _hpRatio=1;
              // V1_153: 「文字がやや太い」との指摘を受け、安全域を0.5〜2.0から
              // 0.7〜1.4に狭めた。比率が極端(50%前後など)になるケースで文字が
              // 大きく水平圧縮され、字間が詰まって太く見える一因になっていたため、
              // 補正の効き目を弱める代わりに見た目の歪みを抑える方向にした
              _hpRatio=Math.max(0.7,Math.min(1.4,_hpRatio));
            }
          }catch(werr){_hpRatio=1;}
          // 複数行: PDF座標系（Y下向き）ではi行目をfsMM*i だけ上方向へ(既存仕様のまま)
          let curX=xmm, curY=ymm-fsMM*i;
          for(const run of runs){
            _hpSetRunFont(pdf,run.font);
            const opts={baseline:'alphabetic',horizontalScale:_hpRatio};
            if(angleDeg) opts.angle=angleDeg;
            pdf.text(run.text,curX,curY,opts);
            const rw=pdf.getTextWidth(run.text)*_hpRatio;
            const adv=_hpPdfAdvance(rw,angleDeg);
            curX+=adv[0]; curY+=adv[1];
          }
        }
      }
      pdf.setTextColor(0,0,0); // リセット
    }

    // ── 8. 手書き（strokes）ベクター描画 ──
    // V1_155: 画面描画(drawAnnotation)と同じCatmull-Rom風2次ベジェのスムージングを、
    // jsPDFのpdf.lines()が対応する3次ベジェへ変換して描画する(標準変換式:
    // 現在のペン位置P0・2次制御点Q・終点P2に対しC1=P0+2/3(Q-P0), C2=P2+2/3(Q-P2))。
    // ハイライトは setGState({'stroke-opacity':0.45}) で不透明度0.45を再現(ノード上で
    // ExtGState/ca出力を実測確認済み)。ラスター画像を一切使わないため、V1_152で
    // 対応した「巨大画像展開による黒画面」不具合の要因自体が構造的に無くなる。
    if(typeof strokes!=='undefined'&&strokes.length>0){
      const _curPg155=_curPage();
      const lwRef155=(typeof fitScale!=='undefined'&&fitScale>0)?fitScale:scale;
      for(const s of strokes){
        if(!s.pts||s.pts.length<2) continue;
        if((s.page||1)!==_curPg155) continue;
        const n=s.pts.length;
        const col=s.color||{r:0,g:0,b:0};
        const lwPx=s.hl?(s.lw*(scale/lwRef155)):Math.max(1,s.lw*(scale/lwRef155));
        pdf.setDrawColor(col.r,col.g,col.b);
        pdf.setLineWidth(Math.max(0.05,lwPx*_sx));
        pdf.setLineCap('round'); pdf.setLineJoin('round');
        if(s.hl) pdf.setGState(new pdf.GState({'stroke-opacity':0.45}));
        const P=s.pts.map(p=>[w2mx(p.x),w2my(p.y)]);
        if(n===2){
          pdf.line(P[0][0],P[0][1],P[1][0],P[1][1]);
        }else{
          let curX=(P[0][0]+P[1][0])/2, curY=(P[0][1]+P[1][1])/2;
          const startX=curX, startY=curY;
          const segs=[];
          for(let i=1;i<n-1;i++){
            const Qx=P[i][0], Qy=P[i][1];
            const P2x=(P[i][0]+P[i+1][0])/2, P2y=(P[i][1]+P[i+1][1])/2;
            const C1x=curX+2/3*(Qx-curX), C1y=curY+2/3*(Qy-curY);
            const C2x=P2x+2/3*(Qx-P2x), C2y=P2y+2/3*(Qy-P2y);
            segs.push([C1x-curX,C1y-curY,C2x-curX,C2y-curY,P2x-curX,P2y-curY]);
            curX=P2x; curY=P2y;
          }
          segs.push([P[n-1][0]-curX, P[n-1][1]-curY]);
          pdf.lines(segs,startX,startY,[1,1],'S',false);
        }
        if(s.hl) pdf.setGState(new pdf.GState({'stroke-opacity':1}));
      }
    }

    // ── 9. 寸法（dims）ベクター描画 ──
    // V1_155: 寸法線・矢印・センターマーク・寸法文字・アンダーバーを全てベクター化。
    // 矢印はctx.translate+rotate(a.angle)と同じ回転行列を自前計算し絶対座標の三角形
    // として塗りつぶす。寸法文字はd.worldFontH(作成時の画面表示ズームに依存しない
    // ワールド座標系での文字高)をDXF文字(doc.moji)と同じ考え方でmm換算し、印刷でも
    // 判読できるよう最低文字高(DIM_MIN_TEXT_MM)を設ける。
    // V1_156: 矢印長・矢印幅・寸法線幅・センターマークは、V1_155では固定mm値だった
    // ため、図面全体をA3用紙に収める縮小率が大きい図面ほど、実寸が小さい寸法
    // (例:実寸2.75mm相当)で矢印同士・矢印と文字が重なって判読できなくなっていた。
    // 画面表示ロジック(dimensionTextMode='fixed'時、矢印長=10*fixedRatio px、
    // fixedRatio=worldFontH*scale/17)と同じ比率関係になるよう、矢印長・矢印幅・
    // 寸法線幅・センターマーク・文字とのオフセットを全てこの寸法の文字サイズ
    // (fsMM、worldFontHに比例)基準の相対値に変更した。これにより文字サイズが
    // 最低文字高(DIM_MIN_TEXT_MM)でクランプされる極小スケールの寸法でも、矢印等が
    // 連動して相応に小さくなり、重なりを避けやすくなる。
    if(typeof dims!=='undefined'&&dims.length>0){
      // V1_158: doc.moji側と同じ理由(密な図面での文字の重なり緩和)により2.2mm→1.1mmへ
      // V1_159: さらに1.1mm→0.6mmへ(doc.moji側と同じ理由・同じ値)
      // V1_160: 「寸法の数字が若干PDFにすると小さくなる」との指摘を受け実測PDFを
      // 解析した結果、寸法値(dims)の文字13個中5個がこの下限(0.6mm)にちょうど
      // 張り付いており、周囲のDXF文字(黒、この図面では自然サイズが約1.4mm相当)や
      // 他の寸法値(自然サイズで0.7〜2.3mm相当)より明らかに小さく浮いて見えていた。
      // dimsは寸法作成時にworldFontHが記録されズーム非依存の一定サイズを意図して
      // いるため、doc.mojiの下限(0.6mm、密な図面での重なり対策)とは別に、dims
      // 専用の下限を引き上げてこの見た目の不揃いを解消する
      const DIM_MIN_TEXT_MM=1.2;
      const _curPg155b=_curPage();
      for(const d of dims){
        if((d.page||1)!==_curPg155b) continue;
        const [dr,dg,db]=_hpHexColor(d.color);
        pdf.setDrawColor(dr,dg,db); pdf.setFillColor(dr,dg,db); pdf.setTextColor(dr,dg,db);
        // V1_156: 画面表示(dimensionTextMode='fixed')の比率(17px基準)をmmへ換算
        const worldH=d.worldFontH||(17/(scale||1));
        const fsMM=Math.max(DIM_MIN_TEXT_MM, worldH*pdfScale*_sx*1.5);
        const lineMM=Math.max(0.05, fsMM/17);
        const arrowLenMM=fsMM*(10/(17*1.5));
        const arrowWMM=fsMM*(4/(17*1.5));
        const gapMM=fsMM*(8/(17*1.5));
        const centerMarkMM=fsMM*(8/(17*1.5));
        pdf.setLineWidth(lineMM);
        pdf.setLineCap('butt'); pdf.setLineJoin('miter');
        for(const l of (d.lines||[])){
          pdf.line(w2mx(l.x1),w2my(l.y1),w2mx(l.x2),w2my(l.y2));
        }
        for(const a of (d.arrows||[])){
          const axmm=w2mx(a.x), aymm=w2my(a.y);
          const p1=_hpRotPt(-arrowLenMM, arrowWMM, a.angle);
          const p2=_hpRotPt(-arrowLenMM,-arrowWMM, a.angle);
          pdf.triangle(axmm,aymm, axmm+p1[0],aymm+p1[1], axmm+p2[0],aymm+p2[1], 'F');
        }
        if(d.text){
          // V1_156: 埋め込みフォント未収録の記号(全角チルダ等)を読み飛ばされる前に置換
          const dtext=_hpFixChars(d.text);
          const txmm=w2mx(d.tx), tymm=w2my(d.ty);
          const angleDeg=-(d.tangle||0)*180/Math.PI; // canvasのctx.rotate(d.tangle)と
                                                       // 同じ見た目になるよう符号反転
          const off=_hpRotPt(0,-gapMM,d.tangle||0);
          if(window._notoSansJPBase64){
            pdf.setFontSize(fsMM*(72/25.4));
            // V1_157: ASCII(半角英数字記号)とそれ以外(漢字・かな)でフォントを分ける
            const runs=_hpSplitRuns(dtext);
            // 中央揃え相当にするため、各ランを正しいフォントで実測した合計幅を求める
            let totalW=0;
            for(const run of runs){ _hpSetRunFont(pdf,run.font); totalW+=pdf.getTextWidth(run.text); }
            const anchorX=txmm+off[0], anchorY=tymm+off[1];
            const startAdv=_hpPdfAdvance(-totalW/2, angleDeg);
            let curX=anchorX+startAdv[0], curY=anchorY+startAdv[1];
            for(const run of runs){
              _hpSetRunFont(pdf,run.font);
              const opts={baseline:'bottom'};
              if(angleDeg) opts.angle=angleDeg;
              pdf.text(run.text,curX,curY,opts);
              const rw=pdf.getTextWidth(run.text);
              const adv=_hpPdfAdvance(rw,angleDeg);
              curX+=adv[0]; curY+=adv[1];
            }
            if(typeof needsUnderbar==='function'&&needsUnderbar(dtext)){
              const twMM=totalW;
              const u1=_hpRotPt(-twMM/2,-gapMM+0.3,d.tangle||0);
              const u2=_hpRotPt( twMM/2,-gapMM+0.3,d.tangle||0);
              pdf.setLineWidth(Math.max(0.1,fsMM*0.07));
              pdf.line(txmm+u1[0],tymm+u1[1], txmm+u2[0],tymm+u2[1]);
              pdf.setLineWidth(lineMM);
            }
          }
        }
        if(d.centerMark){
          const cmxmm=w2mx(d.centerMark.cx), cmymm=w2my(d.centerMark.cy);
          pdf.setLineWidth(lineMM);
          pdf.line(cmxmm-centerMarkMM,cmymm, cmxmm+centerMarkMM,cmymm);
          pdf.line(cmxmm,cmymm-centerMarkMM, cmxmm,cmymm+centerMarkMM);
        }
      }
      pdf.setTextColor(0,0,0); pdf.setFillColor(0,0,0);
    }

    // ── 10. 保存 ──
    const fname=(currentFileName||'drawing').replace(/\.[^.]+$/,'')+'_hd.pdf';
    pdf.save(fname);
    showGuide('HD-PDFを保存しました',2000);

  }catch(err){
    console.error('[HybridPDF]',err);
    showGuide('HD-PDF出力に失敗しました: '+err.message,3000);
  }finally{
    btn.disabled=false;
  }
}
document.getElementById('hybridPDFBtn').addEventListener('click',exportHybridPDF);
