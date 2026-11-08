@echo off
setlocal
cd /d "%~dp0"
title Build QRQC_Tracker.exe

where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo [!] Python is not installed. Install Python 3.12 from https://www.python.org/downloads/
  pause
  exit /b 1
)

echo [1/2] Installing build tools...
%PY% -m pip install --disable-pip-version-check -q -r requirements.txt pyinstaller
if errorlevel 1 (
  echo [!] pip install failed. Check the internet connection or proxy settings.
  pause
  exit /b 1
)

echo [2/2] Building QRQC_Tracker.exe ^(1-3 minutes^)...
%PY% -m PyInstaller --noconfirm --clean --onefile --windowed --name QRQC_Tracker --add-data "web;web" app.py
if errorlevel 1 (
  echo [!] Build failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo Done: dist\QRQC_Tracker.exe
echo Copy this single file to each PC ^(or a shared folder^) and double-click to run.
echo.
explorer dist
pause
endlocal
