'use strict';

/**
 * Сбор данных для сайта расписания КПК.
 *
 * Источники:
 *   1. https://site.mstimetables.ru/<publication-id>  — расписание (публичный JSON API)
 *   2. https://edu.tatar.ru/sovetcki/org6264           — карточки преподавателей и фото
 *
 * Скрипт можно запускать отдельно:  node lib/scrape.js
 * Сервер использует те же функции для фонового обновления.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PUBLICATION_ID = '01a058c16a6e7b1a8b8ae632e9e51329';
const API_ROOT = `https://site.mstimetables.ru/api/publications/${PUBLICATION_ID}`;
const ORG_ORIGIN = 'https://edu.tatar.ru';
const ORG_PATH = '/sovetcki/org6264';
const ORG_URL = ORG_ORIGIN + ORG_PATH;

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PHOTOS_DIR = path.join(ROOT, 'public', 'photos');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/* Специальности                                                       */
/* ------------------------------------------------------------------ */

const SPECIALTIES = {
  ПНК: { code: '44.02.02', name: 'Преподавание в начальных классах' },
  ДО: { code: '44.02.01', name: 'Дошкольное образование' },
  ФК: { code: '49.02.01', name: 'Физическая культура' },
  АФК: { code: '49.02.02', name: 'Адаптивная физическая культура' },
  ИСиП: { code: '09.02.07', name: 'Информационные системы и программирование' },
  ТЭ: { code: '09.02.12', name: 'Техническая эксплуатация и сопровождение информационных систем' },
  КП: { code: '44.02.05', name: 'Коррекционная педагогика в начальном образовании' },
  ПДО: { code: '44.02.03', name: 'Педагогика дополнительного образования' },
};

const SPECIALTY_ORDER = ['ПНК', 'ДО', 'ФК', 'АФК', 'ИСиП', 'ТЭ', 'КП', 'ПДО'];

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'user-agent': UA,
          'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

async function getJson(url) {
  const res = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
  return res.json();
}

async function getText(url, referer) {
  const res = await fetchWithRetry(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      ...(referer ? { referer } : {}),
    },
  });
  return res.text();
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanFio(value) {
  const cleaned = stripTags(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*/g, '. ')
    .trim();
  const words = cleaned.split(' ');
  // Убираем случайное дублирование отчества: «Олегович Олегович».
  if (words.length >= 4 && words[words.length - 1] === words[words.length - 2]) {
    words.pop();
  }
  return words.join(' ');
}

function splitName(fio) {
  const words = normalizeName(fio).split(' ').filter(Boolean);
  const surname = words[0] || '';
  const rest = words.slice(1);
  let name = '';
  let patronymic = '';
  const initials = [];

  // «Иванов И.И.» / «Иванов И. И.» — инициалы.
  const initialTokens = rest.filter((w) => w.length <= 2);
  if (initialTokens.length && initialTokens.length === rest.length) {
    for (const token of initialTokens) initials.push(token[0]);
  } else {
    name = rest[0] || '';
    patronymic = rest[1] || '';
    if (name) initials.push(name[0]);
    if (patronymic) initials.push(patronymic[0]);
  }
  return { surname, name, patronymic, initials: initials.join('') };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

function shortFio(fio) {
  const parts = cleanFio(fio).split(' ').filter(Boolean);
  if (parts.length < 2) return cleanFio(fio);
  const surname = parts[0];
  const initials = parts
    .slice(1)
    .map((p) => (p.endsWith('.') ? p : p[0] + '.'))
    .join(' ');
  return `${surname} ${initials}`;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

/* ------------------------------------------------------------------ */
/* Группы                                                              */
/* ------------------------------------------------------------------ */

function enrichGroup(group) {
  const name = String(group.name || '').trim();
  const match = name.match(/^(\d)(\d)(\d+)-(.+)$/);
  let section = null;
  let course = null;
  let groupNumber = null;
  let key = null;
  if (match) {
    section = Number(match[1]);
    course = Number(match[2]);
    groupNumber = Number(match[3]);
    key = match[4];
  } else {
    const fallback = name.match(/-([A-Za-zА-Яа-я]+)$/);
    key = fallback ? fallback[1] : null;
  }
  const specialty = (key && SPECIALTIES[key]) || {
    code: '',
    name: key ? `Специальность ${key}` : 'Без специальности',
  };
  return {
    id: group.id,
    name,
    section,
    course: course && course >= 1 && course <= 4 ? course : null,
    groupNumber,
    specialtyKey: key,
    specialtyCode: specialty.code,
    specialtyName: specialty.name,
  };
}

function sortGroups(groups) {
  const keyIndex = (g) => {
    const i = SPECIALTY_ORDER.indexOf(g.specialtyKey);
    return i === -1 ? 99 : i;
  };
  return groups.slice().sort((a, b) => {
    const s = keyIndex(a) - keyIndex(b);
    if (s) return s;
    const c = (a.course || 9) - (b.course || 9);
    if (c) return c;
    const n = (a.groupNumber || 999) - (b.groupNumber || 999);
    if (n) return n;
    return a.name.localeCompare(b.name, 'ru');
  });
}

/* ------------------------------------------------------------------ */
/* Расписание: справочники                                             */
/* ------------------------------------------------------------------ */

async function fetchScheduleDirectory() {
  const [publication, groupsRaw, teachersRaw, cabinetsRaw] = await Promise.all([
    getJson(API_ROOT),
    getJson(`${API_ROOT}/groups`),
    getJson(`${API_ROOT}/teachers`),
    getJson(`${API_ROOT}/cabinets`).catch(() => []),
  ]);

  const groups = sortGroups((groupsRaw || []).map(enrichGroup));
  const teachers = (teachersRaw || []).map((t) => ({
    id: t.id,
    fio: cleanFio(t.fio || ''),
  }));
  return {
    publication: publication && publication.application ? publication.application : {},
    groups,
    teachers,
    cabinets: cabinetsRaw || [],
  };
}

/* ------------------------------------------------------------------ */
/* edu.tatar.ru: карточки преподавателей                               */
/* ------------------------------------------------------------------ */

function extractSchoolData(html) {
  const start = html.indexOf('<div id="school_data">');
  if (start < 0) return '';
  const end = html.indexOf('<div id="school_bottom">', start);
  return html.slice(start, end < 0 ? undefined : end);
}

const PROFILE_FIELDS = [
  ['Должность', 'position'],
  ['Уровень профессионального образования', 'educationLevel'],
  ['Специализация (по диплому)', 'specialization'],
  ['Квалификация', 'qualification'],
  ['Общий стаж', 'totalExperience'],
  ['Педагогический стаж', 'teachingExperience'],
  ['Стаж в данной должности', 'positionExperience'],
  ['Награды, звания', 'awards'],
  ['Направление переподготовки', 'retraining'],
  ['Преподаваемые дисциплины', 'disciplines'],
  ['Предмет', 'subject'],
  ['Год', 'courseYear'],
  ['Тема/проблема повышения квалификации', 'courseTopic'],
  ['Обучающая организация', 'courseOrganization'],
];

function parseProfilePage(html, pageUrl) {
  const block = extractSchoolData(html);
  if (!block) return null;

  const fio = cleanFio((block.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '');
  if (!fio) return null;

  const photoMatch = block.match(/<img[^>]+src="([^"]*\/upload\/anketas\/[^"]+)"/i);
  const photoUrl = photoMatch ? new URL(photoMatch[1], ORG_ORIGIN + '/').href : null;

  const fields = {};
  const pairs = block.matchAll(
    /<strong>([^<]+?)<\/strong>\s*(?:<p>([\s\S]*?)<\/p>)?/gi
  );
  for (const [, rawLabel, rawValue] of pairs) {
    if (!rawValue) continue;
    const label = stripTags(rawLabel).replace(/:$/, '').trim();
    const value = stripTags(rawValue);
    if (!value) continue;
    const key = PROFILE_FIELDS.find(([l]) => l === label)?.[1];
    if (key && !fields[key]) fields[key] = value;
  }

  const disciplines = (fields.disciplines || '')
    .split(/[;,•\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    fio,
    pageUrl,
    photoUrl,
    position: fields.position || '',
    educationLevel: fields.educationLevel || '',
    specialization: fields.specialization || '',
    qualification: fields.qualification || '',
    totalExperience: fields.totalExperience || '',
    teachingExperience: fields.teachingExperience || '',
    positionExperience: fields.positionExperience || '',
    awards: fields.awards || '',
    retraining: fields.retraining || '',
    disciplines,
    department: '',
  };
}

async function fetchTeacherProfiles() {
  const indexHtml = await getText(`${ORG_URL}/page2552720.htm`, ORG_URL);
  const deptMatches = [
    ...indexHtml.matchAll(
      /href="([^"]*page\d+\.htm)"[^>]*>\s*Открыть для просмотра\s*<\/a>/gi
    ),
  ];
  const deptNames = [
    ...indexHtml.matchAll(/ПЦК\s*(?:&quot;|")([^<&"]+)(?:&quot;|")/gi),
  ].map((m) => m[1].trim());

  const departments = deptMatches.slice(0, deptNames.length).map((m, i) => ({
    name: `ПЦК «${deptNames[i]}»`,
    url: m[1].startsWith('http') ? m[1] : ORG_ORIGIN + m[1],
  }));

  if (!departments.length) {
    throw new Error('Не удалось найти список ПЦК на edu.tatar.ru');
  }

  const deptPages = await mapLimit(departments, 4, async (dept) => {
    const html = await getText(dept.url, `${ORG_URL}/page2552720.htm`);
    return { dept, html };
  });

  const linkMap = new Map();
  for (const { dept, html } of deptPages) {
    const block = extractSchoolData(html);
    const links = [...block.matchAll(/<a href="([^"]*page\d+\.htm)">([^<]+)<\/a>/gi)].map(
      (m) => ({
        url: m[1].startsWith('http') ? m[1] : ORG_ORIGIN + m[1],
        label: stripTags(m[2]),
      })
    );
    for (const link of links) {
      if (!linkMap.has(link.url)) linkMap.set(link.url, { ...link, department: dept.name });
    }
  }

  const profiles = await mapLimit([...linkMap.values()], 6, async (link) => {
    try {
      const page = await getText(link.url, ORG_URL);
      const profile = parseProfilePage(page, link.url);
      if (profile) profile.department = link.department;
      return profile;
    } catch (err) {
      console.warn(`[scrape] Не удалось прочитать ${link.url}: ${err.message}`);
      return null;
    }
  });

  return profiles.filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Фото                                                                */
/* ------------------------------------------------------------------ */

const photoFileCache = new Map();

async function downloadPhoto(photoUrl) {
  if (!photoUrl) return null;
  if (photoFileCache.has(photoUrl)) return photoFileCache.get(photoUrl);

  const url = new URL(photoUrl, ORG_ORIGIN + '/');
  const ext = (path.extname(url.pathname) || '.jpg').toLowerCase();
  const base = path.basename(url.pathname, ext).replace(/[^\w-]/g, '') || 'photo';
  const fileName = `${base}${ext}`;
  const dest = path.join(PHOTOS_DIR, fileName);

  try {
    await fsp.mkdir(PHOTOS_DIR, { recursive: true });
    const res = await fetchWithRetry(url.href, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        referer: ORG_URL + '/',
      },
    });
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error(`не изображение (${type})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 500) throw new Error('слишком маленький файл');
    await fsp.writeFile(dest, buffer);
    const publicPath = `/photos/${fileName}`;
    photoFileCache.set(photoUrl, publicPath);
    return publicPath;
  } catch (err) {
    console.warn(`[scrape] Фото ${photoUrl}: ${err.message}`);
    photoFileCache.set(photoUrl, null);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Сопоставление преподавателей                                        */
/* ------------------------------------------------------------------ */

function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  const max = Math.max(a.length, b.length);
  return 1 - distance / max;
}

function matchScore(scheduleName, profileName) {
  const a = splitName(scheduleName);
  const b = splitName(profileName);
  if (!a.surname || !b.surname) return 0;
  if (a.surname !== b.surname) {
    if (levenshtein(a.surname, b.surname) > 1) return 0;
  }

  const surnameScore = a.surname === b.surname ? 1 : 0.85;
  let nameScore;
  if (a.initials.length && !a.name) {
    // В расписании только инициалы.
    const target = b.initials;
    nameScore = target.startsWith(a.initials) ? 1 : 0;
    if (!nameScore && a.initials.length === 1 && target.startsWith(a.initials)) nameScore = 0.9;
  } else {
    nameScore = Math.max(
      nameSimilarity(a.name, b.name),
      a.name && b.name && (a.name.startsWith(b.name) || b.name.startsWith(a.name)) ? 0.92 : 0
    );
    if (a.initials && b.initials.startsWith(a.initials)) nameScore = Math.max(nameScore, 0.9);
  }

  let patronymicScore = 1;
  if (a.patronymic || b.patronymic) {
    if (!a.patronymic || !b.patronymic) {
      patronymicScore = 0.72;
    } else {
      patronymicScore = Math.max(
        nameSimilarity(a.patronymic, b.patronymic),
        a.patronymic.startsWith(b.patronymic) || b.patronymic.startsWith(a.patronymic) ? 0.9 : 0
      );
    }
  }

  return surnameScore * 0.5 + nameScore * 0.3 + patronymicScore * 0.2;
}

const INVALID_TEACHER = /^(школа|\.|-|не указан[оа]?)$/i;

function isPlausibleTeacher(name) {
  const raw = String(name || '').trim();
  if (!raw || INVALID_TEACHER.test(raw)) return false;
  if (/["«»]/.test(raw)) return false;
  const words = normalizeName(raw).split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const { surname, initials } = splitName(raw);
  if (!surname || surname.length < 2) return false;
  return initials.length >= 1;
}

async function buildTeacherDirectory(scheduleTeachers, profiles) {
  const usedProfiles = new Set();
  const matches = new Map(); // schedule teacher id -> profile

  const candidates = profiles.map((p, index) => ({ ...p, index }));

  for (const teacher of scheduleTeachers) {
    if (!isPlausibleTeacher(teacher.fio)) continue;
    let best = null;
    let bestScore = 0;
    for (const profile of candidates) {
      if (usedProfiles.has(profile.index)) continue;
      const score = matchScore(teacher.fio, profile.fio);
      if (score > bestScore) {
        bestScore = score;
        best = profile;
      }
    }
    if (best && bestScore >= 0.78) {
      usedProfiles.add(best.index);
      matches.set(teacher.id, best);
    }
  }

  // 1. Все преподаватели из карточек edu.tatar.ru (включая руководство).
  const profileEntries = candidates.map((profile) => ({
    ...profile,
    scheduleIds: [...matches.entries()]
      .filter(([, matched]) => matched.index === profile.index)
      .map(([id]) => id),
  }));

  const directory = await mapLimit(profileEntries, 6, async (profile) => {
    const photo = await downloadPhoto(profile.photoUrl);
    return {
      id: `p-${profile.index}`,
      scheduleId: profile.scheduleIds[0] || null,
      scheduleIds: profile.scheduleIds,
      fio: profile.fio,
      shortFio: shortFio(profile.fio),
      photo,
      position: profile.position || 'Преподаватель',
      department: profile.department || '',
      educationLevel: profile.educationLevel || '',
      specialization: profile.specialization || '',
      qualification: profile.qualification || '',
      totalExperience: profile.totalExperience || '',
      teachingExperience: profile.teachingExperience || '',
      positionExperience: profile.positionExperience || '',
      awards: profile.awards || '',
      retraining: profile.retraining || '',
      disciplines: profile.disciplines || [],
      pageUrl: profile.pageUrl || '',
      hasProfile: true,
    };
  });

  // 2. Преподаватели только из расписания (без карточки на сайте колледжа).
  const seenNames = new Set(directory.map((t) => normalizeName(t.fio)));
  for (const teacher of scheduleTeachers) {
    if (matches.has(teacher.id)) continue;
    if (!isPlausibleTeacher(teacher.fio)) continue;
    const normalized = normalizeName(teacher.fio);
    if (seenNames.has(normalized)) continue;
    seenNames.add(normalized);
    directory.push({
      id: `s-${teacher.id}`,
      scheduleId: teacher.id,
      scheduleIds: [teacher.id],
      fio: cleanFio(teacher.fio),
      shortFio: shortFio(teacher.fio),
      photo: null,
      position: 'Преподаватель',
      department: '',
      educationLevel: '',
      specialization: '',
      qualification: '',
      totalExperience: '',
      teachingExperience: '',
      positionExperience: '',
      awards: '',
      retraining: '',
      disciplines: [],
      pageUrl: '',
      hasProfile: false,
    });
  }

  directory.sort((a, b) => {
    const bySurname = a.fio.localeCompare(b.fio, 'ru');
    return bySurname;
  });

  return directory;
}

/* ------------------------------------------------------------------ */
/* Метаданные организации                                              */
/* ------------------------------------------------------------------ */

async function fetchOrganizationMeta() {
  const html = await getText(ORG_URL, ORG_URL).catch(() => '');
  const text = stripTags(html);
  const tableValue = (label) => {
    const re = new RegExp(`${label}\\s*:?\\s*([^\\n]{2,160})`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    name: 'ГАПОУ «Казанский педагогический колледж»',
    shortName: 'КПК',
    address: '420087, г. Казань, ул. Даурская, д. 30',
    phone: tableValue('Телефон') || '+7 (843) 298-42-44',
    email: 'Kazansk.Ped@tatar.ru',
    director: 'Залялова Анфиса Григорьевна',
    founded: 1876,
    students: 1750,
    teachers: 84,
    siteUrl: ORG_URL,
  };
}

/* ------------------------------------------------------------------ */
/* Основной сценарий                                                   */
/* ------------------------------------------------------------------ */

async function refreshAll({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log('[scrape]', ...args);
  const startedAt = Date.now();

  log('Загружаю справочники расписания…');
  const [directory, profiles, orgMeta] = await Promise.all([
    fetchScheduleDirectory(),
    fetchTeacherProfiles(),
    fetchOrganizationMeta(),
  ]);
  log(`Групп: ${directory.groups.length}, преподавателей в расписании: ${directory.teachers.length}`);
  log(`Карточек преподавателей: ${profiles.length}`);

  log('Скачиваю фотографии…');
  const teachers = await buildTeacherDirectory(directory.teachers, profiles);
  const photos = teachers.filter((t) => t.photo).length;
  log(`Преподавателей в справочнике: ${teachers.length}, с фото: ${photos}`);

  const updatedAt = new Date().toISOString();
  const meta = {
    institution: orgMeta,
    publication: directory.publication,
    publicationUrl: `https://site.mstimetables.ru/${PUBLICATION_ID}`,
    sourceUrl: ORG_URL,
    updatedAt,
    counts: {
      groups: directory.groups.length,
      teachers: teachers.length,
      photos,
      scheduleTeachers: directory.teachers.length,
      profiles: profiles.length,
    },
  };

  await Promise.all([
    writeJsonAtomic(path.join(DATA_DIR, 'groups.json'), directory.groups),
    writeJsonAtomic(path.join(DATA_DIR, 'teachers.json'), teachers),
    writeJsonAtomic(path.join(DATA_DIR, 'meta.json'), meta),
  ]);

  log(`Готово за ${((Date.now() - startedAt) / 1000).toFixed(1)} с`);
  return { meta, groups: directory.groups, teachers };
}

module.exports = {
  PUBLICATION_ID,
  API_ROOT,
  ORG_URL,
  DATA_DIR,
  refreshAll,
  fetchScheduleDirectory,
};

if (require.main === module) {
  refreshAll().catch((err) => {
    console.error('[scrape] Ошибка:', err);
    process.exitCode = 1;
  });
}
