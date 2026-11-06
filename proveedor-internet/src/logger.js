'use strict';
const pino = require('pino');

// Nunca se registran contraseñas, tokens, cadenas de conexión ni firmas.
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { app: 'proveedor-internet' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'contrasena', 'password', 'token', 'hash', 'secreto', 'uri', 'firma',
      '*.contrasena', '*.password', '*.token', '*.hash', '*.secreto', '*.uri', '*.firma',
      'req.headers.cookie', 'req.headers.authorization', 'req.headers["x-hub-signature-256"]',
    ],
    censor: '[oculto]',
  },
});

module.exports = logger;
