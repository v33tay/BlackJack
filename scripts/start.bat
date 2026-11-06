@echo off
setlocal

cd /d "%~dp0.."

if "%PORT%"=="" set "PORT=3000"
if "%HOST%"=="" set "HOST=0.0.0.0"

if not exist node_modules\ws (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting BlackJack server...
node src\server\index.js
exit /b %ERRORLEVEL%
