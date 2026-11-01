import { chatConfig } from './chat-config.js';
const root=document.createElement('div');root.id='dolly-assistant';
root.innerHTML=`<button type="button" class="chat-launch" aria-label="Ask Dolly — open or close the research guide" title="Ask Dolly" aria-expanded="false" aria-controls="chat-panel"><svg class="chat-sheep" viewBox="0 0 100 84" aria-hidden="true" focusable="false">
<ellipse cx="50" cy="76" rx="33" ry="4" fill="#87b49a" opacity=".18"/>
<g class="sheep-grass" fill="none" stroke="#699955" stroke-width="2" stroke-linecap="round"><path d="m19 76-3-7m4 7 4-9m8 10 0-6m35 6 2-9m8 8 4-8m-2 9 6-3m-42 3-4-7m17 7 4-7"/></g>
<g fill="#82b195" stroke="#3e7458" stroke-width="1.6"><path d="M33 58v13q2 5 8 0V58m18 0v13q2 5 8 0V58"/></g>
<g class="sheep-body"><path d="M24 55C11 51 15 36 24 34 17 24 29 15 38 21 42 10 56 10 61 21 73 13 85 24 78 34 91 40 86 55 76 56 73 68 59 68 52 61 42 71 28 66 24 55Z" fill="#d7e8ce" stroke="#47795b" stroke-width="1.7"/><path d="M27 30q4-5 10-1m28-2q5-2 8 3M22 43q-3 6 3 9m47 0q5-1 5-6" fill="none" stroke="#b4d0ae" stroke-width="2" stroke-linecap="round"/></g>
<g class="sheep-head">
<ellipse cx="29" cy="43" rx="11" ry="6" transform="rotate(23 29 43)" fill="#9ac6a0" stroke="#47795b" stroke-width="1.5"/><ellipse cx="71" cy="43" rx="11" ry="6" transform="rotate(-23 71 43)" fill="#9ac6a0" stroke="#47795b" stroke-width="1.5"/>
<path d="M32 36q18-12 36 0l-2 19q-1 14-16 15-15-1-16-15Z" fill="#f7f8e8" stroke="#47795b" stroke-width="1.6"/>
<path d="M32 37c-8-5-5-14 2-14 2-8 12-10 17-4 8-5 17 0 16 6 9 1 9 11 2 14-7 5-11-2-14-2-5 6-11 5-14 0-4 3-7 3-9 0Z" fill="#d7e8ce" stroke="#47795b" stroke-width="1.5"/>
<g class="sheep-eye"><ellipse cx="42" cy="48" rx="2.5" ry="3.5" fill="#294e3d"/><circle cx="42.7" cy="47" r=".8" fill="#fff"/></g><g class="sheep-eye"><ellipse cx="58" cy="48" rx="2.5" ry="3.5" fill="#294e3d"/><circle cx="58.7" cy="47" r=".8" fill="#fff"/></g>
<ellipse cx="38" cy="56" rx="4" ry="2.5" fill="#e8b6a5" opacity=".6"/><ellipse cx="62" cy="56" rx="4" ry="2.5" fill="#e8b6a5" opacity=".6"/>
<path d="M46 56q4-2 8 0l-4 4Z" fill="#47795b"/><path class="sheep-chew" d="M50 60v2m-5 1q3 4 5 0 2 4 5 0" fill="none" stroke="#47795b" stroke-width="1.3" stroke-linecap="round"/>
<path class="sheep-bite" d="m50 66-1 8m1-4-5-3m5 4 5-4" fill="none" stroke="#6b9c46" stroke-width="1.8" stroke-linecap="round"/>
</g></svg></button>
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
function sync(){send.textContent=busy?'Thinking…':'Send';el('form').setAttribute('aria-busy',String(busy));el('#chat-verification').hidden=!!token;send.disabled=!configured||busy||!token;input.disabled=!configured||busy;el('.chat-clear').disabled=busy;root.querySelectorAll('.chat-starters button').forEach(b=>b.disabled=!configured||busy);}

// Render a small Markdown subset using DOM nodes only; model HTML stays literal text.
function appendInline(parent,text){
 const pattern=/\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;let cursor=0,match;
 while((match=pattern.exec(text))){
  parent.append(document.createTextNode(text.slice(cursor,match.index)));
  const node=document.createElement(match[1]!==undefined?'strong':'code');node.textContent=match[1]??match[2];parent.append(node);cursor=pattern.lastIndex;
 }
 parent.append(document.createTextNode(text.slice(cursor)));
}
function formatAnswer(parent,text){
 parent.classList.add('chat-answer');let paragraph=null,list=null,listType=null;
 for(const line of text.replace(/\r\n?/g,'\n').split('\n')){
  if(!line.trim()){paragraph=null;list=null;listType=null;continue;}
  const bullet=line.match(/^\s*[-*•]\s+(.+)$/),number=line.match(/^\s*(\d+)[.)]\s+(.+)$/),heading=line.match(/^#{1,4}\s+(.+)$/);
  if(bullet||number){
   const type=bullet?'ul':'ol';
   if(!list||listType!==type){list=document.createElement(type);if(number)list.start=Number(number[1]);parent.append(list);listType=type;}
   const item=document.createElement('li');appendInline(item,bullet?bullet[1]:number[2]);list.append(item);paragraph=null;
  }else{
   list=null;listType=null;
   if(heading){const p=document.createElement('p'),strong=document.createElement('strong');appendInline(strong,heading[1]);p.append(strong);parent.append(p);paragraph=null;}
   else{if(!paragraph){paragraph=document.createElement('p');parent.append(paragraph);}else paragraph.append(document.createElement('br'));appendInline(paragraph,line);}
  }
 }
}

function message(role,text){const box=document.createElement('article');box.className='chat-message '+role;const who=document.createElement('strong');who.textContent=role==='user'?'You':'Dolly';const body=document.createElement('div');if(role==='assistant')formatAnswer(body,text);else body.textContent=text;box.append(who,body);log.append(box);root.classList.add('has-conversation');reading.scrollTop=reading.scrollHeight;return box;}

function loadingMessage(){
 const box=document.createElement('article');box.className='chat-message assistant chat-loading';box.setAttribute('role','status');box.setAttribute('aria-atomic','true');
 const name=document.createElement('strong');name.textContent='Dolly';
 const row=document.createElement('div');row.className='chat-loading-row';
 const dots=document.createElement('span');dots.className='chat-loading-dots';dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)dots.append(document.createElement('i'));
 const label=document.createElement('span');label.textContent='Dolly is thinking…';row.append(dots,label);
 const note=document.createElement('p');note.className='chat-loading-note';note.textContent='Preparing your answer. You can keep reading the conversation.';
 box.append(name,row,note);log.append(box);reading.scrollTop=reading.scrollHeight;
 const timer=setTimeout(()=>{label.textContent='Still working on your answer…';note.textContent='This is taking a little longer. Please keep this chat open.';},10000);
 return ()=>{clearTimeout(timer);box.remove();};
}

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
 message('user',question);input.value='';busy=true;sync();status.textContent='Dolly is preparing your answer…';const stopLoading=loadingMessage();
 try{
  const response=await fetch(chatConfig.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:next,turnstileToken:token}),signal:AbortSignal.timeout(65000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The assistant is temporarily unavailable.');
  if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('No answer was returned.');
  stopLoading();
  const answer=data.answer.slice(0,6000),box=message('assistant',answer);
  if(Array.isArray(data.sources)&&data.sources.length){const refs=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Project sources';refs.append(summary);for(const source of data.sources){if(!/^S[1-6]$/.test(source.id)||typeof source.title!=='string'||typeof source.path!=='string')continue;const p=document.createElement('p');p.textContent=`[${source.id}] ${source.title} — ${source.path}`;refs.append(p);}box.append(refs);}
  reading.scrollTop=reading.scrollHeight;
  // Limit retained context so a long session cannot grow request costs indefinitely.
  history=[...next,{role:'assistant',content:answer.slice(0,3000)}].slice(-4);
  status.textContent=data.truncated?'Answer reached its length limit. Ask a narrower follow-up.':'Check the sources before using an answer in your report.';
 }catch(error){status.textContent=error.name==='TimeoutError'?'The request timed out. Try again.':error.message;input.value=question;}
 finally{stopLoading();busy=false;token='';sync();if(widget!==null)window.turnstile.reset(widget);input.focus();}
});
sync();
