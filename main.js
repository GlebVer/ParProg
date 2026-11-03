const TIMEOUT_MS = 60000; // если Worker не ответил за 60 с, считаем задачу зависшей

const sizeSelect = document.getElementById("size");
const repeatsInput = document.getElementById("repeats");
const counterEl = document.getElementById("counter");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const logEl = document.getElementById("log");

let data = null;      // сгенерированный массив
let worker = null;    // Worker создаём при первом запуске
let nextId = 1;       // счётчик идентификаторов задач
let pending = null;   // текущая задача в Worker: { id, startTime, size, timerId }
let mainBusy = false; // идёт ли вычисление в основном потоке

// ---------- Счётчик для проверки отзывчивости интерфейса ----------
let count = 0;
setInterval(() => {
  count++;
  counterEl.textContent = count;
}, 100);

// ---------- Вспомогательные функции ----------
function setStatus(text) {
  statusEl.textContent = text;
}

function addLog(text) {
  logEl.textContent += text + "\n";
}

function getRepeats() {
  return Math.max(1, Number(repeatsInput.value) || 1);
}

function showResult(r) {
  resultEl.textContent =
    "Сумма: " + r.sum + "\n" +
    "Среднее: " + r.average + "\n" +
    "Минимум: " + r.min + "\n" +
    "Максимум: " + r.max;
}

// ---------- Генерация массива ----------
function generate() {
  const size = Number(sizeSelect.value);
  data = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = Math.random() * 1000;
  }
  setStatus("Массив сгенерирован: " + size + " элементов");
}

// ---------- Вычисление в основном потоке ----------
function calcStatsMain(array, repeats) {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let pass = 0; pass < repeats; pass++) {
    sum = 0;
    min = Infinity;
    max = -Infinity;
    for (let i = 0; i < array.length; i++) {
      const value = array[i];
      sum += value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  return { sum, average: sum / array.length, min, max };
}

async function runMain() {
  if (!data) return setStatus("Сначала сгенерируйте массив");
  if (mainBusy || pending) return setStatus("Другая задача ещё выполняется");

  mainBusy = true;
  setStatus("Считаю в основном потоке (интерфейс может зависнуть)...");
  // небольшая пауза, чтобы браузер успел показать статус до начала тяжёлого вычисления
  await new Promise((resolve) => setTimeout(resolve, 50));

  const start = performance.now();
  const result = calcStatsMain(data, getRepeats());
  const ms = performance.now() - start;

  showResult(result);
  addLog("Основной поток | " + data.length + " эл. | " + ms.toFixed(1) + " мс");
  setStatus("Основной поток: готово");
  mainBusy = false;
}

// ---------- Работа с Worker ----------
function getWorker() {
  if (worker) return worker;

  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

  worker.addEventListener("message", onWorkerMessage);

  worker.addEventListener("error", (event) => {
    setStatus("Ошибка Worker: " + event.message);
    finishPending();
    stopWorker(); // сломанный Worker закрываем, при следующем запуске создадим новый
  });

  worker.addEventListener("messageerror", () => {
    setStatus("Ошибка: не удалось прочитать сообщение от Worker");
  });

  return worker;
}

function stopWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function finishPending() {
  if (pending) {
    clearTimeout(pending.timerId);
    pending = null;
  }
}

function startWorkerTask(array, repeats) {
  if (mainBusy || pending) return setStatus("Другая задача ещё выполняется");

  const id = nextId++;

  const timerId = setTimeout(() => {
    setStatus("Тайм-аут: задача " + id + " не завершилась за " + TIMEOUT_MS / 1000 + " с, Worker остановлен");
    pending = null;
    stopWorker();
  }, TIMEOUT_MS);

  // Время замеряем до postMessage: так в него входит копирование массива
  pending = { id, startTime: performance.now(), size: array.length, timerId };

  setStatus("Задача " + id + " отправлена в Worker...");
  getWorker().postMessage({ id, type: "stats", payload: { array, repeats } });
}

function onWorkerMessage(event) {
  const { id, ok, result, error } = event.data;

  // Ответ на старую (уже неактуальную) задачу игнорируем
  if (!pending || pending.id !== id) return;

  const totalMs = performance.now() - pending.startTime;
  const size = pending.size;
  finishPending();

  if (!ok) {
    setStatus("Задача " + id + ": " + error);
    return;
  }

  showResult(result);
  addLog(
    "Worker | " + size + " эл. | всего " + totalMs.toFixed(1) +
    " мс | вычисление внутри Worker " + result.computeMs.toFixed(1) + " мс"
  );
  setStatus("Задача " + id + " завершена");
}

function runWorker() {
  if (!data) return setStatus("Сначала сгенерируйте массив");
  startWorkerTask(data, getRepeats());
}

function cancelTask() {
  if (!pending || !worker) return setStatus("Нет задачи для отмены");
  worker.postMessage({ type: "cancel", id: pending.id });
  setStatus("Запрос отмены задачи " + pending.id + " отправлен");
}

function runErrorTest() {
  // Пустой массив: Worker должен вернуть { ok: false, error: ... }
  startWorkerTask(new Float64Array(0), 1);
}

function terminateWorker() {
  finishPending();
  stopWorker();
  setStatus("Worker завершён");
}

// ---------- Кнопки ----------
document.getElementById("btn-generate").addEventListener("click", generate);
document.getElementById("btn-main").addEventListener("click", runMain);
document.getElementById("btn-worker").addEventListener("click", runWorker);
document.getElementById("btn-cancel").addEventListener("click", cancelTask);
document.getElementById("btn-error").addEventListener("click", runErrorTest);
document.getElementById("btn-terminate").addEventListener("click", terminateWorker);