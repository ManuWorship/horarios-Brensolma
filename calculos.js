// Cálculos de jornada: viaje, horas trabajadas, extras y horas por proyecto.
// Todo en minutos. Sin dependencias para poder probarlo con node.

export const TIPOS = {
  salida_casa: { orden: 1, texto: "Salí de casa", emoji: "🏠" },
  llegada_trabajo: { orden: 2, texto: "Llegué al primer lugar de trabajo", emoji: "📍" },
  inicio: { orden: 3, texto: "Arranco a trabajar", emoji: "🔧" },
  cambio: { orden: 3, texto: "Cambio de proyecto", emoji: "🔁" },
  fin: { orden: 4, texto: "Terminé de trabajar", emoji: "✅" },
  salida_trabajo: { orden: 5, texto: "Salí del último lugar de trabajo", emoji: "🚗" },
  llegada_casa: { orden: 6, texto: "Llegué a casa", emoji: "🏠" },
};

// Qué marcas se permiten después de la última.
export const SIGUIENTES = {
  null: ["salida_casa"],
  salida_casa: ["llegada_trabajo"],
  llegada_trabajo: ["inicio"],
  inicio: ["fin", "cambio"],
  cambio: ["fin", "cambio"],
  fin: ["salida_trabajo"],
  salida_trabajo: ["llegada_casa"],
  llegada_casa: [],
};

export const CONFIG_DEFECTO = {
  jornadaMin: 9 * 60,          // más de 9 h de trabajo = horas extra
  viajeIncluidoMin: 144,       // 2 h 24 min de viaje ya incluidas en el sueldo
  bloqueViajeMin: 25,          // el excedente se paga cada 25 min...
  horasPorBloque: 0.5,         // ...como media hora
  redondeoBloque: "abajo",     // "abajo": solo bloques completos | "arriba": bloque empezado cuenta
  radioCasaM: 150,
  radioBrensolmaM: 250,
  brensolma: { lat: -34.8357, lng: -58.3800 }, // Cafferata Norte 3301, Burzaco (ajustar en el panel)
};

const min = (a, b) => Math.round((b - a) / 60000);

export function siguientes(marcasOrdenadas) {
  const ultima = marcasOrdenadas.length ? marcasOrdenadas[marcasOrdenadas.length - 1].tipo : null;
  return SIGUIENTES[ultima] || [];
}

export function distanciaM(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Caja aproximada (en grados) para un radio en metros. La usan las reglas de Firestore,
// que no tienen trigonometría.
export function cajaGrados(lat, radioM) {
  return {
    dLat: radioM / 111320,
    dLng: radioM / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

export function horasViajeExtra(viajeMin, cfg = CONFIG_DEFECTO) {
  const exceso = Math.max(0, viajeMin - cfg.viajeIncluidoMin);
  const bloques = cfg.redondeoBloque === "arriba"
    ? Math.ceil(exceso / cfg.bloqueViajeMin)
    : Math.floor(exceso / cfg.bloqueViajeMin);
  return { excesoMin: exceso, horas: bloques * cfg.horasPorBloque };
}

/**
 * Resume una jornada a partir de sus marcas (de un empleado, un día).
 * marcas: [{tipo, ts: Date|number, proyectoId?, proyectoNombre?}]
 */
function cerrar(abierto, hasta) {
  return { proyectoId: abierto.proyectoId || "", proyectoNombre: abierto.proyectoNombre || "Sin proyecto",
           desde: abierto.t, hasta, min: Math.round((hasta - abierto.t) / 60000) };
}

export function resumirJornada(marcas, cfg = CONFIG_DEFECTO) {
  const ms = [...marcas].map((m) => ({ ...m, t: +new Date(m.ts) })).sort((a, b) => a.t - b.t);
  const primera = (tipo) => ms.find((m) => m.tipo === tipo);
  const ultima = (tipo) => [...ms].reverse().find((m) => m.tipo === tipo);
  const avisos = [];

  const sc = primera("salida_casa"), lt = primera("llegada_trabajo");
  const st = ultima("salida_trabajo"), lc = ultima("llegada_casa");
  const ida = sc && lt ? min(sc.t, lt.t) : null;
  const vuelta = st && lc ? min(st.t, lc.t) : null;
  if (ida === null) avisos.push("Falta el viaje de ida completo");
  if (vuelta === null) avisos.push("Falta el viaje de vuelta completo");
  const viaje = (ida ?? 0) + (vuelta ?? 0);
  const viajeExtra = horasViajeExtra(viaje, cfg);

  // Jornada: del primer "Arranco" al último "Terminé". Los viajes entre clientes no se
  // marcan: son parte del trabajo. Si cambia de proyecto en el día toca "Cambio de
  // proyecto" (un solo toque) y el tiempo desde ahí va al proyecto nuevo.
  const tramos = [];
  let abierto = null;
  for (const m of ms) {
    if (m.tipo === "inicio" || m.tipo === "cambio") {
      if (m.tipo === "inicio" && abierto) avisos.push("Hay un 'Arranco' sin 'Terminé'");
      if (abierto) tramos.push(cerrar(abierto, m.t));
      abierto = m;
    } else if (m.tipo === "fin" && abierto) {
      tramos.push(cerrar(abierto, m.t));
      abierto = null;
    }
  }
  if (abierto) avisos.push("Quedó la jornada abierta (falta 'Terminé')");

  const trabajoMin = tramos.reduce((s, t) => s + t.min, 0);
  const extraMin = Math.max(0, trabajoMin - cfg.jornadaMin);
  const porProyecto = {};
  for (const t of tramos) porProyecto[t.proyectoNombre] = (porProyecto[t.proyectoNombre] || 0) + t.min;

  return {
    salidaCasa: sc?.t ?? null, llegadaTrabajo: lt?.t ?? null,
    salidaTrabajo: st?.t ?? null, llegadaCasa: lc?.t ?? null,
    lugar: lt?.lugar || "",
    idaMin: ida, vueltaMin: vuelta, viajeMin: viaje,
    viajeExcesoMin: viajeExtra.excesoMin, horasViajeExtra: viajeExtra.horas,
    trabajoMin, extraMin, tramos, porProyecto, avisos,
  };
}

export function hhmm(minutos) {
  if (minutos === null || minutos === undefined) return "—";
  const s = minutos < 0 ? "-" : "";
  const m = Math.abs(Math.round(minutos));
  return `${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function fechaLocal(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
