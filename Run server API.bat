@echo off
setlocal
set "LOG_FILE=%~dp0server-api.log"
echo Menjalankan server... >> "%LOG_FILE%"
echo --- %DATE% %TIME% --- >> "%LOG_FILE%"
powershell -NoProfile -Command "node server/server.js 2>&1 | Tee-Object -FilePath '%LOG_FILE%' -Append"
pause
endlocal
