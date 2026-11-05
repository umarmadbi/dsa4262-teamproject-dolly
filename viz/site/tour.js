// Optional workspace tour. Uses existing navigation without changing filters or data.
const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('./tour.css',import.meta.url);document.head.append(stylesheet);
const launcher=document.createElement('button');launcher.type='button';launcher.className='button small tour-launch';launcher.textContent='Take a tour';launcher.setAttribute('aria-haspopup','dialog');
const importButton=document.getElementById('top-import');const actions=document.createElement('div');actions.className='tour-top-actions';importButton.before(actions);actions.append(launcher,importButton);
const steps=[
 {target:'.site-header',title:'Welcome to Dolly',text:'Explore predicted RNA modifications across seven human cell lines. This short tour shows where to start. These are model predictions, not experimentally confirmed modifications.'},
 {page:'overview',target:'#overview-metrics',title:'Start with the dataset overview',text:'Review the selected samples and coverage before interpreting scores. A measured candidate site is an opportunity for a prediction; it is not automatically an m6A call.'},
 {page:'landscape',target:'.landscape-controls',title:'Choose your Landscape comparison',text:'Select cell lines, a score cutoff and a site set. The cutoff decides which observations count as calls. Use shared sites when you want to compare the same candidates across cell lines.'},
 {page:'landscape',target:'#landscape-metagene',title:'Read the transcript landscape',text:'The coloured curves show where calls concentrate; grey shows the candidate background. Each transcript region is scaled to the same width. These patterns describe predictions and are not an independent accuracy test.'},
 {page:'explorer',target:'.explorer-tabs',title:'Explore a transcript or discover sites',text:'Inspect a transcript to search a gene or transcript ID. Discover sites and the high-confidence atlas offer other ways to find candidates worth examining.'},
 {page:'compare',target:'#page-compare .explorer-tabs',title:'Compare matching sites',text:'Compare cell lines together or inspect a pair of samples. Comparisons match transcript IDs and positions. Check coverage and individual runs before interpreting a score difference as a possible biological difference.'},
 {page:'data',target:'#page-data .page-heading',title:'Explore supplied data or import your own',text:'The supplied SG-NEx predictions are ready to explore. Imports add coverage or predictions already calculated elsewhere. The website does not run the model, and imported data is cleared when you reload.'},
 {page:'methods',target:'#methods-title',title:'A guide to exploring Dolly',text:'Return to Home & guide whenever you need help understanding scores, filters, methods or known limitations. Use its starting points to choose where to explore next. The sheep chat button can also answer questions using reviewed project documentation.'}
];
const dialog=document.createElement('dialog');dialog.className='dolly-tour';dialog.setAttribute('aria-labelledby','tour-title');dialog.setAttribute('aria-describedby','tour-description');
dialog.innerHTML='<div class="tour-highlight" aria-hidden="true"></div><section class="tour-card"><div class="tour-card-top"><span id="tour-progress"></span><button type="button" class="tour-close" aria-label="Close tour">×</button></div><h2 id="tour-title"></h2><p id="tour-description"></p><div class="tour-controls"><button type="button" data-tour="back">Previous</button><button type="button" data-tour="skip">Skip tour</button><button type="button" data-tour="next">Next</button></div></section>';
document.body.append(dialog);
const card=dialog.querySelector('.tour-card'),highlight=dialog.querySelector('.tour-highlight'),next=dialog.querySelector('[data-tour=next]'),back=dialog.querySelector('[data-tour=back]');
let index=0,target=null,originalPage='',originalScroll=0,previousFocus=null,generation=0,scheduled=0;
const loading=document.getElementById('loading');let autoStarted=false;
function ready(){launcher.disabled=!!loading&&!loading.hidden;if(!launcher.disabled&&!autoStarted){autoStarted=true;requestAnimationFrame(()=>launcher.click());}}
if(loading)new MutationObserver(ready).observe(loading,{attributes:true,attributeFilter:['hidden']});ready();
function navigate(page){document.querySelector(`[data-nav="${page}"]`)?.click();}
function place(){
 if(!dialog.open)return;
 const margin=16,width=window.innerWidth,height=window.innerHeight;
 const rect=target?.getBoundingClientRect();const usable=rect&&rect.width>0&&rect.height>0;
 highlight.hidden=!usable;
 if(usable){Object.assign(highlight.style,{left:`${Math.max(4,rect.left-6)}px`,top:`${Math.max(4,rect.top-6)}px`,width:`${Math.min(width-8,rect.width+12)}px`,height:`${Math.min(height-8,rect.height+12)}px`});}
 const box=card.getBoundingClientRect();let left=(width-box.width)/2,top=(height-box.height)/2;
 if(usable){left=rect.left;if(rect.bottom+box.height+24<height)top=rect.bottom+18;else if(rect.top-box.height-18>margin)top=rect.top-box.height-18;else{left=rect.right+18;top=rect.top;if(left+box.width>width-margin)left=rect.left-box.width-18;if(left<margin){left=width-box.width-margin;top=height-box.height-margin;}}}
 card.style.left=`${Math.max(margin,Math.min(left,width-box.width-margin))}px`;card.style.top=`${Math.max(margin,Math.min(top,height-box.height-margin))}px`;
}
function schedulePlace(){if(scheduled)return;scheduled=requestAnimationFrame(()=>{scheduled=0;place();});}
async function show(){
 const token=++generation,step=steps[index];next.disabled=true;
 if(step.page)navigate(step.page);
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 if(token!==generation||!dialog.open)return;
 target=document.querySelector(step.target);if(!target||!target.getClientRects().length)target=document.querySelector('.page.active .page-heading')||document.querySelector('.topbar');
 target?.scrollIntoView({behavior:'instant',block:'center'});
 dialog.querySelector('#tour-title').textContent=step.title;dialog.querySelector('#tour-description').textContent=step.text;dialog.querySelector('#tour-progress').textContent=`${index+1} of ${steps.length}`;
 back.disabled=index===0;next.disabled=false;next.textContent=index===steps.length-1?'Finish':'Next';place();next.focus({preventScroll:true});
}
function close(){if(!dialog.open)return;generation++;dialog.close();target=null;if(originalPage)navigate(originalPage);window.scrollTo({top:originalScroll,behavior:'instant'});(previousFocus?.isConnected?previousFocus:launcher).focus({preventScroll:true});}
launcher.addEventListener('click',()=>{if(dialog.open)return;previousFocus=document.activeElement;originalPage=document.querySelector('.page.active')?.id.replace('page-','')||'methods';originalScroll=window.scrollY;index=0;dialog.showModal();show();});
next.addEventListener('click',()=>{if(index===steps.length-1)close();else{index++;show();}});back.addEventListener('click',()=>{if(index>0){index--;show();}});
dialog.querySelector('[data-tour=skip]').addEventListener('click',close);dialog.querySelector('.tour-close').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
window.addEventListener('resize',schedulePlace);window.addEventListener('scroll',schedulePlace,{passive:true});
