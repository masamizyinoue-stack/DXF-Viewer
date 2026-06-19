// measurement.js — DXF Viewer 計測モジュール
// V0_43ベース: 機能変更なし、コード分離のみ
// 依存グローバル: doc, hiddenLayers, scale, tx, ty, dims,
//                 w2s, s2w, scheduleOverlay, scheduleDraw,
//                 snapshot, scheduleSave, showGuide, ov

// =========================================================
// 寸法描画・スナップ・寸法構築
// =========================================================
function drawDimEntity(ctx,d){
  const _ps=window._pdfScale||1;  // ② PDF高解像度スケール
  ctx.strokeStyle=d.color||'#f39c12';ctx.fillStyle=d.color||'#f39c12';
  ctx.lineWidth=1.5*_ps;ctx.setLineDash([]);
  for(const l of d.lines){
    const[sx1,sy1]=w2s(l.x1,l.y1);const[sx2,sy2]=w2s(l.x2,l.y2);
    ctx.beginPath();ctx.moveTo(sx1,sy1);ctx.lineTo(sx2,sy2);ctx.stroke();
  }
  for(const a of d.arrows){
    const[sx,sy]=w2s(a.x,a.y);
    const as=10*_ps;  // 矢印サイズ
    ctx.save();ctx.translate(sx,sy);ctx.rotate(a.angle);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-as,as*0.4);ctx.lineTo(-as,-as*0.4);ctx.closePath();ctx.fill();ctx.restore();
  }
  if(d.text){
    const[sx,sy]=w2s(d.tx,d.ty);
    ctx.save();ctx.translate(sx,sy);ctx.rotate(d.tangle||0);
    const fs=17*_ps;
    ctx.font='bold '+fs+'px sans-serif';
    ctx.textAlign='center';ctx.textBaseline='bottom';
    const tw=ctx.measureText(d.text).width;
    const gap=14*_ps;
    ctx.fillStyle='rgba(18,26,42,0.82)';
    ctx.fillRect(-tw/2-6*_ps,-gap-19*_ps,tw+12*_ps,21*_ps);
    ctx.fillStyle=d.color||'#f39c12';
    ctx.fillText(d.text,0,-gap);
    ctx.restore();
  }
  // ⑤ 芯マーク（直径・半径寸法の中心点）
  if(d.centerMark){
    const[scx,scy]=w2s(d.centerMark.cx,d.centerMark.cy);
    const cs=10*_ps;  // 十字の腕の長さ
    const cr=3.5*_ps; // 中心小円の半径
    ctx.save();
    ctx.strokeStyle=d.color||'#00d4ff';
    ctx.lineWidth=1.5*_ps;
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(scx-cs,scy);ctx.lineTo(scx+cs,scy);ctx.stroke();
    ctx.beginPath();ctx.moveTo(scx,scy-cs);ctx.lineTo(scx,scy+cs);ctx.stroke();
    ctx.beginPath();ctx.arc(scx,scy,cr,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
}

// =========================================================
// スナップ (優先度付き: 交点>端点>中心>中点)
// =========================================================
function lineIntersect(x1,y1,x2,y2,x3,y3,x4,y4){
  const d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
  if(Math.abs(d)<1e-10) return null;
  const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d;
  const u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/d;
  if(t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9)
    return{x:x1+t*(x2-x1),y:y1+t*(y2-y1)};
  return null;
}
function distToSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy;
  if(len2<1e-12) return Math.hypot(px-x1,py-y1);
  const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/len2));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
function snapAt(wx,wy){
  if(!doc) return null;
  const sr=24/scale;
  const BN={int:sr*0.55,end:sr*0.35,ten:sr*0.40,cen:sr*0.20,mid:sr*0.05};
  let best=null,bestScore=sr;
  function check(x,y,type){
    if(!isFinite(x)||!isFinite(y)) return;
    const d=Math.hypot(x-wx,y-wy);
    if(d>sr) return;
    const score=d-(BN[type]||0);
    if(score<bestScore){bestScore=score;best={x,y,type};}
  }
  // キャッシュ+二分探索: X範囲を絞り込んでO(log n+m)で検索
  function checkArr(arr,type){
    const xlo=wx-sr;
    let lo=0,hi=arr.length;
    while(lo<hi){const m=(lo+hi)>>1;if(arr[m].x<xlo)lo=m+1;else hi=m;}
    for(let i=lo;i<arr.length&&arr[i].x<=wx+sr;i++){
      if(hiddenLayers.has(arr[i].layer)) continue;
      check(arr[i].x,arr[i].y,type);
    }
  }
  // キャッシュが空（レイヤ変更後など）なら再構築
  if(_scEndPts.length===0&&doc.sen.length>0) buildSnapCache();
  checkArr(_scEndPts,'end');
  checkArr(_scMidPts,'mid');
  checkArr(_scCenPts,'cen');
  // 交点: 付近の線分のみ（軽量モードで上限を抑える）
  const maxInt=perfMode?25:80;
  const near=doc.sen.filter(e=>!hiddenLayers.has(e.layer)&&distToSeg(wx,wy,e.x1,e.y1,e.x2,e.y2)<sr*1.5);
  const lim=Math.min(near.length,maxInt);
  outer:for(let i=0;i<lim;i++){
    for(let j=i+1;j<lim;j++){
      const a=near[i],b=near[j];
      const ix=lineIntersect(a.x1,a.y1,a.x2,a.y2,b.x1,b.y1,b.x2,b.y2);
      if(ix) check(ix.x,ix.y,'int');
      if(bestScore<-sr*0.2) break outer;
    }
  }
  // 点要素(POINT/ten)スナップ
  if(doc.ten){
    for(var _ti=0;_ti<doc.ten.length;_ti++){
      var _te=doc.ten[_ti];
      if(hiddenLayers.has(_te.layer)) continue;
      check(_te.x,_te.y,'ten');
    }
  }
  return best;
}

// =========================================================
// 寸法構築
// =========================================================
function buildDim(p1,p2,pArrow,type){
  const sd=parseFloat(document.getElementById('scaleDenom').value)||1;
  const lines=[],arrows=[];
  let text='',tx2=0,ty2=0,tangle=0;
  if(type==='dx'){
    const y=pArrow.y;
    lines.push({x1:p1.x,y1:p1.y,x2:p1.x,y2:y});
    lines.push({x1:p2.x,y1:p2.y,x2:p2.x,y2:y});
    lines.push({x1:p1.x,y1:y,x2:p2.x,y2:y});
    text=formatDim(Math.abs(p2.x-p1.x)/sd);
    const dir=p2.x>p1.x?0:Math.PI;
    arrows.push({x:p1.x,y,angle:Math.PI-dir});arrows.push({x:p2.x,y,angle:-dir});
    tx2=(p1.x+p2.x)/2;ty2=y;tangle=0;
  } else if(type==='dy'){
    const x=pArrow.x;
    lines.push({x1:p1.x,y1:p1.y,x2:x,y2:p1.y});
    lines.push({x1:p2.x,y1:p2.y,x2:x,y2:p2.y});
    lines.push({x1:x,y1:p1.y,x2:x,y2:p2.y});
    text=formatDim(Math.abs(p2.y-p1.y)/sd);
    const dir=p2.y>p1.y?Math.PI/2:-Math.PI/2;
    arrows.push({x,y:p1.y,angle:-dir+Math.PI});arrows.push({x,y:p2.y,angle:-dir});
    tx2=x;ty2=(p1.y+p2.y)/2;tangle=-Math.PI/2;
  } else {
    // diag: 斜め距離寸法。正確な幾何計算（オフセット寸法線＋補助線2本＋矢印2個）
    const dx=p2.x-p1.x,dy=p2.y-p1.y;
    const len=Math.hypot(dx,dy);
    if(len<1e-9) return null;
    const ux=dx/len,uy=dy/len;
    // 法線ベクトル（左90度）
    const nx2=-uy,ny2=ux;
    const midX=(p1.x+p2.x)/2,midY=(p1.y+p2.y)/2;
    // pArrow が未指定またはp2と同じ場合は法線方向50px先をデフォルト位置に
    const pRef=(pArrow&&(pArrow.x!==p2.x||pArrow.y!==p2.y))
      ?pArrow:{x:midX+nx2*50/scale,y:midY+ny2*50/scale};
    // p3のオフセット量（法線方向への射影）
    const offset2=(pRef.x-midX)*nx2+(pRef.y-midY)*ny2;
    // 寸法線端点
    const ep1x=p1.x+nx2*offset2,ep1y=p1.y+ny2*offset2;
    const ep2x=p2.x+nx2*offset2,ep2y=p2.y+ny2*offset2;
    // 補助線（寸法線外側に少しはみ出す）
    const ext2=8/scale;
    const sig2=offset2>=0?1:-1;
    const a1=Math.atan2(uy,-ux),a2=Math.atan2(-uy,ux);  // スクリーン空間: Y軸反転考慮
    text=formatDim(len/sd);
    tx2=pRef.x;ty2=pRef.y;
    // 寸法線方向角度（drawDimEntityのctx.rotateで使用）
    var screenAng=Math.atan2(-uy,ux);  // Y軸反転を考慮したスクリーン空間の角度
    // 文字が逆さにならないよう-90°〜90°の範囲に正規化
    tangle=(screenAng>Math.PI/2)?screenAng-Math.PI:(screenAng<-Math.PI/2)?screenAng+Math.PI:screenAng;
    lines.push({x1:ep1x,y1:ep1y,x2:ep2x,y2:ep2y});
    lines.push({x1:p1.x,y1:p1.y,x2:ep1x+nx2*sig2*ext2,y2:ep1y+ny2*sig2*ext2});
    lines.push({x1:p2.x,y1:p2.y,x2:ep2x+nx2*sig2*ext2,y2:ep2y+ny2*sig2*ext2});
    // 引出線: 寸法値が寸法線範囲外の場合、端点からpRefへ引出
    const tRef2=(pRef.x-p1.x)*ux+(pRef.y-p1.y)*uy;
    if(tRef2<-1/scale) lines.push({x1:ep1x,y1:ep1y,x2:pRef.x,y2:pRef.y});
    else if(tRef2>len+1/scale) lines.push({x1:ep2x,y1:ep2y,x2:pRef.x,y2:pRef.y});
    arrows.push({x:ep1x,y:ep1y,angle:a1});arrows.push({x:ep2x,y:ep2y,angle:a2});
  }
  return {lines,arrows,text,tx:tx2,ty:ty2,tangle,color:window.currentDimColor||'#f39c12'};
}

function formatDim(d){
  // 小数第1位まで四捨五入。.0の場合は小数点ごと省略
  var v=Math.round(d*10)/10;
  return (v%1===0)?String(Math.round(v)):v.toFixed(1);
}

// ── B. 拡張スナップ（円-直線交点・円-円交点） ──────────────────────────
;(function(){
  var _origSnapAt=snapAt;
  window.snapAt=function(wx,wy){
    var base=_origSnapAt(wx,wy);
    if(!doc) return base;
    var extras=[];
    var sr=24/scale;
    var sen=doc.sen||[], enko=doc.enko||[];

    // 円-直線交点
    enko.forEach(function(c){
      if(hiddenLayers.has(c.layer)) return;
      sen.forEach(function(e){
        if(hiddenLayers.has(e.layer)) return;
        var pts=circLineIntersect(c.cx,c.cy,c.r,e.x1,e.y1,e.x2,e.y2,c.a1,c.a2);
        pts.forEach(function(p){
          var d=Math.hypot(wx-p.x,wy-p.y);
          if(d<sr) extras.push({x:p.x,y:p.y,type:'cxl',dist:d,onLine:e});
        });
      });
    });

    // 円-円交点
    for(var i=0;i<enko.length;i++){
      for(var j=i+1;j<enko.length;j++){
        var c1=enko[i],c2=enko[j];
        if(hiddenLayers.has(c1.layer)||hiddenLayers.has(c2.layer)) continue;
        var pts=circCircIntersect(c1.cx,c1.cy,c1.r,c2.cx,c2.cy,c2.r,c1.a1,c1.a2,c2.a1,c2.a2);
        pts.forEach(function(p){
          var d=Math.hypot(wx-p.x,wy-p.y);
          if(d<sr) extras.push({x:p.x,y:p.y,type:'cxc',dist:d});
        });
      }
    }

    if(extras.length===0) return base;
    extras.sort(function(a,b){return a.dist-b.dist;});
    var best=extras[0];
    if(!base || best.dist<Math.hypot(wx-base.x,wy-base.y)-0.5){
      return best;
    }
    return base;
  };

  function arcAngleOk(px,py,cx,cy,a1,a2){
    // フル円(a1=0,a2=360)は常にOK
    if(a1===0&&a2===360) return true;
    var ang=Math.atan2(py-cy,px-cx)*180/Math.PI;
    ang=((ang%360)+360)%360;
    if(a1<=a2) return ang>=a1&&ang<=a2;
    return ang>=a1||ang<=a2; // 折り返しアーク
  }
  function circLineIntersect(cx,cy,r,x1,y1,x2,y2,a1,a2){
    if(a1===undefined) a1=0;
    if(a2===undefined) a2=360;
    var dx=x2-x1,dy=y2-y1,fx=x1-cx,fy=y1-cy;
    var a=dx*dx+dy*dy,b=2*(fx*dx+fy*dy),c=fx*fx+fy*fy-r*r;
    var disc=b*b-4*a*c;
    if(disc<0) return [];
    var res=[],sd=Math.sqrt(disc);
    [-1,1].forEach(function(s){
      var t=(-b+s*sd)/(2*a);
      if(t>=-0.001&&t<=1.001){
        var px=x1+t*dx,py=y1+t*dy;
        if(arcAngleOk(px,py,cx,cy,a1,a2)) res.push({x:px,y:py});
      }
    });
    return res;
  }

  function circCircIntersect(cx1,cy1,r1,cx2,cy2,r2,a1_1,a2_1,a1_2,a2_2){
    if(a1_1===undefined) a1_1=0; if(a2_1===undefined) a2_1=360;
    if(a1_2===undefined) a1_2=0; if(a2_2===undefined) a2_2=360;
    var dx=cx2-cx1,dy=cy2-cy1,d=Math.hypot(dx,dy);
    if(d>r1+r2+1e-9||d<Math.abs(r1-r2)-1e-9||d<1e-9) return [];
    var a=(r1*r1-r2*r2+d*d)/(2*d);
    var h2=r1*r1-a*a;
    if(h2<0) return [];
    var h=Math.sqrt(h2);
    var mx=cx1+a*dx/d,my=cy1+a*dy/d;
    var cands=(h<1e-9)?[{x:mx,y:my}]:[{x:mx+h*dy/d,y:my-h*dx/d},{x:mx-h*dy/d,y:my+h*dx/d}];
    return cands.filter(function(p){
      return arcAngleOk(p.x,p.y,cx1,cy1,a1_1,a2_1)&&arcAngleOk(p.x,p.y,cx2,cy2,a1_2,a2_2);
    });
  }
})();

// ── C. 統一計測UX（circDim / radDim） ──────────────────────────────
;(function(){
// ─ 状態 ────────────────────────────────────────────
var DIM={
  active:false, tool:'', phase:0,
  pts:[], penDown:false, cur:null, downSnapPt:null
};

var GUIDES={
  P1:'1点目を選択（ペンを当てて探索→離して確定）',
  P2:'2点目を選択（ペンを当てて探索→離して確定）',
  POS:'寸法位置を指定（ペンを移動→離して確定）',
  CIRC:'円の円周にペンを近づける→離して確定→位置を指定',
  RAD:'円または円弧を選択→離して確定→半径線の位置を指定',
};

function resetDIM(){
  DIM.active=false; DIM.tool=''; DIM.phase=0;
  DIM.pts=[]; DIM.penDown=false; DIM.cur=null; DIM.downSnapPt=null;
  DIM._hoverPos=null;
}

// ─ ツール切り替えのフック ────────────────────────
// 既存ツール切り替え(.tool-btn click)の後に発火するよう遅延登録
document.querySelectorAll('.tool-btn[data-tool]').forEach(function(btn){
  btn.addEventListener('click',function(){
    var t=this.dataset.tool;
    resetDIM();
    if(t==='circDim'||t==='radDim'){
      DIM.active=true; DIM.tool=t; DIM.phase=0;
      if(t==='circDim'){ showGuide(GUIDES.CIRC); console.log('Diameter Mode'); }
      else if(t==='radDim'){ showGuide(GUIDES.RAD); console.log('Radius Mode'); }
    }
  });
});

// ─ drawOverlay フック ─────────────────────────────
var _origDO=drawOverlay;
window.drawOverlay=function(){
  _origDO();
  if(DIM.active) drawDIMOverlay();
};

// snapPt のラベルマップ拡張（既存に追加）
var SNAP_COLORS={
  'end':'#00ff7f','int':'#ffd700','cen':'#00f0ff','mid':'#ffbb33',
  'ten':'#ff6b6b',
  'cxl':'#ff88cc','cxc':'#ffcc44','default':'#f39c12'
};

function drawDIMOverlay(){
  var dpr=window.devicePixelRatio||1;
  octx.save();
  octx.scale(dpr,dpr);

  // circDim phase=0 時: 近傍の円をハイライト
  if(DIM.tool==='circDim'&&DIM.phase===0&&doc&&doc.enko){
    // ホバー中の最近傍円をオレンジハイライト（DIM.cur の有無に関わらず _hoverPos を使用）
    var _hp=DIM._hoverPos;
    if(_hp){
      var nearEnk=findNearestCircleEdge(_hp.x,_hp.y);
      if(nearEnk){
        var hsc=w2s(nearEnk.cx,nearEnk.cy);
        var hr=nearEnk.r*scale;
        octx.save();
        octx.strokeStyle='#FF8C00';  // オレンジ
        octx.lineWidth=3;
        octx.beginPath(); octx.arc(hsc[0],hsc[1],hr,0,Math.PI*2); octx.stroke();
        octx.restore();
      }
    }
  }

  // radDim phase=0 時: 近傍の円をシアンハイライト
  if(DIM.tool==='radDim'&&DIM.phase===0&&doc&&doc.enko){
    var _rhp=DIM._hoverPos;
    if(_rhp){
      var rNearEnk=findNearestCircleEdge(_rhp.x,_rhp.y);
      if(rNearEnk){
        var rhsc=w2s(rNearEnk.cx,rNearEnk.cy);
        var rhr=rNearEnk.r*scale;
        octx.save();
        octx.strokeStyle='#00ffcc';
        octx.lineWidth=2.5;
        octx.setLineDash([6,3]);
        octx.beginPath(); octx.arc(rhsc[0],rhsc[1],rhr,0,Math.PI*2); octx.stroke();
        octx.setLineDash([]);
        octx.restore();
      }
    }
  }

  // カーソル位置のスナップマーカー
  var snap=DIM.cur;
  if(snap){
    var sc=w2s(snap.x,snap.y);
    var snapType=snap.type||(snap.kind==='line'?'on_line':snap.kind==='arc'?'on_arc':null)||snap.type;
    drawExtSnapMarker(octx,sc[0],sc[1],snapType);
  }

  // 確定済み点のマーカー
  DIM.pts.forEach(function(p,idx){
    var sc=w2s(p.x,p.y);
    octx.fillStyle='#00d4ff'; octx.strokeStyle='#00d4ff';
    octx.lineWidth=2;
    octx.beginPath(); octx.arc(sc[0],sc[1],5,0,Math.PI*2); octx.fill();
    octx.font='bold 12px sans-serif'; octx.textAlign='left'; octx.textBaseline='bottom';
    octx.fillText('P'+(idx+1),sc[0]+8,sc[1]-2);
  });

  // フェーズ2: 位置指定プレビュー
  if(DIM.phase===2 && DIM.cur){
    drawDIMPreview(octx);
  }

  octx.restore();
}

function drawExtSnapMarker(ctx,sx,sy,type){
  var col=SNAP_COLORS[type]||SNAP_COLORS.default;
  ctx.save();
  ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=2;
  // cxl, cxc は既存と異なるマーカー形状
  if(type==='ten'){
    // 点要素: 二重円（小さな塗り円 + 外枠円）
    ctx.beginPath(); ctx.arc(sx,sy,8,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx,sy,3,0,Math.PI*2); ctx.fill();
  } else if(type==='cxl'){
    ctx.beginPath();
    ctx.moveTo(sx-8,sy-8); ctx.lineTo(sx+8,sy+8);
    ctx.moveTo(sx+8,sy-8); ctx.lineTo(sx-8,sy+8);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(sx,sy,4,0,Math.PI*2); ctx.stroke();
  } else if(type==='cxc'){
    ctx.beginPath(); ctx.arc(sx,sy,8,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx,sy,3,0,Math.PI*2); ctx.fill();
  }
  // ラベル
  var lbl={ten:'点要素',cxl:'円-線交点',cxc:'円-円交点'}[type]||'';
  if(lbl){
    ctx.font='bold 11px sans-serif';
    var tw=ctx.measureText(lbl).width;
    ctx.fillStyle='rgba(0,0,0,0.72)';
    ctx.fillRect(sx+15,sy-19,tw+8,17);
    ctx.fillStyle=col;
    ctx.textAlign='left'; ctx.textBaseline='bottom';
    ctx.fillText(lbl,sx+19,sy-4);
  }
  ctx.restore();
}

function drawDIMPreview(ctx){
  var p3=DIM.cur;
  if(!p3) return;
  var prevDim=null;
  try{
    if(DIM.tool==='circDim'){
      if(DIM.pts.length>=1&&DIM.pts[0].ent){
        prevDim=buildCircDimPhi(DIM.pts[0].ent,p3);
      }
    } else if(DIM.tool==='radDim'){
      if(DIM.pts.length>=1&&DIM.pts[0].ent){
        prevDim=buildRadDim(DIM.pts[0].ent,p3);
      }
    }
  }catch(e){ console.warn('[DIM preview]',e); }
  if(!prevDim||!prevDim.lines) return;

  ctx.save();
  ctx.strokeStyle='rgba(0,212,255,0.75)';
  ctx.lineWidth=1.5; ctx.setLineDash([5,3]); ctx.lineCap='round';
  prevDim.lines.forEach(function(l){
    var s1=w2s(l.x1,l.y1),s2=w2s(l.x2,l.y2);
    ctx.beginPath(); ctx.moveTo(s1[0],s1[1]); ctx.lineTo(s2[0],s2[1]); ctx.stroke();
  });
  ctx.setLineDash([]);
  // 矢印プレビュー（circDim/radDim）
  if(prevDim.arrows){
    ctx.fillStyle='rgba(0,212,255,0.85)';
    prevDim.arrows.forEach(function(a){
      var sa=w2s(a.x,a.y);
      ctx.save();ctx.translate(sa[0],sa[1]);ctx.rotate(a.angle);
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-10,4);ctx.lineTo(-10,-4);ctx.closePath();ctx.fill();ctx.restore();
    });
  }
  if(prevDim.text&&prevDim.tx!=null){
    var stx=w2s(prevDim.tx,prevDim.ty);
    ctx.font='bold 17px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    var tw=ctx.measureText(prevDim.text).width;
    ctx.fillStyle='rgba(0,20,40,0.65)';
    ctx.fillRect(stx[0]-tw/2-3,stx[1]-10,tw+6,20);
    ctx.fillStyle='rgba(0,212,255,0.85)';
    ctx.fillText(prevDim.text,stx[0],stx[1]);
  }
  // ⑤ 芯マーク プレビュー
  if(prevDim.centerMark){
    var scm=w2s(prevDim.centerMark.cx,prevDim.centerMark.cy);
    ctx.strokeStyle='rgba(0,212,255,0.8)';ctx.lineWidth=1.5;ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(scm[0]-10,scm[1]);ctx.lineTo(scm[0]+10,scm[1]);ctx.stroke();
    ctx.beginPath();ctx.moveTo(scm[0],scm[1]-10);ctx.lineTo(scm[0],scm[1]+10);ctx.stroke();
    ctx.beginPath();ctx.arc(scm[0],scm[1],3.5,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}

// ─ φ寸法構築 ────────────────────────────────────
function buildCircDimPhi(ent,p3){
  var cx=ent.cx,cy=ent.cy,r=ent.r;
  // p3方向の角度
  var ang=Math.atan2(p3.y-cy,p3.x-cx);
  var ux=Math.cos(ang),uy=Math.sin(ang);
  // 直径線の端点（円周上）
  var p1x=cx-r*ux,p1y=cy-r*uy; // p3と反対側
  var p2x=cx+r*ux,p2y=cy+r*uy; // p3に近い側
  var sd=parseFloat(document.getElementById('scaleDenom').value)||1;
  var ext=6/scale; // 補助線のはみ出し量
  // p3が円外にある場合は寸法線をp3まで延長
  var distP3=Math.hypot(p3.x-cx,p3.y-cy);
  var ep2x=(distP3>r+ext)?p3.x:p2x+ux*ext;
  var ep2y=(distP3>r+ext)?p3.y:p2y+uy*ext;
  // p3が円外の反対側延長もext分はみ出す
  var ep1x=p1x-ux*ext, ep1y=p1y-uy*ext;
  // スクリーン空間の角度: w2sがY軸反転するため atan2(-uy, ux) を使用
  var screenAng=Math.atan2(-uy,ux);
  var tangle=(screenAng>Math.PI/2)?screenAng-Math.PI:(screenAng<-Math.PI/2)?screenAng+Math.PI:screenAng;
  return{
    lines:[{x1:ep1x,y1:ep1y,x2:ep2x,y2:ep2y}],
    arrows:[{x:p1x,y:p1y,angle:screenAng+Math.PI},{x:p2x,y:p2y,angle:screenAng}],
    text:'φ'+formatDim(r*2/sd),
    tx:p3.x,ty:p3.y,tangle:tangle,type:'phi',color:window.currentDimColor||'#f39c12',
    centerMark:{cx:cx,cy:cy}  // ⑤ 芯マーク
  };
}



function findEnkoAt(wx,wy){
  if(!doc||!doc.enko) return null;
  var best=null,bd=Infinity;
  doc.enko.forEach(function(e){
    var d=Math.abs(Math.hypot(wx-e.cx,wy-e.cy)-e.r);
    if(d<bd){bd=d;best=e;}
  });
  return bd<10/scale?best:null;
}

function findNearestCircleEdge(wx,wy){
  if(!doc||!doc.enko) return null;
  var THRESH=24/scale; // 円周から24px以内
  var best=null,bd=Infinity;
  doc.enko.forEach(function(e){
    if(hiddenLayers&&hiddenLayers.has(e.layer)) return;
    var distToEdge=Math.abs(Math.hypot(wx-e.cx,wy-e.cy)-e.r);
    if(distToEdge<THRESH&&distToEdge<bd){bd=distToEdge;best=e;}
  });
  return best;
}



function confirmDIM(p3){
  var p1=DIM.pts[0],p2=DIM.pts[1];
  var d=null;
  console.log('[DIM] confirmDIM tool='+DIM.tool+' p1=',p1,' p2=',p2,' p3=',p3);
  try{
    if(DIM.tool==='circDim'&&p1.ent){
      d=buildCircDimPhi(p1.ent,p3);
      console.log('Dimension Created', d);
    } else if(DIM.tool==='radDim'&&p1&&p1.ent){
      d=buildRadDim(p1.ent,p3);
      console.log('Dimension Created', d);
    }
  }catch(err){ console.warn('[DIM confirm]',err); }

  if(d){
    snapshot();
    dims.push(d);
    scheduleSave(); scheduleDraw();
    showGuide('寸法を追加しました ↩ で取消', 2000);
  }
  // 次の寸法へ
  DIM.pts=[]; DIM.phase=0; DIM.cur=null;
  var nextGuide=DIM.tool==='circDim'?GUIDES.CIRC:GUIDES.RAD;
  setTimeout(function(){
    if(DIM.active) showGuide(nextGuide);
  },2000);
  scheduleOverlay();
}

// ─ R寸法構築 ────────────────────────────────────
function buildRadDim(ent,p3){
  var cx=ent.cx,cy=ent.cy,r=ent.r;
  var ang=Math.atan2(p3.y-cy,p3.x-cx);
  var ux=Math.cos(ang),uy=Math.sin(ang);
  var ex=cx+r*ux,ey=cy+r*uy; // 円周上の端点
  var sd=parseFloat(document.getElementById('scaleDenom').value)||1;
  var ext=6/scale; // 補助線のはみ出し量
  // p3が円外にある場合は半径線をp3まで延長
  var distP3=Math.hypot(p3.x-cx,p3.y-cy);
  var ep2x=(distP3>r+ext)?p3.x:ex+ux*ext;
  var ep2y=(distP3>r+ext)?p3.y:ey+uy*ext;
  // スクリーン空間の角度: w2sがY軸反転するため atan2(-uy, ux) を使用
  var screenAng=Math.atan2(-uy,ux);
  var tangle=(screenAng>Math.PI/2)?screenAng-Math.PI:(screenAng<-Math.PI/2)?screenAng+Math.PI:screenAng;
  return{
    lines:[{x1:cx,y1:cy,x2:ep2x,y2:ep2y}],
    arrows:[{x:ex,y:ey,angle:screenAng+Math.PI}], // 円周上で内向き（中心方向）
    text:'R'+formatDim(r/sd),
    tx:p3.x,ty:p3.y,tangle:tangle,type:'rad',color:window.currentDimColor||'#f39c12',
    centerMark:{cx:cx,cy:cy}  // ⑤ 芯マーク
  };
}

// ─ window.DIM 公開（タッチ/マウス連携用） ──────────────────────
DIM.handleDown = function(sx, sy) {
  var wp = s2w(sx, sy);
  var snp = snapAt(wp[0], wp[1]);
  DIM.penDown = true;
  DIM.downSnapPt = snp;
  DIM.cur = snp || {x: wp[0], y: wp[1], type: 'default'};
  console.log('[DIM] handleDown phase=' + DIM.phase + ' tool=' + DIM.tool);
  scheduleOverlay();
};

DIM.handleMove = function(sx, sy) {
  var wp = s2w(sx, sy);
  // _hoverPos は penDown 不要で常時更新（circDim ハイライト用）
  DIM._hoverPos = {x: wp[0], y: wp[1]};
  if (!DIM.penDown) { scheduleOverlay(); return; }
  var snp = snapAt(wp[0], wp[1]);
  DIM.cur = snp || {x: wp[0], y: wp[1], type: 'default'};
  scheduleOverlay();
};

DIM.handleUp = function(sx, sy) {
  if (!DIM.penDown) return;
  DIM.penDown = false;
  // プレビューと確定位置を一致させる: 最後のmoveで確定したDIM.curをそのまま使う
  // handleUpで再計算すると表示位置と異なるスナップが選ばれる可能性がある
  var pt = DIM.cur;
  if (!pt) {
    var wp = s2w(sx, sy);
    pt = {x: wp[0], y: wp[1], type: 'default'};
  }

  if (DIM.phase === 0) {
    var entry = {x: pt.x, y: pt.y, kind: 'pt'};
    if (DIM.tool === 'circDim') {
      var ent = null;
      if (pt.type === 'cen' && doc) ent = findEnkoAt(pt.x, pt.y);
      if (!ent) ent = findNearestCircleEdge(pt.x, pt.y);
      if (ent) {
        entry.kind = 'circ'; entry.ent = ent;
        entry.x = ent.cx; entry.y = ent.cy;
        DIM.pts = [entry]; DIM.phase = 2;
        showGuide(GUIDES.POS);
        console.log('[DIM] circDim: circle selected', ent);
        console.log('Target Selected', ent);
        DIM.cur = null; scheduleOverlay(); return;
      } else {
        showGuide('円の近くにペンを当ててください', 1500);
        DIM.cur = null; scheduleOverlay(); return;
      }
    }
    if (DIM.tool === 'radDim') {
      var rent_ = findNearestCircleEdge(pt.x, pt.y);
      if (rent_) {
        entry.kind = 'circ'; entry.ent = rent_;
        entry.x = rent_.cx; entry.y = rent_.cy;
        DIM.pts = [entry]; DIM.phase = 2;
        showGuide(GUIDES.POS);
        console.log('[DIM] radDim: circle selected', rent_);
        console.log('Target Selected', rent_);
        DIM.cur = null; scheduleOverlay(); return;
      } else {
        showGuide('円の近くにペンを当ててください', 1500);
        DIM.cur = null; scheduleOverlay(); return;
      }
    }
    DIM.pts = [entry]; DIM.phase = 1;
    showGuide(GUIDES.P2);
    DIM.cur = null; scheduleOverlay();

  } else if (DIM.phase === 1) {
    var entry2 = {x: pt.x, y: pt.y, kind: 'pt'};
    DIM.pts.push(entry2); DIM.phase = 2;
    showGuide(GUIDES.POS);
    DIM.cur = null; scheduleOverlay();

  } else if (DIM.phase === 2) {
    confirmDIM(pt);
  }
};

window.DIM = DIM;
console.log('[DIM] module initialized');

})(); // end C

// ── D. 線と点 距離寸法 ──────────────────────────────────────────────────────
;(function(){

// ─ 状態 ────────────────────────────────────────────
var LP={
  active:false, phase:0,
  selLine:null, selPt:null, footPt:null,
  penDown:false,
  cur:null,        // phase1: スナップ候補(null=候補なし) / phase2: 寸法位置
  _hoverLine:null, // phase0: ハイライト中の線エンティティ（表示=確定に使用）
  _hoverPos:null   // 最新カーソル位置
};

var LP_GUIDES={
  LINE:'線の近くにペンを当てて選択（離して確定）',
  PT:  'スナップ点を選択（候補点→離して確定）',
  POS: '寸法位置を指定（移動→離して確定）',
};

function resetLP(){
  LP.active=false; LP.phase=0;
  LP.selLine=null; LP.selPt=null; LP.footPt=null;
  LP.penDown=false; LP.cur=null; LP._hoverLine=null; LP._hoverPos=null;
}

// ─ 垂線の足 ─────────────────────────────────────────
function computeFoot(line,pt){
  var dx=line.x2-line.x1,dy=line.y2-line.y1,len2=dx*dx+dy*dy;
  if(len2<1e-12) return {x:line.x1,y:line.y1};
  var t=((pt.x-line.x1)*dx+(pt.y-line.y1)*dy)/len2;
  return {x:line.x1+t*dx,y:line.y1+t*dy};
}

// ─ 最近傍線 ─────────────────────────────────────────
function findNearestSen(wx,wy){
  if(!doc||!doc.sen) return null;
  var sr=30/scale,best=null,bestDist=sr;
  for(var i=0;i<doc.sen.length;i++){
    var e=doc.sen[i];
    if(hiddenLayers.has(e.layer)) continue;
    var d=distToSeg(wx,wy,e.x1,e.y1,e.x2,e.y2);
    if(d<bestDist){bestDist=d;best=e;}
  }
  return best;
}

// ─ LP専用スナップマーカー（全snap type対応） ─────────────
function drawLPSnapMarker(ctx2,sx,sy,type){
  var cols={end:'#00ff7f',mid:'#ffbb33',cen:'#00f0ff',int:'#ffd700',
            ten:'#ff6b6b',cxl:'#ff88cc',cxc:'#ffcc44','default':'#f39c12'};
  var col=cols[type]||cols['default'];
  var r=9;
  ctx2.save();
  ctx2.strokeStyle=col; ctx2.fillStyle=col;
  ctx2.lineWidth=2.5; ctx2.setLineDash([]);
  if(type==='end'){
    // 正方形（端点）
    ctx2.strokeRect(sx-r,sy-r,r*2,r*2);
  } else if(type==='mid'){
    // 三角形（中点）
    ctx2.beginPath();
    ctx2.moveTo(sx,sy-r); ctx2.lineTo(sx+r,sy+r); ctx2.lineTo(sx-r,sy+r);
    ctx2.closePath(); ctx2.stroke();
  } else if(type==='cen'){
    // 円+クロス（中心）
    ctx2.beginPath(); ctx2.arc(sx,sy,r,0,Math.PI*2); ctx2.stroke();
    ctx2.beginPath();
    ctx2.moveTo(sx-r,sy); ctx2.lineTo(sx+r,sy);
    ctx2.moveTo(sx,sy-r); ctx2.lineTo(sx,sy+r);
    ctx2.stroke();
  } else if(type==='int'){
    // X字（交点）
    ctx2.beginPath();
    ctx2.moveTo(sx-r,sy-r); ctx2.lineTo(sx+r,sy+r);
    ctx2.moveTo(sx+r,sy-r); ctx2.lineTo(sx-r,sy+r);
    ctx2.stroke();
  } else if(type==='ten'){
    // 点要素: 二重円
    ctx2.beginPath(); ctx2.arc(sx,sy,8,0,Math.PI*2); ctx2.stroke();
    ctx2.beginPath(); ctx2.arc(sx,sy,3,0,Math.PI*2); ctx2.fill();
  } else if(type==='cxl'){
    // 円-線交点
    ctx2.beginPath();
    ctx2.moveTo(sx-8,sy-8); ctx2.lineTo(sx+8,sy+8);
    ctx2.moveTo(sx+8,sy-8); ctx2.lineTo(sx-8,sy+8);
    ctx2.stroke();
    ctx2.beginPath(); ctx2.arc(sx,sy,4,0,Math.PI*2); ctx2.stroke();
  } else if(type==='cxc'){
    // 円-円交点
    ctx2.beginPath(); ctx2.arc(sx,sy,8,0,Math.PI*2); ctx2.stroke();
    ctx2.beginPath(); ctx2.arc(sx,sy,3,0,Math.PI*2); ctx2.fill();
  } else {
    // default: クロス
    ctx2.beginPath();
    ctx2.moveTo(sx-r,sy); ctx2.lineTo(sx+r,sy);
    ctx2.moveTo(sx,sy-r); ctx2.lineTo(sx,sy+r);
    ctx2.stroke();
  }
  // snap type ラベル
  var lbl={end:'端点',mid:'中点',cen:'中心',int:'交点',ten:'点要素',
           cxl:'円-線交点',cxc:'円-円交点'}[type]||'';
  if(lbl){
    ctx2.font='bold 11px sans-serif';
    var tw=ctx2.measureText(lbl).width;
    ctx2.fillStyle='rgba(0,0,0,0.75)';
    ctx2.fillRect(sx+13,sy-17,tw+8,16);
    ctx2.fillStyle=col;
    ctx2.textAlign='left'; ctx2.textBaseline='bottom';
    ctx2.fillText(lbl,sx+17,sy-3);
  }
  ctx2.restore();
}

// ─ 寸法構築 ─────────────────────────────────────────
function buildLinePtDim(line,pt,pArrow){
  var sd=parseFloat(document.getElementById('scaleDenom').value)||1;
  var dx=line.x2-line.x1,dy=line.y2-line.y1;
  var lineLen=Math.hypot(dx,dy);
  if(lineLen<1e-9) return null;
  var lux=dx/lineLen,luy=dy/lineLen;
  var foot=computeFoot(line,pt);
  var perpX=pt.x-foot.x,perpY=pt.y-foot.y;
  var dist=Math.hypot(perpX,perpY);
  if(dist<1e-9) return null;
  var ux=perpX/dist,uy=perpY/dist;
  var offset=(pArrow.x-foot.x)*lux+(pArrow.y-foot.y)*luy;
  var d1={x:foot.x+lux*offset,y:foot.y+luy*offset};
  var d2={x:pt.x  +lux*offset,y:pt.y  +luy*offset};
  var ext=8/scale,sig=offset>=0?1:-1;
  var lines=[
    {x1:foot.x,y1:foot.y,x2:d1.x+lux*sig*ext,y2:d1.y+luy*sig*ext},
    {x1:pt.x,  y1:pt.y,  x2:d2.x+lux*sig*ext,y2:d2.y+luy*sig*ext},
    {x1:d1.x,  y1:d1.y,  x2:d2.x,             y2:d2.y}
  ];
  var screenAng=Math.atan2(-uy,ux);
  var arrows=[
    {x:d1.x,y:d1.y,angle:screenAng+Math.PI},
    {x:d2.x,y:d2.y,angle:screenAng}
  ];
  var tx2=(d1.x+d2.x)/2,ty2=(d1.y+d2.y)/2;
  var tangle=(screenAng>Math.PI/2)?screenAng-Math.PI:(screenAng<-Math.PI/2)?screenAng+Math.PI:screenAng;
  var sd1=w2s(d1.x,d1.y),sd2=w2s(d2.x,d2.y);
  var pxLen=Math.hypot(sd2[0]-sd1[0],sd2[1]-sd1[1]);
  if(pxLen<60){
    var ref=(offset>=0?32:-32)/scale;
    tx2=d2.x+lux*ref; ty2=d2.y+luy*ref;
    lines.push({x1:d2.x,y1:d2.y,x2:tx2,y2:ty2});
  }
  return {lines,arrows,
    text:formatDim(dist/sd),
    tx:tx2,ty:ty2,tangle,color:window.currentDimColor||'#f39c12'};
}

// ─ プレビュー描画(点線) ───────────────────────────────
function drawLPPreview(ctx2,dim){
  if(!dim) return;
  ctx2.strokeStyle=ctx2.fillStyle=dim.color||'#f39c12';
  ctx2.lineWidth=1.5; ctx2.setLineDash([5,4]);
  for(var i=0;i<dim.lines.length;i++){
    var l=dim.lines[i],s1=w2s(l.x1,l.y1),s2=w2s(l.x2,l.y2);
    ctx2.beginPath();ctx2.moveTo(s1[0],s1[1]);ctx2.lineTo(s2[0],s2[1]);ctx2.stroke();
  }
  ctx2.setLineDash([]);
  for(var j=0;j<dim.arrows.length;j++){
    var a=dim.arrows[j],sa=w2s(a.x,a.y);
    ctx2.save();ctx2.translate(sa[0],sa[1]);ctx2.rotate(a.angle);
    ctx2.beginPath();ctx2.moveTo(0,0);ctx2.lineTo(-10,4);ctx2.lineTo(-10,-4);
    ctx2.closePath();ctx2.fill();ctx2.restore();
  }
  if(dim.text){
    var st=w2s(dim.tx,dim.ty);
    ctx2.save();ctx2.translate(st[0],st[1]);ctx2.rotate(dim.tangle||0);
    ctx2.font='bold 17px sans-serif';ctx2.fillStyle=dim.color||'#f39c12';
    ctx2.textAlign='center';ctx2.textBaseline='bottom';
    ctx2.fillText(dim.text,0,0);ctx2.restore();
  }
}

// ─ drawOverlay フック ─────────────────────────────────
var _lpOrigDO=window.drawOverlay;
window.drawOverlay=function(){ _lpOrigDO(); if(LP.active) drawLPOverlay(); };

function drawLPOverlay(){
  var dpr=window.devicePixelRatio||1;
  var ctx2=octx;
  ctx2.save(); ctx2.scale(dpr,dpr);

  // Phase0: _hoverLine をハイライト (再検索しない ─ 表示=確定を保証)
  if(LP.phase===0&&LP._hoverLine){
    var hl=LP._hoverLine;
    var hs1=w2s(hl.x1,hl.y1),hs2=w2s(hl.x2,hl.y2);
    ctx2.save();
    ctx2.strokeStyle='#ff8c00'; ctx2.lineWidth=5; ctx2.setLineDash([]);
    ctx2.globalAlpha=0.85;
    ctx2.beginPath(); ctx2.moveTo(hs1[0],hs1[1]); ctx2.lineTo(hs2[0],hs2[1]); ctx2.stroke();
    ctx2.restore();
  }

  // 選択確定済み線ハイライト(Phase1,2)
  if(LP.selLine&&LP.phase>=1){
    var ls1=w2s(LP.selLine.x1,LP.selLine.y1),ls2=w2s(LP.selLine.x2,LP.selLine.y2);
    ctx2.save();
    ctx2.strokeStyle='#ff8c00'; ctx2.lineWidth=5; ctx2.setLineDash([]);
    ctx2.globalAlpha=0.9;
    ctx2.beginPath(); ctx2.moveTo(ls1[0],ls1[1]); ctx2.lineTo(ls2[0],ls2[1]); ctx2.stroke();
    ctx2.restore();
  }

  // Phase1: スナップ候補マーカー (LP.cur!=null の時のみ表示)
  if(LP.phase===1&&LP.cur){
    var sc=w2s(LP.cur.x,LP.cur.y);
    drawLPSnapMarker(ctx2,sc[0],sc[1],LP.cur.type||'default');
  }

  // Phase2: 選択済み点+垂点マーカー
  if(LP.selPt&&LP.phase===2){
    var spt=w2s(LP.selPt.x,LP.selPt.y);
    ctx2.save();
    ctx2.strokeStyle='#00ff7f'; ctx2.lineWidth=2; ctx2.setLineDash([]);
    ctx2.beginPath(); ctx2.arc(spt[0],spt[1],6,0,Math.PI*2); ctx2.stroke();
    if(LP.footPt){
      var sfp=w2s(LP.footPt.x,LP.footPt.y);
      ctx2.strokeStyle='#88ccff'; ctx2.lineWidth=1.5;
      ctx2.beginPath(); ctx2.arc(sfp[0],sfp[1],4,0,Math.PI*2); ctx2.stroke();
      ctx2.strokeStyle='rgba(255,140,0,0.35)'; ctx2.setLineDash([4,4]);
      ctx2.beginPath(); ctx2.moveTo(sfp[0],sfp[1]); ctx2.lineTo(spt[0],spt[1]); ctx2.stroke();
      ctx2.setLineDash([]);
    }
    ctx2.restore();
  }

  // Phase2: プレビュー
  if(LP.phase===2&&LP.cur&&LP.selLine&&LP.selPt){
    drawLPPreview(ctx2,buildLinePtDim(LP.selLine,LP.selPt,LP.cur));
  }

  ctx2.restore();
}

// ─ ヘルパー: _hoverLine を更新(phase0用) ────────────────
function _updateHoverLine(wx,wy){
  LP._hoverLine=findNearestSen(wx,wy);
}

// ─ ヘルパー: LP.cur を更新(phase1スナップ用) ─────────────
function _updateSnap(wx,wy){
  var snp=window.snapAt(wx,wy);
  LP.cur=snp||null; // null=候補なし(フォールバック位置への確定を禁止)
  if(snp) console.log('[LP] snap type='+snp.type
    +' ('+snp.x.toFixed(1)+','+snp.y.toFixed(1)+')');
}

// ─ ポインタハンドラ ───────────────────────────────────
LP.handleDown=function(sx,sy){
  var wp=s2w(sx,sy);
  LP._hoverPos={x:wp[0],y:wp[1]};
  LP.penDown=true;
  if(LP.phase===0){
    _updateHoverLine(wp[0],wp[1]);
  } else if(LP.phase===1){
    _updateSnap(wp[0],wp[1]);
  } else if(LP.phase===2){
    LP.cur={x:wp[0],y:wp[1]};
  }
  scheduleOverlay();
};

LP.handleMove=function(sx,sy){
  var wp=s2w(sx,sy);
  LP._hoverPos={x:wp[0],y:wp[1]};
  if(!LP.penDown){scheduleOverlay();return;}
  if(LP.phase===0){
    _updateHoverLine(wp[0],wp[1]);
  } else if(LP.phase===1){
    _updateSnap(wp[0],wp[1]);
  } else if(LP.phase===2){
    LP.cur={x:wp[0],y:wp[1]};
  }
  scheduleOverlay();
};

LP.handleUp=function(sx,sy){
  if(!LP.penDown) return;
  LP.penDown=false;
  if(LP.phase===0){
    // handleDown/Moveで更新した _hoverLine をそのまま確定
    // handleUpで再検索しない → 表示=確定を保証
    if(LP._hoverLine){
      LP.selLine=LP._hoverLine;
      LP._hoverLine=null;
      LP.phase=1; LP.cur=null;
      showGuide(LP_GUIDES.PT,0);
      console.log('[LP] line selected');
    } else {
      showGuide('線の近くにペンを当ててください',1500);
    }
  } else if(LP.phase===1){
    // LP.cur==null → スナップ候補なし → 確定禁止
    if(!LP.cur){
      showGuide('スナップ点を選択してください',1500);
      console.log('[LP] point selection failed: no snap candidate');
    } else {
      var pt=LP.cur;
      LP.selPt=pt;
      LP.footPt=computeFoot(LP.selLine,pt);
      LP.phase=2; LP.cur=null;
      showGuide(LP_GUIDES.POS,0);
      console.log('[LP] point selected: ('
        +pt.x.toFixed(1)+','+pt.y.toFixed(1)+') type='+pt.type);
    }
  } else if(LP.phase===2){
    var wp=s2w(sx,sy);
    var pArrow=LP.cur||{x:wp[0],y:wp[1]};
    var dim=buildLinePtDim(LP.selLine,LP.selPt,pArrow);
    console.log('[LP] dim placed: '+(dim?dim.text:'null'));
    if(dim){ snapshot(); dims.push(dim); scheduleSave(); scheduleDraw(); }
    LP.selLine=null; LP.selPt=null; LP.footPt=null; LP.phase=0; LP.cur=null;
    showGuide(LP_GUIDES.LINE,0);
    console.log('[LP] → phase0: reset');
  }
  scheduleOverlay();
};

// ─ ツール切り替えフック ─────────────────────────────────
document.querySelectorAll('.tool-btn[data-tool]').forEach(function(btn){
  btn.addEventListener('click',function(){
    var t=this.dataset.tool;
    if(t==='lp'){
      if(window.DIM) window.DIM.active=false;
      resetLP(); LP.active=true; LP.phase=0;
      showGuide(LP_GUIDES.LINE,0);
      console.log('[LP] tool activated');
    } else {
      re