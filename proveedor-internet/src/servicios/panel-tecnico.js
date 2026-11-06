'use strict';
// Cálculos del panel del técnico. Todo el dinero va en centavos (enteros), como el resto del sistema.

/** (tarifa de instalación − parcialidad cobrada) ÷ mensualidades, y total mensual junto con la tarifa mensual. */
function calcularInstalacion({ tarifaInstalacion, parcialCobrada, mensualidades, tarifaMensual }) {
  const saldo = tarifaInstalacion - parcialCobrada;
  const cuotaInstalacion = Math.round(saldo / mensualidades);
  return { saldo, cuotaInstalacion, totalMensual: tarifaMensual + cuotaInstalacion };
}

/** Fecha final de un periodo: 'YYYY-MM-DD' + N meses. Si el día no existe en el mes final, usa el último día. */
function finPeriodo(texto, meses) {
  const [a, m, d] = texto.split('-').map(Number);
  const total = (m - 1) + meses;
  const anio = a + Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

module.exports = { calcularInstalacion, finPeriodo };