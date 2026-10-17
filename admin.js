// Panel de administración: empleados, casas, proyectos, configuración, reportes y correcciones.
import * as XLSX from "xlsx";
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut, doc, getDoc, setDoc, updateDoc,
  addDoc, deleteDoc, collection, query, where, getDocs, Timestamp,
} from "./fb.js";
import { TIPOS, CONFIG_DEFECTO, resumirJornada, hhmm, fechaLocal, cajaGrados, distanciaM } from "./calculos.js";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...hijos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos.flat()) if (h !== null && h !== undefined) e.append(h.nodeType ? h : document.createTextNode(h));
  return e;
};
const hora = (t) => (t ? new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const fechaAR = (iso) => iso.split("-").reverse().join("/");
const horas = (m) => Math.round((m / 60) * 100) / 100;
const mapa = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;

let cfg = { ...CONFIG_DEFECTO }, empleados = [], proyectos = [], ultimoReporte = null;

function aviso(texto, tipo = "info") {
  const a = $("#aviso");
  a.textContent = texto; a.className = `aviso ${tipo}`; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), 6000);
}
async function intentar(fn) {
  try { await fn(); } catch (e) { console.error(e); aviso(e.message || String(e), "error"); }
}

// ------------------------------------------------------------------ acceso
$("#form-login").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(() => signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#pass").value));
});
$("#btn-salir").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (u) => {
  $("#btn-salir").hidden = !u;
  if (!u) return mostrar("login");
  const p = await getDoc(doc(db, "empleados", u.uid));
  if (!p.exists() || p.data().rol !== "admin") {
    mostrar("login");
    return aviso("Esta cuenta no tiene permiso de administración.", "error");
  }
  const c = await getDoc(doc(db, "config", "general"));
  if (c.exists()) cfg = { ...CONFIG_DEFECTO, ...c.data() };
  await Promise.all([cargarEmpleados(), cargarProyectos()]);
  const hoy = new Date();
  $("#desde").value = fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  $("#hasta").value = fechaLocal(hoy);
  $("#m-fecha").value = fechaLocal(hoy);
  renderConfig();
  mostrar("reporte");
});

function mostrar(id) {
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== `tab-${id}`;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-pressed", b.dataset.tab === id);
  $(".tabs").hidden = id === "login";
}
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => mostrar(b.dataset.tab));

// ------------------------------------------------------------------ empleados
async function cargarEmpleados() {
  const s = await getDocs(collection(db, "empleados"));
  empleados = s.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  renderEmpleados();
  for (const sel of document.querySelectorAll(".sel-empleado")) {
    const todos = sel.dataset.todos !== undefined;
    sel.replaceChildren(...(todos ? [el("option", { value: "" }, "Todos")] : []),
      ...empleados.map((e) => el("option", { value: e.uid }, e.nombre)));
  }
}

function renderEmpleados() {
  const pend = empleados.filter((e) => e.estado !== "activo" || e.casaPropuesta).length;
  $("#badge-emp").textContent = pend ? ` (${pend})` : "";
  $("#tabla-empleados").replaceChildren(...empleados.map((e) => {
    let casa;
    if (e.casa) {
      casa = el("span", {}, el("a", { href: mapa(e.casa.lat, e.casa.lng), target: "_blank" }, "✅ Ver casa"), " ",
        el("button", { class: "btn peq", onclick: () => intentar(() => borrarCasa(e)) }, "Borrar"));
    } else if (e.casaPropuesta) {
      const p = e.casaPropuesta;
      casa = el("span", {}, el("a", { href: mapa(p.lat, p.lng), target: "_blank" }, `📍 Propuesta (±${p.acc} m)`), " ",
        el("button", { class: "btn peq prim", onclick: () => intentar(() => aprobarCasa(e)) }, "Aprobar"));
    } else casa = el("span", { class: "alerta" }, "Sin casa");
    const activo = e.estado === "activo";
    return el("tr", {},
      el("td", {}, e.nombre, el("br"), el("small", {}, e.email || "")),
      el("td", {}, el("button", { class: `btn peq ${activo ? "" : "prim"}`,
        onclick: () => intentar(() => cambiar(e, { estado: activo ? "inactivo" : "activo" })) },
      activo ? "Activo ✓ (desactivar)" : "Activar")),
      el("td", {}, casa),
      el("td", {}, el("select", { onchange: (ev) => intentar(() => cambiar(e, { rol: ev.target.value })) },
        el("option", { value: "empleado", selected: e.rol !== "admin" }, "Empleado"),
        el("option", { value: "admin", selected: e.rol === "admin" }, "Administración"))));
  }));
}

async function cambiar(e, datos) {
  await updateDoc(doc(db, "empleados", e.uid), datos);
  Object.assign(e, datos); renderEmpleados(); aviso("Guardado.", "ok");
}
async function aprobarCasa(e) {
  const p = e.casaPropuesta;
  const casa = { lat: p.lat, lng: p.lng, ...cajaGrados(p.lat, cfg.radioCasaM) };
  await updateDoc(doc(db, "empleados", e.uid), { casa, casaPropuesta: null });
  e.casa = casa; e.casaPropuesta = null; renderEmpleados(); aviso(`Casa de ${e.nombre} aprobada.`, "ok");
}
async function borrarCasa(e) {
  if (!confirm(`¿Borrar la casa de ${e.nombre}? Va a tener que registrarla de nuevo.`)) return;
  await updateDoc(doc(db, "empleados", e.uid), { casa: null });
  e.casa = null; renderEmpleados();
}

// ------------------------------------------------------------------ proyectos
async function cargarProyectos() {
  const s = await getDocs(collection(db, "proyectos"));
  proyectos = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  $("#tabla-proyectos").replaceChildren(...proyectos.map((p) => el("tr", {},
    el("td", {}, p.nombre), el("td", {}, p.cliente || ""),
    el("td", {}, el("button", { class: "btn peq", onclick: () => intentar(async () => {
      await updateDoc(doc(db, "proyectos", p.id), { activo: !p.activo }); await cargarProyectos();
    }) }, p.activo ? "Activo ✓ (archivar)" : "Archivado (activar)")))));
  $("#m-proyecto").replaceChildren(el("option", { value: "" }, "—"),
    ...proyectos.map((p) => el("option", { value: p.id }, p.cliente ? `${p.nombre} · ${p.cliente}` : p.nombre)));
}
$("#form-proyecto").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(async () => {
    const nombre = $("#p-nombre").value.trim();
    if (!nombre) return;
    await addDoc(collection(db, "proyectos"), { nombre, cliente: $("#p-cliente").value.trim(), activo: true });
    ev.target.reset(); await cargarProyectos(); aviso("Proyecto agregado.", "ok");
  });
});

// ------------------------------------------------------------------ configuración
const CAMPOS = ["jornadaMin", "viajeIncluidoMin", "bloqueViajeMin", "horasPorBloque", "radioCasaM", "radioBrensolmaM"];
function renderConfig() {
  for (const k of CAMPOS) $(`#c-${k}`).value = cfg[k];
  $("#c-redondeo").value = cfg.redondeoBloque;
  $("#c-lat").value = cfg.brensolma?.lat ?? "";
  $("#c-lng").value = cfg.brensolma?.lng ?? "";
}
$("#btn-ubic-bsm").addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition((p) => {
    $("#c-lat").value = p.coords.latitude.toFixed(6); $("#c-lng").value = p.coords.longitude.toFixed(6);
    aviso(`Ubicación tomada (±${Math.round(p.coords.accuracy)} m). Tocá Guardar.`);
  }, (e) => aviso(e.message, "error"), { enableHighAccuracy: true, timeout: 20000 });
});
$("#form-config").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(async () => {
    const nuevo = { redondeoBloque: $("#c-redondeo").value,
      brensolma: { lat: parseFloat($("#c-lat").value), lng: parseFloat($("#c-lng").value) } };
    for (const k of CAMPOS) nuevo[k] = parseFloat($(`#c-${k}`).value);
    if (CAMPOS.some((k) => !Number.isFinite(nuevo[k])) || !Number.isFinite(nuevo.brensolma.lat)) throw new Error("Revisá los números.");
    const cambioRadio = nuevo.radioCasaM !== cfg.radioCasaM;
    await setDoc(doc(db, "config", "general"), nuevo);
    cfg = { ...CONFIG_DEFECTO, ...nuevo };
    if (cambioRadio) {  // recalcular la zona de cada casa aprobada
      for (const e of empleados.filter((e) => e.casa)) {
        const casa = { lat: e.casa.lat, lng: e.casa.lng, ...cajaGrados(e.casa.lat, cfg.radioCasaM) };
        await updateDoc(doc(db, "empleados", e.uid), { casa }); e.casa = casa;
      }
    }
    aviso("Configuración guardada.", "ok");
  });
});

// ------------------------------------------------------------------ marcas (lectura)
async function leerMarcas(desde, hasta, uid) {
  const q = query(collection(db, "marcas"), where("fecha", ">=", desde), where("fecha", "<=", hasta));
  const s = await getDocs(q);
  return s.docs.map((d) => { const m = d.data(); return { id: d.id, ...m, ts: m.ts ? m.ts.toMillis() : null }; })
    .filter((m) => m.ts && (!uid || m.uid === uid));
}
const nombreDe = (uid, m) => empleados.find((e) => e.uid === uid)?.nombre || m?.nombre || uid;

// ------------------------------------------------------------------ reporte
$("#form-reporte").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(generarReporte); });
async function generarReporte() {
  const desde = $("#desde").value, hasta = $("#hasta").value, uid = $("#r-empleado").value;
  const marcas = await leerMarcas(desde, hasta, uid);
  const grupos = {};
  for (const m of marcas) (grupos[`${m.uid}|${m.fecha}`] ||= []).push(m);
  const jornadas = Object.entries(grupos).map(([k, ms]) => {
    const [u, fecha] = k.split("|");
    return { uid: u, nombre: nombreDe(u, ms[0]), fecha, ...resumirJornada(ms, cfg) };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));

  const porProyecto = {}, porEmpleado = {};
  for (const j of jornadas) {
    for (const [p, min] of Object.entries(j.porProyecto)) {
      porProyecto[p] ||= { total: 0, personas: {} };
      porProyecto[p].total += min;
      porProyecto[p].personas[j.nombre] = (porProyecto[p].personas[j.nombre] || 0) + min;
    }
    const e = (porEmpleado[j.nombre] ||= { dias: 0, trabajo: 0, extra: 0, viaje: 0, hViaje: 0 });
    e.dias++; e.trabajo += j.trabajoMin; e.extra += j.extraMin; e.viaje += j.viajeMin; e.hViaje += j.horasViajeExtra;
  }
  ultimoReporte = { desde, hasta, marcas, jornadas, porProyecto, porEmpleado };

  $("#tabla-jornadas").replaceChildren(...jornadas.map((j) => el("tr", {},
    el("td", {}, fechaAR(j.fecha)), el("td", {}, j.nombre),
    el("td", {}, hora(j.salidaCasa)), el("td", {}, hora(j.llegadaTrabajo), el("br"), el("small", {}, j.lugar)),
    el("td", {}, hora(j.salidaTrabajo)), el("td", {}, hora(j.llegadaCasa)),
    el("td", {}, hhmm(j.viajeMin)), el("td", {}, j.horasViajeExtra ? `${j.horasViajeExtra} h` : "—"),
    el("td", {}, hhmm(j.trabajoMin)), el("td", {}, j.extraMin ? hhmm(j.extraMin) : "—"),
    el("td", {}, Object.entries(j.porProyecto).map(([p, m]) => el("div", {}, `${p}: ${hhmm(m)}`)),
      j.avisos.map((a) => el("div", { class: "alerta" }, `⚠️ ${a}`))))));
  $("#tabla-proyectos-horas").replaceChildren(...Object.entries(porProyecto).sort((a, b) => b[1].total - a[1].total)
    .map(([p, v]) => el("tr", {}, el("td", {}, p), el("td", {}, `${horas(v.total)} h`),
      el("td", {}, Object.entries(v.personas).map(([n, m]) => `${n} ${horas(m)} h`).join(" · ")))));
  $("#tabla-empleados-tot").replaceChildren(...Object.entries(porEmpleado).map(([n, v]) => el("tr", {},
    el("td", {}, n), el("td", {}, v.dias), el("td", {}, `${horas(v.trabajo)} h`), el("td", {}, `${horas(v.extra)} h`),
    el("td", {}, hhmm(v.viaje)), el("td", {}, `${v.hViaje} h`))));
  $("#resultado").hidden = false;
  $("#sin-datos").hidden = jornadas.length > 0;
}

$("#btn-excel").addEventListener("click", () => intentar(async () => {
  if (!ultimoReporte) throw new Error("Primero generá el reporte.");
  const r = ultimoReporte, wb = XLSX.utils.book_new();
  const hoja = (filas, nombre) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), nombre);
  hoja(r.jornadas.map((j) => ({
    Fecha: fechaAR(j.fecha), Empleado: j.nombre, "Salió de casa": hora(j.salidaCasa), "Llegó al trabajo": hora(j.llegadaTrabajo),
    Lugar: j.lugar, "Salió del trabajo": hora(j.salidaTrabajo), "Llegó a casa": hora(j.llegadaCasa),
    "Viaje ida (min)": j.idaMin, "Viaje vuelta (min)": j.vueltaMin, "Viaje total (min)": j.viajeMin,
    "Excedente viaje (min)": j.viajeExcesoMin, "Horas de viaje a pagar": j.horasViajeExtra,
    "Horas trabajadas": horas(j.trabajoMin), "Horas extra": horas(j.extraMin),
    Proyectos: Object.entries(j.porProyecto).map(([p, m]) => `${p} (${horas(m)} h)`).join("; "),
    Observaciones: j.avisos.join("; "),
  })), "Jornadas");
  hoja(Object.entries(r.porProyecto).flatMap(([p, v]) => Object.entries(v.personas).map(([n, m]) => ({
    Proyecto: p, Empleado: n, Horas: horas(m) }))), "Horas por proyecto");
  hoja(Object.entries(r.porEmpleado).map(([n, v]) => ({
    Empleado: n, "Días": v.dias, "Horas trabajadas": horas(v.trabajo), "Horas extra": horas(v.extra),
    "Viaje total (h)": horas(v.viaje), "Horas de viaje a pagar": v.hViaje })), "Totales por empleado");
  hoja([...r.marcas].sort((a, b) => a.ts - b.ts).map((m) => ({
    Fecha: fechaAR(m.fecha), Hora: hora(m.ts), Empleado: nombreDe(m.uid, m), Marca: TIPOS[m.tipo]?.texto || m.tipo,
    Proyecto: m.proyectoNombre || "", Lugar: m.lugar || "", "Precisión GPS (m)": m.acc ?? "",
    Mapa: m.lat ? mapa(m.lat, m.lng) : "", Manual: m.manual ? `Sí (${m.motivo || ""})` : "" })), "Marcas");
  XLSX.writeFile(wb, `Horarios Brensolma ${r.desde} a ${r.hasta}.xlsx`);
}));

// ------------------------------------------------------------------ correcciones
$("#form-buscar-marcas").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(listarMarcas); });
async function listarMarcas() {
  const f = $("#m-fecha").value, uid = $("#m-empleado").value;
  const ms = (await leerMarcas(f, f, uid)).sort((a, b) => a.ts - b.ts);
  $("#tabla-marcas").replaceChildren(...ms.map((m) => {
    const e = empleados.find((x) => x.uid === m.uid);
    let dist = "";
    if (e?.casa && m.lat && (m.tipo === "salida_casa" || m.tipo === "llegada_casa")) dist = ` · a ${Math.round(distanciaM(m, e.casa))} m de casa`;
    return el("tr", {}, el("td", {}, hora(m.ts)), el("td", {}, nombreDe(m.uid, m)),
      el("td", {}, `${TIPOS[m.tipo]?.emoji || ""} ${TIPOS[m.tipo]?.texto || m.tipo}`,
        m.proyectoNombre ? el("small", {}, ` · ${m.proyectoNombre}`) : null, m.lugar ? el("small", {}, ` · ${m.lugar}`) : null,
        m.manual ? el("div", { class: "alerta" }, `Cargada a mano: ${m.motivo || ""}`) : null),
      el("td", {}, m.lat ? el("a", { href: mapa(m.lat, m.lng), target: "_blank" }, `mapa (±${m.acc} m)`) : "—", dist),
      el("td", {}, el("button", { class: "btn peq", onclick: () => intentar(async () => {
        if (!confirm("¿Borrar esta marca?")) return;
        await deleteDoc(doc(db, "marcas", m.id)); await listarMarcas();
      }) }, "Borrar")));
  }));
  $("#sin-marcas").hidden = ms.length > 0;
}
$("#form-agregar-marca").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(async () => {
    const uid = $("#m-empleado").value, fecha = $("#m-fecha").value, h = $("#m-hora").value, tipo = $("#m-tipo").value;
    const motivo = $("#m-motivo").value.trim();
    if (!uid || !fecha || !h || !motivo) throw new Error("Completá empleado, fecha, hora y motivo.");
    const [a, mes, d] = fecha.split("-").map(Number), [hh, mm] = h.split(":").map(Number);
    const datos = { uid, nombre: nombreDe(uid), tipo, fecha, ts: Timestamp.fromDate(new Date(a, mes - 1, d, hh, mm)),
      manual: true, motivo, cargadaPor: auth.currentUser.uid };
    if (tipo === "inicio" || tipo === "cambio") {
      const p = proyectos.find((x) => x.id === $("#m-proyecto").value);
      if (!p) throw new Error("Elegí el proyecto.");
      datos.proyectoId = p.id; datos.proyectoNombre = p.cliente ? `${p.nombre} · ${p.cliente}` : p.nombre;
    }
    if (tipo === "llegada_trabajo") datos.lugar = $("#m-lugar").value.trim() || "Sin dato";
    await addDoc(collection(db, "marcas"), datos);
    aviso("Marca agregada.", "ok"); await listarMarcas();
  });
});
