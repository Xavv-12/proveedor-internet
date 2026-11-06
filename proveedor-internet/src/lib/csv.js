'use strict';

function detectarSeparador(texto) {
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const comas = (primera.match(/,/g) || []).length;
  const pyc = (primera.match(/;/g) || []).length;
  return pyc > comas ? ';' : ',';
}

/** Parser CSV con soporte de comillas, comillas escapadas y saltos CRLF. */
function parsearCsv(texto, sep = detectarSeparador(texto)) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"' && campo === '') {
      comillas = true;
    } else if (c === sep) {
      fila.push(campo); campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return { filas, sep };
}

module.exports = { parsearCsv, detectarSeparador };
