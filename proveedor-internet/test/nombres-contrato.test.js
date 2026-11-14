"use strict";
// Ejecutar:  node --test test/nombres-contrato.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { interpretarNombre } = require("../src/lib/nombres-contrato");

test("número impreso con prefijo CTR", () => {
  assert.deepEqual(interpretarNombre("CTR-60109A.pdf"), {
    tipo: "impreso",
    valor: "60109A",
  });
});
test("número impreso solo", () => {
  assert.deepEqual(interpretarNombre("60126.pdf"), {
    tipo: "impreso",
    valor: "60126",
  });
});
test("folio del sistema, aunque venga en minúsculas o sin ceros", () => {
  assert.deepEqual(interpretarNombre("CTR-2026-00008.pdf"), {
    tipo: "folio",
    valor: "CTR-2026-00008",
  });
  assert.deepEqual(interpretarNombre("ctr-2026-8.PDF"), {
    tipo: "folio",
    valor: "CTR-2026-00008",
  });
});
test("copias de Windows y rutas completas", () => {
  assert.deepEqual(interpretarNombre("CTR-60109A (1).pdf"), {
    tipo: "impreso",
    valor: "60109A",
  });
  assert.deepEqual(interpretarNombre("C:\\scan\\CTR-60109A.pdf"), {
    tipo: "impreso",
    valor: "60109A",
  });
});
test("nombres que no se reconocen", () => {
  assert.equal(interpretarNombre("foto.pdf"), null);
  assert.equal(interpretarNombre("escaneo_sin_nombre.pdf"), null);
  assert.equal(interpretarNombre(""), null);
  assert.equal(interpretarNombre(undefined), null);
});
