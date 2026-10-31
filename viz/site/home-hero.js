// Textured, depth-sorted RNA surface. Artistic geometry; no sample data.
const root=document.querySelector('.landing-hero');
const art=document.getElementById('rna-ribbon-art');
const links=[...root.querySelectorAll('[data-strand-link]')];
const motion=document.getElementById('hero-motion');
const word=document.getElementById('hero-word');
const preference=matchMedia('(prefers-reduced-motion: reduce)');
let paused=preference.matches,visible=true,held=false,phase=.5,last=0,wordClock=0,index=0,renderClock=0;
const words=['cell lines.','transcripts.','sequencing runs.'];
const NS='http://www.w3.org/2000/svg';
function element(tag,attrs){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;}
// Procedural textured surface: a cinematic RNA illustration, not atomic coordinates.
const defs=document.querySelector('#rna-ribbon defs');
for(const [name,stops] of Object.entries({surface:['#eff8ff','#8faac5','#354c6c','#14253e'],accent:['#c7f4fa','#6cb6ce','#30546d','#1a3048']})){
 const g=element('radialGradient',{id:'surface-'+name,cx:'25%',cy:'20%',r:'80%'});
 stops.forEach((c,i)=>g.append(element('stop',{offset:[0,.18,.62,1][i],'stop-color':c})));defs.append(g);
}
const mesh=[];
const noise=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
function project(x,y,z){const depth=z*.95+(y-298)*.10,scale=760/(760+depth);return{x:280+x*scale,y:298+(y-298)*scale,z:depth,scale};}
function raw(t){const a=t*Math.PI*3.5+phase;return{x:Math.sin(a)*91+(t-.5)*22,y:45+t*505,z:Math.cos(a)*85,a};}
function point(t){const p=raw(t);return project(p.x,p.y,p.z);}
function sphere(position,r,seed,accent=false){
 const n=element('circle',{fill:'url(#surface-'+(accent?'accent':'surface')+')'});art.append(n);
 mesh.push({n,position,r:r*(.84+noise(seed)*.3)});
}
// Close-packed, irregular surface clusters replace the smooth ribbon and stick diagrams.
for(let i=0;i<106;i++){
 const t=i/105;
 for(let j=0;j<5;j++){
  const seed=i*17+j,theta=j*Math.PI*2/5+noise(i)*.7,rad=5.8+noise(seed)*2.3;
  sphere(()=>{const p=raw(t);return{x:p.x+Math.cos(theta+phase)*rad,y:p.y+(noise(seed+5)-.5)*4,z:p.z+Math.sin(theta+phase)*rad};},4.6,seed);
 }
}
// Short, unpaired protrusions sweep towards the helix axis, as in the visual reference.
for(let i=0;i<23;i++){
 const t=(i+.5)/23,length=40+noise(i+803)*21;
 for(let step=0;step<11;step++){
  const u=step/10;
  for(let j=0;j<3;j++){
   const seed=3000+i*97+step*3+j,theta=j*Math.PI*2/3+noise(seed)*.8;
   sphere(()=>{const p=raw(t),bend=Math.sin(u*Math.PI)*5;return{x:p.x-Math.sin(p.a)*length*u+Math.cos(p.a)*(Math.cos(theta+phase)*3.3+bend),y:p.y-u*8+Math.sin(theta)*3.4,z:p.z-Math.cos(p.a)*length*u-Math.sin(p.a)*(Math.cos(theta+phase)*3.3+bend)};},3.6,seed,i%7===0&&step>7);
  }
 }
}
const connectors=links.map(()=>{const n=element('path',{fill:'none',stroke:'#c2d9ee','stroke-width':'.8',opacity:'.32'});art.append(n);return n;});
function render(){
 for(const m of mesh){const p=m.position(),q=project(p.x,p.y,p.z);m.z=q.z;m.n.setAttribute('cx',q.x);m.n.setAttribute('cy',q.y);m.n.setAttribute('r',m.r*q.scale);m.n.setAttribute('opacity',Math.max(.5,Math.min(1,.86-q.z*.0017)));}
 mesh.sort((a,b)=>b.z-a.z).forEach(m=>art.append(m.n));
 links.forEach((link,i)=>{const p=point(.12+i*.14),side=i%2===0?-1:1,x=280+side*120+(p.x-280)*.19;link.style.setProperty('--link-x',`${x/560*100}%`);link.style.setProperty('--link-y',`${p.y/600*100}%`);const near=x-side*76;connectors[i].setAttribute('d',`M${p.x},${p.y}Q${(p.x+near)/2},${p.y-12} ${near},${p.y}`);art.append(connectors[i]);});
}
function sync(){motion.textContent=paused?'Resume rotation':'Pause rotation';motion.setAttribute('aria-pressed',String(paused));if(paused)word.textContent=words[index];}
motion.addEventListener('click',()=>{paused=!paused;sync();});preference.addEventListener('change',()=>{paused=preference.matches;sync();});
links.forEach(link=>{link.addEventListener('pointerenter',()=>{held=true;});link.addEventListener('pointerleave',()=>{held=!!root.querySelector('.rna-nav-link:focus-visible');});link.addEventListener('focus',()=>{held=true;});link.addEventListener('blur',()=>{held=!!root.querySelector('.rna-nav-link:hover');});});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}).observe(root);
function frame(now){const dt=Math.min((now-last)/1000,.04)||.016;last=now;if(visible&&!document.hidden&&!paused){if(!held){phase+=dt*.24;renderClock+=dt;if(renderClock>=1/30){renderClock=0;render();}}wordClock+=dt;if(wordClock>=4.2){wordClock=0;index=(index+1)%words.length;}const next=words[(index+1)%words.length];word.textContent=wordClock<2.7?words[index]:wordClock<3.2?words[index].slice(0,Math.max(0,Math.ceil(words[index].length*(3.2-wordClock)/.5))):next.slice(0,Math.floor(next.length*Math.min(1,(wordClock-3.2)/.7)));}requestAnimationFrame(frame);}
sync();render();requestAnimationFrame(frame);
