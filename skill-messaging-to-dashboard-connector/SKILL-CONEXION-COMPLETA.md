---
name: conexion-completa-bot-dashboard-db
description: Skill completa para conectar Telegram Bot + Supabase DB + Dashboard Web con despliegue en Render y Netlify. Reutilizable para cualquier proyecto. Pregunta al usuario qué necesita y arma todo.
---

# 🔗 Conexión Completa: Telegram Bot + Supabase + Dashboard

Skill para construir y desplegar un sistema completo de **bot de Telegram → base de datos → dashboard web**, 100% en la nube, sin servidores locales, con horarios programables y modo emergencia.

---

## 📋 ¿Qué preguntar al usuario?

Antes de empezar, la skill debe preguntar esto:

| # | Pregunta | Para qué sirve | Ejemplo |
|---|----------|----------------|---------|
| 1 | **Nombre del bot** | Crear el bot en BotFather | `SneakerBot`, `VentasBot` |
| 2 | **¿Qué va a hacer el bot?** | Definir la máquina de estados y el menú | "Registrar ventas de sneakers", "Encuestas", "Pedidos" |
| 3 | **¿Maneja imágenes?** | Configurar Storage de Supabase | Sí / No |
| 4 | **¿Qué columnas necesita la DB?** | Crear la tabla SQL | `modelo, talla, precio` o `mensaje, autor` |
| 5 | **¿Dashboard necesita auth?** | Si requiere login o es público | "Público" o "Solo usuarios registrados" |
| 6 | **¿Horario de actividad?** | Configurar el horario programable del bot | "8 AM a 12 AM" |
| 7 | **Zona horaria** | Para el horario programable | `America/Lima`, `America/Argentina/Buenos_Aires` |
| 8 | **¿Presupuesto?** | Free (keepalive) vs Starter ($7/mo) | "Free con cold start" o "Pago sin demoras" |
| 9 | **¿GitHub user?** | Para crear los repos | `kimboneri` |
| 10 | **Render API Key?** | Para desplegar el bot | `rnd_...` |
| 11 | **Netlify PAT?** | Para desplegar el dashboard | `nfp_...` |

---

## 🏗️ Arquitectura Final

```
                    ┌──────────────────────────────────────────────┐
                    │           SKILL (Coordinador)                 │
                    │  Pregunta → Configura → Despliega            │
                    └──────┬───────────────────────┬───────────────┘
                           │                       │
         ┌─────────────────┼─────────────────┐     │
         ▼                 ▼                  ▼     ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────────┐
│  Render (Bot)   │ │  Supabase    │ │  Netlify (Dashboard) │
│  Node.js        │ │  PostgreSQL  │ │  Next.js estático    │
│  Telegraf       │ │  + Storage   │ │  + Realtime          │
│  Webhook        │ │  + Realtime  │ │  Sin servidor        │
│  Keepalive      │ │  + RLS       │ │  Siempre activo      │
│  Horario        │ │              │ │                      │
└────────┬────────┘ └──────┬───────┘ └──────────┬───────────┘
         │                 │                    │
         └─────────────────┼────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   GitHub    │
                    │  (Código)   │
                    └─────────────┘
```

### Flujo de datos

```
Usuario ──▶ Telegram ──▶ Render (Bot) ── INSERT ──▶ Supabase ── Realtime ──▶ Netlify (Dashboard)
                ▲                                                      │
                └────────────────── Webhook ───────────────────────────┘
```

---

## 🚀 Paso a Paso: De 0 a Producción

### FASE 1: Base de Datos (Supabase)

** Qué crea: ** Tabla SQL + Storage + RLS policies + Realtime

```sql
CREATE TABLE registros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remitente TEXT NOT NULL,
    contenido TEXT,
    imagen_url TEXT,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

ALTER PUBLICATION supabase_realtime ADD TABLE registros;

CREATE POLICY "anon_insert" ON public.registros
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select" ON public.registros
  FOR SELECT TO anon USING (true);
```

** Variables que se obtienen (guardar para después): **

| Variable | Valor | Quién la usa |
|----------|-------|-------------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | Bot + Dashboard |
| `SUPABASE_KEY` | `eyJ...` (anon) | Bot |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (anon) | Dashboard |

---

### FASE 2: Bot de Telegram (Node.js + Render)

**Archivos necesarios:**

```
telegram-bot/
├── bot.js             # Código completo
├── package.json       # Dependencias
├── render.yaml        # Config Render
└── .gitignore         # node_modules, .env
```

#### package.json

```json
{
  "name": "telegram-bot",
  "version": "1.0.0",
  "main": "bot.js",
  "scripts": { "start": "node bot.js" },
  "type": "commonjs",
  "dependencies": {
    "@supabase/supabase-js": "^2.105.4",
    "dotenv": "^17.4.2",
    "telegraf": "^4.16.3"
  }
}
```

#### .gitignore

```
node_modules/
.env
npm-debug.log*
```

#### bot.js

El código completo con todas las features:

```javascript
const { Telegraf, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const http = require('http');
require('dotenv').config();

// ============================================================
// CONFIG DEL USUARIO (editar antes de deploy)
// ============================================================
const CONFIG = {
  ACTIVO_DESDE: 8,                // Hora de activación (formato 24h)
  ACTIVO_HASTA: 24,               // Hora de desactivación (24 = medianoche)
  ZONA_HORARIA: 'America/Lima',   // Tu zona horaria
  DURACION_EMERGENCIA: 120,       // Minutos que dura el modo /24h
};

const TABLA_DB = 'registros';     // Nombre de la tabla en Supabase
const BUCKET_STORAGE = 'media';   // Nombre del bucket en Supabase
const BOT_URL = 'https://MI-BOT.onrender.com';  // CAMBIAR
const INTERVALO_PING = 10 * 60 * 1000;          // 10 min
let modo24hHasta = null;

// ============================================================
// SUPABASE
// ============================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ============================================================
// HORARIO
// ============================================================
function horaLocal() {
  return parseInt(
    new Intl.DateTimeFormat('es-CO', {
      hour: 'numeric', hour12: false,
      timeZone: CONFIG.ZONA_HORARIA
    }).format(new Date())
  );
}

function estaEnHorario() {
  const h = horaLocal();
  if (CONFIG.ACTIVO_DESDE < CONFIG.ACTIVO_HASTA)
    return h >= CONFIG.ACTIVO_DESDE && h < CONFIG.ACTIVO_HASTA;
  return h >= CONFIG.ACTIVO_DESDE || h < CONFIG.ACTIVO_HASTA;
}

function enModoEmergencia() {
  return modo24hHasta !== null && Date.now() < modo24hHasta;
}

// ============================================================
// BOT
// ============================================================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = { estado: 'IDLE', datos: {} };
  return next();
});

// Middleware de horario (permite /24h incluso dormido)
bot.use((ctx, next) => {
  if (enModoEmergencia() || estaEnHorario()) return next();
  const texto = ctx.message?.text || '';
  if (texto === '/24h' || texto === '/cancelar24h') return next();
  return ctx.reply(
    `😴 *Bot fuera de horario*\n\nActualmente estoy descansando 🛌\nVolveré a atenderte a las *${CONFIG.ACTIVO_DESDE}:00*.\n\n⏰ *Horario:* ${CONFIG.ACTIVO_DESDE}:00 a ${CONFIG.ACTIVO_HASTA === 24 ? '12:00 AM' : CONFIG.ACTIVO_HASTA + ':00'} (${CONFIG.ZONA_HORARIA})`,
    { parse_mode: 'Markdown' }
  );
});

// Comandos
bot.start((ctx) => {
  ctx.session.estado = 'IDLE';
  ctx.session.datos = {};
  ctx.reply('👋 ¡Bienvenido!\n\n' + MENU, { parse_mode: 'Markdown' });
});

bot.command('menu', (ctx) => {
  ctx.session.estado = 'IDLE';
  ctx.session.datos = {};
  ctx.reply(MENU, { parse_mode: 'Markdown' });
});

bot.command('cancelar', (ctx) => {
  ctx.session.estado = 'IDLE';
  ctx.session.datos = {};
  ctx.reply('❌ Operación cancelada.\n\n' + MENU, { parse_mode: 'Markdown' });
});

// Modo emergencia (comando oculto /24h)
bot.command('24h', (ctx) => {
  if (enModoEmergencia()) {
    return ctx.reply(`⚡ Ya activo. Quedan ${Math.round((modo24hHasta - Date.now()) / 60000)}min`);
  }
  modo24hHasta = Date.now() + CONFIG.DURACION_EMERGENCIA * 60000;
  ctx.reply(`🚨 Modo emergencia activado por ${CONFIG.DURACION_EMERGENCIA} min`);
});

bot.command('cancelar24h', (ctx) => {
  modo24hHasta = null;
  ctx.reply('✅ Modo emergencia desactivado');
});

// Manejar mensajes de texto
bot.on('text', async (ctx) => {
  const uid = ctx.from.id.toString();
  const txt = ctx.message.text.trim();
  try {
    switch (ctx.session.estado) {
      case 'IDLE':
        if (txt === '1') { /* iniciar flujo */ }
        else {
          await guardarEnDB(uid, txt);
          ctx.reply('✅ Guardado.\n\n' + MENU, { parse_mode: 'Markdown' });
        }
        break;
      // ... más estados según el proyecto ...
      default:
        ctx.session.estado = 'IDLE';
        ctx.reply(MENU, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    console.error(e);
    ctx.reply('❌ Error');
  }
});

// Manejar fotos
bot.on('photo', async (ctx) => {
  const uid = ctx.from.id.toString();
  try {
    const foto = ctx.message.photo.at(-1);
    const link = await ctx.telegram.getFileLink(foto.file_id);
    const buf = Buffer.from(await (await fetch(link.href)).arrayBuffer());
    const ext = link.href.endsWith('.png') ? 'png' : 'jpg';
    const name = `${crypto.randomUUID()}.${ext}`;
    await supabase.storage.from(BUCKET_STORAGE).upload(name, buf, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg'
    });
    const { data: { publicUrl } } = supabase.storage.from(BUCKET_STORAGE).getPublicUrl(name);
    const caption = ctx.message.caption || '📷 Foto';
    await guardarEnDB(uid, caption, publicUrl);
    await ctx.replyWithPhoto(publicUrl, { caption: '✅ Foto guardada.\n\n' + MENU });
  } catch (e) {
    console.error(e);
    ctx.reply('❌ Error al procesar la foto');
  }
});

bot.catch((err, ctx) => console.error('[Global]', err));

// ============================================================
// SERVIDOR HTTP + WEBHOOK + KEEPALIVE
// ============================================================
const PORT = process.env.PORT || 10000;
const WEBHOOK_PATH = '/telegraf';
const WEBHOOK_URL = `${BOT_URL}${WEBHOOK_PATH}`;

const webhookHandler = bot.webhookCallback(WEBHOOK_PATH);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { req.body = JSON.parse(body); webhookHandler(req, res); });
  } else {
    res.writeHead(200); res.end('OK');
  }
}).listen(PORT, async () => {
  console.log(`Servidor en puerto ${PORT}`);
  await bot.telegram.setWebhook(WEBHOOK_URL);
  console.log(`Webhook: ${WEBHOOK_URL}`);
  setInterval(async () => {
    if (enModoEmergencia() || estaEnHorario()) {
      await fetch(BOT_URL).catch(() => {});
    }
  }, INTERVALO_PING);
  console.log(`Keepalive activo (${CONFIG.ACTIVO_DESDE}:00-${CONFIG.ACTIVO_HASTA === 24 ? '24:00' : CONFIG.ACTIVO_HASTA + ':00'})`);
});

// Funciones auxiliares
async function guardarEnDB(remitente, contenido, imagenUrl = null) {
  const payload = { remitente: `telegram:${remitente}`, contenido };
  if (imagenUrl) payload.imagen_url = imagenUrl;
  return !(await supabase.from(TABLA_DB).insert([payload])).error;
}
```

#### render.yaml (despliegue automático)

```yaml
services:
  - type: web
    name: mi-bot-telegram
    runtime: node
    repo: https://github.com/TU_USUARIO/TU_REPO
    plan: free
    branch: main
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_KEY
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
```

---

### FASE 3: Dashboard Web (Next.js + Netlify)

**Archivos necesarios dentro del repo:**

```
dashboard/
├── next.config.mjs      # Con output: 'export'
├── netlify.toml          # Config de build
├── package.json          # Dependencias
├── .gitignore
├── app/
│   ├── layout.js
│   ├── page.js
│   └── globals.css
└── components/
    └── AdminDashboard.js
```

#### next.config.mjs

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};
export default nextConfig;
```

#### netlify.toml

```toml
[build]
  base = "dashboard"
  command = "npm run build"
  publish = "out"
```

#### components/AdminDashboard.js

```javascript
'use client';
import { useState, useEffect, useRef } from 'react';

export default function AdminDashboard({ tabla = 'registros' }) {
  const [data, setData] = useState([]);
  const ch = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || supabaseUrl === 'TU_SUPABASE_URL') {
        setError('Configurar NEXT_PUBLIC_SUPABASE_URL en Netlify');
        return;
      }

      const sb = createClient(supabaseUrl, supabaseKey);

      const { data: rows } = await sb.from(tabla).select('*').order('fecha', { ascending: false });
      if (rows) setData(rows);

      const c = sb.channel('realtime-dashboard')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: tabla },
          (p) => setData(prev => [p.new, ...prev])
        ).subscribe();
      ch.current = c;
    })();
    return () => ch.current?.unsubscribe();
  }, [tabla]);

  if (error) return <div style={{ color: 'red', padding: 20 }}>{error}</div>;

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Total: {data.length} registros</p>
      {data.map(r => (
        <div key={r.id} style={{ border: '1px solid #ddd', margin: 8, padding: 8, borderRadius: 8 }}>
          <strong>{r.remitente}</strong> - {new Date(r.fecha).toLocaleString()}
          <p>{r.contenido}</p>
          {r.imagen_url && <img src={r.imagen_url} alt="" style={{ maxWidth: 300 }} />}
        </div>
      ))}
    </div>
  );
}
```

---

### FASE 4: Despliegue en la Nube

#### 4.1 Subir a GitHub

```bash
cd /ruta/del/proyecto
git init
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/MI_PROYECTO.git
git push -u origin main
```

#### 4.2 Desplegar Bot en Render (vía API REST)

```powershell
$apiKey = "rnd_TU_API_KEY"

$body = @{
    type = "web_service"
    name = "mi-bot-telegram"
    ownerId = "tea-TU_WORKSPACE_ID"
    repo = "https://github.com/TU_USUARIO/MI_PROYECTO"
    branch = "main"
    serviceDetails = @{
        runtime = "node"
        plan = "free"
        region = "oregon"
        healthCheckPath = "/"
        envSpecificDetails = @{
            buildCommand = "npm install"
            startCommand = "npm start"
        }
    }
} | ConvertTo-Json -Depth 5

# Configurar env vars del bot
$envBody = @(
    @{key="SUPABASE_URL"; value="https://xxx.supabase.co"},
    @{key="SUPABASE_KEY"; value="eyJ..."},
    @{key="TELEGRAM_BOT_TOKEN"; value="123456:ABC..."}
) | ConvertTo-Json -Compress

# Crear servicio
Invoke-RestMethod -Uri "https://api.render.com/v1/services" `
  -Headers @{ "Authorization" = "Bearer $apiKey" } `
  -Method Post -ContentType "application/json" -Body $body

# Configurar env vars
Invoke-RestMethod -Uri "https://api.render.com/v1/services/SERVICE_ID/env-vars" `
  -Headers @{ "Authorization" = "Bearer $apiKey" } `
  -Method Put -ContentType "application/json" -Body $envBody
```

#### 4.3 Desplegar Dashboard en Netlify

```bash
# Construir el dashboard
cd dashboard
npm run build

# Desplegar
npx netlify-cli deploy --prod --dir=out --site SITE_ID

# Configurar env vars
npx netlify-cli env:set NEXT_PUBLIC_SUPABASE_URL "https://xxx.supabase.co"
npx netlify-cli env:set NEXT_PUBLIC_SUPABASE_ANON_KEY "eyJ..."
```

---

## ⚙️ Features del Sistema

### Horario Programable

El bot solo funciona en el horario configurado. Fuera de ese horario responde:

> 😴 *Bot fuera de horario*  
> Volveré a atenderte a las *8:00*.  
> ⏰ *Horario:* 8:00 a 12:00 AM

**Para cambiar:** editá `CONFIG.ACTIVO_DESDE` y `CONFIG.ACTIVO_HASTA` en `bot.js`.

### Modo Emergencia (/24h)

Comando **oculto** (solo vos sabés que existe) para activar el bot fuera de horario.

- `/24h` → activa por 120 minutos (configurable)
- `/cancelar24h` → desactiva antes
- El auto-ping también se activa durante emergencia

**Para cambiar duración:** editá `CONFIG.DURACION_EMERGENCIA` en `bot.js`.

### Auto-Ping (Keepalive)

El bot se pinguea a sí mismo cada 10 minutos durante el horario activo para evitar que Render duerma el contenedor. Sin esto, después de 15 min de inactividad el bot se duerme y tarda ~30-60s en responder (cold start).

### Consumo del Plan Free de Render

| Escenario | Horas/mes | ¿Entra en las 750 free? |
|-----------|-----------|------------------------|
| 24/7 sin pausa | 744 | ✅ Sí, justo |
| 16h/día con horario | ~496 | ✅ Sobran 254 |
| Con horario + emergencias | ~520 | ✅ Sobran 230 |

---

## 🧰 Variables de Entorno (Resumen)

### Para el Bot (Render Dashboard → Environment)

| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_KEY` | `eyJ...` (anon key) |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC...` (de BotFather) |

### Para el Dashboard (Netlify → Site settings → Environment variables)

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (anon key) |

---

## 🔧 Solución de Problemas Comunes

### "Error al guardar en BD"

→ RLS policies faltantes en Supabase. Ejecutar:

```sql
CREATE POLICY "anon_insert" ON public.registros
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select" ON public.registros
  FOR SELECT TO anon USING (true);
```

### "Bot fuera de horario" a destiempo

→ `CONFIG.ZONA_HORARIA` incorrecta. Render usa UTC, sin la zona correcta el horario se desfasa.

### /24h no funciona

→ El middleware de horario bloquea todo. Debe permitir `/24h` explícitamente:

```javascript
const texto = ctx.message?.text || '';
if (texto === '/24h' || texto === '/cancelar24h') return next();
```

### Dashboard vacío en Netlify

→ Las `NEXT_PUBLIC_*` variables no están configuradas en Netlify o están con valores placeholder.

### El bot no responde después del deploy

```bash
# Verificar webhook
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Respuesta esperada:
# {"ok":true,"result":{"url":"https://MI-BOT.onrender.com/telegraf",...}}
```

---

## 📊 Estimación de Costos (Todo Free)

| Servicio | Costo | Limitaciones |
|----------|-------|-------------|
| **Supabase** | Gratis | 500 MB DB, 1 GB Storage, 50k usuarios |
| **Render** | Gratis | 750 h/mes, cold start si se duerme |
| **Netlify** | Gratis | 100 GB ancho de banda, 300 min build |
| **GitHub** | Gratis | Repos públicos ilimitados |
| **Total** | **$0/mes** | Con keepalive y horario programado |

---

## 🔄 Cómo hacer cambios después del deploy

### Cambiar el bot

1. Editás `bot.js` localmente
2. `git add . && git commit -m "cambio" && git push`
3. Render redeployea automáticamente (~2 min)

### Cambiar el dashboard

**Opción A (automático):** push a GitHub → Netlify detecta y redeployea
**Opción B (manual):**
```bash
cd dashboard
npm run build
npx netlify-cli deploy --prod --dir=out
```

### Ver logs del bot

Render Dashboard → seleccionar servicio → Logs

### Ver logs del dashboard

Netlify Dashboard → seleccionar sitio → Deploys → ver build log

---

## 📝 Checklist para proyecto nuevo

- [ ] Crear bot en BotFather, guardar token
- [ ] Crear proyecto Supabase, guardar URL + keys
- [ ] Ejecutar schema.sql en Supabase SQL Editor
- [ ] Crear bucket Storage público en Supabase
- [ ] Habilitar Realtime en Supabase
- [ ] Crear repo en GitHub
- [ ] Crear `telegram-bot/` con bot.js, package.json, render.yaml, .gitignore
- [ ] Crear `dashboard/` con next.config.mjs, netlify.toml, AdminDashboard.js
- [ ] Push a GitHub
- [ ] Crear Web Service en Render (bot)
- [ ] Configurar env vars en Render
- [ ] Subir dashboard a Netlify (deploy directo o desde GitHub)
- [ ] Configurar env vars en Netlify
- [ ] Verificar bot responde en Telegram
- [ ] Verificar dashboard muestra datos en vivo
- [ ] Ajustar horario en CONFIG si es necesario

---

## Ejemplo: Lo que preguntaría la skill al iniciar

```
🤖 Skill: Conexión Bot + Dashboard

Voy a guiarte paso a paso. Primero necesito algunos datos:

1. ¿Nombre del proyecto? (ej: "Sneakers", "Pedidos", "Encuestas")
   ⇒ Sneakers

2. ¿Qué va a hacer el bot?
   a) Registrar ventas/productos
   b) Tomar pedidos
   c) Encuestas/feedback
   d) Otro (especificar)
   ⇒ a) Registrar ventas

3. ¿Maneja imágenes? (ej: fotos de productos)
   ⇒ Sí

4. ¿Qué datos va a guardar? (separados por coma)
   ⇒ modelo, talla, precio

5. ¿Horario de actividad? (formato 24h, ej: 8 a 24)
   ⇒ 8 a 24

6. ¿Zona horaria? (ej: America/Lima, America/Mexico_City)
   ⇒ America/Lima

7. ¿Presupuesto?
   a) Free (con keepalive, ~30s cold start ocasional)
   b) Starter $7/mes (sin cold starts)
   ⇒ a) Free

8. ¿GitHub username?
   ⇒ kimboneri

9. ¿Render API Key? (rnd_...)
   ⇒ rnd_xxxxxxxxx

10. ¿Netlify PAT? (nfp_...)
    ⇒ nfp_xxxxxxxxx

¡Perfecto! En 10 minutos tenés todo funcionando.
```

---

*Skill generada a partir del despliegue real del proyecto ANALIZADOR_DE_MERCADO.*
