'use strict';
const { MongoClient, ObjectId } = require('mongodb');

let cliente = null;
let base = null;

async function conectar(uri, nombreDb) {
  cliente = new MongoClient(uri, { maxPoolSize: 30, serverSelectionTimeoutMS: 10000, appName: 'proveedor-internet' });
  await cliente.connect();
  base = cliente.db(nombreDb);
  return base;
}

function db() {
  if (!base) throw new Error('La base de datos no está conectada.');
  return base;
}

function col(nombre) {
  return db().collection(nombre);
}

function clienteMongo() {
  return cliente;
}

async function desconectar() {
  if (cliente) await cliente.close();
  cliente = null;
  base = null;
}

/** Ejecuta fn dentro de una transacción con reintentos automáticos ante conflictos. */
async function enTransaccion(fn) {
  const sesion = cliente.startSession();
  try {
    let resultado;
    await sesion.withTransaction(async () => {
      resultado = await fn(sesion);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    return resultado;
  } finally {
    await sesion.endSession();
  }
}

/** Convierte un texto en ObjectId solo si es un id válido de 24 caracteres hexadecimales. */
function aId(valor) {
  return typeof valor === 'string' && /^[0-9a-f]{24}$/i.test(valor) ? new ObjectId(valor) : null;
}

module.exports = { conectar, db, col, clienteMongo, desconectar, enTransaccion, aId, ObjectId };
