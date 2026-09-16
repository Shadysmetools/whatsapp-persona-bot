import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStyle, parseExport, scriptOf } from '../scripts/build-persona.js';
import { parseReply } from '../src/agent.js';
import { splitReply } from '../src/humanize.js';

test('parses Android and iOS export lines, multi-line messages and skips media', () => {
  const raw = [
    '16/09/2026, 10:15 - Ahmed: ezayak ya shady',
    '16/09/2026, 10:16 - Shady: tamam el7amdulillah',
    'w enta?',
    '16/09/2026, 10:17 - Ahmed: <Media omitted>',
    '[16/09/2026, 10:18:22] Mona: عامل ايه',
  ].join('\n');
  const msgs = parseExport(raw);
  assert.deepEqual(msgs, [
    { sender: 'Ahmed', text: 'ezayak ya shady' },
    { sender: 'Shady', text: 'tamam el7amdulillah\nw enta?' },
    { sender: 'Mona', text: 'عامل ايه' },
  ]);
});

test('detects Arabic, Franco and English', () => {
  assert.equal(scriptOf('عامل ايه يا صاحبي'), 'arabic');
  assert.equal(scriptOf('la2 msh fady bokra'), 'franco');
  assert.equal(scriptOf('3andy shoghl'), 'franco');
  assert.equal(scriptOf('see you tomorrow then'), 'english');
});

test('builds style with example pairs', () => {
  const msgs = [
    { sender: 'Ahmed', text: 'fady bokra?' },
    { sender: 'Shady', text: 'la2 3andy shoghl 😅' },
  ];
  const style = buildStyle(msgs, 'Shady');
  assert.match(style, /Them: fady bokra\?\nMe: la2 3andy shoghl 😅/);
  assert.match(style, /franco 100%/);
});

test('extracts escalation marker and strips name prefix', () => {
  const r = parseReply('Shady: hashoof w a2olak\n[[ESCALATE: asked to borrow money]]');
  assert.equal(r.text, 'hashoof w a2olak');
  assert.equal(r.escalation, 'asked to borrow money');
  assert.equal(parseReply('tamam').escalation, null);
});

test('splits replies into at most 3 messages', () => {
  assert.deepEqual(splitReply('a\n\nb'), ['a', 'b']);
  assert.equal(splitReply('a\n\nb\n\nc\n\nd').length, 3);
});
