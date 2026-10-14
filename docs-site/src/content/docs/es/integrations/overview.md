---
title: Resumen de integraciones
description: Conectá servicios externos a tus artifacts.
---

Traé datos en vivo de servicios externos a tus artifacts, o mandá tus artifacts
hacia donde tu equipo ya trabaja.

## Disponibles

| Proveedor | Qué te da |
| --- | --- |
| [Google Sheets](/es/integrations/google-sheets/) | Leer datos de planillas con OAuth |
| [Google Analytics](/es/integrations/google-analytics/) | Reportes GA4 con clave de cuenta de servicio |
| [Google Ads](/es/integrations/google-ads/) | Gasto, clics y conversiones de campañas |
| [Facebook Ads](/es/integrations/facebook-ads/) | Insights de campañas de Meta |
| [Amazon S3](/es/integrations/databases-and-storage/#amazon-s3) | Listar y leer archivos CSV, JSON y de texto de un bucket |
| [Supabase](/es/integrations/databases-and-storage/#supabase) | SQL de solo lectura sobre tu base de Supabase |
| [Amazon Redshift](/es/integrations/databases-and-storage/#amazon-redshift) | SQL sobre un workgroup Serverless o un clúster |
| [Amazon Aurora](/es/integrations/databases-and-storage/#amazon-aurora) | SQL sobre Aurora PostgreSQL o MySQL |
| [Shopify](/es/integrations/shopify/) | Productos, pedidos, inventario |
| [Slack](/es/integrations/slack/) | Entregar artifacts a un canal o DM |
| Tienda Nube | E-commerce de LATAM |
| GitHub | Backup y exportación |
| CORS proxy | Llamar a APIs externas de la lista permitida desde la página |

## Dos tipos de conexión

- **Por artifact / OAuth-en-la-página** — por ejemplo Google Sheets: el visitante (o el dueño)
  autoriza, y el artifact trae los datos. Simple, sin configuración de admin.
- **A nivel workspace** — los conectores de plataforma y warehouse se definen una
  vez por workspace. Los artifacts los referencian por nombre con
  `sdk.connection('name')`. La mayoría usa **credenciales propias**: pegá tu token
  o clave de cuenta de servicio en el catálogo de conectores, usá **Test** antes de
  guardar, y copiá el snippet `sdk.connection('name')`.

El catálogo de conectores es siempre visible en el admin del workspace.

## Seguridad del token

Las credenciales nunca se exponen a la página — las llamadas pasan por el Worker
y los secrets se guardan encriptados. Usá
`POST /v1/workspaces/{id}/connections/test` para verificar credenciales antes de
guardar. Para API keys de LLM (OpenAI, Anthropic, …), usá el secrets proxy en la
[guía del agente de IA](/es/guides/ai-agent/#bring-your-own-keys).
