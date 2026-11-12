export const COLLEGE_TZ = 'Europe/Moscow';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: COLLEGE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const WEEKDAY_FULL = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
];

const MONTH_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const MONTH_NOMINATIVE = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

const pad = (value) => String(value).padStart(2, '0');

/**
 * Локальная отладка: ?now=09:30 на localhost подменяет «текущее» время,
 * чтобы проверить подсветку пары и таймер перемены в любое время суток.
 * На реальном домене параметр игнорируется.
 */
const DEV_NOW = (() => {
  try {
    if (typeof window === 'undefined') return null;
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return null;
    const raw = new URLSearchParams(window.location.search).get('now');
    if (!raw) return null;
    let dateKey = null;
    let timeRaw = raw;
    const full = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})$/);
    if (full) {
      dateKey = full[1];
      timeRaw = `${full[2]}:${full[3]}`;
    } else if (!/^\d{1,2}:\d{2}$/.test(raw)) {
      return null;
    }
    const [hours, minutes] = timeRaw.split(':').map(Number);
    if (hours > 23 || minutes > 59) return null;
    let year;
    let month;
    let day;
    if (dateKey) {
      [year, month, day] = dateKey.split('-').map(Number);
    } else {
      const parts = {};
      for (const part of DATE_FORMATTER.formatToParts(new Date())) {
        if (part.type !== 'literal') parts[part.type] = part.value;
      }
      year = Number(parts.year);
      month = Number(parts.month);
      day = Number(parts.day);
    }
    return {
      base: new Date(Date.UTC(year, month - 1, day, hours - 3, minutes, 0)),
      startedAt: Date.now(),
    };
  } catch {
    return null;
  }
})();

/** Текущее время колледжа (Казань, UTC+3). */
export function collegeNow(date) {
  const base =
    date ||
    (DEV_NOW
      ? new Date(DEV_NOW.base.getTime() + (Date.now() - DEV_NOW.startedAt))
      : new Date());
  const parts = {};
  for (const part of DATE_FORMATTER.formatToParts(base)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const dateKey = `${year}-${pad(month)}-${pad(day)}`;
  return {
    date: dateKey,
    year,
    month,
    day,
    hour,
    minute,
    second,
    seconds: hour * 3600 + minute * 60 + second,
    minutes: hour * 60 + minute + second / 60,
    timeText: `${pad(hour)}:${pad(minute)}`,
    weekday: isoWeekday(dateKey),
  };
}

export function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function toDateKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

export function isoWeekday(dateKey) {
  return ((parseDateKey(dateKey).getUTCDay() + 6) % 7) + 1;
}

/** Понедельник недели, к которой относится дата. */
export function startOfWeek(dateKey) {
  return addDays(dateKey, -(isoWeekday(dateKey) - 1));
}

export function weekDates(startKey) {
  return Array.from({ length: 7 }, (_, index) => addDays(startKey, index));
}

export function dayNumber(dateKey) {
  return Number(String(dateKey).slice(8, 10));
}

export function monthName(dateKey, nominative = false) {
  const month = Number(String(dateKey).slice(5, 7));
  return (nominative ? MONTH_NOMINATIVE : MONTH_GENITIVE)[month - 1];
}

export function yearOf(dateKey) {
  return String(dateKey).slice(0, 4);
}

export function formatDateLong(dateKey) {
  return `${dayNumber(dateKey)} ${monthName(dateKey)}`;
}

export function formatDateFull(dateKey) {
  return `${dayNumber(dateKey)} ${monthName(dateKey)} ${yearOf(dateKey)}`;
}

export function formatRange(startKey) {
  const endKey = addDays(startKey, 6);
  const startMonth = monthName(startKey);
  const endMonth = monthName(endKey);
  const startYear = yearOf(startKey);
  const endYear = yearOf(endKey);
  if (startYear !== endYear) {
    return `${dayNumber(startKey)} ${startMonth} ${startYear} — ${dayNumber(endKey)} ${endMonth} ${endYear}`;
  }
  if (startMonth !== endMonth) {
    return `${dayNumber(startKey)} ${startMonth} — ${dayNumber(endKey)} ${endMonth}`;
  }
  return `${dayNumber(startKey)}–${dayNumber(endKey)} ${endMonth}`;
}

export function weekdayShort(dateKey, lowercase = false) {
  const value = WEEKDAY_SHORT[isoWeekday(dateKey) % 7];
  return lowercase ? value.toLowerCase() : value;
}

export function weekdayFull(dateKey) {
  return WEEKDAY_FULL[isoWeekday(dateKey) % 7];
}

export function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours} ч ${pad(minutes)} мин`;
  return `${pad(minutes)}:${pad(rest)}`;
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export function formatTime(minutes) {
  const total = Math.round(minutes);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function lessonStart(lesson) {
  if (Number.isFinite(lesson.startTimeMin)) return lesson.startTimeMin;
  const [hours, minutes] = String(lesson.startTime || '0:0').split(':').map(Number);
  return hours * 60 + minutes;
}

export function lessonEnd(lesson) {
  if (Number.isFinite(lesson.endTimeMin)) return lesson.endTimeMin;
  const [hours, minutes] = String(lesson.endTime || '0:0').split(':').map(Number);
  return hours * 60 + minutes;
}

export function sortLessons(lessons) {
  return lessons
    .slice()
    .sort((a, b) => lessonStart(a) - lessonStart(b) || Number(a.lessonNumber) - Number(b.lessonNumber));
}

export function lessonsForDate(lessons, dateKey) {
  return sortLessons((lessons || []).filter((lesson) => lesson.date === dateKey));
}

/**
 * Состояние «прямо сейчас» для набора пар.
 * Возвращает тип: lesson | break | before | after | none.
 */
export function computeLive(lessons, now) {
  const today = lessonsForDate(lessons, now.date);
  const nowMinutes = now.minutes;
  const nowSeconds = now.seconds;

  const current = today.filter(
    (lesson) => lessonStart(lesson) <= nowMinutes && nowMinutes < lessonEnd(lesson)
  );

  if (current.length) {
    const startMin = Math.min(...current.map(lessonStart));
    const endMin = Math.max(...current.map(lessonEnd));
    return {
      kind: 'lesson',
      current,
      startMin,
      endMin,
      targetSeconds: endMin * 60,
      nowSeconds,
      totalSeconds: (endMin - startMin) * 60,
      elapsedSeconds: nowSeconds - startMin * 60,
    };
  }

  const next = today.find((lesson) => lessonStart(lesson) > nowMinutes) || null;
  const previous =
    [...today].reverse().find((lesson) => lessonEnd(lesson) <= nowMinutes) || null;

  if (next) {
    if (previous) {
      const gapStart = lessonEnd(previous);
      const gapEnd = lessonStart(next);
      return {
        kind: 'break',
        previous,
        next,
        startMin: gapStart,
        endMin: gapEnd,
        targetSeconds: gapEnd * 60,
        nowSeconds,
        totalSeconds: (gapEnd - gapStart) * 60,
        elapsedSeconds: nowSeconds - gapStart * 60,
      };
    }
    return {
      kind: 'before',
      next,
      targetSeconds: lessonStart(next) * 60,
      nowSeconds,
      startMin: lessonStart(next),
      endMin: lessonStart(next),
    };
  }

  if (previous) {
    return {
      kind: 'after',
      previous,
      nowSeconds,
      endMin: lessonEnd(previous),
    };
  }

  return { kind: 'none', nowSeconds };
}

/** Ближайший учебный день после указанной даты (в пределах загруженной недели). */
export function nextStudyDay(lessons, afterDate) {
  const dates = [...new Set((lessons || []).filter((l) => l.date > afterDate).map((l) => l.date))].sort();
  if (!dates.length) return null;
  return { date: dates[0], lessons: lessonsForDate(lessons, dates[0]) };
}

export function liveSignature(live, now) {
  if (!live) return 'none';
  const ids =
    live.kind === 'lesson'
      ? live.current.map((l) => l.id).join(',')
      : live.kind === 'break'
        ? `${live.previous.id}-${live.next.id}`
        : live.kind === 'before'
          ? String(live.next.id)
          : live.kind === 'after'
            ? String(live.previous.id)
            : '';
  return `${live.kind}:${ids}:${now.date}`;
}
