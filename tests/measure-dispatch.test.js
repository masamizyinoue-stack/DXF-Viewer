// measure-dispatch.test.js
// V3_04で追加した「計測系状態機械(IPX/DIM/LP/LL/LLEN/ANG)の一元ディスパッチ」の回帰テスト。
//
// 背景: 分析レポート(2026-09-21)で指摘された改善点1「サブ窓の構造的な保守負債」への対応として、
// tool.js/index.htmlの15箇所以上に重複していたIPX/DIM/LP/LL/LLEN/ANGのactive判定→handleDown/Move/Up
// 呼び出しチェーンを、tool.js内の以下6関数に一本化した(V3_04):
//   MEASURE_TOOL_NAMES, _activeMeasureTool, _isAnyMeasureActive, _isAnyMeasurePhaseActive,
//   _dispatchMeasureDown/Move/Up
// このテストはそれら一元化ロジックが従来のif/elseチェーンと同じ優先順位・同じ呼び分けを
// 行うことを保証する。新しい計測系ツールをMEASURE_TOOL_NAMESに追加した際は、このテストの
// TOOL_NAMES配列にも追加して再実行すること。
//
// 実行方法: node tests/measure-dispatch.test.js
// (ブラウザDOM/canvasは使わない純粋ロジックテストのため、Node単体で高速に実行できる。
//  実機/iPadでのペン・タッチ操作そのものの検証は別途、手動またはiPad実機での確認が必要。)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOL_JS = fs.readFileSync(path.join(__dirname, '..', 'tool.js'), 'utf-8');

// tool.js冒頭の一元化ブロック(MEASURE_TOOL_NAMES〜_dispatchMeasureUpまで)だけを抜き出して
// 評価する。DOM(ov/document等)に依存しない自己完結したロジックのため、この部分だけを
// 取り出して純粋にテストできる。
const startMarker = "var MEASURE_TOOL_NAMES=";
const endMarker = "function _dispatchMeasureUp(sx,sy){";
const startIdx = TOOL_JS.indexOf(startMarker);
const endLineIdx = TOOL_JS.indexOf('\n', TOOL_JS.indexOf(endMarker));
if (startIdx < 0 || endLineIdx < 0) {
  console.error('FAIL: tool.js内に一元化ブロック(MEASURE_TOOL_NAMES.._dispatchMeasureUp)が見つかりません。' +
    'リファクタリングで関数名が変わった場合はこのテストのマーカーも更新してください。');
  process.exit(1);
}
const block = TOOL_JS.slice(startIdx, endLineIdx + 1);

let failed = 0, passed = 0;
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failed++;
  } else {
    passed++;
  }
}

function makeTool(name, phase) {
  const calls = [];
  return {
    name,
    active: true,
    phase: phase || 0,
    handleDown: (x, y) => calls.push(['down', x, y]),
    handleMove: (x, y) => calls.push(['move', x, y]),
    handleUp: (x, y) => calls.push(['up', x, y]),
    _calls: calls,
  };
}

function runCase(activeNames, phaseMap) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);

  const TOOL_NAMES = ['IPX', 'DIM', 'LP', 'LL', 'LLEN', 'ANG']; // MEASURE_TOOL_NAMESと同じ優先順位
  const tools = {};
  for (const n of TOOL_NAMES) {
    if (activeNames.includes(n)) {
      tools[n] = makeTool(n, phaseMap && phaseMap[n]);
      sandbox.window[n] = tools[n];
    } else {
      sandbox.window[n] = { active: false };
    }
  }
  return { sandbox, tools };
}

// ケース1: 何もアクティブでない -> どのdispatchもfalseを返し、何も呼ばれない
{
  const { sandbox } = runCase([]);
  assertEq(sandbox._isAnyMeasureActive(), false, '無アクティブ時: _isAnyMeasureActive=false');
  assertEq(sandbox._dispatchMeasureDown(1, 2), false, '無アクティブ時: _dispatchMeasureDownはfalseを返す');
}

// ケース2: DIMのみアクティブ -> DIMへdown/move/upが委譲される
{
  const { sandbox, tools } = runCase(['DIM']);
  assertEq(sandbox._dispatchMeasureDown(10, 20), true, 'DIMのみ: _dispatchMeasureDownはtrue');
  assertEq(tools.DIM._calls, [['down', 10, 20]], 'DIMのみ: DIM.handleDownが呼ばれる');
  sandbox._dispatchMeasureMove(11, 21);
  sandbox._dispatchMeasureUp(12, 22);
  assertEq(tools.DIM._calls, [['down', 10, 20], ['move', 11, 21], ['up', 12, 22]], 'DIMのみ: move/upもDIMへ');
}

// ケース3: LP/LL/LLEN/ANG それぞれ単独でも正しく委譲される(旧コードのtouchmove finger-draw分岐は
// DIM/LPしか見ておらずLL/LLEN/ANGが漏れていた実バグがあったため、特にここを重点確認)
for (const name of ['LP', 'LL', 'LLEN', 'ANG']) {
  const { sandbox, tools } = runCase([name]);
  assertEq(sandbox._dispatchMeasureDown(1, 1), true, `${name}のみ: _dispatchMeasureDownはtrue`);
  assertEq(tools[name]._calls, [['down', 1, 1]], `${name}のみ: ${name}.handleDownが呼ばれる(旧コードで漏れていた箇所)`);
}

// ケース4: IPXが他の計測ツール(例: DIM)と同時にアクティブな場合、IPXが最優先される
// (「2線間の交点」ボタンは他の計測ツールの点供給として使われるため、常にIPXが勝つ必要がある)
{
  const { sandbox, tools } = runCase(['DIM', 'IPX']);
  sandbox._dispatchMeasureDown(5, 5);
  assertEq(tools.IPX._calls, [['down', 5, 5]], 'IPX+DIM同時: IPXが優先して呼ばれる');
  assertEq(tools.DIM._calls, [], 'IPX+DIM同時: DIMは呼ばれない');
}

// ケース5: _isAnyMeasurePhaseActive はphase>0の時だけtrue(ダブルタップ全体表示の誤爆防止に使用)
{
  const { sandbox } = runCase(['LL'], { LL: 0 });
  assertEq(sandbox._isAnyMeasurePhaseActive(), false, 'LL phase=0: _isAnyMeasurePhaseActiveはfalse');
}
{
  const { sandbox } = runCase(['LL'], { LL: 1 });
  assertEq(sandbox._isAnyMeasurePhaseActive(), true, 'LL phase=1: _isAnyMeasurePhaseActiveはtrue');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
