// src/controllers/chatController.js
// Chat Controller - The "Chatbot Orchestrator" in MVC Diagram
// FUNCTIONALITY UNCHANGED - Just organized into proper file

const intentService = require('../services/ai/intentService');
const llmService = require('../services/ai/llmService');
const tavilyService = require('../services/rag/tavilyService');
const budgetService = require('../services/finance/budgetService');
const knowledgeBase = require('../models/knowledgeBase');

/**
 * Build transaction context for RAG
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

    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

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

    const todayTxns = transactions.filter(t => parseDate(t.date)?.toDateString() === startOfToday.toDateString());
    const thisMonthTxns = transactions.filter(t => { const d = parseDate(t.date); return d && d >= startOfThisMonth && d <= today; });

    let context = `--- TRANSACTION DATA ---\n`;
    context += `Current Date: ${formatDate(today)}\n`;

    const todaySummary = summarizeTransactions(todayTxns, 'TODAY');
    context += `TODAY: ${todaySummary.count} txns | Expense: RM ${todaySummary.totalExpense}\n`;

    const thisMonthSummary = summarizeTransactions(thisMonthTxns, 'THIS MONTH');
    context += `THIS MONTH: Needs RM ${thisMonthSummary.breakdown.needs} | Wants RM ${thisMonthSummary.breakdown.wants}\n`;

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

        // Build context
        const userContext = userProfile ? `
User: ${userProfile.name}, ${userProfile.age}, ${userProfile.state}
Income: RM ${userProfile.monthlyIncome}
Goal: ${userProfile.financialGoals}
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

        const augmentedPrompt = [
            `Message: "${message}"`,
            userContext,
            finalBudgetContext,
            transactionContext,
            tipsContext,
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

        const relevantTips = knowledgeBase.getRelevantTips(message);
        const userContext = userProfile ? `User: ${userProfile.name}, Income: RM ${userProfile.monthlyIncome}` : '';

        let finalBudgetContext = budgetContext;
        if (!finalBudgetContext && transactions && userProfile) {
            const budgetData = budgetService.calculateBudgetData(transactions, userProfile);
            finalBudgetContext = budgetService.formatBudgetForRAG(budgetData);
        }

        const augmentedPrompt = [
            `Message: "${message}"`,
            userContext,
            finalBudgetContext
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
