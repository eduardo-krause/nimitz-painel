import {createBridge} from './ponto-bridge.js?v=20261105c';
const api=window.parent!==window?window.parent.nimitz:null;
// O Ponto segue o tema do painel (o painel usa o do sistema, ou data-theme se definido).
function followPanelTheme(){
  try{
    const root=window.parent.document.documentElement;
    const scheme=root.dataset.theme||(/dark/.test(window.parent.getComputedStyle(root).colorScheme)?'dark':'light');
    document.documentElement.dataset.theme=scheme;
  }catch{}
}
followPanelTheme();
try{window.parent.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',followPanelTheme);}catch{}
if(!api?.connected||api.preview){
  document.body.innerHTML='<div style="padding:32px;font:15px system-ui;color:#354858"><h2>Seu ponto de trabalho</h2><p>Conecte sua conta Atlassian no botão Conexão do painel para registrar suas horas.</p></div>';
}else{
  try{
    window.pontoBridge=await createBridge(api);
    window.pontoApi=api;
    await import('./ponto-app.js?v=20261105c');
  }catch(error){
    const message=document.createElement('p');message.textContent='Não foi possível abrir o Ponto: '+error.message;
    message.style.cssText='padding:24px;color:#a22;font:15px system-ui';document.body.replaceChildren(message);
  }
}
