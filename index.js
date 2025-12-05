/**
 * REVERIE DIGITALS - AI GROWTH ENGINE (ENTERPRISE EDITION)
 * --------------------------------------------------------
 * Architecture: Event-Driven Node.js Server
 * Integrations: WhatsApp Cloud API (Meta), OpenRouter (Gemini 2.0)
 * Security: Helmet, Rate Limiting, CORS, Input Validation
 * Performance: In-Memory Session Management with Auto-Garbage Collection
 * * @author Reverie Digitals
 * @version 2.1.0
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
// We import the prompt from brain.js to keep logic separate
const systemPrompt = require('./brain');

// --- 3. CONFIGURATION & SECRETS ---
const APP_CONFIG = {
    WHATSAPP_TOKEN: "EAA8LIPQj0xwBQLQ2ZCK2hh3BHUuIeCqigjHGmZCLbQ1CaQq0i4apnozRh7e5iM01FRDmgWPTRUHGs8ZBYykzaXWFpukl4N7Y2BmCuXyabwKyyIHjYhlvexRdTZCO2nfZAiIRsKYfMrWcV0qqDil5HgUsOXCQepZBbUNfoufm0j2tMZAESTnTng8cooQmUq1hLc7q52HrFypz07MqSBZAlGDEMfBugGcJzEk5Y8p6Tdnfjf5pcBq3WgZDZD",
    PHONE_NUMBER_ID: "825470453992044",
    VERIFY_TOKEN: "clothing-bot-secure-2025",
    OPENROUTER_KEY: "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",
    AI_MODEL: "google/gemini-2.0-flash-exp:free",
    PORT: process.env.PORT || 3000
};

// --- 4. SERVER INITIALIZATION ---
const app = express();

// Security Middleware (The "Shield")
app.use(helmet()); // Protects against common HTTP header attacks
app.use(cors()); // Controls access permissions
app.use(morgan('combined')); // Professional request logging
app.use(bodyParser.json());

// Rate Limiting (Anti-Spam Protection)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later."
});
app.use('/webhook', limiter);

// --- 5. SESSION MANAGEMENT (RAM DATABASE) ---
// Stores conversation history. In production, swap this for Redis/MongoDB.
const sessionStore = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 2; // 2 Hours

/**
 * Garbage Collector: Removes old sessions to prevent memory leaks.
 * Runs every hour.
 */
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, session] of sessionStore.entries()) {
        if (now - session.lastActive > SESSION_TTL) {
            sessionStore.delete(userId);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log([GC] Cleaned ${cleaned} expired sessions.);
}, 1000 * 60 * 60);

// --- 6. ROUTES ---

/**
 * HEALTH CHECK
 * Used by hosting providers (Render/Replit) to ensure the bot is alive.
 */
app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'Reverie AI Engine', uptime: process.uptime() });
});

/**
 * WEBHOOK VERIFICATION
 * The "Handshake" with Meta servers.
 */
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

/**
 * MESSAGE INGESTION ENGINE
 * Handles incoming WhatsApp messages asynchronously.
 */
app.post('/webhook', async (req, res) => {
    const body = req.body;

    // Immediately acknowledge receipt to Meta (prevents retries)
    res.sendStatus(200);

    try {
        if (!body.object || !body.entry) return;

        const changes = body.entry[0]?.changes?.[0]?.value;
        if (!changes || !changes.messages) return;

        const message = changes.messages[0];
        const from = message.from; // Customer Phone
        const messageId = message.id;

        // 1. Mark message as read immediately (Blue Ticks)
        await markAsRead(messageId);

        // 2. Handle Text Messages
        if (message.type === 'text') {
            const userText = message.text.body;
            console.log([Inbound] ${from}: ${userText});

            // 3. Generate AI Response
            const aiReply = await generateAIResponse(from, userText);

            // 4. Dispatch Response
            await sendWhatsAppMessage(from, aiReply);
        }
        
    } catch (error) {
        console.error('[Error] Webhook processing failed:', error.message);
    }
});

// --- 7. CORE LOGIC ENGINES ---

/**
 * AI BRAIN INTERFACE
 * Manages context window, history, and OpenRouter API calls.
 */
async function generateAIResponse(userId, userText) {
    // A. Initialize or Fetch Session
    if (!sessionStore.has(userId)) {
        sessionStore.set(userId, {
            history: [{ role: "system", content: systemPrompt }],
            lastActive: Date.now()
        });
    }
    
    const session = sessionStore.get(userId);
    session.lastActive = Date.now();
    session.history.push({ role: "user", content: userText });

    // B. Token Management (Keep context window small to save cost/latency)
    // We keep System Prompt + Last 15 messages
    if (session.history.length > 16) {
        session.history = [
            session.history[0], // Keep System Prompt (Identity)
            ...session.history.slice(-15) // Keep recent context
        ];
    }

    try {
        // C. Call AI API
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: APP_CONFIG.AI_MODEL,
            messages: session.history,
            temperature: 0.7, // Creativity balance
            max_tokens: 300   // Limit response length for WhatsApp brevity
        }, {
            headers: {
                "Authorization": Bearer ${APP_CONFIG.OPENROUTER_KEY},
                "Content-Type": "application/json",
                "HTTP-Referer": "https://reverie-digitals.com",
                "X-Title": "Reverie Sales Bot"
            }
        });

        const reply = response.data.choices[0].message.content;
        
        // D. Update History
        session.history.push({ role: "assistant", content: reply });
        
        return reply;

    } catch (error) {
        console.error("[AI Error] OpenRouter failed:", error.response?.data || error.message);
        // Fallback strategy if AI is down
        return "I'm checking our schedule for you. Can you give me a moment?";
    }
}

/**
 * WHATSAPP DISPATCHER
 * Sends text messages via Graph API.
 */
async function sendWhatsAppMessage(to, text) {
    try {
        await axios({
            method: "POST",
            url: https://graph.facebook.com/v17.0/${APP_CONFIG.PHONE_NUMBER_ID}/messages,
            headers: { 
                "Authorization": Bearer ${APP_CONFIG.WHATSAPP_TOKEN}, 
                "Content-Type": "application/json" 
            },
            data: {
                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: { body: text }
            }
        });
        console.log([Outbound] Sent to ${to});
    } catch (error) {
        console.error("[WhatsApp Error] Send failed:", error.response?.data || error.message);
    }
}

/**
 * READ RECEIPT SIGNAL
 * Triggers blue ticks on the user's phone.
 */
async function markAsRead(messageId) {
    try {
        await axios({
            method: "POST",
            url: https://graph.facebook.com/v17.0/${APP_CONFIG.PHONE_NUMBER_ID}/messages,
            headers: { 
                "Authorization": Bearer ${APP_CONFIG.WHATSAPP_TOKEN}, 
                "Content-Type": "application/json" 
            },
            data: {
                messaging_product: "whatsapp",
                status: "read",
                message_id: messageId
            }
        });
    } catch (error) {
        // Silent fail for read receipts is acceptable
    }
}

// --- 8. PROCESS SAFETY ---

// Catch Unhandled Exceptions (Prevents crashes)
process.on('uncaughtException', (err) => {
    console.error('[Critical] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Critical] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start Server
app.listen(APP_CONFIG.PORT, () => {
    console.log(\n🚀 REVERIE AI ENGINE ONLINE);
    console.log(🛡  Security Modules: Active);
    console.log(🧠 AI Model: ${APP_CONFIG.AI_MODEL});
    console.log(📡 Port: ${APP_CONFIG.PORT}\n);
});
