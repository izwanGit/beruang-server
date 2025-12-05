// server.js (TRUE UNIFIED VERSION: ORCHESTRATOR + FULL AI BACKEND)
const util = require('util');
// Fix for Node v23+ compatibility (from your backend code)
util.isNullOrUndefined = util.isNullOrUndefined || ((value) => value === null || value === undefined);

const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Still needed for health checks or external calls
require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs-extra'); // Using fs-extra as requested
const path = require('path');
const compression = require('compression');
const tf = require('@tensorflow/tfjs-node'); // THE BRAIN IS HERE

// ==========================================
// 🧠 1. AI BRAIN CONFIGURATION & VARS
// ==========================================
const TRANS_MODEL_PATH = 'file://' + path.resolve('./model_transaction/model.json');
const TRANS_METADATA_PATH = path.resolve('./model_transaction/metadata.json');
const INTENT_MODEL_PATH = 'file://' + path.resolve('./model_intent/model.json');
const INTENT_METADATA_PATH = path.resolve('./model_intent/metadata.json');

let transModel, transMetadata;
let intentModel, intentMetadata;

// ==========================================
// 🛠️ 2. AI HELPER FUNCTIONS (FROM AI BACKEND)
// ==========================================

// --- Levenshtein Distance (Fuzzy Matching) ---
function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// --- Auto-Correct Logic ---
function autoCorrect(tokens, wordIndex) {
  const validWords = Object.keys(wordIndex);
  return tokens.map(word => {
    if (wordIndex[word]) return word;
    if (word.length < 4) return word; 

    let bestMatch = word;
    let minDist = Infinity;
    const candidates = validWords.filter(w => w.startsWith(word[0]));

    for (const candidate of candidates) {
      const dist = levenshtein(word, candidate);
      const threshold = word.length > 6 ? 2 : 1;
      
      if (dist <= threshold && dist < minDist) {
        minDist = dist;
        bestMatch = candidate;
      }
    }
    return bestMatch;
  });
}

// --- Text Preprocessing ---
function preprocess(text, metadata) {
  const { wordIndex, maxLen, maxVocabSize } = metadata;
  
  const cleanText = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  let tokens = cleanText.split(' ').filter(t => t.trim() !== '');
  
  // Apply Auto-Correct
  const correctedTokens = autoCorrect(tokens, wordIndex);
  
  // Convert to Sequence
  const sequence = correctedTokens.map(word => {
    const index = wordIndex[word];
    return (index && index < maxVocabSize) ? index : 1; // 1 is <UNK>
  });

  // Pad
  if (sequence.length > maxLen) {
    return sequence.slice(0, maxLen);
  }
  const pad = new Array(maxLen - sequence.length).fill(0);
  return [...pad, ...sequence];
}

// --- Multi-Layer OOD Detection System ---
function detectOOD(message, sequence, predictions, metadata) {
  const reasons = [];
  
  // Layer 1: Input Quality Check
  const validTokens = sequence.filter(t => t > 1).length; // Non-padding, non-UNK
  if (validTokens === 0) {
    reasons.push('No recognized words');
    return { isOOD: true, reasons, confidence: 0 };
  }
  
  const unkRatio = sequence.filter(t => t === 1).length / sequence.filter(t => t > 0).length;
  if (unkRatio > 0.6) {
    reasons.push(`${(unkRatio * 100).toFixed(0)}% unknown words`);
  }
  
  // Layer 2: Length Check
  const tokens = message.toLowerCase().split(' ').filter(t => t.trim() !== '');
  if (tokens.length > 15) {
    reasons.push('Query too long (complex)');
  }
  
  // Layer 3: Prediction Confidence Analysis
  const predData = predictions.dataSync();
  const maxConf = Math.max(...predData);
  const maxIdx = predData.indexOf(maxConf);
  
  // Get predicted intent name
  const intentIndexReverse = metadata.intentIndex;
  const predictedIntent = intentIndexReverse[String(maxIdx)] || intentIndexReverse[maxIdx];
  
  // Layer 4: Per-Class Threshold Check
  const thresholds = metadata.confidenceThresholds || {};
  const classThreshold = thresholds[predictedIntent] || metadata.globalThreshold || 0.80;
  
  if (maxConf < classThreshold) {
    reasons.push(`Confidence ${(maxConf * 100).toFixed(1)}% < threshold ${(classThreshold * 100).toFixed(1)}%`);
  }
  
  // Layer 5: Entropy Check (measures uncertainty)
  const entropy = -predData.reduce((sum, p) => {
    return sum + (p > 0 ? p * Math.log(p) : 0);
  }, 0);
  const maxEntropy = Math.log(predData.length);
  const normalizedEntropy = entropy / maxEntropy;
  
  if (normalizedEntropy > 0.7) {
    reasons.push(`High uncertainty (entropy: ${normalizedEntropy.toFixed(2)})`);
  }
  
  // Layer 6: Second-Best Gap Check
  const sorted = [...predData].sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];
  
  if (gap < 0.15) {
    reasons.push(`Low confidence gap (${(gap * 100).toFixed(1)}%)`);
  }
  
  // Decision: Is it OOD?
  const isOOD = reasons.length >= 2 || maxConf < classThreshold;
  
  return { 
    isOOD, 
    reasons, 
    confidence: maxConf,
    entropy: normalizedEntropy,
    gap: gap,
    predictedIntent: predictedIntent
  };
}

// ==========================================
// 📂 3. DATA LOADING (RAG & LOCAL)
// ==========================================

// --- LOAD LOCAL RESPONSES ---
let localResponses = {};
try {
  localResponses = JSON.parse(fs.readFileSync('responses.json', 'utf8'));
} catch (e) { 
  console.log('⚠️ responses.json missing'); 
}

// --- LOAD DOSM DATA ---
let dosmRAGData = {};
try {
  const data = fs.readFileSync('dosm_data.json', 'utf8');
  dosmRAGData = JSON.parse(data);
  console.log('✅ Successfully loaded DOSM RAG data.');
} catch (error) {
  console.log('⚠️  Note: dosm_data.json not found (DOSM RAG disabled for now).');
}

// --- LOAD EXPERT TIPS ---
let expertTips = [];
try {
  const tipsData = fs.readFileSync('expert_tips.json', 'utf8');
  expertTips = JSON.parse(tipsData);
  console.log(`✅ Loaded ${expertTips.length} expert financial tips.`);
} catch (error) {
  console.log('⚠️  expert_tips.json not found. Creating empty list.');
  expertTips = [];
}

// --- PRE-INDEX EXPERT TIPS ---
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

// ==========================================
// 🚀 4. SERVER & OPENAI CONFIG
// ==========================================
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
  httpAgent: new (require('https').Agent)({ keepAlive: true }),
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:3000', // Replace with your app's URL
    'X-Title': 'Beruang App' // Or your app name
  }
});

// --- PERSONA ---
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

// --- HELPER: GET RELEVANT TIPS ---
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

// ==========================================
// 🎮 5. INTERNAL AI LOGIC (No Networking)
// ==========================================

// --- Internal Transaction Predictor ---
async function predictTransactionInternal(description) {
  if (!transModel || !transMetadata) throw new Error('Transaction Model not loaded');
  if (!description) throw new Error('No description provided');

  const { categoryIndex, subcategoryIndex, maxLen } = transMetadata;
  const sequence = preprocess(description, transMetadata);
  
  // Fallback Check
  const validTokenCount = sequence.filter(t => t > 1).length;
  if (validTokenCount === 0) {
    return {
      category: "WANTS",
      subcategory: "Others",
      confidence: { category: "0.00%", subcategory: "0.00%" },
      note: "Fallback triggered"
    };
  }

  const inputTensor = tf.tensor2d([sequence], [1, maxLen], 'int32');
  const predictions = transModel.predict(inputTensor);
  
  const catPred = Array.isArray(predictions) ? predictions[0] : predictions;
  const subPred = Array.isArray(predictions) ? predictions[1] : null;

  const catData = catPred.dataSync();
  const subData = subPred.dataSync();

  const catIdx = catData.indexOf(Math.max(...catData));
  const subIdx = subData.indexOf(Math.max(...subData));

  const category = categoryIndex[String(catIdx)] || categoryIndex[catIdx] || 'Unknown';
  const subcategory = subcategoryIndex[String(subIdx)] || subcategoryIndex[subIdx] || 'Unknown';
  
  const catConf = (catData[catIdx] * 100).toFixed(2);
  const subConf = (subData[subIdx] * 100).toFixed(2);

  inputTensor.dispose();
  catPred.dispose();
  if(subPred) subPred.dispose();

  return {
    category: category.toUpperCase(),
    subcategory: subcategory,
    confidence: { category: `${catConf}%`, subcategory: `${subConf}%` }
  };
}

// --- Internal Intent Predictor (With Guardrails) ---
async function predictIntentInternal(message) {
  if (!intentModel || !intentMetadata) return null;
  if (!message || !message.trim()) return null;

  // ★★★ SAFETY LAYER 1: KEYWORD GUARDRAILS (Pre-Model Filter) ★★★
  const RED_FLAGS = [
    'invest', 'crypto', 'stock', 'debt', 'loan', 'buy', 'sell', 
    'salary', 'finance', 'money', 'budget', 'save for', 'afford',
    'survive', 'bank', 'insurance', 'tax', 'profit', 'loss', 'worth',
    'bitcoin', 'gold', 'property', 'car', 'house', 'wedding',
    'unrealistic', 'opinion', 'thoughts', 'compare', 'pros and cons'
  ];
  
  const COMPLEX_STARTERS = ['why', 'how', 'what if', 'should i', 'can i', 'explain', 'tell me about'];
  const lowerMsg = message.toLowerCase();
  const hasComplexStarter = COMPLEX_STARTERS.some(s => lowerMsg.startsWith(s));
  const hasRedFlag = RED_FLAGS.some(flag => lowerMsg.includes(flag));

  if ((hasComplexStarter && hasRedFlag) || (hasRedFlag && lowerMsg.split(' ').length > 5)) {
    console.log(`[Intent] 🛡️ PRE-FILTER: Red flag combo detected in "${message}". → GROK`);
    return {
      intent: 'COMPLEX_ADVICE',
      confidence: '100.00%',
      reason: 'Pre-filter: Complex query detected'
    };
  }

  // ★★★ SAFETY LAYER 2: MODEL PREDICTION + OOD DETECTION ★★★
  const { maxLen } = intentMetadata;
  const sequence = preprocess(message, intentMetadata);

  const inputTensor = tf.tensor2d([sequence], [1, maxLen], 'int32');
  const prediction = intentModel.predict(inputTensor);
  
  // Analyze prediction with OOD detector
  const oodAnalysis = detectOOD(message, sequence, prediction, intentMetadata);
  
  const predData = prediction.dataSync();
  const maxIdx = predData.indexOf(Math.max(...predData));
  const { intentIndex } = intentMetadata;
  const predictedIntent = intentIndex[String(maxIdx)] || intentIndex[maxIdx] || 'UNKNOWN';
  const confidence = (predData[maxIdx] * 100).toFixed(2);

  inputTensor.dispose();
  prediction.dispose();

  // ★★★ DECISION LOGIC ★★★
  let finalIntent = predictedIntent;
  let logMsg = `[Intent] "${message}" -> ${predictedIntent} (${confidence}%)`;

  if (oodAnalysis.isOOD) {
    finalIntent = 'COMPLEX_ADVICE';
    logMsg += ` -> 🚫 OOD DETECTED: ${oodAnalysis.reasons.join(', ')} → GROK`;
  } else {
    logMsg += ` -> ✅ LOCAL REPLY (passed OOD checks)`;
  }
  
  console.log(logMsg);

  return {
    intent: finalIntent,
    original_intent: predictedIntent,
    confidence: `${confidence}%`,
    ood_analysis: oodAnalysis
  };
}

// ==========================================
// 🔌 6. API ENDPOINTS
// ==========================================

// --- TRANSACTION PREDICTION ENDPOINT ---
// --- TRANSACTION PREDICTION ENDPOINT ---
app.post('/predict-transaction', async (req, res) => {
  try {
    const { description } = req.body;
    const prediction = await predictTransactionInternal(description);
    
    // ✅ NEW LOGGING LINE
    console.log(`[Transaction] "${description}" -> ${prediction.category} (${prediction.confidence.category}) / ${prediction.subcategory} (${prediction.confidence.subcategory})`);
    
    res.json({
      input: description,
      prediction: prediction
    });
  } catch (error) {
    console.error('Trans Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- STREAMING CHAT ENDPOINT (THE BIG ONE) ---
app.post('/chat/stream', async (req, res) => {
  const requestStart = Date.now();
  
  try {
    const { message, history, transactions, userProfile } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked'); 
    res.flushHeaders(); 

    // Helper to send SSE events
    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.flush(); 
    };

    sendEvent('thinking', { message: 'Processing your request...' });

    // ★★★ ULTRA-FAST PARALLEL PROCESSING ★★★
    // We now call internal functions instead of Axios for the intent
    const [intentResult, relevantTips, userContext, dosmContext, transactionContext] = await Promise.allSettled([
      // 1. Local AI prediction (Direct Call)
      predictIntentInternal(message),

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
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null)); 

    const intentPrediction = intentResult; // Now it's the direct object

    // ★★★ CHECK FOR LOCAL RESPONSE ★★★
    if (intentPrediction && 
        intentPrediction.intent !== 'COMPLEX_ADVICE' && 
        localResponses[intentPrediction.intent]) {
      
      console.log(`⚡ Serving Local Response: ${intentPrediction.intent}`);
      
      // Simulate typing
      const localMsg = localResponses[intentPrediction.intent];
      const words = localMsg.split(' ');
      
      for (let i = 0; i < words.length; i++) {
        sendEvent('token', { 
          content: words[i] + ' ',
          done: false
        });
        await new Promise(resolve => setTimeout(resolve, 30)); 
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

    const stream = await openAI.chat.completions.create({
      model: "x-ai/grok-4.1-fast",
      messages: messages,
      temperature: 0.5,
      max_tokens: 150, 
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        sendEvent('token', { 
          content: content,
          done: false
        });
      }
    }

    sendEvent('done', { 
      source: 'grok',
      response_time_ms: Date.now() - requestStart
    });

    res.end();

    const heartbeat = setInterval(() => {
      sendEvent('heartbeat', { status: 'alive' });
    }, 15000);
    res.on('close', () => clearInterval(heartbeat));

  } catch (error) {
    console.error('💥 Streaming Error:', error);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed 🐻💤' })}\n\n`);
    res.end();
  }
});

// --- LEGACY CHAT ENDPOINT ---
app.post('/chat', async (req, res) => {
  res.status(200).json({ message: "Please use /chat/stream for best experience." });
});

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    mode: 'UNIFIED_SERVER',
    models: {
      transaction: !!transModel ? 'loaded' : 'missing',
      intent: !!intentModel ? 'loaded' : 'missing'
    },
    grok: !!process.env.OPENROUTER_API_KEY ? 'configured' : 'missing_api_key',
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 🚀 7. STARTUP & WARMUP (PRESERVED FULL LOGIC)
// ==========================================

// 1. Model Loading
async function loadModels() {
  console.log('------------------------------------------------');
  console.log('🤖 INITIALIZING UNIFIED BERUANG SERVER...');
  
  // Load Transaction Model
  try {
    if (fs.existsSync(TRANS_METADATA_PATH)) {
      transModel = await tf.loadLayersModel(TRANS_MODEL_PATH);
      transMetadata = await fs.readJson(TRANS_METADATA_PATH);
      console.log('✅ Transaction Model Loaded (Ready to categorize expenses)');
    } else {
      console.warn('⚠ Transaction Model MISSING. Run: npm run train:transaction');
    }
  } catch (error) {
    console.error('❌ Transaction Model Load Error:', error.message);
  }

  // Load Intent Model
  try {
    if (fs.existsSync(INTENT_METADATA_PATH)) {
      intentModel = await tf.loadLayersModel(INTENT_MODEL_PATH);
      intentMetadata = await fs.readJson(INTENT_METADATA_PATH);
      console.log('✅ Intent Model Loaded (Ready to chat)');
      console.log(`   - Loaded ${Object.keys(intentMetadata.intentIndex).length} intents`);
      console.log(`   - Global threshold: ${(intentMetadata.globalThreshold * 100).toFixed(0)}%`);
    } else {
      console.warn('⚠ Intent Model MISSING. Run: npm run gen:intent && npm run train:intent');
    }
  } catch (error) {
    console.error('❌ Intent Model Load Error:', error.message);
  }
}

// 2. Connection Warmup (Modified for Internal calls)
async function warmupConnections() {
  console.log('🔥 Warming up connections...');
  
  // Warmup Local AI
  try {
    // We simulate a call to the internal function instead of axios
    if (intentModel) {
      console.log('   ...Pre-heating TensorFlow...');
      await predictIntentInternal('hello'); 
      console.log('   ✅ Local AI warmed up');
    } else {
      console.log('   ⚠️  Local AI skipped (Model not loaded)');
    }
  } catch (err) {
    console.log('   ⚠️  Local AI warmup failed:', err.message);
  }
  
  // Warmup Grok
  try {
    await openAI.chat.completions.create({
      model: "x-ai/grok-4.1-fast",
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5
    });
    console.log('   ✅ Grok API warmed up');
  } catch (err) {
    console.log('   ⚠️  Grok API warmup failed:', err);
  }
}

// 3. Start Server
async function startServer() {
  await loadModels();
  
  app.listen(PORT, async () => {
    console.log('================================================');
    console.log('🐻 BERUANG ORCHESTRATOR (WITH STREAMING!)');
    console.log('================================================');
    console.log(`✅ Running on http://localhost:${PORT}`);
    console.log(`   - POST /chat/stream (STREAMING - USE THIS!) 🔥`);
    console.log(`   - POST /chat (Legacy non-streaming)`);
    console.log(`   - POST /predict-transaction (NEW! Transaction AI) 🤖`);
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
    console.log(`   - AI Backend: INTEGRATED (Internal TensorFlow)`);
    console.log(`   - Grok API: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '⚠️  Missing'}`);
    console.log(`   - RAG Data (DOSM): ${Object.keys(dosmRAGData).length > 0 ? '✅ Loaded' : '⚠️  Missing'}`);
    console.log(`   - RAG Data (Expert): ${expertTips.length > 0 ? `✅ ${expertTips.length} tips` : '⚠️  Missing'}`);
    console.log(`   - Tips Index: ${tipsIndex.size > 0 ? `✅ ${tipsIndex.size} keywords` : '⚠️  Not built'}`);
    console.log('================================================');
    
    await warmupConnections();
    console.log('🚀 Server ready with STREAMING support!\n');
  });
}

// EXECUTE START
startServer();