# Horarios Brensolma (prototipo)

App web para que cada técnico marque desde el celular:

🏠 Salí de casa → 📍 Llegué al primer lugar de trabajo → 🔧 Arranco a trabajar (proyecto) → (🔁 Cambio de proyecto, opcional) → ✅ Terminé de trabajar → 🚗 Salí del último lugar de trabajo → 🏠 Llegué a casa

Los viajes entre clientes durante el día **no se marcan**: son parte del trabajo.

- **Las marcas de casa** solo se pueden hacer a menos de 150 m de la casa aprobada del empleado. Esto lo controla la base de datos, no el celular.
- **La hora** la pone el servidor, no el teléfono.
- **La ubicación** se toma solo en el momento de marcar. La app no sigue a nadie durante el día.
- **Panel de administración** (`/admin.html`): reporte por período con viaje, horas de viaje a pagar, horas trabajadas, extras, horas hombre por proyecto y Excel.

## Reglas de cálculo (se cambian en Configuración)
| Concepto | Regla |
|---|---|
| Viaje del día | Ida: de la salida de casa al **primer** lugar de trabajo (Brensolma o cliente). Vuelta: del **último** lugar de trabajo a casa. Los viajes entre clientes no son viaje: son trabajo |
| Viaje incluido en el sueldo | 2 h 24 min por día |
| Horas de viaje a pagar | el excedente, en bloques de 25 min = 0,5 h (por defecto solo bloques completos) |
| Horas trabajadas | de "Arranco a trabajar" a "Terminé de trabajar" (incluye los viajes entre clientes) |
| Horas por proyecto | si en el día toca "Cambio de proyecto", el tiempo desde ese momento va al proyecto nuevo |
| Horas extra | lo que pase de 9 h trabajadas |

---

## Puesta en marcha (una sola vez, unos 30 minutos)

### 1. Crear el proyecto en Firebase (gratis)
1. Entrá a https://console.firebase.google.com y tocá **Crear un proyecto**. Nombre: `horarios-brensolma`. Analytics no hace falta.
2. **Authentication → Comenzar → Correo electrónico/contraseña → Habilitar → Guardar.**
3. **Firestore Database → Crear base de datos →** ubicación `southamerica-east1 (São Paulo)` → **modo producción**.
4. En Firestore, pestaña **Reglas**: borrá todo, pegá el contenido de `firestore.rules` y tocá **Publicar**.
5. **Configuración del proyecto (⚙️) → Tus apps → Web (`</>`)** → nombre `horarios` → **Registrar**. Copiá los datos de `firebaseConfig` en `js/config.js`.

### 2. Publicarla (Render, como tus bots)
1. Subí todos estos archivos a un repo nuevo de GitHub, en la cuenta **ManuWorship**. Por ejemplo `horarios-brensolma`.
2. En Render: **New → Static Site** → el repo → Build Command vacío → Publish Directory `.` → **Deploy**.
3. Te da una URL `https://horarios-brensolma.onrender.com`. Los sitios estáticos no se duermen.
4. En Firebase, **Authentication → Configuración → Dominios autorizados**: agregá ese dominio.

### 3. Hacerte administrador
1. Abrí la URL en el celular y **creá tu cuenta** ("Es mi primera vez").
2. En Firebase, en **Firestore → empleados →** tu documento, cambiá `estado` a `activo` y `rol` a `admin`.
3. Abrí `/admin.html` en la compu y entrá con la misma cuenta.

### 4. Configurar
- **Configuración:** estando en Brensolma, tocá **Usar mi ubicación actual** y **Guardar**. Revisá las horas.
- **Proyectos:** cargá los proyectos y clientes activos.
- **Empleados:** cada técnico se registra solo y, **estando en su casa**, toca "Registrar ubicación". Vos la revisás en el mapa, tocás **Aprobar** y **Activar**.

### 5. Instalar en el celular
- **Android (Chrome):** menú ⋮ → **Instalar app**.
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.
- La primera vez pide permiso de ubicación: hay que **Permitir**.

---

## Límites conocidos (prototipo)
- **El GPS se puede falsear** con apps de ubicación falsa, sobre todo en Android. La geocerca, la precisión mínima de 100 m y el mapa de cada marca lo dificultan y lo hacen visible, pero no lo hacen imposible.
- **Hace falta internet para marcar**, para que la hora sea la del servidor. Si alguien no tiene señal, la marca se carga después desde **Correcciones**.
- **Una jornada que pasa la medianoche** queda partida en dos días.
- **Legal:** conviene informar a los empleados por escrito que la ubicación se registra solo al marcar y para qué se usa (Ley 25.326).

## Código fuente
`js/app.js` y `js/admin.js` ya vienen armados, no hay que compilar nada. El código fuente legible está en la carpeta `src/`.
