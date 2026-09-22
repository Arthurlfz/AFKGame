// 构建脚本：node build-sim-global.js
// 把 battle-sim.mjs（ESM）转成全局变量版 battle-sim.global.js（普通 <script> 可加载）。
// battle-sim.mjs 改动后重跑本脚本同步。
//
// ⚠️ 2026-09-23 改：导出名单**从 export 语句自动推导**，不再手写。
//   旧写法是手抄一份 names 数组 —— 结果必然漂移（实测已漏：rollBoss / resolveLineId /
//   godDefOf / getBaseSpeed / getStatCoeff / getMechCoeff 都没暴露到 window.BattleSim）。
//   这正是项目红线里说的"同一件事两处实现"。
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'battle-sim.mjs');
const dst = path.join(__dirname, 'battle-sim.global.js');
let s = fs.readFileSync(src, 'utf8');
const m = s.match(/export\s*\{([^}]+)\}\s*;?/);
if (!m) { console.error('未找到 export 语句'); process.exit(1); }
const names = m[1].split(',').map(x => x.trim()).filter(Boolean);
s = s.replace(m[0], 'window.BattleSim = { ' + names.join(', ') + ' };');
s = '// ⚠️ 自动生成：由 battle-sim.mjs 转换（node build-sim-global.js）。改逻辑请改 battle-sim.mjs 后重跑本脚本。\n' + s;
fs.writeFileSync(dst, s, 'utf8');
console.log('OK:', dst, s.length, 'bytes', '（导出 ' + names.length + ' 项）');
