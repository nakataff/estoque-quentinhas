"""Estoque compartilhado. Python 3.12+, WSGI e SQLite, sem dependências no app."""
import csv
from contextlib import contextmanager
import hashlib
import hmac
import io
import json
import mimetypes
import os
import secrets
import sqlite3
import time
from decimal import Decimal, InvalidOperation
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parent
CATEGORIES = ('Ingredientes', 'Embalagens', 'Quentinhas prontas', 'Outros')
UNITS = ('kg', 'g', 'L', 'mL', 'un', 'pacote')

class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status

def text(value, label, maximum=120):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ApiError(f'{label}: preencha um texto de até {maximum} caracteres.')
    return value.strip()

def amount(value, label='Quantidade', positive=False):
    if isinstance(value, bool):
        raise ApiError(f'{label} inválida.')
    try:
        number = Decimal(str(value).replace(',', '.'))
        if not number.is_finite() or number < 0 or number > 1000000 or number.as_tuple().exponent < -3:
            raise ValueError()
        if positive and number == 0:
            raise ValueError()
        return int(number * 1000)
    except (InvalidOperation, ValueError, TypeError):
        raise ApiError(f'{label}: use um número {"maior que zero" if positive else "a partir de zero"}, com até 3 casas decimais.')

def identifier(value):
    if isinstance(value, bool):
        raise ApiError('Item inválido.')
    try:
        result = int(value)
        if str(result) != str(value) or result <= 0:
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise ApiError('Item inválido.')

class StockApp:
    def __init__(self, db_path=None, password=None, secure=None):
        self.db_path = str(db_path or os.environ.get('DATABASE_PATH', ROOT / 'data' / 'estoque.sqlite3'))
        self.password = password if password is not None else os.environ.get('APP_PASSWORD', '')
        if len(self.password) < 12:
            raise RuntimeError('Defina APP_PASSWORD com pelo menos 12 caracteres antes de iniciar.')
        self.secure = secure if secure is not None else os.environ.get('COOKIE_SECURE', 'true').lower() != 'false'
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE,
                    category TEXT NOT NULL, unit TEXT NOT NULL,
                    quantity INTEGER NOT NULL CHECK(quantity >= 0),
                    minimum INTEGER NOT NULL CHECK(minimum >= 0),
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS active_product_names
                    ON products(name COLLATE NOCASE) WHERE archived = 0;
                CREATE TABLE IF NOT EXISTS movements (
                    id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
                    delta INTEGER NOT NULL, balance INTEGER NOT NULL, note TEXT NOT NULL,
                    created_at INTEGER NOT NULL, request_id TEXT UNIQUE NOT NULL,
                    reversal_of INTEGER UNIQUE REFERENCES movements(id));
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL,
                    password_tag TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS login_attempts (at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            ''')
            db.execute('PRAGMA journal_mode=WAL')
            db.execute("INSERT OR IGNORE INTO config VALUES ('password_salt',?)", (secrets.token_hex(16),))
            self.salt = bytes.fromhex(db.execute("SELECT value FROM config WHERE key='password_salt'").fetchone()[0])
        # Changing the configured password invalidates existing sessions.
        self.password_hash = hashlib.pbkdf2_hmac('sha256', self.password.encode(), self.salt, 200000)
        self.password_tag = self.password_hash.hex()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def __call__(self, environ, start_response):
        status, headers = 200, []
        content_type = 'application/json; charset=utf-8'
        try:
            body, content_type, headers = self.dispatch(environ)
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode()
        except ApiError as exc:
            status = exc.status
            body = json.dumps({'error': exc.message}, ensure_ascii=False).encode()
        except sqlite3.IntegrityError:
            status, body = 409, json.dumps({'error': 'Já existe um produto com esse nome ou esta operação já foi registrada.'}).encode()
        except sqlite3.OperationalError:
            status, body = 503, json.dumps({'error': 'Banco de dados ocupado. Tente novamente em instantes.'}).encode()
        except Exception:
            import traceback
            traceback.print_exc()
            status, body = 500, b'{"error":"Nao foi possivel concluir. Tente novamente."}'
        headers.extend([
            ('Content-Type', content_type), ('Content-Length', str(len(body))),
            ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff'),
            ('X-Frame-Options', 'DENY'), ('Referrer-Policy', 'same-origin'),
            ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        ])
        labels = {200:'OK',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed',409:'Conflict',413:'Payload Too Large',429:'Too Many Requests',500:'Internal Server Error',503:'Service Unavailable'}
        start_response(f'{status} {labels.get(status, "Error")}', headers)
        return [body]

    def json_body(self, env):
        if env.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
            raise ApiError('Envie dados em JSON.')
        try:
            size = int(env.get('CONTENT_LENGTH') or 0)
            if size < 0 or size > 16384:
                raise ApiError('Dados muito grandes.', 413)
            data = json.loads(env['wsgi.input'].read(size))
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeDecodeError):
            raise ApiError('Dados inválidos.')

    def session(self, env):
        cookie = SimpleCookie()
        try:
            cookie.load(env.get('HTTP_COOKIE', ''))
            token = cookie['stock_session'].value
        except (KeyError, ValueError):
            raise ApiError('Entre com a senha para continuar.', 401)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self.connect() as db:
            session = db.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>? AND password_tag=?', (token_hash, int(time.time()), self.password_tag)).fetchone()
        if not session:
            raise ApiError('Sua sessão terminou. Entre novamente.', 401)
        return session

    def cookie(self, token, expire=False):
        return ('Set-Cookie', f'stock_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if expire else 2592000}' + ('; Secure' if self.secure else ''))

    def dispatch(self, env):
        path, method = env.get('PATH_INFO', '/'), env.get('REQUEST_METHOD', 'GET')
        if path == '/health' and method == 'GET':
            with self.connect() as db:
                db.execute('SELECT 1').fetchone()
            return {'ok': True}, 'application/json', []
        static = {'/':'index.html','/app.js':'app.js','/style.css':'style.css','/icon.svg':'icon.svg','/manifest.webmanifest':'manifest.webmanifest'}
        if path in static:
            if method != 'GET':
                raise ApiError('Método não permitido.', 405)
            file = ROOT / 'static' / static[path]
            return file.read_bytes(), mimetypes.guess_type(str(file))[0] or 'application/json', []
        if not path.startswith('/api/'):
            raise ApiError('Página não encontrada.', 404)
        if method not in ('GET', 'POST'):
            raise ApiError('Método não permitido.', 405)
        if method == 'POST':
            # Reject cross-site requests; JSON plus no CORS also prevents cross-origin forms.
            if env.get('HTTP_SEC_FETCH_SITE') == 'cross-site':
                raise ApiError('Acesso não permitido.', 403)
            origin = env.get('HTTP_ORIGIN')
            if origin and origin.split('://', 1)[-1] != env.get('HTTP_HOST'):
                raise ApiError('Acesso não permitido.', 403)
        if path == '/api/login' and method == 'POST':
            data = self.json_body(env)
            now = int(time.time())
            with self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                db.execute('DELETE FROM login_attempts WHERE at<?', (now - 300,))
                if db.execute('SELECT COUNT(*) FROM login_attempts').fetchone()[0] >= 12:
                    raise ApiError('Muitas tentativas. Aguarde 5 minutos.', 429)
                db.execute('INSERT INTO login_attempts VALUES (?)', (now,))
            candidate = data.get('password', '')
            if not isinstance(candidate, str) or len(candidate) > 1024:
                raise ApiError('Senha incorreta.', 401)
            hashed = hashlib.pbkdf2_hmac('sha256', candidate.encode(), self.salt, 200000)
            if not hmac.compare_digest(hashed, self.password_hash):
                raise ApiError('Senha incorreta.', 401)
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            with self.connect() as db:
                db.execute('DELETE FROM sessions WHERE expires<? OR password_tag!=?', (now, self.password_tag))
                db.execute('INSERT INTO sessions VALUES (?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), csrf, now + 2592000, self.password_tag))
            return {'csrf':csrf}, 'application/json', [self.cookie(token)]
        session = self.session(env)
        if method == 'POST' and not hmac.compare_digest(env.get('HTTP_X_CSRF_TOKEN', ''), session['csrf']):
            raise ApiError('Sessão inválida. Atualize a página.', 403)
        if path == '/api/session' and method == 'GET':
            return {'csrf': session['csrf']}, 'application/json', []
        if path == '/api/logout' and method == 'POST':
            with self.connect() as db:
                db.execute('DELETE FROM sessions WHERE token_hash=?', (session['token_hash'],))
            return {'ok':True}, 'application/json', [self.cookie('', True)]
        if path == '/api/stock' and method == 'GET':
            with self.connect() as db:
                products = [dict(r) for r in db.execute('SELECT * FROM products WHERE archived=0 ORDER BY name COLLATE NOCASE')]
                movements = [dict(r) for r in db.execute('''SELECT m.*, p.name, p.unit,
                    EXISTS(SELECT 1 FROM movements r WHERE r.reversal_of=m.id) AS reversed
                    FROM movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 200''')]
            return {'products':products,'movements':movements,'server_time':int(time.time())}, 'application/json', []
        if path == '/api/export' and method == 'GET':
            kind = parse_qs(env.get('QUERY_STRING', '')).get('kind', ['stock'])[0]
            output = io.StringIO()
            writer = csv.writer(output, delimiter=';')
            with self.connect() as db:
                if kind == 'history':
                    writer.writerow(['Data UTC','Produto','Movimentação','Saldo','Unidade','Observação'])
                    for r in db.execute('SELECT m.*,p.name,p.unit FROM movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC'):
                        from datetime import datetime, timezone
                        writer.writerow([datetime.fromtimestamp(r['created_at'], timezone.utc).isoformat(), self.csv_safe(r['name']),r['delta']/1000,r['balance']/1000,r['unit'],self.csv_safe(r['note'])])
                else:
                    writer.writerow(['Produto','Categoria','Quantidade','Unidade','Estoque mínimo'])
                    for r in db.execute('SELECT * FROM products WHERE archived=0 ORDER BY name'):
                        writer.writerow([self.csv_safe(r['name']),r['category'],r['quantity']/1000,r['unit'],r['minimum']/1000])
            return ('\ufeff' + output.getvalue()).encode(), 'text/csv; charset=utf-8', [('Content-Disposition',f'attachment; filename="{ "historico" if kind == "history" else "estoque"}.csv"')]
        if method != 'POST':
            raise ApiError('Página não encontrada.', 404)
        data = self.json_body(env)
        now = int(time.time())
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if path == '/api/products':
                name = text(data.get('name'), 'Nome', 80)
                category, unit = data.get('category'), data.get('unit')
                if category not in CATEGORIES or unit not in UNITS:
                    raise ApiError('Selecione uma categoria e uma unidade válidas.')
                minimum = amount(data.get('minimum', 0), 'Estoque mínimo')
                if data.get('id') is not None:
                    product_id = identifier(data['id'])
                    p = self.product(db, product_id)
                    if p['unit'] != unit:
                        raise ApiError('Para preservar o histórico, a unidade não pode ser alterada. Cadastre outro produto.')
                    db.execute('UPDATE products SET name=?,category=?,minimum=? WHERE id=?', (name, category, minimum, product_id))
                else:
                    quantity = amount(data.get('quantity', 0))
                    cur = db.execute('INSERT INTO products(name,category,unit,quantity,minimum,created_at) VALUES (?,?,?,?,?,?)', (name,category,unit,quantity,minimum,now))
                    product_id = cur.lastrowid
                    if quantity:
                        db.execute('INSERT INTO movements(product_id,delta,balance,note,created_at,request_id) VALUES (?,?,?,?,?,?)', (product_id,quantity,quantity,'Estoque inicial',now,secrets.token_urlsafe(24)))
                result = {'ok':True,'id':product_id}
            elif path == '/api/archive':
                p = self.product(db, identifier(data.get('id')))
                if p['quantity'] != 0:
                    raise ApiError('Registre a saída do saldo antes de arquivar este produto.')
                db.execute('UPDATE products SET archived=1 WHERE id=?', (p['id'],))
                result = {'ok':True}
            elif path in ('/api/movements', '/api/undo'):
                request_id = text(data.get('request_id'), 'Código da operação', 100)
                old = db.execute('SELECT id FROM movements WHERE request_id=?', (request_id,)).fetchone()
                if old:
                    return {'ok':True,'id':old['id'],'duplicate':True}, 'application/json', []
                reversal_of = None
                if path == '/api/undo':
                    m = db.execute('SELECT * FROM movements WHERE id=?', (identifier(data.get('id')),)).fetchone()
                    if not m:
                        raise ApiError('Movimentação não encontrada.', 404)
                    if m['reversal_of'] or db.execute('SELECT 1 FROM movements WHERE reversal_of=?', (m['id'],)).fetchone():
                        raise ApiError('Essa movimentação já foi desfeita ou é um estorno.', 409)
                    p = self.product(db, m['product_id'])
                    delta, note, reversal_of = -m['delta'], f'Estorno da movimentação #{m["id"]}', m['id']
                else:
                    p = self.product(db, identifier(data.get('product_id')))
                    delta = amount(data.get('quantity'), positive=True)
                    if data.get('type') not in ('in', 'out'):
                        raise ApiError('Selecione entrada ou saída.')
                    if data['type'] == 'out':
                        delta = -delta
                    note = data.get('note', '')
                    if not isinstance(note, str) or len(note.strip()) > 200:
                        raise ApiError('A observação deve ter até 200 caracteres.')
                    note = note.strip()
                balance = p['quantity'] + delta
                if balance < 0:
                    raise ApiError('Não há estoque suficiente para essa saída. Confira a quantidade.', 409)
                if balance > 1000000000:
                    raise ApiError('O saldo ultrapassa o limite permitido.')
                db.execute('UPDATE products SET quantity=? WHERE id=?', (balance,p['id']))
                cur = db.execute('INSERT INTO movements(product_id,delta,balance,note,created_at,request_id,reversal_of) VALUES (?,?,?,?,?,?,?)', (p['id'],delta,balance,note,now,request_id,reversal_of))
                result = {'ok':True,'id':cur.lastrowid}
            else:
                raise ApiError('Página não encontrada.', 404)
        return result, 'application/json', []

    @staticmethod
    def product(db, product_id):
        p = db.execute('SELECT * FROM products WHERE id=? AND archived=0', (product_id,)).fetchone()
        if not p:
            raise ApiError('Produto não encontrado.', 404)
        return p

    @staticmethod
    def csv_safe(value):
        return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) else value

def create_app():
    return StockApp()

if __name__ == '__main__':
    from wsgiref.simple_server import make_server
    port = int(os.environ.get('PORT', '8000'))
    with make_server('127.0.0.1', port, create_app()) as server:
        print(f'Estoque disponível em http://127.0.0.1:{port} (desenvolvimento)')
        server.serve_forever()
