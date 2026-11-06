'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { preparar, iniciarSesion, obtenerCsrf, request } = require('./ayuda');

let ctx;
before(async () => { ctx = await preparar(); });
after(async () => { await ctx.cerrar(); });
beforeEach(async () => { await ctx.db.col('limites').deleteMany({}); });

const PRIVADAS = ['/', '/solicitudes', '/planes', '/promociones', '/cobertura', '/clientes', '/contratos', '/equipos', '/incidencias',
  '/visitas', '/tecnicos', '/cobranza', '/prioridad-de-cobranza', '/conciliacion-bancaria', '/mensajes-y-avisos', '/usuarios', '/auditoria', '/mi-cuenta'];

describe('Acceso sin sesión', () => {
  it('redirige a /login en todas las rutas privadas', async () => {
    for (const ruta of PRIVADAS) {
      const r = await request(ctx.app).get(ruta);
      assert.equal(r.status, 302, ruta);
      assert.equal(r.headers.location, '/login', ruta);
    }
  });

  it('una ruta inexistente sin sesión también redirige a /login', async () => {
    const r = await request(ctx.app).get('/no-existe');
    assert.equal(r.headers.location, '/login');
  });

  it('la API pública y /salud no piden sesión', async () => {
    assert.equal((await request(ctx.app).get('/api/v1/planes')).status, 200);
    assert.equal((await request(ctx.app).get('/salud')).status, 200);
  });

  it('el login muestra un único mensaje de error', async () => {
    const agente = request.agent(ctx.app);
    const csrf = await obtenerCsrf(agente, '/login');
    const r1 = await agente.post('/login').type('form').send({ _csrf: csrf, correo: 'admin@prueba.example', contrasena: 'incorrecta-123' });
    const r2 = await agente.post('/login').type('form').send({ _csrf: csrf, correo: 'nadie@prueba.example', contrasena: 'incorrecta-123' });
    assert.equal(r1.status, 401);
    assert.match(r1.text, /Correo o contraseña incorrectos/);
    assert.match(r2.text, /Correo o contraseña incorrectos/);
  });

  it('rechaza formularios sin token CSRF', async () => {
    const r = await request(ctx.app).post('/login').type('form').send({ correo: 'admin@prueba.example', contrasena: ctx.contrasena });
    assert.equal(r.status, 403);
  });
});

describe('Permisos por rol (aplicados en servidor)', () => {
  it('el técnico no ve cobranza, usuarios, auditoría, solicitudes ni clientes', async () => {
    const tecnico = await iniciarSesion(ctx.app, 'tecnico@prueba.example');
    for (const ruta of ['/cobranza', '/prioridad-de-cobranza', '/conciliacion-bancaria', '/usuarios', '/auditoria', '/solicitudes', '/clientes', '/planes', '/mensajes-y-avisos', '/cobranza?vista=por-validar']) {
      const r = await tecnico.get(ruta);
      assert.equal(r.status, 403, ruta);
      assert.match(r.text, /No tienes permiso para ver esto/);
    }
    for (const ruta of ['/', '/incidencias', '/visitas', '/tecnicos', '/contratos', '/equipos']) {
      assert.equal((await tecnico.get(ruta)).status, 200, ruta);
    }
  });

  it('el técnico solo lee contratos y equipos, y su tablero no muestra solicitudes ni cobranza', async () => {
    const tecnico = await iniciarSesion(ctx.app, 'tecnico@prueba.example');
    assert.equal((await tecnico.get('/contratos/nuevo')).status, 403);
    assert.equal((await tecnico.get('/equipos/nuevo')).status, 403);
    const csrf = await obtenerCsrf(tecnico, '/incidencias');
    const r = await tecnico.post('/equipos').type('form').send({ _csrf: csrf, tipo: 'router', marca: 'X', modelo: 'Y', numeroSerie: 'ABC123', estado: 'en almacén' });
    assert.equal(r.status, 403);
    const tablero = await tecnico.get('/');
    assert.match(tablero.text, /Incidencias abiertas/);
    assert.doesNotMatch(tablero.text, /Últimas 5 solicitudes|contador-texto">Solicitudes|contador-texto">Clientes/);
    assert.doesNotMatch(tablero.text, /href="\/cobranza"/);
  });

  it('el técnico no recibe tarifas en contratos', async () => {
    const ahora = new Date();
    await ctx.db.col('contratos').insertOne({ folio: 'CTR-T-1', clienteNombre: 'Cliente Ficticio', planNombre: 'Plan', tarifa: 12345, estado: 'activo', fechaInicio: ahora, creado: ahora, busqueda: 'ctr-t-1' });
    const tecnico = await iniciarSesion(ctx.app, 'tecnico@prueba.example');
    const r = await tecnico.get('/contratos');
    assert.match(r.text, /CTR-T-1/);
    assert.doesNotMatch(r.text, /\$123\.45/);
  });

  it('atención entra a cobranza pero no a usuarios ni auditoría', async () => {
    const atencion = await iniciarSesion(ctx.app, 'atencion@prueba.example');
    assert.equal((await atencion.get('/cobranza')).status, 200);
    assert.equal((await atencion.get('/solicitudes')).status, 200);
    assert.equal((await atencion.get('/usuarios')).status, 403);
    assert.equal((await atencion.get('/auditoria')).status, 403);
  });

  it('administración entra a usuarios y auditoría', async () => {
    const admin = await iniciarSesion(ctx.app, 'admin@prueba.example');
    assert.equal((await admin.get('/usuarios')).status, 200);
    assert.equal((await admin.get('/auditoria')).status, 200);
  });
});

describe('Cuentas y sesiones', () => {
  it('nadie puede desactivarse a sí mismo', async () => {
    const admin = await iniciarSesion(ctx.app, 'admin@prueba.example');
    const csrf = await obtenerCsrf(admin);
    await admin.post(`/usuarios/${ctx.usuarios.admin._id}/desactivar`).type('form').send({ _csrf: csrf });
    const u = await ctx.db.col('usuarios').findOne({ _id: ctx.usuarios.admin._id });
    assert.equal(u.activo, true);
  });

  it('un usuario desactivado no entra y pierde su sesión', async () => {
    const { cifrar } = require('../src/lib/contrasenas');
    const { insertedId } = await ctx.db.col('usuarios').insertOne({ nombre: 'Temporal', correo: 'temporal@prueba.example', rol: 'atencion', hash: await cifrar(ctx.contrasena), activo: true, versionSesion: 1 });
    const temporal = await iniciarSesion(ctx.app, 'temporal@prueba.example');
    const admin = await iniciarSesion(ctx.app, 'admin@prueba.example');
    const csrf = await obtenerCsrf(admin);
    await admin.post(`/usuarios/${insertedId}/desactivar`).type('form').send({ _csrf: csrf });
    assert.equal((await temporal.get('/')).headers.location, '/login');
    await assert.rejects(iniciarSesion(ctx.app, 'temporal@prueba.example'));
  });

  it('cambiar la contraseña cierra las demás sesiones de la cuenta', async () => {
    const { cifrar } = require('../src/lib/contrasenas');
    await ctx.db.col('usuarios').insertOne({ nombre: 'Doble', correo: 'doble@prueba.example', rol: 'atencion', hash: await cifrar(ctx.contrasena), activo: true, versionSesion: 1 });
    const a = await iniciarSesion(ctx.app, 'doble@prueba.example');
    const b = await iniciarSesion(ctx.app, 'doble@prueba.example');
    const csrf = await obtenerCsrf(a);
    const nueva = `${ctx.contrasena}-nueva`;
    const r = await a.post('/mi-cuenta').type('form').send({ _csrf: csrf, actual: ctx.contrasena, nueva, confirmacion: nueva });
    assert.equal(r.status, 302);
    assert.equal((await a.get('/')).status, 200, 'la sesión actual sigue');
    assert.equal((await b.get('/')).headers.location, '/login', 'la otra sesión se cerró');
  });

  it('el restablecimiento responde con un mensaje neutro', async () => {
    const agente = request.agent(ctx.app);
    const csrf = await obtenerCsrf(agente, '/restablecer');
    const r1 = await agente.post('/restablecer/solicitar').type('form').send({ _csrf: csrf, correo: 'admin@prueba.example' });
    const r2 = await agente.post('/restablecer/solicitar').type('form').send({ _csrf: csrf, correo: 'nadie@prueba.example' });
    const neutro = /Si el correo está registrado/;
    assert.match(r1.text, neutro);
    assert.match(r2.text, neutro);
  });
});

describe('Bloqueo por intentos fallidos', () => {
  it('bloquea tras 20 intentos fallidos desde la misma IP en 15 minutos', async () => {
    const agente = request.agent(ctx.app);
    const csrf = await obtenerCsrf(agente, '/login');
    for (let i = 0; i < 20; i++) {
      const r = await agente.post('/login').type('form').send({ _csrf: csrf, correo: 'atencion@prueba.example', contrasena: `mala-${i}-xxxx` });
      assert.equal(r.status, 401);
    }
    const bloqueado = await agente.post('/login').type('form').send({ _csrf: csrf, correo: 'atencion@prueba.example', contrasena: ctx.contrasena });
    assert.equal(bloqueado.status, 429);
    assert.match(bloqueado.text, /Espera 15 minutos/);
    const bitacora = await ctx.db.col('auditoria').countDocuments({ accion: 'acceso.bloqueo' });
    assert.ok(bitacora >= 1);
  });
});
