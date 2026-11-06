"use strict";
/* =========================================================
   MAPA DE COBERTURA (cobertura.html)
   - Usa GOOGLE MAPS si pones tu clave en config.js → mapa.googleKey.
     Sin clave, usa un mapa satelital gratuito (Leaflet).
   - Dibuja las zonas como contorno rojo punteado (sin relleno).
     Si una zona no trae polígono, se busca el contorno real del
     municipio en OpenStreetMap (en vez de dibujar un círculo).
   - Buscar, usar ubicación o tocar el mapa.
   ========================================================= */
(() => {
  const contenedor = document.getElementById("mapa-cobertura");
  if (!contenedor) return;

  const config = window.CONFIGURACION || {};
  const api =
    config.api && config.api.url
      ? String(config.api.url).replace(/\/$/, "")
      : "";
  const ajustes = config.mapa || {};
  const CENTRO = Array.isArray(ajustes.centro)
    ? ajustes.centro
    : [23.6, -102.5];
  const ZOOM = Number(ajustes.zoom) || 5;
  const CLAVE_GOOGLE = String(ajustes.googleKey || "").trim();
  // 👇 Cambia aquí el azul del contorno (zonas con servicio) cuando tengas tu color
  const AZUL = "#1f86ff";
  const NARANJA = "#f59e0b"; // contorno de zonas próximamente

  const PIN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">' +
    '<path d="M18 47s15-15.6 15-28A15 15 0 0 0 3 19c0 12.4 15 28 15 28z" fill="#e5383b" stroke="#fff" stroke-width="2.5"/>' +
    '<circle cx="18" cy="19" r="6" fill="#fff"/></svg>';

  const caja = document.getElementById("mapa-resultado");
  const entrada = document.getElementById("mapa-buscar");
  const btnBuscar = document.getElementById("mapa-btn-buscar");
  const btnUbicacion = document.getElementById("mapa-btn-ubicacion");

  const escapar = (t) =>
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

  const BANDERA_MX =
    '<svg class="bandera-mx" width="16" height="11" viewBox="0 0 3 2" aria-hidden="true">' +
    '<rect width="1" height="2" fill="#006847"/><rect x="1" width="1" height="2" fill="#fff"/>' +
    '<rect x="2" width="1" height="2" fill="#ce1126"/><circle cx="1.5" cy="1" r=".28" fill="#8a5a2b"/></svg>';

  const EMPRESA = (
    (document.querySelector("[data-company]") || {}).textContent ||
    "Proveedor de Internet"
  ).trim();

  let zonas = [];
  let motor = null;

  function mensaje(texto, tipo, conEnlace) {
    if (!caja) return;
    caja.classList.remove("error", "success");
    if (tipo) caja.classList.add(tipo);
    caja.textContent = texto;
    if (conEnlace) {
      caja.append(" ");
      const a = document.createElement("a");
      a.href = "contacto.html#solicitud";
      a.textContent = "Solicitar contratación";
      caja.append(a);
    }
  }

  function dentroDeArea(lat, lng, area) {
    let dentro = false;
    for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
      const [yi, xi] = area[i];
      const [yj, xj] = area[j];
      if (
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      )
        dentro = !dentro;
    }
    return dentro;
  }

  function distanciaMetros(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const rad = (g) => (g * Math.PI) / 180;
    const a =
      Math.sin(rad(lat2 - lat1) / 2) ** 2 +
      Math.cos(rad(lat1)) *
        Math.cos(rad(lat2)) *
        Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function enZona(lat, lng, z) {
    if (z.poligonos && z.poligonos.length)
      return z.poligonos.some((a) => dentroDeArea(lat, lng, a));
    return distanciaMetros(lat, lng, z.lat, z.lng) <= z.radio;
  }

  function revisar(lat, lng) {
    const dentro = zonas.filter((z) => enZona(lat, lng, z));
    const conServicio = dentro.find((z) => z.disponible);
    if (conServicio) {
      mensaje(
        `✅ ¡Buenas noticias! Esa ubicación está en nuestra zona de ${conServicio.colonia}, ${conServicio.municipio}. Un técnico confirmará la disponibilidad en tu domicilio.`,
        "success",
        true,
      );
    } else if (dentro.length) {
      mensaje(
        `⏳ Todavía no llegamos a ${dentro[0].colonia}, pero pronto. Déjanos tus datos y te avisamos.`,
        null,
        true,
      );
    } else {
      mensaje(
        "Esa ubicación está fuera de nuestras zonas registradas. Envía tus datos en el formulario y un asesor la revisará.",
        null,
        true,
      );
    }
  }

  const aviso = (z) =>
    `<strong>${escapar(z.colonia)}</strong><br>${escapar(z.municipio)}, ${escapar(z.estado)}<br>${z.disponible ? "✅ Con servicio" : "⏳ Próximamente"}`;

  const textoDireccion = (d) =>
    d
      ? [d.colonia, d.municipio, d.estado, d.cp].filter(Boolean).join(", ")
      : "";

  const globo = (texto) =>
    `<div class="mapa-globo"><strong>Ubicación seleccionada</strong>${texto ? `<span>${escapar(texto)}</span>` : ""}</div>`;

  function llenarFormulario(d) {
    if (!d) return;
    const poner = (id, valor) => {
      const el = document.getElementById(id);
      if (el && valor)
        el.value = String(valor).slice(
          0,
          Number(el.maxLength) > 0 ? el.maxLength : 120,
        );
    };
    poner("cov-state", d.estado);
    poner("cov-town", d.municipio);
    poner("cov-locality", d.colonia);
    if (/^\d{5}$/.test(String(d.cp || ""))) poner("cov-zip", d.cp);
  }

  let ultima = 0;
  async function nominatim(ruta) {
    const espera = 1100 - (Date.now() - ultima);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultima = Date.now();
    const r = await fetch(
      `https://nominatim.openstreetmap.org/${ruta}&format=jsonv2&addressdetails=1&accept-language=es`,
      { credentials: "omit" },
    );
    if (!r.ok) throw new Error("busqueda");
    return r.json();
  }

  const direccionOsm = (a) =>
    a && {
      estado: a.state,
      municipio: a.city || a.town || a.municipality || a.county || a.village,
      colonia:
        a.suburb || a.neighbourhood || a.quarter || a.village || a.hamlet,
      cp: a.postcode,
    };

  async function buscarOsm(texto) {
    const res = await nominatim(
      `search?q=${encodeURIComponent(texto)}&countrycodes=mx&limit=5`,
    );
    return res.map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lon),
      texto: r.display_name,
      direccion: direccionOsm(r.address),
    }));
  }

  async function direccionDeOsm(lat, lng) {
    const res = await nominatim(`reverse?lat=${lat}&lon=${lng}&zoom=18`);
    return direccionOsm(res && res.address);
  }

  /* ---------- Contorno real del municipio (en vez del círculo) ---------- */

  /* Convierte un GeoJSON (Polygon / MultiPolygon) al formato [[lat, lng], ...] */
  function geojsonAPoligonos(g) {
    if (!g) return [];
    const anillo = (a) => a.map(([lng, lat]) => [lat, lng]);
    if (g.type === "Polygon") return [anillo(g.coordinates[0])];
    if (g.type === "MultiPolygon")
      return g.coordinates.map((p) => anillo(p[0]));
    return [];
  }

  const contornos = {}; // guarda lo ya consultado para no repetir peticiones

  async function buscarContorno(consulta) {
    const res = await nominatim(
      `search?q=${encodeURIComponent(consulta)}&countrycodes=mx&limit=5&polygon_geojson=1`,
    );
    const r = res.find(
      (x) =>
        x.geojson &&
        (x.geojson.type === "Polygon" || x.geojson.type === "MultiPolygon") &&
        (x.category === "boundary" || x.type === "administrative"),
    );
    return r ? geojsonAPoligonos(r.geojson) : [];
  }

  /* A las zonas sin polígono (las que se dibujaban como círculo)
     les busca el contorno del municipio en OpenStreetMap. */
  async function agregarContornos(lista) {
    for (const z of lista) {
      if (z.poligonos && z.poligonos.length) continue;
      if (!z.municipio) continue;
      const intentos = [
        [z.municipio, z.estado].filter(Boolean).join(", "),
        String(z.municipio),
      ];
      for (const consulta of intentos) {
        try {
          if (!(consulta in contornos))
            contornos[consulta] = await buscarContorno(consulta);
          if (contornos[consulta].length) {
            z.poligonos = contornos[consulta];
            break;
          }
        } catch {
          /* si falla, esa zona se queda como círculo */
        }
      }
    }
  }

  async function cargarZonas() {
    if (!api) return;
    try {
      const r = await fetch(api + "/cobertura/mapa", {
        credentials: "omit",
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error("zonas");
      zonas = d.data;
      await agregarContornos(zonas);
      motor.dibujarZonas(zonas);
    } catch {
      if (!zonas.length)
        mensaje(
          "No pudimos cargar las zonas de cobertura. Revisa tu conexión e intenta de nuevo.",
          "error",
        );
    }
  }

  async function revisarPunto(lat, lng) {
    motor.marcador(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    revisar(lat, lng);
    try {
      const d = await motor.direccionDe(lat, lng);
      llenarFormulario(d);
      if (d) motor.marcador(lat, lng, textoDireccion(d));
    } catch {}
  }

  const cajaCoincidencias = document.getElementById("mapa-coincidencias");

  function elegir(r) {
    motor.marcador(r.lat, r.lng, r.texto);
    motor.centrar(r.lat, r.lng, 17);
    llenarFormulario(r.direccion);
    revisar(r.lat, r.lng);
  }

  function mostrarCoincidencias(lista) {
    if (!cajaCoincidencias) return;
    const ul = cajaCoincidencias.querySelector("ul");
    ul.innerHTML = "";
    lista.forEach((r, i) => {
      const li = document.createElement("li");
      const etiqueta = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "mapa-coincidencia";
      radio.value = String(i);
      radio.addEventListener("change", () => elegir(r));
      const texto = document.createElement("span");
      texto.textContent = r.texto || `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
      etiqueta.append(radio, texto);
      li.append(etiqueta);
      ul.append(li);
    });
    cajaCoincidencias.hidden = !lista.length;
    if (lista.length === 1) {
      ul.querySelector("input").checked = true;
      elegir(lista[0]);
    }
  }

  async function buscar() {
    const texto = (entrada.value || "").trim();
    if (texto.length < 3) {
      mensaje("Escribe tu colonia, municipio o coordenadas.", "error");
      entrada.focus();
      return;
    }
    btnBuscar.disabled = true;
    if (cajaCoincidencias) cajaCoincidencias.hidden = true;
    mensaje("");
    try {
      const c =
        /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(texto);
      if (c) {
        const lat = Number(c[1]);
        const lng = Number(c[2]);
        mostrarCoincidencias([
          {
            lat,
            lng,
            texto: `Coordenadas ${lat}, ${lng}`,
            direccion: null,
          },
        ]);
        motor
          .direccionDe(lat, lng)
          .then(llenarFormulario)
          .catch(() => {});
        return;
      }
      const lista = await motor.buscar(texto);
      if (!lista.length) {
        mensaje(
          "No encontramos esa dirección. Prueba agregando el municipio o el código postal, o toca el mapa en tu ubicación.",
          "error",
        );
        return;
      }
      mostrarCoincidencias(lista);
    } catch {
      mensaje(
        "No pudimos buscar en este momento. Intenta de nuevo o toca el mapa en tu ubicación.",
        "error",
      );
    } finally {
      btnBuscar.disabled = false;
    }
  }

  function conectarBotones() {
    btnBuscar && btnBuscar.addEventListener("click", buscar);
    entrada &&
      entrada.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          buscar();
        }
      });
    btnUbicacion &&
      btnUbicacion.addEventListener("click", () => {
        if (!navigator.geolocation) {
          mensaje(
            "Tu navegador no permite usar la ubicación. Escribe tu dirección o toca el mapa.",
            "error",
          );
          return;
        }
        btnUbicacion.disabled = true;
        mensaje("Obteniendo tu ubicación…");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            btnUbicacion.disabled = false;
            const { latitude: lat, longitude: lng } = pos.coords;
            motor.centrar(lat, lng, 17);
            revisarPunto(lat, lng);
          },
          () => {
            btnUbicacion.disabled = false;
            mensaje(
              "No pudimos obtener tu ubicación. Revisa el permiso de ubicación del navegador, escribe tu dirección o toca el mapa.",
              "error",
            );
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
        );
      });

    document.addEventListener("catalogo:cambio", (e) => {
      if (e.detail && e.detail.modulo === "cobertura") {
        cargarZonas().then(() => {
          const p = motor.posicionMarcador();
          if (p) revisar(p.lat, p.lng);
        });
      }
    });
  }

  let conectado = false;
  function iniciar(m) {
    motor = m;
    if (!conectado) conectarBotones();
    conectado = true;
    cargarZonas();
  }

  /* Botón "Capas": al tocarlo abre un menú con Estándar y Satélite */
  function crearBotonCapas(alCambiar) {
    const caja = document.createElement("div");
    caja.className = "mapa-capas-caja";

    const b = document.createElement("button");
    b.type = "button";
    b.className = "mapa-capas";
    b.title = "Cambiar capa del mapa";
    b.setAttribute("aria-haspopup", "true");
    b.setAttribute("aria-expanded", "false");
    b.innerHTML =
      '<span class="mapa-capas-vista calles"></span><span class="mapa-capas-texto">Capas</span>';

    const menu = document.createElement("div");
    menu.className = "mapa-capas-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    let satelite = true; // el mapa arranca en satélite

    const opciones = [
      { id: "estandar", texto: "Estándar", sat: false },
      { id: "satelite", texto: "Satélite", sat: true },
    ].map((o) => {
      const op = document.createElement("button");
      op.type = "button";
      op.className = "mapa-capas-opcion";
      op.setAttribute("role", "menuitemradio");
      op.innerHTML = `<span class="mapa-capas-mini ${o.id}"></span><span>${o.texto}</span>`;
      op.addEventListener("click", (e) => {
        e.stopPropagation();
        elegirCapa(o.sat);
        abrir(false);
      });
      menu.append(op);
      return { op, sat: o.sat };
    });

    function pintar() {
      // La miniatura del botón muestra la capa a la que se puede cambiar
      b.querySelector(".mapa-capas-vista").className =
        `mapa-capas-vista ${satelite ? "calles" : "satelite"}`;
      opciones.forEach(({ op, sat }) => {
        const activa = sat === satelite;
        op.classList.toggle("activa", activa);
        op.setAttribute("aria-checked", String(activa));
      });
    }

    function elegirCapa(sat) {
      if (sat === satelite) return;
      satelite = sat;
      alCambiar(sat);
      pintar();
    }

    function abrir(si) {
      menu.hidden = !si;
      b.setAttribute("aria-expanded", String(si));
    }

    b.addEventListener("click", (e) => {
      e.stopPropagation();
      abrir(menu.hidden);
    });
    document.addEventListener("click", () => abrir(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") abrir(false);
    });

    caja.append(menu, b);
    pintar();
    return caja;
  }

  /* =================== GOOGLE MAPS =================== */
  function motorGoogle() {
    const g = window.google.maps;
    const mapa = new g.Map(contenedor, {
      center: { lat: CENTRO[0], lng: CENTRO[1] },
      zoom: ZOOM,
      mapTypeId: "hybrid",
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      scaleControl: true,
      gestureHandling: "cooperative",
      clickableIcons: false,
    });

    mapa.controls[g.ControlPosition.LEFT_BOTTOM].push(
      crearBotonCapas((sat) => mapa.setMapTypeId(sat ? "hybrid" : "roadmap")),
    );

    const info = new g.InfoWindow();
    const geocoder = new g.Geocoder();
    let formas = [];
    let marcador = null;
    let ajustado = false;

    const direccionGoogle = (resultado) => {
      const comp = (tipo) =>
        (resultado.address_components.find((c) => c.types.includes(tipo)) || {})
          .long_name;
      return {
        estado: comp("administrative_area_level_1"),
        municipio: comp("locality") || comp("administrative_area_level_2"),
        colonia:
          comp("sublocality_level_1") ||
          comp("sublocality") ||
          comp("neighborhood") ||
          comp("locality"),
        cp: comp("postal_code"),
      };
    };

    const geocodificar = (peticion) =>
      new Promise((ok, mal) => {
        geocoder.geocode(
          { ...peticion, region: "mx", language: "es" },
          (res, estado) => {
            if (estado === "OK") ok(res);
            else if (estado === "ZERO_RESULTS") ok([]);
            else mal(new Error(estado));
          },
        );
      });

    mapa.addListener("click", (e) =>
      revisarPunto(e.latLng.lat(), e.latLng.lng()),
    );

    iniciar({
      dibujarZonas(lista) {
        formas.forEach((f) => f.setMap(null));
        formas = [];
        const limites = new g.LatLngBounds();
        lista.forEach((z) => {
          const color = z.disponible ? AZUL : NARANJA;
          const estilo = {
            strokeColor: color,
            strokeOpacity: 1,
            strokeWeight: 3,
            fillColor: color,
            fillOpacity: 0.2,
            map: mapa,
          };
          const nuevas =
            z.poligonos && z.poligonos.length
              ? z.poligonos.map(
                  (a) =>
                    new g.Polygon({
                      ...estilo,
                      paths: a.map(([lat, lng]) => ({ lat, lng })),
                    }),
                )
              : [
                  new g.Circle({
                    ...estilo,
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                    fillOpacity: 0.12,
                    center: { lat: z.lat, lng: z.lng },
                    radius: z.radio,
                  }),
                ];
          nuevas.forEach((f) => {
            const base = f.get("fillOpacity");
            f.addListener("mouseover", () =>
              f.setOptions({ fillOpacity: base + 0.2, strokeWeight: 4 }),
            );
            f.addListener("mouseout", () =>
              f.setOptions({ fillOpacity: base, strokeWeight: 3 }),
            );
            f.addListener("click", (e) => {
              info.setContent(aviso(z));
              info.setPosition(e.latLng);
              info.open({ map: mapa });
              revisarPunto(e.latLng.lat(), e.latLng.lng());
            });
            if (f.getBounds) limites.union(f.getBounds());
            else f.getPath().forEach((p) => limites.extend(p));
          });
          formas.push(...nuevas);
        });
        if (!ajustado && lista.length) {
          mapa.fitBounds(limites, 30);
          ajustado = true;
        }
      },

      marcador(lat, lng, texto) {
        if (marcador) marcador.setPosition({ lat, lng });
        else {
          marcador = new g.Marker({
            position: { lat, lng },
            map: mapa,
            icon: {
              url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(PIN_SVG)}`,
              scaledSize: new g.Size(36, 48),
              anchor: new g.Point(18, 46),
            },
          });
        }
        info.setContent(globo(texto));
        info.open({ map: mapa, anchor: marcador });
      },

      posicionMarcador() {
        const p = marcador && marcador.getPosition();
        return p ? { lat: p.lat(), lng: p.lng() } : null;
      },

      centrar(lat, lng, zoom) {
        mapa.setCenter({ lat, lng });
        mapa.setZoom(zoom);
      },

      async buscar(texto) {
        try {
          const res = await geocodificar({
            address: texto,
            componentRestrictions: { country: "MX" },
          });
          return res.slice(0, 5).map((r) => ({
            lat: r.geometry.location.lat(),
            lng: r.geometry.location.lng(),
            texto: r.formatted_address,
            direccion: direccionGoogle(r),
          }));
        } catch {
          return buscarOsm(texto);
        }
      },

      async direccionDe(lat, lng) {
        try {
          const res = await geocodificar({ location: { lat, lng } });
          return res.length ? direccionGoogle(res[0]) : null;
        } catch {
          return direccionDeOsm(lat, lng);
        }
      },
    });
  }

  /* =================== LEAFLET (respaldo) =================== */
  function motorLeaflet() {
    if (!window.L) return;
    const mapa = L.map(contenedor, { scrollWheelZoom: false }).setView(
      CENTRO,
      ZOOM,
    );

    mapa.attributionControl.setPrefix(
      `${BANDERA_MX}${escapar(EMPRESA)} cobertura`,
    );

    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
    const satelite = L.layerGroup([
      L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
        maxZoom: 19,
        attribution: "Imágenes &copy; Esri",
      }),
      L.tileLayer(
        `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
        { maxZoom: 19 },
      ),
      L.tileLayer(
        `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
        { maxZoom: 19 },
      ),
    ]).addTo(mapa);

    const calles = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "&copy; OpenStreetMap" },
    );

    const ControlCapas = L.Control.extend({
      options: { position: "bottomleft" },
      onAdd() {
        const b = crearBotonCapas((sat) => {
          mapa.removeLayer(sat ? calles : satelite);
          mapa.addLayer(sat ? satelite : calles);
        });
        L.DomEvent.disableClickPropagation(b);
        return b;
      },
    });
    new ControlCapas().addTo(mapa);
    L.control.scale({ position: "bottomleft", imperial: true }).addTo(mapa);

    mapa.on("click", (e) => {
      mapa.scrollWheelZoom.enable();
      revisarPunto(e.latlng.lat, e.latlng.lng);
    });

    const capa = L.layerGroup().addTo(mapa);
    let marcador = null;
    let ajustado = false;

    if (window.ResizeObserver)
      new ResizeObserver(() => mapa.invalidateSize()).observe(contenedor);

    iniciar({
      dibujarZonas(lista) {
        capa.clearLayers();
        lista.forEach((z) => {
          const color = z.disponible ? AZUL : NARANJA;
          // Solo contorno punteado, sin relleno (como en Google Maps)
          const estilo = {
            color,
            weight: 3,
            opacity: 0.95,
            dashArray: "2 7",
            lineCap: "round",
            lineJoin: "round",
            fillColor: color,
            fillOpacity: 0.2, // relleno azul clarito siempre visible
          };
          const formas =
            z.poligonos && z.poligonos.length
              ? z.poligonos.map((a) => L.polygon(a, estilo))
              : [
                  L.circle([z.lat, z.lng], {
                    ...estilo,
                    radius: z.radio,
                    dashArray: "8 8",
                    fillOpacity: 0.12,
                  }),
                ];
          formas.forEach((f) => {
            const base = f.options.fillOpacity;
            f.bindTooltip(
              `${escapar(z.colonia)} · ${z.disponible ? "Con servicio" : "Próximamente"}`,
              { sticky: true, direction: "top", className: "mapa-tooltip" },
            );
            f.on("mouseover", () =>
              f.setStyle({ fillOpacity: base + 0.12, weight: 4 }),
            );
            f.on("mouseout", () =>
              f.setStyle({ fillOpacity: base, weight: 3 }),
            );
            f.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              revisarPunto(e.latlng.lat, e.latlng.lng);
            });
            f.addTo(capa);
          });
        });
        if (!ajustado && lista.length) {
          mapa.invalidateSize();
          mapa.fitBounds(L.featureGroup(capa.getLayers()).getBounds(), {
            padding: [30, 30],
            maxZoom: 14,
          });
          ajustado = true;
        }
      },

      marcador(lat, lng, texto) {
        if (marcador) marcador.setLatLng([lat, lng]);
        else {
          const icono = L.divIcon({
            className: "mapa-pin",
            html: `<span class="mapa-pin-pulso"></span>${PIN_SVG}`,
            iconSize: [36, 48],
            iconAnchor: [18, 46],
          });
          marcador = L.marker([lat, lng], {
            icon: icono,
            keyboard: false,
          }).addTo(mapa);
          marcador.bindPopup("", {
            offset: [0, -40],
            maxWidth: 320,
            className: "mapa-globo-leaflet",
          });
        }
        marcador.setPopupContent(globo(texto)).openPopup();
      },

      posicionMarcador() {
        return marcador ? marcador.getLatLng() : null;
      },

      centrar(lat, lng, zoom) {
        mapa.invalidateSize();
        mapa.setView([lat, lng], zoom);
      },

      buscar: buscarOsm,
      direccionDe: direccionDeOsm,
    });
  }

  /* =================== ARRANQUE =================== */
  if (CLAVE_GOOGLE) {
    const nombre = `iniciarMapaCobertura${Date.now()}`;
    window[nombre] = () => {
      delete window[nombre];
      motorGoogle();
    };
    window.gm_authFailure = () => {
      contenedor.innerHTML = "";
      contenedor.className = "";
      motorLeaflet();
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CLAVE_GOOGLE)}&v=weekly&language=es&region=MX&loading=async&callback=${nombre}`;
    s.async = true;
    s.onerror = () => motorLeaflet();
    document.head.appendChild(s);
  } else {
    motorLeaflet();
  }
})();
