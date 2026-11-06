# Протокол WebSocket

Транспорт — WebSocket по тому же адресу и порту, что и HTTP. Сообщения — JSON-объекты, максимальный размер входящего сообщения 4 КБ, превышение закрывает соединение.

## Команды клиента

| Команда | Поля | Описание |
| --- | --- | --- |
| `create` | `name` | создать стол и сразу сесть за него |
| `join` | `code`, `name` | сесть за стол по шестизначному коду |
| `resume` | `token` | вернуть место после обрыва связи |
| `bet` | `amount` | ставка от 0 до баланса (0 — пропуск раунда) |
| `ready` | `ready` | подтвердить готовность (`false` — отменить) |
| `hit` | — | взять карту |
| `stand` | — | остановиться |
| `double` | — | удвоить ставку и взять одну карту |
| `split` | — | разделить пару на две руки |
| `rebuy` | — | докупить фишки, если на балансе 0 |
| `addBot` | `botType` | добавить бота (`risky`, `thoughtful`, `timid`); только создатель, между раундами |
| `removeBot` | `playerId` | убрать бота; только создатель, между раундами |
| `leave` | — | выйти из-за стола |

Команды `start` больше нет: раунды начинаются автоматически.

## Сообщения сервера

### `state`

Полное состояние стола, собранное для конкретного игрока:

```json
{
  "type": "state",
  "state": {
    "code": "A1B2C3",
    "round": 3,
    "phase": "betting",
    "viewerId": "...",
    "currentPlayerId": null,
    "currentHandIndex": -1,
    "timer": { "remainingMs": 9400 },
    "dealer": { "cards": [], "value": null, "hidden": false },
    "rules": { "maxPlayers": 6, "minBet": 1, "betStep": 1, "startingBalance": 1000, "botTypes": { "risky": "Рискованный", "thoughtful": "Продуманный", "timid": "Трусливый" } },
    "viewer": {
      "id": "...", "token": "...", "isCreator": true,
      "canManageBots": true, "canManageBotsNow": true,
      "balance": 950, "bet": 50, "ready": false, "connected": true,
      "handIndex": -1,
      "canBet": true, "canReady": true, "canUnready": false,
      "canHit": false, "canStand": false, "canDouble": false, "canSplit": false,
      "canRebuy": false, "sittingOut": false
    },
    "players": [
      { "id": "...", "name": "Алексей", "isBot": false, "botType": null, "balance": 950, "bet": 50, "ready": false, "connected": true, "hands": [] }
    ]
  }
}
```

- `phase`: `waiting` | `betting` | `player` | `dealer` | `over`.
- `timer.remainingMs` — сколько осталось до конца текущей фазы (приём ставок, ход игрока, пауза после раунда) или `null`, если таймера нет.
- `viewer` — что разрешено именно этому игроку; клиент не дублирует правила у себя.
- `viewer.token` — секрет только для владельца места; используется в `resume`.
- Карманная карта дилера не покидает сервер, пока её не пора открыть.

### `error`

```json
{ "type": "error", "code": "NOT_YOUR_TURN", "message": "Сейчас ход другого игрока." }
```

`code` стабилен и предназначен для программной обработки, `message` — готовый текст для интерфейса.

### `left`

```json
{ "type": "left" }
```

Подтверждение выхода из-за стола: место освобождено, токен больше не действует.

## Коды ошибок

| Код | Когда возникает |
| --- | --- |
| `COMMAND_INVALID` | тело команды не JSON или не объект |
| `SESSION_NOT_FOUND` | команда пришла из неизвестной сессии |
| `NOT_SEATED` | действие требует места за столом |
| `UNKNOWN_COMMAND` | неизвестный тип команды |
| `CODE_INVALID` | код стола не соответствует формату |
| `ROOM_NOT_FOUND` | стол не найден или уже удалён |
| `TABLE_FULL` | за столом уже 6 игроков |
| `ALREADY_SEATED` | игрок уже за столом |
| `ROUND_IN_PROGRESS` | ставки или докупка недоступны во время раунда |
| `ROUND_NOT_READY` | раунд нельзя начать: ещё не идёт приём ставок |
| `NAME_INVALID` | имя пустое или длиннее 20 символов |
| `BET_INVALID`, `BET_TOO_HIGH` | ставка дробная, отрицательная или больше баланса |
| `NOT_YOUR_TURN` | действие вне своего хода |
| `DOUBLE_UNAVAILABLE`, `SPLIT_UNAVAILABLE` | правило не позволяет действие |
| `NO_ACTIVE_PLAYERS` | никто не поставил, раунд не начать |
| `REBUY_UNAVAILABLE` | докупка доступна только при нулевом балансе |
| `BOT_TYPE_INVALID` | несуществующий тип бота |
| `BOT_PERMISSION_DENIED` | ботами пытается управлять не создатель стола |
| `BOT_NOT_FOUND` | бот не найден за этим столом |
| `RESUME_FAILED` | место не сохранено или срок хранения истёк |
| `TOO_MANY_ROOMS`, `TOO_MANY_SESSIONS` | превышены серверные лимиты |
| `INTERNAL` | непредвиденная ошибка сервера |

## Переподключение

1. Клиент открывает WebSocket и получает `state`, сохраняя `state.viewer.token` в `localStorage`.
2. При обрыве сервер помечает игрока `connected: false`, автоматически закрывает его руки и держит место `RECONNECT_GRACE_MS`.
3. Клиент переподключается с задержкой (1 → 2 → 4 → ... → 15 секунд) и отправляет `resume` с сохранённым токеном.
4. Если место ещё живо, сервер возвращает состояние того же игрока; иначе приходит `RESUME_FAILED`, и клиент возвращается в лобби.
