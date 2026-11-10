"use strict";

/*
 * Cambio de tema: "suave" (por defecto) u "oscuro".
 * Se recuerda en este navegador. Se carga en el <head>, sin "defer",
 * para que el tema se aplique antes de dibujar la página y no parpadee.
 */
(() => {
  const CLAVE = "tema-cosmos";
  const TEMAS = ["suave", "oscuro"];
  const raiz = document.documentElement;

  const textos = {
    suave: { boton: "Modo oscuro", etiqueta: "Activar modo oscuro" },
    oscuro: { boton: "Modo suave", etiqueta: "Activar modo suave" },
  };

  const validar = (valor) => (TEMAS.includes(valor) ? valor : "suave");

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
      // Sin almacenamiento disponible: el tema dura solo mientras la pestaña esté abierta.
    }
  };

  const pintarBotones = (tema) => {
    const info = textos[tema];
    for (const boton of document.querySelectorAll("[data-tema-alternar]")) {
      boton.setAttribute("aria-pressed", tema === "oscuro" ? "true" : "false");
      boton.setAttribute("aria-label", info.etiqueta);
      const texto = boton.querySelector("[data-tema-texto]");
      if (texto) texto.textContent = info.boton;
    }
  };

  const aplicar = (tema) => {
    const valido = validar(tema);
    raiz.setAttribute("data-tema", valido);
    pintarBotones(valido);
  };

  // Aplica el tema guardado de inmediato (los botones aún no existen).
  aplicar(leer());

  // Cuando la página termina de cargar, se ponen los textos de los botones.
  document.addEventListener("DOMContentLoaded", () => {
    pintarBotones(validar(raiz.getAttribute("data-tema")));
  });

  // Un solo escuchador para todos los botones de tema (también los que se agreguen después).
  document.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-tema-alternar]");
    if (!boton) return;
    const nuevo =
      raiz.getAttribute("data-tema") === "oscuro" ? "suave" : "oscuro";
    guardar(nuevo);
    aplicar(nuevo);
  });

  // Si el tema cambia en otra pestaña, esta se actualiza igual.
  window.addEventListener("storage", (evento) => {
    if (evento.key === CLAVE) aplicar(evento.newValue);
  });
})();
