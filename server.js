// server.js (TRUE UNIFIED VERSION: ORCHESTRATOR + FULL AI BACKEND)
const util = require('util');
// Fix for Node v23+ compatibility
util.isNullOrUndefined = util.isNullOrUndefined || ((value) => value === null || value === undefined);

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
const compression = require('compression');
const tf = require('@tensorflow/tfjs-node');
const { pipeline } = require('@xenova/transformers');
const multer = require('multer');
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// ==========================================
// 🧠 1. AI BRAIN CONFIGURATION & VARS
// ==========================================
const TRANS_MODEL_PATH = 'file://' + path.resolve('./model_transaction/model.json');
const TRANS_METADATA_PATH = path.resolve('./model_transaction/metadata.json');
const INTENT_MODEL_PATH = 'file://' + path.resolve('./model_intent/model.json');
const INTENT_METADATA_PATH = path.resolve('./model_intent/metadata.json');

let transModel, transMetadata;
let intentModel, intentMetadata;
let intentExtractor;

// ==========================================
// 🛠️ 2. AI HELPER FUNCTIONS 
// ==========================================

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

function preprocess(text, metadata) {
  const { wordIndex, maxLen, maxVocabSize, vocabSize } = metadata;
  const vocabLimit = maxVocabSize || vocabSize || 10000;

  const cleanText = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let tokens = cleanText.split(' ').filter(t => t.trim() !== '');
  const correctedTokens = autoCorrect(tokens, wordIndex);

  const sequence = correctedTokens.map(word => {
    const index = wordIndex[word];
    return (index !== undefined && index < vocabLimit) ? index : 1;
  }).slice(0, maxLen);

  if (sequence.length >= maxLen) {
    return sequence.slice(0, maxLen);
  }
  const pad = new Array(maxLen - sequence.length).fill(0);
  return [...pad, ...sequence];
}

function detectOOD(message, sequence, predictions, metadata) {
  const reasons = [];

  if (sequence) {
    const validTokens = sequence.filter(t => t > 1).length;
    if (validTokens === 0) {
      reasons.push('No recognized words');
      return { isOOD: true, reasons, confidence: 0 };
    }

    const unkRatio = sequence.filter(t => t === 1).length / sequence.filter(t => t > 0).length;
    if (unkRatio > 0.6) {
      reasons.push(`${(unkRatio * 100).toFixed(0)}% unknown words`);
    }
  }

  const tokens = message.toLowerCase().split(' ').filter(t => t.trim() !== '');
  if (tokens.length > 20) {
    reasons.push('Query too long (complex)');
  }

  const predData = predictions.dataSync();
  const maxConf = Math.max(...predData);
  const maxIdx = predData.indexOf(maxConf);

  const labelMap = metadata.labelMap || metadata.intentIndex;
  const predictedIntent = labelMap[maxIdx] || "UNKNOWN";

  const thresholds = metadata.confidenceThresholds || {};
  const classThreshold = thresholds[predictedIntent] || metadata.globalThreshold || 0.70;

  if (maxConf < classThreshold) {
    reasons.push(`Confidence ${(maxConf * 100).toFixed(1)}% < threshold ${(classThreshold * 100).toFixed(1)}%`);
  }

  const entropy = -predData.reduce((sum, p) => {
    return sum + (p > 0 ? p * Math.log(p) : 0);
  }, 0);
  const maxEntropy = Math.log(predData.length);
  const normalizedEntropy = entropy / maxEntropy;

  if (normalizedEntropy > 0.6) {
    reasons.push(`High uncertainty (entropy: ${normalizedEntropy.toFixed(2)})`);
  }

  const sorted = [...predData].sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];

  if (gap < 0.10) {
    reasons.push(`Low confidence gap (${(gap * 100).toFixed(1)}%)`);
  }

  const isOOD = reasons.length >= 1 || maxConf < classThreshold;

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
// 📚 3. DATA LOADING (MANUAL & RAG)
// ==========================================

// --- LOAD LOCAL RESPONSES & BUILD MANUAL ---
let localResponses = {};
let appManualContext = ""; // <--- NEW: Text manual for Grok

try {
  const rawData = JSON.parse(fs.readFileSync('responses.json', 'utf8'));

  if (rawData.intents && Array.isArray(rawData.intents)) {
    // 1. Build Map for Local Serving
    rawData.intents.forEach(intent => {
      localResponses[intent.tag] = intent.responses;
    });

    // 2. Build Text Manual for Grok (Only relevant topics)
    const manualLines = rawData.intents
      .filter(i => i.tag.startsWith('HELP_') || i.tag.startsWith('NAV_') || i.tag.startsWith('DEF_'))
      .map(i => `- Topic: ${i.tag}\n  Info: ${i.responses[0]}`);

    appManualContext = manualLines.join('\n');
    console.log(`✅ Loaded Local Responses & Built App Manual (${manualLines.length} topics).`);

  } else {
    localResponses = rawData;
  }
} catch (e) {
  console.log('⚠️ responses.json missing or invalid:', e.message);
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
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/chat/stream') return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
const PORT = 3000;

const openAI = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  httpAgent: new (require('https').Agent)({ keepAlive: true }),
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'Beruang App'
  }
});

const SYSTEM_INSTRUCTION = `

CRITICAL RULE: Balanced Visualization Etiquette.

1. DIRECT REQUESTS: If user explicitly asks for "Visuals", "Charts", "Summaries", or "Plans", you MUST include the [WIDGET_DATA] block (properly closed with [/WIDGET_DATA]).

2. GENERAL QUERIES: If user asks a general question (e.g., "Can you help me plan my trip?" or "How much did I spend?"), answer briefly in text and ASK: "Want me to generate a visual timeline/breakdown for you?" 
- Do NOT dump the widget immediately unless the user seems to want a quick overview.
- Once they say "Yes" or "Show me", then trigger the widget.

NO DUPLICATION: When using [WIDGET_DATA], keep text intro to 1-2 generic sentences. Let the widget do the talking.

PROACTIVE VIBE: Always look for chances to offer a visual if the data is complex, but don't force it every time. 🐻

VISUAL OUTPUT RULES (STRICT):
1. SPENDING SUMMARY (If user asks "How much I spent"):
{ "t": "s", "d": [{"c": "Food", "a": 200}, {"c": "Trans", "a": 100}], "p": 85 }
(c: Category, a: Amount, p: Percentage of budget used)

2. ITINERARY (If user asks for a trip/project plan):
{ "t": "i", "name": "Trip to KL", "items": [{"d": "Day 1", "v": "50"}, {"d": "Day 2", "v": "100"}] }
(d: Day/Activity, v: Cost)

3. GOAL PROGRESS (If user asks about savings targets):
{ "t": "g", "name": "New Phone", "cur": 500, "tar": 2000 }
(cur: Current, tar: Target)

No markdown formatting inside JSON. Use [WIDGET_DATA] block only.

You are Beruang Assistant, a laid-back finance pal in the Beruang app. "Beruang" means bear in Malay—giving cozy, no-nonsense vibes to help with money stuff.

Mission: Assist young adults (18-30) in personal finance management using the 50/30/20 rule: 50% Needs, 30% Wants, 20% Savings/Debt. Features include budgeting, expense tracking, spending insights via charts, and personalized advice via chatbot. Provide advice only when directly relevant or requested—prioritize straight answers.

RAG Use: Leverage user history, transactions, and app features for context-aware replies. For queries like car suggestions, use known finances to inform without lecturing on spending.

HANDLING RAG DATA (IMPORTANT):

- **APP MANUAL**: For app usage questions (e.g., "Add income", "View budget"), reference these core features: Manual entry for income/expenses via data forms (automatically categorized per 50/30/20); Dashboard for charts/graphs of spendings; Text-based chatbot for advice. No bank links, internet required. If unclear, ask for clarification.

- I will provide "Expert Tips" and context.

- Trust **principles** and **formulas** in tips (e.g., "15% rule", "ASB vs Tabung Haji").

- Cross-reference specific **prices or dates** (e.g., "Myvi price in 2025") with your internal knowledge: "Historically it was RM34k, but nowadays it's closer to..."

- Prioritize the *intent* of advice over exact older numbers.

- **BUDGET DATA**: You will receive a detailed budget breakdown for the CURRENT MONTH and a HISTORICAL SPENDING SUMMARY for previous months. Use this data to provide precise advice on spending patterns, saving trends, and multi-month allocations.

Style:
- Direct & Short: Under 100 words.
- Casual Buddy Tone: Relaxed, positive. Max 1 emoji.
- No Judgment: Facts and suggestions only.

No markdown formatting inside JSON. Use [WIDGET_DATA] only when truly helpful. 🐻
`;

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
// 🧮 5. INTERNAL AI LOGIC
// ==========================================

async function predictTransactionInternal(description) {
  if (!transModel || !transMetadata) throw new Error('Transaction Model not loaded');
  if (!description) throw new Error('No description provided');

  const { categoryIndex, subcategoryIndex, maxLen } = transMetadata;
  const sequence = preprocess(description, transMetadata);

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
  if (subPred) subPred.dispose();

  return {
    category: category.toUpperCase(),
    subcategory: subcategory,
    confidence: { category: `${catConf}%`, subcategory: `${subConf}%` }
  };
}

async function predictIntentInternal(message) {
  if (!intentModel || !intentMetadata || !intentExtractor) return null;
  if (!message || !message.trim()) return null;

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
    console.log(`[Intent] ⚠️ PRE-FILTER: Red flag combo detected in "${message}". → GROK`);
    return {
      intent: 'COMPLEX_ADVICE',
      confidence: '100.00%',
      reason: 'Pre-filter: Complex query detected'
    };
  }

  const output = await intentExtractor(message, { pooling: 'mean', normalize: true });
  const inputTensor = tf.tensor2d([Array.from(output.data)]);

  const prediction = intentModel.predict(inputTensor);
  const oodAnalysis = detectOOD(message, null, prediction, intentMetadata);

  const predData = prediction.dataSync();
  const maxIdx = predData.indexOf(Math.max(...predData));

  const labelMap = intentMetadata.labelMap || intentMetadata.intentIndex;
  const predictedIntent = labelMap[String(maxIdx)] || labelMap[maxIdx] || 'UNKNOWN';
  const confidence = (predData[maxIdx] * 100).toFixed(2);

  inputTensor.dispose();
  prediction.dispose();

  let finalIntent = predictedIntent;
  let logMsg = `[Intent] "${message}" -> ${predictedIntent} (${confidence}%)`;

  if (oodAnalysis.isOOD) {
    finalIntent = 'COMPLEX_ADVICE';
    logMsg += ` → 🚨 OOD DETECTED: ${oodAnalysis.reasons.join(', ')} → GROK`;
  } else {
    logMsg += ` → ✅ LOCAL REPLY (passed OOD checks)`;
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
// 📋 6. HELPER: CALCULATE BUDGET DATA (Fallback)
// ==========================================

function calculateBudgetData(transactions, userProfile) {
  if (!transactions || !userProfile) return null;

  const getMonthKey = (dateStr) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const currentDate = new Date();
  const currentMonthKey = getMonthKey(currentDate.toISOString().split('T')[0]);

  // Income
  const allMonthlyIncomeTrans = transactions.filter(
    (t) => t.type === 'income' && getMonthKey(t.date) === currentMonthKey
  );

  const freshMonthlyIncome = allMonthlyIncomeTrans
    .filter((t) => !t.isCarriedOver)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalMonthlyIncome = allMonthlyIncomeTrans.reduce((sum, t) => sum + t.amount, 0);

  // Expenses
  const monthlyExpenses = transactions.filter(
    (t) => t.type === 'expense' && getMonthKey(t.date) === currentMonthKey
  );

  const needsSpent = monthlyExpenses
    .filter((t) => t.category === 'needs')
    .reduce((sum, t) => sum + t.amount, 0);

  const wantsSpent = monthlyExpenses
    .filter((t) => t.category === 'wants')
    .reduce((sum, t) => sum + t.amount, 0);

  // Savings
  const savingsTarget20 = freshMonthlyIncome * 0.2;

  // Deriving leftoverTarget from transactions instead of profile
  const leftoverTarget = allMonthlyIncomeTrans
    .filter((t) => t.isCarriedOver)
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlySaved20Realized = monthlyExpenses
    .filter((t) => t.category === 'savings' && t.name === 'Monthly Savings')
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlySavedLeftoverRealized = monthlyExpenses
    .filter((t) => t.category === 'savings' && t.name === 'Saving Leftover Balance')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalMonthlySaved = monthlySaved20Realized + monthlySavedLeftoverRealized;

  const totalSavedAllTime = transactions
    .filter((t) => t.type === 'expense' && t.category === 'savings')
    .reduce((sum, t) => sum + t.amount, 0);

  // Budget Targets (50/30/20)
  const needsTarget = freshMonthlyIncome * 0.5;
  const wantsTarget = freshMonthlyIncome * 0.3;

  // Current Wallet Balance
  const totalExpenses = needsSpent + wantsSpent;
  const currentWalletBalance = totalMonthlyIncome - totalExpenses - totalMonthlySaved;

  // Pending Savings
  const pendingLeftoverSave = Math.max(0, leftoverTarget - monthlySavedLeftoverRealized);
  const pending20Save = Math.max(0, savingsTarget20 - monthlySaved20Realized);

  const displayBalance = totalMonthlyIncome - totalExpenses - totalMonthlySaved - pendingLeftoverSave;

  return {
    month: currentMonthKey,
    income: {
      fresh: freshMonthlyIncome,
      total: totalMonthlyIncome
    },
    budget: {
      needs: {
        target: needsTarget,
        spent: needsSpent,
        remaining: Math.max(0, needsTarget - needsSpent),
        percentage: needsTarget > 0 ? (needsSpent / needsTarget) * 100 : 0
      },
      wants: {
        target: wantsTarget,
        spent: wantsSpent,
        remaining: Math.max(0, wantsTarget - wantsSpent),
        percentage: wantsTarget > 0 ? (wantsSpent / wantsTarget) * 100 : 0
      },
      savings20: {
        target: savingsTarget20,
        saved: monthlySaved20Realized,
        pending: pending20Save,
        percentage: savingsTarget20 > 0 ? (monthlySaved20Realized / savingsTarget20) * 100 : 0
      },
      leftover: {
        target: leftoverTarget,
        saved: monthlySavedLeftoverRealized,
        pending: pendingLeftoverSave,
        percentage: leftoverTarget > 0 ? (monthlySavedLeftoverRealized / leftoverTarget) * 100 : 0
      }
    },
    totals: {
      savedThisMonth: totalMonthlySaved,
      savedAllTime: totalSavedAllTime,
      walletBalance: currentWalletBalance,
      displayBalance: displayBalance,
      totalExpenses: totalExpenses,
      needsSpent,
      wantsSpent
    }
  };
}

function formatBudgetForRAG(budgetData) {
  if (!budgetData) return '';

  return `
--- CURRENT MONTH BUDGET BREAKDOWN (50/30/20) ---
Month: ${budgetData.month}
Total Income: RM ${budgetData.income.fresh.toFixed(2)}

BUDGET ALLOCATIONS:
- Needs (50%): RM ${budgetData.budget.needs.target.toFixed(2)} allocated
  • Spent: RM ${budgetData.budget.needs.spent.toFixed(2)}
  • Remaining: RM ${budgetData.budget.needs.remaining.toFixed(2)}
  • ${budgetData.budget.needs.percentage.toFixed(0)}% of budget used

- Wants (30%): RM ${budgetData.budget.wants.target.toFixed(2)} allocated
  • Spent: RM ${budgetData.budget.wants.spent.toFixed(2)}
  • Remaining: RM ${budgetData.budget.wants.remaining.toFixed(2)}
  • ${budgetData.budget.wants.percentage.toFixed(0)}% of budget used

- Savings (20%): RM ${budgetData.budget.savings20.target.toFixed(2)} target
  • Saved: RM ${budgetData.budget.savings20.saved.toFixed(2)}
  • Remaining to save: RM ${budgetData.budget.savings20.pending.toFixed(2)}
  • ${budgetData.budget.savings20.percentage.toFixed(0)}% of target achieved

LEFTOVER BALANCE SAVINGS:
- Target: RM ${budgetData.budget.leftover.target.toFixed(2)}
- Saved: RM ${budgetData.budget.leftover.saved.toFixed(2)}
- Remaining: RM ${budgetData.budget.leftover.pending.toFixed(2)}
- ${budgetData.budget.leftover.percentage.toFixed(0)}% of target achieved

TOTALS:
- Total Saved This Month: RM ${budgetData.totals.savedThisMonth.toFixed(2)}
- Total Saved All Time: RM ${budgetData.totals.savedAllTime.toFixed(2)}
- Total Needs Spent: RM ${budgetData.totals.needsSpent.toFixed(2)}
- Total Wants Spent: RM ${budgetData.totals.wantsSpent.toFixed(2)}
- Current Available Balance: RM ${budgetData.totals.displayBalance.toFixed(2)}
`.trim();
}

// ==========================================
// 📡 6. API ENDPOINTS
// ==========================================

app.post('/predict-transaction', async (req, res) => {
  try {
    const { description } = req.body;
    const prediction = await predictTransactionInternal(description);
    console.log(`[Transaction] "${description}" -> ${prediction.category} (${prediction.confidence.category}) / ${prediction.subcategory} (${prediction.confidence.subcategory})`);
    res.json({ input: description, prediction: prediction });
  } catch (error) {
    console.error('Trans Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/chat/stream', async (req, res) => {
  const requestStart = Date.now();

  try {
    const { message, history, transactions, userProfile, budgetContext } = req.body; // ADDED: budgetContext

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    };

    sendEvent('thinking', { message: 'Processing your request...' });

    // Get month key helper
    const getMonthKey = (dateStr) => {
      const d = new Date(dateStr);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const [intentResult, relevantTips, userContext, dosmContext, transactionContext] = await Promise.allSettled([
      predictIntentInternal(message),
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
${JSON.stringify(transactions.slice(0, 10), null, 2)}
`.trim() : '')
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

    const intentPrediction = intentResult;

    // Check for local response
    if (intentPrediction &&
      intentPrediction.intent !== 'COMPLEX_ADVICE' &&
      intentPrediction.intent !== 'GARBAGE' &&
      localResponses[intentPrediction.intent]) {

      console.log(`⚡ Serving Local Response: ${intentPrediction.intent}`);

      const responseData = localResponses[intentPrediction.intent];
      const localMsg = Array.isArray(responseData)
        ? responseData[Math.floor(Math.random() * responseData.length)]
        : responseData;

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

    // Stream from Grok
    console.log('🤖 Streaming from Grok...');

    const tipsContext = relevantTips.length > 0 ? `
--- EXPERT FINANCIAL KNOWLEDGE BASE ---
${relevantTips.map(t => `- [${t.type}] ${t.topic}: ${t.advice}`).join('\n')}
` : '';

    // Use provided budgetContext OR calculate fallback
    let finalBudgetContext = budgetContext;
    if (!finalBudgetContext && transactions && userProfile) {
      console.log('📊 Calculating budget data on server (fallback)');
      const budgetData = calculateBudgetData(transactions, userProfile);
      finalBudgetContext = formatBudgetForRAG(budgetData);
    }

    const augmentedPrompt = [
      `Here is my latest message: "${message}"`,
      userContext && '--- MY PROFILE CONTEXT ---\n' + userContext,
      finalBudgetContext && '--- CURRENT MONTH BUDGET & SAVINGS STATUS ---\n' + finalBudgetContext, // ADDED
      appManualContext && '--- BERUANG APP MANUAL (USE THIS FOR HELP) ---\n' + appManualContext,
      dosmContext && '--- STATISTICAL CONTEXT (DOSM) ---\n' + dosmContext,
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
      max_tokens: 500,
      stream: true
    });

    const heartbeat = setInterval(() => {
      sendEvent('heartbeat', { status: 'alive' });
    }, 15000);

    res.on('close', () => {
      clearInterval(heartbeat);
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

  } catch (error) {
    console.error('💥 Streaming Error:', error);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed 🐻💔' })}\n\n`);
    res.end();
  }
});

app.post('/scan-receipt', upload.single('image'), async (req, res) => {
  try {
    let base64Image;

    if (req.file) {
      base64Image = req.file.buffer.toString('base64');
    } else if (req.body.image) {
      base64Image = req.body.image;
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log('🖼️ Scanning receipt with Gemini Vision...');

    const prompt = `
      Analyze this receipt image and extract details in STRICT JSON format.
      
      Extraction Logic:
      1. Merchant: Look for the business/shop/stall name at the very TOP of the receipt (e.g., "Ayam Gepuk Pak Gembus").
      2. Items: 
         - If ONE item: Use its exact name.
         - If MULTIPLE items: List the top 2 most expensive/prominent items, separated by comma. (e.g., "Ayam Bumbu Crispy, Teh O Ais"). 
         - If MANY items (5+): Use "Item 1, Item 2 & 3 others".

      JSON Structure:
      {
        "amount": number,
        "merchant": "string",
        "description": "string" (Prioritize EXACT item names. Do NOT summarize into generic terms like "Meal".),
        "date": "YYYY-MM-DD"
      }
      
      Context Rules:
      - Works for ANY merchant.
      - Return ONLY the JSON. No markdown backticks.
    `;

    // --- DIRECT GOOGLE AI (Your Personal Quota: 1,500/day) ---
    const googleApiKey = process.env.GOOGLE_GENAI_API_KEY;
    // Note: Upgraded to Gemini 2.5 Flash (New Stable 2026)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`;

    const response = await axios.post(url, {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: base64Image } }
        ]
      }]
    });

    const aiText = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    let result = JSON.parse(aiText);

    // Defensive: If AI returns an array or unexpected structure, extract the first item
    if (Array.isArray(result)) result = result[0];
    if (result.transactions && Array.isArray(result.transactions)) result = result.transactions[0];

    // --- INTEGRATE YOUR OWN AI BRAIN ---
    // Instead of trusting the Cloud AI, we use your local Beruang TensorFlow categorization!
    const query = result.description || result.merchant || 'Unknown';
    const prediction = await predictTransactionInternal(query);

    result.category = prediction.category;
    result.subCategory = prediction.subCategory;
    result.isAi = prediction.isAi;

    console.log(`✅ Scan successful. Local AI categorized "${query}" as ${result.category}`);
    res.json(result);

  } catch (error) {
    console.error('💥 Scan Error Details:', error.response?.data || error.message);

    if (error.response?.data?.error?.code === 404) {
      return res.status(404).json({
        error: `Google AI Model not found. Details: ${JSON.stringify(error.response?.data)}`
      });
    }

    if (error.message?.includes('free-models-per-day')) {
      return res.status(429).json({
        error: 'OpenRouter daily free limit reached! 🐻🚫 Try a different API key or wait until tomorrow.'
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        error: 'AI is currently busy (Rate Limited). Please try again in 15-30 seconds! ⏳🐻'
      });
    }

    res.status(500).json({ error: 'Failed to process receipt 🐻💔' });
  }
});

app.post('/import-data', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    console.log('📄 Parsing bulk data with Gemini...');

    const prompt = `
      Analyze the following text and extract a list of transactions. 
      The text might be messy (from Excel, Notes, or Chat).
      Return a JSON object with a "transactions" key containing an array of objects:
      {
        "transactions": [
          {
            "name": "string (Description)",
            "amount": number (Amount spent),
            "date": "YYYY-MM-DD",
            "category": "needs" | "wants" | "savings"
          }
        ]
      }
      Rules:
      1. Correct common typos.
      2. If date is missing, omit it or use current date if mentioned.
      3. For category, follow 50/30/20 rule: essentials (needs), lifestyle (wants), savings/debt (savings).
      4. RETURN ONLY JSON.
      
      Text to parse:
      "${text}"
    `;

    // --- DIRECT GOOGLE AI (Your Personal Quota: 1,500/day) ---
    const googleApiKey = process.env.GOOGLE_GENAI_API_KEY;
    // Note: Upgraded to Gemini 2.5 Flash (New Stable 2026)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`;

    const response = await axios.post(url, {
      contents: [{
        parts: [{ text: prompt }]
      }]
    });

    const aiText = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(aiText);
    console.log(`✅ Bulk Import successful: Found ${result.transactions?.length || 0} items.`);
    res.json(result);

  } catch (error) {
    console.error('💥 Import Error:', error);

    if (error.message?.includes('free-models-per-day')) {
      return res.status(429).json({
        error: 'OpenRouter daily free limit reached! 🐻🚫 Try a different API key or wait until tomorrow.'
      });
    }

    res.status(500).json({ error: 'Failed to parse bulk data 🐻💔' });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { message, history, transactions, userProfile, budgetContext } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Get month key helper
    const getMonthKey = (dateStr) => {
      const d = new Date(dateStr);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const relevantTips = getRelevantTips(message);

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
- Current Allocated Savings Target (Leftover from Budget): RM ${userProfile.allocatedSavingsTarget || 0}
`.trim() : '';

    const dosmContext = userProfile?.state ?
      (dosmRAGData[userProfile.state] || dosmRAGData['Nasional']) :
      dosmRAGData['Nasional'] || '';

    const transactionContext = transactions && transactions.length > 0 ? `
And here is my recent transaction data for context:
${JSON.stringify(transactions.slice(0, 10), null, 2)}
`.trim() : '';

    const tipsContext = relevantTips.length > 0 ? `
--- EXPERT FINANCIAL KNOWLEDGE BASE ---
${relevantTips.map(t => `- [${t.type}] ${t.topic}: ${t.advice}`).join('\n')}
` : '';

    // Use provided budgetContext OR calculate fallback
    let finalBudgetContext = budgetContext;
    if (!finalBudgetContext && transactions && userProfile) {
      console.log('📊 Calculating budget data on server (fallback)');
      const budgetData = calculateBudgetData(transactions, userProfile);
      finalBudgetContext = formatBudgetForRAG(budgetData);
    }

    const augmentedPrompt = [
      `Here is my latest message: "${message}"`,
      userContext && '--- MY PROFILE CONTEXT ---\n' + userContext,
      finalBudgetContext && '--- CURRENT MONTH BUDGET & SAVINGS STATUS ---\n' + finalBudgetContext,
      appManualContext && '--- BERUANG APP MANUAL (USE THIS FOR HELP) ---\n' + appManualContext,
      dosmContext && '--- STATISTICAL CONTEXT (DOSM) ---\n' + dosmContext,
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
      model: "x-ai/grok-4.1-fast",
      messages: messages,
      temperature: 0.5,
      max_tokens: 150
    });

    const botResponse = completion.choices[0]?.message?.content || "I couldn't generate a response.";

    res.json({
      message: botResponse,
      budget_context_used: !!finalBudgetContext
    });

  } catch (error) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: 'Chat processing failed' });
  }
});

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
// 🚀 7. STARTUP & WARMUP
// ==========================================

async function loadModels() {
  console.log('------------------------------------------------');
  console.log('🔄 INITIALIZING UNIFIED BERUANG SERVER...');

  try {
    if (fs.existsSync(TRANS_METADATA_PATH)) {
      transModel = await tf.loadLayersModel(TRANS_MODEL_PATH);
      transMetadata = await fs.readJson(TRANS_METADATA_PATH);
      console.log('✅ Transaction Model Loaded');
    } else {
      console.warn('⚠️ Transaction Model MISSING. Run: npm run train:transaction');
    }
  } catch (error) {
    console.error('❌ Transaction Model Load Error:', error.message);
  }

  try {
    if (fs.existsSync(INTENT_METADATA_PATH)) {
      intentModel = await tf.loadLayersModel(INTENT_MODEL_PATH);
      intentMetadata = await fs.readJson(INTENT_METADATA_PATH);

      console.log('⏳ Loading MiniLM Extractor...');
      intentExtractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

      console.log('✅ Intent Model & Extractor Loaded');
      const labelCount = intentMetadata.labelMap ? Object.keys(intentMetadata.labelMap).length : 0;
      console.log(`   - Loaded ${labelCount} intents`);
    } else {
      console.warn('⚠️ Intent Model MISSING. Run: npm run gen:intent && npm run train:intent');
    }
  } catch (error) {
    console.error('❌ Intent Model Load Error:', error.message);
  }
}

async function warmupConnections() {
  console.log('🔥 Warming up connections...');
  try {
    if (intentModel && intentExtractor) {
      console.log('   ...Pre-heating TensorFlow...');
      await predictIntentInternal('hello');
      console.log('   ✅ Local AI warmed up');
    } else {
      console.log('   ⚠️  Local AI skipped (Model not loaded)');
    }
  } catch (err) {
    console.log('   ⚠️  Local AI warmup failed:', err.message);
  }

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
    console.log(`   - App Manual (RAG): ${appManualContext.length > 0 ? '✅ Loaded for Grok' : '⚠️  Missing'}`);
    console.log(`   - Budget Context: ✅ READY (Frontend-provided)`);
    console.log('================================================');

    await warmupConnections();
    console.log('🚀 Server ready with STREAMING support!\n');
  });
}

startServer();