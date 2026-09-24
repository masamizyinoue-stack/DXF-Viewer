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
// V2_90: なげわ(lasso)ツールの状態。var宣言でグローバル公開（index.htmlのdrawOverlayが
// 参照するため）。drawing=描画中／pts=描画中の頂点列／selected=選択済みstrokes配列
// (strokes配列内の要素そのものへの参照)／bbox=選択範囲のワールド座標バウンディング
// ボックス／dragging=バウンディングボックス内ドラッグでの移動中／dragStart=移動開始時
// のワールド座標／dragOrig=移動開始時点の各ストローク座標のコピー(差分計算用)
var lassoState={drawing:false,pts:[],selected:[],bbox:null,dragging:false,dragStart:null,dragOrig:null};
// V2_95: 図形ツール(四角・矢印・丸・楕円)の状態。なげわ(lassoState)と同じ考え方で、
// var宣言でグローバル公開(index.htmlのdrawOverlayがプレビュー描画のため参照する)。
// drawing=ドラッグ中／tool=描画開始時のcurrentTool(ドラッグ中に誤って別ツールへ
// 切り替わっても最初に選んだ図形で確定するため保持)／start=ドラッグ開始点(ワールド
// 座標)／cur=現在のドラッグ位置(ワールド座標、プレビュー用)。
// 【設計方針(事前調査で確定)】新しいストローク種別は作らない。四角・矢印・丸・楕円は
// すべて既存のpen/hlストロークと同じ{pts:[{x,y},...],color,lw,page}という形の通常
// ストロークとして、ドラッグ終了(pointerup/touchend)時に頂点列(pts)へ変換してから
// strokesに追加する。円・楕円も中心+半径のような専用プロパティは持たせず、確定時点で
// 32分割の多角形近似に変換してしまう。これにより、過去にisText(文字ストローク)導入時に
// 発生した「s.pts前提コードがクラッシュした」問題を再発させない。
var shapeToolState={drawing:false,tool:null,start:null,cur:null};
// V2_95: currentToolが図形ツール(四角/矢印/丸/楕円)かどうかの判定。既存のcurrentTool値
// (sketch/hl/eraser/text/lasso/select/dx/dy/dxdy/diag/dim系...)と衝突しないことを
// 事前に全ファイル検索して確認済みの新規値のみを使う。
// V2_108: 雲印(cloud)を図形ツールに追加。既存のcurrentTool値と衝突しないことを
// 確認済みの新規値'cloud'を使う。
function _isShapeTool(t){return t==='rect'||t==='arrow'||t==='circle'||t==='ellipse'||t==='cloud';}

// ── V3_04: 計測系「状態機械」ツール(IPX/DIM/LP/LL/LLEN/ANG)の一元管理 ──────
// 改善点1対応: 「サブ窓で文字/図形/なげわが使えない」系の不具合(V3_01〜V3_03)が
// 繰り返し起きていた根本原因は、IPX/DIM/LP/LL/LLEN/ANGの active判定→handleDown/
// Move/Up呼び出しチェーンが、メイン画面(マウス/タッチ)・サブ窓(index.html
// _swAttachInput)・指計測(_fingerMeasure*)など十数箇所に個別にコピーされており、
// 新しい計測ツールを追加するたびに全箇所へ反映しないと機能ヌケが起きる構造だった
// ため。ここに一本化し、新しい計測系ツールを追加する場合は下の配列に名前を
// 足すだけで全箇所に反映されるようにする。
// 優先順位はIPXが最優先(他の計測ツールの「点供給」として呼ばれるため)。
var MEASURE_TOOL_NAMES=['IPX','DIM','LP','LL','LLEN','ANG'];
function _activeMeasureTool(){
  for(var i=0;i<MEASURE_TOOL_NAMES.length;i++){
    var t=window[MEASURE_TOOL_NAMES[i]];
    if(t&&t.active) return t;
  }
  return null;
}
function _isAnyMeasureActive(){ return !!_activeMeasureTool(); }
function _isAnyMeasurePhaseActive(){
  for(var i=0;i<MEASURE_TOOL_NAMES.length;i++){
    var t=window[MEASURE_TOOL_NAMES[i]];
    if(t&&t.active&&t.phase>0) return true;
  }
  return false;
}
// アクティブな計測ツールへ委譲する。委譲した場合はtrueを返す(呼び出し側は
// falseの場合のみ通常のツール処理(handlePointerDown等)にフォールバックする)。
function _dispatchMeasureDown(sx,sy){ var t=_activeMeasureTool(); if(t){t.handleDown(sx,sy);return true;} return false; }
function _dispatchMeasureMove(sx,sy){ var t=_activeMeasureTool(); if(t){t.handleMove(sx,sy);return true;} return false; }
function _dispatchMeasureUp(sx,sy){ var t=_activeMeasureTool(); if(t){t.handleUp(sx,sy);return true;} return false; }

// V2_96: shapeType('rect'/'arrow'/'circle'/'ellipse')のうち、始点と終点が一致する
// 閉じた多角形として扱うべきものはどれか。四角・丸・楕円は閉じる(canvas側で
// closePath()相当/pdf側で'Z')。矢印は開いたポリライン(始点と矢尻が別の位置)のため
// 対象外。screen描画(index.html drawAnnotation)・PDFベクター書出(export.js
// _hpDrawStrokes170/_hpDrawStrokesPdfLib190)の3箇所すべてがこの判定関数を共通で使う
// V2_108: 雲印(cloud)も始点に戻って閉じたポリラインとして生成するため、閉形状に含める。
function _isClosedShapeType(t){return t==='rect'||t==='circle'||t==='ellipse'||t==='cloud';}
// V2_95: 円・楕円の多角形近似の分割数(目安32分割)。i=0とi=SHAPE_POLY_SEGMENTSで
// 同じ座標になるため、pts配列は自動的に「始点に戻る」形で閉じる。
var SHAPE_POLY_SEGMENTS=32;
// V2_95: ドラッグ距離がこのスクリーンpx未満の場合は誤タップとみなし、図形を確定しない
// (なげわのpoly.length<3での不成立チェックと同じ考え方の誤操作防止)。
var SHAPE_MIN_DRAG_PX=4;
// V2_95: 図形の頂点列(pts)を組み立てる。p0=ドラッグ開始点、p1=ドラッグ終了点(いずれも
// ワールド座標)。ドラッグ中のプレビュー(index.html drawOverlay)もこの関数をそのまま
// 呼んで同じ頂点列を描くため、プレビュー表示と確定形状が必ず一致する。
function _shapePolygonPts(cx,cy,rx,ry){
  var pts=[];
  for(var i=0;i<SHAPE_POLY_SEGMENTS;i++){
    var a=(i/SHAPE_POLY_SEGMENTS)*Math.PI*2;
    pts.push({x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a)});
  }
  // 浮動小数の誤差(cos(2π)がcos(0)と厳密一致しない)で「始点に戻る」が僅かにズレるのを
  // 避けるため、最後の点は計算せず先頭点の値をそのまま複製して確実に閉じる
  pts.push({x:pts[0].x,y:pts[0].y});
  return pts;
}
// V2_95: eraseAt()（消しゴム）は各ストロークの頂点(s.pts内の点そのもの)との距離でしか
// 消去対象を判定しない(辺の途中との距離は見ない)ため、四角の頂点が4隅だけ・矢印の頂点が
// 5点だけだと、辺の途中(例えば四角の辺の中央)を消しゴムでなぞっても頂点まで距離が
// 遠く反応しない。ペンの手描きストロークは元々サンプリング点が密なため気付かれないが、
// 図形ツールはドラッグ2点だけから生成するため、辺を一定間隔で分割した中間点を追加して
// 密度をペンストローク相当に近づける(既存のeraseAt/なげわ選択判定/undo等は一切変更せず、
// 「頂点の多い通常ストローク」として振る舞わせるだけで対応する)
var SHAPE_EDGE_SEGMENTS=16;
function _shapeEdgePts(a,b,segs){ // aから始まりb手前まで(bは含まない)を等間隔に分割
  var arr=[];
  for(var i=0;i<segs;i++){
    var t=i/segs;
    arr.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  }
  return arr;
}
// V2_97: 矢尻(矢印の先端)が「一部だけ凹んだ不格好な塊」に見える不具合を修正。
// 原因調査: 実際にPDF書出し(_hpDrawStrokes170)で生成される矢印を高解像度で
// pdftoppm画像化して目視したところ、矢印を短く(かつ現在のペン太さのまま)描いた
// 場合に矢尻がひどく歪んで見えることを確認した。原因は「矢尻の軸長に対する比率
// (13%)」だけを見ており、線の太さ(lw)を一切考慮していなかったこと。矢印を短く
// 描くと軸長13%の矢尻の長さが数十〜:線幅と同程度まで小さくなり、本来は細く
// 尖った2辺であるべき矢尻が「線幅とほぼ同じ長さの塗りつぶし塊」になって
// 潰れ、辺の途中に凹み(ノッチ)が出る(縮小画像では気づきにくいが拡大すると
// 明確に見える)。V2_95〜V2_96はこの比率(27度/13%)を据え置いたままだったため、
// 短い矢印・太いペンの組み合わせで常に再現する。
// 修正方針: 矢尻の長さに「線の太さ(lw)を基準にした最小値」の下限を設け、矢尻の
// 辺が常に線幅より十分長く(目安5倍以上)なるようにする。lwは画面表示・PDF書出し
// 双方で「(scale/lwRef)倍」して物理太さに変換される値(V0_87〜)なので、ここでは
// 逆に「lwRef基準のワールド座標換算値」= lw/lwRef として比較する(この換算値は
// ズーム倍率が変わっても矢印の見た目の比率を保つ=zoomAt後も破綻しない)。
// 併せて、矢尻の開き角度も27度→32度に広げ(25-30度の目安よりやや広めにして
// 実物の矢印らしい"末広がり"を強調)、長さ上限を軸長の50%に制限して矢印全体が
// 短すぎる場合に矢尻だけが軸より長くなる逆転現象も防止する。
function _shapeArrowPts(p0,p1,lwWorld){
  var dx=p1.x-p0.x,dy=p1.y-p0.y;
  var len=Math.hypot(dx,dy);
  if(len<1e-9) return[{x:p0.x,y:p0.y},{x:p1.x,y:p1.y}];
  var ang=Math.atan2(dy,dx);
  // lwWorld省略時(呼び出し元がlwを渡せない場合)は、現在のcurrentLW/fitScale(or scale)
  // から同じ換算式で算出する。fitScale未定義・0の場合はscaleへフォールバックする
  // (index.htmlのプレビュー描画・tool.jsの確定処理いずれから呼ばれても安全に動く)
  if(lwWorld==null){
    var _lwRef97=(typeof fitScale!=='undefined'&&fitScale>0)?fitScale:((typeof scale!=='undefined'&&scale>0)?scale:1);
    // V2_103: 図形は専用のcurrentShapeLWを使う(ペンのcurrentLWとは独立)
    var _lw97=(typeof currentShapeLW!=='undefined')?currentShapeLW:((typeof currentLW!=='undefined')?currentLW:1);
    lwWorld=_lw97/_lwRef97;
  }
  var headLen=Math.max(len*0.15, lwWorld*4.5); // 軸長の15%、ただし線幅の4.5倍未満にはしない
  headLen=Math.min(headLen, len*0.5); // 矢印全体が短い場合に矢尻だけ軸より長くならないよう上限も設ける
  var headAng=32*Math.PI/180; // 32度程度(V2_96までの27度からやや広げ、末広がりの矢印らしさを強調)
  var leftAng=ang+Math.PI-headAng,rightAng=ang+Math.PI+headAng;
  var left={x:p1.x+headLen*Math.cos(leftAng),y:p1.y+headLen*Math.sin(leftAng)};
  var right={x:p1.x+headLen*Math.cos(rightAng),y:p1.y+headLen*Math.sin(rightAng)};
  // 始点→終点→矢尻左→終点→矢尻右、の順でpenの線描画としてつながりが自然になる順序
  // (矢印は閉じたポリラインにしない=最後に始点へは戻さない)。軸線(始点→終点)は
  // 消しゴム判定用に中間点を追加して分割する
  var axis=_shapeEdgePts(p0,p1,SHAPE_EDGE_SEGMENTS);
  axis.push({x:p1.x,y:p1.y});
  return axis.concat([left,{x:p1.x,y:p1.y},right]);
}
// V2_108: 雲印(クラウド)。始点・終点を対角とする外接矩形の周囲に沿って、複数の
// 「こぶ」(外側に膨らむ半円弧)を並べ、全てを1本の閉じたポリラインとして連結する。
// 新しいストローク種別は作らない方針(事前調査で確定)のため、四角/丸/楕円と同じく
// 確定時にpts配列(通常ストローク用の折れ線)へ変換してしまう。
// こぶの大きさ・個数の決め方:
//  ・こぶ1個の弦長(chord)の目安を「矩形の短辺の30%」または「矩形周囲長の5%」の
//    大きい方とし、矩形サイズに応じてこぶの大きさが自動的にスケールするようにする
//    (小さい矩形では小さいこぶ、大きい矩形では大きいこぶになる)。
//  ・細長い矩形(例:横に非常に長く縦が短い)では、上記の目安chordが短辺(高さ)に
//    対して大きすぎ、短辺側の1辺がこぶ1個だけになって半径が過大になり、角付近で
//    こぶ同士が交差して見た目が破綻する(実描画確認で発見)。これを防ぐため、
//    chordは矩形の短辺の80%を上限にクランプする(こぶの半径が短辺の40%を超えない
//    ようにし、対辺のこぶと交差しない余裕を残す)。
//  ・上記の目安chordで矩形4辺それぞれを「辺の長さ÷chordを丸めた個数」で均等分割する
//    (辺ごとに整数個のこぶがちょうど収まるようにするため、辺ごとに実際のchordを
//    微調整する)。1辺だけ突出して大きいこぶにならないよう、各辺最低2個は確保する
//    (4辺×最低2個=最低8個となり、矩形全体で最低8個程度のこぶという目安も自動的に
//    満たされる)。
//  ・各こぶは、辺の方向を軸とした「弦の両端を結ぶ半径r(=chord/2)の半円弧」を10分割
//    (8〜12分割の目安の範囲内)の頂点列で近似し、辺の外側(矩形の中心から離れる向き)
//    に膨らませる。膨らむ向きは、矩形を(左下→右下→右上→左上→左下)の順に一周する
//    向きに辺を進む方向ベクトルd=(dx,dy)から、90度回転した(dy,-dx)を外向き法線として
//    機械的に導出する(この巡回順で常に外側を向くことを確認済み)。
//  ・全てのこぶの頂点列を巡回順に連結し、浮動小数の誤差対策として最後の点を明示的に
//    始点と同一座標に置き換えて確実に閉じたポリラインにする。
// 見た目の最終調整はPlaywrightでの実描画確認を行いながらtargetChordの係数
// (0.30/0.05/短辺80%クランプ)・最低2個/辺・ARC_SEGS(10)を調整して、正方形に近い
// 矩形はもちろん、細長い矩形でも交差せず「雲っぽい」自然な形になるよう決定した。
function _shapeCloudPts(p0,p1){
  if(!p0||!p1) return null;
  var minX=Math.min(p0.x,p1.x),maxX=Math.max(p0.x,p1.x);
  var minY=Math.min(p0.y,p1.y),maxY=Math.max(p0.y,p1.y);
  var w=maxX-minX,h=maxY-minY;
  if(w<1e-9||h<1e-9) return null; // 矩形がつぶれている(横or縦にドラッグ距離ゼロ)場合は生成しない
  var perim=2*(w+h);
  var minSide=Math.min(w,h);
  var ARC_SEGS=10; // こぶ1個あたりの弧の分割数(8〜12分割の目安)
  var targetChord=Math.max(minSide*0.30, perim*0.05);
  targetChord=Math.min(targetChord, minSide*0.8); // 短辺に対してこぶが過大にならないようクランプ
  var corners=[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}];
  var pts=[{x:corners[0].x,y:corners[0].y}];
  for(var side=0;side<4;side++){
    var a=corners[side], b=corners[(side+1)%4];
    var sideLen=Math.hypot(b.x-a.x,b.y-a.y);
    if(sideLen<1e-9) continue;
    var n=Math.max(2,Math.round(sideLen/targetChord)); // 1辺あたり最低2個のこぶを確保
    var chord=sideLen/n;
    var r=chord/2;
    var dx=(b.x-a.x)/sideLen, dy=(b.y-a.y)/sideLen;
    var theta=Math.atan2(dy,dx);
    for(var i=0;i<n;i++){
      var sx=a.x+dx*chord*i, sy=a.y+dy*chord*i; // このこぶの弦の始点(辺上)
      var mx=sx+dx*r, my=sy+dy*r; // 弦の中点(=こぶの円弧の中心)
      for(var k=1;k<=ARC_SEGS;k++){
        // theta+PIが弦の始点方向、theta+2PI(=theta)が弦の終点方向。この間を外向き
        // (法線(dy,-dx)側)を通るように角度を単調に進めることで半円弧になる
        var ang=theta+Math.PI+k*(Math.PI/ARC_SEGS);
        pts.push({x:mx+r*Math.cos(ang), y:my+r*Math.sin(ang)});
      }
    }
  }
  pts[pts.length-1]={x:pts[0].x,y:pts[0].y}; // 浮動小数誤差対策で確実に始点へ戻す
  return pts;
}
function _shapeBuildPts(tool,p0,p1){
  if(!p0||!p1) return null;
  if(tool==='rect'){
    // 対角の2点から矩形の4頂点+始点に戻る閉じる点。各辺は消しゴム判定用に
    // 中間点で分割してから連結する
    var c0={x:p0.x,y:p0.y},c1={x:p1.x,y:p0.y},c2={x:p1.x,y:p1.y},c3={x:p0.x,y:p1.y};
    return _shapeEdgePts(c0,c1,SHAPE_EDGE_SEGMENTS)
      .concat(_shapeEdgePts(c1,c2,SHAPE_EDGE_SEGMENTS))
      .concat(_shapeEdgePts(c2,c3,SHAPE_EDGE_SEGMENTS))
      .concat(_shapeEdgePts(c3,c0,SHAPE_EDGE_SEGMENTS))
      .concat([{x:c0.x,y:c0.y}]);
  }
  if(tool==='circle'){
    // 始点を中心、終点までの距離を半径とする正円(32分割の多角形近似)
    var r=Math.hypot(p1.x-p0.x,p1.y-p0.y);
    return _shapePolygonPts(p0.x,p0.y,r,r);
  }
  if(tool==='ellipse'){
    // 始点・終点を対角とする外接矩形に内接する楕円(32分割の多角形近似)
    var cx=(p0.x+p1.x)/2,cy=(p0.y+p1.y)/2;
    var rx=Math.abs(p1.x-p0.x)/2,ry=Math.abs(p1.y-p0.y)/2;
    return _shapePolygonPts(cx,cy,rx,ry);
  }
  if(tool==='arrow'){
    return _shapeArrowPts(p0,p1);
  }
  if(tool==='cloud'){
    return _shapeCloudPts(p0,p1);
  }
  return null;
}
// V2_95: なげわ(_lassoPointerDown/Move/Up)のパターンに倣い、ドラッグ開始点・終了点の
// 2点だけを記録し、pointerup(またはtouchend)時にptsを計算してストロークを確定する。
function _shapePointerDown(wx,wy){
  shapeToolState.drawing=true;
  shapeToolState.tool=currentTool;
  shapeToolState.start={x:wx,y:wy};
  shapeToolState.cur={x:wx,y:wy};
  scheduleOverlay();
}
function _shapePointerMove(wx,wy){
  if(!shapeToolState.drawing) return;
  shapeToolState.cur={x:wx,y:wy};
  scheduleOverlay();
}
function _shapePointerUp(){
  if(!shapeToolState.drawing) return;
  var tool=shapeToolState.tool,p0=shapeToolState.start,p1=shapeToolState.cur;
  shapeToolState.drawing=false;shapeToolState.tool=null;shapeToolState.start=null;shapeToolState.cur=null;
  if(!p0||!p1){scheduleOverlay();return;}
  var distPx=Math.hypot(p1.x-p0.x,p1.y-p0.y)*scale;
  if(distPx<SHAPE_MIN_DRAG_PX){scheduleOverlay();return;} // 誤タップ(ほぼ動かさず離した)は確定しない
  var pts=_shapeBuildPts(tool,p0,p1);
  if(!pts||pts.length<2){scheduleOverlay();return;}
  snapshot();
  // ①既存のpen/hlストロークと全く同じ形の通常ストロークとして追加(新しいストローク
  // 種別は作らない)。
  // V2_102: 色は専用のcurrentShapeColorを使う(ペンのcurrentColorとは独立)
  // V2_103: 太さも専用のcurrentShapeLWを使う(ペンのcurrentLWとは独立)
  // V2_96: shapeType(='rect'/'arrow'/'circle'/'ellipse')を追加。既存のcolor/lwと
  // 同レベルの軽量な追加プロパティであり、s.pts配列の構造自体は変えない(s.ptsを前提と
  // する既存コード(export.js/storage.js/eraseAt/なげわ選択等)は shapeTypeの有無に
  // 関わらずそのまま動作する)。目的は描画時にペン用の丸みスムージング
  // (drawAnnotation/_hpDrawStrokes170/_hpDrawStrokesPdfLib190のCatmull-Rom風
  // midpoint-quadratic補間)を適用せず、鋭角を保った直線描画(lineJoin='miter')に
  // 切り替えるための目印として使う(V2_96見た目バグ修正)
  strokes.push({pts:pts,color:{...currentShapeColor},lw:currentShapeLW,page:_curPage(),shapeType:tool});
  if(typeof verify==='function')verify('図形追加',{tool:tool,len:strokes.length});
  scheduleOverlay();doSave(); // なげわ・ペンと同様、確定時に即時保存
}
// V1_210: ペン等の他ツールから計測ボタンを1回押した時に、前回選んでいた計測ツールを
// 直接復元できるようにするため記憶する。var宣言でグローバル公開(index.html側の
// #measureToggleBtnクリックハンドラが参照するため)
var _lastMeasureTool=null;
// V2_92: 文字入力ツールをタッチ操作(指/Apple Pencilタップ)で開いた場合、iOS/iPadOSでは
// 「.focus()呼び出しがタップのユーザージェスチャー呼び出しスタック内で同期的に行われないと
// ソフトウェアキーボードが表示されない」という制約があるため、この呼び出しが
// タッチ由来かどうかを_openTextInputAtへ伝える一時フラグ。各touchstartハンドラ内で
// currentTool==='text'の場合にtrueへ設定してからhandlePointerDownを呼び、
// _openTextInputAt側で読み取った直後にfalseへ戻す(消費型)。
// マウスのmousedownハンドラはこれをtrueにしないため既定値falseのままとなり、
// V2_80のsetTimeout遅延フォーカス(マウス特有のフォーカス競合対策)の挙動を維持する。
var _textInputTouchOrigin=false;
// V2_93: 文字ツールをタッチ(指/Apple Pencil)でタップした際、実際に入力枠を開いて
// focus()するのを touchstart ではなく touchend(=タップの指/ペンが離れた瞬間)まで
// 遅らせるための保留情報。{sx,sy,isPenInput} または null。
// 【根本原因メモ(V2_93)】
//  ・問題1(指タップで入力枠自体が出ない): 従来、指タップで文字ツールを開始できる分岐は
//    inputMode==='freehand'(手書きモード)の場合に限定されていた。しかしinputModeの
//    既定値は'pen'(viewer.js冒頭でvar inputMode='pen')であり、ユーザーが明示的に
//    「手書きモード」に切り替えない限り、文字ツール選択中でも指タッチはtouchstartの
//    最後のelse分岐(1本指パン)に落ちてしまい、handlePointerDown自体が一切呼ばれて
//    いなかった。Apple Pencil側は最初からinputModeに関係なく常に処理される分岐
//    だったため「ペンだけ動く」ように見えていた。
//  ・問題2(枠は出てもキーボードが出ない): V2_92では.focus()をtouchstartの同期
//    コールスタック内で呼ぶよう修正したが、iOS/iPadOS Safariでは「touchstart」自体は
//    キーボード表示を伴う正式なユーザー操作(タップ確定)とみなされず、.focus()は
//    touchend(またはclick)由来でないとソフトウェアキーボードが開かないという制約が
//    別にあった。そのため入力枠(display:blockへの切替)自体はtouchstartで成功しても、
//    キーボードは出ず、再度その枠をタップ(=新しいtouchstart+touchendの組=実質click)
//    して初めてキーボードが表示されていた。
//  この2点を踏まえ、V2_93では (a) 文字ツールの指タップをinputModeに関係なく常に
//  受け付け、(b) 実際にhandlePointerDown(→_openTextInputAt→focus())を呼ぶタイミングを
//  touchstartからtouchend(指/ペンのリフト)へ遅らせることで、タップの正式な確定
//  タイミングでfocus()が呼ばれるようにした。位置は指/ペンを置いた瞬間(touchstart)の
//  座標を使用し、途中で2本指ジェスチャーに発展した場合(_gestureSessionActive)は
//  文字入力を開かずキャンセルする(パン/ピンチ操作は従来通り優先)。
var _textToolPendingOpen92=null;
// V1_46: 手書きモードで指計測時、指に隠れないようカーソルを上にずらすオフセット量(px)
var FINGER_CURSOR_OFFSET_Y=60;

// V1_47: 手書きモードでの指計測 対象判定・呼び分け（DIM=直径/半径、LP=線と点、LL=2線間、
// それ以外の水平/鉛直(dxdy)・斜め(diag)はDIM.active等の状態フラグを持たずcurrentToolで
// 判定するhandlePointerDown/Move/Up内蔵の仕組みのため、ここで一本化して呼び分ける）
function _fingerMeasureActive(){
  return _isAnyMeasureActive()
      ||currentTool==='dx'||currentTool==='dy'||currentTool==='dxdy'||currentTool==='diag';
}
function _fingerMeasureDown(sx,sy){
  // V3_04: _dispatchMeasureDownに一本化(IPX/DIM/LP/LL/LLEN/ANG)。
  if(!_dispatchMeasureDown(sx,sy)) handlePointerDown(sx,sy,true); // dx/dy/dxdy/diag: ペン相当のダウン→ムーブ→アップで確定
}
function _fingerMeasureMove(sx,sy){
  if(!_dispatchMeasureMove(sx,sy)) handlePointerMove(sx,sy,true);
}
function _fingerMeasureUp(sx,sy){
  if(!_dispatchMeasureUp(sx,sy)) handlePointerUp(sx,sy,true);
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
  if(window.LLEN&&window.LLEN.active){ // V1_240: 線の長さ
    var Z=window.LLEN;
    if(Z.phase===0) return Z._hoverLine?null:(Z._hoverPos?{wx:Z._hoverPos.x,wy:Z._hoverPos.y}:null);
    if(Z.phase===1) return Z._hoverPos?{wx:Z._hoverPos.x,wy:Z._hoverPos.y}:null;
    return null;
  }
  if(window.ANG&&window.ANG.active){ // V2_63: 角度
    var A=window.ANG;
    if(A.phase===0||A.phase===1) return A._hoverLine?null:(A._hoverPos?{wx:A._hoverPos.x,wy:A._hoverPos.y}:null);
    if(A.phase===2) return A._hoverPos?{wx:A._hoverPos.x,wy:A._hoverPos.y}:null;
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
  // V2_48: 「カラー(背景白)」(colorLightBg)追加に伴い、白背景かどうかの判定に
  // bwModeだけでなくcolorLightBgも含めるよう拡張(白背景時は従来のbwMode相当の
  // ハロー色にする)
  var _isLightBg48=(typeof bwMode!=='undefined'&&bwMode)||(typeof colorLightBg!=='undefined'&&colorLightBg);
  var haloColor=_isLightBg48?'rgba(255,255,255,0.95)':'rgba(0,0,0,0.6)';
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
  // V3_04: IPX/DIM/LP/LL/LLEN/ANGのactive判定を一本化(_activeMeasureTool)。
  // IPXは他の計測ツールへの「点供給」として直接呼ぶ必要があるため呼び分ける。
  { var _hpdMt=_activeMeasureTool(); if(_hpdMt){ if(_hpdMt===window.IPX) _hpdMt.handleDown(sx,sy); return; } }
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
  // V2_80: 文字入力ツール。タップした位置にキーボード入力ボックスを開く
  // (マウスクリック・Apple Pencilタップは常にこのhandlePointerDownへ到達するため、
  // ここに分岐を置くだけで両方に対応できる。指(フリーハンドモード)からの利用は
  // 下のtouchstart側ガード条件に'text'を追加することで対応している)
  if(currentTool==='text'){
    _openTextInputAt(wx,wy,sx,sy);return;
  }
  // V2_90: なげわ(lasso)ツール。選択中バウンディングボックス内なら移動開始、
  // それ以外なら選択解除して新規に囲み線の描画を開始する
  if(currentTool==='lasso'){
    _lassoPointerDown(wx,wy);return;
  }
  // V2_95: 図形ツール(四角・矢印・丸・楕円)。ドラッグ開始点を記録する
  if(_isShapeTool(currentTool)){
    _shapePointerDown(wx,wy);return;
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
  // V3_04: IPX/DIM/LP/LL/LLEN/ANGのactive判定を一本化(_activeMeasureTool)。
  if(window.IPX&&window.IPX.active){window.IPX.handleMove(sx,sy);return;}
  if(typeof _dimTextDrag!=='undefined'&&_dimTextDrag&&typeof _dimTextDragMove==='function'&&_dimTextDragMove(sx,sy)) return; // V0_102
  if(_isAnyMeasureActive())return;
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
  // V2_90: なげわ(lasso)ツール。描画中は囲み線を延長、移動中は選択範囲を平行移動
  if(currentTool==='lasso'){
    if(mouseDown) _lassoPointerMove(wx,wy);
    return;
  }
  // V2_95: 図形ツール(四角・矢印・丸・楕円)。ドラッグ中はプレビュー用に終点を更新
  if(_isShapeTool(currentTool)){
    if(mouseDown) _shapePointerMove(wx,wy);
    return;
  }
  // スケッチ/蛍光ペン描画
  if(isPenInput||currentTool==='sketch'||currentTool==='hl'){
    if(sketching){sketchPts.push({x:wx,y:wy});scheduleOverlay();}return;
  }
  // パン
  // V1_102: このパン分岐はタッチ(iPad)側では別途直接tx/tyを操作しており経由しないため、
  // 実質的にPCのマウスドラッグ時のみを通る。大容量DXFでのPC操作時のカクつき対策として、
  // ドラッグパン中は簡略描画モード(_interacting)を有効にし、操作停止後に精密描画へ戻す
  if(panning){_beginInteraction();tx+=sx-lastMX;ty+=sy-lastMY;scheduleDraw();}
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
  // V3_04: IPX/DIM/LP/LL/LLEN/ANGのactive判定を一本化(_activeMeasureTool)。
  if(window.IPX&&window.IPX.active){window.IPX.handleUp(sx,sy);return;}
  if(typeof _dimTextDragUp==='function'&&_dimTextDragUp()) return; // V0_102
  if(_isAnyMeasureActive())return;
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
  // V2_90: なげわ(lasso)ツール。描画中なら囲み線を確定して選択、移動中なら保存して終了
  if(currentTool==='lasso'){
    _lassoPointerUp();return;
  }
  // V2_95: 図形ツール(四角・矢印・丸・楕円)。ドラッグ終了点からptsを計算し確定する
  if(_isShapeTool(currentTool)){
    _shapePointerUp();return;
  }
  if(isPenInput||currentTool==='sketch'||currentTool==='hl'){
    if(sketching&&sketchPts.length>1){
      snapshot();
      if(currentTool==='hl'){
        // 蛍光ペン: hl:true フラグ付きで保存（V0_70）
        // V1_65: PDFの場合、現在ページ番号をpageとして付与（ページごとに書き込みを分離するため）
        strokes.push({pts:[...sketchPts],color:{...currentHL_Color},lw:currentHL_LW,hl:true,hlOpacity:currentHLAlpha,page:_curPage()}); // V2_98: 濃度を保存
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
  // V2_80: 文字入力ツールで配置した文字(s.isText)はpts(線の点列)を持たないため、
  // 従来のs.pts.some(...)のままだとここでクラッシュしていた。文字は自身の座標
  // (s.x,s.y)が消しゴム半径内かどうかで判定するよう分岐を追加した
  strokes=strokes.filter(s=>(s.page||1)!==cur||(s.pts?!s.pts.some(p=>Math.hypot(p.x-wx,p.y-wy)<r):Math.hypot(s.x-wx,s.y-wy)>=r));
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
var _mouseTextPickPending=false,_mouseTapStartTime=0,_mouseTapStartX=0,_mouseTapStartY=0; // V1_86
ov.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  // V1_86: 画面検索/検索して開くパネルが開いている間(_textPickTarget有効時)は、
  // マウスクリックでの書込み・消しゴム・計測操作を行わず、図面上の文字クリックでの
  // テキスト読込を最優先する（V1_83のタッチ操作(_textPickTarget)と同じ考え方をマウスにも適用）。
  // DIM/LP/LL.handleDown・handlePointerDownを一切呼ばないため、ドラッグ中もそれらの
  // hoverプレビュー更新以外の実際のデータ変更(点確定・描画・消しゴム)は発生しない
  if(typeof _textPickTarget!=='undefined'&&_textPickTarget){
    mouseDown=true;const p=getPos(e);lastMX=p.x;lastMY=p.y;
    _mouseTextPickPending=true;
    _mouseTapStartTime=Date.now();_mouseTapStartX=p.x;_mouseTapStartY=p.y;
    return;
  }
  mouseDown=true;const p=getPos(e);lastMX=p.x;lastMY=p.y;
  // V3_04: IPX/DIM/LP/LL/LLEN/ANGのactive判定→handleDown呼び出しを一本化(_dispatchMeasureDown)
  if(!_dispatchMeasureDown(p.x,p.y)) handlePointerDown(p.x,p.y,false);
});
window.addEventListener('mousemove',e=>{
  // V3_02: サブ窓自身のmousemoveハンドラ(index.html _swAttachInput)が既にこのイベントを
  // サブ窓自身の座標系(withCtx)で処理済みの場合、このwindowレベルのグローバルリスナーは
  // 常にメイン画面のov/tx/ty/scaleを使って同じイベントを二重処理してしまい、なげわの
  // 囲み線や図形のプレビューがおかしな座標で壊れる原因になる。_swActiveMouseDrag92が
  // 立っている間(サブ窓内でマウスボタンが押されている間)はここで何もしない。
  if(window._swActiveMouseDrag92) return;
  const p=getPos(e);
  // V1_95: テキスト読込ピックモード中(_textPickTarget有効時)は、mousedown/mouseup
  // 側と同様にDIM/LP/LLのホバープレビュー更新・ペン/消しゴムのポインタ処理も
  // 一切行わない。従来はmousemoveだけこのチェックが漏れており、検索して開く等を
  // 開いた後も計測ツールのホバー候補が更新され続け、「操作がキャンセルされて
  // いない」ように見える一因になっていた
  if(typeof _textPickTarget!=='undefined'&&_textPickTarget){ lastMX=p.x;lastMY=p.y; return; }
  // V3_04: 一本化(_dispatchMeasureMove)。mouseDown不要: ホバー中も_hoverPos更新のため毎回呼ぶ
  if(!_dispatchMeasureMove(p.x,p.y)) handlePointerMove(p.x,p.y,false);
  lastMX=p.x;lastMY=p.y;
});
window.addEventListener('mouseup',e=>{
  // V3_02: mousemove側と同じ理由。サブ窓自身のmouseupハンドラが既に処理済み(かつ
  // mouseDown/_swActiveMouseDrag92の後始末も済ませている)ため、ここでの二重処理を防ぐ
  if(window._swActiveMouseDrag92) return;
  if(!mouseDown)return;mouseDown=false;
  const p=getPos(e);
  // V1_86: mousedown時にテキスト読込ピック待機中だった場合は、DIM/LP/LL/handlePointerUpを
  // 呼ばず、クリック相当(短時間・小移動)なら文字読込を試みる。ドラッグ的な動きだった場合や
  // 待機中に_textPickTargetが解除された場合は何もしない（元々handleDownを呼んでいないため
  // 安全に無視できる）
  if(_mouseTextPickPending){
    _mouseTextPickPending=false;
    if(typeof _textPickTarget!=='undefined'&&_textPickTarget&&_mouseTapStartTime){
      var _mDt=Date.now()-_mouseTapStartTime;
      var _mDd=Math.hypot(p.x-_mouseTapStartX,p.y-_mouseTapStartY);
      if(_mDt<600&&_mDd<6){ // マウスは指ほど誤差が無いため許容範囲は小さめ
        if(typeof _tapPickText==='function') _tapPickText(p.x,p.y);
      }
    }
    _mouseTapStartTime=0;
    return;
  }
  // V3_04: 一本化(_dispatchMeasureUp)
  if(!_dispatchMeasureUp(p.x,p.y)) handlePointerUp(p.x,p.y,false);
});
ov.addEventListener('wheel',e=>{
  e.preventDefault();
  const p=getPos(e);
  // V1_86: ホイール/トラックパッドを回す・動かす勢い(deltaYの大きさ)に応じて滑らかに
  // 拡大縮小の変化量を変える。従来は符号のみを見て常に固定倍率(15%)だったため、座標の
  // 大きい図面(建物全体等)では全体表示から詳細表示まで辿り着くのに必要なホイール回数が
  // 多く感じられていた（データの絶対座標によって倍率自体が変わっていたわけではない）。
  // deltaModeの違い(line/page単位)をpixel相当に正規化した上で、一般的なマウスホイール
  // 1ノッチ(deltaY=100前後)では従来と同じ約15%になるよう係数を合わせつつ、
  // 強く/速く回すほど大きく、そっと回すほど小さく変化するようにする
  var _wd=e.deltaY;
  if(e.deltaMode===1) _wd*=16; // DOM_DELTA_LINE→pixel相当
  else if(e.deltaMode===2) _wd*=800; // DOM_DELTA_PAGE→pixel相当(概算)
  _wd=Math.max(-800,Math.min(800,_wd)); // 極端な単発ジャンプの安全策
  const _wf=Math.pow(1.15,-_wd/100);
  // V1_102: 大容量DXFでのPC操作時のカクつき対策。ホイールズーム中は簡略描画モード
  // (_interacting)を有効にし、操作停止後に精密描画へ戻す
  _beginInteraction();
  zoomAt(p.x,p.y,_wf);scheduleDraw();
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
      // V3_04: 一本化(_dispatchMeasureDown)。textツールは計測系より後に判定する必要があるため、
      // 計測系がアクティブでない場合のみtext判定→通常のhandlePointerDownへ進む。
      if(!_dispatchMeasureDown(sx,sy)){
        if(currentTool==='text'){
          // V2_93: 文字ツールはここ(touchstart=ペンが触れた瞬間)ではまだ入力枠を開かず、
          // 位置だけ記憶してtouchend(ペンが離れた瞬間)で開く。理由は_textToolPendingOpen92
          // 宣言部のコメントを参照(iOSでtouchstart起点のfocus()はキーボードが出ないため)。
          _textToolPendingOpen92={sx:sx,sy:sy,isPenInput:true};
        } else {
          handlePointerDown(sx,sy,true);
        }
      }
    }
  } else if(fingers.length>=2){
    // 2本指: ピンチズーム+パン
    if(sketching){sketching=false;sketchPts=[];}
    // V1_97: 2本指ピンチは、指Aが単独で触れた直後(fingers.length===1の
    // touchstartが1回発火した後)に指Bが加わって初めて成立することが多い。
    // このわずかな間に、手書きモード+計測ツール(DIM/LP/LL)選択中だと
    // 指Aの単独touchstartだけで既にhandleDown()が呼ばれ、penDown=trueの
    // まま「候補位置(cur/_hoverLine)が確定待ち」の状態になっていた。
    // ピンチ中は_fingerMeasureMove()が一切呼ばれないためこの候補位置は
    // 更新されずピンチ開始前の古い位置のまま残り、ピンチ終了後に指を
    // 離すと(penDownがtrueのままのため)その古い候補位置で計測点が
    // 確定してしまう不具合があった（「離れた2点を測定する場合、2点目を
    // 選ぶ前に手でズームすると点が打たれてしまう」）。sketchingと同様に、
    // 2本指が揃った時点でDIM/LP/LLのpenDownを強制的に解除し、指Aの
    // 単独touchstartが与えた影響を無効化する（各ツールのhandleUpは
    // penDown===falseなら何もしないため、これだけで安全にキャンセルできる）
    if(window.DIM) window.DIM.penDown=false;
    if(window.LP) window.LP.penDown=false;
    if(window.LL) window.LL.penDown=false;
    if(window.LLEN) window.LLEN.penDown=false; // V1_240: 線の長さ
    if(window.ANG) window.ANG.penDown=false; // V2_63: 角度
    _textToolPendingOpen92=null; // V2_93: 1本指タップ保留中に2本目が触れたら2本指ジェスチャー優先でキャンセル
    mouseDown=false;panning=false;
    // V1_101: 2本指が揃った時点で「このタッチセッションはジェスチャー(ピンチ/パン)
    // である」ことを示すセッション全体フラグを立てる。従来(V1_99/V1_100)の
    // 時間ベースの猶予(0.3秒→0.8秒)と異なり時間で自動解除されないため、
    // 全指が完全に離れて新しいタッチセッションが始まるまで、書き込み・計測の
    // 確定が一切行われなくなる（詳細はtouchendのremaining.length===0側を参照）
    _gestureSessionActive=true;
    const t0=fingers[0],t1=fingers[1];
    const x0=t0.clientX-r.left,y0=t0.clientY-r.top;
    const x1=t1.clientX-r.left,y1=t1.clientY-r.top;
    pinchDist=Math.hypot(x1-x0,y1-y0);
    pinchMid={x:(x0+x1)/2,y:(y0+y1)/2};
  } else if(fingers.length===1){
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    isPen=false;mouseDown=true;lastMX=sx;lastMY=sy;
    // V1_83: 画面検索/検索して開くパネルが開いている間(_textPickTarget有効時)は、
    // 手書きモードでの描画・消しゴム・指計測より、文字タップでのテキスト読込ピックを
    // 優先する。パン扱いにしてtouchend側の既存のテキスト読込ピック判定(_textPickTarget)
    // に委ねる。サブ窓作成のドラッグ操作(SW.active)は対象外とし従来通り動作する
    if(typeof _textPickTarget!=='undefined'&&_textPickTarget
        &&inputMode==='freehand'&&!(window.SW&&window.SW.active)
        &&(_fingerMeasureActive()||currentTool==='sketch'||currentTool==='hl'||currentTool==='eraser'||currentTool==='lasso'||_isShapeTool(currentTool))){
      if(sketching){sketching=false;sketchPts=[];}
      panning=true;
      _panAnchorX=null;_panAnchorY=null; // V1_101: 移動距離判定の起点をパン開始のたびにリセット
      _tapStartTime=Date.now();_tapStartX=sx;_tapStartY=sy;
    } else if(currentTool==='text'){
      // V2_93: 文字ツールは「手書きモード(inputMode==='freehand')」かどうかに関係なく、
      // 指タップで常にテキスト入力を開始できるようにする。
      // 【問題1の根本原因】従来はこの分岐が inputMode==='freehand' 限定の
      // 下のelse-if内にあり、既定値である inputMode==='pen'(ペンモード)の場合は
      // ここへ到達せず一番下のelse(1本指パン)に落ちて、指タップではhandlePointerDown
      // (延いては_openTextInputAt)が一切呼ばれていなかった。
      // 実際に入力枠を開く処理(handlePointerDown呼び出し)はここでは行わず、位置だけ
      // 記憶してtouchend(指が離れた瞬間)まで遅らせる。理由は_textToolPendingOpen92
      // 宣言部のコメント(iOSのfocus()タイミング制約)を参照。
      panning=false;
      _textToolPendingOpen92={sx:sx,sy:sy,isPenInput:false};
    } else if(inputMode==='freehand'&&_fingerMeasureActive()){
      panning=false;
      const fy=sy-FINGER_CURSOR_OFFSET_Y;
      _fingerMeasureDown(sx,fy);
      lastMX=sx;lastMY=fy;
    } else if(inputMode==='freehand'
        &&(currentTool==='sketch'||currentTool==='hl'||currentTool==='eraser'||currentTool==='lasso'||_isShapeTool(currentTool)||(window.SW&&window.SW.active))){
      // V0_79: 手書きモード + スケッチ/蛍光ペン → 指で描画
      // V0_152.2: 手書きモード + サブ窓作成中(SW.active) → 指1本で対角ドラッグできるように追加
      panning=false;
      handlePointerDown(sx,sy,false); // currentTool===sketch/hl/サブ窓作成中 なので描画(操作)開始
    } else {
      // ペンモード or 手書きモード+非描画ツール: パンのみ（既存動作）
      if(sketching){sketching=false;sketchPts=[];}
      panning=true;
      _panAnchorX=null;_panAnchorY=null; // V1_101: 移動距離判定の起点をパン開始のたびにリセット
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
    // V3_04: 一本化(_dispatchMeasureMove)
    if(!_dispatchMeasureMove(sx,sy)) handlePointerMove(sx,sy,true);
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
  } else if(fingers.length===1&&mouseDown&&!panning&&(sketching||(inputMode==='freehand'&&(currentTool==='eraser'||currentTool==='lasso'||_isShapeTool(currentTool)))||(window.SW&&window.SW.active))){
    // V0_79: 手書きモード 指1本描画中 / V0_152.2: サブ窓作成の対角ドラッグ中も含む
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    // V3_04: 一本化(_dispatchMeasureMove)。旧コードはDIM/LPのみ判定しLL/LLEN/ANGが
    // 漏れていた(コピー元がV0_153以前のままだった構造的な反映漏れ)。この一本化で解消。
    if(!_dispatchMeasureMove(sx,sy)) handlePointerMove(sx,sy,false);
    lastMX=sx;lastMY=sy;
  } else if(fingers.length===1&&mouseDown&&panning){
    // 1本指パン（既存動作）
    const t=fingers[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    tx+=sx-lastMX;ty+=sy-lastMY;scheduleDraw();
    // V1_101: 移動距離判定。パン中の指がパン開始位置から一定距離
    // (GESTURE_MOVE_THRESHOLD_PX)以上動いたら、2本指ジェスチャーの本数変化
    // イベントだけでは検知できなかった場合の保険として_gestureSessionActiveを
    // 立てる（本数ベースの判定(touchstartのfingers>=2分岐)と組み合わせることで、
    // どちらか一方でも「ジェスチャー中」と判定されれば書き込み・計測を確定しない）
    if(_panAnchorX===null){_panAnchorX=sx;_panAnchorY=sy;}
    else if(Math.hypot(sx-_panAnchorX,sy-_panAnchorY)>GESTURE_MOVE_THRESHOLD_PX){
      _gestureSessionActive=true;
    }
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
    if(_textToolPendingOpen92){
      // V2_93: 文字ツールはペンが離れた「今」初めて入力枠を開き、この同期コールスタック内で
      // focus()する(タップの正式な確定タイミング=touchendでないとiOSでキーボードが
      // 表示されないため)。_textInputTouchOrigin経由で_openTextInputAt側に同期focusを指示する。
      var _tp92pen=_textToolPendingOpen92;_textToolPendingOpen92=null;
      _textInputTouchOrigin=true;
      handlePointerDown(_tp92pen.sx,_tp92pen.sy,true);
    } else {
      // V3_04: 一本化(_dispatchMeasureUp)
      if(!_dispatchMeasureUp(lastMX,lastMY)) handlePointerUp(lastMX,lastMY,true);
    }
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
    // V2_93: 文字ツールの指タップ保留があれば最優先で処理する。指が離れた「今」
    // 初めて入力枠を開きfocus()する(タップの正式な確定タイミング=touchendでないと
    // iOSでキーボードが表示されないため)。ただし保留中に2本指ジェスチャーへ発展
    // していた場合(_gestureSessionActive、または2本目が触れた時点でtouchstart側が
    // 既に_textToolPendingOpen92をnullにしている)は、パン/ピンチ操作を優先し
    // 文字入力は開かない。
    if(_textToolPendingOpen92){
      var _tp92fin=_textToolPendingOpen92;_textToolPendingOpen92=null;
      if(!_gestureSessionActive){
        _textInputTouchOrigin=true;
        handlePointerDown(_tp92fin.sx,_tp92fin.sy,false);
      }
      _tapStartTime=0;_gestureSessionActive=false;_panAnchorX=null;_panAnchorY=null;
      panning=false;mouseDown=false;pinchDist=null;pinchMid=null;
      return;
    }
    // V1_101: V1_99/V1_100の時間ベースの猶予(0.3秒→0.8秒)でも実機で誤操作が
    // 続いたため、時間で区切る方式をやめ、_gestureSessionActive(このタッチ
    // セッション中に一度でも2本指以上・または一定距離以上のパン移動があったか)
    // の一点で判定するようにした。時間切れによる取りこぼしがなくなる
    // （詳細はグローバル変数宣言部・touchstartのfingers>=2分岐・
    // touchmoveの1本指パン分岐を参照）
    // V1_46/V1_47: 手書きモードで指計測中（DIM/LP/LL・水平鉛直・斜め）だった場合は
    // 指を離した位置で確定
    if(!_gestureSessionActive&&!isPen&&inputMode==='freehand'&&_fingerMeasureActive()){
      _fingerMeasureUp(lastMX,lastMY);
    }
    // V0_79: 手書きモードで指描画中だった場合はストロークを確定
    // V0_152.2: サブ窓作成の対角ドラッグ中(指を離して矩形確定)も含む
    if(!_gestureSessionActive&&!isPen&&(sketching||(inputMode==='freehand'&&(currentTool==='eraser'||currentTool==='lasso'||_isShapeTool(currentTool)))||(window.SW&&window.SW.active))){
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
    // V1_93: 「テキスト読込」ピックモード中(_textPickTarget有効時)にDIM/LP/LLが
    // 計測途中(phase>0)だと、このif自体がまるごと成立せず_tapPickText呼び出しにすら
    // 到達できず、手書きモード+検索して開く/画面検索でテキスト読込が反応しない不具合が
    // あった。V1_27のコメント通り本来テキスト読込はダブルタップ全体表示より優先される
    // 設計のため、phase>0ガードはダブルタップ全体表示の判定にのみ適用し、テキスト読込
    // 側は独立してphase>0でも実行されるよう分離した
    // V2_22: SWはDIM/LP/LL/LLENと異なりphase概念を持たないため、従来は「SW.activeで
    // あるだけ」で無条件にダブルタップ全体表示をブロックしていた。ボタンを押した直後
    // (まだドラッグを開始していない=penDown===false)でもブロックされてしまい、V2_22の
    // 上記リセット漏れ修正と合わせ、実際に範囲ドラッグ中(penDown===true)の場合のみ
    // ブロックするよう他の計測ツールと同等の粒度に揃える(防御的な二重対策)
    if(!isPen&&panning&&!sketching&&!(window.SW&&window.SW.active&&window.SW.penDown)&&_tapStartTime){
      var _tapDt=Date.now()-_tapStartTime;
      var _tapDd=Math.hypot(lastMX-_tapStartX,lastMY-_tapStartY);
      if(_tapDt<300&&_tapDd<12){ // 短時間・小移動＝ドラッグではなくタップ
        // V1_27: 「テキスト読込」ピックモード中は、ダブルタップ全体表示より優先して
        // タップ位置の文字要素を拾い、画面検索/全図面検索の入力欄へ自動入力する
        if(typeof _textPickTarget!=='undefined'&&_textPickTarget){
          if(typeof _tapPickText==='function') _tapPickText(lastMX,lastMY);
          _lastTapTime=0;
        } else if(!_isAnyMeasurePhaseActive()){ // V3_04: 一本化(_isAnyMeasurePhaseActive)
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
    _gestureSessionActive=false; // V1_101: このタッチセッションの判定はここで使い切り、次回に持ち越さない
    _panAnchorX=null;_panAnchorY=null;
    if(!isPen){panning=false;mouseDown=false;}
    pinchDist=null;pinchMid=null;return;
  }
  // 2本指→1本指への移行
  if(remFing.length===1&&pinchDist!==null&&!isPen){
    pinchDist=null;pinchMid=null;
    const t=remFing[0];
    const sx=t.clientX-r.left,sy=t.clientY-r.top;
    mouseDown=true;lastMX=sx;lastMY=sy;
    // V1_96: ピンチズーム終了時、2本の指がぴったり同時に離れることは少なく、
    // 片方がわずかに早く離れて一瞬「2本指→1本指」の状態を経由することがよくある。
    // 従来はこの瞬間を「指を持ち替えて手書き描画・計測を続けたい」意図とみなし、
    // 残った指の位置でスケッチ再開(V0_79)・計測ツールの指計測再開(V1_46/V1_47)を
    // 自動的に行っていた。しかし実際には「ズームイン・ズームアウトすると誤操作で
    // ペンの線が残る」「離れた2点を測る際、2点目を選ぶ前にズームすると意図しない
    // 位置に点が打たれる」不具合の原因になっていたため、この自動再開を廃止し、
    // ピンチ終了直後は常にパン継続として扱うよう変更した。描画・計測を続けたい
    // 場合は、指を完全に離してから改めてタップ/ドラッグする（通常のtouchstartの
    // 1本指分岐を経由するため、意図した位置で正しく再開できる）
    panning=true;
    // V1_99/V1_100: この時点から一定時間(0.3秒→0.8秒)以内に全指が離れた場合は
    // 確定しない、という時間ベースの猶予を設けていたが、実機で誤操作が続いた。
    // V1_101: 2本指を経由した時点で既にtouchstart側の_gestureSessionActive=trueが
    // 立っているため、時間経過に関わらず全タッチ終了まで確定は抑止される。ここでは
    // 移動距離判定(GESTURE_MOVE_THRESHOLD_PX)の起点をリセットするのみでよい
    _panAnchorX=null;_panAnchorY=null;
  }
},{passive:false});

// V2_94: touchcancel対応。従来touchstart/touchmove/touchendの3つしか`ov`に登録して
// おらず、touchcancel(iPadでは画面端からのシステムジェスチャー(コントロールセンター/
// アプリスイッチャー/Dock表示等)や着信・通知、Apple Pencilのダブルタップ操作切替など、
// 「指を意図的に離していないのにOS側が一方的にタッチシーケンスを打ち切る」場面で
// touchendの代わりに発火する)を一切処理していなかった。これが発生すると
// mouseDown/panning/isPen/_textToolPendingOpen92等の状態がtrueや値ありのまま
// 固まってしまい、特に文字ツールでは「保留中だった_textToolPendingOpen92がtouchendで
// 開かれる機会を永久に失い、以後そのタップは無かったことになる（ユーザーからは
// “タップしても入力欄が出ない”ように見える）」という不具合の原因になり得る
// （他ツールでも同様にpanning等が残留し、次の操作に予期せぬ影響を与え得る）。
// touchendの「全タッチ終了」時の状態クリア処理と同じ変数群を、確定処理(コミット)は
// 一切行わずにリセットするだけの安全な形でtouchcancelにも適用する。
ov.addEventListener('touchcancel',e=>{
  const remaining=Array.from(e.touches);
  if(remaining.length>0) return; // 残っている指がある間はキャンセル扱いにしない(他の指は継続)
  // 文字ツールの保留は「タップが確定しなかった」ものとして破棄する(開かない)
  _textToolPendingOpen92=null;
  // スケッチ/蛍光ペンの描画中データも中断された入力なので破棄する(中途半端な線が
  // 残らないよう、確定(handlePointerUp)はせずpts配列ごと捨てる)
  if(sketching){sketching=false;sketchPts=[];scheduleOverlay();}
  // V2_95: 図形ツール(四角・矢印・丸・楕円)のドラッグ中データも、中断された入力として
  // 確定(_shapePointerUp)せずに破棄する(中途半端な図形が残らないように、かつ次の操作で
  // drawing=trueのまま固まらないようにする。文字ツール(V2_92-94)・スケッチ(上記)と
  // 同じ考え方)
  if(typeof shapeToolState!=='undefined'&&shapeToolState.drawing){
    shapeToolState.drawing=false;shapeToolState.tool=null;shapeToolState.start=null;shapeToolState.cur=null;
    scheduleOverlay();
  }
  mouseDown=false;isPen=false;panning=false;
  pinchDist=null;pinchMid=null;
  _gestureSessionActive=false;_panAnchorX=null;_panAnchorY=null;_tapStartTime=0;
},{passive:true});

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
// V1_207: 消しゴム(eraser)を追加し、ペン・蛍光ペンと同じ「選択中のアイコンを再タップ
// すると範囲選択ポップアップが開く」動作にした。計測系6ツール(dxdy等)は従来通り'dim'を
// 維持する(下のクリックハンドラでこの値を見て「状態リセットをしない」保護を掛けている
// ため)が、色選択が#measureToolPopupに常時表示されるようになったので、再タップ時に
// 別ポップアップを開く処理自体は行わない(下のif(_mode==='dim')分岐を参照)
const _TOOL_COLOR_MODE={sketch:'sketch',hl:'hl',eraser:'eraser',text:'sketch',rect:'sketch',arrow:'sketch',circle:'sketch',ellipse:'sketch',cloud:'sketch',dxdy:'dim',diag:'dim',ll:'dim',lp:'dim',circDim:'dim',radDim:'dim',lineLen:'dim',ang:'dim'}; // V2_63: 角度追加 / V2_80: 文字入力(ペンと同じ色/太さポップアップを流用) / V2_95: 図形ツール(四角・矢印・丸・楕円、ペンと同じ色/太さポップアップを流用) / V2_108: 雲印追加
// V1_205: 計測ツール選択ポップアップ(#measureToolPopup、index.html)用。6つの計測ツールの
// うちどれかが新たに選択された時、ヘッダーの計測ボタン(#measureCurrentLabel、3段表示の
// 3段目)に選択中のツール名を表示し、ポップアップを閉じる。すでに選択中のツールの
// アイコンを再タップした場合(下のstopImmediatePropagation分岐)はこの処理には来ない
// (色/太さポップアップが開くだけで、選択自体は変わらないため表示更新も不要)
const _MEASURE_TOOL_LABELS={dxdy:'水・鉛',diag:'斜め',ll:'2線間',lp:'線と点',circDim:'直径',radDim:'半径',lineLen:'線長',ang:'角度'}; // V2_63: 角度追加
// V2_96: 図形ツール選択ポップアップ(#shapeToolPopup、index.html)用。_MEASURE_TOOL_LABELS
// と全く同じ役割(選択された図形の名前をヘッダーの図形ボタン下段ラベル(#shapeCurrentLabel)
// に表示し、ポップアップを閉じる)。currentTool自体は従来通り'rect'/'arrow'/'circle'/
// 'ellipse'のまま(値は変更しない)なので、_isShapeTool/storage.js/guideMap等は無改修
const _SHAPE_TOOL_LABELS={rect:'四角',arrow:'矢印',circle:'丸',ellipse:'楕円',cloud:'雲印'}; // V2_108: 雲印追加
// V2_96: ヘッダーの図形ボタン(#shapeToggleBtn)を他ツールから押した時に、前回選んで
// いた図形タイプを直接復元できるよう記憶する(_lastMeasureToolと同じ考え方)。
// var宣言でグローバル公開(index.htmlの#shapeToggleBtnクリックハンドラが参照するため)
var _lastShapeTool=null;
// V1_219: 「計測ボタンのアイコンを、選択中の計測ツールのアイコンにしてほしい」との
// 依頼への対応。ヘッダーの計測ボタン(#measureToolIcon)は従来ずっと定規アイコン固定
// だったが、計測ツールが選択されている間はそのツール専用のアイコン(下記、
// #measureToolPopup内の各.dimToolIconと全く同じ形状)に差し替え、未選択(ペン等の
// 他ツール選択中)の時は定規アイコンに戻す。style.color(選択中の計測線色)は
// svg要素自身に付くため、innerHTML(子要素)だけを差し替えるこの方式なら
// updateToolColorDots()側の色反映処理には一切影響しない。
// var(constではない)で宣言し、index.html/storage.jsの別スクリプトタグからも
// 直接参照できるようにする(_MEASURE_TOOL_LABELS等のconstは別タグから参照できず
// 過去にハードコード重複が必要だった前例があるため、今回は最初からvarにした)
var _MEASURE_RULER_ICON_INNER='<rect x="2" y="9" width="20" height="6" rx="1"/><line x1="6" y1="9" x2="6" y2="12"/><line x1="10" y1="9" x2="10" y2="12"/><line x1="14" y1="9" x2="14" y2="12"/><line x1="18" y1="9" x2="18" y2="12"/>';
var _MEASURE_TOOL_ICON_INNER={
  dxdy:'<line x1="3" y1="9" x2="15" y2="9"/><line x1="3" y1="6" x2="3" y2="12"/><line x1="15" y1="6" x2="15" y2="12"/><line x1="18" y1="9" x2="18" y2="21"/><line x1="15" y1="9" x2="21" y2="9"/><line x1="15" y1="21" x2="21" y2="21"/>',
  diag:'<line x1="5" y1="19" x2="19" y2="5"/><polyline points="5 13 5 19 11 19"/><polyline points="13 5 19 5 19 11"/>',
  ll:'<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="12" y1="7" x2="12" y2="17"/><polyline points="9 10 12 7 15 10"/><polyline points="9 14 12 17 15 14"/>',
  lp:'<line x1="3" y1="21" x2="21" y2="3"/><circle cx="17" cy="17" r="3"/><line x1="17" y1="14" x2="12" y2="9" stroke-dasharray="2,2"/>',
  circDim:'<circle cx="12" cy="12" r="8"/><line x1="4" y1="12" x2="20" y2="12"/>',
  radDim:'<circle cx="12" cy="12" r="8"/><line x1="12" y1="12" x2="20" y2="12"/><text x="14" y="11" font-size="5" fill="currentColor" stroke="none">R</text>',
  lineLen:'<line x1="4" y1="12" x2="20" y2="12"/><polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/>', // V1_240: 線の長さ追加(#measureToolPopup内の.dimToolIconと同一形状)
  ang:'<line x1="4" y1="20" x2="21" y2="20"/><line x1="4" y1="20" x2="15" y2="4"/><path d="M11 20 A7 7 0 0 0 8.1 13.8" fill="none"/>' // V2_63: 角度追加(#measureToolPopup内の.dimToolIconと同一形状)
};
// V1_227: 「計測ボタンの3段目ラベル(#measureCurrentLabel)は、ペン等へ切り替えた後も
// 前回選んでいた計測ツール名(例:水・鉛)が表示されたままなのに、アイコンだけ定規に
// 戻ってしまい、ラベルとアイコンの表示が食い違う」との指摘への対応。ラベルは
// 新たに計測ツールが選ばれた時にしか更新されず、ペン等へ切り替えても文言はそのまま
// 残る仕様(_lastMeasureTool、V1_210)になっているため、アイコン側もcurrentToolが
// 計測ツールでない場合はラベルと同じ基準(_lastMeasureTool)を参照するようにし、
// 一度も計測ツールを使っていない場合にのみ定規アイコンへフォールバックする
// V1_236: 「アプリ再起動時に計測ボタンが『未選択』のままなのに、アイコンは水・鉛など
// 選択中ツールの形になっていて文字とアイコンが食い違う」との指摘への対応。原因は
// storage.jsの復元処理(2箇所)がcurrentTool/_lastMeasureToolを復元した後、この関数を
// 呼んでアイコンだけは同期していたが、#measureCurrentLabelのテキストは上のtool-btn
// クリックハンドラ内(currentTool新規選択時のみ)でしか更新されず、復元時には一切
// 呼ばれていなかったため、ラベルがHTML初期値の「未選択」のまま残っていた。
// アイコンとラベルを同じ関数・同じ判定基準(currentTool→_lastMeasureToolの順で
// フォールバック)でまとめて更新することで、以後どちらか一方だけが更新されて
// 食い違う事態が起きないようにした
function _syncMeasureToggleBtnIcon(){
  var el=document.getElementById('measureToolIcon');
  if(el) el.innerHTML=_MEASURE_TOOL_ICON_INNER[currentTool]||_MEASURE_TOOL_ICON_INNER[_lastMeasureTool]||_MEASURE_RULER_ICON_INNER;
  var _mtLabel236=document.getElementById('measureCurrentLabel');
  if(_mtLabel236) _mtLabel236.textContent=_MEASURE_TOOL_LABELS[currentTool]||_MEASURE_TOOL_LABELS[_lastMeasureTool]||'未選択';
}
// V2_96: 図形ボタン(#shapeToolIcon)用。_MEASURE_TOOL_ICON_INNER/_syncMeasureToggleBtnIcon
// と全く同じ仕組み(currentTool→_lastShapeToolの順でフォールバックし、一度も使って
// いなければ汎用アイコンに戻す)。var宣言でグローバル公開(index.htmlの#shapeToggleBtn
// クリックハンドラ・storage.js復元処理から参照するため)
var _SHAPE_DEFAULT_ICON_INNER='<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17.5" cy="7" r="4"/><ellipse cx="7" cy="17.5" rx="5" ry="3.5"/><line x1="15" y1="15" x2="21" y2="21"/><polyline points="16.5 15 21 15 21 19.5"/>';
var _SHAPE_TOOL_ICON_INNER={
  rect:'<rect x="4" y="6" width="16" height="12" rx="1"/>',
  arrow:'<line x1="4" y1="19" x2="18" y2="5"/><polyline points="9 5 18 5 18 14"/>',
  circle:'<circle cx="12" cy="12" r="8"/>',
  ellipse:'<ellipse cx="12" cy="12" rx="9" ry="6"/>',
  // V2_108: 雲印。#shapeToolPopup内のボタンと同じ雲の輪郭パス
  cloud:'<path d="M6.5 17c-1.93 0-3.5-1.57-3.5-3.5 0-1.74 1.27-3.18 2.94-3.45C6.2 8.2 7.9 7 9.9 7c1.4 0 2.65.6 3.53 1.55C13.9 8.2 14.44 8 15 8c1.93 0 3.5 1.57 3.5 3.5 0 .16-.01.31-.03.46C19.9 12.3 21 13.6 21 15.1c0 1.6-1.4 3.9-3 3.9H6.5z"/>'
};
function _syncShapeToggleBtnIcon(){
  var el=document.getElementById('shapeToolIcon');
  if(el) el.innerHTML=_SHAPE_TOOL_ICON_INNER[currentTool]||_SHAPE_TOOL_ICON_INNER[_lastShapeTool]||_SHAPE_DEFAULT_ICON_INNER;
  // V2_116: 「アイコンで図形の種類は分かるので、一番下は種類名ではなく太さの数値を
  // 表示してほしい」との依頼で、#shapeCurrentLabel(下段ラベル)の内容を図形種類名から
  // currentShapeLW(図形専用の太さ、V2_103)の数値表示に変更した。ペンの#lwLabel等と
  // 同じ「3段目=太さの数値」パターンに揃える。図形の種類が切り替わってもこの関数は
  // 種類にかかわらず常にcurrentShapeLWを表示するので、アイコン(上でセット済み)だけが
  // 種類を表し、下段ラベルは太さ専用になる
  var _slbl96=document.getElementById('shapeCurrentLabel');
  if(_slbl96) _slbl96.textContent=(typeof currentShapeLW!=='undefined')?currentShapeLW:'0.6';
  // V2_96: アイコンの色は選択中の描画色を反映する(updateToolColorDots()からも
  // 呼ばれるが、ここでも二重に反映しておくことでツール切替直後(updateToolColorDots
  // 呼び出し前)の一瞬の色ズレも防ぐ)。
  // V2_102: 図形は専用のcurrentShapeColorを反映する(ペンのcurrentColorとは独立)
  var _shColor102=(typeof currentShapeColor!=='undefined'&&currentShapeColor)?currentShapeColor:currentColor;
  if(el&&_shColor102) el.style.color='rgb('+_shColor102.r+','+_shColor102.g+','+_shColor102.b+')';
}
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click',(e)=>{
    // V2_22: 「サブ窓」ボタンを押した(SW.active=true)後、範囲ドラッグを完了させずに
    // 他のツールボタンへ切り替えると、SW.activeがリセットされる経路がどこにもなく
    // trueのまま残り続けていた不具合の修正。ハンドラの一番最初で実行することで、
    // 「既に選択中のツールの再タップ(下記のif分岐で色選択ポップアップだけ開いて
    // 早期returnする経路)」でも確実にSWをリセットできるようにする。ペン等は初期状態で
    // 既に.tool-btn.activeを持つため(サブ窓選択中もこのクラスは外れない)、サブ窓を
    // 選んだ直後にペンボタンを押すと、まさにこの「既に選択中の再タップ」の分岐に
    // 入ってしまい、それより後にリセット処理を置いても実行されなかった
    if(window.SW&&window.SW.active&&typeof resetSW==='function'){resetSW();if(typeof _swUpdateBtnUI==='function')_swUpdateBtnUI(false);}
    const _mode=_TOOL_COLOR_MODE[btn.dataset.tool];
    if(btn.classList.contains('active')&&_mode){
      // 既に選択中のアイコンの再タップ：ツールの再選択・状態リセットは行わず、
      // 色・太さの選択ポップアップだけを開く。DIM/LP/LL等、同じボタンに登録された
      // 他のフックリスナー（計測状態のリセットを行う）が発火して計測途中の状態を
      // 壊してしまわないよう、stopImmediatePropagation()で止める
      if(e&&e.stopImmediatePropagation)e.stopImmediatePropagation();
      // V1_207: 計測系ツール('dim')は色選択が#measureToolPopupに常時表示されている
      // ため、再タップで別ポップアップを開く必要がない。ここでは「状態リセットを
      // しない」保護だけを効かせ、それ以外は何もしない(何も起きないのが正しい)
      if(_mode==='dim') return;
      if(typeof openContextPopup==='function')openContextPopup(_mode,btn);
      return;
    }
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');currentTool=btn.dataset.tool;
    // V2_94: 文字ツール以外へ切り替えた際、指/ペンタップ保留中の_textToolPendingOpen92が
    // 残っていると、以後見当違いのタイミング(別ツール選択後のtouchend)で文字入力枠が
    // 開いてしまう可能性があるため必ず破棄する。_textInputTouchOrigin(消費型フラグ)も
    // 前回タップの残留が次回に影響しないよう同時にリセットする
    if(currentTool!=='text'){ _textToolPendingOpen92=null; _textInputTouchOrigin=false; }
    // V1_205: 計測ツールが新たに選択されたら、計測ボタンの3段目ラベルを更新し、
    // 計測ツール選択ポップアップ(#measureToolPopup)を閉じる
    if(_MEASURE_TOOL_LABELS[currentTool]){
      var _mtLabel205=document.getElementById('measureCurrentLabel');
      if(_mtLabel205) _mtLabel205.textContent=_MEASURE_TOOL_LABELS[currentTool];
      // V2_100: 計測ツールを選んでも#measureToolPopupは自動的に閉じないようにした
      // (2点選んで計測を確定する前に色も変えたい、という要望への対応)。
      // ポップアップ右上の「決定」ボタンを押した時だけ閉じる
      // V1_210: 次に他ツールから計測ボタンを押した時にこのツールを直接復元できるよう記憶
      // (この下のscheduleSave()で一緒に保存される)
      _lastMeasureTool=currentTool;
    }
    // V1_207: 計測ボタン(#measureToggleBtn)の枠は、計測系ツールがcurrentToolの時だけ
    // 色付きにする(常時色付きだと選択中かどうか分かりにくいとの指摘のため)。
    // どのツールが選ばれてもここを通るので、計測系以外に切り替えた時は正しく外れる
    var _measureBtn207=document.getElementById('measureToggleBtn');
    if(_measureBtn207) _measureBtn207.classList.toggle('tool-active',!!_MEASURE_TOOL_LABELS[currentTool]);
    _syncMeasureToggleBtnIcon(); // V1_219: 計測ボタンのアイコンを選択中ツールの形状に同期
    // V2_96: 図形ツールが新たに選択されたら、図形ボタンの下段ラベルを更新し、
    // 図形ツール選択ポップアップ(#shapeToolPopup)を閉じる(V1_205の計測ツールと同じ処理)
    if(_SHAPE_TOOL_LABELS[currentTool]){
      // V2_100: 図形の種類を選んでも#shapeToolPopupは自動的に閉じないようにした
      // (色/太さも続けて選びたい、という要望への対応)。ポップアップ右上の
      // 「決定」ボタンを押した時だけ閉じる…はずだったが、これが図形ツール使用不可の
      // 原因になっていた。#shapeToolPopupは520x313px程度あり、開いたままだと図形の
      // 種類を選んだ直後にキャンバス上をドラッグしようとしてもポップアップがその領域を
      // 覆っていてポインタ/タッチイベントがキャンバスまで届かず、図形が全く描けなく
      // なっていた(V2_101で消しゴムに対して行ったのと同じ理由の不具合)。
      // V2_102: 図形の「種類」を選んだ直後は必ずキャンバス操作(ドラッグ)に移るため、
      // 消しゴムの大きさ選択(V2_101)と同じ考え方で、種類選択時だけは自動的に
      // ポップアップを閉じるようにする。色/太さボタン(.color-btn/.lw-btn)側の
      // 「決定ボタンを押すまで閉じない」動作(V2_100)はそのまま維持し、ここでは
      // 触れない
      if(typeof _closeShapeToolPopup==='function') _closeShapeToolPopup();
      // 次に他ツールから図形ボタンを押した時にこのツールを直接復元できるよう記憶
      _lastShapeTool=currentTool;
    }
    // 図形ボタン(#shapeToggleBtn)の枠は、図形ツールがcurrentToolの時だけ色付きにする
    // (#measureToggleBtnと同じ考え方)
    var _shapeBtn96=document.getElementById('shapeToggleBtn');
    if(_shapeBtn96) _shapeBtn96.classList.toggle('tool-active',!!_SHAPE_TOOL_LABELS[currentTool]);
    if(typeof _syncShapeToggleBtnIcon==='function') _syncShapeToggleBtnIcon(); // 図形ボタンのアイコン・ラベルを選択中の図形に同期
    if(window.IPX&&window.IPX.active&&typeof ipxCancel==='function')ipxCancel(); // V1_48: ツール切替時は交点ピックを中止
    // V2_90: 他ツールへ切り替えたら、なげわ(lasso)の選択状態(バウンディングボックス・
    // アクションバー含む)は必ずクリアする
    if(currentTool!=='lasso'&&typeof _lassoClearSelection==='function') _lassoClearSelection();
    // V2_95: 他ツールへ切り替えたら、図形ツール(四角・矢印・丸・楕円)のドラッグ中
    // プレビュー状態も必ずクリアする(なげわの選択状態クリアと同じ考え方)
    if(typeof shapeToolState!=='undefined'){shapeToolState.drawing=false;shapeToolState.tool=null;shapeToolState.start=null;shapeToolState.cur=null;}
    dimState={pts:[]};dimPendingDown=false;sketching=false;sketchPts=[];snapPt=null;scheduleOverlay();
    if(typeof updateToolColorDots==='function')updateToolColorDots();
    // V2_84: 文字ツール選択時点でフォントの読込を先行開始しておく(実際に
    // タップして入力ボックスを開く前に読込を終えておくことで、初回表示時から
    // 新フォントで見えるようにする)
    if(currentTool==='text'&&typeof _ensureCanvasJPFont84==='function') _ensureCanvasJPFont84();

    // ガイドメッセージ
    const guideMap={
      'sketch':'Apple Pencilまたはマウスでスケッチ',
      'hl':'蛍光ペン：Apple Pencilまたはマウスでハイライト',
      'eraser':'消去したい線をなぞってください',
      'text':'図面をタップして文字を入力', // V2_80
      'lasso':'囲みたい範囲を線で囲んでください', // V2_90
      'rect':'ドラッグして四角を描いてください', // V2_95
      'arrow':'ドラッグして矢印を描いてください(始点→終点)', // V2_95
      'circle':'ドラッグして丸を描いてください(始点が中心)', // V2_95
      'ellipse':'ドラッグして楕円を描いてください', // V2_95
      'dxdy':'1点目を選択してください',
      'diag':'1点目を選択してください',
      'circDim':'円の円周にペンを近づける→離して確定→位置を指定',
      'radDim':'円または円弧を選択→離して確定→半径線の位置を指定'
    };
    if(currentTool==='sketch'||currentTool==='hl'||currentTool==='eraser'||currentTool==='text'||currentTool==='lasso'||_isShapeTool(currentTool)){
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
// V2_97: 図形ツールポップアップ(#shapeToolPopup)内にもペンと同じ.color-btn/.lw-btnを
// 追加した(色・太さのUIそのものは複製せず、同じclass名・同じdata-color/data-lw属性の
// ボタンをもう1箇所に増やしただけ)。
// V2_102: 「ペン・文字・図形の色が連動して同じ色になる」との指摘への対応で、色の状態を
// currentColor(ペン)/currentTextColor(文字)/currentShapeColor(図形)の3つに分離した。
// ただし.color-btnのDOM自体は従来通り2箇所(#colorOverlay内=ペン/文字が共用、
// #shapeToolPopup内=図形専用)のままで増やしていない。文字ツールは専用ポップアップを
// 持たずペンの#colorOverlayをそのまま流用する(V2_84の設計を踏襲)ため、クリックされた
// クリックされたボタンが#shapeToolPopup内にあるかどうかで振り分ける(そこは図形専用の
// UIなので、まだ図形の種類を選ぶ前(currentToolがまだ'sketch'等のまま)に先に色だけ
// 選ぶ操作をしても、確実にcurrentShapeColorへ反映されるようにするため。currentToolを
// 見て判定する方式だと、種類選択より先に色を選んだ場合に誤ってペンの色を書き換えて
// しまう不具合があったため、DOM上の所属で判定する方式にした)。
// 一方、文字ツールは専用ポップアップを持たず#colorOverlayをペンと共用しているため、
// こちらは従来通りクリック時点のcurrentToolで振り分ける
document.querySelectorAll('.color-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const[r,g,b]=btn.dataset.color.split(',').map(Number);
    if(btn.closest('#shapeToolPopup')){ currentShapeColor={r,g,b}; }
    else if(currentTool==='text'){ currentTextColor={r,g,b}; }
    else { currentColor={r,g,b}; }
    if(typeof _syncColorBtnActive==='function') _syncColorBtnActive();
    // V2_100: 「選択操作をしてもポップアップは自動的に閉じない」ように変更。
    // ポップアップ右上の「決定」ボタン(colorOverlayDoneBtn)を押した時だけ閉じる
    if(typeof updateToolColorDots==='function')updateToolColorDots();
    scheduleSave(); // V0_135: スケッチ/文字/図形の色変更を保存
  });
});
// V2_102: .color-btnのactive表示を、そのボタンがどちらの場所(#shapeToolPopup=図形専用/
// それ以外=#colorOverlay、ペン・文字共用)にあるかで、比較対象の色状態を切り替えて
// 同期する。#colorOverlay側はcurrentTool==='text'ならcurrentTextColor、それ以外
// (ペン等)ならcurrentColorと比較する。ポップアップを開いた直後(openContextPopup/
// #shapeToggleBtnクリック)・色ボタンクリック直後・保存データ復元直後に呼ぶことで、
// 常に「今のツールの色」が正しくハイライトされるようにする
function _syncColorBtnActive(){
  document.querySelectorAll('.color-btn').forEach(function(b){
    var parts=b.dataset.color.split(',').map(Number);
    var inShapePopup=!!(b.closest&&b.closest('#shapeToolPopup'));
    var target=inShapePopup?currentShapeColor:(currentTool==='text'?currentTextColor:currentColor);
    if(!target) return;
    b.classList.toggle('active', parts[0]===target.r&&parts[1]===target.g&&parts[2]===target.b);
  });
}

// =========================================================
// 線幅選択ボタン
// =========================================================
// V2_103: 「ペン・文字・図形の太さが連動して同じ値になる」との指摘への対応。
// .color-btnで既に採用しているV2_102の振り分け方式(クリックされたボタンが
// #shapeToolPopup内にあるかどうかで図形/それ以外を判定し、それ以外は
// クリック時点のcurrentToolがtextかどうかで文字/ペンを判定する)を、太さにも
// そのまま適用する。理由も.color-btnハンドラのコメントと同じ:
// 文字ツールは専用ポップアップを持たず#colorOverlayをペンと共用しているため
// currentToolで判定し、図形専用ポップアップ(#shapeToolPopup)はDOM上の所属で
// 判定する(図形の種類を選ぶ前に先に太さだけ選んでもcurrentShapeLWへ確実に
// 反映されるようにするため)
document.querySelectorAll('.lw-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const lwVal103=parseFloat(btn.dataset.lw);
    if(btn.closest('#shapeToolPopup')){ currentShapeLW=lwVal103; }
    else if(currentTool==='text'){ currentTextLW=lwVal103; }
    else { currentLW=lwVal103; }
    // V2_97/V2_103: dataset値一致ではなく、ボタンの所属先に応じた状態値との
    // 一致で同期する(_syncLwBtnActiveに集約。_syncColorBtnActiveと同じ考え方)
    if(typeof _syncLwBtnActive==='function') _syncLwBtnActive();
    // V2_100: 「選択操作をしてもポップアップは自動的に閉じない」ように変更(決定ボタンで閉じる)
    // ④ ボタン内の現在値表示を更新(ペンの#lwLabelはcurrentLW、文字の#textSizeLabelは
    // V2_103からcurrentTextLWを表示する。V2_116: 図形専用の3段目ラベル
    // (#shapeCurrentLabel)もcurrentShapeLWを表示するようになったため、図形ポップアップ内の
    // 太さボタンをクリックした時もここで即座に更新する(_syncShapeToggleBtnIconを呼べば
    // アイコンも含めて同期できるが、ここでは太さボタン用途なのでラベルだけ直接更新する)
    const lwl=document.getElementById('lwLabel');if(lwl)lwl.textContent=currentLW;
    const tsl86=document.getElementById('textSizeLabel');if(tsl86)tsl86.textContent=currentTextLW;
    if(btn.closest('#shapeToolPopup')){ const slbl116=document.getElementById('shapeCurrentLabel'); if(slbl116) slbl116.textContent=currentShapeLW; }
    scheduleSave(); // V0_135: 線幅/文字サイズ変更を保存
  });
});
// V2_103: .lw-btnのactive表示を、そのボタンがどちらの場所(#shapeToolPopup=図形専用/
// それ以外=#colorOverlay、ペン・文字共用)にあるかで、比較対象の太さ状態を切り替えて
// 同期する(_syncColorBtnActiveの太さ版)。#colorOverlay側はcurrentTool==='text'なら
// currentTextLW、それ以外(ペン等)ならcurrentLWと比較する。ポップアップを開いた直後
// (openContextPopup/#shapeToggleBtnクリック)・太さボタンクリック直後・保存データ
// 復元直後に呼ぶことで、常に「今のツールの太さ」が正しくハイライトされるようにする
function _syncLwBtnActive(){
  document.querySelectorAll('.lw-btn').forEach(function(b){
    var val=parseFloat(b.dataset.lw);
    var inShapePopup=!!(b.closest&&b.closest('#shapeToolPopup'));
    var target=inShapePopup?currentShapeLW:(currentTool==='text'?currentTextLW:currentLW);
    b.classList.toggle('active', val===target);
  });
}

// =========================================================
// 蛍光ペン色選択ボタン（V0_70）
// =========================================================
document.querySelectorAll('.hl-color-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.hl-color-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const[r,g,b]=btn.dataset.color.split(',').map(Number);
    currentHL_Color={r,g,b};
    // V2_100: 選択操作でポップアップを自動的に閉じない(決定ボタンで閉じる)
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
    // V2_100: 選択操作でポップアップを自動的に閉じない(決定ボタンで閉じる)
    // V1_207: 蛍光ペンボタンの3段目(id="hlLwLabel")に現在の線幅を表示する
    const hlwl=document.getElementById('hlLwLabel');if(hlwl)hlwl.textContent=currentHL_LW;
    scheduleSave(); // V0_135: 蛍光ペン線幅変更を保存
  });
});

// =========================================================
// V2_98: 蛍光ペン濃度(透明度)選択ボタン
// =========================================================
document.querySelectorAll('.hl-alpha-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.hl-alpha-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentHLAlpha=parseFloat(btn.dataset.alpha)/100;
    // V2_117: 蛍光ペンボタン最下段右側(id="hlAlphaLabel")に現在の濃度(%)を表示する
    const hal=document.getElementById('hlAlphaLabel');if(hal)hal.textContent=Math.round(currentHLAlpha*100)+'%';
    // V2_100: 選択操作でポップアップを自動的に閉じない(決定ボタンで閉じる)
    scheduleSave(); // 蛍光ペン濃度変更を保存
  });
});

// =========================================================
// V1_207: 消しゴム範囲選択ボタン
// =========================================================
document.querySelectorAll('.er-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.er-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ERASER_RADIUS_PX=parseFloat(btn.dataset.er);
    const erl=document.getElementById('eraserSizeLabel');if(erl)erl.textContent=ERASER_RADIUS_PX;
    if(typeof scheduleOverlay==='function')scheduleOverlay(); // 消しゴム範囲の可視化円を即反映
    scheduleSave(); // 消しゴム範囲を保存
    // V2_101: 消しゴムは大きさしか選べないため、他ツール(ペン/文字/蛍光ペン/図形/計測)の
    // 「決定ボタンを押すまで閉じない」方式(V2_100)とは別扱いに戻し、大きさを選んだ
    // 瞬間にポップアップを自動的に閉じる(V2_99以前と同じ挙動)。他モードのハンドラには触れない
    var coEr=document.getElementById('colorOverlay');
    if(coEr&&coEr.dataset.mode==='eraser') coEr.classList.remove('open');
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
    // V2_100: 「計測で2点選んで色も変えたい時にポップアップが消えるのがストレス」との
    // 指摘への対応。計測線の色を選んでも#measureToolPopupは自動的に閉じないようにし、
    // ポップアップ右上の「決定」ボタン(measureToolPopupDoneBtn)を押した時だけ閉じる
    if(typeof updateToolColorDots==='function')updateToolColorDots();
    scheduleSave(); // V0_135: 寸法色変更を保存
  });
});

// =========================================================
// V2_80: 文字入力ツール（タップした位置にキーボードで文字を配置）
// =========================================================
// 依存: strokes, currentTextColor, currentTextLW, snapshot, scheduleOverlay, doSave,
//       _curPage, verify, ov (いずれも既存グローバル。V2_103でcurrentColor/currentLWから
//       currentTextColor/currentTextLWへ変更)
var _textInputActive=false;
// V2_84: 「文字入力のフォントをもっといいフォントにしたい」との要望に対応。
// DXF文字・PDF書出で使っている埋込フォント(Noto Sans JP、export.jsの
// _loadJPFontでbase64取得)を、画面のcanvas描画・入力ボックスの両方でも
// 使えるようFontFaceとして登録する。一度登録すれば以降はブラウザの
// フォントキャッシュ経由で即座に使われる(document.fonts.addはCSSの
// font-family一致要素にも自動反映されるため、入力ボックス側は再描画不要)。
// キャンバス側は読込完了時にscheduleOverlay()で1回再描画し、読込前後の
// 見た目の差を早く解消する
var _canvasJPFontReady84=false;
function _ensureCanvasJPFont84(){
  if(_canvasJPFontReady84) return;
  _canvasJPFontReady84=true; // 二重読込防止（失敗時も再試行はしない）
  (async function(){
    try{
      if(typeof _loadJPFont==='function') await _loadJPFont();
      if(!window._notoSansJPBase64) return;
      var ff=new FontFace('NotoSansJPCanvas','url(data:font/ttf;base64,'+window._notoSansJPBase64+')');
      await ff.load();
      document.fonts.add(ff);
      if(typeof scheduleOverlay==='function') scheduleOverlay();
    }catch(e){ console.warn('[文字入力] フォント読込失敗',e); }
  })();
}
// V2_85: 「タップして出来る入力枠の大きさが、選んでいる文字の大きさを反映して
// いない」との指摘に対応。従来はcurrentLW*20+8という入力欄専用の簡易式で、
// 実際に図面へ描画される文字サイズ(index.htmlの_tFontPx80、現在のズーム
// (scale/lwRef)にも比例する)と対応しておらず、ズーム状態によっては見た目の
// 大きさが一致しなかった。同じ式(dprを除いたCSS px相当。_tFontPx80は
// canvas実ピクセル(devicePixelRatio倍)基準のため、CSS pxの入力欄に合わせて
// dpr分を割った値になる)に統一し、確定後に実際に描かれる大きさとほぼ一致する
// ようにした
// V2_103: 「文字とペンの大きさがリンクしている」との指摘への対応で、文字は
// 専用のcurrentTextLWを基準にする(ペンのcurrentLWとは独立)
function _textInputFontPx85(){
  var _lwRef85=(typeof fitScale!=='undefined'&&fitScale>0)?fitScale:scale;
  return Math.max(10,Math.min(160,Math.round((currentTextLW||0.6)*20*(scale/_lwRef85))));
}
// V2_88: 「文字入力枠を出して画面を拡縮すると文字枠は拡縮についていかないから、
// 入力しにくい」との指摘に対応。開いた時点の画面座標(sx,sy)に固定したままだと、
// その後パン・ズームしても図面側の位置とずれてしまう。入力中に配置先のワールド
// 座標(_textInputWX88/WY88)を保持しておき、毎フレーム(viewer.jsのrafLoopから
// 呼ばれる_syncTextInputBoxPosition88)w2s()で現在の画面座標へ変換し直すことで、
// パン・ズーム中も常に配置先の真上に追従させる。文字サイズも同時にズームへ
// 追従させる
var _textInputWX88=0, _textInputWY88=0;
var _textInputSubWin92=null; // V3_02: サブ窓内で開いた入力欄かどうか(そのsubWindowsの要素への参照。メイン画面ならnull)
function _syncTextInputBoxPosition88(){
  if(!_textInputActive) return;
  var box=document.getElementById('textInputBox');
  var inp=document.getElementById('textInputField');
  if(!box||!inp) return;
  var r,p;
  // V3_02: サブ窓内で開いた入力欄は、そのサブ窓自身の座標系(tx/ty/scale・canvas位置)で
  // 追従させる。サブ窓が既に閉じられていた場合はメイン画面基準にフォールバックする
  if(_textInputSubWin92&&typeof window._swScreenPos==='function'
      &&typeof window._swFindOwnerOfOv==='function'&&window._swFindOwnerOfOv(_textInputSubWin92.ovEl)){
    r=_textInputSubWin92.ovEl.getBoundingClientRect();
    p=window._swScreenPos(_textInputSubWin92,_textInputWX88,_textInputWY88);
  } else {
    if(typeof w2s!=='function'||typeof ov==='undefined') return;
    r=ov.getBoundingClientRect();
    p=w2s(_textInputWX88,_textInputWY88);
  }
  box.style.left=(r.left+p[0])+'px';
  box.style.top=(r.top+p[1])+'px';
  var fontPx=_textInputFontPx85();
  if(inp.style.fontSize!==fontPx+'px'){
    inp.style.fontSize=fontPx+'px';
    inp.style.lineHeight=(fontPx*1.2)+'px';
    inp.style.height='auto';
    inp.style.height=inp.scrollHeight+'px';
  }
}
function _openTextInputAt(wx,wy,sx,sy){
  if(_textInputActive) return; // 二重に開かない
  var box=document.getElementById('textInputBox');
  var inp=document.getElementById('textInputField');
  if(!box||!inp) return;
  _ensureCanvasJPFont84();
  _textInputActive=true;
  _textInputWX88=wx; _textInputWY88=wy; // V2_88
  _textInputSubWin92=(typeof window._swFindOwnerOfOv==='function')?window._swFindOwnerOfOv(ov):null; // V3_02
  var r=ov.getBoundingClientRect();
  var fontPx=_textInputFontPx85();
  inp.value='';
  inp.style.fontSize=fontPx+'px';
  inp.style.lineHeight=(fontPx*1.2)+'px'; // V2_87: 画面描画の行間(1.2倍)と揃える
  inp.style.height=(fontPx*1.2)+'px';
  // V2_102: 文字入力は専用のcurrentTextColorを使う(ペンのcurrentColorとは独立)
  inp.style.color='rgb('+currentTextColor.r+','+currentTextColor.g+','+currentTextColor.b+')';
  box.style.left=(r.left+sx)+'px';
  box.style.top=(r.top+sy)+'px';
  box.style.display='block';

  // V2_87: 複数行入力に対応してtextareaになったため、行数が増えるたびに
  // 高さをscrollHeightへ合わせて自動的に広げる(幅は元々折り返さない設定
  // (white-space:pre)のまま)
  function autoResize(){
    inp.style.height='auto';
    inp.style.height=inp.scrollHeight+'px';
  }

  function commit(){
    var t=inp.value;
    _closeTextInput();
    if(t&&t.trim()){
      snapshot();
      // V2_102: 文字は専用のcurrentTextColorを保存する(ペンのcurrentColorとは独立)
      // V2_103: 太さ(フォントサイズ)も専用のcurrentTextLWを保存する(ペンのcurrentLWとは独立)
      strokes.push({isText:true,text:t,x:wx,y:wy,color:{...currentTextColor},lw:currentTextLW,page:_curPage()});
      if(typeof openFiles!=='undefined'&&currentFileIdx>=0&&openFiles[currentFileIdx]){
        openFiles[currentFileIdx].strokes=strokes;
      }
      if(typeof verify==='function')verify('文字追加',{len:strokes.length});
      scheduleOverlay();doSave(); // V0_103と同様、即時保存
    }
  }
  function onKey(e){
    // V2_87: 「alt+Enterで次の行に入力出来る様にして」との要望に対応。
    // ブラウザ・OSによってはAlt+Enterの既定動作が改行挿入以外(ウィンドウ操作等)に
    // 割り当てられていることがあり、既定動作に任せるだけでは確実に改行できない
    // ため、カーソル位置に'\n'を直接挿入する(素のEnterのみ確定として扱う)
    if(e.key==='Enter'&&e.altKey){
      e.preventDefault();
      var _s87=inp.selectionStart, _e87=inp.selectionEnd;
      inp.value=inp.value.slice(0,_s87)+'\n'+inp.value.slice(_e87);
      inp.selectionStart=inp.selectionEnd=_s87+1;
      autoResize();
      return;
    }
    if(e.key==='Enter'){e.preventDefault();commit();}
    else if(e.key==='Escape'){e.preventDefault();_closeTextInput();}
  }
  function onInput(){ autoResize(); }
  function onBlur(){ commit(); }
  function _attachFocusAndListeners(){
    if(!_textInputActive) return; // 遅延の間にEscape等で既に閉じられていた場合は何もしない
    inp.focus();
    inp.addEventListener('keydown',onKey);
    inp.addEventListener('input',onInput);
    inp.addEventListener('blur',onBlur);
    box._cleanup80=function(){
      inp.removeEventListener('keydown',onKey);
      inp.removeEventListener('input',onInput);
      inp.removeEventListener('blur',onBlur);
    };
  }
  // V2_92: このオープンがタッチ操作(指/Apple Pencilタップ)由来かどうかを読み取り、
  // フラグは直後にリセットする(消費型。次回のオープンに持ち越さないため)
  var _isTouchTap92=_textInputTouchOrigin;
  _textInputTouchOrigin=false;
  if(_isTouchTap92){
    // V2_92: iOS/iPadOSでは「.focus()呼び出しがタップのユーザージェスチャー呼び出し
    // スタック内で同期的に行われないとソフトウェアキーボードが表示されない」という
    // 制約があるため、タッチ操作由来の場合はsetTimeoutを使わずこの場で即座にfocus()する。
    // V2_80のsetTimeout遅延が必要だった理由(下記)である「mousedownの既定のフォーカス
    // 解決による意図しないフォーカス喪失」は、touchstart側で常にe.preventDefault()して
    // おり合成マウスイベント(mousedown/mouseup/click)自体が発生しないため、この
    // タッチ経由の呼び出しでは再発しない
    _attachFocusAndListeners();
  } else {
    // V2_80: タップ(mousedown)の中で即座にinput.focus()すると、そのクリック確定処理
    // (mouseup/click)に伴うブラウザの既定のフォーカス解決によって、直後に強制的に
    // フォーカスが外れてしまう(結果、onBlur→commit()が即発火して1文字も打つ前に
    // 入力ボックスが閉じてしまう)ことがある。フォーカス移動とblurリスナーの登録を
    // 次のイベントループへ1回遅らせることで、このタップ確定に伴う「紛れのblur」が
    // 収まった後にリスナーを付けられるようにし、意図しない即時クローズを防ぐ
    // (マウス操作の場合のみこの経路を通る。V2_92でタッチ操作は上のsync経路に分離した)
    setTimeout(_attachFocusAndListeners,0);
  }
}
function _closeTextInput(){
  var box=document.getElementById('textInputBox');
  if(box){ if(box._cleanup80){box._cleanup80();box._cleanup80=null;} box.style.display='none'; }
  _textInputActive=false;
  _textInputSubWin92=null; // V3_02
}
// V3_02: サブ窓の閉じるボタンから呼ばれる安全策。閉じられようとしているサブ窓sw内で
// 文字入力欄が開いたままだった場合、取り残されないよう強制的に閉じる
window._closeTextInputIfOwnedBySw92=function(sw){
  if(_textInputActive&&_textInputSubWin92===sw) _closeTextInput();
};

// =========================================================
// V2_90: なげわ(lasso)ツール
// =========================================================
// 依存: strokes, currentTool, snapshot, scheduleOverlay, doSave, _curPage, verify,
//       openFiles, currentFileIdx, w2s, ov, scale (いずれも既存グローバル)
// 設計メモ:
//   ・resize/rotateは今回のスコープ外。move(平行移動)とdelete(削除)のみ対応。
//   ・currentTool==='select'(画像選択ツール)とは分岐条件・状態(lassoState)ともに
//     完全に独立しており、衝突しない(事前にcurrentTool==='select'の全箇所を確認済み:
//     tool.js内、画像(images配列)専用の分岐のみで、strokes配列は一切触っていない)。
//   ・strokes配列の要素は s.isText===true(文字, 座標はs.x/s.y) と s.pts配列を持つ
//     もの(ペン/蛍光ペン, 座標は各pts[i].x/y)の2種類があり、必ず両方を考慮する。

// 点がポリゴン内にあるか(レイキャスティング法)
function _pointInPolygon(x,y,poly){
  var inside=false;
  for(var i=0,j=poly.length-1;i<poly.length;j=i++){
    var xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    var intersect=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
// 点がバウンディングボックス内にあるか(ワールド座標)
function _pointInBBox(x,y,b){
  return !!b && x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY;
}

// ポインタダウン: バウンディングボックス内→移動開始、それ以外→新規の囲み描画開始
function _lassoPointerDown(wx,wy){
  if(lassoState.selected&&lassoState.selected.length>0&&lassoState.bbox&&_pointInBBox(wx,wy,lassoState.bbox)){
    snapshot(); // V2_90: 移動前にundoチェックポイント
    lassoState.dragging=true;
    lassoState.dragStart={wx:wx,wy:wy};
    lassoState.dragOrig=lassoState.selected.map(function(s){
      return s.isText?{s:s,x:s.x,y:s.y}:{s:s,pts:(s.pts||[]).map(function(p){return{x:p.x,y:p.y};})};
    });
    return;
  }
  // バウンディングボックス外のタップ: 既存の選択を解除して新規の囲み線を開始
  _lassoClearSelection();
  lassoState.drawing=true;
  lassoState.pts=[{x:wx,y:wy}];
  scheduleOverlay();
}
// ポインタムーブ: 描画中は囲み線を延長、移動中は選択ストロークを平行移動
function _lassoPointerMove(wx,wy){
  if(lassoState.dragging&&lassoState.dragOrig){
    var dx=wx-lassoState.dragStart.wx, dy=wy-lassoState.dragStart.wy;
    for(var i=0;i<lassoState.dragOrig.length;i++){
      var o=lassoState.dragOrig[i];
      if(o.s.isText){ o.s.x=o.x+dx; o.s.y=o.y+dy; }
      else if(o.s.pts&&o.pts){
        // V2_90: 重要 — 既存のpoint要素(o.s.pts[j])のx/yを直接書き換えてはいけない。
        // snapshot()が作るundo履歴(_cloneStroke80)はpts配列自体は複製するが、配列の
        // 各要素(点オブジェクト)は複製せず参照を共有しているため、直接書き換えると
        // undo履歴側の座標まで一緒に変わってしまいundoが効かなくなる。必ず新しい
        // オブジェクトで置き換える(配列要素の差し替え)ことで、履歴側の古いオブジェクト
        // は変更されないようにする
        var newPts=new Array(o.pts.length);
        for(var j=0;j<o.pts.length;j++){
          newPts[j]={x:o.pts[j].x+dx,y:o.pts[j].y+dy};
        }
        o.s.pts=newPts;
      }
    }
    _lassoRecomputeBBox();
    scheduleOverlay();
    return;
  }
  if(lassoState.drawing){
    lassoState.pts.push({x:wx,y:wy});
    scheduleOverlay();
  }
}
// ポインタアップ: 描画中なら選択確定、移動中なら保存して終了
function _lassoPointerUp(){
  if(lassoState.dragging){
    lassoState.dragging=false;lassoState.dragStart=null;lassoState.dragOrig=null;
    if(typeof openFiles!=='undefined'&&currentFileIdx>=0&&openFiles[currentFileIdx]){
      openFiles[currentFileIdx].strokes=strokes; // 参照は変わらないが既存パターンに合わせて明示同期
    }
    if(typeof verify==='function')verify('なげわ移動',{len:lassoState.selected.length});
    scheduleOverlay();doSave();
    return;
  }
  if(lassoState.drawing){
    lassoState.drawing=false;
    _lassoFinishSelection();
  }
}
// 描画完了した囲み線から、現在ページのstrokesのうち内部に頂点を持つものを選択する
function _lassoFinishSelection(){
  var poly=lassoState.pts;
  lassoState.pts=[];
  if(!poly||poly.length<3){ lassoState.selected=[];lassoState.bbox=null;_lassoHideActionBar();scheduleOverlay();return; }
  var cur=(typeof _curPage==='function')?_curPage():1;
  var sel=[];
  for(var i=0;i<strokes.length;i++){
    var s=strokes[i];
    if((s.page||1)!==cur) continue;
    if(s.isText){
      if(s.x!=null&&s.y!=null&&_pointInPolygon(s.x,s.y,poly)) sel.push(s);
    } else if(s.pts){
      for(var j=0;j<s.pts.length;j++){
        if(_pointInPolygon(s.pts[j].x,s.pts[j].y,poly)){ sel.push(s); break; }
      }
    }
  }
  lassoState.selected=sel;
  if(sel.length>0){
    _lassoRecomputeBBox();
    _lassoShowActionBar();
    if(typeof verify==='function')verify('なげわ選択',{len:sel.length});
  } else {
    lassoState.bbox=null;
    _lassoHideActionBar();
  }
  scheduleOverlay();
}
// 選択中ストロークのワールド座標バウンディングボックスを再計算する
function _lassoRecomputeBBox(){
  var sel=lassoState.selected;
  if(!sel||sel.length===0){ lassoState.bbox=null; return; }
  var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(var i=0;i<sel.length;i++){
    var s=sel[i];
    if(s.isText){
      if(s.x<minX)minX=s.x; if(s.x>maxX)maxX=s.x;
      if(s.y<minY)minY=s.y; if(s.y>maxY)maxY=s.y;
    } else if(s.pts){
      for(var j=0;j<s.pts.length;j++){
        var p=s.pts[j];
        if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
        if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;
      }
    }
  }
  if(minX===Infinity){ lassoState.bbox=null; return; }
  // 文字(1点)や細い線でも操作しやすいよう最低限の余白を付ける(ワールド座標系)
  var wpad=Math.max((maxX-minX)*0.04,10/((typeof scale!=='undefined'&&scale)||1));
  var hpad=Math.max((maxY-minY)*0.04,10/((typeof scale!=='undefined'&&scale)||1));
  lassoState.bbox={minX:minX-wpad,minY:minY-hpad,maxX:maxX+wpad,maxY:maxY+hpad};
}
// 選択・描画途中の状態を全てクリアし、アクションバーも隠す
function _lassoClearSelection(){
  lassoState.selected=[];
  lassoState.bbox=null;
  lassoState.drawing=false;
  lassoState.pts=[];
  lassoState.dragging=false;
  lassoState.dragStart=null;
  lassoState.dragOrig=null;
  _lassoHideActionBar();
  if(typeof scheduleOverlay==='function') scheduleOverlay();
}
// 選択中の全ストロークをstrokes配列から削除する(インデックスの大きい順にsplice)
function _lassoDeleteSelected(){
  if(!lassoState.selected||lassoState.selected.length===0) return;
  snapshot(); // V2_90: 削除前にundoチェックポイント
  var idxs=[];
  for(var i=0;i<strokes.length;i++){
    if(lassoState.selected.indexOf(strokes[i])>=0) idxs.push(i);
  }
  idxs.sort(function(a,b){return b-a;}); // インデックスの大きい順
  for(var k=0;k<idxs.length;k++){ strokes.splice(idxs[k],1); }
  if(typeof openFiles!=='undefined'&&currentFileIdx>=0&&openFiles[currentFileIdx]){
    openFiles[currentFileIdx].strokes=strokes;
  }
  if(typeof verify==='function')verify('なげわ削除',{len:strokes.length});
  _lassoClearSelection();
  scheduleOverlay();doSave();
}
// アクションバー(削除ボタン)の表示/非表示/位置同期
var _lassoActionBarSubWin90=null; // V3_02: なげわの選択操作がどのサブ窓内で行われたか
function _lassoShowActionBar(){
  var bar=document.getElementById('lassoActionBar');
  if(!bar) return;
  _lassoActionBarSubWin90=(typeof window._swFindOwnerOfOv==='function')?window._swFindOwnerOfOv(ov):null; // V3_02
  bar.style.display='flex';
  _syncLassoActionBar90();
}
function _lassoHideActionBar(){
  var bar=document.getElementById('lassoActionBar');
  if(bar) bar.style.display='none';
  _lassoActionBarSubWin90=null; // V3_02
}
// V3_02: サブ窓の閉じるボタンから呼ばれる安全策。閉じられようとしているサブ窓sw内で
// なげわアクションバーが表示されたままだった場合、取り残されないよう強制的に隠す
window._lassoHideActionBarIfOwnedBySw90=function(sw){
  if(_lassoActionBarSubWin90===sw) _lassoHideActionBar();
};
// V2_90: viewer.jsのrafLoopから毎フレーム呼ばれ、パン/ズーム後もバウンディング
// ボックスの真上にアクションバーを追従させる(_syncTextInputBoxPosition88と同じ考え方)
function _syncLassoActionBar90(){
  var bar=document.getElementById('lassoActionBar');
  if(!bar) return;
  if(bar.style.display==='none'||bar.style.display==='') return;
  if(!lassoState.selected||lassoState.selected.length===0||!lassoState.bbox){ bar.style.display='none';return; }
  var r,topLeft,topRight;
  var b=lassoState.bbox;
  // V3_02: サブ窓内で選択された場合は、そのサブ窓自身の座標系で追従させる。
  // サブ窓が既に閉じられていた場合はメイン画面基準にフォールバックする
  if(_lassoActionBarSubWin90&&typeof window._swScreenPos==='function'
      &&typeof window._swFindOwnerOfOv==='function'&&window._swFindOwnerOfOv(_lassoActionBarSubWin90.ovEl)){
    r=_lassoActionBarSubWin90.ovEl.getBoundingClientRect();
    topLeft=window._swScreenPos(_lassoActionBarSubWin90,b.minX,b.maxY);
    topRight=window._swScreenPos(_lassoActionBarSubWin90,b.maxX,b.maxY);
  } else {
    if(typeof w2s!=='function'||typeof ov==='undefined') return;
    r=ov.getBoundingClientRect();
    topLeft=w2s(b.minX,b.maxY); // ワールドYは上向きのため画面上端はmaxY
    topRight=w2s(b.maxX,b.maxY);
  }
  var cx=(topLeft[0]+topRight[0])/2;
  var topY=Math.min(topLeft[1],topRight[1]);
  bar.style.left=(r.left+cx)+'px';
  bar.style.top=(r.top+topY-10)+'px';
}
// 削除ボタンのクリックリスナー(DOM要素はindex.htmlに存在、tool.jsは常にそれより
// 後に読み込まれるため、ここで直接addEventListenerして問題ない)
(function(){
  var _lassoDelBtn90=document.getElementById('lassoDeleteBtn');
  if(_lassoDelBtn90){
    _lassoDelBtn90.addEventListener('click',function(e){
      if(e&&e.stopPropagation)e.stopPropagation();
      _lassoDeleteSelected();
    });
  }
})();
