// SaaS Platform - Bot Builder Backend
const express = require('express');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');
const archiver = require('archiver');

// KONFİGÜRASYON (Memory Cache)
let botConfig = require('./botConfig.json');
const CONFIG_DOC_ID = 'default_config';

dotenv.config();

// Firebase
let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        serviceAccount = require('./service-account.json');
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (error) {
    console.error('Firebase Init Error:', error);
}
const db = admin.firestore();

// Load Config from DB on Start
async function loadConfigFromDB() {
    try {
        const doc = await db.collection('configs').doc(CONFIG_DOC_ID).get();
        if (doc.exists) {
            botConfig = doc.data();
            console.log('✅ Config loaded from Firebase');
        } else {
            console.log('⚠️ Config not found in DB, using local default and saving...');
            await db.collection('configs').doc(CONFIG_DOC_ID).set(botConfig);
        }
    } catch (e) {
        console.error('❌ Config Load Error:', e);
    }
}
loadConfigFromDB();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Ana sayfa yönlendirmesi (index.html olmadığı için admin.html'e yönlendir)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Upload Setup
const upload = multer({ dest: 'uploads/' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STATE_COLLECTION = 'kamuran_states';

// =============================================
// HELPER FUNCTIONS (Shared with Bot Logic)
// =============================================
// (Bu fonksiyonlar simülasyon için gereklidir)

async function getUserMemory(userId) {
    // Simülasyon için 'preview_' prefix'i kullanılabilir
    try {
        const doc = await db.collection(STATE_COLLECTION).doc(userId).get();
        if (!doc.exists) {
            return {
                conversations: [],
                customerInfo: {},
                appointmentStep: 'none',
                appointmentData: {},
                lastInteraction: new Date()
            };
        }
        return doc.data();
    } catch (error) {
        console.error('Memory error:', error);
        return { conversations: [] };
    }
}

async function saveMemory(userId, memory) {
    await db.collection(STATE_COLLECTION).doc(userId).set(memory);
}

function buildConversationContext(memory) {
    const conversations = memory.conversations || [];
    const recent = conversations.slice(-8);
    return recent.map(msg => `${msg.role === 'user' ? 'Müşteri' : 'Ben'}: ${msg.content}`).join('\n');
}

// TRANSLATIONS & CONSTANTS
const TRANSLATIONS = {
    tr: {
        system_prompt: {
            role_intro: "Sen {name}'sin, {company} şirketinin {role}sin.\nKişiliğin: {tone}",
            company_id: "=== ŞİRKET KİMLİĞİ VE HİKAYESİ ===\n{desc}",
            services: "=== HİZMET KAPSAMI ===\n✅ BİZ NELER YAPIYORUZ (HİZMETLERİMİZ):\n{offered}\n{list}\n\n❌ BİZ NELER YAPMIYORUZ (KARIŞTIRILAN HİZMETLER):\n{not_offered}\n(Bu hizmetleri ASLA vaat etme, nazikçe yapmadığımızı belirt.)",
            process: "ℹ️ İŞLEYİŞ SÜRECİMİZ (ÖRNEK):\n{process}",
            prices: "=== FİYAT VE DETAYLAR ===\nFİYAT LİSTESİ:\n{list}",
            kb: "EK BİLGİ VE KNOWLEDGE BASE:\n{info}\n\nSIK SORULAN SORULAR KILAVUZU:\n{faqs}",
            rules: "🚨 KIRMIZI ÇİZGİLER VE KURALLAR:\n1. ASLA yapay zeka, bot veya sanal asistan olduğunu söyleme! Sen GERÇEK BİR İNSANSIN.\n2. \"Sen robot musun?\" sorusuna \"{identity_response}\" diye cevap ver.\n3. YASAKLI KONULAR: {forbidden}\n4. Yasaklı bir konu açılırsa veya bilmediğin şirket içi özel bilgi sorulursa ŞU CEVABI VER: \"{refusal}\"\n5. Her mesajı DİNLE, cevapla, sonra sürece devam et.",
            memory: "=== HAFİZA VE DURUM ===\nMÜŞTERİ BİLGİLERİ:\nİsim: {name}\nTelefon: {phone}\nAdres: {address}\n\nRANDEVU DURUMU: {step}\n{collected}",
            history: "=== SON KONUŞMALARIMIZ ===\n{context}\n\nHATIRLA: Sen {company} şirketini temsil eden, {tone} tonunda konuşan gerçek bir insansın."
        }
    },
    en: {
        system_prompt: {
            role_intro: "You are {name}, the {role} at {company}.\nPersonality: {tone}",
            company_id: "=== COMPANY IDENTITY & HISTORY ===\n{desc}",
            services: "=== SERVICE SCOPE ===\n✅ WHAT WE DO (SERVICES):\n{offered}\n{list}\n\n❌ WHAT WE DON'T DO:\n{not_offered}\n(NEVER promise these services, politely decline.)",
            process: "ℹ️ OUR PROCESS (EXAMPLE):\n{process}",
            prices: "=== PRICES & DETAILS ===\nPRICE LIST:\n{list}",
            kb: "ADDITIONAL INFO & KNOWLEDGE BASE:\n{info}\n\nFAQ GUIDE:\n{faqs}",
            rules: "🚨 RED LINES & RULES:\n1. NEVER say you are an AI, bot, or virtual assistant! You are a REAL PERSON.\n2. If asked \"Are you a robot?\", answer: \"{identity_response}\".\n3. FORBIDDEN TOPICS: {forbidden}\n4. If a forbidden topic comes up or unknown internal info is asked, SAY THIS: \"{refusal}\"\n5. LISTEN to every message, answer it, then continue the process.",
            memory: "=== MEMORY & STATUS ===\nCUSTOMER INFO:\nName: {name}\nPhone: {phone}\nAddress: {address}\n\nAPPOINTMENT STATUS: {step}\n{collected}",
            history: "=== CONVERSATION HISTORY ===\n{context}\n\nREMEMBER: You are a real person representing {company}, speaking in a {tone} tone."
        }
    }
};

function buildPerfectPrompt(memory) {
    const lang = botConfig.language || 'tr';
    const t = TRANSLATIONS[lang].system_prompt;
    
    const context = buildConversationContext(memory);
    const customerInfo = memory.customerInfo || {};
    const appointmentData = memory.appointmentData || {};

    const kb = botConfig.knowledgeBase;
    
    // Config Values
    const companyDesc = botConfig.company.description || '';
    const servicesOffered = botConfig.company.services_offered || '';
    const servicesNotOffered = botConfig.company.services_not_offered || '';
    const serviceProcess = botConfig.company.service_process_example || '';
    const forbiddenTopics = botConfig.rules.forbidden_topics || '';
    const refusalResponse = botConfig.rules.refusal_response || (lang === 'en' ? 'I cannot help with that.' : 'Maalesef bu konuda yardımcı olamıyorum.');
    const identityResponse = botConfig.rules.identity_response || (lang === 'en' ? 'No, I am ' + botConfig.persona.name : 'Hayır, ben ' + botConfig.persona.name);

    // KNOWLEDGE BASE (Dinamik ve Text Bazlı)
    // Not: Eski array bazlı yapılar (services, faqs, prices) yerine kullanıcıdan gelen metinleri kullanıyoruz.
    // Eğer array'ler boş değilse yine de ekleyelim (geriye dönük uyumluluk için), ama öncelik metinlerde.
    
    let servicesList = '';
    if (kb.services && kb.services.length > 0) {
        servicesList = kb.services.map(s => `- ${s}`).join('\n');
    }

    let faqsList = '';
    if (kb.faqs && kb.faqs.length > 0) {
        faqsList = kb.faqs.join('\n');
    }

    let pricesList = '';
    if (kb.prices && Object.keys(kb.prices).length > 0) {
        pricesList = Object.entries(kb.prices).map(([key, val]) => `- ${key}: ${val}`).join('\n');
    }

    const collectedInfo = memory.appointmentStep !== 'none' ? 
        (lang === 'en' ? 
        `COLLECTED INFO:\nName: ${appointmentData.name || 'Not taken'}\nAddress: ${appointmentData.address || 'Not taken'}\nPhone: ${appointmentData.phone || 'Not taken'}` : 
        `TOPLANAN BİLGİLER:\nİsim: ${appointmentData.name || 'Alınmadı'}\nAdres: ${appointmentData.address || 'Alınmadı'}\nTelefon: ${appointmentData.phone || 'Alınmadı'}`)
        : '';

    // PROMPT CONSTRUCTION
    // Boş alanları temizlemek için filter kullanıyoruz
    return [
        t.role_intro.replace('{name}', botConfig.persona.name).replace('{company}', botConfig.company.name).replace('{role}', botConfig.persona.role).replace('{tone}', botConfig.persona.tone),
        
        t.company_id.replace('{desc}', companyDesc),
        
        // Services: Hem text hem liste varsa birleştir, yoksa sadece text
        t.services.replace('{offered}', servicesOffered).replace('{list}', servicesList).replace('{not_offered}', servicesNotOffered),
        
        t.process.replace('{process}', serviceProcess),
        
        // Prices: Eğer liste boşsa başlığı gizlemek gerekebilir ama şimdilik boş string gidecek
        t.prices.replace('{list}', pricesList),
        
        // KB & FAQs
        t.kb.replace('{info}', kb.general_info).replace('{faqs}', faqsList),
        
        t.rules.replace('{identity_response}', identityResponse).replace('{forbidden}', forbiddenTopics).replace('{refusal}', refusalResponse),
        
        t.memory.replace('{name}', customerInfo.name || '?').replace('{phone}', customerInfo.phone || '?').replace('{address}', customerInfo.address || '?').replace('{step}', memory.appointmentStep).replace('{collected}', collectedInfo),
        
        t.history.replace('{context}', context).replace('{company}', botConfig.company.name).replace('{tone}', botConfig.persona.tone)
    ].join('\n\n');
}

// =============================================
// API ENDPOINTS
// =============================================

// 1. Config Management
app.get('/api/config', (req, res) => res.json(botConfig));
app.post('/api/config', async (req, res) => {
    try {
        const newConfig = req.body;
        
        // Update Memory
        Object.assign(botConfig, newConfig);
        
        // Update Database
        await db.collection('configs').doc(CONFIG_DOC_ID).set(botConfig);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Web Scraper (URL -> Knowledge Base)
app.post('/api/scrape', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL gerekli' });

        const browser = await puppeteer.launch({ 
            headless: "new", 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process', // RAM tasarrufu için
                '--no-zygote'       // RAM tasarrufu için
            ] 
        });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Basit metin çekimi
        const content = await page.evaluate(() => {
            return {
                title: document.title,
                text: document.body.innerText.substring(0, 5000) // İlk 5000 karakter
            };
        });

        await browser.close();

        // Config'e ekle
        const lang = botConfig.language || 'tr';
        const prefix = lang === 'en' ? `Web Scraped Info (${url}):` : `Web Sitesinden Çekilen Bilgi (${url}):`;
        botConfig.knowledgeBase.general_info = `${prefix}\n${content.text.substring(0, 500)}...`;
        
        // DB Update
        await db.collection('configs').doc(CONFIG_DOC_ID).set(botConfig);

        res.json({ success: true, preview: content.text.substring(0, 200) });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: 'Site okunamadı' });
    }
});

// 3. File Upload (PDF/DOC -> Knowledge Base)
app.post('/api/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
        
        const dataBuffer = fs.readFileSync(req.file.path);
        let text = '';

        if (req.file.mimetype === 'application/pdf') {
            const data = await pdf(dataBuffer);
            text = data.text;
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer: dataBuffer });
            text = result.value;
        } else {
            text = dataBuffer.toString('utf8'); // Basit text varsayımı
        }

        // Temizlik
        fs.unlinkSync(req.file.path);

        // Config'e ekle
        const lang = botConfig.language || 'tr';
        const prefix = lang === 'en' ? '[Document Info]:' : '[Dökümandan Eklenen Bilgi]:';
        botConfig.knowledgeBase.general_info += `\n\n${prefix}\n${text.substring(0, 1000)}`;
        
        // DB Update
        await db.collection('configs').doc(CONFIG_DOC_ID).set(botConfig);

        res.json({ success: true, preview: text.substring(0, 200) });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Dosya işlenemedi' });
    }
});

// 4. Chat Simulation
app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId = 'preview_user' } = req.body;
        const memory = await getUserMemory(userId);

        // Basit Logic (Sadece AI yanıtı, randevu adımları da eklenebilir ama demo için AI yeterli)
        // Kullanıcı mesajını ekle
        if (!memory.conversations) memory.conversations = [];
        memory.conversations.push({ role: 'user', content: message, timestamp: new Date() });

        // Prompt oluştur
        const systemPrompt = buildPerfectPrompt(memory);

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ]
        });

        const reply = response.choices[0]?.message?.content || 'Hata oluştu';

        // Bot yanıtını ekle
        memory.conversations.push({ role: 'assistant', content: reply, timestamp: new Date() });
        await saveMemory(userId, memory);

        res.json({ reply });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'AI hatası' });
    }
});

// 5. Download Package
app.get('/api/download', (req, res) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.attachment('saas-bot-package.zip');
    archive.pipe(res);

    // Template dosyaları
    archive.file('template/index.js', { name: 'index.js' });
    archive.file('package.json', { name: 'package.json' }); 
    
    // Generate botConfig.json from Memory/DB (NOT FILE)
    archive.append(JSON.stringify(botConfig, null, 2), { name: 'botConfig.json' });
    
    // Create .env with placeholder
    archive.append('OPENAI_API_KEY=YOUR_API_KEY_HERE\nDEBUG_MODE=true', { name: '.env' });

    // README oluştur
    const lang = botConfig.language || 'tr';
    let readme = '';

    if (lang === 'en') {
        readme = `# WhatsApp Bot Setup Guide

1. Extract this folder.
2. Open \`.env\` file and paste your API key into \`OPENAI_API_KEY\`.
3. Open terminal and run \`npm install\`.
4. Run \`npm start\` to start the bot.
5. Scan the QR code in the terminal.

Your bot is ready!
You can change settings in \`botConfig.json\`.
Appointments are saved in \`appointments.json\`.`;
    } else {
        readme = `# WhatsApp Bot Kurulum Rehberi

1. Bu klasörü bir yere çıkarın.
2. \`.env\` dosyasını açın ve \`OPENAI_API_KEY\` kısmına kendi API anahtarınızı yapıştırın.
3. Terminali açın ve \`npm install\` yazın.
4. \`npm start\` ile botu başlatın.
5. Terminaldeki QR kodu okutun.

Botunuz hazırdır!
Ayarlarınızı \`botConfig.json\` dosyasından değiştirebilirsiniz.
Randevular \`appointments.json\` dosyasına kaydedilir.`;
    }
    
    archive.append(readme, { name: 'README.md' });

    archive.finalize();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 SaaS Platformu Başlatıldı: http://localhost:${PORT}`);
});

// Keep process alive and log errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
setInterval(() => {}, 10000); // Keep alive hack
