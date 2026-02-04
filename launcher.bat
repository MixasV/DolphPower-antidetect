@echo off
SETLOCAL EnableDelayedExpansion

REM ========================================
REM   AntiDetect Browser - Launcher
REM ========================================

title AntiDetect Browser Launcher

:MENU
cls
echo.
echo ========================================
echo   AntiDetect Browser v0.2.0
echo   Production Ready - Sprints 1-5
echo ========================================
echo.
echo   [1] Start Server + Open UI (v2)
echo   [2] Start Server + Open UI (v1)
echo   [3] Start Server Only
echo   [4] Open UI Only (v2)
echo   [5] Build Project
echo   [6] Install Dependencies
echo   [7] Exit
echo.
echo ========================================
echo.

set /p choice="Select option (1-7): "

if "%choice%"=="1" goto START_V2
if "%choice%"=="2" goto START_V1
if "%choice%"=="3" goto START_SERVER
if "%choice%"=="4" goto OPEN_UI_V2
if "%choice%"=="5" goto BUILD
if "%choice%"=="6" goto INSTALL
if "%choice%"=="7" goto EXIT

echo Invalid choice!
timeout /t 2 >nul
goto MENU

:START_V2
cls
echo Starting V2...
REM Check build
if not exist "dist\" (
    echo [INFO] Project not built. Building now...
    call npm run build
)
start "DolfPower API Server" /MIN node dist/server/index.js
timeout /t 3 /nobreak >nul
start "" "%CD%\dist\ui\v2\index.html"
goto MENU

:START_V1
cls
echo Starting V1...
if not exist "dist\" (
    echo [INFO] Project not built. Building now...
    call npm run build
)
start "DolfPower API Server" /MIN node dist/server/index.js
timeout /t 3 /nobreak >nul
start "" "%CD%\dist\ui\index.html"
goto MENU

:OPEN_UI_V2
start "" "%CD%\dist\ui\v2\index.html"
goto MENU

:START_SERVER
cls
echo.
echo ========================================
echo   Starting API Server Only
echo ========================================
echo.

if not exist "dist\" (
    echo [ERROR] Project not built!
    echo Run option [4] to build first.
    pause
    goto MENU
)

echo Starting server...
echo.
echo Server will run on: http://127.0.0.1:3001
echo.
echo Press Ctrl+C to stop
echo.
node dist/server/index.js
pause
goto MENU

:OPEN_UI
cls
echo.
echo ========================================
echo   Opening UI
echo ========================================
echo.

echo Make sure server is running on http://127.0.0.1:3001
echo.
start "" "%CD%\src\ui\index.html"
echo UI opened in browser!
echo.
timeout /t 2 >nul
goto MENU

:BUILD
cls
echo.
echo ========================================
echo   Building Project
echo ========================================
echo.

if not exist "node_modules\" (
    echo [ERROR] Dependencies not installed!
    echo Run option [5] first.
    pause
    goto MENU
)

echo Building TypeScript...
call npm run build

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
) else (
    echo.
    echo [SUCCESS] Build completed!
    echo Output: dist/
)

echo.
pause
goto MENU

:INSTALL
cls
echo.
echo ========================================
echo   Installing Dependencies
echo ========================================
echo.

echo This will install all required packages...
echo.
pause

call npm install

if errorlevel 1 (
    echo.
    echo [ERROR] Installation failed!
) else (
    echo.
    echo [SUCCESS] Dependencies installed!
)

echo.
pause
goto MENU

:DOCS
cls
echo.
echo ========================================
echo   Documentation Files
echo ========================================
echo.
echo   Quick Start:
echo   - QUICK_LAUNCH.md
echo   - START_HERE.md
echo.
echo   Complete Guide:
echo   - ALL_SPRINTS_COMPLETE.md
echo   - PROJECT_README.md
echo.
echo   Technical:
echo   - IMPLEMENTATION_SUMMARY.md
echo   - PROGRESS.md
echo.
echo   Original Plan:
echo   - antidetect-browser-guide.md
echo   - code-implementation.md
echo.
echo ========================================
echo.

set /p opendoc="Open QUICK_LAUNCH.md? (y/n): "
if /i "%opendoc%"=="y" (
    start "" "QUICK_LAUNCH.md"
)

echo.
pause
goto MENU

:EXIT
cls
echo.
echo ========================================
echo   Shutting Down
echo ========================================
echo.

echo Stopping any running servers...
taskkill /F /FI "WINDOWTITLE eq AntiDetect API Server*" >nul 2>&1

echo.
echo Thank you for using AntiDetect Browser!
echo.
timeout /t 2 >nul
exit /b 0
