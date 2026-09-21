---
title: Proveedor de IA
description: Dale una clave de LLM a tu instancia, o corré sin una a propósito.
---

Todas las funciones de IA de ShareOut quedan inertes hasta que la instancia tiene una
clave de proveedor. No se rompe nada — simplemente no hacen nada, y en silencio. Acá está
cómo encenderlas, y qué queda apagado si decidís que no.

## Qué queda apagado sin clave

- **Crew AI** — los agentes automáticos no pueden planificar ni correr
- **Preguntale a tu espacio** — el asistente del inicio
- **Chat dentro de la página** — el asistente para visitantes
- **IA del editor** — reescribir, acortar, traducir, corregir
- **Conocimiento** — ingesta, destilado, consolidación
- **Resúmenes automáticos** — los TL;DR de cada página

Todo lo demás — publicar, datos, tiempo real, compartir, horarios, entregas — funciona sin
clave de LLM. Una instancia sin IA es una configuración legítima, no una rota.

## Tres proveedores

La cadena admite tres y, por defecto, los prueba en este orden:

| Orden | Secreto | Qué es |
|-------|---------|--------|
| 1 | `VERCEL_AI_GATEWAY` | Una clave de Vercel AI Gateway. Útil si querés ruteo, presupuestos u observabilidad delante del modelo |
| 2 | `ANTHROPIC_API_KEY` | Una clave de Anthropic, llamada directo a la Messages API nativa |
| 3 | `OPENAI_API_KEY` | Una clave de OpenAI, llamada directo |

Poné cualquiera. Con más de una, una falla a nivel proveedor (`401`, `402`, `403`, `429`
o cualquier `5xx`) pasa al siguiente, así que un gateway sin crédito no se lleva puestos
tu asistente ni tus agentes.

Para cambiar el orden, definí `AI_PROVIDER_ORDER` como lista separada por comas, p. ej.
`anthropic,openai`. Los proveedores configurados que no listes siguen después, en el orden
por defecto.

Modelos: en el gateway, el asistente, los agentes y la generación de páginas usan el mismo
modelo — `deepseek/deepseek-v4.1-flash` por defecto (ver [Elegir un modelo](#elegir-un-modelo)
para cambiarlo sin tocar código; una elección de workspace o instancia tiene prioridad).
En Anthropic directo todo usa Claude Sonnet 5 (`claude-sonnet-5`); en OpenAI directo,
`gpt-4o`. `BUILD_MODEL` sigue siendo un fallback solo para el agente de build, por debajo
de eso. Los ids de modelo viven en `src/data/agent/models.ts`.

## Configurarlo

```bash
cd shareout-app
npx wrangler secret put ANTHROPIC_API_KEY
# o
npx wrangler secret put VERCEL_AI_GATEWAY
# o
npx wrangler secret put OPENAI_API_KEY
```

Los secretos tienen efecto inmediato — no hace falta redesplegar.

Verificá leyendo la configuración de vuelta, en vez de confiar en el comando:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN" \
  | jq '.ai'
```

`providers` debería listar lo que configuraste, en orden de respaldo. Un array vacío
significa que la IA sigue inerte.

## Claves por espacio de trabajo

Un espacio puede traer su propia clave en vez de gastar la de la instancia, que es la
forma de facturarle la IA al equipo que la usa:

```bash
curl -sS -X PUT "$ORIGIN/v1/workspaces/$WORKSPACE_ID/llm" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"provider":"openai","apiKey":"sk-..."}'
```

`provider` tiene que ser `openai` o `vercel-gateway`; las claves de Anthropic por espacio todavía no se admiten.

Esto necesita **`CREDENTIALS_KEY`**, porque la clave se guarda cifrada:

```bash
openssl rand -hex 32 | npx wrangler secret put CREDENTIALS_KEY
```

Sin eso el endpoint devuelve `CONFIG_ERROR` y el espacio sigue usando la clave de la
instancia sin avisar. `CREDENTIALS_KEY` también cifra las credenciales de conectores, así
que conviene configurarla aunque nunca uses claves de IA por espacio.

Un espacio con clave propia usa la suya; el resto cae en la cadena de la instancia.

## Elegir un modelo

El modelo de Vercel AI Gateway no está fijo en el código — elegí cualquier modelo que
el gateway ofrezca, por workspace o para toda la instancia, desde su catálogo en vivo en
vez de una lista escrita en este repo:

```bash
# Qué ofrece el gateway ahora mismo (necesita VERCEL_AI_GATEWAY configurado)
curl -sS "$ORIGIN/v1/ai/gateway-models" -H "Authorization: Bearer $SHAREOUT_TOKEN" | jq '.models'

# Fijar el modelo propio de un workspace (admin de ese workspace)
curl -sS -X PUT "$ORIGIN/v1/workspaces/$WORKSPACE_ID/llm/model" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4.1-flash"}'

# Fijar el default de toda la instancia (superadmin)
curl -sS -X PUT "$ORIGIN/v1/admin/ai-settings" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"defaultGatewayModel":"deepseek/deepseek-v4.1-flash"}'
```

Prioridad: el modelo propio de un workspace gana, después el default de la instancia,
después el fijo `deepseek/deepseek-v4.1-flash`. `DELETE .../llm/model` (o
`defaultGatewayModel: null`) borra un override y cae al siguiente. Ambos también tienen
un desplegable — Configuración → IA en un workspace, y `/admin?view=instance` →
**Modelo de IA por defecto** para la instancia. Esto solo aplica a la entrada del
proveedor `vercel-gateway`; las entradas directas de Anthropic y OpenAI mantienen su
propio modelo fijo, porque no pueden servir un id arbitrario del catálogo del gateway.

## Costo

La clave de la instancia paga cada función de IA que use cada miembro. Antes de abrir una
instancia a toda una empresa:

- `/admin?view=tokens` muestra uso y costo de tokens en el tiempo
- `/admin?view=costs` lo pone al lado del resto del gasto
- las claves por espacio mueven la cuenta al espacio que la genera

## Flags que quedan apagados por defecto

La mayoría de las superficies de IA se encienden **solas** cuando hay clave (`ai.crew`,
`ai.web_agent`, chat de visitante/editor, bot de Telegram). Dos quedan **apagadas** hasta
que un admin de instancia las active en **Admin → Features** (o por la API de features del
espacio):

| Flag | Por qué es opt-in |
|------|-------------------|
| `ai.create` | `/create` es un loop plan/preview/publish — gasta tokens fácil en una instancia abierta |
| `ai.slack_bot` | Hace falta una app de Slack, OAuth y match de email; prenderlo de entrada confunde a quien solo usa Slack como destino de entrega |

Telegram (`ai.telegram_bot`) viene prendido: se conecta con un token de bot y un link en
Settings — igual queda inerte sin clave de LLM.
