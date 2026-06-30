// verify.js — DXF Viewer Verify Mode V4
// 【設計原則】
//   verifyMode=false（デフォルト）の時は verify()/verifyWarn() が先頭で即リターン
//   → 通常モードのパフォーマンス・メモリに一切影響なし
//
// 【公開API】
//   window.verify(eventName, extra)
//   window.verifyWarn(msg, extra)
//   window.exportVerifyLog()
//   window.verifySummary()
//   window.verifyMode / window.verifyLog
//
// ★ V4追加
//   ① Mutation Trace      — 参照変化・件数減少時に new Error().stack を保存
//   ② currentFile監視     — cfStrokes/cfDims の参照変化を追跡
//   ③ Save系開始/終了State — 操作前後のStateを entry.startState / state に保存
//   ④ 強制スナップショット  — Undo/Redo/Clear/switchToFile 等でstrokes配列を保存

'use strict';
(function () {

  // ── パブリック変数 ──────────────────────────────────────────────────
  window.verifyMode = false;
  window.verifyLog  = [];

  var _PERSIST_KEY  = 'dxfview_vm';
  var _prev         = null;
  var _refs         = null;
  var _timers       = {};
  var _synDirty     = false;
  var _postSaveSnap = null;
  var _frozen       = false;
  var _statusEl     = null;

  // ── V4追加変数 ──────────────────────────────────────────────────────
  var _opStates = {};   // Save系開始時スナップ { operationKey → snap }

  // ── タイマー対象イベント ─────────────────────────────────────────────
  var _TIMER_START = {
    'doSave:start'           : 'doSave',
    'IDB保存開始'             : 'IDB保存',
    'tryRestore:start'       : 'tryRestore',
    'switchToFile:before'    : 'switchToFile',
    'openDxfFromDb:before'   : 'openDxfFromDb',
    'fileInput.change:start' : 'fileInput.change'
  };
  var _TIMER_END = {
    'doSave:done'            : 'doSave',
    'IDB保存成功'             : 'IDB保存',
    'IDB保存失敗'             : 'IDB保存',
    'tryRestore:done'        : 'tryRestore',
    'switchToFile:after'     : 'switchToFile',
    'openDxfFromDb:after'    : 'openDxfFromDb',
    'fileInput.change:done'  : 'fileInput.change'
  };

  // ── タブ切替など "意図的な状態変化" イベント ─────────────────────────
  var _SWITCH_EVENTS = {
    'fileInput.change:start' : 1,
    'fileInput.change:done'  : 1,
    'openDxfFromDb:before'   : 1,
    'openDxfFromDb:after'    : 1,
    'switchToFile:before'    : 1,
    'switchToFile:after'     : 1,
    'doCloseTab'             : 1,
    'clear'                  : 1,
    'tryRestore:done'        : 1,
    'Undo'                   : 1,
    'Redo'                   : 1,
    'バックアップ復元:done' : 1,
    'verifyMode:ON'          : 1
  };

  // ── V3: データ件数減少が "正常" なイベント ───────────────────────────
  var _SAFE_REDUCTION = {
    'Undo'                   : 1,
    'clear'                  : 1,
    'doCloseTab'             : 1,
    'バックアップ復元:done'   : 1,
    'tryRestore:done'        : 1,
    'tryRestore:start'       : 1,
    'switchToFile:before'    : 1,
    'switchToFile:after'     : 1,
    'fileInput.change:start' : 1,
    'fileInput.change:done'  : 1,
    'openDxfFromDb:before'   : 1,
    'openDxfFromDb:after'    : 1,
    'verifyMode:ON'          : 1,
    'hiddenLayers変更'        : 1,
    'savedViews変更'          : 1
  };

  // ── V4: ③ Save系の開始/終了ペア ─────────────────────────────────────
  // isStart=true のイベントで _opStates へ記録
  // isStart=false のイベントで entry.startState に添付
  var _OP_PAIRS = {
    'doSave:start'           : { key: 'doSave',         isStart: true  },
    'doSave:done'            : { key: 'doSave',         isStart: false },
    'switchToFile:before'    : { key: 'switchToFile',   isStart: true  },
    'switchToFile:after'     : { key: 'switchToFile',   isStart: false },
    'openDxfFromDb:before'   : { key: 'openDxfFromDb',  isStart: true  },
    'openDxfFromDb:after'    : { key: 'openDxfFromDb',  isStart: false },
    'tryRestore:start'       : { key: 'tryRestore',     isStart: true  },
    'tryRestore:done'        : { key: 'tryRestore',     isStart: false },
    'fileInput.change:start' : { key: 'fileInput',      isStart: true  },
    'fileInput.change:done'  : { key: 'fileInput',      isStart: false }
  };

  // ── V4: ④ 強制スナップショット対象イベント ──────────────────────────
  var _SNAPSHOT_EVENTS = {
    'Undo'                   : 1,
    'Redo'                   : 1,
    'clear'                  : 1,
    'switchToFile:after'     : 1,
    'openDxfFromDb:after'    : 1,
    'doSave:done'            : 1,
    'fileInput.change:done'  : 1
  };

  // ── ① メイン：イベント記録 ─────────────────────────────────────────
  window.verify = function (eventName, extra) {
    if (!window.verifyMode) return;
    if (_frozen) return;

    var now  = Date.now();
    var snap = _snap();
    var entry = { ts: now, event: eventName };
    if (extra !== undefined) entry.extra = extra;

    // ─── ③ Save系: 開始イベント → opStates へ記録 ────────────────────
    var opPair = _OP_PAIRS[eventName];
    if (opPair && opPair.isStart) {
      _opStates[opPair.key] = snap;
    }

    // ─── ③ 保存時間計測（開始） ─────────────────────────────────────
    var startKey = _TIMER_START[eventName];
    if (startKey) _timers[startKey] = now;

    // ─── ④ synthetic dirty 監視 ─────────────────────────────────────
    if (eventName === 'scheduleSave' && !_synDirty) {
      _synDirty = true;
      entry.dirty_changed = 'false → true';
    }
    if (eventName === 'doSave:start') {
      _postSaveSnap = { strokes: snap.strokes, dims: snap.dims };
    }

    // ─── ① State Diff ────────────────────────────────────────────────
    if (_prev) {
      var diff = _diff(_prev, snap);
      if (Object.keys(diff).length > 0) entry.diff = diff;
    }

    // ─── ① ② Object Identity 監視 + stack取得 ──────────────────────
    var newRefs = _captureRefs();
    if (_refs && !_SWITCH_EVENTS[eventName]) {
      var refWarns = _checkIdentity(_refs, newRefs);
      if (refWarns.length > 0) {
        var refStack = _getStack();   // ① スタック取得
        refWarns.forEach(function (w) {
          _push({ ts: now, event: 'WARNING',
                  msg: 'ObjectIdentity: ' + w,
                  stack: refStack,
                  state: { currentFileIdx: snap.idx,
                           strokes: snap.strokes, dims: snap.dims } });
        });
      }
    }
    _refs = newRefs;

    // ─── ③ 保存時間計測（終了） ─────────────────────────────────────
    var endKey = _TIMER_END[eventName];
    if (endKey && _timers[endKey] != null) {
      entry.elapsed_ms = now - _timers[endKey];
      delete _timers[endKey];
    }

    // ─── ③ Save系: 終了イベント → startState を添付 ─────────────────
    if (opPair && !opPair.isStart && _opStates[opPair.key]) {
      entry.startState = _opStates[opPair.key];
      delete _opStates[opPair.key];
    }

    // ─── ④ dirty（doSave:done → false） ─────────────────────────────
    if (eventName === 'doSave:done' && _synDirty) {
      _synDirty = false;
      entry.dirty_changed = 'true → false';
    }

    // ─── ⑤ 通常異常検知（WARNING付加） ──────────────────────────────
    var warnings = [];
    if (_prev) {
      if (_prev.strokes > 0 && snap.strokes === 0)
        warnings.push('strokes ' + _prev.strokes + ' → 0 (DATA LOSS?)');
      if (_prev.dims > 0 && snap.dims === 0)
        warnings.push('dims ' + _prev.dims + ' → 0 (DATA LOSS?)');
      if (!_SWITCH_EVENTS[eventName]) {
        if (_prev.idx >= 0 && snap.idx !== _prev.idx)
          warnings.push('currentFileIdx unexpected: ' + _prev.idx + ' → ' + snap.idx);
        if (_prev.fileKey && snap.fileKey && _prev.fileKey !== snap.fileKey)
          warnings.push('fileKey unexpected: ' + _prev.fileKey + ' → ' + snap.fileKey);
      }
      if (eventName === 'doSave:done' && _postSaveSnap) {
        if (snap.strokes < _postSaveSnap.strokes)
          warnings.push('doSave後にstrokes減少: ' + _postSaveSnap.strokes + ' → ' + snap.strokes);
        if (snap.dims < _postSaveSnap.dims)
          warnings.push('doSave後にdims減少: ' + _postSaveSnap.dims + ' → ' + snap.dims);
        _postSaveSnap = null;
      }
    }
    try {
      if (typeof openFiles !== 'undefined' && snap.idx >= 0 && openFiles[snap.idx]) {
        var cf = openFiles[snap.idx];
        if (typeof strokes !== 'undefined' && !Object.is(cf.strokes, strokes))
          warnings.push('currentFile.strokes !== strokes (reference mismatch)');
        if (typeof dims !== 'undefined' && !Object.is(cf.dims, dims))
          warnings.push('currentFile.dims !== dims (reference mismatch)');
      } else if (snap.idx < 0 && typeof openFiles !== 'undefined' && openFiles.length > 0) {
        warnings.push('currentFileIdx=-1 but openFiles.length=' + openFiles.length);
      }
    } catch (e) {}
    if (warnings.length > 0) entry.WARNING = warnings;

    // ─── V3: DATA LOSS 自動検知 ──────────────────────────────────────
    if (_prev && !_SAFE_REDUCTION[eventName]) {
      var losses = _detectDataLoss(_prev, snap);
      if (losses.length > 0) {
        var crashEntry = {
          ts           : now,
          event        : 'DATA_LOSS_DETECTED',
          losses       : losses,
          triggerEvent : eventName,
          prevState    : _prev,
          currState    : snap,
          currentFileIdx: snap.idx,
          fileKey      : snap.fileKey,
          synDirty     : _synDirty,
          stack        : _getStack(),          // ① スタック保存
          refSnapshot  : _safeRefSnap(newRefs),
          strokesSnapshot: _compactSnapshot()  // ④ 強制スナップ
        };
        if (extra !== undefined) crashEntry.extra = extra;
        _push(crashEntry);
        _triggerCrashDump();
        _updateStatus(true);
        _frozen = true;
        return;
      }
    }

    // ─── ④ 強制スナップショット（特定イベントで strokes を保存） ─────
    if (_SNAPSHOT_EVENTS[eventName]) {
      entry.strokesSnapshot = _compactSnapshot();
    }

    // ─── 現在状態を state フィールドに添付 ───────────────────────────
    entry.state = {
      currentFileIdx  : snap.idx,
      fileKey         : snap.fileKey,
      currentFileName : snap.fileName,
      strokes         : snap.strokes,
      dims            : snap.dims,
      images          : snap.images,
      savedViews      : snap.savedViews,
      hiddenLayers    : snap.hiddenLayers,
      tx              : snap.tx,
      ty              : snap.ty,
      scale           : snap.scale,
      fitScale        : snap.fitScale
    };

    _prev = snap;
    _push(entry);
  };

  // ── WARNING 専用 ────────────────────────────────────────────────────
  window.verifyWarn = function (msg, extra) {
    if (!window.verifyMode) return;
    if (_frozen) return;
    var snap = _snap();
    var entry = {
      ts    : Date.now(),
      event : 'WARNING',
      msg   : msg,
      stack : _getStack(),   // ① WARNINGにもスタック付加
      state : { currentFileIdx: snap.idx, fileKey: snap.fileKey,
                strokes: snap.strokes, dims: snap.dims }
    };
    if (extra !== undefined) entry.extra = extra;
    _push(entry);
  };

  // ── ログエクスポート ────────────────────────────────────────────────
  window.exportVerifyLog = function () {
    if (!window.verifyLog.length) {
      alert('VerifyLog が空です\nVerify Mode を ON にしてから操作してください');
      return;
    }
    var data = JSON.stringify(window.verifyLog, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'verify_log_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  // ── ⑥ Verify Summary ──────────────────────────────────────────────
  window.verifySummary = function () {
    var log = window.verifyLog;
    if (!log.length) { console.log('[VerifySummary] ログが空です'); return; }

    var warnCount = 0, saves = [], idbSaves = [];
    var maxStrokes = 0, maxDims = 0, refChanges = 0, snapCount = 0;

    log.forEach(function (e) {
      if (e.event === 'WARNING' || (e.WARNING && e.WARNING.length > 0)) warnCount++;
      if (e.event === 'doSave:done' && e.elapsed_ms != null) saves.push(e.elapsed_ms);
      if (e.event === 'IDB保存成功' && e.elapsed_ms != null) idbSaves.push(e.elapsed_ms);
      if (e.state) {
        if ((e.state.strokes || 0) > maxStrokes) maxStrokes = e.state.strokes;
        if ((e.state.dims    || 0) > maxDims)    maxDims    = e.state.dims;
      }
      if (e.event === 'WARNING' && e.msg && e.msg.indexOf('ObjectIdentity') >= 0) refChanges++;
      if (e.strokesSnapshot) snapCount++;
    });

    var avg = function (a) { return a.length ? Math.round(a.reduce(function(x,y){return x+y;},0)/a.length) : '-'; };
    var max = function (a) { return a.length ? Math.max.apply(null,a) : '-'; };

    var summary = {
      '総イベント数'           : log.length,
      'WARNING数'              : warnCount,
      '凍結(DATA LOSS)'        : _frozen,
      'doSave回数'             : saves.length,
      'doSave平均(ms)'         : avg(saves),
      'doSave最大(ms)'         : max(saves),
      'IDB保存回数'            : idbSaves.length,
      'IDB保存平均(ms)'        : avg(idbSaves),
      'IDB保存最大(ms)'        : max(idbSaves),
      'strokes最大件数'        : maxStrokes,
      'dims最大件数'           : maxDims,
      'Object参照変更回数'     : refChanges,
      'strokesSnapshot回数'    : snapCount
    };
    console.table(summary);
    return summary;
  };

  // ── ⑦ Verify Viewer ────────────────────────────────────────────────
  function _showViewer() {
    var existing = document.getElementById('_vvOverlay');
    if (existing) { existing.remove(); return; }

    var log     = window.verifyLog;
    var entries = log.slice(-200).reverse();
    var t0      = log.length ? log[0].ts : Date.now();

    var overlay = document.createElement('div');
    overlay.id = '_vvOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:99999;' +
      'display:flex;flex-direction:column;font-family:monospace;color:#ddd;';

    var hdr = document.createElement('div');
    hdr.style.cssText =
      'display:flex;align-items:center;gap:12px;padding:10px 16px;' +
      'background:#0d1117;border-bottom:1px solid #30363d;flex-shrink:0;';
    var frozenBadge = _frozen
      ? '<span style="background:#f85149;color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;margin-right:4px">🔒 凍結中</span>'
      : '';
    hdr.innerHTML =
      '<span style="color:#58a6ff;font-weight:bold;font-size:15px">Verify Log Viewer V4</span>' +
      frozenBadge +
      '<span style="color:#8b949e;font-size:12px">最新' + entries.length + '件（新しい順）</span>' +
      '<span style="flex:1"></span>' +
      '<button id="_vvSummaryBtn" style="background:#21262d;color:#ccc;border:1px solid #444;' +
      'border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;margin-right:6px">📊 Summary</button>' +
      '<button id="_vvClose" style="background:#21262d;color:#ccc;border:1px solid #444;' +
      'border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">✕ 閉じる</button>';
    overlay.appendChild(hdr);

    var fbar = document.createElement('div');
    fbar.style.cssText =
      'display:flex;gap:8px;align-items:center;padding:8px 16px;' +
      'background:#0a0e13;border-bottom:1px solid #21262d;flex-shrink:0;';
    fbar.innerHTML =
      '<input id="_vvFilter" placeholder="イベント名・メッセージでフィルタ..." ' +
      'style="flex:1;background:#161b22;border:1px solid #30363d;color:#ddd;' +
      'border-radius:6px;padding:6px 10px;font-size:13px">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#8b949e;cursor:pointer">' +
      '<input type="checkbox" id="_vvWarnOnly" style="accent-color:#f85149"> WARNINGのみ</label>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#8b949e;cursor:pointer">' +
      '<input type="checkbox" id="_vvDiffOnly" style="accent-color:#3fb950"> 変更あり</label>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#8b949e;cursor:pointer">' +
      '<input type="checkbox" id="_vvStackOnly" style="accent-color:#58a6ff"> stack有</label>';
    overlay.appendChild(fbar);

    var listWrap = document.createElement('div');
    listWrap.style.cssText = 'flex:1;overflow-y:auto;padding:6px 16px;';
    overlay.appendChild(listWrap);

    function _render(ftxt, warnOnly, diffOnly, stackOnly) {
      listWrap.innerHTML = '';
      entries.forEach(function (e) {
        var isCrash = (e.event === 'DATA_LOSS_DETECTED');
        var isWarn  = (e.event === 'WARNING' || (e.WARNING && e.WARNING.length > 0));
        var hasDiff = !!(e.diff && Object.keys(e.diff).length > 0);
        var hasStack= !!(e.stack && e.stack.length > 0);
        var hasSnap = !!(e.strokesSnapshot);
        if (warnOnly && !isWarn && !isCrash) return;
        if (diffOnly && !hasDiff && !isWarn && !isCrash) return;
        if (stackOnly && !hasStack) return;
        if (ftxt) {
          var str = e.event + (e.msg||'') + JSON.stringify(e.state||'') + JSON.stringify(e.losses||'');
          if (str.indexOf(ftxt) < 0) return;
        }

        var row = document.createElement('div');
        row.style.cssText =
          'border-bottom:1px solid #161b22;padding:5px 0;font-size:12px;' +
          (isCrash ? 'background:#2a0a0a;border-bottom:2px solid #f85149;padding:8px 0;' :
           isWarn ? 'color:#f85149' : 'color:#c9d1d9');

        var rel  = (((e.ts||0) - t0) / 1000).toFixed(3);
        var time = new Date(e.ts).toTimeString().slice(0, 8);

        var diffHtml = '';
        if (hasDiff) {
          var parts = Object.keys(e.diff).map(function (k) {
            var d = e.diff[k];
            return '<span style="color:#f0883e">' + k + '</span> ' +
                   '<span style="color:#f85149">' + d.before + '</span>' +
                   '<span style="color:#8b949e">→</span>' +
                   '<span style="color:#3fb950">' + d.after + '</span>';
          });
          diffHtml = '<div style="padding-left:14px;color:#a8b3c4;margin-top:2px">' + parts.join('  ') + '</div>';
        }

        var warnHtml = '';
        if (e.WARNING && e.WARNING.length) {
          warnHtml = '<div style="padding-left:14px;color:#f85149;margin-top:2px">⚠ ' +
                     e.WARNING.join('<br>⚠ ') + '</div>';
        }
        if (e.msg) warnHtml += '<div style="padding-left:14px;color:#ffa198">' + e.msg + '</div>';

        var stackHtml = '';
        if (hasStack) {
          var shortStack = e.stack.split('\n').slice(0,5).join('\n');
          stackHtml = '<details style="padding-left:14px;margin-top:3px;cursor:pointer">' +
            '<summary style="color:#58a6ff;font-size:11px">📍 stack trace</summary>' +
            '<pre style="font-size:10px;color:#8b949e;margin:2px 0;white-space:pre-wrap">' +
            shortStack.replace(/</g,'&lt;') + '</pre></details>';
        }

        var lossHtml = '';
        if (isCrash && e.losses) {
          lossHtml = '<div style="padding:4px 14px;background:#3a0a0a;border-radius:4px;' +
            'margin-top:4px;color:#ff6b6b;font-weight:bold">' +
            '🔴 DATA LOSS: ' + e.losses.join(' / ') +
            '<br><span style="font-weight:normal;color:#ffaaaa">trigger: ' + e.triggerEvent + '</span>' +
            '</div>';
        }

        var snapHtml = '';
        if (hasSnap) {
          snapHtml = '<details style="padding-left:14px;margin-top:3px;cursor:pointer">' +
            '<summary style="color:#3fb950;font-size:11px">📸 strokesSnapshot (' +
            (e.strokesSnapshot.total || '?') + '本)</summary>' +
            '<pre style="font-size:10px;color:#8b949e;margin:2px 0;white-space:pre-wrap;max-height:100px;overflow-y:auto">' +
            JSON.stringify(e.strokesSnapshot, null, 1).replace(/</g,'&lt;').slice(0,1000) + '</pre></details>';
        }

        var startStateHtml = '';
        if (e.startState) {
          startStateHtml = '<div style="padding-left:14px;font-size:11px;color:#6e8ab8;margin-top:2px">' +
            'start: strokes=' + e.startState.strokes + ' dims=' + e.startState.dims + '</div>';
        }

        var el = e.elapsed_ms != null ? ' <span style="color:#58a6ff">⏱' + e.elapsed_ms + 'ms</span>' : '';
        var dr = e.dirty_changed ? ' <span style="color:#e3b341">🔸dirty:' + e.dirty_changed + '</span>' : '';
        var sn = hasSnap ? ' <span style="color:#3fb950">📸</span>' : '';
        var st = hasStack ? ' <span style="color:#58a6ff">📍</span>' : '';
        var icon = isCrash ? '🔴 ' : (isWarn ? '⚠ ' : '▸ ');

        row.innerHTML =
          '<div><span style="color:#484f58">' + time + ' +' + rel + 's </span>' +
          icon + '<strong' + (isCrash ? ' style="color:#f85149;font-size:13px"' : '') + '>' +
          e.event + '</strong>' + el + dr + sn + st + '</div>' +
          lossHtml + diffHtml + warnHtml + startStateHtml + stackHtml + snapHtml;
        listWrap.appendChild(row);
      });
      if (!listWrap.children.length)
        listWrap.innerHTML = '<div style="color:#484f58;padding:20px;text-align:center">該当エントリなし</div>';
    }

    _render('', false, false, false);
    document.body.appendChild(overlay);

    document.getElementById('_vvClose').onclick = function () { overlay.remove(); };
    document.getElementById('_vvSummaryBtn').onclick = function () {
      var s = window.verifySummary();
      if (s) alert(Object.keys(s).map(function(k){ return k + ': ' + s[k]; }).join('\n'));
    };
    var _doRender = function() {
      _render(
        document.getElementById('_vvFilter').value,
        document.getElementById('_vvWarnOnly').checked,
        document.getElementById('_vvDiffOnly').checked,
        document.getElementById('_vvStackOnly').checked
      );
    };
    document.getElementById('_vvFilter').oninput   = _doRender;
    document.getElementById('_vvWarnOnly').onchange = _doRender;
    document.getElementById('_vvDiffOnly').onchange = _doRender;
    document.getElementById('_vvStackOnly').onchange = _doRender;
  }

  // ── V4: ① スタック取得 ─────────────────────────────────────────────
  // "Error" ヘッダーと _getStack フレームを除いた呼び出しスタック
  function _getStack() {
    try {
      var lines = (new Error().stack || '').split('\n').slice(2);
      return lines.join('\n').slice(0, 1500);
    } catch(e) { return ''; }
  }

  // ── V4: ④ strokes コンパクトスナップショット ─────────────────────
  // 最大50本。各ストロークは type/ptCount/first/last/color のみ保存
  function _compactSnapshot() {
    try {
      if (typeof strokes === 'undefined' || !Array.isArray(strokes)) return null;
      var total = strokes.length;
      var MAX = 50;
      var items = strokes.slice(0, MAX).map(function(s, i) {
        var info = { i: i, type: s.type };
        if (s.color)    info.color  = s.color;
        if (s.lineWidth !== undefined) info.lw = s.lineWidth;
        if (s.pts && s.pts.length) {
          info.ptCount = s.pts.length;
          var p0 = s.pts[0], pN = s.pts[s.pts.length - 1];
          if (p0) info.first = [Math.round(p0.x * 10) / 10, Math.round(p0.y * 10) / 10];
          if (pN) info.last  = [Math.round(pN.x * 10) / 10, Math.round(pN.y * 10) / 10];
        }
        // HL/line セグメント
        if (s.x1 !== undefined) info.seg = [Math.round(s.x1*10)/10, Math.round(s.y1*10)/10,
                                             Math.round(s.x2*10)/10, Math.round(s.y2*10)/10];
        return info;
      });
      return { total: total, items: items, truncated: total > MAX };
    } catch(e) { return { error: String(e) }; }
  }

  // ── V3: DATA LOSS 検知 ─────────────────────────────────────────────
  function _detectDataLoss(prev, curr) {
    var losses = [];
    [['strokes','strokes'],['dims','dims'],['images','images'],
     ['savedViews','savedViews'],['hiddenLayers','hiddenLayers']].forEach(function(f){
      var pv = prev[f[0]], cv = curr[f[0]];
      if (typeof pv === 'number' && typeof cv === 'number' && pv > 0 && cv < pv)
        losses.push(f[1] + ': ' + pv + ' → ' + cv);
    });
    return losses;
  }

  // ── V3: クラッシュダンプ ────────────────────────────────────────────
  function _triggerCrashDump() {
    try {
      var dump = {
        dumpTime  : new Date().toISOString(),
        totalEvents: window.verifyLog.length,
        last100   : window.verifyLog.slice(-100),
        summary   : (function () {
          var saves = [], idb = [], refs = 0;
          window.verifyLog.forEach(function (e) {
            if (e.event === 'doSave:done' && e.elapsed_ms != null) saves.push(e.elapsed_ms);
            if (e.event === 'IDB保存成功' && e.elapsed_ms != null) idb.push(e.elapsed_ms);
            if (e.event === 'WARNING' && e.msg && e.msg.indexOf('ObjectIdentity') >= 0) refs++;
          });
          return { saveCount: saves.length,
                   saveAvgMs: saves.length ? Math.round(saves.reduce(function(a,b){return a+b;},0)/saves.length) : 0,
                   saveMaxMs: saves.length ? Math.max.apply(null,saves) : 0,
                   idbCount : idb.length,
                   idbAvgMs : idb.length ? Math.round(idb.reduce(function(a,b){return a+b;},0)/idb.length) : 0,
                   refChanges: refs };
        })()
      };
      var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = 'verifyCrash_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {}
  }

  // ── V3: UI ステータス更新 ──────────────────────────────────────────
  function _updateStatus(hasLoss) {
    if (!_statusEl) _statusEl = document.getElementById('_vvStatusBadge');
    if (!_statusEl) return;
    if (hasLoss) {
      _statusEl.style.cssText =
        'display:block;margin-top:6px;font-size:13px;font-weight:bold;' +
        'padding:5px 8px;border-radius:4px;background:#2a0a0a;border:1px solid #f85149;';
      _statusEl.style.color = '#f85149';
      _statusEl.textContent = '⚠ DATA LOSS DETECTED';
    } else {
      _statusEl.style.cssText =
        'display:block;margin-top:6px;font-size:12px;' +
        'padding:4px 8px;border-radius:4px;background:#0a1a0a;border:1px solid #2a4a2a;';
      _statusEl.style.color = '#3fb950';
      _statusEl.textContent = '✅ 異常なし';
    }
  }

  // ── 参照スナップ（シリアライズ用） ──────────────────────────────────
  function _safeRefSnap(refs) {
    if (!refs) return null;
    var out = {};
    Object.keys(refs).forEach(function (k) {
      var v = refs[k];
      if (Array.isArray(v))       out[k] = '[]len=' + v.length;
      else if (v instanceof Set)  out[k] = 'Set.size=' + v.size;
      else if (v === undefined)   out[k] = 'undefined';
      else if (v === null)        out[k] = 'null';
      else out[k] = typeof v;
    });
    return out;
  }

  // ── 内部: スナップショット ──────────────────────────────────────────
  function _snap() {
    var idx = -1, fk = '', fn = '', sv = 0;
    try { idx = (typeof currentFileIdx !== 'undefined') ? currentFileIdx : -1; } catch(e){}
    try {
      if (typeof openFiles !== 'undefined' && idx >= 0 && openFiles[idx]) {
        fk = openFiles[idx].fileKey || '';
        fn = openFiles[idx].currentFileName || openFiles[idx].name || '';
      } else { fn = (typeof currentFileName !== 'undefined') ? currentFileName : ''; }
    } catch(e){}
    try {
      if (typeof savedViews !== 'undefined' && Array.isArray(savedViews))
        sv = savedViews.filter(function(v){ return v !== null && v !== undefined; }).length;
    } catch(e){}
    return {
      idx: idx, fileKey: fk, fileName: fn,
      strokes: _len('strokes'), dims: _len('dims'), images: _len('images'),
      savedViews: sv, hiddenLayers: _hs(),
      tx: _rnd(_num('tx')), ty: _rnd(_num('ty')),
      scale: _rnd(_num('scale')), fitScale: _rnd(_num('fitScale'))
    };
  }

  // ── 内部: State Diff ────────────────────────────────────────────────
  function _diff(before, after) {
    var LABELS = {
      idx: 'currentFileIdx', fileKey: 'fileKey', fileName: 'currentFileName',
      strokes: 'strokes', dims: 'dims', images: 'images',
      savedViews: 'savedViews(有効)', hiddenLayers: 'hiddenLayers.size',
      tx: 'tx', ty: 'ty', scale: 'scale', fitScale: 'fitScale'
    };
    var d = {};
    Object.keys(LABELS).forEach(function(k){
      if (before[k] !== after[k]) d[LABELS[k]] = { before: before[k], after: after[k] };
    });
    return d;
  }

  // ── 内部: ② オブジェクト参照キャプチャ（V4: cfStrokes/cfDims追加） ──
  function _captureRefs() {
    var idx = -1, cf = undefined;
    try { idx = (typeof currentFileIdx !== 'undefined') ? currentFileIdx : -1; } catch(e){}
    try { cf = (typeof openFiles !== 'undefined' && idx >= 0) ? openFiles[idx] : undefined; } catch(e){}
    return {
      currentFile  : cf,
      cfStrokes    : cf ? cf.strokes    : undefined,   // ② currentFile.strokes参照
      cfDims       : cf ? cf.dims       : undefined,   // ② currentFile.dims参照
      strokes      : (typeof strokes      !== 'undefined') ? strokes      : undefined,
      dims         : (typeof dims         !== 'undefined') ? dims         : undefined,
      images       : (typeof images       !== 'undefined') ? images       : undefined,
      savedViews   : (typeof savedViews   !== 'undefined') ? savedViews   : undefined,
      hiddenLayers : (typeof hiddenLayers !== 'undefined') ? hiddenLayers : undefined
    };
  }

  // ── 内部: ② Identity チェック（V4: cfStrokes/cfDims追加） ──────────
  function _checkIdentity(oldR, newR) {
    var warns = [];
    ['strokes','dims','images','savedViews','hiddenLayers',
     'currentFile','cfStrokes','cfDims'].forEach(function(k){
      if (oldR[k] !== undefined && newR[k] !== undefined && !Object.is(oldR[k], newR[k]))
        warns.push(k + ' reference changed');
    });
    return warns;
  }

  // ── ヘルパー ────────────────────────────────────────────────────────
  function _len(n) { try { var v=window[n]; return Array.isArray(v)?v.length:-1; } catch(e){ return -1; } }
  function _hs()   { try { var h=window.hiddenLayers; return (h instanceof Set)?h.size:-1; } catch(e){ return -1; } }
  function _num(n) { try { var v=window[n]; return (typeof v==='number')?v:null; } catch(e){ return null; } }
  function _rnd(v) { return (v!==null&&v!==undefined) ? Math.round(v*1000)/1000 : v; }
  function _push(e) { window.verifyLog.push(e); while(window.verifyLog.length>5000) window.verifyLog.shift(); }

  // ── 設定の永続化 ────────────────────────────────────────────────────
  function _loadSetting() { try { window.verifyMode = localStorage.getItem(_PERSIST_KEY)==='1'; } catch(e){} }
  function _saveSetting(on) { try { localStorage.setItem(_PERSIST_KEY, on?'1':'0'); } catch(e){} }

  // ── UI初期化 ────────────────────────────────────────────────────────
  function _initUI() {
    var chk    = document.getElementById('verifyModeChk');
    var expBtn = document.getElementById('exportVerifyLogBtn');
    if (chk) {
      chk.checked = window.verifyMode;
      chk.addEventListener('change', function () {
        window.verifyMode = chk.checked;
        _saveSetting(chk.checked);
        if (chk.checked) {
          window.verifyLog = [];
          _prev = null; _refs = null; _timers = {}; _opStates = {};
          _synDirty = false; _postSaveSnap = null;
          _frozen = false;
          _updateStatus(false);
          verify('verifyMode:ON');
        } else {
          if (_statusEl) _statusEl.style.display = 'none';
        }
      });
    }
    if (expBtn) expBtn.addEventListener('click', function(){ window.exportVerifyLog(); });

    var devSec = document.getElementById('devModeSection');
    if (devSec) {
      if (!document.getElementById('_vvStatusBadge')) {
        var badge = document.createElement('div');
        badge.id = '_vvStatusBadge';
        badge.style.display = 'none';
        devSec.appendChild(badge);
        _statusEl = badge;
        if (window.verifyMode) { badge.style.display = 'block'; _updateStatus(false); }
      }
      if (!document.getElementById('_verifyViewerBtn')) {
        var vBtn = document.createElement('button');
        vBtn.id = '_verifyViewerBtn';
        vBtn.className = 'sp-action-btn';
        vBtn.style.marginTop = '6px';
        vBtn.textContent = 'Verifyログ表示';
        vBtn.addEventListener('click', _showViewer);
        devSec.appendChild(vBtn);
      }
    }
    if (window.verifyMode && _statusEl) {
      _statusEl.style.display = 'block';
      _updateStatus(_frozen);
    }
  }

  // ── 初期化 ──────────────────────────────────────────────────────────
  _loadSetting();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initUI);
  } else {
    _initUI();
  }

})();
