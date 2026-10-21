'use strict';
window.CloudStock=(()=>{
  const config=window.STOCK_CONFIG||{}, enabled=config.provider==='firebase', firebase=config.firebaseConfig||{};
  const storageKey='cozinha-firebase:'+firebase.projectId;
  let refreshing=null;
  function load(){try{return JSON.parse(localStorage.getItem(storageKey)||'null');}catch{return null;}}
  function save(session){if(session)localStorage.setItem(storageKey,JSON.stringify(session));else localStorage.removeItem(storageKey);}
  function ready(){if(!firebase.apiKey||!firebase.databaseURL||!firebase.projectId)throw new Error('O Firebase ainda não foi conectado. Falta configurar o projeto do estoque.');if(!/^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(firebase.databaseURL))throw new Error('O endereço do banco Firebase está inválido.');}
  const errors={INVALID_LOGIN_CREDENTIALS:'E-mail ou senha incorretos.',INVALID_PASSWORD:'E-mail ou senha incorretos.',EMAIL_NOT_FOUND:'E-mail ou senha incorretos.',TOO_MANY_ATTEMPTS_TRY_LATER:'Muitas tentativas. Aguarde um pouco e tente novamente.',USER_DISABLED:'Esta conta está desativada.'};
  async function http(url,options={}){let response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});}catch{throw new Error('Sem conexão com o Firebase. Tente novamente.');}const data=await response.json().catch(()=>null);return {response,data};}
  async function authenticate(email,password){ready();const {response,data}=await http('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(firebase.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});if(!response.ok)throw new Error(errors[data?.error?.message]||'Não foi possível entrar. Confira o e-mail e a senha.');const s={idToken:data.idToken,refreshToken:data.refreshToken,expiresAt:Math.floor(Date.now()/1000)+Number(data.expiresIn),uid:data.localId};save(s);return s;}
  async function session(){ready();const s=load();if(!s){const e=new Error('Entre com seu e-mail e senha.');e.status=401;throw e;}if(s.expiresAt>Math.floor(Date.now()/1000)+60)return s;
    if(!refreshing){const refresh=async()=>{const current=load();if(!current){const e=new Error('Entre novamente.');e.status=401;throw e;}if(current.expiresAt>Math.floor(Date.now()/1000)+60)return current;const {response,data}=await http('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(firebase.apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:current.refreshToken}).toString()});if(!response.ok){if(response.status===400||response.status===401)save(null);const e=new Error('Sua sessão terminou. Entre novamente.');e.status=401;throw e;}const next={idToken:data.id_token,refreshToken:data.refresh_token,expiresAt:Math.floor(Date.now()/1000)+Number(data.expires_in),uid:data.user_id};save(next);return next;};refreshing=(navigator.locks?navigator.locks.request(storageKey,refresh):refresh()).finally(()=>refreshing=null);}return refreshing;
  }
  async function database(options={}){const s=await session();const result=await http(firebase.databaseURL.replace(/\/$/,'')+'/kitchen.json?auth='+encodeURIComponent(s.idToken),options);if(!result.response.ok&&result.response.status!==412){const e=new Error(result.response.status===401||result.response.status===403?'Sua conta não está autorizada ou a sessão terminou. Confira as regras e os usuários do Firebase.':'Não foi possível acessar o estoque.');e.status=result.response.status;throw e;}return result;}
  async function transaction(action,data){for(let attempt=0;attempt<8;attempt++){const read=await database({headers:{'X-Firebase-ETag':'true'}});const changed=StockEngine.apply(read.data,action,data);if(changed.result.duplicate)return changed.result;const write=await database({method:'PUT',headers:{'Content-Type':'application/json','if-match':read.response.headers.get('ETag')},body:JSON.stringify(changed.stock)});if(write.response.status!==412)return changed.result;}throw new Error('O estoque está recebendo outras alterações. Tente novamente.');}
  async function api(path,data){if(path==='/api/login'){await authenticate(data.email,data.password);try{await database();}catch(e){save(null);throw e;}return {csrf:'firebase'};}if(path==='/api/logout'){save(null);return {ok:true};}if(path==='/api/session'){await session();return {csrf:'firebase'};}if(path==='/api/stock')return StockEngine.snapshot((await database()).data);return transaction(path.replace('/api/',''),data||{});}
  async function exportCSV(kind){const result=StockEngine.snapshot((await database()).data,true),safe=v=>{const t=String(v??'');return /^[\s]*[=+@-]/.test(t)?"'"+t:t;},quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const rows=kind==='purchases'?[['Data','Produto','Quantidade','Unidade','Marca','Fornecedor','Total previsto','Total pago','Situação'],...result.purchases.map(p=>[p.date,safe(p.name),p.quantity/1000,p.unit,safe(p.brand),safe(p.supplier),p.estimated_total>=0?p.estimated_total/100:'',p.total/100,p.reversed?'Estornada':'Recebida'])]:kind==='history'?[['Data UTC','Produto','Movimentação','Saldo','Unidade','Observação'],...result.movements.map(m=>[new Date(m.created_at*1000).toISOString(),safe(m.name),m.delta/1000,m.balance/1000,m.unit,safe(m.note)])]:[['Produto','Categoria','Quantidade','Unidade','Estoque mínimo'],...result.products.map(p=>[safe(p.name),p.category,p.quantity/1000,p.unit,p.minimum/1000])];return new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});}

  // Contas a pagar ficam em /finance, fora dos dados e transações do estoque.
  async function financeRequest(options={}){
    const s=await session();
    const url=firebase.databaseURL.replace(/\\/$/,'')+'/finance.json?auth='+encodeURIComponent(s.idToken);
    const result=await http(url,options);
    if(!result.response.ok&&result.response.status!==412){
      const error=new Error(result.response.status===403?'Sem permissão para as contas. Publique as regras atualizadas do Firebase.':'Não foi possível sincronizar as contas. Confira sua conexão.');
      error.status=result.response.status;throw error;
    }
    return result;
  }
  async function financeRead(){
    if(!enabled)throw new Error('As contas a pagar estão disponíveis na versão Firebase / GitHub Pages.');
    return FinanceEngine.clean((await financeRequest()).data);
  }
  async function financeTransaction(action){
    if(!enabled)throw new Error('Use a versão Firebase para registrar contas.');
    for(let attempt=0;attempt<8;attempt++){
      const read=await financeRequest({headers:{'X-Firebase-ETag':'true'}});
      const next=FinanceEngine.apply(read.data,action);
      const write=await financeRequest({method:'PUT',headers:{'Content-Type':'application/json','if-match':read.response.headers.get('ETag')},body:JSON.stringify(next)});
      if(write.response.status!==412)return next;
    }
    throw new Error('Outra pessoa alterou as contas ao mesmo tempo. Tente novamente.');
  }
  return {enabled,api,exportCSV,financeRead,financeTransaction};
})();
