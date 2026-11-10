'use strict';
// Contratos escaneados: carga masiva de PDF (hasta 100), revisión y envío por correo a cada cliente.
const express = require('express');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const multer = require('multer');
const { col, aId } = require('../db');
const { permitir } = require('../middleware/sesion');
const { verificarCsrf } = require('../middleware/csrf');
const { obtenerConfig } = require('../config');
const { envolver, paginacion, navegacion, avisar } = require('../lib/util');
const { auditarReq } = require('../lib/auditoria');
const { formatearFechaHora } = require('../lib/fechas');
const { rutaEvidencia, borrarEvidencia } = require('../lib/archivos');
const {
  renderLista, renderDetalle, renderFormulario, llenar, insignia, filtroSelect,
} = require('../lib/vistas');
const { evaluar, procesarCola } = require('../servicios/contratos-pdf');

const r = express.Router();
const leer = permitir('contratos_pdf', 'leer');
const escribir = permitir('contratos_pdf', 'escribir');
const BASE = '/contratos-escaneados';
const MAX_PDFS = 100;

const ETIQUETAS = {
  por_enviar: ['Listo para enviar', 'azul'],
  en_cola: ['En cola', 'ambar'],
  enviando: ['Enviando', 'ambar'],
  enviado: ['Enviado', 'verde'],
  fallo: ['Falló el envío', 'rojo'],
  sin_contrato: ['Sin contrato', 'ambar'],
  sin_correo: ['Sin correo', 'ambar'],
  duplicado: ['Duplicado', 'gris'],
};
const insigniaDe = (estado) => insignia(...(ETIQUETAS[estado] || [estado, 'gris']));
const usuarioMin = (u) => ({ _id: u._id, correo: u.correo, nombre: u.nombre });
const nombreVisible = (n) => String(n || 'archivo.pdf').replace(/[^\w.\- ()]+/g, '_').slice(0, 100);

// ---------- Recepción de PDF (a disco, no a memoria: son muchos y pesan) ----------

async function esPdf(ruta) {
  let h;
  try {
    h = await fs.open(ruta, 'r');
    const b = Buffer.alloc(5);
    await h.read(b, 0, 5, 0);
    return b.toString('latin1') === '%PDF-';
  } catch {
    return false;
  } finally {
    if (h) await h.close();
  }
}

function recibirPdfs(req, res, next) {
  const { evidenceDir, maxUploadBytes } = obtenerConfig();
  const subir = multer({
    storage: multer.diskStorage({
      destination: (rq, file, cb) => fs.mkdir(evidenceDir, { recursive: true, mode: 0o750 }).then(() => cb(null, evidenceDir), cb),
      filename: (rq, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
    }),
    limits: { fileSize: maxUploadBytes, files: MAX_PDFS, fields: 10, fieldSize: 4096, parts: MAX_PDFS + 10 },
  }).array('pdfs', MAX_PDFS);
  subir(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      req.errorArchivo = err.code === 'LIMIT_FILE_SIZE'
        ? `Un PDF supera el máximo de ${Math.max(1, Math.round(maxUploadBytes / 1048576))} MB. Súbelo en otro lote o aumenta MAX_UPLOAD_MB.`
        : (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
          ? `Máximo ${MAX_PDFS} PDF por carga.`
          : 'No se pudieron recibir los PDF.';
      return next();
    }
    if (err) return next(err);
    // Si algo falla después (token CSRF, error), los archivos que nadie reclamó se borran.
    res.on('close', () => {
      for (const a of req.files || []) if (!a.reclamado) borrarEvidencia(a.filename);
    });
    return next();
  });
}

async function encolar(filtro, req) {
  if (!obtenerConfig().smtp.host) return -1;
  const x = await col('contratos_pdf').updateMany(filtro, {
    $set: { estado: 'en_cola', colaPor: usuarioMin(req.usuario), colaEn: new Date(), error: '' },
  });
  if (x.modifiedCount) procesarCola(); // corre en segundo plano
  return x.modifiedCount;
}

const SIN_SMTP = 'El correo no está configurado en el servidor (SMTP_HOST, SMTP_PORT y SMTP_FROM en el .env).';

// ---------- Lista ----------

const OPCIONES_ESTADO = [
  { valor: '', texto: 'Todos' },
  ...Object.entries(ETIQUETAS).map(([valor, [texto]]) => ({ valor, texto })),
];

r.get('/', leer, envolver(async (req, res) => {
  const estado = ETIQUETAS[req.query.estado] ? req.query.estado : '';
  const filtro = estado ? { estado } : {};
  const { pagina, salto, limite } = paginacion(req);
  const [docs, total, grupos] = await Promise.all([
    col('contratos_pdf').find(filtro).sort({ subido: -1 }).skip(salto).limit(limite).toArray(),
    col('contratos_pdf').countDocuments(filtro),
    col('contratos_pdf').aggregate([{ $group: { _id: '$estado', n: { $sum: 1 } } }]).toArray(),
  ]);
  const n = Object.fromEntries(grupos.map((g) => [g._id, g.n]));
  const botones = [];
  if (n.por_enviar) {
    botones.push({
      texto: `Enviar ${n.por_enviar} verificado(s)`,
      accion: `${BASE}/enviar`,
      confirmar: `¿Enviar ${n.por_enviar} contrato(s) por correo a sus clientes? Revisa que cada PDF esté con el contrato correcto.`,
    });
  }
  if (n.fallo) botones.push({ texto: `Reintentar ${n.fallo} fallido(s)`, accion: `${BASE}/reintentar`, estilo: 'secundario' });
  const bloquesSuperiores = [{
    tipo: 'datos',
    filas: [
      { etiqueta: 'Listos para enviar', valor: String(n.por_enviar || 0) },
      { etiqueta: 'En envío', valor: String((n.en_cola || 0) + (n.enviando || 0)) },
      { etiqueta: 'Enviados', valor: String(n.enviado || 0) },
      { etiqueta: 'Por revisar (sin contrato, sin correo o duplicados)', valor: String((n.sin_contrato || 0) + (n.sin_correo || 0) + (n.duplicado || 0)) },
      { etiqueta: 'Fallidos', valor: String(n.fallo || 0) },
    ],
  }];
  if (botones.length) bloquesSuperiores.push({ tipo: 'botones', botones });
  renderLista(res, {
    titulo: 'Contratos escaneados',
    filtros: [filtroSelect('estado', 'Estado', estado, OPCIONES_ESTADO)],
    enlaceNuevo: `${BASE}/cargar`,
    textoNuevo: 'Cargar PDF',
    bloquesSuperiores,
    filas: docs.map((d) => ({
      enlace: `${BASE}/${d._id}`,
      titulo: d.nombreOriginal,
      subtitulo: d.contratoFolio ? `${d.contratoFolio} · ${d.clienteNombre}` : (d.motivo || 'Sin contrato'),
      insignia: insigniaDe(d.estado),
      campos: [{ etiqueta: 'Correo', valor: d.correo || '—' }],
    })),
    nav: navegacion(req, total, pagina),
    vacio: 'Aún no has cargado contratos escaneados.',
  });
}));

// ---------- Carga masiva ----------

r.get('/cargar', escribir, (req, res) => {
  const maxMb = Math.round(obtenerConfig().maxUploadBytes / 1048576);
  renderFormulario(res, {
    titulo: 'Cargar contratos escaneados',
    accion: BASE,
    cancelar: BASE,
    boton: 'Cargar y revisar',
    multipart: true,
    campos: llenar([{
      nombre: 'pdfs', etiqueta: `PDF escaneados (hasta ${MAX_PDFS})`, tipo: 'file', multiple: true, requerido: true, aceptar: 'application/pdf',
    }]),
    nota: `Un PDF por cliente, máximo ${maxMb} MB cada uno. Nombra cada archivo con el número del contrato: `
      + 'CTR-60109A.pdf (número impreso en el papel) o CTR-2026-00008.pdf (folio del sistema). '
      + 'Al cargar, nada se envía: primero revisas la lista.',
  });
});

r.post('/', escribir, recibirPdfs, verificarCsrf, envolver(async (req, res) => {
  if (req.errorArchivo) { avisar(req, req.errorArchivo, 'error'); return res.redirect(`${BASE}/cargar`); }
  const archivos = req.files || [];
  if (!archivos.length) { avisar(req, 'Elige al menos un PDF.', 'error'); return res.redirect(`${BASE}/cargar`); }
  const cuenta = {};
  let invalidos = 0;
  for (const a of archivos) {
    if (!(await esPdf(a.path))) { invalidos += 1; continue; }
    const ev = await evaluar({ referencia: a.originalname });
    await col('contratos_pdf').insertOne({
      archivo: a.filename,
      tamano: a.size,
      nombreOriginal: nombreVisible(a.originalname),
      estado: ev.estado,
      motivo: ev.motivo || '',
      contratoId: ev.contratoId ?? null,
      contratoFolio: ev.contratoFolio ?? null,
      numeroImpreso: ev.numeroImpreso ?? null,
      clienteId: ev.clienteId ?? null,
      clienteNombre: ev.clienteNombre ?? '',
      correo: ev.correo ?? '',
      intentos: 0,
      subido: new Date(),
      subidoPor: req.usuario._id,
      subidoPorNombre: req.usuario.nombre,
    });
    a.reclamado = true;
    cuenta[ev.estado] = (cuenta[ev.estado] || 0) + 1;
  }
  await auditarReq(req, 'contrato_pdf.carga', { cantidad: archivos.length - invalidos, invalidos });
  const partes = [];
  if (cuenta.por_enviar) partes.push(`${cuenta.por_enviar} listo(s) para enviar`);
  if (cuenta.sin_contrato) partes.push(`${cuenta.sin_contrato} sin contrato`);
  if (cuenta.sin_correo) partes.push(`${cuenta.sin_correo} sin correo`);
  if (cuenta.duplicado) partes.push(`${cuenta.duplicado} duplicado(s)`);
  if (invalidos) partes.push(`${invalidos} no eran PDF y se descartaron`);
  avisar(req, `Se cargaron ${archivos.length - invalidos} PDF: ${partes.join(', ') || 'ninguno válido'}. Revisa la lista antes de enviar.`);
  return res.redirect(BASE);
}));

// ---------- Envío masivo ----------

r.post('/enviar', escribir, envolver(async (req, res) => {
  const n = await encolar({ estado: 'por_enviar' }, req);
  if (n === -1) avisar(req, SIN_SMTP, 'error');
  else if (!n) avisar(req, 'No hay contratos listos para enviar.', 'error');
  else {
    await auditarReq(req, 'contrato_pdf.cola', { cantidad: n });
    avisar(req, `${n} contrato(s) en cola. Se envían uno por uno; esta lista se actualiza sola.`);
  }
  return res.redirect(BASE);
}));

r.post('/reintentar', escribir, envolver(async (req, res) => {
  const n = await encolar({ estado: 'fallo' }, req);
  if (n === -1) avisar(req, SIN_SMTP, 'error');
  else if (!n) avisar(req, 'No hay envíos fallidos.', 'error');
  else avisar(req, `${n} envío(s) fallido(s) vuelven a la cola.`);
  return res.redirect(BASE);
}));

// ---------- Detalle de un PDF ----------

async function buscar(req, next) {
  const id = aId(req.params.id);
  const d = id ? await col('contratos_pdf').findOne({ _id: id }) : null;
  if (!d) next();
  return d;
}

r.get('/:id', leer, envolver(async (req, res, next) => {
  const d = await buscar(req, next);
  if (!d) return;
  const filas = [
    { etiqueta: 'Archivo', valor: d.nombreOriginal },
    { etiqueta: 'Tamaño', valor: `${Math.ceil(d.tamano / 1024)} KB` },
    ...(d.contratoId ? [{ etiqueta: 'Contrato', valor: d.contratoFolio, enlace: `/contratos/${d.contratoId}` }] : []),
    { etiqueta: 'Número impreso', valor: d.numeroImpreso || '—' },
    { etiqueta: 'Cliente', valor: d.clienteNombre || '—' },
    { etiqueta: 'Correo', valor: d.correo || '—' },
    { etiqueta: 'Cargado', valor: `${formatearFechaHora(d.subido)} · ${d.subidoPorNombre || ''}` },
    ...(d.enviadoEn ? [{ etiqueta: 'Enviado', valor: formatearFechaHora(d.enviadoEn) }] : []),
    { etiqueta: 'Intentos de envío', valor: String(d.intentos || 0) },
    ...(d.motivo ? [{ etiqueta: 'Observación', valor: d.motivo }] : []),
    ...(d.error ? [{ etiqueta: 'Error', valor: d.error }] : []),
  ];
  const bloques = [{ tipo: 'datos', insignia: insigniaDe(d.estado), filas }];
  if (d.estado === 'sin_contrato') {
    bloques.push({
      tipo: 'formulario',
      titulo: 'Asignar contrato',
      accion: `${BASE}/${d._id}/asignar`,
      campos: llenar([{
        nombre: 'referencia', etiqueta: 'Folio CTR o número impreso', tipo: 'text', requerido: true, max: 30, autocapitalize: 'characters',
        ayuda: 'Ej. CTR-2026-00008 o 60109A',
      }]),
      boton: 'Asignar',
    });
  }
  const botones = [{ texto: 'Ver PDF', enlace: `${BASE}/${d._id}/pdf`, nuevaPestana: true }];
  if (['sin_contrato', 'sin_correo', 'duplicado'].includes(d.estado)) {
    botones.push({ texto: 'Volver a revisar', accion: `${BASE}/${d._id}/revisar`, estilo: 'secundario' });
  }
  if (['por_enviar', 'fallo'].includes(d.estado)) {
    botones.push({ texto: 'Enviar por correo', accion: `${BASE}/${d._id}/enviar`, confirmar: `¿Enviar este contrato a ${d.correo}?` });
  }
  if (d.estado === 'enviado') {
    botones.push({ texto: 'Reenviar', accion: `${BASE}/${d._id}/enviar`, estilo: 'secundario', confirmar: `¿Volver a enviar este contrato a ${d.correo}?` });
  }
  if (!['enviado', 'en_cola', 'enviando'].includes(d.estado)) {
    botones.push({ texto: 'Descartar', accion: `${BASE}/${d._id}/descartar`, estilo: 'peligro', confirmar: '¿Descartar este PDF? Se borra el archivo.' });
  }
  bloques.push({ tipo: 'botones', botones });
  renderDetalle(res, { titulo: d.nombreOriginal, subtitulo: d.clienteNombre || '', volver: BASE, bloques });
}));

r.get('/:id/pdf', leer, envolver(async (req, res, next) => {
  const d = await buscar(req, next);
  if (!d) return;
  res.sendFile(rutaEvidencia(d.archivo), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename="contrato-${d._id}.pdf"`,
      // Solo para este PDF: la regla general (object-src 'none') impide que Chrome lo muestre en pantalla.
      'Content-Security-Policy': "default-src 'none'; object-src 'self'; frame-ancestors 'none'",
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  }, (err) => { if (err && !res.headersSent) next(); });
}));

async function reevaluar(d, referencia) {
  const ev = await evaluar({ referencia, excluirId: d._id });
  const cambio = await col('contratos_pdf').updateOne(
    { _id: d._id, estado: { $in: ['sin_contrato', 'sin_correo', 'duplicado'] } },
    {
      $set: {
        estado: ev.estado,
        motivo: ev.motivo || '',
        contratoId: ev.contratoId ?? null,
        contratoFolio: ev.contratoFolio ?? null,
        numeroImpreso: ev.numeroImpreso ?? null,
        clienteId: ev.clienteId ?? null,
        clienteNombre: ev.clienteNombre ?? '',
        correo: ev.correo ?? '',
      },
    },
  );
  return { ev, cambio: cambio.modifiedCount };
}

r.post('/:id/asignar', escribir, envolver(async (req, res, next) => {
  const d = await buscar(req, next);
  if (!d) return;
  const referencia = String(req.body.referencia || '').trim().slice(0, 30);
  if (!referencia) { avisar(req, 'Escribe el folio CTR o el número impreso.', 'error'); return res.redirect(`${BASE}/${d._id}`); }
  const { ev } = await reevaluar(d, referencia);
  avisar(req, ev.estado === 'sin_contrato' ? ev.motivo : `Asignado a ${ev.contratoFolio}.`, ev.estado === 'sin_contrato' ? 'error' : 'exito');
  return res.redirect(`${BASE}/${d._id}`);
}));

r.post('/:id/revisar', escribir, envolver(async (req, res, next) => {
  const d = await buscar(req, next);
  if (!d) return;
  const { ev } = await reevaluar(d, d.contratoFolio || d.nombreOriginal);
  avisar(req, ev.estado === 'por_enviar' ? 'Listo para enviar.' : (ev.motivo || 'Revisado.'), ev.estado === 'por_enviar' ? 'exito' : 'error');
  return res.redirect(`${BASE}/${d._id}`);
}));

r.post('/:id/enviar', escribir, envolver(async (req, res, next) => {
  const d = await buscar(req, next);
  if (!d) return;
  const n = await encolar({ _id: d._id, estado: { $in: ['por_enviar', 'fallo', 'enviado'] } }, req);
  if (n === -1) avisar(req, SIN_SMTP, 'error');
  else if (!n) avisar(req, 'Este PDF no se puede enviar en su estado actual.', 'error');
  else {
    await auditarReq(req, 'contrato_pdf.cola', { cantidad: 1, contrato: d.contratoFolio });
    avisar(req, 'En cola para enviarse.');
  }
  return res.redirect(`${BASE}/${d._id}`);
}));

r.post('/:id/descartar', escribir, envolver(async (req, res, next) => {
  const d = await buscar(req, next);
  if (!d) return;
  const x = await col('contratos_pdf').deleteOne({ _id: d._id, estado: { $nin: ['enviado', 'en_cola', 'enviando'] } });
  if (!x.deletedCount) {
    avisar(req, 'Este PDF ya no se puede descartar.', 'error');
    return res.redirect(`${BASE}/${d._id}`);
  }
  await borrarEvidencia(d.archivo);
  await auditarReq(req, 'contrato_pdf.descarte', { archivo: d.nombreOriginal });
  avisar(req, 'PDF descartado.');
  return res.redirect(BASE);
}));

module.exports = r;