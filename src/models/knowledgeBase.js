// src/models/knowledgeBase.js
// Loads and manages static data files (responses.json, dosm_data, expert_tips)

const fs = require('fs-extra');
const path = require('path');

// Local responses and app manual
let localResponses = {};
let appManualContext = "";

// DOSM RAG Data
let dosmRAGData = {};

// Expert Tips with search index
let expertTips = [];
const tipsIndex = new Map();

/**
 * Load all static knowledge base data
 */
function loadKnowledgeBase() {
    // 1. Load Local Responses
    try {
        const rawData = JSON.parse(fs.readFileSync(path.resolve('./data/knowledge/responses.json'), 'utf8'));

        if (rawData.intents && Array.isArray(rawData.intents)) {
            rawData.intents.forEach(intent => {
                localResponses[intent.tag] = intent.responses;
            });

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

    // 2. Load DOSM Data
    try {
        const data = fs.readFileSync(path.resolve('./data/knowledge/dosm_data.json'), 'utf8');
        dosmRAGData = JSON.parse(data);
        console.log('✅ Successfully loaded DOSM RAG data.');
    } catch (error) {
        console.log('⚠️ dosm_data.json not found (DOSM RAG disabled).');
    }

    // 3. Load Expert Tips
    try {
        const tipsData = fs.readFileSync(path.resolve('./data/knowledge/expert_tips.json'), 'utf8');
        expertTips = JSON.parse(tipsData);
        console.log(`✅ Loaded ${expertTips.length} expert financial tips.`);

        // Build search index
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
    } catch (error) {
        console.log('⚠️ expert_tips.json not found.');
        expertTips = [];
    }
}

/**
 * Get relevant tips based on message keywords
 */
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

/**
 * Get local response for an intent
 */
function getLocalResponse(intent) {
    const responseData = localResponses[intent];
    if (!responseData) return null;
    return Array.isArray(responseData)
        ? responseData[Math.floor(Math.random() * responseData.length)]
        : responseData;
}

/**
 * Check if intent has local response
 */
function hasLocalResponse(intent) {
    return !!localResponses[intent];
}

/**
 * Get DOSM data for a state
 */
function getDosmData(state) {
    return dosmRAGData[state] || dosmRAGData['Nasional'] || '';
}

/**
 * Get app manual context
 */
function getAppManualContext() {
    return appManualContext;
}

module.exports = {
    loadKnowledgeBase,
    getRelevantTips,
    getLocalResponse,
    hasLocalResponse,
    getDosmData,
    getAppManualContext
};
