'use strict';
// Respaldo comprimido de la base: npm run respaldo
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { ejecutarConUri } = require('./_herramientas-mongo');

const uri = process.env.MONGODB_URI;
const base = process.env.MONGODB_DB;
if (!uri || !base) { console.error('Faltan MONGODB_URI o MONGODB_DB.'); process.exit(1); }

const carpeta = path.resolve(process.argv[2] || 'respaldos');
fs.mkdirSync(carpeta, { recursive: true });
const marca = new Date().toISOString().replace(/[:.]/g, '-');
const archivo = path.join(carpeta, `respaldo-${base}-${marca}.archive.gz`);

ejecutarConUri('mongodump', [`--db=${base}`, `--archive=${archivo}`, '--gzip'], uri)
  .then(() => console.log(`Respaldo creado: ${archivo}`))
  .catch((e) => { console.error(e.message); process.exitCode = 1; });
