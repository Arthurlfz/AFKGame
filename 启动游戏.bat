@echo off
rem Forge of Souls launcher - double-click me to play.
rem (keeps a local server on port 8030 and opens the game via http, never file://)
cd /d "%~dp0docs"
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8030 -State Listen -ErrorAction SilentlyContinue; if (-not $c) { Start-Process python -ArgumentList '-m','http.server','8030' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden; Start-Sleep -Seconds 1 }"
start "" "http://localhost:8030/%%E6%%B8%%B8%%E6%%88%%8F.html"
