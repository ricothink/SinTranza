// Prueba el PIN del mostrador, el cobro por enlace de pago, el seguimiento del
// cliente y que cada aviso de Pey solo marca el cobro que le toca.
//
//   PIN_MOSTRADOR=123456 PEY_WEBHOOK_SECRET=whsec_... node scripts/probar-remoto.mjs https://mi-app.vercel.app
//
// Crea 3 cobros reales en Pey (un enlace de pago y un QR, que nadie paga, y otro
// enlace) y firma avisos simulados con el secreto: NO sustituye una prueba real
// con un celular y una tarjeta. La prueba de bloqueo por intentos solo corre
// contra localhost (para no bloquear una dirección real).
//
// OJO: no se manda ninguna solicitud de pago a un celular (eso llega a una
// persona de verdad); la solicitud al celular solo se prueba con tu propio
// número, a mano.

import { randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { conSesion, entrar } from "./sesion-pruebas.mjs";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const secreto = process.env.PEY_WEBHOOK_SECRET;
if (!secreto) {
  console.error("Falta PEY_WEBHOOK_SECRET en el entorno.");
  process.exit(2);
}
const esLocal = /localhost|127\.0\.0\.1/.test(base);
/** Celular de mentira: sirve solo para ver que el WhatsApp sale y que el registro lo guarda. */
const CELULAR_DE_PRUEBA = "5500000001";

const firmador = new Webhook(secreto);
const resultados = [];
const hora = () => new Date().toISOString();
const revisar = (nombre, paso, detalle) => {
  resultados.push(paso);
  console.log(`${paso ? "PASA " : "FALLA"} | ${hora()} | ${nombre} | ${detalle}`);
};
const json = async (r) => {
  try {
    return await r.json();
  } catch {
    return null;
  }
};

console.log(`Probando ${base}\n`);

// ---------------------------------------------------------------- acceso con PIN
const sinSesion = [
  ["Crear un cobro", () => fetch(`${base}/api/cobros`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monto: "0.01" }) })],
  ["Mandar una solicitud al celular", () => fetch(`${base}/api/cobros`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monto: "0.01", metodo: "push", telefono: CELULAR_DE_PRUEBA }) })],
  ["Ver el registro", () => fetch(`${base}/api/registro`)],
  ["Ver el estado de un cobro", () => fetch(`${base}/api/cobros/1234567`)],
];
for (const [nombre, llamar] of sinSesion) {
  const r = await llamar();
  revisar(`Sin PIN: ${nombre} → cerrado`, r.status === 401, `HTTP ${r.status}`);
}

{
  const mal = await fetch(`${base}/api/sesion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "000000" }) });
  revisar("PIN equivocado → rechazado y sin cookie", mal.status === 401 && !mal.headers.get("set-cookie"), `HTTP ${mal.status}`);
}

const cookie = await entrar(base);
{
  const dentro = await (await fetch(`${base}/api/sesion`, conSesion(cookie))).json();
  const fuera = await (await fetch(`${base}/api/sesion`)).json();
  revisar("Con el PIN correcto la sesión vale; sin cookie no", dentro.ok === true && fuera.ok === false, `con cookie=${dentro.ok}, sin cookie=${fuera.ok}`);

  const [nombre, valor] = cookie.split("=");
  const falsa = `${nombre}=${valor.slice(0, -2)}${valor.endsWith("AA") ? "BB" : "AA"}`;
  const r = await fetch(`${base}/api/registro`, conSesion(falsa));
  revisar("Cookie con la firma alterada → rechazada", r.status === 401, `HTTP ${r.status}`);

  const vencida = `${nombre}=1.${valor.split(".")[1]}`;
  const v = await fetch(`${base}/api/registro`, conSesion(vencida));
  revisar("Cookie con otra hora de vencimiento (firma ya no cuadra) → rechazada", v.status === 401, `HTTP ${v.status}`);

  const salir = await fetch(`${base}/api/sesion`, { method: "DELETE" });
  revisar("Cerrar el mostrador borra la cookie", /Max-Age=0/i.test(salir.headers.get("set-cookie") ?? ""), salir.headers.get("set-cookie")?.slice(0, 60) ?? "(sin cookie)");
}

if (esLocal) {
  // Una dirección de mentira distinta en cada corrida, para no chocar con el bloqueo de la corrida anterior.
  const intruso = { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${1 + Math.floor(Math.random() * 250)}` };
  const codigos = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${base}/api/sesion`, { method: "POST", headers: intruso, body: JSON.stringify({ pin: `99999${i}` }) });
    codigos.push(r.status);
  }
  const buena = await fetch(`${base}/api/sesion`, { method: "POST", headers: intruso, body: JSON.stringify({ pin: process.env.PIN_MOSTRADOR }) });
  revisar(
    "5 PIN equivocados seguidos bloquean a esa dirección: ni el PIN correcto entra",
    codigos.slice(0, 4).every((c) => c === 401) && codigos[4] === 429 && buena.status === 429,
    `intentos=${codigos.join(",")}, luego PIN correcto → ${buena.status}`,
  );
}

// ---------------------------------------------------------------- validaciones de la solicitud al celular (sin llamar a Pey)
const pedir = async (cuerpo) => {
  const r = await fetch(`${base}/api/cobros`, conSesion(cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }));
  return { status: r.status, json: await json(r) };
};
for (const [nombre, cuerpo] of [
  ["Solicitud al celular sin celular", { monto: "0.01", metodo: "push" }],
  ["Celular con menos de 10 dígitos", { monto: "0.01", metodo: "push", telefono: "123" }],
  ["Celular con letras", { monto: "0.01", metodo: "push", telefono: "55123456ab" }],
  ["Celular de 11 dígitos", { monto: "0.01", metodo: "push", telefono: "55123456789" }],
  ["Celular como número", { monto: "0.01", metodo: "push", telefono: 5512345678 }],
  ["Forma de pago que no existe", { monto: "0.01", metodo: "efectivo" }],
  ["Enlace con celular inválido", { monto: "0.01", metodo: "link", telefono: "abc" }],
]) {
  const r = await pedir(cuerpo);
  revisar(`${nombre} → rechazado antes de llamar a Pey`, r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

// ---------------------------------------------------------------- enlace de pago
const enlace = await pedir({ items: [{ id: "chilaquiles", cantidad: 1 }], minutos: 20, metodo: "link", telefono: CELULAR_DE_PRUEBA });
const datos = enlace.json ?? {};
revisar(
  "Enlace de pago creado en Pey: trae la página de pago, el seguimiento y la hora de entrega",
  enlace.status === 201 &&
    typeof datos.enlaceDePago === "string" &&
    datos.enlaceDePago.startsWith("https://") &&
    typeof datos.enlaceId === "string" &&
    datos.metodo === "link" &&
    datos.minutos === 20 &&
    new RegExp(`/p/${datos.ref}\\?t=[\\w-]{8,}`).test(datos.seguimiento ?? ""),
  `HTTP ${enlace.status}, ref=${datos.ref}, enlace=${String(datos.enlaceDePago).slice(0, 40)}…, seguimiento=${String(datos.seguimiento).replace(/t=.*/, "t=…")}`,
);
if (enlace.status !== 201) {
  console.log("\nNo se pudo crear el enlace: se detienen las pruebas que dependen de él.");
  process.exit(1);
}
const codigo = new URL(datos.seguimiento).searchParams.get("t");
const seguimiento = async (ref, t) => {
  const r = await fetch(`${base}/api/seguimiento/${ref}${t === undefined ? "" : `?t=${encodeURIComponent(t)}`}`, { cache: "no-store" });
  return { status: r.status, json: await json(r) };
};

{
  const sin = await seguimiento(datos.ref);
  const mal = await seguimiento(datos.ref, "codigo-equivocado");
  const bien = await seguimiento(datos.ref, codigo);
  revisar("Seguimiento del cliente: sin código o con código equivocado → no existe", sin.status === 404 && mal.status === 404, `sin=${sin.status}, mal=${mal.status}`);
  revisar(
    "Seguimiento con su código: estado esperando, enlace de pago y nada de celular ni código",
    bien.status === 200 &&
      bien.json.estado === "esperando" &&
      bien.json.metodo === "link" &&
      bien.json.enlaceDePago === datos.enlaceDePago &&
      !JSON.stringify(bien.json).includes(CELULAR_DE_PRUEBA) &&
      !JSON.stringify(bien.json).includes(codigo),
    `HTTP ${bien.status}, estado=${bien.json?.estado}, campos=${Object.keys(bien.json ?? {}).join(",")}`,
  );
}

const registro = async () => (await fetch(`${base}/api/registro`, conSesion(cookie, { cache: "no-store" }))).json();
{
  const reg = await registro();
  const pendiente = reg.pendientes.find((p) => p.ref === datos.ref);
  revisar(
    "El registro lista el enlace como POR COBRAR (con su celular para el WhatsApp) y no lo cuenta como pagado",
    !!pendiente && pendiente.metodo === "link" && pendiente.telefono === CELULAR_DE_PRUEBA && pendiente.seguimiento === datos.seguimiento && !reg.cobros.some((c) => c.ref === datos.ref),
    `pendientes=${reg.pendientes.length}, pagados=${reg.cuantos}`,
  );
  const v = await (await fetch(`${base}/api/registro?v=${reg.version}`, conSesion(cookie))).json();
  revisar("Preguntar con la versión vigente no baja todo el registro", v.sinCambios === true && v.version === reg.version, JSON.stringify(v));
}

// ---------------------------------------------------------------- avisos de Pey sobre el enlace
const avisoEnlace = ({ status = "paid", linkId = datos.enlaceId, ref = datos.ref, base: monto = 0.01, fee = 0.03 } = {}) =>
  JSON.stringify({
    apiKeyId: "01M3QMMR6X9CBVDY1SF3G8QWNW",
    type: "payment_link.status_updated",
    paymentLinkId: linkId,
    status,
    clientReferenceId: ref,
    transactions: [
      {
        transactionId: "SIMULADO-ENLACE",
        paymentMethod: "CARD",
        datePaid: Math.floor(Date.now() / 1000),
        amount: Math.round((monto + fee) * 100) / 100,
        amountBreakdown: { base: monto, fee },
        applicationFee: null,
        metadata: {},
      },
    ],
  });
const firmar = (cuerpo, fecha = new Date()) => {
  const id = `msg_${randomUUID()}`;
  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(fecha.getTime() / 1000)),
    "webhook-signature": firmador.sign(id, fecha, cuerpo),
  };
};
const mandar = async (cuerpo, cabeceras = firmar(cuerpo)) => {
  const r = await fetch(`${base}/api/webhooks/pey`, { method: "POST", headers: cabeceras, body: cuerpo });
  return { status: r.status, json: await json(r) };
};
const estado = async (ref) => (await fetch(`${base}/api/cobros/${ref}`, conSesion(cookie, { cache: "no-store" }))).json();

{
  const processing = await mandar(avisoEnlace({ status: "processing" }));
  revisar("Aviso de enlace en proceso (processing) → no marca nada", processing.status === 200 && processing.json?.resultado === "ignorado" && (await estado(datos.ref)).estado === "esperando", JSON.stringify(processing.json));

  const cuerpoFalso = avisoEnlace();
  const sinFirma = await mandar(cuerpoFalso, { "Content-Type": "application/json", "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
  revisar("Aviso de enlace con firma inventada → rechazado", sinFirma.status === 401 && (await estado(datos.ref)).estado === "esperando", `HTTP ${sinFirma.status}`);

  const otroEnlace = await mandar(avisoEnlace({ linkId: "01ENLACEQUENOESDEESTECOBRO" }));
  revisar("Pagado, pero de OTRO enlace → no marca", otroEnlace.json?.resultado === "qr_distinto" && (await estado(datos.ref)).estado === "esperando", JSON.stringify(otroEnlace.json));

  const poco = await mandar(avisoEnlace({ base: 0.004 }));
  revisar("Pagado por menos de lo pedido → no marca (monto_distinto)", poco.json?.resultado === "monto_distinto" && (await estado(datos.ref)).estado === "esperando", JSON.stringify(poco.json));

  const bueno = avisoEnlace();
  const marca = await mandar(bueno);
  const e = await estado(datos.ref);
  revisar(
    "Aviso bueno (pagado con tarjeta): queda pagado por la base, anota la comisión y la hora de recoger",
    marca.json?.resultado === "marcado" &&
      e.estado === "pagado" &&
      e.montoPagado === 0.01 &&
      e.comision === 0.03 &&
      Number.isInteger(e.numero) &&
      e.recogerEn === e.pagadoEn + 20 * 60_000,
    `${JSON.stringify(marca.json)}, montoPagado=${e.montoPagado}, comision=${e.comision}, numero=${e.numero}, recoger=${(e.recogerEn - e.pagadoEn) / 60000} min`,
  );

  const otra = await mandar(bueno);
  const e2 = await estado(datos.ref);
  revisar("El mismo aviso otra vez → no se marca dos veces", otra.json?.resultado === "ya_pagado" && e2.numero === e.numero && e2.avisoEn === e.avisoEn, `${JSON.stringify(otra.json)}, numero=${e2.numero}`);

  const reg = await registro();
  const fila = reg.cobros.find((c) => c.ref === datos.ref);
  revisar(
    "El cobro salió de POR COBRAR y entró a pagados con su método, número y celular",
    !reg.pendientes.some((p) => p.ref === datos.ref) && fila?.metodo === "link" && fila?.numero === e.numero && fila?.telefono === CELULAR_DE_PRUEBA && fila?.monto === 0.01,
    `pagados=${reg.cuantos}, pendientes=${reg.pendientes.length}, fila=${JSON.stringify({ metodo: fila?.metodo, numero: fila?.numero })}`,
  );

  const cliente = await seguimiento(datos.ref, codigo);
  revisar(
    "El cliente ve su pago: pagado, número de pedido, hora de recoger y ya sin enlace de pago",
    cliente.json?.estado === "pagado" && cliente.json.numero === e.numero && cliente.json.recogerEn === e.recogerEn && cliente.json.enlaceDePago === undefined,
    `estado=${cliente.json?.estado}, numero=${cliente.json?.numero}`,
  );
}

// ---------------------------------------------------------------- cada aviso solo marca su propio cobro
{
  const qr = await pedir({ monto: "0.01" });
  revisar("Cobro con QR creado para las pruebas cruzadas", qr.status === 201 && !!qr.json?.qrString, `HTTP ${qr.status}, ref=${qr.json?.ref}`);
  if (qr.status === 201) {
    const comoEnlace = await mandar(avisoEnlace({ ref: qr.json.ref, linkId: "01ENLACEINVENTADO" }));
    revisar("Un aviso de ENLACE sobre un cobro de QR → no marca", comoEnlace.json?.resultado === "qr_distinto" && (await estado(qr.json.ref)).estado === "esperando", JSON.stringify(comoEnlace.json));

    const cuerpoPn = JSON.stringify({
      amount: 0.01,
      apiKeyId: "01M3QMMR6X9CBVDY1SF3G8QWNW",
      concept: "Milpa Cocina de Raiz",
      datePaid: Math.floor(Date.now() / 1000),
      metadata: {},
      numRef: qr.json.ref,
      transactionId: "SIMULADO-PN",
      type: "codi.pn.payment_received",
    });
    const comoSolicitud = await mandar(cuerpoPn);
    revisar("Un aviso de SOLICITUD AL CELULAR sobre un cobro de QR → no marca", comoSolicitud.json?.resultado === "qr_distinto" && (await estado(qr.json.ref)).estado === "esperando", JSON.stringify(comoSolicitud.json));
  }

  const inexistente = await mandar(avisoEnlace({ ref: "1", linkId: "01X" }));
  revisar("Aviso de enlace de un cobro que no existe → se acusa y no crea nada", inexistente.status === 200 && inexistente.json?.resultado === "no_existe", JSON.stringify(inexistente.json));
}

const fallas = resultados.filter((r) => !r).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} pasan.`);
process.exit(fallas === 0 ? 0 : 1);
