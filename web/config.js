/* QRQC 웹앱 설정 — 회사 IT가 Microsoft Entra ID 에 앱을 등록한 뒤 받은 값을 넣습니다.
 *   clientId : 애플리케이션(클라이언트) ID
 *   tenantId : 디렉터리(테넌트) ID
 * 두 값은 비밀번호가 아닙니다(로그인 화면 주소에 그대로 보이는 값). 비밀 값(client secret)은 쓰지 않습니다.
 * 자세한 내용: docs/IT_앱등록_요청.md
 */
window.QRQC_CONFIG = {
  clientId: '',
  tenantId: '',
};
window.QRQC_VERSION = '1.4.0';
