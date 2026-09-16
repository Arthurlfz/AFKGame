# -*- coding: utf-8 -*-
"""棋盘格背景抠图：色距转 alpha（背景=白+浅灰两主色）。
输入 tools/frames-full/*.png (JPEG 棋盘格)
输出 tools/frames-matted/fNN.png (RGBA 256² 透明)
"""
import os
from PIL import Image

SRC = r'D:\Ai\游戏原型\tools\frames-full'
OUT = r'D:\Ai\游戏原型\tools\frames-matted'
C1 = (255, 255, 255)   # 棋盘格亮色
C2 = (243, 243, 243)   # 棋盘格暗色
INNER = 60   # 距离 >= 此值：完全不透明
OUTER = 25   # 距离 <= 此值：完全透明

def dist(p, c):
    return sum((p[i] - c[i]) ** 2 for i in range(3)) ** 0.5

os.makedirs(OUT, exist_ok=True)
files = sorted(f for f in os.listdir(SRC) if f.lower().endswith('.png'))
for i, f in enumerate(files):
    img = Image.open(os.path.join(SRC, f)).convert('RGB')
    w, h = img.size
    px = img.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            d = min(dist(p, C1), dist(p, C2))
            if d >= INNER:
                a = 255
            elif d <= OUTER:
                a = 0
            else:
                a = int((d - OUTER) / (INNER - OUTER) * 255)
            opx[x, y] = (p[0], p[1], p[2], a)
    out.save(os.path.join(OUT, f'f{i:02d}.png'))
    alpha = out.getchannel('A').getextrema()
    print(f'{f} -> f{i:02d}.png  alpha={alpha}')

print(f'\n完成 -> {OUT}')
