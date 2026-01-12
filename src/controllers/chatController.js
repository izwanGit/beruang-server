// src/controllers/chatController.js
// Chat Controller - The "Chatbot Orchestrator" in MVC Diagram
// FUNCTIONALITY UNCHANGED - Just organized into proper file

const intentService = require('../services/ai/intentService');
const llmService = require('../services/ai/llmService');
const onlineDetector = require('../services/rag/onlineDetector');
const budgetService = require('../services/finance/budgetService');
const knowledgeBase = require('../models/knowledgeBase');

/**
 * Build transaction context for RAG - COMPLETE VERSION FROM ORIGINAL
 */
/**
 * Build transaction context for RAG - OPTIMIZED FOR TOKENS
 */
function buildTransactionContext(transactions, compact = false) {
    if (!transactions || transactions.length === 0) return '';

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        return new Date(dateStr.split('T')[0]);
    };

    const getStartOfWeek = (date) => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    };

    const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Calculate time range boundaries
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfThisWeek = getStartOfWeek(today);
    const startOfLastWeek = new Date(startOfThisWeek); startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
    const endOfLastWeek = new Date(startOfThisWeek); endOfLastWeek.setDate(endOfLastWeek.getDate() - 1);
    const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    const startOfThisYear = new Date(today.getFullYear(), 0, 1);
    const startOfLastYear = new Date(today.getFullYear() - 1, 0, 1);
    const endOfLastYear = new Date(today.getFullYear() - 1, 11, 31);

    const summarizeTransactions = (txns, label) => {
        const expenses = txns.filter(t => t.type === 'expense');
        const incomes = txns.filter(t => t.type === 'income');
        const totalExpense = expenses.reduce((sum, t) => sum + (t.amount || 0), 0);
        const totalIncome = incomes.reduce((sum, t) => sum + (t.amount || 0), 0);
        const needsSpent = expenses.filter(t => t.category === 'needs').reduce((sum, t) => sum + (t.amount || 0), 0);
        const wantsSpent = expenses.filter(t => t.category === 'wants').reduce((sum, t) => sum + (t.amount || 0), 0);
        const savingsSpent = expenses.filter(t => t.category === 'savings').reduce((sum, t) => sum + (t.amount || 0), 0);

        const summary = {
            label,
            count: txns.length,
            totalIncome: totalIncome.toFixed(2),
            totalExpense: totalExpense.toFixed(2),
            netFlow: (totalIncome - totalExpense).toFixed(2),
            breakdown: { needs: needsSpent.toFixed(2), wants: wantsSpent.toFixed(2), savings: savingsSpent.toFixed(2) }
        };

        if (!compact) {
            summary.transactions = txns.map(t => ({
                date: t.date?.split('T')[0],
                name: t.name,
                amount: t.type === 'income' ? t.amount : -t.amount,
                type: t.type,
                category: t.category
            }));
        }

        return summary;
    };

    // Filter transactions by each time range
    const todayTxns = transactions.filter(t => parseDate(t.date)?.toDateString() === startOfToday.toDateString());
    const yesterdayTxns = transactions.filter(t => parseDate(t.date)?.toDateString() === startOfYesterday.toDateString());
    const thisWeekTxns = transactions.filter(t => { const d = parseDate(t.date); return d && d >= startOfThisWeek && d <= today; });
    const lastWeekTxns = transactions.filter(t => { const d = parseDate(t.date); return d && d >= startOfLastWeek && d <= endOfLastWeek; });
    const thisMonthTxns = transactions.filter(t => { const d = parseDate(t.date); return d && d >= startOfThisMonth && d <= today; });
    const lastMonthTxns = transactions.filter(t => { const d = parseDate(t.date); return d && d >= startOfLastMonth && d <= endOfLastMonth; });
    const thisYearTxns = transactions.filter(t => { const d = parseDate(t.date); return d && d >= startOfThisYear && d <= today; });
    const lastYearTxns = transactions.filter(t => { const d = parseDate(t.date); return d && d >= startOfLastYear && d <= endOfLastYear; });

    let context = `--- TRANSACTION SUMMARIES ---\n`;
    context += `Current Date: ${formatDate(today)} | Total Txns: ${transactions.length}\n\n`;

    const addSummaryToContext = (txns, label, showItems = false) => {
        const s = summarizeTransactions(txns, label);
        let res = `📅 ${label}: Count: ${s.count} | Inc: RM ${s.totalIncome} | Exp: RM ${s.totalExpense} | Net: RM ${s.netFlow}\n`;
        if (!compact && showItems && s.transactions && s.transactions.length > 0) {
            res += `   Items: ${JSON.stringify(s.transactions)}\n`;
        }
        return res + `\n`;
    };

    context += addSummaryToContext(todayTxns, 'TODAY', true);
    context += addSummaryToContext(yesterdayTxns, 'YESTERDAY', true);
    context += addSummaryToContext(thisWeekTxns, 'THIS WEEK', !compact && thisWeekTxns.length <= 10);
    context += addSummaryToContext(thisMonthTxns, 'THIS MONTH', !compact && thisMonthTxns.length <= 10);

    if (!compact) {
        context += addSummaryToContext(lastMonthTxns, 'LAST MONTH');
        context += addSummaryToContext(thisYearTxns, 'THIS YEAR');
    }

    return context.trim();
}

/**
 * Streaming chat endpoint - The main orchestrator
 */
async function streamChat(req, res) {
    const requestStart = Date.now();

    try {
        const { message, history, transactions, userProfile, budgetContext } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        console.log(`📦 Received ${transactions?.length || 0} transactions from frontend`);

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

        // Check if query should go ONLINE via Knowledge Router
        const isOnlineQuery = onlineDetector.detectOnlineQuery(message);

        if (isOnlineQuery) {
            const searchSnippet = message.length > 30 ? message.substring(0, 30) + '...' : message;
            sendEvent('thinking', { message: `Searching the web for "${searchSnippet}"... 🔍` });
        } else {
            sendEvent('thinking', { message: 'Processing your request...' });
        }

        // Get intent prediction (web search is now handled by Grok :online)
        const intentResult = await intentService.predictIntent(message);

        const relevantTips = knowledgeBase.getRelevantTips(message);

        // Check for local response
        const confidenceNum = intentResult ? parseFloat(intentResult.confidence) : 0;
        const isShortFollowUp = message.trim().length < 20 && (history || []).length > 0;
        const isHighConfidenceLocal = confidenceNum >= 80 &&
            intentResult?.intent !== 'COMPLEX_ADVICE' &&
            knowledgeBase.hasLocalResponse(intentResult?.intent);

        // Bypass local response for online queries (use Grok :online) or short follow-ups
        const shouldBypassLocal = isOnlineQuery || (isShortFollowUp && !isHighConfidenceLocal);

        // Serve local response if applicable
        if (!shouldBypassLocal &&
            intentResult &&
            intentResult.intent !== 'COMPLEX_ADVICE' &&
            intentResult.intent !== 'GARBAGE' &&
            knowledgeBase.hasLocalResponse(intentResult.intent)) {

            console.log(`⚡ Serving Local Response: ${intentResult.intent}`);

            const localMsg = knowledgeBase.getLocalResponse(intentResult.intent);
            const words = localMsg.split(' ');

            for (let i = 0; i < words.length; i++) {
                sendEvent('token', { content: words[i] + ' ', done: false });
                await new Promise(resolve => setTimeout(resolve, 30));
            }

            sendEvent('done', {
                source: 'local',
                intent: intentResult.intent,
                response_time_ms: Date.now() - requestStart
            });

            return res.end();
        }

        // Stream from Grok
        console.log('🤖 Streaming from Grok...');

        // Build context - PRUNED FOR ONLINE QUERIES TO SAVE TOKENS
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

        // Optimization: Don't send DOSM or Tips for online searches (save tokens)
        // BUT keep App Manual (for XP/Gamification rules) and Budget Context (for affordability)
        const dosmContext = (!isOnlineQuery && userProfile?.state) ? knowledgeBase.getDosmData(userProfile.state) : '';
        const tipsContext = (!isOnlineQuery && relevantTips.length > 0) ? `
Expert Tips: ${relevantTips.map(t => `${t.topic}: ${t.advice}`).join('; ')}
` : '';
        const appManualContext = knowledgeBase.getAppManualContext();

        // Optimization: Use compact transaction context (summaries only) for search
        const transactionContext = buildTransactionContext(transactions, isOnlineQuery);

        let finalBudgetContext = budgetContext;
        if (!finalBudgetContext && transactions && userProfile) {
            const budgetData = budgetService.calculateBudgetData(transactions, userProfile);
            finalBudgetContext = budgetService.formatBudgetForRAG(budgetData);
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
            ...recentHistory.map(msg => ({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: msg.parts.map(p => p.text).join('')
            })),
            { role: 'user', content: augmentedPrompt }
        ];

        const stream = await llmService.streamChat(messages, { isLocationQuery: isOnlineQuery });

        const heartbeat = setInterval(() => {
            sendEvent('heartbeat', { status: 'alive' });
        }, 15000);

        res.on('close', () => clearInterval(heartbeat));

        let streamedContent = '';

        try {
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    streamedContent += content;
                    sendEvent('token', { content: content, done: false });
                }
            }

            clearInterval(heartbeat);
            sendEvent('done', {
                source: 'grok',
                response_time_ms: Date.now() - requestStart
            });

        } catch (streamError) {
            clearInterval(heartbeat);
            if (streamError.code === 'ERR_STREAM_PREMATURE_CLOSE' && streamedContent.length > 20) {
                sendEvent('done', { source: 'grok', partial: true });
            } else {
                throw streamError;
            }
        }

        res.end();

    } catch (error) {
        console.error('💥 Streaming Error:', error);
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: 'Stream failed 🐻💔' })}\n\n`);
        res.end();
    }
}

/**
 * Non-streaming chat endpoint
 */
async function chat(req, res) {
    try {
        const { message, history, transactions, userProfile, budgetContext } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        // Build context - COMPLETE VERSION FROM ORIGINAL
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

        const relevantTips = knowledgeBase.getRelevantTips(message);
        const tipsContext = relevantTips.length > 0 ? `
Expert Tips: ${relevantTips.map(t => `${t.topic}: ${t.advice}`).join('; ')}
` : '';
        const appManualContext = knowledgeBase.getAppManualContext();

        let finalBudgetContext = budgetContext;
        if (!finalBudgetContext && transactions && userProfile) {
            const budgetData = budgetService.calculateBudgetData(transactions, userProfile);
            finalBudgetContext = budgetService.formatBudgetForRAG(budgetData);
        }

        const augmentedPrompt = [
            `Here is my latest message: "${message}"`,
            userContext && '--- MY PROFILE CONTEXT ---\n' + userContext,
            finalBudgetContext && '--- CURRENT MONTH BUDGET & SAVINGS STATUS ---\n' + finalBudgetContext,
            appManualContext && '--- BERUANG APP MANUAL (USE THIS FOR HELP) ---\n' + appManualContext,
            tipsContext
        ].filter(Boolean).join('\n\n');

        const recentHistory = (history || []).slice(-8);
        const messages = [
            ...recentHistory.map(msg => ({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: msg.parts.map(p => p.text).join('')
            })),
            { role: 'user', content: augmentedPrompt }
        ];

        const botResponse = await llmService.chat(messages);

        res.json({
            message: botResponse,
            budget_context_used: !!finalBudgetContext
        });

    } catch (error) {
        console.error('Chat Error:', error);
        res.status(500).json({ error: 'Chat processing failed' });
    }
}

module.exports = {
    streamChat,
    chat
};
