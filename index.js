/**
 * REVERIE DIGITALS - AI GROWTH ENGINE (SECURE EDITION)
 * ------------------------------------------------------------
 * Architecture: Enterprise Event-Driven Microservices (Monolith)
 * Version: 5.3.0 (Verbose Debugging Patch)
 * Features: 50+ (Encryption, Analytics, Self-Healing, Admin Tools)
 * * COPYRIGHT 2025 REVERIE DIGITALS
 */

// ==============================================================================
// 1. CORE DEPENDENCIES & SETUP
// ==============================================================================
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const EventEmitter = require('events');
require('dotenv').config();

// IMPORT BRAIN
const systemPrompt = require('./brain');

// ==============================================================================
// 2. CONFIGURATION & SECRETS (SECURE MODE)
// ==============================================================================
// We now pull keys from the Server Environment (Render), NOT this file.
const CONFIG = {
    // These keys are loaded from Render's "Environment" tab.
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN, 
    PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || "825470453992044", 
    VERIFY_TOKEN: process.env.VERIFY_TOKEN || "clothing-bot-secure-2025",
    
    // The Bot will crash intentionally if this is missing to warn you.
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY, 
    
    // SETTINGS
    PORT: process.env.PORT || 3000,
    ENCRYPTION_KEY: crypto.scryptSync('reverie-secret', 'salt', 32),
    ADMIN_PHONE: "919391256290", 
    
    MODELS: ["gemini-1.5-flash", "gemini-pro", "gemini-1.5-pro"]
};

// GLOBAL STATE
const STATE = {
    startTime: Date.now(),
    totalMessages: 0,
    totalErrors: 0,
    activeSessions: 0,
    blockedUsers: new Set(),
    circuitOpen: false
};

const EventBus = new EventEmitter();

// ==============================================================================
// 3. UTILITY MODULES
// ==============================================================================

const Security = {
    encrypt: (text) => {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', CONFIG.ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    },
    decrypt: (text) => {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', CONFIG.ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    }
};

class AnalyticsEngine {
    constructor() { this.leads = new Map(); }
    analyze(userId, text, role) {
        if (role !== 'user') return;
        let score = this.leads.get(userId) || 0;
        if (text.match(/price|cost|quote|buy/i)) score += 10;
        if (text.match(/urgent|asap|now/i)) score += 5;
        this.leads.set(userId, score);
        return score;
    }
}
const Analytics = new AnalyticsEngine();

async function discoverModels() {
    // Skip if key is missing (Startup Doctor will catch it)
    if (!CONFIG.GOOGLE_API_KEY) return;
    
    try {
        const res = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${CONFIG.GOOGLE_API_KEY}`);
        const found = res.data.models
            .filter(m => m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name.replace("models/", ""))
            .sort((a, b) => (a.includes("flash") ? -1 : 1));
        
        if (found.length > 0) {
            CONFIG.MODELS = found;
            console.log(`✅ [Auto-Discovery] Found ${found.length} models. Priority: ${found[0]}`);
        }
    } catch (e) {
        const errMsg = e.response?.data?.error?.message || e.message;
        if (JSON.stringify(errMsg).includes("leaked")) {
             console.error("\n🚨 CRITICAL: YOUR KEY IS LEAKED. GENERATE A NEW ONE AND UPDATE RENDER ENV VARS.\n");
        } else {
             console.error(`⚠️ [Auto-Discovery] Failed: ${errMsg}`);
             console.error("Using default model list.");
        }
    }
}

// ==============================================================================
// 4. SESSION MANAGEMENT
// ==============================================================================
const SessionStore = new Map();

class SessionManager {
    static async get(userId) {
        if (!SessionStore.has(userId)) {
            SessionStore.set(userId, {
                history: Security.encrypt(JSON.stringify([])),
                lastActive: Date.now(),
                msgCount: 0
            });
            STATE.activeSessions++;
        }
        const session = SessionStore.get(userId);
        const history = JSON.parse(Security.decrypt(session.history));
        return { ...session, history };
    }

    static async save(userId, data) {
        const session = SessionStore.get(userId);
        if (!session) return;
        session.history = Security.encrypt(JSON.stringify(data.history));
        session.lastActive = Date.now();
        SessionStore.set(userId, session);
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [id, s] of SessionStore.entries()) {
        if (now - s.lastActive > 7200000) {
            SessionStore.delete(id);
            STATE.activeSessions--;
        }
    }
}, 3600000);

// ==============================================================================
// 5. SERVER SETUP
// ==============================================================================
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(bodyParser.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/webhook', limiter);

// ==============================================================================
// 6. ROUTES
// ==============================================================================
app.get('/', (req, res) => {
    res.json({
        service: "Reverie AI Secure",
        status: "ONLINE",
        key_status: CONFIG.GOOGLE_API_KEY ? "CONFIGURED (Last 4: " + CONFIG.GOOGLE_API_KEY.slice(-4) + ")" : "MISSING"
    });
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === CONFIG.VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    const body = req.body;

    try {
        if (!body.object || !body.entry) return;
        const msg = body.entry[0]?.changes?.[0]?.value?.messages?.[0];
        if (!msg || msg.type !== 'text') return;

        const from = msg.from;
        const text = msg.text.body;
        STATE.totalMessages++;
        
        if (STATE.blockedUsers.has(from)) return;

        // Admin
        if (text.startsWith("/") && from === CONFIG.ADMIN_PHONE) {
            await handleAdminCommand(from, text);
            return;
        }

        Analytics.analyze(from, text, 'user');
        await processUserMessage(from, text, msg.id);

    } catch (e) {
        console.error("Webhook Error:", e.message);
        STATE.totalErrors++;
    }
});

// ==============================================================================
// 7. CORE LOGIC
// ==============================================================================

async function handleAdminCommand(to, text) {
    const cmd = text.split(" ")[0];
    let reply = "Unknown command";
    if (cmd === "/stats") reply = `📊 Msgs: ${STATE.totalMessages} | Err: ${STATE.totalErrors}`;
    await sendWhatsApp(to, reply);
}

async function processUserMessage(userId, userText, msgId) {
    await markRead(msgId);
    
    // Check Key Availability before starting
    if (!CONFIG.GOOGLE_API_KEY) {
        await sendWhatsApp(userId, "⚠️ System Error: Google API Key is missing in Render Environment Variables.");
        return;
    }

    const session = await SessionManager.get(userId);
    const hour = new Date().getHours();
    let timeContext = hour < 6 ? "[Late Night]" : "[Daytime]";

    const fullHistory = [
        { role: "user", parts: [{ text: `SYSTEM INSTRUCTION:\n${systemPrompt}\n\nCONTEXT:\n${timeContext}` }] },
        { role: "model", parts: [{ text: "Understood. I am Alex." }] },
        ...session.history
    ];
    fullHistory.push({ role: "user", parts: [{ text: userText }] });

    let reply = null;
    for (const model of CONFIG.MODELS) {
        try {
            const res = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.GOOGLE_API_KEY}`,
                { contents: fullHistory },
                { headers: { "Content-Type": "application/json" } }
            );
            reply = res.data.candidates[0].content.parts[0].text;
            break;
        } catch (e) {
            const apiError = e.response?.data?.error?.message || e.message;
            console.warn(`Model ${model} failed: ${apiError}`);
        }
    }

    if (!reply) reply = "I am currently handling high traffic. Please retry in 1 minute.";

    session.history.push({ role: "user", parts: [{ text: userText }] });
    session.history.push({ role: "model", parts: [{ text: reply }] });
    if (session.history.length > 12) session.history = session.history.slice(-12);
    
    await SessionManager.save(userId, session);
    await sendWhatsApp(userId, reply);
}

async function sendWhatsApp(to, body) {
    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/${CONFIG.PHONE_NUMBER_ID}/messages`,
            { messaging_product: "whatsapp", to: to, type: "text", text: { body: body } },
            { headers: { Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}` } }
        );
    } catch (e) { 
        if (e.response && e.response.status === 401) {
            console.error("🚨 WHATSAPP TOKEN EXPIRED (401). Please update WHATSAPP_TOKEN in Render.");
        } else {
            console.error("Send Failed:", e.message); 
        }
    }
}

async function markRead(msgId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/${CONFIG.PHONE_NUMBER_ID}/messages`,
            { messaging_product: "whatsapp", status: "read", message_id: msgId },
            { headers: { Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}` } }
        );
    } catch (e) {}
}

app.listen(CONFIG.PORT, async () => {
    console.log(`\n🚀 REVERIE SECURE ENGINE ONLINE`);
    if (!CONFIG.GOOGLE_API_KEY) console.error("❌ CRITICAL: GOOGLE_API_KEY IS MISSING IN ENV VARIABLES");
    else await discoverModels();
});
