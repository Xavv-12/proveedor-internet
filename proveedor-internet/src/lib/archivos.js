'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const { obtenerConfig } = require('../config');

// Se valida la firma real (bytes iniciales), no la extensión ni el tipo que declara el navegador.
const FIRMAS = [
  { tipo: 'image/jpeg', ext: 'jpg', prueba: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { tipo: 'image/png', ext: 'png', prueba: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { tipo: 'image/webp', ext: 'webp', prueba: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { tipo: 'application/pdf', ext: 'pdf', prueba: (b) => b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-' },
];

function detectarTipo(buffer) {
  return FIRMAS.find((f) => f.prueba(buffer)) || null;
}

/** Recibe un solo archivo en memoria con límite de tamaño. Los errores quedan en req.errorArchivo. */
function recibirArchivo(campo, maxBytes) {
  const subir = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 4096, parts: 12 },
  }).single(campo);
  return (req, res, next) => subir(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      req.errorArchivo = err.code === 'LIMIT_FILE_SIZE'
        ? `El archivo supera el máximo de ${Math.max(1, Math.round(maxBytes / 1048576))} MB.`
        : 'No se pudo recibir el archivo.';
      return next();
    }
    return next(err);
  });
}

/** Recibe varias fotos en memoria (hasta maxArchivos). Los errores quedan en req.errorArchivo. */
function recibirArchivos(campo, maxBytes, maxArchivos = 6) {
  const subir = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: maxArchivos, fields: 40, fieldSize: 4096, parts: maxArchivos + 40 },
  }).array(campo, maxArchivos);
  return (req, res, next) => subir(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        req.errorArchivo = 'Cada foto debe pesar máximo ' + Math.max(1, Math.round(maxBytes / 1048576)) + ' MB.';
      } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        req.errorArchivo = 'Máximo ' + maxArchivos + ' fotos por registro.';
      } else {
        req.errorArchivo = 'No se pudieron recibir las fotos.';
      }
      return next();
    }
    return next(err);
  });
}

const NOMBRE_SEGURO = /^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

async function guardarEvidencia(buffer, tipo) {
  const dir = obtenerConfig().evidenceDir;
  await fs.mkdir(dir, { recursive: true, mode: 0o750 });
  const nombre = `${crypto.randomUUID()}.${tipo.ext}`;
  await fs.writeFile(path.join(dir, nombre), buffer, { mode: 0o640, flag: 'wx' });
  return nombre;
}

function rutaEvidencia(nombre) {
  if (!NOMBRE_SEGURO.test(nombre)) throw new Error('Nombre de evidencia inválido.');
  return path.join(obtenerConfig().evidenceDir, nombre);
}

async function borrarEvidencia(nombre) {
  try { await fs.unlink(rutaEvidencia(nombre)); } catch { /* sin acción */ }
}

/** Un CSV debe ser texto: sin bytes nulos ni firmas de archivos binarios (Excel, PDF, imágenes). */
function esTextoPlano(buffer) {
  if (!buffer || !buffer.length) return false;
  if (buffer.includes(0)) return false;
  if (detectarTipo(buffer)) return false;
  if (buffer.toString('latin1', 0, 2) === 'PK') return false; // xlsx/zip
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return false; // xls
  return true;
}

function decodificarTexto(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function nombreOriginalSeguro(nombre) {
  return String(nombre || 'archivo').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
}

module.exports = {
  detectarTipo, recibirArchivo, recibirArchivos, guardarEvidencia, rutaEvidencia, borrarEvidencia, esTextoPlano, decodificarTexto, nombreOriginalSeguro,
};
