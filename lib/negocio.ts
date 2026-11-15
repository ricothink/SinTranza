// Datos del negocio (tomados de la hoja del menú de Milpa). Se usan en los
// mensajes de WhatsApp y en la página de seguimiento del cliente.

export const NEGOCIO = {
  nombre: "Milpa · Cocina de Raíz",
  corto: "Milpa",
  direccion: "Av. Miguel Hidalgo 128, Del Carmen, Coyoacán",
  whatsapp: "55 3553 1858",
  instagram: "@milpacocinaderaiz",
  /** Lo que ve quien paga en la app de su banco. Sin acentos a propósito. */
  conceptoBanco: "Milpa Cocina de Raiz",
} as const;

/**
 * Dirección pública de la app (la que va en los enlaces que se mandan a los
 * clientes y la que Pey usa para regresarlos). Pey exige HTTPS.
 * Solo se llama desde el servidor.
 */
export function urlPublica(): string {
  return (process.env.APP_PUBLICA || "https://ya-cayo.vercel.app").replace(/\/+$/, "");
}
