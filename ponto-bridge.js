// Compatibility layer for the original Ponto UI. Persistence is owned by the Worker.
export async function createBridge(api){
  const documents=new Map(),listeners=new Set();
  let pending=0,refreshing=null,serial=Promise.resolve();
  const clone=value=>structuredClone(value);
  const docSnapshot=path=>({id:path.split('/').at(-1),exists:documents.has(path),data:()=>clone(documents.get(path)?.data)});
  function snapshot(spec){
    if(spec.kind==='doc') return docSnapshot(spec.path);
    const prefix=spec.path+'/';
    let rows=[...documents.keys()].filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(docSnapshot);
    if(spec.sort) rows.sort((a,b)=>{const x=a.data()[spec.sort],y=b.data()[spec.sort];return (x<y?-1:x>y?1:0)*(spec.direction==='desc'?-1:1);});
    if(spec.limit) rows=rows.slice(0,spec.limit);
    return {docs:rows};
  }
  function notify(force=false){
    for(const listener of [...listeners]){
      const snap=snapshot(listener.spec);
      const signature=JSON.stringify(snap.docs?snap.docs.map(d=>[d.id,d.data()]):[snap.exists,snap.data()]);
      if(!force&&signature===listener.signature) continue;
      listener.signature=signature;
      queueMicrotask(()=>{try{listener.callback(snap);}catch(error){listener.error?.(error);console.error('Ponto: erro de interface',error.message);}});
    }
  }
  async function refresh(){
    if(refreshing) return refreshing;
    if(pending) return;
    refreshing=(async()=>{
      const next=new Map();let cursor=null;
      do {
        const data=await api.request('/api/ponto/snapshot',{cursor});
        data.documents.forEach(d=>next.set(d.path,d));cursor=data.next;
      }while(cursor);
      if(!pending){documents.clear();next.forEach((v,k)=>documents.set(k,v));notify();}
    })();
    try{await refreshing;}finally{refreshing=null;}
  }
  function reference(spec){
    const ref={
      id:spec.path.split('/').at(-1),
      doc(id=crypto.randomUUID()){return reference({kind:'doc',path:spec.path+'/'+id});},
      collection(name){return reference({kind:'collection',path:spec.path+'/'+name});},
      orderBy(sort,direction='asc'){return reference({...spec,sort,direction});},
      limit(limit){return reference({...spec,limit});},
      async get(){return snapshot(spec);},
      onSnapshot(callback,error){
        const listener={spec,callback,error};listeners.add(listener);notify();
        return ()=>listeners.delete(listener);
      },
      async add(data){const child=ref.doc();await child.set(data);return child;},
      set(data){return write('set',data);},
      update(data){return write('update',data);},
      delete(){return write('remove');}
    };
    function write(action,data){
      pending++;
      const operation=serial.catch(()=>{}).then(async()=>{
        const current=documents.get(spec.path);
        if(action==='update'&&!current) throw new Error('Lançamento não encontrado. Atualize a página.');
        const body={path:spec.path,revision:current?.revision||0};
        if(action==='remove') body.remove=true;
        else body.data=action==='update'?{...current.data,...data}:data;
        const response=await api.request('/api/ponto/document',body);
        if(response.removed) documents.delete(spec.path);else documents.set(spec.path,response.document);
        notify();
      });
      serial=operation;
      return operation.finally(()=>{pending--;}).catch(async error=>{await refresh().catch(()=>{});notify(true);throw error;});
    }
    return ref;
  }
  await refresh();
  setInterval(()=>{if(!document.hidden&&(api.pontoActive?.()||api.pontoRunning)) refresh().catch(()=>{});},30000);
  const db={doc:path=>reference({kind:'doc',path}),collection:path=>reference({kind:'collection',path})};
  const mcp={async callTool(server,tool,args){
    if(tool==='getJiraIssue'){
      const data=await api.request('/api/ponto/issue',{key:args.issueIdOrKey});
      return {payload:{context:{atlassianAccountId:data.accountId},issues:{nodes:[data.issue]}}};
    }
    if(tool==='executeRead'&&args.name==='listJiraIssueWorklogs'){
      const data=await api.request('/api/ponto/worklogs',{key:args.inputs.issueIdOrKey,startAt:args.inputs.startAt||0});
      return {payload:{data,context:{atlassianAccountId:data.accountId}}};
    }
    if(tool==='executeWrite'&&args.name==='addOrEditJiraIssueWorklog'){
      try{return {payload:{data:await api.request('/api/ponto/worklog/save',args.inputs)}};}
      catch(error){if(error.status>=500||!error.status) error.code='upstream_error';throw error;}
    }
    throw new Error('Operação não disponível nesta integração.');
  }};
  const user={id:async()=>encodeURIComponent(api.accountId)};
  return {use:async name=>({db,mcp,user}[name]),refresh};
}
