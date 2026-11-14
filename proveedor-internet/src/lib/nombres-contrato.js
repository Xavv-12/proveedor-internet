"use strict";
// Interpreta el nombre de un PDF escaneado y devuelve a qué contrato apunta.
//   CTR-2026-00008.pdf  -> { tipo: 'folio',   valor: 'CTR-2026-00008' }  (folio del sistema)
//   CTR-60109A.pdf      -> { tipo: 'impreso', valor: '60109A' }          (número impreso en el papel)
//   60109A.pdf          -> { tipo: 'impreso', valor: '60109A' }
// Si no reconoce el nombre devuelve null. Sin dependencias, para poder probarlo solo.
function interpretarNombre(nombreArchivo) {
  const base = String(nombreArchivo || "")
    .replace(/^.*[\\/]/, "") // quita rutas
    .replace(/\.pdf$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "") // copias de Windows: "CTR-60109A (1)"
    .trim()
    .toUpperCase();
  const folio = /^CTR[-_ ](\d{4})[-_ ](\d{1,6})$/.exec(base);
  if (folio)
    return {
      tipo: "folio",
      valor: `CTR-${folio[1]}-${folio[2].padStart(5, "0")}`,
    };
  const impreso = /^(?:CTR[-_ ])?(\d{3,}[A-Z]?)$/.exec(base);
  if (impreso) return { tipo: "impreso", valor: impreso[1] };
  return null;
}

module.exports = { interpretarNombre };
