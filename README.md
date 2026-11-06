# BlackJack

Браузерная игра в блэкджек для компании: сервер на Node.js без фреймворков, клиент на чистом JavaScript, синхронизация через WebSocket. Играть можно по локальной сети — регистрация и база данных не нужны.

## Возможности

- до 6 игроков за одним столом с общим шузом из 6 колод
- стол работает сам: нет хозяина и кнопки «старт», раунды идут по кругу
- окно ставок 10 секунд: кнопки +10/+25/+50, «Готов» и ставка по умолчанию 0
- раунд начинается, когда готовы все игроки или истекло окно ставок
- пустой стол удаляется через 5 минут
- автоматический дилер с пошаговым вскрытием карт
- ставки, добор, остановка, удвоение и сплит
- сервер — единственный источник истины: ставки, ходы и выплаты проверяются на сервере
- восстановление места после обрыва связи (токен места в `localStorage`)
- выход из-за стола и докупка фишек, если их не хватает на минимальную ставку
- авто-пас игрока, который отключился или не успел сделать ход
- боты трёх типов: «Рискованный», «Продуманный» и «Трусливый», с автоматическими ходами и случайными никнеймами
- создатель стола может добавлять и убирать ботов только между раундами
- устойчивость к исчерпанию колоды: шуз пересобирается, раунд не ломается
- защита от двойных нажатий и повторной отправки действий
- запуск на Windows и Linux

## Быстрый старт

1. Установите Node.js 18 или новее.
2. В корне проекта выполните:

```bash
npm install
npm start
```

3. Откройте в браузере `http://localhost:3000`.

Готовые скрипты сами установят зависимости, если их нет:

- Linux/macOS: `./scripts/start.sh`
- Windows: `scripts\start.bat`

Сервер печатает и адреса для локальной сети, например `http://192.168.1.23:3000`.

## Скрипты

| Команда | Что делает |
| --- | --- |
| `npm start` | запуск сервера |
| `npm run dev` | запуск с автоперезапуском при изменении файлов |
| `npm test` | все тесты |
| `npm run test:watch` | тесты в режиме наблюдения |
| `npm run test:coverage` | тесты с покрытием и порогами |
| `npm run lint` | ESLint по всему проекту |
| `npm run lint:fix` | ESLint с автоисправлениями |

## Переменные окружения

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `PORT` | `3000` | порт HTTP и WebSocket |
| `HOST` | `0.0.0.0` | адрес прослушивания |
| `BETTING_TIME_MS` | `10000` | окно приёма ставок, не меньше 1000 |
| `ROUND_PAUSE_MS` | `5000` | пауза с результатом до новых ставок |
| `EMPTY_TABLE_TTL_MS` | `300000` | сколько живёт стол без игроков |
| `TURN_TIMEOUT_MS` | `60000` | лимит времени на ход, `0` отключает |
| `RECONNECT_GRACE_MS` | `60000` | сколько место держится за отключившимся игроком, `0` отключает |
| `ALLOWED_ORIGINS` | не задано | список Origin через запятую; если пусто — принимаются любые |

## Управление

- «Создать стол» — вы садитесь за новый стол; кнопка «Готов» появляется сразу.
- Ставка по умолчанию 0. Кнопки `+10`, `+25`, `+50` добавляют фишки, `0` сбрасывает ставку, поле ввода позволяет задать сумму вручную.
- «Готов» подтверждает ставку. Раунд стартует, когда готовы все, или через 10 секунд. Ставка 0 означает пропуск раунда.
- Причина пропуска раунда (ставка 0, нехватка фишек, обрыв связи) показывается в строке статуса под картами и не сдвигает интерфейс.
- После раунда показывается результат, затем ставки сбрасываются и начинается новый приём ставок.
- «Докупить фишки» появляется, когда на балансе не осталось фишек.
- «Выйти из-за стола» освобождает место; если игроков не осталось, стол удаляется через `EMPTY_TABLE_TTL_MS`.
- Создатель стола может добавлять и убирать ботов между раундами: выберите тип «Рискованный», «Продуманный» или «Трусливый». Бот получает случайный никнейм и автоматически играет по своей стратегии.
- Если закрыть вкладку или пропадёт сеть, место сохраняется на время `RECONNECT_GRACE_MS`.

## Структура проекта

```text
BlackJack/
├── src/                         код приложения
│   ├── client/                  статические файлы браузерного клиента
│   │   ├── index.html
│   │   ├── scripts/main.js
│   │   └── styles/main.css
│   └── server/                  сервер и игровая логика
│       ├── index.js             точка входа и завершение процесса
│       ├── app.js               сборка HTTP, WebSocket и менеджера комнат
│       ├── config.js            конфигурация из переменных окружения
│       ├── game/                карты, правила и состояние стола
│       │   ├── blackjack-table.js
│       │   ├── bot-strategies.js  типы и стратегии ботов
│       │   ├── cards.js
│       │   ├── constants.js
│       │   ├── errors.js
│       │   └── rules.js
│       ├── http/http-server.js  HTTP-сервер и раздача статики
│       ├── network/local-addresses.js
│       ├── rooms/room-manager.js
│       └── websocket/websocket-server.js
├── tests/                       автоматические тесты
│   ├── unit/                    правила, карты, конфигурация, сеть
│   ├── server/                  игровая логика и менеджер комнат
│   ├── integration/             HTTP и WebSocket
│   ├── client/                  клиент в DOM-песочнице
│   └── helpers/                 общие тестовые утилиты
├── scripts/                     скрипты запуска для Windows и Linux/macOS
│   ├── start.bat
│   └── start.sh
├── docs/                        архитектура, правила, протокол и TODO
├── .github/workflows/ci.yml     проверки линтера и тестов на Node.js 20/22/24
├── .editorconfig                единый стиль файлов
├── .gitignore                   исключения для Git
├── .nvmrc                       рекомендуемая версия Node.js
├── eslint.config.js             конфигурация ESLint
├── jest.config.js               конфигурация Jest и пороги покрытия
├── package.json                 метаданные, зависимости и команды npm
├── package-lock.json            зафиксированные версии зависимостей
├── CHANGELOG.md                 история версий
├── LICENSE
└── README.md
```

`node_modules/` и `coverage/` создаются локально и исключены из Git; исходники, тесты, документация и конфигурация хранятся отдельно.

## Документация

- [Правила стола](docs/rules.md)
- [Протокол WebSocket](docs/protocol.md)
- [Архитектура](docs/architecture.md)
- [План задач и возможных улучшений](docs/todo.md)
- [История изменений](CHANGELOG.md)

## Качество

```bash
npm run lint
npm run test:coverage
```

Покрытие серверного кода закреплено порогами в `jest.config.js` (не ниже 78% операторов и 68% ветвей).

## Служебные endpoint'ы

- `GET /health` — `ok` для проверки живости.
- `GET /status` — `{ rooms, sessions, players, uptime }` в JSON.

## Ограничения

- состояние столов и балансы хранятся в памяти процесса: перезапуск сервера их сбрасывает
- проект рассчитан на локальную сеть; для публичного интернета нужен HTTPS/WSS и `ALLOWED_ORIGINS`
- нет страховки, сдачи и повторного сплита
- токен места — это bearer-токен: кто его узнал, может занять место

## Устранение неполадок

- **Другие игроки не подключаются.** Проверьте, что сервер запущен на `0.0.0.0`, порт не блокирует файрвол, и используйте адрес из строки `Network:` в логе сервера.
- **`Cannot find module 'ws'`.** Выполните `npm install` (скрипты в `scripts/` делают это сами).
- **После перезагрузки страницы потерялось место.** Место живёт `RECONNECT_GRACE_MS`; если время вышло, займите место заново — баланс начинается с 1000 фишек.
- **Страница не обновляется.** Статика отдаётся с `cache-control: no-store`, достаточно обычного обновления.

---

## English

Browser-based blackjack for a group of friends: a framework-free Node.js server and a vanilla JavaScript client, synchronized over WebSocket. No accounts and no database — it is meant for a local network.

### Features

- up to 6 players at one table sharing a 6-deck shoe
- the table runs itself: no host and no start button, rounds follow each other automatically
- a 10-second betting window with +10/+25/+50 chips, a ready button and a zero default bet
- a round starts when everyone is ready or when the betting window expires
- empty tables are removed after 5 minutes
- automatic dealer that reveals cards step by step
- bets, hit, stand, double down and split
- the server is the single source of truth for bets, turns and payouts
- seat recovery after a dropped connection (seat token in `localStorage`)
- leaving the table and a rebuy for players who cannot cover the minimum bet
- automatic stand for players who disconnect or run out of time
- three bot types: Risky, Thoughtful and Timid, with automatic turns and random nicknames
- the table creator can add or remove bots between rounds only
- safe shoe exhaustion: the shoe is rebuilt and the round survives
- protection against double clicks and duplicate actions

### Quick start

```bash
npm install
npm start
```

Then open `http://localhost:3000`. The server prints local network addresses as well. Platform scripts live in `scripts/` and install dependencies automatically.

During a game, the table creator can add or remove bots between rounds. Choose Risky, Thoughtful or Timid; bots get random nicknames and play automatically using their selected strategy.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | start the server |
| `npm run dev` | start with file watching |
| `npm test` | run all tests |
| `npm run test:coverage` | tests with coverage thresholds |
| `npm run lint` | ESLint |

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | listen address |
| `BETTING_TIME_MS` | `10000` | betting window, at least 1000 |
| `ROUND_PAUSE_MS` | `5000` | result pause before the next bets |
| `EMPTY_TABLE_TTL_MS` | `300000` | how long an empty table is kept |
| `TURN_TIMEOUT_MS` | `60000` | turn limit, `0` disables it |
| `RECONNECT_GRACE_MS` | `60000` | how long a disconnected seat is reserved, `0` disables it |
| `ALLOWED_ORIGINS` | unset | comma-separated Origin allow-list for WebSocket |

### Project layout

```text
src/          application code: browser client and Node.js server
              bot strategies live in src/server/game/bot-strategies.js
tests/        unit, server, integration and client tests plus helpers
scripts/      platform-specific start scripts
docs/         architecture, rules, WebSocket protocol and TODO
.github/      CI workflow
root files    npm, ESLint, Jest, Node.js and editor configuration
```

`node_modules/` and `coverage/` are generated locally and excluded from Git.

### Documentation

- [Table rules](docs/rules.md)
- [WebSocket protocol](docs/protocol.md)
- [Architecture](docs/architecture.md)
- [Changelog](CHANGELOG.md)

### Limitations

- tables and balances live in process memory and are lost on restart
- designed for a trusted local network; use HTTPS/WSS plus `ALLOWED_ORIGINS` in public deployments
- no insurance, surrender or re-split
- the seat token is a bearer token: whoever learns it can take the seat

---

© 2026
