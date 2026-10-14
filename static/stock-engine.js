'use strict';
(function(root){
  const categories=['Ingredientes','Embalagens','Quentinhas prontas','Outros'], units=['kg','g','L','mL','un','pacote'];
  const fail=message=>{throw new Error(message);};
  function amount(value){const raw=String(value);if(!/^\d+(?:[.,]\d{1,3})?$/.test(raw))fail('Use uma quantidade a partir de zero, com até 3 casas decimais.');const parts=raw.replace(',','.').split('.');const n=Number(parts[0])*1000+Number((parts[1]||'').padEnd(3,'0'));if(n>1000000000)fail('Quantidade acima do limite permitido.');return n;}
  function empty(){return {products:{},movements:{},nextProductId:1,nextMovementId:1};}
  function snapshot(stock,full=false){stock=stock||empty();const movements=Object.values(stock.movements||{});const reversed=new Set(movements.filter(m=>m.reversal_of).map(m=>m.reversal_of));return {products:Object.values(stock.products||{}).filter(p=>!p.archived).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),movements:movements.sort((a,b)=>b.id-a.id).map(m=>({...m,reversed:reversed.has(m.id)})).slice(0,full?undefined:200),server_time:Math.floor(Date.now()/1000)};}
  function apply(source,action,data,now=Math.floor(Date.now()/1000)){
    const stock=JSON.parse(JSON.stringify(source||empty()));stock.products ||= {};stock.movements ||= {};stock.nextProductId ||= 1;stock.nextMovementId ||= 1;
    const product=id=>{const p=stock.products['p'+id];if(!p||p.archived)fail('Produto não encontrado.');return p;};
    const log=(p,delta,note,request_id,reversal_of=0)=>{const id=stock.nextMovementId++;stock.movements['m'+id]={id,product_id:p.id,name:p.name,unit:p.unit,delta,balance:p.quantity,note,created_at:now,request_id,reversal_of};return id;};
    let result={ok:true};
    if(action==='products'){
      const name=typeof data.name==='string'?data.name.trim():'';
      if(!name||name.length>80)fail('Preencha um nome com até 80 caracteres.');
      if(!categories.includes(data.category)||!units.includes(data.unit))fail('Categoria ou unidade inválida.');
      if(Object.values(stock.products).some(p=>!p.archived&&p.id!==data.id&&p.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))fail('Já existe um produto com esse nome.');
      const minimum=amount(data.minimum??0);
      if(data.id){const p=product(data.id);if(p.unit!==data.unit)fail('Para preservar o histórico, a unidade não pode ser alterada.');Object.assign(p,{name,category:data.category,minimum});result.id=p.id;}
      else {const p={id:stock.nextProductId++,name,category:data.category,unit:data.unit,quantity:amount(data.quantity??0),minimum,archived:0,created_at:now};stock.products['p'+p.id]=p;if(p.quantity)log(p,p.quantity,'Estoque inicial','initial-'+p.id);result.id=p.id;}
    }else if(action==='archive'){const p=product(data.id);if(p.quantity)fail('Registre a saída do saldo antes de arquivar este produto.');p.archived=1;}
    else if(action==='movements'||action==='undo'){
      if(typeof data.request_id!=='string'||!data.request_id||data.request_id.length>100)fail('Código da operação inválido.');
      const old=Object.values(stock.movements).find(m=>m.request_id===data.request_id);if(old)return {stock:source,result:{ok:true,id:old.id,duplicate:true}};
      let p,delta,note,reversal=0;
      if(action==='undo'){
        const m=stock.movements['m'+data.id];if(!m)fail('Movimentação não encontrada.');if(m.reversal_of||Object.values(stock.movements).some(r=>r.reversal_of===m.id))fail('Essa movimentação já foi desfeita ou é um estorno.');p=product(m.product_id);delta=-m.delta;note='Estorno da movimentação #'+m.id;reversal=m.id;
      }else {p=product(data.product_id);const n=amount(data.quantity);if(!n)fail('A quantidade deve ser maior que zero.');if(!['in','out'].includes(data.type))fail('Selecione entrada ou saída.');delta=data.type==='out'?-n:n;if(data.note!==undefined&&typeof data.note!=='string')fail('Observação inválida.');note=(data.note||'').trim();if(note.length>200)fail('A observação deve ter até 200 caracteres.');}
      if(p.quantity+delta<0)fail('Não há estoque suficiente para essa saída. Confira a quantidade.');if(p.quantity+delta>1000000000)fail('O saldo ultrapassa o limite permitido.');p.quantity+=delta;result.id=log(p,delta,note,data.request_id,reversal);
    }else fail('Operação não encontrada.');
    return {stock,result};
  }
  root.StockEngine={empty,snapshot,apply,amount};
  if(typeof module!=='undefined')module.exports=root.StockEngine;
})(typeof window!=='undefined'?window:globalThis);
