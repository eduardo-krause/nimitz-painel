import {createBridge} from './ponto-bridge.js';
const api=window.parent!==window?window.parent.nimitz:null;
if(!api?.connected||api.preview){
  document.body.innerHTML='<div style="padding:32px;font:15px system-ui;color:#354858"><h2>Seu ponto de trabalho</h2><p>Conecte sua conta Atlassian no botão Conexão do painel para registrar suas horas.</p></div>';
}else{
  try{
    window.pontoBridge=await createBridge(api);
    window.pontoApi=api;
    await import('./ponto-app.js');
  }catch(error){
    const message=document.createElement('p');message.textContent='Não foi possível abrir o Ponto: '+error.message;
    message.style.cssText='padding:24px;color:#a22;font:15px system-ui';document.body.replaceChildren(message);
  }
}
