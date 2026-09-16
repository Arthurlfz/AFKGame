# -*- coding: utf-8 -*-
"""回滚 config.js 中墨灵在 starters / petProfiles 的条目（测试宠不进开局选宠池）"""
import io

p = r'D:\Ai\游戏原型\docs\js\core\config.js'
s = io.open(p, encoding='utf-8').read()

# 回滚 starters（墨灵行删除，幽影兔恢复为最后一项无逗号）
old1 = """      { name: '幽影兔', growth: 5, baseHp: 70,  baseAtk: 24, baseDef: 7,  statCoeff: { hp: 3.35, atk: 2.34, def: 0.90 }, mech: { hit: 0.9, dodge: 1.45 } },  // 极速闪避（最快，spd 100）
      { name: '墨灵',   growth: 5, baseHp: 110, baseAtk: 22, baseDef: 11, statCoeff: { hp: 4.9, atk: 2.38, def: 1.02 }, mech: { hit: 1.0, dodge: 1.0 } }    // 测试线：均衡（spd 80，模板=腐噜兽）
    ],"""
new1 = """      { name: '幽影兔', growth: 5, baseHp: 70,  baseAtk: 24, baseDef: 7,  statCoeff: { hp: 3.35, atk: 2.34, def: 0.90 }, mech: { hit: 0.9, dodge: 1.45 } }  // 极速闪避（最快，spd 100）
    ],"""
assert old1 in s, 'starters 墨灵 not found'
s = s.replace(old1, new1, 1)

# 回滚 petProfiles（墨灵行删除，幽影兔恢复为最后一项无逗号）
old2 = """      '幽影兔': { role: '极速连击', description: '速度全游最快（100）、闪避最高，靠高频出手清理敌人；血薄防低，回血最频繁。', critRate: 4, critDamage: 130, hit: 88, dodge: 12, lifesteal: 0 },
      '墨灵': { role: '均衡快刷', description: '墨渊一脉的幼年形态，属性均衡、速度中等（80）；成长后化为墨影、墨煞，终阶墨渊魔君。', critRate: 8, critDamage: 145, hit: 90, dodge: 5, lifesteal: 0 }
    },"""
new2 = """      '幽影兔': { role: '极速连击', description: '速度全游最快（100）、闪避最高，靠高频出手清理敌人；血薄防低，回血最频繁。', critRate: 4, critDamage: 130, hit: 88, dodge: 12, lifesteal: 0 }
    },"""
assert old2 in s, 'petProfiles 墨灵 not found'
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('config.js: 已回滚 starters/petProfiles 中的墨灵（保留 speeds/evolution.tree）')
