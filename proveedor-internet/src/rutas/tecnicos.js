"use strict";
const E = require("../lib/esquemas");
const { col } = require("../db");
const { crearRecurso } = require("./recurso");
const { textoBusqueda, ErrorValidacion } = require("../lib/util");
const { formatearTelefono } = require("../lib/telefono");
const { insignia, insigniaEstado } = require("../lib/vistas");
const { formatearFechaHora } = require("../lib/fechas");

module.exports = crearRecurso({
  ruta: "/tecnicos",
  coleccion: "tecnicos",
  modulo: "tecnicos",
  titulo: "Técnicos",
  singular: "técnico",
  textoNuevo: "Nuevo técnico",
  textoGuardado: "Técnico guardado.",
  desactivable: true,
  // NUEVO: botón Eliminar
  eliminable: true,
  // NUEVO: un técnico con visitas (programadas o pasadas) no se borra, se perdería el historial.
  bloqueoEliminar: async (doc) => {
    const visitas = await col("visitas").countDocuments({ tecnicoId: doc._id });
    return visitas
      ? `No se puede eliminar: tiene ${visitas} visita(s) registradas. Mejor desactívalo.`
      : null;
  },
  auditoria: "tecnico",
  orden: { nombre: 1 },
  vacio: "No hay técnicos registrados.",
  campos: async () => [
    { nombre: "nombre", etiqueta: "Nombre", tipo: "text", requerido: true },
    {
      nombre: "telefono",
      etiqueta: "Teléfono (10 dígitos)",
      tipo: "tel",
      requerido: true,
      inputmode: "tel",
    },
    { nombre: "zona", etiqueta: "Zona que atiende", tipo: "text" },
    {
      nombre: "correoUsuario",
      etiqueta: "Correo de su cuenta de acceso",
      tipo: "email",
      ayuda: "Opcional. Debe ser un usuario con rol Técnico.",
    },
  ],
  esquema: () =>
    E.z.object({
      nombre: E.texto(3, 120, "El nombre"),
      telefono: E.telefono(),
      zona: E.textoOpcional(120, "La zona"),
      correoUsuario: E.correoOpcional(),
    }),
  aDocumento: async (d) => {
    let usuario = null;
    if (d.correoUsuario) {
      usuario = await col("usuarios").findOne(
        { correo: d.correoUsuario, rol: "tecnico" },
        { projection: { _id: 1 } },
      );
      if (!usuario)
        throw new ErrorValidacion({
          correoUsuario: "No hay un usuario técnico con ese correo.",
        });
    }
    return {
      nombre: d.nombre,
      telefono: d.telefono,
      zona: d.zona,
      correoUsuario: d.correoUsuario,
      usuarioId: usuario?._id ?? null,
      busqueda: textoBusqueda(d.nombre, d.telefono, d.zona),
    };
  },
  aFormulario: (doc) => ({
    nombre: doc.nombre,
    telefono: doc.telefono,
    zona: doc.zona || "",
    correoUsuario: doc.correoUsuario || "",
  }),
  resumen: (doc) => ({ nombre: doc.nombre }),
  fila: (doc) => ({
    enlace: `/tecnicos/${doc._id}`,
    titulo: doc.nombre,
    subtitulo: `${formatearTelefono(doc.telefono)}${doc.zona ? ` · ${doc.zona}` : ""}`,
    insignia: doc.activo ? null : insignia("Inactivo", "gris"),
    campos: [],
  }),
  tituloDetalle: (doc) => doc.nombre,
  detalle: async (doc) => {
    const visitas = await col("visitas")
      .find({ tecnicoId: doc._id, estado: "programada" })
      .sort({ fecha: 1 })
      .limit(20)
      .toArray();
    return [
      {
        tipo: "datos",
        filas: [
          { etiqueta: "Teléfono", valor: formatearTelefono(doc.telefono) },
          { etiqueta: "Zona", valor: doc.zona || "—" },
          {
            etiqueta: "Cuenta de acceso",
            valor: doc.correoUsuario || "Sin cuenta vinculada",
          },
        ],
      },
      {
        tipo: "lista",
        titulo: "Próximas visitas",
        vacio: "Sin visitas programadas.",
        elementos: visitas.map((v) => ({
          titulo: formatearFechaHora(v.fecha),
          subtitulo: `${v.incidenciaFolio} · ${v.clienteNombre || ""}`,
          enlace: `/visitas/${v._id}`,
          insignia: insigniaEstado(v.estado),
        })),
      },
    ];
  },
});
