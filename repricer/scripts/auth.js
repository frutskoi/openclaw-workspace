/**
 * Скрипт авторизации Wildberries
 * Работает с API ключом и токеном пользователя
 */

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3Nfa2V5IjoiODQyZjFjYWUtOGNmZS00YjI4LTk5ZWEtYTc3MjFjYjVkMWE3IiwicHJvamVjdF9pZCI6IjI3ZjRjYWQyLWUyOTAtNGM2Ny1iMzNmLTc5ZGY0NDkxNmY3YyIsInNjb3BlIjpbImFwaV9yZWFkIl19.qh3XJW_KF2hT9Y0PfHbZ0y4Y9Hq7h8W3KxP1hNjMxP5_w2rT3hL4kX8hXlWcEwU7sZ_mK5w2lY8fN8xQqGwW0hG8xB6xK3xK5wD0xK9xF6wS8kK1xF3wK7xK4xM2xK5wE4xK7wD3xK8xK6wC0xK8wE5xK9wD4xK0xK5wE3xK6wD2xK4xE1xK5wD0xK3xE2xK4wD1xK2xE3xK3wD0xK1xE4xK2wD1xK0xE5xK1wD0xKzxE6xK0wD1xKyxE7xKzwD0xKxxE8xKzwD1xKxwD0xKwxE9xKxwD1xKwD0xKyxEAxKywD1xKxwD0xK0xEBxK0wD1xKzxECxK1wD0xKyxEDxK2wD1xKxxEExK3wD0xK0xEFxK4wD1xKzxEGxK5wD0xK4xEHxK6wD1xK3xEIxK7wD0xK2xEJxK8wD1xK1xEKxK9wD0xK0xELxKAwD1xKzxEMxKBwD0xKyxENxKCwD1xKxxEOxKDwD0xKwxEPxKEwD1xKvxEQxKFwD0xKuxERxKGwD1xKtxESxKHwD0xKsxETxKIwD1xKrxEUxKJwD0xKqxEVxKKwD1xKpxEWxKLwD1xKowEXxKMwD1xKnxEYxKNwD1xKmxEZxKOwD1xKlxEaxKPwD1xKkxEcxKQwD1xKjxEDxKRwD1xKixEExKSwD1xKhxEFxKTwdQ';
const USER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3Nfa2V5IjoiODQyZjFjYWUtOGNmZS00YjI4LTk5ZWEtYTc3MjFjYjVkMWE3IiwicHJvamVjdF9pZCI6IjI3ZjRjYWQyLWUyOTAtNGM2Ny1iMzNmLTc5ZGY0NDkxNmY3YyIsInNjb3BlIjpbImFwaV9yZWFkIl19.qh3XJW_KF2hT9Y0PfHbZ0y4Y9Hq7h8W3KxP1hNjMxP5_w2rT3hL4kX8hXlWcEwU7sZ_mK5w2lY8fN8xQqGwW0hG8xB6xK3xK5wD0xK9xF6wS8kK1xF3wK7xK4xM2xK5wE4xK7wD3xK8xK6wC0xK8wE5xK9wD4xK0xK5wE3xK6wD2xK4xE1xK5wD0xK3xE2xK4wD1xK2xE3xK3wD0xK1xE4xK2wD1xK0xE5xK1wD0xKzxE6xK0wD1xKyxE7xKzwD0xKxxE8xKzwD1xKxwD0xKwxE9xKxwD1xKwD0xKyxEAxKywD1xKxwD0xK0xEBxK0wD1xKzxECxK1wD0xKyxEDxK2wD1xKxxEExK3wD0xK0xEFxK4wD1xKzxEGxK5wD0xK4xEHxK6wD1xK3xEIxK7wD0xK2xEJxK8wD1xK1xEKxK9wD0xK0xELxKAwD1xKzxEMxKBwD0xKyxENxKCwD1xKxxEOxKDwD0xKwxEPxKEwD1xKvxEQxKFwD0xKuxERxKGwD1xKtxESxKHwD0xKsxETxKIwD1xKrxEUxKJwD0xKqxEVxKKwD1xKpxEWxKLwD1xKowEXxKMwD1xKnxEYxKNwD1xKmxEZxKOwD1xKlxEaxKPwD1xKkxEcxKQwD1xKjxEDxKRwD1xKixEExKSwD1xKhxEFxKTwdQ';

const WB_API_BASE = 'https://suppliers-api.wildberries.ru';

/**
 * Создает заголовки для API запросов
 */
function getWBHeaders(useUserToken = false) {
  const token = useUserToken ? USER_TOKEN : API_KEY;

  return {
    'Authorization': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

/**
 * Выполняет запрос к WB API с обработкой ошибок
 */
function fetchWBAPI(endpoint, options = {}, useUserToken = false) {
  try {
    const url = `${WB_API_BASE}${endpoint}`;
    const headers = getWBHeaders(useUserToken);

    const response = UrlFetchApp.fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      },
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      return JSON.parse(responseBody);
    } else {
      throw new Error(`API Error ${statusCode}: ${responseBody}`);
    }
  } catch (error) {
    throw error;
  }
}