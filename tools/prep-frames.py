# -*- coding: utf-8 -*-
"""动作帧预处理：检查 + 统一角色高度 + 锚点放置到 256 画布。
用法：python prep-frames.py
输入：tools/frames-full/*.png（AI 生成帧，透明背景）
输出：tools/frames-raw/fNN.png（角色高度统一、脚底锚点对齐到 y=232 的 256² 帧）
"""
import os
from PIL import Image

SRC = r'D:\Ai\游戏原型\tools\frames-full'
OUT = r'D:\Ai\游戏原型\tools\frames-raw'
TARGET_H = 200   # 角色统一高度（画布 256 的 ~78%，与游戏立绘占比一致）
ANCHOR_Y = 232   # 脚底锚点（与 frame-align 默认一致）

def analyze(img):
    a = img.getchannel('A')
    w, h = img.size
    px = a.load()
    min_x, min_y, max_x, max_y = w, h, -1, -1
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if px[x, y] > 8:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
    if max_x < 0: return None
    return (min_x, min_y, max_x, max_y)

os.makedirs(OUT, exist_ok=True)
files = sorted(f for f in os.listdir(SRC) if f.lower().endswith('.png'))
print(f'共 {len(files)} 帧\n')

for i, f in enumerate(files):
    img = Image.open(os.path.join(SRC, f)).convert('RGBA')
    bbox = analyze(img)
    if not bbox:
        print(f'⚠ {f}: 无内容'); continue
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    mode = img.mode
    alpha = img.getchannel('A').getextrema()
    # 角色高度统一缩放
    scale = TARGET_H / bh
    nw, nh = max(1, round(bw * scale)), TARGET_H
    crop = img.crop((x0, y0, x1 + 1, y1 + 1))
    if scale < 0.5 or scale > 2.0:
        print(f'⚠ {f}: 缩放比 {scale:.2f} 过大，角色与目标差异大')
    resized = crop.resize((nw, nh), Image.LANCZOS)
    # 放画布：水平居中，脚底贴 ANCHOR_Y
    canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    px = (256 - nw) // 2
    py = ANCHOR_Y - nh
    canvas.paste(resized, (px, py), resized)
    out_name = f'f{i:02d}.png'
    canvas.save(os.path.join(OUT, out_name))
    print(f'{f} -> {out_name}  bbox={bbox} 原角色 {bw}x{bh}  缩放 {scale:.2f}  置于 ({px},{py})')

print(f'\n完成 -> {OUT}')
