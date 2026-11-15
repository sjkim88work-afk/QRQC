# QRQC

공정품질 신속대응회의(QRQC) 대시보드와 신속대응 추적표(Fast Response Tracking Sheet)를 관리하는 Windows 데스크톱 프로그램입니다.

## 주요 기능

- **대시보드**: 진행 이슈·R·봉쇄 미완료·Exit Criteria 달성률·최근 종결, 라인별 이슈 현황, 오늘 다룰 항목
- **회의 진행 순서 1~6**: 단계 버튼으로 해당 화면·필터 이동, 20분 경과 타이머
- **신속대응 추적표**: Exit Criteria 9개 항목(24HR·2D·7D·9D·10D·14D) R/Y/G 관리
  - 계획일은 발견일 기준 자동 계산, 계획일 초과 시 자동 R
  - 항목별 상세 입력 창: 완료일자·확인자·상세내용·첨부(PDF, 이미지, 엑셀 원본을 DB에 저장)
  - 회의 모드, 화면 맞춤·배율, CSV(엑셀) 내보내기
- **회의 결정사항**: 담당·기한 관리, 미완료 이월, 회의록 복사
- **설정**: 데이터베이스 위치·백업, 라인(발견장소) 목록, 순번 형식(`{YYYY}` `{YY}` `{MM}` `{DD}` `{N…}`)

## 아이폰 · 웹앱 (설치 · 로그인 없음)

주소를 열면 바로 씁니다. 앱 등록이나 Microsoft 로그인이 필요 없습니다.

- 주소: **https://sjkim88work-afk.github.io/QRQC/**
- 아이폰: Safari로 열고 공유 버튼 › **홈 화면에 추가** → 앱처럼 실행
  - 추적표가 카드 목록으로 보이고, 항목 칸을 누르면 상세 입력 창이 열립니다. [사진 찍기]로 현장 사진을 바로 첨부합니다
- 저장: 그 기기(브라우저)의 IndexedDB에 이슈 · 결정사항 · 설정 · 첨부 원본을 저장합니다. 인터넷이 없어도 동작합니다
- **OneDrive 보관 · 기기 옮기기**: 설정 탭 [백업 파일 저장] → 첨부까지 담긴 `QRQC_백업_날짜.json` 하나
  - 아이폰은 공유 창 › **파일에 저장 › OneDrive**, PC는 내려받은 파일을 OneDrive 폴더에
  - 다른 기기에서 [백업 불러오기]로 그 파일을 고르면 같은 내용으로 이어서 씁니다 (그 기기 내용은 백업으로 바뀜)
  - 마지막 백업 후 7일이 지나면 알려 줍니다
- 한계: 기기마다 따로 저장되므로 여러 사람이 실시간으로 같은 데이터를 보려면 데스크톱 프로그램(공유폴더)을 쓰세요
- 선택: OneDrive 실시간 연결 — `web/config.js`에 앱 ID를 넣으면 설정 탭에 [OneDrive에 실시간 연결] 버튼이 생깁니다 (이슈 1건 = JSON 파일 1개, eTag 충돌 감지·병합)
  - 개인 OneDrive: [내 OneDrive에 연결하기](docs/개인_OneDrive_연결.md) · 회사 계정: [IT 앱 등록 요청](docs/IT_앱등록_요청.md)

## 설치 (Python 필요 없음)

QIS 데스크톱과 같은 방식입니다. 윈도우 10·11과 맥(Apple Silicon)을 지원합니다.

### 윈도우

1. **[QRQC-windows.zip 내려받기](https://github.com/sjkim88work-afk/QRQC/releases/latest/download/QRQC-windows.zip)** — 항상 최신 버전
2. zip을 **우클릭 › 압축 풀기**로 풉니다 (zip 안에서 바로 실행하지 마세요)
3. 풀린 `QRQC` 폴더를 원하는 곳에 둡니다. 예: `C:\QRQC` 또는 `문서\QRQC`
   - `QRQC.exe`만 따로 옮기지 말고 **폴더째** 두세요 (`_internal` 폴더가 함께 있어야 합니다)
   - `C:\Program Files`처럼 관리자 권한이 필요한 위치는 피하세요
4. `QRQC.exe` 더블클릭 → 처음에 데이터 폴더 지정 (팀이 함께 쓰려면 공유폴더)
   - "Windows의 PC 보호" 창이 뜨면 **추가 정보 › 실행**

### 맥 (Apple Silicon: M1·M2·M3·M4 …)

1. **[QRQC-mac.zip 내려받기](https://github.com/sjkim88work-afk/QRQC/releases/latest/download/QRQC-mac.zip)** → 더블클릭해 압축 풀기
2. `QRQC.app`을 **응용 프로그램** 폴더로 끌어 옮기기
3. **터미널**을 열고 아래 한 줄을 실행합니다 (인터넷에서 받은 표시 지우기 — 처음 한 번)
   ```
   xattr -dr com.apple.quarantine /Applications/QRQC.app
   ```
   - 이걸 하지 않으면 "'QRQC'은(는) 손상되었기 때문에 열 수 없습니다"가 뜹니다. 파일이 망가진 게 아니라 Apple 공증을 받지 않은 앱을 macOS가 막는 것이니 **[휴지통으로 이동]은 누르지 말고 [취소]** 후 위 명령을 실행하세요
   - "확인되지 않은 개발자" 경고만 뜨면 **우클릭 › 열기**나 **시스템 설정 › 개인정보 보호 및 보안 › 그래도 열기**로도 열 수 있습니다
   - 설치 없이 쓰려면 맥에서도 웹앱 주소(https://sjkim88work-afk.github.io/QRQC/)를 Safari·Chrome으로 열면 됩니다
4. 데이터 폴더 지정 — 윈도우 PC들과 같은 공유폴더를 쓰려면 Finder › 이동 › 서버에 연결(`smb://서버/품질`)로 연결한 뒤 그 폴더(`/Volumes/…`)를 고릅니다

관리자 권한은 필요 없습니다. 프로그램은 일반 사용자 권한(asInvoker)으로 실행되고, 설정은 `%LOCALAPPDATA%\QRQC`에 저장합니다.

`main`에 변경이 병합될 때마다 GitHub Actions가 윈도우와 맥에서 빌드하고, 실행 점검(윈도우는 인터넷에서 받은 파일 표시가 붙은 상태까지)을 거쳐 [Releases](https://github.com/sjkim88work-afk/QRQC/releases)에 올립니다.

### 개발용 실행 (소스에서)

- `1_run.bat` — Python 3.12 필요, 첫 실행 시 pywebview 설치
- `2_build_exe.bat` — 직접 `dist\QRQC\QRQC.exe` 빌드 (폴더째 배포)

자세한 내용은 [README_사용법.txt](README_사용법.txt)를 참고하세요.

## 구조

```
app.py            내장 서버(127.0.0.1 전용) + 프로그램 창(pywebview, 없으면 브라우저)
web/index.html    화면 (외부 CDN 없이 동작 · 데스크톱/웹앱 공용)
web/local.js      웹앱 기본: 이 기기에 저장(IndexedDB) · 백업 파일 저장/불러오기
web/graph.js      웹앱 선택: Microsoft 365(Graph) 저장 · 로그인(web/lib/msal-browser)
web/config.js     웹앱: OneDrive 실시간 연결용 앱 ID (비우면 기기 저장만)
web/sw.js · web/manifest.webmanifest   홈 화면 앱(PWA)
1_run.bat         실행
2_build_exe.bat   PyInstaller 빌드 (packaging/QRQC.spec, 폴더 방식)
winfix.py         윈도우 시작 보정: 받은 zip의 차단 표시 해제, 오류 안내
.github/workflows/build-exe.yml   윈도우·맥 빌드, 실행 점검(--selftest), Releases 게시
```

## 데이터 저장 (SQLite)

데이터 폴더(공유폴더 권장)에 데이터베이스 파일 하나로 저장합니다.

```
qrqc.db      이슈, Exit Criteria 상세, 첨부자료, 회의 결정사항, 설정
backups/     프로그램을 켤 때 하루 한 번 자동 백업 (최근 30개), 설정 탭의 [지금 백업]
exports/     [엑셀로 내보내기] CSV
```

| 테이블 | 내용 |
|---|---|
| `issues` | 이슈 기본 정보 (순번, 발견일자, 차종, 품명, 품번, 발견장소, 문제내용, 조치사항, 완료일자 등) |
| `issue_criteria` | 이슈별 Exit Criteria 9개 항목의 상태(R/Y/G/NA), 완료일자, 확인자, 상세내용 |
| `attachments` | 첨부 원본(BLOB) — PDF, 이미지(png·jpg·gif·bmp·webp), 엑셀(xlsx·xlsm·xls·csv), 파일당 50MB |
| `decisions` | 회의 결정사항 |
| `settings` | 라인 목록, 순번 형식 |
| `v_issues` (뷰) | 이슈 + Exit Criteria 상태를 한 줄로 펼친 조회용 뷰 (엑셀·Power BI 연결용) |

- 공유폴더(SMB)에서도 안전하도록 WAL 대신 기본 저널 모드와 잠금 대기(30초)를 씁니다.
- 삭제는 `deleted_at`에 표시만 남기므로 복구할 수 있습니다. 모든 행에 작성자·수정자와 시각이 기록됩니다.
- 다른 사용자의 변경은 8초 간격으로 감지해 화면에 반영합니다. 같은 이슈를 동시에 수정하면 나중에 저장한 내용이 남습니다.
- v1.0의 JSON 데이터(`issues/`, `decisions/`, `files/`)가 있으면 처음 실행할 때 DB로 옮깁니다. 원래 파일은 지우지 않습니다.
