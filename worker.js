// Размер блока: после каждого блока Worker может проверить, не пришла ли отмена
const CHUNK_SIZE = 100000;
// Как часто (в мс) отдавать управление, чтобы Worker успел получить сообщение "cancel"
const PAUSE_EVERY_MS = 50;

// Идентификаторы задач, которые просили отменить
const cancelled = new Set();

self.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "cancel") {
    cancelled.add(message.id);
  } else if (message.type === "stats") {
    calcStats(message.id, message.payload);
  } else {
    self.postMessage({ id: message.id, ok: false, error: "Неизвестный тип сообщения: " + message.type });
  }
});

// Обработка одного блока. Цикл вынесен в обычную (не async) функцию:
function processChunk(array, start, end, state) {
  let sum = state.sum;
  let min = state.min;
  let max = state.max;

  for (let i = start; i < end; i++) {
    const value = array[i];
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  state.sum = sum;
  state.min = min;
  state.max = max;
}

async function calcStats(id, payload) {
  try {
    const { array, repeats } = payload;

    if (!array || array.length === 0) {
      throw new Error("Массив пустой");
    }

    const startTime = performance.now();
    let lastPause = startTime;
    let state = { sum: 0, min: Infinity, max: -Infinity };

    for (let pass = 0; pass < repeats; pass++) {
      state = { sum: 0, min: Infinity, max: -Infinity };

      // Считаем по блокам
      for (let start = 0; start < array.length; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE, array.length);
        processChunk(array, start, end, state);

        // Раз в PAUSE_EVERY_MS отдаём управление и проверяем отмену
        if (performance.now() - lastPause >= PAUSE_EVERY_MS) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          lastPause = performance.now();

          if (cancelled.has(id)) {
            cancelled.delete(id);
            self.postMessage({ id, ok: false, error: "Задача отменена" });
            return;
          }
        }
      }
    }

    const computeMs = performance.now() - startTime;
    const { sum, min, max } = state;
    const average = sum / array.length;

    self.postMessage({ id, ok: true, result: { sum, average, min, max, computeMs } });
  } catch (error) {
    // Ошибку передаём как обычную строку (её можно сериализовать)
    self.postMessage({ id, ok: false, error: error.message });
  }
}