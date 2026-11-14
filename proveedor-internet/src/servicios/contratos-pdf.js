"use strict";
// Contratos escaneados: empareja cada PDF con su contrato y los envía por correo, uno por uno.
const { col } = require("../db");
const { interpretarNombre } = require("../lib/nombres-contrato");
const { enviarContratoPdf } = require("../lib/correo");
const { auditar } = require("../lib/auditoria");
const { rutaEvidencia } = require("../lib/archivos");
const { emitir } = require("../lib/eventos");
const logger = require("../logger");

const MODULO = "contratos_pdf";
const PAUSA_MS = Number(process.env.PAUSA_ENVIO_MS ?? 1500); // pausa entre correos para no saturar el SMTP
// Estados de un PDF: por_enviar, en_cola, enviando, enviado, fallo, sin_contrato, sin_correo, duplicado.
const ESTADOS_ACTIVOS = ["por_enviar", "en_cola", "enviando", "enviado"];

/**
 * Decide a qué contrato corresponde un PDF y si se puede enviar.
 * `referencia` es el nombre del archivo o lo que escribió la persona (folio CTR o número impreso).
 */
async function evaluar({ referencia, excluirId = null }) {
  const ref = interpretarNombre(referencia);
  if (!ref)
    return {
      estado: "sin_contrato",
      motivo: "El nombre no trae un número de contrato reconocible.",
    };
  const filtro =
    ref.tipo === "folio" ? { folio: ref.valor } : { numeroImpreso: ref.valor };
  const contratos = await col("contratos").find(filtro).limit(2).toArray();
  if (!contratos.length)
    return {
      estado: "sin_contrato",
      motivo: `No existe un contrato con ${ref.valor}.`,
    };
  if (contratos.length > 1) {
    return {
      estado: "sin_contrato",
      motivo: `Hay más de un contrato con el número ${ref.valor}. Asígnalo con su folio CTR.`,
    };
  }
  const c = contratos[0];
  const cliente = await col("clientes").findOne(
    { _id: c.clienteId },
    { projection: { correo: 1 } },
  );
  const base = {
    contratoId: c._id,
    contratoFolio: c.folio,
    numeroImpreso: c.numeroImpreso || null,
    clienteId: c.clienteId,
    clienteNombre: c.clienteNombre || "",
    correo: cliente?.correo || "",
  };
  const previo = await col("contratos_pdf").findOne(
    {
      contratoId: c._id,
      estado: { $in: ESTADOS_ACTIVOS },
      ...(excluirId ? { _id: { $ne: excluirId } } : {}),
    },
    { projection: { _id: 1 } },
  );
  if (previo)
    return {
      ...base,
      estado: "duplicado",
      motivo: "Este contrato ya tiene un PDF cargado o enviado.",
    };
  if (!base.correo) {
    return {
      ...base,
      estado: "sin_correo",
      motivo:
        "El cliente no tiene correo. Agrégalo en Clientes y vuelve a revisar.",
    };
  }
  return { ...base, estado: "por_enviar", motivo: "" };
}

async function enviarUno(doc) {
  let error = null;
  let correo = "";
  try {
    // Se vuelve a leer el correo del cliente: si lo corrigieron después de cargar el PDF, se usa el nuevo.
    const cliente = await col("clientes").findOne(
      { _id: doc.clienteId },
      { projection: { correo: 1 } },
    );
    correo = cliente?.correo || "";
    if (!correo) throw new Error("El cliente ya no tiene correo registrado.");
    await enviarContratoPdf({
      correo,
      nombre: doc.clienteNombre,
      folio: doc.numeroImpreso || doc.contratoFolio,
      rutaPdf: rutaEvidencia(doc.archivo),
    });
  } catch (e) {
    error = String(e.message || e).slice(0, 300);
  }
  await col("contratos_pdf").updateOne(
    { _id: doc._id },
    error
      ? { $set: { estado: "fallo", error } }
      : {
          $set: { estado: "enviado", enviadoEn: new Date(), correo, error: "" },
        },
  );
  try {
    await auditar({
      usuario: doc.colaPor || null,
      accion: error ? "contrato_pdf.fallo" : "contrato_pdf.envio",
      detalle: {
        contrato: doc.contratoFolio,
        correo,
        registro: String(doc._id),
        ...(error ? { error } : {}),
      },
    });
  } catch (e) {
    logger.error(
      { error: e.message },
      "No se pudo auditar el envío del contrato",
    );
  }
}

let procesando = false;

/** Envía los PDF en estado "en_cola", uno por uno. Si ya está corriendo, no hace nada. */
async function procesarCola() {
  if (procesando) return;
  procesando = true;
  try {
    // Si el servidor se reinició a medio envío, lo que quedó "enviando" vuelve a la cola.
    await col("contratos_pdf").updateMany(
      { estado: "enviando" },
      { $set: { estado: "en_cola" } },
    );
    for (;;) {
      const doc = await col("contratos_pdf").findOneAndUpdate(
        { estado: "en_cola" },
        { $set: { estado: "enviando" }, $inc: { intentos: 1 } },
        { sort: { subido: 1 }, returnDocument: "after" },
      );
      if (!doc) break;
      await enviarUno(doc);
      emitir(MODULO);
      if (PAUSA_MS > 0) await new Promise((r) => setTimeout(r, PAUSA_MS));
    }
  } catch (e) {
    logger.error(
      { error: e.message, stack: e.stack },
      "Error procesando la cola de contratos",
    );
  } finally {
    procesando = false;
    emitir(MODULO);
  }
}

module.exports = { MODULO, ESTADOS_ACTIVOS, evaluar, enviarUno, procesarCola };
