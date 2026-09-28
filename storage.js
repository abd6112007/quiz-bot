// ============================================================
// التخزين في ملف JSON محلي (data.json)
// يحفظ: بنك الأسئلة + حالة كل مسابقة + النقاط + أسماء المشاركين
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(DIR, 'data.json');

let data = { questions: [], sessions: {}, names: {} };

export function loadData() {
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data.questions ??= [];
    data.sessions ??= {};
    data.names ??= {};
  } catch (e) {
    console.error('تعذر قراءة data.json، سيتم إنشاء ملف جديد:', e.message);
    saveData();
  }
  return data;
}

// كتابة آمنة: نكتب في ملف مؤقت ثم نستبدل الأصلي حتى لا يتلف الملف عند انقطاع مفاجئ
export function saveData() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

export const getData = () => data;

// ---------- الأسئلة ----------
export function addQuestion({ text, options, correct }) {
  const id = data.questions.reduce((m, q) => Math.max(m, q.id), 0) + 1;
  data.questions.push({ id, text, options, correct });
  saveData();
  return id;
}

// ---------- الجلسات (جلسة لكل مجموعة) ----------
export function newSession() {
  return {
    active: true,
    usedIds: [], // الأسئلة التي طُرحت (لمنع التكرار)
    currentQuestionId: null,
    questionMsgId: null, // معرّف رسالة السؤال الحالي (نراقب التفاعلات عليها فقط)
    acceptingAnswers: false,
    answers: [], // أسرع 3 أجابوا صح على السؤال الحالي: [{ jid, ts }]
    totals: {}, // النقاط الإجمالية: { jid: points }
  };
}

export const getSession = (groupId) => data.sessions[groupId];
export const setSession = (groupId, s) => { data.sessions[groupId] = s; saveData(); };
export const deleteSession = (groupId) => { delete data.sessions[groupId]; saveData(); };

// ---------- الأسماء ----------
export function rememberName(jid, name) {
  if (!name || data.names[jid] === name) return;
  data.names[jid] = name;
  saveData();
}
