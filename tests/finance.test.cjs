'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../static/finance-engine.js');
const template={id:'fixa',title:'Luz',firstDue:'2026-01-31',frequency:'monthly',kind:'recurring',count:0,amountCents:15000,category:'Luz',payee:'',method:'',notes:''};
test('datas de contas mensais preservam o dia original e ajustam fevereiro',()=>{
  assert.equal(E.nextDue(template,1),'2026-02-28');
  assert.equal(E.nextDue(template,2),'2026-03-31');
  assert.equal(E.shiftMonths('2024-02-29',12),'2025-02-28');
  assert.equal(E.shiftDays('2026-12-31',1),'2027-01-01');
});
test('parcelamento termina no número de parcelas cadastrado',()=>{
  const data=E.apply(E.blank(),{type:'save-template',template:{...template,kind:'installments',count:3}});
  const bills=E.occurrences(data,'2026-01-01','2027-12-31');
  assert.deepEqual(bills.map(x=>x.due),['2026-01-31','2026-02-28','2026-03-31']);
  assert.match(bills[2].title,/3\/3/);
});
test('pagamentos parciais, totais e repetidos permanecem corretos',()=>{
  let data=E.apply(E.blank(),{type:'save-template',template});
  const bill=E.occurrences(data,'2026-02-01','2026-02-28')[0];
  const payment={id:'pg1',billId:bill.id,amountCents:5000,paidAt:'2026-02-10',method:'Pix',notes:''};
  data=E.apply(data,{type:'add-payment',payment,materialize:bill});
  data=E.apply(data,{type:'add-payment',payment,materialize:bill});
  assert.equal(E.paidCents(data,bill.id),5000);
  assert.equal(E.situation(data,bill,'2026-02-12').remaining,10000);
  assert.throws(()=>E.apply(data,{type:'add-payment',payment:{...payment,id:'pg2',amountCents:10001},materialize:bill}),/maior/);
  data=E.apply(data,{type:'add-payment',payment:{...payment,id:'pg2',amountCents:10000},materialize:bill});
  assert.equal(E.situation(data,bill,'2026-03-01').key,'paid');
  data=E.apply(data,{type:'reverse-payment',id:'pg2'});
  assert.equal(E.situation(data,bill,'2026-03-01').remaining,10000);
  assert.equal(E.summary(data,[bill],'2026-03-01').overdue,10000);
});
test('contas avulsas com valor desconhecido ficam pendentes sem inventar totais',()=>{
  let data=E.apply(E.blank(),{type:'save-bill',bill:{id:'uma',title:'Fornecedor',due:'2026-10-25',amountCents:null,category:'Fornecedores'}});
  let bill=E.occurrences(data,'2026-10-01','2026-10-31')[0];
  assert.equal(E.summary(data,[bill],'2026-10-21').unknown,1);
  assert.throws(()=>E.apply(data,{type:'add-payment',payment:{id:'p',billId:'uma',amountCents:-100,paidAt:'2026-10-21'},materialize:bill}),/inválido/);
  data=E.apply(data,{type:'save-bill',bill:{...bill,amountCents:12000}});
  bill=E.occurrences(data,'2026-10-01','2026-10-31')[0];
  assert.equal(E.summary(data,[bill],'2026-10-21').remaining,12000);
});
test('alterar vencimento de um mês recorrente não duplica conta',()=>{
  let data=E.apply(E.blank(),{type:'save-template',template});
  const feb=E.occurrences(data,'2026-02-01','2026-02-28')[0];
  data=E.apply(data,{type:'save-bill',bill:{...feb,due:'2026-03-02',virtual:false}});
  assert.equal(E.occurrences(data,'2026-02-01','2026-02-28').length,0);
  const march=E.occurrences(data,'2026-03-01','2026-03-31');
  assert.equal(march.length,2);
  assert(march.some(b=>b.id===feb.id));
});
test('cancelar repetição não apaga contas com histórico pago',()=>{
  let data=E.apply(E.blank(),{type:'save-template',template});
  const bill=E.occurrences(data,'2026-02-01','2026-02-28')[0];
  data=E.apply(data,{type:'add-payment',payment:{id:'p1',billId:bill.id,amountCents:15000,paidAt:'2026-02-10'},materialize:bill});
  assert.throws(()=>E.apply(data,{type:'archive-bill',id:bill.id}),/Estorne/);
  data=E.apply(data,{type:'archive-template',id:template.id});
  assert.deepEqual(E.occurrences(data,'2026-02-01','2026-03-31').map(b=>b.due),['2026-02-28']);
});
test('valores monetários usam centavos exatos',()=>{
  assert.equal(E.moneyToCents('1.234,56'),123456);
  assert.equal(E.moneyToCents('150,50'),15050);
  assert.equal(E.moneyToCents('',true),null);
  assert.throws(()=>E.moneyToCents('120,999'),/valor válido/);
});
