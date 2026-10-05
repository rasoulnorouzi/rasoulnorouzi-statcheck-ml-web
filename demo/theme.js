// The light and dark switch. The page follows the system theme until the
// reader clicks; the choice is then kept in this browser. It is kept apart
// from app.js so the switch works while the model is still loading.
import { nextTheme } from './support.js';

const KEY = 'statcheck-ml-theme';
const root = document.documentElement;
const button = document.getElementById('theme-toggle');
const label = button.querySelector('.theme-label');
const scanline = document.getElementById('scanline');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function current() {
  return root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
}

function show() {
  const dark = current() === 'dark';
  button.setAttribute('aria-pressed', String(dark));
  label.textContent = dark ? 'night' : 'day';
  button.title = `switch to the ${dark ? 'day' : 'night'} theme`;
}

function sweep() {
  scanline.classList.remove('sweep');
  void scanline.offsetWidth; // restart the animation on a second click
  scanline.classList.add('sweep');
}

button.addEventListener('click', () => {
  const theme = nextTheme(current());
  root.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch (e) { /* not kept; works for this visit */ }
  sweep();
  show();
});
systemDark.addEventListener('change', show);
show();
