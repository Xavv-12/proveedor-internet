"use strict";
/* =========================================================
   CATÁLOGO EN VIVO
   Conecta el sitio con la app en tiempo real:
   - Paquetes (index.html y paquetes.html) y el menú del formulario (contacto.html)
   - Promociones (promociones.html)
   - Consulta de cobertura (index.html y cobertura.html)
   Si la app no responde, se queda lo que está escrito en el HTML y en config.js.
   Requiere en config.js: api.url (ej. "http://localhost:3000/api/v1").
   ========================================================= */
(() => {
  const config = window.CONFIGURACION || {};
  const url =
    config.api && config.api.url
      ? String(config.api.url).replace(/\/$/, "")
      : "";
  if (!url) return;
  let base;
  try {
    base = new URL(url);
  } catch {
    return;
  }
  /* En tu computadora o red local (localhost, 127.x, 192.168.x, 10.x, 172.16-31.x) se permite HTTP; en internet se exige HTTPS */
  const esLocal =
    /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base.hostname);
  if (base.protocol !== "https:" && !esLocal) return;

  const esc = (t) =>
    String(t ?? "").replace(
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
  const VIÑETAS_BASE = [
    "Tecnología: Por confirmar",
    "Instalación: Consultar costo y condiciones",
  ];
  const fecha = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Mexico_City",
  });
  let planesActuales = [];

  async function pedir(ruta) {
    const r = await fetch(url + ruta, {
      credentials: "omit",
      cache: "no-store",
    });
    const datos = await r.json().catch(() => ({}));
    return { ok: r.ok && datos.success === true, datos };
  }

  /* ===================== PAQUETES ===================== */
  function tarjeta(p, i) {
    const vinetas = p.descripcion
      ? p.descripcion
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      : VIÑETAS_BASE;
    const subida = p.velocidadSubidaMbps
      ? `<li>Subida: ${esc(p.velocidadSubidaMbps)} Mbps</li>`
      : "";
    return `
      <article class="card package${i === 1 ? " featured" : ""}">
        <span class="tag">Paquete ${i + 1}</span>
        <h3>${esc(p.nombre)}</h3>
        <p class="speed">${esc(p.velocidadBajadaMbps)} <small>Mbps de descarga</small></p>
        <p class="price">${esc(p.precio)}<small> MXN / mes</small></p>
        <ul>${vinetas.map((v) => `<li>${esc(v)}</li>`).join("")}${subida}</ul>
        <div class="actions">
          <a class="button" aria-label="Contratar el paquete ${esc(p.nombre)}" href="contacto.html?paquete=${encodeURIComponent(p.clave)}#solicitud">Contratar</a>
          <a class="button secondary" aria-label="Preguntar por WhatsApp sobre el paquete ${esc(p.nombre)}" data-wa="Hola, me interesa el paquete ${esc(p.nombre)}. Quiero conocer disponibilidad y condiciones." href="contacto.html">WhatsApp</a>
        </div>
      </article>`;
  }

  /* Mantiene el menú "Paquete de interés" del formulario igual que la app */
  function actualizarMenu(planes) {
    const menu = document.querySelector('select[name="package"]');
    if (!menu) return;
    const pedido = new URLSearchParams(window.location.search).get("paquete");
    const elegido = menu.value || pedido || "";
    menu.innerHTML =
      '<option value="">Selecciona una opción</option>' +
      planes
        .map((p) => `<option value="${esc(p.clave)}">${esc(p.nombre)}</option>`)
        .join("");
    if (planes.some((p) => p.clave === elegido)) menu.value = elegido;
  }

  async function cargarPlanes() {
    try {
      const { ok, datos } = await pedir("/planes");
      if (!ok || !Array.isArray(datos.data)) return;
      const planes = datos.data;
      planesActuales = planes;
      /* El formulario de contratación revisa config.paquetes al enviar */
      const lista = Array.isArray(config.paquetes)
        ? config.paquetes
        : (config.paquetes = []);
      lista.length = 0;
      planes.forEach((p) =>
        lista.push({
          id: p.clave,
          nombre: p.nombre,
          precio: p.precioCentavos / 100,
          moneda: "MXN",
        }),
      );

      const contenedor = document.getElementById("lista-paquetes");
      if (contenedor) {
        contenedor.innerHTML = planes.length
          ? planes.map(tarjeta).join("")
          : '<p class="empty">Por ahora no hay paquetes publicados. Escríbenos para conocer las opciones.</p>';
      }
      actualizarMenu(planes);
    } catch {
      /* sin conexión con la app: se quedan las tarjetas del HTML */
    }
  }

  /* ===================== PROMOCIONES ===================== */
  async function cargarPromociones() {
    const contenedor = document.getElementById("promotions");
    if (!contenedor) return;
    try {
      const { ok, datos } = await pedir("/promociones");
      if (!ok || !Array.isArray(datos.data)) return;
      const nombre = (clave) =>
        (planesActuales.find((p) => p.clave === clave) || {}).nombre || clave;
      contenedor.innerHTML = datos.data.length
        ? datos.data
            .map((p) => {
              const vigencia = p.vigenciaFin
                ? `Vigente hasta el ${fecha.format(new Date(p.vigenciaFin))}.`
                : "Vigencia por confirmar con un asesor.";
              const aplica =
                p.planes && p.planes.length
                  ? `Aplica en: ${p.planes.map(nombre).join(", ")}.`
                  : "Aplica en todos los paquetes.";
              const destino =
                p.planes && p.planes.length === 1
                  ? `contacto.html?paquete=${encodeURIComponent(p.planes[0])}#solicitud`
                  : "contacto.html#solicitud";
              return `
            <article class="card package">
              <span class="tag">Promoción</span>
              <h3>${esc(p.titulo)}</h3>
              <p>${esc(p.descripcion)}</p>
              <p class="fine">${esc(aplica)} ${esc(vigencia)}</p>
              <div class="actions"><a class="button" href="${destino}">Solicitar</a></div>
            </article>`;
            })
            .join("")
        : '<p class="empty">Por ahora no hay promociones vigentes. Vuelve pronto o escríbenos.</p>';
    } catch {
      /* sin conexión: se queda lo que muestre config.js */
    }
  }

  /* ===================== COBERTURA ===================== */
  const formCobertura = document.getElementById("coverage-form");
  let ultimaConsulta = null;

  function mostrarCobertura(recuadro, texto, tipo, conEnlace) {
    recuadro.classList.remove("error", "success");
    if (tipo) recuadro.classList.add(tipo);
    recuadro.textContent = texto;
    if (conEnlace) {
      recuadro.append(" ");
      const a = document.createElement("a");
      a.href = "contacto.html#solicitud";
      a.textContent = "Solicitar contratación";
      recuadro.append(a);
    }
  }

  async function consultarCobertura(parametros, silencioso) {
    const recuadro = document.getElementById("coverage-result");
    if (!recuadro) return;
    if (!silencioso) mostrarCobertura(recuadro, "Consultando cobertura…");
    try {
      const { ok, datos } = await pedir(
        "/cobertura?" + new URLSearchParams(parametros),
      );
      if (!ok) {
        mostrarCobertura(
          recuadro,
          (datos && datos.error) ||
            "No pudimos consultar la cobertura. Intenta más tarde.",
          "error",
        );
        return;
      }
      const zonas = datos.data.zonas || [];
      const lugar = zonas[0]
        ? `${zonas[0].colonia}, ${zonas[0].municipio}`
        : parametros.localidad;
      if (datos.data.disponible) {
        mostrarCobertura(
          recuadro,
          `¡Buenas noticias! Tenemos servicio registrado en ${lugar}. Un asesor confirmará la disponibilidad técnica en tu domicilio.`,
          "success",
          true,
        );
      } else if (zonas.length) {
        mostrarCobertura(
          recuadro,
          `Todavía no llegamos a ${lugar}. Déjanos tus datos y te avisaremos cuando haya servicio.`,
          null,
          true,
        );
      } else {
        mostrarCobertura(
          recuadro,
          "No encontramos tu localidad en nuestro catálogo de cobertura. Un asesor puede revisarla por ti.",
          null,
          true,
        );
      }
    } catch {
      if (!silencioso)
        mostrarCobertura(
          recuadro,
          "Error de conexión. Intenta más tarde.",
          "error",
        );
    }
  }

  if (formCobertura) {
    /* Se atiende antes que el script anterior (fase de captura) para usar los datos reales de la app */
    document.addEventListener(
      "submit",
      (evento) => {
        if (evento.target !== formCobertura) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        if (!formCobertura.reportValidity()) return;
        const d = Object.fromEntries(new FormData(formCobertura));
        const parametros = {
          estado: String(d.state || "").trim(),
          municipio: String(d.municipality || "").trim(),
          localidad: String(d.locality || "").trim(),
        };
        const cp = String(d.zip || "").replace(/\D/g, "");
        if (cp) parametros.cp = cp;
        ultimaConsulta = parametros;
        consultarCobertura(parametros, false);
      },
      true,
    );
  }

  /* ===================== CARGA Y TIEMPO REAL ===================== */
  cargarPlanes().then(cargarPromociones);

  // La conexión de avisos solo se mantiene abierta mientras la pestaña está a la vista:
  // el navegador permite pocas conexiones al mismo servidor y las pestañas ocultas no deben ocuparlas.
  let fuente = null;
  let estuvoOculta = false;
  function conectar() {
    if (!window.EventSource || fuente) return;
    fuente = new EventSource(url + "/eventos");
    fuente.addEventListener("catalogo", (e) => {
      let modulo = "";
      try {
        modulo = JSON.parse(e.data).modulo;
      } catch {
        return;
      }
      // Aviso para otros scripts de la página (por ejemplo, el mapa de cobertura)
      document.dispatchEvent(
        new CustomEvent("catalogo:cambio", { detail: { modulo } }),
      );
      if (modulo === "planes") cargarPlanes().then(cargarPromociones);
      if (modulo === "promociones") cargarPromociones();
      if (modulo === "cobertura" && ultimaConsulta)
        consultarCobertura(ultimaConsulta, true);
    });
  }
  function desconectar() {
    if (!fuente) return;
    fuente.close();
    fuente = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      desconectar();
      estuvoOculta = true;
    } else {
      conectar();
      if (estuvoOculta) {
        // Al volver: se recarga lo que pudo cambiar mientras no se veía.
        estuvoOculta = false;
        cargarPlanes().then(cargarPromociones);
        document.dispatchEvent(
          new CustomEvent("catalogo:cambio", {
            detail: { modulo: "cobertura" },
          }),
        );
      }
    }
  });
  window.addEventListener("pagehide", desconectar);
  if (document.visibilityState !== "hidden") conectar();
})();