import { chatConfig } from './chat-config.js';
const root=document.createElement('div');root.id='dolly-assistant';
root.innerHTML=`<button class="chat-launch" aria-expanded="false" aria-controls="chat-panel">✦ Ask Dolly</button>
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
