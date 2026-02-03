/**
 * app.js — CasaQuest v0.1
 * Pantallas:
 * - Hoy: tareas “debidas hoy” + 1 toque para marcar
 * - Resumen: % cumplimiento y puntos por persona
 * - Asignaciones: lista de tareas y quién las tiene
 * - Ajustes: cambiar usuario + importar/exportar backup
 */

import { getLogs, addLog, removeLastLog, getPrefs, setPrefs, exportBackup, importBackupFromFile } from "./storage.js";
import { dateKey, dowKey, weekKey } from "./time.js";
import { $, escapeHtml, toast, openModal, closeModal, wireModalClose } from "./ui.js";

const state = {
  config: null,
  prefs: null
};

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

/** Regla MVP: decide si una tarea “toca hoy” */
function isTaskDueToday(task, ctx){
  if(task.frequency === "daily") return true;
  if(task.frequency === "weekly_days"){
    return (task.days || []).includes(ctx.dow);
  }
  return false; // (en v0.2 metemos weekly / weekly_times)
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

function markDone(task){
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
  addLog(log);
  toast(`✅ Hecho: ${task.name}`);
  render();
}

function undoLastForTask(taskId){
  removeLastLog(l => l.taskId === taskId);
  toast("↩️ Deshecho");
  render();
}

/** ---------- Render: Header ---------- */
function renderHeaderUser(){
  const btn = $("#btnUser");
  const id = state.prefs.currentUserId;
  btn.textContent = id ? `👤 ${getPersonLabel(id)}` : "👤 Elegir usuario";
}

function renderTabs(){
  const route = state.prefs.route;
  document.querySelectorAll(".tab").forEach(b=>{
    const r = b.dataset.route;
    b.setAttribute("aria-current", r === route ? "page" : "false");
  });
}

/** ---------- Pantalla: Hoy ---------- */
function renderToday(){
  const ctx = nowContext();
  const tasks = state.config.tasks
    .filter(t => isTaskDueToday(t, ctx))
    .sort((a,b)=> (a.zone||"").localeCompare(b.zone||""));

  // Agrupar por zona
  const byZone = new Map();
  for(const t of tasks){
    const z = t.zone || "General";
    if(!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(t);
  }

  const pieces = [];
  pieces.push(`
    <section class="card">
      <div class="h1">Hoy · ${ctx.dk}</div>
      <div class="small">Tip: cena 9:00–9:30pm. Meta: “tarja usable” y mini orden, no perfección.</div>
    </section>
  `);

  for(const [zone, arr] of byZone.entries()){
    const list = arr.map(t=>{
      const done = isDoneToday(t, ctx);
      const assigned = t.assigned_to ? `Asignado: <b>${escapeHtml(getPersonLabel(t.assigned_to))}</b>` : "Sin asignar";
      const whoDid = done ? logsForTaskOnDate(t.id, ctx.dk).at(-1)?.userId : null;
      const whoLine = done && whoDid ? ` · Hecho por <b>${escapeHtml(getPersonLabel(whoDid))}</b>` : "";
      const notes = t.notes ? `<div class="sub">${escapeHtml(t.notes)}</div>` : "";
      const sub = `<div class="sub">${assigned}${whoLine} · ${t.points||0} pts · ~${t.minutes||0} min</div>`;

      return `
        <div class="item ${done ? "done":""}">
          <div class="check" data-action="toggle" data-task="${escapeHtml(t.id)}">${done ? "✓" : ""}</div>
          <div class="meta">
            <div class="name">${escapeHtml(t.name)}</div>
            ${sub}
            ${notes}
          </div>
          <div class="right">
            ${done ? `<button class="btn" data-action="undo" data-task="${escapeHtml(t.id)}">Undo</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    pieces.push(`
      <section class="card">
        <div class="h1">${escapeHtml(zone)}</div>
        <div class="list">${list || `<div class="small">Sin tareas aquí hoy.</div>`}</div>
      </section>
    `);
  }

  $("#main").innerHTML = pieces.join("");
}

/** ---------- Pantalla: Resumen ---------- */
function renderSummary(){
  const ctx = nowContext();
  const logs = getLogs();
  const todayLogs = logs.filter(l => l.dateKey === ctx.dk);
  const weekLogs  = logs.filter(l => l.weekKey === ctx.wk);

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

  // KPI simple: “cocina cerrada” (3 tareas hechas ese día)
  const requiredKitchen = ["cocina_zona_agua", "cocina_superficies", "cocina_guardar"];
  const kitchenClosed = requiredKitchen.every(id => todayLogs.some(l=>l.taskId===id));

  $("#main").innerHTML = `
    <section class="card">
      <div class="h1">Resumen</div>
      <div class="small">Semana: ${escapeHtml(ctx.wk)} · Recompensa familiar: ${escapeHtml(state.config.rewards.family_weekly_reward)}</div>
    </section>

    <section class="card">
      <div class="h1">Hoy (${escapeHtml(ctx.dk)})</div>
      <div class="small">Cocina cerrada hoy: <b>${kitchenClosed ? "Sí ✅" : "No aún"}</b></div>
      <div class="list">${fmtRows(todayAgg)}</div>
    </section>

    <section class="card">
      <div class="h1">Semana (${escapeHtml(ctx.wk)})</div>
      <div class="list">${fmtRows(weekAgg)}</div>
      <div class="small">Aquí luego metemos: % cumplimiento y “tareas que siempre fallan”.</div>
    </section>
  `;
}

/** ---------- Pantalla: Asignaciones ---------- */
function renderAssignments(){
  const tasks = state.config.tasks.slice().sort((a,b)=>(a.zone||"").localeCompare(b.zone||""));
  const rows = tasks.map(t=>`
    <div class="item">
      <div class="meta">
        <div class="name">${escapeHtml(t.name)}</div>
        <div class="sub">
          Zona: <b>${escapeHtml(t.zone||"General")}</b> ·
          Frecuencia: <b>${escapeHtml(t.frequency)}</b> ·
          Asignado: <b>${escapeHtml(getPersonLabel(t.assigned_to))}</b> ·
          ${t.points||0} pts · ~${t.minutes||0} min
        </div>
      </div>
    </div>
  `).join("");

  $("#main").innerHTML = `
    <section class="card">
      <div class="h1">Asignaciones (solo lectura)</div>
      <div class="small">En v0.2 haremos “sugerencias” de ajuste, sin cambios automáticos.</div>
    </section>
    <section class="card">
      <div class="list">${rows}</div>
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
  if(route === "summary") return renderSummary();
  if(route === "assignments") return renderAssignments();
  if(route === "settings") return renderSettings();
  return renderToday();
}

/** ---------- Eventos ---------- */
function wireEvents(){
  // Tabs
  document.querySelectorAll(".tab").forEach(b=>{
    b.addEventListener("click", ()=> setRoute(b.dataset.route));
  });

  // Botón usuario
  $("#btnUser").addEventListener("click", ()=>{
    const btns = state.config.people.map(p=>`
      <button class="btn primary" data-action="pickUser" data-user="${escapeHtml(p.id)}">👤 ${escapeHtml(p.label)}</button>
    `).join("");

    openModal({
      title: "¿Quién está jugando ahora?",
      bodyHtml: `<div class="row">${btns}</div><div class="small" style="margin-top:10px">Tip: Si marcan algo y se equivocan, usa “Undo”.</div>`,
      actionsHtml: `<button class="btn" data-close="1">Cerrar</button>`
    });
  });

  // Backup
  $("#btnBackup").addEventListener("click", ()=>{
    exportBackup(state.config);
    toast("💾 Backup exportado");
  });

  // Delegación de clicks en main
  $("#main").addEventListener("click", async (e)=>{
    const el = e.target.closest("[data-action]");
    if(!el) return;

    const action = el.dataset.action;

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

      markDone(task);
      return;
    }

    if(action === "undo"){
      const taskId = el.dataset.task;
      undoLastForTask(taskId);
      return;
    }

    if(action === "pickUser"){
      const userId = el.dataset.user;
      setCurrentUser(userId);
      closeModal();
      return;
    }
  });

  wireModalClose();

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

  // Prefs
  state.prefs = getPrefs();

  // default user: si no hay, usa Papá (puedes cambiarlo)
  if(!state.prefs.currentUserId){
    state.prefs.currentUserId = "papa";
    setPrefs(state.prefs);
  }

  renderHeaderUser();
  wireEvents();
  render();
}

boot();
