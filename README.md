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

## 아이폰 · 웹앱 (Microsoft 365)

설치 없이 브라우저로 씁니다. 회사 Microsoft 365 계정으로 로그인하고, 팀 공유 OneDrive/SharePoint 폴더에 저장합니다.

- 주소: **https://sjkim88work-afk.github.io/QRQC/**
- 아이폰: Safari로 열고 공유 버튼 › **홈 화면에 추가** → 앱처럼 실행
  - 추적표가 카드 목록으로 보이고, 항목 칸을 누르면 상세 입력 창이 열립니다. [사진 찍기]로 현장 사진을 바로 첨부합니다
- 처음 한 번: 폴더 담당자가 [내 OneDrive에 새 폴더 만들기] → 그 폴더를 팀원과 **편집 가능**으로 공유 → 팀원은 공유 링크를 붙여넣어 연결
- 저장: 이슈 1건 = JSON 파일 1개, 첨부는 `files/<이슈>/<항목>/`. 동시에 고치면 eTag로 충돌을 알아채 최신 내용에 합쳐 저장합니다. 지운 것은 OneDrive 휴지통, 파일마다 버전 기록이 남습니다
- 준비: [IT 앱 등록 요청](docs/IT_앱등록_요청.md) → 받은 ID를 `web/config.js`에 입력 · 저장소 Settings › Pages › Source를 **GitHub Actions**로 설정
- 데스크톱 프로그램(SQLite)과는 저장 위치가 다릅니다. 한 팀은 한 가지 방식으로 쓰세요

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
3. `QRQC.app`을 **우클릭(control+클릭) › 열기** → 경고 창에서 다시 **열기** (서명하지 않은 사내용 프로그램이라 처음 한 번)
   - **열기** 버튼이 없으면: **완료**(휴지통으로 이동은 누르지 않기) → **시스템 설정 › 개인정보 보호 및 보안** 아래쪽 `QRQC`의 **그래도 열기**
   - 그래도 안 되면 터미널에서 한 번: `xattr -dr com.apple.quarantine /Applications/QRQC.app`
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
web/graph.js      웹앱: Microsoft 365(Graph) 저장 · 로그인(web/lib/msal-browser)
web/config.js     웹앱: IT가 등록한 앱 ID
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
