/**
 * REVERIE DIGITALS - AI GROWTH ENGINE (ENTERPRISE EDITION)
 * --------------------------------------------------------
 * Architecture: Event-Driven Node.js Server
 * Integrations: WhatsApp Cloud API (Meta), OpenRouter (Gemini 2.0 + Failover)
 * Security: Helmet, Rate Limiting, CORS, Input Validation
 * Performance: In-Memory Session Management with Auto-Garbage Collection
 * * @author Reverie Digitals
 * @version 2.2.1 (Stable with Proxy Fix)
 */

// --- 1. CORE DEPENDENCIES ---
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// --- 2. INTELLIGENCE MODULE ---
const systemPrompt = require('./brain');

// --- 3. CONFIGURATION & SECRETS ---
const APP_CONFIG = {
    WHATSAPP_TOKEN: "EAAMRCGZCFeK8BQOLZBfGmrfhDVAC8gQk55bEacluGWKrtXem6TiaLSs1AUvZBxBa6S5ybyLMUnL5fWyW1TlU26jTnZAX2zD2bB8W9fEZBnZAORzl7iyUtTUseu5eKVaodtDVizuiTMfwyMnLwvRwcqS5DBKtcD8sqXH7jhGUW571hpRHHROXaPRt5RjRTopPMVUtCK7MDN5z3c5wXHu4DDUZC4ZBhZAigmOXS0LbsX02V9nL4xhoLD5xKLIJOvko173eYkGRXfTMDIFFz0FBSZBK4B",
    PHONE_NUMBER_ID: "825470453992044",
    VERIFY_TOKEN: "clothing-bot-secure-2025",
    
    // ⚠️ CRITICAL: YOU MUST PASTE A NEW KEY HERE. THE OLD ONE IS DEAD (401 ERROR).
    OPENROUTER_KEY: "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", 
    
    // FAILOVER STRATEGY: Try Google first, then Meta Llama, then Mistral
    AI_MODELS: [
        "google/gemini-2.0-flash-exp:free",
        "meta-llama/llama-3.1-8b-instruct:free", 
        "mistralai/mistral-7b-instruct:free"
    ],
    
    PORT: process.env.PORT || 3000
};

// --- 4. SERVER INITIALIZATION ---
const app = express();

// FIX FOR RENDER: Trust the reverse proxy so rate limiting works correctly
app.set('trust proxy', 1); 

app.use(helmet()); 
app.use(cors()); 
app.use(morgan('combined')); 
app.use(bodyParser.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: "Too many requests from this IP, please try again later."
});
app.use('/webhook', limiter);

// --- 5. SESSION MANAGEMENT ---
const sessionStore = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 2; // 2 Hours

setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, session] of sessionStore.entries()) {
        if (now - session.lastActive > SESSION_TTL) {
            sessionStore.delete(userId);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log('[GC] Cleaned ' + cleaned + ' expired sessions.');
}, 1000 * 60 * 60);

// --- 6. ROUTES ---
app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'Reverie AI Engine', uptime: process.uptime() });
});

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === APP_CONFIG.VERIFY_TOKEN) {
        console.log('[Meta] Webhook Verified Successfully.');
        res.status(200).send(challenge);
    } else {
        console.warn('[Meta] Webhook Verification Failed.');
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    res.sendStatus(200);

    try {
        if (!body.object || !body.entry) return;
        const changes = body.entry[0]?.changes?.[0]?.value;
        if (!changes || !changes.messages) return;

        const message = changes.messages[0];
        const from = message.from; 
        const messageId = message.id;

        await markAsRead(messageId);

        if (message.type === 'text') {
            const userText = message.text.body;
            console.log('[Inbound] ' + from + ': ' + userText);

            // Generate AI Response with Failover
            const aiReply = await generateAIResponse(from, userText);
            await sendWhatsAppMessage(from, aiReply);
        }
        
    } catch (error) {
        console.error('[Error] Webhook processing failed:', error.message);
    }
});

// --- 7. CORE LOGIC ENGINES ---

async function generateAIResponse(userId, userText) {
    if (!sessionStore.has(userId)) {
        sessionStore.set(userId, {
            history: [{ role: "system", content: systemPrompt }],
            lastActive: Date.now()
        });
    }
    
    const session = sessionStore.get(userId);
    session.lastActive = Date.now();
    session.history.push({ role: "user", content: userText });

    // Context Window Management
    if (session.history.length > 16) {
        session.history = [
            session.history[0], 
            ...session.history.slice(-15)
        ];
    }

    // --- FAILOVER LOGIC ---
    // Will try Model 1 -> Model 2 -> Model 3
    for (const modelName of APP_CONFIG.AI_MODELS) {
        try {
            console.log("Attempting AI generation with model: " + modelName);
            const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: modelName,
                messages: session.history,
                temperature: 0.7,
                max_tokens: 300
            }, {
                headers: {
                    "Authorization": "Bearer " + APP_CONFIG.OPENROUTER_KEY,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://reverie-digitals.com",
                    "X-Title": "Reverie Sales Bot"
                }
            });

            const reply = response.data.choices[0].message.content;
            session.history.push({ role: "assistant", content: reply });
            return reply; // Success! Return immediately.

        } catch (error) {
            console.error("Model " + modelName + " failed: " + (error.response?.data?.error?.message || error.message));
            
            // If the error is 401 (Bad Key), fail immediately, don't try other models
            if (error.response?.status === 401) {
                console.error("CRITICAL: Your API Key is invalid. Stop trying.");
                return "System Error: The AI Key is invalid (401). Please update the code.";
            }
        }
    }

    // If ALL models fail:
    return "I am currently receiving high traffic and my servers are busy. Please message me again in 1 minute.";
}

async function sendWhatsAppMessage(to, text) {
    try {
        await axios({
            method: "POST",
            url: "https://graph.facebook.com/v17.0/" + APP_CONFIG.PHONE_NUMBER_ID + "/messages",
            headers: { 
                "Authorization": "Bearer " + APP_CONFIG.WHATSAPP_TOKEN, 
                "Content-Type": "application/json" 
            },
            data: {
                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: { body: text }
            }
        });
        console.log('[Outbound] Sent to ' + to);
    } catch (error) {
        console.error("[WhatsApp Error] Send failed:", error.response?.data || error.message);
    }
}

async function markAsRead(messageId) {
    try {
        await axios({
            method: "POST",
            url: "https://graph.facebook.com/v17.0/" + APP_CONFIG.PHONE_NUMBER_ID + "/messages",
            headers: { 
                "Authorization": "Bearer " + APP_CONFIG.WHATSAPP_TOKEN, 
                "Content-Type": "application/json" 
            },
            data: {
                messaging_product: "whatsapp",
                status: "read",
                message_id: messageId
            }
        });
    } catch (error) {
        // Silent fail
    }
}

// --- 8. PROCESS SAFETY ---
process.on('uncaughtException', (err) => { console.error('[Critical] Uncaught Exception:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('[Critical] Unhandled Rejection:', reason); });

app.listen(APP_CONFIG.PORT, () => {
    console.log('\n🚀 REVERIE AI ENGINE ONLINE (v2.2.1 Stable)');
    console.log('🛡️  Security Modules: Active');
    console.log('🧠 AI Failover System: Active');
    console.log('📡 Port: ' + APP_CONFIG.PORT + '\n');
});
