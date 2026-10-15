@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0"
set "APP_DIR=%PROJECT_ROOT%app"
set "NODE_EXE="

cd /d "%APP_DIR%"

where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "delims=" %%I in ('where node 2^>nul') do (
        if not defined NODE_EXE set "NODE_EXE=%%~fI"
    )
)
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE_EXE (
    echo [News Alert] Node.js not found, exiting.
    exit /b 1
)

"%NODE_EXE%" "scripts\autostart-launcher.js" --source=start-service-bat
set "EXIT_CODE=%errorlevel%"
exit /b %EXIT_CODE%
