# -*- coding: utf-8 -*-
"""新增测试宠「墨渊」线素材准备"""
from PIL import Image
import os, shutil

root = r'D:\Ai\游戏原型\docs\assets\pets'
pack = os.path.join(root, 'pack9-moyuan')
anim = os.path.join(root, 'anim', 'pack9-moyuan')
av = os.path.join(root, 'avatars', 'pack9-moyuan')
for d in (pack, anim, av):
    os.makedirs(d, exist_ok=True)

concept = r'D:\Ai\游戏原型\docs\assets\concept'
# 形态名 -> 源图
forms = {
    '墨灵': 'baby-ink.png',
    '墨影': 'stage2.png',
    '墨煞': 'stage3.png',
    '墨渊魔君': 'stage5-humanoid-v2.png',
}

for name, src in forms.items():
    img = Image.open(os.path.join(concept, src)).convert('RGBA').resize((256, 256), Image.LANCZOS)
    img.save(os.path.join(pack, name + '.png'))              # 立绘 256
    img.save(os.path.join(av, name + '.png'))                 # 头像 256（同图，头像框会裁）
    print('素材:', name)

# 墨渊魔君动画：idle 单帧 + attack 3帧 sheet（原始朝左，游戏CSS自动翻朝右）
shutil.copy(os.path.join(pack, '墨渊魔君.png'), os.path.join(anim, 'idle.png'))
shutil.copy(r'D:\Ai\游戏原型\tools\atk-aligned\sheet.png', os.path.join(anim, 'attack.png'))
print('动画: idle.png + attack.png OK')

# 检查合成 sheet 尺寸
sh = Image.open(os.path.join(anim, 'attack.png'))
print('attack sheet:', sh.size)
