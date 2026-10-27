// Windowed list: only rows in view exist in the DOM, so 100k-song libraries scroll smoothly.
export class VirtualList {
  constructor(container, { rowHeight, render, overscan = 8 }) {
    this.el = container;
    this.rowHeight = rowHeight;
    this.render = render;
    this.overscan = overscan;
    this.count = 0;
    this.rows = new Map();
    this.pool = [];
    this.el.classList.add('vlist');
    this.spacer = document.createElement('div');
    this.spacer.className = 'vlist-spacer';
    this.el.append(this.spacer);
    this.el.addEventListener('scroll', () => this.update(), { passive: true });
    new ResizeObserver(() => this.update()).observe(this.el);
  }

  setRowHeight(h) { this.rowHeight = h; this.setCount(this.count, true); }

  setCount(n, force = true) {
    this.count = n;
    this.spacer.style.height = `${n * this.rowHeight}px`;
    if (force) this.refresh();
  }

  // Re-render visible rows in place (data changed) so nodes under the pointer survive.
  refresh() {
    for (const [i, row] of this.rows) {
      if (i >= this.count) { row.remove(); this.pool.push(row); this.rows.delete(i); }
      else this.render(i, row);
    }
    this.update();
  }

  update() {
    const top = this.el.scrollTop, height = this.el.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / this.rowHeight) - this.overscan);
    const last = Math.min(this.count - 1, Math.ceil((top + height) / this.rowHeight) + this.overscan);
    for (const [i, row] of this.rows) {
      if (i < first || i > last) { row.remove(); this.pool.push(row); this.rows.delete(i); }
    }
    for (let i = first; i <= last; i++) {
      if (this.rows.has(i)) continue;
      const row = this.pool.pop() || document.createElement('div');
      row.className = 'vrow';
      row.style.transform = `translateY(${i * this.rowHeight}px)`;
      row.style.height = `${this.rowHeight}px`;
      row.dataset.index = i;
      this.render(i, row);
      this.el.append(row);
      this.rows.set(i, row);
    }
  }

  scrollToIndex(i, center = true) {
    const y = i * this.rowHeight;
    const h = this.el.clientHeight;
    if (!center && y >= this.el.scrollTop && y + this.rowHeight <= this.el.scrollTop + h) return;
    this.el.scrollTop = center ? y - h / 2 + this.rowHeight / 2 : y;
  }

  indexAt(clientY) {
    const r = this.el.getBoundingClientRect();
    return Math.floor((clientY - r.top + this.el.scrollTop) / this.rowHeight);
  }
}
