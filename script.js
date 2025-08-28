(() => {
  'use strict';

  // Elements
  const el = {
    btnStopwatch: document.getElementById('btn-stopwatch'),
    btnCountdown: document.getElementById('btn-countdown'),
    cfgCountdown: document.getElementById('config-countdown'),
    cdHours: document.getElementById('cd-hours'),
    cdMins: document.getElementById('cd-mins'),
    cdSecs: document.getElementById('cd-secs'),
    dHours: document.getElementById('d-hours'),
    dMins: document.getElementById('d-mins'),
    dSecs: document.getElementById('d-secs'),
    dCs: document.getElementById('d-cs'),
    btnStart: document.getElementById('btn-start'),
    btnPause: document.getElementById('btn-pause'),
    btnReset: document.getElementById('btn-reset'),
    btnLap: document.getElementById('btn-lap'),
    lapList: document.getElementById('lap-list'),
    btnClearLaps: document.getElementById('btn-clear-laps'),
    lapsSection: document.getElementById('laps'),
    modeBtns: document.querySelectorAll('.mode-btn'),
    btnPreset5m: document.getElementById('btn-preset-5m'),
  };

  // State
  let mode = 'countdown'; // 'stopwatch' | 'countdown'
  let raf = null;
  let interval = null;
  let running = false;
  let paused = false;
  let startTs = 0; // ms
  let accElapsed = 0; // accumulated paused time (ms)
  let lastTick = 0;
  let displayMs = 0; // what to show

  // Stopwatch specific
  let lastLapTotal = 0; // total time at last lap

  // Countdown specific
  let targetMs = 0;

  // Utils
  const clampInt = (v, min, max) => Math.max(min, Math.min(max, parseInt(v || 0, 10)));
  const getCountdownMs = () => {
    const h = clampInt(el.cdHours.value, 0, 99);
    const m = clampInt(el.cdMins.value, 0, 59);
    const s = clampInt(el.cdSecs.value, 0, 59);
    return (h * 3600 + m * 60 + s) * 1000;
  };

  function formatTime(ms) {
    ms = Math.max(0, Math.floor(ms));
    const cs = Math.floor((ms % 1000) / 10); // centiseconds
    const totalSeconds = Math.floor(ms / 1000);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);
    return {
      h: String(h).padStart(2, '0'),
      m: String(m).padStart(2, '0'),
      s: String(s).padStart(2, '0'),
      cs: String(cs).padStart(2, '0'),
    };
  }

  function render(ms) {
    const f = formatTime(ms);
    el.dHours.textContent = f.h;
    el.dMins.textContent = f.m;
    el.dSecs.textContent = f.s;
    el.dCs.textContent = f.cs;
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    // Toggle button active states
    el.modeBtns.forEach(b => b.classList.remove('active'));
    (mode === 'stopwatch' ? el.btnStopwatch : el.btnCountdown).classList.add('active');
    el.btnStopwatch.setAttribute('aria-selected', mode === 'stopwatch' ? 'true' : 'false');
    el.btnCountdown.setAttribute('aria-selected', mode === 'countdown' ? 'true' : 'false');

    // Show/hide config & laps
    const isCountdown = mode === 'countdown';
    el.cfgCountdown.classList.toggle('hidden', !isCountdown);
    el.cfgCountdown.setAttribute('aria-hidden', (!isCountdown).toString());
    el.lapsSection.style.display = isCountdown ? 'none' : '';

    reset(true);
    if (isCountdown) {
      render(getCountdownMs());
    }
  }

  // Control state management
  function updateButtons() {
    el.btnStart.disabled = running || paused; // Start only from idle
    el.btnPause.disabled = !running && !paused;
    el.btnReset.disabled = !running && !paused && displayMs === 0;
    el.btnLap.disabled = mode !== 'stopwatch' || !running;
    el.btnClearLaps.disabled = el.lapList.children.length === 0;
    el.btnPause.textContent = paused ? '再開' : '一時停止';

    // Disable inputs while running in countdown
    const dis = running || paused;
    [el.cdHours, el.cdMins, el.cdSecs].forEach(inp => inp.disabled = (mode === 'countdown' ? dis : false));
    if (el.btnPreset5m) el.btnPreset5m.disabled = (mode !== 'countdown') || dis;
  }

  // Audio: simple beep
  let audioCtx = null;
  function beep(times = 3, dur = 180, gap = 90, freq = 880) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      let when = audioCtx.currentTime;
      for (let i = 0; i < times; i++) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        o.connect(g); g.connect(audioCtx.destination);
        const s = when;
        const e = when + dur / 1000;
        g.gain.setValueAtTime(0.001, s);
        g.gain.exponentialRampToValueAtTime(0.2, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, e);
        o.start(s); o.stop(e);
        when = e + gap / 1000;
      }
    } catch (_) { /* ignore */ }
  }

  function now() { return performance.now(); }

  function tick() {
    if (!running) return;
    const t = now();
    const elapsed = accElapsed + (t - startTs);
    lastTick = t;
    if (mode === 'stopwatch') {
      displayMs = elapsed;
      render(displayMs);
    } else {
      const remain = Math.max(0, targetMs - elapsed);
      displayMs = remain;
      render(remain);
      if (remain <= 0) {
        finish();
        beep();
        return;
      }
    }
  }

  function start() {
    if (running || paused) return;
    if (mode === 'countdown') {
      const h = clampInt(el.cdHours.value, 0, 99);
      const m = clampInt(el.cdMins.value, 0, 59);
      const s = clampInt(el.cdSecs.value, 0, 59);
      el.cdHours.value = h; el.cdMins.value = m; el.cdSecs.value = s;
      targetMs = (h * 3600 + m * 60 + s) * 1000;
      if (targetMs <= 0) { render(0); updateButtons(); return; }
      render(targetMs);
    }
    running = true; paused = false;
    startTs = now();
    // 30 FPS interval for stable display
    interval = setInterval(tick, 33);
    updateButtons();
  }

  function pauseOrResume() {
    if (!running && !paused) return; // idle
    if (running) {
      // pause
      running = false; paused = true;
      clearInterval(interval); interval = null;
      accElapsed += now() - startTs; // stash elapsed
    } else if (paused) {
      // resume
      running = true; paused = false;
      startTs = now();
      interval = setInterval(tick, 33);
    }
    updateButtons();
  }

  function finish() {
    running = false; paused = false;
    clearInterval(interval); interval = null;
    updateButtons();
  }

  function reset(soft = false) {
    running = false; paused = false;
    clearInterval(interval); interval = null;
    startTs = 0; accElapsed = 0; displayMs = 0; targetMs = 0; lastLapTotal = 0;
    if (!soft) {
      // Keep countdown inputs when toggling mode; otherwise keep them as-is
    }
    render(0);
    updateButtons();
  }

  function addLap() {
    if (mode !== 'stopwatch' || !running) return;
    const total = displayMs;
    const split = total - lastLapTotal;
    lastLapTotal = total;
    const idx = el.lapList.children.length + 1;
    const li = document.createElement('li');
    const fTotal = formatTime(total);
    const fSplit = formatTime(split);
    li.innerHTML = `
      <span class="lap-idx">#${idx}</span>
      <span class="lap-split">+${fSplit.h}:${fSplit.m}:${fSplit.s}.${fSplit.cs}</span>
      <span class="lap-total">${fTotal.h}:${fTotal.m}:${fTotal.s}.${fTotal.cs}</span>
    `;
    el.lapList.appendChild(li);
    el.btnClearLaps.disabled = false;
    // scroll to bottom
    el.lapList.scrollTop = el.lapList.scrollHeight;
  }

  function clearLaps() {
    el.lapList.innerHTML = '';
    el.btnClearLaps.disabled = true;
    lastLapTotal = 0;
  }

  // Event bindings
  el.btnStopwatch.addEventListener('click', () => setMode('stopwatch'));
  el.btnCountdown.addEventListener('click', () => setMode('countdown'));

  el.btnStart.addEventListener('click', start);
  el.btnPause.addEventListener('click', pauseOrResume);
  el.btnReset.addEventListener('click', () => reset());
  el.btnLap.addEventListener('click', addLap);
  el.btnClearLaps.addEventListener('click', clearLaps);

  // Preset: 5 minutes
  if (el.btnPreset5m) {
    el.btnPreset5m.addEventListener('click', () => {
      if (mode !== 'countdown' || running || paused) return;
      el.cdHours.value = 0; el.cdMins.value = 5; el.cdSecs.value = 0;
      render(getCountdownMs());
      updateButtons();
    });
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === ' ') { // start/pause
      e.preventDefault();
      if (!running && !paused) start(); else pauseOrResume();
    } else if (key === 'r') {
      reset();
    } else if (key === 'l') {
      addLap();
    }
  });

  // Sanitize number inputs
  [el.cdHours, el.cdMins, el.cdSecs].forEach(inp => {
    inp.addEventListener('change', () => {
      const ranges = {
        'cd-hours': [0, 99],
        'cd-mins': [0, 59],
        'cd-secs': [0, 59],
      };
      const [min, max] = ranges[inp.id];
      inp.value = clampInt(inp.value, min, max);
      if (mode === 'countdown' && !running && !paused) {
        const h = clampInt(el.cdHours.value, 0, 99);
        const m = clampInt(el.cdMins.value, 0, 59);
        const s = clampInt(el.cdSecs.value, 0, 59);
        const ms = (h * 3600 + m * 60 + s) * 1000;
        render(ms);
      }
    });
  });

  // Initialize
  if (mode === 'countdown') {
    render(getCountdownMs());
  } else {
    render(0);
  }
  updateButtons();
})();
