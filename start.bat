@echo off
chcp 65001 >nul
title News Alert

echo.
echo   ╔══════════════════════════════════════╗
echo   ║     News Alert  新闻聚合推送系统     ║
echo   ╚══════════════════════════════════════╝
echo.

:: ── Step 1: Find Node.js ──
where node >nul 2>&1
if %errorlevel% equ 0 goto :has_node

for /d %%D in ("%LOCALAPPDATA%\Programs\node-*") do (
    if exist "%%D\node.exe" (
        set "PATH=%%D;%PATH%"
        goto :has_node
    )
)
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    goto :has_node
)

echo   [!] 未检测到 Node.js
echo.
echo   请先安装 Node.js:
echo   https://nodejs.org/
echo.
echo   下载 LTS 版本，双击安装，一路 Next 即可。
echo   安装完成后重新双击本文件。
echo.
pause
exit /b 1

:has_node
for /f "tokens=*" %%v in ('node -v') do echo   [✓] Node.js %%v

:: ── Step 2: Install dependencies ──
if exist "%~dp0app\node_modules\" goto :deps_ok
echo.
echo   [*] 首次运行，正在安装依赖（约 30 秒）...
echo.
cd /d "%~dp0app"
npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo.
    echo   [!] 依赖安装失败，请检查网络连接后重试。
    pause
    exit /b 1
)
echo.
echo   [✓] 依赖安装完成
:deps_ok

:: ── Step 3: Start background service + open browser ──
echo.
echo   [*] 正在启动后台服务...
echo   [*] 浏览器将自动打开控制面板
echo   [*] 如未自动打开，请手动访问: http://localhost:3201
echo.
echo   [*] 启动完成后本窗口会自动关闭
echo.

start "" wscript.exe "%~dp0run-background.vbs"
timeout /t 3 /nobreak >nul
start "" http://localhost:3201
exit /b 0
