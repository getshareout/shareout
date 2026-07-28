// Renders an AI-generated outline into a self-contained reveal.js deck, matching
// the structure of the real slides artifact (examples/shareout-slides-showcase-
// presentation.html): `.reveal > .slides > section`, per-slide `<aside class="notes">`,
// reveal.js@5 from CDN, and the navy ShareOut stage theme. Not a new format — the
// same markup the product's published `/p/{slug}` view renders.

export interface DeckSlide {
  heading: string;
  bullets: string[];
  note?: string;
}

export interface Deck {
  title: string;
  slides: DeckSlide[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleSlide(title: string, host: string): string {
  return `<section>
        <div class="stage hero">
          <div class="topbar"><div class="brand"><span class="brand-mark"></span> ShareOut</div><div class="pill">Presentation</div></div>
          <div><div class="eyebrow">Overview</div><h1><span class="gradient-text">${esc(title)}</span></h1></div>
          <div class="footer"><span>${esc(host)}</span><span>Generated deck</span></div>
        </div>
      </section>`;
}

function contentSlide(s: DeckSlide, index: number, total: number, deckTitle: string): string {
  const bullets = s.bullets.map((b) => `<li>${esc(b)}</li>`).join('');
  const pct = Math.round(((index + 1) / total) * 100);
  const notes = s.note ? `<aside class="notes">${esc(s.note)}</aside>` : '';
  return `<section>
        <div class="stage">
          <div class="eyebrow">${esc(String(index + 1).padStart(2, '0'))}</div>
          <h2>${esc(s.heading)}</h2>
          <ul class="feature-list">${bullets}</ul>
          <div class="footer"><span>${esc(deckTitle)}</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>
        </div>
        ${notes}
      </section>`;
}

const CSS = `:root{--midnight:#07111f;--text:#f7fbff;--soft:#d8e7ff;--muted:#9eb4d0;--cyan:#35d4ff;--violet:#9b7cff;--line:rgba(166,206,255,.16);--sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--midnight)}
body{color:var(--text);font-family:var(--sans);background:radial-gradient(circle at 18% 18%,rgba(88,166,255,.34),transparent 28rem),radial-gradient(circle at 88% 12%,rgba(155,124,255,.28),transparent 30rem),linear-gradient(135deg,#040a14 0%,#08182a 45%,#101127 100%)}
.reveal{color:var(--text);font-family:var(--sans)}.reveal .slides{text-align:left}.reveal section{padding:34px}
.reveal h1,.reveal h2,.reveal p,.reveal li{margin:0;color:inherit;text-transform:none}
.reveal h1,.reveal h2{font-weight:900;letter-spacing:-.065em;line-height:.9}
.reveal h1{font-size:clamp(64px,8vw,120px)}.reveal h2{font-size:clamp(46px,6vw,86px)}
.reveal li{font-size:24px;line-height:1.45;color:var(--soft)}
.stage{position:relative;min-height:642px;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:34px;padding:46px;background:linear-gradient(145deg,rgba(255,255,255,.08),rgba(255,255,255,.025)),rgba(10,20,36,.74);box-shadow:0 34px 90px rgba(0,0,0,.34)}
.stage.hero{justify-content:space-between;background:radial-gradient(circle at 24% 18%,rgba(53,212,255,.28),transparent 26rem),radial-gradient(circle at 82% 24%,rgba(155,124,255,.32),transparent 27rem),linear-gradient(135deg,rgba(9,21,39,.98),rgba(15,25,50,.82))}
.eyebrow{display:inline-flex;align-items:center;gap:10px;margin-bottom:22px;color:var(--cyan);font-size:12px;font-weight:900;letter-spacing:.19em;text-transform:uppercase}
.eyebrow::before{content:"";width:32px;height:2px;border-radius:999px;background:linear-gradient(90deg,var(--cyan),var(--violet))}
.gradient-text{color:transparent;background:linear-gradient(90deg,#f7fbff 0%,#7bdcff 43%,#b8a3ff 100%);-webkit-background-clip:text;background-clip:text}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:24px}
.brand{display:inline-flex;align-items:center;gap:12px;color:var(--soft);font-size:14px;font-weight:800}
.brand-mark{width:28px;height:28px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:linear-gradient(135deg,rgba(88,166,255,.9),rgba(155,124,255,.88))}
.pill{display:inline-flex;align-items:center;min-height:32px;padding:8px 13px;border:1px solid var(--line);border-radius:999px;color:var(--soft);background:rgba(255,255,255,.06);font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.feature-list{display:grid;gap:14px;margin:32px 0 0;padding:0;list-style:none}
.feature-list li{display:grid;grid-template-columns:34px 1fr;gap:14px;align-items:start}
.feature-list li::before{content:"";width:34px;height:34px;border:1px solid rgba(53,212,255,.42);border-radius:12px;background:radial-gradient(circle at 50% 50%,rgba(53,212,255,.7) 0 4px,transparent 5px),rgba(53,212,255,.09)}
.footer{margin-top:auto;padding-top:28px;display:flex;align-items:center;justify-content:space-between;color:rgba(216,231,255,.55);font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.progress-track{width:138px;height:4px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.12)}
.progress-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--cyan),var(--violet))}
.reveal .controls,.reveal .progress{color:var(--cyan)}`;

/**
 * `host` names the instance the deck came from. It used to be the literal
 * shareout.site, so a self-hoster presenting to a client showed someone else's
 * domain in the footer of every slide.
 */
export function renderDeckHtml(deck: Deck, host: string): string {
  const total = deck.slides.length;
  const sections = [
    titleSlide(deck.title, host),
    ...deck.slides.map((s, i) => contentSlide(s, i, total, deck.title)),
  ].join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(deck.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reset.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <style>${CSS}</style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      ${sections}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.js"></script>
  <script>
    Reveal.initialize({ hash: true, controls: true, progress: true, center: true, width: 1280, height: 720, margin: 0.04, transition: 'slide', slideNumber: 'c/t', plugins: [RevealNotes] });
  </script>
</body>
</html>`;
}
