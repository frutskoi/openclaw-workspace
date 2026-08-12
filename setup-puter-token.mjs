#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiZ3VpIiwidmVyc2lvbiI6IjAuMC4wIiwidXVpZCI6ImE5MTY0MDZlLTA0YWQtNDljYy1hYTk5LThiNWEwNzQyZWM2NiIsInVzZXJfdWlkIjoiZGFjYmRkMjgtMzgwNC00MzM4LTkyYTktOTMxZTYwZTJiMWM4IiwiaWF0IjoxNzc3MDE2MjQ0fQ.qCvOVjmsTbyvnXE0ThDTkdhacC1cmD578QIVBAsqrwQ';

// Пути для хранения
const CONFIG_DIR = path.join(os.homedir(), '.opencode');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'puter-credentials.json');

// Создаём директорию если нужно
await fs.mkdir(CONFIG_DIR, { recursive: true });

// Сохраняем credentials
const credentials = {
  token: TOKEN,
  timestamp: Date.now(),
  source: 'manual'
};

await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));

console.log('✅ Puter token saved successfully!');
console.log(`📁 Location: ${CREDENTIALS_FILE}`);
console.log(`🔑 Token: ${TOKEN.substring(0, 30)}...`);