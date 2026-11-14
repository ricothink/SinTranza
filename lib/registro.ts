// Lo que sale en el registro del día (el tablero de control) y en la tira de arriba.
// Solo tipos y utilidades: lo comparten el servidor y la pantalla.

import type { LineaCobro } from "./catalogo";

/** Un cobro que el banco ya selló. Lo que no tiene sello no aparece nunca. */
export type CobroRegistrado = {
  ref: string;
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
};

export type ResumenDelDia = {
  /** AAAA-MM-DD en hora de la Ciudad de México. */
  dia: string;
  cuantos: number;
  sumaCentavos: number;
  /** El más nuevo primero. */
  cobros: CobroRegistrado[];
};

/** "2 × Bowl de Avena · 1 × Flan de Vainilla" */
export function resumenDeProductos(items: LineaCobro[]): string {
  return items.map((linea) => `${linea.cantidad} × ${linea.nombre}`).join(" · ");
}
