/* QRQC · 기기 저장 모드 (로그인 · 앱 등록 없이 바로 사용)
 *
 * 이 브라우저(아이폰 홈 화면 앱 포함)의 IndexedDB 에 이슈 · 결정사항 · 설정 · 첨부 원본을 저장합니다.
 * - 인터넷이 없어도 동작합니다.
 * - OneDrive 에는 '백업 파일'로 보관합니다: [백업 저장] → (아이폰) 공유 › 파일에 저장 › OneDrive.
 *   다른 기기에서는 [백업 불러오기]로 같은 파일을 골라 이어서 씁니다.
 * - 아이폰 Safari 는 홈 화면에 추가하지 않은 사이트의 저장 데이터를 오래 안 쓰면 지울 수 있으니,
 *   홈 화면에 추가해서 쓰고 백업을 정기적으로 저장하세요.
 *
 * 화면(index.html)은 데스크톱과 같은 '/api/...' 요청을 보내고, 이 파일이 그 요청을 IndexedDB 작업으로 바꿉니다.
 */
(function () {
  'use strict';
  const DB_NAME = 'qrqc', DB_VER = 1;
  const STORES = ['issues', 'decisions', 'settings', 'files'];
  const DEFAULT_SETTINGS = { lines: ['윈도우레귤레이터 1라인', '도어래치 조립 2라인', 'PSD 모터 조립', '프레스 3공정', '사출 성형'], noFormat: 'PHA-{YY}-{MM}-{NN}' };
  const ALLOWED = { pdf: 'pdf', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', bmp: 'img', webp: 'img', heic: 'img', xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', csv: 'sheet' };
  const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', heic: 'image/heic',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', xls: 'application/vnd.ms-excel', csv: 'text/csv' };
  const MAX_ATTACH = 50 * 1024 * 1024;
  const LS_USER = 'qrqc-local-user', LS_BACKUP = 'qrqc-local-last-backup', LS_REV = 'qrqc-local-rev';

  let db = null;
  const err = (status, message) => Object.assign(new Error(message), { status });
  const clone = o => JSON.parse(JSON.stringify(o));
  const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const deepMerge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]); else a[k] = clone(b[k]); } return a; };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const user = () => ls.get(LS_USER) || '';
  const bump = () => ls.set(LS_REV, String((+ls.get(LS_REV) || 0) + 1));

  /* ---------------- IndexedDB */
  function open() {
    return new Promise((ok, no) => {
      if (!window.indexedDB) return no(err(500, '이 브라우저는 기기 저장을 지원하지 않습니다. Safari·Chrome·Edge 최신 버전을 쓰세요'));
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(err(500, '기기 저장소를 열 수 없습니다. 사생활 보호(비공개) 모드에서는 저장되지 않습니다'));
    });
  }
  function tx(store, mode, fn) {
    return new Promise((ok, no) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => ok(out);
      t.onerror = () => no(err(500, t.error && t.error.name === 'QuotaExceededError' ? '기기 저장 공간이 부족합니다. 오래된 첨부를 지우거나 백업 후 정리하세요' : '저장하지 못했습니다'));
      t.onabort = t.onerror;
    });
  }
  const req = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const getAll = store => tx(store, 'readonly', s => req(s.getAll()));
  const getOne = (store, id) => tx(store, 'readonly', s => req(s.get(id)));
  const put = (store, obj) => tx(store, 'readwrite', s => { s.put(obj); });
  const del = (store, id) => tx(store, 'readwrite', s => { s.delete(id); });

  async function init() {
    db = await open();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
    return { state: 'ready' };
  }

  /* ---------------- 읽기 · 쓰기 */
  async function settings() {
    const s = await getOne('settings', 'main');
    return Object.assign(clone(DEFAULT_SETTINGS), s ? s.value : {});
  }
  async function saveDoc(col, id, body, mode) {
    const cur = await getOne(col, id);
    let obj;
    if (mode === 'patch') {
      if (!cur) throw err(404, '삭제된 항목입니다');
      obj = deepMerge(clone(cur), body);
    } else obj = clone(body);
    obj.id = id;
    if (col === 'issues') {
      if (!obj.no) throw err(400, '순번을 입력하세요');
      const dup = (await getAll('issues')).find(r => r.no === obj.no && r.id !== id);
      if (dup) throw err(409, `순번 ${obj.no} 은(는) 이미 사용 중입니다`);
    }
    obj.updatedBy = user(); obj.updatedAt = nowStr();
    if (!cur) { obj.createdBy = obj.createdBy || user(); obj.createdAt = obj.createdAt || nowStr(); }
    else { obj.createdBy = cur.createdBy || obj.createdBy; obj.createdAt = cur.createdAt || obj.createdAt; }
    await put(col, obj); bump();
    return clone(obj);
  }
  async function deleteDoc(col, id) {
    await del(col, id);
    if (col === 'issues') for (const f of await getAll('files')) if (f.issueId === id) await del('files', f.id);
    bump();
  }

  /* ---------------- 첨부 */
  async function upload(issueId, crit, file) {
    const name = String(file.name || 'file').split(/[\\/]/).pop().slice(0, 120), ext = (name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED[ext]) throw err(415, 'PDF, 이미지(JPG·PNG·HEIC 등), 엑셀(XLSX·XLS·CSV) 파일만 첨부할 수 있습니다');
    if (file.size > MAX_ATTACH) throw err(413, '파일당 50MB까지 첨부할 수 있습니다');
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const blob = file.slice(0, file.size, file.type || MIME[ext] || 'application/octet-stream');
    await put('files', { id, issueId, crit, name, ext, kind: ALLOWED[ext], size: file.size, blob });
    const f = { id, name, ext, kind: ALLOWED[ext], size: file.size, at: nowStr().slice(0, 10), by: user() };
    const cur = await getOne('issues', issueId);
    if (!cur) throw err(404, '이슈를 찾을 수 없습니다');
    cur.cd = cur.cd || {}; cur.cd[crit] = cur.cd[crit] || {};
    const files = (cur.cd[crit].files || []).concat([f]);
    const issue = await saveDoc('issues', issueId, { cd: { [crit]: { files } } }, 'patch');
    return { file: f, issue };
  }
  async function removeAttachment(attId) {
    const rec = await getOne('files', attId);
    const issueId = rec ? rec.issueId : null;
    await del('files', attId);
    const issues = issueId ? [await getOne('issues', issueId)] : await getAll('issues');
    for (const r of issues) {
      if (!r) continue;
      for (const k in (r.cd || {})) {
        const before = (r.cd[k].files || []).length;
        const files = (r.cd[k].files || []).filter(f => f.id !== attId);
        if (files.length !== before) return saveDoc('issues', r.id, { cd: { [k]: { files } } }, 'patch');
      }
    }
    throw err(404, '첨부를 찾을 수 없습니다');
  }
  const urls = {};
  async function attUrl(attId) {
    if (urls[attId]) return urls[attId];
    const rec = await getOne('files', attId);
    if (!rec) throw err(404, '첨부를 찾을 수 없습니다');
    return (urls[attId] = URL.createObjectURL(rec.blob));
  }
  async function fileRec(attId) { const r = await getOne('files', attId); if (!r) throw err(404, '첨부를 찾을 수 없습니다'); return r; }

  /* ---------------- 파일로 내보내기 (아이폰: 공유 시트 → 파일에 저장 → OneDrive) */
  async function deliver(blob, name, title) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    const touch = window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: title || name }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return 'downloaded';
  }
  const b64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(blob); });
  const unb64 = (s, type) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };

  async function backup() {
    const [issues, decisions, files] = await Promise.all([getAll('issues'), getAll('decisions'), getAll('files')]);
    const out = { app: 'QRQC', kind: 'backup', format: 1, version: window.QRQC_VERSION || '', exportedAt: nowStr(), exportedBy: user(),
      settings: await settings(), issues, decisions, files: [] };
    for (const f of files) out.files.push({ id: f.id, issueId: f.issueId, crit: f.crit, name: f.name, ext: f.ext, kind: f.kind, size: f.size, data: await b64(f.blob) });
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const name = `QRQC_백업_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
    const how = await deliver(new Blob([JSON.stringify(out)], { type: 'application/json' }), name, 'QRQC 백업');
    if (how !== 'cancelled') ls.set(LS_BACKUP, nowStr());
    return { name, how, issues: issues.length, files: files.length };
  }
  async function readBackup(file) {
    let o;
    try { o = JSON.parse(await file.text()); } catch (e) { throw err(400, '백업 파일을 읽을 수 없습니다. QRQC에서 저장한 .json 파일인지 확인하세요'); }
    if (!o || o.app !== 'QRQC' || !Array.isArray(o.issues)) throw err(400, 'QRQC 백업 파일이 아닙니다');
    return o;
  }
  async function restore(o) {
    for (const s of ['issues', 'decisions', 'files']) await tx(s, 'readwrite', st => { st.clear(); });
    for (const r of o.issues) await put('issues', r);
    for (const r of (o.decisions || [])) await put('decisions', r);
    for (const f of (o.files || [])) await put('files', { id: f.id, issueId: f.issueId, crit: f.crit, name: f.name, ext: f.ext, kind: f.kind, size: f.size, blob: unb64(f.data, MIME[f.ext] || 'application/octet-stream') });
    if (o.settings) await put('settings', { id: 'main', value: { lines: o.settings.lines, noFormat: o.settings.noFormat } });
    for (const k in urls) { URL.revokeObjectURL(urls[k]); delete urls[k]; }
    bump();
    return { issues: o.issues.length, decisions: (o.decisions || []).length, files: (o.files || []).length };
  }
  async function usage() {
    try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch (er) { return null; }
  }

  /* ---------------- 화면의 /api/... 요청 */
  async function api(method, url, body) {
    const p = url.replace(/^\/api\//, '').split('?')[0];
    if (p === 'config' && method === 'GET') return { dataDir: '이 기기', ok: true, user: user(), version: window.QRQC_VERSION || '', suggest: '', window: false, browser: true };
    if (p === 'all' && method === 'GET') {
      const [issues, decisions, s] = await Promise.all([getAll('issues'), getAll('decisions'), settings()]);
      return { issues, decisions, production: [], settings: s, version: ls.get(LS_REV) || '0', dataDir: '이 기기', usedNos: issues.map(r => r.no),
        db: { browser: true, lastBackup: ls.get(LS_BACKUP) || '', usage: await usage() } };
    }
    if (p === 'version' && method === 'GET') return { version: ls.get(LS_REV) || '0' };
    if (p === 'settings' && method === 'PUT') {
      const cur = await settings();
      if (body.lines) cur.lines = body.lines.map(s => String(s).trim()).filter(Boolean);
      if (body.noFormat) cur.noFormat = String(body.noFormat).trim();
      if (!cur.lines.length) throw err(400, '라인은 하나 이상 있어야 합니다');
      await put('settings', { id: 'main', value: cur }); bump();
      return cur;
    }
    const m = p.match(/^(issues|decisions)\/([A-Za-z0-9_.\-]{1,80})$/);
    if (m) {
      const [, col, id] = m;
      if (method === 'PUT') return saveDoc(col, id, body, 'put');
      if (method === 'PATCH') return saveDoc(col, id, body, 'patch');
      if (method === 'DELETE') { await deleteDoc(col, id); return { deleted: true }; }
    }
    if (p === 'attach/delete') return { issue: await removeAttachment(body.att) };
    if (p === 'open') {
      if (body.root || body.backups) throw err(400, '기기 저장 모드에서는 폴더가 없습니다. 설정 탭의 [백업 저장]으로 파일을 보관하세요');
      const r = await fileRec(body.att);
      window.open(await attUrl(body.att), '_blank', 'noopener');
      return { ok: true, name: r.name };
    }
    if (p === 'attach/saveas') { const r = await fileRec(body.att); await deliver(r.blob, r.name); return { path: '' }; }
    if (p === 'export') { await deliver(new Blob(['﻿' + (body.text || '')], { type: 'text/csv' }), body.name || 'export.csv', 'QRQC 추적표'); return { path: body.name }; }
    if (p === 'backup') return backup();
    throw err(404, '지원하지 않는 요청입니다: ' + p);
  }

  window.QL = { init, api, upload, attUrl, backup, readBackup, restore,
    setUser(n) { ls.set(LS_USER, String(n || '').trim()); }, get user() { return user(); }, get lastBackup() { return ls.get(LS_BACKUP) || ''; } };
})();
