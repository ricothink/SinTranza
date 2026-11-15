"use client";

// Vista de demostración, pública y sin PIN: el tablero y la pantalla de
// inteligencia SOLO con ventas de ejemplo (lib/demo.ts). No llama a ninguna
// ruta del servidor, no lee ningún cobro real y no puede crear cobros: para
// cobrar de verdad hay que entrar al mostrador con el PIN.

import { useEffect, useMemo, useState } from "react";
import { ejemplosDeDiasAnteriores, registroConEjemplos } from "@/lib/demo";
import { calcularInteligencia } from "@/lib/inteligencia";
import { PantallaInteligencia, PantallaRegistro, type VistaDelTablero } from "../pantallas";

const NINGUNA: ReadonlySet<string> = new Set();

export default function Demostracion() {
  // La hora se toma ya en el navegador (no al armar la página en el servidor).
  const [ahora, setAhora] = useState<number | null>(null);
  const [vista, setVista] = useState<VistaDelTablero>("inteligencia");

  useEffect(() => {
    setAhora(Date.now());
    const reloj = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(reloj);
  }, []);

  const registro = useMemo(() => (ahora === null ? null : registroConEjemplos(null, ahora)), [ahora]);
  const inteligencia = useMemo(
    () =>
      registro && ahora !== null
        ? calcularInteligencia(registro.cobros, ejemplosDeDiasAnteriores(ahora), registro.dia, ahora)
        : null,
    [registro, ahora],
  );
  const ejemplos = { activos: true, cuantos: registro?.cuantos ?? 0 };
  const irAlMostrador = () => {
    window.location.href = "/";
  };

  return vista === "cobros" ? (
    <PantallaRegistro
      registro={registro}
      fallo={false}
      nuevas={NINGUNA}
      ahora={ahora ?? 0}
      ejemplos={ejemplos}
      textoVolver="IR AL MOSTRADOR"
      onVista={setVista}
      onVolver={irAlMostrador}
    />
  ) : (
    <PantallaInteligencia
      datos={inteligencia}
      dia={registro?.dia}
      ejemplos={ejemplos}
      textoVolver="IR AL MOSTRADOR"
      onVista={setVista}
      onVolver={irAlMostrador}
    />
  );
}
