"use strict";
// Carga masiva de clientes desde Excel: lectura, validación fila por fila y plantilla.
// Usa las mismas reglas que el formulario "Nuevo cliente" (clientes.js).
const ExcelJS = require("exceljs");
const E = require("./esquemas");

const MAX_FILAS = 1000;

const COLUMNAS = [
  {
    clave: "nombre",
    titulo: "Nombre completo *",
    ancho: 36,
    obligatoria: true,
    empieza: ["nombre"],
  },
  {
    clave: "telefono",
    titulo: "Teléfono (10 dígitos) *",
    ancho: 22,
    obligatoria: true,
    empieza: ["telefono"],
  },
  {
    clave: "correo",
    titulo: "Correo",
    ancho: 32,
    empieza: ["correo", "email", "e mail"],
  },
  {
    clave: "direccion",
    titulo: "Calle y número *",
    ancho: 36,
    obligatoria: true,
    empieza: ["calle", "direccion", "domicilio"],
  },
  {
    clave: "colonia",
    titulo: "Colonia *",
    ancho: 26,
    obligatoria: true,
    empieza: ["colonia"],
  },
  {
    clave: "codigoPostal",
    titulo: "Código postal *",
    ancho: 16,
    obligatoria: true,
    empieza: ["codigo postal", "cp"],
  },
  {
    clave: "referencias",
    titulo: "Referencias para llegar",
    ancho: 26,
    empieza: ["referencias"],
  },
  { clave: "notas", titulo: "Notas internas", ancho: 36, empieza: ["notas"] },
  {
    clave: "numeroImpreso",
    titulo: "Número de contrato (papel)",
    ancho: 26,
    empieza: ["numero de contrato", "no de contrato", "contrato"],
  },
];

const ETIQUETA = {
  nombre: "Nombre",
  telefono: "Teléfono",
  correo: "Correo",
  direccion: "Calle y número",
  colonia: "Colonia",
  codigoPostal: "Código postal",
  referencias: "Referencias",
  notas: "Notas internas",
  numeroImpreso: "Número de contrato",
};

function sinAcentos(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarEncabezado(s) {
  return sinAcentos(s)
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function claveDeEncabezado(texto) {
  const n = normalizarEncabezado(texto);
  if (!n) return null;
  const c = COLUMNAS.find((col) =>
    col.empieza.some((p) => n === p || n.startsWith(`${p} `)),
  );
  return c ? c.clave : null;
}

/** Clave para comparar nombres: sin acentos, minúsculas y espacios simples. */
function claveNombre(nombre) {
  return sinAcentos(nombre)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textoCelda(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText))
      return v.richText
        .map((t) => t.text)
        .join("")
        .trim(); // texto con formato
    if (v.text !== undefined) return textoCelda(v.text); // hipervínculos (correos)
    if (v.result !== undefined) return textoCelda(v.result); // fórmulas
    return "";
  }
  return String(v).trim();
}

/** Lee el .xlsx y devuelve { filas: [{ fila, valores }] } o { error }. No valida el contenido de cada celda. */
async function leerExcel(buffer) {
  if (
    !buffer ||
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b
  ) {
    return {
      error:
        "El archivo no es un Excel .xlsx. Guárdalo como «Libro de Excel (.xlsx)» y vuelve a subirlo.",
    };
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return {
      error:
        "No se pudo leer el archivo. Revisa que sea un .xlsx sin contraseña y que no esté dañado.",
    };
  }
  const hoja = wb.getWorksheet("Clientes") || wb.worksheets[0];
  if (!hoja) return { error: "El archivo no tiene hojas." };

  const columna = {};
  hoja.getRow(1).eachCell({ includeEmpty: false }, (celda, numero) => {
    const clave = claveDeEncabezado(textoCelda(celda.value));
    if (clave && !columna[clave]) columna[clave] = numero;
  });
  const faltan = COLUMNAS.filter((c) => c.obligatoria && !columna[c.clave]).map(
    (c) => c.titulo.replace(" *", ""),
  );
  if (faltan.length) {
    return {
      error: `Faltan columnas en la fila 1: ${faltan.join(", ")}. Usa la plantilla sin cambiar los encabezados.`,
    };
  }

  const filas = [];
  hoja.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1) return;
    const valores = {};
    for (const c of COLUMNAS)
      valores[c.clave] = columna[c.clave]
        ? textoCelda(row.getCell(columna[c.clave]).value)
        : "";
    if (/^\d{4}$/.test(valores.codigoPostal))
      valores.codigoPostal = `0${valores.codigoPostal}`; // Excel quita el cero inicial
    if (Object.values(valores).every((v) => v === "")) return; // fila vacía
    filas.push({ fila: numero, valores });
  });
  if (!filas.length)
    return {
      error: "El archivo no tiene clientes: solo trae los encabezados.",
    };
  if (filas.length > MAX_FILAS)
    return {
      error: `El archivo trae ${filas.length} filas y el máximo por carga es ${MAX_FILAS}. Divídelo en varios.`,
    };
  return { filas };
}

const esquema = () =>
  E.z.object({
    nombre: E.texto(3, 120, "El nombre"),
    telefono: E.telefono(),
    correo: E.correoOpcional(),
    direccion: E.texto(5, 300, "La dirección"),
    colonia: E.texto(2, 120, "La colonia"),
    codigoPostal: E.codigoPostal(),
    referencias: E.textoOpcional(300, "Las referencias"),
    notas: E.textoOpcional(1000, "Las notas"),
    numeroImpreso: E.cadena(
      (s) =>
        s
          .max(20, "El número de contrato admite máximo 20 caracteres.")
          .regex(
            /^[A-Z0-9-]*$/,
            "El número de contrato solo admite letras, números y guion.",
          ),
      (v) => E.limpio(v).toUpperCase(),
    ),
  });

/** Valida una fila con las reglas del formulario. Devuelve { ok, datos } o { ok: false, errores: [texto] }. */
function validarFila(valores) {
  const v = esquema().safeParse(valores);
  if (v.success) return { ok: true, datos: v.data };
  const errores = [];
  for (const i of v.error.issues) {
    const campo = ETIQUETA[i.path[0]] || "Fila";
    const msg = `${campo}: ${i.message}`;
    if (!errores.includes(msg)) errores.push(msg);
  }
  return { ok: false, errores };
}

/** Plantilla .xlsx: hoja «Clientes» solo con encabezados y hoja «Instrucciones» con un ejemplo. */
async function crearPlantilla() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clientes");
  COLUMNAS.forEach((c, i) => {
    const celda = ws.getCell(1, i + 1);
    celda.value = c.titulo;
    celda.font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    celda.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F766E" },
    };
    ws.getColumn(i + 1).width = c.ancho;
    if (["telefono", "codigoPostal", "numeroImpreso"].includes(c.clave))
      ws.getColumn(i + 1).numFmt = "@";
  });

  const ins = wb.addWorksheet("Instrucciones");
  const lineas = [
    ["Cómo llenar la plantilla"],
    [
      "1. Escribe un cliente por fila en la hoja «Clientes», empezando en la fila 2. No cambies los encabezados ni su orden.",
    ],
    [
      "2. Los campos con * son obligatorios. Correo, referencias, notas y número de contrato pueden ir vacíos.",
    ],
    ["3. Teléfono: 10 dígitos, sin espacios. Código postal: 5 dígitos."],
    [
      "4. Número de contrato (papel): el que trae impreso el contrato firmado, por ejemplo 60109A. Se guarda para usarlo después al crear su contrato.",
    ],
    [
      "5. Máximo 1000 clientes por archivo. Si un cliente ya existe (mismo nombre y teléfono), se omite.",
    ],
    [""],
    ["Ejemplo de una fila completa (no la copies tal cual):"],
    COLUMNAS.map((c) => c.titulo),
    [
      "JUAN PEREZ LOPEZ",
      "7131234567",
      "juan@correo.com",
      "LAS PALMAS 15",
      "SAN JOSE MEZAPA",
      "52600",
      "",
      "",
      "60109A",
    ],
  ];
  lineas.forEach((fila, i) => {
    fila.forEach((valor, j) => {
      const celda = ins.getCell(i + 1, j + 1);
      celda.value = valor;
      celda.font = { name: "Arial", size: 10, bold: i === 0 || i === 8 };
    });
  });
  ins.getColumn(1).width = 36;
  for (let j = 2; j <= COLUMNAS.length; j += 1) ins.getColumn(j).width = 22;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  COLUMNAS,
  MAX_FILAS,
  leerExcel,
  validarFila,
  crearPlantilla,
  claveNombre,
  claveDeEncabezado,
};
