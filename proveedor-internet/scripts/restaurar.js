'use strict';
// Restauración: npm run restaurar -- <archivo> --confirmar [--destino=nombre_db]
// Sin --destino restaura sobre MONGODB_DB y REEMPLAZA las colecciones existentes (--drop).
require('dotenv').config();
const fs = require('node:fs');
const { ejecutarConUri } = require('./_herramientas-mongo');

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
const confirmar = args.includes('--confirmar');
const destino = (args.find((a) => a.startsWith('--destino=')) || '').split('=')[1];
const uri = process.env.MONGODB_URI;
const base = process.env.MONGODB_DB;

if (!uri || !base) { console.error('Faltan MONGODB_URI o MONGODB_DB.'); process.exit(1); }
if (!archivo || !fs.existsSync(archivo)) { console.error('Indica un archivo de respaldo existente.'); process.exit(1); }
if (!confirmar) {
  console.error(`Esto reemplazará las colecciones de "${destino || base}". Repite el comando con --confirmar para continuar.`);
  process.exit(1);
}
if (destino && !/^[A-Za-z0-9_-]{1,60}$/.test(destino)) { console.error('Nombre de destino inválido.'); process.exit(1); }

const parametros = [`--archive=${archivo}`, '--gzip', '--drop', `--nsInclude=${base}.*`];
if (destino) parametros.push(`--nsFrom=${base}.*`, `--nsTo=${destino}.*`);

ejecutarConUri('mongorestore', parametros, uri)
  .then(() => console.log(`Restauración terminada en "${destino || base}".`))
  .catch((e) => { console.error(e.message); process.exitCode = 1; });
