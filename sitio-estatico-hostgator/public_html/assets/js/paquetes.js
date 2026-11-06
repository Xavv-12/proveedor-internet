"use strict";
/* =========================================================
   PAQUETES Y PROMOCIONES
   1. Llena el menú "Paquete de interés" del formulario de contacto.
   2. Muestra las promociones vigentes en promociones.html.
   (Las tarjetas de paquetes se editan directo en index.html y paquetes.html)
   ========================================================= */
(() => {
  const { config, buscar, crear } = window.Sitio;
  const esDemo = config.modo === "demo";

  /* Convierte un número en precio: 399 → $399.00 */
  function formatoPrecio(cantidad, moneda) {
    try {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: moneda || "MXN",
        maximumFractionDigits: 2,
      }).format(cantidad);
    } catch {
      return String(cantidad) + " " + String(moneda || "");
    }
  }

  /* ===== 1. MENÚ "PAQUETE DE INTERÉS" (contacto.html) ===== */
  const menuPaquetes = buscar("#lead-package");
  if (menuPaquetes) {
    (config.paquetes || []).forEach((paquete) => {
      const opcion = crear(
        "option",
        paquete.nombre + (esDemo ? " (demostración)" : ""),
      );
      opcion.value = paquete.id;
      menuPaquetes.append(opcion);
    });

    /* Si llegó desde el botón "Contratar", deja ese paquete ya elegido */
    const elegido = new URLSearchParams(location.search).get("paquete");
    if ((config.paquetes || []).some((paquete) => paquete.id === elegido))
      menuPaquetes.value = elegido;
  }

  /* ===== 2. PROMOCIONES (promociones.html) ===== */
  const cajaPromociones = buscar("#promotions");
  if (!cajaPromociones) return;

  /* Fecha de hoy en formato año-mes-día */
  const ahora = new Date();
  const hoy =
    ahora.getFullYear() +
    "-" +
    String(ahora.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(ahora.getDate()).padStart(2, "0");
  const fechaValida = (fecha) => /^\d{4}-\d{2}-\d{2}$/.test(fecha || "");

  const vigentes = (config.promociones || []).filter(
    (promo) =>
      fechaValida(promo.inicio) &&
      fechaValida(promo.fin) &&
      promo.inicio <= hoy &&
      hoy <= promo.fin,
  );

  vigentes.forEach((promo) => {
    const tarjeta = crear("article", undefined, "card");
    if (esDemo)
      tarjeta.append(crear("span", "Promoción de demostración", "tag"));
    tarjeta.append(crear("h3", promo.titulo), crear("p", promo.descripcion));

    const paquete = (config.paquetes || []).find(
      (p) => p.id === promo.paqueteId,
    );
    if (paquete) tarjeta.append(crear("p", "Paquete: " + paquete.nombre));
    if (typeof promo.precio === "number")
      tarjeta.append(
        crear("p", formatoPrecio(promo.precio, promo.moneda), "price"),
      );

    tarjeta.append(
      crear("p", "Vigencia: " + promo.inicio + " al " + promo.fin, "fine"),
      crear("p", promo.condiciones || "Consultar condiciones.", "fine"),
    );

    const boton = crear("a", "Consultar promoción", "button");
    boton.href =
      "contacto.html" +
      (paquete ? "?paquete=" + encodeURIComponent(paquete.id) : "") +
      "#solicitud";
    tarjeta.append(boton);
    cajaPromociones.append(tarjeta);
  });

  if (!cajaPromociones.children.length) {
    cajaPromociones.append(
      crear(
        "p",
        "No hay promociones vigentes publicadas. Consulta el catálogo o solicita información.",
        "empty",
      ),
    );
  }
})();
