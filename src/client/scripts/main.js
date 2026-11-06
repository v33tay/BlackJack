(() => {
  "use strict";

  const DEAL_STEP_MS = 300;
  const CARD_ANIMATION_MS = 260;
  const ERROR_VISIBLE_MS = 4500;
  const RESULT_VISIBLE_MS = 4000;
  const ACTION_TIMEOUT_MS = 2000;
  const TIMER_TICK_MS = 250;
  const RECONNECT_BASE_MS = 1000;
  const RECONNECT_MAX_MS = 15000;
  const TOKEN_KEY = "blackjack:seat-token";

  const elements = {
    connectionStatus: document.querySelector("#connection-status"),
    balanceBox: document.querySelector("#balance-box"),
    balance: document.querySelector("#balance"),
    lobby: document.querySelector("#lobby"),
    lobbyMessage: document.querySelector("#lobby-message"),
    name: document.querySelector("#player-name"),
    roomCode: document.querySelector("#room-code"),
    create: document.querySelector("#create-button"),
    join: document.querySelector("#join-button"),
    gameView: document.querySelector("#game-view"),
    roomCodeDisplay: document.querySelector("#room-code-display"),
    seatCount: document.querySelector("#seat-count"),
    phaseTimer: document.querySelector("#phase-timer"),
    seats: document.querySelector("#seats"),
    bet: document.querySelector("#bet"),
    betClear: document.querySelector("#bet-clear"),
    chip10: document.querySelector("#chip-10"),
    chip25: document.querySelector("#chip-25"),
    chip50: document.querySelector("#chip-50"),
    ready: document.querySelector("#ready-button"),
    hit: document.querySelector("#hit-button"),
    stand: document.querySelector("#stand-button"),
    double: document.querySelector("#double-button"),
    split: document.querySelector("#split-button"),
    leave: document.querySelector("#leave-button"),
    rebuy: document.querySelector("#rebuy-button"),
    dealerCards: document.querySelector("#dealer-cards"),
    dealerScore: document.querySelector("#dealer-score"),
    playerHands: document.querySelector("#player-hands"),
    message: document.querySelector("#message"),
    roundResult: document.querySelector("#round-result"),
    appError: document.querySelector("#app-error")
  };

  let socket = null;
  let pendingCommands = [];
  let state = null;
  let optimisticBet = null;
  let isAnimatingInitialDeal = false;
  let lastRound = 0;
  let roundTimeout = null;
  let errorTimeout = null;
  let resultTimeout = null;
  let actionTimeout = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let awaitingState = false;
  let leaving = false;
  let timerDeadline = null;
  let timerPhase = null;
  let timerTick = null;
  const handElements = new Map();

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function writeToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // приватный режим браузера: работаем без сохранения места
    }
  }

  function setStatus(text) {
    elements.connectionStatus.textContent = text;
  }

  function showError(message) {
    elements.appError.textContent = message;
    elements.appError.hidden = false;
    if (errorTimeout !== null) window.clearTimeout(errorTimeout);
    errorTimeout = window.setTimeout(() => {
      errorTimeout = null;
      elements.appError.hidden = true;
    }, ERROR_VISIBLE_MS);
  }

  function showLobbyMessage(message) {
    elements.lobbyMessage.textContent = message;
    elements.lobbyMessage.hidden = false;
  }

  function clearLobbyMessage() {
    elements.lobbyMessage.textContent = "";
    elements.lobbyMessage.hidden = true;
  }

  function isOpen() {
    return Boolean(socket) && socket.readyState === WebSocket.OPEN;
  }

  function send(command) {
    if (!isOpen()) {
      pendingCommands.push(command);
      connect();
      return;
    }
    socket.send(JSON.stringify(command));
  }

  function sendAction(command) {
    if (awaitingState) return;
    awaitingState = true;
    if (actionTimeout !== null) window.clearTimeout(actionTimeout);
    actionTimeout = window.setTimeout(() => {
      actionTimeout = null;
      awaitingState = false;
      render();
    }, ACTION_TIMEOUT_MS);
    send(command);
    render();
  }

  function connect() {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    leaving = false;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}`);
    setStatus("Подключаемся...");
    elements.create.disabled = true;
    elements.join.disabled = true;

    socket.addEventListener("open", () => {
      setStatus("Подключено");
      elements.create.disabled = false;
      elements.join.disabled = false;
      const queued = pendingCommands;
      pendingCommands = [];
      for (const command of queued) socket.send(JSON.stringify(command));
    });
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", () => {
      setStatus("Ошибка подключения");
      showError("Не удалось подключиться к серверу. Проверьте адрес и запущен ли сервер.");
    });
  }

  function onMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showError("Сервер прислал некорректный ответ.");
      return;
    }
    if (message.type === "error") {
      onServerError(message);
      return;
    }
    if (message.type === "left") {
      onLeft();
      return;
    }
    if (message.type === "state") {
      state = message.state;
      awaitingState = false;
      optimisticBet = null;
      reconnectAttempt = 0;
      clearLobbyMessage();
      if (state.viewer?.token) writeToken(state.viewer.token);
      render();
    }
  }

  function onServerError(message) {
    awaitingState = false;
    optimisticBet = null;
    if (message.code === "RESUME_FAILED") {
      writeToken(null);
      state = null;
      render();
    }
    showError(message.message || "Неизвестная ошибка сервера.");
  }

  function onLeft() {
    writeToken(null);
    state = null;
    optimisticBet = null;
    awaitingState = false;
    leaving = false;
    updatePhaseTimer(null, null);
    for (const handElement of handElements.values()) handElement.section.remove();
    handElements.clear();
    elements.playerHands.replaceChildren();
    elements.dealerCards.replaceChildren();
    elements.dealerScore.textContent = "";
    elements.roundResult.className = "round-result";
    elements.roundResult.setAttribute("aria-hidden", "true");
    elements.roundResult.textContent = "";
    render();
    showLobbyMessage("Вы вышли из-за стола.");
  }

  function onClose() {
    setStatus("Нет соединения с сервером");
    elements.create.disabled = false;
    elements.join.disabled = false;
    awaitingState = false;
    pendingCommands = [];
    if (leaving) return;
    const token = readToken();
    if (!token || !state) {
      showError("Соединение с сервером потеряно. Обновите страницу, чтобы подключиться снова.");
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    setStatus(`Переподключение через ${Math.round(delay / 1000)} с...`);
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      pendingCommands.push({ type: "resume", token });
      connect();
    }, delay);
  }

  function cardElement(card, delay = 0) {
    const element = document.createElement("div");
    const hidden = card.hidden === true;
    const red = ["\u2665", "\u2666"].includes(card.suit);
    element.className = `playing-card dealing${hidden ? " hidden" : ""}${red ? " red" : ""}`;
    element.style.animationDelay = `${delay}ms`;
    if (hidden) {
      element.setAttribute("aria-label", "Закрытая карта дилера");
      return element;
    }
    element.setAttribute("aria-label", `${card.rank} ${card.suit}`);
    const top = document.createElement("span");
    top.textContent = card.rank;
    const center = document.createElement("span");
    center.className = "card-center";
    center.textContent = card.suit;
    const bottom = document.createElement("span");
    bottom.className = "card-bottom";
    bottom.textContent = card.rank;
    element.append(top, center, bottom);
    return element;
  }

  function renderCards(container, cards, delayForIndex = null) {
    cards.forEach((card, index) => {
      const existing = container.children[index];
      const cardId = card.hidden ? "hidden" : `${card.rank}${card.suit}`;
      if (existing?.dataset.cardId === cardId) return;
      const element = cardElement(card, delayForIndex ? delayForIndex(index) : 0);
      element.dataset.cardId = cardId;
      if (existing) container.replaceChild(element, existing);
      else container.append(element);
    });
    while (container.children.length > cards.length) container.lastElementChild.remove();
  }

  function renderSeats(rules, viewerBet) {
    elements.seats.replaceChildren();
    elements.seatCount.textContent = `${state.players.length} / ${rules.maxPlayers} игроков`;
    for (let index = 0; index < rules.maxPlayers; index += 1) {
      const player = state.players[index];
      const seat = document.createElement("div");
      seat.className = `seat${player?.id === state.currentPlayerId ? " active" : ""}${player && !player.connected ? " offline" : ""}`;
      if (!player) {
        seat.textContent = "Свободное место";
      } else {
        const name = document.createElement("strong");
        name.textContent = player.name;
        const balance = document.createElement("span");
        balance.textContent = player.connected ? `${player.balance} чипов` : `${player.balance} чипов · нет связи`;
        const status = document.createElement("span");
        status.className = "seat-status";
        // Своя ставка берётся из локального значения: место не отстаёт от поля ввода.
        const bet = player.id === state.viewerId ? viewerBet : player.bet;
        if (!player.connected) status.textContent = "нет связи";
        else if (state.phase === "betting") status.textContent = player.ready ? "✓ готов" : `ставка ${bet}`;
        else if (player.hands.length) status.textContent = `ставка ${player.hands[0].bet}`;
        else status.textContent = `ставка ${bet}`;
        seat.append(name, balance, status);
      }
      elements.seats.append(seat);
    }
  }

  function renderPlayerHands(initialDeal = false) {
    const activePlayers = state.players.filter((player) => player.hands.length > 0);
    const activeHandKeys = new Set();
    let position = 0;
    activePlayers.forEach((player) => {
      const playerIndex = activePlayers.indexOf(player);
      player.hands.forEach((hand, handIndex) => {
        const key = `${player.id}:${handIndex}`;
        activeHandKeys.add(key);
        let handElement = handElements.get(key);
        if (!handElement) {
          const section = document.createElement("section");
          const heading = document.createElement("div");
          const cards = document.createElement("div");
          heading.className = "hand-heading";
          cards.className = "cards";
          section.append(heading, cards);
          handElement = { section, heading, cards };
          handElements.set(key, handElement);
        }
        const isActive = player.id === state.currentPlayerId && handIndex === state.currentHandIndex;
        handElement.section.className = `hand${isActive ? " active" : ""}`;
        const handLabel = player.hands.length > 1 ? ` · рука ${handIndex + 1}` : "";
        handElement.heading.textContent = `${player.name}${handLabel} · ${hand.value}`;
        renderCards(
          handElement.cards,
          hand.cards,
          initialDeal ? (cardIndex) => {
            const dealIndex = cardIndex === 0
              ? playerIndex
              : activePlayers.length + 1 + playerIndex;
            return dealIndex * DEAL_STEP_MS;
          } : null
        );
        if (elements.playerHands.children[position] !== handElement.section) {
          elements.playerHands.insertBefore(
            handElement.section,
            elements.playerHands.children[position] ?? null
          );
        }
        position += 1;
      });
    });
    for (const [key, handElement] of handElements) {
      if (!activeHandKeys.has(key)) {
        handElement.section.remove();
        handElements.delete(key);
      }
    }
  }

  function dealerMessage() {
    if (state.dealer.hidden) return "Дилер открывает закрытую карту...";
    const value = state.dealer.value;
    if (value >= 21) return `У дилера ${value}. Кажется, всё решено...`;
    if (value >= 17) return `У дилера ${value}. Сейчас станет ясно, кто победил...`;
    return `У дилера ${value}. Ему нужна ещё одна карта...`;
  }

  function roundOutcome(hand) {
    return {
      blackjack: "БЛЭКДЖЕК!",
      win: "ПОБЕДА!",
      lose: "ПОРАЖЕНИЕ",
      push: "НИЧЬЯ"
    }[hand.result] || "";
  }

  function renderResult() {
    const outcomes = state.players.flatMap((player) => player.hands
      .filter((hand) => hand.result)
      .map((hand, handIndex) => {
        const label = state.players.filter((entry) => entry.hands.length > 0).length > 1
          ? `${player.name}${player.hands.length > 1 ? ` · рука ${handIndex + 1}` : ""}: `
          : "";
        return `${label}${roundOutcome(hand)}`;
      }));
    const visible = state.phase === "over" && outcomes.length > 0;
    if (resultTimeout !== null) {
      window.clearTimeout(resultTimeout);
      resultTimeout = null;
    }
    if (visible) {
      elements.roundResult.textContent = outcomes.join("\n");
      resultTimeout = window.setTimeout(() => {
        resultTimeout = null;
        elements.roundResult.className = "round-result";
        elements.roundResult.setAttribute("aria-hidden", "true");
      }, RESULT_VISIBLE_MS);
    } else {
      elements.roundResult.textContent = "";
    }
    elements.roundResult.className = `round-result${visible ? " visible" : ""}`;
    elements.roundResult.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function currentBet() {
    return optimisticBet ?? state?.viewer?.bet ?? 0;
  }

  function normalizeBet(rawValue) {
    const balance = state?.viewer?.balance ?? 0;
    const amount = Math.floor(Number(rawValue));
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, Math.min(amount, balance));
  }

  function applyBet(next) {
    if (!state?.viewer?.canBet) return;
    const amount = normalizeBet(next);
    // Поле сразу показывает то, что уйдёт на сервер, иначе подсказка и ввод расходятся.
    elements.bet.value = String(amount);
    if (amount === currentBet()) {
      render();
      return;
    }
    optimisticBet = amount;
    send({ type: "bet", amount });
    render();
  }

  function statusMessage(viewer, betValue) {
    switch (state.phase) {
      case "waiting":
        return "Ждём игроков: как только кто-то сядет за стол, начнётся приём ставок.";
      case "betting":
        if (!viewer) return "Приём ставок.";
        if (!viewer.connected) return "Нет связи с сервером — восстанавливаем место.";
        if (viewer.canRebuy) return "На балансе не осталось фишек — докупите, чтобы играть.";
        if (betValue < (state.rules?.minBet ?? 1)) {
          return "Ставка 0: этот раунд пройдёт без вас. Добавьте фишки и нажмите «Готов».";
        }
        if (betValue > viewer.balance) return "Ставка больше баланса — уменьшите её.";
        if (viewer.ready) return "Вы готовы. Раунд начнётся, когда будут готовы все.";
        return "Сделайте ставку и нажмите «Готов». Раунд начнётся автоматически.";
      case "player":
        return state.currentPlayerId === state.viewerId
          ? "Ваш ход. Возьмите карту или остановитесь."
          : `Ход игрока ${state.players.find((player) => player.id === state.currentPlayerId)?.name ?? ""}.`;
      case "dealer":
        return dealerMessage();
      default:
        return "Раунд завершён. Следующий начнётся автоматически.";
    }
  }

  function updatePhaseTimer(remainingMs, phase) {
    timerPhase = phase;
    timerDeadline = typeof remainingMs === "number" ? Date.now() + remainingMs : null;
    paintPhaseTimer();
  }

  function paintPhaseTimer() {
    if (timerTick !== null) {
      window.clearTimeout(timerTick);
      timerTick = null;
    }
    if (timerDeadline === null) {
      elements.phaseTimer.textContent = "";
      return;
    }
    const labels = { betting: "Ставки", player: "Ход", over: "Дальше" };
    const seconds = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
    const label = labels[timerPhase] ?? "Время";
    elements.phaseTimer.textContent = `${label}: ${seconds} с`;
    if (seconds > 0) timerTick = window.setTimeout(paintPhaseTimer, TIMER_TICK_MS);
  }

  function render() {
    const inGame = state !== null;
    elements.lobby.hidden = inGame;
    elements.gameView.hidden = !inGame;
    elements.balanceBox.hidden = !inGame;
    if (!inGame) return;

    const rules = state.rules ?? { maxPlayers: 6, minBet: 1, betStep: 1 };
    const viewer = state.viewer;
    const betValue = optimisticBet ?? viewer?.bet ?? 0;
    elements.balance.textContent = String(viewer?.balance ?? 0);
    elements.roomCodeDisplay.textContent = state.code;
    renderSeats(rules, betValue);

    if (state.round > lastRound) {
      lastRound = state.round;
      isAnimatingInitialDeal = true;
      if (roundTimeout !== null) window.clearTimeout(roundTimeout);
      elements.dealerCards.replaceChildren();
      for (const handElement of handElements.values()) handElement.cards.replaceChildren();
      const playerCount = state.players.filter((player) => player.hands.length > 0).length;
      const lastDealDelay = (playerCount * 2 + 1) * DEAL_STEP_MS;
      roundTimeout = window.setTimeout(() => {
        isAnimatingInitialDeal = false;
        render();
      }, lastDealDelay + CARD_ANIMATION_MS);
    }

    const dealerCards = state.dealer.cards;
    const playerCount = state.players.filter((player) => player.hands.length > 0).length;
    renderCards(
      elements.dealerCards,
      dealerCards,
      isAnimatingInitialDeal
        ? (index) => (playerCount + index * (playerCount + 1)) * DEAL_STEP_MS
        : (index) => index === dealerCards.length - 1 ? 0 : null
    );
    elements.dealerScore.textContent = state.dealer.value === null ? "" : String(state.dealer.value);
    renderPlayerHands(isAnimatingInitialDeal);
    elements.message.textContent = isAnimatingInitialDeal ? "Карты раздаются..." : statusMessage(viewer, betValue);
    renderResult();
    updatePhaseTimer(state.timer?.remainingMs ?? null, state.phase);

    const busy = isAnimatingInitialDeal || awaitingState;
    elements.bet.min = "0";
    elements.bet.step = String(rules.betStep ?? 1);
    elements.bet.max = String(viewer?.balance ?? 0);
    elements.bet.disabled = !viewer?.canBet;
    if (document.activeElement !== elements.bet) elements.bet.value = String(betValue);

    const canAddChips = Boolean(viewer?.canBet) && !busy && (viewer?.balance ?? 0) > betValue;
    elements.chip10.disabled = !canAddChips;
    elements.chip25.disabled = !canAddChips;
    elements.chip50.disabled = !canAddChips;
    elements.betClear.disabled = !viewer?.canBet || busy || betValue === 0;

    elements.ready.disabled = !(viewer?.canReady || viewer?.canUnready) || busy;
    elements.ready.textContent = viewer?.ready ? "Отменить готовность" : "Готов";
    elements.ready.className = `button ${viewer?.ready ? "button-secondary" : "button-primary"}`;

    elements.hit.disabled = !viewer?.canHit || busy;
    elements.stand.disabled = !viewer?.canStand || busy;
    elements.double.disabled = !viewer?.canDouble || busy;
    elements.split.disabled = !viewer?.canSplit || busy;
    elements.rebuy.hidden = !viewer?.canRebuy;
    elements.leave.hidden = false;
  }

  function playerName() {
    const name = elements.name.value.trim();
    if (!name) {
      showLobbyMessage("Введите своё имя.");
      elements.name.focus();
      return null;
    }
    return name;
  }

  elements.create.addEventListener("click", () => {
    const name = playerName();
    if (name) send({ type: "create", name });
  });
  elements.join.addEventListener("click", () => {
    const name = playerName();
    if (!name) return;
    const code = elements.roomCode.value.trim().toUpperCase();
    if (!code) {
      showLobbyMessage("Введите код стола.");
      elements.roomCode.focus();
      return;
    }
    send({ type: "join", name, code });
  });
  elements.bet.addEventListener("change", () => applyBet(elements.bet.value));
  elements.chip10.addEventListener("click", () => applyBet(currentBet() + 10));
  elements.chip25.addEventListener("click", () => applyBet(currentBet() + 25));
  elements.chip50.addEventListener("click", () => applyBet(currentBet() + 50));
  elements.betClear.addEventListener("click", () => applyBet(0));
  elements.ready.addEventListener("click", () => {
    if (!state?.viewer) return;
    sendAction({ type: "ready", ready: !state.viewer.ready });
  });
  elements.hit.addEventListener("click", () => sendAction({ type: "hit" }));
  elements.stand.addEventListener("click", () => sendAction({ type: "stand" }));
  elements.double.addEventListener("click", () => sendAction({ type: "double" }));
  elements.split.addEventListener("click", () => sendAction({ type: "split" }));
  elements.rebuy.addEventListener("click", () => sendAction({ type: "rebuy" }));
  elements.leave.addEventListener("click", () => {
    if (!state) return;
    leaving = true;
    send({ type: "leave" });
  });

  elements.appError.hidden = true;
  render();
})();
