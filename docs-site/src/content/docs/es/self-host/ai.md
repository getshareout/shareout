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
- **Chat dentro del artefacto** — el asistente para visitantes
- **IA del editor** — reescribir, acortar, traducir, corregir
- **Conocimiento** — ingesta, destilado, consolidación
- **Resúmenes automáticos** — los TL;DR de cada artefacto

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

Modelos: en el gateway, el asistente, los agentes y la generación de artefactos usan el mismo
modelo — `anthropic/claude-sonnet-5.5` por defecto (ver [Elegir un modelo](#elegir-un-modelo)
para cambiarlo sin tocar código; una elección de workspace o instancia tiene prioridad).
En Anthropic directo todo usa Claude Sonnet 5.5 (`claude-sonnet-5-5`); en OpenAI directo,
`gpt-4o`. `BUILD_MODEL` sigue siendo un fallback solo para el agente de build, por debajo
de eso. Leer un documento escaneado (un PDF sin capa de texto) es la excepción: usa Claude
Haiku 5.5 (`anthropic/claude-haiku-5.5` en el gateway, `claude-haiku-5-5` en Anthropic
directo) salvo que `SCAN_MODEL` nombre otro modelo; la elección de modelo del workspace no
aplica, y OpenAI directo sigue con `gpt-4o`. Los ids de modelo viven en
`src/data/agent/models.ts`.

## Agente de build (opcional)

Activá **Page build agent** en Admin → Features (por workspace, o para toda la instancia)
y los builds de artefactos con IA corren como un agente con herramientas en vez de una
sola respuesta larga. `BUILD_AGENT=on` lo fuerza en todos los workspaces; `BUILD_AGENT=off` es un
interruptor de emergencia que gana sobre el flag. Escribe el artefacto como archivos en pasos chicos,
revisa su propio trabajo (sintaxis de JavaScript, manifiesto, archivos faltantes, tablas
sin declarar, reglas de publicación de ShareOut), corrige lo que encuentra y recién ahí
publica. Con un binding `BROWSER` también prueba el artefacto publicado y corrige hasta dos
rondas de problemas; sin él, publica después de la revisión estática. Si aun así no logra
un artefacto que pase, no se anuncia nada como terminado: se le avisa al usuario y, si hay
[alertas por Telegram](#alertas) configuradas, al operador. Apagado por defecto. Funciona en todas las
rutas de arriba; en Anthropic directo usa además compactación del lado del servidor,
edición de contexto y presupuesto de tarea.

Todos los builds de artefactos con IA (con agente o sin él) razonan con `BUILD_EFFORT` (`low`,
`medium` o `high`; por defecto `medium`), usan el modelo elegido para el workspace (luego el
de la instancia, luego `BUILD_MODEL`) y reciben el color de marca, el logo, el idioma y el
archivo de contexto de estilo del workspace. El agente también puede consultar la guía de
artefactos de ShareOut mientras construye.

Cada build, con agente o de una sola respuesta, aparece en `/admin?view=health` → **Page
builds** (los últimos 25, guardados 90 días): cuándo, resultado (`published`, `previewed`,
`gave_up`, `failed`, `truncated`), workspace, camino, duración, tokens de entrada y salida,
costo, y cada paso detrás de **steps** — llamadas al modelo, herramientas, revisiones
estáticas, la prueba del artefacto y la publicación.

El mismo interruptor pasa al agente los cambios de artefactos que hace el asistente:
modifica los archivos que ya tiene un artefacto HTML en pasos chicos, revisa que el cambio
no rompa nada que el artefacto no tuviera roto antes, y le muestra el cambio al usuario para
que lo confirme antes de publicar nada. Los otros tipos de artefacto, y los workspaces donde
está apagado, siguen con el editor de una sola respuesta.

### Builds que sobreviven a la pestaña

Con el Durable Object `BUILD_JOBS` (viene en el `wrangler.toml` por defecto), un build desde
Create o un build confirmado en el asistente corre como un trabajo en el servidor y no dentro
del pedido del navegador. Cerrar la pestaña no lo frena: el artefacto se publica igual, el
resultado del asistente queda en su conversación, y si termina sin nadie mirando aparece en la
campana y en Home ("Te necesita"), en el idioma del usuario. Un cliente que pierde la conexión
se vuelve a enganchar con `GET /v1/builds/{id}/events` y recibe los pasos hechos hasta ahí.
Cada usuario corre un build a la vez (un doble clic se suma al que ya corre) y un trabajo que
sigue corriendo a los 12 minutos se frena. Sin el binding, los builds corren en línea como
antes. Agregar la clase pide un `wrangler deploy` (no `versions upload`) la primera vez.

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
después el fijo `anthropic/claude-sonnet-5.5`. `DELETE .../llm/model` (o
`defaultGatewayModel: null`) borra un override y cae al siguiente. Ambos también tienen
un desplegable — **Admin → IA y modelos** en un workspace, y `/admin?view=instance` →
**AI defaults** para la instancia. Esto solo aplica a la entrada del
proveedor `vercel-gateway`; las entradas directas de Anthropic y OpenAI mantienen su
propio modelo fijo, porque no pueden servir un id arbitrario del catálogo del gateway.

## Costo

La clave de la instancia paga cada función de IA que use cada miembro. Antes de abrir una
instancia a toda una empresa:

- `/admin?view=tokens` muestra uso y costo de tokens en el tiempo
- `/admin?view=costs` lo pone al lado del resto del gasto
- las claves por espacio mueven la cuenta al espacio que la genera

### Lo que se le cobra a un espacio: costo × recargo

Cada monto de IA que ve un espacio — su Admin → Facturación (gasto, presupuesto mensual de
IA, reporte de IA), su Resumen, los costos de crews y de Knowledge, y la línea de uso de IA
de una factura — es su **precio**: el costo medido × un recargo (markup). El almacenamiento,
las visitas, el email y el tiempo de navegador no llevan recargo. El recargo vigente es el
primero de:

1. el recargo propio del espacio;
2. el default de la instancia;
3. ninguno — al espacio se le cobra al costo (1×).

Fijá el default de la instancia en `/admin?view=instance` → **AI defaults** (*AI resale
markup*), o:

```bash
curl -sS -X PUT "$ORIGIN/v1/admin/ai-settings" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"defaultMarkup":1.5}'
```

El recargo de un espacio se fija desde su Admin → Facturación (un bloque que solo ven los
admins de la instancia) o con `PUT /v1/workspaces/$WORKSPACE_ID/ai-markup`
`{"markup": 1.5}`; `null` vuelve al default de la instancia. Los dos aceptan un
multiplicador de 1 (al costo) a 10; cualquier otro valor es `400 VALIDATION_ERROR`. Los
admins del espacio nunca ven el costo, el recargo ni el margen, y un cambio de recargo no
se escribe en el registro de auditoría del espacio, que sus admins pueden leer.

El **presupuesto mensual de IA** de un espacio (lo fijan sus propios admins en
Admin → Facturación) se mide a su precio, así el presupuesto, el reporte de IA y la línea de
uso de una factura coinciden.

### Alertas

Configurá `SUPPORT_ALERT_TELEGRAM_CHAT_ID` (el id de un chat de Telegram) y
`TELEGRAM_BOT_TOKEN` y el operador recibe un mensaje de Telegram, cada uno con un límite
para que un mal día mande uno y no cientos:

| Cuándo | Límite | Variable |
|--------|--------|----------|
| Un proveedor de la instancia rechaza llamadas por falta de crédito o un tope de gasto (la clave propia de un espacio nunca alerta) | una vez por hora por proveedor | — |
| El gasto de IA de la instancia en el día UTC pasa una línea. Los costos se calculan cada hora, así que puede atrasarse hasta una hora | una vez por día | `AI_SPEND_ALERT_USD_PER_DAY` — apagada si no se define |
| El crédito de Vercel AI Gateway baja de un piso (se revisa cada hora; también queda como error en el log del Worker) | una vez por día | `AI_CREDIT_ALERT_USD` — por defecto `20` |
| Un build de artefacto falló o el agente de build se rindió | cada vez | — |
| Se abre un ticket de soporte nuevo | cada vez | — |

Sin el id del chat y el token del bot no se manda nada; los chequeos corren igual.

## Todas las opciones de IA

| Nombre | Tipo | Por defecto | Qué hace |
|--------|------|-------------|----------|
| `VERCEL_AI_GATEWAY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | secreto | — | Los proveedores ([arriba](#tres-proveedores)) |
| `AI_PROVIDER_ORDER` | var | `vercel-gateway,anthropic,openai` | Orden de respaldo entre los proveedores configurados |
| `BUILD_AGENT` | var | sin definir (sigue el flag **Page build agent**) | `on` fuerza el [agente de build](#agente-de-build-opcional) en todos lados; `off` lo apaga en todos lados |
| `BUILD_EFFORT` | var | `medium` | Cuánto razonan los builds: `low`, `medium`, `high`. Cualquier otro valor vuelve a `medium` |
| `BUILD_MODEL` | var | sin definir | Solo builds, cuando no hay modelo elegido por el espacio ni por la instancia: un slug del gateway en el gateway, un id propio (sin `/`) en Anthropic directo |
| `SCAN_MODEL` | var | Claude Haiku 5.5 | Modelo que transcribe documentos escaneados: un slug del gateway, o un id propio en Anthropic directo |
| `AI_SPEND_ALERT_USD_PER_DAY` | var | apagada | Línea de gasto diario para la [alerta](#alertas) de Telegram |
| `AI_CREDIT_ALERT_USD` | var | `20` | Piso de crédito del gateway para la [alerta](#alertas) de Telegram |
| `CREDENTIALS_KEY` | secreto | — | Hace falta para las [claves por espacio](#claves-por-espacio-de-trabajo) |

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
