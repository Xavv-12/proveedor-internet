"use strict";
const { formatear } = require("./dinero");
const {
  formatearFecha,
  formatearFechaHora,
  formatearUTC,
} = require("./fechas");
const { formatearTelefono } = require("./telefono");
const { capital } = require("./util");

const TONOS = {
  activo: "verde",
  suspendido: "ambar",
  cancelado: "gris",
  abierta: "rojo",
  "en proceso": "azul",
  "en espera": "ambar",
  resuelta: "verde",
  cerrada: "gris",
  programada: "azul",
  realizada: "verde",
  "no realizada": "ambar",
  cancelada: "gris",
  PENDIENTE: "azul",
  PARCIAL: "ambar",
  VENCIDA: "rojo",
  PAGADA: "verde",
  CANCELADA: "gris",
  validado: "verde",
  "por validar": "ambar",
  rechazado: "rojo",
  recibida: "azul",
  "cobertura validada": "azul",
  contactada: "ambar",
  agendada: "ambar",
  contratada: "verde",
  descartada: "gris",
  coincide: "verde",
  "sin coincidencia": "ambar",
};
const TEXTOS = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Parcial",
  VENCIDA: "Vencida",
  PAGADA: "Pagada",
  CANCELADA: "Cancelada",
};

function insignia(texto, tono = "gris") {
  return { texto, tono };
}

function insigniaEstado(estado) {
  return {
    texto: TEXTOS[estado] || capital(estado),
    tono: TONOS[estado] || "gris",
  };
}

function opciones(lista, vacio) {
  return [
    ...(vacio ? [{ valor: "", texto: vacio }] : []),
    ...lista.map((v) =>
      typeof v === "string" ? { valor: v, texto: TEXTOS[v] || capital(v) } : v,
    ),
  ];
}

function filtroSelect(nombre, etiqueta, valor, opcs) {
  return {
    tipo: "select",
    nombre,
    etiqueta,
    valor: valor ?? "",
    opciones: opcs,
  };
}

function llenar(campos, valores = {}) {
  return campos.map((c) => {
    let valor = valores[c.nombre];
    if (valor === undefined || valor === null)
      valor =
        c.valor !== undefined ? c.valor : c.tipo === "checkbox" ? false : "";
    if (Array.isArray(valor)) valor = valor[0];
    return { ...c, valor };
  });
}

function renderLista(res, o) {
  res.render("lista", {
    titulo: o.titulo,
    accionBusqueda: o.accionBusqueda ?? null,
    q: o.q ?? "",
    filtros: o.filtros ?? [],
    enlaceNuevo: o.enlaceNuevo ?? null,
    textoNuevo: o.textoNuevo ?? "Nuevo",
    filas: o.filas,
    nav: o.nav,
    vacio: o.vacio ?? "No hay registros que coincidan.",
    bloquesSuperiores: o.bloquesSuperiores ?? [],
    volver: o.volver ?? null,
    ocultos: o.ocultos ?? [],
  });
}

function renderDetalle(res, o) {
  res.render("detalle", {
    titulo: o.titulo,
    subtitulo: o.subtitulo ?? "",
    volver: o.volver ?? null,
    bloques: o.bloques,
  });
}

function renderFormulario(res, o, estado = 200) {
  res.status(estado).render("formulario", {
    titulo: o.titulo,
    volver: o.cancelar ?? null,
    f: {
      accion: o.accion,
      campos: o.campos,
      errores: o.errores ?? {},
      boton: o.boton ?? "Guardar",
      cancelar: o.cancelar ?? null,
      nota: o.nota ?? null,
      multipart: false,
    },
  });
}

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Construye atributos HTML escapados. Omite null, undefined y false. */
function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== "")
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
    .join(" ");
}

const ayudasVista = {
  fmtDinero: formatear,
  fmtFecha: formatearFecha,
  fmtFechaHora: formatearFechaHora,
  fmtUTC: formatearUTC,
  fmtTel: formatearTelefono,
  attrs,
};

module.exports = {
  insignia,
  insigniaEstado,
  opciones,
  filtroSelect,
  llenar,
  renderLista,
  renderDetalle,
  renderFormulario,
  attrs,
  ayudasVista,
};
