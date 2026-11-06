"use strict";
/**
 * VIGILANCIA DE CAMBIOS EN MONGODB (change streams)
 * Avisa a las pantallas abiertas cuando algo cambia directamente en la base de datos
 * (por ejemplo, si borras o editas un registro desde MongoDB Atlas o Compass),
 * no solo cuando el cambio se hace desde la app.
 * Si la conexión con MongoDB se corta, se reanuda sola desde donde se quedó.
 */
const { db } = require("../db");
const { emitir } = require("./eventos");
const logger = require("../logger");

// Colección de MongoDB → módulo de la app que se actualiza.
// "auditoria" no se vigila: cambia con cada acción y la app ya avisa por su cuenta.
const COLECCION_A_MODULO = {
  solicitudes: "solicitudes",
  planes: "planes",
  promociones: "promociones",
  cobertura: "cobertura",
  clientes: "clientes",
  contratos: "contratos",
  equipos: "equipos",
  incidencias: "incidencias",
  incidencias_historial: "incidencias",
  evidencias: "incidencias",
  visitas: "visitas",
  tecnicos: "tecnicos",
  mensualidades: "cobranza",
  pagos: "cobranza",
  comprobantes: "cobranza",
  movimientos_bancarios: "conciliacion",
  importaciones: "conciliacion",
  mensajes: "mensajes",
  whatsapp_conversaciones: "mensajes",
  whatsapp_chat: "mensajes",
  usuarios: "usuarios",
};

let flujo = null;
let detenido = false;
let reintento = null;
let ficha = null; // punto de reanudación (resume token)

function iniciarVigilancia() {
  detenido = false;
  abrir(1000);
}

function abrir(espera) {
  if (detenido) return;
  try {
    flujo = db().watch(
      [
        {
          $match: {
            operationType: { $in: ["insert", "update", "replace", "delete"] },
            "ns.coll": { $in: Object.keys(COLECCION_A_MODULO) },
          },
        },
      ],
      ficha ? { resumeAfter: ficha } : {},
    );
  } catch (e) {
    logger.warn(
      { error: e.message },
      "No se pudo vigilar MongoDB; las pantallas se actualizarán solo con cambios hechos desde la app",
    );
    return;
  }
  flujo.on("change", (cambio) => {
    ficha = cambio._id;
    const modulo = COLECCION_A_MODULO[cambio.ns && cambio.ns.coll];
    if (modulo) emitir(modulo, { origen: "base" });
  });
  flujo.on("error", (e) => {
    if (detenido) return;
    // Si el punto de reanudación ya no existe, se vuelve a empezar desde ahora.
    if (e && (e.code === 286 || e.code === 280)) ficha = null;
    logger.warn(
      { error: e.message },
      "Se cortó la vigilancia de MongoDB; se reintenta",
    );
    cerrarFlujo();
    reintento = setTimeout(() => abrir(Math.min(espera * 2, 60000)), espera);
  });
}

function cerrarFlujo() {
  if (!flujo) return;
  flujo.removeAllListeners();
  flujo.close().catch(() => {});
  flujo = null;
}

async function detenerVigilancia() {
  detenido = true;
  clearTimeout(reintento);
  cerrarFlujo();
}

module.exports = { iniciarVigilancia, detenerVigilancia, COLECCION_A_MODULO };
