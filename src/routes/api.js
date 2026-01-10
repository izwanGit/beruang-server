// src/routes/api.js
// API Routes Definition (Matches MVC "API Gateway")

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// Import Controllers
const chatController = require('../controllers/chatController');
const visionController = require('../controllers/visionController');
const transactionController = require('../controllers/transactionController');

// Health Check
router.get('/health', (req, res) => {
    const intentService = require('../services/ai/intentService');
    const transactionService = require('../services/ai/transactionService');
    const { TAVILY_API_KEY } = require('../config/env');

    res.json({
        status: 'online',
        mode: 'MVC_REFACTORED',
        models: {
            transaction: transactionService.isLoaded() ? 'loaded' : 'missing',
            intent: intentService.isLoaded() ? 'loaded' : 'missing'
        },
        grok: !!process.env.OPENROUTER_API_KEY ? 'configured' : 'missing_api_key',
        webSearch: !!TAVILY_API_KEY ? 'configured' : 'not_configured',
        timestamp: new Date().toISOString()
    });
});

// Chat Endpoints
router.post('/chat/stream', chatController.streamChat);
router.post('/chat', chatController.chat);

// Transaction Classification
router.post('/predict-transaction', transactionController.predict);

// Vision/OCR Endpoints
router.post('/scan-receipt', upload.single('image'), visionController.scanReceipt);
router.post('/import-data', visionController.importData);

module.exports = router;
