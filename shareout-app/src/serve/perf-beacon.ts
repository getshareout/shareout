// Real-user performance beacon (opt-017). Injected into every served artifact's raw
// HTML (the iframe-internal document). Measures the artifact's OWN timeline — FCP/LCP
// relative to its iframe navigation, plus TTFB/DCL from Navigation Timing — and fires
// once on first visibility loss to POST /v1/perf on the trusted API origin.
//
// Why hand-rolled (no web-vitals dep): this ships byte-for-byte into every artifact, so
// size and zero-deps win over the library's stricter LCP edge-case handling. We flag
// 8s-vs-1s, not a CWV compliance score.
//
// Cross-origin notes: the artifact runs in an opaque-origin sandboxed iframe on the
// content domain. The beacon POSTs to the absolute API origin (cross-origin) as a
// `text/plain` Blob so it stays a CORS-safelisted "simple" request — no preflight, which
// sendBeacon cannot perform. The response is ignored (fire-and-forget).
//
// Excluded traffic: capture-mode renders never reach the raw path that injects this, so
// ShareOut's own screenshot/PDF/thumbnail bots self-exclude. We additionally bail on
// navigator.webdriver (headless) and on docs that were never visible (prerender/prefetch).
function buildBeacon(artifactId: string, endpoint: string): string {
  // Single-quoted, minified-by-hand IIFE. `__A` / `__E` are substituted server-side.
  return `(function(){try{
if(navigator.webdriver)return;
var A=${JSON.stringify(artifactId)},E=${JSON.stringify(endpoint)},sent=false,fcp=0,lcp=0;
var seen=document.visibilityState==='visible';
function po(t,cb){try{new PerformanceObserver(cb).observe({type:t,buffered:true});}catch(e){}}
po('paint',function(l){l.getEntries().forEach(function(e){if(e.name==='first-contentful-paint')fcp=e.startTime;});});
po('largest-contentful-paint',function(l){l.getEntries().forEach(function(e){if(e.startTime>lcp)lcp=e.startTime;});});
function send(){
if(sent||!seen||!fcp)return;sent=true;
var n=(performance.getEntriesByType('navigation')||[])[0]||{};
var b=JSON.stringify({a:A,fcp:Math.round(fcp),lcp:Math.round(lcp||fcp),dcl:Math.round(n.domContentLoadedEventEnd||0),ttfb:Math.round(n.responseStart||0)});
try{var bl=new Blob([b],{type:'text/plain'});if(navigator.sendBeacon&&navigator.sendBeacon(E,bl))return;}catch(e){}
try{fetch(E,{method:'POST',body:b,keepalive:true,mode:'no-cors',headers:{'Content-Type':'text/plain'}});}catch(e){}
}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'){seen=true;}else{send();}});
addEventListener('pagehide',send);
}catch(e){}})();`;
}

// Chain after any other transform: appends the beacon <script> into <head>/<body> of the
// raw artifact response. baseUrl is the trusted API origin (SHAREOUT_BASE_URL).
export function injectPerfBeacon(resp: Response, artifactId: string, baseUrl: string): Response {
  const endpoint = `${baseUrl}/v1/perf`;
  const tag = `<script>${buildBeacon(artifactId, endpoint)}</script>`;
  let injected = false;
  const append = {
    element(e: { append: (c: string, o: { html: boolean }) => void }) {
      if (injected) return;
      injected = true;
      e.append(tag, { html: true });
    },
  };
  return new HTMLRewriter().on('head', append).on('body', append).transform(resp);
}
