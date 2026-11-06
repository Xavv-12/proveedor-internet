"use strict";
const E = require("../lib/esquemas");
const { col } = require("../db");
const { crearRecurso } = require("./recurso");
const { textoBusqueda, ErrorValidacion } = require("../lib/util");
const { siguienteFolio } = require("../lib/folios");
const { formatearTelefono } = require("../lib/telefono");
const { formatearFechaHora } = require("../lib/fechas");
const { insigniaEstado, opciones } = require("../lib/vistas");
const { puede } = require("../permisos");

const ESTADOS_SOLICITUD = [
  "recibida",
  "cobertura validada",
  "contactada",
  "agendada",
  "contratada",
  "descartada",
];

const recurso = crearRecurso({
  ruta: "/solicitudes",
  coleccion: "solicitudes",
  modulo: "solicitudes",
  titulo: "Solicitudes",
  singular: "solicitud",
  textoNuevo: "Nueva solicitud",
  textoGuardado: "Solicitud guardada.",
  auditoria: "solicitud",
  orden: { creado: -1 },
  vacio: "No hay solicitudes que coincidan.",
  filtroLista: (req) => {
    const f = { clienteId: { $exists: false } };
    if (ESTADOS_SOLICITUD.includes(req.query.estado))
      f.estado = req.query.estado;
    return f;
  },
  filtros: (req) => [
    {
      tipo: "select",
      nombre: "estado",
      etiqueta: "Estado",
      valor: req.query.estado || "",
      opciones: opciones(ESTADOS_SOLICITUD, "Todos"),
    },
  ],
  valoresIniciales: async () => ({ estado: "recibida" }),
  campos: async () => {
    const planes = await col("planes")
      .find({ activo: true })
      .sort({ precio: 1 })
      .project({ clave: 1, nombre: 1 })
      .toArray();
    return [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "text", requerido: true },
      {
        nombre: "telefono",
        etiqueta: "Teléfono (10 dígitos)",
        tipo: "tel",
        requerido: true,
        inputmode: "tel",
      },
      { nombre: "correo", etiqueta: "Correo", tipo: "email" },
      { nombre: "entidad", etiqueta: "Estado", tipo: "text" },
      { nombre: "municipio", etiqueta: "Municipio", tipo: "text" },
      {
        nombre: "colonia",
        etiqueta: "Colonia o localidad",
        tipo: "text",
        requerido: true,
      },
      {
        nombre: "codigoPostal",
        etiqueta: "Código postal",
        tipo: "text",
        inputmode: "numeric",
        max: 5,
      },
      {
        nombre: "direccion",
        etiqueta: "Calle y número",
        tipo: "textarea",
        max: 300,
      },
      {
        nombre: "planClave",
        etiqueta: "Plan de interés",
        tipo: "select",
        opciones: opciones(
          planes.map((p) => ({ valor: p.clave, texto: p.nombre })),
          "Sin definir",
        ),
      },
      {
        nombre: "comentarios",
        etiqueta: "Comentarios",
        tipo: "textarea",
        max: 500,
      },
      {
        nombre: "estado",
        etiqueta: "Estado de la solicitud",
        tipo: "select",
        requerido: true,
        opciones: opciones(ESTADOS_SOLICITUD),
      },
    ];
  },
  esquema: () =>
    E.z.object({
      nombre: E.texto(2, 120, "El nombre"),
      telefono: E.telefono(),
      correo: E.correoOpcional(),
      entidad: E.textoOpcional(60, "El estado"),
      municipio: E.textoOpcional(120, "El municipio"),
      colonia: E.texto(2, 120, "La colonia o localidad"),
      codigoPostal: E.cadena((s) =>
        s.refine(
          (v) => !v || /^\d{5}$/.test(v),
          "El código postal debe tener 5 dígitos.",
        ),
      ),
      direccion: E.textoOpcional(300, "La dirección"),
      planClave: E.textoOpcional(40, "El plan"),
      comentarios: E.textoOpcional(500, "Los comentarios"),
      estado: E.opcion(ESTADOS_SOLICITUD, "estado"),
    }),
  aDocumento: async (d, { doc }) => {
    if (
      d.planClave &&
      !(await col("planes").findOne(
        { clave: d.planClave },
        { projection: { _id: 1 } },
      ))
    ) {
      throw new ErrorValidacion({ planClave: "Ese plan no existe." });
    }
    return {
      ...d,
      busqueda: textoBusqueda(
        doc?.folio,
        d.nombre,
        d.telefono,
        d.colonia,
        d.municipio,
        d.entidad,
        d.codigoPostal,
      ),
    };
  },
  alCrear: async (doc) => {
    doc.folio = await siguienteFolio("SOL");
    doc.origen = "interna";
    doc.busqueda = textoBusqueda(doc.folio, doc.busqueda);
  },
  aFormulario: (doc) => ({
    nombre: doc.nombre,
    telefono: doc.telefono,
    correo: doc.correo || "",
    entidad: doc.entidad || "",
    municipio: doc.municipio || "",
    codigoPostal: doc.codigoPostal || "",
    colonia: doc.colonia,
    direccion: doc.direccion || "",
    planClave: doc.planClave || "",
    comentarios: doc.comentarios || "",
    estado: doc.estado,
  }),
  resumen: (doc) => ({ folio: doc.folio }),
  fila: (doc) => ({
    enlace: `/solicitudes/${doc._id}`,
    titulo: doc.folio,
    subtitulo: [doc.nombre, doc.colonia, doc.municipio]
      .filter(Boolean)
      .join(" · "),
    insignia: insigniaEstado(doc.estado),
    campos: [
      { etiqueta: "Recibida", valor: formatearFechaHora(doc.creado) },
      { etiqueta: "Plan", valor: doc.planClave || "Sin definir" },
    ],
  }),
  tituloDetalle: (doc) => doc.folio,
  subtituloDetalle: (doc) => doc.nombre,
  detalle: async (doc, req) => {
    const bloques = [
      {
        tipo: "datos",
        insignia: insigniaEstado(doc.estado),
        filas: [
          { etiqueta: "Teléfono", valor: formatearTelefono(doc.telefono) },
          { etiqueta: "Correo", valor: doc.correo || "—" },
          { etiqueta: "Estado", valor: doc.entidad || "—" },
          { etiqueta: "Municipio", valor: doc.municipio || "—" },
          { etiqueta: "Colonia o localidad", valor: doc.colonia },
          { etiqueta: "Código postal", valor: doc.codigoPostal || "—" },
          { etiqueta: "Dirección", valor: doc.direccion || "—" },
          {
            etiqueta: "Plan de interés",
            valor: doc.planClave || "Sin definir",
          },
          { etiqueta: "Comentarios", valor: doc.comentarios || "—" },
          {
            etiqueta: "Origen",
            valor: doc.origen === "web" ? "Página web" : "Captura interna",
          },
          ...(doc.origen === "web"
            ? [
                {
                  etiqueta: "Aviso de privacidad",
                  valor: doc.avisoAceptado
                    ? `Aceptado${doc.avisoVersion ? ` (${doc.avisoVersion})` : ""}`
                    : "No indicado",
                },
              ]
            : []),
          { etiqueta: "Recibida", valor: formatearFechaHora(doc.creado) },
        ],
      },
    ];

    // === SEGUIMIENTO COMERCIAL ===
    if (
      !doc.clienteId &&
      doc.estado !== "descartada" &&
      doc.estado !== "contratada"
    ) {
      const botones = [];

      if (doc.estado === "recibida" || doc.estado === "contactada") {
        botones.push({
          texto: "Registrar contacto",
          enlace: `/solicitudes/${doc._id}/contacto`,
        });
      }

      if (doc.estado === "recibida" || doc.estado === "contactada") {
        botones.push({
          texto: "Validar cobertura",
          enlace: `/solicitudes/${doc._id}/cobertura`,
        });
      }

      if (
        doc.estado === "contactada" ||
        doc.estado === "cobertura validada" ||
        doc.estado === "agendada"
      ) {
        botones.push({
          texto: "Agendar instalación",
          enlace: `/solicitudes/${doc._id}/agendar`,
        });
      }

      if (
        puede(req.usuario, "clientes", "escribir") &&
        (doc.estado === "agendada" || doc.estado === "cobertura validada")
      ) {
        botones.push({
          texto: "Registrar como cliente",
          enlace: `/clientes/nuevo?solicitud=${doc._id}`,
        });
      }

      botones.push({
        texto: "Descartar solicitud",
        enlace: `/solicitudes/${doc._id}/descartar`,
        clase: "peligro",
      });

      if (botones.length) {
        bloques.push({
          tipo: "botones",
          botones,
        });
      }
    }

    if (doc.clienteId && puede(req.usuario, "clientes", "leer")) {
      bloques.push({
        tipo: "botones",
        botones: [
          { texto: "Ver cliente", enlace: `/clientes/${doc.clienteId}` },
        ],
      });
    }

    return bloques;
  },
});

// ============================================================
//  ACCIONES DE SEGUIMIENTO COMERCIAL
// ============================================================

async function cargarSolicitud(id) {
  const { ObjectId } = require("mongodb");
  let _id;
  try {
    _id = new ObjectId(id);
  } catch {
    const err = new Error("Solicitud no encontrada");
    err.status = 404;
    throw err;
  }

  const doc = await col("solicitudes").findOne({ _id });
  if (!doc) {
    const err = new Error("Solicitud no encontrada");
    err.status = 404;
    throw err;
  }
  return doc;
}

// ---------- REGISTRAR CONTACTO ----------
recurso.get("/:id/contacto", async (req, res, next) => {
  try {
    const doc = await cargarSolicitud(req.params.id);
    res.render("solicitudes/contacto", {
      titulo: `Contacto · ${doc.folio}`,
      doc,
      volver: `/solicitudes/${doc._id}`,
    });
  } catch (err) {
    next(err);
  }
});

recurso.post("/:id/contacto", async (req, res, next) => {
  try {
    const doc = await cargarSolicitud(req.params.id);
    const { resultado, notas, fechaSeguimiento } = req.body;

    const nuevoEstado =
      resultado === "ya_no_interesa" ? "descartada" : "contactada";

    await col("solicitudes").updateOne(
      { _id: doc._id },
      {
        $set: {
          estado: nuevoEstado,
          ultimoContacto: new Date(),
          notasContacto: notas || "",
          proximoSeguimiento: fechaSeguimiento
            ? new Date(fechaSeguimiento)
            : null,
          actualizado: new Date(),
        },
      },
    );

    await col("solicitudes_historial").insertOne({
      solicitudId: doc._id,
      accion: "contacto",
      resultado,
      notas: notas || "",
      usuario: req.usuario?.nombre || "Sistema",
      fecha: new Date(),
    });

    res.redirect(`/solicitudes/${doc._id}`);
  } catch (err) {
    next(err);
  }
});

// ---------- VALIDAR COBERTURA ----------
recurso.get("/:id/cobertura", async (req, res, next) => {
  try {
    const doc = await cargarSolicitud(req.params.id);
    res.render("solicitudes/cobertura", {
      titulo: `Validar cobertura · ${doc.folio}`,
      doc,
      volver: `/solicitudes/${doc._id}`,
    });
  } catch (err) {
    next(err);
  }
});

recurso.post("/:id/cobertura", async (req, res, next) => {
  try {
    const doc = await cargarSolicitud(req.params.id);
    const { resultado, notas } = req.body;

    const nuevoEstado =
      resultado === "sin_cobertura" ? "descartada" : "cobertura validada";

    await col("solicitudes").updateOne(
      { _id: doc._id },
      {
        $set: {
          estado: nuevoEstado,
          coberturaValidada: resultado === "con_cobertura",
          notasCobertura: notas || "",
          actualizado: new Date(),
        },
      },
    );

    await col("solicitudes_historial").insertOne({
      solicitudId: doc._id,
      accion: "cobertura",
      resultado,
      notas: notas || "",
      usuario: req.usuario?.nombre || "Sistema",
      fecha: new Date(),
    });

    res.redirect(`/solicitudes/${doc._id}`);
  } catch (err) {
    next(err);
  }
});

// ---------- DESCARTAR ----------
recurso.get("/:id/descartar", async (req, res, next) => {
  try {
    const doc = await cargarSolicitud(req.params.id);
    res.render("solicitudes/descartar", {
      titulo: `Descartar · ${doc.folio}`,
      doc,
      volver: `/solicitudes/${doc._id}`,
    });
  } catch (err) {
    next(err);
  }
});

recurso.post("/:id/descartar", async (req, res, next) => {
  try {
    const doc = await cargarSolicitud(req.params.id);
    const { motivo, notas } = req.body;

    await col("solicitudes").updateOne(
      { _id: doc._id },
      {
        $set: {
          estado: "descartada",
          motivoDescarte: motivo,
          notasDescarte: notas || "",
          actualizado: new Date(),
        },
      },
    );

    await col("solicitudes_historial").insertOne({
      solicitudId: doc._id,
      accion: "descartada",
      resultado: motivo,
      notas: notas || "",
      usuario: req.usuario?.nombre || "Sistema",
      fecha: new Date(),
    });

    res.redirect(`/solicitudes/${doc._id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = recurso;
module.exports.ESTADOS_SOLICITUD = ESTADOS_SOLICITUD;
