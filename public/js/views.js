import {
  escapeHtml as e,
  icon,
  initials,
  shortPerson,
  pluralRu,
  normalize,
  hashString,
} from './util.js';
import {
  COLLEGE_TZ,
  addDays,
  collegeNow,
  computeLive,
  dayNumber,
  formatCountdown,
  formatDateFull,
  formatRange,
  formatTime,
  isoWeekday,
  lessonEnd,
  lessonStart,
  lessonsForDate,
  monthName,
  nextStudyDay,
  sortLessons,
  startOfWeek,
  weekDates,
  weekdayShort,
  yearOf,
} from './time.js';
import { FLOORS, getFloor } from './floorplans.js';

const SPECIALTY_ORDER = ['ПНК', 'ДО', 'ФК', 'АФК', 'ИСиП', 'ТЭ', 'КП', 'ПДО'];

const SPECIALTY_SHORT = {
  ПНК: 'ПНК',
  ДО: 'ДО',
  ФК: 'ФК',
  АФК: 'АФК',
  ИСиП: 'ИСиП',
  ТЭ: 'ТЭ',
  КП: 'КП',
  ПДО: 'ПДО',
};

const SPECIALTY_SHORT_NAME = {
  ПНК: 'Начальные классы',
  ДО: 'Дошкольное образование',
  ФК: 'Физическая культура',
  АФК: 'Адаптивная физкультура',
  ИСиП: 'Информационные системы',
  ТЭ: 'Техническая эксплуатация',
  КП: 'Коррекционная педагогика',
  ПДО: 'Педагогика доп. образования',
};

/* ------------------------------------------------------------------ */
/* Общие помощники                                                     */
/* ------------------------------------------------------------------ */

export function formatUpdated(iso, now = new Date()) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const dateFmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: COLLEGE_TZ,
    day: 'numeric',
    month: 'long',
  });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: COLLEGE_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
  const keyFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: COLLEGE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateKey = keyFmt.format(date);
  const today = collegeNow(now).date;
  let label = dateFmt.format(date);
  if (dateKey === today) label = 'сегодня';
  else if (dateKey === addDays(today, -1)) label = 'вчера';
  return `${label}, ${timeFmt.format(date)}`;
}

function courseLabel(group) {
  return group.course ? `${group.course} курс` : '';
}

function groupMeta(group) {
  const parts = [group.specialtyName];
  if (group.course) parts.push(`${group.course} курс`);
  return parts.filter(Boolean).join(' · ');
}

function subjectOf(lesson) {
  return (lesson && lesson.subject && lesson.subject.name) || 'Занятие';
}

function teacherNames(lesson) {
  return (lesson.teachers || []).map((t) => shortPerson(t.fio)).filter(Boolean);
}

function groupNames(lesson) {
  return (lesson.unionGroups || []).map((u) => u.group && u.group.name).filter(Boolean);
}

function peopleFor(lesson, mode) {
  const values = mode === 'teacher' ? groupNames(lesson) : teacherNames(lesson);
  return values.join(', ');
}

function lessonPeopleHTML(lesson, mode, weekStart) {
  if (mode === 'teacher') return e(groupNames(lesson).join(', '));
  const teachers = (lesson.teachers || []).filter((teacher) => teacher.fio);
  if (!teachers.length) return '';
  return teachers
    .map((teacher) => {
      const name = e(shortPerson(teacher.fio));
      if (!teacher.id) return name;
      const week = weekStart ? `/${weekStart}` : '';
      return `<a class="lesson__teacher-link" href="#/teacher/${teacher.id}${week}" title="Открыть расписание преподавателя">${name}</a>`;
    })
    .join(', ');
}

function cabinetOf(lesson) {
  return (lesson.cabinet && lesson.cabinet.name) || '';
}

function roomKey(value) {
  return normalize(value).replace(/[^a-zа-я0-9]/g, '');
}

function findRoomForCabinet(rooms, cabinetName) {
  if (!rooms || !cabinetName) return null;
  const target = roomKey(cabinetName);
  for (const floor of rooms.floors || []) {
    for (const room of floor.rooms || []) {
      if (room.cabinet && roomKey(room.cabinet) === target) {
        return { floor: floor.floor, id: room.id };
      }
    }
  }
  return null;
}

function lessonBadge(lesson) {
  const badges = [];
  if (lesson.replacementType && lesson.replacementType !== 'none') badges.push('замена');
  if (lesson.typeLesson && lesson.typeLesson.name) badges.push(lesson.typeLesson.name);
  const subgroups = [
    ...new Set(
      (lesson.unionGroups || [])
        .map((u) => u.subgroup)
        .filter((value) => value != null && value !== '')
        .map((value) => {
          if (typeof value === 'object') {
            if (value.order != null) return String(value.order);
            return String(value.name || '').replace(/[^\d]/g, '');
          }
          return String(value);
        })
        .filter(Boolean)
    ),
  ];
  if (subgroups.length) badges.push(`подгр. ${subgroups.join(', ')}`);
  return badges.join(' · ');
}

function scrollToTopIfNeeded() {
  if (window.scrollY > 40) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* Скелетоны и ошибки                                                  */
/* ------------------------------------------------------------------ */

export function skeletonView() {
  return `
    <div class="page-head">
      <div>
        <div class="skeleton skel-head"></div>
        <div class="skeleton skel-sub"></div>
      </div>
    </div>
    <div class="skeleton skel-live"></div>
    <div class="skel-grid">
      ${Array.from({ length: 6 }, () => '<div class="skeleton skel-col"></div>').join('')}
    </div>
    <div style="height:60px"></div>
  `;
}

export function errorView(message, { retry = true } = {}) {
  return `
    <div class="teachers-empty" style="padding-top:90px">
      ${icon('alert')}
      <strong>Не удалось загрузить данные</strong>
      <p>${e(message || 'Проверьте подключение к сети и попробуйте ещё раз.')}</p>
      ${retry ? `<button class="btn btn--primary" data-retry>${icon('refresh')} Повторить</button>` : ''}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Выбор группы                                                        */
/* ------------------------------------------------------------------ */

export function filterGroups(groups, { query = '', specialty = 'all', favorites = [] } = {}) {
  const q = normalize(query);
  return groups.filter((group) => {
    if (specialty === 'fav') {
      if (!favorites.includes(group.name)) return false;
    } else if (specialty !== 'all' && group.specialtyKey !== specialty) {
      return false;
    }
    if (!q) return true;
    return normalize(
      `${group.name} ${group.specialtyName} ${group.specialtyKey} ${group.course || ''} курс`
    ).includes(q);
  });
}

export function specialtyChips(groups, { active = 'all', favorites = [] } = {}) {
  const counts = new Map();
  for (const group of groups) {
    counts.set(group.specialtyKey, (counts.get(group.specialtyKey) || 0) + 1);
  }
  const keys = [...counts.keys()].sort(
    (a, b) => SPECIALTY_ORDER.indexOf(a) - SPECIALTY_ORDER.indexOf(b)
  );
  const chips = [
    `<button class="chip ${active === 'all' ? 'is-active' : ''}" data-specialty="all" type="button">Все <span class="chip__count">${groups.length}</span></button>`,
  ];
  if (favorites.length) {
    chips.push(
      `<button class="chip ${active === 'fav' ? 'is-active' : ''}" data-specialty="fav" type="button">${icon('star')} Избранное <span class="chip__count">${favorites.length}</span></button>`
    );
  }
  for (const key of keys) {
    chips.push(
      `<button class="chip ${active === key ? 'is-active' : ''}" data-specialty="${e(key)}" type="button" title="${e(groups.find((g) => g.specialtyKey === key)?.specialtyName || key)}">${e(SPECIALTY_SHORT[key] || key)} <span class="chip__count">${counts.get(key)}</span></button>`
    );
  }
  return chips.join('');
}

export function groupOptionHTML(group, { currentName = '', favorites = [] } = {}) {
  const isFav = favorites.includes(group.name);
  const isCurrent = group.name === currentName;
  return `
    <div class="group-option ${isCurrent ? 'is-current' : ''}" data-group="${e(group.name)}" role="button" tabindex="0" aria-label="Открыть расписание группы ${e(group.name)}">
      <div class="group-option__main">
        <div class="group-option__code">${e(group.name)}</div>
        <div class="group-option__meta">${e(SPECIALTY_SHORT_NAME[group.specialtyKey] || group.specialtyName)}</div>
      </div>
      <span class="group-option__course">${e(group.course ? `${group.course} курс` : group.specialtyKey || '')}</span>
      <span class="group-option__star ${isFav ? 'is-fav' : ''}" data-fav="${e(group.name)}" role="button" tabindex="0" aria-label="${isFav ? 'Убрать из избранного' : 'Добавить в избранное'}" title="${isFav ? 'Убрать из избранного' : 'В избранное'}">${icon('star')}</span>
      ${isCurrent ? `<span class="group-option__check">${icon('check')}</span>` : ''}
    </div>
  `;
}

export function groupListHTML(groups, options = {}) {
  if (!groups.length) {
    return `<div class="picker__empty">Ничего не нашлось. Попробуйте другой запрос.</div>`;
  }
  return groups.map((group) => groupOptionHTML(group, options)).join('');
}

function groupSearchHTML(query) {
  return `
    <div class="search">
      ${icon('search')}
      <input class="search__input" id="group-search" type="search" value="${e(query)}"
        placeholder="Группа, специальность или курс" autocomplete="off" spellcheck="false"
        aria-label="Поиск группы" />
    </div>
  `;
}

export function welcomeView(state) {
  const groups = state.groups;
  const favorites = state.favorites || [];
  const filtered = filterGroups(groups, {
    query: state.pickerQuery,
    specialty: state.pickerSpecialty,
    favorites,
  });
  const specialties = new Set(groups.map((group) => group.specialtyKey));
  return `
    <section class="welcome">
      <div class="welcome__hero">
        <span class="welcome__badge">${icon('sparkle')} Расписание в реальном времени</span>
        <h1 class="welcome__title">Какое расписание <span class="accent">открыть?</span></h1>
        <p class="welcome__text">Выберите группу — покажем уроки на неделю, подсветим тот, что идёт сейчас, и посчитаем время до звонка.</p>
      </div>

      <div class="welcome__panel">
        <div class="welcome__panel-head">
          <span class="welcome__panel-title">Группы колледжа</span>
          <span class="welcome__hint">${groups.length} ${pluralRu(groups.length, ['группа', 'группы', 'групп'])} · ${specialties.size} ${pluralRu(specialties.size, ['специальность', 'специальности', 'специальностей'])}</span>
        </div>
        <div class="picker__search">${groupSearchHTML(state.pickerQuery)}</div>
        <div class="picker__chips">${specialtyChips(groups, { active: state.pickerSpecialty, favorites })}</div>
        <div class="picker__list" id="group-list">${groupListHTML(filtered, { favorites })}</div>
      </div>

      <div class="welcome__features">
        <span class="feature">${icon('clock')} Текущий урок и перемена</span>
        <span class="feature">${icon('users')} ${state.teachers.filter((t) => t.photo).length} фото преподавателей</span>
        <span class="feature">${icon('refresh')} Данные с официального сайта</span>
      </div>
    </section>
  `;
}

export function pickerModalHTML(state) {
  const favorites = state.favorites || [];
  const filtered = filterGroups(state.groups, {
    query: state.pickerQuery,
    specialty: state.pickerSpecialty,
    favorites,
  });
  return `
    <div class="modal" data-modal="picker">
      <div class="modal__backdrop" data-close-modal></div>
      <div class="modal__panel picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <button class="modal__close" type="button" data-close-modal aria-label="Закрыть">${icon('x')}</button>
        <div class="picker__head">
          <h2 class="picker__title" id="picker-title">Выберите группу</h2>
          <p class="picker__sub">${state.groups.length} групп · ${new Set(state.groups.map((g) => g.specialtyKey)).size} специальностей</p>
        </div>
        <div class="picker__search">${groupSearchHTML(state.pickerQuery)}</div>
        <div class="picker__chips">${specialtyChips(state.groups, { active: state.pickerSpecialty, favorites })}</div>
        <div class="picker__list" id="group-list">${groupListHTML(filtered, { currentName: state.group?.name, favorites })}</div>
        <div class="picker__foot">
          <span>Расписание обновляется автоматически</span>
          <span id="picker-count">${filtered.length} ${pluralRu(filtered.length, ['группа', 'группы', 'групп'])}</span>
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Live-баннер                                                         */
/* ------------------------------------------------------------------ */

function liveProgress(live, now) {
  if (live.kind === 'lesson' || live.kind === 'break') {
    const total = live.totalSeconds || 1;
    const elapsed = Math.max(0, Math.min(total, now.seconds - live.startMin * 60));
    return Math.max(2, Math.min(100, (elapsed / total) * 100));
  }
  return 0;
}

function liveRemaining(live, now) {
  if (live.targetSeconds != null) return live.targetSeconds - now.seconds;
  return 0;
}

function liveMetaParts(lesson, mode) {
  const parts = [];
  if (lesson.lessonNumber) parts.push(`${lesson.lessonNumber} урок`);
  if (lesson.startTime && lesson.endTime) parts.push(`${lesson.startTime}–${lesson.endTime}`);
  const cabinet = cabinetOf(lesson);
  if (cabinet) parts.push(cabinet);
  const people = peopleFor(lesson, mode);
  if (people) parts.push(people);
  return parts;
}

export function liveBannerHTML(live, { mode = 'group', isCurrentWeek = true, lessons = [] } = {}) {
  const now = collegeNow();
  const progress = liveProgress(live, now);
  const countdown = formatCountdown(liveRemaining(live, now));

  let className = 'live';
  let status = '';
  let title = '';
  let meta = [];
  let label = '';
  let dot = true;
  let countdownValue = countdown;
  let showTime = true;

  if (live.kind === 'lesson') {
    const lesson = live.current[0];
    className += ' live--lesson';
    status = live.current.length > 1 ? 'Идут уроки' : 'Сейчас идёт';
    title = subjectOf(lesson);
    if (live.current.length > 1) title += ` + ещё ${live.current.length - 1}`;
    meta = liveMetaParts(lesson, mode);
    label = 'до конца урока';
  } else if (live.kind === 'break') {
    className += ' live--break';
    status = 'Перемена';
    title = `Следующий урок — ${subjectOf(live.next)}`;
    meta = liveMetaParts(live.next, mode).slice(1, 4);
    label = 'до звонка';
  } else if (live.kind === 'before') {
    className += ' live--before';
    status = 'Скоро начало';
    title = subjectOf(live.next);
    meta = liveMetaParts(live.next, mode);
    label = 'до начала';
  } else if (live.kind === 'after') {
    className += ' live--after';
    status = 'На сегодня всё';
    title = 'Занятия закончились';
    const next = nextStudyDay(lessons, now.date);
    meta = [
      `Последний урок — ${subjectOf(live.previous)}`,
      `до ${live.previous.endTime}`,
      next ? `Следующий учебный день — ${formatDateFull(next.date)}` : '',
    ].filter(Boolean);
    showTime = false;
  } else {
    className += ' live--none';
    status = 'Свободный день';
    const next = nextStudyDay(lessons, now.date);
    const weekend = [6, 7].includes(isoWeekday(now.date));
    title = weekend ? 'Сегодня выходной' : 'Сегодня занятий нет';
    meta = next
      ? [`Ближайшие уроки — ${formatDateFull(next.date)}`, `${next.lessons.length} ${pluralRu(next.lessons.length, ['урок', 'урока', 'уроков'])}`]
      : ['Хорошего дня!'];
    showTime = false;
  }

  const jump = !isCurrentWeek
    ? `<button class="live__jump" type="button" data-week="today">К текущей неделе ${icon('arrow-right')}</button>`
    : '';

  return `
    <section class="${className}" id="live-banner" data-live-kind="${live.kind}">
      <div class="live__glow" aria-hidden="true"></div>
      <div class="live__main">
        <div class="live__status">${dot ? '<span class="pulse" aria-hidden="true"></span>' : ''}${e(status)}</div>
        <h2 class="live__title">${e(title)}</h2>
        <p class="live__meta">
          ${meta
            .map((part) => `<span>${e(part)}</span>`)
            .join('<span class="dot" aria-hidden="true"></span>')}
        </p>
        ${jump}
      </div>
      ${
        showTime
          ? `<div class="live__time">
               <div class="live__count" data-countdown>${e(countdownValue)}</div>
               <div class="live__label">${e(label)}</div>
             </div>`
          : ''
      }
      <div class="live__progress" aria-hidden="true"><span data-progress style="width:${progress}%"></span></div>
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/* Уроки и неделя                                                      */
/* ------------------------------------------------------------------ */

function lessonCardHTML(
  lesson,
  { mode = 'group', liveIds = new Set(), today = false, rooms = null, weekStart = null } = {}
) {
  const id = String(lesson.id);
  const isNow = liveIds.has(id);
  const isPast = today && !isNow && lessonEnd(lesson) <= collegeNow().minutes;
  const badge = lessonBadge(lesson);
  const people = lessonPeopleHTML(lesson, mode, weekStart);
  const cabinet = cabinetOf(lesson);
  const subject = subjectOf(lesson);
  const time =
    lesson.startTime && lesson.endTime
      ? `${lesson.startTime}–${lesson.endTime}`
      : `${formatTime(lessonStart(lesson))}–${formatTime(lessonEnd(lesson))}`;

  const metaRows = [];
  if (cabinet) {
    const room = findRoomForCabinet(rooms, cabinet);
    metaRows.push(
      room
        ? `<a class="lesson__meta-row lesson__room-link" href="#/map/${room.floor}/${room.id}" title="Показать ${e(
            cabinet
          )} на карте">${icon('pin')}<span>${e(cabinet)}</span>${icon(
            'arrow-right',
            'icon--sm'
          )}</a>`
        : `<div class="lesson__meta-row">${icon('pin')}<span>${e(cabinet)}</span></div>`
    );
  }

  return `
    <article class="lesson ${isNow ? 'is-now' : ''} ${isPast ? 'is-past' : ''}" data-lesson-id="${e(id)}" aria-current="${isNow ? 'true' : 'false'}">
      <span class="lesson__live">сейчас</span>
      <div class="lesson__top">
        <span class="lesson__num">${e(lesson.lessonNumber || '')}</span>
        <span class="lesson__time">${e(time)}</span>
        ${badge ? `<span class="lesson__badge">${e(badge)}</span>` : ''}
      </div>
      <h3 class="lesson__subject" title="${e(subject)}">${e(subject)}</h3>
      ${metaRows.length ? `<div class="lesson__meta">${metaRows.join('')}</div>` : ''}
      ${
        people
          ? `<div class="lesson__teacher">${people}</div>`
          : `<div class="lesson__teacher lesson__teacher--muted">${mode === 'teacher' ? 'Группа не указана' : 'Преподаватель не указан'}</div>`
      }
    </article>
  `;
}

function gapDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${pluralRu(hours, ['час', 'часа', 'часов'])}`);
  if (rest) parts.push(`${rest} мин.`);
  return parts.join(' ');
}

function lessonGapHTML(start, end, minutes) {
  return `
    <div class="lesson-gap" role="note" aria-label="Окно ${gapDuration(minutes)}">
      <span class="lesson-gap__icon">${icon('clock')}</span>
      <span class="lesson-gap__body">
        <span class="lesson-gap__title">Окно</span>
        <span class="lesson-gap__meta">${formatTime(start)}–${formatTime(end)} · ${gapDuration(minutes)}</span>
      </span>
    </div>
  `;
}

function dayLessonsHTML(lessons, options) {
  const sorted = sortLessons(lessons);
  const parts = [];
  sorted.forEach((lesson, index) => {
    parts.push(lessonCardHTML(lesson, options));
    const next = sorted[index + 1];
    if (!next) return;
    const gap = lessonStart(next) - lessonEnd(lesson);
    if (gap >= 30) parts.push(lessonGapHTML(lessonEnd(lesson), lessonStart(next), gap));
  });
  return parts.join('');
}

function dayColumnHTML(dateKey, lessons, { mode, liveIds, mobileDay, rooms, weekStart }) {
  const now = collegeNow();
  const isToday = dateKey === now.date;
  const isMobileActive = mobileDay === dateKey;
  const count = lessons.length;
  return `
    <section class="day-col ${isToday ? 'is-today' : ''} ${isMobileActive ? 'is-mobile-active' : ''}" data-day="${dateKey}">
      <header class="day-col__head">
        <span class="day-col__name">${e(weekdayShort(dateKey))}</span>
        <span class="day-col__date">${dayNumber(dateKey)}</span>
        <span class="day-col__count">${count}</span>
      </header>
      <div class="day-col__body">
        ${
          count
            ? dayLessonsHTML(lessons, {
                mode,
                liveIds,
                today: isToday,
                rooms,
                weekStart,
              })
            : `<div class="empty-day">${icon('inbox')}<span>Нет уроков</span></div>`
        }
      </div>
    </section>
  `;
}

function dayTabsHTML(dates, lessons, { mobileDay, mode }) {
  const now = collegeNow();
  return `
    <div class="day-tabs" role="tablist" aria-label="Дни недели">
      ${dates
        .map((dateKey) => {
          const count = lessonsForDate(lessons, dateKey).length;
          return `
            <button class="day-tab ${dateKey === mobileDay ? 'is-active' : ''} ${dateKey === now.date ? 'is-today' : ''}" type="button" role="tab" aria-selected="${dateKey === mobileDay}" data-day-tab="${dateKey}">
              <span class="day-tab__name">${e(weekdayShort(dateKey, true))}</span>
              <span class="day-tab__date">${dayNumber(dateKey)}</span>
              <span class="day-tab__count">${count ? `${count} ${pluralRu(count, ['урок', 'урока', 'уроков'])}` : '—'}</span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

export function weekNavHTML(state) {
  const now = collegeNow();
  const isCurrent = state.weekStart === startOfWeek(now.date);
  return `
    <div class="week-nav" aria-label="Навигация по неделям">
      <button class="week-nav__btn" type="button" data-week="-1" aria-label="Предыдущая неделя">${icon('chevron-left')}</button>
      <div class="week-nav__label">
        <strong>${e(formatRange(state.weekStart))}</strong>
        <span>${isCurrent ? 'текущая неделя' : `${yearOf(state.weekStart)} год`}</span>
      </div>
      <button class="week-nav__btn" type="button" data-week="1" aria-label="Следующая неделя">${icon('chevron-right')}</button>
      <button class="week-nav__today" type="button" data-week="today">Сегодня</button>
    </div>
  `;
}

export function scheduleView(state) {
  const group = state.group;
  const now = collegeNow();
  const isCurrentWeek = state.weekStart === startOfWeek(now.date);
  const lessons = state.schedule?.lessons || [];
  const liveLessons = state.liveSchedule?.lessons || lessons;
  const live = computeLive(liveLessons, now);
  const liveIds =
    isCurrentWeek && live.kind === 'lesson'
      ? new Set(live.current.map((lesson) => String(lesson.id)))
      : new Set();

  let dates = weekDates(state.weekStart).slice(0, 6);
  const hasSunday = lessons.some((lesson) => lesson.date === weekDates(state.weekStart)[6]);
  if (hasSunday) dates = weekDates(state.weekStart);

  let mobileDay = state.mobileDay;
  if (!mobileDay || !dates.includes(mobileDay)) {
    mobileDay = dates.includes(now.date)
      ? now.date
      : dates.find((date) => lessonsForDate(lessons, date).length) || dates[0];
  }

  const loading = state.scheduleLoading && !state.schedule;
  const error = state.scheduleError && !state.schedule;
  const liveReady = isCurrentWeek
    ? Boolean(state.schedule)
    : Boolean(state.liveSchedule && state.liveWeekStart === startOfWeek(now.date));

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">${e(state.meta.institution.shortName)} · ${e(group.specialtyName)}</div>
        <h1 class="page-head__title">
          Расписание
          <button class="group-chip" type="button" data-open-picker aria-label="Сменить группу">
            ${icon('users')} ${e(group.name)} ${icon('chevron-down', 'icon--sm')}
          </button>
        </h1>
        <p class="page-head__sub">
          ${e(groupMeta(group))}
          <span class="dot" aria-hidden="true"></span>
          <span>${e(formatRange(state.weekStart))} ${yearOf(state.weekStart)}</span>
          ${
            state.schedule?.stale
              ? `<span class="dot" aria-hidden="true"></span><span style="color:var(--warn)">данные могли устареть</span>`
              : ''
          }
        </p>
      </div>
      <div class="page-head__actions">${weekNavHTML(state)}</div>
    </div>

    ${
      error
        ? errorView(state.scheduleError)
        : `${
            liveReady
              ? liveBannerHTML(live, { mode: 'group', isCurrentWeek, lessons: liveLessons })
              : '<div class="skeleton skel-live"></div>'
          }
          ${
            loading
              ? `<div class="skel-grid">${Array.from({ length: 6 }, () => '<div class="skeleton skel-col"></div>').join('')}</div>`
              : `<div class="week">
                   ${dayTabsHTML(dates, lessons, { mobileDay, mode: 'group' })}
                   <div class="week__grid">
                     ${dates
                       .map((dateKey) =>
                         dayColumnHTML(dateKey, lessonsForDate(lessons, dateKey), {
                           mode: 'group',
                           liveIds,
                           mobileDay,
                           rooms: state.rooms,
                           weekStart: state.weekStart,
                         })
                       )
                       .join('')}
                   </div>
                 </div>`
          }`
    }
  `;
}

/* ------------------------------------------------------------------ */
/* Преподаватели                                                       */
/* ------------------------------------------------------------------ */

export function teacherFilterOptions(teachers) {
  const departments = [...new Set(teachers.map((t) => t.department).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru')
  );
  return departments;
}

export function filterTeachers(teachers, { query = '', mode = 'all', department = 'all' } = {}) {
  const q = normalize(query);
  return teachers.filter((teacher) => {
    if (mode === 'photo' && !teacher.photo) return false;
    if (mode === 'profile' && !teacher.hasProfile) return false;
    if (mode === 'schedule' && teacher.hasProfile) return false;
    if (department !== 'all' && teacher.department !== department) return false;
    if (!q) return true;
    const haystack = normalize(
      `${teacher.fio} ${teacher.position} ${teacher.department} ${(teacher.disciplines || []).join(' ')}`
    );
    return q.split(' ').every((part) => haystack.includes(part));
  });
}

function teacherCardHTML(teacher) {
  const photo = teacher.photo
    ? `<img src="${e(teacher.photo)}" alt="${e(teacher.fio)}" loading="lazy" decoding="async" />`
    : `<span class="teacher-card__initials">${e(initials(teacher.fio))}</span>`;
  return `
    <button class="teacher-card ${teacher.hasProfile ? '' : 'teacher-card--no-profile'}" type="button" data-teacher="${e(teacher.id)}" aria-label="${e(teacher.fio)}, ${e(teacher.position)}">
      <div class="teacher-card__photo">
        ${photo}
        <span class="teacher-card__arrow" aria-hidden="true">${icon('arrow-right')}</span>
      </div>
      <div class="teacher-card__body">
        <h3 class="teacher-card__name">${e(teacher.fio)}</h3>
        <p class="teacher-card__role">${e(teacher.position || 'Преподаватель')}</p>
        ${
          teacher.department
            ? `<span class="teacher-card__dept">${e(teacher.department)}</span>`
            : !teacher.hasProfile
              ? `<span class="teacher-card__dept">по расписанию</span>`
              : ''
        }
      </div>
    </button>
  `;
}

export function teacherGridHTML(state) {
  const filtered = filterTeachers(state.teachers, state.filters);
  if (!filtered.length) {
    return `
      <div class="teachers-empty">
        ${icon('search')}
        <strong>Никого не нашли</strong>
        <p>Попробуйте изменить запрос или сбросить фильтры.</p>
        <button class="btn btn--ghost btn--sm" type="button" data-reset-teacher-filters>Сбросить фильтры</button>
      </div>
    `;
  }
  return `<div class="teacher-grid" id="teacher-grid">${filtered.map(teacherCardHTML).join('')}</div>`;
}

export function teacherCounts(teachers) {
  return {
    all: teachers.length,
    photo: teachers.filter((teacher) => teacher.photo).length,
    profile: teachers.filter((teacher) => teacher.hasProfile).length,
    schedule: teachers.filter((teacher) => !teacher.hasProfile).length,
  };
}

export function teachersView(state) {
  const counts = teacherCounts(state.teachers);
  const departments = teacherFilterOptions(state.teachers);
  const filtered = filterTeachers(state.teachers, state.filters);
  const filters = state.filters;

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Педагогический состав</div>
        <h1 class="page-head__title">Преподаватели</h1>
        <p class="page-head__sub">
          ${counts.profile} ${pluralRu(counts.profile, ['карточка', 'карточки', 'карточек'])} с сайта колледжа
          <span class="dot" aria-hidden="true"></span>
          <span>${counts.photo} ${pluralRu(counts.photo, ['фото', 'фото', 'фото'])}</span>
          <span class="dot" aria-hidden="true"></span>
          <span>${counts.all} ${pluralRu(counts.all, ['преподаватель', 'преподавателя', 'преподавателей'])}</span>
        </p>
      </div>
    </div>

    <div class="teachers-toolbar">
      <div class="search">
        ${icon('search')}
        <input class="search__input" id="teacher-search" type="search" value="${e(filters.query)}"
          placeholder="ФИО, должность или кафедра" autocomplete="off" spellcheck="false"
          aria-label="Поиск преподавателя" />
        <button class="search__clear" type="button" data-clear-teacher-search aria-label="Очистить" ${filters.query ? '' : 'hidden'}>${icon('x')}</button>
      </div>
      <div class="chips" role="group" aria-label="Фильтры преподавателей">
        <button class="chip ${filters.mode === 'all' ? 'is-active' : ''}" type="button" data-teacher-mode="all">Все <span class="chip__count">${counts.all}</span></button>
        <button class="chip ${filters.mode === 'photo' ? 'is-active' : ''}" type="button" data-teacher-mode="photo">С фото <span class="chip__count">${counts.photo}</span></button>
        <button class="chip ${filters.mode === 'profile' ? 'is-active' : ''}" type="button" data-teacher-mode="profile">Карточки колледжа <span class="chip__count">${counts.profile}</span></button>
      </div>
      <select class="select" id="department-filter" aria-label="Кафедра">
        <option value="all" ${filters.department === 'all' ? 'selected' : ''}>Все кафедры</option>
        ${departments
          .map(
            (department) =>
              `<option value="${e(department)}" ${filters.department === department ? 'selected' : ''}>${e(department)}</option>`
          )
          .join('')}
      </select>
    </div>

    <p class="teachers-count" id="teachers-count">${filtered.length} ${pluralRu(filtered.length, ['преподаватель', 'преподавателя', 'преподавателей'])}</p>
    <div id="teacher-grid-wrap">${teacherGridHTML(state)}</div>
  `;
}

export function teacherModalHTML(teacher) {
  if (!teacher) return '';
  const facts = [
    ['Образование', teacher.educationLevel],
    ['Квалификация', teacher.qualification],
    ['Специализация', teacher.specialization],
    ['Общий стаж', teacher.totalExperience],
    ['Педагогический стаж', teacher.teachingExperience],
    ['Стаж в должности', teacher.positionExperience],
  ].filter(([, value]) => value);

  const disciplines = (teacher.disciplines || []).filter(Boolean);

  return `
    <div class="modal" data-modal="teacher">
      <div class="modal__backdrop" data-close-modal></div>
      <div class="modal__panel route-modal" role="dialog" aria-modal="true" aria-labelledby="teacher-modal-name">
        <button class="modal__close" type="button" data-close-modal aria-label="Закрыть">${icon('x')}</button>
        <div class="profile">
          <div class="profile__photo">
            ${
              teacher.photo
                ? `<img src="${e(teacher.photo)}" alt="${e(teacher.fio)}" />`
                : `<span class="profile__initials">${e(initials(teacher.fio))}</span>`
            }
          </div>
          <div class="profile__main">
            <h2 class="profile__name" id="teacher-modal-name">${e(teacher.fio)}</h2>
            <p class="profile__role">${e(teacher.position || 'Преподаватель')}</p>
            ${teacher.department ? `<span class="profile__dept">${icon('users')} ${e(teacher.department)}</span>` : ''}

            ${
              facts.length
                ? `<div class="profile__facts">
                     ${facts
                       .map(
                         ([label, value]) => `
                         <div class="fact">
                           <div class="fact__label">${e(label)}</div>
                           <div class="fact__value">${e(value)}</div>
                         </div>`
                       )
                       .join('')}
                   </div>`
                : ''
            }

            ${
              disciplines.length
                ? `<div class="profile__section">
                     <div class="profile__section-title">${icon('book')} Дисциплины</div>
                     <p class="profile__text">${e(disciplines.join(' · '))}</p>
                   </div>`
                : ''
            }

            ${
              teacher.awards
                ? `<div class="profile__section">
                     <details class="profile__details">
                       <summary>${icon('award')} Награды и звания ${icon('chevron-down', 'icon--sm')}</summary>
                       <p class="profile__text">${e(teacher.awards)}</p>
                     </details>
                   </div>`
                : ''
            }

            <div class="profile__actions">
              ${
                teacher.scheduleId
                  ? `<button class="btn btn--primary" type="button" data-teacher-schedule="${e(teacher.scheduleId)}">${icon('calendar')} Расписание преподавателя</button>`
                  : ''
              }
              ${
                teacher.pageUrl
                  ? `<a class="btn btn--ghost" href="${e(teacher.pageUrl)}" target="_blank" rel="noopener noreferrer">${icon('external')} Страница на edu.tatar.ru</a>`
                  : ''
              }
            </div>

            <p class="profile__note">
              ${
                teacher.hasProfile
                  ? 'Данные и фотография — с официального сайта колледжа edu.tatar.ru.'
                  : 'Карточка на сайте колледжа не найдена, поэтому показано только имя из расписания.'
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Расписание преподавателя                                            */
/* ------------------------------------------------------------------ */

export function teacherScheduleView(state) {
  const teacher = state.teacher;
  if (!teacher) {
    return errorView('Преподаватель не найден в справочнике.', { retry: false });
  }
  const now = collegeNow();
  const lessons = state.teacherSchedule?.lessons || [];
  const liveLessons = state.teacherLiveSchedule?.lessons || lessons;
  const isCurrentWeek = state.weekStart === startOfWeek(now.date);
  const live = computeLive(liveLessons, now);
  const liveIds =
    isCurrentWeek && live.kind === 'lesson'
      ? new Set(live.current.map((lesson) => String(lesson.id)))
      : new Set();

  let dates = weekDates(state.weekStart).slice(0, 6);
  if (lessons.some((lesson) => lesson.date === weekDates(state.weekStart)[6])) {
    dates = weekDates(state.weekStart);
  }

  let mobileDay = state.mobileDay;
  if (!mobileDay || !dates.includes(mobileDay)) {
    mobileDay = dates.includes(now.date)
      ? now.date
      : dates.find((date) => lessonsForDate(lessons, date).length) || dates[0];
  }

  const loading = state.teacherLoading && !state.teacherSchedule;
  const error = state.teacherError && !state.teacherSchedule;
  const liveReady = isCurrentWeek
    ? Boolean(state.teacherSchedule)
    : Boolean(
        state.teacherLiveSchedule &&
          state.teacherLiveWeekStart === startOfWeek(now.date)
      );

  return `
    <div class="page-head">
      <div>
        <a class="btn btn--ghost btn--sm page-head__back" href="#/teachers">${icon('chevron-left')} Все преподаватели</a>
        <div class="eyebrow">Расписание преподавателя</div>
        <h1 class="page-head__title">
          <span class="page-avatar">
            ${teacher.photo ? `<img src="${e(teacher.photo)}" alt="" />` : e(initials(teacher.fio))}
          </span>
          ${e(teacher.fio)}
        </h1>
        <p class="page-head__sub">
          ${e(teacher.position || 'Преподаватель')}
          ${teacher.department ? `<span class="dot" aria-hidden="true"></span><span>${e(teacher.department)}</span>` : ''}
          <span class="dot" aria-hidden="true"></span>
          <span>${e(formatRange(state.weekStart))} ${yearOf(state.weekStart)}</span>
        </p>
      </div>
      <div class="page-head__actions">${weekNavHTML(state)}</div>
    </div>

    ${
      error
        ? errorView(state.teacherError)
        : `${
            liveReady
              ? liveBannerHTML(live, { mode: 'teacher', isCurrentWeek, lessons: liveLessons })
              : '<div class="skeleton skel-live"></div>'
          }
          ${
            loading
              ? `<div class="skel-grid">${Array.from({ length: 6 }, () => '<div class="skeleton skel-col"></div>').join('')}</div>`
              : `<div class="week">
                   ${dayTabsHTML(dates, lessons, { mobileDay, mode: 'teacher' })}
                   <div class="week__grid">
                     ${dates
                       .map((dateKey) =>
                         dayColumnHTML(dateKey, lessonsForDate(lessons, dateKey), {
                           mode: 'teacher',
                           liveIds,
                           mobileDay,
                           rooms: state.rooms,
                           weekStart: state.weekStart,
                         })
                       )
                       .join('')}
                   </div>
                 </div>`
          }`
    }
  `;
}

/* ------------------------------------------------------------------ */
/* Карта кабинетов                                                     */
/* ------------------------------------------------------------------ */

const MAP_STATUS_LABEL = {
  busy: 'Занят',
  free: 'Свободен',
  'no-data': 'Нет данных',
  unknown: 'Нет данных',
};

function roomLabel(room) {
  const raw = Array.isArray(room.label) ? room.label.join(' ') : room.label;
  return raw.startsWith('№') ? `Каб. ${raw}` : raw;
}

function roomStatusData(data, roomId) {
  return data && data.rooms ? data.rooms[roomId] || null : null;
}

function statusClass(status) {
  return ['busy', 'free', 'no-data'].includes(status) ? status : 'unknown';
}

function mapRoomLabel(room, fontSize) {
  const lines = Array.isArray(room.label) ? room.label : [room.label];
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const size = room.smallText ? 10 : fontSize;

  if (room.vertical && !Array.isArray(room.label)) {
    return `<text class="map-room__label" x="${cx}" y="${cy}" font-size="${size}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${cx} ${cy})">${e(
      lines[0]
    )}</text>`;
  }

  if (lines.length === 1) {
    return `<text class="map-room__label" x="${cx}" y="${cy}" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${e(
      lines[0]
    )}</text>`;
  }

  const startY = cy - ((lines.length - 1) * 13) / 2;
  return `<text class="map-room__label" x="${cx}" y="${startY}" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${lines
    .map((line, index) => `<tspan x="${cx}" dy="${index === 0 ? 0 : 14}">${e(line)}</tspan>`)
    .join('')}</text>`;
}

function mapDecor(item) {
  if (item.type === 'stairs') {
    let lines = '';
    for (let index = 1; index < 7; index += 1) {
      const y = item.y + (item.h / 7) * index;
      lines += `<line x1="${item.x + 10}" y1="${y}" x2="${item.x + item.w - 10}" y2="${y}" />`;
    }
    return `<g class="map-stairs"><rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" />${lines}</g>`;
  }
  if (item.type === 'void') {
    return `<rect class="map-void" x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" />`;
  }
  if (item.type === 'entrance') {
    return `<g class="map-entrance"><rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" /><text x="${
      item.x + item.w / 2
    }" y="${item.y + item.h / 2}" text-anchor="middle" dominant-baseline="middle">ВХОД</text><rect x="${
      item.x + item.w / 2 - 22
    }" y="${item.y + item.h + 4}" width="44" height="7" /></g>`;
  }
  if (item.type === 'small') {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    return `<g class="map-small"><rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" /><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle">${e(
      item.label
    )}</text></g>`;
  }
  if (item.type === 'divider') {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    return `<g class="map-divider"><rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" /><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${cx} ${cy})">${e(
      item.label
    )}</text></g>`;
  }
  return '';
}

function mapSVG(floor, data, selectedRoom) {
  const decor = (floor.decor || []).map(mapDecor).join('');
  const rooms = floor.rooms
    .map((room) => {
      const status = roomStatusData(data, room.id);
      const statusKey = statusClass(status ? status.status : 'unknown');
      const isSelected = room.id === selectedRoom;
      const label = roomLabel(room);
      const aria = `${label}: ${MAP_STATUS_LABEL[statusKey] || 'Нет данных'}`;
      const dotX = room.x + room.w - 8;
      const dotY = room.y + 8;
      return `<g class="map-room is-${statusKey} ${isSelected ? 'is-selected' : ''}" data-room-id="${room.id}" tabindex="0" role="button" aria-label="${e(
        aria
      )}" aria-pressed="${isSelected}">
        <title>${e(label)} · ${e(MAP_STATUS_LABEL[statusKey] || 'Нет данных')}</title>
        <rect x="${room.x}" y="${room.y}" width="${room.w}" height="${room.h}" />
        <circle class="map-room__dot" cx="${dotX}" cy="${dotY}" r="3.4" />
        ${mapRoomLabel(room, room.vertical ? 12 : 13)}
      </g>`;
    })
    .join('');

  return `<svg class="map-svg" viewBox="0 0 1000 560" role="img" aria-label="Схема кабинетов: ${e(
    floor.title
  )}">
    <rect class="map-shell" x="50" y="30" width="900" height="500" rx="5" />
    ${decor}
    ${rooms}
  </svg>`;
}

function mapDateLabel(dateKey) {
  const now = collegeNow();
  if (dateKey === now.date) return 'Сегодня';
  if (dateKey === addDays(now.date, 1)) return 'Завтра';
  return `${weekdayShort(dateKey)}, ${formatDateLong(dateKey)}`;
}

function mapLessonHTML(lesson) {
  const groups = (lesson.groups || [])
    .map(
      (group) =>
        `<a class="room-group" href="#/group/${encodeURIComponent(group.name)}/${startOfWeek(
          lesson.date
        )}">${e(group.name)}</a>`
    )
    .join(', ');
  const teachers = (lesson.teachers || []).map((teacher) => shortPerson(teacher.fio)).join(', ');
  return `<div class="room-lesson">
    <div class="room-lesson__time">${e(mapDateLabel(lesson.date))} · ${e(lesson.startTime)}–${e(
      lesson.endTime
    )} · ${e(lesson.lessonNumber)} урок</div>
    <h4 class="room-lesson__subject">${e(lesson.subject)}</h4>
    ${groups ? `<p class="room-lesson__groups">${groups}</p>` : ''}
    ${teachers ? `<p class="room-lesson__teacher">${e(teachers)}</p>` : ''}
    ${lesson.replacement ? `<span class="room-lesson__badge">${e(lesson.replacement)}</span>` : ''}
  </div>`;
}

function roomPanelLoadingHTML(floor, room) {
  return `<div class="map-panel__head">
      <div>
        <div class="eyebrow">${e(floor.title)}</div>
        <h2>${e(roomLabel(room))}</h2>
        <p>Загружаем данные о занятиях…</p>
      </div>
    </div>
    <div class="map-panel__note">${icon('clock')}<p>Проверяем, свободен ли кабинет и когда в нём следующий урок.</p></div>`;
}

function roomPanelHTML(floor, room, status) {
  if (!room) {
    return `<div class="map-panel__empty">
      ${icon('map')}
      <h3>Выберите кабинет</h3>
      <p>Нажмите на комнату на схеме или на номер ниже — покажем, свободен ли кабинет и когда в нём следующий урок.</p>
    </div>`;
  }

  const statusKey = statusClass(status ? status.status : 'unknown');
  const statusLabel = MAP_STATUS_LABEL[statusKey] || 'Нет данных';
  const cabinet = (status && status.cabinet) || room.cabinet || '';
  const current = (status && status.current) || [];
  const next = status && status.next;

  return `<div class="map-panel__head">
      <div>
        <div class="eyebrow">${e(floor.title)}</div>
        <h2>${e(roomLabel(room))}</h2>
        <p>${cabinet ? e(cabinet) : 'Кабинет вне расписания'}</p>
      </div>
      <span class="status-pill is-${statusKey}"><span class="status-pill__dot"></span>${e(
        statusLabel
      )}</span>
    </div>

    ${
      statusKey === 'no-data'
        ? `<div class="map-panel__note">${icon('inbox')}<p>${
            status && status.note
              ? e(status.note)
              : 'Для этого кабинета нет данных о занятиях в расписании.'
          }</p></div>`
        : ''
    }

    ${
      current.length
        ? `<div class="room-section">
             <div class="room-section__title">${icon('clock')} Сейчас идёт</div>
             ${current.map(mapLessonHTML).join('')}
           </div>`
        : statusKey === 'free'
          ? `<div class="room-section">
               <div class="room-section__title">${icon('clock')} Сейчас</div>
               <p class="room-free">Кабинет свободен</p>
             </div>`
          : ''
    }

    ${
      statusKey !== 'no-data'
        ? `<div class="room-section">
             <div class="room-section__title">${icon('calendar')} Ближайший урок</div>
             ${
               next
                 ? mapLessonHTML(next)
                 : `<p class="map-panel__muted">${
                     status && status.note
                       ? e(status.note)
                       : 'На ближайшие дни уроков нет'
                   }</p>`
             }
           </div>`
        : ''
    }`;
}

function floorTabsHTML(currentFloor) {
  return `<div class="floor-tabs" role="tablist" aria-label="Этажи">
    ${FLOORS.map(
      (floor) =>
        `<button class="floor-tab ${floor.floor === currentFloor ? 'is-active' : ''}" type="button" role="tab" aria-selected="${
          floor.floor === currentFloor
        }" data-floor="${floor.floor}">
          <span class="floor-tab__num">${floor.floor}</span>
          <span>этаж</span>
        </button>`
    ).join('')}
  </div>`;
}

function roomChipsHTML(floor, data, selectedRoom) {
  return `<div class="map-chips">
    ${floor.rooms
      .map((room) => {
        const status = roomStatusData(data, room.id);
        const statusKey = statusClass(status ? status.status : 'unknown');
        return `<button class="room-chip is-${statusKey} ${
          room.id === selectedRoom ? 'is-active' : ''
        }" type="button" data-room-id="${room.id}">
          <span class="room-chip__dot"></span>${e(roomLabel(room))}
        </button>`;
      })
      .join('')}
  </div>`;
}

export function buildingsView(state) {
  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">${e(state.meta.institution.shortName)} · корпуса</div>
        <h1 class="page-head__title">Карта кабинетов</h1>
        <p class="page-head__sub">Выберите здание, чтобы посмотреть схему этажей</p>
      </div>
    </div>

    <div class="building-grid">
      <div class="building-card is-soon" role="group" aria-label="1 здание — скоро">
        <span class="building-card__badge">Скоро</span>
        <span class="building-card__icon">${icon('map')}</span>
        <span class="building-card__num">1</span>
        <h2>1 здание</h2>
        <p>Схема первого здания появится позже. Хотите помочь с ней?</p>
        <a
          class="building-card__help"
          href="https://t.me/schedulekpk_bot"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Написать в Telegram, чтобы помочь со схемой 1 здания"
        >${icon('send', 'icon--sm')} Напишите нам в Telegram</a>
        <span class="building-card__note">В разработке</span>
      </div>

      <a class="building-card is-ready" href="#/map/1">
        <span class="building-card__badge">4 этажа</span>
        <span class="building-card__icon">${icon('map')}</span>
        <span class="building-card__num">2</span>
        <h2>2 здание</h2>
        <p>Кабинеты 1–45, спортзал, актовый зал, столовая</p>
        <span class="building-card__note">Открыть карту ${icon('arrow-right', 'icon--sm')}</span>
      </a>
    </div>
  `;
}

export function mapView(state) {
  const map = state.map || { floor: 1, data: {}, selectedRoom: null };
  const floor = getFloor(map.floor);
  const data = map.data ? map.data[floor.floor] : null;
  const selectedRoom = map.selectedRoom
    ? floor.rooms.find((room) => room.id === map.selectedRoom)
    : null;
  const selectedStatus = selectedRoom ? roomStatusData(data, selectedRoom.id) : null;
  const loading = map.loading && !data;
  const error = map.error && !data;

  return `
    <div class="page-head">
      <div>
        <a class="btn btn--ghost btn--sm page-head__back" href="#/map">${icon(
          'chevron-left'
        )} Все здания</a>
        <div class="eyebrow">${e(state.meta.institution.shortName)} · корпус</div>
        <h1 class="page-head__title">Карта кабинетов</h1>
        <p class="page-head__sub">
          ${data ? e(data.building || '2 здание') : '2 здание'}
          <span class="dot" aria-hidden="true"></span>
          <span>Нажмите на кабинет на схеме или ниже</span>
        </p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-map-refresh>
          ${icon('refresh')} Обновить
        </button>
      </div>
    </div>

    ${floorTabsHTML(floor.floor)}

    ${
      error
        ? errorView(map.error)
        : `<div class="map-layout">
             <section class="map-card">
               <div class="map-card__head">
                 <div>
                   <h2>Схема кабинетов · ${e(floor.title)}</h2>
                   <p>${data ? `Обновлено в ${e(data.now)}` : 'Загружаем занятость…'}</p>
                 </div>
                 <div class="map-legend">
                   <span><i class="legend-dot is-free"></i>Свободен</span>
                   <span><i class="legend-dot is-busy"></i>Занят</span>
                   <span><i class="legend-dot is-no-data"></i>Нет данных</span>
                 </div>
               </div>
               ${
                 loading
                   ? `<div class="map-skeleton"><div class="skeleton"></div></div>`
                   : `<div class="map-canvas">${mapSVG(floor, data, map.selectedRoom)}</div>
                      <p class="map-scroll-hint">Схему можно прокручивать вбок ${icon('arrow-right')}</p>`
               }
               ${roomChipsHTML(floor, data, map.selectedRoom)}
             </section>
             <aside class="map-panel">${
               selectedRoom && !data
                 ? roomPanelLoadingHTML(floor, selectedRoom)
                 : roomPanelHTML(floor, selectedRoom, selectedStatus)
             }</aside>
           </div>`
    }
  `;
}

/* ------------------------------------------------------------------ */
/* Футер                                                               */
/* ------------------------------------------------------------------ */

export function footerHTML(state) {
  const mapData = state.map ? state.map.data[state.map.floor] : null;
  const stamp =
    state.route.name === 'schedule' && state.schedule?.fetchedAt
      ? state.schedule.fetchedAt
      : state.route.name === 'teacher' && state.teacherSchedule?.fetchedAt
        ? state.teacherSchedule.fetchedAt
        : state.route.name === 'map' && mapData?.updatedAt
          ? mapData.updatedAt
          : state.meta?.updatedAt;
  const updated = formatUpdated(stamp);
  const label =
    state.route.name === 'map'
      ? 'Карта обновлена'
      : state.route.name === 'buildings'
        ? 'Карта кабинетов'
        : state.route.name === 'schedule' || state.route.name === 'teacher'
          ? 'Расписание обновлено'
          : 'Справочник обновлён';
  return `
    <footer class="footer">
      <div class="footer__left">
        <span class="footer__brand">КПК · Расписание</span>
        <span class="sync">
          <span class="sync__dot ${state.syncing ? 'is-loading' : state.stale ? 'is-stale' : ''}"></span>
          ${state.syncing ? 'Обновляем…' : `${label} ${updated}`}
        </span>
      </div>
      <div class="footer__links">
        <a
          class="btn btn--soft btn--sm footer__feedback"
          href="https://t.me/schedulekpk_bot"
          target="_blank"
          rel="noopener noreferrer"
          title="Написать в Telegram: ошибка или идея"
          aria-label="Сообщить об ошибке или предложить идею в Telegram"
        >${icon('send', 'icon--sm')} Ошибка или идея</a>
        <a href="${e(state.meta.publicationUrl)}" target="_blank" rel="noopener noreferrer">Источник расписания ${icon('external', 'icon--sm')}</a>
        <a href="${e(state.meta.sourceUrl)}" target="_blank" rel="noopener noreferrer">Сайт колледжа ${icon('external', 'icon--sm')}</a>
        <button class="btn btn--ghost btn--sm" type="button" data-refresh ${state.syncing ? 'disabled' : ''}>${icon('refresh', 'icon--sm')} Обновить</button>
      </div>
    </footer>
  `;
}

export { courseLabel, groupMeta, scrollToTopIfNeeded };
