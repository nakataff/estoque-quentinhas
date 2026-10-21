'use strict';
(() => {
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const E=window.FinanceEngine,C=window.CloudStock;
  let data=E.blank(),month=new Date(),activeView='bills',filter='all',selectedDay=null;
  let selectedBill=null,selectedTemplate=null,payingBill=null,poll=null,busy=false,started=false;
  const categories=['Luz','Água','Gás','Internet','Mercadorias','Embalagens','Fornecedores','Funcionários','Aluguel','Impostos / MEI','Cartão de crédito','Manutenção','Entregas','Outras despesas'];
  const z=n=>String(n).padStart(2,'0');
  const today=()=>{const d=new Date();return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());};
  const fullDate=v=>v?v.slice(8,10)+'/'+v.slice(5,7)+'/'+v.slice(0,4):'—';
  const centsInput=c=>c===null||c===undefined?'':(c/100).toFixed(2).replace('.',',');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uuid=()=>crypto.randomUUID();
  const errorText=e=>e?.message||'Não foi possível concluir. Tente novamente.';
  function notice(text,isError=false){
    const el=$('#finance-toast');el.textContent=text;el.classList.toggle('error-toast',isError);el.hidden=false;
    clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.hidden=true,5200);
  }
  function range(offset=0){
    const y=month.getFullYear(),m=month.getMonth();
    const first=new Date(y,m+offset,1),last=new Date(y,m+offset+1,0);
    return {from:first.getFullYear()+'-'+z(first.getMonth()+1)+'-01',to:last.getFullYear()+'-'+z(last.getMonth()+1)+'-'+z(last.getDate()),year:first.getFullYear(),month:first.getMonth()};
  }
  const items=(offset=0)=>{const r=range(offset);return E.occurrences(data,r.from,r.to);};
  const status=b=>E.situation(data,b,today());
  function historicalOverdue(){
    const start=(new Date().getFullYear()-5)+'-01-01';
    const yesterday=E.shiftDays(today(),-1);
    return E.occurrences(data,start,yesterday).filter(b=>status(b).key==='overdue');
  }
  const lookup=id=>items().find(b=>b.id===id)||data.bills[id]||null;
  function setSync(ok){
    const el=$('#finance-sync');el.textContent=ok?'Contas atualizadas':'Sem conexão';el.classList.toggle('offline',!ok);
  }
  async function refresh(report=false){
    if(busy)return;
    try{
      const received=await C.financeRead();
      data=received;setSync(true);render();
    }catch(e){
      setSync(false);
      if(report)notice(errorText(e),true);
      if(e.status===401)showLogin();
    }
  }
  function showLogin(){
    started=false;clearInterval(poll);
    $('#finance-dashboard').hidden=true;$('#finance-login').hidden=false;
  }
  async function start(){
    $('#finance-login').hidden=true;$('#finance-dashboard').hidden=false;
    started=true;await refresh(true);
    clearInterval(poll);poll=setInterval(()=>{if(!document.hidden&&started)refresh();},30000);
  }
  function categoryNames(){
    const extra=[...Object.values(data.bills),...Object.values(data.templates)].map(x=>x.category).filter(Boolean);
    return Array.from(new Set(categories.concat(extra)));
  }
  function categoriesFill(){
    const filterEl=$('#finance-category-filter'),prev=filterEl.value;
    filterEl.innerHTML='<option value="all">Todas as categorias</option>'+categoryNames().map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    filterEl.value=categoryNames().includes(prev)?prev:'all';
    const formEl=$('#finance-form-category'),current=formEl.value;
    formEl.innerHTML=categoryNames().map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    formEl.value=categoryNames().includes(current)?current:'Outras despesas';
  }
  function render(){
    categoriesFill();
    const r=range(),current=items(),totals=E.summary(data,current,today());
    $('#finance-month-name').textContent=new Date(r.year,r.month,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    $('#sum-remaining').textContent=E.asBRL(totals.remaining);
    $('#sum-paid').textContent=E.asBRL(totals.paid);
    const isThisMonth=(r.from.slice(0,7)===today().slice(0,7));
    const allLate=isThisMonth?historicalOverdue():[];
    $('#sum-overdue').textContent=E.asBRL(isThisMonth?allLate.reduce((s,b)=>s+(status(b).remaining||0),0):totals.overdue);
    $('#sum-overdue-note').textContent=isThisMonth?'Inclui meses anteriores':'Neste mês';
    $('#sum-open').textContent=String(totals.open);
    $('#sum-unknown').textContent=totals.unknown?totals.unknown+' sem valor informado':'Aguardando pagamento';
    const percent=totals.total?Math.min(100,Math.round(totals.paid*100/totals.total)):0;
    $('#progress-label').textContent=percent+'% do valor quitado';
    $('#progress-fill').style.width=percent+'%';
    const dueToday=current.filter(b=>status(b).key==='today').length;
    const soon=current.filter(b=>{const remainingDays=(Date.parse(b.due+'T12:00:00Z')-Date.parse(today()+'T12:00:00Z'))/86400000;return remainingDays>=1&&remainingDays<=3&&status(b).key!=='paid';}).length;
    const alert=$('#finance-alerts');alert.hidden=!isThisMonth||(!allLate.length&&!dueToday&&!soon);
    if(!alert.hidden){
      const parts=[];
      if(allLate.length)parts.push(allLate.length+' atrasada'+(allLate.length>1?'s':''));
      if(dueToday)parts.push(dueToday+' vencendo hoje');
      if(soon)parts.push(soon+' nos próximos 3 dias');
      alert.innerHTML='<strong>⚠️ Atenção:</strong> '+parts.join(' · ')+'. <button type="button" id="go-urgent">Ver contas</button>';
    }
    $$('.finance-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===activeView));
    ['bills','calendar','recurring','reports'].forEach(view=>$('#view-'+view).hidden=view!==activeView);
    if(activeView==='bills')renderBills();
    if(activeView==='calendar')renderCalendar();
    if(activeView==='recurring')renderRecurring();
    if(activeView==='reports')renderReports();
  }
  function card(b){
    const s=status(b);
    const when=s.key==='paid'?'Pagamento concluído':s.key==='overdue'?'Venceu em '+fullDate(b.due):s.key==='today'?'Vence hoje':'Vence '+fullDate(b.due);
    const value=b.amountCents==null?'A definir':E.asBRL(b.amountCents);
    const partial=s.paid>0&&s.key!=='paid'?'Já pagou '+E.asBRL(s.paid)+' · Falta '+E.asBRL(s.remaining):'';
    return '<article class="finance-bill '+esc(s.key)+'">'+
      '<div class="finance-bill-left"><h3>'+esc(b.title)+'</h3><p>'+esc(b.category||'Outros')+(b.payee?' · '+esc(b.payee):'')+'</p>'+
      '<span class="finance-pill '+esc(s.key)+'">'+esc(s.label)+'</span><p>'+esc(when)+'</p></div>'+
      '<div class="finance-bill-right"><div><strong>'+esc(value)+'</strong>'+(partial?'<small>'+esc(partial)+'</small>':'')+'</div>'+
      '<div class="finance-bill-actions"><button class="secondary" data-details="'+esc(b.id)+'" aria-label="Ver detalhes de '+esc(b.title)+'">Ver</button>'+
      (s.key==='paid'?'':b.amountCents==null?'<button class="primary" data-edit="'+esc(b.id)+'">Valor</button>':'<button class="primary" data-pay="'+esc(b.id)+'">Paguei</button>')+
      '</div></div></article>';
  }
  function renderBills(){
    const term=$('#finance-search').value.trim().toLocaleLowerCase('pt-BR');
    const category=$('#finance-category-filter').value;
    const pool=filter==='overdue'&&range().from.slice(0,7)===today().slice(0,7)
      ?Array.from(new Map(items().concat(historicalOverdue()).map(b=>[b.id,b])).values())
      :items();
    let list=pool.filter(b=>{
      const s=status(b);
      const matches=!term||(b.title+' '+b.payee+' '+b.category+' '+b.notes).toLocaleLowerCase('pt-BR').includes(term);
      return matches&&(category==='all'||b.category===category)&&(
        filter==='all'||(filter==='paid'&&s.key==='paid')||(filter==='overdue'&&s.key==='overdue')||(filter==='pending'&&s.key!=='paid')
      );
    });
    if(filter==='overdue')list.sort((a,b)=>a.due.localeCompare(b.due));
    $('#finance-result-count').textContent=list.length+' conta'+(list.length===1?'':'s')+' encontrada'+(list.length===1?'':'s');
    $('#finance-bills-list').innerHTML=list.length?list.map(card).join(''):'<div class="finance-empty"><h2>Nenhuma conta aqui 😊</h2><p>Quando houver contas deste mês, elas aparecerão nesta lista.</p><button class="primary" id="finance-empty-add">＋ Adicionar conta</button></div>';
  }
  function renderCalendar(){
    const r=range(),daily=new Map();
    items().forEach(b=>{const day=Number(b.due.slice(-2));if(!daily.has(day))daily.set(day,[]);daily.get(day).push(b);});
    const weekdays=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
    const offset=(new Date(r.year,r.month,1).getDay()+6)%7;
    const days=Number(r.to.slice(-2));
    if(selectedDay===null||selectedDay>days)selectedDay=Math.min(Number(today().slice(-2)),days);
    let html=weekdays.map(d=>'<div class="finance-day-heading">'+d+'</div>').join('');
    for(let j=0;j<offset;j++)html+='<button class="empty" type="button" disabled aria-hidden="true"></button>';
    for(let day=1;day<=days;day++){
      const bills=daily.get(day)||[],total=bills.reduce((s,b)=>s+(status(b).remaining||0),0),sel=selectedDay===day;
      html+='<button type="button" data-day="'+day+'" class="'+(bills.length?'has-bills ':'')+(sel?'selected':'')+'"><span class="day-number">'+day+'</span><span class="day-amount">'+(bills.length?bills.length+' conta'+(bills.length>1?'s':'')+' · '+esc(E.asBRL(total)):'')+'</span></button>';
    }
    $('#finance-calendar').innerHTML=html;
    const bills=daily.get(selectedDay)||[];
    $('#finance-calendar-day').innerHTML='<h3>Dia '+selectedDay+' · '+bills.length+' conta'+(bills.length===1?'':'s')+'</h3>'+(bills.length?bills.map(card).join(''):'<p>Não há contas com vencimento neste dia.</p>');
  }
  function nextDate(t){
    const now=today();
    for(let i=0;i<900&&(t.count?i<t.count:true);i++){
      const d=E.nextDue(t,i);
      if(t.endsAt&&d>t.endsAt)break;
      if(d>=now)return 'Próximo: '+fullDate(d);
    }
    return 'Sem novos vencimentos';
  }
  function renderRecurring(){
    const templates=Object.values(data.templates).filter(t=>!t.archived).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
    const names={monthly:'Todo mês',weekly:'Toda semana',biweekly:'A cada 15 dias',yearly:'Todo ano'};
    $('#finance-recurring-list').innerHTML=templates.length?templates.map(t=>{
      const recurrence=t.kind==='installments'?t.count+' parcelas mensais':names[t.frequency];
      return '<article class="finance-recurring-card"><div><h3>'+esc(t.title)+'</h3><p>'+esc(recurrence)+' · '+esc(E.asBRL(t.amountCents))+'</p><p>'+esc(nextDate(t))+'</p></div>'+
        '<div class="action-group"><button class="secondary" data-template-edit="'+esc(t.id)+'">Editar</button><button class="secondary" data-template-end="'+esc(t.id)+'">Encerrar</button></div></article>';
    }).join(''):'<div class="finance-empty"><h2>Sem contas fixas ainda</h2><p>Cadastre aluguel, internet, gás ou uma compra parcelada só uma vez.</p><button class="primary" id="finance-recurring-empty">＋ Cadastrar conta fixa</button></div>';
  }
  function renderReports(){
    const current=items(),last=items(-1),currentTotals=E.summary(data,current,today()),past=E.summary(data,last,today());
    const byCategory=new Map();
    current.forEach(b=>byCategory.set(b.category||'Outros',(byCategory.get(b.category||'Outros')||0)+(b.amountCents||0)));
    const sorted=Array.from(byCategory).sort((a,b)=>b[1]-a[1]),max=Math.max(...sorted.map(x=>x[1]),1);
    $('#finance-categories-chart').innerHTML=sorted.length?sorted.map(([name,value])=>
      '<div class="finance-category-item"><div class="finance-category-line"><strong>'+esc(name)+'</strong><span>'+esc(E.asBRL(value))+'</span></div><div class="finance-bar"><span style="width:'+Math.round(value*100/max)+'%"></span></div></div>').join(''):'<p>Cadastre uma conta para ver os gastos por categoria.</p>';
    $('#finance-comparison').innerHTML='<div class="finance-compare"><div><span>Mês anterior (contas previstas)</span><strong>'+esc(E.asBRL(past.total))+'</strong></div><div><span>Este mês (contas previstas)</span><strong>'+esc(E.asBRL(currentTotals.total))+'</strong></div></div>'+
      '<p class="finance-disclaimer">Os valores correspondem ao mês de vencimento, não necessariamente ao mês em que o pagamento foi feito. Contas sem valor não entram nas somas.</p>';
  }
  function openNew(recurring=false){
    selectedBill=null;selectedTemplate=null;
    const form=$('#finance-bill-form');form.reset();form.dataset.mode='new';
    $('#finance-form-heading').textContent='Nova conta';
    $('#finance-repeat-wrapper').hidden=false;form.elements.frequency.disabled=false;
    form.elements.frequency.value=recurring?'monthly':'once';form.elements.due.value=today();
    form.elements.category.value='Outras despesas';
    $('#finance-form-error').textContent='';form.querySelector('details').open=false;
    updateRepeat();$('#finance-bill-dialog').showModal();
    form.elements.title.focus();
  }
  function editBill(b){
    if(!b)return;
    selectedBill=b;selectedTemplate=null;
    const form=$('#finance-bill-form');form.reset();form.dataset.mode='bill';
    $('#finance-form-heading').textContent='Editar conta';
    form.elements.title.value=b.title;form.elements.amount.value=centsInput(b.amountCents);
    form.elements.due.value=b.due;form.elements.category.value=b.category||'Outras despesas';
    form.elements.payee.value=b.payee||'';form.elements.method.value=b.method||'';
    form.elements.notes.value=b.notes||'';
    $('#finance-repeat-wrapper').hidden=true;$('#finance-form-error').textContent='';
    form.querySelector('details').open=false;$('#finance-details-dialog').close();
    $('#finance-bill-dialog').showModal();
  }
  function editTemplate(t){
    if(!t)return;
    selectedTemplate=t;selectedBill=null;
    const form=$('#finance-bill-form');form.reset();form.dataset.mode='template';
    $('#finance-form-heading').textContent='Editar conta fixa';
    form.elements.title.value=t.title;form.elements.amount.value=centsInput(t.amountCents);
    form.elements.due.value=t.firstDue;form.elements.category.value=t.category||'Outras despesas';
    form.elements.payee.value=t.payee||'';form.elements.method.value=t.method||'';
    form.elements.notes.value=t.notes||'';
    form.elements.frequency.value=t.kind==='installments'?'installments':t.frequency;
    form.elements.count.value=t.count||2;
    $('#finance-repeat-wrapper').hidden=false;
    $('#finance-form-error').textContent='';form.querySelector('details').open=false;
    updateRepeat();$('#finance-bill-dialog').showModal();
  }
  function updateRepeat(){
    $('#finance-installments').hidden=$('#finance-bill-form').elements.frequency.value!=='installments';
  }
  function parseBillForm(form){
    const frequency=form.elements.frequency.value,amountCents=E.moneyToCents(form.elements.amount.value,true);
    const base={
      title:form.elements.title.value.trim(),amountCents,due:form.elements.due.value,
      category:form.elements.category.value||'Outras despesas',payee:form.elements.payee.value.trim(),
      method:form.elements.method.value,notes:form.elements.notes.value.trim()
    };
    if(frequency==='installments'&&amountCents===null)throw new Error('Para parcelar, informe o valor de cada parcela.');
    return {base,frequency};
  }
  async function submitBill(e){
    e.preventDefault();
    if(busy)return;
    const form=e.currentTarget,btn=form.querySelector('[type="submit"]');
    try{
      const {base,frequency}=parseBillForm(form),mode=form.dataset.mode;
      let action;
      if(mode==='bill'){
        const b={...selectedBill,...base,virtual:false};
        action={type:'save-bill',bill:b};
      }else if(mode==='template'||frequency!=='once'){
        const id=mode==='template'?selectedTemplate.id:uuid();
        const template={...(mode==='template'?selectedTemplate:{}),...base,id,firstDue:base.due,
          frequency:frequency==='installments'?'monthly':frequency,
          kind:frequency==='installments'?'installments':'recurring',
          count:frequency==='installments'?Number(form.elements.count.value):0};
        delete template.due;
        action={type:'save-template',template};
      }else{
        const bill={...base,id:uuid()};
        if(items().some(x=>!x.archived&&x.title.toLowerCase()===bill.title.toLowerCase()&&x.due===bill.due)){
          if(!window.confirm('Já existe uma conta com este nome e vencimento. Deseja cadastrar outra mesmo assim?'))return;
        }
        action={type:'save-bill',bill};
      }
      busy=true;btn.disabled=true;
      data=await C.financeTransaction(action);
      $('#finance-bill-dialog').close();busy=false;btn.disabled=false;
      render();notice('Conta salva com sucesso!');
    }catch(err){$('#finance-form-error').textContent=errorText(err);busy=false;btn.disabled=false;}
  }
  function openPayment(b){
    if(!b)return;
    if(b.amountCents==null){editBill(b);notice('Informe o valor antes de registrar o pagamento.');return;}
    payingBill=b;
    const s=status(b);if(s.key==='paid'){notice('Esta conta já está paga.');return;}
    const f=$('#finance-payment-form');f.reset();
    $('#payment-name').textContent=b.title;
    $('#payment-remaining').textContent='Falta pagar: '+E.asBRL(s.remaining)+(s.paid?' · Já pago: '+E.asBRL(s.paid):'');
    f.elements.amount.value=centsInput(s.remaining);f.elements.paidAt.value=today();
    f.elements.method.value=b.method||'Pix';
    $('#finance-payment-error').textContent='';$('#finance-details-dialog').close();
    $('#finance-payment-dialog').showModal();
    f.elements.amount.focus();f.elements.amount.select();
  }
  async function submitPayment(e){
    e.preventDefault();if(busy||!payingBill)return;
    const f=e.currentTarget,btn=f.querySelector('[type="submit"]');
    try{
      const payment={id:uuid(),billId:payingBill.id,amountCents:E.moneyToCents(f.elements.amount.value),paidAt:f.elements.paidAt.value,method:f.elements.method.value,notes:f.elements.notes.value.trim(),createdAt:Date.now()};
      const action={type:'add-payment',payment,materialize:payingBill};
      busy=true;btn.disabled=true;data=await C.financeTransaction(action);
      $('#finance-payment-dialog').close();busy=false;btn.disabled=false;render();
      const remaining=E.situation(data,payingBill,today()).remaining;
      notice(remaining>0?'Pagamento parcial salvo. Ainda falta '+E.asBRL(remaining)+'.':'Conta marcada como paga! ✅');
    }catch(err){busy=false;btn.disabled=false;$('#finance-payment-error').textContent=errorText(err);}
  }
  function showDetails(b){
    if(!b)return;
    selectedBill=b;$('#finance-details-title').textContent=b.title;
    const s=status(b),ps=E.paymentsFor(data,b.id),t=b.templateId?data.templates[b.templateId]:null;
    let html='<div class="finance-detail-grid">'+
      '<div><span>Valor da conta</span><strong>'+esc(E.asBRL(b.amountCents))+'</strong></div>'+
      '<div><span>Falta pagar</span><strong>'+esc(E.asBRL(s.remaining))+'</strong></div>'+
      '<div><span>Vencimento</span><strong>'+esc(fullDate(b.due))+'</strong></div>'+
      '<div><span>Situação</span><strong>'+esc(s.label)+'</strong></div></div>'+
      '<div class="finance-method-notes"><strong>Categoria:</strong> '+esc(b.category||'Outros')+
      (b.payee?'<br><strong>Fornecedor:</strong> '+esc(b.payee):'')+
      (b.notes?'<br><strong>Observação:</strong> '+esc(b.notes):'')+'</div>'+
      '<h3 style="margin:20px 0 6px;font-size:17px">Pagamentos</h3>';
    html+=ps.length?ps.map(p=>'<div class="finance-payment-row"><div><strong>'+esc(E.asBRL(p.amountCents))+'</strong><br>'+esc(fullDate(p.paidAt))+' · '+esc(p.method||'Não informado')+(p.notes?'<br>'+esc(p.notes):'')+'</div><button class="secondary" data-reverse="'+esc(p.id)+'">Desfazer</button></div>').join(''):'<p style="font-size:13px">Nenhum pagamento registrado.</p>';
    html+='<div class="finance-detail-buttons">'+
      (s.key==='paid'?'':'<button class="primary" data-pay="'+esc(b.id)+'">Registrar pagamento</button>')+
      (t?'<button class="secondary" data-open-template="'+esc(t.id)+'">Ver conta fixa</button>':'')+
      (!ps.length?'<button class="secondary" data-cancel="'+esc(b.id)+'">Cancelar esta conta</button>':'')+
      '</div>';
    $('#finance-details-body').innerHTML=html;
    $('#finance-details-dialog').showModal();
  }
  async function doAction(action,success){
    if(busy)return;busy=true;
    try{data=await C.financeTransaction(action);$('#finance-details-dialog').close();render();notice(success);}
    catch(err){notice(errorText(err),true);}
    finally{busy=false;}
  }
  function openView(view){activeView=view;filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));render();}
  async function downloadCSV(){
    const rows=[['Conta','Categoria','Fornecedor','Vencimento','Valor previsto','Valor pago','Restante','Situação','Observações']];
    items().forEach(b=>{const s=status(b);rows.push([b.title,b.category,b.payee,b.due,b.amountCents==null?'':centsInput(b.amountCents),centsInput(s.paid),s.remaining==null?'':centsInput(s.remaining),s.label,b.notes]);});
    const quote=v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='contas-'+range().from.slice(0,7)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    notice('Arquivo de contas preparado.');
  }
  async function copySummary(){
    const current=items(),sum=E.summary(data,current,today());
    const lines=['CONTAS A PAGAR — QUENTINHA DA GUERREIRA',new Date(range().year,range().month,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).toUpperCase(),'','Falta pagar: '+E.asBRL(sum.remaining),'Já pagou: '+E.asBRL(sum.paid),'Em atraso neste mês: '+E.asBRL(sum.overdue),''];
    current.forEach(b=>lines.push((status(b).key==='paid'?'✅ ':'⬜ ')+b.title+' — '+E.asBRL(b.amountCents)+' — vence '+fullDate(b.due)));
    try{await navigator.clipboard.writeText(lines.join('\n'));notice('Resumo copiado! Pode colar no WhatsApp.');}
    catch{notice('Não foi possível copiar. Confira a permissão do navegador.',true);}
  }
  function changeMonth(delta){
    month=new Date(month.getFullYear(),month.getMonth()+delta,1);selectedDay=null;render();
  }
  $('#finance-login-form').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.currentTarget,b=f.querySelector('button[type="submit"]');b.disabled=true;$('#finance-login-error').textContent='';
    try{await C.api('/api/login',{email:f.elements.email.value.trim(),password:f.elements.password.value});f.elements.password.value='';await start();}
    catch(err){$('#finance-login-error').textContent=errorText(err);}
    finally{b.disabled=false;}
  });
  $('#finance-logout').addEventListener('click',async()=>{try{await C.api('/api/logout',{});}finally{showLogin();}});
  $('#finance-add').addEventListener('click',()=>openNew());
  $('#finance-add-recurring').addEventListener('click',()=>openNew(true));
  $('#month-prev').addEventListener('click',()=>changeMonth(-1));
  $('#month-next').addEventListener('click',()=>changeMonth(1));
  $('#month-current').addEventListener('click',()=>{month=new Date();selectedDay=null;render();});
  $$('.finance-tabs button').forEach(b=>b.addEventListener('click',()=>openView(b.dataset.view)));
  $$('.finance-status-tabs button').forEach(b=>b.addEventListener('click',()=>{
    filter=b.dataset.filter;$$('.finance-status-tabs button').forEach(el=>el.classList.toggle('active',el===b));renderBills();
  }));
  $('#finance-search').addEventListener('input',renderBills);
  $('#finance-category-filter').addEventListener('change',renderBills);
  $('#finance-bill-form').elements.frequency.addEventListener('change',updateRepeat);
  $('#finance-bill-form').addEventListener('submit',submitBill);
  $('#finance-payment-form').addEventListener('submit',submitPayment);
  $('#finance-edit-selected').addEventListener('click',()=>editBill(selectedBill));
  $('#finance-copy').addEventListener('click',copySummary);
  $('#finance-export').addEventListener('click',downloadCSV);
  $('#finance-print').addEventListener('click',()=>window.print());
  $$('[data-finance-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.financeClose).close()));
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='finance-empty-add'){openNew();return;}
    if(b.id==='finance-recurring-empty'){openNew(true);return;}
    if(b.id==='go-urgent'){activeView='bills';filter='overdue';render();$$('.finance-status-tabs button').forEach(el=>el.classList.toggle('active',el.dataset.filter===filter));return;}
    if(b.hasAttribute('data-details')){showDetails(lookup(b.dataset.details));return;}
    if(b.hasAttribute('data-edit')){editBill(lookup(b.dataset.edit));return;}
    if(b.hasAttribute('data-pay')){openPayment(lookup(b.dataset.pay));return;}
    if(b.hasAttribute('data-day')){selectedDay=Number(b.dataset.day);renderCalendar();return;}
    if(b.hasAttribute('data-template-edit')){editTemplate(data.templates[b.dataset.templateEdit]);return;}
    if(b.hasAttribute('data-open-template')){$('#finance-details-dialog').close();openView('recurring');return;}
    if(b.hasAttribute('data-cancel')){
      const bill=lookup(b.dataset.cancel);
      if(bill&&window.confirm('Cancelar esta conta? O histórico será preservado.')){
        doAction({type:'archive-bill',id:bill.id,materialize:bill},'Conta cancelada.');
      }return;
    }
    if(b.hasAttribute('data-template-end')){
      const t=data.templates[b.dataset.templateEnd];
      if(t&&window.confirm('Encerrar "'+t.title+'"? As próximas contas deixarão de aparecer. Pagamentos anteriores serão preservados.')){
        doAction({type:'archive-template',id:t.id},'Conta fixa encerrada.');
      }return;
    }
    if(b.hasAttribute('data-reverse')){
      const p=data.payments[b.dataset.reverse];
      if(p&&window.confirm('Desfazer este pagamento de '+E.asBRL(p.amountCents)+'?')){
        doAction({type:'reverse-payment',id:p.id},'Pagamento desfeito.');
      }return;
    }
  });
  window.addEventListener('online',()=>{if(started)refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&started)refresh();});
  (async()=>{
    if(!C?.enabled){showLogin();$('#finance-login-error').textContent='Este painel utiliza o Firebase e está disponível no site publicado pelo GitHub Pages.';return;}
    try{await C.api('/api/session');await start();}catch{showLogin();}
  })();
})();
