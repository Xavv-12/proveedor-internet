"use strict";
/* =========================================================
   AVISOS DEL SITIO
   1) Recuadros con data-auto-ocultar="6": el mensaje de éxito se quita solo
      a los 6 segundos (un clic lo cierra antes; el mouse encima lo pausa).
      Los mensajes de error se quedan hasta que la persona corrija los datos.
   2) Recuadros con data-al-exito="index.html": al registrarse la solicitud,
      se regresa a esa página y ahí se muestra un aviso con el folio.
   ========================================================= */
(() => {
  const reducido = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const CLAVE = "aviso-sitio";

  /* ---------- Aviso flotante (por ejemplo, al llegar a index.html) ---------- */
  function avisoFlotante(texto) {
    const caja = document.createElement("div");
    caja.className = "aviso-sitio";
    caja.setAttribute("role", "status");
    caja.textContent = texto;
    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.className = "aviso-sitio-cerrar";
    cerrar.setAttribute("aria-label", "Cerrar aviso");
    cerrar.textContent = "×";
    caja.append(cerrar);
    document.body.append(caja);
    const quitar = () => {
      caja.classList.add("saliendo");
      setTimeout(() => caja.remove(), reducido ? 0 : 400);
    };
    cerrar.addEventListener("click", quitar);
    setTimeout(quitar, 9000);
  }
  try {
    const pendiente = sessionStorage.getItem(CLAVE);
    if (pendiente) {
      sessionStorage.removeItem(CLAVE);
      avisoFlotante(pendiente);
    }
  } catch {
    /* sin almacenamiento: no pasa nada */
  }

  /* ---------- Recuadros de resultado ---------- */
  function preparar(caja) {
    const segundos = Number(caja.dataset.autoOcultar) || 6;
    const destino = caja.dataset.alExito || "";
    let reloj = null;
    let ultimoTexto = "";

    const quitarClase = (c) => {
      // Solo se toca la clase si de verdad está (evita avisos repetidos del observador).
      if (caja.classList.contains(c)) caja.classList.remove(c);
    };

    const ocultar = () => {
      clearTimeout(reloj);
      if (!caja.textContent.trim()) return;
      const limpiar = () => {
        ultimoTexto = "";
        caja.textContent = "";
        quitarClase("success");
        quitarClase("error");
        quitarClase("saliendo");
      };
      if (reducido) return limpiar();
      caja.classList.add("saliendo");
      setTimeout(limpiar, 400);
      return undefined;
    };

    const alCambiar = () => {
      const texto = caja.textContent.trim();
      if (texto === ultimoTexto) return; // nada nuevo: no se reprograma
      ultimoTexto = texto;
      clearTimeout(reloj);
      if (!texto || !caja.classList.contains("success")) return;

      // Solicitud registrada: se regresa a la página principal con el folio.
      if (destino) {
        const folio = (texto.match(/SOL-\d{4}-\d{5}/) || [])[0];
        try {
          sessionStorage.setItem(
            CLAVE,
            folio
              ? `Recibimos tu solicitud ${folio}. Un asesor te contactará pronto. Cuando contrates te enviaremos por WhatsApp tu folio de contrato para entrar a Mi portal.`
              : "Recibimos tu solicitud. Un asesor te contactará pronto.",
          );
        } catch {
          /* sin almacenamiento: solo se redirige */
        }
        reloj = setTimeout(() => window.location.assign(destino), 2500);
        return;
      }
      reloj = setTimeout(ocultar, segundos * 1000);
    };

    // Revisa solo cuando cambia el texto del recuadro (no sus clases): sin ciclos.
    new MutationObserver(alCambiar).observe(caja, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    caja.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (caja.classList.contains("success") && !destino) ocultar();
    });
    caja.addEventListener("mouseenter", () => {
      if (!destino) clearTimeout(reloj);
    });
    caja.addEventListener("mouseleave", () => {
      if (
        !destino &&
        caja.classList.contains("success") &&
        caja.textContent.trim()
      ) {
        clearTimeout(reloj);
        reloj = setTimeout(ocultar, segundos * 1000);
      }
    });
  }

  document
    .querySelectorAll("[data-auto-ocultar], [data-al-exito]")
    .forEach(preparar);
})();
