// Renderers for the insight views (Landscape, calibration, reproducibility, atlas, transcript map).
// Pure functions: data in, HTML/SVG strings out. Data comes from data/insights.json, data/atlas.json
// and data/transcripts.json, written by scripts/build_viz_insights.py.

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt = n => Number(n).toLocaleString('en-US');
export const cellHues = { A549: 240, H9: 213, HEYA8: 274, Hct116: 25, HepG2: 338, K562: 185, MCF7: 46 };
export function cellColour(cell, lightness = 38) { return `hsl(${cellHues[cell] ?? 160} 52% ${lightness}%)`; }
export const GREY = '#9aa59d', TEAL = '#178c70', M6ANET = '#c0632b';
// Gene symbols (data/gene_names.json, Ensembl 91), loaded once at startup by app.js. IDs remain the join keys.
let GENE_NAMES = new Map();
export function setGeneNames(map) { GENE_NAMES = map; }
export const geneName = id => GENE_NAMES.get(id) || '';
export const geneCell = id => id ? (geneName(id) ? `<strong class="gene-symbol">${esc(geneName(id))}</strong><br><small>${esc(id)}</small>` : esc(id)) : '—';
export const thresholdIndex = t => Math.min(8, Math.max(0, Math.round(t * 10) - 1));
const pct = (num, den, digits = 2) => den ? (num / den * 100).toFixed(digits) : '—';
const TRAINING = 'Hct116';
// Styled tooltip content, carried in a data-tip attribute and shown by app.js (hover, focus or tap).
function tipHtml({ kicker = '', name = '', value = '', unit = '', lines = [], foot = '' }) {
  return (kicker ? `<div class="run-tooltip-kicker">${esc(kicker)}</div>` : '') + (name ? `<strong class="run-tooltip-name">${esc(name)}</strong>` : '')
    + (value !== '' ? `<div class="run-tooltip-value">${esc(value)}<span>${esc(unit)}</span></div>` : '')
    + lines.map(l => `<p>${esc(l)}</p>`).join('') + (foot ? `<div class="run-tooltip-foot">${esc(foot)}</div>` : '');
}
export const tip = o => ` data-tip="${esc(tipHtml(o))}"${o.colour ? ` data-tip-colour="${esc(o.colour)}"` : ''}`;

// ---------- generic charts ----------
function frame({ w, h, l, r, t, b, xMin, xMax, yMax, xTicks, yTicks, xLabel, yLabel, yFmt = v => v }) {
  const x = v => l + (v - xMin) / (xMax - xMin) * (w - l - r), y = v => h - b - v / yMax * (h - t - b);
  let svg = yTicks.map(v => `<line x1="${l}" y1="${y(v)}" x2="${w - r}" y2="${y(v)}" stroke="#edf1e8"/><text x="${l - 8}" y="${y(v) + 3}" text-anchor="end">${yFmt(v)}</text>`).join('');
  svg += xTicks.map(tk => `<text x="${x(tk.v)}" y="${h - b + 16}" text-anchor="middle">${esc(tk.label)}</text>`).join('');
  svg += `<line x1="${l}" y1="${h - b}" x2="${w - r}" y2="${h - b}" stroke="#d9e2d8"/>`;
  if (xLabel) svg += `<text class="axis-label" x="${(l + w - r) / 2}" y="${h - 6}" text-anchor="middle">${esc(xLabel)}</text>`;
  if (yLabel) svg += `<text class="axis-label" transform="translate(13 ${(t + h - b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  return { x, y, svg };
}
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function ticks(max) { const m = max / 10 ** Math.floor(Math.log10(max)), n = Math.abs(m - 2) < 1e-9 ? 4 : 5; return Array.from({ length: n + 1 }, (_, i) => max * i / n); }
const tickFmt = (v, unit = '') => (Number.isInteger(Math.round(v * 1000) / 1000) ? v.toFixed(0) : v.toFixed(1)) + unit;

export function lineChart({ series, xMin, xMax, xTicks, xLabel, yLabel, yFmt = v => v.toFixed(1), vlines = [], bands = [], w = 640, h = 280, yMaxHint = 0, yMaxFixed = null, aria, focus = null, hoverLabel = null, tipKicker = '' }) {
  const yMax = yMaxFixed ?? niceMax(Math.max(yMaxHint, ...series.flatMap(s => s.points.map(p => p[1]).filter(Number.isFinite))) * 1.08);
  const f = frame({ w, h, l: 52, r: 16, t: 14, b: 44, xMin, xMax, yMax, xTicks, yTicks: ticks(yMax), xLabel, yLabel, yFmt });
  let svg = bands.map(bd => `<rect x="${f.x(bd.from)}" y="14" width="${f.x(bd.to) - f.x(bd.from)}" height="${h - 58}" fill="${bd.fill}"/>`).join('') + f.svg;
  svg += vlines.map(v => `<line x1="${f.x(v.x)}" y1="14" x2="${f.x(v.x)}" y2="${h - 44}" stroke="#b7cabc" stroke-dasharray="3 4"/>${v.label ? `<text x="${f.x(v.x) + 4}" y="24">${esc(v.label)}</text>` : ''}`).join('');
  // Crosshair: one invisible column per x position, listing every series' value there (hover, tap or keyboard focus).
  if (hoverLabel) {
    const xs = [...new Set(series.flatMap(s => s.points.filter(p => Number.isFinite(p[1])).map(p => p[0])))].sort((a, b) => a - b);
    xs.forEach((xv, i) => {
      const x0 = i ? (f.x(xs[i - 1]) + f.x(xv)) / 2 : f.x(xMin), x1 = i < xs.length - 1 ? (f.x(xv) + f.x(xs[i + 1])) / 2 : f.x(xMax);
      const vals = series.map(s => ({ s, p: s.points.find(p => p[0] === xv) })).filter(q => q.p && Number.isFinite(q.p[1]))
        .filter(q => !focus || !q.s.key || q.s.key === focus).sort((a, b) => b.p[1] - a.p[1]);
      if (vals.length) svg += `<rect class="hover-col" fill="transparent" x="${x0.toFixed(1)}" y="14" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${h - 58}"${tip({ kicker: tipKicker, name: hoverLabel(xv), lines: vals.map(q => `${q.s.name}: ${yFmt(q.p[1])}`) })}/>`;
    });
  }
  for (const s of series) {
    const pts = s.points.filter(p => Number.isFinite(p[1]));
    if (!pts.length) continue;
    const dim = focus && s.key && s.key !== focus, strong = focus && s.key === focus;
    svg += `<polyline class="chart-line" pointer-events="none" fill="none" stroke="${s.colour}" stroke-width="${(s.width ?? 1.8) + (strong ? 1.6 : 0)}" stroke-opacity="${dim ? .14 : 1}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" points="${pts.map(p => `${f.x(p[0]).toFixed(1)},${f.y(p[1]).toFixed(1)}`).join(' ')}"/>`;
    if (s.markers) svg += pts.map(p => `<circle class="chart-point${p[3] ? ' clickable' : ''}" cx="${f.x(p[0]).toFixed(1)}" cy="${f.y(p[1]).toFixed(1)}" r="${p[3] ? 4 : 2.6}" fill="${s.colour}"${tip({ kicker: tipKicker, name: s.name, value: yFmt(p[1]), unit: String(p[2] ?? p[0]), colour: s.colour })}${p[3] ?? ''}/>`).join('');
  }
  return `<svg class="scatter-svg insight-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">${svg}</svg>`;
}
// Legend; items with a key are buttons that highlight that series (data-focus-line, handled in app.js).
export function legend(items, focus = null) {
  return `<div class="insight-legend">${items.map(i => {
    const sw = `<i style="background:${i.colour};${i.dash ? 'height:0;border-top:2px dashed ' + i.colour + ';background:none' : ''}"></i>${esc(i.name)}`;
    return i.key ? `<button type="button" class="legend-btn${focus === i.key ? ' active' : ''}${focus && focus !== i.key ? ' faded' : ''}" data-focus-line="${esc(i.key)}" aria-pressed="${focus === i.key}" title="Highlight ${esc(i.name)}">${sw}</button>` : `<span>${sw}</span>`;
  }).join('')}${focus ? '<button type="button" class="legend-btn clear" data-focus-line="">Show all</button>' : ''}</div>`;
}

// ---------- Overview: calibration ----------
export function calibrationView(cal, cutoff) {
  if (!cal) return '<p class="empty-chart">Calibration data are not available. Rebuild with scripts/build_viz_insights.py and the label files.</p>';
  const w = 420, h = 260;
  const f = frame({ w, h, l: 48, r: 12, t: 12, b: 44, xMin: 0, xMax: 1, yMax: 1, xTicks: [0, .25, .5, .75, 1].map(v => ({ v, label: v.toFixed(2) })), yTicks: ticks(1), xLabel: 'Dolly v2 score bin', yLabel: 'labelled m6A', yFmt: v => (v * 100).toFixed(0) + '%' });
  let svg = f.svg + `<line x1="${f.x(0)}" y1="${f.y(0)}" x2="${f.x(1)}" y2="${f.y(1)}" stroke="#b7cabc" stroke-dasharray="4 5"/>`;
  svg += cal.bins.map(b => {
    const x0 = f.x(b.lo) + 1.5, x1 = f.x(b.hi) - 1.5, y0 = f.y(b.positiveRate);
    const set = Math.min(.9, Math.max(.1, Math.round(b.lo * 10) / 10));
    return `<rect class="clickable" x="${x0}" y="${y0}" width="${Math.max(1, x1 - x0)}" height="${Math.max(1, f.y(0) - y0)}" rx="2" fill="${b.lo >= cutoff - 1e-9 ? TEAL : '#9fcdb9'}"${tip({ kicker: 'Score bin', name: `Scores ${b.lo}–${b.hi}`, value: (b.positiveRate * 100).toFixed(1) + '%', unit: 'labelled m6A', lines: [`${fmt(b.n)} labelled observations · mean score ${b.meanScore.toFixed(3)}`], foot: `Click to set the cutoff to ${set}` })} data-set-cutoff="${set}" tabindex="0" role="button" aria-label="Set cutoff to ${set}"/>`;
  }).join('');
  svg += `<line x1="${f.x(cutoff)}" y1="12" x2="${f.x(cutoff)}" y2="${h - 44}" stroke="#e7ad43" stroke-width="2"/><text x="${f.x(cutoff) + 4}" y="22" style="fill:#896325">cutoff ${cutoff}</text>`;
  const reliability = `<svg class="scatter-svg insight-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Share of sites labelled m6A in each score bin">${svg}</svg>`;
  const pr = lineChart({ w: 420, h: 260, xMin: .1, xMax: .9, xTicks: cal.thresholds.filter((_, i) => i % 2 === 0).map(t => ({ v: t.t, label: t.t.toFixed(1) })), xLabel: 'Score cutoff', yLabel: 'precision / recall', yFmt: v => (v * 100).toFixed(0) + '%', yMaxFixed: 1,
    vlines: [{ x: cutoff, label: '' }], aria: 'Precision and recall at each score cutoff',
    tipKicker: 'Click to use this cutoff',
    series: [{ name: 'Precision', colour: TEAL, markers: true, points: cal.thresholds.map(t => [t.t, t.precision, 'at cutoff ' + t.t, ` data-set-cutoff="${t.t}" tabindex="0" role="button" aria-label="Set cutoff to ${t.t}"`]) },
      { name: 'Recall', colour: '#7a8fd1', markers: true, points: cal.thresholds.map(t => [t.t, t.recall, 'at cutoff ' + t.t, ` data-set-cutoff="${t.t}" tabindex="0" role="button" aria-label="Set cutoff to ${t.t}"`]) },
      { name: 'Share of sites called', colour: GREY, dash: '4 4', points: cal.thresholds.map(t => [t.t, t.callRate, 'cutoff ' + t.t]) }] });
  const at = cal.thresholds[thresholdIndex(cutoff)];
  const cells = cal.cells.map(c => `<tr><td style="color:${cellColour(c.cell)};font-weight:600">${esc(c.cell)}${c.cell === TRAINING ? ' †' : ''}</td><td>${c.runs}</td><td>${fmt(c.n)}</td><td>${c.roc.toFixed(3)}</td><td>${c.pr.toFixed(3)}</td><td>${c.prOverBase.toFixed(1)}×</td></tr>`).join('');
  return `<div class="cross-stats three"><div class="cross-stat"><small>At cutoff ${cutoff}</small><strong class="cross-stat-value">${(at.precision * 100).toFixed(0)}%</strong><span>of called sites are labelled m6A (precision)</span></div><div class="cross-stat"><small>At cutoff ${cutoff}</small><strong class="cross-stat-value">${(at.recall * 100).toFixed(0)}%</strong><span>of labelled m6A sites are called (recall)</span></div><div class="cross-stat"><small>Ranking quality, median over runs</small><strong class="cross-stat-value">${cal.medianRoc.toFixed(2)} / ${cal.medianPr.toFixed(2)}</strong><span>ROC AUC / PR AUC (positive rate ${(cal.positiveRate * 100).toFixed(1)}%)</span></div></div>
  <div class="chart-grid insight-pair"><div><h3 class="insight-subhead">Is a score a probability?</h3>${reliability}<p class="panel-note">Bars: share of sites in each score bin that carry an m6A label; dashed line: a perfectly calibrated score. Up to about 0.5 the score behaves like a probability. Above 0.5 the labelled share levels off near 50%, so a score of 0.9 does not mean 90%.</p></div><div><h3 class="insight-subhead">What a cutoff buys you</h3>${pr}${legend([{ name: 'Precision', colour: TEAL }, { name: 'Recall', colour: '#7a8fd1' }, { name: 'Share of sites called', colour: GREY, dash: true }])}<p class="panel-note">Raising the cutoff above 0.5 loses most of the recall without gaining precision. <strong>Click any bar or point to set the cutoff</strong>; every panel on this page follows it.</p></div></div>
  <details class="run-values"><summary>Ranking quality by cell line</summary><div class="table-scroll"><table><thead><tr><th>Cell line</th><th>Runs</th><th>Labelled observations</th><th>Median ROC AUC</th><th>Median PR AUC</th><th>PR AUC ÷ positive rate</th></tr></thead><tbody>${cells}</tbody></table></div><p class="fine-print">Differences between cell lines mostly follow how many labelled sites each run covers. Hct116 († training cell line) does not rank better than the other lines.</p></details>
  <p class="fine-print">Labels: ${esc(cal.source)}; ${fmt(cal.sites)} sites in ${fmt(cal.genes)} genes, ${fmt(cal.observations)} SG-NEx observations across the runs used in summaries. The model never saw these genes. Labels come from HCT116, so in other cell lines a disagreement could be biology as well as model error. The labels also miss real sites, which caps precision.</p>`;
}

// ---------- Overview: why raw call rates mislead ----------
export function expressionView(ins, cutoff, samples, highlight = null) {
  const ti = thresholdIndex(cutoff), runs = ins.perRun.filter(r => samples.has(r.id));
  const clean = runs.filter(r => !r.limitations.includes('v1Fallback'));
  const lx = v => Math.log10(v);
  const xs = clean.map(r => lx(r.sites)), all = clean.map(r => r.calls[ti] / r.sites * 100), sh = clean.map(r => r.commonCalls[ti] / r.commonSites * 100);
  const corr = (a, b) => { const n = a.length; if (n < 3) return null; const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : null; };
  const rAll = corr(xs, all), rSh = corr(xs, sh);
  const w = 440, h = 270, xMin = 4.4, xMax = 5.5, yMax = niceMax(Math.max(1, ...runs.map(r => r.calls[ti] / r.sites * 100), ...runs.map(r => r.commonCalls[ti] / r.commonSites * 100)) * 1.1);
  const f = frame({ w, h, l: 46, r: 12, t: 12, b: 44, xMin, xMax, yMax, xTicks: [25e3, 50e3, 100e3, 200e3].map(v => ({ v: lx(v), label: fmt(v / 1000) + 'k' })), yTicks: ticks(yMax), xLabel: 'Sites with ≥20 reads in the run (log scale)', yLabel: '% called', yFmt: v => tickFmt(v, '%') });
  let svg = f.svg;
  for (const r of runs) {
    const x = f.x(Math.min(xMax, Math.max(xMin, lx(r.sites)))), excluded = r.limitations.includes('v1Fallback'), c = cellColour(r.cell);
    const a = r.calls[ti] / r.sites * 100, b = r.commonCalls[ti] / r.commonSites * 100;
    const hl = r.id === highlight, name = runShort(r.id);
    const tp = tip({ kicker: `${r.cell} · SG-NEx run`, name, value: a.toFixed(2) + '%', unit: `called · all ${fmt(r.sites)} sites`, colour: cellColour(r.cell, 60), lines: [`${b.toFixed(2)}% on the ${fmt(r.commonSites)} sites measured in every run`].concat(excluded ? ['Excluded run: scored without transcript-structure features'] : []), foot: hl ? 'Click again to clear the highlight' : 'Click to highlight this run in the cell-line chart' });
    const act = ` data-highlight-run="${esc(r.id)}" tabindex="0" role="button" aria-label="Highlight ${esc(name)}"`;
    svg += `<line x1="${x}" y1="${f.y(a)}" x2="${x}" y2="${f.y(b)}" stroke="${c}" stroke-opacity="${hl ? .9 : .25}" stroke-width="${hl ? 2 : 1}"/>`;
    if (hl) svg += `<circle cx="${x}" cy="${f.y(a)}" r="9" fill="none" stroke="#e7ad43" stroke-width="2.5"/>`;
    svg += `<circle class="clickable" cx="${x}" cy="${f.y(a)}" r="${hl ? 6 : 4.5}" fill="${excluded ? 'white' : c}" stroke="${c}" stroke-width="1.4" ${excluded ? 'stroke-dasharray="2 2"' : ''}${tp}${act}/>`;
    svg += `<rect class="clickable" x="${x - 3.5}" y="${f.y(b) - 3.5}" width="7" height="7" fill="white" stroke="${c}" stroke-width="1.6"${tp}${act}/>`;
  }
  const scatter = `<svg class="scatter-svg insight-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Call rate against run size, for all sites and for shared sites">${svg}</svg>`;
  const bins = ins.expression.bins, rates = bins.map(b => b.calls[ti] / b.n * 100), bMax = niceMax(Math.max(...rates) * 1.15);
  const g = frame({ w, h, l: 46, r: 12, t: 12, b: 44, xMin: 0, xMax: bins.length, yMax: bMax, xTicks: bins.map((b, i) => ({ v: i + .5, label: b.label })), yTicks: ticks(bMax), xLabel: `Number of runs (of ${ins.expression.maxRuns}) measuring the site · proxy for expression`, yLabel: '% called', yFmt: v => tickFmt(v, '%') });
  let bars = g.svg + bins.map((b, i) => `<rect x="${g.x(i + .15)}" y="${g.y(rates[i])}" width="${g.x(i + .85) - g.x(i + .15)}" height="${g.y(0) - g.y(rates[i])}" rx="3" fill="#65ab91"${tip({ kicker: 'Expression proxy', name: `Sites measured in ${b.label} runs`, value: rates[i].toFixed(2) + '%', unit: 'called', lines: [`${fmt(b.n)} site observations`, `median ${b.medianReads} reads per site`] })} tabindex="0"/><text x="${g.x(i + .5)}" y="${g.y(rates[i]) - 5}" text-anchor="middle">${rates[i].toFixed(1)}%</text>`).join('');
  const expr = `<svg class="scatter-svg insight-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Call rate by the number of runs measuring a site">${bars}</svg>`;
  return `<div class="chart-grid insight-pair"><div><h3 class="insight-subhead">Bigger runs call more sites…</h3>${scatter}<div class="insight-legend"><span><b class="legend-dot"></b>All sites in the run${rAll === null ? '' : ` · r = ${rAll.toFixed(2)}`}</span><span><b class="legend-square"></b>The ${fmt(ins.totals.commonSites)} sites measured in every run${rSh === null ? '' : ` · r = ${rSh.toFixed(2)}`}</span></div><p class="panel-note">One colour per cell line; the hollow dashed dot is the excluded run (not in r). <strong>Click a run to highlight it in the cell-line chart above.</strong> Within a run, read depth barely changes the call rate. Across runs, larger runs reach more lowly expressed transcripts. On an identical site set the trend is weaker.</p></div><div><h3 class="insight-subhead">…because lowly expressed transcripts carry more predicted m6A</h3>${expr}<p class="panel-note">Sites found in only a few runs (low expression) are called about twice as often as sites found in every run (highly expressed, often housekeeping genes). This is consistent with m6A promoting mRNA decay. Compare cell lines on shared sites, not by raw call rates.</p></div></div>`;
}

// ---------- Landscape ----------
const regionTicks = [{ v: .5, label: "5′UTR" }, { v: 1.5, label: 'CDS' }, { v: 2.5, label: "3′UTR" }];
function density(arr, bins, span) { const total = arr.reduce((a, b) => a + b, 0); return arr.map(v => total ? v / total / (span / bins) : NaN); }

const regionAt = x => `${x < 1 ? "5′UTR" : x < 2 ? 'CDS' : "3′UTR"} · ${Math.round((x % 1) * 100)}% along`;
export function metageneView(ins, { cells, set, cutoff, focus = null }) {
  const ti = thresholdIndex(cutoff), L = ins.landscape[set], nb = ins.bins.metagene, mid = i => (i + .5) * 3 / nb;
  const base = L.All.metagene;
  const series = [{ name: 'All candidate sites', colour: GREY, width: 2.6, points: density(base.n, nb, 3).map((v, i) => [mid(i), v]) }];
  if (cells.length > 1) series.push({ name: 'Calls, selected lines pooled', colour: '#143b34', width: 2.6, points: density(sumArrays(cells.map(c => L[c].metagene.calls[ti])), nb, 3).map((v, i) => [mid(i), v]) });
  for (const c of cells) series.push({ name: `${c} calls`, key: c, colour: cellColour(c), width: 1.4, points: density(L[c].metagene.calls[ti], nb, 3).map((v, i) => [mid(i), v]) });
  const nCalls = cells.reduce((n, c) => n + L[c].metagene.calls[ti].reduce((a, b) => a + b, 0), 0);
  return lineChart({ series, xMin: 0, xMax: 3, xTicks: regionTicks, yLabel: 'density', yFmt: v => tickFmt(v), vlines: [{ x: 1, label: 'start codon' }, { x: 2, label: 'stop codon' }], aria: 'Metagene density of called sites and all candidate sites', w: 760, h: 300, focus, hoverLabel: regionAt, tipKicker: 'Metagene density' })
    + legend(series.slice(0, Math.min(series.length, 2)).concat(cells.map(c => ({ name: c, key: c, colour: cellColour(c) }))), focus)
    + `<p class="panel-note">${fmt(nCalls)} calls (score ≥ ${cutoff}) on coding transcripts, each region scaled to the same width. Calls pile up just after the stop codon and are depleted along the CDS, the classic m6A metagene. Every cell line shows the same shape. <strong>Hover the chart to read every line at that position; click a cell line in the legend to highlight it.</strong></p>`;
}
function sumArrays(list) { return list.reduce((acc, a) => acc.map((v, i) => v + a[i]), Array(list[0]?.length ?? 0).fill(0)); }

export function stopView(ins, { cells, set, cutoff, focus = null }) {
  const ti = thresholdIndex(cutoff), L = ins.landscape[set], e = ins.bins.stop, mid = i => (e[i] + e[i + 1]) / 2;
  const rate = d => d.n.map((n, i) => n >= 200 ? d.calls[ti][i] / n * 100 : NaN);
  const series = [{ name: 'Selected lines pooled', colour: '#143b34', width: 2.6, markers: false, points: rate(pool(cells.map(c => L[c].stop))).map((v, i) => [mid(i), v, `${e[i]} to ${e[i + 1]} nt`]) }];
  for (const c of cells) series.push({ name: c, key: c, colour: cellColour(c), width: 1.2, points: rate(L[c].stop).map((v, i) => [mid(i), v, `${e[i]} to ${e[i + 1]} nt`]) });
  return lineChart({ series, xMin: e[0], xMax: e.at(-1), xTicks: [-1000, -500, 0, 500, 1000, 1500].map(v => ({ v, label: v > 0 ? '+' + v : String(v) })), xLabel: 'Distance to the stop codon (nt; negative = CDS, positive = 3′UTR)', yLabel: '% of sites called', yFmt: v => tickFmt(v, '%'), vlines: [{ x: 0, label: 'stop' }], aria: 'Call rate by distance to the stop codon', w: 560, h: 280, focus, tipKicker: 'Call rate',
    hoverLabel: v => `${v - 25 > 0 ? '+' : ''}${v - 25} to ${v + 25 > 0 ? '+' : ''}${v + 25} nt from the stop codon` })
    + legend([{ name: 'Selected lines pooled', colour: '#143b34' }].concat(cells.map(c => ({ name: c, key: c, colour: cellColour(c) }))), focus)
    + `<p class="panel-note">Call rate in 50-nt windows (windows with fewer than 200 observations hidden). It peaks in the first ~200 nt of the 3′UTR, about five times the CDS body, then falls off in distal 3′UTRs.</p>`;
}
function pool(list) { return { n: sumArrays(list.map(d => d.n)), calls: list[0].calls.map((_, ti) => sumArrays(list.map(d => d.calls[ti]))) }; }

export function junctionView(ins, { cells, set, cutoff }) {
  const ti = thresholdIndex(cutoff), L = ins.landscape[set], e = ins.bins.junction;
  const labels = e.slice(0, -1).map((v, i) => i === e.length - 2 ? `${fmt(v)}+` : `${v}–${e[i + 1]}`);
  const p = pool(cells.map(c => L[c].junction)), rates = p.n.map((n, i) => n ? p.calls[ti][i] / n * 100 : 0);
  const last = cells.map(c => L[c].lastExon), lastRate = k => { const n = last.reduce((s, d) => s + d[k].n, 0), x = last.reduce((s, d) => s + d[k].calls[ti], 0); return n ? x / n * 100 : 0; };
  const w = 560, h = 280, yMax = niceMax(Math.max(...rates, lastRate('last')) * 1.15), nb = labels.length + 3;
  const f = frame({ w, h: h + 18, l: 46, r: 12, t: 12, b: 76, xMin: 0, xMax: nb, yMax, xTicks: [], yTicks: ticks(yMax), yLabel: '% of sites called', yFmt: v => tickFmt(v, '%') });
  let svg = f.svg;
  const bar = (i, v, label, fill, text, n) => `<rect x="${f.x(i + .14)}" y="${f.y(v)}" width="${f.x(i + .86) - f.x(i + .14)}" height="${Math.max(1, f.y(0) - f.y(v))}" rx="2" fill="${fill}"${tip({ kicker: 'Selected lines pooled', name: text, value: v.toFixed(2) + '%', unit: 'of sites called', lines: n ? [`${fmt(n)} site observations`] : [] })} tabindex="0"/><text x="${f.x(i + .5)}" y="${h - 58 + 14}" text-anchor="end" transform="rotate(-40 ${f.x(i + .5)} ${h - 58 + 14})">${esc(label)}</text>`;
  rates.forEach((v, i) => { svg += bar(i, v, labels[i], i < 2 ? '#d9a35a' : '#65ab91', `${labels[i]} nt from the nearest exon junction`, p.n[i]); });
  for (const c of cells) {
    const d = L[c].junction;
    d.n.forEach((n, i) => { if (n >= 100) svg += `<circle cx="${f.x(i + .5)}" cy="${f.y(d.calls[ti][i] / n * 100)}" r="2.6" fill="${cellColour(c)}" opacity=".85"${tip({ kicker: c, name: `${labels[i]} nt from the nearest junction`, value: (d.calls[ti][i] / n * 100).toFixed(2) + '%', unit: 'of sites called', lines: [`${fmt(n)} site observations`], colour: cellColour(c, 60) })}/>`; });
  }
  const j = labels.length + 1;
  svg += bar(j, lastRate('last'), 'Last exon', TEAL, 'Sites in the last exon') + bar(j + 1, lastRate('other'), 'Other exons', '#b7d3c5', 'Sites in other exons');
  svg += `<text class="axis-label" x="${f.x(labels.length / 2)}" y="${h + 12}" text-anchor="middle">Distance to the nearest exon–exon junction (nt)</text><line x1="${f.x(labels.length + .5)}" y1="12" x2="${f.x(labels.length + .5)}" y2="${h - 58}" stroke="#d9e2d8"/>`;
  return `<svg class="scatter-svg insight-svg" viewBox="0 0 ${w} ${h + 18}" role="img" aria-label="Call rate by distance to the nearest exon junction, and in the last exon">${svg}</svg><p class="panel-note">Bars pool the selected cell lines; dots show each line. Calls are almost absent within 50 nt of a junction (amber) and enriched in the last exon. That fits the exon junction complex blocking methylation near junctions. v2 sees junction distance as a feature, but the v1-scored MCF7 run and m6Anet, neither of which use position, show the same depletion.</p>`;
}

export function motifView(ins, { cells, cutoff }) {
  const ti = thresholdIndex(cutoff), M = ins.motifs, all = M.byCell.All;
  const order = M.kmers.map((k, i) => ({ k, i, rate: all.n[i] ? all.calls[ti][i] / all.n[i] : 0 })).sort((a, b) => b.rate - a.rate);
  const totalN = all.n.reduce((a, b) => a + b, 0), totalCalls = all.calls[ti].reduce((a, b) => a + b, 0);
  const maxRate = Math.max(...order.map(o => o.rate), ...cells.flatMap(c => M.kmers.map((_, i) => M.byCell[c].n[i] ? M.byCell[c].calls[ti][i] / M.byCell[c].n[i] : 0)));
  const head = `<tr><th>5-mer</th><th>Share of sites</th><th>Share of calls</th><th>Enrichment</th>${cells.map(c => `<th style="color:${cellColour(c)}">${esc(c)}${c === TRAINING ? ' †' : ''}</th>`).join('')}<th>All lines</th></tr>`;
  const rows = order.map(o => {
    const share = all.n[o.i] / totalN, callShare = totalCalls ? all.calls[ti][o.i] / totalCalls : 0, enr = share ? callShare / share : 0;
    const kmer = o.k, cell = (n, x, c, label) => { const r = n ? x / n : null; const size = r === null ? 0 : 4 + 14 * Math.sqrt(r / (maxRate || 1)); return `<td class="motif-cell">${r === null ? '—' : `<span class="motif-dot" style="width:${size}px;height:${size}px;background:${c}"${tip({ kicker: label, name: kmer, value: (r * 100).toFixed(2) + '%', unit: 'of sites called', lines: [`${fmt(x)} calls of ${fmt(n)} site observations`] })}></span><small>${(r * 100).toFixed(r < .01 ? 2 : 1)}%</small>`}</td>`; };
    return `<tr class="${o.rate < 1e-4 ? 'motif-never' : ''}"><th scope="row" class="sequence motif-kmer"><button type="button" class="motif-open" data-motif-open="${esc(o.k)}" aria-label="Open ${esc(o.k)} sites in the high-confidence atlas">${o.k.split('').map((b, i) => i === 2 ? `<b>${b}</b>` : b).join('')}<span aria-hidden="true">→</span></button></th><td><span class="motif-bar"><i style="width:${share * 600}%"></i></span>${(share * 100).toFixed(1)}%</td><td><span class="motif-bar calls"><i style="width:${callShare * 250}%"></i></span>${(callShare * 100).toFixed(1)}%</td><td>${enr.toFixed(enr < .1 ? 2 : 1)}×</td>${cells.map(c => cell(M.byCell[c].n[o.i], M.byCell[c].calls[ti][o.i], cellColour(c), c)).join('')}${cell(all.n[o.i], all.calls[ti][o.i], '#143b34', 'All lines')}</tr>`;
  }).join('');
  const top = order[0], topShare = totalCalls ? all.calls[ti][top.i] / totalCalls : 0;
  return `<div class="table-scroll"><table class="motif-table"><caption class="sr-only">Call rate per DRACH 5-mer and cell line</caption><thead>${head}</thead><tbody>${rows}</tbody></table></div><p class="panel-note">Every candidate site is a DRACH motif (D = A/G/U, R = A/G, H = A/C/U; the modified A is in bold). Rows are sorted by call rate across all lines; dot area scales with the call rate. ${esc(top.k)} makes up ${(topShare * 100).toFixed(0)}% of calls at cutoff ${cutoff}. Faded rows are never called by the model even though they cover many candidate sites, so a motif filter on them will return nothing. The order is the same in every cell line. <strong>Hover a dot for exact counts; click a motif to open its sites in the high-confidence atlas.</strong></p>`;
}

export function m6anetView(m, landscapeAll) {
  const a = m.agreement;
  const cards = [['Score correlation', a.spearman.toFixed(2), 'Median per-run Spearman, Dolly v2 vs m6Anet'], ['Shared calls', a.jaccard.toFixed(2), `Median Jaccard of calls (Dolly ≥ ${m.thresholds.dolly}, m6Anet ≥ ${m.thresholds.m6anet})`], ['Top-ranked overlap', (a.topK * 100).toFixed(0) + '%', 'Overlap of equally sized top-ranked site lists'], ['Without position features', a.v1RunSpearman.toFixed(2), 'Spearman for the MCF7 run scored by the v1 fallback']]
    .map(([k, v, s]) => `<div class="cross-stat"><small>${esc(k)}</small><strong class="cross-stat-value">${esc(v)}</strong><span>${esc(s)}</span></div>`).join('');
  const colours = { 'All sites': GREY, 'Dolly v2 calls': TEAL, 'm6Anet calls': M6ANET, 'Called by both': '#143b34' };
  const metrics = [['utr3', "In the 3′UTR"], ['cds', 'In the CDS'], ['nearStop', 'Within 200 nt of the stop codon'], ['utr5', "In the 5′UTR"]];
  const bars = metrics.map(([k, label]) => `<div class="m6a-group"><h4>${label}</h4>${m.regions.map(r => `<div class="m6a-row"${tip({ kicker: label, name: r.set, value: r[k].toFixed(1) + '%', unit: r.set === 'All sites' ? 'of candidate sites' : 'of calls', lines: r.set === 'All sites' ? [] : [`${(r[k] / m.regions[0][k]).toFixed(1)}× the share among all sites`], colour: colours[r.set] })} tabindex="0"><span>${esc(r.set)}</span><div class="bar-track"><i style="width:${r[k] / 70 * 100}%;background:${colours[r.set]}"></i></div><strong>${r[k].toFixed(1)}%</strong></div>`).join('')}</div>`).join('');
  const rep = m.reproducibility, bench = m.benchmark.map(b => `<tr><td>${esc(b.set)}</td><td>${b.m6anet[0].toFixed(3)} / ${b.m6anet[1].toFixed(3)}</td><td><strong>${b.dolly[0].toFixed(3)} / ${b.dolly[1].toFixed(3)}</strong></td></tr>`).join('');
  return `<div class="cross-stats four">${cards}</div>
  <div class="chart-grid insight-pair"><div><h3 class="insight-subhead">Where each method places its calls</h3><div class="m6a-bars">${bars}</div></div>
  <div><h3 class="insight-subhead">How the two methods differ</h3><ul class="insight-points"><li><strong>Both find the canonical landscape.</strong> Calls from both methods are about 2× enriched near the stop codon and favour GGACT (${m.motifs[0].dolly}× for Dolly, ${m.motifs[0].m6anet}× for m6Anet).</li><li><strong>m6Anet leans further into the 3′UTR</strong> (64% of calls vs 52%); Dolly keeps more CDS calls just upstream of the stop codon.</li><li><strong>The disagreement is mostly about transcript position.</strong> Sites Dolly scores high are almost always high for m6Anet. m6Anet also gives high probabilities to many sites Dolly scores low, typically ones in positions v2 has learned are rarely modified. Without position features (the v1-scored run), agreement rises from 0.64 to 0.78.</li><li><strong>Dolly ranks more reproducibly between runs</strong> (Spearman ${rep.spearman.dolly[0]} within / ${rep.spearman.dolly[1]} between cell lines vs ${rep.spearman.m6anet[0]} / ${rep.spearman.m6anet[1]}); binary calls are about equally stable.</li><li><strong>Both call more sites in bigger runs</strong> (r = ${m.depthR.dolly} Dolly, ${m.depthR.m6anet} m6Anet).</li></ul>
  <div class="table-scroll"><table><thead><tr><th>Labelled benchmark</th><th>m6Anet ROC / PR</th><th>Dolly v2 ROC / PR</th></tr></thead><tbody>${bench}</tbody></table></div></div></div>
  <figure class="insight-figure"><img src="data/sgnex_m6anet_comparison.png" alt="Four panels comparing Dolly v2 and m6Anet on 23 SG-NEx runs: site score density, metagene of calls, call rate against run depth, and run-to-run reproducibility" loading="lazy"><figcaption>Experiment 12 figure: (a) site scores of the two methods; (b) metagene of calls; (c) call rate vs run size; (d) run-to-run agreement of calls. Agreement is not accuracy. Two methods can share a bias. m6Anet's pretrained model was trained on SG-NEx HCT116.</figcaption></figure>
  <p class="fine-print">Source: ${esc(m.source)}. The per-site m6Anet scores are stored on the team's AWS machine, so this panel reports the experiment's summary numbers rather than an interactive per-site comparison.</p>`;
}

// ---------- Compare: reproducibility and fair cell-line comparison ----------
export function reproView(ins, { metric, depth, showExcluded, runName }) {
  const key = metric + (depth === 40 ? '40' : '');
  const runs = ins.perRun.map(r => r.id).filter(id => showExcluded || !ins.excludedRuns.includes(id)).sort((a, b) => cellOf(a).localeCompare(cellOf(b)) || a.localeCompare(b));
  const get = new Map(ins.pairs.map(p => [p.a + '|' + p.b, p]).concat(ins.pairs.map(p => [p.b + '|' + p.a, p])));
  const values = ins.pairs.filter(p => runs.includes(p.a) && runs.includes(p.b)).map(p => p[key]).filter(v => v !== null);
  const lo = Math.min(...values), hi = Math.max(...values);
  const size = 22, labelW = 116, n = runs.length, w = labelW + n * size + 10, h = labelW + n * size + 10;
  let svg = '';
  runs.forEach((id, i) => {
    const excluded = ins.excludedRuns.includes(id), c = cellColour(cellOf(id));
    svg += `<text x="${labelW - 6}" y="${labelW + i * size + size / 2 + 3}" text-anchor="end" style="fill:${c}${excluded ? ';font-style:italic' : ''}">${esc(runName(id))}${excluded ? ' ◌' : ''}</text>`;
    svg += `<text transform="translate(${labelW + i * size + size / 2 + 3} ${labelW - 6}) rotate(-60)" style="fill:${c}">${esc(runName(id))}</text>`;
    runs.forEach((other, j) => {
      const x = labelW + j * size, y = labelW + i * size;
      if (i === j) { svg += `<rect x="${x + 1}" y="${y + 1}" width="${size - 2}" height="${size - 2}" fill="#f0f2f3"/>`; return; }
      const p = get.get(id + '|' + other), v = p?.[key];
      const t = v === null || v === undefined ? null : (hi > lo ? (v - lo) / (hi - lo) : .5);
      const rel = p ? { rerun: 'same library re-run', replicate: 'same cell line, different replicate', cellLine: 'different cell lines' }[p.rel] : '';
      svg += `<rect class="repro-cell clickable" x="${x + 1}" y="${y + 1}" width="${size - 2}" height="${size - 2}" rx="2" fill="${t === null ? '#edf0eb' : `hsl(160 45% ${92 - t * 62}%)`}" ${cellOf(id) === cellOf(other) ? 'stroke="#143b34" stroke-width=".8"' : ''}${tip({ kicker: rel, name: `${runName(id)} × ${runName(other)}`, value: v === null || v === undefined ? '—' : v.toFixed(3), unit: metric === 'spearman' ? 'Spearman of scores' : 'Jaccard of calls', lines: [`${p ? fmt(p.shared) : 0} shared sites with ≥${depth} reads`], foot: 'Click to compare these two runs' })} data-pair-runs="${esc(id)}|${esc(other)}"/>`;
    });
  });
  const groups = ['rerun', 'replicate', 'cellLine'].map(rel => {
    const vals = ins.pairs.filter(p => p.rel === rel && !ins.excludedRuns.includes(p.a) && !ins.excludedRuns.includes(p.b)).map(p => p[key]).filter(v => v !== null).sort((a, b) => a - b);
    return { rel, n: vals.length, median: vals.length ? vals[Math.floor(vals.length / 2)] : null };
  });
  const names = { rerun: 'Same library, re-run', replicate: 'Same cell line, different replicate', cellLine: 'Different cell lines' };
  const v = ins.variance;
  return `<div class="cross-stats three">${groups.map(g => `<div class="cross-stat"><small>${names[g.rel]} · ${g.n} pairs</small><strong class="cross-stat-value">${g.median === null ? '—' : g.median.toFixed(3)}</strong><span>Median ${metric === 'spearman' ? 'Spearman of scores' : 'Jaccard of calls (score ≥ 0.5)'}</span></div>`).join('')}</div>
  <div class="repro-layout"><div class="table-scroll"><svg class="repro-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Agreement between every pair of runs">${svg}</svg></div>
  <div class="repro-side"><div class="matrix-key"><span>${lo.toFixed(2)} · lower</span><i></i><span>${hi.toFixed(2)} · higher</span></div><p class="fine-print">Each square compares two runs on the sites both measured with ≥${depth} reads. Outlined squares are pairs from the same cell line. <strong>Hover for values; click a square to open those two runs in Compare a pair.</strong> ${showExcluded ? '◌ marks the run scored without transcript-structure features, which is why its row looks different.' : ''}</p>
  <h3 class="insight-subhead">Where does score variation come from?</h3><div class="variance-bar" role="img" aria-label="Variance shares: site ${(v.site * 100).toFixed(1)}%, site by cell line ${(v.siteByCell * 100).toFixed(1)}%, run ${(v.run * 100).toFixed(1)}%"><span style="flex:${v.site}" class="v-site"${tip({ kicker: 'Variance share', name: 'Between sites', value: (v.site * 100).toFixed(1) + '%', unit: 'of score variance', lines: ['Sequence, transcript position and gene'] })}></span><span style="flex:${v.siteByCell}" class="v-cell"${tip({ kicker: 'Variance share', name: 'Site × cell line', value: (v.siteByCell * 100).toFixed(1) + '%', unit: 'of score variance', lines: ['A site scoring differently in different cell lines'] })}></span><span style="flex:${v.run}" class="v-run"${tip({ kicker: 'Variance share', name: 'Run to run', value: (v.run * 100).toFixed(1) + '%', unit: 'of score variance', lines: ['Runs of the same cell line disagreeing'] })}></span></div>
  <div class="variance-legend"><span><i class="v-site"></i>Between sites <strong>${(v.site * 100).toFixed(1)}%</strong></span><span><i class="v-cell"></i>Site × cell line <strong>${(v.siteByCell * 100).toFixed(1)}%</strong></span><span><i class="v-run"></i>Run to run <strong>${(v.run * 100).toFixed(1)}%</strong></span></div>
  <p class="fine-print">Sum-of-squares split of the score over ${fmt(v.sites)} sites measured in ≥2 runs of ≥2 cell lines. Whether a site is predicted as modified depends almost entirely on the site itself; cell-line differences are smaller than run-to-run noise.</p></div></div>
  <p class="panel-note">Re-sequencing the same library agrees no better than a new replicate, so SG-NEx replicates behave like technical repeats and cannot measure biological variability. About a third of binary calls change between two runs of the same cell line even though scores correlate at about 0.94: calls near the cutoff are unstable, so read scores rather than yes/no calls.</p>`;
}
const cellOf = id => (/^SGNex_([^_]+)_/.exec(id) || [])[1] || '';
function runShort(id) { const m = /^SGNex_([^_]+)_directRNA_replicate(\d+)_run(\d+)$/.exec(id); return m ? `${m[1]} · rep ${m[2]} · run ${m[3]}` : id; }

export function fairView(ins, cutoff) {
  const ti = thresholdIndex(cutoff), cells = ins.cellLines, S = ins.sharedCellLines;
  const rates = cells.map(c => ({ c, v: S.callRates[c].callRate[ti] / S.callRates[c].sites * 100, runs: ins.perRun.filter(r => r.cell === c && !r.limitations.includes('v1Fallback')).length }));
  const max = niceMax(Math.max(...rates.map(r => r.v)) * 1.15);
  const bars = rates.map(r => `<div class="fair-row"${tip({ kicker: 'Sites measured in all 7 lines', name: r.c + (r.c === TRAINING ? ' (training line)' : ''), value: r.v.toFixed(2) + '%', unit: `called at cutoff ${cutoff}`, lines: [`${fmt(S.callRates[r.c].sites)} sites · mean of ${r.runs} run${r.runs > 1 ? 's' : ''}`], colour: cellColour(r.c, 60) })} tabindex="0"><span style="color:${cellColour(r.c)};font-weight:600">${esc(r.c)}${r.c === TRAINING ? ' †' : ''}</span><div class="bar-track"><i style="width:${r.v / max * 100}%;background:${cellColour(r.c, 45)}"></i></div><span>${r.v.toFixed(2)}% <small>· ${r.runs} run${r.runs > 1 ? 's' : ''}</small></span></div>`).join('');
  const corr = `<table class="similarity-table corr-table"><thead><tr><th>Spearman</th>${cells.map(c => `<th style="color:${cellColour(c)}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${cells.map((c, i) => `<tr><th style="color:${cellColour(c)}">${esc(c)}</th>${cells.map((_, j) => { const v = S.spearman[i][j], t = (v - .93) / .05; const style = `background:${i === j ? '#f0f2f3' : `hsl(160 45% ${92 - Math.max(0, Math.min(1, t)) * 60}%)`};color:${i !== j && t > .7 ? 'white' : '#143b34'}`;
      return i === j ? `<td><span class="corr-cell" style="${style}">—</span></td>` : `<td><button type="button" class="corr-cell clickable" style="${style}" data-pair-lines="${esc(c)}|${esc(cells[j])}"${tip({ kicker: 'Spearman on shared sites', name: `${c} × ${cells[j]}`, value: v.toFixed(3), unit: 'rank correlation of cell-line means', foot: 'Click to compare these cell lines' })}>${v.toFixed(3)}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="chart-grid insight-pair"><div><h3 class="insight-subhead">Call rate on the same ${fmt(S.sites)} sites</h3><div class="fair-bars">${bars}</div><p class="panel-note">Cell-line mean score ≥ ${cutoff} on sites measured with ≥20 reads in all seven lines. Six lines sit within a narrow band. † Hct116, the training cell line, scores about 20% higher in all three of its runs and across every motif. The held-out labels show no Hct116 accuracy advantage, so this is more likely a calibration shift towards the training line than more m6A.</p></div>
  <div><h3 class="insight-subhead">Cell-line score correlation on the same sites</h3><div class="table-scroll">${corr}</div><p class="panel-note"><strong>Click a value to open that pair in Compare a pair.</strong> All pairs correlate at ρ ≥ 0.94. The pattern mostly tracks how many runs were averaged (MCF7 now has one usable run, H9 has six), not biology.</p></div></div>`;
}

export function diffView(ins, a, b) {
  const D = ins.differential;
  if (!D.cellLines.includes(a) || !D.cellLines.includes(b)) return `<p class="cross-status">${esc(!D.cellLines.includes(a) ? a : b)} has fewer than two usable runs, so run-level separation cannot be tested for this pair.</p>`;
  const idx = Object.fromEntries(D.columns.map((c, i) => [c, i]));
  const rows = D.rows.filter(r => (r[idx.cl_a] === a && r[idx.cl_b] === b) || (r[idx.cl_a] === b && r[idx.cl_b] === a));
  const fdrRows = D.fdr.map(f => `<tr><td>${f.level === 'strict' ? 'Every run ≥ 0.5 in one line and < 0.1 in the other' : `Mean difference ≥ ${f.minDelta}, runs fully separated`}</td><td>${fmt(f.observed)}</td><td>${f.nullMean} <small>(sd ${f.nullSd ?? '—'}, max ${f.nullMax})</small></td><td><strong>${Math.round(f.fdr * 100)}%</strong>${f.fdrSe ? ` <small>± ${Math.max(1, Math.round(f.fdrSe * 100))}</small>` : ''}</td></tr>`).join('');
  const rowHtml = r => `<tr><td>${geneCell(r[idx.gene])}</td><td>${esc(r[idx.tx])}</td><td>${fmt(r[idx.pos])}</td><td class="sequence">${esc(r[idx.kmer7])}</td><td>${esc(r[idx.region])}</td><td style="color:${cellColour(r[idx.cl_a])}">${esc(r[idx.cl_a])} ${r[idx.mean_a].toFixed(2)} <small>(n=${r[idx.size_a]}, min ${r[idx.min_a].toFixed(2)})</small></td><td style="color:${cellColour(r[idx.cl_b])}">${esc(r[idx.cl_b])} ${r[idx.mean_b].toFixed(2)} <small>(n=${r[idx.size_b]}, max ${r[idx.max_b].toFixed(2)})</small></td><td>${r[idx.delta].toFixed(2)}${r[idx.strict] ? ' <span class="pill ready">strict</span>' : ''}</td><td><button class="text-button" data-diff-open="${esc(r[idx.tx])}:${r[idx.pos]}">Inspect site / runs →</button></td></tr>`;
  const head = '<thead><tr><th>Gene</th><th>Transcript</th><th>Position</th><th>7-mer</th><th>Region</th><th>Higher line · mean</th><th>Lower line · mean</th><th>Δ mean</th><th></th></tr></thead>';
  const highA = rows.filter(r => r[idx.cl_a] === a).length;
  return `<div class="chart-grid insight-pair"><div><h3 class="insight-subhead">How many differences would chance produce?</h3><div class="table-scroll"><table><thead><tr><th>Criterion (≥2 runs per line, all 6 lines)</th><th>Sites found</th><th>Shuffled labels (mean)</th><th>Est. FDR ± s.e.</th></tr></thead><tbody>${fdrRows}</tbody></table></div><p class="fine-print">Null: run labels shuffled between the six cell lines with at least two usable runs (${D.permutations} permutations, group sizes kept; MCF7 has one usable run and is not tested). With technical runs only and a model trained on one line, a large share of "differential" sites are within run noise. Hct116 is the high line in most candidates, which reflects its calibration shift.</p></div>
  <div><h3 class="insight-subhead">Candidates for ${esc(a)} vs ${esc(b)}</h3><p class="cross-status">${fmt(rows.length)} candidate sites with a mean difference ≥ 0.2 where every run of one line scores above every run of the other (${highA} higher in ${esc(a)}, ${rows.length - highA} higher in ${esc(b)}). Gold rings mark them in the scatter above. Treat them as hypotheses to test, not findings.</p></div></div>
  ${rows.length ? `<div class="table-scroll"><table>${head}<tbody>${rows.slice(0, 8).map(rowHtml).join('')}</tbody></table></div>${rows.length > 8 ? `<details class="run-values"><summary>Show ${fmt(Math.min(rows.length, 60) - 8)} more of the largest differences</summary><div class="table-scroll"><table>${head}<tbody>${rows.slice(8, 60).map(rowHtml).join('')}</tbody></table></div>${rows.length > 60 ? `<p class="fine-print">${fmt(rows.length - 60)} smaller candidates not shown.</p>` : ''}</details>` : ''}` : ''}`;
}
export function diffKeys(ins, a, b) {
  const D = ins.differential, idx = Object.fromEntries(D.columns.map((c, i) => [c, i]));
  return new Set(D.rows.filter(r => (r[idx.cl_a] === a && r[idx.cl_b] === b) || (r[idx.cl_a] === b && r[idx.cl_b] === a)).map(r => r[idx.tx] + ':' + r[idx.pos]));
}

// ---------- Site explorer: transcript map ----------
export function transcriptMap(tx, ann, byCell, selected) {
  const cells = [...byCell.keys()].sort();
  const length = ann?.[0] ?? Math.max(...[...byCell.values()].flatMap(m => [...m.keys()])) + 50;
  const w = 900, l = 92, r = 18, top = 14, modelH = 34, rowH = 46, h = top + modelH + 16 + cells.length * rowH + 26, x = v => l + v / length * (w - l - r);
  let svg = '';
  if (ann) {
    const [, cds, stop, junctions] = ann, mid = top + modelH / 2;
    svg += `<line x1="${x(0)}" y1="${mid}" x2="${x(length)}" y2="${mid}" stroke="#c9d6cc" stroke-width="2"/>`;
    if (cds !== null && stop !== null) {
      svg += `<rect x="${x(0)}" y="${mid - 5}" width="${x(cds) - x(0)}" height="10" rx="2" fill="#cfe3d7"${tip({ kicker: tx, name: "5′UTR", lines: [`positions 0–${fmt(cds)} (${fmt(cds)} nt)`] })}/><rect x="${x(cds)}" y="${mid - 10}" width="${x(stop + 3) - x(cds)}" height="20" rx="3" fill="#7fb69e"${tip({ kicker: tx, name: 'Coding sequence (CDS)', lines: [`positions ${fmt(cds)}–${fmt(stop + 3)} (${fmt(stop + 3 - cds)} nt)`, `${junctions.length + 1} exon${junctions.length ? 's' : ''} in the transcript`] })}/><rect x="${x(stop + 3)}" y="${mid - 5}" width="${x(length) - x(stop + 3)}" height="10" rx="2" fill="#cfe3d7"${tip({ kicker: tx, name: "3′UTR", lines: [`positions ${fmt(stop + 3)}–${fmt(length)} (${fmt(length - stop - 3)} nt)`] })}/>`;
      svg += `<line x1="${x(stop)}" y1="${mid - 15}" x2="${x(stop)}" y2="${h - 24}" stroke="#e7ad43" stroke-dasharray="3 4"/><text x="${x(stop) + 4}" y="${top + 2}" style="fill:#896325">stop</text>`;
    } else svg += `<rect x="${x(0)}" y="${mid - 6}" width="${x(length) - x(0)}" height="12" rx="2" fill="#cfe3d7"${tip({ kicker: tx, name: 'Non-coding transcript', lines: [`${fmt(length)} nt`] })}/>`;
    for (const j of junctions) svg += `<line x1="${x(j)}" y1="${mid - 13}" x2="${x(j)}" y2="${mid + 13}" stroke="#143b34" stroke-width="2.5"${tip({ kicker: tx, name: 'Exon–exon junction', lines: [`at position ${fmt(j)}`] })}/>`;
    svg += `<text x="${l - 8}" y="${mid + 4}" text-anchor="end">Transcript</text>`;
  }
  const base0 = top + modelH + 16;
  cells.forEach((c, i) => {
    const y0 = base0 + i * rowH, base = y0 + rowH - 8, sc = v => base - v * (rowH - 14), colour = cellColour(c);
    svg += `<text x="${l - 8}" y="${base - 12}" text-anchor="end" style="fill:${colour};font-weight:600">${esc(c)}</text><line x1="${l}" y1="${base}" x2="${w - r}" y2="${base}" stroke="#e5ece5"/><line x1="${l}" y1="${sc(.5)}" x2="${w - r}" y2="${sc(.5)}" stroke="#f0f3ee" stroke-dasharray="2 4"/>`;
    for (const [pos, q] of [...byCell.get(c)].sort((a, b) => a[0] - b[0])) {
      const cx = x(pos), sel = pos === selected;
      if (q.max > q.min) svg += `<line x1="${cx}" y1="${sc(q.min)}" x2="${cx}" y2="${sc(q.max)}" stroke="${colour}" stroke-opacity=".35" stroke-width="3"/>`;
      svg += `<line x1="${cx}" y1="${base}" x2="${cx}" y2="${sc(q.mean)}" stroke="${colour}" stroke-opacity="${q.mean >= .5 ? .9 : .35}" stroke-width="1"/>`;
      svg += `<circle class="map-dot${sel ? ' selected' : ''}" data-map-pos="${pos}" tabindex="0" cx="${cx}" cy="${sc(q.mean)}" r="${sel ? 6 : q.mean >= .5 ? 4.2 : 2.8}" fill="${q.mean >= .5 ? colour : 'white'}" stroke="${sel ? '#e7ad43' : colour}" stroke-width="${sel ? 2.5 : 1.2}"${tip({ kicker: `${c} · position ${fmt(pos)}`, name: q.seq || `Position ${fmt(pos)}`, value: q.mean.toFixed(3), unit: `mean over ${q.n} run${q.n > 1 ? 's' : ''}`, lines: q.n > 1 ? [`range across runs ${q.min.toFixed(2)}–${q.max.toFixed(2)}`] : [], foot: 'Click to inspect every run at this position', colour: cellColour(c, 60) })}/>`;
    }
  });
  svg += [0, .25, .5, .75, 1].map(f => `<text x="${x(length * f)}" y="${h - 8}" text-anchor="middle">${fmt(Math.round(length * f))}</text>`).join('');
  return `<svg class="transcript-map-svg" viewBox="0 0 ${w} ${h}" role="group" aria-label="Transcript map of ${esc(tx)}: predicted sites by cell line">${svg}</svg>`;
}

// ---------- Atlas ----------
export function atlasRows(atlas, f) {
  const q = (f.search || '').trim().toLowerCase();
  return atlas.rows.filter(r => (f.set === 'all7' ? r[9] : true) && (f.region === 'all' || r[4] === f.region)
    && (f.motif === 'all' || r[3].slice(1, 6) === f.motif) && (!q || `${r[0]} ${r[2]} ${geneName(r[2])} ${r[3]}`.toLowerCase().includes(q)));
}
export function atlasTable(atlas, rows, limit) {
  const cells = atlas.cellLines;
  return `<div class="table-scroll"><table class="atlas-table"><thead><tr><th>#</th><th>Gene</th><th>Transcript / position</th><th>7-mer</th><th>Region</th><th>To stop codon</th><th>Runs called</th>${cells.map(c => `<th style="color:${cellColour(c)}">${esc(c)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.slice(0, limit).map((r, i) => `<tr><td>${i + 1}</td><td>${geneCell(r[2])}</td><td>${esc(r[0])}<br><small>Position ${fmt(r[1])}</small></td><td class="sequence">${esc(r[3])}</td><td>${esc(r[4])}</td><td>${r[5] === null ? '—' : (r[5] > 0 ? '+' : '') + fmt(r[5]) + ' nt'}</td><td>${r[7]} / ${r[6]}${r[9] ? ' <span class="pill ready">all 7 lines</span>' : ''}</td>${r[8].map(v => `<td><span class="atlas-cell" style="background:${v === null ? '#edf0eb' : `hsl(160 48% ${96 - v * 65}%)`};color:${v !== null && v >= .65 ? '#fff' : '#143b34'}">${v === null ? '—' : v.toFixed(2)}</span></td>`).join('')}<td><button class="text-button" data-hc-open="${esc(r[0])}:${r[1]}">Inspect →</button></td></tr>`).join('') || `<tr><td colspan="${8 + cells.length}">No sites match these filters.</td></tr>`}</tbody></table></div>`;
}
