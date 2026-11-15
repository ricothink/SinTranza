// Almacén de cobros.
//
// Un cobro nace "esperando" y solo puede pasar a "pagado", una sola vez.
// Ese cambio vive en UNA función (marcarPagado) y solo la llama el webhook de
// Pey. No existe ninguna otra forma de poner un cobro en "pagado".
//
// Se guarda en Redis (Upstash). Cada cobro se borra solo a las 24 horas (los
// enlaces de pago, a los 7 días): no hay historial más allá del registro del
// día (índice de pagados + contador de pedidos) y la lista de pendientes.

import { randomBytes, randomInt } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { LineaCobro } from "./catalogo";

export type EstadoCobro = "esperando" | "pagado";

/** Cómo va a pagar el cliente. */
export type Metodo = "qr" | "push" | "link";

export type Cobro = {
  /** Referencia de 7 dígitos. Es el numRef que se manda a Pey. */
  ref: string;
  estado: EstadoCobro;
  metodo: Metodo;
  /** Monto pedido, en pesos. */
  monto: number;
  /** Identificador del QR que asigna Banxico. Vacío mientras Pey no responde (o si no es un cobro con QR). */
  codiQrId: string;
  /** Qué se vendió (con el precio de ese momento). No existe en un cobro de monto libre. */
  items?: LineaCobro[];
  /** En cuántos minutos, contados desde el pago, estará listo el pedido. No existe en un cobro de monto libre. */
  minutos?: number;
  /** Celular del cliente (10 dígitos), si quien atiende lo tecleó. Solo lo ve el personal, nunca la página pública. */
  telefono?: string;
  /** Código secreto de la página de seguimiento del cliente. */
  token?: string;
  /** Solicitud al celular: identificador que devolvió Pey al crearla. */
  pnTransactionId?: string;
  /** Enlace de pago: identificador y dirección que devolvió Pey. */
  linkId?: string;
  linkUrl?: string;
  /** Momentos en milisegundos (hora del servidor). */
  creadoEn: number;
  venceEn: number;
  /** Lo siguiente solo existe cuando ya está pagado. */
  montoPagado?: number;
  /** Comisión que reportó Pey (pagos con tarjeta por enlace), en pesos. */
  comision?: number;
  /** Número de pedido del día (1, 2, 3…), asignado al caer el pago. */
  numero?: number;
  /** Cuándo dice Pey que se pagó. */
  pagadoEn?: number;
  /** Cuándo nos llegó el aviso (webhook). */
  avisoEn?: number;
  transactionId?: string;
  webhookId?: string;
};

export type DatosDePago = {
  /**
   * Con qué campo del cobro se comprueba que el aviso es de ESE cobro:
   * QR → codiQrId, enlace → linkId, solicitud al celular → metodo ("push").
   */
  llave: { campo: "codiQrId" | "linkId" | "metodo"; valor: string };
  montoPagado: number;
  pagadoEn: number;
  transactionId: string;
  webhookId: string;
  comision?: number;
};

export type ResultadoMarca =
  /** Era "esperando" y quedó "pagado". Solo pasa una vez por cobro. */
  | "marcado"
  /** Ya estaba "pagado": aviso repetido, no se tocó nada. */
  | "ya_pagado"
  /** No hay cobro con esa referencia (o ya se borró). */
  | "no_existe"
  /** La referencia coincide pero el QR, enlace o método del aviso no es el del cobro: no se marca. */
  | "qr_distinto";

export class AlmacenNoConfigurado extends Error {
  constructor() {
    super("Falta configurar el almacén de cobros (KV_REST_API_URL y KV_REST_API_TOKEN)");
    this.name = "AlmacenNoConfigurado";
  }
}

const VIDA_SEGUNDOS = 24 * 60 * 60;
/** Un enlace de pago no vence en Pey: se le da más tiempo para que un pago tardío no quede sin cobro. */
export const VIDA_ENLACE_SEGUNDOS = 7 * 24 * 60 * 60;
/** El índice del día, el contador de pedidos y la lista de pendientes se guardan unos días y se borran solos. */
const VIDA_DEL_DIA_SEGUNDOS = 8 * 24 * 60 * 60;
const MAX_PENDIENTES = 60;
const INTENTOS_DE_REFERENCIA = 6;
const clave = (ref: string) => `cobro:${ref}`;
const claveContador = (dia: string) => `pedidos:${dia}`;
const claveIndice = (dia: string) => `pagados:${dia}`;
const CLAVE_PENDIENTES = "pendientes";
const CLAVE_VERSION = "registro:version";

/** El día se cuenta en hora de la Ciudad de México (AAAA-MM-DD), no en la del servidor. */
export function diaMx(milisegundos: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(milisegundos));
}

type Campos = Record<string, string>;

interface Almacen {
  /** Crea el registro solo si la referencia está libre. Devuelve false si ya existía. */
  crear(ref: string, campos: Campos, vidaSegundos: number): Promise<boolean>;
  fijar(ref: string, campos: Campos): Promise<void>;
  borrar(ref: string): Promise<void>;
  leer(ref: string): Promise<Campos | null>;
  /**
   * Paso atómico esperando → pagado. En el mismo paso asigna el número de
   * pedido del día, anota el cobro en el índice de pagados de ese día, lo
   * quita de los pendientes y sube la versión del registro.
   */
  marcarPagado(ref: string, llave: DatosDePago["llave"], dia: string, campos: Campos): Promise<ResultadoMarca>;
  /** Los cobros pagados de un día, el más nuevo primero. */
  listarPagados(dia: string, limite: number): Promise<Campos[]>;
  /** Anota un cobro a distancia como pendiente y sube la versión del registro. */
  agregarPendiente(ref: string, creadoEn: number): Promise<void>;
  quitarPendiente(ref: string): Promise<void>;
  /** Los cobros a distancia que siguen esperando, el más nuevo primero. */
  listarPendientes(limite: number): Promise<Campos[]>;
  /** Número que cambia cada vez que algo entra o sale del registro (para preguntar barato si hay novedades). */
  version(): Promise<number>;
  /** Cuenta un intento fallido y devuelve cuántos van en la ventana. */
  contarFallo(clave: string, ventanaSegundos: number): Promise<number>;
  /** Cuántos intentos fallidos van ahora en la ventana. */
  leerFallos(clave: string): Promise<number>;
  /** Borra la cuenta de intentos fallidos (al entrar bien). */
  olvidarFallos(clave: string): Promise<void>;
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

// KEYS: [cobro, contador de pedidos del día, índice de pagados del día, pendientes, versión]
// ARGV: [campo de la llave, valor de la llave, ref, pagadoEn (ms), vida del día (s), …campos del pago]
const GUION_MARCAR_PAGADO = `
local estado = redis.call('HGET', KEYS[1], 'estado')
if not estado then return 'no_existe' end
if estado ~= 'esperando' then return 'ya_pagado' end
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 'qr_distinto' end
local numero = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
redis.call('HSET', KEYS[1], 'estado', 'pagado', 'numero', tostring(numero), unpack(ARGV, 6))
redis.call('ZADD', KEYS[3], tonumber(ARGV[4]), ARGV[3])
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5]))
redis.call('ZREM', KEYS[4], ARGV[3])
redis.call('INCR', KEYS[5])
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

  async function leerVarios(refs: unknown[]): Promise<Campos[]> {
    if (refs.length === 0) return [];
    const lote = redis.pipeline();
    for (const ref of refs) lote.hgetall(clave(String(ref)));
    const filas = (await lote.exec()) as unknown[];
    // Un cobro que ya se borró (pasó su tiempo) simplemente no aparece.
    return filas.map(aCampos).filter((campos): campos is Campos => campos !== null);
  }

  return {
    async crear(ref, campos, vidaSegundos) {
      const creado = await redis.eval(GUION_CREAR, [clave(ref)], [String(vidaSegundos), ...aplanar(campos)]);
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
    async marcarPagado(ref, llave, dia, campos) {
      const resultado = await redis.eval(
        GUION_MARCAR_PAGADO,
        [clave(ref), claveContador(dia), claveIndice(dia), CLAVE_PENDIENTES, CLAVE_VERSION],
        [llave.campo, llave.valor, ref, campos.pagadoEn, String(VIDA_DEL_DIA_SEGUNDOS), ...aplanar(campos)],
      );
      return String(resultado) as ResultadoMarca;
    },
    async listarPagados(dia, limite) {
      return leerVarios((await redis.zrange(claveIndice(dia), 0, limite - 1, { rev: true })) as unknown[]);
    },
    async agregarPendiente(ref, creadoEn) {
      await redis.zadd(CLAVE_PENDIENTES, { score: creadoEn, member: ref });
      await redis.expire(CLAVE_PENDIENTES, VIDA_DEL_DIA_SEGUNDOS);
      await redis.incr(CLAVE_VERSION);
    },
    async quitarPendiente(ref) {
      await redis.zrem(CLAVE_PENDIENTES, ref);
      await redis.incr(CLAVE_VERSION);
    },
    async listarPendientes(limite) {
      return leerVarios((await redis.zrange(CLAVE_PENDIENTES, 0, limite - 1, { rev: true })) as unknown[]);
    },
    async version() {
      return Number((await redis.get(CLAVE_VERSION)) ?? 0) || 0;
    },
    async contarFallo(claveDeFallo, ventanaSegundos) {
      const total = Number(await redis.incr(claveDeFallo));
      if (total === 1) await redis.expire(claveDeFallo, ventanaSegundos);
      return total;
    },
    async leerFallos(claveDeFallo) {
      return Number((await redis.get(claveDeFallo)) ?? 0) || 0;
    },
    async olvidarFallos(claveDeFallo) {
      await redis.del(claveDeFallo);
    },
  };
}

// ---------------------------------------------------------------------------
// Memoria (solo desarrollo local, nunca en producción)
// ---------------------------------------------------------------------------

type EnMemoria = Map<string, { campos: Campos; caduca: number }>;

function almacenMemoria(): Almacen {
  const global = globalThis as typeof globalThis & {
    __cobrosEnMemoria?: EnMemoria;
    __contadoresEnMemoria?: Map<string, number>;
    __indicesEnMemoria?: Map<string, Array<{ ref: string; pagadoEn: number }>>;
    __pendientesEnMemoria?: Map<string, number>;
    __versionEnMemoria?: { n: number };
    __fallosEnMemoria?: Map<string, { n: number; caduca: number }>;
  };
  const mapa = (global.__cobrosEnMemoria ??= new Map());
  const contadores = (global.__contadoresEnMemoria ??= new Map());
  const indices = (global.__indicesEnMemoria ??= new Map());
  const pendientes = (global.__pendientesEnMemoria ??= new Map());
  const version = (global.__versionEnMemoria ??= { n: 0 });
  const fallos = (global.__fallosEnMemoria ??= new Map());
  const vigente = (ref: string) => {
    const registro = mapa.get(ref);
    if (registro && registro.caduca <= Date.now()) {
      mapa.delete(ref);
      return undefined;
    }
    return registro;
  };
  const copias = (refs: string[]) =>
    refs.flatMap((ref) => {
      const registro = vigente(ref);
      return registro ? [{ ...registro.campos }] : [];
    });
  return {
    async crear(ref, campos, vidaSegundos) {
      if (vigente(ref)) return false;
      mapa.set(ref, { campos: { ...campos }, caduca: Date.now() + vidaSegundos * 1000 });
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
    async marcarPagado(ref, llave, dia, campos) {
      const registro = vigente(ref);
      if (!registro) return "no_existe";
      if (registro.campos.estado !== "esperando") return "ya_pagado";
      if (registro.campos[llave.campo] !== llave.valor) return "qr_distinto";
      const numero = (contadores.get(dia) ?? 0) + 1;
      contadores.set(dia, numero);
      Object.assign(registro.campos, campos, { estado: "pagado", numero: String(numero) });
      const indice = indices.get(dia) ?? [];
      indice.push({ ref, pagadoEn: Number(campos.pagadoEn) });
      indices.set(dia, indice);
      pendientes.delete(ref);
      version.n += 1;
      return "marcado";
    },
    async listarPagados(dia, limite) {
      const indice = [...(indices.get(dia) ?? [])].sort((a, b) => b.pagadoEn - a.pagadoEn).slice(0, limite);
      return copias(indice.map(({ ref }) => ref));
    },
    async agregarPendiente(ref, creadoEn) {
      pendientes.set(ref, creadoEn);
      version.n += 1;
    },
    async quitarPendiente(ref) {
      pendientes.delete(ref);
      version.n += 1;
    },
    async listarPendientes(limite) {
      const refs = [...pendientes.entries()].sort((a, b) => b[1] - a[1]).slice(0, limite).map(([ref]) => ref);
      return copias(refs);
    },
    async version() {
      return version.n;
    },
    async contarFallo(claveDeFallo, ventanaSegundos) {
      const ahora = Date.now();
      const actual = fallos.get(claveDeFallo);
      const n = actual && actual.caduca > ahora ? actual.n + 1 : 1;
      fallos.set(claveDeFallo, { n, caduca: actual && actual.caduca > ahora ? actual.caduca : ahora + ventanaSegundos * 1000 });
      return n;
    },
    async leerFallos(claveDeFallo) {
      const actual = fallos.get(claveDeFallo);
      return actual && actual.caduca > Date.now() ? actual.n : 0;
    },
    async olvidarFallos(claveDeFallo) {
      fallos.delete(claveDeFallo);
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

function leerItems(texto: string | undefined): LineaCobro[] | undefined {
  if (!texto) return undefined;
  try {
    const lista: unknown = JSON.parse(texto);
    return Array.isArray(lista) ? (lista as LineaCobro[]) : undefined;
  } catch {
    return undefined;
  }
}

function aCobro(campos: Campos): Cobro {
  const numero = (texto: string | undefined) => (texto === undefined || texto === "" ? undefined : Number(texto));
  return {
    ref: campos.ref,
    estado: campos.estado === "pagado" ? "pagado" : "esperando",
    metodo: campos.metodo === "push" || campos.metodo === "link" ? campos.metodo : "qr",
    monto: Number(campos.monto),
    codiQrId: campos.codiQrId ?? "",
    items: leerItems(campos.items),
    minutos: numero(campos.minutos),
    telefono: campos.telefono || undefined,
    token: campos.token || undefined,
    pnTransactionId: campos.pnTransactionId || undefined,
    linkId: campos.linkId || undefined,
    linkUrl: campos.linkUrl || undefined,
    creadoEn: Number(campos.creadoEn),
    venceEn: Number(campos.venceEn),
    montoPagado: numero(campos.montoPagado),
    comision: numero(campos.comision),
    numero: numero(campos.numero),
    pagadoEn: numero(campos.pagadoEn),
    avisoEn: numero(campos.avisoEn),
    transactionId: campos.transactionId || undefined,
    webhookId: campos.webhookId || undefined,
  };
}

export type NuevoCobro = {
  /** Monto en pesos. */
  monto: number;
  /** Cuánto dura el QR o la solicitud (el enlace de pago no vence en Pey). */
  segundosDeVida: number;
  metodo: Metodo;
  items?: LineaCobro[];
  minutos?: number;
  telefono?: string;
};

/**
 * Aparta una referencia única y guarda el cobro como "esperando".
 * La referencia son 7 dígitos (el máximo que acepta Pey) y nunca empieza
 * en cero, para que no cambie si alguien la trata como número.
 * Los cobros a distancia (solicitud al celular, enlace) quedan además en la
 * lista de pendientes del mostrador.
 */
export async function guardarCobroEsperando(nuevo: NuevoCobro): Promise<Cobro> {
  const db = almacen();
  const creadoEn = Date.now();
  const venceEn = creadoEn + nuevo.segundosDeVida * 1000;
  const vida = nuevo.metodo === "link" ? VIDA_ENLACE_SEGUNDOS : VIDA_SEGUNDOS;
  for (let intento = 0; intento < INTENTOS_DE_REFERENCIA; intento++) {
    const ref = String(randomInt(1_000_000, 10_000_000));
    const campos: Campos = {
      ref,
      estado: "esperando",
      metodo: nuevo.metodo,
      monto: nuevo.monto.toFixed(2),
      codiQrId: "",
      token: randomBytes(12).toString("base64url"),
      creadoEn: String(creadoEn),
      venceEn: String(venceEn),
    };
    if (nuevo.items && nuevo.items.length > 0) campos.items = JSON.stringify(nuevo.items);
    if (nuevo.minutos !== undefined) campos.minutos = String(nuevo.minutos);
    if (nuevo.telefono) campos.telefono = nuevo.telefono;
    if (await db.crear(ref, campos, vida)) {
      if (nuevo.metodo !== "qr") await db.agregarPendiente(ref, creadoEn);
      return aCobro(campos);
    }
  }
  throw new Error("No se encontró una referencia libre");
}

/** Anota datos en un cobro que ya existe (qué QR, enlace o solicitud le tocó). Sin esto el aviso no lo puede marcar. */
export async function anotarEnCobro(ref: string, campos: Campos): Promise<void> {
  await almacen().fijar(ref, campos);
}

/** Anota en el cobro qué QR le tocó. */
export async function asignarQr(ref: string, codiQrId: string): Promise<void> {
  await anotarEnCobro(ref, { codiQrId });
}

/** Borra un cobro que no llegó a existir en Pey (Pey falló al crearlo). */
export async function descartarCobro(ref: string): Promise<void> {
  const db = almacen();
  await db.borrar(ref);
  await db.quitarPendiente(ref).catch(() => {});
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
  const ahora = Date.now();
  const campos: Campos = {
    montoPagado: String(pago.montoPagado),
    pagadoEn: String(pago.pagadoEn),
    avisoEn: String(ahora),
    transactionId: pago.transactionId,
    webhookId: pago.webhookId,
  };
  if (pago.comision !== undefined) campos.comision = String(pago.comision);
  return almacen().marcarPagado(ref, pago.llave, diaMx(ahora), campos);
}

const MAX_COBROS_EN_EL_REGISTRO = 300;

/** Los cobros ya pagados de un día (hora de la Ciudad de México), el más nuevo primero. */
export async function listarCobrosPagados(dia: string): Promise<Cobro[]> {
  const filas = await almacen().listarPagados(dia, MAX_COBROS_EN_EL_REGISTRO);
  return filas.map(aCobro).filter((cobro) => cobro.estado === "pagado");
}

/** Los cobros a distancia que siguen esperando el pago, el más nuevo primero. */
export async function listarCobrosPendientes(): Promise<Cobro[]> {
  const filas = await almacen().listarPendientes(MAX_PENDIENTES);
  return filas.map(aCobro).filter((cobro) => cobro.estado === "esperando");
}

/** Cambia cada vez que algo entra o sale del registro. */
export async function versionDelRegistro(): Promise<number> {
  return almacen().version();
}

/** Cuenta un PIN equivocado desde esa dirección y devuelve cuántos van en los últimos 10 minutos. */
export async function contarFalloDePin(ip: string): Promise<number> {
  return almacen().contarFallo(`pin:fallos:${ip}`, 10 * 60);
}

/** Cuántos PIN equivocados van desde esa dirección en los últimos 10 minutos (sin sumar uno). */
export async function fallosDePin(ip: string): Promise<number> {
  return almacen().leerFallos(`pin:fallos:${ip}`);
}

/** Al entrar con el PIN correcto se borran los fallos de esa dirección. */
export async function olvidarFallosDePin(ip: string): Promise<void> {
  await almacen().olvidarFallos(`pin:fallos:${ip}`);
}
