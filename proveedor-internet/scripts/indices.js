'use strict';
// Crea o actualiza los índices de MongoDB. La aplicación también lo hace al arrancar.
const { obtenerConfig } = require('../src/config');
const { conectar, desconectar } = require('../src/db');
const { crearIndices } = require('../src/indices');

(async () => {
  const cfg = obtenerConfig();
  await conectar(cfg.mongoUri, cfg.mongoDb);
  await crearIndices();
  console.log('Índices listos.');
})().catch((e) => { console.error('Error al crear índices:', e.message); process.exitCode = 1; }).finally(() => desconectar());
