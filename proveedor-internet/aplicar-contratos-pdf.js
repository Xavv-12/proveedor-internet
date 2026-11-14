"use strict";
// Uso (desde la raíz del proyecto):  node aplicar-contratos-pdf.js
// Respeta el fin de línea (CRLF/LF). Es seguro ejecutarlo dos veces. Si no encuentra el texto esperado, no escribe nada.
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

const FUNCION_CORREO = [
  "async function enviarContratoPdf({ correo, nombre, folio, rutaPdf }) {",
  "  const t = obtenerTransporte();",
  "  if (!t) throw new Error('El correo (SMTP) no está configurado en el servidor.');",
  "  await t.sendMail({",
  "    from: obtenerConfig().smtp.from,",
  "    to: correo,",
  "    subject: 'Tu contrato de servicio de internet COSMOS',",
  "    text: `Hola, ${nombre}:\\n\\nTe enviamos una copia de tu contrato de servicio de internet (contrato ${folio}), `",
  "      + 'firmado y escaneado. Consérvala para cualquier aclaración.\\n\\n'",
  "      + 'Si tienes dudas, comunícate con nosotros por los medios de contacto que aparecen en tu contrato.\\n\\nCOSMOS',",
  "    attachments: [{ filename: `Contrato-${folio}.pdf`, path: rutaPdf, contentType: 'application/pdf' }],",
  "  });",
  "  return true;",
  "}",
  "",
  "module.exports = { enviarRestablecimiento, enviarContratoPdf };",
].join("\n");

const NUMERO_CAMPO = (etiqueta, ayuda) =>
  [
    "  {",
    '    nombre: "numeroImpreso",',
    `    etiqueta: "${etiqueta}",`,
    '    tipo: "text",',
    "    max: 20,",
    '    autocapitalize: "characters",',
    `    ayuda: "${ayuda}",`,
    "  },",
  ].join("\n");

const ZOD_NUMERO =
  'numeroImpreso: E.cadena((s) => s.max(20, "El número impreso admite máximo 20 caracteres.").regex(/^[A-Z0-9-]*$/, "Usa solo letras, números y guion."), (v) => E.limpio(v).toUpperCase()),';

const CAMBIOS = {
  "src/lib/correo.js": [
    {
      marca: "enviarContratoPdf",
      buscar: "module.exports = { enviarRestablecimiento };",
      poner: FUNCION_CORREO,
    },
  ],
  "src/permisos.js": [
    {
      marca: "contratos_pdf: {",
      buscar: "equipos: { leer: TODOS, escribir: OFICINA },",
      poner:
        "equipos: { leer: TODOS, escribir: OFICINA },\n  contratos_pdf: { leer: OFICINA, escribir: OFICINA },",
    },
    {
      marca: '"/contratos-escaneados"',
      buscar: '{ modulo: "equipos", ruta: "/equipos", texto: "Equipos" },',
      poner:
        '{ modulo: "equipos", ruta: "/equipos", texto: "Equipos" },\n      { modulo: "contratos_pdf", ruta: "/contratos-escaneados", texto: "Contratos escaneados" },',
    },
  ],
  "src/app.js": [
    {
      marca: '"/contratos-escaneados", "contratos_pdf"',
      buscar: '["/equipos", "equipos", "equipos contratos"],',
      poner:
        '["/equipos", "equipos", "equipos contratos"],\n  ["/contratos-escaneados", "contratos_pdf", "contratos_pdf"],',
    },
    {
      marca: 'require("./rutas/contratos-escaneados")',
      buscar: 'app.use("/contratos", require("./rutas/contratos"));',
      poner:
        'app.use("/contratos", require("./rutas/contratos"));\n  app.use("/contratos-escaneados", require("./rutas/contratos-escaneados"));',
    },
  ],
  "src/rutas/contratos.js": [
    {
      marca: "// ni1",
      buscar:
        '{ nombre: "cliente", tipo: "hidden", valor: String(cliente._id) },',
      poner:
        '{ nombre: "cliente", tipo: "hidden", valor: String(cliente._id) },\n' +
        NUMERO_CAMPO(
          "Número de contrato impreso (del papel)",
          "Opcional. Ej. 60109A. Sirve para emparejar el PDF escaneado.",
        ).replace(/\n {2}\},$/, "\n  }, // ni1"),
    },
    {
      marca: "// ni2",
      buscar: 'cliente: E.idObjeto("un cliente"),',
      poner:
        'cliente: E.idObjeto("un cliente"),\n    ' + ZOD_NUMERO + " // ni2",
    },
    {
      marca: "// ni3",
      buscar: "const doc = {\n      folio,\n      clienteId: cliente._id,",
      poner:
        "const doc = {\n      folio,\n      numeroImpreso: d.numeroImpreso || null, // ni3\n      clienteId: cliente._id,",
    },
    {
      marca: "// ni4",
      buscar:
        'const ahora = new Date();\n    const folio = await siguienteFolio("CTR");',
      poner: [
        "// ni4",
        "    if (",
        "      d.numeroImpreso &&",
        '      (await col("contratos").findOne({ numeroImpreso: d.numeroImpreso }, { projection: { _id: 1 } }))',
        "    )",
        '      return formularioContrato(res, cliente, req.body, { numeroImpreso: "Ya existe un contrato con ese número impreso." }, 422);',
        "    const ahora = new Date();",
        '    const folio = await siguienteFolio("CTR");',
      ].join("\n"),
    },
    {
      marca: "// ni6",
      buscar: "const camposEdicion = [\n",
      poner:
        "const camposEdicion = [\n" +
        NUMERO_CAMPO(
          "Número de contrato impreso (del papel)",
          "Ej. 60109A. Sirve para emparejar el PDF escaneado.",
        ).replace(/\n {2}\},$/, "\n  }, // ni6") +
        "\n",
    },
    {
      marca: "// ni7",
      buscar: "const esquemaEdicion = () =>\n  E.z.object({\n",
      poner:
        "const esquemaEdicion = () =>\n  E.z.object({\n    " +
        ZOD_NUMERO +
        " // ni7\n",
    },
    {
      marca: "// ni8",
      buscar:
        "campos: llenar(camposEdicion, {\n        direccionInstalacion: c.direccionInstalacion,",
      poner:
        'campos: llenar(camposEdicion, {\n        numeroImpreso: c.numeroImpreso || "", // ni8\n        direccionInstalacion: c.direccionInstalacion,',
    },
    {
      marca: "// ni5",
      buscar: "const cambios = {\n      ...v.data,",
      poner: [
        "// ni5",
        "    if (",
        "      v.data.numeroImpreso &&",
        '      (await col("contratos").findOne({ numeroImpreso: v.data.numeroImpreso, _id: { $ne: c._id } }, { projection: { _id: 1 } }))',
        "    ) {",
        '      avisar(req, "Ya existe otro contrato con ese número impreso.", "error");',
        "      return res.redirect(`/contratos/${c._id}/editar`);",
        "    }",
        "    const cambios = {",
        "      ...v.data,",
      ].join("\n"),
    },
    {
      marca: "// ni9",
      buscar: '{ etiqueta: "Inicio", valor: formatearFecha(c.fechaInicio) },',
      poner:
        '{ etiqueta: "Número impreso", valor: c.numeroImpreso || "—" }, // ni9\n          { etiqueta: "Inicio", valor: formatearFecha(c.fechaInicio) },',
    },
  ],
  "src/rutas/panel-tecnico.js": [
    {
      marca: "$or: [{ folio: d.contratoFolio }",
      buscar:
        "col('contratos').findOne({ folio: d.contratoFolio }, { projection:",
      poner:
        "col('contratos').findOne({ $or: [{ folio: d.contratoFolio }, { numeroImpreso: d.contratoFolio }] }, { projection:",
    },
    {
      marca: "o el número impreso del papel",
      buscar:
        "ayuda: 'Ej. CTR-2026-00001. El nombre del titular se toma del contrato.',",
      poner:
        "ayuda: 'Ej. CTR-2026-00001 o el número impreso del papel (60109A). El titular se toma del contrato.',",
    },
  ],
};

const pendientes = [];
for (const [archivo, cambios] of Object.entries(CAMBIOS)) {
  const ruta = path.join(RAIZ, archivo);
  if (!fs.existsSync(ruta))
    throw new Error(
      `No existe ${archivo}. Ejecuta el script desde la raíz del proyecto.`,
    );
  const original = fs.readFileSync(ruta, "utf8");
  const crlf = original.includes("\r\n");
  let texto = original.replace(/\r\n/g, "\n");
  let tocado = false;
  for (const c of cambios) {
    if (texto.includes(c.marca)) {
      console.log(`= ${archivo}: ya estaba (${c.marca})`);
      continue;
    }
    if (!texto.includes(c.buscar))
      throw new Error(
        `${archivo}: no encontré el texto esperado:\n${c.buscar}\nNo se modificó nada.`,
      );
    texto = texto.replace(c.buscar, () => c.poner);
    tocado = true;
    console.log(`+ ${archivo}: ${c.marca}`);
  }
  if (tocado)
    pendientes.push([ruta, crlf ? texto.replace(/\n/g, "\r\n") : texto]);
}
for (const [ruta, contenido] of pendientes)
  fs.writeFileSync(ruta, contenido, "utf8");
console.log(`\nListo. ${pendientes.length} archivo(s) modificado(s).`);
