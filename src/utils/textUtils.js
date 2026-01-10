// src/utils/textUtils.js
// Text preprocessing and autocorrection utilities

/**
 * Levenshtein distance calculation for typo detection
 */
function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Auto-correct tokens based on vocabulary
 */
function autoCorrect(tokens, wordIndex) {
    const validWords = Object.keys(wordIndex);
    return tokens.map(word => {
        if (wordIndex[word]) return word;
        if (word.length < 4) return word;

        let bestMatch = word;
        let minDist = Infinity;
        const candidates = validWords.filter(w => w.startsWith(word[0]));

        for (const candidate of candidates) {
            const dist = levenshtein(word, candidate);
            const threshold = word.length > 6 ? 2 : 1;

            if (dist <= threshold && dist < minDist) {
                minDist = dist;
                bestMatch = candidate;
            }
        }
        return bestMatch;
    });
}

/**
 * Preprocess text for model input
 */
function preprocess(text, metadata) {
    const { wordIndex, maxLen, maxVocabSize, vocabSize } = metadata;
    const vocabLimit = maxVocabSize || vocabSize || 10000;

    const cleanText = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    let tokens = cleanText.split(' ').filter(t => t.trim() !== '');
    const correctedTokens = autoCorrect(tokens, wordIndex);

    const sequence = correctedTokens.map(word => {
        const index = wordIndex[word];
        return (index !== undefined && index < vocabLimit) ? index : 1;
    }).slice(0, maxLen);

    if (sequence.length >= maxLen) {
        return sequence.slice(0, maxLen);
    }
    const pad = new Array(maxLen - sequence.length).fill(0);
    return [...pad, ...sequence];
}

module.exports = {
    levenshtein,
    autoCorrect,
    preprocess
};
