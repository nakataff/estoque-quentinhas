import io
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4
from app import StockApp

PASSWORD = 'senha-de-teste-segura'

class Client:
    def __init__(self, app):
        self.app, self.cookie, self.csrf = app, '', ''

    def request(self, path, data=None, csrf=True):
        route, _, query = path.partition('?')
        raw = json.dumps(data).encode() if data is not None else b''
        env = {'PATH_INFO':route,'QUERY_STRING':query,'REQUEST_METHOD':'POST' if data is not None else 'GET',
               'CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(len(raw)),
               'wsgi.input':io.BytesIO(raw),'HTTP_COOKIE':self.cookie,'HTTP_X_CSRF_TOKEN':self.csrf if csrf else '',
               'HTTP_HOST':'localhost','HTTP_ORIGIN':'http://localhost'}
        response = {}
        def start(status, headers):
            response['status'] = int(status.split()[0]); response['headers']=dict(headers)
        body = b''.join(self.app(env,start))
        if 'Set-Cookie' in response['headers']:
            self.cookie = response['headers']['Set-Cookie'].split(';')[0]
        if 'json' in response['headers']['Content-Type']:
            body = json.loads(body)
        if path == '/api/login' and response['status']==200:
            self.csrf = body['csrf']
        return response['status'], body

    def login(self):
        return self.request('/api/login', {'password':PASSWORD})

    def product(self, quantity='5', name='Arroz'):
        return self.request('/api/products',{'name':name,'category':'Ingredientes','unit':'kg','minimum':'2','quantity':quantity})

    def movement(self, pid, quantity, kind='out', request_id=None):
        return self.request('/api/movements',{'product_id':pid,'quantity':quantity,'type':kind,'request_id':request_id or str(uuid4())})

class StockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name)/'stock.sqlite3'
        self.app = StockApp(self.db_path, PASSWORD, secure=False)
        self.client = Client(self.app)
        self.assertEqual(self.client.login()[0],200)

    def tearDown(self):
        self.tmp.cleanup()

    def test_authentication_csrf_and_logout(self):
        anonymous = Client(self.app)
        self.assertEqual(anonymous.request('/api/stock')[0],401)
        self.assertEqual(anonymous.request('/api/login',{'password':'wrong'})[0],401)
        self.assertEqual(self.client.request('/api/products',{'name':'Arroz'},csrf=False)[0],403)
        self.assertEqual(self.client.request('/api/logout',{})[0],200)
        self.assertEqual(self.client.request('/api/stock')[0],401)

    def test_two_devices_share_persistent_data(self):
        status, p = self.client.product('1.125')
        self.assertEqual(status,200)
        second = Client(StockApp(self.db_path,PASSWORD,secure=False))
        self.assertEqual(second.login()[0],200)
        self.assertEqual(second.request('/api/stock')[1]['products'][0]['quantity'],1125)
        self.assertEqual(second.movement(p['id'],'0.125')[0],200)
        self.assertEqual(self.client.request('/api/stock')[1]['products'][0]['quantity'],1000)
        # Existing session remains valid on another server process and after restart.
        second.cookie, second.csrf = self.client.cookie, self.client.csrf
        self.assertEqual(second.request('/api/session')[0],200)

    def test_concurrent_withdrawals_cannot_overdraw(self):
        pid = self.client.product('5')[1]['id']
        clients = [Client(self.app),Client(self.app)]
        for client in clients:
            client.login()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda c: c.movement(pid,'4'),clients))
        self.assertEqual(sorted(r[0] for r in results),[200,409])
        stock = self.client.request('/api/stock')[1]
        self.assertEqual(stock['products'][0]['quantity'],1000)
        self.assertEqual(len(stock['movements']),2)

    def test_repeated_requests_are_idempotent(self):
        pid=self.client.product('5')[1]['id']
        key=str(uuid4())
        self.assertEqual(self.client.movement(pid,'1',request_id=key)[0],200)
        self.assertTrue(self.client.movement(pid,'1',request_id=key)[1]['duplicate'])
        self.assertEqual(self.client.request('/api/stock')[1]['products'][0]['quantity'],4000)

    def test_undo_is_logged_and_only_happens_once(self):
        pid=self.client.product()[1]['id']
        movement=self.client.movement(pid,'2')[1]['id']
        self.assertEqual(self.client.request('/api/undo',{'id':movement,'request_id':str(uuid4())})[0],200)
        self.assertEqual(self.client.request('/api/stock')[1]['products'][0]['quantity'],5000)
        self.assertEqual(self.client.request('/api/undo',{'id':movement,'request_id':str(uuid4())})[0],409)
        rows=self.client.request('/api/stock')[1]['movements']
        self.assertEqual(len(rows),3)
        self.assertEqual(rows[0]['reversal_of'],movement)

    def test_undo_entry_cannot_create_negative_balance(self):
        pid=self.client.product('0')[1]['id']
        entry=self.client.movement(pid,'2','in')[1]['id']
        self.client.movement(pid,'2')
        self.assertEqual(self.client.request('/api/undo',{'id':entry,'request_id':str(uuid4())})[0],409)
        self.assertEqual(self.client.request('/api/stock')[1]['products'][0]['quantity'],0)

    def test_invalid_quantities_and_duplicate_names(self):
        for invalid in ['-1','NaN','Infinity','0.0001','1000001',True,None]:
            self.assertEqual(self.client.product(invalid)[0],400)
        pid=self.client.product()[1]['id']
        self.assertEqual(self.client.product(name='arroz')[0],409)
        self.assertEqual(self.client.movement(pid,'0')[0],400)
        self.assertEqual(self.client.movement(pid,'6')[0],409)

    def test_archive_preserves_history_and_unit_cannot_change(self):
        pid=self.client.product()[1]['id']
        self.assertEqual(self.client.request('/api/archive',{'id':pid})[0],400)
        self.assertEqual(self.client.request('/api/products',{'id':pid,'name':'Arroz','category':'Ingredientes','unit':'g','minimum':0})[0],400)
        self.client.movement(pid,'5')
        self.assertEqual(self.client.request('/api/archive',{'id':pid})[0],200)
        stock=self.client.request('/api/stock')[1]
        self.assertEqual(stock['products'],[])
        self.assertEqual(len(stock['movements']),2)

    def test_export_full_history_and_formula_escape(self):
        self.client.product(name='=1+1')
        status, csv = self.client.request('/api/export')
        self.assertEqual(status,200)
        self.assertIn("'=1+1",csv.decode())
        self.assertIn('Estoque inicial',self.client.request('/api/export?kind=history')[1].decode())
        self.assertEqual(Client(self.app).request('/api/export')[0],401)

    def test_password_change_invalidates_sessions(self):
        changed=Client(StockApp(self.db_path,'nova-senha-segura',secure=False))
        changed.cookie=self.client.cookie
        self.assertEqual(changed.request('/api/session')[0],401)

    def test_login_rate_limit_is_persistent(self):
        anonymous=Client(self.app)
        for _ in range(11):
            self.assertEqual(anonymous.request('/api/login',{'password':'wrong'})[0],401)
        other=Client(StockApp(self.db_path,PASSWORD,secure=False))
        self.assertEqual(other.login()[0],429)

    def test_static_files_and_health(self):
        client=Client(self.app)
        for path in ['/','/app.js','/style.css','/icon.svg','/manifest.webmanifest','/health']:
            self.assertEqual(client.request(path)[0],200)
        self.assertEqual(client.request('/../../app.py')[0],404)
        self.assertEqual(client.request('/app.py')[0],404)

if __name__ == '__main__':
    unittest.main()
