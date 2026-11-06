"use strict";
const express = require("express");
const E = require("../lib/esquemas");
const { col, db } = require("../db");
const { obtenerConfig } = require("../config");
const {
  envolver,
  normalizar,
  escaparRegex,
  textoBusqueda,
} = require("../lib/util");
const { registrarEvento, quitarEvento } = require("../lib/limites");
const { siguienteFolio } = require("../lib/folios");
const { formatear } = require("../lib/dinero");
const { auditar } = require("../lib/auditoria");
const { verificarFirma, igualSeguro } = require("../lib/whatsapp");
const { recibirMensaje } = require("../servicios/chatbot");
const {
  emitir,
  suscribir,
  abrirFlujo,
  enviar,
  MODULOS_PUBLICOS,
} = require("../lib/eventos");
const logger = require("../logger");

const UNA_HORA = 60 * 60 * 1000;
const DIEZ_MIN = 10 * 60 * 1000;
const MENSAJE_LIMITE =
  "Ya recibimos varias solicitudes desde tu conexión. Escríbenos por WhatsApp.";

/** Forma única de error de la API. */
function error(res, estado, mensaje) {
  return res.status(estado).json({ success: false, error: mensaje });
}

/* ===================== API pública /api/v1 ===================== */
const rApi = express.Router();

rApi.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.vary("Origin");
  const origen = req.get("Origin");
  if (origen) {
    if (!obtenerConfig().sitioOrigenes.includes(origen))
      return error(res, 403, "Origen no permitido.");
    res.set("Access-Control-Allow-Origin", origen); // sin Allow-Credentials: la API no usa cookies
  }
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "600");
    return res.status(204).end();
  }
  return next();
});

rApi.use(
  express.json({ limit: "10kb", type: "application/json", strict: true }),
);

rApi.get(
  "/planes",
  envolver(async (req, res) => {
    const planes = await col("planes")
      .find({ activo: true, publicado: true, velocidadBajada: { $gt: 0 } })
      .project({
        _id: 0,
        clave: 1,
        nombre: 1,
        precio: 1,
        velocidadBajada: 1,
        velocidadSubida: 1,
        descripcion: 1,
      })
      .sort({ precio: 1 })
      .toArray();
    res.json({
      success: true,
      data: planes.map((p) => ({
        clave: p.clave,
        nombre: p.nombre,
        precio: formatear(p.precio),
        precioCentavos: p.precio,
        moneda: "MXN",
        velocidadBajadaMbps: p.velocidadBajada,
        velocidadSubidaMbps: p.velocidadSubida ?? null,
        descripcion: p.descripcion || "",
      })),
    });
  }),
);

rApi.get(
  "/promociones",
  envolver(async (req, res) => {
    const ahora = new Date();
    const promos = await col("promociones")
      .find({
        activo: true,
        publicada: true,
        $and: [
          { $or: [{ inicio: null }, { inicio: { $lte: ahora } }] },
          { $or: [{ fin: null }, { fin: { $gte: ahora } }] },
        ],
      })
      .project({
        _id: 0,
        titulo: 1,
        descripcion: 1,
        planes: 1,
        inicio: 1,
        fin: 1,
      })
      .sort({ inicio: -1 })
      .limit(50)
      .toArray();
    res.json({
      success: true,
      data: promos.map((p) => ({
        titulo: p.titulo,
        descripcion: p.descripcion,
        planes: p.planes || [],
        vigenciaInicio: p.inicio ? p.inicio.toISOString() : null,
        vigenciaFin: p.fin ? p.fin.toISOString() : null,
      })),
    });
  }),
);

rApi.get(
  "/cobertura",
  envolver(async (req, res) => {
    const { total } = await registrarEvento(
      `api-cobertura:${req.ip}`,
      DIEZ_MIN,
    );
    if (total > 60) return error(res, 429, MENSAJE_LIMITE);
    // Acepta código postal o colonia/localidad (con municipio y estado opcionales).
    const cp = String(
      req.query.cp ?? req.query.codigoPostal ?? req.query.zip ?? "",
    ).trim();
    const colonia = normalizar(
      req.query.colonia ?? req.query.localidad ?? req.query.locality,
    ).slice(0, 80);
    const municipio = normalizar(
      req.query.municipio ?? req.query.municipality,
    ).slice(0, 80);
    const estado = normalizar(req.query.estado ?? req.query.state).slice(0, 60);
    let filtro;
    if (cp) {
      if (!/^\d{5}$/.test(cp))
        return error(res, 400, "El código postal debe tener 5 dígitos.");
      filtro = { codigoPostal: cp };
    } else if (colonia.length >= 3) {
      filtro = {
        $and: [
          { coloniaNormal: { $regex: escaparRegex(colonia) } },
          ...(municipio
            ? [{ busqueda: { $regex: escaparRegex(municipio) } }]
            : []),
          ...(estado ? [{ busqueda: { $regex: escaparRegex(estado) } }] : []),
        ],
      };
    } else {
      return error(
        res,
        400,
        "Indica un código postal de 5 dígitos o al menos 3 letras de la colonia o localidad.",
      );
    }
    const zonas = await col("cobertura")
      .find({ ...filtro, activo: true })
      .project({
        _id: 0,
        codigoPostal: 1,
        colonia: 1,
        municipio: 1,
        entidad: 1,
        disponible: 1,
      })
      .sort({ colonia: 1 })
      .limit(20)
      .toArray();
    res.json({
      success: true,
      data: {
        disponible: zonas.some((z) => z.disponible),
        zonas: zonas.map((z) => ({
          codigoPostal: z.codigoPostal,
          colonia: z.colonia,
          municipio: z.municipio,
          estado: z.entidad,
          disponible: Boolean(z.disponible),
        })),
      },
    });
  }),
);

/** Zonas con ubicación para dibujar el mapa de cobertura del sitio (sin datos internos). */
rApi.get(
  "/cobertura/mapa",
  envolver(async (req, res) => {
    const { total } = await registrarEvento(
      `api-cobertura:${req.ip}`,
      DIEZ_MIN,
    );
    if (total > 60) return error(res, 429, MENSAJE_LIMITE);
    const zonas = await col("cobertura")
      .find({
        activo: true,
        lat: { $type: "number" },
        lng: { $type: "number" },
      })
      .project({
        _id: 0,
        codigoPostal: 1,
        colonia: 1,
        municipio: 1,
        entidad: 1,
        disponible: 1,
        lat: 1,
        lng: 1,
        radio: 1,
      })
      .limit(2000)
      .toArray();
    return res.json({
      success: true,
      data: zonas.map((z) => ({
        colonia: z.colonia,
        municipio: z.municipio,
        estado: z.entidad,
        codigoPostal: z.codigoPostal,
        disponible: Boolean(z.disponible),
        lat: z.lat,
        lng: z.lng,
        radio: z.radio || 800,
      })),
    });
  }),
);

/**
 * Avisos en tiempo real para el sitio público: solo dice qué cambió
 * (planes, promociones o cobertura), nunca datos. Límite de conexiones por IP y en total.
 */
const flujosPorIp = new Map();
let flujosTotales = 0;
rApi.get("/eventos", (req, res) => {
  const ip = req.ip;
  const propios = flujosPorIp.get(ip) || 0;
  if (flujosTotales >= 500 || propios >= 4)
    return error(
      res,
      429,
      "Demasiadas conexiones abiertas. Intenta más tarde.",
    );
  flujosPorIp.set(ip, propios + 1);
  flujosTotales++;
  let quitar = () => {};
  abrirFlujo(req, res, {
    duracionMs: 10 * 60 * 1000,
    alCerrar: () => {
      quitar();
      flujosTotales--;
      const n = (flujosPorIp.get(ip) || 1) - 1;
      if (n <= 0) flujosPorIp.delete(ip);
      else flujosPorIp.set(ip, n);
    },
  });
  quitar = suscribir((ev) => {
    if (MODULOS_PUBLICOS.includes(ev.modulo))
      enviar(res, "catalogo", { modulo: ev.modulo });
  });
});

/**
 * El sitio público puede mandar los campos en español (nombre, telefono, colonia…)
 * o con los nombres que usa contratacion.js (name, phone, locality, packageId…).
 * Aquí se unifican antes de validar.
 */
function normalizarSolicitud(cuerpo) {
  const b =
    cuerpo && typeof cuerpo === "object" && !Array.isArray(cuerpo)
      ? cuerpo
      : {};
  return {
    nombre: b.nombre ?? b.name,
    telefono: b.telefono ?? b.phone,
    correo: b.correo ?? b.email,
    codigoPostal: b.codigoPostal ?? b.postalCode,
    estado: b.estado ?? b.state,
    municipio: b.municipio ?? b.municipality,
    colonia: b.colonia ?? b.locality,
    direccion: b.direccion ?? b.street,
    plan: b.plan ?? b.packageId,
    comentarios: b.comentarios ?? b.comments,
    consentimiento: b.consentimiento ?? b.consent,
    versionAviso: b.versionAviso ?? b.consentVersion,
  };
}

const esquemaSolicitud = E.z.object({
  nombre: E.texto(2, 120, "El nombre"),
  telefono: E.telefono(),
  correo: E.correoOpcional(),
  codigoPostal: E.codigoPostal(),
  estado: E.textoOpcional(60, "El estado"),
  municipio: E.textoOpcional(120, "El municipio"),
  colonia: E.texto(2, 120, "La colonia o localidad"),
  direccion: E.textoOpcional(300, "La dirección"),
  plan: E.cadena(
    (s) =>
      s
        .max(40)
        .refine(
          (v) => !v || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v),
          "El plan no es válido.",
        ),
    (v) => E.limpio(v).toLowerCase(),
  ),
  comentarios: E.textoOpcional(500, "Los comentarios"),
  consentimiento: E.z.preprocess(
    (v) => v === true || v === "true" || v === "on",
    E.z.boolean(),
  ),
  versionAviso: E.cadena((s) =>
    s
      .max(60)
      .refine(
        (v) => !v || /^[\w.-]+$/.test(v),
        "La versión del aviso no es válida.",
      ),
  ),
});

rApi.post(
  "/solicitudes",
  envolver(async (req, res) => {
    const ip = req.ip;
    const intentos = await registrarEvento(`api-sol-intento:${ip}`, UNA_HORA);
    if (intentos.total > 20) return error(res, 429, MENSAJE_LIMITE);
    if (!req.is("application/json"))
      return error(res, 415, "Envía los datos en formato JSON.");
    const v = esquemaSolicitud.safeParse(normalizarSolicitud(req.body));
    if (!v.success) return error(res, 400, v.error.issues[0].message);
    const d = v.data;
    if (
      d.plan &&
      !(await col("planes").findOne(
        { clave: d.plan, activo: true, publicado: true },
        { projection: { _id: 1 } },
      ))
    ) {
      return error(res, 400, "El plan elegido no está disponible.");
    }
    // Reserva de cupo: máximo 5 solicitudes válidas por hora por IP.
    const valida = await registrarEvento(`api-sol-valida:${ip}`, UNA_HORA);
    if (valida.total > 5) {
      await quitarEvento(valida.id);
      return error(res, 429, MENSAJE_LIMITE);
    }
    const folio = await siguienteFolio("SOL");
    const ahora = new Date();
    await col("solicitudes").insertOne({
      folio,
      estado: "recibida",
      origen: "web",
      nombre: d.nombre,
      telefono: d.telefono,
      correo: d.correo,
      codigoPostal: d.codigoPostal,
      entidad: d.estado,
      municipio: d.municipio,
      colonia: d.colonia,
      direccion: d.direccion,
      planClave: d.plan,
      comentarios: d.comentarios,
      avisoAceptado: d.consentimiento,
      avisoVersion: d.versionAviso,
      busqueda: textoBusqueda(
        folio,
        d.nombre,
        d.telefono,
        d.colonia,
        d.municipio,
        d.estado,
        d.codigoPostal,
      ),
      creado: ahora,
      actualizado: ahora,
    });
    await auditar({
      accion: "solicitud.alta",
      detalle: { folio, origen: "web" },
    });
    emitir("solicitudes", { folio }); // las pantallas abiertas se actualizan solas
    // "id" lo usa contratacion.js del sitio para confirmar el registro; "data" queda para otros usos.
    return res.status(201).json({
      success: true,
      id: folio,
      data: {
        folio,
        mensaje: "Recibimos tu solicitud. Te contactaremos pronto.",
      },
    });
  }),
);

rApi.use((req, res) => error(res, 404, "Ruta no encontrada."));

// eslint-disable-next-line no-unused-vars
rApi.use((err, req, res, next) => {
  if (err.type === "entity.too.large")
    return error(res, 413, "La solicitud es demasiado grande.");
  if (err.type === "entity.parse.failed")
    return error(res, 400, "El cuerpo de la solicitud no es JSON válido.");
  logger.error({ error: err.message, ruta: req.path }, "Error en la API");
  return error(res, 500, "Ocurrió un error. Intenta más tarde.");
});

/* ===================== Webhook de WhatsApp ===================== */
const rWebhook = express.Router();

rWebhook.get("/", (req, res) => {
  const { verifyToken } = obtenerConfig().wa;
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const reto = req.query["hub.challenge"];
  if (
    modo === "subscribe" &&
    verifyToken &&
    typeof token === "string" &&
    igualSeguro(token, verifyToken) &&
    typeof reto === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(reto)
  ) {
    return res.status(200).type("text/plain").send(reto);
  }
  return res.sendStatus(403);
});

async function procesarWebhook(datos) {
  for (const entrada of datos?.entry || []) {
    for (const cambio of entrada?.changes || []) {
      const valor = cambio?.value || {};
      for (const st of valor.statuses || []) {
        if (typeof st.id === "string") {
          await col("whatsapp_envios").updateOne(
            { mensajeId: st.id },
            {
              $set: {
                estadoEntrega: String(st.status || "").slice(0, 20),
                estadoEntregaFecha: new Date(),
              },
            },
          );
        }
      }
      const nombrePerfil = valor.contacts?.[0]?.profile?.name || "";
      for (const m of valor.messages || []) {
        if (typeof m.id !== "string") continue;
        try {
          await col("whatsapp_entrantes").insertOne({
            waId: m.id,
            de: String(m.from || "").slice(0, 20),
            tipo: String(m.type || "").slice(0, 20),
            texto:
              m.type === "text"
                ? String(m.text?.body || "").slice(0, 1000)
                : "",
            recibido: new Date(),
          });
        } catch (e) {
          if (e.code === 11000) continue; // Meta puede reenviar el mismo mensaje: no se contesta dos veces
          throw e;
        }
        // El chatbot contesta aparte, para responderle a Meta de inmediato.
        setImmediate(() => {
          recibirMensaje({
            waId: m.from,
            tipo: m.type,
            texto: m.type === "text" ? String(m.text?.body || "") : "",
            nombrePerfil,
          }).catch((e) =>
            logger.error({ error: e.message }, "Error en el chatbot"),
          );
        });
      }
    }
  }
}

rWebhook.post(
  "/",
  express.raw({ type: () => true, limit: "1mb" }),
  envolver(async (req, res) => {
    // Firma HMAC SHA-256 sobre el cuerpo crudo. Si no coincide: 401 y no se procesa nada.
    if (
      !verificarFirma(
        req.body,
        req.get("X-Hub-Signature-256"),
        obtenerConfig().wa.appSecret,
      )
    ) {
      logger.warn("Webhook de WhatsApp con firma inválida");
      return res.sendStatus(401);
    }
    let datos;
    try {
      datos = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }
    await procesarWebhook(datos);
    return res.sendStatus(200);
  }),
);

/* ===================== Salud ===================== */
const rSalud = express.Router();

rSalud.get("/salud", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const origen = req.get("Origin");
  if (origen && obtenerConfig().sitioOrigenes.includes(origen)) {
    res.set("Access-Control-Allow-Origin", origen);
    res.vary("Origin");
  }
  const hora = new Date().toISOString();
  try {
    await Promise.race([
      db().command({ ping: 1 }),
      new Promise((_, mal) => {
        setTimeout(() => mal(new Error("tiempo agotado")), 3000).unref();
      }),
    ]);
    res.json({ estado: "ok", mongodb: "ok", hora });
  } catch {
    res.status(503).json({ estado: "error", mongodb: "sin conexión", hora });
  }
});

module.exports = { rApi, rWebhook, rSalud };
