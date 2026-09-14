export interface PlayerDocumentOptions {
  core: string;
  acquisitionId: string;
  candidateId: string;
  userId: number;
  extension: string;
  title: string;
}

export function playerDocument({
  core,
  acquisitionId,
  candidateId,
  userId,
  extension,
  title,
}: PlayerDocumentOptions): string {
  if (
    !/^[a-z0-9_]+$/.test(core) ||
    !/^[a-f0-9]{64}$/.test(acquisitionId) ||
    !/^[a-f0-9]{64}$/.test(candidateId) ||
    !Number.isSafeInteger(userId) ||
    userId < 0 ||
    !/^[a-z0-9]{1,12}$/.test(extension)
  ) {
    throw new Error("INVALID_PLAYER_INPUT");
  }
  const literal = (value: string) =>
    JSON.stringify(value).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="game" style="width:100vw;height:100vh"></div><script>
window.EJS_player='#game';
document.title=${literal(title)};
window.EJS_core=${literal(core)};
window.EJS_gameName=${literal(`Romio-${userId}-${core}-${candidateId}`)};
window.EJS_gameUrl=${literal(`/api/romio/acquisitions/${acquisitionId}/content/Romio-${userId}-${candidateId}.${extension}`)};
window.EJS_pathtodata='/assets/emulatorjs/data/';
window.EJS_startOnLoaded=true;
window.EJS_disableDatabases=false;
const saveNamespace=${literal(`Romio-${userId}-${core}-${candidateId}:`)};
const saveDatabaseName=name=>name==='EmulatorJS-states'||name==='/data/saves'?saveNamespace+name:name;
for(const method of ['open','deleteDatabase']) {
  const original=IDBFactory.prototype[method];
  IDBFactory.prototype[method]=function(name,...args) { return original.call(this,saveDatabaseName(name),...args); };
}
window.EJS_onGameStart=()=>parent.postMessage({type:'romio-player-started'},location.origin);
window.addEventListener('error',()=>parent.postMessage({type:'romio-player-error'},location.origin));
window.addEventListener('unhandledrejection',()=>parent.postMessage({type:'romio-player-error'},location.origin));
window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='romio-save-and-close') return;
  const reply=ok=>parent.postMessage({type:'romio-save-result',ok},location.origin);
  const manager=window.EJS_emulator?.gameManager;
  if(!manager) { reply(true); return; }
  try {
    manager.toggleMainLoop(0);
    manager.saveSaveFiles();
    manager.FS.syncfs(false,error=>{ if(error) manager.toggleMainLoop(1); reply(!error); });
  } catch { manager.toggleMainLoop(1); reply(false); }
});
</script><script src="/assets/emulatorjs/data/loader.js"></script></body></html>`;
}
