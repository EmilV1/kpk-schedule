'use strict';

/**
 * Небольшой сервер без внешних зависимостей:
 *  - отдаёт статику из public/
 *  - проксирует расписание MSTimetable с кэшем
 *  - раз в несколько часов обновляет справочник преподавателей
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

const { API_ROOT, DATA_DIR, refreshAll } = require('./lib/scrape');

const ROOT = path.resolve(__dirname);
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST =
  process.env.HOST ||
  (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const COLLEGE_TZ = 'Europe/Moscow';

const SCHEDULE_TTL_MS = 2 * 60 * 1000;
const TEACHERS_REFRESH_MS = 6 * 60 * 60 * 1000;
const CACHE_FILE = path.join(DATA_DIR, 'schedule-cache.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const scheduleCache = new Map(); // key -> { data, fetchedAt }
let cacheDirty = false;
let cacheSaveTimer = null;

/* ------------------------------------------------------------------ */
/* Данные                                                              */
/* ------------------------------------------------------------------ */

let bootstrapCache = null; // { meta, groups, teachers, mtimeMs }
let bootstrapPromise = null;

async function readBootstrap(force = false) {
  if (!force && bootstrapCache) return bootstrapCache;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const files = ['meta.json', 'groups.json', 'teachers.json'].map((name) =>
      path.join(DATA_DIR, name)
    );
    const [metaRaw, groupsRaw, teachersRaw] = await Promise.all(
      files.map((file) => fsp.readFile(file, 'utf8'))
    );
    const meta = JSON.parse(metaRaw);
    const groups = JSON.parse(groupsRaw);
    const teachers = JSON.parse(teachersRaw);
    bootstrapCache = {
      meta,
      groups,
      teachers,
      mtimeMs: Date.now(),
    };
    return bootstrapCache;
  })();
  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

function invalidateBootstrap() {
  bootstrapCache = null;
}

/* ------------------------------------------------------------------ */
/* Кэш расписания                                                      */
/* ------------------------------------------------------------------ */

function cacheKey(kind, id, start, end) {
  return `${kind}:${id}:${start}:${end}`;
}

function rememberSchedule(key, data) {
  const entry = { data, fetchedAt: Date.now() };
  scheduleCache.set(key, entry);
  if (scheduleCache.size > 400) {
    const oldest = [...scheduleCache.entries()]
      .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
      .slice(0, 100);
    for (const [k] of oldest) scheduleCache.delete(k);
  }
  cacheDirty = true;
  scheduleCacheSave();
}

function scheduleCacheSave() {
  if (cacheSaveTimer) return;
  cacheSaveTimer = setTimeout(async () => {
    cacheSaveTimer = null;
    if (!cacheDirty) return;
    cacheDirty = false;
    try {
      const snapshot = {};
      const entries = [...scheduleCache.entries()].sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
      for (const [key, value] of entries.slice(0, 150)) snapshot[key] = value;
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${CACHE_FILE}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify({ savedAt: Date.now(), entries: snapshot }), 'utf8');
      await fsp.rename(tmp, CACHE_FILE);
    } catch (err) {
      console.warn('[server] Не удалось сохранить кэш расписания:', err.message);
    }
  }, 4000);
}

async function loadScheduleCache() {
  try {
    const raw = JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8'));
    const entries = raw && raw.entries ? raw.entries : {};
    for (const [key, value] of Object.entries(entries)) {
      if (value && value.data && value.fetchedAt) scheduleCache.set(key, value);
    }
    if (scheduleCache.size) {
      console.log(`[server] Загружен кэш расписания: ${scheduleCache.size} записей`);
    }
  } catch {
    /* кэша ещё нет */
  }
}

/* ------------------------------------------------------------------ */
/* Запросы к MSTimetable                                               */
/* ------------------------------------------------------------------ */

async function fetchUpstream(pathname) {
  const url = API_ROOT + pathname;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function getSchedule(kind, id, start, end, { fresh = false } = {}) {
  const key = cacheKey(kind, id, start, end);
  const cached = scheduleCache.get(key);
  const now = Date.now();

  if (!fresh && cached && now - cached.fetchedAt < SCHEDULE_TTL_MS) {
    return { ...cached.data, cached: true, fetchedAt: new Date(cached.fetchedAt).toISOString() };
  }

  try {
    const upstream = await fetchUpstream(
      `/${kind === 'teacher' ? 'teachers' : 'groups'}/${id}/lessons?startDate=${start}&endDate=${end}`
    );
    rememberSchedule(key, upstream);
    return { ...upstream, cached: false, fetchedAt: new Date().toISOString() };
  } catch (err) {
    if (cached) {
      console.warn(`[server] MSTimetable недоступен, отдаю кэш (${err.message})`);
      return {
        ...cached.data,
        cached: true,
        stale: true,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        warning: 'Источник временно недоступен — показаны последние загруженные данные.',
      };
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* HTTP-утилиты                                                        */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload, { compress = true } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = {
    'content-type': MIME['.json'],
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  let out = body;
  if (compress && body.length > 1024 && /gzip/.test(res.req.headers['accept-encoding'] || '')) {
    out = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
  }
  headers['content-length'] = out.length;
  res.writeHead(status, headers);
  res.end(out);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function applyBaseHeaders(res) {
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ')
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(start, end) {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* API карты кабинетов                                                 */
/* ------------------------------------------------------------------ */

const roomsCache = new Map();
const MOSCOW_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: COLLEGE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function moscowNow() {
  const parts = {};
  for (const part of MOSCOW_PARTS.formatToParts(new Date())) {
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

function datePlusDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function normalizeCabinetName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

function roomLessonStart(lesson) {
  if (Number.isFinite(lesson.startTimeMin)) return lesson.startTimeMin;
  const [hours, minutes] = String(lesson.startTime || '0:0').split(':').map(Number);
  return hours * 60 + minutes;
}

function roomLessonEnd(lesson) {
  if (Number.isFinite(lesson.endTimeMin)) return lesson.endTimeMin;
  const [hours, minutes] = String(lesson.endTime || '0:0').split(':').map(Number);
  return hours * 60 + minutes;
}

function summarizeRoomLesson(lesson) {
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

function buildRoomStatus(entry, now) {
  const base = {
    cabinet: entry.room.cabinet || null,
    cabinetId: entry.cabinet ? entry.cabinet.id : null,
    status: 'no-data',
    current: [],
    next: null,
    note: entry.note || '',
  };
  if (!entry.room.cabinet || !entry.cabinet || !entry.lessons) return base;

  const lessons = entry.lessons.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return roomLessonStart(a) - roomLessonStart(b);
  });
  const current = lessons.filter(
    (lesson) =>
      lesson.date === now.date &&
      roomLessonStart(lesson) <= now.minutes &&
      now.minutes < roomLessonEnd(lesson)
  );
  const upcoming = lessons.filter(
    (lesson) =>
      lesson.date > now.date ||
      (lesson.date === now.date && roomLessonStart(lesson) > now.minutes)
  );

  let next = null;
  if (current.length) {
    const maxEnd = Math.max(...current.map(roomLessonEnd));
    next =
      lessons.find(
        (lesson) =>
          lesson.date > now.date ||
          (lesson.date === now.date && roomLessonStart(lesson) >= maxEnd)
      ) || null;
  } else {
    next = upcoming[0] || null;
  }

  return {
    ...base,
    status: current.length ? 'busy' : 'free',
    current: current.map(summarizeRoomLesson),
    next: next ? summarizeRoomLesson(next) : null,
    note: !next
      ? current.length
        ? 'На ближайшие дни уроков больше нет'
        : 'На ближайшие дни уроков нет'
      : '',
  };
}

async function handleRoomsApi(req, res, url) {
  if (req.method !== 'GET') return sendError(res, 405, 'Метод не поддерживается');
  const floor = Number(url.searchParams.get('floor') || 1);
  if (![1, 2, 3, 4].includes(floor)) {
    return sendError(res, 400, 'Некорректный этаж');
  }

  const now = moscowNow();
  const fresh = url.searchParams.get('fresh') === '1';
  const cacheKey = `${floor}:${now.date}`;
  const cached = roomsCache.get(cacheKey);
  if (!fresh && cached && Date.now() - cached.fetchedAt < SCHEDULE_TTL_MS) {
    return sendJson(res, 200, { ...cached.data, cached: true });
  }

  let config;
  try {
    config = JSON.parse(await fsp.readFile(path.join(DATA_DIR, 'rooms.json'), 'utf8'));
  } catch {
    return sendError(res, 503, 'Нет data/rooms.json');
  }
  const floorConfig = (config.floors || []).find((item) => Number(item.floor) === floor);
  if (!floorConfig) return sendError(res, 404, 'Этаж не найден');

  try {
    const cabinets = await fetchUpstream('/cabinets');
    const byName = new Map(
      (cabinets || []).map((cabinet) => [normalizeCabinetName(cabinet.name), cabinet])
    );
    const end = datePlusDays(now.date, 3);

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
          const data = await fetchUpstream(
            `/cabinets/${cabinet.id}/lessons?startDate=${now.date}&endDate=${end}`
          );
          return { room, cabinet, lessons: data.lessons || [], note: '' };
        } catch {
          return { room, cabinet, lessons: null, note: 'Не удалось получить данные' };
        }
      })
    );

    const rooms = {};
    for (const entry of entries) rooms[entry.room.id] = buildRoomStatus(entry, now);
    const payload = {
      floor,
      building: config.building || '',
      date: now.date,
      now: now.timeText,
      updatedAt: new Date().toISOString(),
      rooms,
    };
    roomsCache.set(cacheKey, { data: payload, fetchedAt: Date.now() });
    return sendJson(res, 200, payload);
  } catch (err) {
    console.error('[server] rooms:', err);
    return sendError(res, 502, 'Не удалось получить данные кабинетов');
  }
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, uptime: process.uptime() });
  }

  if (pathname === '/api/bootstrap') {
    try {
      const data = await readBootstrap();
      return sendJson(res, 200, {
        ...data,
        serverTime: new Date().toISOString(),
        timezone: COLLEGE_TZ,
      });
    } catch (err) {
      console.error('[server] bootstrap:', err);
      return sendError(res, 503, 'Данные ещё не собраны. Запустите: node lib/scrape.js');
    }
  }

  if (pathname === '/api/refresh') {
    if (req.method !== 'POST') return sendError(res, 405, 'Используйте POST');
    const origin = req.headers.origin;
    if (origin) {
      const allowed = [`http://${req.headers.host}`, `https://${req.headers.host}`];
      if (!allowed.includes(origin)) return sendError(res, 403, 'Доступ запрещён');
    }
    if (refreshing) return sendJson(res, 409, { error: 'Обновление уже выполняется' });
    if (Date.now() - lastManualRefresh < 30_000) {
      try {
        const data = await readBootstrap();
        return sendJson(res, 200, { ...data.meta, skipped: true });
      } catch {
        return sendError(res, 503, 'Данные ещё не собраны');
      }
    }
    lastManualRefresh = Date.now();
    try {
      const result = await runManualRefresh();
      return sendJson(res, 200, result.meta);
    } catch (err) {
      console.error('[server] refresh:', err);
      return sendError(res, 502, 'Не удалось обновить данные с сайтов');
    }
  }

  if (pathname === '/api/rooms') {
    return await handleRoomsApi(req, res, url);
  }

  if (pathname === '/api/schedule' || pathname === '/api/teacher-schedule') {    const kind = pathname === '/api/teacher-schedule' ? 'teacher' : 'group';
    const id = Number(url.searchParams.get('id'));
    const start = url.searchParams.get('start') || '';
    const end = url.searchParams.get('end') || '';
    const fresh = url.searchParams.get('fresh') === '1';

    if (!Number.isInteger(id) || id <= 0 || id > 1_000_000) {
      return sendError(res, 400, 'Некорректный идентификатор');
    }
    if (!isValidDate(start) || !isValidDate(end)) {
      return sendError(res, 400, 'Некорректные даты');
    }
    const span = daysBetween(start, end);
    if (span < 0 || span > 31) {
      return sendError(res, 400, 'Диапазон дат должен быть от 0 до 31 дня');
    }

    // Для недели нормализуем к понедельник–воскресенье.
    try {
      const data = await getSchedule(kind, id, start, end, { fresh });
      return sendJson(res, 200, { ...data, serverTime: new Date().toISOString() });
    } catch (err) {
      console.error('[server] schedule:', err);
      return sendError(res, 502, 'Не удалось получить расписание с site.mstimetables.ru');
    }
  }

  return sendError(res, 404, 'Не найдено');
}

/* ------------------------------------------------------------------ */
/* Статика                                                             */
/* ------------------------------------------------------------------ */

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest']);

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendError(res, 400, 'Некорректный путь');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '/index.html') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    return sendError(res, 403, 'Доступ запрещён');
  }

  let stat;
  try {
    stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return sendError(res, 404, 'Файл не найден');
  }

  const ext = path.extname(resolved).toLowerCase();
  const etag = `W/"${stat.size}-${stat.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    return res.end();
  }

  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    etag,
    'x-content-type-options': 'nosniff',
    'cache-control':
      ext === '.html' || ext === '.css' || ext === '.js' || ext === '.webmanifest'
        ? 'no-cache'
        : ext === '.woff2' || ext === '.jpg' || ext === '.jpeg' || ext === '.png'
          ? 'public, max-age=86400'
          : 'public, max-age=3600',
  };

  let body = await fsp.readFile(resolved);
  if (
    COMPRESSIBLE.has(ext) &&
    body.length > 1024 &&
    /gzip/.test(req.headers['accept-encoding'] || '')
  ) {
    body = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* ------------------------------------------------------------------ */
/* Сервер                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  try {
    applyBaseHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const isRefresh = req.method === 'POST' && url.pathname === '/api/refresh';
      if (!isRefresh) return sendError(res, 405, 'Метод не поддерживается');
    }

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error('[server] Необработанная ошибка:', err);
    if (!res.headersSent) sendError(res, 500, 'Внутренняя ошибка сервера');
    else res.end();
  }
});

/* ------------------------------------------------------------------ */
/* Фоновое обновление                                                  */
/* ------------------------------------------------------------------ */

let refreshing = false;
let lastManualRefresh = 0;

async function runManualRefresh() {
  refreshing = true;
  const started = Date.now();
  try {
    const result = await refreshAll({ quiet: true });
    invalidateBootstrap();
    console.log(
      `[server] Ручное обновление за ${((Date.now() - started) / 1000).toFixed(1)} с: ` +
        `${result.meta.counts.teachers} преподавателей, ${result.meta.counts.photos} фото`
    );
    return result;
  } finally {
    refreshing = false;
  }
}
async function backgroundRefresh(reason) {
  if (refreshing) return;
  refreshing = true;
  const started = Date.now();
  console.log(`[server] Обновляю данные (${reason})…`);
  try {
    const result = await refreshAll({ quiet: true });
    invalidateBootstrap();
    console.log(
      `[server] Данные обновлены за ${((Date.now() - started) / 1000).toFixed(1)} с: ` +
        `${result.meta.counts.teachers} преподавателей, ${result.meta.counts.photos} фото`
    );
  } catch (err) {
    console.error('[server] Не удалось обновить данные:', err.message);
  } finally {
    refreshing = false;
  }
}

async function dataAgeHours() {
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(DATA_DIR, 'meta.json'), 'utf8'));
    return (Date.now() - Date.parse(meta.updatedAt)) / 3600000;
  } catch {
    return Infinity;
  }
}

async function start() {
  await loadScheduleCache();

  try {
    await readBootstrap();
  } catch {
    console.log('[server] Нет собранных данных, запускаю первичный сбор…');
    await backgroundRefresh('первый запуск');
  }

  const age = await dataAgeHours();
  if (age > 12) {
    setTimeout(() => backgroundRefresh('данные устарели'), 1500);
  }

  setInterval(() => backgroundRefresh('плановое обновление'), TEACHERS_REFRESH_MS).unref();

  server.listen(PORT, HOST, () => {
    console.log(`\n  Расписание КПК → http://${HOST}:${PORT}\n`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] Не удалось запустить:', err);
    process.exit(1);
  });
}

module.exports = { server, start };
