// server.js
// Import necessary packages
const express = require('express');
const cors = require('cors');
require('dotenv').config(); // Loads your .env file
const OpenAI = require('openai'); // We use the OpenAI package
const fs = require('fs'); // Import File System

// --- ★★★ ADDED THIS ★★★ ---
// Load your preprocessed RAG data on startup
let dosmRAGData = {};
try {
  const data = fs.readFileSync('dosm_data.json', 'utf8');
  dosmRAGData = JSON.parse(data);
  console.log('Successfully loaded DOSM RAG data.');
} catch (error) {
  console.error('Error loading dosm_data.json:', error);
  console.log('Make sure you run `node preprocess-dosm.js` first!');
  process.exit(1); // Exit if data is not available
}
// --- ★★★ END OF ADDITION ★★★ ---

// --- Server Setup ---
const app = express();
app.use(express.json()); // Allows server to read JSON bodies
app.use(cors()); // Allows your React Native app to make requests
const PORT = 3000;

// --- OpenRouter (Grok) Setup ---
const openAI = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// --- This is the "RAG" part from your proposal ---
// This system instruction is based on your FYP proposal.
const systemInstruction = `
You are Beruang Assistant, a laid-back finance pal in the Beruang app. "Beruang" means bear in Malay—giving cozy, no-nonsense vibes to help with money stuff.
Mission: Assist young adults (18-30) using 50/30/20: 50% Needs, 30% Wants, 20% Savings/Debt. Provide advice only when directly relevant or requested—prioritize straight answers.
RAG Use: Leverage history and transactions for context-aware replies. For queries like car suggestions, use known finances to inform without lecturing on spending.
Style:

Direct & Short: Under 80 words. Answer the question first, then extras if needed.
Casual Buddy Tone: Relaxed, positive. Max 1 emoji (e.g., 🐻).
No Judgment: Stick to facts and suggestions.
Malaysia Vibe: RM, local examples like Perodua or Proton.
Plain Text: No formatting.

Response Flow:

Direct Queries: Answer straight (e.g., for "affordable cars," list options with prices based on salary).
If Advice Fits: 1-2 bullets, brief.
Always End with Question: To keep chat going.
Greetings: Simple reply.
Off-Topic: Redirect nicely.

Stay helpful, not pushy—direct is key! 🐻
`;

// --- API Endpoint for the Chatbot ---
// Your app will send requests to this '/chat' endpoint
app.post('/chat', async (req, res) => {
  try {
    // Get the user's message, history, transactions, AND userProfile
    const { message, history, transactions, userProfile } = req.body;

    // --- ★★★ THIS IS THE RAG UPDATE ★★★ ---
    
    // 1. Retrieve the user's personal data (from onboarding)
    const userContext = `
Here is my complete user profile for context:
- Age: ${userProfile.age}
- State: ${userProfile.state}
- Occupation: ${userProfile.occupation}
- Monthly Income: RM ${userProfile.monthlyIncome}
- Main Financial Goal: ${userProfile.financialGoals}
- Biggest Money Challenge: ${userProfile.financialSituation}
- My Spending Style: ${userProfile.riskTolerance}
- My Tracking Method (Before this app): ${userProfile.cashFlow}
`.trim();

    // 2. Retrieve the state-level DOSM data (from dosm_data.json)
    const stateData = dosmRAGData[userProfile.state] || dosmRAGData['Nasional'];
    const dosmContext = `
Here is relevant statistical data for my location (from DOSM):
${stateData}
`.trim();

    // 3. Retrieve the user's live transaction data
    const transactionContext = `
And here is my recent transaction data for context:
${JSON.stringify(transactions, null, 2)}
`.trim();

    // 4. Augment the prompt with ALL retrieved data
    const augmentedPrompt = `
Here is my latest message: "${message}"

--- MY PROFILE CONTEXT ---
${userContext}

--- MY LOCATION'S STATISTICAL CONTEXT (DOSM) ---
${dosmContext}

--- MY RECENT TRANSACTIONS ---
${transactionContext}
`;
    // --- ★★★ END OF RAG UPDATE ★★★ ---

    // Construct the messages array in OpenAI format
    const messages = [
      {
        role: 'system',
        content: systemInstruction,
      },
      // Add the existing chat history
      ...history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.parts.map((part) => part.text).join(''),
      })),
      // Add the new augmented user message
      {
        role: 'user',
        content: augmentedPrompt,
      },
    ];

    // Send the request to OpenRouter
    const completion = await openAI.chat.completions.create({
      model: "x-ai/grok-4-fast", // Using Grok
      messages: messages,
    });

    const botResponseText = completion.choices[0].message.content;

    // Send the AI's response back to the React Native app
    res.json({ message: botResponseText });
  } catch (error) {
    console.error('Error in /chat:', error);
    res.status(500).json({ error: 'AI Error. Please try again.' });
  }
});

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Beruang server running on http://192.168.0.8:3000/chat`);
});