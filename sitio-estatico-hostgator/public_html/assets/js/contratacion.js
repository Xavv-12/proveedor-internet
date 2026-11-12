"use strict";
/* =========================================================
   FORMULARIO DE SOLICITUD DE CONTRATACIÓN (contacto.html y solicitud.html)
   Revisa los datos y los manda a WhatsApp o al servidor (si existe).
   ========================================================= */
(() => {
  const { config, buscar, mostrarResultado, enviarWhatsApp } = window.Sitio;
  const formulario = buscar("#lead-form");
  if (!formulario) return;

  const recuadro = buscar("#lead-result");
  const boton = buscar("#lead-submit");
  /* Texto original del botón, para regresarlo igual al terminar */
  const textoBoton = boton.textContent.trim();
  const campoTelefono = buscar("#lead-phone");
  const campoCodigoPostal = formulario.elements.namedItem("zip");
  let ocupado = false;

  campoTelefono.addEventListener("input", () =>
    campoTelefono.setCustomValidity(""),
  );
  if (campoCodigoPostal)
    campoCodigoPostal.addEventListener("input", () =>
      campoCodigoPostal.setCustomValidity(""),
    );
  formulario.noValidate = true;

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (ocupado) return;

    const datos = Object.fromEntries(new FormData(formulario));

    /* ----- Revisar teléfono (10 dígitos) ----- */
    const telefono = String(datos.phone || "").replace(/\D/g, "");
    campoTelefono.setCustomValidity(
      /^\d{10}$/.test(telefono)
        ? ""
        : "Ingresa un número de teléfono mexicano de 10 dígitos.",
    );

    /* ----- Revisar código postal (5 dígitos, obligatorio) ----- */
    const codigoPostal = String(datos.zip || "").replace(/\D/g, "");
    if (!campoCodigoPostal) {
      mostrarResultado(
        recuadro,
        "Falta el campo de código postal en el formulario.",
        true,
      );
      return;
    }
    campoCodigoPostal.setCustomValidity(
      /^\d{5}$/.test(codigoPostal)
        ? ""
        : "Escribe un código postal de 5 dígitos.",
    );

    /* ----- Revisar campos obligatorios ----- */
    ["name", "state", "municipality", "locality"].forEach((nombreCampo) => {
      const campo = formulario.elements.namedItem(nombreCampo);
      campo.setCustomValidity(
        String(datos[nombreCampo] || "").trim() ? "" : "Completa este campo.",
      );
      campo.addEventListener("input", () => campo.setCustomValidity(""), {
        once: true,
      });
    });

    if (!formulario.reportValidity()) {
      mostrarResultado(
        recuadro,
        "Revisa los campos señalados y acepta el aviso de privacidad.",
        true,
      );
      return;
    }

    /* Campo trampa contra robots: si viene lleno, no se envía */
    if (datos.website) {
      mostrarResultado(recuadro, "No se pudo procesar la solicitud.", true);
      return;
    }

    const paquete = (config.paquetes || []).find((p) => p.id === datos.package);
    if (!paquete) {
      mostrarResultado(recuadro, "Selecciona un paquete del catálogo.", true);
      return;
    }

    /* Datos que se mandan al servidor.
       OJO: estos nombres (name, phone...) los espera el servidor; no los cambies. */
    const solicitud = {
      name: datos.name.trim(),
      phone: telefono,
      postalCode: codigoPostal,
      state: datos.state.trim(),
      municipality: datos.municipality.trim(),
      locality: datos.locality.trim(),
      packageId: paquete.id,
      consent: true,
      consentVersion: "privacidad-provisional-v1",
      mode: config.modo,
    };
    ["email", "street", "comments"].forEach((clave) => {
      if (String(datos[clave] || "").trim())
        solicitud[clave] = String(datos[clave]).trim();
    });

    /* Bloquear el botón mientras se procesa */
    ocupado = true;
    boton.disabled = true;
    boton.textContent = "Preparando…";
    formulario.setAttribute("aria-busy", "true");
    let temporizador;

    try {
      if (config.api && config.api.url) {
        /* ===== OPCIÓN A: enviar al servidor ===== */
        const direccion = new URL(
          String(config.api.url).replace(/\/$/, "") +
            "/" +
            String(config.api.ruta || "/solicitudes").replace(/^\//, ""),
        );
        /* En producción se exige HTTPS; en tu computadora (localhost) se permite HTTP para pruebas */
        const esLocal = ["localhost", "127.0.0.1"].includes(direccion.hostname);
        if (direccion.protocol !== "https:" && !esLocal)
          throw Error("El servidor debe usar HTTPS.");

        const control = new AbortController();
        temporizador = setTimeout(
          () => control.abort(),
          config.api.tiempoEsperaMs || 15000,
        );
        boton.textContent = "Enviando…";
        mostrarResultado(recuadro, "Enviando solicitud…");

        const respuesta = await fetch(direccion.href, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(solicitud),
          signal: control.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });

        let contenido;
        try {
          contenido = await respuesta.json();
        } catch {
          throw Error(
            "Respuesta no válida del servidor. No podemos confirmar el registro.",
          );
        }
        /* Si el servidor rechazó los datos, muestra su mensaje (ej. "El código postal debe tener 5 dígitos.") */
        if (!respuesta.ok)
          throw Error(
            contenido && contenido.error
              ? contenido.error
              : "El servidor no confirmó el registro (HTTP " +
                  respuesta.status +
                  "). No se enviará de nuevo automáticamente.",
          );
        if (
          contenido.success !== true ||
          typeof contenido.id !== "string" ||
          !contenido.id.trim()
        ) {
          throw Error(
            "El servidor respondió sin una confirmación válida. No podemos confirmar el registro.",
          );
        }

        mostrarResultado(
          recuadro,
          "El servidor confirmó el registro de tu solicitud con el folio " +
            contenido.id +
            ". Esto no confirma cobertura ni contratación.",
        );
        recuadro.classList.add("success");
        formulario.reset();
      } else {
        /* ===== OPCIÓN B: preparar mensaje para WhatsApp ===== */
        const lineas = [
          "Hola, me interesa contratar el paquete " +
            paquete.nombre +
            (config.modo === "demo" ? " (ejemplo de demostración)" : "") +
            ".",
          "Nombre: " + solicitud.name,
          "Teléfono: " + solicitud.phone,
          "Código postal: " + solicitud.postalCode,
          "Estado: " + solicitud.state,
          "Municipio: " + solicitud.municipality,
          "Colonia o localidad: " + solicitud.locality,
        ];
        if (solicitud.email) lineas.push("Correo: " + solicitud.email);
        if (solicitud.street)
          lineas.push("Calle y número: " + solicitud.street);
        if (solicitud.comments)
          lineas.push("Comentarios: " + solicitud.comments);
        lineas.push(
          "He leído el aviso de privacidad y autorizo compartir estos datos para atender esta consulta.",
        );

        const abierto = enviarWhatsApp(lineas.join("\n"));
        mostrarResultado(
          recuadro,
          abierto
            ? "Mensaje preparado para WhatsApp. Debes enviarlo ahí. No se ha confirmado recepción ni se ha registrado una solicitud en este sitio."
            : "WhatsApp pendiente de configurar. Puedes copiar el mensaje mostrado; no se ha enviado ni registrado una solicitud.",
        );
      }
    } catch (error) {
      let texto = error.message;
      if (error.name === "AbortError")
        texto =
          "Se agotó el tiempo de espera. El estado del registro es desconocido; consulta al asesor antes de repetirlo.";
      else if (error instanceof TypeError)
        texto =
          "Error de conexión. No podemos confirmar el registro. Consulta al asesor antes de repetir el envío.";
      mostrarResultado(recuadro, texto, true);
    } finally {
      /* Desbloquear el botón después de 1.5 segundos */
      clearTimeout(temporizador);
      await new Promise((listo) => setTimeout(listo, 1500));
      ocupado = false;
      boton.disabled = false;
      boton.textContent = textoBoton;
      formulario.removeAttribute("aria-busy");
    }
  });
})();
