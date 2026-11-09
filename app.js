(function(){
"use strict";

/* ===================== configuração ===================== */
var JIRA_BASE = "https://nimitz.atlassian.net/browse/";
var PROJETO   = "NMTZ";
/* A ÚNICA escrita que este painel faz no Jira, e o ÚNICO campo que ela toca.
   Tudo o mais aqui é leitura. CAMPO_CORRIGIDAS é "Versões corrigidas"
   (fixVersions, lista de versões) — NÃO é "Versão Entrega"
   (customfield_10150), que é outro campo e continua só de leitura (coluna
   da aba Tarefas). Até 28/09/2026 a aba Homologação gravava a Versão Entrega;
   o Eduardo corrigiu o pedido: o campo certo sempre foi Versões corrigidas.
   Nunca acrescentar campo a gravarVersoesCorrigidas(): a autorização é nominal
   a este. Campo novo = decisão nova. */
var CAMPO_CORRIGIDAS = "fixVersions";
/* Chaves próprias: o Painel de Tarefas usa o prefixo "nmtz:". Se os dois
   painéis compartilharem a mesma origem de armazenamento, reaproveitar as
   chaves faria um sobrescrever o cache do outro. */
var LS_DADOS = window.nimitz.storagePrefix+"versao";
var LS_META  = window.nimitz.storagePrefix+"meta";
var LS_CHECK = window.nimitz.storagePrefix+"checklist";
var LS_PESSOA= window.nimitz.storagePrefix+"pessoa";

var SEM_VERSAO = "v.2026.xx.xx";

/* Rotulos usados pela checklist, iguais aos do Painel de Tarefas. */
var TODOS       = "__todos";
var SEM_STATUS  = "— sem status —";
var SEM_PESSOA  = "— sem analista de teste —";

/* Campos que a planilha usa hoje, um a um, conferidos contra o Jira:
     customfield_10044 = Prazo de Entrega   (a coluna de prazo da planilha)
     customfield_10048 = Analista de Testes
     customfield_10047 = Desenvolvedor
     customfield_10343 = "Cliente."         (o campo COM ponto — o certo;
                         "Cliente Nimitz" vem "INTERNO" em quase tudo)
     customfield_10212 = Ticket Movidesk
     customfield_10115 = Estimativa Testes
     customfield_10024 = Flagged            (impedimento — sinal COMPARTILHADO)
     customfield_10011 = Classificação      (o rank do board do Jira: é a ordem
                         que o time mantém arrastando no próprio Jira, e por isso
                         a única ordenação que reflete para todos) */
var CAMPOS = ["summary","status","issuetype","priority","fixVersions","duedate",
  "customfield_10044","customfield_10048","customfield_10047","customfield_10343",
  "customfield_10212","customfield_10115","customfield_10024","customfield_10011",
  "updated","resolutiondate",
  /* Campos extras, todos escalares. Os de texto rico — Plano de Testes,
     Casos de teste, Descrição, anexos, comentários — ficam de fora de
     propósito: não servem como coluna e custam quilobytes por tarefa
     (Plano de Testes sozinho deu 9,7KB numa amostra). */
  "assignee","reporter","creator","customfield_10057",
  "customfield_10093","customfield_10129","customfield_10096","customfield_10172",
  "customfield_10097","customfield_10071","customfield_10346","customfield_10169",
  "customfield_10078","customfield_10253","customfield_10173","customfield_10184",
  "customfield_10166","customfield_10069","customfield_10180","customfield_10270",
  "customfield_10958","customfield_10959","customfield_10960","customfield_10038",
  "customfield_10053","resolution","statusCategory","customfield_10150",
  "versions","components","labels","parent",
  "customfield_10095","customfield_10215","customfield_10060","created",
  "customfield_10012","customfield_10114","customfield_10178","customfield_10824",
  "customfield_10825","customfield_10076","customfield_10594","customfield_10626",
  "customfield_10031","timespent","workratio"];

/* As 7 fases da planilha, mapeadas para os status reais do Jira.
   Qualquer status novo cai em "outro" e aparece sinalizado, em vez de
   ser somado silenciosamente na fase errada. */
var FASES = [
  /* icone: a identidade da fase não pode depender só da cor — ver o comentário
     dos tokens. Silhuetas deliberadamente diferentes a 12px: lupa, arco, seta,
     erlenmeyer, lançar. "outro" fica sem ícone de propósito: é o balde do status
     desconhecido, e não deve competir visualmente com as fases reais. */
  {id:"pendente",  rotulo:"Pendente",       cor:"var(--fase-pendente)",  icone:"search",  statuses:["analise pendente","em analise","revisao de analise","analise tecnica","analise aprovada"]},
  {id:"dev",       rotulo:"Desenvolvimento",cor:"var(--fase-dev)",       icone:"loader",  statuses:["em desenvolvimento"]},
  {id:"merge",     rotulo:"Merge",          cor:"var(--fase-merge)",     icone:"up",      statuses:["pronto para merge"]},
  {id:"teste",     rotulo:"Teste",          cor:"var(--fase-teste)",     icone:"flask",   statuses:["teste pendente","em teste"]},
  {id:"prod",      rotulo:"Teste Produção", cor:"var(--fase-prod)",      icone:"ext",     statuses:["teste producao"]},
  {id:"reprovada", rotulo:"Reprovadas",     cor:"var(--fase-reprovada)", icone:"alert",   statuses:["teste reprovado","analise reprovada"], status:"critico"},
  {id:"final",     rotulo:"Finalizadas",    cor:"var(--fase-final)",     icone:"check",   statuses:["finalizada"], status:"bom"},
  {id:"outro",     rotulo:"Outros",         cor:"var(--fase-outro)",     icone:"",        statuses:[]}
];
var FASE_POR_STATUS = (function(){
  var m = {};
  FASES.forEach(function(f){ f.statuses.forEach(function(s){ m[s] = f.id; }); });
  return m;
})();

/* tipo define o controle da linha de filtros: enum vira lista dos valores
   presentes, texto vira campo de digitação. Status tem controle próprio,
   porque lá a escolha é de vários de uma vez. multi é a mesma ideia para uma
   coluna comum: o filtro guarda uma LISTA e abre o popover #pop-multi. */
var COLUNAS = [
  {id:"key",         rot:"Chave",             w:148, tipo:"texto"},
  {id:"summary",     rot:"Resumo",            w:340, tipo:"texto"},
  {id:"type",        rot:"Tipo",              w:96,  tipo:"enum"},
  {id:"status",      rot:"Status",            w:152, tipo:"status"},
  {id:"prazo",       rot:"Prazo",             w:96,  tipo:"texto"},
  {id:"priority",    rot:"Prioridade",        w:104, tipo:"enum"},
  {id:"testAnalyst", rot:"Analista de testes",w:160, tipo:"enum"},
  {id:"dev",         rot:"Desenvolvedor",     w:160, tipo:"enum"},
  {id:"cliente",     rot:"Cliente",           w:168, tipo:"multi"},
  {id:"ticket",      rot:"Ticket Movidesk",   w:120, tipo:"texto"},
  {id:"estimativa",  rot:"Estimativa de testes", w:152,  tipo:"texto"},
  /* Horas lançadas no Jira pela pessoa de cada campo: Analista de Requisitos,
     Analista de Testes e Desenvolvedor. Vêm de /api/worklog-hours, não da busca. */
  {id:"horasAnalista", rot:"Horas analista de requisitos", w:200, tipo:"texto"},
  {id:"horasTeste",  rot:"Horas analista de testes", w:184, tipo:"texto"},
  {id:"horasDev",    rot:"Horas desenvolvedor", w:152,  tipo:"texto"},
  /* Estas cinco já chegavam no mapear() e eram descartadas na exibição.
     Vêm escondidas por padrão para não estourar a largura da tabela. */
  {id:"versoes",     rot:"Versão",            w:128, tipo:"texto"},
  {id:"impedida",    rot:"Impedimento",       w:104, tipo:"enum"},
  {id:"updated",     rot:"Atualizado",        w:128, tipo:"texto"},
  {id:"resolvido",   rot:"Resolvido",         w:112, tipo:"texto"},
  /* O rank é o token de ordenação do board (LexoRank). Não é texto para
     humano, mas é campo do Jira — fica disponível para quem quiser. */
  {id:"rank",        rot:"Classificação",     w:120, tipo:"texto"},
  {id:"assignee", rot:"Responsável", w:152, tipo:"enum"},
  {id:"reporter", rot:"Relator", w:152, tipo:"enum"},
  {id:"creator", rot:"Criador", w:152, tipo:"enum"},
  {id:"analistaReq", rot:"Analista de requisitos", w:160, tipo:"enum"},
  {id:"analiseTecnica", rot:"Análise técnica", w:152, tipo:"enum"},
  {id:"ux", rot:"UX designer", w:152, tipo:"enum"},
  {id:"devOrigem", rot:"Desenvolvedor origem", w:160, tipo:"enum"},
  {id:"reqOrigem", rot:"Analista de requisitos origem", w:208, tipo:"enum"},
  {id:"testeOrigem", rot:"Analista de testes origem", w:184, tipo:"enum"},
  {id:"squad", rot:"Squad", w:120, tipo:"enum"},
  {id:"modulo", rot:"Módulo", w:136, tipo:"enum"},
  {id:"rotina", rot:"Rotina", w:136, tipo:"enum"},
  {id:"impacto", rot:"Impacto", w:120, tipo:"enum"},
  {id:"clienteNimitz", rot:"Cliente Nimitz", w:160, tipo:"enum"},
  {id:"origemBug", rot:"Origem do bug", w:136, tipo:"enum"},
  {id:"classifBug", rot:"Classificação de bug", w:152, tipo:"enum"},
  {id:"criticidadeBug", rot:"Criticidade de bug", w:144, tipo:"enum"},
  {id:"bugGerado", rot:"Bug gerado", w:120, tipo:"enum"},
  {id:"classifMelhoria", rot:"Classificação de melhoria", w:184, tipo:"enum"},
  {id:"gerarDpu", rot:"Gerar DPU", w:104, tipo:"enum"},
  {id:"iaRequisitos", rot:"Uso de IA – requisitos", w:160, tipo:"enum"},
  {id:"iaTestes", rot:"Uso de IA – testes", w:152, tipo:"enum"},
  {id:"iaDesenv", rot:"Uso de IA – desenvolvimento", w:200, tipo:"enum"},
  {id:"motivoReprovT", rot:"Motivo reprovação testes", w:184, tipo:"enum"},
  {id:"motivoReprovA", rot:"Motivo reprovação análise", w:192, tipo:"enum"},
  {id:"resolucao", rot:"Resolução", w:128, tipo:"enum"},
  {id:"catStatus", rot:"Categoria do status", w:144, tipo:"enum"},
  {id:"versaoEntrega", rot:"Versão entrega", w:136, tipo:"texto"},
  {id:"versoesAfet", rot:"Versões afetadas", w:144, tipo:"texto"},
  {id:"componentes", rot:"Componentes", w:144, tipo:"texto"},
  {id:"etiquetas", rot:"Etiquetas", w:144, tipo:"texto"},
  {id:"pai", rot:"Pai / épico", w:112, tipo:"texto"},
  {id:"tarefaOrigem", rot:"Tarefa origem", w:120, tipo:"texto"},
  {id:"branch", rot:"Branch", w:160, tipo:"texto"},
  {id:"motivoReprov", rot:"Motivo reprovação", w:176, tipo:"texto"},
  {id:"criado", rot:"Criado", w:128, tipo:"texto"},
  {id:"primeiraResp", rot:"Primeira resposta", w:144, tipo:"texto"},
  {id:"estDesenv", rot:"Estimativa de desenvolvimento", w:208, tipo:"texto"},
  {id:"estRequisitos", rot:"Estimativa de requisitos", w:176, tipo:"texto"},
  {id:"estUX", rot:"Estimativa de UX", w:136, tipo:"texto"},
  {id:"estAnaliseTec", rot:"Estimativa de análise técnica", w:208, tipo:"texto"},
  {id:"qtdReprov", rot:"Quantidade de reprovações", w:192, tipo:"texto"},
  {id:"qtdMotivos", rot:"Quantidade de motivos de reprovação", w:248, tipo:"texto"},
  {id:"qtdReprovAnt", rot:"Quantidade de reprovações antigas", w:232, tipo:"texto"},
  {id:"gut", rot:"GUT resultado", w:120, tipo:"texto"},
  {id:"tempoGasto", rot:"Tempo gasto (h)", w:120, tipo:"texto"},
  {id:"razaoTrab", rot:"Razão trabalhada", w:136, tipo:"texto"}
];

/* ===================== ícones ===================== */
var ICONS = {
  tag:'<path d="M12 2 2 12l10 10 10-10z"/><circle cx="12" cy="8" r="1.6"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  search:'<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check:'<path d="M5 13l4 4L19 7"/>',
  alert:'<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  loader:'<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  ext:'<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  down:'<path d="M12 4v12"/><path d="M6 12l6 6 6-6"/><path d="M4 20h16"/>',
  up:'<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  arrowdown:'<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  table:'<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="10" y1="10" x2="10" y2="20"/>',
  flag:'<path d="M4 21V4h11l-1 4h7l-1 5h-7l1 4H4"/>',
  /* icones que a aba de checklist usa, os mesmos do Painel de Tarefas */
  grip:'<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>',
  chevd:'<path d="M6 9l6 6 6-6"/>',
  filter:'<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
  flask:'<path d="M9 2h6"/><path d="M10 2v6l-6 11a1 1 0 0 0 1 1.5h14a1 1 0 0 0 1-1.5L14 8V2"/>',
  checkcheck:'<path d="M2 12l4.5 4.5L15 8"/><path d="M8 12l4.5 4.5L21 8"/>',
  sparkles:'<path d="M12 3l1.4 4.3L18 9l-4.6 1.7L12 15l-1.4-4.3L6 9l4.6-1.7z"/><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"/>',
  ban:'<circle cx="12" cy="12" r="9"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/>',
  undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>',
  /* setas laterais: movem a tarefa entre os dois campos da rodada */
  setadir:'<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  setaesq:'<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
  mais:'<path d="M12 5v14"/><path d="M5 12h14"/>',
  rotate:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
  eye:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94"/><path d="M1 1l22 22"/><path d="M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19"/>',
  list:'<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'
};
function icon(n, s, cls){
  if(n==="clock") return '<svg class="icon" viewBox="0 0 24 24" width="'+(s||14)+'" height="'+(s||14)+'"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  return '<svg class="icon '+(cls||"")+'" viewBox="0 0 24 24" width="'+(s||14)+'" height="'+(s||14)+'">'+(ICONS[n]||"")+'</svg>';
}

/* ===================== utilitários ===================== */
function norm(s){
  return String(s==null?"":s).replace(/﻿/g,"")
    .normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
}
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":c==='"'?"&quot;":"&#39;";
  });
}
function p2(n){ return String(n).padStart(2,"0"); }
/* Data pura ("2026-09-23") monta como data LOCAL. Date.parse trata como
   meia-noite UTC e, formatando com getDate() em fuso negativo, o dia sai
   um a menos. */
function parseData(v){
  if(!v) return null;
  var s = String(v).trim(); if(!s) return null;
  var so = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(so) return new Date(Number(so[1]), Number(so[2])-1, Number(so[3]));
  var t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}
function fmtData(v){ var d=parseData(v); return d? p2(d.getDate())+"/"+p2(d.getMonth()+1)+"/"+String(d.getFullYear()).slice(2) : ""; }
/* Tipo com cor própria nas quatro abas: Bug e Melhoria em etiqueta, o resto discreto. */
function tipoTag(tipo){
  var n = norm(tipo);
  var cls = n === "bug" ? "tipo tipo-bug" : n === "melhoria" ? "tipo tipo-melhoria" : "tipo tipo-outro";
  return tipo ? '<span class="'+cls+'">'+esc(tipo)+'</span>' : "";
}
function fmtDataHora(v){
  var d=parseData(v); if(!d) return "";
  return p2(d.getDate())+"/"+p2(d.getMonth()+1)+"/"+d.getFullYear()+" "+p2(d.getHours())+":"+p2(d.getMinutes());
}
function venceu(v){
  var d=parseData(v); if(!d) return false;
  var h=new Date(); h.setHours(0,0,0,0);
  return d.getTime() < h.getTime();
}
function fmtDiaMes(d){ return p2(d.getDate())+"/"+p2(d.getMonth()+1); }

/* ---------- prazo contra a release semanal ----------
   No Filt sobe versão toda SEGUNDA e as tarefas daquela versão são finalizadas
   ali. Então um prazo não se lê contra hoje, e sim contra as duas próximas
   subidas: ou a tarefa cabe na versão que vem aí, ou cabe na seguinte, ou não
   cabe em nenhuma. */
var DIA_RELEASE = 1;   // 0=domingo, 1=segunda
/* A segunda conta como a release DO DIA, e não como uma já entregue: na segunda
   de manhã a versão que sobe ainda é a de hoje. (Decisão do Eduardo.) */
function proximoRelease(hoje){
  var d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  d.setDate(d.getDate() + ((DIA_RELEASE - d.getDay() + 7) % 7));
  return d;
}
/* Calculado uma vez por dia e não por linha: a tabela redesenha dezenas de
   linhas por rolagem. A chave do cache é o DIA, então um painel deixado aberto
   a noite toda vira a página sozinho na virada. */
var RELEASE_CACHE = null;
function janelaRelease(){
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  if(RELEASE_CACHE && RELEASE_CACHE.dia === hoje.getTime()) return RELEASE_CACHE;
  var r1 = proximoRelease(hoje);
  var r2 = new Date(r1.getFullYear(), r1.getMonth(), r1.getDate()+7);
  RELEASE_CACHE = {dia:hoje.getTime(), r1:r1, r2:r2};
  return RELEASE_CACHE;
}
/* "" = folga (cabe na seguinte também), "semana" = só cabe nesta versão,
   "estourado" = vence antes desta versão subir. Tarefa FINALIZADA não tem
   risco: o prazo dela já não decide nada, e pintá-la encheria a tela de
   vermelho que ninguém pode resolver. */
function riscoPrazo(t){
  var d = parseData(t && t.prazo);
  if(!d) return "";
  if(faseDe(t) === "final") return "";
  var j = janelaRelease();
  if(d.getTime() <  j.r1.getTime()) return "estourado";
  if(d.getTime() <  j.r2.getTime()) return "semana";
  return "";
}
function tituloPrazo(t, nivel){
  var d = parseData(t && t.prazo);
  if(!d) return "";
  var j = janelaRelease(), r1 = fmtDiaMes(j.r1);
  if(nivel === "estourado"){
    return venceu(t.prazo)
      ? "Prazo venceu em "+fmtData(t.prazo)+" — a versão de "+r1+" já sobe atrasada"
      : "Vence em "+fmtData(t.prazo)+", antes da versão de "+r1+" subir — nem entrando nela dá tempo";
  }
  if(nivel === "semana"){
    return "Só cabe na versão de "+r1+": o prazo é "+fmtData(t.prazo)
      + " e não aguenta esperar a de "+fmtDiaMes(j.r2)+".";
  }
  return "Prazo "+fmtData(t.prazo)+" — cabe na versão de "+r1+" ou na seguinte.";
}
/* Classe, título e ícone de uma célula de prazo, num lugar só — como
   etiquetaStatus(). As três abas mostram prazo, e escrever a marcação na mão em
   cada uma foi como o "venceu" acabou com três cópias da mesma regra. */
function marcaPrazo(t){
  var n = riscoPrazo(t);
  return {nivel:n, cls:(n ? " prazo-"+n : ""), titulo:tituloPrazo(t, n),
          icone:(n ? icon("alert",11) : "")};
}
function faseDe(t){ return FASE_POR_STATUS[norm(t.status)] || "outro"; }
function faseInfo(id){ return FASES.filter(function(f){ return f.id===id; })[0] || FASES[FASES.length-1]; }

/* "Interna" quando não há cliente externo (INTERNO, VIASOFT*, vazio);
   havendo, mostra o nome — ou os nomes separados por vírgula. */
function ehInterno(p){
  var np = norm(p);
  return !np || np.indexOf("interno")!==-1 || np.indexOf("viasoft")===0;
}
function infoCliente(t){
  var partes = String(t.cliente||"").split(",").map(function(s){return s.trim();}).filter(Boolean);
  var ext = partes.filter(function(p){ return !ehInterno(p); });
  return ext.length ? {externo:true, nome:ext.join(", ")} : {externo:false, nome:"Interna"};
}

/* Utilitários da checklist, os mesmos do Painel de Tarefas. As cores saem dos
   tokens (e não de hex fixo) para continuarem legíveis no tema escuro. */
function statusPareceEspecial(status){
  var v = norm(status);
  return v === "finalizada" || v === "analise reprovada";
}
function pareceTesteAtivo(s){ var v = norm(s); return v==="em teste" || v==="teste pendente"; }
function pareceFeito(s){ return /merge|producao|production|deploy/.test(norm(s)); }
function prioridadeTom(p){
  var v = norm(p);
  if(/blocker|critic|highest|altissim|urgent/.test(v)) return {cor:"var(--danger)",peso:"700"};
  if(/high|alta|major/.test(v)) return {cor:"var(--accent-2)",peso:"600"};
  return {cor:"var(--text-faint)",peso:"400"};
}

/* Estado da checklist. "Fila de teste" e "Já testada" classificam status;
   dispensadas/mantidas guardam a decisão manual de tirar ou manter na fila. */
var CHECK_VAZIO = {
  dispensadas:{}, mantidas:{}, revividas:{}, ordem:{},
  statusOcultos:[], statusTeste:[], statusFeito:[], statusesVistos:[],
  inicOcultos:false, inicTeste:false, inicFeito:false,
  /* aba Homologação: chave -> data ISO em que foi marcada como testada, e
     chave -> observação livre. Ver a seção da aba, no fim do arquivo. */
  homolog:{}, homologObs:{},
  /* aba Homologação: quem o time pôs na fila na mão (chave -> data ISO) e quem
     tirou dela (chave -> data ISO). Ver a seção da aba, no fim do arquivo. */
  hgExtra:{}, hgFora:{},
  /* aba Homologação: o campo da rodada quando o time decide CONTRA o padrão do
     status — chave -> data ISO em que foi empurrada para a PRÓXIMA versão, e
     chave -> data ISO em que foi trazida para a versão ATUAL. Sem marca
     nenhuma quem decide é o status. Ver a seção da aba, no fim do arquivo. */
  hgProx:{}, hgAtual:{},
  /* chave -> lista de versões, quando o time corrige o que veio do Jira */
  versaoAjuste:{}
};

/* ===================== estado ===================== */
var state = {
  aba: "tarefas",           // aba inicial: o projeto inteiro
  versaoSel: "",            // recorte da aba Versões (vazio = todas)
  tarefas: [],
  total: null,          // total informado pelo Jira (count) — serve de conferência
  carregando: false,
  cancelar: false,
  aviso: null,
  /* Tres carimbos, e nao um. O ultimoSync anda a CADA sincronizacao, seja do
     projeto ou de uma pessoa so, e serve para o rotulo "Atualizado hh:mm" e
     para saber se ja ha dados aqui. Ele NAO serve para calcular janela: quem
     sincroniza a Raquel faria a atualizacao do projeto — ou a da Ana — comecar
     depois desse instante e pular em silencio tudo que mudou antes dele.
     Por isso a janela sai dos outros dois, que dizem cada um o que de fato
     esta fresco: syncGeral, o projeto inteiro, e syncPessoa[nome], aquela
     pessoa. Ver janelaMinutos() e atualizarPessoaEmJanela(). */
  ultimoSync: null,
  syncGeral: null,
  syncPessoa: {},
  fase: null,           // filtro por tile
  filtros: {},              // filtro por coluna: id -> valor
  statusSel: [],            // status exibidos (vazio = todos)
  /* Padrão: só as 11 colunas originais visíveis. As demais existem no
     seletor de Colunas — com todas ligadas de uma vez a tabela fica
     larga demais para qualquer tela. */
  ocultas: ["versoes","impedida","updated","resolvido","rank"].concat(["assignee","reporter","creator","analistaReq","analiseTecnica","ux","devOrigem","reqOrigem","testeOrigem","squad","modulo","rotina","impacto","clienteNimitz","origemBug","classifBug","criticidadeBug","bugGerado","classifMelhoria","gerarDpu","iaRequisitos","iaTestes","iaDesenv","motivoReprovT","motivoReprovA","resolucao","catStatus","versaoEntrega","versoesAfet","componentes","etiquetas","pai","tarefaOrigem","branch","motivoReprov","criado","primeiraResp","estDesenv","estRequisitos","estUX","estAnaliseTec","qtdReprov","qtdMotivos","qtdReprovAnt","gut","tempoGasto","razaoTrab"]),
  menuTab: null,            // popover aberto na aba de tabela
  /* Abre pela chave decrescente: o numero do NMTZ cresce com o tempo, entao
     isso poe a tarefa mais nova no topo. ordenadas() compara o sufixo
     numerico da chave, nao o texto — senao NMTZ-9 viria depois de NMTZ-80. */
  sort: {col:"key", dir:"desc"},
  /* Chave da tarefa cujas Versões corrigidas estão sendo gravadas no Jira agora, ou
     null. Trava o seletor das linhas enquanto a escrita está no ar. */
  hgGravando: null,
  hgRascunho: {},
  versoesJira: null,        // versões permitidas do campo Versões corrigidas (fixVersions), lidas do Jira (sem as arquivadas)
  versoesJiraSessao: false, // já tentou buscar nesta sessão (deu certo ou não)
  versoesJiraCarregando: false,           // key -> valor do select (HG_SEM = sem versão), ainda NÃO gravado
  // checklist
  pessoa: TODOS,
  check: Object.assign({}, CHECK_VAZIO),
  clBusca: "",
  /* Padrão é a "Ordem definida" — a que se arrasta na própria Checklist e que
     viaja para o time em check.ordem. Era o rank do Jira, mas a ordem combinada
     aqui é a que o time de fato segue; quem quiser o rank do board troca no
     seletor. Como esta escolha NÃO entra em salvarPref(), ela volta ao padrão a
     cada abertura, e é por isso que o padrão é quem manda. */
  clOrdenacao: "manual",
  /* Ordenação por COLUNA da Checklist: é uma olhada, não configuração. Não
     entra em salvarPref() e zera ao sair da aba — ver o clique das abas. Fica
     separada de clOrdenacao porque não a substitui: a ordem definida continua
     valendo como desempate e volta inteira no terceiro clique. */
  clSort: {col:"", dir:"asc"},
  /* seletor de pessoa e menu "Atualizar": busca, item destacado pelo teclado */
  clBuscaPessoa: "", clDestaque: 0,
  clJaAutoSelecionou: false,
  /* aba Homologação — recortes de quem está olhando, não viajam no pacote */
  hgBusca: "", hgVersao: "", hgStatus: "", hgSoPendentes: false,
  /* Ordenação da aba Homologação. Preferência de QUEM OLHA, como os filtros da
     tabela: não entra em CAMPOS_CHECK_TIME, porque ordenar a própria tela não é
     decisão do time — a ordem que É do time é a da Checklist, arrastada à mão.
     col vazia = ordem por prioridade, que é a da reunião. */
  hgSort: {col:"", dir:"asc"},
  /* vista das tarefas tiradas da fila, e a busca do menu "Adicionar tarefa" */
  hgVerFora: false, hgBuscaAdd: "", hgDestaqueAdd: 0,
  arrastando: null, alvo: null, grupoArrastando: null
};


/* ===================== formato compacto do pacote =====================
   Uma tarefa tem mais de 60 campos e o projeto passa de 10 mil tarefas. Escrito
   como lista de objetos, a maior parte do pacote não é dado: são os nomes dos
   campos, repetidos uma vez por tarefa, mais os mesmos poucos valores
   ("Finalizada", um nome de dev) escritos por extenso dezenas de milhares de
   vezes. Guardando um cabeçalho de campos, um dicionário por campo de valor
   repetido e uma linha de índices por tarefa, o mesmo conteúdo — todas as
   tarefas, todos os campos — cai de ~12 MB para ~3 MB.

   Os dois destinos do pacote precisavam disso. O localStorage dá ~5 MB por
   origem e já estava recusando a gravação. O bloco replicado viaja dentro do
   documento publicado, que tem teto de 16 MB: as tarefas antigas foram salvas
   por uma versão do painel que lia 16 campos, e no próximo carregamento
   completo todas ganhariam os 63 de hoje — no formato antigo isso levaria o
   pacote a ~12 MB, encostando no teto. Neste formato o número não se move,
   porque campo vazio custa uma vírgula e não o nome do campo.

   O formato antigo segue sendo lido: sem isso, a primeira abertura depois desta
   versão não reconheceria o pacote já publicado e o painel subiria vazio. */
var PACOTE_V = 2;
/* Um dicionário só paga quando o mesmo valor volta muitas vezes. Acima de
   DIC_MAX valores distintos ele fica grande demais para o que economiza, e
   abaixo de DIC_GANHO linhas por valor distinto não compensa a indireção —
   é o caso de summary e rank, que têm um valor próprio por tarefa. */
var DIC_MAX = 512, DIC_GANHO = 3;

/* Distingue true de "true" na chave do dicionário: impedida é booleano e o
   resto do painel a lê como booleano. */
function chaveDic(v){ return typeof v + ":" + v; }

function compactarTarefas(tarefas){
  /* Os campos saem do próprio dado, não de uma lista fixa aqui: quando o
     carregamento do Jira ganhar um campo novo, ele entra sozinho. */
  var cols = [], vistos = {}, i, j, c, v, ks, linha, dec;
  for(i=0;i<tarefas.length;i++){
    ks = Object.keys(tarefas[i]);
    for(j=0;j<ks.length;j++){ if(!vistos[ks[j]]){ vistos[ks[j]] = true; cols.push(ks[j]); } }
  }
  cols.sort();

  var dicts = {}, mapa = {};
  for(j=0;j<cols.length;j++){
    c = cols[j];
    var lista = [], onde = {}, k, estourou = false;
    for(i=0;i<tarefas.length;i++){
      v = tarefas[i][c]; if(v === undefined) v = "";
      k = chaveDic(v);
      if(onde[k] === undefined){
        if(lista.length >= DIC_MAX){ estourou = true; break; }
        onde[k] = lista.length; lista.push(v);
      }
    }
    if(!estourou && lista.length * DIC_GANHO < tarefas.length){ dicts[c] = lista; mapa[c] = onde; }
  }

  var rows = [];
  for(i=0;i<tarefas.length;i++){
    linha = [];
    for(j=0;j<cols.length;j++){
      c = cols[j]; v = tarefas[i][c]; if(v === undefined) v = "";
      linha.push(mapa[c] ? mapa[c][chaveDic(v)] : v);
    }
    /* Apara a cauda que expandirTarefas() reporia igual. Só a que volta como
       "" exato: aparar um false o traria de volta como "", trocando o tipo de
       impedida por um valor que ainda é falsy mas não é mais booleano. */
    while(linha.length){
      c = cols[linha.length-1];
      dec = dicts[c] ? dicts[c][linha[linha.length-1]] : linha[linha.length-1];
      if(dec === "") linha.pop(); else break;
    }
    rows.push(linha);
  }
  return {v:PACOTE_V, cols:cols, dicts:dicts, rows:rows};
}

/* Aceita os dois formatos e devolve sempre lista de objetos — daqui pra frente
   nada mais no painel precisa saber que o formato compacto existe. */
function expandirTarefas(p){
  if(Array.isArray(p)) return p;                       // pacote antigo
  if(!p || !Array.isArray(p.cols) || !Array.isArray(p.rows)) return [];
  var cols = p.cols, dicts = p.dicts || {}, out = [], i, j, c, v, linha, t;
  for(i=0;i<p.rows.length;i++){
    linha = p.rows[i]; t = {};
    for(j=0;j<cols.length;j++){
      c = cols[j];
      if(j >= linha.length){ t[c] = ""; continue; }     // cauda aparada
      v = linha[j];
      if(dicts[c]){ v = dicts[c][v]; if(v === undefined) v = ""; }
      t[c] = v;
    }
    out.push(t);
  }
  return out;
}

/* O cache local é um bônus, não a fonte do painel: o documento publicado traz
   o pacote inteiro no bloco de estado e aplicarReplicado() o adota a cada
   abertura. Ele cabe cada vez menos — o navegador conta o localStorage em
   UTF-16, então o pacote compacto de ~2,9 MB de texto pesa ~5,8 MB de cota,
   acima dos 5 MB por origem — e por isso a falha aqui é tratada como rotina,
   sem aviso na tela: era ele que aparecia a cada carregamento do Jira.

   O que sustentava aquele aviso era um risco real que agora não existe mais:
   marcar o carimbo sem ter guardado nada fazia a abertura seguinte pular a
   adoção e subir o painel VAZIO. Hoje aplicarReplicado() só pula a adoção se
   as tarefas estiverem de fato carregadas, então não há mais o que avisar.
   A função segue dizendo se guardou, porque quem chama usa isso para decidir
   se vale marcar o carimbo. */
var cacheCabe = true;
function salvar(){
  var guardou = true;
  /* Depois da primeira recusa não se tenta de novo nesta sessão: serializar
     megabytes a cada gravação só para ver o mesmo erro custa mais que o cache
     jamais devolveria. */
  if(cacheCabe){
    try{
      localStorage.setItem(LS_DADOS, JSON.stringify({tarefas:compactarTarefas(state.tarefas), total:state.total}));
      localStorage.setItem(LS_META, JSON.stringify(metaLocal()));
    }catch(e){
      guardou = false;
      cacheCabe = false;
      /* Fora o que tenha sobrado: meio pacote é pior que nenhum, porque
         carregarLocal() confiaria nele na próxima abertura. */
      try{ localStorage.removeItem(LS_DADOS); localStorage.removeItem(LS_META); }catch(e2){}
    }
  } else {
    guardou = false;
  }
  agendarComp();
  return guardou;
}
function metaLocal(){
  return {ultimoSync:state.ultimoSync, syncGeral:state.syncGeral, syncPessoa:state.syncPessoa};
}
/* Só os carimbos, sem marcar pendência. É o caso da sincronização que não
   trouxe nada: o frescor mudou e vale guardar aqui, mas publicar isso
   recarregaria a tela de todo mundo para não mostrar diferença nenhuma. */
function salvarMeta(){
  if(!cacheCabe) return;
  try{ localStorage.setItem(LS_META, JSON.stringify(metaLocal())); }catch(e){}
}
/* Versão escolhida e analista da checklist são de quem está olhando, não do
   time: ficam só aqui e de propósito NÃO entram no pacote replicado. */
function salvarPref(){
  try{ localStorage.setItem(LS_PESSOA, JSON.stringify({versaoSel:state.versaoSel, pessoa:state.pessoa,
    colunas:state.colunas, statusSel:state.statusSel, hgSort:state.hgSort})); }catch(e){}
  salvarColunasServidor();
}
function salvarCheck(){
  try{ localStorage.setItem(LS_CHECK, JSON.stringify(state.check)); }
  catch(e){ avisar("err","Não deu pra guardar a checklist no armazenamento local."); }
}
function atualizarCheck(patch){
  if(typeof patch === "function") patch = patch(state.check);
  state.check = Object.assign({}, state.check, patch);
  salvarCheck();
}
function carregarLocal(){
  try{
    var m = JSON.parse(localStorage.getItem(LS_META)||"null");
    if(m){
      if(m.ultimoSync) state.ultimoSync = m.ultimoSync;
      /* Cache gravado por uma versão anterior do painel só tem o ultimoSync;
         ele faz as vezes do geral, que é o que valia antes destes campos. */
      state.syncGeral = m.syncGeral || m.ultimoSync || null;
      if(m.syncPessoa && typeof m.syncPessoa === "object") state.syncPessoa = m.syncPessoa;
    }
  }catch(e){}
  try{
    var d = JSON.parse(localStorage.getItem(LS_DADOS)||"null");
    if(d){
      if(d.tarefas) state.tarefas = expandirTarefas(d.tarefas);
      if(typeof d.total === "number") state.total = d.total;
    }
  }catch(e){}
  try{
    var pp = JSON.parse(localStorage.getItem(LS_PESSOA)||"null");
    if(pp){
      if(pp.pessoa) state.pessoa = pp.pessoa;
      if(typeof pp.versaoSel === "string") state.versaoSel = pp.versaoSel;
      if(pp.colunas) adotarColunas(pp.colunas);
      else if(Array.isArray(pp.ocultas)){ state.colunas.tarefas = pp.ocultas.slice(); state.colunas.versoes = pp.ocultas.slice(); }
      if(Array.isArray(pp.statusSel)) state.statusSel = pp.statusSel;
      if(pp.hgSort && typeof pp.hgSort.col === "string"){
        state.hgSort = {col:pp.hgSort.col, dir:pp.hgSort.dir==="desc" ? "desc" : "asc"};
      }
    }
  }catch(e){}
  try{
    var c = JSON.parse(localStorage.getItem(LS_CHECK)||"null");
    if(c) state.check = Object.assign({}, CHECK_VAZIO, c);
  }catch(e){}
  inicializarCheck();
}

/* Recortes do pacote único. Nenhum deles busca no Jira: o carregamento é um só,
   e as abas são vistas sobre a mesma lista — foi essa duplicação (uma consulta
   por versão e outra por analista) que fazia as abas discordarem entre si. */
/* ---------- versão: o que o Jira diz e o que o time ajustou ----------
   Às vezes a versão da tarefa ainda não foi corrigida no Jira, e aí o recorte
   do release sai errado das duas formas: falta uma tarefa que entra e sobra uma
   que não entra. Então o time pode dizer a versão aqui, e é ela que vale em
   TODAS as abas — recorte da aba Versões, seletor de versão, grupos da
   Homologação, busca e exportação. Valer só em um lugar seria pior que o
   problema: duas telas do mesmo painel discordando sobre o mesmo release.

   Discordar do Jira em silêncio também não serve, então a linha ajustada leva
   marca e o valor do Jira fica no title.

   check.versaoAjuste: chave -> lista de versões. Lista vazia = "sem versão".
   Ausente = o que vier do Jira. É campo do time, como a ordem. */
function versoesDoJira(t){
  return String(t.versoes||"").split(",").map(function(x){ return x.trim(); }).filter(Boolean);
}
function ajusteDeVersao(t){
  var a = (state.check.versaoAjuste || {})[t.key];
  return Array.isArray(a) ? a : null;
}
function versoesDe(t){
  var a = ajusteDeVersao(t);
  return a ? a.slice() : versoesDoJira(t);
}
/* Texto da versão para as células, já com o ajuste. O "—" é para não deixar a
   célula muda quando a tarefa está sem versão. */
function versoesTexto(t){
  var vs = versoesDe(t);
  return vs.length ? vs.join(", ") : "";
}
function tituloVersao(t){
  var a = ajusteDeVersao(t);
  if(!a) return versoesTexto(t);
  var jira = versoesDoJira(t);
  return "Ajustado no painel para " + (a.length ? a.join(", ") : "sem versão")
    + " — no Jira: " + (jira.length ? jira.join(", ") : "sem versão");
}
function versoesPresentes(){
  var s = {};
  state.tarefas.forEach(function(t){ versoesDe(t).forEach(function(v){ s[v]=true; }); });
  return Object.keys(s).sort(function(a,b){ return b.localeCompare(a,"pt-BR"); });
}
/* Conjunto base da aba corrente: Tarefas vê tudo; Versões vê o recorte. */
/* Valor de uma coluna como ela aparece na tela — é sobre esse texto que o
   filtro da coluna decide, senão "Interna" e "23/09/26" nunca casariam. */
function valorDaColuna(t, id){
  if(id==="cliente") return infoCliente(t).nome;
  if(id==="prazo") return fmtData(t.prazo);
  if(id==="impedida") return t.impedida ? "Sim" : "Não";
  if(id==="updated") return fmtDataHora(t.updated);
  if(id==="resolvido") return fmtData(t.resolvido);
  if(id==="criado" || id==="primeiraResp") return fmtDataHora(t[id]);
  return t[id]==null ? "" : String(t[id]);
}
/* Os valores de uma tarefa numa coluna multi. Cliente é lista no Jira
   ("A, B"), e o filtro escolhe CLIENTE, não combinação — senão "A, B" seria
   uma opção à parte e marcar "A" não traria a tarefa. Interna segue sendo um
   valor só, o mesmo que a célula mostra. */
function valoresMulti(t, id){
  if(id==="cliente"){
    var cli = infoCliente(t);
    return cli.externo ? cli.nome.split(", ") : ["Interna"];
  }
  var v = valorDaColuna(t, id);
  return v ? [v] : [];
}
/* Filtro multi é lista; lista vazia é filtro DESLIGADO. Sem isto o [] passaria
   por "ligado" (array vazio é truthy) e o Limpar filtros ficaria aceso à toa. */
function filtroLigado(v){ return Array.isArray(v) ? v.length>0 : !!v; }
function opcoesMulti(id){
  var s = {};
  tarefasDaAba().forEach(function(t){
    valoresMulti(t, id).forEach(function(v){ s[v] = (s[v]||0) + 1; });
  });
  return Object.keys(s).sort(function(a,b){
    if(a==="Interna") return -1; if(b==="Interna") return 1;
    return a.localeCompare(b,"pt-BR");
  }).map(function(v){ return {v:v, n:s[v]}; });
}
/* Retomada de antes desta versão guardava o cliente como texto ("A, B"). */
function normalizarFiltros(){
  COLUNAS.forEach(function(c){
    var v = state.filtros[c.id];
    if(c.tipo==="multi" && typeof v === "string") state.filtros[c.id] = v ? v.split(", ") : [];
    if(c.tipo==="enum" && typeof v === "string") state.filtros[c.id] = v ? [v] : [];
  });
}
function colunasVisiveis(){
  var v = ordenarColunas(abaDaTabela(), COLUNAS.map(function(c){ return c.id; }))
    .map(function(id){ return COLUNA_POR_ID[id]; })
    .filter(function(c){ return c && state.ocultas.indexOf(c.id)===-1; });
  return v.length ? v : [COLUNAS[0]];   // nunca deixa a tabela sem nenhuma coluna
}
function statusPresentesTab(){
  var s = {};
  tarefasDaAba().forEach(function(t){ if(t.status) s[t.status]=true; });
  return Object.keys(s).sort(function(a,b){
    var ia = FASES.findIndex(function(f){ return f.id===FASE_POR_STATUS[norm(a)]; });
    var ib = FASES.findIndex(function(f){ return f.id===FASE_POR_STATUS[norm(b)]; });
    if(ia!==ib) return ia-ib;
    return a.localeCompare(b,"pt-BR");
  });
}
function temFiltroAtivo(){
  return !!((state.aba==="versoes" && state.fase) || state.statusSel.length ||
            Object.keys(state.filtros).some(function(k){ return filtroLigado(state.filtros[k]); }));
}
function tarefasDaAba(){
  if(state.aba!=="versoes" || !state.versaoSel) return state.tarefas;
  if(state.versaoSel===SEM_VERSAO) return state.tarefas.filter(function(t){ return versoesDe(t).length===0; });
  var alvo = state.versaoSel;
  return state.tarefas.filter(function(t){ return versoesDe(t).indexOf(alvo)!==-1; });
}

/* Na primeira vez classifica os status sozinho, pelas mesmas regras do Painel
   de Tarefas: "fila de teste" = onde a tarefa está esperando por você; "já
   testada" = o que passou do teste; "ocultos" = Finalizada e Análise
   Reprovada, que seguem no pacote para poderem ser conferidas mas ficam fora
   da checklist. Depois disso a escolha manual prevalece. */
function inicializarCheck(){
  if(!state.tarefas.length) return;
  var c = state.check;
  var patch = {};
  if(!c.inicOcultos){
    var fim = {};
    state.tarefas.forEach(function(t){ var s=t.status||SEM_STATUS; if(!(s in fim) && statusPareceEspecial(s)) fim[s]=true; });
    patch.statusOcultos = Object.keys(fim); patch.inicOcultos = true;
  }
  if(!c.inicTeste){
    var teste = {};
    state.tarefas.forEach(function(t){ var s=t.status||SEM_STATUS; if(!(s in teste) && pareceTesteAtivo(s)) teste[s]=true; });
    patch.statusTeste = Object.keys(teste); patch.inicTeste = true;
  }
  if(!c.inicFeito){
    var feito = {};
    state.tarefas.forEach(function(t){ var s=t.status||SEM_STATUS; if(!(s in feito) && pareceFeito(s)) feito[s]=true; });
    patch.statusFeito = Object.keys(feito); patch.inicFeito = true;
  }

  /* Status que o Jira passou a usar depois da última vez: classifica sozinho
     pelas mesmas regras, sem tocar em status que já foram vistos antes (mesmo
     que alguém tenha desmarcado na mão). */
  var vistos = new Set(c.statusesVistos || []);
  var todosAtuais = todosStatusLista();
  var novos = todosAtuais.filter(function(s){ return !vistos.has(s); });
  if(novos.length){
    var novoOcultos = (patch.statusOcultos || c.statusOcultos).slice();
    var novoTeste   = (patch.statusTeste   || c.statusTeste).slice();
    var novoFeito   = (patch.statusFeito   || c.statusFeito).slice();
    novos.forEach(function(s){
      if(statusPareceEspecial(s) && novoOcultos.indexOf(s)===-1) novoOcultos.push(s);
      if(pareceTesteAtivo(s)     && novoTeste.indexOf(s)===-1)   novoTeste.push(s);
      if(pareceFeito(s)          && novoFeito.indexOf(s)===-1)   novoFeito.push(s);
    });
    patch.statusOcultos = novoOcultos;
    patch.statusTeste = novoTeste;
    patch.statusFeito = novoFeito;
    patch.statusesVistos = todosAtuais;
  }

  if(Object.keys(patch).length) atualizarCheck(patch);
}

/* Uma tarefa dispensada que MUDOU de status e caiu na fila de teste volta
   sozinha para a fila, marcada como "voltou" — senão ela ficaria escondida
   justamente quando passou a ser a vez de testá-la. */
function revivarSeNecessario(){
  var chaves = Object.keys(state.check.dispensadas);
  if(!chaves.length || !state.check.statusTeste.length) return;
  var teste = testeSetNormalizado();
  var porChave = new Map(state.tarefas.map(function(t){return [t.key,t];}));
  var dispensadas = Object.assign({}, state.check.dispensadas);
  var revividas = Object.assign({}, state.check.revividas);
  var mudou = false;
  chaves.forEach(function(k){
    var t = porChave.get(k); if(!t) return;
    var registro = dispensadas[k];
    var statusMudou = registro && norm(registro.status||SEM_STATUS) !== norm(t.status||SEM_STATUS);
    if(statusMudou && teste.has(norm(t.status || SEM_STATUS))){
      delete dispensadas[k]; revividas[k] = new Date().toISOString(); mudou = true;
    }
  });
  if(mudou) atualizarCheck({dispensadas:dispensadas, revividas:revividas});
}

/* O "ok" some sozinho depois de alguns segundos; erro e aviso FICAM, porque
   mensagem de erro que some sozinha é mensagem perdida. O "info" também fica:
   é o texto de carregamento, que se reescreve a cada página e é substituído
   pelo resultado no fim — apagá-lo no meio deixaria a tela muda trabalhando.
   Nunca houve temporizador aqui. O que fazia a mensagem sumir era a RECARGA da
   replicação automática, que chegava logo depois e subia a página limpa: no
   modo Manual ela nunca sumiu, e desde que a sincronização sem novidade deixou
   de publicar (ver salvarMeta) ela também parou de sumir no automático. */
var AVISO_OK_MS = 5000;
var AVISO_SAIDA_MS = 280;
var avisoTimer = null, avisoSaida = null, avisoGeracao = 0;
/* A geração invalida uma saída em andamento: se outra mensagem entrar no meio
   do fade, o temporizador dela não pode apagar a nova. */
function pararTimerAviso(){
  if(avisoTimer){ clearTimeout(avisoTimer); avisoTimer = null; }
  if(avisoSaida){ clearTimeout(avisoSaida); avisoSaida = null; }
  avisoGeracao++;
}
function semAnimacao(){
  try{ return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  catch(e){ return false; }
}
function sumirAviso(){
  var bar = el["aviso"];
  if(!bar || bar.classList.contains("hidden")){ state.aviso = null; return; }
  if(semAnimacao()){ state.aviso = null; renderAviso(); return; }
  var meu = ++avisoGeracao;
  /* A altura é MEDIDA na hora: a mensagem quebra em mais de uma linha conforme
     o texto, e um max-height fixo ou cortaria a longa, ou animaria um vão vazio
     depois da curta. */
  bar.style.maxHeight = bar.scrollHeight + "px";
  /* Dois quadros. Sem o primeiro, o navegador junta a altura medida e o zero
     numa única mudança de estilo e não há transição nenhuma para animar. */
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      if(meu !== avisoGeracao) return;
      bar.classList.add("saindo");
      avisoSaida = setTimeout(function(){
        avisoSaida = null;
        if(meu !== avisoGeracao) return;
        state.aviso = null;
        renderAviso();
      }, AVISO_SAIDA_MS);
    });
  });
}
function avisar(tipo, texto){
  pararTimerAviso();
  state.aviso = {tipo:tipo, texto:texto};
  renderAviso();
  /* Toda mensagem some sozinha depois de 5 s, seja de sucesso, informação,
     alerta ou erro. */
  avisoTimer = setTimeout(function(){
    avisoTimer = null;
    sumirAviso();
  }, AVISO_OK_MS);
}

/* ===================== Jira ===================== */
function jiraDisponivel(){ return window.nimitz.connected && !window.nimitz.preview; }




function msgErro(err){ return (err && err.message) || "Não foi possível consultar o Jira."; }

function chamarJira(jql, modo, cursor){
  if(modo === "count") return window.nimitz.count(jql).then(function(total){ return {total:total}; });
  return window.nimitz.search(jql, CAMPOS, cursor).then(function(r){
    r.issues.forEach(function(n){
      if(n.fields && n.fields.status) n.fields.statusCategory = n.fields.status.statusCategory;
    });
    return {nodes:r.issues, nextPageToken:r.nextPageToken, isLast:r.isLast};
  });
}

function jqlTudo(){
  /* Projeto inteiro, sem recorte de versão nem de status: o pacote replicado
     precisa conter a foto completa, e as abas recortam em cima dele. */
  return 'project = '+PROJETO;
}

function mapear(node){
  var f = node.fields || {};
  function pessoa(x){ return (x && x.displayName) || ""; }
  function opcoes(x){
    if(Array.isArray(x)) return x.map(function(o){ return o && (o.value || o.name); }).filter(Boolean).join(", ");
    if(x && typeof x === "object") return x.value || x.name || "";
    return x ? String(x) : "";
  }
  return {
    key:         node.key || "",
    summary:     f.summary || "",
    type:        (f.issuetype && f.issuetype.name) || "",
    status:      (f.status && f.status.name) || "",
    priority:    (f.priority && f.priority.name) || "",
    versoes:     (f.fixVersions||[]).map(function(v){ return v.name; }).join(", "),
    prazo:       f.customfield_10044 || f.duedate || "",
    testAnalyst: pessoa(f.customfield_10048),
    testAnalystId: ((f.customfield_10048||{}).accountId||""),
    devId:       ((f.customfield_10047||{}).accountId||""),
    dev:         pessoa(f.customfield_10047),
    cliente:     opcoes(f.customfield_10343),
    ticket:      (f.customfield_10212==null ? "" : String(f.customfield_10212)),
    estimativa:  (f.customfield_10115==null ? "" : String(f.customfield_10115)),
    impedida:    !!f.customfield_10024,
    rank:        (f.customfield_10011==null ? "" : String(f.customfield_10011)),
    updated:     f.updated || "",
    resolvido:   f.resolutiondate || "",
    assignee: pessoa(f.assignee),
    reporter: pessoa(f.reporter),
    creator: pessoa(f.creator),
    analistaReq: pessoa(f.customfield_10057),
    analistaReqId: ((f.customfield_10057||{}).accountId||""),
    analiseTecnica: pessoa(f.customfield_10093),
    ux: pessoa(f.customfield_10129),
    devOrigem: pessoa(f.customfield_10096),
    reqOrigem: pessoa(f.customfield_10172),
    testeOrigem: pessoa(f.customfield_10097),
    squad: opcoes(f.customfield_10071),
    modulo: opcoes(f.customfield_10346),
    rotina: opcoes(f.customfield_10169),
    impacto: opcoes(f.customfield_10078),
    clienteNimitz: opcoes(f.customfield_10253),
    origemBug: opcoes(f.customfield_10173),
    classifBug: opcoes(f.customfield_10184),
    criticidadeBug: opcoes(f.customfield_10166),
    bugGerado: opcoes(f.customfield_10069),
    classifMelhoria: opcoes(f.customfield_10180),
    gerarDpu: opcoes(f.customfield_10270),
    iaRequisitos: opcoes(f.customfield_10958),
    iaTestes: opcoes(f.customfield_10959),
    iaDesenv: opcoes(f.customfield_10960),
    motivoReprovT: opcoes(f.customfield_10038),
    motivoReprovA: opcoes(f.customfield_10053),
    resolucao: (f.resolution && f.resolution.name) || "",
    catStatus: (f.statusCategory && f.statusCategory.name) || "",
    versaoEntrega: (f.customfield_10150||[]).map(function(v){ return v && v.name; }).filter(Boolean).join(", "),
    versoesAfet: (f.versions||[]).map(function(v){ return v && v.name; }).filter(Boolean).join(", "),
    componentes: (f.components||[]).map(function(v){ return v && v.name; }).filter(Boolean).join(", "),
    etiquetas: (f.labels||[]).join(", "),
    pai: (f.parent && f.parent.key) || "",
    tarefaOrigem: (f.customfield_10095==null ? "" : String(f.customfield_10095)),
    branch: (f.customfield_10215==null ? "" : String(f.customfield_10215)),
    motivoReprov: (f.customfield_10060==null ? "" : String(f.customfield_10060)),
    criado: f.created || "",
    primeiraResp: f.customfield_10012 || "",
    estDesenv: (f.customfield_10114==null ? "" : String(f.customfield_10114)),
    estRequisitos: (f.customfield_10178==null ? "" : String(f.customfield_10178)),
    estUX: (f.customfield_10824==null ? "" : String(f.customfield_10824)),
    estAnaliseTec: (f.customfield_10825==null ? "" : String(f.customfield_10825)),
    qtdReprov: (f.customfield_10076==null ? "" : String(f.customfield_10076)),
    qtdMotivos: (f.customfield_10594==null ? "" : String(f.customfield_10594)),
    qtdReprovAnt: (f.customfield_10626==null ? "" : String(f.customfield_10626)),
    gut: (f.customfield_10031==null ? "" : String(f.customfield_10031)),
    tempoGasto: (f.timespent==null ? "" : String(Math.round(f.timespent/360)/10)),
    razaoTrab: (f.workratio==null ? "" : String(f.workratio))
  };
}

/* ---------------------------------------------------------------
   Carregamento de uma versão.

   O conector corta a resposta por TAMANHO e ainda injeta a descrição
   inteira de cada tarefa (~14KB), então uma consulta devolve só ~5
   tarefas — e vem com hasNextPage:false mesmo havendo mais, ou seja
   NÃO existe cursor para paginar. Medido: pedir 100 devolveu 5 nodes
   com remainingCount:16.

   A saída é paginar pela própria chave: cada rodada pede
   "... AND key > <última chave>" ordenado por chave. Isso é exato e
   termina sozinho. No fim, comparo com o total que o Jira informa e,
   se faltar alguma, digo isso na cara — em vez de mostrar uma versão
   incompleta como se estivesse certa.
   --------------------------------------------------------------- */
function carregarPorJql(base, rotulo, aoTerminar){
  if(!jiraDisponivel()){ avisar("info","Abra Conexão para configurar o Jira. A prévia permite testar os dados salvos."); return; }
  if(state.carregando) return;
  state.carregando = true; state.cancelar = false; state.progresso = 0;
  renderTopo();
  var coletadas = [], vistas = Object.create(null), cursores = Object.create(null);
  function rodada(cursor){
    if(state.cancelar) return Promise.resolve();
    state.progresso = coletadas.length; renderTopo();
    return chamarJira(base, "issues", cursor).then(function(r){
      r.nodes.forEach(function(n){
        if(n.key && !vistas[n.key]){ vistas[n.key]=true; coletadas.push(mapear(n)); }
      });
      if(r.isLast) return;
      if(!r.nextPageToken || cursores[r.nextPageToken]) throw new Error("O Jira retornou uma paginação inconsistente. Os dados anteriores foram preservados.");
      cursores[r.nextPageToken] = true;
      return rodada(r.nextPageToken);
    });
  }
  return rodada(null).then(function(){
    state.carregando = false;
    if(state.cancelar){ renderTopo(); avisar("ok","Atualização interrompida. Os dados anteriores foram preservados."); return; }
    window.nimitz.rememberCount(base, coletadas.length);
    aoTerminar(coletadas, coletadas.length, {vazio:!coletadas.length, interrompido:false});
  }).catch(function(err){ state.carregando=false; renderTopo(); avisar("err",msgErro(err)); });
}

function carregarTudo(){
  carregarPorJql(jqlTudo(), "o projeto "+PROJETO, function(lista, total, info){
    state.tarefas = lista;
    state.total = total;
    carimbarGeral();
    /* Carga do zero: o projeto inteiro é o frescor de toda pessoa, e carimbo
       por pessoa aqui só repetiria um instante mais antigo que este. */
    state.syncPessoa = {};
    /* Se a versão que estava selecionada sumiu do projeto, volta para todas. */
    if(state.versaoSel && state.versaoSel!==SEM_VERSAO && versoesPresentes().indexOf(state.versaoSel)===-1) state.versaoSel = "";
    salvar();
    inicializarCheck();
    if(info.vazio){
      avisar("ok","O projeto "+PROJETO+" não devolveu nenhuma tarefa.");
    } else if(info.interrompido){
      avisar("ok","Interrompido. "+lista.length+" de "+total+" tarefa(s) carregadas.");
    } else if(total - lista.length > 0){
      avisar("err","O Jira informou "+total+" tarefa(s), mas só "+lista.length+" voltaram. "
        +"Faltaram "+(total-lista.length)+" — clique em Recarregar para tentar de novo.");
    } else {
      avisar("ok",lista.length.toLocaleString("pt-BR")+" tarefa(s) carregadas.");
    }
    renderTudo();
  });
}

/* Junta o resultado de uma atualizacao no conjunto local: quem ja existe e
   substituido pela versao nova, quem nao existe entra no fim. */
function mesclar(lista){
  var pos = Object.create(null);
  state.tarefas.forEach(function(t,i){ pos[t.key] = i; });
  var base = state.tarefas.slice(), novas = 0, atualizadas = 0;
  lista.forEach(function(t){
    if(pos[t.key] === undefined){ pos[t.key] = base.length; base.push(t); novas++; }
    else { base[pos[t.key]] = t; atualizadas++; }
  });
  state.tarefas = base;
  return {novas:novas, atualizadas:atualizadas};
}

/* A janela por "updated" não enxerga o que SAIU: tarefa apagada ou movida de
   projeto ficaria aqui para sempre. Por isso o Atualizar também lista as
   CHAVES do projeto (só a chave, milhares por página no Jira) e acerta a
   diferença sozinho: tira daqui o que não existe mais e busca o que faltar.
   Lista no máximo a cada CONFERIR_CHAVES_MS, que saída de tarefa é rara. */
var CONFERIR_CHAVES_MS = 15*60*1000, chavesConferidasEm = 0;
function chavesDoProjeto(){
  var chaves = Object.create(null), cursores = Object.create(null), n = 0;
  function pagina(cursor){
    return window.nimitz.search(jqlTudo(), ["key"], cursor).then(function(r){
      r.issues.forEach(function(i){ if(i.key && !chaves[i.key]){ chaves[i.key] = true; n++; } });
      if(r.isLast) return;
      if(!r.nextPageToken || cursores[r.nextPageToken]) throw new Error("Paginação inconsistente.");
      cursores[r.nextPageToken] = true;
      return pagina(r.nextPageToken);
    });
  }
  return pagina(null).then(function(){ return {chaves:chaves, total:n}; });
}
function conferirTotal(){
  if(Date.now() - chavesConferidasEm < CONFERIR_CHAVES_MS) return Promise.resolve("");
  return chavesDoProjeto().then(function(r){
    chavesConferidasEm = Date.now();
    if(state.carregando) return "";
    state.total = r.total;
    var aqui = Object.create(null);
    var antes = state.tarefas.length;
    state.tarefas = state.tarefas.filter(function(t){ aqui[t.key] = true; return r.chaves[t.key]; });
    var saiu = antes - state.tarefas.length;
    var faltam = Object.keys(r.chaves).filter(function(k){ return !aqui[k]; });
    function fechar(novas){
      if(saiu || novas){ salvar(); inicializarCheck(); renderTudo(); } else renderTopo();
      return [saiu ? saiu+" saíram (apagadas ou movidas de projeto)" : "",
              novas ? novas+" que faltavam foram trazidas" : ""].filter(Boolean).join(", ");
    }
    if(!faltam.length) return fechar(0);
    var trazidas = [];
    function lote(i){
      if(i >= faltam.length) return Promise.resolve();
      var pedaco = faltam.slice(i, i+50);
      function pag(cursor){
        return chamarJira('project = '+PROJETO+' AND key in ("'+pedaco.join('","')+'")', "issues", cursor).then(function(x){
          x.nodes.forEach(function(nd){ if(nd.key) trazidas.push(mapear(nd)); });
          if(!x.isLast && x.nextPageToken) return pag(x.nextPageToken);
        });
      }
      return pag(null).then(function(){ return lote(i+50); });
    }
    return lote(0).then(function(){
      if(state.carregando) return "";
      if(trazidas.length) mesclar(trazidas);
      return fechar(trazidas.length);
    });
  }).catch(function(e){ console.warn("Não deu para conferir as chaves do projeto:", msgErro(e)); return ""; });
}

/* Quantos minutos de janela cabem a partir de um carimbo — ou null quando ele
   nao serve (ausente, no futuro, ou velho demais para compensar), e ai quem
   chama refaz do zero. Uso janela RELATIVA ("-90m"), que o Jira avalia no
   servidor: data absoluta seria uma armadilha, porque o fuso da conta do Jira
   pode nao ser o do navegador e uma janela deslocada em horas perderia
   mudancas sem avisar ninguem.
   Os 5 min de margem cobrem relogio fora de sincronia e a duracao do proprio
   carregamento anterior; o custo e reprocessar umas poucas tarefas. */
var JANELA_MAX_MIN = 44640;   // ~31 dias: alem disso nao compensa
function janelaMinutos(desde){
  if(!desde) return null;
  var decorrido = Date.now() - new Date(desde).getTime();
  if(!isFinite(decorrido) || decorrido < 0) return null;
  var minutos = Math.ceil(decorrido/60000) + 5;
  return minutos > JANELA_MAX_MIN ? null : minutos;
}
function carimbarGeral(){
  state.syncGeral = new Date().toISOString();
  state.ultimoSync = state.syncGeral;
}

/* Atualizacao incremental: pede so o que mudou desde o ultimo carregamento. */
function atualizar(){
  if(!state.tarefas.length){ carregarTudo(); return; }
  /* Do syncGeral, e nao do ultimoSync: este ultimo tambem anda quando alguem
     sincroniza UMA pessoa, e ler o campo errado aqui faria a atualizacao do
     projeto comecar depois daquele instante e pular tudo que mudou antes. */
  var minutos = janelaMinutos(state.syncGeral);
  if(minutos === null){ carregarTudo(); return; }

  carregarPorJql(jqlTudo()+' AND updated >= "-'+minutos+'m"',
    "mudanças desde o último carregamento", function(lista, total, info){
    var r = info.vazio ? {atualizadas:0, novas:0} : mesclar(lista);
    carimbarGeral();
    salvar();
    if(!info.vazio){ inicializarCheck(); revivarSeNecessario(); }
    renderTudo();
    var msg = info.interrompido ? "Interrompido. "+lista.length+" de "+total+" mudança(s) aplicadas"
      : info.vazio ? "Tudo em dia: nada mudou no Jira"
      : r.atualizadas+" tarefa(s) atualizada(s), "+r.novas+" nova(s)";
    conferirTotal().then(function(extra){ avisar("ok", msg + (extra ? "; "+extra : "") + "."); });
  });
}

/* ===================== derivados ===================== */
function contagemPorFase(lista){
  var c = {};
  FASES.forEach(function(f){ c[f.id] = 0; });
  lista.forEach(function(t){ c[faseDe(t)]++; });
  return c;
}
function filtradas(){
  var sel = state.statusSel.length ? state.statusSel.map(norm) : null;
  var ativos = COLUNAS.filter(function(c){ return c.tipo!=="status" && filtroLigado(state.filtros[c.id]); });
  return tarefasDaAba().filter(function(t){
    if(state.aba==="versoes" && state.fase && faseDe(t)!==state.fase) return false;
    if(sel && sel.indexOf(norm(t.status))===-1) return false;
    for(var i=0;i<ativos.length;i++){
      var c = ativos[i], v = state.filtros[c.id];
      if(c.tipo==="multi"){
        if(!valoresMulti(t, c.id).some(function(x){ return v.indexOf(x)!==-1; })) return false;
        continue;
      }
      var alvo = valorDaColuna(t, c.id);
      if(c.tipo==="enum"){ if((Array.isArray(v) ? v : [v]).indexOf(alvo)===-1) return false; }
      else if(norm(alvo).indexOf(norm(v))===-1) return false;
    }
    return true;
  });
}
function ordenadas(lista){
  var col = state.sort.col, dir = state.sort.dir==="desc" ? -1 : 1;
  return lista.slice().sort(function(a,b){
    var va, vb;
    if(col==="prazo"){
      var da = parseData(a.prazo), db = parseData(b.prazo);
      // Sem prazo vai sempre para o fim, independente da direção.
      if(!da && !db) return 0;
      if(!da) return 1;
      if(!db) return -1;
      return (da.getTime()-db.getTime())*dir;
    }
    if(col==="key"){
      var na = Number((a.key.match(/(\d+)$/)||[])[1]||0);
      var nb = Number((b.key.match(/(\d+)$/)||[])[1]||0);
      return (na-nb)*dir;
    }
    if(col==="status"){
      var ia = FASES.findIndex(function(f){ return f.id===faseDe(a); });
      var ib = FASES.findIndex(function(f){ return f.id===faseDe(b); });
      if(ia!==ib) return (ia-ib)*dir;
      va = a.status; vb = b.status;
    } else if(col==="cliente"){
      var ca = infoCliente(a), cb = infoCliente(b);
      // Interna vai sempre para o fim, independente da direção (pedido do Eduardo).
      if(ca.externo !== cb.externo) return ca.externo ? -1 : 1;
      va = ca.nome; vb = cb.nome;
    } else if(COL_NUMERICAS[col]){
      var xa = parseFloat(String(a[col]||"").replace(",",".")), xb = parseFloat(String(b[col]||"").replace(",","."));
      var ka = isFinite(xa), kb = isFinite(xb);
      if(ka && kb) return (xa-xb)*dir;
      if(ka !== kb) return ka ? -1 : 1;   // vazio sempre no fim
      return 0;
    } else {
      va = a[col]||""; vb = b[col]||"";
    }
    return String(va).localeCompare(String(vb),"pt-BR")*dir;
  });
}


/* ===================== prévia e retomada =====================
   A prévia local (?preview=1) entrega um pacote no <script id="estado-replicado">;
   aplicarReplicado() o adota. A equipe recebe os dados pelo compartilhamento
   do servidor (ver "dados compartilhados"), não por aqui. */
var REPLICA = {aplicando:false, carimbo:null};
var LS_CARIMBO = window.nimitz.storagePrefix+"carimboReplica";
var LS_RETOMAR = window.nimitz.storagePrefix+"retomar";

/* O que viaja para todo mundo — e, principalmente, o que NÃO viaja:
     - preferência de quem está olhando: aba, busca, filtros da tabela, versão
       e analista escolhidos. Nada disso é do time.
     - decisão pessoal da checklist: dispensadas, mantidas e revividas. Os
       botões dizem "só para você", e agora é verdade: cada um tem a sua
       marcação, e ninguém tira tarefa da fila dos outros.
   A ORDEM das tarefas viaja, porque é combinação do time — quem arrasta aqui
   está definindo a ordem para todos, do mesmo jeito que o rank do board. */
var CAMPOS_CHECK_TIME = ["ordem","statusOcultos","statusTeste","statusFeito","statusesVistos",
                         /* Ligar a gravação no Jira é decisão do time, não de
                            quem abriu a aba: uma chave só local daria a cada
                            view o direito de escrever na tarefa de todo mundo,
                            e ninguém saberia que alguém a ligou. */
                         "hgGravaJira",
                         "inicOcultos","inicTeste","inicFeito",
                         /* A homologação geral era uma planilha compartilhada: a marca e a
                            observação são do time, não de quem está olhando. */
                         "homolog","homologObs",
                         /* Quem entra e quem sai da fila também é combinação do time:
                            a planilha recebia e perdia linha na mão, e essa decisão
                            precisa valer para quem for homologar, não só para quem
                            clicou. */
                         "hgExtra","hgFora",
                         /* Versão atual ou próxima é o corte da RODADA, decidido na
                            reunião de homologação: se ficasse só na máquina de quem
                            clicou, cada um veria uma rodada diferente. São dois
                            campos porque o padrão agora vem do status, e a decisão
                            do time precisa poder ser registrada nos DOIS sentidos. */
                         "hgProx","hgAtual",
                         /* A versão ajustada muda o recorte do release para todos — é
                            uma correção do dado, não uma preferência de tela. */
                         "versaoAjuste"];
function checkDoTime(c){
  c = c || state.check;
  var o = {};
  /* Pula o que nao existe: um pacote antigo pode nao ter todos os campos, e
     copiar undefined em cima apagaria o valor local que ja estava bom. */
  CAMPOS_CHECK_TIME.forEach(function(k){ if(c[k] !== undefined) o[k] = c[k]; });
  return o;
}
function lerEstadoReplicado(){
  var no = document.getElementById("estado-replicado");
  if(!no) return null;
  var txt = (no.textContent||"").trim();
  if(!txt) return null;
  try{ var o = JSON.parse(txt); return (o && o.carimbo) ? o : null; }
  catch(e){ return null; }
}

/* Adota o pacote quando ele mudou desde a última vez que este navegador o viu.
   "Já vi" só pula a adoção se as tarefas estiverem de fato aqui: o cache local
   pode não caber na cota do navegador. */
function aplicarReplicado(){
  var rep = lerEstadoReplicado();
  if(!rep) return;
  var visto = null;
  try{ visto = localStorage.getItem(LS_CARIMBO); }catch(e){}
  REPLICA.carimbo = rep.carimbo;
  if(visto === rep.carimbo && state.tarefas.length) return;
  REPLICA.aplicando = true;
  try{
    if(rep.tarefas) state.tarefas = expandirTarefas(rep.tarefas);
    if(typeof rep.total === "number") state.total = rep.total;
    if(rep.ultimoSync) state.ultimoSync = rep.ultimoSync;
    state.syncGeral = rep.syncGeral || rep.ultimoSync || null;
    state.syncPessoa = (rep.syncPessoa && typeof rep.syncPessoa === "object")
      ? Object.assign({}, rep.syncPessoa) : {};
    /* Só o recorte do time entra; dispensadas/mantidas/revividas seguem
       sendo as deste navegador. */
    if(rep.check) state.check = Object.assign({}, CHECK_VAZIO, state.check, checkDoTime(rep.check));
    var guardou = salvar();
    salvarCheck();
    if(guardou){ try{ localStorage.setItem(LS_CARIMBO, rep.carimbo); }catch(e){} }
  } finally { REPLICA.aplicando = false; }
}

/* Onde a pessoa estava (aba, buscas, filtros, fase e rolagens) fica guardado
   na saída da página e volta depois do F5. Versão e analista escolhidos já
   ficam no localStorage, por salvarPref(). */
function guardarRetomada(){
  try{
    sessionStorage.setItem(LS_RETOMAR, JSON.stringify({
      aba: state.aba,
      clBusca: state.clBusca,
      fase: state.fase,
      filtros: state.filtros,
      hg: {busca:state.hgBusca, versao:state.hgVersao, status:state.hgStatus, soPendentes:state.hgSoPendentes,
           verFora:state.hgVerFora},
      rolagemHg: el["hg-list"] ? el["hg-list"].scrollTop : 0,
      rolagem: el["cl-list"] ? el["cl-list"].scrollTop : 0,
      rolagemTab: el["scroll"] ? el["scroll"].scrollTop : 0
    }));
  }catch(e){}
}

var RETOMADA = null;
function lerRetomada(){
  try{
    RETOMADA = JSON.parse(sessionStorage.getItem(LS_RETOMAR)||"null");
    sessionStorage.removeItem(LS_RETOMAR);
  }catch(e){ RETOMADA = null; }
  carregarRascunho();
  carregarVersoesCache();
  if(!RETOMADA) return;
  if(RETOMADA.aba) state.aba = RETOMADA.aba;
  if(typeof RETOMADA.clBusca === "string") state.clBusca = RETOMADA.clBusca;
  if(RETOMADA.fase) state.fase = RETOMADA.fase;
  /* Antes do render: a linha de filtros do cabeçalho é montada a partir de
     state.filtros, então restaurar aqui já devolve o que estava escolhido. */
  if(RETOMADA.filtros && typeof RETOMADA.filtros === "object"){ state.filtros = RETOMADA.filtros; normalizarFiltros(); }
  var hg = RETOMADA.hg;
  if(hg && typeof hg === "object"){
    if(typeof hg.busca === "string") state.hgBusca = hg.busca;
    if(typeof hg.versao === "string") state.hgVersao = hg.versao;
    if(typeof hg.status === "string") state.hgStatus = hg.status;
    state.hgSoPendentes = !!hg.soPendentes;
    state.hgVerFora = !!hg.verFora;
  }
}
function aplicarRetomada(){
  if(!RETOMADA) return;
  if(el["in-busca-cl"]) el["in-busca-cl"].value = state.clBusca || "";
  if(el["cl-list"] && RETOMADA.rolagem) el["cl-list"].scrollTop = RETOMADA.rolagem;
  if(el["in-busca-hg"]) el["in-busca-hg"].value = state.hgBusca || "";
  if(el["hg-list"] && RETOMADA.rolagemHg) el["hg-list"].scrollTop = RETOMADA.rolagemHg;
  /* Depois de renderTudo(): é ele que põe os espaçadores da virtualização de
     pé, e sem a altura reservada a rolagem não teria para onde ir. */
  if(el["scroll"] && RETOMADA.rolagemTab) el["scroll"].scrollTop = RETOMADA.rolagemTab;
  RETOMADA = null;
}
function iniciarRetomada(){
  addEventListener("pagehide", guardarRetomada);
  lerRetomada();
}

/* ===================== render ===================== */
var el = {};
function montarShell(){
  document.getElementById("app").innerHTML =
    '<header class="topbar">'
  +   '<div class="brand"><img src="./nimitz-ship.svg" width="38" height="38" alt="Nimitz — navio" style="flex:none">'
  +     '<span class="brand-txt"><b>Versões Nimitz</b></span></div>'
  +   '<nav class="abas">'
  +     '<button class="aba-btn on" data-aba="tarefas">'+icon("table",14)+' Tarefas</button>'
  +     '<button class="aba-btn" data-aba="versoes">'+icon("tag",14)+' Versões</button>'
  +     '<button class="aba-btn" data-aba="checklist">'+icon("check",14)+' Checklist <span class="badge hidden" id="badge-cl">0</span></button>'
  +     '<button class="aba-btn" data-aba="homolog">'+icon("flask",14)+' Homologação <span class="badge hidden" id="badge-hg">0</span></button>'
  +     '<button class="aba-btn" data-aba="ponto">'+icon("clock",14)+' Registro <span id="ponto-timer-badge" class="badge" hidden></span></button>'
  +   '</nav>'
  +   '<button class="btn btn-primary" id="bt-carregar">'+icon("refresh",14,"ic-load")+' Atualizar</button>'
  +   '<button class="btn hidden" id="bt-parar">'+icon("x",14)+' Parar</button>'
  +   '<div class="topo-stats" id="topo-stats"></div>'
  + '</header>'
  + '<div class="statusbar hidden" id="aviso"></div>'

  /* ---------- aba Versão ---------- */
  + '<div class="painel" id="painel-ponto"></div>'
  + '<div class="painel on" id="painel-tabela">'
  +   '<section class="resumo hidden" id="resumo"></section>'
  +   '<div class="toolbar hidden" id="toolbar">'
  +     '<div class="dd"><button class="btn hidden" id="bt-status">'+icon("flag",14)+' Status <span class="contador" id="ct-status"></span></button>'
  +       '<div class="pop hidden" id="pop-status"><div class="pop-cab">Status exibidos. Nenhum marcado significa <b>todos</b>.</div>'
  +       '<div class="pop-acoes"><button data-st="todos">Marcar todos</button><button data-st="nenhum">Limpar</button></div>'
  +       '<div class="pop-lista" id="lista-status"></div></div></div>'
  +     '<button class="btn hidden" id="bt-limpar">'+icon("x",13)+' Limpar filtros</button>'
  /* Mesmo botão e mesmo menu de colunas das quatro abas (ver botaoColunas). */
  +     '<div class="dd"><button class="btn" id="bt-colunas">'+icon("table",14)+' Colunas <span class="contador" id="ct-colunas"></span></button>'
  +       '<div class="pop hidden" id="pop-colunas"><div class="pop-cab">Colunas desta lista. A escolha é sua e fica salva na sua conta.</div>'
  +       '<div class="pop-acoes"><button data-cols="padrao">Padrão</button><button data-cols="limpar">Tirar campos extras</button></div>'
  +       '<div class="pop-lista" id="lista-colunas"></div></div></div>'
  /* Versão escolhida na própria barra da aba Versões, ao lado de Colunas: a
     barra de cima fica igual em todas as abas. */
  +     '<div class="campo-versao hidden" id="cx-versao">'
  +       '<select class="sel-inline" id="sel-versao" title="Recorta a lista por versão"></select>'
  +     '</div>'
  +     '<div class="toolbar-dir"><span id="cont-linhas"></span>'
  +       '<button class="btn" id="bt-export">'+icon("down",14)+' Exportar</button></div>'
  +   '</div>'
  +   '<div class="tabela-scroll" id="scroll">'
  +     '<table id="tabela"><colgroup id="colgroup"></colgroup>'
  +       '<thead id="thead"></thead><tbody id="tbody"></tbody></table>'
  +     '<div class="vazio hidden" id="vazio"></div>'
  +   '</div>'
  +   '<div class="dd" id="dd-multi"><div class="pop pop-fixo hidden" id="pop-multi">'
  /* Marcar não fecha nem aplica: a seleção vale quando se clica em Filtrar. */
  +     '<div class="pop-cab pop-cab-acao"><span id="multi-cab"></span>'
  +       '<button type="button" class="btn btn-primary btn-sm" id="bt-multi-filtrar">Filtrar</button></div>'
  +     '<div class="pop-search">'+icon("search",13)+'<input id="in-busca-multi" placeholder="Buscar"></div>'
  +     '<div class="pop-acoes"><button data-mt="todos" id="bt-multi-todos">Marcar todos</button>'
  +       '<button data-mt="externos" id="bt-multi-ext">Só externos</button>'
  +       '<button data-mt="nenhum">Limpar</button></div>'
  +     '<div class="pop-lista" id="lista-multi"></div></div></div>'
  +   '<footer class="rodape" id="rodape"></footer>'
  + '</div>'

  /* ---------- aba Checklist (a mesma do Painel de Tarefas) ---------- */
  + '<div class="painel" id="painel-checklist">'
  +   '<div class="cl-head">'
  +     '<div class="dd" id="dd-pessoa">'
  +       '<button class="pessoa-btn" id="bt-pessoa"><span class="pessoa-avatar" id="pessoa-iniciais">•</span>'
  +       '<span><span class="pessoa-nome" id="pessoa-nome">Todas as pessoas</span>'
  +       '<span class="pessoa-sub" id="pessoa-sub">0 tarefas</span></span>'
  +       icon("chevd",14,"chev")+'</button>'
  +       '<div class="pop hidden" id="pop-pessoa"><div class="pop-search">'+icon("search",13)
  +         '<input id="in-busca-pessoa" placeholder="Digite o nome…"></div>'
  +         '<div class="pop-lista" id="pop-pessoa-lista"></div></div>'
  +     '</div>'
  +     '<div style="display:flex;align-items:center;gap:10px;">'
  +       '<div class="trilha estreita"><div class="trilha-cheia" id="trilha-cheia" style="width:0%"></div></div>'
  +       '<span class="trilha-txt" id="trilha-txt"></span></div>'
  +     '<div class="state-pills" id="state-pills"></div>'
  +   '</div>'
  +   '<div class="toolbar">'
  +     '<div class="busca">'+icon("search",13)+'<input id="in-busca-cl" placeholder="Filtrar"></div>'
  +     '<div class="dd" id="dd-status"><button class="btn" id="bt-cl-status">'+icon("filter",14)
  +       ' Status <span class="contador" id="ct-cl-status"></span></button>'
  +       '<div class="pop wide hidden" id="pop-cl-status"><div class="pop-acoes"><button id="st-todos">Todos</button>'
  +       '<button id="st-nenhum">Nenhum</button><button id="st-pendentes">Só pendentes</button></div>'
  +       '<div class="pop-lista" id="pop-cl-status-lista"></div></div></div>'
  +     '<div class="dd" id="dd-teste"><button class="btn" id="bt-teste" title="Status que ficam em destaque e reativam uma tarefa dispensada">'
  +       icon("flask",14)+' Fila de teste <span class="contador" id="ct-teste"></span></button>'
  +       '<div class="pop wide hidden" id="pop-teste"><div class="pop-cab">Os status marcados aqui aparecem em '
  +       'destaque. Se uma tarefa dispensada voltar para um deles, ela é reativada sozinha.</div>'
  +       '<div class="pop-lista" id="pop-teste-lista"></div></div></div>'
  +     '<div class="dd" id="dd-feito"><button class="btn" id="bt-feito" title="Status que já marcam a tarefa como feita">'
  +       icon("checkcheck",14)+' Já testada <span class="contador" id="ct-feito"></span></button>'
  +       '<div class="pop wide hidden" id="pop-feito"><div class="pop-cab">Tarefas nestes status já entram como '
  +       'feitas e vão para o fim da lista, riscadas. Se você desmarcar na mão, sua escolha prevalece.</div>'
  +       '<div class="pop-lista" id="pop-feito-lista"></div></div></div>'
  +     botaoColunas("checklist")
  +     '<div class="toolbar-dir" id="cl-toolbar-dir">'
  +       '<select id="sel-ordenacao" class="sel-inline" title="Como ordenar a lista. '
  +         'Prioridade vai da maior para a menor e desempata pela data de entrega mais '
  +         'distante; a ordem definida é a que se arrasta aqui e também vale para todo o time.">'
  +         '<option value="prioridade">Prioridade</option>'
  +         '<option value="entrega">Prazo de entrega</option>'
  +         '<option value="manual">Ordem definida</option>'
  +       '</select>'
  +     '</div>'
  +   '</div>'
  +   '<div class="cl-list" id="cl-list">'
  /* Vazio: renderClCols() desenha, porque agora o cabeçalho é interativo. */
  +     '<div class="cl-cols" id="cl-cols"></div>'
  +     '<div id="cl-rows"></div>'
  +   '</div>'
  + '</div>'

  /* ---------- aba Homologação geral ---------- */
  + '<div class="painel" id="painel-homolog">'
  +   '<div class="cl-head">'
  +     '<div><div class="rotulo">Homologação geral</div>'
  +       '<div class="hg-sub" id="hg-sub"></div></div>'
  +     '<div style="display:flex;align-items:center;gap:10px;">'
  +       '<div class="trilha estreita"><div class="trilha-cheia" id="hg-trilha" style="width:0%"></div></div>'
  +       '<span class="trilha-txt" id="hg-trilha-txt"></span></div>'
  +     '<div class="state-pills" id="hg-pills"></div>'
  +   '</div>'
  +   '<div class="toolbar">'
  +     '<div class="busca">'+icon("search",13)+'<input id="in-busca-hg" placeholder="Filtrar"></div>'
  +     '<select id="sel-hg-versao" class="sel-inline" title="Recorta a fila por versão"></select>'
  /* Os status saem dos dados em renderHomolog(): com tarefa posta na mão a
     fila tem status que não estão em STATUS_HOMOLOG. */
  +     '<select id="sel-hg-status" class="sel-inline" title="Recorta a fila por status">'
  +       '<option value="">Todos os status</option></select>'
  +     '<button class="btn" id="bt-hg-pendentes" title="Mostra só o que ainda não foi testado em homologação geral">'
  +       icon("flask",14)+' Só não testadas</button>'
  +     '<div class="dd" id="dd-hg-add">'
  +       '<button class="btn" id="bt-hg-add" title="Põe na fila de homologação, na versão atual, uma tarefa de qualquer status">'
  +         icon("mais",14)+' Adicionar tarefa</button>'
  +       '<div class="pop wide hidden" id="pop-hg-add">'
  +         '<div class="pop-cab" id="hg-add-cab"></div>'
  +         '<div class="pop-search">'+icon("search",13)+'<input id="in-busca-hg-add" placeholder="Chave ou resumo…"></div>'
  +         '<div class="pop-lista" id="pop-hg-add-lista"></div></div>'
  +     '</div>'
  +     '<button class="btn hidden" id="bt-hg-fora" title="Mostra as tarefas que o time tirou da fila, para conferir ou trazer de volta">'
  +       icon("ban",14)+' Removidas <span class="contador" id="ct-hg-fora"></span></button>'
  /* A chave da gravação. Segmentada e escrita, como a da replicação: dá para
     saber em qual estado se está sem clicar em nada. É decisão do TIME e viaja
     no pacote — quem abre o painel não deveria ganhar sozinho o direito de
     escrever no Jira de todo mundo —, e nasce em NÃO. */
  +     '<div class="seg" style="margin-left:var(--sp-2);"><span class="seg-lab">Versão grava no Jira</span>'
  +       '<span class="seg-cx"><button type="button" id="bt-hg-grava-nao">Não</button>'
  +       '<button type="button" id="bt-hg-grava-sim">Sim</button></span></div>'
  +     botaoColunas("homolog")
  +     '<div class="toolbar-dir"><span id="hg-cont"></span></div>'
  +   '</div>'
  +   '<div class="hg-lote hidden" id="hg-lote">'+icon("alert",14)
  +     '<span class="msg" id="hg-lote-msg"></span>'
  +     '<button class="btn" id="bt-hg-descartar">Descartar</button>'
  +     '<button class="btn btn-primary" id="bt-hg-aplicar">'+icon("check",14)+' Aplicar no Jira</button>'
  +   '</div>'
  +   '<div class="hg-list" id="hg-list">'
  /* Vazio: o cabeçalho é desenhado por renderHgCols(), porque agora é
     interativo — a seta muda de coluna a cada clique. */
  +     '<div class="hg-cols" id="hg-cols"></div>'
  +     '<div id="hg-rows"></div>'
  +   '</div>'
  + '</div>';

  ["bt-carregar","bt-parar","topo-stats","aviso","resumo","toolbar",
   "bt-limpar","cont-linhas","bt-export","bt-colunas","pop-colunas","lista-colunas","ct-colunas",
   "bt-status","pop-status","lista-status","ct-status",
   "pop-multi","multi-cab","bt-multi-filtrar","in-busca-multi","lista-multi","bt-multi-todos","bt-multi-ext",
   "scroll","tabela","colgroup","thead","tbody","vazio","rodape","cx-versao","sel-versao",
   "badge-cl","badge-hg","painel-tabela","painel-checklist","painel-homolog",
   "hg-sub","hg-trilha","hg-trilha-txt","hg-pills","in-busca-hg","sel-hg-versao","sel-hg-status",
   "bt-hg-pendentes","hg-cont","hg-list","hg-rows","hg-cols",
   "bt-hg-add","pop-hg-add","pop-hg-add-lista","in-busca-hg-add","hg-add-cab","bt-hg-fora","ct-hg-fora",
   "bt-hg-grava-nao","bt-hg-grava-sim",
   "hg-lote","hg-lote-msg","bt-hg-descartar","bt-hg-aplicar",
   "bt-pessoa","pop-pessoa","pop-pessoa-lista","in-busca-pessoa","pessoa-iniciais","pessoa-nome","pessoa-sub",
   "trilha-cheia","trilha-txt","state-pills","in-busca-cl",
   "bt-cl-status","pop-cl-status","pop-cl-status-lista","ct-cl-status",
   "bt-teste","pop-teste","pop-teste-lista","ct-teste",
   "bt-feito","pop-feito","pop-feito-lista","ct-feito",
   "sel-ordenacao","cl-list","cl-rows","cl-cols","cl-toolbar-dir"
  ].forEach(function(id){ el[id]=document.getElementById(id); });
}

function pontoButton(key){
  return '<button type="button" class="ponto-shortcut" data-ponto-key="'+esc(key)+'" title="Cronometrar '+esc(key)+'" aria-label="Cronometrar '+esc(key)+'">⏱</button>';
}
function renderTopo(){
  /* PONTO_INTEGRATION */
  document.getElementById("painel-ponto").classList.toggle("on",state.aba==="ponto");
  if(window.nimitz.setPontoActive) window.nimitz.setPontoActive(state.aba==="ponto");
  var naTabela = state.aba==="tarefas" || state.aba==="versoes";
  el["cx-versao"].classList.toggle("hidden", state.aba!=="versoes");
  el["painel-tabela"].classList.toggle("on", naTabela);
  el["painel-checklist"].classList.toggle("on", state.aba==="checklist");
  el["painel-homolog"].classList.toggle("on", state.aba==="homolog");
  document.querySelectorAll(".aba-btn").forEach(function(b){
    b.classList.toggle("on", b.getAttribute("data-aba")===state.aba);
  });

  el["bt-carregar"].disabled = state.carregando;
  el["bt-parar"].classList.toggle("hidden", !state.carregando);
  el["bt-parar"].disabled = state.cancelar;
  el["bt-parar"].innerHTML = state.cancelar ? "Parando…" : icon("x",14)+" Parar";
  /* Um único botão de atualizar, o da barra, em todas as abas de tarefas.
     Com dados na mão ele pede ao Jira só as tarefas alteradas desde a última
     atualização; sem dados (ou parado há mais de um mês) traz o projeto todo. */
  var incremental = state.tarefas.length>0 && janelaMinutos(state.syncGeral) !== null;
  /* O andamento fica no próprio botão: a faixa de mensagens só mostra o
     resultado de quem clicou, uma vez, e some sozinha. */
  el["bt-carregar"].innerHTML = icon("refresh",14,"ic-load"+(state.carregando?" spin":""))
    + (state.carregando ? " Atualizando…"+(state.progresso ? " "+state.progresso.toLocaleString("pt-BR") : "") : " Atualizar");
  el["bt-carregar"].title = incremental
    ? "Busca no Jira só as tarefas alteradas desde "+fmtDataHora(state.syncGeral)
    : "Traz todas as tarefas do projeto";
  /* Sempre no mesmo lugar, em todas as abas: a barra de cima não muda. */

  /* Os dois seletores saem dos dados carregados — nao ha mais campo livre,
     entao nao da pra pedir uma versao ou um nome que nao existe. */
  var temSemVersao = state.tarefas.some(function(t){ return versoesDe(t).length===0; });
  el["sel-versao"].innerHTML = '<option value="">Todas as versões</option>'
    + (temSemVersao ? '<option value="'+esc(SEM_VERSAO)+'">Sem versão</option>' : "")
    + versoesPresentes().map(function(v){ return '<option value="'+esc(v)+'">'+esc(v)+'</option>'; }).join("");
  el["sel-versao"].value = state.versaoSel;

  var h = "";
  if(state.tarefas.length){
    if(state.aba==="checklist"){
      h += '<span><b>'+clDerivados().noFiltro.length.toLocaleString("pt-BR")+'</b> na checklist</span>';
    } else if(state.aba==="homolog"){
      h += '<span><b>'+tarefasHomolog().length.toLocaleString("pt-BR")+'</b> na homologação</span>';
    } else {
      var n = tarefasDaAba().length;
      h += '<span><b>'+n.toLocaleString("pt-BR")+'</b> '
         + (state.aba==="versoes" && state.versaoSel ? "na versão" : "no projeto") + '</span>';
    }
    if(state.ultimoSync) h += '<span>Atualizado <b style="font-size:var(--fs-xs);color:var(--text-muted);">'+fmtDataHora(state.ultimoSync)+'</b></span>';
  }
  el["topo-stats"].innerHTML = h;

  var prontas = clDerivados().resumo.teste;
  if(prontas>0){ el["badge-cl"].textContent = prontas; el["badge-cl"].classList.remove("hidden"); }
  else el["badge-cl"].classList.add("hidden");

  /* O badge da Homologação conta o que falta testar — é a pergunta que a aba
     responde, e é ela que faz o número valer um aviso. */
  var faltaHg = tarefasHomolog().filter(function(t){ return !hgMarcada(t); }).length;
  if(faltaHg>0){ el["badge-hg"].textContent = faltaHg; el["badge-hg"].classList.remove("hidden"); }
  else el["badge-hg"].classList.add("hidden");
}

function renderAviso(){
  var bar = el["aviso"];
  /* Some o rastro da animação nos dois caminhos: escondida com .saindo e com a
     altura travada em zero, a barra seguinte subiria invisível. */
  if(!state.aviso){
    bar.classList.add("hidden");
    bar.classList.remove("saindo");
    bar.style.maxHeight = "";
    bar._tipo = null;
    return;
  }
  bar.classList.remove("hidden");
  bar.classList.remove("saindo");
  bar.style.maxHeight = "";
  var tipo = state.aviso.tipo;
  /* Só remonta quando o TIPO muda: durante o carregamento a mensagem é
     reescrita a cada página e, remontando, a animação do loader
     reiniciaria do zero e o ícone pareceria travado. */
  if(bar._tipo !== tipo){
    bar._tipo = tipo;
    bar.className = "statusbar "+(tipo==="ok"?"ok":tipo==="info"?"info":tipo==="warn"?"warn":"err");
    var ic = tipo==="ok" ? icon("check",14) : tipo==="info" ? icon("loader",14,"spin") : icon("alert",14);
    bar.innerHTML = ic+'<span class="msg"></span><button class="x" id="bt-fechar-aviso">'+icon("x",14)+'</button>';
    document.getElementById("bt-fechar-aviso").onclick = function(){
      pararTimerAviso(); sumirAviso(); };
  }
  bar.querySelector(".msg").textContent = state.aviso.texto;
}

function renderResumo(){
  if(state.aba!=="versoes"){ el["resumo"].classList.add("hidden"); return; }
  var base = tarefasDaAba();
  if(!base.length){ el["resumo"].classList.add("hidden"); return; }
  el["resumo"].classList.remove("hidden");
  var c = contagemPorFase(base);
  var total = base.length;
  var feitas = c.final;
  var pct = total ? Math.round((feitas/total)*100) : 0;

  var segmentos = FASES.filter(function(f){ return c[f.id]>0; }).map(function(f){
    return '<i style="width:'+((c[f.id]/total)*100).toFixed(2)+'%;background:'+f.cor+'" title="'+esc(f.rotulo)+': '+c[f.id]+'"></i>';
  }).join("");

  var bugs = base.filter(function(t){ return norm(t.type)==="bug"; }).length;
  var melhorias = total - bugs;

  var tiles = FASES.filter(function(f){ return f.id!=="outro" || c.outro>0; }).map(function(f){
    var n = c[f.id];
    var p = total ? Math.round((n/total)*100) : 0;
    /* Toda fase leva ícone além da cor, não só as reservadas: é isso que faz a
       identidade não depender de cor. Aqui o ícone fica em cor de texto — quem
       carrega a cor da fase no tile é a barra .marca ao lado. */
    var marcador = f.icone ? icon(f.icone,12) : "";
    return '<button class="tile'+(state.fase===f.id?" on":"")+'" data-fase="'+f.id+'" '
      + 'title="Filtrar por '+esc(f.rotulo)+'">'
      + '<span class="marca" style="background:'+f.cor+'"></span>'
      + '<span class="corpo"><span class="n">'+n+'<em>'+p+'%</em></span>'
      + '<span class="lab">'+marcador+esc(f.rotulo)+'</span></span></button>';
  }).join("");

  el["resumo"].innerHTML =
    '<div class="progresso-bloco">'
  +   '<div class="progresso-num"><b>'+pct+'%</b><span>concluído — '+feitas+' de '+total+' tarefa(s)</span></div>'
  +   '<div class="trilha">'+segmentos+'</div>'
  +   '<div class="progresso-num"><span>'+melhorias+' melhoria(s) · '+bugs+' bug(s)</span></div>'
  + '</div>'
  + '<div class="tiles">'+tiles+'</div>';

  el["resumo"].querySelectorAll("[data-fase]").forEach(function(b){
    b.onclick = function(){
      var f = b.getAttribute("data-fase");
      state.fase = (state.fase===f) ? null : f;
      renderResumo(); renderTabela(); renderToolbar();
    };
  });
}

function renderToolbar(){
  if(!state.tarefas.length){ el["toolbar"].classList.add("hidden"); return; }
  el["toolbar"].classList.remove("hidden");

  /* Mesmo formato do menu da Checklist e da Homologação: as colunas que a aba
     mostra de saída e, embaixo, os outros campos do Jira que dá para somar. */
  var vis = colunasVisiveis().length;
  var item = function(c){ return itemColuna("data-col-tog", c.id, c.rot, state.ocultas.indexOf(c.id)===-1); };
  el["lista-colunas"].innerHTML = '<div class="pop-cab">Desta lista</div>'
    + COLUNAS.filter(function(c){ return OCULTAS_PADRAO.indexOf(c.id)===-1; }).map(item).join("")
    + '<div class="pop-cab">Mais campos do Jira</div>'
    + COLUNAS.filter(function(c){ return OCULTAS_PADRAO.indexOf(c.id)!==-1; }).map(item).join("");
  var mudou = state.ocultas.length !== OCULTAS_PADRAO.length
    || state.ocultas.some(function(id){ return OCULTAS_PADRAO.indexOf(id)===-1; });
  /* Mesmo contador nas quatro abas: visíveis/total, como o do Status. */
  el["ct-colunas"].textContent = vis+"/"+COLUNAS.length;

  var sts = statusPresentesTab();
  el["ct-status"].textContent = state.statusSel.length ? state.statusSel.length+"/"+sts.length : "";
  el["lista-status"].innerHTML = sts.length
    ? sts.map(function(x){
        var on = state.statusSel.indexOf(x)!==-1;
        var f = faseInfo(FASE_POR_STATUS[norm(x)]||"outro");
        return '<button class="pop-item'+(on?" on":"")+'" data-st-tog="'+esc(x)+'">'
          + '<span class="chk'+(on?" on":"")+'">'+(on?icon("check",10):"")+'</span>'
          + '<span style="width:7px;height:7px;border-radius:var(--r-full);flex:none;background:'+f.cor+'"></span>'
          + esc(x)+'</button>';
      }).join("")
    : '<div class="pop-cab">Carregue as tarefas para ver os status.</div>';

  el["bt-colunas"].classList.toggle("btn-on", mudou);
  el["bt-status"].classList.toggle("btn-on", state.statusSel.length>0);
  el["bt-limpar"].classList.toggle("hidden", !temFiltroAtivo());
  ligarPopsTab();
}

function ligarPopsTab(){
  el["lista-colunas"].querySelectorAll("[data-col-tog]").forEach(function(b){
    b.onclick = function(){
      var id = b.getAttribute("data-col-tog");
      var i = state.ocultas.indexOf(id);
      if(i===-1) state.ocultas = state.ocultas.concat([id]);
      else state.ocultas = state.ocultas.filter(function(x){ return x!==id; });
      salvarPref(); renderToolbar(); cabecalho(); renderTabela();
    };
  });
  el["lista-status"].querySelectorAll("[data-st-tog]").forEach(function(b){
    b.onclick = function(){
      var v = b.getAttribute("data-st-tog");
      var i = state.statusSel.indexOf(v);
      if(i===-1) state.statusSel = state.statusSel.concat([v]);
      else state.statusSel = state.statusSel.filter(function(x){ return x!==v; });
      salvarPref(); renderToolbar(); cabecalho(); renderTabela(); renderResumo();
    };
  });
}
function alternarMenuTab(qual){
  state.menuTab = state.menuTab===qual ? null : qual;
  fecharPopsTab();
}
function fecharPopsTab(){
  el["pop-colunas"].classList.toggle("hidden", state.menuTab!=="colunas");
  el["pop-status"].classList.toggle("hidden", state.menuTab!=="status");
  el["pop-multi"].classList.toggle("hidden", !(state.menuTab && state.menuTab.indexOf("multi:")===0));
}

function cabecalho(){
  var cols = colunasVisiveis();

  /* As larguras saem daqui e de nenhum outro lugar. O <colgroup> vale para as
     duas linhas do thead e para todas as do tbody, e não depende de qual linha
     é a primeira — o que importa porque a primeira linha do tbody costuma ser
     o espaçador da virtualização, um <td colspan> sem largura de coluna. */
  if(el["colgroup"]){
    el["colgroup"].innerHTML = cols.map(function(c){
      return '<col style="width:'+c.w+'px">';
    }).join("");
  }
  /* A largura definida que liga o layout fixo. Sem ela o colgroup acima seria
     ignorado e as colunas voltariam a seguir o conteúdo. */
  if(el["tabela"]){
    var largura = 0;
    cols.forEach(function(c){ largura += c.w; });
    el["tabela"].style.width = largura + "px";
  }

  var titulos = "<tr>" + cols.map(function(c){
    var on = state.sort.col===c.id;
    var seta = on ? icon(state.sort.dir==="asc"?"up":"arrowdown",11,"seta") : "";
    return '<th style="width:'+c.w+'px;min-width:'+c.w+'px;">'
      + '<button class="th-btn'+(on?" on":"")+'" data-col="'+c.id+'" draggable="true" data-move="'+c.id+'" title="Clique para ordenar; arraste para mudar a coluna de lugar">'
      + '<span class="th-lab">'+esc(c.rot)+'</span>'+seta+'</button></th>';
  }).join("") + "</tr>";

  var filtros = "<tr>" + cols.map(function(c){
    var v = state.filtros[c.id] || "";
    var campo;
    if(c.tipo==="status" || c.tipo==="multi" || c.tipo==="enum"){
      /* Lista de valores: marca vários e aplica em Filtrar (ver renderMulti). */
      var sm = selFiltro(c.id);
      campo = '<button data-fmulti="'+c.id+'" class="'+(sm.length?"ativo":"")+'"'
        + (sm.length>1 ? ' title="'+esc(sm.join(", "))+'"' : '') + '>'
        + (sm.length===0 ? "Todos" : sm.length===1 ? esc(sm[0]) : sm.length+" selecionados") + '</button>';
    } else {
      campo = '<input data-filtro="'+c.id+'" class="'+(v?"ativo":"")+'" value="'+esc(v)+'" placeholder="filtrar">';
    }
    return '<th class="th-filter">'+campo+'</th>';
  }).join("") + "</tr>";

  el["thead"].innerHTML = titulos + filtros;

  el["thead"].querySelectorAll("[data-col]").forEach(function(b){
    b.onclick = function(){
      var col = b.getAttribute("data-col");
      if(state.sort.col===col) state.sort.dir = state.sort.dir==="asc" ? "desc" : "asc";
      else state.sort = {col:col, dir:"asc"};
      cabecalho(); renderTabela();
    };
  });
  /* Campo de texto NÃO remonta o cabeçalho a cada tecla: remontar tira o
     foco do campo e a pessoa perde a digitação no meio. */
  el["thead"].querySelectorAll("input[data-filtro]").forEach(function(inp){
    inp.oninput = function(){
      state.filtros[inp.getAttribute("data-filtro")] = inp.value;
      inp.classList.toggle("ativo", !!inp.value);
      renderTabela(); renderToolbar();
    };
  });
  el["thead"].querySelectorAll("[data-fmulti]").forEach(function(b){
    b.onclick = function(e){
      e.stopPropagation();
      var id = b.getAttribute("data-fmulti");
      var abrir = state.menuTab !== "multi:"+id;
      if(abrir){ state.multiCol = id; state.multiRascunho = selFiltro(id).slice(); el["in-busca-multi"].value = ""; }
      alternarMenuTab("multi:"+id);
      if(abrir){ renderMulti(); posicionarMulti(); try{ el["in-busca-multi"].focus(); }catch(err){} }
    };
  });
  if(state.menuTab && state.menuTab.indexOf("multi:")===0) posicionarMulti();
}

/* ---------- filtro por lista de valores (Status, Cliente e colunas de opções) ----------
   Marcar e desmarcar mexe só no rascunho; Filtrar aplica e fecha. Clicar
   fora descarta o rascunho. */
function colunaMulti(){ return COLUNA_POR_ID[state.multiCol]; }
function selFiltro(id){
  if(COLUNA_POR_ID[id] && COLUNA_POR_ID[id].tipo === "status") return state.statusSel;
  var v = state.filtros[id];
  return Array.isArray(v) ? v : (typeof v === "string" && v ? [v] : []);
}
function selMulti(){ return state.multiRascunho || []; }
function opcoesFiltro(id){
  var c = COLUNA_POR_ID[id];
  if(c && c.tipo === "multi") return opcoesMulti(id);
  var s = {};
  tarefasDaAba().forEach(function(t){
    var v = c && c.tipo === "status" ? (t.status || "") : valorDaColuna(t, id);
    if(v) s[v] = (s[v]||0) + 1;
  });
  return Object.keys(s).sort(function(a,b){ return a.localeCompare(b,"pt-BR"); })
    .map(function(v){ return {v:v, n:s[v]}; });
}
function opcoesMultiVisiveis(){
  var q = norm(el["in-busca-multi"].value);
  return opcoesFiltro(state.multiCol).filter(function(o){ return !q || norm(o.v).indexOf(q)!==-1; });
}
function marcarFiltroRascunho(lista){ state.multiRascunho = lista; renderMulti(); }
function aplicarMulti(){
  var id = state.multiCol, lista = selMulti().slice();
  if(COLUNA_POR_ID[id] && COLUNA_POR_ID[id].tipo === "status"){ state.statusSel = lista; salvarPref(); }
  else if(lista.length) state.filtros[id] = lista;
  else delete state.filtros[id];
  state.menuTab = null; fecharPopsTab();
  cabecalho(); renderTabela(); renderToolbar(); renderResumo();
}
function renderMulti(){
  var c = colunaMulti();
  if(!c) return;
  var sel = selMulti(), q = el["in-busca-multi"].value.trim();
  var ops = opcoesMultiVisiveis();
  el["multi-cab"].innerHTML = '<b>'+esc(c.rot)+'</b>'+(sel.length ? ' · '+sel.length+' marcado(s)' : ' · nenhum marcado = todos');
  /* Com busca, "Marcar todos" marca só o que a busca achou — é o jeito de pegar
     de uma vez todos os "Agro…" sem clicar um por um. */
  el["bt-multi-todos"].textContent = q ? "Marcar os "+ops.length+" achados" : "Marcar todos";
  el["bt-multi-ext"].classList.toggle("hidden", c.id!=="cliente");
  el["lista-multi"].innerHTML = ops.length
    ? ops.map(function(o){
        var on = sel.indexOf(o.v)!==-1;
        return '<button class="pop-item'+(on?" on":"")+'" data-mt-tog="'+esc(o.v)+'" title="'+esc(o.v)+'">'
          + '<span class="chk'+(on?" on":"")+'">'+(on?icon("check",10):"")+'</span>'
          + '<span class="nome'+(o.v==="Interna"?" cel-faint":"")+'">'+esc(o.v)+'</span>'
          + '<span class="qtd">'+o.n+'</span></button>';
      }).join("")
    : '<div class="pop-empty">'+(q ? "Nada encontrado." : "Carregue as tarefas para ver os valores.")+'</div>';
  el["lista-multi"].querySelectorAll("[data-mt-tog]").forEach(function(b){
    /* stopPropagation: renderMulti() troca a lista, o botao clicado sai do
       DOM e o "clique fora" do document leria o clique como fora do popover. */
    b.onclick = function(e){
      e.stopPropagation();
      var v = b.getAttribute("data-mt-tog"), s = selMulti();
      marcarFiltroRascunho(s.indexOf(v)===-1 ? s.concat([v]) : s.filter(function(x){ return x!==v; }));
    };
  });
}
/* Fixo na janela, então é preciso recalcular quando a tabela rola ou o
   cabeçalho é remontado. Encosta na borda direita se não couber. */
function posicionarMulti(){
  var pop = el["pop-multi"];
  if(pop.classList.contains("hidden")) return;
  var b = el["thead"].querySelector('[data-fmulti="'+state.multiCol+'"]');
  if(!b){ state.menuTab = null; fecharPopsTab(); return; }
  var r = b.getBoundingClientRect(), w = pop.offsetWidth || 320;
  var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  pop.style.left = left+"px";
  pop.style.top = (r.bottom + 4)+"px";
}

function linhaHtml(t){
  var cli = infoCliente(t);
  var mp = marcaPrazo(t);
  /* Sem largura por célula: no layout fixo ela seria ignorada, e são dezenas de
     colunas vezes as linhas da janela em atributo morto. Quem manda é o
     colgroup. O parâmetro w segue na assinatura porque as chamadas passam c.w. */
  function td(cls, w, html, title){
    return '<td class="'+cls+'"'+(title?' title="'+esc(title)+'"':'')+'>'+html+'</td>';
  }
  var cols = {
    key:'<a class="chave" href="'+JIRA_BASE+encodeURIComponent(t.key)+'" target="_blank" rel="noreferrer">'+esc(t.key)+icon("ext",10)+'</a>'+pontoButton(t.key),
    summary:(t.impedida?icon("flag",12,"impedida")+" ":"")+esc(t.summary),
    type:tipoTag(t.type),
    status:etiquetaStatus(t.status),
    prazo:'<span class="cel-mono'+(mp.cls||" cel-faint")+'" title="'+esc(mp.titulo)+'">'+fmtData(t.prazo)+'</span>',
    priority:esc(t.priority),
    testAnalyst:esc(t.testAnalyst),
    dev:esc(t.dev),
    cliente:'<span class="'+(cli.externo?"":"cel-faint")+'">'+esc(cli.nome)+'</span>',
    ticket:'<span class="cel-mono cel-faint">'+esc(t.ticket==="0"?"":t.ticket)+'</span>',
    estimativa:'<span class="cel-mono cel-faint">'+esc(t.estimativa)+'</span>',
    versoes:'<span class="cel-faint'+(ajusteDeVersao(t)?" ajustada":"")+'" title="'+esc(tituloVersao(t))+'">'
      + esc(versoesTexto(t))+'</span>',
    impedida: t.impedida ? icon("flag",12,"impedida")+' Sim' : '<span class="cel-faint">Não</span>',
    updated:'<span class="cel-mono cel-faint">'+fmtDataHora(t.updated)+'</span>',
    resolvido:'<span class="cel-mono cel-faint">'+fmtData(t.resolvido)+'</span>',
    rank:'<span class="cel-mono cel-faint">'+esc(t.rank)+'</span>'
  };
  return "<tr>"+colunasVisiveis().map(function(c){
    var cls = (c.id==="summary"||c.id==="cliente"||c.id==="testAnalyst"||c.id==="dev"||c.id==="versoes"||c.id==="rank") ? "corta" : "";
    /* Agora TODA coluna trunca, então toda célula ganha o valor cheio no title —
       antes só Resumo e Cliente truncavam e só elas precisavam. valorDaColuna()
       devolve exatamente o texto que apareceria na tela, que é o que se quer ler
       no tooltip. */
    var title = c.id==="summary" ? t.summary
              : c.id==="cliente" ? cli.nome
              : valorDaColuna(t, c.id);
    /* Coluna sem célula própria cai no valor de exibição padrão — é o que
       faz as dezenas de campos do Jira funcionarem sem uma linha cada. */
    var conteudo = cols[c.id] !== undefined ? cols[c.id]
      : '<span class="cel-faint">' + esc(valorDaColuna(t, c.id)) + '</span>';
    return td(cls, c.w, conteudo, title);
  }).join("")+"</tr>";
}

/* ===================== janela da tabela (virtualização) =====================
   Com mais de 10 mil tarefas, montar um <tr> por linha inteira a cada tecla
   da busca travava a página. Daqui pra frente só entram no DOM as linhas que
   cabem na tela mais uma margem; o resto é altura reservada em duas linhas-
   espaçador, e a janela desliza conforme a rolagem (função ligada ao scroll
   em ligarEventos). */
var ALTURA_LINHA = null;
var MARGEM_LINHAS = 12;
var linhasAtuais = [];
var janelaAtual = { inicio: -1, fim: -1 };

function medirAlturaLinha(amostra){
  if(ALTURA_LINHA) return ALTURA_LINHA;
  el["tbody"].insertAdjacentHTML("beforeend", linhaHtml(amostra));
  var sonda = el["tbody"].lastElementChild;
  var h = sonda.getBoundingClientRect().height;
  sonda.remove();
  ALTURA_LINHA = h > 0 ? h : 33;
  return ALTURA_LINHA;
}

function desenharJanela(forcar){
  var lista = linhasAtuais, n = lista.length;
  if(!n) return;
  var h = medirAlturaLinha(lista[0]);
  var caixa = el["scroll"];
  var topo = caixa.scrollTop, altura = caixa.clientHeight || 600;
  var inicio = Math.max(0, Math.floor(topo/h) - MARGEM_LINHAS);
  var fim = Math.min(n, Math.ceil((topo+altura)/h) + MARGEM_LINHAS);
  if(!forcar && inicio===janelaAtual.inicio && fim===janelaAtual.fim) return;
  janelaAtual = { inicio: inicio, fim: fim };
  var nCols = colunasVisiveis().length;
  var espTopo = inicio>0
    ? '<tr aria-hidden="true"><td colspan="'+nCols+'" style="padding:0;border:0;height:'+(inicio*h)+'px;"></td></tr>' : "";
  var espFim = fim<n
    ? '<tr aria-hidden="true"><td colspan="'+nCols+'" style="padding:0;border:0;height:'+((n-fim)*h)+'px;"></td></tr>' : "";
  var meio = "";
  for(var i=inicio;i<fim;i++) meio += linhaHtml(lista[i]);
  el["tbody"].innerHTML = espTopo + meio + espFim;
}

function renderTabela(){
  aplicarHoras(); agendarHoras();
  var lista = ordenadas(filtradas());
  linhasAtuais = lista;
  el["cont-linhas"].textContent = lista.length===state.tarefas.length
    ? lista.length+" tarefa(s)"
    : lista.length+" de "+state.tarefas.length+" tarefa(s)";

  if(!state.tarefas.length){
    el["tbody"].innerHTML = "";
    janelaAtual = { inicio: -1, fim: -1 };
    el["vazio"].classList.remove("hidden");
    el["vazio"].innerHTML = '<span class="vazio-icn">'+icon("table",24)+'</span>'
      + '<h3>Nada carregado ainda</h3>'
      + '<p>Clique em <b>Atualizar</b> no topo para trazer todas as tarefas do projeto. '
      + 'Depois escolha as colunas, os status e os filtros de cada coluna.</p>';
    return;
  }
  if(!lista.length){
    el["tbody"].innerHTML = "";
    janelaAtual = { inicio: -1, fim: -1 };
    el["vazio"].classList.remove("hidden");
    el["vazio"].innerHTML = '<span class="vazio-icn">'+icon("search",24)+'</span>'
      + '<h3>Nenhuma tarefa bate com os filtros</h3><p>Ajuste a busca ou limpe os filtros.</p>';
    return;
  }
  el["vazio"].classList.add("hidden");
  desenharJanela(true);
}

function renderRodape(){
  var itens = FASES.filter(function(f){ return f.id!=="outro"; }).map(function(f){
    return '<i><b style="background:'+f.cor+'"></b>'+esc(f.rotulo)+'</i>';
  }).join("");
  /* As duas cores de prazo são vocabulário NOVO da tela e não se explicam
     sozinhas: sem a legenda o vermelho seria lido como "atrasada", que é só
     metade do que ele diz — ele diz "não cabe nem na versão que vem aí". A data
     da próxima subida fica escrita aqui porque é a régua de tudo. */
  var j = janelaRelease();
  var prazos = '<i><b style="background:var(--danger)"></b>vence antes da versão de '+fmtDiaMes(j.r1)+'</i>'
    + '<i><b style="background:var(--warn-text)"></b>só cabe nesta versão</i>';
  /* Fechada por padrão: um botão pequeno abre e fecha, e a escolha fica
     guardada neste navegador para a pessoa. */
  var aberta = false;
  try{ aberta = localStorage.getItem(window.nimitz.storagePrefix+"legendas") === "1"; }catch(e){}
  el["rodape"].innerHTML = '<button type="button" class="bt-legendas'+(aberta?" on":"")+'" id="bt-legendas" aria-expanded="'+aberta+'">'
    + icon(aberta ? "eyeoff" : "eye",12)+' Legendas</button>'
    + (aberta ? '<div class="legenda"><span class="rotulo">Fases</span>'+itens+'</div>'
              + '<div class="legenda"><span class="rotulo">Prazo</span>'+prazos+'</div>' : "");
  document.getElementById("bt-legendas").onclick = function(){
    try{ localStorage.setItem(window.nimitz.storagePrefix+"legendas", aberta ? "0" : "1"); }catch(e){}
    renderRodape();
  };
}

/* ===================== checklist =====================
   Mesma aba do Painel de Tarefas: seletor de pessoa com busca, filtro de
   Status, listas de "fila de teste" e "já testada", progresso que muda de
   cor, pílula das que voltaram para a fila e a mesma grade de linhas.
   O que é só daqui: a coluna Versão, o impedimento marcado no Jira (Flagged,
   que vale para todo o time) e a ordenação por prioridade. */
var ESTADOS = {
  teste:      {rotulo:"Pronta pra testar",       cor:"var(--fase-teste)"},
  dispensada: {rotulo:"Indisponível para teste", cor:"var(--fase-reprovada)"},
  feita:      {rotulo:"Feita",                   cor:"var(--fase-final)"}
};

function testeSetNormalizado(){
  return new Set(state.check.statusTeste.map(norm));
}
function estaFeita(t, feitoSet){
  return feitoSet.has(t.status || SEM_STATUS);
}
function estaDispensada(t){
  var testeSet = testeSetNormalizado();
  if(state.check.dispensadas[t.key]) return true;
  if(state.check.mantidas[t.key]) return false;
  return !testeSet.has(norm(t.status||SEM_STATUS));
}
function dispensadaAutomatica(t){
  var testeSet = testeSetNormalizado();
  return !state.check.dispensadas[t.key] && !state.check.mantidas[t.key] && !testeSet.has(norm(t.status||SEM_STATUS));
}
function estadoDe(t){
  var feitoSet = new Set(state.check.statusFeito);
  if(estaFeita(t, feitoSet)) return "feita";
  /* Impedimento marcado no Jira (Flagged) vale para TODOS e vem antes de
     qualquer decisão local: se alguém sinalizar no Jira, todo mundo vê. */
  if(t.impedida) return "dispensada";
  if(estaDispensada(t)) return "dispensada";
  return "teste";
}

/* Etiqueta de status pintada pela FASE, e não por uma paleta própria da aba:
   é o mesmo status mostrado na aba Tarefas, e duas cores diferentes para o
   mesmo status dentro do mesmo painel seria só confusão. As duas pontas do
   tint saem de var(--surface), então funciona nos dois temas. */
function etiquetaStatus(status, ligado){
  if(!status) return "";
  var f = faseInfo(FASE_POR_STATUS[norm(status)] || "outro");
  var off = ligado === false;
  return '<span class="etiqueta" style="background:'+(off?"transparent":"color-mix(in srgb, "+f.cor+" 12%, var(--surface))")
    + ';color:'+(off?"var(--text-faint)":"color-mix(in srgb, "+f.cor+" 65%, var(--text))")
    + ';border-color:'+(off?"var(--border)":"color-mix(in srgb, "+f.cor+" 35%, var(--surface))")+';">'
    + (f.icone
        ? '<span class="marca-fase" style="color:'+(off?"var(--text-faint)":f.cor)+'">'+icon(f.icone,12)+'</span>'
        : '<span class="ponto" style="background:'+(off?"var(--border-strong)":f.cor)+'"></span>')
    + '<span>'+esc(status)+'</span></span>';
}

/* Conta por pessoa só o que está de fato em jogo na checklist: tarefas em
   status ocultos (Finalizada/Análise Reprovada por padrão) seguem no pacote
   para poderem ser conferidas, mas não entram nas contagens — senão o painel
   diz "47 tarefas" quando a pessoa tem 27 na lista. */
function contagemAtivaPorPessoa(){
  var ocultosSet = new Set(state.check.statusOcultos);
  var cont = new Map();
  state.tarefas.forEach(function(t){
    var nome = t.testAnalyst||SEM_PESSOA;
    if(!cont.has(nome)) cont.set(nome, 0);
    if(!ocultosSet.has(t.status||SEM_STATUS)) cont.set(nome, cont.get(nome)+1);
  });
  return cont;
}
function totalAtivo(){
  var ocultosSet = new Set(state.check.statusOcultos);
  return state.tarefas.filter(function(t){ return !ocultosSet.has(t.status||SEM_STATUS); }).length;
}
/* Só entram no seletor as pessoas com pelo menos uma tarefa ATIVA — ou seja,
   fora dos status ocultos. Num projeto inteiro, quem tem tudo em Finalizada ou
   Análise Reprovada era ruído puro: dezenas de nomes com contagem 0.
   A pessoa já selecionada é a única exceção, senão o popover abriria sem
   nenhum item marcado justamente quando o filtro de Status zera a lista dela. */
function pessoasLista(){
  return Array.from(contagemAtivaPorPessoa().entries())
    .filter(function(p){ return p[1] > 0 || p[0] === state.pessoa; })
    .sort(function(a,b){ return a[0].localeCompare(b[0],"pt-BR"); });
}

/* Rank do board (LexoRank, ordenável como texto). Sem rank vai para o fim:
   tarefa sem posição no board não deve furar a fila de quem tem. */
/* Ordem das prioridades. Os nomes vêm do Jira — hoje são os cinco padrão
   (Highest, High, Medium, Low, Lowest) —, então o teste é por regex e não por
   lista fixa: no dia em que o projeto trocar de idioma, "Altíssima" e "Baixa"
   caem no mesmo lugar. Nome que ninguém previu fica no meio, junto de Medium:
   não convém inventar urgência nem irrelevância para ele. E "lowest" é testado
   antes de "low", como "highest" antes de "high", porque um contém o outro. */
function ordemPrioridade(p){
  var v = norm(p);
  if(!v) return 5;
  if(/blocker|critic|highest|altissim|urgent/.test(v)) return 0;
  if(/high|alta|major/.test(v)) return 1;
  if(/lowest|baixissim|trivial/.test(v)) return 4;
  if(/low|baixa|minor/.test(v)) return 3;
  return 2;
}
/* Desempate final: a chave mais nova na frente, que é o padrão do Painel de
   Tarefas. Compara o sufixo numérico, senão NMTZ-9 viria depois de NMTZ-80. */
function cmpChaveDesc(a,b){
  var na = Number((String(a.key).match(/(\d+)$/)||[])[1]||0);
  var nb = Number((String(b.key).match(/(\d+)$/)||[])[1]||0);
  return nb - na;
}
/* Prioridade primeiro; dentro da mesma prioridade, a data de entrega MAIOR na
   frente. Quem não tem data vai para o fim do próprio bloco de prioridade, e
   não para o topo: hoje são 4.754 das 10.898 tarefas sem prazo, e soltas no
   começo elas afundariam o bloco inteiro. */
function cmpPrioridade(a,b){
  var oa = ordemPrioridade(a.priority), ob = ordemPrioridade(b.priority);
  if(oa !== ob) return oa - ob;
  var da = parseData(a.prazo), db = parseData(b.prazo);
  if(!da && db) return 1;
  if(da && !db) return -1;
  if(da && db && da.getTime() !== db.getTime()) return db.getTime() - da.getTime();
  return cmpChaveDesc(a,b);
}
function ordenadasDaPessoa(pessoa){
  var base = pessoa===TODOS
    ? state.tarefas.slice()
    : state.tarefas.filter(function(t){ return (t.testAnalyst||SEM_PESSOA)===pessoa; });
  if(state.clOrdenacao === "entrega"){
    return base.sort(function(a,b){
      var da = parseData(a.prazo), db = parseData(b.prazo);
      if(!da && !db) return 0;
      if(!da) return 1;
      if(!db) return -1;
      return da.getTime() - db.getTime();
    });
  }
  /* Prioridade: a maior primeiro e, dentro dela, a entrega mais distante.
     Entrou no lugar da "Ordem do Jira" (o rank do board), que saiu da lista. */
  if(state.clOrdenacao === "prioridade"){
    return base.sort(cmpPrioridade);
  }
  var salva = state.check.ordem[pessoa] || [];
  var posicao = new Map(salva.map(function(k,i){return [k,i];}));
  return base.sort(function(a,b){
    var pa = posicao.has(a.key)?posicao.get(a.key):Infinity;
    var pb = posicao.has(b.key)?posicao.get(b.key):Infinity;
    if(pa!==pb) return pa-pb;
    /* Sem posição definida, desempata por prioridade. Era o rank do board, e
       ele saiu junto com a "Ordem do Jira": mantê-lo aqui deixaria o rank
       mandando, escondido, em toda a parte da lista que ninguém arrastou. Vale
       para quem nunca arrastou nada e para a cauda de quem já arrastou —
       tarefa nova entra depois das ordenadas, pela prioridade. */
    return cmpPrioridade(a, b);
  });
}
/* Valor da célula para ordenar. Versão e cliente não são campos crus da tarefa
   — passam pelas mesmas funções que a linha usa para exibi-los, senão a
   ordenação discordaria do que está escrito na tela. */
function clValorOrd(t, col){
  if(col === "versao") return versoesTexto(t);
  if(col === "cliente") return infoCliente(t).nome;
  if(COLUNA_POR_ID[col]) return valorDaColuna(t, col);
  return t[col] || "";
}
/* A ordenação por coluna NÃO substitui a ordem definida: ela reordena por cima
   dela, e a posição na ordem definida é o desempate. Por isso o terceiro clique
   devolve a lista exatamente como estava — e por isso blocos que empatam (Tipo,
   Status) não viram fila arbitrária dentro de si. */
function aplicarClSort(base){
  var col = state.clSort.col;
  if(!col) return base;
  var pos = new Map();
  base.forEach(function(t,i){ pos.set(t.key, i); });
  var cmp = cmpColuna(col, state.clSort.dir === "desc" ? -1 : 1, clValorOrd);
  return base.slice().sort(function(a,b){
    return cmp(a,b) || (pos.get(a.key) - pos.get(b.key));
  });
}
function daPessoaCalc(){
  /* A ordenação por coluna entra DEPOIS da ordem definida e ANTES do corte das
     concluídas: ordenar por Status não pode trazer o que já foi feito de volta
     para o meio da fila. */
  var ordenadas = aplicarClSort(ordenadasDaPessoa(state.pessoa));
  var pend=[], feitas=[];
  ordenadas.forEach(function(t){ (estadoDe(t)==="feita"?feitas:pend).push(t); });
  return pend.concat(feitas);
}
/* clDerivados() percorre e ORDENA a lista inteira, e renderChecklistAll() a
   chama meia duzia de vezes na mesma passada. Com o pacote do projeto inteiro
   (dez mil tarefas e mais) isso pesa, entao o resultado fica em cache ate que
   uma das entradas mude — comparadas por identidade, e nao por conteudo: nem
   state.tarefas nem state.check sao alterados no lugar, sempre trocados por um
   objeto novo. */
var CL_CACHE = null;
function clDerivados(){
  var c = CL_CACHE;
  if(c && c.tarefas===state.tarefas && c.check===state.check && c.pessoa===state.pessoa
     && c.busca===state.clBusca && c.ordenacao===state.clOrdenacao
     && c.sort===state.clSort){
    return c.valor;
  }
  var valor = clDerivadosCalc();
  CL_CACHE = {tarefas:state.tarefas, check:state.check, pessoa:state.pessoa, busca:state.clBusca,
              ordenacao:state.clOrdenacao, sort:state.clSort, valor:valor};
  return valor;
}
function clDerivadosCalc(){
  var daPessoa = daPessoaCalc();
  var ocultosSet = new Set(state.check.statusOcultos);
  var contS = new Map(), fimS = new Map();
  daPessoa.forEach(function(t){
    var s = t.status||SEM_STATUS;
    contS.set(s,(contS.get(s)||0)+1);
    if(!fimS.has(s)) fimS.set(s, statusPareceEspecial(s));
  });
  var statusDaPessoa = Array.from(contS.entries()).map(function(e){ return {status:e[0], qtd:e[1], fim:fimS.get(e[0])}; })
    .sort(function(a,b){ return (a.fim?1:0)-(b.fim?1:0) || a.status.localeCompare(b.status,"pt-BR"); });
  var noFiltro = daPessoa.filter(function(t){ return !ocultosSet.has(t.status||SEM_STATUS); });
  var q = norm(state.clBusca);
  var visiveis = noFiltro.filter(function(t){
    var est = estadoDe(t);
    if(q && norm([t.key,t.summary,t.status,t.squad,t.cliente,versoesTexto(t)].join(" ")).indexOf(q)===-1) return false;
    return true;
  });
  var resumo = {teste:0,dispensada:0,feita:0};
  noFiltro.forEach(function(t){ resumo[estadoDe(t)]++; });
  var qtdRevividas = noFiltro.filter(function(t){ return state.check.revividas[t.key]; }).length;
  return {daPessoa:daPessoa, statusDaPessoa:statusDaPessoa, noFiltro:noFiltro, visiveis:visiveis,
          resumo:resumo, qtdRevividas:qtdRevividas};
}

function renderPessoaBotao(){
  var pessoas = pessoasLista();
  if(state.pessoa===TODOS && pessoas.length && !state.clJaAutoSelecionou){
    state.clJaAutoSelecionou = true;
    /* Abre em quem tem mais tarefa ativa, mas nunca no balde "sem analista de
       teste": num projeto inteiro ele é o maior de todos, e não é a lista de
       ninguém — a checklist abriria sempre no lugar errado. */
    var reais = pessoas.filter(function(p){ return p[0] !== SEM_PESSOA; });
    var maior = (reais.length ? reais : pessoas).slice().sort(function(a,b){return b[1]-a[1];})[0];
    if(maior) state.pessoa = maior[0];
  }
  var rotulo = state.pessoa===TODOS ? "Todas as pessoas" : state.pessoa;
  var iniciais = state.pessoa===TODOS ? "•"
    : rotulo.split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x[0];}).join("").toUpperCase();
  el["pessoa-iniciais"].textContent = iniciais;
  el["pessoa-nome"].textContent = rotulo;
  el["pessoa-sub"].textContent = clDerivados().noFiltro.length + " tarefas";
}
function pessoasFiltradasAtual(){
  var pessoas = pessoasLista();
  var q = norm(state.clBuscaPessoa);
  var lista = [{nome:TODOS, rotulo:"Todas as pessoas", qtd:totalAtivo()}]
    .concat(pessoas.map(function(p){return {nome:p[0],rotulo:p[0],qtd:p[1]};}));
  if(q) lista = lista.filter(function(p){ return norm(p.rotulo).indexOf(q)!==-1; });
  return lista;
}
function renderPessoaLista(){
  var lista = pessoasFiltradasAtual();
  if(!lista.length){ el["pop-pessoa-lista"].innerHTML = '<div class="pop-empty">Ninguém com esse nome</div>'; return; }
  el["pop-pessoa-lista"].innerHTML = lista.map(function(p,i){
    return '<button class="pop-item'+(i===state.clDestaque?" hi":"")+(p.nome===state.pessoa?" on":"")
      + '" data-p="'+encodeURIComponent(p.nome)+'">'
      + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(p.rotulo)+'</span>'
      + '<span class="mono cel-faint" style="font-size:var(--fs-xs);">'+p.qtd+'</span>'
      + (p.nome===state.pessoa?icon("check",13):"")+'</button>';
  }).join("");
  el["pop-pessoa-lista"].querySelectorAll("[data-p]").forEach(function(btn){
    btn.onclick = function(){
      state.pessoa = decodeURIComponent(btn.getAttribute("data-p"));
      state.clBuscaPessoa = ""; el["in-busca-pessoa"].value = "";
      el["pop-pessoa"].classList.add("hidden");
      fecharTodosPopovers();
      salvarPref(); renderChecklistAll();
    };
  });
}

function corProgresso(pct){
  var hue = Math.max(0, Math.min(100, pct)) * 1.2;   // 0=vermelho, 100=verde (hue 120)
  return "hsl("+hue.toFixed(0)+",72%,45%)";
}
function renderProgressoChecklist(){
  var d = clDerivados();
  var base = d.resumo.teste + d.resumo.dispensada + d.resumo.feita;
  var pct = base ? Math.round((d.resumo.feita/base)*100) : 0;
  el["trilha-cheia"].style.width = pct+"%";
  el["trilha-cheia"].style.background = corProgresso(pct);
  el["trilha-txt"].innerHTML = "<b>"+d.resumo.feita+"</b> de "+base+" feitas";
  el["state-pills"].innerHTML = ["teste","dispensada","feita"].map(function(id){
    return '<span class="state-pill'+(id==="teste"?" emph":"")+'" title="'+ESTADOS[id].rotulo+'">'
      + '<span class="ponto" style="background:'+ESTADOS[id].cor+'"></span>'+ESTADOS[id].rotulo
      + ' <b>'+d.resumo[id]+'</b></span>';
  }).join("");
}

function todosStatusLista(){
  var set = new Set();
  state.tarefas.forEach(function(t){ set.add(t.status||SEM_STATUS); });
  return Array.from(set).sort(function(a,b){return a.localeCompare(b,"pt-BR");});
}
function statusGlobalComContagem(){
  var d = clDerivados();
  var contagem = new Map(d.statusDaPessoa.map(function(s){ return [s.status, s.qtd]; }));
  return todosStatusLista().map(function(s){
    return {status:s, qtd:contagem.get(s)||0, fim:statusPareceEspecial(s)};
  }).sort(function(a,b){ return (a.fim?1:0)-(b.fim?1:0) || a.status.localeCompare(b.status,"pt-BR"); });
}
function renderStatusPanels(){
  var ocultosSet = new Set(state.check.statusOcultos);
  var testeSet = new Set(state.check.statusTeste);
  var feitoSet = new Set(state.check.statusFeito);
  var statusGlobais = statusGlobalComContagem();

  el["ct-cl-status"].textContent = (statusGlobais.length
    - statusGlobais.filter(function(s){return ocultosSet.has(s.status);}).length)+"/"+statusGlobais.length;
  el["pop-cl-status-lista"].innerHTML = statusGlobais.map(function(s){
    var ligado = !ocultosSet.has(s.status);
    return '<button class="pop-item" data-st="'+encodeURIComponent(s.status)+'">'
      + '<span class="chk'+(ligado?" on":"")+'">'+(ligado?icon("check",10):"")+'</span>'
      + '<span style="flex:1;min-width:0;">'+etiquetaStatus(s.status, ligado)+'</span>'
      + (testeSet.has(s.status)?icon("flask",13):"")+(feitoSet.has(s.status)?icon("checkcheck",13):"")
      + '<span class="mono cel-faint" style="font-size:var(--fs-xs);margin-left:auto;">'+s.qtd+'</span></button>';
  }).join("");
  el["pop-cl-status-lista"].querySelectorAll("[data-st]").forEach(function(btn){
    btn.onclick = function(){
      var st = decodeURIComponent(btn.getAttribute("data-st"));
      var arr = state.check.statusOcultos.slice();
      var i = arr.indexOf(st);
      if(i===-1) arr.push(st); else arr.splice(i,1);
      atualizarCheck({statusOcultos:arr, inicOcultos:true});
      renderChecklistAll();
    };
  });

  var todos = todosStatusLista();
  el["ct-teste"].textContent = state.check.statusTeste.length;
  el["pop-teste-lista"].innerHTML = todos.map(function(st){
    var ligado = testeSet.has(st);
    return '<button class="pop-item" data-tt="'+encodeURIComponent(st)+'">'
      + '<span class="chk amber'+(ligado?" on":"")+'">'+(ligado?icon("check",10):"")+'</span>'
      + etiquetaStatus(st, ligado)+'</button>';
  }).join("");
  el["pop-teste-lista"].querySelectorAll("[data-tt]").forEach(function(btn){
    btn.onclick = function(){
      var st = decodeURIComponent(btn.getAttribute("data-tt"));
      var arr = state.check.statusTeste.slice(); var i = arr.indexOf(st);
      if(i===-1) arr.push(st); else arr.splice(i,1);
      atualizarCheck({statusTeste:arr, inicTeste:true});
      revivarSeNecessario();
      renderChecklistAll();
    };
  });

  el["ct-feito"].textContent = state.check.statusFeito.length;
  el["pop-feito-lista"].innerHTML = todos.map(function(st){
    var ligado = feitoSet.has(st);
    return '<button class="pop-item" data-ft="'+encodeURIComponent(st)+'">'
      + '<span class="chk green'+(ligado?" on":"")+'">'+(ligado?icon("check",10):"")+'</span>'
      + etiquetaStatus(st, ligado)+'</button>';
  }).join("");
  el["pop-feito-lista"].querySelectorAll("[data-ft]").forEach(function(btn){
    btn.onclick = function(){
      var st = decodeURIComponent(btn.getAttribute("data-ft"));
      var arr = state.check.statusFeito.slice(); var i = arr.indexOf(st);
      if(i===-1) arr.push(st); else arr.splice(i,1);
      atualizarCheck({statusFeito:arr, inicFeito:true});
      renderChecklistAll();
    };
  });
}

function renderRevivePill(){
  var d = clDerivados();
  var existente = document.getElementById("bt-revividos");
  if(existente) existente.remove();
  if(d.qtdRevividas>0){
    var btn = document.createElement("button");
    btn.className = "revive-pill"; btn.id = "bt-revividos";
    btn.innerHTML = icon("sparkles",12)+" "+d.qtdRevividas+" "+(d.qtdRevividas===1?"voltou":"voltaram")+" pra fila";
    btn.onclick = function(){
      var revividas = Object.assign({}, state.check.revividas);
      d.noFiltro.forEach(function(t){ delete revividas[t.key]; });
      atualizarCheck({revividas:revividas});
      renderChecklistAll();
    };
    el["cl-toolbar-dir"].insertBefore(btn, el["cl-toolbar-dir"].firstChild);
  }
}

var CL_COLUNAS = [
  {cls:"cl-c-grip",  rot:""},
  {cls:"cl-c-key",   rot:"Chave",      ord:"key"},
  {cls:"cl-summary", rot:"Resumo",     ord:"summary"},
  {cls:"cl-type",    rot:"Tipo",       ord:"type"},
  {cls:"cl-status",  rot:"Status",     ord:"status"},
  {cls:"cl-squad",   rot:"Squad",      ord:"squad"},
  {cls:"cl-cliente", rot:"Cliente",    ord:"cliente"},
  {cls:"cl-prio",    rot:"Prioridade", ord:"priority"},
  {cls:"cl-versao",  rot:"Versão",     ord:"versao"},
  {cls:"cl-updated", rot:"Entrega",    ord:"prazo"},
  {cls:"cl-c-act",   rot:""}
];
/* Três estados, como na Homologação: crescente, decrescente e NENHUM. Sem o
   terceiro clique não haveria como voltar à ordem definida — a que se arrasta e
   que viaja para o time — depois de espiar a lista por outra coluna. */
function clOrdenarPor(col){
  if(state.clSort.col !== col) state.clSort = {col:col, dir:"asc"};
  else if(state.clSort.dir === "asc") state.clSort = {col:col, dir:"desc"};
  else state.clSort = {col:"", dir:"asc"};
  /* De propósito SEM salvarPref(): esta ordenação não é preferência. */
  renderChecklistAll();
}
function clTituloOrd(c, on){
  if(!on) return "Ordenar por "+c.rot+" — as concluídas seguem no fim";
  return state.clSort.dir === "asc"
    ? "Ordenado por "+c.rot+", crescente — clique para inverter"
    : "Ordenado por "+c.rot+", decrescente — clique para voltar à ordem definida";
}
function renderClCols(){
  if(!el["cl-cols"]) return;
  aplicarCssColunas();
  el["cl-cols"].innerHTML = colunasCabecalho("checklist", CL_COLUNAS).map(function(c){
    var dentro;
    if(c.ord){
      var on = state.clSort.col === c.ord;
      var seta = on ? icon(state.clSort.dir==="asc" ? "up" : "arrowdown", 11, "seta") : "";
      dentro = '<button type="button" class="ord'+(on?" on":"")+'" data-ord="'+esc(c.ord)+'"'
        + ' title="'+esc(clTituloOrd(c, on))+'"><span class="lab">'+esc(c.rot)+'</span>'+seta+'</button>';
    } else {
      dentro = esc(c.rot);
    }
    return '<span class="'+c.cls+'"'+moverAttr("checklist", c)+(c.w ? ' style="width:'+c.w+'px"' : '')+'>'+dentro+'</span>';
  }).join("");
  el["cl-cols"].querySelectorAll("[data-ord]").forEach(function(b){
    b.onclick = function(){ clOrdenarPor(b.getAttribute("data-ord")); };
  });
}

function renderClList(){
  aplicarHoras(); agendarHoras();
  var d = clDerivados();
  var visiveis = d.visiveis;
  if(!visiveis.length){
    var semTarefas = state.tarefas.length===0;
    var escondidasPorStatus = !semTarefas && d.daPessoa.length>0 && d.noFiltro.length===0;
    if(escondidasPorStatus){
      var statusEscondidos = d.daPessoa.map(function(t){return t.status||SEM_STATUS;})
        .filter(function(v,i,arr){return arr.indexOf(v)===i;});
      el["cl-rows"].innerHTML = '<div class="vazio"><span class="vazio-icn">'+icon("eyeoff",24)+'</span>'
        + '<h3>'+d.daPessoa.length+' tarefa(s) escondida(s) pelo filtro de Status</h3>'
        + '<p>Todas as tarefas de <b>'+esc(state.pessoa===TODOS?"todas as pessoas":state.pessoa)+'</b> estão em status '
        + 'marcados como ocultos ('+esc(statusEscondidos.join(", "))+'). Abra o filtro "Status" e habilite algum, '
        + 'ou clique abaixo para mostrar todos.</p>'
        + '<button class="btn btn-primary" id="bt-mostrar-status" style="margin-top:4px;">'+icon("eye",14)+' Mostrar todos os status</button></div>';
      var b3 = document.getElementById("bt-mostrar-status");
      if(b3) b3.onclick = function(){ atualizarCheck({statusOcultos:[]}); renderChecklistAll(); };
      return;
    }
    el["cl-rows"].innerHTML = '<div class="vazio"><span class="vazio-icn">'+icon("list",24)+'</span>'
      + '<h3>Nada para mostrar aqui</h3><p>'
      + (semTarefas ? 'Clique em <b>Atualizar</b> no topo para trazer as tarefas do projeto '+PROJETO+'.'
                    : 'Troque a pessoa, limpe o filtro ou desligue o "Só prontas".')
      + '</p></div>';
    return;
  }
  var partes = [];
  var separadorInserido = false;
  visiveis.forEach(function(t,i){
    var estado = estadoDe(t);
    if(!separadorInserido && estado==="feita"){
      separadorInserido = true;
      partes.push('<div class="section-sep"><span>Concluídas ('+d.resumo.feita+')</span><span class="line"></span></div>');
    }
    var est = ESTADOS[estado];
    var disp = state.check.dispensadas[t.key];
    var voltou = !!state.check.revividas[t.key];
    var rowCls = estado==="dispensada" ? "rosa" : estado==="feita" ? "feita" : "";
    var faixa = estado==="dispensada"
      ? 'background-image:repeating-linear-gradient(45deg,'+est.cor+' 0 3px, transparent 3px 6px);'
      : "background-color:"+est.cor+";";
    var cli = infoCliente(t);
    var prio = prioridadeTom(t.priority);
    var autoDisp = dispensadaAutomatica(t);
    /* Tarefa já marcada como feita aqui não acende: o risco é sobre o que
       ainda precisa entrar na versão. */
    var mp = estado==="feita" ? {cls:"",titulo:"",icone:""} : marcaPrazo(t);
    var risco = estado==="feita" ? "text-decoration:line-through;color:var(--text-faint);" : "color:var(--text);";
    /* Arrastar só reordena quando a ordenação é a manual; nas outras a ordem
       salva é ignorada, e o arraste não surtiria efeito nenhum. */
    /* Arrastar com a lista ordenada por coluna gravaria para o TIME uma ordem
       que ninguém pediu: o que se vê na tela não é a ordem definida, e o solto
       seria escrito como se fosse. */
    var podeArrastar = state.clOrdenacao === "manual" && !state.clSort.col && window.nimitz.canReorder();
    partes.push('<div class="cl-row '+rowCls+'" draggable="'+(podeArrastar?"true":"false")+'"'
      + ' title="'+(podeArrastar?"":"Para reordenar arrastando, mude a ordenação para “Ordem definida”")+'"'
      + ' data-grupo="'+(estado==="feita"?"feita":"ativo")+'"'
      + ' data-key="'+encodeURIComponent(t.key)+'" data-idx="'+i+'">'
      + '<span class="cl-stripe" style="'+faixa+'"></span>'
      + '<span class="grip">'+icon("grip",14)+'</span>'
      + '<span class="ponto-key-cell"><a class="cl-key mono" style="'+risco+'" href="'+JIRA_BASE+encodeURIComponent(t.key)+'" target="_blank" rel="noreferrer">'+esc(t.key)+'</a>'+pontoButton(t.key)+'</span>'
      + '<span class="cl-summary"><span class="txt" style="'+risco+'">'+esc(t.summary)+'</span>'
      +   (voltou?'<span class="chip-mini chip-voltou">Voltou</span>':"")
      +   (t.impedida
            ? '<span class="chip-mini chip-impedida" title="Impedimento marcado no Jira — vale para todo o time">Impedida no Jira</span>'
            : estado!=="dispensada" ? ""
              : (disp ? '<span class="chip-mini chip-disp" title="Sua marcação — só você vê">Indisponível para teste '+fmtData(disp.em)+'</span>'
                      : (autoDisp ? '<span class="chip-mini chip-disp">Indisponível para teste</span>' : "")))
      + '</span>'
      + '<span class="cl-type">'+tipoTag(t.type)+'</span>'
      + '<span class="cl-status">'+etiquetaStatus(t.status)+'</span>'
      + '<span class="cl-squad cel-faint">'+esc(t.squad)+'</span>'
      + '<span class="cl-cliente'+(cli.externo?"":" cel-faint")+'" title="'+esc(cli.nome)+'">'+esc(cli.nome)+'</span>'
      + '<span class="cl-prio" style="color:'+(estado==="teste"?prio.cor:"var(--text-faint)")+';font-weight:'+(estado==="teste"?prio.peso:"400")+';">'+esc(t.priority)+'</span>'
      + '<span class="cl-versao cel-faint'+(ajusteDeVersao(t)?" ajustada":"")+'" title="'+esc(tituloVersao(t))+'">'
      +   esc(versoesTexto(t))+'</span>'
      + '<span class="cl-updated cel-faint'+mp.cls+'" title="'+esc(mp.titulo)+'">'+mp.icone+fmtData(t.prazo)+'</span>'
      + celulasExtras("checklist", t)
      + '<button class="cl-dismiss" data-act="dispensa"'+(t.impedida?' disabled style="opacity:.35;cursor:default;"':'')
      +   ' title="'+(t.impedida ? "O impedimento está marcado no Jira; tire de lá para voltar à fila"
                     : estado==="dispensada" ? "Trazer de volta para a lista ativa (só para você)"
                     : "Dispensar: sai do radar mas continua visível (só para você)")+'">'
      +   icon(t.impedida?"flag":estado==="dispensada"?"undo":"ban",15)+'</button>'
      + '</div>');
  });
  el["cl-rows"].innerHTML = partes.join("");
  wireClRows();
}

function wireClRows(){
  el["cl-list"].querySelectorAll(".cl-row").forEach(function(row){
    var key = decodeURIComponent(row.getAttribute("data-key"));
    var t = state.tarefas.filter(function(x){return x.key===key;})[0];
    if(!t) return;

    var btDisp = row.querySelector('[data-act="dispensa"]');
    if(t.impedida) btDisp.onclick = null; else btDisp.onclick = function(){
      atualizarCheck(function(c){
        var dispensadas=Object.assign({},c.dispensadas), mantidas=Object.assign({},c.mantidas), revividas=Object.assign({},c.revividas);
        var testeSet = new Set(c.statusTeste.map(norm));
        var auto = !testeSet.has(norm(t.status||SEM_STATUS));
        var jaDispensada = dispensadas[t.key] || (auto && !mantidas[t.key]);
        if(jaDispensada){ delete dispensadas[t.key]; if(auto) mantidas[t.key]=true; }
        else { delete mantidas[t.key]; if(!auto) dispensadas[t.key] = {em:new Date().toISOString(), status:t.status||SEM_STATUS}; }
        delete revividas[t.key];
        return {dispensadas:dispensadas, mantidas:mantidas, revividas:revividas};
      });
      renderChecklistAll();
    };

    row.addEventListener("dragstart", function(e){
      /* Guarda a CHAVE, não o índice: o índice deixa de valer se a lista
         rolar ou re-renderizar durante o arraste. */
      state.arrastando = key;
      state.grupoArrastando = row.getAttribute("data-grupo");
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      // Sem setData o arraste nem começa em alguns navegadores (Firefox).
      try{ e.dataTransfer.setData("text/plain", key); }catch(err){}
    });
    row.addEventListener("dragend", function(){ encerrarArraste(); });
    row.addEventListener("dragover", function(e){
      if(state.arrastando===null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      autoScrollArraste(e.clientY);
      limparIndicadores();
      /* Reordenar entre "ativas" e "Concluídas" não tem efeito, porque a
         lista sempre reagrupa as concluídas no fim — então nem sinalizamos
         como destino. */
      if(key === state.arrastando) return;
      if(row.getAttribute("data-grupo") !== state.grupoArrastando) return;
      var r = row.getBoundingClientRect();
      var depois = (e.clientY - r.top) > r.height/2;
      state.alvo = {key:key, depois:depois};
      row.classList.add(depois ? "over-abaixo" : "over");
    });
    row.addEventListener("drop", function(e){
      e.preventDefault();
      var movida = state.arrastando, alvo = state.alvo;
      encerrarArraste();
      if(!movida || !alvo || alvo.key === movida) return;
      /* A posição é decidida pela metade da linha onde o cursor estava
         (acima/abaixo), e não por comparação de índices. */
      var seq = ordenadasDaPessoa(state.pessoa).map(function(x){return x.key;});
      var de = seq.indexOf(movida);
      if(de === -1) return;
      seq.splice(de, 1);
      var pos = seq.indexOf(alvo.key);
      if(pos === -1) return;
      seq.splice(alvo.depois ? pos+1 : pos, 0, movida);
      if(!window.nimitz.preview){
        window.nimitz.saveOrder(state.pessoa,seq).catch(function(err){ avisar("err",err.message); });
        return;
      }
      var ordem = Object.assign({}, state.check.ordem);
      if(!seq.length) delete ordem[state.pessoa]; else ordem[state.pessoa]=seq;
      atualizarCheck({ordem:ordem});
      renderChecklistAll();
    });
  });
}

/* ---- arraste: indicadores, limpeza e rolagem automática ----
   Sem a rolagem automática só é possível soltar dentro do trecho já visível
   da lista, o que com muitas tarefas faz o arraste parecer quebrado. */
function limparIndicadores(){
  el["cl-list"].querySelectorAll(".over,.over-abaixo").forEach(function(r){
    r.classList.remove("over","over-abaixo");
  });
}
var arrasteScroll = {raf:null, vel:0};
function pararAutoScroll(){
  if(arrasteScroll.raf){ cancelAnimationFrame(arrasteScroll.raf); arrasteScroll.raf = null; }
  arrasteScroll.vel = 0;
}
function passoAutoScroll(){
  arrasteScroll.raf = null;
  if(!arrasteScroll.vel) return;
  var lista = el["cl-list"];
  var antes = lista.scrollTop;
  lista.scrollTop = antes + arrasteScroll.vel;
  // Se não rolou nada, já chegamos ao fim: para de tentar.
  if(lista.scrollTop !== antes) arrasteScroll.raf = requestAnimationFrame(passoAutoScroll);
  else arrasteScroll.vel = 0;
}
function autoScrollArraste(clientY){
  var lista = el["cl-list"];
  if(!lista) return;
  var r = lista.getBoundingClientRect();
  var zona = 80;               // faixa sensível no topo e na base
  var velMax = 20;             // px por frame no limite da faixa
  var vel = 0;
  if(clientY < r.top + zona)         vel = -velMax * Math.min(1, (r.top + zona - clientY) / zona);
  else if(clientY > r.bottom - zona) vel =  velMax * Math.min(1, (clientY - (r.bottom - zona)) / zona);
  arrasteScroll.vel = Math.round(vel);
  if(arrasteScroll.vel && !arrasteScroll.raf) arrasteScroll.raf = requestAnimationFrame(passoAutoScroll);
  if(!arrasteScroll.vel) pararAutoScroll();
}
function encerrarArraste(){
  state.arrastando = null; state.alvo = null; state.grupoArrastando = null;
  pararAutoScroll();
  el["cl-list"].querySelectorAll(".cl-row").forEach(function(r){
    r.classList.remove("dragging","over","over-abaixo");
  });
}

/* ===================== aba Homologação geral =====================
   Substitui a aba "Testes (homolog master)" da planilha de versões: a mesma
   lista de tarefas que estão em teste produção ou prontas para merge, com a
   marca de "testada em homologação geral" (a coluna G da
   planilha, que lá era 0/1) e a observação livre (a coluna N, onde aparecia
   coisa como "DEVE SER REVERTIDA DE HOMOLOG GERAL").

   A marca e a observação são do TIME e viajam no pacote, junto com a ordem:
   a planilha também era de todos, e uma marcação por máquina não diria nada
   para ninguém.

   A lista NÃO é mais agrupada por versão. O agrupamento por release veio da
   planilha, que tinha uma aba por versão; mas na reunião de homologação a
   pergunta não é "de que release é esta tarefa?" — é "esta entra nesta rodada
   ou fica para a próxima?". Então a fila é uma só, em ordem de prioridade, e o
   corte da rodada virou duas colunas: VERSÃO ATUAL e PRÓXIMA VERSÃO. O × diz
   em qual campo a tarefa está e a setinha do outro campo a move para lá — e
   mover joga a linha para o bloco PRÓXIMA VERSÃO, no pé da lista, atrás de um
   separador. É o único separador da aba, e não o agrupamento por release de
   volta: o que saiu desta rodada desce e para de atravessar a fila de quem
   está homologando, como as "Concluídas" da Checklist.
   O campo de cada tarefa sai do STATUS por padrão: Teste Produção é o que se
   homologa NESTA rodada, Pronto para Merge é o que já passou por ela e vai na
   próxima. O time move quem quiser para o outro campo, e essa decisão fica
   registrada (check.hgProx / check.hgAtual) e VENCE o status — é o mesmo
   arranjo de hgExtra/hgFora, um campo para cada sentido. Dois campos, e não a
   ausência de marca como antes: com o padrão saindo do status, "sem marca" não
   pode mais significar "versão atual" — significa "vale o que o status
   disser".
   A versão do release não desapareceu — segue na coluna Versão, que é dado do
   Jira e alimenta as outras abas, e o seletor de versão da barra continua
   recortando a fila para quando a pergunta FOR sobre release. */
/* "Em Teste" ficou fora desta fila: a homologação geral começa em Teste
   Produção. Quem quiser vê-las tem a Checklist, que continua mostrando tudo. */
var STATUS_HOMOLOG = ["Teste Produção", "Pronto para Merge"];
/* Casa por nome normalizado e aceita as duas grafias de "Pronto/Pronta para
   Merge": o Jira já apareceu com as duas, e a fila não pode depender de qual
   veio. */
var HOMOLOG_SET = {};
STATUS_HOMOLOG.concat(["Pronta para Merge"]).forEach(function(s){ HOMOLOG_SET[norm(s)] = true; });
/* Dos dois status da fila, o que já passou pela rodada — vai para a coluna
   PRÓXIMA VERSÃO por padrão. Quem não estiver aqui (Teste Produção, e qualquer
   status de tarefa posta na mão) começa na versão ATUAL, que é o campo onde se
   trabalha. Aceita as duas grafias pelo mesmo motivo de HOMOLOG_SET. */
var STATUS_PROXIMA = {};
["Pronto para Merge","Pronta para Merge"].forEach(function(s){ STATUS_PROXIMA[norm(s)] = true; });
function proximaPorStatus(t){ return !!STATUS_PROXIMA[norm(t.status)]; }
/* O status do Jira decide a fila por PADRÃO, e não sozinho: a planilha vivia
   recebendo linha na mão ("essa entra nesta homologação mesmo sem o status") e
   perdendo outra ("essa não vai nesta rodada"). As duas decisões são do TIME e
   viajam no pacote, como a marca do teste:
     check.hgExtra — chave -> data ISO em que entrou na mão
     check.hgFora  — chave -> data ISO em que saiu da fila
   Só uma delas vale por tarefa: adicionar apaga a saída, e tirar apaga a
   entrada — senão as duas marcas conviveriam e a fila dependeria da ordem em
   que este código as lesse. */
function statusDeHomologacao(t){ return !!HOMOLOG_SET[norm(t.status)]; }
function hgExtraMarcada(t){ return !!(state.check.hgExtra || {})[t.key]; }
function hgForaMarcada(t){ return !!(state.check.hgFora || {})[t.key]; }
function naHomologacao(t){
  if(hgForaMarcada(t)) return false;
  /* Finalizada sai SEMPRE, mesmo posta na mão. A fila é o que FALTA homologar,
     e a marca do time diz "entra mesmo sem o status" — não "fica aqui para
     sempre". Sem esta linha, a tarefa adicionada na mão nunca mais sairia
     sozinha: só com alguém clicando no × depois de pronta, e quem chegasse
     depois não teria como saber que ela já tinha acabado.
     Por isso hgCandidatas() também deixa as finalizadas de fora: oferecer para
     adicionar o que sairia no mesmo instante seria um botão que não faz nada. */
  if(faseDe(t) === "final") return false;
  if(hgExtraMarcada(t)) return true;
  return statusDeHomologacao(t);
}
function tarefasHomolog(){ return state.tarefas.filter(naHomologacao); }
function tarefasForaDaFila(){ return state.tarefas.filter(hgForaMarcada); }
function tarefaPorChave(key){
  for(var i=0;i<state.tarefas.length;i++){ if(state.tarefas[i].key === key) return state.tarefas[i]; }
  return null;
}

/* A aba Homologação fala de VERSÕES CORRIGIDAS (fixVersions), o mesmo campo
   que versoesDe() serve às abas Tarefas e Versões — e NÃO de "Versão Entrega"
   (customfield_10150), que é outro campo do Jira. Aqui a leitura é o
   fixVersions CRU (versoesDoJira), sem o check.versaoAjuste: esta aba GRAVA o
   campo, e mostrar o ajuste local faria a linha nunca refletir o que foi
   gravado. O valor na tela É o do Jira. Depois de gravar, o ajuste daquela
   tarefa é apagado (ver gravarLote), senão as outras abas seguiriam mostrando
   o valor velho por cima do novo.
   Uma tarefa pode ter mais de uma versão; para agrupar vale a última, que é a
   mais nova. Sem versão nenhuma cai no balde de v.2026.xx.xx (ver SEM_VERSAO). */
function corrigidasDe(t){
  return t ? versoesDoJira(t) : [];
}
function hgVersaoDe(t){
  var vs = corrigidasDe(t);
  return vs.length ? vs[vs.length-1] : SEM_VERSAO;
}
function hgRotuloVersao(v){ return v === SEM_VERSAO ? "Sem versão definida" : v; }
function hgMarcada(t){ return !!(state.check.homolog || {})[t.key]; }
function hgObs(t){ return (state.check.homologObs || {})[t.key] || ""; }
/* Versão atual x próxima versão. O padrão vem do status; as duas marcas abaixo
   só existem para a tarefa que o time moveu CONTRA esse padrão, e por isso são
   gravadas apenas nesse caso — marcar sempre encheria o pacote de chave que só
   repete o que o status já diz, que é a regra de hgExtra/hgFora. Só uma vale
   por tarefa: mover para um campo apaga a marca do outro. */
function hgForcadaProx(t){ return !!(state.check.hgProx || {})[t.key]; }
function hgForcadaAtual(t){ return !!(state.check.hgAtual || {})[t.key]; }
function hgNaProxima(t){
  if(hgForcadaAtual(t)) return false;
  if(hgForcadaProx(t)) return true;
  return proximaPorStatus(t);
}
function hgQuandoProxima(t){ return fmtData((state.check.hgProx || {})[t.key]); }
function hgQuandoAtual(t){ return fmtData((state.check.hgAtual || {})[t.key]); }
/* As duas pontas do corte da rodada. Gravam a marca só quando o destino
   DISCORDA do status — indo para onde o status já levaria, o que se faz é
   apagar a marca contrária, e a tarefa volta a seguir o padrão. */
function moverParaProxima(key){
  var t = tarefaPorChave(key); if(!t) return;
  var porStatus = proximaPorStatus(t);
  atualizarCheck(function(c){
    var prox = Object.assign({}, c.hgProx), atual = Object.assign({}, c.hgAtual);
    delete atual[key];
    if(porStatus) delete prox[key];
    else prox[key] = new Date().toISOString();
    return {hgProx:prox, hgAtual:atual};
  });
  avisar("info", t.key + " foi para o bloco Próxima versão, no fim da lista"
    + " — a setinha da esquerda traz de volta.");
  renderHomolog();
}
function moverParaAtual(key){
  var t = tarefaPorChave(key); if(!t) return;
  var porStatus = proximaPorStatus(t);
  atualizarCheck(function(c){
    var prox = Object.assign({}, c.hgProx), atual = Object.assign({}, c.hgAtual);
    delete prox[key];
    /* Aqui a marca É necessária: sem ela o status de Pronto para Merge levaria a
       tarefa de volta para a próxima versão na releitura seguinte, e a decisão
       de trazê-la para esta rodada se desfaria sozinha. */
    if(porStatus) atual[key] = new Date().toISOString();
    else delete atual[key];
    return {hgProx:prox, hgAtual:atual};
  });
  avisar("info", t.key + " entrou na versão atual"
    + (porStatus ? " — fica nesta rodada mesmo estando em " + (t.status || "sem status") + "." : "."));
  renderHomolog();
}
function hgOrdemVersoes(chaves){
  return chaves.sort(function(a,b){
    /* "Sem versão" por último: é o balde do que ainda não entrou em release, e
       no topo ele empurraria para baixo justamente a fila que se homologa. */
    if(a === SEM_VERSAO) return 1;
    if(b === SEM_VERSAO) return -1;
    return b.localeCompare(a, "pt-BR");
  });
}

/* As colunas do cabeçalho saem de uma tabela porque ele deixou de ser markup
   fixo: `ord` é o campo pelo qual a coluna ordena, e coluna sem `ord` é só
   rótulo. Ficam de fora, de propósito:
     - a marca do teste, em 28px, onde rótulo e seta não cabem legíveis — e a
       pergunta "o que falta testar?" já tem resposta melhor no botão
       "Só não testadas", que FILTRA em vez de só empurrar para baixo;
     - Versão atual e Próxima versão, porque o corte da rodada já É a ordenação
       primária da lista: ordenar por elas não mudaria nada. */
var HG_COLUNAS = [
  {cls:"hg-c-marca", rot:"", icone:"check", tit:"Testada em homologação geral"},
  {cls:"cl-c-key",    rot:"Chave",      ord:"key"},
  {cls:"cl-summary",  rot:"Resumo",     ord:"summary"},
  {cls:"cl-type",     rot:"Tipo",       ord:"type"},
  {cls:"cl-status",   rot:"Status",     ord:"status"},
  {cls:"hg-c-testes", rot:"Analista de testes", ord:"testAnalyst"},
  {cls:"hg-c-est",    rot:"Estimativa de testes", ord:"estimativa"},
  {cls:"hg-c-versao", rot:"Versões corrigidas", ord:"versao"},
  {cls:"hg-c-fase",   rot:"Versão atual",   tit:"O que se homologa nesta rodada"},
  {cls:"hg-c-fase",   rot:"Próxima versão", tit:"Fica para a rodada seguinte"},
  {cls:"cl-updated",  rot:"Entrega",    ord:"prazo"},
  {cls:"hg-c-obs",    rot:"Observação", ord:"obs"},
  {cls:"hg-c-act",    rot:""}
];

/* Valor da coluna para ordenar. Versão e observação não são campos crus da
   tarefa — saem do ajuste do time e do check —, então passam pelas mesmas
   funções que a linha usa para exibi-los. */
function hgValorOrd(t, col){
  if(col === "versao") return hgVersaoDe(t);
  if(col === "obs") return hgObs(t);
  if(COLUNA_POR_ID[col]) return valorDaColuna(t, col);
  return t[col] || "";
}
/* O comparador de coluna é UM só para as duas abas: o que muda entre elas é de
   onde sai o valor da célula, e isso entra por parâmetro (hgValorOrd,
   clValorOrd). Duplicá-lo daria duas cópias das mesmas regras de chave, status
   e prazo — foi assim que o "venceu" acabou com três cópias. */
function cmpColuna(col, dir, valorOrd){
  return function(a, b){
    if(col === "prazo"){
      var da = parseData(a.prazo), db = parseData(b.prazo);
      /* Sem prazo vai para o fim nas DUAS direções: é ausência de dado, não um
         valor extremo. Mesma regra da ordenação da aba Tarefas. */
      if(!da && !db) return 0;
      if(!da) return 1;
      if(!db) return -1;
      return da.getTime() === db.getTime() ? 0 : (da.getTime()-db.getTime())*dir;
    }
    if(col === "key"){
      /* Pelo número, não pelo texto: como texto, NMTZ-9 viria depois de NMTZ-10. */
      var na = Number((a.key.match(/(\d+)$/)||[])[1]||0);
      var nb = Number((b.key.match(/(\d+)$/)||[])[1]||0);
      return na === nb ? 0 : (na-nb)*dir;
    }
    if(col === "status"){
      /* Pela FASE antes do nome, como na aba Tarefas: status é ordinal, e em
         ordem alfabética "Em Teste" cairia antes de "Desenvolvimento". */
      var ia = FASES.findIndex(function(f){ return f.id===faseDe(a); });
      var ib = FASES.findIndex(function(f){ return f.id===faseDe(b); });
      if(ia !== ib) return (ia-ib)*dir;
      var sa = a.status||"", sb = b.status||"";
      return sa === sb ? 0 : sa.localeCompare(sb,"pt-BR")*dir;
    }
    if(col === "versao"){
      var va = hgVersaoDe(a), vb = hgVersaoDe(b);
      /* "Sem versão" no fim sempre, como o prazo ausente e como hgOrdemVersoes:
         é o balde do que ainda não entrou em release. */
      if(va === SEM_VERSAO && vb !== SEM_VERSAO) return 1;
      if(vb === SEM_VERSAO && va !== SEM_VERSAO) return -1;
      return va === vb ? 0 : va.localeCompare(vb,"pt-BR")*dir;
    }
    if(col === "estimativa" || COL_NUMERICAS[col]){
      /* Estimativa é texto no Jira, mas quase sempre número: como texto, "10"
         viria antes de "2". Número quando dá, texto quando não dá. */
      var ea = parseFloat(String(a[col]||"").replace(",","."));
      var eb = parseFloat(String(b[col]||"").replace(",","."));
      var oka = isFinite(ea), okb = isFinite(eb);
      if(oka && okb) return ea === eb ? 0 : (ea-eb)*dir;
      if(oka !== okb) return oka ? -1 : 1;
    }
    if(col === "cliente"){
      /* "Interna" no fim nas DUAS direções, como o prazo ausente: quem ordena
         por cliente quer ver os clientes de fora, e a interna não é um nome
         que caia entre eles pelo alfabeto. Pedido do Eduardo em 22/10/2026. */
      var ea2 = infoCliente(a).externo, eb2 = infoCliente(b).externo;
      if(ea2 !== eb2) return ea2 ? -1 : 1;
    }
    if(col === "priority"){
      /* Prioridade é ordinal, não alfabética: por texto, "Alta" viria antes de
         "Baixa" por acaso e "Média" ficaria no meio por acidente. */
      var pa = ordemPrioridade(a.priority), pb = ordemPrioridade(b.priority);
      if(pa !== pb) return (pa-pb)*dir;
      return 0;
    }
    var xa = String(valorOrd(a,col)), xb = String(valorOrd(b,col));
    if(!xa && xb) return 1;      // vazio no fim, pelo mesmo motivo do prazo
    if(xa && !xb) return -1;
    return xa === xb ? 0 : xa.localeCompare(xb,"pt-BR")*dir;
  };
}
function hgComparador(){
  var col = state.hgSort.col;
  if(!col) return cmpPrioridade;
  var cmp = cmpColuna(col, state.hgSort.dir === "desc" ? -1 : 1, hgValorOrd);
  /* Empate cai de volta na ordem da reunião, e não na ordem de chegada do
     Jira: por Tipo ou Status blocos inteiros empatam, e sem desempate a fila
     dentro deles ficaria arbitrária — e mudaria de uma leitura para a outra. */
  return function(a,b){ return cmp(a,b) || cmpPrioridade(a,b); };
}
/* Três estados, e não dois: crescente, decrescente e NENHUM. A ordem padrão da
   aba é a de prioridade, que é a ordem da reunião de homologação; sem o terceiro
   clique não haveria como voltar a ela depois de espiar a fila por outra
   coluna, a não ser recarregando a página. */
function hgOrdenarPor(col){
  if(state.hgSort.col !== col) state.hgSort = {col:col, dir:"asc"};
  else if(state.hgSort.dir === "asc") state.hgSort = {col:col, dir:"desc"};
  else state.hgSort = {col:"", dir:"asc"};
  salvarPref();
  renderHomolog();
}
function hgTituloOrd(c, on){
  if(!on) return "Ordenar por "+c.rot+" — dentro de cada bloco da rodada";
  return state.hgSort.dir === "asc"
    ? "Ordenado por "+c.rot+", crescente — clique para inverter"
    : "Ordenado por "+c.rot+", decrescente — clique para voltar à ordem por prioridade";
}
function renderHgCols(){
  if(!el["hg-cols"]) return;
  aplicarCssColunas();
  el["hg-cols"].innerHTML = colunasCabecalho("homolog", HG_COLUNAS).map(function(c){
    var dentro;
    if(c.ord){
      var on = state.hgSort.col === c.ord;
      var seta = on ? icon(state.hgSort.dir==="asc" ? "up" : "arrowdown", 11, "seta") : "";
      dentro = '<button type="button" class="ord'+(on?" on":"")+'" data-ord="'+esc(c.ord)+'"'
        + ' title="'+esc(hgTituloOrd(c, on))+'"><span class="lab">'+esc(c.rot)+'</span>'+seta+'</button>';
    } else {
      dentro = c.icone ? icon(c.icone,12) : esc(c.rot);
    }
    return '<span class="'+c.cls+'"'+moverAttr("homolog", c)+(c.tit ? ' title="'+esc(c.tit)+'"' : '')+(c.w ? ' style="width:'+c.w+'px"' : '')+'>'+dentro+'</span>';
  }).join("");
  el["hg-cols"].querySelectorAll("[data-ord]").forEach(function(b){
    b.onclick = function(){ hgOrdenarPor(b.getAttribute("data-ord")); };
  });
}

function hgDerivados(){
  /* A vista das removidas é a MESMA lista, com outra base: sem ela, tirar uma
     tarefa da fila seria caminho sem volta, e quem chegasse depois não teria
     como saber que ela existiu. */
  var todas = state.hgVerFora ? tarefasForaDaFila() : tarefasHomolog();
  var q = norm(state.hgBusca);
  var base = todas.filter(function(t){
    if(state.hgVersao && hgVersaoDe(t) !== state.hgVersao) return false;
    if(state.hgStatus && norm(t.status) !== norm(state.hgStatus)) return false;
    if(q){
      var alvo = norm([t.key, t.summary, t.testAnalyst, t.status, t.type,
                       hgVersaoDe(t), hgObs(t)].join(" "));
      if(alvo.indexOf(q) === -1) return false;
    }
    return true;
  });
  var marcadas = base.filter(hgMarcada).length;
  /* A trilha mede o recorte inteiro, não o que está na tela: com o "Só não
     testadas" ligado ela cairia para 0% justamente quando o trabalho anda. */
  /* slice() antes do sort porque, sem o "só não testadas", isto É a base — e
     ordenar no lugar mexeria no array que as contagens acima já mediram. */
  /* A ordenação de coluna NÃO desfaz o corte da rodada: hgNaProxima continua
     sendo a chave PRIMÁRIA e a coluna só reordena DENTRO de cada bloco. Se a
     coluna passasse por cima, as linhas da próxima versão se espalhariam pela
     fila e o separador "Próxima versão (n)" — que assume o bloco contíguo no pé
     — passaria a mentir. Ordenar por Entrega é ordenar a rodada que se está
     homologando, não fundir a seguinte dentro dela. */
  var cmp = hgComparador();
  var visiveis = (state.hgSoPendentes ? base.filter(function(t){ return !hgMarcada(t); }) : base)
    .slice().sort(function(a,b){
      /* O corte da rodada ordena ANTES de tudo: empurrar para a próxima versão
         manda a linha para o pé da lista, e renderHomolog() abre o separador na
         primeira delas. A linha pular de lugar é o efeito pretendido — é o que
         diz que ela saiu desta rodada —, e é a mesma leitura das "Concluídas"
         da Checklist. */
      var pa = hgNaProxima(a) ? 1 : 0, pb = hgNaProxima(b) ? 1 : 0;
      if(pa !== pb) return pa - pb;
      return cmp(a, b);
    });
  var naProx = base.filter(hgNaProxima).length;
  return {todas:todas, base:base, visiveis:visiveis, marcadas:marcadas,
          naProx:naProx, naAtual:base.length - naProx};
}

/* As opções são as versões que existem no projeto, mais "sem versão". A volta
   "como está no Jira" saiu junto com o ajuste local: o valor da coluna JÁ é o
   do Jira, então não há para onde voltar. A sentinela com __ não colide com
   nome de versão — e "sem versão" não pode virar SEM_VERSAO aqui, porque
   v.2026.xx.xx também é uma versão de verdade no seletor. */
var HG_SEM = "__sem__";
/* O projeto tem uma centena de versões, e uma lista com todas por linha seria
   impossível de usar (e um bocado de DOM: são dezenas de linhas). O que serve
   para homologar é o release recente, então a lista é: as versões que já estão
   na fila, as RECENTES_VERSAO mais novas do projeto, e a da própria tarefa —
   que pode ser antiga e não pode desaparecer da caixa que a mostra. */
var RECENTES_VERSAO = 10;
function versoesParaAjuste(atual){
  var s = {};
  tarefasHomolog().forEach(function(t){
    corrigidasDe(t).forEach(function(v){ s[v] = true; });
  });
  /* versoesPresentes() sai do mesmo fixVersions (com o ajuste): é a lista de
     releases que o painel conhece. Serve como fonte dos releases recentes; o
     Jira recusa o que não existir. */
  versoesPresentes().slice(0, RECENTES_VERSAO).forEach(function(v){ s[v] = true; });
  if(atual) s[atual] = true;
  return Object.keys(s).sort(function(a,b){ return b.localeCompare(a,"pt-BR"); });
}
/* Com a gravação desligada a célula é TEXTO, e não um select morto: um campo
   que se mexe e não faz nada é pior que campo nenhum. Quem liga é o time, na
   chave da barra — ver hgGravaJira(). */
function opcoesVersaoLinha(t){
  var atual = corrigidasDe(t);
  var alvo = atual.length ? atual[atual.length-1] : "";
  if(!hgGravaJira()){
    return '<span class="cel-faint">'+esc(alvo || "—")+'</span>';
  }
  var r = state.hgRascunho[t.key];
  if(r !== undefined) alvo = (r === HG_SEM) ? "" : r;
  function opt(v){ return '<option value="'+esc(v)+'"'+(v === alvo ? " selected" : "")+'>'+esc(v)+'</option>'; }
  var futuras = versoesNaoLancadas();
  var vs = versoesParaAjuste(alvo).filter(function(v){ return futuras.indexOf(v) === -1; });
  var opts = futuras.length
    ? '<optgroup label="Não lançadas no Jira">'+futuras.map(opt).join("")+'</optgroup>'
      + '<optgroup label="Lançadas / nas tarefas">'+vs.map(opt).join("")+'</optgroup>'
    : vs.map(opt).join("");
  return '<select data-versao="1"'+(state.hgGravando ? " disabled" : "")
    + ' title="'+(r !== undefined
        ? "Ainda NÃO gravado — no Jira está "+esc(atual.length ? atual.join(", ") : "sem versão")+". Use Aplicar no Jira."
        : "Escolha a nova versão corrigida; só vai para o Jira quando você clicar em Aplicar")+'">'
    + '<option value="'+HG_SEM+'"'+(alvo ? "" : " selected")+'>— sem versão —</option>'
    + opts
    + '</select>';
}

/* As duas células do corte da rodada saem daqui, e não escritas duas vezes na
   linha, porque são a MESMA célula com os papéis trocados: o campo em que a
   tarefa está leva o ×, o campo vazio leva a seta que a traz para si. */
function celulaFase(t, prox){
  var forcada = prox ? hgForcadaProx(t) : hgForcadaAtual(t);
  var quando = prox ? hgQuandoProxima(t) : hgQuandoAtual(t);
  var st = t.status || "sem status";
  /* O title diz DE ONDE veio o campo: decisão do time ou padrão do status. Fica
     no title e não num chip — a linha já carrega até quatro, e esta é
     informação de procedência, que se procura quando se estranha a posição. */
  var porque = forcada
    ? "posto aqui pelo time"+(quando ? " em "+quando : "")+", contra o status ("+st+")"
    : st + " entra aqui por padrão";
  function marca(txt){
    return '<span class="hg-fase"><span class="aqui" title="'+esc(txt)+'">'+icon("x",13)+'</span></span>';
  }
  function seta(dir, dado, txt){
    return '<span class="hg-fase"><button type="button" data-'+dado+'="1" title="'+esc(txt)+'">'
      + icon(dir,15)+'</button></span>';
  }
  return prox
    ? seta("setaesq","atual","Trazer para a versão atual — vale para todo o time, e continua valendo mesmo que o status diga o contrário")
      + marca("Vai na próxima versão — "+porque)
    : marca("Entra na versão atual — "+porque)
      + seta("setadir","prox","Passar para a próxima versão — vale para todo o time");
}

function linhaHomolog(t){
  var marcada = hgMarcada(t);
  var extra = hgExtraMarcada(t);
  var fora = hgForaMarcada(t);
  var quandoExtra = fmtData((state.check.hgExtra || {})[t.key]);
  var quandoFora = fmtData((state.check.hgFora || {})[t.key]);
  var quando = marcada ? fmtData((state.check.homolog || {})[t.key]) : "";
  var mp = marcaPrazo(t);
  var prox = hgNaProxima(t);
  var v = hgVersaoDe(t);
  return '<div class="hg-row'+(marcada?" testada":"")+(fora?" fora":"")+(prox?" proxima":"")+'" data-key="'+encodeURIComponent(t.key)+'">'
    + '<span class="hg-marca"><button type="button" data-marca="1" class="'+(marcada?"on":"")+'" title="'
    +   (marcada ? "Testada em homologação geral"+(quando?" em "+quando:"")+" — clique para desmarcar"
                 : "Marcar como testada em homologação geral")+'">'+icon("check",12)+'</button></span>'
    + '<span class="ponto-key-cell"><a class="cl-key" href="'+JIRA_BASE+encodeURIComponent(t.key)+'" target="_blank" rel="noreferrer">'+esc(t.key)+'</a>'+pontoButton(t.key)+'</span>'
    + '<span class="cl-summary"><span class="txt">'+esc(t.summary)+'</span>'
    +   (t.impedida ? '<span class="chip-mini chip-impedida" title="Impedimento marcado no Jira — vale para todo o time">Impedida no Jira</span>' : "")
    +   (extra ? '<span class="chip-mini chip-extra" title="Posta na fila aqui'+(quandoExtra?" em "+quandoExtra:"")
    +     ' — o status do Jira ('+esc(t.status||"sem status")+') não a traria">na fila pelo time</span>' : "")
    +   (fora ? '<span class="chip-mini chip-fora" title="Tirada da fila aqui'+(quandoFora?" em "+quandoFora:"")
    +     ' — no Jira o status é '+esc(t.status||"sem status")+'">fora da fila</span>' : "")
    + '</span>'
    + '<span class="cl-type">'+tipoTag(t.type)+'</span>'
    + '<span class="cl-status">'+etiquetaStatus(t.status)+'</span>'
    + '<span class="hg-testes cel-faint" title="'+esc(t.testAnalyst||"")+'">'+esc(t.testAnalyst||SEM_PESSOA)+'</span>'
    + '<span class="hg-est cel-faint">'+esc(t.estimativa||"")+'</span>'
    + '<span class="hg-versao'+(hgGravaJira() && state.hgRascunho[t.key] !== undefined ? " pendente" : "")+'" title="Versões corrigidas no Jira'
    +   (hgGravaJira() ? " — mudar aqui grava lá" : " (gravação desligada)")+'">'
    +   opcoesVersaoLinha(t)+'</span>'
    + celulaFase(t, prox)
    + '<span class="cl-updated cel-faint'+mp.cls+'" title="'+esc(mp.titulo)+'">'
    +   mp.icone+fmtData(t.prazo)+'</span>'
    + '<span class="hg-obs"><input type="text" data-obs="1" value="'+esc(hgObs(t))+'" placeholder="observação…"'
    +   ' title="Anotação do time para esta tarefa. Vale quando você sai do campo."></span>'
    + celulasExtras("homolog", t)
    + '<span class="hg-act">'
    /* Sem o X de tirar da fila: confundia com o X da coluna Versão atual.
       Fica só o "trazer de volta" nas que já estão em Removidas. */
    +   (fora
        ? '<button type="button" data-voltar="1" class="voltar" title="Trazer de volta para a fila de homologação">'
          + icon("undo",13)+'</button>'
        : '')
    + '</span>'
    + '</div>';
}

function renderHomolog(){
  aplicarHoras(); agendarHoras();
  if(!el["hg-rows"]) return;
  renderHgCols();
  var d = hgDerivados();

  /* O seletor de versão sai dos dados: não dá para pedir um release que não
     está na fila. A contagem em cada opção é do recorte cheio, sem o filtro de
     status nem a busca — é ela que diz onde ainda há trabalho. */
  var porVersao = {};
  d.todas.forEach(function(t){
    var v = hgVersaoDe(t);
    porVersao[v] = (porVersao[v] || 0) + 1;
  });
  if(state.hgVersao && porVersao[state.hgVersao] === undefined) state.hgVersao = "";
  el["sel-hg-versao"].innerHTML = '<option value="">Todas as versões ('+d.todas.length+')</option>'
    + hgOrdemVersoes(Object.keys(porVersao)).map(function(v){
        return '<option value="'+esc(v)+'">'+esc(hgRotuloVersao(v))+' ('+porVersao[v]+')</option>';
      }).join("");
  el["sel-hg-versao"].value = state.hgVersao;

  /* O status também sai dos dados, e não de STATUS_HOMOLOG: uma tarefa posta
     na fila na mão tem o status que tem ("Em Teste"), e um seletor fixo
     esconderia justamente o que alguém acabou de adicionar. A ordem é a do
     fluxo — STATUS_HOMOLOG primeiro —, com o resto em ordem alfabética. */
  var statusNaFila = [];
  d.todas.forEach(function(t){
    if(t.status && statusNaFila.indexOf(t.status) === -1) statusNaFila.push(t.status);
  });
  var ordemFluxo = STATUS_HOMOLOG.map(norm);
  statusNaFila.sort(function(a,b){
    var ia = ordemFluxo.indexOf(norm(a)), ib = ordemFluxo.indexOf(norm(b));
    if(ia === -1) ia = 99;
    if(ib === -1) ib = 99;
    if(ia !== ib) return ia - ib;
    return a.localeCompare(b, "pt-BR");
  });
  if(state.hgStatus && !statusNaFila.some(function(s){ return norm(s) === norm(state.hgStatus); })) state.hgStatus = "";
  el["sel-hg-status"].innerHTML = '<option value="">Todos os status</option>'
    + statusNaFila.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join("");
  el["sel-hg-status"].value = state.hgStatus;
  el["bt-hg-pendentes"].classList.toggle("btn-on", state.hgSoPendentes);
  el["bt-hg-grava-nao"].classList.toggle("on", !hgGravaJira());
  el["bt-hg-grava-sim"].classList.toggle("on", hgGravaJira());
  if(hgGravaJira() && state.aba === "homolog") carregarVersoesJira(false);
  renderLote();

  /* O botão das removidas só aparece quando há o que mostrar — e continua
     aparecendo enquanto a vista está aberta, senão ele sumiria debaixo do
     próprio clique ao restaurar a última. */
  var nFora = tarefasForaDaFila().length;
  el["ct-hg-fora"].textContent = nFora;
  el["bt-hg-fora"].classList.toggle("hidden", nFora === 0 && !state.hgVerFora);
  el["bt-hg-fora"].classList.toggle("btn-on", state.hgVerFora);

  el["hg-sub"].textContent = state.hgVerFora
    ? d.todas.length + " tarefa(s) tirada(s) da fila pelo time"
    : d.todas.length
      /* O corte da rodada dito em número, porque na lista ele está espalhado:
         a ordem é a de prioridade, não a do campo. */
      ? d.todas.length + " tarefa(s) na fila — " + d.naAtual + " na versão atual, "
        + d.naProx + " na próxima"
      : "nada na fila de homologação";
  var pct = d.base.length ? Math.round(d.marcadas*100/d.base.length) : 0;
  el["hg-trilha"].style.width = pct+"%";
  el["hg-trilha"].style.background = corProgresso(pct);
  el["hg-trilha-txt"].innerHTML = "<b>"+d.marcadas+"</b> de "+d.base.length+" testadas";
  el["hg-pills"].innerHTML = statusNaFila.map(function(s){
    var n = d.base.filter(function(t){ return norm(t.status) === norm(s); }).length;
    var f = faseInfo(FASE_POR_STATUS[norm(s)] || "outro");
    return '<span class="state-pill"><span class="ponto" style="background:'+f.cor+'"></span>'
      + esc(s)+' <b>'+n+'</b></span>';
  }).join("");
  el["hg-cont"].textContent = d.visiveis.length === d.base.length
    ? d.visiveis.length + " linha(s)"
    : d.visiveis.length + " de " + d.base.length + " linha(s)";

  if(!d.visiveis.length){
    var semTarefas = state.tarefas.length === 0;
    var tudoTestado = !semTarefas && d.base.length > 0 && state.hgSoPendentes;
    el["hg-rows"].innerHTML = '<div class="vazio"><span class="vazio-icn">'
      + icon(state.hgVerFora ? "ban" : tudoTestado ? "checkcheck" : "flask", 24)+'</span>'
      + '<h3>'+(state.hgVerFora ? "Nada foi tirado da fila"
                : tudoTestado ? "Tudo testado neste recorte" : "Nada na fila de homologação")+'</h3><p>'
      + (state.hgVerFora
          ? 'Ninguém tirou tarefa da fila neste recorte. O <b>×</b> no fim de cada linha tira, e daqui ela volta.'
          : semTarefas
            ? 'Clique em <b>Atualizar</b> no topo para trazer as tarefas do projeto '+PROJETO+'.'
            : tudoTestado
              ? 'As '+d.base.length+' tarefas deste recorte já estão marcadas como testadas em homologação geral. '
                + 'Desligue o <b>Só não testadas</b> para vê-las.'
              : 'Nenhuma tarefa em <b>'+esc(STATUS_HOMOLOG.join(", "))+'</b> neste recorte. '
                + 'Troque a versão, o status ou limpe o filtro — ou use <b>Adicionar tarefa</b> para trazer '
                + 'uma de qualquer status para esta rodada.')
      + '</p></div>';
    return;
  }

  /* Conta sobre as VISIVEIS, e não sobre a base: com o "só não testadas"
     ligado o número do separador tem de bater com o que está embaixo dele. */
  var visProx = d.visiveis.filter(hgNaProxima).length;
  var partes = [], sepPosto = false;
  d.visiveis.forEach(function(t){
    if(!sepPosto && hgNaProxima(t)){
      sepPosto = true;
      partes.push('<div class="hg-sep"><span>Próxima versão ('+visProx+')</span>'
        + '<span class="line"></span></div>');
    }
    partes.push(linhaHomolog(t));
  });
  el["hg-rows"].innerHTML = partes.join("");
  ligarLinhasHomolog();
}

function ligarLinhasHomolog(){
  el["hg-rows"].querySelectorAll(".hg-row").forEach(function(row){
    var key = decodeURIComponent(row.getAttribute("data-key"));
    var bt = row.querySelector("[data-marca]");
    if(bt) bt.onclick = function(){ alternarHomolog(key); };
    /* "change", e não "input": a observação é campo de texto e cada tecla
       marcaria o pacote como sujo — no automático isso seria uma publicação
       (e uma recarga geral) por letra digitada. */
    var inp = row.querySelector("[data-obs]");
    if(inp) inp.onchange = function(){ salvarObsHomolog(key, inp.value); };
    var sel = row.querySelector("[data-versao]");
    if(sel) sel.onchange = function(){ marcarRascunho(key, sel.value); };
    var btTirar = row.querySelector("[data-tirar]");
    if(btTirar) btTirar.onclick = function(){ removerDaFila(key); };
    var btVoltar = row.querySelector("[data-voltar]");
    if(btVoltar) btVoltar.onclick = function(){ restaurarNaFila(key); };
    /* Só uma das duas existe por linha: a seta mora no campo vazio. */
    var btProx = row.querySelector("[data-prox]");
    if(btProx) btProx.onclick = function(){ moverParaProxima(key); };
    var btAtual = row.querySelector("[data-atual]");
    if(btAtual) btAtual.onclick = function(){ moverParaAtual(key); };
  });
}

/* Tirar da versão é escolher outra, ou "sem versão"; adicionar é escolher a
   versão numa tarefa que estava fora dela. A mesma caixa faz as duas coisas,
   que é o que a planilha nunca conseguiu fazer sem recortar e colar linha. */
/* ---------- gravar as Versões corrigidas no Jira ----------
   A única escrita do painel. Três coisas a respeitar, e nenhuma é zelo:
     - CONFIRMAR antes. Isto sai daqui e vale para a empresa inteira; o seletor
       é discreto de propósito (são dezenas de linhas) e em alguns navegadores
       a roda do mouse por cima de um select já troca o valor.
     - RELER a tarefa depois do OK. Marcar a tela como gravada é acreditar no
       que se pediu, não no que ficou: quem manda é o Jira, e workflow ou
       automação podem ter feito outra coisa.
     - No ERRO, não mexer no dado local. A linha volta a mostrar o que o Jira
       tinha, com a mensagem do Jira na barra — gravação que falha não pode
       parecer que deu certo.
   A confirmação é desenhada aqui, e não com window.confirm(): o painel roda em
   iframe, e sem allow-modals o confirm devolve false calado — a gravação nunca
   aconteceria e pareceria defeito. */
function hgGravaJira(){ return window.nimitz.writes && !window.nimitz.preview && !!state.check.hgGravaJira; }
/* Trocar a chave publica na hora, como o Manual/Auto da replicação: é decisão
   do time, e quem a liga precisa que ela chegue a quem está com a aba aberta —
   não adianta ficar só na máquina de quem clicou. */
function trocarGravaJira(liga){
  if(liga && !window.nimitz.writes){ avisar("info","Gravação desativada no backend. Habilite-a em Conexão para editar versões no Jira."); return; }
  if(hgGravaJira() === !!liga) return;
  atualizarCheck({hgGravaJira: !!liga});
  avisar(liga ? "warn" : "info", liga
    ? "A coluna Versões Corrigidas passa a GRAVAR no Jira, e isso vale para todo o time. "
      + "Cada mudança ainda pede confirmação antes de sair daqui."
    : "A coluna Versões Corrigidas voltou a ser só leitura.");
  renderHomolog(); renderTopo();
}

function confirmarAcao(titulo, texto, rotuloSim, aoSim){
  var fundo = document.createElement("div");
  fundo.className = "captura";
  fundo.style.background = "rgba(0,0,0,.35)";
  fundo.style.display = "flex";
  fundo.style.alignItems = "center";
  fundo.style.justifyContent = "center";
  fundo.innerHTML = '<div class="pop" style="position:relative;top:0;width:400px;max-width:92vw;">'
    + '<div class="pop-cab"><b>'+esc(titulo)+'</b></div>'
    + '<div style="padding:var(--sp-3);font-size:var(--fs-sm);line-height:1.6;">'+texto+'</div>'
    + '<div style="display:flex;gap:var(--sp-2);justify-content:flex-end;padding:var(--sp-3);'
    +   'border-top:1px solid var(--border);">'
    + '<button class="btn" data-nao="1">Cancelar</button>'
    + '<button class="btn btn-primary" data-sim="1">'+esc(rotuloSim)+'</button></div></div>';
  function fechar(){ fundo.remove(); }
  fundo.querySelector("[data-nao]").onclick = function(){ fechar(); renderHomolog(); };
  fundo.onclick = function(e){ if(e.target === fundo){ fechar(); renderHomolog(); } };
  fundo.querySelector("[data-sim]").onclick = function(){ fechar(); aoSim(); };
  document.body.appendChild(fundo);
  fundo.querySelector("[data-sim]").focus();
}

function gravarVersoesCorrigidas(key, versoes){
  return window.nimitz.request("/api/fix-versions", {key:key, versions:versoes});
}
var LS_RASCUNHO = window.nimitz.storagePrefix+"hgRascunho";
var LS_VERSOES_JIRA = window.nimitz.storagePrefix+"versoesJira";

function carregarVersoesCache(){
  try{
    var v = JSON.parse(localStorage.getItem(LS_VERSOES_JIRA) || "null");
    if(Array.isArray(v)) state.versoesJira = v;
  }catch(e){}
}
function buscarMeta(){
  return window.nimitz.versions().then(function(values){
    return {temCampos:true, total:1, campo:{fieldId:"fixVersions", allowedValues:values}};
  });
}

function carregarVersoesJira(forcar){
  if(!jiraDisponivel() || state.versoesJiraCarregando) return;
  if(state.versoesJiraSessao && !forcar) return;
  state.versoesJiraCarregando = true;
  buscarMeta().then(function(r){ return r.campo; }).then(function(campo){
    state.versoesJiraCarregando = false;
    state.versoesJiraSessao = true;
    if(!campo) return;
    state.versoesJira = (campo.allowedValues || []).filter(function(v){ return v && v.name && !v.archived; })
      .map(function(v){ return {name:v.name, lancada:!!v.released, data:v.releaseDate || ""}; });
    try{ localStorage.setItem(LS_VERSOES_JIRA, JSON.stringify(state.versoesJira)); }catch(e){}
    renderHomolog();
  }).catch(function(err){
    state.versoesJiraCarregando = false;
    state.versoesJiraSessao = true;
    avisar("warn","Não deu para buscar no Jira as versões ainda não lançadas: "+msgErro(err));
  });
}
/* As não lançadas em ordem de data (sem data no fim — é o v.2026.xx.xx). */
function versoesNaoLancadas(){
  return (state.versoesJira || []).filter(function(v){ return !v.lancada; })
    .sort(function(a,b){
      if(!a.data !== !b.data) return a.data ? -1 : 1;
      return a.data < b.data ? -1 : a.data > b.data ? 1 : a.name.localeCompare(b.name,"pt-BR");
    }).map(function(v){ return v.name; });
}
function salvarRascunho(){
  try{ sessionStorage.setItem(LS_RASCUNHO, JSON.stringify(state.hgRascunho)); }catch(e){}
}
function carregarRascunho(){
  try{
    var r = JSON.parse(sessionStorage.getItem(LS_RASCUNHO) || "{}");
    if(r && typeof r === "object" && !Array.isArray(r)) state.hgRascunho = r;
  }catch(e){}
}
function novasDoValor(valor){ return (valor === HG_SEM || !valor) ? [] : [valor]; }
function textoVersoes(l){ return l.length ? l.join(", ") : "sem versão"; }
/* Rascunho que já bate com o Jira (alguém gravou igual, ou a releitura
   trouxe) não é mais pendência; tarefa que sumiu do pacote também não. */
function podarRascunho(){
  var mudou = false;
  Object.keys(state.hgRascunho).forEach(function(k){
    var t = tarefaPorChave(k);
    if(!t || textoVersoes(corrigidasDe(t)) === textoVersoes(novasDoValor(state.hgRascunho[k]))){
      delete state.hgRascunho[k]; mudou = true;
    }
  });
  if(mudou) salvarRascunho();
}
function marcarRascunho(key, valor){
  var t = tarefaPorChave(key);
  if(!t) return;
  if(textoVersoes(corrigidasDe(t)) === textoVersoes(novasDoValor(valor))) delete state.hgRascunho[key];
  else state.hgRascunho[key] = valor;
  salvarRascunho();
  renderHomolog();
}
function descartarRascunho(){
  state.hgRascunho = {};
  salvarRascunho();
  renderHomolog();
}
function renderLote(){
  if(!el["hg-lote"]) return;
  podarRascunho();
  var ks = Object.keys(state.hgRascunho);
  var mostra = hgGravaJira() && ks.length > 0;
  el["hg-lote"].classList.toggle("hidden", !mostra);
  if(!mostra) return;
  var visiveis = {};
  hgDerivados().visiveis.forEach(function(t){ visiveis[t.key] = true; });
  var escondidas = ks.filter(function(k){ return !visiveis[k]; }).length;
  el["hg-lote-msg"].innerHTML = '<b>'+ks.length+'</b> '+(ks.length===1 ? "versão alterada" : "versões alteradas")
    + ' e ainda <b>não gravada'+(ks.length===1?"":"s")+'</b> no Jira.'
    + (escondidas ? ' ('+escondidas+' fora do filtro atual.)' : '');
  var ocupado = !!state.hgGravando || state.carregando;
  el["bt-hg-aplicar"].disabled = ocupado;
  el["bt-hg-descartar"].disabled = ocupado;
}

function aplicarRascunho(){
  if(!jiraDisponivel()){
    avisar("err","Abra Conexão para configurar o acesso ao Jira.");
    return;
  }
  if(state.hgGravando || state.carregando) return;
  podarRascunho();
  var itens = Object.keys(state.hgRascunho).sort().map(function(k){
    var t = tarefaPorChave(k);
    return {key:k, t:t, de:textoVersoes(corrigidasDe(t)), novas:novasDoValor(state.hgRascunho[k])};
  });
  if(!itens.length){ renderHomolog(); return; }
  confirmarAcao("Gravar "+itens.length+" versão(ões) no Jira",
    'Versões corrigidas de <b>'+itens.length+'</b> tarefa(s):'
    + '<div class="lote-lista">' + itens.map(function(i){
        return '<div title="'+esc(i.t.summary||"")+'"><b>'+esc(i.key)+'</b>  '+esc(i.de)+' → <b>'+esc(textoVersoes(i.novas))+'</b></div>';
      }).join("") + '</div><br>'
    + '<span style="color:var(--text-faint);">Isto altera as tarefas no Jira para todo mundo, '
    + 'e o painel não guarda os valores anteriores para desfazer.</span>',
    "Gravar "+itens.length+" no Jira",
    function(){ gravarLote(itens); });
}

/* Uma de cada vez, e não em paralelo: o conector já sofre com rajada, e a
   ordem fixa deixa a mensagem de progresso honesta. Falha em uma NÃO para as
   outras — e a que falhou continua no rascunho, pronta para tentar de novo. */
function gravarLote(itens){
  state.hgGravando = "lote";
  var oks = [], erros = [];
  renderHomolog();
  function proximo(i){
    if(i >= itens.length) return terminar();
    var it = itens[i];
    avisar("info","Gravando as Versões corrigidas no Jira… "+(i+1)+" de "+itens.length+" ("+it.key+")");
    gravarVersoesCorrigidas(it.key, it.novas).then(function(){
      oks.push(it);
    }).catch(function(err){
      erros.push({key:it.key, msg:msgErro(err)});
    }).then(function(){ proximo(i+1); });
  }
  function terminar(){
    state.hgGravando = null;
    if(!oks.length){
      avisar("err","Nenhuma versão foi gravada. "+erros.map(function(e){ return e.key+": "+e.msg.replace(/[.\s]+$/, ""); }).join(" · ")+".");
      renderTudo(); return;
    }
    /* Relê só as gravadas: quem diz o que ficou é o Jira, não o que foi pedido. */
    var chaves = oks.map(function(i){ return '"'+i.key+'"'; }).join(",");
    carregarPorJql('project = '+PROJETO+' AND key in ('+chaves+')',
      "as tarefas depois da gravação", function(lista){
      if(lista.length){ mesclar(lista); salvar(); inicializarCheck(); }
      /* O ajuste local (check.versaoAjuste) passa por cima do fixVersions nas
         abas Tarefas e Versões. Gravado o campo no Jira, ele só esconderia o
         valor novo — então sai, e só das tarefas que de fato gravaram. */
      var ajustes = state.check.versaoAjuste || {};
      var semAjuste = oks.filter(function(it){ return ajustes[it.key] !== undefined; })
        .map(function(it){ return it.key; });
      if(semAjuste.length){
        atualizarCheck(function(c){
          var a = Object.assign({}, c.versaoAjuste);
          semAjuste.forEach(function(k){ delete a[k]; });
          return {versaoAjuste:a};
        });
      }
      var diferentes = [];
      oks.forEach(function(it){
        var para = textoVersoes(it.novas);
        var t = tarefaPorChave(it.key);
        var agora = t ? textoVersoes(corrigidasDe(t)) : "";
        if(agora !== para) diferentes.push(it.key+" ficou "+(agora||"?")+" e não "+para);
        delete state.hgRascunho[it.key];
      });
      salvarRascunho();
      var partes = [oks.length+" versão(ões) gravada(s) no Jira"];
      if(diferentes.length) partes.push("conferir: "+diferentes.join(" · "));
      if(erros.length) partes.push((erros.length===1 ? "1 falhou e segue pendente" : erros.length+" falharam e seguem pendentes")
        + " — " + erros.map(function(e){ return e.key+": "+e.msg.replace(/[.\s]+$/, ""); }).join(" · "));
      avisar(erros.length ? "err" : diferentes.length ? "warn" : "ok", partes.join(". ")+".");
      renderTudo();
    });
  }
  proximo(0);
}

/* ---------- adicionar e tirar tarefas da fila ----------
   As duas pontas do que na planilha se fazia recortando e colando linha entre
   as abas. Adicionar COM UMA VERSÃO EM FOCO adiciona à versão: sem isso a
   tarefa entraria na fila e cairia em outro grupo, fora da tela de quem acabou
   de pedi-la — e o pedido era "adicionar nesta versão". */
function adicionarNaFila(key){
  var t = tarefaPorChave(key);
  if(!t) return;
  var versao = state.hgVersao;
  /* A versão da linha agora é o fixVersions do Jira, e o painel não a muda
     sozinha: pôr na fila é decisão daqui, gravar no Jira é ação de fora e
     precisa de confirmação. Então, em vez de forçar um ajuste local que a
     coluna nem leria mais, avisa que a tarefa ficou fora do recorte na tela. */
  var foraDoRecorte = !!versao && hgVersaoDe(t) !== versao;
  /* Adicionar é dizer "esta entra NESTA rodada", venha do status que vier: a
     tarefa vai para a versão atual, e com marca quando o status a mandaria para
     a próxima — senão ela cairia direto no bloco do pé da lista, fora da tela de
     quem acabou de pedi-la, que é o mesmo motivo de gravar a versão logo
     abaixo. */
  var puxada = proximaPorStatus(t);
  atualizarCheck(function(c){
    var extra = Object.assign({}, c.hgExtra), fora = Object.assign({}, c.hgFora);
    delete fora[key];
    /* Só marca como extra quem o status não traria. Marcar sempre deixaria o
       chip "na fila pelo time" numa linha que o Jira já põe ali, e a marca
       sobraria no pacote sem dizer nada. */
    if(!statusDeHomologacao(t)) extra[key] = new Date().toISOString();
    var prox = Object.assign({}, c.hgProx), atual = Object.assign({}, c.hgAtual);
    delete prox[key];
    if(puxada) atual[key] = new Date().toISOString();
    else delete atual[key];
    return {hgExtra:extra, hgFora:fora, hgProx:prox, hgAtual:atual};
  });
  avisar(foraDoRecorte ? "warn" : "ok", t.key + " entrou na fila de homologação, na versão atual"
    + (puxada ? " — fica nesta rodada mesmo estando em " + (t.status || "sem status") : "")
    + (foraDoRecorte
        ? ". A versão corrigida dela é " + hgRotuloVersao(hgVersaoDe(t))
          + " e o filtro está em " + hgRotuloVersao(versao) + ", então ela não aparece até você trocar o filtro."
        : "."));
  /* renderTudo, e não só a aba: mexer na versão muda o recorte das outras
     abas, e a fila alimenta o badge e a contagem do topo. */
  renderTudo();
}

function removerDaFila(key){
  var t = tarefaPorChave(key);
  if(!t) return;
  var porStatus = statusDeHomologacao(t);
  atualizarCheck(function(c){
    var extra = Object.assign({}, c.hgExtra), fora = Object.assign({}, c.hgFora);
    delete extra[key];
    /* Quem estava na fila só porque foi posto na mão volta a ser tarefa comum:
       não precisa de marca de exclusão, e guardá-la encheria a vista das
       removidas de linha que ninguém tirou de lugar nenhum. */
    if(porStatus) fora[key] = new Date().toISOString();
    return {hgExtra:extra, hgFora:fora};
  });
  avisar("info", t.key + " saiu da fila de homologação"
    + (porStatus ? " — está em Removidas, e de lá volta." : "."));
  renderHomolog(); renderTopo();
}

function restaurarNaFila(key){
  var t = tarefaPorChave(key);
  if(!t) return;
  atualizarCheck(function(c){
    var fora = Object.assign({}, c.hgFora);
    delete fora[key];
    return {hgFora:fora};
  });
  /* Restaurada a última, a vista das removidas fica sem base: seguir nela
     mostraria um recorte vazio, com o botão que a abriu já fora da barra. */
  if(state.hgVerFora && !tarefasForaDaFila().length) state.hgVerFora = false;
  avisar("ok", t.key + " voltou para a fila de homologação.");
  renderHomolog(); renderTopo();
}

/* Sem nada digitado a lista traz o que está PERTO da fila (em teste), e não o
   projeto inteiro: são mais de dez mil tarefas, e uma lista com todas não
   ajuda a escolher nem cabe no DOM. Digitando, procura em todas. */
var HG_ADD_MAX = 40;
function hgCandidatas(){
  var q = norm(state.hgBuscaAdd);
  var lista = state.tarefas.filter(function(t){
    if(naHomologacao(t)) return false;
    /* Ver naHomologacao(): finalizada não fica na fila, então adicioná-la seria
       um clique sem efeito visível. */
    if(faseDe(t) === "final") return false;
    if(!q) return pareceTesteAtivo(t.status);
    return norm([t.key, t.summary, t.status, versoesTexto(t)].join(" ")).indexOf(q) !== -1;
  });
  /* O que já está em teste primeiro: é de onde sai quase toda adição. */
  lista.sort(function(a,b){
    var pa = pareceTesteAtivo(a.status) ? 0 : 1, pb = pareceTesteAtivo(b.status) ? 0 : 1;
    if(pa !== pb) return pa - pb;
    return cmpChaveDesc(a,b);
  });
  return lista;
}
function renderHgAddCab(){
  el["hg-add-cab"].innerHTML = 'Põe na fila de homologação, na <b>versão atual</b>, uma tarefa de qualquer status'
    + (state.hgVersao ? ' — ela entra na versão <b>'+esc(hgRotuloVersao(state.hgVersao))+'</b>' : "")
    + '. Sem nada digitado a lista mostra o que está em teste; digite para procurar em todo o projeto.';
}
function renderHgAddLista(){
  var todas = hgCandidatas();
  var lista = todas.slice(0, HG_ADD_MAX);
  if(!lista.length){
    el["pop-hg-add-lista"].innerHTML = '<div class="pop-empty">'
      + (state.hgBuscaAdd
          ? "Nenhuma tarefa fora da fila com esse texto"
          : state.tarefas.length
            ? "Nada em teste fora da fila — digite para procurar"
            : "Carregue as tarefas do projeto primeiro")
      + '</div>';
    return;
  }
  el["pop-hg-add-lista"].innerHTML = lista.map(function(t,i){
    return '<button class="pop-item'+(i===state.hgDestaqueAdd?" hi":"")+'" data-add="'+encodeURIComponent(t.key)+'">'
      + '<span class="mono" style="flex:none;font-size:var(--fs-xs);font-weight:700;">'+esc(t.key)+'</span>'
      + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(t.summary)+'</span>'
      + '<span class="cel-faint" style="flex:none;font-size:var(--fs-label);">'+esc(t.status||"")+'</span>'
      + '</button>';
  }).join("")
  + (todas.length > lista.length
      ? '<div class="pop-empty">+'+(todas.length-lista.length)+' fora da lista — refine a busca</div>'
      : "");
  el["pop-hg-add-lista"].querySelectorAll("[data-add]").forEach(function(btn){
    btn.onclick = function(){
      var key = decodeURIComponent(btn.getAttribute("data-add"));
      state.hgBuscaAdd = ""; el["in-busca-hg-add"].value = "";
      fecharTodosPopovers();
      adicionarNaFila(key);
    };
  });
}

function alternarHomolog(key){
  atualizarCheck(function(c){
    var h = Object.assign({}, c.homolog);
    /* Guarda a data da marca: é o que a planilha não tinha e o que responde
       "quando isso foi testado?" sem depender da memória de ninguém. */
    if(h[key]) delete h[key]; else h[key] = new Date().toISOString();
    return {homolog:h};
  });
  renderHomolog();
  renderTopo();
}

function salvarObsHomolog(key, texto){
  var t = String(texto || "").trim().slice(0, 500);
  /* Sem mudanca, sem sujar o pacote: sair do campo sem editar nada nao pode
     valer uma replicacao (e, no automatico, uma recarga geral). */
  if(t === ((state.check.homologObs || {})[key] || "")) return;
  atualizarCheck(function(c){
    var o = Object.assign({}, c.homologObs);
    if(t) o[key] = t; else delete o[key];
    return {homologObs:o};
  });
  /* Não re-renderiza a lista: o campo que acabou de perder o foco seria
     recriado igual, e a linha piscaria sem motivo. */
}

function renderChecklistAll(){
  setTimeout(function(){ if(window.nimitz.refreshOrder) window.nimitz.refreshOrder(); },0);
  renderClCols();
  renderPessoaBotao(); renderProgressoChecklist(); renderStatusPanels();
  renderRevivePill(); renderClList(); renderTopo();
}

/* ===================== popovers da checklist ===================== */
function fecharTodosPopovers(exceto){
  ["pop-pessoa","pop-cl-status","pop-teste","pop-feito","pop-hg-add"].forEach(function(id){
    if(id!==exceto && el[id]) el[id].classList.add("hidden");
  });
  document.querySelectorAll(".captura").forEach(function(o){o.remove();});
}
function togglePop(id, antes){
  var abrir = el[id].classList.contains("hidden");
  fecharTodosPopovers();
  if(abrir){
    if(antes) antes();
    el[id].classList.remove("hidden");
    var overlay = document.createElement("div");
    overlay.className = "captura";
    overlay.onclick = function(){ el[id].classList.add("hidden"); overlay.remove(); };
    document.body.appendChild(overlay);
  }
}

function renderTudo(){
  renderTopo(); renderResumo(); renderToolbar(); cabecalho(); renderTabela(); renderRodape();
  renderChecklistAll(); renderHomolog();
}

/* ===================== exportar ===================== */
function csvDaVersao(){
  var lista = ordenadas(filtradas());
  var cabec = COLUNAS.map(function(c){ return c.rot; });
  function cel(v){
    var s = String(v==null?"":v);
    return /[",;\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }
  var linhas = [cabec.join(";")].concat(lista.map(function(t){
    return COLUNAS.map(function(c){
      if(c.id==="cliente") return cel(infoCliente(t).nome);
      if(c.id==="prazo")   return cel(fmtData(t.prazo));
      if(c.id==="ticket")  return cel(t.ticket==="0" ? "" : t.ticket);
      return cel(t[c.id]);
    }).join(";");
  }));
  return "﻿"+linhas.join("\r\n");
}
function exportar(){
  if(!state.tarefas.length) return;
  var blob = new Blob([csvDaVersao()], {type:"text/csv;charset=utf-8"});
  var url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href=url; a.download="tarefas-NMTZ.csv"; a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  avisar("ok","CSV exportado.");
}

function ligarEventos(){
  el["bt-carregar"].onclick = function(){
    horasParado = false; horasFalhas = 0; horasSemResposta = {};
    atualizar();
    /* Na Homologação com gravação ligada, as versões permitidas do Jira também
       eram renovadas pelo antigo "Atualizar fila". */
    if(state.aba === "homolog" && hgGravaJira()) carregarVersoesJira(true);
  };
  el["sel-versao"].addEventListener("change", function(){
    state.versaoSel = el["sel-versao"].value;
    salvarPref(); renderTudo();
  });
  el["bt-parar"].onclick = function(){
    state.cancelar = true; renderTopo();
    avisar("ok","Interrompendo depois da página atual…");
  };
  (function(){
    var pendente = false;
    el["scroll"].addEventListener("scroll", function(){
      if(pendente) return;
      pendente = true;
      requestAnimationFrame(function(){ pendente = false; desenharJanela(false); });
    }, {passive:true});
    window.addEventListener("resize", function(){ desenharJanela(true); });
  })();
  el["bt-colunas"].onclick = function(e){ e.stopPropagation(); alternarMenuTab("colunas"); };
  el["bt-status"].onclick  = function(e){ e.stopPropagation(); alternarMenuTab("status"); };
  el["pop-colunas"].querySelectorAll("[data-cols]").forEach(function(b){
    b.onclick = function(){
      /* Padrão: volta às colunas de saída. Tirar campos extras: esconde o que
         veio do catálogo e mantém a escolha feita nas colunas da lista. */
      if(b.getAttribute("data-cols")==="padrao") state.ocultas = OCULTAS_PADRAO.slice();
      else state.ocultas = state.ocultas.concat(OCULTAS_PADRAO.filter(function(id){ return state.ocultas.indexOf(id)===-1; }));
      salvarPref(); renderToolbar(); cabecalho(); renderTabela();
    };
  });
  el["pop-status"].querySelectorAll("[data-st]").forEach(function(b){
    b.onclick = function(){
      state.statusSel = b.getAttribute("data-st")==="todos" ? statusPresentesTab().slice() : [];
      salvarPref(); renderToolbar(); cabecalho(); renderTabela(); renderResumo();
    };
  });
  el["in-busca-multi"].addEventListener("input", renderMulti);
  el["bt-multi-filtrar"].onclick = function(e){ e.stopPropagation(); aplicarMulti(); };
  el["in-busca-multi"].addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); aplicarMulti(); } });
  el["pop-multi"].querySelectorAll("[data-mt]").forEach(function(b){
    b.onclick = function(){
      var a = b.getAttribute("data-mt"), s = selMulti();
      if(a==="nenhum") return marcarFiltroRascunho([]);
      var novos = opcoesMultiVisiveis().map(function(o){ return o.v; });
      if(a==="externos") novos = novos.filter(function(v){ return v!=="Interna"; });
      marcarFiltroRascunho(s.concat(novos.filter(function(v){ return s.indexOf(v)===-1; })));
    };
  });
  el["scroll"].addEventListener("scroll", posicionarMulti, {passive:true});
  window.addEventListener("resize", posicionarMulti);
  /* Clique fora fecha os dois popovers da tabela. */
  document.addEventListener("click", function(e){
    if(!state.menuTab) return;
    if(e.target.closest && e.target.closest(".dd")) return;
    state.menuTab = null; fecharPopsTab();
  });
  el["bt-limpar"].onclick = function(){
    state.fase=null; state.filtros={}; state.statusSel=[];
    salvarPref(); renderResumo(); renderToolbar(); cabecalho(); renderTabela();
  };
  el["bt-export"].onclick = exportar;
  

  /* ---------- abas ---------- */
  document.querySelectorAll(".aba-btn").forEach(function(b){
    b.onclick = function(){
      var nova = b.getAttribute("data-aba");
      /* Sair da Checklist devolve a lista à ordem definida: a ordenação por
         coluna é para olhar, não para ficar. Recarregar também zera, porque ela
         não entra em salvarPref(). */
      if(nova !== state.aba && state.aba === "checklist") state.clSort = {col:"", dir:"asc"};
      state.aba = nova;
      state.menuTab = null; fecharPopsTab(); fecharTodosPopovers();
      renderTudo();
    };
  });

  /* ---------- homologação geral ---------- */
  el["in-busca-hg"].addEventListener("input", function(){
    state.hgBusca = el["in-busca-hg"].value; renderHomolog();
  });
  el["sel-hg-versao"].onchange = function(){ state.hgVersao = el["sel-hg-versao"].value; renderHomolog(); };
  el["sel-hg-status"].onchange = function(){ state.hgStatus = el["sel-hg-status"].value; renderHomolog(); };
  el["bt-hg-grava-nao"].onclick = function(){ trocarGravaJira(false); };
  el["bt-hg-grava-sim"].onclick = function(){ trocarGravaJira(true); };
  el["bt-hg-aplicar"].onclick = aplicarRascunho;
  el["bt-hg-descartar"].onclick = descartarRascunho;
  el["bt-hg-pendentes"].onclick = function(){ state.hgSoPendentes = !state.hgSoPendentes; renderHomolog(); };
  el["bt-hg-add"].onclick = function(){
    togglePop("pop-hg-add", function(){
      state.hgBuscaAdd = ""; el["in-busca-hg-add"].value = ""; state.hgDestaqueAdd = 0;
      renderHgAddCab(); renderHgAddLista();
    });
    if(!el["pop-hg-add"].classList.contains("hidden")) el["in-busca-hg-add"].focus();
  };
  el["in-busca-hg-add"].addEventListener("input", function(){
    state.hgBuscaAdd = el["in-busca-hg-add"].value; state.hgDestaqueAdd = 0; renderHgAddLista();
  });
  el["in-busca-hg-add"].addEventListener("keydown", function(e){
    var lista = hgCandidatas().slice(0, HG_ADD_MAX);
    if(e.key==="ArrowDown"){ e.preventDefault(); state.hgDestaqueAdd = Math.min(state.hgDestaqueAdd+1, lista.length-1); renderHgAddLista(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); state.hgDestaqueAdd = Math.max(state.hgDestaqueAdd-1, 0); renderHgAddLista(); }
    else if(e.key==="Enter"){
      e.preventDefault();
      var t = lista[state.hgDestaqueAdd];
      if(t){
        state.hgBuscaAdd = ""; el["in-busca-hg-add"].value = "";
        fecharTodosPopovers();
        adicionarNaFila(t.key);
      }
    }
    else if(e.key==="Escape"){ fecharTodosPopovers(); }
  });
  el["bt-hg-fora"].onclick = function(){
    state.hgVerFora = !state.hgVerFora;
    /* Entrar na vista das removidas com o "Só não testadas" ligado seria um
       recorte de um recorte, e a lista pareceria vazia sem motivo visível. */
    if(state.hgVerFora) state.hgSoPendentes = false;
    renderHomolog();
  };

  /* ---------- checklist ---------- */
  el["bt-pessoa"].onclick = function(){
    togglePop("pop-pessoa", function(){
      state.clBuscaPessoa = ""; el["in-busca-pessoa"].value = ""; state.clDestaque = 0;
      renderPessoaLista();
    });
  };
  el["in-busca-pessoa"].addEventListener("input", function(){
    state.clBuscaPessoa = el["in-busca-pessoa"].value; state.clDestaque = 0; renderPessoaLista();
  });
  el["in-busca-pessoa"].addEventListener("keydown", function(e){
    var lista = pessoasFiltradasAtual();
    if(e.key==="ArrowDown"){ e.preventDefault(); state.clDestaque = Math.min(state.clDestaque+1, lista.length-1); renderPessoaLista(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); state.clDestaque = Math.max(state.clDestaque-1, 0); renderPessoaLista(); }
    else if(e.key==="Enter"){
      e.preventDefault();
      var p = lista[state.clDestaque];
      if(p){
        state.pessoa = p.nome;
        state.clBuscaPessoa = ""; el["in-busca-pessoa"].value = "";
        fecharTodosPopovers();
        salvarPref(); renderChecklistAll();
      }
    }
    else if(e.key==="Escape"){ fecharTodosPopovers(); }
  });

  el["in-busca-cl"].addEventListener("input", function(){
    state.clBusca = el["in-busca-cl"].value; renderProgressoChecklist(); renderClList();
  });

  el["bt-cl-status"].onclick = function(){ togglePop("pop-cl-status", renderStatusPanels); };
  document.getElementById("st-todos").onclick = function(){
    atualizarCheck({statusOcultos:[], inicOcultos:true}); renderChecklistAll();
  };
  document.getElementById("st-nenhum").onclick = function(){
    atualizarCheck({statusOcultos: clDerivados().statusDaPessoa.map(function(s){return s.status;}), inicOcultos:true});
    renderChecklistAll();
  };
  document.getElementById("st-pendentes").onclick = function(){
    atualizarCheck({statusOcultos: clDerivados().statusDaPessoa.filter(function(s){return s.fim;}).map(function(s){return s.status;}), inicOcultos:true});
    renderChecklistAll();
  };

  el["bt-teste"].onclick = function(){ togglePop("pop-teste", renderStatusPanels); };
  el["bt-feito"].onclick = function(){ togglePop("pop-feito", renderStatusPanels); };

  el["sel-ordenacao"].value = state.clOrdenacao;
  el["sel-ordenacao"].addEventListener("change", function(){
    state.clOrdenacao = el["sel-ordenacao"].value; renderClList();
  });

  /* A rolagem automática precisa ficar no container, e não só nas linhas:
     sobre um separador ("Concluídas") ou sobre o espaço vazio no fim da lista
     nenhum dragover de linha dispara, e o auto-scroll travava justamente ali. */
  el["cl-list"].addEventListener("dragover", function(e){
    if(state.arrastando===null) return;
    e.preventDefault();
    autoScrollArraste(e.clientY);
  });
  el["cl-list"].addEventListener("drop", function(e){ e.preventDefault(); pararAutoScroll(); });
  el["cl-list"].addEventListener("dragleave", function(e){
    // Só para quando o cursor realmente saiu da lista, não ao trocar de linha.
    if(!el["cl-list"].contains(e.relatedTarget)) pararAutoScroll();
  });
}

/* WEB_SHARED_ORDER */
window.nimitz.orderView = {
  render:function(){renderChecklistAll();},
  person:function(){return state.pessoa;},
  active:function(){return state.aba === "checklist";},
  dragging:function(){return state.arrastando !== null;},
  apply:function(person,keys){
    var ordem=Object.assign({},state.check.ordem);
    ordem[person]=keys;
    atualizarCheck({ordem:ordem});
    if(state.pessoa===person) renderChecklistAll();
  }
};
/* ===================== colunas por aba e horas por pessoa =====================
   Cada uma das quatro grades guarda a própria escolha de colunas. A escolha é
   da pessoa: fica neste navegador (separada por conta) e no servidor, presa à
   conta Atlassian, para voltar igual em outro computador.
   - Tarefas e Versões: lista de colunas OCULTAS do catálogo COLUNAS.
   - Checklist e Homologação: colunas próprias que dá para esconder (ocultas)
     e campos do catálogo acrescentados à direita (extras). */
var COL_NUMERICAS = {horasAnalista:true, horasTeste:true, horasDev:true, tempoGasto:true, estimativa:true, estDesenv:true,
  estRequisitos:true, estUX:true, estAnaliseTec:true, qtdReprov:true, qtdMotivos:true, qtdReprovAnt:true, gut:true, razaoTrab:true};
var COLUNA_POR_ID = {};
COLUNAS.forEach(function(c){ COLUNA_POR_ID[c.id] = c; });
var OCULTAS_PADRAO = state.ocultas.slice();
/* Colunas próprias de cada grade que podem sair. Chave, resumo, marca, fases e
   ações ficam sempre: sem elas a linha perde o sentido. "sel" acha a célula
   no cabeçalho e na linha. */
var GRADE_NATIVAS = {
  checklist: [
    {id:"type", rot:"Tipo", sel:".cl-type"}, {id:"status", rot:"Status", sel:".cl-status"},
    {id:"squad", rot:"Squad", sel:".cl-squad"}, {id:"cliente", rot:"Cliente", sel:".cl-cliente"},
    {id:"priority", rot:"Prioridade", sel:".cl-prio"}, {id:"versao", rot:"Versão", sel:".cl-versao"},
    {id:"prazo", rot:"Entrega", sel:".cl-updated"}
  ],
  homolog: [
    {id:"type", rot:"Tipo", sel:".cl-type"}, {id:"status", rot:"Status", sel:".cl-status"},
    {id:"testAnalyst", rot:"Analista de testes", sel:".hg-testes,.hg-c-testes"}, {id:"estimativa", rot:"Estimativa de testes", sel:".hg-est,.hg-c-est"},
    {id:"versao", rot:"Versões corrigidas", sel:".hg-versao,.hg-c-versao"}, {id:"prazo", rot:"Entrega", sel:".cl-updated"},
    {id:"obs", rot:"Observação", sel:".hg-obs,.hg-c-obs"}
  ]
};
/* Campos do catálogo que já aparecem como coluna própria da grade. */
var GRADE_JA_TEM = {
  checklist: {key:1, summary:1, type:1, status:1, squad:1, cliente:1, priority:1, prazo:1, versoes:1},
  homolog:   {key:1, summary:1, type:1, status:1, testAnalyst:1, estimativa:1, prazo:1, versoes:1}
};
var GRADE_PAINEL = {checklist:"#painel-checklist", homolog:"#painel-homolog"};
var GRADE_LINHA = {checklist:[".cl-cols",".cl-row"], homolog:[".hg-cols",".hg-row"]};

state.colunas = {tarefas:OCULTAS_PADRAO.slice(), versoes:OCULTAS_PADRAO.slice(),
  checklist:{ocultas:[], extras:[]}, homolog:{ocultas:[], extras:[]}};
/* state.ocultas continua existindo para o código da tabela, mas agora aponta
   para a escolha da aba aberta (Tarefas ou Versões). */
function abaDaTabela(){ return state.aba === "versoes" ? "versoes" : "tarefas"; }
Object.defineProperty(state, "ocultas", {
  configurable:true, enumerable:true,
  get:function(){ return state.colunas[abaDaTabela()]; },
  set:function(v){ state.colunas[abaDaTabela()] = Array.isArray(v) ? v.slice() : []; }
});
function listaDeIds(v, valido){ return Array.isArray(v) ? v.filter(function(x){ return typeof x === "string" && valido(x); }) : null; }
function adotarColunas(c){
  if(!c || typeof c !== "object") return;
  if(c.ordem && typeof c.ordem === "object"){
    var ordem = {}, extrasOk = {fase:true};
    GRADE_PADRAO_ORDEM.checklist.concat(GRADE_PADRAO_ORDEM.homolog).forEach(function(id){ extrasOk[id] = true; });
    ["tarefas","versoes","checklist","homolog"].forEach(function(aba){
      var l = listaDeIds(c.ordem[aba], function(id){ return !!extrasOk[id] || !!COLUNA_POR_ID[id]; });
      if(l) ordem[aba] = l.slice(0, 200);
    });
    state.colunas.ordem = ordem;
  }
  ["tarefas","versoes"].forEach(function(aba){
    var l = listaDeIds(c[aba], function(id){ return !!COLUNA_POR_ID[id]; });
    if(l) state.colunas[aba] = l;
  });
  ["checklist","homolog"].forEach(function(g){
    var v = c[g]; if(!v || typeof v !== "object") return;
    var nat = {}; GRADE_NATIVAS[g].forEach(function(n){ nat[n.id] = true; });
    var oc = listaDeIds(v.ocultas, function(id){ return !!nat[id]; });
    var ex = listaDeIds(v.extras, function(id){ return !!COLUNA_POR_ID[id] && !GRADE_JA_TEM[g][id]; });
    state.colunas[g] = {ocultas:oc || [], extras:ex || []};
  });
}

/* ---- servidor: a escolha segue a conta ---- */
var colunasServidorTimer = null, colunasServidorOk = false;
function salvarColunasServidor(){
  if(!colunasServidorOk || !jiraDisponivel()) return;
  clearTimeout(colunasServidorTimer);
  colunasServidorTimer = setTimeout(function(){
    window.nimitz.request("/api/prefs/save", {colunas:state.colunas}).catch(function(){});
  }, 800);
}
function carregarColunasServidor(){
  if(!jiraDisponivel()) return;
  window.nimitz.request("/api/prefs/get", {}).then(function(r){
    colunasServidorOk = true;
    if(r && r.prefs && r.prefs.colunas){
      adotarColunas(r.prefs.colunas);
      try{ var pp = JSON.parse(localStorage.getItem(LS_PESSOA)||"{}"); pp.colunas = state.colunas; delete pp.ocultas;
        localStorage.setItem(LS_PESSOA, JSON.stringify(pp)); }catch(e){}
      redesenharGrades();
    } else {
      salvarColunasServidor();   // primeira vez: leva a escolha deste navegador
    }
  }).catch(function(){ /* backend antigo ou sem conexão: fica só no navegador */ });
}
function redesenharGrades(){
  try{ renderToolbar(); cabecalho(); renderTabela(); }catch(e){}
  try{ renderChecklistAll(); }catch(e){}
  try{ renderHomolog(); }catch(e){}
}

/* ---- ordem das colunas (arrastar o cabeçalho) ----
   Uma ordem por aba e por pessoa, em state.colunas.ordem, salva junto com a
   escolha de colunas (navegador e conta). Coluna que não está na lista vai
   para o fim, na ordem padrão. */
var GRADE_PADRAO_ORDEM = {
  checklist:["type","status","squad","cliente","priority","versao","prazo"],
  homolog:["type","status","testAnalyst","estimativa","versao","fase","prazo","obs"]
};
var GRADE_FASE_SEL = [".hg-c-fase",".hg-fase"];
var GRADE_FIM = {checklist:[".cl-c-act",".cl-dismiss"], homolog:[".hg-c-act",".hg-act"]};
function ordemDe(aba){ var o = state.colunas.ordem && state.colunas.ordem[aba]; return Array.isArray(o) ? o : []; }
function ordenarColunas(aba, ids){
  var salvo = ordemDe(aba).filter(function(id){ return ids.indexOf(id) !== -1; });
  return salvo.concat(ids.filter(function(id){ return salvo.indexOf(id) === -1; }));
}
function moveisDaGrade(g){
  return GRADE_PADRAO_ORDEM[g].concat(extrasDaGrade(g).map(function(c){ return c.id; }));
}
function seletoresMovel(g, id){
  if(g === "homolog" && id === "fase") return GRADE_FASE_SEL;
  var n = GRADE_NATIVAS[g].filter(function(x){ return x.id === id; })[0];
  if(n) return n.sel.split(",");
  return [".gx-"+id];
}
/* Id da coluna móvel a que pertence um item do cabeçalho da grade. */
function idMovel(g, c){
  var cls = String(c.cls).split(" ");
  var ex = cls.filter(function(x){ return x.indexOf("gx-") === 0; })[0];
  if(ex) return ex.slice(3);
  var ids = moveisDaGrade(g);
  for(var i=0;i<ids.length;i++){
    if(seletoresMovel(g, ids[i]).some(function(sel){ return sel.trim() === "."+cls[0]; })) return ids[i];
  }
  return null;
}
function moverAttr(g, c){
  var id = idMovel(g, c);
  return id ? ' draggable="true" data-move="'+esc(id)+'" data-move-g="'+g+'"' : '';
}
function moverColuna(aba, de, para, depois){
  if(de === para) return;
  var grade = aba === "checklist" || aba === "homolog";
  var ids = grade ? moveisDaGrade(aba) : COLUNAS.map(function(c){ return c.id; });
  var ordem = ordenarColunas(aba, ids).filter(function(id){ return id !== de; });
  var i = ordem.indexOf(para); if(i === -1) return;
  ordem.splice(depois ? i+1 : i, 0, de);
  if(!state.colunas.ordem) state.colunas.ordem = {};
  state.colunas.ordem[aba] = ordem;
  salvarPref();
  if(grade){ aplicarCssColunas(); if(aba === "checklist") renderClCols(); else renderHgCols(); }
  else { cabecalho(); renderTabela(); }
}
/* Arrastar pelo cabeçalho, nas quatro abas. A marca mostra de que lado a
   coluna vai entrar. */
function ligarArrasteColunas(){
  var origem = null;
  function alvo(e){ return e.target.closest ? e.target.closest("[data-move]") : null; }
  function abaDo(n){ return n.getAttribute("data-move-g") || abaDaTabela(); }
  function limpar(){
    document.querySelectorAll(".mv-antes,.mv-depois,.mv-origem").forEach(function(n){ n.classList.remove("mv-antes","mv-depois","mv-origem"); });
  }
  document.addEventListener("dragstart", function(e){
    var n = alvo(e); if(!n) return;
    origem = {id:n.getAttribute("data-move"), aba:abaDo(n)};
    n.classList.add("mv-origem");
    try{ e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", origem.id); }catch(err){}
  });
  document.addEventListener("dragover", function(e){
    var n = alvo(e); if(!n || !origem || abaDo(n) !== origem.aba) return;
    e.preventDefault();
    var r = n.getBoundingClientRect(), depois = e.clientX > r.left + r.width/2;
    document.querySelectorAll(".mv-antes,.mv-depois").forEach(function(x){ if(x !== n) x.classList.remove("mv-antes","mv-depois"); });
    n.classList.toggle("mv-depois", depois); n.classList.toggle("mv-antes", !depois);
  });
  document.addEventListener("drop", function(e){
    var n = alvo(e); if(!n || !origem || abaDo(n) !== origem.aba) return;
    e.preventDefault();
    var r = n.getBoundingClientRect(), o = origem;
    origem = null; limpar();
    moverColuna(o.aba, o.id, n.getAttribute("data-move"), e.clientX > r.left + r.width/2);
  });
  document.addEventListener("dragend", function(){ origem = null; limpar(); });
}

/* ---- Checklist e Homologação ---- */
function extrasDaGrade(g){
  var ex = state.colunas[g].extras;
  return COLUNAS.filter(function(c){ return ex.indexOf(c.id) !== -1 && !GRADE_JA_TEM[g][c.id]; });
}
function colunasCabecalho(g, base){
  var extras = extrasDaGrade(g).map(function(c){ return {cls:"g-extra gx-"+c.id, rot:c.rot, ord:c.id, w:c.w}; });
  return base.slice(0, -1).concat(extras, base.slice(-1));
}
function celulasExtras(g, t){
  return extrasDaGrade(g).map(function(c){
    var v = valorDaColuna(t, c.id);
    return '<span class="g-extra gx-'+c.id+' cel-faint'+(COL_NUMERICAS[c.id] ? " g-num" : "")+'" style="width:'+c.w+'px" title="'+esc(v)+'">'+esc(v)+'</span>';
  }).join("");
}
function aplicarCssColunas(){
  var css = ".g-extra{flex:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);}"
    + ".g-extra.g-num{font-family:var(--font-mono);font-size:var(--fs-xs);}"
    + "#pop-col-checklist,#pop-col-homolog{left:auto;right:0;}";
  ["checklist","homolog"].forEach(function(g){
    state.colunas[g].ocultas.forEach(function(id){
      var n = GRADE_NATIVAS[g].filter(function(x){ return x.id === id; })[0]; if(!n) return;
      n.sel.split(",").forEach(function(sel){
        GRADE_LINHA[g].forEach(function(linha){ css += GRADE_PAINEL[g]+" "+linha+" > "+sel+"{display:none}"; });
      });
    });
  });
  /* Ordem escolhida pela pessoa: só muda a propriedade order das células, as
     linhas não são remontadas. Antes (chave, resumo) e depois (ações) ficam. */
  ["checklist","homolog"].forEach(function(g){
    ordenarColunas(g, moveisDaGrade(g)).forEach(function(id, i){
      seletoresMovel(g, id).forEach(function(sel){
        GRADE_LINHA[g].forEach(function(linha){ css += GRADE_PAINEL[g]+" "+linha+" > "+sel+"{order:"+(10+i)+"}"; });
      });
    });
    GRADE_FIM[g].forEach(function(sel){
      GRADE_LINHA[g].forEach(function(linha){ css += GRADE_PAINEL[g]+" "+linha+" > "+sel+"{order:999}"; });
    });
  });
  /* A linha tem largura mínima fixa no CSS, pensada sem colunas extras. Cada
     extra soma a sua largura (e o espaço entre colunas); sem isso o fundo da
     linha acaba antes das últimas células. */
  var BASE_GRADE = {checklist:1220, homolog:1720};
  ["checklist","homolog"].forEach(function(g){
    var ex = extrasDaGrade(g), soma = 0;
    ex.forEach(function(c){ soma += c.w; });
    var pre = g === "homolog" ? "#hg-" : "#cl-";
    css += GRADE_PAINEL[g]+" "+pre+"rows,"+GRADE_PAINEL[g]+" "+pre+"cols{min-width:calc("+(BASE_GRADE[g]+soma)+"px + "+ex.length+" * var(--row-gap))}";
  });
  var tag = document.getElementById("grade-colunas-css");
  if(!tag){ tag = document.createElement("style"); tag.id = "grade-colunas-css"; document.head.appendChild(tag); }
  if(tag.textContent !== css) tag.textContent = css;
}
function botaoColunas(g){
  return '<div class="dd" id="dd-col-'+g+'"><button class="btn" id="bt-col-'+g+'">'+icon("table",14)
    + ' Colunas <span class="contador" id="ct-col-'+g+'"></span></button>'
    + '<div class="pop hidden" id="pop-col-'+g+'"><div class="pop-cab">Colunas desta lista. A escolha é sua e fica salva na sua conta.</div>'
    + '<div class="pop-acoes"><button data-gcols="padrao">Padrão</button><button data-gcols="limpar">Tirar campos extras</button></div>'
    + '<div class="pop-lista" id="lista-col-'+g+'"></div></div></div>';
}
function itemColuna(attr, id, rot, on){
  return '<button class="pop-item'+(on?" on":"")+'" '+attr+'="'+esc(id)+'">'
    + '<span class="chk'+(on?" on":"")+'">'+(on?icon("check",10):"")+'</span>'+esc(rot)+'</button>';
}
function renderPopColunas(g){
  var lista = document.getElementById("lista-col-"+g); if(!lista) return;
  var cfg = state.colunas[g];
  var nativas = GRADE_NATIVAS[g].map(function(n){ return itemColuna("data-gnat", n.id, n.rot, cfg.ocultas.indexOf(n.id) === -1); }).join("");
  var catalogo = COLUNAS.filter(function(c){ return !GRADE_JA_TEM[g][c.id]; })
    .map(function(c){ return itemColuna("data-gext", c.id, c.rot, cfg.extras.indexOf(c.id) !== -1); }).join("");
  lista.innerHTML = '<div class="pop-cab">Desta lista</div>' + nativas + '<div class="pop-cab">Mais campos do Jira</div>' + catalogo;
  var vis = GRADE_NATIVAS[g].length - cfg.ocultas.length + cfg.extras.length;
  var total = GRADE_NATIVAS[g].length + COLUNAS.filter(function(c){ return !GRADE_JA_TEM[g][c.id]; }).length;
  var ct = document.getElementById("ct-col-"+g); if(ct) ct.textContent = vis+"/"+total;
  var bt = document.getElementById("bt-col-"+g); if(bt) bt.classList.toggle("btn-on", !!(cfg.extras.length || cfg.ocultas.length));
}
function alternarColunaGrade(g, tipo, id){
  var cfg = state.colunas[g], lista = tipo === "nat" ? cfg.ocultas : cfg.extras;
  var i = lista.indexOf(id);
  var nova = i === -1 ? lista.concat([id]) : lista.filter(function(x){ return x !== id; });
  if(tipo === "nat") cfg.ocultas = nova; else cfg.extras = nova;
  salvarPref(); renderPopColunas(g); redesenharGrade(g);
}
function redesenharGrade(g){ if(g === "checklist") renderChecklistAll(); else renderHomolog(); }
function ligarColunasGrade(){
  ["checklist","homolog"].forEach(function(g){
    var bt = document.getElementById("bt-col-"+g), pop = document.getElementById("pop-col-"+g);
    if(!bt || !pop) return;
    bt.onclick = function(e){ e.stopPropagation(); renderPopColunas(g); pop.classList.toggle("hidden"); };
    pop.addEventListener("click", function(e){
      e.stopPropagation();
      var b = e.target.closest("button"); if(!b) return;
      if(b.hasAttribute("data-gnat")) return alternarColunaGrade(g, "nat", b.getAttribute("data-gnat"));
      if(b.hasAttribute("data-gext")) return alternarColunaGrade(g, "ext", b.getAttribute("data-gext"));
      var a = b.getAttribute("data-gcols");
      if(a === "padrao") state.colunas[g] = {ocultas:[], extras:[]};
      if(a === "limpar") state.colunas[g].extras = [];
      if(a){ salvarPref(); renderPopColunas(g); redesenharGrade(g); }
    });
    document.addEventListener("click", function(e){
      if(!pop.classList.contains("hidden") && !e.target.closest("#dd-col-"+g)) pop.classList.add("hidden");
    });
    renderPopColunas(g);
  });
  aplicarCssColunas();
  carregarColunasServidor();
}

/* ---- horas por pessoa (Horas Testes / Horas Dev) ----
   O total da tarefa já vem na busca (timespent). Quem lançou cada hora não vem:
   sai de /api/worklog-hours, em lotes, só para tarefas com tempo gasto e só
   quando alguma grade mostra uma das duas colunas. Fica guardado por tarefa
   com a data de atualização do Jira: lançar hora muda essa data, e aí a tarefa
   é consultada de novo. */
var LS_HORAS = window.nimitz.storagePrefix+"horasPorPessoa";
var HORAS = {};
try{ HORAS = JSON.parse(localStorage.getItem(LS_HORAS)||"{}") || {}; }catch(e){ HORAS = {}; }
var horasRodando = false, horasTimer = null, horasParado = false;
function horasPessoa(reg, id, nome){
  if(!reg) return null;
  var seg = 0, achou = false;
  if(id && reg.h[id] != null){ seg = reg.h[id]; achou = true; }
  else if(nome){ Object.keys(reg.n||{}).forEach(function(acc){ if(reg.n[acc] === nome){ seg += reg.h[acc]||0; achou = true; } }); }
  return achou ? seg : 0;
}
function fmtHoras(seg){ return seg == null ? "" : String(Math.round(seg/360)/10); }
function aplicarHoras(){
  state.tarefas.forEach(function(t){
    var semTempo = !t.tempoGasto || t.tempoGasto === "0";
    var reg = HORAS[t.key];
    if(semTempo){ t.horasAnalista = t.analistaReq ? "0" : ""; t.horasTeste = t.testAnalyst ? "0" : ""; t.horasDev = t.dev ? "0" : ""; return; }
    if(!reg){ t.horasAnalista = ""; t.horasTeste = ""; t.horasDev = ""; return; }
    t.horasAnalista = t.analistaReq ? fmtHoras(horasPessoa(reg, t.analistaReqId, t.analistaReq)) : "";
    t.horasTeste = t.testAnalyst ? fmtHoras(horasPessoa(reg, t.testAnalystId, t.testAnalyst)) : "";
    t.horasDev = t.dev ? fmtHoras(horasPessoa(reg, t.devId, t.dev)) : "";
  });
}
var COL_HORAS = ["horasAnalista","horasTeste","horasDev"];
/* Só a aba aberta conta: buscar horas para colunas que ninguém está vendo
   gastava milhares de consultas ao Jira antes de chegar na tela. */
function horasNaAba(){
  var a = state.aba;
  if(a === "tarefas" || a === "versoes") return COL_HORAS.some(function(id){ return state.colunas[a].indexOf(id) === -1; });
  if(a === "checklist" || a === "homolog") return COL_HORAS.some(function(id){ return state.colunas[a].extras.indexOf(id) !== -1; });
  return false;
}
/* Tarefas da aba aberta, na ordem em que aparecem: as primeiras linhas da
   tela são as primeiras a ganhar horas. */
function tarefasDaTelaParaHoras(){
  try{
    if(state.aba === "tarefas" || state.aba === "versoes") return ordenadas(filtradas());
    if(state.aba === "checklist") return clDerivados().noFiltro;
    if(state.aba === "homolog") return hgDerivados().todas;
  }catch(e){}
  return [];
}
var HORAS_LOTE = 20, horasFalhas = 0, horasSemResposta = {};
function agendarHoras(){
  if(horasRodando || horasParado || !jiraDisponivel() || !horasNaAba()) return;
  clearTimeout(horasTimer);
  horasTimer = setTimeout(buscarHoras, 600);
}
function horasPendentes(){
  return tarefasDaTelaParaHoras().filter(function(t){
    if(!t.tempoGasto || t.tempoGasto === "0" || (!t.analistaReq && !t.testAnalyst && !t.dev)) return false;
    if(horasSemResposta[t.key] === t.updated) return false;
    var reg = HORAS[t.key];
    return !reg || reg.u !== t.updated;
  }).map(function(t){ return t.key; });
}
function guardarHoras(){
  /* Sem espaço no navegador o que já veio continua na memória (e vai no
     pacote compartilhado); apagar aqui fazia buscar tudo de novo, sem fim. */
  try{ localStorage.setItem(LS_HORAS, JSON.stringify(HORAS)); }
  catch(e){ try{ localStorage.removeItem(LS_HORAS); }catch(e2){} }
  /* Fim de uma busca de horas: vale publicar, poupa as mesmas consultas aos outros. */
  if(!horasRodando) agendarComp();
}
var horasDesenhoTimer = null;
function redesenharHorasEmBreve(){
  if(horasDesenhoTimer) return;
  horasDesenhoTimer = setTimeout(function(){ horasDesenhoTimer = null; redesenharGrades(); }, 500);
}
/* Um lote por vez, sempre recalculado: trocar de aba ou de filtro no meio já
   muda o que vem a seguir. Erro não desliga para sempre: espera e tenta de
   novo, e só desiste depois de três seguidos (Atualizar religa). */
function buscarHoras(){
  if(horasRodando || !horasNaAba()) return;
  var lote = horasPendentes().slice(0, HORAS_LOTE);
  if(!lote.length){ guardarHoras(); return; }
  horasRodando = true;
  var porChave = {}; state.tarefas.forEach(function(t){ porChave[t.key] = t; });
  window.nimitz.request("/api/worklog-hours", {keys:lote}).then(function(r){
    horasRodando = false; horasFalhas = 0;
    Object.keys(r.issues||{}).forEach(function(k){
      var t = porChave[k], n = {};
      Object.keys(r.issues[k]).forEach(function(acc){ if(r.names && r.names[acc]) n[acc] = r.names[acc]; });
      HORAS[k] = {u:t ? t.updated : "", h:r.issues[k], n:n};
    });
    /* O Jira não respondeu por esta tarefa: não insiste nela até ela mudar. */
    (r.failed||[]).forEach(function(k){ if(porChave[k]) horasSemResposta[k] = porChave[k].updated; });
    redesenharHorasEmBreve();
    buscarHoras();
  }).catch(function(e){
    horasRodando = false;
    horasFalhas++;
    console.warn("Horas por pessoa: falha ao consultar o Jira:", e && e.message);
    if(e && e.status === 401){ horasParado = true; return; }
    if(horasFalhas >= 3){ horasParado = true; guardarHoras(); redesenharGrades(); return; }
    clearTimeout(horasTimer);
    horasTimer = setTimeout(buscarHoras, Math.min(60000, (e && e.retryAfterMs) || 5000*horasFalhas));
  });
}

/* ===================== dados compartilhados =====================
   O que veio do Jira (tarefas, carimbos de frescor e horas por pessoa) é o
   mesmo para todo o time. Quem carrega ou atualiza publica o pacote no backend,
   comprimido; quem abre o painel baixa pronto, e o Atualizar seguinte só pede
   ao Jira o que mudou depois dele. O Registro (Ponto) não entra aqui, nem o que
   é de cada pessoa: checklist, marcações, filtros e colunas.
   Gravação com revisão: se outra pessoa publicou antes, o pacote dela é
   mesclado com o daqui (por tarefa, vence a atualizada por último no Jira) e o
   envio é refeito sobre a revisão nova, sem apagar o trabalho de ninguém. */
var LS_COMP_REV = window.nimitz.storagePrefix+"compartilhadoRev";
var COMP_ESPERA = 4000, COMP_CONSULTA = 60000;
var COMP = {rev:0, timer:null, enviando:false, baixando:false, adotando:false, pendente:false,
            desligado:false, falhas:0};
try{ COMP.rev = Number(localStorage.getItem(LS_COMP_REV)) || 0; }catch(e){}
function compDisponivel(){
  return jiraDisponivel() && !COMP.desligado
    && typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}
function guardarRevComp(r){ COMP.rev = r; try{ localStorage.setItem(LS_COMP_REV, String(r)); }catch(e){} }
function bytesParaB64(u8){
  var s = "", P = 0x8000;
  for(var i=0;i<u8.length;i+=P) s += String.fromCharCode.apply(null, u8.subarray(i, i+P));
  return btoa(s);
}
function b64ParaBytes(b){
  var s = atob(b), u = new Uint8Array(s.length);
  for(var i=0;i<s.length;i++) u[i] = s.charCodeAt(i);
  return u;
}
function comprimir(txt){
  return new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip")))
    .arrayBuffer().then(function(b){ return bytesParaB64(new Uint8Array(b)); });
}
function descomprimir(b64){
  return new Response(new Blob([b64ParaBytes(b64)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
/* Datas do Jira vêm com fuso sem dois-pontos (-0300); comparar como texto
   erraria entre fusos diferentes. */
function instante(v){
  if(!v) return 0;
  var t = Date.parse(String(v).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return isFinite(t) ? t : 0;
}
function pacoteComp(){
  return {v:1, tarefas:compactarTarefas(state.tarefas), total:state.total, ultimoSync:state.ultimoSync,
          syncGeral:state.syncGeral, syncPessoa:state.syncPessoa, horas:HORAS};
}
function adotarComp(p, mesclarLocal){
  var remotas = expandirTarefas(p.tarefas);
  var syncPessoa = (p.syncPessoa && typeof p.syncPessoa === "object") ? Object.assign({}, p.syncPessoa) : {};
  var syncGeral = p.syncGeral || p.ultimoSync || null, total = p.total, ultimoSync = p.ultimoSync || syncGeral;
  if(mesclarLocal && state.tarefas.length){
    var pos = Object.create(null);
    remotas.forEach(function(t,i){ pos[t.key] = i; });
    state.tarefas.forEach(function(t){
      var i = pos[t.key];
      if(i === undefined){ pos[t.key] = remotas.length; remotas.push(t); }
      else if(instante(t.updated) > instante(remotas[i].updated)) remotas[i] = t;
    });
    Object.keys(state.syncPessoa || {}).forEach(function(n){
      if(instante(state.syncPessoa[n]) > instante(syncPessoa[n])) syncPessoa[n] = state.syncPessoa[n];
    });
    if(instante(state.syncGeral) > instante(syncGeral)){ syncGeral = state.syncGeral; total = state.total; }
    if(instante(state.ultimoSync) > instante(ultimoSync)) ultimoSync = state.ultimoSync;
  }
  var horas = p.horas && typeof p.horas === "object" ? p.horas : {};
  Object.keys(horas).forEach(function(k){
    var meu = HORAS[k], dele = horas[k];
    if(!dele || !dele.h) return;
    if(!meu || instante(dele.u) > instante(meu.u)) HORAS[k] = dele;
  });
  COMP.adotando = true;
  try{
    state.tarefas = remotas;
    if(typeof total === "number") state.total = total;
    state.syncGeral = syncGeral;
    state.ultimoSync = ultimoSync;
    state.syncPessoa = syncPessoa;
    salvar();
    guardarHoras();
    inicializarCheck();
    revivarSeNecessario();
  } finally { COMP.adotando = false; }
}
function baixarComp(mesclarLocal){
  COMP.baixando = true;
  return window.nimitz.request("/api/shared/get", {}).then(function(r){
    if(!r || !r.data) return null;
    return descomprimir(r.data).then(function(txt){
      /* Carga do Jira começou enquanto o pacote descia: adotar agora trocaria
         a lista no meio dela. A próxima consulta traz de novo. */
      if(state.carregando) return null;
      adotarComp(JSON.parse(txt), mesclarLocal);
      guardarRevComp(r.revision);
      return r;
    });
  }).then(function(r){ COMP.baixando = false; return r; },
          function(e){ COMP.baixando = false; throw e; });
}
function desligarSeSemRota(err){
  /* Backend ainda sem a rota ou sem o banco: o painel segue como antes, só local. */
  if(err && (err.status === 404 || err.status === 503)){ COMP.desligado = true; return true; }
  return false;
}
function agendarComp(atraso){
  if(!compDisponivel() || COMP.adotando) return;
  COMP.pendente = true;
  clearTimeout(COMP.timer);
  COMP.timer = setTimeout(enviarComp, atraso == null ? COMP_ESPERA : atraso);
}
function enviarComp(){
  COMP.timer = null;
  if(!COMP.pendente || !compDisponivel()) return;
  /* Pacote pela metade não sai: espera a carga e as horas terminarem. */
  if(state.carregando || horasRodando || COMP.enviando || COMP.baixando){ agendarComp(); return; }
  if(!state.tarefas.length){ COMP.pendente = false; return; }
  COMP.enviando = true; COMP.pendente = false;
  var base = COMP.rev;
  comprimir(JSON.stringify(pacoteComp())).then(function(b64){
    return window.nimitz.request("/api/shared/save", {data:b64, baseRevision:base, syncGeral:state.syncGeral});
  }).then(function(m){
    COMP.enviando = false; COMP.falhas = 0;
    guardarRevComp(m.revision);
  }).catch(function(err){
    COMP.enviando = false;
    if(desligarSeSemRota(err)) return;
    if(err && err.status === 409 && COMP.falhas < 5){
      COMP.falhas++;
      /* Outra pessoa publicou antes: junta o dela com o daqui e reenvia. */
      return baixarComp(true).then(function(){ agendarComp(300); renderTudo(); })
        .catch(function(){ agendarComp(30000); });
    }
    COMP.falhas++;
    if(COMP.falhas < 5) agendarComp(30000);
    console.warn("Não deu para compartilhar os dados carregados:", msgErro(err));
  });
}
function editandoAgora(){
  var a = document.activeElement;
  return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest && a.closest("#app"));
}
function conferirComp(inicio){
  if(!compDisponivel() || COMP.baixando || COMP.enviando || state.carregando) return;
  /* Trocar a lista embaixo de quem está digitando derrubaria o que ele escreve. */
  if(!inicio && editandoAgora()) return;
  window.nimitz.request("/api/shared/meta", {}).then(function(m){
    if(!m.revision){
      /* Ninguém publicou ainda: quem já tem dados aqui semeia o compartilhado. */
      if(state.tarefas.length) agendarComp(1000);
      return;
    }
    if(m.revision === COMP.rev && state.tarefas.length) return;
    var tinha = state.tarefas.length;
    return baixarComp(COMP.pendente).then(function(r){
      if(!r) return;
      /* Em segundo plano, sem mensagem: a tela só se atualiza. Se a faixa
         ainda pedia para clicar em Atualizar, ela sai. */
      renderTudo();
      if(COMP.pendente) agendarComp();
      if(!tinha && state.aviso && state.aviso.tipo === "info") sumirAviso();
    });
  }).catch(function(err){
    if(!desligarSeSemRota(err)) console.warn("Não deu para consultar os dados compartilhados:", msgErro(err));
  });
}
function iniciarComp(){
  if(!compDisponivel()) return;
  conferirComp(true);
  setInterval(function(){ if(document.visibilityState === "visible") conferirComp(false); }, COMP_CONSULTA);
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible") conferirComp(false);
  });
}

/* ===================== início ===================== */
montarShell();
carregarLocal();
aplicarReplicado();
/* Depois de adotar o pacote replicado, e nao antes: e aqui que as tarefas
   existem de fato, e a classificacao automatica dos status depende delas. */
inicializarCheck();
revivarSeNecessario();
ligarEventos();
ligarColunasGrade();
ligarArrasteColunas();
iniciarRetomada();
renderTudo();
aplicarRetomada();
iniciarComp();
if(!jiraDisponivel()){
  avisar("info","Prévia sem conexão com o Jira. Abra Conexão para consultar dados atuais.");
} else if(!state.tarefas.length){
  avisar("info","Clique em Atualizar para trazer todas as tarefas do projeto "+PROJETO+". Depois a aba Versões recorta por release, e a Checklist por analista.");
}
})();
