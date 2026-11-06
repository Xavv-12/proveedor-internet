'use strict';
const { col } = require('../db');

const ESTADOS_INCIDENCIA = ['abierta', 'en proceso', 'en espera', 'resuelta', 'cerrada'];
const INCIDENCIA_ABIERTA = ['abierta', 'en proceso', 'en espera'];
const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'];

/** Historial inmutable: solo se insertan entradas. Las correcciones son entradas nuevas. */
async function agregarHistorial(incidenciaId, { tipo, texto, de = null, a = null }, usuario, sesion) {
  await col('incidencias_historial').insertOne({
    incidenciaId,
    fecha: new Date(),
    tipo,
    texto: String(texto || '').slice(0, 2000),
    de,
    a,
    usuarioId: usuario?._id ?? null,
    usuarioNombre: usuario?.nombre ?? 'Sistema',
  }, sesion ? { session: sesion } : undefined);
}

module.exports = { ESTADOS_INCIDENCIA, INCIDENCIA_ABIERTA, PRIORIDADES, agregarHistorial };
