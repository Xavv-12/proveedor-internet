"use strict";
/* =========================================================
   FUNCIONES GENERALES DEL SITIO
   Encabezado, menú del celular, WhatsApp, ventana de mensaje, nombre de la empresa,
   beneficios, preguntas frecuentes, "Nosotros" y datos de contacto.
   ========================================================= */
window.Sitio = (() => {
  const config = window.CONFIGURACION;

  /* ----- Atajos para buscar elementos en la página ----- */
  const buscar = (selector, dentroDe = document) =>
    dentroDe.querySelector(selector);
  const buscarTodos = (selector, dentroDe = document) => [
    ...dentroDe.querySelectorAll(selector),
  ];

  /* Crea una etiqueta HTML con texto y clase */
  function crear(etiqueta, texto, clase) {
    const elemento = document.createElement(etiqueta);
    if (texto !== undefined) elemento.textContent = texto;
    if (clase) elemento.className = clase;
    return elemento;
  }

  /* Muestra un mensaje en los recuadros de resultado (verde/rojo) */
  function mostrarResultado(recuadro, texto, esError = false) {
    recuadro.textContent = texto;
    recuadro.className = "result" + (esError ? " error" : "");
  }

  /* Revisa que el número de WhatsApp sea válido (solo números, 8 a 15 dígitos) */
  function numeroWhatsApp() {
    const numero = String(config.whatsapp || "").replace(/\D/g, "");
    return /^[1-9]\d{7,14}$/.test(numero) ? numero : "";
  }

  /* Abre la ventanita con el mensaje para copiar */
  function mostrarVentana(mensaje, aviso) {
    const ventana = buscar("#message-dialog");
    buscar("#message-text").value = mensaje;
    buscar("#message-info").textContent = aviso;
    buscar("#copy-status").textContent = "";
    if (!ventana.open) ventana.showModal();
  }

  /* Abre WhatsApp con el mensaje. Si no hay número, muestra la ventanita */
  function enviarWhatsApp(mensaje) {
    const numero = numeroWhatsApp();
    if (!numero) {
      mostrarVentana(
        mensaje,
        "WhatsApp pendiente de configurar. Puedes copiar el mensaje; no se ha enviado ni registrado ninguna solicitud.",
      );
      return false;
    }
    const enlace = crear("a");
    enlace.href =
      "https://wa.me/" + numero + "?text=" + encodeURIComponent(mensaje);
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    return true;
  }

  /* Acepta solo direcciones web seguras (https) */
  function direccionSegura(valor) {
    try {
      const url = new URL(valor);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  /* ===== ENCABEZADO (se dibuja igual en todas las páginas) ===== */
  function enlace(texto, href, clase) {
    const a = crear("a", texto, clase);
    a.href = href;
    return a;
  }

  function dibujarEncabezado() {
    const cabecera = buscar("header.encabezado");
    if (!cabecera) return;

    /* Barra superior */
    const telefono = String(config.telefono || "").replace(/[^\d+]/g, "");
    const enlaces = crear("div", undefined, "enlaces");
    enlaces.append(enlace("Ayuda", "contacto.html"));
    if (telefono) enlaces.append(enlace(config.telefono, "tel:" + telefono));
    const wa = enlace("WhatsApp", "contacto.html");
    wa.dataset.wa = "Hola, quiero información sobre los paquetes de internet";
    enlaces.append(wa);

    const filaSuperior = crear(
      "div",
      undefined,
      "contenedor barra-superior-fila",
    );
    filaSuperior.append(
      crear("span", "Internet para hogares y negocios", "barra-superior-lema"),
      enlaces,
    );
    const barraSuperior = crear("div", undefined, "barra-superior");
    barraSuperior.append(filaSuperior);

    /* Barra principal */
    const marca = enlace("", "index.html", "brand");
    const nombre = crear("span");
    nombre.dataset.company = "";
    nombre.textContent = config.nombreEmpresa || "Proveedor de internet";
    marca.append(nombre);

    const boton = crear("button", undefined, "menu-toggle");
    boton.type = "button";
    boton.setAttribute("aria-expanded", "false");
    boton.setAttribute("aria-controls", "nav");
    boton.setAttribute("aria-label", "Abrir menú");
    for (let i = 0; i < 3; i++) boton.append(crear("span"));

    const menu = crear("nav", undefined, "nav");
    menu.id = "nav";
    menu.setAttribute("aria-label", "Principal");
    [
      ["Paquetes", "paquetes.html"],
      ["Cobertura", "cobertura.html"],
      ["Promociones", "promociones.html"],
      ["Nosotros", "nosotros.html"],
      ["Contacto", "contacto.html"],
    ].forEach(([texto, href]) => menu.append(enlace(texto, href)));

    const acciones = crear("div", undefined, "nav-acciones");
    acciones.append(
      enlace("Mi portal", "portal.html", "button secondary"),
      enlace("Contratar", "contacto.html#solicitud", "button"),
    );
    menu.append(acciones);

    const fila = crear("div", undefined, "contenedor encabezado-fila");
    fila.append(marca, boton, menu);

    const fondo = crear("div", undefined, "nav-fondo");
    fondo.setAttribute("aria-hidden", "true");

    cabecera.replaceChildren(barraSuperior, fila, fondo);
  }

  dibujarEncabezado();

  /* ===== MENÚ DEL CELULAR (panel lateral) ===== */
  const cabecera = buscar("header.encabezado");
  const menu = buscar("#nav");
  const botonMenu = buscar(".menu-toggle");
  const fondoMenu = buscar(".nav-fondo");

  function abrirMenu() {
    menu.classList.add("open");
    fondoMenu.classList.add("visible");
    document.documentElement.classList.add("menu-abierto");
    botonMenu.setAttribute("aria-expanded", "true");
    botonMenu.setAttribute("aria-label", "Cerrar menú");
  }
  function cerrarMenu() {
    menu.classList.remove("open");
    fondoMenu.classList.remove("visible");
    document.documentElement.classList.remove("menu-abierto");
    botonMenu.setAttribute("aria-expanded", "false");
    botonMenu.setAttribute("aria-label", "Abrir menú");
  }

  botonMenu.addEventListener("click", () => {
    if (menu.classList.contains("open")) cerrarMenu();
    else abrirMenu();
  });
  fondoMenu.addEventListener("click", cerrarMenu);
  menu.addEventListener("click", (evento) => {
    if (evento.target.closest("a")) cerrarMenu();
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && menu.classList.contains("open")) {
      cerrarMenu();
      botonMenu.focus();
    }
  });
  /* Si se agranda la ventana, el panel se cierra solo */
  window.addEventListener("resize", () => {
    if (window.innerWidth > 980 && menu.classList.contains("open"))
      cerrarMenu();
  });

  /* Sombra del encabezado al hacer scroll */
  const sombra = () =>
    cabecera.classList.toggle("con-sombra", window.scrollY > 4);
  window.addEventListener("scroll", sombra, { passive: true });
  sombra();

  /* Resalta en el menú la página donde estás */
  const paginaActual = location.pathname.split("/").pop() || "index.html";
  buscarTodos("a", menu).forEach((enlace) => {
    if (enlace.getAttribute("href") === paginaActual)
      enlace.setAttribute("aria-current", "page");
  });

  /* ===== NOMBRE Y LOGO DE LA EMPRESA ===== */
  buscarTodos("[data-company]").forEach((elemento) => {
    elemento.textContent = config.nombreEmpresa || "Proveedor de internet";
  });

  const logo = String(config.logo || "");
  if (
    logo &&
    /^assets\/img\/[\w./-]+\.(svg|png|webp|jpe?g)$/i.test(logo) &&
    !logo.includes("..")
  ) {
    const marca = buscar(".brand");
    const imagen = crear("img");
    imagen.src = logo;
    imagen.alt = config.nombreEmpresa || "Empresa";
    marca.replaceChildren(imagen);
  }

  /* ===== BOTONES DE WHATSAPP (los que tienen data-wa) ===== */
  buscarTodos("[data-wa]").forEach((boton) => {
    const numero = numeroWhatsApp();
    if (numero) {
      boton.href =
        "https://wa.me/" +
        numero +
        "?text=" +
        encodeURIComponent(boton.dataset.wa);
      boton.target = "_blank";
      boton.rel = "noopener noreferrer";
    } else {
      boton.addEventListener("click", (evento) => {
        evento.preventDefault();
        enviarWhatsApp(boton.dataset.wa);
      });
      boton.title = "WhatsApp pendiente de configurar";
    }
  });

  /* ===== VENTANA DE MENSAJE: cerrar y copiar ===== */
  buscar("#close-message").addEventListener("click", () => {
    buscar("#message-dialog").close();
    buscar("#message-text").value = "";
  });
  buscar("#message-dialog").addEventListener("close", () => {
    buscar("#message-text").value = "";
  });
  buscar("#copy-message").addEventListener("click", async () => {
    const campo = buscar("#message-text");
    const estado = buscar("#copy-status");
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(campo.value);
        estado.textContent = "Mensaje copiado. No se ha enviado.";
      } else {
        campo.focus();
        campo.select();
        estado.textContent =
          "Mensaje seleccionado. Usa Copiar en tu dispositivo. No se ha enviado.";
      }
    } catch {
      campo.focus();
      campo.select();
      estado.textContent =
        "Selecciona y copia el mensaje manualmente. No se ha enviado.";
    }
  });

  /* ===== BENEFICIOS (inicio) ===== */
  const cajaBeneficios = buscar("#benefits");
  if (cajaBeneficios) {
    (config.beneficios || []).forEach((beneficio, numero) => {
      const tarjeta = crear("article", undefined, "card");
      const icono = crear("span", ["↔", "⌖", "✓"][numero % 3], "icon");
      icono.setAttribute("aria-hidden", "true");
      tarjeta.append(
        icono,
        crear("h3", beneficio.titulo),
        crear("p", beneficio.texto, "muted"),
      );
      cajaBeneficios.append(tarjeta);
    });
  }

  /* ===== PREGUNTAS FRECUENTES ===== */
  const cajaPreguntas = buscar("#faq");
  if (cajaPreguntas) {
    (config.preguntas || []).forEach(([pregunta, respuesta]) => {
      const bloque = crear("details");
      bloque.append(crear("summary", pregunta), crear("p", respuesta));
      cajaPreguntas.append(bloque);
    });
  }

  /* ===== NOSOTROS ===== */
  const cajaNosotros = buscar("#about");
  if (cajaNosotros) {
    const apartados = [
      ["presentacion", "Presentación"],
      ["historia", "Nuestra historia"],
      ["mision", "Misión"],
      ["vision", "Visión"],
      ["valores", "Valores"],
      ["compromiso", "Compromiso con el servicio"],
    ];
    apartados.forEach(([clave, titulo]) => {
      cajaNosotros.append(
        crear("h2", titulo),
        crear("p", (config.nosotros || {})[clave] || "Pendiente de completar."),
      );
    });
  }

  /* ===== DATOS DE CONTACTO ===== */
  const cajaContacto = buscar("#contact-details");
  if (cajaContacto) {
    let cantidad = 0;
    const datos = [
      ["telefono", "Teléfono"],
      ["correo", "Correo"],
      ["horario", "Horario"],
      ["direccion", "Ubicación"],
    ];
    datos.forEach(([clave, etiqueta]) => {
      if (config[clave]) {
        const parrafo = crear("p");
        parrafo.append(
          crear("strong", etiqueta + ": "),
          document.createTextNode(config[clave]),
        );
        cajaContacto.append(parrafo);
        cantidad++;
      }
    });
    if (!cantidad)
      cajaContacto.append(
        crear(
          "p",
          "La empresa aún no ha configurado sus canales de contacto.",
          "notice",
        ),
      );

    (config.redesSociales || []).forEach((red) => {
      const url = direccionSegura(red.url);
      if (url) {
        const enlace = crear("a", red.nombre || "Red social");
        enlace.href = url;
        enlace.rel = "noopener noreferrer";
        enlace.target = "_blank";
        const parrafo = crear("p");
        parrafo.append(enlace);
        cajaContacto.append(parrafo);
      }
    });
  }

  /* ===== DIRECCIÓN OFICIAL DE LA PÁGINA (para Google) ===== */
  const sitio = direccionSegura(config.urlSitio);
  if (sitio) {
    const canonica = crear("link");
    canonica.rel = "canonical";
    canonica.href = sitio.replace(/\/$/, "") + "/" + paginaActual;
    document.head.append(canonica);
    const metaUrl = crear("meta");
    metaUrl.setAttribute("property", "og:url");
    metaUrl.content = canonica.href;
    document.head.append(metaUrl);
  }

  /* Lo que usan los demás archivos JS */
  return {
    config,
    buscar,
    buscarTodos,
    crear,
    mostrarResultado,
    enviarWhatsApp,
    direccionSegura,
  };
})();
