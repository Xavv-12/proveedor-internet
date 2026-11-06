'use strict';
// Datos de demostración. Se niega a correr con NODE_ENV=production.
require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('El script de demostración no se ejecuta con NODE_ENV=production.');
  process.exit(1);
}
const CONTRASENA = process.env.DEMO_SEED_PASSWORD || '';
if (CONTRASENA.length < 10) {
  console.error('Define DEMO_SEED_PASSWORD en tu .env (mínimo 10 caracteres).');
  process.exit(1);
}

const { obtenerConfig } = require('../src/config');
const { conectar, desconectar, col } = require('../src/db');
const { crearIndices } = require('../src/indices');
const { cifrar } = require('../src/lib/contrasenas');
const { siguienteFolio } = require('../src/lib/folios');
const { textoBusqueda, normalizar } = require('../src/lib/util');
const { partesMX, fechaMXaUTC } = require('../src/lib/fechas');
const { generarMensualidades } = require('../src/servicios/cobranza');

async function principal() {
  const cfg = obtenerConfig();
  await conectar(cfg.mongoUri, cfg.mongoDb);
  await crearIndices();
  const ahora = new Date();
  const hash = await cifrar(CONTRASENA);

  const cuentas = [
    { correo: 'admin@demo.mx', nombre: 'Administración Demo', rol: 'admin' },
    { correo: 'atencion@demo.mx', nombre: 'Atención Demo', rol: 'atencion' },
    { correo: 'tecnico@demo.mx', nombre: 'Técnico Demo', rol: 'tecnico' },
  ];
  for (const c of cuentas) {
    await col('usuarios').updateOne(
      { correo: c.correo },
      {
        $set: { nombre: c.nombre, rol: c.rol, hash, activo: true, busqueda: textoBusqueda(c.nombre, c.correo), actualizado: ahora },
        $inc: { versionSesion: 1 },
        $setOnInsert: { creado: ahora },
      },
      { upsert: true },
    );
  }
  console.log('Cuentas demo listas: admin@demo.mx, atencion@demo.mx, tecnico@demo.mx (contraseña: DEMO_SEED_PASSWORD).');

  // Planes iniciales como borradores ocultos: las velocidades no se inventan.
  const planes = [
    { clave: 'basico', nombre: 'Básico', precio: 20000 },
    { clave: 'plus', nombre: 'Plus', precio: 30000 },
    { clave: 'premium-1', nombre: 'Premium 1', precio: 40000 },
    { clave: 'premium-2', nombre: 'Premium 2', precio: 50000 },
    { clave: 'premium-3', nombre: 'Premium 3', precio: 60000 },
  ];
  for (const p of planes) {
    await col('planes').updateOne({ clave: p.clave }, {
      $setOnInsert: {
        ...p, velocidadBajada: null, velocidadSubida: null, descripcion: '', publicado: false, activo: true,
        busqueda: textoBusqueda(p.clave, p.nombre), creado: ahora, actualizado: ahora,
      },
    }, { upsert: true });
  }
  console.log('Planes iniciales listos (borradores ocultos hasta capturar velocidades).');

  if (await col('clientes').findOne({ demo: true })) {
    console.log('Los datos de demostración ya existían; no se duplicaron.');
    return;
  }

  // Zonas y personas ficticias (no son datos reales).
  const zonas = [
    { codigoPostal: '00101', colonia: 'Colonia Demo Norte', municipio: 'Municipio Demo', entidad: 'Estado Demo', disponible: true },
    { codigoPostal: '00102', colonia: 'Colonia Demo Sur', municipio: 'Municipio Demo', entidad: 'Estado Demo', disponible: true },
    { codigoPostal: '00103', colonia: 'Colonia Demo Oriente', municipio: 'Municipio Demo', entidad: 'Estado Demo', disponible: false },
  ];
  await col('cobertura').insertMany(zonas.map((z) => ({
    ...z, notas: '', activo: true, demo: true, coloniaNormal: normalizar(z.colonia),
    busqueda: textoBusqueda(z.codigoPostal, z.colonia, z.municipio, z.entidad), creado: ahora, actualizado: ahora,
  })));

  await col('promociones').insertOne({
    titulo: 'Instalación sin costo (demo)', descripcion: 'Promoción de ejemplo para pruebas.', planes: [], inicio: null, fin: null,
    publicada: false, activo: true, demo: true, busqueda: 'instalacion sin costo demo', creado: ahora, actualizado: ahora,
  });

  await col('mensajes').insertOne({
    nombre: 'Recordatorio de cobro (demo)', tipo: 'recordatorio_cobro',
    texto: 'Hola, {nombre}. Tu servicio (contrato {folio}) tiene un saldo vencido de {saldo}. Si ya pagaste, ignora este mensaje.',
    plantillaWhatsApp: '', idioma: 'es_MX', activo: true, demo: true, busqueda: 'recordatorio de cobro demo', creado: ahora, actualizado: ahora,
  });

  const tecnicoUsuario = await col('usuarios').findOne({ correo: 'tecnico@demo.mx' });
  const { insertedId: tecnicoId } = await col('tecnicos').insertOne({
    nombre: 'Técnico Demo', telefono: '5500000009', zona: 'Colonias Demo', correoUsuario: 'tecnico@demo.mx', usuarioId: tecnicoUsuario._id,
    activo: true, demo: true, busqueda: 'tecnico demo', creado: ahora, actualizado: ahora,
  });

  const personas = [
    { nombre: 'Cliente Demo Uno', telefono: '5500000001', colonia: 'Colonia Demo Norte', codigoPostal: '00101', plan: 'basico' },
    { nombre: 'Cliente Demo Dos', telefono: '5500000002', colonia: 'Colonia Demo Sur', codigoPostal: '00102', plan: 'plus' },
    { nombre: 'Cliente Demo Tres', telefono: '5500000003', colonia: 'Colonia Demo Norte', codigoPostal: '00101', plan: 'premium-1' },
  ];
  const hoy = partesMX();
  const contratos = [];
  for (const [i, p] of personas.entries()) {
    const direccion = `Calle Ficticia ${100 + i}`;
    const { insertedId: clienteId } = await col('clientes').insertOne({
      nombre: p.nombre, telefono: p.telefono, correo: '', direccion, colonia: p.colonia, codigoPostal: p.codigoPostal,
      referencias: 'Datos de demostración', notas: '', activo: true, demo: true,
      busqueda: textoBusqueda(p.nombre, p.telefono, p.colonia, p.codigoPostal), creado: ahora, actualizado: ahora,
    });
    const plan = await col('planes').findOne({ clave: p.plan });
    const folio = await siguienteFolio('CTR');
    const inicioMes = hoy.month === 1 ? { a: hoy.year - 1, m: 12 } : { a: hoy.year, m: hoy.month - 1 };
    const { insertedId: contratoId } = await col('contratos').insertOne({
      folio, clienteId, clienteNombre: p.nombre, colonia: p.colonia, codigoPostal: p.codigoPostal,
      planId: plan._id, planClave: plan.clave, planNombre: plan.nombre, tarifa: plan.precio, estado: 'activo',
      fechaInicio: fechaMXaUTC(inicioMes.a, inicioMes.m, 1), diaLimitePago: 10,
      direccionInstalacion: `${direccion}, ${p.colonia}, CP ${p.codigoPostal}`, notas: '',
      historialPlanes: [{ fecha: ahora, planClave: plan.clave, planNombre: plan.nombre, tarifa: plan.precio, usuarioId: null }],
      demo: true, busqueda: textoBusqueda(folio, p.nombre, p.telefono, p.colonia, plan.nombre), creado: ahora, actualizado: ahora,
    });
    await generarMensualidades(contratoId);
    contratos.push({ contratoId, folio, cliente: p.nombre, direccion, plan, inicioMes });
  }

  // Una mensualidad del mes anterior vencida, para ver la prioridad de cobranza.
  const c0 = contratos[0];
  const periodo = `${c0.inicioMes.a}-${String(c0.inicioMes.m).padStart(2, '0')}`;
  await col('mensualidades').updateOne({ contratoId: c0.contratoId, periodo }, {
    $setOnInsert: {
      contratoId: c0.contratoId, contratoFolio: c0.folio, clienteNombre: c0.cliente, periodo, importe: c0.plan.precio,
      pagado: 0, enValidacion: 0, estado: 'VENCIDA', fechaLimite: fechaMXaUTC(c0.inicioMes.a, c0.inicioMes.m, 10, 23, 59, 59),
      busqueda: textoBusqueda(c0.folio, c0.cliente, periodo), creado: ahora, actualizado: ahora,
    },
  }, { upsert: true });

  const folioInc = await siguienteFolio('INC');
  const { insertedId: incId } = await col('incidencias').insertOne({
    folio: folioInc, contratoId: contratos[1].contratoId, contratoFolio: contratos[1].folio, clienteNombre: contratos[1].cliente,
    direccion: contratos[1].direccion, titulo: 'Sin conexión desde la mañana', descripcion: 'Incidencia de demostración.',
    prioridad: 'alta', estado: 'abierta', creada: ahora, actualizada: ahora, demo: true,
    busqueda: textoBusqueda(folioInc, 'Sin conexión desde la mañana', contratos[1].folio, contratos[1].cliente),
  });
  await col('incidencias_historial').insertOne({
    incidenciaId: incId, fecha: ahora, tipo: 'alta', texto: 'Incidencia registrada.', de: null, a: 'abierta', usuarioId: null, usuarioNombre: 'Sistema',
  });
  await col('visitas').insertOne({
    incidenciaId: incId, incidenciaFolio: folioInc, contratoId: contratos[1].contratoId, contratoFolio: contratos[1].folio,
    clienteNombre: contratos[1].cliente, direccion: contratos[1].direccion, tecnicoId, tecnicoNombre: 'Técnico Demo',
    fecha: fechaMXaUTC(hoy.year, hoy.month, hoy.day, 16, 0), estado: 'programada', notas: 'Visita de demostración.',
    creada: ahora, demo: true, busqueda: textoBusqueda(folioInc, contratos[1].cliente, 'Técnico Demo'),
  });

  const folioSol = await siguienteFolio('SOL');
  await col('solicitudes').insertOne({
    folio: folioSol, estado: 'recibida', origen: 'web', nombre: 'Prospecto Demo', telefono: '5500000004', correo: '',
    codigoPostal: '00102', colonia: 'Colonia Demo Sur', direccion: '', planClave: 'plus', comentarios: 'Solicitud de demostración.',
    demo: true, busqueda: textoBusqueda(folioSol, 'Prospecto Demo', '5500000004', 'Colonia Demo Sur', '00102'), creado: ahora, actualizado: ahora,
  });
  console.log('Datos de demostración creados.');
}

principal()
  .catch((e) => { console.error('Error en seed:', e.message); process.exitCode = 1; })
  .finally(() => desconectar());
