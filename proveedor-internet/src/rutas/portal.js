"use strict";
/**
 * PORTAL DEL CLIENTE (lo usa el sitio público, en portal.html).
 * El cliente entra con el folio de su contrato + su teléfono registrado.
 * No usa cookies: el sitio guarda un token en la pestaña (sessionStorage) y lo manda
 * en el encabezado Authorization. Cada respuesta incluye solo datos de SU contrato.
 */
const crypto = require("node:crypto");
const express = require("express");
const { col, aId } = require("../db");
const { obtenerConfig } = require("../config");
const { envolver } = require("../lib/util");
const { normalizarTelefono } = require("../lib/telefono");
const { registrarEvento, contarEventos } = require("../lib/limites");
const { auditar } = require("../lib/auditoria");
const { formatear, aCentavos } = require("../lib/dinero");
const { periodoTexto, textoAFechaMX } = require("../lib/fechas");
const {
  recibirArchivo,
  detectarTipo,
  guardarEvidencia,
  borrarEvidencia,
  nombreOriginalSeguro,
} = require("../lib/archivos");
const {
  normalizarReferencia,
  REF_VALIDA,
  NOMBRES_METODO,
  marcarVencidas,
} = require("../servicios/cobranza");
const { emitir, suscribir, abrirFlujo, enviar } = require("../lib/eventos");
const { textoBusqueda } = require("../lib/util");

const r = express.Router();
const QUINCE_MIN = 15 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;
const INACTIVIDAD = 30 * 60 * 1000;
const MAXIMA = 8 * 60 * 60 * 1000;
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const error = (res, estado, mensaje) =>
  res.status(estado).json({ success: false, error: mensaje });
const ESTADO_CLIENTE = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Pago parcial",
  VENCIDA: "Vencida",
  PAGADA: "Pagada",
  CANCELADA: "Cancelada",
};

/* ----- CORS: solo el sitio. Permite el encabezado Authorization; nunca cookies. ----- */
r.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.vary("Origin");
  const origen = req.get("Origin");
  if (origen) {
    if (!obtenerConfig().sitioOrigenes.includes(origen))
      return error(res, 403, "Origen no permitido.");
    res.set("Access-Control-Allow-Origin", origen);
  }
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "600");
    return res.status(204).end();
  }
  return next();
});
r.use(express.json({ limit: "5kb", type: "application/json" }));

/* ----- Sesión del portal: 30 min sin actividad o 8 h como máximo ----- */
async function autenticar(req, res, next) {
  try {
    const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      req.get("Authorization") || "",
    );
    if (!m) return error(res, 401, "Inicia sesión para continuar.");
    const ahora = new Date();
    const sesion = await col("portal_sesiones").findOneAndUpdate(
      { hash: hash(m[1]), expira: { $gt: ahora }, limite: { $gt: ahora } },
      [
        {
          $set: {
            expira: {
              $min: [new Date(ahora.getTime() + INACTIVIDAD), "$limite"],
            },
          },
        },
      ],
      { returnDocument: "after" },
    );
    if (!sesion)
      return error(
        res,
        401,
        "Tu sesión terminó. Vuelve a entrar con tu folio y teléfono.",
      );
    const contrato = await col("contratos").findOne({ _id: sesion.contratoId });
    if (!contrato)
      return error(
        res,
        401,
        "Tu sesión terminó. Vuelve a entrar con tu folio y teléfono.",
      );
    req.portal = { contrato, sesionHash: sesion.hash };
    return next();
  } catch (e) {
    return next(e);
  }
}

/* ----- Entrar: folio del contrato + teléfono registrado ----- */
r.post(
  "/acceso",
  envolver(async (req, res) => {
    const ip = req.ip;
    const mensajeBloqueo =
      "Demasiados intentos. Espera 15 minutos e intenta de nuevo.";
    if ((await contarEventos(`portal-fallo-ip:${ip}`, QUINCE_MIN)) >= 10)
      return error(res, 429, mensajeBloqueo);
    const folio = String(req.body?.folio || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .slice(0, 30);
    const telefono = normalizarTelefono(String(req.body?.telefono || ""));
    if (/^SOL-/.test(folio)) {
      return error(
        res,
        400,
        "Ese es el folio de tu solicitud. Para entrar usa el folio de tu contrato (empieza con CTR-), que te entregamos al contratar.",
      );
    }
    if (!/^CTR-\d{4}-\d{5}$/.test(folio) || !telefono) {
      return error(
        res,
        400,
        "Escribe el folio de tu contrato (ej. CTR-2026-00001) y tu teléfono de 10 dígitos.",
      );
    }
    if ((await contarEventos(`portal-fallo-folio:${folio}`, QUINCE_MIN)) >= 5)
      return error(res, 429, mensajeBloqueo);

    const contrato = await col("contratos").findOne(
      { folio },
      { projection: { clienteId: 1, estado: 1 } },
    );
    const cliente = contrato
      ? await col("clientes").findOne(
          { _id: contrato.clienteId },
          { projection: { telefono: 1 } },
        )
      : null;
    if (
      !contrato ||
      !cliente ||
      cliente.telefono !== telefono ||
      contrato.estado === "cancelado"
    ) {
      await registrarEvento(`portal-fallo-ip:${ip}`, QUINCE_MIN);
      await registrarEvento(`portal-fallo-folio:${folio}`, QUINCE_MIN);
      await auditar({
        accion: "portal.acceso_fallido",
        ip,
        detalle: { folio },
      });
      return error(
        res,
        401,
        "El folio o el teléfono no coinciden con nuestros registros.",
      );
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const ahora = new Date();
    await col("portal_sesiones").insertOne({
      hash: hash(token),
      contratoId: contrato._id,
      creado: ahora,
      expira: new Date(ahora.getTime() + INACTIVIDAD),
      limite: new Date(ahora.getTime() + MAXIMA),
    });
    await auditar({ accion: "portal.acceso", ip, detalle: { folio } });
    return res.json({ success: true, data: { token, inactividadMinutos: 30 } });
  }),
);

r.post(
  "/salir",
  autenticar,
  envolver(async (req, res) => {
    await col("portal_sesiones").deleteOne({ hash: req.portal.sesionHash });
    res.json({ success: true, data: { mensaje: "Sesión cerrada." } });
  }),
);

/* ----- Resumen: solo datos de SU contrato ----- */
r.get(
  "/resumen",
  autenticar,
  envolver(async (req, res) => {
    await marcarVencidas(); // que el cliente vea sus vencimientos al día
    const c = req.portal.contrato;
    const [mensualidades, pagos, comprobantes] = await Promise.all([
      col("mensualidades")
        .find({ contratoId: c._id })
        .sort({ periodo: -1 })
        .limit(24)
        .toArray(),
      col("pagos")
        .find({ contratoId: c._id, estado: { $ne: "rechazado" } })
        .sort({ registrado: -1 })
        .limit(50)
        .toArray(),
      col("comprobantes")
        .find({ contratoId: c._id })
        .sort({ creado: -1 })
        .limit(30)
        .toArray(),
    ]);
    const abiertas = mensualidades.filter((m) =>
      ["PENDIENTE", "PARCIAL", "VENCIDA"].includes(m.estado),
    );
    const vencidas = abiertas.filter((m) => m.estado === "VENCIDA");
    const saldoVencido = vencidas.reduce(
      (t, m) => t + (m.importe - m.pagado),
      0,
    );
    // Próximo pago: la mensualidad abierta (no vencida) con la fecha límite más cercana.
    const proxima =
      abiertas
        .filter((m) => m.estado !== "VENCIDA")
        .sort((x, y) => x.fechaLimite - y.fechaLimite)[0] || null;
    res.json({
      success: true,
      data: {
        contrato: {
          folio: c.folio,
          cliente: c.clienteNombre,
          plan: c.planNombre,
          tarifa: formatear(c.tarifa),
          estado: c.estado,
          diaLimitePago: c.diaLimitePago,
        },
        saldoVencido: formatear(saldoVencido),
        vencidas: vencidas.length,
        proximoPago: proxima
          ? {
              periodo: periodoTexto(proxima.periodo),
              saldo: formatear(proxima.importe - proxima.pagado),
              fechaLimite: proxima.fechaLimite.toISOString(),
            }
          : null,
        mensualidades: mensualidades.map((m) => ({
          id: String(m._id),
          periodo: periodoTexto(m.periodo),
          fechaLimite: m.fechaLimite.toISOString(),
          importe: formatear(m.importe),
          pagado: formatear(m.pagado),
          enRevision: formatear(m.enValidacion),
          saldo: formatear(Math.max(0, m.importe - m.pagado - m.enValidacion)),
          saldoCentavos: Math.max(0, m.importe - m.pagado - m.enValidacion),
          estado: ESTADO_CLIENTE[m.estado] || m.estado,
          puedePagar:
            ["PENDIENTE", "PARCIAL", "VENCIDA"].includes(m.estado) &&
            m.importe - m.pagado - m.enValidacion > 0,
        })),
        pagos: pagos.map((p) => ({
          fecha: p.registrado.toISOString(),
          periodo: periodoTexto(p.periodo),
          monto: formatear(p.monto),
          metodo: NOMBRES_METODO[p.metodo] || p.metodo,
          estado: p.estado === "validado" ? "Aplicado" : "En revisión",
          referencia: p.referencia,
        })),
        comprobantes: comprobantes.map((x) => ({
          fecha: x.creado.toISOString(),
          periodo: periodoTexto(x.periodo),
          monto: formatear(x.monto),
          referencia: x.referencia,
          estado:
            {
              "por revisar": "En revisión",
              aceptado: "Aceptado",
              rechazado: "Rechazado",
            }[x.estado] || x.estado,
          motivo: x.estado === "rechazado" ? x.motivo : null,
        })),
      },
    });
  }),
);

/* ----- Subir comprobante de pago (foto o PDF) ----- */
r.post(
  "/comprobantes",
  autenticar,
  (req, res, next) =>
    recibirArchivo("archivo", obtenerConfig().maxUploadBytes)(req, res, next),
  envolver(async (req, res) => {
    const c = req.portal.contrato;
    if (req.errorArchivo) return error(res, 400, req.errorArchivo);
    if (!req.file || !req.file.buffer?.length)
      return error(res, 400, "Adjunta la foto o el PDF de tu comprobante.");
    const tipo = detectarTipo(req.file.buffer);
    if (!tipo)
      return error(
        res,
        400,
        "Solo se aceptan fotos JPG, PNG o WEBP y archivos PDF.",
      );

    const m = await col("mensualidades").findOne({
      _id: aId(String(req.body.mensualidad || "")) || null,
      contratoId: c._id,
    });
    if (!m) return error(res, 400, "Elige la mensualidad que pagaste.");
    if (!["PENDIENTE", "PARCIAL", "VENCIDA"].includes(m.estado))
      return error(res, 400, "Esa mensualidad ya no tiene saldo pendiente.");
    const monto = aCentavos(String(req.body.monto || "").trim());
    if (!monto || monto <= 0)
      return error(
        res,
        400,
        "Escribe el monto que pagaste, por ejemplo 300.00",
      );
    if (monto > m.importe - m.pagado)
      return error(
        res,
        400,
        `El monto es mayor que el saldo de esa mensualidad (${formatear(m.importe - m.pagado)}).`,
      );
    const referencia = normalizarReferencia(req.body.referencia);
    if (!REF_VALIDA.test(referencia))
      return error(
        res,
        400,
        "Escribe la referencia, clave de rastreo o folio de tu pago (3 a 40 letras o números).",
      );
    const metodo = ["transferencia", "deposito"].includes(req.body.metodo)
      ? req.body.metodo
      : "transferencia";
    const fechaPago = textoAFechaMX(String(req.body.fecha || "")) || null;

    if (
      (await col("pagos").findOne(
        { referencia },
        { projection: { _id: 1 } },
      )) ||
      (await col("comprobantes").findOne(
        { referencia, estado: { $ne: "rechazado" } },
        { projection: { _id: 1 } },
      ))
    ) {
      return error(
        res,
        409,
        "Ya recibimos un pago o comprobante con esa referencia.",
      );
    }
    const { total } = await registrarEvento(
      `portal-comprobante:${c._id}`,
      UNA_HORA,
    );
    if (total > 10)
      return error(
        res,
        429,
        "Ya enviaste varios comprobantes. Intenta más tarde o escríbenos.",
      );

    const archivo = await guardarEvidencia(req.file.buffer, tipo);
    try {
      await col("comprobantes").insertOne({
        contratoId: c._id,
        contratoFolio: c.folio,
        clienteNombre: c.clienteNombre,
        mensualidadId: m._id,
        periodo: m.periodo,
        monto,
        referencia,
        metodo,
        fechaPago,
        archivo,
        tipo: tipo.tipo,
        ext: tipo.ext,
        tamano: req.file.size,
        nombreOriginal: nombreOriginalSeguro(req.file.originalname),
        estado: "por revisar",
        creado: new Date(),
        busqueda: textoBusqueda(
          c.folio,
          c.clienteNombre,
          referencia,
          m.periodo,
        ),
      });
    } catch (e) {
      await borrarEvidencia(archivo);
      throw e;
    }
    await auditar({
      accion: "portal.comprobante",
      ip: req.ip,
      detalle: { contrato: c.folio, referencia, monto: formatear(monto) },
    });
    emitir("cobranza"); // el personal lo ve al instante en Pagos y cobranza
    emitir("portal", { contratoId: String(c._id) });
    return res.status(201).json({
      success: true,
      data: {
        mensaje:
          "Recibimos tu comprobante. Lo revisaremos y verás el pago aplicado aquí.",
      },
    });
  }),
);

/* ----- Tiempo real: un pase de un solo uso (1 min) para abrir el flujo de eventos ----- */
r.post(
  "/pase",
  autenticar,
  envolver(async (req, res) => {
    const pase = crypto.randomBytes(24).toString("base64url");
    await col("portal_tickets").insertOne({
      hash: hash(pase),
      contratoId: req.portal.contrato._id,
      expira: new Date(Date.now() + 60 * 1000),
    });
    res.json({ success: true, data: { pase } });
  }),
);

r.get(
  "/eventos",
  envolver(async (req, res) => {
    const pase = String(req.query.pase || "");
    const t = /^[A-Za-z0-9_-]{32}$/.test(pase)
      ? await col("portal_tickets").findOneAndDelete({
          hash: hash(pase),
          expira: { $gt: new Date() },
        })
      : null;
    if (!t) return error(res, 401, "Pase inválido o vencido.");
    const id = String(t.contratoId);
    let quitar = () => {};
    abrirFlujo(req, res, {
      duracionMs: 10 * 60 * 1000,
      alCerrar: () => quitar(),
    });
    quitar = suscribir((ev) => {
      if (ev.modulo === "portal" && ev.contratoId === id)
        enviar(res, "cambio", {});
    });
    return undefined;
  }),
);

r.use((req, res) => error(res, 404, "Ruta no encontrada."));
// eslint-disable-next-line no-unused-vars
r.use((err, req, res, next) => {
  if (err.type === "entity.too.large")
    return error(res, 413, "La solicitud es demasiado grande.");
  if (err.type === "entity.parse.failed")
    return error(res, 400, "El cuerpo de la solicitud no es JSON válido.");
  return error(res, 500, "Ocurrió un error. Intenta más tarde.");
});

module.exports = r;
