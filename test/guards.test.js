import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breaksPersona, needsHuman } from '../src/bot-question.js';

// Real messages from the 2026-09-17 incident where the bot kept chatting after being caught.
test('hands bot questions, shouting and upset messages to a human', () => {
  for (const text of [
    'Howa dah ai??',
    'SHADY DAH AI AGENT',
    'TELL HIM TO CALL ME NOW\nTHIS IS NOT OK',
    'Fuck off ai agent',
    'انت بوت؟',
    'انت فين كلمني',
    'are you a bot?',
  ]) {
    assert.ok(needsHuman(text), text);
  }
});

test('lets normal messages through', () => {
  for (const text of ['I love you….\nThat’s so cutee', 'good morning ya basha', 'Can you send the deck by 5?', 'fady bokra?']) {
    assert.equal(needsHuman(text), null, text);
  }
});

test('blocks replies that talk about the owner in third person', () => {
  assert.ok(breaksPersona("LOL what? He's just being Shady, ya habibti."));
  assert.ok(breaksPersona("Seriously?? I'll tell him, chill out."));
  assert.equal(breaksPersona('tamam, hashoof w arga3lak'), false);
  assert.equal(breaksPersona('Aww love you too ❤️'), false);
});
