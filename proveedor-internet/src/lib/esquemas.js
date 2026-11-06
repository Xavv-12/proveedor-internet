'use strict';
// Validación en servidor con Zod. Todos los mensajes en español.
const { z } = require('zod');
const { aCentavos } = require('./dinero');
const { normalizarTelefono } = require('./telefono');
const { textoAFechaMX } = require('./fechas');

const limpio = (v) => String(Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
const cadena = (fn, transformar = limpio) => z.preprocess(transformar, fn(z.string()));

const texto = (min, max, etq) => cadena((s) => s
  .min(Math.max(1, min), min <= 1 ? `${etq} es obligatorio.` : `${etq} debe tener al menos ${min} caracteres.`)
  .max(max, `${etq} admite máximo ${max} caracteres.`));

const textoOpcional = (max, etq = 'Este campo') => cadena((s) => s.max(max, `${etq} admite máximo ${max} caracteres.`));

const correo = (etq = 'El correo') => cadena(
  (s) => s.min(1, `${etq} es obligatorio.`).max(200, 'El correo es demasiado largo.').email('Escribe un correo válido.'),
  (v) => limpio(v).toLowerCase(),
);

const correoOpcional = () => cadena(
  (s) => s.max(200, 'El correo es demasiado largo.').refine((v) => !v || z.string().email().safeParse(v).success, 'Escribe un correo válido.'),
  (v) => limpio(v).toLowerCase(),
);

const telefono = () => cadena(
  (s) => s.regex(/^\d{10}$/, 'El teléfono debe tener 10 dígitos.'),
  (v) => normalizarTelefono(limpio(v)) ?? limpio(v),
);

const codigoPostal = () => cadena((s) => s.regex(/^\d{5}$/, 'El código postal debe tener 5 dígitos.'));

const dinero = (etq = 'El monto') => z.preprocess(
  (v) => { const s = limpio(v); return s ? aCentavos(s) : undefined; },
  z.number({ error: (i) => (i.input === undefined ? `${etq} es obligatorio.` : `${etq} no es válido. Usa un formato como 200.00`) })
    .int().positive(`${etq} debe ser mayor que cero.`).max(10_000_000_00, `${etq} es demasiado alto.`),
);

const casilla = () => z.preprocess((v) => {
  const x = Array.isArray(v) ? v[v.length - 1] : v;
  return x === 'on' || x === '1' || x === 'true' || x === true;
}, z.boolean());

const entero = (min, max, etq, opcional = false) => {
  const n = z.number({ error: (i) => (i.input === undefined ? `${etq} es obligatorio.` : `${etq} debe ser un número entero.`) })
    .int(`${etq} debe ser un número entero.`).min(min, `${etq} debe ser al menos ${min}.`).max(max, `${etq} debe ser máximo ${max}.`);
  return z.preprocess((v) => {
    const s = limpio(v);
    if (!s) return opcional ? null : undefined;
    return /^\d+$/.test(s) ? Number(s) : NaN;
  }, opcional ? n.nullable() : n);
};

const opcion = (valores, etq) => cadena((s) => s.refine((v) => valores.includes(v), `Elige una opción válida en ${etq}.`));

const fecha = (etq, opcional = false) => cadena((s) => s.refine(
  (v) => (opcional && !v) || textoAFechaMX(v) !== null,
  opcional ? `${etq} no es válida.` : `${etq} es obligatoria y debe ser válida.`,
));

const hora = (etq) => cadena((s) => s.regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${etq} no es válida.`));

const idObjeto = (etq) => cadena((s) => s.regex(/^[0-9a-f]{24}$/i, `Elige ${etq}.`));

const contrasenaNueva = () => cadena(
  (s) => s.min(10, 'La contraseña debe tener al menos 10 caracteres.').max(128, 'La contraseña admite máximo 128 caracteres.'),
  (v) => String(Array.isArray(v) ? (v[0] ?? '') : (v ?? '')),
);

module.exports = {
  z, limpio, cadena, texto, textoOpcional, correo, correoOpcional, telefono, codigoPostal, dinero, casilla,
  entero, opcion, fecha, hora, idObjeto, contrasenaNueva,
};
