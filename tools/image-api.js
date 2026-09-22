/* ============================================================
 * image-api.js —— 调用「第三方生图 API 中转站」（nano-banana / gpt-image 这类）
 * 零依赖（Node 内置 fetch），只负责：列模型 / 生图 / 存文件
 *
 * 用法：
 *   node tools/image-api.js models
 *   node tools/image-api.js gen --model <模型id> --prompt "画面描述" [--size 1024x1024] [--out 输出.png]
 *   node tools/image-api.js raw  --model <模型id> --prompt "..."      # 打印完整响应，排查用
 *
 * 配置（写进【项目根目录的 .env】，不要贴到聊天里）：
 *   IMAGE_API_BASE=https://你的中转站域名/v1        # 末尾带不带 /v1 都行，脚本会自己补
 *   IMAGE_API_KEY=sk-xxxxxxxx
 *   # 已有的 MEOWART_API_KEY 是另一套（meowa skill 用），互不影响
 *
 * ⚠️ key 一律只放本地 .env（已被 .gitignore 忽略），不要出现在命令行参数里
 * ============================================================ */
const fs = require('fs');
const path = require('path');

/* ---------- 读项目根 .env ---------- */
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const ENV = Object.assign({}, loadEnv(), process.env);

const BASE_RAW = ENV.IMAGE_API_BASE || ENV.IMAGE_BASE_URL || '';
const KEY = ENV.IMAGE_API_KEY || ENV.IMAGE_KEY || '';
const BASE = BASE_RAW.replace(/\/+$/, '').replace(/\/v1$/, '');   // 统一去掉末尾 /v1，用时再加

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const CMD = argv[0];
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const MODEL = arg('model');
const PROMPT = arg('prompt');
const SIZE = arg('size', '1024x1024');

if (!CMD || ['-h', '--help', 'help'].includes(CMD)) {
  console.log([
    '用法：',
    '  node tools/image-api.js models',
    '  node tools/image-api.js gen --model <模型id> --prompt "画面描述" [--size 1024x1024] [--out 输出.png]',
    '  node tools/image-api.js raw --model <模型id> --prompt "..."     # 打印完整响应，排查用',
    '',
    '配置（写进项目根 .env，别贴聊天里）：',
    '  IMAGE_API_BASE=https://你的中转站域名/v1',
    '  IMAGE_API_KEY=sk-xxxxxxxx',
    '',
    '建议顺序：先 models 看模型叫什么 → 再 gen 出图'
  ].join('\n'));
  process.exit(0);
}
if (!BASE_RAW) {
  console.error('❌ 还没配地址。请在项目根的 .env 里加一行：\n   IMAGE_API_BASE=https://你的中转站域名/v1');
  process.exit(1);
}
if (!KEY) {
  console.error('❌ 还没配 key。请在项目根的 .env 里加一行：\n   IMAGE_API_KEY=sk-xxxx\n（key 只放 .env，别贴到聊天或命令行里）');
  process.exit(1);
}
const H = { Authorization: 'Bearer ' + KEY };

/* ---------- 列模型：自动发现 banana / img 这些到底叫什么 ---------- */
async function models() {
  const url = BASE + '/v1/models';
  console.log('GET ' + url);
  let r, text;
  try { r = await fetch(url, { headers: H }); text = await r.text(); }
  catch (e) { console.error('❌ 连不上：' + e.message + '\n   检查 IMAGE_API_BASE 拼写、以及这个站是否只支持 https'); process.exit(1); }
  if (!r.ok) { console.error(`❌ HTTP ${r.status}\n${text.slice(0, 600)}`); process.exit(1); }
  let data;
  try { data = JSON.parse(text); } catch (e) { console.error('❌ 返回的不是 JSON：\n' + text.slice(0, 600)); process.exit(1); }
  const list = (data.data || data.models || data || []);
  if (!Array.isArray(list)) { console.log('响应结构不常见，原样打印：\n' + text.slice(0, 2000)); return; }
  const ids = list.map(m => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
  console.log(`共 ${ids.length} 个模型：\n`);
  ids.forEach(id => console.log('  ' + id));
  const guess = ids.filter(id => /banana|image|img|dall|flux|sd[0-9x]|nano/i.test(id));
  if (guess.length) {
    console.log('\n⭐ 看起来能生图的：');
    guess.forEach(id => console.log('  ' + id));
    console.log('\n下一步：node tools/image-api.js gen --model <上面某个id> --prompt "画面描述" --out test.png');
  }
}

/* ---------- 生图 ---------- */
async function gen(showRaw) {
  if (!MODEL || !PROMPT) { console.error('需要 --model 和 --prompt，先跑 models 看看有哪些模型'); process.exit(1); }
  const url = BASE + '/v1/images/generations';
  const body = { model: MODEL, prompt: PROMPT, n: 1, size: SIZE };
  console.log('POST ' + url);
  console.log('model=' + MODEL + '  size=' + SIZE);
  let r, text;
  try {
    r = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(body) });
    text = await r.text();
  } catch (e) { console.error('❌ 请求失败：' + e.message); process.exit(1); }
  if (showRaw) console.log('\n--- 原始响应 ---\n' + text.slice(0, 3000) + '\n---');
  if (!r.ok) {
    console.error(`❌ HTTP ${r.status}\n${text.slice(0, 1500)}`);
    console.error('\n排查提示：\n · 404 → 这个站可能不是 /v1/images/generations，改用 models 看看它支持什么，或把地址换成它的文档给的完整路径\n · 400 且提到 model → 模型名不对，跑 models 看准确 id\n · 401/403 → key 不对');
    process.exit(1);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { console.error('❌ 返回的不是 JSON（可能是图片流），用 raw 模式看看'); process.exit(1); }
  const item = (data.data && data.data[0]) || data;
  const out = arg('out', 'image-api-out.png');
  const outPath = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
  if (item.b64_json) {
    fs.writeFileSync(outPath, Buffer.from(item.b64_json, 'base64'));
  } else if (item.url) {
    const ir = await fetch(item.url);
    if (!ir.ok) { console.error('❌ 下载图片失败 HTTP ' + ir.status + '\n' + item.url); process.exit(1); }
    fs.writeFileSync(outPath, Buffer.from(await ir.arrayBuffer()));
  } else {
    console.error('❌ 响应里既没有 b64_json 也没有 url。用 raw 模式看完整结构：');
    console.error(text.slice(0, 1500));
    process.exit(1);
  }
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`\n✅ 已保存 ${outPath}  (${kb}KB)`);
  // 顺手报尺寸/透明通道：重做宠物素材时"有没有透明底"是硬要求
  try {
    const b = fs.readFileSync(outPath);
    if (b.readUInt32BE(0) === 0x89504e47) {
      console.log(`   尺寸 ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}，颜色类型 ${b[25]}`
        + (b[25] === 6 ? '（RGBA，带透明通道 ✅）' : '（无透明通道 ⚠️ 宠物素材需要 RGBA）'));
    } else {
      console.log('   ⚠️ 不是 PNG（可能是 jpg/webp）—— 宠物素材需要透明底 PNG');
    }
  } catch (e) {}
}

(async () => {
  if (CMD === 'models') await models();
  else if (CMD === 'gen') await gen(false);
  else if (CMD === 'raw') await gen(true);
  else { console.error('未知命令：' + CMD + '（可用：models / gen / raw）'); process.exit(1); }
})();
