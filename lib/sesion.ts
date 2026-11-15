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
import { PRECIOS_DE_PRUEBA } from "./catalogo";

/**
 * MOSTRADOR ABIERTO (para la evaluación del hackatón).
 *
 * Con esto en true, quien abra la app entra al mostrador SIN PIN, como
 * invitado: puede armar un pedido, crear un cobro real de un centavo con QR o
 * con enlace de pago, ver cómo cae y abrir el tablero. Así una persona, un
 * script o un agente pueden recorrer el flujo completo sin que nadie les pase
 * una clave.
 *
 * Lo que un invitado NO puede hacer:
 *   - mandar una solicitud de pago a un celular (le llega a una persona de
 *     verdad): eso sigue pidiendo el PIN;
 *   - ver los celulares de los clientes en el tablero;
 *   - crear cobros sin límite (hay un tope por dirección y uno general).
 * Y nadie, con PIN o sin él, puede marcar un cobro como pagado: eso solo lo
 * hace el aviso firmado de Pey.
 *
 * Solo vale mientras los precios sean de prueba ($0.01): el día que se cobre
 * de verdad (PRECIOS_DE_PRUEBA en false) el mostrador vuelve a pedir PIN solo.
 * Para cerrarlo antes, pon esto en false y publica.
 */
export const MOSTRADOR_ABIERTO = true;

export const mostradorAbierto = () => MOSTRADOR_ABIERTO && PRECIOS_DE_PRUEBA;

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

/** Quién pide: el personal (entró con PIN) o un invitado (mostrador abierto, sin PIN). */
export type Acceso = "personal" | "invitado";

/**
 * Para las rutas que un invitado también puede usar cuando el mostrador está
 * abierto. Devuelve quién pide, o la respuesta de error si no puede pasar.
 */
export function exigirAcceso(peticion: Request): { acceso: Acceso; bloqueo?: undefined } | { bloqueo: NextResponse } {
  if (haySesion(peticion)) return { acceso: "personal" };
  if (mostradorAbierto()) return { acceso: "invitado" };
  return { bloqueo: exigirSesion(peticion) as NextResponse };
}

/** La dirección desde la que llega la petición (para los topes y los bloqueos). */
export function direccionDe(peticion: Request): string {
  return (peticion.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconocida";
}
