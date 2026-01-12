// src/services/rag/onlineDetector.js
// Online Query Detection - The "Knowledge Router"
// Determines if a query should trigger Grok :online mode (Web Search) or stay Offline (RAG/Analysis)

/**
 * Smart Router for Internet Access
 * Priority 1: SAFETY (Private Data) -> Force OFFLINE
 * Priority 2: DISCOVERY (External Info) -> Force ONLINE
 * Default: OFFLINE (Analysis/Chat)
 */
function detectOnlineQuery(message) {
    const lowerMsg = message.toLowerCase();

    // 1. SAFETY LAYER: Exclusions
    // If these words appear, we assume the user wants privacy/internal data, regardless of other keywords.
    const privacyKeywords = [
        'my spending', 'my budget', 'my transaction', 'my money', 'analyze me',
        'my expense', 'my income', 'my savings', 'review my', 'check my',
        'track my', 'log my', 'add expense', 'add income', 'add transaction',
        'how much did i', 'how much have i', 'am i', 'do i have',
        'in my app', 'in beruang'
    ];

    const isPrivateQuery = privacyKeywords.some(kw => lowerMsg.includes(kw));

    if (isPrivateQuery) {
        console.log(`🛡️ Privacy Guard: Forced OFFLINE for "${message}"`);
        return false;
    }

    // 2. DISCOVERY LAYER: General Online Triggers
    // Words that imply need for external, dynamic, or real-time information
    const generalOnlineKeywords = [
        // Time-sensitive
        'current', 'latest', 'today', 'news', 'update', 'forecast',
        '2024', '2025', '2026', 'now', 'live',

        // Information/Facts
        'price', 'harga', 'cost', 'fee', 'fare', 'rate', 'kadar',
        'dividend', 'dividenden', 'interest', 'bunga',
        'ceo', 'founder', 'history', 'sejarah', 'who is', 'biography',
        'meaning', 'definition', 'maksud', 'what is', 'apa itu',
        'review', 'testimony', 'feedback', // (Generic reviews, not "review my")

        // External Links
        'website', 'url', 'link', 'site', 'instagram', 'facebook', 'twitter', 'tiktok', 'contact',
        'address', 'alamat', 'phone', 'tel', 'email'
    ];

    const hasOnlineKeyword = generalOnlineKeywords.some(kw => lowerMsg.includes(kw));

    // 2.5 ACTION LAYER: General Action Patterns (For Unknown/Viral Places)
    // Catches "How to order X", "Menu at Y", "Review of Z" without knowing X, Y, Z
    const actionPatterns = [
        'how to order', 'cara order', 'how to buy', 'cara beli',
        'menu for', 'menu at', 'menu dekat', 'menu di',
        'price of', 'price at', 'harga di', 'harga dekat',
        'review', 'feedback', 'comment', 'komen', 'viral',
        'location of', 'direction to', 'lokasi', 'waze to'
    ];

    const hasActionPattern = actionPatterns.some(pattern => lowerMsg.includes(pattern));

    // 2.6 LIFESTYLE LAYER: Shopping & Retail (Expanded)
    const shoppingKeywords = [
        // Items
        'shoe', 'kasut', 'sneaker', 'heel', 'boot',
        'clothes', 'clothing', 'baju', 'shirt', 'pants', 'trousers', 'seluar', 'dress',
        'bag', 'handbag', 'beg', 'wallet', 'purse',
        'gadget', 'phone', 'iphone', 'samsung', 'laptop', 'computer',
        // Brands (Examples) -> "Brand" keyword covers generic queries, specific brands caught here
        'uniqlo', 'zara', 'h&m', 'padini', 'nike', 'adidas', 'apple', 'sony',
        // Vehicles
        'car', 'kereta', 'motor', 'motorcycle', 'vehicle',
        'perodua', 'proton', 'honda', 'toyota', 'myvi', 'axia', 'bezza', 'saga', 'x50', 'x70',
        // General
        'brand', 'jenama', 'fashion', 'fesyen', 'retail', 'outlet', 'store'
    ];

    const hasShoppingKeyword = shoppingKeywords.some(kw => lowerMsg.includes(kw));

    // 3. LEGACY LAYER: Detailed Lifestyle/Location Detection (Preserved)
    const foodKeywords = [
        'nasi', 'ayam', 'ikan', 'mee', 'mihun', 'kuey teow', 'roti', 'naan',
        'satay', 'rendang', 'lemak', 'goreng', 'bakar', 'penyet', 'gepuk',
        'laksa', 'cendol', 'rojak', 'char kuey', 'tom yam', 'tomyam',
        'western', 'burger', 'pizza', 'steak', 'sushi', 'ramen',
        'mamak', 'nasi kandar', 'briyani', 'biryani', 'chapati'
    ];

    const locationKeywords = [
        'makanan', 'makan', 'food', 'eat', 'dining', 'lunch', 'dinner', 'breakfast', 'brunch',
        'restaurant', 'restoran', 'kedai makan',
        'hotel', 'hostel', 'penginapan', 'homestay', 'resort',
        'tempat', 'place', 'location', 'lokasi', 'attraction', 'tarikan',
        'cafe', 'kafe', 'coffee', 'kopi',
        'bar', 'pub', 'club', 'nightlife',
        'shop', 'kedai', 'mall', 'shopping',
        'spa', 'massage', 'urut', 'gym', 'fitness', 'clinic', 'klinik', 'hospital',
        'cinema', 'gsc', 'tgv', 'movie', 'wayang', 'bowling', 'karaoke'
    ];

    const restaurantPatterns = [
        'warung', 'gerai', 'stall', 'dapur', 'kitchen',
        'restoran', 'restaurant', 'cafe', 'kopitiam',
        'mama', 'mak', 'pak', 'abang', 'kakak', 'cik'
    ];

    const locationIndicators = [
        'kat', 'di', 'dekat', 'near', 'around', 'dalam', 'in', 'at',
        'area', 'kawasan', 'sekitar', 'road', 'jalan', 'taman', 'bandar'
    ];

    const recommendationWords = [
        'sedap', 'best', 'popular', 'famous', 'terkenal', 'recommended', 'recommend',
        'cheap', 'murah', 'affordable', 'budget',
        'good', 'bagus', 'nice', 'cantik', 'top', 'terbaik', 'suggest', 'suggestion'
    ];

    const operationalWords = [
        'bukak', 'buka', 'tutup', 'open', 'close', 'closed',
        'operating', 'hours', 'jam', 'masa', 'waktu',
        'ada ke', 'ada tak', 'wujud', 'exist'
    ];

    const verificationWords = ['wujud', 'exist', 'betul ke', 'right?', 'real?', 'mana', 'where', 'kat mana'];

    const hasFoodKeyword = foodKeywords.some(kw => lowerMsg.includes(kw));
    const hasLocationKeyword = locationKeywords.some(kw => lowerMsg.includes(kw));
    const hasRestaurantPattern = restaurantPatterns.some(rp => lowerMsg.includes(rp));
    const hasLocationIndicator = locationIndicators.some(li => lowerMsg.includes(li));
    const hasRecommendation = recommendationWords.some(rw => lowerMsg.includes(rw));
    const hasOperational = operationalWords.some(ow => lowerMsg.includes(ow));
    const hasVerification = verificationWords.some(vw => lowerMsg.includes(vw));

    const isLocationQuery =
        ((hasFoodKeyword || hasRestaurantPattern) && hasLocationIndicator) ||
        ((hasFoodKeyword || hasRestaurantPattern) && hasOperational) ||
        (hasLocationKeyword && (hasLocationIndicator || hasRecommendation)) ||
        (hasRestaurantPattern && (hasLocationIndicator || hasOperational || hasVerification)) ||
        (hasLocationIndicator && hasVerification);

    // 4. FINAL DECISION
    const shouldGoOnline = hasOnlineKeyword || isLocationQuery || hasActionPattern || hasShoppingKeyword;

    if (shouldGoOnline) {
        console.log(`🌐 Knowledge Router: Routing ONLINE for "${message}"`);
    }

    return shouldGoOnline;
}

module.exports = {
    detectOnlineQuery
};
