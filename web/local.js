/* QRQC · 기기 저장 모드 (로그인 · 앱 등록 없이 바로 사용)
 *
 * 데이터는 데스크톱 프로그램과 '같은 구조'의 SQLite 데이터베이스(qrqc.db)로 이 기기에 저장합니다.
 *   - SQLite 엔진: sql.js (web/lib/sql-wasm.js · sql-wasm.wasm, MIT)
 *   - 테이블: issues · issue_criteria · attachments · decisions · settings · meta, 조회용 뷰 v_issues
 *   - 첨부 원본(PDF · 이미지 · 엑셀 · 파워포인트)은 화면이 빠르도록 브라우저 저장소에 따로 두고,
 *     [백업 파일 저장] 때 attachments.data(BLOB)에 넣어 qrqc.db 하나로 내보냅니다.
 * - 백업 파일(QRQC_백업_날짜.db)은 데스크톱 프로그램의 qrqc.db와 같은 형식입니다.
 *   이름을 qrqc.db 로 바꿔 데이터 폴더에 넣으면 데스크톱 프로그램에서 그대로 열리고,
 *   DB Browser for SQLite · 엑셀(ODBC) · Power BI 에서도 v_issues 뷰로 바로 볼 수 있습니다.
 * - 반대로 데스크톱의 qrqc.db 를 [백업 불러오기]로 고르면 아이폰에서도 같은 내용을 봅니다.
 * - 인터넷이 없어도 동작합니다. 아이폰은 홈 화면에 추가해서 쓰고, 백업을 정기적으로 저장하세요.
 *
 * 화면(index.html)은 데스크톱과 같은 '/api/...' 요청을 보내고, 이 파일이 그 요청을 SQL 로 처리합니다.
 */
(function () {
  'use strict';
  const IDB_NAME = 'qrqc', IDB_VER = 2;
  const SCHEMA_VERSION = 2;   // 2: 조치 · 진행 기록(issue_log), attachments.log_id
  const CRITS = ['cont', 'rca', 'act', 'ep', 'lpa', 'ver', 'pfmea', 'sw', 'll'];
  const STATES = ['R', 'Y', 'G', 'NA'];
  const DEFAULT_SETTINGS = { lines: ['윈도우레귤레이터 1라인', '도어래치 조립 2라인', 'PSD 모터 조립', '프레스 3공정', '사출 성형'], noFormat: 'PHA-{YY}-{MM}-{NN}' };
  // 허용 첨부: PDF · 이미지 · 엑셀 · 파워포인트  (데스크톱 app.py 의 ALLOWED 와 같게)
  const ALLOWED = {
    pdf: ['pdf', 'application/pdf'],
    png: ['img', 'image/png'], jpg: ['img', 'image/jpeg'], jpeg: ['img', 'image/jpeg'], gif: ['img', 'image/gif'],
    bmp: ['img', 'image/bmp'], webp: ['img', 'image/webp'], heic: ['img', 'image/heic'],
    xlsx: ['sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    xlsm: ['sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12'], xls: ['sheet', 'application/vnd.ms-excel'], csv: ['sheet', 'text/csv'],
    pptx: ['slide', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    pptm: ['slide', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'], ppt: ['slide', 'application/vnd.ms-powerpoint'],
  };
  const MAX_ATTACH = 50 * 1024 * 1024;
  const ISSUE_FIELDS = [['no', 'no'], ['date', 'found_date'], ['model', 'model'], ['part', 'part'], ['partNo', 'part_no'],
    ['line', 'line'], ['issue', 'issue'], ['recur', 'recur'], ['dept', 'dept'], ['owner', 'owner'],
    ['action', 'action'], ['fc', 'fc_date'], ['ac', 'ac_date'], ['cc', 'cc_date']];
  const DEC_FIELDS = [['date', 'meeting_date'], ['at', 'seq'], ['text', 'text'], ['issueId', 'issue_id'],
    ['issueNo', 'issue_no'], ['owner', 'owner'], ['due', 'due_date'], ['doneAt', 'done_date']];
  // 데스크톱 app.py 의 SCHEMA 와 똑같이 유지합니다 (백업 .db 를 데스크톱에서 그대로 열 수 있도록)
  const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues(
  id TEXT PRIMARY KEY,
  no TEXT NOT NULL,
  found_date TEXT,
  model TEXT, part TEXT, part_no TEXT, line TEXT,
  issue TEXT,
  recur TEXT, dept TEXT, owner TEXT,
  action TEXT,
  fc_date TEXT, ac_date TEXT, cc_date TEXT,
  is_example INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT,
  deleted_by TEXT, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_issues_no ON issues(no) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS issue_criteria(
  issue_id TEXT NOT NULL REFERENCES issues(id),
  crit TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'R',
  done_date TEXT, checker TEXT, note TEXT,
  updated_by TEXT, updated_at TEXT,
  PRIMARY KEY(issue_id, crit)
);
CREATE TABLE IF NOT EXISTS attachments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  crit TEXT NOT NULL,
  name TEXT NOT NULL, ext TEXT, kind TEXT, size INTEGER,
  data BLOB NOT NULL,
  created_by TEXT, created_at TEXT, deleted_by TEXT, deleted_at TEXT,
  log_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_att_issue ON attachments(issue_id, crit);
CREATE TABLE IF NOT EXISTS decisions(
  id TEXT PRIMARY KEY,
  meeting_date TEXT, seq INTEGER, text TEXT,
  issue_id TEXT, issue_no TEXT, owner TEXT, due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0, done_date TEXT,
  created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT,
  deleted_by TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS issue_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  log_date TEXT, kind TEXT, party TEXT, method TEXT,
  content TEXT NOT NULL, result TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  amends INTEGER,
  created_by TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_log_issue ON issue_log(issue_id);
CREATE TRIGGER IF NOT EXISTS tr_issue_log_no_update BEFORE UPDATE ON issue_log
BEGIN SELECT RAISE(ABORT, '조치 · 진행 기록은 고칠 수 없습니다. 정정 기록을 새로 남기세요'); END;
CREATE TRIGGER IF NOT EXISTS tr_issue_log_no_delete BEFORE DELETE ON issue_log
BEGIN SELECT RAISE(ABORT, '조치 · 진행 기록은 지울 수 없습니다'); END;
CREATE VIEW IF NOT EXISTS v_issue_log AS
SELECT i.no AS 순번, i.part AS 품명, l.log_date AS 실행일, l.kind AS 구분, l.party AS 상대방, l.method AS 방법,
       l.content AS 실행내용, l.result AS 결과합의, CASE l.auto WHEN 1 THEN '자동' ELSE '직접' END AS 기록방식,
       l.amends AS 정정대상, l.created_by AS 작성자, l.created_at AS 작성일시
FROM issue_log l JOIN issues i ON i.id = l.issue_id
ORDER BY i.no, l.log_date, l.id;
CREATE VIEW IF NOT EXISTS v_issues AS
SELECT i.no AS 순번, i.found_date AS 발견일자, i.model AS 차종, i.part AS 품명, i.part_no AS 품번, i.line AS 발견장소,
       i.issue AS 문제내용, i.recur AS 재발유무, i.dept AS 주관부서, i.owner AS 담당,
       MAX(CASE WHEN c.crit='cont'  THEN c.state END) AS "24HR_봉쇄조치",
       MAX(CASE WHEN c.crit='rca'   THEN c.state END) AS "2D_원인분석",
       MAX(CASE WHEN c.crit='act'   THEN c.state END) AS "7D_개선조치실행",
       MAX(CASE WHEN c.crit='ep'    THEN c.state END) AS "7D_실수방지검출",
       MAX(CASE WHEN c.crit='lpa'   THEN c.state END) AS "7D_계층적공정감사",
       MAX(CASE WHEN c.crit='ver'   THEN c.state END) AS "9D_개선조치검증",
       MAX(CASE WHEN c.crit='pfmea' THEN c.state END) AS "10D_PFMEA_CP",
       MAX(CASE WHEN c.crit='sw'    THEN c.state END) AS "10D_표준작업훈련",
       MAX(CASE WHEN c.crit='ll'    THEN c.state END) AS "14D_교훈반영",
       i.action AS 조치사항, i.fc_date AS 예상완료일자, i.ac_date AS 실제완료일자, i.cc_date AS 고객완료일자,
       i.updated_by AS 최종수정자, i.updated_at AS 최종수정일시
FROM issues i LEFT JOIN issue_criteria c ON c.issue_id = i.id
WHERE i.deleted_at IS NULL
GROUP BY i.id;`;
  const LS_USER = 'qrqc-local-user', LS_BACKUP = 'qrqc-local-last-backup';

  let SQL = null, db = null, idb = null, memRev = -1, queue = Promise.resolve();
  const err = (status, message) => Object.assign(new Error(message), { status });
  const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const deepMerge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]); else a[k] = b[k] && typeof b[k] === 'object' ? JSON.parse(JSON.stringify(b[k])) : b[k]; } return a; };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const user = () => ls.get(LS_USER) || '';
  const ID_RE = /^[A-Za-z0-9_.\-]{1,80}$/;

  /* ---------------- 브라우저 저장소 (IndexedDB): kv = SQLite 파일 · rev, blobs = 첨부 원본 */
  function idbOpen() {
    return new Promise((ok, no) => {
      if (!window.indexedDB) return no(err(500, '이 브라우저는 기기 저장을 지원하지 않습니다. Safari·Chrome·Edge 최신 버전을 쓰세요'));
      const r = indexedDB.open(IDB_NAME, IDB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(err(500, '기기 저장소를 열 수 없습니다. 사생활 보호(비공개) 모드에서는 저장되지 않습니다'));
      r.onblocked = () => no(err(500, 'QRQC가 다른 탭에서 열려 있습니다. 다른 탭을 닫고 새로고침하세요'));
    });
  }
  function idbTx(stores, mode, fn) {
    return new Promise((ok, no) => {
      const t = idb.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then(v => { out = v; }, e => { try { t.abort(); } catch (_) { } no(e); });
      t.oncomplete = () => ok(out);
      t.onerror = t.onabort = () => no(err(500, t.error && t.error.name === 'QuotaExceededError' ? '기기 저장 공간이 부족합니다. 백업 후 오래된 첨부를 정리하세요' : '기기에 저장하지 못했습니다'));
    });
  }
  const req = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const kvGet = k => idbTx(['kv'], 'readonly', t => req(t.objectStore('kv').get(k)));
  const blobGet = id => idbTx(['blobs'], 'readonly', t => req(t.objectStore('blobs').get(String(id))));
  const blobPut = (id, b) => idbTx(['blobs'], 'readwrite', t => { t.objectStore('blobs').put(b, String(id)); });

  /* ---------------- SQLite (sql.js) */
  function loadScript(src) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(err(500, 'SQLite 엔진을 불러오지 못했습니다. 인터넷 연결 후 새로고침하세요')); document.head.appendChild(s); });
  }
  async function engine() {
    if (SQL) return SQL;
    if (!window.initSqlJs) await loadScript('lib/sql-wasm.js');
    SQL = await window.initSqlJs({ locateFile: f => 'lib/' + f });
    return SQL;
  }
  function rows(sql, params, d) {
    const st = (d || db).prepare(sql);
    try { if (params) st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
    finally { st.free(); }
  }
  const one = (sql, params, d) => rows(sql, params, d)[0];
  const run = (sql, params, d) => (d || db).run(sql, params || []);
  function initSchema(d) {
    if (one("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='attachments'", null, d)
      && !rows('PRAGMA table_info(attachments)', null, d).some(c => c.name === 'log_id')) d.exec('ALTER TABLE attachments ADD COLUMN log_id INTEGER');
    d.exec(SCHEMA);
    run("INSERT OR IGNORE INTO meta(key, value) VALUES('rev', '0')", [], d);
    run("INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)", [String(SCHEMA_VERSION)], d);
    run("UPDATE meta SET value = ? WHERE key = 'schema_version' AND CAST(value AS INTEGER) < ?", [String(SCHEMA_VERSION), SCHEMA_VERSION], d);
    for (const k in DEFAULT_SETTINGS) run('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)', [k, JSON.stringify(DEFAULT_SETTINGS[k])], d);
  }
  const dbRev = d => +((one("SELECT value FROM meta WHERE key = 'rev'", null, d) || {}).value || 0);

  // 다른 탭이 먼저 저장했으면 그 내용을 다시 읽음
  async function syncFromStore() {
    const r = await kvGet('rev');
    if (r != null && r !== memRev) {
      const bytes = await kvGet('db');
      if (bytes) { if (db) db.close(); db = new SQL.Database(new Uint8Array(bytes)); initSchema(db); memRev = r; }
    }
  }
  // 쓰기: 순서대로 하나씩, SQL 트랜잭션 → rev 증가 → 기기에 저장
  function write(fn) {
    const job = queue.then(async () => {
      await syncFromStore();
      run('BEGIN');
      let out;
      try {
        out = await fn();
        run("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev'");
        run('COMMIT');
      } catch (e) { try { run('ROLLBACK'); } catch (_) { } throw e; }
      await persist();
      return out;
    });
    queue = job.catch(() => { });
    return job;
  }
  async function persist(extraBlobs) {
    const bytes = db.export(), r = dbRev();
    await idbTx(['kv', 'blobs'], 'readwrite', t => {
      t.objectStore('kv').put(bytes, 'db'); t.objectStore('kv').put(r, 'rev');
      for (const [id, b] of (extraBlobs || [])) t.objectStore('blobs').put(b, String(id));
    });
    memRev = r;
  }

  async function init() {
    idb = await idbOpen();
    await engine();
    const bytes = await kvGet('db');
    if (bytes) { db = new SQL.Database(new Uint8Array(bytes)); initSchema(db); memRev = (await kvGet('rev')) ?? dbRev(); }
    else {
      db = new SQL.Database(); initSchema(db);
      await migrateV1();
      await persist();
    }
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
    return { state: 'ready' };
  }
  // v1.5.0 (JSON 문서 방식) 으로 저장된 내용이 있으면 한 번 옮김. 원래 저장소는 지우지 않음
  async function migrateV1() {
    if (!['issues', 'decisions', 'settings', 'files'].every(s => idb.objectStoreNames.contains(s))) return;
    const get = s => idbTx([s], 'readonly', t => req(t.objectStore(s).getAll()));
    const [issues, decs, sets, files] = await Promise.all(['issues', 'decisions', 'settings', 'files'].map(get));
    if (!issues.length && !decs.length && !sets.length) return;
    const blobs = [];
    run('BEGIN');
    try {
      const s = (sets.find(x => x.id === 'main') || {}).value;
      if (s) for (const k of ['lines', 'noFormat']) if (s[k]) run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(s[k])]);
      for (const o of issues) { try { saveIssue(o.id, o, o.updatedBy, o.updatedAt); } catch (e) { saveIssue(o.id, Object.assign({}, o, { no: o.no + '-' + o.id.slice(-4) }), o.updatedBy, o.updatedAt); } }
      for (const o of decs) saveDecision(o.id, o, o.updatedBy, o.updatedAt);
      for (const f of files) {
        const r = issues.find(x => x.id === f.issueId); if (!r) continue;
        const meta = ((((r.cd || {})[f.crit] || {}).files) || []).find(m => m.id === f.id) || {};
        run('INSERT INTO attachments(issue_id, crit, name, ext, kind, size, data, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [f.issueId, f.crit, f.name, f.ext, (ALLOWED[f.ext] || [f.kind])[0], f.size, new Uint8Array(0), meta.by || '', (meta.at || '') + (meta.at ? ' 00:00:00' : '')]);
        blobs.push([one('SELECT last_insert_rowid() AS id').id, f.blob]);
      }
      run("INSERT OR REPLACE INTO meta(key, value) VALUES('json_migrated', ?)", [nowStr() + ' 이 기기 v1.5.0 저장분 ' + issues.length + '건']);
      run('COMMIT');
    } catch (e) { run('ROLLBACK'); throw e; }
    await persist(blobs);
  }

  /* ---------------- 읽기 · 쓰기 (데스크톱 app.py 와 같은 규칙) */
  function settings() {
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    for (const r of rows('SELECT key, value FROM settings')) { try { s[r.key] = JSON.parse(r.value); } catch (e) { } }
    return s;
  }
  const attMeta = r => ({ id: r.id, name: r.name, ext: r.ext, kind: r.kind, size: r.size, at: (r.created_at || '').slice(0, 10), by: r.created_by || '' });
  function loadIssues(onlyId) {
    const out = {};
    const w = onlyId ? ['id = ? AND deleted_at IS NULL', [onlyId]] : ['deleted_at IS NULL', null];
    for (const r of rows('SELECT * FROM issues WHERE ' + w[0], w[1])) {
      const o = { id: r.id };
      for (const [k, c] of ISSUE_FIELDS) o[k] = r[c] || '';
      Object.assign(o, { ex: !!r.is_example, crit: {}, cd: {}, createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at });
      out[r.id] = o;
    }
    if (!Object.keys(out).length) return out;
    for (const r of rows('SELECT * FROM issue_criteria' + (onlyId ? ' WHERE issue_id = ?' : ''), onlyId ? [onlyId] : null)) {
      const o = out[r.issue_id]; if (!o) continue;
      o.crit[r.crit] = r.state;
      o.cd[r.crit] = { note: r.note || '', done: r.done_date || '', checker: r.checker || '', files: [] };
    }
    const logs = {};
    for (const o of Object.values(out)) o.log = [];
    for (const r of rows('SELECT * FROM issue_log' + (onlyId ? ' WHERE issue_id = ?' : '') + ' ORDER BY id', onlyId ? [onlyId] : null)) {
      const o = out[r.issue_id]; if (!o) continue;
      const e = { id: r.id, date: r.log_date || '', kind: r.kind || '', party: r.party || '', method: r.method || '', content: r.content || '',
        result: r.result || '', auto: !!r.auto, amends: r.amends, by: r.created_by || '', at: r.created_at || '', files: [] };
      o.log.push(e); logs[r.id] = e;
    }
    for (const r of rows('SELECT id, issue_id, crit, name, ext, kind, size, created_by, created_at, log_id FROM attachments WHERE deleted_at IS NULL' + (onlyId ? ' AND issue_id = ?' : '') + ' ORDER BY id', onlyId ? [onlyId] : null)) {
      const o = out[r.issue_id]; if (!o) continue;
      if (r.crit === 'log') { if (logs[r.log_id]) logs[r.log_id].files.push(attMeta(r)); continue; }
      (o.cd[r.crit] = o.cd[r.crit] || { note: '', done: '', checker: '', files: [] }).files.push(attMeta(r));
    }
    return out;
  }
  const loadIssue = id => loadIssues(id)[id] || null;
  function saveIssue(id, o, by, at) {
    by = by || user(); at = at || nowStr();
    const vals = ISSUE_FIELDS.map(([k]) => String(o[k] == null ? '' : o[k]).trim());
    if (!vals[0]) throw err(400, '순번을 입력하세요');
    const cols = ISSUE_FIELDS.map(f => f[1]);
    try {
      run(`INSERT INTO issues(id, ${cols.join(', ')}, is_example, created_by, created_at, updated_by, updated_at) VALUES(?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, is_example = excluded.is_example, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at, deleted_by = NULL, deleted_at = NULL`,
        [id, ...vals, o.ex ? 1 : 0, o.createdBy || by, o.createdAt || at, by, at]);
    } catch (e) {
      if (/UNIQUE/.test(String(e.message))) throw err(409, `순번 ${vals[0]} 은(는) 이미 사용 중입니다`);
      throw e;
    }
    const crit = o.crit || {}, cd = o.cd || {};
    for (const k of CRITS) {
      const st = STATES.includes(crit[k]) ? crit[k] : 'R', d = cd[k] || {};
      run(`INSERT INTO issue_criteria(issue_id, crit, state, done_date, checker, note, updated_by, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(issue_id, crit) DO UPDATE SET state = excluded.state, done_date = excluded.done_date, checker = excluded.checker,
        note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [id, k, st, d.done || '', d.checker || '', d.note || '', by, at]);
    }
  }
  function decObj(r) {
    const o = { id: r.id };
    for (const [k, c] of DEC_FIELDS) o[k] = c === 'seq' ? r[c] : (r[c] || '');
    o.done = !!r.done; o.updatedBy = r.updated_by; o.updatedAt = r.updated_at;
    return o;
  }
  const loadDecisions = onlyId => rows('SELECT * FROM decisions WHERE deleted_at IS NULL' + (onlyId ? ' AND id = ?' : ''), onlyId ? [onlyId] : null).map(decObj);
  function saveDecision(id, o, by, at) {
    by = by || user(); at = at || nowStr();
    const cols = DEC_FIELDS.map(f => f[1]);
    const vals = DEC_FIELDS.map(([k, c]) => c === 'seq' ? (parseInt(o[k], 10) || 0) : String(o[k] == null ? '' : o[k]));
    run(`INSERT INTO decisions(id, ${cols.join(', ')}, done, created_by, created_at, updated_by, updated_at) VALUES(?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, done = excluded.done, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [id, ...vals, o.done ? 1 : 0, by, at, by, at]);
  }

  /* ---------------- 첨부 */
  function checkFile(name, size) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    if (!ALLOWED[ext]) throw err(415, 'PDF, 이미지(JPG·PNG·HEIC 등), 엑셀(XLSX·XLS·CSV), 파워포인트(PPTX·PPT) 파일만 첨부할 수 있습니다');
    if (size > MAX_ATTACH) throw err(413, '파일당 50MB까지 첨부할 수 있습니다');
    if (!size) throw err(400, '빈 파일입니다');
    return ext;
  }
  // 조치 · 진행 기록 (적립식: 추가만, 고칠 때는 정정 기록을 새로)
  function addLog(issueId, b) {
    const content = String(b.content || '').trim();
    if (!content) throw err(400, '실행 내용을 입력하세요');
    let amends = null;
    if (b.amends != null && b.amends !== '') {
      amends = parseInt(b.amends, 10);
      if (!one('SELECT 1 AS x FROM issue_log WHERE id = ? AND issue_id = ?', [amends, issueId])) throw err(404, '정정할 기록을 찾을 수 없습니다');
    }
    run('INSERT INTO issue_log(issue_id, log_date, kind, party, method, content, result, auto, amends, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [issueId, String(b.date || nowStr()).slice(0, 10), String(b.kind || '').slice(0, 40), String(b.party || '').slice(0, 120), String(b.method || '').slice(0, 40),
        content.slice(0, 4000), String(b.result || '').trim().slice(0, 4000), b.auto ? 1 : 0, amends, user(), nowStr()]);
    const id = one('SELECT last_insert_rowid() AS id').id;
    run('UPDATE issues SET updated_by = ?, updated_at = ? WHERE id = ?', [user(), nowStr(), issueId]);
    return id;
  }
  async function upload(issueId, crit, file, logId) {
    if (!ID_RE.test(issueId) || (!CRITS.includes(crit) && crit !== 'log')) throw err(400, '잘못된 요청입니다');
    if (crit === 'log' && !(parseInt(logId, 10) > 0)) throw err(400, '잘못된 기록 번호입니다');
    const name = String(file.name || 'file').split(/[\\/]/).pop().slice(0, 120), ext = checkFile(name, file.size);
    const blob = file.slice(0, file.size, file.type || ALLOWED[ext][1]);
    let aid;
    const issue = await write(async () => {
      if (!loadIssue(issueId)) throw err(404, '이슈를 찾을 수 없습니다');
      if (crit === 'log' && !one('SELECT 1 AS x FROM issue_log WHERE id = ? AND issue_id = ?', [+logId, issueId])) throw err(404, '기록을 찾을 수 없습니다');
      run('INSERT INTO attachments(issue_id, crit, name, ext, kind, size, data, created_by, created_at, log_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [issueId, crit, name, ext, ALLOWED[ext][0], file.size, new Uint8Array(0), user(), nowStr(), crit === 'log' ? +logId : null]);
      aid = one('SELECT last_insert_rowid() AS id').id;
      run('UPDATE issues SET updated_by = ?, updated_at = ? WHERE id = ?', [user(), nowStr(), issueId]);
      await blobPut(aid, blob);   // 원본을 먼저 저장하고 나서 DB 를 확정
      return loadIssue(issueId);
    });
    const files = crit === 'log' ? issue.log.find(e => e.id === +logId).files : issue.cd[crit].files;
    return { file: files.find(f => f.id === aid), issue };
  }
  function attRow(id) {
    const r = one('SELECT id, issue_id, crit, name, ext, kind, size, data FROM attachments WHERE id = ? AND deleted_at IS NULL', [+id]);
    if (!r) throw err(404, '첨부를 찾을 수 없습니다');
    return r;
  }
  async function attBlob(id) {
    const r = attRow(id);
    const b = await blobGet(r.id);
    if (b) return { r, blob: b };
    if (r.data && r.data.length) return { r, blob: new Blob([r.data], { type: (ALLOWED[r.ext] || [, ''])[1] }) };
    throw err(404, '첨부 원본이 이 기기에 없습니다');
  }
  const urls = {};
  async function attUrl(id) {
    if (urls[id]) return urls[id];
    const { blob } = await attBlob(id);
    return (urls[id] = URL.createObjectURL(blob));
  }

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

  // 백업: 지금 DB 복사본에 첨부 원본을 BLOB 으로 넣어 qrqc.db 형식 파일 하나로
  async function backup() {
    await queue; await syncFromStore();
    const copy = new SQL.Database(db.export());
    try {
      for (const r of rows('SELECT id FROM attachments', null, copy)) {
        const b = await blobGet(r.id);
        if (b) run('UPDATE attachments SET data = ? WHERE id = ?', [new Uint8Array(await b.arrayBuffer()), r.id], copy);
      }
      run("INSERT OR REPLACE INTO meta(key, value) VALUES('exported_at', ?)", [nowStr()], copy);
      run("INSERT OR REPLACE INTO meta(key, value) VALUES('exported_by', ?)", [user()], copy);
      const bytes = copy.export();
      const n = { issues: one('SELECT COUNT(*) AS n FROM issues WHERE deleted_at IS NULL', null, copy).n, files: one('SELECT COUNT(*) AS n FROM attachments WHERE deleted_at IS NULL', null, copy).n };
      const d = new Date(), p = x => String(x).padStart(2, '0');
      const name = `QRQC_백업_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
      const how = await deliver(new Blob([bytes], { type: 'application/vnd.sqlite3' }), name, 'QRQC 백업');
      if (how !== 'cancelled') ls.set(LS_BACKUP, nowStr());
      return Object.assign({ name, how, size: bytes.length }, n);
    } finally { copy.close(); }
  }

  // 불러오기 파일 확인: QRQC 백업(.db) · 데스크톱 qrqc.db · v1.5.0 백업(.json)
  async function readBackup(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 15));
    if (head === 'SQLite format 3') {
      await engine();
      let d;
      try { d = new SQL.Database(buf); rows('SELECT 1 FROM issues LIMIT 1', null, d); }
      catch (e) { if (d) d.close(); throw err(400, 'QRQC 데이터베이스가 아닙니다 (issues 테이블이 없음)'); }
      const meta = k => (one('SELECT value FROM meta WHERE key = ?', [k], d) || {}).value || '';
      const info = { kind: 'db', db: d, exportedAt: meta('exported_at'), exportedBy: meta('exported_by'),
        issues: one('SELECT COUNT(*) AS n FROM issues WHERE deleted_at IS NULL', null, d).n,
        decisions: one('SELECT COUNT(*) AS n FROM decisions WHERE deleted_at IS NULL', null, d).n,
        files: one('SELECT COUNT(*) AS n FROM attachments WHERE deleted_at IS NULL', null, d).n };
      return info;
    }
    let o;
    try { o = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw err(400, '백업 파일을 읽을 수 없습니다. QRQC에서 저장한 .db(또는 이전 .json) 파일인지 확인하세요'); }
    if (!o || o.app !== 'QRQC' || !Array.isArray(o.issues)) throw err(400, 'QRQC 백업 파일이 아닙니다');
    return { kind: 'json', json: o, exportedAt: o.exportedAt || '', exportedBy: o.exportedBy || '', issues: o.issues.length, decisions: (o.decisions || []).length, files: (o.files || []).length };
  }

  async function restore(info) {
    let fresh, blobs = [];
    if (info.kind === 'db') {
      fresh = info.db; initSchema(fresh);
      // 첨부 원본은 브라우저 저장소로 옮기고 DB 안에서는 비워 둠 (화면이 빠르도록)
      for (const r of rows('SELECT id, ext, data FROM attachments WHERE length(data) > 0', null, fresh))
        blobs.push([r.id, new Blob([r.data], { type: (ALLOWED[r.ext] || [, 'application/octet-stream'])[1] })]);
      run("UPDATE attachments SET data = X''", [], fresh);
    } else {
      fresh = new SQL.Database(); initSchema(fresh);
      const o = info.json, prev = db; db = fresh;
      try {
        if (o.settings) for (const k of ['lines', 'noFormat']) if (o.settings[k]) run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(o.settings[k])]);
        for (const r of o.issues) saveIssue(r.id, r, r.updatedBy, r.updatedAt);
        for (const r of (o.decisions || [])) saveDecision(r.id, r, r.updatedBy, r.updatedAt);
        for (const f of (o.files || [])) {
          if (!o.issues.find(x => x.id === f.issueId)) continue;
          run('INSERT INTO attachments(issue_id, crit, name, ext, kind, size, data, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [f.issueId, f.crit, f.name, f.ext, (ALLOWED[f.ext] || [f.kind])[0], f.size, new Uint8Array(0), '', '']);
          const bin = atob(f.data), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          blobs.push([one('SELECT last_insert_rowid() AS id').id, new Blob([u], { type: (ALLOWED[f.ext] || [, ''])[1] })]);
        }
      } finally { db = prev; }
    }
    run("UPDATE meta SET value = CAST(value AS INTEGER) + ? WHERE key = 'rev'", [Math.max(memRev, 0) + 1], fresh);
    await queue;
    await idbTx(['blobs'], 'readwrite', t => { t.objectStore('blobs').clear(); });
    if (db) db.close();
    db = fresh;
    await persist(blobs);
    for (const k in urls) { URL.revokeObjectURL(urls[k]); delete urls[k]; }
    return { issues: info.issues, decisions: info.decisions, files: info.files };
  }
  async function usage() {
    try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch (er) { return null; }
  }

  /* ---------------- 화면의 /api/... 요청 */
  async function api(method, url, body) {
    const p = url.replace(/^\/api\//, '').split('?')[0];
    if (p === 'config' && method === 'GET') return { dataDir: '이 기기', ok: true, user: user(), version: window.QRQC_VERSION || '', suggest: '', window: false, browser: true };
    if (p === 'version' && method === 'GET') { await queue; await syncFromStore(); return { version: String(memRev) }; }
    if (p === 'all' && method === 'GET') {
      await queue; await syncFromStore();
      return { issues: Object.values(loadIssues()), decisions: loadDecisions(), production: [], settings: settings(), version: String(memRev),
        dataDir: '이 기기', usedNos: rows('SELECT no FROM issues').map(r => r.no),
        db: { browser: true, sqlite: true, lastBackup: ls.get(LS_BACKUP) || '', usage: await usage(),
          migrated: (one("SELECT value FROM meta WHERE key = 'json_migrated'") || {}).value || '' } };
    }
    if (p === 'settings' && method === 'PUT') {
      return write(async () => {
        const s = settings();
        if (body.lines) { const l = body.lines.map(x => String(x).trim()).filter(Boolean); if (!l.length) throw err(400, '라인은 하나 이상 있어야 합니다'); s.lines = l; }
        if (body.noFormat) s.noFormat = String(body.noFormat).trim();
        for (const k of ['lines', 'noFormat']) run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(s[k])]);
        return settings();
      });
    }
    const lg = p.match(/^issues\/([^/]+)\/log$/);
    if (lg && method === 'POST') {
      if (!ID_RE.test(lg[1])) throw err(400, '잘못된 문서 번호입니다');
      return write(async () => {
        if (!loadIssue(lg[1])) throw err(404, '이슈를 찾을 수 없습니다');
        const id = addLog(lg[1], body || {});
        const issue = loadIssue(lg[1]);
        return { entry: issue.log.find(e => e.id === id), issue };
      });
    }
    const m = p.match(/^(issues|decisions)\/([^/]+)$/);
    if (m) {
      const [, col, id] = m;
      if (!ID_RE.test(id)) throw err(400, '잘못된 문서 번호입니다');
      const load = col === 'issues' ? loadIssue : (i => loadDecisions(i)[0] || null);
      const save = col === 'issues' ? saveIssue : saveDecision;
      if (method === 'GET') { const o = load(id); if (!o) throw err(404, '찾을 수 없습니다'); return o; }
      if (method === 'PUT' || method === 'PATCH') {
        return write(async () => {
          let b = Object.assign({}, body); delete b.id;
          if (method === 'PATCH') { const o = load(id); if (!o) throw err(404, '삭제된 항목입니다'); b = deepMerge(o, b); }
          save(id, b);
          return load(id);
        });
      }
      if (method === 'DELETE') { await write(async () => { run(`UPDATE ${col} SET deleted_by = ?, deleted_at = ? WHERE id = ?`, [user(), nowStr(), id]); }); return { deleted: true }; }
    }
    if (p === 'attach/delete') {
      return write(async () => {
        const r = attRow(body.att);
        if (r.crit === 'log') throw err(403, '조치 · 진행 기록의 증빙은 지울 수 없습니다');
        run('UPDATE attachments SET deleted_by = ?, deleted_at = ? WHERE id = ?', [user(), nowStr(), r.id]);
        run('UPDATE issues SET updated_by = ?, updated_at = ? WHERE id = ?', [user(), nowStr(), r.issue_id]);
        return { issue: loadIssue(r.issue_id) };
      });
    }
    if (p === 'open') {
      if (body.root || body.backups) throw err(400, '기기 저장 모드에서는 폴더가 없습니다. 설정 탭의 [백업 파일 저장]으로 파일을 보관하세요');
      const { r, blob } = await attBlob(body.att);
      if (r.kind === 'img' || r.kind === 'pdf') window.open(await attUrl(body.att), '_blank', 'noopener');
      else await deliver(blob, r.name);   // 엑셀 · 파워포인트는 브라우저가 직접 못 열므로 파일로 넘김 (아이폰: 공유 → Excel/PowerPoint)
      return { ok: true, name: r.name };
    }
    if (p === 'attach/saveas') { const { r, blob } = await attBlob(body.att); await deliver(blob, r.name); return { path: '' }; }
    if (p === 'export') { await deliver(new Blob(['﻿' + (body.text || '')], { type: 'text/csv' }), body.name || 'export.csv', 'QRQC 추적표'); return { path: body.name }; }
    if (p === 'backup') return backup();
    throw err(404, '지원하지 않는 요청입니다: ' + p);
  }

  window.QL = { init, api, upload, attUrl, backup, readBackup, restore,
    sql(q, params) { return rows(q, params); },   // 개발 · 점검용: QL.sql("SELECT * FROM v_issues")
    setUser(n) { ls.set(LS_USER, String(n || '').trim()); }, get user() { return user(); }, get lastBackup() { return ls.get(LS_BACKUP) || ''; } };
})();
