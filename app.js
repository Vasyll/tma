// Инициализация TMA
Telegram.WebApp.expand();
Telegram.WebApp.ready();

// Состояние приложения
const state = {
  activeTasks: [],
  inactiveTasks: [],
  taskTemplates: [],
  incompatibleGroups: {},
  statistics: {},
  lastSync: 0,
  storageCheckInterval: 1000 // Проверка каждую 1 секунду
};

// Загрузка данных
function getCloudItem(key) {
  return new Promise((resolve, reject) => {
    Telegram.WebApp.CloudStorage.getItem(key, (error, value) => {
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    });
  });
}

async function loadData() {
  try {
    const data = await getCloudItem('timeTrackerData');
    const parsed = JSON.parse(data);
    console.log('Loading data:', parsed)
    Object.assign(state, parsed);
  } catch (error) {
    console.error('Ошибка при получении данных:', error);
  } finally {
    initDefaultData();
  }
}

function initDefaultData() {
  // Проверяем по taskTemplates вместо activeTasks/inactiveTasks
  if (state.taskTemplates.length === 0) {
    addTaskTemplate('Ходьба', 'movement');
    addTaskTemplate('Бег', 'movement');
    addTaskTemplate('Думать');
    addTaskTemplate('Слушать подкаст');
    
    state.inactiveTasks = [...state.taskTemplates.map(t => t.id)];
  }
}

// Сохранение данных
function saveData() {
  state.lastSync = Date.now();
  const data = JSON.stringify(state);
  Telegram.WebApp.CloudStorage.setItem('timeTrackerData', data, (err, success) => {
    if (err) {
      console.error('Error saving data:', err);
    } else {
      console.log('Data saved successfully:', success);
    }
  });
}


function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


// Шаблоны заданий
function addTaskTemplate(name, incompatibleGroup = null) {
  const newTask = {
    id: generateUUID(), // Уникальный ID
    name,
    incompatibleGroup,
    createdAt: Date.now()
  };
  state.taskTemplates.push(newTask);
  state.inactiveTasks.push(newTask.id);
  saveData();
  return newTask;
}

function getTaskById(id) {
  return state.taskTemplates.find(t => t.id === id);
}

// Управление активными заданиями
function activateTask(taskId) {
  const index = state.inactiveTasks.indexOf(taskId);
  if (index !== -1) {
    // 1. Удаляем из неактивных
    state.inactiveTasks.splice(index, 1);

    // Добавляем в активные (если ещё не там)
    if (!state.activeTasks.includes(taskId)) {
      state.activeTasks.push(taskId);
    }

    saveData();
    updateUI();
  }
}

function deactivateTask(taskId) {
  if (!state.activeTasks.includes(taskId)) return;
  
  // Остановить задание если оно активно
  if (isTaskActive(taskId)) {
    stopTask(taskId);
  }
  
  const index = state.activeTasks.indexOf(taskId);
  if (index !== -1) {
    state.activeTasks.splice(index, 1);
    state.inactiveTasks.push(taskId);
    saveData();
    updateUI();
  }
}

// Работа с таймерами
function startTask(taskId) {
  const task = getTaskById(taskId);
  if (!task) return;
  
  // Проверка на несовместимые задания
  if (task.incompatibleGroup) {
    const conflictingTasks = state.activeTasks.filter(activeId => {
      const activeTask = getTaskById(activeId);
      return activeTask.incompatibleGroup === task.incompatibleGroup && isTaskActive(activeId);
    });
    
    if (conflictingTasks.length > 0) {
      showConfirmationDialog(
        `Это задание несовместимо с ${conflictingTasks.length} активными заданиями. Остановить их?`,
        () => {
          conflictingTasks.forEach(stopTask);
          actuallyStartTask(taskId);
        }
      );
      return;
    }
  }
  
  actuallyStartTask(taskId);
}

function actuallyStartTask(taskId) {
  if (!state.statistics[taskId]) {
    state.statistics[taskId] = { daily: {} };
  }
  
  // Запоминаем только время старта (не сохраняем сессию)
  state.activeTasks.push(taskId);
  state.statistics[taskId].currentStart = Date.now();
  
  saveData();
  updateUI();
}

function stopTask(taskId) {
  const stats = state.statistics[taskId];
  if (!stats || !stats.currentStart) return;
  
  const duration = Date.now() - stats.currentStart;
  const dateKey = getDateKey(new Date());
  
  // Обновляем daily статистику
  if (!stats.daily[dateKey]) {
    stats.daily[dateKey] = 0;
  }
  stats.daily[dateKey] += duration;
  
  // Очищаем текущую сессию
  delete stats.currentStart;
  
  // Очищаем старые данные (оставляем 7 дней)
  cleanupOldStats(taskId);
  
  saveData();
  updateUI();
}

function cleanupOldStats(taskId) {
  const stats = state.statistics[taskId];
  if (!stats?.daily) return;
  
  const now = new Date();
  const daysToKeep = 7;
  
  Object.keys(stats.daily).forEach(date => {
    const dateObj = new Date(date);
    const diffDays = Math.floor((now - dateObj) / (1000 * 60 * 60 * 24));
    
    if (diffDays > daysToKeep) {
      delete stats.daily[date];
    }
  });
}

function isTaskActive(taskId) {
  const stats = state.statistics[taskId];
  return stats && stats.currentStart !== undefined;
}

function getTodayTime(stats) {
  if (!stats?.daily) return 0;
  const todayKey = getDateKey(new Date());
  return stats.daily[todayKey] || 0;
}

// Статистика
function getDateKey(date) {
  return date.toISOString().split('T')[0];
}

function getWeeklyStats(taskId) {
  const stats = state.statistics[taskId];
  if (!stats) return {};
  
  const weeklyStats = {};
  for (const [date, time] of Object.entries(stats.daily)) {
    const weekStart = getWeekStartDate(new Date(date));
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeklyStats[weekKey]) {
      weeklyStats[weekKey] = 0;
    }
    weeklyStats[weekKey] += time;
  }
  
  return weeklyStats;
}

function getWeekStartDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Понедельник как начало недели
  return new Date(d.setDate(diff));
}

// UI Helpers
function showConfirmationDialog(message, callback) {
  Telegram.WebApp.showConfirm(message, (confirmed) => {
    if (confirmed) callback();
  });
}

function showPopup(title, message, buttons = []) {
  Telegram.WebApp.showPopup({ title, message, buttons }, (id) => {
    const button = buttons.find(b => b.id === id);
    if (button && button.callback) button.callback();
  });
}

// Экспорт данных
function exportData() {
  const data = {
    tasks: state.taskTemplates,
    statistics: Object.fromEntries(
      Object.entries(state.statistics).map(([id, stats]) => [
        id, 
        { daily: stats.daily } // Экспортируем только daily данные
      ]
    ),
    exportedAt: new Date().toISOString()
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `time-tracker-export-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getCurrentTaskTime(taskId) {
  const stats = state.statistics[taskId];
  if (!stats?.currentStart) return 0;
  return Date.now() - stats.currentStart;
}

// Обновление интерфейса
function updateUI() {
  const app = document.getElementById('app');
  if (!app) return;

  // Проверяем, открыто ли модальное окно
  const modal = document.getElementById('modal');
  if (modal && !modal.classList.contains('hidden')) {
    return; // Не обновляем UI, если модальное окно видимо
  }
  
  app.innerHTML = `
    <div class="header">
      <h1>⏱️ Учет времени</h1>
      <div class="active-timers">
        ${state.activeTasks.filter(id => isTaskActive(id)).length > 0 ? `
          <h3>⏳ Сейчас активно:</h3>
          <ul>
            ${state.activeTasks.filter(id => isTaskActive(id)).map(id => {
              const task = getTaskById(id);
              const todayTime = getTodayTime(state.statistics[id]);
              const currentTime = getCurrentTaskTime(id);
              
              return `<li>
                <span>${task.name} (${formatTime(todayTime + currentTime)} сегодня</span>
                <button onclick="stopTask('${id}')">⏹️</button>
              </li>`;
            }).join('')}
          </ul>
        ` : '<p>Нет активных таймеров</p>'}
      </div>
    </div>
    
    <div class="task-management">
      <div class="active-tasks">
        <h3>📋 Активные задания (${state.activeTasks.length})</h3>
        <ul>
          ${state.activeTasks.map(id => {
            const task = getTaskById(id);
            const stats = state.statistics[id] || { totalTime: 0, sessions: [], daily: {} };
            const isActive = isTaskActive(id);
            const todayTime = getTodayTime(stats);
            
            return `<li class="${isActive ? 'active' : ''}">
              <span>${task.name} - ${formatTime(todayTime)} (${formatTime(stats.totalTime)})</span>
              <div class="task-actions">
                ${isActive 
                  ? `<button onclick="stopTask('${id}')">⏹️</button>`
                  : `<button onclick="startTask('${id}')">▶️</button>`}
                <button onclick="showTaskStats('${id}')">📊</button>
                <button onclick="deactivateTask('${id}')">➖</button>
              </div>
            </li>`;
          }).join('')}
        </ul>
      </div>
      
      <div class="inactive-tasks">
        <h3>📁 Неактивные задания (${state.inactiveTasks.length})</h3>
        <ul>
          ${state.inactiveTasks.map(id => {
            const task = getTaskById(id);
            const stats = state.statistics[id] || { totalTime: 0, sessions: [], daily: {} };
            const todayTime = getTodayTime(stats);
            
            return `<li>
              <span>${task.name} - ${formatTime(todayTime)} (${formatTime(stats.totalTime)})</span>
              <div class="task-actions">
                <button onclick="activateTask('${id}')">➕</button>
                <button onclick="showTaskStats('${id}')">📊</button>
                <button onclick="showDeleteConfirm('${id}')" class="delete-btn">🗑️</button>
              </div>
            </li>`;
          }).join('')}
        </ul>
      </div>
    </div>
    
    <div class="controls">
      <button onclick="showAddTaskDialog()">➕ Создать задание</button>
    </div>
    
    <div id="modal" class="modal hidden"></div>
  `;

// Убрал экспорт данных, он нихрена не работает нигде, только запущенный локально
//    <div class="controls">
//      <button onclick="showAddTaskDialog()">➕ Создать задание</button>
//      <button onclick="showExportDialog()">📤 Экспорт данных</button>
//    </div>

}

// Модальные окна
function showTaskStats(taskId) {
  const task = getTaskById(taskId);
  const stats = state.statistics[taskId] || { totalTime: 0, daily: {}, sessions: [] };
  const weeklyStats = getWeeklyStats(taskId);
  
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-content">
      <h2>📊 ${task.name}</h2>
      <p>Общее время: ${formatTime(stats.totalTime)}</p>
      
      <div class="stats-section">
        <h3>📅 По дням:</h3>
        <ul>
          ${Object.entries(stats.daily).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([date, time]) => `
            <li>${date}: ${formatTime(time)}</li>
          `).join('')}
        </ul>
      </div>
      
      <div class="stats-section">
        <h3>🗓️ По неделям:</h3>
        <ul>
          ${Object.entries(weeklyStats).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5).map(([week, time]) => `
            <li>Неделя с ${week}: ${formatTime(time)}</li>
          `).join('')}
        </ul>
      </div>
      
      <button onclick="closeModal()">Закрыть</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

function showAddTaskDialog() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-content">
      <h2>➕ Новое задание</h2>
      <input type="text" id="newTaskName" placeholder="Название задания">
      
      <div class="form-group">
        <label>
          <input type="checkbox" id="hasIncompatibleGroup">
          Имеет группу несовместимости
        </label>
        <input type="text" id="incompatibleGroup" placeholder="Название группы" disabled>
      </div>
      
      <button onclick="handleAddTask()">Добавить</button>
      <button onclick="closeModal()">Отмена</button>
    </div>
  `;
  
  document.getElementById('hasIncompatibleGroup').addEventListener('change', (e) => {
    document.getElementById('incompatibleGroup').disabled = !e.target.checked;
  });
  
  modal.classList.remove('hidden');
}

function handleAddTask() {
  const name = document.getElementById('newTaskName').value.trim();
  if (!name) return;
  
  const hasGroup = document.getElementById('hasIncompatibleGroup').checked;
  const group = hasGroup ? document.getElementById('incompatibleGroup').value.trim() : null;
  
  addTaskTemplate(name, group);
  closeModal();
  updateUI();
}

// Удаление задачи (только для неактивных)
function deleteTask(taskId) {
  // Проверяем, что задача неактивна
  if (state.activeTasks.includes(taskId)) {
    console.warn('Нельзя удалить активную задачу');
    return;
  }

  // Удаляем из всех коллекций
  state.inactiveTasks = state.inactiveTasks.filter(id => id !== taskId);
  state.taskTemplates = state.taskTemplates.filter(task => task.id !== taskId);
  
  // Удаляем статистику
  if (state.statistics[taskId]) {
    delete state.statistics[taskId];
  }

  // if (state.statistics[taskId]?.totalTime > 0) {
  //   showConfirmationDialog(
  //     `Задача "${task.name}" имеет историю (${formatTime(state.statistics[taskId].totalTime)}). 
  //      Удалить вместе с историей?`,
  //     () => actuallyDeleteTask(taskId)
  //   );
  // } else {
  //   actuallyDeleteTask(taskId);
  // }

  // Удаляем из групп несовместимости (если используется)
  for (const group in state.incompatibleGroups) {
    state.incompatibleGroups[group] = 
      state.incompatibleGroups[group].filter(id => id !== taskId);
  }
  
  saveData();
  updateUI();
}

// function actuallyDeleteTask(taskId) {
//   if (state.statistics[taskId]) {
//     delete state.statistics[taskId];
//   }
// }

function showDeleteConfirm(taskId) {
  const task = getTaskById(taskId);
  if (!task) return;

  showConfirmationDialog(
    `Удалить задачу "${task.name}"? Это действие нельзя отменить.`,
    () => deleteTask(taskId)
  );
}

function showExportDialog() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-content">
      <h2>📤 Экспорт данных</h2>
      <p>Вы можете экспортировать все данные для резервного копирования или анализа.</p>
      <button onclick="exportData()">Экспортировать в JSON</button>
      <button onclick="closeModal()">Отмена</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// Форматирование времени
function formatTime(ms) {
  if (!ms) return "0:00:00";
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  updateUI();

  // Добавьте этот лог после загрузки данных
  console.log('Initial state:', JSON.parse(JSON.stringify(state)));
  
  // Обновление времени каждую секунду

  //setInterval(() => {
  //  if (state.activeTasks.some(id => isTaskActive(id))) {
  //    updateUI();
  //  }
  //}, 1000);
  setInterval(updateUI, 1000)

  setInterval(loadData, state.storageCheckInterval);
});


// Глобальные функции
window.startTask = startTask;
window.stopTask = stopTask;
window.activateTask = activateTask;
window.deactivateTask = deactivateTask;
window.showTaskStats = showTaskStats;
window.showAddTaskDialog = showAddTaskDialog;
window.showExportDialog = showExportDialog;
window.closeModal = closeModal;
