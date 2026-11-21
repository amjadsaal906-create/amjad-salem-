// Procedural Web Audio API synthesizer + rhythmic challenge music sequencer
// for Smart Science AI Quiz & Buzzer Map Game

export type GameMusicMode = "off" | "map" | "challenge";

class GameAudioEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  public musicEnabled = true;

  private musicMode: GameMusicMode = "off";
  private musicTimer: number | null = null;
  private stepIdx = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock() {
    this.ensureContext();
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = "triangle",
    gainPeak = 0.16,
    delaySec = 0,
    endFreq?: number
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const startTime = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freq), startTime);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), startTime + durationSec);
    }

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(gainPeak, startTime + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);
  }

  private playKick(gainPeak = 0.14) {
    this.playTone(135, 0.12, "sine", gainPeak, 0, 42);
  }

  private playHiHat(gainPeak = 0.035) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const bufferSize = Math.floor(ctx.sampleRate * 0.045);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6500;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.045);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
  }

  // ==================== LOOPING CHALLENGE & MAP MUSIC ====================
  public startMusic(mode: Exclude<GameMusicMode, "off">) {
    if (this.musicMode === mode && this.musicTimer !== null) {
      this.ensureContext();
      return;
    }
    this.stopMusic();
    this.musicMode = mode;
    if (!this.musicEnabled || this.muted) return;

    this.ensureContext();
    this.stepIdx = 0;

    // Rhythmic 16-step groove:
    // "map": Warm bright exploratory pentatonic loop (~110 BPM -> 136ms per 16th/8th step)
    // "challenge": Energetic Kahoot-style quiz tension beat (~134 BPM -> 112ms per step)
    const stepMs = mode === "challenge" ? 135 : 175;

    const mapBass = [196, 0, 196, 0, 220, 0, 246.94, 0, 196, 0, 164.81, 0, 146.83, 0, 174.61, 0];
    const mapLead = [392, 0, 493.88, 587.33, 0, 523.25, 493.88, 0, 392, 0, 440, 523.25, 493.88, 0, 392, 0];

    const challengeBass = [146.83, 0, 146.83, 293.66, 174.61, 0, 174.61, 349.23, 196, 0, 196, 392, 164.81, 0, 220, 261.63];
    const challengeLead = [587.33, 0, 659.25, 0, 698.46, 587.33, 0, 783.99, 880, 0, 783.99, 698.46, 659.25, 0, 523.25, 587.33];

    const tick = () => {
      if (this.muted || !this.musicEnabled || this.musicMode === "off") return;
      const step = this.stepIdx % 16;
      this.stepIdx += 1;

      if (this.musicMode === "challenge") {
        // Punchy quiz show groove
        if (step % 4 === 0) this.playKick(0.11);
        if (step % 2 === 1) this.playHiHat(0.032);
        const bass = challengeBass[step];
        if (bass > 0) this.playTone(bass, 0.11, "triangle", 0.065);
        const lead = challengeLead[step];
        if (lead > 0) this.playTone(lead, 0.1, "sine", 0.052);
      } else {
        // Warm adventure stage map groove
        if (step % 4 === 0) this.playKick(0.075);
        if (step % 4 === 2) this.playHiHat(0.02);
        const bass = mapBass[step];
        if (bass > 0) this.playTone(bass, 0.14, "sine", 0.055);
        const lead = mapLead[step];
        if (lead > 0) this.playTone(lead, 0.14, "triangle", 0.048);
      }
    };

    tick();
    this.musicTimer = window.setInterval(tick, stepMs);
  }

  public stopMusic() {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicMode = "off";
  }

  public setMuted(mute: boolean) {
    this.muted = mute;
    if (mute) {
      if (this.musicTimer !== null) {
        window.clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    } else if (this.musicEnabled && this.musicMode !== "off") {
      const m = this.musicMode;
      this.musicMode = "off";
      this.startMusic(m);
    }
  }

  public setMusicEnabled(enabled: boolean, preferredMode: Exclude<GameMusicMode, "off"> = "challenge") {
    this.musicEnabled = enabled;
    if (!enabled) {
      this.stopMusic();
    } else if (!this.muted) {
      this.startMusic(preferredMode);
    }
  }

  public getMusicMode(): GameMusicMode {
    return this.musicMode;
  }

  // ==================== ONE-SHOT GAME SFX ====================
  public playBuzzerSlam(player: 1 | 2 = 1) {
    if (player === 1) {
      this.playTone(523.25, 0.14, "triangle", 0.24, 0, 659.25);
      this.playTone(783.99, 0.22, "sine", 0.16, 0.04);
    } else {
      this.playTone(440, 0.14, "triangle", 0.24, 0, 587.33);
      this.playTone(698.46, 0.22, "sine", 0.16, 0.04);
    }
  }

  public playBotBuzz() {
    this.playTone(280, 0.12, "sawtooth", 0.12, 0, 390);
    this.playTone(390, 0.14, "square", 0.09, 0.09);
  }

  public playCorrectChime(streak = 1) {
    const pitchBoost = Math.min(streak - 1, 5) * 35;
    this.playTone(523.25 + pitchBoost, 0.14, "sine", 0.18, 0);
    this.playTone(659.25 + pitchBoost, 0.14, "sine", 0.18, 0.08);
    this.playTone(783.99 + pitchBoost, 0.26, "triangle", 0.2, 0.16);
  }

  public playWrongBuzz() {
    this.playTone(220, 0.18, "sawtooth", 0.14, 0, 150);
    this.playTone(165, 0.26, "triangle", 0.16, 0.12, 110);
  }

  public playStageSelect() {
    this.playTone(440, 0.09, "sine", 0.14, 0, 587.33);
  }

  public playVictoryFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, idx === notes.length - 1 ? 0.45 : 0.15, "triangle", 0.2, idx * 0.11);
    });
  }
}

export const gameAudio = new GameAudioEngine();
