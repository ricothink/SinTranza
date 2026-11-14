"use client";

// Texto que llena su caja: el importe y los letreros crecen o se encogen
// hasta ocupar todo el espacio de su contenedor, sin cortarse nunca.

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

// En el servidor no existe layout; allí se usa el efecto normal.
const useEfectoDeDiseno = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type Caja = { w: number; h: number };
export type Calculo = (caja: Caja) => Caja;

function medir(caja: HTMLElement): Caja {
  const estilo = getComputedStyle(caja);
  return {
    w: caja.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight),
    h: caja.clientHeight - parseFloat(estilo.paddingTop) - parseFloat(estilo.paddingBottom),
  };
}

function ajustar(elemento: HTMLElement, ancho: number, alto: number) {
  elemento.style.fontSize = "100px";
  const anchoReal = elemento.offsetWidth || 1;
  const altoReal = elemento.offsetHeight || 1;
  elemento.style.fontSize = `${Math.max(10, Math.floor(100 * Math.min(ancho / anchoReal, alto / altoReal)))}px`;
}

/** Alto de la pantalla en este momento (para los letreros que se miden contra ella). */
export const altoDePantalla = () => window.innerHeight;
export const esApaisado = () => window.innerWidth >= window.innerHeight;

export function Ajusta({
  className,
  calculo,
  children,
}: {
  className: string;
  /** Cuánto espacio le toca. Por omisión, todo el contenedor. Debe ser una función fija (no crearla en cada render). */
  calculo?: Calculo;
  children: ReactNode;
}) {
  const referencia = useRef<HTMLSpanElement>(null);

  const correr = useCallback(() => {
    const elemento = referencia.current;
    const caja = elemento?.parentElement;
    if (!elemento || !caja) return;
    const base = medir(caja);
    const { w, h } = calculo ? calculo(base) : base;
    ajustar(elemento, w, h);
  }, [calculo]);

  // En cada cambio (otro texto, otra pantalla) se vuelve a medir.
  useEfectoDeDiseno(() => {
    correr();
  });

  // Y cuando cambia el tamaño de la caja, gira el celular o terminan de cargar las letras.
  useEffect(() => {
    const caja = referencia.current?.parentElement;
    const observador = typeof ResizeObserver !== "undefined" ? new ResizeObserver(correr) : null;
    if (caja) observador?.observe(caja);
    window.addEventListener("resize", correr);
    void document.fonts?.ready.then(correr);
    return () => {
      observador?.disconnect();
      window.removeEventListener("resize", correr);
    };
  }, [correr]);

  return (
    <span ref={referencia} className={className}>
      {children}
    </span>
  );
}
