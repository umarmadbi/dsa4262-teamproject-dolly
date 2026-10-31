// A projected ribbon-style single RNA strand. Illustration only; no sample data.
const root=document.querySelector('.landing-hero');
const art=document.getElementById('rna-ribbon-art');
const links=[...root.querySelectorAll('[data-strand-link]')];
const motion=document.getElementById('hero-motion');
const word=document.getElementById('hero-word');
const preference=matchMedia('(prefers-reduced-motion: reduce)');
let paused=preference.matches,visible=true,held=false,phase=.5,last=0,wordClock=0,index=0;
const words=['cell lines.','transcripts.','sequencing runs.'];
const colors=['#9ec958','#f49a46','#5b89a5','#e4cf62'];
const NS='http://www.w3.org/2000/svg';
function element(tag,attrs){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;}
const mesh=[];
// Continuous ribbon strips, plus coloured bases projecting towards the helix axis.
for(let i=0;i<100;i++){const n=element('path',{});art.append(n);mesh.push({n,t:i/100,kind:'ribbon'});}
for(let i=0;i<22;i++){const n=element('path',{'stroke-linejoin':'round'});art.append(n);mesh.push({n,t:(i+.5)/22,kind:'base',i});}
const connectors=links.map((_,i)=>{const n=element('path',{fill:'none',stroke:'#9bb29d','stroke-width':'1','stroke-dasharray':'3 4',opacity:'.65'});art.append(n);return n;});
function point(t){const a=t*Math.PI*3.8+phase;const z=Math.cos(a)*65;const scale=650/(650+z);return {x:280+Math.sin(a)*91*scale,y:43+t*510,z,scale,a};}
function edge(p,sign){const dx=Math.cos(p.a)*91*Math.PI*3.8,dy=510;const length=Math.hypot(dx,dy);return {x:p.x+sign*(-dy/length)*15*p.scale,y:p.y+sign*(dx/length)*15*p.scale};}
function render(){
 for(const m of mesh){const p=point(m.t);m.z=p.z;if(m.kind==='ribbon'){const q=point(m.t+.0108),a=edge(p,-1),b=edge(p,1),c=edge(q,1),d=edge(q,-1);m.n.setAttribute('d',`M${a.x},${a.y} L${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}Z`);const light=Math.round(49+(1-p.z/65)*12);m.n.setAttribute('fill',`hsl(204 43% ${light}%)`);m.n.setAttribute('stroke',`hsl(204 43% ${light}%)`);m.n.setAttribute('stroke-width','.6');}else{const endX=280+(p.x-280)*.2;const top=p.y-5,bottom=p.y+5,tip=endX+(endX<p.x?-7:7);m.n.setAttribute('d',`M${p.x},${top} L${endX},${top} ${tip},${p.y} ${endX},${bottom} ${p.x},${bottom}Z`);m.n.setAttribute('fill',colors[m.i%4]);}}
 // Far segments paint first, giving the ribbon and bases depth as they rotate.
 mesh.sort((a,b)=>b.z-a.z).forEach(m=>art.append(m.n));
 links.forEach((link,i)=>{const t=.12+i*.14,p=point(t),side=i%2===0?-1:1;const x=280+side*120+(p.x-280)*.19;link.style.setProperty('--link-x',`${x/560*100}%`);link.style.setProperty('--link-y',`${p.y/600*100}%`);const near=x-side*76;connectors[i].setAttribute('d',`M${p.x},${p.y}Q${(p.x+near)/2},${p.y-12} ${near},${p.y}`);art.append(connectors[i]);});
}
function sync(){motion.textContent=paused?'Resume rotation':'Pause rotation';motion.setAttribute('aria-pressed',String(paused));if(paused)word.textContent=words[index];}
motion.addEventListener('click',()=>{paused=!paused;sync();});preference.addEventListener('change',()=>{paused=preference.matches;sync();});
links.forEach(link=>{link.addEventListener('pointerenter',()=>{held=true;});link.addEventListener('pointerleave',()=>{held=!!root.querySelector('.rna-nav-link:focus-visible');});link.addEventListener('focus',()=>{held=true;});link.addEventListener('blur',()=>{held=!!root.querySelector('.rna-nav-link:hover');});});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}).observe(root);
function frame(now){const dt=Math.min((now-last)/1000,.04)||.016;last=now;if(visible&&!document.hidden&&!paused){if(!held){phase+=dt*.34;render();}wordClock+=dt;if(wordClock>=4.2){wordClock=0;index=(index+1)%words.length;}const next=words[(index+1)%words.length];word.textContent=wordClock<2.7?words[index]:wordClock<3.2?words[index].slice(0,Math.max(0,Math.ceil(words[index].length*(3.2-wordClock)/.5))):next.slice(0,Math.floor(next.length*Math.min(1,(wordClock-3.2)/.7)));}requestAnimationFrame(frame);}
sync();render();requestAnimationFrame(frame);
