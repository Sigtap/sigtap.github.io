const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat('pt-BR').format(n);
const currency=n=>n==null?'Não informado':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const paths={search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',reset:'<path d="M3 10a9 9 0 1 1 2 9M3 3v7h7"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m9 6 6 6-6 6"/>',file:'<path d="M14 2H5v20h14V7zm0 0v5h5M8 12h8M8 16h6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>'};
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.file}</svg>`}
function icons(){document.querySelectorAll('[data-icon]').forEach(e=>{e.outerHTML=icon(e.dataset.icon)})}icons();
const types={INSTRUMENTO:'Instrumentos de registro',MODALIDADE:'Modalidades',ATRIBUTO_COMPLEMENTAR:'Atributos complementares',CBO:'CBO',CID:'CID',HABILITACAO:'Habilitações',SERVICO_CLASSIFICACAO:'Serviços e classificações',COMPATIBILIDADE:'Compatibilidades',REGRA_CONDICIONADA:'Regras condicionadas'};
const shortGroups={'01':'Promoção e prevenção','02':'Diagnóstico','03':'Procedimentos clínicos','04':'Procedimentos cirúrgicos','05':'Transplantes','06':'Medicamentos','07':'Órteses, próteses e materiais','08':'Ações complementares','09':'Cuidados integrados'};
const complexity={'0':'Não se aplica','1':'Atenção básica','2':'Média complexidade','3':'Alta complexidade'};
const sex={'A':'Ambos','I':'Ambos','M':'Masculino','F':'Feminino','N':'Não se aplica'};
let db,all=[],filtered=[],page=0,selected=null,current=null,detailTicket=0,tab='overview',relationTerm='';
const PAGE_SIZE=50,groupsCache=new Map();let catalogPromise;
async function fetchJSON(path){const r=await fetch(path);if(!r.ok)throw new Error('Não foi possível carregar a base.');return r.json()}
function catalog(){if(!catalogPromise)catalogPromise=fetchJSON('./data/catalog.json').catch(e=>{catalogPromise=null;throw e});return catalogPromise}
function groupData(code){const key=code.slice(0,2);if(!groupsCache.has(key))groupsCache.set(key,fetchJSON(`./data/group-${key}.json`).catch(e=>{groupsCache.delete(key);throw e}));return groupsCache.get(key)}
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),2400)}
function options(el,items,placeholder){el.innerHTML=`<option value="">${placeholder}</option>`+items.map(([k,v])=>`<option value="${esc(k)}">${esc(k)} — ${esc(v)}</option>`).join('')}
function updateSubgroups(){const g=$('#group').value;options($('#subgroup'),g?db.hierarchy.subgroups[g]:[],g?'Todos os subgrupos':'Selecione um grupo');$('#subgroup').disabled=!g;updateForms()}
function updateForms(){const s=$('#subgroup').value;options($('#form'),s?db.hierarchy.forms[s]:[],s?'Todas as formas':'Selecione um subgrupo');$('#form').disabled=!s}
function syncURL(){const p=new URLSearchParams();if($('#search').value)p.set('q',$('#search').value);for(const [id,key] of [['group','g'],['subgroup','s'],['form','f']])if($('#'+id).value)p.set(key,$('#'+id).value);if(selected)p.set('p',selected);const value=p.toString();history.replaceState(null,'',location.pathname+(value?'?'+value:''))}
function filter({preferred=null,mobile=false}={}){
 const q=norm($('#search').value.trim()),prefix=$('#form').value||$('#subgroup').value||$('#group').value;
 const digits=q.replace(/[.\-\s]/g,'');const isCode=/^\d+$/.test(digits);
 filtered=all.filter(p=>p[0].startsWith(prefix)&&(!q||(isCode?p[0].includes(digits):q.split(/\s+/).every(t=>p[2].includes(t)))));
 page=0;
 const keep=preferred||selected;
 selected=filtered.some(p=>p[0]===keep)?keep:(filtered[0]?.[0]||null);
 if(preferred&&selected===preferred)page=Math.floor(filtered.findIndex(p=>p[0]===preferred)/PAGE_SIZE);
 $('#result-count').textContent=`${fmt(filtered.length)} ${filtered.length===1?'procedimento encontrado':'procedimentos encontrados'}`;
 $('#result-context').textContent=q||prefix?' com os filtros atuais':' na base completa';
 document.querySelectorAll('.group-button').forEach(b=>{const active=b.dataset.group===$('#group').value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active)});
 $('#all-groups').classList.toggle('active',!prefix&&!q);
 if(!mobile)$('#workspace').classList.remove('mobile-detail');
 renderList();
 if(selected)loadDetail(selected,{mobile});else{current=null;++detailTicket;$('#detail').innerHTML=`<div class="empty-detail">${icon('search')}<h2>Nenhum procedimento encontrado.</h2><p>Experimente outro termo ou limpe os filtros para consultar toda a base.</p></div>`}
 syncURL();
}
function renderList(){
 const start=page*PAGE_SIZE,rows=filtered.slice(start,start+PAGE_SIZE);
 $('#results').innerHTML=rows.length?rows.map(([code,name])=>`<button class="procedure-row ${selected===code?'selected':''}" data-code="${code}" aria-pressed="${selected===code}" aria-label="${code} — ${esc(name)}"><span><span class="proc-code">${code}</span><span class="proc-name">${esc(name)}</span></span>${icon('right')}</button>`).join(''):`<div class="empty-results">${icon('search')}<strong>Nenhum resultado por aqui.</strong><p>Busque por um nome mais curto ou confira os filtros selecionados.</p><button id="empty-reset">Limpar busca e filtros</button></div>`;
 $('#results').scrollTop=0;
 $('#list-range').textContent=rows.length?`${fmt(start+1)}–${fmt(start+rows.length)}`:'0 resultados';
 $('#page-label').textContent=filtered.length?`Página ${page+1} de ${Math.ceil(filtered.length/PAGE_SIZE)}`:'Nenhum resultado';
 $('#prev').disabled=page===0;$('#next').disabled=start+PAGE_SIZE>=filtered.length;
 $('#results').querySelectorAll('[data-code]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.code)));
 $('#empty-reset')?.addEventListener('click',reset);
}
function select(code,{mobile=true}={}){selected=code;tab='overview';relationTerm='';document.querySelectorAll('.procedure-row').forEach(b=>{const yes=b.dataset.code===code;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',yes)});loadDetail(code,{mobile});syncURL()}
async function loadDetail(code,{mobile=false}={}){
 const ticket=++detailTicket;
 if(mobile)$('#workspace').classList.add('mobile-detail');
 $('#detail').innerHTML=`<div class="loading-state">Carregando detalhes de ${code}…</div>`;
 try{const [data,cat]=await Promise.all([groupData(code),catalog()]);if(ticket!==detailTicket)return;
 const p=data[code];if(!p)throw new Error('Procedimento ausente nos detalhes.');current={p,cat};tab='overview';renderDetail();$('#detail-panel').scrollTop=0;
 }catch(e){if(ticket!==detailTicket)return;$('#detail').innerHTML=`<div class="empty-detail"><h2>Não foi possível carregar os detalhes.</h2><p>Verifique sua conexão e tente novamente.</p><button id="retry" class="source-button">Tentar novamente</button></div>`;$('#retry').onclick=()=>loadDetail(code,{mobile})}
}
function names(kind){return(current.p.relations[kind]||[]).map(i=>current.cat[i][1]).filter(Boolean)}
function renderDetail(){
 const {p}=current,h=db.hierarchy;const g=h.groups.find(x=>x[0]===p.codigo.slice(0,2));const sg=h.subgroups[g[0]].find(x=>x[0]===p.codigo.slice(0,4));const fo=h.forms[sg[0]].find(x=>x[0]===p.codigo.slice(0,6));
 const total=Object.values(p.relations).reduce((s,a)=>s+a.length,0);
 const tags=[complexity[p.complexidade]||`Complexidade ${p.complexidade}`, ...names('MODALIDADE')];
 $('#detail').innerHTML=`<div class="detail-top"><button class="back-list" id="back-list">${icon('left')} Voltar aos procedimentos</button><div class="detail-breadcrumb"><b>${esc(g[0])} · ${esc(shortGroups[g[0]]||g[1])}</b> / ${esc(sg[1])}<br>${esc(fo[0])} · ${esc(fo[1])}</div><div class="detail-title-row"><span class="code-pill">${esc(p.codigo)}</span><button class="copy-button" id="copy-code">${icon('copy')} Copiar código</button></div><h2 class="detail-title">${esc(p.nome)}</h2><div class="detail-tags">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div><div class="tabs" role="tablist" aria-label="Informações do procedimento"><button class="tab ${tab==='overview'?'active':''}" id="overview-tab" role="tab" aria-selected="${tab==='overview'}" aria-controls="detail-body">Visão geral</button><button class="tab ${tab==='relations'?'active':''}" id="relations-tab" role="tab" aria-selected="${tab==='relations'}" aria-controls="detail-body">Relacionamentos <span>${fmt(total)}</span></button></div><div class="detail-body" id="detail-body" role="tabpanel" aria-labelledby="${tab==='overview'?'overview-tab':'relations-tab'}"></div>`;
 $('#back-list').onclick=()=>{$('#workspace').classList.remove('mobile-detail');$(`.procedure-row[data-code="${p.codigo}"]`)?.focus()};
 $('#copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(p.codigo);toast('Código copiado')}catch{toast('Código: '+p.codigo)}};
 $('#overview-tab').onclick=()=>{tab='overview';renderDetail();$('#overview-tab').focus()};$('#relations-tab').onclick=()=>{tab='relations';renderDetail();$('#relations-tab').focus()};
 $('#overview-tab').onkeydown=e=>{if(e.key==='ArrowRight')$('#relations-tab').click()};$('#relations-tab').onkeydown=e=>{if(e.key==='ArrowLeft')$('#overview-tab').click()};
 if(tab==='overview')renderOverview();else renderRelations();
}
function datum(label,value,note=''){return `<div class="datum"><span>${label}</span><strong>${esc(value??'Não informado')}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`}
function renderOverview(){const p=current.p;
 const docs=(p.relations.ATRIBUTO_COMPLEMENTAR||[]).map(i=>current.cat[i]).filter(x=>['009','034','058'].includes(x[0])).map(x=>x[1]);
 const rawAge=x=>x==null?'Não informado':x===9999?'9999 (código da base)':fmt(x)+' meses';
 const max=p.quantidade_maxima===9999?'9999 (código da base)':p.quantidade_maxima==null?'Não informado':fmt(p.quantidade_maxima);
 $('#detail-body').innerHTML=`<div class="section-label">DESCRIÇÃO DO PROCEDIMENTO</div><p class="description ${p.descricao?'':'missing'}">${esc(p.descricao||'Descrição não disponível nesta base.')}</p><div class="detail-grid">${datum('Financiamento',[p.financiamento_codigo,p.financiamento_nome].filter(Boolean).join(' — '))}${datum('Instrumentos de registro',names('INSTRUMENTO').join(' · ')||'Sem registro na base')}${datum('Sexo',sex[p.sexo]||p.sexo)}${datum('Quantidade máxima',max)}${datum('Idade mínima / máxima',rawAge(p.idade_minima)+' / '+rawAge(p.idade_maxima),'Valores preservados da base SIGTAP')}${datum('Identificação do usuário',docs.join(' · ')||'Sem atributo de CPF/CNS informado','Conforme atributos complementares')}</div><div class="values"><div class="value-card"><span>AMBULATORIAL · SA</span><strong>${currency(p.valor_sa)}</strong></div><div class="value-card"><span>HOSPITALAR · SH</span><strong>${currency(p.valor_sh)}</strong></div><div class="value-card"><span>PROFISSIONAL · SP</span><strong>${currency(p.valor_sp)}</strong></div></div><p class="detail-note">Competência 08/2026 · Valores de referência presentes na base do projeto. Consulte os relacionamentos para os atributos e condicionantes.</p>`
}
function renderRelations(){
 $('#detail-body').innerHTML=`<input class="relation-search" id="relation-search" type="search" aria-label="Filtrar relacionamentos" placeholder="Filtrar por CBO, CID, código ou descrição…" value="${esc(relationTerm)}"><div id="relation-groups"></div><p class="detail-note">Ausência de registros não confirma dispensa de requisito. Os vínculos abaixo reproduzem a consulta do MVP nesta competência.</p>`;
 $('#relation-search').addEventListener('input',e=>{relationTerm=e.target.value;renderRelationGroups()});renderRelationGroups();
}
function relationItem(i,kind){const [code,name,condition]=current.cat[i];const isLink=kind==='COMPATIBILIDADE'&&all.some(p=>p[0]===code);return `<div class="relation-item">${isLink?`<a href="?p=${esc(code)}" data-related="${esc(code)}">${esc(code)} ↗</a>`:`<code>${esc(code||'—')}</code>`}<p>${esc(name||'Sem descrição')}</p>${condition?`<small>${esc(condition)}</small>`:''}</div>`}
function renderRelationGroups(){const q=norm(relationTerm),{p,cat}=current;let shown=0;
 $('#relation-groups').innerHTML=Object.entries(types).map(([kind,name])=>{let ids=p.relations[kind]||[];if(q)ids=ids.filter(i=>norm([name,...cat[i]].join(' ')).includes(q));if(q&&!ids.length)return '';shown+=ids.length;return `<details class="relation-group" data-kind="${kind}" ${q||['INSTRUMENTO','MODALIDADE','ATRIBUTO_COMPLEMENTAR'].includes(kind)?'open':''}><summary><span>${name}</span><span>${fmt(ids.length)} ${ids.length===1?'registro':'registros'} +</span></summary><div class="relation-items">${ids.length?ids.slice(0,50).map(i=>relationItem(i,kind)).join(''):'<p class="relation-empty">Nenhum registro retornado pela base para esta relação.</p>'}</div>${ids.length>50?`<button class="more-relations" data-kind="${kind}">Mostrar todos os ${fmt(ids.length)} registros</button>`:''}</details>`}).join('')||'<p class="relation-empty">Nenhum relacionamento encontrado para este termo.</p>';
 document.querySelectorAll('.more-relations').forEach(b=>b.onclick=()=>{const kind=b.dataset.kind;const ids=(p.relations[kind]||[]).filter(i=>!q||norm([types[kind],...cat[i]].join(' ')).includes(q));b.previousElementSibling.innerHTML=ids.map(i=>relationItem(i,kind)).join('');b.remove();relatedLinks()});relatedLinks();
}
function relatedLinks(){document.querySelectorAll('[data-related]').forEach(a=>a.onclick=e=>{e.preventDefault();$('#search').value='';$('#group').value='';updateSubgroups();filter({preferred:a.dataset.related,mobile:true});tab='overview'})}
function reset(){$('#search').value='';$('#group').value='';updateSubgroups();selected=null;filter()}
function sourceDialog(){
 $('#source-content').innerHTML=`<p>Base <strong>SIGTAP 08/2026</strong>, extraída do arquivo DuckDB disponível no seu MVP. Consulta em leitura, com dados organizados pela competência.</p><div class="source-stats"><div><strong>${fmt(db.total)}</strong><span>procedimentos</span></div><div><strong>${db.hierarchy.groups.length}</strong><span>grupos</span></div><div><strong>70</strong><span>subgrupos</span></div></div><h3>Cobertura dos grupos</h3><table><tbody>${db.hierarchy.groups.map(([g,n])=>`<tr><td>${esc(g)} · ${esc(n)}</td><td>${fmt(db.counts[g])}</td></tr>`).join('')}</tbody></table><h3>Verificações realizadas</h3><p>Todos os procedimentos da tabela principal foram exportados. Os códigos são únicos, têm dez dígitos e estão vinculados à hierarquia. Foram verificadas 11 tabelas de vínculos sem procedimentos órfãos e amostras dos relacionamentos foram confrontadas com o MVP.</p><p class="validation-note">${fmt(db.withoutDescription)} procedimentos não possuem descrição na base. A importação original ainda não foi reconciliada com os TXT oficiais; essa limitação foi preservada. Esta é a competência 08/2026, sem atualização automática.</p><h3>Identificação da fonte</h3><p>sigtap_202608.duckdb · SHA-256</p><code>${esc(db.sha256)}</code>`;
 $('#source-dialog').showModal();
}
$('#close-dialog').onclick=()=>$('#source-dialog').close();$('#source-dialog').addEventListener('click',e=>{if(e.target===$('#source-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
async function init(){
 try{db=await fetchJSON('./data/index.json');all=db.procedures.map(([code,name])=>[code,name,norm(name)]);
 const h=db.hierarchy;options($('#group'),h.groups,'Todos os grupos');$('#group-total').textContent=h.groups.length;
 $('#base-count').textContent=`${h.groups.length} grupos · ${Object.values(h.subgroups).flat().length} subgrupos`;
 $('#group-nav').innerHTML=h.groups.map(([g,n])=>`<button class="group-button" data-group="${g}" aria-pressed="false" title="${esc(n)}"><span class="group-code">${g}</span><span class="group-name">${esc(shortGroups[g]||n)}</span><span class="group-count">${fmt(db.counts[g])}</span></button>`).join('');
 $('#group-nav').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('#group').value=b.dataset.group;updateSubgroups();filter()});
 $('#group').onchange=()=>{updateSubgroups();filter()};$('#subgroup').onchange=()=>{updateForms();filter()};$('#form').onchange=()=>filter();
 $('#search').addEventListener('input',()=>filter());$('#reset').onclick=reset;$('#all-groups').onclick=reset;
 $('#prev').onclick=()=>{if(page>0){page--;renderList()}};$('#next').onclick=()=>{if((page+1)*PAGE_SIZE<filtered.length){page++;renderList()}};
 $('#source-button').onclick=sourceDialog;$('#validation-link').onclick=sourceDialog;
 const url=new URLSearchParams(location.search);$('#search').value=url.get('q')||'';$('#group').value=url.get('g')||'';updateSubgroups();$('#subgroup').value=url.get('s')||'';updateForms();$('#form').value=url.get('f')||'';filter({preferred:url.get('p')});
 document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!$('#source-dialog').open){e.preventDefault();$('#search').focus()}});
 }catch(e){$('#result-count').textContent='Não foi possível carregar a base';$('#results').innerHTML='<div class="empty-results"><p>Confira sua conexão e recarregue a página.</p><button id="reload">Tentar novamente</button></div>';$('#reload').onclick=()=>location.reload();$('#group-nav').textContent='Base indisponível';console.error(e)}
}
init();
