'use strict';
const nodemailer = require('nodemailer');
const { obtenerConfig } = require('../config');
const logger = require('../logger');

let transporte = null;

function obtenerTransporte() {
  const { smtp } = obtenerConfig();
  if (!smtp.host) return null;
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }
  return transporte;
}

async function enviarRestablecimiento(correo, nombre, enlace) {
  const t = obtenerTransporte();
  if (!t) {
    logger.warn('SMTP no configurado: no se envió el correo de restablecimiento.');
    return false;
  }
  await t.sendMail({
    from: obtenerConfig().smtp.from,
    to: correo,
    subject: 'Restablece tu contraseña',
    text: `Hola, ${nombre}:\n\nRecibimos una solicitud para restablecer tu contraseña. `
      + `Abre este enlace en los próximos 30 minutos. Solo funciona una vez.\n\n${enlace}\n\n`
      + 'Si no la pediste, ignora este correo. Tu contraseña no cambiará.',
  });
  return true;
}

async function enviarContratoPdf({ correo, nombre, folio, rutaPdf }) {
  const t = obtenerTransporte();
  if (!t) throw new Error('El correo (SMTP) no está configurado en el servidor.');
  await t.sendMail({
    from: obtenerConfig().smtp.from,
    to: correo,
    subject: 'Tu contrato de servicio de internet COSMOS',
    text: `Hola, ${nombre}:\n\nTe enviamos una copia de tu contrato de servicio de internet (contrato ${folio}), `
      + 'firmado y escaneado. Consérvala para cualquier aclaración.\n\n'
      + 'Si tienes dudas, comunícate con nosotros por los medios de contacto que aparecen en tu contrato.\n\nCOSMOS',
    attachments: [{ filename: `Contrato-${folio}.pdf`, path: rutaPdf, contentType: 'application/pdf' }],
  });
  return true;
}

module.exports = { enviarRestablecimiento, enviarContratoPdf };
