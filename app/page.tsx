"use client";

// Una sola pantalla con cuatro momentos:
//   teclado → QR a pantalla completa → (consulta cada 2 s) → PAGADO en verde.
//
// El navegador solo PREGUNTA el estado. Nunca lo cambia: "pagado" lo pone
// el servidor cuando Pey avisa.

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type Pantalla =
  | { paso: "teclado" }
  | { paso: "generando" }
  | { paso: "qr"; ref: string; monto: number; qrImagen: string; venceLocal: number }
  | { paso: "pagado"; monto: number }
  | { paso: "error"; mensaje: string };

const CADA_CUANTO_CONSULTAR_MS = 2000;
const MAX_ENTEROS = 6;

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "borrar"] as const;

const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const miles = new Intl.NumberFormat("es-MX");

/** Aplica una tecla al monto que se va escribiendo ("150.5"). */
function teclear(actual: string, tecla: string): string {
  if (tecla === "borrar") return actual.slice(0, -1);
  if (tecla === ".") {
    if (actual.includes(".")) return actual;
    return actual === "" ? "0." : `${actual}.`;
  }
  const [enteros, decimales] = actual.split(".");
  if (decimales !== undefined) return decimales.length >= 2 ? actual : actual + tecla;
  if (enteros === "0") return tecla;
  if (enteros.length >= MAX_ENTEROS) return actual;
  return actual + tecla;
}

/** "1500.5" → "$1,500.5" (tal como se va tecleando). */
function comoSeTeclea(texto: string): string {
  if (texto === "") return "$0";
  const [enteros, decimales] = texto.split(".");
  return `$${miles.format(Number(enteros))}${decimales !== undefined ? `.${decimales}` : ""}`;
}

function reloj(milisegundos: number): string {
  const segundos = Math.max(0, Math.ceil(milisegundos / 1000));
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/** Tres notas que suben: se oye en un mostrador con ruido. */
function sonarPagado(audio: AudioContext) {
  const inicio = audio.currentTime + 0.02;
  const notas: Array<[frecuencia: number, cuando: number]> = [
    [659.25, 0],
    [880, 0.13],
    [1318.5, 0.26],
  ];
  for (const [frecuencia, cuando] of notas) {
    const oscilador = audio.createOscillator();
    const volumen = audio.createGain();
    oscilador.type = "triangle";
    oscilador.frequency.value = frecuencia;
    volumen.gain.setValueAtTime(0.0001, inicio + cuando);
    volumen.gain.exponentialRampToValueAtTime(0.45, inicio + cuando + 0.02);
    volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + cuando + 0.6);
    oscilador.connect(volumen).connect(audio.destination);
    oscilador.start(inicio + cuando);
    oscilador.stop(inicio + cuando + 0.65);
  }
}

export default function Pagina() {
  const [pantalla, setPantalla] = useState<Pantalla>({ paso: "teclado" });
  const [texto, setTexto] = useState("");
  const [ahora, setAhora] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null);

  const monto = Number(texto);
  const sePuedeCobrar = monto > 0;

  const nuevoCobro = useCallback(() => {
    setTexto("");
    setPantalla({ paso: "teclado" });
  }, []);

  const cobrar = useCallback(async () => {
    const montoLimpio = texto.replace(/\.$/, "");
    if (!(Number(montoLimpio) > 0)) return;

    // El celular solo deja sonar si el audio se activó con un toque.
    // Se activa aquí para que suene después, cuando caiga el pago.
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    } catch {
      // Sin audio: la pantalla verde avisa igual.
    }

    setPantalla({ paso: "generando" });
    try {
      const respuesta = await fetch("/api/cobros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: montoLimpio }),
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        setPantalla({ paso: "error", mensaje: datos.error || "No se pudo generar el QR. Intenta de nuevo." });
        return;
      }
      const qrImagen = await QRCode.toDataURL(datos.qrString, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 1024,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setAhora(Date.now());
      setPantalla({
        paso: "qr",
        ref: datos.ref,
        monto: datos.monto,
        qrImagen,
        // Se cuenta con el reloj del celular, a partir de lo que dura el QR.
        venceLocal: Date.now() + (datos.venceEn - datos.creadoEn),
      });
    } catch {
      setPantalla({ paso: "error", mensaje: "No hay conexión. Revisa tu internet e intenta de nuevo." });
    }
  }, [texto]);

  // Teclado físico (por si se abre en computadora).
  useEffect(() => {
    if (pantalla.paso !== "teclado") return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (/^[0-9]$/.test(evento.key) || evento.key === ".") setTexto((t) => teclear(t, evento.key));
      else if (evento.key === "Backspace") setTexto((t) => teclear(t, "borrar"));
      else if (evento.key === "Enter") void cobrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [pantalla.paso, cobrar]);

  // Mientras se muestra el QR: preguntar el estado cada 2 segundos.
  const refEnPantalla = pantalla.paso === "qr" ? pantalla.ref : null;
  useEffect(() => {
    if (!refEnPantalla) return;
    let vigente = true;
    let ocupado = false;
    const consultar = async () => {
      if (ocupado) return;
      ocupado = true;
      try {
        const respuesta = await fetch(`/api/cobros/${refEnPantalla}`, { cache: "no-store" });
        if (!respuesta.ok) return;
        const datos = await respuesta.json();
        if (vigente && datos.estado === "pagado") {
          setPantalla({ paso: "pagado", monto: datos.montoPagado ?? datos.monto });
        }
      } catch {
        // Se fue el internet un momento: se vuelve a preguntar en 2 s.
      } finally {
        ocupado = false;
      }
    };
    const intervalo = setInterval(consultar, CADA_CUANTO_CONSULTAR_MS);
    const segundero = setInterval(() => setAhora(Date.now()), 500);
    return () => {
      vigente = false;
      clearInterval(intervalo);
      clearInterval(segundero);
    };
  }, [refEnPantalla]);

  // Mientras se muestra el QR: que no se apague la pantalla.
  useEffect(() => {
    if (!refEnPantalla || !("wakeLock" in navigator)) return;
    let vigente = true;
    let candado: WakeLockSentinel | null = null;
    const pedir = async () => {
      try {
        const nuevo = await navigator.wakeLock.request("screen");
        if (vigente) candado = nuevo;
        else void nuevo.release();
      } catch {
        // El celular no lo permitió (batería baja, etc.). No pasa nada.
      }
    };
    const alVolver = () => {
      if (document.visibilityState === "visible") void pedir();
    };
    void pedir();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vigente = false;
      document.removeEventListener("visibilitychange", alVolver);
      void candado?.release().catch(() => {});
    };
  }, [refEnPantalla]);

  // Al caer el pago: sonido y vibración.
  useEffect(() => {
    if (pantalla.paso !== "pagado") return;
    try {
      if (audio.current) {
        void audio.current.resume();
        sonarPagado(audio.current);
      }
      navigator.vibrate?.([120, 60, 260]);
    } catch {
      // Sin sonido o vibración: la pantalla verde ya lo dice.
    }
  }, [pantalla.paso]);

  if (pantalla.paso === "pagado") {
    return (
      <main className="pantalla pantalla-pagado" role="status" aria-live="assertive">
        <div className="pagado-centro">
          <svg className="palomita" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="56" fill="#fff" />
            <path d="M34 62 L52 80 L88 42" fill="none" stroke="#0a8f3c" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="pagado-titulo">PAGADO</h1>
          <p className="pagado-monto">{pesos.format(pantalla.monto)}</p>
        </div>
        <button className="boton boton-nuevo" onClick={nuevoCobro}>
          Nuevo cobro
        </button>
      </main>
    );
  }

  if (pantalla.paso === "qr") {
    const falta = pantalla.venceLocal - ahora;
    const vencido = falta <= 0;
    return (
      <main className="pantalla pantalla-qr">
        <header>
          <p className="qr-monto">{pesos.format(pantalla.monto)}</p>
          <p className="qr-indicacion">Escanea con la app de tu banco</p>
        </header>

        <div className="qr-marco">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={vencido ? "qr-imagen vencido" : "qr-imagen"} src={pantalla.qrImagen} alt="Código QR para pagar con CoDi" />
          {vencido && (
            <div className="qr-vencido" role="status">
              <p>Este QR ya venció</p>
              <span>No se cobró nada. Haz un cobro nuevo.</span>
            </div>
          )}
        </div>

        <div className="qr-pie">
          {vencido ? (
            <button className="boton boton-cobrar" onClick={nuevoCobro}>
              Nuevo cobro
            </button>
          ) : (
            <>
              <div className="qr-estado" role="status">
                <span className="latido" aria-hidden="true" />
                Esperando el pago…
              </div>
              <p className="qr-vence">Vence en {reloj(falta)}</p>
              <button className="boton boton-claro boton-chico" onClick={nuevoCobro}>
                Cancelar
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  if (pantalla.paso === "generando") {
    return (
      <main className="pantalla">
        <div className="centro" role="status">
          <div className="girando" aria-hidden="true" />
          <p className="aviso-titulo">Haciendo el QR…</p>
        </div>
      </main>
    );
  }

  if (pantalla.paso === "error") {
    return (
      <main className="pantalla error">
        <div className="centro" role="alert">
          <p className="aviso-titulo">No se pudo</p>
          <p className="aviso-texto">{pantalla.mensaje}</p>
        </div>
        <button className="boton boton-claro" onClick={() => setPantalla({ paso: "teclado" })}>
          Volver
        </button>
      </main>
    );
  }

  return (
    <main className="pantalla">
      <h1 className="marca">Ya cayó</h1>

      <div className="visor">
        <p className="pregunta">¿Cuánto vas a cobrar?</p>
        <p className={texto === "" ? "cifra vacia" : "cifra"} aria-live="polite">
          {comoSeTeclea(texto)}
        </p>
      </div>

      <div className="teclas">
        {TECLAS.map((tecla) => (
          <button
            key={tecla}
            className="tecla"
            aria-label={tecla === "borrar" ? "Borrar" : tecla === "." ? "Punto" : tecla}
            onClick={() => setTexto((t) => teclear(t, tecla))}
          >
            {tecla === "borrar" ? "⌫" : tecla}
          </button>
        ))}
      </div>

      <button className="boton boton-cobrar" disabled={!sePuedeCobrar} onClick={() => void cobrar()}>
        {sePuedeCobrar ? `Cobrar ${pesos.format(monto)}` : "Cobrar"}
      </button>
    </main>
  );
}
