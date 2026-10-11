(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("game-canvas");
  const ctx = canvas.getContext("2d");
  const stage = $("stage");
  const keys = new Set();
  const panels = { ready: $("ready-panel"), paused: $("paused-panel"), gameover: $("gameover-panel") };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const random = (min, max) => min + Math.random() * (max - min);
  const bestKey = "meteor-dodge.best.v1";
  let best = 0;
  try {
    const saved = Number(window.localStorage.getItem(bestKey));
    if (Number.isFinite(saved) && saved >= 0) best = Math.floor(saved);
  } catch { /* The game also works when browser storage is blocked. */ }

  const view = { width: 960, height: 540, scale: 1 };
  const player = { x: 480, y: 470, radius: 12, invulnerable: 0, tilt: 0 };
  let state = "ready";
  let elapsed = 0;
  let cosmeticTime = 0;
  let score = 0;
  let bonus = 0;
  let lives = 3;
  let sector = 1;
  let flightBest = best;
  let meteorTimer = 0;
  let starTimer = 0;
  let meteors = [];
  let collectibles = [];
  let particles = [];
  let backgroundStars = [];
  let pointerTarget = null;
  let shake = 0;
  let lastFrame = performance.now();
  let background;
  let audio = null;
  let soundEnabled = false;

  function rememberBest() {
    best = Math.max(best, score);
    try { window.localStorage.setItem(bestKey, String(best)); } catch { /* Session record still works. */ }
  }

  function updateHud() {
    const number = (n) => String(n).padStart(4, "0");
    const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
    setText("score", number(score));
    setText("best", number(Math.max(best, score)));
    const seconds = Math.floor(elapsed);
    setText("time", `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
    setText("sector", `SECTOR ${String(sector).padStart(2, "0")}`);
    const livesLabel = `${lives} ${lives === 1 ? "life" : "lives"}`;
    if ($("lives").getAttribute("aria-label") !== livesLabel) $("lives").setAttribute("aria-label", livesLabel);
    [...$("lives").children].forEach((heart, index) => heart.classList.toggle("lost", index >= lives));
  }

  function setState(next) {
    state = next;
    stage.dataset.state = next;
    $("overlay").hidden = next === "running";
    Object.entries(panels).forEach(([name, panel]) => { panel.hidden = name !== next; });
    $("pause-button").disabled = next !== "running";
    const labels = { ready: "AWAITING LAUNCH", running: "FLIGHT IN PROGRESS", paused: "FLIGHT PAUSED", gameover: "FLIGHT COMPLETE" };
    $("flight-status").textContent = labels[next];
    keys.clear();
    pointerTarget = null;
    $("announcement").textContent = next === "gameover"
      ? `Flight complete. ${score} points. Your personal best is ${best}.`
      : labels[next].toLowerCase();
  }

  function tone(start, end, duration, type = "sine") {
    if (!soundEnabled || !audio || audio.state !== "running") return;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(end, audio.currentTime + duration);
    volume.gain.setValueAtTime(0.035, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    oscillator.connect(volume);
    volume.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
  }

  function startFlight() {
    rememberBest();
    flightBest = best;
    elapsed = score = bonus = 0;
    lives = 3;
    sector = 1;
    meteors = [];
    collectibles = [];
    particles = [];
    meteorTimer = 0.8;
    starTimer = 1.7;
    shake = 0;
    player.x = view.width / 2;
    player.invulnerable = 0;
    player.tilt = 0;
    lastFrame = performance.now();
    setState("running");
    canvas.focus({ preventScroll: true });
    if (audio && soundEnabled) audio.resume().catch(() => {});
    tone(240, 520, 0.18, "triangle");
    updateHud();
  }

  function pauseFlight() {
    if (state !== "running") return;
    rememberBest();
    setState("paused");
  }

  function resumeFlight() {
    if (state !== "paused") return;
    lastFrame = performance.now();
    setState("running");
    canvas.focus({ preventScroll: true });
  }

  function finishFlight() {
    const isRecord = score > flightBest;
    rememberBest();
    setState("gameover");
    $("final-score").textContent = score.toLocaleString();
    $("result-message").textContent = isRecord ? "A new personal best. That's your sky." : "Let's give that sky another go.";
    updateHud();
  }

  function resize() {
    const oldWidth = view.width;
    const oldHeight = view.height;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    view.width = rect.width;
    view.height = rect.height;
    view.scale = clamp(rect.width / 900, 0.6, 1.1);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    player.x = clamp(player.x * view.width / oldWidth, 22 * view.scale, view.width - 22 * view.scale);
    player.y = view.height - 54 * view.scale;
    player.radius = 12 * view.scale;
    [...meteors, ...collectibles].forEach((item) => {
      item.x *= view.width / oldWidth;
      item.y *= view.height / oldHeight;
      item.speed *= view.height / oldHeight;
    });
    particles = [];
    backgroundStars = Array.from({ length: Math.round(clamp(view.width / 7, 55, 150)) }, () => ({
      x: random(0, view.width), y: random(0, view.height), size: random(0.5, 1.7), speed: random(3, 15), phase: random(0, 6.3),
    }));
    background = ctx.createLinearGradient(0, 0, view.width, view.height);
    background.addColorStop(0, "#091727");
    background.addColorStop(0.55, "#0d2136");
    background.addColorStop(1, "#07111f");
    pauseFlight();
  }

  function burst(x, y, color, count = 18) {
    for (let i = 0; i < (reducedMotion ? 4 : count); i++) {
      const angle = random(0, Math.PI * 2);
      const speed = random(25, 160) * view.scale;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: random(0.2, 0.65), color });
    }
    if (particles.length > 130) particles.splice(0, particles.length - 130);
  }

  function spawnMeteor() {
    const radius = random(16, 33) * view.scale;
    meteors.push({
      x: random(radius + 8, view.width - radius - 8), y: -radius * 2, radius,
      speed: view.height * (0.21 + sector * 0.019) * random(0.8, 1.2),
      drift: random(-14, 14) * view.scale, angle: random(0, 6.3), spin: random(-1, 1),
      shape: Array.from({ length: 10 }, () => random(0.78, 1.1)),
    });
  }

  function spawnStar() {
    collectibles.push({ x: random(24, view.width - 24), y: -20, radius: 10 * view.scale, speed: view.height * 0.23 });
  }

  function overlaps(item) {
    const dx = item.x - player.x;
    const dy = item.y - player.y;
    const radius = player.radius + item.radius * 0.8;
    return dx * dx + dy * dy < radius * radius;
  }

  function update(dt) {
    elapsed += dt;
    sector = Math.min(8, 1 + Math.floor(elapsed / 18));
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    const direction = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
    const before = player.x;
    if (direction) player.x += direction * view.width * 0.75 * dt;
    else if (pointerTarget !== null) player.x += (pointerTarget - player.x) * Math.min(1, dt * 19);
    player.x = clamp(player.x, 22 * view.scale, view.width - 22 * view.scale);
    player.tilt += (clamp((player.x - before) / (view.scale * 18), -0.45, 0.45) - player.tilt) * Math.min(1, dt * 10);
    meteorTimer -= dt;
    starTimer -= dt;
    if (meteorTimer <= 0) { spawnMeteor(); meteorTimer = Math.max(0.21, 0.73 - sector * 0.065); }
    if (starTimer <= 0) { spawnStar(); starTimer = random(1.5, 2.3); }

    for (let i = collectibles.length - 1; i >= 0; i--) {
      const star = collectibles[i];
      star.y += star.speed * dt;
      if (overlaps(star)) {
        bonus += 25;
        burst(star.x, star.y, "#c4f76a", 16);
        tone(660, 1150, 0.12);
        collectibles.splice(i, 1);
      } else if (star.y > view.height + 30) collectibles.splice(i, 1);
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const meteor = meteors[i];
      meteor.y += meteor.speed * dt;
      meteor.x += meteor.drift * dt;
      meteor.angle += meteor.spin * dt;
      if (player.invulnerable === 0 && overlaps(meteor)) {
        lives--;
        player.invulnerable = 1.4;
        shake = reducedMotion ? 0 : 7;
        burst(player.x, player.y, "#ff967e", 28);
        tone(170, 45, 0.22, "triangle");
        meteors.splice(i, 1);
        if (lives === 0) break;
      } else if (meteor.y > view.height + meteor.radius * 2) meteors.splice(i, 1);
    }
    score = Math.floor(elapsed * 5) + bonus;
    updateHud();
    if (lives === 0) finishFlight();
  }

  function starPath(x, y, radius) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? radius * 0.45 : radius;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawBackground() {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, view.width, view.height);
    const glow = ctx.createRadialGradient(view.width * 0.8, view.height * 0.08, 1, view.width * 0.8, view.height * 0.08, view.width * 0.45);
    glow.addColorStop(0, "#30566b33");
    glow.addColorStop(1, "#19394500");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.save();
    ctx.translate(view.width * 0.79, view.height * 0.17);
    ctx.rotate(-0.35);
    ctx.strokeStyle = "#7099ac20";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, view.width * 0.185, view.width * 0.08, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#162d40";
    ctx.beginPath(); ctx.arc(0, 0, view.width * 0.075, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#4d748c44"; ctx.stroke();
    ctx.restore();
    backgroundStars.forEach((star) => {
      const drift = reducedMotion ? 0 : cosmeticTime * star.speed;
      const y = (star.y + drift) % view.height;
      ctx.globalAlpha = 0.3 + Math.sin(cosmeticTime * 0.8 + star.phase) * 0.13;
      ctx.fillStyle = "#c0dcf3";
      ctx.fillRect(star.x, y, star.size, star.size);
    });
    ctx.globalAlpha = 1;
    const horizon = ctx.createRadialGradient(player.x, view.height + 45, 5, player.x, view.height + 45, view.width * 0.55);
    horizon.addColorStop(0, "#49838217"); horizon.addColorStop(1, "#49838200");
    ctx.fillStyle = horizon; ctx.fillRect(0, 0, view.width, view.height);
  }

  function drawMeteor(meteor) {
    ctx.save();
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.1 * (1 - i / 4);
      ctx.fillStyle = "#ffad83";
      ctx.beginPath(); ctx.arc(meteor.x, meteor.y - meteor.radius - i * 9 * view.scale, meteor.radius * (0.42 - i * 0.08), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.translate(meteor.x, meteor.y); ctx.rotate(meteor.angle);
    ctx.beginPath();
    meteor.shape.forEach((point, i) => {
      const angle = i / meteor.shape.length * Math.PI * 2;
      const x = Math.cos(angle) * meteor.radius * point;
      const y = Math.sin(angle) * meteor.radius * point;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    const rock = ctx.createLinearGradient(-meteor.radius, -meteor.radius, meteor.radius, meteor.radius);
    rock.addColorStop(0, "#76899c"); rock.addColorStop(0.35, "#46586d"); rock.addColorStop(1, "#243448");
    ctx.fillStyle = rock; ctx.fill(); ctx.strokeStyle = "#9fb1c073"; ctx.lineWidth = 1; ctx.stroke();
    [[-0.22, -0.21, 0.3], [0.3, 0.3, 0.18], [-0.26, 0.37, 0.1]].forEach(([x, y, r]) => {
      ctx.beginPath(); ctx.arc(x * meteor.radius, y * meteor.radius, r * meteor.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#1c2a3d66"; ctx.fill(); ctx.strokeStyle = "#a1b3c330"; ctx.stroke();
    });
    ctx.restore();
  }

  function drawShip() {
    if (lives === 0 && state === "gameover") return;
    ctx.save();
    ctx.translate(player.x, player.y); ctx.rotate(player.tilt); ctx.scale(view.scale, view.scale);
    if (player.invulnerable > 0) {
      ctx.globalAlpha = 0.55 + Math.sin(cosmeticTime * 24) * 0.25;
      ctx.strokeStyle = "#8fe1ff"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke();
    }
    const flame = 15 + Math.sin(cosmeticTime * 24) * 5;
    ctx.fillStyle = "#c4f76a44"; ctx.beginPath(); ctx.moveTo(-7, 13); ctx.lineTo(0, 18 + flame); ctx.lineTo(7, 13); ctx.fill();
    ctx.fillStyle = "#c4f76a"; ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(0, 14 + flame * 0.6); ctx.lineTo(4, 12); ctx.fill();
    ctx.shadowColor = "#62baff66"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#e1edf9"; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(19, 15); ctx.lineTo(7, 10); ctx.lineTo(0, 15); ctx.lineTo(-7, 10); ctx.lineTo(-19, 15); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#91aeca"; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(0, 15); ctx.lineTo(-7, 10); ctx.lineTo(-19, 15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#7de5ff"; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(5, 3); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c4f76a"; ctx.fillRect(-14, 10, 3, 3); ctx.fillRect(11, 10, 3, 3);
    ctx.restore();
  }

  function render() {
    drawBackground();
    ctx.save();
    if (shake > 0.1) ctx.translate(random(-shake, shake), random(-shake, shake));
    meteors.forEach(drawMeteor);
    collectibles.forEach((star) => {
      ctx.save(); ctx.translate(star.x, star.y); ctx.rotate(cosmeticTime * 0.7);
      ctx.shadowColor = "#c4f76a"; ctx.shadowBlur = 15; ctx.fillStyle = "#d9ff9b";
      starPath(0, 0, star.radius); ctx.fill(); ctx.restore();
    });
    drawShip();
    particles.forEach((particle) => {
      ctx.globalAlpha = clamp(particle.life * 2, 0, 1); ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, 2 * view.scale, 2 * view.scale);
    });
    ctx.restore();
  }

  function frame(now) {
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    cosmeticTime += dt;
    if (state === "running") update(dt);
    if (state !== "paused") {
      particles.forEach((particle) => { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.life -= dt; });
      particles = particles.filter((particle) => particle.life > 0);
      shake *= Math.max(0, 1 - dt * 14);
    }
    render();
    requestAnimationFrame(frame);
  }

  $("start-button").addEventListener("click", startFlight);
  $("again-button").addEventListener("click", startFlight);
  $("restart-button").addEventListener("click", startFlight);
  $("pause-button").addEventListener("click", pauseFlight);
  $("resume-button").addEventListener("click", resumeFlight);
  $("menu-button").addEventListener("click", () => {
    elapsed = score = bonus = 0; lives = 3; sector = 1;
    meteors = []; collectibles = []; particles = []; player.x = view.width / 2; player.invulnerable = 0;
    setState("ready"); updateHud();
  });
  $("sound-button").addEventListener("click", async () => {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error("Audio unavailable");
      if (!audio) audio = new Audio();
      soundEnabled = !soundEnabled;
      if (soundEnabled) await audio.resume();
      $("sound-button").setAttribute("aria-pressed", String(soundEnabled));
      $("sound-label").textContent = soundEnabled ? "Sound on" : "Sound off";
      $("sound-waves").toggleAttribute("hidden", !soundEnabled);
      $("sound-slash").toggleAttribute("hidden", soundEnabled);
      tone(450, 700, 0.1);
    } catch {
      soundEnabled = false; $("sound-button").disabled = true; $("sound-label").textContent = "Sound unavailable";
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select, [contenteditable='true']")) return;
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code)) {
      if (state === "running") { event.preventDefault(); keys.add(event.code); pointerTarget = null; }
    }
    if (event.repeat) return;
    if (["Space", "KeyP"].includes(event.code) && !(event.code === "Space" && event.target.tagName === "BUTTON")) {
      event.preventDefault();
      if (state === "running") pauseFlight();
      else if (state === "paused") resumeFlight();
      else if (event.code === "Space") startFlight();
    }
    if (event.code === "Escape") pauseFlight();
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  function steer(event) {
    if (state !== "running") return;
    const rect = canvas.getBoundingClientRect();
    pointerTarget = clamp(event.clientX - rect.left, 22 * view.scale, view.width - 22 * view.scale);
  }
  canvas.addEventListener("pointermove", steer);
  canvas.addEventListener("pointerdown", (event) => {
    if (state !== "running") return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId); steer(event);
  });
  window.addEventListener("blur", pauseFlight);
  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", rememberBest);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseFlight(); });

  resize(); updateHud(); setState("ready"); requestAnimationFrame(frame);
})();
