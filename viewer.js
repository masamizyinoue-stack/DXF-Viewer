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
var stage=document.getElementById('stage');
var ctx=cv.getContext('2d');
var octx=ov.getContext('2d',{desynchronized:true});
var doc=null;
var currentFileName='';
var tx=0,ty=0,scale=1;
var bwMode=false;
// hiddenLayers → layer.js
var pdfDoc=null,pdfPageNum=1;
var pdfImage=null;
var rafId=null;
var needDraw=false,needOverlay=false;
// ─ パフォーマンス最適化 ─
var _scEndPts=[],_scMidPts=[],_scCenPts=[]; // スナップキャッシュ（Xソート済）
var perfMode=false; // 軽量モード（大容量DXF自動切替）
var PERF_THRESHOLD=800; // この要素数を超えたら軽量モード
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
function decodeDXF(buf){
  const head=new Uint8Array(buf,0,Math.min(20,buf.byteLength));
  if(head[0]===65&&head[1]===117&&head[2]===116)
    throw new Error('バイナリDXF形式は非対応です。ASCII DXFで保存してください。');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch(e){}
  return new TextDecoder('shift_jis').decode(buf);
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
    let txt=gv(1,'')||'';
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
  tx=W/2-((bb.minx+bb.maxx)/2)*s;
  ty=H/2+((bb.miny+bb.maxy)/2)*s;
}

// =========================================================
// 描画
// =========================================================
function scheduleDraw(){needDraw=true;needOverlay=true;if(!rafId)rafId=requestAnimationFrame(rafLoop);}
function scheduleOverlay(){needOverlay=true;if(!rafId)rafId=requestAnimationFrame(rafLoop);}
function rafLoop(){
  rafId=null;
  if(needDraw){draw();needDraw=false;}
  if(needOverlay){drawOverlay();needOverlay=false;}
}

function draw(){
  const dpr=window.devicePixelRatio||1;
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.save();
  ctx.scale(dpr,dpr);
  const W=cv.width/dpr, H=cv.height/dpr;
  const darkBg=!bwMode;
  ctx.fillStyle=bwMode?'#ffffff':'#1e2430';
  ctx.fillRect(0,0,W,H);
  if(!doc&&!pdfImage){ctx.restore();return;}
  if(pdfImage){
    const[sx,sy]=w2s(pdfImage.wx,pdfImage.wy);
    ctx.drawImage(pdfImage.img,sx,sy,pdfImage.ww*scale,pdfImage.wh*scale);
  }
  if(!doc){ctx.restore();return;}
  const mg=60; // ビューポート余白px
  // Solids
  for(const e of doc.solid){
    if(hiddenLayers.has(e.layer)) continue;
    const pts=e.pts.filter(p=>isFinite(p.x)&&isFinite(p.y));
    if(pts.length<3) continue;
    ctx.beginPath();
    const[sx0,sy0]=w2s(pts[0].x,pts[0].y);ctx.moveTo(sx0,sy0);
    for(let i=1;i<pts.length;i++){const[sx,sy]=w2s(pts[i].x,pts[i].y);ctx.lineTo(sx,sy);}
    ctx.closePath();
    ctx.fillStyle=bwMode?'#cccccc':rgbCss(e.color,darkBg);ctx.fill();
  }
  // Lines（ビューポートカリング: 画面外スキップ）
  for(const e of doc.sen){
    if(hiddenLayers.has(e.layer)) continue;
    const sx1=e.x1*scale+tx,sy1=-e.y1*scale+ty;
    const sx2=e.x2*scale+tx,sy2=-e.y2*scale+ty;
    if(Math.max(sx1,sx2)<-mg||Math.min(sx1,sx2)>W+mg||Math.max(sy1,sy2)<-mg||Math.min(sy1,sy2)>H+mg) continue;
    ctx.beginPath();
    ctx.strokeStyle=bwMode?'#000000':rgbCss(e.color,darkBg);
    ctx.lineWidth=Math.max(0.8,e.lw*scale*1.4);
    ctx.setLineDash(e.dash&&e.dash.length>0?e.dash.map(d=>d*scale):[]);
    ctx.moveTo(sx1,sy1);ctx.lineTo(sx2,sy2);ctx.stroke();
  }
  // Arcs（ビューポートカリング: 外接矩形で判定）
  for(const e of doc.enko){
    if(hiddenLayers.has(e.layer)) continue;
    const scx=e.cx*scale+tx,scy=-e.cy*scale+ty,sr2=e.r*scale;
    if(scx+sr2<-mg||scx-sr2>W+mg||scy+sr2<-mg||scy-sr2>H+mg) continue;
    ctx.beginPath();
    ctx.strokeStyle=bwMode?'#000000':rgbCss(e.color,darkBg);
    ctx.lineWidth=Math.max(0.8,e.lw*scale*1.4);
    ctx.setLineDash(e.dash&&e.dash.length>0?e.dash.map(d=>d*scale):[]);
    drawArc(ctx,e);ctx.stroke();
  }
  ctx.setLineDash([]);
  // Points（ビューポートカリング）
  for(const e of doc.ten){
    if(hiddenLayers.has(e.layer)) continue;
    const sxt=e.x*scale+tx,syt=-e.y*scale+ty;
    if(sxt<-mg||sxt>W+mg||syt<-mg||syt>H+mg) continue;
    ctx.beginPath();ctx.arc(sxt,syt,3,0,Math.PI*2);
    ctx.fillStyle=bwMode?'#000000':rgbCss(e.color,darkBg);ctx.fill();
  }
  // Text（ビューポートカリング）
  for(const e of doc.moji){
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
async function loadPDF(buf){
  if(typeof pdfjsLib==='undefined'){alert('PDF.jsが読み込まれていません');return;}
  pdfDoc=await pdfjsLib.getDocument({data:buf}).promise;
  document.getElementById('pdfPageCtrl').style.display='';
  document.getElementById('pageInfo').textContent=`1/${pdfDoc.numPages}`;
  pdfPageNum=1;
  await renderPdfPage(1);
}

async function renderPdfPage(n){
  if(!pdfDoc) return;
  const page=await pdfDoc.getPage(n);
  const vp=page.getViewport({scale:3});
  const offscreen=document.createElement('canvas');
  offscreen.width=vp.width;offscreen.height=vp.height;
  await page.render({canvasContext:offscreen.getContext('2d'),viewport:vp}).promise;
  pdfImage={img:offscreen,wx:0,wy:vp.height/3,ww:vp.width/3,wh:vp.height/3};
  fit();scheduleDraw();
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
  ov.style.width=W+'px'; ov.style.height=H+'px';
  // 内部解像度だけdpr倍にする
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
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
