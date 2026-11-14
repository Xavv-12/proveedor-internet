"use strict";

// Ventana de confirmación propia (reemplaza al window.confirm del navegador).
function confirmarVentana(mensaje) {
  return new Promise((resolver) => {
    const ventana = document.createElement("dialog");
    ventana.className = "confirmar-ventana";
    ventana.setAttribute("aria-labelledby", "confirmar-titulo");

    const titulo = document.createElement("h2");
    titulo.id = "confirmar-titulo";
    titulo.textContent = "Confirmar acción";

    const texto = document.createElement("p");
    texto.textContent = mensaje;

    const acciones = document.createElement("div");
    acciones.className = "confirmar-acciones";

    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "confirmar-cancelar";
    cancelar.textContent = "Cancelar";

    const aceptar = document.createElement("button");
    aceptar.type = "button";
    aceptar.className = "confirmar-aceptar";
    aceptar.textContent = "Aceptar";

    acciones.append(cancelar, aceptar);
    ventana.append(titulo, texto, acciones);
    document.body.appendChild(ventana);

    let resultado = false;
    const cerrar = (valor) => {
      resultado = valor;
      ventana.close();
    };
    aceptar.addEventListener("click", () => cerrar(true));
    cancelar.addEventListener("click", () => cerrar(false));
    // Clic fuera de la ventana = cancelar
    ventana.addEventListener("click", (e) => {
      if (e.target === ventana) cerrar(false);
    });
    // Escape cierra con resultado "false"
    ventana.addEventListener("close", () => {
      ventana.remove();
      resolver(resultado);
    });

    ventana.showModal();
    cancelar.focus(); // el foco inicia en Cancelar por seguridad
  });
}

// Confirmaciones, envío automático de filtros y bloqueo de doble envío. Sin scripts en línea (CSP).
document.addEventListener("submit", (e) => {
  const form = e.target;
  const mensaje = form.getAttribute("data-confirmar");

  // Si falta confirmar, se detiene el envío y se muestra la ventana propia.
  if (mensaje && !form.dataset.confirmado) {
    e.preventDefault();
    const enviador = e.submitter || null;
    confirmarVentana(mensaje).then((ok) => {
      if (!ok) return;
      form.dataset.confirmado = "1";
      if (enviador) form.requestSubmit(enviador);
      else form.requestSubmit();
    });
    return;
  }

  const boton = form.querySelector('button[type="submit"]');
  if (boton && form.method.toLowerCase() === "post")
    setTimeout(() => {
      boton.disabled = true;
    }, 0);
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches("[data-autoenviar]") && el.form) el.form.requestSubmit();
});

// Cierra el menú al tocar fuera de él.
document.addEventListener("click", (e) => {
  const menu = document.querySelector("details.menu[open]");
  if (menu && !menu.contains(e.target)) menu.removeAttribute("open");
});

// Si el usuario regresa con el botón Atrás, se reactivan los botones.
window.addEventListener("pageshow", () => {
  document.querySelectorAll("button[disabled]").forEach((b) => {
    b.disabled = false;
  });
  // Y se vuelve a pedir confirmación en los formularios que la requieren.
  document.querySelectorAll("form[data-confirmado]").forEach((f) => {
    delete f.dataset.confirmado;
  });
});

// ===== Tiempo real =====
// Las pantallas con data-tiempo-real="modulo1 modulo2" se actualizan solas
// (sin recargar ni perder búsquedas o filtros).
// Si estás escribiendo en un formulario de esa zona, no se toca: solo se avisa.
(() => {
  const zona = document.querySelector("[data-tiempo-real]");
  const indicador = document.querySelector("[data-en-vivo]");
  if (!indicador) return;
  const estado = (conectado) => {
    indicador.textContent = conectado ? "En vivo" : "Sin conexión";
    indicador.classList.toggle("conectado", conectado);
  };
  const escucha = (zona?.getAttribute("data-tiempo-real") || "")
    .split(/\s+/)
    .filter(Boolean);
  let espera = null;
  let folios = [];
  let modulos = new Set();

  const avisar = (texto) => {
    let caja = document.getElementById("aviso-tiempo-real");
    if (!caja) {
      caja = document.createElement("div");
      caja.id = "aviso-tiempo-real";
      caja.className = "aviso-flotante";
      caja.setAttribute("role", "status");
      document.body.appendChild(caja);
    }
    caja.textContent = texto;
    caja.classList.add("visible");
    clearTimeout(caja._t);
    caja._t = setTimeout(() => caja.classList.remove("visible"), 6000);
  };

  // ¿La persona está escribiendo algo en esta zona?
  const ocupada = (el) => {
    if (
      el.contains(document.activeElement) &&
      document.activeElement.matches("input, textarea, select")
    )
      return true;
    return [...el.querySelectorAll("input, textarea, select")].some((c) => {
      if (c.type === "hidden") return false;
      if (c.type === "checkbox" || c.type === "radio")
        return c.checked !== c.defaultChecked;
      if (c.type === "file") return c.files && c.files.length > 0;
      if (c.tagName === "SELECT")
        return [...c.options].some((o) => o.selected !== o.defaultSelected);
      return c.value !== c.defaultValue;
    });
  };

  const actualizar = async () => {
    const nuevos = folios.filter(Boolean);
    const cambiaron = [...modulos];
    folios = [];
    modulos = new Set();
    const actual = document.getElementById("zona-actualizable");
    if (!actual) return;
    // No se redibuja mientras haya una ventana de confirmación abierta.
    if (document.querySelector("dialog.confirmar-ventana[open]")) return;
    if (ocupada(actual)) {
      avisar(
        "Hay información nueva. Termina lo que estás capturando y recarga la página para verla.",
      );
      return;
    }
    try {
      const r = await fetch(window.location.href, {
        headers: { "X-Actualizacion-Auto": "1" },
        credentials: "same-origin",
        cache: "no-store",
      });
      // Si el registro que estás viendo ya se eliminó, vuelve a la lista.
      const partes = window.location.pathname.split("/").filter(Boolean);
      if (r.status === 404 && partes.length > 1) {
        window.location.replace("/" + partes[0]);
        return;
      }
      if (!r.ok || r.redirected) return; // sesión vencida: se verá al siguiente clic
      const html = new DOMParser().parseFromString(await r.text(), "text/html");
      const nueva = html.getElementById("zona-actualizable");
      if (!nueva) return;
      const textoAntes = actual.textContent;
      actual.innerHTML = nueva.innerHTML;
      if (actual.textContent === textoAntes) return; // nada visible cambió: sin aviso
      actual.querySelectorAll(".fila, tbody tr").forEach((el) => {
        if (nuevos.some((f) => el.textContent.includes(f)))
          el.classList.add("recien-llegada");
      });
      if (nuevos.length && cambiaron.includes("solicitudes")) {
        avisar(
          nuevos.length === 1
            ? `Nueva solicitud ${nuevos[0]}`
            : `${nuevos.length} solicitudes nuevas`,
        );
      } else {
        avisar("Información actualizada");
      }
    } catch {
      /* sin conexión: se intentará con el siguiente aviso */
    }
  };

  // 1) Avisos al instante (EventSource). La conexión solo se mantiene abierta mientras la
  //    pestaña está a la vista: el navegador permite pocas conexiones al mismo servidor.
  // 2) Respaldo: cada 4 segundos se pregunta al servidor cuántos cambios hay; si cambió,
  //    se actualiza aunque el aviso instantáneo no haya llegado (antivirus, proxy, etc.).
  let fuente = null;
  let base = null; // último contador conocido de los módulos que escucha esta pantalla
  const programar = (ms) => {
    clearTimeout(espera);
    espera = setTimeout(actualizar, ms);
  };
  const conectar = () => {
    if (fuente || !window.EventSource) return;
    fuente = new EventSource("/eventos");
    fuente.addEventListener("open", () => {
      estado(true);
      revisar();
    });
    fuente.addEventListener("error", () => estado(false));
    fuente.addEventListener("cambio", (e) => {
      let datos = {};
      try {
        datos = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!escucha.includes(datos.modulo)) return;
      modulos.add(datos.modulo);
      if (datos.folio) folios.push(datos.folio);
      base = null; // el respaldo vuelve a tomar referencia sin repetir la actualización
      programar(500); // agrupa avisos seguidos
    });
  };
  const desconectar = () => {
    if (!fuente) return;
    fuente.close();
    fuente = null;
    estado(false);
  };
  const revisar = async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const r = await fetch("/eventos/version", {
        headers: { "X-Actualizacion-Auto": "1" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok || r.redirected) return;
      const v = await r.json();
      const suma = escucha.reduce((t, m) => t + (v[m] || 0), 0);
      if (base === null) {
        base = suma;
        return;
      }
      if (suma !== base) {
        base = suma;
        escucha.forEach((m) => modulos.add(m));
        programar(200);
      }
    } catch {
      /* sin conexión: se intenta en la siguiente vuelta */
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      desconectar();
    } else {
      conectar();
      revisar(); // al volver, se pone al día de inmediato
    }
  });
  window.addEventListener("pagehide", desconectar);
  window.addEventListener("pageshow", () => {
    if (document.visibilityState !== "hidden") {
      conectar();
      revisar();
    }
  });
  if (document.visibilityState !== "hidden") conectar();
  revisar();
  setInterval(revisar, 4000);
})();

// ===== Avisos que se quitan solos =====
// Entran deslizándose, esperan unos segundos y salen con animación.
// Se pausan con el mouse o el teclado y se cierran con un clic.
(() => {
  const SELECTOR =
    "[data-aviso], .aviso:not(.aviso-flotante), .alerta, .flash, .mensaje-aviso";
  const ESPERA = 4500; // ms que el aviso permanece visible
  const reducido = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const animar = (el) => {
    if (el.dataset.animado) return;
    el.dataset.animado = "1";

    // Entrada
    if (!reducido) {
      el.animate(
        [
          { opacity: 0, transform: "translateY(-16px) scale(0.98)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ],
        { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }

    let reloj = null;
    let cerrado = false;

    const salir = () => {
      if (cerrado || !el.isConnected) return;
      cerrado = true;
      clearTimeout(reloj);
      if (reducido) {
        el.remove();
        return;
      }
      const cs = getComputedStyle(el);
      const alto = el.offsetHeight;
      el.style.overflow = "hidden";
      el.style.pointerEvents = "none";
      const salida = el.animate(
        [
          {
            opacity: 1,
            transform: "translateY(0)",
            height: alto + "px",
            marginTop: cs.marginTop,
            marginBottom: cs.marginBottom,
            paddingTop: cs.paddingTop,
            paddingBottom: cs.paddingBottom,
          },
          {
            opacity: 0,
            transform: "translateY(-16px)",
            height: "0px",
            marginTop: "0px",
            marginBottom: "0px",
            paddingTop: "0px",
            paddingBottom: "0px",
          },
        ],
        {
          duration: 420,
          easing: "cubic-bezier(0.4, 0, 1, 1)",
          fill: "forwards",
        },
      );
      salida.onfinish = () => el.remove();
    };

    const programar = () => {
      if (cerrado) return;
      clearTimeout(reloj);
      reloj = setTimeout(salir, ESPERA);
    };
    const pausar = () => clearTimeout(reloj);

    el.addEventListener("mouseenter", pausar);
    el.addEventListener("mouseleave", programar);
    el.addEventListener("focusin", pausar);
    el.addEventListener("focusout", programar);
    el.addEventListener("click", salir); // un clic lo cierra
    el.style.cursor = "pointer";
    el.setAttribute("title", "Clic para cerrar");

    programar();
  };

  const buscar = () => document.querySelectorAll(SELECTOR).forEach(animar);
  buscar();
  // También cuando la zona se redibuja sola (tiempo real).
  new MutationObserver(buscar).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();

// ===== Dibujar el contorno de una zona de cobertura sobre el mapa =====
// Solo se activa en formularios que tengan el campo "contornoGeojson" (Cobertura > Nueva zona).
// Llena ese campo con un GeoJSON (Polygon). Usa Leaflet: si la página no lo trae, lo carga.
(() => {
  const area = document.querySelector('textarea[name="contornoGeojson"]');
  if (!area) return;

  // Leaflet se sirve desde el propio servidor (ver src/app.js): la CSP no permite CDN externos.
  const LEAFLET_JS = "/static/vendor/leaflet/leaflet.js";
  const LEAFLET_CSS = "/static/vendor/leaflet/leaflet.css";
  const TESELAS =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const VISTA_INICIAL = { centro: [19.3, -99.45], zoom: 10 }; // si no hay contorno ni ubicación
  const COLOR = "#1b4fd8";
  const ESTILO = {
    color: COLOR,
    weight: 2,
    dashArray: "6 5",
    fillColor: COLOR,
    fillOpacity: 0.22,
  };

  // --- Lectura y escritura del GeoJSON (Polygon / MultiPolygon, con o sin Feature) ---
  const geometrias = (g) =>
    g.type === "FeatureCollection"
      ? g.features.flatMap(geometrias)
      : g.type === "Feature"
        ? g.geometry
          ? geometrias(g.geometry)
          : []
        : [g];
  const anillos = (texto) => {
    try {
      return geometrias(JSON.parse(texto))
        .flatMap((g) =>
          g.type === "Polygon"
            ? [g.coordinates]
            : g.type === "MultiPolygon"
              ? g.coordinates
              : [],
        )
        .map((p) => (p[0] || []).map(([lng, lat]) => [lat, lng]))
        .filter((r) => r.length >= 3);
    } catch {
      return [];
    }
  };
  const escribir = (puntos) => {
    const anillo = puntos.map(([lat, lng]) => [
      Math.round(lng * 1e6) / 1e6,
      Math.round(lat * 1e6) / 1e6,
    ]);
    anillo.push(anillo[0]);
    area.value = JSON.stringify({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [anillo] },
    });
    area.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // --- Piezas de la pantalla ---
  const caja = document.createElement("div");
  caja.className = "contorno-editor";
  const barra = document.createElement("div");
  barra.className = "contorno-barra";
  const boton = (texto, principal) => {
    const b = document.createElement("button");
    b.type = "button"; // nunca envía el formulario
    b.textContent = texto;
    if (principal) b.classList.add("principal");
    barra.appendChild(b);
    return b;
  };
  const empezar = boton("Dibujar contorno");
  const terminar = boton("Terminar contorno", true);
  const deshacer = boton("Deshacer punto");
  const cancelar = boton("Cancelar");
  const borrar = boton("Borrar contorno");
  terminar.hidden = deshacer.hidden = cancelar.hidden = borrar.hidden = true; // se muestran al cargar el mapa
  const lienzo = document.createElement("div");
  lienzo.className = "contorno-mapa";
  const aviso = document.createElement("p");
  aviso.className = "contorno-aviso";
  aviso.setAttribute("role", "status");
  caja.append(barra, lienzo, aviso);
  area.before(caja);

  const cargarLeaflet = () =>
    new Promise((ok, fallo) => {
      if (window.L) return ok(window.L);
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = LEAFLET_JS;
      js.onload = () => (window.L ? ok(window.L) : fallo(new Error("sin L")));
      js.onerror = () => fallo(new Error("no cargó Leaflet"));
      document.head.appendChild(js);
    });

  cargarLeaflet()
    .then((L) => {
      const mapa = L.map(lienzo, { scrollWheelZoom: false });
      L.tileLayer(TESELAS, {
        maxZoom: 19,
        attribution: "Imágenes © Esri",
      }).addTo(mapa);
      const guardado = L.layerGroup().addTo(mapa);
      const borrador = L.layerGroup().addTo(mapa);
      let dibujando = false;
      let puntos = [];

      const pintar = (ajustar) => {
        guardado.clearLayers();
        const lista = anillos(area.value);
        lista.forEach((r) => L.polygon(r, ESTILO).addTo(guardado));
        if (lista.length && ajustar) {
          mapa.fitBounds(L.featureGroup(guardado.getLayers()).getBounds(), {
            padding: [24, 24],
            maxZoom: 17,
          });
        }
        borrar.hidden = dibujando || !lista.length;
      };

      const redibujar = () => {
        borrador.clearLayers();
        if (puntos.length > 2)
          L.polygon(puntos, { ...ESTILO, dashArray: null }).addTo(borrador);
        else if (puntos.length === 2)
          L.polyline(puntos, { color: COLOR, weight: 2 }).addTo(borrador);
        puntos.forEach((p, i) =>
          L.circleMarker(p, {
            radius: i === 0 ? 7 : 4,
            color: "#fff",
            weight: 1.5,
            fillColor: COLOR,
            fillOpacity: 1,
          }).addTo(borrador),
        );
        aviso.textContent = dibujando
          ? `Toca el mapa en cada esquina de la colonia. Puntos: ${puntos.length} (mínimo 3).`
          : "";
      };

      const modo = (activo) => {
        dibujando = activo;
        puntos = [];
        empezar.hidden = activo;
        terminar.hidden = deshacer.hidden = cancelar.hidden = !activo;
        lienzo.classList.toggle("dibujando", activo);
        if (activo) mapa.doubleClickZoom.disable();
        else mapa.doubleClickZoom.enable();
        redibujar();
        pintar(false);
      };

      mapa.on("click", (e) => {
        if (!dibujando) return;
        puntos.push([e.latlng.lat, e.latlng.lng]);
        redibujar();
      });
      empezar.addEventListener("click", () => modo(true));
      cancelar.addEventListener("click", () => modo(false));
      deshacer.addEventListener("click", () => {
        puntos.pop();
        redibujar();
      });
      terminar.addEventListener("click", () => {
        if (puntos.length < 3) {
          aviso.textContent =
            "Marca al menos 3 puntos para cerrar el contorno.";
          return;
        }
        const copia = puntos.slice();
        modo(false);
        escribir(copia);
        aviso.textContent = "Contorno listo. Pulsa Guardar para aplicarlo.";
      });
      borrar.addEventListener("click", () => {
        area.value = "";
        area.dispatchEvent(new Event("input", { bubbles: true }));
        aviso.textContent =
          "Contorno borrado. Al guardar se buscará el de OpenStreetMap.";
      });
      // Si se pega o se edita el GeoJSON a mano, el mapa lo refleja.
      area.addEventListener("input", () => pintar(true));

      // Vista inicial: contorno existente > ubicación escrita > vista por defecto.
      const entrada = document.querySelector('input[name="ubicacion"]');
      const ub =
        entrada &&
        /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(entrada.value);
      mapa.setView(
        ub ? [Number(ub[1]), Number(ub[2])] : VISTA_INICIAL.centro,
        ub ? 15 : VISTA_INICIAL.zoom,
      );
      empezar.hidden = false;
      modo(false);
      pintar(true);
      setTimeout(() => mapa.invalidateSize(), 0);
    })
    .catch(() => {
      barra.hidden = true;
      lienzo.hidden = true;
      aviso.textContent =
        "No se pudo cargar el mapa. Puedes pegar el GeoJSON en el campo de abajo.";
    });
})();

// ===== Búsqueda mientras escribes =====
// En las listas con buscador, los resultados se actualizan solos al teclear: sin pulsar Buscar y sin recargar.
// Solo cambia la zona de resultados. Si algo falla, el formulario normal sigue funcionando.
(() => {
  const form = document.querySelector("form.buscador");
  const campo = form && form.querySelector('input[name="q"]');
  const zona = document.getElementById("zona-actualizable");
  if (!form || !campo || !zona || !window.fetch || !window.AbortController)
    return;

  const ESPERA = 250; // ms sin teclear antes de buscar
  let reloj = null;
  let control = null;
  let turno = 0; // para ignorar respuestas viejas que lleguen tarde

  const boton = form.querySelector('button[type="submit"]');
  if (boton) boton.style.display = "none"; // ya no hace falta: Enter también busca
  zona.setAttribute("aria-live", "polite");

  // Misma dirección que armaría el formulario: texto + filtros elegidos, sin vacíos y desde la página 1.
  const direccion = () => {
    const url = new URL(
      form.getAttribute("action") || window.location.pathname,
      window.location.origin,
    );
    for (const [clave, valor] of new FormData(form)) {
      if (typeof valor === "string" && valor.trim())
        url.searchParams.set(clave, valor.trim());
    }
    return url;
  };

  const buscar = async () => {
    const mio = ++turno;
    if (control) control.abort();
    control = new AbortController();
    const url = direccion();
    zona.setAttribute("aria-busy", "true");
    zona.style.opacity = "0.6";
    try {
      const r = await fetch(url, {
        headers: { "X-Actualizacion-Auto": "1" },
        credentials: "same-origin",
        cache: "no-store",
        signal: control.signal,
      });
      if (mio !== turno) return;
      if (!r.ok || r.redirected) {
        form.requestSubmit(); // sesión vencida u otro problema: que lo resuelva la página normal
        return;
      }
      const html = new DOMParser().parseFromString(await r.text(), "text/html");
      const nueva = html.getElementById("zona-actualizable");
      if (mio !== turno) return;
      if (!nueva) {
        form.requestSubmit();
        return;
      }
      zona.innerHTML = nueva.innerHTML;
      // La dirección queda con la búsqueda: al refrescar, al volver con Atrás y en la actualización en tiempo real.
      history.replaceState(null, "", url.pathname + url.search);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      /* sin conexión: se deja lo que ya había en pantalla */
    } finally {
      if (mio === turno) {
        zona.style.opacity = "";
        zona.removeAttribute("aria-busy");
      }
    }
  };

  const programar = () => {
    clearTimeout(reloj);
    reloj = setTimeout(buscar, ESPERA);
  };
  campo.addEventListener("input", programar);
  campo.addEventListener("search", programar); // la «x» del campo y la tecla Escape
  // Con Enter se envía el formulario normal (recarga completa): se cancela lo que estuviera pendiente.
  form.addEventListener("submit", () => {
    clearTimeout(reloj);
    if (control) control.abort();
  });
})();
