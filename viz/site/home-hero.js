// Shaded molecular-style single RNA strand. Conceptual geometry; no sample data.
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
// Conceptual ball-and-stick geometry, not an experimentally resolved structure.
const defs=document.querySelector('#rna-ribbon defs');
const materials={backbone:['#e0f0e2','#6b9f91','#244f49'],carbon:['#f0f4e7','#9aaea3','#536c66'],nitrogen:['#d5e8ef','#6e9eaf','#355b72'],oxygen:['#f5d5c4','#c98a73','#855449'],phosphate:['#fff0c3','#c9ac6a','#8c7448']};
for(const [name,c] of Object.entries(materials)){const g=element('radialGradient',{id:'mol-'+name,cx:'30%',cy:'25%',r:'75%'});c.forEach((color,i)=>g.append(element('stop',{offset:[0,.55,1][i],'stop-color':color})));defs.append(g);}
const mesh=[];
function project(x,y,z){const depth=z*.96+(y-298)*.075;const scale=760/(760+depth);return{x:280+x*scale,y:298+(y-298)*scale,z:depth,scale};}
function raw(t){const a=t*Math.PI*3.8+phase;return{x:Math.sin(a)*94,y:45+t*505,z:Math.cos(a)*75,a};}
function point(t){const p=raw(t);return project(p.x,p.y,p.z);}
function bond(a,b,width=2,color='#78998b'){const n=element('g',{}),shadow=element('path',{fill:'none','stroke-linecap':'round',stroke:'#294d47'}),body=element('path',{fill:'none','stroke-linecap':'round',stroke:color}),light=element('path',{fill:'none','stroke-linecap':'round',stroke:'#e4f3e6',opacity:'.55'});n.append(shadow,body,light);art.append(n);mesh.push({n,a,b,width,shadow,body,light,kind:'bond'});}
function atom(position,r,material){const n=element('circle',{fill:'url(#mol-'+material+')'});art.append(n);mesh.push({n,position,r,kind:'atom'});}
// A smooth tubular sugar-phosphate backbone, with discreet phosphate highlights.
const tube=element('g',{'stroke-linecap':'round','stroke-linejoin':'round',fill:'none'});const tubeOuter=element('path',{stroke:'#3b6c60','stroke-width':'8.5'}),tubeBody=element('path',{stroke:'#8bb5a0','stroke-width':'5.6'}),tubeShine=element('path',{stroke:'#e0efdb','stroke-width':'1.15',opacity:'.8'});tube.append(tubeOuter,tubeBody,tubeShine);art.append(tube);
for(let i=0;i<18;i++){
 const t=(i+.5)/18;
 const local=(u,v=0,w=0)=>()=>{const p=raw(t);return{x:p.x-Math.sin(p.a)*u+Math.cos(p.a)*w,y:p.y+v,z:p.z-Math.cos(p.a)*u-Math.sin(p.a)*w};};
 atom(local(0),4.8,'phosphate');
 // Pentagonal sugar and a stem leading into the nucleotide base.
 const sugar=Array.from({length:5},(_,j)=>{const a=j*Math.PI*2/5;return local(10+Math.cos(a)*7,Math.sin(a)*7,Math.cos(a)*2);});
 sugar.forEach((p,j)=>{bond(p,sugar[(j+1)%5],1.9);atom(p,j===1?2.6:2.1,j===1?'oxygen':'carbon');});
 bond(local(15),local(29),2.2,'#7e9e95');
 const ring=Array.from({length:6},(_,j)=>{const a=j*Math.PI/3;return local(42+Math.cos(a)*12,Math.sin(a)*12,Math.sin(a)*3);});
 ring.forEach((p,j)=>{bond(p,ring[(j+1)%6],1.9,'#869e9a');atom(p,2.5,j%3===0?'nitrogen':'carbon');});
 // A second ring for purine-like bases gives a richer molecular silhouette.
 if(i%2===0){const ring2=Array.from({length:5},(_,j)=>{const a=j*Math.PI*2/5;return local(60+Math.cos(a)*10,Math.sin(a)*10,Math.sin(a)*2);});ring2.forEach((p,j)=>{bond(p,ring2[(j+1)%5],1.7);atom(p,2.3,j%2?'nitrogen':'carbon');});bond(local(52),local(55),1.8);}
 bond(local(42,-12,-3),local(42,-22,-3),1.8);atom(local(42,-22,-3),2.8,i%3===0?'oxygen':'nitrogen');
}
const connectors=links.map(()=>{const n=element('path',{fill:'none',stroke:'#90aaa0','stroke-width':'.8',opacity:'.5'});art.append(n);return n;});
function render(){
 const samples=Array.from({length:181},(_,i)=>point(i/180));const line=samples.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join('');tubeOuter.setAttribute('d',line);tubeBody.setAttribute('d',line);tubeShine.setAttribute('d',samples.map((p,i)=>`${i?'L':'M'}${p.x-1.5},${p.y-.8}`).join(''));art.prepend(tube);
 for(const m of mesh){if(m.kind==='atom'){const p=m.position(),q=project(p.x,p.y,p.z);m.z=q.z;m.n.setAttribute('cx',q.x);m.n.setAttribute('cy',q.y);m.n.setAttribute('r',m.r*q.scale);m.n.setAttribute('opacity',.72+(1-q.z/100)*.14);}else{const a=m.a(),b=m.b(),p=project(a.x,a.y,a.z),q=project(b.x,b.y,b.z);m.z=(p.z+q.z)/2;const scale=(p.scale+q.scale)/2,path=`M${p.x},${p.y}L${q.x},${q.y}`;m.shadow.setAttribute('d',path);m.shadow.setAttribute('stroke-width',m.width*scale);m.body.setAttribute('d',path);m.body.setAttribute('stroke-width',m.width*scale*.74);m.light.setAttribute('d',`M${p.x-.7},${p.y-.7}L${q.x-.7},${q.y-.7}`);m.light.setAttribute('stroke-width',Math.max(.45,m.width*scale*.18));m.n.setAttribute('opacity',.7+(1-m.z/100)*.15);}}
 mesh.sort((a,b)=>b.z-a.z).forEach(m=>art.append(m.n));
 links.forEach((link,i)=>{const p=point(.12+i*.14),side=i%2===0?-1:1,x=280+side*120+(p.x-280)*.19;link.style.setProperty('--link-x',`${x/560*100}%`);link.style.setProperty('--link-y',`${p.y/600*100}%`);const near=x-side*76;connectors[i].setAttribute('d',`M${p.x},${p.y}Q${(p.x+near)/2},${p.y-12} ${near},${p.y}`);art.append(connectors[i]);});
}
function sync(){motion.textContent=paused?'Resume rotation':'Pause rotation';motion.setAttribute('aria-pressed',String(paused));if(paused)word.textContent=words[index];}
motion.addEventListener('click',()=>{paused=!paused;sync();});preference.addEventListener('change',()=>{paused=preference.matches;sync();});
links.forEach(link=>{link.addEventListener('pointerenter',()=>{held=true;});link.addEventListener('pointerleave',()=>{held=!!root.querySelector('.rna-nav-link:focus-visible');});link.addEventListener('focus',()=>{held=true;});link.addEventListener('blur',()=>{held=!!root.querySelector('.rna-nav-link:hover');});});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}).observe(root);
function frame(now){const dt=Math.min((now-last)/1000,.04)||.016;last=now;if(visible&&!document.hidden&&!paused){if(!held){phase+=dt*.24;renderClock+=dt;if(renderClock>=1/30){renderClock=0;render();}}wordClock+=dt;if(wordClock>=4.2){wordClock=0;index=(index+1)%words.length;}const next=words[(index+1)%words.length];word.textContent=wordClock<2.7?words[index]:wordClock<3.2?words[index].slice(0,Math.max(0,Math.ceil(words[index].length*(3.2-wordClock)/.5))):next.slice(0,Math.floor(next.length*Math.min(1,(wordClock-3.2)/.7)));}requestAnimationFrame(frame);}
sync();render();requestAnimationFrame(frame);
