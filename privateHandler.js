// ============================================================
// منطق المحادثات الخاصة (DM) فقط — إضافة الأسئلة
// الصيغة: +سؤال نص السؤال | خيار1 | خيار2 | خيار3 | رقم الإجابة (1-3)
// ============================================================
import { ADMIN_NUMBER } from './config.js';
import { addQuestion } from './storage.js';

const digits = (jid = '') => jid.split('@')[0].split(':')[0].replace(/\D/g, '');

// التحقق من أن المرسل هو المشرف المعتمد
function isAdmin(msg) {
  const jid = msg.key.remoteJid;
  // بعض الحسابات تظهر بمعرّف @lid؛ نتحقق أيضاً من رقم الهاتف الحقيقي إن توفر
  const candidates = [jid, msg.key.senderPn, msg.key.remoteJidAlt].filter(Boolean).map(digits);
  return candidates.includes(ADMIN_NUMBER);
}

export async function handlePrivateMessage(sock, msg, text) {
  const jid = msg.key.remoteJid;
  const body = text.trim();

  if (!body.startsWith('+سؤال')) return; // لا شيء آخر مطلوب في الخاص

  if (!isAdmin(msg)) {
    console.log('⛔ محاولة إضافة سؤال من غير المشرف:', jid, '(إن كان هذا رقمك فانسخ الرقم إلى ADMIN_NUMBER)');
  // return; // تجاهل صامت
  }

  const parts = body.replace('+سؤال', '').split('|').map((s) => s.trim());
  const usage =
    '⚠️ الصيغة غير صحيحة. استخدم:\n' +
    '+سؤال نص السؤال | الخيار 1 | الخيار 2 | الخيار 3 | رقم الإجابة الصحيحة (1 أو 2 أو 3)';

  if (parts.length !== 5 || parts.slice(0, 4).some((p) => !p)) {
    return sock.sendMessage(jid, { text: usage });
  }

  const correct = parseInt(parts[4], 10);
  if (![1, 2, 3].includes(correct)) {
    return sock.sendMessage(jid, { text: '⚠️ رقم الإجابة الصحيحة يجب أن يكون 1 أو 2 أو 3.\n\n' + usage });
  }

  addQuestion({ text: parts[0], options: [parts[1], parts[2], parts[3]], correct });
  return sock.sendMessage(jid, { text: '✅ تمت إضافة السؤال بنجاح إلى بنك الأسئلة' });
}
