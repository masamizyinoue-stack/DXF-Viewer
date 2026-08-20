// V1_195: SHXストローク文字認識モジュール(新規独立ファイル)
// ------------------------------------------------------------
// 目的: DXF図面上で「TEXT/MTEXT/ATTRIBとして文字が存在しない、線分・円弧だけで
// 描かれた文字(分解済みテキスト・古い単線フォント図面など)」を、タップ位置周辺の
// 線分・円弧の形状から文字として推定する。
//
// 方式: 画像OCRではなく、ベクター線分同士の形状照合(AutoCADのSHX Text Recognition
// と同じ考え方=近接線分をクラスタ化→登録フォントと形状比較→一致率で判定)。
// 参照グリフはHershey Fonts(futural/Roman Simplex相当、パブリックドメイン)から
// オフラインで生成した単線ストローク座標(shxGlyphs.js)を使用する。
//
// 既存機能への影響: このファイルは既存のdoc/doc.moji/doc.sen/doc.enko等を
// 「読むだけ」で、一切変更しない。呼び出し側(index.htmlの_tapPickText)から
// window.recognizeStrokeTextAt(wx,wy) を呼ぶ以外の経路は無く、既存の
// TEXT/MTEXT読み込み・PDF文字読み込みには一切干渉しない。
(function(){
  'use strict';

  // ==========================================================
  // 1. ラスタ化(形状比較のための小さな2値ビットマップ生成)
  //    ※ Canvas APIには依存せず、純粋なJSでスタンプ式に線を描画する。
  //      (ブラウザ/Node.js双方で完全に同一の結果になるようにするため)
  // ==========================================================
  var RW = 28, RH = 40;           // ラスタ解像度(幅・高さ px)
  var YMIN = -0.55, YMAX = 1.35;  // 正規化y範囲(ディセンダ/オーバーシュート込み)
  var XMAX = 1.05;                // 正規化x範囲(最大文字幅よりやや広め)
  var STAMP_R = 1.0;               // 線の太さ相当(px半径)

  function _toPx(x, y){
    return [ (x / XMAX) * RW, ((YMAX - y) / (YMAX - YMIN)) * RH ];
  }

  // 参照グリフ・候補文字のどちらも「自身のbbox左端をx=0」に揃えてから比較する。
  // (参照グリフはフォント設計上の字送り基準点を持つが候補側はそれを知らないため、
  //  双方とも同じ基準=左端合わせに統一しないとIoU比較が正しく機能しない)
  function shiftToXZero(strokes){
    var minx = Infinity;
    for(var i=0;i<strokes.length;i++) for(var j=0;j<strokes[i].length;j++) minx=Math.min(minx, strokes[i][j][0]);
    if(minx === Infinity || Math.abs(minx) < 1e-9) return strokes;
    return strokes.map(function(s){ return s.map(function(p){ return [p[0]-minx, p[1]]; }); });
  }

  function _stamp(mask, px, py){
    var r = STAMP_R;
    var x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(RW - 1, Math.ceil(px + r));
    var y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(RH - 1, Math.ceil(py + r));
    for(var yy = y0; yy <= y1; yy++){
      for(var xx = x0; xx <= x1; xx++){
        var dx = xx - px, dy = yy - py;
        if(dx*dx + dy*dy <= r*r + 0.4) mask[yy * RW + xx] = 1;
      }
    }
  }

  // strokes: [[[x,y],[x,y],...], ...] (正規化済み座標: baseline=0, capline=1)
  function rasterize(strokes){
    var mask = new Uint8Array(RW * RH);
    for(var i = 0; i < strokes.length; i++){
      var s = strokes[i];
      if(!s || s.length === 0) continue;
      if(s.length === 1){
        var p0 = _toPx(s[0][0], s[0][1]);
        _stamp(mask, p0[0], p0[1]);
        continue;
      }
      for(var j = 0; j < s.length - 1; j++){
        var a = _toPx(s[j][0], s[j][1]);
        var b = _toPx(s[j+1][0], s[j+1][1]);
        var dist = Math.hypot(b[0]-a[0], b[1]-a[1]);
        var steps = Math.max(1, Math.ceil(dist * 1.5));
        for(var k = 0; k <= steps; k++){
          var t = k / steps;
          _stamp(mask, a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t);
        }
      }
    }
    return mask;
  }

  function density(mask){
    var c = 0;
    for(var i = 0; i < mask.length; i++) c += mask[i];
    return c / mask.length;
  }

  function iou(maskA, maskB){
    var inter = 0, union = 0;
    for(var i = 0; i < maskA.length; i++){
      var a = maskA[i], b = maskB[i];
      if(a || b) union++;
      if(a && b) inter++;
    }
    return union === 0 ? 0 : inter / union;
  }

  // ==========================================================
  // 2. 参照グリフのラスタキャッシュ
  // ==========================================================
  var _glyphMaskCache = {};
  var _glyphDensityCache = {};
  function _glyphMask(ch){
    if(_glyphMaskCache[ch]) return _glyphMaskCache[ch];
    var GLYPHS = (typeof window !== 'undefined' && window.SHX_GLYPHS) || {};
    var strokes = GLYPHS[ch];
    if(!strokes) return null;
    var m = rasterize(shiftToXZero(strokes));
    _glyphMaskCache[ch] = m;
    _glyphDensityCache[ch] = density(m);
    return m;
  }

  // 通常の単線フォント文字が取り得る密度の上限(これを大きく超える候補=ハッチング・
  // 塗りつぶし等の「文字ではない図形」として早期に除外する)
  var MAX_PLAUSIBLE_DENSITY = 0.30;
  var MATCH_THRESHOLD = 0.30; // 一致率がこれ未満なら「該当文字なし」とする

  // 候補(正規化済みストローク)を全参照グリフと比較し、最良の文字とスコアを返す
  function matchGlyph(strokesNormalized){
    var mask = rasterize(shiftToXZero(strokesNormalized));
    var d = density(mask);
    if(d > MAX_PLAUSIBLE_DENSITY){
      return {ch:null, score:0, reason:'too_dense'};
    }
    var GLYPHS = (typeof window !== 'undefined' && window.SHX_GLYPHS) || {};
    var best = null, bestScore = -1;
    for(var ch in GLYPHS){
      var gm = _glyphMask(ch);
      if(!gm) continue;
      var s = iou(mask, gm);
      if(s > bestScore){ bestScore = s; best = ch; }
    }
    if(best === null || bestScore < MATCH_THRESHOLD) return {ch:null, score:bestScore, reason:'low_score'};
    return {ch:best, score:bestScore};
  }

  // ==========================================================
  // 3. 幾何ユーティリティ
  // ==========================================================
  function dist2(x1,y1,x2,y2){ var dx=x2-x1, dy=y2-y1; return dx*dx+dy*dy; }

  // doc.enko(円弧/円)を短い線分列に変換する。viewer.jsのdrawArc()と同じ角度規約
  // (a1,a2は度、w2s系と同じ数学標準のCCW)に合わせている
  function enkoToSegs(e){
    var a1 = e.a1 || 0, a2 = (e.a2 === undefined ? 360 : e.a2);
    if(Math.abs(a2 - a1 - 360) < 0.01) { /* 全周円: そのまま */ }
    else if(a2 < a1) a2 += 360;
    var span = a2 - a1;
    var n = Math.max(6, Math.round(Math.abs(span) / 12));
    var rx = e.rx || e.r || 0, ry = e.ry || e.r || 0;
    var pts = [];
    for(var i = 0; i <= n; i++){
      var a = (a1 + span * i / n) * Math.PI / 180;
      pts.push({x: e.cx + rx * Math.cos(a), y: e.cy + ry * Math.sin(a)});
    }
    var segs = [];
    for(var j = 0; j < pts.length - 1; j++){
      segs.push({x1:pts[j].x, y1:pts[j].y, x2:pts[j+1].x, y2:pts[j+1].y, src:e});
    }
    return segs;
  }

  // ==========================================================
  // 4. クラスタリング(端点近接によるUnion-Find連結成分)
  //    1クラスタ = 1文字候補(ストロークフォントは通常、1文字を構成する線分
  //    同士が接触/重複しているが、文字間には十分な隙間があるという前提)
  // ==========================================================
  function buildClusters(segs, eps){
    var n = segs.length;
    if(n === 0) return [];
    var parent = new Int32Array(n);
    for(var i = 0; i < n; i++) parent[i] = i;
    function find(x){ while(parent[x] !== x){ parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a,b){ var ra=find(a), rb=find(b); if(ra!==rb) parent[ra]=rb; }

    var cell = Math.max(eps, 1e-6);
    var grid = {};
    function cellKey(cx,cy){ return cx + '_' + cy; }
    var endpoints = [];
    for(var i2 = 0; i2 < n; i2++){
      endpoints.push([segs[i2].x1, segs[i2].y1, i2]);
      endpoints.push([segs[i2].x2, segs[i2].y2, i2]);
    }
    endpoints.forEach(function(p){
      var cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
      var k = cellKey(cx,cy);
      if(!grid[k]) grid[k] = [];
      grid[k].push(p);
    });
    var eps2 = eps * eps;
    endpoints.forEach(function(p){
      var cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
      for(var dx = -1; dx <= 1; dx++){
        for(var dy = -1; dy <= 1; dy++){
          var lst = grid[cellKey(cx+dx, cy+dy)];
          if(!lst) continue;
          for(var m = 0; m < lst.length; m++){
            var q = lst[m];
            if(q[2] === p[2]) continue;
            if(dist2(p[0],p[1],q[0],q[1]) <= eps2) union(p[2], q[2]);
          }
        }
      }
    });
    var groups = {};
    for(var i3 = 0; i3 < n; i3++){
      var r = find(i3);
      if(!groups[r]) groups[r] = [];
      groups[r].push(i3);
    }
    return Object.keys(groups).map(function(k){ return groups[k]; });
  }

  function clusterBBox(idxs, segs){
    var minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
    for(var i=0;i<idxs.length;i++){
      var s=segs[idxs[i]];
      minx=Math.min(minx,s.x1,s.x2); maxx=Math.max(maxx,s.x1,s.x2);
      miny=Math.min(miny,s.y1,s.y2); maxy=Math.max(maxy,s.y1,s.y2);
    }
    return {minx:minx,miny:miny,maxx:maxx,maxy:maxy,w:maxx-minx,h:maxy-miny,
            cx:(minx+maxx)/2, cy:(miny+maxy)/2};
  }

  // ==========================================================
  // 5. 候補クラスタの正規化(共有ベースライン/キャップライン基準)
  //    run(文字列全体)の中央値の高さをキャップ高さとして、各クラスタを
  //    baseline=0, capline=1 の共通座標系に変換する(自身のbboxだけで正規化
  //    すると "-" や "." のような小さい記号が壊れるため、run全体で共有する)
  // ==========================================================
  function normalizeClusterSegs(idxs, segs, baselineY, scale, angleRad){
    var cos = Math.cos(-angleRad), sin = Math.sin(-angleRad);
    var strokes = [];
    // 同一クラスタ内の線分は接続情報を保持していないため、各線分を独立した
    // 2点ストロークとして扱う(ラスタ化には十分)
    for(var i = 0; i < idxs.length; i++){
      var s = segs[idxs[i]];
      var p1 = rot(s.x1, s.y1 - baselineY, cos, sin);
      var p2 = rot(s.x2, s.y2 - baselineY, cos, sin);
      strokes.push([[p1[0]/scale, p1[1]/scale], [p2[0]/scale, p2[1]/scale]]);
    }
    return strokes;
  }
  function rot(x,y,cos,sin){ return [x*cos - y*sin, x*sin + y*cos]; }

  // x方向のみさらに0開始にシフト(左端合わせ。文字幅は保持=非均一スケールしない)
  function shiftStrokesToXZero(strokes){
    var minx = Infinity;
    for(var i=0;i<strokes.length;i++) for(var j=0;j<strokes[i].length;j++) minx=Math.min(minx, strokes[i][j][0]);
    if(minx === Infinity || minx === 0) return strokes;
    return strokes.map(function(s){ return s.map(function(p){ return [p[0]-minx, p[1]]; }); });
  }

  // ==========================================================
  // 6. run(連続する文字列)の組み立て
  //    タップされたクラスタを起点に、同程度の大きさ・向きの隣接クラスタを
  //    左右(run方向)に辿って1つの文字列として連結する
  // ==========================================================
  function assembleRun(tapClusterIdx, clusters, segs){
    var boxes = clusters.map(function(idxs){ return clusterBBox(idxs, segs); });
    var tapBox = boxes[tapClusterIdx];

    // 起点の近傍にある他クラスタから、run方向(角度)を推定する
    // (単純化のため水平runのみサポート。回転した図面はscale/tx/ty等の
    //  ビュー変換で吸収されるため、DXFワールド座標上ではほぼ水平/垂直が主)
    var neighborRadius = Math.max(tapBox.w, tapBox.h) * 8 + 1e-6;
    var near = [];
    for(var i = 0; i < boxes.length; i++){
      if(i === tapClusterIdx) continue;
      var b = boxes[i];
      var dx = b.cx - tapBox.cx, dy = b.cy - tapBox.cy;
      var d = Math.hypot(dx,dy);
      if(d <= neighborRadius) near.push({i:i, dx:dx, dy:dy, d:d, box:b});
    }

    // V1_195: 基準となる高さは「タップされたクラスタ自身の高さ」を土台にする。
    // (近傍クラスタの高さも混ぜて中央値を取ると、離れた場所の無関係な図形(表枠線等、
    // 極端に高さが違うもの)が中央値そのものを引っ張ってしまい、以降の高さフィルタが
    // 効かなくなる不具合があったため、タップクラスタ基準±適度な範囲の近傍だけで補正する)
    var heights = [tapBox.h].concat(near.filter(function(n){
      return n.box.h > tapBox.h*0.4 && n.box.h < tapBox.h*1.8; // 近い高さのものだけ
    }).map(function(n){ return n.box.h; }));
    heights.sort(function(a,b){return a-b;});
    var medianH = heights[Math.floor(heights.length/2)] || tapBox.h;

    // run方向: 高さが近い最近傍クラスタへの方向を採用(無ければ水平とみなす)
    var tall = near.filter(function(n){ return n.box.h > medianH*0.5 && n.box.h < medianH*2.2; });
    tall.sort(function(a,b){ return a.d - b.d; });
    var angle = 0;
    if(tall.length > 0){
      angle = Math.atan2(tall[0].dy, tall[0].dx);
      // 水平runなら概ね0かPI、垂直runなら概ねPI/2か-PI/2に丸める(斜め誤爆防止)
      var norm = ((angle % Math.PI) + Math.PI) % Math.PI;
      angle = (norm < Math.PI/4 || norm > Math.PI*3/4) ? 0 : Math.PI/2;
    }
    var dirx = Math.cos(angle), diry = Math.sin(angle);
    var perp = Math.abs(Math.cos(angle+Math.PI/2))+Math.abs(Math.sin(angle+Math.PI/2)); // unused guard

    // tapBoxを起点として、run方向の位置(t)で並べ、垂直方向(perp距離)が
    // 中央値高さの0.6倍以内、かつ隣接ギャップが中央値高さの2.2倍以内の
    // クラスタだけを連結する
    function perpDist(dx,dy){ return Math.abs(-dirx*0 + dx*(-diry) + dy*(dirx)); } // |cross(dir,(dx,dy))|
    var runMembers = [{i:tapClusterIdx, t:0, box:tapBox}];
    // V1_195: 高さがrunの中央値から大きく外れるクラスタ(表枠・仕切り線などの
    // 単発の長い線)はrunに含めない。実DXFで、離れた場所にある縦の仕切り線が
    // "I"に完全一致してconfidenceを不当に持ち上げてしまう誤検出があったため追加
    var pool = near.filter(function(n){
      return perpDist(n.dx,n.dy) <= medianH*0.6 && n.box.h <= medianH*1.8;
    }).map(function(n){ return {i:n.i, t:n.dx*dirx+n.dy*diry, box:n.box}; });
    pool.sort(function(a,b){ return a.t - b.t; });

    // 正方向へ連結
    var lastT = 0;
    for(var p = 0; p < pool.length; p++){
      if(pool[p].t <= lastT) continue;
      var gap = pool[p].t - lastT - (lastT===0?tapBox.w/2:0);
      if(pool[p].t - lastT > medianH*2.4) break;
      runMembers.push(pool[p]);
      lastT = pool[p].t;
    }
    // 負方向へ連結
    lastT = 0;
    for(var q = pool.length - 1; q >= 0; q--){
      if(pool[q].t >= lastT) continue;
      if(lastT - pool[q].t > medianH*2.4) break;
      runMembers.push(pool[q]);
      lastT = pool[q].t;
    }
    runMembers.sort(function(a,b){ return a.t - b.t; });

    return {members: runMembers, medianH: medianH, angle: angle, baselineY: null};
  }

  // ==========================================================
  // 7. メインエントリ: ワールド座標(タップ位置)から文字列を推定する
  //    segsSource: {sen:[{x1,y1,x2,y2,layer}], enko:[{cx,cy,r,rx,ry,a1,a2,layer}]}
  //    opts.hiddenLayers: Set<string> 非表示レイヤーは除外する
  //    opts.textHeightHint: 参考文字高さ(未指定ならクラスタから自動推定)
  // ==========================================================
  function recognizeFromEntities(segsSource, tapX, tapY, opts){
    opts = opts || {};
    var hidden = opts.hiddenLayers || null;
    var sen = (segsSource.sen || []).filter(function(e){ return !hidden || !hidden.has(e.layer); });
    var enko = (segsSource.enko || []).filter(function(e){ return !hidden || !hidden.has(e.layer); });

    var segs = sen.map(function(e){ return {x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,layer:e.layer}; });
    for(var i = 0; i < enko.length; i++){
      segs = segs.concat(enkoToSegs(enko[i]));
    }
    if(segs.length === 0) return null;

    // タップ位置周辺(粗い探索半径)の線分だけを対象にする(全図面走査は避ける)
    var roughR = opts.searchRadius || 400;
    var roughR2 = roughR*roughR;
    function segNear(s){
      var mx=(s.x1+s.x2)/2, my=(s.y1+s.y2)/2;
      return dist2(mx,my,tapX,tapY) <= roughR2 || dist2(s.x1,s.y1,tapX,tapY)<=roughR2 || dist2(s.x2,s.y2,tapX,tapY)<=roughR2;
    }
    var localSegs = segs.filter(segNear);
    if(localSegs.length === 0) return null;

    var eps = opts.eps || 20;
    var clusters = buildClusters(localSegs, eps);
    if(clusters.length === 0) return null;

    // タップ位置に最も近いクラスタを選ぶ(bboxへの距離が最小)
    var boxes = clusters.map(function(idxs){ return clusterBBox(idxs, localSegs); });
    var tapClusterIdx = -1, bestD = Infinity;
    for(var c = 0; c < boxes.length; c++){
      var b = boxes[c];
      var dx = Math.max(b.minx - tapX, 0, tapX - b.maxx);
      var dy = Math.max(b.miny - tapY, 0, tapY - b.maxy);
      var d = dx*dx + dy*dy;
      if(d < bestD){ bestD = d; tapClusterIdx = c; }
    }
    if(tapClusterIdx < 0) return null;
    // タップ判定の許容距離(文字候補のbboxからあまりに離れていれば無視)
    var tapBox = boxes[tapClusterIdx];
    var tol = Math.max(tapBox.w, tapBox.h, 30) * 1.5;
    if(bestD > tol*tol) return null;

    // V1_195: タップされたクラスタが「線分1本だけの単純な直線」の場合は認識しない。
    // 単一の線分は幾何形状として"I"や"1"等と完全に一致してしまうが、実際の図面では
    // 表の区切り線・寸法補助線・引出線の切れ端である可能性の方がはるかに高く、
    // 文字かどうかを形状だけで区別する手段が無いため。誤検出防止を優先する。
    if(clusters[tapClusterIdx].length <= 1) return null;

    var run = assembleRun(tapClusterIdx, clusters, localSegs);
    var medianH = run.medianH;
    if(medianH <= 0) return null;

    // ベースラインY(runの角度方向に対する直交成分の代表値): 中央値高さに
    // 近いクラスタのbbox下端の平均を使う
    var baselineCandidates = run.members.filter(function(m){ return m.box.h > medianH*0.5; });
    if(baselineCandidates.length === 0) baselineCandidates = run.members;
    var baselineY = 0;
    if(run.angle === 0){
      baselineY = baselineCandidates.reduce(function(a,m){return a+m.box.miny;},0)/baselineCandidates.length;
    } else {
      baselineY = baselineCandidates.reduce(function(a,m){return a+m.box.minx;},0)/baselineCandidates.length;
    }
    var scale = medianH; // capline(1.0)がmedianHに相当

    var chars = [];
    for(var k = 0; k < run.members.length; k++){
      var mem = run.members[k];
      var idxs = clusters[mem.i];
      var angleForNorm = run.angle === 0 ? 0 : Math.PI/2;
      var strokes;
      if(angleForNorm === 0){
        strokes = normalizeClusterSegs(idxs, localSegs, baselineY, scale, 0);
      } else {
        // 縦方向run: (x,y)を90度回転させてから通常の水平文字として正規化
        strokes = normalizeClusterSegsRotated(idxs, localSegs, baselineY, scale);
      }
      strokes = shiftStrokesToXZero(strokes);
      var m = matchGlyph(strokes);
      chars.push({ch:m.ch, score:m.score, t:mem.t, box:mem.box, isTapped:(mem.i===tapClusterIdx)});
    }

    // タップされた文字が認識できなければ全体を諦める
    var tappedResult = chars.filter(function(c){ return c.isTapped; })[0];
    if(!tappedResult || !tappedResult.ch) return null;

    // V1_195: 誤検出防止のための総合判定。
    // H形鋼断面記号・ハッチング入りロゴ・角印(ハンコ)等の「文字ではない図形」は
    // 個々のクラスタが偶然どれかの参照グリフに弱く似てしまうことがあるため、
    // タップされた1文字だけでなく「run全体としてどれだけ確からしいか」で
    // 最終判定する。実DXF由来の誤検出図形で検証した結果、本物の文字列は
    // 平均一致率(confidence)が高く・run内のほとんどの文字が認識できるのに対し、
    // 記号・ロゴ等はconfidenceが低く未認識文字('?')が多いという明確な差があった。
    var confidence = chars.reduce(function(a,c){return a+(c.score||0);},0) / chars.length;
    var matchRatio = chars.filter(function(c){return !!c.ch;}).length / chars.length;
    var SOLO_THRESHOLD = 0.62;     // 前後に文字が無い(1文字だけ)の場合はより厳しく判定
    var RUN_MIN_CONFIDENCE = 0.45; // run全体の平均一致率の下限
    var RUN_MIN_MATCH_RATIO = 0.6; // run内で認識できた文字の割合の下限
    if(chars.length === 1){
      if(tappedResult.score < SOLO_THRESHOLD) return null;
    } else {
      if(confidence < RUN_MIN_CONFIDENCE || matchRatio < RUN_MIN_MATCH_RATIO) return null;
    }

    var text = chars.map(function(c){ return c.ch || '?'; }).join('');
    return {
      text: text,
      tappedChar: tappedResult.ch,
      chars: chars,
      confidence: confidence
    };
  }

  function normalizeClusterSegsRotated(idxs, segs, baselineX, scale){
    // 縦書きrun: x軸を基準線とみなし、(x - baselineX)をy相当、-yをx相当として
    // 水平文字と同じ扱いにする(90度回転)
    var strokes = [];
    for(var i=0;i<idxs.length;i++){
      var s = segs[idxs[i]];
      var p1 = [ -(s.y1), (s.x1 - baselineX) ];
      var p2 = [ -(s.y2), (s.x2 - baselineX) ];
      strokes.push([[p1[0]/scale, p1[1]/scale],[p2[0]/scale, p2[1]/scale]]);
    }
    return strokes;
  }

  // ==========================================================
  // 8. アプリ統合用エントリ(index.htmlのグローバルdoc/hiddenLayersを読む)
  // ==========================================================
  function recognizeStrokeTextAt(wx, wy, opts){
    if(typeof doc === 'undefined' || !doc || !doc.sen) return null;
    var hidden = (typeof hiddenLayers !== 'undefined') ? hiddenLayers : null;
    // 図面内の代表的な文字高さ(doc.mojiがあれば)をクラスタ接続閾値の目安にする。
    // doc.mojiが1件も無い(図面全体にTEXTが無い)場合は、現在の表示スケール(scale)
    // を使って「画面上で数px相当」をワールド座標のepsに変換する(単位系に依存しない
    // フォールバック。世界座標の絶対値には単位系(mm/inch等)によって差があるため)
    var eps = (typeof scale === 'number' && scale > 0) ? Math.max(4, 6/scale) : 20;
    if(doc.moji && doc.moji.length > 0){
      var hs = doc.moji.map(function(m){ return m.h; }).filter(function(h){return h>0;});
      if(hs.length){
        hs.sort(function(a,b){return a-b;});
        var medH = hs[Math.floor(hs.length/2)];
        eps = Math.max(4, medH * 0.12);
      }
    }
    var mergedOpts = Object.assign({hiddenLayers:hidden, eps:eps, searchRadius: eps*40}, opts||{});
    return recognizeFromEntities({sen:doc.sen, enko:doc.enko}, wx, wy, mergedOpts);
  }

  // ==========================================================
  // 公開API
  // ==========================================================
  var api = {
    recognizeStrokeTextAt: recognizeStrokeTextAt,
    // テスト・デバッグ用に内部関数も公開する
    _internal: {
      rasterize: rasterize, density: density, iou: iou, matchGlyph: matchGlyph,
      buildClusters: buildClusters, clusterBBox: clusterBBox, enkoToSegs: enkoToSegs,
      recognizeFromEntities: recognizeFromEntities, assembleRun: assembleRun,
      normalizeClusterSegs: normalizeClusterSegs
    }
  };

  if(typeof window !== 'undefined'){
    window.recognizeStrokeTextAt = recognizeStrokeTextAt;
    window._strokeTextInternal = api._internal;
  }
  if(typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
})();
