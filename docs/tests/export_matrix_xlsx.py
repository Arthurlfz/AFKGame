# -*- coding: utf-8 -*-
"""
export_matrix_xlsx.py —— 「产出归属总表」写表器（生产线的第二步）

输入：由 docs/tests/export_matrix.js 生成的中间 JSON（路径从命令行第一个参数取）
输出：docs/产出归属总表.xlsx（8 个页签，人能直接读）

为什么不手写这张表：手写的表会跟配置脱节（本项目头号病因＝同一件事两份、只有一份对）。
本器只负责**排版**，所有事实都来自 JSON；JSON 又全部来自代码现场。

用法：别单独跑它 —— 跑 `cd docs && node tests/export_matrix.js`（它会自动调本器）。
"""
import json
import sys
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import ColorScaleRule

# ---------- 样式 ----------
H_FONT = Font(bold=True, color="FFFFFF", size=10)
H_FILL = PatternFill("solid", fgColor="3C3C46")
TITLE_FONT = Font(bold=True, size=14, color="E8E8F0")
SUB_FONT = Font(size=9, color="8A8A96")
NOTE_FONT = Font(size=9, color="B08A3E")
SEC_FONT = Font(bold=True, size=11, color="3C3C46")
SEC_FILL = PatternFill("solid", fgColor="E4E4EC")
GRAY_FILL = PatternFill("solid", fgColor="F2F2F2")
GRAY_FONT = Font(color="AFAFB8", size=9)
BOLD = Font(bold=True)
WRAP = Alignment(vertical="center", wrap_text=False)
CENTER = Alignment(horizontal="center", vertical="center")
THIN = Side(style="thin", color="D8D8E0")
BORDER = Border(bottom=THIN)


def sheet(wb, title, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title
    ws.sheet_view.showGridLines = False
    return ws


def title_row(ws, text, sub=""):
    ws["A1"] = text
    ws["A1"].font = TITLE_FONT
    ws["A1"].fill = H_FILL
    ws["B1"] = sub
    ws["B1"].font = SUB_FONT
    ws.row_dimensions[1].height = 26
    return 3


def section(ws, row, text):
    ws.cell(row=row, column=1, value=text).font = SEC_FONT
    for c in range(1, 14):
        ws.cell(row=row, column=c).fill = SEC_FILL
    ws.row_dimensions[row].height = 20
    return row + 1


def header(ws, row, cols, widths=None):
    for i, c in enumerate(cols, start=1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font = H_FONT
        cell.fill = H_FILL
        cell.alignment = CENTER
        cell.border = BORDER
    ws.freeze_panes = ws.cell(row=row + 1, column=1)
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
    return row + 1


def note(ws, row, text):
    ws.cell(row=row, column=1, value=text).font = NOTE_FONT
    return row + 1


def yesno(v):
    return "✔" if v else ""


QUAL_FILL = {
    "全域": PatternFill("solid", fgColor="DDF3E0"),
    "多图": PatternFill("solid", fgColor="FFF4D6"),
    "单图专属": PatternFill("solid", fgColor="FFE3D0"),
    "非地图来源": PatternFill("solid", fgColor="E6ECF7"),
    "⚠": PatternFill("solid", fgColor="FFD5D5"),
}


def qual_fill(q):
    for k, f in QUAL_FILL.items():
        if q.startswith(k):
            return f
    return None


def src_text(sources):
    out = []
    for s in sources or []:
        t = s.get("where", "")
        w = s.get("what", "")
        q = s.get("qty")
        line = t + ("：" + w if w else "")
        if q:
            line += "（×%s）" % q
        out.append(line)
    return " ／ ".join(out)


def main():
    if len(sys.argv) < 2:
        print("用法：node tests/export_matrix.js（它会自动调本器）")
        sys.exit(2)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        data = json.load(f)

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "产出归属总表.xlsx")
    out_path = os.path.normpath(out_path)

    meta = data["meta"]
    areas = meta["areas"]
    items = data["items"]
    tower = data["tower"]
    trials = data["trials"]
    anomalies = data["anomalies"]
    gen = meta["generatedAt"]

    wb = Workbook()

    # ==================================================================
    # 页签 1 · 怎么用
    # ==================================================================
    ws = sheet(wb, "怎么用", first=True)
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 110
    r = title_row(ws, "永夜灵市 · 产出归属总表", "生成时间 " + gen)

    rows = [
        ("这张表是什么",
         "把所有「东西从哪来」摆在一张表上：普通地图 1~10、通天塔、副本（三条试炼）、任务、每日/每周兑换、"
         "分解、守关 Boss、商店。核心用来回答两个问题：哪些是【全域掉落】（好几张图都能掉），哪些是【区域专属】（只有某一张图掉）。"),
        ("这张表从哪来",
         "不手写。由 docs/tests/export_matrix.js 从代码现场抓（config.js / trial-config.js / tower-config.js / mat-wiki.js），"
         "再交给 export_matrix_xlsx.py 排成 Excel。改完数值重跑一次，这张表就是最新的。"),
        ("怎么重新生成",
         "cd docs  →  node tests/export_matrix.js        （一条命令，跑完覆盖本文件）"),
        ("⚠ 权重怎么读",
         "表里的数字是【相对权重】，不是百分比。只有在「同一张图内」或「同一层段内」归一化之后才等于概率。"
         "所以图10 的 125 和图1 的 100 不代表图10 掉得更多 —— 要看「占该图材料池 %」那一列。"),
        ("⚠ 装备和宠物蛋",
         "这两样不是材料，走的是【掉落总盘】（none / material / equipment / egg 四个档位），与材料子池不是同一把尺，"
         "所以不进「地图掉落矩阵」，单独列在「其他来源」页签里。"),
        ("「定性」怎么判",
         "按「这件东西在几张图会掉」判：10 张 = 全域；2~9 张 = 多图；1 张 = 单图专属；0 张但别处有 = 非地图来源；"
         "哪儿都没有 = ⚠ 无来源（断供）。"),
        ("「来源明细」那一列",
         "原样来自游戏内的材料词条推导（core/mat-wiki.js），跟玩家在背包里悬停看到的「从哪来」是同一份口径，不是另写一套。"),
        ("异常页签",
         "「异常与待定」全部由脚本自动对账得出，不是手工整理：① 登记在册却查不到任何来源（断供风险）"
         "② 出现在产出表却没登记（背包里会“找不到”的东西）③ 名义上有来源、词条却自己写着“暂未开放”的 "
         "④ 文案里的图号跟实际对不上的 ⑤ 同一份名单里重复登记的 ⑥ 已知口径待定、等你拍板的。"),
        ("本轮范围",
         "只出清单，没有改动任何数值、任何玩法、任何掉落机制。这张表是「现状照片」，不是「改后方案」。"),
    ]
    for k, v in rows:
        ws.cell(row=r, column=1, value=k).font = BOLD
        ws.cell(row=r, column=2, value=v).alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 30
        r += 1
    r += 1
    r = section(ws, r, "数据来源文件（改数值去这几处，改完重跑本表）")
    for f in ["docs/js/core/config.js     掉落总盘 / 10 图材料权重 / 区域材料 / 进化档位 / 任务与兑换 / 打造 / 分解",
              "docs/js/tower/tower-config.js   通天塔：层段材料池 / 档位奖励 / 保底",
              "docs/js/trial/trial-config.js   副本：三条路线 / 档位奖励 / 免费次数 / 门票注入",
              "docs/js/core/drop.js            守关 Boss 的稀有掉落（写在代码里，配置查不到）",
              "docs/js/core/mat-wiki.js       「从哪来」的唯一口径（本表的来源列复用它）"]:
        ws.cell(row=r, column=1, value=f).font = Font(size=9, color="5A5A66")
        r += 1

    # ==================================================================
    # 页签 2 · 物品总表
    # ==================================================================
    ws = sheet(wb, "物品总表")
    r = title_row(ws, "物品总表", "共 %d 行（含装备与宠物蛋）｜生成 %s" % (len(items), gen))
    cols = ["物品", "分类", "类型", "可交易", "播报档", "地图覆盖", "定性", "主要来源",
            "通天塔", "副本", "任务", "每日/每周兑换", "分解", "守关Boss", "商店", "来源明细"]
    widths = [14, 14, 8, 8, 7, 10, 18, 40, 8, 7, 6, 13, 7, 10, 6, 90]
    r = header(ws, r, cols, widths)
    for it in items:
        ws.cell(row=r, column=1, value=it["name"]).font = BOLD
        ws.cell(row=r, column=2, value=it["groupLabel"])
        ws.cell(row=r, column=3, value={"material": "素材", "consume": "消耗品", "gear": "装备", "egg": "蛋"}.get(it["kind"], it["kind"]))
        ws.cell(row=r, column=4, value="可" if it["tradable"] else "绑定")
        ws.cell(row=r, column=5, value=it["lootTier"])
        ws.cell(row=r, column=6, value="%d/10" % it["mapCoverage"] if it["mapCoverage"] else "—")
        cq = ws.cell(row=r, column=7, value=it["qualification"])
        f = qual_fill(it["qualification"])
        if f:
            cq.fill = f
        ws.cell(row=r, column=8, value=it["mainSource"])
        ws.cell(row=r, column=9, value=yesno(it["tower"]))
        ws.cell(row=r, column=10, value=yesno(it["trial"]))
        ws.cell(row=r, column=11, value=yesno(it["quest"]))
        ws.cell(row=r, column=12, value=yesno(it["exchange"]))
        ws.cell(row=r, column=13, value=yesno(it["salvage"]))
        ws.cell(row=r, column=14, value=yesno(it["boss"]))
        ws.cell(row=r, column=15, value=yesno(it["shop"]))
        ws.cell(row=r, column=16, value=src_text(it["sources"])).font = Font(size=9, color="5A5A66")
        for c in range(4, 16):
            ws.cell(row=r, column=c).alignment = CENTER
        r += 1
    ws.auto_filter.ref = "A3:P%d" % (r - 1)

    # ==================================================================
    # 页签 3 · 地图掉落矩阵
    # ==================================================================
    ws = sheet(wb, "地图掉落矩阵")
    r = title_row(ws, "地图掉落矩阵（物品 × 图 1~10）", "数字 = 该图材料子池里的相对权重；空白 = 这张图不出")
    r = note(ws, r, "⚠ 权重只在「同一张图内」可比：想看某件东西掉得常不常见，请横向比同一行、或看本页下方「按图看」里的占比；"
                    "图10 的 125 并不代表它比图1 的 100 掉得多。")
    r = note(ws, r, "⚠ 进化素材三档（普通/精粹/传说）自 2026-09-17 起是【三个独立键】，各自在每张图有自己的权重 —— "
                    "所以三档的格子都可以直接横向比较，不再需要「拆槽」换算。")
    r += 1
    cols = ["物品", "分类", "能掉的图数", "定性"] + ["图%d %s\nLv%s-%s" % (a["tier"], a["name"], a["levelRange"][0], a["levelRange"][1]) for a in areas]
    widths = [16, 14, 10, 16] + [11] * len(areas)
    r = header(ws, r, cols, widths)
    first_data = r
    matrix_items = [it for it in items if it["mapCoverage"] > 0]
    for it in matrix_items:
        ws.cell(row=r, column=1, value=it["name"]).font = BOLD
        ws.cell(row=r, column=2, value=it["groupLabel"])
        ws.cell(row=r, column=3, value=it["mapCoverage"]).alignment = CENTER
        cq = ws.cell(row=r, column=4, value=it["qualification"])
        f = qual_fill(it["qualification"])
        if f:
            cq.fill = f
        for a in areas:
            t = str(a["tier"])
            cell = ws.cell(row=r, column=4 + a["tier"])
            if t in it["mapWeights"]:
                cell.value = it["mapWeights"][t]
                cell.alignment = CENTER
            else:
                cell.value = "—"
                cell.font = GRAY_FONT
                cell.fill = GRAY_FILL
                cell.alignment = CENTER
        r += 1
    last_data = r - 1
    if last_data >= first_data:
        ws.conditional_formatting.add(
            "E%d:%s%d" % (first_data, get_column_letter(4 + len(areas)), last_data),
            ColorScaleRule(start_type="min", start_color="FFFFFF",
                           mid_type="percentile", mid_value=60, mid_color="FFE9A8",
                           end_type="max", end_color="F4A26B"))

    # 下方：按图看本图掉落清单
    r += 2
    r = section(ws, r, "按图看：每张图到底掉什么（按权重从高到低，% 是占该图材料池的比例）")
    for a in areas:
        t = str(a["tier"])
        rows = []
        for it in items:
            if t in it["mapWeights"]:
                rows.append((it["name"], it["mapWeights"][t], it["mapPct"].get(t, 0), it["groupLabel"]))
        rows.sort(key=lambda x: -x[1])
        ws.cell(row=r, column=1, value="图%d %s（Lv%s-%s）" % (a["tier"], a["name"], a["levelRange"][0], a["levelRange"][1])).font = BOLD
        ws.cell(row=r, column=2, value="共 %d 种" % len(rows)).font = SUB_FONT
        r += 1
        ws.cell(row=r, column=1, value="材料").font = SUB_FONT
        ws.cell(row=r, column=2, value="权重").font = SUB_FONT
        ws.cell(row=r, column=3, value="占该图材料池").font = SUB_FONT
        r += 1
        for name, w, pct, gl in rows:
            ws.cell(row=r, column=1, value=name)
            ws.cell(row=r, column=2, value=w).alignment = CENTER
            c = ws.cell(row=r, column=3, value=round(pct, 2))
            c.number_format = '0.00"%"'
            r += 1
        evo = next((e for e in data["evoSlots"] if e["tier"] == a["tier"]), None)
        if evo and evo["allowed"]:
            ws.cell(row=r, column=1,
                    value="进化素材三档：%s（本图合计 %s）" % (
                        " / ".join("%s %s" % (k, round(v * evo["sum"], 3)) for k, v in evo["share"].items()),
                        round(evo["sum"], 3))).font = SUB_FONT
            r += 1

    # ==================================================================
    # 页签 4 · 通天塔产出
    # ==================================================================
    ws = sheet(wb, "通天塔产出")
    r = title_row(ws, "通天塔产出", "每天免费 1 局；材料池按层段（1~10 / 11~20 / 21~30），档位奖励每 5 层一档")
    r = section(ws, r, "① 层段材料池（打怪掉落，权重为该层段内的相对值）")
    r = header(ws, r, ["层段", "物品", "权重", "占该层段材料池"],
               [16, 20, 10, 16])
    for b in tower["bands"]:
        total = sum(float(v) for v in b["weights"].values()) or 1
        for name, w in sorted(b["weights"].items(), key=lambda x: -x[1]):
            ws.cell(row=r, column=1, value="%d~%d 层" % (b["from"], b["to"]))
            ws.cell(row=r, column=2, value=name)
            ws.cell(row=r, column=3, value=w).alignment = CENTER
            c = ws.cell(row=r, column=4, value=round(float(w) / total * 100, 2))
            c.number_format = '0.00"%"'
            r += 1
    r += 1
    r = section(ws, r, "② 档位奖励（按最高到达层数取最深一档，与随机掉落互不替代）")
    r = header(ws, r, ["层数档", "装备", "材料"], [12, 34, 70])
    for t in tower["floorTiers"]:
        g = t.get("gear") or {}
        ws.cell(row=r, column=1, value="第 %d 层" % t["floor"]).font = BOLD
        ws.cell(row=r, column=2, value="%s ×%s（图档 %s / 底材T%s）" % (g.get("rarity", ""), g.get("count", ""), g.get("areaTier", ""), g.get("materialTier", "")))
        ws.cell(row=r, column=3, value="、".join("%s ×%s" % (i["name"], i["qty"]) for i in t.get("items", [])))
        r += 1
    r += 1
    r = section(ws, r, "③ 打怪掉落总盘（每只怪都摇一次：杂兵 120 次 + 守卫 30 次 / 局）")
    ld = tower["layerDrop"]
    r = header(ws, r, ["来源", "不落空", "材料", "装备"], [20, 12, 12, 12])
    for label, key in [("杂兵（每层 4 只）", "mobPool"), ("守卫（每层第 5 只）", "guardianPool")]:
        p = ld.get(key) or {}
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=p.get("none"))
        ws.cell(row=r, column=3, value=p.get("material"))
        ws.cell(row=r, column=4, value=p.get("equipment"))
        r += 1
    r += 1
    r = note(ws, r, "材料单次数量 %s~%s｜装备按最高图档生成、掉落即未鉴定" %
             ((tower["materialQty"] or {}).get("min"), (tower["materialQty"] or {}).get("max")))
    r = note(ws, r, "不足 5 层的保底：" + "、".join("%s ×%s" % (i["name"], i["qty"]) for i in tower["consolation"]))
    r += 1
    r = section(ws, r, "④ 塔外账本（登记「已从地图挪走、归通天塔」的高级物品 —— 防断供用）")
    r = header(ws, r, ["物品", "价值分", "用途", "塔外补充来源", "状态"], [16, 9, 46, 26, 12])
    for it in tower["ledger"]:
        ws.cell(row=r, column=1, value=it["name"])
        ws.cell(row=r, column=2, value=it.get("value")).alignment = CENTER
        ws.cell(row=r, column=3, value=it.get("note"))
        b = it.get("backup") or ""
        ws.cell(row=r, column=4, value=b if b else "（无）")
        c = ws.cell(row=r, column=5, value="有塔外来源" if b else "仅通天塔")
        c.font = Font(size=9, color="3C7A4A" if b else "A8521E")
        r += 1

    # ==================================================================
    # 页签 5 · 副本产出
    # ==================================================================
    ws = sheet(wb, "副本产出")
    r = title_row(ws, "副本 · 资源试炼产出", "三条路线，各自 20 层；每条路线每天免费 %s 次" % trials["freeEntriesPerDay"])
    r = note(ws, r, "门票：%s｜来源：%s" % (trials["ticketName"], trials["ticketSources"]))
    r += 1
    for rt in trials["routes"]:
        r = section(ws, r, "%s（解锁 Lv%s）" % (rt["name"], rt["minLevel"]))
        ws.cell(row=r, column=1, value=rt["desc"]).font = Font(size=9, color="5A5A66")
        r += 1
        r = header(ws, r, ["层数档", "奖励"], [12, 70])
        for t in rt["tiers"]:
            ws.cell(row=r, column=1, value="第 %d 层" % t["floor"])
            ws.cell(row=r, column=2, value="、".join("%s ×%s" % (i["name"], i["qty"]) for i in t["items"]))
            r += 1
        ws.cell(row=r, column=1, value="失败保底").font = BOLD
        ws.cell(row=r, column=2, value="、".join("%s ×%s" % (i["name"], i["qty"]) for i in rt["consolation"]))
        r += 2

    # ==================================================================
    # 页签 6 · 其他来源
    # ==================================================================
    ws = sheet(wb, "其他来源")
    r = title_row(ws, "其他来源", "掉落总盘 / 守关 Boss / 任务 / 兑换 / 分解 / 经验包 / 商店")
    dp = data["dropPool"]
    r = section(ws, r, "① 地图掉落总盘（每场战斗只摇 1 次，四档互斥 —— 装备与蛋走这里，不走材料子池）")
    r = header(ws, r, ["阶段", "覆盖图", "不落空", "材料", "装备", "宠物蛋"], [14, 22, 10, 10, 10, 10])
    stage_cover = {1: "图 1~3", 2: "图 4~7", 3: "图 8~10"}
    g = dp.get("pool") or {}
    ws.cell(row=r, column=1, value="全局兜底").font = BOLD
    ws.cell(row=r, column=2, value="测试/异常场景")
    for i, k in enumerate(["none", "material", "equipment", "egg"]):
        ws.cell(row=r, column=3 + i, value=g.get(k))
    r += 1
    for s in sorted((dp.get("poolByStage") or {}).keys()):
        p = dp["poolByStage"][s]
        ws.cell(row=r, column=1, value="阶段 " + str(s)).font = BOLD
        ws.cell(row=r, column=2, value=stage_cover.get(int(s), ""))
        for i, k in enumerate(["none", "material", "equipment", "egg"]):
            ws.cell(row=r, column=3 + i, value=p.get(k))
        r += 1
    r += 1

    r = section(ws, r, "② 守关 Boss（必掉 1 件金装 + 本图区域材料 ×5，另外独立掷下面这两个）")
    r = header(ws, r, ["物品", "概率", "数量"], [20, 12, 10])
    if data["boss"]:
        for b in data["boss"]:
            ws.cell(row=r, column=1, value=b["name"])
            c = ws.cell(row=r, column=2, value=b["pct"])
            c.number_format = '0.0"%"'
            ws.cell(row=r, column=3, value=b["qty"])
            r += 1
    else:
        ws.cell(row=r, column=1, value="（未从 drop.js 抠到常量，请人工核对 drop.js 的 boss 分支）")
        r += 1
    r += 1

    r = section(ws, r, "③ 任务奖励（按物品聚合：有多少条任务会给、单次最多几个）")
    r = header(ws, r, ["物品", "给它的任务数", "单次最多", "任务类型分布"], [16, 12, 10, 60])
    quest_by_item = {}
    for q in data["quests"]["rows"]:
        for n, v in q["reward"].items():
            quest_by_item.setdefault(n, []).append((q["id"], v, q["kind"]))
    for n in sorted(quest_by_item.keys()):
        lst = quest_by_item[n]
        kinds = {}
        for _, _, k in lst:
            kinds[k] = kinds.get(k, 0) + 1
        ws.cell(row=r, column=1, value=n).font = BOLD
        ws.cell(row=r, column=2, value=len(lst)).alignment = CENTER
        ws.cell(row=r, column=3, value=max(v for _, v, _ in lst)).alignment = CENTER
        ws.cell(row=r, column=4, value="、".join("%s×%d" % (k, v) for k, v in sorted(kinds.items(), key=lambda x: -x[1])))
        r += 1
    r += 1

    r = section(ws, r, "④ 每日 / 每周兑换（用富余物换紧缺物，有硬上限）")
    r = header(ws, r, ["id", "名称", "换到什么", "拿什么换", "需要", "上限", "解锁等级"], [16, 14, 24, 22, 8, 9, 10])
    for q in data["quests"]["exchanges"]:
        ws.cell(row=r, column=1, value=q["id"])
        ws.cell(row=r, column=2, value=q["name"]).font = BOLD
        ws.cell(row=r, column=3, value="、".join("%s ×%s" % (k, v) for k, v in q["reward"].items()))
        ws.cell(row=r, column=4, value=q["cost"] or "—")
        ws.cell(row=r, column=5, value=q["need"] if q["need"] is not None else "—").alignment = CENTER
        ws.cell(row=r, column=6, value="每日" if q["reset"] == "daily" else "每周").alignment = CENTER
        ws.cell(row=r, column=7, value=q["unlockLevel"] if q["unlockLevel"] is not None else "—").alignment = CENTER
        r += 1
    r += 1

    r = section(ws, r, "⑤ 分解产出（一键分解 / 单件分解，按稀有度结算）")
    r = header(ws, r, ["装备稀有度", "产出"], [14, 40])
    label = {"white": "白装", "blue": "蓝装", "gold": "金装"}
    for k in ["white", "blue", "gold"]:
        ws.cell(row=r, column=1, value=label.get(k, k))
        out = data["salvage"].get(k) or []
        ws.cell(row=r, column=2, value="、".join("%s ×%s" % (x["name"], x["qty"]) for x in out) if out else "无产出")
        r += 1
    r += 1

    r = section(ws, r, "⑥ 经验包（任务按经验折算发放 + 通天塔层掉落；一律绑定，不可交易）")
    r = header(ws, r, ["名称", "经验值"], [18, 12])
    for p in data["expPacks"]:
        ws.cell(row=r, column=1, value=p["name"])
        ws.cell(row=r, column=2, value=p["amount"]).alignment = CENTER
        r += 1
    r += 1

    r = section(ws, r, "⑦ 商店")
    sh = data["shop"]
    ws.cell(row=r, column=1, value="商店开关").font = BOLD
    ws.cell(row=r, column=2, value="开着" if sh["enabled"] else "关着")
    r += 1
    ws.cell(row=r, column=1, value="卖不卖材料").font = BOLD
    ws.cell(row=r, column=2, value="卖（配置里有材料商品）" if sh["hasMaterialGoods"] else "不卖材料（配置里没有 catalog 材料商品）")
    r += 1

    # ==================================================================
    # 页签 7 · 异常与待定
    # ==================================================================
    ws = sheet(wb, "异常与待定")
    r = title_row(ws, "异常与待定", "导出脚本自动对账出来的：断供风险 / 名册缺口 / 文案与实际不符 / 等你拍板的条目")
    r = section(ws, r, "① 登记在册但查不到任何来源（= 拿到手也没法再获得的死物，断供风险）")
    r = header(ws, r, ["物品", "分类", "说明"], [20, 16, 90])
    if anomalies["noSource"]:
        for x in anomalies["noSource"]:
            ws.cell(row=r, column=1, value=x["name"]).font = BOLD
            ws.cell(row=r, column=2, value=x["groupLabel"])
            ws.cell(row=r, column=3, value="地图 / 通天塔 / 副本 / 任务 / 兑换 / 分解 / 守关Boss / 商店 —— 八处全查不到")
            r += 1
    else:
        ws.cell(row=r, column=1, value="（无）")
        r += 1
    r += 1

    r = section(ws, r, "② 出现在产出表里、却没在 materialInfo 登记（放进背包会“找不到分类”的东西）")
    r = header(ws, r, ["物品", "它出现在哪"], [22, 70])
    if anomalies["unregistered"]:
        for x in anomalies["unregistered"]:
            ws.cell(row=r, column=1, value=x["name"]).font = BOLD
            ws.cell(row=r, column=2, value=x["where"])
            r += 1
    else:
        ws.cell(row=r, column=1, value="（无）")
        r += 1
    ws.cell(row=r, column=1, value="说明").font = SUB_FONT
    ws.cell(row=r, column=2, value="「装备」和「宠物蛋」不在 materialInfo 里是刻意的：它们走独立账（装备进 items 表、"
                                   "蛋进 pet_egg 表），所以本页不把它们算作漏登记。").font = SUB_FONT
    r += 2

    r = section(ws, r, "③ 名义上有来源、实际是空的（词条如实写了“暂未开放”，当前真的拿不到）")
    r = header(ws, r, ["物品", "分类", "词条原文"], [20, 16, 90])
    if anomalies["pendingSource"]:
        for x in anomalies["pendingSource"]:
            ws.cell(row=r, column=1, value=x["name"]).font = BOLD
            ws.cell(row=r, column=2, value=x["groupLabel"])
            ws.cell(row=r, column=3, value=x["text"])
            r += 1
    else:
        ws.cell(row=r, column=1, value="（无）")
        r += 1
    r += 1

    r = section(ws, r, "④ 文案写的图号跟实际对不上（拿游戏内词条里的「图N」跟真实地图序号对账）")
    r = header(ws, r, ["物品", "词条里写的", "实际所在图", "真实图名"], [20, 18, 14, 20])
    if anomalies["textMismatch"]:
        for x in anomalies["textMismatch"]:
            ws.cell(row=r, column=1, value=x["name"]).font = BOLD
            c = ws.cell(row=r, column=2, value=x["where"])
            c.font = Font(size=9, color="A8521E")
            ws.cell(row=r, column=3, value="图 %d" % x["real"])
            ws.cell(row=r, column=4, value=x["realAreaName"])
            r += 1
        r = note(ws, r, "成因：core/mat-wiki.js 用 areaMaterials 的**对象键顺序**当图号，而它的键顺序与 "
                        "Config.battle.areas 的排列不一致（blight-heart 排在键的第 6 位、实际是图 10），"
                        "于是 5 种区域材料的词条图号写错。本页的「地图掉落矩阵」用的是真实图号，可以对照。")
    else:
        ws.cell(row=r, column=1, value="（无）")
    r += 2

    r = section(ws, r, "⑤ 名册重复（同一个名字被登记了两次）")
    r = header(ws, r, ["名字", "重复次数", "登记在哪"], [20, 12, 50])
    if anomalies["dupRegistry"]:
        for x in anomalies["dupRegistry"]:
            ws.cell(row=r, column=1, value=x["name"]).font = BOLD
            ws.cell(row=r, column=2, value=x["count"]).alignment = CENTER
            ws.cell(row=r, column=3, value=x["where"])
            r += 1
        r = note(ws, r, "影响：市集上架/收款的下拉里会出现重复选项。同一份名单出现两行，改的时候容易只改一行。")
    else:
        ws.cell(row=r, column=1, value="（无）")
        r += 1
    r += 1

    r = section(ws, r, "⑥ 已知口径待定（历史记录，等拍板 —— 不是缺陷清单）")
    r = header(ws, r, ["条目", "代码现状", "文案/界面写的", "待你定"], [18, 44, 44, 34])
    ws.cell(row=r, column=1, value="通天塔重置卡").font = BOLD
    ws.cell(row=r, column=2, value="没有任何获取途径（每周兑换「塔券铸成」已于 2026-09-16 删除；商店也没上架）")
    ws.cell(row=r, column=3, value="塔详情页 / 百科页写着「魔石商店购买（60 魔石，每周限购 3 张）」")
    ws.cell(row=r, column=4, value="① 上架商店  ② 改文案成“暂未开放”")
    r += 1
    ws.cell(row=r, column=1, value="涅磐兽").font = BOLD
    ws.cell(row=r, column=2, value="只剩图 10 极低概率掉落（权重 0.05 ≈ 6.5 万场一个），已无消耗口")
    ws.cell(row=r, column=3, value="词条里标为“已退役的稀有收藏物”")
    ws.cell(row=r, column=4, value="保持现状 / 另给消耗口")
    r += 1

    wb.save(out_path)
    print("   写表完成 → " + out_path)


if __name__ == "__main__":
    main()
