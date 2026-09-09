// Synthetic fixture only. Output stays in the ignored build directory.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('src-tauri/target/qa');
mkdirSync(directory, { recursive: true });
const rows = ['time,signal'];
for (let i = 0; i < 500_000; i++) {
  const noise = ((i * 7919 % 1009) / 1009 - 0.5) * 0.002;
  const level = i % 1000 >= 400 && i % 1000 < 550 ? 0.35 : 0;
  rows.push(`${i},${(level + noise).toFixed(6)}`);
}
const path = resolve(directory, 'synthetic-500k.csv');
writeFileSync(path, rows.join('\n'));
console.log(path);
