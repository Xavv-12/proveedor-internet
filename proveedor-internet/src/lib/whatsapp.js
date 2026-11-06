"use strict";
const crypto = require("node:crypto");
const { obtenerConfig } = require("../config");
const { ErrorNegocio } = require("./util");

function whatsappConfigurado() {
  const { wa } = obtenerConfig();
  return Boolean(wa.token && wa.phoneId);
}

/** Llama a WhatsApp Cloud API (Graph API) y devuelve el id del mensaje. */
async function publicar(cuerpo) {
  const { wa } = obtenerConfig();
  if (!whatsappConfigurado())
    throw new ErrorNegocio(
      "WhatsApp no está configurado (faltan WA_TOKEN o WA_PHONE_ID).",
      503,
    );
  const r = await fetch(
    `https://graph.facebook.com/${wa.version}/${encodeURIComponent(wa.phoneId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wa.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15000),
    },
  );
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`WhatsApp respondió ${r.status}`);
    e.detalle = String(datos?.error?.message || "").slice(0, 200);
    throw e;
  }
  return datos?.messages?.[0]?.id || null;
}

/**
 * Envía un mensaje a un teléfono de 10 dígitos (México).
 * Fuera de la ventana de 24 horas, Meta solo permite plantillas aprobadas.
 */
async function enviarMensajeWhatsApp(
  telefono10,
  { texto, plantilla, idioma, parametros = [] },
) {
  const destino = `52${telefono10}`;
  const cuerpo = plantilla
    ? {
        messaging_product: "whatsapp",
        to: destino,
        type: "template",
        template: {
          name: plantilla,
          language: { code: idioma || "es_MX" },
          components: parametros.length
            ? [
                {
                  type: "body",
                  parameters: parametros.map((t) => ({
                    type: "text",
                    text: String(t),
                  })),
                },
              ]
            : [],
        },
      }
    : {
        messaging_product: "whatsapp",
        to: destino,
        type: "text",
        text: { body: texto, preview_url: false },
      };
  return publicar(cuerpo);
}

/**
 * Responde un chat: se envía al identificador exacto que mandó WhatsApp (wa_id),
 * dentro de la ventana de 24 horas desde el último mensaje del cliente.
 */
async function enviarTextoWhatsApp(waId, texto) {
  const destino = String(waId || "").replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(destino))
    throw new ErrorNegocio("Número de WhatsApp inválido.", 422);
  return publicar({
    messaging_product: "whatsapp",
    to: destino,
    type: "text",
    text: { body: String(texto).slice(0, 4000), preview_url: true },
  });
}

/** Verifica X-Hub-Signature-256 (HMAC SHA-256 del cuerpo crudo) con comparación de tiempo constante. */
function verificarFirma(cuerpoCrudo, encabezado, secreto) {
  if (!secreto || !encabezado || !Buffer.isBuffer(cuerpoCrudo)) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(encabezado).trim());
  if (!m) return false;
  const esperado = crypto
    .createHmac("sha256", secreto)
    .update(cuerpoCrudo)
    .digest();
  const recibido = Buffer.from(m[1], "hex");
  return (
    recibido.length === esperado.length &&
    crypto.timingSafeEqual(recibido, esperado)
  );
}

function igualSeguro(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

module.exports = {
  whatsappConfigurado,
  enviarMensajeWhatsApp,
  enviarTextoWhatsApp,
  verificarFirma,
  igualSeguro,
};
