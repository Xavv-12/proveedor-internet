"use strict";
const { col } = require("./db");

/** Crea los índices necesarios. Es seguro ejecutarlo varias veces. */
async function crearIndices() {
  const c = (n) => col(n);
  await Promise.all([
    c("usuarios").createIndex({ correo: 1 }, { unique: true }),
    c("restablecimientos").createIndex({ hash: 1 }, { unique: true }),
    c("restablecimientos").createIndex(
      { expira: 1 },
      { expireAfterSeconds: 3600 },
    ),
    c("limites").createIndex({ clave: 1, fecha: 1 }),
    c("limites").createIndex({ expira: 1 }, { expireAfterSeconds: 0 }),
    c("auditoria").createIndex({ fecha: -1 }),
    c("auditoria").createIndex({ accion: 1, fecha: -1 }),
    c("solicitudes").createIndex({ folio: 1 }, { unique: true }),
    c("solicitudes").createIndex({ estado: 1, creado: -1 }),
    c("solicitudes").createIndex({ creado: -1 }),
    c("planes").createIndex({ clave: 1 }, { unique: true }),
    c("promociones").createIndex({ activo: 1, publicada: 1 }),
    c("cobertura").createIndex({ codigoPostal: 1 }),
    c("cobertura").createIndex({ coloniaNormal: 1 }),
    c("clientes").createIndex({ telefono: 1 }),
    c("clientes").createIndex({ activo: 1, _id: -1 }),
    // Una solicitud solo puede convertirse en UN cliente (evita duplicados)
    c("clientes").createIndex(
      { solicitudId: 1 },
      {
        unique: true,
        partialFilterExpression: { solicitudId: { $type: "objectId" } },
      },
    ),
    c("contratos").createIndex({ folio: 1 }, { unique: true }),
    c("contratos").createIndex({ clienteId: 1 }),
    c("contratos").createIndex({ estado: 1 }),
    c("equipos").createIndex({ numeroSerie: 1 }, { unique: true }),
    c("equipos").createIndex({ contratoId: 1 }),
    c("incidencias").createIndex({ folio: 1 }, { unique: true }),
    c("incidencias").createIndex({ estado: 1, creada: -1 }),
    c("incidencias").createIndex({ contratoId: 1 }),
    c("incidencias_historial").createIndex({ incidenciaId: 1, fecha: 1 }),
    c("evidencias").createIndex({ incidenciaId: 1 }),
    c("visitas").createIndex({ fecha: 1 }),
    c("visitas").createIndex({ incidenciaId: 1 }),
    c("visitas").createIndex({ solicitudId: 1 }),
    c("solicitudes_historial").createIndex({ solicitudId: 1, fecha: -1 }),
    c("solicitudes").createIndex({ proximoSeguimiento: 1 }),
    c("tecnicos").createIndex({ usuarioId: 1 }),
    c("mensualidades").createIndex(
      { contratoId: 1, periodo: 1 },
      { unique: true },
    ),
    c("mensualidades").createIndex({ estado: 1, fechaLimite: 1 }),
    c("pagos").createIndex({ referencia: 1 }, { unique: true }),
    c("pagos").createIndex({ mensualidadId: 1 }),
    c("pagos").createIndex({ estado: 1, registrado: -1 }),
    c("movimientos_bancarios").createIndex({ huella: 1 }, { unique: true }),
    c("movimientos_bancarios").createIndex({ importacionId: 1 }),
    c("movimientos_bancarios").createIndex({ estado: 1, fecha: -1 }),
    c("importaciones").createIndex({ creado: -1 }),
    c("mensajes").createIndex({ tipo: 1, activo: 1 }),
    c("whatsapp_envios").createIndex({ telefono: 1, fecha: -1 }),
    c("whatsapp_envios").createIndex({ mensajeId: 1 }),
    c("whatsapp_entrantes").createIndex({ waId: 1 }, { unique: true }),
    c("tareas_ejecuciones").createIndex({ tarea: 1, inicio: -1 }),
    // Portal del cliente
    c("comprobantes").createIndex({ estado: 1, creado: 1 }),
    c("comprobantes").createIndex({ contratoId: 1, creado: -1 }),
    c("comprobantes").createIndex({ mensualidadId: 1 }),
    c("comprobantes").createIndex({ referencia: 1 }),
    c("portal_sesiones").createIndex({ hash: 1 }, { unique: true }),
    c("portal_sesiones").createIndex({ limite: 1 }, { expireAfterSeconds: 0 }),
    c("portal_tickets").createIndex({ hash: 1 }, { unique: true }),
    c("portal_tickets").createIndex({ expira: 1 }, { expireAfterSeconds: 0 }),
    c("whatsapp_chat").createIndex({ telefono: 1, fecha: -1 }),
    c("whatsapp_conversaciones").createIndex({ estado: 1, actualizado: -1 }),
  ]);
}

module.exports = { crearIndices };
