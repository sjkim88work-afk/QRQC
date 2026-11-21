/* QRQC 웹앱 설정
 * 비워 두면(기본) 웹앱은 로그인 없이 '이 기기에 저장' 방식으로 동작합니다. OneDrive 보관은 백업 파일로 합니다.
 * OneDrive 실시간 연결까지 쓰려면 Microsoft Entra ID 에 앱을 등록한 뒤 받은 값을 넣습니다 (설정 탭에 [OneDrive에 실시간 연결] 버튼이 생김).
 *   clientId : 애플리케이션(클라이언트) ID
 *   tenantId : 로그인할 계정 종류
 *              'consumers'      개인 Microsoft 계정(내 OneDrive)   → docs/개인_OneDrive_연결.md
 *              회사 테넌트 ID    회사 계정(OneDrive for Business)    → docs/IT_앱등록_요청.md
 * 두 값은 비밀번호가 아닙니다(로그인 화면 주소에 그대로 보이는 값). 비밀 값(client secret)은 쓰지 않습니다.
 */
window.QRQC_CONFIG = {
  clientId: '',
  tenantId: 'consumers',
};
window.QRQC_VERSION = '1.9.1';
