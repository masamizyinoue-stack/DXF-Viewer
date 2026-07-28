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
// markFitRow（マーク送り・全体ボタン）はExcel/CSV表示中も使うため対象外。
function _updateViewmemoForExcel(isExcel){
  var els=document.querySelectorAll('#viewmemo .mem-btn, #viewmemo .show-btn, #viewmemo .vm-file');
  els.forEach(function(el){ el.style.display=isExcel?'none':''; });
}
function renderExcelView(){
  var view=document.getElementById('excelView');
  if(!view) return;
  var cv=document.getElementById('cv'),ac=document.getElementById('ac'),ov=document.getElementById('ov');
  if(!excelWb){
    view.style.display='none';
    if(cv)cv.style.display='';if(ac)ac.style.display='';if(ov)ov.style.display='';
    _updateViewmemoForExcel(false);
    return;
  }
  view.style.display='flex';
  if(cv)cv.style.display='none';if(ac)ac.style.display='none';if(ov)ov.style.display='none';
  _updateViewmemoForExcel(true);
  var tabsEl=document.getElementById('excelSheetTabs');
  var table=document.getElementById('excelTable');
  if(!tabsEl||!table) return;
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
        excelSheetIdx=i;renderExcelView();
        if(typeof scheduleSave==='function')scheduleSave();
      });
      tabsEl.appendChild(b);
    });
  } else {
    tabsEl.style.display='none';
  }
  var ws=excelWb.Sheets[excelWb.SheetNames[excelSheetIdx]];
  var rows=ws?XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false}):[];
  table.innerHTML='';
  rows.forEach(function(row){
    var tr=document.createElement('tr');
    row.forEach(function(cell){
      var td=document.createElement('td');
      td.textContent=(cell===null||cell===undefined)?'':String(cell);
      td.addEventListener('click',function(){ if(typeof _excelCellTapped==='function') _excelCellTapped(td.textContent); });
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  // V1_88: DXF/PDFの黄色マークと同様に、検索キーワード(_markKeyword)に一致するセルを
  // ハイライトする。シートタブ切替のたびにここが再実行されるため、切り替えた先の
  // シートに一致セルがあれば自動的に反映される（スクロールは行わない。初回オープン時の
  // スクロールはopenDxfFromDb側から_applyExcelSearchHighlight(true)を明示的に呼ぶ）
  if(typeof _applyExcelSearchHighlight==='function') _applyExcelSearchHighlight(false);
}

// V1_88: 検索してファイルを開く/全図面検索で開いたExcelの、キーワード(_markKeyword)に
// 一致するセルをDXF/PDFの黄色マークと同様にハイライト表示する。呼ばれるたびに、まず
// 既存のハイライトをすべて解除してから、_markKeywordが設定されていれば再度付与し直す
// （キーワードが無ければ解除だけで終わる＝ファイルを直接開いた時は自動的にクリアされる）
function _applyExcelSearchHighlight(scrollToFirst){
  var table=document.getElementById('excelTable');
  if(!table) return;
  var prev=table.querySelectorAll('td.cell-highlight');
  prev.forEach(function(td){td.classList.remove('cell-highlight');});
  if(typeof _markKeyword==='undefined'||!_markKeyword) return;
  var kw=(typeof _normalizeForSearch==='function')?_normalizeForSearch(_markKeyword):_markKeyword;
  if(!kw) return;
  var first=null;
  table.querySelectorAll('td').forEach(function(td){
    var t=(typeof _normalizeForSearch==='function')?_normalizeForSearch(td.textContent):td.textContent;
    if(t.indexOf(kw)>=0){
      td.classList.add('cell-highlight');
      if(!first) first=td;
    }
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
