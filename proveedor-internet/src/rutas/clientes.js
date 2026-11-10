"use strict";
const E = require("../lib/esquemas");
const { col, aId } = require("../db");
const { crearRecurso } = require("./recurso");
const { textoBusqueda, avisar } = require("../lib/util");
const { formatearTelefono } = require("../lib/telefono");
const { insignia, insigniaEstado } = require("../lib/vistas");
const { puede } = require("../permisos");
const { alRegistrarCliente } = require("../servicios/seguimiento");

/** Id de la solicitud de origen (?solicitud=...), o null. */
function idSolicitud(req) {
  return aId(String(req.query.solicitud || "")) || null;
}

/** Id del cliente ya creado para esa solicitud, o null. */
async function clienteDeSolicitud(s) {
  if (s.clienteId) return s.clienteId;
  const c = await col("clientes").findOne(
    { solicitudId: s._id },
    { projection: { _id: 1 } },
  );
  return c ? c._id : null;
}

module.exports = crearRecurso({
  ruta: "/clientes",
  coleccion: "clientes",
  modulo: "clientes",
  titulo: "Clientes",
  singular: "cliente",
  textoNuevo: "Nuevo cliente",
  textoGuardado: "Cliente guardado.",
  desactivable: true,
  // Botón Eliminar (borra de la base de datos). Un cliente con contratos no se borra: se desactiva.
  eliminable: true,
  bloqueoEliminar: async (doc) => {
    const contratos = await col("contratos").countDocuments({ clienteId: doc._id });
    if (contratos)
      return `No se puede eliminar: tiene ${contratos} contrato(s). Mejor desactívalo.`;
    if (doc.solicitudId)
      return "No se puede eliminar: viene de una solicitud. Mejor desactívalo.";
    return null;
  },
  auditoria: "cliente",
  vacio: "No hay clientes que coincidan.",

  // Si la solicitud ya se registró como cliente, no se deja crear otro: va al existente.
  bloquearAlta: async (req, res) => {
    const id = idSolicitud(req);
    if (!id) return false;
    const s = await col("solicitudes").findOne(
      { _id: id },
      { projection: { _id: 1, clienteId: 1 } },
    );
    if (!s) return false;
    const clienteId = await clienteDeSolicitud(s);
    if (!clienteId) return false;
    avisar(req, "Esta solicitud ya estaba registrada como cliente.");
    res.redirect(`/clientes/${clienteId}`);
    return true;
  },

  // Mantiene ?solicitud=... en el formulario para que llegue al guardar.
  sufijoAlta: (req) => {
    const id = idSolicitud(req);
    return id ? `?solicitud=${id}` : "";
  },

  // Llave única de Mongo (solicitudId): si dos envíos llegan a la vez, el segundo cae aquí.
  alDuplicado: async (e, req, res) => {
    if (!(e.keyPattern && e.keyPattern.solicitudId)) return false;
    const id = idSolicitud(req);
    const c = id
      ? await col("clientes").findOne(
          { solicitudId: id },
          { projection: { _id: 1 } },
        )
      : null;
    if (!c) return false;
    avisar(req, "Esta solicitud ya estaba registrada como cliente.");
    res.redirect(`/clientes/${c._id}`);
    return true;
  },

  // Liga el cliente nuevo con su solicitud de origen.
  alCrear: async (doc, req) => {
    const id = idSolicitud(req);
    if (!id) return;
    const s = await col("solicitudes").findOne(
      { _id: id },
      { projection: { _id: 1 } },
    );
    if (s) doc.solicitudId = s._id;
  },

  // Marca la solicitud como convertida (así sale de la lista de Solicitudes) y lo anota en su historial.
  despuesDeCrear: async (doc, req) => {
    if (!doc.solicitudId) return;
    await col("solicitudes").updateOne(
      { _id: doc.solicitudId, clienteId: { $exists: false } },
      { $set: { clienteId: doc._id, actualizado: new Date() } },
    );
    await alRegistrarCliente(doc.solicitudId, doc, req && req.usuario);
  },

  // Permite crear el cliente a partir de una solicitud.
  valoresIniciales: async (req) => {
    const id = idSolicitud(req);
    const s = id ? await col("solicitudes").findOne({ _id: id }) : null;
    if (!s) return {};
    return {
      nombre: s.nombre,
      telefono: s.telefono,
      correo: s.correo || "",
      direccion: s.direccion || "",
      colonia: s.colonia || "",
      codigoPostal: s.codigoPostal || "",
      notas: `Solicitud ${s.folio}`,
    };
  },
  campos: async () => [
    {
      nombre: "nombre",
      etiqueta: "Nombre completo",
      tipo: "text",
      requerido: true,
      autocomplete: "off",
    },
    {
      nombre: "telefono",
      etiqueta: "Teléfono (10 dígitos)",
      tipo: "tel",
      requerido: true,
      inputmode: "tel",
    },
    { nombre: "correo", etiqueta: "Correo", tipo: "email" },
    {
      nombre: "direccion",
      etiqueta: "Calle y número",
      tipo: "textarea",
      requerido: true,
      max: 300,
    },
    { nombre: "colonia", etiqueta: "Colonia", tipo: "text", requerido: true },
    {
      nombre: "codigoPostal",
      etiqueta: "Código postal",
      tipo: "text",
      requerido: true,
      inputmode: "numeric",
      max: 5,
    },
    {
      nombre: "referencias",
      etiqueta: "Referencias para llegar",
      tipo: "textarea",
      max: 300,
    },
    {
      nombre: "notas",
      etiqueta: "Notas internas",
      tipo: "textarea",
      max: 1000,
    },
  ],
  esquema: () =>
    E.z.object({
      nombre: E.texto(3, 120, "El nombre"),
      telefono: E.telefono(),
      correo: E.correoOpcional(),
      direccion: E.texto(5, 300, "La dirección"),
      colonia: E.texto(2, 120, "La colonia"),
      codigoPostal: E.codigoPostal(),
      referencias: E.textoOpcional(300, "Las referencias"),
      notas: E.textoOpcional(1000, "Las notas"),
    }),
  // Al editar, el número de contrato (papel) sigue incluido en la búsqueda.
  aDocumento: async (d, ctx) => ({
    ...d,
    busqueda: textoBusqueda(
      d.nombre,
      d.telefono,
      d.correo,
      d.colonia,
      d.codigoPostal,
      ctx?.doc?.numeroContratoImpreso || "",
    ),
  }),
  aFormulario: (doc) => ({
    nombre: doc.nombre,
    telefono: doc.telefono,
    correo: doc.correo || "",
    direccion: doc.direccion,
    colonia: doc.colonia,
    codigoPostal: doc.codigoPostal,
    referencias: doc.referencias || "",
    notas: doc.notas || "",
  }),
  resumen: (doc) => ({ nombre: doc.nombre }),
  fila: (doc) => ({
    enlace: `/clientes/${doc._id}`,
    titulo: doc.nombre,
    subtitulo: `${formatearTelefono(doc.telefono)} · ${doc.colonia}`,
    insignia: doc.activo ? null : insignia("Inactivo", "gris"),
    campos: [],
  }),
  tituloDetalle: (doc) => doc.nombre,
  subtituloDetalle: (doc) => formatearTelefono(doc.telefono),
  detalle: async (doc, req) => {
    const contratos = await col("contratos")
      .find({ clienteId: doc._id })
      .sort({ creado: -1 })
      .limit(50)
      .toArray();
    const bloques = [
      {
        tipo: "datos",
        insignia: doc.activo ? null : insignia("Inactivo", "gris"),
        filas: [
          { etiqueta: "Teléfono", valor: formatearTelefono(doc.telefono) },
          { etiqueta: "Correo", valor: doc.correo || "—" },
          { etiqueta: "Dirección", valor: doc.direccion },
          { etiqueta: "Colonia", valor: doc.colonia },
          { etiqueta: "Código postal", valor: doc.codigoPostal },
          { etiqueta: "Referencias", valor: doc.referencias || "—" },
          { etiqueta: "Notas internas", valor: doc.notas || "—" },
          { etiqueta: "Número de contrato (papel)", valor: doc.numeroContratoImpreso || "—" },
        ],
      },
      {
        tipo: "lista",
        titulo: "Contratos",
        vacio: "Este cliente aún no tiene contratos.",
        elementos: contratos.map((c) => ({
          titulo: c.folio,
          subtitulo: c.planNombre,
          enlace: `/contratos/${c._id}`,
          insignia: insigniaEstado(c.estado),
        })),
      },
    ];
    if (doc.activo && puede(req.usuario, "contratos", "escribir")) {
      bloques.push({
        tipo: "botones",
        botones: [
          {
            texto: "Nuevo contrato",
            enlace: `/contratos/nuevo?cliente=${doc._id}`,
          },
        ],
      });
    }
    return bloques;
  },
});
