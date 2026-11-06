"use strict";
/* =========================================================
   MI PORTAL (portal.html)
   El cliente entra con el folio de su contrato y su teléfono,
   ve sus mensualidades y pagos, y sube sus comprobantes.
   Se actualiza solo cuando el personal acepta o rechaza un comprobante.
   Requiere en config.js: api.url (ej. "http://localhost:3000/api/v1").
   ========================================================= */
(() => {
  const acceso = document.getElementById("portal-acceso");
  const panel = document.getElementById("portal-panel");
  const formAcceso = document.getElementById("portal-form");
  const resultadoAcceso = document.getElementById("portal-acceso-resultado");
  if (!acceso || !panel || !formAcceso) return;

  const config = window.CONFIGURACION || {};
  const api =
    config.api && config.api.url
      ? String(config.api.url).replace(/\/$/, "") + "/portal"
      : "";
  const CLAVE = "portal-token";
  const esc = (t) =>
    String(t ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const clase = (t) =>
    String(t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-");
  const fecha = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Mexico_City",
  });
  let fuente = null;
  let reintento = null;

  function mensaje(caja, texto, tipo) {
    caja.classList.remove("error", "success");
    if (tipo) caja.classList.add(tipo);
    caja.textContent = texto;
  }

  if (!api) {
    mensaje(
      resultadoAcceso,
      "El portal todavía no está disponible. Escríbenos para conocer tu saldo.",
      "error",
    );
    return;
  }
  try {
    const u = new URL(api);
    if (
      u.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(u.hostname)
    )
      throw new Error();
  } catch {
    mensaje(
      resultadoAcceso,
      "El portal no está configurado correctamente.",
      "error",
    );
    return;
  }

  const token = () => sessionStorage.getItem(CLAVE);

  async function pedir(ruta, opciones = {}) {
    const headers = { ...(opciones.headers || {}) };
    if (token()) headers.Authorization = "Bearer " + token();
    const r = await fetch(api + ruta, {
      ...opciones,
      headers,
      credentials: "omit",
      cache: "no-store",
    });
    const datos = await r.json().catch(() => ({}));
    if (r.status === 401 && token()) {
      cerrarSesion(
        "Tu sesión terminó. Vuelve a entrar con tu folio y teléfono.",
      );
      throw new Error("sesion");
    }
    if (!r.ok || datos.success !== true)
      throw new Error(
        datos.error || "No pudimos completar la operación. Intenta más tarde.",
      );
    return datos.data;
  }

  function cerrarSesion(texto) {
    sessionStorage.removeItem(CLAVE);
    if (fuente) fuente.close();
    clearTimeout(reintento);
    panel.hidden = true;
    panel.innerHTML = "";
    acceso.hidden = false;
    if (texto) mensaje(resultadoAcceso, texto, "error");
  }

  /* ===== Entrar ===== */
  formAcceso.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!formAcceso.reportValidity()) return;
    const d = Object.fromEntries(new FormData(formAcceso));
    const boton = formAcceso.querySelector('button[type="submit"]');
    boton.disabled = true;
    mensaje(resultadoAcceso, "Entrando…");
    try {
      const r = await pedir("/acceso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folio: d.folio, telefono: d.telefono }),
      });
      sessionStorage.setItem(CLAVE, r.token);
      formAcceso.reset();
      mensaje(resultadoAcceso, "");
      await mostrarPanel();
    } catch (err) {
      if (err.message !== "sesion")
        mensaje(resultadoAcceso, err.message, "error");
    } finally {
      boton.disabled = false;
    }
  });

  /* ===== Panel ===== */
  async function mostrarPanel() {
    let d;
    try {
      d = await pedir("/resumen");
    } catch (err) {
      if (err.message !== "sesion") cerrarSesion(err.message);
      return;
    }
    acceso.hidden = true;
    panel.hidden = false;
    const pagables = d.mensualidades.filter((m) => m.puedePagar).reverse(); // la más antigua primero
    const c = d.contrato;
    panel.innerHTML = `
      <div class="portal-encabezado">
        <div>
          <span class="subtitulo">Contrato ${esc(c.folio)}</span>
          <h2>Hola, ${esc(String(c.cliente || "").split(" ")[0])}</h2>
          <p class="muted">Plan ${esc(c.plan)} · ${esc(c.tarifa)} al mes · Fecha límite: día ${esc(c.diaLimitePago)} de cada mes</p>
        </div>
        <button type="button" class="button secondary" id="portal-salir">Salir</button>
      </div>

      <div class="cuadricula portal-resumen">
        <div class="card"><span class="tag">Saldo vencido</span><p class="price">${esc(d.saldoVencido)}</p>
          <p class="fine">${d.vencidas ? `Tienes ${d.vencidas} ${d.vencidas === 1 ? "mensualidad vencida" : "mensualidades vencidas"}. Paga y envía tu comprobante abajo.` : "Estás al corriente. ¡Gracias!"}</p></div>
        <div class="card"><span class="tag">Próximo pago</span>
          ${
            d.proximoPago
              ? `<p class="price">${esc(d.proximoPago.saldo)}</p><p class="fine">${esc(d.proximoPago.periodo)} · vence el ${esc(fecha.format(new Date(d.proximoPago.fechaLimite)))}</p>`
              : '<p class="price">—</p><p class="fine">No tienes pagos próximos registrados.</p>'
          }</div>
        <div class="card"><span class="tag">Estado del servicio</span><p class="price">${esc(c.estado.charAt(0).toUpperCase() + c.estado.slice(1))}</p>
          <p class="fine">Si tienes dudas sobre tu servicio, <a href="contacto.html">escríbenos</a>.</p></div>
      </div>

      <h2>Mis mensualidades</h2>
      <div class="portal-tabla-contenedor">
        <table class="portal-tabla">
          <thead><tr><th>Mes</th><th>Vence</th><th>Importe</th><th>Pagado</th><th>En revisión</th><th>Saldo</th><th>Estado</th></tr></thead>
          <tbody>${
            d.mensualidades.length
              ? d.mensualidades
                  .map(
                    (m) => `
            <tr>
              <td data-etiqueta="Mes">${esc(m.periodo)}</td>
              <td data-etiqueta="Vence">${esc(fecha.format(new Date(m.fechaLimite)))}</td>
              <td data-etiqueta="Importe">${esc(m.importe)}</td>
              <td data-etiqueta="Pagado">${esc(m.pagado)}</td>
              <td data-etiqueta="En revisión">${esc(m.enRevision)}</td>
              <td data-etiqueta="Saldo"><strong>${esc(m.saldo)}</strong></td>
              <td data-etiqueta="Estado"><span class="portal-estado portal-estado-${clase(m.estado)}">${esc(m.estado)}</span></td>
            </tr>`,
                  )
                  .join("")
              : '<tr><td colspan="7">Aún no tienes mensualidades registradas.</td></tr>'
          }</tbody>
        </table>
      </div>

      <div class="dos-columnas portal-pagar">
        <div>
          <h2>Enviar comprobante de pago</h2>
          <p>Si pagaste por transferencia o depósito, sube la foto o el PDF de tu comprobante. Lo revisaremos y el pago se verá aplicado aquí.</p>
          <p class="fine">Formatos: JPG, PNG, WEBP o PDF.</p>
        </div>
        <div class="formulario">
          ${
            pagables.length
              ? `
          <form id="portal-comprobante">
            <div class="campos">
              <div class="campo completo"><label for="pc-mensualidad">Mensualidad que pagaste *</label>
                <select id="pc-mensualidad" name="mensualidad" required>
                  ${pagables.map((m) => `<option value="${esc(m.id)}" data-saldo="${(m.saldoCentavos / 100).toFixed(2)}">${esc(m.periodo)} · saldo ${esc(m.saldo)}</option>`).join("")}
                </select></div>
              <div class="campo"><label for="pc-monto">Monto pagado *</label>
                <input id="pc-monto" name="monto" required inputmode="decimal" placeholder="0.00" value="${(pagables[0].saldoCentavos / 100).toFixed(2)}"></div>
              <div class="campo"><label for="pc-metodo">Forma de pago *</label>
                <select id="pc-metodo" name="metodo"><option value="transferencia">Transferencia</option><option value="deposito">Depósito</option></select></div>
              <div class="campo"><label for="pc-referencia">Referencia o clave de rastreo *</label>
                <input id="pc-referencia" name="referencia" required maxlength="40" autocapitalize="characters"></div>
              <div class="campo"><label for="pc-fecha">Fecha del pago</label>
                <input id="pc-fecha" name="fecha" type="date"></div>
              <div class="campo completo"><label for="pc-archivo">Comprobante (foto o PDF) *</label>
                <input id="pc-archivo" name="archivo" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf"></div>
            </div>
            <div class="actions"><button type="submit">Enviar comprobante</button></div>
            <div id="pc-resultado" class="result" role="status" aria-live="polite"></div>
          </form>`
              : '<p class="notice">No tienes mensualidades con saldo pendiente. ¡Gracias por estar al corriente!</p>'
          }
        </div>
      </div>

      <div class="dos-columnas">
        <div>
          <h2>Mis comprobantes</h2>
          ${
            d.comprobantes.length
              ? `<ul class="portal-lista">${d.comprobantes
                  .map(
                    (x) => `
            <li><strong>${esc(x.monto)}</strong> · ${esc(x.periodo)} · Ref. ${esc(x.referencia)}
              <span class="portal-estado portal-estado-${clase(x.estado)}">${esc(x.estado)}</span>
              <br><small>Enviado el ${esc(fecha.format(new Date(x.fecha)))}${x.motivo ? ` · Motivo: ${esc(x.motivo)}` : ""}</small></li>`,
                  )
                  .join("")}</ul>`
              : '<p class="muted">Aún no has enviado comprobantes.</p>'
          }
        </div>
        <div>
          <h2>Mis pagos</h2>
          ${
            d.pagos.length
              ? `<ul class="portal-lista">${d.pagos
                  .map(
                    (p) => `
            <li><strong>${esc(p.monto)}</strong> · ${esc(p.periodo)} · ${esc(p.metodo)}
              <span class="portal-estado portal-estado-${clase(p.estado)}">${esc(p.estado)}</span>
              <br><small>${esc(fecha.format(new Date(p.fecha)))} · Ref. ${esc(p.referencia)}</small></li>`,
                  )
                  .join("")}</ul>`
              : '<p class="muted">Aún no hay pagos registrados.</p>'
          }
        </div>
      </div>`;

    document
      .getElementById("portal-salir")
      .addEventListener("click", async () => {
        try {
          await pedir("/salir", { method: "POST" });
        } catch {
          /* sin acción */
        }
        cerrarSesion();
        mensaje(resultadoAcceso, "Cerraste tu sesión.", "success");
      });

    const formPago = document.getElementById("portal-comprobante");
    if (formPago) {
      const selector = formPago.querySelector("#pc-mensualidad");
      selector.addEventListener("change", () => {
        formPago.querySelector("#pc-monto").value =
          selector.selectedOptions[0].dataset.saldo;
      });
      formPago.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!formPago.reportValidity()) return;
        const caja = formPago.querySelector("#pc-resultado");
        const boton = formPago.querySelector('button[type="submit"]');
        boton.disabled = true;
        mensaje(caja, "Enviando comprobante…");
        try {
          const r = await pedir("/comprobantes", {
            method: "POST",
            body: new FormData(formPago),
          });
          mensaje(caja, r.mensaje, "success");
          setTimeout(mostrarPanel, 1500);
        } catch (err) {
          if (err.message !== "sesion") mensaje(caja, err.message, "error");
          boton.disabled = false;
        }
      });
    }
    escucharCambios();
  }

  /* ===== Tiempo real: cuando el personal acepta o rechaza un comprobante ===== */
  async function escucharCambios() {
    if (!window.EventSource || (fuente && fuente.readyState !== 2)) return;
    clearTimeout(reintento);
    try {
      const { pase } = await pedir("/pase", { method: "POST" });
      fuente = new EventSource(
        api + "/eventos?pase=" + encodeURIComponent(pase),
      );
      fuente.addEventListener("cambio", () => {
        const escribiendo =
          document.activeElement &&
          document.activeElement.closest &&
          document.activeElement.closest("#portal-comprobante");
        if (!escribiendo) mostrarPanel();
      });
      fuente.addEventListener("error", () => {
        if (fuente.readyState === 2 && token())
          reintento = setTimeout(escucharCambios, 5000);
      });
    } catch {
      if (token()) reintento = setTimeout(escucharCambios, 15000);
    }
  }

  if (token()) mostrarPanel();
})();
