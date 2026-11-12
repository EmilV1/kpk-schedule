/**
 * Cloudflare Worker для сайта расписания КПК.
 *
 * Статика (HTML, CSS, JS, фото, шрифты) отдаётся через Workers Assets.
 * Worker обслуживает только /api/*:
 *   - /api/bootstrap       — готовый JSON из public/data/bootstrap.json
 *   - /api/schedule        — прокси к MSTimetable с кэшем 2 минуты
 *   - /api/teacher-schedule— то же для преподавателя
 *   - /api/refresh         — сброс кэша расписания (данные преподавателей обновляет GitHub Action)
 */

const PUBLICATION_ID = '01a058c16a6e7b1a8b8ae632e9e51329';
const API_ROOT = `https://site.mstimetables.ru/api/publications/${PUBLICATION_ID}`;
const CACHE_SECONDS = 120;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/health') {
        return json({
          ok: true,
          runtime: 'cloudflare-workers',
          time: new Date().toISOString(),
        });
      }

      if (url.pathname === '/api/bootstrap') {
        return await handleBootstrap(request, env);
      }

      if (url.pathname === '/api/schedule' || url.pathname === '/api/teacher-schedule') {
        return await handleLessons(request, env, ctx);
      }

      if (url.pathname === '/api/refresh') {
        return await handleRefresh(request, env);
      }

      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'Не найдено' }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('worker error', err);
      return json({ error: 'Внутренняя ошибка сервера' }, 500);
    }
  },
};

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

async function handleBootstrap(request, env) {
  const assetUrl = new URL('/data/bootstrap.json', request.url);
  const asset = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
  );

  if (!asset.ok) {
    return json(
      { error: 'Данные ещё не собраны. Выполните npm run build:worker.' },
      503
    );
  }

  const body = await asset.text();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
    },
  });
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function handleLessons(request, env, ctx) {
  if (request.method !== 'GET') {
    return json({ error: 'Метод не поддерживается' }, 405);
  }

  const url = new URL(request.url);
  const isTeacher = url.pathname === '/api/teacher-schedule';
  const id = Number(url.searchParams.get('id'));
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  const fresh = url.searchParams.get('fresh') === '1';

  if (!Number.isInteger(id) || id <= 0 || id > 1_000_000) {
    return json({ error: 'Некорректный идентификатор' }, 400);
  }
  if (!isValidDate(start) || !isValidDate(end)) {
    return json({ error: 'Некорректные даты' }, 400);
  }

  const span =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (span < 0 || span > 31) {
    return json({ error: 'Диапазон дат должен быть от 0 до 31 дня' }, 400);
  }

  const kind = isTeacher ? 'teachers' : 'groups';
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.search = `?id=${id}&start=${start}&end=${end}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  if (fresh) {
    await cache.delete(cacheKey);
  } else {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const data = await cached.json();
        return json(
          { ...data, cached: true },
          200,
          { 'cache-control': `public, max-age=${CACHE_SECONDS}` }
        );
      } catch {
        /* повреждённый кэш — идём в источник */
      }
    }
  }

  const upstreamUrl =
    `${API_ROOT}/${kind}/${id}/lessons` +
    `?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        accept: 'application/json',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'user-agent': USER_AGENT,
        referer: 'https://site.mstimetables.ru/',
      },
      cf: { cacheTtl: 60, cacheEverything: true },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return json({ error: 'Источник расписания недоступен' }, 502);
  }

  if (!upstream.ok) {
    return json(
      { error: `Источник расписания вернул ${upstream.status}` },
      502
    );
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return json({ error: 'Источник вернул некорректный JSON' }, 502);
  }

  const payload = { ...data, cached: false, fetchedAt: new Date().toISOString() };
  const response = json(payload, 200, {
    'cache-control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleRefresh(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Используйте POST' }, 405);
  }

  const assetUrl = new URL('/data/bootstrap.json', request.url);
  const asset = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
  );

  if (!asset.ok) {
    return json({ error: 'Данные ещё не собраны' }, 503);
  }

  let data;
  try {
    data = await asset.json();
  } catch {
    return json({ error: 'Некорректный bootstrap.json' }, 500);
  }

  return json({
    ...(data.meta || {}),
    refreshedAt: new Date().toISOString(),
    note: 'Расписание запрашивается заново. Данные преподавателей обновляются GitHub Action.',
  });
}
