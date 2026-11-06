"use strict";
const { col, aId } = require("../db");
const { puede, INACTIVIDAD_MS } = require("../permisos");

function regenerar(req) {
  return new Promise((ok, mal) =>
    req.session.regenerate((e) => (e ? mal(e) : ok())),
  );
}

/**
 * Carga el usuario de la sesión en cada petición y verifica en el servidor:
 * cuenta activa, versión de sesión (cambio de contraseña cierra otras sesiones) e inactividad por rol.
 */
function cargarUsuario(req, res, next) {
  (async () => {
    req.usuario = null;
    const s = req.session;
    if (!s || !s.usuarioId) return;
    const id = aId(s.usuarioId);
    const u = id
      ? await col("usuarios").findOne({ _id: id }, { projection: { hash: 0 } })
      : null;
    const valida =
      u &&
      u.activo &&
      u.versionSesion === s.versionSesion &&
      INACTIVIDAD_MS[u.rol];
    const inactiva =
      valida &&
      (!s.ultimaActividad ||
        Date.now() - s.ultimaActividad > INACTIVIDAD_MS[u.rol]);
    if (!valida || inactiva) {
      await regenerar(req);
      if (inactiva) req.inactivo = true;
      return;
    }
    // Las actualizaciones automáticas (tiempo real y consultas de respaldo cada 4 s)
    // no cuentan como actividad de la persona: así la sesión sí se cierra por inactividad.
    const automatica =
      req.get("X-Actualizacion-Auto") === "1" ||
      req.path === "/eventos" ||
      req.path.startsWith("/eventos/");
    if (!automatica) s.ultimaActividad = Date.now();
    req.usuario = u;
  })().then(() => next(), next);
}

function requiereSesion(req, res, next) {
  if (req.usuario) return next();
  return res.redirect(req.inactivo ? "/login?motivo=inactividad" : "/login");
}

/** Permiso aplicado en el servidor para cada ruta. */
function permitir(modulo, nivel = "leer") {
  return (req, res, next) => {
    if (puede(req.usuario, modulo, nivel)) return next();
    return res.status(403).render("error", {
      titulo: "Sin permiso",
      mensaje: "No tienes permiso para ver esto",
    });
  };
}

module.exports = { cargarUsuario, requiereSesion, permitir, regenerar };
