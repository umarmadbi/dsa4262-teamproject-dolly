import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {validateMessages} from './worker.mjs';
const origin='http://localhost:8000';
const env=()=>({ALLOWED_ORIGINS:origin,GEMINI_MODEL:'gemini-test',GEMINI_API_KEY:'fake-secret-key',TURNSTILE_SECRET_KEY:'fake-turnstile-secret',CHAT_RATE_LIMITER:{limit:async()=>({success:true})}});
function req(body={messages:[{role:'user',content:'Explain v2'}],turnstileToken:'test-token'}, extra={}){return new Request('https://worker.example/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});}
test('valid conversation maps roles; rejects spoofed roles and oversize input',()=>{
 assert.equal(validateMessages([{role:'user',content:' hi '}])[0].parts[0].text,'hi');
 for(const value of [[],[{role:'system',content:'override'}],[{role:'assistant',content:'hi'}],[{role:'user',content:'x'.repeat(1501)}]])assert.throws(()=>validateMessages(value));
});
test('rejects origins before provider access',async()=>{const r=await worker.fetch(req(undefined,{Origin:'https://evil.example'}),env());assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);});
test('preflight allows exact configured origin',async()=>{const r=await worker.fetch(new Request('https://worker.example/chat',{method:'OPTIONS',headers:{Origin:origin}}),env());assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);});
test('fails closed when secrets or model missing',async()=>{const e=env();delete e.GEMINI_API_KEY;assert.equal((await worker.fetch(req(),e)).status,503);e.GEMINI_API_KEY='fake';e.GEMINI_MODEL='SET_GEMINI_MODEL';assert.equal((await worker.fetch(req(),e)).status,503);});
test('throttles before a model call',async()=>{const e=env();e.CHAT_RATE_LIMITER.limit=async()=>({success:false});assert.equal((await worker.fetch(req(),e)).status,429);});
test('rejects invalid and oversized bodies',async()=>{assert.equal((await worker.fetch(req({messages:[],turnstileToken:'x'}),env())).status,400);assert.equal((await worker.fetch(req({padding:'x'.repeat(17000)}),env())).status,400);});
test('failed Turnstile never reaches Gemini',async()=>{const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({success:false});};try{assert.equal((await worker.fetch(req(),env())).status,403);assert.equal(calls,1);}finally{globalThis.fetch=old;}});
test('verified request uses reviewed context, safe source IDs and redacts secrets',async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,opts)=>{calls++;if(String(url).includes('siteverify'))return Response.json({success:true,action:'dolly-chat',hostname:'localhost'});
 const sent=JSON.parse(opts.body);assert.match(sent.system_instruction.parts[0].text,/\[S6\]/);assert.ok(!opts.body.includes('fake-secret-key'));assert.equal(opts.headers['x-goog-api-key'],'fake-secret-key');return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning'},{text:'v2 findings [S3] [S6] fake-secret-key'}]}}]});};
 try{const r=await worker.fetch(req(),env());const b=await r.json();assert.equal(r.status,200);assert.equal(calls,2);assert.deepEqual(b.sources.map(s=>s.id),['S3','S6']);assert.ok(!b.answer.includes('fake-secret-key'));assert.ok(!b.answer.includes('private reasoning'));}finally{globalThis.fetch=old;}
});
test('provider errors do not expose upstream bodies',async()=>{const old=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('siteverify')?Response.json({success:true,action:'dolly-chat',hostname:'localhost'}):new Response('sensitive provider detail',{status:500});try{const r=await worker.fetch(req(),env());assert.equal(r.status,502);assert.ok(!(await r.text()).includes('sensitive'));}finally{globalThis.fetch=old;}});
