// src/controllers/chatController.js
// Chat Controller - The "Chatbot Orchestrator" in MVC Diagram
// FUNCTIONALITY UNCHANGED - Just organized into proper file

const intentService = require('../services/ai/intentService');
const llmService = require('../services/ai/llmService');
const tavilyService = require('../services/rag/tavilyService');
const budgetService = require('../services/finance/budgetService');
const knowledgeBase = require('../models/knowledgeBase');

/**
 * Build transaction context for RAG - COMPLETE VERSION FROM ORIGINAL
 */
function buildTransactionContext(transactions) {
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

        return {
            label,
            count: txns.length,
            totalIncome: totalIncome.toFixed(2),
            totalExpense: totalExpense.toFixed(2),
            netFlow: (totalIncome - totalExpense).toFixed(2),
            breakdown: { needs: needsSpent.toFixed(2), wants: wantsSpent.toFixed(2), savings: savingsSpent.toFixed(2) },
            transactions: txns.map(t => ({
                date: t.date?.split('T')[0],
                name: t.name,
                amount: t.type === 'income' ? t.amount : -t.amount,
                type: t.type,
                category: t.category
            }))
        };
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

    let context = `--- TRANSACTION DATA (PRE-CALCULATED FOR ACCURACY) ---\n`;
    context += `Current Date: ${formatDate(today)} (${today.toLocaleDateString('en-US', { weekday: 'long' })})\n`;
    context += `Total Transactions in Database: ${transactions.length}\n\n`;
    context += `=== TIME RANGE SUMMARIES (USE THESE FOR WIDGETS) ===\n\n`;

    // Today
    const todaySummary = summarizeTransactions(todayTxns, 'TODAY');
    context += `📅 TODAY (${formatDate(today)}):\n`;
    context += `   Transactions: ${todaySummary.count} | Income: RM ${todaySummary.totalIncome} | Expense: RM ${todaySummary.totalExpense} | Net: RM ${todaySummary.netFlow}\n`;
    if (todaySummary.count > 0) context += `   Items: ${JSON.stringify(todaySummary.transactions)}\n`;
    context += `\n`;

    // Yesterday
    const yesterdaySummary = summarizeTransactions(yesterdayTxns, 'YESTERDAY');
    context += `📅 YESTERDAY (${formatDate(startOfYesterday)}):\n`;
    context += `   Transactions: ${yesterdaySummary.count} | Income: RM ${yesterdaySummary.totalIncome} | Expense: RM ${yesterdaySummary.totalExpense} | Net: RM ${yesterdaySummary.netFlow}\n`;
    if (yesterdaySummary.count > 0) context += `   Items: ${JSON.stringify(yesterdaySummary.transactions)}\n`;
    context += `\n`;

    // This Week
    const thisWeekSummary = summarizeTransactions(thisWeekTxns, 'THIS WEEK');
    context += `📅 THIS WEEK (${formatDate(startOfThisWeek)} - ${formatDate(today)}):\n`;
    context += `   Transactions: ${thisWeekSummary.count} | Income: RM ${thisWeekSummary.totalIncome} | Expense: RM ${thisWeekSummary.totalExpense} | Net: RM ${thisWeekSummary.netFlow}\n`;
    context += `   Breakdown: Needs RM ${thisWeekSummary.breakdown.needs} | Wants RM ${thisWeekSummary.breakdown.wants} | Savings RM ${thisWeekSummary.breakdown.savings}\n`;
    if (thisWeekSummary.count > 0 && thisWeekSummary.count <= 10) context += `   Items: ${JSON.stringify(thisWeekSummary.transactions)}\n`;
    context += `\n`;

    // Last Week
    const lastWeekSummary = summarizeTransactions(lastWeekTxns, 'LAST WEEK');
    context += `📅 LAST WEEK (${formatDate(startOfLastWeek)} - ${formatDate(endOfLastWeek)}):\n`;
    context += `   Transactions: ${lastWeekSummary.count} | Income: RM ${lastWeekSummary.totalIncome} | Expense: RM ${lastWeekSummary.totalExpense} | Net: RM ${lastWeekSummary.netFlow}\n`;
    context += `   Breakdown: Needs RM ${lastWeekSummary.breakdown.needs} | Wants RM ${lastWeekSummary.breakdown.wants} | Savings RM ${lastWeekSummary.breakdown.savings}\n`;
    context += `\n`;

    // This Month
    const thisMonthSummary = summarizeTransactions(thisMonthTxns, 'THIS MONTH');
    context += `📅 THIS MONTH (${today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}):\n`;
    context += `   Transactions: ${thisMonthSummary.count} | Income: RM ${thisMonthSummary.totalIncome} | Expense: RM ${thisMonthSummary.totalExpense} | Net: RM ${thisMonthSummary.netFlow}\n`;
    context += `   Breakdown: Needs RM ${thisMonthSummary.breakdown.needs} | Wants RM ${thisMonthSummary.breakdown.wants} | Savings RM ${thisMonthSummary.breakdown.savings}\n`;
    if (thisMonthSummary.count <= 20) context += `   Items: ${JSON.stringify(thisMonthSummary.transactions)}\n`;
    context += `\n`;

    // Last Month  
    const lastMonthSummary = summarizeTransactions(lastMonthTxns, 'LAST MONTH');
    context += `📅 LAST MONTH (${startOfLastMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}):\n`;
    context += `   Transactions: ${lastMonthSummary.count} | Income: RM ${lastMonthSummary.totalIncome} | Expense: RM ${lastMonthSummary.totalExpense} | Net: RM ${lastMonthSummary.netFlow}\n`;
    context += `   Breakdown: Needs RM ${lastMonthSummary.breakdown.needs} | Wants RM ${lastMonthSummary.breakdown.wants} | Savings RM ${lastMonthSummary.breakdown.savings}\n`;
    context += `\n`;

    // This Year
    const thisYearSummary = summarizeTransactions(thisYearTxns, 'THIS YEAR');
    context += `📅 THIS YEAR (${today.getFullYear()}):\n`;
    context += `   Transactions: ${thisYearSummary.count} | Income: RM ${thisYearSummary.totalIncome} | Expense: RM ${thisYearSummary.totalExpense} | Net: RM ${thisYearSummary.netFlow}\n`;
    context += `   Breakdown: Needs RM ${thisYearSummary.breakdown.needs} | Wants RM ${thisYearSummary.breakdown.wants} | Savings RM ${thisYearSummary.breakdown.savings}\n`;
    context += `\n`;

    // Last Year
    const lastYearSummary = summarizeTransactions(lastYearTxns, 'LAST YEAR');
    context += `📅 LAST YEAR (${today.getFullYear() - 1}):\n`;
    context += `   Transactions: ${lastYearSummary.count} | Income: RM ${lastYearSummary.totalIncome} | Expense: RM ${lastYearSummary.totalExpense} | Net: RM ${lastYearSummary.netFlow}\n`;
    context += `   Breakdown: Needs RM ${lastYearSummary.breakdown.needs} | Wants RM ${lastYearSummary.breakdown.wants} | Savings RM ${lastYearSummary.breakdown.savings}\n`;
    context += `\n`;

    context += `=== IMPORTANT: USE THE PRE-CALCULATED VALUES ABOVE ===\n`;
    context += `When generating [WIDGET_DATA], use the EXACT numbers from the summaries above.\n`;
    context += `Do NOT recalculate - the summaries are already accurate.\n`;

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

        sendEvent('thinking', { message: 'Processing your request...' });

        // Check if location query
        const isLocationQuery = tavilyService.detectLocationQuery(message);

        // Run all context gathering in parallel
        const [intentResult, webSearchResult] = await Promise.all([
            intentService.predictIntent(message),
            isLocationQuery ? tavilyService.searchWeb(tavilyService.appendHalalFilter(message)) : Promise.resolve(null)
        ]);

        const relevantTips = knowledgeBase.getRelevantTips(message);

        // Check for local response
        const confidenceNum = intentResult ? parseFloat(intentResult.confidence) : 0;
        const hasWebResults = webSearchResult && webSearchResult.results;
        const isShortFollowUp = message.trim().length < 20 && (history || []).length > 0;
        const isHighConfidenceLocal = confidenceNum >= 80 &&
            intentResult?.intent !== 'COMPLEX_ADVICE' &&
            knowledgeBase.hasLocalResponse(intentResult?.intent);

        const shouldBypassLocal = (isLocationQuery && hasWebResults) || (isShortFollowUp && !isHighConfidenceLocal);

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

        const dosmContext = userProfile?.state ? knowledgeBase.getDosmData(userProfile.state) : '';
        const transactionContext = buildTransactionContext(transactions);

        let finalBudgetContext = budgetContext;
        if (!finalBudgetContext && transactions && userProfile) {
            const budgetData = budgetService.calculateBudgetData(transactions, userProfile);
            finalBudgetContext = budgetService.formatBudgetForRAG(budgetData);
        }

        const tipsContext = relevantTips.length > 0 ? `
Expert Tips: ${relevantTips.map(t => `${t.topic}: ${t.advice}`).join('; ')}
` : '';

        let webSearchContext = '';
        if (webSearchResult && webSearchResult.results) {
            webSearchContext = `--- WEB SEARCH RESULTS ---\n${webSearchResult.results}\n--- END ---`;
        }

        const appManualContext = knowledgeBase.getAppManualContext();

        const augmentedPrompt = [
            `Here is my latest message: "${message}"`,
            userContext && '--- MY PROFILE CONTEXT ---\n' + userContext,
            finalBudgetContext && '--- CURRENT MONTH BUDGET & SAVINGS STATUS ---\n' + finalBudgetContext,
            appManualContext && '--- BERUANG APP MANUAL (USE THIS FOR HELP) ---\n' + appManualContext,
            dosmContext && '--- STATISTICAL CONTEXT (DOSM) ---\n' + dosmContext,
            tipsContext,
            transactionContext && '--- MY RECENT TRANSACTIONS ---\n' + transactionContext,
            webSearchContext
        ].filter(Boolean).join('\n\n');

        const recentHistory = (history || []).slice(-8);
        const messages = [
            ...recentHistory.map(msg => ({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: msg.parts.map(p => p.text).join('')
            })),
            { role: 'user', content: augmentedPrompt }
        ];

        const stream = await llmService.streamChat(messages, { isLocationQuery, hasWebResults });

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
