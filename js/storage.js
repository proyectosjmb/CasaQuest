/**
 * storage.js — localStorage (1 compu)
 * Guarda:
 * - logs de completado (qué tarea, quién, fecha/hora)
 * - preferencias (usuario actual, ruta)
 */
const KEY = {
  LOGS: "casaquest.logs.v1",
  PREFS: "casaquest.prefs.v1",
  TIMER: "casaquest_timer_v1",
  CONFIG_OVERRIDE: "casaquest_config_override_v1",

};

function readJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(_e){
    return fallback;
  }
}

function writeJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

export function getLogs(){ return readJSON(KEY.LOGS, []); }

export function addLog(log){
  const logs = getLogs();
  logs.push(log);
  writeJSON(KEY.LOGS, logs);
  return logs;
}

/** Elimina el último log que cumpla una condición (para “Undo”). */
export function removeLastLog(predicateFn){
  const logs = getLogs();
  for(let i = logs.length - 1; i >= 0; i--){
    if(predicateFn(logs[i])){
      logs.splice(i, 1);
      writeJSON(KEY.LOGS, logs);
      return logs;
    }
  }
  return logs;
}

export function getPrefs(){
  const base = {
    currentUserId: null,
    route: "today",
    expressEnabled: false
  };
  const saved = readJSON(KEY.PREFS, base);
  return { ...base, ...(saved || {}) };
}


export function setPrefs(prefs){
  writeJSON(KEY.PREFS, prefs);
  return prefs;
}

export function exportBackup(config){
  const payload = {
    exported_at: new Date().toISOString(),
    config_snapshot: config,
    logs: getLogs(),
    prefs: getPrefs()
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `casaquest_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

export async function importBackupFromFile(file){
  const text = await file.text();
  const payload = JSON.parse(text);

  if(!payload || !Array.isArray(payload.logs)){
    throw new Error("Backup inválido (no trae logs).");
  }

  writeJSON(KEY.LOGS, payload.logs);
  if(payload.prefs) writeJSON(KEY.PREFS, payload.prefs);

  return payload;
}
export function getTimerState(){
  return readJSON(KEY.TIMER, null);
}

export function setTimerState(val){
  writeJSON(KEY.TIMER, val);
}

export function clearTimerState(){
  writeJSON(KEY.TIMER, null);
}
export function getConfigOverride(){
  return readJSON(KEY.CONFIG_OVERRIDE, null);
}
export function setConfigOverride(cfg){
  writeJSON(KEY.CONFIG_OVERRIDE, cfg);
}
export function clearConfigOverride(){
  writeJSON(KEY.CONFIG_OVERRIDE, null);
}
