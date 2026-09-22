/* ============================================================
 * 本地静态服务器（开发/试玩用）
 * 用法：node tools/serve.js [端口]        默认 8030，根目录 = docs/
 *
 * 🔴 为什么不用 `python -m http.server`：
 *    它是【单线程】的（一次只处理一个请求，连接排队上限约 5 个），而游戏页要拉
 *    143 个 js/css + 几百张图。浏览器缓存里已有全套时它撑得住，但【换端口 / 强刷清缓存】
 *    后一次性全量拉，会把它击穿 —— 实测并发拉 143 个资源有 46 个直接 ECONNREFUSED。
 *    表现是"部分 JS/CSS 没加载"，看起来像各种莫名其妙的 bug
 *    （2026-09-21：用户换端口后同时出现"挂机不跑 + 立绘动画不播"）。
 *    Node 的 http 天生异步并发，零依赖，直接用。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.argv[2]) || 8030;
const OPEN = process.argv.includes('--open');
const ROOT = path.join(__dirname, '..', 'docs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(url.parse(req.url).pathname); }
  catch (e) { res.writeHead(400).end('bad url'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // 目录穿越防护：解析后必须仍在 ROOT 之内
  const file = path.resolve(ROOT, '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + pathname); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      // 本地开发不做缓存：改了文件刷新即生效，不用靠 ?v= 猜缓存
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(file).pipe(res).on('error', () => res.end());
  });
});

let want = PORT;   // ⚠️ 必须用会递增的变量：写死 PORT+1 的话，连续两次被占会一直重试同一个端口（死循环）
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && want < PORT + 10) {
    // 端口被占（常见：早先起的 python http.server 还在）→ 自动顺延，别让用户去猜
    want += 1;
    console.warn(`端口 ${want - 1} 已被占用，改用 ${want}`);
    server.listen(want);
    return;
  }
  console.error(e.code === 'EADDRINUSE'
    ? `端口 ${PORT}~${PORT + 9} 都被占用了，先关掉多余的服务器再启动。`
    : e);
  process.exit(1);
});
server.on('listening', () => {
  const port = server.address().port;
  const url = `http://localhost:${port}/%E6%B8%B8%E6%88%8F.html`;
  console.log(`已启动：http://localhost:${port}/游戏.html  （根目录 ${ROOT}）`);
  console.log('这个服务器是并发的，且关掉了缓存：改完文件直接刷新就生效，不用管 ?v=。');
  if (OPEN) require('child_process').exec(`start "" "${url}"`);
});
server.listen(PORT);
