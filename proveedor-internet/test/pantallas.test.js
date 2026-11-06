'use strict';
// Recorre todas las pantallas y los flujos principales con los datos de demostración (sin errores 500).
const { it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const correr = (env) => new Promise((ok, mal) => execFile('node', ['scripts/seed.js'], { env }, (e, so, se) => { console.log(so, se); e ? mal(e) : ok(); }));
const { preparar, iniciarSesion, obtenerCsrf } = require('./ayuda');
let ctx;
before(async () => {
  ctx = await preparar();
  await correr({ ...process.env, DEMO_SEED_PASSWORD: ctx.contrasena });
  await correr({ ...process.env, DEMO_SEED_PASSWORD: ctx.contrasena });
});
after(async () => ctx.cerrar());

async function recorrer(ag, rutas) {
  for (const r of rutas) {
    const res = await ag.get(r);
    if (res.status >= 500 || res.status === 404) { console.log('FALLA', r, res.status, res.text.slice(0, 1500)); }
    assert.ok(res.status < 500 && res.status !== 404, `${r} -> ${res.status}`);
  }
}
const ids = async (c) => (await ctx.db.col(c).findOne({}))._id;

it('pantallas y flujos como administración', async () => {
  const ag = await iniciarSesion(ctx.app, 'admin@demo.mx');
  const base = ['/', '/mi-cuenta', '/solicitudes', '/solicitudes/nuevo', '/planes', '/planes/nuevo', '/promociones', '/promociones/nuevo', '/cobertura', '/cobertura/nuevo',
    '/clientes', '/clientes/nuevo', '/contratos', '/contratos/nuevo', '/equipos', '/equipos/nuevo', '/incidencias', '/incidencias/nueva', '/visitas', '/visitas/nueva',
    '/tecnicos', '/tecnicos/nuevo', '/cobranza', '/cobranza?vista=por-validar', '/cobranza?vista=todas', '/prioridad-de-cobranza', '/conciliacion-bancaria',
    '/mensajes-y-avisos', '/mensajes-y-avisos/nuevo', '/usuarios', '/usuarios/nuevo', '/auditoria', '/visitas?fecha=2026-01-01'];
  await recorrer(ag, base);
  const det = [];
  for (const [c, ruta, extra] of [['solicitudes', '/solicitudes', ['/editar']], ['planes', '/planes', ['/editar']], ['promociones', '/promociones', ['/editar']], ['cobertura', '/cobertura', ['/editar']],
    ['clientes', '/clientes', ['/editar']], ['contratos', '/contratos', ['/editar']], ['incidencias', '/incidencias', []], ['visitas', '/visitas', []], ['tecnicos', '/tecnicos', ['/editar']],
    ['mensualidades', '/cobranza', []], ['mensajes', '/mensajes-y-avisos', ['/editar']], ['usuarios', '/usuarios', ['/editar']]]) {
    const id = await ids(c); det.push(`${ruta}/${id}`); for (const e of extra) det.push(`${ruta}/${id}${e}`);
  }
  const cli = await ids('clientes');
  det.push(`/contratos/nuevo?cliente=${cli}`, `/clientes/nuevo?solicitud=${await ids('solicitudes')}`);
  await recorrer(ag, det);

  // Flujos con formulario
  let csrf = await obtenerCsrf(ag);
  let r = await ag.post('/clientes').type('form').send({ _csrf: csrf, nombre: 'Cliente Humo', telefono: '55 0000 0077', direccion: 'Calle Ficticia 1', colonia: 'Colonia Demo Norte', codigoPostal: '00101' });
  assert.equal(r.status, 302, r.text.slice(0, 500));
  const clienteId = r.headers.location.split('/').pop();
  const plan = await ctx.db.col('planes').findOne({ clave: 'plus' });
  r = await ag.post('/contratos').type('form').send({ _csrf: csrf, cliente: clienteId, planId: String(plan._id), fechaInicio: '2026-10-01', diaLimitePago: '10', direccionInstalacion: 'Calle Ficticia 1' });
  assert.equal(r.status, 302, r.text.slice(0, 800));
  const contratoUrl = r.headers.location;
  r = await ag.post(`${contratoUrl}/mensualidades`).type('form').send({ _csrf: csrf });
  assert.equal(r.status, 302);
  await recorrer(ag, [contratoUrl]);
  const contrato = await ctx.db.col('contratos').findOne({ clienteId: ctx.db.ObjectId.createFromHexString(clienteId) });
  assert.equal(contrato.tarifa, 30000);
  const m = await ctx.db.col('mensualidades').findOne({ contratoId: contrato._id });
  r = await ag.post(`/cobranza/${m._id}/pagos`).type('form').send({ _csrf: csrf, monto: '100.00', metodo: 'transferencia', referencia: 'humo-1' });
  assert.equal(r.status, 302);
  await recorrer(ag, [`/cobranza/${m._id}`, '/cobranza?vista=por-validar']);
  // precio cambia, contrato no
  r = await ag.post(`/planes/${plan._id}`).type('form').send({ _csrf: csrf, clave: 'plus', nombre: 'Plus', precio: '350.00', velocidadBajada: '', publicado: 'on' });
  assert.equal(r.status, 422);
  r = await ag.post(`/planes/${plan._id}`).type('form').send({ _csrf: csrf, clave: 'otra', nombre: 'Plus', precio: '350.00', velocidadBajada: '100' });
  assert.equal(r.status, 302);
  const plan2 = await ctx.db.col('planes').findOne({ _id: plan._id });
  assert.equal(plan2.clave, 'plus'); assert.equal(plan2.precio, 35000);
  assert.equal((await ctx.db.col('contratos').findOne({ _id: contrato._id })).tarifa, 30000);

  r = await ag.post('/incidencias').type('form').send({ _csrf: csrf, contratoFolio: contrato.folio.toLowerCase(), titulo: 'Lento', descripcion: 'Va lento', prioridad: 'media' });
  assert.equal(r.status, 302, r.text.slice(0, 500));
  const incUrl = r.headers.location;
  const inc = await ctx.db.col('incidencias').findOne({ contratoId: contrato._id });
  const tec = await ctx.db.col('tecnicos').findOne({});
  r = await ag.post('/visitas').type('form').send({ _csrf: csrf, incidenciaFolio: inc.folio, tecnicoId: String(tec._id), fecha: '2026-11-02', hora: '09:30' });
  assert.equal(r.status, 302, r.text.slice(0, 800));
  const visUrl = r.headers.location;
  await recorrer(ag, [visUrl, incUrl]);
  r = await ag.post(`${visUrl}/resultado`).type('form').send({ _csrf: csrf, resultado: 'resuelta', notas: 'Se cambió el conector' });
  assert.equal((await ctx.db.col('incidencias').findOne({ _id: inc._id })).estado, 'resuelta');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d605f20000000049454e44ae426082', 'hex');
  r = await ag.post(`${incUrl}/evidencias`).field('_csrf', csrf).attach('archivo', png, 'foto.png');
  assert.equal(r.status, 302);
  const ev = await ctx.db.col('evidencias').findOne({ incidenciaId: inc._id });
  assert.ok(ev, 'evidencia guardada');
  r = await ag.get(`${incUrl}/evidencias/${ev._id}`);
  assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/png');
  r = await ag.post(`${incUrl}/evidencias`).field('_csrf', csrf).attach('archivo', Buffer.from('<html>hola</html>'), 'foto.png');
  assert.equal(await ctx.db.col('evidencias').countDocuments({ incidenciaId: inc._id }), 1, 'archivo falso rechazado');
  r = await ag.post(`/clientes/${clienteId}/desactivar`).attach('archivo', png, 'x.png');
  assert.equal(r.status, 403, 'multipart fuera de ruta permitida');
  r = await ag.post('/conciliacion-bancaria/importar').field('_csrf', csrf).attach('archivo', Buffer.from('fecha,referencia,importe\n2026-10-02,HUMO-1,100.00\nx,y,z\n'), 'banco.csv');
  assert.equal(r.status, 302);
  await recorrer(ag, [r.headers.location, '/conciliacion-bancaria', '/conciliacion-bancaria?vista=coinciden', '/auditoria', '/prioridad-de-cobranza']);
  r = await ag.post('/usuarios').type('form').send({ _csrf: csrf, nombre: 'Nuevo Usuario', correo: 'nuevo@prueba.example', rol: 'tecnico', contrasena: 'corta' });
  assert.equal(r.status, 422);
  const pagina = await ag.get('/clientes?pagina=99&q=zz');
  assert.equal(pagina.status, 200);
});

it('pantallas del técnico sin datos de cobranza', async () => {
  const ag = await iniciarSesion(ctx.app, 'tecnico@demo.mx');
  await recorrer(ag, ['/', '/contratos', `/contratos/${await ids('contratos')}`, '/equipos', '/incidencias', `/incidencias/${await ids('incidencias')}`, '/visitas?mias=si', `/visitas/${await ids('visitas')}`, '/tecnicos', `/tecnicos/${await ids('tecnicos')}`, '/mi-cuenta']);
  const r = await ag.get(`/contratos/${await ids('contratos')}`);
  assert.doesNotMatch(r.text, /Mensualidades|Tarifa/);
});
