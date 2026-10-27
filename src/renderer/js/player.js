// Audio engine (HTMLAudio -> Web Audio graph with EQ + analyser) and the play queue.
import { Emitter, shuffle, mediaUrl } from './util.js';
import { state, patchTrack, setSetting } from './store.js';

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble Boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Rock: [5, 4, 2, -1, -2, -1, 2, 3, 4, 4],
  Electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  Jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  Loudness: [5, 3, 0, 0, -1, 0, 0, 0, 3, 4],
  'Late Night': [-3, -2, 0, 1, 2, 2, 1, 0, -2, -3],
};

class Engine extends Emitter {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.ctx = null;
    this.filters = [];
    for (const ev of ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'error', 'waiting', 'playing']) {
      this.audio.addEventListener(ev, () => this.emit(ev));
    }
  }

  ensureGraph() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.source = this.ctx.createMediaElementSource(this.audio);
    this.preamp = this.ctx.createGain();
    this.filters = EQ_FREQS.map((f, i) => {
      const b = this.ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.72;
    this.volumeNode = this.ctx.createGain();
    let node = this.source.connect(this.preamp);
    for (const f of this.filters) node = node.connect(f);
    node.connect(this.analyser);
    this.analyser.connect(this.volumeNode).connect(this.ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Uint8Array(this.analyser.fftSize);
    this.applyEq();
    this.applyVolume();
  }

  applyEq() {
    if (!this.ctx) return;
    const s = state.settings;
    const on = s.eqEnabled;
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(on ? s.eqBands[i] || 0 : 0, this.ctx.currentTime, 0.02));
    this.preamp.gain.setTargetAtTime(on ? 10 ** ((s.eqPreamp || 0) / 20) : 1, this.ctx.currentTime, 0.02);
  }

  applyVolume() {
    const s = state.settings;
    const v = s.muted ? 0 : s.volume ** 2; // perceptual curve
    if (this.volumeNode) this.volumeNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
    else this.audio.volume = v;
  }

  load(track) {
    this.audio.src = mediaUrl(track.path);
    this.audio.load();
  }

  async play() {
    this.ensureGraph();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    try { await this.audio.play(); } catch (e) { if (e.name !== 'AbortError') this.emit('error', e); }
  }

  pause() { this.audio.pause(); }
  get paused() { return this.audio.paused; }
  get time() { return this.audio.currentTime || 0; }
  get duration() { return isFinite(this.audio.duration) ? this.audio.duration : 0; }
  seek(t) { if (this.duration) this.audio.currentTime = Math.max(0, Math.min(t, this.duration - 0.05)); }

  frequency() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.freq);
    return this.freq;
  }
  waveform() {
    if (!this.analyser) return null;
    this.analyser.getByteTimeDomainData(this.wave);
    return this.wave;
  }
  get sampleRate() { return this.ctx?.sampleRate || 48000; }
}

export const engine = new Engine();

// The queue: a context (what the user chose to play), its play order, and a manual "up next" list.
class Queue extends Emitter {
  constructor() {
    super();
    this.context = { label: 'All Songs', kind: 'all', id: null, ids: [] };
    this.order = [];
    this.pos = -1;
    this.upNext = [];
    this.current = null;
    this.counted = false;
    this.history = [];
    engine.on('ended', () => this.onEnded());
    engine.on('timeupdate', () => this.trackListen());
    engine.on('error', () => this.onError());
    // Fill in a missing/estimated length once the decoder knows it.
    engine.on('durationchange', () => {
      const t = this.track;
      if (t && engine.duration && Math.abs((t.duration || 0) - engine.duration) > 1.5) patchTrack(t.id, { duration: engine.duration });
    });
  }

  get track() { return this.current ? state.tracks.get(this.current) : null; }

  // Start playing `ids` (a view, playlist or folder). startId=null picks the first / a random one.
  playContext(ids, startId, ctx = {}, { shuffle: forceShuffle } = {}) {
    if (!ids.length) return;
    if (forceShuffle != null && forceShuffle !== state.settings.shuffle) setSetting('shuffle', forceShuffle);
    this.context = { label: ctx.label || 'Library', kind: ctx.kind || 'all', id: ctx.id ?? null, ids: ids.slice() };
    const first = startId ?? (state.settings.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0]);
    this.buildOrder(first);
    this.start(this.order[this.pos]);
  }

  // Shuffled: the chosen song first, then a random order. In order: the context as-is.
  buildOrder(firstId) {
    const ids = this.context.ids;
    if (state.settings.shuffle) {
      this.order = [firstId, ...shuffle(ids.filter((id) => id !== firstId))];
      this.pos = 0;
    } else {
      this.order = ids.slice();
      this.pos = Math.max(0, ids.indexOf(firstId));
    }
  }

  setShuffle(on) {
    setSetting('shuffle', on);
    if (!this.current || !this.context.ids.length) return this.emit('change');
    this.buildOrder(this.current);
    this.emit('change');
  }

  start(id, { autoplay = true, at = 0 } = {}) {
    const t = state.tracks.get(id);
    if (!t) return;
    if (this.current && this.current !== id) this.history.push(this.current);
    this.current = id;
    this.counted = false;
    engine.load(t);
    if (at) engine.audio.addEventListener('loadedmetadata', () => engine.seek(at), { once: true });
    if (autoplay) engine.play();
    this.emit('track', t);
    this.emit('change');
  }

  jumpTo(id) {
    const qi = this.upNext.indexOf(id);
    if (qi >= 0) { this.upNext.splice(qi, 1); return this.start(id); }
    const oi = this.order.indexOf(id);
    if (oi >= 0) { this.pos = oi; return this.start(id); }
    this.start(id);
  }

  next(auto = false) {
    if (auto && state.settings.repeat === 'one' && this.current) {
      engine.seek(0);
      return engine.play();
    }
    while (this.upNext.length) {
      const id = this.upNext.shift();
      if (state.tracks.has(id)) return this.start(id);
    }
    if (!this.order.length) return;
    let p = this.pos + 1;
    const atEnd = p >= this.order.length;
    if (atEnd) {
      if (auto && state.settings.repeat === 'off') { this.emit('change'); return; }
      if (state.settings.shuffle) this.order = shuffle(this.order);
      p = 0;
    }
    this.pos = p;
    this.start(this.order[p]);
  }

  prev() {
    if (engine.time > 3 || !this.order.length) { engine.seek(0); return; }
    this.pos = (this.pos - 1 + this.order.length) % this.order.length;
    this.start(this.order[this.pos]);
  }

  // The next few songs, for the Up Next list.
  peek(n = 30) {
    const out = this.upNext.slice(0, n).map((id) => ({ id, manual: true }));
    for (let i = this.pos + 1; i < this.order.length && out.length < n; i++) out.push({ id: this.order[i] });
    if (state.settings.repeat === 'all' && !state.settings.shuffle) {
      for (let i = 0; i < this.pos && out.length < n; i++) out.push({ id: this.order[i] });
    }
    return out.filter((x) => state.tracks.has(x.id));
  }

  playNext(ids) { this.upNext.unshift(...ids); this.emit('change'); }
  enqueue(ids) { this.upNext.push(...ids); this.emit('change'); }
  clearUpNext() { this.upNext = []; this.emit('change'); }

  onEnded() {
    this.countPlay();
    this.next(true);
  }

  onError() {
    // Skip unplayable files instead of stalling the queue.
    if (!this.current) return;
    this.emit('unplayable', this.track);
    setTimeout(() => this.next(true), 400);
  }

  trackListen() {
    if (this.counted || !engine.duration) return;
    if (engine.time > Math.min(engine.duration * 0.5, 240)) this.countPlay();
  }

  countPlay() {
    if (this.counted || !this.current) return;
    this.counted = true;
    const t = this.track;
    patchTrack(t.id, { plays: (t.plays || 0) + 1, lastPlayed: Date.now() });
  }

  snapshot() {
    return {
      current: this.current, time: engine.time, pos: this.pos,
      context: { ...this.context, ids: this.context.ids.length > 20000 ? [] : this.context.ids },
      order: this.order.length > 20000 ? [] : this.order,
      upNext: this.upNext,
    };
  }

  restore(s) {
    if (!s?.current || !state.tracks.has(s.current)) return;
    this.context = s.context || this.context;
    this.order = (s.order || []).filter((id) => state.tracks.has(id));
    if (!this.order.length) { this.context.ids = state.allIds; this.buildOrder(s.current); }
    else this.pos = Math.max(0, this.order.indexOf(s.current));
    this.upNext = (s.upNext || []).filter((id) => state.tracks.has(id));
    this.start(s.current, { autoplay: false, at: s.time || 0 });
  }
}

export const queue = new Queue();
