// --- State ---
let state = {
  view: 'constellation',
  conversations: [],
  activeConversationId: null,
  isStreaming: false,
  config: null
};

let deferredInstallPrompt = null;

const MOOD_COLORS = {
  contemplative: '#7c5cff',
  curious: '#64c8ff',
  playful: '#ff9b6a',
  focused: '#64ffb4',
  uncertain: '#9696a0',
  tired: '#323246'
};

const POETRY = [
  'Being early is a kind of loneliness.',
  'Language is the house of being.',
  'The limits of my language mean the limits of my world.',
  'Silence is also a conversation.',
  'What you seek is seeking you.',
  'Knowledge speaks, but wisdom listens.',
  'The soul becomes dyed with the color of its thoughts.',
  'Small sparks start wild constellations.'
];

const WHIMSIES = [
  'Plot twist mode',
  'Caffeinated logic',
  'Soft chaos energy',
  'Half poet, half debugger',
  'Emoji budget: tiny',
  'Your corner of the internet',
  'Ideas welcome 24/7'
];

const THREAD_HINTS = [
  'Say anything odd — I’m into it.',
  'Stuck? Start messy — we’ll tidy later.',
  'Hot take or homework — both work.',
  'Drop a voice note… oh wait, type.',
  'Big brain hours optional.',
  'Confession booth / whiteboard / both.'
];

// --- Init ---
async function init() {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return;
    }
  } catch (e) {
    window.location.href = '/login.html';
    return;
  }

  registerServiceWorker();
  setupInstallBanner();

  await loadConfig();
  updateHeaderTime();
  setInterval(updateHeaderTime, 60000);
  pickWhimsy();

  setupEventListeners();
  await fetchConversations();
  renderConstellation();
  wireBrandHome();
  syncMobileTabs();

  const emptyBtn = document.getElementById('empty-start-btn');
  if (emptyBtn) emptyBtn.addEventListener('click', () => createConversation());
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function setupInstallBanner() {
  const banner = document.getElementById('install-banner');
  const dismiss = document.getElementById('install-banner-dismiss');
  const action = document.getElementById('install-banner-action');
  if (!banner || !action) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!localStorage.getItem('zbeta-pwa-dismiss')) banner.hidden = false;
  });

  action.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showToast('Use “Add to Home Screen” from your browser menu');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    banner.hidden = true;
  });

  dismiss?.addEventListener('click', () => {
    localStorage.setItem('zbeta-pwa-dismiss', '1');
    banner.hidden = true;
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    state.config = await res.json();
    applyConfigToUi();
  } catch (e) {
    /* silent */
  }
}

function applyConfigToUi() {
  const cfg = state.config;
  if (!cfg) return;

  const nameEl = document.getElementById('brand-name');
  if (nameEl) nameEl.textContent = cfg.assistantName || 'Zbeta';

  document.title = cfg.assistantName ? `${cfg.assistantName}` : 'Zbeta';

  const short = cfg.modelDisplay || 'Model';
  const chip = document.getElementById('model-chip-short');
  if (chip) {
    chip.textContent =
      short.length > 22 ? short.slice(0, 20) + '…' : short;
  }

  const detail = document.getElementById('model-detail');
  if (detail) detail.textContent = cfg.modelDisplay || 'Your wired-in model';

  const mobilePill = document.getElementById('thread-model-pill');
  if (mobilePill) {
    const m = cfg.modelDisplay || 'Model';
    mobilePill.textContent = m.length > 28 ? m.slice(0, 26) + '…' : m;
  }
}

function pickWhimsy() {
  const pill = document.getElementById('whimsy-pill');
  if (!pill) return;
  pill.textContent = WHIMSIES[Math.floor(Math.random() * WHIMSIES.length)];
}

function wireBrandHome() {
  const brand = document.getElementById('brand-header');
  if (!brand) return;
  brand.addEventListener('click', () => switchView('constellation'));
  brand.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchView('constellation');
    }
  });
}

// --- API ---
async function fetchConversations() {
  try {
    const res = await fetch('/api/conversations');
    state.conversations = await res.json();
    renderHistoryList(document.getElementById('history-search')?.value || '');
    syncMobileTabs();
  } catch (err) {
    showToast('Failed to load conversations');
  }
}

async function createConversation() {
  try {
    const res = await fetch('/api/conversations', { method: 'POST' });
    const { id } = await res.json();
    await fetchConversations();
    openConversation(id);
    closeHistoryDrawer();
  } catch (err) {
    showToast('Failed to create conversation');
  }
}

async function archiveConversation(id) {
  try {
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true })
    });
    if (state.activeConversationId === id) {
      state.activeConversationId = null;
      switchView('constellation');
    }
    await fetchConversations();
    renderConstellation();
    showToast('Archived — out of the way, not forgotten');
  } catch (e) {
    showToast('Could not archive');
  }
}

async function openConversation(id) {
  state.activeConversationId = id;
  switchView('chat');

  const messagesEl = document.getElementById('messages');
  messagesEl.innerHTML =
    '<div class="history-empty" style="padding:32px;">Loading…</div>';

  try {
    const res = await fetch(`/api/conversations/${id}`);
    const conv = await res.json();

    updateThreadMeta(conv);

    messagesEl.innerHTML = '';
    if (conv.messages.length === 0) {
      const wrap = document.createElement('div');
      wrap.className = 'empty-state';
      wrap.style.cssText =
        'position:static; transform:none; text-align:left; margin-top:32px;';
      wrap.innerHTML = `<h2 class="poetry-text" style="font-size:1.5rem;">${escapeHtml(
        getRandomPoetry()
      )}</h2>`;
      messagesEl.appendChild(wrap);
    } else {
      conv.messages.forEach((msg) => {
        appendMessage(msg.role, msg.content, false);
      });
    }

    applyMoodWash(conv.mood);

    requestAnimationFrame(() => {
      window.scrollTo(0, document.body.scrollHeight);
      document.getElementById('chat-input')?.focus();
    });
  } catch (err) {
    messagesEl.innerHTML = '';
    showToast('Failed to load messages');
  }
}

function updateThreadMeta(conv) {
  const titleEl = document.getElementById('thread-title');
  const hintEl = document.getElementById('thread-hint');
  const dot = document.getElementById('thread-mood-dot');
  const inputDot = document.getElementById('input-mood-dot');

  if (titleEl) titleEl.textContent = conv.title || 'Chat';
  if (hintEl) {
    hintEl.textContent =
      THREAD_HINTS[Math.floor(Math.random() * THREAD_HINTS.length)];
  }

  const color =
    conv.mood && MOOD_COLORS[conv.mood]
      ? MOOD_COLORS[conv.mood]
      : 'var(--text-dim)';
  if (dot) dot.style.background = color;
  if (inputDot) {
    inputDot.style.backgroundColor = color;
    inputDot.style.boxShadow = `0 0 12px ${color}`;
  }
}

// --- Views ---
function switchView(viewName) {
  state.view = viewName;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  const el = document.getElementById(`view-${viewName}`);
  if (el) el.classList.add('active');

  if (viewName === 'constellation') {
    renderConstellation();
    applyMoodWash(null);
  } else if (viewName === 'stats') {
    renderStats();
    applyMoodWash(null);
  } else if (viewName === 'chat') {
    if (!state.activeConversationId) {
      const messagesEl = document.getElementById('messages');
      if (messagesEl && messagesEl.children.length === 0) {
        messagesEl.innerHTML = `<div class="empty-state" style="position:static;margin-top:48px;"><p class="empty-kicker">No thread selected</p><h2 class="poetry-text" style="font-size:1.4rem;">Tap <strong>Chats</strong> or start a new one.</h2></div>`;
      }
    }
  }

  syncMobileTabs();
}

function syncMobileTabs() {
  document.querySelectorAll('.mobile-tabbar .tabbar-btn').forEach((b) => {
    if (b.hasAttribute('data-open-history')) {
      b.classList.remove('tabbar-btn--accent');
      return;
    }
    const go = b.dataset.go;
    b.classList.toggle('tabbar-btn--accent', go === state.view);
  });
}

function updateHeaderTime() {
  const hour = new Date().getHours();
  let phase = 'midnight';
  if (hour >= 3 && hour < 6) phase = 'before dawn';
  else if (hour >= 6 && hour < 9) phase = 'morning';
  else if (hour >= 9 && hour < 12) phase = 'midday';
  else if (hour >= 12 && hour < 15) phase = 'afternoon';
  else if (hour >= 15 && hour < 18) phase = 'golden hour';
  else if (hour >= 18 && hour < 21) phase = 'evening';
  else if (hour >= 21) phase = 'late night';
  else if (hour >= 0 && hour < 3) phase = 'deep night';

  const phaseEl = document.getElementById('brand-phase');
  if (phaseEl) phaseEl.textContent = `· ${phase}`;
}

function getRandomPoetry() {
  return POETRY[Math.floor(Math.random() * POETRY.length)];
}

function applyMoodWash(mood) {
  if (
    !mood ||
    ![
      'contemplative',
      'curious',
      'playful',
      'focused',
      'uncertain',
      'tired'
    ].includes(mood)
  ) {
    document.body.style.backgroundImage = '';
    document.body.style.backgroundColor = 'var(--bg-deep)';
    return;
  }
  document.body.style.backgroundColor = `var(--bg-base)`;
  document.body.style.backgroundImage = `linear-gradient(var(--mood-${mood}), var(--mood-${mood}))`;
}

// --- Constellation ---
function renderConstellation() {
  const svg = document.getElementById('constellation-svg');
  const emptyState = document.getElementById('empty-state');
  const poetryEl = document.getElementById('empty-poetry');
  const kicker = document.getElementById('empty-kicker');

  if (state.conversations.length === 0) {
    svg.style.display = 'none';
    emptyState.style.display = 'block';
    if (poetryEl) poetryEl.textContent = getRandomPoetry();
    if (kicker) kicker.textContent = 'No threads yet';
    return;
  }

  svg.style.display = 'block';
  emptyState.style.display = 'none';

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const width = svg.clientWidth || window.innerWidth;
  const height = svg.clientHeight || window.innerHeight * 0.62;

  const sorted = [...state.conversations].sort(
    (a, b) => b.updated_at - a.updated_at
  );

  sorted.forEach((conv, index) => {
    const rank = index / sorted.length;
    const radius = Math.max(2.5, 6 - rank * 3);
    const opacity = Math.max(0.25, 1 - rank * 0.65);

    const idSum = conv.id
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const angle = idSum * 137.5;
    const r = 24 + rank * (Math.min(width, height) / 2 - 48);

    const cx = width / 2 + r * Math.cos((angle * Math.PI) / 180);
    const cy = height / 2 + r * Math.sin((angle * Math.PI) / 180);

    const circle = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', radius);
    circle.setAttribute('class', 'star');
    circle.setAttribute('opacity', opacity);

    if (conv.mood && MOOD_COLORS[conv.mood]) {
      circle.style.fill = MOOD_COLORS[conv.mood];
    }

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${conv.title} (${conv.message_count} msgs)`;
    circle.appendChild(title);

    circle.addEventListener('click', () => openConversation(conv.id));

    svg.appendChild(circle);
  });
}

// --- Chat ---
function appendMessage(role, content, animate = false) {
  const messagesEl = document.getElementById('messages');
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;

  if (animate && role === 'assistant') {
    const words = content.split(' ');
    msgDiv.innerHTML = words
      .map(
        (w, i) =>
          `<span class="word" style="animation-delay: ${i * 0.03}s">${escapeHtml(w)}</span>`
      )
      .join(' ');
  } else {
    const paras = content.split('\n\n');
    msgDiv.innerHTML = paras
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  if (role === 'user') msgDiv.classList.add('send-pop');

  messagesEl.appendChild(msgDiv);
  return msgDiv;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function sendMessage() {
  const inputEl = document.getElementById('chat-input');
  const text = inputEl.value.trim();
  if (!text || state.isStreaming) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';

  if (!state.activeConversationId) {
    await createConversation();
  }

  appendMessage('user', text);
  window.scrollTo(0, document.body.scrollHeight);

  state.isStreaming = true;

  const messagesEl = document.getElementById('messages');
  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'message assistant';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  assistantDiv.appendChild(cursor);
  messagesEl.appendChild(assistantDiv);

  window.scrollTo(0, document.body.scrollHeight);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.activeConversationId,
        content: text
      })
    });

    if (!response.ok) throw new Error('Network error');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') break;

          try {
            const data = JSON.parse(dataStr);
            if (data.text) {
              fullText += data.text;
              assistantDiv.innerHTML = '';
              const paras = fullText.split('\n\n');
              assistantDiv.innerHTML = paras
                .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
                .join('');
              assistantDiv.appendChild(cursor);

              const distFromBottom =
                document.documentElement.scrollHeight -
                document.documentElement.scrollTop -
                window.innerHeight;
              if (distFromBottom < 120) {
                window.scrollTo(0, document.body.scrollHeight);
              }
            }
          } catch (e) {
            /* chunk */
          }
        }
      }
    }

    cursor.remove();
    state.isStreaming = false;
    fetchConversations();
    bumpAssistantPlayful();
  } catch (err) {
    cursor.remove();
    state.isStreaming = false;
    showToast('Connection lost');
  }
}

function bumpAssistantPlayful() {
  pickWhimsy();
}

// --- Stats ---
async function renderStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();

    document.getElementById('stat-convs').textContent =
      stats.total_conversations || 0;
    document.getElementById('stat-msgs').textContent =
      stats.total_messages || 0;
    document.getElementById('stat-words').textContent = Math.round(
      (stats.total_tokens || 0) * 0.75
    );

    const svg = document.getElementById('stats-svg');
    svg.innerHTML = '';

    const width = svg.clientWidth || window.innerWidth - 40;
    const height = 300;

    if (state.conversations.length === 0) return;

    state.conversations.forEach((conv, i) => {
      if (conv.message_count === 0) return;

      const startX = (i / state.conversations.length) * width;
      const startY = height;

      const maxMsgs = Math.max(
        ...state.conversations.map((c) => c.message_count)
      );
      const normLen = (conv.message_count / maxMsgs) * height * 0.8;

      const endX = startX + (Math.sin(i * 1.7) * 40);
      const endY = height - normLen - 20;

      const ctrl1X = startX;
      const ctrl1Y = startY - normLen * 0.5;
      const ctrl2X = endX;
      const ctrl2Y = endY + normLen * 0.5;

      const path = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path'
      );
      const d = `M ${startX} ${startY} C ${ctrl1X} ${ctrl1Y}, ${ctrl2X} ${ctrl2Y}, ${endX} ${endY}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute(
        'stroke',
        conv.mood && MOOD_COLORS[conv.mood]
          ? MOOD_COLORS[conv.mood]
          : '#e2e2e8'
      );
      path.setAttribute('stroke-width', '2');
      path.setAttribute('opacity', '0.65');
      path.setAttribute('stroke-linecap', 'round');

      svg.appendChild(path);
    });
  } catch (err) {
    showToast('Failed to load stats');
  }
}

// --- History drawer ---
function openHistoryDrawer() {
  document.getElementById('history-overlay')?.classList.add('active');
  document.getElementById('history-drawer')?.classList.add('active');
  document.getElementById('history-overlay')?.setAttribute('aria-hidden', 'false');
  document.getElementById('history-drawer')?.setAttribute('aria-hidden', 'false');
  renderHistoryList(document.getElementById('history-search')?.value || '');
  document.getElementById('history-search')?.focus();
}

function closeHistoryDrawer() {
  document.getElementById('history-overlay')?.classList.remove('active');
  document.getElementById('history-drawer')?.classList.remove('active');
  document.getElementById('history-overlay')?.setAttribute('aria-hidden', 'true');
  document.getElementById('history-drawer')?.setAttribute('aria-hidden', 'true');
}

function renderHistoryList(query) {
  const el = document.getElementById('history-list');
  if (!el) return;

  const q = (query || '').trim().toLowerCase();
  let items = [...state.conversations].sort(
    (a, b) => b.updated_at - a.updated_at
  );

  if (q) {
    items = items.filter(
      (c) =>
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.mood && c.mood.includes(q))
    );
  }

  el.innerHTML = '';
  if (items.length === 0) {
    el.innerHTML =
      '<p class="history-empty">No matches — start something sparkly?</p>';
    return;
  }

  items.forEach((conv) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-item';
    if (conv.id === state.activeConversationId) row.classList.add('active');

    const dotColor =
      conv.mood && MOOD_COLORS[conv.mood]
        ? MOOD_COLORS[conv.mood]
        : 'var(--text-dim)';

    row.innerHTML = `
      <span class="history-item-dot" style="background:${dotColor}"></span>
      <span class="history-item-body">
        <span class="history-item-title">${escapeHtml(conv.title || 'Untitled')}</span>
        <span class="history-item-meta">${formatRelative(conv.updated_at)} · ${conv.message_count || 0} msgs</span>
      </span>
      <button type="button" class="history-archive" data-archive="${escapeHtml(conv.id)}" aria-label="Archive chat">⌁</button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.history-archive')) return;
      closeHistoryDrawer();
      openConversation(conv.id);
    });

    row.querySelector('.history-archive').addEventListener('click', (e) => {
      e.stopPropagation();
      archiveConversation(conv.id);
    });

    el.appendChild(row);
  });
}

function formatRelative(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// --- Model popover ---
function toggleModelPopover() {
  const pop = document.getElementById('model-popover');
  const btn = document.getElementById('btn-model');
  if (!pop || !btn) return;
  const open = pop.hidden;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeModelPopover() {
  const pop = document.getElementById('model-popover');
  const btn = document.getElementById('btn-model');
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// --- Command palette ---
function togglePalette() {
  const overlay = document.getElementById('palette-overlay');
  const input = document.getElementById('palette-input');
  if (overlay.classList.contains('active')) {
    overlay.classList.remove('active');
    input.blur();
  } else {
    overlay.classList.add('active');
    input.value = '';
    renderPaletteResults('');
    setTimeout(() => input.focus(), 80);
  }
}

function renderPaletteResults(query) {
  const resultsEl = document.getElementById('palette-results');
  resultsEl.innerHTML = '';

  let items = state.conversations;
  if (query) {
    items = items.filter(
      (c) =>
        c.title.toLowerCase().includes(query.toLowerCase()) ||
        (c.mood && c.mood.includes(query.toLowerCase()))
    );
  }

  const commands = [
    { title: 'New chat', id: 'cmd_new', meta: '⌘N' },
    { title: 'Open chat list', id: 'cmd_history', meta: 'H' },
    { title: 'Star map', id: 'cmd_browse', meta: 'B' },
    { title: 'Stats', id: 'cmd_stats', meta: 'S' }
  ];

  const matchedCmds = commands.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase())
  );

  [...matchedCmds, ...items.slice(0, 12)].forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'palette-item';
    if (index === 0) div.classList.add('selected');

    div.innerHTML = `
            <span class="palette-item-title">${escapeHtml(item.title)}</span>
            <span class="palette-item-meta">${escapeHtml(item.meta || item.mood || '')}</span>
        `;

    div.addEventListener('click', () => {
      executePaletteAction(item.id);
      togglePalette();
    });

    resultsEl.appendChild(div);
  });
}

function executePaletteAction(id) {
  if (id === 'cmd_new') createConversation();
  else if (id === 'cmd_history') openHistoryDrawer();
  else if (id === 'cmd_browse') switchView('constellation');
  else if (id === 'cmd_stats') switchView('stats');
  else openConversation(id);
}

// --- Utils ---
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

// --- Events ---
function setupEventListeners() {
  document.getElementById('btn-browse').addEventListener('click', () => {
    switchView('constellation');
    closeHistoryDrawer();
  });
  document.getElementById('btn-stats').addEventListener('click', () => {
    switchView('stats');
    closeHistoryDrawer();
  });
  document.getElementById('btn-new').addEventListener('click', () =>
    createConversation()
  );
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  document.getElementById('btn-history').addEventListener('click', () =>
    openHistoryDrawer()
  );
  document.getElementById('btn-close-history').addEventListener('click', () =>
    closeHistoryDrawer()
  );
  document.getElementById('history-overlay').addEventListener('click', () =>
    closeHistoryDrawer()
  );
  document.getElementById('btn-new-from-drawer').addEventListener('click', () =>
    createConversation()
  );

  document.getElementById('history-search').addEventListener('input', (e) => {
    renderHistoryList(e.target.value);
  });

  document.getElementById('btn-model').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleModelPopover();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.model-chip-wrap')) closeModelPopover();
  });

  const inputEl = document.getElementById('chat-input');
  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.getElementById('btn-send').addEventListener('click', () =>
    sendMessage()
  );

  document.getElementById('palette-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'palette-overlay') togglePalette();
  });

  document.getElementById('palette-input').addEventListener('input', (e) => {
    renderPaletteResults(e.target.value);
  });

  document.getElementById('palette-input').addEventListener('keydown', (e) => {
    const selected = document.querySelector('.palette-item.selected');
    const items = Array.from(document.querySelectorAll('.palette-item'));
    const idx = items.indexOf(selected);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selected) selected.classList.remove('selected');
      if (idx < items.length - 1) items[idx + 1].classList.add('selected');
      else if (items.length > 0) items[0].classList.add('selected');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selected) selected.classList.remove('selected');
      if (idx > 0) items[idx - 1].classList.add('selected');
      else if (items.length > 0) items[items.length - 1].classList.add('selected');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selected) selected.click();
    }
  });

  document.querySelectorAll('.mobile-tabbar .tabbar-btn[data-go]').forEach((b) => {
    b.addEventListener('click', () => {
      const go = b.dataset.go;
      if (go) switchView(go);
      closeHistoryDrawer();
    });
  });

  document.querySelectorAll('[data-open-history]').forEach((b) => {
    b.addEventListener('click', () => openHistoryDrawer());
  });

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      togglePalette();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      createConversation();
    } else if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'h' && !isTypingTarget(e.target)) {
      e.preventDefault();
      openHistoryDrawer();
    } else if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'b' && !isTypingTarget(e.target)) {
      e.preventDefault();
      switchView('constellation');
    } else if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 's' && !isTypingTarget(e.target)) {
      e.preventDefault();
      switchView('stats');
    } else if (e.key === 'Escape') {
      closeHistoryDrawer();
      closeModelPopover();
      document.getElementById('palette-overlay').classList.remove('active');
    }
  });
}

function isTypingTarget(el) {
  const tag = el && el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

init();
