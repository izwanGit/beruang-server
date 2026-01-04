# 🐻 Beruang Server

<div align="center">

![Version](https://img.shields.io/badge/version-2.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-purple.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

**🚀 Backend API Server for Beruang Personal Finance App**

*Intelligent Chatbot • Receipt Scanning • RAG-Powered Responses*

[Features](#-features) • [Installation](#-installation) • [API](#-api-endpoints) • [Architecture](#-architecture) • [Configuration](#-configuration)

</div>

---

## 📋 Overview

Beruang Server is the backend API powering the [Beruang](https://github.com/izwanGit/Beruang) personal finance app. It combines local AI models with cloud-based LLMs to provide intelligent financial assistance.

### 🎯 Key Capabilities

| Feature | Technology | Description |
|---------|------------|-------------|
| **Smart Chatbot** | Grok (OpenRouter) | Context-aware financial advice |
| **Intent Classification** | TensorFlow.js | Routes queries to appropriate handlers |
| **Transaction Categorization** | TensorFlow.js | Auto-categorizes expenses (50/30/20) |
| **Receipt Scanning** | Gemini Vision | Extract merchant, amount, category from receipts |
| **RAG System** | Local JSON | Expert tips & app manual context |

---

## ✨ Features

### 💬 Intelligent Chatbot
- **Hybrid AI Architecture** - Local intent detection + Cloud LLM
- **Context Injection** - User profile, budget data, transaction history
- **Expert Tips RAG** - Retrieves relevant financial tips
- **Widget Generation** - Creates visualizable spending summaries

### 📸 Receipt Scanning
- **Gemini Vision AI** - Powered by Google's latest vision model
- **Smart Extraction** - Merchant name, amount, date, category
- **Bulk Import** - Process multiple transactions at once
- **Malaysian Context** - Trained on local receipt formats

### 🧠 Local AI Models
- **Intent Model** - 99.41% accuracy, 56 categories
- **Transaction Model** - 15 subcategories, Needs/Wants/Savings
- **OOD Detection** - Out-of-distribution query handling

### 📊 Budget Context
- **Real-time Budget RAG** - Current month spending breakdown
- **Historical Analysis** - Multi-month spending patterns
- **50/30/20 Tracking** - Automatic budget category allocation

---

## 🚀 Installation

### Prerequisites
- Node.js ≥ 18.0.0
- npm or yarn
- OpenRouter API key (for Grok)
- Google Gemini API key (for receipt scanning)

### Setup

```bash
# Clone the repository
git clone https://github.com/izwanGit/beruang-server.git
cd beruang-server

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys
```

### Environment Variables

```env
# Required
OPENROUTER_API_KEY=your_openrouter_key_here
GOOGLE_GENAI_API_KEY=your_gemini_key_here

# Optional
PORT=3000
NODE_ENV=production
```

### Running the Server

```bash
# Development
npm run dev

# Production
npm start

# With PM2
pm2 start server.js --name beruang-server
```

---

## 🔌 API Endpoints

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "models": {
    "transaction": true,
    "intent": true
  },
  "uptime": 12345
}
```

---

### 💬 Chat Endpoint

```http
POST /chat
Content-Type: application/json
```

**Request Body:**
```json
{
  "message": "How much did I spend yesterday?",
  "userId": "user123",
  "chatHistory": [...],
  "transactions": [...],
  "userProfile": {
    "name": "Ahmad",
    "monthlyIncome": 3500
  }
}
```

**Response:**
```json
{
  "response": "Based on your transactions yesterday...",
  "intent": "COMPLEX_ADVICE",
  "source": "grok",
  "widgetData": {
    "t": "d",
    "date": "Jan 3, 2026",
    "items": [...]
  }
}
```

---

### 📡 Chat Stream (SSE)

```http
POST /chat/stream
Content-Type: application/json
```

**Request Body:** Same as `/chat`

**Response:** Server-Sent Events stream
```
data: {"chunk": "Based on your"}
data: {"chunk": " transactions..."}
data: [DONE]
```

---

### 📸 Receipt Scanning

```http
POST /scan-receipt
Content-Type: multipart/form-data
```

**Request:**
```
image: <file>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "merchant": "Grab Food",
    "amount": 25.50,
    "date": "2026-01-04",
    "category": "Wants",
    "subcategory": "Food_Delivery",
    "description": "Nasi Lemak Ayam"
  }
}
```

---

### 📦 Bulk Import

```http
POST /bulk-import
Content-Type: application/json
```

**Request Body:**
```json
{
  "text": "Jan 1: Groceries RM50, Petrol RM80, Netflix RM45"
}
```

**Response:**
```json
{
  "transactions": [
    { "description": "Groceries", "amount": 50, "category": "Needs" },
    { "description": "Petrol", "amount": 80, "category": "Needs" },
    { "description": "Netflix", "amount": 45, "category": "Wants" }
  ]
}
```

---

### 🏷️ Transaction Categorization

```http
POST /predict
Content-Type: application/json
```

**Request Body:**
```json
{
  "text": "Grab Food nasi lemak"
}
```

**Response:**
```json
{
  "category": "Wants",
  "subcategory": "Food_Delivery",
  "confidence": 0.95
}
```

---

### 🎯 Intent Prediction

```http
POST /predict-intent
Content-Type: application/json
```

**Request Body:**
```json
{
  "text": "what did i spend yesterday"
}
```

**Response:**
```json
{
  "intent": "COMPLEX_ADVICE",
  "confidence": 1.0,
  "source": "grok"
}
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Beruang Server                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Express    │    │   Multer     │    │   CORS       │  │
│  │   Router     │    │   (Upload)   │    │   Handler    │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘  │
│         │                   │                               │
│         ▼                   ▼                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Request Handler                    │   │
│  └──────────────────────────┬──────────────────────────┘   │
│                             │                               │
│         ┌───────────────────┼───────────────────┐          │
│         ▼                   ▼                   ▼          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │    Intent    │    │  Transaction │    │   Receipt    │  │
│  │    Model     │    │    Model     │    │   Scanner    │  │
│  │ (TensorFlow) │    │ (TensorFlow) │    │   (Gemini)   │  │
│  └──────┬───────┘    └──────────────┘    └──────────────┘  │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Intent Router (56 Categories)           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   Local     │  │    GROK     │  │   Garbage   │  │   │
│  │  │  Response   │  │   (Cloud)   │  │   Filter    │  │   │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘  │   │
│  └──────────────────────────┼──────────────────────────┘   │
│                             │                               │
│                             ▼                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    RAG Context                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │  Expert     │  │   Budget    │  │    App      │  │   │
│  │  │   Tips      │  │    Data     │  │   Manual    │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
beruang-server/
├── 📂 model_intent/          # Intent classification model
│   ├── model.json
│   ├── weights.bin
│   └── metadata.json
├── 📂 model_transaction/     # Transaction categorization model
│   ├── model.json
│   └── weights.bin
├── 📄 server.js              # Main Express server
├── 📄 responses.json         # Local response patterns
├── 📄 expert_tips.json       # Financial advice database
├── 📄 package.json           # Dependencies
├── 📄 Dockerfile             # Container configuration
└── 📄 .env                   # Environment variables
```

---

## 🧠 AI System Instruction

The chatbot operates under a carefully crafted system instruction:

```
You are Beruang Assistant, a laid-back finance pal in the Beruang app.
"Beruang" means bear in Malay—giving cozy, no-nonsense vibes.

Mission: Assist young adults (18-30) in personal finance management 
using the 50/30/20 rule.

Style:
- Malaysia Vibe: RM, local examples like Perodua or Proton
- Direct & Short: Concise answers
- Casual Buddy Tone: Friendly, not preachy

Response Flow:
1. App Questions → Use APP MANUAL first
2. Budget Questions → Use provided budget data
3. Direct Queries → Answer straight
4. Greetings → Simple reply
5. Off-Topic → Redirect nicely
```

---

## 📊 Intent Categories

The intent model routes queries to 56 categories:

| Category Type | Examples | Handler |
|--------------|----------|---------|
| **NAV_*** | "go to expenses", "open profile" | Local Response |
| **HELP_*** | "how to add income", "how to save" | Local Response |
| **DEF_*** | "what is inflation", "define KWSP" | Local Response |
| **COMPLEX_ADVICE** | "should I invest", "check my balance" | GROK API |
| **GARBAGE** | "asdfgh", random text | Filtered |

---

## 🔧 Configuration

### Model Loading

```javascript
// On server startup
async function loadModels() {
  transactionModel = await tf.loadLayersModel('file://./model_transaction/model.json');
  intentModel = await tf.loadLayersModel('file://./model_intent/model.json');
  extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
}
```

### RAG Context Building

```javascript
// Expert tips retrieval
const tips = getRelevantTips(userMessage, k=3);

// Budget context formatting
const budgetContext = formatBudgetContext(transactions, userProfile);

// Combined prompt
const augmentedPrompt = `
${SYSTEM_INSTRUCTION}

EXPERT TIPS:
${tips.join('\n')}

BUDGET DATA:
${budgetContext}

USER MESSAGE: ${userMessage}
`;
```

---

## 🐳 Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t beruang-server .
docker run -p 3000:3000 --env-file .env beruang-server
```

---

## 📜 License

This project is part of a Final Year Project (FYP) at **Universiti Teknologi MARA (UiTM)**.

**Developed by:** Muhammad Izwan bin Ahmad  
**Supervised by:** Dr. Khairulliza binti Ahmad Salleh

---

## 🔗 Related Repositories

- **[Beruang App](https://github.com/izwanGit/Beruang)** - React Native mobile app
- **[Beruang AI Backend](https://github.com/izwanGit/beruang-ai-backend)** - ML training & visualization

---

<div align="center">

**Made with 🐻 by Izwan**

*"Beruang" means bear in Malay – sounds like "Ber-wang" (has money)!*

</div>
