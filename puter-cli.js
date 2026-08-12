#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// Путь к конфигу
const CONFIG_PATH = path.join(process.env.HOME, '.config', 'puter', 'config.json');
const COOKIE_PATH = path.join(process.env.HOME, '.config', 'puter', 'session.json');

let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error('Error loading config:', err.message);
  process.exit(1);
}

// GUI токен используется для браузерной сессии
const GUI_TOKEN = config.authToken;

// API клиент для Puter (имитация браузера)
class PuterAPI {
  constructor(guiToken) {
    this.guiToken = guiToken;
    this.cookieJar = {};
    this.baseUrl = 'puter.com';
  }

  async request(method, endpoint, data = null, headers = {}) {
    const url = new URL(endpoint, `https://${this.baseUrl}`);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Origin': `https://${this.baseUrl}`,
        'Referer': `https://${this.baseUrl}/`,
        'Authorization': `Bearer ${this.guiToken}`,
        ...headers
      }
    };

    if (data) {
      options.headers['Content-Type'] = 'application/json';
    }

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(`${res.statusCode}: ${json.message || JSON.stringify(json)}`));
            }
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
            } else {
              reject(new Error(`${res.statusCode}: ${body}`));
            }
          }
        });
      });

      req.on('error', reject);

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  // Попытка получения информации о пользователе
  async getUserInfo() {
    try {
      return await this.request('GET', '/api/user');
    } catch (err) {
      // Пробуем другие эндпоинты
      try {
        return await this.request('GET', '/api/v1/user');
      } catch (err2) {
        try {
          return await this.request('GET', '/api/v2/user');
        } catch (err3) {
          throw new Error('Could not connect to Puter API. The token may be invalid or expired.');
        }
      }
    }
  }

  // Список файлов
  async ls(path = '/') {
    try {
      return await this.request('GET', `/api/fs/list?path=${encodeURIComponent(path)}`);
    } catch (err) {
      try {
        return await this.request('GET', `/api/v1/fs/list?path=${encodeURIComponent(path)}`);
      } catch (err2) {
        try {
          return await this.request('GET', `/fs?path=${encodeURIComponent(path)}`);
        } catch (err3) {
          throw new Error(`Could not list files: ${err.message}`);
        }
      }
    }
  }

  // Чтение файла
  async read(path) {
    try {
      return await this.request('GET', `/api/fs/read?path=${encodeURIComponent(path)}`);
    } catch (err) {
      try {
        return await this.request('GET', `/api/v1/fs/read?path=${encodeURIComponent(path)}`);
      } catch (err2) {
        throw new Error(`Could not read file: ${err.message}`);
      }
    }
  }

  // Запись файла
  async write(path, content) {
    try {
      return await this.request('POST', '/api/fs/write', { path, content });
    } catch (err) {
      try {
        return await this.request('POST', '/api/v1/fs/write', { path, content });
      } catch (err2) {
        throw new Error(`Could not write file: ${err.message}`);
      }
    }
  }

  // Создание директории
  async mkdir(path) {
    try {
      return await this.request('POST', '/api/fs/mkdir', { path });
    } catch (err) {
      try {
        return await this.request('POST', '/api/v1/fs/mkdir', { path });
      } catch (err2) {
        throw new Error(`Could not create directory: ${err.message}`);
      }
    }
  }

  // Удаление
  async rm(path) {
    try {
      return await this.request('POST', '/api/fs/delete', { path });
    } catch (err) {
      try {
        return await this.request('POST', '/api/v1/fs/delete', { path });
      } catch (err2) {
        throw new Error(`Could not delete: ${err.message}`);
      }
    }
  }

  // KV операции
  async kvSet(key, value) {
    try {
      return await this.request('POST', '/api/kv/set', { key, value });
    } catch (err) {
      try {
        return await this.request('POST', '/api/v1/kv/set', { key, value });
      } catch (err2) {
        throw new Error(`Could not set KV: ${err.message}`);
      }
    }
  }

  async kvGet(key) {
    try {
      return await this.request('GET', `/api/kv/get?key=${encodeURIComponent(key)}`);
    } catch (err) {
      try {
        return await this.request('GET', `/api/v1/kv/get?key=${encodeURIComponent(key)}`);
      } catch (err2) {
        throw new Error(`Could not get KV: ${err.message}`);
      }
    }
  }

  // AI чат
  async aiChat(prompt, options = {}) {
    try {
      return await this.request('POST', '/api/ai/chat', { prompt, ...options });
    } catch (err) {
      try {
        return await this.request('POST', '/api/v1/ai/chat', { prompt, ...options });
      } catch (err2) {
        throw new Error(`Could not chat with AI: ${err.message}`);
      }
    }
  }
}

// CLI интерфейс
const api = new PuterAPI(GUI_TOKEN);
const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  try {
    switch (command) {
      case 'info':
        const info = await api.getUserInfo();
        console.log('User info:', JSON.stringify(info, null, 2));
        break;

      case 'ls':
        const lsPath = args[0] || '/';
        console.log(`Listing: ${lsPath}`);
        const result = await api.ls(lsPath);
        console.log(JSON.stringify(result, null, 2));
        break;

      case 'read':
        if (!args[0]) {
          console.error('Usage: puter read <path>');
          process.exit(1);
        }
        const content = await api.read(args[0]);
        console.log(JSON.stringify(content, null, 2));
        break;

      case 'write':
        if (!args[0] || !args[1]) {
          console.error('Usage: puter write <path> <content>');
          process.exit(1);
        }
        const writeResult = await api.write(args[0], args[1]);
        console.log('✓ File written:', JSON.stringify(writeResult, null, 2));
        break;

      case 'mkdir':
        if (!args[0]) {
          console.error('Usage: puter mkdir <path>');
          process.exit(1);
        }
        await api.mkdir(args[0]);
        console.log('✓ Directory created:', args[0]);
        break;

      case 'rm':
        if (!args[0]) {
          console.error('Usage: puter rm <path>');
          process.exit(1);
        }
        await api.rm(args[0]);
        console.log('✓ Deleted:', args[0]);
        break;

      case 'kv-get':
        if (!args[0]) {
          console.error('Usage: puter kv-get <key>');
          process.exit(1);
        }
        const kvValue = await api.kvGet(args[0]);
        console.log(JSON.stringify(kvValue, null, 2));
        break;

      case 'kv-set':
        if (!args[0] || !args[1]) {
          console.error('Usage: puter kv-set <key> <value>');
          process.exit(1);
        }
        await api.kvSet(args[0], args[1]);
        console.log('✓ KV set:', args[0]);
        break;

      case 'chat':
        if (!args[0]) {
          console.error('Usage: puter chat <prompt>');
          process.exit(1);
        }
        const chatResult = await api.aiChat(args.join(' '));
        console.log(JSON.stringify(chatResult, null, 2));
        break;

      case 'help':
        console.log(`
Puter CLI v1.1.0
Usage: puter <command> [args]

Commands:
  info              Get user/account info
  ls [path]         List files in directory (default: /)
  read <path>       Read file contents
  write <path> <content>  Write file
  mkdir <path>      Create directory
  rm <path>         Delete file/directory
  kv-get <key>      Get value from KV store
  kv-set <key> <value>    Set value in KV store
  chat <prompt>     Chat with AI
  help              Show this help

Config: ${CONFIG_PATH}
Token: ${GUI_TOKEN.substring(0, 20)}...
        `);
        break;

      default:
        console.error('Unknown command:', command);
        console.log('Run: puter help');
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.log('\nTry: puter info - to check if your token is valid');
    process.exit(1);
  }
}

main();