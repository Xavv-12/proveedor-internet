"use strict";
const { obtenerConfig } = require("./config");
const logger = require("./logger");
const { conectar, desconectar, db } = require("./db");
const { crearIndices } = require("./indices");
const { crearApp } = require("./app");
const { iniciarTareas } = require("./servicios/tareas");
const { cerrarConexiones } = require("./lib/eventos");
const {
  iniciarVigilancia,
  detenerVigilancia,
} = require("./lib/vigilante-mongo");

async function iniciar() {
  const cfg = obtenerConfig(); // valida variables obligatorias y se detiene si falta alguna
  if (cfg.produccion && !cfg.trustProxy)
    logger.warn(
      "TRUST_PROXY no está activo. En Render debe ser true para que la cookie segura funcione.",
    );
  await conectar(cfg.mongoUri, cfg.mongoDb);
  logger.info("Conectado a MongoDB");
  const hola = await db().admin().command({ hello: 1 });
  if (!hola.setName && hola.msg !== "isdbgrid") {
    console.error(
      "Tu MongoDB no es una réplica (replica set) y la aplicación necesita transacciones.\n" +
        'Usa MongoDB Atlas (el plan gratuito sirve) o inicia tu MongoDB local como réplica: ver "MongoDB local" en el README.',
    );
    await desconectar();
    process.exit(1);
  }
  await crearIndices();
  const app = crearApp();
  const servidor = app.listen(cfg.puerto, () =>
    logger.info(
      { puerto: cfg.puerto, entorno: cfg.entorno },
      "Aplicación iniciada",
    ),
  );
  servidor.keepAliveTimeout = 65_000; // mayor que el del proxy de Render
  servidor.headersTimeout = 66_000;
  const detenerTareas = iniciarTareas();
  iniciarVigilancia(); // cambios hechos directo en MongoDB también actualizan las pantallas

  let cerrando = false;
  const apagar = (senal) => {
    if (cerrando) return;
    cerrando = true;
    logger.info({ senal }, "Apagado controlado: dejando de aceptar conexiones");
    detenerTareas();
    detenerVigilancia();
    cerrarConexiones();
    const forzar = setTimeout(() => {
      logger.error("Apagado forzado por tiempo");
      process.exit(1);
    }, 15_000);
    forzar.unref();
    servidor.close(async () => {
      try {
        await desconectar();
        logger.info("Apagado completo");
        process.exit(0);
      } catch (e) {
        logger.error({ error: e.message }, "Error al cerrar MongoDB");
        process.exit(1);
      }
    });
    servidor.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => apagar("SIGTERM"));
  process.on("SIGINT", () => apagar("SIGINT"));
}

process.on("unhandledRejection", (e) =>
  logger.error({ error: e?.message }, "Promesa rechazada sin manejar"),
);

iniciar().catch((e) => {
  logger.fatal({ error: e.message }, "No se pudo iniciar la aplicación");
  process.exit(1);
});
