"use strict";
const express = require("express");
const E = require("../lib/esquemas");
const { col, aId } = require("../db");
const { permitir } = require("../middleware/sesion");
const { puede } = require("../permisos");
const {
  envolver,
  filtroBusqueda,
  paginacion,
  navegacion,
  erroresZod,
  avisar,
  textoBusqueda,
  ErrorNegocio,
  capital,
} = require("../lib/util");
const { auditarReq, diferencias } = require("../lib/auditoria");
const { siguienteFolio } = require("../lib/folios");
const { formatear } = require("../lib/dinero");
const {
  formatearFecha,
  textoAFechaMX,
  hoyTextoMX,
  periodoTexto,
} = require("../lib/fechas");
const { formatearTelefono } = require("../lib/telefono");
const {
  renderLista,
  renderDetalle,
  renderFormulario,
  llenar,
  insigniaEstado,
  opciones,
  filtroSelect,
} = require("../lib/vistas");
const { generarMensualidades } = require("../servicios/cobranza");
const { enviarFolio, enlaceWhatsApp } = require("../servicios/folio-whatsapp");
const { whatsappConfigurado } = require("../lib/whatsapp");
const { alCrearContrato } = require("../servicios/seguimiento");

const r = express.Router();
const ESTADOS_CONTRATO = ["activo", "suspendido", "cancelado"];
const leer = permitir("contratos", "leer");
const escribir = permitir("contratos", "escribir");

/** El técnico no ve tarifas ni historial de cobro: se excluyen desde la consulta. */
const proyeccionPara = (usuario) =>
  puede(usuario, "cobranza")
    ? {}
    : { projection: { tarifa: 0, historialPlanes: 0 } };

async function opcionesPlanes() {
  const planes = await col("planes")
    .find({ activo: true })
    .sort({ precio: 1 })
    .toArray();
  return opciones(
    planes.map((p) => ({
      valor: String(p._id),
      texto: `${p.nombre} (${formatear(p.precio)} al mes)${p.publicado ? "" : " · borrador"}`,
    })),
    "Elige un plan",
  );
}

r.get(
  "/",
  leer,
  envolver(async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 80);
    const filtro = { ...filtroBusqueda(q) };
    if (ESTADOS_CONTRATO.includes(req.query.estado))
      filtro.estado = req.query.estado;
    const verTarifa = puede(req.usuario, "cobranza");
    const { pagina, salto, limite } = paginacion(req);
    const [docs, total] = await Promise.all([
      col("contratos")
        .find(filtro, proyeccionPara(req.usuario))
        .sort({ creado: -1 })
        .skip(salto)
        .limit(limite)
        .toArray(),
      col("contratos").countDocuments(filtro),
    ]);
    renderLista(res, {
      titulo: "Contratos",
      accionBusqueda: "/contratos",
      q,
      filtros: [
        filtroSelect(
          "estado",
          "Estado",
          req.query.estado,
          opciones(ESTADOS_CONTRATO, "Todos"),
        ),
      ],
      enlaceNuevo: puede(req.usuario, "contratos", "escribir")
        ? "/contratos/nuevo"
        : null,
      textoNuevo: "Nuevo contrato",
      filas: docs.map((d) => ({
        enlace: `/contratos/${d._id}`,
        titulo: d.folio,
        subtitulo: `${d.clienteNombre} · ${d.colonia || ""}`,
        insignia: insigniaEstado(d.estado),
        campos: [
          { etiqueta: "Plan", valor: d.planNombre },
          ...(verTarifa
            ? [{ etiqueta: "Tarifa", valor: `${formatear(d.tarifa)} al mes` }]
            : []),
        ],
      })),
      nav: navegacion(req, total, pagina),
      vacio: "No hay contratos que coincidan.",
    });
  }),
);

async function camposContrato(cliente) {
  return [
    { nombre: "cliente", tipo: "hidden", valor: String(cliente._id) },
    {
      nombre: "numeroImpreso",
      etiqueta: "Número de contrato impreso (del papel)",
      tipo: "text",
      max: 20,
      autocapitalize: "characters",
      ayuda: "Opcional. Ej. 60109A. Sirve para emparejar el PDF escaneado.",
    }, // ni1
    {
      nombre: "planId",
      etiqueta: "Plan",
      tipo: "select",
      requerido: true,
      opciones: await opcionesPlanes(),
    },
    {
      nombre: "fechaInicio",
      etiqueta: "Fecha de inicio",
      tipo: "date",
      requerido: true,
    },
    {
      nombre: "diaLimitePago",
      etiqueta: "Día límite de pago (1 a 28)",
      tipo: "number",
      min: 1,
      max: 28,
      requerido: true,
    },
    {
      nombre: "direccionInstalacion",
      etiqueta: "Dirección de instalación",
      tipo: "textarea",
      requerido: true,
      max: 300,
    },
    { nombre: "notas", etiqueta: "Notas", tipo: "textarea", max: 1000 },
  ];
}

async function formularioContrato(
  res,
  cliente,
  valores,
  errores = {},
  estado = 200,
) {
  renderFormulario(
    res,
    {
      titulo: `Nuevo contrato para ${cliente.nombre}`,
      accion: "/contratos",
      campos: llenar(await camposContrato(cliente), valores),
      errores,
      boton: "Crear contrato",
      cancelar: `/clientes/${cliente._id}`,
      nota: "La tarifa se copia del plan elegido. Si después cambia el precio del plan, este contrato conserva su tarifa.",
    },
    estado,
  );
}

r.get(
  "/nuevo",
  escribir,
  envolver(async (req, res) => {
    const clienteId = aId(String(req.query.cliente || ""));
    if (!clienteId) {
      const q = String(req.query.q ?? "").slice(0, 80);
      const filtro = { activo: true, ...filtroBusqueda(q) };
      const { pagina, salto, limite } = paginacion(req);
      const [clientes, total] = await Promise.all([
        col("clientes")
          .find(filtro)
          .sort({ _id: -1 })
          .skip(salto)
          .limit(limite)
          .toArray(),
        col("clientes").countDocuments(filtro),
      ]);
      return renderLista(res, {
        titulo: "Nuevo contrato: elige al cliente",
        accionBusqueda: "/contratos/nuevo",
        q,
        enlaceNuevo: "/clientes/nuevo",
        textoNuevo: "Registrar cliente",
        filas: clientes.map((c) => ({
          enlace: `/contratos/nuevo?cliente=${c._id}`,
          titulo: c.nombre,
          subtitulo: `${formatearTelefono(c.telefono)} · ${c.colonia}`,
          campos: [],
        })),
        nav: navegacion(req, total, pagina),
        vacio: "No hay clientes activos que coincidan.",
        volver: "/contratos",
      });
    }
    const cliente = await col("clientes").findOne({
      _id: clienteId,
      activo: true,
    });
    if (!cliente) {
      avisar(req, "El cliente no existe o está desactivado.", "error");
      return res.redirect("/contratos/nuevo");
    }
    return formularioContrato(res, cliente, {
      fechaInicio: hoyTextoMX(),
      diaLimitePago: "10",
      direccionInstalacion: `${cliente.direccion}, ${cliente.colonia}, CP ${cliente.codigoPostal}`,
    });
  }),
);

const esquemaContrato = () =>
  E.z.object({
    cliente: E.idObjeto("un cliente"),
    numeroImpreso: E.cadena(
      (s) =>
        s
          .max(20, "El número impreso admite máximo 20 caracteres.")
          .regex(/^[A-Z0-9-]*$/, "Usa solo letras, números y guion."),
      (v) => E.limpio(v).toUpperCase(),
    ), // ni2
    planId: E.idObjeto("un plan"),
    fechaInicio: E.fecha("La fecha de inicio"),
    diaLimitePago: E.entero(1, 28, "El día límite de pago"),
    direccionInstalacion: E.texto(5, 300, "La dirección de instalación"),
    notas: E.textoOpcional(1000, "Las notas"),
  });

r.post(
  "/",
  escribir,
  envolver(async (req, res) => {
    const cliente = await col("clientes").findOne({
      _id: aId(String(req.body.cliente || "")) || null,
      activo: true,
    });
    if (!cliente) {
      avisar(req, "El cliente no existe o está desactivado.", "error");
      return res.redirect("/contratos/nuevo");
    }
    const v = esquemaContrato().safeParse(req.body);
    if (!v.success)
      return formularioContrato(
        res,
        cliente,
        req.body,
        erroresZod(v.error),
        422,
      );
    const d = v.data;
    const plan = await col("planes").findOne({
      _id: aId(d.planId),
      activo: true,
    });
    if (!plan)
      return formularioContrato(
        res,
        cliente,
        req.body,
        { planId: "Elige un plan activo." },
        422,
      );

    // ni4
    if (
      d.numeroImpreso &&
      (await col("contratos").findOne(
        { numeroImpreso: d.numeroImpreso },
        { projection: { _id: 1 } },
      ))
    )
      return formularioContrato(
        res,
        cliente,
        req.body,
        { numeroImpreso: "Ya existe un contrato con ese número impreso." },
        422,
      );
    const ahora = new Date();
    const folio = await siguienteFolio("CTR");
    const doc = {
      folio,
      numeroImpreso: d.numeroImpreso || null, // ni3
      clienteId: cliente._id,
      clienteNombre: cliente.nombre,
      colonia: cliente.colonia,
      codigoPostal: cliente.codigoPostal,
      planId: plan._id,
      planClave: plan.clave,
      planNombre: plan.nombre,
      tarifa: plan.precio, // copia de la tarifa al crear el contrato
      estado: "activo",
      fechaInicio: textoAFechaMX(d.fechaInicio),
      diaLimitePago: d.diaLimitePago,
      direccionInstalacion: d.direccionInstalacion,
      notas: d.notas,
      historialPlanes: [
        {
          fecha: ahora,
          planClave: plan.clave,
          planNombre: plan.nombre,
          tarifa: plan.precio,
          usuarioId: req.usuario._id,
        },
      ],
      busqueda: textoBusqueda(
        folio,
        cliente.nombre,
        cliente.telefono,
        cliente.colonia,
        plan.nombre,
      ),
      creado: ahora,
      actualizado: ahora,
      creadoPor: req.usuario._id,
    };
    await col("contratos").insertOne(doc);
    // Si el cliente vino de una solicitud, esta pasa sola a "contratada".
    await alCrearContrato(cliente, doc, req.usuario);
    await auditarReq(req, "contrato.alta", {
      folio,
      cliente: cliente.nombre,
      plan: plan.clave,
      tarifa: formatear(plan.precio),
    });
    // Se le manda al cliente su folio por WhatsApp para que entre a "Mi portal".
    if (whatsappConfigurado()) {
      try {
        await enviarFolio(doc, { usuario: req.usuario, ip: req.ip });
        avisar(
          req,
          `Contrato ${folio} creado. Le enviamos su folio por WhatsApp.`,
        );
      } catch (e) {
        avisar(
          req,
          `Contrato ${folio} creado. No se pudo enviar el WhatsApp: ${e.message}`,
          "error",
        );
      }
    } else {
      avisar(
        req,
        `Contrato ${folio} creado. Envíale su folio con el botón "Abrir WhatsApp con el folio".`,
      );
    }
    return res.redirect(`/contratos/${doc._id}`);
  }),
);

async function buscarContrato(req, next, opciones = {}) {
  const id = aId(req.params.id);
  const c = id ? await col("contratos").findOne({ _id: id }, opciones) : null;
  if (!c) next();
  return c;
}

r.get(
  "/:id",
  leer,
  envolver(async (req, res, next) => {
    const c = await buscarContrato(req, next, proyeccionPara(req.usuario));
    if (!c) return;
    const verCobranza = puede(req.usuario, "cobranza");
    const puedeEscribir = puede(req.usuario, "contratos", "escribir");
    const [cliente, equipos, incidencias] = await Promise.all([
      col("clientes").findOne(
        { _id: c.clienteId },
        { projection: { nombre: 1, telefono: 1, referencias: 1 } },
      ),
      col("equipos")
        .find({ contratoId: c._id, activo: true })
        .limit(50)
        .toArray(),
      col("incidencias")
        .find({ contratoId: c._id })
        .sort({ creada: -1 })
        .limit(10)
        .toArray(),
    ]);

    const bloques = [
      {
        tipo: "datos",
        insignia: insigniaEstado(c.estado),
        filas: [
          {
            etiqueta: "Cliente",
            valor: cliente?.nombre || c.clienteNombre,
            enlace: puede(req.usuario, "clientes")
              ? `/clientes/${c.clienteId}`
              : null,
          },
          { etiqueta: "Teléfono", valor: formatearTelefono(cliente?.telefono) },
          {
            etiqueta: "Dirección de instalación",
            valor: c.direccionInstalacion,
          },
          { etiqueta: "Referencias", valor: cliente?.referencias || "—" },
          { etiqueta: "Plan", valor: c.planNombre },
          ...(verCobranza
            ? [
                { etiqueta: "Tarifa", valor: `${formatear(c.tarifa)} al mes` },
                {
                  etiqueta: "Día límite de pago",
                  valor: String(c.diaLimitePago),
                },
              ]
            : []),
          { etiqueta: "Número impreso", valor: c.numeroImpreso || "—" }, // ni9
          { etiqueta: "Inicio", valor: formatearFecha(c.fechaInicio) },
          { etiqueta: "Notas", valor: c.notas || "—" },
        ],
      },
      {
        tipo: "lista",
        titulo: "Equipos",
        vacio: "Sin equipos asignados.",
        elementos: equipos.map((e) => ({
          titulo: `${capital(e.tipo)} ${e.marca} ${e.modelo}`,
          subtitulo: `Serie ${e.numeroSerie}`,
          enlace: `/equipos/${e._id}`,
        })),
      },
      {
        tipo: "lista",
        titulo: "Incidencias recientes",
        vacio: "Sin incidencias.",
        elementos: incidencias.map((i) => ({
          titulo: i.folio,
          subtitulo: i.titulo,
          enlace: `/incidencias/${i._id}`,
          insignia: insigniaEstado(i.estado),
        })),
      },
    ];

    if (verCobranza) {
      const mensualidades = await col("mensualidades")
        .find({ contratoId: c._id })
        .sort({ periodo: 1 })
        .limit(36)
        .toArray();
      bloques.push({
        tipo: "lista",
        titulo: "Mensualidades",
        vacio: "Aún no hay mensualidades.",
        elementos: mensualidades.map((m) => ({
          titulo: periodoTexto(m.periodo),
          subtitulo: `Vence ${formatearFecha(m.fechaLimite)}`,
          detalle: `Importe ${formatear(m.importe)} · Pagado ${formatear(m.pagado)}`,
          enlace: `/cobranza/${m._id}`,
          insignia: insigniaEstado(m.estado),
        })),
      });
    }

    const botones = [];
    if (puedeEscribir && c.estado !== "cancelado") {
      if (whatsappConfigurado())
        botones.push({
          texto: "Enviar folio por WhatsApp",
          accion: `/contratos/${c._id}/enviar-folio`,
          confirmar: `¿Enviar el folio ${c.folio} al cliente por WhatsApp?`,
        });
      const enlace = await enlaceWhatsApp(c);
      if (enlace)
        botones.push({
          texto: "Abrir WhatsApp con el folio",
          enlace,
          estilo: "secundario",
          nuevaPestana: true,
        });
    }
    if (puede(req.usuario, "incidencias", "escribir"))
      botones.push({
        texto: "Reportar incidencia",
        enlace: `/incidencias/nueva?contrato=${encodeURIComponent(c.folio)}`,
        estilo: "secundario",
      });
    if (puedeEscribir)
      botones.push({
        texto: "Editar datos",
        enlace: `/contratos/${c._id}/editar`,
        estilo: "secundario",
      });
    if (verCobranza && c.estado === "activo")
      botones.push({
        texto: "Generar 12 mensualidades",
        accion: `/contratos/${c._id}/mensualidades`,
      });
    if (botones.length) bloques.push({ tipo: "botones", botones });

    if (puedeEscribir) {
      bloques.push({
        tipo: "formulario",
        titulo: "Cambiar de plan",
        accion: `/contratos/${c._id}/plan`,
        campos: llenar([
          {
            nombre: "planId",
            etiqueta: "Nuevo plan",
            tipo: "select",
            requerido: true,
            opciones: await opcionesPlanes(),
          },
        ]),
        boton: "Cambiar plan",
        nota: "La nueva tarifa se copia del plan y aplica a las mensualidades que se generen después.",
      });
      bloques.push({
        tipo: "formulario",
        titulo: "Estado del contrato",
        accion: `/contratos/${c._id}/estado`,
        campos: llenar(
          [
            {
              nombre: "estado",
              etiqueta: "Estado",
              tipo: "select",
              opciones: opciones(ESTADOS_CONTRATO),
            },
          ],
          { estado: c.estado },
        ),
        boton: "Actualizar estado",
      });
    }
    renderDetalle(res, {
      titulo: c.folio,
      subtitulo: c.clienteNombre,
      volver: "/contratos",
      bloques,
    });
  }),
);

const camposEdicion = [
  {
    nombre: "numeroImpreso",
    etiqueta: "Número de contrato impreso (del papel)",
    tipo: "text",
    max: 20,
    autocapitalize: "characters",
    ayuda: "Ej. 60109A. Sirve para emparejar el PDF escaneado.",
  }, // ni6
  {
    nombre: "direccionInstalacion",
    etiqueta: "Dirección de instalación",
    tipo: "textarea",
    requerido: true,
    max: 300,
  },
  {
    nombre: "diaLimitePago",
    etiqueta: "Día límite de pago (1 a 28)",
    tipo: "number",
    min: 1,
    max: 28,
    requerido: true,
    ayuda: "Aplica a las mensualidades que se generen después.",
  },
  { nombre: "notas", etiqueta: "Notas", tipo: "textarea", max: 1000 },
];
const esquemaEdicion = () =>
  E.z.object({
    numeroImpreso: E.cadena(
      (s) =>
        s
          .max(20, "El número impreso admite máximo 20 caracteres.")
          .regex(/^[A-Z0-9-]*$/, "Usa solo letras, números y guion."),
      (v) => E.limpio(v).toUpperCase(),
    ), // ni7
    direccionInstalacion: E.texto(5, 300, "La dirección de instalación"),
    diaLimitePago: E.entero(1, 28, "El día límite de pago"),
    notas: E.textoOpcional(1000, "Las notas"),
  });

r.get(
  "/:id/editar",
  escribir,
  envolver(async (req, res, next) => {
    const c = await buscarContrato(req, next);
    if (!c) return;
    renderFormulario(res, {
      titulo: `Editar ${c.folio}`,
      accion: `/contratos/${c._id}/editar`,
      cancelar: `/contratos/${c._id}`,
      boton: "Guardar cambios",
      campos: llenar(camposEdicion, {
        numeroImpreso: c.numeroImpreso || "", // ni8
        direccionInstalacion: c.direccionInstalacion,
        diaLimitePago: String(c.diaLimitePago),
        notas: c.notas || "",
      }),
    });
  }),
);

r.post(
  "/:id/editar",
  escribir,
  envolver(async (req, res, next) => {
    const c = await buscarContrato(req, next);
    if (!c) return;
    const v = esquemaEdicion().safeParse(req.body);
    if (!v.success) {
      return renderFormulario(
        res,
        {
          titulo: `Editar ${c.folio}`,
          accion: `/contratos/${c._id}/editar`,
          cancelar: `/contratos/${c._id}`,
          boton: "Guardar cambios",
          campos: llenar(camposEdicion, req.body),
          errores: erroresZod(v.error),
        },
        422,
      );
    }
    // ni5
    if (
      v.data.numeroImpreso &&
      (await col("contratos").findOne(
        { numeroImpreso: v.data.numeroImpreso, _id: { $ne: c._id } },
        { projection: { _id: 1 } },
      ))
    ) {
      avisar(req, "Ya existe otro contrato con ese número impreso.", "error");
      return res.redirect(`/contratos/${c._id}/editar`);
    }
    const cambios = {
      ...v.data,
      actualizado: new Date(),
      actualizadoPor: req.usuario._id,
    };
    await col("contratos").updateOne({ _id: c._id }, { $set: cambios });
    const dif = diferencias(c, v.data, Object.keys(v.data));
    if (Object.keys(dif).length)
      await auditarReq(req, "contrato.cambio", {
        folio: c.folio,
        cambios: dif,
      });
    avisar(req, "Cambios guardados.");
    return res.redirect(`/contratos/${c._id}`);
  }),
);

r.post(
  "/:id/plan",
  escribir,
  envolver(async (req, res, next) => {
    const c = await buscarContrato(req, next);
    if (!c) return;
    const plan = await col("planes").findOne({
      _id: aId(String(req.body.planId || "")) || null,
      activo: true,
    });
    if (!plan) {
      avisar(req, "Elige un plan activo.", "error");
    } else if (String(plan._id) === String(c.planId)) {
      avisar(req, "El contrato ya tiene ese plan.", "error");
    } else {
      const ahora = new Date();
      await col("contratos").updateOne(
        { _id: c._id },
        {
          $set: {
            planId: plan._id,
            planClave: plan.clave,
            planNombre: plan.nombre,
            tarifa: plan.precio,
            busqueda: textoBusqueda(
              c.folio,
              c.clienteNombre,
              c.colonia,
              plan.nombre,
            ),
            actualizado: ahora,
            actualizadoPor: req.usuario._id,
          },
          $push: {
            historialPlanes: {
              fecha: ahora,
              planClave: plan.clave,
              planNombre: plan.nombre,
              tarifa: plan.precio,
              usuarioId: req.usuario._id,
            },
          },
        },
      );
      await auditarReq(req, "contrato.cambio_plan", {
        folio: c.folio,
        de: c.planClave,
        a: plan.clave,
        tarifaAnterior: formatear(c.tarifa),
        tarifaNueva: formatear(plan.precio),
      });
      avisar(
        req,
        `Plan cambiado a ${plan.nombre}. Nueva tarifa: ${formatear(plan.precio)}.`,
      );
    }
    return res.redirect(`/contratos/${c._id}`);
  }),
);

r.post(
  "/:id/enviar-folio",
  escribir,
  envolver(async (req, res, next) => {
    const c = await buscarContrato(req, next);
    if (!c) return;
    try {
      await enviarFolio(c, { usuario: req.usuario, ip: req.ip });
      avisar(req, `Le enviamos el folio ${c.folio} por WhatsApp.`);
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(`/contratos/${c._id}`);
  }),
);

r.post(
  "/:id/estado",
  escribir,
  envolver(async (req, res, next) => {
    const c = await buscarContrato(req, next);
    if (!c) return;
    const estado = String(req.body.estado || "");
    if (!ESTADOS_CONTRATO.includes(estado)) {
      avisar(req, "Elige un estado válido.", "error");
    } else if (estado !== c.estado) {
      await col("contratos").updateOne(
        { _id: c._id },
        {
          $set: {
            estado,
            actualizado: new Date(),
            actualizadoPor: req.usuario._id,
          },
        },
      );
      await auditarReq(req, "contrato.estado", {
        folio: c.folio,
        de: c.estado,
        a: estado,
      });
      avisar(req, `Contrato marcado como ${estado}.`);
    }
    return res.redirect(`/contratos/${c._id}`);
  }),
);

r.post(
  "/:id/mensualidades",
  permitir("cobranza", "escribir"),
  envolver(async (req, res, next) => {
    const c = await buscarContrato(req, next);
    if (!c) return;
    try {
      const { creadas } = await generarMensualidades(c._id, {
        usuario: req.usuario,
        ip: req.ip,
      });
      avisar(
        req,
        creadas
          ? `Se crearon ${creadas} mensualidades nuevas.`
          : "Las mensualidades de esos 12 meses ya existían. No se duplicó nada.",
      );
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e;
      avisar(req, e.message, "error");
    }
    return res.redirect(`/contratos/${c._id}`);
  }),
);

module.exports = r;
