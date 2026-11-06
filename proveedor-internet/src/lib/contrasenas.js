'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const COSTO = 12;
let hashFalso = null;

function cifrar(texto) {
  return bcrypt.hash(texto, COSTO);
}

/** Compara en tiempo similar exista o no el usuario (evita revelar si el correo existe). */
async function comparar(texto, hash) {
  if (!hash) {
    if (!hashFalso) hashFalso = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), COSTO);
    await bcrypt.compare(String(texto), hashFalso);
    return false;
  }
  return bcrypt.compare(String(texto), hash);
}

module.exports = { cifrar, comparar, COSTO };
