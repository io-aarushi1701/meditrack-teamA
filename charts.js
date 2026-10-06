// Minimal SVG charts: stacked/single columns and horizontal bars, with hover tooltips and a table view.
import { esc } from './ui.js';

const H = 240, TICKS = 4, PAD = { top: 18, right: 8, bottom: 28, left: 36 };
const BAR_MAX = 28, GAP = 2, RADIUS = 4;

// axis max that divides into TICKS whole, round steps (1, 2, 5, 10, 20, 50…)
function niceMax(value) {
  const raw = Math.max(1, value) / TICKS;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
  return Math.max(1, Math.round(step)) * TICKS;
}

// rect with only the top corners rounded (data end), square at the baseline
function topRounded(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function axes(W, max, ticks = TICKS) {
  const innerH = H - PAD.top - PAD.bottom;
  let out = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = PAD.top + innerH - (v / max) * innerH;
    out += `<line class="${i === 0 ? 'baseline' : 'grid-line'}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}"/>`;
    out += `<text x="${PAD.left - 8}" y="${y + 4}" text-anchor="end">${Math.round(v).toLocaleString()}</text>`;
  }
  return out;
}

function tooltipHandlers(container, tip, rows) {
  container.querySelectorAll('.hit').forEach(hit => {
    const i = +hit.dataset.i;
    hit.addEventListener('mousemove', e => {
      tip.innerHTML = rows(i);
      tip.classList.remove('hidden');
      const box = container.getBoundingClientRect();
      let x = e.clientX - box.left + 14;
      if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 14;
      tip.style.left = x + 'px';
      tip.style.top = Math.max(0, e.clientY - box.top - tip.offsetHeight / 2) + 'px';
      container.querySelectorAll('.bar-group').forEach(g => g.classList.toggle('hover', +g.dataset.i === i));
    });
    hit.addEventListener('mouseleave', () => {
      tip.classList.add('hidden');
      container.querySelectorAll('.bar-group').forEach(g => g.classList.remove('hover'));
    });
  });
}

function withTableToggle(container, chartHtml, tableHtml) {
  container.innerHTML = `
    <div class="row between" style="margin-bottom:8px">
      <div class="legend-slot"></div>
      <div class="seg" role="tablist">
        <button class="active" data-view="chart">Chart</button><button data-view="table">Table</button>
      </div>
    </div>
    <div class="chart" data-pane="chart"><div class="tooltip hidden"></div></div>
    <div class="table-wrap hidden" data-pane="table">${tableHtml}</div>`;
  container.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    container.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === btn));
    container.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== btn.dataset.view));
  }));
  const chart = container.querySelector('.chart');
  const W = Math.max(300, Math.round(chart.clientWidth || 640));
  chart.insertAdjacentHTML('afterbegin', chartHtml(W));
  return chart;
}

/**
 * Stacked column chart.
 * series: [{ label, color: 'var(--series-1)', values: [..] }] in fixed slot order.
 */
export function stackedColumns(container, { categories, series }) {
  const totals = categories.map((_, i) => series.reduce((s, ser) => s + ser.values[i], 0));
  const max = niceMax(Math.max(1, ...totals));
  const svgFor = W => {
  const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom;
  const band = innerW / categories.length;
  const bw = Math.min(BAR_MAX, band * 0.6);
  const scale = v => (v / max) * innerH;

  let bars = '', hits = '', labels = '';
  categories.forEach((cat, i) => {
    const x = PAD.left + band * i + (band - bw) / 2;
    let y = PAD.top + innerH;
    const visible = series.map((s, k) => ({ v: s.values[i], k })).filter(s => s.v > 0);
    let group = '';
    visible.forEach((s, idx) => {
      const h = scale(s.v);
      const isTop = idx === visible.length - 1;
      const segH = Math.max(0, h - (idx > 0 ? GAP : 0));
      const top = y - h;
      group += isTop
        ? `<path d="${topRounded(x, top, bw, segH, RADIUS)}" fill="${series[s.k].color}"/>`
        : `<rect x="${x}" y="${top}" width="${bw}" height="${segH}" fill="${series[s.k].color}"/>`;
      y = top;
    });
    bars += `<g class="bar-group" data-i="${i}">${group}</g>`;
    if (totals[i] > 0) labels += `<text class="value-label" x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${totals[i]}</text>`;
    labels += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(cat)}</text>`;
    hits += `<rect class="hit" data-i="${i}" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${innerH}"/>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Stacked column chart">${axes(W, max)}${bars}${labels}${hits}</svg>`;
  };
  const table = `<table><thead><tr><th>Month</th>${series.map(s => `<th class="num">${esc(s.label)}</th>`).join('')}<th class="num">Total</th></tr></thead>
    <tbody>${categories.map((c, i) => `<tr><td>${esc(c)}</td>${series.map(s => `<td class="num">${s.values[i]}</td>`).join('')}<td class="num"><b>${totals[i]}</b></td></tr>`).join('')}</tbody></table>`;

  const chart = withTableToggle(container, svgFor, table);
  container.querySelector('.legend-slot').innerHTML = `<div class="legend" style="margin:0">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
  const tip = chart.querySelector('.tooltip');
  tooltipHandlers(chart, tip, i => `<b>${esc(categories[i])}</b>${series.slice().reverse().map(s =>
    `<div class="t-row"><span><i style="background:${s.color}"></i>${esc(s.label)}</span><b style="margin:0">${s.values[i]}</b></div>`).join('')}
    <div class="t-row" style="margin-top:4px;border-top:1px solid var(--border);padding-top:4px"><span>Total</span><b style="margin:0">${totals[i]}</b></div>`);
}

/** Single-series column chart (no legend: the card title names the series). */
export function columns(container, { categories, values, label = 'Count' }) {
  const max = niceMax(Math.max(1, ...values));
  const svgFor = W => {
  const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom;
  const band = innerW / categories.length;
  const bw = Math.min(BAR_MAX, band * 0.6);
  let bars = '', labels = '', hits = '';
  categories.forEach((cat, i) => {
    const h = (values[i] / max) * innerH;
    const x = PAD.left + band * i + (band - bw) / 2;
    const y = PAD.top + innerH - h;
    bars += `<g class="bar-group" data-i="${i}"><path d="${topRounded(x, y, bw, h, RADIUS)}" fill="var(--series-1)"/></g>`;
    labels += `<text class="value-label" x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${values[i]}</text>`;
    labels += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(cat)}</text>`;
    hits += `<rect class="hit" data-i="${i}" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${innerH}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)} column chart">${axes(W, max)}${bars}${labels}${hits}</svg>`;
  };
  const table = `<table><thead><tr><th>Group</th><th class="num">${esc(label)}</th></tr></thead>
    <tbody>${categories.map((c, i) => `<tr><td>${esc(c)}</td><td class="num">${values[i]}</td></tr>`).join('')}</tbody></table>`;
  const chart = withTableToggle(container, svgFor, table);
  const tip = chart.querySelector('.tooltip');
  tooltipHandlers(chart, tip, i => `<b>${esc(categories[i])}</b><div class="t-row"><span>${esc(label)}</span><b style="margin:0">${values[i]}</b></div>`);
}

/** Horizontal bars in HTML — label, bar, value. items: [{ label, value }] */
export function hbars(container, items) {
  if (!items.length) { container.innerHTML = '<div class="empty">No data yet</div>'; return; }
  const max = Math.max(1, ...items.map(i => i.value));
  container.innerHTML = `<div class="hbars">${items.map(i => `
    <div class="hbar" title="${esc(i.label)}: ${i.value}">
      <span class="name">${esc(i.label)}</span>
      <div class="track"><div class="fill" style="width:${(i.value / max) * 100}%"></div></div>
      <span class="n">${i.value}</span>
    </div>`).join('')}</div>`;
}
