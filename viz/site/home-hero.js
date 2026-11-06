// Continuous textured RNA tubes. Artistic geometry; no sample data.
const root=document.querySelector('.landing-hero');
const art=document.getElementById('rna-ribbon-art');
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
// Particle coordinates belong to the document background, so they scroll away with Home.
const particleCanvas=document.createElement('canvas');particleField.append(particleCanvas);
const particleContext=particleCanvas.getContext('2d');
let particleWidth=0,particleHeight=0,particleTime=0,particleLast=0;
const particles=Array.from({length:56},(_,i)=>{
 const random=n=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x);};
 return{x:random(i+1),y:random(i+47),radius:1.3+random(i+83)*1.5,speed:10+random(i+131)*14,drift:7+random(i+181)*10,phase:random(i+241)*Math.PI*2,alpha:.38+random(i+291)*.3};
});
function resizeParticles(){
 particleWidth=document.documentElement.clientWidth||window.innerWidth;
 const shell=document.querySelector('.shell');
 particleHeight=Math.max(window.innerHeight,shell?.getBoundingClientRect().height||0);
 const ratio=Math.min(window.devicePixelRatio||1,2);
 particleCanvas.width=Math.round(particleWidth*ratio);particleCanvas.height=Math.round(particleHeight*ratio);
 particleContext?.setTransform(ratio,0,0,ratio,0,0);
 drawParticles();
}
window.addEventListener('resize',resizeParticles);resizeParticles();
new ResizeObserver(resizeParticles).observe(document.querySelector('.shell'));
function syncParticles(){const active=homePage.classList.contains('active');particleField.hidden=!active;particleField.dataset.paused=String(paused||!active||document.hidden);if(active)resizeParticles();}
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
let tilt=0;
function project(x,y,z){if(strandMode==='interactive'){const cy=y-298,c=Math.cos(tilt),s=Math.sin(tilt);y=298+cy*c-z*s;z=cy*s+z*c;}const depth=z*.95+(y-298)*.10,scale=760/(760+depth);return{x:280+x*scale,y:298+(y-298)*scale,z:depth,scale};}
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
const strandMode='interactive';
function drawTube(tube,points,scale=1){
 const path=points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join('');
 tube.outer.setAttribute('d',path);tube.body.setAttribute('d',path);
 tube.rim.setAttribute('d',points.map((p,i)=>`${i?'L':'M'}${p.x-tube.width*.18*scale},${p.y-tube.width*.12*scale}`).join(''));
 tube.outer.setAttribute('stroke-width',tube.width*scale);tube.body.setAttribute('stroke-width',tube.width*.87*scale);tube.rim.setAttribute('stroke-width',tube.width*.2*scale);
}
function render(){
 const interactive=strandMode==='interactive';
 stage.classList.toggle('is-interactive',interactive);
 drawTube(backbone,Array.from({length:151},(_,i)=>point(i/150)));
 for(const b of bases){const p=raw(b.t);b.z=p.z;const points=Array.from({length:15},(_,j)=>{const u=j/14,bend=Math.sin(u*Math.PI)*5;return project(p.x-Math.sin(p.a)*b.length*u+Math.cos(p.a)*bend,p.y-u*8,p.z-Math.cos(p.a)*b.length*u-Math.sin(p.a)*bend);});drawTube(b,points,points[0].scale);b.n.setAttribute('opacity',.84-p.z*.001);}
 // Back-facing protrusions sit behind the continuous backbone; near ones sit in front.
 bases.filter(b=>b.z>=0).sort((a,b)=>b.z-a.z).forEach(b=>surface.append(b.n));surface.append(backbone.n);
 bases.filter(b=>b.z<0).sort((a,b)=>b.z-a.z).forEach(b=>surface.append(b.n));
}
const stage=root.querySelector('.rna-nav-stage');
const caption=root.querySelector('.rna-nav-caption>span');
const originalCaption=caption.textContent;
let dragging=false,pointerId=null,previousX=0,previousY=0;
function endDrag(){if(pointerId!==null&&stage.hasPointerCapture?.(pointerId))stage.releasePointerCapture(pointerId);dragging=false;pointerId=null;stage.classList.remove('is-dragging');}
stage.addEventListener('pointerdown',event=>{if(strandMode!=='interactive'||!event.isPrimary||event.button!==0)return;event.preventDefault();dragging=true;pointerId=event.pointerId;previousX=event.clientX;previousY=event.clientY;stage.setPointerCapture(pointerId);stage.classList.add('is-dragging');stage.focus({preventScroll:true});});
stage.addEventListener('pointermove',event=>{if(!dragging||event.pointerId!==pointerId)return;phase+=(event.clientX-previousX)*.012;tilt=Math.max(-.55,Math.min(.55,tilt+(event.clientY-previousY)*.004));previousX=event.clientX;previousY=event.clientY;render();});
for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,endDrag);
window.addEventListener('blur',endDrag);
stage.addEventListener('keydown',event=>{if(strandMode!=='interactive')return;const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'];if(!keys.includes(event.key))return;event.preventDefault();if(event.key==='Home'){phase=.5;tilt=0;}else if(event.key==='ArrowLeft')phase-=.15;else if(event.key==='ArrowRight')phase+=.15;else tilt=Math.max(-.55,Math.min(.55,tilt+(event.key==='ArrowUp'?-.08:.08)));render();});
function syncMode(){const interactive=strandMode==='interactive';stage.tabIndex=interactive?0:-1;if(interactive){stage.setAttribute('role','group');stage.setAttribute('aria-label','Rotating RNA strand. Drag to rotate, or use arrow keys. Home resets the view.');}else{stage.removeAttribute('role');stage.removeAttribute('aria-label');}caption.textContent=interactive?'Drag to rotate · Arrow keys to adjust':originalCaption;held=false;endDrag();}
function sync(){motion.textContent=paused?'Resume motion':'Pause motion';syncParticles();motion.setAttribute('aria-pressed',String(paused));if(paused)word.textContent=words[index];}
motion.addEventListener('click',()=>{paused=!paused;sync();});preference.addEventListener('change',()=>{paused=preference.matches;sync();});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;syncParticles();}).observe(root);
function frame(now){const dt=Math.min((now-last)/1000,.04)||.016;last=now;if(visible&&!document.hidden&&!paused){if(!held&&!dragging){phase+=dt*.24;renderClock+=dt;if(renderClock>=1/30){renderClock=0;render();}}wordClock+=dt;if(wordClock>=4.2){wordClock=0;index=(index+1)%words.length;}const next=words[(index+1)%words.length];word.textContent=wordClock<2.7?words[index]:wordClock<3.2?words[index].slice(0,Math.max(0,Math.ceil(words[index].length*(3.2-wordClock)/.5))):next.slice(0,Math.floor(next.length*Math.min(1,(wordClock-3.2)/.7)));}requestAnimationFrame(frame);}
syncMode();sync();render();requestAnimationFrame(frame);
