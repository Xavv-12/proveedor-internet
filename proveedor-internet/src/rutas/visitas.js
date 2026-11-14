"use strict";
const express = require("express");
const E = require("../lib/esquemas");
const { col, aId, enTransaccion } = require("../db");
const { permitir } = require("../middleware/sesion");
const { puede } = require("../permisos");
const {
  envolver,
  paginacion,
  navegacion,
  erroresZod,
  avisar,
  ErrorNegocio,
  filtroBusqueda,
  textoBusqueda,
} = require("../lib/util");
const { auditarReq } = require("../lib/auditoria");
const {
  formatearFechaHora,
  formatearFecha,
  horaATextoMX,
  rangoDiaMX,
  hoyTextoMX,
  textoAFechaMX,
  fechaMXaUTC,
} = require("../lib/fechas");
const {
  renderLista,
  renderDetalle,
  renderFormulario,
  llenar,
  insigniaEstado,
  opciones,
} = require("../lib/vistas");
const {
  INCIDENCIA_ABIERTA,
  agregarHistorial,
} = require("../servicios/incidencias");

const r = express.Router();
const leer = permitir("visitas", "leer");
const escribir = permitir("visitas", "escribir");
const RESULTADOS = [
  {
    valor: "resuelta",
    texto: "Problema resuelto",
    estadoVisita: "realizada",
    estadoIncidencia: "resuelta",
  },
  {
    valor: "seguimiento",
    texto: "Requiere seguimiento",
    estadoVisita: "realizada",
    estadoIncidencia: "en proceso",
  },
  {
    valor: "no_atendida",
    texto: "No se pudo atender",
    estadoVisita: "no realizada",
    estadoIncidencia: "en espera",
  },
];

r.get(
  "/",
  leer,
  envolver(async (req, res) => {
    const fecha =
      /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || "")) &&
      textoAFechaMX(req.query.fecha)
        ? req.query.fecha
        : hoyTextoMX();
    const { inicio, fin } = rangoDiaMX(fecha);
    const filtro = {
      fecha: { $gte: inicio, $lt: fin },
      ...filtroBusqueda(req.query.q),
    };
    if (req.query.mias === "si") {
      const tecnico = await col("tecnicos").findOne(
        { usuarioId: req.usuario._id },
        { projection: { _id: 1 } },
      );
      filtro.tecnicoId = tecnico ? tecnico._id : null;
    }
    const { pagina, salto, limite } = paginacion(req);
    const [docs, total] = await Promise.all([
      col("visitas")
        .find(filtro)
        .sort({ fecha: 1 })
        .skip(salto)
        .limit(limite)
        .toArray(),
      col("visitas").countDocuments(filtro),
    ]);
    renderLista(res, {
      titulo: `Agenda del ${formatearFecha(inicio)}`,
      accionBusqueda: "/visitas",
      q: String(req.query.q ?? ""),
      filtros: [
        { tipo: "date", nombre: "fecha", etiqueta: "Día", valor: fecha },
        {
          tipo: "select",
          nombre: "mias",
          etiqueta: "Técnico",
          valor: req.query.mias === "si" ? "si" : "",
          opciones: [
            { valor: "", texto: "Todos" },
            { valor: "si", texto: "Solo mis visitas" },
          ],
        },
      ],
      enlaceNuevo: puede(req.usuario, "visitas", "escribir")
        ? "/visitas/nueva"
        : null,
      textoNuevo: "Agendar visita",
      filas: docs.map((v) => ({
        enlace: `/visitas/${v._id}`,
        titulo: `${horaATextoMX(v.fecha)} · ${v.clienteNombre || ""}`,
        subtitulo: `${v.incidenciaFolio} · ${v.tecnicoNombre}`,
        insignia: insigniaEstado(v.estado),
        campos: [{ etiqueta: "Dirección", valor: v.direccion || "—" }],
      })),
      nav: navegacion(req, total, pagina),
      vacio: "No hay visitas para este día.",
    });
  }),
);

async function camposVisita() {
  const tecnicos = await col("tecnicos")
    .find({ activo: true })
    .sort({ nombre: 1 })
    .project({ nombre: 1 })
    .toArray();
  return [
    {
      nombre: "incidenciaFolio",
      etiqueta: "Folio de la incidencia",
      tipo: "text",
      requerido: true,
      autocapitalize: "characters",
      ayuda: "Ej. INC-2026-00001",
    },
    {
      nombre: "tecnicoId",
      etiqueta: "Técnico",
      tipo: "select",
      requerido: true,
      opciones: opciones(
        tecnicos.map((t) => ({ valor: String(t._id), texto: t.nombre })),
        "Elige un técnico",
      ),
    },
    { nombre: "fecha", etiqueta: "Día", tipo: "date", requerido: true },
    { nombre: "hora", etiqueta: "Hora", tipo: "time", requerido: true },
    { nombre: "notas", etiqueta: "Indicaciones", tipo: "textarea", max: 1000 },
  ];
}
const esquemaVisita = () =>
  E.z.object({
    incidenciaFolio: E.cadena(
      (s) => s.min(1, "El folio de la incidencia es obligatorio.").max(20),
      (v) => E.limpio(v).toUpperCase(),
    ),
    tecnicoId: E.idObjeto("un técnico"),
    fecha: E.fecha("La fecha"),
    hora: E.hora("La hora"),
    notas: E.textoOpcional(1000, "Las indicaciones"),
  });
async function formVisita(res, valores, errores = {}, estado = 200) {
  renderFormulario(
    res,
    {
      titulo: "Agendar visita",
      accion: "/visitas",
      cancelar: "/visitas",
      boton: "Agendar visita",
      campos: llenar(await camposVisita(), valores),
      errores,
    },
    estado,
  );
}

r.get(
  "/nueva",
  escribir,
  envolver(async (req, res) =>
    formVisita(res, {
      incidenciaFolio: String(req.query.incidencia || "").slice(0, 20),
      fecha: hoyTextoMX(),
      hora: "10:00",
    }),
  ),
);

r.post(
  "/",
  escribir,
  envolver(async (req, res) => {
    const v = esquemaVisita().safeParse(req.body);
    if (!v.success) return formVisita(res, req.body, erroresZod(v.error), 422);
    const d = v.data;
    const [inc, tecnico] = await Promise.all([
      col("incidencias").findOne({ folio: d.incidenciaFolio }),
      col("tecnicos").findOne({ _id: aId(d.tecnicoId), activo: true }),
    ]);
    if (!inc)
      return formVisita(
        res,
        req.body,
        { incidenciaFolio: "No existe una incidencia con ese folio." },
        422,
      );
    if (!INCIDENCIA_ABIERTA.includes(inc.estado))
      return formVisita(
        res,
        req.body,
        {
          incidenciaFolio:
            "La incidencia ya está resuelta o cerrada. Reábrela antes de agendar.",
        },
        422,
      );
    if (!tecnico)
      return formVisita(
        res,
        req.body,
        { tecnicoId: "Elige un técnico activo." },
        422,
      );
    const [a, m, dd] = d.fecha.split("-").map(Number);
    const [h, mi] = d.hora.split(":").map(Number);
    const fecha = fechaMXaUTC(a, m, dd, h, mi);

    // La visita y la actualización de la incidencia ocurren en una misma transacción.
    const visita = await enTransaccion(async (s) => {
      const ahora = new Date();
      const doc = {
        incidenciaId: inc._id,
        incidenciaFolio: inc.folio,
        contratoId: inc.contratoId,
        contratoFolio: inc.contratoFolio,
        clienteNombre: inc.clienteNombre,
        direccion: inc.direccion,
        tecnicoId: tecnico._id,
        tecnicoNombre: tecnico.nombre,
        fecha,
        estado: "programada",
        notas: d.notas,
        creada: ahora,
        creadoPor: req.usuario._id,
        busqueda: textoBusqueda(inc.folio, inc.clienteNombre, tecnico.nombre),
      };
      await col("visitas").insertOne(doc, { session: s });
      const nuevoEstado = "en proceso";
      const antes = await col("incidencias").findOneAndUpdate(
        { _id: inc._id },
        { $set: { estado: nuevoEstado, actualizada: ahora } },
        { session: s, returnDocument: "before" },
      );
      await agregarHistorial(
        inc._id,
        {
          tipo: "visita",
          texto: `Visita programada para ${formatearFechaHora(fecha)} con ${tecnico.nombre}.`,
        },
        req.usuario,
        s,
      );
      if (antes.estado !== nuevoEstado) {
        await agregarHistorial(
          inc._id,
          {
            tipo: "estado",
            texto: "Cambio por visita programada.",
            de: antes.estado,
            a: nuevoEstado,
          },
          req.usuario,
          s,
        );
        await auditarReq(
          req,
          "incidencia.estado",
          {
            folio: inc.folio,
            de: antes.estado,
            a: nuevoEstado,
            motivo: "visita programada",
          },
          s,
        );
      }
      return doc;
    });
    avisar(req, "Visita agendada.");
    return res.redirect(`/visitas/${visita._id}`);
  }),
);

async function buscarVisita(req, next) {
  const id = aId(req.params.id);
  const v = id ? await col("visitas").findOne({ _id: id }) : null;
  if (!v) next();
  return v;
}

r.get(
  "/:id",
  leer,
  envolver(async (req, res, next) => {
    const v = await buscarVisita(req, next);
    if (!v) return;
    const bloques = [
      {
        tipo: "datos",
        insignia: insigniaEstado(v.estado),
        filas: [
          {
            etiqueta: "Incidencia",
            valor: v.incidenciaFolio,
            enlace: `/incidencias/${v.incidenciaId}`,
          },
          {
            etiqueta: "Contrato",
            valor: v.contratoFolio,
            enlace: `/contratos/${v.contratoId}`,
          },
          { etiqueta: "Cliente", valor: v.clienteNombre || "—" },
          { etiqueta: "Dirección", valor: v.direccion || "—" },
          { etiqueta: "Técnico", valor: v.tecnicoNombre },
          { etiqueta: "Indicaciones", valor: v.notas || "—" },
          ...(v.resultado
            ? [
                {
                  etiqueta: "Resultado",
                  valor:
                    (RESULTADOS.find((x) => x.valor === v.resultado) || {})
                      .texto || v.resultado,
                },
                {
                  etiqueta: "Notas del técnico",
                  valor: v.notasResultado || "—",
                },
                { etiqueta: "Cerrada", valor: formatearFechaHora(v.cerrada) },
              ]
            : []),
        ],
      },
    ];
    if (
      v.estado === "programada" &&
      puede(req.usuario, "visitas", "escribir")
    ) {
      bloques.push(
        {
          tipo: "formulario",
          titulo: "Registrar resultado",
          accion: `/visitas/${v._id}/resultado`,
          campos: llenar([
            {
              nombre: "resultado",
              etiqueta: "Resultado",
              tipo: "select",
              requerido: true,
              opciones: opciones(
                RESULTADOS.map((x) => ({ valor: x.valor, texto: x.texto })),
                "Elige el resultado",
              ),
            },
            {
              nombre: "notas",
              etiqueta: "Qué se hizo",
              tipo: "textarea",
              requerido: true,
              max: 2000,
              filas: 4,
            },
          ]),
          boton: "Guardar resultado",
          nota: "El resultado actualiza el estado de la incidencia.",
        },
        {
          tipo: "botones",
          botones: [
            {
              texto: "Cancelar visita",
              accion: `/visitas/${v._id}/cancelar`,
              estilo: "peligro",
              confirmar: "¿Cancelar esta visita?",
            },
          ],
        },
      );
    }
    renderDetalle(res, {
      titulo: `Visita ${formatearFechaHora(v.fecha)}`,
      subtitulo: v.clienteNombre,
      volver: "/visitas",
      bloques,
    });
  }),
);

r.post(
  "/:id/resultado",
  escribir,
  envolver(async (req, res, next) => {
    const v = await buscarVisita(req, next);
    if (!v) return;
    const resultado = RESULTADOS.find((x) => x.valor === req.body.resultado);
    const notas = E.texto(3, 2000, "Las notas").safeParse(req.body.notas);
    if (!resultado || !notas.success) {
      avisar(
        req,
        !resultado
          ? "Elige el resultado de la visita."
          : notas.error.issues[0].message,
        "error",
      );
      return res.redirect(`/visitas/${v._id}`);
    }
    try {
      await enTransaccion(async (s) => {
        const ahora = new Date();
        const cerrada = await col("visitas").findOneAndUpdate(
          { _id: v._id, estado: "programada" },
          {
            $set: {
              estado: resultado.estadoVisita,
              resultado: resultado.valor,
              notasResultado: notas.data,
              cerrada: ahora,
              cerradaPor: req.usuario._id,
            },
          },
          { session: s, returnDocument: "after" },
        );
        if (!cerrada) throw new ErrorNegocio("La visita ya fue cerrada.");
        const antes = await col("incidencias").findOneAndUpdate(
          { _id: v.incidenciaId },
          { $set: { estado: resultado.estadoIncidencia, actualizada: ahora } },
          { session: s, returnDocument: "before" },
        );
        await agregarHistorial(
          v.incidenciaId,
          {
            tipo: "visita",
            texto: `Visita: ${resultado.texto}. ${notas.data}`,
          },
          req.usuario,
          s,
        );
        if (antes && antes.estado !== resultado.estadoIncidencia) {
          await agregarHistorial(
            v.incidenciaId,
            {
              tipo: "estado",
              texto: "Cambio por resultado de visita.",
              de: antes.estado,
              a: resultado.estadoIncidencia,
            },
            req.usuario,
            s,
          );
          await auditarReq(
            req,
            "incidencia.estado",
            {
              folio: v.incidenciaFolio,
              de: antes.estado,
              a: resultado.estadoIncidencia,
              motivo: "resultado de visita",
            },
            s,
          );
        }
      });
      avisar(req, "Resultado guardado.");
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(`/visitas/${v._id}`);
  }),
);

r.post(
  "/:id/cancelar",
  escribir,
  envolver(async (req, res, next) => {
    const v = await buscarVisita(req, next);
    if (!v) return;
    const hecho = await enTransaccion(async (s) => {
      const c = await col("visitas").findOneAndUpdate(
        { _id: v._id, estado: "programada" },
        {
          $set: {
            estado: "cancelada",
            cerrada: new Date(),
            cerradaPor: req.usuario._id,
          },
        },
        { session: s },
      );
      if (!c) return false;
      await agregarHistorial(
        v.incidenciaId,
        {
          tipo: "visita",
          texto: `Visita del ${formatearFechaHora(v.fecha)} cancelada.`,
        },
        req.usuario,
        s,
      );
      await col("incidencias").updateOne(
        { _id: v.incidenciaId },
        { $set: { actualizada: new Date() } },
        { session: s },
      );
      return true;
    });
    avisar(
      req,
      hecho ? "Visita cancelada." : "La visita ya estaba cerrada.",
      hecho ? "exito" : "error",
    );
    return res.redirect(`/visitas/${v._id}`);
  }),
);

module.exports = r;
