---
name: telegram-supabase-dashboard
description: Arquitectura multi-agente para conectar un bot de Telegram con Supabase (PostgreSQL + Storage) y un dashboard Next.js con soporte para texto, imágenes y tiempo real en vivo.
---

# Telegram → Supabase → Dashboard

Skill de coordinación multi-agente. Define contratos, interfaces, órdenes de ejecución y adaptaciones por contexto para que especialistas en Bot, Base de Datos, Dashboard y DevOps colaboren sin conflictos.

---

## 1. Architecture Overview

```
                    ┌─────────────────────────────────────────┐
                    │           SKILL.md (Coordinador)         │
                    │  Define contratos, interfaces, contexto  │
                    └──────────────┬──────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Bot Specialist   │  │  DB Specialist       │  │ Dashboard Specialist │
│ (Telegram +      │  │  (Supabase: schema,  │  │ (Next.js +           │
│  state machine   │◄─┤  storage, RLS,       │◄─┤  Realtime + auth)    │
│  + file upload)  │  │  Realtime, Auth)     │  │                      │
└─────────────────┘  └──────────────────────┘  └──────────────────────┘
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │   DevOps Specialist       │
                    │  (Render, Vercel, env     │
                    │   vars, CI/CD, secrets)   │
                    └──────────────────────────┘
```

### Flujo de datos de extremo a extremo

```
Usuario ──▶ Telegram Bot ──▶ Supabase (PostgreSQL + Storage) ──▶ Dashboard (Next.js)
             (Telegraf)              ↕ Realtime                       (cliente web)
               │                     │
               │                     ├── mensajes_wsp (datos)
               │                     └── bucket media (imágenes)
               │
               └── Estado de conversación por usuario (sesión en memoria)
```

---

## 2. Agent Roles & Responsibilities

### Bot Specialist

| Responsabilidad | Detalle |
|----------------|---------|
| **Conexión Telegram** | Telegraf, token de BotFather, polling o webhooks |
| **Menú interactivo** | Texto plano o inline keyboards |
| **Máquina de estados** | Sesiones por usuario (IDLE, AWAITING_X, etc.) |
| **Recepción de archivos** | Fotos → descargar → subir a Storage |
| **Inserción en DB** | Llamar a Supabase con anon key o service_role |
| **Comandos base** | `/start`, `/cancelar`, `/menu` |

**Archivos que genera:** `telegram-bot/bot.js`, `telegram-bot/.env`, `telegram-bot/package.json`

### DB Specialist

| Responsabilidad | Detalle |
|----------------|---------|
| **Esquema PostgreSQL** | Tabla principal + columnas según el dominio |
| **Realtime** | Habilitar publicación para cambios en vivo |
| **Storage** | Bucket público + políticas de acceso |
| **RLS / Seguridad** | Políticas por rol (anon, authenticated, service_role) |
| **Auth (opcional)** | Supabase Auth, tablas de usuarios |
| **Migraciones** | Versionar cambios SQL |

**Archivos que genera:** `schema.sql`, migraciones, políticas RLS

### Dashboard Specialist

| Responsabilidad | Detalle |
|----------------|---------|
| **Página principal** | Next.js App Router, cliente de Supabase |
| **Carga inicial** | SELECT ordenado por fecha descendente |
| **Realtime** | Suscripción `postgres_changes INSERT` |
| **Render de datos** | Cards, tabla o según diseño del proyecto |
| **Imágenes** | Mostrar preview + modal lightbox |
| **Filtros** | Por fuente, fecha, texto (buscador) |
| **Auth (opcional)** | Supabase Auth en el frontend |

**Archivos que genera:** `dashboard/components/Dashboard.js`, `dashboard/app/page.js`, `dashboard/.env.local`

### DevOps Specialist

| Responsabilidad | Detalle |
|----------------|---------|
| **Bot 24/7** | Render, Railway o Fly.io |
| **Dashboard** | Vercel o Netlify |
| **Variables de entorno** | SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN |
| **CI/CD** | GitHub Actions o deploy automático desde Git |
| **Secrets** | No commitear `.env`, usar secrets del proveedor |

**Archivos que genera:** `render.yaml`, `vercel.json`, `Dockerfile` (opcional), README de deploy

---

## 3. Contract Interfaces

Contratos explícitos entre componentes. Cada especialista respeta estos formatos para que el sistema funcione sin fricciones.

### 3.1 Bot → DB (INSERT)

```json
{
  "method": "POST",
  "table": "registros",
  "auth": "apiKey (service_role o anon)",
  "payload": {
    "remitente": "telegram:123456789",
    "contenido": "Texto del mensaje o null si solo foto",
    "imagen_url": "https://xxx.supabase.co/storage/v1/object/public/media/uuid.jpg o null"
  },
  "response": {
    "status": "success | error",
    "data": null
  }
}
```

### 3.2 DB → Dashboard (SELECT + Realtime)

```json
{
  "subscription": "postgres_changes INSERT on registros",
  "auth": "apiKey (anon key - desde el navegador)",
  "fetch_initial": {
    "method": "GET",
    "table": "registros",
    "query": "SELECT * FROM registros ORDER BY fecha DESC LIMIT 100",
    "order": "fecha DESC"
  },
  "realtime_payload": {
    "event": "INSERT",
    "new": {
      "id": "uuid",
      "remitente": "telegram:123456789",
      "contenido": "string or null",
      "imagen_url": "string or null",
      "fecha": "ISO timestamp"
    }
  }
}
```

### 3.3 Bot → Telegram API

```json
{
  "send_message": {
    "method": "sendMessage",
    "params": { "chat_id": "number", "text": "string", "parse_mode": "Markdown" }
  },
  "send_photo": {
    "method": "sendPhoto",
    "params": { "chat_id": "number", "photo": "url", "caption": "string" }
  },
  "receive_message": {
    "event": "text | photo | document",
    "from": { "id": "number" },
    "text": "string | null",
    "caption": "string | null",
    "photo": "array of photo sizes | null"
  }
}
```

### 3.4 Contrato de estado (Bot)

```javascript
// Cada sesión de usuario sigue esta estructura:
ctx.session = {
  estado: 'IDLE' | 'AWAITING_X' | 'AWAITING_Y',
  datos: {
    campo1: 'valor',
    campo2: 'valor'
  }
}
```

---

## 4. Context Adaptation Matrix

El skill se adapta según dónde y cómo se ejecute. Cada especialista consulta esta tabla para saber qué variantes aplicar.

| Contexto | Bot | DB | Dashboard | DevOps |
|----------|-----|-----|-----------|--------|
| **Local desarrollo** | Polling, terminal abierta, QR/polling | Supabase cloud (misma URL) | `next dev`, hot reload | No aplica |
| **Producción 24/7** | Webhooks o polling continuo, sin terminal | Supabase cloud con RLS + Auth | Build estático, Vercel | Render + Vercel + DNS |
| **Sin Supabase (SQLite)** | Cambiar a `better-sqlite3` | Migrar tablas manual | Sin Realtime, polling cada N seg | Servidor único |
| **Sin imágenes** | Eliminar evento `photo`, quitar Storage | Columna `imagen_url` opcional | No mostrar imágenes | Menos Storage |
| **Sin dashboard** | Bot responde directamente en Telegram | BD normal (solo consultas desde bot) | No existe | Solo deploy del bot |
| **Multi-usuario con auth** | Identificar por `ctx.from.id` | Agregar políticas RLS por usuario | Login con Supabase Auth | Secrets + JWT |
| **Sesiones persistentes** | Usar Supabase para guardar sesiones | Tabla `sesiones` extra | No cambia | No cambia |

---

## 5. Execution Order

Orden estricto que deben seguir los especialistas para evitar dependencias rotas.

```
PASO 1: DB Specialist
  ├── Crear esquema SQL (tabla + columnas)
  ├── Habilitar Realtime
  ├── Crear bucket Storage + políticas
  └── (Opcional) Configurar Auth + RLS
  └── Entregable: schema.sql, credenciales listas

     │
     ▼
PASO 2: Bot Specialist
  ├── npm init + instalar telegraf, @supabase/supabase-js, dotenv
  ├── Escribir bot.js (eventos text + photo + comandos)
  ├── Configurar máquina de estados según el dominio
  ├── .env con las credenciales del PASO 1
  └── Verificar: node bot.js, probar con Telegram

     │
     ▼
PASO 3: Dashboard Specialist
  ├── npx create-next-app (o proyecto existente)
  ├── npm install @supabase/supabase-js
  ├── Escribir componente Dashboard.js
  ├── .env.local con las credenciales del PASO 1
  └── Verificar: npm run dev, ver datos en vivo

     │
     ▼
PASO 4: DevOps Specialist
  ├── Subir código a GitHub
  ├── Crear Web Service en Render (bot) con env vars
  ├── Importar dashboard en Vercel con env vars
  ├── Verificar bot 24/7
  └── Verificar dashboard público
```

### Reglas de dependencia

| Especialista | Depende de | Entregable que necesita |
|-------------|-----------|------------------------|
| Bot | DB Specialist | `SUPABASE_URL`, `SUPABASE_KEY` |
| Dashboard | DB Specialist | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| DevOps | Bot + Dashboard | Código en GitHub, lista de env vars |

---

## 6. Dependency Graph

```
                    ┌──────────────┐
                    │  DB Schema   │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌────────────┐
        │ Realtime │ │ Storage  │ │  Auth/RLS  │
        └────┬─────┘ └────┬─────┘ └─────┬──────┘
             │            │             │
             ▼            ▼             │
        ┌─────────────────────┐         │
        │   Bot (Telegraf)    │         │
        │   - INSERT en DB    │         │
        │   - upload Storage  │         │
        └──────────┬──────────┘         │
                   │                    │
                   ▼                    ▼
        ┌──────────────────────────────────┐
        │   Dashboard (Next.js)            │
        │   - SELECT inicial               │
        │   - Realtime subscription        │
        │   - Display images from Storage  │
        │   - (Opcional) Auth login        │
        └──────────────────────────────────┘
```

---

## 7. Error Handling per Role

### Bot Specialist

| Error | Causa | Solución |
|-------|-------|----------|
| `TelegramError: 404 Not Found` | Token inválido | Revisar `.env`, regenerar con BotFather |
| `Supabase: relation "registros" does not exist` | Tabla no creada | Ejecutar schema.sql primero |
| `Supabase: insert error` | Columna faltante o tipo incorrecto | Revisar schema vs payload |
| Bot no responde | Polling detenido | Revisar que `bot.launch()` se ejecute sin error |

### DB Specialist

| Error | Causa | Solución |
|-------|-------|----------|
| `Policy "Public read" already exists` | Política duplicada | Usar `CREATE IF NOT EXISTS` |
| Storage upload `403` | RLS en storage.objects | Agregar políticas de inserción |
| Realtime no funciona | Tabla no publicada | `ALTER PUBLICATION supabase_realtime ADD TABLE registros` |

### Dashboard Specialist

| Error | Causa | Solución |
|-------|-------|----------|
| `Invalid supabaseUrl` | URL placeholder en .env.local | Reemplazar con URL real |
| Dashboard vacío | No hay datos en DB | Enviar mensaje de prueba desde Telegram |
| Imagen no carga | URL rota o bucket privado | Verificar política pública en Storage |
| Realtime no actualiza | Canal mal configurado | Verificar `table: 'registros'` coincide exactamente |

### DevOps Specialist

| Error | Causa | Solución |
|-------|-------|----------|
| Build fails en Render | Dependencias incorrectas | Verificar `npm install` funciona localmente |
| Dashboard 404 en Vercel | Ruta de deploy incorrecta | Asegurar que el directorio raíz apunte a `dashboard/` |
| Bot no se conecta | Variable de entorno faltante | Revisar secrets en Render |

---

## 8. Testing per Layer

### Bot (local)

```bash
cd telegram-bot
npm start
# En Telegram, enviar: texto, foto, comandos /start /cancelar
# Verificar logs en terminal (INSERT correctos)
```

### DB (SQL directo)

```sql
-- Verificar tabla
SELECT * FROM registros ORDER BY fecha DESC LIMIT 5;

-- Verificar Storage
SELECT * FROM storage.objects WHERE bucket_id = 'media';

-- Verificar Realtime
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

### Dashboard (navegador)

```bash
cd dashboard
npm run dev
# Abrir http://localhost:3000
# Verificar que aparecen mensajes al enviarlos desde Telegram
# Verificar que las imágenes cargan
# Verificar que nuevos mensajes aparecen sin recargar
```

### Integración (end to end)

```
1. Asegurar que el bot esté corriendo
2. En Telegram: escribir al bot, elegir opción 1, completar flujo
3. En Dashboard: confirmar que la card apareció al instante
4. En Telegram: enviar foto
5. En Dashboard: confirmar que la imagen se muestra y es clickeable
```

---

## 9. Environment Variables

### Bot (`telegram-bot/.env`)

```
# Supabase
SUPABASE_URL=https://{project_ref}.supabase.co
SUPABASE_KEY={service_role_key}  # o anon key si RLS está deshabilitado

# Telegram
TELEGRAM_BOT_TOKEN={token_de_botfather}
```

### Dashboard (`dashboard/.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=https://{project_ref}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY={supabase_anon_key}
```

---

## 10. Code Templates

### 10.1 Bot — Template mínimo

```javascript
const { Telegraf, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.use(session());
bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = { estado: 'IDLE', datos: {} };
    return next();
});

async function guardar(remitente, contenido, imagen_url = null) {
    return !(await supabase.from('registros').insert([
        { remitente: `telegram:${remitente}`, contenido, imagen_url }
    ])).error;
}

bot.start((ctx) => ctx.reply('Bot activo.'));
bot.on('text', async (ctx) => {
    // Máquina de estados aquí
    await guardar(ctx.from.id.toString(), ctx.message.text);
});
bot.on('photo', async (ctx) => {
    const f = ctx.message.photo.at(-1);
    const link = await ctx.telegram.getFileLink(f.file_id);
    const buf = Buffer.from(await (await fetch(link.href)).arrayBuffer());
    const name = `${crypto.randomUUID()}.jpg`;
    await supabase.storage.from('media').upload(name, buf, { contentType: 'image/jpeg' });
    const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(name);
    await guardar(ctx.from.id.toString(), ctx.message.caption || '📷 Foto', publicUrl);
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
```

### 10.2 Dashboard — Template mínimo

```javascript
'use client';
import { useState, useEffect, useRef } from 'react';

export default function Dashboard({ tabla = 'registros' }) {
    const [data, setData] = useState([]);
    const ch = useRef(null);

    useEffect(() => {
        (async () => {
            const { createClient } = await import('@supabase/supabase-js');
            const sb = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            );
            const { data: rows } = await sb.from(tabla).select('*').order('fecha', { ascending: false });
            if (rows) setData(rows);

            const c = sb.channel('live')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: tabla },
                    (p) => setData(prev => [p.new, ...prev]))
                .subscribe();
            ch.current = c;
        })();
        return () => ch.current?.unsubscribe();
    }, [tabla]);

    return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

---

## 11. Skill Evolution Guide

Este skill está diseñado para evolucionar. Cómo adaptarlo a nuevos contextos:

| Necesidad | Qué agregar al skill |
|-----------|---------------------|
| Nuevo tipo de archivo (video, PDF) | Nuevo evento en Bot (`document`, `video`) + actualizar subida a Storage |
| Nuevo dashboard framework (Vue, Svelte) | Nuevo template en sección 10 + contrato DB→Frontend |
| Nuevo proveedor cloud (AWS, GCP) | Nueva fila en Context Adaptation Matrix + DevOps section |
| Nuevo método de auth | Nueva subsección en DB Specialist + template de login en Dashboard |
| Webhooks en vez de polling | Nueva variante en Context Adaptation Matrix + cambios en Bot |

---

## 12. Dependencies

```bash
# Bot
npm install telegraf @supabase/supabase-js dotenv

# Dashboard
npm install @supabase/supabase-js
```
