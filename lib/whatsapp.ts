// Mensajes de WhatsApp para el cliente: instrucciones al cobrar y confirmación
// de compra al caer el pago.
//
// No hay envío automático (eso requiere la API de WhatsApp Business de Meta,
// con cuenta y plantillas aprobadas). Aquí se arma el mensaje y un enlace
// wa.me que abre WhatsApp con el texto ya escrito: quien atiende solo toca
// "enviar". No se necesita ninguna llave.

import type { LineaCobro } from "./catalogo";
import { horaMin } from "./hora";
import { textoDeMonto } from "./letra";
import { NEGOCIO } from "./negocio";

import type { MetodoDeCobro } from "./registro";
export type { MetodoDeCobro };

/** Quita lo que no sea dígito y deja los últimos 10 (celular de México). null si no alcanza. */
export function celularDe10(texto: string): string | null {
  const digitos = texto.replace(/\D/g, "");
  return digitos.length >= 10 ? digitos.slice(-10) : null;
}

/** Abre WhatsApp con el mensaje ya escrito para ese celular. */
export function enlaceWhatsapp(celular: string, mensaje: string): string {
  return `https://wa.me/52${celular}?text=${encodeURIComponent(mensaje)}`;
}

const listaDePlatillos = (items?: LineaCobro[]) =>
  items && items.length > 0 ? `${items.map((linea) => `• ${linea.cantidad} × ${linea.nombre}`).join("\n")}\n` : "";

/** Al cobrar a distancia: qué pidió, cuánto es y cómo pagar. */
export function mensajeDeInstrucciones(datos: {
  metodo: Exclude<MetodoDeCobro, "qr">;
  centavos: number;
  items?: LineaCobro[];
  minutos?: number;
  /** Enlace de pago de Pey (solo en el método "link"). */
  enlaceDePago?: string;
  /** Página donde el cliente ve cómo va su pedido. */
  enlaceDeSeguimiento: string;
}): string {
  const como =
    datos.metodo === "push"
      ? "Te mandé una solicitud de pago CoDi a este celular. Abre la app de tu banco y acéptala."
      : `Paga aquí con tarjeta o CoDi:\n${datos.enlaceDePago ?? ""}`;
  const tiempo = datos.minutos !== undefined ? `\nTu pedido estará listo ${datos.minutos} min después de que pagues.` : "";
  return [
    `Hola, soy de ${NEGOCIO.nombre}.`,
    "",
    "Tu pedido:",
    `${listaDePlatillos(datos.items)}Total: $${textoDeMonto(datos.centavos)}`,
    "",
    como,
    "",
    `Sigue tu pedido aquí:\n${datos.enlaceDeSeguimiento}${tiempo}`,
  ].join("\n");
}

/** Al caer el pago: confirmación de compra con la hora de recoger. */
export function mensajeDeConfirmacion(datos: {
  centavos: number;
  items?: LineaCobro[];
  numero?: number;
  minutos?: number;
  recogerEn?: number;
}): string {
  const pedido = datos.numero !== undefined ? `Pedido N.º ${String(datos.numero).padStart(2, "0")} · ` : "";
  const recoger =
    datos.recogerEn !== undefined
      ? `Pasa por él a las ${horaMin(datos.recogerEn)}${datos.minutos !== undefined ? ` (${datos.minutos} min después de tu pago)` : ""} a ${NEGOCIO.direccion}.`
      : `Pasa por él a ${NEGOCIO.direccion}.`;
  return [
    "✅ ¡Pago recibido! Gracias.",
    "",
    `${pedido}Total: $${textoDeMonto(datos.centavos)}`,
    listaDePlatillos(datos.items).trimEnd(),
    "",
    recoger,
    "",
    NEGOCIO.nombre,
  ]
    .filter((linea, i, todas) => !(linea === "" && todas[i - 1] === ""))
    .join("\n");
}
