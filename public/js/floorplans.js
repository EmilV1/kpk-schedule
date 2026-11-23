/**
 * Геометрия этажей для раздела «Карта».
 * Координаты — в системе viewBox 1000×560, пропорции повторяют схемы колледжа.
 */

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 560;

export const FLOORS = [
  {
    floor: 1,
    title: '1 этаж',
    rooms: [
      { id: 'f1-1', label: '№1', x: 70, y: 395, w: 110, h: 125 },
      { id: 'f1-2', label: '№2', x: 70, y: 40, w: 110, h: 260, vertical: true },
      { id: 'f1-3', label: '№3', x: 180, y: 40, w: 62, h: 145 },
      { id: 'f1-4', label: '№4', x: 242, y: 40, w: 62, h: 145 },
      { id: 'f1-5', label: '№5', x: 304, y: 40, w: 62, h: 145 },
      { id: 'f1-6', label: '№6', x: 366, y: 40, w: 62, h: 145 },
      { id: 'f1-7', label: '№7', x: 428, y: 40, w: 62, h: 145 },
      { id: 'f1-8', label: '№8', x: 490, y: 40, w: 62, h: 145 },
      { id: 'f1-9', label: '№9', x: 625, y: 40, w: 120, h: 145 },
      { id: 'f1-10', label: '№10', x: 745, y: 40, w: 120, h: 145 },
      { id: 'f1-11', label: '№11', x: 865, y: 40, w: 65, h: 300, vertical: true },
      { id: 'f1-canteen', label: 'Столовая', x: 820, y: 395, w: 110, h: 125 },
    ],
    decor: [
      { type: 'stairs', x: 70, y: 300, w: 110, h: 95 },
      { type: 'stairs', x: 865, y: 340, w: 65, h: 55 },
      { type: 'void', x: 300, y: 300, w: 520, h: 200 },
      { type: 'entrance', x: 580, y: 245, w: 80, h: 40 },
      { type: 'small', x: 180, y: 455, w: 55, h: 65, label: 'тех.' },
      { type: 'small', x: 240, y: 455, w: 45, h: 65, label: 'WC', tone: 'female' },
      { type: 'divider', x: 552, y: 40, w: 38, h: 145, label: 'раздевалка' },
      { type: 'divider', x: 590, y: 40, w: 35, h: 145, label: 'раздевалка' },
    ],
  },
  {
    floor: 2,
    title: '2 этаж',
    rooms: [
      { id: 'f2-13', label: '№13', x: 70, y: 440, w: 110, h: 80 },
      { id: 'f2-14', label: '№14', x: 70, y: 375, w: 110, h: 65 },
      { id: 'f2-15', label: '№15', x: 70, y: 40, w: 110, h: 240, vertical: true },
      { id: 'f2-16', label: '№16', x: 180, y: 40, w: 114, h: 145 },
      { id: 'f2-17', label: '№17', x: 294, y: 40, w: 114, h: 145 },
      { id: 'f2-18', label: '№18', x: 408, y: 40, w: 114, h: 145 },
      { id: 'f2-19', label: '№19', x: 522, y: 40, w: 114, h: 145 },
      { id: 'f2-20', label: '№20', x: 636, y: 40, w: 114, h: 145 },
      { id: 'f2-21', label: '№21', x: 750, y: 40, w: 115, h: 145 },
      { id: 'f2-22', label: '№22', x: 865, y: 40, w: 65, h: 240, vertical: true },
      { id: 'f2-23', label: '№23', x: 865, y: 375, w: 65, h: 65 },
      { id: 'f2-24', label: '№24', x: 805, y: 440, w: 125, h: 80 },
      { id: 'f2-med', label: 'Медпункт', x: 180, y: 455, w: 105, h: 65, smallText: true },
    ],
    decor: [
      { type: 'stairs', x: 70, y: 280, w: 110, h: 95 },
      { type: 'stairs', x: 865, y: 280, w: 65, h: 95 },
      { type: 'void', x: 300, y: 280, w: 505, h: 220 },
      { type: 'small', x: 180, y: 455, w: 50, h: 65, label: 'технич.' },
      { type: 'small', x: 235, y: 455, w: 50, h: 65, label: 'мед.' },
    ],
  },
  {
    floor: 3,
    title: '3 этаж',
    rooms: [
      { id: 'f3-27', label: '№27', x: 70, y: 440, w: 105, h: 80 },
      { id: 'f3-28', label: '№28', x: 70, y: 375, w: 105, h: 65 },
      { id: 'f3-library', label: 'Библиотека', x: 70, y: 40, w: 105, h: 240, vertical: true },
      { id: 'f3-reading', label: ['Читальный', 'зал'], x: 175, y: 40, w: 138, h: 145 },
      { id: 'f3-30', label: '№30', x: 313, y: 40, w: 138, h: 145 },
      { id: 'f3-31', label: '№31', x: 451, y: 40, w: 138, h: 145 },
      { id: 'f3-32', label: '№32', x: 589, y: 40, w: 138, h: 145 },
      { id: 'f3-33', label: '№33', x: 727, y: 40, w: 138, h: 145 },
      { id: 'f3-34', label: '№34', x: 865, y: 40, w: 65, h: 240, vertical: true },
      { id: 'f3-35', label: '№35', x: 805, y: 375, w: 125, h: 145 },
    ],
    decor: [
      { type: 'stairs', x: 70, y: 280, w: 105, h: 95 },
      { type: 'stairs', x: 865, y: 280, w: 65, h: 95 },
      { type: 'void', x: 300, y: 280, w: 505, h: 220 },
      { type: 'small', x: 175, y: 455, w: 50, h: 65, label: 'WC', tone: 'male' },
      { type: 'small', x: 225, y: 455, w: 50, h: 65, label: 'WC', tone: 'female' },
    ],
  },
  {
    floor: 4,
    title: '4 этаж',
    rooms: [
      { id: 'f4-41', label: '№41', x: 60, y: 40, w: 105, h: 220, vertical: true },
      { id: 'f4-40', label: '№40', x: 60, y: 400, w: 105, h: 120 },
      { id: 'f4-coach', label: 'Тренерская', x: 165, y: 40, w: 80, h: 70, smallText: true },
      { id: 'f4-mlocker', label: 'М. раздевалка', x: 60, y: 355, w: 105, h: 45, smallText: true },
      { id: 'f4-gym', label: 'Спортзал', x: 165, y: 110, w: 300, h: 150 },
      { id: 'f4-assembly', label: ['Актовый', 'зал'], x: 465, y: 40, w: 300, h: 220 },
      { id: 'f4-44', label: '№44', x: 765, y: 40, w: 100, h: 220, vertical: true },
      { id: 'f4-45', label: '№45', x: 700, y: 355, w: 165, h: 165 },
      { id: 'f4-wc', label: 'WC', x: 165, y: 440, w: 105, h: 80, tone: 'male' },
    ],
    decor: [
      { type: 'stairs', x: 60, y: 260, w: 105, h: 95 },
      { type: 'stairs', x: 765, y: 260, w: 100, h: 95 },
      { type: 'void', x: 280, y: 260, w: 420, h: 240 },
    ],
  },
];

export function getFloor(floor) {
  return FLOORS.find((item) => item.floor === Number(floor)) || FLOORS[0];
}
