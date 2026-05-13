@echo off
setlocal

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

wscript.exe "%PROJECT_DIR%start_hidden.vbs"
exit /b %ERRORLEVEL%
