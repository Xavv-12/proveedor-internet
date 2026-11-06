"use strict";
/**
 * CHATBOT DE WHATSAPP
 * Contesta solo, las 24 horas, a quien escriba al WhatsApp del negocio:
 *   1 Paquetes y precios · 2 Cobertura · 3 Saldo y pagos · 4 Reportar falla · 5 Hablar con un asesor
 * - El saldo solo se da a quien escribe desde el teléfono registrado en el contrato
 *   (WhatsApp ya verificó ese número).
 * - "Hablar con un asesor" deja la conversación al personal (Conversaciones de WhatsApp)
 *   y el bot deja de contestar a esa persona durante 12 horas o hasta que se la regresen.
 * Los textos están en TEXTOS: puedes cambiarlos aquí.
 */
const { col, enTransaccion } = require("../db");
const { obtenerConfig } = require("../config");
const { normalizar, escaparRegex, textoBusqueda } = require("../lib/util");
const { normalizarTelefono } = require("../lib/telefono");
const { formatear } = require("../lib/dinero");
const { formatearFecha, periodoTexto } = require("../lib/fechas");
const { siguienteFolio } = require("../lib/folios");
const { registrarEvento } = require("../lib/limites");
const { emitir } = require("../lib/eventos");
const { auditar } = require("../lib/auditoria");
const { enviarTextoWhatsApp } = require("../lib/whatsapp");
const { urlPortal } = require("./folio-whatsapp");
const { marcarVencidas } = require("./cobranza");
const { agregarHistorial } = require("./incidencias");
const logger = require("../logger");

const EMPRESA = "Proveedor de Internet";
const MINUTOS_INACTIVIDAD = 30; // después, la conversación vuelve al menú
const HORAS_ASESOR = 12; // tiempo que el bot guarda silencio tras pedir un asesor
const MAX_RESPUESTAS_HORA = 40; // protección contra ciclos o abuso

function sitio() {
  const cfg = obtenerConfig();
  return (
    (cfg.sitioOrigenes || []).find((o) => o.startsWith("https://")) ||
    cfg.sitioOrigenes?.[0] ||
    ""
  );
}

const TEXTOS = {
  menu: () =>
    `¡Hola! Soy el asistente virtual de ${EMPRESA} 🤖\nEscribe el *número* de lo que necesitas:\n\n` +
    "1️⃣ Paquetes y precios\n2️⃣ Consultar cobertura\n3️⃣ Mi saldo y pagos\n4️⃣ Reportar una falla\n5️⃣ Hablar con un asesor\n\n" +
    "Escribe *menú* en cualquier momento para volver aquí.",
  noEntendi:
    "🤔 No entendí tu mensaje. Escribe un número del 1 al 5, o *menú* para ver las opciones.",
  soloTexto:
    "Por ahora solo puedo leer mensajes de texto 🙏. Escribe el número de la opción que necesitas, o *5* para hablar con un asesor.",
  pedirCobertura:
    "📍 Escribe tu *código postal* (5 dígitos) o el nombre de tu *colonia* y te digo si llegamos.",
  pedirFalla:
    '🛠️ Cuéntanos brevemente qué falla tiene tu servicio (por ejemplo: "sin internet desde la mañana").',
  sinContrato:
    "No encontramos un contrato registrado con este número de WhatsApp. " +
    "Si contrataste con otro número, escríbenos desde ese número o elige *5* para hablar con un asesor.",
  asesor:
    "👩‍💻 Listo, un asesor te contestará por este chat lo antes posible. " +
    "Mientras tanto el asistente automático queda en pausa. Escribe *menú* si quieres volver a usarlo.",
  despedida: "\n\nEscribe *menú* para ver más opciones.",
};

/* ---------- Detección de la opción elegida ---------- */
function opcionElegida(t) {
  if (/^1\b|paquete|plan|precio|velocidad|megas/.test(t)) return 1;
  if (/^2\b|cobertura|llegan|zona|codigo postal|mi colonia/.test(t)) return 2;
  if (/^3\b|saldo|pago|pagar|debo|adeudo|mensualidad|recibo/.test(t)) return 3;
  if (
    /^4\b|falla|sin internet|no tengo internet|no funciona|no hay internet|lento|intermitente|soporte/.test(
      t,
    )
  )
    return 4;
  if (/^5\b|asesor|humano|persona|agente|ejecutivo|hablar con/.test(t))
    return 5;
  return 0;
}
const esSaludoOMenu = (t) =>
  !t || /^(0|menu|inicio|hola|buen[oa]s|que tal|hey|ola)\b/.test(t);

/* ---------- Registro de la conversación ---------- */
async function registrarChat(telefono, direccion, texto, autor, extra = {}) {
  await col("whatsapp_chat").insertOne({
    telefono,
    direccion,
    texto: String(texto || "").slice(0, 4000),
    autor,
    fecha: new Date(),
    ...extra,
  });
}

async function contratosDelTelefono(telefono) {
  const clientes = await col("clientes")
    .find({ telefono, activo: true })
    .project({ _id: 1, nombre: 1 })
    .toArray();
  if (!clientes.length) return [];
  return col("contratos")
    .find({
      clienteId: { $in: clientes.map((c) => c._id) },
      estado: { $ne: "cancelado" },
    })
    .sort({ creado: 1 })
    .limit(10)
    .toArray();
}

/* ---------- Respuestas ---------- */
async function respuestaPaquetes() {
  const planes = await col("planes")
    .find({ activo: true, publicado: true, velocidadBajada: { $gt: 0 } })
    .sort({ precio: 1 })
    .toArray();
  if (!planes.length)
    return "Por ahora no tenemos paquetes publicados. Elige *5* para hablar con un asesor.";
  const lista = planes
    .map(
      (p) =>
        `• *${p.nombre}*: ${p.velocidadBajada} Mbps — ${formatear(p.precio)} al mes`,
    )
    .join("\n");
  const enlace = sitio() ? `\n\nPara contratar: ${sitio()}/contacto.html` : "";
  return `📶 Nuestros paquetes:\n\n${lista}${enlace}\nO elige *2* para revisar si llegamos a tu zona.`;
}

async function respuestaCobertura(texto) {
  const t = normalizar(texto);
  const cp = (String(texto).match(/\b\d{5}\b/) || [])[0];
  let filtro;
  if (cp) filtro = { codigoPostal: cp };
  else if (t.length >= 3)
    filtro = { coloniaNormal: { $regex: escaparRegex(t) } };
  else
    return {
      texto:
        "Escribe tu código postal de 5 dígitos o al menos 3 letras de tu colonia.",
      listo: false,
    };
  const zonas = await col("cobertura")
    .find({ ...filtro, activo: true })
    .limit(5)
    .toArray();
  const contratar = sitio()
    ? ` Solicítalo aquí: ${sitio()}/contacto.html`
    : " Elige *5* para contratar con un asesor.";
  if (zonas.some((z) => z.disponible)) {
    const z = zonas.find((x) => x.disponible);
    return {
      texto: `✅ ¡Buenas noticias! Tenemos servicio en ${z.colonia}, ${z.municipio}. Un técnico confirmará la disponibilidad en tu domicilio.${contratar}`,
      listo: true,
    };
  }
  if (zonas.length)
    return {
      texto: `😔 Todavía no llegamos a ${zonas[0].colonia}. Elige *5* para dejar tus datos y te avisamos cuando haya servicio.`,
      listo: true,
    };
  return {
    texto:
      "No encontramos esa zona en nuestro catálogo. Elige *5* y un asesor la revisará por ti.",
    listo: true,
  };
}

async function respuestaSaldo(contrato) {
  await marcarVencidas();
  const abiertas = await col("mensualidades")
    .find({
      contratoId: contrato._id,
      estado: { $in: ["PENDIENTE", "PARCIAL", "VENCIDA"] },
    })
    .sort({ fechaLimite: 1 })
    .toArray();
  const vencidas = abiertas.filter((m) => m.estado === "VENCIDA");
  const saldoVencido = vencidas.reduce((s, m) => s + m.importe - m.pagado, 0);
  const proxima = abiertas.find((m) => m.estado !== "VENCIDA");
  const lineas = [`🧾 Contrato *${contrato.folio}* (${contrato.planNombre})`];
  lineas.push(
    vencidas.length
      ? `Saldo vencido: *${formatear(saldoVencido)}* (${vencidas.length} ${vencidas.length === 1 ? "mensualidad" : "mensualidades"}).`
      : "Saldo vencido: *$0.00*. ¡Estás al corriente! 🙌",
  );
  if (proxima)
    lineas.push(
      `Próximo pago: ${formatear(proxima.importe - proxima.pagado)} de ${periodoTexto(proxima.periodo)}, vence el ${formatearFecha(proxima.fechaLimite)}.`,
    );
  const portal = urlPortal();
  if (portal)
    lineas.push(
      `\nConsulta el detalle y envía tu comprobante en ${portal} con tu folio y tu teléfono.`,
    );
  return lineas.join("\n");
}

async function crearIncidencia(contrato, telefono, descripcion, simulado) {
  const folio = await siguienteFolio("INC");
  const ahora = new Date();
  const doc = {
    folio,
    contratoId: contrato._id,
    contratoFolio: contrato.folio,
    clienteNombre: contrato.clienteNombre,
    direccion: contrato.direccionInstalacion,
    titulo: simulado
      ? "[Prueba] Falla reportada por WhatsApp"
      : "Falla reportada por WhatsApp",
    descripcion: String(descripcion).slice(0, 2000),
    prioridad: "media",
    estado: "abierta",
    origen: "whatsapp",
    creada: ahora,
    actualizada: ahora,
    busqueda: textoBusqueda(
      folio,
      "whatsapp falla",
      contrato.folio,
      contrato.clienteNombre,
    ),
  };
  const autor = { _id: null, nombre: `Cliente por WhatsApp (${telefono})` };
  await enTransaccion(async (s) => {
    await col("incidencias").insertOne(doc, { session: s });
    await agregarHistorial(
      doc._id,
      {
        tipo: "alta",
        texto: `Reportada por WhatsApp: ${doc.descripcion}`,
        a: "abierta",
      },
      autor,
      s,
    );
  });
  await auditar({
    accion: "incidencia.alta",
    detalle: { folio, contrato: contrato.folio, origen: "whatsapp" },
  });
  emitir("incidencias");
  return folio;
}

function elegirDeLista(t, contratos) {
  const n = Number((t.match(/^\d+/) || [])[0]);
  if (n >= 1 && n <= contratos.length) return contratos[n - 1];
  const porFolio = contratos.find((c) => t.includes(c.folio.toLowerCase()));
  return porFolio || null;
}
const listaContratos = (contratos) =>
  contratos.map((c, i) => `${i + 1}) ${c.folio} · ${c.planNombre}`).join("\n");

/* ---------- Punto de entrada ---------- */
/**
 * Atiende un mensaje que llegó al WhatsApp del negocio.
 * @param {object} m  { waId, tipo, texto, nombrePerfil, simulado }
 */
async function recibirMensaje({
  waId,
  tipo = "text",
  texto = "",
  nombrePerfil = "",
  simulado = false,
}) {
  const telefono = normalizarTelefono(
    `+${String(waId || "").replace(/\D/g, "")}`,
  );
  if (!telefono) return;
  const ahora = new Date();
  const esTexto = tipo === "text";
  await registrarChat(
    telefono,
    "entrante",
    esTexto ? texto : `[${tipo}]`,
    "cliente",
    { simulado },
  );

  const antes = await col("whatsapp_conversaciones").findOneAndUpdate(
    { _id: telefono },
    {
      $set: {
        waId: String(waId),
        ultimoEntrante: ahora,
        actualizado: ahora,
        ultimoTexto: esTexto ? String(texto).slice(0, 200) : `[${tipo}]`,
        simulado,
      },
      $setOnInsert: { creado: ahora, estado: "menu" },
    },
    { upsert: true, returnDocument: "before" },
  );
  if (nombrePerfil)
    await col("whatsapp_conversaciones").updateOne(
      { _id: telefono },
      { $set: { nombrePerfil: String(nombrePerfil).slice(0, 80) } },
    );
  emitir("mensajes");

  const conv = antes || { estado: "menu" };
  const t = normalizar(texto);

  // Con asesor: el bot no contesta, salvo que la persona pida volver al menú o pasen 12 horas.
  if (
    conv.estado === "asesor" &&
    conv.asesorDesde &&
    ahora - conv.asesorDesde < HORAS_ASESOR * 3600e3 &&
    !/^(menu|0)\b/.test(t)
  )
    return;

  const { total } = await registrarEvento(`chatbot:${telefono}`, 3600e3);
  if (total > MAX_RESPUESTAS_HORA) return;

  const responder = async (mensaje) => {
    let mensajeId = null;
    if (!simulado) {
      try {
        mensajeId = await enviarTextoWhatsApp(waId, mensaje);
      } catch (e) {
        logger.warn(
          { error: e.message, detalle: e.detalle },
          "El chatbot no pudo responder por WhatsApp",
        );
        await registrarChat(telefono, "saliente", mensaje, "bot", {
          simulado,
          error: e.detalle || e.message,
        });
        return;
      }
    }
    await registrarChat(telefono, "saliente", mensaje, "bot", {
      simulado,
      mensajeId,
    });
  };
  const cambiarEstado = (estado, datos = {}) =>
    col("whatsapp_conversaciones").updateOne(
      { _id: telefono },
      { $set: { estado, datos, actualizado: new Date() } },
    );

  const inactiva =
    conv.actualizado && ahora - conv.actualizado > MINUTOS_INACTIVIDAD * 60e3;
  const estado =
    inactiva || conv.estado === "asesor" ? "menu" : conv.estado || "menu";
  const datos = conv.datos || {};

  if (!esTexto) return responder(TEXTOS.soloTexto);
  if (esSaludoOMenu(t) && estado !== "esperando_falla") {
    await cambiarEstado("menu");
    return responder(TEXTOS.menu());
  }

  /* --- Pasos que esperan una respuesta concreta --- */
  if (estado === "esperando_cobertura") {
    const r = await respuestaCobertura(texto);
    if (r.listo) await cambiarEstado("menu");
    return responder(r.texto + (r.listo ? TEXTOS.despedida : ""));
  }
  if (estado === "eligiendo_contrato") {
    const contratos = await col("contratos")
      .find({ _id: { $in: datos.contratos || [] } })
      .sort({ creado: 1 })
      .toArray();
    const elegido = elegirDeLista(t, contratos);
    if (!elegido)
      return responder(
        `Escribe el número del contrato:\n${listaContratos(contratos)}`,
      );
    if (datos.para === "saldo") {
      await cambiarEstado("menu");
      return responder((await respuestaSaldo(elegido)) + TEXTOS.despedida);
    }
    await cambiarEstado("esperando_falla", { contrato: elegido._id });
    return responder(TEXTOS.pedirFalla);
  }
  if (estado === "esperando_falla") {
    if (/^(menu|0)\b/.test(t)) {
      await cambiarEstado("menu");
      return responder(TEXTOS.menu());
    }
    if (t.length < 4)
      return responder("Cuéntanos un poco más sobre la falla, por favor.");
    const contrato = await col("contratos").findOne({ _id: datos.contrato });
    if (!contrato) {
      await cambiarEstado("menu");
      return responder(TEXTOS.sinContrato);
    }
    const folio = await crearIncidencia(contrato, telefono, texto, simulado);
    await cambiarEstado("menu");
    return responder(
      `✅ Registramos tu reporte con el folio *${folio}*. Nuestro equipo de soporte lo revisará y te contactará. ${TEXTOS.despedida.trim()}`,
    );
  }

  /* --- Menú principal --- */
  const opcion = opcionElegida(t);
  if (opcion === 1) {
    await cambiarEstado("menu");
    return responder((await respuestaPaquetes()) + TEXTOS.despedida);
  }
  if (opcion === 2) {
    // Si ya mandó su CP junto con la palabra "cobertura", se responde de una vez.
    if (/\b\d{5}\b/.test(texto)) {
      const r = await respuestaCobertura(texto);
      return responder(r.texto + TEXTOS.despedida);
    }
    await cambiarEstado("esperando_cobertura");
    return responder(TEXTOS.pedirCobertura);
  }
  if (opcion === 3 || opcion === 4) {
    const contratos = await contratosDelTelefono(telefono);
    if (!contratos.length) return responder(TEXTOS.sinContrato);
    if (contratos.length > 1) {
      await cambiarEstado("eligiendo_contrato", {
        para: opcion === 3 ? "saldo" : "falla",
        contratos: contratos.map((c) => c._id),
      });
      return responder(
        `Tienes varios contratos. Escribe el número del que quieres ${opcion === 3 ? "consultar" : "reportar"}:\n${listaContratos(contratos)}`,
      );
    }
    if (opcion === 3) {
      await cambiarEstado("menu");
      return responder((await respuestaSaldo(contratos[0])) + TEXTOS.despedida);
    }
    await cambiarEstado("esperando_falla", { contrato: contratos[0]._id });
    return responder(TEXTOS.pedirFalla);
  }
  if (opcion === 5) {
    await col("whatsapp_conversaciones").updateOne(
      { _id: telefono },
      { $set: { estado: "asesor", asesorDesde: new Date(), datos: {} } },
    );
    emitir("mensajes");
    return responder(TEXTOS.asesor);
  }
  return responder(TEXTOS.noEntendi);
}

module.exports = {
  recibirMensaje,
  registrarChat,
  TEXTOS,
  opcionElegida,
  HORAS_ASESOR,
};
