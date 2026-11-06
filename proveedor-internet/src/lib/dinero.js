'use strict';
// Todo el dinero se maneja como enteros en centavos (MXN). Nunca flotantes.

/** "200", "200.5", "$1,200.50" -> centavos (entero). Devuelve null si no es válido. */
function aCentavos(texto) {
  if (texto === null || texto === undefined) return null;
  if (typeof texto === 'number') return Number.isSafeInteger(texto) ? texto * 100 : null;
  const s = String(texto).trim().replace(/[$\s]/g, '');
  const m = /^(\d{1,3}(?:,\d{3})+|\d{1,10})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const pesos = parseInt(m[1].replace(/,/g, ''), 10);
  const centavos = parseInt((m[2] || '0').padEnd(2, '0'), 10);
  const total = pesos * 100 + centavos;
  return Number.isSafeInteger(total) ? total : null;
}

/** 20000 -> "$200.00" */
function formatear(centavos) {
  if (!Number.isInteger(centavos)) return '—';
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const cent = abs % 100;
  const conComas = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negativo ? '-' : ''}$${conComas}.${String(cent).padStart(2, '0')}`;
}

/** 20000 -> "200.00" (para campos de formulario) */
function centavosATexto(centavos) {
  if (!Number.isInteger(centavos)) return '';
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

module.exports = { aCentavos, formatear, centavosATexto };
