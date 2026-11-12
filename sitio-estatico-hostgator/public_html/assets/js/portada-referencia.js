"use strict";
(() => {
  const origen = document.getElementById("lista-paquetes");
  const destino = document.getElementById("ref-mini-planes");
  if (!origen) return;

  // Los únicos tres renglones que se muestran en cada paquete
  const DETALLES = [
    "Información comercial de demostración",
    "Tecnología: Por confirmar",
    "Instalación: Consultar costo y condiciones",
  ];

  function crearLista() {
    return DETALLES.map((texto) => {
      const li = document.createElement("li");
      li.textContent = texto;
      return li;
    });
  }

  // Deja cada tarjeta con exactamente esos tres renglones
  function fijarDetalles(tarjeta) {
    let ul = tarjeta.querySelector("ul");
    if (!ul) {
      ul = document.createElement("ul");
      const precio = tarjeta.querySelector(".price");
      if (precio) precio.after(ul);
      else tarjeta.append(ul);
    }
    const actual = [...ul.children].map((li) => li.textContent.trim());
    if (actual.join("|") === DETALLES.join("|")) return; // ya está bien
    ul.replaceChildren(...crearLista());
  }

  function actualizar() {
    const tarjetas = [...origen.querySelectorAll(".package")];
    tarjetas.forEach(fijarDetalles);

    if (!destino) return;
    destino.replaceChildren();
    tarjetas.slice(0, 3).forEach((tarjeta, indice) => {
      const mini = document.createElement("article");
      mini.className = "ref-mini" + (indice === 1 ? " ref-mini-destacada" : "");

      const nombre = document.createElement("strong");
      nombre.className = "ref-mini-nombre";
      nombre.textContent =
        tarjeta.querySelector("h3")?.textContent || "Paquete";

      const velocidad = document.createElement("p");
      velocidad.className = "ref-mini-velocidad";
      velocidad.textContent =
        tarjeta
          .querySelector(".speed")
          ?.textContent.trim()
          .replace(/\s+/g, " ") || "";

      const precio = document.createElement("p");
      precio.className = "ref-mini-precio";
      precio.textContent =
        tarjeta
          .querySelector(".price")
          ?.textContent.trim()
          .replace(/\s+/g, " ") || "";

      const lista = document.createElement("ul");
      lista.append(...crearLista());

      const enlace = document.createElement("a");
      enlace.className = "button";
      enlace.textContent = "Seleccionar";
      enlace.href =
        tarjeta.querySelector(".actions a")?.getAttribute("href") ||
        "paquetes.html";

      mini.append(nombre, velocidad, precio, lista, enlace);
      destino.append(mini);
    });
  }

  actualizar();
  // Cuando la app carga los paquetes en vivo, se vuelven a fijar los tres renglones
  new MutationObserver(actualizar).observe(origen, {
    childList: true,
    subtree: true,
    characterData: true,
  });
})();

/* ===== Logo COSMOS en el encabezado =====
   Otro script vuelve a armar el encabezado y le pone la ruta del logo viejo.
   Esto lo regresa siempre al logo de COSMOS. */
(() => {
  const LOGO = "assets/img/logo-cosmos.png";
  function fijarLogo() {
    document.querySelectorAll(".encabezado .brand").forEach((marca) => {
      let img = marca.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        marca.prepend(img);
      }
      if (img.getAttribute("src") !== LOGO) img.setAttribute("src", LOGO);
      if (img.getAttribute("alt") !== "COSMOS")
        img.setAttribute("alt", "COSMOS");
    });
  }
  fijarLogo();
  const encabezado = document.querySelector(".encabezado");
  if (encabezado) {
    new MutationObserver(fijarLogo).observe(encabezado, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }
})();

/* ===== Botón "Mi portal" (iniciar sesión) en el encabezado =====
   El menú lo vuelve a armar main.js y no incluye "Mi portal";
   esto lo agrega junto a "Contratar Ahora". */
(() => {
  const encabezado = document.querySelector(".encabezado");
  if (!encabezado) return;

  function agregarPortal() {
    if (encabezado.querySelector(".portal-acceso")) return;
    const boton = document.createElement("a");
    boton.className = "button secondary portal-acceso";
    boton.href = "portal.html";
    boton.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>Mi portal';

    const acciones = encabezado.querySelector(".nav-acciones");
    const nav = encabezado.querySelector(".nav");
    if (acciones) acciones.prepend(boton);
    else if (nav) nav.append(boton);
    else return;

    /* Si el menú ya tenía un enlace de texto a portal.html, se quita para no repetirlo */
    encabezado
      .querySelectorAll('.nav a[href$="portal.html"]:not(.portal-acceso)')
      .forEach((a) => a.remove());
  }

  agregarPortal();
  new MutationObserver(agregarPortal).observe(encabezado, {
    childList: true,
    subtree: true,
  });
})();
