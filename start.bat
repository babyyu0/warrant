@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [오류] Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요.
    pause
    exit /b 1
)

if not exist node_modules (
    echo 처음 실행합니다. 의존성을 설치합니다...
    call npm install
    if errorlevel 1 (
        echo [오류] npm install에 실패했습니다.
        pause
        exit /b 1
    )
)

if not exist .next (
    echo 프로덕션 빌드를 생성합니다...
    call npm run build
    if errorlevel 1 (
        echo [오류] 빌드에 실패했습니다.
        pause
        exit /b 1
    )
)

echo 서버를 시작합니다...
start "Warrant Server" cmd /k npm start
timeout /t 3 /nobreak >nul
start "" http://localhost:3000

echo 서버는 별도 창(Warrant Server)에서 계속 실행됩니다. 종료하려면 그 창을 닫으세요.
pause
