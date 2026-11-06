"use strict";
const E = require("../lib/esquemas");
const { col } = require("../db");
const { crearRecurso } = require("./recurso");
const { textoBusqueda } = require("../lib/util");
const { insignia, opciones } = require("../lib/vistas");
const { formatearFechaHora } = require("../lib/fechas");

const TIPOS = [
  { valor: "recordatorio_cobro", texto: "Recordatorio de cobro" },
  { valor: "folio", texto: "Envío del folio al contratar" },
  { valor: "aviso", texto: "Aviso general" },
];
const nombreTipo = (t) => (TIPOS.find((x) => x.valor === t) || {}).texto || t;
const NOTAS = {
  recordatorio_cobro:
    "Se usa el recordatorio de cobro activo más reciente. Nunca se envía más de un recordatorio al mismo teléfono cada 20 horas.",
  folio:
    "Se usa el mensaje de envío de folio activo más reciente. Se manda al crear el contrato o con el botón del contrato (máximo 3 veces al día por contrato).",
  aviso: "Texto para avisos generales.",
};

module.exports = crearRecurso({
  ruta: "/mensajes-y-avisos",
  coleccion: "mensajes",
  modulo: "mensajes",
  titulo: "Mensajes y avisos",
  singular: "mensaje",
  textoNuevo: "Nuevo mensaje",
  textoGuardado: "Mensaje guardado.",
  desactivable: true,
  auditoria: "mensaje",
  vacio:
    "No hay mensajes. Crea el texto del recordatorio de cobro o del envío del folio.",
  valoresIniciales: async () => ({
    idioma: "es_MX",
    tipo: "recordatorio_cobro",
  }),
  campos: async () => [
    {
      nombre: "nombre",
      etiqueta: "Nombre interno",
      tipo: "text",
      requerido: true,
    },
    {
      nombre: "tipo",
      etiqueta: "Tipo",
      tipo: "select",
      requerido: true,
      opciones: opciones(TIPOS),
    },
    {
      nombre: "texto",
      etiqueta: "Texto del mensaje",
      tipo: "textarea",
      requerido: true,
      max: 1000,
      filas: 5,
      ayuda:
        "Recordatorio de cobro: usa {nombre}, {saldo} y {folio}. Envío del folio: usa {nombre}, {folio} y {portal}.",
    },
    {
      nombre: "plantillaWhatsApp",
      etiqueta: "Plantilla aprobada en WhatsApp",
      tipo: "text",
      autocapitalize: "none",
      ayuda:
        "Opcional. Fuera de la ventana de 24 horas, WhatsApp solo entrega plantillas aprobadas. Variables en orden: recordatorio = nombre, saldo, folio; envío del folio = nombre, folio, portal.",
    },
    {
      nombre: "idioma",
      etiqueta: "Idioma de la plantilla",
      tipo: "text",
      autocapitalize: "none",
    },
  ],
  esquema: () =>
    E.z.object({
      nombre: E.texto(3, 80, "El nombre"),
      tipo: E.opcion(
        TIPOS.map((t) => t.valor),
        "tipo",
      ),
      texto: E.texto(5, 1000, "El texto"),
      plantillaWhatsApp: E.cadena((s) =>
        s
          .max(512)
          .refine(
            (v) => !v || /^[a-z0-9_]+$/.test(v),
            "Usa el nombre exacto: minúsculas, números y guion bajo.",
          ),
      ),
      idioma: E.cadena((s) =>
        s.regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Usa un código como es_MX."),
      ),
    }),
  aDocumento: async (d) => ({
    ...d,
    busqueda: textoBusqueda(d.nombre, d.tipo, d.plantillaWhatsApp),
  }),
  aFormulario: (doc) => ({
    nombre: doc.nombre,
    tipo: doc.tipo,
    texto: doc.texto,
    plantillaWhatsApp: doc.plantillaWhatsApp || "",
    idioma: doc.idioma || "es_MX",
  }),
  resumen: (doc) => ({ nombre: doc.nombre }),
  fila: (doc) => ({
    enlace: `/mensajes-y-avisos/${doc._id}`,
    titulo: doc.nombre,
    subtitulo: nombreTipo(doc.tipo),
    insignia: doc.activo
      ? insignia("Activo", "verde")
      : insignia("Inactivo", "gris"),
    campos: [
      { etiqueta: "Plantilla", valor: doc.plantillaWhatsApp || "Texto libre" },
    ],
  }),
  tituloDetalle: (doc) => doc.nombre,
  subtituloDetalle: (doc) => nombreTipo(doc.tipo),
  detalle: async (doc) => {
    const conEnvios = ["recordatorio_cobro", "folio"].includes(doc.tipo);
    const envios = conEnvios
      ? await col("whatsapp_envios")
          .find({ tipo: doc.tipo })
          .sort({ fecha: -1 })
          .limit(10)
          .toArray()
      : [];
    return [
      {
        tipo: "datos",
        filas: [
          { etiqueta: "Texto", valor: doc.texto },
          {
            etiqueta: "Plantilla de WhatsApp",
            valor:
              doc.plantillaWhatsApp ||
              "Texto libre (solo dentro de la ventana de 24 horas)",
          },
          { etiqueta: "Idioma", valor: doc.idioma || "es_MX" },
        ],
        nota: NOTAS[doc.tipo] || "",
      },
      ...(conEnvios
        ? [
            {
              tipo: "lista",
              titulo: "Últimos envíos",
              vacio: "Aún no hay envíos.",
              elementos: envios.map((e) => ({
                titulo: e.contratoFolio || "—",
                subtitulo: formatearFechaHora(e.fecha),
                detalle:
                  e.estado === "error"
                    ? `Error: ${e.error || ""}`
                    : e.estadoEntrega
                      ? `Entrega: ${e.estadoEntrega}`
                      : "",
                insignia:
                  e.estado === "error"
                    ? insignia("Error", "rojo")
                    : insignia("Enviado", "verde"),
              })),
            },
          ]
        : []),
    ];
  },
});
