@echo off
setlocal

cd /d "E:\BB_pro\gitHub\tools_102BossHireTag"

rem Locate bash.exe from the Git installation on PATH.
for /f "delims=" %%i in ('where git 2^>nul') do set "GIT_EXE=%%i"
if not defined GIT_EXE (
    echo git was not found on PATH. Install Git for Windows first.
    exit /b 1
)
for %%i in ("%GIT_EXE%\..\..\bin\bash.exe") do set "BASH_EXE=%%~fi"

if not exist "%BASH_EXE%" (
    echo bash.exe not found at %BASH_EXE%.
    exit /b 1
)

"%BASH_EXE%" stop.sh
