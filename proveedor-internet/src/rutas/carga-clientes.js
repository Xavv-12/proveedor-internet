'use strict';
// Carga masiva de clientes: 1) se sube el Excel y se revisa (no guarda nada), 2) se confirma y se importa.
const express = require('express');
const { col, aId } = require('../db');
const { permitir } = require('../middleware/sesion');
const { verificarCsrf } = require('../middleware/csrf');
const { obtenerConfig } = require('../config');
const { envolver, avisar, textoBusqueda } = require('../lib/util');
const { auditarReq } = require('../lib/auditoria');
const { recibirArchivo } = require('../lib/archivos');
const { formatearFechaHora } = require('../lib/fechas');
const { renderDetalle, llenar } = require('../lib/vistas');
const { leerExcel, validarFila, crearPlantilla, claveNombre, MAX_FILAS } = require('../lib/excel-clientes');

const r = express.Router();
const leer = permitir('clientes', 'leer');
const escribir = permitir('clientes', 'escribir');
const BASE = '/clientes/carga-masiva';
const MOSTRAR = 200; // máximo de filas que se listan por categoría en pantalla
const VIGENCIA_MS = 2 * 60 * 60 * 1000; // la revisión se conserva 2 horas

let indiceListo = false;
async function asegurarIndice() {
  if (indiceListo) return;
  try {
    await col('cargas_clientes').createIndex({ expira: 1 }, { expireAfterSeconds: 0 });
    indiceListo = true;
  } catch { /* si falla, se vuelve a intentar en la próxima carga */ }
}

/** Busca en la base los clientes que ya tienen alguno de estos teléfonos o números de contrato. */
async function buscarExistentes(telefonos, numeros) {
  const filtro = [];
  if (telefonos.length) filtro.push({ telefono: { $in: telefonos } });
  if (numeros.length) filtro.push({ numeroContratoImpreso: { $in: numeros } });
  if (!filtro.length) return [];
  return col('clientes')
    .find({ $or: filtro }, { projection: { nombre: 1, telefono: 1, numeroContratoImpreso: 1 } })
    .limit(5000)
    .toArray();
}

/**
 * Clasifica cada fila: listo, aviso (se puede importar, pero revisa), duplicado (se omite) o error (no se importa).
 * `filas` ya trae `datos` en las filas válidas.
 */
function clasificar(filas, existentes) {
  const porTelefono = new Map();
  const porNumero = new Map();
  for (const e of existentes) {
    if (!porTelefono.has(e.telefono)) porTelefono.set(e.telefono, []);
    porTelefono.get(e.telefono).push(e);
    if (e.numeroContratoImpreso) porNumero.set(e.numeroContratoImpreso, e);
  }
  const vistoNombreTel = new Map(); // "nombre|telefono" -> fila
  const vistoNumero = new Map();
  const vistoTelefono = new Map(); // teléfono -> nombre de la primera fila
  for (const f of filas) {
    if (f.estado === 'error') continue;
    const d = f.datos;
    const clave = `${claveNombre(d.nombre)}|${d.telefono}`;
    const igualEnBase = (porTelefono.get(d.telefono) || []).some((e) => claveNombre(e.nombre) === claveNombre(d.nombre));
    if (igualEnBase) { f.estado = 'duplicado'; f.mensajes = ['Ya existe un cliente con ese nombre y teléfono.']; continue; }
    if (vistoNombreTel.has(clave)) { f.estado = 'duplicado'; f.mensajes = [`Repetido en el archivo (igual que la fila ${vistoNombreTel.get(clave)}).`]; continue; }
    if (d.numeroImpreso && porNumero.has(d.numeroImpreso)) { f.estado = 'duplicado'; f.mensajes = ['Ya existe un cliente con ese número de contrato (papel).']; continue; }
    if (d.numeroImpreso && vistoNumero.has(d.numeroImpreso)) { f.estado = 'duplicado'; f.mensajes = [`El número de contrato ya está en la fila ${vistoNumero.get(d.numeroImpreso)}.`]; continue; }
    vistoNombreTel.set(clave, f.fila);
    if (d.numeroImpreso) vistoNumero.set(d.numeroImpreso, f.fila);
    const otroEnBase = (porTelefono.get(d.telefono) || [])[0];
    if (otroEnBase) {
      f.estado = 'aviso';
      f.mensajes = [`El teléfono ya está en otro cliente (${otroEnBase.nombre}). Se importa igual.`];
    } else if (vistoTelefono.has(d.telefono)) {
      f.estado = 'aviso';
      f.mensajes = [`El teléfono también está en ${vistoTelefono.get(d.telefono)} (en este archivo). Se importa igual.`];
    } else {
      f.estado = 'listo';
      f.mensajes = [];
    }
    if (!vistoTelefono.has(d.telefono)) vistoTelefono.set(d.telefono, d.nombre);
  }
}

const usuarioPuede = (req, carga) => String(carga.usuarioId) === String(req.usuario._id) || req.usuario.rol === 'admin';

// ---------- Pantalla inicial: plantilla y subida ----------

r.get('/', leer, envolver(async (req, res) => {
  const maxMb = Math.round(obtenerConfig().maxUploadBytes / 1048576);
  renderDetalle(res, {
    titulo: 'Carga masiva de clientes',
    subtitulo: 'Sube un Excel con muchos clientes de una sola vez',
    volver: '/clientes',
    bloques: [
      {
        tipo: 'datos',
        filas: [
          { etiqueta: 'Paso 1', valor: 'Descarga la plantilla y llénala (o usa tu archivo de clientes completos con los mismos encabezados).' },
          { etiqueta: 'Paso 2', valor: 'Súbela aquí. Nada se guarda todavía: primero ves cuántos están listos, cuáles ya existen y cuáles tienen errores.' },
          { etiqueta: 'Paso 3', valor: 'Si todo se ve bien, pulsas Importar. Los clientes se crean con las mismas reglas del formulario Nuevo cliente.' },
        ],
      },
      { tipo: 'botones', botones: [{ texto: 'Descargar plantilla', enlace: `${BASE}/plantilla`, estilo: 'secundario' }] },
      {
        tipo: 'formulario',
        titulo: 'Subir Excel',
        accion: BASE,
        multipart: true,
        campos: llenar([{
          nombre: 'archivo', etiqueta: 'Archivo de Excel (.xlsx)', tipo: 'file', requerido: true,
          aceptar: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }]),
        boton: 'Subir y revisar',
        nota: `Máximo ${MAX_FILAS} clientes por archivo y ${maxMb} MB. Los clientes que ya existen (mismo nombre y teléfono) se omiten.`,
      },
    ],
  });
}));

r.get('/plantilla', leer, envolver(async (req, res) => {
  const buffer = await crearPlantilla();
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="plantilla-clientes.xlsx"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}));

// ---------- Subir y revisar (no guarda clientes) ----------

r.post(
  '/',
  escribir,
  (req, res, next) => recibirArchivo('archivo', obtenerConfig().maxUploadBytes)(req, res, next),
  verificarCsrf,
  envolver(async (req, res) => {
    if (req.errorArchivo) { avisar(req, req.errorArchivo, 'error'); return res.redirect(BASE); }
    if (!req.file || !req.file.buffer?.length) { avisar(req, 'Elige el archivo de Excel.', 'error'); return res.redirect(BASE); }
    const leido = await leerExcel(req.file.buffer);
    if (leido.error) { avisar(req, leido.error, 'error'); return res.redirect(BASE); }

    const filas = leido.filas.map((f) => {
      const v = validarFila(f.valores);
      return v.ok
        ? { fila: f.fila, estado: 'listo', datos: v.datos, mensajes: [] }
        : { fila: f.fila, estado: 'error', datos: null, nombre: f.valores.nombre, mensajes: v.errores };
    });
    const validas = filas.filter((f) => f.estado !== 'error');
    const telefonos = [...new Set(validas.map((f) => f.datos.telefono))];
    const numeros = [...new Set(validas.map((f) => f.datos.numeroImpreso).filter(Boolean))];
    clasificar(filas, await buscarExistentes(telefonos, numeros));

    await asegurarIndice();
    await col('cargas_clientes').deleteMany({ usuarioId: req.usuario._id, estado: 'pendiente' }); // una revisión a la vez
    const ahora = new Date();
    const doc = {
      usuarioId: req.usuario._id,
      usuarioNombre: req.usuario.nombre,
      archivo: String(req.file.originalname || 'clientes.xlsx').replace(/[^\w.\- ()]+/g, '_').slice(0, 100),
      estado: 'pendiente',
      filas,
      creado: ahora,
      expira: new Date(ahora.getTime() + VIGENCIA_MS),
    };
    await col('cargas_clientes').insertOne(doc);
    await auditarReq(req, 'cliente.carga_revision', { archivo: doc.archivo, filas: filas.length });
    return res.redirect(`${BASE}/${doc._id}`);
  }),
);

// ---------- Resultado de la revisión ----------

async function buscarCarga(req, next) {
  const id = aId(req.params.id);
  const c = id ? await col('cargas_clientes').findOne({ _id: id }) : null;
  if (!c || !usuarioPuede(req, c)) { next(); return null; }
  return c;
}

const elementos = (lista) => lista.slice(0, MOSTRAR).map((f) => ({
  titulo: `Fila ${f.fila} · ${(f.datos ? f.datos.nombre : f.nombre) || '(sin nombre)'}`,
  subtitulo: f.mensajes.join(' · '),
}));

r.get('/:id', leer, envolver(async (req, res, next) => {
  const c = await buscarCarga(req, next);
  if (!c) return;
  if (c.estado !== 'pendiente') {
    avisar(req, 'Esta carga ya se importó o se descartó.', 'error');
    return res.redirect(BASE);
  }
  const por = (estado) => c.filas.filter((f) => f.estado === estado);
  const listos = por('listo');
  const avisos = por('aviso');
  const duplicados = por('duplicado');
  const errores = por('error');
  const importables = listos.length + avisos.length;
  const bloques = [{
    tipo: 'datos',
    filas: [
      { etiqueta: 'Archivo', valor: c.archivo },
      { etiqueta: 'Filas leídas', valor: String(c.filas.length) },
      { etiqueta: 'Se importarán', valor: `${importables}${avisos.length ? ` (${avisos.length} con aviso)` : ''}` },
      { etiqueta: 'Ya existen (se omiten)', valor: String(duplicados.length) },
      { etiqueta: 'Con errores (no se importan)', valor: String(errores.length) },
      { etiqueta: 'Revisión válida hasta', valor: formatearFechaHora(c.expira) },
    ],
  }];
  const botones = [];
  if (importables) {
    botones.push({
      texto: `Importar ${importables} cliente(s)`,
      accion: `${BASE}/${c._id}/importar`,
      confirmar: `¿Importar ${importables} cliente(s)? Se crean con las mismas reglas del formulario Nuevo cliente.`,
    });
  }
  botones.push({ texto: 'Descartar y subir otro', accion: `${BASE}/${c._id}/cancelar`, estilo: 'secundario' });
  bloques.push({ tipo: 'botones', botones });
  const lista = (titulo, items, nota) => {
    if (!items.length) return;
    bloques.push({
      tipo: 'lista',
      titulo: `${titulo} (${items.length}${items.length > MOSTRAR ? `, se muestran ${MOSTRAR}` : ''})`,
      nota,
      vacio: '',
      elementos: elementos(items),
    });
  };
  lista('Con errores: corrígelos en el Excel y vuelve a subirlo', errores, 'Estas filas no se importan.');
  lista('Con aviso', avisos, 'Se importan, pero revisa que no sea un error.');
  lista('Ya existen', duplicados, 'Se omiten para no duplicar clientes.');
  renderDetalle(res, { titulo: 'Revisión de la carga', subtitulo: c.archivo, volver: BASE, bloques });
}));

// ---------- Importar ----------

r.post('/:id/importar', escribir, envolver(async (req, res, next) => {
  const c = await buscarCarga(req, next);
  if (!c) return;
  // Se "reclama" la carga: si alguien pulsa dos veces, la segunda no hace nada.
  const reclamada = await col('cargas_clientes').findOneAndUpdate(
    { _id: c._id, estado: 'pendiente' },
    { $set: { estado: 'importando' } },
    { returnDocument: 'after' },
  );
  if (!reclamada) { avisar(req, 'Esta carga ya se importó o se descartó.', 'error'); return res.redirect(BASE); }

  const candidatas = reclamada.filas.filter((f) => f.estado === 'listo' || f.estado === 'aviso');
  // Se vuelve a comprobar contra la base: pudo crearse un cliente igual desde la revisión hasta ahora.
  const telefonos = [...new Set(candidatas.map((f) => f.datos.telefono))];
  const numeros = [...new Set(candidatas.map((f) => f.datos.numeroImpreso).filter(Boolean))];
  clasificar(candidatas.map((f) => Object.assign(f, { estado: 'listo' })), await buscarExistentes(telefonos, numeros));
  const importables = candidatas.filter((f) => f.estado === 'listo' || f.estado === 'aviso');
  const omitidos = candidatas.length - importables.length;

  const ahora = new Date();
  const docs = importables.map((f) => {
    const d = f.datos;
    const doc = {
      nombre: d.nombre,
      telefono: d.telefono,
      correo: d.correo,
      direccion: d.direccion,
      colonia: d.colonia,
      codigoPostal: d.codigoPostal,
      referencias: d.referencias,
      notas: d.notas,
      busqueda: textoBusqueda(d.nombre, d.telefono, d.correo, d.colonia, d.codigoPostal, d.numeroImpreso),
      activo: true,
      origen: 'carga_masiva',
      cargaId: c._id,
      creado: ahora,
      actualizado: ahora,
      creadoPor: req.usuario._id,
    };
    if (d.numeroImpreso) doc.numeroContratoImpreso = d.numeroImpreso;
    return doc;
  });

  let creados = 0;
  try {
    for (let i = 0; i < docs.length; i += 100) {
      const lote = docs.slice(i, i + 100);
      const x = await col('clientes').insertMany(lote, { ordered: false });
      creados += x.insertedCount ?? lote.length;
    }
  } catch (e) {
    creados = (e.result && (e.result.insertedCount ?? e.result.nInserted)) ?? creados;
    await col('cargas_clientes').updateOne({ _id: c._id }, { $set: { estado: 'importada', importada: ahora, resultado: { creados, error: String(e.message).slice(0, 200) } }, $unset: { filas: 1 } });
    await auditarReq(req, 'cliente.carga_masiva', { archivo: c.archivo, creados, error: 'interrumpida' });
    avisar(req, `La importación se interrumpió. Se crearon ${creados} cliente(s). Revisa la lista de Clientes antes de volver a subir el archivo.`, 'error');
    return res.redirect('/clientes');
  }

  await col('cargas_clientes').updateOne(
    { _id: c._id },
    { $set: { estado: 'importada', importada: ahora, resultado: { creados, omitidos } }, $unset: { filas: 1 } }, // ya no se guardan los datos del Excel
  );
  await auditarReq(req, 'cliente.carga_masiva', { archivo: c.archivo, creados, omitidos });
  avisar(req, `Se importaron ${creados} cliente(s).${omitidos ? ` ${omitidos} se omitieron porque ya existían.` : ''}`);
  return res.redirect('/clientes');
}));

r.post('/:id/cancelar', escribir, envolver(async (req, res, next) => {
  const c = await buscarCarga(req, next);
  if (!c) return;
  await col('cargas_clientes').deleteOne({ _id: c._id, estado: 'pendiente' });
  avisar(req, 'Carga descartada. No se guardó ningún cliente.');
  return res.redirect(BASE);
}));

module.exports = r;