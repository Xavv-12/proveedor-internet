"use strict";
const { col } = require("../db");

/** Registra una acción en la bitácora. La app solo inserta; nunca edita ni borra. */
async function auditar(
  { usuario = null, accion, detalle = {}, ip = null, correo = null },
  sesion,
) {
  await col("auditoria").insertOne(
    {
      fecha: new Date(),
      accion,
      usuarioId: usuario?._id ?? null,
      usuarioCorreo: usuario?.correo ?? correo ?? null,
      usuarioNombre: usuario?.nombre ?? null,
      ip: ip || null,
      detalle,
    },
    sesion ? { session: sesion } : undefined,
  );
}

function auditarReq(req, accion, detalle = {}, sesion) {
  return auditar({ usuario: req.usuario, accion, detalle, ip: req.ip }, sesion);
}

function diferencias(antes, despues, campos) {
  const cambios = {};
  for (const k of campos) {
    const a = antes?.[k] ?? null;
    const b = despues?.[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b))
      cambios[k] = { antes: a, despues: b };
  }
  return cambios;
}

module.exports = { auditar, auditarReq, diferencias };
