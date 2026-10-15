export function siteKey(row) { return `${row.transcript_id}:${row.transcript_position}`; }

export function parseCSV(text, delimiter = ',') {
  text = text.replace(/^\uFEFF/, '');
  const records = []; let row = [], field = '', quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else field += c;
    } else if (c === '"' && field.length === 0 && !afterQuote) quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; afterQuote = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v.trim())) records.push(row);
      row = []; field = ''; afterQuote = false;
    } else {
      if (afterQuote && c.trim()) throw new Error('Unexpected text after a quoted CSV field.');
      if (!afterQuote) field += c;
    }
  }
  if (quoted) throw new Error('An unterminated quoted field was found.');
  row.push(field); if (row.some(v => v.trim())) records.push(row);
  if (records.length < 2) throw new Error('The file needs a header and at least one data row.');
  const headers = records.shift().map(v => v.trim());
  if (headers.some(v => !v) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be nonempty and unique.');
  return records.map((r, i) => {
    if (r.length !== headers.length) throw new Error(`CSV row ${i + 2} has ${r.length} fields; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()]));
  });
}

function number(value, label, integer = false, min = 0, max = Infinity) {
  if (value === undefined || String(value).trim() === '') throw new Error(`${label} is required.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isSafeInteger(n))) throw new Error(`Invalid ${label}: ${value}`);
  return n;
}

export function validateCoverage(records, sampleId) {
  if (!sampleId.trim()) throw new Error('A sample identifier is required.');
  const seen = new Set();
  return records.map((r, i) => {
    const tx = String(r.transcript_id ?? '').trim();
    if (!tx) throw new Error(`Missing transcript_id on row ${i + 2}.`);
    if (r.sample_id && r.sample_id !== sampleId) throw new Error('This file contains a different sample_id. Import one sample at a time.');
    const result = {
      sample_id: sampleId, transcript_id: tx,
      transcript_position: number(r.transcript_position, 'transcript_position', true),
      n_reads: number(r.n_reads ?? r.read_count, 'n_reads', true, 1),
      sequence: (r.sequence ?? r.sequence_context ?? '').toUpperCase().replaceAll('U', 'T'),
      gene_id: r.gene_id ?? '', gene_name: r.gene_name ?? '',
      label: r.label === undefined || r.label === '' ? null : number(r.label, 'label', false, 0, 1),
      score: r.score === undefined || r.score === '' ? null : number(r.score, 'score', false, 0, 1)
    };
    if (result.sequence && /[^ACGTN]/.test(result.sequence)) throw new Error(`Invalid nucleotide sequence on row ${i + 2}.`);
    const key = siteKey(result); if (seen.has(key)) throw new Error(`Duplicate site ${key}.`); seen.add(key);
    return result;
  });
}

export function attachPredictions(rows, records) {
  const scores = new Map();
  for (const r of records) {
    const tx = String(r.transcript_id ?? '').trim();
    if (!tx) throw new Error('Every prediction needs a transcript_id.');
    const position = number(r.transcript_position, 'transcript_position', true);
    const key = `${tx}:${position}`;
    if (scores.has(key)) throw new Error(`Duplicate prediction ${key}.`);
    scores.set(key, number(r.score, 'score', false, 0, 1));
  }
  const available = new Set(rows.map(siteKey));
  const unmatched = [...scores.keys()].filter(k => !available.has(k));
  if (unmatched.length) throw new Error(`${unmatched.length.toLocaleString()} prediction IDs do not match this sample. Check the sample and coverage file.`);
  if (!scores.size) throw new Error('There are no predictions to attach.');
  return { rows: rows.map(r => scores.has(siteKey(r)) ? { ...r, score: scores.get(siteKey(r)) } : r), matched: scores.size };
}

export function decodeDataset(data, sampleId) {
  return data.sites.map(([tx, pos, reads, seq, label, score]) => ({
    sample_id: sampleId, transcript_id: data.transcripts[tx], transcript_position: pos,
    n_reads: reads, sequence: data.sequences[seq],
    gene_id: data.transcriptGenes[tx] < 0 ? '' : data.genes[data.transcriptGenes[tx]],
    gene_name: '', label, score: score ?? null
  }));
}

export function filterRows(rows, f = {}) {
  const q = (f.search ?? '').trim().toLowerCase();
  return rows.filter(r => (!f.sample || f.sample === 'all' || r.sample_id === f.sample)
    && r.n_reads >= (f.minReads ?? 0)
    && (!q || `${r.transcript_id} ${r.gene_id} ${r.gene_name} ${r.sequence}`.toLowerCase().includes(q))
    && (!f.scoredOnly || r.score !== null)
    && (f.minScore === null || f.minScore === undefined || (r.score !== null && r.score >= f.minScore)));
}

export function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((a, b) => a - b), mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function summarize(rows, cutoff = .5) {
  const scores = rows.filter(r => r.score !== null);
  return { sites: rows.length, uniqueSites: new Set(rows.map(siteKey)).size,
    genes: new Set(rows.map(r => r.gene_id).filter(Boolean)).size,
    transcripts: new Set(rows.map(r => r.transcript_id)).size,
    medianReads: median(rows.map(r => r.n_reads)), scored: scores.length,
    aboveCutoff: scores.filter(r => r.score >= cutoff).length };
}

export const coverageBins = [20, 40, 80, 160, 320, 640, 1280, Infinity];
export function coverageHistogram(rows) {
  const counts = Array(coverageBins.length).fill(0);
  for (const r of rows) { const i = coverageBins.findIndex(edge => r.n_reads < edge); counts[i < 0 ? counts.length - 1 : i]++; }
  return counts;
}

export function compareSamples(left, right, metric = 'n_reads') {
  const rightByKey = new Map(right.map(r => [siteKey(r), r]));
  const pairs = []; let shared = 0;
  for (const row of left) {
    const other = rightByKey.get(siteKey(row)); if (!other) continue;
    shared++;
    if (row[metric] !== null && other[metric] !== null) pairs.push({ key: siteKey(row), x: row[metric], y: other[metric] });
  }
  return { shared, onlyLeft: left.length - shared, onlyRight: right.length - shared, pairs };
}

export function toCSV(rows, columns) {
  const encode = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [columns.join(','), ...rows.map(r => columns.map(c => encode(r[c])).join(','))].join('\r\n');
}
