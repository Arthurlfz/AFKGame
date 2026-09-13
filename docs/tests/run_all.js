/* ============================================================
 * run_all.js —— 全量回归入口（并发跑完所有 vtest）
 *
 * 为什么有它：以前跑全量得在 PowerShell 里写一长串管道，在 cmd 里根本不成立
 * （Get-ChildItem 不是内部命令），而且输出几千行、真正失败的那几行被淹没。
 * 本脚本用 node 起子进程跑 docs/tests/vtest_*.js，只打印「进度 + 失败清单 + 汇总」。
 *
 * 用法：cd docs/tests && node run_all.js
 *       node run_all.js --verbose      # 额外打印每个测试的结果与耗时
 *       node run_all.js --jobs=4       # 调并发数（默认 6）
 * 退出码：全过 = 0，有失败 = 1（可直接接 CI / 预提交钩子）
 *
 * ⚠️ 两个必须有的保护（2026-09-10 踩过）：
 *  1. 每个测试**跑之前**就打印进度行 —— 否则整轮几分钟没有任何输出，看起来像卡死。
 *  2. 单个测试**超时熔断**（默认 90s）—— 有些 vtest 会留下 setInterval/socket 让
 *     node 进程不退出，会无限等下去（表现为「没反应」）。
 *
 * ===== 2026-09-13：串行改并发 =====
 * 背景：76 个测试串行要 158s，用户问「为什么每次都要这么久」。拆开看：
 *   · 约 71% 是 4 个「必须真等时间」的测试（vtest_fun 直接 sleep 60s 模拟挂机一分钟，
 *     enemy_level / newbie / deep 也在等战斗一场场打完才能采样）—— 这部分省不掉，
 *     但可以**让别人跟它一起等**，而不是排队。
 *   · 剩下 71 个每个约 0.6s，几乎全是「起 node 进程 + 重新读一遍游戏代码」的冷启动。
 * 结论：并发 6 → 墙钟由「最慢那条链」决定，而不是所有耗时之和。
 *
 * ⚠️ 并发是安全的前提（已全仓扫过，别想当然）：
 *   · vtest_*.js 里**没有任何** supabase.co / fetch( / SUPABASE_URL —— 全部走 vstub 桩，
 *     所以并发既不会互相限流，也不会互相串数据。
 *   · 每个测试一个独立子进程，不共享内存/文件（--json 只在汇总时由本进程写一次）。
 * 结果按 files 原顺序汇总（不是完成顺序）→ 输出稳定，不会因为调度抖动而变。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VERBOSE = process.argv.indexOf('--verbose') >= 0;
const TIMEOUT_MS = Number((process.argv.find(a => /^--timeout=/.test(a)) || '').split('=')[1]) || 90000;
const JOBS = Math.max(1, Math.min(16, Number((process.argv.find(a => /^--jobs=/.test(a)) || '').split('=')[1]) || 6));
const files = fs.readdirSync(__dirname)
  .filter(f => /^vtest_.*\.js$/.test(f))
  .sort();

/* 跑一个测试：子进程输出全部 pipe 回来（diff_baseline 靠 --json 读结果，
 * 所以不能 stdio:'inherit'，否则这里拿不到 FAIL 行）。 */
function runOne(f) {
  return new Promise(resolve => {
    const s = Date.now();
    let out = '';
    let timedOut = false;
    const child = spawn(process.execPath, [f], { cwd: __dirname });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (e) { /* 已经退出了就算了 */ }
    }, TIMEOUT_MS);
    child.stdout && child.stdout.setEncoding && child.stdout.setEncoding('utf8');
    child.stderr && child.stderr.setEncoding && child.stderr.setEncoding('utf8');
    if (child.stdout) child.stdout.on('data', d => { out += d; });
    if (child.stderr) child.stderr.on('data', d => { out += d; });
    const finish = code => {
      clearTimeout(timer);
      resolve({ f, out, code, timedOut, secs: Number(((Date.now() - s) / 1000).toFixed(1)) });
    };
    child.on('close', finish);
    child.on('error', () => finish(-1));
  });
}

(async () => {
  const t0 = Date.now();
  console.log(`开始跑 ${files.length} 个测试（并发 ${JOBS}，单个超时 ${Math.round(TIMEOUT_MS / 1000)}s，用 --verbose 看失败详情）\n`);

  const results = new Array(files.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const r = await runOne(files[i]);
      results[i] = r;
      done++;
      process.stdout.write('\r' + `已完成 ${done}/${files.length}（${JOBS} 并发）`.padEnd(46).slice(0, 46) + ' … ');
      if (VERBOSE) {
        const failLines = r.out.split('\n').filter(l => /FAIL:/.test(l));
        const ok = !r.timedOut && failLines.length === 0 && r.code === 0;
        process.stdout.write('\r' + ' '.repeat(52) + '\r');
        console.log(String(r.f).padEnd(46) + (r.timedOut ? ' 超时 ✗ ' : (ok ? ' ok   ' : ' 失败 ✗ ')) + r.secs + 's');
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, files.length) }, worker));
  process.stdout.write('\r' + ' '.repeat(60) + '\r'); // 清掉进度行

  // 按 files 原顺序汇总 → 输出稳定
  const pass = [];
  const bad = [];
  for (const r of results) {
    const lines = (r.out || '').split('\n');
    const failLines = lines.filter(l => /FAIL:/.test(l));
    if (r.timedOut) {
      bad.push({ f: r.f, failLines: ['超时未退出（>' + Math.round(TIMEOUT_MS / 1000) + 's，多半是残留的定时器/句柄）'], status: 'TIMEOUT', tail: lines.slice(-20) });
    } else if (failLines.length === 0 && r.code === 0) {
      pass.push(r.f);
    } else {
      bad.push({ f: r.f, failLines, status: r.code, tail: lines.slice(-20) });
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`全量回归：${pass.length} 通过 / ${bad.length} 失败（共 ${files.length} 个测试，并发 ${JOBS}，墙钟 ${secs}s）`);
  const slowest = results.slice().sort((a, b) => b.secs - a.secs).slice(0, 5);
  if (slowest.length) {
    console.log('最慢的 5 个：' + slowest.map(t => `${t.f} ${t.secs}s`).join(' / ') + '（>5s 的多半在等真实时间，或有余留定时器）');
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
  /* 2026-09-13 加：可选的结果落盘（给基线对比 / CI 用）。
   * ⚠️ 不传 --json 时行为与以前完全一致，老习惯不受影响。
   * 为什么放在这里而不是另写一个 collect 脚本：另写就等于把「怎么判定失败」复制第二份，
   * 而同一份逻辑复制两份、只有一份对，正是本项目审计出来的头号病因。 */
  const jsonArg = (process.argv.find(a => /^--json=/.test(a)) || '').split('=')[1];
  if (jsonArg) {
    const payload = {
      date: new Date().toISOString(),
      total: files.length,
      pass: pass.length,
      fail: bad.length,
      secs: Number(secs),
      failed: bad.map(b => b.f).sort(),
      passed: pass.slice().sort()
    };
    fs.writeFileSync(path.resolve(__dirname, jsonArg), JSON.stringify(payload, null, 2), 'utf8');
    console.log('结果 JSON 已写入 ' + jsonArg);
  }
  process.exit(bad.length ? 1 : 0);
})();
