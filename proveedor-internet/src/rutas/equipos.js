"use strict";
const E = require("../lib/esquemas");
const { col } = require("../db");
const { crearRecurso } = require("./recurso");
const { textoBusqueda, ErrorValidacion, capital } = require("../lib/util");
const { insignia, opciones } = require("../lib/vistas");

const TIPOS = ["módem", "router", "ONT", "antena", "otro"];
const ESTADOS = ["en almacén", "asignado", "en reparación", "baja"];
const TONO = {
  "en almacén": "azul",
  asignado: "verde",
  "en reparación": "ambar",
  baja: "gris",
};

function normalizarMac(t) {
  const s = String(t || "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase();
  return s.length === 12 ? s.match(/.{2}/g).join(":") : null;
}

module.exports = crearRecurso({
  ruta: "/equipos",
  coleccion: "equipos",
  modulo: "equipos",
  titulo: "Equipos",
  singular: "equipo",
  textoNuevo: "Nuevo equipo",
  textoGuardado: "Equipo guardado.",
  desactivable: true,
  // NUEVO: botón Eliminar
  eliminable: true,
  // NUEVO: un equipo asignado a un contrato no se borra.
  bloqueoEliminar: async (doc) =>
    doc.contratoId || doc.estado === "asignado"
      ? `No se puede eliminar: el equipo está asignado${doc.contratoFolio ? ` al contrato ${doc.contratoFolio}` : " a un contrato"}. Primero quítale el folio del contrato (Editar).`
      : null,
  auditoria: "equipo",
  campoUnico: "numeroSerie",
  mensajeDuplicado: "Ya existe un equipo con ese número de serie.",
  vacio: "No hay equipos que coincidan.",
  filtroLista: (req) =>
    ESTADOS.includes(req.query.estado) ? { estado: req.query.estado } : {},
  filtros: (req) => [
    {
      tipo: "select",
      nombre: "estado",
      etiqueta: "Estado",
      valor: req.query.estado || "",
      opciones: opciones(ESTADOS, "Todos"),
    },
  ],
  valoresIniciales: async () => ({ estado: "en almacén" }),
  campos: async () => [
    {
      nombre: "tipo",
      etiqueta: "Tipo",
      tipo: "select",
      requerido: true,
      opciones: opciones(
        TIPOS.map((t) => ({ valor: t, texto: capital(t) })),
        "Elige un tipo",
      ),
    },
    { nombre: "marca", etiqueta: "Marca", tipo: "text", requerido: true },
    { nombre: "modelo", etiqueta: "Modelo", tipo: "text", requerido: true },
    {
      nombre: "numeroSerie",
      etiqueta: "Número de serie",
      tipo: "text",
      requerido: true,
      autocapitalize: "characters",
    },
    {
      nombre: "mac",
      etiqueta: "MAC",
      tipo: "text",
      autocapitalize: "characters",
      ayuda: "Opcional. Ej. AA:BB:CC:DD:EE:FF",
    },
    {
      nombre: "contratoFolio",
      etiqueta: "Folio del contrato",
      tipo: "text",
      autocapitalize: "characters",
      ayuda: "Ej. CTR-2026-00001. Vacío si está en almacén.",
    },
    {
      nombre: "estado",
      etiqueta: "Estado",
      tipo: "select",
      requerido: true,
      opciones: opciones(ESTADOS),
    },
  ],
  esquema: () =>
    E.z.object({
      tipo: E.opcion(TIPOS, "tipo"),
      marca: E.texto(1, 60, "La marca"),
      modelo: E.texto(1, 60, "El modelo"),
      numeroSerie: E.cadena(
        (s) =>
          s
            .min(3, "El número de serie es obligatorio.")
            .max(60)
            .regex(
              /^[A-Z0-9\-_.:/]+$/,
              "Usa solo letras, números, guion, punto, dos puntos o diagonal.",
            ),
        (v) => E.limpio(v).toUpperCase(),
      ),
      mac: E.cadena((s) =>
        s.refine((v) => !v || normalizarMac(v), "La MAC no es válida."),
      ),
      contratoFolio: E.cadena(
        (s) => s.max(20),
        (v) => E.limpio(v).toUpperCase(),
      ),
      estado: E.opcion(ESTADOS, "estado"),
    }),
  aDocumento: async (d) => {
    let contrato = null;
    if (d.contratoFolio) {
      contrato = await col("contratos").findOne(
        { folio: d.contratoFolio },
        { projection: { folio: 1, clienteNombre: 1 } },
      );
      if (!contrato)
        throw new ErrorValidacion({
          contratoFolio: "No existe un contrato con ese folio.",
        });
    }
    if (d.estado === "asignado" && !contrato)
      throw new ErrorValidacion({
        contratoFolio:
          "Para marcarlo como asignado, indica el folio del contrato.",
      });
    return {
      tipo: d.tipo,
      marca: d.marca,
      modelo: d.modelo,
      numeroSerie: d.numeroSerie,
      mac: d.mac ? normalizarMac(d.mac) : "",
      contratoId: contrato?._id ?? null,
      contratoFolio: contrato?.folio ?? "",
      clienteNombre: contrato?.clienteNombre ?? "",
      estado: d.estado,
      busqueda: textoBusqueda(
        d.tipo,
        d.marca,
        d.modelo,
        d.numeroSerie,
        d.mac,
        contrato?.folio,
        contrato?.clienteNombre,
      ),
    };
  },
  aFormulario: (doc) => ({
    tipo: doc.tipo,
    marca: doc.marca,
    modelo: doc.modelo,
    numeroSerie: doc.numeroSerie,
    mac: doc.mac || "",
    contratoFolio: doc.contratoFolio || "",
    estado: doc.estado,
  }),
  resumen: (doc) => ({ numeroSerie: doc.numeroSerie }),
  fila: (doc) => ({
    enlace: `/equipos/${doc._id}`,
    titulo: `${capital(doc.tipo)} ${doc.marca} ${doc.modelo}`,
    subtitulo: `Serie ${doc.numeroSerie}`,
    insignia: doc.activo
      ? insignia(capital(doc.estado), TONO[doc.estado])
      : insignia("Inactivo", "gris"),
    campos: [
      { etiqueta: "Contrato", valor: doc.contratoFolio || "Sin asignar" },
    ],
  }),
  tituloDetalle: (doc) => `${capital(doc.tipo)} ${doc.marca} ${doc.modelo}`,
  subtituloDetalle: (doc) => `Serie ${doc.numeroSerie}`,
  detalle: async (doc) => [
    {
      tipo: "datos",
      insignia: insignia(capital(doc.estado), TONO[doc.estado]),
      filas: [
        { etiqueta: "MAC", valor: doc.mac || "—" },
        {
          etiqueta: "Contrato",
          valor: doc.contratoFolio || "Sin asignar",
          enlace: doc.contratoId ? `/contratos/${doc.contratoId}` : null,
        },
        { etiqueta: "Cliente", valor: doc.clienteNombre || "—" },
      ],
    },
  ],
});
