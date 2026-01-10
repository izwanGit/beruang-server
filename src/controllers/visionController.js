// src/controllers/visionController.js
// Vision (Gemini 2.5) Controller

const visionService = require('../services/ai/visionService');
const transactionService = require('../services/ai/transactionService');

/**
 * Scan receipt and categorize
 */
async function scanReceipt(req, res) {
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

        // Get OCR result from Gemini
        let result = await visionService.scanReceipt(base64Image);

        // Categorize with local TensorFlow model
        const query = result.description || result.merchant || 'Unknown';
        const prediction = await transactionService.predictTransaction(query);

        result.category = prediction.category;
        result.subCategory = prediction.subcategory;
        result.isAi = true;

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
}

/**
 * Import bulk text data
 */
async function importData(req, res) {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });

        console.log('📄 Parsing bulk data with Gemini...');

        const result = await visionService.parseBulkData(text);
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
}

module.exports = {
    scanReceipt,
    importData
};
