    "use strict";
    const byId = (id) => document.getElementById(id);
    const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
    const defaultIntensity = 65;
    const responseScale = 5;
    const inputScale = 40;
    const handScale = 32;
    const timeWindow = 10;
    const timeStep = 1 / 120;
    const numberFormat = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const responseAxes = [
      ["signal", "handTarget", "displacement", "velocity", 5.15 ** 2],
      ["signalZ", "handZ", "depth", "depthVelocity", 5.15 ** 2],
      ["signalY", "handY", "vertical", "verticalVelocity", 7.35 ** 2],
    ];
    const towerA = { damping: .78, peak: 0 };
    const towerB = { damping: 3.5, peak: 0 };
    const towerResponses = [towerA, towerB];
    const state = {
      mode: "idle", source: "manual", steps: 0, signal: 0, intensity: defaultIntensity,
      level: defaultIntensity / 100, handTarget: 0, activity: 0,
    };
    function clearExcitation() {
      for (const [, target] of responseAxes) state[target] = 0;
    }
    function clearOscillators() {
      clearExcitation();
      for (const [signal, , position, velocity] of responseAxes) {
        state[signal] = 0;
        for (const tower of towerResponses) tower[position] = tower[velocity] = 0;
      }
    }
    clearOscillators();
    const trace = [{ time: 0, ground: 0, a: 0, b: 0 }];
    const chart = byId("chart");
    const pen = chart.getContext("2d");
    const intensityInput = byId("intensity");
    const start = byId("start");
    const stop = byId("stop");
    const status = byId("status");
    let view;
    let audio;
    let audioEnabled = false;
    let previousFrame = 0;
    let accumulator = 0;
    let lastDraw = 0;
    const mainModes = ["quake", "wave", "explore"];
    let interactionMode = mainModes[0];
    let activeDrawer;
    let viewBeforeWave;
    const waveDefaults = { height: .55, speed: .45, size: .55 };
    const wave = { phase: "idle", time: 0, source: "manual", ...waveDefaults,
      target: { ...waveDefaults }, previousFrame: 0, command: 0, motion: 0,
      returning: false, forwardStep: 0, motionStep: 0, fxTime: 0 };
    const waveOffshore = 7;
    const waveLandfall = 20;
    const modeButtons = [...document.querySelectorAll("[data-mode]")];

    function showDrawer(id) {
      activeDrawer = id;
      document.querySelector('[data-mode="info"]').setAttribute("aria-pressed", String(id === "science"));
      for (const drawer of document.querySelectorAll(".drawer")) drawer.hidden = drawer.id !== id;
      for (const button of document.querySelectorAll("[data-drawer]")) {
        button.setAttribute("aria-expanded", String(button.dataset.drawer === id));
      }
      if (id === "monitor") drawChart();
    }

    const modeNames = { quake: "Terremoto", wave: "Tsunami", explore: "Exploración" };
    function updateHelp() {
      setText(byId("help-mode"), modeNames[interactionMode]);
      setText(byId("help-disaster"), interactionMode === "explore" ? "Ninguno" : modeNames[interactionMode]);
      setText(byId("help-view"), view?.locationLabel() ?? "Exterior");
      for (const item of document.querySelectorAll("[data-mode-help]")) {
        item.setAttribute("aria-current", String(item.dataset.modeHelp === interactionMode));
      }
    }

    function chooseMode(next, reframe = true) {
      if (!mainModes.includes(next) || interactionMode === next) return;
      const previous = interactionMode;
      if (previous === "quake") pauseQuake();
      if (previous === "wave") pauseWave();
      view?.stopNavigation();
      hands.changeMode();
      interactionMode = next;

      if (reframe && next === "wave") {
        viewBeforeWave = view?.location();
        if (viewBeforeWave === "outside" || viewBeforeWave === "ground") view?.changePlace("air", false);
      }
      if (reframe && previous === "wave" && next === "quake" && view?.location() === "air" && viewBeforeWave) {
        view.changePlace(viewBeforeWave, false);
      }
      for (const button of modeButtons) {
        if (button.dataset.mode !== "info") button.setAttribute("aria-pressed", String(button.dataset.mode === next));
      }
      byId("quake-controls").hidden = next !== "quake";
      byId("wave-controls").hidden = next !== "wave";
      byId("views").hidden = next !== "explore";
      byId("explore-hint").hidden = next !== "explore";
      showDrawer(activeDrawer === "help" && !reframe ? "help" : undefined);
      setText(byId("help-action"), modeNames[next] + " · en espera");
      updateHelp();
      updateAudio();
    }

    function selectModeButton(next) {
      if (next === "info") showDrawer(activeDrawer === "science" ? undefined : "science");
      else chooseMode(next);
    }

    for (const button of modeButtons) button.addEventListener("click", () => selectModeButton(button.dataset.mode));
    for (const button of document.querySelectorAll("[data-drawer]")) button.addEventListener("click", () => {
      showDrawer(activeDrawer === button.dataset.drawer ? undefined : button.dataset.drawer);
    });
    function closeDrawer() { showDrawer(); }
    for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && activeDrawer) closeDrawer(); });
    const fullscreen = byId("fullscreen");
    fullscreen.hidden = !document.fullscreenEnabled;
    fullscreen.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        notifyHand("Tu navegador no pudo entrar en pantalla completa.");
      }
    });
    document.addEventListener("fullscreenchange", () => {
      fullscreen.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
      setText(byId("fullscreen-label"), document.fullscreenElement ? "Salir de pantalla completa" : "Pantalla completa");
      hands.resizeCursor();
    });
    window.addEventListener("resize", () => hands.resizeCursor());
    window.visualViewport?.addEventListener("resize", () => hands.resizeCursor());
    let noticeTimer;
    function notifyHand(message, keep = false) {
      window.clearTimeout(noticeTimer);
      const notice = byId("hand-status");
      setText(notice, message);
      notice.hidden = !message;
      if (message && !keep) noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 4300);
    }

    const waveFields = Object.keys(waveDefaults);
    function setWaveControl(field, value) {
      wave.target[field] = clamp(value, 0, 1);
      const slider = byId("wave-" + field);
      const percent = Math.round(wave.target[field] * 100);
      const output = byId("wave-" + field + "-value");
      slider.value = percent;
      slider.style.setProperty("--level", percent + "%");
      setText(output, percent + " %");
    }
    for (const field of waveFields) {
      setWaveControl(field, waveDefaults[field]);
      byId("wave-" + field).addEventListener("input", (event) => {
        if (interactionMode === "wave") setWaveControl(field, Number(event.target.value) / 100);
      });
    }

    function waveStage(time) {
      if (time < 3) return "Fondo marino";
      if (time < waveOffshore) return "Retirada del mar";
      if (time < 16) return "Avanzando";
      return "Inundación visual";
    }

    function waveMovement() {
      return wave.motion > 0 ? "Avanzando" : wave.motion < 0 ? "Retrocediendo" : "Detenida";
    }

    function syncWaveStatus() {
      const running = wave.phase === "running";
      const label = running ? (wave.source === "hand" || wave.returning ? waveMovement() : waveStage(wave.time))
        : { idle: "En espera", paused: "Detenida", done: "Secuencia completa" }[wave.phase];
      const statusLabel = byId("wave-status");
      setText(statusLabel, label);
      if (statusLabel.dataset.state !== wave.phase) statusLabel.dataset.state = wave.phase;
      if (byId("wave-start").disabled !== running) {
        byId("wave-start").disabled = running;
        byId("wave-stop").disabled = !running;
      }
      setText(byId("wave-start"), wave.phase === "paused" ? "Continuar ola" : "Iniciar ola");
    }

    function clearWaveMotion() {
      wave.command = wave.motion = wave.previousFrame = wave.forwardStep = wave.motionStep = 0;
    }

    function startWave(source = "manual") {
      if (interactionMode !== "wave") return;
      if (wave.phase === "done") wave.time = wave.fxTime = 0;
      if (source === "hand" || wave.phase === "done") wave.returning = false;
      if (source === "hand") wave.time = Math.max(wave.time, waveOffshore);
      wave.phase = "running";
      wave.source = source;
      clearWaveMotion();
      syncWaveStatus();
      updateAudio();
    }

    function pauseWave() {
      const running = wave.phase === "running";
      clearWaveMotion();
      wave.target.height = wave.height;
      if (running) {
        wave.phase = "paused";
        setWaveControl("height", wave.height);
        syncWaveStatus();
        updateAudio();
      }
    }

    function resetWave() {
      wave.phase = "idle";
      wave.source = "manual";
      wave.returning = false;
      wave.time = wave.fxTime = 0;
      clearWaveMotion();
      for (const field of waveFields) {
        wave[field] = waveDefaults[field];
        setWaveControl(field, wave[field]);
      }
      syncWaveStatus();
      updateAudio();
    }

    function tickWave(now) {
      wave.forwardStep = wave.motionStep = 0;
      if (interactionMode !== "wave" || wave.phase !== "running") return;
      const dt = wave.previousFrame ? clamp((now - wave.previousFrame) / 1000, 0, .05) : 0;
      wave.previousFrame = now;
      for (const field of waveFields) wave[field] += (wave.target[field] - wave[field]) * (1 - Math.exp(-13 * dt));
      const previous = wave.time;
      if (wave.source === "hand") {
        const step = dt * wave.command * 6.4;
        wave.time = clamp(previous + step, waveOffshore, waveLandfall);
      } else {
        const speed = .65 + wave.speed * 1.17;
        wave.time = clamp(previous + dt * speed * (wave.returning ? -3.5 : 1), 0, waveLandfall);
      }
      const displacement = wave.time - previous;
      wave.motion = Math.sign(displacement);
      wave.forwardStep = Math.min(.09, Math.max(0, displacement));
      wave.motionStep = displacement ? dt : 0;
      wave.fxTime += wave.motionStep;
      if (wave.source === "manual") {
        if (wave.returning && wave.time === 0) {
          wave.phase = "done";
          wave.motion = 0;
        }
        if (wave.time === waveLandfall) wave.returning = true;
      }
      syncWaveStatus();
    }
    byId("wave-start").addEventListener("click", () => startWave());
    byId("wave-stop").addEventListener("click", () => {
      if (interactionMode === "wave") {
        pauseWave();
        hands.changeMode();
      }
    });
    byId("wave-reset").addEventListener("click", () => {
      if (interactionMode === "wave") {
        resetWave();
        hands.changeMode();
      }
    });

    function updateStatus(mode) {
      state.mode = mode;
      status.dataset.state = mode;
      status.textContent = mode === "running" && state.source === "hand"
        ? "Por gestos"
        : { idle: "En espera", running: "En curso", paused: "Detenido" }[mode];
      setText(byId("start-label"), { idle: "Iniciar", running: "En curso", paused: "Continuar" }[mode]);
      start.disabled = mode === "running";
      stop.disabled = mode !== "running";
      showQuakeIntensity();
      updateAudio();
    }

    function updateIntensity() {
      state.intensity = Number(intensityInput.value);
      intensityInput.style.setProperty("--level", state.intensity + "%");
      intensityInput.setAttribute("aria-valuetext", state.intensity + " por ciento");
      showQuakeIntensity();
    }

    function showQuakeIntensity() {
      const live = state.mode === "running" && state.source === "hand";
      setText(byId("intensity-value"), (live ? Math.round(state.activity * 100) : state.intensity) + " %");
    }

    function updateReadings() {
      for (const [id, tower] of [["a", towerA], ["b", towerB]]) {
        const value = byId("peak-" + id).firstElementChild;
        const formatted = numberFormat.format(tower.peak);
        if (value.textContent !== formatted) value.textContent = formatted;
      }
    }

    function integrate() {
      const time = ++state.steps * timeStep;
      state.level += (state.intensity / 100 - state.level) * 0.036;
      if (state.source === "hand") {
        for (const [signal, target] of responseAxes) state[signal] += (state[target] - state[signal]) * (1 - Math.exp(-25 * timeStep));
        const strength = Math.hypot(state.handTarget, state.handY, state.handZ) / handScale;
        state.activity += (clamp(strength, 0, 1) - state.activity) * .08;
      } else {
        const onset = 1 - Math.exp(-1.8 * time);
        const envelope = 0.8 + 0.2 * Math.sin(time * 0.68);
        const excitation = state.level * onset * envelope * (
          17 * Math.sin(time * 5.25) + 8 * Math.sin(time * 8.1 + 0.4) +
          5 * Math.sin(time * 13.7) + 3 * Math.sin(time * 2.31)
        );
        state.signal += (excitation - state.signal) * (1 - Math.exp(-30 * timeStep));
        state.signalY += (excitation * .23 - state.signalY) * .16;
        state.signalZ += (excitation * .19 - state.signalZ) * .16;
        state.activity = state.level;
      }
      // Un modo lateral por torre. Misma rigidez y misma excitación en la base.
      for (const tower of towerResponses) {
        for (const [signal, , position, velocity, stiffness] of responseAxes) {
          const acceleration = -state[signal] - stiffness * tower[position] - 2 * tower.damping * tower[velocity];
          tower[velocity] += acceleration * timeStep;
          tower[position] += tower[velocity] * timeStep;
        }
        tower.peak = Math.max(tower.peak, Math.hypot(tower.displacement, tower.depth, tower.vertical));
      }
      if (state.steps % 4 === 0) sampleTrace(time);
    }

    function sampleTrace(time) {
      const sample = { time, ground: state.signal, a: towerA.displacement, b: towerB.displacement };
      if (trace.at(-1).time === time) trace[trace.length - 1] = sample;
      else trace.push(sample);
      if (trace.length > 302) trace.shift();
    }

    function beginHandDrive() {
      if (interactionMode !== "quake") return;
      previousFrame = accumulator = 0;
      state.source = "hand";
      clearOscillators();
      state.activity = 0;
      updateStatus("running");
    }

    function simulate(now) {
      if (interactionMode !== "quake" || state.mode !== "running") return;
      if (previousFrame) accumulator += Math.min((now - previousFrame) / 1000, 0.08);
      previousFrame = now;
      while (accumulator >= timeStep) {
        integrate();
        accumulator -= timeStep;
      }
      view?.pose();
      if (now - lastDraw >= 30) {
        showQuakeIntensity();
        updateReadings();
        drawChart();
        updateAudio();
        lastDraw = now;
      }
    }

    function startQuake() {
      if (interactionMode !== "quake" || state.mode === "running") return;
      const shouldFocus = document.activeElement === start;
      state.source = "manual";
      clearExcitation();
      updateStatus("running");
      if (shouldFocus) stop.focus({ preventScroll: true });
      previousFrame = 0;
    }
    start.addEventListener("click", startQuake);

    stop.addEventListener("click", () => {
      if (interactionMode !== "quake") return;
      const shouldFocus = document.activeElement === stop;
      pauseQuake();
      hands.changeMode();
      if (shouldFocus) start.focus({ preventScroll: true });
    });
    function pauseQuake() {
      const running = state.mode === "running";
      clearOscillators();
      previousFrame = accumulator = state.activity = 0;
      if (!running) return;
      sampleTrace(state.steps * timeStep);
      updateStatus("paused");
      view?.pose();
      updateReadings();
      drawChart();
    }

    function resetQuake(camera = true) {
      clearOscillators();
      previousFrame = state.steps = state.activity = accumulator = 0;
      state.source = "manual";
      state.level = defaultIntensity / 100;
      for (const tower of towerResponses) tower.peak = 0;
      trace.splice(0, trace.length, { time: 0, ground: 0, a: 0, b: 0 });
      intensityInput.value = defaultIntensity;
      updateStatus("idle");
      updateIntensity();
      updateReadings();
      drawChart();
      if (camera) view?.resetCamera();
      view?.pose();
    }
    byId("reset").addEventListener("click", () => {
      if (interactionMode === "quake") {
        resetQuake();
        hands.changeMode();
      }
    });
    function rebuildCity() {
      resetQuake(false);
      resetWave();
      view?.stopNavigation();
      view?.resetDamage();
      hands.changeMode();
      rebuildProgress(0);
      setText(byId("help-action"), "Ciudad reconstruida");
      notifyHand("Ciudad reconstruida.");
    }
    function rebuildProgress(remaining) {
      const indicator = byId("rebuild-progress");
      indicator.hidden = !remaining;
      if (remaining) setText(indicator, "Reconstrucción en " + Math.ceil(remaining / 1000) + "… Retira las manos para cancelar.");
    }
    byId("rebuild").addEventListener("click", rebuildCity);
    intensityInput.addEventListener("input", () => {
      if (interactionMode !== "quake") return;
      updateIntensity();
      if (state.mode === "idle") state.level = state.intensity / 100;
      if (state.mode === "running" && state.source === "hand") {
        state.source = "manual";
        clearExcitation();
        updateStatus("running");
        hands.changeMode();
      }
    });
    document.addEventListener("visibilitychange", () => {
      previousFrame = 0;
      if (document.hidden && !view?.immersive()) hands.clear();
      updateAudio();
    });

    function drawChart() {
      if (!pen) return;
      const { width, height } = chart.getBoundingClientRect();
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelsX = Math.round(width * ratio);
      const pixelsY = Math.round(height * ratio);
      if (chart.width !== pixelsX || chart.height !== pixelsY) {
        chart.width = pixelsX;
        chart.height = pixelsY;
      }
      pen.setTransform(ratio, 0, 0, ratio, 0, 0);
      pen.clearRect(0, 0, width, height);
      const left = 43;
      const right = width - 12;
      const baseY = 28;
      const baseHalf = 14;
      const responseTop = 53;
      const responseBottom = height - 25;
      const responseMid = (responseTop + responseBottom) / 2;
      const responseHalf = (responseBottom - responseTop) / 2;
      const end = Math.max(timeWindow, trace.at(-1).time);
      const origin = end - timeWindow;
      const positionX = (time) => left + (time - origin) / timeWindow * (right - left);
      const label = (text, x, y, align = "right") => {
        pen.fillStyle = "#a4b3c4";
        pen.textAlign = align;
        pen.fillText(text, x, y);
      };
      pen.font = '11px "IBM Plex Mono", Consolas, monospace';
      pen.textBaseline = "middle";
      pen.fillStyle = "#0b1420";
      pen.fillRect(left, baseY - baseHalf, right - left, baseHalf * 2);
      pen.fillRect(left, responseTop, right - left, responseBottom - responseTop);
      pen.lineWidth = 1;
      pen.strokeStyle = "#233346";
      pen.beginPath();
      const tickStep = width < 520 ? 2 : 1;
      for (let second = Math.ceil(origin / tickStep) * tickStep; second <= end; second += tickStep) {
        const x = positionX(second);
        pen.moveTo(x, baseY - baseHalf);
        pen.lineTo(x, responseBottom + 4);
        label(second + " s", x, height - 9, "center");
      }
      for (const y of [baseY, responseTop, responseMid, responseBottom]) {
        pen.moveTo(left, y);
        pen.lineTo(right, y);
      }
      pen.stroke();
      label("Base", left - 7, baseY);
      label("+" + responseScale, left - 7, responseTop);
      label("0", left - 7, responseMid);
      label("−" + responseScale, left - 7, responseBottom);
      const drawTrace = (key, tint, center, half, scale) => {
        pen.save();
        pen.beginPath();
        pen.rect(left, center - half - 1, right - left + 1, half * 2 + 2);
        pen.clip();
        pen.beginPath();
        for (const [index, point] of trace.entries()) {
          const x = positionX(point.time);
          const y = center - point[key] / scale * (half - 2);
          if (index === 0) pen.moveTo(x, y);
          else pen.lineTo(x, y);
        }
        pen.lineWidth = key === "ground" ? 1.4 : 1.9;
        pen.strokeStyle = tint;
        pen.stroke();
        const latest = trace.at(-1);
        pen.beginPath();
        pen.arc(clamp(positionX(latest.time), left + 2, right - 2), center - latest[key] / scale * (half - 2), 2, 0, Math.PI * 2);
        pen.fillStyle = tint;
        pen.fill();
        pen.restore();
      };
      drawTrace("ground", "#a1afbf", baseY, baseHalf, inputScale);
      drawTrace("a", "#ffad76", responseMid, responseHalf, responseScale);
      drawTrace("b", "#62e7ee", responseMid, responseHalf, responseScale);
      if (state.mode === "idle") {
        const prompt = width < 510 ? "Inicia el terremoto." : "Inicia el terremoto para registrar el movimiento.";
        label(prompt, (left + right) / 2, responseMid - 12, "center");
      }
    }

    if ("ResizeObserver" in window) new ResizeObserver(drawChart).observe(chart);
    else window.addEventListener("resize", drawChart);
    drawChart();

    function buildAudio() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Web Audio no está disponible");
      const context = new AudioContext();
      const master = context.createGain();
      const ambientGain = context.createGain();
      const surfGain = context.createGain();
      const waveGain = context.createGain();
      const quakeGain = context.createGain();
      master.gain.value = 0;
      ambientGain.gain.value = 0.035;
      surfGain.gain.value = waveGain.gain.value = 0;
      quakeGain.gain.value = 0;
      master.connect(context.destination);

      const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const air = context.createBiquadFilter();
      air.type = "lowpass";
      air.frequency.value = 460;
      noise.connect(air).connect(ambientGain).connect(master);
      const surf = context.createBiquadFilter();
      surf.type = "lowpass";
      surf.frequency.value = 480;
      const breaker = context.createBiquadFilter();
      breaker.type = "lowpass";
      breaker.frequency.value = 195;
      noise.connect(surf).connect(surfGain).connect(master);
      noise.connect(breaker).connect(waveGain).connect(master);

      const rumble = context.createBiquadFilter();
      rumble.type = "lowpass";
      rumble.frequency.value = 150;
      rumble.Q.value = 1.15;
      noise.connect(rumble).connect(quakeGain).connect(master);
      const hum = context.createOscillator();
      hum.type = "triangle";
      hum.frequency.value = 53;
      const humGain = context.createGain();
      humGain.gain.value = 0.11;
      hum.connect(humGain).connect(quakeGain);
      noise.start();
      hum.start();
      return { context, master, quakeGain, rumble, ambientGain, air, surf, surfGain, waveGain, breaker };
    }

    function updateAudio() {
      if (!audio) return;
      const now = audio.context.currentTime;
      const visible = !document.hidden || view?.immersive();
      const shaking = interactionMode === "quake" && state.mode === "running" && audioEnabled && visible;
      const strength = shaking ? state.activity * (0.24 + Math.hypot(state.signal, state.signalY, state.signalZ) / inputScale) *
        Math.min(1, state.steps * timeStep) : 0;
      const location = view?.location();
      const enclosed = location === "a" || location === "b";
      const byOcean = location === "beach" ? 1 : location === "air" ? .35 : .58;
      const wash = interactionMode === "wave" && wave.phase === "running" && wave.motion
        ? waveVisual(wave.time, wave.height, wave.size).energy : 0;
      audio.master.gain.setTargetAtTime(audioEnabled && visible ? 0.68 : 0, now, 0.09);
      audio.quakeGain.gain.setTargetAtTime(strength * 0.46, now, 0.075);
      audio.rumble.frequency.setTargetAtTime(120 + strength * 175, now, 0.1);
      audio.ambientGain.gain.setTargetAtTime(enclosed ? .045 : .1, now, .23);
      audio.air.frequency.setTargetAtTime(enclosed ? 215 : 430, now, .23);
      audio.surfGain.gain.setTargetAtTime((enclosed ? .14 : byOcean) * (.24 + Math.sin(now * 1.63) * .12), now, .22);
      audio.surf.frequency.setTargetAtTime(enclosed ? 155 : 680, now, .23);
      audio.waveGain.gain.setTargetAtTime(wash * (enclosed ? .32 : 1.12), now, .13);
      audio.breaker.frequency.setTargetAtTime(enclosed ? 175 : 195 + wash * 430, now, .23);
    }

    byId("audio-toggle").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        if (!audioEnabled) {
          audio ??= buildAudio();
          button.disabled = true;
          await audio.context.resume();
        }
        audioEnabled = !audioEnabled;
        button.setAttribute("aria-pressed", String(audioEnabled));
        byId("audio-icon").setAttribute("href", audioEnabled ? "#i-sound" : "#i-muted");
        byId("audio-label").textContent = audioEnabled ? "Silenciar" : "Sonido";
        updateAudio();
      } catch {
        notifyHand("Audio no disponible en este navegador.");
      } finally {
        button.disabled = false;
      }
    });

    const mediaPipe = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
    const handModel = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
    const handBones = [
      [0,1], [1,2], [2,3], [3,4], [0,5], [5,6], [6,7], [7,8],
      [5,9], [9,10], [10,11], [11,12], [9,13], [13,14], [14,15], [15,16],
      [13,17], [0,17], [17,18], [18,19], [19,20],
    ];

    const gestureLabels = {
      none: "Sin seguimiento", neutral: "Neutra", open: "Palma abierta", fist: "Puño cerrado",
      point: "Índice", thumb: "Pulgar arriba", two: "Dos dedos", three: "Tres dedos", four: "Cuatro dedos",
    };
    const handSides = ["Right", "Left"];
    const changeLabels = { two: "Cambiar modo", four: "Cambiar perspectiva" };
    const deadzone = (value, threshold) => Math.sign(value) * Math.max(0, Math.abs(value) - threshold);
    const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const vectorBetween = (a, b) => [b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)];
    const dotHand = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const handLength = (v) => Math.hypot(...v);
    const handDistance = (a, b) => handLength(vectorBetween(a, b));

    function describeHand(points, world, aspect) {
      const image = points.map(({ x, y, z }) => ({ x: x * aspect, y, z: (z ?? 0) * aspect }));
      const hasWorld = world?.length === 21;
      const joints = hasWorld ? world : image;
      const across = vectorBetween(joints[17], joints[5]);
      const palm = vectorBetween(joints[0], joints[9]);
      const width = handLength(across);
      const length = handLength(palm);
      const palmSize = Math.max((width + length) / 2, 1e-5);
      if (Math.min(width, length) < 1e-5) return;
      const normal = [across[1] * palm[2] - across[2] * palm[1],
        across[2] * palm[0] - across[0] * palm[2], across[0] * palm[1] - across[1] * palm[0]];
      const facing = Math.abs(normal[2]) / Math.max(handLength(normal), 1e-8);
      const straightness = (i) => {
        const [base, first, second, tip] = joints.slice(i, i + 4);
        const path = handDistance(base, first) + handDistance(first, second) + handDistance(second, tip);
        return handDistance(base, tip) / Math.max(path, 1e-5);
      };
      const fingers = [5, 9, 13, 17].map((base) => {
        const tip = joints[base + 3];
        const reach = (handDistance(joints[0], tip) - handDistance(joints[0], joints[base])) / palmSize;
        const straight = straightness(base);
        return { reach, straight, extended: straight > .84 && reach > .16, closed: straight < .81 && reach < .33 };
      });
      const [index, middle, ring, pinky] = fingers.map((finger) => finger.extended);
      const count = fingers.filter((finger) => finger.extended).length;
      const thumbReach = dotHand(vectorBetween(joints[5], joints[4]), across) / (width * palmSize);
      const thumbLine = straightness(1);
      const thumbOut = thumbLine > .71 && thumbReach > .19;
      const thumbFolded = thumbReach < .14 || thumbLine < .63;
      const thumbUp = image[2].y - image[4].y > Math.abs(image[4].x - image[2].x) * .80 &&
        image[3].y > image[4].y && thumbLine > .79 && handDistance(joints[4], joints[5]) > palmSize * .49;
      const lastThreeClosed = fingers.slice(1).every((finger) => finger.closed);
      const allClosed = lastThreeClosed && fingers[0].closed;
      let pose = "neutral";
      if (index && middle && ring && pinky) {
        if (thumbOut) pose = "open";
        else if (thumbFolded) pose = "four";
      } else if (index && middle && ring && fingers[3].closed) pose = "three";
      else if (index && middle && fingers[2].closed && fingers[3].closed) pose = "two";
      else if (allClosed && thumbUp) pose = "thumb";
      else if (index && lastThreeClosed && !thumbOut) pose = "point";
      else if (allClosed && !thumbOut) pose = "fist";

      const base = [0, 5, 9, 13, 17];
      const x = 1 - base.reduce((sum, i) => sum + points[i].x, 0) / base.length;
      const y = base.reduce((sum, i) => sum + points[i].y, 0) / base.length;
      const imageWidth = vectorBetween(image[17], image[5]);
      const imageLength = vectorBetween(image[0], image[9]);
      const projected = Math.hypot(...imageWidth.slice(0, 2), ...imageLength.slice(0, 2));
      // Relaciona el tamaño en la imagen con la proyección de la geometría 3D para compensar la inclinación.
      const projectionRatio = hasWorld ? clamp(Math.hypot(...across.slice(0, 2), ...palm.slice(0, 2)) /
        Math.hypot(width, length), .55, 1) : 1;
      const size = Math.max(.015, projected / (Math.SQRT2 * projectionRatio));
      const angle = Math.atan2(-imageLength[0], -imageLength[1]);
      return { pose, count, thumbExtended: thumbOut || (allClosed && thumbUp), facing, x, y, size, angle, points, aspect };
    }

    function mapGesturePointer(tip, center) {
      const xCenter = clamp(center?.x ?? .5, .37, .63);
      const yCenter = clamp(center ? center.y - .115 : .385, .27, .52);
      return {
        x: clamp(.5 + ((1 - tip.x) - xCenter) / .54, 0, 1),
        y: clamp(.5 + (tip.y - yCenter) / .48, 0, 1),
      };
    }

    function createHandInterpreter(actions) {
      const history = { Right: {}, Left: {} };
      let calibration, pointer, activeSide, lastOpen;
      let rebuildSince, rebuildReleased, rebuildUsed = false;
      let changePose, changeSince, changeReleased, changeUsed = false, cooldown = 0;
      let phase = "idle";

      function updatePhase(next, label = "", fraction = 0) {
        phase = next;
        actions.progress(label, fraction);
      }

      function hidePointer() {
        if (pointer) actions.hide();
        pointer = undefined;
      }

      function resetMotion() {
        activeSide = lastOpen = undefined;
        for (const track of Object.values(history)) {
          track.origin = track.motion = undefined;
          if (track.candidate === "open") track.openUsed = true;
        }
        actions.suspend();
      }

      function suspend(next, label, fraction) {
        if (phase !== next) resetMotion();
        updatePhase(next, label, fraction);
      }

      function clear() {
        for (const side of handSides) history[side] = {};
        calibration = undefined;
        rebuildSince = rebuildReleased = changePose = changeSince = changeReleased = undefined;
        rebuildUsed = changeUsed = false;
        activeSide = lastOpen = undefined;
        cooldown = 0;
        hidePointer();
        updatePhase("idle");
        actions.report({});
        actions.lost();
      }

      function capture(hands, identities, worldHands, aspect, now) {
        const matches = hands.flatMap((points, i) => {
          if (points?.length !== 21) return [];
          const item = describeHand(points, worldHands[i], aspect);
          if (!item) return [];
          const identity = identities[i]?.[0];
          return [{ item, side: identity?.categoryName, confidence: identity?.score ?? 0 }];
        }).sort((a, b) => b.confidence - a.confidence);
        const pair = {};
        for (const { item, side, confidence } of matches) {
          const available = handSides.filter((name) => !pair[name]);
          const preferred = confidence >= .82 && available.includes(side) ? side : undefined;
          const nearest = available.map((name) => {
            const previous = history[name].sample;
            const distance = previous && now - history[name].seen < 250
              ? Math.hypot((previous.x - item.x) * aspect, previous.y - item.y)
              : .16 + (name === (item.x > .5 ? "Right" : "Left") ? 0 : .06);
            return { name, score: distance - (name === side ? confidence * .16 : 0) };
          }).sort((a, b) => a.score - b.score)[0];
          if (preferred || nearest) pair[preferred ?? nearest.name] = item;
        }

        for (const side of handSides) {
          let track = history[side];
          const item = pair[side];
          if (now - (track.seen ?? -Infinity) > 190) {
            track = history[side] = { center: track.center, calibratedOrigin: track.calibratedOrigin };
          }
          if (!item) continue;
          const previous = track.sample;
          const dt = previous ? clamp((now - track.seen) / 1000, .012, .14) : .04;
          const blend = 1 - Math.exp(-20 * dt);
          const smooth = (next, last) => last === undefined ? next : last + (next - last) * blend;
          const x = smooth(item.x, previous?.x);
          const y = smooth(item.y, previous?.y);
          const size = smooth(item.size, previous?.size);
          const angle = previous ? previous.angle + angleDifference(item.angle, previous.angle) * blend : item.angle;
          const vx = previous ? smooth((x - previous.x) * aspect / (dt * size), previous.vx) : 0;
          const vy = previous ? smooth((previous.y - y) / (dt * size), previous.vy) : 0;
          const raw = item.pose;
          if (raw !== track.candidate) {
            track.candidate = raw;
            track.since = now;
          }
          const settle = raw === "fist" ? 0 : raw === "open" ? 195 : raw === "thumb" ? 115 : 55;
          const stable = now - track.since >= settle;
          if (stable && raw !== "open") track.openUsed = false;
          if (stable && raw !== "fist") track.fistUsed = false;
          track.seen = now;
          const sample = { x, y, size, angle, vx, vy, facing: smooth(item.facing, previous?.facing) };
          track.sample = sample;
          Object.assign(item, sample, { raw, pose: stable ? raw : "neutral", dt, side, track });
        }
        return pair;
      }

      function motion(item) {
        const { track } = item;
        track.origin ??= track.calibratedOrigin ?? track.sample;
        const origin = track.origin;
        const push = Math.log(item.size / origin.size);
        const scale = Math.exp(-push);
        // Compensa la escala de la proyección respecto al centro óptico.
        const dx = ((item.x - .5) * scale - (origin.x - .5)) * item.aspect / origin.size;
        const dy = ((origin.y - .5) - (item.y - .5) * scale) / origin.size;
        const previous = track.motion;
        const vx = previous ? previous.vx * .48 + (dx - previous.dx) / item.dt * .52 : 0;
        track.motion = { dx, vx };
        return { dx, dy, push, vx };
      }

      function update(landmarks, identities, world, aspect, now) {
        if (Object.values(history).some((track) => track.seen !== undefined) &&
            handSides.every((side) => now - (history[side].seen ?? -Infinity) > 190)) {
          rebuildSince = changeSince = undefined;
        }
        const pair = capture(landmarks, identities, world, aspect, now);
        const { Right: right, Left: left } = pair;
        const visible = [right, left].filter(Boolean);
        const openHands = visible.filter((item) => item.pose === "open");
        const fists = visible.filter((item) => item.pose === "fist");
        actions.report(pair);

        if (calibration && fists.length) {
          calibration = undefined;
          actions.calibrationCanceled();
        }
        if (calibration) {
          const stableHands = openHands.filter((item) => Math.hypot(item.vx, item.vy) < .75);
          const sides = stableHands.map((item) => item.side).join(",");
          if (sides !== calibration.sides) calibration = { sides, since: now };
          const elapsed = sides ? now - calibration.since : 0;
          suspend("calibrate", "Calibrar centro", elapsed / 550);
          if (elapsed >= 550) {
            for (const { track } of stableHands) {
              track.center = track.calibratedOrigin = track.sample;
              track.openUsed = true;
            }
            calibration = undefined;
            actions.calibrated(stableHands.length);
            updatePhase("idle");
          }
          return;
        }

        const bothOpen = visible.length === 2 && visible.every((item) => item.raw === "open");
        if (!bothOpen) {
          rebuildSince = undefined;
          rebuildReleased ??= now;
          if (now - rebuildReleased >= 170) rebuildUsed = false;
        } else {
          rebuildReleased = undefined;
          for (const item of visible) item.track.openUsed = true;
          hidePointer();
          changePose = changeSince = undefined;
          if (!rebuildUsed) rebuildSince ??= now;
          const elapsed = now - (rebuildSince ?? now);
          suspend("rebuild", rebuildUsed ? "" : "Reconstruir ciudad", elapsed / 3000);
          if (!rebuildUsed && elapsed >= 3000 && openHands.length === 2) {
            rebuildUsed = true;
            actions.rebuild();
            updatePhase("rebuild");
          }
          return;
        }

        const change = visible.some((item) => item.raw === changePose) ? changePose :
          Object.keys(changeLabels).find((pose) => visible.some((item) => item.raw === pose));
        if (!change) {
          changePose = changeSince = undefined;
          changeReleased ??= now;
          if (now - changeReleased >= 160) changeUsed = false;
        } else {
          if (change !== changePose || changeSince === undefined) {
            changePose = change;
            changeSince = now;
          }
          changeReleased = undefined;
          hidePointer();
          for (const item of visible) if (item.raw === "open") item.track.openUsed = true;
          const elapsed = now - changeSince;
          suspend("change", changeUsed ? "" : changeLabels[change], Math.min(elapsed / 800, 1));
          if (!changeUsed && elapsed >= 800 && now >= cooldown) {
            changeUsed = true;
            cooldown = now + 950;
            actions.global(change);
            updatePhase("change");
          }
          return;
        }

        if (fists.length) {
          hidePointer();
          suspend("stop");
          for (const item of visible) if (item.raw === "open") item.track.openUsed = true;
          if (fists.some(({ track }) => !track.fistUsed)) {
            for (const { track } of fists) track.fistUsed = true;
            actions.fist();
          }
          return;
        }

        const aiming = pointer && pair[pointer.side];
        const indexing = aiming?.raw === "point" ? aiming : visible.find((item) => item.pose === "point");
        if (indexing) {
          if (pointer && pointer.side !== indexing.side) hidePointer();
          const center = indexing.track.center;
          const target = mapGesturePointer(indexing.points[8], center && { ...center, x: .5 + (center.x - .5) * .35 });
          const point = pointer ? {
            x: pointer.point.x + (target.x - pointer.point.x) * .48,
            y: pointer.point.y + (target.y - pointer.point.y) * .48,
          } : target;
          pointer = { side: indexing.side, point, at: now };
          suspend("select");
          actions.point(point, now);
          return;
        }
        if (aiming?.raw === "neutral" && now - pointer.at <= 100) return;
        hidePointer();

        if (activeSide) {
          const active = pair[activeSide];
          if (active?.raw === "open") {
            lastOpen = now;
            updatePhase("continuous");
            actions.move(motion(active), now);
            return;
          }
          if (active?.raw === "neutral" && now - lastOpen <= 110) {
            actions.neutral();
            return;
          }
          resetMotion();
          actions.released();
        }

        const opening = openHands.find(({ track }) => !track.openUsed);
        if (opening) {
          opening.track.openUsed = true;
          activeSide = opening.side;
          lastOpen = now;
          const sample = motion(opening);
          updatePhase("continuous");
          actions.open();
          actions.move(sample, now);
          return;
        }
        updatePhase(visible.length ? "ready" : "idle");
      }

      return {
        clear, update,
        calibrate() {
          if (calibration) {
            calibration = undefined;
            updatePhase("idle");
            actions.calibrationCanceled();
            return false;
          }
          hidePointer();
          resetMotion();
          calibration = { sides: "", since: 0 };
          return true;
        },
        changeMode() {
          for (const track of Object.values(history)) {
            if (track.candidate === "open") track.openUsed = true;
            if (track.candidate === "fist") track.fistUsed = true;
          }
          // Una selección que abrió otro modo conserva su bloqueo mientras el índice sigue apuntando.
          resetMotion();
        },
      };
    }

    function setText(element, value) {
      if (element.textContent !== value) element.textContent = value;
    }

    function createCameraTracking() {
      const button = byId("hand-toggle");
      const video = byId("hand-video");
      const preview = byId("camera-preview");
      const feed = byId("hand-feed");
      const overlay = feed.getContext("2d");
      const cursor = byId("hand-cursor");
      const caption = byId("hand-gesture");
      const diagnostic = byId("gesture-diagnostic");
      const log = byId("diagnostic-log");
      byId("diagnostic-reset").addEventListener("click", () => log.replaceChildren());
      let handsModel;
      let stream;
      let landmarker;
      let enabled = false;
      let busy = false;
      let generation = 0;
      let lastInference = 0;
      let lastMediaTime = -1;
      let lastLabel = "";
      let highlighted;
      let tracking = false;
      let handWaveHeight = waveDefaults.height;
      let inferenceErrors = 0;
      let dwell;
      let lastPointer;
      const sensitivity = byId("sensitivity");
      const previewToggle = byId("preview-toggle");
      previewToggle.addEventListener("click", () => {
        const minimized = preview.classList.toggle("minimized");
        previewToggle.textContent = minimized ? "+" : "−";
        previewToggle.setAttribute("aria-label", minimized ? "Mostrar vista de cámara" : "Minimizar vista de cámara");
        previewToggle.setAttribute("aria-expanded", String(!minimized));
      });
      function syncSensitivity() {
        const percent = Number(sensitivity.value);
        setText(byId("sensitivity-value"), percent + " %");
        sensitivity.style.setProperty("--level", (percent - 50) / 1.9 + "%");
      }
      sensitivity.addEventListener("input", syncSensitivity);

      function setHighlight(element) {
        if (highlighted === element) return;
        highlighted?.classList.remove("hand-target");
        element?.classList.add("hand-target");
        highlighted = element;
      }

      function hideCursor() {
        cursor.hidden = true;
        view?.hideHand();
        setHighlight(undefined);
        dwell = lastPointer = undefined;
      }

      function eligible(element) {
        return element && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true" &&
          element.getClientRects().length && !element.closest("[hidden], [inert]") &&
          window.getComputedStyle(element).visibility === "visible";
      }

      function targetAt(point, x, y, immersive) {
        if (immersive) return view.handTarget(point);
        const element = document.elementFromPoint(x, y)?.closest('button, a[href], summary, input[type="range"]');
        if (!element) return view?.towerTarget(x, y);
        const label = element.getAttribute("aria-label") || element.labels?.[0]?.textContent.trim() || element.textContent.trim();
        return { key: element, element, label };
      }

      function activateTarget(target, x) {
        const { element } = target;
        if (element && !eligible(element)) return;
        action("Seleccionar · " + target.label);
        if (!element) target.action();
        else if (element.matches('input[type="range"]')) {
          const bounds = element.getBoundingClientRect();
          const min = Number(element.min || 0);
          const max = Number(element.max || 100);
          const value = min + clamp((x - bounds.left) / Math.max(bounds.width, 1), 0, 1) * (max - min);
          const previous = element.value;
          element.value = value;
          if (element.value !== previous) {
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else element.click();
      }

      function pointAt(point, now, fromTracking = true) {
        lastPointer = { point, now };
        const immersive = view?.immersive();
        const viewport = window.visualViewport;
        const width = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
        const height = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const right = Math.min(width, left + (viewport?.width ?? width));
        const bottom = Math.min(height, top + (viewport?.height ?? height));
        let x = left + .5 + point.x * Math.max(0, right - left - 1);
        let y = top + .5 + point.y * Math.max(0, bottom - top - 1);
        const position = { point, x, y };
        const hit = targetAt(point, x, y, immersive);
        let target = hit && (!hit.element || eligible(hit.element)) ? hit : undefined;
        const near = dwell && Math.hypot(x - dwell.position.x, y - dwell.position.y) <= 8;

        if (dwell?.activated && (hit?.key === dwell.key || near)) {
          if (hit?.key === dwell.key) dwell.position = position;
          else target = undefined;
        } else {
          // Absorbe pequeños saltos en un borde solo si el mismo objetivo sigue en la posición anterior.
          if (!hit && near && !dwell.activated) {
            const last = dwell.position;
            const previous = targetAt(last.point, last.x, last.y, immersive);
            if (previous?.key === dwell.key && (!previous.element || eligible(previous.element))) {
              target = previous;
              ({ x, y } = last);
            } else if (immersive) view.handTarget(point);
          }
          if (!target) dwell = undefined;
          else if (dwell?.key !== target.key) dwell = { key: target.key, position, since: now, activated: false };
          else if (hit) dwell.position = position;
        }

        if (fromTracking && !immersive && activeDrawer && !target) {
          const container = byId(activeDrawer);
          const bounds = container.getBoundingClientRect();
          if (container.contains(document.elementFromPoint(x, y))) {
            if (y > bounds.bottom - 39) container.scrollTop += 6;
            if (y < bounds.top + 28) container.scrollTop -= 6;
          }
        }

        const progress = target ? clamp((now - dwell.since) / 2000, 0, 1) : 0;
        if (immersive) {
          cursor.hidden = true;
          setHighlight(undefined);
          view.paintHand(target, progress);
        } else {
          cursor.hidden = false;
          cursor.style.transform = "translate(" + x + "px," + y + "px)";
          cursor.style.setProperty("--dwell", progress * 100 + "%");
          cursor.classList.toggle("flip", x > right * .72);
          setText(cursor.firstElementChild, target?.label ?? "");
          setHighlight(target?.element);
        }
        if (fromTracking && target && progress === 1 && !dwell.activated) {
          dwell.activated = true;
          activateTarget(target, x);
        }
      }

      function resizeCursor() {
        if (lastPointer && !view?.immersive()) pointAt(lastPointer.point, lastPointer.now, false);
      }

      const action = (label, group = label) => {
        setText(byId("help-action"), label);
        if (!diagnostic.open) return;
        if (log.firstElementChild?.dataset.gesture === group) {
          setText(log.firstElementChild, label);
          return;
        }
        const entry = document.createElement("li");
        entry.dataset.gesture = group;
        entry.textContent = label;
        log.prepend(entry);
        if (log.childElementCount > 8) log.lastElementChild.remove();
      };

      function showNavigation(horizontal = 0, vertical = 0, forward = 0) {
        const indicator = byId("explore-motion");
        indicator.hidden = !enabled;
        const labels = [];
        if (horizontal) labels.push(horizontal > 0 ? "Giro a la derecha" : "Giro a la izquierda");
        if (vertical) labels.push(vertical > 0 ? "Mirar arriba" : "Mirar abajo");
        if (forward) labels.push(forward > 0 ? "Avanzando" : "Retrocediendo");
        setText(indicator, " · " + (labels.join(" / ") || "Cámara en reposo"));
        return labels.join(" · ");
      }

      function suspendMovement() {
        if (interactionMode === "quake" && state.source === "hand" && state.mode === "running") pauseQuake();
        if (interactionMode === "wave" && wave.source === "hand" && wave.phase === "running") pauseWave();
        view?.clearGesture();
        showNavigation();
      }

      function moveQuake(hand, gain) {
        if (state.mode !== "running" || state.source !== "hand") return;
        const lateralSpeed = deadzone(hand.vx, .23);
        const amplitude = Math.min(1, Math.abs(hand.dx) * .85);
        const intensity = Math.tanh(Math.abs(lateralSpeed) * gain * .34) * (.7 + amplitude * .3);
        state.handTarget = -Math.sign(lateralSpeed) * handScale * intensity;
        if (lateralSpeed) action("Sacudida lateral · " + Math.round(intensity * 100) + " %", "sacudida");
      }

      function moveWave(hand, gain) {
        if (wave.phase !== "running" || wave.source !== "hand") return;
        setWaveControl("height", handWaveHeight + deadzone(hand.dy, .14) * gain * .63);
        wave.command = clamp(deadzone(hand.push, .075) * gain * 3.8, -1, 1);
        const movement = wave.command > 0 ? "Avanzar" : wave.command < 0 ? "Retroceder" : "Detener avance";
        action("Ola · " + movement + " · altura " + Math.round(wave.target.height * 100) + " %", "ola");
      }

      function moveExploration(hand, gain, now) {
        const immersive = view?.immersive();
        const horizontal = immersive ? 0 : clamp(deadzone(hand.dx, .19) * gain * .66, -1, 1);
        const vertical = immersive ? 0 : clamp(deadzone(hand.dy, .19) * gain * .68, -1, 1);
        const forward = clamp(deadzone(hand.push, .075) * gain * 4.1, -1, 1);
        view?.navigateGesture(horizontal, vertical, forward, now);
        const label = showNavigation(horizontal, vertical, forward);
        if (label) action(label, "navegación");
      }

      const interpreter = createHandInterpreter({
        report(pair) {
          for (const [side, field] of [["Right", "right"], ["Left", "left"]]) {
            const hand = pair[side];
            setText(byId("help-" + field), gestureLabels[hand?.raw ?? "none"]);
            setText(byId("help-" + field + "-fingers"), hand ? String(hand.count + Number(hand.thumbExtended)) : "—");
            if (diagnostic.open) {
              const detail = hand ? "Pulgar " + (hand.thumbExtended ? "extendido" : "recogido") +
                " · inclinación " + Math.round(hand.angle * 180 / Math.PI) +
                "° · frente " + Math.round(hand.facing * 100) + " % · velocidad " + Math.hypot(hand.vx, hand.vy).toFixed(1) + " palmas/s" : "—";
              setText(byId("diagnostic-" + field), detail);
            }
          }
          if (diagnostic.open) {
            const { Right: right, Left: left } = pair;
            const distance = right && left ? Math.hypot((right.x - left.x) * right.aspect, right.y - left.y) /
              ((right.size + left.size) / 2) : undefined;
            setText(byId("diagnostic-distance"), distance === undefined ? "—" : distance.toFixed(2) + " palmas");
          }
        },
        progress(label, fraction) {
          const progress = byId("gesture-hold");
          progress.hidden = !label;
          if (label) {
            setText(byId("gesture-hold-label"), label);
            byId("gesture-hold-value").value = fraction;
          }
          rebuildProgress(label === "Reconstruir ciudad" ? Math.max(1, 3000 * (1 - fraction)) : 0);
        },
        global(pose) {
          if (pose === "two") {
            const index = mainModes.indexOf(interactionMode);
            chooseMode(mainModes[(index + 1) % mainModes.length], false);
            action(changeLabels[pose] + " · " + modeNames[interactionMode]);
          } else {
            action(view ? changeLabels[pose] + " · " + view.nextPlace() : "Perspectiva pendiente de la escena 3D");
          }
        },
        suspend: suspendMovement,
        open() {
          if (interactionMode === "quake") beginHandDrive();
          else if (interactionMode === "wave") {
            handWaveHeight = wave.target.height;
            startWave("hand");
          }
          action(interactionMode === "explore" ? "Control de cámara activo" : "Control activo · " + modeNames[interactionMode]);
        },
        neutral() {
          if (interactionMode === "quake" && state.source === "hand") clearExcitation();
          if (interactionMode === "wave" && wave.source === "hand") wave.command = 0;
          view?.clearGesture();
          showNavigation();
        },
        lost() { suspendMovement(); },
        released() { action("Control por palma detenido"); },
        fist() {
          if (interactionMode === "quake") pauseQuake();
          else if (interactionMode === "wave") pauseWave();
          else view?.stopNavigation();
          showNavigation();
          action("Detener · " + modeNames[interactionMode]);
        },
        move(hand, now) {
          const gain = Number(sensitivity.value) / 100;
          if (interactionMode === "quake") moveQuake(hand, gain);
          else if (interactionMode === "wave") moveWave(hand, gain);
          else if (interactionMode === "explore") moveExploration(hand, gain, now);
        },
        calibrated(count) {
          setText(byId("calibration-hint"), count === 2 ? "Ambas manos calibradas." : "Una mano calibrada. Repite con ambas palmas para calibrar las dos.");
          action(count === 2 ? "Calibrar ambas manos" : "Calibrar una mano");
        },
        calibrationCanceled() { setText(byId("calibration-hint"), "Calibración cancelada."); },
        point: pointAt,
        hide: hideCursor,
        rebuild() {
          rebuildCity();
          action("Ciudad reconstruida");
        },
      });

      async function loadModel() {
        const { FilesetResolver, HandLandmarker } = await import(mediaPipe + "/vision_bundle.mjs");
        const files = await FilesetResolver.forVisionTasks(mediaPipe + "/wasm");
        return HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: handModel, delegate: "CPU" },
          runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence: .53,
          minHandPresenceConfidence: .55, minTrackingConfidence: .52,
        });
      }

      function refreshButton() {
        button.setAttribute("aria-pressed", String(enabled));
        setText(byId("hand-toggle-label"), busy ? "Cancelar cámara" : enabled ? "Desactivar cámara" : "Activar cámara");
      }

      function clear() {
        tracking = false;
        interpreter.clear();
      }

      function disable(message = "") {
        generation++;
        busy = enabled = false;
        for (const track of stream?.getTracks() ?? []) track.stop();
        stream = undefined;
        video.pause();
        video.srcObject = null;
        preview.hidden = true;
        clear();
        refreshButton();
        notifyHand(message);
      }

      async function enable() {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          notifyHand("La cámara requiere un navegador compatible y una página HTTPS o localhost.");
          return;
        }
        const request = ++generation;
        busy = true;
        refreshButton();
        let stage = "camera";
        notifyHand("Esperando permiso para usar la cámara…", true);
        try {
          const feedStream = await navigator.mediaDevices.getUserMedia({
            audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
          });
          if (request !== generation) {
            for (const track of feedStream.getTracks()) track.stop();
            return;
          }
          stream = feedStream;
          for (const track of stream.getVideoTracks()) {
            track.addEventListener("ended", () => {
              if (request === generation) disable("Se desconectó la cámara. Puedes volver a activarla.");
            }, { once: true });
          }
          video.srcObject = stream;
          await video.play();
          if (request !== generation) return;
          stage = "model";
          notifyHand("Cargando el reconocimiento de manos…", true);
          handsModel ??= loadModel().catch((error) => {
            handsModel = undefined;
            throw error;
          });
          const model = await handsModel;
          if (request !== generation) return;
          landmarker = model;
          inferenceErrors = 0;
          lastMediaTime = -1;
          lastInference = 0;
          lastLabel = "Buscando una mano…";
          setText(caption, lastLabel);
          preview.hidden = false;
          busy = false;
          enabled = true;
          refreshButton();
          notifyHand("Cámara activa. Abre Controles para calibrar o consultar los gestos.");
        } catch (error) {
          if (request !== generation) return;
          const message = stage === "model"
            ? "No se pudo cargar MediaPipe. Revisa la conexión y vuelve a activar la cámara."
            : error.name === "NotAllowedError" ? "El permiso de cámara no está disponible. Puedes seguir con mouse y teclado."
            : "No se pudo abrir la cámara. Revisa si está conectada o si otra aplicación la está usando.";
          disable(message);
          console.warn(message, error);
        }
      }

      function drawFeed(hands) {
        if (!overlay) return;
        const scale = Math.min(feed.width / video.videoWidth, feed.height / video.videoHeight);
        const width = video.videoWidth * scale;
        const height = video.videoHeight * scale;
        const left = (feed.width - width) / 2;
        const top = (feed.height - height) / 2;
        overlay.fillStyle = "#080e17";
        overlay.fillRect(0, 0, feed.width, feed.height);
        overlay.save();
        overlay.translate(feed.width, 0);
        overlay.scale(-1, 1);
        overlay.drawImage(video, left, top, width, height);
        for (const [handIndex, landmarks] of hands.entries()) {
          overlay.lineWidth = 1.8;
          overlay.strokeStyle = handIndex === 0 ? "#62e7ee" : "#a7bcff";
          overlay.beginPath();
          for (const [from, to] of handBones) {
            overlay.moveTo(left + landmarks[from].x * width, top + landmarks[from].y * height);
            overlay.lineTo(left + landmarks[to].x * width, top + landmarks[to].y * height);
          }
          overlay.stroke();
          for (const [index, point] of landmarks.entries()) {
            overlay.fillStyle = index === 8 ? "#ffad76" : "#eefaff";
            overlay.beginPath();
            overlay.arc(left + point.x * width, top + point.y * height, index === 8 ? 3.2 : 2.15, 0, 2 * Math.PI);
            overlay.fill();
          }
        }
        overlay.restore();
        view?.refreshFeed();
      }

      function tick(now) {
        if (!enabled || (document.hidden && !view?.immersive())) return;
        if (now - lastInference < 37) return;
        if (video.readyState < 2 || video.currentTime === lastMediaTime || !video.videoWidth) {
          if (tracking && now - lastInference > 230) {
            clear();
            lastLabel = "Buscando una mano…";
            setText(caption, lastLabel);
          }
          return;
        }
        if (tracking && now - lastInference > 230) clear();
        lastMediaTime = video.currentTime;
        lastInference = now;
        try {
          tracking = true;
          const result = landmarker.detectForVideo(video, now);
          const landmarks = result.landmarks;
          interpreter.update(landmarks, result.handedness ?? result.handednesses ?? [], result.worldLandmarks ?? [],
            video.videoWidth / video.videoHeight, now);
          inferenceErrors = 0;
          const right = byId("help-right").textContent;
          const left = byId("help-left").textContent;
          lastLabel = landmarks.length ? "D " + (right === gestureLabels.none ? "—" : right) +
            " · I " + (left === gestureLabels.none ? "—" : left) : "Buscando manos…";
          setText(caption, lastLabel);
          drawFeed(landmarks);
        } catch (error) {
          if (++inferenceErrors === 1) {
            clear();
            setText(caption, "Recuperando el seguimiento…");
          } else if (inferenceErrors >= 3) {
            disable("Se interrumpió el seguimiento. Puedes volver a activar la cámara.");
            console.warn("MediaPipe interrumpió el seguimiento.", error);
          }
        }
      }

      button.addEventListener("click", () => {
        if (enabled || busy) disable();
        else enable();
      });
      byId("calibrate").addEventListener("click", () => {
        if (!enabled) setText(byId("calibration-hint"), "Activa la cámara antes de calibrar.");
        else if (interpreter.calibrate()) {
          setText(byId("calibration-hint"), "Mantén una o ambas palmas abiertas y quietas frente al pecho. Pulsa Calibrar centro para cancelar.");
        }
      });
      window.addEventListener("pagehide", () => disable());
      return { tick, clear, hideCursor, resizeCursor, active: () => enabled, label: () => lastLabel, changeMode: interpreter.changeMode };
    }

    const hands = createCameraTracking();

    function tickExperience(now) {
      hands.tick(now);
      view?.walk(now);
      simulate(now);
      tickWave(now);
      view?.animate(now);
      if (audio && now - lastAudioFrame > 70) {
        lastAudioFrame = now;
        updateAudio();
      }
    }
    let lastAudioFrame = 0;

    function desktopFrame(now) {
      if (!view?.immersive()) tickExperience(now);
      requestAnimationFrame(desktopFrame);
    }
    requestAnimationFrame(desktopFrame);

    function smoothBetween(value, min, max) {
      const t = clamp((value - min) / (max - min), 0, 1);
      return t * t * (3 - 2 * t);
    }

    function waveVisual(time, height, size) {
      const retreat = smoothBetween(time, 0.5, 5.6) * (1 - smoothBetween(time, 6.4, 9.6));
      const advance = clamp((time - waveOffshore) / 9, 0, 1);
      const flood = smoothBetween(time, 14.8, 19.8) * (.42 + height * .58);
      const front = -100 + advance * 88 + smoothBetween(time, 15.2, waveLandfall) * (19 + size * 16);
      const shoal = smoothBetween(front, -64, -14);
      const crest = smoothBetween(time, 3, 9) * (.26 + height * 3.85) * (.24 + shoal * .94);
      const disturbance = Math.sin(Math.PI * clamp(time / 4, 0, 1)) * .8;
      const energy = clamp(crest * .15 + flood * .6 + disturbance * .2, 0, 1);
      return { retreat, flood, front, crest, disturbance, energy };
    }

    function waveWaterAt(x, z, visual, size) {
      const side = x;
      const along = z;
      const front = visual.front - (Math.abs(side) / (45 + size * 32)) ** 2 * 9.2;
      const coverage = Math.exp(-Math.pow(Math.abs(side) / (36 + size * 73), 4));
      const edge = 1 - smoothBetween(along - front + Math.sin(x*.39)*.46, -1.3, 1.8);
      const crest = Math.exp(-Math.pow((along - front) / (4 + size * 5), 2)) * visual.crest;
      const surge = visual.flood * edge * (1.22 + size * .53) * smoothBetween(z, -32, -11);
      return -.48 - visual.retreat * .73 + (crest + surge) * coverage;
    }

    const damageRules = {
      car: { water: .38, quake: 1.48, distance: 5.8, tilt: .19, pieces: 4 },
      bin: { water: .13, quake: .19, distance: 3.6, tilt: 1.13, pieces: 3 },
      palm: { water: .72, quake: 1.46, distance: .34, tilt: 1.31, pieces: 6 },
      lamp: { water: .59, quake: 1.18, distance: .55, tilt: 1.57, pieces: 5 },
      bench: { water: .23, quake: 1.18, distance: 3.85, tilt: .65, pieces: 4 },
      glass: { water: .13, quake: .42, distance: 0, tilt: 0, pieces: 7 },
      trim: { water: 1.4, quake: .72, distance: .48, tilt: 1.29, pieces: 6 },
      wall: { water: .64, quake: .79, distance: .32, tilt: 1.51, pieces: 9 },
      crack: { water: .82, quake: .57, distance: 0, tilt: 0, pieces: 3 },
      building: { water: 1.42, quake: 1.68, distance: 0, tilt: .54, pieces: 15 },
      interior: { water: Infinity, quake: .33, distance: 0, tilt: 1.02, pieces: 0 },
    };

    function freshDamage(record) {
      record.water = record.shake = record.damage = record.drift = record.quakeDrift = 0;
      record.broken = false;
    }

    function advanceDamage(record, wetDepth, shaking, waveStep, quakeStep) {
      const { rule, resistance } = record;
      if (wetDepth > .065) {
        record.water += (wetDepth - .065) * waveStep * (1.04 + wetDepth * .39);
      }
      if (shaking > .08) record.shake += (shaking - .08) * quakeStep;
      const exposure = Math.max(record.water / rule.water, record.shake / rule.quake) / resistance;
      const target = smoothBetween(exposure, .55, 1.68);
      const dt = Math.max(waveStep, quakeStep);
      record.damage = Math.max(record.damage, Math.min(target, record.damage + dt * 1.85));
      if (wetDepth > .065 && record.damage > .19 && rule.distance) {
        record.drift = Math.min(rule.distance, record.drift + wetDepth * record.damage * waveStep * (1 + rule.distance * .43));
      }
      if (record.kind === "car" && record.damage > .23 && shaking > .39) {
        record.quakeDrift = Math.min(2.65, record.quakeDrift + (shaking - .39) * quakeStep * 1.24);
      }
      if (record.damage >= .35 && !record.broken) {
        record.broken = true;
        return true;
      }
      return false;
    }

    function buildCoast(THREE, world, terrain) {
      let seed = 5321;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const shoreY = (z) => z > -11 ? 0 : Math.max(-6, (z + 11) * .13);
      const sun = new THREE.Vector3(-.52, .119, -.92).normalize();
      const sharedTime = { value: 0 };

      const sky = new THREE.Mesh(new THREE.SphereGeometry(435, 28, 18), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { sun: { value: sun }, clock: sharedTime },
        vertexShader: `
          varying vec3 skyDirection;
          void main() {
            skyDirection = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          }`,
        fragmentShader: `
          uniform vec3 sun;
          uniform float clock;
          varying vec3 skyDirection;
          float hash(vec2 p) { return fract(sin(dot(p,vec2(143.7,297.2)))*43758.545); }
          float cloudNoise(vec2 p) {
            vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
          }
          void main() {
            vec3 d = normalize(skyDirection);
            float horizon = pow(1.-max(0.,d.y),5.5);
            float s = max(0.,dot(d,sun));
            vec3 col = mix(vec3(.052,.156,.305), vec3(.54,.277,.205), horizon);
            col += vec3(.48,.23,.071)*pow(s,13.) + vec3(.7,.24,.026)*pow(s,130.);
            vec2 uv = d.xz / max(.13,d.y+.13) * vec2(1.2,2.) + vec2(clock*.009,0.);
            float cloud = cloudNoise(uv)*.56 + cloudNoise(uv*2.1)*.29 + cloudNoise(uv*4.3)*.15;
            float cloudMask = smoothstep(.48,.73,cloud) * smoothstep(.015,.16,d.y) * (1.-smoothstep(.61,.95,d.y));
            col = mix(col,mix(vec3(.19,.205,.27),vec3(.82,.46,.31),pow(s,3.)*.94),cloudMask*.76);
            col += vec3(2.0,1.15,.38)*smoothstep(.99952,.99981,s);
            gl_FragColor = vec4(col,1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }));
      sky.frustumCulled = false;
      sky.renderOrder = -10;
      world.add(sky);

      const beachGeometry = new THREE.PlaneGeometry(302, 123, 36, 88);
      beachGeometry.rotateX(-Math.PI / 2);
      beachGeometry.translate(0, 0, 6);
      const beachPoints = beachGeometry.attributes.position;
      const groundColors = [];
      const sand = new THREE.Color();
      const wetSand = new THREE.Color("#8f7e69");
      const drySand = new THREE.Color("#c6a783");
      const cityBase = new THREE.Color("#8b8487");
      for (let i = 0; i < beachPoints.count; i++) {
        const x = beachPoints.getX(i);
        const z = beachPoints.getZ(i);
        const grain = (Math.sin(x * 2.31 + z * 4.2) * .5 + .5) * .06;
        beachPoints.setY(i, shoreY(z) - .052 + (z < -10 ? grain * .43 : 0));
        sand.copy(wetSand).lerp(drySand, smoothBetween(z, -17, -10)).lerp(cityBase, smoothBetween(z, -10.6, -7));
        sand.multiplyScalar(.91 + grain + random() * .09);
        groundColors.push(sand.r, sand.g, sand.b);
      }
      beachGeometry.setAttribute("color", new THREE.Float32BufferAttribute(groundColors, 3));
      beachGeometry.computeVertexNormals();
      const shore = new THREE.Mesh(beachGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96 }));
      shore.receiveShadow = true;
      terrain.add(shore);

      const oceanGeometry = new THREE.PlaneGeometry(480, 350, 145, 150);
      oceanGeometry.rotateX(-Math.PI / 2);
      oceanGeometry.translate(0, 0, -147);
      const oceanPoints = oceanGeometry.attributes.position;
      for (let i = 0; i < oceanPoints.count; i++) {
        const x = oceanPoints.getX(i);
        const z = oceanPoints.getZ(i);
        if (Math.abs(x) > 110) oceanPoints.setX(i, Math.sign(x) * (110 + Math.pow((Math.abs(x) - 110) / 130, 1.5) * 655));
        if (z < -118) oceanPoints.setZ(i, -118 - Math.pow((-118 - z) / 204, 1.48) * 650);
      }
      const oceanUniforms = {
        clock: sharedTime, oceanTime: { value: 0 }, retreat: { value: 0 }, crestFront: { value: -100 },
        crestHeight: { value: 0 }, runup: { value: 0 }, swell: { value: 0 },
        spread: { value: .55 }, sun: { value: sun },
      };
      const ocean = new THREE.Mesh(oceanGeometry, new THREE.ShaderMaterial({
        uniforms: oceanUniforms, side: THREE.DoubleSide,
        vertexShader: `
          uniform float clock, oceanTime, retreat, crestFront, crestHeight, runup, swell, spread;
          varying vec3 seaLocal;
          varying vec3 seaWorld;
          varying float foamHint;
          void main() {
            vec3 p = position;
            float z = p.z;
            float shore = -.48 - retreat*.73;
            float chop = sin(z*.76 + p.x*.14 + sin(p.x*.1)*1.7 + clock*1.65)*.035 + cos(p.x*.59 + z*.24 + clock*1.25)*.026;
            float shoulder = exp(-pow(abs(z+93.)*.10,2.)) * sin(z*.78+oceanTime*3.8)*swell;
            float width = mix(4.,9.,spread);
            float side = p.x;
            float along = z;
            float curvedFront = crestFront - pow(abs(side)/max(19.,45.+spread*32.),2.)*9.2;
            float front = (along-curvedFront)/width;
            float coverage = exp(-pow(abs(side)/(36.+spread*73.),4.));
            float edge = 1.-smoothstep(-1.3,1.8,along-curvedFront + sin(p.x*.39)*.46);
            float surge = runup * coverage * edge * (1.22+spread*.53) * smoothstep(-32.,-11.,z);
            float body = exp(-front*front)*crestHeight*coverage;
            p.y=shore+chop+body+surge+shoulder;
            foamHint=body*.32 + runup*coverage*exp(-pow(abs(along-curvedFront)*.57,2.))*.60;
            seaLocal=p;
            vec4 world=modelMatrix*vec4(p,1.);
            seaWorld=world.xyz;
            gl_Position=projectionMatrix*viewMatrix*world;
          }`,
        fragmentShader: `
          uniform float clock, retreat;
          uniform vec3 sun;
          varying vec3 seaLocal;
          varying vec3 seaWorld;
          varying float foamHint;
          void main() {
            vec3 vx = dFdx(seaWorld), vy = dFdy(seaWorld);
            vec3 n = normalize(cross(vx,vy));
            if (n.y<0.) n=-n;
            float x = seaLocal.x, z = seaLocal.z;
            float a = sin(x*.43+z*2.8+sin(x*.15+z*.17)*2.8+clock*2.);
            float b = cos(x*1.57-z*.46 + sin(z*.39)*1.7-clock*1.3);
            n=normalize(mix(vec3(0.,1.,0.),n,.5+clamp(foamHint,0.,.5))+vec3(a*.045,0.,b*.061));
            vec3 eye=normalize(cameraPosition-seaWorld);
            float fresnel=pow(1.-max(0.,dot(n,eye)),3.);
            float shine=pow(max(0.,dot(n,normalize(eye+sun))),60.);
            float shimmer=pow(max(0.,dot(reflect(-sun,n),eye)),12.);
            float coast=smoothstep(-39.,-11.,z);
            vec3 sea=mix(vec3(.019,.105,.186),vec3(.047,.223,.24),coast);
            sea=mix(sea,vec3(.244,.269,.316),fresnel*.8);
            sea+=vec3(1.,.56,.27)*(shine*.97+shimmer*.09);
            float wetEdge=(1.-smoothstep(-13.,-9.,z)) *
              (1.-smoothstep(.10,.53,abs(seaLocal.y-max(-6.,min(0.,(z+11.)*.13)))));
            float lace=sin(x*1.5+z*4.2+clock*2.5+sin(x*.57-z*.31)*2.7)*.29 +
              cos(x*.7-z*2.1-clock*1.7+sin(x*.22+z*.88)*2.9)*.22 +
              sin(x*3.9-z*5.2+clock*1.1)*.09+.44;
            float suds=smoothstep(.53,.86,lace+foamHint*.37) * max(wetEdge*.6,clamp(foamHint,0.,1.));
            sea=mix(sea,vec3(.72,.83,.82),clamp(suds,0.,.94));
            float fade=smoothstep(100.,285.,distance(cameraPosition.xz,seaWorld.xz));
            vec3 flatLook=normalize(vec3(-eye.x,0.,-eye.z));
            float glow=max(0.,dot(flatLook,sun));
            vec3 haze=vec3(.54,.277,.205)+vec3(.48,.23,.071)*pow(glow,13.)+vec3(.7,.24,.026)*pow(glow,130.);
            sea=mix(sea,haze,fade);
            gl_FragColor=vec4(sea,1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }));
      ocean.frustumCulled = false;
      terrain.add(ocean);

      function surface(color, roughness = .8, emissive, intensity = 0) {
        return new THREE.MeshStandardMaterial({ color, roughness, emissive, emissiveIntensity: intensity });
      }
      const asphalt = surface("#4f535f");
      const paving = surface("#b2a4a0");
      const curb = surface("#d4c3ac");
      const paint = surface("#ebd9a4");
      const brick = surface("#96786d");
      const glass = surface("#455861", .31, "#eeb981", .045);
      const litGlass = surface("#b88563", .44, "#efae77", .24);
      const trim = surface("#c2b5a9");
      const frame = surface("#3e444e", .68);
      const planters = surface("#726758");
      const leaf = surface("#4c6850", .9);
      const wood = surface("#a27558");
      const lamp = surface("#eec997", .26, "#ffd993", 1.05);
      const facades = ["#c9b7a0", "#b7877b", "#d3c4b1", "#829da1", "#a294a2"].map((color) => surface(color));
      const carColors = ["#9b5754", "#6c909b", "#c9bda8", "#4d535b", "#aa865d"].map((color) => surface(color, .4));
      const boxShape = new THREE.BoxGeometry(1, 1, 1);
      const batches = new Map();
      const cityBatches = [];
      const reactive = [];
      const walls = [];
      let lastQuakeTime = 0;
      let damageTime = 0;

      function damageActor(group, kind, tint = "#a28670", contactY) {
        const rest = group.position.clone();
        const anchor = group.getWorldPosition(new THREE.Vector3());
        const scatter = Math.abs(Math.sin(anchor.x * 18.71 + anchor.y * 4.99 + anchor.z * 9.51) * 43174.833) % 1;
        const record = { group, kind, color: new THREE.Color(tint), rest, anchor, rotation: group.rotation.clone(),
          rule: damageRules[kind], resistance: .71 + scatter * .83, contactY: contactY ?? anchor.y };
        freshDamage(record);
        reactive.push(record);
        return record;
      }

      function fixture(x, y, z, kind, tint, contactY, parent = terrain) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        parent.add(group);
        damageActor(group, kind, tint, contactY);
        return group;
      }

      function box(mat, x, y, z, w, h, d, rotation = 0, parent = null) {
        const pool = parent?.userData.boxBatches;
        if (pool) {
          if (!pool.has(mat)) pool.set(mat, []);
          pool.get(mat).push([x, y, z, w, h, d, rotation]);
          return;
        }
        if (parent) {
          const mesh = new THREE.Mesh(boxShape, mat);
          mesh.position.set(x, y, z);
          mesh.scale.set(w, h, d);
          mesh.rotation.y = rotation;
          mesh.castShadow = w > .33 && d > .22 && mat !== glass;
          mesh.receiveShadow = true;
          parent.add(mesh);
          return mesh;
        }
        if (!batches.has(mat)) batches.set(mat, []);
        batches.get(mat).push([x, y, z, w, h, d, rotation]);
      }

      box(paving, 0, -.002, 1.7, 17.5, .091, 11.1);
      for (let i = -8; i <= 8; i++) box(curb, i, .048, 1.7, .016, .01, 10.9);
      for (const z of [-7, 11, 24.3]) {
        box(asphalt, 0, .009, z, 131, .095, 4.77);
        for (const side of [-1, 1]) {
          box(paving, 0, .065, z + side * 3.07, 133, .15, 1.27);
          box(curb, 0, .112, z + side * 2.43, 132, .13, .12);
        }
        for (let x = -63; x < 65; x += 4.2) box(paint, x, .059, z, 1.65, .011, .08);
      }
      for (const x of [-11.1, 11.1, -31, 31]) {
        box(asphalt, x, .012, 16.6, 3.7, .095, 43);
        for (const side of [-1, 1]) box(paving, x + side * 2.24, .061, 16.65, .74, .15, 43);
        for (let stripe = -2; stripe <= 2; stripe++) box(paint, x + stripe * .53, .077, -4.84, .23, .012, 1);
      }
      const promenadeZ = -10.34;
      box(paving, 0, .042, promenadeZ, 138, .17, 1.1);
      for (let x = -54; x <= 54; x += 3.1) {
        box(trim, x, .31, -10.84, .065, .45, .09);
        box(wood, x + 1.53, .52, -10.84, 3.12, .06, .09);
      }

      const hillGeometry = new THREE.PlaneGeometry(350, 113, 86, 26);
      hillGeometry.rotateX(-Math.PI / 2);
      hillGeometry.translate(0, 0, -108);
      const hills = hillGeometry.attributes.position;
      const hillsColors = [];
      const hillColor = new THREE.Color();
      const green = new THREE.Color("#5c706a");
      const mauve = new THREE.Color("#88788a");
      function cliff(x, z) {
        const left = 29 * Math.exp(-Math.pow((x + 87) / 35, 2) - Math.pow((z + 101) / 34, 2));
        const right = 39 * Math.exp(-Math.pow((x - 107) / 45, 2) - Math.pow((z + 128) / 32, 2));
        const ridges = 5.8 * Math.exp(-Math.pow((Math.abs(x) - 114) / 47, 2)) * (Math.sin(x * .12 + z * .14) * .5 + .5);
        return left + right + ridges - 3.3;
      }
      for (let i = 0; i < hills.count; i++) {
        const x = hills.getX(i), z = hills.getZ(i);
        const y = cliff(x, z);
        hills.setY(i, y);
        hillColor.copy(green).lerp(mauve, smoothBetween(y, 11, 41)).multiplyScalar(.84 + random() * .18);
        hillsColors.push(hillColor.r, hillColor.g, hillColor.b);
      }
      hillGeometry.setAttribute("color", new THREE.Float32BufferAttribute(hillsColors, 3));
      hillGeometry.computeVertexNormals();
      terrain.add(new THREE.Mesh(hillGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98 })));

      const fissureShape = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([
        -.69,.53,0, -.39,.29,0, -.39,.29,0, -.19,.35,0, -.19,.35,0, .04,.13,0, .04,.13,0, .27,-.25,0,
        .27,-.25,0, .49,-.18,0, .49,-.18,0, .73,-.58,0, -.19,.35,0, .04,.54,0, .27,-.25,0, .11,-.55,0,
      ], 3));
      function fissure(x, y, z, contactY, parent = terrain) {
        const group = fixture(x, y, z, "crack", "#b8a292", contactY, parent);
        group.add(new THREE.LineSegments(fissureShape, new THREE.LineBasicMaterial({
          color: "#3d2925", transparent: true, opacity: 0,
        })));
        group.visible = false;
        return group;
      }
      for (const z of [-7, 1.7, 11, 24.3]) {
        for (const x of [-26, -13, -6, 4, 11, 20, 31]) {
          const crack = fissure(x, .075, z + Math.sin(x) * .86, .075);
          crack.rotation.set(-Math.PI / 2, 0, x * .29 + z * .34);
          crack.scale.set(1.3 + Math.abs(Math.sin(x * z)) * 1.9, .68, 1);
        }
      }

      function architecture(x, z, w, d, floors, style, hill = false) {
        const y = hill ? cliff(x, z) : .02;
        const h = floors * 1.02;
        const accent = facades[style % facades.length];
        const vulnerable = !hill && Math.abs(x) < 36 && z < 22;
        const body = vulnerable ? fixture(x, y, z, "building", accent.color, .22) : null;
        if (body) {
          body.userData.boxBatches = new Map();
          cityBatches.push(body);
        }
        if (!hill) walls.push({ x, z, w: w * .5 + .27, d: d * .5 + .27, structure: body ? reactive.at(-1) : null });
        const facade = (mat, px, py, pz, width, height, depth) => {
          if (body) box(mat, px - x, py - y, pz - z, width, height, depth, 0, body);
          else box(mat, px, py, pz, width, height, depth);
        };
        facade(accent, x, y + h / 2, z, w, h, d);
        facade(trim, x, y + h + .08, z, w + .13, .19, d + .18);
        if (body) {
          const coping = fixture(w * .15, h + .14, -d * .11, "trim", "#b58c77", y + h, body);
          box(brick, 0, .27, 0, w * .42, .55, d * .48, 0, coping);
          fissure(w * .17, h * .59, d * .5 + .065, y + h * .59, body);
        } else facade(brick, x + w * .15, y + h + .41, z - d * .11, w * .42, .55, d * .48);
        if (hill) {
          facade(glass, x, y + h*.64, z + d / 2 + .023, w*.63, .27, .04);
          return;
        }
        const bays = Math.max(2, Math.floor(w / .91));
        for (let row = 0; row < floors; row++) {
          for (const sign of [-1, 1]) {
            const side = z + sign * (d / 2 + .025);
            facade(trim, x, y + (row + .14) * 1.02, side, w + .055, .055, .08);
            for (let bay = 0; bay < bays; bay++) {
              const panelX = x + ((bay + .5) / bays - .5) * w * .90;
              const pane = random() > .83 ? litGlass : glass;
              const paneY = y + (row + .58) * 1.02;
              if (body && row < 3 && (bay + row + style) % 3 === 0) {
                facade(frame, panelX, paneY, side - sign*.021, .525, .52, .036);
                const looseGlass = fixture(panelX - x, paneY - y, side - z + sign*.013, "glass", "#8eb6c3", paneY - .2, body);
                box(pane, 0, 0, 0, .52, .51, .041, 0, looseGlass);
              } else facade(pane, panelX, paneY, side, .52, .51, .058);
            }
          }
          facade(glass, x - w / 2 - .03, y + (row+.62) * 1.02, z, .061, .43, d*.65);
          facade(glass, x + w / 2 + .03, y + (row+.62) * 1.02, z, .061, .43, d*.65);
        }
      }
      for (const sign of [-1, 1]) {
        for (let col = 0; col < 9; col++) {
          for (let row = 0; row < 3; row++) {
            const x = sign * (15.6 + col * 5.8 + (col > 2 ? 3.5 : 0)) + (random()-.5)*1.3;
            const z = [1.1, 17, 31.5][row] + (random()-.5)*3.5;
            const h = 2 + Math.floor(random() * (row === 0 ? 5 : 7));
            architecture(x,z,3 + random()*1.6,3.1 + random()*2.2,h,col + row * 2);
          }
        }
        for (let i=0;i<40;i++) {
          const x=sign*(52+random()*80), z=-68-random()*63;
          if (cliff(x,z)>2.4) architecture(x,z,2+random()*2.4,2.2+random()*1.5,1+Math.floor(random()*2),i,true);
        }
      }

      const tyre = surface("#28292f", .93);
      const wheels = new THREE.CylinderGeometry(.24, .24, .116, 10);
      function car(x, z, index, moves) {
        const group = new THREE.Group();
        group.position.set(x, .114, z);
        group.rotation.y = index % 2 === 0 ? 0 : Math.PI;
        terrain.add(group);
        box(carColors[index % carColors.length], 0, .36, 0, 2.54, .43, 1.21, 0, group);
        box(carColors[index % carColors.length], -.14, .62, 0, 1.24, .34, 1.04, 0, group);
        box(glass, -.14, .65, .525, 1.04, .194, .025, 0, group);
        box(glass, -.14, .65, -.525, 1.04, .194, .025, 0, group);
        box(glass, .49, .62, 0, .028, .17, .89, 0, group);
        for (const end of [-1,1]) {
          for (const side of [-1,1]) {
            const wheel = new THREE.Mesh(wheels, tyre);
            wheel.position.set(end * .79, .228, side * .57);
            wheel.rotation.x = Math.PI / 2;
            group.add(wheel);
            box(end === 1 ? lamp : brick, end * 1.251, .42, side * .375, .035, .112, .26, 0, group);
          }
        }
        if (moves) {
          damageActor(group, "car", carColors[index % carColors.length].color, .11).resistance = .77 + random()*.71;
        }
      }

      for (let i = 0; i < 14; i++) {
        const x = (i < 7 ? -1 : 1) * (10.9 + (i % 7) * 5.3);
        car(x, i % 3 === 0 ? 9.25 : -5.6, i, i % 2 === 0 || i % 3 === 0);
      }

      for (let x = -58; x <= 58; x += 6.4) {
        const pole = Math.abs(x) < 37 ? fixture(x, .055, -9.98, "lamp", "#88808a") : null;
        const poleX = pole ? 0 : x, poleY = pole ? -.055 : 0, poleZ = pole ? 0 : -9.98;
        box(frame, poleX, 1.58 + poleY, poleZ, .10, 3.05, .10, 0, pole);
        box(frame, poleX + .19, 3.08 + poleY, poleZ, .42, .085, .11, 0, pole);
        box(lamp, poleX + .4, 3.03 + poleY, poleZ, .28, .09, .18, 0, pole);
        if (Math.abs(x) < 42 && Math.floor(x) % 2 === 0) {
          const seat = fixture(x+1.62, .04, promenadeZ, "bench", "#aa7955");
          box(wood, 0, .48, 0, 1.27, .083, .35, 0, seat);
          box(wood, 0, .72, -.16, 1.27, .28, .075, 0, seat);
          for (const sign of [-1, 1]) box(frame, sign*.44, .23, 0, .085, .44, .27, 0, seat);
        }
        if (Math.abs(x) < 16) {
          const bin = new THREE.Group();
          bin.position.set(x + .85, .02, promenadeZ + .18);
          terrain.add(bin);
          box(planters, 0, .34, 0, .34, .59, .33, 0, bin);
          box(frame, 0, .65, 0, .38, .09, .37, 0, bin);
          damageActor(bin, "bin", "#7b6b52").resistance = .73 + random()*.76;
        }
      }
      for (const side of [-1, 1]) {
        for (let section = 0; section < 4; section++) {
          const wall = fixture(side * (14.5 + section * 5.7), .042, -2.35, "wall", "#b69a83");
          box(brick, 0, .35, 0, 2.8, .7, .22, 0, wall);
          box(trim, 0, .72, 0, 2.84, .08, .29, 0, wall);
        }
      }

      const palms = [];
      const bark = surface("#947760", .92);
      const frondMaterial = new THREE.MeshStandardMaterial({ color: "#597457", roughness: .85, side: THREE.DoubleSide });
      const palmTrunk = new THREE.CylinderGeometry(.102, .17, 4.27, 7);
      function createFronds() {
        const data = [];
        for (let frond = 0; frond < 9; frond++) {
          const angle = frond * 2.40;
          const reach = 1.55 + random() * .83;
          for (let i = 1; i <= 10; i++) {
            const t = i / 11, prev = (i-1) / 11;
            const tip = [Math.cos(angle)*t*reach, Math.sin(t*2.7)*.74 - t*t*.94, Math.sin(angle)*t*reach];
            const base = [Math.cos(angle)*prev*reach, Math.sin(prev*2.7)*.74 - prev*prev*.94, Math.sin(angle)*prev*reach];
            const l = Math.sin(t*Math.PI)*.344+.05;
            for (const sign of [-1,1]) {
              data.push(...base, ...tip, tip[0] - Math.sin(angle)*l*sign - Math.cos(angle)*.18, tip[1]-.13, tip[2] + Math.cos(angle)*l*sign - Math.sin(angle)*.18);
            }
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
        geometry.computeVertexNormals();
        return geometry;
      }
      const fronds = createFronds();
      for (let i = 0; i < 14; i++) {
        const x = -45 + i * 6.8 + random() * 1.4;
        const z = i % 3 === 0 ? -3.85 : -10.44;
        const base = fixture(x, .02, z, "palm", "#816a4d", -.055);
        const trunk = new THREE.Mesh(palmTrunk, bark);
        trunk.position.set(0, 2.22, 0);
        trunk.rotation.z = (random() - .5) * .105;
        trunk.castShadow = true;
        base.add(trunk);
        const crown = new THREE.Mesh(fronds, frondMaterial);
        crown.position.set(-trunk.rotation.z * 2.15, 4.37, 0);
        crown.rotation.y = random() * 6.28;
        crown.castShadow = true;
        base.add(crown);
        palms.push(crown);
        box(planters, x, .18, z, .83, .31, .83);
        box(leaf, x, .34, z, .68, .03, .68);
      }
      const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.62, 1), leaf, 58);
      const dummy = new THREE.Object3D();
      for (let i=0;i<58;i++) {
        const side=i%2===0 ? 1 : -1;
        dummy.position.set(side*(9.2+random()*54),.26+random()*.13, i%3===0 ? 7.61 : -3.62 + random()*.49);
        dummy.scale.set(.7+random()*.62,.52+random()*.26,.65+random()*.66);
        dummy.rotation.set(0,random()*6.28,0);
        dummy.updateMatrix();
        bushes.setMatrixAt(i, dummy.matrix);
      }
      bushes.receiveShadow = bushes.castShadow = true;
      terrain.add(bushes);

      function instanceBoxes(parent, pools) {
        for (const [mat, pool] of pools) {
          const instances = new THREE.InstancedMesh(boxShape, mat, pool.length);
          for (const [i, [x,y,z,w,h,d,rotation]] of pool.entries()) {
            dummy.position.set(x,y,z);
            dummy.scale.set(w,h,d);
            dummy.rotation.set(0,rotation,0);
            dummy.updateMatrix();
            instances.setMatrixAt(i,dummy.matrix);
          }
          instances.receiveShadow = true;
          instances.castShadow = facades.includes(mat) || mat === frame || mat === wood;
          parent.add(instances);
        }
      }
      instanceBoxes(terrain, batches);
      for (const body of cityBatches) {
        instanceBoxes(body, body.userData.boxBatches);
        delete body.userData.boxBatches;
      }

      function particles(count, tint, size) {
        const geometry = new THREE.BufferGeometry();
        const points = new Float32Array(count * 3);
        const opacity = new Float32Array(count);
        const coordinates = new THREE.BufferAttribute(points, 3).setUsage(THREE.DynamicDrawUsage);
        const alphas = new THREE.BufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("position", coordinates);
        geometry.setAttribute("pointAlpha", alphas);
        const material = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false,
          uniforms: { tint: { value: new THREE.Color(tint) }, pixels: { value: size } },
          vertexShader: `
            attribute float pointAlpha; varying float alpha; uniform float pixels;
            void main(){alpha=pointAlpha; vec4 eye=modelViewMatrix*vec4(position,1.); gl_PointSize=clamp(pixels*32./max(1.,-eye.z),1.,24.);gl_Position=projectionMatrix*eye;}`,
          fragmentShader: `
            varying float alpha; uniform vec3 tint;
            void main(){float radial=length(gl_PointCoord-.5)*2.; gl_FragColor=vec4(tint,alpha*(1.-smoothstep(.18,1.,radial)));
            #include <colorspace_fragment>
            }`,
        });
        const cloud = new THREE.Points(geometry, material);
        cloud.visible = false;
        cloud.frustumCulled = false;
        terrain.add(cloud);
        return { cloud, points, opacity, coordinates, alphas, seeds: Array.from({length:count}, () => ({x:random(), y:random(), z:random()})) };
      }
      const dust = particles(98, "#d9b387", 12);
      const spray = particles(120, "#d6f5f2", 7);
      const fragmentCapacity = 144;
      const fragments = Array.from({ length: fragmentCapacity }, () => ({ life: 0, color: new THREE.Color() }));
      const fragmentsMesh = new THREE.InstancedMesh(boxShape, surface("#ffffff", .75), fragmentCapacity);
      fragmentsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fragmentsMesh.count = 0;
      fragmentsMesh.frustumCulled = false;
      fragmentsMesh.receiveShadow = true;
      terrain.add(fragmentsMesh);
      let nextFragment = 0;

      function scatterDebris(record, wet) {
        const count = record.rule.pieces;
        for (let i = 0; i < count; i++) {
          const fragment = fragments[nextFragment];
          nextFragment = (nextFragment + 1) % fragmentCapacity;
          const angle = record.resistance * 31 + i * 2.399;
          const speed = .32 + i % 4 * .18;
          const h = record.kind === "building" ? .6 + i % 4 * .63
            : record.kind === "palm" || record.kind === "lamp" ? 1.6 + i % 3 * .55 : .24;
          fragment.life = 22 + i % 4 * 2;
          fragment.x = record.anchor.x + (record.kind === "building" ? Math.cos(angle) * (i % 4) * .46 : 0);
          fragment.y = record.anchor.y + h;
          fragment.z = record.anchor.z + (record.kind === "building" ? Math.sin(angle) * (i % 4) * .48 : 0);
          fragment.vx = Math.cos(angle) * speed;
          fragment.vz = Math.sin(angle) * speed + (wet > .08 ? 1.08 : .06);
          fragment.vy = .38 + i % 3 * .24;
          fragment.angle = angle;
          fragment.size = record.kind === "glass" ? .057 + i % 3 * .027 : .09 + i % 4 * .044;
          fragment.flat = record.kind === "glass" ? .19 : .58 + i % 3 * .16;
          fragment.color.copy(record.color).multiplyScalar(.83 + i % 4 * .12);
        }
      }

      function poseDamage(record, water, shaking = 0) {
        const { group, kind, rest, rotation, rule, damage, drift, quakeDrift, broken } = record;
        if (kind === "glass") {
          group.visible = !broken;
          group.rotation.set(rotation.x, rotation.y, rotation.z + shaking * Math.sin(damageTime * 21.5 + record.resistance * 13) * .016);
          return;
        }
        if (kind === "crack") {
          group.visible = damage > .12;
          group.children[0].material.opacity = smoothBetween(damage, .12, .85) * .9;
          return;
        }
        const collapse = smoothBetween(damage, .24, .98);
        const tilt = rule.tilt * smoothBetween(damage, .16, .99);
        const jitter = Math.sin(damageTime * 18 + record.resistance * 18) * shaking * .044;
        const sway = Math.sin(record.resistance * 31);
        const floating = ["bench", "bin", "car"].includes(kind) && damage > .16
          ? Math.max(0, water - rest.y) * (kind === "car" ? .25 : .64) * damage : 0;
        group.position.set(rest.x + sway * quakeDrift,
          rest.y + floating - (kind === "trim" ? damage * .75 : 0), rest.z + drift + quakeDrift * .24);
        group.rotation.set(rotation.x + tilt, rotation.y + drift * .075 + sway * quakeDrift * .16,
          rotation.z + jitter + (kind === "building" ? sway * tilt * .65 : 0) + (kind === "car" ? damage * .1 : 0));
        if (kind === "building") group.scale.y = 1 - collapse * .81;
      }

      function updateDamage(visual, seismic, shaking) {
        const waveStep = interactionMode === "wave" ? wave.forwardStep : 0;
        const quakeStep = interactionMode === "quake" ? clamp(seismic - lastQuakeTime, 0, .09) : 0;
        lastQuakeTime = seismic;
        const dt = Math.max(interactionMode === "wave" ? wave.motionStep : 0, quakeStep);
        damageTime += dt;
        const wet = (x, z) => waveWaterAt(x, z, visual, wave.size);
        for (const record of reactive) {
          const { anchor, contactY } = record;
          const water = wet(anchor.x, anchor.z);
          const wetDepth = water - contactY;
          const localShake = shaking * Math.max(.22, 1 - Math.hypot(anchor.x, anchor.z) / 100);
          if ((waveStep || quakeStep) && advanceDamage(record, wetDepth, localShake, waveStep, quakeStep)) {
            scatterDebris(record, waveStep > 0 ? wetDepth : 0);
          }
          poseDamage(record, water, localShake);
        }

        if (!dt) return;
        let visible = 0;
        for (const fragment of fragments) {
          if (fragment.life <= 0) continue;
          fragment.life -= dt;
          const bed = shoreY(fragment.z) + fragment.size*.44 + .052;
          const surfaceY = wet(fragment.x, fragment.z);
          const floating = surfaceY > bed + .09;
          fragment.vy -= 4.8 * dt;
          fragment.x += fragment.vx * dt;
          fragment.z += (fragment.vz + (floating && interactionMode === "wave" ? wave.motion * .72 : 0)) * dt;
          fragment.y += fragment.vy * dt;
          if (fragment.y < bed || floating) {
            fragment.y = floating ? surfaceY + .043 + Math.sin(damageTime * 5 + fragment.angle) * .026 : bed;
            fragment.vx *= floating ? .966 : .55;
            fragment.vz *= floating ? .967 : .55;
            fragment.vy = 0;
          }
          if (floating) fragment.angle += dt * .8;
          dummy.position.set(fragment.x, fragment.y, fragment.z);
          const scale = fragment.size * clamp(fragment.life, .01, 1);
          dummy.scale.set(scale * 1.6, scale * fragment.flat, scale);
          dummy.rotation.set(fragment.angle * .51, fragment.angle, fragment.angle * .76);
          dummy.updateMatrix();
          fragmentsMesh.setMatrixAt(visible, dummy.matrix);
          fragmentsMesh.setColorAt(visible++, fragment.color);
        }
        fragmentsMesh.count = visible;
        if (visible) {
          fragmentsMesh.instanceMatrix.needsUpdate = true;
          fragmentsMesh.instanceColor.needsUpdate = true;
        }
      }

      function resetDamage() {
        lastQuakeTime = damageTime = 0;
        for (const record of reactive) {
          freshDamage(record);
          poseDamage(record, -.48);
        }
        for (const item of fragments) item.life = 0;
        nextFragment = fragmentsMesh.count = 0;
        spray.cloud.visible = dust.cloud.visible = false;
        for (const ring of rings) ring.visible = false;
      }
      const rings = [];
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(.973, 1, 64), new THREE.MeshBasicMaterial({
          color: "#f9d1a1", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = .173;
        ring.visible = false;
        terrain.add(ring);
        rings.push(ring);
      }

      function animate(now) {
        const time = now * .001;
        sharedTime.value = time;
        const visual = waveVisual(wave.time, wave.height, wave.size);
        const water = { oceanTime: wave.time, retreat: visual.retreat, crestFront: visual.front, crestHeight: visual.crest,
          runup: visual.flood, swell: visual.disturbance, spread: wave.size };
        for (const [name, value] of Object.entries(water)) oceanUniforms[name].value = value;
        const seismic = state.steps * timeStep;
        const shaking = interactionMode === "quake" && state.mode === "running" ? Math.min(1, state.activity * .42 + Math.hypot(state.signal, state.signalY, state.signalZ) / inputScale) : 0;
        for (const [index, palm] of palms.entries()) {
          palm.rotation.x = .1 + Math.sin(time * 1.25 + index *.72) * .08 + Math.sin(seismic*8+index) * shaking*.11;
          palm.rotation.z = Math.cos(time*.94 + index) * .13 + visual.flood*.13;
        }
        updateDamage(visual, seismic, shaking);
        for (const [i, ring] of rings.entries()) {
          const phase = (seismic *.79+i/3)%1;
          ring.visible = shaking > .025;
          ring.scale.setScalar(1.9 + phase*17);
          ring.material.opacity = (1-phase)*shaking*.42;
        }
        dust.cloud.visible = shaking > .03;
        spray.cloud.visible = interactionMode === "wave" && wave.phase === "running" && (visual.crest > .48 || visual.flood > .2);
        if (dust.cloud.visible) {
          for (const [i, p] of dust.seeds.entries()) {
            const age = (p.z + seismic*.78)%1;
            const angle = p.x*Math.PI*2;
            const r = 2.8+p.y*6.3+age*2;
            dust.points.set([Math.cos(angle)*r, .1+age*(.33+p.y*.58), Math.sin(angle)*r], i*3);
            dust.opacity[i] = Math.sin(age*Math.PI)*shaking*.34;
          }
          dust.coordinates.needsUpdate = dust.alphas.needsUpdate = true;
        }
        if (spray.cloud.visible) {
          for (const [i,p] of spray.seeds.entries()) {
            const age=(p.z+wave.fxTime*1.5)%1;
            const x=(p.x-.5)*(29+wave.size*50);
            const z=visual.front-1.14-(x*x)*.0016+(p.y-.5)*4.2 + age*2.2;
            spray.points.set([x, Math.max(.08, visual.crest*.71+visual.flood*.43-.33) +
              Math.sin(age*Math.PI)*(.2+p.y*.62), z], i*3);
            spray.opacity[i]=Math.sin(age*Math.PI) * clamp(visual.crest*.22+visual.flood*.42,0,.66);
          }
          spray.coordinates.needsUpdate = spray.alphas.needsUpdate = true;
        }
      }
      return { animate, resetDamage, shoreY, blocked(x, z) { return walls.some((wall) => (wall.structure?.damage ?? 0) < .83 &&
        Math.abs(x - wall.x) < wall.w && Math.abs(z - wall.z) < wall.d); } };
    }

    function buildScene(scene, camera, THREE) {
      const world = scene.object3D;
      const renderer = scene.renderer;
      const canvas = renderer.domElement;
      const viewport = byId("viewport");
      world.background = new THREE.Color("#b99288");
      world.fog = new THREE.Fog("#b58c88", 53, 210);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;

      const hemisphere = new THREE.HemisphereLight("#b4cde7", "#9f6d54", 1.88);
      world.add(hemisphere);
      const key = new THREE.DirectionalLight("#ffbd80", 2.8);
      key.position.set(-24, 22, -23);
      key.castShadow = true;
      Object.assign(key.shadow.camera, { left: -33, right: 33, top: 26, bottom: -22, near: 2, far: 89 });
      key.shadow.mapSize.set(1536, 1536);
      key.shadow.bias = -0.00025;
      key.shadow.normalBias = 0.037;
      key.shadow.radius = 2;
      world.add(key);
      const rim = new THREE.DirectionalLight("#98bff0", .82);
      rim.position.set(8, 12, 12);
      world.add(rim);

      const terrain = new THREE.Group();
      world.add(terrain);
      const coast = buildCoast(THREE, world, terrain);
      function drawLines(vertices, color, opacity, parent = world) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
        parent.add(new THREE.LineSegments(geometry, material));
      }

      const support = new THREE.Group();
      world.add(support);
      const slab = new THREE.MeshStandardMaterial({ color: "#22374d", roughness: 0.72, metalness: 0.22 });
      const deck = new THREE.MeshStandardMaterial({ color: "#32465a", roughness: 0.6, metalness: 0.2 });
      const rows = 25;
      const pitch = 0.53;
      const height = rows * pitch;
      const width = 3.68;
      const depth = 3.46;
      const roomStart = 20;
      const roomEnd = rows;
      const roomFloor = .39 + roomStart * pitch + .09;
      const roomBendRatio = (((roomStart + roomEnd) * pitch / 2) / height) ** 2;
      const towers = {};
      const towerHits = [];
      const raycaster = new THREE.Raycaster();
      const invisible = new THREE.MeshBasicMaterial({ visible: false });
      const template = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      const boxPositions = template.getAttribute("position");
      const boxNormals = template.getAttribute("normal");

      function addSlab(parent, w, h, d, y, material) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
        mesh.position.y = y;
        mesh.receiveShadow = true;
        parent.add(mesh);
      }

      function addTower(id, x, tint, accent, protectedTower) {
        const foundation = new THREE.Group();
        foundation.position.x = x;
        support.add(foundation);
        addSlab(foundation, 5.8, 0.18, 5.3, 0.1, slab);
        addSlab(foundation, 4.77, 0.23, 4.46, 0.275, deck);
        const perimeter = [];
        for (const sign of [-1, 1]) {
          perimeter.push(-2.85, .19, sign * 2.62, 2.85, .19, sign * 2.62);
          perimeter.push(sign * 2.85, .19, -2.62, sign * 2.85, .19, 2.62);
          for (const marker of [-2.08, 2.08]) {
            perimeter.push(marker - .21, .397, sign * 2.02, marker + .21, .397, sign * 2.02);
            perimeter.push(marker, .397, sign * 1.81, marker, .397, sign * 2.21);
          }
        }
        drawLines(perimeter, tint, 0.83, foundation);

        const structure = new THREE.Group();
        structure.position.y = .39;
        foundation.add(structure);
        const bend = { value: new THREE.Vector3() };
        const point = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const zAxis = new THREE.Vector3(0, 0, 1);

        function material(color, emissive = "#000000", intensity = 0) {
          return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: 0.48, metalness: 0.28 });
        }

        const palette = {
          core: material("#12253a"),
          dark: material("#152c42", "#112338", .28),
          cool: material("#4b7998", "#518ab1", .56),
          soft: material("#7297ad", "#7ca0ae", .66),
          lit: material(accent, accent, 1.12),
          steel: material("#314459"),
          frame: material(accent, tint, .43),
          highlight: material(tint, tint, 1.35),
          damper: material(tint, tint, 1.1),
          interior: material("#28394a", "#1c2a3a", .38),
          screen: material("#162535", tint, .19),
        };
        const batches = new Map();

        function box(kind, x, y, z, w, h, d, rotation) {
          if (!batches.has(kind)) batches.set(kind, { positions: [], normals: [] });
          const { positions, normals } = batches.get(kind);
          for (let i = 0; i < boxPositions.count; i++) {
            point.fromBufferAttribute(boxPositions, i);
            point.set(point.x * w, point.y * h, point.z * d);
            normal.fromBufferAttribute(boxNormals, i);
            if (rotation) {
              point.applyQuaternion(rotation);
              normal.applyQuaternion(rotation);
            }
            positions.push(point.x + x, point.y + y, point.z + z);
            normals.push(normal.x, normal.y, normal.z);
          }
        }

        function beam(kind, x1, y1, x2, y2, z, thickness, reach = thickness) {
          const dx = x2 - x1;
          const dy = y2 - y1;
          const rotation = new THREE.Quaternion().setFromAxisAngle(zAxis, Math.atan2(-dx, dy));
          box(kind, (x1 + x2) / 2, (y1 + y2) / 2, z, thickness, Math.hypot(dx, dy), reach, rotation);
        }

        const lowerHeight = roomStart * pitch;
        const upperBase = roomEnd * pitch;
        box("core", 0, lowerHeight / 2, 0, width - .16, lowerHeight, depth - .16);
        const roomMiddle = (lowerHeight + upperBase) / 2;
        const roomHeight = upperBase - lowerHeight;
        for (const sign of [-1, 1]) {
          if (sign > 0) box("interior", 0, roomMiddle, depth / 2 - .17, width - .13, roomHeight, .15);
          else {
            box("interior", 0, lowerHeight + .43, -depth / 2 + .17, width - .13, .86, .15);
            box("frame", 0, lowerHeight + .88, -depth / 2 + .12, width - .13, .052, .1);
            box("interior", 0, upperBase - .23, -depth / 2 + .17, width - .13, .46, .15);
            for (const edge of [-1, 1]) box("steel", edge * 1.57, roomMiddle, -depth / 2 + .17, .5, roomHeight, .15);
          }
          box("interior", sign * (width / 2 - .085), lowerHeight + .45, 0, .14, .9, depth - .22);
          box("frame", sign * (width / 2 - .15), lowerHeight + .91, 0, .07, .052, depth - .24);
          box("interior", sign * (width / 2 - .083), upperBase - .2, 0, .14, .41, depth - .22);
          box("steel", sign * (width / 2 - .085), roomMiddle, sign * (depth / 2 - .55), .16, roomHeight, 1.02);
          box("steel", sign * (width / 2 - .085), roomMiddle, 0, .12, roomHeight, .09);
          box("frame", sign * 1.28, lowerHeight + .073, 0, .035, .02, 2.88);
          box("highlight", sign * 1.17, upperBase - .075, 0, .062, .045, 2.04);
          box("steel", sign * 1.12, lowerHeight + .42, 1.12, .135, .72, .38);
        }
        box("interior", 0, lowerHeight + .04, 0, width - .13, .084, depth - .13);
        box("interior", 0, upperBase - .04, 0, width - .17, .085, depth - .17);
        box("steel", 0, lowerHeight + .82, 1.16, 2.52, .13, .58);
        box("screen", 0, lowerHeight + 1.23, 1.25, 1.59, .62, .085);
        box("interior", 0, lowerHeight + .33, -1.27, 1.67, .54, .36);
        box("frame", 0, lowerHeight + .61, -1.27, 1.67, .05, .38);
        for (let slot = 0; slot < 9; slot++) {
          box("frame", (slot - 4) * .148, lowerHeight + 1.1 + slot % 3 * .078, 1.198, .071, .11, .014);
        }
        const roomLight = new THREE.PointLight(tint, 5.4, 5.2, 2);
        roomLight.position.set(0, upperBase - .28, 0);
        structure.add(roomLight);

        for (let row = 0; row <= rows; row++) {
          const y = row * pitch;
          const mechanical = row % 5 === 0;
          if (row <= roomStart || row >= roomEnd) {
            box(mechanical ? "steel" : "core", 0, y, 0, width + .03, mechanical ? .105 : .064, depth + .03);
          }
          if (mechanical) {
            for (const sign of [-1, 1]) {
              box("frame", 0, y + .061, sign * depth / 2, width - .07, .035, .012);
              box("frame", sign * width / 2, y + .061, 0, .012, .035, depth - .07);
            }
          }
          if (row === rows) continue;
          for (let column = 0; column < 6; column++) {
            for (let side = 0; side < 4; side++) {
              const pane = ((row * 41 + column * 23 + side * 13 + row * column * 7) % 23);
              const kind = pane < 9 ? "dark" : pane < 15 ? "cool" : pane < 21 ? "soft" : "lit";
              const front = side < 2;
              if (side !== 0 && row >= roomStart && row < roomEnd) continue;
              const span = front ? width : depth;
              const offset = ((column + .5) / 6 - .5) * (span - .23);
              const sign = side % 2 === 0 ? 1 : -1;
              const yWindow = y + pitch * .53;
              const windowWidth = (span - .23) / 6 - .082;
              if (front) box(kind, offset, yWindow, sign * (depth / 2 - .046), windowWidth, .389, .04);
              else box(kind, sign * (width / 2 - .046), yWindow, offset, .04, .389, windowWidth);
            }
          }
        }

        for (const sideX of [-1, 1]) {
          for (const sideZ of [-1, 1]) {
            box("steel", sideX * (width / 2 - .055), height / 2, sideZ * (depth / 2 - .045), .16, height + .16, .16);
            box("frame", sideX * (width / 2 + .025), height / 2, sideZ * (depth / 2 + .025), .045, height + .16, .045);
          }
          box("steel", sideX * (width / 2 + .012), height / 2, 0, .087, height, .085);
          box("steel", 0, height / 2, sideX * (depth / 2 + .012), .085, height, .087);
          for (let pane = 1; pane < 6; pane++) {
            box("steel", (pane / 6 - .5) * (width - .23), height / 2, sideX * (depth / 2 - .025), .038, height - .07, .035);
            const offset = (pane / 6 - .5) * (depth - .23);
            box("steel", sideX * (width / 2 - .025), lowerHeight / 2, offset, .035, lowerHeight, .038);
          }
        }
        box("steel", 0, height + .12, 0, width - .21, .22, depth - .22);
        box("core", .12, height + .32, -.13, 1.78, .27, 1.53);
        for (const sign of [-1, 1]) {
          box("frame", 0, height + .18, sign * (depth / 2 - .1), width - .21, .047, .028);
          box("frame", sign * (width / 2 - .095), height + .18, 0, .028, .047, depth - .22);
          box("steel", sign * .55, height + .7, -.13, .055, .57, .055);
          box("highlight", sign * .55, height + 1.005, -.13, .087, .09, .087);
        }

        if (protectedTower) {
          // Las placas curvas esquematizan disipadores metálicos en U en el centro de las crucetas.
          for (const row of [2, 7, 12, 17, 22]) {
            const y = row * pitch + pitch * .5;
            for (const sign of [-1, 1]) {
              const z = sign * (depth / 2 + .071);
              for (const direction of [-1, 1]) {
                for (const side of [-1, 1]) {
                  beam("steel", direction * 1.64, y + side * .67, direction * .29, y + side * .115, z, .15, .13);
                  beam("frame", direction * 1.59, y + side * .653, direction * .31, y + side * .14, z + sign * .077, .055, .03);
                }
                const curveZ = z + sign * .14;
                const points = [[.26, .23], [.11, .23], [.015, .185], [-.012, .12], [.015, .055], [.11, .012], [.26, .012]];
                for (let j = 1; j < points.length; j++) {
                  const [x1, y1] = points[j - 1];
                  const [x2, y2] = points[j];
                  beam("damper", direction * x1, y + direction * y1, direction * x2, y + direction * y2, curveZ, .046, .061);
                }
              }
              box("steel", 0, y, z, .63, .54, .11);
            }
          }
        }

        function bendMaterial(shader) {
          shader.uniforms.towerBend = bend;
          shader.vertexShader = "uniform vec3 towerBend;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
            "#include <begin_vertex>\nfloat h = max(0.0, position.y / " + height.toFixed(3) + ");\ntransformed.xz += towerBend.xz * h * h;\ntransformed.y += towerBend.y * h;");
          shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>",
            "#include <beginnormal_vertex>\nobjectNormal.y -= dot(towerBend.xz, objectNormal.xz) * 2.0 * max(0.0, position.y) / " + (height * height).toFixed(5) + ";");
        }

        const shadow = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        shadow.onBeforeCompile = bendMaterial;
        for (const [name, batch] of batches) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
          geometry.setAttribute("normal", new THREE.Float32BufferAttribute(batch.normals, 3));
          const surface = palette[name];
          surface.onBeforeCompile = bendMaterial;
          const mesh = new THREE.Mesh(geometry, surface);
          mesh.frustumCulled = false;
          mesh.castShadow = name === "core" || name === "steel";
          mesh.receiveShadow = true;
          mesh.customDepthMaterial = shadow;
          structure.add(mesh);
        }
        for (let row = 0; row < rows; row += 3) {
          const floors = Math.min(3, rows - row);
          const hit = new THREE.Mesh(new THREE.BoxGeometry(width + .09, floors * pitch + .07, depth + .13), invisible);
          hit.position.y = (row + floors / 2) * pitch;
          hit.userData = { id, baseY: hit.position.y, ratio: hit.position.y / height };
          towerHits.push(hit);
          structure.add(hit);
        }
        const lamp = new THREE.Group();
        lamp.position.set(-.48, upperBase - .1, -.61);
        structure.add(lamp);
        addSlab(lamp, .025, .38, .025, -.19, palette.steel);
        addSlab(lamp, .48, .067, .21, -.391, palette.frame);
        addSlab(lamp, .43, .018, .17, -.432, palette.highlight);
        const contents = [];
        function looseObject(kind, x, y, z, resistance) {
          const group = new THREE.Group();
          group.position.set(x, y, z);
          structure.add(group);
          const motion = { group, kind, resistance, rest: group.position.clone(), rule: damageRules.interior };
          freshDamage(motion);
          contents.push(motion);
          return group;
        }
        const chair = looseObject("chair", .44, lowerHeight + .089, .84, 1.42);
        addSlab(chair, .57, .12, .5, .405, palette.steel);
        addSlab(chair, .115, .43, .115, .155, palette.steel);
        addSlab(chair, .56, .053, .14, .14, palette.frame);
        const cup = looseObject("cup", -.69, lowerHeight + .893, .96, .82);
        const cupMesh = new THREE.Mesh(new THREE.CylinderGeometry(.062, .051, .123, 10), palette.frame);
        cupMesh.position.y = .062;
        cup.add(cupMesh);
        const book = looseObject("book", -.19, lowerHeight + .899, 1.01, .69);
        addSlab(book, .24, .052, .17, .022, palette.interior);
        const decoration = looseObject("cup", .86, lowerHeight + .638, -1.2, 1.06);
        addSlab(decoration, .107, .174, .107, .09, palette.frame);
        return { x, bend: bend.value, lamp, contents, damper: palette.damper };
      }

      towers.a = addTower("a", -3.95, "#ffa361", "#d88a64", false);
      towers.b = addTower("b", 3.95, "#68f2ff", "#56aebe", true);
      template.dispose();

      const orbit = byId("orbit");
      const resetButton = byId("view-reset");
      const message = byId("scene-message");
      const defaultCamera = { yaw: .31, pitch: .21, zoom: 1 };
      const angle = { ...defaultCamera };
      const minimumYaw = -0.93;
      const maximumYaw = 0.93;
      const locations = {
        outside: { label: "Exterior", x: 3, y: 0, z: 21, yaw: -.14 },
        ground: { label: "Calle", x: 1.3, y: 0, z: 9.85, yaw: -.13, pitch: .31 },
        beach: { label: "Playa", x: 5, y: coast.shoreY(-12.2), z: -12.2, yaw: -.32, pitch: -.09 },
        air: { label: "Vista aérea", x: 33, y: 35, z: 42, yaw: -.43, pitch: -.43 },
        a: { label: "Interior naranja", x: towers.a.x, y: roomFloor, z: .27, yaw: .58, pitch: -.11 },
        b: { label: "Interior celeste", x: towers.b.x, y: roomFloor, z: .27, yaw: -.58, pitch: -.11 },
      };
      const observationOrder = ["outside", "ground", "beach", "a", "b", "air"];
      const viewButtons = [...document.querySelectorAll("[data-view]")];
      const rig = camera.parent;
      const heading = new THREE.Vector3();
      const target = new THREE.Vector3();
      const lookMatrix = new THREE.Matrix4();
      const walkKeys = new Set();
      let place = "outside";
      let walker = { ...locations.a, pitch: 0 };
      let freeOutside = false;
      let lastWalk = 0;
      let xrMode = false;
      let officeTick = 0;
      let viewTimer = 0;
      const fade = byId("view-fade");
      const gestureCamera = { x: 0, y: 0, forward: 0, at: 0 };
      const gestureVelocity = { x: 0, y: 0, forward: 0 };

      function towerAction(id) {
        return { key: id, label: locations[id].label, action: () => changePlace(id) };
      }

      function findTower() {
        const hit = raycaster.intersectObjects(towerHits, false).find(({ object }) => object.userData.id !== place);
        return hit && { ...towerAction(hit.object.userData.id), hit };
      }

      function towerTarget(x, y) {
        const bounds = viewport.getBoundingClientRect();
        if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom ||
          !orbit.contains(document.elementFromPoint(x, y))) return;
        const mouse = new THREE.Vector2((x - bounds.left) / bounds.width * 2 - 1, 1 - (y - bounds.top) / bounds.height * 2);
        world.updateMatrixWorld(true);
        raycaster.setFromCamera(mouse, camera);
        return findTower();
      }

      const isOrbit = () => place === "outside" && !freeOutside && !xrMode;
      function positionCamera() {
        if (xrMode) return;
        const aspect = Math.max(.1, viewport.clientWidth / Math.max(1, viewport.clientHeight));
        camera.aspect = aspect;
        camera.near = isOrbit() ? .2 : .045;
        if (isOrbit()) {
          const distance = 34;
          const span = Math.max(20.9, 16.2 / aspect) / angle.zoom;
          camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span / (2 * distance)));
          rig.position.set(
            distance * Math.sin(angle.yaw) * Math.cos(angle.pitch),
            6.85 + distance * Math.sin(angle.pitch),
            distance * Math.cos(angle.yaw) * Math.cos(angle.pitch)
          );
          target.set(0, 6.85, 0);
        } else {
          camera.fov = (aspect < .9 ? 76 : 62) / walker.zoom;
          rig.position.set(walker.x, walker.y + 1.49, walker.z);
          target.set(Math.sin(walker.yaw) * Math.cos(walker.pitch), Math.sin(walker.pitch), -Math.cos(walker.yaw) * Math.cos(walker.pitch));
          target.add(rig.position);
        }
        camera.updateProjectionMatrix();
        camera.position.set(0, 0, 0);
        camera.quaternion.identity();
        rig.quaternion.setFromRotationMatrix(lookMatrix.lookAt(rig.position, target, camera.up));
        rig.updateMatrixWorld(true);
      }

      function resetCamera() {
        Object.assign(angle, defaultCamera);
        changePlace("outside", false);
      }

      function changePlace(id, focus = true, transition = true) {
        if (!Object.hasOwn(locations, id)) return;
        window.clearTimeout(viewTimer);
        if (transition && !xrMode && id !== place && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          fade.classList.add("dimmed");
          viewTimer = window.setTimeout(() => changePlace(id, focus, false), 155);
          return;
        }
        fade.classList.remove("dimmed");
        place = id;
        freeOutside = false;
        updateHelp();
        walker = { ...locations[id], pitch: locations[id].pitch ?? 0, zoom: 1 };
        stopNavigation();
        for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.view === id));
        setText(byId("orbit-hint"), id === "outside" ? "Arrastra para girar · selecciona una torre"
          : id === "air" ? "Arrastra para mirar · rueda para acercar" : "Arrastra para mirar · WASD para caminar");
        orbit.setAttribute("aria-label", id === "outside"
          ? "Vista exterior. Usa las flechas para girar, más y menos para acercar o alejar, e Inicio para volver."
          : locations[id].label + ". Usa W, A, S y D para caminar, las flechas para mirar e Inicio para volver al exterior.");
        if (xrMode) {
          const location = locations[id];
          rig.position.set(location.x, location.y, location.z);
          rig.rotation.set(0, -location.yaw, 0);
          rig.updateMatrixWorld(true);
          pose();
          return;
        }
        positionCamera();
        pose();
        if (focus) orbit.focus({ preventScroll: true });
      }

      function moveCamera(horizontal, vertical, zoom) {
        if (!isOrbit()) {
          walker.yaw += horizontal;
          walker.pitch = clamp(walker.pitch - vertical, -1.28, 1.28);
          if (zoom) walker.zoom = clamp(walker.zoom + zoom, .75, place === "outside" ? 2.7 : 1.48);
          positionCamera();
          return;
        }
        angle.yaw = clamp(angle.yaw + horizontal, minimumYaw, maximumYaw);
        angle.pitch = clamp(angle.pitch + vertical, .02, .70);
        angle.zoom = clamp(angle.zoom + zoom, .78, 1.83);
        positionCamera();
      }

      let drag;
      orbit.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || drag) return;
        orbit.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 };
      });
      orbit.addEventListener("pointermove", (event) => {
        if (drag?.id !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.travel += Math.hypot(dx, dy);
        if (drag.travel > 5) moveCamera(dx * (isOrbit() ? -.007 : .005), dy * .006, 0);
        drag.x = event.clientX;
        drag.y = event.clientY;
      });
      orbit.addEventListener("pointerup", (event) => {
        if (drag?.id === event.pointerId && drag.travel <= 5) towerTarget(event.clientX, event.clientY)?.action();
      });
      orbit.addEventListener("lostpointercapture", () => { drag = undefined; });
      orbit.addEventListener("wheel", (event) => {
        if (document.activeElement !== orbit || event.ctrlKey) return;
        event.preventDefault();
        moveCamera(0, 0, Math.sign(event.deltaY) * -.09);
      }, { passive: false });
      orbit.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        if (!isOrbit() && ["w", "a", "s", "d"].includes(key) && !event.ctrlKey && !event.metaKey) {
          walkKeys.add(key);
          event.preventDefault();
          return;
        }
        const pitchStep = isOrbit() ? .09 : -.09;
        const keyMovement = {
          ArrowLeft: [-.12, 0, 0], ArrowRight: [.12, 0, 0], ArrowUp: [0, pitchStep, 0],
          ArrowDown: [0, -pitchStep, 0], "+": [0, 0, .1], "=": [0, 0, .1], "-": [0, 0, -.1],
        };
        if (event.key === "Home") resetCamera();
        else if (Object.hasOwn(keyMovement, event.key)) moveCamera(...keyMovement[event.key]);
        else return;
        event.preventDefault();
      });
      orbit.addEventListener("keyup", (event) => walkKeys.delete(event.key.toLowerCase()));
      orbit.addEventListener("blur", () => walkKeys.clear());
      window.addEventListener("blur", () => walkKeys.clear());
      for (const button of viewButtons) {
        button.disabled = false;
        button.addEventListener("click", () => changePlace(button.dataset.view));
      }
      function clearGesture() {
        gestureCamera.x = gestureCamera.y = gestureCamera.forward = gestureCamera.at = 0;
        gestureVelocity.x = gestureVelocity.y = gestureVelocity.forward = 0;
      }

      function stopNavigation() {
        walkKeys.clear();
        clearGesture();
        lastWalk = 0;
      }

      function navigateGesture(x, y, forward, now) {
        if (interactionMode !== "explore") return;
        if (isOrbit() && (x || y || forward)) {
          camera.getWorldPosition(target);
          camera.getWorldDirection(heading);
          walker = { x: target.x, y: target.y - 1.49, z: target.z,
            yaw: Math.atan2(heading.x, -heading.z), pitch: Math.asin(clamp(heading.y, -1, 1)),
            zoom: (camera.aspect < .9 ? 76 : 62) / camera.fov };
          freeOutside = true;
        }
        gestureCamera.x = xrMode ? 0 : x * 1.08;
        gestureCamera.y = xrMode ? 0 : y * .82;
        gestureCamera.forward = forward;
        gestureCamera.at = now;
      }

      function walk(now) {
        const dt = lastWalk ? clamp((now - lastWalk) / 1000, 0, .045) : 0;
        lastWalk = now;
        if (!xrMode && document.hidden) return;
        const gestureActive = interactionMode === "explore" && gestureCamera.at > 0 && now - gestureCamera.at < 225;
        const blend = 1 - Math.exp(-14 * dt);
        for (const axis of ["x", "y", "forward"]) {
          const command = gestureActive ? gestureCamera[axis] : 0;
          gestureVelocity[axis] = command ? gestureVelocity[axis] + (command - gestureVelocity[axis]) * blend : 0;
        }
        const { x, y } = gestureVelocity;
        if (!xrMode && (x || y)) moveCamera(x * dt, -y * dt, 0);
        const forward = clamp(Number(walkKeys.has("w")) - Number(walkKeys.has("s")) + gestureVelocity.forward, -1, 1);
        const side = Number(walkKeys.has("d")) - Number(walkKeys.has("a"));
        if (!dt || (!forward && !side)) return;

        const aerial = place === "outside" || place === "air";
        const street = place === "ground" || place === "beach";
        const speed = xrMode ? (street || aerial ? 1.55 : .76) : aerial ? 6.2 : street ? 3.45 : 1.45;
        const step = dt * speed / Math.max(1, Math.hypot(forward, side));
        let yaw = walker.yaw;
        if (xrMode) {
          const eye = renderer.xr.getCamera().cameras[0];
          if (eye) {
            eye.getWorldDirection(heading);
            if (Math.hypot(heading.x, heading.z) > .15) yaw = Math.atan2(heading.x, -heading.z);
          }
        }
        const horizontal = aerial && !xrMode ? forward * Math.cos(walker.pitch) : forward;
        const nextX = walker.x + (Math.sin(yaw) * horizontal + Math.cos(yaw) * side) * step;
        const nextZ = walker.z + (-Math.cos(yaw) * horizontal + Math.sin(yaw) * side) * step;
        if (street) {
          const blocked = (x, z) => coast.blocked(x, z) ||
            (Math.abs(z) < 2.9 && [towers.a, towers.b].some((tower) => Math.abs(x - tower.x) < 3.19));
          if (!blocked(nextX, walker.z)) walker.x = clamp(nextX, -54, 54);
          if (!blocked(walker.x, nextZ)) walker.z = clamp(nextZ, -14.2, 39);
          walker.y = coast.shoreY(walker.z);
        } else if (aerial) {
          walker.x = clamp(nextX, -64, 64);
          walker.z = clamp(nextZ, -26, 61);
          if (!xrMode) walker.y = clamp(walker.y + forward * Math.sin(walker.pitch) * step, coast.shoreY(walker.z) + .2, 56);
        } else {
          const center = locations[place].x;
          walker.x = clamp(nextX, center - .78, center + .78);
          walker.z = clamp(nextZ, -.93, .75);
        }
        if (xrMode) rig.position.set(walker.x, walker.y, walker.z);
        else positionCamera();
      }
      resetButton.addEventListener("click", resetCamera);
      resetButton.disabled = false;
      orbit.tabIndex = 0;
      if ("ResizeObserver" in window) new ResizeObserver(positionCamera).observe(viewport);
      window.addEventListener("resize", positionCamera);
      canvas.addEventListener("webglcontextlost", () => {
        message.querySelector("p").textContent = "Se interrumpió la vista 3D. Puedes seguir usando el gráfico y las lecturas.";
        message.hidden = false;
      });
      canvas.addEventListener("webglcontextrestored", () => { message.hidden = true; });
      positionCamera();

      function pose() {
        towers.a.bend.set(towerA.displacement, towerA.vertical * .86, towerA.depth);
        towers.b.bend.set(towerB.displacement, towerB.vertical * .86, towerB.depth);
        const baseX = state.signal / inputScale * .29;
        const baseY = state.signalY / inputScale * .215;
        const baseZ = state.signalZ / inputScale * .29;
        // Desde el último piso, la sala sirve de referencia para mantener estable el punto de vista.
        const room = towers[place]?.bend;
        const roomX = room ? baseX + room.x * roomBendRatio : 0;
        const roomY = room ? baseY + room.y * Math.sqrt(roomBendRatio) : 0;
        const roomZ = room ? baseZ + room.z * roomBendRatio : 0;
        terrain.position.set(-roomX, -roomY, -roomZ);
        support.position.set(baseX - roomX, baseY - roomY, baseZ - roomZ);
        for (const [id, response] of [["a", towerA], ["b", towerB]]) {
          const tower = towers[id];
          tower.lamp.position.x = -.48 + tower.bend.x * .98;
          tower.lamp.position.y = height - .1 + tower.bend.y * .99;
          tower.lamp.position.z = -.61 + tower.bend.z * .98;
          tower.lamp.rotation.z = clamp(response.velocity * .032, -.24, .24);
          for (const item of tower.contents) poseOffice(item, tower.bend);
        }
        towers.b.damper.emissiveIntensity = 1.1 + clamp(Math.hypot(towerB.velocity, towerB.depthVelocity, towerB.verticalVelocity) * .38, 0, 1.45);
        for (const hit of towerHits) {
          const { id, ratio, baseY: heightAtHit } = hit.userData;
          hit.position.x = towers[id].bend.x * ratio * ratio;
          hit.position.y = heightAtHit + towers[id].bend.y * ratio;
          hit.position.z = towers[id].bend.z * ratio * ratio;
        }
      }
      function poseOffice(item, bend) {
        const { rest, group, kind, damage } = item;
        const drop = smoothBetween(damage, .18, 1);
        const dropDistance = kind === "chair" ? .02 : Math.min(.79, rest.y - (roomFloor - .37));
        const addedX = kind === "book" ? -.34 : .21;
        const y = rest.y - drop * dropDistance;
        const ratio = y / height;
        group.position.set(rest.x + addedX * drop + bend.x * ratio * ratio,
          y + bend.y * ratio, rest.z - drop * (kind === "chair" ? .25 : .43) + bend.z * ratio * ratio);
        group.rotation.set(drop * (kind === "chair" ? -.13 : 1.33), drop * -.4, drop * .29);
      }
      function animateExperience(now) {
        coast.animate(now);
        const dt = clamp((state.steps - officeTick) * timeStep, 0, .09);
        if (interactionMode === "quake" && state.mode === "running" && dt > 0) {
          const shake = Math.min(1, state.activity*.45 + Math.hypot(state.signal, state.signalY, state.signalZ)/inputScale);
          for (const tower of Object.values(towers)) {
            for (const item of tower.contents) {
              advanceDamage(item, 0, shake, 0, dt);
              poseOffice(item, tower.bend);
            }
          }
        }
        officeTick = state.steps;
      }
      function resetAllDamage() {
        coast.resetDamage();
        officeTick = 0;
        for (const tower of Object.values(towers)) for (const item of tower.contents) freshDamage(item);
        pose();
      }
      const xr = buildImmersiveControls({
        THREE, scene, world, rig, raycaster, findTower, changePlace,
        setImmersive(enabled) {
          xrMode = enabled;
          previousFrame = 0;
          hands.hideCursor();
          rig.position.set(0, 0, 0);
          rig.rotation.set(0, 0, 0);
          rig.updateMatrixWorld(true);
          if (enabled) {
            camera.position.set(0, 0, 0);
            camera.quaternion.identity();
            camera.near = .045;
            camera.updateProjectionMatrix();
          }
          changePlace(place, false, false);
        },
      });
      pose();
      return {
        pose, resetCamera, towerTarget, walk, immersive: () => xrMode, handTarget: xr.target,
        paintHand: xr.paint, hideHand: xr.hide, refreshFeed: xr.refreshFeed, tickVR: xr.tick,
        changePlace, location: () => place, locationLabel: () => locations[place].label,
        nextPlace() {
          const next = observationOrder[(observationOrder.indexOf(place) + 1) % observationOrder.length];
          changePlace(next, false);
          return locations[next].label;
        },
        navigateGesture, clearGesture, stopNavigation,
        animate: animateExperience, resetDamage: resetAllDamage,
      };
    }

    function buildImmersiveControls({ THREE, scene, world, rig, raycaster, findTower, changePlace, setImmersive }) {
      const manager = scene.renderer.xr;
      const button = byId("enter-xr");
      const note = byId("xr-note");
      const panel = new THREE.Group();
      const buttonFaces = [];
      const pointer = new THREE.Group();
      const direction = new THREE.Vector3();
      const origin = new THREE.Vector3();
      const screenPoint = new THREE.Vector2();
      const aim = new THREE.Ray();
      const rotation = new THREE.Quaternion();
      let pointingAt;
      let xrActive = false;
      panel.position.set(0, 1.05, -1.48);
      panel.visible = pointer.visible = false;
      rig.add(panel);
      world.add(pointer);

      function plane(parent, w, h, x, y, z, options) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ ...options, toneMapped: false }));
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
      }

      function textureFor(canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      }

      function labelSurface(w, h, x, y, pixelWidth, pixelHeight) {
        const canvas = document.createElement("canvas");
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        const context = canvas.getContext("2d");
        const texture = textureFor(canvas);
        const mesh = plane(panel, w, h, x, y, .012, { map: texture });
        let previousKey;
        return { mesh, draw(text, tint, background, align = "center") {
          const key = [text, tint, background, align].join("|");
          if (previousKey === key) return;
          previousKey = key;
          context.fillStyle = background;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.strokeStyle = "#3e6275";
          context.lineWidth = 3;
          context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
          context.font = "600 " + Math.round(canvas.height * .37) + "px system-ui, sans-serif";
          context.textBaseline = "middle";
          context.textAlign = align;
          context.fillStyle = tint;
          context.fillText(text, align === "left" ? 12 : canvas.width / 2, canvas.height / 2, canvas.width - 20);
          texture.needsUpdate = true;
        } };
      }

      function adjustIntensity(delta) {
        intensityInput.value = clamp(Number(intensityInput.value) + delta, 0, 100);
        intensityInput.dispatchEvent(new Event("input"));
      }

      const simulationControl = (quakeId, waveId) => byId(interactionMode === "wave" ? waveId : quakeId);
      const actions = (quakeId, waveId) => ({
        action: () => simulationControl(quakeId, waveId).click(),
        enabled: () => ["quake", "wave"].includes(interactionMode) && !simulationControl(quakeId, waveId).disabled,
      });
      function adjust(delta) {
        if (interactionMode === "wave") setWaveControl("height", wave.target.height + delta / 100);
        else if (interactionMode === "quake") adjustIntensity(delta);
      }
      const controls = [
        ...[["Terremoto", "quake"], ["Tsunami", "wave"], ["Explorar", "explore"], ["Información", "info"]].map(([label, mode]) => ({
          label, mode, tint: "#62e7ee", action: () => selectModeButton(mode),
        })),
        ...[["Exterior", "outside"], ["Playa", "beach"], ["Calle", "ground"], ["Vista aérea", "air"],
          ["Torre naranja", "a", "#ffad76"], ["Torre celeste", "b", "#62e7ee"]].map(([label, place, tint = "#c0d0df"]) => ({
          label, tint, action: () => changePlace(place),
        })),
        { label: "Iniciar", tint: "#62e7ee", ...actions("start", "wave-start") },
        { label: "Detener", tint: "#edf4fa", ...actions("stop", "wave-stop") },
        { label: "Reiniciar", tint: "#edf4fa", ...actions("reset", "wave-reset") },
        { label: "Intensidad −", tint: "#edf4fa", action: () => adjust(-10) },
        { label: "Intensidad +", tint: "#edf4fa", action: () => adjust(10) },
        { label: "Salir de VR", tint: "#edf4fa", action: () => scene.exitVR() },
        { label: "Sonido", tint: "#edf4fa", action: () => byId("audio-toggle").click() },
        { label: "Reconstruir", tint: "#edf4fa", action: rebuildCity },
      ];
      plane(panel, 1.64, .71, 0, 0, 0, { color: "#0c1520" });
      const title = labelSurface(1.52, .082, 0, .275, 700, 50);
      const readout = labelSurface(1.52, .075, 0, -.277, 720, 48);
      for (const [index, control] of controls.entries()) {
        const surface = index >= 16 ? labelSurface(.289, .086, 1.005, -.11 - (index - 16) * .097, 250, 60)
          : labelSurface(.36, .089, (index % 4 - 1.5) * .386, .173 - Math.floor(index / 4) * .105, 230, 60);
        surface.mesh.userData.control = control;
        control.draw = surface.draw;
        buttonFaces.push(surface.mesh);
      }
      const feedTexture = textureFor(byId("hand-feed"));
      const cameraScreen = plane(panel, .289, .217, 1.005, .137, .013, { map: feedTexture });
      const cameraReadout = labelSurface(.289, .07, 1.005, -.013, 240, 55);
      const reticleOutline = new THREE.Mesh(new THREE.RingGeometry(.012, .017, 32),
        new THREE.MeshBasicMaterial({ color: "#3e6275", side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
      const progressSegments = 64;
      const reticleProgress = new THREE.Mesh(new THREE.RingGeometry(.012, .017, progressSegments, 1, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: "#62e7ee", side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
      reticleProgress.geometry.setDrawRange(0, 0);
      const reticleFill = new THREE.Mesh(new THREE.CircleGeometry(.0095, 24),
        new THREE.MeshBasicMaterial({ color: "#c4fbff", side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
      reticleOutline.renderOrder = reticleFill.renderOrder = 10;
      reticleProgress.renderOrder = 11;
      pointer.add(reticleOutline, reticleProgress, reticleFill);

      function enabled(control) {
        return control.enabled?.() ?? true;
      }

      function resolveTarget() {
        const hit = raycaster.intersectObjects(buttonFaces, false)[0];
        const tower = findTower();
        if (!hit || (tower && tower.hit.distance < hit.distance)) return tower;
        const control = hit.object.userData.control;
        return enabled(control) ? { key: control, label: control.label, action: control.action, hit } : undefined;
      }

      function target(point) {
        const eye = manager.getCamera().cameras[0];
        if (!eye) return;
        world.updateMatrixWorld(true);
        screenPoint.set(point.x * 2 - 1, 1 - point.y * 2);
        raycaster.setFromCamera(screenPoint, eye);
        aim.copy(raycaster.ray);
        return resolveTarget();
      }

      function paint(hitTarget, progress) {
        const eye = manager.getCamera().cameras[0];
        if (!eye) return;
        pointingAt = hitTarget?.key;
        aim.at(Math.min(hitTarget?.hit.distance || 1.45, 2), pointer.position);
        eye.getWorldQuaternion(pointer.quaternion);
        reticleProgress.geometry.setDrawRange(0, Math.floor(progress * progressSegments) * 6);
        pointer.visible = true;
      }

      function hide() {
        pointer.visible = false;
        pointingAt = undefined;
      }

      for (let index = 0; index < 2; index++) {
        const controller = manager.getController(index);
        const beam = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -4)]),
          new THREE.LineBasicMaterial({ color: "#63d9ec", transparent: true, opacity: .7 }),
        );
        beam.visible = false;
        controller.add(beam);
        rig.add(controller);
        controller.addEventListener("connected", ({ data }) => { beam.visible = data.targetRayMode === "tracked-pointer"; });
        controller.addEventListener("disconnected", () => { beam.visible = false; });
        controller.addEventListener("select", () => {
          if (!xrActive) return;
          world.updateMatrixWorld(true);
          controller.getWorldPosition(origin);
          controller.getWorldQuaternion(rotation);
          direction.set(0, 0, -1).applyQuaternion(rotation);
          raycaster.set(origin, direction);
          resolveTarget()?.action();
        });
      }

      function tick() {
        if (!xrActive) return;
        const rebuilding = byId("rebuild-progress");
        const subtitle = !rebuilding.hidden ? rebuilding.textContent
          : interactionMode === "wave" ? byId("wave-status").textContent : interactionMode === "quake" ? status.textContent
          : "Exploración";
        title.draw("Chile Resiste · " + subtitle, "#62e7ee", "#122532", "left");
        const info = interactionMode === "wave" ? "Altura " + Math.round(wave.height * 100) + " % · " + waveMovement()
          : interactionMode === "explore" ? "Movimiento con palma" + (byId("explore-motion").textContent || " · cámara en reposo")
          : "Picos " + numberFormat.format(towerA.peak) + " / " + numberFormat.format(towerB.peak) + " u. s. · Intensidad " +
            Math.round((state.source === "hand" ? state.activity : state.intensity / 100) * 100) + " %";
        readout.draw(info, "#cedbe7", "#0e1a27", "left");
        for (const control of controls) {
          const label = control.label === "Sonido" && audioEnabled ? "Silenciar" : control.label;
          const active = control.mode === interactionMode || (control.mode === "info" && activeDrawer === "science");
          const background = pointingAt === control || active ? "#28505e" : "#162535";
          control.draw(label, enabled(control) ? control.tint : "#7d8c9a", background);
        }
        cameraScreen.visible = cameraReadout.mesh.visible = hands.active();
        if (hands.active()) cameraReadout.draw(hands.label(), "#62e7ee", "#122532");
      }

      scene.addEventListener("enter-vr", () => {
        if (!manager.isPresenting) return;
        xrActive = panel.visible = true;
        setImmersive(true);
        tick();
      });
      scene.addEventListener("exit-vr", () => {
        if (!xrActive) return;
        xrActive = panel.visible = false;
        hide();
        setImmersive(false);
      });
      if (window.isSecureContext && navigator.xr?.isSessionSupported) {
        navigator.xr.isSessionSupported("immersive-vr").then((supported) => { button.hidden = !supported; }).catch(() => {});
      }
      button.addEventListener("click", async () => {
        note.hidden = true;
        button.disabled = true;
        try {
          await scene.enterVR();
          if (!manager.isPresenting) {
            await scene.exitVR();
            throw new Error("No se inició una sesión inmersiva.");
          }
        } catch (error) {
          setText(note, "No se pudo iniciar VR. Revisa la conexión del visor y vuelve a intentarlo.");
          note.hidden = false;
          console.warn("WebXR no inició una sesión inmersiva.", error);
        } finally {
          button.disabled = false;
        }
      });
      return { target, paint, hide, refreshFeed() { if (xrActive) feedTexture.needsUpdate = true; }, tick };
    }

    function showSceneError(error) {
      const message = byId("scene-message");
      message.querySelector("p").textContent = "La vista 3D requiere WebGL 2 y acceso a A-Frame. El gráfico y las lecturas siguen disponibles.";
      message.hidden = false;
      if (error) console.warn("No se pudo iniciar la escena 3D.", error);
    }

    window.addEventListener("DOMContentLoaded", () => {
      const scene = byId("scene");
      if (!window.AFRAME) {
        showSceneError();
        return;
      }
      AFRAME.registerComponent("resiste-xr-loop", {
        tick() {
          if (!view?.immersive()) return;
          tickExperience(performance.now());
          view.tickVR();
        },
      });
      scene.setAttribute("resiste-xr-loop", "");
      const timeout = window.setTimeout(() => showSceneError(), 8500);
      function ready() {
        window.clearTimeout(timeout);
        try {
          const camera = byId("camera").getObject3D("camera");
          if (!scene.renderer || !camera) throw new Error("Renderizador o cámara no disponible");
          view = buildScene(scene, camera, AFRAME.THREE);
          byId("scene-message").hidden = true;
        } catch (error) {
          showSceneError(error);
        }
      }
      if (scene.hasLoaded) ready();
      else scene.addEventListener("loaded", ready, { once: true });
    });
