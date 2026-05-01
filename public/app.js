// --- State ---
let state = {
    view: 'constellation', // constellation, chat, stats
    conversations: [],
    activeConversationId: null,
    isStreaming: false
};

// --- Config ---
const POETRY = [
    "Being early is a kind of loneliness.",
    "Language is the house of being.",
    "The limits of my language mean the limits of my world.",
    "To think is to say no.",
    "Time is the substance I am made of.",
    "We are what we remember.",
    "Silence is also a conversation.",
    "Thoughts are shadows of our feelings.",
    "The quieter you become, the more you can hear.",
    "A concept is a brick. It can be used to build a courthouse of reason.",
    "Every word is a prejudice.",
    "To pay attention, this is our endless and proper work.",
    "We read to know we are not alone.",
    "The mind is its own place.",
    "What you seek is seeking you.",
    "Knowledge speaks, but wisdom listens.",
    "There is no truth. There is only perception.",
    "All things are full of labor.",
    "The soul becomes dyed with the color of its thoughts.",
    "Everything we hear is an opinion, not a fact."
];

// --- Initialization ---
async function init() {
    // Check auth
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

    updateHeaderTime();
    setInterval(updateHeaderTime, 60000);
    
    setupEventListeners();
    await fetchConversations();
    renderConstellation();
    
    document.getElementById('brand-header').addEventListener('click', () => switchView('constellation'));
}

// --- API Calls ---
async function fetchConversations() {
    try {
        const res = await fetch('/api/conversations');
        state.conversations = await res.json();
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
    } catch (err) {
        showToast('Failed to create conversation');
    }
}

async function openConversation(id) {
    state.activeConversationId = id;
    switchView('chat');
    
    const messagesEl = document.getElementById('messages');
    messagesEl.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted); font-family: var(--font-mono);">Loading...</div>';
    
    try {
        const res = await fetch(`/api/conversations/${id}`);
        const conv = await res.json();
        
        messagesEl.innerHTML = '';
        if (conv.messages.length === 0) {
            messagesEl.innerHTML = '<div class="empty-state" style="position:static; transform:none; text-align:left; margin-top:40px;"><h2 class="poetry-text" style="font-size:1.8rem;">' + getRandomPoetry() + '</h2></div>';
        } else {
            conv.messages.forEach(msg => {
                appendMessage(msg.role, msg.content, false);
            });
        }
        
        // Update mood background
        applyMoodWash(conv.mood);
        
        // Scroll to bottom
        window.scrollTo(0, document.body.scrollHeight);
        setTimeout(() => document.getElementById('chat-input').focus(), 100);
    } catch (err) {
        messagesEl.innerHTML = '';
        showToast('Failed to load messages');
    }
}

// --- UI Rendering ---

function switchView(viewName) {
    state.view = viewName;
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    
    if (viewName === 'constellation') {
        renderConstellation();
        applyMoodWash(null);
    } else if (viewName === 'stats') {
        renderStats();
        applyMoodWash(null);
    }
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
    
    document.getElementById('brand-header').textContent = `Zee · ${phase}`;
}

function getRandomPoetry() {
    return POETRY[Math.floor(Math.random() * POETRY.length)];
}

function applyMoodWash(mood) {
    const root = document.documentElement;
    if (!mood || ![`contemplative`, `curious`, `playful`, `focused`, `uncertain`, `tired`].includes(mood)) {
        document.body.style.backgroundColor = 'var(--bg-base)';
        return;
    }
    document.body.style.backgroundColor = `var(--bg-surface)`; // fallback 
    // Overlay the wash via a pseudo-element or just changing the base color slightly
    // We'll just change the background color
    document.body.style.backgroundColor = `var(--bg-base)`;
    document.body.style.backgroundImage = `linear-gradient(var(--mood-${mood}), var(--mood-${mood}))`;
}

// Constellation View
function renderConstellation() {
    const svg = document.getElementById('constellation-svg');
    const emptyState = document.getElementById('empty-state');
    
    if (state.conversations.length === 0) {
        svg.style.display = 'none';
        emptyState.style.display = 'block';
        emptyState.textContent = getRandomPoetry();
        return;
    }
    
    svg.style.display = 'block';
    emptyState.style.display = 'none';
    
    // Clear existing
    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }
    
    const width = svg.clientWidth || window.innerWidth;
    const height = svg.clientHeight || (window.innerHeight * 0.6);
    
    // Sort by updated_at
    const sorted = [...state.conversations].sort((a,b) => b.updated_at - a.updated_at);
    
    sorted.forEach((conv, index) => {
        // Recency determines size and opacity
        const rank = index / sorted.length; // 0 to 1
        const radius = Math.max(1, 4 - (rank * 2.5));
        const opacity = Math.max(0.2, 1 - (rank * 0.7));
        
        // Pseudo-random position based on ID string sum
        const idSum = conv.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        
        // Golden angle distribution for natural look
        const angle = idSum * 137.5;
        // Distribute radially based on recency (newer in center)
        const r = 20 + (rank * (Math.min(width, height)/2 - 40));
        
        const cx = (width / 2) + (r * Math.cos(angle * Math.PI / 180));
        const cy = (height / 2) + (r * Math.sin(angle * Math.PI / 180));
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', radius);
        circle.setAttribute('class', 'star');
        circle.setAttribute('opacity', opacity);
        
        // Color based on mood if available
        if (conv.mood) {
            circle.style.fill = `var(--mood-${conv.mood})`; // This is a faint background color, let's just use CSS vars if we had real colors
            // Since our mood vars are rgba(..., 0.05), we can't use them directly for fill
            // Let's map moods to hex:
            const moodColors = {
                contemplative: '#7c5cff',
                curious: '#64c8ff',
                playful: '#ff9b6a',
                focused: '#64ffb4',
                uncertain: '#9696a0',
                tired: '#323246'
            };
            if(moodColors[conv.mood]) {
                circle.style.fill = moodColors[conv.mood];
            }
        }
        
        // Tooltip title
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${conv.title} (${conv.message_count} msgs)`;
        circle.appendChild(title);
        
        circle.addEventListener('click', () => openConversation(conv.id));
        
        svg.appendChild(circle);
    });
}

// Chat rendering
function appendMessage(role, content, animate = false) {
    const messagesEl = document.getElementById('messages');
    
    // Remove empty state if present
    const emptyState = messagesEl.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    if (animate && role === 'assistant') {
        const words = content.split(' ');
        msgDiv.innerHTML = words.map((w, i) => `<span class="word" style="animation-delay: ${i * 0.03}s">${w}</span>`).join(' ');
    } else {
        // Simple text formatting: paragraphs
        const paras = content.split('\n\n');
        msgDiv.innerHTML = paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }
    
    messagesEl.appendChild(msgDiv);
    return msgDiv;
}

// Chat Streaming
async function sendMessage() {
    const inputEl = document.getElementById('chat-input');
    const text = inputEl.value.trim();
    if (!text || state.isStreaming) return;
    
    inputEl.value = '';
    inputEl.style.height = 'auto'; // reset height
    
    if (!state.activeConversationId) {
        await createConversation(); // Creates and sets active ID
    }
    
    appendMessage('user', text);
    window.scrollTo(0, document.body.scrollHeight);
    
    state.isStreaming = true;
    
    // Setup assistant message container with blinking cursor
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
                            // Update UI. Keep it simple: remove cursor, update text, add cursor
                            // For true token-by-token fade, we'd need more complex DOM manipulation.
                            // We will just update text and keep cursor at end.
                            assistantDiv.innerHTML = '';
                            
                            // Format paragraphs
                            const paras = fullText.split('\n\n');
                            const html = paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
                            
                            assistantDiv.innerHTML = html;
                            assistantDiv.appendChild(cursor);
                            
                            // Auto scroll if near bottom
                            const distFromBottom = document.documentElement.scrollHeight - document.documentElement.scrollTop - window.innerHeight;
                            if (distFromBottom < 100) {
                                window.scrollTo(0, document.body.scrollHeight);
                            }
                        }
                    } catch (e) {
                        console.error('JSON parse error on stream chunk');
                    }
                }
            }
        }
        
        // Done streaming
        cursor.remove();
        state.isStreaming = false;
        
        // Refresh conversations in background to get updated title/mood
        fetchConversations();
        
    } catch (err) {
        cursor.remove();
        state.isStreaming = false;
        showToast('Connection lost');
    }
}

// --- Stats View Rendering ---
async function renderStats() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        
        document.getElementById('stat-convs').textContent = stats.total_conversations || 0;
        document.getElementById('stat-msgs').textContent = stats.total_messages || 0;
        document.getElementById('stat-words').textContent = Math.round((stats.total_tokens || 0) * 0.75); // approx words
        
        // Draw SVG Art
        const svg = document.getElementById('stats-svg');
        svg.innerHTML = '';
        
        const width = svg.clientWidth || window.innerWidth - 40;
        const height = 300;
        
        if (state.conversations.length === 0) return;
        
        // Generative art: each conversation is a curved path
        state.conversations.forEach((conv, i) => {
            if (conv.message_count === 0) return;
            
            const startX = (i / state.conversations.length) * width;
            const startY = height;
            
            // Length proportional to msg count
            const maxMsgs = Math.max(...state.conversations.map(c => c.message_count));
            const normLen = (conv.message_count / maxMsgs) * height * 0.8;
            
            const endX = startX + (Math.random() * 100 - 50);
            const endY = height - normLen - 20;
            
            const ctrl1X = startX;
            const ctrl1Y = startY - normLen * 0.5;
            const ctrl2X = endX;
            const ctrl2Y = endY + normLen * 0.5;
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const d = `M ${startX} ${startY} C ${ctrl1X} ${ctrl1Y}, ${ctrl2X} ${ctrl2Y}, ${endX} ${endY}`;
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            
            // Mood color
            const moodColors = {
                contemplative: '#7c5cff', curious: '#64c8ff', playful: '#ff9b6a',
                focused: '#64ffb4', uncertain: '#9696a0', tired: '#323246'
            };
            path.setAttribute('stroke', (conv.mood && moodColors[conv.mood]) ? moodColors[conv.mood] : '#e2e2e8');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('opacity', '0.6');
            path.setAttribute('stroke-linecap', 'round');
            
            svg.appendChild(path);
        });
        
    } catch (err) {
        showToast('Failed to load stats');
    }
}


// --- Command Palette ---
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
        setTimeout(() => input.focus(), 100);
    }
}

function renderPaletteResults(query) {
    const resultsEl = document.getElementById('palette-results');
    resultsEl.innerHTML = '';
    
    let items = state.conversations;
    if (query) {
        items = items.filter(c => c.title.toLowerCase().includes(query.toLowerCase()) || 
                                 (c.mood && c.mood.includes(query.toLowerCase())));
    }
    
    // Add commands
    const commands = [
        { title: 'New Conversation', id: 'cmd_new', meta: '⌘N' },
        { title: 'Browse Constellation', id: 'cmd_browse', meta: 'B' },
        { title: 'View Stats', id: 'cmd_stats', meta: 'S' }
    ];
    
    const matchedCmds = commands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()));
    
    [...matchedCmds, ...items.slice(0, 10)].forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'palette-item';
        if (index === 0) div.classList.add('selected'); // Auto select first
        
        div.innerHTML = `
            <span class="palette-item-title">${item.title}</span>
            <span class="palette-item-meta">${item.meta || (item.mood || '')}</span>
        `;
        
        div.addEventListener('click', () => {
            executePaletteAction(item.id);
            togglePalette();
        });
        
        resultsEl.appendChild(div);
    });
}

function executePaletteAction(id) {
    if (id === 'cmd_new') {
        createConversation();
    } else if (id === 'cmd_browse') {
        switchView('constellation');
    } else if (id === 'cmd_stats') {
        switchView('stats');
    } else {
        openConversation(id);
    }
}

// --- Utils ---
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Header Buttons
    document.getElementById('btn-browse').addEventListener('click', () => switchView('constellation'));
    document.getElementById('btn-stats').addEventListener('click', () => switchView('stats'));
    document.getElementById('btn-new').addEventListener('click', createConversation);
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
    });

    // Chat Input auto-resize and submit
    const inputEl = document.getElementById('chat-input');
    inputEl.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    const sendBtn = document.getElementById('btn-send');
    if(sendBtn) {
        sendBtn.addEventListener('click', () => {
            sendMessage();
        });
    }

    // Command Palette
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

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        // cmd/ctrl + K -> Palette
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            togglePalette();
        }
        // cmd/ctrl + N -> New Conversation
        else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
            e.preventDefault();
            createConversation();
        }
    });
}

// Start
init();
