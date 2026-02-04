@echo off
echo ========================================
echo   DolfPower - Build and Start
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
)

echo [1/2] Building project...
call npm run build

if %errorlevel% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b %errorlevel%
)

echo [2/2] Starting application...
call npm start

echo.
echo Application closed.
pause
