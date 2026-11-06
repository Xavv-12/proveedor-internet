"use strict";
const express = require("express");
const { col, aId } = require("../db");
const { permitir } = require("../middleware/sesion");
const { verificarCsrf } = require("../middleware/csrf");
const { obtenerConfig } = require("../config");
const {
  envolver,
  filtroBusqueda,
  paginacion,
  navegacion,
  avisar,
  ErrorNegocio,
  rutaInterna,
} = require("../lib/util");
const { aCentavos, formatear, centavosATexto } = require("../lib/dinero");
const {
  formatearFecha,
  formatearFechaHora,
  periodoTexto,
} = require("../lib/fechas");
const { formatearTelefono } = require("../lib/telefono");
const { recibirArchivo } = require("../lib/archivos");
const { auditarReq } = require("../lib/auditoria");
const {
  renderLista,
  renderDetalle,
  llenar,
  insignia,
  insigniaEstado,
  opciones,
  filtroSelect,
} = require("../lib/vistas");
const cobranza = require("../servicios/cobranza");
const {
  importarCsv,
  conciliarMovimientos,
} = require("../servicios/conciliacion");
const { enviarRecordatorio } = require("../servicios/recordatorios");
const {
  aceptarComprobante,
  rechazarComprobante,
} = require("../servicios/comprobantes");
const { rutaEvidencia } = require("../lib/archivos");

const { NOMBRES_METODO } = cobranza;
const ctx = (req) => ({ usuario: req.usuario, ip: req.ip });

/* ===================== Pagos y cobranza ===================== */
const rCobranza = express.Router();
const leerCob = permitir("cobranza", "leer");
const escribirCob = permitir("cobranza", "escribir");

const VISTAS = {
  pendientes: {
    texto: "Pendientes",
    filtro: { estado: { $in: cobranza.ABIERTAS } },
  },
  vencidas: { texto: "Vencidas", filtro: { estado: "VENCIDA" } },
  pagadas: { texto: "Pagadas", filtro: { estado: "PAGADA" } },
  canceladas: { texto: "Canceladas", filtro: { estado: "CANCELADA" } },
  todas: { texto: "Todas", filtro: {} },
  "por-validar": { texto: "Pagos por validar", filtro: null },
  comprobantes: { texto: "Comprobantes de clientes por revisar", filtro: null },
};

/** Botones y formulario de revisión de un comprobante enviado desde el portal del cliente. */
function bloquesComprobante(c, volver) {
  return {
    titulo: `${formatear(c.monto)} · ${NOMBRES_METODO[c.metodo] || c.metodo}`,
    subtitulo: `Ref. ${c.referencia} · ${c.contratoFolio} · ${periodoTexto(c.periodo)}`,
    detalle: `Recibido ${formatearFechaHora(c.creado)}${c.fechaPago ? ` · pagado el ${formatearFecha(c.fechaPago)}` : ""}${c.motivo ? ` · Motivo: ${c.motivo}` : ""}`,
    insignia: insigniaEstado(
      c.estado === "por revisar"
        ? "por validar"
        : c.estado === "aceptado"
          ? "validado"
          : "rechazado",
    ),
    enlace: `/cobranza/${c.mensualidadId}`,
    botones: [
      {
        texto: "Ver comprobante",
        enlace: `/cobranza/comprobantes/${c._id}/archivo`,
        estilo: "secundario",
      },
      ...(c.estado === "por revisar"
        ? [
            {
              texto: "Aceptar y aplicar pago",
              accion: `/cobranza/comprobantes/${c._id}/aceptar`,
              confirmar:
                "¿Confirmas que el dinero llegó? Se registrará el pago como validado.",
              campos: [{ nombre: "volver", valor: volver }],
            },
          ]
        : []),
    ],
  };
}

rCobranza.get(
  "/",
  leerCob,
  envolver(async (req, res) => {
    await cobranza.marcarVencidas(); // vencimiento también al abrir la vista
    const vista = VISTAS[req.query.vista] ? req.query.vista : "pendientes";
    const q = String(req.query.q ?? "").slice(0, 80);
    const { pagina, salto, limite } = paginacion(req);
    const filtros = [
      filtroSelect(
        "vista",
        "Mostrar",
        vista,
        Object.entries(VISTAS).map(([valor, v]) => ({ valor, texto: v.texto })),
      ),
    ];

    if (vista === "comprobantes") {
      const filtro = { estado: "por revisar", ...filtroBusqueda(q) };
      const [comps, total] = await Promise.all([
        col("comprobantes")
          .find(filtro)
          .sort({ creado: 1 })
          .skip(salto)
          .limit(limite)
          .toArray(),
        col("comprobantes").countDocuments(filtro),
      ]);
      return renderLista(res, {
        titulo: "Comprobantes por revisar",
        accionBusqueda: "/cobranza",
        q,
        filtros,
        filas: comps.map((c) => {
          const b = bloquesComprobante(c, req.originalUrl);
          return {
            ...b,
            campos: [
              { etiqueta: "Cliente", valor: c.clienteNombre },
              { etiqueta: "Recibido", valor: formatearFechaHora(c.creado) },
            ],
          };
        }),
        nav: navegacion(req, total, pagina),
        vacio: "No hay comprobantes por revisar.",
      });
    }

    if (vista === "por-validar") {
      const filtro = { estado: "por validar" };
      if (q)
        filtro.referencia = {
          $regex: q.toUpperCase().replace(/[^A-Z0-9\-_/.]/g, ""),
        };
      const [pagos, total] = await Promise.all([
        col("pagos")
          .find(filtro)
          .sort({ registrado: 1 })
          .skip(salto)
          .limit(limite)
          .toArray(),
        col("pagos").countDocuments(filtro),
      ]);
      return renderLista(res, {
        titulo: "Pagos por validar",
        accionBusqueda: "/cobranza",
        q,
        filtros,
        filas: pagos.map((p) => ({
          enlace: `/cobranza/${p.mensualidadId}`,
          titulo: `${formatear(p.monto)} · ${NOMBRES_METODO[p.metodo]}`,
          subtitulo: `${p.referencia} · ${p.contratoFolio} · ${periodoTexto(p.periodo)}`,
          insignia: insigniaEstado(p.estado),
          campos: [
            {
              etiqueta: "Registrado",
              valor: `${formatearFechaHora(p.registrado)} por ${p.registradoPorNombre || "—"}`,
            },
          ],
          botones: [
            {
              texto: "Validar",
              accion: `/cobranza/pagos/${p._id}/validar`,
              campos: [{ nombre: "volver", valor: req.originalUrl }],
            },
            {
              texto: "Rechazar",
              accion: `/cobranza/pagos/${p._id}/rechazar`,
              estilo: "peligro",
              confirmar: "¿Rechazar este pago?",
              campos: [{ nombre: "volver", valor: req.originalUrl }],
            },
          ],
        })),
        nav: navegacion(req, total, pagina),
        vacio: "No hay pagos por validar.",
      });
    }

    const filtro = { ...VISTAS[vista].filtro, ...filtroBusqueda(q) };
    const [docs, total] = await Promise.all([
      col("mensualidades")
        .find(filtro)
        .sort({ fechaLimite: 1 })
        .skip(salto)
        .limit(limite)
        .toArray(),
      col("mensualidades").countDocuments(filtro),
    ]);
    return renderLista(res, {
      titulo: "Pagos y cobranza",
      accionBusqueda: "/cobranza",
      q,
      filtros,
      filas: docs.map((m) => ({
        enlace: `/cobranza/${m._id}`,
        titulo: `${m.contratoFolio} · ${periodoTexto(m.periodo)}`,
        subtitulo: m.clienteNombre,
        insignia: insigniaEstado(m.estado),
        campos: [
          { etiqueta: "Saldo", valor: formatear(m.importe - m.pagado) },
          { etiqueta: "Vence", valor: formatearFecha(m.fechaLimite) },
          ...(m.enValidacion
            ? [{ etiqueta: "Por validar", valor: formatear(m.enValidacion) }]
            : []),
        ],
      })),
      nav: navegacion(req, total, pagina),
      vacio:
        "No hay mensualidades en esta vista. Se generan desde el detalle de cada contrato.",
    });
  }),
);

rCobranza.get(
  "/:id",
  leerCob,
  envolver(async (req, res, next) => {
    await cobranza.marcarVencidas();
    const id = aId(req.params.id);
    const m = id ? await col("mensualidades").findOne({ _id: id }) : null;
    if (!m) return next();
    const pagos = await col("pagos")
      .find({ mensualidadId: m._id })
      .sort({ registrado: 1 })
      .toArray();
    const disponible = Math.max(0, m.importe - m.pagado - m.enValidacion);
    const volver = req.originalUrl;
    const bloques = [
      {
        tipo: "datos",
        insignia: insigniaEstado(m.estado),
        filas: [
          {
            etiqueta: "Contrato",
            valor: m.contratoFolio,
            enlace: `/contratos/${m.contratoId}`,
          },
          { etiqueta: "Cliente", valor: m.clienteNombre },
          { etiqueta: "Fecha límite", valor: formatearFecha(m.fechaLimite) },
          { etiqueta: "Importe", valor: formatear(m.importe) },
          { etiqueta: "Pagado y validado", valor: formatear(m.pagado) },
          { etiqueta: "Por validar", valor: formatear(m.enValidacion) },
          {
            etiqueta: "Saldo pendiente",
            valor: formatear(m.importe - m.pagado),
            destacado: true,
          },
        ],
      },
      {
        tipo: "lista",
        titulo: "Pagos",
        vacio: "Sin pagos registrados.",
        elementos: pagos.map((p) => ({
          titulo: `${formatear(p.monto)} · ${NOMBRES_METODO[p.metodo]}`,
          subtitulo: `${p.referencia} · ${formatearFechaHora(p.registrado)}`,
          detalle: p.conciliado ? "Conciliado con el banco" : "",
          insignia: insigniaEstado(p.estado),
          botones:
            p.estado === "por validar"
              ? [
                  {
                    texto: "Validar",
                    accion: `/cobranza/pagos/${p._id}/validar`,
                    campos: [{ nombre: "volver", valor: volver }],
                  },
                  {
                    texto: "Rechazar",
                    accion: `/cobranza/pagos/${p._id}/rechazar`,
                    estilo: "peligro",
                    confirmar: "¿Rechazar este pago?",
                    campos: [{ nombre: "volver", valor: volver }],
                  },
                ]
              : [],
        })),
      },
    ];
    if (cobranza.ABIERTAS.includes(m.estado) && disponible > 0) {
      bloques.push({
        tipo: "formulario",
        titulo: "Registrar pago",
        accion: `/cobranza/${m._id}/pagos`,
        campos: llenar(
          [
            {
              nombre: "monto",
              etiqueta: "Monto",
              tipo: "dinero",
              requerido: true,
            },
            {
              nombre: "metodo",
              etiqueta: "Método",
              tipo: "select",
              requerido: true,
              opciones: opciones(
                cobranza.METODOS.map((v) => ({
                  valor: v,
                  texto: NOMBRES_METODO[v],
                })),
              ),
            },
            {
              nombre: "referencia",
              etiqueta: "Referencia",
              tipo: "text",
              autocapitalize: "characters",
              ayuda:
                "Obligatoria para transferencia, depósito y tarjeta. En efectivo se genera si la dejas vacía.",
            },
          ],
          { monto: centavosATexto(disponible), metodo: "efectivo" },
        ),
        boton: "Registrar pago",
        nota: `Puedes cobrar hasta ${formatear(disponible)}. El efectivo queda validado al registrarlo; transferencia, depósito y tarjeta quedan por validar.`,
        confirmar: "¿Registrar este pago?",
      });
    }
    const comprobantes = await col("comprobantes")
      .find({ mensualidadId: m._id })
      .sort({ creado: -1 })
      .limit(20)
      .toArray();
    if (comprobantes.length) {
      bloques.push({
        tipo: "lista",
        titulo: "Comprobantes enviados por el cliente",
        elementos: comprobantes.map((c) => bloquesComprobante(c, volver)),
      });
      for (const c of comprobantes.filter((x) => x.estado === "por revisar")) {
        bloques.push({
          tipo: "formulario",
          titulo: `Rechazar comprobante ${c.referencia}`,
          accion: `/cobranza/comprobantes/${c._id}/rechazar`,
          campos: llenar([
            {
              nombre: "motivo",
              etiqueta: "Motivo (el cliente lo verá en su portal)",
              tipo: "textarea",
              requerido: true,
              max: 300,
              filas: 2,
            },
            { nombre: "volver", tipo: "hidden", valor: volver },
          ]),
          boton: "Rechazar comprobante",
        });
      }
    }
    if (
      cobranza.ABIERTAS.includes(m.estado) &&
      m.pagado === 0 &&
      m.enValidacion === 0
    ) {
      bloques.push({
        tipo: "botones",
        botones: [
          {
            texto: "Cancelar mensualidad",
            accion: `/cobranza/${m._id}/cancelar`,
            estilo: "peligro",
            confirmar: "¿Cancelar esta mensualidad? Ya no se podrá cobrar.",
          },
        ],
      });
    }
    return renderDetalle(res, {
      titulo: periodoTexto(m.periodo),
      subtitulo: `${m.contratoFolio} · ${m.clienteNombre}`,
      volver: "/cobranza",
      bloques,
    });
  }),
);

rCobranza.post(
  "/:id/pagos",
  escribirCob,
  envolver(async (req, res, next) => {
    const id = aId(req.params.id);
    if (!id) return next();
    try {
      const monto = aCentavos(String(req.body.monto ?? ""));
      if (!monto)
        throw new ErrorNegocio(
          "Escribe un monto válido, por ejemplo 200.00.",
          422,
        );
      const metodo = String(req.body.metodo || "");
      if (metodo !== "efectivo" && !String(req.body.referencia || "").trim())
        throw new ErrorNegocio("Escribe la referencia del pago.", 422);
      const { pago } = await cobranza.registrarPago({
        mensualidadId: id,
        monto,
        metodo,
        referencia: req.body.referencia,
        ...ctx(req),
      });
      avisar(
        req,
        pago.estado === "validado"
          ? `Pago de ${formatear(monto)} registrado y validado.`
          : `Pago de ${formatear(monto)} registrado. Queda por validar.`,
      );
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(`/cobranza/${id}`);
  }),
);

for (const accion of ["validar", "rechazar"]) {
  rCobranza.post(
    `/pagos/:pagoId/${accion}`,
    escribirCob,
    envolver(async (req, res, next) => {
      const id = aId(req.params.pagoId);
      if (!id) return next();
      let destino = "/cobranza?vista=por-validar";
      try {
        const { pago } =
          accion === "validar"
            ? await cobranza.validarPago(id, ctx(req))
            : await cobranza.rechazarPago(id, ctx(req));
        destino = `/cobranza/${pago.mensualidadId}`;
        avisar(
          req,
          accion === "validar" ? "Pago validado." : "Pago rechazado.",
        );
      } catch (e) {
        if (!(e instanceof ErrorNegocio)) throw e;
        avisar(req, e.message, "error");
      }
      return res.redirect(rutaInterna(req.body.volver, destino));
    }),
  );
}

rCobranza.post(
  "/comprobantes/:cid/aceptar",
  escribirCob,
  envolver(async (req, res, next) => {
    const id = aId(req.params.cid);
    if (!id) return next();
    try {
      await aceptarComprobante(id, ctx(req));
      avisar(req, "Comprobante aceptado. El pago quedó aplicado.");
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(
      rutaInterna(req.body.volver, "/cobranza?vista=comprobantes"),
    );
  }),
);

rCobranza.post(
  "/comprobantes/:cid/rechazar",
  escribirCob,
  envolver(async (req, res, next) => {
    const id = aId(req.params.cid);
    if (!id) return next();
    try {
      await rechazarComprobante(id, req.body.motivo, ctx(req));
      avisar(
        req,
        "Comprobante rechazado. El cliente verá el motivo en su portal.",
      );
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(
      rutaInterna(req.body.volver, "/cobranza?vista=comprobantes"),
    );
  }),
);

// El archivo del comprobante es privado: solo personal con permiso de cobranza.
rCobranza.get(
  "/comprobantes/:cid/archivo",
  leerCob,
  envolver(async (req, res, next) => {
    const id = aId(req.params.cid);
    const c = id ? await col("comprobantes").findOne({ _id: id }) : null;
    if (!c) return next();
    res.sendFile(
      rutaEvidencia(c.archivo),
      {
        headers: {
          "Content-Type": c.tipo,
          "Content-Disposition": `${c.tipo === "application/pdf" ? "attachment" : "inline"}; filename="comprobante-${c._id}.${c.ext}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
      (err) => {
        if (err && !res.headersSent) next();
      },
    );
    return undefined;
  }),
);

rCobranza.post(
  "/:id/cancelar",
  escribirCob,
  envolver(async (req, res, next) => {
    const id = aId(req.params.id);
    if (!id) return next();
    try {
      await cobranza.cancelarMensualidad(id, ctx(req));
      avisar(req, "Mensualidad cancelada.");
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(`/cobranza/${id}`);
  }),
);

/* ===================== Prioridad de cobranza ===================== */
const rPrioridad = express.Router();

rPrioridad.get(
  "/",
  permitir("prioridad", "leer"),
  envolver(async (req, res) => {
    await cobranza.marcarVencidas();
    const ahora = new Date();
    const q = String(req.query.q ?? "").slice(0, 80);
    const { pagina, salto, limite } = paginacion(req);
    const [r] = await col("mensualidades")
      .aggregate([
        {
          $match: {
            estado: { $in: cobranza.ABIERTAS },
            fechaLimite: { $lt: ahora },
            ...filtroBusqueda(q),
          },
        },
        {
          $group: {
            _id: "$contratoId",
            folio: { $first: "$contratoFolio" },
            cliente: { $first: "$clienteNombre" },
            clienteId: { $first: "$clienteId" },
            saldo: { $sum: { $subtract: ["$importe", "$pagado"] } },
            porValidar: { $sum: "$enValidacion" },
            meses: { $sum: 1 },
            masAntigua: { $min: "$fechaLimite" },
          },
        },
        {
          $addFields: {
            diasAtraso: {
              $dateDiff: {
                startDate: "$masAntigua",
                endDate: ahora,
                unit: "day",
                timezone: "America/Mexico_City",
              },
            },
          },
        },
        { $sort: { diasAtraso: -1, saldo: -1, _id: 1 } },
        {
          $facet: {
            filas: [{ $skip: salto }, { $limit: limite }],
            total: [{ $count: "n" }],
          },
        },
      ])
      .toArray();
    const filas = r.filas;
    const total = r.total[0]?.n || 0;
    const clientes = await col("clientes")
      .find({ _id: { $in: filas.map((f) => f.clienteId) } })
      .project({ telefono: 1 })
      .toArray();
    const tel = new Map(clientes.map((c) => [String(c._id), c.telefono]));
    renderLista(res, {
      titulo: "Prioridad de cobranza",
      accionBusqueda: "/prioridad-de-cobranza",
      q,
      filas: filas.map((f) => ({
        enlace: `/contratos/${f._id}`,
        titulo: `${f.cliente}`,
        subtitulo: `${f.folio} · ${formatearTelefono(tel.get(String(f.clienteId)))}`,
        insignia: insignia(
          `${f.diasAtraso} ${f.diasAtraso === 1 ? "día" : "días"} de atraso`,
          f.diasAtraso > 30 ? "rojo" : "ambar",
        ),
        campos: [
          { etiqueta: "Saldo vencido", valor: formatear(f.saldo) },
          { etiqueta: "Meses", valor: String(f.meses) },
          ...(f.porValidar
            ? [{ etiqueta: "Por validar", valor: formatear(f.porValidar) }]
            : []),
        ],
        botones: [
          {
            texto: "Enviar recordatorio por WhatsApp",
            accion: `/prioridad-de-cobranza/${f._id}/recordatorio`,
            estilo: "secundario",
            campos: [{ nombre: "volver", valor: req.originalUrl }],
          },
        ],
      })),
      nav: navegacion(req, total, pagina),
      vacio: "No hay contratos con atraso.",
    });
  }),
);

rPrioridad.post(
  "/:contratoId/recordatorio",
  permitir("prioridad", "escribir"),
  envolver(async (req, res, next) => {
    const id = aId(req.params.contratoId);
    if (!id) return next();
    try {
      await enviarRecordatorio(id, ctx(req));
      avisar(req, "Recordatorio enviado por WhatsApp.");
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(rutaInterna(req.body.volver, "/prioridad-de-cobranza"));
  }),
);

/* ===================== Conciliación bancaria ===================== */
const rConciliacion = express.Router();
const leerCon = permitir("conciliacion", "leer");
const escribirCon = permitir("conciliacion", "escribir");

rConciliacion.get(
  "/",
  leerCon,
  envolver(async (req, res) => {
    const vista = ["sin-coincidencia", "coinciden", "todos"].includes(
      req.query.vista,
    )
      ? req.query.vista
      : "sin-coincidencia";
    const q = String(req.query.q ?? "").slice(0, 80);
    const filtro = { ...filtroBusqueda(q) };
    if (vista === "sin-coincidencia") filtro.estado = "sin coincidencia";
    if (vista === "coinciden") filtro.estado = "coincide";
    const { pagina, salto, limite } = paginacion(req);
    const [movs, total, importaciones] = await Promise.all([
      col("movimientos_bancarios")
        .find(filtro)
        .sort({ fecha: -1, _id: -1 })
        .skip(salto)
        .limit(limite)
        .toArray(),
      col("movimientos_bancarios").countDocuments(filtro),
      col("importaciones")
        .find()
        .sort({ creado: -1 })
        .limit(5)
        .project({ errores: 0 })
        .toArray(),
    ]);
    const pagos = await col("pagos")
      .find({ _id: { $in: movs.map((m) => m.pagoId).filter(Boolean) } })
      .project({ estado: 1, mensualidadId: 1 })
      .toArray();
    const pagoPorId = new Map(pagos.map((p) => [String(p._id), p]));
    const maxMb = Math.min(
      5,
      Math.round(obtenerConfig().maxUploadBytes / 1048576),
    );
    renderLista(res, {
      titulo: "Conciliación bancaria",
      accionBusqueda: "/conciliacion-bancaria",
      q,
      filtros: [
        filtroSelect("vista", "Mostrar", vista, [
          { valor: "sin-coincidencia", texto: "Sin coincidencia" },
          { valor: "coinciden", texto: "Con coincidencia" },
          { valor: "todos", texto: "Todos" },
        ]),
      ],
      bloquesSuperiores: [
        {
          tipo: "formulario",
          titulo: "Importar estado de cuenta",
          accion: "/conciliacion-bancaria/importar",
          multipart: true,
          campos: llenar([
            {
              nombre: "archivo",
              etiqueta: "Archivo CSV",
              tipo: "file",
              requerido: true,
              aceptar: ".csv,text/csv",
            },
          ]),
          boton: "Importar",
          nota: `Encabezados: fecha, referencia, importe y (opcional) descripcion. Máximo ${maxMb} MB. Reimportar el mismo archivo no duplica movimientos.`,
        },
        {
          tipo: "lista",
          titulo: "Importaciones recientes",
          vacio: "Aún no hay importaciones.",
          elementos: importaciones.map((i) => ({
            titulo: i.archivo,
            subtitulo: `${formatearFechaHora(i.creado)} · ${i.usuarioNombre || ""}`,
            detalle: `${i.nuevas} nuevas, ${i.duplicadas} repetidas, ${i.invalidas} inválidas, ${i.coincidencias} coincidencias`,
            enlace: `/conciliacion-bancaria/importaciones/${i._id}`,
          })),
        },
        {
          tipo: "botones",
          botones: [
            {
              texto: "Buscar coincidencias otra vez",
              accion: "/conciliacion-bancaria/conciliar",
              estilo: "secundario",
            },
          ],
        },
      ],
      filas: movs.map((m) => {
        const pago = m.pagoId ? pagoPorId.get(String(m.pagoId)) : null;
        return {
          enlace: pago ? `/cobranza/${pago.mensualidadId}` : null,
          titulo: `${formatear(m.importe)} · ${m.referencia}`,
          subtitulo: `${formatearFecha(m.fecha)}${m.descripcion ? ` · ${m.descripcion}` : ""}`,
          insignia: insigniaEstado(m.estado),
          campos: m.contratoFolio
            ? [
                { etiqueta: "Contrato", valor: m.contratoFolio },
                { etiqueta: "Pago", valor: pago?.estado || "—" },
              ]
            : [],
          botones:
            pago && pago.estado === "por validar"
              ? [
                  {
                    texto: "Validar pago",
                    accion: `/cobranza/pagos/${pago._id}/validar`,
                    campos: [{ nombre: "volver", valor: req.originalUrl }],
                  },
                ]
              : [],
        };
      }),
      nav: navegacion(req, total, pagina),
      vacio:
        vista === "sin-coincidencia"
          ? "No hay movimientos pendientes de conciliar."
          : "No hay movimientos.",
    });
  }),
);

rConciliacion.post(
  "/importar",
  escribirCon,
  (req, res, next) =>
    recibirArchivo(
      "archivo",
      Math.min(5 * 1048576, obtenerConfig().maxUploadBytes),
    )(req, res, next),
  verificarCsrf,
  envolver(async (req, res) => {
    if (req.errorArchivo) {
      avisar(req, req.errorArchivo, "error");
      return res.redirect("/conciliacion-bancaria");
    }
    if (!req.file || !req.file.buffer?.length) {
      avisar(req, "Elige un archivo CSV.", "error");
      return res.redirect("/conciliacion-bancaria");
    }
    try {
      const r = await importarCsv(
        req.file.buffer,
        req.file.originalname,
        ctx(req),
      );
      avisar(
        req,
        `Importación lista: ${r.nuevas} nuevas, ${r.duplicadas} repetidas, ${r.invalidas} inválidas y ${r.coincidencias} coincidencias.`,
      );
      return res.redirect(`/conciliacion-bancaria/importaciones/${r.id}`);
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
      return res.redirect("/conciliacion-bancaria");
    }
  }),
);

rConciliacion.post(
  "/conciliar",
  escribirCon,
  envolver(async (req, res) => {
    const n = await conciliarMovimientos();
    await auditarReq(req, "conciliacion.reintento", { coincidencias: n });
    avisar(
      req,
      n
        ? `Se encontraron ${n} coincidencias nuevas.`
        : "No hubo coincidencias nuevas.",
    );
    return res.redirect("/conciliacion-bancaria");
  }),
);

rConciliacion.get(
  "/importaciones/:id",
  leerCon,
  envolver(async (req, res, next) => {
    const id = aId(req.params.id);
    const i = id ? await col("importaciones").findOne({ _id: id }) : null;
    if (!i) return next();
    renderDetalle(res, {
      titulo: "Resultado de la importación",
      subtitulo: i.archivo,
      volver: "/conciliacion-bancaria",
      bloques: [
        {
          tipo: "datos",
          filas: [
            { etiqueta: "Fecha", valor: formatearFechaHora(i.creado) },
            { etiqueta: "Importó", valor: i.usuarioNombre || "—" },
            { etiqueta: "Filas leídas", valor: String(i.filas) },
            { etiqueta: "Válidas", valor: String(i.validas) },
            { etiqueta: "Nuevas", valor: String(i.nuevas) },
            { etiqueta: "Ya importadas antes", valor: String(i.duplicadas) },
            {
              etiqueta: "Coincidencias con pagos",
              valor: String(i.coincidencias),
            },
            { etiqueta: "Inválidas", valor: String(i.invalidas) },
          ],
        },
        {
          tipo: "lista",
          titulo: "Filas con error",
          vacio: "Todas las filas fueron válidas.",
          elementos: (i.errores || []).map((e) => ({
            titulo: `Fila ${e.fila}`,
            subtitulo: e.error,
          })),
        },
      ],
    });
  }),
);

module.exports = { rCobranza, rPrioridad, rConciliacion };
