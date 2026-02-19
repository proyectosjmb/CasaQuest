/**
 * app.js — CasaQuest v0.1
 * Pantallas:
 * - Hoy: tareas “debidas hoy” + 1 toque para marcar
 * - Resumen: % cumplimiento y puntos por persona
 * - Asignaciones: lista de tareas y quién las tiene
 * - Ajustes: cambiar usuario + importar/exportar backup
 */

import { getLogs as getLocalLogs, addLog, removeLastLog, getPrefs, setPrefs, exportBackup, importBackupFromFile } from "./storage.js";
import { dateKey, dowKey, weekKey } from "./time.js";
import { $, escapeHtml, toast, openModal, closeModal, wireModalClose } from "./ui.js";
import { getTimerState, setTimerState, clearTimerState } from "./storage.js";
import { getConfigOverride, setConfigOverride, clearConfigOverride } from "./storage.js";


const state = {
  config: null,
  prefs: null,
  cloudEnabled: false,
  cloudLogs: null
};
let timerTickHandle = null;

function fmtClock(sec){
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${mm}:${ss}`;
}

function showTimerDock(show){
  const dock = document.getElementById("timerDock");
  if(!dock) return;
  dock.classList.toggle("hidden", !show);
}

function renderTimerDock(){
  const t = state.timer;
  if(!t || !t.running){
    showTimerDock(false);
    return;
  }
  showTimerDock(true);

  const task = state.config.tasks.find(x=>x.id===t.taskId);
  document.getElementById("timerTaskName").textContent = task?.name || "Timer";
  document.getElementById("timerClock").textContent = fmtClock(t.remainingSec);

  const btnPause = document.getElementById("btnTimerPause");
  if(btnPause) btnPause.textContent = t.paused ? "Reanudar" : "Pausa";
}

function stopTimerInternal({ keepState=false } = {}){
  if(timerTickHandle){
    clearInterval(timerTickHandle);
    timerTickHandle = null;
  }
  if(!keepState){
    state.timer = null;
    clearTimerState();
  }
  renderTimerDock();
}

function startTicking(){
  if(timerTickHandle) return;

  timerTickHandle = setInterval(()=>{
    const t = state.timer;
    if(!t || !t.running) return;

    if(t.paused){
      renderTimerDock();
      return;
    }

    const now = Date.now();
    const remainingMs = t.endAt - now;
    t.remainingSec = Math.ceil(remainingMs/1000);

    // Persistimos para que si recargas, siga
    setTimerState(t);

    if(t.remainingSec <= 0){
      // Termina
      const task = state.config.tasks.find(x=>x.id===t.taskId);
      stopTimerInternal({ keepState:true }); // detenemos tick pero mantenemos t para el modal

      openModal({
        title: "⏱️ ¡Tiempo!",
        bodyHtml: `
          <div class="small">Terminó el timer de:</div>
          <div style="margin-top:6px"><b>${escapeHtml(task?.name || "tarea")}</b></div>
          <div class="small" style="margin-top:10px">¿La marcamos como hecha?</div>
        `,
        actionsHtml: `
          <button class="btn primary" data-action="timerMarkDone" data-task="${escapeHtml(task?.id || "")}">Marcar hecha ✅</button>
          <button class="btn" data-action="timerClose" data-close="1">Cerrar</button>
        `
      });

      // dejamos el timer “existente” pero ya no corriendo
      state.timer.running = false;
      state.timer.paused = false;
      state.timer.remainingSec = 0;
      setTimerState(state.timer);

      renderTimerDock();
    }else{
      renderTimerDock();
    }
  }, 250);
}

function startTaskTimer(taskId){
  const task = state.config.tasks.find(t=>t.id===taskId);
  if(!task) return;

  // Si ya está hecha hoy, no tiene sentido correr timer
  const ctx = nowContext();
  if(typeof isDoneToday === "function" && isDoneToday(task, ctx)){
    toast("Ya estaba ✅ (usa Undo si fue error)");
    return;
  }

  const durationMin = Number(task.minutes || 10);
  const durationSec = Math.max(10, Math.floor(durationMin*60));

  // Si hay otro timer activo, lo reemplazamos
  if(state.timer && state.timer.running){
    stopTimerInternal({ keepState:false });
  }

  const now = Date.now();
  state.timer = {
    running: true,
    paused: false,
    taskId,
    durationSec,
    startAt: now,
    endAt: now + durationSec*1000,
    remainingSec: durationSec
  };

  setTimerState(state.timer);
  renderTimerDock();
  startTicking();
  toast("⏱️ Timer iniciado");
}

function toggleTimerPause(){
  const t = state.timer;
  if(!t || !t.running) return;

  if(!t.paused){
    t.paused = true;
    t.pauseAt = Date.now();
  }else{
    // reanuda: empuja endAt por el tiempo pausado
    const pausedMs = Date.now() - (t.pauseAt || Date.now());
    t.endAt += pausedMs;
    t.paused = false;
    delete t.pauseAt;
  }

  setTimerState(t);
  renderTimerDock();
}

function stopTimer(){
  if(!state.timer){
    toast("No hay timer activo");
    return;
  }
  stopTimerInternal({ keepState:false });
  toast("⏹️ Timer detenido");
}

// Rehidratar timer si recargas
function restoreTimerIfAny(){
  const saved = getTimerState();
  if(saved && saved.taskId){
    state.timer = saved;

    // si estaba “corriendo” y no estaba pausado, retomamos ticking
    if(state.timer.running){
      startTicking();
    }
    renderTimerDock();
  }else{
    state.timer = null;
    renderTimerDock();
  }
}

function setRoute(route){
  state.prefs.route = route;
  setPrefs(state.prefs);
  render();
}

function setCurrentUser(userId){
  state.prefs.currentUserId = userId;
  setPrefs(state.prefs);
  renderHeaderUser();
  render();
}

function getPersonLabel(id){
  return state.config.people.find(p=>p.id===id)?.label ?? id;
}

function nowContext(){
  const tz = state.config.app.timezone;
  const now = new Date();
  return {
    tz,
    now,
    dk: dateKey(now, tz),
    wk: weekKey(now, tz),
    dow: dowKey(now, tz)
  };
}

function getLogs(){
  if(Array.isArray(state.cloudLogs)) return state.cloudLogs;
  return getLocalLogs();
}
function isTaskVisibleByMode(task){
  const on = !!state.prefs.expressEnabled;
  if(on && task.hide_on_express) return false;
  if(!on && task.only_on_express) return false;
  return true;
}

function weeklyProgressText(task, ctx){
  const logs = getLogs();
  if(task.frequency === "weekly"){
    const done = logs.filter(l => l.taskId === task.id && l.weekKey === ctx.wk).length;
    return `Semana: ${Math.min(done,1)}/1`;
  }
  if(task.frequency === "weekly_times"){
    const target = Number(task.times_per_week || 0);
    const done = logs.filter(l => l.taskId === task.id && l.weekKey === ctx.wk).length;
    return `Semana: ${done}/${target}`;
  }
  return "";
}

/** Regla MVP: decide si una tarea “toca hoy” */
/** Decide si una tarea “toca hoy” según su frecuencia. */
function isTaskDueToday(task, ctx){
  const logs = getLogs();

  // 1) daily = siempre
  if(task.frequency === "daily") return true;

  // 2) weekly_days = solo si hoy es uno de esos días
  if(task.frequency === "weekly_days"){
    return (task.days || []).includes(ctx.dow);
  }

  // 3) weekly = 1 vez por semana. Si ya se hizo esta semana, ya no aparece.
  if(task.frequency === "weekly"){
    const count = logs.filter(l => l.taskId === task.id && l.weekKey === ctx.wk).length;
    return count < 1;
  }

  // 4) weekly_times = X veces por semana. Aparece mientras falten “repeticiones”.
  if(task.frequency === "weekly_times"){
    const target = Number(task.times_per_week || 0);
    const done = logs.filter(l => l.taskId === task.id && l.weekKey === ctx.wk).length;
    return done < target;
  }

  return false;
}


function logsForTaskOnDate(taskId, dk){
  return getLogs().filter(l => l.taskId === taskId && l.dateKey === dk);
}

function logsForTaskInWeek(taskId, wk){
  return getLogs().filter(l => l.taskId === taskId && l.weekKey === wk);
}

function isDoneToday(task, ctx){
  return logsForTaskOnDate(task.id, ctx.dk).length > 0;
}

async function markDone(task){
  const ctx = nowContext();
  const log = {
    id: crypto.randomUUID(),
    taskId: task.id,
    taskName: task.name,
    userId: state.prefs.currentUserId,
    atISO: new Date().toISOString(),
    dateKey: ctx.dk,
    weekKey: ctx.wk,
    points: task.points || 0,
    minutes: task.minutes || 0
  };

  if(state.cloudEnabled === true && window.CQCloud){
    try{
      const { id: _localId, ...cloudLog } = log;
      await window.CQCloud.addLog(cloudLog);
      toast(`✅ Hecho: ${task.name}`);
      return;
    }catch(err){
      console.error(err);
      toast("❌ No se pudo guardar en nube");
      return;
    }
  }

  addLog(log);
  toast(`✅ Hecho: ${task.name}`);
  render();
}

async function undoLastForTask(taskId){
  if(state.cloudEnabled === true && window.CQCloud){
    const taskLogs = getLogs().filter(l => l.taskId === taskId);
    if(!taskLogs.length) return;

    const withCreatedAt = taskLogs.filter(l => Number.isFinite(Number(l.createdAt)));
    let last = null;

    if(withCreatedAt.length){
      last = withCreatedAt
        .slice()
        .sort((a,b)=> Number(a.createdAt) - Number(b.createdAt))
        .at(-1);
    }else{
      last = taskLogs[taskLogs.length - 1];
    }

    if(last?.id){
      try{
        await window.CQCloud.deleteLog(last.id);
        toast("↩️ Deshecho");
      }catch(err){
        console.error(err);
        toast("❌ No se pudo deshacer en nube");
      }
    }
    return;
  }

  removeLastLog(l => l.taskId === taskId);
  toast("↩️ Deshecho");
  render();
}

/** ---------- Render: Header ---------- */
function renderHeaderUser(){
  const btn = $("#btnUser");
  const id = state.prefs.currentUserId;
  btn.textContent = id ? `👤 ${getPersonLabel(id)}` : "👤 Elegir usuario";

  const bx = $("#btnExpress");
  if(bx){
    bx.textContent = state.prefs.expressEnabled ? "⚡ Express: ON" : "⚡ Express: OFF";
  }
}
function ensureTabAccordion(){
  const nav = document.querySelector(".topNav");
  if(!nav) return;

  // Si ya existe, nada
  if(nav.querySelector(".tabAccordion")) return;

  const tabs = Array.from(nav.querySelectorAll("button.tab"));
  if(!tabs.length) return;

  const details = document.createElement("details");
  details.className = "tabAccordion";

  const summary = document.createElement("summary");
  summary.className = "tabAccordionSummary";
  summary.id = "tabAccordionSummary";
  summary.textContent = "Menú";

  const panel = document.createElement("div");
  panel.className = "tabAccordionPanel";

  // Mueve los tabs existentes al panel
  tabs.forEach(btn => panel.appendChild(btn));

  details.appendChild(summary);
  details.appendChild(panel);

  // Limpia y mete el acordeón
  nav.innerHTML = "";
  nav.appendChild(details);

  // En desktop lo dejamos abierto para que se vea normal
  const isMobile = window.matchMedia("(max-width: 640px)").matches;
  details.open = !isMobile;
}


function renderTabs(){
  const nav = document.querySelector(".topNav");
  if(!nav) return;

  // 1) Botón toggle (solo lo crea una vez)
  if(!nav.querySelector("#btnTabsToggle")){
    const t = document.createElement("button");
    t.id = "btnTabsToggle";
    t.className = "tab";
    t.type = "button";
    t.textContent = "☰ Menú";
    nav.prepend(t);
  }

  // 2) Asegura tab Semana (y lo pone justo después de Hoy)
  let weekBtn = nav.querySelector('.tab[data-route="week"]');
  const todayBtn = nav.querySelector('.tab[data-route="today"]');

  if(!weekBtn){
    weekBtn = document.createElement("button");
    weekBtn.className = "tab";
    weekBtn.dataset.route = "week";
    weekBtn.type = "button";
    weekBtn.textContent = "Semana";
    nav.appendChild(weekBtn);
  }

  // Reacomoda: semana inmediatamente después de Hoy
  if(todayBtn && weekBtn && todayBtn.nextElementSibling !== weekBtn){
    todayBtn.insertAdjacentElement("afterend", weekBtn);
  }

  // 3) Marca tab activa
  const route = state.prefs.route;
  nav.querySelectorAll('.tab[data-route]').forEach(b=>{
    const r = b.dataset.route;
    b.setAttribute("aria-current", r === route ? "page" : "false");
  });

  // 4) Cambia el texto del botón toggle para que diga dónde estás
  const active = nav.querySelector('.tab[data-route][aria-current="page"]');
  const toggle = nav.querySelector("#btnTabsToggle");
  if(toggle && active){
    toggle.textContent = `☰ ${active.textContent.trim()}`;
  }
}


  const route = state.prefs.route;
  document.querySelectorAll(".tab").forEach(b=>{
    const r = b.dataset.route;
    b.setAttribute("aria-current", r === route ? "page" : "false");
  });
}

/** ---------- Pantalla: Hoy ---------- */
function renderToday(){
  const ctx = nowContext();

  // Si por alguna razón no hay usuario elegido, usa el primero de config
  if(!state.prefs.currentUserId){
    state.prefs.currentUserId = state.config.people?.[0]?.id || "papa";
    setPrefs(state.prefs);
    renderHeaderUser();
  }

  const activeId = state.prefs.currentUserId;

  // Canon: para que “normal” y “express” cuenten como la misma tarea
  const CANON = {
    cocina_zona_agua_express: "cocina_zona_agua",
    cocina_superficies_express: "cocina_superficies",
    cocina_guardar_express: "cocina_guardar"
  };
  const canonId = (id) => CANON[id] || id;

  const logs = getLogs();
  const todayLogs = logs.filter(l => l.dateKey === ctx.dk);

  // Mapa: última ejecución por tarea canónica (para saber quién la hizo)
  const lastByCanon = new Map();
  for(const l of todayLogs){
    lastByCanon.set(canonId(l.taskId), l);
  }
  const doneCanonSet = new Set([...lastByCanon.keys()]);
  const isDoneTodayCanon = (task) => doneCanonSet.has(canonId(task.id));

  // Visibilidad por modo Express (para no duplicar normal+express)
  const expressOn = !!state.prefs.expressEnabled;
  const isVisibleByMode = (task) => {
    if(expressOn && task.hide_on_express) return false;
    if(!expressOn && task.only_on_express) return false;
    return true;
  };

  // “Hoy”: solo tareas que tocan hoy según la frecuencia
  const dueToday = state.config.tasks
    .filter(t => isVisibleByMode(t))
    .filter(t => isTaskDueToday(t, ctx));

  // Filtro por persona:
  // - Tareas asignadas a esa persona
  // - + tareas sin asignar (familia) para que no se pierdan
  // - + BossFight (aunque esté asignado a Papá, lo muestro a todos para hacerlo “familiar”)
  const myTasksToday = dueToday.filter(t =>
    t.assigned_to === activeId ||
    !t.assigned_to ||
    t.zone === "BossFight"
  );

  // Pendientes vs hechas
  const pending = myTasksToday.filter(t => !isDoneTodayCanon(t));
  const done = myTasksToday.filter(t => isDoneTodayCanon(t));

  // Conteos rápidos (para que se sienta “juego”)
  const pendingPts = pending.reduce((acc,t)=> acc + (t.points||0), 0);
  const pendingMin = pending.reduce((acc,t)=> acc + (t.minutes||0), 0);

  // Botones tipo “pestañas” por persona
  const peopleTabs = state.config.people.map(p=>{
    const active = p.id === activeId;
    return `
      <button class="btn ${active ? "primary" : ""}" data-action="setPersonTab" data-user="${escapeHtml(p.id)}">
        ${escapeHtml(p.label)}
      </button>
    `;
  }).join("");

  // Render de listas
  const renderPendingList = () => {
    if(!pending.length){
      return `<div class="small">Todo listo por aquí ✅ (ya puedes presumir… o elegir la peli 😄)</div>`;
    }

    // Agrupar por zona para que no sea una sopa
    const byZone = new Map();
    for(const t of pending){
      const z = t.zone || "General";
      if(!byZone.has(z)) byZone.set(z, []);
      byZone.get(z).push(t);
    }

    let out = "";
    for(const [zone, arr] of byZone.entries()){
      const items = arr.map(t=>{
        // progreso semanal si existe helper (si no, no pasa nada)
        let prog = "";
        try{
          if(typeof weeklyProgressText === "function"){
            const txt = weeklyProgressText(t, ctx);
            prog = txt ? ` · <b>${escapeHtml(txt)}</b>` : "";
          }
        }catch(_e){}

        return `
          <div class="item">
           <div class="check" data-action="toggle" data-task="${escapeHtml(t.id)}"></div>
           <div class="meta">
            <div class="name">${escapeHtml(t.name)}</div>
            <div class="sub">${t.points||0} pts · ~${t.minutes||0} min${prog}</div>
            ${t.notes ? `<div class="sub">${escapeHtml(t.notes)}</div>` : ""}
           </div>
           <div class="right">
            <button class="btn" data-action="timerStart" data-task="${escapeHtml(t.id)}">⏱</button>
           </div>
          </div>

        `;
      }).join("");

      out += `
        <div class="card" style="margin-bottom:12px">
          <div class="h1">${escapeHtml(zone)}</div>
          <div class="list">${items}</div>
        </div>
      `;
    }
    return out;
  };

  const renderDoneList = () => {
    if(!done.length) return `<div class="small">Aún no hay tareas hechas hoy en esta pestaña.</div>`;

    const items = done.map(t=>{
      const last = lastByCanon.get(canonId(t.id));
      const who = last?.userId ? getPersonLabel(last.userId) : "";
      const whoLine = who ? ` · Hecho por <b>${escapeHtml(who)}</b>` : "";

      return `
        <div class="item done">
          <div class="check" data-action="noop">✓</div>
          <div class="meta">
            <div class="name">${escapeHtml(t.name)}</div>
            <div class="sub">${t.points||0} pts · ~${t.minutes||0} min${whoLine}</div>
          </div>
          <div class="right">
            <button class="btn" data-action="undo" data-task="${escapeHtml(t.id)}">Undo</button>
          </div>
        </div>
      `;
    }).join("");

    return `<div class="list">${items}</div>`;
  };

  $("#main").innerHTML = `
    <section class="card">
      <div class="h1">Hoy · ${escapeHtml(ctx.dk)}</div>
      <div class="small">
        Pestaña activa: <b>${escapeHtml(getPersonLabel(activeId))}</b> ·
        Pendientes: <b>${pending.length}</b> ·
        ${pendingPts} pts · ~${pendingMin} min
        ${state.prefs.expressEnabled ? " · ⚡ Express ON" : ""}
      </div>
      <div class="row" style="margin-top:10px">
        ${peopleTabs}
      </div>
      <div class="small" style="margin-top:10px">
        Aquí solo ves <b>tus pendientes</b> de hoy. Las “Hechas” están abajo para que no estorben.
      </div>
    </section>

    ${renderPendingList()}

    <section class="card">
      <div class="h1">Hechas hoy</div>
      ${renderDoneList()}
    </section>
  `;
}

/** ---------- Pantalla: Semana ---------- */
function renderWeekPlan(){
  const ctx = nowContext();
  const logs = getLogs();

  if(!state.prefs.currentUserId){
    state.prefs.currentUserId = state.config.people?.[0]?.id || "papa";
    setPrefs(state.prefs);
    renderHeaderUser();
  }

  const activeId = state.prefs.currentUserId;
  const tz = ctx.tz;
  const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DOW_LABEL = {
    mon: "Lun", tue: "Mar", wed: "Mie", thu: "Jue", fri: "Vie", sat: "Sab", sun: "Dom"
  };

  function parseDateKey(dk){
    const [y,m,d] = String(dk || "").split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
  }

  function addDays(dk, delta){
    const base = parseDateKey(dk);
    return new Date(base.getTime() + delta * 86400000);
  }

  function isDueOnDow(task, dow){
    if(task.frequency === "daily") return true;
    if(task.frequency === "weekly_days") return (task.days || []).includes(dow);
    return false;
  }

  function isDoneOnDate(taskId, dk){
    return logs.some(l => l.taskId === taskId && l.dateKey === dk);
  }

  const assignedTasks = (state.config.tasks || [])
    .filter(t => isTaskVisibleByMode(t))
    .filter(t => t.assigned_to === activeId)
    .filter(t => t.frequency === "daily" || t.frequency === "weekly_days")
    .slice()
    .sort((a,b)=> (a.zone || "").localeCompare(b.zone || "") || (a.name || "").localeCompare(b.name || ""));

  const tomorrowDate = addDays(ctx.dk, 1);
  const tomorrowKey = dateKey(tomorrowDate, tz);
  const tomorrowDow = dowKey(tomorrowDate, tz);
  const tomorrowTasks = assignedTasks.filter(t => isDueOnDow(t, tomorrowDow));

  const renderTaskItem = (task, dk)=>{
    const done = isDoneOnDate(task.id, dk);
    return `
      <div class="item ${done ? "done" : ""}">
        <div class="check" aria-hidden="true">${done ? "✅" : ""}</div>
        <div class="meta">
          <div class="name">${escapeHtml(task.name)}</div>
          <div class="sub">Zona: <b>${escapeHtml(task.zone || "General")}</b> · ${Number(task.points || 0)} pts · ~${Number(task.minutes || 0)} min</div>
        </div>
      </div>
    `;
  };

  const tomorrowRows = tomorrowTasks.length
    ? tomorrowTasks.map(t => renderTaskItem(t, tomorrowKey)).join("")
    : `<div class="small">No tienes tareas asignadas para mañana.</div>`;

  const dayIndex = Math.max(0, DOW_ORDER.indexOf(ctx.dow));
  const mondayDate = addDays(ctx.dk, -dayIndex);

  const weekCards = DOW_ORDER.map((dow, idx)=>{
    const dayDate = new Date(mondayDate.getTime() + idx * 86400000);
    const dk = dateKey(dayDate, tz);
    const dayTasks = assignedTasks.filter(t => isDueOnDow(t, dow));
    const rows = dayTasks.length
      ? dayTasks.map(t => renderTaskItem(t, dk)).join("")
      : `<div class="small">Sin tareas.</div>`;

    return `
      <article class="card" style="flex:1 1 240px;margin-bottom:0">
        <div class="h1">${escapeHtml(DOW_LABEL[dow])}</div>
        <div class="small">${escapeHtml(dk)}</div>
        <div class="list">${rows}</div>
      </article>
    `;
  }).join("");

  $("#main").innerHTML = `
    <section class="card">
      <div class="h1">Mañana (${escapeHtml(tomorrowKey)})</div>
      <div class="small">Plan de <b>${escapeHtml(getPersonLabel(activeId))}</b></div>
      <div class="list">${tomorrowRows}</div>
    </section>

    <section class="card">
      <div class="h1">Semana (Lun-Dom)</div>
      <div class="small">Tareas asignadas a <b>${escapeHtml(getPersonLabel(activeId))}</b></div>
      <div class="row" style="align-items:stretch">${weekCards}</div>
    </section>
  `;
}
/** ---------- Pantalla: Resumen ---------- */
function renderSummary(){
  const ctx = nowContext();
  const logs = getLogs();
  const todayLogs = logs.filter(l => l.dateKey === ctx.dk);
  const weekLogs  = logs.filter(l => l.weekKey === ctx.wk);

  // --- Canonical IDs (para que Express cuente como “la misma tarea”) ---
  const CANON = {
    cocina_zona_agua_express: "cocina_zona_agua",
    cocina_superficies_express: "cocina_superficies",
    cocina_guardar_express: "cocina_guardar"
  };
  const canonId = (id) => CANON[id] || id;

  // Usamos solo el “catálogo base” para EXPECTED (evita doble conteo con Express)
  const baseTasks = (state.config.tasks || []).filter(t => !t.only_on_express);

  // Orden semanal (lunes = inicio)
  const DOW_ORDER = ["mon","tue","wed","thu","fri","sat","sun"];
  const dayIdx = DOW_ORDER.indexOf(ctx.dow);
  const daysElapsed = (dayIdx >= 0 ? dayIdx : 0) + 1;

  // --- Helpers expected/done ---
  function expectedWeek(task){
    if(task.frequency === "daily") return 7;
    if(task.frequency === "weekly_days") return (task.days || []).length;
    if(task.frequency === "weekly") return 1;
    if(task.frequency === "weekly_times") return Number(task.times_per_week || 0);
    return 0;
  }

  // Expected “hasta hoy” (para que los reportes no se vean injustos al inicio de semana)
  function expectedToDate(task){
    if(task.frequency === "daily") return daysElapsed;

    if(task.frequency === "weekly_days"){
      const days = task.days || [];
      return days.filter(d => DOW_ORDER.indexOf(d) !== -1 && DOW_ORDER.indexOf(d) <= dayIdx).length;
    }

    if(task.frequency === "weekly") return 1;

    if(task.frequency === "weekly_times"){
      const target = Number(task.times_per_week || 0);
      if(target <= 0) return 0;
      const scaled = Math.ceil(target * (daysElapsed / 7));
      return Math.min(target, Math.max(0, scaled));
    }

    return 0;
  }

  function doneWeekCount(task){
    const tid = task.id;
    const taskLogs = weekLogs.filter(l => canonId(l.taskId) === tid);

    // daily / weekly_days: 1 vez por día => contamos días únicos
    if(task.frequency === "daily" || task.frequency === "weekly_days"){
      const dates = new Set(taskLogs.map(l => l.dateKey));
      return dates.size;
    }

    // weekly / weekly_times: contamos marks
    return taskLogs.length;
  }

  function doneToDateCount(task){
    const tid = task.id;
    const taskLogs = weekLogs
      .filter(l => canonId(l.taskId) === tid)
      .filter(l => (l.dateKey || "") <= ctx.dk); // YYYY-MM-DD compara bien como string

    if(task.frequency === "daily" || task.frequency === "weekly_days"){
      const dates = new Set(taskLogs.map(l => l.dateKey));
      return dates.size;
    }

    return taskLogs.length;
  }

  function cap(n, max){ return Math.min(n, max); }

  // --- Tu función original: puntos/minutos por quien lo hizo ---
  function aggByPerson(items){
    const map = new Map();
    for(const p of state.config.people) map.set(p.id, { id:p.id, label:p.label, points:0, minutes:0, count:0 });
    for(const l of items){
      const row = map.get(l.userId) || { id:l.userId, label:getPersonLabel(l.userId), points:0, minutes:0, count:0 };
      row.points += (l.points||0);
      row.minutes += (l.minutes||0);
      row.count += 1;
      map.set(l.userId, row);
    }
    return Array.from(map.values());
  }

  const todayAgg = aggByPerson(todayLogs);
  const weekAgg  = aggByPerson(weekLogs);

  const fmtRows = (rows)=> rows.map(r=>`
    <div class="item">
      <div class="meta">
        <div class="name">${escapeHtml(r.label)}</div>
        <div class="sub">${r.count} tareas · ${r.points} pts · ~${r.minutes} min</div>
      </div>
    </div>
  `).join("");

  // --- KPI “Cocina cerrada”: normal o express cuenta ---
  function doneToday(taskId){
    return todayLogs.some(l => canonId(l.taskId) === taskId);
  }

  const kitchenClosed =
    doneToday("cocina_zona_agua") &&
    doneToday("cocina_superficies") &&
    doneToday("cocina_guardar");

  // --- Reporte 1: Cumplimiento (Responsable) basado en EXPECTED ---
  // Hoy: qué debía hacer cada quien HOY (según isTaskDueToday) y cuánto ya se hizo (incluye express via canon)
  const dueTodayTasks = baseTasks.filter(t => typeof isTaskDueToday === "function" ? isTaskDueToday(t, ctx) : true);

  function responsibleTodayRows(){
    return state.config.people.map(p=>{
      const mine = dueTodayTasks.filter(t => t.assigned_to === p.id);
      const expected = mine.length;
      const done = mine.reduce((acc, t) => acc + (doneToday(t.id) ? 1 : 0), 0);
      const pct = expected > 0 ? Math.round((done/expected)*100) : 100;
      return { id:p.id, label:p.label, expected, done, pct };
    });
  }

  // Semana: expected completo (más justo) + done capado
  function responsibleWeekRows(){
    return state.config.people.map(p=>{
      const mine = baseTasks.filter(t => t.assigned_to === p.id);
      const expected = mine.reduce((acc, t)=> acc + expectedWeek(t), 0);

      const done = mine.reduce((acc, t)=>{
        const mx = expectedWeek(t);
        const d = cap(doneWeekCount(t), mx);
        return acc + d;
      }, 0);

      const pct = expected > 0 ? Math.round((done/expected)*100) : 100;

      // “Carga planificada” para darle contexto (minutos esperados)
      const plannedMinutes = mine.reduce((acc, t)=> acc + (expectedWeek(t) * (t.minutes||0)), 0);

      return { id:p.id, label:p.label, expected, done, pct, plannedMinutes };
    });
  }

  const respToday = responsibleTodayRows();
  const respWeek  = responsibleWeekRows();

  const fmtRespToday = respToday.map(r=>`
    <div class="item">
      <div class="meta">
        <div class="name">${escapeHtml(r.label)}</div>
        <div class="sub"><b>${r.pct}%</b> · ${r.done}/${r.expected} tareas (responsable)</div>
      </div>
    </div>
  `).join("");

  const fmtRespWeek = respWeek.map(r=>`
    <div class="item">
      <div class="meta">
        <div class="name">${escapeHtml(r.label)}</div>
        <div class="sub"><b>${r.pct}%</b> · ${r.done}/${r.expected} (semana) · ~${r.plannedMinutes} min plan</div>
      </div>
    </div>
  `).join("");

  // --- Reporte 2: “Tareas que se rezagan” (hasta hoy) ---
  // Calculamos déficit con expectedToDate (no castiga tareas de fin de semana antes de tiempo)
  const lagging = baseTasks.map(t=>{
    const exp = expectedToDate(t);
    const done = cap(doneToDateCount(t), expectedWeek(t));
    const deficit = Math.max(0, exp - done);
    return { id:t.id, name:t.name, zone:t.zone, exp, done, deficit };
  })
  .filter(x => x.exp > 0 && x.deficit > 0)
  .sort((a,b)=> b.deficit - a.deficit || (b.exp - b.done) - (a.exp - a.done))
  .slice(0, 5);

  const fmtLagging = lagging.length ? lagging.map(x=>`
    <div class="item">
      <div class="meta">
        <div class="name">${escapeHtml(x.name)}</div>
        <div class="sub">Faltan <b>${x.deficit}</b> · Hechas ${x.done}/${x.exp} (hasta hoy) · Zona: ${escapeHtml(x.zone||"General")}</div>
      </div>
    </div>
  `).join("") : `<div class="small">Nada crítico por ahora ✅ (o ya van al día).</div>`;

  $("#main").innerHTML = `
    <section class="card">
      <div class="h1">Resumen</div>
      <div class="small">Semana: ${escapeHtml(ctx.wk)} · Recompensa familiar: ${escapeHtml(state.config.rewards.family_weekly_reward)}</div>
    </section>

    <section class="card">
      <div class="h1">Hoy (${escapeHtml(ctx.dk)})</div>
      <div class="small">Cocina cerrada hoy: <b>${kitchenClosed ? "Sí ✅" : "No aún"}</b></div>
      <div class="small" style="margin-top:6px">Cumplimiento por responsable (hoy):</div>
      <div class="list">${fmtRespToday}</div>
      <div class="small" style="margin-top:10px">Aporte real (quién lo marcó):</div>
      <div class="list">${fmtRows(todayAgg)}</div>
    </section>

    <section class="card">
      <div class="h1">Semana (${escapeHtml(ctx.wk)})</div>
      <div class="small">Cumplimiento por responsable (expected vs done):</div>
      <div class="list">${fmtRespWeek}</div>

      <div class="small" style="margin-top:10px">Tareas que se rezagan (hasta hoy):</div>
      <div class="list">${fmtLagging}</div>

      <div class="small" style="margin-top:10px">Aporte real (quién lo marcó):</div>
      <div class="list">${fmtRows(weekAgg)}</div>

      <div class="small">Aquí luego metemos: sugerencias automáticas de balance (solo sugerir, no imponer).</div>
    </section>
  `;
}

/** ---------- Pantalla: Asignaciones ---------- */
function renderAssignments(){
  const tasks = (state.config.tasks || [])
    .filter(t => !t.only_on_express) // no mostramos las express-only para evitar confusiones
    .slice()
    .sort((a,b)=> (a.zone||"").localeCompare(b.zone||"") || (a.name||"").localeCompare(b.name||""));

  const peopleOpts = [
    `<option value="">(Familia / sin asignar)</option>`,
    ...state.config.people.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`)
  ].join("");

  const freqLabel = (t)=>{
    if(t.frequency==="daily") return "Diaria";
    if(t.frequency==="weekly") return "Semanal (1 vez)";
    if(t.frequency==="weekly_days") return `Semanal (días: ${(t.days||[]).join(", ")||"—"})`;
    if(t.frequency==="weekly_times") return `Semanal (veces: ${t.times_per_week||0})`;
    return t.frequency || "—";
  };

  const rows = tasks.map(t=>`
    <div class="item">
      <div class="meta">
        <div class="name">${escapeHtml(t.name)}</div>
        <div class="sub">
          Zona: <b>${escapeHtml(t.zone||"General")}</b> ·
          Responsable: <b>${escapeHtml(t.assigned_to ? getPersonLabel(t.assigned_to) : "Familia")}</b> ·
          Frecuencia: <b>${escapeHtml(freqLabel(t))}</b> ·
          ${t.points||0} pts · ~${t.minutes||0} min
        </div>
      </div>
      <div class="right">
        <button class="btn" data-action="editTask" data-task="${escapeHtml(t.id)}">Editar</button>
      </div>
    </div>
  `).join("");

  $("#main").innerHTML = `
    <section class="card">
      <div class="h1">Panel de Asignaciones</div>
      <div class="small">
        Aquí defines tareas recurrentes (quién, frecuencia y días). Se guarda en esta compu (localStorage) y también en tu Backup.
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" data-action="newTask">➕ Nueva tarea</button>
        <button class="btn" data-action="resetAssignments">↩ Restaurar a config.json</button>
      </div>
    </section>

    <section class="card">
      <div class="h1">Tareas</div>
      <div class="list">${rows || `<div class="small">No hay tareas aún.</div>`}</div>
    </section>
  `;
}

/** ---------- Pantalla: Ajustes ---------- */
function renderSettings(){
  const peopleButtons = state.config.people.map(p=>`
    <button class="btn primary" data-action="pickUser" data-user="${escapeHtml(p.id)}">👤 ${escapeHtml(p.label)}</button>
  `).join("");

  $("#main").innerHTML = `
    <section class="card">
      <div class="h1">Ajustes</div>
      <div class="small">Sin notificaciones. 1 compu. Todo se guarda en este navegador.</div>
      <div class="row" style="margin-top:10px">
        ${peopleButtons}
      </div>
      <hr style="border:0;height:1px;background:rgba(255,255,255,.10);margin:12px 0;" />
      <div class="row">
        <button class="btn" id="btnImport">📥 Importar backup</button>
        <input id="fileImport" type="file" accept="application/json" style="display:none" />
      </div>
      <div class="small" style="margin-top:10px">
        Tip: Haz backup antes de “manosear” config o si Windows decide reiniciar 😄
      </div>
    </section>
  `;
}

/** ---------- Render principal ---------- */
function render(){
  renderTabs();
  renderHeaderUser();

  const hint = $("#footerHint");
  hint.textContent = "Regla de oro: estable > perfecto. Si hoy cierran cocina, ya ganaron.";

  const route = state.prefs.route;
  if(route === "today") return renderToday();
  if(route === "week") return renderWeekPlan();
  if(route === "summary") return renderSummary();
  if(route === "assignments") return renderAssignments();
  if(route === "settings") return renderSettings();
  return renderToday();
}
function openTaskEditor(task){
  const isNew = !task;
  const t = task ? { ...task } : {
    id: "",
    name: "",
    zone: "General",
    frequency: "weekly_days",
    days: ["mon","wed","fri"],
    times_per_week: 2,
    assigned_to: "",
    points: 1,
    minutes: 10
  };

  const zones = (state.config.zones || []).map(z=>`<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");
  const people = [
    `<option value="">(Familia / sin asignar)</option>`,
    ...state.config.people.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`)
  ].join("");

  const DOW = [
    ["mon","Lun"],["tue","Mar"],["wed","Mié"],["thu","Jue"],["fri","Vie"],["sat","Sáb"],["sun","Dom"]
  ];

  const dayChecks = DOW.map(([id,lab])=>{
    const checked = (t.days||[]).includes(id) ? "checked" : "";
    return `<label style="margin-right:10px"><input type="checkbox" data-day="${id}" ${checked}/> ${lab}</label>`;
  }).join("");

  openModal({
    title: isNew ? "Nueva tarea" : "Editar tarea",
    bodyHtml: `
      <div class="field">
        <label>Nombre</label>
        <input id="tName" value="${escapeHtml(t.name||"")}" placeholder="Ej: Sacar basura"/>
      </div>

      <div class="row">
        <div class="field" style="min-width:220px">
          <label>Zona</label>
          <select id="tZone">${zones}</select>
        </div>
        <div class="field" style="min-width:220px">
          <label>Responsable</label>
          <select id="tAssigned">${people}</select>
        </div>
      </div>

      <div class="row">
        <div class="field" style="min-width:220px">
          <label>Frecuencia</label>
          <select id="tFreq">
            <option value="daily">Diaria</option>
            <option value="weekly">Semanal (1 vez)</option>
            <option value="weekly_days">Semanal (días específicos)</option>
            <option value="weekly_times">Semanal (X veces)</option>
          </select>
        </div>
        <div class="field" style="min-width:220px">
          <label>Veces por semana (solo si usas weekly_times)</label>
          <input id="tTimes" type="number" min="0" step="1" value="${Number(t.times_per_week||0)}"/>
        </div>
      </div>

      <div class="field">
        <label>Días (solo si usas weekly_days)</label>
        <div>${dayChecks}</div>
      </div>

      <div class="row">
        <div class="field" style="min-width:220px">
          <label>Puntos</label>
          <input id="tPoints" type="number" min="0" step="1" value="${Number(t.points||0)}"/>
        </div>
        <div class="field" style="min-width:220px">
          <label>Minutos (estimado)</label>
          <input id="tMinutes" type="number" min="0" step="1" value="${Number(t.minutes||0)}"/>
        </div>
      </div>

      ${!isNew ? `<div class="small">ID: <code>${escapeHtml(t.id)}</code></div>` : `<div class="small">El ID se generará automáticamente.</div>`}
    `,
    actionsHtml: `
      <button class="btn primary" data-action="saveTask" data-task="${escapeHtml(t.id||"")}">${isNew ? "Crear" : "Guardar"}</button>
      ${!isNew ? `<button class="btn" data-action="deleteTask" data-task="${escapeHtml(t.id)}">Eliminar</button>` : ""}
      <button class="btn" data-close="1">Cancelar</button>
    `
  });

  // set selects after modal is in DOM
  $("#tZone").value = t.zone || "General";
  $("#tAssigned").value = t.assigned_to || "";
  $("#tFreq").value = t.frequency || "weekly_days";
}

/** ---------- Eventos ---------- */
function wireEvents(){
  // Tabs (delegación: funciona aunque se creen/muevan botones)
  document.querySelector(".topNav")?.addEventListener("click", (e)=>{
    // Toggle acordeón
    const toggle = e.target.closest("#btnTabsToggle");
    if(toggle){
      document.querySelector(".topNav")?.classList.toggle("tabs-open");
      return;
    }

    // Click en un tab real
    const tab = e.target.closest('.tab[data-route]');
    if(!tab) return;

    setRoute(tab.dataset.route);

    // En móvil: cerrar acordeón al elegir
    document.querySelector(".topNav")?.classList.remove("tabs-open");
  });

  // Timer Dock
  $("#btnTimerPause")?.addEventListener("click", ()=> toggleTimerPause());
  $("#btnTimerStop")?.addEventListener("click", ()=> stopTimer());

  // Botón usuario
  $("#btnUser")?.addEventListener("click", ()=>{
    const btns = state.config.people.map(p=>`
      <button class="btn primary" data-action="pickUser" data-user="${escapeHtml(p.id)}">👤 ${escapeHtml(p.label)}</button>
    `).join("");

    openModal({
      title: "¿Quién está jugando ahora?",
      bodyHtml: `<div class="row">${btns}</div><div class="small" style="margin-top:10px">Tip: Si marcan algo y se equivocan, usa “Undo”.</div>`,
      actionsHtml: `<button class="btn" data-close="1">Cerrar</button>`
    });
  });

  // Modo Express (toggle)
  $("#btnExpress")?.addEventListener("click", ()=>{
    state.prefs.expressEnabled = !state.prefs.expressEnabled;
    setPrefs(state.prefs);
    toast(state.prefs.expressEnabled ? "⚡ Express ON" : "⚡ Express OFF");
    renderHeaderUser();
    render();
  });

  // Backup
  $("#btnBackup")?.addEventListener("click", ()=>{
    exportBackup(state.config);
    toast("💾 Backup exportado");
  });

  // Delegación de clicks en main
  $("#main").addEventListener("click", async (e)=>{
    const el = e.target.closest("[data-action]");
    if(!el) return;

    const action = el.dataset.action;

    if(action === "setPersonTab"){
      const userId = el.dataset.user;
      setCurrentUser(userId);
      return;
    }

    // ✅ Timer: iniciar
    if(action === "timerStart"){
      const taskId = el.dataset.task;
      startTaskTimer(taskId);
      return;
    }

    // ✅ Timer: marcar hecha desde el modal “¡Tiempo!”
    if(action === "timerMarkDone"){
      const taskId = el.dataset.task;
      const task = state.config.tasks.find(t=>t.id===taskId);
      if(!task) return;

      if(!state.prefs.currentUserId){
        toast("Primero elige usuario 👤");
        return;
      }

      const ctx = nowContext();
      if(isDoneToday(task, ctx)){
        toast("Ya estaba ✅");
        closeModal();
        return;
      }

      await markDone(task);
      closeModal();
      return;
    }

    if(action === "toggle"){
      const taskId = el.dataset.task;
      const task = state.config.tasks.find(t=>t.id===taskId);
      if(!task) return;

      if(!state.prefs.currentUserId){
        toast("Primero elige usuario 👤");
        return;
      }

      // Si ya está hecho, no volver a marcar (por ahora)
      const ctx = nowContext();
      if(isDoneToday(task, ctx)){
        toast("Ya estaba ✅ (usa Undo si fue error)");
        return;
      }

      await markDone(task);
      return;
    }

    if(action === "undo"){
      const taskId = el.dataset.task;
      await undoLastForTask(taskId);
      return;
    }

    if(action === "pickUser"){
      const userId = el.dataset.user;
      setCurrentUser(userId);
      closeModal();
      return;
    }

    if(action === "editTask"){
      const taskId = el.dataset.task;
      const task = state.config.tasks.find(t=>t.id===taskId);
      if(!task) return;
      openTaskEditor(task);
      return;
    }

    if(action === "newTask"){
      openTaskEditor(null);
      return;
    }

    if(action === "resetAssignments"){
      clearConfigOverride();
      toast("↩ Restaurado a config.json");
      // recarga rápida del config base
      state.prefs.route = "today";
      setPrefs(state.prefs);
      location.reload();
      return;
    }

  });

  wireModalClose();

  // Guardar / Eliminar tarea desde el modal
  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-action='saveTask'], [data-action='deleteTask']");
    if(!btn) return;

    const action = btn.dataset.action;

    if(action === "saveTask"){
      const name = ($("#tName")?.value || "").trim();
      if(!name){
        toast("Pon un nombre para la tarea");
        return;
      }

      const zone = $("#tZone")?.value || "General";
      const assigned = $("#tAssigned")?.value || "";
      const freq = $("#tFreq")?.value || "weekly_days";
      const points = Number($("#tPoints")?.value || 0);
      const minutes = Number($("#tMinutes")?.value || 0);
      const times = Number($("#tTimes")?.value || 0);

      const days = Array.from(document.querySelectorAll("[data-day]"))
        .filter(ch => ch.checked)
        .map(ch => ch.getAttribute("data-day"));

      // Si es edición, usa ID existente; si es nueva, lo generamos
      let id = btn.dataset.task || "";
      const isNew = !id;

      const slug = (s)=> s
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
        .replace(/[^a-z0-9]+/g,"_")
        .replace(/^_+|_+$/g,"")
        .slice(0,40);

      if(isNew){
        id = `${slug(zone)}_${slug(name)}` || `t_${Date.now()}`;
        // asegurar único
        let base = id, n = 2;
        while(state.config.tasks.some(t=>t.id===id)){
          id = `${base}_${n++}`;
        }
      }

      const existingIndex = state.config.tasks.findIndex(t=>t.id===id);
      const baseTask = existingIndex >= 0 ? state.config.tasks[existingIndex] : {};

      const updated = {
        ...baseTask,
        id,
        name,
        zone,
        assigned_to: assigned || "",
        frequency: freq,
        points,
        minutes
      };

      if(freq === "weekly_days"){
        updated.days = days.length ? days : ["mon"];
        delete updated.times_per_week;
      }else if(freq === "weekly_times"){
        updated.times_per_week = Math.max(0, Math.floor(times));
        delete updated.days;
      }else{
        // daily / weekly
        delete updated.days;
        delete updated.times_per_week;
      }

      // Insert/replace
      if(existingIndex >= 0) state.config.tasks[existingIndex] = updated;
      else state.config.tasks.push(updated);

      // Persistir config editable
      setConfigOverride(state.config);

      toast(isNew ? "✅ Tarea creada" : "✅ Cambios guardados");
      closeModal();
      render(); // refresca la vista actual
      return;
    }

    if(action === "deleteTask"){
      const id = btn.dataset.task;
      const idx = state.config.tasks.findIndex(t=>t.id===id);
      if(idx < 0) return;

      state.config.tasks.splice(idx, 1);
      setConfigOverride(state.config);

      toast("🗑️ Tarea eliminada");
      closeModal();
      render();
      return;
    }
  }, true);

  // Import en Ajustes (se “inyecta” cuando entras a Settings)
  document.addEventListener("click", (e)=>{
    const importBtn = e.target?.id === "btnImport";
    if(importBtn){
      $("#fileImport").click();
    }
  });

  document.addEventListener("change", async (e)=>{
    if(e.target?.id === "fileImport"){
      const file = e.target.files?.[0];
      if(!file) return;
      try{
        await importBackupFromFile(file);
        toast("📥 Backup importado ✅");
        render();
      }catch(err){
        toast("❌ No se pudo importar");
        console.error(err);
      }
      e.target.value = "";
    }
  });
}

/** ---------- Arranque ---------- */
async function boot(){
  // Cargar config
  const res = await fetch("./config.json");
  state.config = await res.json();
   // ✅ Si existe un config editable guardado en este navegador, úsalo
  const override = getConfigOverride();
  if(override){
    state.config = {
      ...state.config,
      ...override,
      tasks: override.tasks || state.config.tasks,
      people: override.people || state.config.people,
      rewards: override.rewards || state.config.rewards,
      zones: override.zones || state.config.zones
    };
  }

  // Prefs
  state.prefs = getPrefs();

  try{
    const cloudApi = window.CQCloud;
    if(cloudApi && cloudApi.isEnabled(state.config.cloud)){
      await cloudApi.init(state.config.cloud, (logs)=>{
        state.cloudLogs = Array.isArray(logs) ? logs : [];
        render();
      });
      state.cloudEnabled = true;
    }else{
      state.cloudEnabled = false;
    }
  }catch(err){
    state.cloudEnabled = false;
    state.cloudLogs = null;
    console.error(err);
  }

  // default user: si no hay, usa Papá (puedes cambiarlo)
  if(!state.prefs.currentUserId){
    state.prefs.currentUserId = "papa";
    setPrefs(state.prefs);
  }

  // ✅ Restaurar timer si había uno corriendo (o pausado) antes de recargar
  restoreTimerIfAny();

  renderHeaderUser();
  wireEvents();
  render();
}

boot();

