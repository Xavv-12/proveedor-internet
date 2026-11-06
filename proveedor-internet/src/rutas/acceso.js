"use strict";
const crypto = require("node:crypto");
const express = require("express");
const E = require("../lib/esquemas");
const { col, aId } = require("../db");
const { regenerar, permitir } = require("../middleware/sesion");
const { obtenerConfig } = require("../config");
const { envolver, avisar, erroresZod } = require("../lib/util");
const { auditar, auditarReq } = require("../lib/auditoria");
const { cifrar, comparar } = require("../lib/contrasenas");
const { registrarEvento, contarEventos } = require("../lib/limites");
const { enviarRestablecimiento } = require("../lib/correo");
const { formatearFechaHora, rangoDiaMX } = require("../lib/fechas");
const { renderFormulario, llenar, insigniaEstado } = require("../lib/vistas");
const {
  resumen: resumenSeguimiento,
  HORAS_SIN_CONTACTO,
} = require("../servicios/seguimiento");
const { puede } = require("../permisos");
const { INCIDENCIA_ABIERTA } = require("../servicios/incidencias");
const logger = require("../logger");

const QUINCE_MIN = 15 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;
const MAX_FALLIDOS = 20;
const TOKEN_MIN = 30;
const ERROR_LOGIN = "Correo o contraseña incorrectos";
const MENSAJE_NEUTRO =
  "Si el correo está registrado, te enviaremos un enlace para restablecer tu contraseña. Revisa tu bandeja en unos minutos.";

const hashToken = (t) =>
  crypto.createHash("sha256").update(String(t)).digest("hex");

/* ===================== Inicio y cierre de sesión ===================== */
const rAcceso = express.Router();

function vistaLogin(
  res,
  { correo = "", error = null, inactividad = false, estado = 200 } = {},
) {
  res
    .status(estado)
    .render("login", { titulo: "Iniciar sesión", correo, error, inactividad });
}

rAcceso.get("/login", (req, res) => {
  if (req.usuario) return res.redirect("/");
  return vistaLogin(res, {
    inactividad: req.inactivo || req.query.motivo === "inactividad",
  });
});

rAcceso.post(
  "/login",
  envolver(async (req, res) => {
    const ip = req.ip;
    const correo = String(req.body.correo || "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const contrasena = String(req.body.contrasena || "").slice(0, 200);
    const clave = `login:${ip}`;

    // Bloqueo tras 20 intentos fallidos desde la misma IP en 15 minutos (guardado en MongoDB).
    if ((await contarEventos(clave, QUINCE_MIN)) >= MAX_FALLIDOS) {
      return vistaLogin(res, {
        correo,
        estado: 429,
        error:
          "Demasiados intentos fallidos desde tu conexión. Espera 15 minutos e intenta de nuevo.",
      });
    }
    const u = correo ? await col("usuarios").findOne({ correo }) : null;
    const ok = await comparar(contrasena, u?.hash);
    if (!u || !ok || !u.activo) {
      const { total } = await registrarEvento(clave, QUINCE_MIN);
      await auditar({
        accion: "acceso.fallido",
        correo: correo || null,
        ip,
        detalle: { intentos: total },
      });
      if (total === MAX_FALLIDOS)
        await auditar({
          accion: "acceso.bloqueo",
          correo: correo || null,
          ip,
          detalle: { ventanaMinutos: 15 },
        });
      return vistaLogin(res, { correo, estado: 401, error: ERROR_LOGIN });
    }
    await regenerar(req); // evita fijación de sesión
    req.session.usuarioId = String(u._id);
    req.session.versionSesion = u.versionSesion;
    req.session.ultimaActividad = Date.now();
    await col("usuarios").updateOne(
      { _id: u._id },
      { $set: { ultimoAcceso: new Date() } },
    );
    await auditar({ usuario: u, accion: "acceso.correcto", ip });
    return res.redirect("/");
  }),
);

rAcceso.post("/logout", (req, res, next) => {
  req.session.destroy((e) => {
    if (e) return next(e);
    res.clearCookie(obtenerConfig().produccion ? "__Host-sesion" : "sesion", {
      path: "/",
    });
    return res.redirect("/login");
  });
});

/* ===================== Restablecer contraseña ===================== */
rAcceso.get(
  "/restablecer",
  envolver(async (req, res) => {
    const token = String(req.query.token || "");
    if (!token)
      return res.render("restablecer", {
        titulo: "Restablecer contraseña",
        modo: "solicitar",
        mensaje: null,
        errores: {},
      });
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      return res.render("restablecer", {
        titulo: "Restablecer contraseña",
        modo: "invalido",
        mensaje: null,
        errores: {},
      });
    return res.render("restablecer", {
      titulo: "Nueva contraseña",
      modo: "nueva",
      token,
      mensaje: null,
      errores: {},
    });
  }),
);

rAcceso.post(
  "/restablecer/solicitar",
  envolver(async (req, res) => {
    const correo = String(req.body.correo || "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const { total } = await registrarEvento(`restablecer:${req.ip}`, UNA_HORA);
    if (total <= 5 && correo) {
      const u = await col("usuarios").findOne(
        { correo, activo: true },
        { projection: { _id: 1, nombre: 1, correo: 1 } },
      );
      if (u) {
        const token = crypto.randomBytes(32).toString("base64url");
        await col("restablecimientos").updateMany(
          { usuarioId: u._id, usado: false },
          { $set: { usado: true, anulado: new Date() } },
        );
        await col("restablecimientos").insertOne({
          usuarioId: u._id,
          hash: hashToken(token),
          usado: false,
          creado: new Date(),
          expira: new Date(Date.now() + TOKEN_MIN * 60 * 1000),
        });
        const enlace = `${obtenerConfig().appUrl}/restablecer?token=${token}`;
        // Se envía sin esperar, para que el tiempo de respuesta no revele si el correo existe.
        enviarRestablecimiento(u.correo, u.nombre, enlace).catch((e) =>
          logger.error(
            { error: e.message },
            "No se pudo enviar el correo de restablecimiento",
          ),
        );
        await auditar({
          usuario: u,
          accion: "acceso.restablecimiento_solicitado",
          ip: req.ip,
        });
      }
    }
    return res.render("restablecer", {
      titulo: "Restablecer contraseña",
      modo: "enviado",
      mensaje: MENSAJE_NEUTRO,
      errores: {},
    });
  }),
);

rAcceso.post(
  "/restablecer",
  envolver(async (req, res) => {
    const token = String(req.body.token || "");
    const v = E.z
      .object({
        nueva: E.contrasenaNueva(),
        confirmacion: E.cadena(
          (s) => s,
          (x) => String(x ?? ""),
        ),
      })
      .refine((d) => d.nueva === d.confirmacion, {
        path: ["confirmacion"],
        message: "Las contraseñas no coinciden.",
      })
      .safeParse(req.body);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      return res.status(400).render("restablecer", {
        titulo: "Restablecer contraseña",
        modo: "invalido",
        mensaje: null,
        errores: {},
      });
    if (!v.success)
      return res.status(422).render("restablecer", {
        titulo: "Nueva contraseña",
        modo: "nueva",
        token,
        mensaje: null,
        errores: erroresZod(v.error),
      });
    // Un solo uso: se marca como usado de forma atómica.
    const t = await col("restablecimientos").findOneAndUpdate(
      { hash: hashToken(token), usado: false, expira: { $gt: new Date() } },
      { $set: { usado: true, usadoEn: new Date() } },
    );
    if (!t)
      return res.status(400).render("restablecer", {
        titulo: "Restablecer contraseña",
        modo: "invalido",
        mensaje: null,
        errores: {},
      });
    const u = await col("usuarios").findOneAndUpdate(
      { _id: t.usuarioId, activo: true },
      {
        $set: { hash: await cifrar(v.data.nueva), actualizado: new Date() },
        $inc: { versionSesion: 1 },
      },
    );
    if (!u)
      return res.status(400).render("restablecer", {
        titulo: "Restablecer contraseña",
        modo: "invalido",
        mensaje: null,
        errores: {},
      });
    await auditar({
      usuario: u,
      accion: "usuario.contrasena_restablecida",
      ip: req.ip,
    });
    avisar(req, "Tu contraseña se actualizó. Ya puedes iniciar sesión.");
    return res.redirect("/login");
  }),
);

/* ===================== Mi cuenta ===================== */
const rMiCuenta = express.Router();
const camposCuenta = [
  {
    nombre: "actual",
    etiqueta: "Contraseña actual",
    tipo: "password",
    requerido: true,
    autocomplete: "current-password",
  },
  {
    nombre: "nueva",
    etiqueta: "Nueva contraseña",
    tipo: "password",
    requerido: true,
    autocomplete: "new-password",
    ayuda: "Mínimo 10 caracteres.",
  },
  {
    nombre: "confirmacion",
    etiqueta: "Confirma la nueva contraseña",
    tipo: "password",
    requerido: true,
    autocomplete: "new-password",
  },
];
const formCuenta = (req, res, errores = {}, estado = 200) =>
  renderFormulario(
    res,
    {
      titulo: "Mi cuenta",
      accion: "/mi-cuenta",
      cancelar: "/",
      boton: "Cambiar contraseña",
      campos: llenar(camposCuenta),
      errores,
      nota: `${req.usuario.nombre} (${req.usuario.correo}). Al cambiar la contraseña se cierran tus otras sesiones.`,
    },
    estado,
  );

rMiCuenta.get("/", (req, res) => formCuenta(req, res));

rMiCuenta.post(
  "/",
  envolver(async (req, res) => {
    const v = E.z
      .object({
        actual: E.cadena(
          (s) => s.min(1, "Escribe tu contraseña actual."),
          (x) => String(x ?? ""),
        ),
        nueva: E.contrasenaNueva(),
        confirmacion: E.cadena(
          (s) => s,
          (x) => String(x ?? ""),
        ),
      })
      .refine((d) => d.nueva === d.confirmacion, {
        path: ["confirmacion"],
        message: "Las contraseñas no coinciden.",
      })
      .safeParse(req.body);
    if (!v.success) return formCuenta(req, res, erroresZod(v.error), 422);
    const u = await col("usuarios").findOne({ _id: req.usuario._id });
    if (!(await comparar(v.data.actual, u.hash)))
      return formCuenta(
        req,
        res,
        { actual: "La contraseña actual no es correcta." },
        422,
      );
    if (v.data.actual === v.data.nueva)
      return formCuenta(
        req,
        res,
        { nueva: "La nueva contraseña debe ser distinta de la actual." },
        422,
      );
    const r = await col("usuarios").findOneAndUpdate(
      { _id: u._id },
      {
        $set: { hash: await cifrar(v.data.nueva), actualizado: new Date() },
        $inc: { versionSesion: 1 },
      },
      { returnDocument: "after", projection: { versionSesion: 1 } },
    );
    req.session.versionSesion = r.versionSesion; // esta sesión sigue; las demás se cierran
    await auditarReq(req, "usuario.cambio_contrasena", {});
    avisar(req, "Contraseña actualizada. Se cerraron tus otras sesiones.");
    return res.redirect("/mi-cuenta");
  }),
);

/* ===================== Tablero ===================== */
const rTablero = express.Router();

rTablero.get(
  "/",
  permitir("tablero"),
  envolver(async (req, res) => {
    const { inicio, fin } = rangoDiaMX();
    const [incidencias, visitas, contratos] = await Promise.all([
      col("incidencias").countDocuments({
        estado: { $in: INCIDENCIA_ABIERTA },
      }),
      col("visitas").countDocuments({
        fecha: { $gte: inicio, $lt: fin },
        estado: { $ne: "cancelada" },
      }),
      col("contratos").countDocuments({ estado: "activo" }),
    ]);
    // El técnico solo ve incidencias abiertas, visitas de hoy y contratos activos.
    const tarjetas = [
      {
        texto: "Incidencias abiertas",
        valor: incidencias,
        enlace: "/incidencias",
      },
      { texto: "Visitas de hoy", valor: visitas, enlace: "/visitas" },
      { texto: "Contratos activos", valor: contratos, enlace: "/contratos" },
    ];
    let ultimas = null;
    if (puede(req.usuario, "solicitudes")) {
      const [solicitudes, clientes, lista] = await Promise.all([
        col("solicitudes").countDocuments({
          estado: { $nin: ["contratada", "descartada"] },
        }),
        col("clientes").countDocuments({ activo: true }),
        col("solicitudes").find().sort({ creado: -1 }).limit(5).toArray(),
      ]);
      tarjetas.push(
        { texto: "Solicitudes", valor: solicitudes, enlace: "/solicitudes" },
        { texto: "Clientes", valor: clientes, enlace: "/clientes" },
      );

      // Avisos de seguimiento comercial: lo urgente va primero.
      const pend = await resumenSeguimiento();
      const urgentes = [
        {
          texto: `Sin contactar +${HORAS_SIN_CONTACTO} h`,
          valor: pend.sinContactar,
          enlace: "/solicitudes?vista=sin-contactar",
          alerta: pend.sinContactar > 0,
        },
        {
          texto: "Seguimientos para hoy",
          valor: pend.seguimientosHoy,
          enlace: "/solicitudes?vista=seguimiento",
          alerta: false,
        },
        {
          texto: "Instalaciones de hoy",
          valor: pend.instalacionesHoy,
          enlace: "/visitas",
          alerta: false,
        },
      ];
      if (pend.instalacionesAtrasadas)
        urgentes.push({
          texto: "Instalaciones atrasadas",
          valor: pend.instalacionesAtrasadas,
          enlace: "/solicitudes?vista=agendadas",
          alerta: true,
        });
      tarjetas.unshift(...urgentes);

      ultimas = lista.map((s) => ({
        folio: s.folio,
        nombre: s.nombre,
        enlace: `/solicitudes/${s._id}`,
        insignia: insigniaEstado(s.estado),
        recibida: formatearFechaHora(s.creado),
      }));
    }
    res.render("tablero", { titulo: "Tablero", tarjetas, ultimas });
  }),
);

module.exports = { rAcceso, rMiCuenta, rTablero, aId };
