// Runs before the stylesheet so the first paint already has the right theme.
(function () {
  var t = 'dark';
  try { var v = localStorage.getItem('shopclock.theme'); if (v === 'light' || v === 'auto') t = v; } catch (e) { /* default */ }
  var d = document.documentElement;
  d.dataset.theme = t;
  var light = t === 'light' || (t === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', light ? '#f7f3ec' : '#17140f');
})();
