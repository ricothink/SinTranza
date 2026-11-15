// Lo que sale en el registro del día (el tablero de control) y en la tira de arriba.
// Solo tipos y utilidades: lo comparten el servidor y la pantalla.

import type { LineaCobro } from "./catalogo";

/** Cómo va a pagar / pagó el cliente. */
export type MetodoDeCobro = "qr" | "push" | "link";

/** Un cobro que el banco ya selló. Lo que no tiene sello no aparece aquí. */
export type CobroRegistrado = {
  ref: string;
  metodo: MetodoDeCobro;
  /** Número de pedido del día (1, 2, 3…). Se asigna al caer el pago. */
  numero?: number;
  /** Monto pagado, en pesos. */
  monto: number;
  /** Cuándo dice Pey que se pagó (milisegundos). */
  pagadoEn: number;
  /** Cuándo debe regresar el cliente (milisegundos). No existe en un cobro de monto libre. */
  recogerEn?: number;
  minutos?: number;
  items?: LineaCobro[];
  /** Celular del cliente (10 dígitos), si quien atiende lo tecleó. Para mandarle la confirmación por WhatsApp. */
  telefono?: string;
};

/** Un cobro a distancia que sigue esperando el pago. */
export type CobroPendiente = {
  ref: string;
  metodo: Exclude<MetodoDeCobro, "qr">;
  monto: number;
  creadoEn: number;
  /** Hasta cuándo sirve la solicitud (en un enlace de pago no vence). */
  venceEn: number;
  minutos?: number;
  items?: LineaCobro[];
  telefono?: string;
  /** Página de seguimiento del cliente. */
  seguimiento: string;
  /** Enlace de pago de Pey (solo en el método "link"). */
  enlaceDePago?: string;
};

export type ResumenDelDia = {
  /** Cambia cada vez que algo entra o sale del registro. */
  version: number;
  /** AAAA-MM-DD en hora de la Ciudad de México. */
  dia: string;
  cuantos: number;
  sumaCentavos: number;
  /** Los pagados de hoy, el más nuevo primero. */
  cobros: CobroRegistrado[];
  /** Los cobros a distancia que siguen esperando, el más nuevo primero. */
  pendientes: CobroPendiente[];
};

/** "2 × Bowl de Avena · 1 × Flan de Vainilla" */
export function resumenDeProductos(items: LineaCobro[]): string {
  return items.map((linea) => `${linea.cantidad} × ${linea.nombre}`).join(" · ");
}
