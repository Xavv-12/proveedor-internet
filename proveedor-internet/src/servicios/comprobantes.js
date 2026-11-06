"use strict";
const { col } = require("../db");
const { ErrorNegocio } = require("../lib/util");
const { auditar } = require("../lib/auditoria");
const { formatear } = require("../lib/dinero");
const { emitir } = require("../lib/eventos");
const { registrarPago } = require("./cobranza");

/**
 * El personal revisó el comprobante y el dinero sí llegó:
 * se registra el pago ya validado y el comprobante queda aceptado.
 */
async function aceptarComprobante(id, { usuario = null, ip = null } = {}) {
  const c = await col("comprobantes").findOne({ _id: id });
  if (!c) throw new ErrorNegocio("El comprobante no existe.", 404);
  if (c.estado !== "por revisar")
    throw new ErrorNegocio("Ese comprobante ya fue revisado.");
  const { pago } = await registrarPago({
    mensualidadId: c.mensualidadId,
    monto: c.monto,
    metodo: c.metodo,
    referencia: c.referencia,
    usuario,
    ip,
    validar: true,
  });
  await col("comprobantes").updateOne(
    { _id: c._id, estado: "por revisar" },
    {
      $set: {
        estado: "aceptado",
        pagoId: pago._id,
        revisado: new Date(),
        revisadoPor: usuario?._id ?? null,
        revisadoPorNombre: usuario?.nombre ?? null,
      },
    },
  );
  await auditar({
    usuario,
    ip,
    accion: "cobranza.comprobante_aceptado",
    detalle: {
      contrato: c.contratoFolio,
      referencia: c.referencia,
      monto: formatear(c.monto),
    },
  });
  emitir("cobranza");
  emitir("portal", { contratoId: String(c.contratoId) });
  return pago;
}

/** El comprobante no corresponde o no se ve: se rechaza con un motivo que el cliente verá. */
async function rechazarComprobante(
  id,
  motivo,
  { usuario = null, ip = null } = {},
) {
  const texto = String(motivo || "")
    .trim()
    .slice(0, 300);
  if (texto.length < 5)
    throw new ErrorNegocio(
      "Escribe el motivo del rechazo; el cliente lo verá en su portal.",
      422,
    );
  const c = await col("comprobantes").findOneAndUpdate(
    { _id: id, estado: "por revisar" },
    {
      $set: {
        estado: "rechazado",
        motivo: texto,
        revisado: new Date(),
        revisadoPor: usuario?._id ?? null,
        revisadoPorNombre: usuario?.nombre ?? null,
      },
    },
    { returnDocument: "after" },
  );
  if (!c) throw new ErrorNegocio("Ese comprobante ya fue revisado.");
  await auditar({
    usuario,
    ip,
    accion: "cobranza.comprobante_rechazado",
    detalle: {
      contrato: c.contratoFolio,
      referencia: c.referencia,
      motivo: texto,
    },
  });
  emitir("cobranza");
  emitir("portal", { contratoId: String(c.contratoId) });
  return c;
}

module.exports = { aceptarComprobante, rechazarComprobante };
