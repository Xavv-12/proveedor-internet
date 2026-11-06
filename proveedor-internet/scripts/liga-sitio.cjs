const os = require("os");
const puerto = 8080;

const red = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i.family === "IPv4" && !i.internal);

const lineas = [
  "",
  "Sitio listo",
  "",
  `- Local:  http://localhost:${puerto}`,
  red ? `- Red:    http://${red.address}:${puerto}` : null,
  "",
].filter((l) => l !== null);

const ancho = Math.max(...lineas.map((l) => l.length)) + 4;
console.log("\n+" + "-".repeat(ancho) + "+");
lineas.forEach((l) => console.log("|  " + l.padEnd(ancho - 2) + "|"));
console.log("+" + "-".repeat(ancho) + "+\n");
