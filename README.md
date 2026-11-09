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

## 설치 (Python 필요 없음)

1. **[QRQC_Tracker.exe 내려받기](https://github.com/sjkim88work-afk/QRQC/releases/latest/download/QRQC_Tracker.exe)** — 항상 최신 버전
2. 내려받은 exe를 더블클릭해 실행
   - "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** (서명하지 않은 사내용 프로그램이라 처음에 뜨는 안내)
3. 데이터 폴더 지정 — 팀이 함께 쓰려면 공유폴더(예: `\\서버\품질\신속대응`)

`main`에 변경이 병합될 때마다 GitHub Actions가 Windows에서 exe를 빌드하고 실행 시험을 거쳐 [Releases](https://github.com/sjkim88work-afk/QRQC/releases)에 올립니다.

### 개발용 실행 (소스에서)

- `1_run.bat` — Python 3.12 필요, 첫 실행 시 pywebview 설치
- `2_build_exe.bat` — 직접 `dist\QRQC_Tracker.exe` 빌드

자세한 내용은 [README_사용법.txt](README_사용법.txt)를 참고하세요.

## 구조

```
app.py            내장 서버(127.0.0.1 전용) + 프로그램 창(pywebview, 없으면 브라우저)
web/index.html    화면 (외부 CDN 없이 동작)
1_run.bat         실행
2_build_exe.bat   PyInstaller 단일 exe 빌드
.github/workflows/build-exe.yml   Windows exe 자동 빌드·실행 시험·Releases 게시
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
