(function(){
  // conector "Atlassian MCP" (o antigo "Atlassian" foi desinstalado do site em out/2026). Worklog vai por executeWrite/executeRead.
  const JIRA = "Atlassian MCP";
  const CLOUD = "b714d0fb-548f-402c-b3a9-52f92cca708b";
  const SITE = "https://nimitz.atlassian.net/browse/";
  const PREFIX = "NMTZ";
  const DOW = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const MON = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

  const PALETTE = ["#2f80c9","#0e9f7a","#c7861a","#8a5cc7","#d0533c","#4f8f3a","#c24d8a","#3b9bb0","#7d7a36","#6e7f91"];
  const DEFAULT_CATS = [];
  let categories = DEFAULT_CATS.slice();
  let db=null, mcp=null, entries=[], timer=null, settings={autoSend:false};
  // allEntries guarda também os excluídos com worklog no Jira (marca deleted), para a busca no Jira não trazê-los de volta
  let allEntries=[];
  const alive = e => !e.deleted;
  // cada pessoa grava em data/users/<id>/...; a equipe lê tudo (regras do db)
  let uid=null, members=[], team={}, teamSubs={}, names={};
  // cada conta Atlassian é uma pessoa; a identidade vem do Jira, pelo Worker
  let memberDocs = {}, mySubs = [];
  const entriesCol = u => db.doc("data/users/"+u+"/profile").collection("entries");
  const myEntries = () => entriesCol(uid);
  const myTimer = () => db.doc("data/users/"+uid+"/timer");
  const mySettings = () => db.doc("data/users/"+uid+"/settings");
  const myKey = () => uid;
  const personName = k => { const n = names[k] || (memberDocs[k]&&memberDocs[k].name) || "Alguém da equipe"; return k===uid ? n+" (você)" : n; };
  const LS = k => window.pontoApi.storagePrefix+"ponto."+k;
  function lsGet(k){ try{ return localStorage.getItem(LS(k)); }catch(_){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(LS(k), v); }catch(_){} }
  let weekStart = mondayOf(new Date());
  let editing = null; // id ou "new"
  let confirmDel = null;
  const local = {};      // id -> {sending, msg, msgKind}
  const summaries = {};  // KEY -> summary
  let issueTimer=null, lastLookup="";

  const $ = id => document.getElementById(id);
  const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const pad = n => String(n).padStart(2,"0");

  function mondayOf(d){const x=new Date(d);x.setHours(0,0,0,0);const w=(x.getDay()+6)%7;x.setDate(x.getDate()-w);return x;}
  function dayKey(ms){const d=new Date(ms);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
  function hm(ms){const m=Math.round(ms/60000);return Math.floor(m/60)+"h "+pad(m%60)+"m";}
  function hms(ms){const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/3600)+":"+pad(Math.floor(s/60)%60)+":"+pad(s%60);}
  function hhmm(ms){const d=new Date(ms);return pad(d.getHours())+":"+pad(d.getMinutes());}
  function jiraSpent(ms){let m=Math.max(1,Math.round(ms/60000));const h=Math.floor(m/60);m%=60;return (h?h+"h":"")+(h&&m?" ":"")+(m?m+"m":"");}
  function isoJira(ms){const d=new Date(ms);const off=-d.getTimezoneOffset(),a=Math.abs(off);
    return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds())+".000"+(off>=0?"+":"-")+pad(Math.floor(a/60))+pad(a%60);}
  function normKey(v){v=String(v||"").trim().toUpperCase().replace(/\s+/g,"");if(/^\d+$/.test(v))return PREFIX+"-"+v;return v;}
  const validKey = k => /^[A-Z][A-Z0-9]+-\d+$/.test(k);

  /* ---------- Categorias ---------- */
  const catById = id => categories.find(c=>c.id===id);
  function catName(en){ const c = en.category && catById(en.category); return c ? c.name : (en.categoryName||""); }
  function catColor(en){ const c = en.category && catById(en.category); return c ? c.color : "var(--muted)"; }
  function catOptions(sel){
    return `<option value="">Sem categoria</option>` + categories.map(c=>`<option value="${esc(c.id)}"${c.id===sel?" selected":""}>${esc(c.name)}</option>`).join("");
  }
  function paintCats(){
    const cur = $("catIn").value || (timer&&timer.running?timer.category:"") || "";
    $("catIn").innerHTML = catOptions(cur) + `<option value="__new">＋ Nova categoria…</option>`;
    $("catIn").value = catById(cur) ? cur : "";
    if($("taskCat")){ const tc=$("taskCat").value; $("taskCat").innerHTML = catOptions(tc); }
    $("catList").innerHTML = categories.length ? categories.map(c=>`<div class="ci"><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span>${c.builtin?`<small>padrão</small>`:`<button class="icon" title="Remover ${esc(c.name)}" data-delcat="${esc(c.id)}">${ICON.del}</button>`}</div>`).join("") : `<div class="sub">Nenhuma categoria ainda. Crie a primeira abaixo.</div>`;
  }
  async function saveCats(){ if(db) await db.doc("state/categories").set({list:categories}); }
  $("catAdd").addEventListener("submit", async e=>{
    e.preventDefault();
    const name = $("catName").value.trim(); $("catErr").textContent="";
    if(!name) return;
    if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){ $("catErr").textContent="Já existe uma categoria com esse nome."; return; }
    const id = "c"+Date.now().toString(36);
    categories = categories.concat([{id,name,color:PALETTE[categories.length%PALETTE.length]}]);
    $("catName").value="";
    paintCats(); $("catIn").value=id; $("catIn").dispatchEvent(new Event("change"));
    try{ await saveCats(); }catch(err){ $("catErr").textContent="Não foi possível salvar a categoria."; }
  });
  $("catIn").addEventListener("change",()=>{
    if($("catIn").value==="__new"){ $("catIn").value=(timer&&timer.running&&timer.category)||""; $("catName").focus(); $("catName").scrollIntoView({block:"center",behavior:"smooth"}); return; }
    if(timer&&timer.running&&db){ timer.category=$("catIn").value; myTimer().update({category:timer.category}).catch(()=>{}); }
  });

  /* ---------- Tarefas internas ---------- */
  let tasks = [];
  const taskById = id => tasks.find(t=>t.id===id);
  const taskByName = v => { const f = fold(v); return f ? tasks.find(t=>fold(t.name)===f) : undefined; };
  const gk = e => e.task ? "t:"+e.task : e.issue;
  const labelOf = e => e.task ? ((taskById(e.task)||{}).name || e.taskName || e.summary || "Tarefa interna") : e.issue;
  const jiraOf = e => e.task ? ((taskById(e.task)||{}).jira || e.jiraIssue || "") : e.issue;
  const subOf = e => e.task ? (jiraOf(e) ? "Tarefa interna · horas em "+jiraOf(e) : "Tarefa interna") : (e.summary||"");
  function keyHtml(e, style){
    return e.task ? `<span class="key internal"${style?` style="${style}"`:""} title="Tarefa interna">${esc(labelOf(e))}</span>`
      : `<a class="key"${style?` style="${style}"`:""} href="${SITE}${esc(e.issue)}" target="_blank" rel="noopener">${esc(e.issue)}</a>`;
  }
  function parseTarget(v){ const t = taskByName(v); if(t) return {task:t.id}; const k = normKey(v); return validKey(k) ? {key:k} : null; }
  function paintTasks(){
    const ts=$("summaryHint"), first=ts.options[0]?ts.options[0].textContent:"Digite a issue ou escolha uma tarefa interna";
    ts.innerHTML = `<option value="">${esc(first)}</option>` + (tasks.length?`<optgroup label="Tarefas internas">${tasks.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</optgroup>`:"") + `<option value="__new">＋ Nova tarefa interna…</option>`;
    setTask(first.startsWith("Digite")||first.startsWith("Issue do Jira")?"":first);
    $("taskOptions").innerHTML = tasks.map(t=>`<option value="${esc(t.name)}"></option>`).join("");
    const cur = $("taskCat").value;
    $("taskCat").innerHTML = catOptions(cur);
    $("taskList").innerHTML = tasks.length ? tasks.map(t=>{ const c = catById(t.category);
      return `<div class="ci"><i style="background:${esc(c?c.color:"var(--line)")}"></i><span>${esc(t.name)}</span><small>${esc(t.jira||"só aqui")}${c?" · "+esc(c.name):""}</small><button class="icon" title="Remover ${esc(t.name)}" data-deltask="${esc(t.id)}">${ICON.del}</button></div>`; }).join("")
      : `<div class="sub">Nenhuma tarefa ainda. Crie as fixas, como Daily ou Reunião avulsa.</div>`;
  }
  async function saveTasks(){ if(db) await db.doc("state/tasks").set({list:tasks}); }
  $("taskAdd").addEventListener("submit", async e=>{
    e.preventDefault(); $("taskErr").textContent="";
    const name = $("taskName").value.trim(); if(!name) return;
    if(validKey(normKey(name))){ $("taskErr").textContent="Esse nome parece uma issue. Use um nome como Daily."; return; }
    if(taskByName(name)){ $("taskErr").textContent="Já existe uma tarefa com esse nome."; return; }
    let jira = $("taskJira").value.trim();
    if(jira){ jira = normKey(jira); if(!validKey(jira)){ $("taskErr").textContent="Issue inválida. Use NMTZ-12345 ou só o número."; return; } }
    tasks = tasks.concat([{id:"t"+Date.now().toString(36), name, category:$("taskCat").value||"", jira}]);
    $("taskName").value=""; $("taskJira").value=""; $("taskCat").value="";
    paintTasks(); render();
    try{ await saveTasks(); }catch(_){ $("taskErr").textContent="Não foi possível salvar a tarefa."; }
  });

  // tira o texto útil da resposta do Jira ({"errorMessages":[...]})
  function jiraDetail(e){
    const raw = String((e&&e.message)||"").replace(/\\"/g,'"');
    const m = raw.match(/"errorMessages"\s*:\s*\[(.*?)\]/);
    const list = m ? m[1].split('","').map(x=>x.replace(/^"|"$/g,"").trim()).filter(Boolean) : [];
    const perm = /permiss|permission/i.test(raw);
    const w = list.map(x=>x.match(/^(.+?), voc[eê] n[aã]o tem permiss/i)).find(Boolean);
    return {list, perm, who: w ? w[1] : ""};
  }
  function mcpMsg(e, isWrite){
    switch(e && e.status===401 ? "auth" : e&&e.code){
      case "auth": return "Sua conexão com o Jira expirou ou foi recusada. Abra Conexão no painel e entre de novo.";
      case "approval_required": return "O envio precisa da sua aprovação. Clique em enviar de novo e aprove.";
      case "blocked_by_policy": return "A política da organização bloqueia essa chamada ao Jira.";
      case "tool_error": { const j = jiraDetail(e);
        if(j.perm) return `O usuário do Jira desta conta${j.who?" ("+j.who+")":""} não tem permissão para registrar trabalho nesta issue. Peça ao administrador do Jira a permissão “Registrar trabalho” no projeto.`;
        return "Jira recusou: "+(j.list.length ? j.list.join(" ") : String(e.message||"erro sem mensagem").slice(0,200)); }
      case "server_unavailable": case "upstream_error":
        return isWrite ? "Sem resposta do Jira. Confira na issue se o worklog entrou antes de reenviar." : "Jira sem resposta agora; tente de novo em instantes.";
      case "not_granted": case "capability_disabled": case "capability_removed": return "Conexão com o Jira indisponível nesta visualização.";
      default: return (e&&e.message)||"Falha ao falar com o Jira.";
    }
  }

  /* ---------- Jira ---------- */
  const info = {}; // KEY -> {summary, type}
  async function lookup(key){
    if(info[key]) return info[key].summary;
    if(!mcp) return summaries[key]||null;
    const r = await mcp.callTool(JIRA,"getJiraIssue",{cloudId:CLOUD,issueIdOrKey:key},{cache:{staleTime:300000,gcTime:86400000}});
    const p = r.payload||{};
    if(p.context && p.context.atlassianAccountId) connAcc = p.context.atlassianAccountId;
    const n = p.issues && p.issues.nodes && p.issues.nodes[0];
    const s = n && n.fields ? n.fields.summary : null;
    if(s){ info[key]={summary:s,type:(n.fields.issuetype&&n.fields.issuetype.name)||""}; summaries[key]=s; return s; }
    return null;
  }
  // categoria com o mesmo nome do tipo da issue no Jira (Melhoria, Bug...)
  const fold = v => String(v||"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toLowerCase();
  function catForIssue(key){ const t = info[key] && info[key].type; if(!t) return ""; const c = categories.find(c=>fold(c.name)===fold(t)); return c ? c.id : ""; }
  async function autoCatFor(key){ try{ await lookup(key); }catch(_){ return ""; } return catForIssue(key); }
  let catWasAuto = false;

  // lançamento gravado sem o nome da issue (Jira fora do ar na hora): busca de novo e grava.
  // Tenta sozinho ao carregar, quando a conexão volta e a cada 2 min; "Buscar nome no Jira" na linha força na hora.
  const fixTried = {}; let fixing = null;
  const noName = () => entries.filter(e=>!e.task && e.issue && !e.summary);
  async function fillMissing(now, only){
    if(!db || !mcp) return {err:{code:"not_granted"}};
    if(fixing){ await fixing; if(!only) return {}; }
    const keys = [...new Set(noName().map(e=>e.issue))].filter(k=>only ? k===only : (now || Date.now()-(fixTried[k]||0) > 120000));
    if(!keys.length) return {};
    const col = myEntries(), k0 = myKey(), res = {};
    fixing = (async ()=>{
      for(const key of keys){
        fixTried[key] = Date.now();
        let s = summaries[key] || null;
        if(!s){ try{ s = await lookup(key); }catch(e){ res.err = e; continue; } }
        if(!s){ res.notFound = true; continue; }
        if(myKey()!==k0) return;
        for(const e of noName().filter(e=>e.issue===key)){
          const patch = {summary:s};
          // categoria pelo tipo só se o worklog ainda não foi pro Jira (lá ela vira o comentário)
          const w = (e.worklog||{}).status;
          if(!e.category && w!=="sent" && w!=="manual"){ const c = catForIssue(key); if(c){ patch.category = c; patch.categoryName = (catById(c)||{}).name||""; } }
          try{ await col.doc(e.id).update(patch); }catch(_){}
        }
      }
    })();
    try{ await fixing; } finally { fixing = null; }
    return res;
  }
  setInterval(()=>{ if(noName().length) fillMissing(); }, 120000);
  window.addEventListener("online", ()=>fillMissing(true));
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible" && noName().length) fillMissing(true); });

  async function sendWorklog(en){
    if(!window.pontoApi.worklogWrites){ local[en.id]={msg:"Habilite o envio de horas em Conexão para registrar no Jira.",msgKind:"warn"}; render(); return; }
    if(!mcp){ local[en.id]={msg:"Conexão com o Jira indisponível nesta visualização.",msgKind:"err"}; render(); return; }
    if(!en.end) return;
    const target = jiraOf(en); if(!target) return;
    const wl = en.worklog||{};
    if(wl.status==="sent" && !wl.dirty) return;
    const col = myEntries();
    local[en.id]={sending:true}; render();
    const input = {entryId:en.id,cloudId:CLOUD,issueIdOrKey:target,timeSpent:jiraSpent(en.end-en.start),started:isoJira(en.start)};
    const comment = catName(en);
    if(comment) { input.comment = comment; input.contentFormat = "markdown"; }
    if(wl.status==="sent" && wl.dirty && wl.id) input.worklogId = String(wl.id);
    try{
      const {cloudId, ...inputs} = input;
      const r = await mcp.callTool(JIRA,"executeWrite",{name:"addOrEditJiraIssueWorklog",cloudId,inputs});
      const p = r.payload||{}, d = p.data||p;
      const id = d.id || d.worklogId || (d.worklog&&d.worklog.id) || wl.id || null;
      local[en.id]={};
      await col.doc(en.id).update({worklog:{status:"sent",id:id,sentAt:Date.now(),spent:input.timeSpent,dirty:false,error:null}});
    }catch(e){
      const ambiguous = e && (e.code==="server_unavailable"||e.code==="upstream_error"||e.code==="cancelled");
      local[en.id]={msg:mcpMsg(e,true),msgKind:ambiguous?"warn":"err"};
      try{ await col.doc(en.id).update({worklog:Object.assign({},wl,{status:ambiguous?"check":"error",error:mcpMsg(e,true)})}); }catch(_){}
      render();
      if(e && e.code==="tool_error" && jiraDetail(e).perm){
        if(settings.autoSend){ settings.autoSend=false; $("autoSend").checked=false; mySettings().set(Object.assign({},settings,{autoSend:false})).catch(()=>{}); }
        showBanner("Envio automático ao Jira desligado: o usuário do Jira desta conta não tem permissão para registrar trabalho. Os lançamentos continuam salvos aqui; peça a permissão ou use “Lançar no Jira”.",undefined,12000);
        return "perm";
      }
    }
  }

  /* ---------- Cronômetro ---------- */
  function setIssueHint(key, text, bad){ const h=$("issueHint"); h.textContent=text; h.classList.toggle("bad",!!bad); }
  // o campo Tarefa mostra o nome da issue (1ª opção) ou a tarefa interna escolhida
  function setTask(text, idle){
    const el=$("summaryHint");
    const tkId = (timer&&timer.running) ? (timer.task||"") : ((taskByName($("issueIn").value)||{}).id||"");
    el.options[0].textContent = tkId ? "Issue do Jira (digite ao lado)" : (text || "Digite a issue ou escolha uma tarefa interna");
    el.value = taskById(tkId) ? tkId : "";
    el.classList.toggle("idle", !el.value && (!!idle || !text));
    el.title = el.value ? labelOf({task:el.value}) : (text||"");
  }
  $("summaryHint").addEventListener("change",()=>{
    const el=$("summaryHint"), v=el.value;
    if(v==="__new"){ setTask(""); $("taskName").focus(); $("taskName").scrollIntoView({block:"center",behavior:"smooth"}); return; }
    if(!v){ if(!(timer&&timer.running) && taskByName($("issueIn").value)){ $("issueIn").value=""; } onIssueInput(); $("issueIn").focus(); return; }
    const tk=taskById(v); if(!tk) return;
    if(timer&&timer.running){ if(timer.task!==tk.id){ $("issueIn").value=tk.name; $("catIn").value=""; start("","",undefined,tk.id); } return; }
    $("issueIn").value=tk.name; onIssueInput();
  });
  function onIssueInput(){
    const raw = $("issueIn").value, tk = taskByName(raw);
    const key = normKey(raw);
    $("playBtn").disabled = !(tk || validKey(key)) && !(timer&&timer.running);
    clearTimeout(issueTimer);
    if(tk){
      setIssueHint("", tk.jira ? "Tarefa interna · horas em "+tk.jira : "Tarefa interna · fica só aqui");
      setTask(tk.name);
      if(!(timer&&timer.running)){
        if(tk.category && catById(tk.category)){ $("catIn").value = tk.category; catWasAuto = true; }
        else if(catWasAuto){ $("catIn").value = ""; catWasAuto = false; }
      }
      return;
    }
    if(!validKey(key)){ setIssueHint(key, raw? "Use NMTZ-12345, só o número ou o nome de uma tarefa interna":"Issue ou tarefa interna", !!raw); setTask(""); return; }
    setIssueHint(key, key);
    if(summaries[key]) setTask(summaries[key]);
    issueTimer = setTimeout(async ()=>{
      if(lastLookup===key) return; lastLookup=key;
      if(!summaries[key]) setTask("Buscando no Jira…",true);
      try{ const s = await lookup(key); if(normKey($("issueIn").value)!==key) return;
        setTask(s || "Issue não encontrada no Jira", !s);
        if(!(timer&&timer.running)){
          const c = catForIssue(key);
          if(c){ $("catIn").value = c; catWasAuto = true; }
          else if(catWasAuto){ $("catIn").value = ""; catWasAuto = false; }
        } }
      catch(e){ if(normKey($("issueIn").value)===key) setTask(mcpMsg(e,false),true); lastLookup=""; }
    },450);
  }

  // "HH:MM" de hoje -> ms; null se vazio
  function timeToday(v){ if(!v) return null; const [h,m]=v.split(":").map(Number); const d=new Date(); d.setHours(h,m,0,0); return d.getTime(); }
  function startProblem(ms){
    if(ms==null) return "";
    if(ms > Date.now()) return "Horário no futuro";
    const lastEnd = entries.reduce((mx,e)=>Math.max(mx,e.end||0),0);
    if(lastEnd && ms < lastEnd && dayKey(lastEnd)===dayKey(ms)) return "Antes do fim do último registro ("+hhmm(lastEnd)+")";
    return "";
  }

  async function start(key, desc, category, taskId){
    if(!db) return;
    const wasRunning = !!(timer && timer.running);
    if(wasRunning) await stop();
    const chosen = wasRunning ? null : timeToday($("startIn").value);
    const prob = startProblem(chosen);
    if(prob){ $("startHint").textContent = prob; $("startField").classList.add("adjusted"); return; }
    const now = chosen ?? Date.now();
    const tk = taskId ? taskById(taskId) : null;
    let summary = tk ? tk.name : (summaries[key]||"");
    let cat = category!==undefined ? category : ($("catIn").value==="__new"?"":$("catIn").value);
    if(tk && !cat && tk.category && catById(tk.category)) cat = tk.category;
    timer = {running:true, issue:tk?"":key, task:tk?tk.id:"", summary, start:now, category:cat||""};
    paintTimer();
    await myTimer().set(timer);
    if(!tk) autoCatFor(key).then(c=>{
      if(!(timer && timer.running && timer.issue===key)) return;
      const patch = {};
      if(!timer.summary && summaries[key]) patch.summary = timer.summary = summaries[key];
      if(c && !timer.category){ patch.category = timer.category = c; $("catIn").value = c; }
      if(Object.keys(patch).length) myTimer().update(patch).catch(()=>{});
    });
  }
  async function stop(){
    if(!db || !timer || !timer.running) return;
    const t = timer, end = Date.now();
    timer = {running:false}; paintTimer();
    if(end - t.start < 60000){
      await myTimer().set({running:false});
      $("issueIn").value=""; $("startIn").value=""; onIssueInput(); paintTimer();
      setIssueHint("", "Menos de 1 minuto: não foi registrado");
      return;
    }
    const ref = myEntries().doc("timer_"+String(t.start));
    const catId = ($("catIn").value && $("catIn").value!=="__new") ? $("catIn").value : (t.category||"");
    const c = catById(catId);
    const tk = t.task ? taskById(t.task) : null;
    const en = {issue:t.task?"":t.issue, task:t.task||"", taskName:tk?tk.name:(t.task?t.summary:""), jiraIssue:tk?(tk.jira||""):"",
      summary:t.task?"":(t.summary||summaries[t.issue]||""), category:catId, categoryName:c?c.name:"", start:t.start, end, worklog:{status:"pending"}};
    await ref.set(en);
    await myTimer().set({running:false});
    $("issueIn").value=""; $("startIn").value=""; if(catWasAuto){ $("catIn").value=""; catWasAuto=false; } onIssueInput(); paintTimer();
    if(settings.autoSend && window.pontoApi.worklogWrites && jiraOf(en)) sendWorklog(Object.assign({id:ref.id},en));
  }

  function paintTimer(){
    const run = !!(timer&&timer.running);
    window.pontoApi.updatePontoTimer?.(timer);
    $("timer").classList.toggle("running",run);
    const b=$("playBtn"); b.classList.toggle("stop",run); b.setAttribute("aria-label",run?"Parar":"Iniciar");
    $("playIcon").innerHTML = run ? '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>' : '<path d="M8 5.5v13l11-6.5z"/>';
    if(run){
      if(document.activeElement!==$("issueIn")) $("issueIn").value = timer.task ? labelOf(timer) : timer.issue;
      setTask(timer.task ? labelOf(timer) : (timer.summary || summaries[timer.issue] || ""));
      setIssueHint(timer.issue, "Contando desde "+hhmm(timer.start));
      if(document.activeElement!==$("catIn") && catById(timer.category||"")!==undefined) $("catIn").value = timer.category||"";
      else if(document.activeElement!==$("catIn") && !timer.category) $("catIn").value = "";
      if(document.activeElement!==$("startIn")){ $("startIn").value = hhmm(timer.start); }
      $("startHint").textContent = "Esqueceu? Ajuste o início";
      $("startField").classList.remove("adjusted");
      b.disabled=false;
    } else {
      b.disabled = !parseTarget($("issueIn").value);
      const v = $("startIn").value;
      $("startHint").textContent = v ? "Vai começar às "+v : "Início: agora";
      $("startField").classList.toggle("adjusted", !!v);
    }
    tick();
  }

  $("startIn").addEventListener("change", async ()=>{
    const ms = timeToday($("startIn").value);
    if(!(timer&&timer.running)){ const p=startProblem(ms); paintTimer(); if(p){ $("startHint").textContent=p; } return; }
    if(ms==null){ $("startIn").value = hhmm(timer.start); return; }
    // se o horário ficou depois de agora, entende que começou ontem (passou da meia-noite)
    let v = ms; if(v > Date.now()) v -= 864e5;
    if(Date.now()-v > 16*3600e3){ $("startHint").textContent="Mais de 16h atrás; confira"; $("startIn").value=hhmm(timer.start); return; }
    timer.start = v; tick(); render();
    try{ await myTimer().update({start:v}); $("startHint").textContent="Início ajustado para "+hhmm(v); }
    catch(_){ $("startHint").textContent="Não foi possível ajustar"; }
  });
  function tick(){
    const run = !!(timer&&timer.running);
    window.pontoApi.updatePontoTimer?.(timer);
    $("clock").textContent = run ? hms(Date.now()-timer.start) : "0:00:00";
    document.title = run ? hms(Date.now()-timer.start)+" · "+(timer.task?labelOf(timer):timer.issue) : "Registro";
  }
  setInterval(tick,1000);

  $("issueIn").addEventListener("input",onIssueInput);
  $("issueIn").addEventListener("blur",()=>{ if(taskByName($("issueIn").value)) return; const k=normKey($("issueIn").value); if(validKey(k)) $("issueIn").value=k; });
  $("issueIn").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("playBtn").click(); }});
  $("playBtn").addEventListener("click",()=>{
    if(timer&&timer.running){ stop(); return; }
    const tg = parseTarget($("issueIn").value); if(!tg) return;
    if(tg.task){ $("issueIn").value = taskById(tg.task).name; start("","",undefined,tg.task); }
    else { $("issueIn").value=tg.key; start(tg.key,""); }
  });
  $("timer").addEventListener("keydown",e=>{ if(e.key==="Enter" && e.target.id==="startIn"){ e.preventDefault(); $("startIn").dispatchEvent(new Event("change")); }});

  /* ---------- Semana ---------- */
  $("prevWk").onclick=()=>{weekStart=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()-7);editing=null;render();};
  $("nextWk").onclick=()=>{weekStart=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+7);editing=null;render();};
  $("thisWk").onclick=()=>{weekStart=mondayOf(new Date());editing=null;render();};
  $("addManual").onclick=()=>{ editing="new"; render(); const el=document.querySelector('[data-edit="new"] input'); el&&el.focus(); };
  $("autoSend").onchange=async e=>{ settings.autoSend=e.target.checked; if(db) try{ await mySettings().set({autoSend:settings.autoSend}); }catch(_){} };
  $("sendAll").onclick=async()=>{
    const pend = weekEntries().filter(x=>x.end && jiraOf(x) && (!x.worklog || x.worklog.status==="pending" || x.worklog.status==="error" || (x.worklog.status==="sent"&&x.worklog.dirty&&x.worklog.id)));
    for(const en of pend){ if(await sendWorklog(en)==="perm") break; }
  };

  function weekEntries(){
    const a=weekStart.getTime(), b=a+7*864e5;
    return entries.filter(e=>e.start>=a && e.start<b);
  }

  function statusPill(en){
    const L = local[en.id]||{};
    if(!jiraOf(en)) return '<span class="pill pending" title="Tarefa interna sem issue do Jira vinculada">Só aqui</span>';
    if(L.sending) return '<span class="pill pending">Enviando…</span>';
    const w = en.worklog||{status:"pending"};
    if(w.status==="manual") return w.dirty ? `<span class="pill check" title="Editado depois de lançar; ajuste o registro direto no Jira">Ajustar no Jira</span>`
      : `<span class="pill sent" title="Lançado manualmente em ${w.sentAt?new Date(w.sentAt).toLocaleString("pt-BR"):""} como ${esc(w.spent||"")}">Lançado</span>`;
    if(w.status==="sent" && w.dirty) return w.id ? `<button class="pill check" data-send="${esc(en.id)}" title="Editado depois do envio. Clique para atualizar o worklog no Jira">Atualizar Jira</button>` : `<span class="pill check" title="Editado depois do envio; ajuste o worklog direto no Jira">Ajustar no Jira</span>`;
    if(w.status==="sent") return `<span class="pill sent" title="Enviado ${w.sentAt?new Date(w.sentAt).toLocaleString("pt-BR"):""} como ${esc(w.spent||"")}">No Jira</span>`;
    if(w.status==="check") return `<button class="pill check" data-send="${esc(en.id)}" title="${esc(w.error||"")}">Verificar</button>`;
    if(w.status==="error") return `<button class="pill err" data-send="${esc(en.id)}" title="${esc(w.error||"")}">Erro · reenviar</button>`;
    return `<button class="pill pending" data-send="${esc(en.id)}" title="Enviar como worklog">Enviar</button>`;
  }

  // worklog enviado por esta conta pode ser excluído junto no Jira
  const zeroable = en => !!(en.worklog && en.worklog.id) && en.worklog.status==="sent" && !!jiraOf(en);

  const ICON = {
    play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    del:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>'
  };

  function editForm(en){
    const isNew = !en;
    const base = en || {issue:"",description:"",start:Date.now()-3600e3,end:Date.now()};
    const d = new Date(base.start);
    const dateV = d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
    const id = isNew?"new":en.id;
    return `<form class="edit" data-edit="${id}">
      <label>Issue ou tarefa<input name="issue" list="taskOptions" value="${esc(isNew?"":labelOf(base))}" placeholder="NMTZ-12345 ou tarefa" autocomplete="off" required></label>
      <label>Categoria<select name="category">${catOptions(base.category||"")}</select></label>
      <label>Data<input type="date" name="date" value="${dateV}" required></label>
      <label>Início<input type="time" name="start" value="${hhmm(base.start)}" required></label>
      <label>Fim<input type="time" name="end" value="${hhmm(base.end||Date.now())}" required></label>
      <div class="bar"><span class="err"></span>
        <button type="button" class="btn small" data-cancel>Cancelar</button>
        <button class="btn small primary">${isNew?"Adicionar":"Salvar"}</button></div>
    </form>`;
  }

  function render(){
    const days = $("days");
    const wk = weekEntries();
    const end = new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+6);
    $("wkLabel").textContent = `${weekStart.getDate()} ${MON[weekStart.getMonth()]} – ${end.getDate()} ${MON[end.getMonth()]} ${end.getFullYear()}`;
    const runMs = (timer&&timer.running&&timer.start>=weekStart.getTime()&&timer.start<weekStart.getTime()+7*864e5)?0:0;
    const total = wk.reduce((s,e)=>s+((e.end||Date.now())-e.start),0)+runMs;
    $("wkTotal").textContent = hm(total);
    const pendCount = wk.filter(x=>x.end && jiraOf(x) && (!x.worklog || ["pending","error"].includes(x.worklog.status) || (x.worklog.status==="sent"&&x.worklog.dirty&&x.worklog.id))).length;
    $("sendAll").hidden = !pendCount || !mcp; $("sendAll").textContent = `Enviar ${pendCount} pendente${pendCount>1?"s":""}`;

    // agrupa por dia
    const byDay = {};
    wk.forEach(e=>{ (byDay[dayKey(e.start)] ||= []).push(e); });
    const keys = Object.keys(byDay).sort().reverse();
    let html = "";
    if(editing==="new") html += `<div class="day"><div class="day-h"><span class="d">Novo lançamento</span></div>${editForm(null)}</div>`;
    if(!keys.length && editing!=="new"){
      html += `<div class="empty"><b>Nenhum lançamento nesta semana.</b><br>Digite a issue no topo e aperte play, ou use “Lançamento manual” para registrar um período que já passou.</div>`;
    }
    keys.forEach(k=>{
      const list = byDay[k].sort((a,b)=>b.start-a.start);
      const d = new Date(list[0].start);
      const tot = list.reduce((s,e)=>s+((e.end||Date.now())-e.start),0);
      html += `<div class="day"><div class="day-h"><span class="d">${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}<small>${list.length} lançamento${list.length>1?"s":""}</small></span><span class="r"><span class="mono"><b>${hm(tot)}</b></span></span></div>`;
      list.forEach(en=>{
        const L = local[en.id]||{};
        const w = en.worklog||{};
        if(editing===en.id){ html += editForm(en); return; }
        html += `<div class="row">
          ${keyHtml(en)}
          <div class="what"><div class="s" title="${esc(subOf(en))}">${subOf(en) ? esc(subOf(en)) : (!en.task ? `<span class="sub">Sem nome · </span><button type="button" class="linkbtn" data-fixsum="${esc(en.issue)}">Buscar nome no Jira</button>` : "—")}</div>${catName(en)?`<div class="dsc"><span class="cat"><i style="background:${esc(catColor(en))}"></i>${esc(catName(en))}</span></div>`:""}</div>
          <div class="when mono">${hhmm(en.start)} – ${en.end?hhmm(en.end):"…"}</div>
          <div class="dur mono">${hm((en.end||Date.now())-en.start)}</div>
          <div class="acts">${statusPill(en)}
            ${confirmDel===en.id
              ? `<button class="btn small danger" data-del-yes="${esc(en.id)}">Excluir</button><button class="btn small" data-del-no>Não</button>`
              : `<button class="icon" title="Continuar esta tarefa" data-resume="${esc(en.id)}">${ICON.play}</button>
                 <button class="icon" title="Editar" data-edit-btn="${esc(en.id)}">${ICON.edit}</button>
                 <button class="icon" title="Excluir" data-del="${esc(en.id)}">${ICON.del}</button>`}
          </div>
          ${L.msg?`<div class="msg ${L.msgKind==="warn"?"warn":L.msgKind==="info"?"info":""}">${esc(L.msg)}</div>`:(w.status==="error"&&w.error?`<div class="msg">${esc(w.error)}</div>`:"")}
          ${confirmDel===en.id && (w.status==="sent" || w.id) ?`<div class="msg warn">${zeroable(en) ? "Este lançamento será excluído também do Jira. Esta ação não pode ser desfeita pelo painel." : "Já está no Jira. Excluir aqui não remove o registro de lá; ajuste direto no Jira."}</div>`:""}
        </div>`;
      });
      html += `</div>`;
    });
    days.innerHTML = html;

    // barras por dia
    let bars=""; const totals=[];
    for(let i=0;i<7;i++){ const ds=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+i); totals.push([ds,(byDay[dayKey(ds.getTime())]||[]).reduce((s,e)=>s+((e.end||Date.now())-e.start),0)]); }
    const max = Math.max(8*3600e3, ...totals.map(t=>t[1]));
    totals.forEach(([ds,ms])=>{ const h=Math.round(ms/max*80);
      bars += `<div class="c"><span class="v">${ms?(ms/3600e3).toFixed(1).replace(".",","):""}</span><div class="b ${ms?"":"zero"}" style="height:${Math.max(h,2)}px" title="${hm(ms)}"></div><span class="l">${DOW[ds.getDay()]}</span></div>`; });
    $("dayBars").innerHTML = bars;

    // por tarefa
    const by = {};
    wk.forEach(e=>{ const o = by[gk(e)] ||= {ms:0,e,summary:subOf(e)}; o.ms += (e.end||Date.now())-e.start; if(!o.summary) o.summary=subOf(e); });
    const items = Object.entries(by).sort((a,b)=>b[1].ms-a[1].ms);
    $("byIssue").innerHTML = items.length ? items.map(([k,o])=>`<div class="it">${keyHtml(o.e,"color:inherit;text-decoration:none;font-family:var(--f-mono);font-weight:600")}<span class="t">${hm(o.ms)}</span><span class="n" title="${esc(o.summary)}">${esc(o.summary||"")}</span><span class="bar"><i style="width:${Math.round(o.ms/items[0][1].ms*100)}%"></i></span></div>`).join("") : `<div class="sub">Nenhum lançamento nesta semana.</div>`;

    // por categoria
    const bc = {};
    wk.forEach(e=>{ const k = catName(e)||"Sem categoria"; const o = bc[k] ||= {ms:0,color:catName(e)?catColor(e):"var(--line)"}; o.ms += (e.end||Date.now())-e.start; });
    const citems = Object.entries(bc).sort((a,b)=>b[1].ms-a[1].ms);
    $("byCat").innerHTML = citems.length ? citems.map(([k,o])=>`<div class="it"><span class="cat" style="color:var(--ink);font-size:13px"><i style="background:${esc(o.color)}"></i>${esc(k)}</span><span class="t">${hm(o.ms)}</span><span class="bar"><i style="width:${Math.round(o.ms/citems[0][1].ms*100)}%;background:${esc(o.color)}"></i></span></div>`).join("") : `<div class="sub">Nenhum lançamento nesta semana.</div>`;

    // recentes
    const seen = new Set(), rec=[];
    for(const e of entries){ if(!e.task && !seen.has(e.issue)){ seen.add(e.issue); rec.push(e); if(rec.length>=6) break; } }
    $("recent").hidden = !rec.length && !tasks.length;
    $("recent").innerHTML = (tasks.length ? `<span class="lbl">Tarefas</span>`+tasks.map(t=>`<button class="chip task" data-qtask="${esc(t.id)}" title="Iniciar ${esc(t.name)}"><b>${esc(t.name)}</b></button>`).join("") : "")
      + (rec.length ? `<span class="lbl" style="margin-left:${tasks.length?"10px":"0"}">Recentes</span>`+rec.map(e=>`<button class="chip" data-quick="${esc(e.issue)}" title="Iniciar ${esc(e.issue)}"><b>${esc(e.issue)}</b><span>${esc(e.summary||"")}</span></button>`).join("") : "");
  }

  document.addEventListener("click", async ev=>{
    const t = ev.target.closest("button,a"); if(!t) return;
    const find = id => entries.find(e=>e.id===id);
    if(t.dataset.send){ const en=find(t.dataset.send); if(en) sendWorklog(en); }
    else if(t.dataset.fixsum){
      const key=t.dataset.fixsum; t.disabled=true; t.textContent="Buscando…";
      const r = await fillMissing(true, key);
      const msg = r.err ? mcpMsg(r.err,false) : r.notFound ? "Issue "+key+" não encontrada no Jira. Confira o número em Editar." : "";
      entries.filter(e=>e.issue===key && !e.summary).forEach(e=>{ local[e.id] = msg ? {msg, msgKind:"warn", fix:true} : {}; });
      render();
    }
    else if(t.dataset.resume && find(t.dataset.resume) && find(t.dataset.resume).task){
      const en=find(t.dataset.resume);
      if(!taskById(en.task)){ local[en.id]={msg:"Essa tarefa interna foi removida. Crie de novo para continuar.",msgKind:"warn"}; render(); return; }
      $("issueIn").value=labelOf(en); $("catIn").value=catById(en.category)?en.category:""; start("","",catById(en.category)?en.category:"",en.task);
    }
    else if(t.dataset.qtask){ const tk=taskById(t.dataset.qtask); if(tk){ $("issueIn").value=tk.name; $("catIn").value=""; start("","",undefined,tk.id); } }
    else if(t.dataset.deltask){
      const id=t.dataset.deltask;
      if(confirmDel!=="task:"+id){ confirmDel="task:"+id; t.outerHTML=`<button class="btn small danger" data-deltask="${esc(id)}">Remover?</button>`; return; }
      confirmDel=null; tasks=tasks.filter(x=>x.id!==id);
      paintTasks(); render();
      try{ await saveTasks(); }catch(_){ $("taskErr").textContent="Não foi possível remover a tarefa."; }
    }
    else if(t.dataset.resume){ const en=find(t.dataset.resume); if(en){ $("issueIn").value=en.issue; $("catIn").value=catById(en.category)?en.category:""; if(en.summary) summaries[en.issue]=en.summary; start(en.issue,"",catById(en.category)?en.category:""); } }
    else if(t.dataset.quick){ const k=t.dataset.quick; const en=entries.find(e=>e.issue===k); if(en&&en.summary) summaries[k]=en.summary; $("issueIn").value=k; $("catIn").value=""; start(k,""); }
    else if(t.dataset.delcat){
      const id=t.dataset.delcat;
      if(confirmDel!=="cat:"+id){ confirmDel="cat:"+id; t.outerHTML=`<button class="btn small danger" data-delcat="${esc(id)}">Remover?</button>`; return; }
      confirmDel=null; categories=categories.filter(c=>c.id!==id);
      if($("catIn").value===id) $("catIn").value="";
      paintCats(); render();
      try{ await saveCats(); }catch(_){ $("catErr").textContent="Não foi possível remover a categoria."; }
    }
    else if(t.dataset.editBtn){ editing=t.dataset.editBtn; confirmDel=null; render(); }
    else if(t.dataset.del){ confirmDel=t.dataset.del; render(); }
    else if(t.hasAttribute("data-del-no")){ confirmDel=null; render(); }
    else if(t.dataset.delYes){ const id=t.dataset.delYes, en=find(id); confirmDel=null;
      const col = myEntries();
      // o conector não exclui worklog: o enviado por esta conta é reduzido a 1m (mínimo do Jira) e marcado no comentário
      if(en && zeroable(en)){
        if(!mcp){ local[id]={msg:"Conexão com o Jira indisponível; não excluí para não deixar as horas lá.",msgKind:"err"}; render(); return; }
        local[id]={sending:true}; render();
        try{ await window.pontoApi.request("/api/ponto/worklog/delete",{issueIdOrKey:jiraOf(en),worklogId:String(en.worklog.id)}); }
        catch(e){
          if(!(e && e.code==="tool_error" && jiraDetail(e).perm)){ local[id]={msg:"Não excluí: "+mcpMsg(e,true),msgKind:"err"}; render(); return; }
          /* Sem permissão de excluir horas no Jira: o registro é zerado lá e o
             lançamento sai daqui. O Jira não aceita 0, então vai o mínimo (1m),
             marcado no comentário. Se nem isso der, ele fica como estava. */
          const input={issueIdOrKey:jiraOf(en),worklogId:String(en.worklog.id),timeSpent:"1m",started:isoJira(en.start),comment:"Excluído no Ponto"};
          try{ await window.pontoApi.request("/api/ponto/worklog/save",input); }
          catch(e2){ local[id]={msg:"Não excluí: seu usuário do Jira não tem permissão para excluir horas, e não consegui zerar o registro lá ("+mcpMsg(e2,true)+").",msgKind:"err"}; render(); return; }
          showBanner("Seu usuário do Jira não tem permissão para excluir horas: o registro ficou com 1m (mínimo do Jira) e o lançamento saiu daqui.");
        }
        local[id]={};
      }
      // com worklog no Jira fica marcado como excluído; senão a próxima busca no Jira traria de volta
      try{ if(en && en.worklog && en.worklog.id) await col.doc(id).update({deleted:true}); else await col.doc(id).delete(); }catch(e){ local[id]={msg:"Não foi possível excluir: "+(e.message||e.code),msgKind:"err"}; render(); } }
    else if(t.hasAttribute("data-cancel")){ editing=null; render(); }
  });

  // no formulário de lançamento: ao digitar a issue, já marca a categoria pelo tipo
  let formIssueTimer=null;
  document.addEventListener("input", ev=>{
    const inp = ev.target; if(!(inp.name==="issue" && inp.closest("form.edit"))) return;
    const f = inp.closest("form.edit"), sel = f.querySelector('select[name="category"]');
    clearTimeout(formIssueTimer);
    formIssueTimer = setTimeout(async ()=>{
      const tk = taskByName(inp.value);
      if(tk){ if(tk.category && catById(tk.category)){ sel.value = tk.category; sel.dataset.auto = "1"; } else if(sel.dataset.auto){ sel.value=""; delete sel.dataset.auto; } return; }
      const k = normKey(inp.value); if(!validKey(k)) return;
      const c = await autoCatFor(k);
      if(normKey(inp.value)!==k) return;
      if(c){ sel.value = c; sel.dataset.auto = "1"; }
      else if(sel.dataset.auto){ sel.value = ""; delete sel.dataset.auto; }
    },450);
  });
  document.addEventListener("change", ev=>{ if(ev.target.name==="category") delete ev.target.dataset.auto; if(ev.target.id==="catIn") catWasAuto=false; });

  document.addEventListener("submit", async ev=>{
    const f = ev.target.closest("form.edit"); if(!f) return;
    ev.preventDefault();
    const fd = new FormData(f), errEl = f.querySelector(".err");
    const tg = parseTarget(fd.get("issue"));
    if(!tg){ errEl.textContent="Informe uma issue (NMTZ-12345 ou só o número) ou o nome de uma tarefa interna."; return; }
    const tk = tg.task ? taskById(tg.task) : null, issue = tg.key || "";
    const tfields = {task:tk?tk.id:"", taskName:tk?tk.name:"", jiraIssue:tk?(tk.jira||""):""};
    const [y,mo,da] = String(fd.get("date")).split("-").map(Number);
    const [sh,sm] = String(fd.get("start")).split(":").map(Number);
    const [eh,em] = String(fd.get("end")).split(":").map(Number);
    const s = new Date(y,mo-1,da,sh,sm).getTime(); let e = new Date(y,mo-1,da,eh,em).getTime();
    if(e<=s) e += 864e5; // passou da meia-noite
    if(e-s > 16*3600e3){ errEl.textContent="Período maior que 16 horas. Confira início e fim."; return; }
    let category = String(fd.get("category")||"");
    let categoryName = (catById(category)||{}).name||"";
    let summary = tk ? "" : (summaries[issue]||"");
    if(!tk){ try{ summary = (await lookup(issue))||summary; }catch(_){} }
    if(!category){ category = tk ? (catById(tk.category)?tk.category:"") : catForIssue(issue); categoryName = (catById(category)||{}).name||""; }
    try{
      if(f.dataset.edit==="new"){
        await myEntries().add({issue,...tfields,summary,category,categoryName,start:s,end:e,worklog:{status:"pending"}});
      } else {
        const en = entries.find(x=>x.id===f.dataset.edit);
        const sameTarget = gk(en)===(tk?"t:"+tk.id:issue) && jiraOf(en)===(tk?(tk.jira||""):issue);
        const changed = !sameTarget || en.start!==s || en.end!==e || (en.category||"")!==category;
        const patch = {issue,...tfields,summary:tk?"":(summary||en.summary),category,categoryName,start:s,end:e};
        if(changed && en.worklog && (en.worklog.status==="sent" || en.worklog.status==="manual")){
          patch.worklog = Object.assign({},en.worklog,{dirty:true, id: sameTarget ? en.worklog.id : null});
        }
        await myEntries().doc(en.id).update(patch);
      }
      editing=null; render();
    }catch(err){ errEl.textContent="Não foi possível salvar: "+(err.message||err.code); }
  });

  /* ---------- Horas que já estavam no Jira ---------- */
  // Traz os worklogs da pessoa só nas issues que ela já lançou aqui (todas as páginas de cada issue).
  // A pessoa no Jira é sempre a conta conectada.
  const SYNC_EVERY = 6*3600e3;
  const FATAL = ["needs_reauth","server_not_connected","server_not_found","selection_required","not_in_manifest","not_granted","capability_disabled","capability_removed","blocked_by_policy"];
  let jiraMe = {}, syncing = null, connAcc = window.pontoApi.accountId;
  const autoDone = {};
  // categorias e tarefas internas precisam ter chegado, senão o registro entra sem categoria e a tarefa vira issue solta
  let sharedOk = {tasks:false, cats:false}, sharedWait = [];
  function sharedLoaded(which){ sharedOk[which] = true; if(sharedOk.tasks && sharedOk.cats){ sharedWait.forEach(f=>f()); sharedWait = []; } }
  const sharedReady = () => (sharedOk.tasks && sharedOk.cats) ? Promise.resolve() : new Promise(r=>{ sharedWait.push(r); setTimeout(r, 8000); });
  const myJiraDoc = () => db.doc("data/users/"+uid+"/jira");
  function syncMsg(html){ $("jiraSyncMsg").innerHTML = html||""; }
  const parseJiraTime = s => Date.parse(String(s||"").replace(/([+-]\d{2})(\d{2})$/,"$1:$2"));
  function adfText(c){ if(!c) return ""; if(typeof c==="string") return c.trim(); let out=""; (function walk(n){ if(!n) return; if(typeof n.text==="string") out+=n.text; (n.content||[]).forEach(walk); })(c); return out.trim(); }
  async function fetchWorklogs(key){
    // nome/tipo da issue e a conta conectada (context.atlassianAccountId); issue inexistente cai no erro do Jira
    if(!info[key] || !connAcc){ delete info[key]; await lookup(key); }
    const list = [];
    for(let at = 0; ; ){
      const r = await mcp.callTool(JIRA,"executeRead",{name:"listJiraIssueWorklogs",cloudId:CLOUD,inputs:{issueIdOrKey:key,startAt:at,maxResults:100}});
      const p = r.payload||{}, d = p.data||p;
      if(p.context && p.context.atlassianAccountId) connAcc = p.context.atlassianAccountId;
      const page = Array.isArray(d.worklogs) ? d.worklogs : [];
      list.push(...page);
      at += d.scanned ?? page.length;
      if(!(d.scanned ?? page.length) || d.isLast || at >= (d.total||0)) break;
    }
    return {list, cut:false};
  }
  function autoSync(k){
    if(!mcp || autoDone[k] || k!==myKey()) return;
    autoDone[k] = true;
    if(Date.now()-(jiraMe.lastSync||0) > SYNC_EVERY) syncJira(false);
  }
  async function syncJira(manual){
    if(!db || !uid) return;
    if(!mcp){ if(manual) syncMsg("Jira indisponível nesta visualização."); return; }
    if(syncing) return;
    syncing = "wait"; await sharedReady(); syncing = null;
    const k = myKey(), ctx = {k, manual, col:myEntries(), jdoc:myJiraDoc(), mine:allEntries.slice(), me:Object.assign({},jiraMe)};
    // issue do Jira -> lançada direto e/ou por tarefas internas
    const targets = ctx.targets = {};
    ctx.mine.forEach(e=>{ const t = jiraOf(e); if(!t) return; const o = targets[t] ||= {issue:false, tasks:new Set()}; if(e.task) o.tasks.add(e.task); else o.issue = true; });
    if(manual){
      const from=dayKey(weekStart.getTime()),to=dayKey(weekStart.getTime()+7*864e5);
      let cursor=null;
      syncMsg("Procurando suas horas no Jira nesta semana…");
      try{
        do{
          const found=await window.pontoApi.request("/api/ponto/find-worklog-issues",{from,to,cursor});
          found.issues.forEach(issue=>{ targets[issue.key] ||= {issue:true,tasks:new Set()}; if(issue.fields?.summary) summaries[issue.key]=issue.fields.summary; });
          cursor=found.next;
        }while(cursor);
      }catch(error){syncMsg(esc(mcpMsg(error,false)));return;}
    }
    const keys = Object.keys(targets);
    if(!keys.length){ if(manual) syncMsg("Nenhuma issue lançada aqui ainda."); return; }
    syncing = k; $("jiraSync").disabled = true;
    const got = ctx.got = {}, cut = ctx.cut = [], failed = ctx.failed = [];
    let i = 0, done = 0, fatal = "";
    const say = ()=>{ if(myKey()===k) syncMsg("Buscando no Jira… "+done+"/"+keys.length); };
    say();
    async function worker(){
      while(i < keys.length && !fatal){
        const key = keys[i++];
        try{ const r = await fetchWorklogs(key); if(r){ got[key] = r.list; if(r.cut) cut.push(key); } }
        catch(e){ failed.push(key); if(e && (e.status===401 || FATAL.includes(e.code))) fatal = mcpMsg(e,false); }
        done++; say();
      }
    }
    try{ await Promise.all([worker(),worker(),worker()]); }
    finally{ syncing = null; $("jiraSync").disabled = false; }
    if(fatal){ if(myKey()===k) syncMsg(esc(fatal)); return; }
    await resolveAndApply(ctx);
  }
  async function resolveAndApply(ctx){
    if(!connAcc){ if(myKey()===ctx.k) syncMsg("Não consegui identificar o seu usuário no Jira."); return; }
    await applySync(ctx, connAcc);
  }
  $("jiraSync").onclick = ()=>syncJira(true);
  async function applySync(ctx, author){
    const {col, mine, targets, got} = ctx;
    const linked = new Set(mine.filter(e=>e.worklog&&e.worklog.id).map(e=>String(e.worklog.id)));
    const ids = new Set(mine.map(e=>e.id));
    // lançamentos daqui sem worklog ligado (pendentes, "Já lancei", erro): se o Jira tem o mesmo período, só liga
    const free = mine.filter(e=>alive(e) && e.end && !(e.worklog&&e.worklog.id));
    let added = 0, matched = 0, failedW = 0;
    for(const key of Object.keys(got)){
      for(const w of got[key]){
        if(!w || !w.author || w.author.accountId!==author) continue;
        const wid = String(w.id||""); if(!wid || linked.has(wid) || ids.has("jira_"+wid)) continue;
        const s = parseJiraTime(w.started), secs = +w.timeSpentSeconds||0;
        if(!s || !secs) continue;
        const wl = {status:"sent", id:wid, sentAt:parseJiraTime(w.created)||Date.now(), spent:w.timeSpent||jiraSpent(secs*1000), dirty:false, error:null};
        try{
          const mi = free.findIndex(e=>jiraOf(e)===key && Math.abs(e.start-s)<=120000 && Math.abs((e.end-e.start)-secs*1000)<=120000);
          if(mi>=0){ const e = free.splice(mi,1)[0]; await col.doc(e.id).update({worklog:wl}); linked.add(wid); matched++; continue; }
          // id fixo pelo worklog: duas abas buscando ao mesmo tempo gravam o mesmo documento, sem duplicar
          const ref = col.doc("jira_"+wid);
          const ex = await ref.get(); if(ex.exists){ ids.add("jira_"+wid); continue; }
          const t = targets[key] || {issue:true, tasks:new Set()};
          const tk = (!t.issue && t.tasks.size===1) ? taskById([...t.tasks][0]) : null;
          const cmt = fold(adfText(w.comment)), byName = cmt ? categories.find(c=>fold(c.name)===cmt) : null;
          const category = byName ? byName.id : (tk ? (catById(tk.category)?tk.category:"") : catForIssue(key));
          await ref.set({issue:tk?"":key, task:tk?tk.id:"", taskName:tk?tk.name:"", jiraIssue:tk?key:"", summary:tk?"":(summaries[key]||""),
            category, categoryName:(catById(category)||{}).name||"", start:s, end:s+secs*1000, worklog:wl, src:"jira"});
          ids.add("jira_"+wid); added++;
        }catch(_){ failedW++; }
      }
    }
    const meDoc = Object.assign({}, ctx.me, {lastSync:Date.now()});
    delete meDoc.accountId; delete meDoc.name;
    try{ await ctx.jdoc.set(meDoc); }catch(_){}
    if(myKey()!==ctx.k) return;
    let msg = added||matched ? `Jira: ${added} registro${added===1?"":"s"} trazido${added===1?"":"s"}${matched?`, ${matched} ligado${matched===1?"":"s"} a lançamentos daqui`:""}.` : "Jira: nada novo.";
    if(ctx.failed.length) msg += ` Sem resposta para ${esc(ctx.failed.join(", "))}.`;
    if(failedW) msg += ` ${failedW} não puderam ser salvos.`;
    syncMsg(msg);
  }

  /* ---------- Conta ---------- */
  function paintProfiles(){
    $("ponto-user-name").textContent = window.pontoApi.displayName || names[uid] || "Minha conta";
    paintJiraMode();
  }
  function paintJiraMode(){
    $("autoSend").disabled = !window.pontoApi.worklogWrites; $("autoSend").title = window.pontoApi.worklogWrites ? "Enviar ao Jira quando parar" : "Habilite o envio de horas em Conexão";
  }

  // assina cronômetro, lançamentos e preferências da conta
  function subscribeMine(){
    mySubs.forEach(f=>{ try{ f(); }catch(_){} }); mySubs = [];
    entries = []; allEntries = []; timer = {running:false}; settings = {autoSend:false}; editing = null;
    jiraMe = {}; syncMsg("");
    Object.keys(local).forEach(k=>delete local[k]);
    $("issueIn").value = ""; $("startIn").value = "";
    render(); paintTimer(); onIssueInput();
    const k = myKey();
    let gotEntries = false, gotJira = false;
    mySubs.push(myEntries().orderBy("start","desc").onSnapshot(snap=>{
      if(k!==myKey()) return;
      allEntries = snap.docs.map(d=>Object.assign({},d.data(),{id:d.id,_pk:k}));
      entries = allEntries.filter(alive);
      if(!gotEntries){ gotEntries = true; if(gotJira) autoSync(k); }
      entries.forEach(e=>{ if(e.summary && !summaries[e.issue]) summaries[e.issue]=e.summary; if(e.summary && local[e.id] && local[e.id].fix) delete local[e.id]; });
      if(noName().length) fillMissing();
      if(editing && editing!=="new" && !entries.find(e=>e.id===editing)) editing=null;
      if(!document.querySelector("form.edit")) render();
      renderReport();
    }, err=>{ showBanner("Não foi possível carregar os lançamentos ("+err.code+"). Recarregue a página.","err"); }));
    mySubs.push(myTimer().onSnapshot(s=>{ if(k!==myKey()) return; timer = s.exists ? Object.assign({}, s.data()) : {running:false}; paintTimer(); render(); }, ()=>{}));
    mySubs.push(mySettings().onSnapshot(s=>{ if(k!==myKey()) return; settings = Object.assign({autoSend:false}, s.exists ? s.data() : {}); $("autoSend").checked = !!settings.autoSend; }, ()=>{}));
    mySubs.push(myJiraDoc().onSnapshot(s=>{ if(k!==myKey()) return; jiraMe = s.exists ? Object.assign({}, s.data()) : {}; if(!gotJira){ gotJira = true; if(gotEntries) autoSync(k); } }, ()=>{ gotJira = true; }));
    paintJiraMode();
  }

  /* Toda mensagem some sozinha depois de 5 s. */
  let bannerTimer=null;
  function showBanner(text, kind){
    const b=$("banner"); clearTimeout(bannerTimer);
    b.className="banner"+(kind==="err"?" err":""); b.textContent=text; b.hidden=!text;
    if(text) bannerTimer=setTimeout(()=>{ if(b.textContent===text) b.hidden=true; }, 5000);
  }

  /* ---------- Boot ---------- */

  /* ---------- Relatório ---------- */
  let rSort = {by:"total",dir:-1}, rOpen = new Set(), rLastRows = [];
  const DAY = 864e5;
  function dayStart(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(t,n){ const d=new Date(t); return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n).getTime(); }
  function fmtDate(ms){ const d=new Date(ms); return pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+String(d.getFullYear()).slice(2); }
  function inputDate(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function hDec(ms){ return (ms/3600e3).toFixed(2).replace(".",","); }
  function periodRange(){
    const v=$("rPeriod").value, now=new Date(), today=dayStart(now).getTime();
    let a=null, b=null;
    if(v==="week"){ a=mondayOf(now).getTime(); b=addDays(a,7); }
    else if(v==="lastweek"){ b=mondayOf(now).getTime(); a=addDays(b,-7); }
    else if(v==="month"){ a=new Date(now.getFullYear(),now.getMonth(),1).getTime(); b=new Date(now.getFullYear(),now.getMonth()+1,1).getTime(); }
    else if(v==="lastmonth"){ a=new Date(now.getFullYear(),now.getMonth()-1,1).getTime(); b=new Date(now.getFullYear(),now.getMonth(),1).getTime(); }
    else if(v==="30"){ a=addDays(today,-29); b=addDays(today,1); }
    else if(v==="custom"){
      const f=$("rFrom").value, t=$("rTo").value;
      a = f ? new Date(f+"T00:00").getTime() : null; b = t ? addDays(new Date(t+"T00:00").getTime(),1) : null;
    }
    return [a,b];
  }
  const dur = e => (e.end||Date.now())-e.start;
  function rFilter(list){
    const [a,b]=periodRange(), cat=$("rCat").value, q=fold($("rSearch").value);
    const qKey = /^\d+$/.test(q) ? fold(PREFIX+"-"+q) : q;
    return list.filter(e=>{
      if(a!=null && e.start<a) return false;
      if(b!=null && e.start>=b) return false;
      if(cat==="__none" && e.category && catById(e.category)) return false;
      if(cat && cat!=="__none" && e.category!==cat) return false;
      if(q){ const k=fold(labelOf(e)); if(!(k===qKey || (!/^\d+$/.test(q) && k.includes(q)) || fold(e.summary).includes(q) || (e.task && fold(jiraOf(e))===qKey))) return false; }
      return true;
    });
  }

  // a página mantém os 1000 lançamentos mais recentes de cada pessoa; períodos mais antigos são buscados sob demanda
  const rangeCache = {}, rangeBusy = {};
  function listFor(k){ return k===myKey() ? entries : (team[k]||[]); }
  function withRange(k, list){
    const [a,b] = periodRange();
    if(list.length < 1000 || (a!=null && list[list.length-1].start <= a)) return list;
    const ck = k+"|"+a+"|"+b;
    if(rangeCache[ck]){ const ids = new Set(list.map(e=>e.id)); return list.concat(rangeCache[ck].filter(e=>!ids.has(e.id))); }
    if(!rangeBusy[ck] && db){
      rangeBusy[ck] = true;
      let q = entriesCol(k);
      if(a!=null) q = q.where("start",">=",a);
      if(b!=null) q = q.where("start","<",b);
      q.orderBy("start","desc").get().then(sn=>{ rangeCache[ck] = sn.docs.map(x=>Object.assign({},x.data(),{id:x.id,_pk:k})).filter(alive); renderReport(); }).catch(()=>{});
    }
    return list;
  }
  function allKeys(){ const ks = new Set(Object.keys(team)); ks.add(myKey()); return [...ks]; }
  function reportSource(){
    const v = $("rPerson").value;
    if(v==="me") return withRange(myKey(), entries);
    if(v==="all") return [].concat(...allKeys().map(k=>withRange(k, listFor(k))));
    return withRange(v, listFor(v));
  }
  function paintPeople(){
    const sel = $("rPerson"), cur = sel.value;
    const others = allKeys().filter(k=>k!==myKey()).sort((a,b)=>personName(a).localeCompare(personName(b)));
    sel.innerHTML = `<option value="me">Só eu</option><option value="all">Equipe inteira</option>` + others.map(m=>`<option value="${esc(m)}">${esc(personName(m))}</option>`).join("");
    sel.value = [...sel.options].some(o=>o.value===cur) ? cur : "me";
    $("whoAmI").textContent = uid ? (names[uid] ? "Você: "+names[uid] : "") : "";
  }
  function renderReport(){
    if($("viewReport").hidden) return;
    const teamMode = $("rPerson").value==="all";
    const src = reportSource();
    const cur = $("rCat").value;
    $("rCat").innerHTML = `<option value="">Todas</option><option value="__none">Sem categoria</option>`+categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    $("rCat").value = [...$("rCat").options].some(o=>o.value===cur) ? cur : "";
    const list = rFilter(src);
    const [a,b] = periodRange();

    // agrupa por demanda
    const g = {};
    list.forEach(e=>{
      const o = g[gk(e)] ||= {key:gk(e), issue:labelOf(e), e, summary:"", cats:{}, n:0, total:0, first:Infinity, last:0, items:[]};
      if(subOf(e)) o.summary = subOf(e);
      (o.people ||= {})[e._pk] = ((o.people||{})[e._pk]||0) + dur(e);
      const cn = catName(e); if(cn) o.cats[cn]=(o.cats[cn]||0)+dur(e);
      o.n++; o.total+=dur(e); o.first=Math.min(o.first,e.start); o.last=Math.max(o.last,e.end||e.start); o.items.push(e);
    });
    const rows = Object.values(g);
    const s = rSort;
    rows.sort((x,y)=>{
      const v = s.by==="issue" ? x.issue.localeCompare(y.issue,undefined,{numeric:true}) : s.by==="n" ? x.n-y.n : s.by==="last" ? x.last-y.last : x.total-y.total;
      return v*s.dir;
    });
    rLastRows = rows;
    const total = rows.reduce((t,r)=>t+r.total,0);
    const daysWorked = new Set(list.map(e=>dayKey(e.start))).size;

    // destaque quando a busca cai numa demanda só
    if($("rSearch").value.trim() && rows.length===1){
      const r = rows[0];
      const all = src.filter(e=>gk(e)===r.key);
      const allT = all.reduce((t,e)=>t+dur(e),0);
      const firstAll = Math.min(...all.map(e=>e.start));
      $("rFocus").innerHTML = `<div class="focus">${keyHtml(r.e,"font-family:var(--f-mono);font-weight:600;color:var(--accent);font-size:16px;text-decoration:none")}<span class="n">${esc(r.summary||"")}</span>
        <div class="m"><b>${hm(r.total)}</b><span>no período</span></div>
        <div class="m"><b>${hm(allT)}</b><span>total desde ${fmtDate(firstAll)}</span></div>
        <div class="m"><b>${all.length}</b><span>lançamento${all.length>1?"s":""} no total</span></div></div>`;
    } else $("rFocus").innerHTML = "";

    const biggest = rows.slice().sort((x,y)=>y.total-x.total)[0];
    $("rKpis").innerHTML = `
      <div class="kpi"><span class="l">Total</span><span class="v">${hm(total)}</span><span class="s">${hDec(total)} h decimais</span></div>
      <div class="kpi"><span class="l">Demandas</span><span class="v">${rows.length}</span><span class="s">${biggest?"Maior: "+esc(biggest.issue)+" ("+hm(biggest.total)+")":"—"}</span></div>
      <div class="kpi"><span class="l">Lançamentos</span><span class="v">${list.length}</span><span class="s">${list.filter(e=>(e.worklog||{}).status==="sent").length} já no Jira</span></div>
      <div class="kpi"><span class="l">Média por dia trabalhado</span><span class="v">${daysWorked?hm(total/daysWorked):"0h 00m"}</span><span class="s">${daysWorked} dia${daysWorked===1?"":"s"} com registro</span></div>`;

    renderChart(list, a, b);

    const bp = {};
    list.forEach(e=>{ bp[e._pk] = (bp[e._pk]||0) + dur(e); });
    const pItems = Object.entries(bp).sort((x,y)=>y[1]-x[1]);
    $("rPeople").hidden = !teamMode || !pItems.length;
    $("rPeopleList").innerHTML = pItems.map(([id,ms])=>`<div class="it"><span style="font-weight:500">${esc(personName(id))}</span><span class="t">${hm(ms)}</span><span class="bar"><i style="width:${Math.round(ms/pItems[0][1]*100)}%"></i></span></div>`).join("");

    if(!rows.length){
      $("rTable").innerHTML = `<div class="empty" style="border:0">${src.length?"<b>Nada encontrado com esses filtros.</b><br>Mude o período, a categoria ou a busca.":"<b>Ainda não há lançamentos.</b><br>Use o cronômetro e os registros aparecem aqui."}</div>`;
      return;
    }
    const th = (k,l,num)=>`<th${num?' style="text-align:right"':""}><button data-sort="${k}" ${s.by===k?"data-active":""}>${l}${s.by===k?(s.dir<0?" ↓":" ↑"):""}</button></th>`;
    let h = `<table class="rep"><thead><tr>${th("issue","Demanda")}<th>Tarefa</th>${teamMode?"<th>Pessoas</th>":""}<th>Categoria</th>${th("n","Lanç.",1)}${th("last","Período",1)}${th("total","Total",1)}<th style="text-align:right">%</th></tr></thead><tbody>`;
    rows.forEach(r=>{
      const cats = Object.keys(r.cats).sort((x,y)=>r.cats[y]-r.cats[x]);
      const catsHtml = cats.map(cn=>{ const c=categories.find(c=>c.name===cn); return `<span class="cat"><i style="background:${esc(c?c.color:"var(--muted)")}"></i>${esc(cn)}</span>`; }).join(" ") || `<span class="sub">—</span>`;
      const pct = total ? r.total/total*100 : 0;
      const open = rOpen.has(r.key);
      h += `<tr class="main" data-toggle="${esc(r.key)}" aria-expanded="${open}" title="Clique para ver os lançamentos">
        <td>${keyHtml(r.e,"font-family:var(--f-mono);font-weight:600;color:var(--accent);text-decoration:none")}</td>
        <td><div class="nm" title="${esc(r.summary)}">${esc(r.summary||"—")}</div></td>
        ${teamMode?`<td><div class="nm" style="max-width:200px" title="${esc(Object.keys(r.people).map(personName).join(", "))}">${esc(Object.keys(r.people).sort((x,y)=>r.people[y]-r.people[x]).map(k=>personName(k).replace(" (você)","")).join(", "))}</div></td>`:""}
        <td>${catsHtml}</td>
        <td class="num">${r.n}</td>
        <td class="num">${fmtDate(r.first)}${dayKey(r.first)!==dayKey(r.last)?" – "+fmtDate(r.last):""}</td>
        <td class="num"><b>${hm(r.total)}</b></td>
        <td class="num"><span class="pct">${pct.toFixed(0)}%<i><b style="width:${pct.toFixed(1)}%"></b></i></span></td></tr>`;
      if(open){
        const its = r.items.slice().sort((x,y)=>x.start-y.start);
        const head = `<div class="dr dh"><span>Data</span><span>Início → Fim</span><span>Categoria</span>${teamMode?"<span>Pessoa</span>":""}<span style="text-align:right">Duração</span></div>`;
        h += `<tr class="det"><td colspan="${teamMode?8:7}"><div class="detlist${teamMode?" team":""}">${head}${its.map(e=>`<div class="dr">
          <span class="d-day">${DOW[new Date(e.start).getDay()]}<b>${fmtDate(e.start)}</b></span>
          <span class="d-time">${hhmm(e.start)}<i>→</i>${e.end?hhmm(e.end):"…"}</span>
          <span class="d-cat">${catName(e)?`<span class="cat" style="font-size:12.5px;color:var(--ink)"><i style="background:${esc(catColor(e))}"></i>${esc(catName(e))}</span>`:`<span class="sub">—</span>`}</span>
          ${teamMode?`<span class="d-who">${esc(personName(e._pk).replace(" (você)",""))}</span>`:""}
          <span class="d-dur">${hm(dur(e))}</span></div>`).join("")}</div></td></tr>`;
      }
    });
    h += `</tbody><tfoot><tr><td colspan="${teamMode?4:3}">Total</td><td class="num">${list.length}</td><td></td><td class="num">${hm(total)}</td><td class="num">100%</td></tr></tfoot></table>`;
    $("rTable").innerHTML = h;
  }

  function renderChart(list, a, b){
    if(!list.length){ $("rChartTitle").textContent="Horas por dia"; $("rChart").innerHTML = `<div class="sub">Sem horas no período.</div>`; return; }
    const lo = a!=null ? a : dayStart(Math.min(...list.map(e=>e.start))).getTime();
    const hiRaw = b!=null ? b : addDays(dayStart(Math.max(...list.map(e=>e.start))).getTime(),1);
    const hi = Math.min(hiRaw, addDays(dayStart(Date.now()).getTime(),1));
    const days = Math.max(1, Math.round((hi-lo)/DAY));
    const byWeek = days > 45;
    $("rChartTitle").textContent = byWeek ? "Horas por semana" : "Horas por dia";
    const buckets = [];
    if(byWeek){ for(let t=mondayOf(new Date(lo)).getTime(); t<hi; t=addDays(t,7)) buckets.push({t,ms:0,label:fmtDate(t).slice(0,5)}); }
    else { for(let i=0;i<days;i++){ const t=addDays(lo,i), d=new Date(t); buckets.push({t,ms:0,label:(days<=10?DOW[d.getDay()]+" ":"")+pad(d.getDate())}); } }
    list.forEach(e=>{ let i=buckets.length-1; while(i>0 && buckets[i].t>e.start) i--; if(buckets[i]) buckets[i].ms+=dur(e); });
    const maxH = Math.max(byWeek?40:8, ...buckets.map(x=>x.ms/3600e3));
    const step = maxH>24 ? 10 : maxH>12 ? 4 : 2;
    const top = Math.ceil(maxH/step)*step;
    const bw = Math.max(14, Math.min(44, Math.floor(900/buckets.length)-6));
    const W = 34 + buckets.length*(bw+6) + 6, H = 170, ch = 130;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc($("rChartTitle").textContent)}">`;
    for(let v=0; v<=top; v+=step){ const y = 10 + ch - v/top*ch; svg += `<line class="grid" x1="30" x2="${W}" y1="${y}" y2="${y}"/><text x="26" y="${y+3}" text-anchor="end">${v}h</text>`; }
    buckets.forEach((x,i)=>{
      const hgt = x.ms/3600e3/top*ch, X = 34 + i*(bw+6);
      if(x.ms) svg += `<rect class="bar" x="${X}" y="${10+ch-hgt}" width="${bw}" height="${Math.max(hgt,1)}" rx="2"><title>${byWeek?"Semana de "+fmtDate(x.t):fmtDate(x.t)}: ${hm(x.ms)}</title></rect>`;
      svg += `<text x="${X+bw/2}" y="${H-12}" text-anchor="middle">${esc(x.label)}</text>`;
    });
    $("rChart").innerHTML = svg + `</svg>`;
  }

  function showView(v){
    const rep = v==="relatorio";
    $("viewTimer").hidden = rep; $("viewReport").hidden = !rep;
    $("tabTimer").setAttribute("aria-pressed", String(!rep)); $("tabReport").setAttribute("aria-pressed", String(rep));
    try{ history.replaceState(null,"", rep ? "#relatorio" : location.pathname+location.search); }catch(_){}
    if(rep) renderReport();
  }
  $("tabTimer").onclick = ()=>showView("cronometro");
  $("tabReport").onclick = ()=>showView("relatorio");
  $("rPeriod").onchange = ()=>{
    const c = $("rPeriod").value==="custom";
    $("rFromL").hidden = !c; $("rToL").hidden = !c;
    if(c && !$("rFrom").value){ const n=new Date(); $("rFrom").value=inputDate(new Date(n.getFullYear(),n.getMonth(),1)); $("rTo").value=inputDate(n); }
    renderReport();
  };
  ["rFrom","rTo","rCat","rPerson"].forEach(id=>$(id).addEventListener("change",renderReport));
  let rSearchT=null; $("rSearch").addEventListener("input",()=>{ clearTimeout(rSearchT); rSearchT=setTimeout(renderReport,200); });
  $("rTable").addEventListener("click", ev=>{
    const sb = ev.target.closest("[data-sort]");
    if(sb){ const k=sb.dataset.sort; rSort = rSort.by===k ? {by:k,dir:-rSort.dir} : {by:k,dir:k==="issue"?1:-1}; renderReport(); return; }
    if(ev.target.closest("a")) return;
    const tr = ev.target.closest("[data-toggle]");
    if(tr){ const k=tr.dataset.toggle; rOpen.has(k)?rOpen.delete(k):rOpen.add(k); renderReport(); }
  });
  $("rCopy").onclick = async ()=>{
    const lines = [["Demanda","Tarefa","Pessoas","Categoria","Lançamentos","Primeiro","Último","Total (h:mm)","Horas decimais"].join("\t")];
    rLastRows.forEach(r=>{ const m=Math.round(r.total/60000);
      lines.push([r.issue, r.summary||"", Object.keys(r.people||{}).map(k=>personName(k).replace(" (você)","")).join(", "), Object.keys(r.cats).join(", "), r.n, fmtDate(r.first), fmtDate(r.last), Math.floor(m/60)+":"+pad(m%60), hDec(r.total)].join("\t")); });
    try{ await navigator.clipboard.writeText(lines.join("\n")); $("rCopied").textContent="Copiado. Cole no Excel."; }
    catch(_){ $("rCopied").textContent="Não deu para copiar automaticamente."; }
    setTimeout(()=>{ $("rCopied").textContent=""; }, 5000);
  };
  if(location.hash==="#relatorio") showView("relatorio");


  /* ---------- Seleção própria ---------- */
  // Mantém o <select> nativo (valor, eventos e FormData) e desenha por cima um botão e uma lista bonita.
  const FS_CHEV = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
  const FS_CHECK = '<svg class="ck" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const SEL_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const fsDot = v => { const c = typeof catById==="function" && catById(v); return c ? `<i style="background:${esc(c.color)}"></i>` : ""; };
  let fsOpen = null; // {sel, btn, pop, items, idx}

  function fsRefresh(sel){
    const btn = sel._fsBtn; if(!btn) return;
    const o = sel.options[sel.selectedIndex];
    const txt = o ? o.textContent : "";
    btn.querySelector(".fs-lbl").innerHTML = (o ? fsDot(o.value) : "") + `<span style="overflow:hidden;text-overflow:ellipsis">${esc(txt)}</span>`;
    btn.classList.toggle("idle", sel.classList.contains("idle") || (!!o && o.value==="" && !sel.closest(".filters") && !sel.classList.contains("taskname")));
    btn.classList.toggle("strong", sel.classList.contains("taskname") && !sel.classList.contains("idle"));
    btn.title = txt;
  }
  function fsEnhance(sel){
    if(sel._fsBtn) return;
    const wrap = document.createElement("div"); wrap.className = "fs";
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    sel.classList.add("fs-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden","true");
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "fs-btn";
    btn.setAttribute("aria-haspopup","listbox"); btn.setAttribute("aria-expanded","false");
    if(sel.getAttribute("aria-label")) btn.setAttribute("aria-label", sel.getAttribute("aria-label"));
    btn.innerHTML = `<span class="fs-lbl"></span><span class="fs-chev">${FS_CHEV}</span>`;
    wrap.appendChild(btn);
    sel._fsBtn = btn;
    Object.defineProperty(sel, "value", { configurable:true, get(){ return SEL_VALUE.get.call(this); }, set(v){ SEL_VALUE.set.call(this, v); fsRefresh(this); } });
    btn.addEventListener("click", e=>{ e.preventDefault(); fsOpen && fsOpen.sel===sel ? fsClose() : fsShow(sel); });
    btn.addEventListener("keydown", e=>{
      if(["ArrowDown","ArrowUp","Enter"," "].includes(e.key) && !(fsOpen && fsOpen.sel===sel)){ e.preventDefault(); fsShow(sel); }
    });
    sel.addEventListener("change", ()=>fsRefresh(sel));
    sel.addEventListener("focus", ()=>btn.focus());
    new MutationObserver(()=>fsRefresh(sel)).observe(sel, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:["class"]});
    fsRefresh(sel);
  }
  function fsShow(sel){
    fsClose();
    const btn = sel._fsBtn, pop = document.createElement("div");
    pop.className = "fs-pop"; pop.setAttribute("role","listbox");
    const items = [];
    let html = "", lastGroup = null;
    [...sel.options].forEach((o,i)=>{
      const g = o.parentNode.tagName==="OPTGROUP" ? o.parentNode.label : null;
      if(g!==lastGroup){ if(g) html += `<div class="fs-grp">${esc(g)}</div>`; else if(lastGroup) html += `<div class="fs-sep"></div>`; lastGroup = g; }
      const add = o.value.startsWith("__new");
      if(add && i>0 && !g) html += "";
      const cls = ["fs-it", o.selected?"sel":"", add?"add":"", (o.value==="" && !o.selected)?"muted":""].join(" ");
      html += `<div class="${cls}" role="option" aria-selected="${o.selected}" data-i="${i}">${fsDot(o.value)}<span>${esc(o.textContent)}</span>${add?"":FS_CHECK}</div>`;
      items.push(i);
    });
    pop.innerHTML = html;
    document.body.appendChild(pop);
    btn.setAttribute("aria-expanded","true");
    fsOpen = {sel, btn, pop, idx: Math.max(0, sel.selectedIndex), full: pop.scrollHeight};
    fsPlace(true);
    fsActive(fsOpen.idx);
    pop.addEventListener("mousedown", e=>e.preventDefault());
    pop.addEventListener("click", e=>{ const it = e.target.closest(".fs-it"); if(it) fsPick(+it.dataset.i); });
    pop.addEventListener("mousemove", e=>{ const it = e.target.closest(".fs-it"); if(it && +it.dataset.i!==fsOpen.idx) fsActive(+it.dataset.i, true); });
  }
  // posiciona a lista colada no botão (abre para cima se não couber embaixo)
  function fsPlace(first){
    if(!fsOpen) return;
    const {btn, pop, full} = fsOpen, r = btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    if(r.bottom < 0 || r.top > vh){ fsClose(); return; }
    const w = Math.min(Math.max(r.width, 200), vw - 16);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
    const below = vh - r.bottom - 14, above = r.top - 14, want = Math.min(full, 300);
    const up = first ? (below < want && above > below) : pop.classList.contains("up");
    pop.classList.toggle("up", up);
    const h = Math.max(120, Math.min(want, up ? above : below));
    pop.style.maxHeight = h + "px";
    pop.style.top = (up ? Math.max(8, r.top - 6 - Math.min(h, full)) : r.bottom + 6) + "px";
  }
  function fsActive(i, noScroll){
    if(!fsOpen) return;
    fsOpen.idx = i;
    fsOpen.pop.querySelectorAll(".fs-it").forEach(el=>el.classList.toggle("active", +el.dataset.i===i));
    if(!noScroll){ const el = fsOpen.pop.querySelector(`.fs-it[data-i="${i}"]`), pop = fsOpen.pop;
      if(el){ if(el.offsetTop < pop.scrollTop) pop.scrollTop = el.offsetTop - 6; else if(el.offsetTop + el.offsetHeight > pop.scrollTop + pop.clientHeight) pop.scrollTop = el.offsetTop + el.offsetHeight - pop.clientHeight + 6; } }
  }
  function fsPick(i){
    if(!fsOpen) return;
    const {sel, btn} = fsOpen;
    fsClose();
    if(sel.selectedIndex!==i){ sel.selectedIndex = i; fsRefresh(sel); sel.dispatchEvent(new Event("change", {bubbles:true})); }
    else if(sel.options[i] && sel.options[i].value.startsWith("__new")) sel.dispatchEvent(new Event("change", {bubbles:true}));
    btn.focus();
  }
  function fsClose(){
    if(!fsOpen) return;
    fsOpen.pop.remove(); fsOpen.btn.setAttribute("aria-expanded","false"); fsOpen = null;
  }
  document.addEventListener("keydown", e=>{
    if(!fsOpen) return;
    const n = fsOpen.sel.options.length;
    if(e.key==="Escape"){ e.preventDefault(); const b=fsOpen.btn; fsClose(); b.focus(); }
    else if(e.key==="ArrowDown"){ e.preventDefault(); fsActive(Math.min(n-1, fsOpen.idx+1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); fsActive(Math.max(0, fsOpen.idx-1)); }
    else if(e.key==="Home"){ e.preventDefault(); fsActive(0); }
    else if(e.key==="End"){ e.preventDefault(); fsActive(n-1); }
    else if(e.key==="Enter" || e.key===" "){ e.preventDefault(); fsPick(fsOpen.idx); }
    else if(e.key==="Tab"){ fsClose(); }
    else if(e.key.length===1){ const k = fold(e.key); const opts=[...fsOpen.sel.options];
      for(let j=1;j<=n;j++){ const i=(fsOpen.idx+j)%n; if(fold(opts[i].textContent).startsWith(k)){ fsActive(i); break; } } }
  });
  document.addEventListener("mousedown", e=>{ if(fsOpen && !fsOpen.pop.contains(e.target) && !fsOpen.btn.contains(e.target)) fsClose(); });
  window.addEventListener("resize", ()=>fsPlace(false));
  document.addEventListener("scroll", e=>{ if(fsOpen && !fsOpen.pop.contains(e.target)) fsPlace(false); }, true);
  // aplica em todo select, inclusive os que aparecem depois (formulário de lançamento)
  document.querySelectorAll("select").forEach(fsEnhance);
  new MutationObserver(muts=>{ muts.forEach(m=>m.addedNodes.forEach(nd=>{ if(nd.nodeType!==1) return; if(nd.tagName==="SELECT") fsEnhance(nd); else nd.querySelectorAll && nd.querySelectorAll("select").forEach(fsEnhance); })); })
    .observe(document.body, {childList:true, subtree:true});

  window.pontoSelectTask=function(key){
    if(timer&&timer.running){ showBanner("Há um cronômetro ativo. Pare-o antes de escolher outra tarefa.","warn",5000); return; }
    $("tabTimer").click(); $("issueIn").value=key; onIssueInput(); $("issueIn").focus();
  };
  // Painel: a pessoa confirmou parar o registro atual para cronometrar outra tarefa.
  window.pontoStopAndSelect=async function(key){
    if(timer&&timer.running){
      try{ await stop(); }
      catch(error){ showBanner("Não foi possível parar o registro atual: "+(error?.message||"tente novamente."),"err"); return; }
    }
    window.pontoSelectTask(key);
    showBanner("Registro anterior parado. Clique em iniciar para cronometrar "+key+".");
  };
  window.addEventListener("unhandledrejection",event=>{
    event.preventDefault();showBanner(event.reason?.message||"Não foi possível salvar. Tente novamente.","err",8000);
  });
  paintCats(); paintTasks(); render(); paintTimer();
  (async ()=>{
    const cl = window.pontoBridge;
    if(!cl || !cl.use){ $("connState").textContent="Offline"; showBanner("Abra o Registro pelo painel Nimitz e conecte sua conta.","err"); return; }
    const [dbNs, mcpNs, uNs] = await Promise.all([cl.use("db"), cl.use("mcp"), cl.use("user")]);
    db = dbNs; mcp = mcpNs;
    if(!db){ $("connState").textContent="Sem armazenamento"; showBanner("Os lançamentos não podem ser salvos agora. Recarregue o painel.","err"); $("days").innerHTML=""; return; }
    uid = uNs ? await uNs.id() : null;
    if(!uid){ $("connState").textContent="Sem usuário"; showBanner("Conecte sua conta Atlassian em Conexão para registrar suas horas.","err"); $("days").innerHTML=""; return; }
    // a ficha em members/<conta> é criada pelo Worker com o nome do Jira
    subscribeMine(); paintProfiles();
    db.collection("members").onSnapshot(snap=>{
      members = snap.docs.map(d=>d.id);
      if(!members.includes(uid)) members.push(uid);
      snap.docs.forEach(d=>{ memberDocs[d.id] = d.data()||{}; if(memberDocs[d.id].name) names[d.id] = memberDocs[d.id].name; });
      members.forEach(m=>{
        if(teamSubs[m]) return;
        teamSubs[m] = entriesCol(m).orderBy("start","desc").onSnapshot(sn=>{
          team[m] = sn.docs.map(x=>Object.assign({},x.data(),{id:x.id,_pk:m})).filter(alive);
          renderReport();
        }, ()=>{});
      });
      paintProfiles();
      paintPeople(); renderReport();
    }, ()=>{});
    $("connState").textContent = mcp ? "Horas salvas na sua conta" : "Jira indisponível · lançamentos salvos só aqui";
    if(!mcp) showBanner("A conexão com o Jira não está disponível nesta visualização. Os lançamentos ficam salvos e podem ser enviados depois.");
    db.doc("state/tasks").onSnapshot(s=>{
      const l = s.exists && s.data().list;
      if(Array.isArray(l)) tasks = l.map(t=>Object.assign({},t));
      sharedLoaded("tasks");
      paintTasks(); onIssueInput(); paintTimer();
      if(!document.querySelector("form.edit")) render();
      renderReport();
    }, ()=>{});
    db.doc("state/categories").onSnapshot(s=>{
      const l = s.exists && s.data().list;
      if(Array.isArray(l)) categories = l.map(c=>Object.assign({},c));
      sharedLoaded("cats");
      paintCats(); paintTasks(); if(!document.querySelector("form.edit")) render();
    }, ()=>{});
    $("autoSend").checked = !!settings.autoSend;
    window.pontoApi.pontoReady?.();
  })();
  setInterval(()=>{ if(timer&&timer.running && !document.querySelector("form.edit")) render(); },60000);
})();
