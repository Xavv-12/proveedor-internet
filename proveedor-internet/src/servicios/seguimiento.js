"use strict";
/**
 * SEGUIMIENTO COMERCIAL DE SOLICITUDES
 * Recibida → Contactada → Cobertura validada → Agendada (instalación) → Contratada
 *                                                  ↘ Descartada (con motivo)
 * Cada paso queda en el historial de la solicitud (quién, cuándo y qué pasó).
 * Algunos pasos son automáticos:
 *  - Al agendar la instalación se crea la visita del técnico y la solicitud pasa a "agendada".
 *  - Al crear el contrato del cliente que vino de la solicitud, pasa a "contratada".
 *  - El tablero avisa de solicitudes sin contactar en 24 h, seguimientos de hoy e instalaciones.
 */
const { col } = require("../db");
const { emitir } = require("../lib/eventos");
const { rangoDiaMX } = require("../lib/fechas");

const HORAS_SIN_CONTACTO = 24; // tiempo máximo recomendado para el primer contacto
const CERRADAS = ["contratada", "descartada"];

const RESULTADOS_CONTACTO = [
  { valor: "interesado", texto: "Contactado: le interesa continuar" },
  { valor: "llamar_despues", texto: "Contactado: pidió que le llamen después" },
  { valor: "no_contesto", texto: "No contestó / no respondió el mensaje" },
  { valor: "no_interesado", texto: "Contactado: ya no le interesa" },
];

const MOTIVOS_DESCARTE = [
  "Sin cobertura en su domicilio",
  "Ya no le interesa",
  "Precio",
  "Se fue con otro proveedor",
  "No contesta (varios intentos)",
  "Datos falsos o solicitud duplicada",
  "Otro",
];

const ETIQUETA_TIPO = {
  alta: "Recibida",
  contacto: "Contacto",
  cobertura: "Cobertura",
  instalacion: "Instalación",
  estado: "Estado",
  responsable: "Responsable",
  cliente: "Cliente",
  contrato: "Contrato",
  descarte: "Descartada",
  nota: "Nota",
};

/** Guarda un paso en el historial de la solicitud. */
async function registrarHistorial(
  solicitudId,
  { tipo, texto, de = null, a = null },
  usuario = null,
  sesion,
) {
  await col("solicitudes_historial").insertOne(
    {
      solicitudId,
      tipo,
      texto: String(texto || "").slice(0, 1000),
      de,
      a,
      fecha: new Date(),
      usuarioId: usuario?._id ?? null,
      usuarioNombre: usuario?.nombre || usuario?.correo || "Sistema",
    },
    sesion ? { session: sesion } : undefined,
  );
}

/**
 * Cambia el estado y deja constancia. Devuelve la solicitud ya actualizada.
 * extra: otros campos a guardar en el mismo paso.
 */
async function cambiarEstado(
  sol,
  nuevo,
  { usuario = null, texto = "", tipo = "estado", extra = {}, sesion } = {},
) {
  const set = { ...extra, actualizado: new Date() };
  if (nuevo && nuevo !== sol.estado) set.estado = nuevo;
  await col("solicitudes").updateOne(
    { _id: sol._id },
    { $set: set },
    sesion ? { session: sesion } : undefined,
  );
  await registrarHistorial(
    sol._id,
    {
      tipo,
      texto,
      de: set.estado ? sol.estado : null,
      a: set.estado || null,
    },
    usuario,
    sesion,
  );
  emitir("solicitudes");
  return { ...sol, ...set };
}

/** Si la solicitud aún no tiene responsable, se le asigna a quien la atiende. */
async function asignarSiFalta(sol, usuario) {
  if (sol.responsableId || !usuario) return;
  await col("solicitudes").updateOne(
    { _id: sol._id, responsableId: { $exists: false } },
    {
      $set: {
        responsableId: usuario._id,
        responsableNombre: usuario.nombre || usuario.correo,
      },
    },
  );
}

/** Al registrar al cliente desde una solicitud. */
async function alRegistrarCliente(solicitudId, cliente, usuario) {
  if (!solicitudId) return;
  await registrarHistorial(
    solicitudId,
    { tipo: "cliente", texto: `Registrado como cliente: ${cliente.nombre}.` },
    usuario,
  );
  emitir("solicitudes");
}

/** Al crear un contrato: si el cliente vino de una solicitud, esta queda "contratada". */
async function alCrearContrato(cliente, contrato, usuario) {
  const solicitudId =
    cliente.solicitudId ||
    (
      await col("solicitudes").findOne(
        { clienteId: cliente._id, estado: { $nin: CERRADAS } },
        { projection: { _id: 1 } },
      )
    )?._id;
  if (!solicitudId) return;
  const sol = await col("solicitudes").findOne({ _id: solicitudId });
  if (!sol || sol.estado === "contratada") return;
  await cambiarEstado(sol, "contratada", {
    usuario,
    tipo: "contrato",
    texto: `Contrato ${contrato.folio} creado (${contrato.planNombre}).`,
    extra: {
      contratoId: contrato._id,
      contratoFolio: contrato.folio,
      contratada: new Date(),
    },
  });
}

/** Números para el tablero y la lista de solicitudes. */
async function resumen() {
  const ahora = new Date();
  const limite = new Date(ahora.getTime() - HORAS_SIN_CONTACTO * 3600e3);
  const { inicio, fin } = rangoDiaMX();
  const abiertas = { estado: { $nin: CERRADAS } };
  const [
    sinContactar,
    seguimientosHoy,
    instalacionesHoy,
    instalacionesAtrasadas,
  ] = await Promise.all([
    col("solicitudes").countDocuments({
      estado: "recibida",
      creado: { $lt: limite },
    }),
    col("solicitudes").countDocuments({
      ...abiertas,
      proximoSeguimiento: { $lt: fin },
    }),
    col("visitas").countDocuments({
      tipo: "instalacion",
      estado: "programada",
      fecha: { $gte: inicio, $lt: fin },
    }),
    col("solicitudes").countDocuments({
      estado: "agendada",
      fechaInstalacion: { $lt: inicio },
    }),
  ]);
  return {
    sinContactar,
    seguimientosHoy,
    instalacionesHoy,
    instalacionesAtrasadas,
  };
}

module.exports = {
  HORAS_SIN_CONTACTO,
  CERRADAS,
  RESULTADOS_CONTACTO,
  MOTIVOS_DESCARTE,
  ETIQUETA_TIPO,
  registrarHistorial,
  cambiarEstado,
  asignarSiFalta,
  alRegistrarCliente,
  alCrearContrato,
  resumen,
};
