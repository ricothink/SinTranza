"use client";

// Las pantallas del mostrador. Aquí solo se dibuja: la lógica (qué pasa al
// tocar, cuándo se pide el QR, cuándo cayó el pago) vive en page.tsx.

import type { PointerEvent, MouseEvent } from "react";
import { Ajusta, altoDePantalla, esApaisado, type Calculo } from "./ajusta";
import {
  CATEGORIAS,
  OPCIONES_DE_MINUTOS,
  PRECIOS_DE_PRUEBA,
  PRODUCTOS,
  type LineaCobro,
  type Producto,
} from "@/lib/catalogo";
import { importeConLetra, letraCorta, textoDeMonto } from "@/lib/letra";
import { resumenDeProductos, type ResumenDelDia } from "@/lib/registro";

const dos = (n: number) => (n < 10 ? "0" : "") + n;

const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** "14:35" en la hora del celular (que es la del mostrador). */
const horaMin = (milisegundos: number) => {
  const fecha = new Date(milisegundos);
  return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
};

/** "2026-11-14" → "14 NOV". */
const fechaCorta = (dia: string) => {
  const [, mes, numero] = dia.split("-");
  return `${Number(numero)} ${MESES[Number(mes) - 1] ?? ""}`;
};

const centavosDe = (pesos: number) => Math.round(pesos * 100);

// Tamaños de los letreros (se miden contra la pantalla, como en la maqueta).
const calcTitulo: Calculo = (c) => ({ w: c.w * 0.97, h: altoDePantalla() * (esApaisado() ? 0.4 : 0.44) });
// Con el bloque "REGRESA A LAS…" en pantalla ancha, el letrero cede espacio para que el importe se siga viendo grande.
const calcTituloConRecoge: Calculo = (c) => ({ w: c.w * 0.97, h: altoDePantalla() * (esApaisado() ? 0.27 : 0.44) });
const calcNoEntregar: Calculo = (c) => ({ w: c.w, h: altoDePantalla() * 0.085 });
const calcEspera: Calculo = (c) => ({ w: c.w, h: altoDePantalla() * 0.05 });
const calcRegresa: Calculo = (c) => ({ w: c.w, h: altoDePantalla() * 0.065 });

function Monto({ texto, golpe = 0 }: { texto: string; golpe?: number }) {
  return (
    <Ajusta key={golpe} className={golpe > 0 ? "monto golpe" : "monto"}>
      <span className="peso">$</span>
      {texto}
    </Ajusta>
  );
}

// ---------------------------------------------------------------- la tira de arriba

/** Lo último que selló el banco hoy y cuántos van. Al tocarla se abre el registro. */
function Tira({ registro, onAbrir }: { registro: ResumenDelDia | null; onAbrir: () => void }) {
  const ultimo = registro?.cobros[0];
  return (
    <button className="tira" type="button" onClick={onAbrir} aria-label="Ver los cobros de hoy">
      <span className={ultimo ? "ult" : "ult nada"}>
        {ultimo
          ? `CAYÓ $${textoDeMonto(centavosDe(ultimo.monto))} · ${horaMin(ultimo.pagadoEn)}`
          : registro
            ? "HOY TODAVÍA NO CAE NADA"
            : "ABRIR COBROS DE HOY"}
      </span>
      <span className="hoy">HOY: {registro ? registro.cuantos : "–"}</span>
    </button>
  );
}

// ---------------------------------------------------------------- 0 · mostrador

export function PantallaTienda({
  carrito,
  lineas,
  centavos,
  articulos,
  minutos,
  registro,
  onAgregar,
  onQuitar,
  onVaciar,
  onMinutos,
  onCobrar,
  onOtroMonto,
  onAbrirRegistro,
}: {
  carrito: Record<string, number>;
  lineas: LineaCobro[];
  centavos: number;
  articulos: number;
  minutos: number;
  registro: ResumenDelDia | null;
  onAgregar: (producto: Producto, tarjeta: HTMLElement | null) => void;
  onQuitar: (producto: Producto) => void;
  onVaciar: () => void;
  onMinutos: (minutos: number) => void;
  onCobrar: () => void;
  onOtroMonto: () => void;
  onAbrirRegistro: () => void;
}) {
  const lista = centavos > 0;
  return (
    <main className="pantalla tienda">
      <header className="cabeza">
        <b>Sin Tranza</b>
        <button className="texto-chico" type="button" onClick={onOtroMonto}>
          otro monto
        </button>
        <span>Milpa</span>
      </header>
      <Tira registro={registro} onAbrir={onAbrirRegistro} />
      <div className="cuerpo">
        <div className="catalogo">
          {PRECIOS_DE_PRUEBA && <p className="aviso-prueba">Precios de prueba · todo cuesta $0.01</p>}
          {CATEGORIAS.map((categoria) => (
            <section key={categoria.id}>
              <h2 className="seccion">{categoria.titulo}</h2>
              <div className="prods">
                {PRODUCTOS.filter((producto) => producto.categoria === categoria.id).map((producto) => {
                  const cantidad = carrito[producto.id] ?? 0;
                  return (
                    <div key={producto.id} className={cantidad > 0 ? "prod lleva" : "prod"}>
                      <button
                        className="prod-add"
                        type="button"
                        aria-label={`Agregar ${producto.nombre}, $${textoDeMonto(producto.centavos)}${cantidad ? `. Lleva ${cantidad}` : ""}`}
                        onClick={(evento: MouseEvent<HTMLButtonElement>) => onAgregar(producto, evento.currentTarget)}
                      >
                        <span className="nom">{producto.nombre}</span>
                        <span className="pre">${textoDeMonto(producto.centavos)}</span>
                      </button>
                      {cantidad > 0 && (
                        <>
                          <span className="cant" aria-hidden="true">
                            ×{cantidad}
                          </span>
                          <button
                            className="menos"
                            type="button"
                            aria-label={`Quitar uno de ${producto.nombre}`}
                            onClick={() => onQuitar(producto)}
                          >
                            −
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <section className="lateral">
          <div className="importe">
            <span className="rot">
              Importe{articulos > 0 ? ` · ${articulos} ${articulos === 1 ? "platillo" : "platillos"}` : ""}
            </span>
            {articulos > 0 && (
              <button className="texto-chico vaciar" type="button" onClick={onVaciar}>
                vaciar
              </button>
            )}
            <Monto texto={textoDeMonto(centavos)} />
          </div>
          <ul className="lineas" aria-label="Lo que lleva el pedido">
            {lineas.length === 0 && <li className="vacia">Toca los platillos para agregarlos.</li>}
            {lineas.map((linea) => (
              <li key={linea.id}>
                <span>
                  {linea.cantidad} × {linea.nombre}
                </span>
                <span>${textoDeMonto(centavosDe(linea.precio * linea.cantidad))}</span>
              </li>
            ))}
          </ul>
          <p className="letra">{lista ? `(${importeConLetra(centavos)})` : "(toca los platillos)"}</p>
          <div className="listo-en" role="group" aria-label="Listo en cuántos minutos después de pagar">
            <span className="rot">Listo en</span>
            {OPCIONES_DE_MINUTOS.map((opcion) => (
              <button
                key={opcion}
                className={opcion === minutos ? "chip activo" : "chip"}
                type="button"
                aria-pressed={opcion === minutos}
                onClick={() => onMinutos(opcion)}
              >
                {opcion}
              </button>
            ))}
            <span className="rot">min</span>
          </div>
          <button className={lista ? "cobrar lista" : "cobrar"} type="button" aria-disabled={!lista} onClick={onCobrar}>
            MOSTRAR QR PARA COBRAR
          </button>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- 1 · monto libre

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "borrar"] as const;

export function PantallaTeclado({
  textoMonto,
  centavos,
  golpe,
  pisada,
  registro,
  onTecla,
  onPulsar,
  onCobrar,
  onVolver,
  onAbrirRegistro,
}: {
  /** Lo tecleado, ya con comas ("1,500.5"). */
  textoMonto: string;
  centavos: number;
  golpe: number;
  pisada: string | null;
  registro: ResumenDelDia | null;
  onTecla: (tecla: string) => void;
  /** Se llama al pisar la tecla (antes de soltar), igual que un teclado de caja. */
  onPulsar: (tecla: string) => void;
  onCobrar: () => void;
  onVolver: () => void;
  onAbrirRegistro: () => void;
}) {
  const lista = centavos > 0;
  const alPisar = (evento: PointerEvent<HTMLDivElement>) => {
    const boton = (evento.target as HTMLElement).closest<HTMLElement>(".tecla");
    if (!boton) return;
    evento.preventDefault();
    onPulsar(boton.dataset.t ?? "");
  };
  const alTocar = (evento: MouseEvent<HTMLDivElement>) => {
    if (evento.detail !== 0) return; // solo teclado físico o lector de pantalla
    const boton = (evento.target as HTMLElement).closest<HTMLElement>(".tecla");
    if (boton) onTecla(boton.dataset.t ?? "");
  };
  return (
    <main className="pantalla tienda teclado-pantalla">
      <div className="cuerpo">
        <section className="hoja">
          <header className="cabeza">
            <b>Sin Tranza</b>
            <button className="texto-chico" type="button" onClick={onVolver}>
              ← menú
            </button>
            <span>Monto libre</span>
          </header>
          <Tira registro={registro} onAbrir={onAbrirRegistro} />
          <div className="importe" aria-live="polite">
            <span className="rot">Importe</span>
            <Monto texto={textoMonto} golpe={golpe} />
          </div>
          <p className="letra">{lista ? `(${importeConLetra(centavos)})` : "(teclea el importe)"}</p>
        </section>
        <section className="teclado">
          <div className="teclas" onPointerDown={alPisar} onClick={alTocar}>
            {TECLAS.map((tecla) => (
              <button
                key={tecla}
                className={`tecla${tecla === "." ? " punto" : ""}${pisada === tecla ? " pisada" : ""}`}
                type="button"
                data-t={tecla}
                aria-label={tecla === "borrar" ? "Borrar" : tecla === "." ? "Punto para centavos" : tecla}
              >
                {tecla === "borrar" ? (
                  <>
                    <svg viewBox="0 0 30 22" aria-hidden="true">
                      <path d="M10 1.5H28.5V20.5H10L1.8 11Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="miter" />
                      <path d="M14.5 6.5l9 9M23.5 6.5l-9 9" fill="none" stroke="currentColor" strokeWidth="3" />
                    </svg>
                    <small>BORRAR</small>
                  </>
                ) : tecla === "." ? (
                  <>
                    <span aria-hidden="true">.</span>
                    <small>CENTAVOS</small>
                  </>
                ) : (
                  tecla
                )}
              </button>
            ))}
          </div>
          <button className={lista ? "cobrar lista" : "cobrar"} type="button" aria-disabled={!lista} onClick={onCobrar}>
            MOSTRAR QR PARA COBRAR
          </button>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- registro del día

export function PantallaRegistro({
  registro,
  fallo,
  nuevas,
  onVolver,
}: {
  registro: ResumenDelDia | null;
  /** true si no se pudo cargar el registro. */
  fallo: boolean;
  /** Referencias que acaban de aparecer (para el golpe de entrada). */
  nuevas: ReadonlySet<string>;
  onVolver: () => void;
}) {
  const cuantos = registro?.cuantos ?? 0;
  const suma = registro?.sumaCentavos ?? 0;
  return (
    <main className="pantalla registro">
      <section className="libro">
        <header className="cabeza">
          <b>Sin Tranza</b>
          <span>Cobros de hoy{registro ? ` · ${fechaCorta(registro.dia)}` : ""}</span>
        </header>
        <ul className="renglones" aria-label="Cobros de hoy">
          {!registro && (
            <li className="vacio">
              <b>{fallo ? "NO SE PUDO CARGAR." : "CARGANDO…"}</b>
              {fallo && <p>Revisa tu internet. Se vuelve a intentar solo.</p>}
            </li>
          )}
          {registro && cuantos === 0 && (
            <li className="vacio">
              <b>HOY TODAVÍA NO CAE NADA.</b>
              <p>Aquí se apunta solo lo que el banco ya selló. Lo que te enseñen en una captura no cuenta.</p>
            </li>
          )}
          {registro?.cobros.map((cobro) => {
            const texto = textoDeMonto(centavosDe(cobro.monto));
            const detalle = [
              cobro.recogerEn !== undefined ? `RECOGE ${horaMin(cobro.recogerEn)}` : null,
              cobro.items && cobro.items.length > 0 ? resumenDeProductos(cobro.items) : "MONTO LIBRE",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={cobro.ref} className={nuevas.has(cobro.ref) ? "fila nueva" : "fila"}>
                <span className="cuando">
                  {horaMin(cobro.pagadoEn)}
                  <small>{cobro.numero !== undefined ? `PEDIDO ${dos(cobro.numero)}` : `NOTA ${cobro.ref}`}</small>
                </span>
                <span className="pag">PAGADO</span>
                <span className={texto.length > 6 ? "cuanto largo" : "cuanto"}>
                  <span className="peso">$</span>
                  {texto}
                </span>
                <span className="que">{detalle}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="suma">
        <div className="importe">
          <span className="rot">
            Suma de hoy · {cuantos} {cuantos === 1 ? "cobro" : "cobros"}
          </span>
          <Monto texto={textoDeMonto(suma)} />
        </div>
        <p className="letra">({importeConLetra(suma)})</p>
        <button className="volver" type="button" onClick={onVolver}>
          VOLVER A COBRAR
        </button>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- 2 · espera

const reloj = (milisegundos: number) => {
  const segundos = Math.max(0, Math.ceil(milisegundos / 1000));
  return `${Math.floor(segundos / 60)}:${dos(segundos % 60)}`;
};

export function PantallaEspera({
  referencia,
  centavos,
  minutos,
  qrSvg,
  puntos,
  transcurridoMs,
  restanteMs,
  vencido,
  onCancelar,
  onNuevo,
}: {
  referencia: string | null;
  centavos: number;
  /** En cuánto estará listo el pedido (undefined en un cobro de monto libre). */
  minutos?: number;
  /** null mientras Pey todavía hace el QR. */
  qrSvg: string | null;
  puntos: string;
  transcurridoMs: number;
  restanteMs: number;
  vencido: boolean;
  onCancelar?: () => void;
  onNuevo: () => void;
}) {
  const generando = qrSvg === null;
  return (
    <main className="pantalla espera" role="status">
      <section className="info">
        <header className="cabeza">
          <b>Sin Tranza</b>
          <span>Nota N.º {referencia ?? "·······"}</span>
        </header>
        <div className="importe">
          <span className="rot">Importe</span>
          <Monto texto={textoDeMonto(centavos)} />
        </div>
        <p className="letra">({importeConLetra(centavos)})</p>
        {minutos !== undefined && <p className="entrega">Listo en {minutos} min después de pagar</p>}
      </section>

      <div className={vencido ? "qr vencido" : "qr"} role="img" aria-label="Código QR para pagar con CoDi">
        {qrSvg ? <div className="qr-caja golpe" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <div className="qr-hueco" />}
        {vencido && (
          <div className="qr-vencido">
            <b>ESTE QR YA VENCIÓ</b>
            <span>No se cobró nada. Haz un cobro nuevo.</span>
          </div>
        )}
      </div>

      <section className="estado">
        {vencido ? (
          <button className="nuevo-papel" type="button" onClick={onNuevo}>
            NUEVO COBRO
          </button>
        ) : (
          <>
            <div className="sin-sello">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="0" width="100" height="100" />
              </svg>
              <Ajusta className="esp" calculo={calcEspera}>
                {generando ? "HACIENDO EL QR" : "ESPERANDO AL BANCO"}
                <span className="pts" aria-hidden="true">
                  {puntos}
                </span>
                {!generando && (
                  <span className="reloj" aria-hidden="true">
                    {reloj(transcurridoMs)}
                  </span>
                )}
              </Ajusta>
            </div>
            <div className="vence">
              <span>{generando ? "" : `El QR vence en ${reloj(restanteMs)}`}</span>
              {onCancelar && (
                <button className="texto-chico" type="button" onClick={onCancelar}>
                  cancelar cobro
                </button>
              )}
            </div>
          </>
        )}
        <div className="no-entregar">
          <Ajusta className="" calculo={calcNoEntregar}>
            NO ENTREGAR MERCANCÍA
          </Ajusta>
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- 3 · ya cayó

export function PantallaCayo({
  referencia,
  centavos,
  items,
  numero,
  minutos,
  recogerEn,
  hora,
  selloCae,
  quedan,
  onNuevo,
}: {
  referencia: string;
  centavos: number;
  items?: LineaCobro[];
  numero?: number;
  minutos?: number;
  /** A qué hora debe regresar el cliente (milisegundos). */
  recogerEn?: number;
  hora: Date;
  selloCae: boolean;
  quedan: number;
  onNuevo: () => void;
}) {
  const horaTexto = `${dos(hora.getHours())}:${dos(hora.getMinutes())}:${dos(hora.getSeconds())}`;
  const fecha = `${hora.getDate()} ${MESES[hora.getMonth()]} ${hora.getFullYear()} · ${dos(hora.getHours())}:${dos(hora.getMinutes())}`;
  return (
    <main className={selloCae ? "pantalla cayo pum2" : "pantalla cayo pum"} role="alert">
      <header className="cabeza">
        <b>Sin Tranza</b>
        <span>
          Nota N.º {referencia} · {horaTexto}
        </span>
      </header>
      <h1 className="titulo">
        <Ajusta className="t-in" calculo={recogerEn !== undefined ? calcTituloConRecoge : calcTitulo}>
          <span>¡YA </span>
          <span>CAYÓ!</span>
        </Ajusta>
      </h1>
      <div className="c-monto">
        <Monto texto={textoDeMonto(centavos)} />
      </div>
      {recogerEn !== undefined && (
        <div className="recoge">
          <Ajusta className="" calculo={calcRegresa}>
            REGRESA A LAS {horaMin(recogerEn)}
          </Ajusta>
          <p>
            {numero !== undefined ? `Pedido N.º ${dos(numero)} · ` : ""}
            {minutos !== undefined ? `Listo en ${minutos} min` : ""}
          </p>
        </div>
      )}
      <div className="c-pie">
        <div className="c-col">
          {items && items.length > 0 && <p className="c-items">{resumenDeProductos(items)}</p>}
          <p className="c-letra">{letraCorta(centavos)}</p>
        </div>
        <svg className={selloCae ? "sello cae" : "sello"} viewBox="0 0 300 160" aria-hidden="true">
          <defs>
            <filter id="tinta" x="-6%" y="-10%" width="112%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="11" result="onda" />
              <feDisplacementMap in="SourceGraphic" in2="onda" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="chueco" />
              <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="1" seed="4" result="grano" />
              <feColorMatrix in="grano" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -16 0 0 0 11" result="huecos" />
              <feComposite in="chueco" in2="huecos" operator="in" />
            </filter>
          </defs>
          <g filter="url(#tinta)">
            <rect x="7" y="7" width="286" height="146" rx="18" fill="none" stroke="#FFFFFF" strokeWidth="10" />
            <rect x="21" y="21" width="258" height="118" rx="9" fill="none" stroke="#FFFFFF" strokeWidth="3" />
            <g fill="#FFFFFF" textAnchor="middle">
              <text x="150" y="50" fontSize="23" fontWeight="700" letterSpacing="4">BANCO · CODI</text>
              <text x="150" y="106" fontSize="60" fontWeight="700" letterSpacing="3">PAGADO</text>
              <text x="150" y="131" fontSize="19" fontWeight="700" letterSpacing="2">{fecha}</text>
            </g>
          </g>
        </svg>
      </div>
      <button className="nuevo" type="button" onClick={onNuevo}>
        NUEVO COBRO
      </button>
      <p className="regresa">
        Regresa sola al mostrador en <span>{Math.max(quedan, 0)}</span> s
      </p>
    </main>
  );
}

// ---------------------------------------------------------------- error

export function PantallaError({ mensaje, onVolver }: { mensaje: string; onVolver: () => void }) {
  return (
    <main className="pantalla error" role="alert">
      <header className="cabeza">
        <b>Sin Tranza</b>
        <span>Sin sello</span>
      </header>
      <div className="error-cuerpo">
        <h1>NO SE PUDO</h1>
        <p>{mensaje}</p>
      </div>
      <button className="nuevo-papel" type="button" onClick={onVolver}>
        VOLVER
      </button>
    </main>
  );
}
