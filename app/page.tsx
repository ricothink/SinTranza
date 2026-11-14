"use client";

// El mostrador de Milpa, de punta a punta:
//
//   menú (se tocan platillos y se elige en cuántos minutos estará) → QR a
//   pantalla completa → (se pregunta cada 2 s) → ¡YA CAYÓ! en verde, con
//   sonido, voz y vibración, y la hora a la que regresa el cliente por su pedido.
//
// Hay también un teclado para cobrar un monto libre y un registro con los
// cobros del día (tablero de control).
//
// El navegador solo PREGUNTA el estado. Nunca lo cambia: "pagado" lo pone el
// servidor cuando Pey avisa. Y el total de un pedido lo calcula el servidor con
// su catálogo: aquí solo se manda qué platillo, cuántos y en cuántos minutos.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  MAX_CANTIDAD_POR_PRODUCTO,
  MINUTOS_POR_OMISION,
  PRODUCTOS,
  type LineaCobro,
  type Producto,
} from "@/lib/catalogo";
import { fraseDePago } from "@/lib/letra";
import type { ResumenDelDia } from "@/lib/registro";
import { audio, decir, iniciarVoz, prepararVoz, sonarCaja, sonarSelloQR, sonarTecla, sonarTope } from "@/lib/sonido";
import {
  PantallaCayo,
  PantallaEspera,
  PantallaError,
  PantallaRegistro,
  PantallaTeclado,
  PantallaTienda,
} from "./pantallas";

type Origen = "tienda" | "teclado";

type Pantalla =
  | { paso: "tienda" }
  | { paso: "teclado" }
  | { paso: "registro"; volverA: Origen }
  | { paso: "generando"; centavos: number; minutos?: number; volverA: Origen }
  | {
      paso: "qr";
      ref: string;
      centavos: number;
      items?: LineaCobro[];
      minutos?: number;
      qrSvg: string;
      inicio: number;
      venceLocal: number;
      volverA: Origen;
    }
  | {
      paso: "pagado";
      ref: string;
      centavos: number;
      items?: LineaCobro[];
      numero?: number;
      minutos?: number;
      recogerEn?: number;
      pagadoEn: number;
    }
  | { paso: "error"; mensaje: string; volverA: Origen };

const CADA_CUANTO_CONSULTAR_MS = 2000;
const CADA_CUANTO_ACTUALIZAR_REGISTRO_MS = 4000;
const MAX_ENTEROS = 6;
const SEGUNDOS_DE_REGRESO = 10;
const VERDE = "#008A2E";
const PAPEL = "#F6F3EA";

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

/** "1500.5" → "1,500.5" (tal como se va tecleando). */
function comoSeTeclea(texto: string): string {
  if (texto === "") return "0";
  const [enteros, decimales] = texto.split(".");
  return `${Number(enteros).toLocaleString("es-MX")}${decimales !== undefined ? `.${decimales}` : ""}`;
}

/** Vuelve a disparar una animación de golpe sobre el mismo elemento. */
function relanzar(elemento: HTMLElement | null, clase: string) {
  if (!elemento) return;
  elemento.classList.remove(clase);
  void elemento.offsetWidth;
  elemento.classList.add(clase);
}

export default function Pagina() {
  const [pantalla, setPantalla] = useState<Pantalla>({ paso: "tienda" });
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [minutos, setMinutos] = useState(MINUTOS_POR_OMISION);
  const [texto, setTexto] = useState("");
  const [golpe, setGolpe] = useState(0);
  const [pisada, setPisada] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [selloCae, setSelloCae] = useState(false);
  const [quedan, setQuedan] = useState(SEGUNDOS_DE_REGRESO);
  const [registro, setRegistro] = useState<ResumenDelDia | null>(null);
  const [falloRegistro, setFalloRegistro] = useState(false);
  const [nuevas, setNuevas] = useState<ReadonlySet<string>>(new Set());
  const temporizadorBorrar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refsVistas = useRef<Set<string> | null>(null);

  // ------------------------------------------------------------ lo que lleva el pedido
  const lineas = useMemo<LineaCobro[]>(
    () =>
      PRODUCTOS.filter((producto) => carrito[producto.id]).map((producto) => ({
        id: producto.id,
        nombre: producto.nombre,
        precio: producto.centavos / 100,
        cantidad: carrito[producto.id],
      })),
    [carrito],
  );
  const centavosCarrito = lineas.reduce((suma, linea) => suma + Math.round(linea.precio * 100) * linea.cantidad, 0);
  const articulos = lineas.reduce((suma, linea) => suma + linea.cantidad, 0);
  const centavosTeclado = Math.round(Number(texto.replace(/\.$/, "") || "0") * 100);

  const agregar = useCallback(
    (producto: Producto, tarjeta: HTMLElement | null) => {
      if ((carrito[producto.id] ?? 0) >= MAX_CANTIDAD_POR_PRODUCTO) {
        sonarTope();
        return;
      }
      sonarTecla();
      relanzar(tarjeta, "golpe");
      setCarrito((actual) => ({ ...actual, [producto.id]: (actual[producto.id] ?? 0) + 1 }));
    },
    [carrito],
  );

  const quitar = useCallback(
    (producto: Producto) => {
      if (!carrito[producto.id]) return;
      sonarTecla();
      setCarrito((actual) => {
        const { [producto.id]: cantidad, ...resto } = actual;
        return cantidad > 1 ? { ...resto, [producto.id]: cantidad - 1 } : resto;
      });
    },
    [carrito],
  );

  const vaciar = useCallback(() => {
    sonarTecla();
    setCarrito({});
  }, []);

  const elegirMinutos = useCallback((opcion: number) => {
    sonarTecla();
    setMinutos(opcion);
  }, []);

  // ------------------------------------------------------------ teclado de monto libre
  const aplicarTecla = useCallback(
    (tecla: string) => {
      const nuevo = teclear(texto, tecla);
      if (nuevo === texto) {
        sonarTope();
        return;
      }
      sonarTecla();
      setTexto(nuevo);
      setGolpe((g) => g + 1);
    },
    [texto],
  );

  const pulsarTecla = useCallback(
    (tecla: string) => {
      setPisada(tecla);
      aplicarTecla(tecla);
      if (tecla === "borrar") {
        // Dejarla apretada borra todo.
        if (temporizadorBorrar.current) clearTimeout(temporizadorBorrar.current);
        temporizadorBorrar.current = setTimeout(() => {
          setTexto((actual) => {
            if (actual) sonarTecla();
            return "";
          });
        }, 550);
      }
    },
    [aplicarTecla],
  );

  // ------------------------------------------------------------ registro del día
  const cargarRegistro = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/registro", { cache: "no-store" });
      if (!respuesta.ok) throw new Error(String(respuesta.status));
      const datos = (await respuesta.json()) as ResumenDelDia;
      const actuales = new Set(datos.cobros.map((cobro) => cobro.ref));
      // Lo que apareció desde la última vez entra con golpe (menos en la primera carga).
      const previas = refsVistas.current;
      setNuevas(previas ? new Set([...actuales].filter((ref) => !previas.has(ref))) : new Set());
      refsVistas.current = actuales;
      setRegistro(datos);
      setFalloRegistro(false);
    } catch {
      setFalloRegistro(true);
    }
  }, []);

  const abrirRegistro = useCallback(
    (desde: Origen) => {
      audio();
      sonarTecla();
      setPantalla({ paso: "registro", volverA: desde });
      void cargarRegistro();
    },
    [cargarRegistro],
  );

  // ------------------------------------------------------------ pedir el QR
  const iniciarCobro = useCallback(
    async (cuerpo: object, centavosPrevios: number, tiempo: number | undefined, volverA: Origen) => {
      // El celular solo deja sonar si el audio se activó con un toque.
      // Se activa aquí para que suene después, cuando caiga el pago.
      audio();
      prepararVoz();
      setPantalla({ paso: "generando", centavos: centavosPrevios, minutos: tiempo, volverA });
      try {
        const respuesta = await fetch("/api/cobros", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        });
        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) {
          setPantalla({ paso: "error", mensaje: datos.error || "No se pudo generar el QR. Intenta de nuevo.", volverA });
          return;
        }
        const qrSvg = await QRCode.toString(datos.qrString, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 2,
          color: { dark: "#141413", light: PAPEL },
        });
        const inicio = Date.now();
        setAhora(inicio);
        setPantalla({
          paso: "qr",
          ref: datos.ref,
          centavos: Math.round(Number(datos.monto) * 100),
          items: datos.items,
          minutos: datos.minutos,
          qrSvg,
          inicio,
          // Se cuenta con el reloj del celular, a partir de lo que dura el QR.
          venceLocal: inicio + (datos.venceEn - datos.creadoEn),
          volverA,
        });
        sonarSelloQR();
      } catch {
        setPantalla({ paso: "error", mensaje: "No hay conexión. Revisa tu internet e intenta de nuevo.", volverA });
      }
    },
    [],
  );

  const cobrarTienda = useCallback(() => {
    audio();
    if (centavosCarrito <= 0) {
      sonarTope();
      return;
    }
    void iniciarCobro(
      { items: lineas.map(({ id, cantidad }) => ({ id, cantidad })), minutos },
      centavosCarrito,
      minutos,
      "tienda",
    );
  }, [centavosCarrito, lineas, minutos, iniciarCobro]);

  const cobrarLibre = useCallback(() => {
    audio();
    if (centavosTeclado <= 0) {
      sonarTope();
      return;
    }
    void iniciarCobro({ monto: texto.replace(/\.$/, "") }, centavosTeclado, undefined, "teclado");
  }, [centavosTeclado, texto, iniciarCobro]);

  /** Regresa a donde se estaba (el carrito o el teclado se conservan). */
  const volver = useCallback(() => {
    setPantalla((actual) => ("volverA" in actual ? { paso: actual.volverA } : { paso: "tienda" }));
  }, []);

  const cerrarRegistro = useCallback(() => {
    audio();
    sonarTecla();
    volver();
  }, [volver]);

  /** Después de un pago: mostrador limpio. */
  const nuevoCobro = useCallback(() => {
    sonarTecla();
    setPantalla({ paso: "tienda" });
  }, []);

  // ------------------------------------------------------------ efectos
  // El audio y la voz se crean o se reanudan en el primer toque, sea donde sea.
  useEffect(() => {
    iniciarVoz();
    const despertar = () => void audio();
    const eventos = ["pointerdown", "pointerup", "touchend", "click"] as const;
    for (const evento of eventos) window.addEventListener(evento, despertar, { capture: true, passive: true });
    const alVolver = () => {
      if (!document.hidden) despertar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, despertar, { capture: true });
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  // Al soltar una tecla se apaga la marca y se cancela el "borrar todo".
  useEffect(() => {
    const soltar = () => {
      if (temporizadorBorrar.current) clearTimeout(temporizadorBorrar.current);
      setPisada(null);
    };
    const eventos = ["pointerup", "pointercancel", "blur"] as const;
    for (const evento of eventos) window.addEventListener(evento, soltar, true);
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, soltar, true);
    };
  }, []);

  // El registro se carga al abrir la página y cada vez que se vuelve a ella.
  useEffect(() => {
    void cargarRegistro();
    const alVolver = () => {
      if (!document.hidden) void cargarRegistro();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [cargarRegistro]);

  // El fondo de toda la página (y la barra del celular) se vuelve verde con el pago.
  const verde = pantalla.paso === "pagado";
  useEffect(() => {
    document.documentElement.setAttribute("data-estado", verde ? "cayo" : "calc");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", verde ? VERDE : PAPEL);
  }, [verde]);

  // Teclado de computadora.
  const paso = pantalla.paso;
  useEffect(() => {
    if (paso !== "teclado" && paso !== "pagado" && paso !== "registro") return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.metaKey || evento.ctrlKey || evento.altKey) return;
      audio();
      if (paso === "teclado") {
        if (/^[0-9]$/.test(evento.key) || evento.key === ".") {
          aplicarTecla(evento.key);
          evento.preventDefault();
        } else if (evento.key === "Backspace" || evento.key === "Delete") {
          aplicarTecla("borrar");
          evento.preventDefault();
        } else if (evento.key === "Enter") {
          evento.preventDefault();
          cobrarLibre();
        }
      } else if (paso === "registro") {
        if (evento.key === "Enter" || evento.key === "Escape" || evento.key === "Backspace") {
          evento.preventDefault();
          cerrarRegistro();
        }
      } else if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        nuevoCobro();
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [paso, aplicarTecla, cobrarLibre, nuevoCobro, cerrarRegistro]);

  // Mientras se hace o se muestra el QR: un reloj para los puntos y la cuenta regresiva.
  const esperando = paso === "generando" || paso === "qr";
  useEffect(() => {
    if (!esperando) return;
    const reloj = setInterval(() => setAhora(Date.now()), 330);
    return () => clearInterval(reloj);
  }, [esperando]);

  // Mientras el registro está abierto, se actualiza solo (llegan pagos de otros mostradores).
  useEffect(() => {
    if (paso !== "registro") return;
    const intervalo = setInterval(() => void cargarRegistro(), CADA_CUANTO_ACTUALIZAR_REGISTRO_MS);
    return () => clearInterval(intervalo);
  }, [paso, cargarRegistro]);

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
          setSelloCae(false);
          setQuedan(SEGUNDOS_DE_REGRESO);
          setPantalla((actual) =>
            actual.paso === "qr" && actual.ref === refEnPantalla
              ? {
                  paso: "pagado",
                  ref: refEnPantalla,
                  centavos: Math.round(Number(datos.montoPagado ?? datos.monto) * 100),
                  items: datos.items ?? actual.items,
                  numero: datos.numero,
                  minutos: datos.minutos ?? actual.minutos,
                  recogerEn: datos.recogerEn,
                  pagadoEn: Number(datos.pagadoEn) || Date.now(),
                }
              : actual,
          );
        }
      } catch {
        // Se fue el internet un momento: se vuelve a preguntar en 2 s.
      } finally {
        ocupado = false;
      }
    };
    const intervalo = setInterval(consultar, CADA_CUANTO_CONSULTAR_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
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

  // Al caer el pago: sonido, voz y vibración, todo en el mismo instante.
  const refPagado = pantalla.paso === "pagado" ? pantalla.ref : null;
  const centavosPagados = pantalla.paso === "pagado" ? pantalla.centavos : 0;
  useEffect(() => {
    if (!refPagado) return;
    sonarCaja();
    decir(fraseDePago(centavosPagados));
    try {
      navigator.vibrate?.([90, 40, 180]);
    } catch {
      // Sin vibración: la pantalla verde ya lo dice.
    }
    setCarrito({});
    setTexto("");
    void cargarRegistro(); // el pago recién caído entra al registro y a la tira
    const sello = setTimeout(() => setSelloCae(true), 260); // el sello pega cuando se bota el cajón
    const cuenta = setInterval(() => setQuedan((q) => q - 1), 1000);
    return () => {
      clearTimeout(sello);
      clearInterval(cuenta);
    };
  }, [refPagado, centavosPagados, cargarRegistro]);

  // A los 10 segundos la pantalla verde regresa sola al mostrador.
  useEffect(() => {
    if (refPagado && quedan <= 0) setPantalla({ paso: "tienda" });
  }, [refPagado, quedan]);

  // ------------------------------------------------------------ qué pantalla se dibuja
  const puntos = "...".slice(0, (Math.floor(ahora / 330) % 3) + 1);

  switch (pantalla.paso) {
    case "pagado":
      return (
        <PantallaCayo
          referencia={pantalla.ref}
          centavos={pantalla.centavos}
          items={pantalla.items}
          numero={pantalla.numero}
          minutos={pantalla.minutos}
          recogerEn={pantalla.recogerEn}
          hora={new Date(pantalla.pagadoEn)}
          selloCae={selloCae}
          quedan={quedan}
          onNuevo={nuevoCobro}
        />
      );
    case "qr":
      return (
        <PantallaEspera
          referencia={pantalla.ref}
          centavos={pantalla.centavos}
          minutos={pantalla.minutos}
          qrSvg={pantalla.qrSvg}
          puntos={puntos}
          transcurridoMs={ahora - pantalla.inicio}
          restanteMs={pantalla.venceLocal - ahora}
          vencido={ahora >= pantalla.venceLocal}
          onCancelar={volver}
          onNuevo={volver}
        />
      );
    case "generando":
      return (
        <PantallaEspera
          referencia={null}
          centavos={pantalla.centavos}
          minutos={pantalla.minutos}
          qrSvg={null}
          puntos={puntos}
          transcurridoMs={0}
          restanteMs={0}
          vencido={false}
          onNuevo={volver}
        />
      );
    case "error":
      return <PantallaError mensaje={pantalla.mensaje} onVolver={volver} />;
    case "registro":
      return <PantallaRegistro registro={registro} fallo={falloRegistro} nuevas={nuevas} onVolver={cerrarRegistro} />;
    case "teclado":
      return (
        <PantallaTeclado
          textoMonto={comoSeTeclea(texto)}
          centavos={centavosTeclado}
          golpe={golpe}
          pisada={pisada}
          registro={registro}
          onTecla={aplicarTecla}
          onPulsar={pulsarTecla}
          onCobrar={cobrarLibre}
          onVolver={() => setPantalla({ paso: "tienda" })}
          onAbrirRegistro={() => abrirRegistro("teclado")}
        />
      );
    default:
      return (
        <PantallaTienda
          carrito={carrito}
          lineas={lineas}
          centavos={centavosCarrito}
          articulos={articulos}
          minutos={minutos}
          registro={registro}
          onAgregar={agregar}
          onQuitar={quitar}
          onVaciar={vaciar}
          onMinutos={elegirMinutos}
          onCobrar={cobrarTienda}
          onOtroMonto={() => setPantalla({ paso: "teclado" })}
          onAbrirRegistro={() => abrirRegistro("tienda")}
        />
      );
  }
}
