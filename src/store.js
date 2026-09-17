import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const historyDir = path.join(config.dataDir, 'history');
const stateFile = path.join(config.dataDir, 'state.json');
fs.mkdirSync(historyDir, { recursive: true });

export function loadHistory(number) {
  const file = path.join(historyDir, `${number}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

export function appendHistory(number, role, content) {
  const history = [...loadHistory(number), { role, content, at: new Date().toISOString() }];
  const trimmed = history.slice(-config.historyTurns * 2);
  fs.writeFileSync(path.join(historyDir, `${number}.json`), JSON.stringify(trimmed, null, 2));
}

const today = () => new Date().toISOString().slice(0, 10);

const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  : { paused: false, takeovers: {}, day: today(), repliesToday: 0 };

const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

export const botState = {
  get paused() {
    return state.paused;
  },
  setPaused(value) {
    state.paused = value;
    save();
  },
  /** Owner typed in this chat: stay out of it for a while. */
  takeOver(number, ms = config.takeoverMs) {
    state.takeovers[number] = Date.now() + ms;
    save();
  },
  isTakenOver(number) {
    return (state.takeovers[number] ?? 0) > Date.now();
  },
  releaseAll() {
    state.takeovers = {};
    save();
  },
  capReached() {
    if (state.day !== today()) Object.assign(state, { day: today(), repliesToday: 0 });
    return state.repliesToday >= config.dailyCap;
  },
  countReply() {
    state.repliesToday += 1;
    save();
  },
  get repliesToday() {
    return state.repliesToday;
  },
};
