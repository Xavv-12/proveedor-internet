"use strict";
/* =========================================================
   CÓDIGO POSTAL AUTOMÁTICO
   Al escribir los 5 dígitos del código postal, llena solo:
   - Estado
   - Municipio
   - Colonia: lista desplegable con todas las colonias del CP
   Funciona en cualquier formulario que tenga campos con
   name="zip", name="state", name="municipality" y name="locality".

   Los datos están en assets/cp/XX.json (XX = 2 primeros dígitos del CP).
   Fuente: Catálogo Nacional de Códigos Postales de Correos de México (SEPOMEX).
   ========================================================= */
(() => {
  /* Carpeta de datos, calculada desde la ubicación de este script */
  const script = document.currentScript;
  const carpetaDatos = new URL("../cp/", script ? script.src : location.href);
  const cache = {};

  /* Devuelve los datos del grupo, o null si no se pudo leer el archivo */
  function cargarGrupo(prefijo) {
    if (!cache[prefijo]) {
      const direccion = new URL(prefijo + ".json", carpetaDatos);
      cache[prefijo] = fetch(direccion)
        .then((r) => {
          if (!r.ok) throw Error("HTTP " + r.status);
          return r.json();
        })
        .catch((error) => {
          console.warn(
            "Código postal: no se pudo leer " +
              direccion.href +
              " (" +
              error.message +
              ")",
          );
          delete cache[prefijo]; /* reintentar la próxima vez */
          return null;
        });
    }
    return cache[prefijo];
  }

  /* Escribe el valor solo si el campo está vacío o lo habíamos llenado nosotros */
  function llenar(campo, valor) {
    if (!campo || !valor) return;
    const vacio = !campo.value.trim();
    const autollenado =
      campo.dataset.autoCp && campo.value === campo.dataset.autoCp;
    if (!vacio && !autollenado) return;
    campo.value = valor;
    campo.dataset.autoCp = valor;
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function prepararFormulario(formulario) {
    const cp = formulario.elements.namedItem("zip");
    if (!cp || cp.dataset.cpListo) return;
    cp.dataset.cpListo = "1";

    const estado = formulario.elements.namedItem("state");
    const municipio = formulario.elements.namedItem("municipality");
    const colonia = formulario.elements.namedItem("locality");

    /* Mensaje debajo del código postal */
    const aviso = document.createElement("small");
    aviso.className = "cp-aviso";
    aviso.setAttribute("aria-live", "polite");
    cp.insertAdjacentElement("afterend", aviso);

    /* Lista desplegable con TODAS las colonias del código postal.
       El campo de texto original se oculta y recibe el valor elegido
       (así el formulario se envía igual que antes). */
    const OTRA = "__otra__";
    let lista = null;
    if (colonia) {
      lista = document.createElement("select");
      lista.id = (colonia.id || "colonia") + "-lista";
      lista.hidden = true;
      colonia.insertAdjacentElement("beforebegin", lista);
      const etiqueta =
        colonia.id &&
        formulario.querySelector('label[for="' + colonia.id + '"]');
      lista.addEventListener("change", () => {
        if (lista.value === OTRA) {
          /* No aparece su colonia: volver al campo de texto */
          mostrarTexto();
          colonia.value = "";
          colonia.focus();
        } else {
          colonia.value = lista.value;
          colonia.dataset.autoCp = lista.value;
        }
        colonia.dispatchEvent(new Event("input", { bubbles: true }));
      });

      function mostrarTexto() {
        lista.hidden = true;
        lista.required = false;
        colonia.hidden = false;
        if (etiqueta) etiqueta.setAttribute("for", colonia.id);
      }
      function mostrarLista(colonias) {
        const opciones = [new Option("Selecciona tu colonia", "")];
        colonias.forEach((c) => opciones.push(new Option(c, c)));
        opciones.push(new Option("Mi colonia no aparece", OTRA));
        lista.replaceChildren(...opciones);
        /* Si ya había una colonia elegida y sigue en la lista, se conserva */
        lista.value = colonias.includes(colonia.value) ? colonia.value : "";
        if (colonias.length === 1) lista.value = colonias[0];
        colonia.value = lista.value;
        colonia.dataset.autoCp = lista.value;
        lista.required = colonia.required;
        lista.hidden = false;
        colonia.hidden = true;
        if (etiqueta) etiqueta.setAttribute("for", lista.id);
      }
      lista.mostrarTexto = mostrarTexto;
      lista.mostrarLista = mostrarLista;
    }

    let ultimaBusqueda = "";

    cp.addEventListener("input", async () => {
      const valor = cp.value.replace(/\D/g, "").slice(0, 5);
      if (valor !== cp.value) cp.value = valor;

      if (valor.length < 5) {
        aviso.textContent = "";
        aviso.className = "cp-aviso";
        ultimaBusqueda = "";
        if (lista && !lista.hidden) {
          lista.mostrarTexto();
          if (colonia.value === colonia.dataset.autoCp) colonia.value = "";
        }
        return;
      }
      if (valor === ultimaBusqueda) return;
      ultimaBusqueda = valor;

      aviso.textContent = "Buscando…";
      aviso.className = "cp-aviso";
      const grupo = await cargarGrupo(valor.slice(0, 2));
      if (cp.value !== valor) return; /* el usuario ya cambió el CP */

      if (grupo === null) {
        aviso.textContent =
          "No pudimos consultar el código postal en este momento. Escribe tus datos a mano.";
        aviso.className = "cp-aviso cp-aviso-error";
        ultimaBusqueda = "";
        return;
      }
      const datos = grupo[valor];
      if (!datos) {
        aviso.textContent =
          "No encontramos este código postal. Escribe tus datos a mano.";
        aviso.className = "cp-aviso cp-aviso-error";
        if (lista) lista.mostrarTexto();
        return;
      }

      const [nombreEstado, nombreMunicipio, colonias] = datos;
      llenar(estado, nombreEstado);
      llenar(municipio, nombreMunicipio);

      if (lista && colonias.length) lista.mostrarLista(colonias);

      aviso.textContent =
        nombreMunicipio +
        ", " +
        nombreEstado +
        (colonias.length > 1 ? " · Elige tu colonia de la lista" : "");
      aviso.className = "cp-aviso cp-aviso-ok";
    });

    /* Si el CP ya venía escrito (por ejemplo, desde el mapa), buscarlo */
    if (cp.value.replace(/\D/g, "").length === 5) {
      cp.dispatchEvent(new Event("input"));
    }
  }

  document.querySelectorAll("form").forEach(prepararFormulario);
})();
