# -*- coding: utf-8 -*-
"""新增测试宠「墨渊」线：配置接入（幂等版）"""
import io

def ensure_replace(path, old, new, tag):
    s = io.open(path, encoding='utf-8').read()
    if new in s and old not in s:
        print(tag, '已存在，跳过')
        return
    assert old in s, tag + ' 未找到'
    s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print(tag, 'OK')

# ============ 1. pet.js：蛋池加「墨灵」 ============
p1 = r'D:\Ai\游戏原型\docs\js\pet\pet.js'
s1 = io.open(p1, encoding='utf-8').read()
if '{ name: \'墨灵\' }' in s1:
    print('pet.js PET_POOL: 已存在')
else:
    old1 = "    { name: '瘟熊' }, { name: '毒沼蛙' }\n  ];"
    new1 = "    { name: '瘟熊' }, { name: '毒沼蛙' },\n    { name: '墨灵' }\n  ];"
    assert old1 in s1, 'PET_POOL not found'
    s1 = s1.replace(old1, new1, 1)
    io.open(p1, 'w', encoding='utf-8').write(s1)
    print('pet.js PET_POOL: + 墨灵')

# ============ 2. config.js ============
p2 = r'D:\Ai\游戏原型\docs\js\core\config.js'
s2 = io.open(p2, encoding='utf-8').read()

if "'墨灵',   growth: 5" in s2:
    print('config starters: 已存在')
else:
    old2 = "      { name: '幽影兔', growth: 5, baseHp: 70,  baseAtk: 24, baseDef: 7,  statCoeff: { hp: 3.35, atk: 2.34, def: 0.90 }, mech: { hit: 0.9, dodge: 1.45 } }  // 极速闪避（最快，spd 100）\n    ],"
    new2 = ("      { name: '幽影兔', growth: 5, baseHp: 70,  baseAtk: 24, baseDef: 7,  statCoeff: { hp: 3.35, atk: 2.34, def: 0.90 }, mech: { hit: 0.9, dodge: 1.45 } },  // 极速闪避（最快，spd 100）\n"
            "      { name: '墨灵',   growth: 5, baseHp: 110, baseAtk: 22, baseDef: 11, statCoeff: { hp: 4.9, atk: 2.38, def: 1.02 }, mech: { hit: 1.0, dodge: 1.0 } }    // 测试线：均衡（spd 80，模板=腐噜兽）\n    ],")
    assert old2 in s2, 'starters 幽影兔 not found'
    s2 = s2.replace(old2, new2, 1)

if "'墨灵': { role: '均衡快刷'" in s2:
    print('config petProfiles: 已存在')
else:
    old3 = "      '幽影兔': { role: '极速连击', description: '速度全游最快（100）、闪避最高，靠高频出手清理敌人；血薄防低，回血最频繁。', critRate: 4, critDamage: 130, hit: 88, dodge: 12, lifesteal: 0 }\n    },"
    new3 = ("      '幽影兔': { role: '极速连击', description: '速度全游最快（100）、闪避最高，靠高频出手清理敌人；血薄防低，回血最频繁。', critRate: 4, critDamage: 130, hit: 88, dodge: 12, lifesteal: 0 },\n"
            "      '墨灵': { role: '均衡快刷', description: '墨渊一脉的幼年形态，属性均衡、速度中等（80）；成长后化为墨影、墨煞，终阶墨渊魔君。', critRate: 8, critDamage: 145, hit: 90, dodge: 5, lifesteal: 0 }\n    },")
    assert old3 in s2, 'petProfiles 幽影兔 not found'
    s2 = s2.replace(old3, new3, 1)

if "'墨灵': 80, '墨影': 80" in s2:
    print('config speeds: 已存在')
else:
    old4 = "      '尸牙犬': 84, '幽灵犬': 84, '影刃兔': 100, '霜影兔': 100\n    },"
    new4 = ("      '尸牙犬': 84, '幽灵犬': 84, '影刃兔': 100, '霜影兔': 100,\n"
            "      // 测试线·墨渊：均衡（沿用基宠 80）\n"
            "      '墨灵': 80, '墨影': 80, '墨煞': 80, '墨渊魔君': 80\n    },")
    assert old4 in s2, 'speeds tail not found'
    s2 = s2.replace(old4, new4, 1)

if "'墨灵': [ { to: '墨影'" in s2:
    print('config evolution.tree: 已存在')
else:
    old5 = "        '霜影魔兔': [ { to: '霜魂兔皇', minLevel: 60 } ]\n      }"
    new5 = ("        '霜影魔兔': [ { to: '霜魂兔皇', minLevel: 60 } ],\n"
            "        '墨灵': [ { to: '墨影', minLevel: 10 } ],\n"
            "        '墨影': [ { to: '墨煞', minLevel: 25 } ],\n"
            "        '墨煞': [ { to: '墨渊魔君', minLevel: 60 } ]\n      }")
    assert old5 in s2, 'evolution tree tail not found'
    s2 = s2.replace(old5, new5, 1)

io.open(p2, 'w', encoding='utf-8').write(s2)
print('config.js 处理完成')

# ============ 3. enemy-data.js：第 1 档加墨灵野怪 ============
p3 = r'D:\Ai\游戏原型\docs\js\pet\enemy-data.js'
s3 = io.open(p3, encoding='utf-8').read()
if "id: 'wild-moyuan'" in s3:
    print('enemy-data: 已存在')
else:
    old6 = """    { id: 'wild-bloodfox', name: '血狐', level: 9, spd: 95,
      rarityWeights: { white: 75, blue: 22, gold: 3 }, levelRange: [1, 10], weight: 8,
      eggBaseName: '血狐', enemyType: 'normal' },"""
    new6 = """    { id: 'wild-bloodfox', name: '血狐', level: 9, spd: 95,
      rarityWeights: { white: 75, blue: 22, gold: 3 }, levelRange: [1, 10], weight: 8,
      eggBaseName: '血狐', enemyType: 'normal' },
    { id: 'wild-moyuan', name: '墨灵', level: 7, spd: 80,
      rarityWeights: { white: 80, blue: 18, gold: 2 }, levelRange: [1, 10], weight: 6,
      eggBaseName: '墨灵', enemyType: 'normal' },"""
    assert old6 in s3, 'enemy-data wild-bloodfox not found'
    s3 = s3.replace(old6, new6, 1)
    io.open(p3, 'w', encoding='utf-8').write(s3)
    print('enemy-data.js: + 墨灵野怪')

print('全部配置接入完成')
