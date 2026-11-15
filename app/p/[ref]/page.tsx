// /p/<referencia>?t=<código>
// La página de seguimiento que ve el CLIENTE (la liga que le llega por WhatsApp,
// y a la que Pey lo regresa después de pagar con tarjeta). No pide PIN: sirve
// el código secreto que va en la dirección.

import type { Metadata } from "next";
import Seguimiento from "./seguimiento";

export const metadata: Metadata = {
  title: "Tu pedido · Milpa",
  description: "Sigue tu pedido y revisa a qué hora pasar por él.",
  robots: { index: false, follow: false },
};

export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { ref } = await params;
  const { t } = await searchParams;
  return <Seguimiento referencia={ref} codigo={typeof t === "string" ? t : ""} />;
}
