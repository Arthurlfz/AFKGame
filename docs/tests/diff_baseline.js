#!/usr/bin/env node
/* ============================================================
 * diff_baseline.js —— 回答一个问题：**这次改动有没有把测试搞红**
 *
 * 为什么需要它：本项目有 5 个稳定红 + 2 个 flaky，跑完一看「0 通过？不对，5 个失败」
 * 根本分不清是自己的锅还是存量。以前只能靠人记「基线是 70/75」，不可靠也没版本。
 *
 * 用法：
 *   cd docs/tests
 *   node diff_baseline.js --run      # 先跑一次全量，再跟基线对比（最常用 ≈ npm run check）
 *   node diff_baseline.js            # 不跑，只拿上一次 _current.json 对比
 *   node diff_baseline.js --save     # 跑完把当前结果**设为新基线**（只在确认过的健康状态用！）
 *
 * 退出码：有新搞红的 = 1（可接 CI）；没有 = 0
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const RUN = argv.includes('--run');
const SAVE = argv.includes('--save');

const BASE_FILE = path.join(__dirname, 'baseline.json');
const CUR_FILE = path.join(__dirname, '_current.json');

/* ⚠️ SAVE 模式不能要求基线已存在 —— 那是「从无到有」建基线，
 * 一上来就校验存在性是自锁：第一次永远建不起来（2026-09-13 当场踩到）。 */
if (!SAVE && !fs.existsSync(BASE_FILE)) {
  console.error('❌ 没有基线文件 baseline.json。先跑一次并确认状态健康，再执行：');
  console.error('   cd docs/tests && node diff_baseline.js --save');
  process.exit(2);
}

if (RUN || SAVE) {
  console.log('先跑一次全量回归（约 2~3 分钟，中途有进度行）…\n');
  const r = spawnSync(process.execPath, ['run_all.js', '--json=_current.json'], {
    cwd: __dirname, stdio: 'inherit', timeout: 900000
  });
  if (r.error) { console.error('跑测试本身失败了：' + r.error.message); process.exit(2); }
  // 注意：run_all 有失败会 exit 1，这是正常的，不许在这里中断 —— 下面靠 JSON 对比说话。
}

if (!fs.existsSync(CUR_FILE)) {
  console.error('❌ 没有 _current.json。加 --run 让我先跑一次。');
  process.exit(2);
}

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const cur = read(CUR_FILE);

/* ⚠️ SAVE 分支必须排在「读 baseline」之前：第一次建基线时那个文件还不存在。
 * 同理上面那句存在性校验也只能用 !SAVE 限定。别把这两处顺序再挪回去。 */
if (SAVE) {
  fs.copyFileSync(CUR_FILE, BASE_FILE);
  console.log('\n✅ 已把当前状态设为新基线：' + cur.pass + ' 通过 / ' + cur.fail + ' 失败（共 ' + cur.total + '）');
  console.log('   ⚠️ 只在**确认过的健康状态** save —— 基线一旦被污染，后面所有对比都失去意义。');
  process.exit(0);
}

const base = read(BASE_FILE);

const set = arr => new Set(arr);
const inB = set(base.failed);
const inC = set(cur.failed);

const newlyRed = cur.failed.filter(f => !inB.has(f));
const fixed = base.failed.filter(f => !inC.has(f));
const stillRed = cur.failed.filter(f => inB.has(f));

console.log('\n──────── 回归对比 ────────');
console.log('基线 ' + new Date(base.date).toLocaleString('zh-CN') + '：' + base.pass + ' 通过 / ' + base.fail + ' 失败');
console.log('本次 ' + new Date(cur.date).toLocaleString('zh-CN') + '：' + cur.pass + ' 通过 / ' + cur.fail + ' 失败');
console.log('');

if (stillRed.length) {
  console.log('· 存量红 ' + stillRed.length + ' 个（不是你的锅，别去修）：');
  stillRed.forEach(f => console.log('    ' + f));
}
if (fixed.length) {
  console.log('· ✅ 修好了 ' + fixed.length + ' 个：');
  fixed.forEach(f => console.log('    ' + f));
}
console.log('');

if (newlyRed.length === 0) {
  console.log('✅ **没有新搞红的测试。**');
  process.exit(0);
} else {
  console.log('🔴 **新红了 ' + newlyRed.length + ' 个 —— 多半就是这次改动弄的：**');
  newlyRed.forEach(f => console.log('    ✗ ' + f));
  console.log('');
  console.log('   看详情：cd docs/tests && node run_all.js --verbose');
  console.log('   ⚠️ 先看清楚是不是 flaky（' + 'enemy_balance / botbuy' + ' 会时红时绿）——');
  console.log('      把那一个单独跑 3~4 次，全绿才算真回归。');
  process.exit(1);
}
