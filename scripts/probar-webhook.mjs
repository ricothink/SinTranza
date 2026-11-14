// Prueba el webhook de punta a punta contra una instancia de la app.
//
//   node scripts/probar-webhook.mjs https://mi-app.vercel.app
//
// Necesita PEY_WEBHOOK_SECRET en el entorno (el mismo que usa la app) porque
// firma avisos de prueba igual que lo hace Pey. Crea un cobro de $0.01 y revisa:
//   - firma inválida, cuerpo alterado, aviso viejo o sin firma → rechazados
//   - aviso válido → el cobro pasa a "pagado"
//   - el mismo aviso reenviado → no se marca dos veces
//   - el navegador no puede marcar "pagado" por su cuenta
//
// OJO: el aviso válido de esta prueba es SIMULADO (lo firmamos nosotros).
// No sustituye la prueba con un pago real.

import { randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const secreto = process.env.PEY_WEBHOOK_SECRET;
if (!secreto) {
  console.error("Falta PEY_WEBHOOK_SECRET en el entorno.");
  process.exit(2);
}

const firmador = new Webhook(secreto);
const resultados = [];
const hora = () => new Date().toISOString();

function revisar(nombre, paso, detalle) {
  resultados.push({ nombre, paso });
  console.log(`${paso ? "PASA " : "FALLA"} | ${hora()} | ${nombre} | ${detalle}`);
}

async function crearCobro() {
  const r = await fetch(`${base}/api/cobros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monto: "0.01" }),
  });
  const datos = await r.json();
  if (r.status !== 201) throw new Error(`No se pudo crear el cobro: ${r.status} ${JSON.stringify(datos)}`);
  // El identificador del QR viene dentro del propio texto del QR (campo IDC).
  const codiQrId = JSON.parse(datos.qrString).ic.IDC;
  return { ref: datos.ref, codiQrId };
}

const estado = async (ref) => (await fetch(`${base}/api/cobros/${ref}`, { cache: "no-store" })).json();

function aviso(ref, codiQrId) {
  return JSON.stringify({
    amount: 0.01,
    apiKeyId: "01M3QMMR6X9CBVDY1SF3G8QWNW",
    codiQrId,
    concept: "Cobro Ya cayo",
    datePaid: Math.floor(Date.now() / 1000),
    metadata: {},
    numRef: ref,
    transactionId: "01M3QR8H0RH0XBCKYYD242YXNV",
    type: "codi.qr.payment_received",
  });
}

function cabecerasFirmadas(cuerpo, { id = `msg_${randomUUID()}`, fecha = new Date() } = {}) {
  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(fecha.getTime() / 1000)),
    "webhook-signature": firmador.sign(id, fecha, cuerpo),
  };
}

async function enviar(cuerpo, cabeceras) {
  const r = await fetch(`${base}/api/webhooks/pey`, { method: "POST", headers: cabeceras, body: cuerpo });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
}

console.log(`Probando ${base}\n`);

// ---------------------------------------------------------------- firma inválida
const a = await crearCobro();
console.log(`Cobro A creado: ref=${a.ref} codiQrId=${a.codiQrId}`);
revisar("Cobro nuevo nace esperando", (await estado(a.ref)).estado === "esperando", `estado=${(await estado(a.ref)).estado}`);

const cuerpoA = aviso(a.ref, a.codiQrId);
const buenasA = cabecerasFirmadas(cuerpoA);

{
  const firmaFalsa = { ...buenasA, "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  const r = await enviar(cuerpoA, firmaFalsa);
  revisar("Firma inventada → rechazado", r.status === 401, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}
{
  const otroSecreto = new Webhook("whsec_" + Buffer.from("otro-secreto-que-no-es-el-bueno!").toString("base64"));
  const id = `msg_${randomUUID()}`;
  const fecha = new Date();
  const r = await enviar(cuerpoA, {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(fecha.getTime() / 1000)),
    "webhook-signature": otroSecreto.sign(id, fecha, cuerpoA),
  });
  revisar("Firmado con otro secreto → rechazado", r.status === 401, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}
{
  const alterado = cuerpoA.replace('"amount":0.01', '"amount":9999');
  const r = await enviar(alterado, buenasA);
  revisar("Firma buena pero cuerpo alterado → rechazado", r.status === 401, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}
{
  const r = await enviar(cuerpoA, { "Content-Type": "application/json" });
  revisar("Sin cabeceras de firma → rechazado", r.status === 401, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}
{
  const vieja = cabecerasFirmadas(cuerpoA, { fecha: new Date(Date.now() - 10 * 60 * 1000) });
  const r = await enviar(cuerpoA, vieja);
  revisar("Firma válida pero de hace 10 min → rechazado", r.status === 401, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}
{
  const e = await estado(a.ref);
  revisar("Tras 5 rechazos el cobro sigue esperando", e.estado === "esperando" && e.pagadoEn === undefined, `estado=${e.estado}`);
}

// ---------------------------------------------------------------- el navegador no puede marcar
for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
  const r = await fetch(`${base}/api/cobros/${a.ref}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ estado: "pagado" }),
  });
  const e = await estado(a.ref);
  revisar(`${metodo} al estado desde fuera → no cambia nada`, r.status === 405 && e.estado === "esperando", `HTTP ${r.status}, estado=${e.estado}`);
}

// ---------------------------------------------------------------- referencia correcta, QR equivocado
{
  const cuerpo = aviso(a.ref, "0000000000");
  const r = await enviar(cuerpo, cabecerasFirmadas(cuerpo));
  const e = await estado(a.ref);
  revisar(
    "Firma válida pero QR distinto → no marca",
    r.status === 200 && r.json?.resultado === "qr_distinto" && e.estado === "esperando",
    `HTTP ${r.status} ${JSON.stringify(r.json)}, estado=${e.estado}`,
  );
}

// ---------------------------------------------------------------- aviso válido y reenvíos
const primero = await enviar(cuerpoA, buenasA);
const trasPrimero = await estado(a.ref);
revisar(
  "Aviso válido → queda pagado",
  primero.status === 200 && primero.json?.resultado === "marcado" && trasPrimero.estado === "pagado",
  `HTTP ${primero.status} ${JSON.stringify(primero.json)}, estado=${trasPrimero.estado}, avisoEn=${trasPrimero.avisoEn}`,
);

await new Promise((r) => setTimeout(r, 1200));

const segundo = await enviar(cuerpoA, buenasA);
const trasSegundo = await estado(a.ref);
revisar(
  "MISMO aviso reenviado (idéntico) → no se marca dos veces",
  segundo.status === 200 && segundo.json?.resultado === "ya_pagado" && trasSegundo.avisoEn === trasPrimero.avisoEn,
  `HTTP ${segundo.status} ${JSON.stringify(segundo.json)}, avisoEn antes=${trasPrimero.avisoEn} después=${trasSegundo.avisoEn}`,
);

const tercero = await enviar(cuerpoA, cabecerasFirmadas(cuerpoA));
const trasTercero = await estado(a.ref);
revisar(
  "Mismo pago con otro id de aviso → tampoco se marca dos veces",
  tercero.status === 200 && tercero.json?.resultado === "ya_pagado" && trasTercero.avisoEn === trasPrimero.avisoEn,
  `HTTP ${tercero.status} ${JSON.stringify(tercero.json)}, avisoEn=${trasTercero.avisoEn}`,
);

{
  const rafaga = await Promise.all(Array.from({ length: 10 }, () => enviar(cuerpoA, cabecerasFirmadas(cuerpoA))));
  const b = await crearCobro();
  const cuerpoB = aviso(b.ref, b.codiQrId);
  const juntos = await Promise.all(Array.from({ length: 10 }, () => enviar(cuerpoB, cabecerasFirmadas(cuerpoB))));
  const marcados = juntos.filter((r) => r.json?.resultado === "marcado").length;
  const repetidos = juntos.filter((r) => r.json?.resultado === "ya_pagado").length;
  revisar(
    "10 avisos al mismo tiempo sobre un cobro nuevo → solo 1 marca",
    marcados === 1 && repetidos === 9 && rafaga.every((r) => r.json?.resultado === "ya_pagado"),
    `ref=${b.ref}: marcado=${marcados}, ya_pagado=${repetidos}`,
  );
}

// ---------------------------------------------------------------- referencia que no existe
{
  const cuerpo = aviso("1", "0000000000");
  const r = await enviar(cuerpo, cabecerasFirmadas(cuerpo));
  revisar("Aviso de un cobro que no existe → se acusa y no crea nada", r.status === 200 && r.json?.resultado === "no_existe", `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

const fallas = resultados.filter((r) => !r.paso).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} pasan.`);
process.exit(fallas === 0 ? 0 : 1);
