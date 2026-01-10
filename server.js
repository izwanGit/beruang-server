// server.js - CLEAN ENTRY POINT (MVC Refactored)
// Functionality is 100% IDENTICAL to original - just organized into proper folders

const util = require('util');
// Fix for Node v23+ compatibility
util.isNullOrUndefined = util.isNullOrUndefined || ((value) => value === null || value === undefined);

const express = require('express');
const cors = require('cors');
const compression = require('compression');

// Load environment config
const { PORT } = require('./src/config/env');

// Load models and services
const knowledgeBase = require('./src/models/knowledgeBase');
const intentService = require('./src/services/ai/intentService');
const transactionService = require('./src/services/ai/transactionService');

// Load routes
const apiRoutes = require('./src/routes/api');

// ==========================================
// 🚀 SERVER SETUP
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

// Mount API routes
app.use('/', apiRoutes);

// ==========================================
// 🚀 STARTUP & MODEL LOADING
// ==========================================
async function initialize() {
    console.log('------------------------------------------------');
    console.log('🔄 INITIALIZING BERUANG SERVER (MVC Mode)...');

    // Load static knowledge base
    knowledgeBase.loadKnowledgeBase();

    // Load AI models
    await transactionService.loadTransactionModel();
    await intentService.loadIntentModel();

    // Start server
    app.listen(PORT, () => {
        console.log('------------------------------------------------');
        console.log(`🐻 Beruang Server running on port ${PORT}`);
        console.log('📁 Architecture: MVC Refactored');
        console.log('🔌 Endpoints: /chat/stream, /predict-transaction, /scan-receipt, /health');
        console.log('------------------------------------------------');
    });
}

// Warm up models with test inference
async function warmupModels() {
    console.log('🔥 Warming up models...');

    try {
        await transactionService.predictTransaction('test grocery shopping');
        console.log('✅ Transaction model warmed up');
    } catch (e) {
        console.log('⚠️ Transaction warmup skipped:', e.message);
    }

    try {
        await intentService.predictIntent('hello');
        console.log('✅ Intent model warmed up');
    } catch (e) {
        console.log('⚠️ Intent warmup skipped:', e.message);
    }
}

// Start the server
initialize().then(() => {
    warmupModels();
}).catch(err => {
    console.error('❌ Failed to initialize server:', err);
    process.exit(1);
});
