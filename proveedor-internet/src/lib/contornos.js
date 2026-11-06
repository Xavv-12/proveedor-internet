"use strict";
/**
 * Contornos de zonas de cobertura.
 *
 * buscarContorno({ estado, municipio, colonia }) consulta OpenStreetMap (Nominatim)
 * y devuelve, en este orden de preferencia:
 *   1. { nivel: "colonia",   poligonos }  contorno de la colonia, barrio o localidad
 *   2. { nivel: "municipio", poligonos }  contorno del municipio (solo si la zona registrada ES el municipio)
 *   3. { nivel: "punto",     poligonos: [] } solo el centro de la localidad
 *   4. null                                OpenStreetMap no tiene nada
 * Cuando OSM tiene la localidad como punto, también devuelve "centro" { lat, lng }.
 *
 * desdeGeoJSON(geojson) convierte un archivo GeoJSON (varias colonias de golpe)
 * en una lista [{ nombre, poligonos }].
 *
 * Formato de "poligonos": arreglo de contornos; cada contorno es un arreglo de
 * puntos [latitud, longitud]. Ejemplo:
 *   [ [ [19.2, -99.4], [19.3, -99.4], [19.3, -99.3] ] ]
 *
 * Requiere Node 18+ (usa fetch). Nominatim pide: máximo 1 consulta por segundo
 * y un User-Agent que identifique tu aplicación. Cambia CONTACTO por tu correo.
 */
const { normalizar } = require("./util");

const CONTACTO = "contacto@tu-dominio.com";
const USER_AGENT = `proveedor-internet/1.0 (${CONTACTO})`;
const URL_NOMINATIM = "https://nominatim.openstreetmap.org/search";
const ESPERA_MS = 1100; // respeta el límite de 1 consulta por segundo
const TIEMPO_MAX_MS = 10000;
const MAX_PUNTOS = 400; // por contorno, para no inflar la base de datos
const AREA_MAX_COLONIA = 0.15; // grados (~15 km por lado)
const AREA_MAX_MUNICIPIO = 0.8; // grados (~90 km por lado)

let ultimaConsulta = 0;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Quita puntos redundantes con Douglas-Peucker. */
function simplificar(puntos, tolerancia) {
  if (puntos.length <= 3) return puntos;
  const distancia = (p, a, b) => {
    const dx = b[1] - a[1];
    const dy = b[0] - a[0];
    if (dx === 0 && dy === 0) return Math.hypot(p[1] - a[1], p[0] - a[0]);
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / (dx * dx + dy * dy),
      ),
    );
    return Math.hypot(p[1] - (a[1] + t * dx), p[0] - (a[0] + t * dy));
  };
  const marcados = new Array(puntos.length).fill(false);
  marcados[0] = marcados[puntos.length - 1] = true;
  const pila = [[0, puntos.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    let max = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distancia(puntos[k], puntos[i], puntos[j]);
      if (d > max) {
        max = d;
        idx = k;
      }
    }
    if (max > tolerancia && idx !== -1) {
      marcados[idx] = true;
      pila.push([i, idx], [idx, j]);
    }
  }
  return puntos.filter((_, k) => marcados[k]);
}

/** Anillo GeoJSON [[lng,lat],...] -> [[lat,lng],...] simplificado y redondeado a ~1 m. */
function anilloALatLng(anillo) {
  let puntos = anillo
    .filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
    .map(([lng, lat]) => [lat, lng]);
  let tol = 0.00002; // ~2 m
  puntos = simplificar(puntos, tol);
  while (puntos.length > MAX_PUNTOS && tol < 0.01) {
    tol *= 2;
    puntos = simplificar(puntos, tol);
  }
  puntos = puntos.map(([lat, lng]) => [
    Math.round(lat * 1e5) / 1e5,
    Math.round(lng * 1e5) / 1e5,
  ]);
  return puntos.length >= 3 ? puntos : null;
}

/** Geometría GeoJSON (Polygon o MultiPolygon) -> lista de contornos [lat,lng]. */
function geometriaAPoligonos(geometria) {
  if (!geometria) return [];
  let poligonos = [];
  if (geometria.type === "Polygon") poligonos = [geometria.coordinates];
  else if (geometria.type === "MultiPolygon") poligonos = geometria.coordinates;
  else return [];
  // Solo se usa el contorno exterior (primer anillo) de cada polígono.
  return poligonos
    .map((p) => (Array.isArray(p) && p[0] ? anilloALatLng(p[0]) : null))
    .filter(Boolean);
}

/**
 * Evita que OSM devuelva otra zona. Solo se acepta el resultado si:
 *  - su nombre coincide con "nombre",
 *  - su dirección completa menciona "contiene" (municipio o estado),
 *  - y su área no supera "maxArea" grados por lado.
 */
function esZonaCorrecta(r, { nombre, contiene, maxArea }) {
  const encontrado = normalizar(r.name || "");
  const buscado = normalizar(nombre);
  if (!encontrado || !buscado) return false;
  if (!(encontrado.includes(buscado) || buscado.includes(encontrado)))
    return false;
  const extra = normalizar(contiene);
  if (extra && !normalizar(r.display_name || "").includes(extra)) return false;
  const bb = (r.boundingbox || []).map(Number); // [sur, norte, oeste, este]
  if (bb.length === 4 && bb.every(Number.isFinite)) {
    if (bb[1] - bb[0] > maxArea || bb[3] - bb[2] > maxArea) return false;
  }
  return true;
}

/** Centro aproximado de una lista de contornos: { lat, lng }. */
function centro(poligonos) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const contorno of poligonos || [])
    for (const [lat, lng] of contorno) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  if (!Number.isFinite(minLat)) return null;
  return {
    lat: Math.round(((minLat + maxLat) / 2) * 1e6) / 1e6,
    lng: Math.round(((minLng + maxLng) / 2) * 1e6) / 1e6,
  };
}

/** Una consulta a Nominatim, respetando el límite de 1 por segundo. [] si falla. */
async function consultar(q) {
  const espera = ultimaConsulta + ESPERA_MS - Date.now();
  if (espera > 0) await esperar(espera);
  ultimaConsulta = Date.now();

  const url = new URL(URL_NOMINATIM);
  url.search = new URLSearchParams({
    q,
    format: "jsonv2",
    polygon_geojson: "1",
    polygon_threshold: "0.0001",
    countrycodes: "mx",
    limit: "5",
  }).toString();

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_MAX_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "es" },
      signal: control.signal,
    });
    if (!resp.ok) return [];
    const datos = await resp.json();
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  } finally {
    clearTimeout(reloj);
  }
}

/** Busca el contorno de una zona en OpenStreetMap (ver el orden arriba). */
async function buscarContorno({ estado, municipio, colonia }) {
  const limpiar = (s) => String(s ?? "").trim();
  colonia = limpiar(colonia);
  municipio = limpiar(municipio);
  estado = limpiar(estado);
  if (!colonia || !municipio || !estado) return null;

  // 1) Contorno de la colonia, barrio o localidad.
  let punto = null;
  const deColonia = await consultar(
    [colonia, municipio, estado, "México"].join(", "),
  );
  for (const r of deColonia) {
    if (
      !esZonaCorrecta(r, {
        nombre: colonia,
        contiene: municipio,
        maxArea: AREA_MAX_COLONIA,
      })
    )
      continue;
    const poligonos = geometriaAPoligonos(r.geojson);
    if (poligonos.length) {
      return {
        nivel: "colonia",
        poligonos,
        centro: null,
        fuente: "OpenStreetMap",
      };
    }
    // Muchas localidades están en OSM solo como un punto: se guarda su centro.
    if (!punto && r.geojson && r.geojson.type === "Point") {
      const [lng, lat] = r.geojson.coordinates || [];
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        punto = {
          lat: Math.round(lat * 1e6) / 1e6,
          lng: Math.round(lng * 1e6) / 1e6,
        };
      }
    }
  }

  // 2) Contorno del municipio: solo si la zona registrada ES el municipio.
  //    Una colonia sin contorno no se rellena con todo el municipio.
  const esMunicipio = normalizar(colonia) === normalizar(municipio);
  const deMunicipio = esMunicipio
    ? await consultar([municipio, estado, "México"].join(", "))
    : [];
  for (const r of deMunicipio) {
    if (
      !esZonaCorrecta(r, {
        nombre: municipio,
        contiene: estado,
        maxArea: AREA_MAX_MUNICIPIO,
      })
    )
      continue;
    const poligonos = geometriaAPoligonos(r.geojson);
    if (poligonos.length) {
      return {
        nivel: "municipio",
        poligonos,
        centro: punto,
        fuente: "OpenStreetMap",
      };
    }
  }

  // 3) Solo el punto de la localidad.
  if (punto) {
    return {
      nivel: "punto",
      poligonos: [],
      centro: punto,
      fuente: "OpenStreetMap",
    };
  }
  return null; // 4) OSM no tiene nada: escribir la ubicación a mano o importar GeoJSON
}

/** GeoJSON (Feature, FeatureCollection o geometría) -> [{ nombre, poligonos }]. */
function desdeGeoJSON(geojson) {
  const objeto = typeof geojson === "string" ? JSON.parse(geojson) : geojson;
  const elementos =
    objeto.type === "FeatureCollection"
      ? objeto.features
      : objeto.type === "Feature"
        ? [objeto]
        : [{ type: "Feature", properties: {}, geometry: objeto }];
  const salida = [];
  for (const f of elementos) {
    const poligonos = geometriaAPoligonos(f.geometry);
    if (!poligonos.length) continue;
    const p = f.properties || {};
    const nombre =
      p.nombre || p.name || p.NOMBRE || p.colonia || p.COLONIA || "";
    salida.push({ nombre: String(nombre), poligonos });
  }
  return salida;
}

module.exports = { buscarContorno, desdeGeoJSON, geometriaAPoligonos, centro };
