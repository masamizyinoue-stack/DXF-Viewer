// =========================================================
// viewer.js - DXF Viewer 図面表示・座標管理モジュール
// V0_48 - DXF_Viewer から分離
// =========================================================

// =========================================================
// PDF.js worker
// =========================================================
if(typeof pdfjsLib!=='undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
var cv=document.getElementById('cv');
var ov=document.getElementById('ov');
var ac=document.getElementById('ac'); // V0_82: Annotation専用Canvas
var stage=document.getElementById('stage');
var ctx=cv.getContext('2d');
var octx=ov.getContext('2d',{desynchronized:true});
var actx=ac.getContext('2d'); // V0_82: Annotation Canvas context (CTM=identity)
var doc=null;
var currentFileName='';
var tx=0,ty=0,scale=1;
var fitScale=1;       // V0_83: 全体表示時のscaleを記録（drawAnnotation lineWidth基準用）
var bwMode=true;  // false=黒背景
var dimensionTextMode='fixed'; // 'auto' | 'fixed'  寸法文字サイズモード（V0_154: 「サイズ指定」(manual)は廃止）
var DIM_TEXT_MIN_PX=11;  // autoモード: 最小スクリーンpx
var DIM_TEXT_MAX_PX=30;  // autoモード: 最大スクリーンpx
var inputMode='pen'; // 'pen' | 'freehand'  入力モード
// hiddenLayers → layer.js
var pdfDoc=null,pdfPageNum=1;
var excelWb=null,excelSheetIdx=0; // V1_76: Excel(.xlsx/.xls/.csv)表示用
// V1_110: Excel/CSVテーブルの列ソート状態。_excelSortCol=-1は未ソート。
// _excelSortDirは1=昇順/-1=降順/0=未ソート。新規ファイルオープン時・シート切替時にリセットする
var _excelSortCol=-1,_excelSortDir=0;
// V1_115: 「ソート位置」として指定した行番号(0始まり)。-1は「未指定」。V1_114までは
// この指定が同時に「固定表示」も兼ねていたが、V1_115で固定行・固定列は完全に独立した
// 別機能(_excelFreezeRowIdx/_excelFreezeColIdx)に分離した。この行はソート対象から除外され、
// この行の各セルにのみ並べ替え/絞り込みアイコンが表示される。指定より前の行はソート対象外の
// まま元の位置を維持し、指定行より後ろの行だけが選択列で並べ替えられる
var _excelSortRowIdx=-1;
// V1_115: 固定行・固定列の指定(0始まり、-1=未指定)。ヘッダーツールバーの「固定行列」
// ボタン→行番号セルまたは列アルファベットセルのタップで設定する。指定した行/列および
// それより上/左の行列はすべて固定表示領域に含まれる。行・列は独立に設定でき、
// 両方同時に指定されている状態も有り得る（Excelの「ウィンドウ枠の固定」相当）
var _excelFreezeRowIdx=-1,_excelFreezeColIdx=-1;
// V1_115: ソート/固定行列ボタン押下による「タップ待ち」状態。null|'sort'|'freeze'。
// 行番号セル・列アルファベットセルのクリックハンドラはこの値を見て挙動を切り替える
var _excelPickMode=null;
// V1_117: 行ストライプ(行単位の縞模様、V1_111由来)・列ストライプ(列単位の縞模様、V1_115)
// のON/OFFをそれぞれ独立したボタンで切り替えられるようにした。両方ONの場合は
// 行×列の偶奇を組み合わせたチェッカーボード状の縞になる（renderExcelView参照）。
// 行ストライプは従来の既定表示に合わせ既定でON、列ストライプは既定でOFF
var _excelRowStripe=true;
var _excelColStripe=false;
// V1_113: 列ごとの値フィルタ（Excelのオートフィルタ相当）。{colIdx: Set(許可する値の文字列)}。
// キーが無い列は絞り込みなし。V1_111の「行を絞り込み（自由文字列）」機能を置き換えた
var _excelColFilters=null;
// V1_113: シートタブ下の検索欄の状態。V1_111では行を絞り込む機能だったが、行は絞り込まず
// ハイライト表示＋「次へ」での巡回移動のみ行う純粋な検索に変更した
var _excelSearchText='';
var _excelSearchMatchIdx=-1;
// V1_111: 列幅の手動調整結果(px)。列番号をindexとした配列。未調整の列はnullのままで
// 自動レイアウトに従う。1列でもドラッグ調整されるとtable-layout:fixedに切り替わる
var _excelColWidths=null;
// V1_121: 行/列の非表示機能。行は元の行番号(origIdx)、列は元の列番号(0始まり)を
// キーとしたオブジェクトで、true=非表示。ソート/固定行列と同じ「ボタン→ピックモード→
// 行番号/列アルファベットをタップ」の操作パターンで指定する。非表示にした行/列は
// 画面から消えるため再タップでは戻せず、専用の「表示に戻す」ボタンから復元する
// （_showExcelHiddenListMenu参照）
var _excelHiddenRows={};
var _excelHiddenCols={};
// V1_122: 「非表示」ピックモードで複数選択できるようにするための一時的な仮選択状態。
// タップのたびに全体を再描画すると大きい表で重くなるため、確定(非表示ボタンの再押下)まで
// はDOMのクラス切替だけで見た目を更新し、確定時にまとめて_excelHiddenRows/Colsへ反映する
var _excelPendingHideRows={};
var _excelPendingHideCols={};
// V1_122: 「合計」ピックモードで複数選択したセルの一時状態。key="origIdx_colIdx"、
// 値はそのセルの文字列（計算時に数値判定して合算する）
var _excelSumSelected={};
// V1_127: 「合計を合算した数字はどこに出ますか」との指摘への対応。従来は計算結果を
// 画面下のガイド(showGuide/snap-hint)にだけ小さく表示していたため、確定ボタンを
// 押した直後に確定ボタン自体が消えてしまうこともあり、結果がどこに出たのか
// 気づきにくかった。計算結果は、確定ボタンを押した場所と同じ#excelConfirmBarへ
// そのまま表示し続け(「閉じる」ボタンに切り替わる)、目線を動かさずに確認できる
// ようにする。このフラグはその「結果表示中」状態を表す
var _excelConfirmResultActive=false;
// V1_122: ピックモードを切り替える際、前のモードで仮選択していた状態(非表示の仮選択・
// 合計選択)が残ったまま次のモードに入ると、後で意図せず反映されてしまう恐れがあるため、
// モード切替のたびにこれらを確実にクリアする
function _excelClearTransientPickState(){
  _excelPendingHideRows={};
  _excelPendingHideCols={};
  _excelSumSelected={};
  var els=document.querySelectorAll('.excel-pending-hide,.excel-sum-selected');
  els.forEach(function(el){ el.classList.remove('excel-pending-hide','excel-sum-selected'); });
  // V1_127: ファイル/シート切替時に、前のファイルで表示したままの合計結果表示が
  // 残らないようにする
  _excelConfirmResultActive=false;
  var _cbEl127=document.getElementById('excelConfirmBar');
  if(_cbEl127){ _cbEl127.style.display='none'; _cbEl127.classList.remove('excel-confirm-result'); }
}
// V1_111: 新規ファイルオープン時・シート切替時に、列ソート・行フィルタ・列幅の
// カスタム状態をまとめてリセットする（列の意味がファイル/シートごとに異なるため）
// V1_113: 見出し行指定・列値フィルタ・検索状態のリセットも追加
// V1_115: ソート位置・固定行/列・ピックモード・列ストライプのリセットも追加
// V1_117: 行ストライプのリセットも追加（既定値=true）
// V1_121: 非表示行・列のリセットも追加
// V1_122: 非表示/合計の仮選択状態のリセットも追加
function _excelResetViewState(){
  _excelSortCol=-1;_excelSortDir=0;
  _excelSortRowIdx=-1;
  _excelFreezeRowIdx=-1;_excelFreezeColIdx=-1;
  _excelPickMode=null;
  _excelRowStripe=true;
  _excelColStripe=false;
  _excelColFilters=null;
  _excelSearchText='';
  _excelSearchMatchIdx=-1;
  _excelColWidths=null;
  _excelHiddenRows={};
  _excelHiddenCols={};
  _excelClearTransientPickState();
  var fi=document.getElementById('excelFilterInput');
  if(fi) fi.value='';
  if(typeof _updateExcelToolbarUI==='function') _updateExcelToolbarUI();
}
// V1_125: 「複数のExcel/CSVファイルを開いてソート・固定行列・縞・非表示等を設定すると、
// 全てのファイルに反映されてしまう」との指摘への対応。従来、ソート/固定行列/縞/非表示/
// 列幅/列フィルタ等の状態はグローバル変数のみで持ち、ファイル(タブ)を切り替えても
// リセットされるのは「新規ファイルを開いた時」「シートを切り替えた時」だけだった
// （_excelResetViewState参照）。既に開いている別のファイルのタブへ切り替える経路
// (switchToFile等)ではこれらの変数がそのまま残ってしまい、切替先のファイルにも
// 前のファイルの設定が適用されて見えてしまっていた。
// この2関数は、タブ切替の際に現在のグローバル状態を「そのファイル専用のスナップ
// ショット」として保存(_excelCaptureViewState)・復元(_excelApplyViewState)するための
// もの。ピックモード・非表示/合計の仮選択などタップ操作の途中経過(transient)は
// ファイルをまたいで持ち越す意味がないため対象に含めない（常にクリアする）
function _excelCaptureViewState(){
  return {
    sortCol:_excelSortCol,sortDir:_excelSortDir,sortRowIdx:_excelSortRowIdx,
    freezeRowIdx:_excelFreezeRowIdx,freezeColIdx:_excelFreezeColIdx,
    rowStripe:_excelRowStripe,colStripe:_excelColStripe,
    colFilters:_excelColFilters,searchText:_excelSearchText,searchMatchIdx:_excelSearchMatchIdx,
    colWidths:_excelColWidths,hiddenRows:_excelHiddenRows,hiddenCols:_excelHiddenCols
  };
}
function _excelApplyViewState(state){
  _excelSortCol=state.sortCol;_excelSortDir=state.sortDir;
  _excelSortRowIdx=state.sortRowIdx;
  _excelFreezeRowIdx=state.freezeRowIdx;_excelFreezeColIdx=state.freezeColIdx;
  _excelRowStripe=state.rowStripe;_excelColStripe=state.colStripe;
  _excelColFilters=state.colFilters;
  _excelSearchText=state.searchText||'';
  _excelSearchMatchIdx=state.searchMatchIdx;
  _excelColWidths=state.colWidths;
  _excelHiddenRows=state.hiddenRows||{};
  _excelHiddenCols=state.hiddenCols||{};
  _excelPickMode=null;
  _excelClearTransientPickState();
  var fi=document.getElementById('excelFilterInput');
  if(fi) fi.value=_excelSearchText;
  if(typeof _updateExcelToolbarUI==='function') _updateExcelToolbarUI();
}
var pdfImage=null;
// V1_65: PDFの各ページに書いたstrokes/dimsが全ページに同じ様に表示されてしまう不具合の修正用。
// stroke/dim作成時にこの値をpageプロパティとして付与し、描画・消しゴム等でこの値と一致するものだけを対象にする。
// PDF未表示時（DXF表示中含む）は常に1を返し、既存データ（pageプロパティ無し=1扱い）と互換を保つ
function _curPage(){return (typeof pdfDoc!=='undefined'&&pdfDoc)?pdfPageNum:1;}
var pdfMoji=[]; // V1_51: 現在表示中のPDFページから抽出した文字（画面検索・テキスト読込用）
// V1_85: PDF表示解像度をズーム倍率に応じて上げつつ、再レンダリングは表示範囲のみに絞る仕組み。
// pdfImageは「ページ全体」のことも「表示範囲だけの高解像度タイル」のこともあるため、
// 現在の実解像度・実際に覆っている範囲は都度pdfImage自体から逆算する(_pdfImgCurrentScale/Rect)。
// ページ全体の生サイズ(回転込み・scale=1相当)はpdfDoc/pdfPageNumから毎回取得するため、
// タブ切替やセッション復元で別ファイルのpdfImageに入れ替わってもズレたキャッシュを持たない
var PDF_BASE_SCALE=4; // 基準解像度(旧: 3固定)。V1_85でもう少しだけ引き上げ
var PDF_MAX_RENDER_SCALE=12; // 再レンダリング時の解像度倍率の上限
var PDF_MAX_TILE_PIXELS=50000000; // タイル1枚あたりの画素数上限（メモリ対策。既存の全ページ描画実績を下回らない範囲で設定）
var PDF_ZOOM_MARGIN=0.3; // 再レンダリング範囲に持たせる余白(範囲サイズに対する比率)
var PDF_RERENDER_UP_RATIO=1.25; // 現在解像度のこの倍率以上が必要になったら再レンダリング
var PDF_RERENDER_DEBOUNCE_MS=220; // ズーム/パン操作が落ち着いてから再レンダリングするまでの待機時間(ms)
var _pdfRerenderTimer=null;
var _pdfRerenderBusy=false;
var rafId=null;
var needDraw=false,needOverlay=false,needAnnotation=false;
// ─ パフォーマンス最適化 ─
var _scEndPts=[],_scMidPts=[],_scCenPts=[]; // スナップキャッシュ（Xソート済）
var perfMode=false; // 軽量モード（大容量DXF自動切替）
var PERF_THRESHOLD=800; // この要素数を超えたら軽量モード
// V1_102: PC操作時(マウスホイールズーム・マウスドラッグパン)のカクつき対策。
// 大容量DXF(線分・円弧・文字が数万点規模)では、PCブラウザのウィンドウがiPadより
// 大きい分、同じ縮尺でも画面に映る要素数が多くなり、毎フレームの描画負荷が
// iPadより重くなっていた（iPadは画面が小さく映る要素数が少ないため軽い）。
// 操作中(_interacting=true)の間だけ、文字(TEXT)と小さい円/円弧(ボルト穴など、
// 画面上でSMALL_ARC_SKIP_PX px未満にしか映らないもの)の描画を省略し、
// 操作が止まって既定時間(INTERACTION_IDLE_MS)経過した時点で1回だけ全要素を
// 精密描画し直す。対象はPC操作(ホイール・マウスドラッグ)のみで、タッチ操作
// (iPad)には適用しない（iPadは既に体感良好なため、触れて悪化させるリスクを避ける）
var _interacting=false;
var _interactionIdleTimer=null;
var INTERACTION_IDLE_MS=150; // 操作停止とみなすまでの無操作時間(ms)
var SMALL_ARC_SKIP_PX=4; // 操作中、この画面上半径(px)未満の円/円弧の描画を省略
function _beginInteraction(){
  _interacting=true;
  if(_interactionIdleTimer) clearTimeout(_interactionIdleTimer);
  _interactionIdleTimer=setTimeout(function(){
    _interacting=false;
    _interactionIdleTimer=null;
    scheduleDraw(); // 操作停止後、省略していた文字・小さい円弧を精密描画で復元
  },INTERACTION_IDLE_MS);
}
// =========================================================
// ファイル名表示
// =========================================================
function updateFileNameDisplay(){
  const el=document.getElementById('fileNameDisplay');
  if(!el)return;
  el.textContent=currentFileName||'---';
  el.title=currentFileName||'';
}

// =========================================================
// ACI カラーテーブル
// =========================================================
function aci(n){
  if(n<=0||n===256) return {r:255,g:255,b:255};
  const t=[null,[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255],[255,255,255],[128,128,128],[192,192,192]];
  if(n>=1&&n<=9&&t[n]) return {r:t[n][0],g:t[n][1],b:t[n][2]};
  if(n>=250&&n<=255){const gs=[51,102,153,204,228,255];const g=gs[n-250];return {r:g,g:g,b:g};}
  const hi=Math.floor((n-10)/10);
  const lo=(n-10)%10;
  const hue=(hi*30)%360;
  const sat=lo<5?1.0-lo*0.15:0.25+(lo-5)*0.15;
  const val=lo<5?1.0:1.0-(lo-5)*0.1;
  return hsvToRgb(hue,sat,val);
}
function hsvToRgb(h,s,v){
  const i=Math.floor(h/60)%6;
  const f=h/60-Math.floor(h/60);
  const p=v*(1-s),q=v*(1-f*s),t2=v*(1-(1-f)*s);
  let r,g,b;
  if(i===0){r=v;g=t2;b=p}else if(i===1){r=q;g=v;b=p}
  else if(i===2){r=p;g=v;b=t2}else if(i===3){r=p;g=q;b=v}
  else if(i===4){r=t2;g=p;b=v}else{r=v;g=p;b=q}
  return {r:Math.round(r*255),g:Math.round(g*255),b:Math.round(b*255)};
}

// =========================================================
// DXF パーサ
// =========================================================
// V1_106: 文字コード自動判定（UTF-8として妥当ならUTF-8、そうでなければShift-JISとみなす）。
// 元々DXF読込専用だったdecodeDXF()内のロジックを切り出し、CSV読込(loadExcel)からも
// 共通で使えるようにした。日本語Windows環境で作成されたCSVはShift-JIS(CP932)であることが
// 多く、UTF-8前提で読むと文字化けするため、DXFと同じ判定方式をCSVにも適用する
function _decodeTextAuto(buf){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch(e){}
  return new TextDecoder('shift_jis').decode(buf);
}
function decodeDXF(buf){
  const head=new Uint8Array(buf,0,Math.min(20,buf.byteLength));
  if(head[0]===65&&head[1]===117&&head[2]===116)
    throw new Error('バイナリDXF形式は非対応です。ASCII DXFで保存してください。');
  return _decodeTextAuto(buf);
}

function parseDXF(buf){
  const text=decodeDXF(buf);
  const lines=text.split(/\r?\n/);
  const P=[];
  for(let i=0;i<lines.length-1;i+=2){
    const code=parseInt(lines[i].trim());
    if(!isNaN(code)) P.push([code,lines[i+1].trimEnd()]);
  }

  const out={
    ver:'',sen:[],enko:[],ten:[],moji:[],solid:[],sunpou:[],
    usedLayers:{},header:{},layerMap:{},ltypeMap:{},blockMap:{}
  };

  let si=0;
  function findSection(name){
    for(let i=0;i<P.length-1;i++){
      if(P[i][0]===0&&P[i][1]==='SECTION'&&P[i+1][0]===2&&P[i+1][1]===name) return i+2;
    }
    return -1;
  }

  // HEADER
  const hsi=findSection('HEADER');
  if(hsi>=0){
    si=hsi;
    let curVar='';
    while(si<P.length){
      const[c,v]=P[si++];
      if(c===0&&v==='ENDSEC') break;
      if(c===9) curVar=v;
      else if(curVar==='$INSUNITS'&&c===70) out.header.insunits=parseInt(v);
      else if(curVar==='$DIMSCALE'&&c===40) out.header.dimscale=parseFloat(v);
      else if(curVar==='$ACADVER'&&c===1) out.ver=v;
    }
  }

  // TABLES
  const tsi=findSection('TABLES');
  if(tsi>=0){
    si=tsi;
    while(si<P.length){
      const[c,v]=P[si];
      if(c===0&&v==='ENDSEC') break;
      if(c===0&&v==='LAYER'){
        si++;
        let lname='',lcolor=7,lltype='CONTINUOUS';
        while(si<P.length){
          const[lc,lv]=P[si];
          if(lc===0) break;
          si++;
          if(lc===2) lname=lv;
          else if(lc===62) lcolor=parseInt(lv);
          else if(lc===6) lltype=lv.toUpperCase();
        }
        out.layerMap[lname]={color:Math.abs(lcolor),ltype:lltype,visible:lcolor>=0};
      } else if(c===0&&v==='LTYPE'){
        si++;
        let ltname='';const pat=[];
        while(si<P.length){
          const[lc,lv]=P[si];
          if(lc===0) break;
          si++;
          if(lc===2) ltname=lv;
          else if(lc===49) pat.push(Math.abs(parseFloat(lv)));
        }
        out.ltypeMap[ltname.toUpperCase()]=pat;
      } else si++;
    }
  }

  // BLOCKS
  const bsi=findSection('BLOCKS');
  if(bsi>=0){
    si=bsi;
    let curBlock=null;
    while(si<P.length){
      const[c,v]=P[si];
      if(c===0&&v==='ENDSEC') break;
      if(c===0&&v==='BLOCK'){
        si++;
        let bname='',bx=0,by=0;
        while(si<P.length){
          const[bc,bv]=P[si];
          if(bc===0) break;
          si++;
          if(bc===2) bname=bv;
          else if(bc===10) bx=parseFloat(bv)||0;
          else if(bc===20) by=parseFloat(bv)||0;
        }
        curBlock={name:bname,ox:bx,oy:by,ents:[]};
        out.blockMap[bname]=curBlock;
      } else if(c===0&&v==='ENDBLK'){
        si++;curBlock=null;
      } else if(c===0&&curBlock){
        const r=convertOne(P,si,out.layerMap,out.ltypeMap,out.blockMap,0);
        curBlock.ents.push(...r);
        si=r._nextSi||si+1;
      } else si++;
    }
  }

  // ENTITIES
  const esi=findSection('ENTITIES');
  if(esi>=0){
    si=esi;
    while(si<P.length){
      const[c,v]=P[si];
      if(c===0&&v==='ENDSEC') break;
      if(c===0&&v==='POLYLINE'){
        si++;
        let plyLayer='0',plyColor=7,plyLtype='',plyLw=0.25,plyClosed=false;
        while(si<P.length){
          const[pc,pv]=P[si];
          if(pc===0) break;
          si++;
          if(pc===8) plyLayer=pv;
          else if(pc===62) plyColor=parseInt(pv);
          else if(pc===6) plyLtype=pv;
          else if(pc===70) plyClosed=!!(parseInt(pv)&1);
          else if(pc===370) plyLw=parseInt(pv)>0?parseInt(pv)/100:0.25;
        }
        const plyColorR=aci(Math.abs(plyColor));
        const plyDash=resolveDash({ltype:plyLtype,layer:plyLayer},out.layerMap,out.ltypeMap);
        const verts=[];
        while(si<P.length){
          const[vc,vv]=P[si];
          if(vc===0&&vv==='SEQEND'){si++;break;}
          if(vc===0&&vv==='VERTEX'){
            si++;
            let vx=0,vy=0,vbulge=0;
            while(si<P.length){
              const[vvc,vvv]=P[si];
              if(vvc===0) break;
              si++;
              if(vvc===10) vx=parseFloat(vvv)||0;
              else if(vvc===20) vy=parseFloat(vvv)||0;
              else if(vvc===42) vbulge=parseFloat(vvv)||0;
            }
            verts.push({x:vx,y:vy,bulge:vbulge});
          } else si++;
        }
        for(let vi=0;vi<verts.length-1;vi++){
          const p1=verts[vi],p2=verts[vi+1];
          if(Math.abs(p1.bulge)>1e-6){
            const sp=arcSegPts(p1.x,p1.y,p2.x,p2.y,p1.bulge);
            for(let j=0;j<sp.length-1;j++)
              out.sen.push({type:'sen',x1:sp[j].x,y1:sp[j].y,x2:sp[j+1].x,y2:sp[j+1].y,color:plyColorR,dash:plyDash,layer:plyLayer,lw:plyLw});
          } else {
            out.sen.push({type:'sen',x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,color:plyColorR,dash:plyDash,layer:plyLayer,lw:plyLw});
          }
        }
        if(plyClosed&&verts.length>1){
          const p1=verts[verts.length-1],p2=verts[0];
          out.sen.push({type:'sen',x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,color:plyColorR,dash:plyDash,layer:plyLayer,lw:plyLw});
        }
      } else if(c===0){
        const r=convertOne(P,si,out.layerMap,out.ltypeMap,out.blockMap,0);
        r.forEach(e=>{
          if(e.type==='sen') out.sen.push(e);
          else if(e.type==='enko') out.enko.push(e);
          else if(e.type==='ten') out.ten.push(e);
          else if(e.type==='moji') out.moji.push(e);
          else if(e.type==='solid') out.solid.push(e);
        });
        si=r._nextSi||si+1;
      } else si++;
    }
  }

  [...out.sen,...out.enko,...out.ten,...out.moji,...out.solid].forEach(e=>{
    if(e.layer) out.usedLayers[e.layer]=true;
  });
  return out;
}

function resolveColor(attrs,layerMap){
  if(attrs.truecolor!==undefined){
    const c=attrs.truecolor;
    return {r:(c>>16)&0xff,g:(c>>8)&0xff,b:c&0xff};
  }
  const ac=attrs.aciColor;
  if(ac!==undefined&&ac!==256&&ac!==0) return aci(Math.abs(ac));
  if(ac===0) return {r:255,g:255,b:255};
  const ly=attrs.layer||'0';
  const linfo=layerMap[ly];
  if(linfo) return aci(linfo.color||7);
  return {r:255,g:255,b:255};
}

function resolveDash(attrs,layerMap,ltypeMap){
  let lt=(attrs.ltype||'').toUpperCase();
  if(!lt||lt==='BYLAYER'){
    const linfo=layerMap[attrs.layer||'0'];
    lt=linfo?(linfo.ltype||'CONTINUOUS'):'CONTINUOUS';
  }
  if(lt==='CONTINUOUS'||lt==='') return [];
  if(lt==='HIDDEN'||lt==='DASHED') return [8,4];
  if(lt==='CENTER') return [16,4,4,4];
  if(lt==='DASHDOT') return [12,4,2,4];
  if(lt==='PHANTOM') return [20,4,4,4,4,4];
  if(lt==='DOT') return [2,4];
  if(ltypeMap&&ltypeMap[lt]&&ltypeMap[lt].length>0) return ltypeMap[lt];
  return [];
}

function arcSegPts(x1,y1,x2,y2,bulge){
  const d=Math.sqrt((x2-x1)**2+(y2-y1)**2);
  if(d<1e-10) return [{x:x1,y:y1},{x:x2,y:y2}];
  const r=d*(1+bulge*bulge)/(4*Math.abs(bulge));
  const midx=(x1+x2)/2,midy=(y1+y2)/2;
  const nx=-(y2-y1)/d,ny=(x2-x1)/d;
  const s=(r-(d/2)*(bulge*bulge-1)/(2*bulge))/d;
  const cx=midx+nx*s*Math.sign(bulge)*(d/2);
  const cy=midy+ny*s*Math.sign(bulge)*(d/2);
  const a1=Math.atan2(y1-cy,x1-cx);
  const a2=Math.atan2(y2-cy,x2-cx);
  const segs=Math.max(8,Math.round(Math.abs(bulge)*20));
  let da=a2-a1;
  if(bulge>0&&da<0) da+=2*Math.PI;
  if(bulge<0&&da>0) da-=2*Math.PI;
  const pts=[];
  for(let i=0;i<=segs;i++){
    const a=a1+da*i/segs;
    pts.push({x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)});
  }
  return pts;
}

function convertOne(P,si,layerMap,ltypeMap,blockMap,depth){
  const result=[];
  result._nextSi=si;
  if(si>=P.length) return result;
  const type=P[si][1];si++;
  const attrs={};const extras=[];
  while(si<P.length){
    const[c,v]=P[si];
    if(c===0) break;
    si++;
    if(c===8) attrs.layer=v;
    else if(c===6) attrs.ltype=v;
    else if(c===62) attrs.aciColor=parseInt(v);
    else if(c===420) attrs.truecolor=parseInt(v);
    else if(c===370) attrs.lw=parseInt(v);
    else extras.push([c,v]);
  }
  result._nextSi=si;
  const color=resolveColor(attrs,layerMap);
  const dash=resolveDash(attrs,layerMap,ltypeMap);
  const layer=attrs.layer||'0';
  const lw=attrs.lw&&attrs.lw>0?attrs.lw/100:0.25;
  function gv(code,def){for(const[c,v]of extras)if(c===code)return v;return def!==undefined?def:null;}
  function gf(code,def=0){const v=gv(code,null);return v!==null?(parseFloat(v)||def):def;}
  function gi(code,def=0){const v=gv(code,null);return v!==null?(parseInt(v)||def):def;}

  if(type==='LINE'){
    result.push({type:'sen',x1:gf(10),y1:gf(20),x2:gf(11),y2:gf(21),color,dash,layer,lw});
  } else if(type==='CIRCLE'){
    const cx=gf(10),cy=gf(20),r=gf(40);
    result.push({type:'enko',cx,cy,r,a1:0,a2:360,color,dash,layer,lw,tilt:0,rx:r,ry:r});
  } else if(type==='ARC'){
    result.push({type:'enko',cx:gf(10),cy:gf(20),r:gf(40),a1:gf(50),a2:gf(51),color,dash,layer,lw,tilt:0,rx:gf(40),ry:gf(40)});
  } else if(type==='ELLIPSE'){
    const cx=gf(10),cy=gf(20),mx=gf(11),my=gf(21);
    const ratio=gf(40,1);
    const rx=Math.sqrt(mx*mx+my*my);
    const ry=rx*ratio;
    const tilt=Math.atan2(my,mx)*180/Math.PI;
    const a1=gf(41)*180/Math.PI,a2r=gf(42);
    const a2=a2r?a2r*180/Math.PI:360;
    result.push({type:'enko',cx,cy,r:rx,a1,a2,color,dash,layer,lw,tilt,rx,ry});
  } else if(type==='POINT'){
    result.push({type:'ten',x:gf(10),y:gf(20),color,layer});
  } else if(type==='TEXT'||type==='ATTRIB'){
    result.push({type:'moji',x:gf(10),y:gf(20),text:gv(1,'')||'',h:gf(40,1),angle:gf(50,0),color,layer,widthFactor:gf(41,1)||1});
  } else if(type==='MTEXT'){
    // group code 3 (continuation) + 1 (last/only part) を結合
    var _mt3=extras.filter(function(e){return e[0]===3;}).map(function(e){return e[1];}).join('');
    let txt=_mt3+(gv(1,'')||'');
    txt=txt.replace(/\\[pP]/g,'\n').replace(/\{\\[^;]+;/g,'').replace(/\}/g,'').replace(/\\[A-Za-z][^;]*;/g,'').replace(/%%[cCdDpP]/g,'');
    result.push({type:'moji',x:gf(10),y:gf(20),text:txt,h:gf(40,1),angle:0,color,layer,widthFactor:1});
  } else if(type==='SOLID'||type==='TRACE'){
    const pts=[{x:gf(10),y:gf(20)},{x:gf(11),y:gf(21)},{x:gf(13),y:gf(23)},{x:gf(12),y:gf(22)}];
    result.push({type:'solid',pts,color,layer});
  } else if(type==='3DFACE'){
    const pts=[{x:gf(10),y:gf(20)},{x:gf(11),y:gf(21)},{x:gf(12),y:gf(22)},{x:gf(13),y:gf(23)}];
    result.push({type:'solid',pts,color,layer});
  } else if(type==='LWPOLYLINE'){
    const closed=gi(70,0)&1;
    const pts2=[];
    for(const[c,v]of extras){
      if(c===10) pts2.push({x:parseFloat(v)||0,y:0,bulge:0});
      else if(c===20&&pts2.length>0) pts2[pts2.length-1].y=parseFloat(v)||0;
      else if(c===42&&pts2.length>0) pts2[pts2.length-1].bulge=parseFloat(v)||0;
    }
    const n=pts2.length;
    for(let i=0;i<n-1;i++){
      const p1=pts2[i],p2=pts2[i+1];
      if(Math.abs(p1.bulge)>1e-6){
        const sp=arcSegPts(p1.x,p1.y,p2.x,p2.y,p1.bulge);
        for(let j=0;j<sp.length-1;j++)
          result.push({type:'sen',x1:sp[j].x,y1:sp[j].y,x2:sp[j+1].x,y2:sp[j+1].y,color,dash,layer,lw});
      } else {
        result.push({type:'sen',x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,color,dash,layer,lw});
      }
    }
    if(closed&&n>1){
      const p1=pts2[n-1],p2=pts2[0];
      if(Math.abs(p1.bulge)>1e-6){
        const sp=arcSegPts(p1.x,p1.y,p2.x,p2.y,p1.bulge);
        for(let j=0;j<sp.length-1;j++)
          result.push({type:'sen',x1:sp[j].x,y1:sp[j].y,x2:sp[j+1].x,y2:sp[j+1].y,color,dash,layer,lw});
      } else {
        result.push({type:'sen',x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,color,dash,layer,lw});
      }
    }
  } else if(type==='SPLINE'){
    const cpts=[];
    for(let i=0;i<extras.length-1;i++){
      if(extras[i][0]===10&&extras[i+1][0]===20)
        cpts.push({x:parseFloat(extras[i][1])||0,y:parseFloat(extras[i+1][1])||0});
    }
    for(let i=0;i<cpts.length-1;i++)
      result.push({type:'sen',x1:cpts[i].x,y1:cpts[i].y,x2:cpts[i+1].x,y2:cpts[i+1].y,color,dash,layer,lw});
  } else if(type==='LEADER'){
    const lpts=[];
    for(let i=0;i<extras.length-1;i++){
      if(extras[i][0]===10&&extras[i+1][0]===20)
        lpts.push({x:parseFloat(extras[i][1])||0,y:parseFloat(extras[i+1][1])||0});
    }
    for(let i=0;i<lpts.length-1;i++)
      result.push({type:'sen',x1:lpts[i].x,y1:lpts[i].y,x2:lpts[i+1].x,y2:lpts[i+1].y,color,dash,layer,lw});
  } else if(type==='INSERT'){
    if(depth<12){
      const bname=gv(2,'')||'';
      const ix=gf(10),iy=gf(20);
      const sx=gf(41,1)||1,sy=gf(42,1)||1;
      const rot=gf(50,0)*Math.PI/180;
      const block=blockMap[bname];
      if(block){
        const cos=Math.cos(rot),sin=Math.sin(rot);
        function transform(x,y){
          const lx=x-block.ox,ly=y-block.oy;
          return {x:ix+lx*sx*cos-ly*sy*sin,y:iy+lx*sx*sin+ly*sy*cos};
        }
        for(const e of block.ents){
          const ne=JSON.parse(JSON.stringify(e));
          if(ne.type==='sen'){
            const p1=transform(ne.x1,ne.y1),p2=transform(ne.x2,ne.y2);
            ne.x1=p1.x;ne.y1=p1.y;ne.x2=p2.x;ne.y2=p2.y;
          } else if(ne.type==='enko'){
            const p=transform(ne.cx,ne.cy);
            ne.cx=p.x;ne.cy=p.y;ne.rx*=sx;ne.ry*=sy;ne.r*=sx;ne.tilt+=rot*180/Math.PI;
          } else if(ne.type==='ten'||ne.type==='moji'){
            const p=transform(ne.x,ne.y);ne.x=p.x;ne.y=p.y;
          } else if(ne.type==='solid'){
            ne.pts=ne.pts.map(pt=>{const p=transform(pt.x,pt.y);return{x:p.x,y:p.y};});
          }
          result.push(ne);
        }
      }
    }
  } else if(type==='DIMENSION'){
    const bname=gv(2,'')||'';
    if(bname&&blockMap[bname]&&depth<12){
      for(const e of blockMap[bname].ents) result.push(JSON.parse(JSON.stringify(e)));
    }
  }
  return result;
}

// =========================================================
// スケッチ滑らか化ヘルパー
// =========================================================
function smoothPath(ctx,pts){
  if(!pts||pts.length<2){return;}
  if(pts.length===2){
    ctx.moveTo(pts[0].x,pts[0].y);
    ctx.lineTo(pts[1].x,pts[1].y);
    return;
  }
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++){
    const mx=(pts[i].x+pts[i+1].x)/2;
    const my=(pts[i].y+pts[i+1].y)/2;
    ctx.quadraticCurveTo(pts[i].x,pts[i].y,mx,my);
  }
  const last=pts[pts.length-1];
  ctx.lineTo(last.x,last.y);
}

// =========================================================
// ワールド <-> スクリーン変換
// =========================================================
function w2s(x,y){return [x*scale+tx,-y*scale+ty];}
function s2w(sx,sy){return [(sx-tx)/scale,-(sy-ty)/scale];}
function zoomAt(cx,cy,factor){tx=(tx-cx)*factor+cx;ty=(ty-cy)*factor+cy;scale*=factor;}

function rgbCss(c,darkBg){
  if(bwMode) return '#000';
  if(darkBg&&c.r<20&&c.g<20&&c.b<20) return '#ffffff';
  if(!darkBg&&c.r>235&&c.g>235&&c.b>235) return '#000000';
  return `rgb(${c.r},${c.g},${c.b})`;
}

// =========================================================
// BBox & Fit
// =========================================================
function computeBBox(){
  // V0_74: 非表示レイヤを除外して計算
  let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
  function exp(x,y){if(!isFinite(x)||!isFinite(y))return;if(x<minx)minx=x;if(y<miny)miny=y;if(x>maxx)maxx=x;if(y>maxy)maxy=y;}
  if(doc){
    for(const e of doc.sen){if(!hiddenLayers.has(e.layer)){exp(e.x1,e.y1);exp(e.x2,e.y2);}}
    for(const e of doc.enko){if(!hiddenLayers.has(e.layer)){const r=e.rx||e.r||0;exp(e.cx-r,e.cy-r);exp(e.cx+r,e.cy+r);}}
    for(const e of doc.ten){if(!hiddenLayers.has(e.layer)){exp(e.x,e.y);}}
    for(const e of doc.moji){if(!hiddenLayers.has(e.layer)){exp(e.x,e.y);}}
    for(const e of doc.solid){if(!hiddenLayers.has(e.layer)){for(const p of e.pts)exp(p.x,p.y);}}
  }
  if(pdfImage){exp(pdfImage.wx,pdfImage.wy);exp(pdfImage.wx+pdfImage.ww,pdfImage.wy-pdfImage.wh);}
  for(const img of images){exp(img.wx,img.wy);exp(img.wx+img.ww,img.wy-img.wh);}
  const dpr=window.devicePixelRatio||1;
  if(!isFinite(minx)) return {minx:0,miny:0,maxx:cv.width/dpr,maxy:cv.height/dpr};
  return {minx,miny,maxx,maxy};
}

// =========================================================
// スナップキャッシュ（DXF読込時に事前計算）
// =========================================================
function buildSnapCache(){
  _scEndPts=[];_scMidPts=[];_scCenPts=[];
  if(!doc) return;
  for(const e of doc.sen){
    _scEndPts.push({x:e.x1,y:e.y1,layer:e.layer});
    _scEndPts.push({x:e.x2,y:e.y2,layer:e.layer});
    _scMidPts.push({x:(e.x1+e.x2)/2,y:(e.y1+e.y2)/2,layer:e.layer});
  }
  for(const e of doc.enko){
    _scCenPts.push({x:e.cx,y:e.cy,layer:e.layer});
    _scEndPts.push({x:e.cx+e.r*Math.cos(e.a1*Math.PI/180),y:e.cy+e.r*Math.sin(e.a1*Math.PI/180),layer:e.layer});
    _scEndPts.push({x:e.cx+e.r*Math.cos(e.a2*Math.PI/180),y:e.cy+e.r*Math.sin(e.a2*Math.PI/180),layer:e.layer});
    const am=(e.a1+e.a2)/2;
    _scMidPts.push({x:e.cx+e.r*Math.cos(am*Math.PI/180),y:e.cy+e.r*Math.sin(am*Math.PI/180),layer:e.layer});
  }
  // X座標でソート → 二分探索で高速範囲絞り込み
  _scEndPts.sort((a,b)=>a.x-b.x);
  _scMidPts.sort((a,b)=>a.x-b.x);
  _scCenPts.sort((a,b)=>a.x-b.x);
}
function checkPerfMode(){
  if(!doc){perfMode=false;return;}
  const n=doc.sen.length+doc.enko.length;
  perfMode=(n>PERF_THRESHOLD);
  if(perfMode) console.log('[PerfMode] 軽量モード ON: '+n+' 要素');
}

function fit(){
  // V0_74: CSS pixel基準に修正（dpr対応）、5%余白、非表示レイヤ除外済みBBox使用
  const bb=computeBBox();
  const dpr=window.devicePixelRatio||1;
  const W=cv.width/dpr, H=cv.height/dpr; // CSS pixels
  const dw=bb.maxx-bb.minx,dh=bb.maxy-bb.miny;
  if(dw<1e-10||dh<1e-10){scale=1;tx=W/2;ty=H/2;return;}
  const margin=0.05; // 5%余白
  const s=Math.min(W*(1-2*margin)/dw,H*(1-2*margin)/dh);
  scale=s;
  fitScale=s; // V0_83: 全体表示時のscaleを保存
  tx=W/2-((bb.minx+bb.maxx)/2)*s;
  ty=H/2+((bb.miny+bb.maxy)/2)*s;
}

// =========================================================
// 描画
// =========================================================
function scheduleDraw(){needDraw=true;needOverlay=true;needAnnotation=true;if(!rafId)rafId=requestAnimationFrame(rafLoop);}
function scheduleOverlay(){needOverlay=true;needAnnotation=true;if(!rafId)rafId=requestAnimationFrame(rafLoop);}
function scheduleAnnotation(){needAnnotation=true;if(!rafId)rafId=requestAnimationFrame(rafLoop);}
function rafLoop(){
  rafId=null;
  if(needDraw){draw();needDraw=false;}
  if(needAnnotation&&typeof drawAnnotation==='function'){drawAnnotation();needAnnotation=false;}
  if(needOverlay){drawOverlay();needOverlay=false;}
  // V0_150: サブ窓 - メイン表示が更新されるたびにサブ窓も自動的に再描画（双方向リアルタイム同期）
  if(typeof window._renderAllSubWindows==='function') window._renderAllSubWindows();
}

function draw(){
  const dpr=window.devicePixelRatio||1;
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.save();
  ctx.scale(dpr,dpr);
  const W=cv.width/dpr, H=cv.height/dpr;
  const darkBg=!bwMode;
  // V1_60: PDF表示時は白/黒背景切替(bwMode)の影響を受けず常に濃色背景にする。
  // PDF自体が白いページとして描画されるため、白背景モードのままだとページの
  // 余白と背景が同化して「余白が無限」に見えてしまっていた
  ctx.fillStyle=(bwMode&&!pdfImage)?'#ffffff':'#1e2430';
  ctx.fillRect(0,0,W,H);
  if(!doc&&!pdfImage){ctx.restore();return;}
  if(pdfImage){
    const[sx,sy]=w2s(pdfImage.wx,pdfImage.wy);
    ctx.drawImage(pdfImage.img,sx,sy,pdfImage.ww*scale,pdfImage.wh*scale);
    // V1_85: 現在の表示(このdraw()がメイン画面/サブ窓のどちらであっても)を踏まえて、
    // ズーム倍率に対して解像度が不足していないか・表示範囲が現在のタイル内に収まっているかを
    // デバウンス付きで確認する。実際の再レンダリングは操作が落ち着いてから1回だけ行われる
    if(typeof _pdfScheduleResRefresh==='function') _pdfScheduleResRefresh();
  }
  if(!doc){ctx.restore();return;}
  const mg=60; // ビューポート余白px
  // Solids（V0_119: ビューポートカリング追加）
  for(const e of doc.solid){
    if(hiddenLayers.has(e.layer)) continue;
    const pts=e.pts.filter(p=>isFinite(p.x)&&isFinite(p.y));
    if(pts.length<3) continue;
    let _sxMn=Infinity,_syMn=Infinity,_sxMx=-Infinity,_syMx=-Infinity;
    for(const _p of pts){const _sx=_p.x*scale+tx,_sy=-_p.y*scale+ty;if(_sx<_sxMn)_sxMn=_sx;if(_sx>_sxMx)_sxMx=_sx;if(_sy<_syMn)_syMn=_sy;if(_sy>_syMx)_syMx=_sy;}
    if(_sxMx<-mg||_sxMn>W+mg||_syMx<-mg||_syMn>H+mg) continue;
    ctx.beginPath();
    const[sx0,sy0]=w2s(pts[0].x,pts[0].y);ctx.moveTo(sx0,sy0);
    for(let i=1;i<pts.length;i++){const[sx,sy]=w2s(pts[i].x,pts[i].y);ctx.lineTo(sx,sy);}
    ctx.closePath();
    ctx.fillStyle=bwMode?'#cccccc':rgbCss(e.color,darkBg);ctx.fill();
  }
  // Lines（V0_119: ビューポートカリング + バッチ描画）
  // 同一スタイル（色・線幅・破線）でグループ化し beginPath/stroke 回数を大幅削減
  {
    const _senBatch=new Map();
    for(const e of doc.sen){
      if(hiddenLayers.has(e.layer)) continue;
      const sx1=e.x1*scale+tx,sy1=-e.y1*scale+ty;
      const sx2=e.x2*scale+tx,sy2=-e.y2*scale+ty;
      if(Math.max(sx1,sx2)<-mg||Math.min(sx1,sx2)>W+mg||Math.max(sy1,sy2)<-mg||Math.min(sy1,sy2)>H+mg) continue;
      const _style=bwMode?'#000000':rgbCss(e.color,darkBg);
      const _lw=Math.max(0.8,e.lw*scale*1.4);
      const _dash=e.dash&&e.dash.length>0?e.dash:[];
      const _key=_style+'|'+_lw.toFixed(2)+'|'+(_dash.length>0?_dash.join(','):'');
      let _g=_senBatch.get(_key);
      if(!_g){_g={style:_style,lw:_lw,dash:_dash,pts:[]};_senBatch.set(_key,_g);}
      _g.pts.push(sx1,sy1,sx2,sy2);
    }
    for(const _g of _senBatch.values()){
      ctx.beginPath();
      ctx.strokeStyle=_g.style;ctx.lineWidth=_g.lw;
      ctx.setLineDash(_g.dash.length>0?_g.dash.map(d=>d*scale):[]);
      for(let _i=0;_i<_g.pts.length;_i+=4){ctx.moveTo(_g.pts[_i],_g.pts[_i+1]);ctx.lineTo(_g.pts[_i+2],_g.pts[_i+3]);}
      ctx.stroke();
    }
  }
  // Arcs（ビューポートカリング: 外接矩形で判定）
  // V1_102: 操作中(_interacting)は、画面上でSMALL_ARC_SKIP_PX px未満にしか
  // 映らない小さい円/円弧(ボルト穴など)の描画を省略し、操作停止後に復元する
  for(const e of doc.enko){
    if(hiddenLayers.has(e.layer)) continue;
    const scx=e.cx*scale+tx,scy=-e.cy*scale+ty,sr2=e.r*scale;
    if(scx+sr2<-mg||scx-sr2>W+mg||scy+sr2<-mg||scy-sr2>H+mg) continue;
    if(_interacting&&sr2<SMALL_ARC_SKIP_PX) continue;
    ctx.beginPath();
    ctx.strokeStyle=bwMode?'#000000':rgbCss(e.color,darkBg);
    ctx.lineWidth=Math.max(0.8,e.lw*scale*1.4);
    ctx.setLineDash(e.dash&&e.dash.length>0?e.dash.map(d=>d*scale):[]);
    drawArc(ctx,e);ctx.stroke();
  }
  ctx.setLineDash([]);
  // Points（ビューポートカリング）
  // V1_102: 操作中は点要素の描画も省略し、操作停止後に復元する
  if(!_interacting) for(const e of doc.ten){
    if(hiddenLayers.has(e.layer)) continue;
    const sxt=e.x*scale+tx,syt=-e.y*scale+ty;
    if(sxt<-mg||sxt>W+mg||syt<-mg||syt>H+mg) continue;
    ctx.beginPath();ctx.arc(sxt,syt,3,0,Math.PI*2);
    ctx.fillStyle=bwMode?'#000000':rgbCss(e.color,darkBg);ctx.fill();
  }
  // Text（ビューポートカリング）
  // V1_102: 操作中(_interacting)は文字描画(ctx.fillText・フォント切替)を省略し、
  // 操作停止後に復元する。文字は1要素あたりの描画コストが高く、かつ高速な
  // ズーム・パン中はどのみち読み取れないため、省略による視覚的な影響は小さい
  if(!_interacting) for(const e of doc.moji){
    if(hiddenLayers.has(e.layer)) continue;
    const sxm=e.x*scale+tx,sym=-e.y*scale+ty,fsm=Math.max(6,e.h*scale);
    if(sxm<-200||sxm>W+200||sym<-fsm*2-20||sym>H+200) continue;
    drawText(ctx,e,darkBg);
  }
  ctx.restore();
}

function drawArc(ctx,e){
  const[sx,sy]=w2s(e.cx,e.cy);
  if(Math.abs(e.tilt)<0.01&&Math.abs(e.rx-e.ry)<0.01){
    const rs=e.r*scale;
    if(Math.abs(e.a2-e.a1-360)<0.01||(e.a1===0&&e.a2===360)){
      ctx.arc(sx,sy,rs,0,Math.PI*2);
    } else {
      const a1=e.a1*Math.PI/180,a2=e.a2*Math.PI/180;
      ctx.arc(sx,sy,rs,-a1,-a2,true);
    }
  } else {
    ctx.save();ctx.translate(sx,sy);ctx.rotate(-e.tilt*Math.PI/180);
    const rx=e.rx*scale,ry=e.ry*scale;
    let a1=e.a1*Math.PI/180,a2=e.a2*Math.PI/180;
    if(Math.abs(e.a2-e.a1-360)<0.01) a2=a1+Math.PI*2;
    ctx.ellipse(0,0,rx,ry,0,-a1,-a2,true);
    ctx.restore();
  }
}

function drawText(ctx,e,darkBg){
  if(!e.text||!e.text.trim()) return;
  const[sx,sy]=w2s(e.x,e.y);
  const fs=Math.max(6,e.h*scale);
  ctx.save();
  ctx.translate(sx,sy);ctx.rotate(-e.angle*Math.PI/180);
  if(e.widthFactor&&Math.abs(e.widthFactor-1)>0.01) ctx.scale(e.widthFactor,1);
  ctx.font=`${fs}px sans-serif`;
  ctx.fillStyle=bwMode?'#000000':rgbCss(e.color,darkBg);
  ctx.textBaseline='alphabetic';
  const lines=e.text.split('\n');
  for(let i=0;i<lines.length;i++) ctx.fillText(lines[i],0,-fs*i);
  ctx.restore();
}

function detectScale(){}

// =========================================================
// 情報表示・レイヤモーダル
// =========================================================
function showInfo(){
  if(!doc){document.getElementById('infoBox').textContent='ファイルを開いてください';return;}
  document.getElementById('infoBox').innerHTML=
    `線:${doc.sen.length} 円弧:${doc.enko.length}<br>文字:${doc.moji.length} 点:${doc.ten.length}<br>ソリッド:${doc.solid.length}<br>レイヤ:${Object.keys(doc.layerMap).length}<br>Ver:${doc.ver||'不明'}`;
}

// buildLayerModal → layer.js

// =========================================================
// PDF表示
// =========================================================
// V1_88: 第2引数startPageに1以上のページ番号を渡すと、そのページを開いた状態にする。
// 「検索してファイルを開く」で図面内の文字が見つかったページへ直接ジャンプするために追加。
// 省略時・範囲外の値の場合は従来通り1ページ目を開く（fileInput等の通常オープンは無指定のまま）
async function loadPDF(buf,startPage){
  if(typeof pdfjsLib==='undefined'){alert('PDF.jsが読み込まれていません');return;}
  // V1_52: pdf.jsはWorkerへdata(ArrayBuffer)をTransferable(ゼロコピー転送)で渡すため、
  // getDocument()呼び出し後は呼び出し元が保持している元のbuf(ArrayBuffer)が
  // detach（byteLength=0）される。呼び出し元(fileInput/openDxfFromDb/tryRestore等)は
  // loadPDF(buf)実行後もbuf.byteLengthの参照やIndexedDBへの保存にbufを使い続けて
  // いるため、コピー(slice(0))を渡してdetachの影響が元のbufに及ばないようにする
  pdfDoc=await pdfjsLib.getDocument({data:buf.slice(0)}).promise;
  document.getElementById('pdfPageCtrl').style.display='';
  pdfPageNum=(startPage&&startPage>=1&&startPage<=pdfDoc.numPages)?Math.floor(startPage):1;
  document.getElementById('pageInfo').textContent=`${pdfPageNum}/${pdfDoc.numPages}`;
  await renderPdfPage(pdfPageNum);
}

async function renderPdfPage(n){
  if(!pdfDoc) return;
  // V1_85: ページ切替時は、進行中の高解像度再レンダリングのタイマーを破棄する
  // (古いページ/ファイルに対する再レンダリングが後から実行されるのを防ぐ)
  if(_pdfRerenderTimer){clearTimeout(_pdfRerenderTimer);_pdfRerenderTimer=null;}
  const page=await pdfDoc.getPage(n);
  const vp=page.getViewport({scale:PDF_BASE_SCALE});
  const offscreen=document.createElement('canvas');
  offscreen.width=vp.width;offscreen.height=vp.height;
  await page.render({canvasContext:offscreen.getContext('2d'),viewport:vp}).promise;
  pdfImage={img:offscreen,wx:0,wy:vp.height/PDF_BASE_SCALE,ww:vp.width/PDF_BASE_SCALE,wh:vp.height/PDF_BASE_SCALE};
  // V1_51: 画面検索・テキスト読込用に、このページのテキストをワールド座標付きで抽出する。
  // PDFのテキスト位置(getTextContent)はPDFページのデフォルトのポイント単位(scale=1相当)で
  // 得られ、pdfImageのワールド座標(wx=0,wy=vp.height/3=ページ高さ)と同じ単位・原点
  // （左下原点・Y上向き）のため、追加の座標変換なしでそのままワールド座標として使える
  // V1_81: ↑この前提は/Rotateが付いていない（回転0度の）PDFでのみ成立する。
  // /Rotate 90/180/270が付与されたPDF（実寸法師3D等のプロッタ出力でよく見られる）では、
  // getTextContent()の座標は回転前の生のPDFユーザー空間のままなのに対し、pdfImageは
  // vp（回転込みのgetViewport）で描画されるため幅と高さが入れ替わり、テキスト位置が
  // 画像とずれて画面検索・テキスト読込が機能しなくなっていた。vpを渡し、実際にrenderPdfPage()
  // で使ったviewportと同じ変換をテキスト側にも適用することでこのずれを解消する
  pdfMoji=await _pdfPageTextItems(page,vp);
  fit();scheduleDraw();
  if(typeof buildSearchIndex==='function') buildSearchIndex();
  if(typeof scheduleOverlay==='function') scheduleOverlay();
}

// V1_51: PDF 1ページ分のテキストを、doc.moji相当の形状 {text,x,y,h,angle,widthFactor} の
// 配列に変換する。取得に失敗した場合は空配列を返す（画像のみのスキャンPDF等）
// V1_81: 第2引数viewportに、実際にpdfImageを描画したgetViewport()の戻り値を渡すことで、
// ページに/Rotateが付いていても画像とテキスト位置の対応が取れるようにした。
// 呼び出し元がviewportを渡さない場合（フォルダインデックス作成・タブ復元時の再抽出など、
// 文字列のみ必要で位置は使わない箇所）は、renderPdfPage()と同じ基準解像度で自前生成する
// V1_85: 固定のscale:3で割っていた箇所を、実際に使われたviewport自身のscale(vp.scale)で
// 割るように修正。ズーム倍率に応じた解像度可変レンダリング(_pdfRenderVisibleTile)により、
// 渡されるviewportのscaleがPDF_BASE_SCALE以外の値になる場合があるため
// V1_87: PDFによっては、1文字ずつ個別のTj命令で描画されている（Excel等からのPDF出力で
// 太字セルなどによく見られる）ため、pdf.js自身が同じ単語として結合してくれず、
// 「C1」が「C」と「1」の2つの要素に分かれてしまい、テキスト読込で1回のタップで
// 「C1」とまとめて読み込めない不具合があった。取得した文字要素を並び順に走査し、
// 高さ(フォントサイズ)がほぼ同じ・同じ行（垂直方向のずれが小さい）・すき間がほぼ無い
// （前の文字の右端と次の文字の左端がほぼ接している）場合にひとつの単語として結合する。
// 間に空白のみの要素(スペース)があれば単語の区切りとして結合しない（従来通り除去）
async function _pdfPageTextItems(page,viewport){
  try{
    var tc=await page.getTextContent();
    var vp=viewport||page.getViewport({scale:PDF_BASE_SCALE});
    var s=vp.scale||PDF_BASE_SCALE;
    var raw=[];
    tc.items.forEach(function(it){
      var rawText=it.str||'';
      var t=rawText.trim();
      // V1_81: viewport.transform(回転込み)とitem.transform(回転前の生座標)を
      // 合成し、実際にcanvasへ描画された位置（vpと同じピクセル空間）を求める。
      // その後 /s でviewportのscaleを打ち消し、Y軸をワールド座標(左下原点・Y上向き)に合わせて反転する
      var tr=pdfjsLib.Util.transform(vp.transform,it.transform);
      var hRawDevice=Math.hypot(tr[2],tr[3])||Math.hypot(tr[0],tr[1]);
      var h=hRawDevice?hRawDevice/s:10; // フォールバックは元々のワールド単位換算値(10)のまま
      // V1_87: 文字の幅(it.width)も高さと同じ比率でデバイス座標系に変換し、
      // 前の文字の右端と次の文字の左端のすき間(gap)を判定できるようにする
      var rawFontSize=Math.hypot(it.transform[2],it.transform[3])||Math.hypot(it.transform[0],it.transform[1])||h||1;
      var w=(it.width||0)*(h/rawFontSize);
      if(!t){ raw.push(null); return; } // 空白のみの要素は単語の区切りを示す目印として残す
      raw.push({text:t,x:tr[4]/s,y:(vp.height-tr[5])/s,h:h,w:w});
    });
    var arr=[];
    var cur=null;
    function flush(){
      if(cur) arr.push({text:cur.text,x:cur.x,y:cur.y,h:cur.h,angle:0,widthFactor:1});
      cur=null;
    }
    raw.forEach(function(it){
      if(!it){ flush(); return; } // 空白要素＝単語の区切り。現在の単語を確定して次へ
      if(cur){
        var maxH=Math.max(cur.h,it.h), minH=Math.min(cur.h,it.h);
        var sameH=minH>0&&(maxH/minH)<1.2; // フォントサイズがほぼ同じ(20%以内の差)
        var sameRow=Math.abs(it.y-cur.y)<maxH*0.35; // 縦方向のずれが小さい＝同じ行
        var gap=it.x-cur.endX; // 前の文字の右端から次の文字の左端までのすき間
        var closeGap=gap>-maxH*0.6&&gap<maxH*0.6; // すき間がほぼ無い(重なりも軽微な隙間も許容)
        if(sameH&&sameRow&&closeGap){
          cur.text+=it.text;
          cur.endX=it.x+it.w;
          if(it.h>cur.h) cur.h=it.h;
          return;
        }
        flush();
      }
      cur={text:it.text,x:it.x,y:it.y,h:it.h,endX:it.x+it.w};
    });
    flush();
    return arr;
  }catch(e){ console.warn('[PDF文字抽出]',e); return []; }
}

// ─ V1_85: PDFの解像度をズーム倍率に応じて上げ、再レンダリングは表示範囲のみに絞る ─────

// 現在のpdfImageが実際に描画されている解像度(画像px/世界単位)をpdfImage自体から逆算する
function _pdfImgCurrentScale(){
  if(!pdfImage||!pdfImage.img||!pdfImage.ww) return 0;
  return pdfImage.img.width/pdfImage.ww;
}
// 現在のpdfImageが覆っている世界座標の範囲をpdfImage自体から逆算する
function _pdfImgCurrentRect(){
  if(!pdfImage) return null;
  return {x0:pdfImage.wx,y0:pdfImage.wy-pdfImage.wh,x1:pdfImage.wx+pdfImage.ww,y1:pdfImage.wy};
}

// メイン画面＋開いている全サブ窓(PDFは同一ファイルを別倍率で表示するだけ)の表示範囲(世界座標)を
// 1つの矩形にまとめ、必要な再レンダリング解像度とあわせて返す。表示中の範囲が無ければnull
function _pdfNeededRectAndScale(pageRawW,pageRawH){
  if(!cv) return null;
  var dpr=window.devicePixelRatio||1;
  var views=[{txv:tx,tyv:ty,scalev:scale,cw:cv.width/dpr,ch:cv.height/dpr}];
  if(typeof subWindows!=='undefined'&&subWindows){
    subWindows.forEach(function(sw){
      if(sw&&sw.scale&&sw.W&&sw.H) views.push({txv:sw.tx,tyv:sw.ty,scalev:sw.scale,cw:sw.W,ch:sw.H});
    });
  }
  var x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,maxScale=0;
  views.forEach(function(v){
    if(!v.scalev||!v.cw||!v.ch) return;
    var wx0=(0-v.txv)/v.scalev, wx1=(v.cw-v.txv)/v.scalev;
    var wyA=-(0-v.tyv)/v.scalev, wyB=-(v.ch-v.tyv)/v.scalev;
    x0=Math.min(x0,wx0,wx1); x1=Math.max(x1,wx0,wx1);
    y0=Math.min(y0,wyA,wyB); y1=Math.max(y1,wyA,wyB);
    if(v.scalev>maxScale) maxScale=v.scalev;
  });
  if(!isFinite(x0)||maxScale<=0) return null;
  x0=Math.max(0,x0); y0=Math.max(0,y0);
  x1=Math.min(pageRawW,x1); y1=Math.min(pageRawH,y1);
  if(x1<=x0||y1<=y0) return null;
  // 余白を追加してから再度ページ範囲へクリップ（少しのパンでは再レンダリングせずに済むように）
  var mw=(x1-x0)*PDF_ZOOM_MARGIN, mh=(y1-y0)*PDF_ZOOM_MARGIN;
  x0=Math.max(0,x0-mw); x1=Math.min(pageRawW,x1+mw);
  y0=Math.max(0,y0-mh); y1=Math.min(pageRawH,y1+mh);
  // dpr込みで実際に必要な解像度を求め、少し余裕(1.15倍)を持たせて上限内に収める
  var targetScale=Math.min(PDF_MAX_RENDER_SCALE,Math.max(PDF_BASE_SCALE,maxScale*dpr*1.15));
  // タイルの画素数が上限を超える場合は解像度を落として収める(範囲が広い時の暴走防止)
  var tileW=(x1-x0)*targetScale, tileH=(y1-y0)*targetScale;
  if(tileW*tileH>PDF_MAX_TILE_PIXELS){
    var shrink=Math.sqrt(PDF_MAX_TILE_PIXELS/(tileW*tileH));
    targetScale=Math.max(PDF_BASE_SCALE,targetScale*shrink);
  }
  return {rect:{x0:x0,y0:y0,x1:x1,y1:y1},targetScale:targetScale};
}

// 現在のpdfImage(解像度・範囲)に対して、必要な範囲・解像度(needed)が不足しているか判定する
function _pdfNeedsRerender(needed,curScale,curRect){
  if(!curRect||!curScale) return true;
  var covers=needed.rect.x0>=curRect.x0-0.5 && needed.rect.x1<=curRect.x1+0.5
           && needed.rect.y0>=curRect.y0-0.5 && needed.rect.y1<=curRect.y1+0.5;
  if(!covers) return true; // 表示範囲が現在のタイル外に出た(パン等)
  if(needed.targetScale>curScale*PDF_RERENDER_UP_RATIO) return true; // 解像度不足(ズームイン等)
  return false;
}

// 指定した世界座標範囲(rect)だけを、指定した解像度(targetScale)で再レンダリングし、pdfImageを
// 差し替える。pdf.jsのtransformオプションでページ全体のレンダリングを平行移動し、必要な範囲の
// ピクセルだけが小さいcanvasに収まるようにする（ページ全体を高解像度で作り直すことを避けるため）
async function _pdfRenderVisibleTile(page,rect,targetScale,curPdfDoc,curPageNum,pageRawH){
  var s=Math.min(PDF_MAX_RENDER_SCALE,Math.max(PDF_BASE_SCALE,targetScale));
  var fullVp=page.getViewport({scale:s});
  // 端数ピクセルのまま平行移動すると、再レンダリングの度に内容がサブピクセル単位で
  // わずかに揺れて見えることがあるため、デバイスピクセル境界に丸めてから使う
  var px0=Math.round(rect.x0*s), px1=Math.round(rect.x1*s);
  var py0=Math.round((pageRawH-rect.y1)*s), py1=Math.round((pageRawH-rect.y0)*s);
  var cw=Math.max(1,px1-px0), ch=Math.max(1,py1-py0);
  var tileCanvas=document.createElement('canvas');
  tileCanvas.width=cw; tileCanvas.height=ch;
  await page.render({canvasContext:tileCanvas.getContext('2d'),viewport:fullVp,transform:[1,0,0,1,-px0,-py0]}).promise;
  // レンダリング完了時点でタブ切替・ページ送りが起きていたら、古い結果は反映しない
  if(pdfDoc!==curPdfDoc||pdfPageNum!==curPageNum) return;
  pdfImage={img:tileCanvas,wx:rect.x0,wy:rect.y1,ww:rect.x1-rect.x0,wh:rect.y1-rect.y0};
  scheduleDraw();
}

// 現在の表示範囲・ズーム倍率を確認し、必要なら表示範囲だけを高解像度で再レンダリングする
async function _pdfCheckAndRefresh(){
  if(!pdfDoc||_pdfRerenderBusy) return;
  var curPdfDoc=pdfDoc, curPageNum=pdfPageNum, page;
  try{ page=await curPdfDoc.getPage(curPageNum); }catch(e){ return; }
  if(pdfDoc!==curPdfDoc||pdfPageNum!==curPageNum) return; // 待っている間にタブ/ページが変わっていたら中止
  var rawVp=page.getViewport({scale:1});
  var needed=_pdfNeededRectAndScale(rawVp.width,rawVp.height);
  if(!needed) return;
  if(!_pdfNeedsRerender(needed,_pdfImgCurrentScale(),_pdfImgCurrentRect())) return;
  _pdfRerenderBusy=true;
  try{
    await _pdfRenderVisibleTile(page,needed.rect,needed.targetScale,curPdfDoc,curPageNum,rawVp.height);
  }catch(e){ console.warn('[PDF高解像度再レンダリング]',e); }
  finally{ _pdfRerenderBusy=false; }
}

// V1_85: draw()から毎フレーム呼ばれるが、実際のチェック・再レンダリングはズーム/パン操作が
// 落ち着いてから(PDF_RERENDER_DEBOUNCE_MS後)にまとめて1回だけ行うようデバウンスする
function _pdfScheduleResRefresh(){
  if(!pdfDoc) return;
  if(_pdfRerenderTimer) clearTimeout(_pdfRerenderTimer);
  _pdfRerenderTimer=setTimeout(function(){
    _pdfRerenderTimer=null;
    _pdfCheckAndRefresh();
  },PDF_RERENDER_DEBOUNCE_MS);
}

// V1_51: フォルダインデックス用途。PDF全ページの文字列一覧を返す
// V1_88: 「検索してファイルを開く」で一致した文字がどのページにあるかへジャンプできるよう、
// 各文字列にページ番号(page)も付与した{text,page}形式で返すようにした（従来はtextのみの配列）。
// 呼び出し側(doAllSearch/doOpenFileSearch)は_idxTextOf()でtext部分だけ取り出して比較する
async function extractAllPdfTexts(pdfDocObj){
  var texts=[];
  try{
    for(var i=1;i<=pdfDocObj.numPages;i++){
      var page=await pdfDocObj.getPage(i);
      var items=await _pdfPageTextItems(page);
      items.forEach(function(m){texts.push({text:m.text,page:i});});
    }
  }catch(e){ console.warn('[PDF全ページ文字抽出]',e); }
  return texts;
}

// =========================================================
// V1_76: Excel(.xlsx/.xls/.csv)表示
// シンプルな表形式のみ対応（セル色・結合・罫線・書式は再現しない）。
// PDF/DXFと同様、canvas(cv/ac/ov)は非表示にしてHTMLテーブルへ切り替える。
// =========================================================
// V1_106: isCsv=trueの場合、buf(生バイト)をXLSXへそのまま渡さず、先に文字コードを
// 自動判定(_decodeTextAuto)してから文字列として渡す。.xlsx/.xlsはバイナリ形式で
// エンコーディングの概念が無いため従来通りtype:'array'のまま扱う（CSVのみプレーン
// テキストで文字コードを持つため、Shift-JIS等のCSVがUTF-8前提で文字化けする不具合への対応）
function loadExcel(buf,isCsv){
  if(typeof XLSX==='undefined'){alert('Excel読み込み機能が読み込まれていません');return false;}
  try{
    if(isCsv){
      excelWb=XLSX.read(_decodeTextAuto(buf),{type:'string'});
    } else {
      excelWb=XLSX.read(buf,{type:'array'});
    }
  }catch(e){
    alert('Excelファイルの読み込みに失敗しました: '+(e&&e.message||e));
    excelWb=null;renderExcelView();
    return false;
  }
  excelSheetIdx=0;
  _excelResetViewState(); // V1_111: 新規ファイルオープン時はソート/フィルタ/列幅をリセット
  renderExcelView();
  return true;
}

// フォルダインデックス・全図面検索用途。全シートのセル文字列一覧（重複含む）を返す
// V1_88: 「検索してファイルを開く」で一致した文字がどのシートにあるかへ切り替えられるよう、
// 各文字列にシート番号(sheet)も付与した{text,sheet}形式で返すようにした（従来はtextのみの配列）
function extractAllExcelTexts(wb){
  var texts=[];
  try{
    wb.SheetNames.forEach(function(name,si){
      var ws=wb.Sheets[name];
      if(!ws) return;
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
      rows.forEach(function(row){
        row.forEach(function(cell){
          var t=(cell===null||cell===undefined)?'':String(cell).trim();
          if(t) texts.push({text:t,sheet:si});
        });
      });
    });
  }catch(e){ console.warn('[Excel文字抽出]',e); }
  return texts;
}

// 現在のexcelWb/excelSheetIdxをもとに #excelView 内のシートタブ・テーブルを再構築する。
// excelWbがnullの場合は#excelViewを隠しcanvasを元に戻すだけの役割も兼ねる
// （PDF/DXF側に戻る際は excelWb=null にしてから本関数を呼ぶだけでよい）
// V1_107: Excel/CSV表示中は#viewmemo内の記憶・表示ボタン(mem-btn/show-btn/vm-file)を隠す。
// V1_121: 「全体」ボタン(#fitBtn、DXF/PDFのズームを画面に合わせる機能)はExcel/CSVの
// セル表示には適用できないため、Excel/CSV表示中は非表示にする（マーク送り自体は
// DXF/PDFの文字読込マーク機能のため、そちらは従来通り対象外のまま変更しない）
function _updateViewmemoForExcel(isExcel){
  var els=document.querySelectorAll('#viewmemo .mem-btn, #viewmemo .show-btn, #viewmemo .vm-file');
  els.forEach(function(el){ el.style.display=isExcel?'none':''; });
  var fitBtn=document.getElementById('fitBtn');
  if(fitBtn) fitBtn.style.display=isExcel?'none':'';
}
// V1_110: 文字列が数値として扱えるか判定する（桁区切りカンマ許容）。
// V1_111: ソート比較(_excelCompareVal)と集計行(件数・合計)の両方で共通利用するため関数化した
function _excelIsNumericStr(s){
  var t=(s===null||s===undefined)?'':String(s).trim();
  if(t==='') return false;
  var n=parseFloat(t.replace(/,/g,''));
  return isFinite(n)&&/^-?[\d,]+\.?\d*$/.test(t);
}
function _excelToNum(s){ return parseFloat(String(s).replace(/,/g,'')); }
// V1_110: Excel/CSVテーブルの列ソート用の値比較。両方が数値として解釈できれば数値比較、
// それ以外は日本語ロケールでの文字列比較（濁点・長音・全角半角混在などを自然な順序で扱う）
function _excelCompareVal(a,b){
  var sa=(a===null||a===undefined)?'':String(a), sb=(b===null||b===undefined)?'':String(b);
  var aNum=_excelIsNumericStr(sa), bNum=_excelIsNumericStr(sb);
  if(aNum&&bNum) return _excelToNum(sa)-_excelToNum(sb);
  return sa.localeCompare(sb,'ja');
}
// V1_114: 列番号(0始まり)をExcel風のアルファベット(A,B,...,Z,AA,AB,...)に変換する
function _excelColLetter(idx){
  var s='',n=idx+1;
  while(n>0){
    var rem=(n-1)%26;
    s=String.fromCharCode(65+rem)+s;
    n=Math.floor((n-1)/26);
  }
  return s;
}
// V1_115: 4分割テーブル(上左/上右/下左/下右)から、セルを走査する処理(検索・ハイライト等)が
// 共通で使えるよう、実在する4テーブルの配列を返す
function _excelAllCellTables(){
  return ['excelTopLeftTable','excelTopRightTable','excelBottomLeftTable','excelBottomRightTable']
    .map(function(id){return document.getElementById(id);}).filter(Boolean);
}
// V1_115: ヘッダーツールバーの「ペン〜サブ窓」ツール群(dxfToolGroup)と、
// Excel/CSV専用ツール群(excelToolGroup)を、表示中のデータ種別に応じて入れ替える
function _updateTopbarForExcel(isExcel){
  var dxfGroup=document.getElementById('dxfToolGroup');
  var excelGroup=document.getElementById('excelToolGroup');
  if(dxfGroup) dxfGroup.style.display=isExcel?'none':'contents';
  if(excelGroup) excelGroup.style.display=isExcel?'contents':'none';
  // V1_121: 書込バックアップ(.dxfview書出)はスケッチ・寸法・保存ビューが対象のため、
  // Excel/CSVデータには適用できない。dxfToolGroup/excelToolGroupいずれの外にある
  // 常設ボタンのため、ここで個別に非表示にする
  var writeBackupBtn=document.getElementById('writeBackupBtn');
  if(writeBackupBtn) writeBackupBtn.style.display=isExcel?'none':'';
  // V1_122: ヘッダーの「画面検索」(#searchOverlay)は、Excel/CSV表示中はシート下の
  // 検索欄(#excelFilterBar)と役割が重複し、画面上でも重なって見えるとの指摘のため、
  // Excel/CSV表示中は非表示にする（DXF/PDF表示中は従来通り表示する）
  var searchMenuBtn=document.getElementById('searchMenuBtn');
  if(searchMenuBtn) searchMenuBtn.style.display=isExcel?'none':'';
}
// V1_116: PDF表示中は計測グループ(.dim-group、水・鉛/斜め/2線間/線と点/直径/半径)と
// 画面(白黒切替、#bwToggleBtn)ボタンを非表示にする。ペン・蛍光ペン・消しゴム・戻る/進む・
// サブ窓・計算機等その他のボタンは現状の位置のまま表示を維持するため、dxfToolGroup全体を
// 隠す_updateTopbarForExcelとは別に、この2要素だけを個別にdisplay切替する
function _updateTopbarForPdf(isPdf){
  var dimGroup=document.querySelector('.dim-group');
  var bwBtn=document.getElementById('bwToggleBtn');
  if(dimGroup) dimGroup.style.display=isPdf?'none':'';
  if(bwBtn) bwBtn.style.display=isPdf?'none':'';
}
// V1_115: ソート/固定行列ボタンの押下状態(active表示)・タップ待ちガイド文言・
// タップ対象セルの強調(.excel-pick-armed)をまとめて同期する
function _updateExcelToolbarUI(){
  var sortBtn=document.getElementById('excelSortBtn');
  var freezeBtn=document.getElementById('excelFreezeBtn');
  var rowStripeBtn=document.getElementById('excelRowStripeBtn');
  var colStripeBtn=document.getElementById('excelColStripeBtn');
  var hideBtn=document.getElementById('excelHideBtn'); // V1_121
  var unhideBtn=document.getElementById('excelUnhideBtn'); // V1_121
  var sumBtn=document.getElementById('excelSumBtn'); // V1_122
  if(sortBtn) sortBtn.classList.toggle('active',_excelPickMode==='sort');
  if(freezeBtn) freezeBtn.classList.toggle('active',_excelPickMode==='freeze');
  if(rowStripeBtn) rowStripeBtn.classList.toggle('active',!!_excelRowStripe);
  if(colStripeBtn) colStripeBtn.classList.toggle('active',!!_excelColStripe);
  if(hideBtn) hideBtn.classList.toggle('active',_excelPickMode==='hide');
  if(sumBtn) sumBtn.classList.toggle('active',_excelPickMode==='sum');
  // V1_121: 非表示中の行・列がある間、「表示に戻す」ボタンに件数を表示する
  if(unhideBtn){
    var _hiddenCount121=Object.keys(_excelHiddenRows).length+Object.keys(_excelHiddenCols).length;
    var _cntEl121=unhideBtn.querySelector('.excel-unhide-count');
    if(_cntEl121) _cntEl121.textContent=_hiddenCount121>0?('('+_hiddenCount121+')'):'';
  }
  var wrap=document.getElementById('excelTableWrap');
  if(wrap) wrap.classList.toggle('excel-pick-armed',!!_excelPickMode);
  // V1_125: 非表示/合計ピックモード中は画面下の確定ボタン(#excelConfirmBar)を表示し、
  // 選択件数とボタン文言を都度更新する。それ以外のモードでは隠す
  // V1_127: 合計計算の「結果」を表示している間(_excelConfirmResultActive)は、
  // ピックモードが既にnullに戻っていてもこのバーを隠さない（結果を確認できるように
  // するため）。新しくsort/freeze/hide/sumのいずれかのモードに入った場合のみ
  // 結果表示状態を解除する(_excelClearTransientPickState内で行う)
  var _confirmBar125=document.getElementById('excelConfirmBar');
  if(_confirmBar125){
    if(_excelPickMode==='hide'){
      var _pendCount125=Object.keys(_excelPendingHideRows).length+Object.keys(_excelPendingHideCols).length;
      _confirmBar125.style.display='flex';
      _confirmBar125.classList.remove('excel-confirm-result'); // V1_127: 前回の合計結果表示を解除
      var _cc1=document.getElementById('excelConfirmCount');
      if(_cc1) _cc1.textContent='選択中: '+_pendCount125+'件';
      var _cb1=document.getElementById('excelConfirmBtn');
      if(_cb1) _cb1.textContent='非表示を確定';
    } else if(_excelPickMode==='sum'){
      var _sumSelCount125=Object.keys(_excelSumSelected).length;
      _confirmBar125.style.display='flex';
      _confirmBar125.classList.remove('excel-confirm-result'); // V1_127: 前回の合計結果表示を解除
      var _cc2=document.getElementById('excelConfirmCount');
      if(_cc2) _cc2.textContent='選択中: '+_sumSelCount125+'件';
      var _cb2=document.getElementById('excelConfirmBtn');
      if(_cb2) _cb2.textContent='合計を計算';
    } else if(!_excelConfirmResultActive){
      _confirmBar125.style.display='none';
    }
  }
  if(_excelPickMode==='sort'){
    if(typeof showGuide==='function') showGuide('行を指定して下さい');
  } else if(_excelPickMode==='freeze'){
    if(typeof showGuide==='function') showGuide('固定したい行番号または列アルファベットをタップして下さい');
  } else if(_excelPickMode==='hide'){
    // V1_125: 確定操作を専用ボタン(画面下の確定ボタン)へ変更したことに合わせて文言も更新
    if(typeof showGuide==='function') showGuide('非表示にしたい行番号・列アルファベットを複数タップして選べます（下の「非表示を確定」ボタンで確定）',0);
  } else if(_excelPickMode==='sum'){
    if(typeof showGuide==='function') showGuide('合計したいセルを複数タップして選べます（下の「合計を計算」ボタンで計算）',0);
  } else if(typeof hideGuide==='function'){
    hideGuide();
  }
}
// V1_125: 「非表示」の確定処理。従来hideBtnの2回目押下に直書きしていたロジックを
// 独立関数化し、画面下の確定ボタン(#excelConfirmBtn)からも呼べるようにした
function _excelConfirmHide(){
  Object.keys(_excelPendingHideRows).forEach(function(k){ _excelHiddenRows[k]=true; });
  Object.keys(_excelPendingHideCols).forEach(function(k){ _excelHiddenCols[k]=true; });
  _excelPendingHideRows={};_excelPendingHideCols={};
  _excelPickMode=null;
  renderExcelView(); // 確定時のみ1回だけ全体を再描画する
}
// V1_125: 「合計」の確定処理。従来sumBtnの2回目押下に直書きしていたロジックを
// 独立関数化し、画面下の確定ボタン(#excelConfirmBtn)からも呼べるようにした
function _excelConfirmSum(){
  var total=0,numCount=0,selCount=0;
  for(var k in _excelSumSelected){
    selCount++;
    var raw=_excelSumSelected[k].v;
    if(typeof _excelIsNumericStr==='function'&&_excelIsNumericStr(raw)){
      total+=_excelToNum(raw);
      numCount++;
    }
  }
  document.querySelectorAll('.excel-sum-selected').forEach(function(el){el.classList.remove('excel-sum-selected');});
  _excelSumSelected={};
  _excelPickMode=null;
  // V1_127: 「合計を合算した数字はどこに出ますか」との指摘への対応。従来は結果を
  // 画面下のガイド(showGuide)だけに小さく出しており、確定ボタン自体が消えると
  // 結果がどこに表示されたのか気づきにくかった。確定ボタンを押したのと同じ場所
  // (#excelConfirmBar)に結果をそのまま表示し続け、ボタンは「閉じる」に切り替える
  _excelConfirmResultActive=true;
  _updateExcelToolbarUI();
  var _resultText127='合計: '+total+'（数値'+numCount+'件 / 選択'+selCount+'件）';
  var _bar127=document.getElementById('excelConfirmBar');
  var _cc127=document.getElementById('excelConfirmCount');
  var _cb127=document.getElementById('excelConfirmBtn');
  if(_bar127){ _bar127.style.display='flex'; _bar127.classList.add('excel-confirm-result'); }
  if(_cc127) _cc127.textContent=_resultText127;
  if(_cb127) _cb127.textContent='閉じる';
}
// V1_115: 行番号セル（左端）を作る。ピックモードに応じて挙動が変わる:
// ・'sort'中: タップした行がソート位置(origIdx基準・データの並び替えに関わらず固定)になる
//   （同じ行の再タップで解除。ソート位置を変えるとソート列・列フィルタもリセットする）
// ・'freeze'中: タップした行が固定行の境界(renderedPos基準・現在の表示順で数えた位置)になる
//   （同じ位置の再タップで解除）
// ・V1_122 'hide'中: タップした行(origIdx基準)を「非表示予定」として複数まとめて仮選択する
//   （全体の再描画はせずクラス切替のみ。確定は「非表示」ボタンの再押下で行う）。ソート位置に
//   指定中の行は非表示にすると見出し行が消えてソート/絞り込み自体が使えなくなるため対象外
// ・ピックモードでない間はタップしても何も起きない（ラベルとしてのみ機能する）
function _excelBuildRowNumCell(rowNumLabel,origIdx,renderedPos,isFrozenTop,isSortRow){
  var td=document.createElement('td');
  td.className='excel-rownum-cell'+(isFrozenTop?' frozen':'')+(_excelPendingHideRows[origIdx]?' excel-pending-hide':'');
  td.textContent=String(rowNumLabel);
  td.title=isSortRow?'ソート位置に指定中':'';
  td.addEventListener('click',function(ev){
    ev.stopPropagation();
    if(_excelPickMode==='sort'){
      _excelSortRowIdx=(_excelSortRowIdx===origIdx)?-1:origIdx;
      _excelSortCol=-1;_excelSortDir=0;_excelColFilters=null;
      _excelPickMode=null;_updateExcelToolbarUI();
      renderExcelView();
    } else if(_excelPickMode==='freeze'){
      _excelFreezeRowIdx=(_excelFreezeRowIdx===renderedPos)?-1:renderedPos;
      _excelPickMode=null;_updateExcelToolbarUI();
      renderExcelView();
    } else if(_excelPickMode==='hide'){
      if(isSortRow){
        if(typeof showGuide==='function') showGuide('見出し行(ソート位置)は非表示にできません',1800);
        return;
      }
      // V1_122: 複数選択できるよう、ここでは仮選択のトグルのみ行い、全体の再描画はしない
      // （大きい表で毎タップごとの再描画が重いとの指摘のため）。確定はhideBtn側で行う
      if(_excelPendingHideRows[origIdx]){ delete _excelPendingHideRows[origIdx]; td.classList.remove('excel-pending-hide'); }
      else { _excelPendingHideRows[origIdx]=true; td.classList.add('excel-pending-hide'); }
      _updateExcelToolbarUI();
    }
  });
  return td;
}
// V1_115: 列アルファベットセルを作る。'freeze'ピックモード中のみタップを受け付け、
// タップした列(0始まり)が固定列の境界になる（同じ列の再タップで解除）
// V1_122: 'hide'ピックモード中はタップした列を「非表示予定」として複数まとめて仮選択する
function _excelBuildLetterCell(colIdx,isFrozenLeft){
  var ltd=document.createElement('td');
  ltd.className='excel-letter-cell'+(isFrozenLeft?' frozen':'')+(_excelPendingHideCols[colIdx]?' excel-pending-hide':'');
  ltd.textContent=_excelColLetter(colIdx);
  ltd.addEventListener('click',function(ev){
    ev.stopPropagation();
    if(_excelPickMode==='freeze'){
      _excelFreezeColIdx=(_excelFreezeColIdx===colIdx)?-1:colIdx;
      _excelPickMode=null;_updateExcelToolbarUI();
      renderExcelView();
    } else if(_excelPickMode==='hide'){
      if(_excelPendingHideCols[colIdx]){ delete _excelPendingHideCols[colIdx]; ltd.classList.remove('excel-pending-hide'); }
      else { _excelPendingHideCols[colIdx]=true; ltd.classList.add('excel-pending-hide'); }
      _updateExcelToolbarUI();
    }
  });
  return ltd;
}
// V1_114由来: 通常の値セルを作る（従来のセルタップ挙動＝ピックモード中は読込、それ以外はガイド表示）
// V1_122: origIdx/colIdxを受け取り、'sum'ピックモード中はセルの複数選択（合計計算対象の
// トグル）に使う。それ以外のモードでは従来通り_excelCellTappedへ委ねる
function _excelBuildDataCell(cellVal,origIdx,colIdx){
  var td=document.createElement('td');
  var _cellText110=(cellVal===null||cellVal===undefined)?'':String(cellVal);
  td.textContent=_cellText110;
  var _sumKey122=origIdx+'_'+colIdx;
  if(_excelSumSelected[_sumKey122]) td.classList.add('excel-sum-selected');
  td.addEventListener('click',function(){
    if(_excelPickMode==='sum'){
      if(_excelSumSelected[_sumKey122]){ delete _excelSumSelected[_sumKey122]; td.classList.remove('excel-sum-selected'); }
      else { _excelSumSelected[_sumKey122]={v:_cellText110}; td.classList.add('excel-sum-selected'); }
      _updateExcelToolbarUI();
      return;
    }
    if(typeof _excelCellTapped==='function') _excelCellTapped(_cellText110);
  });
  return td;
}
// V1_115: 列幅ドラッグ調整用ハンドル。列が左右どちらのパネルに属すかによって、
// 更新対象のテーブル(tableIdA=上, tableIdB=下)とそのcolgroup内でのインデックス(localIdx)が
// 異なるため呼び出し側で指定する。absColIdx(行番号列を含む絶対インデックス)は
// _excelColWidths(手動調整の記憶用配列)の添字に使う
function _excelBuildResizeHandle(absColIdx,localIdx,tableIdA,tableIdB){
  var handle=document.createElement('span');
  handle.className='excel-col-resize-handle';
  handle.addEventListener('pointerdown',function(ev){
    ev.stopPropagation();ev.preventDefault();
    var startX=ev.clientX;
    var tA=document.getElementById(tableIdA),tB=document.getElementById(tableIdB);
    var cg=tA?tA.querySelector('colgroup'):null;
    var cols=cg?cg.querySelectorAll('col'):[];
    var startW=(cols[localIdx]&&parseFloat(cols[localIdx].style.width))||80;
    if(!_excelColWidths) _excelColWidths=[];
    function onMove(mv){
      var dx=mv.clientX-startX;
      var w=Math.max(30,startW+dx);
      _excelColWidths[absColIdx]=w;
      [tA,tB].forEach(function(t){
        if(!t) return;
        var c=t.querySelector('colgroup');
        if(!c) return;
        var col=c.querySelectorAll('col')[localIdx];
        if(col) col.style.width=w+'px';
      });
    }
    function onUp(){
      document.removeEventListener('pointermove',onMove);
      document.removeEventListener('pointerup',onUp);
    }
    document.addEventListener('pointermove',onMove);
    document.addEventListener('pointerup',onUp);
  });
  return handle;
}
// V1_117: 列幅を計測する。V1_115では画面に表示しない隠しテーブル(#excelMeasureTable)へ
// 全行を素のテキストで複製してから計測していたが、これは(1)行数×列数ぶんの
// getBoundingClientRect呼び出しが発生し大きな表で顕著に重くなる、(2)隠しテーブルは
// 実際に表示される4つのテーブルとは別のレイアウト文脈のため、ソートアイコン等の
// 装飾込みの実寸と食い違い、行列ラベルと実セルの位置がずれる、という2つの不具合が
// あった。table-layout:autoの表は「同じ列の全セルが同じ幅になる」ようブラウザが
// 自動調整するため、実際に表示している各テーブルの代表行(最終行で十分)を直接
// 測定すれば、隠しテーブルを使わずに正確な値が得られる。左右パネルそれぞれ、
// 上下2テーブルのうち大きい方を採用する（V1_114の2テーブル計測方式を4テーブルへ拡張）
function _excelMeasurePaneWidths(t1,t2,count){
  var widths=new Array(count).fill(0);
  [t1,t2].forEach(function(t){
    if(!t||!t.rows||t.rows.length===0) return;
    var tr=t.rows[t.rows.length-1];
    var tds=tr.querySelectorAll('td');
    for(var i=0;i<tds.length&&i<count;i++){
      var w=tds[i].getBoundingClientRect().width;
      if(w>widths[i]) widths[i]=w;
    }
  });
  return widths;
}
// V1_117: 左右パネルの列幅をそれぞれ計測し、手動ドラッグ調整済みの列
// (_excelColWidths、index0=行番号列を含む絶対インデックス)があればそちらを優先したうえで、
// 4テーブルへcolgroupとして適用する
function _excelSyncPaneColWidths(topLeftTable,bottomLeftTable,topRightTable,bottomRightTable,leftCount,totalCols){
  var rightCount=totalCols-leftCount;
  var leftWidths=_excelMeasurePaneWidths(topLeftTable,bottomLeftTable,leftCount);
  var rightWidths=_excelMeasurePaneWidths(topRightTable,bottomRightTable,rightCount);
  for(var i=0;i<leftCount;i++){ if(!(leftWidths[i]>0)) leftWidths[i]=(i===0)?40:80; }
  for(var j=0;j<rightCount;j++){ if(!(rightWidths[j]>0)) rightWidths[j]=80; }
  if(_excelColWidths){
    for(var a=0;a<leftCount;a++){ if(_excelColWidths[a]!=null) leftWidths[a]=_excelColWidths[a]; }
    for(var b=0;b<rightCount;b++){ if(_excelColWidths[leftCount+b]!=null) rightWidths[b]=_excelColWidths[leftCount+b]; }
  }
  // V1_132: 「コンテナ幅まで広げる」処理をCSSのmin-width:100%(V1_131)に任せると、
  // 上段(#excelTopRightWrap等、overflow:hiddenでスクロールバーが出ない)と
  // 下段(#excelBottomRightWrap等、overflow:autoで縦スクロールバーが出うる)とでは
  // 各コンテナ自身の実際の幅(clientWidth)がスクロールバー分だけ食い違うため、
  // 100%の解決結果が上下で異なってしまい、その差ぶん列ごとの余白配分がズレて
  // 「一番上のアルファベットと下のセルがずれる」不具合が再発した。そこで
  // 「コンテナ幅まで広げる」判定をCSSではなくJSで1回だけ行い、上下の実際の
  // スクロール担当パネル(#excelBottomLeftWrap/#excelBottomRightWrap)のclientWidthを
  // 基準として、同じpx数値を上下・左右すべてのテーブルへ明示的に適用する
  // （top側は自分のwrapの幅ではなく、常にbottom側を基準にすることで、
  // スクロールバーの有無に関係なく上下で完全に同じ幅になることを保証する）
  var bottomLeftWrap=document.getElementById('excelBottomLeftWrap');
  var bottomRightWrap=document.getElementById('excelBottomRightWrap');
  var leftAvail=bottomLeftWrap?bottomLeftWrap.clientWidth:0;
  var rightAvail=bottomRightWrap?bottomRightWrap.clientWidth:0;
  _excelApplyColgroup(topLeftTable,leftWidths,leftAvail);
  _excelApplyColgroup(bottomLeftTable,leftWidths,leftAvail);
  _excelApplyColgroup(topRightTable,rightWidths,rightAvail);
  _excelApplyColgroup(bottomRightTable,rightWidths,rightAvail);
}
// V1_124: 旧_excelSyncRowHeights(行番号ガターとデータの行高さをJSで実測しコピーする
// 関数)は、index.html側でtdに固定height(box-sizing:border-box)を指定する構造的な
// 修正に切り替えたことで不要と判断し、一旦削除していた。
// V1_128: しかし固定height指定だけでは解決しきれない別種の不具合が判明したため復活
// させる。行番号ガター(左テーブル)とデータ(右テーブル)は別々の<table>要素であり、
// 同じ「height:32px」というCSS指定を与えても、ブラウザの表の高さ計算はtd単位の
// height指定を「最小値」として扱うため、フォントの実際のグリフ・アンチエイリアス
// 描画等に起因するごくわずかな端数(サブピクセル)の違いにより、左右で1行あたり
// 0.0x px単位の食い違いが生じることがある。1行だけなら誤差として気づかないレベル
// でも、行数を重ねるごとに誤差が積み重なり(累積誤差)、行数の多いシートの下の方
// (例：30行目以降)になるほど、行番号・列アルファベットと実データの位置が目に見えて
// ズレていく。V1_117の列幅測定と同じ考え方で、実際にレンダリングされた高さを
// 直接測定し、左右で同じ数値(px)を明示的に書き込むことで、累積誤差が生じる余地
// 自体を無くす。V1_121では全行処理が「読み取りと書き込みを交互に行う」実装だった
// ため、行数ぶんの強制同期レイアウトが発生し大容量ファイルでフリーズする原因に
// なっていたが、今回は「全行分の読み取りを終えてから、まとめて書き込む」よう
// 完全に分離しており、レイアウト再計算は読み取り開始前後・書き込み後の合計数回で
// 済むため、行数が多くても性能上の問題は生じない
function _excelSyncRowHeights(leftTable,rightTable){
  if(!leftTable||!rightTable) return;
  var lRows=leftTable.rows,rRows=rightTable.rows;
  var n=Math.min(lRows.length,rRows.length);
  var i;
  // ①まず全行のインラインheightを一旦クリアする（前回の同期結果を引きずらないため）
  for(i=0;i<n;i++){
    if(lRows[i]) lRows[i].style.height='';
    if(rRows[i]) rRows[i].style.height='';
  }
  // ②全行分をまとめて読み取る（この時点で1回だけレイアウト計算が走る）
  var heights=new Array(n);
  for(i=0;i<n;i++){
    var hl=lRows[i]?lRows[i].getBoundingClientRect().height:0;
    var hr=rRows[i]?rRows[i].getBoundingClientRect().height:0;
    heights[i]=Math.max(hl,hr);
  }
  // ③読み取りが完全に終わってから、まとめて書き込む（読み書きを交互にしない）
  for(i=0;i<n;i++){
    var h=heights[i];
    if(h>0){
      if(lRows[i]) lRows[i].style.height=h+'px';
      if(rRows[i]) rRows[i].style.height=h+'px';
    }
  }
}
function _excelApplyColgroup(table,widths,forceAvailWidth){
  if(!table) return;
  var old=table.querySelector('colgroup'); if(old) old.remove();
  var cg=document.createElement('colgroup');
  var total=0;
  widths.forEach(function(w){
    var col=document.createElement('col');
    col.style.width=w+'px';
    cg.appendChild(col);
    total+=w;
  });
  table.insertBefore(cg,table.firstChild);
  table.style.tableLayout='fixed';
  // V1_130: table-layout:fixed + colgroupだけでは、テーブルの実際の幅(width:auto)は
  // 「コンテナ幅とcolgroup合計幅の大きい方」になるはずだが、#excelTopRightTableの
  // 親(#excelTopRightWrap)はflex:1(flex-basis:0%相当)+overflow:hiddenのflexアイテムであり、
  // コンテナ自体の幅がflexレイアウトにより先に確定してしまう構成では、ブラウザが
  // colgroupの各列幅をコンテナ幅に収まるよう比例縮小して描画することがあった
  // (データ巾が画面幅より広い時、一番上の列アルファベット行だけが1画面に収まる
  // ように圧縮され、その下の実データ行とズレて見える不具合として現れていた)。
  // table自身の width を colgroup合計幅で明示指定することで、テーブルの実サイズを
  // コンテナ幅の制約から完全に切り離し、コンテナ側のoverflow:hidden＋JSによる
  // scrollLeft同期で表示位置だけを合わせる、という本来の設計通りの動作を保証する
  // V1_131: しかしV1_130でwidthをcolgroup合計幅ぴったりに固定した結果、逆に
  // 「データ巾が画面幅より狭い（コンテナの方が広い）」場合に、以前はコンテナの
  // 余った幅ぶんが各列へ均等に配分されて列が少し広がっていた(この余白のおかげで
  // 文字がちょうど収まっていたセルもあった)のに対し、V1_130ではテーブル幅が
  // colgroup合計ぴったりに固定されてしまい、余白配分による“おまけの広がり”が
  // 無くなったため、逆にセルが以前より狭く見え文字が全体表示されなくなる回帰が
  // 生じた。そこでV1_131ではmin-width:100%を追加したが、これは各テーブルの
  // 「親コンテナ自身」の幅に対してCSSが解決するため、上段(overflow:hidden、
  // スクロールバー無し)と下段(overflow:auto、縦スクロールバー有りうる)とで
  // 実際に使える幅がスクロールバーの分だけ食い違い、上下で列幅がズレる別の
  // 不具合を生んでしまった。
  // V1_132: min-width:100%(CSSでの解決)をやめ、呼び出し側(_excelSyncPaneColWidths)
  // で1回だけ測定した共通のpx値(forceAvailWidth。常に下段=実際にスクロールする
  // パネルのclientWidthを基準にする)を受け取り、それとcolgroup合計幅の大きい方を
  // 明示的なpx値としてtable.style.widthに設定する。上下のテーブルへ完全に同じ
  // px数値を渡すため、各コンテナのスクロールバーの有無に左右されず、上下で
  // 必ず同じ幅・同じ列境界になる
  var finalWidth=(forceAvailWidth>total)?forceAvailWidth:total;
  table.style.width=finalWidth+'px';
}
function renderExcelView(){
  var view=document.getElementById('excelView');
  if(!view) return;
  var cv=document.getElementById('cv'),ac=document.getElementById('ac'),ov=document.getElementById('ov');
  if(!excelWb){
    view.style.display='none';
    if(cv)cv.style.display='';if(ac)ac.style.display='';if(ov)ov.style.display='';
    _updateViewmemoForExcel(false);
    _updateTopbarForExcel(false);
    _updateTopbarForPdf(!!pdfDoc); // V1_116: PDF表示中は計測グループ・画面ボタンを隠す
    return;
  }
  view.style.display='flex';
  if(cv)cv.style.display='none';if(ac)ac.style.display='none';if(ov)ov.style.display='none';
  _updateViewmemoForExcel(true);
  _updateTopbarForExcel(true);
  _updateTopbarForPdf(false); // V1_116: Excel/CSV表示中はdxfToolGroup自体を隠すため対象外
  _updateExcelToolbarUI();
  var tabsEl=document.getElementById('excelSheetTabs');
  var topLeftTable=document.getElementById('excelTopLeftTable');
  var topRightTable=document.getElementById('excelTopRightTable');
  var bottomLeftTable=document.getElementById('excelBottomLeftTable');
  var bottomRightTable=document.getElementById('excelBottomRightTable');
  if(!tabsEl||!topLeftTable||!topRightTable||!bottomLeftTable||!bottomRightTable) return;
  if(excelSheetIdx<0||excelSheetIdx>=excelWb.SheetNames.length) excelSheetIdx=0;
  tabsEl.innerHTML='';
  if(excelWb.SheetNames.length>1){
    tabsEl.style.display='';
    excelWb.SheetNames.forEach(function(name,i){
      var b=document.createElement('button');
      b.type='button';
      b.className='excel-sheet-tab'+(i===excelSheetIdx?' active':'');
      b.textContent=name;
      b.addEventListener('click',function(){
        excelSheetIdx=i;
        _excelResetViewState(); // V1_111: シート切替時もソート/フィルタ/列幅をリセット（列の意味がシートごとに異なるため）
        renderExcelView();
        if(typeof scheduleSave==='function')scheduleSave();
      });
      tabsEl.appendChild(b);
    });
  } else {
    tabsEl.style.display='none';
  }
  var ws=excelWb.Sheets[excelWb.SheetNames[excelSheetIdx]];
  var rows=ws?XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false}):[];
  var colCount111=0;
  rows.forEach(function(r){ if(r.length>colCount111) colCount111=r.length; });
  // V1_115: ソート位置・固定行・固定列のインデックスを範囲内にクランプする（データが
  // 無ければ全て未指定へ戻す）。ソート位置(_excelSortRowIdx)はシート上の元の行(origIdx)を
  // 指す一方、固定行(_excelFreezeRowIdx)は現在の表示順で数えた位置(renderedPos)を指すため、
  // 意味が異なる点に注意（表全体のクランプはここでは行数のみで簡易チェックする）
  if(rows.length===0){ _excelSortRowIdx=-1; _excelFreezeRowIdx=-1; }
  else if(_excelSortRowIdx>=rows.length) _excelSortRowIdx=rows.length-1;
  if(colCount111===0) _excelFreezeColIdx=-1;
  else if(_excelFreezeColIdx>=colCount111) _excelFreezeColIdx=colCount111-1;
  // V1_115: ソート位置(_excelSortRowIdx)が指定されていれば、0行目からその行までは
  // 元の順序のまま動かさず、それより後ろの行だけがソート・列絞り込みの対象になる。
  // 未指定(-1)ならソート・列絞り込み機能自体が無い（アイコンが表示されないため）
  var dataStartIdx=_excelSortRowIdx>=0?_excelSortRowIdx+1:0;
  var rowsWithIdx=rows.map(function(r,i){ return {origIdx:i,cells:r}; });
  var unsortedPrefix=rowsWithIdx.slice(0,dataStartIdx);
  var sortableSuffix=rowsWithIdx.slice(dataStartIdx);
  if(_excelSortRowIdx>=0&&_excelSortCol>=0&&_excelSortDir!==0){
    var _col110=_excelSortCol,_dir110=_excelSortDir;
    sortableSuffix.sort(function(e1,e2){
      var cmp=_excelCompareVal(e1.cells[_col110],e2.cells[_col110]);
      return _dir110===1?cmp:-cmp;
    });
  }
  var visible111=sortableSuffix.map(function(e){
    if(!_excelColFilters) return true;
    for(var ci in _excelColFilters){
      var allowed=_excelColFilters[ci];
      var v=(e.cells[ci]===undefined||e.cells[ci]===null)?'':String(e.cells[ci]);
      if(!allowed.has(v)) return false;
    }
    return true;
  });
  // V1_115: 最終的な表示順（フィルタで非表示の行は含めない）を1本の配列にまとめる。
  // labelはExcelのオートフィルタと同様、絶対位置基準(欠番あり)。renderedPosは
  // 固定行の判定に使う「現在の表示順で数えた位置」(0始まり、フィルタ後)
  var finalEntries=[];
  unsortedPrefix.forEach(function(e){
    if(_excelHiddenRows[e.origIdx]) return; // V1_121: 非表示指定された行は描画対象から除外
    finalEntries.push({origIdx:e.origIdx,cells:e.cells,label:e.origIdx+1,isSortRow:(e.origIdx===_excelSortRowIdx)});
  });
  sortableSuffix.forEach(function(e,si){
    if(!visible111[si]) return;
    if(_excelHiddenRows[e.origIdx]) return; // V1_121: 非表示指定された行は描画対象から除外
    finalEntries.push({origIdx:e.origIdx,cells:e.cells,label:dataStartIdx+si+1,isSortRow:false});
  });
  finalEntries.forEach(function(e,idx){ e.renderedPos=idx; });
  var hasSortRow=(_excelSortRowIdx>=0);
  // V1_121: 非表示列を除いた「表示位置」順の列リストを作る。visibleColIndices[表示位置]=元の列番号。
  // 固定行・固定列(_excelFreezeColIdx等)は元の列番号で保持しているため、非表示列が挟まっても
  // 固定範囲がズレないよう、固定列の「表示位置」をこのリストの中で改めて求め直す
  var visibleColIndices=[];
  for(var _vc121=0;_vc121<colCount111;_vc121++){
    if(!_excelHiddenCols[_vc121]) visibleColIndices.push(_vc121);
  }
  // V1_115: 固定行・固定列の絶対境界。行番号列(常設)・列アルファベット行(常設)を含めた
  // 「絶対インデックス」で管理する(index0=行番号列/列アルファベット行相当)
  // V1_121: 固定列は表示位置(visibleColIndices内でのindexOf)基準に変更。固定列自体が
  // 非表示にされていた場合はindexOfが-1になり、固定なし(leftCount=1)へ自然に戻る
  var _freezeVisiblePos121=_excelFreezeColIdx>=0?visibleColIndices.indexOf(_excelFreezeColIdx):-1;
  var leftCount=_freezeVisiblePos121>=0?(_freezeVisiblePos121+2):1; // 行番号列+固定列ぶん
  var topCount=1+(_excelFreezeRowIdx>=0?(_excelFreezeRowIdx+1):0); // 列アルファベット行+固定行ぶん

  // V1_133: t.innerHTML=''はcolgroup等の子要素は消すが、table要素自身に直接
  // 設定したstyle.width/style.tableLayout(V1_117〜V1_132で_excelApplyColgroupが
  // 設定したもの)は消えずに残る。この状態のまま次の描画で_excelMeasurePaneWidths
  // がセル幅を実測すると、そのtableは前回描画時点の古いwidth・table-layout:fixedに
  // よってまだ制約されたままであるため、実際の内容(例：行数が増えて行番号が
  // 2桁になった等)に本来必要な幅より狭い値しか測定できない。一度前回の固定幅を
  // 解除してから中身を作り直すことで、実測が常に「今回描画する実際の内容」に
  // 基づいて行われるようにする(このtable要素はシート切替・ファイル切替でも
  // 使い回される静的なDOM要素であり、以前の描画結果を引きずってしまうため)
  [topLeftTable,topRightTable,bottomLeftTable,bottomRightTable].forEach(function(t){
    t.innerHTML='';
    t.style.width='';
    t.style.tableLayout='';
  });

  // ── 列アルファベット行（常設。上左・上右パネルへ列split後にそれぞれ追加）──
  var letterTrLeft=document.createElement('tr');
  var cornerTd=document.createElement('td');
  cornerTd.className='excel-rownum-cell excel-corner-cell'+(topCount>1?' frozen':'');
  letterTrLeft.appendChild(cornerTd);
  var letterTrRight=document.createElement('tr');
  for(var lvci=0;lvci<visibleColIndices.length;lvci++){
    var lci=visibleColIndices[lvci];
    var isColFrozen=(lvci<leftCount-1);
    var ltd=_excelBuildLetterCell(lci,isColFrozen); // ラベル文字(A,B,...)は元の列位置基準のまま
    // V1_134: 列幅ドラッグハンドル(_excelBuildResizeHandle、V1_115由来)は、従来は
    // ソート行(_excelSortRowIdxを明示的に指定した場合のみ現れる、見出し・並べ替え用の行)
    // にしか付いていなかった。ソート行を設定していない状態(初期表示)では列幅を手動で
    // 変える手段が一切無く、見た目にも分からなかったため、常に表示される列アルファベット
    // 行自体にもハンドルを付け、ソート行の有無に関係なくいつでも列幅を調整できるようにする
    var absColIdx134=lvci+1; // 行番号列(index0)を含む絶対インデックス
    var localIdx134=isColFrozen?(lvci+1):(lvci-(leftCount-1));
    var tableIdA134=isColFrozen?'excelTopLeftTable':'excelTopRightTable';
    var tableIdB134=isColFrozen?'excelBottomLeftTable':'excelBottomRightTable';
    ltd.appendChild(_excelBuildResizeHandle(absColIdx134,localIdx134,tableIdA134,tableIdB134));
    (isColFrozen?letterTrLeft:letterTrRight).appendChild(ltd);
  }
  topLeftTable.appendChild(letterTrLeft);
  topRightTable.appendChild(letterTrRight);

  // ── データ行（固定/スクロールを行ごとに判定し、列も左右split。ソート位置の行にのみ
  //    並べ替え/絞り込みアイコン・列幅ドラッグハンドルを表示する）──
  // V1_124: V1_119〜V1_123では「実際にレンダリングされた行の高さをJSで実測し、
  // 左右パネルで食い違えばコピーして揃える」方式を取っていたが、対象行の特定ロジック
  // (ソート行だけに絞る最適化、固定行使用時のテーブル内インデックス計算等)に起因する
  // オフバイワン等の不具合が version を跨いで繰り返し再発した。
  // 行番号セル(左パネル)とデータセル(右パネル)は別テーブルの別要素である以上、実測→
  // コピーという事後対応では取りこぼしが起き続けるため、根本的に「内容量に関わらず
  // 高さが必ず一致する」よう、index.html側で全パネル共通のtdにbox-sizing:border-box
  // ＋固定height(32px)を指定する方式に変更した。これによりJSでの行高さ実測・同期は
  // 不要になったため、そのための追跡処理(_topRowCounter121/_sortRowSyncInfo121等)は
  // ここで廃止する
  finalEntries.forEach(function(entry){
    var isTop=(topCount-1>0)&&(entry.renderedPos<=topCount-2);
    var trLeft=document.createElement('tr');
    var trRight=document.createElement('tr');
    if(entry.isSortRow){ trLeft.className='excel-sort-row'; trRight.className='excel-sort-row'; }
    var rnCell=_excelBuildRowNumCell(entry.label,entry.origIdx,entry.renderedPos,isTop,entry.isSortRow);
    trLeft.appendChild(rnCell);
    var isPrefixRow=(entry.renderedPos<dataStartIdx)&&(!hasSortRow||entry.origIdx<=_excelSortRowIdx);
    for(var vci=0;vci<visibleColIndices.length;vci++){
      var ci=visibleColIndices[vci]; // ci=元の列番号(データ/フィルタ/ソート列の特定に使う)
      var td=_excelBuildDataCell(entry.cells[ci],entry.origIdx,ci);
      var isColFrozen2=(vci<leftCount-1); // 固定範囲の判定は表示位置(vci)基準
      if(entry.isSortRow){
        td.style.fontWeight='700';
        td.style.position='relative';
        (function(colIdx,vPos,td){
          var sortIcon=document.createElement('span');
          var _active110=(_excelSortCol===colIdx&&_excelSortDir!==0);
          var _hasFilter113=!!(_excelColFilters&&_excelColFilters[colIdx]);
          var _iconColor118=(_active110||_hasFilter113)?'#1565c0':'#999';
          // V1_118: フィルター適用中は色変化だけでは視認しにくいとの指摘のため、
          // Excelの列フィルターに倣い三角矢印から漏斗(じょうご)アイコンに形状ごと変更する。
          // ソートも併用中は漏斗の右上に小さな矢印を重ねて両方の状態を示す。
          if(_hasFilter113){
            var _arrowOverlay118=_active110?('<span style="position:absolute;top:-4px;right:-6px;font-size:8px;line-height:1;color:'+_iconColor118+'">'+(_excelSortDir===1?'▲':'▼')+'</span>'):'';
            sortIcon.innerHTML='<span style="position:relative;display:inline-block;vertical-align:middle;width:11px;height:11px">'+
              '<svg width="11" height="11" viewBox="0 0 16 16" style="display:block"><path d="M1 2h14l-5.5 6.5V13l-3 2V8.5z" fill="'+_iconColor118+'"/></svg>'+_arrowOverlay118+'</span>';
          } else {
            sortIcon.textContent=_active110?(_excelSortDir===1?' ▲':' ▼'):' ▾';
          }
          sortIcon.style.cssText='margin-left:4px;color:'+_iconColor118+';cursor:pointer;font-size:11px;';
          sortIcon.title=_hasFilter113?'絞り込み中（タップで変更）':'並べ替え・絞り込み';
          sortIcon.addEventListener('click',function(ev){
            ev.stopPropagation();
            _showExcelColumnMenu(sortIcon,colIdx,sortableSuffix.map(function(e){return e.cells;}));
          });
          td.appendChild(sortIcon);
          var absColIdx=vPos+1; // V1_121: _excelColWidths添字は表示位置(vci)基準
          var localIdx=isColFrozen2?(vPos+1):(vPos-(leftCount-1));
          var tableIdA=isColFrozen2?'excelTopLeftTable':'excelTopRightTable';
          var tableIdB=isColFrozen2?'excelBottomLeftTable':'excelBottomRightTable';
          td.appendChild(_excelBuildResizeHandle(absColIdx,localIdx,tableIdA,tableIdB));
        })(ci,vci,td);
      } else if(isPrefixRow){
        td.style.background='#f7f8fa';
      } else {
        // V1_117: 行ストライプ・列ストライプを独立したON/OFFにし、両方ONの場合は
        // 行×列の偶奇を組み合わせたチェッカーボード状の縞にする。両方OFFなら縞なし(白)
        // V1_121: 列ストライプは表示位置(vci)基準にし、非表示列を挟んでも縞が連続するようにする
        var _rowParity117=_excelRowStripe?((entry.renderedPos-dataStartIdx)%2):0;
        var _colParity117=_excelColStripe?(vci%2):0;
        var _stripeOn117=_excelRowStripe||_excelColStripe?((_rowParity117+_colParity117)%2):0;
        // V1_122: 従来の縞色(#f5f7fa)は白とほぼ見分けがつかず視認性が低いとの指摘のため、
        // はっきり違いがわかる濃さの青系グレーに変更した
        td.style.background=_stripeOn117?'#c9d7ea':'#fff';
      }
      (isColFrozen2?trLeft:trRight).appendChild(td);
    }
    if(isTop){ topLeftTable.appendChild(trLeft); topRightTable.appendChild(trRight); }
    else { bottomLeftTable.appendChild(trLeft); bottomRightTable.appendChild(trRight); }
  });

  // V1_117: 実テーブルを直接測定して列幅を左右パネルへ分配・適用する（隠しテーブルは廃止）
  _excelSyncPaneColWidths(topLeftTable,bottomLeftTable,topRightTable,bottomRightTable,leftCount,visibleColIndices.length+1);
  // V1_128: 行番号ガター(左)とデータ(右)は別テーブルのため、CSSの固定height指定
  // だけではサブピクセル単位の誤差が行を重ねるごとに蓄積し、行数の多いシートの
  // 下の方で目に見えるズレになる不具合が再発した。実際にレンダリングされた高さを
  // 直接測定し、左右へ同じ値を明示的に書き込むことで累積誤差の余地自体を無くす
  // （読み取り→書き込みを完全分離しているため、行数が多くても性能上の問題は無い）
  _excelSyncRowHeights(topLeftTable,topRightTable);
  _excelSyncRowHeights(bottomLeftTable,bottomRightTable);

  // V1_88: DXF/PDFの黄色マークと同様に、検索キーワード(_markKeyword)に一致するセルを
  // ハイライトする。シートタブ切替のたびにここが再実行されるため、切り替えた先の
  // シートに一致セルがあれば自動的に反映される（スクロールは行わない。初回オープン時の
  // スクロールはopenDxfFromDb側から_applyExcelSearchHighlight(true)を明示的に呼ぶ）
  if(typeof _applyExcelSearchHighlight==='function') _applyExcelSearchHighlight(false);
  // V1_113: シートタブ下の検索欄（純粋な検索。行は絞り込まずハイライト＋次へ移動のみ）を
  // 再描画のたびに再適用する（列の並び替え・絞り込みで一致セルの位置が変わるため）
  if(typeof _applyExcelLocalSearch==='function') _applyExcelLocalSearch(false);
}

// V1_115: 4分割テーブルのスクロール同期。#excelBottomRightWrapのみユーザー操作で
// スクロールし、その縦スクロールを#excelBottomLeftWrapへ、横スクロールを
// #excelTopRightWrapへそれぞれ反映する（他の3パネルはoverflow:hiddenで
// ユーザー操作によるスクロールを受け付けない）
// V1_129: 上記の'scroll'イベント方式は、#excelBottomRightWrapに指定している
// -webkit-overflow-scrolling:touch(コンポジタスレッドによる慣性スクロール)と
// 相性が悪く、指でフリックしている最中はメインスレッド側の'scroll'イベントが
// 大幅に間引かれる(スクロールが止まるまでほぼ発火しないこともある)ため、
// 「横スクロール中は列アルファベット行(#excelTopRightWrap)が全く追従しない」
// という不具合として現れていた。そこで'scroll'イベントを待つのをやめ、
// requestAnimationFrameで毎フレームbr.scrollLeft/scrollTopを直接ポーリングして
// 反映するループに切り替える。前回値と変化が無いフレームでは書き込みを
// 行わないため、無駄なレイアウト・ペイントは発生しない
function _excelScrollSyncTick(br,bl,tr,state){
  if(!br) return false;
  var left=br.scrollLeft,top=br.scrollTop,changed=false;
  if(left!==state.lastLeft){ if(tr) tr.scrollLeft=left; state.lastLeft=left; changed=true; }
  if(top!==state.lastTop){ if(bl) bl.scrollTop=top; state.lastTop=top; changed=true; }
  return changed;
}
(function(){
  var br=document.getElementById('excelBottomRightWrap');
  var bl=document.getElementById('excelBottomLeftWrap');
  var tr=document.getElementById('excelTopRightWrap');
  if(!br) return;
  var _scrollSyncState={lastLeft:-1,lastTop:-1};
  function loop(){
    _excelScrollSyncTick(br,bl,tr,_scrollSyncState);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
// V1_115: ヘッダーツールバーのソート/固定行列ボタンの配線。
// V1_117: 列ストライプボタンを行縞/列縞の2ボタンに分離した。
// いずれも常設の静的要素なので、リスナーはここで1度だけ登録する
(function(){
  var sortBtn=document.getElementById('excelSortBtn');
  var freezeBtn=document.getElementById('excelFreezeBtn');
  var rowStripeBtn=document.getElementById('excelRowStripeBtn');
  var colStripeBtn=document.getElementById('excelColStripeBtn');
  var hideBtn=document.getElementById('excelHideBtn'); // V1_121
  var unhideBtn=document.getElementById('excelUnhideBtn'); // V1_121
  var sumBtn=document.getElementById('excelSumBtn'); // V1_122
  if(sortBtn) sortBtn.addEventListener('click',function(){
    _excelClearTransientPickState(); // V1_122: 非表示/合計の仮選択が残らないようにする
    _excelPickMode=(_excelPickMode==='sort')?null:'sort';
    _updateExcelToolbarUI();
  });
  if(freezeBtn) freezeBtn.addEventListener('click',function(){
    _excelClearTransientPickState();
    _excelPickMode=(_excelPickMode==='freeze')?null:'freeze';
    _updateExcelToolbarUI();
  });
  // V1_119: 行縞・列縞は同時にONにできないよう排他化。片方をONにする際は
  // もう片方を自動的にOFFにする（チェッカーボード状の同時表示は廃止）
  if(rowStripeBtn) rowStripeBtn.addEventListener('click',function(){
    _excelRowStripe=!_excelRowStripe;
    if(_excelRowStripe) _excelColStripe=false;
    renderExcelView();
  });
  if(colStripeBtn) colStripeBtn.addEventListener('click',function(){
    _excelColStripe=!_excelColStripe;
    if(_excelColStripe) _excelRowStripe=false;
    renderExcelView();
  });
  // V1_122: 「非表示」ボタンで複数選択モードに入り、行番号/列アルファベットを
  // 何度でもタップして仮選択する(視認性のためのクラス切替のみで全体再描画はしない
  // ＝高速)。「表示に戻す」ボタンは非表示中の行・列を一覧するポップアップを開く。
  // V1_125: 従来はこのボタンをもう一度押すことで確定していたが、ヘッダーの小さな
  // ボタンを「もう一度押すと確定」という操作がわかりにくいとの指摘のため、確定は
  // 専用の確定ボタン(#excelConfirmBtn、画面下に大きく表示)に一本化した。
  // このヘッダーボタンはモードへの出入り(トグル)専用にし、選択中に再度押すと
  // 確定せずキャンセルしてモードを抜ける（迷った時にすぐやめられるように）
  if(hideBtn) hideBtn.addEventListener('click',function(){
    if(_excelPickMode!=='hide'){
      _excelClearTransientPickState();
      _excelPickMode='hide';
    } else {
      _excelClearTransientPickState(); // キャンセル：仮選択を破棄してモードを抜けるだけ
      _excelPickMode=null;
    }
    _updateExcelToolbarUI();
  });
  if(unhideBtn) unhideBtn.addEventListener('click',function(ev){
    ev.stopPropagation();
    _showExcelHiddenListMenu(unhideBtn);
  });
  // V1_122: 「合計」ボタンでセルの複数選択モードに入る。
  // V1_125: 非表示と同様、確定は専用の確定ボタンへ一本化。このボタンは
  // モードへの出入り(トグル)専用にし、選択中の再押下はキャンセル扱いにする
  if(sumBtn) sumBtn.addEventListener('click',function(){
    if(_excelPickMode!=='sum'){
      _excelClearTransientPickState();
      _excelPickMode='sum';
    } else {
      _excelClearTransientPickState();
      _excelPickMode=null;
    }
    _updateExcelToolbarUI();
  });
  // V1_125: 画面下に常時1つだけ表示される確定ボタン。現在のピックモードに応じて
  // 非表示確定・合計計算のどちらを行うかを切り替える（表示/文言の切替は
  // _updateExcelToolbarUI側で行う）。
  // V1_127: 合計計算後は結果表示中(_excelConfirmResultActive)になり、ボタンは
  // 「閉じる」として機能する（結果を消してバーを隠すだけの動作）
  var confirmBtn=document.getElementById('excelConfirmBtn');
  if(confirmBtn) confirmBtn.addEventListener('click',function(){
    if(_excelConfirmResultActive){
      _excelConfirmResultActive=false;
      var _bar127b=document.getElementById('excelConfirmBar');
      if(_bar127b){ _bar127b.style.display='none'; _bar127b.classList.remove('excel-confirm-result'); }
      return;
    }
    if(_excelPickMode==='hide') _excelConfirmHide();
    else if(_excelPickMode==='sum') _excelConfirmSum();
  });
})();
// V1_113: シートタブ下の検索欄の配線。V1_111では入力のたびに行を絞り込んで
// renderExcelView()を呼んでいたが、V1_113では行を絞り込まずハイライト表示するだけの
// 軽い処理(_applyExcelLocalSearch)に変えたため、テーブル全体の再描画は不要になった
(function(){
  var input=document.getElementById('excelFilterInput');
  var clearBtn=document.getElementById('excelFilterClearBtn');
  var nextBtn=document.getElementById('excelFilterNextBtn');
  if(!input||!clearBtn||!nextBtn) return;
  var _debounceTimer111=null;
  input.addEventListener('input',function(){
    var v=input.value;
    if(_debounceTimer111) clearTimeout(_debounceTimer111);
    _debounceTimer111=setTimeout(function(){
      _excelSearchText=v;
      _excelSearchMatchIdx=-1; // 検索文字列が変わったら最初の一致からやり直す
      _applyExcelLocalSearch(false);
    },150);
  });
  clearBtn.addEventListener('click',function(){
    input.value='';
    _excelSearchText='';
    _excelSearchMatchIdx=-1;
    _applyExcelLocalSearch(false);
  });
  nextBtn.addEventListener('click',function(){
    _excelSearchText=input.value; // デバウンス待ち中でも最新の入力値を使う
    _applyExcelLocalSearch(true);
  });
})();
// V1_115: 4分割テーブルすべてを対象に走査するよう変更。V1_113: シートタブ下の検索欄用の
// ハイライト＋巡回移動処理。V1_88の_markKeyword由来のハイライト(.cell-highlight)とは
// 別クラス(.excel-search-hit/-active)を使い、互いに独立して動作するようにした。
// advance=trueの時だけ「次へ」として次の一致へ移動する
function _applyExcelLocalSearch(advance){
  var tables=_excelAllCellTables();
  var fc=document.getElementById('excelFilterCount');
  if(tables.length===0) return;
  tables.forEach(function(table){
    table.querySelectorAll('td.excel-search-hit,td.excel-search-hit-active').forEach(function(td){
      td.classList.remove('excel-search-hit','excel-search-hit-active');
    });
  });
  var kw=(typeof _normalizeForSearch==='function')?_normalizeForSearch(_excelSearchText):(_excelSearchText||'').toLowerCase();
  if(!kw){ _excelSearchMatchIdx=-1; if(fc) fc.textContent=''; return; }
  var matches=[];
  tables.forEach(function(table){
    table.querySelectorAll('td').forEach(function(td){
      var t=(typeof _normalizeForSearch==='function')?_normalizeForSearch(td.textContent):td.textContent.toLowerCase();
      if(t.indexOf(kw)>=0){ td.classList.add('excel-search-hit'); matches.push(td); }
    });
  });
  if(matches.length===0){
    _excelSearchMatchIdx=-1;
    if(fc) fc.textContent='0件';
    return;
  }
  if(advance){
    _excelSearchMatchIdx=(_excelSearchMatchIdx+1)%matches.length;
  } else if(_excelSearchMatchIdx<0||_excelSearchMatchIdx>=matches.length){
    _excelSearchMatchIdx=0;
  }
  var cur=matches[_excelSearchMatchIdx];
  cur.classList.add('excel-search-hit-active');
  if(fc) fc.textContent=(_excelSearchMatchIdx+1)+'/'+matches.length+'件';
  if(advance&&typeof cur.scrollIntoView==='function'){
    cur.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
  }
}
// V1_113: 見出しセルの▾アイコンから開く、Excelのオートフィルタ相当のドロップダウン
// メニュー。「昇順で並べ替え」「降順で並べ替え」に加えて、その列に含まれる値の
// チェックリストで行を絞り込める（すべて選択/解除・個別チェック）。既存のダイアログ
// ポップアップ(dialog.jsの_showIndexProfileNameDialog等)と同様、position:fixedで
// アンカー要素の直下に表示し、外側タップで閉じる
function _showExcelColumnMenu(anchorEl,colIdx,bodyRows){
  var existing=document.getElementById('_excelColMenu113');
  if(existing){existing.remove();return;}
  var menu=document.createElement('div');
  menu.id='_excelColMenu113';
  // V1_125: 従来はmenu自体にoverflow-y:autoを指定し、昇順/降順ボタン〜値の一覧〜
  // OK/キャンセルボタンまで全体を1つのスクロール領域にしていた。画面が縦に狭い場合、
  // 一番下のOK/キャンセルまでスクロールしないと押せず、かつ(iPadのposition:fixed要素内の
  // overflow-y:autoはタッチスクロールが効かないことがある、という既知の癖もあり)
  // 「ポップアップが下側に寄って見にくく、OK操作ができない」との報告が繰り返された。
  // 根本対応として、OK/キャンセルは常にスクロール不要で見える位置(下端固定の
  // フッター)に配置し、スクロールが必要になり得るのは値のチェックリスト部分だけに
  // 限定する（このリストは元々listBox自体が独立してmax-height+overflow-yを持つ）
  menu.style.cssText='position:fixed;z-index:9999;background:#fff;border:1px solid #999;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;min-width:200px;max-width:280px;box-shadow:0 4px 20px rgba(0,0,0,.35);color:#222;overflow:hidden;';
  var r=anchorEl.getBoundingClientRect();
  // V1_117: 固定行が多い場合など、アイコンが画面下端に近い位置にあると常に下向きに
  // 開くのでは視認性が悪かった（メニューが画面外にはみ出す）。下に十分な余白が
  // なければ上向き(bottom基準)に開くようにする
  var _spaceBelow117=window.innerHeight-r.bottom;
  var _spaceAbove117=r.top;
  // V1_126: メニューの最大高さ(maxHeight)を、開く方向にかかわらず「画面の高さ-16px」
  // という一律の値にしていたバグを修正。メニューは画面の途中(アイコンの位置)から
  // 開くため、実際に使える残り高さは方向によって異なる(下向きなら画面下端まで、
  // 上向きなら画面上端まで)。この食い違いにより、アイコンが画面の下寄りにある場合、
  // メニューの見た目上の開始位置より下にmaxHeightぶんの高さが確保されてしまい、
  // 実際の画面には収まりきらずOK/キャンセルボタンが画面外に押し出されてしまっていた
  // （V1_125で追加したフッター常時表示化だけでは、そもそもメニュー自体が画面の外に
  // 出てしまっているケースまでは救えていなかった）。開く方向ごとに、その方向に
  // 実際に残っている余白を上限として使うよう修正する
  var _margin126=8; // 画面端からの最小余白
  if(_spaceBelow117<220&&_spaceAbove117>_spaceBelow117){
    menu.style.bottom=(window.innerHeight-r.top+4)+'px';
    menu.style.maxHeight=Math.max(120,r.top-4-_margin126)+'px'; // 上向き: アイコンより上に使える高さまで
  } else {
    menu.style.top=(r.bottom+4)+'px';
    menu.style.maxHeight=Math.max(120,window.innerHeight-(r.bottom+4)-_margin126)+'px'; // 下向き: アイコンより下に使える高さまで
  }
  menu.style.left=Math.max(4,Math.min(r.left,window.innerWidth-296))+'px';
  function closeMenu(){ if(document.getElementById('_excelColMenu113')) menu.remove(); }

  // V1_125: 昇順/降順ボタン〜値の一覧までをまとめる、内部だけがスクロールする領域。
  // flex:1;min-height:0でメニューの残り高さいっぱいまで広がり、それでも収まらない
  // 分だけこの内側でスクロールする（外側のmenu自体はスクロールしないため、
  // フッター(btnRow)は常にこのすぐ下、画面内の固定位置に見え続ける）
  var scrollArea=document.createElement('div');
  scrollArea.style.cssText='flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:6px;';
  menu.appendChild(scrollArea);

  var ascBtn=document.createElement('button');
  ascBtn.type='button';ascBtn.textContent='昇順で並べ替え';
  ascBtn.style.cssText='text-align:left;padding:8px;border:none;background:#f5f5f5;border-radius:6px;cursor:pointer;font-size:13px;';
  ascBtn.addEventListener('click',function(){ _excelSortCol=colIdx;_excelSortDir=1;closeMenu();renderExcelView(); });
  scrollArea.appendChild(ascBtn);

  var descBtn=document.createElement('button');
  descBtn.type='button';descBtn.textContent='降順で並べ替え';
  descBtn.style.cssText=ascBtn.style.cssText;
  descBtn.addEventListener('click',function(){ _excelSortCol=colIdx;_excelSortDir=-1;closeMenu();renderExcelView(); });
  scrollArea.appendChild(descBtn);

  var hr=document.createElement('div');
  hr.style.cssText='height:1px;background:#ddd;margin:2px 0;';
  scrollArea.appendChild(hr);

  // その列に現れる一意な値の一覧（空欄も1つの値として扱う）
  var uniqSeen={};
  var uniqList=[];
  bodyRows.forEach(function(row){
    var v=(row[colIdx]===undefined||row[colIdx]===null)?'':String(row[colIdx]);
    if(!(v in uniqSeen)){ uniqSeen[v]=true; uniqList.push(v); }
  });
  uniqList.sort(function(a,b){return a.localeCompare(b,'ja');});

  var currentAllowed=_excelColFilters&&_excelColFilters[colIdx];

  var selAllRow=document.createElement('label');
  selAllRow.style.cssText='display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:2px 4px;';
  var selAllCb=document.createElement('input');
  selAllCb.type='checkbox';
  selAllCb.checked=!currentAllowed;
  selAllRow.appendChild(selAllCb);
  selAllRow.appendChild(document.createTextNode('(すべて選択)'));
  scrollArea.appendChild(selAllRow);

  var listBox=document.createElement('div');
  listBox.style.cssText='max-height:180px;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:2px;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:4px 0;';
  var checkboxes=[];
  uniqList.forEach(function(v){
    var row=document.createElement('label');
    row.style.cssText='display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 4px;';
    var cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked=currentAllowed?currentAllowed.has(v):true;
    cb.addEventListener('change',function(){
      selAllCb.checked=checkboxes.every(function(c){return c.checked;});
    });
    checkboxes.push(cb);
    row.appendChild(cb);
    var labelText=document.createElement('span');
    labelText.textContent=v===''?'(空白)':v;
    labelText.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    row.appendChild(labelText);
    listBox.appendChild(row);
  });
  scrollArea.appendChild(listBox);

  selAllCb.addEventListener('change',function(){
    checkboxes.forEach(function(cb){cb.checked=selAllCb.checked;});
  });

  // V1_125: OK/キャンセルはscrollAreaの外(=常に非スクロール領域)に配置する常設フッター。
  // これによりチェックリストがどれだけ長くてもOK/キャンセルへ確実に手が届く
  var btnRow=document.createElement('div');
  btnRow.style.cssText='display:flex;gap:6px;margin-top:4px;flex-shrink:0;';
  var okBtn=document.createElement('button');
  okBtn.type='button';okBtn.textContent='OK';
  okBtn.style.cssText='flex:1;padding:8px;border:none;border-radius:6px;background:#1565c0;color:#fff;font-size:13px;cursor:pointer;';
  okBtn.addEventListener('click',function(){
    var checkedVals=[];
    uniqList.forEach(function(v,i){ if(checkboxes[i].checked) checkedVals.push(v); });
    if(checkedVals.length===uniqList.length){
      if(_excelColFilters) delete _excelColFilters[colIdx];
    } else {
      if(!_excelColFilters) _excelColFilters={};
      _excelColFilters[colIdx]=new Set(checkedVals);
    }
    closeMenu();
    renderExcelView();
  });
  var cnlBtn=document.createElement('button');
  cnlBtn.type='button';cnlBtn.textContent='キャンセル';
  cnlBtn.style.cssText='flex:1;padding:8px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#555;font-size:13px;cursor:pointer;';
  cnlBtn.addEventListener('click',closeMenu);
  btnRow.appendChild(okBtn);btnRow.appendChild(cnlBtn);
  menu.appendChild(btnRow);

  document.body.appendChild(menu);
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}

// V1_121: 「表示に戻す」ボタン用のポップアップ。非表示中の行・列を一覧表示し、
// 個別の「戻す」ボタン、または「すべて表示に戻す」で復元できるようにする。
// 非表示にした行・列はDOMから消えて再タップでは戻せないため、このポップアップが
// 唯一の復元手段になる。_showExcelColumnMenuと同じ位置決め・外側タップ閉じの作法に倣う
function _showExcelHiddenListMenu(anchorEl){
  var existing=document.getElementById('_excelHiddenMenu121');
  if(existing){existing.remove();return;}
  var hiddenRowKeys=Object.keys(_excelHiddenRows);
  var hiddenColKeys=Object.keys(_excelHiddenCols);
  if(hiddenRowKeys.length===0&&hiddenColKeys.length===0){
    if(typeof showGuide==='function') showGuide('非表示の行・列はありません',1600);
    return;
  }
  var menu=document.createElement('div');
  menu.id='_excelHiddenMenu121';
  menu.style.cssText='position:fixed;z-index:9999;background:#fff;border:1px solid #999;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;min-width:200px;max-width:280px;box-shadow:0 4px 20px rgba(0,0,0,.35);color:#222;';
  var r=anchorEl.getBoundingClientRect();
  var _spaceBelow121=window.innerHeight-r.bottom;
  var _spaceAbove121=r.top;
  if(_spaceBelow121<220&&_spaceAbove121>_spaceBelow121){
    menu.style.bottom=(window.innerHeight-r.top+4)+'px';
  } else {
    menu.style.top=(r.bottom+4)+'px';
  }
  menu.style.left=Math.max(4,Math.min(r.left,window.innerWidth-296))+'px';
  function closeMenu(){ if(document.getElementById('_excelHiddenMenu121')) menu.remove(); }

  var title=document.createElement('div');
  title.textContent='非表示の行・列';
  title.style.cssText='font-size:13px;font-weight:700;';
  menu.appendChild(title);

  var listBox=document.createElement('div');
  listBox.style.cssText='max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:4px 0;';
  hiddenRowKeys.map(Number).sort(function(a,b){return a-b;}).forEach(function(origIdx){
    var row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;padding:4px;';
    var label=document.createElement('span');
    label.textContent='行 '+(origIdx+1);
    row.appendChild(label);
    var btn=document.createElement('button');
    btn.type='button';btn.textContent='戻す';
    btn.style.cssText='padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;font-size:12px;cursor:pointer;';
    btn.addEventListener('click',function(){
      delete _excelHiddenRows[origIdx];
      closeMenu();
      renderExcelView();
    });
    row.appendChild(btn);
    listBox.appendChild(row);
  });
  hiddenColKeys.map(Number).sort(function(a,b){return a-b;}).forEach(function(colIdx){
    var row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;padding:4px;';
    var label=document.createElement('span');
    label.textContent='列 '+_excelColLetter(colIdx);
    row.appendChild(label);
    var btn=document.createElement('button');
    btn.type='button';btn.textContent='戻す';
    btn.style.cssText='padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;font-size:12px;cursor:pointer;';
    btn.addEventListener('click',function(){
      delete _excelHiddenCols[colIdx];
      closeMenu();
      renderExcelView();
    });
    row.appendChild(btn);
    listBox.appendChild(row);
  });
  menu.appendChild(listBox);

  var allBtn=document.createElement('button');
  allBtn.type='button';allBtn.textContent='すべて表示に戻す';
  allBtn.style.cssText='margin-top:4px;padding:8px;border:none;border-radius:6px;background:#1565c0;color:#fff;font-size:13px;cursor:pointer;';
  allBtn.addEventListener('click',function(){
    _excelHiddenRows={};_excelHiddenCols={};
    closeMenu();
    renderExcelView();
  });
  menu.appendChild(allBtn);

  document.body.appendChild(menu);
  setTimeout(function(){document.addEventListener('click',function _dc(ev){
    if(!menu.contains(ev.target)&&ev.target!==anchorEl){closeMenu();document.removeEventListener('click',_dc);}
  });},10);
}

// V1_88: 検索してファイルを開く/全図面検索で開いたExcelの、キーワード(_markKeyword)に
// 一致するセルをDXF/PDFの黄色マークと同様にハイライト表示する。呼ばれるたびに、まず
// 既存のハイライトをすべて解除してから、_markKeywordが設定されていれば再度付与し直す
// （キーワードが無ければ解除だけで終わる＝ファイルを直接開いた時は自動的にクリアされる）
function _applyExcelSearchHighlight(scrollToFirst){
  var tables=_excelAllCellTables();
  if(tables.length===0) return;
  tables.forEach(function(table){
    table.querySelectorAll('td.cell-highlight').forEach(function(td){td.classList.remove('cell-highlight');});
  });
  if(typeof _markKeyword==='undefined'||!_markKeyword) return;
  var kw=(typeof _normalizeForSearch==='function')?_normalizeForSearch(_markKeyword):_markKeyword;
  if(!kw) return;
  var first=null;
  tables.forEach(function(table){
    table.querySelectorAll('td').forEach(function(td){
      var t=(typeof _normalizeForSearch==='function')?_normalizeForSearch(td.textContent):td.textContent;
      if(t.indexOf(kw)>=0){
        td.classList.add('cell-highlight');
        if(!first) first=td;
      }
    });
  });
  if(scrollToFirst&&first&&typeof first.scrollIntoView==='function'){
    first.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
  }
}

// Excelセルタップ時の処理。テキスト読込ピックモード中は共通ヘルパー(_commitPickedText)へ渡す。
// ピックモードでない時はセル内容をガイド表示するのみ（画面検索と異なり座標ジャンプは行わない）
function _excelCellTapped(text){
  text=(text||'').trim();
  if(!text) return;
  if(typeof _textPickTarget!=='undefined'&&_textPickTarget){
    if(typeof _commitPickedText==='function') _commitPickedText(text);
  } else if(typeof showGuide==='function'){
    showGuide('セル: '+text,2000);
  }
}

function buildPDF(jpegB64,pw,ph){
  const a4w=595,a4h=842;
  let iw=a4w,ih=Math.round(ph/pw*a4w);
  if(ih>a4h){ih=a4h;iw=Math.round(pw/ph*a4h);}
  const ox=Math.round((a4w-iw)/2),oy=Math.round((a4h-ih)/2);
  const imgData=atob(jpegB64);
  const imgBytes=new Uint8Array(imgData.length);
  for(let i=0;i<imgData.length;i++) imgBytes[i]=imgData.charCodeAt(i);
  const enc=new TextEncoder();
  function str(s){return enc.encode(s);}
  function concat(...arrs){let len=0;arrs.forEach(a=>len+=a.length);const r=new Uint8Array(len);let off=0;arrs.forEach(a=>{r.set(a,off);off+=a.length;});return r;}
  const stream=`q ${iw} 0 0 ${ih} ${ox} ${oy} cm /Im1 Do Q`;
  const objs=[
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${a4w} ${a4h}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  const imgHdr=`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`;
  const imgFtr=`\nendstream\nendobj\n`;
  const chunks=[str('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let pos=chunks[0].length;
  const xref=[];
  for(let i=0;i<objs.length;i++){xref.push(pos);const s=str(objs[i]);chunks.push(s);pos+=s.length;}
  // Image object
  xref.push(pos);
  const hdr=str(imgHdr);const ftr=str(imgFtr);
  chunks.push(hdr);pos+=hdr.length;chunks.push(imgBytes);pos+=imgBytes.length;chunks.push(ftr);pos+=ftr.length;
  const xrefPos=pos;
  let xrefStr=`xref\n0 6\n0000000000 65535 f \n`;
  for(const o of xref) xrefStr+=o.toString().padStart(10,'0')+' 00000 n \n';
  xrefStr+=`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  chunks.push(str(xrefStr));
  return concat(...chunks);
}
function resizeCanvas(){
  const dpr=window.devicePixelRatio||1;
  const r=stage.getBoundingClientRect();
  const W=r.width, H=r.height;
  // CSSサイズは変えない（layout崩れを防ぐ）
  cv.style.width=W+'px'; cv.style.height=H+'px';
  ac.style.width=W+'px'; ac.style.height=H+'px'; // V0_82: Annotation Canvas
  ov.style.width=W+'px'; ov.style.height=H+'px';
  // 内部解像度だけdpr倍にする
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  ac.width=Math.round(W*dpr); ac.height=Math.round(H*dpr); // V0_82
  ov.width=Math.round(W*dpr); ov.height=Math.round(H*dpr);
  scheduleDraw();
}


// =========================================================
// 公開API (window.viewer)
// =========================================================
window.viewer = {
  loadDXF: function(buf, fname) {
    doc = parseDXF(buf);
    currentFileName = fname || '';
    buildLayerModal();
    detectScale();
    buildSnapCache();
    checkPerfMode();
    fit();
    scheduleDraw();
  },
  loadPDF: async function(buf, fname) {
    currentFileName = fname || '';
    await loadPDF(buf);
  },
  zoomIn:       function(cx, cy) { zoomAt(cx != null ? cx : cv.width/2, cy != null ? cy : cv.height/2, 1.25); scheduleDraw(); },
  zoomOut:      function(cx, cy) { zoomAt(cx != null ? cx : cv.width/2, cy != null ? cy : cv.height/2, 0.8);  scheduleDraw(); },
  fitToScreen:  function()       { fit(); scheduleDraw(); },
  panTo:        function(wx, wy) { var s=w2s(wx,wy); tx+=(cv.width/2-s[0]); ty+=(cv.height/2-s[1]); scheduleDraw(); },
  requestRender:  scheduleDraw,
  requestOverlay: scheduleOverlay,
  worldToScreen:  w2s,
  screenToWorld:  s2w,
};
