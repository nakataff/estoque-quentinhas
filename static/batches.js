'use strict';
window.BatchExtras=(()=>{
  let state=null,api=null,refresh=null,notify=null;
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qty=v=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(v/1000);
  function render(data,ctx){
    state=data;({api,refresh,notify}=ctx);
    const el=$('#batches-view');if(!el)return;
    const today=new Date().toISOString().slice(0,10);
    let html='';
    const byProduct=new Map();
    for(const b of data.batches||[]){if(!byProduct.has(b.product_id))byProduct.set(b.product_id,[]);byProduct.get(b.product_id).push(b);}
    const stocks=state.products.filter(p=>byProduct.has(p.id));
    for(const p of stocks){
      const lots=byProduct.get(p.id);
      const assigned=lots.reduce((sum,b)=>sum+b.quantity,0);
      html+='<div class="batch-group"><h3>'+esc(p.name)+'</h3><p>Em estoque: '+qty(p.quantity)+' '+esc(p.unit)+' · Alocado a lotes: '+qty(assigned)+' '+esc(p.unit)+(assigned<p.quantity?' · '+qty(p.quantity-assigned)+' sem lote identificado':'')+'</p>';
      html+=lots.map(b=>{
        const diff=Math.ceil((Date.parse(b.expiry_date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000);
        const status=diff<0?'Vencido':diff===0?'Vence hoje':diff+' dia(s) para vencer';
        return '<div class="batch-row"><div><strong>'+qty(b.quantity)+' '+esc(b.unit||p.unit)+'</strong><p>Validade: '+esc(b.expiry_date.split('-').reverse().join('/'))+' · '+esc(status)+'</p></div><div class="batch-buttons"><button class="secondary" data-batch-edit="'+esc(b.id)+'">Editar</button><button class="text-button" data-batch-remove="'+esc(b.id)+'">Remover</button></div></div>';
      }).join('');
      html+='</div>';
    }
    if(!stocks.length)html='<div class="empty-state"><h2>Nenhum lote cadastrado</h2><p>Registre datas de validade diferentes para o mesmo ingrediente ou informe a validade de uma compra recebida.</p></div>';
    el.innerHTML=html;
  }
  function openBatch(id){
    const f=$('#batch-form'),batch=(state.batches||[]).find(b=>b.id===id);
    if(!state.products.length){notify('Cadastre um produto antes de adicionar lotes.',true);return;}
    f.reset();f.dataset.requestId=crypto.randomUUID();f.elements.id.value=batch?.id||'';
    f.elements.product_id.innerHTML=state.products.map(p=>'<option value="'+p.id+'"'+(batch?.product_id===p.id?' selected':'')+'>'+esc(p.name)+' ('+esc(p.unit)+')</option>').join('');
    f.elements.product_id.disabled=!!batch;
    f.elements.quantity.value=batch?batch.quantity/1000:'';
    f.elements.expiry_date.value=batch?.expiry_date||'';
    $('#batch-title').textContent=batch?'Editar lote':'Adicionar lote';
    f.querySelector('.form-error').textContent='';
    $('#batch-dialog').showModal();
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||!state)return;
    if(b.id==='batch-new')openBatch();
    if(b.dataset.batchEdit)openBatch(b.dataset.batchEdit);
    if(b.dataset.batchRemove){
      const batch=state.batches.find(i=>i.id===b.dataset.batchRemove);if(!batch)return;
      if(!confirm('Remover este lote do controle de validade? Isso não muda o saldo do estoque.'))return;
      api('/api/batches',{id:batch.id,remove:true,request_id:crypto.randomUUID()}).then(refresh).then(()=>notify('Lote removido.')).catch(err=>notify(err.message,true));
    }
  });
  $('#batch-form').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.currentTarget,b=f.querySelector('button[type="submit"]');
    b.disabled=true;f.querySelector('.form-error').textContent='';
    try{
      await api('/api/batches',{...(f.elements.id.value?{id:f.elements.id.value}:{}),product_id:Number(f.elements.product_id.value),quantity:f.elements.quantity.value,expiry_date:f.elements.expiry_date.value,request_id:f.dataset.requestId});
      $('#batch-dialog').close();await refresh();notify('Lote salvo.');
    }catch(err){f.querySelector('.form-error').textContent=err.message;}finally{b.disabled=false;}
  });
  return {render};
})();