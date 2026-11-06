'use strict';

class ErrorValidacion extends Error {
  constructor(errores, mensaje = 'Revisa los datos marcados.') {
    super(mensaje);
    this.name = 'ErrorValidacion';
    this.errores = errores || {};
  }
}

class ErrorNegocio extends Error {
  constructor(mensaje, estado = 409) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.estado = estado;
  }
}

const envolver = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textoBusqueda(...partes) {
  return normalizar(partes.filter((p) => p !== null && p !== undefined && p !== '').join(' '));
}

function filtroBusqueda(q) {
  const n = normalizar(q).slice(0, 80);
  return n ? { busqueda: { $regex: escaparRegex(n) } } : {};
}

function erroresZod(error) {
  const r = {};
  for (const i of error.issues) {
    const k = i.path[0] ?? 'general';
    if (!r[k]) r[k] = i.message;
  }
  return r;
}

const POR_PAGINA = 20;

function paginacion(req) {
  const p = Math.max(1, Math.min(100000, parseInt(req.query.pagina, 10) || 1));
  return { pagina: p, salto: (p - 1) * POR_PAGINA, limite: POR_PAGINA };
}

function navegacion(req, total, pagina) {
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const ruta = req.originalUrl.split('?')[0];
  const url = (n) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'pagina' && typeof v === 'string' && v) sp.set(k, v);
    }
    if (n > 1) sp.set('pagina', String(n));
    const s = sp.toString();
    return s ? `${ruta}?${s}` : ruta;
  };
  return {
    pagina,
    totalPaginas,
    total,
    anterior: pagina > 1 ? url(pagina - 1) : null,
    siguiente: pagina < totalPaginas ? url(pagina + 1) : null,
  };
}

function avisar(req, texto, tipo = 'exito') {
  req.session.aviso = { tipo, texto };
}

/** Solo acepta rutas internas relativas (evita redirecciones abiertas). */
function rutaInterna(valor, porDefecto) {
  return typeof valor === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(valor) ? valor : porDefecto;
}

function capital(t) {
  const s = String(t ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = {
  ErrorValidacion,
  ErrorNegocio,
  envolver,
  normalizar,
  escaparRegex,
  textoBusqueda,
  filtroBusqueda,
  erroresZod,
  paginacion,
  navegacion,
  avisar,
  rutaInterna,
  capital,
  POR_PAGINA,
};
