'use strict';
// Crea (o reactiva) una cuenta de administración. Pensado para el primer acceso en producción.
// Uso: npm run crear-admin -- correo@dominio "Nombre completo"
// La contraseña se pide por teclado para que no quede en el historial de la terminal.
require('dotenv').config();
const readline = require('node:readline/promises');
const { obtenerConfig } = require('../src/config');
const { conectar, desconectar, col } = require('../src/db');
const { crearIndices } = require('../src/indices');
const { cifrar } = require('../src/lib/contrasenas');
const { textoBusqueda } = require('../src/lib/util');

(async () => {
  const [correoArg, nombreArg] = process.argv.slice(2);
  const correo = String(correoArg || '').trim().toLowerCase();
  const nombre = String(nombreArg || 'Administración').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Uso: npm run crear-admin -- correo@dominio "Nombre completo"');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const contrasena = await rl.question('Contraseña (mínimo 10 caracteres): ');
  rl.close();
  if (contrasena.length < 10 || contrasena.length > 128) throw new Error('La contraseña debe tener de 10 a 128 caracteres.');
  const cfg = obtenerConfig();
  await conectar(cfg.mongoUri, cfg.mongoDb);
  await crearIndices();
  const ahora = new Date();
  await col('usuarios').updateOne(
    { correo },
    {
      $set: { nombre, rol: 'admin', hash: await cifrar(contrasena), activo: true, busqueda: textoBusqueda(nombre, correo), actualizado: ahora },
      $inc: { versionSesion: 1 },
      $setOnInsert: { creado: ahora },
    },
    { upsert: true },
  );
  await col('auditoria').insertOne({ fecha: ahora, accion: 'usuario.alta_por_script', usuarioId: null, usuarioCorreo: null, usuarioNombre: 'Script', ip: null, detalle: { usuario: correo, rol: 'admin' } });
  console.log(`Cuenta de administración lista: ${correo}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => desconectar());
