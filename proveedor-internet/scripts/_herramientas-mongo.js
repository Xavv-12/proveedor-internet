'use strict';
// Ejecuta mongodump/mongorestore sin exponer la cadena de conexión en la línea de comandos:
// se escribe en un archivo de configuración temporal con permisos 600 y se borra al terminar.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function ejecutarConUri(programa, args, uri) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-'));
  const archivo = path.join(dir, 'config.yaml');
  fs.writeFileSync(archivo, `uri: "${uri.replace(/"/g, '\\"')}"\n`, { mode: 0o600 });
  return new Promise((ok, mal) => {
    const p = spawn(programa, ['--config', archivo, ...args], { stdio: 'inherit', shell: false });
    p.on('error', (e) => mal(new Error(`No se pudo ejecutar ${programa}. Instala MongoDB Database Tools y agrégalo al PATH. (${e.code})`)));
    p.on('close', (codigo) => (codigo === 0 ? ok() : mal(new Error(`${programa} terminó con código ${codigo}`))));
  }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

module.exports = { ejecutarConUri };
