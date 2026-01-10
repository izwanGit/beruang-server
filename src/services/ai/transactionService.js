// src/services/ai/transactionService.js
// Local TensorFlow.js Transaction Classification Service

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs-extra');
const { TRANS_MODEL_PATH, TRANS_METADATA_PATH } = require('../../config/env');
const { preprocess } = require('../../utils/textUtils');

let transModel = null;
let transMetadata = null;

/**
 * Load transaction classification model
 */
async function loadTransactionModel() {
    try {
        if (fs.existsSync(TRANS_METADATA_PATH)) {
            transModel = await tf.loadLayersModel(TRANS_MODEL_PATH);
            transMetadata = await fs.readJson(TRANS_METADATA_PATH);
            console.log('✅ Transaction Model Loaded');
            return true;
        } else {
            console.warn('⚠️ Transaction Model MISSING. Run: npm run train:transaction');
            return false;
        }
    } catch (error) {
        console.error('❌ Transaction Model Load Error:', error.message);
        return false;
    }
}

/**
 * Predict category and subcategory for a transaction description
 */
async function predictTransaction(description) {
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

/**
 * Check if model is loaded
 */
function isLoaded() {
    return !!transModel && !!transMetadata;
}

/**
 * Get metadata for external use
 */
function getMetadata() {
    return transMetadata;
}

module.exports = {
    loadTransactionModel,
    predictTransaction,
    isLoaded,
    getMetadata
};
