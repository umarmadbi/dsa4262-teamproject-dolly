import {createMolecularModel} from './home-molecule.js';
// Continuous textured RNA tubes. Artistic geometry; no sample data.
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
// Small atmospheric particles belong only to Home and share its motion controls.
const particleField=document.createElement('div');particleField.className='home-particles';particleField.setAttribute('aria-hidden','true');
const homePage=root.closest('#page-home');
document.body.prepend(particleField);
// Particle coordinates use viewport pixels and elapsed time only, never scroll offsets.
const particleCanvas=document.createElement('canvas');particleField.append(particleCanvas);
const particleContext=particleCanvas.getContext('2d');
let particleWidth=0,particleHeight=0,particleTime=0,particleLast=0;
const particles=Array.from({length:56},(_,i)=>{
 const random=n=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x);};
 return{x:random(i+1),y:random(i+47),radius:1.3+random(i+83)*1.5,speed:10+random(i+131)*14,drift:7+random(i+181)*10,phase:random(i+241)*Math.PI*2,alpha:.38+random(i+291)*.3};
});
function resizeParticles(){
 particleWidth=window.innerWidth;particleHeight=window.innerHeight;
 const ratio=Math.min(window.devicePixelRatio||1,2);
 particleCanvas.width=Math.round(particleWidth*ratio);particleCanvas.height=Math.round(particleHeight*ratio);
 particleContext?.setTransform(ratio,0,0,ratio,0,0);
}
window.addEventListener('resize',resizeParticles);resizeParticles();
function syncParticles(){const active=homePage.classList.contains('active');particleField.hidden=!active;particleField.dataset.paused=String(paused||!active||document.hidden);}
new MutationObserver(syncParticles).observe(homePage,{attributes:true,attributeFilter:['class']});
document.addEventListener('visibilitychange',syncParticles);
function drawParticles(){
 if(!particleContext)return;
 particleContext.clearRect(0,0,particleWidth,particleHeight);
 const count=particleWidth<760?34:particles.length;
 for(let i=0;i<count;i++){
  const p=particles[i],span=particleHeight+60;
  const x=(p.x*particleWidth+Math.sin(particleTime*.32+p.phase)*p.drift+particleWidth)%particleWidth;
  const y=((p.y*span-particleTime*p.speed)%span+span)%span-30;
  particleContext.globalAlpha=p.alpha;particleContext.fillStyle=i%4===0?'#3b994d':'#238449';
  particleContext.beginPath();particleContext.arc(x,y,p.radius,0,Math.PI*2);particleContext.fill();
 }
 particleContext.globalAlpha=1;
}
function particleFrame(now){
 const dt=particleLast?Math.min((now-particleLast)/1000,.05):0;particleLast=now;
 if(particleField.dataset.paused!=='true'&&!document.hidden){particleTime+=dt;drawParticles();}
 requestAnimationFrame(particleFrame);
}
drawParticles();requestAnimationFrame(particleFrame);
// Continuous tubular surfaces with procedural relief; illustrative, not structural data.
const defs=document.querySelector('#rna-ribbon defs');
const filter=element('filter',{id:'rna-surface-relief',x:'-10%',y:'-10%',width:'120%',height:'120%','color-interpolation-filters':'sRGB'});
filter.append(element('feTurbulence',{type:'fractalNoise',baseFrequency:'.12 .18',numOctaves:'3',seed:'19',result:'grain'}));
const lighting=element('feDiffuseLighting',{in:'grain',surfaceScale:'2.2',diffuseConstant:'.95','lighting-color':'#e1f1e7',result:'relief'});
lighting.append(element('feDistantLight',{azimuth:'225',elevation:'48'}));filter.append(lighting);
const soften=element('feComponentTransfer',{in:'relief',result:'soft-relief'});for(const channel of ['R','G','B'])soften.append(element('feFunc'+channel,{type:'linear',slope:'.55',intercept:'.45'}));filter.append(soften);
filter.append(element('feComposite',{in:'soft-relief',in2:'SourceGraphic',operator:'in',result:'clipped-relief'}));
filter.append(element('feBlend',{in:'SourceGraphic',in2:'clipped-relief',mode:'multiply',result:'lit'}));
filter.append(element('feDisplacementMap',{in:'lit',in2:'grain',scale:'2.2',xChannelSelector:'R',yChannelSelector:'G'}));defs.append(filter);
const gradient=element('linearGradient',{id:'rna-tube-light',x1:'0%',y1:'0%',x2:'100%',y2:'45%'});
[['0%','#c5e3d4'],['24%','#8cbaa7'],['53%','#416f64'],['78%','#a0c4af'],['100%','#2d584e']].forEach(([offset,color])=>gradient.append(element('stop',{offset,'stop-color':color})));defs.append(gradient);
const surface=element('g',{filter:'url(#rna-surface-relief)'});art.append(surface);
function project(x,y,z){const depth=z*.95+(y-298)*.10,scale=760/(760+depth);return{x:280+x*scale,y:298+(y-298)*scale,z:depth,scale};}
function raw(t){const a=t*Math.PI*3.5+phase;return{x:Math.sin(a)*91+(t-.5)*22,y:45+t*505,z:Math.cos(a)*85,a};}
function point(t){const p=raw(t);return project(p.x,p.y,p.z);}
function tube(width){
 const n=element('g',{fill:'none','stroke-linecap':'round','stroke-linejoin':'round'});
 const outer=element('path',{stroke:'#234e45','stroke-width':width});
 const body=element('path',{stroke:'url(#rna-tube-light)','stroke-width':width*.87});
 const rim=element('path',{stroke:'#d0e7d8','stroke-width':width*.2,opacity:'.7'});
 n.append(outer,body,rim);surface.append(n);return{n,outer,body,rim,width};
}
const backbone=tube(20);
const bases=Array.from({length:23},(_,i)=>({...tube(10.5+(i%3)),t:(i+.5)/23,length:49+Math.sin(i*4.1)*12}));
const connectors=links.map(()=>{const n=element('path',{fill:'none',stroke:'#718f80','stroke-width':'.8',opacity:'.32'});art.append(n);return n;});
const molecule=createMolecularModel(art);let strandMode='textured';
function drawTube(tube,points,scale=1){
 const path=points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join('');
 tube.outer.setAttribute('d',path);tube.body.setAttribute('d',path);
 tube.rim.setAttribute('d',points.map((p,i)=>`${i?'L':'M'}${p.x-tube.width*.18*scale},${p.y-tube.width*.12*scale}`).join(''));
 tube.outer.setAttribute('stroke-width',tube.width*scale);tube.body.setAttribute('stroke-width',tube.width*.87*scale);tube.rim.setAttribute('stroke-width',tube.width*.2*scale);
}
function render(){
 const molecular=strandMode==='molecular';surface.setAttribute('display',molecular?'none':'inline');molecule.group.setAttribute('display',molecular?'inline':'none');
 if(molecular){molecule.render(phase);}else{
 drawTube(backbone,Array.from({length:151},(_,i)=>point(i/150)));
 for(const b of bases){const p=raw(b.t);b.z=p.z;const points=Array.from({length:15},(_,j)=>{const u=j/14,bend=Math.sin(u*Math.PI)*5;return project(p.x-Math.sin(p.a)*b.length*u+Math.cos(p.a)*bend,p.y-u*8,p.z-Math.cos(p.a)*b.length*u-Math.sin(p.a)*bend);});drawTube(b,points,points[0].scale);b.n.setAttribute('opacity',.84-p.z*.001);}
 // Back-facing protrusions sit behind the continuous backbone; near ones sit in front.
 bases.filter(b=>b.z>=0).sort((a,b)=>b.z-a.z).forEach(b=>surface.append(b.n));surface.append(backbone.n);
 bases.filter(b=>b.z<0).sort((a,b)=>b.z-a.z).forEach(b=>surface.append(b.n));
 }
 links.forEach((link,i)=>{const p=point(.12+i*.14),side=i%2===0?-1:1,x=280+side*120+(p.x-280)*.19;link.style.setProperty('--link-x',`${x/560*100}%`);link.style.setProperty('--link-y',`${p.y/600*100}%`);const near=x-side*76;connectors[i].setAttribute('d',`M${p.x},${p.y}Q${(p.x+near)/2},${p.y-12} ${near},${p.y}`);});
}
const preview=document.createElement('div');preview.className='strand-preview-bar';
preview.innerHTML='<span>COMPARE STRAND STYLES</span><div class="strand-preview-tabs" role="group" aria-label="RNA strand preview"><button type="button" data-strand-mode="textured" aria-pressed="true">01 · Textured strand</button><button type="button" data-strand-mode="molecular" aria-pressed="false">02 · Molecular model</button></div>';
root.before(preview);
preview.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{strandMode=button.dataset.strandMode;preview.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();}));
function sync(){motion.textContent=paused?'Resume motion':'Pause motion';syncParticles();motion.setAttribute('aria-pressed',String(paused));if(paused)word.textContent=words[index];}
motion.addEventListener('click',()=>{paused=!paused;sync();});preference.addEventListener('change',()=>{paused=preference.matches;sync();});
links.forEach(link=>{link.addEventListener('pointerenter',()=>{held=true;});link.addEventListener('pointerleave',()=>{held=!!root.querySelector('.rna-nav-link:focus-visible');});link.addEventListener('focus',()=>{held=true;});link.addEventListener('blur',()=>{held=!!root.querySelector('.rna-nav-link:hover');});});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;syncParticles();}).observe(root);
function frame(now){const dt=Math.min((now-last)/1000,.04)||.016;last=now;if(visible&&!document.hidden&&!paused){if(!held){phase+=dt*.24;renderClock+=dt;if(renderClock>=1/30){renderClock=0;render();}}wordClock+=dt;if(wordClock>=4.2){wordClock=0;index=(index+1)%words.length;}const next=words[(index+1)%words.length];word.textContent=wordClock<2.7?words[index]:wordClock<3.2?words[index].slice(0,Math.max(0,Math.ceil(words[index].length*(3.2-wordClock)/.5))):next.slice(0,Math.floor(next.length*Math.min(1,(wordClock-3.2)/.7)));}requestAnimationFrame(frame);}
sync();render();requestAnimationFrame(frame);
