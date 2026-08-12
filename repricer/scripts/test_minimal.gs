// Минимальная версия для теста

function loadWBData() {
  const ss = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  const sheet = ss.getSheetByName('Репрайсер');
  
  Logger.log('Тестовая функция работает!');
  
  SpreadsheetApp.getUi().alert('✅ Тестовая функция работает!');
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Репрайсер');
  menu.addItem('Загрузить данные с ВБ', 'loadWBData');
  menu.addToUi();
}