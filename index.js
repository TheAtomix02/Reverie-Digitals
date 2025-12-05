/**
 * REVERIE DIGITALS - AI GROWTH ENGINE (GOOGLE EDITION)
 * --------------------------------------------------------
 * Architecture: Event-Driven Node.js Server
 * Integrations: WhatsApp Cloud API (Meta), Google Gemini API (Direct)
 * Security: Helmet, Rate Limiting, CORS, Input Validation
 * Performance: In-Memory Session Management with Auto-Garbage Collection
 * Reliability: Multi-Model Failover System (Unstoppable Mode)
 * * @author Reverie Digitals
 * @version 3.1.0 (Google Direct - Multi-Model Failover)
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
    // WhatsApp Token (Starts with EAAM...)
    WHATSAPP_TOKEN: "EAAMRCGZCFeK8BQOLZBfGmrfhDVAC8gQk55bEacluGWKrtXem6TiaLSs1AUvZBxBa6S5ybyLMUnL5fWyW1TlU26jTnZAX2zD2bB8W9fEZBnZAORzl7iyUtTUseu5eKVaodtDVizuiTMfwyMnLwvRwcqS5DBKtcD8sqXH7jhGUW571hpRHHROXaPRt5RjRTopPMVUtCK7MDN5z3c5wXHu4DDUZC4ZBhZAigmOXS0LbsX02V9nL4xhoLD5xKLIJOvko173eYkGRXfTMDIFFz0FBSZBK4B",
    PHONE_NUMBER_ID: "825470453992044",
    VERIFY_TOKEN: "clothing-bot-secure-2025",
    
    // ⚠️ PASTE YOUR GOOGLE KEY HERE (Starts with AIza...)
    GOOGLE_API_KEY: "AIzaSyAov26okhg1JpQH2lNUaPPumWWhab2fR30", 
    
    // FAILOVER LIST: The bot will try these in order until one works.
    GOOGLE_MODELS: [
        "gemini-1.5-flash", // Fastest & Cheapest (Primary)
        "gemini-1.5-pro",   // Smarter, higher limits
        "gemini-1.0-pro",   // Old reliable backup
        "gemini-2.0-flash-exp" // Experimental bleeding edge
    ],
    
    PORT: process.env.PORT || 3000
};

// --- 4. SERVER INITIALIZATION ---
const app = express();
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
const SESSION_TTL = 1000 * 60 * 60 * 2; 

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
    res.status(200).json({ status: 'online', service: 'Reverie AI Engine (Google Failover)', uptime: process.uptime() });
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

            // Generate AI Response (Google with Failover)
            const aiReply = await generateGoogleResponse(from, userText);
            await sendWhatsAppMessage(from, aiReply);
        }
        
    } catch (error) {
        console.error('[Error] Webhook processing failed:', error.message);
    }
});

// --- 7. CORE LOGIC ENGINES (GOOGLE GEMINI DIRECT) ---

async function generateGoogleResponse(userId, userText) {
    // Safety Check
    if (APP_CONFIG.GOOGLE_API_KEY.includes("PASTE")) {
        console.error("❌ ERROR: Google API Key is missing in index.js");
        return "System Error: API Key missing.";
    }

    if (!sessionStore.has(userId)) {
        sessionStore.set(userId, {
            history: [], 
            lastActive: Date.now()
        });
    }
    
    const session = sessionStore.get(userId);
    session.lastActive = Date.now();

    // Add user message to local history (Simplified for Google)
    session.history.push({ role: "user", parts: [{ text: userText }] });

    // Keep history short (Last 10 turns)
    if (session.history.length > 10) {
        session.history = session.history.slice(-10);
    }

    // --- MULTI-MODEL FAILOVER LOOP ---
    for (const modelName of APP_CONFIG.GOOGLE_MODELS) {
        try {
            console.log("🤖 Attempting generation with: " + modelName);
            
            // Construct the payload for Google Gemini
            const payload = {
                contents: [
                    { role: "user", parts: [{ text: systemPrompt + "\n\nUser says: " + userText }] }
                ]
            };

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${APP_CONFIG.GOOGLE_API_KEY}`,
                payload,
                { headers: { "Content-Type": "application/json" } }
            );

            const reply = response.data.candidates[0].content.parts[0].text;
            
            // Success! We found a working model.
            console.log("✅ Success with: " + modelName);
            
            // Add AI reply to history
            session.history.push({ role: "model", parts: [{ text: reply }] });
            
            return reply;

        } catch (error) {
            console.warn(`⚠️ Model ${modelName} Failed: ${error.response?.data?.error?.message || error.message}`);
            // If it failed, the loop continues to the next model in the list automatically.
            // If it was the last model, the loop ends.
        }
    }

    // If we get here, ALL models failed.
    console.error("❌ CRITICAL: All AI Models failed.");
    return "I am currently receiving extremely high traffic. Please try again in 1 minute.";
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
    console.log('\n🚀 REVERIE AI ENGINE ONLINE (v3.1.0 Multi-Model Failover)');
    console.log('🛡️  Security Modules: Active');
    console.log('🧠 AI Strategy: Rolling Failover');
    console.log('📡 Port: ' + APP_CONFIG.PORT + '\n');
});
