'use strict';
const crypto = require('node:crypto');
const { col } = require('../db');
const { ErrorNegocio, normalizar, textoBusqueda } = require('../lib/util');
const { auditar } = require('../lib/auditoria');
const { aCentavos, formatear } = require('../lib/dinero');
const { textoAFechaMX } = require('../lib/fechas');
const { parsearCsv } = require('../lib/csv');
const { esTextoPlano, decodificarTexto, nombreOriginalSeguro } = require('../lib/archivos');
const { normalizarReferencia, REF_VALIDA } = require('./cobranza');

const MAX_FILAS = 5000;

function interpretarFecha(texto) {
  const t = String(texto ?? '').trim();
  let iso = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const fecha = iso ? textoAFechaMX(iso) : null;
  return fecha ? { fecha, texto: iso } : null;
}

function interpretarImporte(texto) {
  let t = String(texto ?? '').trim().replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t) || /^\d+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  const c = aCentavos(t);
  return c && c > 0 ? c : null;
}

/** Busca coincidencias exactas (referencia + importe) para los movimientos sin coincidencia. */
async function conciliarMovimientos(filtro = {}) {
  const ahora = new Date();
  let coincidencias = 0;
  const cursor = col('movimientos_bancarios').find({ ...filtro, estado: 'sin coincidencia' });
  for await (const mv of cursor) {
    const pago = await col('pagos').findOneAndUpdate(
      { referencia: mv.referencia, monto: mv.importe, estado: { $ne: 'rechazado' }, conciliado: { $ne: true } },
      { $set: { conciliado: true, movimientoId: mv._id, conciliadoEn: ahora } },
      { returnDocument: 'after' },
    );
    if (pago) {
      await col('movimientos_bancarios').updateOne(
        { _id: mv._id },
        { $set: { estado: 'coincide', pagoId: pago._id, contratoFolio: pago.contratoFolio, mensualidadId: pago.mensualidadId, conciliadoEn: ahora } },
      );
      coincidencias++;
    }
  }
  return coincidencias;
}

/**
 * Importa un CSV bancario con columnas: fecha, referencia, importe y (opcional) descripcion.
 * Valida fila por fila; las inválidas se reportan sin frenar las válidas.
 * Cada fila tiene una huella única: reimportar el mismo archivo no duplica movimientos.
 */
async function importarCsv(buffer, nombreArchivo, { usuario = null, ip = null } = {}) {
  if (!esTextoPlano(buffer)) {
    throw new ErrorNegocio('El archivo no es un CSV de texto. Si viene de Excel, guárdalo como "CSV UTF-8".', 422);
  }
  const { filas } = parsearCsv(decodificarTexto(buffer));
  while (filas.length && filas[filas.length - 1].every((c) => !String(c).trim())) filas.pop();
  if (filas.length < 2) throw new ErrorNegocio('El archivo no tiene filas para importar.', 422);
  if (filas.length - 1 > MAX_FILAS) throw new ErrorNegocio(`El archivo tiene más de ${MAX_FILAS} filas. Divídelo en partes.`, 422);

  const enc = filas[0].map((h) => normalizar(h));
  const idx = {
    fecha: enc.indexOf('fecha'),
    referencia: enc.indexOf('referencia'),
    importe: enc.indexOf('importe'),
    descripcion: enc.indexOf('descripcion'),
  };
  if (idx.fecha < 0 || idx.referencia < 0 || idx.importe < 0) {
    throw new ErrorNegocio('La primera fila debe tener los encabezados: fecha, referencia, importe (y opcionalmente descripcion).', 422);
  }

  const errores = [];
  const validas = [];
  const vistos = new Map();
  let total = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    if (f.every((c) => !String(c).trim())) continue;
    total++;
    const numFila = i + 1;
    const fecha = interpretarFecha(f[idx.fecha]);
    const referencia = normalizarReferencia(f[idx.referencia]);
    const importe = interpretarImporte(f[idx.importe]);
    const descripcion = idx.descripcion >= 0 ? String(f[idx.descripcion] ?? '').trim().slice(0, 200) : '';
    const problemas = [];
    if (!fecha) problemas.push('fecha inválida (usa AAAA-MM-DD o DD/MM/AAAA)');
    if (!REF_VALIDA.test(referencia)) problemas.push('referencia inválida');
    if (!importe) problemas.push('importe inválido o no positivo');
    if (problemas.length) {
      errores.push({ fila: numFila, error: problemas.join('; ') });
      continue;
    }
    const base = `${fecha.texto}|${referencia}|${importe}|${normalizar(descripcion)}`;
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    validas.push({
      fila: numFila,
      huella: crypto.createHash('sha256').update(`${base}|${n}`).digest('hex'),
      fecha: fecha.fecha,
      fechaTexto: fecha.texto,
      referencia,
      importe,
      descripcion,
    });
  }

  const ahora = new Date();
  const { insertedId } = await col('importaciones').insertOne({
    archivo: nombreOriginalSeguro(nombreArchivo),
    creado: ahora,
    usuarioId: usuario?._id ?? null,
    usuarioNombre: usuario?.nombre ?? null,
    filas: total,
    validas: validas.length,
    invalidas: errores.length,
    nuevas: 0,
    duplicadas: 0,
    coincidencias: 0,
    errores: errores.slice(0, 500),
  });

  let nuevas = 0;
  if (validas.length) {
    const docs = validas.map((v) => ({
      ...v,
      importacionId: insertedId,
      estado: 'sin coincidencia',
      pagoId: null,
      creado: ahora,
      busqueda: textoBusqueda(v.referencia, v.descripcion, v.fechaTexto),
    }));
    try {
      const r = await col('movimientos_bancarios').insertMany(docs, { ordered: false });
      nuevas = r.insertedCount;
    } catch (e) {
      const errs = [].concat(e.writeErrors || []);
      if (errs.length && errs.every((w) => w.code === 11000)) nuevas = e.result?.insertedCount ?? e.insertedCount ?? 0;
      else throw e;
    }
  }
  const duplicadas = validas.length - nuevas;
  const coincidencias = await conciliarMovimientos({ importacionId: insertedId });
  await col('importaciones').updateOne({ _id: insertedId }, { $set: { nuevas, duplicadas, coincidencias } });
  await auditar({
    usuario, ip, accion: 'conciliacion.importacion',
    detalle: { archivo: nombreOriginalSeguro(nombreArchivo), filas: total, validas: validas.length, invalidas: errores.length, nuevas, duplicadas, coincidencias },
  });
  return { id: insertedId, filas: total, validas: validas.length, invalidas: errores.length, nuevas, duplicadas, coincidencias, errores };
}

module.exports = { importarCsv, conciliarMovimientos, interpretarFecha, interpretarImporte, formatear };
