import {createBridge} from './ponto-bridge.js?v=20261112a';
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
// Acompanha o botão de tema do painel.
try{new window.parent.MutationObserver(followPanelTheme).observe(window.parent.document.documentElement,{attributes:true,attributeFilter:['data-theme']});}catch{}
// Troca o conteúdo por um aviso sem apagar os estilos (eles ficam dentro do body).
function showOnly(content){
  document.querySelectorAll('body > :not(style):not(script)').forEach(node=>node.remove());
  const box=document.createElement('div');box.className='ponto-aviso';
  if(typeof content==='string') box.innerHTML=content; else box.append(content);
  document.body.append(box);
}
if(!api?.connected||api.preview){
  showOnly('<div class="rotulo-ponto">Registro</div><p>Conecte sua conta Atlassian no botão <b>Conexão</b> do painel para registrar suas horas.</p>');
}else{
  try{
    window.pontoBridge=await createBridge(api);
    window.pontoApi=api;
    await import('./ponto-app.js?v=20261112a');
  }catch(error){
    const message=document.createElement('p');message.className='ponto-erro';message.textContent='Não foi possível abrir o Registro: '+error.message;
    showOnly(message);
  }
}
