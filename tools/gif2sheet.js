/* ============================================================
 * gif2sheet.js —— 把 GIF 动画转成 spritesheet（并分析每一帧）
 * 用法：
 *   node tools/gif2sheet.js <输入.gif> --info          只看分析，不输出
 *   node tools/gif2sheet.js <输入.gif> <输出.png> [边距%] [去底色#RRGGBB]
 *
 * 🔴 为什么需要它（2026-09-21 血月神狐）：
 *   手上那张 6144×256 的 spritesheet 是【连续画面被等分成 24 格】，
 *   每格里只有狐的一段（尾巴被切断 + 邻格的半截漏进来），缩放留白救不了。
 *   而同源的 24 帧 GIF 才是"24 张独立的画" —— 需要把它拆成真正的帧。
 *
 * 纯 Node，零依赖：自带 GIF（含 LZW）解码与 PNG 编码。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- GIF 解码 ---------------- */
function decodeGIF(file) {
  const b = fs.readFileSync(file);
  if (b.slice(0, 3).toString('ascii') !== 'GIF') throw new Error('不是 GIF');
  const W = b.readUInt16LE(6), H = b.readUInt16LE(8);
  const packed = b[10], bgIndex = b[11];
  let p = 13;
  let gct = null;
  if (packed & 0x80) {
    const n = 1 << ((packed & 7) + 1);
    gct = Buffer.alloc(n * 3); b.copy(gct, 0, p, p + n * 3); p += n * 3;
  }
  const frames = [];
  let pending = null;
  while (p < b.length) {
    const blk = b[p];
    if (blk === 0x3B) break;
    if (blk === 0x21) {
      const label = b[p + 1];
      let q = p + 2;
      if (label === 0xF9) {                       // 图形控制：透明索引 / 延时 / 处置方式
        const sz = b[q];
        const pk = b[q + 1];
        pending = { transparent: (pk & 1) ? b[q + 3] : -1, disposal: (pk >> 2) & 7, delay: b.readUInt16LE(q + 2) };
        q += 1 + sz;
      }
      while (q < b.length && b[q] !== 0) q += b[q] + 1;
      p = q + 1;
    } else if (blk === 0x2C) {                     // 图像描述符 = 一帧
      const left = b.readUInt16LE(p + 1), top = b.readUInt16LE(p + 3);
      const fw = b.readUInt16LE(p + 5), fh = b.readUInt16LE(p + 7);
      const lp = b[p + 9];
      let q = p + 10, pal = gct;
      if (lp & 0x80) { const n = 1 << ((lp & 7) + 1); pal = Buffer.alloc(n * 3); b.copy(pal, 0, q, q + n * 3); q += n * 3; }
      const minCode = b[q++];
      const data = [];
      while (b[q] !== 0) { const n = b[q]; data.push(b.slice(q + 1, q + 1 + n)); q += n + 1; }
      q++;
      const interlaced = !!(lp & 0x40);
      const idx = lzwDecode(Buffer.concat(data), minCode, fw * fh, interlaced, fw, fh);
      frames.push(Object.assign({ left, top, w: fw, h: fh, pal, idx, interlaced }, pending || { transparent: -1, disposal: 0, delay: 0 }));
      pending = null;
      p = q;
    } else { p++; }
  }
  return { W, H, frames, bgIndex, gct };
}

function lzwDecode(data, minCode, expected, interlaced, fw, fh) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, dict = [], next = eoi + 1;
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = null; dict[eoi] = null;
    next = eoi + 1; codeSize = minCode + 1;
  };
  reset();
  const out = new Array(expected);
  let bitPos = 0, prev = null, o = 0;
  const readCode = () => {
    let v = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[(bitPos >> 3)];
      if (byte === undefined) return eoi;
      v |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return v;
  };
  while (o < expected) {
    const code = readCode();
    if (code === eoi) break;
    if (code === clear) { reset(); prev = null; continue; }
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat([prev[0]]);
    else break;
    for (let i = 0; i < entry.length && o < expected; i++) out[o++] = entry[i];
    if (prev) { dict[next++] = prev.concat([entry[0]]); if (next === (1 << codeSize) && codeSize < 12) codeSize++; }
    prev = entry;
  }
  while (o < expected) out[o++] = 0;
  // 解隔行（GIF 用 4 遍隔行扫描）
  if (interlaced) {
    const rows = [];
    const order = [];
    for (let y = 0; y < fh; y += 8) order.push(y);
    for (let y = 4; y < fh; y += 8) order.push(y);
    for (let y = 2; y < fh; y += 8) order.push(y);
    for (let y = 1; y < fh; y += 8) order.push(y);
    const flat = new Array(expected);
    for (let r = 0; r < fh; r++) {
      const srcRow = order[r];
      if (srcRow === undefined) continue;
      for (let x = 0; x < fw; x++) flat[r * fw + x] = out[srcRow * fw + x];
    }
    return flat;
  }
  return out;
}

/* 把 GIF 帧合成成"每一帧的完整 RGBA"（按 disposal 规则逐帧叠） */
function composeFrames(gif) {
  const { W, H } = gif;
  const canvas = Buffer.alloc(W * H * 4);        // 画布（RGBA）
  const out = [];
  for (const f of gif.frames) {
    let snapshot = null;
    if (f.disposal === 3 && out.length) snapshot = Buffer.from(canvas);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const gi = y * f.w + x;
        const ci = f.idx[gi];
        if (ci === f.transparent) continue;
        const X = f.left + x, Y = f.top + y;
        if (X >= W || Y >= H) continue;
        const o = (Y * W + X) * 4;
        const p = ci * 3;
        canvas[o] = f.pal[p]; canvas[o + 1] = f.pal[p + 1]; canvas[o + 2] = f.pal[p + 2]; canvas[o + 3] = 255;
      }
    }
    out.push(Buffer.from(canvas));
    if (f.disposal === 2) {                       // 恢复到背景色
      for (let i = 0; i < f.h; i++) for (let j = 0; j < f.w; j++) {
        const X = f.left + j, Y = f.top + i;
        if (X >= W || Y >= H) continue;
        const o = (Y * W + X) * 4;
        canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0;
      }
    } else if (f.disposal === 3 && snapshot) snapshot.copy(canvas);
  }
  return out;
}

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 主流程 ---------------- */
const argv = process.argv.slice(2);
const INPUT = argv[0];
const INFO = argv.includes('--info');
if (!INPUT) { console.error('用法：node tools/gif2sheet.js <输入.gif> [--info | <输出.png> [边距%] [去底色#RRGGBB]]'); process.exit(1); }
const OUTPUT = INFO ? null : (argv[1] || INPUT.replace(/\.gif$/i, '.png'));
const MARGIN = (Number(argv[2]) || 8) / 100;
const KEY = argv[3];   // 例如 #000000

const gif = decodeGIF(INPUT);
const frames = composeFrames(gif);
const W = gif.W, H = gif.H;
console.log(`${path.relative(process.cwd(), INPUT)}  画布 ${W}x${H}  帧数 ${frames.length}`);

/* 分析：每帧四角颜色 / 不透明占比 / 边缘触边 */
const px = (buf, x, y) => { const o = (y * W + x) * 4; return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]; };
console.log('\n帧 | 四角颜色(R,G,B,A)        | 不透明% | 左右边缘触边%');
for (let k = 0; k < frames.length; k++) {
  const f = frames[k];
  const c = px(f, 0, 0);
  let opaque = 0, edge = 0;
  const E = Math.max(2, Math.round(W * 0.03));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = f[(y * W + x) * 4 + 3];
    if (a > 24) { opaque++; if (x < E || x >= W - E) edge++; }
  }
  console.log(String(k + 1).padStart(2) + ' | ' + `(${c[0]},${c[1]},${c[2]},${c[3]})`.padEnd(24) +
    ' | ' + (opaque / (W * H) * 100).toFixed(0).padStart(5) +
    '   | ' + (edge / (2 * E * H) * 100).toFixed(0).padStart(5));
}
if (INFO) process.exit(0);

/* 输出：去底色（可选）+ 统一缩放居中留边距 */
let keyRGB = null;
if (KEY) {
  const m = /^#?([0-9a-f]{6})$/i.exec(KEY);
  if (!m) { console.error('去底色格式应为 #RRGGBB'); process.exit(1); }
  keyRGB = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
const KEYTOL = 48;
function toRGBA(buf) {
  const out = Buffer.from(buf);
  if (!keyRGB) return out;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (Math.abs(out[o] - keyRGB[0]) <= KEYTOL && Math.abs(out[o + 1] - keyRGB[1]) <= KEYTOL && Math.abs(out[o + 2] - keyRGB[2]) <= KEYTOL) out[o + 3] = 0;
  }
  return out;
}
const imgs = frames.map(toRGBA);
// 统一取景窗
let ux0 = W, uy0 = H, ux1 = -1, uy1 = -1;
for (const f of imgs) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (f[(y * W + x) * 4 + 3] > 24) {
    if (x < ux0) ux0 = x; if (x > ux1) ux1 = x;
    if (y < uy0) uy0 = y; if (y > uy1) uy1 = y;
  }
}
if (ux1 < 0) throw new Error('去底色后全透明了？换一个 --info 看看四角是什么颜色');
const bw = ux1 - ux0 + 1, bh = uy1 - uy0 + 1, inner = 1 - 2 * MARGIN;
const scale = Math.min(W * inner / bw, H * inner / bh);
console.log(`\n统一取景窗 x ${ux0}..${ux1} y ${uy0}..${uy1}  缩放 ${(scale * 100).toFixed(1)}%`);
const out = Buffer.alloc(W * H * frames.length * 4);
for (let k = 0; k < frames.length; k++) {
  const src = imgs[k], dw = Math.round(bw * scale), dh = Math.round(bh * scale);
  const ox = Math.round((W - dw) / 2), oy = Math.round((H - dh) / 2);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const o = ((Y * W * frames.length) + k * W + X) * 4;   // 整图逐行布局
    const fx = (X - ox) / scale + ux0, fy = (Y - oy) / scale + uy0;
    if (fx < ux0 - 0.5 || fx > ux1 + 0.5 || fy < uy0 - 0.5 || fy > uy1 + 0.5) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const g = (xx, yy) => { const q = (yy * W + xx) * 4; return [src[q], src[q + 1], src[q + 2], src[q + 3]]; };
    const p00 = g(x0, y0), p10 = g(x0 + 1, y0), p01 = g(x0, y0 + 1), p11 = g(x0 + 1, y0 + 1);
    for (let c = 0; c < 4; c++) {
      const top = p00[c] * (1 - tx) + p10[c] * tx, bot = p01[c] * (1 - tx) + p11[c] * tx;
      out[o + c] = Math.round(top * (1 - ty) + bot * ty);
    }
  }
}
fs.writeFileSync(OUTPUT, encodePNG(W * frames.length, H, out));
console.log(`输出 ${path.relative(process.cwd(), OUTPUT)}  ${W * frames.length}x${H}  ${(fs.statSync(OUTPUT).size / 1024).toFixed(0)}KB`);
