'use strict';
// Entorno de pruebas: base de datos en memoria (réplica de un nodo para transacciones),
// distinta de la de producción. Nunca se usan datos reales.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');

const NOMBRE_DB = 'proveedor_pruebas';
const CONTRASENA = `Prueba-${crypto.randomBytes(9).toString('base64url')}`;

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_DB: NOMBRE_DB,
  SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  APP_URL: 'http://localhost:3000',
  SITIO_ORIGENES: 'https://sitio.prueba.example',
  WA_VERIFY_TOKEN: 'verificacion-de-prueba',
  WA_APP_SECRET: 'secreto-de-prueba',
  WA_TOKEN: '',
  WA_PHONE_ID: '',
  SMTP_HOST: '',
  TRUST_PROXY: '',
  EVIDENCE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'evidencias-prueba-')),
  MAX_UPLOAD_MB: '2',
});

async function preparar() {
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = rs.getUri();
  require('../src/config').reiniciarConfig();
  const db = require('../src/db');
  await db.conectar(process.env.MONGODB_URI, NOMBRE_DB);
  if (!db.db().databaseName.endsWith('_pruebas')) throw new Error('Las pruebas solo corren sobre una base *_pruebas.');
  await require('../src/indices').crearIndices();
  const { crearApp } = require('../src/app');
  const app = crearApp();

  const { cifrar } = require('../src/lib/contrasenas');
  const hash = await cifrar(CONTRASENA);
  const usuarios = {};
  for (const rol of ['admin', 'atencion', 'tecnico']) {
    const doc = { nombre: `Usuario ${rol}`, correo: `${rol}@prueba.example`, rol, hash, activo: true, versionSesion: 1, busqueda: rol, creado: new Date() };
    await db.col('usuarios').insertOne(doc);
    usuarios[rol] = doc;
  }
  return {
    app, db, usuarios, contrasena: CONTRASENA,
    async cerrar() { await db.desconectar(); await rs.stop(); },
  };
}

async function obtenerCsrf(agente, ruta = '/mi-cuenta') {
  const r = await agente.get(ruta);
  const m = /name="_csrf" value="([^"]+)"/.exec(r.text);
  if (!m) throw new Error(`No hay token CSRF en ${ruta} (estado ${r.status})`);
  return m[1];
}

async function iniciarSesion(app, correo, contrasena = CONTRASENA) {
  const agente = request.agent(app);
  const csrf = await obtenerCsrf(agente, '/login');
  const r = await agente.post('/login').type('form').send({ _csrf: csrf, correo, contrasena });
  if (r.status !== 302 || r.headers.location !== '/') throw new Error(`No se pudo iniciar sesión como ${correo} (${r.status})`);
  return agente;
}

/** Crea plan, cliente, contrato y una mensualidad ficticios. */
async function crearCobroPrueba(db, { importe = 20000, sufijo = crypto.randomBytes(3).toString('hex') } = {}) {
  const ahora = new Date();
  const { insertedId: planId } = await db.col('planes').insertOne({ clave: `prueba-${sufijo}`, nombre: 'Plan prueba', precio: importe, activo: true, publicado: false, creado: ahora });
  const { insertedId: clienteId } = await db.col('clientes').insertOne({ nombre: 'Cliente Ficticio', telefono: '5500000001', colonia: 'Colonia Prueba', codigoPostal: '00101', activo: true, creado: ahora });
  const { insertedId: contratoId } = await db.col('contratos').insertOne({
    folio: `CTR-PRUEBA-${sufijo}`, clienteId, clienteNombre: 'Cliente Ficticio', planId, planClave: `prueba-${sufijo}`, planNombre: 'Plan prueba',
    tarifa: importe, estado: 'activo', fechaInicio: ahora, diaLimitePago: 28, creado: ahora,
  });
  const { insertedId: mensualidadId } = await db.col('mensualidades').insertOne({
    contratoId, contratoFolio: `CTR-PRUEBA-${sufijo}`, clienteId, clienteNombre: 'Cliente Ficticio', periodo: '2099-01',
    importe, pagado: 0, enValidacion: 0, estado: 'PENDIENTE', fechaLimite: new Date(Date.UTC(2099, 0, 28)), creado: ahora,
  });
  return { planId, clienteId, contratoId, mensualidadId };
}

module.exports = { preparar, obtenerCsrf, iniciarSesion, crearCobroPrueba, request, CONTRASENA };
