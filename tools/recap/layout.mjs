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

function aspectBars(aspects) {
  const heroismWidth = pct(aspects.heroism, aspects.total);
  const villainyWidth = pct(aspects.villainy, aspects.total);
  const villainyLabel = `${Math.max(11, Math.min(89, parseFloat(heroismWidth) || 0))}%`;
  const neitherSeg = aspects.neither
    ? `<div class="seg n0" style="width:${pct(aspects.neither, aspects.total)}">${aspects.neither}</div>`
    : '';
  const neitherLabel = aspects.neither ? '<span class="c">Neither</span>' : '';
  return `<div class="split">
      <div class="seg h" style="width:${heroismWidth}">${aspects.heroism}</div>
      <div class="seg v" style="width:${villainyWidth}">${aspects.villainy}</div>
      ${neitherSeg}
    </div>
    <div class="legend">
      <span class="a">Heroism</span><span class="b" style="left:${villainyLabel}">Villainy</span>${neitherLabel}
    </div>
    <div class="lines">
      <div>Aspect slots: <b>${aspects.slotLine}</b></div>
      <div>Sets: <b>${aspects.setLine}</b></div>
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
${CSS}</style>
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
    </div>
    ${aspectBars(model.aspects)}
  </div>

  <div class="foot layer">
    <div class="foot-text">
      <span>${esc(model.foot.left)}</span>
      ${model.foot.qr ? `<span class="hint">Scan for the full results</span>` : ''}
      <span class="url">${esc(model.foot.url)}</span>
    </div>
    ${model.foot.qr ? `<div class="qr">${qrSvg(model.foot.qr, { size: 168 })}</div>` : ''}
  </div>
</body>
</html>
`;
}
