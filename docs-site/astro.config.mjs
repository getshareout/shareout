// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import starlightLlmsTxt from 'starlight-llms-txt';
import mermaid from 'astro-mermaid';

// starlight-openapi encodes the schema path via pathToFileURL().href, which turns
// spaces into %20. @readme/openapi-parser's resolver doesn't decode them, so a repo
// path containing a space fails to open. Pass a decoded file://
// URL (literal space) — the plugin forwards file: URLs verbatim.
const schema =
	'file://' + fileURLToPath(new URL('./src/openapi/shareout.yaml', import.meta.url));

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.shareout.site',
	integrations: [
		mermaid(),
		starlight({
			title: 'ShareOut Docs',
			description: 'Publish anything to the web. From idea to live in one call.',
			// Cross-domain entity graph: tie docs.shareout.site to the SAME
			// Organization @id used on shareout.site so AI/search resolve both
			// hosts to one ShareOut entity.
			head: [
				{
					tag: 'script',
					attrs: { type: 'application/ld+json' },
					content: JSON.stringify({
						'@context': 'https://schema.org',
						'@graph': [
							{
								'@type': 'Organization',
								'@id': 'https://shareout.site/#organization',
								name: 'ShareOut',
								url: 'https://shareout.site',
							},
							{
								'@type': 'WebSite',
								'@id': 'https://docs.shareout.site/#website',
								url: 'https://docs.shareout.site',
								name: 'ShareOut Docs',
								description:
									'Documentation for ShareOut — the no-code editor, browser SDK, REST API, integrations, crew automations and the artifact spec.',
								publisher: { '@id': 'https://shareout.site/#organization' },
							},
						],
					}),
				},
			],
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				es: { label: 'Español', lang: 'es' },
			},
			logo: {
				src: './src/assets/shareout-mark.png',
				alt: 'ShareOut',
			},
			favicon: '/favicon.png',
			social: [
				{ icon: 'seti:html', label: 'shareout.site', href: 'https://shareout.site' },
			],
			customCss: ['./src/styles/shareout.css'],
			plugins: [
				// Generates /llms.txt + /llms-full.txt from the docs so AI agents can
				// read the whole reference in one fetch — on-brand for an agent-first product.
				starlightLlmsTxt({
					projectName: 'ShareOut',
					description:
						'ShareOut publishes anything to the web — dashboards, decks, docs and apps — from a prompt or your data, live in one call. Docs cover the no-code editor, the browser SDK (tables, JSON, realtime, blobs, email), the REST API, integrations, crew automations and the artifact spec.',
				}),
				starlightOpenAPI([
					{
						base: 'api',
						label: 'REST API',
						schema,
					},
				]),
			],
			sidebar: [
				{
					label: '✨ Get started',
					translations: { es: '✨ Empezá acá' },
					items: [
						{ label: 'What is ShareOut?', slug: 'everyone/what-is-shareout', translations: { es: '¿Qué es ShareOut?' } },
						{ label: 'What can you make?', slug: 'everyone/what-you-can-make', translations: { es: '¿Qué podés hacer?' } },
						{ label: 'Make your first page', slug: 'everyone/make-your-first-page', translations: { es: 'Hacé tu primera página' } },
						{ label: 'Your workspace (Home)', slug: 'everyone/your-workspace', translations: { es: 'Tu workspace (Home)' } },
						{ label: 'Folder guides', slug: 'everyone/folder-guides', translations: { es: 'Guías de carpeta' } },
						{ label: 'Files & deliverables', slug: 'everyone/assets', translations: { es: 'Archivos y entregas' } },
					],
				},
				{
					label: '🎨 Build your page',
					translations: { es: '🎨 Armá tu página' },
					items: [
						{ label: 'Change anything', slug: 'everyone/the-editor', translations: { es: 'Cambiá lo que quieras' } },
						{ label: 'Photos & content', slug: 'everyone/add-your-stuff', translations: { es: 'Fotos y contenido' } },
						{ label: 'Collect replies (forms)', slug: 'everyone/forms', translations: { es: 'Recibí respuestas' } },
						{ label: 'Lists & data', slug: 'everyone/your-data', translations: { es: 'Listas y datos' } },
						{ label: 'Add a smart assistant', slug: 'everyone/assistant', translations: { es: 'Sumá un asistente' } },
					],
				},
				{
					label: '🔌 Connect your tools',
					translations: { es: '🔌 Conectá tus herramientas' },
					items: [
						{ label: 'Connect your tools', slug: 'everyone/connect', translations: { es: 'Conectá tus herramientas' } },
						{ label: 'Google Sheets', slug: 'everyone/google-sheets', translations: { es: 'Google Sheets' } },
						{ label: 'Your store & other tools', slug: 'everyone/more-connections', translations: { es: 'Tu tienda y otras herramientas' } },
					],
				},
				{
					label: '⚡ Put it on autopilot',
					translations: { es: '⚡ Ponelo en piloto automático' },
					items: [
						{ label: 'Automations', slug: 'everyone/automations', translations: { es: 'Automatizaciones' } },
						{ label: 'Receive email', slug: 'everyone/inbox', translations: { es: 'Recibí emails' } },
					],
				},
				{
					label: '🔗 Share & manage',
					translations: { es: '🔗 Compartí y gestioná' },
					items: [
						{ label: 'Share it', slug: 'everyone/share-it', translations: { es: 'Compartila' } },
						{ label: 'Work together', slug: 'everyone/collaborators', translations: { es: 'Trabajen juntos' } },
						{ label: 'Show people only their data', slug: 'everyone/who-sees-what', translations: { es: 'Mostrá a cada uno sus datos' } },
						{ label: 'Get help', slug: 'everyone/get-help', translations: { es: 'Pedí ayuda' } },
						{ label: 'Public artifacts (policy)', slug: 'public-artifacts/overview', translations: { es: 'Artifacts públicos (política)' } },
					],
				},
				{
					label: 'Start here',
					translations: { es: 'Primeros pasos' },
					items: [
						{ label: 'Introduction', slug: 'start/introduction', translations: { es: 'Introducción' } },
						{ label: 'Quickstart', slug: 'start/quickstart', translations: { es: 'Inicio rápido' } },
						{ label: 'Authentication', slug: 'start/authentication', translations: { es: 'Autenticación' } },
					],
				},
				{
					label: 'Self-host',
					translations: { es: 'Self-host' },
					items: [
						{ label: 'Overview', slug: 'self-host/overview', translations: { es: 'Overview' } },
						{ label: 'Data plane smoke', slug: 'self-host/data-smoke', translations: { es: 'Smoke de datos' } },
						{ label: 'Secrets', slug: 'self-host/secrets', translations: { es: 'Secrets' } },
						{ label: 'AI provider', slug: 'self-host/ai', translations: { es: 'Proveedor de IA' } },
						{ label: 'Email', slug: 'self-host/email', translations: { es: 'Correo' } },
						{ label: 'Architecture', slug: 'self-host/architecture', translations: { es: 'Arquitectura' } },
						{ label: 'Ops', slug: 'self-host/ops', translations: { es: 'Ops' } },
						{ label: 'Threat model', slug: 'self-host/threat-model', translations: { es: 'Threat model' } },
					],
				},
				{
					label: 'Guides',
					translations: { es: 'Guías' },
					items: [
						{ label: 'Publishing artifacts', slug: 'guides/publishing', translations: { es: 'Publicar artifacts' } },
						{ label: 'Data provenance', slug: 'guides/data-provenance', translations: { es: 'Procedencia de datos' } },
						{ label: 'Storing data', slug: 'guides/data', translations: { es: 'Guardar datos' } },
						{ label: 'Scheduling jobs', slug: 'guides/jobs', translations: { es: 'Tareas programadas' } },
						{ label: 'Metric alerts', slug: 'guides/metric-alerts', translations: { es: 'Alertas de métricas' } },
						{ label: 'AI chat agent', slug: 'guides/ai-agent', translations: { es: 'Agente de chat IA' } },
						{ label: 'Fast rendering', slug: 'guides/performance', translations: { es: 'Renderizado rápido' } },
						{ label: 'Telegram bot', slug: 'guides/telegram-bot', translations: { es: 'Bot de Telegram' } },
						{ label: 'Slack bot', slug: 'guides/slack-bot', translations: { es: 'Bot de Slack' } },
						{ label: 'Your data is portable', slug: 'guides/data-portability', translations: { es: 'Tus datos son portables' } },
					],
				},
				{
					label: 'Browser SDK',
					translations: { es: 'SDK del navegador' },
					items: [
						{ label: 'Overview', slug: 'sdk/overview', translations: { es: 'Introducción' } },
						{ label: 'JSON store', slug: 'sdk/json', translations: { es: 'Almacén JSON' } },
						{ label: 'Libraries', slug: 'sdk/libraries', translations: { es: 'Librerías' } },
						{ label: 'Tables', slug: 'sdk/tables', translations: { es: 'Tablas' } },
						{ label: 'Editable grid', slug: 'sdk/grid', translations: { es: 'Grilla editable' } },
						{ label: 'Realtime', slug: 'sdk/realtime', translations: { es: 'Tiempo real' } },
						{ label: 'Blobs', slug: 'sdk/blobs', translations: { es: 'Blobs' } },
						{ label: 'Files', slug: 'sdk/files', translations: { es: 'Archivos' } },
						{ label: 'Email', slug: 'sdk/email', translations: { es: 'Email' } },
						{ label: 'Python', slug: 'sdk/python', translations: { es: 'Python' } },
						{ label: 'Comments', slug: 'sdk/comments', translations: { es: 'Comentarios' } },
						{ label: 'Google Sheets store', slug: 'sdk/sheets', translations: { es: 'Almacén de Google Sheets' } },
						{ label: 'Connections', slug: 'sdk/connections', translations: { es: 'Conexiones' } },
						{ label: 'Data sources', slug: 'sdk/sources', translations: { es: 'Fuentes de datos' } },
						{ label: 'Datasets', slug: 'sdk/datasets', translations: { es: 'Datasets' } },
						{ label: 'Live data', slug: 'sdk/live-data', translations: { es: 'Datos en vivo' } },
						{ label: 'Secrets', slug: 'sdk/secrets', translations: { es: 'Secrets' } },
						{ label: 'AI agent', slug: 'sdk/agent', translations: { es: 'Agente IA' } },
						{ label: 'Page Pilot', slug: 'sdk/pilot', translations: { es: 'Page Pilot' } },
						{ label: 'Crew', slug: 'sdk/crew', translations: { es: 'Crew' } },
						{ label: 'Templates', slug: 'sdk/templates', translations: { es: 'Plantillas' } },
					],
				},
				{
					label: 'Crew',
					translations: { es: 'Crew' },
					items: [
						{ label: 'Overview', slug: 'crew/overview', translations: { es: 'Introducción' } },
						{ label: 'Tools', slug: 'crew/tools', translations: { es: 'Tools' } },
						{ label: 'Patterns & examples', slug: 'crew/patterns', translations: { es: 'Patrones y ejemplos' } },
						{ label: 'SDK & API', slug: 'crew/sdk-api', translations: { es: 'SDK y API' } },
					],
				},
				{
					label: 'Integrations',
					translations: { es: 'Integraciones' },
					items: [
						{ label: 'Overview', slug: 'integrations/overview', translations: { es: 'Introducción' } },
						{ label: 'Google Sheets', slug: 'integrations/google-sheets', translations: { es: 'Google Sheets' } },
						{ label: 'BigQuery', slug: 'integrations/bigquery', translations: { es: 'BigQuery' } },
						{ label: 'Snowflake', slug: 'integrations/snowflake', translations: { es: 'Snowflake' } },
						{ label: 'Google Analytics', slug: 'integrations/google-analytics', translations: { es: 'Google Analytics' } },
						{ label: 'Google Ads', slug: 'integrations/google-ads', translations: { es: 'Google Ads' } },
						{ label: 'Facebook Ads', slug: 'integrations/facebook-ads', translations: { es: 'Facebook Ads' } },
						{ label: 'Shopify', slug: 'integrations/shopify', translations: { es: 'Shopify' } },
						{ label: 'Tienda Nube', slug: 'integrations/tiendanube', translations: { es: 'Tienda Nube' } },
						{ label: 'Slack', slug: 'integrations/slack', translations: { es: 'Slack' } },
						{ label: 'GitHub', slug: 'integrations/github', translations: { es: 'GitHub' } },
						{ label: 'CORS proxy', slug: 'integrations/cors-proxy', translations: { es: 'Proxy CORS' } },
					],
				},
				{
					label: 'Artifact spec',
					translations: { es: 'Especificación de artifacts' },
					items: [
						{ label: 'Overview', slug: 'spec/overview', translations: { es: 'Introducción' } },
						{ label: 'Manifest', slug: 'spec/manifest', translations: { es: 'Manifest' } },
						{ label: 'Bindings', slug: 'spec/bindings', translations: { es: 'Bindings' } },
						{ label: 'Templates', slug: 'spec/templates', translations: { es: 'Plantillas' } },
						{ label: 'Pages', slug: 'spec/pages', translations: { es: 'Páginas' } },
						{ label: 'Access policy', slug: 'spec/access-policy', translations: { es: 'Política de acceso' } },
						{ label: 'Visual editor', slug: 'spec/editor', translations: { es: 'Editor visual' } },
						{ label: 'Source editor', slug: 'spec/source-editor', translations: { es: 'Editor de código' } },
					],
				},
				{
					label: 'Slides',
					translations: { es: 'Presentaciones' },
					items: [
						{ label: 'Overview', slug: 'slides/overview', translations: { es: 'Introducción' } },
						{ label: 'Authoring', slug: 'slides/authoring', translations: { es: 'Creación' } },
						{ label: 'SDK API', slug: 'slides/sdk-api', translations: { es: 'API del SDK' } },
						{ label: 'Presenter mode', slug: 'slides/presenter-mode', translations: { es: 'Modo presentador' } },
							{ label: 'Viewer analytics', slug: 'slides/analytics', translations: { es: 'Analítica de visualizaciones' } },
					],
				},
				{
					label: 'Dashboards',
					translations: { es: 'Dashboards' },
					items: [
						{ label: 'Overview', slug: 'dashboards/overview', translations: { es: 'Introducción' } },
						{ label: 'Data sources', slug: 'dashboards/data-sources', translations: { es: 'Fuentes de datos' } },
						{ label: 'Widgets & charts', slug: 'dashboards/widgets', translations: { es: 'Widgets y gráficos' } },
						{ label: 'SDK API', slug: 'dashboards/sdk-api', translations: { es: 'API del SDK' } },
					],
				},
				{
					label: 'Mobile & PWA',
					translations: { es: 'Mobile y PWA' },
					items: [
						{ label: 'Overview', slug: 'mobile/overview', translations: { es: 'Introducción' } },
						{ label: 'PWA', slug: 'mobile/pwa', translations: { es: 'PWA' } },
					],
				},
				{
					label: 'UI components',
					translations: { es: 'Componentes de UI' },
					items: [
						{ label: 'Overview', slug: 'ui/overview', translations: { es: 'Introducción' } },
						{ label: 'Components', slug: 'ui/components', translations: { es: 'Componentes' } },
					],
				},
				{
					label: 'Teams & Enterprise',
					translations: { es: 'Teams y Enterprise' },
					items: [
						{ label: 'Overview', slug: 'teams/overview', translations: { es: 'Introducción' } },
						{ label: 'Workspaces', slug: 'teams/workspaces', translations: { es: 'Espacios de trabajo' } },
						{ label: 'Folders', slug: 'teams/folders', translations: { es: 'Carpetas' } },
						{ label: 'External sharing', slug: 'teams/external-sharing', translations: { es: 'Compartir con clientes' } },
						{ label: 'Custom subdomain', slug: 'teams/subdomain', translations: { es: 'Subdominio propio' } },
						{ label: 'Workspace connections', slug: 'teams/connections', translations: { es: 'Conexiones del espacio' } },
						{ label: 'Workspace assistant', slug: 'teams/workspace-assistant', translations: { es: 'Asistente del workspace' } },
						{ label: 'Skill Marketplace', slug: 'teams/skill-marketplace', translations: { es: 'Skill Marketplace' } },
						{ label: 'Data catalog', slug: 'teams/catalog', translations: { es: 'Catálogo de datos' } },
						{ label: 'Workspace Knowledge', slug: 'teams/knowledge', translations: { es: 'Conocimiento del workspace' } },
						{ label: 'Workspace Library', slug: 'teams/libraries', translations: { es: 'Librería del workspace' } },
						{ label: 'Homepage', slug: 'teams/homepage', translations: { es: 'Página de inicio' } },
						{ label: 'Admin', slug: 'teams/admin', translations: { es: 'Administración' } },
						{ label: 'Security & governance by plan', slug: 'teams/security-governance', translations: { es: 'Seguridad y gobernanza por plan' } },
						{ label: 'API', slug: 'teams/api', translations: { es: 'API' } },
					],
				},
				{
					label: 'API reference',
					translations: { es: 'Referencia de la API' },
					items: openAPISidebarGroups,
				},
			],
		}),
	],
});
