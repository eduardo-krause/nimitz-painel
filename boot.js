import {API_URL} from './config.js';
const $ = id => document.getElementById(id);
const localHost = ['127.0.0.1','localhost'].includes(location.hostname);
let local = null;
if (localHost) {
  local = await fetch('/local/status').then(r => r.ok ? r.json() : null).catch(() => null);
}
let settings = {};
try { settings = JSON.parse(sessionStorage.getItem('nimitz-connection') || '{}'); } catch {}
if (!settings.email) { settings = {}; sessionStorage.removeItem('nimitz-connection'); }
if (local) settings.url = location.origin;
else if (API_URL) settings.url = API_URL;
const preview = new URLSearchParams(location.search).has('preview');
const state = window.nimitz = {connected:!!(settings.url && settings.email && settings.token), preview, writes:false,worklogWrites:false,
  storagePrefix:preview ? 'nimitz-preview:' : 'nimitz-signedout:'};
// Discard caches from the former shared-account version.
Object.keys(localStorage).filter(k => k.startsWith('nimitz-rest:')).forEach(k => localStorage.removeItem(k));
Object.keys(sessionStorage).filter(k => k.startsWith('nimitz-rest:')).forEach(k => sessionStorage.removeItem(k));

async function request(path, body, connection = settings) {
  if (!connection.url || !connection.email || !connection.token) throw new Error('Abra Conexão para configurar o Jira.');
  let response;
  try {
    response = await fetch(connection.url.replace(/\/$/,'') + path, {
      method:body === undefined ? 'GET' : 'POST',
      headers:{Authorization:'Basic ' + btoa(connection.email + ':' + connection.token), 'Content-Type':'application/json',
        'X-Jira-Scoped':String(!!connection.scoped), 'X-Allow-Writes':String(!!connection.writes),'X-Allow-Worklogs':String(!!connection.worklogs)},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(40000), redirect:'error'
    });
  } catch { throw new Error('Não foi possível alcançar o backend. Confira o endereço e a conexão.'); }
  const data = await response.json().catch(() => ({message:'O backend retornou uma resposta inválida.'}));
  if (!response.ok) throw Object.assign(new Error(data.message || 'Falha na API.'), data,{status:response.status});
  return data;
}
state.request = (path, body) => {
  if (preview) return Promise.reject(new Error('A prévia usa dados salvos. Conecte ao Jira para consultar ou gravar.'));
  return request(path, body);
};
state.search = async (jql, fields, nextPageToken) => {
  for (let attempt = 0; ; attempt++) {
    try { return await state.request('/api/search', {jql, fields, nextPageToken}); }
    catch (e) {
      if (!e.retryable || attempt >= 1) throw e;
      await new Promise(resolve => setTimeout(resolve, Math.min(e.retryAfterMs || 1500, 60000)));
    }
  }
};
const countCache = new Map();
state.rememberCount = (jql, total) => countCache.set(jql, {total, time:Date.now()});
state.count = async jql => {
  const cached = countCache.get(jql);
  if (cached && Date.now() - cached.time < 15*60*1000) return cached.total;
  let nextPageToken, total = 0;
  const seen = new Set();
  do {
    const r = await state.search(jql, ['key'], nextPageToken);
    total += r.issues.length;
    if (r.isLast) { state.rememberCount(jql,total); return total; }
    nextPageToken = r.nextPageToken;
    if (!nextPageToken || seen.has(nextPageToken)) throw new Error('Paginação inconsistente na contagem.');
    seen.add(nextPageToken);
  } while (true);
};
state.versions = async () => {
  const values = [];
  let startAt = 0;
  while (true) {
    const page = await state.request('/api/versions', {startAt});
    const batch = page.values || [];
    values.push(...batch);
    if (page.isLast || (typeof page.total === 'number' && values.length >= page.total)) return values;
    if (!batch.length) throw new Error('Paginação inconsistente nas versões do Jira.');
    startAt += batch.length;
  }
};

const dialog = $('connection-dialog');
$('connection-open').onclick = () => {
  $('backend-url').value = settings.url || '';
  $('jira-email').value = settings.email || '';
  $('jira-token').value = '';
  $('jira-scoped').checked = !!settings.scoped;
  $('jira-writes').checked = !!settings.writes;
  $('jira-worklogs').checked = !!settings.worklogs;
  $('remote-fields').hidden = !!local || !!API_URL;
  $('local-fields').hidden = false;
  $('connection-help').textContent = 'Use sua própria conta Atlassian. As operações no Jira serão feitas em seu nome, conforme suas permissões.';
  $('connection-error').textContent = '';
  dialog.showModal();
};
$('connection-close').onclick = () => dialog.close();
$('connection-clear').onclick = async () => {
  if (!confirm('Sair e apagar os dados e marcações deste painel neste navegador?')) return;
  Object.keys(localStorage).filter(k => k.startsWith(state.storagePrefix)).forEach(k => localStorage.removeItem(k));
  Object.keys(sessionStorage).filter(k => k.startsWith('nimitz-')).forEach(k => sessionStorage.removeItem(k));
  location.href = location.pathname;
};
$('connection-form').onsubmit = async event => {
  event.preventDefault();
  $('connection-submit').disabled = true;
  $('connection-error').textContent = 'Testando conexão…';
  try {
    let backend = location.origin;
    if (!local) {
      const url = new URL(API_URL || $('backend-url').value.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Informe somente o endereço HTTPS do backend, sem caminho.');
      backend = url.origin;
    }
    const candidate = {url:backend,email:$('jira-email').value.trim(),token:$('jira-token').value.trim(),
      scoped:$('jira-scoped').checked,writes:$('jira-writes').checked,worklogs:$('jira-worklogs').checked};
    if (!candidate.token && candidate.email === settings.email && candidate.url === settings.url) candidate.token = settings.token;
    await request('/api/health', undefined, candidate);
    sessionStorage.setItem('nimitz-connection', JSON.stringify(candidate));
    $('jira-token').value = '';
    location.href = location.pathname;
  } catch (error) { $('connection-error').textContent = error.message; }
  finally { $('connection-submit').disabled = false; }
};

if (preview && local) {
  try {
    const r = await fetch('/local/preview');
    if (!r.ok) throw new Error('Prévia não encontrada.');
    const data = await r.json();
    $('estado-replicado').textContent = JSON.stringify({...data, modo:'manual'});
    $('connection-status').textContent = 'Prévia com dados do arquivo · sem gravação no Jira · marcações locais';
  } catch (error) { $('connection-status').textContent = error.message; }
} else if (state.connected) {
  try {
    let health;
    try { health = await request('/api/health'); }
    catch { health = await request('/api/health'); }
    state.writes = health.writes;
    state.worklogWrites = !!health.worklogWrites;
    state.accountId=health.accountId;state.displayName=health.displayName;
    const identity = settings.url + '|' + health.project + '|' + health.accountId;
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
    state.storagePrefix = 'nimitz-user:' + Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('') + ':';
    $('connection-status').textContent = `${health.displayName || settings.email} · versões: ${health.writes ? 'edição habilitada' : 'leitura'} · horas: ${health.worklogWrites ? 'envio habilitado' : 'envio desligado'}`;
  } catch (error) {
    state.connected = false;
    $('connection-status').textContent = error.message;
  }
} else {
  $('connection-status').textContent = 'Sem conexão · configure o Jira para carregar tarefas';
}
const script = document.createElement('script');
script.src = './app.js';
script.onload = () => {
  const button = $('connection-open');
  document.querySelector('#app .topbar').appendChild(button);
  button.hidden = false;
  if(!state.connected && !preview) button.click();
  initializePonto();
  state.refreshOrder();
  setInterval(()=>state.refreshOrder(),30000);
};
script.onerror = () => {
  $('connection-status').textContent = 'Não foi possível carregar o painel. Recarregue a página.';
  $('connection-open').hidden = false;
  dialog.showModal();
};
document.body.appendChild(script);

// Shared manual order; column sorting and filters remain personal views.
const orders = new Map();
let orderSaving = false;
function showOrderStatus(message){
  let element = $('shared-order-status');
  if (!element && $('sel-ordenacao')) {
    element = document.createElement('span');
    element.id='shared-order-status';
    element.style.cssText='font-size:11px;color:#557078;margin-left:8px';
    element.setAttribute('role','status');
    $('sel-ordenacao').parentNode.appendChild(element);
  }
  if(element) element.textContent=message;
}
state.canReorder = () => preview || (!!state.orderView && !!orders.get(state.orderView.person())?.ready && !orderSaving);
state.refreshOrder = async (force=false) => {
  if(preview || !state.connected || !state.orderView || document.hidden || orderSaving || state.orderView.dragging()) return;
  const person=state.orderView.person();
  if(!person || !state.orderView.active()) return;
  const entry=orders.get(person) || {revision:0,ready:false,last:0};
  if(entry.loading || (!force && Date.now()-entry.last < 25000)) return;
  entry.loading=true; entry.last=Date.now(); orders.set(person,entry);
  if(!entry.ready) showOrderStatus('Carregando ordem da equipe…');
  try {
    const data=await state.request('/api/order/get',{person});
    if(state.orderView.dragging() || orderSaving) { entry.last=0; return; }
    const changed=!entry.ready || data.revision!==entry.revision;
    entry.revision=data.revision; entry.ready=true; entry.keys=data.keys;
    if(changed && !state.orderView.dragging() && !orderSaving) state.orderView.apply(person,data.keys);
    if(state.orderView.person()===person) showOrderStatus(data.updatedBy ? 'Ordem compartilhada · '+data.updatedBy : 'Ordem compartilhada · arraste para definir');
  } catch(error) {
    entry.ready=false;
    showOrderStatus('Não foi possível sincronizar a ordem. Tente novamente.');
  } finally { entry.loading=false; }
};
state.saveOrder = async (person,keys) => {
  const entry=orders.get(person);
  if(orderSaving || entry?.loading || !entry?.ready) throw new Error('Aguarde a sincronização da ordem antes de arrastar.');
  orderSaving=true; showOrderStatus('Salvando ordem para a equipe…');
  try {
    const data=await state.request('/api/order/save',{person,keys,revision:entry.revision});
    entry.revision=data.revision; entry.keys=data.keys; entry.last=Date.now();
    state.orderView.apply(person,data.keys);
    showOrderStatus('Ordem salva para a equipe');
  } catch(error) {
    orderSaving=false;
    await state.refreshOrder(true);
    throw error;
  } finally { orderSaving=false; state.orderView.render(); }
};

let pontoFrame=null,pendingTask=null,activeTimer=null;
state.pontoActive=()=>!!document.querySelector('[data-aba="ponto"].on');
state.setPontoActive=active=>{
  if(active&&!pontoFrame){
    const panel=$('painel-ponto');if(!panel)return;
    pontoFrame=document.createElement('iframe');pontoFrame.title='Registro';
    pontoFrame.src='./ponto.html?v=20261105e';pontoFrame.style.cssText='width:100%;height:calc(100vh - 120px);min-height:570px;border:0;border-radius:0 0 12px 12px;background:transparent';
    panel.appendChild(pontoFrame);
  }
};
state.pontoReady=()=>{
  if(pendingTask&&pontoFrame?.contentWindow?.pontoSelectTask){pontoFrame.contentWindow.pontoSelectTask(pendingTask);pendingTask=null;}
};
state.updatePontoTimer=timer=>{activeTimer=timer;state.pontoRunning=!!timer?.running;paintTimerBadge();};
function paintTimerBadge(){
  const badge=$('ponto-timer-badge');if(!badge)return;
  badge.hidden=!activeTimer?.running;
  if(activeTimer?.running){
    const seconds=Math.max(0,Math.floor((Date.now()-activeTimer.start)/1000));
    badge.textContent=Math.floor(seconds/3600)+':'+String(Math.floor(seconds/60)%60).padStart(2,'0');
    badge.title='Cronômetro ativo: '+(activeTimer.issue||activeTimer.summary||'tarefa');
  }
}
function initializePonto(){
  // Restore a running timer even when the user opens another tab first.
  if(state.connected&&!preview) state.setPontoActive(true);
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-ponto-key]');if(!target)return;
    event.preventDefault();event.stopPropagation();pendingTask=target.dataset.pontoKey;
    document.querySelector('[data-aba="ponto"]').click();state.pontoReady();
  });
  setInterval(paintTimerBadge,1000);
}
