"use strict";
const { col } = require("../db");
const { ErrorNegocio } = require("../lib/util");
const { auditar } = require("../lib/auditoria");
const { formatear } = require("../lib/dinero");
const {
  whatsappConfigurado,
  enviarMensajeWhatsApp,
} = require("../lib/whatsapp");
const logger = require("../logger");

const VEINTE_HORAS = 20 * 60 * 60 * 1000;
const TEXTO_DEFECTO =
  "Hola, {nombre}. Te recordamos que tu servicio de internet (contrato {folio}) tiene un saldo vencido de {saldo}. Si ya pagaste, ignora este mensaje.";

/**
 * Reserva atómica del teléfono: solo una petición puede enviar al mismo número cada 20 horas.
 * Si existe un envío reciente, el upsert choca con el _id y se rechaza.
 */
async function reservarTelefono(telefono, ahora = new Date()) {
  try {
    const antes = await col("whatsapp_limites").findOneAndUpdate(
      {
        _id: telefono,
        $or: [
          { ultimo: { $lte: new Date(ahora.getTime() - VEINTE_HORAS) } },
          { ultimo: { $exists: false } },
        ],
      },
      { $set: { ultimo: ahora } },
      { upsert: true, returnDocument: "before" },
    );
    return { ok: true, anterior: antes?.ultimo ?? null, ahora };
  } catch (e) {
    if (e.code === 11000) return { ok: false };
    throw e;
  }
}

async function liberarTelefono(telefono, reserva) {
  await col("whatsapp_limites").updateOne(
    { _id: telefono, ultimo: reserva.ahora },
    reserva.anterior
      ? { $set: { ultimo: reserva.anterior } }
      : { $unset: { ultimo: "" } },
  );
}

async function saldoVencido(contratoId) {
  const [r] = await col("mensualidades")
    .aggregate([
      { $match: { contratoId, estado: "VENCIDA" } },
      {
        $group: {
          _id: null,
          saldo: { $sum: { $subtract: ["$importe", "$pagado"] } },
        },
      },
    ])
    .toArray();
  return r ? r.saldo : 0;
}

async function enviarRecordatorio(
  contratoId,
  { usuario = null, ip = null } = {},
) {
  if (!whatsappConfigurado())
    throw new ErrorNegocio(
      "WhatsApp no está configurado (faltan WA_TOKEN o WA_PHONE_ID).",
      503,
    );
  const contrato = await col("contratos").findOne({ _id: contratoId });
  if (!contrato) throw new ErrorNegocio("El contrato no existe.", 404);
  const cliente = await col("clientes").findOne(
    { _id: contrato.clienteId },
    { projection: { nombre: 1, telefono: 1 } },
  );
  const telefono = cliente?.telefono;
  if (!/^\d{10}$/.test(String(telefono ?? "")))
    throw new ErrorNegocio("El cliente no tiene un teléfono válido.");
  const saldo = await saldoVencido(contrato._id);
  if (saldo <= 0)
    throw new ErrorNegocio("Este contrato no tiene mensualidades vencidas.");

  const plantilla = await col("mensajes").findOne(
    { tipo: "recordatorio_cobro", activo: true },
    { sort: { actualizado: -1 } },
  );
  const nombre = String(cliente.nombre || "").split(" ")[0] || "cliente";
  const saldoTxt = formatear(saldo);
  const texto = (plantilla?.texto || TEXTO_DEFECTO)
    .replaceAll("{nombre}", nombre)
    .replaceAll("{saldo}", saldoTxt)
    .replaceAll("{folio}", contrato.folio);

  const reserva = await reservarTelefono(telefono);
  if (!reserva.ok)
    throw new ErrorNegocio(
      "Ya se envió un recordatorio a ese teléfono en las últimas 20 horas.",
      429,
    );
  try {
    const mensajeId = await enviarMensajeWhatsApp(telefono, {
      texto,
      plantilla: plantilla?.plantillaWhatsApp || null,
      idioma: plantilla?.idioma,
      parametros: [nombre, saldoTxt, contrato.folio],
    });
    await col("whatsapp_envios").insertOne({
      telefono,
      contratoId: contrato._id,
      contratoFolio: contrato.folio,
      tipo: "recordatorio_cobro",
      estado: "enviado",
      mensajeId,
      fecha: new Date(),
      usuarioId: usuario?._id ?? null,
    });
    await auditar({
      usuario,
      ip,
      accion: "cobranza.recordatorio",
      detalle: { contrato: contrato.folio, saldo: saldoTxt },
    });
    return { mensajeId };
  } catch (e) {
    await liberarTelefono(telefono, reserva);
    await col("whatsapp_envios").insertOne({
      telefono,
      contratoId: contrato._id,
      contratoFolio: contrato.folio,
      tipo: "recordatorio_cobro",
      estado: "error",
      error: e.detalle || e.message,
      fecha: new Date(),
      usuarioId: usuario?._id ?? null,
    });
    logger.warn(
      { contrato: contrato.folio, error: e.message },
      "No se pudo enviar el recordatorio por WhatsApp",
    );
    if (e instanceof ErrorNegocio) throw e;
    throw new ErrorNegocio(
      "No se pudo enviar el mensaje de WhatsApp. Intenta más tarde.",
      502,
    );
  }
}

/** Tarea programada: un recordatorio por contrato con mensualidades vencidas (respeta las 20 horas). */
async function enviarRecordatoriosAutomaticos() {
  if (!whatsappConfigurado()) return { omitida: "WhatsApp no configurado" };
  const contratos = await col("mensualidades").distinct("contratoId", {
    estado: "VENCIDA",
  });
  const resultado = { revisados: 0, enviados: 0, omitidos: 0, errores: 0 };
  for (const contratoId of contratos.slice(0, 500)) {
    resultado.revisados++;
    try {
      await enviarRecordatorio(contratoId);
      resultado.enviados++;
    } catch (e) {
      if (e instanceof ErrorNegocio && [429, 409].includes(e.estado))
        resultado.omitidos++;
      else resultado.errores++;
    }
  }
  return resultado;
}

module.exports = {
  reservarTelefono,
  liberarTelefono,
  enviarRecordatorio,
  enviarRecordatoriosAutomaticos,
  VEINTE_HORAS,
};
