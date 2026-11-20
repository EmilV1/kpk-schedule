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

      if (url.pathname === '/api/rooms') {
        return await handleRooms(request, env, ctx);
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

/* ------------------------------------------------------------------ */
/* Карта кабинетов                                                     */
/* ------------------------------------------------------------------ */

async function handleRooms(request, env, ctx) {
  if (request.method !== 'GET') {
    return json({ error: 'Метод не поддерживается' }, 405);
  }

  const url = new URL(request.url);
  const floor = Number(url.searchParams.get('floor') || 1);
  if (![1, 2, 3, 4].includes(floor)) {
    return json({ error: 'Некорректный этаж' }, 400);
  }

  const now = collegeNowParts();
  const end = addDays(now.date, 3);
  const fresh = url.searchParams.get('fresh') === '1';
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.search = `?floor=${floor}&date=${now.date}&v=2`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  if (fresh) {
    await cache.delete(cacheKey);
  } else {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const config = await loadRoomConfig(env, request.url);
  const floorConfig = (config.floors || []).find((item) => Number(item.floor) === floor);
  if (!floorConfig) {
    return json({ error: 'Этаж не найден' }, 404);
  }

  let cabinets;
  try {
    cabinets = await fetchCabinets();
  } catch {
    return json({ error: 'Не удалось получить список кабинетов' }, 502);
  }

  const byName = new Map(
    cabinets.map((cabinet) => [normalizeCabinetName(cabinet.name), cabinet])
  );

  const entries = await Promise.all(
    floorConfig.rooms.map(async (room) => {
      if (!room.cabinet) {
        return { room, cabinet: null, lessons: null, note: 'Кабинет не используется в расписании' };
      }
      const cabinet = byName.get(normalizeCabinetName(room.cabinet));
      if (!cabinet) {
        return { room, cabinet: null, lessons: null, note: 'Кабинет не найден в расписании' };
      }
      try {
        const data = await fetchCabinetLessons(cabinet.id, now.date, end);
        return { room, cabinet, lessons: data.lessons || [], note: '' };
      } catch {
        return { room, cabinet, lessons: null, note: 'Не удалось получить данные' };
      }
    })
  );

  const rooms = {};
  for (const entry of entries) {
    rooms[entry.room.id] = buildRoomStatus(entry, now);
  }

  const payload = {
    floor,
    building: config.building || '',
    date: now.date,
    now: now.timeText,
    updatedAt: new Date().toISOString(),
    rooms,
  };
  const response = json(payload, 200, {
    'cache-control': `public, max-age=${CACHE_SECONDS}`,
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function loadRoomConfig(env, baseUrl) {
  const assetUrl = new URL('/data/rooms.json', baseUrl);
  const asset = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
  );
  if (!asset.ok) throw new Error('rooms.json не найден');
  return asset.json();
}

async function fetchCabinets() {
  const response = await fetch(`${API_ROOT}/cabinets`, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
      referer: 'https://site.mstimetables.ru/',
    },
    cf: { cacheTtl: 3600, cacheEverything: true },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`cabinets HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchCabinetLessons(cabinetId, start, end) {
  const response = await fetch(
    `${API_ROOT}/cabinets/${cabinetId}/lessons` +
      `?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
    {
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
        referer: 'https://site.mstimetables.ru/',
      },
      cf: { cacheTtl: 60, cacheEverything: true },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!response.ok) throw new Error(`cabinet lessons HTTP ${response.status}`);
  return response.json();
}

function normalizeCabinetName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

function collegeNowParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const hours = Number(parts.hour) % 24;
  const minutes = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hours * 60 + minutes,
    timeText: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  };
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function lessonStart(lesson) {
  return Number.isFinite(lesson.startTimeMin)
    ? lesson.startTimeMin
    : Number(String(lesson.startTime || '0:0').split(':')[0]) * 60 +
        Number(String(lesson.startTime || '0:0').split(':')[1]);
}

function lessonEnd(lesson) {
  return Number.isFinite(lesson.endTimeMin)
    ? lesson.endTimeMin
    : Number(String(lesson.endTime || '0:0').split(':')[0]) * 60 +
        Number(String(lesson.endTime || '0:0').split(':')[1]);
}

function buildRoomStatus(entry, now) {
  const base = {
    cabinet: entry.room.cabinet || null,
    cabinetId: entry.cabinet ? entry.cabinet.id : null,
    status: 'no-data',
    current: [],
    next: null,
    note: entry.note || '',
  };

  if (!entry.room.cabinet || !entry.cabinet || !entry.lessons) {
    return base;
  }

  const lessons = entry.lessons.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return lessonStart(a) - lessonStart(b);
  });

  const current = lessons.filter(
    (lesson) =>
      lesson.date === now.date &&
      lessonStart(lesson) <= now.minutes &&
      now.minutes < lessonEnd(lesson)
  );

  const upcoming = lessons.filter(
    (lesson) =>
      lesson.date > now.date ||
      (lesson.date === now.date && lessonStart(lesson) > now.minutes)
  );

  let next = null;
  if (current.length) {
    const maxEnd = Math.max(...current.map(lessonEnd));
    next =
      lessons.find(
        (lesson) =>
          lesson.date > now.date ||
          (lesson.date === now.date && lessonStart(lesson) >= maxEnd)
      ) || null;
  } else {
    next = upcoming[0] || null;
  }

  return {
    ...base,
    status: current.length ? 'busy' : 'free',
    current: current.map(summarizeLesson),
    next: next ? summarizeLesson(next) : null,
    note: !next
      ? current.length
        ? 'На ближайшие дни уроков больше нет'
        : 'На ближайшие дни уроков нет'
      : '',
  };
}

function summarizeLesson(lesson) {
  const groups = [];
  const groupSeen = new Set();
  for (const union of lesson.unionGroups || []) {
    const group = union.group;
    if (group && !groupSeen.has(group.id)) {
      groupSeen.add(group.id);
      groups.push({ id: group.id, name: group.name });
    }
  }

  const teachers = [];
  const teacherSeen = new Set();
  for (const teacher of lesson.teachers || []) {
    if (!teacherSeen.has(teacher.id)) {
      teacherSeen.add(teacher.id);
      teachers.push({ id: teacher.id, fio: teacher.fio });
    }
  }

  return {
    id: lesson.id,
    date: lesson.date,
    lessonNumber: lesson.lessonNumber,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    subject: lesson.subject ? lesson.subject.name : 'Урок',
    groups,
    teachers,
    replacement:
      lesson.replacementType && lesson.replacementType !== 'none' ? 'замена' : null,
  };
}

