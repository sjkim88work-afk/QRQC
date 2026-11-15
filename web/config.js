/* QRQC 웹앱 설정 — Microsoft Entra ID 에 앱을 등록한 뒤 받은 값을 넣습니다.
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
window.QRQC_VERSION = '1.4.1';
