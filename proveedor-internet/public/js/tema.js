"use strict";

// Tema de colores: "suave" (por defecto, blanco apagado) u "oscuro". Se recuerda en este navegador.
// Va en el <head> y sin "defer": así el tema ya está puesto antes de que se dibuje la página y no parpadea.
(() => {
  const CLAVE = "tema-cosmos";
  const raiz = document.documentElement;
  const nombre = (v) => (v === "oscuro" ? "oscuro" : "suave");

  const leer = () => {
    try {
      return localStorage.getItem(CLAVE);
    } catch {
      return null;
    }
  };
  const guardar = (valor) => {
    try {
      localStorage.setItem(CLAVE, valor);
    } catch {
      /* sin almacenamiento: el tema dura mientras la pestaña siga abierta */
    }
  };

  const aplicar = (tema) => {
    raiz.setAttribute("data-tema", tema);
    for (const boton of document.querySelectorAll("[data-tema-alternar]")) {
      boton.setAttribute("aria-pressed", tema === "oscuro" ? "true" : "false");
      const texto = boton.querySelector("[data-tema-texto]");
      if (texto) texto.textContent = tema === "oscuro" ? "Modo suave" : "Modo oscuro";
    }
  };

  aplicar(nombre(leer()));
  // Los botones aún no existen cuando corre este script: se les pone el texto al terminar de cargar.
  document.addEventListener("DOMContentLoaded", () => aplicar(raiz.getAttribute("data-tema")));
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-tema-alternar]")) return;
    const nuevo = raiz.getAttribute("data-tema") === "oscuro" ? "suave" : "oscuro";
    guardar(nuevo);
    aplicar(nuevo);
  });
  // Si se cambia en otra pestaña, esta se pone igual.
  window.addEventListener("storage", (e) => {
    if (e.key === CLAVE) aplicar(nombre(e.newValue));
  });
})();