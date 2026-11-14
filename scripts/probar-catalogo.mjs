// Prueba que el servidor calcula el total del pedido con SU catálogo, valida la
// hora de entrega y que el registro del día no cuenta lo que nadie ha pagado.
//
//   node scripts/probar-catalogo.mjs https://mi-app.vercel.app
//
// No necesita secretos. Crea 5 QR reales de Pey que nadie paga: es inofensivo.
//
// OJO: los totales esperados suponen PRECIOS_DE_PRUEBA = true en lib/catalogo.ts
// (todo cuesta $0.01). Con los precios reales hay que ajustar PRECIO.
//
// Lo importante: el celular solo manda "qué platillo, cuántos y en cuántos
// minutos". Si manda un precio o un monto propio, el servidor lo ignora.

const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const PRECIO = 0.01;
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

const pedido = [
  { id: "bowl-avena", cantidad: 2 },
  { id: "chilaquiles", cantidad: 1 },
];
const total = Math.round(3 * PRECIO * 100) / 100;

console.log(`Probando ${base}\n`);

// ---------------------------------------------------------------- total correcto
const buena = await pedir({ items: pedido, minutos: 20 });
revisar(
  `Pedido del menú → total calculado por el servidor ($${total})`,
  buena.status === 201 && buena.json?.monto === total && buena.json?.items?.length === 2 && buena.json?.minutos === 20,
  `HTTP ${buena.status}, monto=${buena.json?.monto}, minutos=${buena.json?.minutos}, items=${JSON.stringify(buena.json?.items?.map((i) => `${i.cantidad}x${i.nombre}@${i.precio}`))}`,
);

if (buena.json?.ref) {
  const estado = await (await fetch(`${base}/api/cobros/${buena.json.ref}`, { cache: "no-store" })).json();
  revisar(
    "El estado del cobro devuelve lo pedido y los minutos, sin hora de recoger mientras no se pague",
    estado.estado === "esperando" &&
      estado.items?.length === 2 &&
      estado.items[0].nombre === "Bowl de Avena" &&
      estado.minutos === 20 &&
      estado.recogerEn === undefined &&
      estado.numero === undefined,
    `estado=${estado.estado}, minutos=${estado.minutos}, recogerEn=${estado.recogerEn}, numero=${estado.numero}`,
  );

  const registro = await (await fetch(`${base}/api/registro`, { cache: "no-store" })).json();
  revisar(
    "El registro del día solo lista lo que el banco ya selló (un cobro esperando no sale)",
    typeof registro.cuantos === "number" &&
      Array.isArray(registro.cobros) &&
      registro.cuantos === registro.cobros.length &&
      /^\d{4}-\d{2}-\d{2}$/.test(registro.dia) &&
      !registro.cobros.some((c) => c.ref === buena.json.ref),
    `dia=${registro.dia}, cuantos=${registro.cuantos}, suma=${registro.sumaCentavos} centavos`,
  );
}

// ---------------------------------------------------------------- el celular no puede cambiar el precio
{
  const tramposa = await pedir({
    monto: "0.01",
    total: 9999,
    minutos: 20,
    items: [
      { id: "bowl-avena", cantidad: 2, precio: 9999, centavos: 999900 },
      { id: "chilaquiles", cantidad: 1, precio: 9999 },
    ],
  });
  revisar(
    `Precio o monto falsos en la petición → se ignoran (sigue siendo $${total})`,
    tramposa.status === 201 && tramposa.json?.monto === total,
    `HTTP ${tramposa.status}, monto=${tramposa.json?.monto}`,
  );
}

// ---------------------------------------------------------------- hora de entrega
{
  const sinMinutos = await pedir({ items: pedido });
  revisar(
    "Pedido sin minutos → se acepta (queda sin hora de entrega)",
    sinMinutos.status === 201 && sinMinutos.json?.minutos === undefined,
    `HTTP ${sinMinutos.status}, minutos=${sinMinutos.json?.minutos}`,
  );
}
for (const [nombre, minutos] of [
  ["Minutos de menos (4)", 4],
  ["Minutos de más (181)", 181],
  ["Minutos en cero", 0],
  ["Minutos negativos", -5],
  ["Minutos con decimales", 20.5],
  ["Minutos como texto", "20"],
]) {
  const r = await pedir({ items: pedido, minutos });
  revisar(`${nombre} → rechazado`, r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

// ---------------------------------------------------------------- peticiones inválidas
const invalidas = [
  ["Platillo que no existe", { items: [{ id: "no-existe", cantidad: 1 }] }],
  ["Cantidad cero", { items: [{ id: "bowl-avena", cantidad: 0 }] }],
  ["Cantidad negativa", { items: [{ id: "bowl-avena", cantidad: -1 }] }],
  ["Cantidad con decimales", { items: [{ id: "bowl-avena", cantidad: 1.5 }] }],
  ["Cantidad como texto", { items: [{ id: "bowl-avena", cantidad: "2" }] }],
  ["Cantidad enorme", { items: [{ id: "bowl-avena", cantidad: 100 }] }],
  ["El mismo platillo repetido que pasa del máximo", { items: [{ id: "bowl-avena", cantidad: 60 }, { id: "bowl-avena", cantidad: 60 }] }],
  ["Lista de platillos vacía", { items: [] }],
  ["Platillos que no son una lista", { items: "bowl-avena" }],
  ["Platillos nulos", { items: null }],
  ["Línea sin id", { items: [{ cantidad: 1 }] }],
  ["Sin platillos ni monto", {}],
  ["Cuerpo que no es JSON", "esto no es json"],
];
for (const [nombre, cuerpo] of invalidas) {
  const r = await pedir(cuerpo);
  revisar(`${nombre} → rechazado`, r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

// ---------------------------------------------------------------- el monto libre sigue funcionando
{
  const libre = await pedir({ monto: "0.01", minutos: 20 });
  revisar(
    "Monto libre ($0.01) sigue funcionando, sin platillos ni hora de entrega",
    libre.status === 201 && libre.json?.monto === 0.01 && libre.json?.items === undefined && libre.json?.minutos === undefined,
    `HTTP ${libre.status}, monto=${libre.json?.monto}, minutos=${libre.json?.minutos}`,
  );
}

const fallas = resultados.filter((r) => !r).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} pasan.`);
process.exit(fallas === 0 ? 0 : 1);
