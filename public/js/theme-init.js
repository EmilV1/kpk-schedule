(function () {
  try {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem('kpk:theme'));
    } catch (e) {
      // старые версии могли записать тему без JSON-кавычек
      stored = localStorage.getItem('kpk:theme');
    }
    var prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme =
      stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light';
    var forced = new URLSearchParams(window.location.search).get('theme');
    if (forced === 'light' || forced === 'dark') theme = forced;
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b0f1a' : '#f4f5fa');
  } catch (e) {
    /* ignore */
  }
})();
