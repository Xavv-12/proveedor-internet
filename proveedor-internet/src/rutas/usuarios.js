'use strict';
const express = require('express');
const E = require('../lib/esquemas');
const { col, aId } = require('../db');
const { permitir } = require('../middleware/sesion');
const {
  envolver, filtroBusqueda, paginacion, navegacion, erroresZod, avisar, textoBusqueda, normalizar, escaparRegex,
} = require('../lib/util');
const { auditarReq, diferencias } = require('../lib/auditoria');
const { cifrar } = require('../lib/contrasenas');
const { formatearFechaHora, formatearUTC } = require('../lib/fechas');
const {
  renderLista, renderDetalle, renderFormulario, llenar, insignia, opciones, filtroSelect,
} = require('../lib/vistas');
const { ROLES, NOMBRES_ROL } = require('../permisos');

/* ===================== Usuarios ===================== */
const rUsuarios = express.Router();
rUsuarios.use(permitir('usuarios', 'escribir'));

const opcionesRol = opciones(ROLES.map((r) => ({ valor: r, texto: NOMBRES_ROL[r] })));
const campos = (nuevo) => [
  { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true },
  { nombre: 'correo', etiqueta: 'Correo', tipo: 'email', requerido: true, autocomplete: 'off' },
  { nombre: 'rol', etiqueta: 'Rol', tipo: 'select', requerido: true, opciones: opcionesRol },
  {
    nombre: 'contrasena', etiqueta: nuevo ? 'Contraseña inicial' : 'Nueva contraseña', tipo: 'password', requerido: nuevo, autocomplete: 'new-password',
    ayuda: nuevo ? 'Mínimo 10 caracteres. Compártela por un medio seguro.' : 'Déjala vacía para no cambiarla. Si la cambias, se cierran sus sesiones.',
  },
];
const esquema = (nuevo) => E.z.object({
  nombre: E.texto(3, 120, 'El nombre'),
  correo: E.correo(),
  rol: E.opcion(ROLES, 'rol'),
  contrasena: nuevo
    ? E.contrasenaNueva()
    : E.cadena((s) => s.refine((v) => !v || (v.length >= 10 && v.length <= 128), 'La contraseña debe tener de 10 a 128 caracteres.'), (v) => String(v ?? '')),
});
const sinContrasena = (body) => ({ ...body, contrasena: '' });

function formulario(res, { doc = null, valores = {}, errores = {}, estado = 200 }) {
  renderFormulario(res, {
    titulo: doc ? `Editar ${doc.nombre}` : 'Nuevo usuario',
    accion: doc ? `/usuarios/${doc._id}` : '/usuarios',
    cancelar: doc ? `/usuarios/${doc._id}` : '/usuarios',
    boton: doc ? 'Guardar cambios' : 'Crear usuario',
    campos: llenar(campos(!doc), valores),
    errores,
  }, estado);
}

rUsuarios.get('/', envolver(async (req, res) => {
  const q = String(req.query.q ?? '').slice(0, 80);
  const e = ['activos', 'inactivos', 'todos'].includes(req.query.activos) ? req.query.activos : 'activos';
  const filtro = { ...filtroBusqueda(q) };
  if (e !== 'todos') filtro.activo = e === 'activos';
  const { pagina, salto, limite } = paginacion(req);
  const [docs, total] = await Promise.all([
    col('usuarios').find(filtro, { projection: { hash: 0 } }).sort({ nombre: 1 }).skip(salto).limit(limite).toArray(),
    col('usuarios').countDocuments(filtro),
  ]);
  renderLista(res, {
    titulo: 'Usuarios',
    accionBusqueda: '/usuarios',
    q,
    filtros: [filtroSelect('activos', 'Mostrar', e, [{ valor: 'activos', texto: 'Activos' }, { valor: 'inactivos', texto: 'Inactivos' }, { valor: 'todos', texto: 'Todos' }])],
    enlaceNuevo: '/usuarios/nuevo',
    textoNuevo: 'Nuevo usuario',
    filas: docs.map((u) => ({
      enlace: `/usuarios/${u._id}`,
      titulo: u.nombre,
      subtitulo: u.correo,
      insignia: u.activo ? insignia(NOMBRES_ROL[u.rol], 'azul') : insignia('Desactivado', 'gris'),
      campos: [{ etiqueta: 'Último acceso', valor: formatearFechaHora(u.ultimoAcceso) }],
    })),
    nav: navegacion(req, total, pagina),
  });
}));

rUsuarios.get('/nuevo', (req, res) => formulario(res, { valores: { rol: 'atencion' } }));

rUsuarios.post('/', envolver(async (req, res) => {
  const v = esquema(true).safeParse(req.body);
  if (!v.success) return formulario(res, { valores: sinContrasena(req.body), errores: erroresZod(v.error), estado: 422 });
  const d = v.data;
  const ahora = new Date();
  const doc = {
    nombre: d.nombre, correo: d.correo, rol: d.rol, hash: await cifrar(d.contrasena), activo: true, versionSesion: 1,
    busqueda: textoBusqueda(d.nombre, d.correo), creado: ahora, actualizado: ahora, creadoPor: req.usuario._id,
  };
  try {
    await col('usuarios').insertOne(doc);
  } catch (e) {
    if (e.code === 11000) return formulario(res, { valores: sinContrasena(req.body), errores: { correo: 'Ya existe un usuario con ese correo.' }, estado: 409 });
    throw e;
  }
  await auditarReq(req, 'usuario.alta', { usuario: d.correo, rol: d.rol });
  avisar(req, 'Usuario creado.');
  return res.redirect(`/usuarios/${doc._id}`);
}));

async function buscarUsuario(req, next) {
  const id = aId(req.params.id);
  const u = id ? await col('usuarios').findOne({ _id: id }, { projection: { hash: 0 } }) : null;
  if (!u) next();
  return u;
}

rUsuarios.get('/:id', envolver(async (req, res, next) => {
  const u = await buscarUsuario(req, next);
  if (!u) return;
  const esYo = String(u._id) === String(req.usuario._id);
  const botones = [{ texto: 'Editar', enlace: `/usuarios/${u._id}/editar`, estilo: 'secundario' }];
  if (!esYo) {
    botones.push(u.activo
      ? { texto: 'Desactivar', accion: `/usuarios/${u._id}/desactivar`, estilo: 'peligro', confirmar: '¿Desactivar este usuario? Se cerrarán sus sesiones.' }
      : { texto: 'Reactivar', accion: `/usuarios/${u._id}/reactivar`, estilo: 'secundario' });
  }
  renderDetalle(res, {
    titulo: u.nombre,
    subtitulo: u.correo,
    volver: '/usuarios',
    bloques: [
      {
        tipo: 'datos',
        insignia: u.activo ? insignia('Activo', 'verde') : insignia('Desactivado', 'gris'),
        filas: [
          { etiqueta: 'Rol', valor: NOMBRES_ROL[u.rol] },
          { etiqueta: 'Último acceso', valor: formatearFechaHora(u.ultimoAcceso) },
          { etiqueta: 'Alta', valor: formatearFechaHora(u.creado) },
        ],
        nota: esYo ? 'Es tu cuenta: no puedes desactivarla ni cambiar tu propio rol.' : null,
      },
      { tipo: 'botones', botones },
    ],
  });
}));

rUsuarios.get('/:id/editar', envolver(async (req, res, next) => {
  const u = await buscarUsuario(req, next);
  if (!u) return;
  formulario(res, { doc: u, valores: { nombre: u.nombre, correo: u.correo, rol: u.rol } });
}));

rUsuarios.post('/:id', envolver(async (req, res, next) => {
  const u = await buscarUsuario(req, next);
  if (!u) return;
  const v = esquema(false).safeParse(req.body);
  if (!v.success) return formulario(res, { doc: u, valores: sinContrasena(req.body), errores: erroresZod(v.error), estado: 422 });
  const d = v.data;
  const esYo = String(u._id) === String(req.usuario._id);
  if (esYo && d.rol !== u.rol) return formulario(res, { doc: u, valores: sinContrasena(req.body), errores: { rol: 'No puedes cambiar tu propio rol.' }, estado: 422 });
  const cambios = { nombre: d.nombre, correo: d.correo, rol: d.rol, busqueda: textoBusqueda(d.nombre, d.correo), actualizado: new Date(), actualizadoPor: req.usuario._id };
  const actualizacion = { $set: cambios };
  if (d.contrasena) {
    cambios.hash = await cifrar(d.contrasena);
    actualizacion.$inc = { versionSesion: 1 }; // cierra sus sesiones abiertas
  }
  try {
    await col('usuarios').updateOne({ _id: u._id }, actualizacion);
  } catch (e) {
    if (e.code === 11000) return formulario(res, { doc: u, valores: sinContrasena(req.body), errores: { correo: 'Ya existe un usuario con ese correo.' }, estado: 409 });
    throw e;
  }
  if (esYo && d.contrasena) req.session.versionSesion = (u.versionSesion || 0) + 1;
  const dif = diferencias(u, cambios, ['nombre', 'correo', 'rol']);
  if (Object.keys(dif).length || d.contrasena) {
    await auditarReq(req, 'usuario.cambio', { usuario: u.correo, cambios: dif, contrasenaRestablecida: Boolean(d.contrasena) });
  }
  avisar(req, 'Cambios guardados.');
  return res.redirect(`/usuarios/${u._id}`);
}));

for (const [accion, activo] of [['desactivar', false], ['reactivar', true]]) {
  rUsuarios.post(`/:id/${accion}`, envolver(async (req, res, next) => {
    const u = await buscarUsuario(req, next);
    if (!u) return;
    if (String(u._id) === String(req.usuario._id)) {
      avisar(req, 'No puedes desactivar tu propia cuenta.', 'error');
      return res.redirect(`/usuarios/${u._id}`);
    }
    const rr = await col('usuarios').updateOne(
      { _id: u._id, activo: !activo },
      { $set: { activo, actualizado: new Date(), actualizadoPor: req.usuario._id }, $inc: { versionSesion: 1 } },
    );
    if (rr.modifiedCount) await auditarReq(req, activo ? 'usuario.reactivacion' : 'usuario.desactivacion', { usuario: u.correo });
    avisar(req, activo ? 'Usuario reactivado.' : 'Usuario desactivado. Sus sesiones se cerraron.');
    return res.redirect(`/usuarios/${u._id}`);
  }));
}

/* ===================== Auditoría (solo lectura, solo admin) ===================== */
const rAuditoria = express.Router();

rAuditoria.get('/', permitir('auditoria', 'leer'), envolver(async (req, res) => {
  const q = normalizar(req.query.q).slice(0, 80);
  const filtro = q ? { $or: [{ accion: { $regex: escaparRegex(q) } }, { usuarioCorreo: { $regex: escaparRegex(q) } }] } : {};
  const { pagina, salto, limite } = paginacion(req);
  const [docs, total] = await Promise.all([
    col('auditoria').find(filtro).sort({ fecha: -1 }).skip(salto).limit(limite).toArray(),
    col('auditoria').countDocuments(filtro),
  ]);
  renderLista(res, {
    titulo: 'Auditoría',
    accionBusqueda: '/auditoria',
    q: String(req.query.q ?? ''),
    filas: docs.map((a) => ({
      titulo: a.accion,
      subtitulo: `${a.usuarioCorreo || 'Sistema o sitio web'} · ${formatearUTC(a.fecha)}`,
      campos: [
        { etiqueta: 'Hora local', valor: formatearFechaHora(a.fecha) },
        ...(a.ip ? [{ etiqueta: 'IP', valor: a.ip }] : []),
        ...(a.detalle && Object.keys(a.detalle).length ? [{ etiqueta: 'Detalle', valor: JSON.stringify(a.detalle).slice(0, 400), mono: true }] : []),
      ],
    })),
    nav: navegacion(req, total, pagina),
    vacio: 'Sin registros.',
  });
}));

module.exports = { rUsuarios, rAuditoria };
