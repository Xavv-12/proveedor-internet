'use strict';
// Ejecutar:  node --test test/carga-clientes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { leerExcel, validarFila, crearPlantilla, claveNombre, claveDeEncabezado, MAX_FILAS } = require('../src/lib/excel-clientes');

const ENCABEZADOS = ['Nombre completo *', 'Teléfono (10 dígitos) *', 'Correo', 'Calle y número *', 'Colonia *', 'Código postal *', 'Referencias para llegar', 'Notas internas', 'Número de contrato (papel)'];

async function excel(filas, encabezados = ENCABEZADOS) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clientes');
  ws.addRow(encabezados);
  filas.forEach((f) => ws.addRow(f));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const valida = (extra = {}) => ({
  nombre: 'ANA LOPEZ RUIZ', telefono: '7131234567', correo: 'ana@correo.com', direccion: 'LAS PALMAS 15',
  colonia: 'SAN JOSE MEZAPA', codigoPostal: '52600', referencias: '', notas: '', numeroImpreso: '60109A', ...extra,
});

test('una fila completa es válida', () => {
  const v = validarFila(valida());
  assert.equal(v.ok, true);
  assert.equal(v.datos.telefono, '7131234567');
});

test('correo en mayúsculas se guarda en minúsculas; el número del papel, en mayúsculas', () => {
  const v = validarFila(valida({ correo: 'Ana@Correo.COM', numeroImpreso: '60109a' }));
  assert.equal(v.datos.correo, 'ana@correo.com');
  assert.equal(v.datos.numeroImpreso, '60109A');
});

test('correo, referencias, notas y número de contrato pueden ir vacíos', () => {
  assert.equal(validarFila(valida({ correo: '', referencias: '', notas: '', numeroImpreso: '' })).ok, true);
});

test('errores comunes dan un mensaje claro', () => {
  assert.match(validarFila(valida({ nombre: '' })).errores.join(' '), /Nombre/);
  assert.match(validarFila(valida({ telefono: '71310' })).errores.join(' '), /10 dígitos/);
  assert.match(validarFila(valida({ codigoPostal: '5260' })).errores.join(' '), /5 dígitos/);
  assert.match(validarFila(valida({ correo: 'sin-arroba' })).errores.join(' '), /correo válido/);
  assert.match(validarFila(valida({ colonia: 'X' })).errores.join(' '), /Colonia/);
  assert.match(validarFila(valida({ numeroImpreso: 'ab#1' })).errores.join(' '), /Número de contrato/);
});

test('lee el Excel: teléfono y código postal como número, correo con hipervínculo', async () => {
  const buf = await excel([['ANA LOPEZ', 7131234567, { text: 'ana@correo.com', hyperlink: 'mailto:ana@correo.com' }, 'CALLE UNO 12', 'CENTRO', 52600, '', '', 60109]]);
  const r = await leerExcel(buf);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].fila, 2);
  assert.equal(r.filas[0].valores.telefono, '7131234567');
  assert.equal(r.filas[0].valores.correo, 'ana@correo.com');
  assert.equal(r.filas[0].valores.codigoPostal, '52600');
  assert.equal(r.filas[0].valores.numeroImpreso, '60109');
});

test('un código postal al que Excel le quitó el cero inicial se corrige', async () => {
  const r = await leerExcel(await excel([['ANA LOPEZ', '7131234567', '', 'CALLE UNO 12', 'CENTRO', 5600, '', '', '']]));
  assert.equal(r.filas[0].valores.codigoPostal, '05600');
});

test('los encabezados se reconocen aunque cambien acentos, asteriscos o mayúsculas', () => {
  assert.equal(claveDeEncabezado('TELÉFONO (10 DÍGITOS) *'), 'telefono');
  assert.equal(claveDeEncabezado('Calle y número'), 'direccion');
  assert.equal(claveDeEncabezado('código postal'), 'codigoPostal');
  assert.equal(claveDeEncabezado('Número de contrato (papel)'), 'numeroImpreso');
  assert.equal(claveDeEncabezado('Revisión'), null);
});

test('las filas vacías se ignoran', async () => {
  const r = await leerExcel(await excel([['ANA LOPEZ', '7131234567', '', 'CALLE UNO 12', 'CENTRO', '52600'], [null, null, null], ['BETO RUIZ', '7131234568', '', 'CALLE DOS 5', 'CENTRO', '52600']]));
  assert.equal(r.filas.length, 2);
});

test('archivos que no sirven dan un error claro', async () => {
  assert.match((await leerExcel(Buffer.from('no soy excel'))).error, /\.xlsx/);
  assert.match((await leerExcel(await excel([], ENCABEZADOS))).error, /solo trae los encabezados/);
  assert.match((await leerExcel(await excel([['A', 'B']], ['Nombre', 'Colonia']))).error, /Faltan columnas/);
});

test('más de 1000 filas se rechaza', async () => {
  const filas = Array.from({ length: MAX_FILAS + 1 }, (_, i) => [`CLIENTE ${i}`, String(7000000000 + i), '', 'CALLE 1', 'CENTRO', '52600']);
  assert.match((await leerExcel(await excel(filas))).error, /máximo/);
});

test('la plantilla se puede leer, trae los 9 encabezados y no trae clientes', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await crearPlantilla());
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Clientes', 'Instrucciones']);
  assert.equal(wb.getWorksheet('Clientes').getRow(1).values.slice(1).length, 9);
  assert.equal(wb.getWorksheet('Clientes').rowCount, 1);
});

test('claveNombre ignora acentos, mayúsculas y signos', () => {
  assert.equal(claveNombre('JOSÉ  Pérez-López.'), claveNombre('jose perez lopez'));
});