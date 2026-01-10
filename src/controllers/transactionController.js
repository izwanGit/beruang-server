// src/controllers/transactionController.js
// Transaction Classification Controller

const transactionService = require('../services/ai/transactionService');

/**
 * Predict category for a transaction description
 */
async function predict(req, res) {
    try {
        const { description } = req.body;
        const prediction = await transactionService.predictTransaction(description);
        console.log(`[Transaction] "${description}" -> ${prediction.category} (${prediction.confidence.category}) / ${prediction.subcategory} (${prediction.confidence.subcategory})`);
        res.json({ input: description, prediction: prediction });
    } catch (error) {
        console.error('Trans Error:', error.message);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    predict
};
