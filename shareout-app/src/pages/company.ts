/**
 * Company pages — Privacy, Terms.
 * Server-rendered via the design-system shell so they share tokens, canonical
 * and security headers. The legal pages carry real copy plus a lastReviewed date
 * for AI-search trust signals.
 *
 * NOTE: /privacy and /terms are served by the worker (see serve-router) so OAuth
 * providers always receive public HTML — these are the copies users actually accept.
 * The canonical source for legal pages used to live on a separate marketing site
 * (`marketing-site/…`); keep this worker copy as the OAuth-facing truth. Apex
 * marketing (landing/pricing) is optional via `MARKETING_ORIGIN` — unset for
 * self-host (default): `/` goes to login.
 */
import { renderHtmlPage } from '../design-system/shell';
import { brandLockupHtml } from '../brand';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';
import type { Env } from '../types';

const pageStyles = `
.co-wrap {
  max-width: 46rem;
  margin: 0 auto;
  padding: var(--space-10) var(--space-6) var(--space-12);
  display: flex; flex-direction: column; gap: var(--space-6);
}
.co-brand { margin-bottom: var(--space-2); }
.co-kicker { font-family: var(--font-body); font-weight: 600; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-primary); }
.co-h1 { font-family: var(--font-display); font-weight: 800; font-size: clamp(2rem, 5vw, 2.8rem); line-height: 1.1; letter-spacing: -0.03em; color: var(--color-text); margin: 0; }
.co-lead { font-size: 1.12rem; line-height: 1.6; color: var(--color-text); margin: 0; }
.co-wrap h2 { font-family: var(--font-display); font-weight: 700; font-size: 1.3rem; color: var(--color-text); margin: var(--space-4) 0 0; }
.co-wrap p { font-size: 1rem; line-height: 1.65; color: var(--color-text-secondary); margin: 0; }
.co-wrap a { color: var(--color-primary); }
.co-sign { font-style: italic; color: var(--color-text); }
.co-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-4); }
.co-note { padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text-secondary); font-size: 0.95rem; line-height: 1.6; }
.co-meta { font-size: 0.9rem; color: var(--color-text-secondary); margin: 0; }
.co-wrap ul { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
.co-wrap li { font-size: 1rem; line-height: 1.6; color: var(--color-text-secondary); }
`;

const LEGAL_EFFECTIVE = 'July 10, 2026';

// BreadcrumbList JSON-LD — gives AI engines navigation context (Home > Page)
// and makes the page eligible for breadcrumb rich results.
function breadcrumbJsonLd(base: string, slug: string, name: string): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: base },
      { '@type': 'ListItem', position: 2, name, item: `${base}/${slug}` },
    ],
  });
}

function legalPage(opts: {
  slug: string;
  heading: string;
  description: string;
  lead: string;
  sectionsHtml: string;
  base: string;
  host: string;
}): Response {
  const hello = `hello@${opts.host}`;
  const body = `<main class="co-wrap">
  <div class="co-brand">${brandLockupHtml({ markSize: 30, href: '/' })}</div>
  <div class="co-kicker">Legal</div>
  <h1 class="co-h1">${opts.heading}</h1>
  <p class="co-meta">Effective ${LEGAL_EFFECTIVE}</p>
  <p class="co-lead">${opts.lead}</p>
  ${opts.sectionsHtml}
  <h2>Contact</h2>
  <p>Questions about this ${opts.heading.toLowerCase()}? Email <a href="mailto:${hello}">${hello}</a>.</p>
  <div class="co-actions">
    <a class="so-c-btn so-c-btn--secondary" href="/">Back to ShareOut</a>
  </div>
</main>`;
  return renderHtmlPage({
    title: `${opts.heading} · ShareOut`,
    description: opts.description,
    pageStyles,
    body,
    canonical: `${opts.base}/${opts.slug}`,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        url: `${opts.base}/${opts.slug}`,
        name: opts.heading,
        description: opts.description,
        dateModified: '2026-07-10',
        publisher: { '@type': 'Organization', '@id': `${opts.base}/#organization` },
      }),
      breadcrumbJsonLd(opts.base, opts.slug, opts.heading),
    ],
  });
}

export function renderPrivacyPage(env: Env): Response {
  const base = getPlatformOrigin(env);
  const host = getPlatformHostname(env);
  const security = `security@${host}`;
  const hello = `hello@${host}`;
  return legalPage({
    base,
    host,
    slug: 'privacy',
    heading: 'Privacy Policy',
    description:
      'How ShareOut collects, uses, stores and protects your information when you publish and host pages.',
    lead:
      'This policy explains what information ShareOut collects, why, and the choices you have. We keep it short and plain because privacy should be understandable.',
    sectionsHtml: `
  <h2>Who we are</h2>
  <p>ShareOut ("ShareOut", "we", "us") operates the publishing platform at <a href="${base}">${host}</a>. This Privacy Policy describes how we handle personal information when you use our website, product, and APIs.</p>

  <h2>Our role (controller and processor)</h2>
  <p>For content you publish and connect, ShareOut acts as a data processor on your behalf; for your account and billing details, we act as the controller. Teams and Enterprise customers can request our Data Processing Agreement at <a href="mailto:${security}">${security}</a>.</p>

  <h2>Information we collect</h2>
  <p>We collect information in these categories:</p>
  <ul>
    <li><strong>Account information</strong> — email address, name, profile details, and authentication identifiers when you sign in (including via OAuth providers you choose).</li>
    <li><strong>Content you publish</strong> — pages, files, structured data, comments, and configuration for artifacts you create or upload.</li>
    <li><strong>Usage and device data</strong> — IP address, browser type, pages viewed, feature usage, timestamps, and diagnostic logs used to operate and secure the service.</li>
    <li><strong>Payment information</strong> — billing name, plan, and transaction history. Card numbers are collected and processed by our payment partners; we do not store full card numbers on our servers.</li>
    <li><strong>Communications</strong> — messages you send to support and optional notification preferences.</li>
  </ul>

  <h2>How we use information</h2>
  <ul>
    <li>Provide, maintain, and improve the service — publishing, hosting, collaboration, and integrations.</li>
    <li>Authenticate you, secure accounts, and prevent fraud and abuse.</li>
    <li>Process subscriptions, invoices, and customer support requests.</li>
    <li>Send essential service notices (for example, security alerts or billing receipts).</li>
    <li>Analyze aggregated usage to improve reliability and product design.</li>
  </ul>
  <p>We do not sell your personal information and we do not use third-party advertising cookies.</p>

  <h2>Legal bases (EEA, UK &amp; Argentina)</h2>
  <p>Where privacy law requires a legal basis, we rely on: (a) performance of our contract with you; (b) legitimate interests in operating and securing the service; (c) your consent where required (for example, optional marketing); and (d) compliance with legal obligations.</p>

  <h2>Cookies &amp; similar technologies</h2>
  <p>We use essential cookies and local storage to keep you signed in, remember preferences (such as language), and protect the service. You can control cookies through your browser settings; disabling essential cookies may limit functionality.</p>

  <h2>Sharing &amp; subprocessors</h2>
  <p>We use a small set of service providers to run ShareOut: Cloudflare (hosting, storage, email delivery), OpenAI and Anthropic via Vercel AI Gateway (AI features), and Google, Telegram and Slack (sign-in and integrations you choose to connect). Each is bound by contract to use your data only to provide their service to us. We keep a current list at <a href="${base}/security">${host}/security</a> and will give notice before adding a new subprocessor that handles your content.</p>
  <p>We may also disclose information if required by law or to protect rights, safety, and security.</p>

  <h2>Data storage &amp; security</h2>
  <p>ShareOut runs on Cloudflare's global infrastructure. Your content and account data may be stored and processed in data centers in multiple countries. We encrypt data in transit using TLS, and we encrypt stored credentials and connection secrets at rest using AES-256-GCM. We enforce access controls on our internal systems and keep audit logs of when connection credentials are used. No method of transmission or storage is 100% secure, so please use a strong password and protect your API tokens. To report a vulnerability or security incident, email <a href="mailto:${security}">${security}</a>.</p>

  <h2>If something goes wrong</h2>
  <p>If we ever discover a security breach that affects your personal data, we will notify affected account owners without undue delay — and within 72 hours where the law requires — describing what happened and what we're doing about it.</p>

  <h2>Your published content</h2>
  <p>Artifacts are private by default unless you change visibility. Public pages may be viewed, indexed, and cited by people, search engines, and AI systems. You control visibility settings and can unpublish or delete content at any time.</p>

  <h2>Connected integrations</h2>
  <p>When you connect a third-party data source, we access only the data needed to render your pages, using credentials you authorize. Heavy data may be fetched directly from your source; ShareOut acts as a control plane, not a permanent warehouse for your connected datasets. You can disconnect integrations at any time.</p>

  <h2>AI features</h2>
  <p>AI features send the prompts and context you provide to our AI providers, OpenAI and Anthropic (through Vercel AI Gateway), solely to generate your result. They process this content under API terms that do not use it to train their public models, and we do not use your private workspace content to train any model. Don't submit sensitive data you aren't authorized to share.</p>

  <h2>Data retention</h2>
  <p>We keep account and content data while your account is active. Workspace audit logs are kept for 12 months. When you delete content or close your account, we remove the associated data within 30 days, and purge it from backups within a further 90, except where we must keep it for legal, security, or billing reasons.</p>

  <h2>Your rights &amp; choices</h2>
  <p>Depending on where you live, you may have the right to access, correct, export, or delete your personal information, object to or restrict certain processing, and withdraw consent where processing is consent-based. The fastest way to get your data is to export it yourself: you can download any artifact, or a whole workspace as a zip, from the product at any time. To exercise these rights, email <a href="mailto:${hello}">${hello}</a>. You may also lodge a complaint with your local data protection authority.</p>

  <h2>California privacy rights</h2>
  <p>California residents may request disclosure of categories of personal information collected, deletion, and correction. We do not sell personal information or share it for cross-context behavioral advertising as defined by California law. To make a request, contact <a href="mailto:${hello}">${hello}</a>.</p>

  <h2>International transfers</h2>
  <p>If you access ShareOut from outside Argentina, your information may be transferred to countries with different data-protection laws. Where required, we use appropriate safeguards such as standard contractual clauses.</p>

  <h2>Children</h2>
  <p>ShareOut is not directed to children under 13 (or the minimum age required in your jurisdiction), and we do not knowingly collect their personal information. Contact us if you believe a child has provided data and we will delete it.</p>

  <h2>Changes</h2>
  <p>We may update this policy from time to time. When we do, we will revise the effective date above and, for material changes, provide additional notice. Your continued use after changes take effect constitutes acceptance.</p>`,
  });
}

export function renderTermsPage(env: Env): Response {
  const base = getPlatformOrigin(env);
  const host = getPlatformHostname(env);
  const security = `security@${host}`;
  return legalPage({
    base,
    host,
    slug: 'terms',
    heading: 'Terms of Service',
    description:
      'The terms that govern your use of ShareOut to publish, host and share pages and data artifacts.',
    lead:
      'These terms are the agreement between you and ShareOut. By using the service you agree to them. We have tried to keep them fair and readable.',
    sectionsHtml: `
  <h2>Agreement</h2>
  <p>These Terms of Service ("Terms") govern your access to and use of ShareOut at ${host} and related services (the "Service"). If you use the Service on behalf of an organization, you represent that you have authority to bind that organization to these Terms.</p>

  <h2>The service</h2>
  <p>ShareOut lets you publish, host, and share interactive pages and data artifacts — including via API, integrations, and AI agents. We may add, change, or remove features over time. Beta or preview features may be less reliable and are provided as-is.</p>

  <h2>Your account</h2>
  <p>You are responsible for activity under your account and for keeping your credentials secure. You must provide accurate information and be old enough to form a binding contract where you live. Notify us promptly at <a href="mailto:${security}">${security}</a> if you suspect unauthorized access.</p>

  <h2>Acceptable use</h2>
  <p>You agree not to use ShareOut to:</p>
  <ul>
    <li>Violate law or others' rights, including intellectual property and privacy.</li>
    <li>Distribute malware, phishing, spam, or deceptive or harmful content.</li>
    <li>Probe, disrupt, overload, reverse-engineer, or gain unauthorized access to the Service.</li>
    <li>Publish content you do not have the right to share, or scrape the Service in violation of our robots rules.</li>
    <li>Generate or distribute AI-created harmful content, including non-consensual intimate imagery, deceptive impersonation, or coordinated disinformation.</li>
  </ul>
  <p>We may investigate violations and suspend or terminate accounts that harm the Service or other users.</p>

  <h2>Your content</h2>
  <p>You retain ownership of content you publish ("Your Content"). You grant ShareOut a worldwide, non-exclusive license to host, store, process, reproduce, and display Your Content solely to operate and improve the Service — for example, serving pages to viewers you authorize and running backups. You are responsible for Your Content and for having the rights to use any data you connect.</p>

  <h2>Third-party integrations</h2>
  <p>When you connect external services (such as spreadsheets, analytics, or data warehouses), your use of those services is governed by their terms. You are responsible for the credentials you provide and for complying with third-party rules. ShareOut is not responsible for third-party outages or policy changes.</p>

  <h2>API, agents &amp; automation</h2>
  <p>You may access ShareOut programmatically via API tokens and agent skills. You are responsible for tokens you create and for automated actions they perform. Do not share tokens publicly or use the API in ways that exceed reasonable rate limits or circumvent plan limits.</p>

  <h2>Plans, billing &amp; trials</h2>
  <p>Free, Pro, Teams, and Enterprise plans are described on our <a href="/pricing">pricing page</a>. Paid subscriptions renew automatically each billing period until you cancel. You authorize us and our payment partners to charge your payment method on file. Prices may change with reasonable notice; continued use after a price change constitutes acceptance.</p>
  <p>Trials and promotional offers, if any, convert to paid plans unless you cancel before the trial ends. Except where required by law, fees are non-refundable. Taxes may apply based on your location.</p>

  <h2>ShareOut intellectual property</h2>
  <p>ShareOut and its logos, software, documentation, and design are owned by ShareOut and its licensors. These Terms do not grant you any right to use our trademarks except as needed to describe your use of the Service.</p>

  <h2>Disclaimers</h2>
  <p>The Service is provided "as is" and "as available." To the fullest extent permitted by law, ShareOut disclaims all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee uninterrupted or error-free operation. Uptime commitments (SLAs) are available on Enterprise plans.</p>

  <h2>Limitation of liability</h2>
  <p>To the fullest extent permitted by law, ShareOut and its suppliers will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for loss of data, revenue, profits, or goodwill, arising from your use of the Service. Our total liability for any claim arising out of these Terms or the Service is limited to the greater of (a) amounts you paid ShareOut in the twelve months before the claim or (b) USD $100.</p>

  <h2>Indemnification</h2>
  <p>You will defend and indemnify ShareOut against claims, damages, and expenses (including reasonable legal fees) arising from Your Content, your use of the Service, or your violation of these Terms or applicable law.</p>

  <h2>Termination</h2>
  <p>You may stop using ShareOut at any time and may delete your account from product settings. We may suspend or terminate access if you violate these Terms, if required by law, or to protect the Service and its users. Upon termination, your right to use the Service ends; we may delete Your Content after a reasonable period unless law requires retention.</p>

  <h2>Governing law &amp; disputes</h2>
  <p>These Terms are governed by the laws of Argentina, without regard to conflict-of-law rules. Courts in Buenos Aires, Argentina have exclusive jurisdiction, except that either party may seek injunctive relief in any court of competent jurisdiction. If you are a consumer in a jurisdiction with mandatory local protections, those protections apply to the extent required.</p>

  <h2>Assignment</h2>
  <p>We may assign these Terms in connection with a merger, acquisition, or sale of assets; you may not assign them without our consent.</p>

  <h2>Changes</h2>
  <p>We may update these Terms from time to time. When we make material changes, we will update the effective date above and provide additional notice where appropriate. Continued use after changes take effect means you accept the updated Terms.</p>`,
  });
}
