"use strict";
(() => {
  const origen = document.getElementById("lista-paquetes");
  const destino = document.getElementById("ref-mini-planes");
  if (!origen || !destino) return;
  function actualizar() {
    const tarjetas = [...origen.querySelectorAll(".package")].slice(0, 3);
    destino.replaceChildren();
    tarjetas.forEach((tarjeta, indice) => {
      const mini = document.createElement("article");
      mini.className = "ref-mini" + (indice === 1 ? " ref-mini-destacada" : "");
      const nombre = document.createElement("strong");
      nombre.className = "ref-mini-nombre";
      nombre.textContent =
        tarjeta.querySelector("h3")?.textContent || "Paquete";
      const velocidad = document.createElement("p");
      velocidad.className = "ref-mini-velocidad";
      velocidad.textContent =
        tarjeta
          .querySelector(".speed")
          ?.textContent.trim()
          .replace(/\s+/g, " ") || "";
      const precio = document.createElement("p");
      precio.className = "ref-mini-precio";
      precio.textContent =
        tarjeta
          .querySelector(".price")
          ?.textContent.trim()
          .replace(/\s+/g, " ") || "";
      const lista = document.createElement("ul");
      tarjeta.querySelectorAll("ul li").forEach((li) => {
        const item = document.createElement("li");
        item.textContent = li.textContent;
        lista.append(item);
      });
      const enlace = document.createElement("a");
      enlace.className = "button";
      enlace.textContent = "Seleccionar";
      enlace.href =
        tarjeta.querySelector(".actions a")?.getAttribute("href") ||
        "paquetes.html";
      mini.append(nombre, velocidad, precio, lista, enlace);
      destino.append(mini);
    });
  }
  actualizar();
  new MutationObserver(actualizar).observe(origen, {
    childList: true,
    subtree: true,
    characterData: true,
  });
})();
