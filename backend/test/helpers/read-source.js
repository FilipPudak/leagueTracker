import { readFileSync } from 'node:fs';

export function readSource(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
