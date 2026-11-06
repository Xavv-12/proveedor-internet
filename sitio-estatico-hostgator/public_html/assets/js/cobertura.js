"use strict";
/* =========================================================
   CONSULTA DE COBERTURA
   Compara lo que escribe el visitante con las zonas de config.js
   ========================================================= */
window.Cobertura = (() => {
  /* Quita acentos, espacios de más y mayúsculas para comparar: "Toluca " = "toluca" */
  const limpiar = (texto) =>
    String(texto || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  /* Busca la zona y responde: incompleto, pendiente, sin-cobertura o no-registrada */
  function buscarZona(datos, zonas) {
    if (
      !limpiar(datos.state) ||
      !limpiar(datos.municipality) ||
      !limpiar(datos.locality)
    )
      return "incompleto";
    const zona = zonas.find(
      (z) =>
        limpiar(z.estado) === limpiar(datos.state) &&
        limpiar(z.municipio) === limpiar(datos.municipality) &&
        limpiar(z.localidad) === limpiar(datos.locality),
    );
    if (!zona) return "no-registrada";
    return zona.situacion === "sin-cobertura" ? "sin-cobertura" : "pendiente";
  }

  const { config, buscar, mostrarResultado, enviarWhatsApp } = window.Sitio;
  const formulario = buscar("#coverage-form");

  if (formulario) {
    const recuadro = buscar("#coverage-result");
    const textos = {
      incompleto:
        "Datos incompletos. Indica estado, municipio y colonia o localidad.",
      pendiente:
        "Zona registrada con cobertura por confirmar. Se necesita validación de un asesor o técnico.",
      "sin-cobertura":
        "Zona sin cobertura registrada en el catálogo. Consulta con un asesor posibles alternativas.",
      "no-registrada":
        "Zona no registrada en el catálogo. Solicita una consulta con un asesor.",
    };

    formulario.noValidate = true;
    const leerDatos = () => Object.fromEntries(new FormData(formulario));

    /* Botón "Consultar cobertura" */
    formulario.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const datos = leerDatos();
      const resultado = buscarZona(datos, config.cobertura || []);

      if (resultado === "incompleto") {
        mostrarResultado(recuadro, textos[resultado], true);
        formulario.reportValidity();
        return;
      }
      if (!formulario.reportValidity()) {
        mostrarResultado(
          recuadro,
          "Revisa los campos, incluido el código postal de cinco dígitos si lo proporcionaste.",
          true,
        );
        return;
      }
      mostrarResultado(
        recuadro,
        (config.modo === "demo" ? "RESULTADO DE DEMOSTRACIÓN. " : "") +
          textos[resultado] +
          " La disponibilidad definitiva depende de validación técnica.",
      );
    });

    /* Botón "Consultar por WhatsApp" */
    buscar("#coverage-wa").addEventListener("click", () => {
      if (!formulario.reportValidity()) return;
      const datos = leerDatos();
      const mensaje =
        "Hola, quiero consultar cobertura. Estado: " +
        datos.state +
        "; municipio: " +
        datos.municipality +
        "; colonia o localidad: " +
        datos.locality +
        (datos.zip ? "; CP: " + datos.zip : "") +
        (datos.reference ? "; referencia: " + datos.reference : "") +
        ". Autorizo compartir esta ubicación para atender mi consulta.";
      if (
        window.confirm(
          "¿Autorizas compartir la ubicación ingresada por WhatsApp para consultar cobertura?",
        )
      )
        enviarWhatsApp(mensaje);
    });
  }

  return { limpiar, buscarZona };
})();
