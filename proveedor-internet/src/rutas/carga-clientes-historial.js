"use strict";
// Cargas masivas anteriores: ver qué se importó y, si hubo un error, eliminar los clientes de esa carga.
const express = require("express");
const { col, aId } = require("../db");
const { permitir } = require("../middleware/sesion");
const { envolver, avisar } = require("../lib/util");
const { auditarReq } = require("../lib/auditoria");
const { formatearFechaHora } = require("../lib/fechas");
const { renderDetalle } = require("../lib/vistas");

const r = express.Router();
const leer = permitir("clientes", "leer");
const escribir = permitir("clientes", "escribir");
const BASE = "/clientes/carga-masiva";
const HIST = `${BASE}/historial`;

async function buscarCarga(req) {
  const id = aId(req.params.id);
  return id
    ? col("cargas_clientes").findOne({ _id: id, estado: "importada" })
    : null;
}

/** Clientes de la carga y cuántos de ellos ya tienen contratos (esos no se pueden borrar). */
async function clientesDeLaCarga(carga) {
  const ids = (
    await col("clientes")
      .find({ cargaId: carga._id }, { projection: { _id: 1 } })
      .limit(5000)
      .toArray()
  ).map((x) => x._id);
  const conContrato = new Set();
  if (ids.length) {
    for (const cid of await col("contratos").distinct("clienteId", {
      clienteId: { $in: ids },
    }))
      conContrato.add(String(cid));
  }
  return {
    ids,
    conContrato,
    borrables: ids.filter((x) => !conContrato.has(String(x))),
  };
}

r.get(
  "/",
  leer,
  envolver(async (req, res) => {
    const cargas = await col("cargas_clientes")
      .find({ estado: "importada" })
      .sort({ importada: -1 })
      .limit(50)
      .toArray();
    renderDetalle(res, {
      titulo: "Cargas anteriores",
      subtitulo: "Importaciones de clientes desde Excel",
      volver: BASE,
      bloques: [
        {
          tipo: "lista",
          titulo: "Cargas importadas",
          vacio: "Aún no hay cargas importadas.",
          elementos: cargas.map((c) => ({
            titulo: c.archivo,
            subtitulo: `${formatearFechaHora(c.importada)} · ${c.usuarioNombre || ""} · ${(c.resultado && c.resultado.creados) || 0} cliente(s) importados`,
            enlace: `${HIST}/${c._id}`,
          })),
        },
      ],
    });
  }),
);

r.get(
  "/:id",
  leer,
  envolver(async (req, res, next) => {
    const c = await buscarCarga(req);
    if (!c) return next();
    const { ids, conContrato, borrables } = await clientesDeLaCarga(c);
    const esAdmin = req.usuario.rol === "admin";
    const bloques = [
      {
        tipo: "datos",
        filas: [
          { etiqueta: "Archivo", valor: c.archivo },
          {
            etiqueta: "Importada",
            valor: `${formatearFechaHora(c.importada)} · ${c.usuarioNombre || ""}`,
          },
          {
            etiqueta: "Clientes importados",
            valor: String((c.resultado && c.resultado.creados) || 0),
          },
          { etiqueta: "Siguen en el sistema", valor: String(ids.length) },
          {
            etiqueta: "Con contrato (no se pueden eliminar)",
            valor: String(conContrato.size),
          },
          { etiqueta: "Se eliminarían", valor: String(borrables.length) },
          ...(esAdmin
            ? []
            : [
                {
                  etiqueta: "Aviso",
                  valor:
                    "Solo administración puede eliminar una carga completa.",
                },
              ]),
        ],
      },
    ];
    const botones = [];
    if (esAdmin && borrables.length) {
      botones.push({
        texto: `Eliminar ${borrables.length} cliente(s) de esta carga`,
        accion: `${HIST}/${c._id}/eliminar`,
        estilo: "peligro",
        confirmar: `¿Eliminar definitivamente ${borrables.length} cliente(s) de la base de datos? Esta acción no se puede deshacer.`,
      });
    }
    if (botones.length) bloques.push({ tipo: "botones", botones });
    renderDetalle(res, {
      titulo: "Carga importada",
      subtitulo: c.archivo,
      volver: HIST,
      bloques,
    });
  }),
);

r.post(
  "/:id/eliminar",
  escribir,
  envolver(async (req, res, next) => {
    if (req.usuario.rol !== "admin") {
      avisar(
        req,
        "Solo administración puede eliminar una carga completa.",
        "error",
      );
      return res.redirect(HIST);
    }
    const c = await buscarCarga(req);
    if (!c) return next();
    const { ids, borrables } = await clientesDeLaCarga(c);
    let eliminados = 0;
    if (borrables.length) {
      // cargaId se vuelve a exigir en el filtro: nunca se borra un cliente que no sea de esta carga.
      const x = await col("clientes").deleteMany({
        _id: { $in: borrables },
        cargaId: c._id,
      });
      eliminados = x.deletedCount;
    }
    const conservados = ids.length - eliminados;
    await auditarReq(req, "cliente.carga_eliminada", {
      archivo: c.archivo,
      eliminados,
      conservados,
    });
    avisar(
      req,
      `Se eliminaron ${eliminados} cliente(s) de la carga.${conservados ? ` ${conservados} se conservaron porque tienen contrato.` : ""}`,
    );
    return res.redirect(HIST);
  }),
);

module.exports = r;
