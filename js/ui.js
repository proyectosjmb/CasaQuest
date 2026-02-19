/**
 * ui.js — helpers de UI (modal, toast, html)
 */
export const $ = (sel) => document.querySelector(sel);

export function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

export function toast(msg, ms=1400){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove("show"), ms);
}

export function openModal({ title, bodyHtml, actionsHtml }){
  $("#modalTitle").textContent = title || "";
  $("#modalBody").innerHTML = bodyHtml || "";
  $("#modalActions").innerHTML = actionsHtml || "";
  $("#modal").setAttribute("aria-hidden", "false");
}

export function closeModal(){
  $("#modal").setAttribute("aria-hidden", "true");
  $("#modalBody").innerHTML = "";
  $("#modalActions").innerHTML = "";
}

export function wireModalClose(){
  $("#modal").addEventListener("click", (e)=>{
    const close = e.target?.dataset?.close;
    if(close) closeModal();
  });
}
