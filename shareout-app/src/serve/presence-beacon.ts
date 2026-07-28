// Live-presence heartbeat. Injected into every served artifact's raw HTML (same hot
// path + cross-origin constraints as the perf beacon, src/serve/perf-beacon.ts). While
// the tab is VISIBLE it POSTs /v1/presence on the trusted API origin every 20s; it
// pauses when hidden and pings immediately on becoming visible again, so a backgrounded
// tab stops counting as an active viewer. The server resolves viewer identity from the
// request (no cookie); the body is a text/plain JSON blob to stay a CORS-safelisted
// simple request (no preflight). Response ignored (fire-and-forget).
//
// Self-exclusion: capture-mode renders never reach this raw path, and we bail on
// navigator.webdriver (headless bots), exactly like the perf beacon.

const HEARTBEAT_MS = 20000;

function buildBeacon(artifactId: string, endpoint: string): string {
  return `(function(){try{
if(navigator.webdriver)return;
var A=${JSON.stringify(artifactId)},E=${JSON.stringify(endpoint)},timer=0;
function ping(){try{
var b=JSON.stringify({a:A});
fetch(E,{method:'POST',body:b,keepalive:true,mode:'no-cors',headers:{'Content-Type':'text/plain'}});
}catch(e){}}
function start(){if(timer)return;ping();timer=setInterval(ping,${HEARTBEAT_MS});}
function stop(){if(timer){clearInterval(timer);timer=0;}}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')start();else stop();});
if(document.visibilityState==='visible')start();
}catch(e){}})();`;
}

// Appends the heartbeat <script> into <head>/<body> of the raw artifact response.
// baseUrl is the trusted API origin (SHAREOUT_BASE_URL).
export function injectPresenceBeacon(resp: Response, artifactId: string, baseUrl: string): Response {
  const endpoint = `${baseUrl}/v1/presence`;
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
