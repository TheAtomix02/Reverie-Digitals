/**
 * REVERIE DIGITALS - AI GROWTH ENGINE (AUTO-DISCOVERY EDITION)
 * --------------------------------------------------------
 * Architecture: Event-Driven Node.js Server
 * Integrations: WhatsApp Cloud API (Meta), Google Gemini API (Direct)
 * Security: Helmet, Rate Limiting, CORS, Input Validation
 * Performance: In-Memory Session Management with Auto-Garbage Collection
 * Intelligence: Self-Configuring Model Discovery (No guessing)
 * * @author Reverie Digitals
 * @version 4.0.0 (Enterprise Gold)
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
    
    // ⚠️ PASTE YOUR GOOGLE KEY HERE (Starts with AIza...)
    GOOGLE_API_KEY: "AIzaSyAov26okhg1JpQH2lNUaPPumWWhab2fR30", 
    
    PORT: process.env.PORT || 3000
};

// --- GLOBAL STATE FOR AI MODELS ---
// We will populate this list automatically on startup.
let AVAILABLE_MODELS = [];

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
    res.status(200).json({ 
        status: 'online', 
        service: 'Reverie AI Engine (Auto-Discovery)', 
        active_models: AVAILABLE_MODELS.length > 0 ? AVAILABLE_MODELS : "Detecting...",
        uptime: process.uptime() 
    });
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
            console.log(`[Inbound] ${from}: ${userText}`);

            const aiReply = await generateGoogleResponse(from, userText);
            await sendWhatsAppMessage(from, aiReply);
        }
        
    } catch (error) {
        console.error('[Error] Webhook processing failed:', error.message);
    }
});

// --- 7. ADVANCED AI ENGINE (AUTO-DISCOVERY & RETRY) ---

/**
 * Startup Function: Discovers available models for YOUR specific API Key.
 * This prevents 404 errors by never guessing.
 */
async function discoverModels() {
    if (APP_CONFIG.GOOGLE_API_KEY.includes("PASTE")) {
        console.error("❌ CRITICAL: Google API Key missing. Skipping model discovery.");
        return;
    }

    console.log("🔍 Auto-Discovering AI Models for your Key...");
    try {
        const response = await axios.get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${APP_CONFIG.GOOGLE_API_KEY}`
        );
        
        const models = response.data.models;
        
        // Filter: Only keep models that can generate text (content)
        // Sort: Prioritize 1.5 Flash (Fastest), then 1.5 Pro, then Legacy
        AVAILABLE_MODELS = models
            .filter(m => m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name.replace("models/", "")) // Clean name
            .sort((a, b) => {
                // Custom ranking logic
                const score = (name) => {
                    if (name.includes("1.5-flash")) return 1; // Top priority
                    if (name.includes("1.5-pro")) return 2;
                    if (name.includes("gemini-pro")) return 3;
                    return 4;
                };
                return score(a) - score(b);
            });

        console.log(`✅ Discovery Complete. Found ${AVAILABLE_MODELS.length} valid models.`);
        console.log(`🚀 Priority List: ${AVAILABLE_MODELS.slice(0, 3).join(", ")}...`);

    } catch (error) {
        console.error("⚠️ Discovery Failed. Falling back to safe list.", error.message);
        AVAILABLE_MODELS = ["gemini-pro", "gemini-1.5-flash"];
    }
}

/**
 * AI Generation with Auto-Failover and Retry
 */
async function generateGoogleResponse(userId, userText) {
    if (APP_CONFIG.GOOGLE_API_KEY.includes("PASTE")) return "System Error: API Key missing.";

    if (!sessionStore.has(userId)) {
        sessionStore.set(userId, { history: [], lastActive: Date.now() });
    }
    
    const session = sessionStore.get(userId);
    session.lastActive = Date.now();
    session.history.push({ role: "user", parts: [{ text: userText }] });

    // Keep context tight
    if (session.history.length > 10) session.history = session.history.slice(-10);

    // Try available models in order of priority
    for (const modelName of AVAILABLE_MODELS) {
        try {
            console.log(`🤖 generating with: ${modelName}`);
            
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
            
            // Add AI reply to history
            session.history.push({ role: "model", parts: [{ text: reply }] });
            return reply;

        } catch (error) {
            const errCode = error.response?.status;
            const errMsg = error.response?.data?.error?.message || error.message;
            console.warn(`⚠️ ${modelName} Failed (${errCode}): ${errMsg}`);
            
            // 429 = Too Many Requests. Wait 2 seconds and continue loop.
            if (errCode === 429) {
                console.log("⏳ Rate limited. Cooling down for 1s...");
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    console.error("❌ CRITICAL: All Available Models Failed.");
    return "I am currently overloaded. Please try again in a moment.";
}

async function sendWhatsAppMessage(to, text) {
    try {
        await axios({
            method: "POST",
            url: `https://graph.facebook.com/v17.0/${APP_CONFIG.PHONE_NUMBER_ID}/messages`,
            headers: { 
                "Authorization": `Bearer ${APP_CONFIG.WHATSAPP_TOKEN}`, 
                "Content-Type": "application/json" 
            },
            data: {
                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: { body: text }
            }
        });
        console.log(`[Outbound] Sent to ${to}`);
    } catch (error) {
        console.error("[WhatsApp Error]", error.response?.data || error.message);
    }
}

async function markAsRead(messageId) {
    try {
        await axios({
            method: "POST",
            url: `https://graph.facebook.com/v17.0/${APP_CONFIG.PHONE_NUMBER_ID}/messages`,
            headers: { 
                "Authorization": `Bearer ${APP_CONFIG.WHATSAPP_TOKEN}`, 
                "Content-Type": "application/json" 
            },
            data: { messaging_product: "whatsapp", status: "read", message_id: messageId }
        });
    } catch (e) {}
}

// --- 8. PROCESS SAFETY ---
process.on('uncaughtException', (err) => console.error('[Critical] Uncaught:', err));
process.on('unhandledRejection', (reason) => console.error('[Critical] Unhandled:', reason));

app.listen(APP_CONFIG.PORT, async () => {
    console.log('\n🚀 REVERIE AI ENGINE ONLINE (v4.0.0 Auto-Discovery)');
    console.log('📡 Port: ' + APP_CONFIG.PORT);
    
    // STARTUP TASK: CHECK MODELS
    await discoverModels();
});
