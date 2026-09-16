# -*- coding: utf-8 -*-
import io
p = r'D:\Ai\游戏原型\docs\游戏.html'
s = io.open(p, encoding='utf-8').read()
old = '<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">'
new = ('<head>\n'
       '<meta charset="UTF-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
       '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n'
       '<meta http-equiv="Pragma" content="no-cache">\n'
       '<meta http-equiv="Expires" content="0">')
assert old in s, 'head 段未匹配'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('已加禁用缓存 meta（以后无版本地址也拿最新版）')
