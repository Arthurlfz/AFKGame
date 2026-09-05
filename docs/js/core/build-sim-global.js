// 构建脚本：node build-sim-global.js
// 把 battle-sim.mjs（ESM）转成全局变量版 battle-sim.global.js（普通 <script> 可加载）。
// battle-sim.mjs 改动后重跑本脚本同步。
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'battle-sim.mjs');
const dst = path.join(__dirname, 'battle-sim.global.js');
let s = fs.readFileSync(src, 'utf8');
const names = ['simulateSession', 'simulateSessionScript', 'simulateFight', 'petStats', 'calcDamage', 'expFromBattle', 'mulberry32', 'pickWeighted', 'skillOf', 'getEquipBonuses', 'getBloodline', 'getAwakenState'];
const m = s.match(/export\s*\{[^}]+\}\s*;?/);
if (!m) { console.error('未找到 export 语句'); process.exit(1); }
s = s.replace(m[0], 'window.BattleSim = { ' + names.join(', ') + ' };');
s = '// ⚠️ 自动生成：由 battle-sim.mjs 转换（node build-sim-global.js）。改逻辑请改 battle-sim.mjs 后重跑本脚本。\n' + s;
fs.writeFileSync(dst, s, 'utf8');
console.log('OK:', dst, s.length, 'bytes');
