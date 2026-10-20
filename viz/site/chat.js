import { chatConfig } from './chat-config.js';
const root=document.createElement('div');root.id='dolly-assistant';
root.innerHTML=`<button type="button" class="chat-launch" aria-label="Ask Dolly — open or close the research guide" title="Ask Dolly" aria-expanded="false" aria-controls="chat-panel"><svg class="chat-sheep" viewBox="0 0 64 56" aria-hidden="true" focusable="false"><ellipse cx="32" cy="51" rx="19" ry="3" fill="#143b34" opacity=".08"/><g stroke="#397a65" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 40v7q0 5 5 3v-9m12 0v6q0 5 5 3V39" fill="#78b99b"/><path d="M12 32C3 30 4 20 11 18 7 10 16 5 22 9 25 1 36 1 40 8 48 3 56 10 53 17 62 20 61 30 54 33 58 41 49 47 43 43 38 50 28 49 24 44 15 48 8 41 12 32Z" fill="#b5ddc5"/><ellipse cx="17" cy="27" rx="8" ry="4.5" transform="rotate(28 17 27)" fill="#dff2e5"/><ellipse cx="47" cy="27" rx="8" ry="4.5" transform="rotate(-28 47 27)" fill="#dff2e5"/><path d="M20 24Q32 17 44 24L43 35Q42 45 32 46Q22 45 21 35Z" fill="#f3fbf3"/><path d="M20 23C16 18 20 13 25 15 26 9 34 10 35 14 41 10 47 16 43 22 39 26 35 22 33 21 29 27 25 24 24 22" fill="#c8e7d0"/></g><ellipse cx="24" cy="36" rx="3.7" ry="2.3" fill="#e8aaa7" opacity=".75"/><ellipse cx="40" cy="36" rx="3.7" ry="2.3" fill="#e8aaa7" opacity=".75"/><g fill="#214d40"><ellipse cx="26" cy="31.5" rx="2" ry="2.8"/><ellipse cx="38" cy="31.5" rx="2" ry="2.8"/><path d="M29.5 36Q32 34.8 34.5 36L32 38Z"/></g><g fill="white"><circle cx="26.5" cy="30.6" r=".7"/><circle cx="38.5" cy="30.6" r=".7"/></g><path d="M32 38v1m-4 0q2 3 4 0 2 3 4 0" fill="none" stroke="#397a65" stroke-width="1.3" stroke-linecap="round"/></svg></button>
<section id="chat-panel" class="chat-panel" aria-label="Dolly research guide" hidden>
<header class="chat-header"><div><strong>Dolly research guide</strong><span>Methods, findings & website help</span></div><button type="button" class="chat-close" aria-label="Close assistant">×</button></header>
<div class="chat-intro">Answers use reviewed project documentation, not live chart data. AI can make mistakes—check the cited sources.</div>
<div class="chat-messages" role="log" aria-label="Conversation" aria-live="polite"></div>
<div class="chat-starters"><button type="button">What does an m6A score mean?</button><button type="button">How does the v2 model work?</button><button type="button">How should I compare cell lines?</button></div>
<form class="chat-form"><label for="chat-question">Your question</label><textarea id="chat-question" rows="2" maxlength="1500" placeholder="Ask about Dolly…"></textarea><div id="chat-verification"></div><div class="chat-actions"><button type="button" class="chat-clear">Clear chat</button><button type="submit" class="chat-send">Send</button></div></form>
<p class="chat-status" role="status"></p><p class="chat-privacy">Sending shares your question and recent chat with our backend and Google Gemini. Do not enter secrets or private data. Chat history is kept in this tab only. <a href="#methods">Read the guide</a></p>
</section>`;
document.body.append(root);
const el=s=>root.querySelector(s),launch=el('.chat-launch'),panel=el('.chat-panel'),input=el('textarea'),send=el('.chat-send'),status=el('.chat-status'),log=el('.chat-messages');
let history=[],busy=false,token='',widget=null,scriptPromise;
let configured=false;
try{const u=new URL(chatConfig.endpoint);configured=u.protocol==='https:'&&u.pathname==='/chat'&&!!chatConfig.turnstileSiteKey;}catch{}
function sync(){send.disabled=!configured||busy||!token;input.disabled=!configured||busy;el('.chat-clear').disabled=busy;root.querySelectorAll('.chat-starters button').forEach(b=>b.disabled=!configured||busy);}
function message(role,text){const box=document.createElement('article');box.className='chat-message '+role;const who=document.createElement('strong');who.textContent=role==='user'?'You':'Dolly';const body=document.createElement('div');body.textContent=text;box.append(who,body);log.append(box);log.scrollTop=log.scrollHeight;return box;}
function show(open){panel.hidden=!open;launch.setAttribute('aria-expanded',String(open));if(open){if(configured){input.focus();verification();}else{el('.chat-close').focus();status.textContent='Not connected yet. The team is setting up the AI service. Home & guide is available now.';}}else launch.focus();}
launch.addEventListener('click',()=>show(panel.hidden));el('.chat-close').addEventListener('click',()=>show(false));
root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){show(false);e.stopPropagation();}});
function verification(){
 if(widget!==null||!configured)return;
 if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{if(window.turnstile)return resolve();const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=resolve;s.onerror=reject;document.head.append(s);});
 scriptPromise.then(()=>{
  if(widget!==null)return;
  widget=window.turnstile.render(el('#chat-verification'),{sitekey:chatConfig.turnstileSiteKey,action:'dolly-chat',theme:'light',size:'flexible',callback:value=>{token=value;status.textContent='Ready to answer.';sync();},'expired-callback':()=>{token='';sync();},'error-callback':()=>{token='';status.textContent='Verification failed. Refresh the page to retry.';sync();}});
 }).catch(()=>{status.textContent='Verification could not load. Check your connection and refresh.';});
}
el('.chat-clear').addEventListener('click',()=>{history=[];log.replaceChildren();input.value='';status.textContent='Conversation cleared.';input.focus();});
root.querySelectorAll('.chat-starters button').forEach(b=>b.addEventListener('click',()=>{input.value=b.textContent;input.focus();}));
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!send.disabled)el('form').requestSubmit();}});
el('form').addEventListener('submit',async e=>{
 e.preventDefault();const question=input.value.trim();if(!question||busy||!configured||!token)return;
 const next=[...history.slice(-4),{role:'user',content:question}];
 message('user',question);input.value='';busy=true;sync();status.textContent='Reading the project notes…';
 try{
  const response=await fetch(chatConfig.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:next,turnstileToken:token}),signal:AbortSignal.timeout(65000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The assistant is temporarily unavailable.');
  if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('No answer was returned.');
  const answer=data.answer.slice(0,6000),box=message('assistant',answer);
  if(Array.isArray(data.sources)&&data.sources.length){const refs=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Project sources';refs.append(summary);for(const source of data.sources){if(!/^S[1-6]$/.test(source.id)||typeof source.title!=='string'||typeof source.path!=='string')continue;const p=document.createElement('p');p.textContent=`[${source.id}] ${source.title} — ${source.path}`;refs.append(p);}box.append(refs);}
  // Limit retained context so a long session cannot grow request costs indefinitely.
  history=[...next,{role:'assistant',content:answer.slice(0,3000)}].slice(-4);
  status.textContent=data.truncated?'Answer reached its length limit. Ask a narrower follow-up.':'Check the sources before using an answer in your report.';
 }catch(error){status.textContent=error.name==='TimeoutError'?'The request timed out. Try again.':error.message;input.value=question;}
 finally{busy=false;token='';if(widget!==null)window.turnstile.reset(widget);sync();input.focus();}
});
sync();
