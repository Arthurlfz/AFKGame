#!/usr/bin/env python3
"""
版本号自动生成工具
用法：python bump_versions.py
原理：扫描 游戏.html 里所有 css/js 引用，按文件内容 SHA256 前 8 位生成版本号。
      内容变了版本号自动变，没改的不变，浏览器缓存不失效。
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
HTML = ROOT / "docs" / "游戏.html"

# 匹配 href="xxx.css?v=yyy" 或 src="xxx.js?v=yyy"，也匹配没有 ?v= 的
PATTERN = re.compile(
    r'(href|src)="(css/[^"]+\.css|js/[^"]+\.js)(?:\?v=([^"]*))?"'
)

def file_hash(path: Path) -> str:
    if not path.exists():
        return None
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()[:8]

def main():
    if not HTML.exists():
        print(f"ERROR: {HTML} not found")
        sys.exit(1)

    html = HTML.read_text(encoding="utf-8")
    changed = 0
    skipped = 0

    def replacer(m):
        nonlocal changed, skipped
        attr, rel, old_v = m.group(1), m.group(2), m.group(3)
        fpath = ROOT / "docs" / rel
        new_v = file_hash(fpath)
        if new_v is None:
            print(f"  SKIP (file not found): {rel}")
            skipped += 1
            return m.group(0)
        if old_v == new_v:
            return m.group(0)  # 没变，保持原样
        changed += 1
        if old_v:
            print(f"  UPDATE {rel}: {old_v} -> {new_v}")
        else:
            print(f"  ADD    {rel}: ?v={new_v}")
        return f'{attr}="{rel}?v={new_v}"'

    new_html = PATTERN.sub(replacer, html)

    if new_html != html:
        HTML.write_text(new_html, encoding="utf-8")
        print(f"\nDone: {changed} updated, {skipped} skipped.")
    else:
        print(f"\nNothing changed (all version numbers already match content hashes).")

if __name__ == "__main__":
    main()
