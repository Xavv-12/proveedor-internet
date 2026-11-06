"use strict";
/**
 * ENVÍO DEL FOLIO DEL CONTRATO POR WHATSAPP
 * Al contratar, la administración le manda al cliente su folio (CTR-…) y el enlace
 * a "Mi portal", donde entra con ese folio y su teléfono.
 * - Con WhatsApp Cloud API configurado: se envía automáticamente.
 * - Sin configurar: la app ofrece un botón que abre WhatsApp con el mensaje ya escrito.
 */
const { col } = require("../db");
const { obtenerConfig } = require("../config");
const { ErrorNegocio } = require("../lib/util");
const { auditar } = require("../lib/auditoria");
const { registrarEvento } = require("../lib/limites");
const {
  whatsappConfigurado,
  enviarMensajeWhatsApp,
} = require("../lib/whatsapp");
const logger = require("../logger");

const TEXTO_DEFECTO =
  "Hola, {nombre}. ¡Bienvenido! Tu folio de contrato es {folio}. " +
  "Con este folio y tu teléfono puedes entrar a {portal} para ver tus mensualidades y enviar tus comprobantes de pago. " +
  "Guárdalo y no lo compartas.";

/** Dirección de "Mi portal" en el sitio público. */
function urlPortal() {
  const cfg = obtenerConfig();
  if (cfg.portalUrl) return cfg.portalUrl;
  const sitio =
    (cfg.sitioOrigenes || []).find((o) => o.startsWith("https://")) ||
    cfg.sitioOrigenes?.[0];
  return sitio ? `${sitio}/portal.html` : "";
}

async function prepararMensaje(contrato) {
  const cliente = await col("clientes").findOne(
    { _id: contrato.clienteId },
    { projection: { nombre: 1, telefono: 1 } },
  );
  if (!cliente || !/^\d{10}$/.test(String(cliente.telefono || "")))
    throw new ErrorNegocio(
      "El cliente no tiene un teléfono válido de 10 dígitos.",
    );
  const plantilla = await col("mensajes").findOne(
    { tipo: "folio", activo: true },
    { sort: { actualizado: -1 } },
  );
  const nombre = String(cliente.nombre || "").split(" ")[0] || "cliente";
  const portal = urlPortal() || "nuestro sitio, en la sección Mi portal";
  const texto = (plantilla?.texto || TEXTO_DEFECTO)
    .replaceAll("{nombre}", nombre)
    .replaceAll("{folio}", contrato.folio)
    .replaceAll("{portal}", portal);
  return { cliente, plantilla, nombre, portal, texto };
}

/** Enlace "clic para chatear": abre WhatsApp en el equipo del personal con el mensaje ya escrito. */
async function enlaceWhatsApp(contrato) {
  try {
    const { cliente, texto } = await prepararMensaje(contrato);
    return `https://wa.me/52${cliente.telefono}?text=${encodeURIComponent(texto)}`;
  } catch {
    return null;
  }
}

/** Envía el folio por WhatsApp Cloud API. Máximo 3 envíos por contrato cada 24 horas. */
async function enviarFolio(contrato, { usuario = null, ip = null } = {}) {
  if (!whatsappConfigurado()) {
    throw new ErrorNegocio(
      'WhatsApp no está configurado todavía. Usa el botón "Abrir WhatsApp con el folio" para mandarlo desde tu teléfono o computadora.',
      503,
    );
  }
  const { cliente, plantilla, nombre, portal, texto } =
    await prepararMensaje(contrato);
  const { total } = await registrarEvento(
    `folio-whatsapp:${contrato._id}`,
    24 * 60 * 60 * 1000,
  );
  if (total > 3)
    throw new ErrorNegocio(
      "Ya se envió el folio varias veces hoy a este cliente.",
      429,
    );
  try {
    const mensajeId = await enviarMensajeWhatsApp(cliente.telefono, {
      texto,
      plantilla: plantilla?.plantillaWhatsApp || null,
      idioma: plantilla?.idioma,
      parametros: [nombre, contrato.folio, portal],
    });
    await col("whatsapp_envios").insertOne({
      telefono: cliente.telefono,
      contratoId: contrato._id,
      contratoFolio: contrato.folio,
      tipo: "folio",
      estado: "enviado",
      mensajeId,
      fecha: new Date(),
      usuarioId: usuario?._id ?? null,
    });
    await auditar({
      usuario,
      ip,
      accion: "contrato.folio_enviado",
      detalle: { folio: contrato.folio },
    });
    return { mensajeId };
  } catch (e) {
    await col("whatsapp_envios").insertOne({
      telefono: cliente.telefono,
      contratoId: contrato._id,
      contratoFolio: contrato.folio,
      tipo: "folio",
      estado: "error",
      error: e.detalle || e.message,
      fecha: new Date(),
      usuarioId: usuario?._id ?? null,
    });
    logger.warn(
      { contrato: contrato.folio, error: e.message },
      "No se pudo enviar el folio por WhatsApp",
    );
    if (e instanceof ErrorNegocio) throw e;
    throw new ErrorNegocio(
      'No se pudo enviar el WhatsApp. Usa el botón "Abrir WhatsApp con el folio".',
      502,
    );
  }
}

module.exports = { enviarFolio, enlaceWhatsApp, urlPortal, TEXTO_DEFECTO };
