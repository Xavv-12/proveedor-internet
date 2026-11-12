"use strict";
/* =========================================================
   FORMULARIO DE CONTACTO SENCILLO (index.html)
   Prepara el mensaje y lo abre en WhatsApp.
   La solicitud de contratación va aparte, en solicitud.html.
   ========================================================= */
(() => {
  const formulario = document.getElementById("contacto-form");
  if (!formulario) return;

  const sitio = window.Sitio || {};
  const recuadro = document.getElementById("contacto-resultado");
  const campoTelefono = formulario.elements.namedItem("phone");

  const mostrar = (texto, esError) => {
    if (typeof sitio.mostrarResultado === "function") {
      sitio.mostrarResultado(recuadro, texto, esError);
    } else {
      recuadro.textContent = texto;
      recuadro.classList.toggle("error", Boolean(esError));
    }
  };

  campoTelefono.addEventListener("input", () =>
    campoTelefono.setCustomValidity(""),
  );
  formulario.noValidate = true;

  formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const datos = Object.fromEntries(new FormData(formulario));

    const telefono = String(datos.phone || "").replace(/\D/g, "");
    campoTelefono.setCustomValidity(
      /^\d{10}$/.test(telefono) ? "" : "Ingresa un teléfono de 10 dígitos.",
    );
    if (!formulario.reportValidity()) {
      mostrar(
        "Revisa los campos señalados y acepta el aviso de privacidad.",
        true,
      );
      return;
    }
    /* Campo trampa contra robots */
    if (datos.website) {
      mostrar("No se pudo procesar el mensaje.", true);
      return;
    }

    const lineas = [
      "Hola, les escribo desde el sitio web.",
      "Nombre: " + String(datos.name).trim(),
      "Teléfono: " + telefono,
    ];
    if (String(datos.email || "").trim())
      lineas.push("Correo: " + String(datos.email).trim());
    lineas.push("Mensaje: " + String(datos.message).trim());

    if (typeof sitio.enviarWhatsApp !== "function") {
      mostrar("El canal de contacto todavía no está configurado.", true);
      return;
    }
    const abierto = sitio.enviarWhatsApp(lineas.join("\n"));
    mostrar(
      abierto
        ? "Tu mensaje está listo en WhatsApp. Solo falta que lo envíes desde ahí."
        : "WhatsApp aún no está configurado. Puedes copiar el mensaje y enviarlo por otro medio.",
    );
    if (abierto) formulario.reset();
  });
})();
