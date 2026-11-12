"use strict";
/* Página solicitud.html: detalles que facilitan el llenado */
(() => {
  /* Si llegan desde un paquete (solicitud.html?paquete=plus), dejarlo seleccionado */
  const lista = document.getElementById("lead-package");
  const deseado = (
    new URLSearchParams(location.search).get("paquete") || ""
  ).toLowerCase();
  if (lista && deseado) {
    const elegir = () => {
      const opcion = [...lista.options].find(
        (o) => o.value.toLowerCase() === deseado,
      );
      if (!opcion) return false;
      lista.value = opcion.value;
      return true;
    };
    if (!elegir()) {
      const observador = new MutationObserver(() => {
        if (elegir()) observador.disconnect();
      });
      observador.observe(lista, { childList: true });
    }
  }

  /* Código postal: solo números */
  const cp = document.getElementById("lead-zip");
  if (cp)
    cp.addEventListener("input", () => {
      const limpio = cp.value.replace(/\D/g, "").slice(0, 5);
      if (limpio !== cp.value) cp.value = limpio;
    });
})();
