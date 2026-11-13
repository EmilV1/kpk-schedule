import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- мок Cloudflare Cache API -------------------------------------------------
const store = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const hit = store.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      store.set(request.url, response.clone());
    },
    async delete(request) {
      return store.delete(request.url);
    },
  },
};

// --- мок Workers Assets -------------------------------------------------------
const env = {
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/data/bootstrap.json') {
        const body = fs.readFileSync(path.join(root, 'public', 'data', 'bootstrap.json'));
        return new Response(body, {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (url.pathname === '/data/rooms.json') {
        const body = fs.readFileSync(path.join(root, 'data', 'rooms.json'));
        return new Response(body, {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(fs.readFileSync(path.join(root, 'public', 'index.html')), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('static:' + url.pathname, { status: 200 });
    },
  },
};

const pending = [];
const ctx = { waitUntil: (promise) => pending.push(promise) };
const { default: worker } = await import('../worker/index.mjs');

async function call(url, options) {
  const response = await worker.fetch(new Request(url, options), env, ctx);
  await Promise.all(pending.splice(0));
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: response.status, headers: response.headers, text, data };
}

const results = {};

results.health = await call('https://kpk.example/api/health');
results.static = await call('https://kpk.example/');
results.bootstrap = await call('https://kpk.example/api/bootstrap');
results.bootstrapCounts = results.bootstrap.data
  ? {
      groups: results.bootstrap.data.groups?.length,
      teachers: results.bootstrap.data.teachers?.length,
      photos: results.bootstrap.data.teachers?.filter((t) => t.photo).length,
    }
  : null;

results.schedule1 = await call(
  'https://kpk.example/api/schedule?id=1&start=2026-11-09&end=2026-11-15'
);
results.schedule2 = await call(
  'https://kpk.example/api/schedule?id=1&start=2026-11-09&end=2026-11-15'
);
results.scheduleFresh = await call(
  'https://kpk.example/api/schedule?id=1&start=2026-11-09&end=2026-11-15&fresh=1'
);
results.teacher = await call(
  'https://kpk.example/api/teacher-schedule?id=31&start=2026-11-09&end=2026-11-15'
);
results.badId = await call(
  'https://kpk.example/api/schedule?id=abc&start=2026-11-09&end=2026-11-15'
);
results.badDate = await call(
  'https://kpk.example/api/schedule?id=1&start=2026-13-99&end=2026-11-15'
);
results.refresh = await call('https://kpk.example/api/refresh', { method: 'POST' });
results.refreshGet = await call('https://kpk.example/api/refresh');
results.notFound = await call('https://kpk.example/api/nope');
results.rooms1 = await call('https://kpk.example/api/rooms?floor=1');
results.rooms4 = await call('https://kpk.example/api/rooms?floor=4');

console.log(
  JSON.stringify(
    {
      health: { status: results.health.status, data: results.health.data },
      static: { status: results.static.status, text: results.static.text.slice(0, 40) },
      bootstrap: {
        status: results.bootstrap.status,
        counts: results.bootstrapCounts,
        contentType: results.bootstrap.headers.get('content-type'),
      },
      schedule: {
        status: results.schedule1.status,
        lessons: results.schedule1.data?.lessons?.length,
        cached: results.schedule1.data?.cached,
        hasFetchedAt: Boolean(results.schedule1.data?.fetchedAt),
        secondCached: results.schedule2.data?.cached,
        freshCached: results.scheduleFresh.data?.cached,
      },
      teacher: {
        status: results.teacher.status,
        lessons: results.teacher.data?.lessons?.length,
      },
      badId: { status: results.badId.status, error: results.badId.data?.error },
      badDate: { status: results.badDate.status, error: results.badDate.data?.error },
      refresh: { status: results.refresh.status, updatedAt: results.refresh.data?.updatedAt },
      refreshGet: { status: results.refreshGet.status },
      notFound: { status: results.notFound.status },
      rooms1: {
        status: results.rooms1.status,
        floor: results.rooms1.data?.floor,
        building: results.rooms1.data?.building,
        rooms: results.rooms1.data ? Object.keys(results.rooms1.data.rooms).length : null,
        sample: results.rooms1.data?.rooms
          ? Object.entries(results.rooms1.data.rooms).slice(0, 3).map(([id, value]) => ({
              id,
              status: value.status,
              cabinet: value.cabinet,
              current: value.current?.length,
              next: value.next?.subject,
            }))
          : null,
      },
      rooms4: {
        status: results.rooms4.status,
        rooms: results.rooms4.data ? Object.keys(results.rooms4.data.rooms).length : null,
      },
    },
    null,
    2
  )
);
