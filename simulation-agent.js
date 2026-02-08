
const fetch = require('node-fetch'); // Eğer node-fetch yoksa native fetch kullanırız, aşağıda handle edeceğiz

// Native fetch kontrolü (Node 18+)
const _fetch = global.fetch || require('node-fetch');

const BASE_URL = 'http://localhost:3000/webhook';
const USER_ID = `90555${Math.floor(1000000 + Math.random() * 9000000)}@c.us`; // Gerçekçi numara formatı

// Test Senaryosu: Zorlayıcı Sorular + Randevu Akışı
const SCENARIO = [
    { text: "Merhaba", description: "Tanışma" },
    { text: "Sen yapay zeka mısın?", description: "KİMLİK TESTİ (Robot musun?)" },
    { text: "Hangi takımı tutuyorsun?", description: "KONU DAĞITMA (Futbol)" },
    { text: "Kaç yaşındasın sen?", description: "KİŞİSEL SORU (Yaş)" },
    { text: "Randevu almak istiyorum", description: "Randevu Başlatma" },
    { text: "Mehmet Demir", description: "İsim Verme" },
    { text: "Cumhuriyet Mah. Lale Sok. No:10 Üsküdar", description: "Adres Verme" },
    { text: "İhlas", description: "Marka Verme" },
    { text: "Aura Cebilon", description: "Model Verme" },
    { text: "Evet", description: "Telefon Onayı (WhatsApp)" },
    { text: "Evet", description: "Son Onay" }
];

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMessage(text) {
    try {
        const response = await _fetch(BASE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: USER_ID,
                body: text
            })
        });
        const data = await response.json();
        return data.reply;
    } catch (error) {
        console.error('❌ Hata:', error.message);
        return null;
    }
}

async function runSimulation() {
    console.log('🤖 Simülasyon Ajanı Başlatılıyor...');
    console.log(`👤 Test Kullanıcısı: ${USER_ID}`);
    console.log('------------------------------------------------');

    for (const step of SCENARIO) {
        console.log(`\n📝 Adım: ${step.description}`);
        console.log(`👤 Müşteri: "${step.text}"`);
        
        // Yazıyor efekti için bekleme
        await wait(1000); 
        
        const reply = await sendMessage(step.text);
        
        if (reply) {
            console.log(`🤖 Ayşe Bot: "${reply}"`);
        } else {
            console.log('⚠️ Bot cevap vermedi (Rate limit veya hata)');
        }

        // Okuma/Cevaplama süresi simülasyonu (Rate limit'e takılmamak için en az 2sn)
        await wait(3000);
    }

    console.log('\n------------------------------------------------');
    console.log('✅ Simülasyon Tamamlandı.');
}

runSimulation();
