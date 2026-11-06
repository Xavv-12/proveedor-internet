"use strict";
const express = require("express");
const { puede } = require("../permisos");
const { suscribir, abrirFlujo, enviar, versiones } = require("../lib/eventos");

const r = express.Router();

/**
 * Un solo flujo de eventos por pestaña: GET /eventos
 * Cada persona recibe solo los cambios de los módulos que su rol puede ver
 * (el técnico no recibe cobranza, usuarios, etc.).
 * La conexión se renueva cada 5 minutos y así se vuelve a revisar sesión y permisos.
 */
r.get("/", (req, res) => {
  const usuario = req.usuario;
  let quitar = () => {};
  abrirFlujo(req, res, { alCerrar: () => quitar() });
  quitar = suscribir((ev) => {
    if (!puede(usuario, ev.modulo, "leer")) return;
    enviar(res, "cambio", { modulo: ev.modulo, folio: ev.folio || null });
  });
});

/**
 * Respaldo: GET /eventos/version
 * Cuántos cambios lleva cada módulo. La pantalla lo consulta cada 4 segundos;
 * si el número cambió, se actualiza aunque el aviso instantáneo no haya llegado
 * (por ejemplo, si un antivirus o proxy retiene la conexión de avisos).
 */
r.get("/version", (req, res) => {
  res.set("Cache-Control", "no-store");
  const todas = versiones();
  const propias = {};
  for (const [modulo, n] of Object.entries(todas)) {
    if (puede(req.usuario, modulo, "leer")) propias[modulo] = n;
  }
  res.json(propias);
});

module.exports = r;
