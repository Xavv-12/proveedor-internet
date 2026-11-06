'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { preparar, request } = require('./ayuda');

const ORIGEN = 'https://sitio.prueba.example';
const LIMITE = 'Ya recibimos varias solicitudes desde tu conexión. Escríbenos por WhatsApp.';
let ctx;
before(async () => {
  ctx = await preparar();
  const ahora = new Date();
  await ctx.db.col('planes').insertMany([
    { clave: 'basico', nombre: 'Básico', precio: 20000, velocidadBajada: null, publicado: false, activo: true, creado: ahora },
    { clave: 'publicado-1', nombre: 'Publicado', precio: 30000, velocidadBajada: 50, publicado: true, activo: true, creado: ahora },
  ]);
  await ctx.db.col('cobertura').insertOne({ codigoPostal: '00101', colonia: 'Colonia Prueba', coloniaNormal: 'colonia prueba', municipio: 'M', entidad: 'E', disponible: true, activo: true, notas: 'interna' });
});
after(async () => { await ctx.cerrar(); });
beforeEach(async () => { await ctx.db.col('limites').deleteMany({}); });

const solicitud = (extra = {}) => ({ nombre: 'Persona Ficticia', telefono: '+52 55-0000-0001', codigoPostal: '00101', colonia: 'Colonia Prueba', ...extra });

function formaDeError(r) {
  assert.equal(r.headers['content-type'].startsWith('application/json'), true);
  assert.deepEqual(Object.keys(r.body).sort(), ['error', 'success']);
  assert.equal(r.body.success, false);
  assert.equal(typeof r.body.error, 'string');
}

describe('CORS', () => {
  it('responde al preflight del sitio permitido sin credenciales', async () => {
    const r = await request(ctx.app).options('/api/v1/solicitudes').set('Origin', ORIGEN).set('Access-Control-Request-Method', 'POST');
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-origin'], ORIGEN);
    assert.equal(r.headers['access-control-allow-credentials'], undefined);
    assert.equal(r.headers['set-cookie'], undefined);
  });

  it('rechaza otros orígenes con la forma de error', async () => {
    const r = await request(ctx.app).get('/api/v1/planes').set('Origin', 'https://otro.example');
    assert.equal(r.status, 403);
    formaDeError(r);
  });
});

describe('Planes, promociones y cobertura', () => {
  it('solo devuelve planes publicados y sin datos internos', async () => {
    const r = await request(ctx.app).get('/api/v1/planes').set('Origin', ORIGEN);
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.deepEqual(r.body.data.map((p) => p.clave), ['publicado-1']);
    assert.equal(r.body.data[0].precio, '$300.00');
    assert.equal(r.body.data[0]._id, undefined);
  });

  it('cobertura por código postal sin notas internas', async () => {
    const r = await request(ctx.app).get('/api/v1/cobertura?cp=00101');
    assert.equal(r.body.data.disponible, true);
    assert.equal(r.body.data.zonas[0].notas, undefined);
  });

  it('cobertura limita a 60 consultas por IP cada 10 minutos', async () => {
    for (let i = 0; i < 60; i++) assert.equal((await request(ctx.app).get('/api/v1/cobertura?cp=00101')).status, 200);
    const r = await request(ctx.app).get('/api/v1/cobertura?cp=00101');
    assert.equal(r.status, 429);
    formaDeError(r);
    assert.equal(r.body.error, LIMITE);
  });

  it('errores de validación y rutas inexistentes con la misma forma', async () => {
    formaDeError(await request(ctx.app).get('/api/v1/cobertura?cp=12'));
    formaDeError(await request(ctx.app).get('/api/v1/no-existe'));
  });
});

describe('Solicitudes', () => {
  it('normaliza el teléfono y devuelve el folio', async () => {
    const r = await request(ctx.app).post('/api/v1/solicitudes').set('Origin', ORIGEN).send(solicitud());
    assert.equal(r.status, 201);
    assert.match(r.body.data.folio, /^SOL-\d{4}-\d{5}$/);
    const s = await ctx.db.col('solicitudes').findOne({ folio: r.body.data.folio });
    assert.equal(s.telefono, '5500000001');
    assert.equal(s.estado, 'recibida');
  });

  it('teléfono inválido y JSON roto responden 400 con la forma de error', async () => {
    const r1 = await request(ctx.app).post('/api/v1/solicitudes').send(solicitud({ telefono: '12345' }));
    assert.equal(r1.status, 400);
    formaDeError(r1);
    const r2 = await request(ctx.app).post('/api/v1/solicitudes').set('Content-Type', 'application/json').send('{"nombre":');
    assert.equal(r2.status, 400);
    formaDeError(r2);
  });

  it('rechaza cuerpos demasiado grandes', async () => {
    const r = await request(ctx.app).post('/api/v1/solicitudes').send(solicitud({ comentarios: 'x'.repeat(20000) }));
    assert.equal(r.status, 413);
    formaDeError(r);
  });

  it('acepta 5 solicitudes válidas por hora y la sexta recibe 429', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await request(ctx.app).post('/api/v1/solicitudes').send(solicitud())).status, 201);
    const r = await request(ctx.app).post('/api/v1/solicitudes').send(solicitud());
    assert.equal(r.status, 429);
    assert.equal(r.body.error, LIMITE);
  });

  it('acepta 20 intentos por hora y el 21 recibe 429', async () => {
    for (let i = 0; i < 20; i++) assert.equal((await request(ctx.app).post('/api/v1/solicitudes').send({})).status, 400);
    const r = await request(ctx.app).post('/api/v1/solicitudes').send(solicitud());
    assert.equal(r.status, 429);
    formaDeError(r);
  });
});

describe('Salud', () => {
  it('reporta el estado sin datos sensibles', async () => {
    const r = await request(ctx.app).get('/salud');
    assert.equal(r.body.estado, 'ok');
    assert.equal(r.body.mongodb, 'ok');
    assert.doesNotMatch(JSON.stringify(r.body), /mongodb:\/\//);
  });
});
