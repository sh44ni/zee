const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const llm = require('./llm');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || 'default_secret_for_local_dev_only'));
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth Routes ---

app.post('/auth/request-link', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Prevent leaking whether email exists, return same message
  if (email === auth.OWNER_EMAIL) {
    const token = db.createMagicToken(email);
    await auth.sendMagicLink(email, token);
  }
  
  res.json({ message: 'If the email is registered, a link has been sent.' });
});

app.get('/auth/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login.html?error=invalid');

  const record = db.verifyMagicToken(token);
  if (record) {
    const session = db.createSession(record.email);
    res.cookie('session', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    return res.redirect('/');
  }
  
  res.redirect('/login.html?error=expired');
});

app.post('/auth/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) db.deleteSession(token);
  res.clearCookie('session');
  res.json({ success: true });
});

app.get('/auth/me', (req, res) => {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = db.getSession(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ email: session.email });
});

// --- API Routes (Protected) ---
app.use('/api', auth.requireAuth);

app.get('/api/config', (req, res) => {
  const modelId = process.env.LLM_MODEL || '';
  const modelDisplay =
    process.env.LLM_MODEL_DISPLAY ||
    modelId ||
    'Connected model (set LLM_MODEL in .env)';
  res.json({
    modelId,
    modelDisplay,
    assistantName: process.env.ASSISTANT_NAME || 'Zbeta',
    assistantTagline:
      process.env.ASSISTANT_TAGLINE || 'Your playful personal co-thinker'
  });
});

app.get('/api/conversations', (req, res) => {
  const convs = db.getConversations();
  res.json(convs);
});

app.post('/api/conversations', (req, res) => {
  const id = db.createConversation();
  res.json({ id });
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json(conv);
});

app.patch('/api/conversations/:id', (req, res) => {
  const id = req.params.id;
  const { title, archived } = req.body;
  const conv = db.getConversation(id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  
  db.updateConversation({
    id,
    title: title !== undefined ? title : conv.title,
    summary: conv.summary,
    mood: conv.mood,
    updated_at: Date.now(),
    message_count: conv.message_count,
    total_tokens: conv.total_tokens,
    archived: archived !== undefined ? (archived ? 1 : 0) : conv.archived
  });
  
  res.json({ success: true });
});

app.delete('/api/conversations/:id', (req, res) => {
  const hard = req.query.hard === 'true';
  db.deleteConversation(req.params.id, hard);
  res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
  const { conversationId, content } = req.body;
  if (!conversationId || !content) {
    return res.status(400).json({ error: 'conversationId and content required' });
  }

  const conv = db.getConversation(conversationId);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // 1. Insert user message
  db.insertMessage({
    conversation_id: conversationId,
    role: 'user',
    content
  });

  // 2. Build context
  const assistantName = process.env.ASSISTANT_NAME || 'Zbeta';
  const tagline =
    process.env.ASSISTANT_TAGLINE ||
    'a playful, clever personal AI for exactly one human.';
  const systemPrompt = {
    role: 'system',
    content: `You are ${assistantName}, ${tagline} Be warm, witty, and genuinely helpful—avoid corporate assistant clichés and filler. Use short paragraphs unless the user wants depth. Emoji at most once per message when it truly fits. Occasionally delight with a clever aside; stay accurate and kind.`
  };
  const recentMsgs = db.getRecentMessages(conversationId, 1500);
  const messages = [systemPrompt, ...recentMsgs.map(m => ({ role: m.role, content: m.content }))];

  // 3. Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullResponse = '';
  const startTime = Date.now();
  let tokenCount = 0;

  try {
    // 4. Stream
    const stream = await llm.chatStream(messages);
    for await (const chunk of stream) {
      if (chunk) {
        fullResponse += chunk;
        tokenCount++;
        // Send word-by-word
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
    }

    const latencyMs = Date.now() - startTime;

    // 5. Insert assistant message
    db.insertMessage({
      conversation_id: conversationId,
      role: 'assistant',
      content: fullResponse,
      tokens: tokenCount,
      latency_ms: latencyMs
    });

    res.write(`data: [DONE]\n\n`);
    res.end();

    // 6. Background tasks
    setTimeout(async () => {
      const updatedConv = db.getConversation(conversationId);
      if (!updatedConv) return;

      // Title generation (if >= 2 messages and still default title)
      if (updatedConv.message_count >= 2 && updatedConv.title === 'New conversation') {
        try {
          const firstUserMsg = updatedConv.messages.find(m => m.role === 'user');
          if (firstUserMsg) {
            const titlePrompt = `Summarize this conversation in 4-6 words: ${firstUserMsg.content}`;
            let generatedTitle = await llm.complete(titlePrompt, 15);
            // clean up quotes if any
            generatedTitle = generatedTitle.replace(/^["']|["']$/g, '');
            
            db.updateConversation({
              id: conversationId,
              title: generatedTitle,
              summary: updatedConv.summary,
              mood: updatedConv.mood,
              updated_at: updatedConv.updated_at,
              message_count: updatedConv.message_count,
              total_tokens: updatedConv.total_tokens,
              archived: updatedConv.archived
            });
          }
        } catch (e) {
          console.error('Title generation failed:', e);
        }
      }

      // Mood inference after every AI response
      try {
        const moodPrompt = `Tag this exchange with one emotional tone: [contemplative, curious, playful, focused, uncertain, tired]. User: "${content}". ${assistantName}: "${fullResponse}". Reply ONLY with the single word tone.`;
        let inferredMood = await llm.complete(moodPrompt, 5);
        inferredMood = inferredMood.trim().toLowerCase().replace(/[^a-z]/g, '');
        
        const validMoods = ['contemplative', 'curious', 'playful', 'focused', 'uncertain', 'tired'];
        if (validMoods.includes(inferredMood)) {
          db.updateConversation({
            id: conversationId,
            title: updatedConv.title, // keep current or newly generated title
            summary: updatedConv.summary,
            mood: inferredMood,
            updated_at: updatedConv.updated_at,
            message_count: updatedConv.message_count,
            total_tokens: updatedConv.total_tokens,
            archived: updatedConv.archived
          });
        }
      } catch (e) {
        console.error('Mood inference failed:', e);
      }

    }, 0);

  } catch (err) {
    console.error('Streaming error:', err);
    res.write(`data: {"error": "Failed to stream response"}\n\n`);
    res.end();
  }
});

app.get('/api/stats', (req, res) => {
  const stats = db.getStats();
  res.json(stats);
});

// Fallback for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
if (!process.env.OWNER_EMAIL) {
  console.warn('WARNING: OWNER_EMAIL is not set. Using default immshaani11@gmail.com');
}

app.listen(PORT, () => {
  console.log(`Zbeta assistant running on http://localhost:${PORT}`);
});
