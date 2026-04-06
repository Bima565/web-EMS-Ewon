@echo off
setlocal
set "LOG_FILE=%~dp0server-api.log"
if exist "%LOG_FILE%" del /q "%LOG_FILE%" >nul 2>&1
echo Menjalankan server...
echo --- %DATE% %TIME% ---
(
  echo Menjalankan server...
  echo --- %DATE% %TIME% ---
) > "%LOG_FILE%"
powershell -NoProfile -Command "& { $encoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = $encoding; node server/server.js 2>&1 | ForEach-Object { $_ | Out-File -FilePath '%LOG_FILE%' -Append -Encoding UTF8; $_ } }"
pause
endlocal
