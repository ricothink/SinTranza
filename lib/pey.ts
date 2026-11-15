// Cliente del API de Pey.
//
// Todos los nombres de campos, cabeceras y eventos de este archivo vienen de
// docs.pey.mx (leído el 2026-11-14). No se inventó ninguno:
//   - POST /codi/qr ............ docs.pey.mx/docs/api/create-qr
//   - codi.qr.payment_received . docs.pey.mx/docs/webhooks/codi/qr
//   - Firma Standard Webhooks .. docs.pey.mx/docs/webhooks/introduction

import { Webhook } from "standardwebhooks";

const URL_BASE_POR_DEFECTO = "https://api.pey.mx";

/** Pey exige mínimo 360 s (6 min) cuando se manda expiración distinta de 0. */
export const EXPIRACION_MINIMA_SEGUNDOS = 360;

/** numRef: solo dígitos, de 1 a 7. Es la regla literal de la doc. */
export const FORMATO_NUM_REF = /^[0-9]{1,7}$/;

/** Único evento que nos interesa: pago recibido en un QR CoDi creado por API. */
export const EVENTO_PAGO_QR = "codi.qr.payment_received";

/** Cuerpo de POST /codi/qr (solo los campos que usamos). */
export type CrearQrCodiEntrada = {
  /** Monto en pesos MXN (no centavos). */
  amount: number;
  /** Concepto que ve quien paga. */
  concept: string;
  /** Segundos hasta que vence. Mínimo 360. */
  expiration: number;
  /** Referencia numérica, hasta 7 dígitos. */
  numRef: string;
};

/** Respuesta 201 de POST /codi/qr. */
export type QrCodi = {
  /** Identificador del QR (IDC) que asigna Banxico. Llega en el webhook como codiQrId. */
  id: string;
  /** Texto que hay que convertir en imagen QR. */
  qrString: string;
};

/** Cuerpo del webhook codi.qr.payment_received. */
export type PagoQrRecibido = {
  amount: number;
  apiKeyId: string;
  bankAccountId?: string;
  codiQrId: string;
  concept: string;
  /** Unix en segundos. */
  datePaid: number;
  metadata?: Record<string, unknown>;
  numRef: string;
  transactionId: string;
  type: typeof EVENTO_PAGO_QR;
};

export class PeyError extends Error {
  constructor(
    mensaje: string,
    /** Código HTTP que respondió Pey; 0 si ni siquiera hubo respuesta. */
    readonly status: number,
    readonly cuerpo: unknown = null,
  ) {
    super(mensaje);
    this.name = "PeyError";
  }
}

/** Crea un QR CoDi con monto, concepto, expiración y referencia. */
export async function crearQrCodi(entrada: CrearQrCodiEntrada): Promise<QrCodi> {
  const apiKey = process.env.PEY_API_KEY;
  if (!apiKey) throw new PeyError("Falta la variable PEY_API_KEY", 0);

  if (!Number.isFinite(entrada.amount) || entrada.amount <= 0) {
    throw new PeyError("El monto debe ser mayor a cero", 0);
  }
  if (!FORMATO_NUM_REF.test(entrada.numRef)) {
    throw new PeyError("numRef debe ser de 1 a 7 dígitos", 0);
  }
  if (!Number.isInteger(entrada.expiration) || entrada.expiration < EXPIRACION_MINIMA_SEGUNDOS) {
    throw new PeyError(`expiration debe ser un entero de al menos ${EXPIRACION_MINIMA_SEGUNDOS} segundos`, 0);
  }

  const base = (process.env.PEY_API_URL || URL_BASE_POR_DEFECTO).replace(/\/+$/, "");

  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}/codi/qr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        amount: entrada.amount,
        concept: entrada.concept,
        expiration: entrada.expiration,
        numRef: entrada.numRef,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (causa) {
    throw new PeyError(`No se pudo conectar con Pey: ${String(causa)}`, 0);
  }

  const texto = await respuesta.text();
  let cuerpo: unknown = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // Pey respondió algo que no es JSON; se conserva el texto para el log.
  }

  if (respuesta.status !== 201) {
    throw new PeyError(`Pey respondió ${respuesta.status} al crear el QR`, respuesta.status, cuerpo);
  }

  const qr = cuerpo as Partial<QrCodi> | null;
  if (!qr || typeof qr.id !== "string" || typeof qr.qrString !== "string") {
    throw new PeyError("Pey respondió 201 pero sin id o qrString", respuesta.status, cuerpo);
  }
  return { id: qr.id, qrString: qr.qrString };
}

/**
 * Verifica la firma Standard Webhooks de un webhook de Pey.
 * Recibe el cuerpo CRUDO (texto tal cual llegó, sin re-serializar).
 * Devuelve el cuerpo ya interpretado si la firma es válida; lanza si no.
 * También rechaza avisos con hora muy vieja o futura (protección anti-repetición).
 */
export function verificarWebhook(cuerpoCrudo: string, cabeceras: Headers, secreto: string): unknown {
  return new Webhook(secreto).verify(cuerpoCrudo, {
    "webhook-id": cabeceras.get("webhook-id") ?? "",
    "webhook-timestamp": cabeceras.get("webhook-timestamp") ?? "",
    "webhook-signature": cabeceras.get("webhook-signature") ?? "",
  });
}

// ---------------------------------------------------------------------------
// Cobro a distancia: solicitud al celular y enlace de pago
//
// Campos tomados de la especificación oficial https://docs.pey.mx/openapi.json
// (leída el 2026-11-14):
//   - POST /codi/pn ............ solicitud de pago CoDi al celular del cliente
//   - POST /payment-link/create  enlace de pago (tarjeta, Apple Pay, Google Pay, CoDi)
//   - webhook codi.pn.payment_received y payment_link.status_updated
// ---------------------------------------------------------------------------

/** Aviso de una solicitud al celular pagada. */
export const EVENTO_PAGO_PN = "codi.pn.payment_received";

/** Aviso de que un enlace de pago cambió de estado. */
export const EVENTO_ENLACE = "payment_link.status_updated";

/** Celular de México: exactamente 10 dígitos (regla literal de la especificación). */
export const FORMATO_CELULAR = /^[0-9]{10}$/;

/** Máximo que acepta Pey en un cobro por solicitud al celular. */
export const MONTO_MAXIMO_PN = 1_000_000;

export type CrearSolicitudCelularEntrada = {
  amount: number;
  phoneNumber: string;
  concept: string;
  expiration: number;
  numRef: string;
};

/** Respuesta 200 de POST /codi/pn. */
export type SolicitudCelular = {
  /** Identificador interno (ULID) para dar seguimiento al pago. */
  transactionId: string;
  /** Folio de Banxico, 20 dígitos. */
  codiId: string;
};

/** Cuerpo del webhook codi.pn.payment_received. */
export type PagoPnRecibido = {
  amount: number;
  apiKeyId: string;
  bankAccountId?: string;
  concept: string;
  /** Unix en segundos. */
  datePaid: number;
  metadata?: Record<string, unknown>;
  numRef: string;
  transactionId: string;
  type: typeof EVENTO_PAGO_PN;
};

export type CrearEnlaceDePagoEntrada = {
  amount: number;
  /** A dónde regresa Pey al cliente al terminar. Debe ser HTTPS. */
  successUrl: string;
  /** A dónde regresa Pey al cliente si se arrepiente. Debe ser HTTPS. */
  backUrl: string;
  /** Nuestra referencia, para reconocer el cobro en el aviso (máx. 255). */
  clientReferenceId: string;
};

/** Respuesta 200 de POST /payment-link/create. */
export type EnlaceDePago = {
  /** ULID del enlace. */
  id: string;
  /** Página de pago del cliente. */
  url: string;
};

export type TransaccionDeEnlace = {
  transactionId: string;
  paymentMethod?: string;
  /** Unix en segundos. */
  datePaid: number;
  amount: number;
  amountBreakdown?: { base: number; tip?: number; fee?: number };
  applicationFee?: number | null;
  metadata?: unknown;
};

/** Cuerpo del webhook payment_link.status_updated. */
export type EnlaceActualizado = {
  apiKeyId: string;
  type: typeof EVENTO_ENLACE;
  paymentLinkId: string;
  /** La doc lista paid, pending y processing (el GET del enlace agrega partial). */
  status: string;
  clientReferenceId?: string;
  transactions?: TransaccionDeEnlace[];
};

/** POST a Pey con la llave. Devuelve el código HTTP y el cuerpo ya interpretado. */
async function postAPey(ruta: string, cuerpo: object): Promise<{ status: number; datos: unknown }> {
  const apiKey = process.env.PEY_API_KEY;
  if (!apiKey) throw new PeyError("Falta la variable PEY_API_KEY", 0);
  const base = (process.env.PEY_API_URL || URL_BASE_POR_DEFECTO).replace(/\/+$/, "");

  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (causa) {
    throw new PeyError(`No se pudo conectar con Pey: ${String(causa)}`, 0);
  }

  const texto = await respuesta.text();
  let datos: unknown = texto;
  try {
    datos = JSON.parse(texto);
  } catch {
    // Pey respondió algo que no es JSON; se conserva el texto para el log.
  }
  return { status: respuesta.status, datos };
}

/** Manda a Pey una solicitud de pago CoDi al celular del cliente. */
export async function crearSolicitudCelular(entrada: CrearSolicitudCelularEntrada): Promise<SolicitudCelular> {
  if (!Number.isFinite(entrada.amount) || entrada.amount <= 0 || entrada.amount > MONTO_MAXIMO_PN) {
    throw new PeyError("El monto de la solicitud debe ser mayor a cero y de hasta $1,000,000", 0);
  }
  if (!FORMATO_CELULAR.test(entrada.phoneNumber)) throw new PeyError("El celular debe ser de 10 dígitos", 0);
  if (!FORMATO_NUM_REF.test(entrada.numRef)) throw new PeyError("numRef debe ser de 1 a 7 dígitos", 0);
  if (!Number.isInteger(entrada.expiration) || entrada.expiration < EXPIRACION_MINIMA_SEGUNDOS) {
    throw new PeyError(`expiration debe ser un entero de al menos ${EXPIRACION_MINIMA_SEGUNDOS} segundos`, 0);
  }

  const { status, datos } = await postAPey("/codi/pn", {
    amount: entrada.amount,
    phoneNumber: entrada.phoneNumber,
    concept: entrada.concept,
    expiration: entrada.expiration,
    numRef: entrada.numRef,
  });
  if (status !== 200) throw new PeyError(`Pey respondió ${status} al mandar la solicitud al celular`, status, datos);

  const respuesta = datos as Partial<SolicitudCelular> | null;
  if (!respuesta || typeof respuesta.transactionId !== "string") {
    throw new PeyError("Pey respondió 200 pero sin transactionId", status, datos);
  }
  return { transactionId: respuesta.transactionId, codiId: String(respuesta.codiId ?? "") };
}

/** Crea un enlace de pago de Pey (el cliente paga con tarjeta, Apple Pay, Google Pay o CoDi). */
export async function crearEnlaceDePago(entrada: CrearEnlaceDePagoEntrada): Promise<EnlaceDePago> {
  if (!Number.isFinite(entrada.amount) || entrada.amount <= 0) throw new PeyError("El monto debe ser mayor a cero", 0);
  if (!entrada.successUrl.startsWith("https://") || !entrada.backUrl.startsWith("https://")) {
    throw new PeyError("Pey exige que successUrl y backUrl sean HTTPS", 0);
  }
  if (entrada.clientReferenceId.length > 255) throw new PeyError("clientReferenceId pasa de 255 caracteres", 0);

  const { status, datos } = await postAPey("/payment-link/create", {
    amount: entrada.amount,
    successUrl: entrada.successUrl,
    backUrl: entrada.backUrl,
    clientReferenceId: entrada.clientReferenceId,
  });
  if (status !== 200) throw new PeyError(`Pey respondió ${status} al crear el enlace de pago`, status, datos);

  const enlace = datos as Partial<EnlaceDePago> | null;
  if (!enlace || typeof enlace.id !== "string" || typeof enlace.url !== "string") {
    throw new PeyError("Pey respondió 200 pero sin id o url", status, datos);
  }
  return { id: enlace.id, url: enlace.url };
}
