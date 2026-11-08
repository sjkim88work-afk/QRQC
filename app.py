# -*- coding: utf-8 -*-
"""
공정품질 신속대응회의 · 신속대응 추적표 (Windows 데스크톱 프로그램)

- 화면: web/index.html 을 프로그램 창(pywebview, Edge WebView2)에 띄웁니다.
  pywebview 가 없으면 기본 브라우저로 엽니다.
- 데이터: 설정에서 지정한 '데이터 폴더'(회사 공유폴더 권장)에 JSON 파일로 저장합니다.
    <데이터 폴더>/
      settings.json          라인 목록, 불량유형, 목표 PPM (모든 사용자 공통)
      issues/<id>.json       신속대응 이슈 1건 = 파일 1개
      decisions/<id>.json    회의 결정사항
      production/<날짜>.json  일일 생산·불량 실적
      files/<이슈>/<항목>/    첨부자료 원본
      trash/                 삭제한 이슈·첨부 (바로 지우지 않고 옮겨 둠)
      exports/               엑셀 내보내기 파일
- 이 PC 안에서만 접속되는 내장 서버(127.0.0.1)를 씁니다. 외부에서는 접속할 수 없습니다.
"""
import argparse
import getpass
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

VERSION = '1.0.0'
APP_TITLE = '공정품질 신속대응회의'
IS_WIN = os.name == 'nt'


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
COLS = ('issues', 'decisions', 'production')
SUBDIRS = COLS + ('files', 'trash', 'exports')
ID_RE = re.compile(r'^[A-Za-z0-9_.\-]{1,80}$')
CRIT_RE = re.compile(r'^[a-z]{1,12}$')
DEFAULT_SETTINGS = {
    'lines': ['윈도우레귤레이터 1라인', '도어래치 조립 2라인', 'PSD 모터 조립', '프레스 3공정', '사출 성형'],
    'types': ['치수불량', '작동소음', '조립누락', '외관(찍힘·스크래치)', '체결토크', '이종혼입', '기타'],
    'target': 300,
}
IMG_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}
SHEET_EXT = {'xlsx', 'xls', 'xlsm', 'csv'}

FILE_LOCK = threading.RLock()
WINDOW = None
PORT = 0


# ---------------------------------------------------------------- 파일 입출력
def now_str():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def write_json(path, obj):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, '.%s.%d.%d.tmp' % (os.path.basename(path), os.getpid(), threading.get_ident()))
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    for _ in range(20):
        try:
            os.replace(tmp, path)  # 원자적 교체: 다른 사람이 읽는 도중에도 파일이 깨지지 않음
            return
        except PermissionError:
            time.sleep(0.15)
    os.replace(tmp, path)


def read_json(path, default=None):
    for _ in range(6):
        try:
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return default
        except (PermissionError, ValueError):
            time.sleep(0.1)
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


def ensure_structure(d):
    for s in SUBDIRS:
        os.makedirs(os.path.join(d, s), exist_ok=True)
    sp = os.path.join(d, 'settings.json')
    if not os.path.exists(sp):
        write_json(sp, DEFAULT_SETTINGS)


def get_settings(d):
    s = dict(DEFAULT_SETTINGS)
    f = read_json(os.path.join(d, 'settings.json'), {})
    if isinstance(f, dict):
        s.update({k: v for k, v in f.items() if k in ('lines', 'types', 'target')})
    return s


def list_col(d, col):
    out = []
    p = os.path.join(d, col)
    if not os.path.isdir(p):
        return out
    for e in os.scandir(p):
        if e.is_file() and e.name.endswith('.json') and not e.name.startswith('.'):
            obj = read_json(e.path)
            if isinstance(obj, dict):
                obj['id'] = e.name[:-5]
                out.append(obj)
    return out


def version(d):
    h = hashlib.md5()
    for col in COLS:
        p = os.path.join(d, col)
        if not os.path.isdir(p):
            continue
        for e in sorted(os.scandir(p), key=lambda x: x.name):
            if e.name.endswith('.json') and not e.name.startswith('.'):
                st = e.stat()
                h.update(('%s/%s:%d:%d;' % (col, e.name, st.st_mtime_ns, st.st_size)).encode('utf-8'))
    sp = os.path.join(d, 'settings.json')
    if os.path.exists(sp):
        st = os.stat(sp)
        h.update(('settings:%d' % st.st_mtime_ns).encode())
    return h.hexdigest()


def deep_merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            deep_merge(a[k], v)
        else:
            a[k] = v
    return a


def safe_name(name):
    name = os.path.basename((name or '').replace('\\', '/'))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .') or 'file'
    if len(name) > 120:
        stem, ext = os.path.splitext(name)
        name = stem[:110] + ext
    return name


def unique_path(folder, name):
    p = os.path.join(folder, name)
    stem, ext = os.path.splitext(name)
    i = 2
    while os.path.exists(p):
        p = os.path.join(folder, '%s (%d)%s' % (stem, i, ext))
        i += 1
    return p


def kind_of(ext):
    ext = ext.lower()
    if ext in IMG_EXT:
        return 'img'
    if ext == 'pdf':
        return 'pdf'
    if ext in SHEET_EXT:
        return 'sheet'
    return 'doc'


def inside(base, path):
    base = os.path.realpath(base)
    path = os.path.realpath(path)
    try:
        return os.path.commonpath([base, path]) == base
    except ValueError:
        return False


def stamp():
    return int(time.time() * 1000)


def trash_move(d, src, label):
    if not os.path.exists(src):
        return
    dst = os.path.join(d, 'trash', '%s_%s' % (datetime.now().strftime('%Y%m%d-%H%M%S'), label))
    i = 2
    base = dst
    while os.path.exists(dst):
        dst = '%s_%d' % (base, i)
        i += 1
    shutil.move(src, dst)


# ---------------------------------------------------------------- OS 연동
def open_path(path, select=False):
    if IS_WIN:
        if select:
            subprocess.Popen(['explorer', '/select,', os.path.normpath(path)])
        else:
            os.startfile(path)  # noqa: 기본 프로그램(엑셀, PDF 뷰어 등)으로 열기
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', '-R', path] if select else ['open', path])
    else:
        subprocess.Popen(['xdg-open', os.path.dirname(path) if select else path])


def pick_folder(initial):
    if WINDOW is not None:
        import webview
        kind = getattr(getattr(webview, 'FileDialog', None), 'FOLDER', None)
        if kind is None:
            kind = webview.FOLDER_DIALOG
        r = WINDOW.create_file_dialog(kind, directory=initial if initial and os.path.isdir(initial) else '')
        return r[0] if r else ''
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    p = filedialog.askdirectory(initialdir=initial if initial and os.path.isdir(initial) else None,
                                title='데이터 폴더 선택')
    root.destroy()
    return p or ''


# ---------------------------------------------------------------- HTTP 처리
class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


class Handler(BaseHTTPRequestHandler):
    server_version = 'QRQC'
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    # --- 응답
    def send_json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def send_file(self, path, nocache=False):
        if not os.path.isfile(path):
            raise ApiError(404, '파일을 찾을 수 없습니다')
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
            ctype += '; charset=utf-8'
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'no-store' if nocache else 'max-age=60')
        self.end_headers()
        with open(path, 'rb') as f:
            shutil.copyfileobj(f, self.wfile)

    def body_bytes(self):
        n = int(self.headers.get('Content-Length') or 0)
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
            if path.startswith('/files/') and m == 'GET':
                d = need_dir()
                base = os.path.join(d, 'files')
                p = os.path.join(base, *[s for s in path[7:].split('/') if s])
                if not inside(base, p):
                    raise ApiError(403, 'forbidden')
                return self.send_file(p)
            if m == 'GET':
                rel = 'index.html' if path in ('', '/') else path.lstrip('/')
                p = os.path.join(WEB_DIR, *rel.split('/'))
                if not inside(WEB_DIR, p):
                    raise ApiError(403, 'forbidden')
                return self.send_file(p, nocache=True)
            raise ApiError(404, 'not found')
        except ApiError as e:
            self.send_json({'error': e.msg}, e.code)
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception as e:  # 예기치 못한 오류도 화면에 문장으로 전달
            try:
                self.send_json({'error': '처리 중 오류: %s' % e}, 500)
            except Exception:
                pass

    # --- API
    def api(self, m, p, q):
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
                if not b.get('create'):
                    raise ApiError(400, '폴더가 없습니다')
                try:
                    os.makedirs(d, exist_ok=True)
                except OSError as e:
                    raise ApiError(400, '폴더를 만들 수 없습니다 (%s)' % e.strerror)
            try:
                ensure_structure(d)
                probe = os.path.join(d, '.write_test_%s' % os.getpid())
                with open(probe, 'w') as f:
                    f.write('ok')
                os.remove(probe)
            except OSError as e:
                raise ApiError(400, '이 폴더에 저장할 권한이 없습니다 (%s)' % e.strerror)
            cfg = load_cfg()
            cfg['dataDir'] = os.path.normpath(d)
            save_cfg(cfg)
            return self.send_json({'dataDir': cfg['dataDir'], 'ok': True})
        if p == 'pickdir' and m == 'POST':
            b = self.body_json()
            try:
                return self.send_json({'path': pick_folder(b.get('initial') or '')})
            except Exception:
                raise ApiError(500, '폴더 선택 창을 열 수 없습니다. 경로를 직접 입력하세요')

        d = need_dir()
        if p == 'all' and m == 'GET':
            with FILE_LOCK:
                out = {c: list_col(d, c) for c in COLS}
                out.update({'settings': get_settings(d), 'version': version(d), 'dataDir': d})
                return self.send_json(out)
        if p == 'version' and m == 'GET':
            return self.send_json({'version': version(d)})
        if p == 'settings' and m == 'PUT':
            b = self.body_json()
            s = get_settings(d)
            lines = [str(x).strip() for x in b.get('lines', s['lines']) if str(x).strip()]
            types = [str(x).strip() for x in b.get('types', s['types']) if str(x).strip()]
            if not lines or not types:
                raise ApiError(400, '라인과 불량유형은 하나 이상 있어야 합니다')
            try:
                target = max(1, int(b.get('target', s['target'])))
            except (TypeError, ValueError):
                raise ApiError(400, '목표 PPM은 숫자로 입력하세요')
            s = {'lines': lines, 'types': types, 'target': target, 'updatedBy': USER, 'updatedAt': now_str()}
            write_json(os.path.join(d, 'settings.json'), s)
            return self.send_json(s)

        parts = p.split('/')
        if len(parts) == 2 and parts[0] in COLS:
            col, did = parts
            if not ID_RE.match(did):
                raise ApiError(400, '잘못된 문서 번호입니다')
            fp = os.path.join(d, col, did + '.json')
            with FILE_LOCK:
                if m == 'GET':
                    obj = read_json(fp)
                    if obj is None:
                        raise ApiError(404, '문서를 찾을 수 없습니다')
                    obj['id'] = did
                    return self.send_json(obj)
                if m == 'PUT':
                    b = self.body_json()
                    b.pop('id', None)
                    old = read_json(fp, {}) or {}
                    b['createdBy'] = old.get('createdBy') or USER
                    b['createdAt'] = old.get('createdAt') or now_str()
                    b['updatedBy'] = USER
                    b['updatedAt'] = now_str()
                    write_json(fp, b)
                    b['id'] = did
                    return self.send_json(b)
                if m == 'PATCH':
                    b = self.body_json()
                    b.pop('id', None)
                    obj = read_json(fp)
                    if obj is None:
                        raise ApiError(404, '다른 사용자가 삭제한 항목입니다')
                    deep_merge(obj, b)
                    obj['updatedBy'] = USER
                    obj['updatedAt'] = now_str()
                    write_json(fp, obj)
                    obj['id'] = did
                    return self.send_json(obj)
                if m == 'DELETE':
                    if os.path.exists(fp):
                        trash_move(d, fp, '%s_%s.json' % (col, did))
                    if col == 'issues':
                        trash_move(d, os.path.join(d, 'files', did), 'files_%s' % did)
                    return self.send_json({'deleted': True})

        if p == 'upload' and m == 'POST':
            iid, crit, name = q.get('issue', ''), q.get('crit', ''), q.get('name', '')
            if not ID_RE.match(iid) or not CRIT_RE.match(crit):
                raise ApiError(400, '잘못된 요청입니다')
            fp = os.path.join(d, 'issues', iid + '.json')
            if not os.path.exists(fp):
                raise ApiError(404, '이슈를 찾을 수 없습니다')
            folder = os.path.join(d, 'files', iid, crit)
            os.makedirs(folder, exist_ok=True)
            name = safe_name(name)
            n = int(self.headers.get('Content-Length') or 0)
            with FILE_LOCK:
                target = unique_path(folder, name)
                with open(target, 'wb') as f:
                    left = n
                    while left > 0:
                        chunk = self.rfile.read(min(1 << 20, left))
                        if not chunk:
                            break
                        f.write(chunk)
                        left -= len(chunk)
                fname = os.path.basename(target)
                ext = os.path.splitext(fname)[1].lstrip('.').lower()
                meta = {'name': fname, 'rel': '%s/%s/%s' % (iid, crit, fname), 'size': n, 'ext': ext,
                        'kind': kind_of(ext), 'at': datetime.now().strftime('%Y-%m-%d'), 'by': USER}
                obj = read_json(fp, {}) or {}
                cd = obj.setdefault('cd', {}).setdefault(crit, {})
                cd.setdefault('files', []).append(meta)
                obj['updatedBy'] = USER
                obj['updatedAt'] = now_str()
                write_json(fp, obj)
                obj['id'] = iid
            return self.send_json({'file': meta, 'issue': obj})

        if p == 'attach/delete' and m == 'POST':
            b = self.body_json()
            iid, crit, rel = b.get('issue', ''), b.get('crit', ''), b.get('rel', '')
            if not ID_RE.match(iid) or not CRIT_RE.match(crit):
                raise ApiError(400, '잘못된 요청입니다')
            fp = os.path.join(d, 'issues', iid + '.json')
            with FILE_LOCK:
                obj = read_json(fp)
                if obj is None:
                    raise ApiError(404, '이슈를 찾을 수 없습니다')
                files = obj.get('cd', {}).get(crit, {}).get('files', [])
                obj['cd'][crit]['files'] = [f for f in files if f.get('rel') != rel]
                src = os.path.join(d, 'files', *rel.split('/'))
                if rel and inside(os.path.join(d, 'files'), src):
                    trash_move(d, src, 'att_%s_%s' % (iid, os.path.basename(src)))
                obj['updatedBy'] = USER
                obj['updatedAt'] = now_str()
                write_json(fp, obj)
                obj['id'] = iid
            return self.send_json({'issue': obj})

        if p == 'open' and m == 'POST':
            b = self.body_json()
            if b.get('root'):
                open_path(d)
                return self.send_json({'ok': True})
            rel = b.get('rel', '')
            base = os.path.join(d, 'files')
            target = os.path.join(base, *[s for s in rel.split('/') if s])
            if not inside(base, target) or not os.path.exists(target):
                raise ApiError(404, '파일을 찾을 수 없습니다. 다른 사용자가 삭제했을 수 있습니다')
            open_path(target, select=bool(b.get('reveal')))
            return self.send_json({'ok': True})

        if p == 'export' and m == 'POST':
            b = self.body_json()
            name = safe_name(b.get('name') or 'export.csv')
            folder = os.path.join(d, 'exports')
            os.makedirs(folder, exist_ok=True)
            target = unique_path(folder, name)
            with open(target, 'w', encoding='utf-8-sig', newline='') as f:  # BOM: 엑셀에서 한글이 깨지지 않게
                f.write(b.get('text') or '')
            if not b.get('noOpen'):
                open_path(target)
            return self.send_json({'path': target})

        raise ApiError(404, 'not found')


def need_dir():
    d = data_dir()
    if not d:
        raise ApiError(409, '데이터 폴더가 설정되지 않았거나 접근할 수 없습니다')
    return d


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
        ensure_structure(a.data)
        cfg = load_cfg()
        cfg['dataDir'] = os.path.normpath(a.data)
        save_cfg(cfg)

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
        WINDOW = webview.create_window(APP_TITLE, url, width=1520, height=960, min_size=(960, 640))
        storage = os.path.join(appdata_dir(), 'webview')
        try:
            webview.start(private_mode=False, storage_path=storage)
        except TypeError:
            webview.start()
        srv.shutdown()
        return

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
