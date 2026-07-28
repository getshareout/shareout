---
title: Ops self-host
description: Upgrades, backups y health checks para un Worker ShareOut self-hosted.
---

## Administrar la instancia

`/admin` es el portal del dueño de la instancia. El acceso sale de cualquiera de:

| Fuente | Uso |
|--------|-----|
| `INSTANCE_ADMIN_EMAILS` | Emails separados por coma. **El camino self-host** — sin editar código, sin fork. |
| `SETUP_ADMIN_EMAIL` | El primer admin, para que no se quede afuera. |
| `superadmin-recipients.json` | Viene vacío. Opcional si preferís un roster commiteado (y ahí viven los overrides de chat de Telegram). |

Mientras *nada* nombre un admin, el usuario más antiguo cuenta como tal para que una
instancia nueva nunca quede bloqueada. Nombrar a alguien termina ese fallback.

### Crear un workspace para un equipo

El dueño no necesita haber entrado todavía — cae adentro en su primer login.

```bash
curl -sS -X POST "$ORIGIN/v1/admin/workspaces" \
  -H "Cookie: $ADMIN_SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"Marketing","owner_email":"ana@acme.test"}'
```

### Nombrar un admin en cualquier workspace

No hace falta ser miembro.

```bash
curl -sS -X POST "$ORIGIN/v1/admin/workspaces/$WORKSPACE_ID/members" \
  -H "Cookie: $ADMIN_SESSION" -H 'Content-Type: application/json' \
  -d '{"email":"beto@acme.test","role":"admin"}'
```

Roles: `owner`, `admin`, `member`. Ambas llamadas quedan en el audit log del
workspace con el email del admin que actuó.

### Ver para qué está configurada la instancia

`GET /v1/admin/instance` (admin de instancia) lo responde en un solo documento — y,
más útil, lista qué falta y qué deshabilita cada hueco:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Cookie: $ADMIN_SESSION" | jq .gaps
```

No devuelve secretos, solo si cada uno está presente. Un array `gaps` vacío es la
señal de que la instancia está completa.

### Proveedores de AI

La AI está **apagada hasta que pongas una key**. Todas las superficies de AI degradan
en silencio en lugar de fallar, por eso conviene mirar `gaps` y no esperar a notarlo.

| Nivel | Cómo | Alcance |
|-------|------|---------|
| Instancia | `npx wrangler secret put OPENAI_API_KEY` (o `VERCEL_AI_GATEWAY`) | Todos los workspaces, lo pagás vos |
| Workspace | `PUT /v1/workspaces/{id}/llm` `{provider, apiKey}` | Solo ese workspace, lo paga él |

Las keys por workspace se guardan cifradas y necesitan `CREDENTIALS_KEY` — el endpoint
se niega sin eso en lugar de guardar algo que no puede proteger. El mismo secret cifra
las credenciales de conectores.

## Upgrades

1. Traé el último release público (o re-sincronizá el export si espejás en privado).
2. Desde `shareout-app/`:

   ```bash
   npm ci
   npm run db:migrate:prod          # aplicar migraciones D1 nuevas
   npm run deploy                   # o deploy:with-migrations
   ```

3. Smoke: abrí `/home`, publicá con `npm run smoke:hello` si tenés un token a mano.

Siempre aplicá migraciones D1 **antes** de depender del schema nuevo en un deploy.

## Backups

| Store | Sugerencia |
|-------|------------|
| D1 | `wrangler d1 export` periódico (o backups de Cloudflare cuando existan) |
| R2 | Versionado del bucket / sync a un segundo bucket |
| Durable Objects | Export a nivel app de tablas críticas; los DOs no son un dump SQL único |

Probá un restore en un worker de staging antes de necesitarlo.

## Observabilidad

- Logs del worker: `npx wrangler tail`
- En producto: Admin → Health (si estás firmado como admin), si tu build lo tiene
- Seteá `ADMIN_ALERTS_DISABLED=1` salvo que configures alertas Telegram de ops

## Seguridad básica (checklist pre-público)

Antes de exponer una instancia a internet:

- Rotá cualquier secret que haya filtrado a un gist o chat
- Mantené `SESSION_SECRET` largo y único por instancia
- Preferí artifacts privados + auth hasta entender open visibility
- Revisá WAF / bot settings de Cloudflare en tu zona
- Reportá vulns del producto vía [SECURITY.md](https://github.com/getshareout/shareout/blob/main/SECURITY.md)

Un threat-model más profundo debería aterrizar antes de un anuncio OSS amplio —
tratá esta página como higiene de operador, no como informe de auditoría.
