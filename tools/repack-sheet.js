/* ============================================================
 * repack-sheet.js —— 把一张透明 spritesheet【重新打包】：统一缩放 + 居中 + 四周留边距
 * 用法：node tools/repack-sheet.js <输入.png> <帧数> [边距%] [输出.png]
 *   例：node tools/repack-sheet.js docs/assets/pets/anim/god/血月神狐-idle.png 24 8 out.png
 *
 * 🔴 为什么需要它（2026-09-21 血月神狐实测）：
 *   素材导出的常见做法是"抠图 → 裁到内容边界 → 缩放到最大那帧刚好填满一格"。
 *   后果：② 大部分帧的角色毛发顶到格子左右边（实测 20/24 触左、19/24 触右），
 *        播放时画面边缘把毛发切成一条直线，看着像"尾巴缺一截 + 旁边漂着半截"；
 *        ② 如果每帧各自裁各自缩放，角色还会忽大忽小、位置漂移。
 *   修法不是"往内裁"（那只是把直线挪进画面），而是【整组统一缩小并居中】：
 *   用所有帧的【合并包围盒】当统一取景窗 → 每帧缩放一致、位置一致，四周留出边距。
 *
 * ⚠️ 只做等比几何变换，不做任何"创造性"改动；源像素不动，只缩不裁内容。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- PNG 解码 ---------------- */
function decodePNG(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG：' + file);
  let o = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (o < b.length - 8) {
    const len = b.readUInt32BE(o), t = b.slice(o + 4, o + 8).toString('ascii');
    if (t === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); depth = b[o + 16]; ctype = b[o + 17]; interlace = b[o + 20]; }
    else if (t === 'IDAT') idat.push(b.slice(o + 8, o + 8 + len));
    o += 12 + len;
    if (t === 'IEND') break;
  }
  if (depth !== 8 || interlace) throw new Error(`只支持 8bit 非隔行（depth=${depth} interlace=${interlace}）`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('不支持的颜色类型 ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++], line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, bb = prev[x], c = x >= ch ? prev[x - ch] : 0, v = line[x];
      let r = v;
      if (ft === 1) r = v + a; else if (ft === 2) r = v + bb; else if (ft === 3) r = v + ((a + bb) >> 1);
      else if (ft === 4) {
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c));
      }
      cur[x] = r & 255;
    }
  }
  return { w, h, ch, px: out };
}

/* ---------------- PNG 编码（RGBA8，filter 0） ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                                   // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* 体检结论：说清"是缩放过满（能救）"还是"内容出画（救不了）"
 * 判据：取景窗一旦贴到格子四边，说明角色的内容一直画到格子边界 ——
 *   要么是缩放过满（缩小即可），要么是内容在拍摄时就出画了（缩小也救不回被切掉的那部分）。 */
function worstInfoHint(perFrameEdge, ux0, ux1, uy0, uy1, FW, FH) {
  const flat = ux0 <= 1 && ux1 >= FW - 2 && uy0 <= 1 && uy1 >= FH - 2;
  const bad = Math.max(...perFrameEdge);
  const lines = [];
  lines.push(flat
    ? '⚠️ 统一取景窗贴住了格子四条边（内容一直画到边界）。'
    : '✅ 取景窗没有贴满四边，内容四周本来就有空白。');
  lines.push(bad > 15
    ? `⚠️ 有 ${perFrameEdge.filter(v => v > 15).length}/${perFrameEdge.length} 格边缘实心 > 15%（最严重 ${bad.toFixed(0)}%）。`
    : '✅ 所有帧的边缘实心都在 15% 以内，符合逐帧动画要求。');
  lines.push('');
  lines.push('下一步怎么判：回答一个问题 —— 角色在画面里的"完整轮廓"是否被画面边界切断？');
  lines.push('  · 没被切断，只是"贴边/太满"  ⇒ 缩小就能修：加边距参数重新打包');
  lines.push('  · 明显被切断（尾巴/耳朵缺少一截）⇒ 内容在生成时就出画了，任何缩放都救不回，必须重新生成素材');
  return lines.join('\n');
}

/* ---------------- 主流程 ---------------- */
const argv = process.argv.slice(2);
const INFO = argv.includes('--info');                               // 只体检，不写文件
const sizeArg = argv.find(a => a.startsWith('--size='));            // 输出格边长（把非方形源图装进方形格）
const [input, framesArg, marginArg, output] = argv.filter(a => a !== '--info' && !a.startsWith('--size='));
if (!input || !framesArg) {
  console.error('用法：node tools/repack-sheet.js <输入.png> <帧数> [边距%] [输出.png] [--size=N] [--info]');
  console.error('      node tools/repack-sheet.js <输入.png> <帧数> --info   只体检、不写文件');
  console.error('      --size=N：输出格强制 N×N。单帧时源图允许非方形（如 1024x1536 → 256x256 立绘）');
  process.exit(1);
}
const N = Number(framesArg);
const MARGIN = (marginArg == null ? 8 : Number(marginArg)) / 100;   // 四周各留的比例
const OUT = output || input.replace(/\.png$/i, '-repacked.png');

const img = decodePNG(input);
if (img.w % N !== 0) throw new Error(`图宽 ${img.w} 不能被帧数 ${N} 整除`);
const FW = img.w / N, FH = img.h;
/* 单帧允许非方形源（做立绘用：源图常常是竖构图）；多帧仍必须是方形格，否则"第几格"没法切。
 * 输出格 OW×OH：默认跟源格一致；给了 --size=N 就输出 N×N —— 内容等比缩放居中 + 留边距塞进去。
 * 2026-09-21：血月神狐定稿 1024x1536 要变成 256x256 立绘，为它加的这个档位。 */
if (N > 1 && FW !== FH) throw new Error(`每格不是正方形（${FW}x${FH}）—— 多帧只处理方形格`);
const OUTSZ = sizeArg ? Number(sizeArg.split('=')[1]) : 0;
if (sizeArg && (!OUTSZ || OUTSZ <= 8)) throw new Error('--size 要给一个大于 8 的数字，例如 --size=256');
const OW = OUTSZ || FW, OH = OUTSZ || FH;
const ch = img.ch;
const alphaAt = (x, y) => (ch === 4 ? img.px[(y * img.w + x) * ch + 3] : 255);

/* 1. 每帧的内容包围盒 → 合并成一扇【统一取景窗】 */
let ux0 = FW, uy0 = FH, ux1 = -1, uy1 = -1;
const perFrameEdge = [];
for (let k = 0; k < N; k++) {
  const bx = Math.round(k * FW);
  let x0 = FW, y0 = FH, x1 = -1, y1 = -1, edge = 0;
  const E = Math.max(2, Math.round(FW * 0.03));
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (alphaAt(bx + x, y) > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x < E || x >= FW - E) edge++;
    }
  }
  perFrameEdge.push(edge / (2 * E * FH) * 100);
  if (x1 < 0) continue;
  ux0 = Math.min(ux0, x0); uy0 = Math.min(uy0, y0);
  ux1 = Math.max(ux1, x1); uy1 = Math.max(uy1, y1);
}
if (ux1 < 0) throw new Error('整张图都是透明的？');

const bw = ux1 - ux0 + 1, bh = uy1 - uy0 + 1;
const inner = 1 - 2 * MARGIN;                       // 目标格内允许内容占的比例
const scale = Math.min(OW * inner / bw, OH * inner / bh);
const dw = Math.round(bw * scale), dh = Math.round(bh * scale);
const ox = Math.round((OW - dw) / 2), oy = Math.round((OH - dh) / 2);

console.log(`输入 ${path.relative(process.cwd(), input)}  ${img.w}x${img.h}（${N} 格 × ${FW}x${FH}）通道${ch}`);
console.log(`统一取景窗（各帧包围盒的并集）：x ${ux0}..${ux1}（宽 ${bw}）  y ${uy0}..${uy1}（高 ${bh}）`);
console.log(`统一缩放 ${(scale * 100).toFixed(1)}%  →  内容 ${dw}x${dh}，落在 ${OW}x${OH} 格内，四周边距 ${MARGIN * 100}%`);
console.log(`原来每帧触边情况（左右边缘 3% 条带的实心占比）：平均 ${(perFrameEdge.reduce((a, b) => a + b, 0) / N).toFixed(0)}%，最大 ${Math.max(...perFrameEdge).toFixed(0)}%`);
if (INFO) {
  console.log('\n（--info：只体检，没有写任何文件）');
  console.log(worstInfoHint(perFrameEdge, ux0, ux1, uy0, uy1, FW, FH));
  process.exit(0);
}

/* 2. 逐帧重采样（按【同一取景窗 + 同一缩放 + 同一位置】）
 * 🔴 缩小必须用【面积平均 + 预乘 alpha】，不能用点/双线性：
 *   1024×1536 → 256 是 7 倍缩小，双线性每个输出像素只"看"到 1/49 的源像素 ⇒
 *   细发丝/墨线会随机保留或消失（看着像噪点），而且不透明像素数会对不上源（自检②会红）。
 *   面积平均 = 落到该输出像素里的源像素按覆盖率加权平均：细线该变淡就变淡，不会忽然消失。
 *   alpha 用【预乘】再平均，否则透明边缘会渗出黑边/灰边。
 * 放大（scale > 1）时才用双线性。 */
const out = Buffer.alloc(OW * OH * N * 4);
function sample(bx, sx, fy) {                        // 源图 (bx+sx, fy) 的 RGBA
  if (sx < 0 || sx >= FW || fy < 0 || fy >= FH) return [0, 0, 0, 0];
  const i = (fy * img.w + bx + sx) * ch;
  if (ch === 4) return [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]];
  if (ch === 3) return [img.px[i], img.px[i + 1], img.px[i + 2], 255];
  if (ch === 2 || ch === 1) return [img.px[i], img.px[i], img.px[i], ch === 2 ? img.px[i + 1] : 255];
  return [0, 0, 0, 0];
}
for (let k = 0; k < N; k++) {
  const bx = Math.round(k * FW);
  for (let Y = 0; Y < OH; Y++) {
    for (let X = 0; X < OW; X++) {
      /* 🔴 写出的缓冲区必须是【整图逐行】布局（第 Y 行 = 所有帧的第 Y 行拼起来），
       * 因为 encodePNG 把它当成 w = OW*N、h = OH 的行优先位图。
       * 2026-09-21：这里原来写成 ((k*FH+Y)*FW+X)*4（按帧分块），
       * 结果每帧被当成一整行塞进图里 → 输出成一片横条纹（预览页一眼就露馅）。 */
      const o0 = ((Y * OW * N) + k * OW + X) * 4;
      if (scale <= 1) {
        /* —— 面积平均（缩小路径）——
         * 输出像素 [X,X+1)×[Y,Y+1) 反算回源里的矩形，遍历覆盖到的整像素按重叠面积加权。 */
        const ax0 = (X - ox) / scale + ux0, ax1 = (X + 1 - ox) / scale + ux0;
        const ay0 = (Y - oy) / scale + uy0, ay1 = (Y + 1 - oy) / scale + uy0;
        let wsum = 0, pa = 0, pr = 0, pg = 0, pb = 0;
        for (let sy = Math.floor(ay0); sy <= Math.ceil(ay1) - 1; sy++) {
          const cy = Math.min(sy + 1, ay1) - Math.max(sy, ay0);
          if (cy <= 0) continue;
          for (let sx = Math.floor(ax0); sx <= Math.ceil(ax1) - 1; sx++) {
            const cx = Math.min(sx + 1, ax1) - Math.max(sx, ax0);
            if (cx <= 0) continue;
            const w = cx * cy, p = sample(bx, sx, sy), al = p[3] / 255;
            wsum += w; pa += al * w; pr += p[0] * al * w; pg += p[1] * al * w; pb += p[2] * al * w;
          }
        }
        if (wsum <= 0 || pa <= 0) { out[o0] = out[o0 + 1] = out[o0 + 2] = out[o0 + 3] = 0; continue; }
        out[o0]     = Math.round(pr / pa);
        out[o0 + 1] = Math.round(pg / pa);
        out[o0 + 2] = Math.round(pb / pa);
        out[o0 + 3] = Math.round(pa / wsum * 255);
        continue;
      }
      const fx = (X - ox) / scale + ux0;             // 目标 → 源（帧内坐标）
      const fy = (Y - oy) / scale + uy0;
      if (fx < ux0 - 0.5 || fx > ux1 + 0.5 || fy < uy0 - 0.5 || fy > uy1 + 0.5) {
        out[o0] = out[o0 + 1] = out[o0 + 2] = out[o0 + 3] = 0;   // 取景窗外 = 透明
        continue;
      }
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const p00 = sample(bx, x0, y0), p10 = sample(bx, x0 + 1, y0);
      const p01 = sample(bx, x0, y0 + 1), p11 = sample(bx, x0 + 1, y0 + 1);
      for (let c = 0; c < 4; c++) {
        const top = p00[c] * (1 - tx) + p10[c] * tx;
        const bot = p01[c] * (1 - tx) + p11[c] * tx;
        out[o0 + c] = Math.round(top * (1 - ty) + bot * ty);
      }
    }
  }
}

/* 输出体检（这一条就是守值判据，别只看源图）：
 * 量【输出图】每格左右 8px 条带的不透明占比 —— `vtest_pet_anim.js` 要求 ≤15%，
 * 以及内容在格内占的宽高比例（立绘一般 70~80% 上下）。 */
const E8 = 8, oe = [];
for (let k = 0; k < N; k++) {
  let cnt = 0, solid = 0;
  for (let Y = 0; Y < OH; Y++) for (let X = 0; X < OW; X++) {
    if (X >= E8 && X < OW - E8) continue;
    cnt++;
    if (out[((Y * OW * N) + k * OW + X) * 4 + 3] > 24) solid++;
  }
  oe.push(cnt ? solid / cnt * 100 : 0);
}
console.log(`输出体检：内容在格内占 ${(dw / OW * 100).toFixed(0)}% 宽 × ${(dh / OH * 100).toFixed(0)}% 高；`
  + `左右 ${E8}px 条带不透明占比 平均 ${(oe.reduce((a, b) => a + b, 0) / N).toFixed(1)}%、最大 ${Math.max(...oe).toFixed(1)}%`
  + `（守值要求 ≤15% ${Math.max(...oe) <= 15 ? '✅' : '❌ 不合格'}）`);

fs.writeFileSync(OUT, encodePNG(OW * N, OH, out));

/* 3. 自检（两条，必须都过）
 *   ① 边缘是否留白  ② 内容是否真的对（逐帧比对不透明像素数，应约为 源×scale²）
 * ⚠️ ② 不能省：只验边缘的话，输出"整张错位成横条纹"也能通过 —— 2026-09-21 就是这么漏掉的。 */
const chk = decodePNG(OUT);
const chkA = (x, y) => (chk.ch === 4 ? chk.px[(y * chk.w + x) * chk.ch + 3] : 255);
/* ⚠️ 自检量的是【输出图】，所以一律用输出格尺寸 OW/OH（不是源格 FW/FH）——
 * 2026-09-21：加了 --size 档位后忘同步这里，结果自检读到图外，误报"内容偏差 300%"。 */
const E = Math.max(2, Math.round(OW * 0.03));
let worst = 0, worstK = 0;
for (let k = 0; k < N; k++) {
  const bx = k * OW;
  let e = 0;
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++)
    if ((x < E || x >= OW - E) && chkA(bx + x, y) > 24) e++;
  const pct = e / (2 * E * OH) * 100;
  if (pct > worst) { worst = pct; worstK = k + 1; }
}
console.log(`\n输出 ${path.relative(process.cwd(), OUT)}  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
console.log(`自检①：最严重第 ${worstK} 格边缘实心 ${worst.toFixed(1)}%（改前平均 ${(perFrameEdge.reduce((a, b) => a + b, 0) / N).toFixed(1)}%）`);

let ok = worst <= 15, maxDev = 0;
const countSrc = [], countOut = [];
for (let k = 0; k < N; k++) {
  let cs = 0, co = 0;
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
    if (chkA(k * OW + x, y) > 24) co++;
  }
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (alphaAt(Math.round(k * FW) + x, y) > 24) cs++;
  }
  countSrc.push(cs); countOut.push(co);
  const dev = Math.abs(co - cs * scale * scale) / Math.max(1, cs * scale * scale);
  if (dev > maxDev) maxDev = dev;
}
console.log(`自检②：逐帧不透明像素数 vs 源（应约为源×${(scale * scale).toFixed(3)}），最大偏差 ${(maxDev * 100).toFixed(1)}%`);
console.log(`  第1帧 源 ${countSrc[0]} → 新 ${countOut[0]}（期望约 ${Math.round(countSrc[0] * scale * scale)}）`);
if (maxDev > 0.25) { ok = false; console.log('❌ 内容偏差过大 —— 输出的图很可能错位/错乱（检查缓冲区布局）'); }
console.log(ok ? '✅ 两条自检都通过：边缘已留白，且内容与源一致（等比缩放）'
  : '❌ 自检未通过，别把这个文件拿去用');
