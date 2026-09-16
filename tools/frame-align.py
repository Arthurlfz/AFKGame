#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
帧对齐修帧工具（动作帧流水线第3步）
====================================
输入：同一动作的多张关键帧 PNG（AI 生成，可能有角色漂移）
输出：
  1. 按「脚底锚点」对齐后的帧序列（消除漂移）
  2. 质心位移检测报告（判断是真动作还是闪烁——上次翻车的根因）

用法：
  python frame-align.py --frames a.png b.png c.png --out aligned/ --report
  python frame-align.py --dir raw_frames/ --out aligned/     # 按文件名排序批量
"""
import argparse
import os
import sys
from PIL import Image

def analyze(img):
    """返回 (bbox, 质心, 脚底中心, 非透明像素数)。bbox = (x0,y0,x1,y1)。"""
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    alpha = img.getchannel('A')
    w, h = img.size
    pts = []
    xs, ys, cnt = 0.0, 0.0, 0
    min_x, min_y, max_x, max_y = w, h, -1, -1
    # 分块扫描 alpha，避免纯 Python 逐像素太慢
    px = alpha.load()
    step = 2  # 采样步长（检测用，够用即可）
    for y in range(0, h, step):
        for x in range(0, w, step):
            a = px[x, y]
            if a > 8:
                cnt += 1
                xs += x
                ys += y
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
    if cnt == 0:
        return None
    cx, cy = xs / cnt, ys / cnt
    foot_x = (min_x + max_x) / 2.0   # 脚底中心 = bbox 底部中心
    foot_y = max_y
    return (min_x, min_y, max_x, max_y), (cx, cy), (foot_x, foot_y), cnt

def align(img, anchor_x, anchor_y, canvas_w=256, canvas_h=256):
    """把 img 的脚底锚点移到画布 (anchor_x, anchor_y) 处，输出对齐后的帧。"""
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    res = analyze(img)
    if not res:
        return None
    bbox, _, (fx, fy), _ = res
    dx = round(anchor_x - fx)
    dy = round(anchor_y - fy)
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    canvas.paste(img, (dx, dy), img)
    return canvas

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', nargs='*', help='关键帧 PNG 列表（按动作顺序）')
    ap.add_argument('--dir', help='或：目录，按文件名排序读取所有 png')
    ap.add_argument('--out', required=True, help='输出目录')
    ap.add_argument('--report', action='store_true', help='输出质心位移检测报告')
    ap.add_argument('--anchor-x', type=float, default=128, help='对齐锚点 X（默认画布中心）')
    ap.add_argument('--anchor-y', type=float, default=232, help='对齐锚点 Y（默认近底部，脚底）')
    ap.add_argument('--sheet', action='store_true', help='额外输出一张横排 sheet')
    args = ap.parse_args()

    frames = args.frames or []
    if args.dir:
        frames = sorted(
            os.path.join(args.dir, f) for f in os.listdir(args.dir)
            if f.lower().endswith('.png')
        )
    if not frames:
        print('ERROR: 没有输入帧'); sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    imgs = []
    for f in frames:
        im = Image.open(f)
        im.load()
        imgs.append(im)

    # 用第一帧的脚底作为锚点基准（后续帧对齐到它）
    base = analyze(imgs[0])
    if not base:
        print(f'ERROR: 第一帧 {frames[0]} 没有非透明像素'); sys.exit(1)
    _, _, (fx0, fy0), _ = base

    reports = []
    aligned_paths = []
    prev_c = None
    prev_name = None
    for i, (path, im) in enumerate(zip(frames, imgs)):
        a = analyze(im)
        if not a:
            print(f'WARN: {path} 无内容，跳过'); continue
        bbox, (cx, cy), (fx, fy), cnt = a
        aligned = align(im, args.anchor_x, args.anchor_y)
        out_name = f'f{i:02d}-aligned.png'
        out_path = os.path.join(args.out, out_name)
        aligned.save(out_path)
        aligned_paths.append(out_path)

        # 位移检测（对齐后基于锚点，反映角色自身姿态变化）
        disp = ''
        if prev_c is not None:
            d = ((cx - prev_c[0]) ** 2 + (cy - prev_c[1]) ** 2) ** 0.5
            flag = 'OK-动作' if d >= 3 else '⚠ 疑似闪烁(质心几乎不动)'
            disp = f'  质心位移 {d:.1f}px {flag}'
        reports.append(
            f'{os.path.basename(path)}: bbox={bbox} 质心=({cx:.1f},{cy:.1f}) '
            f'脚底=({fx:.1f},{fy:.1f}) 像素={cnt}{disp}'
        )
        prev_c = (cx, cy)
        prev_name = os.path.basename(path)

    # 输出横排 sheet（每帧 256x256）
    if args.sheet:
        n = len(aligned_paths)
        sheet = Image.new('RGBA', (n * 256, 256), (0, 0, 0, 0))
        for i, p in enumerate(aligned_paths):
            fr = Image.open(p)
            sheet.paste(fr, (i * 256, 0), fr)
        sp = os.path.join(args.out, 'sheet.png')
        sheet.save(sp)
        print(f'sheet: {sp} ({n}x1, 256px/帧)')

    print(f'已对齐 {len(aligned_paths)} 帧 -> {args.out}')
    if args.report:
        print('\n=== 位移检测报告 ===')
        print('\n'.join(reports))
        print('判定标准：相邻帧质心位移 >= 3px 视为“动作”；否则视为“闪烁”（角色没动只是重绘）')

if __name__ == '__main__':
    main()
