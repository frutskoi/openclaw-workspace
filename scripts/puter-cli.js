#!/usr/bin/env node

// Puter.js CLI Tool
// Утилита для работы с Puter.com через командную строку

const {init} = require('/home/clawd/.npm-global/lib/node_modules/@heyputer/puter.js/src/init.cjs');

// Токен авторизации
const PUTER_AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiZ3VpIiwidmVyc2lvbiI6IjAuMC4wIiwidXVpZCI6ImE5MTY0MDZlLTA0YWQtNDljYy1hYTk5LThiNWEwNzQyZWM2NiIsInVzZXJfdWlkIjoiZGFjYmRkMjgtMzgwNC00MzM4LTkyYTktOTMxZTYwZTJiMWM4IiwiaWF0IjoxNzc3MDE2MjQ0fQ.qCvOVjmsTbyvnXE0ThDTkdhacC1cmD578QIVBAsqrwQ';

// Инициализация Puter с токеном
const puter = init(PUTER_AUTH_TOKEN);

// Основные функции
async function main() {
    const command = process.argv[2];

    try {
        switch(command) {
            case 'chat':
                await chatWithAI();
                break;
            case 'print':
                await printMessage();
                break;
            case 'test':
                await testConnection();
                break;
            case 'help':
                showHelp();
                break;
            default:
                showHelp();
        }
    } catch(error) {
        console.error('❌ Ошибка:', error.message);
        process.exit(1);
    }
}

// Чат с AI
async function chatWithAI() {
    const message = process.argv.slice(3).join(' ');

    if (!message) {
        console.log('❌ Укажите сообщение для чата');
        console.log('Пример: puter-cli chat "Привет, как дела?"');
        return;
    }

    console.log('🤖 Отправка сообщения в Puter AI...');
    const response = await puter.ai.chat(message);
    console.log('\n📝 Ответ:');
    console.log(response);
}

// Вывод сообщения
async function printMessage() {
    const message = process.argv.slice(3).join(' ');

    if (!message) {
        console.log('❌ Укажите сообщение для вывода');
        console.log('Пример: puter-cli print "Hello World"');
        return;
    }

    console.log('📤 Отправка сообщения...');
    await puter.print(message);
    console.log('✅ Сообщение отправлено');
}

// Тест соединения
async function testConnection() {
    console.log('🔍 Проверка соединения с Puter...');

    try {
        // Простой тест чата
        const response = await puter.ai.chat('Привет! Отправь только слово OK.');
        console.log('✅ Соединение установлено!');
        console.log('📝 Тестовый ответ:', response);
    } catch(error) {
        console.log('❌ Ошибка соединения:', error.message);
        throw error;
    }
}

// Помощь
function showHelp() {
    console.log(`
🔧 Puter.js CLI Tool

Использование:
  puter-cli <команда> [аргументы]

Команды:
  chat <сообщение>        Чат с Puter AI
  print <сообщение>       Вывести сообщение в Puter
  test                    Проверить соединение
  help                    Показать эту справку

Примеры:
  puter-cli chat "Напиши стих про OpenClaw"
  puter-cli print "Привет, мир!"
  puter-cli test

Токен настроен: ✅
API Origin: https://api.puter.com
    `);
}

// Запуск
main();