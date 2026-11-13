// Tiny DOM helpers. Text always goes through textContent / text nodes, never innerHTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

export const hmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}
export const monthDay = (ymd) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

// Wraps an async click handler so it runs at most once at a time. The clicked button stays
// disabled until the handler settles, including any navigation it awaits, so a double tap
// cannot repeat the action.
export function busy(fn) {
  let running = false;
  return async function (ev) {
    if (running) return undefined;
    running = true;
    const btn = ev && ev.currentTarget && 'disabled' in ev.currentTarget ? ev.currentTarget : null;
    if (btn) btn.disabled = true;
    try {
      return await fn(ev);
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  };
}
