"use strict";
const E = require("../lib/esquemas");
const { col } = require("../db");
const { crearRecurso } = require("./recurso");
const { textoBusqueda } = require("../lib/util");
const { formatear, centavosATexto } = require("../lib/dinero");
const { insignia } = require("../lib/vistas");

// NUEVO: fecha y hora con AM/PM (hora de Ciudad de México), ej. "01 nov 2026, 12:05 PM"
function fechaHoraAmPm(valor) {
  if (!valor) return "—";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const h = Number(partes.hour) % 24;
  const sufijo = h >= 12 ? "PM" : "AM";
  const h12 = String(h % 12 || 12).padStart(2, "0");
  const mes = String(partes.month).replace(".", "");
  return `${partes.day} ${mes} ${partes.year}, ${h12}:${partes.minute} ${sufijo}`;
}

// Velocidades: no se inventan. Sin velocidad de bajada el plan queda como borrador oculto.
function estadoPlan(doc) {
  if (!doc.activo) return insignia("Inactivo", "gris");
  return doc.publicado
    ? insignia("Publicado", "verde")
    : insignia("Borrador oculto", "ambar");
}

module.exports = crearRecurso({
  ruta: "/planes",
  coleccion: "planes",
  modulo: "planes",
  titulo: "Planes",
  singular: "plan",
  textoNuevo: "Nuevo plan",
  textoGuardado: "Plan guardado.",
  desactivable: true,
  eliminable: true,
  // No se borra un plan que ya está en contratos: se rompería su historial.
  bloqueoEliminar: async (doc) => {
    const usados = await col("contratos").countDocuments({
      $or: [{ planId: doc._id }, { planClave: doc.clave }],
    });
    return usados
      ? `No se puede eliminar: ${usados} contrato(s) usan este plan. Mejor desactívalo.`
      : null;
  },
  auditoria: "plan",
  soloAlta: ["clave"],
  orden: { precio: 1 },
  campoUnico: "clave",
  mensajeDuplicado: "Ya existe un plan con esa clave web.",
  vacio: "No hay planes. Agrega el primero.",
  campos: async () => [
    {
      nombre: "clave",
      etiqueta: "Clave web",
      tipo: "text",
      requerido: true,
      autocapitalize: "none",
      ayuda:
        "Minúsculas, números y guiones. Debe coincidir con el botón de la página (ej. premium-1).",
    },
    { nombre: "nombre", etiqueta: "Nombre", tipo: "text", requerido: true },
    {
      nombre: "precio",
      etiqueta: "Precio mensual (MXN)",
      tipo: "dinero",
      requerido: true,
    },
    {
      nombre: "velocidadBajada",
      etiqueta: "Velocidad de bajada (Mbps)",
      tipo: "number",
      min: 1,
      ayuda:
        "Déjala vacía si aún no está confirmada. Sin velocidad, el plan queda como borrador oculto.",
    },
    {
      nombre: "velocidadSubida",
      etiqueta: "Velocidad de subida (Mbps)",
      tipo: "number",
      min: 1,
    },
    {
      nombre: "descripcion",
      etiqueta: "Descripción",
      tipo: "textarea",
      max: 500,
    },
    {
      nombre: "publicado",
      etiqueta: "Publicar en la página",
      tipo: "checkbox",
      ayuda: "Solo se publica si tiene velocidad de bajada.",
    },
  ],
  esquema: () =>
    E.z
      .object({
        clave: E.cadena(
          (s) =>
            s
              .min(1, "La clave web es obligatoria.")
              .max(40, "La clave web admite máximo 40 caracteres.")
              .regex(
                /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
                "Usa solo minúsculas, números y guiones (ej. premium-1).",
              ),
          (v) => E.limpio(v).toLowerCase(),
        ),
        nombre: E.texto(2, 80, "El nombre"),
        precio: E.dinero("El precio"),
        velocidadBajada: E.entero(1, 100000, "La velocidad de bajada", true),
        velocidadSubida: E.entero(1, 100000, "La velocidad de subida", true),
        descripcion: E.textoOpcional(500, "La descripción"),
        publicado: E.casilla(),
      })
      .superRefine((d, ctx) => {
        if (d.publicado && !d.velocidadBajada) {
          ctx.addIssue({
            code: "custom",
            path: ["publicado"],
            message:
              "Para publicar el plan, primero agrega la velocidad de bajada en Mbps.",
          });
        }
      }),
  aDocumento: async (d) => ({
    clave: d.clave,
    nombre: d.nombre,
    precio: d.precio,
    velocidadBajada: d.velocidadBajada ?? null,
    velocidadSubida: d.velocidadSubida ?? null,
    descripcion: d.descripcion,
    publicado: Boolean(d.publicado && d.velocidadBajada),
    busqueda: textoBusqueda(d.clave, d.nombre),
  }),
  aFormulario: (doc) => ({
    clave: doc.clave,
    nombre: doc.nombre,
    precio: centavosATexto(doc.precio),
    velocidadBajada: doc.velocidadBajada ?? "",
    velocidadSubida: doc.velocidadSubida ?? "",
    descripcion: doc.descripcion || "",
    publicado: Boolean(doc.publicado),
  }),
  resumen: (doc) => ({ clave: doc.clave }),
  fila: (doc) => ({
    enlace: `/planes/${doc._id}`,
    titulo: doc.nombre,
    subtitulo: doc.clave,
    insignia: estadoPlan(doc),
    campos: [
      { etiqueta: "Precio", valor: `${formatear(doc.precio)} al mes` },
      {
        etiqueta: "Bajada",
        valor: doc.velocidadBajada
          ? `${doc.velocidadBajada} Mbps`
          : "Sin definir",
      },
    ],
  }),
  tituloDetalle: (doc) => doc.nombre,
  subtituloDetalle: (doc) => `Clave web: ${doc.clave}`,
  detalle: async (doc) => [
    {
      tipo: "datos",
      insignia: estadoPlan(doc),
      filas: [
        { etiqueta: "Precio mensual", valor: formatear(doc.precio) },
        {
          etiqueta: "Velocidad de bajada",
          valor: doc.velocidadBajada
            ? `${doc.velocidadBajada} Mbps`
            : "Sin definir (borrador oculto)",
        },
        {
          etiqueta: "Velocidad de subida",
          valor: doc.velocidadSubida
            ? `${doc.velocidadSubida} Mbps`
            : "Sin definir",
        },
        { etiqueta: "Descripción", valor: doc.descripcion || "—" },
        {
          etiqueta: "En la página",
          valor: doc.publicado && doc.activo ? "Sí" : "No",
        },
        // NUEVO: con AM/PM
        {
          etiqueta: "Última actualización",
          valor: fechaHoraAmPm(doc.actualizado),
        },
      ],
      nota: "Cambiar el precio no altera contratos existentes: cada contrato guarda su propia tarifa.",
    },
  ],
});
