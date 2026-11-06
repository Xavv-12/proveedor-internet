'use strict';
const { col } = require('../db');

// Límites de tasa con ventana deslizante, persistidos en MongoDB (sobreviven reinicios
// y se comparten entre instancias). Un índice TTL limpia los eventos viejos.

async function registrarEvento(clave, ventanaMs) {
  const ahora = new Date();
  const { insertedId } = await col('limites').insertOne({ clave, fecha: ahora, expira: new Date(ahora.getTime() + ventanaMs) });
  const total = await contarEventos(clave, ventanaMs);
  return { id: insertedId, total };
}

async function contarEventos(clave, ventanaMs) {
  return col('limites').countDocuments({ clave, fecha: { $gt: new Date(Date.now() - ventanaMs) } });
}

async function quitarEvento(id) {
  await col('limites').deleteOne({ _id: id });
}

module.exports = { registrarEvento, contarEventos, quitarEvento };
