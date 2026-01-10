// src/config/env.js
// Environment configuration and API clients

require('dotenv').config();
const OpenAI = require('openai');

// OpenRouter API Client for Grok 4.1
const openAI = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    httpAgent: new (require('https').Agent)({ keepAlive: true }),
    defaultHeaders: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Beruang App'
    }
});

// API Keys
const GOOGLE_API_KEY = process.env.GOOGLE_GENAI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Model Paths
const TRANS_MODEL_PATH = 'file://' + require('path').resolve('./model_transaction/model.json');
const TRANS_METADATA_PATH = require('path').resolve('./model_transaction/metadata.json');
const INTENT_MODEL_PATH = 'file://' + require('path').resolve('./model_intent/model.json');
const INTENT_METADATA_PATH = require('path').resolve('./model_intent/metadata.json');

module.exports = {
    openAI,
    GOOGLE_API_KEY,
    TAVILY_API_KEY,
    TRANS_MODEL_PATH,
    TRANS_METADATA_PATH,
    INTENT_MODEL_PATH,
    INTENT_METADATA_PATH,
    PORT: 3000
};
