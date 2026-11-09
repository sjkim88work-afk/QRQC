/* QRQC · Microsoft 365 연결 (웹앱 · 아이폰 홈 화면 앱용)
 *
 * 회사 Microsoft 계정으로 로그인하고, 팀이 함께 쓰는 OneDrive/SharePoint 폴더 하나에 저장합니다.
 *   <폴더>/settings.json            라인 목록, 순번 형식
 *   <폴더>/issues/<id>.json         이슈 1건 = 파일 1개
 *   <폴더>/decisions/<id>.json      회의 결정사항
 *   <폴더>/files/<이슈>/<항목>/      첨부 원본 (PDF · 이미지 · 엑셀)
 * - 같은 파일을 두 사람이 동시에 고치면 eTag(If-Match)로 충돌을 알아채고 최신 내용에 다시 합쳐 저장합니다.
 * - 지운 이슈 · 첨부는 SharePoint/OneDrive 휴지통으로 가므로 되살릴 수 있고, 파일마다 버전 기록이 남습니다.
 * - 각 사용자의 폴더 권한을 그대로 씁니다(위임 권한). 폴더에 접근 권한이 없는 사람은 열 수 없습니다.
 *
 * 화면(index.html)은 데스크톱 프로그램과 같은 '/api/...' 요청을 보내고, 이 파일이 그 요청을 Microsoft Graph 호출로 바꿉니다.
 */
(function () {
  'use strict';
  const CFG = window.QRQC_CONFIG || {};
  const TEST = window.QRQC_TEST || null;             // 시험용: 로그인 없이 가짜 토큰 사용
  const GRAPH = (TEST && TEST.graphBase) || 'https://graph.microsoft.com/v1.0';
  const SCOPES = ['User.Read', 'Files.ReadWrite.All'];
  const LS_FOLDER = 'qrqc-m365-folder';
  const LS_CACHE = 'qrqc-m365-cache-';
  const DEFAULT_SETTINGS = { lines: ['윈도우레귤레이터 1라인', '도어래치 조립 2라인', 'PSD 모터 조립', '프레스 3공정', '사출 성형'], noFormat: 'PHA-{YY}-{MM}-{NN}' };
  const ALLOWED = { pdf: 'pdf', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', bmp: 'img', webp: 'img', heic: 'img', xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', csv: 'sheet' };
  const SIMPLE_MAX = 4 * 1024 * 1024, MAX_ATTACH = 50 * 1024 * 1024, CHUNK = 5 * 1024 * 1024;   // CHUNK: 320KiB 의 배수

  let pca = null, account = null, me = { name: '', mail: '' };
  let folder = null;                                  // { driveId, id, name, webUrl }
  const folderIds = {};                               // 'issues' → id, 'files/x/cont' → id
  const meta = { issues: {}, decisions: {} };         // id → { itemId, eTag }
  let settingsMeta = null;
  let lastVersion = '';

  const err = (status, message) => Object.assign(new Error(message), { status });
  const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const deepMerge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]); else a[k] = clone(b[k]); } return a; };
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const seg = s => encodeURIComponent(s).replace(/'/g, '%27');
  const safeName = n => (String(n || '').split(/[\\/]/).pop().replace(/[<>:"|?*#%\x00-\x1f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '') || 'file').slice(0, 120);

  /* ---------------- 로그인 */
  async function init() {
    folder = lsGet(LS_FOLDER);
    if (TEST) { account = TEST.account || { name: '시험 사용자', username: 'test@example.com' }; me = { name: account.name, mail: account.username }; return { state: 'signed-in' }; }
    if (!CFG.clientId) return { state: 'unconfigured' };
    if (!window.msal) return { state: 'error', message: '로그인 구성요소를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.' };
    pca = new msal.PublicClientApplication({
      auth: { clientId: CFG.clientId, authority: 'https://login.microsoftonline.com/' + (CFG.tenantId || 'organizations'), redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: 'localStorage' },
    });
    await pca.initialize();
    let res = null;
    try { res = await pca.handleRedirectPromise(); } catch (e) { return { state: 'signed-out', message: '로그인하지 못했습니다: ' + (e.errorMessage || e.message) }; }
    if (res && res.account) pca.setActiveAccount(res.account);
    account = pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
    if (account) { pca.setActiveAccount(account); me = { name: account.name || account.username, mail: account.username }; }
    return { state: account ? 'signed-in' : 'signed-out' };
  }
  function login() { return pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); }
  function logout() { if (TEST) { location.reload(); return; } return pca.logoutRedirect({ account }); }
  async function token() {
    if (TEST) return TEST.token || 'test-token';
    try { return (await pca.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; }
    catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError || /interaction_required|login_required|consent_required/.test(e.errorCode || '')) {
        await pca.acquireTokenRedirect({ scopes: SCOPES, account });   // 페이지가 로그인으로 넘어갔다가 돌아옴
        throw err(401, '로그인이 만료되어 다시 로그인합니다');
      }
      throw err(401, '로그인 정보를 확인하지 못했습니다. 다시 로그인하세요');
    }
  }

  /* ---------------- Graph 호출 */
  async function g(method, path, opt = {}) {
    const url = /^https?:/.test(path) ? path : GRAPH + path;
    for (let attempt = 0; ; attempt++) {
      const headers = Object.assign({}, opt.headers || {});
      if (!opt.noAuth) headers.Authorization = 'Bearer ' + await token();
      let body = opt.body;
      if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && typeof body !== 'string') { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
      let r;
      try { r = await fetch(url, { method, headers, body }); }
      catch (e) { throw err(0, 'Microsoft 365에 연결할 수 없습니다. 인터넷 연결을 확인하세요'); }
      if ((r.status === 429 || r.status === 503 || r.status === 504) && attempt < 4) {
        const wait = Math.min(30, +(r.headers.get('Retry-After') || 0) || (2 ** attempt));
        await new Promise(res => setTimeout(res, wait * 1000)); continue;
      }
      if (opt.raw) return r;
      const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { }
      if (!r.ok) {
        const code = data && data.error && data.error.code || '';
        const msg = r.status === 401 ? '로그인이 만료되었습니다. 새로고침 후 다시 로그인하세요'
          : r.status === 403 ? '이 폴더에 접근할 권한이 없습니다. 폴더 소유자에게 편집 권한을 요청하세요'
          : r.status === 404 ? '폴더나 파일을 찾을 수 없습니다'
          : r.status === 412 ? 'conflict'
          : r.status === 507 ? 'OneDrive 저장 공간이 부족합니다'
          : `Microsoft 365 오류 (${r.status}${code ? ' ' + code : ''})`;
        throw Object.assign(err(r.status, msg), { code });
      }
      return data;
    }
  }
  const base = () => `/drives/${folder.driveId}/items`;

  async function childByName(parentId, name) {
    try { return await g('GET', `${base()}/${parentId}:/${seg(name)}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function ensureFolder(path) {           // 'issues' 또는 'files/<이슈>/<항목>'
    if (folderIds[path]) return folderIds[path];
    let parent = folder.id, acc = '';
    for (const part of path.split('/')) {
      acc = acc ? acc + '/' + part : part;
      if (folderIds[acc]) { parent = folderIds[acc]; continue; }
      let it = await childByName(parent, part);
      if (!it) {
        try { it = await g('POST', `${base()}/${parent}/children`, { body: { name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } }); }
        catch (e) { if (e.status === 409) it = await childByName(parent, part); else throw e; }   // 다른 사람이 동시에 만듦
      }
      parent = folderIds[acc] = it.id;
    }
    return parent;
  }
  async function listChildren(folderId) {
    let url = `${base()}/${folderId}/children?$top=999`, out = [];
    while (url) { const d = await g('GET', url); out = out.concat(d.value || []); url = d['@odata.nextLink'] || ''; }
    return out;
  }
  async function download(item) {
    let u = item['@microsoft.graph.downloadUrl'];
    if (!u) u = (await g('GET', `${base()}/${item.id}?$select=id,@microsoft.graph.downloadUrl`))['@microsoft.graph.downloadUrl'];
    const r = await fetch(u);
    if (!r.ok) throw err(r.status, '파일을 내려받지 못했습니다');
    return r;
  }
  async function readJson(item) { return JSON.parse(await (await download(item)).text()); }
  async function putJson(folderId, name, obj, eTag) {
    const headers = { 'Content-Type': 'application/json' };
    if (eTag) headers['If-Match'] = eTag;
    else headers['If-None-Match'] = '*';        // 새로 만들 때: 같은 이름이 이미 있으면 덮어쓰지 않음
    return g('PUT', `${base()}/${folderId}:/${seg(name)}:/content`, { body: JSON.stringify(obj, null, 1), headers });
  }

  /* ---------------- 폴더 연결 */
  function shareId(link) {
    const b64 = btoa(unescape(encodeURIComponent(link.trim()))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    return 'u!' + b64;
  }
  async function connectLink(link) {
    if (!/^https:\/\//i.test(link || '')) throw err(400, 'https:// 로 시작하는 OneDrive/SharePoint 폴더 공유 링크를 붙여넣으세요');
    const it = await g('GET', `/shares/${shareId(link)}/driveItem`, { headers: { Prefer: 'redeemSharingLinkIfNecessary' } });
    if (!it.folder) throw err(400, '파일이 아니라 폴더의 공유 링크가 필요합니다');
    return setFolder(it);
  }
  async function createInMyDrive(name) {
    const it = await g('POST', '/me/drive/root/children', { body: { name: name || 'QRQC_데이터', folder: {}, '@microsoft.graph.conflictBehavior': 'rename' } });
    return setFolder(it);
  }
  async function setFolder(it) {
    folder = { driveId: it.parentReference && it.parentReference.driveId || it.remoteItem && it.remoteItem.parentReference.driveId, id: it.id, name: it.name, webUrl: it.webUrl };
    for (const k in folderIds) delete folderIds[k];
    await ensureFolder('issues'); await ensureFolder('decisions');
    lsSet(LS_FOLDER, folder);
    return folder;
  }
  function forgetFolder() { folder = null; try { localStorage.removeItem(LS_FOLDER); } catch (e) { } }

  /* ---------------- 읽기 (eTag 가 같은 파일은 캐시 사용) */
  async function loadCol(col) {
    const fid = await ensureFolder(col);
    const items = (await listChildren(fid)).filter(i => i.file && /\.json$/i.test(i.name));
    const cache = lsGet(LS_CACHE + folder.id + '-' + col) || {};
    const next = {}, out = [];
    meta[col] = {};
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const it = items[i++], id = it.name.replace(/\.json$/i, '');
        let obj = cache[id] && cache[id].eTag === it.eTag ? cache[id].obj : null;
        if (!obj) { try { obj = await readJson(it); } catch (e) { continue; } }
        next[id] = { eTag: it.eTag, obj };
        meta[col][id] = { itemId: it.id, eTag: it.eTag };
        out.push(Object.assign(clone(obj), { id }));
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    lsSet(LS_CACHE + folder.id + '-' + col, next);
    return out;
  }
  async function loadSettings() {
    const it = await childByName(folder.id, 'settings.json');
    if (!it) { settingsMeta = null; return clone(DEFAULT_SETTINGS); }
    settingsMeta = { itemId: it.id, eTag: it.eTag };
    try { return Object.assign(clone(DEFAULT_SETTINGS), await readJson(it)); } catch (e) { return clone(DEFAULT_SETTINGS); }
  }
  async function version() {
    const parts = [];
    for (const col of ['issues', 'decisions']) {
      const items = await listChildren(await ensureFolder(col));
      parts.push(col + ':' + items.map(i => i.name + '=' + i.eTag).sort().join('|'));
    }
    const s = await childByName(folder.id, 'settings.json');
    parts.push('s:' + (s ? s.eTag : ''));
    let h = 0; const str = parts.join('#');
    for (let k = 0; k < str.length; k++) h = (h * 31 + str.charCodeAt(k)) | 0;
    return String(h);
  }
  function cachedAll() {   // 오프라인일 때 마지막으로 받은 내용
    if (!folder) return null;
    const pick = col => Object.entries(lsGet(LS_CACHE + folder.id + '-' + col) || {}).map(([id, v]) => Object.assign(clone(v.obj), { id }));
    return { issues: pick('issues'), decisions: pick('decisions') };
  }

  /* ---------------- 쓰기 */
  function stamp(obj, isNew) {
    obj.updatedBy = me.name; obj.updatedAt = nowStr();
    if (isNew || !obj.createdBy) { obj.createdBy = obj.createdBy || me.name; obj.createdAt = obj.createdAt || nowStr(); }
    return obj;
  }
  async function saveDoc(col, id, body, mode) {      // mode: 'put' | 'patch'
    const fid = await ensureFolder(col);
    for (let attempt = 0; attempt < 4; attempt++) {
      let m = meta[col][id];
      if (!m) { const it = await childByName(fid, id + '.json'); if (it) m = meta[col][id] = { itemId: it.id, eTag: it.eTag }; }
      let obj;
      if (mode === 'patch') {
        if (!m) throw err(404, '다른 사용자가 삭제한 항목입니다');
        // 항상 최신 내용 위에 합침 (eTag 와 내용을 같은 시점에서 읽음)
        const cur = await g('GET', `${base()}/${m.itemId}?$select=id,eTag,@microsoft.graph.downloadUrl`);
        const latest = await readJson(cur);
        obj = typeof body === 'function' ? body(latest) : deepMerge(latest, body);
        m.eTag = cur.eTag;
      } else obj = clone(body);
      delete obj.id;
      if (col === 'issues') await checkNo(id, obj.no);
      stamp(obj, !m);
      try {
        const it = await putJson(fid, id + '.json', obj, m && m.eTag);
        meta[col][id] = { itemId: it.id, eTag: it.eTag };
        return Object.assign(obj, { id });
      } catch (e) {
        if (e.status === 412 || e.status === 409) { delete meta[col][id]; continue; }   // 그사이 다른 사람이 저장 → 최신 내용으로 다시
        throw e;
      }
    }
    throw err(409, '다른 사용자가 같은 항목을 계속 고치고 있습니다. 잠시 후 다시 저장하세요');
  }
  let noIndex = {};
  async function checkNo(id, no) {
    if (!no) throw err(400, '순번을 입력하세요');
    if (noIndex[no] && noIndex[no] !== id) throw err(409, `순번 ${no} 은(는) 이미 사용 중입니다`);
  }
  async function deleteDoc(col, id) {
    const m = meta[col][id] || (await (async () => { const it = await childByName(await ensureFolder(col), id + '.json'); return it && { itemId: it.id }; })());
    if (m) await g('DELETE', `${base()}/${m.itemId}`);
    delete meta[col][id];
    if (col === 'issues') {
      const files = await childByName(await ensureFolder('files'), id);
      if (files) await g('DELETE', `${base()}/${files.id}`);
      Object.keys(folderIds).filter(k => k.startsWith('files/' + id)).forEach(k => delete folderIds[k]);
    }
  }
  async function saveSettings(b) {
    const cur = await loadSettings();
    if (b.lines) cur.lines = b.lines.map(s => String(s).trim()).filter(Boolean);
    if (b.noFormat) cur.noFormat = String(b.noFormat).trim();
    if (!cur.lines.length) throw err(400, '라인은 하나 이상 있어야 합니다');
    for (let attempt = 0; attempt < 3; attempt++) {
      try { const it = await putJson(folder.id, 'settings.json', cur, settingsMeta && settingsMeta.eTag); settingsMeta = { itemId: it.id, eTag: it.eTag }; return cur; }
      catch (e) { if (e.status !== 412 && e.status !== 409) throw e; await loadSettings(); }
    }
    throw err(409, '다른 사용자가 설정을 바꾸고 있습니다. 다시 저장하세요');
  }

  /* ---------------- 첨부 */
  async function upload(issueId, crit, file) {
    const name = safeName(file.name), ext = (name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED[ext]) throw err(415, 'PDF, 이미지(JPG·PNG·HEIC 등), 엑셀(XLSX·XLS·CSV) 파일만 첨부할 수 있습니다');
    if (file.size > MAX_ATTACH) throw err(413, '파일당 50MB까지 첨부할 수 있습니다');
    const fid = await ensureFolder(`files/${issueId}/${crit}`);
    let it;
    if (file.size <= SIMPLE_MAX) {
      it = await g('PUT', `${base()}/${fid}:/${seg(name)}:/content?@microsoft.graph.conflictBehavior=rename`, { body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    } else {
      const s = await g('POST', `${base()}/${fid}:/${seg(name)}:/createUploadSession`, { body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } } });
      for (let off = 0; off < file.size; off += CHUNK) {
        const end = Math.min(file.size, off + CHUNK);
        const r = await g('PUT', s.uploadUrl, { noAuth: true, raw: true, body: file.slice(off, end), headers: { 'Content-Range': `bytes ${off}-${end - 1}/${file.size}` } });
        if (!r.ok && r.status !== 202) throw err(r.status, '첨부를 올리지 못했습니다');
        if (end === file.size) it = await r.json();
      }
    }
    const f = { id: it.id, name: it.name, ext, kind: ALLOWED[ext], size: it.size || file.size, at: nowStr().slice(0, 10), by: me.name, webUrl: it.webUrl || '' };
    const issue = await saveDoc('issues', issueId, cur => {
      cur.cd = cur.cd || {}; cur.cd[crit] = cur.cd[crit] || {};
      cur.cd[crit].files = (cur.cd[crit].files || []).concat([f]);
      return cur;
    }, 'patch');
    return { file: f, issue };
  }
  async function removeAttachment(attId, issueId, crit) {
    try { await g('DELETE', `${base()}/${attId}`); } catch (e) { if (e.status !== 404) throw e; }
    return saveDoc('issues', issueId, cur => {
      if (cur.cd && cur.cd[crit]) cur.cd[crit].files = (cur.cd[crit].files || []).filter(f => f.id !== attId);
      return cur;
    }, 'patch');
  }
  const urlCache = {};
  async function attUrl(attId) {      // 미리 인증된 짧은 수명 주소 (이미지 미리보기 · 내려받기)
    const c = urlCache[attId];
    if (c && Date.now() - c.t < 30 * 60 * 1000) return c.u;
    const it = await g('GET', `${base()}/${attId}?$select=id,webUrl,@microsoft.graph.downloadUrl`);
    urlCache[attId] = { u: it['@microsoft.graph.downloadUrl'], w: it.webUrl, t: Date.now() };
    return urlCache[attId].u;
  }
  async function webUrl(attId) { await attUrl(attId); return urlCache[attId].w; }
  async function saveAs(attId, name) {
    const r = await fetch(await attUrl(attId));
    const blob = await r.blob();
    downloadBlob(blob, name);
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ---------------- 화면의 /api/... 요청을 Graph 로 */
  function findAttachment(lop, attId) {
    for (const r of lop) for (const k in (r.cd || {})) for (const f of (r.cd[k].files || [])) if (f.id === attId) return { issue: r, crit: k, file: f };
    return null;
  }
  async function api(method, url, body) {
    const p = url.replace(/^\/api\//, '').split('?')[0];
    if (p === 'config' && method === 'GET') return { dataDir: folder ? folder.name : '', ok: !!folder, user: me.name, version: (window.QRQC_VERSION || ''), suggest: '', window: false, m365: true };
    if (!folder) throw err(409, '저장 폴더가 연결되지 않았습니다');
    if (p === 'all' && method === 'GET') {
      const [issues, decisions, settings] = await Promise.all([loadCol('issues'), loadCol('decisions'), loadSettings()]);
      noIndex = {}; issues.forEach(r => { if (r.no) noIndex[r.no] = r.id; });
      lastVersion = await version();
      return { issues, decisions, production: [], settings, version: lastVersion, dataDir: folder.name, usedNos: issues.map(r => r.no),
        db: { path: folder.webUrl, name: folder.name, m365: true } };
    }
    if (p === 'version' && method === 'GET') return { version: await version() };
    if (p === 'settings' && method === 'PUT') return saveSettings(body || {});
    const m = p.match(/^(issues|decisions)\/([A-Za-z0-9_.\-]{1,80})$/);
    if (m) {
      const [, col, id] = m;
      if (method === 'PUT') { const o = await saveDoc(col, id, body, 'put'); if (col === 'issues') noIndex[o.no] = id; return o; }
      if (method === 'PATCH') { const o = await saveDoc(col, id, body, 'patch'); if (col === 'issues') noIndex[o.no] = id; return o; }
      if (method === 'DELETE') { await deleteDoc(col, id); if (col === 'issues') for (const k in noIndex) if (noIndex[k] === id) delete noIndex[k]; return { deleted: true }; }
    }
    if (p === 'attach/delete') {
      const hit = findAttachment(window.QRQC_ISSUES ? window.QRQC_ISSUES() : [], body.att);
      if (!hit) throw err(404, '첨부를 찾을 수 없습니다');
      return { issue: await removeAttachment(body.att, hit.issue.id, hit.crit) };
    }
    if (p === 'open') {
      if (body.root) { window.open(folder.webUrl, '_blank', 'noopener'); return { ok: true }; }
      if (body.backups) throw err(400, 'Microsoft 365에서는 파일마다 버전 기록이 남습니다. 폴더를 열어 파일의 [버전 기록]이나 휴지통에서 되살리세요');
      const w = await webUrl(body.att); window.open(w, '_blank', 'noopener'); return { ok: true };
    }
    if (p === 'attach/saveas') {
      const hit = findAttachment(window.QRQC_ISSUES ? window.QRQC_ISSUES() : [], body.att);
      await saveAs(body.att, hit ? hit.file.name : 'file'); return { path: '' };
    }
    if (p === 'export') { downloadBlob(new Blob(['﻿' + (body.text || '')], { type: 'text/csv' }), body.name || 'export.csv'); return { path: body.name }; }
    if (p === 'backup') throw err(400, 'Microsoft 365에서는 따로 백업하지 않아도 파일마다 버전 기록과 휴지통이 남습니다');
    throw err(404, '지원하지 않는 요청입니다: ' + p);
  }

  window.QG = { init, login, logout, api, upload, attUrl, connectLink, createInMyDrive, forgetFolder, cachedAll,
    get folder() { return folder; }, get me() { return me; }, get configured() { return !!(CFG.clientId || TEST); } };
})();
