// Shared UI primitives: context menus, toasts, modals and prompts — all themed.
import { h, $ } from './util.js';
import { icon } from './icons.js';

/* ---------- context menu ---------- */
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }

// items: { label, icon, action, danger, disabled, checked, submenu: [...], sep: true, hint }
export function showMenu(x, y, items) {
  closeMenu();
  const root = $('#menu-root');
  const build = (list) => {
    const m = h('div.menu', { role: 'menu' });
    for (const it of list) {
      if (!it) continue;
      if (it.sep) { m.append(h('div.menu-sep')); continue; }
      if (it.header) { m.append(h('div.menu-header', { text: it.header })); continue; }
      const row = h('div.menu-item', { class: `menu-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}` },
        h('span.mi-icon', { html: it.checked ? icon('check', 15) : it.icon ? icon(it.icon, 15) : '' }),
        h('span.mi-label', { text: it.label }),
        it.hint ? h('span.mi-hint', { text: it.hint }) : null,
        it.submenu ? h('span.mi-arrow', { html: icon('chevronRight', 14) }) : null);
      if (it.indent) row.style.paddingLeft = `${10 + it.indent * 14}px`;
      if (it.submenu) {
        const sub = build(it.submenu);
        sub.classList.add('submenu');
        row.append(sub);
        row.addEventListener('mouseenter', () => {
          const r = row.getBoundingClientRect();
          sub.style.display = 'block';
          const sw = sub.offsetWidth, sh = sub.offsetHeight;
          sub.style.left = (r.right + sw > innerWidth ? -sw + 4 : r.width - 4) + 'px';
          sub.style.top = Math.min(0, innerHeight - r.top - sh - 8) + 'px';
        });
        row.addEventListener('mouseleave', () => { sub.style.display = 'none'; });
      } else if (!it.disabled) {
        row.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.action?.(); });
      }
      m.append(row);
    }
    return m;
  };
  const menu = build(items);
  root.append(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - mh - 8) + 'px';
  openMenu = menu;
}
window.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

/* ---------- toasts ---------- */
export function toast(msg, { icon: ic = 'check', timeout = 2800, kind = '' } = {}) {
  const t = h('div.toast', { class: `toast ${kind}` }, h('span.toast-ic', { html: icon(ic, 16) }), h('span', { text: msg }));
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, timeout);
}

/* ---------- modal ---------- */
export function modal({ title, body, wide = false, onClose, className = '' }) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const wrap = h('div.modal-wrap', { onMousedown: (e) => { if (e.target === wrap) close(); } },
    h('div.modal', { class: `modal ${wide ? 'wide' : ''} ${className}` },
      h('div.modal-head', {},
        h('h2', { text: title }),
        h('button.icon-btn', { title: 'Close', html: icon('x', 18), onClick: close })),
      h('div.modal-body', {}, body)));
  $('#modal-root').append(wrap);
  document.addEventListener('keydown', onKey, true);
  return { close, el: wrap };
}

export function prompt(title, { value = '', placeholder = '', ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.text-input', { value, placeholder, spellcheck: 'false' });
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const form = h('form.prompt', { onSubmit: (e) => { e.preventDefault(); finish(input.value.trim() || null); } },
      input,
      h('div.row-end', {},
        h('button.btn', { type: 'button', text: 'Cancel', onClick: () => finish(null) }),
        h('button.btn.primary', { type: 'submit', text: ok })));
    const m = modal({ title, body: form, onClose: () => finish(null) });
    setTimeout(() => { input.focus(); input.select(); }, 20);
  });
}

export function confirmDialog(title, message, { ok = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const body = h('div.prompt', {},
      h('p.muted', { text: message }),
      h('div.row-end', {},
        h('button.btn', { text: 'Cancel', onClick: () => finish(false) }),
        h('button.btn', { class: `btn ${danger ? 'danger' : 'primary'}`, text: ok, onClick: () => finish(true) })));
    const m = modal({ title, body, onClose: () => finish(false) });
  });
}

/* ---------- drag image ---------- */
export function dragBadge(e, text) {
  const b = h('div.drag-badge', { html: `${icon('music', 14)}<span></span>` });
  b.querySelector('span').textContent = text;
  document.body.append(b);
  e.dataTransfer.setDragImage(b, 14, 14);
  setTimeout(() => b.remove(), 0);
}
