// src/services/rag/locationDetector.js
// Location Query Detection - Used to trigger Grok :online mode

/**
 * Detect if a message is asking about locations/places/restaurants/hotels
 * This triggers Grok's built-in web search (:online mode)
 */
function detectLocationQuery(message) {
    const lowerMsg = message.toLowerCase();

    // Malaysian food names
    const foodKeywords = [
        'nasi', 'ayam', 'ikan', 'mee', 'mihun', 'kuey teow', 'roti', 'naan',
        'satay', 'rendang', 'lemak', 'goreng', 'bakar', 'penyet', 'gepuk',
        'laksa', 'cendol', 'rojak', 'char kuey', 'tom yam', 'tomyam',
        'western', 'burger', 'pizza', 'steak', 'sushi', 'ramen',
        'mamak', 'nasi kandar', 'briyani', 'biryani', 'chapati'
    ];

    // General location/place keywords
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

    // Restaurant/eatery patterns
    const restaurantPatterns = [
        'warung', 'gerai', 'stall', 'dapur', 'kitchen',
        'restoran', 'restaurant', 'cafe', 'kopitiam',
        'mama', 'mak', 'pak', 'abang', 'kakak', 'cik'
    ];

    // Location indicators
    const locationIndicators = [
        'kat', 'di', 'dekat', 'near', 'around', 'dalam', 'in', 'at',
        'area', 'kawasan', 'sekitar', 'road', 'jalan', 'taman', 'bandar'
    ];

    // Recommendation words
    const recommendationWords = [
        'sedap', 'best', 'popular', 'famous', 'terkenal', 'recommended', 'recommend',
        'cheap', 'murah', 'affordable', 'budget',
        'good', 'bagus', 'nice', 'cantik',
        'top', 'terbaik', 'suggest', 'suggestion'
    ];

    // Operational queries (asking if open/closed)
    const operationalWords = [
        'bukak', 'buka', 'tutup', 'open', 'close', 'closed',
        'operating', 'hours', 'jam', 'masa', 'waktu',
        'ada ke', 'ada tak', 'wujud', 'exist'
    ];

    // Verification/existence queries
    const verificationWords = ['wujud', 'exist', 'betul ke', 'right?', 'real?', 'mana', 'where', 'kat mana'];

    // Check all conditions
    const hasFoodKeyword = foodKeywords.some(kw => lowerMsg.includes(kw));
    const hasLocationKeyword = locationKeywords.some(kw => lowerMsg.includes(kw));
    const hasRestaurantPattern = restaurantPatterns.some(rp => lowerMsg.includes(rp));
    const hasLocationIndicator = locationIndicators.some(li => lowerMsg.includes(li));
    const hasRecommendation = recommendationWords.some(rw => lowerMsg.includes(rw));
    const hasOperational = operationalWords.some(ow => lowerMsg.includes(ow));
    const hasVerification = verificationWords.some(vw => lowerMsg.includes(vw));

    // Detection logic:
    // 1. Food/restaurant + location indicator (e.g., "nasi ayam dekat tapah")
    // 2. Food/restaurant + operational query (e.g., "mamak bukak dak?")
    // 3. Location keyword + recommendation (e.g., "kedai makan sedap")
    // 4. Restaurant pattern + any indicator (e.g., "warung mak linda")
    // 5. Location indicator + verification (e.g., "dekat mana restoran tu")
    const isLocationQuery =
        ((hasFoodKeyword || hasRestaurantPattern) && hasLocationIndicator) ||
        ((hasFoodKeyword || hasRestaurantPattern) && hasOperational) ||
        (hasLocationKeyword && (hasLocationIndicator || hasRecommendation)) ||
        (hasRestaurantPattern && (hasLocationIndicator || hasOperational || hasVerification)) ||
        (hasLocationIndicator && hasVerification);

    if (isLocationQuery) {
        console.log(`🌐 Detected location query: "${message}"`);
    }

    return isLocationQuery;
}

module.exports = {
    detectLocationQuery
};
