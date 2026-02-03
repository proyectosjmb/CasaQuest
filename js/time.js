/**
 * time.js — utilidades de fecha/hora
 * - dateKey en zona horaria CDMX
 * - dowKey (mon/tue/...)
 * - weekKey (semana inicia lunes)
 */

export function dateKey(date, timeZone){
  // "en-CA" da YYYY-MM-DD
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year:"numeric", month:"2-digit", day:"2-digit"
  });
  return fmt.format(date);
}

export function dowKey(date, timeZone){
  // "en-US" -> Mon/Tue/... (lo pasamos a mon/tue)
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday:"short" });
  return fmt.format(date).toLowerCase().slice(0,3);
}

export function weekKey(date, timeZone){
  // Calcula el lunes de la semana y genera "YYYY-Www"
  const dk = dateKey(date, timeZone);
  const [yy,mm,dd] = dk.split("-").map(Number);

  // usamos mediodía UTC para evitar DST raros
  const localNoon = new Date(Date.UTC(yy, mm-1, dd, 12, 0, 0));

  const idx = ["mon","tue","wed","thu","fri","sat","sun"].indexOf(dowKey(date, timeZone));
  const start = new Date(localNoon.getTime() - idx * 86400000); // lunes

  const startYear = Number(dateKey(start, timeZone).slice(0,4));
  const jan1 = new Date(Date.UTC(startYear, 0, 1, 12, 0, 0));
  const jan1Idx = ["mon","tue","wed","thu","fri","sat","sun"].indexOf(dowKey(jan1, timeZone));

  const firstMonday = new Date(jan1.getTime() - jan1Idx * 86400000);
  const diffDays = Math.floor((start.getTime() - firstMonday.getTime()) / 86400000);
  const w = Math.floor(diffDays / 7) + 1;

  const ww = String(w).padStart(2, "0");
  return `${startYear}-W${ww}`;
}
