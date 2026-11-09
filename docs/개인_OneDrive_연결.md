# 내 OneDrive(개인 Microsoft 계정)에 연결하기

회사 IT 없이 개인 Microsoft 계정(outlook.com · hotmail.com · live.com 등)의 OneDrive에 저장하도록 웹앱을 설정하는 방법입니다. 처음 한 번만 하면 됩니다.

> 회사 품질 데이터(고객 클레임, 협력사 불량 등)가 개인 클라우드에 저장됩니다. 회사 보안 규정에 맞는지 먼저 확인하세요.

## 1. Azure 무료 계정 만들기 (처음 한 번)

2024년 6월부터 Microsoft는 새 앱을 등록할 때 디렉터리(테넌트)를 요구합니다. 개인 계정으로 Azure 무료 계정을 만들면 디렉터리가 함께 생깁니다.

1. https://azure.microsoft.com/free 에서 **무료로 시작**을 누르고, OneDrive에 쓰는 Microsoft 계정으로 로그인합니다
2. 본인 확인(휴대폰 · 신용카드)을 마칩니다
   - 카드는 본인 확인용입니다. 앱 등록은 무료이고, Azure 서비스(가상 머신 등)를 따로 만들지 않으면 요금이 나오지 않습니다

## 2. 앱 등록

1. https://portal.azure.com 에 같은 계정으로 로그인합니다
2. 위쪽 검색창에 **앱 등록**을 입력해 엽니다 → **새 등록**
3. 아래처럼 입력하고 **등록**을 누릅니다

| 항목 | 값 |
|---|---|
| 이름 | `QRQC 신속대응 추적표` |
| 지원되는 계정 유형 | **개인 Microsoft 계정만** |
| 리디렉션 URI — 플랫폼 | **단일 페이지 애플리케이션(SPA)** |
| 리디렉션 URI — 주소 | `https://sjkim88work-afk.github.io/QRQC/` (끝의 `/` 포함) |

4. 등록이 끝나면 **개요** 화면의 **애플리케이션(클라이언트) ID**를 복사해 둡니다
5. 왼쪽 **API 권한** → **권한 추가** → **Microsoft Graph** → **위임된 권한** → `Files.ReadWrite.All` 체크 → **권한 추가**
   - `User.Read`는 처음부터 들어 있습니다
   - 개인 계정은 관리자 동의가 필요 없습니다. 처음 로그인할 때 본인이 [동의]를 누르면 됩니다

## 3. 웹앱에 ID 넣기

1. GitHub 저장소에서 `web/config.js`를 열고 연필 아이콘(편집)을 누릅니다
2. 복사한 ID를 `clientId`에 붙여넣습니다. `tenantId`는 `'consumers'` 그대로 둡니다
   ```js
   window.QRQC_CONFIG = {
     clientId: '복사한 애플리케이션(클라이언트) ID',
     tenantId: 'consumers',
   };
   ```
3. **Commit changes**를 누릅니다. 1~2분 뒤 웹앱에 반영됩니다

## 4. 처음 로그인과 폴더 만들기

1. https://sjkim88work-afk.github.io/QRQC/ 를 엽니다 (아이폰: Safari → 공유 버튼 → 홈 화면에 추가)
2. **Microsoft 계정으로 로그인** → 권한 요청 화면에서 **동의**
3. **내 OneDrive에 새 폴더 만들기**를 누르면 OneDrive에 `QRQC_데이터` 폴더가 생기고 연결됩니다

## 5. 팀원과 함께 쓰기 (선택)

1. OneDrive(https://onedrive.live.com)에서 `QRQC_데이터` 폴더를 우클릭 → **공유**
2. **편집 가능**으로 링크를 만들어 팀원에게 보냅니다
3. 팀원도 Microsoft 계정(개인)으로 웹앱에 로그인한 뒤, **팀 폴더 연결**에 받은 링크를 붙여넣습니다

## 참고

- 무료 OneDrive는 5GB입니다. 첨부 사진·PDF가 많아지면 용량을 확인하세요 (Microsoft 365 Personal은 1TB)
- 지운 이슈·첨부는 OneDrive **휴지통**에서 되살릴 수 있고, 파일마다 **버전 기록**이 남습니다
- 나중에 회사 계정으로 옮기려면 회사 IT에 `docs/IT_앱등록_요청.md`로 등록을 요청하고, `config.js`의 두 값을 회사 것으로 바꾸면 됩니다 (OneDrive의 데이터 폴더는 회사 OneDrive로 복사)
