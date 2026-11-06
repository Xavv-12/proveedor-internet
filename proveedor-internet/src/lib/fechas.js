"use strict";
// Las fechas se guardan en UTC y se muestran en hora de la Ciudad de México.
const ZONA = "America/Mexico_City";

const fmtFecha = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const fmtFechaHora = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const fmtMes = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const fmtPartes = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const pad = (n) => String(n).padStart(2, "0");

/** Partes de una fecha vistas en la Ciudad de México. */
function partesMX(fecha = new Date()) {
  const o = {};
  for (const p of fmtPartes.formatToParts(new Date(fecha)))
    if (p.type !== "literal") o[p.type] = Number(p.value);
  return o; // { year, month, day, hour, minute, second }
}

/** Convierte una hora local de la Ciudad de México a un Date en UTC. */
function fechaMXaUTC(anio, mes, dia, h = 0, mi = 0, s = 0) {
  const supuesto = Date.UTC(anio, mes - 1, dia, h, mi, s);
  const desfase = (ms) => {
    const p = partesMX(new Date(ms));
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms
    );
  };
  let r = supuesto - desfase(supuesto);
  const d2 = desfase(r);
  if (supuesto - d2 !== r) r = supuesto - d2;
  return new Date(r);
}

function diasEnMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** "AAAA-MM-DD" (día en CDMX) -> Date UTC al inicio (o fin) de ese día. null si no es válida. */
function textoAFechaMX(texto, finDelDia = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ""));
  if (!m) return null;
  const [a, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (
    a < 2000 ||
    a > 2100 ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > diasEnMes(a, mo)
  )
    return null;
  return finDelDia ? fechaMXaUTC(a, mo, d, 23, 59, 59) : fechaMXaUTC(a, mo, d);
}

function fechaATextoMX(fecha) {
  if (!fecha) return "";
  const p = partesMX(fecha);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function horaATextoMX(fecha) {
  if (!fecha) return "";
  const p = partesMX(fecha);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function hoyTextoMX() {
  return fechaATextoMX(new Date());
}

/** Inicio y fin (exclusivo) de un día de la Ciudad de México. */
function rangoDiaMX(texto = hoyTextoMX()) {
  const inicio = textoAFechaMX(texto);
  if (!inicio) return null;
  const [a, m, d] = texto.split("-").map(Number);
  const sig = new Date(Date.UTC(a, m - 1, d + 1));
  const fin = fechaMXaUTC(
    sig.getUTCFullYear(),
    sig.getUTCMonth() + 1,
    sig.getUTCDate(),
  );
  return { inicio, fin };
}

function formatearFecha(f) {
  return f ? fmtFecha.format(new Date(f)) : "—";
}

function formatearFechaHora(f) {
  return f ? fmtFechaHora.format(new Date(f)) : "—";
}

function formatearUTC(f) {
  return f
    ? `${new Date(f).toISOString().replace("T", " ").slice(0, 19)} UTC`
    : "—";
}

/** "2026-10" -> "octubre de 2026" */
function periodoTexto(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo ?? ""));
  if (!m) return String(periodo ?? "");
  return fmtMes.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)));
}

module.exports = {
  ZONA,
  partesMX,
  fechaMXaUTC,
  diasEnMes,
  textoAFechaMX,
  fechaATextoMX,
  horaATextoMX,
  hoyTextoMX,
  rangoDiaMX,
  formatearFecha,
  formatearFechaHora,
  formatearUTC,
  periodoTexto,
};
