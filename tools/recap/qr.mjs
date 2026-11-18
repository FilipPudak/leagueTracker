const ECC_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

const BLOCKS = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const G15 = 0x537;
const G18 = 0x1f25;
const G15_MASK = 0x5412;

const exp = new Uint8Array(512);
const log = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
})();

function mul(a, b) {
  if (!a || !b) return 0;
  return exp[log[a] + log[b]];
}

function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], exp[i]);
    }
    poly = next;
  }
  return poly;
}

function encodeBlock(data, ecLength) {
  const gen = generatorPoly(ecLength);
  const remainder = new Array(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecLength; i += 1) remainder[i] ^= mul(gen[i + 1], factor);
  }
  return remainder;
}

function capacity(version) {
  return BLOCKS[version].groups.reduce((sum, [count, length]) => sum + count * length, 0);
}

function pickVersion(byteLength) {
  for (let version = 1; version <= 10; version += 1) {
    const headerBits = 4 + (version <= 9 ? 8 : 16);
    if (capacity(version) * 8 >= headerBits + byteLength * 8) return version;
  }
  throw new Error(`payload too long for QR version 10-M (${byteLength} bytes)`);
}

function dataCodewords(bytes, version) {
  const total = capacity(version);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const pad = [0xec, 0x11];
  for (let i = 0; words.length < total; i += 1) words.push(pad[i % 2]);
  return words;
}

function interleave(words, version) {
  const { ec, groups } = BLOCKS[version];
  const blocks = [];
  let offset = 0;
  for (const [count, length] of groups) {
    for (let i = 0; i < count; i += 1) {
      const data = words.slice(offset, offset + length);
      offset += length;
      blocks.push({ data, ec: encodeBlock(data, ec) });
    }
  }
  const out = [];
  const widest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < widest; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ec; i += 1) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

function bchDigit(value) {
  let digit = 0;
  let rest = value;
  while (rest !== 0) {
    digit += 1;
    rest >>>= 1;
  }
  return digit;
}

function bchRemainder(data, generator, bits) {
  let value = data << bits;
  while (bchDigit(value) - bchDigit(generator) >= 0) value ^= generator << (bchDigit(value) - bchDigit(generator));
  return value;
}

function typeInfo(mask) {
  const data = (ECC_LEVEL_BITS.M << 3) | mask;
  return (data << 10) | bchRemainder(data, G15, 10);
}

function typeVersion(version) {
  return (version << 12) | bchRemainder(version, G18, 12);
}

function formatBits(value) {
  return value ^ G15_MASK;
}

function maskFn(pattern, row, col) {
  switch (pattern) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function blank(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function placeFinder(modules, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= modules.length || x >= modules.length) continue;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const border = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      modules[y][x] = inside && (border || core);
    }
  }
}

function placeAlignment(modules, version) {
  const positions = ALIGNMENT[version];
  const last = modules.length - 7;
  for (const row of positions) {
    for (const col of positions) {
      if ((row === 6 && col === 6) || (row === 6 && col === last) || (row === last && col === 6)) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const edge = Math.abs(r) === 2 || Math.abs(c) === 2;
          const centre = r === 0 && c === 0;
          modules[row + r][col + c] = edge || centre;
        }
      }
    }
  }
}

function placeTiming(modules) {
  const size = modules.length;
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    modules[6][i] = dark;
    modules[i][6] = dark;
  }
}

function reserveFormat(modules, version) {
  const size = modules.length;
  for (let i = 0; i < 9; i += 1) {
    if (modules[8][i] === null) modules[8][i] = false;
    if (modules[i][8] === null) modules[i][8] = false;
  }
  for (let i = 0; i < 8; i += 1) {
    modules[8][size - 1 - i] = false;
    modules[size - 1 - i][8] = false;
  }
  modules[size - 8][8] = true;
  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        modules[size - 11 + j][i] = false;
        modules[i][size - 11 + j] = false;
      }
    }
  }
}

function placeData(modules, codewords, version, pattern) {
  const size = modules.length;
  let byteIndex = 0;
  let bitIndex = 7;
  let row = size - 1;
  let direction = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        const x = col - c;
        if (modules[row][x] !== null) continue;
        let dark = false;
        if (byteIndex < codewords.length) dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        if (maskFn(pattern, row, x)) dark = !dark;
        modules[row][x] = dark;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
  const remainder = REMAINDER_BITS[version];
  if (remainder) {
    let placed = 0;
    for (let r = size - 1; r >= 0 && placed < remainder; r -= 1) {
      for (let c = size - 1; c >= 0 && placed < remainder; c -= 1) {
        if (modules[r][c] === null) {
          modules[r][c] = false;
          placed += 1;
        }
      }
    }
  }
}

function placeFormat(modules, mask) {
  const size = modules.length;
  const bits = formatBits(typeInfo(mask));
  for (let i = 0; i < 15; i += 1) {
    const bit = ((bits >> i) & 1) === 1;
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[size - 15 + i][8] = bit;
  }
  for (let i = 0; i < 15; i += 1) {
    const bit = ((bits >> i) & 1) === 1;
    if (i < 8) modules[8][size - i - 1] = bit;
    else if (i < 9) modules[8][15 - i - 1 + 1] = bit;
    else modules[8][15 - i - 1] = bit;
  }
  modules[size - 8][8] = true;
}

function placeVersion(modules, version) {
  if (version < 7) return;
  const size = modules.length;
  const bits = typeVersion(version);
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >> i) & 1) === 1;
    modules[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
    modules[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
  }
}

function penalty(modules) {
  const size = modules.length;
  let score = 0;
  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };
  const finderScore = (line) => {
    let total = 0;
    for (let i = 0; i + 10 < line.length; i += 1) {
      const window = line.slice(i, i + 11);
      if (window.join('') === '10111010000' || window.join('') === '00001011101') total += 40;
    }
    return total;
  };
  const rows = modules.map((row) => row.map((cell) => (cell ? 1 : 0)));
  const cols = rows[0].map((_, c) => rows.map((row) => row[c]));
  for (const line of [...rows, ...cols]) {
    score += runScore(line);
    score += finderScore(line);
  }
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const value = rows[r][c];
      if (value === rows[r][c + 1] && value === rows[r + 1][c] && value === rows[r + 1][c + 1]) score += 3;
    }
  }
  const dark = rows.reduce((sum, row) => sum + row.filter((cell) => cell === 1).length, 0);
  const ratio = Math.abs((dark / (size * size)) * 100 - 50);
  score += Math.floor(ratio / 5) * 10;
  return score;
}

function buildMatrix(text, forcedMask) {  const bytes = [...new TextEncoder().encode(text)];
  const version = pickVersion(bytes.length);
  const codewords = interleave(dataCodewords(bytes, version), version);
  const size = 17 + version * 4;
  let best = null;

  for (let pattern = 0; pattern < 8; pattern += 1) {
    if (forcedMask !== undefined && forcedMask !== pattern) continue;
    const modules = blank(size);
    placeFinder(modules, 0, 0);
    placeFinder(modules, size - 7, 0);
    placeFinder(modules, 0, size - 7);
    placeAlignment(modules, version);
    placeTiming(modules);
    reserveFormat(modules, version);
    placeVersion(modules, version);
    placeData(modules, codewords, version, pattern);
    placeFormat(modules, pattern);
    const score = penalty(modules);
    if (!best || score < best.score) best = { score, modules };
  }
  return { version, size, modules: best.modules };
}

export function qrSvg(text, options = {}) {
  const { margin = 4, size = 164, dark = '#0b1220', light = '#f8fafc' } = options;
  const { modules, size: count } = buildMatrix(text);
  const extent = count + margin * 2;
  let path = '';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (modules[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${extent}" height="${extent}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
