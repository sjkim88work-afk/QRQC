# -*- coding: utf-8 -*-
"""
공정품질 신속대응회의 · 신속대응 추적표 (Windows 데스크톱 프로그램)

- 화면: web/index.html 을 프로그램 창(pywebview, Edge WebView2)에 띄웁니다.
  pywebview 가 없으면 기본 브라우저로 엽니다.
- 데이터: 설정에서 지정한 '데이터 폴더'(회사 공유폴더 권장)의 SQLite 데이터베이스 파일에 저장합니다.
    <데이터 폴더>/
      qrqc.db      이슈, Exit Criteria 상세, 첨부자료(PDF·이미지·엑셀 원본), 회의 결정사항, 설정
      backups/     하루 한 번 자동 백업 + [지금 백업] (최근 30개 보관)
      exports/     엑셀 내보내기 파일
  예전 버전(JSON 파일 저장)의 issues/, decisions/, files/ 폴더가 있으면 처음 실행할 때 DB로 옮깁니다.
- 공유폴더(SMB)에서도 안전하도록 WAL 대신 기본 저널 모드와 잠금 대기(busy timeout)를 씁니다.
- 이 PC 안에서만 접속되는 내장 서버(127.0.0.1)를 씁니다. 외부에서는 접속할 수 없습니다.
"""
import argparse
import getpass
import glob
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from contextlib import contextmanager
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

VERSION = '1.2.0'
APP_TITLE = '공정품질 신속대응회의'
IS_WIN = os.name == 'nt'
DB_NAME = 'qrqc.db'
SCHEMA_VERSION = 1
MAX_ATTACH = 50 * 1024 * 1024
BACKUP_KEEP = 30


def resource_dir():
    return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))


WEB_DIR = os.path.join(resource_dir(), 'web')


def appdata_dir():
    base = os.environ.get('APPDATA') or os.path.join(os.path.expanduser('~'), '.config')
    p = os.path.join(base, 'QRQC_Tracker')
    os.makedirs(p, exist_ok=True)
    return p


CFG_PATH = os.path.join(appdata_dir(), 'config.json')
USER = os.environ.get('USERNAME') or os.environ.get('USER') or getpass.getuser() or 'user'
ID_RE = re.compile(r'^[A-Za-z0-9_.\-]{1,80}$')
CRITS = ('cont', 'rca', 'act', 'ep', 'lpa', 'ver', 'pfmea', 'sw', 'll')
STATES = ('R', 'Y', 'G', 'NA')
DEFAULT_SETTINGS = {
    'lines': ['윈도우레귤레이터 1라인', '도어래치 조립 2라인', 'PSD 모터 조립', '프레스 3공정', '사출 성형'],
    'noFormat': 'PHA-{YY}-{MM}-{NN}',
}
# 허용 첨부 형식: PDF, 이미지, 엑셀
ALLOWED = {
    'pdf': ('pdf', 'application/pdf'),
    'png': ('img', 'image/png'), 'jpg': ('img', 'image/jpeg'), 'jpeg': ('img', 'image/jpeg'),
    'gif': ('img', 'image/gif'), 'bmp': ('img', 'image/bmp'), 'webp': ('img', 'image/webp'),
    'xlsx': ('sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'xlsm': ('sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12'),
    'xls': ('sheet', 'application/vnd.ms-excel'),
    'csv': ('sheet', 'text/csv'),
}

# 화면 필드명 ↔ DB 열 이름
ISSUE_FIELDS = (('no', 'no'), ('date', 'found_date'), ('model', 'model'), ('part', 'part'), ('partNo', 'part_no'),
                ('line', 'line'), ('issue', 'issue'), ('recur', 'recur'), ('dept', 'dept'), ('owner', 'owner'),
                ('action', 'action'), ('fc', 'fc_date'), ('ac', 'ac_date'), ('cc', 'cc_date'))
DEC_FIELDS = (('date', 'meeting_date'), ('at', 'seq'), ('text', 'text'), ('issueId', 'issue_id'),
              ('issueNo', 'issue_no'), ('owner', 'owner'), ('due', 'due_date'), ('doneAt', 'done_date'))

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues(
  id TEXT PRIMARY KEY,
  no TEXT NOT NULL,              -- 순번
  found_date TEXT,               -- 발견일자 YYYY-MM-DD
  model TEXT, part TEXT, part_no TEXT, line TEXT,
  issue TEXT,                    -- 문제내용
  recur TEXT, dept TEXT, owner TEXT,
  action TEXT,                   -- 조치사항
  fc_date TEXT, ac_date TEXT, cc_date TEXT,   -- 예상·실제·고객 완료일자
  is_example INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT,
  deleted_by TEXT, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_issues_no ON issues(no) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS issue_criteria(
  issue_id TEXT NOT NULL REFERENCES issues(id),
  crit TEXT NOT NULL,            -- cont, rca, act, ep, lpa, ver, pfmea, sw, ll
  state TEXT NOT NULL DEFAULT 'R',  -- R, Y, G, NA
  done_date TEXT, checker TEXT, note TEXT,
  updated_by TEXT, updated_at TEXT,
  PRIMARY KEY(issue_id, crit)
);
CREATE TABLE IF NOT EXISTS attachments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  crit TEXT NOT NULL,
  name TEXT NOT NULL, ext TEXT, kind TEXT, size INTEGER,
  data BLOB NOT NULL,            -- 원본 파일
  created_by TEXT, created_at TEXT, deleted_by TEXT, deleted_at TEXT
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
GROUP BY i.id;
"""

DB_LOCK = threading.RLock()
_CON = {'path': None, 'con': None}
WINDOW = None
PORT = 0


# ---------------------------------------------------------------- 설정 파일 (PC별)
def now_str():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def write_json(path, obj):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    tmp = path + '.%d.tmp' % os.getpid()
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def load_cfg():
    c = read_json(CFG_PATH, {})
    return c if isinstance(c, dict) else {}


def save_cfg(cfg):
    write_json(CFG_PATH, cfg)


def data_dir():
    d = load_cfg().get('dataDir')
    return d if d and os.path.isdir(d) else None


def suggest_dir():
    docs = os.path.join(os.path.expanduser('~'), 'Documents')
    if not os.path.isdir(docs):
        docs = os.path.expanduser('~')
    return os.path.join(docs, 'QRQC_데이터')


# ---------------------------------------------------------------- 데이터베이스
class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


def db_path(d):
    return os.path.join(d, DB_NAME)


def open_db(d):
    """데이터 폴더의 DB 연결 (프로그램 안에서는 연결 하나를 잠금으로 나눠 씀)"""
    p = db_path(d)
    if _CON['path'] == p and _CON['con'] is not None:
        return _CON['con']
    if _CON['con'] is not None:
        try:
            _CON['con'].close()
        except Exception:
            pass
    con = sqlite3.connect(p, timeout=30, isolation_level=None, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA busy_timeout=30000')
    con.execute('PRAGMA journal_mode=DELETE')  # 공유폴더에서는 WAL을 쓰면 안 됨
    con.execute('PRAGMA foreign_keys=ON')
    init_db(con, d)
    _CON.update(path=p, con=con)
    return con


@contextmanager
def tx(con):
    con.execute('BEGIN IMMEDIATE')
    try:
        yield con
        con.execute("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev'")
        con.execute('COMMIT')
    except Exception:
        con.execute('ROLLBACK')
        raise


def init_db(con, d):
    con.executescript(SCHEMA)
    con.execute("INSERT OR IGNORE INTO meta(key, value) VALUES('rev', '0')")
    con.execute("INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)", (str(SCHEMA_VERSION),))
    for k, v in DEFAULT_SETTINGS.items():
        con.execute('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)', (k, json.dumps(v, ensure_ascii=False)))
    migrate_json(con, d)


def get_db():
    d = data_dir()
    if not d:
        raise ApiError(409, '데이터 폴더가 설정되지 않았거나 접근할 수 없습니다')
    try:
        return open_db(d), d
    except sqlite3.Error as e:
        _CON.update(path=None, con=None)
        raise ApiError(409, '데이터베이스를 열 수 없습니다 (%s)' % e)


def rev(con):
    r = con.execute("SELECT value FROM meta WHERE key = 'rev'").fetchone()
    return r[0] if r else '0'


def get_settings(con):
    s = dict(DEFAULT_SETTINGS)
    for r in con.execute('SELECT key, value FROM settings'):
        try:
            s[r['key']] = json.loads(r['value'])
        except ValueError:
            pass
    return s


def att_meta(r):
    return {'id': r['id'], 'name': r['name'], 'ext': r['ext'], 'kind': r['kind'], 'size': r['size'],
            'at': (r['created_at'] or '')[:10], 'by': r['created_by'] or ''}


def load_issues(con, only_id=None):
    where, args = 'deleted_at IS NULL', ()
    if only_id:
        where, args = 'id = ? AND deleted_at IS NULL', (only_id,)
    out = {}
    for r in con.execute('SELECT * FROM issues WHERE %s' % where, args):
        o = {'id': r['id']}
        for k, col in ISSUE_FIELDS:
            o[k] = r[col] or ''
        o.update(ex=bool(r['is_example']), crit={}, cd={}, createdBy=r['created_by'], createdAt=r['created_at'],
                 updatedBy=r['updated_by'], updatedAt=r['updated_at'])
        out[r['id']] = o
    if not out:
        return out
    q = 'SELECT * FROM issue_criteria' + (' WHERE issue_id = ?' if only_id else '')
    for r in con.execute(q, (only_id,) if only_id else ()):
        o = out.get(r['issue_id'])
        if o is None:
            continue
        o['crit'][r['crit']] = r['state']
        o['cd'][r['crit']] = {'note': r['note'] or '', 'done': r['done_date'] or '', 'checker': r['checker'] or '', 'files': []}
    q = ('SELECT id, issue_id, crit, name, ext, kind, size, created_by, created_at FROM attachments '
         'WHERE deleted_at IS NULL' + (' AND issue_id = ?' if only_id else '') + ' ORDER BY id')
    for r in con.execute(q, (only_id,) if only_id else ()):
        o = out.get(r['issue_id'])
        if o is None:
            continue
        cd = o['cd'].setdefault(r['crit'], {'note': '', 'done': '', 'checker': '', 'files': []})
        cd['files'].append(att_meta(r))
    return out


def load_issue(con, iid):
    return load_issues(con, iid).get(iid)


def save_issue(con, iid, o, by=None, at=None):
    by, at = by or USER, at or now_str()
    vals = [str(o.get(k) or '').strip() for k, _ in ISSUE_FIELDS]
    if not vals[0]:
        raise ApiError(400, '순번을 입력하세요')
    cols = [c for _, c in ISSUE_FIELDS]
    try:
        con.execute(
            'INSERT INTO issues(id, %s, is_example, created_by, created_at, updated_by, updated_at) VALUES(?, %s, ?, ?, ?, ?, ?) '
            'ON CONFLICT(id) DO UPDATE SET %s, is_example = excluded.is_example, updated_by = excluded.updated_by, '
            'updated_at = excluded.updated_at, deleted_by = NULL, deleted_at = NULL'
            % (', '.join(cols), ', '.join('?' * len(cols)), ', '.join('%s = excluded.%s' % (c, c) for c in cols)),
            [iid] + vals + [1 if o.get('ex') else 0, o.get('createdBy') or by, o.get('createdAt') or at, by, at])
    except sqlite3.IntegrityError:
        raise ApiError(409, '순번 %s 은(는) 이미 사용 중입니다' % vals[0])
    crit = o.get('crit') or {}
    cd = o.get('cd') or {}
    for k in CRITS:
        st = crit.get(k) or 'R'
        if st not in STATES:
            st = 'R'
        d = cd.get(k) or {}
        con.execute(
            'INSERT INTO issue_criteria(issue_id, crit, state, done_date, checker, note, updated_by, updated_at) '
            'VALUES(?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(issue_id, crit) DO UPDATE SET state = excluded.state, '
            'done_date = excluded.done_date, checker = excluded.checker, note = excluded.note, '
            'updated_by = excluded.updated_by, updated_at = excluded.updated_at',
            (iid, k, st, d.get('done') or '', d.get('checker') or '', d.get('note') or '', by, at))


def dec_obj(r):
    o = {'id': r['id']}
    for k, col in DEC_FIELDS:
        o[k] = r[col] if col == 'seq' else (r[col] or '')
    o['done'] = bool(r['done'])
    o.update(updatedBy=r['updated_by'], updatedAt=r['updated_at'])
    return o


def load_decisions(con, only_id=None):
    if only_id:
        rows = con.execute('SELECT * FROM decisions WHERE id = ? AND deleted_at IS NULL', (only_id,))
    else:
        rows = con.execute('SELECT * FROM decisions WHERE deleted_at IS NULL')
    return {r['id']: dec_obj(r) for r in rows}


def save_decision(con, did, o, by=None, at=None):
    by, at = by or USER, at or now_str()
    cols = [c for _, c in DEC_FIELDS]
    vals = [(int(o.get(k) or 0) if c == 'seq' else str(o.get(k) or '')) for k, c in DEC_FIELDS]
    con.execute(
        'INSERT INTO decisions(id, %s, done, created_by, created_at, updated_by, updated_at) VALUES(?, %s, ?, ?, ?, ?, ?) '
        'ON CONFLICT(id) DO UPDATE SET %s, done = excluded.done, updated_by = excluded.updated_by, updated_at = excluded.updated_at'
        % (', '.join(cols), ', '.join('?' * len(cols)), ', '.join('%s = excluded.%s' % (c, c) for c in cols)),
        [did] + vals + [1 if o.get('done') else 0, by, at, by, at])


def deep_merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            deep_merge(a[k], v)
        else:
            a[k] = v
    return a


def check_format(fmt):
    if not isinstance(fmt, str) or not fmt.strip():
        raise ApiError(400, '순번 형식을 입력하세요')
    if len(re.findall(r'\{N+\}', fmt)) != 1:
        raise ApiError(400, '순번 형식에는 일련번호 자리 {N}, {NN}, {NNN} 중 하나가 꼭 한 번 들어가야 합니다')
    rest = re.sub(r'\{(YYYY|YY|MM|DD|N+)\}', '', fmt)
    if '{' in rest or '}' in rest:
        raise ApiError(400, '알 수 없는 항목이 있습니다. {YYYY} {YY} {MM} {DD} {N} 만 쓸 수 있습니다')
    return fmt.strip()


# ---------------------------------------------------------------- 예전 JSON 데이터 이전
def migrate_json(con, d):
    if con.execute("SELECT 1 FROM meta WHERE key = 'json_migrated'").fetchone():
        return
    idir, ddir = os.path.join(d, 'issues'), os.path.join(d, 'decisions')
    ijson = sorted(glob.glob(os.path.join(idir, '*.json')))
    djson = sorted(glob.glob(os.path.join(ddir, '*.json')))
    n_i = n_d = n_f = 0
    with tx(con):
        old_set = read_json(os.path.join(d, 'settings.json'), {}) or {}
        if isinstance(old_set.get('lines'), list) and old_set['lines']:
            con.execute("UPDATE settings SET value = ? WHERE key = 'lines'", (json.dumps(old_set['lines'], ensure_ascii=False),))
        for p in ijson:
            o = read_json(p)
            iid = os.path.basename(p)[:-5]
            if not isinstance(o, dict) or not ID_RE.match(iid):
                continue
            if con.execute('SELECT 1 FROM issues WHERE id = ?', (iid,)).fetchone():
                continue
            base_no, k = str(o.get('no') or iid), 2
            while con.execute('SELECT 1 FROM issues WHERE no = ? AND deleted_at IS NULL', (o.get('no') or iid,)).fetchone():
                o['no'] = '%s (%d)' % (base_no, k)
                k += 1
            save_issue(con, iid, o, by=o.get('updatedBy') or USER, at=o.get('updatedAt') or now_str())
            n_i += 1
            for crit, cd in (o.get('cd') or {}).items():
                if crit not in CRITS:
                    continue
                for f in (cd or {}).get('files') or []:
                    src = os.path.join(d, 'files', *str(f.get('rel', '')).split('/'))
                    ext = os.path.splitext(f.get('name', ''))[1].lstrip('.').lower()
                    if not os.path.isfile(src) or ext not in ALLOWED:
                        continue
                    with open(src, 'rb') as fh:
                        data = fh.read()
                    con.execute('INSERT INTO attachments(issue_id, crit, name, ext, kind, size, data, created_by, created_at) '
                                'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
                                (iid, crit, f.get('name'), ext, ALLOWED[ext][0], len(data), data,
                                 f.get('by') or USER, (f.get('at') or now_str()[:10]) + ' 00:00:00'))
                    n_f += 1
        for p in djson:
            o = read_json(p)
            did = os.path.basename(p)[:-5]
            if isinstance(o, dict) and ID_RE.match(did) and not con.execute('SELECT 1 FROM decisions WHERE id = ?', (did,)).fetchone():
                save_decision(con, did, o, by=o.get('updatedBy') or USER)
                n_d += 1
        con.execute("INSERT INTO meta(key, value) VALUES('json_migrated', ?)",
                    ('%s 이슈 %d건, 첨부 %d건, 결정사항 %d건' % (now_str(), n_i, n_f, n_d),))


# ---------------------------------------------------------------- 백업
def backup(d, auto=False):
    folder = os.path.join(d, 'backups')
    os.makedirs(folder, exist_ok=True)
    today = datetime.now().strftime('%Y%m%d')
    if auto and glob.glob(os.path.join(folder, 'qrqc_%s-*.db' % today)):
        return None
    target = os.path.join(folder, 'qrqc_%s.db' % datetime.now().strftime('%Y%m%d-%H%M%S'))
    with DB_LOCK:
        con = open_db(d)
        dst = sqlite3.connect(target)
        try:
            con.backup(dst)
        finally:
            dst.close()
    olds = sorted(glob.glob(os.path.join(folder, 'qrqc_*.db')))
    for p in olds[:-BACKUP_KEEP]:
        try:
            os.remove(p)
        except OSError:
            pass
    return target


def last_backup(d):
    olds = sorted(glob.glob(os.path.join(d, 'backups', 'qrqc_*.db')))
    if not olds:
        return ''
    m = re.search(r'qrqc_(\d{8})-(\d{6})\.db$', olds[-1])
    if not m:
        return ''
    a, b = m.groups()
    return '%s-%s-%s %s:%s' % (a[:4], a[4:6], a[6:], b[:2], b[2:4])


# ---------------------------------------------------------------- OS 연동
def safe_name(name):
    name = os.path.basename((name or '').replace('\\', '/'))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .') or 'file'
    if len(name) > 120:
        stem, ext = os.path.splitext(name)
        name = stem[:110] + ext
    return name


def open_path(path, select=False):
    if IS_WIN:
        if select:
            subprocess.Popen(['explorer', '/select,', os.path.normpath(path)])
        else:
            os.startfile(path)  # 기본 프로그램(엑셀, PDF 뷰어 등)으로 열기
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', '-R', path] if select else ['open', path])
    else:
        subprocess.Popen(['xdg-open', os.path.dirname(path) if select else path])


def _webview_dialog(kind_name, legacy, **kw):
    import webview
    kind = getattr(getattr(webview, 'FileDialog', None), kind_name, None)
    if kind is None:
        kind = getattr(webview, legacy)
    return WINDOW.create_file_dialog(kind, **kw)


def pick_folder(initial):
    initial = initial if initial and os.path.isdir(initial) else ''
    if WINDOW is not None:
        r = _webview_dialog('FOLDER', 'FOLDER_DIALOG', directory=initial)
        return r[0] if r else ''
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    p = filedialog.askdirectory(initialdir=initial or None, title='데이터 폴더 선택')
    root.destroy()
    return p or ''


def pick_save(name):
    docs = os.path.join(os.path.expanduser('~'), 'Documents')
    if WINDOW is not None:
        r = _webview_dialog('SAVE', 'SAVE_DIALOG', directory=docs if os.path.isdir(docs) else '', save_filename=name)
        if isinstance(r, (list, tuple)):
            r = r[0] if r else ''
        return r or ''
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    ext = os.path.splitext(name)[1]
    p = filedialog.asksaveasfilename(initialfile=name, defaultextension=ext, title='다른 이름으로 저장')
    root.destroy()
    return p or ''


def att_row(con, aid):
    try:
        aid = int(aid)
    except (TypeError, ValueError):
        raise ApiError(400, '잘못된 첨부 번호입니다')
    r = con.execute('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL', (aid,)).fetchone()
    if r is None:
        raise ApiError(404, '첨부를 찾을 수 없습니다. 다른 사용자가 삭제했을 수 있습니다')
    return r


def att_temp_file(r):
    folder = os.path.join(tempfile.gettempdir(), 'QRQC_첨부')
    os.makedirs(folder, exist_ok=True)
    p = os.path.join(folder, '%d_%s' % (r['id'], safe_name(r['name'])))
    if not os.path.exists(p) or os.path.getsize(p) != r['size']:
        with open(p, 'wb') as f:
            f.write(r['data'])
    return p


# ---------------------------------------------------------------- HTTP 처리
class Handler(BaseHTTPRequestHandler):
    server_version = 'QRQC'
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def send_bytes(self, data, ctype, cache='no-store'):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.end_headers()
        self.wfile.write(data)

    def body_bytes(self, limit=None):
        n = int(self.headers.get('Content-Length') or 0)
        if limit and n > limit:
            self.rfile.read(n)
            raise ApiError(413, '파일이 너무 큽니다 (최대 %dMB)' % (limit // 1048576))
        return self.rfile.read(n) if n else b''

    def body_json(self):
        b = self.body_bytes()
        if not b:
            return {}
        try:
            v = json.loads(b.decode('utf-8'))
        except ValueError:
            raise ApiError(400, '요청 형식이 올바르지 않습니다')
        if not isinstance(v, dict):
            raise ApiError(400, '요청 형식이 올바르지 않습니다')
        return v

    def do_GET(self):
        self.route('GET')

    def do_POST(self):
        self.route('POST')

    def do_PUT(self):
        self.route('PUT')

    def do_PATCH(self):
        self.route('PATCH')

    def do_DELETE(self):
        self.route('DELETE')

    def route(self, m):
        u = urlparse(self.path)
        path = unquote(u.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            host = (self.headers.get('Host') or '').split(':')[0]
            if host not in ('127.0.0.1', 'localhost'):
                raise ApiError(403, 'forbidden')
            if path.startswith('/api/'):
                return self.api(m, path[5:], q)
            if path.startswith('/att/') and m == 'GET':
                with DB_LOCK:
                    con, _ = get_db()
                    r = att_row(con, path[5:])
                    data, ext = bytes(r['data']), r['ext']
                return self.send_bytes(data, ALLOWED.get(ext, ('', 'application/octet-stream'))[1], 'private, max-age=3600')
            if m == 'GET':
                rel = 'index.html' if path in ('', '/') else path.lstrip('/')
                p = os.path.realpath(os.path.join(WEB_DIR, *rel.split('/')))
                if os.path.commonpath([os.path.realpath(WEB_DIR), p]) != os.path.realpath(WEB_DIR) or not os.path.isfile(p):
                    raise ApiError(404, 'not found')
                ctype = mimetypes.guess_type(p)[0] or 'application/octet-stream'
                if ctype.startswith('text/') or ctype == 'application/javascript':
                    ctype += '; charset=utf-8'
                with open(p, 'rb') as f:
                    return self.send_bytes(f.read(), ctype)
            raise ApiError(404, 'not found')
        except ApiError as e:
            self.send_json({'error': e.msg}, e.code)
        except sqlite3.OperationalError as e:
            msg = '다른 사용자가 저장 중이라 잠시 기다렸지만 끝나지 않았습니다. 다시 시도하세요' if 'locked' in str(e) else '데이터베이스 오류: %s' % e
            self.send_json({'error': msg}, 503)
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception as e:
            try:
                self.send_json({'error': '처리 중 오류: %s' % e}, 500)
            except Exception:
                pass

    def api(self, m, p, q):
        # --- PC별 설정 (DB 없이)
        if p == 'config' and m == 'GET':
            cfg = load_cfg()
            return self.send_json({'dataDir': cfg.get('dataDir') or '', 'ok': data_dir() is not None,
                                   'user': USER, 'version': VERSION, 'suggest': suggest_dir(),
                                   'window': WINDOW is not None})
        if p == 'config' and m == 'POST':
            b = self.body_json()
            d = (b.get('dataDir') or '').strip().strip('"')
            if not d:
                raise ApiError(400, '폴더 경로를 입력하세요')
            if not os.path.isdir(d):
                try:
                    os.makedirs(d, exist_ok=True)
                except OSError as e:
                    raise ApiError(400, '폴더를 만들 수 없습니다 (%s)' % e.strerror)
            try:
                probe = os.path.join(d, '.write_test_%s' % os.getpid())
                with open(probe, 'w') as f:
                    f.write('ok')
                os.remove(probe)
            except OSError as e:
                raise ApiError(400, '이 폴더에 저장할 권한이 없습니다 (%s)' % e.strerror)
            with DB_LOCK:
                try:
                    open_db(d)
                except sqlite3.Error as e:
                    _CON.update(path=None, con=None)
                    raise ApiError(400, '이 폴더에 데이터베이스를 만들 수 없습니다 (%s)' % e)
            cfg = load_cfg()
            cfg['dataDir'] = os.path.normpath(d)
            save_cfg(cfg)
            threading.Thread(target=lambda: _safe_backup(d), daemon=True).start()
            return self.send_json({'dataDir': cfg['dataDir'], 'ok': True})
        if p == 'quit' and m == 'POST' and WINDOW is None:
            # 브라우저 모드에서는 콘솔 창이 없을 수 있어 화면에서 종료할 수 있게 함
            self.send_json({'ok': True})
            threading.Timer(0.5, lambda: os._exit(0)).start()
            return
        if p == 'pickdir' and m == 'POST':
            b = self.body_json()
            try:
                return self.send_json({'path': pick_folder(b.get('initial') or '')})
            except Exception:
                raise ApiError(500, '폴더 선택 창을 열 수 없습니다. 경로를 직접 입력하세요')

        # --- 첨부 업로드는 본문을 먼저 읽고 잠금
        if p == 'upload' and m == 'POST':
            iid, crit, name = q.get('issue', ''), q.get('crit', ''), safe_name(q.get('name', ''))
            ext = os.path.splitext(name)[1].lstrip('.').lower()
            if ext not in ALLOWED:
                self.body_bytes(MAX_ATTACH * 4)
                raise ApiError(415, 'PDF, 이미지(JPG·PNG 등), 엑셀(XLSX·XLS·CSV) 파일만 첨부할 수 있습니다')
            data = self.body_bytes(MAX_ATTACH)
            if not data:
                raise ApiError(400, '빈 파일입니다')
            if not ID_RE.match(iid) or crit not in CRITS:
                raise ApiError(400, '잘못된 요청입니다')
            with DB_LOCK:
                con, _ = get_db()
                if not load_issue(con, iid):
                    raise ApiError(404, '이슈를 찾을 수 없습니다')
                with tx(con):
                    cur = con.execute('INSERT INTO attachments(issue_id, crit, name, ext, kind, size, data, created_by, created_at) '
                                      'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
                                      (iid, crit, name, ext, ALLOWED[ext][0], len(data), sqlite3.Binary(data), USER, now_str()))
                    con.execute('UPDATE issues SET updated_by = ?, updated_at = ? WHERE id = ?', (USER, now_str(), iid))
                aid = cur.lastrowid
                issue = load_issue(con, iid)
                meta = next(f for f in issue['cd'][crit]['files'] if f['id'] == aid)
            return self.send_json({'file': meta, 'issue': issue})

        with DB_LOCK:
            con, d = get_db()
            if p == 'all' and m == 'GET':
                return self.send_json({
                    'issues': list(load_issues(con).values()), 'decisions': list(load_decisions(con).values()),
                    'production': [], 'settings': get_settings(con), 'version': rev(con), 'dataDir': d,
                    'usedNos': [r[0] for r in con.execute('SELECT no FROM issues')],
                    'db': {'path': db_path(d), 'size': os.path.getsize(db_path(d)), 'lastBackup': last_backup(d),
                           'migrated': (con.execute("SELECT value FROM meta WHERE key = 'json_migrated'").fetchone() or [''])[0]}})
            if p == 'version' and m == 'GET':
                return self.send_json({'version': rev(con)})
            if p == 'settings' and m == 'PUT':
                b = self.body_json()
                s = get_settings(con)
                if 'lines' in b:
                    lines = [str(x).strip() for x in b['lines'] if str(x).strip()]
                    if not lines:
                        raise ApiError(400, '라인은 하나 이상 있어야 합니다')
                    s['lines'] = lines
                if 'noFormat' in b:
                    s['noFormat'] = check_format(b['noFormat'])
                with tx(con):
                    for k in ('lines', 'noFormat'):
                        con.execute('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                                    (k, json.dumps(s[k], ensure_ascii=False)))
                return self.send_json(get_settings(con))
            if p == 'backup' and m == 'POST':
                t = backup(d)
                return self.send_json({'path': t, 'lastBackup': last_backup(d)})

            parts = p.split('/')
            if len(parts) == 2 and parts[0] in ('issues', 'decisions'):
                col, did = parts
                if not ID_RE.match(did):
                    raise ApiError(400, '잘못된 문서 번호입니다')
                load = load_issue if col == 'issues' else (lambda c, i: load_decisions(c, i).get(i))
                save = save_issue if col == 'issues' else save_decision
                table = col
                if m == 'GET':
                    o = load(con, did)
                    if o is None:
                        raise ApiError(404, '찾을 수 없습니다')
                    return self.send_json(o)
                if m in ('PUT', 'PATCH'):
                    b = self.body_json()
                    b.pop('id', None)
                    with tx(con):
                        if m == 'PATCH':
                            o = load(con, did)
                            if o is None:
                                raise ApiError(404, '다른 사용자가 삭제한 항목입니다')
                            b = deep_merge(o, b)
                        save(con, did, b)
                    return self.send_json(load(con, did))
                if m == 'DELETE':
                    with tx(con):
                        con.execute('UPDATE %s SET deleted_by = ?, deleted_at = ? WHERE id = ?' % table, (USER, now_str(), did))
                    return self.send_json({'deleted': True})

            if p == 'attach/delete' and m == 'POST':
                b = self.body_json()
                r = att_row(con, b.get('att'))
                with tx(con):
                    con.execute('UPDATE attachments SET deleted_by = ?, deleted_at = ? WHERE id = ?', (USER, now_str(), r['id']))
                    con.execute('UPDATE issues SET updated_by = ?, updated_at = ? WHERE id = ?', (USER, now_str(), r['issue_id']))
                return self.send_json({'issue': load_issue(con, r['issue_id'])})
            if p == 'open' and m == 'POST':
                b = self.body_json()
                if b.get('root'):
                    open_path(d)
                    return self.send_json({'ok': True})
                if b.get('backups'):
                    os.makedirs(os.path.join(d, 'backups'), exist_ok=True)
                    open_path(os.path.join(d, 'backups'))
                    return self.send_json({'ok': True})
                path = att_temp_file(att_row(con, b.get('att')))
                open_path(path)
                return self.send_json({'ok': True})
            if p == 'attach/saveas' and m == 'POST':
                r = att_row(con, self.body_json().get('att'))
                name, data = r['name'], bytes(r['data'])
        if p == 'attach/saveas' and m == 'POST':
            try:
                target = pick_save(name)
            except Exception:
                raise ApiError(500, '저장 위치 선택 창을 열 수 없습니다')
            if not target:
                return self.send_json({'path': ''})
            with open(target, 'wb') as f:
                f.write(data)
            return self.send_json({'path': target})
        if p == 'export' and m == 'POST':
            b = self.body_json()
            name = safe_name(b.get('name') or 'export.csv')
            folder = os.path.join(d, 'exports')
            os.makedirs(folder, exist_ok=True)
            target = os.path.join(folder, name)
            stem, ext = os.path.splitext(name)
            i = 2
            while os.path.exists(target):
                target = os.path.join(folder, '%s (%d)%s' % (stem, i, ext))
                i += 1
            with open(target, 'w', encoding='utf-8-sig', newline='') as f:  # BOM: 엑셀에서 한글이 깨지지 않게
                f.write(b.get('text') or '')
            if not b.get('noOpen'):
                open_path(target)
            return self.send_json({'path': target})
        raise ApiError(404, 'not found')


def _safe_backup(d):
    try:
        backup(d, auto=True)
    except Exception:
        pass


# ---------------------------------------------------------------- 실행
def start_server(port):
    global PORT
    srv = None
    for p in ([port] if port else [8765, 8766, 8767, 0]):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', p), Handler)
            break
        except OSError:
            continue
    if srv is None:
        srv = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    srv.daemon_threads = True
    PORT = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    global WINDOW
    ap = argparse.ArgumentParser(description=APP_TITLE)
    ap.add_argument('--browser', action='store_true', help='프로그램 창 대신 기본 브라우저로 열기')
    ap.add_argument('--headless', action='store_true', help='창을 열지 않고 내장 서버만 실행 (점검용)')
    ap.add_argument('--port', type=int, default=0)
    ap.add_argument('--data', default='', help='데이터 폴더 지정')
    a = ap.parse_args()

    if a.data:
        os.makedirs(a.data, exist_ok=True)
        cfg = load_cfg()
        cfg['dataDir'] = os.path.normpath(a.data)
        save_cfg(cfg)

    d = data_dir()
    if d:
        threading.Thread(target=lambda: _safe_backup(d), daemon=True).start()

    srv = start_server(a.port)
    url = 'http://127.0.0.1:%d/' % PORT

    if a.headless:
        print('서버 실행 중:', url)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return

    webview = None
    if not a.browser:
        try:
            import webview  # pywebview
        except Exception:
            webview = None

    if webview is not None:
        try:
            WINDOW = webview.create_window(APP_TITLE, url, width=1520, height=960, min_size=(960, 640))
            storage = os.path.join(appdata_dir(), 'webview')
            try:
                webview.start(private_mode=False, storage_path=storage)
            except TypeError:
                webview.start()
            srv.shutdown()
            return
        except Exception:
            # 프로그램 창을 띄울 수 없는 PC(WebView2 런타임 없음 등)는 브라우저로 엽니다
            WINDOW = None

    webbrowser.open(url)
    print('=' * 60)
    print(' %s  v%s' % (APP_TITLE, VERSION))
    print(' 브라우저에서 열렸습니다:', url)
    print(' 이 창을 닫으면 프로그램이 종료됩니다.')
    print('=' * 60)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
