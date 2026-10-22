// School-related security questions for password reset via dialogue box.
// No email/SMS required. Answers verified against stored argon2id hashes.
// EXACTLY 3 questions — never more.

export const SECURITY_QUESTIONS = [
  { id: 'q1', text: 'What is the name of your school?' },
  { id: 'q2', text: 'What is the name of your class teacher (homeroom)?' },
  { id: 'q3', text: 'What is your admission number / learner index number?' },
];

// Normalise an answer before hashing: trim, collapse whitespace, lowercase.
export function normalizeAnswer(answer) {
  if (typeof answer !== 'string') return '';
  return answer
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?'"()\-]/g, '');
}

// Return all 3 questions (fixed set).
export function getQuestions() {
  return SECURITY_QUESTIONS;
}

// Get question text by id.
export function getQuestionText(id) {
  const q = SECURITY_QUESTIONS.find(x => x.id === id);
  return q ? q.text : '';
}

// Validate that exactly 3 answers are provided and non-empty.
export function validateAnswers(answers) {
  if (!answers || typeof answers !== 'object') return false;
  const ids = Object.keys(answers);
  if (ids.length !== 3) return false;
  for (const id of ids) {
    if (!getQuestionText(id)) return false;
    if (typeof answers[id] !== 'string' || answers[id].trim().length < 2) return false;
  }
  return true;
}

import crypto from 'node:crypto';
export function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}