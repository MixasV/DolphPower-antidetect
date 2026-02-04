@echo off
echo ========================================
echo DolfPower - Test Automation Setup
echo ========================================
echo.

echo Checking dependencies...
echo.

REM Check if puppeteer-core is installed
npm list puppeteer-core >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing puppeteer-core...
    call npm install puppeteer-core
) else (
    echo [OK] puppeteer-core is installed
)

REM Check if axios is installed
npm list axios >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing axios...
    call npm install axios
) else (
    echo [OK] axios is installed
)

echo.
echo ========================================
echo Dependencies installed!
echo ========================================
echo.
echo To run the test:
echo   node examples\test-mixas.js
echo.
echo Or with specific profile ID:
echo   node examples\test-mixas.js YOUR_PROFILE_ID
echo.
pause
