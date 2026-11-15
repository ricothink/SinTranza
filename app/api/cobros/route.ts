// POST /api/cobros   (solo con sesión del mostrador)
// Recibe la venta, guarda el cobro como "esperando", lo pide a Pey y devuelve
// lo que el mostrador necesita para cobrarlo.
//
// La venta llega de dos formas:
//   { items: [{ id, cantidad }], minutos } → pedido del menú: el servidor calcula
//                                   el total con SU catálogo (lib/catalogo.ts).
//                                   "minutos" = en cuánto estará listo, contado
//                                   desde el pago (de 5 a 180).
//   { monto: "150.50" }           → cobro de monto libre (teclado), sin hora de entrega.
// Si vienen las dos, solo cuentan los productos: el monto que mande el celular
// no puede cambiar el total.
//
// Y se puede cobrar de tres maneras ("metodo"):
//   "qr"   (por omisión) → QR en la pantalla del mostrador, para quien está presente.
//   "push"               → solicitud de pago CoDi al celular del cliente ("telefono",
//                          10 dígitos, obligatorio): sin escanear nada.
//   "link"               → enlace de pago de Pey (tarjeta, Apple Pay, Google Pay o
//                          CoDi) para mandarlo por WhatsApp. "telefono" es opcional.

import { NextResponse } from "next/server";
import { armarCobro, leerMinutos, type LineaCobro } from "@/lib/catalogo";
import {
  AlmacenNoConfigurado,
  anotarEnCobro,
  asignarQr,
  descartarCobro,
  guardarCobroEsperando,
  type Metodo,
} from "@/lib/cobros";
import { urlPublica, NEGOCIO } from "@/lib/negocio";
import {
  crearEnlaceDePago,
  crearQrCodi,
  crearSolicitudCelular,
  EXPIRACION_MINIMA_SEGUNDOS,
  FORMATO_CELULAR,
  MONTO_MAXIMO_PN,
  PeyError,
} from "@/lib/pey";
import { exigirSesion } from "@/lib/sesion";

export const dynamic = "force-dynamic";

/** El QR vive lo mínimo que permite Pey: 6 minutos. */
const SEGUNDOS_DEL_QR = EXPIRACION_MINIMA_SEGUNDOS;

/** La solicitud al celular le da tiempo al cliente de abrir su banco: 30 minutos. */
const SEGUNDOS_DE_LA_SOLICITUD = 30 * 60;

/** El enlace de pago no vence en Pey; en pantalla se muestra "activo" 24 horas. */
const SEGUNDOS_DEL_ENLACE_EN_PANTALLA = 24 * 60 * 60;

const sinCache = { "Cache-Control": "no-store" };

const error400 = (mensaje: string) => NextResponse.json({ error: mensaje }, { status: 400, headers: sinCache });

/** Acepta 150, "150", "150.5", "0.01". Rechaza negativos, cero y más de 2 decimales. */
function leerMonto(valor: unknown): number | null {
  const texto = typeof valor === "number" ? String(valor) : typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(texto)) return null;
  const monto = Number(texto);
  return monto > 0 ? monto : null;
}

export async function POST(peticion: Request) {
  const bloqueo = exigirSesion(peticion);
  if (bloqueo) return bloqueo;

  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return error400("Falta el monto");
  }

  const entrada = cuerpo as { monto?: unknown; items?: unknown; minutos?: unknown; metodo?: unknown; telefono?: unknown } | null;

  // ---- cómo va a pagar
  const metodoPedido = entrada?.metodo ?? "qr";
  if (metodoPedido !== "qr" && metodoPedido !== "push" && metodoPedido !== "link") {
    return error400("Forma de pago no válida");
  }
  const metodo: Metodo = metodoPedido;

  // ---- celular del cliente (obligatorio para la solicitud, opcional para el enlace)
  let telefono: string | undefined;
  if (entrada?.telefono !== undefined && entrada.telefono !== null && entrada.telefono !== "") {
    if (typeof entrada.telefono !== "string" || !FORMATO_CELULAR.test(entrada.telefono)) {
      return error400("El celular debe ser de 10 dígitos");
    }
    telefono = entrada.telefono;
  }
  if (metodo === "push" && !telefono) return error400("Escribe el celular del cliente (10 dígitos)");

  // ---- qué se cobra
  let monto: number;
  let lineas: LineaCobro[] | undefined;
  let minutos: number | undefined;
  if (entrada?.items !== undefined) {
    const armado = armarCobro(entrada.items);
    if (!armado.ok) return error400(armado.error);
    const tiempo = leerMinutos(entrada.minutos);
    if (!tiempo.ok) return error400(tiempo.error);
    monto = armado.monto;
    lineas = armado.lineas;
    minutos = tiempo.minutos;
  } else {
    const libre = leerMonto(entrada?.monto);
    if (libre === null) return error400("Monto inválido");
    monto = libre;
  }
  if (metodo === "push" && monto > MONTO_MAXIMO_PN) return error400("La solicitud al celular admite hasta $1,000,000");

  const segundosDeVida =
    metodo === "push" ? SEGUNDOS_DE_LA_SOLICITUD : metodo === "link" ? SEGUNDOS_DEL_ENLACE_EN_PANTALLA : SEGUNDOS_DEL_QR;

  let ref: string | null = null;
  try {
    // 1. Se guarda primero como "esperando": así el aviso de pago siempre
    //    encuentra el cobro, por rápido que llegue.
    const cobro = await guardarCobroEsperando({ monto, segundosDeVida, metodo, items: lineas, minutos, telefono });
    ref = cobro.ref;
    const seguimiento = `${urlPublica()}/p/${cobro.ref}?t=${cobro.token}`;
    const base = {
      ref: cobro.ref,
      estado: cobro.estado,
      metodo,
      monto: cobro.monto,
      items: cobro.items,
      minutos: cobro.minutos,
      telefono,
      seguimiento,
      creadoEn: cobro.creadoEn,
      venceEn: cobro.venceEn,
    };

    // 2. Se pide a Pey con esa misma referencia, y 3. se anota qué le tocó,
    //    para que el aviso de pago lo pueda confirmar.
    if (metodo === "qr") {
      const qr = await crearQrCodi({
        amount: monto,
        concept: NEGOCIO.conceptoBanco,
        expiration: SEGUNDOS_DEL_QR,
        numRef: cobro.ref,
      });
      await asignarQr(cobro.ref, qr.id);
      return NextResponse.json({ ...base, qrString: qr.qrString }, { status: 201, headers: sinCache });
    }

    if (metodo === "push") {
      const solicitud = await crearSolicitudCelular({
        amount: monto,
        phoneNumber: telefono as string,
        concept: NEGOCIO.conceptoBanco,
        expiration: SEGUNDOS_DE_LA_SOLICITUD,
        numRef: cobro.ref,
      });
      await anotarEnCobro(cobro.ref, { pnTransactionId: solicitud.transactionId });
      return NextResponse.json(base, { status: 201, headers: sinCache });
    }

    const enlace = await crearEnlaceDePago({
      amount: monto,
      successUrl: seguimiento,
      backUrl: seguimiento,
      clientReferenceId: cobro.ref,
    });
    await anotarEnCobro(cobro.ref, { linkId: enlace.id, linkUrl: enlace.url });
    return NextResponse.json({ ...base, enlaceDePago: enlace.url, enlaceId: enlace.id }, { status: 201, headers: sinCache });
  } catch (error) {
    // Si el cobro se apartó pero Pey no lo aceptó, se borra: nadie lo puede pagar.
    if (ref) await descartarCobro(ref).catch(() => {});

    if (error instanceof AlmacenNoConfigurado || (error instanceof PeyError && error.message.includes("PEY_API_KEY"))) {
      console.error("[cobros] app sin configurar:", error.message);
      return NextResponse.json({ error: "La app todavía no está configurada" }, { status: 503, headers: sinCache });
    }
    if (error instanceof PeyError) {
      console.error(`[cobros] Pey falló (${metodo}):`, error.message, JSON.stringify(error.cuerpo));
      if (metodo === "push" && error.status === 400) {
        return NextResponse.json(
          { error: "Pey no pudo mandar la solicitud a ese celular. Revisa el número; si no tiene CoDi, usa el enlace de pago." },
          { status: 422, headers: sinCache },
        );
      }
      const que = metodo === "qr" ? "el QR" : metodo === "push" ? "la solicitud" : "el enlace de pago";
      return NextResponse.json({ error: `No se pudo generar ${que}. Intenta de nuevo.` }, { status: 502, headers: sinCache });
    }
    console.error("[cobros] error inesperado:", error);
    return NextResponse.json({ error: "Algo falló. Intenta de nuevo." }, { status: 500, headers: sinCache });
  }
}
