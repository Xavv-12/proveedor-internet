"use strict";
const express = require("express");
const E = require("../lib/esquemas");
const { col, aId, enTransaccion } = require("../db");
const { permitir } = require("../middleware/sesion");
const { verificarCsrf } = require("../middleware/csrf");
const { puede } = require("../permisos");
const { obtenerConfig } = require("../config");
const {
  envolver,
  filtroBusqueda,
  paginacion,
  navegacion,
  erroresZod,
  avisar,
  textoBusqueda,
  capital,
} = require("../lib/util");
const { auditarReq } = require("../lib/auditoria");
const { siguienteFolio } = require("../lib/folios");
const { formatearFechaHora } = require("../lib/fechas");
const {
  recibirArchivo,
  detectarTipo,
  guardarEvidencia,
  rutaEvidencia,
  borrarEvidencia,
  nombreOriginalSeguro,
} = require("../lib/archivos");
const {
  renderLista,
  renderDetalle,
  renderFormulario,
  llenar,
  insignia,
  insigniaEstado,
  opciones,
  filtroSelect,
} = require("../lib/vistas");
const {
  ESTADOS_INCIDENCIA,
  INCIDENCIA_ABIERTA,
  PRIORIDADES,
  agregarHistorial,
} = require("../servicios/incidencias");

const r = express.Router();
const leer = permitir("incidencias", "leer");
const escribir = permitir("incidencias", "escribir");
const TONO_PRIORIDAD = {
  baja: "gris",
  media: "azul",
  alta: "ambar",
  urgente: "rojo",
};

r.get(
  "/",
  leer,
  envolver(async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 80);
    const vista = ["abiertas", "todas", ...ESTADOS_INCIDENCIA].includes(
      req.query.estado,
    )
      ? req.query.estado
      : "abiertas";
    const filtro = { ...filtroBusqueda(q) };
    if (vista === "abiertas") filtro.estado = { $in: INCIDENCIA_ABIERTA };
    else if (vista !== "todas") filtro.estado = vista;
    const { pagina, salto, limite } = paginacion(req);
    const [docs, total] = await Promise.all([
      col("incidencias")
        .find(filtro)
        .sort({ creada: -1 })
        .skip(salto)
        .limit(limite)
        .toArray(),
      col("incidencias").countDocuments(filtro),
    ]);
    renderLista(res, {
      titulo: "Incidencias",
      accionBusqueda: "/incidencias",
      q,
      filtros: [
        filtroSelect("estado", "Mostrar", vista, [
          { valor: "abiertas", texto: "Abiertas" },
          { valor: "todas", texto: "Todas" },
          ...opciones(ESTADOS_INCIDENCIA),
        ]),
      ],
      enlaceNuevo: puede(req.usuario, "incidencias", "escribir")
        ? "/incidencias/nueva"
        : null,
      textoNuevo: "Nueva incidencia",
      filas: docs.map((d) => ({
        enlace: `/incidencias/${d._id}`,
        titulo: `${d.folio} · ${d.titulo}`,
        subtitulo: `${d.contratoFolio} · ${d.clienteNombre || ""}`,
        insignia: insigniaEstado(d.estado),
        campos: [
          { etiqueta: "Prioridad", valor: capital(d.prioridad) },
          { etiqueta: "Registrada", valor: formatearFechaHora(d.creada) },
        ],
      })),
      nav: navegacion(req, total, pagina),
      vacio:
        vista === "abiertas"
          ? "No hay incidencias abiertas."
          : "No hay incidencias que coincidan.",
    });
  }),
);

const camposNueva = [
  {
    nombre: "contratoFolio",
    etiqueta: "Folio del contrato",
    tipo: "text",
    requerido: true,
    autocapitalize: "characters",
    ayuda: "Ej. CTR-2026-00001",
  },
  {
    nombre: "titulo",
    etiqueta: "Resumen del problema",
    tipo: "text",
    requerido: true,
    max: 120,
  },
  {
    nombre: "descripcion",
    etiqueta: "Descripción",
    tipo: "textarea",
    requerido: true,
    max: 2000,
    filas: 4,
  },
  {
    nombre: "prioridad",
    etiqueta: "Prioridad",
    tipo: "select",
    requerido: true,
    opciones: opciones(PRIORIDADES),
  },
];
const esquemaNueva = () =>
  E.z.object({
    contratoFolio: E.cadena(
      (s) => s.min(1, "El folio del contrato es obligatorio.").max(20),
      (v) => E.limpio(v).toUpperCase(),
    ),
    titulo: E.texto(3, 120, "El resumen"),
    descripcion: E.texto(5, 2000, "La descripción"),
    prioridad: E.opcion(PRIORIDADES, "prioridad"),
  });
const formNueva = (res, valores, errores = {}, estado = 200) =>
  renderFormulario(
    res,
    {
      titulo: "Nueva incidencia",
      accion: "/incidencias",
      cancelar: "/incidencias",
      boton: "Registrar incidencia",
      campos: llenar(camposNueva, valores),
      errores,
    },
    estado,
  );

r.get("/nueva", escribir, (req, res) =>
  formNueva(res, {
    contratoFolio: String(req.query.contrato || "").slice(0, 20),
    prioridad: "media",
  }),
);

r.post(
  "/",
  escribir,
  envolver(async (req, res) => {
    const v = esquemaNueva().safeParse(req.body);
    if (!v.success) return formNueva(res, req.body, erroresZod(v.error), 422);
    const d = v.data;
    const contrato = await col("contratos").findOne(
      { folio: d.contratoFolio },
      { projection: { folio: 1, clienteNombre: 1, direccionInstalacion: 1 } },
    );
    if (!contrato)
      return formNueva(
        res,
        req.body,
        { contratoFolio: "No existe un contrato con ese folio." },
        422,
      );
    const folio = await siguienteFolio("INC");
    const ahora = new Date();
    const doc = {
      folio,
      contratoId: contrato._id,
      contratoFolio: contrato.folio,
      clienteNombre: contrato.clienteNombre,
      direccion: contrato.direccionInstalacion,
      titulo: d.titulo,
      descripcion: d.descripcion,
      prioridad: d.prioridad,
      estado: "abierta",
      creada: ahora,
      actualizada: ahora,
      creadoPor: req.usuario._id,
      busqueda: textoBusqueda(
        folio,
        d.titulo,
        contrato.folio,
        contrato.clienteNombre,
      ),
    };
    await enTransaccion(async (s) => {
      await col("incidencias").insertOne(doc, { session: s });
      await agregarHistorial(
        doc._id,
        { tipo: "alta", texto: "Incidencia registrada.", a: "abierta" },
        req.usuario,
        s,
      );
      await auditarReq(
        req,
        "incidencia.alta",
        { folio, contrato: contrato.folio, prioridad: d.prioridad },
        s,
      );
    });
    avisar(req, `Incidencia ${folio} registrada.`);
    return res.redirect(`/incidencias/${doc._id}`);
  }),
);

async function buscarIncidencia(req, next) {
  const id = aId(req.params.id);
  const inc = id ? await col("incidencias").findOne({ _id: id }) : null;
  if (!inc) next();
  return inc;
}

r.get(
  "/:id",
  leer,
  envolver(async (req, res, next) => {
    const inc = await buscarIncidencia(req, next);
    if (!inc) return;
    const puedeEscribir = puede(req.usuario, "incidencias", "escribir");
    const [historial, visitas, evidencias] = await Promise.all([
      col("incidencias_historial")
        .find({ incidenciaId: inc._id })
        .sort({ fecha: 1 })
        .limit(300)
        .toArray(),
      col("visitas")
        .find({ incidenciaId: inc._id })
        .sort({ fecha: -1 })
        .limit(20)
        .toArray(),
      col("evidencias")
        .find({ incidenciaId: inc._id })
        .sort({ subido: -1 })
        .limit(50)
        .toArray(),
    ]);
    const bloques = [
      {
        tipo: "datos",
        insignia: insigniaEstado(inc.estado),
        filas: [
          {
            etiqueta: "Contrato",
            valor: inc.contratoFolio,
            enlace: `/contratos/${inc.contratoId}`,
          },
          { etiqueta: "Cliente", valor: inc.clienteNombre || "—" },
          { etiqueta: "Dirección", valor: inc.direccion || "—" },
          { etiqueta: "Prioridad", valor: capital(inc.prioridad) },
          { etiqueta: "Descripción", valor: inc.descripcion },
          { etiqueta: "Registrada", valor: formatearFechaHora(inc.creada) },
        ],
      },
      {
        tipo: "lista",
        titulo: "Historial",
        nota: "Las entradas no se editan ni se borran. Para corregir algo, agrega una nota nueva.",
        vacio: "Sin movimientos.",
        elementos: historial.map((h) => ({
          titulo:
            h.texto ||
            (h.tipo === "estado"
              ? `Estado: ${h.de} → ${h.a}`
              : capital(h.tipo)),
          subtitulo: `${formatearFechaHora(h.fecha)} · ${h.usuarioNombre}`,
          detalle:
            h.tipo === "estado" && h.texto ? `Estado: ${h.de} → ${h.a}` : "",
        })),
      },
      {
        tipo: "lista",
        titulo: "Visitas",
        vacio: "Sin visitas.",
        elementos: visitas.map((v) => ({
          titulo: formatearFechaHora(v.fecha),
          subtitulo: v.tecnicoNombre,
          enlace: `/visitas/${v._id}`,
          insignia: insigniaEstado(v.estado),
        })),
      },
      {
        tipo: "lista",
        titulo: "Evidencias",
        vacio: "Sin evidencias.",
        elementos: evidencias.map((ev) => ({
          titulo: ev.nombreOriginal,
          subtitulo: `${formatearFechaHora(ev.subido)} · ${ev.subidoPorNombre || ""}`,
          detalle: `${Math.ceil(ev.tamano / 1024)} KB`,
          enlace: `/incidencias/${inc._id}/evidencias/${ev._id}`,
          insignia: insignia(
            ev.tipo === "application/pdf" ? "PDF" : "Foto",
            "gris",
          ),
        })),
      },
    ];
    if (puedeEscribir) {
      const maxMb = Math.round(obtenerConfig().maxUploadBytes / 1048576);
      bloques.push(
        {
          tipo: "botones",
          botones: [
            {
              texto: "Agendar visita",
              enlace: `/visitas/nueva?incidencia=${encodeURIComponent(inc.folio)}`,
            },
          ],
        },
        {
          tipo: "formulario",
          titulo: "Agregar nota",
          accion: `/incidencias/${inc._id}/notas`,
          campos: llenar([
            {
              nombre: "texto",
              etiqueta: "Nota",
              tipo: "textarea",
              requerido: true,
              max: 2000,
            },
          ]),
          boton: "Agregar nota",
        },
        {
          tipo: "formulario",
          titulo: "Cambiar estado",
          accion: `/incidencias/${inc._id}/estado`,
          campos: llenar(
            [
              {
                nombre: "estado",
                etiqueta: "Nuevo estado",
                tipo: "select",
                opciones: opciones(ESTADOS_INCIDENCIA),
              },
              {
                nombre: "comentario",
                etiqueta: "Comentario",
                tipo: "textarea",
                max: 1000,
              },
            ],
            { estado: inc.estado },
          ),
          boton: "Cambiar estado",
        },
        {
          tipo: "formulario",
          titulo: "Subir evidencia",
          accion: `/incidencias/${inc._id}/evidencias`,
          multipart: true,
          campos: llenar([
            {
              nombre: "archivo",
              etiqueta: "Foto o PDF",
              tipo: "file",
              requerido: true,
              aceptar: "image/jpeg,image/png,image/webp,application/pdf",
              capturar: "environment",
            },
          ]),
          boton: "Subir evidencia",
          nota: `Fotos JPG, PNG o WEBP, o PDF. Máximo ${maxMb} MB.`,
        },
      );
    }
    renderDetalle(res, {
      titulo: inc.folio,
      subtitulo: inc.titulo,
      volver: "/incidencias",
      bloques,
    });
  }),
);

r.post(
  "/:id/notas",
  escribir,
  envolver(async (req, res, next) => {
    const inc = await buscarIncidencia(req, next);
    if (!inc) return;
    const v = E.texto(2, 2000, "La nota").safeParse(req.body.texto);
    if (!v.success) {
      avisar(req, v.error.issues[0].message, "error");
    } else {
      await enTransaccion(async (s) => {
        await agregarHistorial(
          inc._id,
          { tipo: "nota", texto: v.data },
          req.usuario,
          s,
        );
        await col("incidencias").updateOne(
          { _id: inc._id },
          { $set: { actualizada: new Date() } },
          { session: s },
        );
      });
      avisar(req, "Nota agregada.");
    }
    return res.redirect(`/incidencias/${inc._id}`);
  }),
);

r.post(
  "/:id/estado",
  escribir,
  envolver(async (req, res, next) => {
    const inc = await buscarIncidencia(req, next);
    if (!inc) return;
    const estado = String(req.body.estado || "");
    const comentario = E.textoOpcional(1000).safeParse(req.body.comentario);
    if (!ESTADOS_INCIDENCIA.includes(estado) || !comentario.success) {
      avisar(req, "Revisa el estado y el comentario.", "error");
      return res.redirect(`/incidencias/${inc._id}`);
    }
    const cambio = await enTransaccion(async (s) => {
      const antes = await col("incidencias").findOneAndUpdate(
        { _id: inc._id, estado: { $ne: estado } },
        { $set: { estado, actualizada: new Date() } },
        { session: s, returnDocument: "before" },
      );
      if (!antes) return null;
      await agregarHistorial(
        inc._id,
        {
          tipo: "estado",
          texto: comentario.data || `Estado: ${antes.estado} → ${estado}`,
          de: antes.estado,
          a: estado,
        },
        req.usuario,
        s,
      );
      await auditarReq(
        req,
        "incidencia.estado",
        { folio: inc.folio, de: antes.estado, a: estado },
        s,
      );
      return antes.estado;
    });
    avisar(
      req,
      cambio
        ? `Estado actualizado a ${estado}.`
        : "La incidencia ya tenía ese estado.",
      cambio ? "exito" : "error",
    );
    return res.redirect(`/incidencias/${inc._id}`);
  }),
);

// Multipart: multer lee el cuerpo y después se verifica el token CSRF.
r.post(
  "/:id/evidencias",
  escribir,
  (req, res, next) =>
    recibirArchivo("archivo", obtenerConfig().maxUploadBytes)(req, res, next),
  verificarCsrf,
  envolver(async (req, res, next) => {
    const inc = await buscarIncidencia(req, next);
    if (!inc) return;
    const volver = `/incidencias/${inc._id}`;
    if (req.errorArchivo) {
      avisar(req, req.errorArchivo, "error");
      return res.redirect(volver);
    }
    if (!req.file || !req.file.buffer?.length) {
      avisar(req, "Elige un archivo.", "error");
      return res.redirect(volver);
    }
    const tipo = detectarTipo(req.file.buffer);
    if (!tipo) {
      avisar(
        req,
        "Solo se aceptan fotos JPG, PNG o WEBP y archivos PDF.",
        "error",
      );
      return res.redirect(volver);
    }
    const nombre = await guardarEvidencia(req.file.buffer, tipo);
    const original = nombreOriginalSeguro(req.file.originalname);
    try {
      await enTransaccion(async (s) => {
        await col("evidencias").insertOne(
          {
            incidenciaId: inc._id,
            archivo: nombre,
            tipo: tipo.tipo,
            ext: tipo.ext,
            tamano: req.file.size,
            nombreOriginal: original,
            subido: new Date(),
            subidoPor: req.usuario._id,
            subidoPorNombre: req.usuario.nombre,
          },
          { session: s },
        );
        await agregarHistorial(
          inc._id,
          { tipo: "evidencia", texto: `Evidencia agregada: ${original}` },
          req.usuario,
          s,
        );
      });
    } catch (e) {
      await borrarEvidencia(nombre);
      throw e;
    }
    avisar(req, "Evidencia guardada.");
    return res.redirect(volver);
  }),
);

// Las evidencias viven fuera de la carpeta pública y solo se entregan por esta ruta con permiso.
r.get(
  "/:id/evidencias/:evidenciaId",
  leer,
  envolver(async (req, res, next) => {
    const incId = aId(req.params.id);
    const evId = aId(req.params.evidenciaId);
    const ev =
      incId && evId
        ? await col("evidencias").findOne({ _id: evId, incidenciaId: incId })
        : null;
    if (!ev) return next();
    const disposicion = ev.tipo === "application/pdf" ? "attachment" : "inline";
    res.sendFile(
      rutaEvidencia(ev.archivo),
      {
        headers: {
          "Content-Type": ev.tipo,
          "Content-Disposition": `${disposicion}; filename="evidencia-${ev._id}.${ev.ext}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
      (err) => {
        if (err && !res.headersSent) next();
      },
    );
  }),
);

module.exports = r;
