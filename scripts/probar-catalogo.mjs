// Prueba que el servidor calcula el total de la tiendita con SU catálogo.
//
//   node scripts/probar-catalogo.mjs https://mi-app.vercel.app
//
// No necesita secretos. Crea 3 QR reales de Pey (uno de $54, uno de $54 con
// trampa y uno de $0.01) que nadie paga: es inofensivo.
//
// Lo importante: el celular solo manda "qué producto y cuántos". Si manda un
// precio o un monto propio, el servidor lo ignora.

const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const resultados = [];
const hora = () => new Date().toISOString();

function revisar(nombre, paso, detalle) {
  resultados.push(paso);
  console.log(`${paso ? "PASA " : "FALLA"} | ${hora()} | ${nombre} | ${detalle}`);
}

async function pedir(cuerpo) {
  const r = await fetch(`${base}/api/cobros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
}

console.log(`Probando ${base}\n`);

// ---------------------------------------------------------------- total correcto
const venta = [
  { id: "agua", cantidad: 2 },
  { id: "doritos", cantidad: 1 },
];
const buena = await pedir({ items: venta });
revisar(
  "Venta con productos → total calculado por el servidor ($54)",
  buena.status === 201 && buena.json?.monto === 54 && buena.json?.items?.length === 2,
  `HTTP ${buena.status}, monto=${buena.json?.monto}, items=${JSON.stringify(buena.json?.items?.map((i) => `${i.cantidad}x${i.nombre}@${i.precio}`))}`,
);

if (buena.json?.ref) {
  const estado = await (await fetch(`${base}/api/cobros/${buena.json.ref}`, { cache: "no-store" })).json();
  revisar(
    "El estado del cobro devuelve lo vendido",
    estado.estado === "esperando" && estado.items?.length === 2 && estado.items[0].nombre === "Agua natural",
    `estado=${estado.estado}, items=${estado.items?.length}`,
  );
}

// ---------------------------------------------------------------- el celular no puede cambiar el precio
{
  const tramposa = await pedir({
    monto: "0.01",
    total: 0.01,
    items: [
      { id: "agua", cantidad: 2, precio: 0.01, centavos: 1 },
      { id: "doritos", cantidad: 1, precio: 0.01 },
    ],
  });
  revisar(
    "Precio o monto falsos en la petición → se ignoran (sigue siendo $54)",
    tramposa.status === 201 && tramposa.json?.monto === 54,
    `HTTP ${tramposa.status}, monto=${tramposa.json?.monto}`,
  );
}

// ---------------------------------------------------------------- peticiones inválidas
const invalidas = [
  ["Producto que no existe", { items: [{ id: "no-existe", cantidad: 1 }] }],
  ["Cantidad cero", { items: [{ id: "agua", cantidad: 0 }] }],
  ["Cantidad negativa", { items: [{ id: "agua", cantidad: -1 }] }],
  ["Cantidad con decimales", { items: [{ id: "agua", cantidad: 1.5 }] }],
  ["Cantidad como texto", { items: [{ id: "agua", cantidad: "2" }] }],
  ["Cantidad enorme", { items: [{ id: "agua", cantidad: 100 }] }],
  ["El mismo producto repetido que pasa del máximo", { items: [{ id: "agua", cantidad: 60 }, { id: "agua", cantidad: 60 }] }],
  ["Lista de productos vacía", { items: [] }],
  ["Productos que no son una lista", { items: "agua" }],
  ["Productos nulos", { items: null }],
  ["Línea sin id", { items: [{ cantidad: 1 }] }],
  ["Sin productos ni monto", {}],
  ["Cuerpo que no es JSON", "esto no es json"],
];
for (const [nombre, cuerpo] of invalidas) {
  const r = await pedir(cuerpo);
  revisar(`${nombre} → rechazado`, r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

// ---------------------------------------------------------------- el monto libre sigue funcionando
{
  const libre = await pedir({ monto: "0.01" });
  revisar(
    "Monto libre ($0.01) sigue funcionando y no trae productos",
    libre.status === 201 && libre.json?.monto === 0.01 && libre.json?.items === undefined,
    `HTTP ${libre.status}, monto=${libre.json?.monto}`,
  );
}

const fallas = resultados.filter((r) => !r).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} pasan.`);
process.exit(fallas === 0 ? 0 : 1);
