@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
set "LOG_DIR=%ROOT_DIR%logs"
set "RESTART_DELAY_SECONDS=5"
set "NODE_EXE="

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "LOG_DATE=%%I"
set "LOG_FILE=%LOG_DIR%\server-api-%LOG_DATE%.log"

for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"

pushd "%ROOT_DIR%" >nul

if not defined NODE_EXE (
  set "EXIT_CODE=9009"
  call :write_log [launcher][%DATE% %TIME%] node.exe tidak ditemukan di PATH
  goto finish
)

call :write_log [launcher][%DATE% %TIME%] supervisor started, log file: %LOG_FILE%
call :write_log [launcher][%DATE% %TIME%] using node executable: %NODE_EXE%

:run
call :write_log [launcher][%DATE% %TIME%] starting node server/server.js
powershell -NoProfile -Command "& { $encoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = $encoding; & '%NODE_EXE%' server/server.js 2>&1 | Tee-Object -FilePath '%LOG_FILE%' -Append; exit $LASTEXITCODE }"
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" (
  call :write_log [launcher][%DATE% %TIME%] node exited normally with code 0, supervisor stopped
  goto finish
)

call :write_log [launcher][%DATE% %TIME%] node exited with code %EXIT_CODE%, restarting in %RESTART_DELAY_SECONDS% seconds
timeout /t %RESTART_DELAY_SECONDS% /nobreak >nul
goto run

:write_log
echo %*
>> "%LOG_FILE%" echo %*
goto :eof

:finish
popd >nul
endlocal
exit /b %EXIT_CODE%
