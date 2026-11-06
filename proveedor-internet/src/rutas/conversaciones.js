"use strict";
/**
 * CONVERSACIONES DE WHATSAPP
 * - Lista de chats que llegan al WhatsApp del negocio (los atiende el chatbot).
 * - Los que piden "hablar con un asesor" aparecen primero para que el personal conteste.
 * - Simulador: prueba el chatbot desde aquí, sin WhatsApp configurado (no envía mensajes reales).
 */
const express = require("express");
const E = require("../lib/esquemas");
const { col } = require("../db");
const { permitir } = require("../middleware/sesion");
const { envolver, paginacion, navegacion, avisar } = require("../lib/util");
const { normalizarTelefono, formatearTelefono } = require("../lib/telefono");
const { formatearFechaHora } = require("../lib/fechas");
const { auditarReq } = require("../lib/auditoria");
const { emitir } = require("../lib/eventos");
const { whatsappConfigurado, enviarTextoWhatsApp } = require("../lib/whatsapp");
const {
  renderLista,
  renderDetalle,
  llenar,
  insignia,
  filtroSelect,
} = require("../lib/vistas");
const {
  recibirMensaje,
  registrarChat,
  HORAS_ASESOR,
} = require("../servicios/chatbot");

const r = express.Router();
const leer = permitir("mensajes", "leer");
const escribir = permitir("mensajes", "escribir");
const VEINTICUATRO_H = 24 * 3600e3;

const insigniaEstado = (c) => {
  if (
    c.estado === "asesor" &&
    c.asesorDesde &&
    Date.now() - c.asesorDesde < HORAS_ASESOR * 3600e3
  )
    return insignia("Espera asesor", "rojo");
  return insignia("Chatbot", "azul");
};

function formularioSimulador(telefono = "") {
  return {
    tipo: "formulario",
    titulo: "Probar el chatbot (simulador)",
    accion: "/conversaciones-whatsapp/simular",
    campos: llenar(
      [
        {
          nombre: "telefono",
          etiqueta: "Escribir como el teléfono",
          tipo: "tel",
          requerido: true,
          inputmode: "tel",
          ayuda:
            "Usa el teléfono de un cliente para probar saldo y fallas (ej. 5500000001).",
        },
        {
          nombre: "texto",
          etiqueta: "Mensaje",
          tipo: "text",
          requerido: true,
          ayuda: "Prueba con: hola · 1 · 2 · 3 · 4 · 5 · menú",
        },
      ],
      { telefono },
    ),
    boton: "Enviar como cliente",
    nota: "El simulador no envía WhatsApp reales, pero sí registra lo que haría el bot (por ejemplo, un reporte de falla queda como incidencia marcada [Prueba]).",
  };
}

r.get(
  "/",
  leer,
  envolver(async (req, res) => {
    const vista = ["asesor", "todas"].includes(req.query.vista)
      ? req.query.vista
      : "todas";
    const q = String(req.query.q ?? "")
      .slice(0, 30)
      .replace(/\D/g, "");
    const filtro = {};
    if (vista === "asesor")
      Object.assign(filtro, {
        estado: "asesor",
        asesorDesde: { $gt: new Date(Date.now() - HORAS_ASESOR * 3600e3) },
      });
    if (q) filtro._id = { $regex: q };
    const { pagina, salto, limite } = paginacion(req);
    const [convs, total] = await Promise.all([
      col("whatsapp_conversaciones")
        .find(filtro)
        .sort({ estado: 1, actualizado: -1 })
        .skip(salto)
        .limit(limite)
        .toArray(),
      col("whatsapp_conversaciones").countDocuments(filtro),
    ]);
    const clientes = await col("clientes")
      .find({ telefono: { $in: convs.map((c) => c._id) } })
      .project({ telefono: 1, nombre: 1 })
      .toArray();
    const nombrePorTel = new Map(clientes.map((c) => [c.telefono, c.nombre]));
    renderLista(res, {
      titulo: "Conversaciones de WhatsApp",
      accionBusqueda: "/conversaciones-whatsapp",
      q: String(req.query.q ?? ""),
      filtros: [
        filtroSelect("vista", "Mostrar", vista, [
          { valor: "todas", texto: "Todas" },
          { valor: "asesor", texto: "Esperan asesor" },
        ]),
      ],
      bloquesSuperiores: [
        ...(whatsappConfigurado()
          ? []
          : [
              {
                tipo: "datos",
                titulo: "WhatsApp aún no está conectado",
                filas: [
                  {
                    etiqueta: "Qué falta",
                    valor:
                      "Publicar la app en Render y configurar WA_TOKEN, WA_PHONE_ID, WA_APP_SECRET y WA_VERIFY_TOKEN. Mientras tanto, prueba el chatbot con el simulador.",
                  },
                ],
              },
            ]),
        formularioSimulador(),
      ],
      filas: convs.map((c) => ({
        enlace: `/conversaciones-whatsapp/${c._id}`,
        titulo:
          nombrePorTel.get(c._id) || c.nombrePerfil || formatearTelefono(c._id),
        subtitulo: `${formatearTelefono(c._id)} · "${c.ultimoTexto || ""}"`,
        insignia: c.simulado ? insignia("Prueba", "gris") : insigniaEstado(c),
        campos: [
          {
            etiqueta: "Último mensaje",
            valor: formatearFechaHora(c.ultimoEntrante),
          },
          ...(c.simulado
            ? []
            : [{ etiqueta: "Estado", valor: insigniaEstado(c).texto }]),
        ],
      })),
      nav: navegacion(req, total, pagina),
      vacio:
        "Aún no hay conversaciones. Cuando alguien escriba al WhatsApp del negocio aparecerá aquí.",
    });
  }),
);

r.post(
  "/simular",
  escribir,
  envolver(async (req, res) => {
    const telefono = normalizarTelefono(String(req.body.telefono || ""));
    const texto = String(req.body.texto || "")
      .trim()
      .slice(0, 1000);
    if (!telefono || !texto) {
      avisar(req, "Escribe un teléfono de 10 dígitos y un mensaje.", "error");
      return res.redirect("/conversaciones-whatsapp");
    }
    await recibirMensaje({
      waId: `52${telefono}`,
      tipo: "text",
      texto,
      simulado: true,
    });
    return res.redirect(`/conversaciones-whatsapp/${telefono}`);
  }),
);

async function buscar(req, next) {
  const tel = /^\d{10}$/.test(req.params.tel) ? req.params.tel : null;
  const c = tel
    ? await col("whatsapp_conversaciones").findOne({ _id: tel })
    : null;
  if (!c) next();
  return c;
}

r.get(
  "/:tel",
  leer,
  envolver(async (req, res, next) => {
    const c = await buscar(req, next);
    if (!c) return;
    const [mensajes, cliente] = await Promise.all([
      col("whatsapp_chat")
        .find({ telefono: c._id })
        .sort({ fecha: -1 })
        .limit(100)
        .toArray(),
      col("clientes").findOne(
        { telefono: c._id },
        { projection: { nombre: 1 } },
      ),
    ]);
    mensajes.reverse();
    const ventanaAbierta =
      c.ultimoEntrante && Date.now() - c.ultimoEntrante < VEINTICUATRO_H;
    const conAsesor = insigniaEstado(c).texto === "Espera asesor";
    const bloques = [
      {
        tipo: "datos",
        insignia: c.simulado ? insignia("Prueba", "gris") : insigniaEstado(c),
        filas: [
          { etiqueta: "Teléfono", valor: formatearTelefono(c._id) },
          {
            etiqueta: "Cliente",
            valor: cliente ? cliente.nombre : "No registrado",
            enlace: cliente ? `/clientes/${cliente._id}` : null,
          },
          { etiqueta: "Nombre en WhatsApp", valor: c.nombrePerfil || "—" },
          {
            etiqueta: "Último mensaje del cliente",
            valor: formatearFechaHora(c.ultimoEntrante),
          },
        ],
      },
      {
        tipo: "lista",
        titulo: "Conversación",
        vacio: "Sin mensajes.",
        elementos: mensajes.map((m) => ({
          titulo: m.texto,
          subtitulo: `${m.direccion === "entrante" ? "Cliente" : m.autor === "bot" ? "Chatbot" : m.autor} · ${formatearFechaHora(m.fecha)}${m.error ? ` · No se envió: ${m.error}` : ""}`,
          insignia:
            m.direccion === "entrante"
              ? insignia("Cliente", "gris")
              : m.autor === "bot"
                ? insignia("Chatbot", "azul")
                : insignia("Asesor", "verde"),
        })),
      },
    ];
    if (!c.simulado && whatsappConfigurado()) {
      bloques.push(
        ventanaAbierta
          ? {
              tipo: "formulario",
              titulo: "Responder como asesor",
              accion: `/conversaciones-whatsapp/${c._id}/responder`,
              campos: llenar([
                {
                  nombre: "texto",
                  etiqueta: "Mensaje",
                  tipo: "textarea",
                  requerido: true,
                  max: 2000,
                  filas: 3,
                },
              ]),
              boton: "Enviar por WhatsApp",
              nota: "Al responder, el chatbot queda en pausa con esta persona.",
            }
          : {
              tipo: "datos",
              titulo: "No se puede responder con texto libre",
              filas: [
                {
                  etiqueta: "Motivo",
                  valor:
                    "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas.",
                },
              ],
            },
      );
    }
    if (conAsesor) {
      bloques.push({
        tipo: "botones",
        botones: [
          {
            texto: "Regresar al chatbot",
            accion: `/conversaciones-whatsapp/${c._id}/bot`,
            estilo: "secundario",
          },
        ],
      });
    }
    if (c.simulado) bloques.push(formularioSimulador(c._id));
    renderDetalle(res, {
      titulo: cliente
        ? cliente.nombre
        : c.nombrePerfil || formatearTelefono(c._id),
      subtitulo: `WhatsApp ${formatearTelefono(c._id)}`,
      volver: "/conversaciones-whatsapp",
      bloques,
    });
  }),
);

r.post(
  "/:tel/responder",
  escribir,
  envolver(async (req, res, next) => {
    const c = await buscar(req, next);
    if (!c) return;
    const v = E.texto(1, 2000, "El mensaje").safeParse(req.body.texto);
    if (!v.success) {
      avisar(req, v.error.issues[0].message, "error");
    } else if (
      !c.ultimoEntrante ||
      Date.now() - c.ultimoEntrante >= VEINTICUATRO_H
    ) {
      avisar(
        req,
        "Pasaron más de 24 horas desde el último mensaje del cliente; WhatsApp no permite texto libre.",
        "error",
      );
    } else {
      try {
        const mensajeId = await enviarTextoWhatsApp(c.waId, v.data);
        await registrarChat(c._id, "saliente", v.data, req.usuario.nombre, {
          mensajeId,
          usuarioId: req.usuario._id,
        });
        await col("whatsapp_conversaciones").updateOne(
          { _id: c._id },
          {
            $set: {
              estado: "asesor",
              asesorDesde: new Date(),
              actualizado: new Date(),
            },
          },
        );
        await auditarReq(req, "whatsapp.respuesta", { telefono: c._id });
        emitir("mensajes");
        avisar(req, "Mensaje enviado.");
      } catch (e) {
        avisar(req, `No se pudo enviar: ${e.detalle || e.message}`, "error");
      }
    }
    return res.redirect(`/conversaciones-whatsapp/${c._id}`);
  }),
);

r.post(
  "/:tel/bot",
  escribir,
  envolver(async (req, res, next) => {
    const c = await buscar(req, next);
    if (!c) return;
    await col("whatsapp_conversaciones").updateOne(
      { _id: c._id },
      {
        $set: { estado: "menu", datos: {}, actualizado: new Date() },
        $unset: { asesorDesde: "" },
      },
    );
    emitir("mensajes");
    avisar(req, "El chatbot vuelve a atender esta conversación.");
    return res.redirect(`/conversaciones-whatsapp/${c._id}`);
  }),
);

module.exports = r;
