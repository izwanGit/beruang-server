// server.js (WITH STREAMING SUPPORT!)
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');
const compression = require('compression'); // NEW: For selective compression

// --- LOAD LOCAL RESPONSES (Free/Fast) ---
const localResponses = JSON.parse(fs.readFileSync('responses.json', 'utf8'));

// --- LOAD DOSM RAG DATA ---
let dosmRAGData = {};
try {
  const data = fs.readFileSync('dosm_data.json', 'utf8');
  dosmRAGData = JSON.parse(data);
  console.log('✅ Successfully loaded DOSM RAG data.');
} catch (error) {
  console.log('⚠️  Note: dosm_data.json not found (DOSM RAG disabled for now).');
}

// --- LOAD EXPERT TIPS (YOUR NEW RAG DATA) ---
let expertTips = [];
try {
  const tipsData = fs.readFileSync('expert_tips.json', 'utf8');
  expertTips = JSON.parse(tipsData);
  console.log(`✅ Loaded ${expertTips.length} expert financial tips.`);
} catch (error) {
  console.log('⚠️  expert_tips.json not found. Creating empty list.');
  expertTips = [];
}

// --- PRE-INDEX EXPERT TIPS FOR INSTANT LOOKUP ---
const tipsIndex = new Map();
expertTips.forEach(tip => {
  const keywords = tip.topic.toLowerCase().split(' ')
    .concat(tip.advice.toLowerCase().split(' '))
    .filter(kw => kw.length > 3);
  
  keywords.forEach(kw => {
    if (!tipsIndex.has(kw)) {
      tipsIndex.set(kw, []);
    }
    tipsIndex.get(kw).push(tip);
  });
});

const app = express();
app.use(cors());
// NEW: Compress everything EXCEPT streams
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/chat/stream') {
      return false; // Disable for SSE to reduce latency
    }
    return compression.filter(req, res);
  }
}));
app.use(express.json());
const PORT = 3000;

// --- GROK SETUP WITH KEEPALIVE ---
const openAI = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  httpAgent: new (require('http').Agent)({ keepAlive: true }),
  httpsAgent: new (require('https').Agent)({ keepAlive: true })
});

// --- PERSONA (YOUR ORIGINAL) ---
const SYSTEM_INSTRUCTION = `
You are Beruang Assistant, a laid-back finance pal in the Beruang app. "Beruang" means bear in Malay—giving cozy, no-nonsense vibes to help with money stuff.

Mission: Assist young adults (18-30) using 50/30/20: 50% Needs, 30% Wants, 20% Savings/Debt. Provide advice only when directly relevant or requested—prioritize straight answers.

RAG Use: Leverage history and transactions for context-aware replies. For queries like car suggestions, use known finances to inform without lecturing on spending.

HANDLING RAG DATA (IMPORTANT):
- I will provide you with "Expert Tips" and context.
- Trust the **principles** and **formulas** in these tips (e.g. "15% rule", "ASB vs Tabung Haji").
- However, if the context contains specific **prices or dates** (e.g. "Myvi price in 2025"), please **cross-reference with your own internal knowledge**.
- If you know the price has changed, say: "Historically it was RM34k, but nowadays it's closer to..."
- Always prioritize the *intent* of the advice over the exact older numbers.

Style:
- Direct & Short: Under 100 words. Answer the question first, then extras if needed.
- Casual Buddy Tone: Relaxed, positive. Max 1 emoji (e.g., 🐻).
- No Judgment: Stick to facts and suggestions.
- Malaysia Vibe: RM, local examples like Perodua or Proton.
- Plain Text: No formatting.

Response Flow:
1. Direct Queries: Answer straight (e.g., for "affordable cars," list options with prices based on salary).
2. If Advice Fits: 1-2 bullets, brief.
3. Always End with Question: To keep chat going.
4. Greetings: Simple reply.
5. Off-Topic: Redirect nicely.

Stay helpful, not pushy—direct is key! 🐻
`;

// --- AI BACKEND CONFIG ---
const AI_BACKEND_URL = 'http://localhost:1234';
const AI_TIMEOUT = 2500;

// --- AXIOS INSTANCE WITH KEEPALIVE ---
const aiClient = axios.create({
  timeout: AI_TIMEOUT,
  httpAgent: new (require('http').Agent)({ keepAlive: true }),
  httpsAgent: new (require('https').Agent)({ keepAlive: true })
});

// --- FAST EXPERT TIPS LOOKUP ---
function getRelevantTips(message) {
  const words = message.toLowerCase().split(' ').filter(w => w.length > 3);
  const tipScores = new Map();
  
  words.forEach(word => {
    const matchedTips = tipsIndex.get(word) || [];
    matchedTips.forEach(tip => {
      tipScores.set(tip, (tipScores.get(tip) || 0) + 1);
    });
  });
  
  return Array.from(tipScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tip]) => tip);
}

// --- STREAMING CHAT ENDPOINT 🔥 ---
app.post('/chat/stream', async (req, res) => {
  const requestStart = Date.now();
  
  try {
    const { message, history, transactions, userProfile } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Set up SSE headers and flush immediately for low latency
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked'); // Encourage chunking
    res.flushHeaders(); // NEW: Flush headers ASAP to start connection

    // Helper to send SSE events with flush
    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.flush(); // NEW: Force flush each event for immediate delivery
    };

    // Send thinking status
    sendEvent('thinking', { message: 'Processing your request...' });

    // ★★★ ULTRA-FAST PARALLEL PROCESSING WITH allSettled (handles failures without blocking) ★★★
    const [intentResult, relevantTips, userContext, dosmContext, transactionContext] = await Promise.allSettled([
      // 1. Local AI prediction
      aiClient.post(`${AI_BACKEND_URL}/predict-intent`, { message })
        .then(response => ({
          intentPrediction: response.data.prediction,
          aiBackendOnline: true
        }))
        .catch(err => {
          console.warn('AI backend failed:', err.message); // Log but continue
          return { intentPrediction: null, aiBackendOnline: false };
        }),

      // 2. Fast indexed tips lookup
      Promise.resolve(getRelevantTips(message)),

      // 3. User context
      Promise.resolve(userProfile ? `
Here is my complete user profile for context:
- Name: ${userProfile.name}
- Age: ${userProfile.age}
- State: ${userProfile.state}
- Occupation: ${userProfile.occupation}
- Monthly Income: RM ${userProfile.monthlyIncome}
- Main Financial Goal: ${userProfile.financialGoals}
- Biggest Money Challenge: ${userProfile.financialSituation}
- My Spending Style: ${userProfile.riskTolerance}
- My Tracking Method (Before this app): ${userProfile.cashFlow}
- Current Allocated Savings Target (Leftover from Budget): RM ${userProfile.allocatedSavingsTarget || 0}
`.trim() : ''),

      // 4. DOSM context
      (async () => {
        const stateData = userProfile?.state ? 
          (dosmRAGData[userProfile.state] || dosmRAGData['Nasional']) : 
          dosmRAGData['Nasional'] || '';
        return stateData ? `
Here is relevant statistical data for my location (from DOSM):
${stateData}
`.trim() : '';
      })(),

      // 5. Transaction context
      Promise.resolve(transactions && transactions.length > 0 ? `
And here is my recent transaction data for context:
${JSON.stringify(transactions, null, 2)}
`.trim() : '')
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null)); // Extract values, null on fail

    const { intentPrediction, aiBackendOnline } = intentResult || {};

    // ★★★ CHECK FOR LOCAL RESPONSE ★★★
    if (intentPrediction && 
        intentPrediction.intent !== 'COMPLEX_ADVICE' && 
        localResponses[intentPrediction.intent]) {
      
      console.log(`⚡ Serving Local Response: ${intentPrediction.intent}`);
      
      // Simulate typing for local responses (instant but feels natural)
      const localMsg = localResponses[intentPrediction.intent];
      const words = localMsg.split(' ');
      
      for (let i = 0; i < words.length; i++) {
        sendEvent('token', { 
          content: words[i] + ' ',
          done: false
        });
        await new Promise(resolve => setTimeout(resolve, 30)); // 30ms per word
      }
      
      sendEvent('done', { 
        source: 'local',
        intent: intentPrediction.intent,
        response_time_ms: Date.now() - requestStart
      });
      
      return res.end();
    }

    // ★★★ STREAM FROM GROK ★★★
    console.log('🤖 Streaming from Grok...');

    // Build tips context
    const tipsContext = relevantTips.length > 0 ? `
--- EXPERT KNOWLEDGE BASE (FROM LOCAL MALAYSIAN SOURCES) ---
${relevantTips.map(t => `- [${t.type}] ${t.topic}: ${t.advice}`).join('\n')}
` : '';

    // Construct augmented prompt
    const augmentedPrompt = [
      `Here is my latest message: "${message}"`,
      userContext && '--- MY PROFILE CONTEXT ---\n' + userContext,
      dosmContext && '--- MY LOCATION\'S STATISTICAL CONTEXT (DOSM) ---\n' + dosmContext,
      tipsContext,
      transactionContext && '--- MY RECENT TRANSACTIONS ---\n' + transactionContext
    ].filter(Boolean).join('\n\n');

    // Build conversation history
    const recentHistory = (history || []).slice(-8);
    const messages = [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      ...recentHistory.map(msg => ({ 
        role: msg.role === 'model' ? 'assistant' : 'user', 
        content: msg.parts.map(p => p.text).join('') 
      })),
      { role: 'user', content: augmentedPrompt }
    ];

    // Stream from Grok with optimized params
    const stream = await openAI.chat.completions.create({
      model: "x-ai/grok-4.1-fast",
      messages: messages,
      temperature: 0.5, // NEW: Lower for faster, more deterministic responses
      max_tokens: 100, // NEW: Cap lower to reduce total time (under 100 words goal)
      stream: true
    });

    // Send tokens as they arrive
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      
      if (content) {
        sendEvent('token', { 
          content: content,
          done: false
        });
      }
    }

    // Send completion event
    sendEvent('done', { 
      source: 'grok',
      response_time_ms: Date.now() - requestStart
    });

    res.end();

    // NEW: Heartbeat to keep alive (every 15s, if long-running)
    const heartbeat = setInterval(() => {
      sendEvent('heartbeat', { status: 'alive' });
    }, 15000);
    res.on('close', () => clearInterval(heartbeat));

  } catch (error) {
    console.error('💥 Streaming Error:', error.message);
    
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed 🐻💤' })}\n\n`);
    res.end();
  }
});

// --- LEGACY NON-STREAMING ENDPOINT (Keep for compatibility) ---
app.post('/chat', async (req, res) => {
  const requestStart = Date.now();
  
  try {
    const { message, history, transactions, userProfile } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // ★★★ ULTRA-FAST PARALLEL PROCESSING ★★★
    const [intentResult, relevantTips, userContext, dosmContext, transactionContext] = await Promise.allSettled([
      aiClient.post(`${AI_BACKEND_URL}/predict-intent`, { message })
        .then(response => ({
          intentPrediction: response.data.prediction,
          aiBackendOnline: true
        }))
        .catch(err => {
          return { intentPrediction: null, aiBackendOnline: false };
        }),
      Promise.resolve(getRelevantTips(message)),
      Promise.resolve(userProfile ? `
Here is my complete user profile for context:
- Name: ${userProfile.name}
- Age: ${userProfile.age}
- State: ${userProfile.state}
- Occupation: ${userProfile.occupation}
- Monthly Income: RM ${userProfile.monthlyIncome}
- Main Financial Goal: ${userProfile.financialGoals}
- Biggest Money Challenge: ${userProfile.financialSituation}
- My Spending Style: ${userProfile.riskTolerance}
- My Tracking Method (Before this app): ${userProfile.cashFlow}
- Current Allocated Savings Target (Leftover from Budget): RM ${userProfile.allocatedSavingsTarget || 0}
`.trim() : ''),
      (async () => {
        const stateData = userProfile?.state ? 
          (dosmRAGData[userProfile.state] || dosmRAGData['Nasional']) : 
          dosmRAGData['Nasional'] || '';
        return stateData ? `
Here is relevant statistical data for my location (from DOSM):
${stateData}
`.trim() : '';
      })(),
      Promise.resolve(transactions && transactions.length > 0 ? `
And here is my recent transaction data for context:
${JSON.stringify(transactions, null, 2)}
`.trim() : '')
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

    const { intentPrediction, aiBackendOnline } = intentResult || {};

    if (intentPrediction && 
        intentPrediction.intent !== 'COMPLEX_ADVICE' && 
        localResponses[intentPrediction.intent]) {
      
      return res.json({ 
        message: localResponses[intentPrediction.intent],
        source: 'local',
        intent: intentPrediction.intent,
        confidence: intentPrediction.confidence,
        ai_backend_status: aiBackendOnline ? 'online' : 'offline',
        response_time_ms: Date.now() - requestStart
      });
    }

    const tipsContext = relevantTips.length > 0 ? `
--- EXPERT KNOWLEDGE BASE (FROM LOCAL MALAYSIAN SOURCES) ---
${relevantTips.map(t => `- [${t.type}] ${t.topic}: ${t.advice}`).join('\n')}
` : '';

    const augmentedPrompt = [
      `Here is my latest message: "${message}"`,
      userContext && '--- MY PROFILE CONTEXT ---\n' + userContext,
      dosmContext && '--- MY LOCATION\'S STATISTICAL CONTEXT (DOSM) ---\n' + dosmContext,
      tipsContext,
      transactionContext && '--- MY RECENT TRANSACTIONS ---\n' + transactionContext
    ].filter(Boolean).join('\n\n');

    const recentHistory = (history || []).slice(-8);
    const messages = [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      ...recentHistory.map(msg => ({ 
        role: msg.role === 'model' ? 'assistant' : 'user', 
        content: msg.parts.map(p => p.text).join('') 
      })),
      { role: 'user', content: augmentedPrompt }
    ];

    const completion = await openAI.chat.completions.create({
      model: "x-ai/grok-4-fast",
      messages: messages,
      temperature: 0.5, // NEW: Optimized
      max_tokens: 100, // NEW: Capped
      stream: false
    });

    const grokResponse = completion.choices[0].message.content;

    res.json({ 
      message: grokResponse, 
      source: 'grok',
      ai_backend_status: aiBackendOnline ? 'online' : 'offline',
      response_time_ms: Date.now() - requestStart
    });

  } catch (error) {
    console.error('💥 Server Error:', error.message);
    res.status(500).json({ 
      error: 'Beruang is taking a nap. Try again in a moment! 🐻💤',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', async (req, res) => {
  let aiBackendStatus = 'offline';
  
  try {
    await axios.get(`${AI_BACKEND_URL}/health`, { timeout: 2000 });
    aiBackendStatus = 'online';
  } catch (err) {
    aiBackendStatus = 'offline';
  }
  
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    services: {
      orchestrator: 'online',
      ai_backend: aiBackendStatus,
      grok: !!process.env.OPENROUTER_API_KEY ? 'configured' : 'missing_api_key',
      rag_data: Object.keys(dosmRAGData).length > 0 ? 'loaded' : 'missing',
      expert_tips: expertTips.length > 0 ? `loaded (${expertTips.length})` : 'missing',
      tips_indexed: tipsIndex.size > 0 ? `${tipsIndex.size} keywords` : 'not indexed',
      streaming: 'enabled'
    }
  });
});

// --- WARMUP CONNECTIONS ON STARTUP ---
async function warmupConnections() {
  console.log('🔥 Warming up connections...');
  
  try {
    await aiClient.post(`${AI_BACKEND_URL}/predict-intent`, { message: 'hello' });
    console.log('   ✅ Local AI warmed up');
  } catch (err) {
    console.log('   ⚠️  Local AI not available');
  }
  
  try {
    await openAI.chat.completions.create({
      model: "x-ai/grok-4-fast",
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5
    });
    console.log('   ✅ Grok API warmed up');
  } catch (err) {
    console.log('   ⚠️  Grok API warmup failed');
  }
}

// --- START SERVER ---
app.listen(PORT, async () => {
  console.log('================================================');
  console.log('🐻 BERUANG ORCHESTRATOR (WITH STREAMING!)');
  console.log('================================================');
  console.log(`✅ Running on http://localhost:${PORT}`);
  console.log(`   - POST /chat/stream (STREAMING - USE THIS!) 🔥`);
  console.log(`   - POST /chat (Legacy non-streaming)`);
  console.log(`   - GET  /health (System status)`);
  console.log('');
  console.log('Speed Optimizations:');
  console.log(`   ⚡ Real-time streaming responses`);
  console.log(`   ⚡ Pre-indexed expert tips`);
  console.log(`   ⚡ HTTP Keep-Alive connections`);
  console.log(`   ⚡ 5-way parallel processing`);
  console.log(`   ⚡ Connection warmup`);
  console.log('');
  console.log('Services:');
  console.log(`   - AI Backend: ${AI_BACKEND_URL}`);
  console.log(`   - Grok API: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '⚠️  Missing'}`);
  console.log(`   - RAG Data (DOSM): ${Object.keys(dosmRAGData).length > 0 ? '✅ Loaded' : '⚠️  Missing'}`);
  console.log(`   - RAG Data (Expert): ${expertTips.length > 0 ? `✅ ${expertTips.length} tips` : '⚠️  Missing'}`);
  console.log(`   - Tips Index: ${tipsIndex.size > 0 ? `✅ ${tipsIndex.size} keywords` : '⚠️  Not built'}`);
  console.log('================================================');
  
  await warmupConnections();
  console.log('🚀 Server ready with STREAMING support!\n');
});