import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCSV,validateCoverage,attachPredictions,decodeDataset,filterRows,summarize,coverageHistogram,compareSamples,toCSV} from '../site/core.js';

const read=n=>JSON.parse(fs.readFileSync(new URL(`../site/data/dataset${n}.json`,import.meta.url)));
const a=decodeDataset(read(0),'dataset0'),b=decodeDataset(read(1),'dataset1'),c=decodeDataset(read(2),'dataset2');
assert.equal(a.length,121838);assert.equal(b.length,90810);assert.equal(c.length,1323);
const summary=summarize([...a,...b,...c]);
assert.equal(summary.sites,213971);assert.equal(summary.uniqueSites,146651);assert.equal(summary.scored,0);
assert.equal(summarize(a).medianReads,47);assert.equal(summarize(b).medianReads,40);assert.equal(summarize(c).medianReads,814);
assert.equal(compareSamples(a,b).shared,67320);assert.equal(compareSamples(a,c).shared,0);
assert.ok(c.some(r=>r.label===.25));assert.ok(c.every(r=>r.score===null));
assert.equal(coverageHistogram(a).reduce((n,c)=>n+c,0),a.length);
assert.equal(filterRows(a,{search:'ENST00000000233'}).length,18);
const source='\uFEFFtranscript_id,transcript_position,n_reads,gene_name\r\nTX1,10,20,"A, B"\r\nTX2,11,30,"Q""R"\r\n';
const parsed=parseCSV(source);assert.equal(parsed[0].gene_name,'A, B');assert.equal(parsed[1].gene_name,'Q"R');
const rows=validateCoverage(parsed,'new');assert.equal(rows[0].n_reads,20);assert.equal(rows[0].score,null);
assert.deepEqual(parseCSV(toCSV(parsed,Object.keys(parsed[0]))),parsed);
assert.throws(()=>parseCSV('a,b\n1,"bad'),/unterminated/);
assert.throws(()=>parseCSV('a,a\n1,2'),/unique/);
assert.throws(()=>validateCoverage([{transcript_id:'X',transcript_position:1,n_reads:0}],'new'),/n_reads/);
assert.throws(()=>validateCoverage([{transcript_id:'X',transcript_position:-1,n_reads:20}],'new'),/position/);
assert.throws(()=>validateCoverage([...parsed,parsed[0]],'new'),/Duplicate/);
assert.throws(()=>attachPredictions(rows,[{transcript_id:'TX1',transcript_position:10,score:2}]),/score/);
assert.throws(()=>attachPredictions(rows,[{transcript_id:'OTHER',transcript_position:1,score:.5}]),/do not match/);
const scored=attachPredictions(rows,[{transcript_id:'TX1',transcript_position:10,score:.8}]);
assert.equal(scored.matched,1);assert.equal(scored.rows[0].score,.8);assert.equal(rows[0].score,null);
assert.equal(filterRows(scored.rows,{scoredOnly:true,minScore:.7}).length,1);
console.log('PASS: all real site counts, shared-site joins, fractional labels, coverage summaries, CSV parsing/export, import validation, and score attachment.');
const manifest=JSON.parse(fs.readFileSync(new URL('../site/data/manifest.json',import.meta.url)));
for(const d of manifest.datasets.filter(d=>d.group==='sgnex')){
  const rows=decodeDataset(JSON.parse(fs.readFileSync(new URL(`../site/${d.dataFile}`,import.meta.url))),d.id);
  assert.equal(rows.length,d.rows,`${d.id} row count`);assert.ok(d.model,`${d.id} model label`);
  assert.ok(rows.every(r=>r.score!==null&&r.score>=0&&r.score<=1&&r.n_reads>=d.minReads&&r.label===null),`${d.id} scores and coverage`);
  assert.ok(manifest.catalog.some(c=>c.id===d.id&&c.loaded),`${d.id} in catalogue`);
}
console.log(`PASS: ${manifest.datasets.filter(d=>d.group==='sgnex').length} preloaded SG-NEx run(s) decode with scores in [0,1] and match the manifest.`);
