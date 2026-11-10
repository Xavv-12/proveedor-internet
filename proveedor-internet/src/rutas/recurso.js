"use strict";
const express = require("express");
const { col, aId } = require("../db");
const { permitir } = require("../middleware/sesion");
const { puede } = require("../permisos");
const {
  envolver,
  filtroBusqueda,
  paginacion,
  navegacion,
  erroresZod,
  ErrorValidacion,
  avisar,
} = require("../lib/util");
const { auditarReq, diferencias } = require("../lib/auditoria");
const {
  renderLista,
  renderDetalle,
  renderFormulario,
  llenar,
  filtroSelect,
} = require("../lib/vistas");

const INTERNOS = new Set([
  "busqueda",
  "actualizado",
  "actualizadoPor",
  "creado",
  "creadoPor",
]);

/**
 * Crea un router con lista paginada en servidor (20), buscador, alta, detalle, edición y
 * desactivación/reactivación. Los permisos se validan en cada ruta.
 *
 * Ganchos opcionales para el alta:
 *  - bloquearAlta(req, res): si devuelve true, ya respondió (p. ej. redirigió) y no se sigue.
 *  - sufijoAlta(req): texto que se agrega a la acción del formulario (p. ej. "?solicitud=ID").
 *  - alDuplicado(error, req, res): maneja un error de llave única; true si ya respondió.
 *  - despuesDeCrear(doc, req): se ejecuta justo después de insertar.
 *
 * Eliminación (solo si el módulo la pide):
 *  - eliminable: true  -> muestra el botón "Eliminar" y habilita POST /:id/eliminar.
 *  - bloqueoEliminar(doc): devuelve un texto con el motivo si NO se puede borrar, o null si sí.
 */
function crearRecurso(def) {
  const r = express.Router();
  const leer = permitir(def.modulo, "leer");
  const escribir = permitir(def.modulo, "escribir");
  const coleccion = () => col(def.coleccion);
  const resumen = (doc) => (def.resumen ? def.resumen(doc) : {});

  async function formulario(
    req,
    res,
    { valores = {}, errores = {}, doc = null, estado = 200 },
  ) {
    const nuevo = !doc;
    let campos = await def.campos({ req, nuevo, doc });
    if (!nuevo && def.soloAlta) {
      campos = campos.map((c) =>
        def.soloAlta.includes(c.nombre)
          ? { ...c, soloLectura: true, ayuda: "No se puede cambiar." }
          : c,
      );
    }
    renderFormulario(
      res,
      {
        titulo: nuevo ? def.textoNuevo : `Editar ${def.singular}`,
        accion: nuevo
          ? def.ruta + (def.sufijoAlta ? def.sufijoAlta(req) : "")
          : `${def.ruta}/${doc._id}`,
        campos: llenar(campos, valores),
        errores,
        boton: nuevo ? "Guardar" : "Guardar cambios",
        cancelar: nuevo ? def.ruta : `${def.ruta}/${doc._id}`,
      },
      estado,
    );
  }

  async function buscar(req, next) {
    const id = aId(req.params.id);
    const doc = id ? await coleccion().findOne({ _id: id }) : null;
    if (!doc) next();
    return doc;
  }

  r.get(
    "/",
    leer,
    envolver(async (req, res) => {
      const q = String(req.query.q ?? "").slice(0, 80);
      const filtro = {
        ...filtroBusqueda(q),
        ...((def.filtroLista && def.filtroLista(req)) || {}),
      };
      const filtros = [];
      if (def.desactivable) {
        const e = ["activos", "inactivos", "todos"].includes(req.query.activos)
          ? req.query.activos
          : "activos";
        if (e === "activos") filtro.activo = true;
        else if (e === "inactivos") filtro.activo = false;
        filtros.push(
          filtroSelect("activos", "Mostrar", e, [
            { valor: "activos", texto: "Activos" },
            { valor: "inactivos", texto: "Inactivos" },
            { valor: "todos", texto: "Todos" },
          ]),
        );
      }
      if (def.filtros) filtros.push(...def.filtros(req));
      const { pagina, salto, limite } = paginacion(req);
      const [docs, total] = await Promise.all([
        coleccion()
          .find(filtro)
          .sort(def.orden || { _id: -1 })
          // Los módulos que piden `collation` ordenan como en español (la Ñ y los acentos en su lugar).
          .collation(def.collation || { locale: "simple" })
          .skip(salto)
          .limit(limite)
          .toArray(),
        coleccion().countDocuments(filtro),
      ]);
      renderLista(res, {
        titulo: def.titulo,
        accionBusqueda: def.ruta,
        q,
        filtros,
        enlaceNuevo: puede(req.usuario, def.modulo, "escribir")
          ? `${def.ruta}/nuevo`
          : null,
        textoNuevo: def.textoNuevo,
        filas: docs.map((d) => def.fila(d, req)),
        nav: navegacion(req, total, pagina),
        vacio: def.vacio,
      });
    }),
  );

  r.get(
    "/nuevo",
    escribir,
    envolver(async (req, res) => {
      if (def.bloquearAlta && (await def.bloquearAlta(req, res))) return;
      const valores =
        (def.valoresIniciales && (await def.valoresIniciales(req))) || {};
      await formulario(req, res, { valores });
    }),
  );

  r.post(
    "/",
    escribir,
    envolver(async (req, res) => {
      if (def.bloquearAlta && (await def.bloquearAlta(req, res))) return;
      const v = def.esquema().safeParse(req.body);
      if (!v.success)
        return formulario(req, res, {
          valores: req.body,
          errores: erroresZod(v.error),
          estado: 422,
        });
      let doc;
      try {
        doc = await def.aDocumento(v.data, { req, nuevo: true });
      } catch (e) {
        if (e instanceof ErrorValidacion)
          return formulario(req, res, {
            valores: req.body,
            errores: e.errores,
            estado: 422,
          });
        throw e;
      }
      const ahora = new Date();
      Object.assign(doc, {
        creado: ahora,
        actualizado: ahora,
        creadoPor: req.usuario._id,
      });
      if (def.desactivable) doc.activo = true;
      if (def.alCrear) await def.alCrear(doc, req);
      try {
        await coleccion().insertOne(doc);
      } catch (e) {
        if (e.code === 11000) {
          if (def.alDuplicado && (await def.alDuplicado(e, req, res))) return;
          return formulario(req, res, {
            valores: req.body,
            errores: {
              [def.campoUnico || "general"]:
                def.mensajeDuplicado || "Ya existe un registro con esos datos.",
            },
            estado: 409,
          });
        }
        throw e;
      }
      if (def.despuesDeCrear) await def.despuesDeCrear(doc, req);
      if (def.auditoria)
        await auditarReq(req, `${def.auditoria}.alta`, {
          id: String(doc._id),
          ...resumen(doc),
        });
      avisar(req, def.textoGuardado || "Registro guardado.");
      return res.redirect(`${def.ruta}/${doc._id}`);
    }),
  );

  r.get(
    "/:id",
    leer,
    envolver(async (req, res, next) => {
      const doc = await buscar(req, next);
      if (!doc) return;
      const bloques = await def.detalle(doc, req);
      if (puede(req.usuario, def.modulo, "escribir")) {
        const botones = [
          {
            texto: "Editar",
            enlace: `${def.ruta}/${doc._id}/editar`,
            estilo: "secundario",
          },
        ];
        if (def.desactivable) {
          botones.push(
            doc.activo
              ? {
                  texto: "Desactivar",
                  accion: `${def.ruta}/${doc._id}/desactivar`,
                  estilo: "peligro",
                  confirmar:
                    "¿Desactivar este registro? Podrás reactivarlo después.",
                }
              : {
                  texto: "Reactivar",
                  accion: `${def.ruta}/${doc._id}/reactivar`,
                  estilo: "secundario",
                },
          );
        }
        // NUEVO: botón Eliminar (solo en módulos con eliminable: true)
        if (def.eliminable) {
          botones.push({
            texto: "Eliminar",
            accion: `${def.ruta}/${doc._id}/eliminar`,
            estilo: "peligro",
            confirmar: `¿Eliminar ${def.singular} definitivamente? Esta acción no se puede deshacer.`,
          });
        }
        bloques.push({ tipo: "botones", botones });
      }
      renderDetalle(res, {
        titulo: def.tituloDetalle(doc),
        subtitulo: def.subtituloDetalle ? def.subtituloDetalle(doc) : "",
        volver: def.ruta,
        bloques,
      });
    }),
  );

  r.get(
    "/:id/editar",
    escribir,
    envolver(async (req, res, next) => {
      const doc = await buscar(req, next);
      if (!doc) return;
      await formulario(req, res, { valores: def.aFormulario(doc), doc });
    }),
  );

  r.post(
    "/:id",
    escribir,
    envolver(async (req, res, next) => {
      const doc = await buscar(req, next);
      if (!doc) return;
      const cuerpo = { ...req.body };
      const originales = def.aFormulario(doc);
      for (const k of def.soloAlta || []) cuerpo[k] = originales[k];
      const v = def.esquema().safeParse(cuerpo);
      if (!v.success)
        return formulario(req, res, {
          valores: cuerpo,
          errores: erroresZod(v.error),
          doc,
          estado: 422,
        });
      let cambios;
      try {
        cambios = await def.aDocumento(v.data, { req, nuevo: false, doc });
      } catch (e) {
        if (e instanceof ErrorValidacion)
          return formulario(req, res, {
            valores: cuerpo,
            errores: e.errores,
            doc,
            estado: 422,
          });
        throw e;
      }
      for (const k of def.soloAlta || []) delete cambios[k];
      cambios.actualizado = new Date();
      cambios.actualizadoPor = req.usuario._id;
      try {
        await coleccion().updateOne({ _id: doc._id }, { $set: cambios });
      } catch (e) {
        if (e.code === 11000) {
          return formulario(req, res, {
            valores: cuerpo,
            doc,
            estado: 409,
            errores: {
              [def.campoUnico || "general"]:
                def.mensajeDuplicado || "Ya existe un registro con esos datos.",
            },
          });
        }
        throw e;
      }
      if (def.auditoria) {
        const dif = diferencias(
          doc,
          cambios,
          Object.keys(cambios).filter((k) => !INTERNOS.has(k)),
        );
        if (Object.keys(dif).length)
          await auditarReq(req, `${def.auditoria}.cambio`, {
            id: String(doc._id),
            ...resumen(doc),
            cambios: dif,
          });
      }
      avisar(req, "Cambios guardados.");
      return res.redirect(`${def.ruta}/${doc._id}`);
    }),
  );

  // NUEVO: eliminación definitiva (solo si el módulo la habilita)
  if (def.eliminable) {
    r.post(
      "/:id/eliminar",
      escribir,
      envolver(async (req, res, next) => {
        const doc = await buscar(req, next);
        if (!doc) return;
        const motivo = def.bloqueoEliminar
          ? await def.bloqueoEliminar(doc)
          : null;
        if (motivo) {
          avisar(req, motivo);
          return res.redirect(`${def.ruta}/${doc._id}`);
        }
        const rr = await coleccion().deleteOne({ _id: doc._id });
        if (rr.deletedCount && def.auditoria) {
          await auditarReq(req, `${def.auditoria}.eliminacion`, {
            id: String(doc._id),
            ...resumen(doc),
          });
        }
        avisar(req, "Registro eliminado.");
        return res.redirect(def.ruta);
      }),
    );
  }

  if (def.desactivable) {
    for (const [accion, activo, texto] of [
      ["desactivar", false, "Registro desactivado."],
      ["reactivar", true, "Registro reactivado."],
    ]) {
      r.post(
        `/:id/${accion}`,
        escribir,
        envolver(async (req, res, next) => {
          const doc = await buscar(req, next);
          if (!doc) return;
          const rr = await coleccion().updateOne(
            { _id: doc._id, activo: !activo },
            {
              $set: {
                activo,
                actualizado: new Date(),
                actualizadoPor: req.usuario._id,
              },
            },
          );
          if (rr.modifiedCount && def.auditoria) {
            await auditarReq(
              req,
              `${def.auditoria}.${activo ? "reactivacion" : "desactivacion"}`,
              { id: String(doc._id), ...resumen(doc) },
            );
          }
          avisar(req, texto);
          res.redirect(`${def.ruta}/${doc._id}`);
        }),
      );
    }
  }

  return r;
}

module.exports = { crearRecurso };
