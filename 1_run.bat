@echo off
setlocal
cd /d "%~dp0"
title QRQC Tracker

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py -3"
  set "PYW=pyw -3"
) else (
  set "PY=python"
  set "PYW=pythonw"
)
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Python is not installed.
  echo     Install Python 3.12 from https://www.python.org/downloads/
  echo     and check "Add python.exe to PATH" during setup.
  echo.
  pause
  exit /b 1
)

if not exist ".deps_ok" (
  echo Installing program window component ^(first run only^)...
  %PY% -m pip install --disable-pip-version-check -q -r requirements.txt
  if errorlevel 1 (
    echo [!] Could not install pywebview. The program will open in your web browser instead.
  ) else (
    echo ok> ".deps_ok"
  )
)

%PY% -c "import webview" >nul 2>nul
if errorlevel 1 (
  echo Opening in web browser. Keep this window open while you use the program.
  %PY% app.py --browser
) else (
  start "" %PYW% app.py
)
endlocal
