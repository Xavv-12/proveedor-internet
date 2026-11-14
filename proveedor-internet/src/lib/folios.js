"use strict";
const { col } = require("../db");
const { partesMX } = require("./fechas");

/** Folio con contador atómico: SOL-2026-00001, CTR-2026-00001, INC-2026-00001. */
async function siguienteFolio(prefijo, opciones = {}) {
  const anio = partesMX().year;
  const _id = `${prefijo}-${anio}`;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const d = await col("contadores").findOneAndUpdate(
        { _id },
        { $inc: { valor: 1 } },
        { upsert: true, returnDocument: "after", ...opciones },
      );
      return `${prefijo}-${anio}-${String(d.valor).padStart(5, "0")}`;
    } catch (e) {
      if (e.code !== 11000 || intento === 2) throw e;
    }
  }
  throw new Error("No se pudo generar el folio.");
}

module.exports = { siguienteFolio };
