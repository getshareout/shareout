# Checklist QA de landing pages

Checklist obligatorio antes de publicar cualquier landing page que haga Acme, sea en el dominio del cliente o en el nuestro. El QA lo hace alguien que no desarrolló la página. Completalo en la plantilla de Notion "QA landing" y adjuntá capturas de cada punto.

## Dispositivos y navegadores

| Dispositivo | Navegador | Ancho de prueba |
|---|---|---|
| Celular iOS (versión 17 o superior) | Navegador nativo y Chrome | 390 px |
| Celular Android de gama media | Chrome | 360 px |
| Tablet | Navegador nativo | 768 px |
| Desktop | Chrome y un segundo navegador | 1440 px |

Probá también con el celular en horizontal y con el zoom del navegador al 200%.

## Performance

- LCP (Largest Contentful Paint) menor a 2,5 segundos en mobile, con conexión 4G simulada.
- CLS menor a 0,1 e INP menor a 200 ms.
- Puntaje de PageSpeed Insights en mobile de 85 o más.
- Peso total de la página menor a 2 MB; imágenes en WebP o AVIF, con un ancho máximo de 1600 px.
- Ningún script de terceros que no esté aprobado en el brief.

## Formularios

- Probá cada campo: obligatorios, formato de mail y de teléfono, y mensajes de error claros en español.
- Enviá al menos 3 leads de prueba con el nombre "TEST QA" y verificá que lleguen a HubSpot (o al CRM del cliente) en menos de 5 minutos.
- Comprobá la página de gracias y el mail automático de confirmación.
- Revisá que haya protección antispam que no bloquee a usuarios reales en mobile.
- Borrá los leads de prueba del CRM al terminar.

## Tracking

- GA4: page_view y el evento de conversión (generate_lead o purchase) con sus parámetros, verificados en DebugView.
- Píxel de Meta y etiqueta de conversión de Google Ads disparando una sola vez por envío.
- Las UTMs se conservan después de cada redirección y viajan con el formulario en campos ocultos.
- El banner de cookies bloquea las etiquetas de marketing hasta que la persona acepta.

## Textos legales

- Link a la política de privacidad del cliente en el pie y junto al formulario, con la casilla de consentimiento destildada por defecto.
- Bases y condiciones visibles cuando hay promociones, sorteos o descuentos.
- En tiendas online de Argentina, el "Botón de arrepentimiento" visible en la home (Resolución 424/2020).
- Precios con impuestos incluidos y vigencia de la promoción con fechas exactas.
- Los textos legales los aprueba el área legal del cliente: Acme no redacta textos legales.

## Accesibilidad

- Contraste de texto de al menos 4,5:1 (3:1 para textos grandes).
- Todas las imágenes informativas con texto alternativo; las decorativas, con alt vacío.
- Navegación completa con teclado y foco visible en botones y campos.
- Cada campo del formulario con su etiqueta visible, no solo el placeholder.
- Objetivo: nivel WCAG 2.1 AA.

## Aprobación final

1. Quien hizo el QA marca cada punto en Notion y adjunta capturas de mobile y desktop.
2. El account lead revisa y da el OK interno.
3. El cliente aprueba por mail la versión del entorno de prueba.
4. Se publica de lunes a jueves antes de las 16 h; nunca un viernes ni la víspera de un feriado.
5. A las 24 horas de publicada, se controla que las conversiones se estén registrando.
