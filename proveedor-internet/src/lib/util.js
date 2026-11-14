"use strict";

class ErrorValidacion extends Error {
  constructor(errores, mensaje = "Revisa los datos marcados.") {
    super(mensaje);
    this.name = "ErrorValidacion";
    this.errores = errores || {};
  }
}

class ErrorNegocio extends Error {
  constructor(mensaje, estado = 409) {
    super(mensaje);
    this.name = "ErrorNegocio";
    this.estado = estado;
  }
}

const envolver = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textoBusqueda(...partes) {
  return normalizar(
    partes.filter((p) => p !== null && p !== undefined && p !== "").join(" "),
  );
}

function filtroBusqueda(q) {
  const n = normalizar(q).slice(0, 80);
  return n ? { busqueda: { $regex: escaparRegex(n) } } : {};
}

function erroresZod(error) {
  const r = {};
  for (const i of error.issues) {
    const k = i.path[0] ?? "general";
    if (!r[k]) r[k] = i.message;
  }
  return r;
}

const POR_PAGINA = 20;

function paginacion(req) {
  const p = Math.max(1, Math.min(100000, parseInt(req.query.pagina, 10) || 1));
  return { pagina: p, salto: (p - 1) * POR_PAGINA, limite: POR_PAGINA };
}

/** Páginas a mostrar: la primera, la última y las 2 de cada lado de la actual. null = «…». */
function ventanaPaginas(actual, total) {
  const conjunto = new Set([1, total]);
  for (let i = actual - 2; i <= actual + 2; i += 1)
    if (i >= 1 && i <= total) conjunto.add(i);
  const orden = [...conjunto].sort((a, b) => a - b);
  const r = [];
  orden.forEach((n, i) => {
    if (i > 0) {
      const anterior = orden[i - 1];
      if (n - anterior === 2)
        r.push(anterior + 1); // si falta una sola página, se muestra en vez de «…»
      else if (n - anterior > 2) r.push(null);
    }
    r.push(n);
  });
  return r;
}

function navegacion(req, total, pagina) {
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const ruta = req.originalUrl.split("?")[0];
  const url = (n) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== "pagina" && typeof v === "string" && v) sp.set(k, v);
    }
    if (n > 1) sp.set("pagina", String(n));
    const s = sp.toString();
    return s ? `${ruta}?${s}` : ruta;
  };
  return {
    pagina,
    totalPaginas,
    total,
    anterior: pagina > 1 ? url(Math.min(pagina - 1, totalPaginas)) : null,
    siguiente: pagina < totalPaginas ? url(pagina + 1) : null,
    // Para la barra de páginas numeradas y el cuadro «Ir a la página»:
    ruta,
    params: Object.entries(req.query).filter(
      ([k, v]) => k !== "pagina" && typeof v === "string" && v,
    ),
    desde: total && pagina <= totalPaginas ? (pagina - 1) * POR_PAGINA + 1 : 0,
    hasta: pagina <= totalPaginas ? Math.min(pagina * POR_PAGINA, total) : 0,
    paginas: ventanaPaginas(pagina, totalPaginas).map((n) =>
      n === null
        ? { puntos: true }
        : {
            n,
            url: url(n),
            actual: n === pagina,
            lejos: n !== 1 && n !== totalPaginas && Math.abs(n - pagina) > 1,
          },
    ),
  };
}

function avisar(req, texto, tipo = "exito") {
  req.session.aviso = { tipo, texto };
}

/** Solo acepta rutas internas relativas (evita redirecciones abiertas). */
function rutaInterna(valor, porDefecto) {
  return typeof valor === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(valor)
    ? valor
    : porDefecto;
}

function capital(t) {
  const s = String(t ?? "");
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
