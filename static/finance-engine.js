'use strict';
/* Lógica de contas a pagar: sem acesso à rede ou ao DOM, também testável no Node. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.FinanceEngine=api;
})(typeof window!=='undefined'?window:undefined,function(){
  const blank=()=>({bills:{},templates:{},payments:{}});
  const clean=data=>({bills:data?.bills||{},templates:data?.templates||{},payments:data?.payments||{}});
  const iso=d=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  function dateObject(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw new Error('Confira a data de vencimento.');
    const d=new Date(value+'T12:00:00Z');
    if(!Number.isFinite(d.getTime())||iso(d)!==value)throw new Error('Data inválida.');
    return d;
  }
  const shiftDays=(value,days)=>{const d=dateObject(value);d.setUTCDate(d.getUTCDate()+days);return iso(d);};
  function shiftMonths(value,months){
    const original=dateObject(value),day=original.getUTCDate();
    const first=new Date(Date.UTC(original.getUTCFullYear(),original.getUTCMonth()+months,1,12));
    const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
    first.setUTCDate(Math.min(day,last));return iso(first);
  }
  function nextDue(t,index){
    if(t.frequency==='weekly')return shiftDays(t.firstDue,index*7);
    if(t.frequency==='biweekly')return shiftDays(t.firstDue,index*14);
    if(t.frequency==='yearly')return shiftMonths(t.firstDue,index*12);
    return shiftMonths(t.firstDue,index);
  }
  function occurrences(data,from,to){
    dateObject(from);dateObject(to);if(from>to)throw new Error('Período inválido.');
    const s=clean(data),result=[];
    Object.values(s.templates).forEach(t=>{
      if(!t||t.archived||!t.firstDue)return;
      const max=Math.min(900,Number(t.count)>0?Number(t.count):900);
      for(let i=0;i<max;i++){
        const due=nextDue(t,i);if(due>to)break;
        if(t.endsAt&&due>t.endsAt)break;
        if(due<from)continue;
        const id='rec_'+t.id+'_'+due;
        if(Object.prototype.hasOwnProperty.call(s.bills,id))continue;
        result.push({id,title:t.title+(t.kind==='installments'?' ('+(i+1)+'/'+t.count+')':''),amountCents:t.amountCents,due,category:t.category||'Outros',payee:t.payee||'',method:t.method||'',notes:t.notes||'',templateId:t.id,originalDue:due,virtual:true});
      }
    });
    Object.values(s.bills).forEach(b=>{if(b&&!b.archived&&b.due>=from&&b.due<=to)result.push({...b,virtual:false});});
    return result.sort((a,b)=>a.due.localeCompare(b.due)||a.title.localeCompare(b.title,'pt-BR'));
  }
  function paymentsFor(data,billId){return Object.values(clean(data).payments).filter(p=>p&&p.billId===billId&&!p.reversed).sort((a,b)=>a.paidAt.localeCompare(b.paidAt));}
  function paidCents(data,billId){return paymentsFor(data,billId).reduce((sum,p)=>sum+p.amountCents,0);}
  function situation(data,bill,today){
    const paid=paidCents(data,bill.id),amount=bill.amountCents;
    if(amount!==null&&amount!==undefined&&paid>=amount&&amount>0)return {key:'paid',label:'Paga',paid,remaining:0};
    const remaining=amount==null?null:Math.max(0,amount-paid);
    if(bill.due<today)return {key:'overdue',label:'Atrasada',paid,remaining};
    if(bill.due===today)return {key:'today',label:'Vence hoje',paid,remaining};
    return {key:'pending',label:'Pendente',paid,remaining};
  }
  function summary(data,items,today){
    let total=0,paid=0,remaining=0,overdue=0,unknown=0,open=0;
    for(const b of items){
      const s=situation(data,b,today);
      if(b.amountCents==null){unknown++;open++;continue;}
      total+=b.amountCents;paid+=Math.min(s.paid,b.amountCents);remaining+=s.remaining;
      if(s.key==='overdue')overdue+=s.remaining;
      if(s.key!=='paid')open++;
    }
    return {total,paid,remaining,overdue,unknown,open};
  }
  function moneyToCents(value,optional=false){
    const str=String(value??'').trim().replace(/\s/g,'').replace(/^R\$/i,'');
    if(!str){if(optional)return null;throw new Error('Informe o valor.');}
    let cleaned=str;
    if(str.includes(',')&&str.includes('.'))cleaned=str.replace(/\./g,'').replace(',','.');
    else if(str.includes(','))cleaned=str.replace(',','.');
    if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(cleaned))throw new Error('Digite um valor válido, por exemplo 150,50.');
    const [reais,centavos='']=cleaned.split('.');
    const cents=Number(reais)*100+Number((centavos+'00').slice(0,2));
    if(!Number.isSafeInteger(cents)||cents>10000000000)throw new Error('Valor muito alto.');
    return cents;
  }
  const asBRL=cents=>cents===null||cents===undefined?'Valor a informar':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
  function validateBill(b){
    if(!b.id||!/^[\w-]{1,100}$/.test(b.id))throw new Error('Identificação inválida.');
    if(!b.title?.trim()||b.title.length>100)throw new Error('Informe o nome da conta (até 100 caracteres).');
    dateObject(b.due);
    if(b.amountCents!==null&&(!Number.isSafeInteger(b.amountCents)||b.amountCents<=0||b.amountCents>10000000000))throw new Error('Informe um valor maior que zero ou deixe em branco.');
    if(b.category?.length>60||b.payee?.length>100||b.notes?.length>500)throw new Error('Texto muito longo.');
  }
  function validateTemplate(t){
    validateBill({...t,id:t.id,due:t.firstDue});
    if(!['monthly','weekly','biweekly','yearly'].includes(t.frequency))throw new Error('Repetição inválida.');
    if(t.kind==='installments'&&(!Number.isInteger(t.count)||t.count<2||t.count>120))throw new Error('Número de parcelas inválido.');
    if(t.endsAt)dateObject(t.endsAt);
  }
  function apply(old,action){
    const state=structuredClone(clean(old));
    const b=action.bill,t=action.template,p=action.payment;
    switch(action.type){
      case 'save-bill':
        validateBill(b);
        if(b.amountCents!==null&&paidCents(state,b.id)>b.amountCents)throw new Error('O valor não pode ser menor que o total já pago. Desfaça o pagamento incorreto primeiro.');
        if(state.bills[b.id]?.archived)throw new Error('Esta conta foi cancelada.');
        state.bills[b.id]=b;break;
      case 'save-template':
        validateTemplate(t);
        if(state.templates[t.id]?.archived)throw new Error('Esta repetição foi encerrada.');
        state.templates[t.id]=t;break;
      case 'archive-bill':{
        const oldBill=state.bills[action.id]||action.materialize;
        if(!oldBill)throw new Error('Conta não encontrada.');
        if(paymentsFor(state,action.id).length)throw new Error('Estorne os pagamentos antes de cancelar esta conta.');
        state.bills[action.id]={...oldBill,virtual:false,archived:true};break;
      }
      case 'archive-template':
        if(!state.templates[action.id])throw new Error('Repetição não encontrada.');
        state.templates[action.id].archived=true;break;
      case 'add-payment':{
        if(state.payments[p.id])break; // reenvio após falha de rede
        const bill=state.bills[p.billId]||action.materialize;
        if(!bill||bill.archived)throw new Error('Conta não encontrada.');
        validateBill(bill);
        dateObject(p.paidAt);
        const outstanding=bill.amountCents==null?null:bill.amountCents-paidCents(state,p.billId);
        if(!Number.isSafeInteger(p.amountCents)||p.amountCents<=0)throw new Error('Valor pago inválido.');
        if(outstanding!==null&&p.amountCents>outstanding)throw new Error('Valor maior que o restante da conta.');
        if(p.method?.length>50||p.notes?.length>500)throw new Error('Detalhes do pagamento muito longos.');
        if(!state.bills[p.billId])state.bills[p.billId]={...bill,virtual:false};
        state.payments[p.id]=p;break;
      }
      case 'reverse-payment':
        if(!state.payments[action.id])throw new Error('Pagamento não encontrado.');
        state.payments[action.id].reversed=true;break;
      default:throw new Error('Operação financeira não reconhecida.');
    }
    return state;
  }
  return {blank,clean,dateObject,shiftDays,shiftMonths,nextDue,occurrences,paymentsFor,paidCents,situation,summary,moneyToCents,asBRL,validateBill,apply};
});
