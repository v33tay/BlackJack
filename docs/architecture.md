# Архитектура

## 1. Назначение и границы

Браузерная игра в блэкджек для компании в локальной сети: сервер на Node.js без фреймворков, клиент на чистом JavaScript, синхронизация по WebSocket (README.md:3). Сервер — единственный источник истины для ставок, ходов и выплат (README.md:13; room-manager.js:67-126).

Входит: HTTP-раздача клиента и `/health`/`/status` (http-server.js:8-34); WebSocket-команды и состояние стола (websocket-server.js:33-67); автоцикл стола без хозяина (room-manager.js:328-356); боты, докупка, выход и переподключение по токену (blackjack-table.js:89-191; room-manager.js:207-277).

Не входит: аутентификация, база данных и сохранение между перезапусками — состояние живёт в памяти процесса (README.md:112-119); HTTPS/TLS — есть только список `ALLOWED_ORIGINS` (websocket-server.js:14-18); страховка, сдача и повторный сплит (docs/rules.md:46-51); другие игры — `createTable` создаёт только `BlackjackTable` (room-manager.js:134).

## 2. Технологический стек и требования

- Node.js >= 18 (`engines`, package.json:16-18); единственная runtime-зависимость — `ws ^8.18.3` (package.json:26-28).
- Сервер — CommonJS и `"use strict"`, стандартные `node:http`, `node:crypto`, `node:fs`, `node:path`, `node:os`; сторонних HTTP/WS-фреймворков нет (http-server.js:3-5; room-manager.js:3-4; local-addresses.js:1).
- Клиент — статический `index.html`, `scripts/main.js`, `styles/main.css`; IIFE без сборщика (main.js:1-2).
- Разработка: Jest ^30.2.0, ESLint ^9.39.5, `@eslint/js`, `globals` (package.json:20-25); ESLint `ecmaVersion: 2023`, окружения node/browser/jest (eslint.config.js:10-43).
- Команды: `npm start`, `npm run dev`, `npm test` (`jest --runInBand`), `npm run test:coverage`, `npm run lint` (package.json:7-15).
- Конфигурация из env: `PORT`, `HOST`, `BETTING_TIME_MS`, `ROUND_PAUSE_MS`, `EMPTY_TABLE_TTL_MS`, `TURN_TIMEOUT_MS`, `RECONNECT_GRACE_MS`, `ALLOWED_ORIGINS` (config.js:28-47; README.md:51-62).

## 3. Карта каталогов

| Модуль | Ответственность |
|---|---|
| `src/server/index.js` | загрузка конфигурации, `listen`, адреса сети, `SIGINT`/`SIGTERM` (index.js:7-49) |
| `src/server/app.js` | сборка `RoomManager` + HTTP + WebSocket, `listen`/`close` (app.js:7-47) |
| `src/server/config.js` | чтение и валидация env, значения по умолчанию (config.js:15-47) |
| `src/server/http/http-server.js` | белый список статики, `/health`, `/status`, `/favicon.ico`, HEAD/405 (http-server.js:8-45) |
| `src/server/websocket/websocket-server.js` | WebSocket, heartbeat, Origin, `maxPayload`, разбор JSON, ошибки (websocket-server.js:8-85) |
| `src/server/network/local-addresses.js` | IPv4-адреса для лога запуска (local-addresses.js:3-14) |
| `src/server/rooms/room-manager.js` | сессии, столы, таймеры, очередь, переподключение, автоцикл (room-manager.js:21-562) |
| `src/server/game/blackjack-table.js` | фазы стола, ставки, раздача, ходы, дилер, расчёт (blackjack-table.js:52-535) |
| `src/server/game/rules.js` | чистые `handValue`, `blackjackPayout`, `settleHand` (rules.js:3-28) |
| `src/server/game/cards.js` | `Card`, `Deck`, `Hand`, сборка шуза (cards.js:9-99) |
| `src/server/game/bot-strategies.js` | типы ботов, имена, ставки, `chooseBotAction` (bot-strategies.js:6-63) |
| `src/server/game/constants.js` | числовые константы (constants.js:1-14) |
| `src/server/game/errors.js` | `GameError { code, message }` (errors.js:3-9) |
| `src/client/scripts/main.js` | WS-клиент, optimistic bet, render, reconnect (main.js:70-199,231-251,503-572) |
| `src/client/index.html`, `styles/main.css` | разметка и стили, отдаются по белому списку (http-server.js:8-13) |
| `tests/{unit,server,integration,client}` | unit, игровая логика, HTTP/WS, DOM-песочница |
| `tests/helpers` | `deck.js`, `websocket.js`, `dom.js`, `client-app.js` |
| `scripts/start.bat`, `scripts/start.sh` | запуск с установкой зависимостей (README.md:32-35) |

## 4. Поток запроса

```mermaid
flowchart LR
  B[main.js: клик] -->|HTTP GET| H[http-server.js]
  B -->|JSON по WebSocket| W[websocket-server.js]
  H -->|PUBLIC_FILES, /health, /status| B
  W -->|JSON.parse| M[RoomManager.handle]
  M -->|create/join/resume/leave| S[сессии, столы, резервы]
  M -->|bet/ready/hit/stand/double/split/rebuy/addBot/removeBot| T[BlackjackTable]
  T --> R[rules.js]
  T --> C[cards.js]
  M -->|afterCommand → finishBetting/advance, syncTimers| T
  M -->|snapshot(viewerId) → state| W
  W --> B
```

Путь действия, например `hit`:
1. `sendAction` отправляет JSON и блокирует повтор до `state` или таймаута 2 с (main.js:131-142).
2. `websocket-server` разбирает кадр и вызывает `manager.handle(sessionId, command)` (websocket-server.js:50-63).
3. `handle` находит сессию и маршрутизирует команду в метод стола (room-manager.js:67-126).
4. `BlackjackTable.hit` проверяет ход через `requireTurn`, тянет карту, при переборе или 21 завершает руку и вызывает `advanceTurn` (blackjack-table.js:237-245,529-534).
5. `afterCommand` обрабатывает очередь, затем запускает раунд или вызывает `advance` (room-manager.js:328-335).
6. `syncTimers` взводит таймеры до рассылки, `broadcast` отправляет каждому `state` (room-manager.js:352-355,320-326).
7. `snapshot(viewerId)` собирает проекцию; клиент вызывает `render` (blackjack-table.js:398-479; main.js:189-198).

Выплата выполняется на сервере в `settleRound` при переходе в `over` (blackjack-table.js:373-396); клиент только отображает `hand.result` (main.js:394-429).

## 5. Жизненный цикл

- **Подключение.** На `connection` регистрируется сессия `{ id, send, roomCode: null, playerId: null, token: null }`; лимит `MAX_SESSIONS = 400`, при переполнении — ошибка и закрытие 1013 (websocket-server.js:33-48; room-manager.js:58-65). Закрытие сокета вызывает `manager.disconnect(sessionId)` (websocket-server.js:65).
- **Создание и вход.** `create` проверяет отсутствие места и лимит `MAX_ROOMS = 200`, генерирует 6-символьный hex-код, создаёт `BlackjackTable`, добавляет создателя с токеном и запоминает `creatorId` (room-manager.js:128-140,300-309). `join` проверяет код `/^[A-F0-9]{6}$/` и имя 1–20 символов, сажает за стол или ставит в `pendingJoins` (если очередь не заполнена), когда все 6 мест заняты ботами, а фаза не `waiting`/`over` (room-manager.js:142-181).
- **Ставка.** `advance` при `waiting` вызывает `openBetting`: фаза `betting`, у людей ставка `DEFAULT_BET = 0`, у ботов — `getBotBet`, боты сразу `ready` (room-manager.js:351; blackjack-table.js:142-155). `setBet` принимает целое `0..balance` с шагом `BET_STEP = 1` и сбрасывает `ready`; `ready` меняет флаг (blackjack-table.js:43-50,163-177). `rebuy` возвращает `STARTING_BALANCE`, только если `balance < MIN_BET` (blackjack-table.js:179-191).
- **Раунд.** `finishBetting` вызывает `beginRound`, если есть `activePlayers` (`connected && bet >= MIN_BET && balance >= bet`) (room-manager.js:380-390; blackjack-table.js:125-135). `beginRound` увеличивает `round`, списывает ставки, раздаёт по схеме игрок–дилер–игрок–дилер, сразу завершает блэкджеки, при блэкджеке дилера уходит в `over`, иначе ставит `phase = "player"` (blackjack-table.js:193-235).
- **Ходы.** `hit`, `stand`, `doubleDown`, `split` доступны только текущему игроку и руке; `advanceTurn` идёт по `turnQueue`, по исчерпании ставит `phase = "dealer"` (blackjack-table.js:237-304,481-497). Дилер открывает карты и добирает при `value < 17`, затем `settleRound` (blackjack-table.js:306-328).
- **Выплата.** `settleRound` начисляет `payout` из `settleHand`; формулы, округление и исключения — в [docs/rules.md](rules.md). Ставка списана в `beginRound`, поэтому возврат или выигрыш начисляется в `balance` (blackjack-table.js:211,373-396; rules.js:13-28).
- **Переподключение.** При обрыве игрок получает `connected = false`, `ready = false`, его руки закрываются `standAll`, а токен резервируется на `RECONNECT_GRACE_MS` (room-manager.js:234-268). `resume` сверяет токен с `reservations` и `player.token`, снимает резерв, привязывает сессию и возвращает `connected = true` (room-manager.js:207-223). Клиентские шаги и backoff — в [docs/protocol.md](protocol.md).
- **Выход и удаление стола.** `leave` освобождает сессию, удаляет игрока и отправляет `left` (room-manager.js:225-232). После grace `finalizeDisconnect` удаляет игрока (room-manager.js:270-277). Когда `players.length === 0`, `advance` ставит таймер `EMPTY_TABLE_TTL_MS`; по нему `removeRoom` чистит таймеры, `playerSessions` и резервы (room-manager.js:340-348,490-499,531-541). Отключённое, но зарезервированное место удерживает стол до истечения grace.

## 6. Состояние и владение данными

| Структура | Владелец | Содержимое |
|---|---|---|
| `sessions` | `RoomManager` | `Map<sessionId, { id, send, roomCode, playerId, token }>` (room-manager.js:49,63) |
| `playerSessions` | `RoomManager` | `Map<playerId, session>` — соединение, владеющее местом (room-manager.js:50,283) |
| `rooms` | `RoomManager` | `Map<code, BlackjackTable>` (room-manager.js:48,137) |
| `reservations` | `RoomManager` | `Map<token, { code, playerId, timer }>` (room-manager.js:51,261) |
| `pendingJoins` | `RoomManager` | `Map<code, Array<{ session, name }>>` (room-manager.js:55,170) |
| `phaseTimers`, `dealerTimers`, `emptyTableTimers` | `RoomManager` | `Map<code, handle>` для фаз, дилера и удаления (room-manager.js:52-54) |
| `BlackjackTable` | `rooms` | `code`, `creatorId`, `players`, `phase`, `round`, `deck`, `dealer`, `turnQueue`, `currentTurnIndex`, `dealerVisibleCardCount`, `phaseEndsAt` (blackjack-table.js:53-66) |
| Player | `BlackjackTable.players` | `id`, `name`, `token`, `balance`, `bet`, `ready`, `hands`, `connected`; у бота ещё `isBot`, `botType` (blackjack-table.js:30-40,95-97) |
| Hand | Player | `cards`, `bet`, `isSplit`, `doubled`, `finished`, `result` (cards.js:68-76) |

Источник истины — `BlackjackTable`: карты, балансы, ставки, фазы и результаты. `RoomManager` владеет транспортом, сессиями, таймерами и очередями, но меняет игру только через методы стола. Клиент — проекция: получает `snapshot(viewerId)` и хранит токен места в `localStorage` (main.js:70-85,189-198). Скрытая карта дилера не сериализуется до фаз `dealer`/`over` (blackjack-table.js:398-405). Постоянного хранилища нет: перезапуск сбрасывает столы и балансы (README.md:114).

## 7. Автоцикл стола

После команды, меняющей стол, `afterCommand` вызывает `processPendingJoins`; если фаза `betting` и `allReady()`, то `finishBetting`, иначе `advance` (room-manager.js:328-335,137-140). `allReady` учитывает только `connected`-игроков и требует хотя бы одного (blackjack-table.js:137-140).

`advance` (room-manager.js:337-356) вызывает `processPendingJoins`, снимает таймер удаления, а без `connected`-игроков чистит таймеры, переводит стол в `waiting` через `resetToWaiting` и ставит удаление только при `players.length === 0`. Иначе при `waiting` вызывается `openBetting`, затем `syncTimers` и `broadcast`. Таймеры взводятся до рассылки, поэтому `timer.remainingMs` уже есть в том же `state` (room-manager.js:352-355; blackjack-table.js:421-423). `finishBetting` без активных игроков не начинает раунд, а заново открывает ставки (room-manager.js:381-387).

```text
waiting --кто-то сел--> betting --allReady | BETTING_TIME_MS--> player
   ▲                       ▲                                      │
   │                       └──── ROUND_PAUSE_MS ──── over ◄──── dealer
   └── нет connected ───────────────────────────────────────────────
```

## 8. Таймеры и фазы

| Таймер | Владелец | Константа и значение | Где | Назначение |
|---|---|---|---|---|
| Приём ставок | `phaseTimers` | `BETTING_TIME_MS = 10_000`; env, минимум 1000 | room-manager.js:392-408; config.js:40 | вызвать `finishBetting`, выставить `phaseEndsAt` |
| Ход игрока | `phaseTimers` | `TURN_TIMEOUT_MS = 60_000`; `0` отключает | room-manager.js:440-456 | авто-`stand` и передача хода |
| Ход бота | `phaseTimers` | `350` мс, отдельной константы нет | room-manager.js:428-439 | `playBotTurn`, до 12 действий |
| Пауза после раунда | `phaseTimers` | `ROUND_PAUSE_MS = 5_000` | room-manager.js:410-422 | `openBetting` и следующий раунд |
| Шаг дилера | `dealerTimers` | `dealerDelay()`: 850/1600/1200/1000/800/600 мс, константы нет | room-manager.js:473-488; blackjack-table.js:320-328 | открыть карту, добрать или рассчитать |
| Хранение места | `reservations` | `RECONNECT_GRACE_MS = 60_000`; `0` отключает | room-manager.js:256-261 | `finalizeDisconnect` после grace |
| Удаление пустого стола | `emptyTableTimers` | `EMPTY_TABLE_TTL_MS = 300_000`; `0` отключает | room-manager.js:490-499 | `removeRoom`, если игроков нет |
| Heartbeat WebSocket | `WebSocketServer` | `HEARTBEAT_INTERVAL_MS = 30_000`, env-настройки нет | websocket-server.js:5,20-31 | `ping` и `terminate` мёртвых клиентов |

Все таймеры `RoomManager` инжектируются через `setTimeoutFn`/`clearTimeoutFn` (room-manager.js:22-23,36-37); callback каждой фазы проверяет, что стол всё ещё в `rooms` и фаза не сменилась (room-manager.js:399,417,432-433,446-447,478).

## 9. Контракт клиент-сервер

Транспорт — WebSocket по тому же host/port, JSON-объекты, `maxPayload = 4096` (websocket-server.js:11,14-18). Команды клиента:

| `type` | Поля | Смысл |
|---|---|---|
| `create` | `name` | создать стол и сесть (room-manager.js:75-77) |
| `join` | `code`, `name` | сесть по коду (room-manager.js:78-80) |
| `resume` | `token` | восстановить место (room-manager.js:81-83) |
| `leave` | — | выйти из-за стола (room-manager.js:84-86) |
| `bet` | `amount` | ставка (room-manager.js:93-95) |
| `ready` | `ready` | готовность, `false` — отменить (room-manager.js:96-98) |
| `hit`, `stand`, `double`, `split` | — | ходы (room-manager.js:99-110) |
| `rebuy` | — | докупка (room-manager.js:111-113) |
| `addBot` | `botType` | добавить бота, только создатель (room-manager.js:114-117) |
| `removeBot` | `playerId` | убрать бота, только создатель (room-manager.js:118-121) |

Сообщения сервера:

| `type` | Поля | Смысл |
|---|---|---|
| `state` | `state` | полная проекция стола для игрока (room-manager.js:320-326; blackjack-table.js:414-479) |
| `error` | `code`, `message` | ошибка команды; `code` стабилен (websocket-server.js:72-80) |
| `left` | — | подтверждение выхода (room-manager.js:230) |
| `queued` | `message` | игрок ждёт место бота (room-manager.js:172) |

`state` содержит верхнеуровневые поля `code`, `round`, `phase` (`waiting`/`betting`/`player`/`dealer`/`over`), `viewerId`, `currentPlayerId`, `currentHandIndex`, `timer`, `dealer`, `rules`, `viewer` и `players`; полная схема `state`, флаги `viewer` и коды ошибок — в [docs/protocol.md](protocol.md). Неизвестный `type` при месте за столом даёт `UNKNOWN_COMMAND`, без места — `NOT_SEATED` (room-manager.js:91-124,311-318). Команды `start` нет.

## 10. Обработка ошибок и инварианты

- `GameError` несёт `code` и `message` (errors.js:3-9). `websocket-server` отправляет `{ type: "error", code, message }`, если `error.code` — строка; иначе логирует и отправляет `INTERNAL` (websocket-server.js:72-80).
- Некорректный JSON даёт `COMMAND_INVALID` без закрытия сокета; команда не-объект или массив — тоже `COMMAND_INVALID` (websocket-server.js:50-57; room-manager.js:70-72). Превышение `maxPayload` и переполнение сессий закрывают соединение (websocket-server.js:14-18,42-48).
- HTTP: неизвестный путь — 404, метод кроме GET/HEAD — 405, ошибка чтения файла — 500 (http-server.js:36-50).

Инварианты:
- Сервер проверяет ставки, ходы и выплаты; клиент не является источником истины (README.md:13).
- Ставка — безопасное целое, `0 <= amount <= balance`, кратное `BET_STEP = 1`; изменение ставки сбрасывает `ready` (blackjack-table.js:43-50,163-170).
- Ход принадлежит только `currentPlayer` и текущей руке; иначе `NOT_YOUR_TURN` (blackjack-table.js:529-534).
- В раунд попадают только `connected`-игроки со ставкой не ниже `MIN_BET` и покрытием баланса (blackjack-table.js:125-135,193-213).
- Ставка списывается один раз в `beginRound`; `doubleDown` и `split` списывают разницу; `settleRound` пропускает руки с уже установленным `result`, предотвращая двойную выплату (blackjack-table.js:211,263-304,379-395).
- `forceSettle` возвращает ставку как `push` для всех незавершённых рук (blackjack-table.js:359-371).
- Скрытая карта дилера отсутствует в `snapshot` до `dealer`/`over` (blackjack-table.js:398-405).
- `drawCard` пересобирает шуз при исчерпании; `split` тянет обе карты до изменения состояния (blackjack-table.js:512-515,286-294).
- Ботами управляет только `creatorId`, и только в фазах `waiting`/`betting`/`over` (room-manager.js:294-298; blackjack-table.js:89-123).
- Токен места — bearer-токен: `resume` требует точного совпадения; неудачный `resume` очищает резерв (room-manager.js:207-223; README.md:117).
- Callback таймера не срабатывает для удалённого или сменившего фазу стола (room-manager.js:399,417,432-433,446-447,478).

Будущие улучшения и ограничения — в [docs/todo.md](todo.md) и [README.md](../README.md#ограничения).

## 11. Точки расширения

- **Новая игра.** `RoomManager.createTable` напрямую создаёт `BlackjackTable` (room-manager.js:134), а `handle` и `processPendingJoins` вызывают его методы (`setBet`, `setReady`, `hit`, `replaceBotWithPlayer`). Фабрики столов и реестра игр нет: для второй игры потребуется заменить создание стола и маршрутизацию команд.
- **Новое правило.** Чистые правила — `handValue`, `blackjackPayout`, `settleHand` в `rules.js`; свойства руки — геттеры `Hand` в `cards.js` (rules.js:3-28; cards.js:78-98). Порог дилера (`< 17`) и обработка блэкджека находятся в `BlackjackTable` (blackjack-table.js:306-317,221-230).
- **Новый бот.** Добавить тип в `BOT_TYPES`, долю в `BOT_BET_FRACTIONS`, имена в `BOT_NAMES` и ветку в `chooseBotAction` (bot-strategies.js:6-63). `addBot`/`removeBot` уже общие; `playBotTurn` сопоставляет `hit`/`double`/`split`/`stand` (room-manager.js:459-471). Новый тип автоматически попадёт в `rules.botTypes` снапшота (blackjack-table.js:431-437).
- **Новая команда.** Ветка в `RoomManager.handle` и вызов в `main.js`; иначе `UNKNOWN_COMMAND` (room-manager.js:74-124). Полный контракт и коды ошибок — в `docs/protocol.md`.
- **Новый HTTP-маршрут.** Только через `PUBLIC_FILES` или отдельную проверку в `createHttpServer` (http-server.js:8-45); роутера нет.
- **Новая фаза или таймер.** Константа в `constants.js`, ветка `syncTimers`, переход в `BlackjackTable` и обработка в `afterCommand`/`advance` (constants.js:8-12; room-manager.js:358-378).

## 12. Тестирование

- Jest, `testEnvironment: "node"`, корень `tests`, покрытие собирается с `src/server/**` и `src/client/**` (jest.config.js:3-8); `npm test` запускает `jest --runInBand` (package.json:10).
- **Фейковые таймеры.** Jest fake timers не используются. `RoomManager` принимает `setTimeoutFn`/`clearTimeoutFn`; тест подставляет функции, складывающие `{ callback, delay, cleared }` в массив `timers`, а `pendingTimer`/`fireTimer` находят таймер по задержке и вызывают callback вручную (tests/server/room-manager.test.js:8-50). Шаги дилера прокручиваются через `table.dealerDelay()` (tests/server/room-manager.test.js:57-64); `turnTimeoutMs: 0` отключает авто-пас там, где он мешает (tests/server/room-manager.test.js:20).
- **`deckFactory`.** `BlackjackTable` принимает фабрику колоды (blackjack-table.js:53; room-manager.js:134); тесты используют `createExactDeck(ranks)` и `createFullDeck(ranks)` с `shuffle: false`, задавая точные первые карты (tests/helpers/deck.js:15-28). Фабрика инжектируется и в `RoomManager` (tests/server/room-manager.test.js:11), и в интеграционный сервер (tests/integration/app.test.js:24-27).
- **Что покрыто.** Unit: выплаты, карты, конфигурация, локальные адреса, стратегии ботов (tests/unit/*.test.js). Server: жизненный цикл `BlackjackTable` и `RoomManager` — ставки, боты, очереди, таймеры, grace, удаление стола, лимиты (tests/server/*.test.js). Integration: статика, `/health`/`/status`, создание и вход, готовность, ошибки, reconnect, выход, закрытие при превышении payload (tests/integration/app.test.js:47-218). Client: DOM-песочница, ставки, готовность, действия, ошибки, reconnect (tests/client/app.test.js).
- Пороги покрытия: statements 78, branches 68, functions 85, lines 82 (jest.config.js:9-16). Нагрузочные и случайные последовательности — в [docs/todo.md](todo.md).
