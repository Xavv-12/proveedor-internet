"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { preparar, crearCobroPrueba } = require("./ayuda");

let ctx;
let cobranza;
before(async () => {
  ctx = await preparar();
  cobranza = require("../src/servicios/cobranza");
});
after(async () => {
  await ctx.cerrar();
});

describe("Mensualidades", () => {
  it("generar 12 meses es idempotente", async () => {
    const { contratoId } = await crearCobroPrueba(ctx.db);
    await ctx.db.col("mensualidades").deleteMany({ contratoId });
    const primera = await cobranza.generarMensualidades(contratoId);
    const segunda = await cobranza.generarMensualidades(contratoId);
    const [t1, t2] = await Promise.all([
      cobranza.generarMensualidades(contratoId),
      cobranza.generarMensualidades(contratoId),
    ]);
    assert.equal(primera.creadas, 12);
    assert.equal(segunda.creadas, 0);
    assert.equal(t1.creadas + t2.creadas, 0);
    assert.equal(
      await ctx.db.col("mensualidades").countDocuments({ contratoId }),
      12,
    );
  });

  it("el vencimiento marca como VENCIDA lo que pasó su fecha límite", async () => {
    const { mensualidadId } = await crearCobroPrueba(ctx.db);
    await ctx.db
      .col("mensualidades")
      .updateOne(
        { _id: mensualidadId },
        { $set: { fechaLimite: new Date(Date.now() - 1000) } },
      );
    await cobranza.marcarVencidas();
    assert.equal(
      (await ctx.db.col("mensualidades").findOne({ _id: mensualidadId }))
        .estado,
      "VENCIDA",
    );
  });
});

describe("Pagos", () => {
  it("la referencia se guarda en MAYÚSCULAS y un pago repetido se rechaza", async () => {
    const a = await crearCobroPrueba(ctx.db);
    const b = await crearCobroPrueba(ctx.db);
    const { pago } = await cobranza.registrarPago({
      mensualidadId: a.mensualidadId,
      monto: 5000,
      metodo: "transferencia",
      referencia: "ref-abc-001",
    });
    assert.equal(pago.referencia, "REF-ABC-001");
    assert.equal(pago.estado, "por validar");
    await assert.rejects(
      cobranza.registrarPago({
        mensualidadId: b.mensualidadId,
        monto: 5000,
        metodo: "deposito",
        referencia: "Ref-Abc-001",
      }),
      { message: "Ese pago ya estaba registrado" },
    );
    const mb = await ctx.db
      .col("mensualidades")
      .findOne({ _id: b.mensualidadId });
    assert.equal(mb.enValidacion, 0, "la transacción revirtió el saldo");
  });

  it("decenas de cobros simultáneos no duplican ni pasan el saldo", async () => {
    const { mensualidadId } = await crearCobroPrueba(ctx.db, {
      importe: 20000,
    });
    const intentos = Array.from({ length: 40 }, (_, i) =>
      cobranza.registrarPago({
        mensualidadId,
        monto: 1000,
        metodo: "efectivo",
        referencia: `SIM-${String(i).padStart(3, "0")}`,
      }),
    );
    const resultados = await Promise.allSettled(intentos);
    const exitos = resultados.filter((r) => r.status === "fulfilled").length;
    assert.equal(exitos, 20);
    const m = await ctx.db.col("mensualidades").findOne({ _id: mensualidadId });
    assert.equal(m.pagado, 20000);
    assert.equal(m.estado, "PAGADA");
    assert.equal(
      await ctx.db.col("pagos").countDocuments({ mensualidadId }),
      20,
    );
  });

  it("la misma referencia enviada en paralelo solo se registra una vez", async () => {
    const { mensualidadId } = await crearCobroPrueba(ctx.db, {
      importe: 50000,
    });
    const resultados = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        cobranza.registrarPago({
          mensualidadId,
          monto: 1000,
          metodo: "efectivo",
          referencia: "DOBLE-CLIC-1",
        }),
      ),
    );
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
    const m = await ctx.db.col("mensualidades").findOne({ _id: mensualidadId });
    assert.equal(m.pagado, 1000);
  });

  it("no se cobra una mensualidad PAGADA ni CANCELADA y nunca se supera el saldo", async () => {
    const { mensualidadId } = await crearCobroPrueba(ctx.db, {
      importe: 10000,
    });
    await assert.rejects(
      cobranza.registrarPago({
        mensualidadId,
        monto: 10001,
        metodo: "efectivo",
        referencia: "EXCEDE-1",
      }),
      /supera el saldo/,
    );
    await cobranza.registrarPago({
      mensualidadId,
      monto: 10000,
      metodo: "efectivo",
      referencia: "TOTAL-1",
    });
    await assert.rejects(
      cobranza.registrarPago({
        mensualidadId,
        monto: 100,
        metodo: "efectivo",
        referencia: "OTRO-1",
      }),
      /ya está pagada/,
    );
    const c = await crearCobroPrueba(ctx.db);
    await cobranza.cancelarMensualidad(c.mensualidadId);
    await assert.rejects(
      cobranza.registrarPago({
        mensualidadId: c.mensualidadId,
        monto: 100,
        metodo: "efectivo",
        referencia: "CANC-1",
      }),
      /cancelada/,
    );
  });

  it("transferencia queda por validar y al validarla suma a lo pagado", async () => {
    const { mensualidadId } = await crearCobroPrueba(ctx.db, {
      importe: 30000,
    });
    const { pago } = await cobranza.registrarPago({
      mensualidadId,
      monto: 30000,
      metodo: "tarjeta",
      referencia: "TARJ-77",
    });
    let m = await ctx.db.col("mensualidades").findOne({ _id: mensualidadId });
    assert.equal(m.enValidacion, 30000);
    assert.equal(m.estado, "PENDIENTE");
    await assert.rejects(
      cobranza.registrarPago({
        mensualidadId,
        monto: 1,
        metodo: "efectivo",
        referencia: "EXTRA-1",
      }),
      /supera el saldo/,
    );
    await cobranza.validarPago(pago._id, {});
    m = await ctx.db.col("mensualidades").findOne({ _id: mensualidadId });
    assert.equal(m.pagado, 30000);
    assert.equal(m.enValidacion, 0);
    assert.equal(m.estado, "PAGADA");
  });
});

describe("Conciliación bancaria", () => {
  it("reporta filas inválidas sin frenar las válidas y no duplica al reimportar", async () => {
    const { importarCsv } = require("../src/servicios/conciliacion");
    const { mensualidadId } = await crearCobroPrueba(ctx.db, {
      importe: 40000,
    });
    await cobranza.registrarPago({
      mensualidadId,
      monto: 40000,
      metodo: "transferencia",
      referencia: "BANCO-555",
    });
    const csv = Buffer.from(
      'fecha,referencia,importe,descripcion\n2026-10-01,BANCO-555,400.00,Pago ficticio\n05/10/2026,OTRA-9,"1,250.50",Otro\nmalaFecha,X,abc,Error\n',
    );
    const r1 = await importarCsv(csv, "estado.csv", {});
    assert.equal(r1.validas, 2);
    assert.equal(r1.invalidas, 1);
    assert.equal(r1.nuevas, 2);
    assert.equal(r1.coincidencias, 1);
    assert.equal(r1.errores[0].fila, 4);
    const r2 = await importarCsv(csv, "estado.csv", {});
    assert.equal(r2.nuevas, 0);
    assert.equal(r2.duplicadas, 2);
    assert.equal(
      await ctx.db.col("movimientos_bancarios").countDocuments({}),
      2,
    );
  });

  it("rechaza archivos binarios aunque digan ser CSV", async () => {
    const { importarCsv } = require("../src/servicios/conciliacion");
    await assert.rejects(
      importarCsv(
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]),
        "falso.csv",
        {},
      ),
      /no es un CSV/,
    );
  });
});

describe("Recordatorios y tareas", () => {
  it("no reserva el mismo teléfono dos veces en 20 horas", async () => {
    const { reservarTelefono } = require("../src/servicios/recordatorios");
    const [a, b] = await Promise.all([
      reservarTelefono("5500000099"),
      reservarTelefono("5500000099"),
    ]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
    assert.equal((await reservarTelefono("5500000099")).ok, false);
    const dentroDe21h = new Date(Date.now() + 21 * 3600 * 1000);
    assert.equal((await reservarTelefono("5500000099", dentroDe21h)).ok, true);
  });

  it("una tarea programada no corre en paralelo", async () => {
    const { ejecutarConBloqueo } = require("../src/servicios/tareas");
    let corridas = 0;
    const lenta = async () => {
      corridas++;
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true };
    };
    const [a, b] = await Promise.all([
      ejecutarConBloqueo("prueba", 60000, lenta),
      ejecutarConBloqueo("prueba", 60000, lenta),
    ]);
    assert.equal(corridas, 1);
    assert.ok(a.omitida || b.omitida);
    const ej = await ctx.db
      .col("tareas_ejecuciones")
      .findOne({ tarea: "prueba" });
    assert.equal(ej.estado, "correcta");
    assert.ok(ej.inicio && ej.fin);
  });
});
