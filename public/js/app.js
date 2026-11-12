import { $, $$, escapeHtml as e, storage, debounce } from './util.js';
import { api } from './api.js';
import {
  addDays,
  collegeNow,
  computeLive,
  formatCountdown,
  liveSignature,
  startOfWeek,
} from './time.js';
import {
  errorView,
  filterGroups,
  filterTeachers,
  footerHTML,
  groupListHTML,
  pickerModalHTML,
  scheduleView,
  skeletonView,
  specialtyChips,
  teacherGridHTML,
  teacherModalHTML,
  teacherScheduleView,
  teachersView,
  welcomeView,
} from './views.js';

const CURRENT_WEEK_KEY = 'kpk:group';
const FAVORITES_KEY = 'kpk:favorites';

const state = {
  ready: false,
  bootstrapError: null,
  meta: null,
  groups: [],
  teachers: [],
  route: { name: 'welcome' },
  group: null,
  weekStart: null,
  schedule: null,
  scheduleLoading: false,
  scheduleError: null,
  liveSchedule: null,
  liveWeekStart: null,
  teacher: null,
  teacherSchedule: null,
  teacherLoading: false,
  teacherError: null,
  teacherLiveSchedule: null,
  teacherLiveWeekStart: null,
  filters: { query: '', mode: 'all', department: 'all' },
  pickerQuery: '',
  pickerSpecialty: 'all',
  favorites: Array.isArray(storage.get(FAVORITES_KEY, [])) ? storage.get(FAVORITES_KEY, []) : [],
  mobileDay: null,
  syncing: false,
  stale: false,
  liveSig: null,
};

let routeToken = 0;
let liveTimer = null;
let autoRefreshTimer = null;
let lastFocused = null;

/* ------------------------------------------------------------------ */
/* Тема                                                                */
/* ------------------------------------------------------------------ */

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b0f1a' : '#f4f5fa');
  const button = $('#theme-toggle');
  if (button) {
    button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${theme === 'dark' ? 'sun' : 'moon'}"></use></svg>`;
    button.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'
    );
  }
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  storage.set('kpk:theme', next);
}

/* ------------------------------------------------------------------ */
/* Маршруты                                                            */
/* ------------------------------------------------------------------ */

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function parseRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const segments = raw.split('/').filter(Boolean).map(decodeSegment);
  if (segments[0] === 'group' && segments[1]) {
    return { name: 'group', groupName: segments[1], week: isDateKey(segments[2]) ? segments[2] : null };
  }
  if (segments[0] === 'teacher' && segments[1]) {
    return { name: 'teacher', teacherId: segments[1], week: isDateKey(segments[2]) ? segments[2] : null };
  }
  if (segments[0] === 'teachers') return { name: 'teachers' };
  if (segments[0] === 'schedule') return { name: 'schedule' };
  return { name: 'welcome' };
}

function navigate(hash) {
  if (location.hash === hash) {
    applyRoute();
  } else {
    location.hash = hash;
  }
}

function currentMonday() {
  return startOfWeek(collegeNow().date);
}

function groupHash(group, weekStart) {
  return `#/group/${encodeURIComponent(group.name)}/${weekStart}`;
}

function teacherHash(teacher, weekStart) {
  return `#/teacher/${teacher.scheduleId}/${weekStart}`;
}

/* ------------------------------------------------------------------ */
/* Рендер                                                              */
/* ------------------------------------------------------------------ */

function updateHeader() {
  const navMap = {
    schedule: 'schedule',
    teacher: 'teachers',
    teachers: 'teachers',
  };
  const active = navMap[state.route.name] || '';
  for (const link of $$('[data-nav]')) {
    link.classList.toggle('is-active', link.dataset.nav === active);
    if (link.dataset.nav === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const pill = $('#group-pill');
  if (pill) {
    if (state.route.name === 'schedule' && state.group) {
      pill.hidden = false;
      const label = $('#group-pill-label');
      if (label) label.textContent = state.group.name;
      pill.setAttribute('aria-label', `Сменить группу, сейчас ${state.group.name}`);
    } else {
      pill.hidden = true;
    }
  }

  const brand = $('#brand-link');
  if (brand) brand.setAttribute('href', '#/schedule');
}

function updateTitle() {
  if (!state.ready) {
    document.title = 'Расписание занятий — Казанский педагогический колледж';
    return;
  }
  if (state.route.name === 'schedule' && state.group) {
    document.title = `${state.group.name} — расписание · КПК`;
  } else if (state.route.name === 'teachers') {
    document.title = 'Преподаватели — КПК';
  } else if (state.route.name === 'teacher' && state.teacher) {
    document.title = `${state.teacher.fio} — расписание · КПК`;
  } else {
    document.title = 'Расписание занятий — Казанский педагогический колледж';
  }
}

function getLiveLessons() {
  if (state.route.name === 'teacher') {
    if (state.teacherLiveSchedule && state.teacherLiveWeekStart === currentMonday()) {
      return state.teacherLiveSchedule.lessons || [];
    }
    if (state.weekStart === currentMonday()) return state.teacherSchedule?.lessons || [];
    return [];
  }
  if (state.route.name === 'schedule') {
    if (state.liveSchedule && state.liveWeekStart === currentMonday()) {
      return state.liveSchedule.lessons || [];
    }
    if (state.weekStart === currentMonday()) return state.schedule?.lessons || [];
  }
  return [];
}

function render() {
  const app = $('#app');
  if (!app) return;

  let view = '';
  if (!state.ready) {
    view = state.bootstrapError
      ? errorView(state.bootstrapError, { retry: true })
      : skeletonView();
  } else if (state.bootstrapError) {
    view = errorView(state.bootstrapError, { retry: true });
  } else if (state.route.name === 'welcome') {
    view = welcomeView(state);
  } else if (state.route.name === 'teachers') {
    view = teachersView(state);
  } else if (state.route.name === 'teacher') {
    view = teacherScheduleView(state);
  } else if (state.route.name === 'schedule' && state.group) {
    view = scheduleView(state);
  } else {
    view = welcomeView(state);
  }

  app.innerHTML = `<div class="view">${view}</div>` + (state.ready && state.meta ? footerHTML(state) : '');
  updateHeader();
  updateTitle();

  const now = collegeNow();
  state.liveSig = liveSignature(computeLive(getLiveLessons(), now), now);
}

/* ------------------------------------------------------------------ */
/* Загрузка расписания                                                 */
/* ------------------------------------------------------------------ */

async function loadSchedule(token) {
  if (!state.group) return;
  const start = state.weekStart;
  const end = addDays(start, 6);
  state.scheduleLoading = true;
  state.scheduleError = null;
  render();

  try {
    const data = await api.schedule(state.group.id, start, end);
    if (token !== routeToken) return;
    state.schedule = data;
    state.scheduleLoading = false;
    state.stale = Boolean(data.stale);
    if (start === currentMonday()) {
      state.liveSchedule = data;
      state.liveWeekStart = start;
    }
    render();
    if (start !== currentMonday()) ensureLiveWeek(token);
  } catch (err) {
    if (token !== routeToken) return;
    state.scheduleLoading = false;
    state.scheduleError = err.message || 'Не удалось загрузить расписание';
    render();
  }
}

async function ensureLiveWeek(token) {
  if (!state.group) return;
  const monday = currentMonday();
  if (state.liveSchedule && state.liveWeekStart === monday) return;
  try {
    const data = await api.schedule(state.group.id, monday, addDays(monday, 6));
    if (token !== routeToken) return;
    state.liveSchedule = data;
    state.liveWeekStart = monday;
    render();
  } catch {
    /* баннер просто останется без данных */
  }
}

async function loadTeacherSchedule(token) {
  if (!state.teacher || !state.teacher.scheduleId) return;
  const start = state.weekStart;
  const end = addDays(start, 6);
  state.teacherLoading = true;
  state.teacherError = null;
  render();

  try {
    const data = await api.teacherSchedule(state.teacher.scheduleId, start, end);
    if (token !== routeToken) return;
    state.teacherSchedule = data;
    state.teacherLoading = false;
    if (start === currentMonday()) {
      state.teacherLiveSchedule = data;
      state.teacherLiveWeekStart = start;
    }
    render();
    if (start !== currentMonday()) ensureTeacherLive(token);
  } catch (err) {
    if (token !== routeToken) return;
    state.teacherLoading = false;
    state.teacherError = err.message || 'Не удалось загрузить расписание преподавателя';
    render();
  }
}

async function ensureTeacherLive(token) {
  if (!state.teacher || !state.teacher.scheduleId) return;
  const monday = currentMonday();
  if (state.teacherLiveSchedule && state.teacherLiveWeekStart === monday) return;
  try {
    const data = await api.teacherSchedule(state.teacher.scheduleId, monday, addDays(monday, 6));
    if (token !== routeToken) return;
    state.teacherLiveSchedule = data;
    state.teacherLiveWeekStart = monday;
    render();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Применение маршрута                                                 */
/* ------------------------------------------------------------------ */

async function openGroup(group, week, token, { replaceUrl = false } = {}) {
  const start = week ? startOfWeek(week) : currentMonday();
  const groupChanged = !state.group || state.group.id !== group.id;
  const weekChanged = state.weekStart !== start;

  state.group = group;
  state.weekStart = start;
  state.route = { name: 'schedule' };
  storage.set(CURRENT_WEEK_KEY, group.name);

  if (groupChanged || weekChanged) {
    state.schedule = null;
    state.scheduleLoading = true;
    state.scheduleError = null;
    state.mobileDay = null;
    if (groupChanged) {
      state.liveSchedule = null;
      state.liveWeekStart = null;
    }
  }

  const hash = groupHash(group, start);
  if (replaceUrl && location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
  render();
  await loadSchedule(token);
}

async function applyRoute() {
  if (!state.ready) return;
  const token = ++routeToken;
  const route = parseRoute();
  closeModal();

  if (route.name === 'welcome' || route.name === 'schedule') {
    const savedName = storage.get(CURRENT_WEEK_KEY, null);
    const saved = state.groups.find((group) => group.name === savedName);
    if (saved) {
      await openGroup(saved, null, token, { replaceUrl: true });
    } else {
      state.route = { name: 'welcome' };
      state.group = null;
      render();
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    return;
  }

  if (route.name === 'group') {
    const group =
      state.groups.find((item) => item.name === route.groupName) ||
      state.groups.find((item) => String(item.id) === route.groupName);
    if (!group) {
      showToast('Группа не найдена — выберите другую', 'error');
      state.route = { name: 'welcome' };
      state.group = null;
      render();
      return;
    }
    await openGroup(group, route.week, token, { replaceUrl: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  if (route.name === 'teachers') {
    state.route = { name: 'teachers' };
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  if (route.name === 'teacher') {
    const teacher = state.teachers.find(
      (item) =>
        String(item.scheduleId) === route.teacherId ||
        String(item.id) === route.teacherId ||
        (item.scheduleIds || []).map(String).includes(route.teacherId)
    );
    if (!teacher || !teacher.scheduleId) {
      showToast('Преподаватель не найден в расписании', 'error');
      navigate('#/teachers');
      return;
    }
    const start = route.week ? startOfWeek(route.week) : currentMonday();
    state.teacher = teacher;
    state.route = { name: 'teacher' };
    state.weekStart = start;
    state.teacherSchedule = null;
    state.teacherLiveSchedule = null;
    state.teacherLiveWeekStart = null;
    state.teacherLoading = true;
    state.teacherError = null;
    state.mobileDay = null;
    const hash = teacherHash(teacher, start);
    if (location.hash !== hash) history.replaceState(null, '', hash);
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    await loadTeacherSchedule(token);
  }
}

/* ------------------------------------------------------------------ */
/* Модалки                                                             */
/* ------------------------------------------------------------------ */

function openModal(html) {
  const root = $('#modal-root');
  if (!root) return;
  lastFocused = document.activeElement;
  root.innerHTML = html;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const target = $('.picker .search__input') || $('.modal__close');
    if (target) target.focus({ preventScroll: true });
  });
}

function closeModal() {
  const root = $('#modal-root');
  const hadModal = Boolean(root && root.querySelector('.modal'));
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
  if (hadModal && lastFocused && document.contains(lastFocused)) {
    lastFocused.focus({ preventScroll: true });
  }
  lastFocused = null;
}

function openPicker() {
  if (!state.ready) return;
  state.pickerQuery = '';
  state.pickerSpecialty = 'all';
  openModal(pickerModalHTML(state));
}

function openTeacherModal(id) {
  const teacher = state.teachers.find((item) => item.id === id);
  if (!teacher) return;
  openModal(teacherModalHTML(teacher));
}

function refreshGroupUI() {
  const list = $('#group-list');
  if (!list) return;
  const filtered = filterGroups(state.groups, {
    query: state.pickerQuery,
    specialty: state.pickerSpecialty,
    favorites: state.favorites,
  });
  list.innerHTML = groupListHTML(filtered, {
    currentName: state.group?.name,
    favorites: state.favorites,
  });

  const chips = $('.welcome__panel .picker__chips') || $('.picker .picker__chips');
  if (chips) {
    chips.innerHTML = specialtyChips(state.groups, {
      active: state.pickerSpecialty,
      favorites: state.favorites,
    });
  }

  const count = $('#picker-count');
  if (count) count.textContent = `${filtered.length} групп`;
}

function toggleFavorite(name) {
  const set = new Set(state.favorites);
  if (set.has(name)) set.delete(name);
  else set.add(name);
  state.favorites = [...set];
  storage.set(FAVORITES_KEY, state.favorites);
  if (state.pickerSpecialty === 'fav' && !state.favorites.length) {
    state.pickerSpecialty = 'all';
  }
  refreshGroupUI();
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

function selectGroup(name) {
  const group = state.groups.find((item) => item.name === name);
  if (!group) return;
  storage.set(CURRENT_WEEK_KEY, group.name);
  closeModal();
  const hash = groupHash(group, currentMonday());
  if (location.hash === hash) applyRoute();
  else location.hash = hash;
}

function goWeek(direction) {
  const now = collegeNow();
  let target;
  if (direction === 'today') {
    target = startOfWeek(now.date);
  } else {
    target = addDays(state.weekStart, 7 * Number(direction));
  }
  if (state.route.name === 'teacher' && state.teacher) {
    navigate(teacherHash(state.teacher, target));
  } else if (state.group) {
    navigate(groupHash(state.group, target));
  }
}

async function refreshData() {
  if (state.syncing) return;
  state.syncing = true;
  render();
  let refreshWarning = '';
  try {
    try {
      await api.refresh();
    } catch (err) {
      refreshWarning = err.message || '';
    }
    const bootstrap = await api.bootstrap();
    state.meta = bootstrap.meta;
    state.groups = bootstrap.groups;
    state.teachers = bootstrap.teachers;
    if (state.group) {
      state.group =
        state.groups.find((item) => item.id === state.group.id) || state.group;
    }
    if (state.route.name === 'teacher' && state.teacher) {
      state.teacher =
        state.teachers.find((item) => item.id === state.teacher.id) || state.teacher;
    }

    if (state.route.name === 'schedule' && state.group) {
      const data = await api.schedule(
        state.group.id,
        state.weekStart,
        addDays(state.weekStart, 6),
        { fresh: true }
      );
      state.schedule = data;
      state.stale = Boolean(data.stale);
      if (state.weekStart === currentMonday()) {
        state.liveSchedule = data;
        state.liveWeekStart = state.weekStart;
      }
    } else if (state.route.name === 'teacher' && state.teacher) {
      const data = await api.teacherSchedule(
        state.teacher.scheduleId,
        state.weekStart,
        addDays(state.weekStart, 6),
        { fresh: true }
      );
      state.teacherSchedule = data;
      if (state.weekStart === currentMonday()) {
        state.teacherLiveSchedule = data;
        state.teacherLiveWeekStart = state.weekStart;
      }
    }
    state.stale = false;
    showToast(
      refreshWarning ? 'Расписание обновлено, справочник — из кэша' : 'Данные обновлены'
    );
  } catch (err) {
    showToast(err.message || 'Не удалось обновить данные', 'error');
  } finally {
    state.syncing = false;
    render();
  }
}

function updateTeacherGrid() {
  const wrap = $('#teacher-grid-wrap');
  if (!wrap) return;
  wrap.innerHTML = teacherGridHTML(state);
  const filtered = filterTeachers(state.teachers, state.filters);
  const count = $('#teachers-count');
  if (count) {
    const forms = ['преподаватель', 'преподавателя', 'преподавателей'];
    const n = filtered.length;
    const mod10 = n % 10;
    const mod100 = n % 100;
    let word = forms[2];
    if (mod10 === 1 && mod100 !== 11) word = forms[0];
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = forms[1];
    count.textContent = `${n} ${word}`;
  }
  const clear = $('[data-clear-teacher-search]');
  if (clear) clear.hidden = !state.filters.query;
}

const handleTeacherSearch = debounce(() => updateTeacherGrid(), 110);

/* ------------------------------------------------------------------ */
/* Тосты                                                               */
/* ------------------------------------------------------------------ */

function showToast(message, type = 'info') {
  const root = $('#toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast ${type === 'error' ? 'toast--error' : ''}`;
  node.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${type === 'error' ? 'alert' : 'check'}"></use></svg><span>${e(message)}</span>`;
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 220);
  }, 3200);
}

/* ------------------------------------------------------------------ */
/* Живой таймер                                                        */
/* ------------------------------------------------------------------ */

function updateCountdowns(live, now) {
  const count = $('[data-countdown]');
  if (count) {
    if (live.kind === 'lesson' || live.kind === 'break' || live.kind === 'before') {
      count.textContent = formatCountdown(live.targetSeconds - now.seconds);
    }
  }
  const progress = $('[data-progress]');
  if (progress && (live.kind === 'lesson' || live.kind === 'break')) {
    const total = live.totalSeconds || 1;
    const elapsed = Math.max(0, Math.min(total, now.seconds - live.startMin * 60));
    progress.style.width = `${Math.max(2, Math.min(100, (elapsed / total) * 100))}%`;
  }
}

function tick() {
  if (!state.ready) return;
  if (state.route.name !== 'schedule' && state.route.name !== 'teacher') return;

  const now = collegeNow();
  const lessons = getLiveLessons();
  const live = computeLive(lessons, now);
  const signature = liveSignature(live, now);

  if (signature !== state.liveSig) {
    if (!document.querySelector('.modal')) {
      state.liveSig = signature;
      render();
    } else {
      updateCountdowns(live, now);
    }
  } else {
    updateCountdowns(live, now);
  }
}

async function autoRefresh() {
  if (!state.ready || state.syncing) return;
  if (document.querySelector('.modal')) return;
  if (state.route.name === 'schedule' && state.group && state.weekStart === currentMonday()) {
    try {
      const data = await api.schedule(
        state.group.id,
        state.weekStart,
        addDays(state.weekStart, 6)
      );
      state.schedule = data;
      state.liveSchedule = data;
      state.liveWeekStart = state.weekStart;
      state.stale = Boolean(data.stale);
      render();
    } catch {
      /* тихо игнорируем */
    }
  } else if (
    state.route.name === 'teacher' &&
    state.teacher &&
    state.weekStart === currentMonday()
  ) {
    try {
      const data = await api.teacherSchedule(
        state.teacher.scheduleId,
        state.weekStart,
        addDays(state.weekStart, 6)
      );
      state.teacherSchedule = data;
      state.teacherLiveSchedule = data;
      state.teacherLiveWeekStart = state.weekStart;
      render();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* События                                                             */
/* ------------------------------------------------------------------ */

function onDocumentClick(event) {
  const target = event.target;

  const closeButton = target.closest('[data-close-modal]');
  if (closeButton) {
    closeModal();
    return;
  }

  const teacherScheduleButton = target.closest('[data-teacher-schedule]');
  if (teacherScheduleButton) {
    const id = teacherScheduleButton.dataset.teacherSchedule;
    const teacher = state.teachers.find((item) => String(item.scheduleId) === String(id));
    if (teacher) {
      closeModal();
      navigate(teacherHash(teacher, currentMonday()));
    }
    return;
  }

  const favorite = target.closest('[data-fav]');
  if (favorite) {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(favorite.dataset.fav);
    return;
  }

  const groupRow = target.closest('[data-group]');
  if (groupRow) {
    selectGroup(groupRow.dataset.group);
    return;
  }

  const specialty = target.closest('[data-specialty]');
  if (specialty) {
    state.pickerSpecialty = specialty.dataset.specialty;
    refreshGroupUI();
    return;
  }

  const weekButton = target.closest('[data-week]');
  if (weekButton && !weekButton.disabled) {
    goWeek(weekButton.dataset.week);
    return;
  }

  const dayTab = target.closest('[data-day-tab]');
  if (dayTab) {
    state.mobileDay = dayTab.dataset.dayTab;
    for (const tab of $$('.day-tab')) {
      const active = tab.dataset.dayTab === state.mobileDay;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const column of $$('.day-col')) {
      column.classList.toggle('is-mobile-active', column.dataset.day === state.mobileDay);
    }
    return;
  }

  const teacherCard = target.closest('[data-teacher]');
  if (teacherCard) {
    openTeacherModal(teacherCard.dataset.teacher);
    return;
  }

  const mode = target.closest('[data-teacher-mode]');
  if (mode) {
    state.filters.mode = mode.dataset.teacherMode;
    render();
    return;
  }

  const clearSearch = target.closest('[data-clear-teacher-search]');
  if (clearSearch) {
    state.filters.query = '';
    const input = $('#teacher-search');
    if (input) input.value = '';
    updateTeacherGrid();
    return;
  }

  const resetFilters = target.closest('[data-reset-teacher-filters]');
  if (resetFilters) {
    state.filters = { query: '', mode: 'all', department: 'all' };
    render();
    return;
  }

  const retry = target.closest('[data-retry]');
  if (retry) {
    retryData();
    return;
  }

  const refresh = target.closest('[data-refresh]');
  if (refresh) {
    refreshData();
    return;
  }

  const openPickerButton = target.closest('[data-open-picker]');
  if (openPickerButton) {
    openPicker();
    return;
  }

  if (target.closest('#group-pill')) {
    openPicker();
    return;
  }

  if (target.closest('#theme-toggle')) {
    toggleTheme();
    return;
  }
}

function onDocumentInput(event) {
  const target = event.target;
  if (target.id === 'group-search') {
    state.pickerQuery = target.value;
    refreshGroupUI();
  } else if (target.id === 'teacher-search') {
    state.filters.query = target.value;
    handleTeacherSearch();
  }
}

function onDocumentChange(event) {
  const target = event.target;
  if (target.id === 'department-filter') {
    state.filters.department = target.value;
    state.filters.query = $('#teacher-search')?.value ?? state.filters.query;
    updateTeacherGrid();
  }
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') {
    if ($('.modal')) closeModal();
    return;
  }

  if ($('.modal') && event.key === 'Tab') {
    const focusable = $$(
      '.modal button:not([disabled]), .modal a[href], .modal input, .modal select, .modal [tabindex="0"]'
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }

  const favoriteTarget = event.target.closest('[data-fav]');
  if (favoriteTarget && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    toggleFavorite(favoriteTarget.dataset.fav);
    return;
  }

  const groupTarget = event.target.closest('.group-option');
  if (groupTarget && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    selectGroup(groupTarget.dataset.group);
    return;
  }

  if (event.target.id === 'group-search') {
    const options = $$('#group-list .group-option');
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      let index = options.findIndex((option) => option.classList.contains('is-active'));
      if (index < 0) index = event.key === 'ArrowDown' ? -1 : 0;
      index =
        event.key === 'ArrowDown'
          ? (index + 1) % options.length
          : (index - 1 + options.length) % options.length;
      options.forEach((option) => option.classList.remove('is-active'));
      options[index].classList.add('is-active');
      options[index].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = options.find((option) => option.classList.contains('is-active')) || options[0];
      if (active) selectGroup(active.dataset.group);
    }
  }
}

function retryData() {
  if (state.bootstrapError) {
    state.bootstrapError = null;
    state.ready = false;
    render();
    init();
    return;
  }
  applyRoute();
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */

async function init() {
  applyTheme(currentTheme());
  render();

  try {
    const data = await api.bootstrap();
    state.meta = data.meta;
    state.groups = data.groups || [];
    state.teachers = data.teachers || [];
    state.ready = true;
    state.bootstrapError = null;
    await applyRoute();

    if (!liveTimer) liveTimer = setInterval(tick, 1000);
    if (!autoRefreshTimer) autoRefreshTimer = setInterval(autoRefresh, 120000);
  } catch (err) {
    state.bootstrapError = err.message || 'Не удалось загрузить данные';
    state.ready = false;
    render();
  }
}

document.addEventListener('click', onDocumentClick);
document.addEventListener('input', onDocumentInput);
document.addEventListener('change', onDocumentChange);
document.addEventListener('keydown', onDocumentKeydown);

window.addEventListener('hashchange', () => {
  applyRoute();
});

init();
