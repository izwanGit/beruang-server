// src/services/ai/intentService.js
// Local TensorFlow.js Intent Classification Service

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs-extra');
const { pipeline } = require('@xenova/transformers');
const { INTENT_MODEL_PATH, INTENT_METADATA_PATH } = require('../../config/env');

let intentModel = null;
let intentMetadata = null;
let intentExtractor = null;

/**
 * Load intent classification model and MiniLM extractor
 */
async function loadIntentModel() {
    try {
        if (fs.existsSync(INTENT_METADATA_PATH)) {
            intentModel = await tf.loadLayersModel(INTENT_MODEL_PATH);
            intentMetadata = await fs.readJson(INTENT_METADATA_PATH);

            console.log('⏳ Loading MiniLM Extractor...');
            intentExtractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

            console.log('✅ Intent Model & Extractor Loaded');
            const labelCount = intentMetadata.labelMap ? Object.keys(intentMetadata.labelMap).length : 0;
            console.log(`   - Loaded ${labelCount} intents`);
            return true;
        } else {
            console.warn('⚠️ Intent Model MISSING. Run: npm run gen:intent && npm run train:intent');
            return false;
        }
    } catch (error) {
        console.error('❌ Intent Model Load Error:', error.message);
        return false;
    }
}

/**
 * Detect out-of-distribution queries
 */
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

/**
 * Predict intent for a message
 */
async function predictIntent(message) {
    if (!intentModel || !intentMetadata || !intentExtractor) return null;
    if (!message || !message.trim()) return null;

    // WHITELIST: App-help patterns that should bypass red flag check
    const APP_HELP_PATTERNS = [
        /^how (to|do i|can i) (add|save|use|check|see|view|delete|edit|remove|track|log|record)/i,
        /^where (is|can i|do i|to) (add|find|see|view|check)/i,
        /^what (is|does) (this|the) (app|feature|screen|button|page)/i,
        /in this app/i,
        /in beruang/i,
        /this app/i,
        /the app/i,
    ];

    const lowerMsg = message.toLowerCase();
    const isAppHelpQuery = APP_HELP_PATTERNS.some(p => p.test(lowerMsg));

    // Skip pre-filter for app-help queries
    if (!isAppHelpQuery) {
        const RED_FLAGS = [
            'invest', 'crypto', 'stock', 'debt', 'loan', 'buy', 'sell',
            'salary', 'finance', 'money', 'budget', 'save for', 'afford',
            'survive', 'bank', 'insurance', 'tax', 'profit', 'loss', 'worth',
            'bitcoin', 'gold', 'property', 'car', 'house', 'wedding',
            'unrealistic', 'opinion', 'thoughts', 'compare', 'pros and cons'
        ];

        const COMPLEX_STARTERS = ['why', 'how', 'what if', 'should i', 'can i', 'explain', 'tell me about'];
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
    } else {
        console.log(`[Intent] ✅ APP-HELP: Bypassing pre-filter for "${message}"`);
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

/**
 * Check if model is loaded
 */
function isLoaded() {
    return !!intentModel && !!intentMetadata && !!intentExtractor;
}

module.exports = {
    loadIntentModel,
    predictIntent,
    isLoaded
};
