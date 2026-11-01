import { chatConfig } from './chat-config.js';
const root=document.createElement('div');root.id='dolly-assistant';
root.innerHTML=`<button type="button" class="chat-launch" aria-label="Ask Dolly — open or close the research guide" title="Ask Dolly" aria-expanded="false" aria-controls="chat-panel"><svg class="chat-sheep" viewBox="0 0 100 84" aria-hidden="true" focusable="false">
<ellipse cx="49" cy="75" rx="36" ry="4" fill="#87b49a" opacity=".18"/>
<g class="sheep-grass" fill="none" stroke="#63975a" stroke-width="2" stroke-linecap="round"><path d="M15 74l-3-7m4 7 3-9m6 10-1-6m45 6 2-11m1 11 7-8m-1 9 5-5m-21 4-3-5"/></g>
<g fill="#80ad91" stroke="#376c52" stroke-width="1.5"><path d="M30 55v15q2 4 7 0V55m16 0v15q2 4 7 0V54"/></g>
<path class="sheep-tail" d="M24 43q-13-8-10 2 2 7 12 6" fill="#d7e8ce" stroke="#47795b" stroke-width="1.5"/>
<g class="sheep-body"><path d="M23 53C10 48 16 35 23 34 18 23 32 18 38 24 44 13 56 18 58 25 73 18 79 30 72 36 83 42 76 56 68 55 65 67 51 65 46 60 35 69 24 63 23 53Z" fill="#d7e8ce" stroke="#47795b" stroke-width="1.7"/><path d="M29 31q5-5 10-1m8-5q5-3 9 1m-31 17q-3 5 2 8m11 5q4 4 9 0" fill="none" stroke="#b4d0ae" stroke-width="2" stroke-linecap="round"/></g>
<g class="sheep-head"><path d="M63 39q9-7 16 2l2 15q-2 13-13 10-10-2-10-12Z" fill="#f7f8e8" stroke="#47795b" stroke-width="1.6"/><path d="M63 43q-15-3-11 5 5 7 12 1" fill="#9bc5a0" stroke="#47795b" stroke-width="1.4"/><path d="M62 39q-4-9 4-10 2-7 8-3 8-1 8 6 6 4 0 10-6 3-9-2-5 5-11-1Z" fill="#d7e8ce" stroke="#47795b" stroke-width="1.4"/><ellipse class="sheep-eye" cx="73" cy="49" rx="2" ry="2.7" fill="#294e3d"/><circle cx="73.6" cy="48.1" r=".65" fill="#fff"/><ellipse cx="77" cy="57" rx="3" ry="2" fill="#e8b6a5" opacity=".65"/><path class="sheep-chew" d="M69 62q4 3 8-1" fill="none" stroke="#47795b" stroke-width="1.3" stroke-linecap="round"/><path class="sheep-bite" d="m73 65 0 6m0-1-4-3m4 1 4-3" fill="none" stroke="#7aa64f" stroke-width="1.7" stroke-linecap="round"/></g>
</svg></button>
<div class="chat-nudge" role="status" hidden><button type="button" class="chat-nudge-open"><strong>Hi, I’m Dolly. How can I help?</strong><span>Ask me about the project or website.</span></button><button type="button" class="chat-nudge-dismiss" aria-label="Dismiss Dolly’s greeting">×</button></div>
<section id="chat-panel" class="chat-panel" aria-label="Dolly research guide" hidden>
<header class="chat-header"><div><strong>Dolly research guide</strong><span>Methods, findings & website help</span></div><button type="button" class="chat-close" aria-label="Close assistant">×</button></header>
<div class="chat-reading"><div class="chat-intro">Answers use reviewed project documentation, not live chart data. AI can make mistakes—check the cited sources.</div>
<div class="chat-messages" role="log" aria-label="Conversation" aria-live="polite"></div>
<div class="chat-starters"><button type="button">What does an m6A score mean?</button><button type="button">How does the v2 model work?</button><button type="button">How should I compare cell lines?</button></div>
</div><form class="chat-form"><label for="chat-question">Your question</label><textarea id="chat-question" rows="2" maxlength="1500" placeholder="Ask about Dolly…"></textarea><div id="chat-verification"></div><div class="chat-actions"><button type="button" class="chat-clear">Clear chat</button><button type="submit" class="chat-send">Send</button></div></form>
<p class="chat-status" role="status"></p><details class="chat-privacy"><summary>Privacy &amp; project guide</summary><p>Sending shares your question and recent chat with our backend and Google Gemini. Do not enter secrets or private data. Chat history is kept in this tab only. <a href="#methods">Read the guide</a></p></details>
</section>`;
document.body.append(root);
const el=s=>root.querySelector(s),launch=el('.chat-launch'),panel=el('.chat-panel'),input=el('textarea'),send=el('.chat-send'),status=el('.chat-status'),log=el('.chat-messages'),reading=el('.chat-reading');
let history=[],busy=false,token='',widget=null,scriptPromise;
let configured=false;
try{const u=new URL(chatConfig.endpoint);configured=u.protocol==='https:'&&u.pathname==='/chat'&&!!chatConfig.turnstileSiteKey;}catch{}
function sync(){el('#chat-verification').hidden=!!token;send.disabled=!configured||busy||!token;input.disabled=!configured||busy;el('.chat-clear').disabled=busy;root.querySelectorAll('.chat-starters button').forEach(b=>b.disabled=!configured||busy);}
function message(role,text){const box=document.createElement('article');box.className='chat-message '+role;const who=document.createElement('strong');who.textContent=role==='user'?'You':'Dolly';const body=document.createElement('div');body.textContent=text;box.append(who,body);log.append(box);root.classList.add('has-conversation');reading.scrollTop=reading.scrollHeight;return box;}
function show(open){if(open)dismissGreeting();panel.hidden=!open;launch.setAttribute('aria-expanded',String(open));if(open){if(configured){input.focus();verification();}else{el('.chat-close').focus();status.textContent='Not connected yet. The team is setting up the AI service. Home & guide is available now.';}}else launch.focus();}

// Show one short invitation per browser tab; never steal focus or repeat while chatting.
const greetingKey='dolly-guide-greeting-seen';
let greetingTimer=null,greetingHideTimer=null,greetingSeen=false;
try{greetingSeen=sessionStorage.getItem(greetingKey)==='1';}catch{}
function dismissGreeting(){
 clearTimeout(greetingTimer);clearTimeout(greetingHideTimer);el('.chat-nudge').hidden=true;greetingSeen=true;
 try{sessionStorage.setItem(greetingKey,'1');}catch{}
}
el('.chat-nudge-dismiss').addEventListener('click',dismissGreeting);
el('.chat-nudge-open').addEventListener('click',()=>show(true));
if(!greetingSeen)greetingTimer=setTimeout(()=>{
 if(!panel.hidden||document.hidden)return;
 el('.chat-nudge').hidden=false;
 try{sessionStorage.setItem(greetingKey,'1');}catch{}
 greetingHideTimer=setTimeout(dismissGreeting,6500);
},8000);

launch.addEventListener('click',()=>show(panel.hidden));el('.chat-close').addEventListener('click',()=>show(false));
root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){show(false);e.stopPropagation();}});
function verification(){
 if(widget!==null||!configured)return;
 if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{if(window.turnstile)return resolve();const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=resolve;s.onerror=reject;document.head.append(s);});
 scriptPromise.then(()=>{
  if(widget!==null)return;
  widget=window.turnstile.render(el('#chat-verification'),{sitekey:chatConfig.turnstileSiteKey,action:'dolly-chat',theme:'light',size:'flexible',callback:value=>{token=value;status.textContent='Ready to answer.';sync();},'expired-callback':()=>{token='';status.textContent='Please verify again to continue.';sync();},'error-callback':()=>{token='';status.textContent='Verification failed. Refresh the page to retry.';sync();}});
 }).catch(()=>{status.textContent='Verification could not load. Check your connection and refresh.';});
}
el('.chat-clear').addEventListener('click',()=>{history=[];log.replaceChildren();root.classList.remove('has-conversation');input.value='';status.textContent='Conversation cleared.';input.focus();});
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
  reading.scrollTop=reading.scrollHeight;
  // Limit retained context so a long session cannot grow request costs indefinitely.
  history=[...next,{role:'assistant',content:answer.slice(0,3000)}].slice(-4);
  status.textContent=data.truncated?'Answer reached its length limit. Ask a narrower follow-up.':'Check the sources before using an answer in your report.';
 }catch(error){status.textContent=error.name==='TimeoutError'?'The request timed out. Try again.':error.message;input.value=question;}
 finally{busy=false;token='';sync();if(widget!==null)window.turnstile.reset(widget);input.focus();}
});
sync();
