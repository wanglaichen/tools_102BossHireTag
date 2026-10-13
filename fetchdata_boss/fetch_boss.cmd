@echo off
REM 导入真实岗位 JSON（不造假）
REM 用法:
REM   fetch_boss.cmd --from-json jobs.json
REM   fetch_boss.cmd --purge-demo

setlocal EnableExtensions
cd /d "%~dp0\.."

if "%~1"=="" goto usage

set "PY=python"
where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if not errorlevel 1 set "PY=py"
)

"%PY%" "%~dp0fetch_boss_jobs.py" %*
exit /b %ERRORLEVEL%

:usage
echo 已停用假数据。用法:
echo   fetch_boss.cmd --from-json jobs.json
echo   fetch_boss.cmd --purge-demo
exit /b 1
