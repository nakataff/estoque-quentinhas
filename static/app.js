'use strict';
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
let csrf='', state={products:[], movements:[]}, polling=null, toastTimer=null, confirmAction=null, online=false, loading=false;
const format = value => new Intl.NumberFormat('pt-BR', {maximumFractionDigits:3}).format(value/1000);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => new Date(value*1000).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const token = () => crypto.randomUUID();
const number = value => String(value).replace(',', '.');
const status = p => p.quantity===0 ? ['empty','Em falta'] : p.quantity<=p.minimum ? ['low','Estoque baixo'] : ['ok','Estoque em dia'];
function notify(message, error=false) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.toggle('error-toast',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function showLogin() {clearInterval(polling);polling=null;csrf='';online=false;state={products:[],movements:[]};$$('dialog[open]').forEach(d=>d.close());$('#dashboard').hidden=true;$('#login').hidden=false;$('#password').value='';}
async function api(path, data) {
  if(window.CloudStock?.enabled){try{return await CloudStock.api(path,data);}catch(error){if(error.status===401&&path!=='/api/login')showLogin();throw error;}}
  let response;
  try {response=await fetch(path,{method:data ? 'POST':'GET',headers:data ? {'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:data ? JSON.stringify(data):undefined,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});}
  catch {throw new Error('Sem conexão com o servidor. Confira sua internet e tente novamente.');}
  const result=await response.json();
  if (!response.ok) {if(response.status===401 && path!=='/api/login') showLogin();throw new Error(result.error || 'Não foi possível concluir.');}
  return result;
}
async function refresh() {
  if(loading) return;
  loading=true;
  try {const data=await api('/api/stock');if(!csrf)return;state=data;online=true;$('#sync').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});$('#sync').classList.remove('offline');render();}
  catch {online=false;$('#sync').textContent='Sem conexão';$('#sync').classList.add('offline');}
  finally {loading=false;}
}
async function start() {$('#login').hidden=true;$('#dashboard').hidden=false;$('#today').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();await refresh();clearInterval(polling);polling=setInterval(()=>{if(!document.hidden)refresh();},10000);}
const empty = (title, description, create=false) => `<div class="empty-state"><div class="empty-icon" aria-hidden="true">◇</div><h2>${esc(title)}</h2><p>${esc(description)}</p>${create?'<button class="primary" data-create>＋ Cadastrar primeiro produto</button>':''}</div>`;
function render() {
  const low=state.products.filter(p=>p.quantity<=p.minimum), missing=state.products.filter(p=>p.quantity===0);
  $('#total-count').textContent=state.products.length;$('#low-count').textContent=low.length;$('#empty-count').textContent=missing.length;$('#shopping-count').textContent=low.length;
  const term=$('#search').value.trim().toLocaleLowerCase('pt-BR'), category=$('#category-filter').value, filter=$('#status-filter').value;
  const products=state.products.filter(p=>p.name.toLocaleLowerCase('pt-BR').includes(term)&&(category==='all'||p.category===category)&&(filter==='all'||(filter==='low'&&p.quantity<=p.minimum)||(filter==='empty'&&p.quantity===0)));
  $('#result-count').textContent=`${products.length} produto${products.length===1?'':'s'}`;
  $('#products').innerHTML=products.length ? products.map(p=>{const [kind,label]=status(p);return `<article class="product-card"><div class="card-top"><span class="category">${esc(p.category)}</span><button class="edit-button" data-edit="${p.id}" aria-label="Editar ${esc(p.name)}">Editar</button></div><h2>${esc(p.name)}</h2><div class="quantity">${format(p.quantity)}<span>${esc(p.unit)}</span></div><div class="minimum">Mínimo: ${format(p.minimum)} ${esc(p.unit)}</div><span class="badge ${kind}">${label}</span><div class="card-actions"><button class="entry" data-move="in" data-id="${p.id}">＋ Entrou</button><button class="exit" data-move="out" data-id="${p.id}">− Saiu</button></div></article>`;}).join('') : state.products.length ? empty('Nenhum produto encontrado','Tente outro nome ou altere os filtros.') : empty('Vamos organizar seu estoque?','Cadastre o primeiro ingrediente, embalagem ou quentinha.',true);
  $('#shopping-list').innerHTML=low.length ? low.map(p=>`<div class="list-row"><div><h3>${esc(p.name)}</h3><p>Tem ${format(p.quantity)} ${esc(p.unit)} · Mínimo: ${format(p.minimum)} ${esc(p.unit)}</p></div><button class="secondary" data-move="in" data-id="${p.id}">＋ Repor</button></div>`).join('') : empty('Tudo em dia por aqui',state.products.length?'Nenhum produto precisa de reposição agora.':'Cadastre produtos e defina seus estoques mínimos.');
  $('#history-list').innerHTML=state.movements.length ? state.movements.map(m=>`<div class="list-row"><div><h3>${esc(m.name)}</h3><p>${date(m.created_at)} · Saldo: ${format(m.balance)} ${esc(m.unit)}</p>${m.note?`<p class="note">${esc(m.note)}</p>`:''}</div><div class="right"><div class="amount ${m.delta>0?'positive':'negative'}">${m.delta>0?'+':''}${format(m.delta)} ${esc(m.unit)}</div>${m.reversed?'<p class="note">Desfeito</p>':m.reversal_of?'<p class="note">Estorno</p>':`<button class="undo" data-undo="${m.id}">Desfazer</button>`}</div></div>`).join('') : empty('Ainda não há movimentações','As entradas e saídas vão aparecer aqui.');
}
function openProduct(id) {
  const form=$('#product-form');form.reset();$('.form-error',form).textContent='';const p=state.products.find(p=>p.id===id);
  form.elements.id.value=p ? p.id:'';$('#product-title').textContent=p?'Editar produto':'Cadastrar produto';$('#initial-label').hidden=!!p;form.elements.quantity.disabled=!!p;form.elements.unit.disabled=!!p;$('#archive-product').hidden=!p;
  if(p){for(const key of ['name','category','unit','minimum']) form.elements[key].value=key==='minimum'?p[key]/1000:p[key];}
  $('#product-dialog').showModal();
}
function openMovement(id,type) {
  const p=state.products.find(p=>p.id===id);if(!p)return;
  const form=$('#movement-form');form.reset();form.dataset.requestId=token();$('.form-error',form).textContent='';form.elements.product_id.value=id;form.elements.type.value=type;
  $('#movement-title').textContent=p.name;$('#movement-eyebrow').textContent=type==='in'?'ENTRADA NO ESTOQUE':'SAÍDA DO ESTOQUE';$('#current-balance').textContent=`Você tem ${format(p.quantity)} ${p.unit} em estoque.`;form.elements.quantity.max=type==='out'?p.quantity/1000:1000000;
  $('#save-movement').textContent=type==='in'?'Confirmar entrada':'Confirmar saída';$('#movement-dialog').showModal();
}
function confirm(title, description, action) {$('#confirm-title').textContent=title;$('#confirm-description').textContent=description;$('.form-error',$('#confirm-form')).textContent='';confirmAction=action;$('#confirm-dialog').showModal();}
async function saving(form, action) {const button=$('button[type="submit"]',form);if(button.disabled)return;button.disabled=true;$('.form-error',form).textContent='';try{await action();}catch(error){$('.form-error',form).textContent=error.message;}finally{button.disabled=false;}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type="submit"]',e.target);button.disabled=true;$('#login-error').textContent='';try{const result=await api('/api/login',{password:$('#password').value,email:$('#email').value.trim()});csrf=result.csrf;$('#password').value='';await start();}catch(error){$('#login-error').textContent=error.message;}finally{button.disabled=false;}});
$('#show-password').addEventListener('click',()=>{const show=$('#password').type==='password';$('#password').type=show?'text':'password';$('#show-password').textContent=show?'Ocultar':'Mostrar';$('#show-password').setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{});showLogin();}catch(e){notify(e.message,true);}});
$('#new-product').addEventListener('click',()=>openProduct());
function tab(name){$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));for(const n of ['stock','shopping','history'])$('#'+n+'-panel').hidden=n!==name;}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.close)$('#'+b.dataset.close).close();if(b.hasAttribute('data-create'))openProduct();if(b.dataset.edit)openProduct(Number(b.dataset.edit));if(b.dataset.move)openMovement(Number(b.dataset.id),b.dataset.move);if(b.dataset.tab)tab(b.dataset.tab);if(b.dataset.status){$('#status-filter').value=b.dataset.status;tab('stock');render();}if(b.dataset.undo){const m=state.movements.find(m=>m.id===Number(b.dataset.undo));const request_id=token();confirm('Desfazer movimentação?',`Será registrado um estorno de ${format(Math.abs(m.delta))} ${m.unit} de ${m.name}. O histórico continuará preservado.`,async()=>{await api('/api/undo',{id:m.id,request_id});await refresh();notify('Movimentação desfeita.');});}});
for(const selector of ['#search','#category-filter','#status-filter'])$(selector).addEventListener('input',render);
$('#product-form').addEventListener('submit',e=>{e.preventDefault();saving(e.target,async()=>{const f=e.target;const data={name:f.elements.name.value,category:f.elements.category.value,unit:f.elements.unit.value,minimum:number(f.elements.minimum.value)};if(f.elements.id.value)data.id=Number(f.elements.id.value);else data.quantity=number(f.elements.quantity.value);await api('/api/products',data);$('#product-dialog').close();await refresh();notify('Produto salvo.');});});
$('#movement-form').addEventListener('submit',e=>{e.preventDefault();saving(e.target,async()=>{const f=e.target;await api('/api/movements',{product_id:Number(f.elements.product_id.value),type:f.elements.type.value,quantity:number(f.elements.quantity.value),note:f.elements.note.value,request_id:f.dataset.requestId});$('#movement-dialog').close();await refresh();notify('Movimentação registrada.');});});
$('#archive-product').addEventListener('click',()=>{const id=Number($('#product-form').elements.id.value),p=state.products.find(p=>p.id===id);if(p.quantity!==0){$('.form-error',$('#product-form')).textContent='Registre a saída do saldo antes de arquivar este produto.';return;}confirm('Arquivar produto?',`${p.name} sairá do estoque. O histórico será preservado.`,async()=>{await api('/api/archive',{id});$('#product-dialog').close();await refresh();notify('Produto arquivado.');});});
$('#confirm-form').addEventListener('submit',e=>{e.preventDefault();saving(e.target,async()=>{await confirmAction();$('#confirm-dialog').close();});});
async function download(kind){try{let blob;if(window.CloudStock?.enabled){blob=await CloudStock.exportCSV(kind);}else{const r=await fetch('/api/export?kind='+kind,{credentials:'same-origin'});if(!r.ok){if(r.status===401)showLogin();throw new Error('Não foi possível baixar o arquivo.');}blob=await r.blob();}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=kind==='history'?'historico.csv':'estoque.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notify(e.message,true);}}
$('#export-stock').addEventListener('click',()=>download('stock'));$('#export-history').addEventListener('click',()=>download('history'));
$('#copy-shopping').addEventListener('click',async()=>{const low=state.products.filter(p=>p.quantity<=p.minimum);if(!low.length){notify('Nenhum produto precisa de reposição.');return;}const list='Lista de compras\n\n'+low.map(p=>`${p.name} — tem ${format(p.quantity)} ${p.unit}; mínimo ${format(p.minimum)} ${p.unit}`).join('\n');try{await navigator.clipboard.writeText(list);notify('Lista copiada. Pode colar no WhatsApp!');}catch{notify('Não foi possível copiar. Permita o acesso à área de transferência.',true);}});
window.addEventListener('online',()=>{if(csrf)refresh();});window.addEventListener('offline',()=>{online=false;$('#sync').textContent='Sem conexão';$('#sync').classList.add('offline');});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&csrf)refresh();});
if(window.CloudStock?.enabled){$('#email-label').hidden=false;$('#email').required=true;}
(async()=>{try{const session=await api('/api/session');csrf=session.csrf;await start();}catch{showLogin();}})();
