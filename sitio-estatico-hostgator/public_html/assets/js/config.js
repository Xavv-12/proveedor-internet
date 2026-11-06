/* =========================================================
   CONFIGURACIÓN DEL SITIO
   Aquí cambias los datos de tu empresa. No pongas contraseñas.
   Los textos van entre comillas "así". Respeta comas y corchetes.
   ========================================================= */

/* Detecta si el sitio se abre desde tu computadora o desde tu red local
   (por ejemplo el celular en http://192.168.1.69:5500). En ese caso la app
   se busca en la misma computadora donde corre, en el puerto 3000. */
const ES_RED_LOCAL =
  /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
    window.location.hostname,
  );

window.CONFIGURACION = {
  /* "demo" = sitio de prueba · "produccion" = sitio real */
  modo: "produccion",

  /* ===== DATOS DE LA EMPRESA ===== */
  nombreEmpresa: "Proveedor de internet",
  logo: "" /* ejemplo: "assets/img/logo.png" */,
  telefono: "" /* ejemplo: "722 123 4567" */,
  whatsapp: "" /* con lada de país, sin espacios. Ejemplo: "527221234567" */,
  correo: "",
  horario: "" /* ejemplo: "Lunes a sábado de 9:00 a 18:00" */,
  direccion: "",
  redesSociales: [
    /* ejemplo: { "nombre": "Facebook", "url": "https://facebook.com/tuempresa" } */
  ],
  urlSitio: "" /* ejemplo: "https://www.tuempresa.com" */,

  /* ===== SERVIDOR PARA RECIBIR SOLICITUDES (opcional) =====
     Si lo dejas vacío, las solicitudes se preparan para WhatsApp.
     En tu computadora y en tu red local la dirección se arma sola
     (funciona igual en la PC y en el celular).
     EN PRODUCCIÓN: cambia la dirección de abajo por la de tu app en Render,
     terminada en /api/v1. Ejemplo: "https://mi-app.onrender.com/api/v1" */
  api: {
    url: ES_RED_LOCAL
      ? `http://${window.location.hostname}:3000/api/v1`
      : "http://localhost:3000/api/v1",
    ruta: "/solicitudes",
    tiempoEsperaMs: 15000,
  },

  /* ===== MAPA DE COBERTURA (cobertura.html) =====
     googleKey: tu clave de Google Maps (empieza con "AIza…").
                Déjala vacía "" para usar el mapa satelital gratuito.
     centro:    [latitud, longitud] donde abre el mapa.
     zoom:      9 = región completa · 13 = un municipio · 16 = unas calles.
     Las zonas azules se dibujan en la app: Cobertura → Editar → Dibujar área. */
  mapa: {
    googleKey: "",
    centro: [19.25, -99.45] /* Región Toluca – Xalatlaco – Tenancingo */,
    zoom: 9,
  },

  /* ===== PAQUETES =====
     Con la app conectada, los paquetes se cargan solos desde la app (Planes).
     Esta lista solo se usa si la app no responde.
     El "id" debe ser igual a la "Clave web" del plan en la app
     y al del botón "Contratar" (ejemplo: ?paquete=basico). */
  paquetes: [
    { id: "basico", nombre: "Básico", precio: 200, moneda: "MXN" },
    { id: "plus", nombre: "Plus", precio: 300, moneda: "MXN" },
    { id: "premium-1", nombre: "Premium 1", precio: 400, moneda: "MXN" },
    { id: "premium-2", nombre: "Premium 2", precio: 500, moneda: "MXN" },
    { id: "premium-3", nombre: "Premium 3", precio: 600, moneda: "MXN" },
  ],

  /* ===== ZONAS DE COBERTURA (respaldo) =====
     Con la app conectada, la cobertura se consulta en la app (Cobertura).
     Esta lista solo se usa si la app no responde.
     "situacion": "pendiente" = hay cobertura por confirmar
                  "sin-cobertura" = no llegamos todavía */
  cobertura: [
    {
      estado: "Estado de prueba",
      municipio: "Municipio de prueba",
      localidad: "Centro de prueba",
      situacion: "pendiente",
    },
    {
      estado: "Estado de prueba",
      municipio: "Municipio de prueba",
      localidad: "Norte de prueba",
      situacion: "sin-cobertura",
    },
  ],

  /* ===== PROMOCIONES (respaldo) =====
     Con la app conectada, las promociones se cargan desde la app (Promociones).
     Fechas en formato año-mes-día. Solo se muestran las vigentes. Ejemplo:
     { "titulo": "Instalación gratis", "descripcion": "En todos los paquetes",
       "paqueteId": "plus", "precio": 499, "moneda": "MXN",
       "inicio": "2026-11-01", "fin": "2026-11-30", "condiciones": "Aplican restricciones." } */
  promociones: [],

  /* ===== BENEFICIOS (inicio) ===== */
  beneficios: [
    {
      titulo: "Compara tus opciones",
      texto:
        "Consulta el catálogo, sus condiciones y los datos pendientes de confirmar.",
    },
    {
      titulo: "Primero, tu cobertura",
      texto:
        "Indica tu localidad para solicitar la validación de disponibilidad.",
    },
    {
      titulo: "Una solicitud clara",
      texto:
        "Selecciona un paquete y revisa el mensaje antes de compartir tus datos.",
    },
  ],

  /* ===== NOSOTROS ===== */
  nosotros: {
    presentacion:
      "Presentación provisional de la empresa, pendiente de completar con información real.",
    historia: "Historia pendiente de completar por la empresa.",
    mision: "Misión pendiente de definir.",
    vision: "Visión pendiente de definir.",
    valores: "Valores pendientes de definir.",
    compromiso: "Compromiso de servicio pendiente de definir.",
  },

  /* ===== PREGUNTAS FRECUENTES =====
     Cada una: [ "pregunta", "respuesta" ] */
  preguntas: [
    [
      "¿Cómo puedo contratar?",
      "Elige un paquete y completa la solicitud. El envío es una consulta de interés, no un contrato ni una confirmación de instalación.",
    ],
    [
      "¿Cómo consulto cobertura?",
      "Busca tu dirección en el mapa de la página Cobertura o ingresa tu estado, municipio y localidad. Un técnico confirmará la disponibilidad definitiva.",
    ],
    [
      "¿Cuánto cuesta la instalación?",
      "El costo está pendiente de confirmación. Consulta las condiciones antes de contratar.",
    ],
    [
      "¿Qué velocidades ofrecen?",
      "Consulta la página Paquetes: ahí ves las velocidades y precios vigentes.",
    ],
    [
      "¿Cuáles son las condiciones del servicio?",
      "Los precios, la tecnología, las restricciones y las condiciones definitivas deben ser confirmados por la empresa.",
    ],
    [
      "¿Cómo consulto mis pagos?",
      "Entra a Mi portal con el folio de tu contrato (CTR-…) que te enviamos por WhatsApp y tu teléfono registrado. Ahí ves tus mensualidades y puedes enviar tus comprobantes.",
    ],
    [
      "¿Cómo contacto con soporte?",
      "Los canales se mostrarán cuando la empresa los configure. No se han definido horarios ni tiempos de respuesta.",
    ],
    [
      "¿Qué ocurre después de enviar una solicitud?",
      "Recibirás un folio de solicitud (SOL-…) y un asesor te contactará para validar la cobertura y la instalación.",
    ],
  ],
};
