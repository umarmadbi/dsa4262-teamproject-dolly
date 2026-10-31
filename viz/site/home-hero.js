// Homepage illustrations only. No external dependencies or sample-data requests.
const hero = document.querySelector('.dolly-hero');
const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let mode = 'rna', paused = reduced.matches, visible = true, angle = -.25, tilt = -.15, swing = 0, velocity = 0, flipped = false;
let drag = null, topic = 'modification', last = 0, elapsed = 0, wordIndex = 0, wordTime = 0;
const words = ['cell lines.', 'transcripts.', 'sequencing runs.'];
const topics = {
 modification: ['01', 'A small change to an RNA base.', 'm6A is a methyl modification of adenosine in RNA. This strand is an illustration, not a measured molecular structure.'],
 score: ['02', 'A prediction is a starting point.', 'A high Dolly score suggests model evidence for m6A. It is not proof of modification or the fraction of modified reads.'],
 coverage: ['03', 'More context for every candidate.', 'Coverage counts reads spanning a site. Check coverage and consistency before interpreting score differences; coverage is not gene expression.']
};
function note(values) { ['hero-note-number','hero-note-title','hero-note-text'].forEach((id,i) => $(id).textContent = values[i]); }
function selectTopic(key) { topic = key; note(topics[key]); document.querySelectorAll('[data-rna-topic]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.rnaTopic===key))); }
function motionLabel() { $('hero-motion').textContent = paused ? 'Resume motion' : 'Pause motion'; $('hero-motion').setAttribute('aria-pressed',String(paused)); }
function switchMode(next) {
 mode=next; hero.dataset.mode=mode; $('rna-scene').hidden=mode!=='rna'; $('pass-scene').hidden=mode!=='pass';
 document.querySelectorAll('[data-hero-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.heroMode===mode)));
 $('hero-object-title').textContent=mode==='rna'?'A MOLECULE OF POSSIBILITY':'YOUR PASS TO THE BIGGER PICTURE';
 $('hero-gesture').textContent=mode==='rna'?'↔ Drag to rotate · Select a numbered site':'↔ Drag to swing · Click to flip';
 if(mode==='rna')selectTopic(topic);else note(['↻','A research companion, with a playful side.','Drag the pass to set it swinging. Click or press Enter to flip it. The guide and all your data views stay right here.']);
 drag=null; resize();
}
document.querySelectorAll('[data-hero-mode]').forEach(b=>b.addEventListener('click',()=>switchMode(b.dataset.heroMode)));
document.querySelectorAll('[data-rna-topic]').forEach(b=>b.addEventListener('click',()=>selectTopic(b.dataset.rnaTopic)));
$('hero-motion').addEventListener('click',()=>{paused=!paused;velocity=0;if(paused)$('hero-word').textContent=words[wordIndex];motionLabel();});
reduced.addEventListener('change',()=>{paused=reduced.matches;velocity=0;if(paused)$('hero-word').textContent=words[wordIndex];motionLabel();});
$('hero-reset').addEventListener('click',()=>{angle=-.25;tilt=-.15;swing=0;velocity=0;flipped=false;$('research-pass').classList.remove('is-flipped');$('research-pass').setAttribute('aria-pressed','false');selectTopic('modification');if(mode==='pass')switchMode('pass');});
document.querySelector('.hero-guide-link').addEventListener('click',e=>{e.preventDefault();const guide=$('home-practical-guide');guide.scrollIntoView({behavior:reduced.matches?'instant':'smooth'});guide.tabIndex=-1;guide.focus({preventScroll:true});});
const canvas=$('rna-canvas'), ctx=canvas.getContext('2d');
let w=400,h=380,hits=[];
function resize(){if(mode!=='rna')return;const r=canvas.getBoundingClientRect();if(!r.width)return;w=r.width;h=r.height;const d=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);ctx?.setTransform(d,0,0,d,0,0);}
new ResizeObserver(resize).observe(canvas);
function project(x,y,z){const ca=Math.cos(angle),sa=Math.sin(angle),ct=Math.cos(tilt),st=Math.sin(tilt);const px=x*ca+z*sa,pz=-x*sa+z*ca;const py=y*ct-pz*st,depth=y*st+pz*ct;const scale=620/(620+depth);return{x:w/2+px*scale,y:h/2+py*scale,z:depth,scale};}
function draw(){if(!ctx)return;ctx.clearRect(0,0,w,h);const k=Math.min(w/390,h/370),points=[];for(let i=0;i<36;i++){const t=i/35;const a=t*Math.PI*3.3;points.push(project(Math.sin(a)*72*k,(t-.5)*285*k,Math.cos(a)*65*k));}
 // Single helical backbone: a stylised RNA strand, not double-stranded DNA.
 ctx.lineCap='round';for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];ctx.strokeStyle=b.z>0?'#9eb69a':'#526f51';ctx.lineWidth=6*k*b.scale;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
 const labels=['A','U','G','C'];const markers={7:['modification','01'],18:['score','02'],29:['coverage','03']};hits=[];
 [...points.entries()].sort((a,b)=>b[1].z-a[1].z).forEach(([i,p])=>{const marker=markers[i],r=(marker?13:7)*k*p.scale;const gradient=ctx.createRadialGradient(p.x-r*.35,p.y-r*.4,0,p.x,p.y,r);gradient.addColorStop(0,marker?'#f1e6b8':'#d4e4bb');gradient.addColorStop(1,marker?'#b89140':'#7c9a6c');ctx.fillStyle=gradient;ctx.shadowColor='#304d3333';ctx.shadowBlur=8*k;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;if(i%3===0&&!marker){ctx.font=`${9*k*p.scale}px ui-monospace,monospace`;ctx.fillStyle='#355c3e';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(labels[i%4],p.x+25*k,p.y);ctx.strokeStyle='#adbea1';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x+r,p.y);ctx.lineTo(p.x+17*k,p.y);ctx.stroke();}if(marker){hits.push({...p,key:marker[0],r:Math.max(r,22)});ctx.font=`600 ${9*k}px system-ui`;ctx.fillStyle='#4c512d';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(marker[1],p.x,p.y);if(marker[0]===topic){ctx.strokeStyle='#a89558';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,r+6,0,Math.PI*2);ctx.stroke();}}});
}
function flip(){flipped=!flipped;$('research-pass').classList.toggle('is-flipped',flipped);$('research-pass').setAttribute('aria-pressed',String(flipped));}
const pass=$('research-pass');
function start(e,type){if(e.button!==0)return;drag={type,id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}
function move(e){if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>6)drag.moved=true;const delta=e.clientX-drag.lastX;drag.lastX=e.clientX;if(drag.type==='rna'){angle+=delta*.012;tilt=Math.max(-.65,Math.min(.65,tilt+e.movementY*.003));}else{swing=Math.max(-32,Math.min(32,swing+delta*.23));velocity=paused?0:Math.max(-1.8,Math.min(1.8,delta*.045));}}
function end(e){if(!drag||drag.id!==e.pointerId)return;const d=drag;drag=null;if(e.type==='pointercancel')return;if(!d.moved&&d.type==='rna'){const r=canvas.getBoundingClientRect();const hit=hits.find(p=>Math.hypot(p.x-(e.clientX-r.left),p.y-(e.clientY-r.top))<p.r);if(hit)selectTopic(hit.key);} }
[canvas,pass].forEach((el,i)=>{el.addEventListener('pointerdown',e=>start(e,i?'pass':'rna'));el.addEventListener('pointermove',move);el.addEventListener('pointerup',e=>{const moved=drag?.moved;end(e);if(i&&moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);}});el.addEventListener('pointercancel',end);el.addEventListener('lostpointercapture',()=>{drag=null;});});
let suppressClick=false;pass.addEventListener('click',()=>{if(!suppressClick)flip();});
canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')angle-=.15;if(e.key==='ArrowRight')angle+=.15;if(e.key==='ArrowUp')tilt=Math.max(-.65,tilt-.1);if(e.key==='ArrowDown')tilt=Math.min(.65,tilt+.1);}});
pass.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();swing=Math.max(-32,Math.min(32,swing+(e.key==='ArrowLeft'?-8:8)));velocity=0;}});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;},{threshold:0}).observe(hero);
function frame(now){const dt=Math.min((now-last)/1000,.04)||.016;last=now;if(visible&&!document.hidden){if(!paused){elapsed+=dt;wordTime+=dt;if(wordTime>=4.2){wordTime=0;wordIndex=(wordIndex+1)%words.length;}const nextWord=words[(wordIndex+1)%words.length];$('hero-word').textContent=wordTime<2.7?words[wordIndex]:wordTime<3.2?words[wordIndex].slice(0,Math.max(0,Math.ceil(words[wordIndex].length*(3.2-wordTime)/.5))):nextWord.slice(0,Math.floor(nextWord.length*Math.min(1,(wordTime-3.2)/.7)));if(!drag){angle+=dt*.18;velocity+=(-swing*.015-velocity*.065)*dt*60;swing+=velocity*dt*60;}}
 if(mode==='rna')draw();else $('pass-scene').querySelector('.pass-rig').style.transform=`rotateZ(${swing+(paused?0:Math.sin(elapsed*.9)*3)}deg) rotateY(${paused?0:Math.sin(elapsed*.7)*9}deg)`;}
 requestAnimationFrame(frame);}
motionLabel();resize();requestAnimationFrame(frame);
