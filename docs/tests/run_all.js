/* ============================================================
 * run_all.js —— 全量回归入口（一条命令跑完所有 vtest）
 *
 * 为什么有它：以前跑全量得在 PowerShell 里写一长串管道，在 cmd 里根本不成立
 * （Get-ChildItem 不是内部命令），而且输出几千行、真正失败的那几行被淹没。
 * 本脚本用 node 起子进程逐个跑 docs/tests/vtest_*.js，只打印「进度 + 失败清单 + 汇总」。
 *
 * 用法：cd docs/tests && node run_all.js
 *       node run_all.js --verbose   # 额外打印每个失败测试的最后 20 行输出
 * 退出码：全过 = 0，有失败 = 1（可直接接 CI / 预提交钩子）
 *
 * ⚠️ 两个必须有的保护（2026-09-10 踩过）：
 *  1. 每个测试**跑之前**就打印进度行 —— 否则整轮几分钟没有任何输出，看起来像卡死。
 *  2. 单个测试**超时熔断**（默认 90s）—— 有些 vtest 会留下 setInterval/socket 让
 *     node 进程不退出，spawnSync 会无限等下去（表现为「没反应」）。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VERBOSE = process.argv.indexOf('--verbose') >= 0;
const TIMEOUT_MS = Number((process.argv.find(a => /^--timeout=/.test(a)) || '').split('=')[1]) || 90000;
const files = fs.readdirSync(__dirname)
  .filter(f => /^vtest_.*\.js$/.test(f))
  .sort();

const pass = [];
const bad = [];
const times = [];   // { f, secs } —— 用来在汇总里点出「谁最慢」（322s 那种总耗时得先知道是谁拖的）
const t0 = Date.now();

console.log(`开始跑 ${files.length} 个测试（单个超时 ${Math.round(TIMEOUT_MS / 1000)}s，用 --verbose 看失败详情）\n`);

/* 进度用「单行原地刷新」（\r）而不是每个测试一行：
 *  - 终端里能实时看到在跑哪一个（不会像「跑完才打印」那样看着像卡死）
 *  - 总输出只剩一行 + 末尾汇总 → 用户复制粘贴时不会再被中间几十行挤掉结论
 * 需要逐行日志时加 --verbose。 */
files.forEach((f, idx) => {
  const label = `[${String(idx + 1).padStart(2)}/${files.length}] ${f}`;
  process.stdout.write('\r' + label.padEnd(46).slice(0, 46) + ' … ');
  const s = Date.now();
  const r = spawnSync(process.execPath, [f], {
    cwd: __dirname, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024
  });
  const secs = ((Date.now() - s) / 1000).toFixed(1);
  times.push({ f, secs: Number(secs) });
  const timedOut = !!(r.error && (r.error.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(String(r.error.message))));
  const out = ((r.stdout || '') + (r.stderr || '')).split('\n');
  const failLines = out.filter(l => /FAIL:/.test(l));

  if (timedOut) {
    bad.push({ f, failLines: ['超时未退出（>' + Math.round(TIMEOUT_MS / 1000) + 's，多半是残留的定时器/句柄）'], status: 'TIMEOUT', tail: out.slice(-20) });
    if (VERBOSE) process.stdout.write('\n'); 
  } else if (failLines.length === 0 && r.status === 0) {
    pass.push(f);
  } else {
    bad.push({ f, failLines, status: r.status, tail: out.slice(-20) });
  }
  if (VERBOSE) {
    const last = bad.length && bad[bad.length - 1].f === f;
    console.log('\r' + label.padEnd(46) + (last ? ' 失败 ✗ ' : ' ok   ') + secs + 's' + (last && failLines[0] ? '  ' + failLines[0].trim() : ''));
  }
});
process.stdout.write('\r' + ' '.repeat(60) + '\r'); // 清掉进度行

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
console.log(`全量回归：${pass.length} 通过 / ${bad.length} 失败（共 ${files.length} 个测试，总耗时 ${secs}s）`);
const slowest = times.slice().sort((a, b) => b.secs - a.secs).slice(0, 5);
if (slowest.length) {
  console.log('最慢的 5 个：' + slowest.map(t => `${t.f} ${t.secs}s`).join(' / ') + '（>5s 的多半有余留定时器没退出，值得单独看）');
}
if (bad.length) {
  console.log('');
  for (const b of bad) {
    console.log('  ✗ ' + b.f + ' :: ' + (b.failLines.length ? b.failLines[0].trim() : ('进程退出码 ' + b.status)));
    if (VERBOSE && b.failLines.length === 0) {
      console.log('    ---- 最后 20 行 ----');
      b.tail.forEach(l => console.log('    ' + l));
    }
  }
  console.log('');
  console.log('（已知存量红：vtest_bugfix=emoji 断言过期 / vtest_enemy_balance=蒙特卡洛 flaky）');
}
process.exit(bad.length ? 1 : 0);
