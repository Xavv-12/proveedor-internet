'use strict';
// Panel del técnico: Mis actividades + 5 apartados (instalaciones, seguimientos, atenciones, renovaciones, bajas).
// Todo se guarda en la colección `registros_tecnico` con un campo `tipo`.
const express = require('express');
const E = require('../lib/esquemas');
const { col, aId } = require('../db');
const { permitir } = require('../middleware/sesion');
const { verificarCsrf } = require('../middleware/csrf');
const { puede } = require('../permisos');
const { obtenerConfig } = require('../config');
const {
  envolver, filtroBusqueda, paginacion, navegacion, erroresZod, avisar, textoBusqueda, capital,
} = require('../lib/util');
const { auditarReq } = require('../lib/auditoria');
const { formatear, aCentavos } = require('../lib/dinero');
const { formatearFecha, formatearFechaHora, textoAFechaMX, hoyTextoMX } = require('../lib/fechas');
const {
  recibirArchivos, detectarTipo, guardarEvidencia, rutaEvidencia, borrarEvidencia, nombreOriginalSeguro,
} = require('../lib/archivos');
const { cifrar, descifrar, claveConfigurada } = require('../lib/secretos');
const {
  renderDetalle, renderLista, renderFormulario, llenar, insigniaEstado, opciones,
} = require('../lib/vistas');
const { calcularInstalacion, finPeriodo } = require('../servicios/panel-tecnico');

const r = express.Router();
const leer = permitir('panel_tecnico', 'leer');
const escribir = permitir('panel_tecnico', 'escribir');
const MAX_FOTOS = 6;
const BASE = '/panel-tecnico';

// ---------- Definición de campos ----------

const dineroConCero = (etq) => E.z.preprocess((v) => {
  const s = E.limpio(v);
  if (!s) return undefined;
  if (/^0+([.,]0+)?$/.test(s)) return 0;
  return aCentavos(s);
}, E.z.number({ error: (i) => (i.input === undefined ? `${etq} es obligatorio. Si no hubo, escribe 0.` : `${etq} no es válido. Usa un formato como 200.00`) })
  .int().min(0).max(10_000_000_00, `${etq} es demasiado alto.`));

const campoContrato = {
  nombre: 'contratoFolio', etiqueta: 'Número de contrato', tipo: 'text', requerido: true, autocapitalize: 'characters', max: 20,
  ayuda: 'Ej. CTR-2026-00001 o el número impreso del papel (60109A). El titular se toma del contrato.',
  z: E.cadena((s) => s.min(1, 'El número de contrato es obligatorio.').max(20), (v) => E.limpio(v).toUpperCase()),
};
const campoFecha = (nombre, etiqueta, etq) => ({
  nombre, etiqueta, tipo: 'date', requerido: true, formato: 'fecha', z: E.fecha(etq), guardar: textoAFechaMX,
});
const campoTexto = (nombre, etiqueta, etq, min, max, extra = {}) => ({
  nombre, etiqueta, tipo: 'text', requerido: true, max, z: E.texto(min, max, etq), ...extra,
});
const campoArea = (nombre, etiqueta, etq, min, max, requerido = true) => ({
  nombre, etiqueta, tipo: 'textarea', requerido, max, filas: 4, z: requerido ? E.texto(min, max, etq) : E.textoOpcional(max, etq),
});
const campoDinero = (nombre, etiqueta, etq, cero = false) => ({
  nombre, etiqueta, tipo: 'dinero', requerido: true, formato: 'dinero', z: cero ? dineroConCero(etq) : E.dinero(etq),
});
const campoSecreto = (nombre, etiqueta, etq, max = 100) => ({
  nombre, etiqueta, tipo: 'text', requerido: true, max, secreto: true, autocomplete: 'off',
  ayuda: 'Se guarda cifrada.', z: E.texto(1, max, etq),
});

const DURACIONES = ['6', '12', '18', '24'];
const campoPeriodo = {
  nombre: 'periodoMeses', etiqueta: 'Periodo del contrato', tipo: 'select', requerido: true, formato: 'meses',
  opciones: opciones(DURACIONES.map((m) => ({ valor: m, texto: `${m} meses` })), 'Elige el periodo'),
  z: E.opcion(DURACIONES, 'el periodo'), guardar: Number,
};
const campoMbps = {
  nombre: 'velocidadMbps', etiqueta: 'Velocidad en Mbps', tipo: 'number', min: 1, max: 10000, requerido: true, formato: 'mbps',
  z: E.entero(1, 10000, 'La velocidad'),
};
const campoIp = {
  nombre: 'routerIp', etiqueta: 'Dirección IP del router', tipo: 'text', requerido: true, max: 15, inputmode: 'decimal',
  z: E.cadena((s) => s.refine((v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split('.').every((n) => Number(n) <= 255), 'Escribe una dirección IP válida, como 192.168.1.1.')),
};

const ESTADOS_EQUIPO = [
  { valor: 'bueno', texto: 'Bueno' },
  { valor: 'danado', texto: 'Dañado' },
  { valor: 'no_entregado', texto: 'No entregado' },
  { valor: 'no_aplica', texto: 'No aplica' },
];
const EQUIPOS_BAJA = [['Antena', 'estadoAntena'], ['Router', 'estadoRouter'], ['Fuente de poder', 'estadoFuente'], ['Cable', 'estadoCable']];
const camposEquipos = EQUIPOS_BAJA.map(([nombre, campo]) => ({
  nombre: campo, etiqueta: `Estado: ${nombre}`, tipo: 'select', requerido: true, formato: 'estado',
  opciones: opciones(ESTADOS_EQUIPO, 'Elige'), z: E.opcion(ESTADOS_EQUIPO.map((e) => e.valor), 'el estado'),
}));

const TIPOS = {
  instalaciones: {
    clave: 'instalacion', titulo: 'Instalaciones', singular: 'instalación', contrato: true,
    campos: [
      campoContrato,
      campoFecha('fechaInstalacion', 'Fecha de instalación', 'La fecha de instalación'),
      campoPeriodo,
      campoDinero('tarifaInstalacion', 'Tarifa de instalación', 'La tarifa de instalación'),
      { nombre: 'mensualidadesInstalacion', etiqueta: 'Mensualidades en que se paga la instalación', tipo: 'number', min: 1, max: 36, requerido: true, z: E.entero(1, 36, 'El número de mensualidades') },
      campoDinero('tarifaMensual', 'Tarifa mensual', 'La tarifa mensual'),
      campoDinero('parcialCobrada', 'Parcialidad cobrada al instalar', 'La parcialidad', true),
      campoMbps,
      campoTexto('redWifi', 'Red (nombre del WiFi)', 'La red', 1, 60),
      campoSecreto('wifiPass', 'Contraseña del WiFi', 'La contraseña del WiFi', 100),
      campoTexto('antenaModelo', 'Modelo de antena', 'El modelo de antena', 1, 80),
      campoTexto('routerModelo', 'Modelo de router', 'El modelo de router', 1, 80),
      campoIp,
      campoSecreto('routerUsuario', 'Usuario para ingresar al router', 'El usuario del router', 60),
      campoSecreto('routerPass', 'Contraseña para ingresar al router', 'La contraseña del router', 100),
      campoTexto('apEnlazado', 'AP enlazado', 'El AP enlazado', 1, 80),
      campoTexto('ubicacion', 'Ubicación', 'La ubicación', 3, 300),
    ],
    revisar: (d, errores) => {
      if (d.parcialCobrada > d.tarifaInstalacion) errores.parcialCobrada = 'La parcialidad no puede ser mayor que la tarifa de instalación.';
    },
    derivar: (d) => ({
      ...calcularInstalacion({
        tarifaInstalacion: d.tarifaInstalacion, parcialCobrada: d.parcialCobrada,
        mensualidades: d.mensualidadesInstalacion, tarifaMensual: d.tarifaMensual,
      }),
      periodoFin: textoAFechaMX(finPeriodo(d.fechaInstalacion, Number(d.periodoMeses))),
    }),
    filasExtra: (c) => [
      { etiqueta: 'Saldo de instalación por pagar', valor: formatear(c.saldo) },
      { etiqueta: 'Cuota de instalación por mes', valor: formatear(c.cuotaInstalacion) },
      { etiqueta: 'Total a pagar cada mes (mensualidad + cuota)', valor: formatear(c.totalMensual) },
      { etiqueta: 'Fin del periodo', valor: formatearFecha(c.periodoFin) },
    ],
  },
  seguimientos: {
    clave: 'seguimiento', titulo: 'Seguimiento', singular: 'seguimiento', contrato: false,
    campos: [
      campoFecha('fecha', 'Fecha', 'La fecha'),
      campoArea('descripcion', 'Descripción', 'La descripción', 3, 2000),
    ],
  },
  atenciones: {
    clave: 'atencion', titulo: 'Atención a clientes', singular: 'atención a cliente', contrato: true,
    campos: [
      campoContrato,
      campoArea('descripcion', 'Descripción', 'La descripción', 3, 2000),
    ],
  },
  renovaciones: {
    clave: 'renovacion', titulo: 'Renovaciones', singular: 'renovación', contrato: true,
    campos: [
      campoContrato,
      campoFecha('fechaRenovacion', 'Fecha de renovación', 'La fecha de renovación'),
      campoPeriodo,
      campoDinero('tarifaMensual', 'Tarifa mensual', 'La tarifa mensual'),
      campoMbps,
      campoTexto('routerModelo', 'Modelo de router', 'El modelo de router', 1, 80),
      campoTexto('antenaModelo', 'Modelo de antena', 'El modelo de antena', 1, 80),
      campoTexto('redWifi', 'Red WiFi', 'La red', 1, 60),
      campoSecreto('wifiPass', 'Contraseña del WiFi', 'La contraseña del WiFi', 100),
      campoArea('notas', 'Notas u observaciones del técnico', 'Las notas', 0, 2000, false),
    ],
    derivar: (d) => ({ periodoFin: textoAFechaMX(finPeriodo(d.fechaRenovacion, Number(d.periodoMeses))) }),
    filasExtra: (c) => [{ etiqueta: 'Fin del periodo', valor: formatearFecha(c.periodoFin) }],
  },
  bajas: {
    clave: 'baja', titulo: 'Bajas de contratos', singular: 'baja de contrato', contrato: true,
    campos: [
      campoContrato,
      campoFecha('fechaAtencion', 'Fecha de atención', 'La fecha de atención'),
      campoDinero('aportacion', 'Aportación (monto en pesos)', 'La aportación', true),
      ...camposEquipos,
      campoArea('observacionesEquipos', 'Observaciones de los equipos', 'Las observaciones', 0, 1000, false),
      campoArea('motivo', 'Motivo de cancelación', 'El motivo', 3, 1000),
    ],
    derivar: (d) => ({
      equiposRetirados: EQUIPOS_BAJA
        .filter(([, campo]) => ['bueno', 'danado'].includes(d[campo]))
        .map(([nombre]) => nombre),
    }),
    filasExtra: (c) => [{ etiqueta: 'Equipos retirados', valor: c.equiposRetirados.length ? c.equiposRetirados.join(', ') : 'Ninguno' }],
  },
};

const CAMPO_FOTOS = {
  nombre: 'fotos', etiqueta: `Fotos (hasta ${MAX_FOTOS})`, tipo: 'file', multiple: true, aceptar: 'image/jpeg,image/png,image/webp',
};

// ---------- Utilidades ----------

const esquema = (tipo) => E.z.object(Object.fromEntries(tipo.campos.map((c) => [c.nombre, c.z])));
const camposForm = (tipo) => [...tipo.campos.map(({ z, secreto, guardar, formato, ...c }) => c), CAMPO_FOTOS];
const tecnicoActual = (req) => col('tecnicos').findOne({ usuarioId: req.usuario._id, activo: true });
const esDueno = (req, reg) => String(reg.usuarioId) === String(req.usuario._id);
const puedeVerSecretos = (req, reg) => req.usuario.rol === 'admin' || (req.usuario.rol === 'tecnico' && esDueno(req, reg));

function filtroRegistros(req, clave) {
  return { tipo: clave, ...(req.usuario.rol === 'tecnico' ? { usuarioId: req.usuario._id } : {}) };
}

function sinTecnico(res) {
  return res.status(403).render('error', {
    titulo: 'Sin técnico vinculado',
    mensaje: 'Tu usuario no está vinculado a un técnico activo. Pide a administración que lo vincule en Técnicos.',
  });
}

function mostrar(c, v) {
  if (v === undefined || v === null || v === '') return '—';
  switch (c.formato) {
    case 'fecha': return formatearFecha(v);
    case 'dinero': return formatear(v);
    case 'mbps': return `${v} Mbps`;
    case 'meses': return `${v} meses`;
    case 'estado': return (ESTADOS_EQUIPO.find((x) => x.valor === v) || {}).texto || String(v);
    default: return String(v);
  }
}

function bloquesRegistro(tipo, reg, slug, secretos, verSecretos) {
  const filas = [
    { etiqueta: 'Técnico', valor: reg.tecnicoNombre },
    { etiqueta: 'Registrado', valor: formatearFechaHora(reg.creado) },
  ];
  if (reg.contratoFolio) {
    filas.push(
      { etiqueta: 'Contrato', valor: reg.contratoFolio, enlace: reg.contratoId ? `/contratos/${reg.contratoId}` : null },
      { etiqueta: 'Titular', valor: reg.titular || '—' },
    );
  }
  for (const c of tipo.campos) {
    if (c.nombre === 'contratoFolio') continue;
    if (c.secreto) {
      filas.push({ etiqueta: c.etiqueta, valor: secretos ? (secretos[c.nombre] ?? '—') : '••••••••' });
    } else {
      filas.push({ etiqueta: c.etiqueta, valor: mostrar(c, reg.datos[c.nombre]) });
    }
  }
  if (tipo.filasExtra && reg.calculado) filas.push(...tipo.filasExtra(reg.calculado));
  const bloques = [{ tipo: 'datos', filas }];
  bloques.push({
    tipo: 'lista',
    titulo: 'Fotos',
    vacio: 'Sin fotos.',
    elementos: (reg.fotos || []).map((f, i) => ({
      titulo: `Foto ${i + 1}`, subtitulo: f.nombreOriginal, enlace: `${BASE}/${slug}/${reg._id}/fotos/${i}`,
    })),
  });
  const tieneSecretos = tipo.campos.some((c) => c.secreto);
  if (tieneSecretos && verSecretos && !secretos) {
    bloques.push({
      tipo: 'botones',
      botones: [{
        texto: 'Mostrar contraseñas',
        accion: `${BASE}/${slug}/${reg._id}/secretos`,
        confirmar: '¿Mostrar las contraseñas? Esta consulta queda registrada en la auditoría.',
      }],
    });
  }
  return bloques;
}

async function formTipo(res, slug, valores, errores = {}, estado = 200) {
  const tipo = TIPOS[slug];
  const nota = tipo.campos.some((c) => c.secreto)
    ? 'Las contraseñas se guardan cifradas y cada consulta queda en la auditoría.'
    : null;
  renderFormulario(res, {
    titulo: `Nueva ${tipo.singular}`,
    accion: `${BASE}/${slug}`,
    cancelar: `${BASE}/${slug}`,
    boton: 'Guardar',
    multipart: true,
    campos: llenar(camposForm(tipo), valores),
    errores,
    nota,
  }, estado);
}

function validarFotos(archivos) {
  for (const a of archivos) {
    if (!a.buffer?.length) return 'Una de las fotos llegó vacía.';
    const t = detectarTipo(a.buffer);
    if (!t || t.ext === 'pdf') return 'Solo se aceptan fotos JPG, PNG o WEBP.';
  }
  return null;
}

async function buscarRegistro(req, slug) {
  const tipo = TIPOS[slug];
  const id = aId(req.params.id);
  const reg = tipo && id ? await col('registros_tecnico').findOne({ _id: id, tipo: tipo.clave }) : null;
  if (!reg) return null;
  if (req.usuario.rol === 'tecnico' && !esDueno(req, reg)) return null;
  return reg;
}

// ---------- Mis actividades ----------

r.get('/', leer, envolver(async (req, res) => {
  const esTecnico = req.usuario.rol === 'tecnico';
  const tecnico = esTecnico ? await tecnicoActual(req) : null;
  if (esTecnico && !tecnico) return sinTecnico(res);
  const filtroVisitas = { estado: 'programada', ...(esTecnico ? { tecnicoId: tecnico._id } : {}) };
  const entradas = Object.entries(TIPOS);
  const [visitas, ...conteos] = await Promise.all([
    esTecnico ? col('visitas').find(filtroVisitas).sort({ fecha: 1 }).limit(50).toArray() : Promise.resolve([]),
    ...entradas.map(([, t]) => col('registros_tecnico').countDocuments(filtroRegistros(req, t.clave))),
  ]);
  renderDetalle(res, {
    titulo: esTecnico ? 'Mi panel' : 'Panel de técnicos',
    subtitulo: esTecnico ? tecnico.nombre : 'Registros de todos los técnicos',
    bloques: [
      ...[{
        tipo: 'lista',
        titulo: 'Mis actividades',
        nota: 'Visitas programadas, por fecha. Al terminar, registra el resultado en la visita.',
        vacio: 'No hay actividades pendientes.',
        elementos: visitas.map((v) => ({
          titulo: `${formatearFechaHora(v.fecha)} · ${v.clienteNombre || ''}`,
          subtitulo: `${v.incidenciaFolio} · ${esTecnico ? (v.direccion || '') : v.tecnicoNombre}`,
          enlace: `/visitas/${v._id}`,
          insignia: insigniaEstado(v.estado),
        })),
      }].filter(() => esTecnico),
      {
        tipo: 'lista',
        titulo: 'Registros',
        vacio: '',
        elementos: entradas.map(([slug, t], i) => ({
          titulo: t.titulo, subtitulo: `${conteos[i]} registro(s)`, enlace: `${BASE}/${slug}`,
        })),
      },
    ],
  });
}));

// ---------- Lista y alta por apartado ----------

r.get('/:slug', leer, envolver(async (req, res, next) => {
  const tipo = TIPOS[req.params.slug];
  if (!tipo) return next();
  const q = String(req.query.q ?? '').slice(0, 80);
  const filtro = { ...filtroRegistros(req, tipo.clave), ...filtroBusqueda(q) };
  const { pagina, salto, limite } = paginacion(req);
  const [docs, total] = await Promise.all([
    col('registros_tecnico').find(filtro).sort({ creado: -1 }).skip(salto).limit(limite).toArray(),
    col('registros_tecnico').countDocuments(filtro),
  ]);
  renderLista(res, {
    titulo: tipo.titulo,
    accionBusqueda: `${BASE}/${req.params.slug}`,
    q,
    enlaceNuevo: puede(req.usuario, 'panel_tecnico', 'escribir') ? `${BASE}/${req.params.slug}/nuevo` : null,
    textoNuevo: `Nueva ${tipo.singular}`,
    filas: docs.map((d) => ({
      enlace: `${BASE}/${req.params.slug}/${d._id}`,
      titulo: d.contratoFolio ? `${d.contratoFolio} · ${d.titular || ''}` : `${capital(tipo.singular)} del ${formatearFecha(d.datos.fecha)}`,
      subtitulo: `${formatearFechaHora(d.creado)} · ${d.tecnicoNombre}`,
      campos: [],
    })),
    nav: navegacion(req, total, pagina),
    vacio: 'Aún no hay registros.',
    volver: BASE,
  });
}));

r.get('/:slug/nuevo', escribir, envolver(async (req, res, next) => {
  const tipo = TIPOS[req.params.slug];
  if (!tipo) return next();
  const valores = {};
  for (const c of tipo.campos) if (c.tipo === 'date') valores[c.nombre] = hoyTextoMX();
  if (tipo.contrato) valores.contratoFolio = String(req.query.contrato || '').slice(0, 20);
  return formTipo(res, req.params.slug, valores);
}));

r.post(
  '/:slug',
  escribir,
  (req, res, next) => recibirArchivos('fotos', obtenerConfig().maxUploadBytes, MAX_FOTOS)(req, res, next),
  verificarCsrf,
  envolver(async (req, res, next) => {
    const slug = req.params.slug;
    const tipo = TIPOS[slug];
    if (!tipo) return next();
    const tecnico = await tecnicoActual(req);
    if (!tecnico) return sinTecnico(res);
    if (req.errorArchivo) return formTipo(res, slug, req.body, { fotos: req.errorArchivo }, 422);
    const conSecretos = tipo.campos.some((c) => c.secreto);
    if (conSecretos && !claveConfigurada()) {
      return formTipo(res, slug, req.body, { general: 'El servidor no tiene configurada la clave de cifrado (CLAVE_SECRETOS). Avisa a administración.' }, 500);
    }

    const v = esquema(tipo).safeParse(req.body);
    const errores = v.success ? {} : erroresZod(v.error);
    const archivos = req.files || [];
    const errorFotos = validarFotos(archivos);
    if (errorFotos) errores.fotos = errorFotos;

    let contrato = null;
    if (v.success) {
      const d = v.data;
      if (tipo.contrato) {
        contrato = await col('contratos').findOne({ $or: [{ folio: d.contratoFolio }, { numeroImpreso: d.contratoFolio }] }, { projection: { folio: 1, clienteNombre: 1, direccionInstalacion: 1 } });
        if (!contrato) errores.contratoFolio = 'No existe un contrato con ese folio.';
      }
      if (tipo.revisar) tipo.revisar(d, errores);
    }
    if (Object.keys(errores).length) return formTipo(res, slug, req.body, errores, 422);

    const d = v.data;
    const calculado = tipo.derivar ? tipo.derivar(d) : null;
    const datos = {};
    const secretos = {};
    for (const c of tipo.campos) {
      if (c.nombre === 'contratoFolio') continue;
      if (c.secreto) secretos[c.nombre] = cifrar(d[c.nombre]);
      else datos[c.nombre] = c.guardar ? c.guardar(d[c.nombre]) : d[c.nombre];
    }

    const guardadas = [];
    try {
      for (const a of archivos) {
        const t = detectarTipo(a.buffer);
        const nombre = await guardarEvidencia(a.buffer, t);
        guardadas.push({ archivo: nombre, tipo: t.tipo, ext: t.ext, tamano: a.size, nombreOriginal: nombreOriginalSeguro(a.originalname) });
      }
      const doc = {
        tipo: tipo.clave,
        tecnicoId: tecnico._id,
        tecnicoNombre: tecnico.nombre,
        usuarioId: req.usuario._id,
        contratoId: contrato?._id ?? null,
        contratoFolio: contrato?.folio ?? null,
        titular: contrato?.clienteNombre ?? null,
        direccion: contrato?.direccionInstalacion ?? null,
        datos,
        secretos,
        calculado,
        fotos: guardadas,
        creado: new Date(),
        busqueda: textoBusqueda(tipo.titulo, contrato?.folio || '', contrato?.clienteNombre || '', tecnico.nombre),
      };
      await col('registros_tecnico').insertOne(doc);
      await auditarReq(req, 'panel_tecnico.alta', { tipo: tipo.clave, contrato: contrato?.folio ?? null, fotos: guardadas.length });
      avisar(req, `${capital(tipo.singular)} guardada.`);
      return res.redirect(`${BASE}/${slug}/${doc._id}`);
    } catch (e) {
      for (const g of guardadas) await borrarEvidencia(g.archivo);
      throw e;
    }
  }),
);

// ---------- Detalle, contraseñas y fotos ----------

r.get('/:slug/:id', leer, envolver(async (req, res, next) => {
  const reg = await buscarRegistro(req, req.params.slug);
  if (!reg) return next();
  const tipo = TIPOS[req.params.slug];
  renderDetalle(res, {
    titulo: reg.contratoFolio ? `${capital(tipo.singular)} · ${reg.contratoFolio}` : capital(tipo.singular),
    subtitulo: reg.titular || reg.tecnicoNombre,
    volver: `${BASE}/${req.params.slug}`,
    bloques: bloquesRegistro(tipo, reg, req.params.slug, null, puedeVerSecretos(req, reg)),
  });
}));

r.post('/:slug/:id/secretos', leer, envolver(async (req, res, next) => {
  const slug = req.params.slug;
  const reg = await buscarRegistro(req, slug);
  if (!reg) return next();
  const tipo = TIPOS[slug];
  if (!puedeVerSecretos(req, reg)) {
    return res.status(403).render('error', { titulo: 'Sin permiso', mensaje: 'No tienes permiso para ver estas contraseñas.' });
  }
  let plano;
  try {
    plano = {};
    for (const [nombre, valor] of Object.entries(reg.secretos || {})) plano[nombre] = descifrar(valor);
  } catch {
    avisar(req, 'No se pudieron descifrar las contraseñas. Revisa que CLAVE_SECRETOS sea la misma con la que se guardaron.', 'error');
    return res.redirect(`${BASE}/${slug}/${reg._id}`);
  }
  await auditarReq(req, 'panel_tecnico.secretos', { tipo: tipo.clave, contrato: reg.contratoFolio, registro: String(reg._id) });
  return renderDetalle(res, {
    titulo: reg.contratoFolio ? `${capital(tipo.singular)} · ${reg.contratoFolio}` : capital(tipo.singular),
    subtitulo: reg.titular || reg.tecnicoNombre,
    volver: `${BASE}/${slug}/${reg._id}`,
    bloques: bloquesRegistro(tipo, reg, slug, plano, true),
  });
}));

r.get('/:slug/:id/fotos/:n', leer, envolver(async (req, res, next) => {
  const reg = await buscarRegistro(req, req.params.slug);
  if (!reg) return next();
  const foto = /^\d+$/.test(req.params.n) ? (reg.fotos || [])[Number(req.params.n)] : null;
  if (!foto) return next();
  res.sendFile(rutaEvidencia(foto.archivo), {
    headers: {
      'Content-Type': foto.tipo,
      'Content-Disposition': `inline; filename="foto-${reg._id}-${req.params.n}.${foto.ext}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  }, (err) => {
    if (err && !res.headersSent) next();
  });
}));

module.exports = r;