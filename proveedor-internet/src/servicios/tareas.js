'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
const cron = require('node-cron');
const { col } = require('../db');
const { ZONA } = require('../lib/fechas');
const logger = require('../logger');
const { marcarVencidas } = require('./cobranza');
const { enviarRecordatoriosAutomaticos } = require('./recordatorios');

const INSTANCIA = `${os.hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Ejecuta una tarea con bloqueo en MongoDB para que no corra en paralelo
 * (ni en la misma instancia ni en varias). Registra inicio, fin y resultado.
 */
async function ejecutarConBloqueo(nombre, duracionMs, fn) {
  const ahora = new Date();
  try {
    await col('tareas_bloqueos').findOneAndUpdate(
      { _id: nombre, $or: [{ hasta: { $lte: ahora } }, { hasta: { $exists: false } }] },
      { $set: { hasta: new Date(ahora.getTime() + duracionMs), instancia: INSTANCIA, desde: ahora } },
      { upsert: true },
    );
  } catch (e) {
    if (e.code === 11000) {
      logger.info({ tarea: nombre }, 'La tarea ya está en curso; se omite esta ejecución');
      return { omitida: true };
    }
    throw e;
  }
  const { insertedId } = await col('tareas_ejecuciones').insertOne({ tarea: nombre, inicio: ahora, instancia: INSTANCIA, estado: 'en curso' });
  logger.info({ tarea: nombre }, 'Inicio de tarea programada');
  try {
    const resultado = await fn();
    await col('tareas_ejecuciones').updateOne({ _id: insertedId }, { $set: { fin: new Date(), estado: 'correcta', resultado } });
    logger.info({ tarea: nombre, resultado }, 'Fin de tarea programada');
    return { resultado };
  } catch (e) {
    await col('tareas_ejecuciones').updateOne({ _id: insertedId }, { $set: { fin: new Date(), estado: 'error', error: e.message } });
    logger.error({ tarea: nombre, error: e.message }, 'La tarea programada terminó con error');
    return { error: e.message };
  } finally {
    await col('tareas_bloqueos').updateOne({ _id: nombre, instancia: INSTANCIA }, { $set: { hasta: new Date(0) } });
  }
}

const TAREAS = [
  {
    nombre: 'vencimiento-mensualidades',
    horario: '5 0 * * *', // 00:05 todos los días, hora de la Ciudad de México
    duracionMs: 15 * 60 * 1000,
    fn: async () => ({ marcadas: await marcarVencidas() }),
  },
  {
    nombre: 'recordatorios-cobro',
    horario: '0 10 * * *', // 10:00 todos los días, hora de la Ciudad de México
    duracionMs: 60 * 60 * 1000,
    fn: enviarRecordatoriosAutomaticos,
  },
];

function iniciarTareas() {
  const programadas = TAREAS.map((t) => cron.schedule(
    t.horario,
    () => { ejecutarConBloqueo(t.nombre, t.duracionMs, t.fn).catch((e) => logger.error({ tarea: t.nombre, error: e.message }, 'Error en tarea')); },
    { timezone: ZONA },
  ));
  logger.info({ tareas: TAREAS.map((t) => `${t.nombre} (${t.horario})`) }, 'Tareas programadas iniciadas');
  return () => programadas.forEach((p) => p.stop());
}

module.exports = { ejecutarConBloqueo, iniciarTareas, TAREAS };
