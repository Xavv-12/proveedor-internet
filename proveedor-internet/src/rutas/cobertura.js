"use strict";
const E = require("../lib/esquemas");
const { crearRecurso } = require("./recurso");
const { textoBusqueda, normalizar } = require("../lib/util");
const { insignia } = require("../lib/vistas");
const { col } = require("../db");
const { buscarContorno, centro, desdeGeoJSON } = require("../lib/contornos");

/** Contornos [lat,lng] guardados -> texto GeoJSON (Polygon o MultiPolygon) para el formulario. */
function aGeoJSON(poligonos) {
  const poligonosGeo = (poligonos || [])
    .filter((c) => Array.isArray(c) && c.length >= 3)
    .map((c) => {
      const anillo = c.map(([lat, lng]) => [lng, lat]);
      anillo.push(anillo[0]); // GeoJSON pide el anillo cerrado
      return [anillo];
    });
  if (!poligonosGeo.length) return "";
  const geometry =
    poligonosGeo.length === 1
      ? { type: "Polygon", coordinates: poligonosGeo[0] }
      : { type: "MultiPolygon", coordinates: poligonosGeo };
  return JSON.stringify({ type: "Feature", properties: {}, geometry });
}

/** GeoJSON dibujado en el mapa del formulario o pegado a mano -> lista de contornos [lat,lng]. */
function leerGeoJSON(texto) {
  const t = String(texto || "").trim();
  if (!t) return [];
  try {
    return desdeGeoJSON(t).flatMap((z) => z.poligonos);
  } catch {
    return [];
  }
}

// "20.1011, -98.7591" (como lo copia Google Maps con clic derecho) → { lat, lng } dentro de México.
const UBICACION = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
function leerUbicacion(texto) {
  const m = UBICACION.exec(String(texto || ""));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < 14 || lat > 33 || lng < -119 || lng > -86) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/**
 * Contorno de la zona: primero se reutiliza el que ya exista para la misma
 * colonia + municipio + estado (así editar notas o el servicio no vuelve a
 * consultar OpenStreetMap); si no hay, se busca en OpenStreetMap.
 * Si no se encuentra, la zona se guarda igual, sin contorno.
 * Los contornos dibujados a mano no se reutilizan aquí: el formulario ya los
 * trae en el campo GeoJSON, así que un campo vacío significa "volver a OpenStreetMap".
 */
async function obtenerPoligonos(clave, d) {
  const previa = await col("cobertura").findOne(
    {
      contornoClave: clave,
      contornoNivel: { $ne: "manual" },
      "poligonos.0": { $exists: true },
    },
    { projection: { poligonos: 1, contornoNivel: 1 } },
  );
  if (previa)
    return {
      poligonos: previa.poligonos,
      centro: null,
      nivel: previa.contornoNivel || "colonia",
    };
  const r = await buscarContorno({
    estado: d.entidad,
    municipio: d.municipio,
    colonia: d.colonia,
  }).catch(() => null);
  return r
    ? { poligonos: r.poligonos, centro: r.centro || null, nivel: r.nivel }
    : { poligonos: [], centro: null, nivel: "ninguno" };
}

module.exports = crearRecurso({
  ruta: "/cobertura",
  coleccion: "cobertura",
  modulo: "cobertura",
  titulo: "Cobertura",
  singular: "zona",
  textoNuevo: "Nueva zona",
  textoGuardado: "Zona guardada.",
  desactivable: true,
  eliminable: true, // NUEVO
  auditoria: "cobertura",
  orden: { codigoPostal: 1, colonia: 1 },
  vacio: "No hay zonas de cobertura registradas.",
  valoresIniciales: async () => ({ disponible: true, radio: "800" }),
  campos: async () => [
    {
      nombre: "codigoPostal",
      etiqueta: "Código postal",
      tipo: "text",
      requerido: true,
      inputmode: "numeric",
      max: 5,
    },
    { nombre: "colonia", etiqueta: "Colonia", tipo: "text", requerido: true },
    {
      nombre: "municipio",
      etiqueta: "Municipio o alcaldía",
      tipo: "text",
      requerido: true,
    },
    { nombre: "entidad", etiqueta: "Estado", tipo: "text", requerido: true },
    {
      nombre: "disponible",
      etiqueta: "Hay servicio disponible",
      tipo: "checkbox",
    },
    {
      nombre: "ubicacion",
      etiqueta: "Ubicación en el mapa (latitud, longitud)",
      tipo: "text",
      inputmode: "decimal",
      ayuda:
        "Opcional. El contorno de la zona se busca solo en OpenStreetMap al guardar; si lo encuentra, no necesitas llenar esto. Si no lo encuentra, escribe aquí el centro (clic derecho en Google Maps y pulsa los números), por ejemplo 20.1011, -98.7591.",
    },
    {
      nombre: "radio",
      etiqueta: "Radio de la zona en metros",
      tipo: "number",
      min: 100,
      max: 20000,
      ayuda:
        "Solo se usa si no hay contorno. Tamaño del círculo en el mapa. Una colonia mediana: 600 a 1000 m.",
    },
    {
      nombre: "contornoGeojson",
      etiqueta: "Contorno dibujado a mano (GeoJSON)",
      tipo: "textarea",
      max: 60000,
      ayuda:
        "Opcional. Pulsa «Dibujar contorno» en el mapa de arriba y marca las esquinas de la colonia: este campo se llena solo. También puedes pegar aquí un GeoJSON. Tiene prioridad sobre el contorno de OpenStreetMap. Para volver al de OpenStreetMap, pulsa «Borrar contorno» y guarda.",
    },
    { nombre: "notas", etiqueta: "Notas internas", tipo: "textarea", max: 500 },
  ],
  esquema: () =>
    E.z.object({
      codigoPostal: E.codigoPostal(),
      colonia: E.texto(2, 120, "La colonia"),
      municipio: E.texto(2, 120, "El municipio"),
      entidad: E.texto(2, 60, "El estado"),
      disponible: E.casilla(),
      ubicacion: E.cadena((s) =>
        s
          .max(60)
          .refine(
            (v) => !v || leerUbicacion(v),
            "Escribe latitud y longitud separadas por coma, dentro de México (ej. 20.1011, -98.7591).",
          ),
      ),
      radio: E.entero(100, 20000, "El radio", true),
      contornoGeojson: E.cadena((s) =>
        s
          .max(60000, "El contorno es demasiado grande.")
          .refine(
            (v) => !v || leerGeoJSON(v).length > 0,
            "El contorno no es un GeoJSON válido con un polígono. Dibújalo en el mapa o pega el GeoJSON completo.",
          ),
      ),
      notas: E.textoOpcional(500, "Las notas"),
    }),
  aDocumento: async (dFormulario) => {
    const { contornoGeojson, ...d } = dFormulario;
    const clave = [d.colonia, d.municipio, d.entidad]
      .map((x) => normalizar(x))
      .join("|");
    const manual = leerGeoJSON(contornoGeojson);
    const {
      poligonos,
      centro: centroOsm,
      nivel,
    } = manual.length
      ? { poligonos: manual, centro: null, nivel: "manual" }
      : await obtenerPoligonos(clave, d);
    // Ubicación escrita a mano > centro de la colonia > punto de OSM > centro del municipio > nada.
    const ubicacion = leerUbicacion(d.ubicacion) ||
      (["colonia", "manual"].includes(nivel) && poligonos.length
        ? centro(poligonos)
        : null) ||
      centroOsm ||
      (poligonos.length ? centro(poligonos) : null) || { lat: null, lng: null };
    return {
      ...d,
      ...ubicacion,
      radio: d.radio || 800,
      poligonos,
      contornoNivel: nivel,
      contornoClave: clave,
      coloniaNormal: normalizar(d.colonia),
      busqueda: textoBusqueda(
        d.codigoPostal,
        d.colonia,
        d.municipio,
        d.entidad,
      ),
    };
  },
  aFormulario: (doc) => ({
    codigoPostal: doc.codigoPostal,
    colonia: doc.colonia,
    municipio: doc.municipio,
    entidad: doc.entidad,
    disponible: Boolean(doc.disponible),
    notas: doc.notas || "",
    ubicacion: doc.lat != null ? `${doc.lat}, ${doc.lng}` : "",
    radio: String(doc.radio || 800),
    contornoGeojson:
      doc.contornoNivel === "manual" ? aGeoJSON(doc.poligonos) : "",
  }),
  resumen: (doc) => ({ codigoPostal: doc.codigoPostal, colonia: doc.colonia }),
  fila: (doc) => ({
    enlace: `/cobertura/${doc._id}`,
    titulo: doc.colonia,
    subtitulo: `CP ${doc.codigoPostal} · ${doc.municipio}, ${doc.entidad}`,
    insignia: !doc.activo
      ? insignia("Inactiva", "gris")
      : doc.disponible
        ? insignia("Con servicio", "verde")
        : insignia("Sin servicio", "ambar"),
    campos: [],
  }),
  tituloDetalle: (doc) => doc.colonia,
  subtituloDetalle: (doc) => `CP ${doc.codigoPostal}`,
  detalle: async (doc) => [
    {
      tipo: "datos",
      filas: [
        { etiqueta: "Código postal", valor: doc.codigoPostal },
        { etiqueta: "Municipio o alcaldía", valor: doc.municipio },
        { etiqueta: "Estado", valor: doc.entidad },
        {
          etiqueta: "Servicio disponible",
          valor: doc.disponible ? "Sí" : "No",
        },
        {
          etiqueta: "Contorno en el mapa",
          valor:
            doc.poligonos && doc.poligonos.length
              ? doc.contornoNivel === "manual"
                ? "Sí, contorno dibujado a mano"
                : doc.contornoNivel === "municipio"
                  ? "Contorno del municipio"
                  : "Sí, contorno de la colonia o localidad"
              : doc.lat != null
                ? `Sin contorno: se dibuja un círculo de ${doc.radio || 800} m`
                : "Sin contorno ni ubicación (no se dibuja en el mapa)",
        },
        doc.lat != null
          ? {
              etiqueta: "En el mapa",
              valor: `${doc.lat}, ${doc.lng} · radio ${doc.radio || 800} m`,
              enlace: `https://www.google.com/maps?q=${doc.lat},${doc.lng}`,
            }
          : {
              etiqueta: "En el mapa",
              valor: "Sin ubicación (no se dibuja en el mapa del sitio)",
            },
        { etiqueta: "Notas internas", valor: doc.notas || "—" },
      ],
    },
  ],
});
