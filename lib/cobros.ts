// Almacén de cobros.
//
// Un cobro nace "esperando" y solo puede pasar a "pagado", una sola vez.
// Ese cambio vive en UNA función (marcarPagado) y solo la llama el webhook.
// No existe ninguna otra forma de poner un cobro en "pagado".
//
// Se guarda en Redis (Upstash). Cada cobro se borra solo a las 24 horas:
// la app no tiene historial.

import { randomInt } from "node:crypto";
import { Redis } from "@upstash/redis";

export type EstadoCobro = "esperando" | "pagado";

export type Cobro = {
  /** Referencia de 7 dígitos. Es el numRef que se manda a Pey. */
  ref: string;
  estado: EstadoCobro;
  /** Monto pedido, en pesos. */
  monto: number;
  /** Identificador del QR que asigna Banxico. Vacío mientras Pey no responde. */
  codiQrId: string;
  /** Momentos en milisegundos (hora del servidor). */
  creadoEn: number;
  venceEn: number;
  /** Lo siguiente solo existe cuando ya está pagado. */
  montoPagado?: number;
  /** Cuándo dice Pey que se pagó. */
  pagadoEn?: number;
  /** Cuándo nos llegó el aviso (webhook). */
  avisoEn?: number;
  transactionId?: string;
  webhookId?: string;
};

export type DatosDePago = {
  codiQrId: string;
  montoPagado: number;
  pagadoEn: number;
  transactionId: string;
  webhookId: string;
};

export type ResultadoMarca =
  /** Era "esperando" y quedó "pagado". Solo pasa una vez por cobro. */
  | "marcado"
  /** Ya estaba "pagado": aviso repetido, no se tocó nada. */
  | "ya_pagado"
  /** No hay cobro con esa referencia (o ya se borró). */
  | "no_existe"
  /** La referencia coincide pero el QR pagado es otro: no se marca. */
  | "qr_distinto";

export class AlmacenNoConfigurado extends Error {
  constructor() {
    super("Falta configurar el almacén de cobros (KV_REST_API_URL y KV_REST_API_TOKEN)");
    this.name = "AlmacenNoConfigurado";
  }
}

const VIDA_SEGUNDOS = 24 * 60 * 60;
const INTENTOS_DE_REFERENCIA = 6;
const clave = (ref: string) => `cobro:${ref}`;

type Campos = Record<string, string>;

interface Almacen {
  /** Crea el registro solo si la referencia está libre. Devuelve false si ya existía. */
  crear(ref: string, campos: Campos): Promise<boolean>;
  fijar(ref: string, campos: Campos): Promise<void>;
  borrar(ref: string): Promise<void>;
  leer(ref: string): Promise<Campos | null>;
  /** Paso atómico esperando → pagado. */
  marcarPagado(ref: string, codiQrId: string, campos: Campos): Promise<ResultadoMarca>;
}

// ---------------------------------------------------------------------------
// Redis (producción)
// ---------------------------------------------------------------------------

// Los dos pasos delicados corren como guion dentro de Redis para que sean
// atómicos: aunque lleguen dos avisos al mismo tiempo, solo uno "gana".

const GUION_CREAR = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], unpack(ARGV, 2))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`;

const GUION_MARCAR_PAGADO = `
local estado = redis.call('HGET', KEYS[1], 'estado')
if not estado then return 'no_existe' end
if estado ~= 'esperando' then return 'ya_pagado' end
if redis.call('HGET', KEYS[1], 'codiQrId') ~= ARGV[1] then return 'qr_distinto' end
redis.call('HSET', KEYS[1], 'estado', 'pagado', unpack(ARGV, 2))
return 'marcado'
`;

const aplanar = (campos: Campos) => Object.entries(campos).flat();

/** HGETALL puede llegar como lista [campo, valor, …] o como objeto; se aceptan ambos. */
function aCampos(crudo: unknown): Campos | null {
  if (!crudo) return null;
  const campos: Campos = {};
  if (Array.isArray(crudo)) {
    for (let i = 0; i + 1 < crudo.length; i += 2) campos[String(crudo[i])] = String(crudo[i + 1]);
  } else if (typeof crudo === "object") {
    for (const [campo, valor] of Object.entries(crudo)) campos[campo] = String(valor);
  }
  return Object.keys(campos).length > 0 ? campos : null;
}

function almacenRedis(url: string, token: string): Almacen {
  // Sin conversión automática: todo viaja como texto y aquí se interpreta.
  // (Con la conversión activa, un id como "35e13" se leería como número.)
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    async crear(ref, campos) {
      const creado = await redis.eval(GUION_CREAR, [clave(ref)], [String(VIDA_SEGUNDOS), ...aplanar(campos)]);
      return Number(creado) === 1;
    },
    async fijar(ref, campos) {
      await redis.hset(clave(ref), campos);
    },
    async borrar(ref) {
      await redis.del(clave(ref));
    },
    async leer(ref) {
      return aCampos(await redis.hgetall(clave(ref)));
    },
    async marcarPagado(ref, codiQrId, campos) {
      const resultado = await redis.eval(GUION_MARCAR_PAGADO, [clave(ref)], [codiQrId, ...aplanar(campos)]);
      return String(resultado) as ResultadoMarca;
    },
  };
}

// ---------------------------------------------------------------------------
// Memoria (solo desarrollo local, nunca en producción)
// ---------------------------------------------------------------------------

type EnMemoria = Map<string, { campos: Campos; caduca: number }>;

function almacenMemoria(): Almacen {
  const global = globalThis as typeof globalThis & { __cobrosEnMemoria?: EnMemoria };
  const mapa = (global.__cobrosEnMemoria ??= new Map());
  const vigente = (ref: string) => {
    const registro = mapa.get(ref);
    if (registro && registro.caduca <= Date.now()) {
      mapa.delete(ref);
      return undefined;
    }
    return registro;
  };
  return {
    async crear(ref, campos) {
      if (vigente(ref)) return false;
      mapa.set(ref, { campos: { ...campos }, caduca: Date.now() + VIDA_SEGUNDOS * 1000 });
      return true;
    },
    async fijar(ref, campos) {
      const registro = vigente(ref);
      if (registro) Object.assign(registro.campos, campos);
    },
    async borrar(ref) {
      mapa.delete(ref);
    },
    async leer(ref) {
      const registro = vigente(ref);
      return registro ? { ...registro.campos } : null;
    },
    async marcarPagado(ref, codiQrId, campos) {
      const registro = vigente(ref);
      if (!registro) return "no_existe";
      if (registro.campos.estado !== "esperando") return "ya_pagado";
      if (registro.campos.codiQrId !== codiQrId) return "qr_distinto";
      Object.assign(registro.campos, campos, { estado: "pagado" });
      return "marcado";
    },
  };
}

function almacen(): Almacen {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return almacenRedis(url, token);
  if (process.env.NODE_ENV === "production") throw new AlmacenNoConfigurado();
  return almacenMemoria();
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

function aCobro(campos: Campos): Cobro {
  const numero = (texto: string | undefined) => (texto === undefined || texto === "" ? undefined : Number(texto));
  return {
    ref: campos.ref,
    estado: campos.estado === "pagado" ? "pagado" : "esperando",
    monto: Number(campos.monto),
    codiQrId: campos.codiQrId ?? "",
    creadoEn: Number(campos.creadoEn),
    venceEn: Number(campos.venceEn),
    montoPagado: numero(campos.montoPagado),
    pagadoEn: numero(campos.pagadoEn),
    avisoEn: numero(campos.avisoEn),
    transactionId: campos.transactionId || undefined,
    webhookId: campos.webhookId || undefined,
  };
}

/**
 * Aparta una referencia única y guarda el cobro como "esperando".
 * La referencia son 7 dígitos (el máximo que acepta Pey) y nunca empieza
 * en cero, para que no cambie si alguien la trata como número.
 */
export async function guardarCobroEsperando(monto: number, segundosDeVida: number): Promise<Cobro> {
  const db = almacen();
  const creadoEn = Date.now();
  const venceEn = creadoEn + segundosDeVida * 1000;
  for (let intento = 0; intento < INTENTOS_DE_REFERENCIA; intento++) {
    const ref = String(randomInt(1_000_000, 10_000_000));
    const campos: Campos = {
      ref,
      estado: "esperando",
      monto: monto.toFixed(2),
      codiQrId: "",
      creadoEn: String(creadoEn),
      venceEn: String(venceEn),
    };
    if (await db.crear(ref, campos)) return aCobro(campos);
  }
  throw new Error("No se encontró una referencia libre");
}

/** Anota en el cobro qué QR le tocó. Sin esto el webhook no lo puede marcar. */
export async function asignarQr(ref: string, codiQrId: string): Promise<void> {
  await almacen().fijar(ref, { codiQrId });
}

/** Borra un cobro que no llegó a tener QR (Pey falló al crearlo). */
export async function descartarCobro(ref: string): Promise<void> {
  await almacen().borrar(ref);
}

export async function leerCobro(ref: string): Promise<Cobro | null> {
  const campos = await almacen().leer(ref);
  return campos ? aCobro(campos) : null;
}

/**
 * ÚNICA puerta para pasar un cobro a "pagado". Solo la usa el webhook de Pey,
 * después de verificar la firma. Es idempotente: el primer aviso marca,
 * los repetidos devuelven "ya_pagado" sin cambiar nada.
 */
export async function marcarPagado(ref: string, pago: DatosDePago): Promise<ResultadoMarca> {
  return almacen().marcarPagado(ref, pago.codiQrId, {
    montoPagado: String(pago.montoPagado),
    pagadoEn: String(pago.pagadoEn),
    avisoEn: String(Date.now()),
    transactionId: pago.transactionId,
    webhookId: pago.webhookId,
  });
}
