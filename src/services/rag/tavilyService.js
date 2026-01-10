// src/services/rag/tavilyService.js
// Tavily Web Search Service (Anti-Hallucination)

const axios = require('axios');
const { TAVILY_API_KEY } = require('../../config/env');

/**
 * Detect if a message is asking about locations/places/restaurants/hotels
 */
function detectLocationQuery(message) {
    const lowerMsg = message.toLowerCase();

    const locationKeywords = [
        'makanan', 'makan', 'food', 'eat', 'dining', 'lunch', 'dinner', 'breakfast', 'brunch',
        'restaurant', 'restoran', 'kedai makan',
        'hotel', 'hostel', 'penginapan', 'homestay', 'resort',
        'tempat', 'place', 'location', 'lokasi', 'attraction', 'tarikan',
        'cafe', 'kafe', 'coffee', 'kopi',
        'bar', 'pub', 'club', 'nightlife',
        'shop', 'kedai', 'mall', 'shopping',
        'spa', 'massage', 'urut',
        'gym', 'fitness',
        'clinic', 'klinik', 'hospital'
    ];

    const locationIndicators = [
        'kat', 'di', 'dekat', 'near', 'around', 'dalam', 'in', 'at',
        'area', 'kawasan', 'sekitar'
    ];

    const recommendationWords = [
        'sedap', 'best', 'popular', 'famous', 'terkenal', 'recommended', 'recommend',
        'cheap', 'murah', 'affordable', 'budget',
        'good', 'bagus', 'nice', 'cantik',
        'top', 'terbaik', 'suggest', 'suggestion'
    ];

    const hasLocationKeyword = locationKeywords.some(kw => lowerMsg.includes(kw));
    const hasLocationIndicator = locationIndicators.some(li => lowerMsg.includes(li));
    const hasRecommendation = recommendationWords.some(rw => lowerMsg.includes(rw));

    const verificationWords = ['wujud', 'exist', 'betul ke', 'right?', 'real?', 'mana', 'where'];
    const hasVerification = verificationWords.some(vw => lowerMsg.includes(vw));

    const isLocationQuery = (hasLocationKeyword && (hasLocationIndicator || hasRecommendation)) ||
        (hasLocationIndicator && hasVerification);

    if (isLocationQuery) {
        console.log(`🌐 Detected location query: "${message}"`);
    }

    return isLocationQuery;
}

/**
 * Search the web using Tavily API
 */
async function searchWeb(query) {
    if (!TAVILY_API_KEY) {
        console.log('⚠️ TAVILY_API_KEY not configured - skipping web search');
        return null;
    }

    try {
        console.log(`🔍 Searching web for: "${query}"`);

        const response = await axios.post('https://api.tavily.com/search', {
            api_key: TAVILY_API_KEY,
            query: query,
            search_depth: 'basic',
            include_answer: true,
            include_raw_content: false,
            max_results: 5
        }, {
            timeout: 10000
        });

        const results = response.data;

        if (!results || !results.results || results.results.length === 0) {
            console.log('🔍 No web results found');
            return null;
        }

        console.log(`🔍 Found ${results.results.length} web results`);

        const formattedResults = results.results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.content}\n   Source: ${r.url}`
        ).join('\n\n');

        return {
            answer: results.answer || null,
            results: formattedResults,
            sources: results.results.map(r => r.url)
        };

    } catch (error) {
        console.error('🔍 Web search failed:', error.message);
        return null;
    }
}

/**
 * Append halal filter to food queries
 */
function appendHalalFilter(query) {
    const foodKeywords = ['makan', 'food', 'restaurant', 'cafe', 'warung', 'kedai', 'sarapan', 'lunch', 'dinner'];
    const isFoodQuery = foodKeywords.some(kw => query.toLowerCase().includes(kw));
    const hasHalalTerm = query.toLowerCase().includes('halal') || query.toLowerCase().includes('non-halal');

    if (isFoodQuery && !hasHalalTerm) {
        console.log(`🛡️ Auto-appending 'halal' for safety: "${query} halal"`);
        return query + " halal";
    }
    return query;
}

module.exports = {
    detectLocationQuery,
    searchWeb,
    appendHalalFilter
};
