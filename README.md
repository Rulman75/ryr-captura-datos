# RYR Importadora · Sistema PWA de Captura de Inventario (iMin Lark 1 + SAP Business One)

Aplicativo Web Progresivo (**PWA Offline-First**) diseñado para los terminales portátiles **iMin Lark 1 (Android 13)** de **RYR Importadora (Antofagasta)**, integrado con **Vercel**, **Neon PostgreSQL** y **Nodemailer**, generando archivos `.xlsx` listos para **SAP Business One**.

---

## 🚀 Características Principales

1. **Optimizado para el lector láser del iMin Lark 1**:
   - Captura por *Keyboard Wedge* (ráfaga de caracteres + `Enter`).
   - Bloqueo inteligente del teclado virtual de Android (`Solo Láser` / `Teclado ON`) para que el teclado en pantalla no tape la lista mientras el operario pistolea.
   - **Modo Ráfaga** (`+1`, `+6`, `+12`, `+24` automático en cada disparo) y **Modo Pedir Cantidad** (para contar pallets o cajas cerradas).
   - Confirmación auditiva (*Beep* industrial vía Web Audio API) y vibración háptica.
2. **Consolidación Automática para SAP Business One**:
   - Si un mismo código de barra se pistolea varias veces durante la toma, el sistema **suma y consolida las cantidades en una única fila**.
   - El archivo Excel generado (`Inventario_RYR_<Folio>.xlsx`) contiene únicamente las columnas:
     - `CodigoBarra` (formateado como Texto para preservar ceros iniciales en códigos EAN-13/UPC).
     - `Cantidad` (numérico consolidado).
3. **Almacenamiento Híbrido (Offline Local + Neon PostgreSQL)**:
   - **En bodega (Offline)**: Cada lectura se guarda al instante en la memoria interna del iMin Lark 1 (`localStorage`). No se pierde ningún dato si se cae el Wi-Fi en un pasillo.
   - **Al finalizar la toma**: Envía el Excel adjunto por correo electrónico (**Nodemailer**) al destinatario indicado, respalda la toma en **Neon PostgreSQL** y guarda el registro en el **Historial de Tomas**, permitiendo limpiar e iniciar una nueva toma de inmediato.

---

## ⚙️ Configuración en Vercel y Neon

En tu proyecto de **Vercel** (`Settings` $\rightarrow$ `Environment Variables`), agrega las siguientes variables (puedes guiarte por [`.env.example`](file:///c:/Users/raulh/.gemini/antigravity/scratch/ryr-captura-datos/.env.example)):

```env
# 1. Base de datos Neon PostgreSQL (las tablas se crean automáticamente)
DATABASE_URL="postgresql://usuario:password@ep-tu-instancia.aws.neon.tech/neondb?sslmode=require"

# 2. Correo SMTP con Nodemailer (Ejemplo con Gmail Contraseña de Aplicación)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_USER="tu-correo@gmail.com"
SMTP_PASS="xxxx xxxx xxxx xxxx"
SMTP_FROM_NAME="Inventario RYR Importadora"
```

> **¿Cómo obtener `SMTP_PASS` en Gmail?**
> Entra a tu cuenta de Google $\rightarrow$ *Seguridad* $\rightarrow$ *Verificación en 2 pasos* $\rightarrow$ *Contraseñas de aplicaciones* ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)) y genera una clave de 16 letras. Con esto el dispositivo iMin Lark 1 podrá enviar el Excel a **cualquier correo electrónico** que ingrese el operario sin restricciones de dominio.

---

## 📱 Configuración del Dispositivo iMin Lark 1

1. En el **iMin Lark 1**, abre la app preinstalada de configuración del escáner (**Scanner Settings** / **Scan**):
   - Activa **Keyboard Output / Emulación de Teclado**.
   - En **Terminator / Sufijo**, selecciona **`Enter` (`\n`)**.
2. Abre la URL de tu proyecto desplegado en **Vercel** desde Google Chrome en el iMin Lark 1.
3. Toca el menú de Chrome ($\vdots$) y selecciona **"Instalar aplicación"** (o *"Agregar a la pantalla principal"*). Quedará instalada como una App dedicada a pantalla completa.
