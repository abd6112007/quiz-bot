// ============================================================
// نقطة الدخول: الاتصال بواتساب (Multi-Device) وتوزيع الأحداث
// ============================================================
import * as baileysNs from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { AUTH_DIR } from './config.js';
import { loadData, rememberName } from './storage.js';
import { handleGroupMessage, handleReaction } from './groupHandler.js';
import { handlePrivateMessage } from './privateHandler.js';

// توافق مع اختلاف طريقة تصدير المكتبة بين الإصدارات
const B = baileysNs.default?.useMultiFileAuthState ? baileysNs.default : baileysNs;
const makeWASocket = typeof B.default === 'function' ? B.default : B.makeWASocket;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = B;

loadData();

// استخراج نص الرسالة (مع فك أغلفة الرسائل المؤقتة)
function getText(msg) {
  let m = msg.message;
  if (!m) return '';
  m = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m;
  return m.conversation || m.extendedTextMessage?.text || '';
}

async function start() {
  // حفظ بيانات الجلسة في مجلد: يكفي مسح QR مرة واحدة، ويعمل البوت بعدها بدون هاتف متصل
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('📱 امسح رمز QR من واتساب > الأجهزة المرتبطة:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') console.log('✅ البوت متصل ويعمل');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ تم تسجيل الخروج. احذف مجلد', AUTH_DIR, 'وأعد التشغيل لمسح QR جديد.');
      } else {
        console.log('⚠️ انقطع الاتصال، إعادة المحاولة...');
        start();
      }
    }
  });

  // ---------- الرسائل النصية: نوزّع بين المجموعات والخاص ----------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!jid || jid === 'status@broadcast') continue;

        // تذكّر اسم المرسل لعرضه في النتائج
        const sender = msg.key.participant || jid;
        rememberName(sender, msg.pushName);

        const text = getText(msg);
        if (!text) continue;

        if (jid.endsWith('@g.us')) {
          await handleGroupMessage(sock, msg, text); // منطق المجموعات
        } else {
          await handlePrivateMessage(sock, msg, text); // منطق الخاص
        }
      } catch (err) {
        console.error('خطأ أثناء معالجة رسالة:', err);
      }
    }
  });

  // ---------- التفاعلات (Reactions) ----------
  sock.ev.on('messages.reaction', (events) => {
    for (const ev of events) {
      try {
        handleReaction(sock, ev);
      } catch (err) {
        console.error('خطأ أثناء معالجة تفاعل:', err);
      }
    }
  });
}

start();


import http from 'http';
http.createServer((req, res) => res.end('Bot is Alive!')).listen(process.env.PORT || 3000);
