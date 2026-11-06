"use strict";
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { obtenerConfig } = require("./config");
const { clienteMongo } = require("./db");
const logger = require("./logger");
const { NOMBRES_ROL, menuPara } = require("./permisos");
const { cargarUsuario, requiereSesion } = require("./middleware/sesion");
const { proteccionCsrf } = require("./middleware/csrf");
const { ayudasVista } = require("./lib/vistas");
const { ErrorNegocio } = require("./lib/util");

const { rApi, rWebhook, rSalud } = require("./rutas/publicas");
const { rAcceso, rMiCuenta, rTablero } = require("./rutas/acceso");
const { rCobranza, rPrioridad, rConciliacion } = require("./rutas/cobros");
const { rUsuarios, rAuditoria } = require("./rutas/usuarios");
const rEventos = require("./rutas/eventos");
const { emitir } = require("./lib/eventos");

// Ruta de cada módulo: el nombre con que se anuncian sus cambios
// y los módulos que esa pantalla escucha para actualizarse sola.
const TIEMPO_REAL = [
  ["/solicitudes", "solicitudes", "solicitudes"],
  ["/planes", "planes", "planes"],
  ["/promociones", "promociones", "promociones planes"],
  ["/cobertura", "cobertura", "cobertura"],
  ["/clientes", "clientes", "clientes contratos"],
  [
    "/contratos",
    "contratos",
    "contratos clientes equipos incidencias cobranza planes",
  ],
  ["/equipos", "equipos", "equipos contratos"],
  ["/incidencias", "incidencias", "incidencias visitas"],
  ["/visitas", "visitas", "visitas incidencias tecnicos"],
  ["/panel-tecnico", "panel_tecnico", "panel_tecnico visitas"],
  ["/tecnicos", "tecnicos", "tecnicos visitas"],
  ["/cobranza", "cobranza", "cobranza contratos conciliacion"],
  ["/prioridad-de-cobranza", "cobranza", "cobranza contratos clientes"],
  ["/conciliacion-bancaria", "conciliacion", "conciliacion cobranza"],
  ["/mensajes-y-avisos", "mensajes", "mensajes"],
  ["/conversaciones-whatsapp", "mensajes", "mensajes"],
  ["/usuarios", "usuarios", "usuarios"],
  ["/auditoria", "auditoria", "auditoria"],
];
const TABLERO_ESCUCHA = "solicitudes clientes contratos incidencias visitas";

// NUEVO: cuando cambia un módulo, también se avisa a estos otros.
// Al registrar un cliente desde una solicitud, la lista de Solicitudes debe actualizarse.
const AVISAR_TAMBIEN = {
  clientes: ["solicitudes"],
};

function tiempoReal(req, res, next) {
  const modulo = TIEMPO_REAL.find(
    ([ruta]) => req.path === ruta || req.path.startsWith(`${ruta}/`),
  );
  if (req.method === "GET") {
    res.locals.tiempoReal =
      req.path === "/" ? TABLERO_ESCUCHA : modulo ? modulo[2] : null;
  } else if (req.method === "POST" && modulo) {
    // Al terminar un cambio correcto, se avisa a todas las pantallas abiertas.
    res.on("finish", () => {
      if (res.statusCode < 400) {
        emitir(modulo[1]);
        // NUEVO
        for (const otro of AVISAR_TAMBIEN[modulo[1]] || []) emitir(otro);
        emitir("auditoria");
      }
    });
  }
  next();
}

// NUEVO: la API pública (formulario de la página web) no pasa por tiempoReal,
// así que aquí se avisa cuando entra una solicitud nueva.
function avisoPublico(req, res, next) {
  if (req.method === "POST") {
    res.on("finish", () => {
      if (res.statusCode < 400 && /\/solicitudes/.test(req.originalUrl)) {
        emitir("solicitudes");
        emitir("auditoria");
      }
    });
  }
  next();
}

const EMPRESA = "COSMOS";
const DOCE_HORAS = 12 * 60 * 60 * 1000;

function crearApp() {
  const cfg = obtenerConfig();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "vistas"));
  Object.assign(app.locals, ayudasVista, {
    empresa: EMPRESA,
    tiempoReal: null,
    titulo: "",
    usuario: null,
    menu: [],
    nombreRol: "",
    rutaActual: "",
    aviso: null,
    csrf: "",
  });
  // Título con la última palabra resaltada en azul
  app.locals.acento = (titulo) => {
    const esc = (v) =>
      String(v).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    const t = String(titulo ?? "").trim();
    const i = t.lastIndexOf(" ");
    if (i < 1) return esc(t);
    return `${esc(t.slice(0, i))} <span class="acento">${esc(t.slice(i + 1))}</span>`;
  };

  if (process.env.NODE_ENV !== "production") {
    app.use(require("morgan")("dev", { skip: (req) => req.originalUrl.startsWith("/eventos") || req.originalUrl.startsWith("/api/v1/eventos") }));
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "https://fonts.googleapis.com"],
          "img-src": ["'self'", "data:", "https://server.arcgisonline.com"], // mapa satelital del editor de contorno
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "connect-src": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "upgrade-insecure-requests": cfg.produccion ? [] : null,
        },
      },
      strictTransportSecurity: cfg.produccion
        ? { maxAge: 15552000, includeSubDomains: false }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Rutas sin sesión: salud, webhook (cuerpo crudo para la firma) y API pública.
  app.use("/webhooks/whatsapp", rWebhook);
  app.use("/api/v1", avisoPublico); // NUEVO
  app.use("/api/v1/portal", require("./rutas/portal"));
  app.use("/api/v1", rApi);

  // Leaflet (mapa del editor de contorno en Cobertura), servido desde node_modules: npm install leaflet
  app.use(
    "/static/vendor/leaflet",
    express.static(
      path.join(__dirname, "..", "node_modules", "leaflet", "dist"),
      {
        maxAge: cfg.produccion ? "7d" : 0,
        index: false,
      },
    ),
  );

  app.use(
    "/static",
    express.static(path.join(__dirname, "..", "public"), {
      maxAge: cfg.produccion ? "7d" : 0,
      index: false,
    }),
  );
  app.get("/favicon.ico", (req, res) =>
    res.redirect(301, "/static/img/logo.svg"),
  );
  app.get("/robots.txt", (req, res) =>
    res.type("text/plain").send("User-agent: *\nDisallow: /\n"),
  );

  app.use(
    express.urlencoded({
      extended: false,
      limit: "100kb",
      parameterLimit: 200,
    }),
  );
  app.use(
    session({
      name: cfg.produccion ? "__Host-sesion" : "sesion",
      secret: cfg.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({
        client: clienteMongo(),
        dbName: cfg.mongoDb,
        collectionName: "sesiones",
        ttl: DOCE_HORAS / 1000,
        autoRemove: "native",
        stringify: false,
      }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: cfg.produccion,
        maxAge: DOCE_HORAS,
        path: "/",
      },
    }),
  );
  app.use(cargarUsuario);
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.locals.titulo = "";
    res.locals.usuario = req.usuario || null;
    res.locals.menu = req.usuario ? menuPara(req.usuario) : [];
    res.locals.nombreRol = req.usuario ? NOMBRES_ROL[req.usuario.rol] : "";
    res.locals.rutaActual = req.path;
    res.locals.aviso = req.session.aviso || null;
    if (req.session.aviso) delete req.session.aviso;
    next();
  });

  app.use(proteccionCsrf);
  app.use(rAcceso);
  app.use(requiereSesion); // todo lo que sigue exige sesión

  app.use(tiempoReal);
  app.use("/", rTablero);
  app.use("/mi-cuenta", rMiCuenta);
  app.use("/eventos", rEventos);
  app.use("/solicitudes", require("./rutas/solicitudes"));
  app.use("/planes", require("./rutas/planes"));
  app.use("/promociones", require("./rutas/promociones"));
  app.use("/cobertura", require("./rutas/cobertura"));
  app.use("/clientes", require("./rutas/clientes"));
  app.use("/contratos", require("./rutas/contratos"));
  app.use("/equipos", require("./rutas/equipos"));
  app.use("/incidencias", require("./rutas/incidencias"));
  app.use("/visitas", require("./rutas/visitas"));
  app.use("/panel-tecnico", require("./rutas/panel-tecnico"));
  app.use("/tecnicos", require("./rutas/tecnicos"));
  app.use("/cobranza", rCobranza);
  app.use("/prioridad-de-cobranza", rPrioridad);
  app.use("/conciliacion-bancaria", rConciliacion);
  app.use("/mensajes-y-avisos", require("./rutas/mensajes"));
  app.use("/conversaciones-whatsapp", require("./rutas/conversaciones"));
  app.use("/usuarios", rUsuarios);
  app.use("/auditoria", rAuditoria);

  app.use((req, res) =>
    res.status(404).render("error", {
      titulo: "No encontrado",
      mensaje: "No encontramos esta página.",
    }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return undefined;
    if (err instanceof ErrorNegocio)
      return res.status(err.estado).render("error", {
        titulo: "No se pudo completar",
        mensaje: err.message,
      });
    if (err.type === "entity.too.large")
      return res.status(413).render("error", {
        titulo: "Datos demasiado grandes",
        mensaje: "El formulario es demasiado grande.",
      });
    logger.error(
      { error: err.message, stack: err.stack, ruta: req.path },
      "Error no controlado",
    );
    return res.status(500).render("error", {
      titulo: "Error",
      mensaje: "Ocurrió un error inesperado. Intenta de nuevo.",
    });
  });

  return app;
}

module.exports = { crearApp, EMPRESA };
