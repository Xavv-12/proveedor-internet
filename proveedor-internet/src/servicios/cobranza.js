"use strict";
const crypto = require("node:crypto");
const { col, enTransaccion } = require("../db");
const { ErrorNegocio, textoBusqueda } = require("../lib/util");
const { auditar } = require("../lib/auditoria");
const { fechaMXaUTC, partesMX, diasEnMes } = require("../lib/fechas");
const { formatear } = require("../lib/dinero");
const { emitir } = require("../lib/eventos");

/** Avisa al portal del cliente de ese contrato que su información cambió. */
function avisarPortal(contratoId) {
  emitir("portal", { contratoId: String(contratoId) });
}

const METODOS = ["efectivo", "transferencia", "deposito", "tarjeta"];
const NOMBRES_METODO = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  deposito: "Depósito",
  tarjeta: "Tarjeta",
};
const ESTADOS = ["PENDIENTE", "PARCIAL", "VENCIDA", "PAGADA", "CANCELADA"];
const ABIERTAS = ["PENDIENTE", "PARCIAL", "VENCIDA"];
const REF_VALIDA = /^[A-Z0-9][A-Z0-9\-_/.]{2,39}$/;

function normalizarReferencia(texto) {
  return String(texto ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Etapa de actualización que recalcula el estado con los valores ya actualizados. */
function recalcularEstado(ahora) {
  return {
    $set: {
      estado: {
        $switch: {
          branches: [
            { case: { $eq: ["$estado", "CANCELADA"] }, then: "CANCELADA" },
            { case: { $gte: ["$pagado", "$importe"] }, then: "PAGADA" },
            { case: { $lt: ["$fechaLimite", ahora] }, then: "VENCIDA" },
            { case: { $gt: ["$pagado", 0] }, then: "PARCIAL" },
          ],
          default: "PENDIENTE",
        },
      },
      actualizado: ahora,
    },
  };
}

/** Marca como VENCIDA toda mensualidad abierta cuya fecha límite ya pasó. */
async function marcarVencidas(ahora = new Date()) {
  const r = await col("mensualidades").updateMany(
    { estado: { $in: ["PENDIENTE", "PARCIAL"] }, fechaLimite: { $lt: ahora } },
    { $set: { estado: "VENCIDA", actualizado: ahora } },
  );
  if (r.modifiedCount) emitir("cobranza"); // las pantallas de cobranza se actualizan solas
  return r.modifiedCount;
}

function siguienteMes(anio, mes) {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
}

function fechaLimitePara(anio, mes, diaLimite) {
  return fechaMXaUTC(
    anio,
    mes,
    Math.min(diaLimite, diasEnMes(anio, mes)),
    23,
    59,
    59,
  );
}

/**
 * Genera 12 mensualidades a partir del mes actual (o del mes de inicio del contrato si es posterior).
 * Es idempotente: el índice único (contratoId, periodo) y $setOnInsert evitan duplicados.
 */
async function generarMensualidades(
  contratoId,
  { usuario = null, ip = null, meses = 12 } = {},
) {
  const c = await col("contratos").findOne({ _id: contratoId });
  if (!c) throw new ErrorNegocio("El contrato no existe.", 404);
  if (c.estado !== "activo")
    throw new ErrorNegocio(
      "Solo se generan mensualidades para contratos activos.",
    );

  const hoy = partesMX();
  const ini = partesMX(c.fechaInicio);
  let actual =
    ini.year * 12 + ini.month > hoy.year * 12 + hoy.month
      ? { anio: ini.year, mes: ini.month }
      : { anio: hoy.year, mes: hoy.month };
  // Si el contrato inicia este mes después del día límite, el primer cobro es el mes siguiente.
  if (
    actual.anio === ini.year &&
    actual.mes === ini.month &&
    fechaLimitePara(actual.anio, actual.mes, c.diaLimitePago) < c.fechaInicio
  ) {
    actual = siguienteMes(actual.anio, actual.mes);
  }

  const ahora = new Date();
  const ops = [];
  for (let i = 0; i < meses; i++) {
    const periodo = `${actual.anio}-${String(actual.mes).padStart(2, "0")}`;
    ops.push({
      updateOne: {
        filter: { contratoId: c._id, periodo },
        update: {
          $setOnInsert: {
            contratoId: c._id,
            contratoFolio: c.folio,
            clienteId: c.clienteId,
            clienteNombre: c.clienteNombre,
            periodo,
            importe: c.tarifa,
            pagado: 0,
            enValidacion: 0,
            estado: "PENDIENTE",
            fechaLimite: fechaLimitePara(
              actual.anio,
              actual.mes,
              c.diaLimitePago,
            ),
            busqueda: textoBusqueda(c.folio, c.clienteNombre, periodo),
            creado: ahora,
            actualizado: ahora,
          },
        },
        upsert: true,
      },
    });
    actual = siguienteMes(actual.anio, actual.mes);
  }

  let creadas = 0;
  try {
    const r = await col("mensualidades").bulkWrite(ops, { ordered: false });
    creadas = r.upsertedCount;
  } catch (e) {
    const errores = [].concat(e.writeErrors || []);
    if (errores.length && errores.every((w) => w.code === 11000))
      creadas = e.result?.upsertedCount ?? 0;
    else throw e;
  }
  await auditar({
    usuario,
    ip,
    accion: "cobranza.generacion",
    detalle: { contrato: c.folio, creadas },
  });
  if (creadas) avisarPortal(c._id);
  return { creadas, total: meses };
}

/**
 * Registra un cobro de forma atómica. La condición $expr garantiza que pagado + en validación + monto
 * nunca supere el importe, aun con cobros simultáneos. La referencia es única (índice único).
 */
async function registrarPago({
  mensualidadId,
  monto,
  metodo,
  referencia,
  usuario = null,
  ip = null,
  validar = false,
}) {
  if (!Number.isInteger(monto) || monto <= 0)
    throw new ErrorNegocio("El monto debe ser mayor que cero.", 422);
  if (!METODOS.includes(metodo))
    throw new ErrorNegocio("Elige un método de pago válido.", 422);
  let ref = normalizarReferencia(referencia);
  if (!ref && metodo === "efectivo")
    ref = `EF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  if (!REF_VALIDA.test(ref))
    throw new ErrorNegocio(
      "La referencia debe tener de 3 a 40 caracteres: letras, números, guion, punto o diagonal.",
      422,
    );
  const validado = metodo === "efectivo" || validar === true; // validar: comprobante revisado por el personal

  const resultado = await enTransaccion(async (sesion) => {
    const ahora = new Date();
    const incremento = validado
      ? { pagado: { $add: ["$pagado", monto] } }
      : { enValidacion: { $add: ["$enValidacion", monto] } };
    const m = await col("mensualidades").findOneAndUpdate(
      {
        _id: mensualidadId,
        estado: { $in: ABIERTAS },
        $expr: {
          $lte: [{ $add: ["$pagado", "$enValidacion", monto] }, "$importe"],
        },
      },
      [{ $set: incremento }, recalcularEstado(ahora)],
      { session: sesion, returnDocument: "after" },
    );
    if (!m) {
      const actual = await col("mensualidades").findOne(
        { _id: mensualidadId },
        { session: sesion },
      );
      if (!actual) throw new ErrorNegocio("La mensualidad no existe.", 404);
      if (actual.estado === "PAGADA")
        throw new ErrorNegocio(
          "Esta mensualidad ya está pagada; no se puede cobrar de nuevo.",
        );
      if (actual.estado === "CANCELADA")
        throw new ErrorNegocio(
          "Esta mensualidad está cancelada; no se puede cobrar.",
        );
      const disponible = Math.max(
        0,
        actual.importe - actual.pagado - actual.enValidacion,
      );
      throw new ErrorNegocio(
        `El monto supera el saldo pendiente. Puedes cobrar como máximo ${formatear(disponible)}.`,
      );
    }
    const pago = {
      mensualidadId,
      contratoId: m.contratoId,
      contratoFolio: m.contratoFolio,
      clienteNombre: m.clienteNombre,
      periodo: m.periodo,
      monto,
      metodo,
      referencia: ref,
      estado: validado ? "validado" : "por validar",
      registrado: ahora,
      registradoPor: usuario?._id ?? null,
      registradoPorNombre: usuario?.nombre ?? null,
      validado: validado ? ahora : null,
      validadoPor: validado ? (usuario?._id ?? null) : null,
      conciliado: false,
    };
    try {
      await col("pagos").insertOne(pago, { session: sesion });
    } catch (e) {
      if (e.code === 11000)
        throw new ErrorNegocio("Ese pago ya estaba registrado");
      throw e;
    }
    await auditar(
      {
        usuario,
        ip,
        accion: "cobranza.pago",
        detalle: {
          referencia: ref,
          contrato: m.contratoFolio,
          periodo: m.periodo,
          monto: formatear(monto),
          metodo,
          estado: pago.estado,
        },
      },
      sesion,
    );
    return { pago, mensualidad: m };
  });
  avisarPortal(resultado.mensualidad.contratoId);
  return resultado;
}

async function resolverPagoPorValidar(
  pagoId,
  aprobar,
  { usuario = null, ip = null } = {},
) {
  const resultado = await enTransaccion(async (sesion) => {
    const ahora = new Date();
    const p = await col("pagos").findOneAndUpdate(
      { _id: pagoId, estado: "por validar" },
      {
        $set: aprobar
          ? {
              estado: "validado",
              validado: ahora,
              validadoPor: usuario?._id ?? null,
            }
          : {
              estado: "rechazado",
              rechazado: ahora,
              rechazadoPor: usuario?._id ?? null,
            },
      },
      { session: sesion, returnDocument: "after" },
    );
    if (!p) throw new ErrorNegocio("Ese pago ya no está por validar.");
    const restar = { $max: [0, { $subtract: ["$enValidacion", p.monto] }] };
    const etapa = aprobar
      ? {
          $set: {
            pagado: { $add: ["$pagado", p.monto] },
            enValidacion: restar,
          },
        }
      : { $set: { enValidacion: restar } };
    const m = await col("mensualidades").findOneAndUpdate(
      { _id: p.mensualidadId },
      [etapa, recalcularEstado(ahora)],
      { session: sesion, returnDocument: "after" },
    );
    await auditar(
      {
        usuario,
        ip,
        accion: aprobar ? "cobranza.validacion" : "cobranza.rechazo",
        detalle: {
          referencia: p.referencia,
          contrato: p.contratoFolio,
          periodo: p.periodo,
          monto: formatear(p.monto),
        },
      },
      sesion,
    );
    return { pago: p, mensualidad: m };
  });
  avisarPortal(resultado.pago.contratoId);
  return resultado;
}

const validarPago = (id, ctx) => resolverPagoPorValidar(id, true, ctx);
const rechazarPago = (id, ctx) => resolverPagoPorValidar(id, false, ctx);

async function cancelarMensualidad(
  mensualidadId,
  { usuario = null, ip = null } = {},
) {
  const ahora = new Date();
  const m = await col("mensualidades").findOneAndUpdate(
    {
      _id: mensualidadId,
      estado: { $in: ABIERTAS },
      pagado: 0,
      enValidacion: 0,
    },
    {
      $set: {
        estado: "CANCELADA",
        cancelada: ahora,
        canceladaPor: usuario?._id ?? null,
        actualizado: ahora,
      },
    },
    { returnDocument: "after" },
  );
  if (!m)
    throw new ErrorNegocio(
      "Solo se puede cancelar una mensualidad abierta y sin pagos registrados.",
    );
  await auditar({
    usuario,
    ip,
    accion: "cobranza.cancelacion",
    detalle: { contrato: m.contratoFolio, periodo: m.periodo },
  });
  avisarPortal(m.contratoId);
  return m;
}

module.exports = {
  METODOS,
  NOMBRES_METODO,
  ESTADOS,
  ABIERTAS,
  REF_VALIDA,
  normalizarReferencia,
  recalcularEstado,
  marcarVencidas,
  generarMensualidades,
  registrarPago,
  validarPago,
  rechazarPago,
  cancelarMensualidad,
};
