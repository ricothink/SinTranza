// PIN del mostrador y sesión.
//
// Todo lo que toca el mostrador (crear cobros, ver el registro, mandar
// solicitudes de pago a un celular) exige haber entrado con el PIN. Lo único
// público es el aviso de Pey (lleva su propia firma) y la página de
// seguimiento del cliente (lleva su propio código).
//
// El PIN vive en la variable PIN_MOSTRADOR (4 a 8 dígitos). La sesión es una
// cookie firmada con SESION_SECRETO que dura 12 horas. Si falta cualquiera de
// las dos variables la app se cierra por completo, nunca se abre sola.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const COOKIE_DE_SESION = "sin_tranza";
export const VIDA_DE_SESION_SEGUNDOS = 12 * 60 * 60;

const secreto = () => process.env.SESION_SECRETO ?? "";

/** true si el PIN y el secreto de la sesión están puestos y son válidos. */
export function sesionConfigurada(): boolean {
  return /^\d{4,8}$/.test(process.env.PIN_MOSTRADOR ?? "") && secreto().length >= 32;
}

const firmar = (valor: string) => createHmac("sha256", secreto()).update(valor).digest("base64url");

/** Valor de la cookie: "<vence en segundos>.<firma>". */
export function crearSesion(): string {
  const vence = String(Math.floor(Date.now() / 1000) + VIDA_DE_SESION_SEGUNDOS);
  return `${vence}.${firmar(vence)}`;
}

export function sesionValida(valor: string | undefined | null): boolean {
  if (!valor || !sesionConfigurada()) return false;
  const [vence, firma] = valor.split(".");
  if (!vence || !firma || !/^\d+$/.test(vence)) return false;
  const esperada = Buffer.from(firmar(vence));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return false;
  return Number(vence) > Date.now() / 1000;
}

/** Compara el PIN en tiempo constante (con hash, para que ni el largo se note). */
export function pinCorrecto(pin: string): boolean {
  if (!sesionConfigurada()) return false;
  const a = createHash("sha256").update(pin).digest();
  const b = createHash("sha256").update(process.env.PIN_MOSTRADOR ?? "").digest();
  return timingSafeEqual(a, b);
}

/** Lee la cookie de sesión de una petición. */
export function leerSesion(peticion: Request): string | undefined {
  const cabecera = peticion.headers.get("cookie") ?? "";
  for (const trozo of cabecera.split(";")) {
    const [nombre, ...resto] = trozo.trim().split("=");
    if (nombre === COOKIE_DE_SESION) return resto.join("=");
  }
  return undefined;
}

export function haySesion(peticion: Request): boolean {
  return sesionValida(leerSesion(peticion));
}

/** Texto de la cabecera Set-Cookie. Con valor vacío borra la sesión. */
export function cabeceraDeCookie(valor: string): string {
  const partes = [
    `${COOKIE_DE_SESION}=${valor}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${valor ? VIDA_DE_SESION_SEGUNDOS : 0}`,
  ];
  if (process.env.NODE_ENV === "production") partes.push("Secure");
  return partes.join("; ");
}

const sinCache = { "Cache-Control": "no-store" };

/**
 * Para las rutas del mostrador: devuelve la respuesta de error si no se puede
 * pasar (sin configurar → 503, sin sesión → 401) o null si todo está bien.
 */
export function exigirSesion(peticion: Request): NextResponse | null {
  if (!sesionConfigurada()) {
    console.error("[sesion] falta PIN_MOSTRADOR o SESION_SECRETO: la app queda cerrada");
    return NextResponse.json({ error: "El mostrador todavía no tiene PIN" }, { status: 503, headers: sinCache });
  }
  if (!haySesion(peticion)) {
    return NextResponse.json({ error: "Falta el PIN" }, { status: 401, headers: sinCache });
  }
  return null;
}
