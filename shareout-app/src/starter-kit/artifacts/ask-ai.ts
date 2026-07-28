import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = `<style>
  .chat-wrap{display:flex;flex-direction:column;height:62vh;min-height:380px}
  .chat-list{flex:1;overflow-y:auto;padding:4px;display:flex;flex-direction:column;gap:12px}
  .bubble{max-width:80%;padding:10px 14px;border-radius:14px;font-size:14px;
    line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
  .bubble.user{align-self:flex-end;background:var(--so-blue);color:#fff;border-bottom-right-radius:5px}
  .bubble.ai{align-self:flex-start;background:#f5f5f4;color:var(--so-ink);border-bottom-left-radius:5px}
  .bubble.ai.pending::after{content:"…";color:var(--so-ink-3)}
  .chat-form{display:flex;gap:8px;margin-top:14px}
  .chat-form .so-input{flex:1}
</style>`;

const body = `
<div class="so-card">
  <div class="chat-wrap">
    <div class="chat-list" id="list"></div>
    <form class="chat-form" id="form">
      <input class="so-input" id="input" placeholder="Ask anything about this page…" autocomplete="off">
      <button class="so-btn" id="send" type="submit">Send</button>
    </form>
  </div>
</div>
<p class="so-muted" style="margin-top:16px">
  Drop a real AI assistant into any artifact with <code>so.agent</code> — it answers from
  your data, and no API keys ever live in the page.
</p>`;

const script = `
  const list = document.getElementById('list');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const send = document.getElementById('send');

  // Reading-first scrolling: follow the stream only while the reader is at the
  // bottom; anchor a new question near the top; never yank a reader who scrolled up.
  let following = true;
  function atEdge(){ return list.scrollHeight - list.scrollTop - list.clientHeight < 60; }
  list.addEventListener('scroll', function(){ following = atEdge(); });
  function stick(){ if(following) list.scrollTop = list.scrollHeight; }
  function anchor(el){ list.scrollTop = Math.max(0, el.offsetTop - 8); following = false; }

  function bubble(role, text){
    const el = document.createElement('div');
    el.className = 'bubble ' + role;
    el.textContent = text || '';
    list.appendChild(el);
    if(role === 'user'){ anchor(el); } else { stick(); }
    return el;
  }

  function note(text){
    const el = document.createElement('p');
    el.className = 'so-muted';
    el.style.alignSelf = 'flex-start';
    el.textContent = text;
    list.appendChild(el);
    stick();
  }

  bubble('ai', "Hi — I'm an AI assistant that lives inside this page. Ask me something.");

  let convo = null;

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    const text = input.value.trim();
    if(!text) return;
    input.value = '';
    bubble('user', text);

    const reply = bubble('ai', '');
    reply.classList.add('pending');
    send.disabled = true;
    let got = false;

    try{
      for await (const chunk of so.agent.chat({ message: text, conversationId: convo || undefined })){
        if(chunk.type === 'content' && chunk.content){
          got = true;
          reply.classList.remove('pending');
          reply.textContent += chunk.content;
          stick();
        } else if(chunk.type === 'done'){
          if(chunk.conversationId) convo = chunk.conversationId;
        } else if(chunk.type === 'error'){
          reply.remove();
          note('Turn on the AI agent for this artifact to chat here.');
          got = true;
        }
      }
      if(!got){
        reply.remove();
        note('Turn on the AI agent for this artifact to chat here.');
      } else {
        reply.classList.remove('pending');
      }
    }catch(err){
      reply.remove();
      note('Turn on the AI agent for this artifact to chat here.');
    }finally{
      send.disabled = false;
      input.focus();
    }
  });`;

export const askAi: StarterArtifact = {
  slug: 'ask-ai',
  name: 'Ask AI',
  description: 'A chat panel backed by an AI agent that answers from this page.',
  feature: 'so.agent',
  tier: 'personal',
  // Enable the visitor agent at publish so the chat works out of the box.
  agent: {
    enabled: true,
    systemPrompt:
      'You are a friendly assistant living inside a ShareOut artifact — a small web page that anyone can publish in one click. Keep answers short and concrete. If asked what you are, explain that you were added to this page with so.agent, ShareOut\'s in-artifact AI, and that the page owner can change your instructions or what data you can see.',
  },
  html: frame({
    title: 'Ask AI',
    feature: 'so.agent',
    description: 'Chat with an AI assistant that lives inside the artifact.',
    head,
    body,
    script,
  }),
};
