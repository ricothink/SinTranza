"use client";

// Lo que ve el cliente de su pedido: esperando su pago, o ¡YA CAYÓ! con la hora
// a la que debe pasar por él. Pregunta cada 3 segundos hasta que se paga.

import { useEffect, useState } from "react";
import { Ajusta, altoDePantalla, type Calculo } from "../../ajusta";
import { Monto, PantallaCayo } from "../../pantallas";
import type { LineaCobro } from "@/lib/catalogo";
import { reloj } from "@/lib/hora";
import { importeConLetra, textoDeMonto } from "@/lib/letra";
import { NEGOCIO } from "@/lib/negocio";
import { resumenDeProductos } from "@/lib/registro";

type Datos = {
  estado: "esperando" | "pagado";
  metodo: "qr" | "push" | "link";
  monto: number;
  items?: LineaCobro[];
  minutos?: number;
  venceEn: number;
  numero?: number;
  pagadoEn?: number;
  recogerEn?: number;
  enlaceDePago?: string;
  celularTermina?: string;
};

const calcEspera: Calculo = (c) => ({ w: c.w, h: altoDePantalla() * 0.05 });

export default function Seguimiento({ referencia, codigo }: { referencia: string; codigo: string }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const [selloCae, setSelloCae] = useState(false);
  const pagado = datos?.estado === "pagado";

  // Pregunta cada 3 s hasta que se paga.
  useEffect(() => {
    if (pagado) return;
    let vigente = true;
    const preguntar = async () => {
      if (document.hidden) return;
      try {
        const respuesta = await fetch(`/api/seguimiento/${referencia}?t=${encodeURIComponent(codigo)}`, { cache: "no-store" });
        if (!vigente) return;
        if (respuesta.status === 404) {
          setNoExiste(true);
          return;
        }
        if (respuesta.ok) setDatos((await respuesta.json()) as Datos);
      } catch {
        // Sin internet un momento: se vuelve a preguntar.
      }
    };
    void preguntar();
    const intervalo = setInterval(() => void preguntar(), 3000);
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    const alVolver = () => {
      if (!document.hidden) void preguntar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vigente = false;
      clearInterval(intervalo);
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [pagado, referencia, codigo]);

  // Al pagarse: fondo verde, vibración y el sello.
  useEffect(() => {
    document.documentElement.setAttribute("data-estado", pagado ? "cayo" : "calc");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", pagado ? "#008A2E" : "#F6F3EA");
    if (!pagado) return;
    try {
      navigator.vibrate?.([90, 40, 180]);
    } catch {
      // Sin vibración: la pantalla verde ya lo dice.
    }
    const sello = setTimeout(() => setSelloCae(true), 260);
    return () => clearTimeout(sello);
  }, [pagado]);

  if (noExiste) {
    return (
      <main className="pantalla cliente">
        <header className="cabeza">
          <b>{NEGOCIO.corto}</b>
          <span>Pedido N.º {referencia}</span>
        </header>
        <div className="cliente-cuerpo">
          <div className="instruccion">
            <b>NO ENCONTRAMOS ESE PEDIDO</b>
            <p>
              Revisa que la liga esté completa. Si ya pagaste, escríbenos por WhatsApp al <strong>{NEGOCIO.whatsapp}</strong>.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!datos) return <main className="pantalla" aria-busy="true" />;

  if (datos.estado === "pagado" && datos.pagadoEn !== undefined) {
    return (
      <PantallaCayo
        referencia={referencia}
        centavos={Math.round(datos.monto * 100)}
        items={datos.items}
        numero={datos.numero}
        minutos={datos.minutos}
        recogerEn={datos.recogerEn}
        hora={new Date(datos.pagadoEn)}
        selloCae={selloCae}
        quedan={0}
        sello={datos.metodo === "link" ? "PAGO EN LÍNEA" : "BANCO · CODI"}
        marca={NEGOCIO.corto}
        direccion={NEGOCIO.direccion}
      />
    );
  }

  const centavos = Math.round(datos.monto * 100);
  const vencida = datos.metodo === "push" && datos.venceEn <= ahora;
  return (
    <main className="pantalla cliente" role="status">
      <header className="cabeza">
        <b>{NEGOCIO.corto}</b>
        <span>Pedido N.º {referencia}</span>
      </header>
      <div className="importe">
        <span className="rot">Total</span>
        <Monto texto={textoDeMonto(centavos)} />
      </div>
      <p className="letra">({importeConLetra(centavos)})</p>
      {datos.minutos !== undefined && <p className="entrega">Listo en {datos.minutos} min después de pagar</p>}

      <div className="cliente-cuerpo">
        {vencida ? (
          <div className="instruccion">
            <b>ESTA SOLICITUD YA VENCIÓ</b>
            <p>
              Pídele a {NEGOCIO.corto} que te mande otra, o escríbenos por WhatsApp al <strong>{NEGOCIO.whatsapp}</strong>.
            </p>
          </div>
        ) : datos.metodo === "push" ? (
          <div className="instruccion">
            <b>ABRE LA APP DE TU BANCO</b>
            <p>
              Te mandamos una <strong>solicitud de pago CoDi</strong> por ${textoDeMonto(centavos)}
              {datos.celularTermina ? ` al celular que termina en ${datos.celularTermina}` : ""}. Acéptala y listo: esta
              pantalla se pondrá verde sola.
            </p>
          </div>
        ) : datos.enlaceDePago ? (
          <>
            <div className="instruccion">
              <b>PAGA TU PEDIDO</b>
              <p>
                Con <strong>tarjeta, Apple Pay, Google Pay o CoDi</strong>. Al terminar regresas aquí y verás a qué hora pasar
                por él.
              </p>
            </div>
            <a className="accion primaria" href={datos.enlaceDePago}>
              PAGAR AHORA
            </a>
          </>
        ) : (
          <div className="instruccion">
            <b>ESPERANDO TU PAGO</b>
            <p>En cuanto el banco confirme, esta pantalla se pondrá verde.</p>
          </div>
        )}
        {datos.items && datos.items.length > 0 && <p className="resumen-pedido">{resumenDeProductos(datos.items)}</p>}
      </div>

      {!vencida && (
        <section className="estado">
          <div className="sin-sello">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="0" width="100" height="100" />
            </svg>
            <Ajusta className="esp" calculo={calcEspera}>
              ESPERANDO TU PAGO
              <span className="pts" aria-hidden="true">
                {"...".slice(0, (Math.floor(ahora / 1000) % 3) + 1)}
              </span>
            </Ajusta>
          </div>
          <div className="vence">
            <span>
              {datos.metodo === "push" ? `La solicitud vence en ${reloj(datos.venceEn - ahora)}` : "Tu enlace sigue activo"}
            </span>
            <span>
              {NEGOCIO.corto} · WhatsApp {NEGOCIO.whatsapp}
            </span>
          </div>
        </section>
      )}
    </main>
  );
}
