@echo off
rem Evernight Bazaar launcher - double-click me to play.
rem
rem 用 tools/serve.js（Node，并发）当本地服务器，端口被占会自动顺延。
rem
rem 🔴 这里【不能】再用 `python -m http.server`：它是单线程的，而游戏页要拉 143 个 js/css
rem    + 几百张图。缓存全的时候撑得住，但强刷清缓存/换端口后一次性全量拉会被它击穿
rem    —— 实测有 27 个资源直接 ECONNREFUSED，其中就有 battle.js / idle-bridge.js / ui-battle.js，
rem    表现是"挂机不跑 + 立绘不显示"，看起来像一堆互不相干的 bug（2026-09-21 踩过）。
cd /d "%~dp0"
node tools\serve.js 8030 --open
