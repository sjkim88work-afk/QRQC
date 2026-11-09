# -*- mode: python ; coding: utf-8 -*-
"""QRQC 데스크톱 묶음 설정 — pyinstaller packaging/QRQC.spec
  윈도우: dist/QRQC/QRQC.exe (폴더째 배포, QIS 와 같은 방식)

  한 파일(--onefile) 방식은 실행할 때마다 %TEMP% 에 풀어서 실행하므로, 회사 보안 프로그램이
  막거나 관리자 승인을 요구할 수 있다. 그래서 폴더 방식으로 묶는다.
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

ROOT = Path(SPECPATH).parent
ICON = str(ROOT / "packaging" / "icon.png")   # Pillow 가 .ico 로 바꿔 줌

datas = [(str(ROOT / "web"), "web"), (str(ROOT / "README_사용법.txt"), ".")] + collect_data_files("webview")

a = Analysis(
    [str(ROOT / "app.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=["webview", "winfix"],
    excludes=["tkinter", "pytest", "numpy", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="QRQC",
    console=False,
    icon=ICON,
    codesign_identity=None,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="QRQC", upx=False)
