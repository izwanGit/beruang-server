// server.js (Main Orchestrator)
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');

// --- LOAD LOCAL RESPONSES (Free/Fast) ---
const localResponses = JSON.parse(fs.readFileSync('responses.json', 'utf8'));

// --- LOAD RAG DATA ---
let dosmRAGData = {};
try {
  const data = fs.readFileSync('dosm_data.json', 'utf8');
  dosmRAGData = JSON.parse(data);
  console.log('✅ Successfully loaded DOSM RAG data.');
} catch (error) {
  console.log('⚠️  Note: dosm_data.json not found (RAG disabled for now).');
}

const app = express();
app.use(express.json());
app.use(cors());
const PORT = 3000;

// --- GROK SETUP ---
const openAI = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// --- PERSONA ---
const SYSTEM_INSTRUCTION = `
You are Beruang Assistant, a laid-back finance pal in the Beruang app. "Beruang" means bear in Malay—giving cozy, no-nonsense vibes to help with money stuff.

Mission: Assist young adults (18-30) using 50/30/20: 50% Needs, 30% Wants, 20% Savings/Debt. Provide advice only when directly relevant or requested—prioritize straight answers.

RAG Use: Leverage history and transactions for context-aware replies. For queries like car suggestions, use known finances to inform without lecturing on spending.

Style:
- Direct & Short: Under 80 words. Answer the question first, then extras if needed.
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
const AI_TIMEOUT = 3000; // 3 seconds max for local AI

// --- CHAT ENDPOINT ---
app.post('/chat', async (req, res) => {
  try {
    const { message, history, transactions, userProfile } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // ★★★ STEP 1: Query Local AI with Timeout ★★★
    let intentPrediction = null;
    let aiBackendOnline = true;

    try {
      const aiResponse = await axios.post(
        `${AI_BACKEND_URL}/predict-intent`, 
        { message },
        { timeout: AI_TIMEOUT }
      );
      
      intentPrediction = aiResponse.data.prediction;
      
      console.log(`🧠 Local AI: ${intentPrediction.intent} (${intentPrediction.confidence})`);
      
      if (intentPrediction.ood_analysis?.is_ood) {
        console.log(`   └─ OOD Reasons: ${intentPrediction.ood_analysis.reasons.join(', ')}`);
      }
      
    } catch (err) {
      aiBackendOnline = false;
      if (err.code === 'ECONNREFUSED') {
        console.error('⚠️  Local AI Backend OFFLINE. Install: npm run train:intent');
      } else if (err.code === 'ETIMEDOUT') {
        console.error('⚠️  Local AI Backend TIMEOUT. Check server health.');
      } else {
        console.error('⚠️  Local AI Error:', err.message);
      }
      console.log('   → Routing to Grok as fallback');
    }

    // ★★★ STEP 2: Check for Local Response ★★★
    if (intentPrediction && 
        intentPrediction.intent !== 'COMPLEX_ADVICE' && 
        localResponses[intentPrediction.intent]) {
      
      console.log(`⚡ Serving Local Response: ${intentPrediction.intent} (FREE)`);
      
      return res.json({ 
        message: localResponses[intentPrediction.intent],
        source: 'local',
        intent: intentPrediction.intent,
        confidence: intentPrediction.confidence,
        ai_backend_status: aiBackendOnline ? 'online' : 'offline'
      });
    }

    // ★★★ STEP 3: Fallback to Grok (With Full RAG Context) ★★★
    console.log('🤖 Routing to Grok (Complex/Unsure)...');

    // Build comprehensive context
    const userContext = userProfile ? `
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
`.trim() : '';

    const stateData = userProfile?.state ? 
      (dosmRAGData[userProfile.state] || dosmRAGData['Nasional']) : 
      dosmRAGData['Nasional'] || '';
      
    const dosmContext = stateData ? `
Here is relevant statistical data for my location (from DOSM):
${stateData}
`.trim() : '';

    const transactionContext = transactions && transactions.length > 0 ? `
And here is my recent transaction data for context:
${JSON.stringify(transactions, null, 2)}
`.trim() : '';

    // Construct augmented prompt
    const augmentedPrompt = [
      `Here is my latest message: "${message}"`,
      userContext && '--- MY PROFILE CONTEXT ---\n' + userContext,
      dosmContext && '--- MY LOCATION\'S STATISTICAL CONTEXT (DOSM) ---\n' + dosmContext,
      transactionContext && '--- MY RECENT TRANSACTIONS ---\n' + transactionContext
    ].filter(Boolean).join('\n\n');

    // Build conversation history
    const messages = [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      ...(history || []).map(msg => ({ 
        role: msg.role === 'model' ? 'assistant' : 'user', 
        content: msg.parts.map(p => p.text).join('') 
      })),
      { role: 'user', content: augmentedPrompt }
    ];

    // Call Grok
    const completion = await openAI.chat.completions.create({
      model: "x-ai/grok-4-fast",
      messages: messages,
      temperature: 0.7,
      max_tokens: 150 // Keep responses concise
    });

    const grokResponse = completion.choices[0].message.content;

    res.json({ 
      message: grokResponse, 
      source: 'grok',
      reason: intentPrediction?.intent === 'COMPLEX_ADVICE' ? 'complex_query' : 'local_ai_unavailable',
      original_intent: intentPrediction?.original_intent,
      ai_backend_status: aiBackendOnline ? 'online' : 'offline'
    });

  } catch (error) {
    console.error('💥 Server Error:', error.message);
    
    // Friendly error response
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
      rag_data: Object.keys(dosmRAGData).length > 0 ? 'loaded' : 'missing'
    }
  });
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log('================================================');
  console.log('🐻 BERUANG ORCHESTRATOR SERVER');
  console.log('================================================');
  console.log(`✅ Running on http://localhost:${PORT}`);
  console.log(`   - POST /chat (Main endpoint)`);
  console.log(`   - GET  /health (System status)`);
  console.log('');
  console.log('Services:');
  console.log(`   - AI Backend: ${AI_BACKEND_URL}`);
  console.log(`   - Grok API: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '⚠️  Missing'}`);
  console.log(`   - RAG Data: ${Object.keys(dosmRAGData).length > 0 ? '✅ Loaded' : '⚠️  Missing'}`);
  console.log('================================================');
});