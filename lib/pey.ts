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
