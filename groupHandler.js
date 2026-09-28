// ============================================================
// منطق المجموعات (Groups) فقط — منفصل تماماً عن المحادثات الخاصة
// ============================================================
import { ADMIN_NUMBER, REQUIRE_ADMIN_IN_GROUP, HEARTS, POINTS } from './config.js';
import {
  getData, getSession, setSession, deleteSession, newSession, saveData,
} from './storage.js';

// ---------- أدوات مساعدة ----------
const digits = (jid = '') => jid.split('@')[0].split(':')[0].replace(/\D/g, '');

// إزالة محرف التنويع (U+FE0F) حتى تتطابق ❤ مع ❤️ مهما كانت الصيغة القادمة من واتساب
const normEmoji = (e = '') => e.replace(/\uFE0F/g, '').trim();

function displayName(jid) {
  const name = getData().names[jid];
  return name ? `${name} (@${digits(jid)})` : `@${digits(jid)}`;
}

// هل المرسل مشرف؟ (مشرف المجموعة أو رقم المشرف المعتمد)
async function isAllowed(sock, groupId, senderJid) {
  if (!REQUIRE_ADMIN_IN_GROUP) return true;
  if (digits(senderJid) === ADMIN_NUMBER) return true;
  try {
    const meta = await sock.groupMetadata(groupId);
    const p = meta.participants.find(
      (x) => digits(x.id) === digits(senderJid) || (x.phoneNumber && digits(x.phoneNumber) === digits(senderJid)),
    );
    return !!p?.admin;
  } catch {
    return false;
  }
}

// ---------- تنسيق السؤال بالقلوب الملونة ----------
function formatQuestion(q, number) {
  const lines = q.options.map((opt, i) => `${HEARTS[i]}  ${opt}`);
  return (
    `❓ *السؤال رقم ${number}*\n\n${q.text}\n\n${lines.join('\n')}\n\n` +
    `👆 تفاعل (React) على هذه الرسالة بالقلب المطابق للإجابة الصحيحة.\n` +
    `الأسرع يحصل على 3 نقاط، ثم 2، ثم 1 ⚡`
  );
}

// اختيار سؤال عشوائي لم يُطرح في هذه الجلسة
function pickQuestion(session) {
  const pool = getData().questions.filter((q) => !session.usedIds.includes(q.id));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// إرسال سؤال وتسجيل رسالته كـ "السؤال الحالي"
async function askQuestion(sock, groupId, session, intro) {
  const q = pickQuestion(session);
  if (!q) {
    await sock.sendMessage(groupId, {
      text: '📚 انتهت جميع الأسئلة في بنك الأسئلة! اكتب *انتهت المسابقة* لإعلان الفائزين.',
    });
    session.acceptingAnswers = false;
    setSession(groupId, session);
    return;
  }
  session.usedIds.push(q.id);
  session.currentQuestionId = q.id;
  session.answers = [];
  session.acceptingAnswers = true;

  const sent = await sock.sendMessage(groupId, {
    text: `${intro}\n\n${formatQuestion(q, session.usedIds.length)}`,
  });
  // هذا المعرّف هو المفتاح: أي تفاعل على رسالة أخرى يُتجاهل
  session.questionMsgId = sent.key.id;
  setSession(groupId, session);
}

// ---------- الأوامر النصية داخل المجموعة ----------
export async function handleGroupMessage(sock, msg, text) {
  const groupId = msg.key.remoteJid;
  const sender = msg.key.participant || msg.participant;
  const cmd = text.trim();

  const COMMANDS = ['نبدأ المسابقة', 'التقييم', 'السؤال التالي', 'انتهت المسابقة'];
  if (!COMMANDS.includes(cmd)) return;

  if (!(await isAllowed(sock, groupId, sender))) {
    return sock.sendMessage(groupId, { text: '⚠️ هذا الأمر للمشرفين فقط.' }, { quoted: msg });
  }

  const session = getSession(groupId);

  // ===== نبدأ المسابقة =====
  if (cmd === 'نبدأ المسابقة') {
    if (session?.active) {
      return sock.sendMessage(groupId, { text: 'المسابقة قائمة بالفعل 🌙 اكتب *السؤال التالي* للمتابعة.' });
    }
    if (!getData().questions.length) {
      return sock.sendMessage(groupId, { text: 'لا توجد أسئلة في البنك بعد. أضِف أسئلة عبر المحادثة الخاصة للبوت.' });
    }
    const s = newSession();
    setSession(groupId, s);
    const intro =
      '🌙 *بسم الله نبدأ مسابقتنا الدينية* 🌙\n' +
      'نسأل الله أن ينفعنا بما نتعلم ويجعلها في ميزان حسناتنا. ' +
      'شاركونا بحماس، والجائزة الكبرى الأجر والفائدة إن شاء الله 🤍';
    return askQuestion(sock, groupId, s, intro);
  }

  // بقية الأوامر تحتاج جلسة نشطة
  if (!session?.active) {
    return sock.sendMessage(groupId, { text: 'لا توجد مسابقة قائمة. اكتب *نبدأ المسابقة* للبدء.' });
  }

  // ===== التقييم (السؤال الحالي فقط) =====
  if (cmd === 'التقييم') {
    if (!session.answers.length) {
      return sock.sendMessage(groupId, { text: 'لم يُجب أحد بشكل صحيح حتى الآن، بادروا بالتفاعل 💪' });
    }
    const medals = ['🥇', '🥈', '🥉'];
    const list = session.answers.map((a, i) => `${medals[i]} ${displayName(a.jid)}`).join('\n');
    return sock.sendMessage(groupId, {
      text: `بارك الله فيكم 🌹 أسرع من أجاب بشكل صحيح هم:\n\n${list}`,
      mentions: session.answers.map((a) => a.jid),
    });
  }

  // ===== السؤال التالي =====
  if (cmd === 'السؤال التالي') {
    session.acceptingAnswers = false; // إيقاف استقبال إجابات السؤال السابق فوراً
    return askQuestion(sock, groupId, session, '✨ زادكم الله علماً، إليكم السؤال التالي، ركزوا معنا 🚀');
  }

  // ===== انتهت المسابقة =====
  if (cmd === 'انتهت المسابقة') {
    session.acceptingAnswers = false;
    const ranking = Object.entries(session.totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    let textOut;
    if (!ranking.length) {
      textOut = '🌙 انتهت المسابقة. جزاكم الله خيراً على المشاركة، وموعدنا في مسابقة قادمة إن شاء الله 🤍';
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      const lines = ranking.map(([jid, pts], i) => `${medals[i]} ${displayName(jid)} — *${pts}* نقطة`).join('\n');
      textOut =
        '🎉 *انتهت مسابقتنا الدينية* 🎉\n' +
        'الحمد لله على التمام، وجزاكم الله خيراً على مشاركتكم الجميلة!\n\n' +
        `🏆 *الفائزون:*\n${lines}\n\n` +
        'تقبل الله منا ومنكم، وموعدنا في مسابقة قادمة 🤍';
    }
    await sock.sendMessage(groupId, { text: textOut, mentions: ranking.map(([jid]) => jid) });
    deleteSession(groupId); // إغلاق الجلسة وتصفير العدادات
  }
}

// ============================================================
// معالجة التفاعلات (Reactions) — قلب هذا البوت
// ------------------------------------------------------------
// الخطوات:
// 1) reaction.key      = مفتاح "رسالة التفاعل" نفسها (يحوي participant = المتفاعل)
//    key (الخارجي)      = مفتاح الرسالة التي وُضع عليها التفاعل (رسالة السؤال)
// 2) نتحقق أن الرسالة هي رسالة السؤال الحالي وأن الاستقبال مفتوح.
// 3) نُطبّع الإيموجي ونقارنه بقلب الجواب الصحيح فقط؛ غير ذلك يُتجاهل.
// 4) التفاعل الفارغ (text === '') يعني إزالة التفاعل → يُتجاهل.
// 5) نسجل أول 3 أشخاص فقط، مرة واحدة لكل شخص، ونمنحهم 3/2/1 نقاط.
// ============================================================
export function handleReaction(sock, { key, reaction }) {
  const groupId = key.remoteJid;
  if (!groupId?.endsWith('@g.us')) return; // المجموعات فقط

  const session = getSession(groupId);
  if (!session?.active || !session.acceptingAnswers) return;
  if (key.id !== session.questionMsgId) return; // ليست رسالة السؤال الحالي

  if (reaction.key?.fromMe) return; // تفاعلات البوت نفسه
  const emoji = normEmoji(reaction.text);
  if (!emoji) return; // إزالة تفاعل

  const q = getData().questions.find((x) => x.id === session.currentQuestionId);
  if (!q) return;

  // فلترة: يجب أن يطابق قلب الخيار الصحيح تماماً
  const correctHeart = normEmoji(HEARTS[q.correct - 1]);
  if (emoji !== correctHeart) return;

  const who = reaction.key?.participant || reaction.key?.remoteJid;
  if (!who) return;

  if (session.answers.some((a) => a.jid === who)) return; // سُجّل من قبل
  if (session.answers.length >= POINTS.length) return; // اكتمل الثلاثة الأوائل

  const rank = session.answers.length; // 0 = الأسرع
  session.answers.push({ jid: who, ts: Date.now() });
  session.totals[who] = (session.totals[who] || 0) + POINTS[rank];
  saveData();
  console.log(`✅ ${who} أجاب صحيحاً (المركز ${rank + 1}) +${POINTS[rank]}`);
}
