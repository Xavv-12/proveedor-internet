"use strict";
const crypto = require("node:crypto");

// Únicas rutas que aceptan multipart; ahí el token se verifica después de que multer lee el cuerpo.
const RUTAS_MULTIPART = [
  /^\/incidencias\/[0-9a-f]{24}\/evidencias$/,
  /^\/conciliacion-bancaria\/importar$/,
  /^\/contratos-escaneados$/, // carga masiva de contratos escaneados
  /^\/clientes\/carga-masiva$/, // carga masiva de clientes (Excel)
  /^\/panel-tecnico\/(instalaciones|seguimientos|atenciones|renovaciones|bajas)$/, // fotos del panel del técnico
];

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function rechazar(res) {
  return res.status(403).render("error", {
    titulo: "Formulario vencido",
    mensaje:
      "El formulario expiró o no es válido. Recarga la página e intenta de nuevo.",
  });
}

function verificarCsrf(req, res, next) {
  const t = (req.body && req.body._csrf) || req.get("x-csrf-token");
  if (typeof t === "string" && req.session.csrf && igual(t, req.session.csrf))
    return next();
  return rechazar(res);
}

function proteccionCsrf(req, res, next) {
  const necesitaToken =
    req.usuario ||
    req.path.startsWith("/login") ||
    req.path.startsWith("/restablecer");
  if (!req.session.csrf && necesitaToken)
    req.session.csrf = crypto.randomBytes(32).toString("hex");
  res.locals.csrf = req.session.csrf || "";
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.is("multipart/form-data")) {
    return RUTAS_MULTIPART.some((r) => r.test(req.path))
      ? next()
      : rechazar(res);
  }
  return verificarCsrf(req, res, next);
}

module.exports = { proteccionCsrf, verificarCsrf };
