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
    state.statistics[taskId] = { totalTime: 0, sessions: [], daily: {} };
  }
  
  state.statistics[taskId].sessions.push({
    start: Date.now(),
    end: null
  });
  
  if (!state.activeTasks.includes(taskId)) {
    state.activeTasks.push(taskId);
  }
  
  saveData();
  updateUI();
}

function stopTask(taskId) {
  const stats = state.statistics[taskId];
  if (!stats) return;
  
  const lastSession = stats.sessions.find(s => s.end === null);
  if (lastSession) {
    lastSession.end = Date.now();
    const duration = lastSession.end - lastSession.start;
    stats.totalTime += duration;
    
    // Обновляем дневную статистику
    const dateKey = getDateKey(new Date());
    if (!stats.daily[dateKey]) {
      stats.daily[dateKey] = 0;
    }
    stats.daily[dateKey] += duration;
  }
  
  saveData();
  updateUI();
}

function isTaskActive(taskId) {
  const stats = state.statistics[taskId];
  return stats && stats.sessions && stats.sessions.some(s => s && s.end === null);
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
    statistics: state.statistics,
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

// Обновление интерфейса
function updateUI() {
  const app = document.getElementById('app');
  if (!app) return;
  
  app.innerHTML = `
    <div class="header">
      <h1>⏱️ Учет времени</h1>
      <div class="active-timers">
        ${state.activeTasks.filter(id => isTaskActive(id)).length > 0 ? `
          <h3>⏳ Сейчас активно:</h3>
          <ul>
            ${state.activeTasks.filter(id => isTaskActive(id)).map(id => {
              const task = getTaskById(id);
              const stats = state.statistics[id] || { totalTime: 0, sessions: [], daily: {} };
              const activeSession = stats.sessions.find(s => s.end === null);
              const duration = activeSession ? Date.now() - activeSession.start : 0;
              
              return `<li>
                <span>${task.name} (${formatTime(duration)})</span>
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
            
            return `<li class="${isActive ? 'active' : ''}">
              <span>${task.name} - ${formatTime(stats.totalTime)}</span>
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
            
            return `<li>
              <span>${task.name} - ${formatTime(stats.totalTime)}</span>
              <div class="task-actions">
                <button onclick="activateTask('${id}')">➕</button>
                <button onclick="showTaskStats('${id}')">📊</button>
              </div>
            </li>`;
          }).join('')}
        </ul>
      </div>
    </div>
    
    <div class="controls">
      <button onclick="showAddTaskDialog()">➕ Создать задание</button>
      <button onclick="showExportDialog()">📤 Экспорт данных</button>
    </div>
    
    <div id="modal" class="modal hidden"></div>
  `;
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
