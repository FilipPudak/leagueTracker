import { readFileSync } from 'node:fs';
import { qrSvg } from './qr.mjs';

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

const ICONS = {
  ruler: { file: 'medal.svg', cls: '' },
  schemer: { file: 'cards.svg', cls: ' cards' },
  ambassador: { file: 'ballot.svg', cls: '' },
  newHope: { file: 'rebel.svg', cls: ' rebel' },
  bountyHunter: { file: 'boba-fett.svg', cls: '' },
  champion: { file: 'crossed-lightsabers.svg', cls: '' },
};

function esc(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function pct(value, total) {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function icon(name, assets) {
  const iconSet = ICONS[name];
  const url = `${assets}/icons/${iconSet.file}`;
  const mask = `-webkit-mask-image:url('${url}');mask-image:url('${url}')`;
  return `<div class="ic${iconSet.cls}" style="${mask}"></div>`;
}

function aspectIcons(assets, aspects) {
  return aspects.map((a) => `<img src="${assets}/img/swu/SWH_Aspects_${a}.png" alt="${a}">`).join('');
}

function boardRow(row, highlight) {
  return `<div class="brow${highlight ? ' top' : ''}">
          <div class="pos">${row.pos}</div>
          <div class="who"><div class="nm">${esc(row.name)}</div><div class="rec">${row.record}</div></div>
          <div class="pts">${row.points}<small>PTS</small></div>
        </div>`;
}

function board(model) {
  return `<div class="board ${model.kind}">
        <div class="board-head"><span class="bdg">${esc(model.label)}</span><span class="sub">${model.sub}</span></div>
${model.rows.map((row) => boardRow(row, model.highlightTop && row.pos === 1)).join('\n        ')}
      </div>`;
}

function awardTile(tile, assets) {
  return `<div class="aw${tile.cls}">
        <div class="top-line">
          ${icon(tile.icon, assets)}
          <div class="lbl">${esc(tile.label)}</div>
        </div>
        <div class="who${tile.who.length > 34 ? ' tight' : ''}">${esc(tile.who)}</div>
        <div class="val">${tile.value}</div>
      </div>`;
}

function leaderRows(reference, rows, assets) {
  if (!rows.length) return '';
  return rows
    .map(
      (row) => `<div class="lrow">
        <div class="id"><div class="nm">${esc(row.name)}</div><div class="asp">${aspectIcons(assets, row.aspects)}</div></div>
        <div class="track"><div class="fill${row.accent ? ` ${row.accent}` : ''}" style="width:${pct(row.value, reference)}"></div></div>
        <div class="n${row.accent ? ` ${row.accent}` : ''}">${row.display}</div>
      </div>`,
    )
    .join('\n      ');
}

function nightsChart(nights) {
  const peak = Math.max(...nights.map((n) => n.value));
  return `<div class="bar-vals">
        ${nights.map((n) => `<span${n.value === peak ? ' class="peak"' : ''}>${n.value}</span>`).join('')}
      </div>
      <div class="chart">
        ${nights.map((n) => `<div class="bar-wrap"><div class="bar${n.value === peak ? ' peak' : ''}" style="height:${((n.value / peak) * 100).toFixed(1)}%"></div></div>`).join('\n        ')}
      </div>
      <div class="bar-x">
        ${nights.map((n) => `<span>${esc(n.label)}</span>`).join('')}
      </div>`;
}

function comboRow(row, assets) {
  const segments = row.segments
    .filter((segment) => segment.count > 0)
    .map((segment) => {
      if (segment.share < 0.04) {
        return `<div class="cseg tiny" data-aspect="${segment.aspect}" style="width:${pct(segment.count, row.total)}"></div>`;
      }
      const badge = `<img src="${assets}/img/swu/SWH_Aspects_${segment.aspect}.png" alt="${segment.aspect}">`;
      return `<div class="cseg" data-aspect="${segment.aspect}" style="width:${pct(segment.count, row.total)}">${badge}<span>${segment.count}</span></div>`;
    })
    .join('');
  return `<div class="crow ${row.label.toLowerCase()}">
        <span class="clab">${esc(row.label)}</span>
        <div class="cbar">${segments}</div>
      </div>`;
}

function aspectBars(aspects, assets) {
  const heroismWidth = pct(aspects.heroism, aspects.total);
  const villainyWidth = pct(aspects.villainy, aspects.total);
  const neitherWidth = pct(aspects.neither, aspects.total);
  const heroismPct = aspects.total ? (aspects.heroism / aspects.total) * 100 : 0;
  const neitherPct = aspects.total ? (aspects.neither / aspects.total) * 100 : 0;
  const neitherSeg = aspects.neither
    ? `<div class="seg n0" style="width:${neitherWidth}">${aspects.neither}</div>`
    : '';
  const villainyLabel =
    aspects.villainy && heroismPct + neitherPct < 80
      ? `<span class="b" style="left:${Math.max(11, Math.min(89, heroismPct))}%">Villainy</span>`
      : '';
  const neitherLabel = aspects.neither ? '<span class="c">Neither</span>' : '';
  const bars = aspects.total
    ? `<div class="split">
      <div class="seg h" style="width:${heroismWidth}">${aspects.heroism}</div>
      <div class="seg v" style="width:${villainyWidth}">${aspects.villainy}</div>
      ${neitherSeg}
    </div>
    <div class="legend">
      <span class="a">Heroism</span>${villainyLabel}${neitherLabel}
    </div>`
    : '';
  return `${bars}
    <div class="combos">
      ${aspects.total ? aspects.combos.filter((row) => row.total > 0).map((row) => comboRow(row, assets)).join('\n      ') : ''}
    </div>
    <div class="lines">
      <div>Leaders used: <b>${esc(aspects.leaderLine)}</b></div>
      ${aspects.setLine ? `<div>Sets: <b>${esc(aspects.setLine)}</b></div>` : ''}
    </div>`;
}

export function renderRecap(model, assets) {
  const hero = model.hero
    .map((stat) => `<div><b>${stat.value}</b><span>${esc(stat.label)}</span></div>`)
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(model.title)}</title>
<style>
${CSS.replaceAll('__ASSETS__', assets)}</style>
</head>
<body${model.foot.qr ? ' class="with-qr"' : ''}>
  <div class="layer">
    <div class="eyebrow">${esc(model.eyebrow)}</div>
    <h1 class="title">SEASON <span class="thin">${model.seasonId}</span></h1>
    <div class="subline">
      <span>${esc(model.subtitle)}</span><span class="dot"></span>
      <span>${model.nightCount} nights</span><span class="dot"></span>
      <span>${model.range}</span>
    </div>
  </div>

  <div class="hero layer">
    ${hero}
  </div>

  <div class="layer">
    <div class="sec-head">
      <h2>${esc(model.finalHead)}</h2>
      <i>${model.finalSub}</i>
    </div>
    <div class="duo">
      ${model.boards.map((b) => board(b)).join('\n      ')}
    </div>
  </div>

  <div class="layer">
    <div class="sec-head"><h2>Awards</h2>${model.awardsNote ? `<i>${esc(model.awardsNote)}</i>` : ''}</div>
    <div class="awards">
      ${model.awards.map((tile) => awardTile(tile, assets)).join('\n      ')}
    </div>
  </div>

  <div class="layer">
    <div class="sec-head"><h2>The Nights</h2><i>Players per night</i></div>
    <div class="nights">
      ${nightsChart(model.nights)}
    </div>
  </div>

  <div class="meta layer">
    <div class="card">
      <h3><span>${esc(model.mostPlayed.head)}</span><em>${esc(model.mostPlayed.note)}</em></h3>
      ${leaderRows(Math.max(1, ...model.mostPlayed.rows.map((row) => row.value)), model.mostPlayed.rows, assets)}
    </div>
    <div class="card">
      <h3><span>${esc(model.bestPerforming.head)}</span><em>${esc(model.bestPerforming.note)}</em></h3>
      ${leaderRows(100, model.bestPerforming.rows, assets)}
    </div>
  </div>

  <div class="card aspects layer">
    <div class="head">
      <h3>${esc(model.aspects.head)}</h3>
      <em>${esc(model.aspects.note)}</em>
    </div>
    ${aspectBars(model.aspects, assets)}
  </div>

  <div class="foot layer">
    <div class="foot-text">
      <span>${esc(model.foot.left)}</span>
      ${model.foot.qr ? `<span class="hint">Scan for the full results</span>` : ''}
      <span class="url">${esc(model.foot.url)}</span>
    </div>
    ${model.foot.qr ? `<div class="qr">${qrSvg(model.foot.qr, { size: 144 })}</div>` : ''}
  </div>
</body>
</html>
`;
}
