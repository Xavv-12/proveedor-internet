/* ===== ANIMACIONES AL HACER SCROLL (COSMOS) =====
   Archivo: assets/js/animaciones.js
   - Los bloques aparecen deslizándose cuando entran en pantalla.
   - Si la persona activó "reducir movimiento", no se anima nada.
   - Si el navegador es muy viejo, todo se ve normal sin animación.
   - También anima los paquetes y preguntas que llegan en vivo desde la app. */
(function () {
  "use strict";

  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  document.documentElement.classList.add("anim");

  // Qué se anima y desde dónde.
  const REGLAS = [
    { sel: ".ref-hero-texto > *", dir: "arriba", escalonar: true },
    { sel: ".ref-mini-planes > *", dir: "arriba", escalonar: true },
    { sel: ".seccion-titulo", dir: "arriba" },
    { sel: ".cuadricula > .package", dir: "arriba", escalonar: true },
    { sel: ".ref-dos > :first-child", dir: "izquierda" },
    { sel: ".ref-dos > :last-child", dir: "derecha" },
    { sel: ".ref-beneficios-lista > div", dir: "arriba", escalonar: true },
    { sel: "#faq > details", dir: "arriba", escalonar: true },
    { sel: ".pie-columnas > *", dir: "arriba", escalonar: true },
    { sel: ".cabecera-pagina .contenedor > *", dir: "arriba", escalonar: true },
    {
      sel: ".sol-form, .sol-tarjeta, .form-compacto",
      dir: "arriba",
      escalonar: true,
    },
  ];

  const CLASE_DIR = {
    arriba: "",
    izquierda: "desde-izq",
    derecha: "desde-der",
  };

  const observador = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("visible");
        observador.unobserve(e.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );

  // Al terminar la animación se quitan las clases,
  // para que el efecto de "levantarse" al pasar el mouse siga funcionando.
  function limpiar(ev) {
    const el = ev.currentTarget;
    if (ev.target !== el || ev.propertyName !== "opacity") return;
    el.classList.remove("animar", "visible", "desde-izq", "desde-der");
    el.style.removeProperty("--retraso");
    el.removeEventListener("transitionend", limpiar);
  }

  function preparar(raiz) {
    for (const regla of REGLAS) {
      const elementos = raiz.querySelectorAll(regla.sel);
      let i = 0;
      for (const el of elementos) {
        if (el.dataset.animado || el.hidden || el.closest("[hidden]")) continue;
        el.dataset.animado = "1";
        el.classList.add("animar");
        if (CLASE_DIR[regla.dir]) el.classList.add(CLASE_DIR[regla.dir]);
        if (regla.escalonar) {
          el.style.setProperty("--retraso", `${(i % 6) * 0.08}s`);
          i += 1;
        }
        el.addEventListener("transitionend", limpiar);
        observador.observe(el);
      }
    }
  }

  function iniciar() {
    preparar(document);

    // Paquetes, mini planes y preguntas se llenan desde la app: animarlos cuando lleguen.
    const vivos = ["#lista-paquetes", "#ref-mini-planes", "#faq", "#benefits"];
    const mutaciones = new MutationObserver((cambios) => {
      for (const c of cambios) {
        if (c.target instanceof Element)
          preparar(c.target.parentElement || c.target);
      }
    });
    for (const sel of vivos) {
      const caja = document.querySelector(sel);
      if (caja) mutaciones.observe(caja, { childList: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
