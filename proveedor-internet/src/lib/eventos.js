"use strict";
// Avisos en tiempo real (Server-Sent Events).
// Cada cambio se anuncia con el nombre de su módulo (planes, clientes, cobranza…).
// Funciona con una sola instancia, que es como se publica en Render (con disco persistente).
const { EventEmitter } = require("node:events");

const bus = new EventEmitter();
bus.setMaxListeners(0);
const conexiones = new Set();

/** Módulos cuyos cambios también se avisan al sitio público (sin datos, solo el nombre). */
const MODULOS_PUBLICOS = ["planes", "promociones", "cobertura"];

// Contador de cambios por módulo: respaldo para las pantallas que no reciben los avisos al instante.
const contadores = new Map();
function versiones() {
  return Object.fromEntries(contadores);
}

/** Anuncia un cambio. Nunca debe romper la petición que lo origina. */
function emitir(modulo, datos = {}) {
  contadores.set(modulo, (contadores.get(modulo) || 0) + 1);
  try {
    bus.emit("cambio", { ...datos, modulo });
  } catch {
    /* sin acción */
  }
}

function suscribir(fn) {
  bus.on("cambio", fn);
  return () => bus.off("cambio", fn);
}

/** Prepara una respuesta como flujo de eventos y la registra para el apagado controlado. */
function abrirFlujo(req, res, { duracionMs = 5 * 60 * 1000, alCerrar } = {}) {
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  conexiones.add(res);
  const latido = setInterval(() => res.write(": latido\n\n"), 25000);
  const limite = setTimeout(() => res.end(), duracionMs); // el navegador se reconecta solo
  req.on("close", () => {
    clearInterval(latido);
    clearTimeout(limite);
    conexiones.delete(res);
    if (alCerrar) alCerrar();
  });
}

function enviar(res, evento, datos) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
}

/** Cierra todas las conexiones abiertas (apagado controlado). */
function cerrarConexiones() {
  for (const res of conexiones) {
    try {
      res.end();
    } catch {
      /* sin acción */
    }
  }
  conexiones.clear();
}

module.exports = {
  emitir,
  suscribir,
  abrirFlujo,
  enviar,
  conexiones,
  cerrarConexiones,
  versiones,
  MODULOS_PUBLICOS,
};
