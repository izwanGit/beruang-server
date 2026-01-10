// src/services/ai/visionService.js
// Gemini 2.5 Flash Vision Service (Google AI)

const axios = require('axios');
const { GOOGLE_API_KEY } = require('../../config/env');

/**
 * Scan receipt image and extract transaction details
 */
async function scanReceipt(base64Image) {
    const prompt = `
    Analyze this receipt image and extract details in STRICT JSON format.
    
    Extraction Logic:
    1. Merchant: Look for the business/shop/stall name at the very TOP of the receipt.
    2. Description: Create a SHORT, classifier-friendly summary:
       - Combine the FOOD TYPE or BRAND with a simple category word.
       - Examples: "Ayam Gepuk Meal", "McDonalds Burger", "Starbucks Coffee", "7-Eleven Snacks", "Grocery Shopping", "Pharmacy Medicine".
       - Do NOT list every item (e.g., avoid "Ayam Bumbu Crispy, Sambal Extra Pedas, Teh O Ais").
       - Do NOT use overly generic terms alone (e.g., avoid just "Meal" or "Food").
       - The description should be 2-4 words max.

    JSON Structure:
    {
      "amount": number,
      "merchant": "string",
      "description": "string" (2-4 word summary combining type/brand + category),
      "date": "YYYY-MM-DD"
    }
    
    Context Rules:
    - Works for ANY receipt (restaurants, groceries, pharmacies, retail, etc).
    - Return ONLY the JSON. No markdown backticks.
  `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;

    const response = await axios.post(url, {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: "image/jpeg", data: base64Image } }
            ]
        }]
    });

    const aiText = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    let result = JSON.parse(aiText);

    // Defensive: If AI returns an array or unexpected structure, extract the first item
    if (Array.isArray(result)) result = result[0];
    if (result.transactions && Array.isArray(result.transactions)) result = result.transactions[0];

    return result;
}

/**
 * Parse bulk text data into transactions
 */
async function parseBulkData(text) {
    const prompt = `
    Analyze the following text and extract a list of transactions. 
    The text might be messy (from Excel, Notes, or Chat).
    Return a JSON object with a "transactions" key containing an array of objects:
    {
      "transactions": [
        {
          "name": "string (Description)",
          "amount": number (Amount spent),
          "date": "YYYY-MM-DD",
          "category": "needs" | "wants" | "savings"
        }
      ]
    }
    Rules:
    1. Correct common typos.
    2. If date is missing, omit it or use current date if mentioned.
    3. For category, follow 50/30/20 rule: essentials (needs), lifestyle (wants), savings/debt (savings).
    4. RETURN ONLY JSON.
    
    Text to parse:
    "${text}"
  `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;

    const response = await axios.post(url, {
        contents: [{
            parts: [{ text: prompt }]
        }]
    });

    const aiText = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(aiText);
}

module.exports = {
    scanReceipt,
    parseBulkData
};
