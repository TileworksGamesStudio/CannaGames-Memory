/**
 * Memory Match — Core Application Engine
 * Botanical Cannabis Edition with Authoritative Palette,
 * Floating Cannabis Leaf Background & Preserved Game Architecture
 */

(function () {
  'use strict';

  // --- 1. SHARED DAILY RELEASE ENGINE SPECIFICATION ---
  const DailyReleaseClock = (function () {
    const TIMEZONE = 'Europe/London';
    const SYNC_CACHE_KEY = 'tileworks_clock_sync_offset_ms';
    let syncOffsetMs = 0;
    let syncMonotonicOrigin = performance.now();
    let syncTimestampUtc = Date.now();
    let isSynchronized = false;

    try {
      const cached = localStorage.getItem(SYNC_CACHE_KEY);
      if (cached !== null) {
        syncOffsetMs = parseInt(cached, 10) || 0;
      }
    } catch (e) {}

    async function synchronize(httpDateHeader) {
      let authoritativeUtcMs = null;

      if (httpDateHeader) {
        const parsedHeader = Date.parse(httpDateHeader);
        if (!isNaN(parsedHeader) && parsedHeader > 0) {
          authoritativeUtcMs = parsedHeader;
        }
      }

      if (!authoritativeUtcMs) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch('https://worldtimeapi.org/api/timezone/Europe/London', {
            signal: controller.signal,
            cache: 'no-store'
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data && data.unixtime) {
              authoritativeUtcMs = data.unixtime * 1000;
            }
          }
        } catch (netErr) {}
      }

      const nowDevice = Date.now();
      if (authoritativeUtcMs) {
        syncOffsetMs = authoritativeUtcMs - nowDevice;
        syncTimestampUtc = authoritativeUtcMs;
        syncMonotonicOrigin = performance.now();
        isSynchronized = true;
        try {
          localStorage.setItem(SYNC_CACHE_KEY, String(syncOffsetMs));
        } catch (e) {}
      } else {
        syncTimestampUtc = nowDevice + syncOffsetMs;
        syncMonotonicOrigin = performance.now();
      }

      return isSynchronized;
    }

    function getAuthoritativeUtcMs() {
      const monotonicElapsed = performance.now() - syncMonotonicOrigin;
      return syncTimestampUtc + monotonicElapsed;
    }

    function getLondonDateString() {
      const utcMs = getAuthoritativeUtcMs();
      const date = new Date(utcMs);
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(date);
    }

    function getTimeUntilNextRelease() {
      const utcMs = getAuthoritativeUtcMs();
      const date = new Date(utcMs);

      const londonParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      }).formatToParts(date);

      let h = 0, m = 0, s = 0;
      londonParts.forEach(p => {
        if (p.type === 'hour') h = parseInt(p.value, 10);
        if (p.type === 'minute') m = parseInt(p.value, 10);
        if (p.type === 'second') s = parseInt(p.value, 10);
      });

      if (h === 24) h = 0;

      const secondsElapsedToday = (h * 3600) + (m * 60) + s;
      const totalSecondsInDay = 86400;
      let remainingSec = totalSecondsInDay - secondsElapsedToday;

      if (remainingSec <= 0) remainingSec = 0;

      const remHours = Math.floor(remainingSec / 3600);
      const remMinutes = Math.floor((remainingSec % 3600) / 60);
      const remSeconds = remainingSec % 60;

      return {
        totalMs: remainingSec * 1000,
        hours: String(remHours).padStart(2, '0'),
        minutes: String(remMinutes).padStart(2, '0'),
        seconds: String(remSeconds).padStart(2, '0')
      };
    }

    return {
      synchronize,
      getLondonDateString,
      getTimeUntilNextRelease,
      isSync: () => isSynchronized
    };

  })();

  // --- 2. GAME STATE & CONFIGURATION ---
  const GamePhase = {
    IDLE: 'IDLE',
    ONE_UP: 'ONE_UP',
    EVALUATING: 'EVALUATING',
    LOCKED: 'LOCKED',
    COMPLETED: 'COMPLETED'
  };

  const CONFIG = {
    csvPath: './puzzles.csv',
    storageKey: 'cannamemory_match_vault_v2',
    csvCacheKey: 'cannamemory_match_csv_offline_cache',
    soundPrefKey: 'cannamemory_match_sound_enabled',
    bgAnimPrefKey: 'cannamemory_match_bg_anim_enabled'
  };

  const state = {
    phase: GamePhase.IDLE,
    puzzles: [],
    todayDate: '',
    todayPuzzle: null,
    activePuzzle: null,
    isReplay: false,
    boardCards: [],
    flippedIndices: [],
    focusedCardIndex: 0,
    matchedCardCount: 0,
    turns: 0,
    evalTimer: null,
    mismatchTimer: null,
    countdownTimer: null,
    soundEnabled: true,
    bgAnimEnabled: true,
    lastActiveElement: null,
    audioCtx: null,
    dailySession: null,
    vaultSession: null,
    stats: {
      schemaVersion: 2,
      played: 0,
      completed: 0,
      currentStreak: 0,
      bestStreak: 0,
      bestTurns: null,
      lastDailyCompletedDate: '',
      turnHistory: [],
      history: {}
    }
  };

  // --- 3. WEB AUDIO SYNTHESIS ---
  function initAudio() {
    if (!state.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) state.audioCtx = new AudioContext();
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
  }

  function playSound(type) {
    if (!state.soundEnabled) return;
    try {
      initAudio();
      if (!state.audioCtx) return;

      const ctx = state.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'flip') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(170, now + 0.08);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'match') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.09);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.28);
      } else if (type === 'mismatch') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(150, now + 0.08);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (type === 'complete') {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const nOsc = ctx.createOscillator();
          const nGain = ctx.createGain();
          nOsc.type = 'sine';
          nOsc.connect(nGain);
          nGain.connect(ctx.destination);
          const t = now + (idx * 0.09);
          nOsc.frequency.setValueAtTime(freq, t);
          nGain.gain.setValueAtTime(0.12, t);
          nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
          nOsc.start(t);
          nOsc.stop(t + 0.25);
        });
      }
    } catch (e) {}
  }

  function triggerHaptic(type) {
    if (!navigator.vibrate) return;
    try {
      if (type === 'tap') navigator.vibrate(12);
      else if (type === 'match') navigator.vibrate([15, 30, 20]);
      else if (type === 'mismatch') navigator.vibrate(35);
      else if (type === 'complete') navigator.vibrate([30, 40, 30, 40, 50]);
    } catch (e) {}
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    try {
      localStorage.setItem(CONFIG.soundPrefKey, state.soundEnabled ? '1' : '0');
    } catch (e) {}
    updateSoundUI();
    showToast(state.soundEnabled ? 'Audio cues enabled' : 'Audio cues muted');
  }

  function toggleBgAnimation() {
    state.bgAnimEnabled = !state.bgAnimEnabled;
    try {
      localStorage.setItem(CONFIG.bgAnimPrefKey, state.bgAnimEnabled ? '1' : '0');
    } catch (e) {}
    updateBgAnimUI();
    showToast(state.bgAnimEnabled ? 'Botanical atmosphere on' : 'Botanical atmosphere off');
  }

  function updateSoundUI() {
    const glyph = state.soundEnabled ? '🔊' : '🔇';
    const mainIcon = document.getElementById('sound-icon-glyph');
    if (mainIcon) mainIcon.textContent = glyph;

    const btnSetting = document.getElementById('btn-toggle-sound-setting');
    const lblSetting = document.getElementById('lbl-sound-setting');
    if (btnSetting && lblSetting) {
      btnSetting.setAttribute('aria-pressed', state.soundEnabled ? 'true' : 'false');
      lblSetting.textContent = state.soundEnabled ? 'On' : 'Off';
    }
  }

  function updateBgAnimUI() {
    document.body.classList.toggle('bg-anim-off', !state.bgAnimEnabled);
    const btnToggle = document.getElementById('btn-toggle-bg-anim');
    const lblToggle = document.getElementById('lbl-bg-anim');
    if (btnToggle && lblToggle) {
      btnToggle.setAttribute('aria-pressed', state.bgAnimEnabled ? 'true' : 'false');
      lblToggle.textContent = state.bgAnimEnabled ? 'On' : 'Off';
    }
  }

  // --- 4. BOTANICAL ATMOSPHERE (Canvas Ambient Lighting) ---
  const BotanicalAtmosphere = (function () {
    let canvas, ctx;
    let width = 0, height = 0;
    let animId = null;
    let sparkles = [];

    function init(canvasEl) {
      if (!canvasEl) return;
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize, { passive: true });
      setupSparkles();
      startLoop();
    }

    function resize() {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
    }

    function setupSparkles() {
      sparkles = [];
      const count = window.innerWidth < 640 ? 10 : 18;
      for (let i = 0; i < count; i++) {
        sparkles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vy: -(8 + Math.random() * 12),
          vx: (Math.random() - 0.5) * 6,
          radius: 1 + Math.random() * 1.8,
          alpha: 0.15 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    function render(dt, timeSec) {
      ctx.clearRect(0, 0, width, height);
      sparkles.forEach(s => {
        s.y += s.vy * dt;
        s.x += s.vx * dt;
        if (s.y < -10) {
          s.y = height + 10;
          s.x = Math.random() * width;
        }
        if (s.x < -10) s.x = width + 10;
        if (s.x > width + 10) s.x = -10;

        const pulse = Math.sin(timeSec * 2 + s.phase) * 0.4 + 0.6;
        ctx.fillStyle = `rgba(179, 189, 133, ${s.alpha * pulse})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function startLoop() {
      if (animId) cancelAnimationFrame(animId);
      let last = performance.now();

      function step(now) {
        if (!state.bgAnimEnabled) {
          animId = requestAnimationFrame(step);
          return;
        }
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        render(dt, now / 1000);
        animId = requestAnimationFrame(step);
      }
      animId = requestAnimationFrame(step);
    }

    return { init };
  })();

  // --- 5. SVG SANITIZATION & SAFE RENDERING ---
  function sanitizeAndCreateSVG(svgStr) {
    if (!svgStr || typeof svgStr !== 'string') return null;
    const trimmed = svgStr.trim();
    if (!trimmed.includes('<svg') || !trimmed.includes('</svg>')) return null;

    try {
      const template = document.createElement('template');
      template.innerHTML = trimmed;
      const svg = template.content.querySelector('svg');
      if (!svg) return null;

      const dangerousTags = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'style'];
      dangerousTags.forEach(tag => {
        svg.querySelectorAll(tag).forEach(el => el.remove());
      });

      const allElements = [svg, ...svg.querySelectorAll('*')];
      allElements.forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          const name = attr.name.toLowerCase();
          const val = attr.value.toLowerCase();
          if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && val.includes('javascript:'))) {
            el.removeAttribute(attr.name);
          }
        });
      });

      if (!svg.getAttribute('viewBox')) {
        const w = svg.getAttribute('width') || '24';
        const h = svg.getAttribute('height') || '24';
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }

      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.classList.add('card-icon-svg');

      return document.importNode(svg, true);
    } catch (e) {
      return null;
    }
  }

  // --- 6. PERSISTENCE & DATA INTEGRITY ---
  function sanitizeStats(raw) {
    if (!raw || typeof raw !== 'object') return { ...state.stats };
    return {
      schemaVersion: 2,
      played: Number.isInteger(raw.played) && raw.played >= 0 ? raw.played : 0,
      completed: Number.isInteger(raw.completed) && raw.completed >= 0 ? raw.completed : 0,
      currentStreak: Number.isInteger(raw.currentStreak) && raw.currentStreak >= 0 ? raw.currentStreak : 0,
      bestStreak: Number.isInteger(raw.bestStreak) && raw.bestStreak >= 0 ? raw.bestStreak : 0,
      bestTurns: Number.isInteger(raw.bestTurns) && raw.bestTurns > 0 ? raw.bestTurns : null,
      lastDailyCompletedDate: typeof raw.lastDailyCompletedDate === 'string' ? raw.lastDailyCompletedDate : '',
      turnHistory: Array.isArray(raw.turnHistory) ? raw.turnHistory.filter(n => Number.isInteger(n) && n > 0) : [],
      history: (raw.history && typeof raw.history === 'object') ? raw.history : {}
    };
  }

  function loadPersistence() {
    try {
      const soundPref = localStorage.getItem(CONFIG.soundPrefKey);
      if (soundPref !== null) state.soundEnabled = soundPref === '1';

      const bgAnimPref = localStorage.getItem(CONFIG.bgAnimPrefKey);
      if (bgAnimPref !== null) state.bgAnimEnabled = bgAnimPref === '1';

      const raw = localStorage.getItem(CONFIG.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.stats) state.stats = sanitizeStats(parsed.stats);
          if (parsed.dailySession && typeof parsed.dailySession === 'object') {
            state.dailySession = parsed.dailySession;
          }
          if (parsed.vaultSession && typeof parsed.vaultSession === 'object') {
            state.vaultSession = parsed.vaultSession;
          }
        }
      }
    } catch (err) {
      console.warn('Storage read error:', err);
    }
  }

  function savePersistence() {
    try {
      const payload = { stats: state.stats, dailySession: state.dailySession, vaultSession: state.vaultSession };
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(payload));
    } catch (err) {
      console.warn('Unable to persist game progress.', err);
    }
  }

  // --- 7. DETERMINISTIC PRNG SHUFFLE ---
  function createRng(seed) {
    let s = (seed % 2147483647) || 1;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function shuffle(array, seedVal) {
    const copy = [...array];
    const rng = createRng(seedVal);
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  // --- 8. CSV PARSER & EMBARGO SYSTEM ---
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = [];
    let curRow = [];
    let curCell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          curCell += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          curCell += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          curRow.push(curCell.trim());
          curCell = '';
        } else if (char === '\n' || char === '\r') {
          curRow.push(curCell.trim());
          if (curRow.length > 1 || (curRow.length === 1 && curRow[0] !== '')) {
            rows.push(curRow);
          }
          curRow = [];
          curCell = '';
          if (char === '\r' && nextChar === '\n') i++;
        } else {
          curCell += char;
        }
      }
    }
    if (curCell.length || curRow.length) {
      curRow.push(curCell.trim());
      if (curRow.length > 1 || (curRow.length === 1 && curRow[0] !== '')) {
        rows.push(curRow);
      }
    }
    return rows;
  }

  function mapAndValidateRecords(rows) {
    if (rows.length < 2) return [];
    const rawHeaders = rows[0].map(h => h.trim());

    return rows.slice(1).map(row => {
      const record = {};
      rawHeaders.forEach((h, i) => {
        record[h] = row[i] ? row[i].trim() : '';
      });

      const findVal = (prefix, idx) => {
        const target = `${prefix}${idx}`.toLowerCase();
        for (const k of Object.keys(record)) {
          const norm = k.toLowerCase().replace(/[\s_-]/g, '');
          if (norm === target) return record[k];
        }
        return '';
      };

      const items = [];
      const icons = [];

      for (let i = 1; i <= 8; i++) {
        const itemVal = findVal('item', i) || `Item ${i}`;
        const iconVal = findVal('svg', i) || findVal('icon', i) || findVal('itemsvg', i) || '';
        items.push(itemVal);
        icons.push(iconVal);
      }

      const uniqueItems = new Set(items.map(s => s.trim().toLowerCase()));
      if (uniqueItems.size !== 8) {
        return null;
      }

      return {
        date: record.date || '',
        title: record.title || 'Untitled Memory Puzzle',
        items,
        icons
      };
    }).filter(p => p && p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date));
  }

  async function loadPuzzles() {
    let text = '';
    let httpDateHeader = null;

    try {
      const res = await fetch(CONFIG.csvPath, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      httpDateHeader = res.headers.get('date');
      text = await res.text();
      try {
        localStorage.setItem(CONFIG.csvCacheKey, text);
      } catch (e) {}
    } catch (netErr) {
      const cached = localStorage.getItem(CONFIG.csvCacheKey);
      if (cached) {
        text = cached;
        showToast('Playing in offline cache mode');
      } else {
        throw new Error('Unable to connect and no offline records found.');
      }
    }

    await DailyReleaseClock.synchronize(httpDateHeader);
    state.todayDate = DailyReleaseClock.getLondonDateString();

    const rows = parseCSV(text);
    const parsed = mapAndValidateRecords(rows);
    if (!parsed.length) throw new Error('No valid puzzle records found.');

    parsed.sort((a, b) => a.date.localeCompare(b.date));

    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    state.puzzles = isPreview ? parsed : parsed.filter(p => p.date <= state.todayDate);

    const exact = state.puzzles.find(p => p.date === state.todayDate);
    if (exact) {
      state.todayPuzzle = exact;
    } else {
      state.todayPuzzle = state.puzzles.length ? state.puzzles[state.puzzles.length - 1] : parsed[0];
    }
  }

  // --- 9. CARD RENDERING & ACCESSIBILITY ---
  function renderCardDOM(btn, card, index) {
    btn.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = 'card-inner';

    const back = document.createElement('div');
    back.className = 'card-face card-face-back';
    const mark = document.createElement('span');
    mark.className = 'card-back-mark';
    mark.textContent = '❖';
    back.appendChild(mark);

    const front = document.createElement('div');
    front.className = 'card-face card-face-front';

    const content = document.createElement('div');
    content.className = 'card-content';

    if (card && card.icon) {
      const iconEl = sanitizeAndCreateSVG(card.icon);
      if (iconEl) {
        const iconWrap = document.createElement('div');
        iconWrap.className = 'card-icon';
        iconWrap.appendChild(iconEl);
        content.appendChild(iconWrap);
      }
    }

    const word = document.createElement('div');
    word.className = 'card-word';
    word.textContent = card.name;
    content.appendChild(word);
    front.appendChild(content);

    const badge = document.createElement('div');
    badge.className = 'card-match-badge hidden';
    badge.textContent = '✓';
    front.appendChild(badge);

    inner.appendChild(back);
    inner.appendChild(front);
    btn.appendChild(inner);

    btn.setAttribute('aria-label', `Card ${index + 1}`);
  }

  function updateCardAria(btn, card, stateType) {
    if (stateType === 'face-down') {
      btn.setAttribute('aria-label', `Card ${parseInt(btn.dataset.index, 10) + 1}`);
    } else if (stateType === 'flipped') {
      btn.setAttribute('aria-label', `${card.name}`);
    } else if (stateType === 'matched') {
      btn.setAttribute('aria-label', `${card.name}, verified match`);
      const badge = btn.querySelector('.card-match-badge');
      if (badge) badge.classList.remove('hidden');
    }
  }

  // --- 10. VIEW SWITCHING ---
  function showView(viewId) {
    document.querySelectorAll('.app-main .view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');

    if (viewId === 'view-menu') {
      renderMenuView();
    } else if (viewId === 'view-vault') {
      renderVaultView();
    }
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 2400);
  }

  // --- 11. MAIN MENU CONTROLLER ---
  function renderMenuView() {
    const p = state.todayPuzzle;
    if (!p) return;

    document.getElementById('menu-daily-date').textContent = p.date;
    document.getElementById('menu-daily-title').textContent = p.title;

    const completed = state.stats.history[p.date];
    const statusDesc = document.getElementById('menu-daily-status');
    const playLabel = document.getElementById('btn-play-label');
    const countdownWrap = document.getElementById('menu-countdown-wrap');

    if (completed) {
      statusDesc.textContent = `Completed in ${completed.turns} turns (Rating: ${'★'.repeat(completed.stars || 2)})`;
      playLabel.textContent = 'Replay Daily Challenge';
      countdownWrap.classList.remove('hidden');
      updateCountdownDisplays();
    } else if (state.dailySession && state.dailySession.date === p.date) {
      statusDesc.textContent = `In Progress (${state.dailySession.matchedCardCount / 2} / 8 pairs found)`;
      playLabel.textContent = 'Resume Daily Challenge';
      countdownWrap.classList.add('hidden');
    } else {
      statusDesc.textContent = 'Ready to begin';
      playLabel.textContent = 'Play Daily Challenge';
      countdownWrap.classList.add('hidden');
    }

    const archiveCount = state.puzzles.filter(pz => pz.date <= state.todayDate && pz.date !== p.date).length;
    document.getElementById('vault-count-tag').textContent = `${archiveCount} Sets`;
  }

  function updateCountdownDisplays() {
    const rem = DailyReleaseClock.getTimeUntilNextRelease();
    const txt = `${rem.hours}h ${rem.minutes}m ${rem.seconds}s`;

    const el1 = document.getElementById('menu-countdown-val');
    const el2 = document.getElementById('complete-countdown-val');
    if (el1) el1.textContent = txt;
    if (el2) el2.textContent = txt;
  }

  // --- 12. VAULT VIEW CONTROLLER ---
  function renderVaultView() {
    const container = document.getElementById('vault-list');
    container.innerHTML = '';

    const archive = state.puzzles.filter(
      p => p.date <= state.todayDate && p.date !== state.todayPuzzle.date
    );
    archive.sort((a, b) => b.date.localeCompare(a.date));

    if (!archive.length) {
      container.innerHTML = '<div class="card status-card"><p class="status-text">No previous sets archived yet.</p></div>';
      return;
    }

    const groups = {};
    archive.forEach(p => {
      const monthKey = p.date.substring(0, 7);
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(p);
    });

    const monthKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    monthKeys.forEach((mKey, idx) => {
      const details = document.createElement('details');
      details.className = 'vault-month-group';
      if (idx === 0) details.open = true;

      const [year, month] = mKey.split('-');
      const dateObj = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

      const summary = document.createElement('summary');
      summary.className = 'vault-month-summary';
      summary.innerHTML = `<span>${monthName}</span> <span class="vault-badge">${groups[mKey].length} Sets</span>`;
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'vault-month-content';

      groups[mKey].forEach(p => {
        const item = document.createElement('div');
        item.className = 'vault-item';
        const done = state.stats.history[p.date];
        const badgeText = done ? `Solved (${done.turns} turns)` : 'Unplayed';

        item.innerHTML = `
          <div class="vault-info">
            <span class="meta-date">${p.date}</span>
            <span class="vault-title">${p.title}</span>
            <span class="vault-badge">${badgeText}</span>
          </div>
          <button class="btn btn-sm ${done ? '' : 'btn-primary'}" type="button">
            ${done ? 'Replay' : 'Play'}
          </button>
        `;
        item.querySelector('button').onclick = () => loadPuzzle(p);
        content.appendChild(item);
      });

      details.appendChild(content);
      container.appendChild(details);
    });
  }

  // --- 13. GAMEPLAY ENGINE ---
  function cancelPendingTimers() {
    if (state.evalTimer) { clearTimeout(state.evalTimer); state.evalTimer = null; }
    if (state.mismatchTimer) { clearTimeout(state.mismatchTimer); state.mismatchTimer = null; }
  }

  function loadPuzzle(puzzle) {
    cancelPendingTimers();
    state.activePuzzle = puzzle;
    state.flippedIndices = [];
    state.phase = GamePhase.IDLE;
    state.focusedCardIndex = 0;

    const isDaily = puzzle.date === state.todayPuzzle.date;
    const pastRecord = state.stats.history[puzzle.date];
    state.isReplay = !!pastRecord;

    document.getElementById('gameplay-title').textContent = puzzle.title;
    document.getElementById('game-practice-badge').classList.toggle('hidden', !state.isReplay);

    const raw = [];
    puzzle.items.forEach((label, id) => {
      const icon = (puzzle.icons && puzzle.icons[id]) ? puzzle.icons[id] : '';
      raw.push({ id, name: label, icon });
      raw.push({ id, name: label, icon });
    });

    const seedVal = parseInt(puzzle.date.replace(/-/g, ''), 10) || 4242;
    state.boardCards = shuffle(raw, seedVal);

    const sessionKey = isDaily ? 'dailySession' : 'vaultSession';
    const existing = state[sessionKey];
    const isResuming = existing && existing.date === puzzle.date && existing.matchedCardCount < 16;

    if (isResuming) {
      state.turns = existing.turns || 0;
      state.matchedCardCount = existing.matchedCardCount || 0;
    } else {
      state.turns = 0;
      state.matchedCardCount = 0;
      state[sessionKey] = {
        date: puzzle.date,
        turns: 0,
        matchedCardCount: 0,
        matchedIds: []
      };
      savePersistence();
    }

    document.getElementById('stat-turns').textContent = state.turns;
    document.getElementById('stat-pairs').textContent = `${state.matchedCardCount / 2} / 8`;
    document.getElementById('game-feedback').textContent = 'Reveal and match all 8 botanical pairs.';

    const board = document.getElementById('game-board');
    board.innerHTML = '';

    state.boardCards.forEach((card, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card-tile';
      btn.dataset.index = index;
      btn.setAttribute('tabindex', index === 0 ? '0' : '-1');

      renderCardDOM(btn, card, index);

      if (isResuming && state[sessionKey].matchedIds.includes(card.id)) {
        btn.classList.add('matched');
        updateCardAria(btn, card, 'matched');
        btn.setAttribute('aria-disabled', 'true');
      } else {
        updateCardAria(btn, card, 'face-down');
      }

      btn.onclick = () => handleCardInteraction(index);
      board.appendChild(btn);
    });

    showView('view-game');
  }

  function handleCardInteraction(index) {
    if (state.phase === GamePhase.EVALUATING || state.phase === GamePhase.LOCKED || state.phase === GamePhase.COMPLETED) {
      return;
    }
    if (state.flippedIndices.includes(index)) return;

    const board = document.getElementById('game-board');
    const btn = board.children[index];
    if (btn.classList.contains('matched')) return;

    playSound('flip');
    triggerHaptic('tap');

    state.flippedIndices.push(index);
    btn.classList.add('flipped');
    updateCardAria(btn, state.boardCards[index], 'flipped');

    if (state.flippedIndices.length === 1) {
      state.phase = GamePhase.ONE_UP;
      document.getElementById('game-feedback').textContent = 'Locate the corresponding botanical pair...';
    } else if (state.flippedIndices.length === 2) {
      state.phase = GamePhase.EVALUATING;
      state.turns++;
      document.getElementById('stat-turns').textContent = state.turns;

      state.evalTimer = setTimeout(() => {
        state.evalTimer = null;
        evaluateCardPair();
      }, 360);
    }
  }

  function evaluateCardPair() {
    if (state.flippedIndices.length < 2) return;
    const [idx1, idx2] = state.flippedIndices;
    const card1 = state.boardCards[idx1];
    const card2 = state.boardCards[idx2];
    const board = document.getElementById('game-board');
    if (!board) return;

    const btn1 = board.children[idx1];
    const btn2 = board.children[idx2];
    if (!btn1 || !btn2) return;

    const isDaily = state.activePuzzle.date === state.todayPuzzle.date;
    const sessionKey = isDaily ? 'dailySession' : 'vaultSession';

    if (card1.id === card2.id) {
      btn1.classList.add('matched', 'pulse-match');
      btn2.classList.add('matched', 'pulse-match');
      btn1.setAttribute('aria-disabled', 'true');
      btn2.setAttribute('aria-disabled', 'true');
      updateCardAria(btn1, card1, 'matched');
      updateCardAria(btn2, card2, 'matched');

      playSound('match');
      triggerHaptic('match');

      state.matchedCardCount += 2;
      const pairs = state.matchedCardCount / 2;
      document.getElementById('stat-pairs').textContent = `${pairs} / 8`;
      document.getElementById('game-feedback').textContent = `Match: ${card1.name}!`;

      setTimeout(() => {
        btn1.classList.remove('pulse-match');
        btn2.classList.remove('pulse-match');
      }, 350);

      state.flippedIndices = [];
      state.phase = GamePhase.IDLE;

      if (state[sessionKey]) {
        state[sessionKey].turns = state.turns;
        state[sessionKey].matchedCardCount = state.matchedCardCount;
        if (!state[sessionKey].matchedIds.includes(card1.id)) {
          state[sessionKey].matchedIds.push(card1.id);
        }
        savePersistence();
      }

      if (state.matchedCardCount === 16) {
        state.phase = GamePhase.COMPLETED;
        setTimeout(handlePuzzleCompletion, 450);
      }
    } else {
      playSound('mismatch');
      triggerHaptic('mismatch');
      btn1.classList.add('shake-mismatch');
      btn2.classList.add('shake-mismatch');
      document.getElementById('game-feedback').textContent = 'Not a match.';

      state.mismatchTimer = setTimeout(() => {
        btn1.classList.remove('flipped', 'shake-mismatch');
        btn2.classList.remove('flipped', 'shake-mismatch');
        updateCardAria(btn1, card1, 'face-down');
        updateCardAria(btn2, card2, 'face-down');
        state.flippedIndices = [];
        state.phase = GamePhase.IDLE;
        state.mismatchTimer = null;
        document.getElementById('game-feedback').textContent = 'Reveal and match all 8 botanical pairs.';
      }, 850);
    }
  }

  // --- 14. ARROW-KEY GRID NAVIGATION ---
  function handleGridKeydown(e) {
    const board = document.getElementById('game-board');
    if (!board || state.phase === GamePhase.COMPLETED) return;

    let cur = state.focusedCardIndex;
    let next = cur;

    switch (e.key) {
      case 'ArrowRight':
        next = (cur + 1) % 16;
        e.preventDefault();
        break;
      case 'ArrowLeft':
        next = (cur - 1 + 16) % 16;
        e.preventDefault();
        break;
      case 'ArrowDown':
        next = (cur + 4) % 16;
        e.preventDefault();
        break;
      case 'ArrowUp':
        next = (cur - 4 + 16) % 16;
        e.preventDefault();
        break;
      case 'Home':
        next = 0;
        e.preventDefault();
        break;
      case 'End':
        next = 15;
        e.preventDefault();
        break;
      default:
        return;
    }

    if (next !== cur) {
      board.children[cur].setAttribute('tabindex', '-1');
      board.children[next].setAttribute('tabindex', '0');
      board.children[next].focus();
      state.focusedCardIndex = next;
    }
  }

  // --- 15. STREAKS & COMPLETION MODAL ---
  function updateCalendarStreak(solvedDateStr) {
    const s = state.stats;
    if (!s.lastDailyCompletedDate) {
      s.currentStreak = 1;
    } else {
      const last = new Date(s.lastDailyCompletedDate + 'T00:00:00Z');
      const curr = new Date(solvedDateStr + 'T00:00:00Z');
      const diffDays = Math.round((curr - last) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        s.currentStreak++;
      } else if (diffDays === 0) {
        // Solved today
      } else {
        s.currentStreak = 1;
      }
    }
    s.lastDailyCompletedDate = solvedDateStr;
    if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
  }

  function handlePuzzleCompletion() {
    playSound('complete');
    triggerHaptic('complete');

    const turns = state.turns;
    const accuracy = `${Math.max(0, Math.round((8 / turns) * 100))}%`;
    const dateKey = state.activePuzzle.date;
    const isDaily = dateKey === state.todayPuzzle.date;
    const s = state.stats;

    let stars = 1;
    let ratingText = 'Solved!';
    if (turns <= 12) {
      stars = 3;
      ratingText = 'Masterful Botanical Recall!';
    } else if (turns <= 18) {
      stars = 2;
      ratingText = 'Exceptional Knowledge!';
    }

    let isNewBest = false;
    if (!s.history[dateKey]) {
      s.played++;
      s.completed++;
      if (isDaily) updateCalendarStreak(dateKey);

      if (s.bestTurns === null || turns < s.bestTurns) {
        if (s.completed > 1) isNewBest = true;
        s.bestTurns = turns;
      }
      s.turnHistory.push(turns);
      s.history[dateKey] = { turns, accuracy, stars };
    }

    if (isDaily) state.dailySession = null;
    else state.vaultSession = null;
    savePersistence();

    document.getElementById('complete-turns').textContent = turns;
    document.getElementById('complete-accuracy').textContent = accuracy;
    document.getElementById('complete-rating-label').textContent = ratingText;
    document.getElementById('complete-pb-banner').classList.toggle('hidden', !isNewBest);
    document.getElementById('complete-replay-note').classList.toggle('hidden', !state.isReplay);

    const starsBox = document.getElementById('complete-stars');
    starsBox.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const sp = document.createElement('span');
      sp.className = i <= stars ? 'star-glyph' : 'star-glyph star-empty';
      sp.textContent = '★';
      starsBox.appendChild(sp);
    }

    const list = document.getElementById('complete-items-list');
    list.innerHTML = '';
    state.activePuzzle.items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });

    updateCountdownDisplays();
    openModal('modal-complete');
  }

  // --- 16. SHARING SYSTEM ---
  function shareResult() {
    const p = state.activePuzzle || state.todayPuzzle;
    const turns = state.turns || (state.stats.history[p.date] ? state.stats.history[p.date].turns : 0);
    const shareText = `Memory Match — ${p.date}\nCompleted in ${turns} turns!\n🌿🌿🌿🌿\n🌿🌿🌿🌿`;

    if (navigator.share) {
      navigator.share({
        title: 'Memory Match Result',
        text: shareText
      }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        showToast('Result copied to clipboard');
      }).catch(() => {
        showToast('Unable to copy result');
      });
    } else {
      showToast('Sharing not supported on this browser');
    }
  }

  // --- 17. HOW TO PLAY SLIDE PANEL ---
  function openHowToPlayPanel() {
    state.lastActiveElement = document.activeElement;
    const panel = document.getElementById('panel-how-to-play');
    const overlay = document.getElementById('modal-overlay');
    if (!panel || !overlay) return;

    panel.classList.remove('hidden');
    overlay.classList.remove('hidden');

    void panel.offsetWidth;
    panel.classList.add('panel-open');

    const focusable = panel.querySelectorAll('button, [href]');
    if (focusable.length) focusable[0].focus();
  }

  function closeHowToPlayPanel() {
    const panel = document.getElementById('panel-how-to-play');
    if (!panel) return;

    panel.classList.remove('panel-open');
    setTimeout(() => {
      panel.classList.add('hidden');
      const activeModal = document.querySelector('.modal:not(.hidden)');
      if (!activeModal) {
        document.getElementById('modal-overlay').classList.add('hidden');
      }
      if (state.lastActiveElement && typeof state.lastActiveElement.focus === 'function') {
        state.lastActiveElement.focus();
      }
    }, 400);
  }

  // --- 18. MODALS & FOCUS TRAP ---
  function openModal(modalId) {
    state.lastActiveElement = document.activeElement;
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));

    const target = document.getElementById(modalId);
    if (target) {
      target.classList.remove('hidden');
      document.getElementById('modal-overlay').classList.remove('hidden');
      const focusable = target.querySelectorAll('button, [href], input, textarea');
      if (focusable.length) focusable[0].focus();
    }
  }

  function closeAllModals() {
    closeHowToPlayPanel();
    document.querySelectorAll('.modal').forEach(el => el.classList.add('hidden'));
    document.getElementById('modal-overlay').classList.add('hidden');
    if (state.lastActiveElement && typeof state.lastActiveElement.focus === 'function') {
      state.lastActiveElement.focus();
    }
  }

  function handleModalTrap(e) {
    const activeModal = document.querySelector('.modal:not(.hidden)') || document.querySelector('.slide-panel.panel-open');
    if (!activeModal) return;

    if (e.key === 'Escape') {
      closeAllModals();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = Array.from(activeModal.querySelectorAll('button, [href], input, textarea')).filter(
        el => !el.disabled && el.offsetParent !== null
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }

  // --- 19. STATS & MIGRATION ---
  function renderStatsModal() {
    const s = state.stats;
    document.getElementById('stat-modal-played').textContent = s.played;
    document.getElementById('stat-modal-completed').textContent = s.completed;
    document.getElementById('stat-modal-streak').textContent = s.currentStreak;
    document.getElementById('stat-modal-best-streak').textContent = s.bestStreak;
    document.getElementById('stat-modal-best-turns').textContent = s.bestTurns !== null ? s.bestTurns : '—';

    const avg = s.turnHistory.length
      ? (s.turnHistory.reduce((a, b) => a + b, 0) / s.turnHistory.length).toFixed(1)
      : '—';
    document.getElementById('stat-modal-avg-turns').textContent = avg;
    document.getElementById('import-block').classList.add('hidden');
  }

  function exportBackupData() {
    const payload = JSON.stringify(state.stats);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(() => {
        showToast('Backup JSON copied to clipboard!');
      }).catch(() => {
        showToast('Failed copying to clipboard.');
      });
    } else {
      prompt('Copy your backup string:', payload);
    }
  }

  function applyImportedData() {
    const txtArea = document.getElementById('import-data-text');
    const raw = txtArea.value.trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      state.stats = sanitizeStats(parsed);
      savePersistence();
      renderStatsModal();
      txtArea.value = '';
      showToast('Records imported successfully!');
    } catch (e) {
      showToast('Invalid backup code.');
    }
  }

  // --- 20. MIDNIGHT ROLLOVER ---
  async function checkDayRollover() {
    const newLondonDate = DailyReleaseClock.getLondonDateString();
    if (state.todayDate && newLondonDate !== state.todayDate) {
      state.todayDate = newLondonDate;
      try {
        await loadPuzzles();
        renderMenuView();
        showToast('New daily challenge unlocked!');
      } catch (e) {}
    }
  }

  // --- 21. EVENT BINDING ---
  function setupEvents() {
    document.getElementById('btn-sound-toggle').onclick = toggleSound;
    document.getElementById('btn-toggle-sound-setting').onclick = toggleSound;
    document.getElementById('btn-toggle-bg-anim').onclick = toggleBgAnimation;
    updateSoundUI();
    updateBgAnimUI();

    document.getElementById('btn-play-game').onclick = () => loadPuzzle(state.todayPuzzle);
    document.getElementById('btn-open-vault').onclick = () => showView('view-vault');
    document.getElementById('btn-open-settings').onclick = () => openModal('modal-settings');
    document.getElementById('btn-open-how-to-play').onclick = openHowToPlayPanel;

    document.getElementById('btn-util-stats').onclick = () => {
      renderStatsModal();
      openModal('modal-stats');
    };
    document.getElementById('btn-util-share').onclick = shareResult;
    document.getElementById('btn-util-plus').onclick = () => openModal('modal-plus');

    document.getElementById('btn-vault-back').onclick = () => showView('view-menu');

    document.getElementById('btn-game-back').onclick = () => {
      cancelPendingTimers();
      showView('view-menu');
    };
    document.getElementById('btn-game-rules').onclick = openHowToPlayPanel;
    document.getElementById('btn-reset-board').onclick = () => openModal('modal-reset');
    document.getElementById('btn-reset-cancel').onclick = closeAllModals;
    document.getElementById('btn-reset-confirm').onclick = () => {
      closeAllModals();
      cancelPendingTimers();
      const isDaily = state.activePuzzle.date === state.todayPuzzle.date;
      if (isDaily) state.dailySession = null;
      else state.vaultSession = null;
      savePersistence();
      loadPuzzle(state.activePuzzle);
    };

    document.getElementById('game-board').addEventListener('keydown', handleGridKeydown);

    document.getElementById('btn-close-htp').onclick = closeHowToPlayPanel;
    document.getElementById('btn-htp-got-it').onclick = closeHowToPlayPanel;

    document.getElementById('btn-complete-share').onclick = shareResult;
    document.getElementById('btn-complete-vault').onclick = () => {
      closeAllModals();
      showView('view-vault');
    };
    document.getElementById('btn-complete-menu').onclick = () => {
      closeAllModals();
      showView('view-menu');
    };

    document.getElementById('modal-overlay').onclick = closeAllModals;
    document.querySelectorAll('.btn-close').forEach(b => {
      b.onclick = closeAllModals;
    });
    document.addEventListener('keydown', handleModalTrap);

    document.getElementById('btn-export-backup').onclick = exportBackupData;
    document.getElementById('btn-import-backup-toggle').onclick = () => {
      const blk = document.getElementById('import-block');
      blk.classList.toggle('hidden');
    };
    document.getElementById('btn-import-apply').onclick = applyImportedData;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        DailyReleaseClock.synchronize(null).then(checkDayRollover);
      }
    });
    window.addEventListener('focus', () => {
      DailyReleaseClock.synchronize(null).then(checkDayRollover);
    });
    window.addEventListener('online', () => {
      DailyReleaseClock.synchronize(null).then(checkDayRollover);
    });

    state.countdownTimer = setInterval(() => {
      updateCountdownDisplays();
      checkDayRollover();
    }, 1000);
  }

  // --- 22. INITIALIZATION ---
  async function init() {
    loadPersistence();
    BotanicalAtmosphere.init(document.getElementById('bg-canvas'));
    setupEvents();

    try {
      await loadPuzzles();
      showView('view-menu');
    } catch (err) {
      console.error('Initialization error:', err);
      const msgEl = document.getElementById('status-message');
      msgEl.textContent = 'Unable to connect to botanical puzzle archive.';
      const retryBtn = document.getElementById('btn-retry');
      retryBtn.classList.remove('hidden');
      retryBtn.onclick = () => {
        retryBtn.classList.add('hidden');
        msgEl.textContent = 'Connecting...';
        init();
      };
      showView('view-status');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();