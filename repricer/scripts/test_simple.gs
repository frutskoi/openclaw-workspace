// Простой тестовый скрипт

function testFunction() {
  const ss = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  const sheet = ss.getSheetByName('Репрайсер');
  
  Logger.log('Тест: ' + sheet.getName());
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Тест');
  menu.addItem('Запустить тест', 'testFunction');
  menu.addToUi();
}