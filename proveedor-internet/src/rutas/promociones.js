"use strict";
const E = require("../lib/esquemas");
const { col } = require("../db");
const { crearRecurso } = require("./recurso");
const { textoBusqueda, ErrorValidacion } = require("../lib/util");
const {
  textoAFechaMX,
  fechaATextoMX,
  formatearFecha,
} = require("../lib/fechas");
const { insignia } = require("../lib/vistas");

function vigencia(doc) {
  if (!doc.inicio && !doc.fin) return "Sin fechas";
  return `${doc.inicio ? formatearFecha(doc.inicio) : "Desde hoy"} al ${doc.fin ? formatearFecha(doc.fin) : "sin fin"}`;
}

function estadoPromo(doc) {
  if (!doc.activo) return insignia("Inactiva", "gris");
  if (doc.fin && doc.fin < new Date()) return insignia("Vencida", "gris");
  return doc.publicada
    ? insignia("Publicada", "verde")
    : insignia("Oculta", "ambar");
}

module.exports = crearRecurso({
  ruta: "/promociones",
  coleccion: "promociones",
  modulo: "promociones",
  titulo: "Promociones",
  singular: "promoción",
  textoNuevo: "Nueva promoción",
  textoGuardado: "Promoción guardada.",
  desactivable: true,
  eliminable: true, // NUEVO
  auditoria: "promocion",
  vacio: "No hay promociones.",
  campos: async () => [
    { nombre: "titulo", etiqueta: "Título", tipo: "text", requerido: true },
    {
      nombre: "descripcion",
      etiqueta: "Descripción",
      tipo: "textarea",
      requerido: true,
      max: 600,
    },
    {
      nombre: "planes",
      etiqueta: "Planes que aplican",
      tipo: "text",
      autocapitalize: "none",
      ayuda:
        "Claves web separadas por comas (ej. basico, plus). Vacío si aplica a todos.",
    },
    { nombre: "inicio", etiqueta: "Inicio de vigencia", tipo: "date" },
    { nombre: "fin", etiqueta: "Fin de vigencia", tipo: "date" },
    { nombre: "publicada", etiqueta: "Mostrar en la página", tipo: "checkbox" },
  ],
  esquema: () =>
    E.z
      .object({
        titulo: E.texto(3, 100, "El título"),
        descripcion: E.texto(5, 600, "La descripción"),
        planes: E.textoOpcional(300, "Los planes"),
        inicio: E.fecha("La fecha de inicio", true),
        fin: E.fecha("La fecha de fin", true),
        publicada: E.casilla(),
      })
      .superRefine((d, ctx) => {
        if (d.inicio && d.fin && d.fin < d.inicio)
          ctx.addIssue({
            code: "custom",
            path: ["fin"],
            message: "La fecha de fin debe ser igual o posterior al inicio.",
          });
      }),
  aDocumento: async (d) => {
    const claves = [
      ...new Set(
        d.planes
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (claves.some((c) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c)))
      throw new ErrorValidacion({
        planes: "Usa claves web válidas separadas por comas.",
      });
    if (claves.length) {
      const existentes = (
        await col("planes")
          .find({ clave: { $in: claves } })
          .project({ clave: 1 })
          .toArray()
      ).map((p) => p.clave);
      const faltan = claves.filter((c) => !existentes.includes(c));
      if (faltan.length)
        throw new ErrorValidacion({
          planes: `No existe el plan: ${faltan.join(", ")}`,
        });
    }
    return {
      titulo: d.titulo,
      descripcion: d.descripcion,
      planes: claves,
      inicio: d.inicio ? textoAFechaMX(d.inicio) : null,
      fin: d.fin ? textoAFechaMX(d.fin, true) : null,
      publicada: d.publicada,
      busqueda: textoBusqueda(d.titulo, claves.join(" ")),
    };
  },
  aFormulario: (doc) => ({
    titulo: doc.titulo,
    descripcion: doc.descripcion,
    planes: (doc.planes || []).join(", "),
    inicio: fechaATextoMX(doc.inicio),
    fin: fechaATextoMX(doc.fin),
    publicada: Boolean(doc.publicada),
  }),
  resumen: (doc) => ({ titulo: doc.titulo }),
  fila: (doc) => ({
    enlace: `/promociones/${doc._id}`,
    titulo: doc.titulo,
    insignia: estadoPromo(doc),
    campos: [
      { etiqueta: "Vigencia", valor: vigencia(doc) },
      {
        etiqueta: "Planes",
        valor: doc.planes?.length ? doc.planes.join(", ") : "Todos",
      },
    ],
  }),
  tituloDetalle: (doc) => doc.titulo,
  detalle: async (doc) => [
    {
      tipo: "datos",
      insignia: estadoPromo(doc),
      filas: [
        { etiqueta: "Descripción", valor: doc.descripcion },
        {
          etiqueta: "Planes",
          valor: doc.planes?.length ? doc.planes.join(", ") : "Todos",
        },
        { etiqueta: "Vigencia", valor: vigencia(doc) },
        {
          etiqueta: "En la página",
          valor: doc.publicada && doc.activo ? "Sí" : "No",
        },
      ],
    },
  ],
});
