/* ============================================================
 * canvas-cli.js —— 直接跟本机「无限画布」canvas-agent 的 MCP 口子说话
 *
 * 背景：画布网页（downstream.jbbtoken.cn）通过 Local URL + Connect token 连本机
 *       那个常驻 canvas-agent；而 AI 这边要用的是它的【MCP 口子】。
 *       本脚本就是最小的 MCP 客户端：拉起 agent 的 mcp 子进程 → 握手 → 调工具。
 *
 * 用法（在项目根跑）：
 *   node tools/canvas-cli.js list                      # 列出画布工具
 *   node tools/canvas-cli.js call canvas_get_state      # 读画布节点/连线/选区摘要
 *   node tools/canvas-cli.js call canvas_apply_ops '{"ops":[...]}'
 *
 * 前置：本机有一个常驻的 canvas-agent（`npx -y @basketikun/canvas-agent@latest`），
 *       且画布网页已经连上它（Local URL + Connect token）。
 * ============================================================ */
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PKG = '@basketikun/canvas-agent@latest';
const mode = process.argv[2] || 'list';
const toolName = process.argv[3];
const toolArgs = process.argv[4] || '{}';

/* 找 canvas-agent 的入口 js：
 * ⚠️ 不能用 `npx -y @xxx@latest`——本机已经常驻一个 agent 实例，
 *    npx 会把同一个 _npx 缓存目录重新 reify，撞上实例占用中的 codex.exe 报 EBUSY。
 *    所以优先直接用【已经装好的那份】跑，找不到才退回 npx。
 * 需要指定时用环境变量 CANVAS_AGENT_JS=<dist/index.js 的绝对路径>。 */
function findAgentJs() {
  if (process.env.CANVAS_AGENT_JS && fs.existsSync(process.env.CANVAS_AGENT_JS)) return process.env.CANVAS_AGENT_JS;
  let cache = '';
  try { cache = execSync('npm config get cache', { encoding: 'utf8' }).trim(); } catch (_) {}
  const roots = [cache, path.join(process.env.LOCALAPPDATA || '', 'npm-cache')].filter(Boolean);
  const hits = [];
  for (const r of roots) {
    const npxDir = path.join(r, '_npx');
    if (!fs.existsSync(npxDir)) continue;
    for (const d of fs.readdirSync(npxDir)) {
      const p = path.join(npxDir, d, 'node_modules', '@basketikun', 'canvas-agent', 'dist', 'index.js');
      if (fs.existsSync(p)) hits.push({ p, t: fs.statSync(p).mtimeMs });
    }
  }
  hits.sort((a, b) => b.t - a.t);
  return hits.length ? hits[0].p : '';
}

function die(msg) { console.error(msg); process.exit(1); }

let parsedArgs = {};
if (mode === 'call') {
  if (!toolName) die('用法：node tools/canvas-cli.js call <工具名> [\'{"参数":...}\']');
  try { parsedArgs = toolArgs.trim() ? JSON.parse(toolArgs) : {}; }
  catch (e) { die('参数不是合法 JSON：' + e.message); }
}

/* Windows 上 npx 是 .cmd，用 shell 拉起最省事；stderr 直接透传，方便看 agent 的报错 */
const agentJs = findAgentJs();
const child = agentJs
  ? spawn(process.execPath, [agentJs, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
  : spawn('npx', ['-y', PKG, 'mcp'], { shell: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
if (process.env.CANVAS_CLI_VERBOSE) console.error('[canvas-cli] agent =', agentJs || 'npx ' + PKG);

child.stderr.on('data', (b) => process.stderr.write(b));

let buf = '';
let done = false;
const pending = new Map();

function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }

function finish(ok, text) {
  if (done) return;
  done = true;
  console.log(text);
  try { child.kill(); } catch (_) {}
  process.exit(ok ? 0 : 1);
}

child.stdout.on('data', (b) => {
  buf += b.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg); }
  }
});

function request(id, method, params) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

const TIMEOUT_MS = 120000;
const timer = setTimeout(() => finish(false, '✖ 超时：agent 没回话（检查 npx 能不能跑、是否已有实例占着）'), TIMEOUT_MS);
timer.unref && timer.unref();

(async () => {
  const init = await request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'canvas-cli', version: '1.0' }
  });
  if (init.error) return finish(false, '✖ initialize 失败：' + JSON.stringify(init.error));
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  if (mode === 'list') {
    const res = await request(2, 'tools/list', {});
    if (res.error) return finish(false, '✖ tools/list 失败：' + JSON.stringify(res.error));
    const tools = (res.result && res.result.tools) || [];
    const lines = tools.map((t) => {
      const desc = (t.description || '').split('\n')[0].slice(0, 90);
      return '  - ' + t.name + (desc ? '  — ' + desc : '');
    });
    return finish(true, '画布可用工具（' + tools.length + ' 个）：\n' + lines.join('\n'));
  }

  if (mode === 'schema') {
    if (!toolName) return finish(false, '用法：node tools/canvas-cli.js schema <工具名>');
    const res = await request(2, 'tools/list', {});
    if (res.error) return finish(false, '✖ tools/list 失败：' + JSON.stringify(res.error));
    const t = ((res.result && res.result.tools) || []).find((x) => x.name === toolName);
    if (!t) return finish(false, '✖ 没有这个工具：' + toolName + '（先跑 list 看看）');
    return finish(true, t.name + ' — ' + (t.description || '') + '\n\n入参 schema:\n' + JSON.stringify(t.inputSchema || {}, null, 2));
  }

  if (mode === 'call') {
    const res = await request(3, 'tools/call', { name: toolName, arguments: parsedArgs });
    if (res.error) return finish(false, '✖ 调用失败：' + JSON.stringify(res.error, null, 2));
    const content = (res.result && res.result.content) || [];
    const text = content.map((c) => (c.type === 'text' ? c.text : '[' + c.type + ']')).join('\n');
    return finish(!(res.result && res.result.isError), text || JSON.stringify(res.result, null, 2));
  }

  finish(false, '未知模式：' + mode + '（可用：list / call）');
})();
