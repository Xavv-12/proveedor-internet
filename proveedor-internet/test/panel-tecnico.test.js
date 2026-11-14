"use strict";
// Ejecutar:  node --test test/panel-tecnico.test.js
process.env.CLAVE_SECRETOS = "a".repeat(64);
const test = require("node:test");
const assert = require("node:assert/strict");
const { cifrar, descifrar, claveConfigurada } = require("../src/lib/secretos");
const {
  calcularInstalacion,
  finPeriodo,
} = require("../src/servicios/panel-tecnico");

test("cifrar y descifrar devuelve el texto original (con acentos y símbolos)", () => {
  const t = "Wi-Fi ñandú #2026 ¡hola!";
  assert.equal(descifrar(cifrar(t)), t);
});

test("el mismo texto cifrado dos veces da resultados distintos", () => {
  assert.notEqual(cifrar("igual"), cifrar("igual"));
});

test("el texto cifrado no contiene el original", () => {
  assert.ok(!cifrar("SuperSecreta123").includes("SuperSecreta123"));
});

test("si alguien altera el dato guardado, no se puede descifrar", () => {
  const partes = cifrar("abc").split(":");
  partes[3] = Buffer.from("otra cosa").toString("base64");
  assert.throws(() => descifrar(partes.join(":")));
});

test("con otra clave no se puede descifrar", () => {
  const c = cifrar("abc");
  process.env.CLAVE_SECRETOS = "b".repeat(64);
  assert.throws(() => descifrar(c));
  process.env.CLAVE_SECRETOS = "a".repeat(64);
});

test("sin clave válida no se cifra", () => {
  const original = process.env.CLAVE_SECRETOS;
  process.env.CLAVE_SECRETOS = "corta";
  assert.equal(claveConfigurada(), false);
  assert.throws(() => cifrar("x"));
  process.env.CLAVE_SECRETOS = original;
});

test("cuota de instalación: (tarifa − parcialidad) ÷ mensualidades", () => {
  // Instalación $1,500.00, parcialidad $500.00, 4 mensualidades, mensualidad $350.00
  const c = calcularInstalacion({
    tarifaInstalacion: 150000,
    parcialCobrada: 50000,
    mensualidades: 4,
    tarifaMensual: 35000,
  });
  assert.equal(c.saldo, 100000);
  assert.equal(c.cuotaInstalacion, 25000);
  assert.equal(c.totalMensual, 60000);
});

test("si la parcialidad cubre todo, la cuota es cero", () => {
  const c = calcularInstalacion({
    tarifaInstalacion: 100000,
    parcialCobrada: 100000,
    mensualidades: 3,
    tarifaMensual: 30000,
  });
  assert.equal(c.cuotaInstalacion, 0);
  assert.equal(c.totalMensual, 30000);
});

test("la cuota se redondea al centavo", () => {
  const c = calcularInstalacion({
    tarifaInstalacion: 100000,
    parcialCobrada: 0,
    mensualidades: 3,
    tarifaMensual: 0,
  });
  assert.equal(c.cuotaInstalacion, 33333);
});

test("fin del periodo: suma meses y ajusta días inexistentes", () => {
  assert.equal(finPeriodo("2026-11-06", 12), "2027-11-06");
  assert.equal(finPeriodo("2026-11-06", 6), "2027-05-06");
  assert.equal(finPeriodo("2026-08-31", 6), "2027-02-28");
  assert.equal(finPeriodo("2026-01-31", 1), "2026-02-28");
  assert.equal(finPeriodo("2026-12-15", 24), "2028-12-15");
});
