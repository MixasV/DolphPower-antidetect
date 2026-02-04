@echo off
echo ========================================
echo DolfPower - Running Test
echo ========================================
echo.

REM Check if server is running
echo Checking if server is running...
curl -s http://127.0.0.1:3001/v1.0/browser_profiles >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server is not running!
    echo Please start the server first:
    echo   npm run dev:server
    echo.
    pause
    exit /b 1
)

echo [OK] Server is running
echo.

REM Run the test
if "%1"=="" (
    echo Running test with first available profile...
    node examples\test-mixas.js
) else (
    echo Running test with profile: %1
    node examples\test-mixas.js %1
)

echo.
pause
