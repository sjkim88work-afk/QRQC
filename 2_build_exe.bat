@echo off
setlocal
cd /d "%~dp0"
title Build QRQC

where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo [!] Python is not installed. Install Python 3.12 from https://www.python.org/downloads/
  pause
  exit /b 1
)

echo [1/3] Installing build tools...
%PY% -m pip install --disable-pip-version-check -q -r requirements-build.txt
if errorlevel 1 (
  echo [!] pip install failed. Check the internet connection or proxy settings.
  pause
  exit /b 1
)

echo [2/3] Building dist\QRQC\QRQC.exe ^(1-3 minutes^)...
%PY% -m PyInstaller --noconfirm --clean packaging\QRQC.spec
if errorlevel 1 (
  echo [!] Build failed. See the messages above.
  pause
  exit /b 1
)

echo [3/3] Self test...
start "" /wait dist\QRQC\QRQC.exe --selftest selftest.json
type selftest.json

echo.
echo Done: dist\QRQC  ^(copy the whole QRQC folder, not only QRQC.exe^)
echo.
explorer dist
pause
endlocal
