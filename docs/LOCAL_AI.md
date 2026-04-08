# Local AI for CodexCar

## 1. Ollama
- `ollama --version`
- модель: `qwen2.5:7b-instruct`

## 2. Models folder
```powershell
$env:OLLAMA_MODELS='E:\AI\LocalAI\models'
```

## 3. Run local parser server
В корне проекта:

```powershell
npm run ai:server
```

Сервер поднимется на:

`http://127.0.0.1:11535`

## 4. What it does now
- принимает короткую запись владельца
- отправляет ее в локальный `Ollama`
- возвращает структуру для журнала:
  - `note`
  - `category`
  - `partName`
  - `rating`
  - `cost`
  - `nextMileage`

## 5. Important
- без запущенного локального сервера запись все равно сохраняется локально
- AI-парсинг работает только на том ПК, где запущены `Ollama` и `npm run ai:server`
