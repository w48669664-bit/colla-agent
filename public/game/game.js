(() => {
  "use strict";

  const GRID_SIZE = 20;
  const TICK_RATE = 150;
  const SCORE_PER_FOOD = 10;
  const STORAGE_KEY = "snake_high_score";
  const MAX_INPUT_QUEUE = 2;

  const STATES = Object.freeze({
    READY: "READY",
    RUNNING: "RUNNING",
    PAUSED: "PAUSED",
    GAME_OVER: "GAME_OVER",
  });

  const DIRECTIONS = Object.freeze({
    UP: { x: 0, y: -1 },
    DOWN: { x: 0, y: 1 },
    LEFT: { x: -1, y: 0 },
    RIGHT: { x: 1, y: 0 },
  });

  const OPPOSITE = Object.freeze({
    UP: "DOWN",
    DOWN: "UP",
    LEFT: "RIGHT",
    RIGHT: "LEFT",
  });

  const KEY_DIRECTIONS = Object.freeze({
    ArrowUp: "UP",
    KeyW: "UP",
    ArrowDown: "DOWN",
    KeyS: "DOWN",
    ArrowLeft: "LEFT",
    KeyA: "LEFT",
    ArrowRight: "RIGHT",
    KeyD: "RIGHT",
  });

  const canvas = document.querySelector("#game-canvas");
  const context = canvas.getContext("2d");
  const scoreElement = document.querySelector("#score");
  const bestScoreElement = document.querySelector("#best-score");
  const statusChip = document.querySelector("#status-chip");
  const statusLabel = statusChip.querySelector("b");
  const overlay = document.querySelector("#game-overlay");
  const overlayKicker = document.querySelector("#overlay-kicker");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayMessage = document.querySelector("#overlay-message");
  const overlayAction = document.querySelector("#overlay-action");
  const pauseButton = document.querySelector("#pause-button");
  const pauseLabel = document.querySelector("#pause-label");
  const restartButton = document.querySelector("#restart-button");
  const liveStatus = document.querySelector("#live-status");

  let snake = [];
  let food = { x: 14, y: 10 };
  let direction = "RIGHT";
  let inputQueue = [];
  let score = 0;
  let highScore = readHighScore();
  let gameState = STATES.READY;
  let timer = null;
  let renderSize = 600;
  let touchStart = null;
  let victory = false;

  function readHighScore() {
    try {
      const savedScore = Number.parseInt(window.localStorage.getItem(STORAGE_KEY) || "0", 10);
      return Number.isFinite(savedScore) && savedScore > 0 ? savedScore : 0;
    } catch {
      return 0;
    }
  }

  function persistHighScore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(highScore));
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }

  function formatScore(value) {
    return String(value).padStart(3, "0");
  }

  function initialSnake() {
    const middle = Math.floor(GRID_SIZE / 2);
    return [
      { x: middle, y: middle },
      { x: middle - 1, y: middle },
      { x: middle - 2, y: middle },
    ];
  }

  function clearTimer() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function startTimer() {
    clearTimer();
    timer = window.setInterval(() => advanceGame(false), TICK_RATE);
  }

  function resetGame({ autoStart = false } = {}) {
    clearTimer();
    snake = initialSnake();
    food = { x: 14, y: 10 };
    direction = "RIGHT";
    inputQueue = [];
    score = 0;
    victory = false;
    gameState = autoStart ? STATES.RUNNING : STATES.READY;

    if (autoStart) {
      startTimer();
    }

    updateInterface();
    draw();
    return getDebugState();
  }

  function startGame() {
    if (gameState === STATES.GAME_OVER) {
      resetGame({ autoStart: true });
      return;
    }

    if (gameState === STATES.READY || gameState === STATES.PAUSED) {
      gameState = STATES.RUNNING;
      startTimer();
      updateInterface();
    }
  }

  function pauseGame() {
    if (gameState !== STATES.RUNNING) {
      return false;
    }

    clearTimer();
    gameState = STATES.PAUSED;
    updateInterface();
    return true;
  }

  function togglePause() {
    if (gameState === STATES.RUNNING) {
      pauseGame();
    } else if (gameState === STATES.PAUSED || gameState === STATES.READY) {
      startGame();
    }
  }

  function requestDirection(requestedDirection, { beginPlay = true } = {}) {
    if (!Object.hasOwn(DIRECTIONS, requestedDirection)) {
      return false;
    }

    if (
      gameState === STATES.GAME_OVER ||
      inputQueue.length >= MAX_INPUT_QUEUE
    ) {
      return false;
    }

    const directionToValidate =
      inputQueue.length > 0
        ? inputQueue[inputQueue.length - 1]
        : direction;

    if (
      directionToValidate === requestedDirection ||
      OPPOSITE[directionToValidate] === requestedDirection
    ) {
      return false;
    }

    inputQueue.push(requestedDirection);

    if (
      beginPlay &&
      (gameState === STATES.READY || gameState === STATES.PAUSED)
    ) {
      startGame();
    }

    return true;
  }

  function advanceGame(manualStep) {
    if (gameState !== STATES.RUNNING && !manualStep) {
      return false;
    }

    if (inputQueue.length > 0) {
      direction = inputQueue.shift();
    }

    const movement = DIRECTIONS[direction];
    const head = snake[0];
    const nextHead = {
      x: head.x + movement.x,
      y: head.y + movement.y,
    };
    const eatsFood = nextHead.x === food.x && nextHead.y === food.y;
    const bodyToCheck = eatsFood ? snake : snake.slice(0, -1);

    if (isOutOfBounds(nextHead) || occupiesCell(nextHead, bodyToCheck)) {
      endGame(false);
      return true;
    }

    snake.unshift(nextHead);

    if (eatsFood) {
      score += SCORE_PER_FOOD;
      updateBestScore();
      const nextFood = chooseFood();

      if (nextFood === null) {
        endGame(true);
        return true;
      }

      food = nextFood;
    } else {
      snake.pop();
    }

    updateInterface();
    draw();
    return true;
  }

  function endGame(didWin) {
    clearTimer();
    victory = didWin;
    gameState = STATES.GAME_OVER;
    inputQueue = [];
    updateBestScore();
    updateInterface();
    draw();
    liveStatus.textContent = didWin
      ? `胜利，最终得分 ${score}`
      : `游戏结束，最终得分 ${score}`;
  }

  function updateBestScore() {
    if (score > highScore) {
      highScore = score;
      persistHighScore();
    }
  }

  function isOutOfBounds(cell) {
    return cell.x < 0 || cell.x >= GRID_SIZE || cell.y < 0 || cell.y >= GRID_SIZE;
  }

  function occupiesCell(cell, cells = snake) {
    return cells.some((segment) => segment.x === cell.x && segment.y === cell.y);
  }

  function chooseFood() {
    const availableCells = [];

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (!occupiesCell({ x, y })) {
          availableCells.push({ x, y });
        }
      }
    }

    if (availableCells.length === 0) {
      return null;
    }

    return availableCells[Math.floor(Math.random() * availableCells.length)];
  }

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect();
    const cssSize = Math.max(1, Math.round(bounds.width || 600));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const pixelSize = Math.round(cssSize * pixelRatio);

    if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
      canvas.width = pixelSize;
      canvas.height = pixelSize;
    }

    renderSize = cssSize;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw();
  }

  function draw() {
    const cellSize = renderSize / GRID_SIZE;
    context.clearRect(0, 0, renderSize, renderSize);
    context.fillStyle = "#08120e";
    context.fillRect(0, 0, renderSize, renderSize);

    drawGrid(cellSize);
    drawFood(cellSize);
    drawSnake(cellSize);
  }

  function drawGrid(cellSize) {
    context.save();
    context.beginPath();
    context.strokeStyle = "rgba(178, 255, 221, 0.055)";
    context.lineWidth = 1;

    for (let index = 1; index < GRID_SIZE; index += 1) {
      const position = Math.round(index * cellSize) + 0.5;
      context.moveTo(position, 0);
      context.lineTo(position, renderSize);
      context.moveTo(0, position);
      context.lineTo(renderSize, position);
    }

    context.stroke();
    context.restore();
  }

  function drawFood(cellSize) {
    const centerX = (food.x + 0.5) * cellSize;
    const centerY = (food.y + 0.5) * cellSize;
    const radius = cellSize * 0.23;

    context.save();
    context.shadowColor = "#ff9b62";
    context.shadowBlur = cellSize * 0.5;
    context.fillStyle = "#ff9b62";
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawSnake(cellSize) {
    const gap = Math.max(1.5, cellSize * 0.09);

    snake.forEach((segment, index) => {
      const inset = index === 0 ? gap * 0.62 : gap;
      const x = segment.x * cellSize + inset;
      const y = segment.y * cellSize + inset;
      const size = cellSize - inset * 2;

      context.save();
      context.fillStyle = index === 0 ? "#b8ffd8" : "#58e89e";

      if (index === 0) {
        context.shadowColor = "#6dffb3";
        context.shadowBlur = cellSize * 0.45;
      }

      roundedRect(context, x, y, size, size, Math.max(2, cellSize * 0.16));
      context.fill();
      context.restore();
    });
  }

  function roundedRect(drawingContext, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    drawingContext.beginPath();
    drawingContext.roundRect(x, y, width, height, safeRadius);
  }

  function updateInterface() {
    scoreElement.textContent = formatScore(score);
    bestScoreElement.textContent = formatScore(highScore);
    statusChip.dataset.state = gameState.toLowerCase();
    pauseButton.disabled =
      gameState === STATES.READY || gameState === STATES.GAME_OVER;

    if (gameState === STATES.RUNNING) {
      statusLabel.textContent = "运行中";
      pauseLabel.textContent = "暂停";
      overlay.classList.remove("is-visible");
      liveStatus.textContent = "游戏进行中";
      return;
    }

    overlay.classList.add("is-visible");

    if (gameState === STATES.READY) {
      statusLabel.textContent = "待命";
      pauseLabel.textContent = "暂停";
      overlayKicker.textContent = "准备就绪";
      overlayTitle.textContent = "开始游戏";
      overlayMessage.textContent = "吃掉能量点，不要撞上边界或自己。";
      overlayAction.textContent = "开始";
      liveStatus.textContent = "游戏待命";
    } else if (gameState === STATES.PAUSED) {
      statusLabel.textContent = "已暂停";
      pauseLabel.textContent = "继续";
      overlayKicker.textContent = "休息一下";
      overlayTitle.textContent = "游戏暂停";
      overlayMessage.textContent = `当前得分 ${score}，准备好后继续。`;
      overlayAction.textContent = "继续";
      liveStatus.textContent = "游戏已暂停";
    } else {
      statusLabel.textContent = victory ? "已通关" : "已结束";
      pauseLabel.textContent = "暂停";
      overlayKicker.textContent = victory ? "完美通关" : "本局结束";
      overlayTitle.textContent = victory ? "全盘制霸" : "游戏结束";
      overlayMessage.textContent = `最终得分 ${score} · 最高纪录 ${highScore}`;
      overlayAction.textContent = "再来一局";
    }
  }

  function setDebugFood(x, y) {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x >= GRID_SIZE ||
      y < 0 ||
      y >= GRID_SIZE ||
      occupiesCell({ x, y })
    ) {
      return false;
    }

    food = { x, y };
    draw();
    return true;
  }

  function getDebugState() {
    return {
      gameState,
      score,
      highScore,
      snake: snake.map((segment) => ({ ...segment })),
      food: { ...food },
      direction,
    };
  }

  function setDebugDirection(requestedDirection) {
    const normalizedDirection = String(requestedDirection).toUpperCase();

    if (
      !Object.hasOwn(DIRECTIONS, normalizedDirection) ||
      gameState === STATES.GAME_OVER
    ) {
      return false;
    }

    return requestDirection(normalizedDirection, { beginPlay: false });
  }

  function handleKeydown(event) {
    const requestedDirection = KEY_DIRECTIONS[event.code];

    if (requestedDirection) {
      event.preventDefault();
      requestDirection(requestedDirection);
      return;
    }

    if (event.code === "Space" || event.code === "KeyP") {
      event.preventDefault();
      togglePause();
    } else if (event.code === "KeyR") {
      event.preventDefault();
      resetGame({ autoStart: true });
    }
  }

  function handleTouchStart(event) {
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
    event.preventDefault();
  }

  function handleTouchMove(event) {
    event.preventDefault();
  }

  function handleTouchEnd(event) {
    if (!touchStart) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    const distance = Math.hypot(deltaX, deltaY);
    touchStart = null;
    event.preventDefault();

    if (distance < 22) {
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      requestDirection(deltaX > 0 ? "RIGHT" : "LEFT");
    } else {
      requestDirection(deltaY > 0 ? "DOWN" : "UP");
    }
  }

  document.addEventListener("keydown", handleKeydown);
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
  overlayAction.addEventListener("click", startGame);
  pauseButton.addEventListener("click", togglePause);
  restartButton.addEventListener("click", () => resetGame({ autoStart: true }));

  document.querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      requestDirection(button.dataset.direction);
    });
  });

  window.addEventListener("resize", resizeCanvas);

  if ("ResizeObserver" in window) {
    new ResizeObserver(resizeCanvas).observe(canvas);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && gameState === STATES.RUNNING) {
      pauseGame();
    }
  });

  window.addEventListener("blur", () => {
    if (gameState === STATES.RUNNING) {
      pauseGame();
    }
  });

  window.__snakeDebug = Object.freeze({
    getState: getDebugState,
    setFood: setDebugFood,
    setDirection: setDebugDirection,
    step() {
      if (gameState !== STATES.READY && gameState !== STATES.PAUSED) {
        return false;
      }

      if (gameState === STATES.READY) {
        gameState = STATES.PAUSED;
      }

      return advanceGame(true);
    },
    triggerGameOver() {
      endGame(false);
    },
    reset() {
      return resetGame();
    },
  });

  resetGame();
  resizeCanvas();
})();
