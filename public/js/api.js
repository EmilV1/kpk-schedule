async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try {
      const payload = await response.json();
      if (payload && payload.error) message = payload.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return response.json();
}

export const api = {
  bootstrap() {
    return request('/api/bootstrap');
  },

  refresh() {
    return request('/api/refresh', { method: 'POST' });
  },

  schedule(groupId, start, end, { fresh = false } = {}) {
    const params = new URLSearchParams({ id: String(groupId), start, end });
    if (fresh) params.set('fresh', '1');
    return request(`/api/schedule?${params}`);
  },

  teacherSchedule(teacherId, start, end, { fresh = false } = {}) {
    const params = new URLSearchParams({ id: String(teacherId), start, end });
    if (fresh) params.set('fresh', '1');
    return request(`/api/teacher-schedule?${params}`);
  },

  rooms(floor, { date = null, fresh = false } = {}) {
    const params = new URLSearchParams({ floor: String(floor) });
    if (date) params.set('date', date);
    if (fresh) params.set('fresh', '1');
    return request(`/api/rooms?${params}`);
  },
};
