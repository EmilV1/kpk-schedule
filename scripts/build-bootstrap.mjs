import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

const readJson = async (name) =>
  JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));

const [meta, groups, teachers] = await Promise.all([
  readJson('meta.json'),
  readJson('groups.json'),
  readJson('teachers.json'),
]);
const roomsConfig = await readFile(path.join(dataDir, 'rooms.json'), 'utf8');
const rooms = JSON.parse(roomsConfig);

const payload = {
  meta,
  groups,
  teachers,
  rooms,
  timezone: 'Europe/Moscow',
  generatedAt: new Date().toISOString(),
};

const outDir = path.join(root, 'public', 'data');
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, 'bootstrap.json');
await writeFile(outFile, JSON.stringify(payload), 'utf8');
await writeFile(path.join(outDir, 'rooms.json'), roomsConfig, 'utf8');

console.log(
  `bootstrap.json: ${groups.length} групп, ${teachers.length} преподавателей, ` +
    `${teachers.filter((teacher) => teacher.photo).length} фото`
);
