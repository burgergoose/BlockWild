@echo off
title Blockwild
cd /d "%~dp0"
where node >nul 2>nul || (echo Blockwild needs Node.js 18 or newer. Install the LTS version from https://nodejs.org and run this again. & pause & exit /b)
echo Starting the Blockwild server...
start "Blockwild server (close this window to stop the game)" node server.js
timeout /t 3 /nobreak >nul
if exist replays\latest-save.json.gz (node host.js load) else (node host.js new --bots)
node host.js start
for /f "delims=" %%u in ('node host.js url') do set "BWURL=%%u"
start "" "%BWURL%"
echo.
echo Blockwild is running in your browser. Press PLAY to jump in!
echo Close the "Blockwild server" window to stop the game (it auto-saves every 3 minutes).
timeout /t 8 >nul
