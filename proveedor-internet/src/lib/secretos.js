"use strict";
// Cifrado de contraseñas (WiFi, router) con AES-256-GCM.
// La clave vive en la variable de entorno CLAVE_SECRETOS: 64 caracteres hexadecimales (32 bytes).
// Formato guardado: v1:iv:etiqueta:texto  (todo en base64).
const crypto = require("node:crypto");

function clave() {
  const hex = process.env.CLAVE_SECRETOS || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "CLAVE_SECRETOS no está configurada o no tiene 64 caracteres hexadecimales.",
    );
  }
  return Buffer.from(hex, "hex");
}

function claveConfigurada() {
  try {
    clave();
    return true;
  } catch {
    return false;
  }
}

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", clave(), iv);
  const enc = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

function descifrar(valor) {
  const [version, iv, tag, enc] = String(valor).split(":");
  if (version !== "v1" || !iv || !tag || enc === undefined)
    throw new Error("Formato de secreto inválido.");
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    clave(),
    Buffer.from(iv, "base64"),
  );
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    d.update(Buffer.from(enc, "base64")),
    d.final(),
  ]).toString("utf8");
}

module.exports = { cifrar, descifrar, claveConfigurada };
