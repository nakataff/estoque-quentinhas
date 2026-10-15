'use strict';
// Extensões do painel de compras: listas, conferência no mercado, unidades e relatórios.
window.StockExtras=(()=>{
  let state=null,actions=null,selected='default',market=false;
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qty=v=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(v/1000);
  const money=v=>v===undefined||v===null||v<0?'Não informado':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
  const rid=()=>crypto.randomUUID();
  const getLists=()=>state?.shoppingLists||[{id:'default',name:'Lista principal'}];
  const listName=id=>getLists().find(l=>l.id===id)?.name||'Lista';
  const filteredItems=items=>(items||[]).filter(i=>(i.list_id||'default')===selected);
  const idFor=i=>i.manual?i.id:String(i.product_id);
  const getItem=id=>(state?.shopping||[]).find(i=>idFor(i)===id);
  const automatic=(from,to)=>({kg:{g:1000},g:{kg:.001},L:{mL:1000},mL:{L:.001}})[from]?.[to];
  function fillListFields(data,form,kind,id){
    if(!form.elements.list_id)return;
    const lists=data.shoppingLists||[{id:'default',name:'Lista principal'}];
    const line=kind==='stock'?data.shopping.find(i=>i.product_id===Number(form.elements.product_id.value)):null;
    const current=id||line?.list_id||selected;
    form.elements.list_id.innerHTML=lists.map(l=>'<option value="'+esc(l.id)+'"'+(l.id===current?' selected':'')+'>'+esc(l.name)+'</option>').join('');
  }
  function preparePackages(data,form,product){
    const label=$('#package-count-label');if(!label)return;
    const size=product.package_size||0;
    label.hidden=!size;
    form.elements.package_count.value='';
    form.dataset.packageSize=String(size);
    if(size){
      $('#package-buying-note').textContent='1 '+(product.package_label||'embalagem')+' contém '+qty(size)+' '+product.unit+'. A quantidade recebida será preenchida automaticamente.';
      if(Number(form.elements.quantity.value)>0)form.elements.package_count.value=(Number(form.elements.quantity.value)*1000/size).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
    }
  }
  function totals(items){
    const estimated=items.filter(i=>i.estimate>=0).reduce((n,i)=>n+i.estimate,0);
    const checked=items.filter(i=>i.collected),actual=checked.filter(i=>i.actual_unit_price>=0);
    const actualTotal=actual.reduce((n,i)=>n+StockEngine.lineCost(i.quantity,i.actual_unit_price),0);
    return {estimated,checked,actual,actualTotal,unknown:items.filter(i=>i.estimate<0).length};
  }
  function renderMarket(items){
    const box=$('#market-view');box.hidden=!market;if(!market)return;
    if(document.activeElement?.hasAttribute('data-market-price'))return; // Preserve typing during 10-second cloud refreshes.
    const t=totals(items),count=items.length;
    let html='<div class="market-head"><div><p class="eyebrow">COMPRAS EM ANDAMENTO</p><h2>'+esc(listName(selected))+'</h2><p>'+t.checked.length+' de '+count+' itens no carrinho</p></div><button class="secondary" id="market-close">Voltar à lista</button></div>';
    html+='<div class="market-progress" role="progressbar" aria-label="Progresso da lista" aria-valuemin="0" aria-valuemax="'+count+'" aria-valuenow="'+t.checked.length+'"><span style="width:'+(count?Math.round(100*t.checked.length/count):0)+'%"></span></div>';
    html+='<div class="market-stats"><div><span>Orçamento estimado</span><strong>'+money(t.estimated)+'</strong></div><div><span>Valor real informado</span><strong>'+money(t.actualTotal)+'</strong><small>'+t.actual.length+' item(ns) com preço real</small></div><div><span>Falta pegar</span><strong>'+(count-t.checked.length)+' item(ns)</strong></div></div>';
    if(!count)html+='<div class="empty-state"><h2>Lista vazia</h2><p>Adicione itens na lista e abra novamente o modo mercado.</p></div>';
    html+=[...items].sort((a,b)=>Number(!!a.collected)-Number(!!b.collected)).map(i=>{
      const id=esc(idFor(i)),checked=!!i.collected,price=i.actual_unit_price>=0?i.actual_unit_price/100:'';
      const kind=i.manual?'Item avulso':'Produto do estoque';
      return '<article class="market-item'+(checked?' market-checked':'')+'"><div class="market-item-main"><label class="market-check"><input type="checkbox" data-market-check="'+id+'"'+(checked?' checked':'')+'><span class="market-check-name">'+esc(i.name)+'</span></label><small>'+kind+' · '+qty(i.quantity)+' '+esc(i.unit)+'</small></div><div class="market-item-prices"><div><span>Estimado</span><strong>'+money(i.estimate)+'</strong></div><label>Preço pago por '+esc(i.unit)+'<input data-market-price="'+id+'" type="number" min="0" max="1000000" step="0.01" inputmode="decimal" value="'+esc(price)+'" placeholder="R$ 0,00"></label></div><div class="market-item-foot">'+(i.brand?'<small>Marca: '+esc(i.brand)+'</small>':'')+(i.supplier?'<small>Mercado: '+esc(i.supplier)+'</small>':'')+(checked&&i.actual_unit_price>=0?'<small>Subtotal real: '+money(StockEngine.lineCost(i.quantity,i.actual_unit_price))+'</small>':'')+'<button class="text-button" data-market-edit="'+id+'">Editar item</button>'+(checked&&i.manual?'<button class="text-button" data-manual-done="'+id+'">Finalizar item</button>':'')+'</div></article>';
    }).join('');
    html+='<p class="market-note">Marcar o item indica que ele está no carrinho. O estoque só muda quando a compra é recebida. Preços reais são opcionais; valores ausentes não entram no total real.</p>';
    box.innerHTML=html;
  }
  function renderInsights(){
    const el=$('#insights-view');if(!el)return;
    const products=state.products||[],all=state.analytics||[];
    const byId=new Map(all.map(a=>[a.product_id,a]));
    let text='<div class="insights-stats"><div class="stat"><span>Produtos monitorados</span><strong>'+products.length+'</strong></div><div class="stat"><span>Consumidos nos últimos 30 dias</span><strong>'+all.filter(a=>a.consumed_30>0).length+'</strong></div><div class="stat"><span>Compras registradas</span><strong>'+(state.purchases||[]).filter(p=>!p.reversed).length+'</strong></div></div>';
    text+='<div class="section-title"><div><h2>Consumo e previsão de reposição</h2><p>Média dos últimos 30 dias. A previsão depende das saídas registradas.</p></div></div><div class="insights-table">';
    text+='<div class="insights-header"><span>Produto</span><span>Saída / 30 dias</span><span>Autonomia estimada</span></div>';
    text+=products.map(p=>{
      const a=byId.get(p.id),used=a?.consumed_30||0;
      const days=used>0?Math.floor(p.quantity*30/used):null;
      const forecast=days===null?'Sem consumo suficiente':days===0?'Menos de 1 dia':days+' dia(s)';
      return '<div class="insights-row"><strong>'+esc(p.name)+'</strong><span>'+qty(used)+' '+esc(p.unit)+'</span><span>'+esc(forecast)+'</span></div>';
    }).join('')||'<p class="form-help">Cadastre produtos para visualizar relatórios.</p>';
    text+='</div><div class="section-title"><div><h2>Histórico de preços</h2><p>Últimas compras pagas, por unidade cadastrada à época da compra.</p></div></div><div class="insights-table">';
    const purchases=(state.purchases||[]).filter(p=>!p.reversed).sort((a,b)=>b.id-a.id).slice(0,30);
    text+=purchases.map(p=>'<div class="insights-row"><strong>'+esc(p.name)+'</strong><span>'+esc(p.date)+' · '+qty(p.quantity)+' '+esc(p.unit)+'</span><span>'+money(p.unit_price)+' / '+esc(p.unit)+'</span></div>').join('')||'<p class="form-help">Nenhuma compra com preço registrado.</p>';
    text+='</div>';
    el.innerHTML=text;
  }
  function render(data,ctx){
    state=data;actions=ctx;
    if(!getLists().some(l=>l.id===selected))selected='default';
    const picker=$('#shopping-active-list');
    if(!picker)return;
    picker.innerHTML=getLists().map(l=>'<option value="'+esc(l.id)+'"'+(l.id===selected?' selected':'')+'>'+esc(l.name)+'</option>').join('');
    $('#shopping-list-rename').hidden=selected==='default';
    $('#shopping-list-delete').hidden=selected==='default';
    $('#market-toggle').textContent=market?'Sair do modo mercado':'Abrir modo mercado';
    const items=filteredItems(state.shopping),completed=filteredItems(state.completedShopping||[]);
    $('#shopping-list').hidden=market;
    document.querySelectorAll('#shopping-list [data-list-id]').forEach(el=>el.hidden=el.dataset.listId!==selected);
    const placeholder=$('#shopping-current-empty');placeholder.hidden=market||items.length>0||!document.querySelector('#shopping-list .shopping-card');
    const doneSection=$('#completed-shopping-section');doneSection.hidden=market||completed.length===0;
    document.querySelectorAll('#completed-shopping [data-list-id]').forEach(el=>el.hidden=el.dataset.listId!==selected);
    const t=totals(items);
    $('#shopping-estimate').textContent=money(t.estimated);
    $('#shopping-unknown').textContent=t.unknown?t.unknown+' item(ns) sem preço; orçamento parcial.':'Orçamento da lista selecionada.';
    renderMarket(items);
    renderInsights();
    document.querySelectorAll('.product-card').forEach(card=>{
      const edit=card.querySelector('[data-edit]');if(!edit)return;
      const p=state.products.find(p=>p.id===Number(edit.dataset.edit));if(!p||!p.package_size||card.querySelector('.package-hint'))return;
      const hint=document.createElement('p');hint.className='product-note package-hint';
      hint.textContent='Embalagem: '+qty(p.package_size)+' '+p.unit+(p.package_label?' · '+p.package_label:'');
      card.querySelector('.minimum')?.after(hint);
    });
  }
  function openList(id){
    const f=$('#shopping-list-form');f.reset();f.dataset.requestId=rid();f.elements.id.value=id||'';
    const row=getLists().find(l=>l.id===id);
    $('#shopping-list-title').textContent=row?'Renomear lista':'Nova lista';
    f.elements.name.value=row?.name||'';
    $('.form-error',f).textContent='';$('#shopping-list-dialog').showModal();
  }
  function openUnit(id){
    const p=state.products.find(p=>p.id===id);if(!p)return;
    const f=$('#unit-form');f.reset();f.dataset.requestId=rid();f.elements.product_id.value=id;
    f.dataset.unitFrom=p.unit;
    f.elements.unit.value=p.unit;
    $('#unit-current').textContent=p.name+': '+qty(p.quantity)+' '+p.unit+' em estoque. Se o número cadastrado já representa litros, você pode usar fator 1 para corrigir apenas o rótulo.';
    $('.form-error',f).textContent='';
    updateUnitPreview();$('#unit-dialog').showModal();
  }
  function updateUnitPreview(){
    const f=$('#unit-form'),p=state?.products.find(p=>p.id===Number(f.elements.product_id.value));if(!p)return;
    const dest=f.elements.unit.value,auto=automatic(p.unit,dest),same=p.unit===dest;
    $('#unit-factor-label').hidden=!!auto||same;
    const factor=auto||Number(String(f.elements.conversion_factor.value).replace(',','.'));
    if(same){$('#unit-preview').textContent='Selecione uma unidade diferente.';return;}
    if(!factor||factor<=0){$('#unit-preview').textContent='Informe o fator para converter '+p.unit+' em '+dest+'.';return;}
    const newQ=p.quantity/1000*factor;
    $('#unit-preview').textContent='Novo saldo aproximado: '+new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(newQ)+' '+dest+'. Confira mínimo, preço e embalagens após salvar.';
    if(p.estimated_price>=0&&!f.dataset.priceEdited){
      const newPrice=Math.round(p.estimated_price/factor)/100;
      f.elements.estimated_price.value=newPrice;
    }
  }
  function openCount(id){
    const p=state.products.find(p=>p.id===id);if(!p)return;
    const f=$('#count-form');f.reset();f.dataset.requestId=rid();f.elements.product_id.value=id;
    f.elements.quantity.value=p.quantity/1000;
    $('#count-current').textContent=p.name+': saldo registrado '+qty(p.quantity)+' '+p.unit+'.';
    $('.form-error',f).textContent='';updateCountPreview();$('#count-dialog').showModal();
  }
  function updateCountPreview(){
    const f=$('#count-form'),p=state?.products.find(p=>p.id===Number(f.elements.product_id.value));
    if(!p)return;
    const diff=Number(f.elements.quantity.value)-p.quantity/1000;
    $('#count-preview').textContent=Number.isFinite(diff)?(diff>0?'Entrada de ':diff<0?'Saída de ':'Nenhum ajuste: ')+new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(Math.abs(diff))+' '+p.unit:'Informe o saldo contado.';
  }
  async function send(path,data,form,success){
    const button=form?.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{
      await actions.api(path,{...data,request_id:form?.dataset.requestId||rid()});
      if(form?.closest('dialog'))form.closest('dialog').close();
      await actions.refresh();actions.notify(success);
    }catch(e){if(form){$('.form-error',form).textContent=e.message;}else actions.notify(e.message,true);}
    finally{if(button)button.disabled=false;}
  }
  async function track(id,changes){if(!state)return;await send('/api/shopping_track',{...(id.startsWith('manual:')?{id}:{product_id:Number(id)}),...changes},null,'Lista atualizada.');}
  document.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button||!state)return;
    if(button.id==='shopping-list-create')openList();
    if(button.id==='shopping-list-rename')openList(selected);
    if(button.id==='shopping-list-delete'){
      if(selected==='default')return;
      if(!confirm('Excluir "'+listName(selected)+'"? A lista precisa estar vazia.'))return;
      const id=selected;
      send('/api/shopping_lists',{id,remove:true},null,'Lista excluída.').then(()=>{selected='default';render(state,actions);});
    }
    if(button.id==='market-toggle'||button.id==='market-close'){market=!market;render(state,actions);}
    if(button.dataset.unitChange)openUnit(Number(button.dataset.unitChange));
    if(button.dataset.stockCount)openCount(Number(button.dataset.stockCount));
    if(button.dataset.manualTransfer){
      const item=(state.completedShopping||[]).find(i=>i.id===button.dataset.manualTransfer);
      if(!item)return;
      const existing=state.products.find(p=>p.name.toLocaleLowerCase('pt-BR')===item.name.toLocaleLowerCase('pt-BR'));
      if(existing&&existing.unit!==item.unit){actions.notify('Produto existente com outra unidade. Corrija a unidade antes de transferir.',true);return;}
      const text='Adicionar '+qty(item.quantity)+' '+item.unit+' de '+item.name+' ao estoque? '+(existing?'A quantidade será somada ao produto existente.':'O produto será cadastrado automaticamente em Outros.')+' Esta operação não poderá ser repetida.';
      if(confirm(text))send('/api/manual_to_stock',{id:item.id},null,'Compra transferida para o estoque.');
    }
    if(button.dataset.marketEdit){
      const item=getItem(button.dataset.marketEdit);
      if(item){const native=document.querySelector(item.manual?'[data-manual-edit="'+CSS.escape(item.id)+'"]':'[data-shopping="'+item.product_id+'"]');if(native)native.click();}
    }
  });
  document.addEventListener('change',e=>{
    const field=e.target;
    if(field.id==='shopping-active-list'){selected=field.value;render(state,actions);}
    if(field.dataset.marketCheck!==undefined)track(field.dataset.marketCheck,{collected:field.checked});
    if(field.dataset.marketPrice!==undefined)track(field.dataset.marketPrice,{actual_unit_price:field.value});
    if(field.closest('#unit-form')&&field.name==='unit')updateUnitPreview();
    if(field.name==='package_count'&&field.closest('#purchase-form')){
      const f=field.closest('form'),size=Number(f.dataset.packageSize);
      if(size>0&&field.value!==''){
        const q=Number(field.value)*size/1000;
        f.elements.quantity.value=Number(q.toFixed(3));
        f.elements.quantity.dispatchEvent(new Event('input',{bubbles:true}));
      }
    }
  });
  $('#unit-form').addEventListener('input',e=>{if(e.target.name==='estimated_price')e.currentTarget.dataset.priceEdited='yes';updateUnitPreview();});
  $('#count-form').addEventListener('input',updateCountPreview);
  $('#shopping-list-form').addEventListener('submit',e=>{
    e.preventDefault();const f=e.currentTarget;
    send('/api/shopping_lists',{...(f.elements.id.value?{id:f.elements.id.value}:{}),name:f.elements.name.value},f,'Lista salva.');
  });
  $('#unit-form').addEventListener('submit',e=>{
    e.preventDefault();const f=e.currentTarget;
    send('/api/change_unit',{product_id:Number(f.elements.product_id.value),unit:f.elements.unit.value,conversion_factor:f.elements.conversion_factor.value,estimated_price:f.elements.estimated_price.value},f,'Unidade convertida. Confira os valores do produto.');
  });
  $('#count-form').addEventListener('submit',e=>{
    e.preventDefault();const f=e.currentTarget;
    send('/api/stock_count',{product_id:Number(f.elements.product_id.value),quantity:f.elements.quantity.value,note:f.elements.note.value},f,'Conferência de estoque registrada.');
  });
  return {render,filteredItems,fillListFields,preparePackages};
})();