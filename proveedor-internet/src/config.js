"use strict";
const path = require("node:path");
require("dotenv").config();

const crypto = require("node:crypto");

const OBLIGATORIAS = ["MONGODB_URI", "MONGODB_DB"];
// En producción también son obligatorias; en desarrollo local tienen valores por defecto.
const OBLIGATORIAS_PRODUCCION_BASE = [
  "SESSION_SECRET",
  "APP_URL",
  "SITIO_ORIGENES",
];
const OBLIGATORIAS_PRODUCCION = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_FROM",
  "WA_VERIFY_TOKEN",
  "WA_APP_SECRET",
];

function interpretarTrustProxy(valor) {
  const v = String(valor ?? "")
    .trim()
    .toLowerCase();
  if (!v || v === "false" || v === "0") return false;
  if (v === "true") return 1;
  if (/^\d+$/.test(v)) return Number(v);
  return String(valor).trim();
}

function leerConfig(env = process.env) {
  const produccion = env.NODE_ENV === "production";
  const errores = [];
  const avisos = [];
  for (const nombre of [
    ...OBLIGATORIAS,
    ...(produccion
      ? [...OBLIGATORIAS_PRODUCCION_BASE, ...OBLIGATORIAS_PRODUCCION]
      : []),
  ]) {
    if (!env[nombre] || !String(env[nombre]).trim())
      errores.push(`Falta la variable de entorno ${nombre}.`);
  }
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32)
    errores.push("SESSION_SECRET debe tener al menos 32 caracteres.");
  if (env.MONGODB_DB && !/^[A-Za-z0-9_-]{1,60}$/.test(env.MONGODB_DB))
    errores.push("MONGODB_DB solo admite letras, números, guion y guion bajo.");

  const sitioOrigenes = String(env.SITIO_ORIGENES || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  for (const o of sitioOrigenes) {
    if (!/^https?:\/\/[^/\s]+$/.test(o))
      errores.push(`SITIO_ORIGENES tiene un origen inválido: ${o}`);
    else if (produccion && !o.startsWith("https://"))
      errores.push(`En producción SITIO_ORIGENES debe usar https: ${o}`);
  }
  const portalUrl = String(env.PORTAL_URL || "").trim();
  if (portalUrl && !/^https?:\/\/\S+$/.test(portalUrl))
    errores.push("PORTAL_URL no es una dirección válida.");
  const puertoTexto = env.PORT || "3000";
  let sessionSecret = env.SESSION_SECRET;
  if (!produccion && !sessionSecret) {
    sessionSecret = crypto.randomBytes(48).toString("hex");
    avisos.push(
      "SESSION_SECRET no está definido: se generó uno temporal (al reiniciar se cierran las sesiones).",
    );
  }
  const appUrl = String(
    env.APP_URL || (produccion ? "" : `http://localhost:${puertoTexto}`),
  )
    .trim()
    .replace(/\/+$/, "");
  if (appUrl && !/^https?:\/\/\S+$/.test(appUrl))
    errores.push("APP_URL no es una dirección válida.");
  if (produccion && appUrl && !appUrl.startsWith("https://"))
    errores.push("En producción APP_URL debe usar https.");

  const puerto = Number(env.PORT || 3000);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535)
    errores.push("PORT no es válido.");
  const maxMb = Number(env.MAX_UPLOAD_MB || 8);
  if (!Number.isFinite(maxMb) || maxMb < 1 || maxMb > 50)
    errores.push("MAX_UPLOAD_MB debe ser un número entre 1 y 50.");
  const smtpPort = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    errores.push("SMTP_PORT no es válido.");

  return {
    errores,
    avisos,
    config: {
      produccion,
      entorno: env.NODE_ENV || "development",
      mongoUri: env.MONGODB_URI,
      mongoDb: env.MONGODB_DB,
      sessionSecret,
      appUrl,
      puerto,
      trustProxy: interpretarTrustProxy(env.TRUST_PROXY),
      sitioOrigenes,
      portalUrl, // dirección de "Mi portal" en el sitio (va en el WhatsApp con el folio)
      wa: {
        verifyToken: env.WA_VERIFY_TOKEN || "",
        appSecret: env.WA_APP_SECRET || "",
        token: env.WA_TOKEN || "",
        phoneId: env.WA_PHONE_ID || "",
        version: env.WA_API_VERSION || "v23.0",
      },
      smtp: {
        host: env.SMTP_HOST || "",
        port: smtpPort,
        user: env.SMTP_USER || "",
        pass: env.SMTP_PASS || "",
        from: env.SMTP_FROM || "",
      },
      evidenceDir: path.resolve(env.EVIDENCE_DIR || "./evidencias"),
      maxUploadBytes: Math.floor(maxMb * 1024 * 1024),
    },
  };
}

let cache = null;

/** Devuelve la configuración validada. Si falta algo, detiene el proceso con un mensaje claro. */
function obtenerConfig() {
  if (!cache) {
    const { errores, avisos, config } = leerConfig();
    if (errores.length) {
      console.error(
        `No se puede iniciar la aplicación. Revisa la configuración:\n - ${errores.join("\n - ")}`,
      );
      process.exit(1);
    }
    for (const a of avisos) console.warn(`Aviso: ${a}`);
    cache = config;
  }
  return cache;
}

function reiniciarConfig() {
  cache = null;
}

module.exports = { obtenerConfig, leerConfig, reiniciarConfig };
