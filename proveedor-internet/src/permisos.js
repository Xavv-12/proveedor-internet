"use strict";

const TODOS = ["admin", "atencion", "tecnico"];
const OFICINA = ["admin", "atencion"];
const ADMIN = ["admin"];

/**
 * Matriz de permisos por módulo. Se aplica en el servidor en cada ruta.
 * El técnico solo lee Contratos y Equipos; no tiene acceso a Cobranza,
 * Conciliación, Usuarios, Auditoría, Solicitudes ni Clientes.
 */
const PERMISOS = {
  tablero: { leer: TODOS },
  solicitudes: { leer: OFICINA, escribir: OFICINA },
  planes: { leer: OFICINA, escribir: OFICINA },
  promociones: { leer: OFICINA, escribir: OFICINA },
  cobertura: { leer: OFICINA, escribir: OFICINA },
  clientes: { leer: OFICINA, escribir: OFICINA },
  contratos: { leer: TODOS, escribir: OFICINA },
  equipos: { leer: TODOS, escribir: OFICINA },
  contratos_pdf: { leer: OFICINA, escribir: OFICINA },
  incidencias: { leer: TODOS, escribir: TODOS },
  visitas: { leer: TODOS, escribir: TODOS },
  panel_tecnico: { leer: TODOS, escribir: ["tecnico"] },
  tecnicos: { leer: TODOS, escribir: OFICINA },
  cobranza: { leer: OFICINA, escribir: OFICINA },
  prioridad: { leer: OFICINA, escribir: OFICINA },
  conciliacion: { leer: OFICINA, escribir: OFICINA },
  mensajes: { leer: OFICINA, escribir: OFICINA },
  usuarios: { leer: ADMIN, escribir: ADMIN },
  auditoria: { leer: ADMIN },
};

const ROLES = ["admin", "atencion", "tecnico"];
const NOMBRES_ROL = {
  admin: "Administración",
  atencion: "Atención",
  tecnico: "Técnico",
};

const MINUTO = 60 * 1000;
const INACTIVIDAD_MS = {
  admin: 30 * MINUTO,
  atencion: 60 * MINUTO,
  tecnico: 120 * MINUTO,
};

const MENU = [
  {
    grupo: "Mi panel",
    roles: ["tecnico"],
    items: [
      { modulo: "panel_tecnico", ruta: "/panel-tecnico", texto: "Mis actividades" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/instalaciones", texto: "Instalaciones" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/seguimientos", texto: "Seguimiento" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/atenciones", texto: "Atención a clientes" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/renovaciones", texto: "Renovaciones" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/bajas", texto: "Bajas de contratos" },
    ],
  },
  {
    grupo: "Panel de técnicos",
    roles: ["admin", "atencion"],
    items: [
      { modulo: "panel_tecnico", ruta: "/panel-tecnico", texto: "Resumen" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/instalaciones", texto: "Instalaciones" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/seguimientos", texto: "Seguimiento" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/atenciones", texto: "Atención a clientes" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/renovaciones", texto: "Renovaciones" },
      { modulo: "panel_tecnico", ruta: "/panel-tecnico/bajas", texto: "Bajas de contratos" },
    ],
  },
  {
    grupo: "Ventas",
    items: [
      { modulo: "solicitudes", ruta: "/solicitudes", texto: "Solicitudes" },
      { modulo: "planes", ruta: "/planes", texto: "Planes" },
      { modulo: "promociones", ruta: "/promociones", texto: "Promociones" },
      { modulo: "cobertura", ruta: "/cobertura", texto: "Cobertura" },
    ],
  },
  {
    grupo: "Clientes",
    items: [
      { modulo: "clientes", ruta: "/clientes", texto: "Clientes" },
      { modulo: "clientes", ruta: "/clientes/carga-masiva", texto: "Carga masiva" },
      { modulo: "contratos", ruta: "/contratos", texto: "Contratos" },
      { modulo: "equipos", ruta: "/equipos", texto: "Equipos" },
      { modulo: "contratos_pdf", ruta: "/contratos-escaneados", texto: "Contratos escaneados" },
    ],
  },
  {
    grupo: "Soporte",
    items: [
      { modulo: "incidencias", ruta: "/incidencias", texto: "Incidencias" },
      { modulo: "visitas", ruta: "/visitas", texto: "Agenda de visitas" },
      { modulo: "tecnicos", ruta: "/tecnicos", texto: "Técnicos" },
    ],
  },
  {
    grupo: "Cobros",
    items: [
      { modulo: "cobranza", ruta: "/cobranza", texto: "Pagos y cobranza" },
      {
        modulo: "prioridad",
        ruta: "/prioridad-de-cobranza",
        texto: "Prioridad de cobranza",
      },
      {
        modulo: "conciliacion",
        ruta: "/conciliacion-bancaria",
        texto: "Conciliación bancaria",
      },
    ],
  },
  {
    grupo: "Sistema",
    items: [
      {
        modulo: "mensajes",
        ruta: "/mensajes-y-avisos",
        texto: "Mensajes y avisos",
      },
      {
        modulo: "mensajes",
        ruta: "/conversaciones-whatsapp",
        texto: "Conversaciones de WhatsApp",
      },
      { modulo: "usuarios", ruta: "/usuarios", texto: "Usuarios" },
      { modulo: "auditoria", ruta: "/auditoria", texto: "Auditoría" },
    ],
  },
];

function puede(usuario, modulo, nivel = "leer") {
  if (!usuario || !usuario.activo) return false;
  const lista = PERMISOS[modulo] && PERMISOS[modulo][nivel];
  return Array.isArray(lista) && lista.includes(usuario.rol);
}

function menuPara(usuario) {
  return MENU.filter((g) => !g.roles || g.roles.includes(usuario.rol)).map((g) => ({
    grupo: g.grupo,
    items: g.items.filter((i) => puede(usuario, i.modulo)),
  })).filter((g) => g.items.length);
}

module.exports = {
  PERMISOS,
  ROLES,
  NOMBRES_ROL,
  INACTIVIDAD_MS,
  MENU,
  puede,
  menuPara,
};
