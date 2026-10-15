'use strict';
(function(root){
  const CATEGORIES=['Ingredientes','Embalagens','Quentinhas prontas','Outros'], UNITS=['kg','g','L','mL','un','pacote'];
  const fail=message=>{throw new Error(message);};
  const copy=v=>JSON.parse(JSON.stringify(v));
  const stable=v=>JSON.stringify(v,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
  const same=(a,b)=>stable(a)===stable(b);
  const prefDefaults={ideal:0,brand:'',alternative:'',supplier:'',estimated_price:-1,expiry_date:'',custom_category_id:''};
  function decimal(value,places,label){const raw=String(value);if(!new RegExp('^\\d+(?:[.,]\\d{1,'+places+'})?$').test(raw))fail(label+' inválido.');const parts=raw.replace(',','.').split('.');const n=Number(parts[0])*10**places+Number((parts[1]||'').padEnd(places,'0'));if(!Number.isSafeInteger(n)||n>1000000*10**places)fail(label+' acima do limite.');return n;}
  const amount=v=>decimal(v,3,'Quantidade');
  const money=v=>v===''||v===null||v===undefined?-1:decimal(v,2,'Preço');
  const lineCost=(q,price)=>price<0?-1:Number((BigInt(q)*BigInt(price)+500n)/1000n);
  function txt(v,max=100){if(v===undefined||v===null)return '';if(typeof v!=='string'||v.trim().length>max)fail('Texto inválido ou muito longo.');return v.trim();}
  function expiry(v){v=txt(v,10);if(!v)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Data de validade inválida.');return v;}
  function whole(v,label='Quantidade de quentinhas'){const n=Number(v);if(!Number.isInteger(n)||n<=0||n>1000000)fail(label+' deve ser um número inteiro maior que zero.');return n;}
  function empty(){return {products:{},movements:{},nextProductId:1,nextMovementId:1};}
  function projected(stock){const out={prefs:{},shopping:{},categories:{},recipes:{},edits:{}};
    function set(entity,id,value){if(entity==='products'){out.prefs[id]=value?{...prefDefaults,...value.prefs}:{...prefDefaults};}else if(value===null)delete out[entity][id];else out[entity][id]=copy(value);}
    for(const m of Object.values(stock.movements||{}).sort((a,b)=>a.id-b.id)){
      const ev=m.meta;if(!ev)continue;
      if(ev.type==='edit'){
        for(const e of Object.values(out.edits))if(e.status==='undone')e.abandoned=true;
        const edit={...copy(ev),status:'active',last_at:m.id};out.edits[ev.id]=edit;set(ev.entity,ev.entity_id,ev.after??null);
      }else if(ev.type==='edit_state'){
        const e=out.edits[ev.edit_id];if(e){e.status=ev.status;e.last_at=m.id;set(e.entity,e.entity_id,ev.status==='undone'?(e.before??null):(e.after??null));}
      }else if(ev.type==='set'){set(ev.entity,ev.entity_id,ev.value??null);}
    }
    return out;
  }
  function normalizeProduct(p,meta){const prefs={...prefDefaults,...meta.prefs[p.id]};const cat=meta.categories[prefs.custom_category_id];return {...p,...prefs,category:cat?.name||p.category};}
  // Manual shopping entries live in the existing event log, not in the product inventory.
  function manualShopping(meta,status){
    return Object.values(meta.shopping).filter(row=>row?.manual===true&&row.status===status)
      .map(row=>({...row,available:0,minimum:0,ideal:0,estimate:lineCost(row.quantity,row.unit_price)}))
      .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  }
  function shopping(stock,meta,products){const list=[];
    for(const p of products){const saved=meta.shopping[p.id];const need=p.quantity<=p.minimum;
      if(!need&&(!saved||saved.status!=='pending'))continue;
      if(saved?.status==='dismissed')continue;
      const target=p.ideal||p.minimum*2;
      const suggested=Math.max(0,target-p.quantity);
      const current=saved?.status==='pending'?saved:null;
      list.push({product_id:p.id,name:p.name,unit:p.unit,available:p.quantity,minimum:p.minimum,ideal:target,
        quantity:current?.quantity??suggested,brand:current?.brand??p.brand,alternative:current?.alternative??p.alternative,
        supplier:current?.supplier??p.supplier,unit_price:current?.unit_price??p.estimated_price,manual:!!current,
        estimate:lineCost(current?.quantity??suggested,current?.unit_price??p.estimated_price)});
    }
    return [...manualShopping(meta,'pending'),...list];
  }
  function recipePlan(recipe,products,portions){portions=whole(portions);const needs=recipe.ingredients.map(i=>{const p=products.find(p=>p.id===i.product_id);if(!p)fail('Um ingrediente da receita foi arquivado. Edite a receita.');const quantity=Math.ceil(i.quantity*portions/recipe.yield);return {product_id:p.id,name:p.name,unit:p.unit,quantity,available:p.quantity,cost:lineCost(quantity,p.estimated_price),enough:p.quantity>=quantity};});const unknown=needs.filter(i=>i.cost<0).length;return {needs,portions,total:needs.filter(i=>i.cost>=0).reduce((sum,i)=>sum+i.cost,0),unknown,enough:needs.every(i=>i.enough)};}
  function snapshot(stock,full=false){stock=stock||empty();const meta=projected(stock),all=Object.values(stock.movements||{}),reversed=new Set(all.filter(m=>m.reversal_of).map(m=>m.reversal_of));
    const products=Object.values(stock.products||{}).filter(p=>!p.archived).map(p=>normalizeProduct(p,meta)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    const purchases=all.filter(m=>m.purchase).map(m=>({...m.purchase,id:m.id,name:m.name,unit:m.unit,product_id:m.product_id,created_at:m.created_at,reversed:reversed.has(m.id)})).sort((a,b)=>b.id-a.id);
    const recipes=Object.values(meta.recipes).map(r=>{try{const plan=recipePlan(r,products,r.yield);return {...r,cost:plan.total,unknown:plan.unknown};}catch{return {...r,cost:0,unknown:1,unavailable:true};}}).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    return {products,movements:all.filter(m=>!m.meta).sort((a,b)=>b.id-a.id).map(m=>({...m,reversed:reversed.has(m.id)})).slice(0,full?undefined:200),
      purchases,losses:all.filter(m=>m.reason?.startsWith('waste')).map(m=>({...m,reversed:reversed.has(m.id)})),shopping:shopping(stock,meta,products),completedShopping:manualShopping(meta,'bought'),categories:Object.values(meta.categories),recipes,
      edits:Object.values(meta.edits).sort((a,b)=>b.last_at-a.last_at),server_time:Math.floor(Date.now()/1000)};
  }
  function apply(source,action,data,now=Math.floor(Date.now()/1000)){
    const stock=copy(source||empty());stock.products ||= {};stock.movements ||= {};stock.nextProductId ||= 1;stock.nextMovementId ||= 1;
    const meta=projected(stock),key=txt(data.request_id,100),existing=key&&Object.values(stock.movements).find(m=>m.request_id===key);
    if(existing)return {stock:source,result:{ok:true,id:existing.id,duplicate:true}};
    const product=id=>{const p=stock.products['p'+id];if(!p||p.archived)fail('Produto não encontrado.');return p;};
    const getPrefs=id=>({...prefDefaults,...meta.prefs[id]});
    function log(p,delta,note,request_id,extra={}){const id=stock.nextMovementId++;stock.movements['m'+id]={id,product_id:p?.id||0,name:p?.name||'Edição do painel',unit:p?.unit||'un',delta,balance:p?.quantity||0,note,created_at:now,request_id,reversal_of:0,...extra};return id;}
    const event=(ev,suffix='')=>log(null,0,'Configuração do painel',key?(key+suffix):('edit-'+stock.nextMovementId),{meta:ev});
    function edit(entity,id,before,after,label){event({type:'edit',id:key||('edit-'+stock.nextMovementId),entity,entity_id:id,before,after,label});}
    function set(entity,id,value,suffix=''){event({type:'set',entity,entity_id:id,value},suffix);}
    function change(p,delta,note,request_id,extra={}){if(p.quantity+delta<0)fail('Não há estoque suficiente para essa saída. Confira a quantidade.');if(p.quantity+delta>1000000000)fail('O saldo ultrapassa o limite permitido.');p.quantity+=delta;return log(p,delta,note,request_id,extra);}
    function productEditState(p){return {core:{name:p.name,category:p.category,unit:p.unit,minimum:p.minimum},prefs:getPrefs(p.id)};}
    let result={ok:true};
    if(action==='products'){
      const name=txt(data.name,80);if(!name)fail('Preencha o nome do produto.');
      const custom=Object.values(meta.categories).find(c=>c.name===data.category);
      if((!CATEGORIES.includes(data.category)&&!custom)||!UNITS.includes(data.unit))fail('Categoria ou unidade inválida.');
      if(Object.values(stock.products).some(p=>!p.archived&&p.id!==data.id&&p.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))fail('Já existe um produto com esse nome.');
      const minimum=amount(data.minimum??0);let p,before;
      if(data.id){p=product(data.id);before=productEditState(p);if(p.unit!==data.unit)fail('Para preservar o histórico, a unidade não pode ser alterada.');}
      else{p={id:stock.nextProductId++,name,category:custom?'Outros':data.category,unit:data.unit,quantity:amount(data.quantity??0),minimum,archived:0,created_at:now};stock.products['p'+p.id]=p;if(p.quantity)log(p,p.quantity,'Estoque inicial',(key||'initial-'+p.id)+':stock');}
      const prefs={...getPrefs(p.id)};
      if(data.ideal!==undefined){prefs.ideal=amount(data.ideal);if(prefs.ideal&&prefs.ideal<minimum)fail('O estoque ideal deve ser igual ou maior que o mínimo.');}
      for(const k of ['brand','alternative','supplier'])if(data[k]!==undefined)prefs[k]=txt(data[k]);
      if(data.estimated_price!==undefined)prefs.estimated_price=money(data.estimated_price);
      if(data.expiry_date!==undefined)prefs.expiry_date=expiry(data.expiry_date);
      prefs.custom_category_id=custom?.id||'';
      Object.assign(p,{name,category:custom?'Outros':data.category,minimum});
      const after={core:{name:p.name,category:p.category,unit:p.unit,minimum:p.minimum},prefs};
      if(before)edit('products',p.id,before,after,'Editar '+p.name);else set('products',p.id,after);
      result.id=p.id;
    }else if(action==='categories'){
      if(!key)fail('Código da edição inválido.');const name=txt(data.name,40);if(!name)fail('Informe o nome da categoria.');const id=data.id||key;
      if(CATEGORIES.some(c=>c.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'))||Object.values(meta.categories).some(c=>c.id!==id&&c.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))fail('Já existe uma categoria com esse nome.');
      edit('categories',id,meta.categories[id]||null,{id,name},'Categoria '+name);result.id=id;
    }else if(action==='shopping'){
      if(!key)fail('Código da edição inválido.');const p=product(data.product_id),q=amount(data.quantity);if(q===0&&data.status!=='dismissed')fail('Informe uma quantidade maior que zero.');
      const value={product_id:p.id,quantity:q,unit_price:money(data.unit_price),brand:txt(data.brand),alternative:txt(data.alternative),supplier:txt(data.supplier),status:data.status==='dismissed'?'dismissed':'pending'};
      edit('shopping',p.id,meta.shopping[p.id]||null,value,'Lista de compras: '+p.name);
    }else if(action==='manual_shopping'){
      if(!key)fail('Código da edição inválido.');
      const id=data.id?txt(data.id,100):'manual:'+key;
      if(!/^manual:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))fail('Identificador da lista inválido.');
      const before=meta.shopping[id]||null;
      if(data.remove||data.status==='bought'||data.status==='pending'&&data.id&&data.name===undefined){
        if(!before?.manual)fail('Item da lista não encontrado.');
        if(data.remove)edit('shopping',id,before,null,'Retirar '+before.name+' da lista');
        else {
          const status=data.status;
          if(status===before.status)fail('O item já está nessa situação.');
          edit('shopping',id,before,{...before,status,bought_at:status==='bought'?now:0},(status==='bought'?'Marcar comprado: ':'Reabrir na lista: ')+before.name);
        }
        result.id=id;
      }else{
        const name=txt(data.name,80);
        if(!name)fail('Informe o nome do item.');
        if(before&&!before.manual)fail('Item inválido.');
        if(before?.status==='bought')fail('Reabra o item comprado antes de editá-lo.');
        if(Object.values(meta.shopping).some(row=>row?.manual&&row.status==='pending'&&row.id!==id&&row.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))fail('Esse item já está na lista. Edite o existente.');
        if(!UNITS.includes(data.unit))fail('Selecione uma unidade válida.');
        const quantity=amount(data.quantity);
        if(!quantity)fail('Informe uma quantidade maior que zero.');
        const after={id,manual:true,product_id:0,name,unit:data.unit,quantity,unit_price:money(data.unit_price),
          brand:txt(data.brand),alternative:txt(data.alternative),supplier:txt(data.supplier),note:txt(data.note,200),status:'pending',bought_at:0};
        edit('shopping',id,before,after,(before?'Editar ':'Adicionar ')+name+' na lista');result.id=id;
      }
    }else if(action==='archive'){
      const p=product(data.id);if(p.quantity)fail('Registre a saída do saldo antes de arquivar este produto.');
      if(Object.values(meta.recipes).some(r=>r.output_id===p.id||r.ingredients.some(i=>i.product_id===p.id)))fail('Este produto está em uma receita. Edite a receita antes de arquivar.');p.archived=1;if(key)event({type:'archive',product_id:p.id});
    }else if(action==='recipes'){
      if(!key)fail('Código da edição inválido.');const name=txt(data.name,80);if(!name)fail('Informe o nome da receita.');const id=data.id||key;
      if(Object.values(meta.recipes).some(r=>r.id!==id&&r.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))fail('Já existe uma receita com esse nome.');
      const output=product(Number(data.output_id));if(output.unit!=='un')fail('O produto final precisa usar unidades (un).');
      if(!Array.isArray(data.ingredients)||!data.ingredients.length||data.ingredients.length>40)fail('Inclua de 1 a 40 ingredientes ou embalagens.');
      const ingredients=data.ingredients.map(i=>{const p=product(Number(i.product_id)),q=amount(i.quantity);if(!q)fail('Informe a quantidade de cada ingrediente.');if(p.id===output.id)fail('O produto final não pode ser ingrediente de si mesmo.');return {product_id:p.id,quantity:q};});
      if(new Set(ingredients.map(i=>i.product_id)).size!==ingredients.length)fail('Use uma única linha para cada ingrediente.');
      const value={id,name,revision:key,output_id:output.id,yield:whole(data.yield,'Rendimento'),ingredients,notes:txt(data.notes,200)};
      edit('recipes',id,meta.recipes[id]||null,value,'Receita '+name);result.id=id;
    }else if(action==='production'){
      if(!key)fail('Código da produção inválido.');const r=meta.recipes[data.recipe_id];if(!r)fail('Receita não encontrada.');if(data.recipe_revision!==undefined&&data.recipe_revision!==r.revision)fail('A receita foi alterada em outro aparelho. Feche e confira a produção novamente.');
      const normalized=Object.values(stock.products).filter(p=>!p.archived).map(p=>normalizeProduct(p,meta));const plan=recipePlan(r,normalized,data.portions);if(!plan.enough)fail('Faltam ingredientes. Confira as quantidades antes de produzir.');
      const output=product(r.output_id);if(output.quantity+plan.portions*1000>1000000000)fail('Produção acima do limite de estoque.');
      const group=key;
      for(const [index,i] of plan.needs.entries())change(product(i.product_id),-i.quantity,'Produção: '+r.name+' ('+plan.portions+' un)',key+':ingredient:'+index,{reason:'production',production_id:group});
      result.id=change(output,plan.portions*1000,'Produção: '+r.name,key,{reason:'production',production_id:group,production:{recipe_id:r.id,recipe_name:r.name,portions:plan.portions,cost:plan.total,unknown:plan.unknown}});
    }else if(action==='undo_edit'||action==='redo_edit'){
      if(!key)fail('Código da edição inválido.');const e=meta.edits[data.id],undo=action==='undo_edit';
      if(!e||e.abandoned||e.status!==(undo?'active':'undone'))fail('Esta edição já mudou. Atualize a página.');
      const expected=undo?e.after:e.before,target=undo?e.before:e.after;
      const current=e.entity==='products'?productEditState(product(e.entity_id)):(meta[e.entity][e.entity_id]||null);
      if(!same(current,expected??null))fail('Esse item recebeu outra alteração. Não é seguro desfazer esta edição.');
      if(e.entity==='categories'&&!target&&Object.values(meta.prefs).some(p=>p.custom_category_id===e.entity_id))fail('A categoria está em uso. Troque a categoria dos produtos antes de desfazer.');
      if(e.entity==='products'){const p=product(e.entity_id);if(target.prefs.ideal&&target.prefs.ideal<target.core.minimum)fail('Estoque ideal inválido.');Object.assign(p,target.core);}
      event({type:'edit_state',edit_id:e.id,status:undo?'undone':'active'});result.id=e.id;
    }else if(action==='movements'||action==='purchase'||action==='undo'||action==='undo_production'){
      if(!key)fail('Código da operação inválido.');
      if(action==='undo_production'){
        const group=Object.values(stock.movements).filter(m=>m.production_id===data.production_id&&!m.reversal_of);
        if(!group.length)fail('Produção não encontrada.');if(group.some(m=>Object.values(stock.movements).some(r=>r.reversal_of===m.id)))fail('Essa produção já foi desfeita.');
        for(const m of group){const p=product(m.product_id);if(p.quantity-m.delta<0)fail('As quentinhas dessa produção já saíram do estoque. Não é possível desfazer.');}
        for(const [index,m] of group.entries())change(product(m.product_id),-m.delta,'Estorno da produção',index?key+':'+index:key,{reversal_of:m.id,production_id:data.production_id,reason:'reversal'});
      }else{
        let p,delta,note,extra={};
        if(action==='undo'){
          const m=stock.movements['m'+data.id];if(!m||m.meta)fail('Movimentação não encontrada.');if(m.production_id)fail('Desfaça a produção completa, não um ingrediente isolado.');if(m.reversal_of||Object.values(stock.movements).some(r=>r.reversal_of===m.id))fail('Essa movimentação já foi desfeita ou é um estorno.');
          p=product(m.product_id);delta=-m.delta;note='Estorno da movimentação #'+m.id;extra={reversal_of:m.id,reason:'reversal'};
          if(m.purchase){const previous=meta.shopping[p.id]||null;set('shopping',p.id,{...(previous||{}),product_id:p.id,quantity:m.purchase.quantity,brand:m.purchase.brand,alternative:'',supplier:m.purchase.supplier,unit_price:m.purchase.estimated_unit_price,status:'pending'},':reopen');}
        }else{
          p=product(Number(data.product_id));const n=amount(data.quantity);if(!n)fail('A quantidade deve ser maior que zero.');
          if(action==='purchase'){
            const paid=money(data.unit_price);if(paid<0)fail('Informe o preço pago por unidade de medida.');
            const estimated=money(data.estimated_unit_price),quantity=n;
            extra.purchase={quantity,unit_price:paid,total:lineCost(n,paid),estimated_unit_price:estimated,estimated_total:lineCost(n,estimated),brand:txt(data.brand),supplier:txt(data.supplier),date:expiry(data.purchase_date)||new Date(now*1000).toISOString().slice(0,10)};
            delta=n;note=txt(data.note,200)||'Compra recebida';extra.reason='purchase';
            const prefs=getPrefs(p.id);prefs.brand=extra.purchase.brand||prefs.brand;prefs.supplier=extra.purchase.supplier||prefs.supplier;prefs.estimated_price=paid;
            const incoming=expiry(data.expiry_date);if(incoming)prefs.expiry_date=p.quantity&&prefs.expiry_date?(incoming<prefs.expiry_date?incoming:prefs.expiry_date):incoming;
            set('products',p.id,{core:{name:p.name,category:p.category,unit:p.unit,minimum:p.minimum},prefs},':prefs');
            const target=meta.shopping[p.id]||{};const planned=data.planned_quantity!==undefined?amount(data.planned_quantity):(target.quantity||n);const received=Math.max(0,planned-n);
            set('shopping',p.id,{...target,product_id:p.id,quantity:received,status:received?'pending':'bought',brand:extra.purchase.brand,supplier:extra.purchase.supplier,unit_price:paid},':shopping');
          }else{
            if(!['in','out'].includes(data.type))fail('Selecione entrada ou saída.');delta=data.type==='out'?-n:n;note=txt(data.note,200);
            const reasons=['use','sale','waste_expired','waste_damage','waste_other'];extra.reason=data.type==='out'?(reasons.includes(data.reason)?data.reason:'use'):'entry';
            if(extra.reason.startsWith('waste'))extra.loss_cost=lineCost(n,getPrefs(p.id).estimated_price);
            const incoming=expiry(data.expiry_date);if(data.type==='in'&&incoming){const prefs=getPrefs(p.id);prefs.expiry_date=p.quantity&&prefs.expiry_date?(incoming<prefs.expiry_date?incoming:prefs.expiry_date):incoming;set('products',p.id,{core:{name:p.name,category:p.category,unit:p.unit,minimum:p.minimum},prefs},':expiry');}
          }
        }
        result.id=change(p,delta,note,key,extra);
      }
    }else fail('Operação não encontrada.');
    return {stock,result};
  }
  root.StockEngine={empty,snapshot,apply,amount,money,lineCost,recipePlan,categories:CATEGORIES};
  if(typeof module!=='undefined')module.exports=root.StockEngine;
})(typeof window!=='undefined'?window:globalThis);
