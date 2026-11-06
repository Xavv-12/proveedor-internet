'use strict';

/** Quita espacios, guiones, paréntesis, puntos y +52. Devuelve 10 dígitos o null. */
function normalizarTelefono(texto) {
  if (texto === null || texto === undefined) return null;
  let s = String(texto).replace(/[\s\-().]/g, '');
  let teniaLada = false;
  if (s.startsWith('+52')) { s = s.slice(3); teniaLada = true; } else if (s.length >= 12 && s.startsWith('52')) { s = s.slice(2); teniaLada = true; }
  if (teniaLada && s.length === 11 && s.startsWith('1')) s = s.slice(1); // formato antiguo +521
  return /^\d{10}$/.test(s) ? s : null;
}

function formatearTelefono(t) {
  return /^\d{10}$/.test(String(t ?? '')) ? `${t.slice(0, 2)} ${t.slice(2, 6)} ${t.slice(6)}` : (t || '—');
}

module.exports = { normalizarTelefono, formatearTelefono };
