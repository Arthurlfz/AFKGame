import re
path = r"D:\Ai\游戏原型\docs\css\game.css"
t = open(path, encoding="utf-8-sig").read()
i = t.find("真实背包格子")
j = t.find("空背包提示覆盖层")
print(t[i-200:j+300] if i>=0 else "not found")