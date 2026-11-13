import type { BrainFx } from '@reeeeecall/shared/hooks/useBrainFx'

/**
 * Game sounds, synthesised with Web Audio — no files to load, nothing to license, and every
 * sound can follow the game (a sequence tile plays its own note, a run of right answers climbs).
 *
 * Soft by design: sine and triangle voices, short envelopes, a wrong answer that thuds rather
 * than buzzes. The context is created on the first tap (browsers refuse audio before a gesture)
 * and nothing plays while the setting is off or the tab is hidden.
 */

// C major pentatonic, C4 to E6 — any two notes sound fine together, so overlapping taps never
// clash, and nothing goes above ~1.3kHz: high-frequency hearing is the first to go with age.
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51]
const note = (i: number) => PENTA[Math.max(0, Math.min(PENTA.length - 1, i))]

type Wave = OscillatorType

class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  enabled = true

  /** Call from a user gesture: unlocks audio on browsers that need one. */
  unlock() {
    if (!this.enabled) return
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        this.ctx = new Ctor()
        const comp = this.ctx.createDynamicsCompressor()
        comp.threshold.value = -18
        comp.ratio.value = 4
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.55
        this.master.connect(comp).connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master || document.hidden) return null
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** One voice: an oscillator through an attack/decay envelope, optionally gliding in pitch. */
  private tone(freq: number, { at = 0, dur = 0.18, gain = 0.15, wave = 'sine' as Wave, glideTo, attack = 0.005 }: { at?: number; dur?: number; gain?: number; wave?: Wave; glideTo?: number; attack?: number } = {}) {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const t0 = ctx.currentTime + at
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = wave
    osc.frequency.setValueAtTime(freq, t0)
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(env).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  /**
   * A bell: the note plus a quiet octave (above for low notes, which reads as "ding" rather than
   * "beep"; below for high ones, so no partial climbs past ~2.5kHz).
   */
  private bell(freq: number, at = 0, dur = 0.35, gain = 0.14) {
    this.tone(freq, { at, dur, gain, wave: 'triangle' })
    this.tone(freq < 1000 ? freq * 2 : freq / 2, { at, dur: dur * 0.6, gain: gain * 0.25 })
  }

  private lastVerdict = 0
  /** When Odd One Out's «없음» tone last played: its 'correct' (the same moment) adds no chime. */
  private lastNone = -Infinity

  /** Filtered noise: a card flip or a whoosh. */
  private noise({ at = 0, dur = 0.06, gain = 0.05, freq = 3000, q = 0.8, sweepTo }: { at?: number; dur?: number; gain?: number; freq?: number; q?: number; sweepTo?: number } = {}) {
    const ctx = this.ready()
    if (!ctx || !this.master) return
    const t0 = ctx.currentTime + at
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(freq, t0)
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
    filter.Q.value = q
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur / 3))
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter).connect(env).connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  tap() {
    this.tone(1400, { dur: 0.05, gain: 0.07, wave: 'triangle', glideTo: 900 })
  }

  countdown(n: number) {
    if (n > 0) this.tone(660, { dur: 0.12, gain: 0.14, wave: 'triangle' })
    else {
      this.bell(note(5), 0, 0.4, 0.16)
      this.bell(note(8), 0.0, 0.4, 0.1)
    }
  }

  play(fx: BrainFx) {
    // The tap that finishes a trial plays only its verdict, not a hit and then the verdict.
    const now = performance.now()
    if (fx.kind === 'correct' || fx.kind === 'wrong' || fx.kind === 'noneCorrect') this.lastVerdict = now
    if (fx.kind === 'hit') {
      setTimeout(() => {
        if (performance.now() - this.lastVerdict <= 40) return
        // The run climbs a pentatonic step per hit. Number Hunt's second series (the boxed numbers)
        // answers in a rounder, lower voice, so the two series are told apart by ear too.
        if (fx.alt) {
          const f = note(1 + Math.min(fx.step, 8))
          this.tone(f, { dur: 0.2, gain: 0.13, attack: 0.008 })
          this.tone(f / 2, { dur: 0.16, gain: 0.04 })
        } else this.bell(note(4 + Math.min(fx.step, 8)), 0, 0.22, 0.12)
      }, 0)
      return
    }
    switch (fx.kind) {
      case 'reveal':
        this.noise({ dur: 0.35, gain: 0.04, freq: 600, sweepTo: 2400, q: 1.2 })
        break
      case 'wave': {
        // Flash Grid's waves: the reveal's whoosh, a little higher each wave.
        const lift = 1 + 0.25 * Math.max(0, fx.index)
        this.noise({ dur: 0.3, gain: 0.04, freq: 600 * lift, sweepTo: 2000 * lift, q: 1.2 })
        break
      }
      case 'noneCorrect':
        // «없음» was right: an open fifth (C5 + G5) that rings out — calm, unlike the climbing chime.
        this.lastNone = now
        this.bell(note(5), 0, 0.55, 0.11)
        this.bell(note(8), 0.0, 0.55, 0.08)
        break
      case 'flash':
        // A Simon tone per tile: the same cell always sings the same note.
        this.tone(note(2 + (fx.cell % 9)), { dur: 0.42, gain: 0.13, attack: 0.012 })
        this.tone(note(2 + (fx.cell % 9)) * 2, { dur: 0.25, gain: 0.03 })
        break
      case 'flip':
        this.noise({ dur: 0.05, gain: 0.05, freq: 3500, q: 0.7 })
        break
      case 'select':
        this.tap()
        break
      case 'miss':
        this.tone(196, { dur: 0.2, gain: 0.16, wave: 'triangle', glideTo: 140 })
        break
      case 'correct': {
        if (now - this.lastNone < 40) break
        // The chime climbs with the run (a semitone-ish pentatonic step per answer, capped).
        const base = 5 + Math.min(fx.streak - 1, 5)
        this.bell(note(base), 0, 0.3, 0.13)
        this.bell(note(base + 2), 0.07, 0.38, 0.12)
        break
      }
      case 'wrong':
        this.tone(220, { dur: 0.24, gain: 0.17, wave: 'triangle', glideTo: 150 })
        this.tone(110, { dur: 0.2, gain: 0.08, wave: 'sine' })
        break
      case 'lifeLost':
        this.tone(note(2), { at: 0.12, dur: 0.16, gain: 0.08, wave: 'triangle' })
        this.tone(note(0), { at: 0.26, dur: 0.22, gain: 0.08, wave: 'triangle' })
        break
      case 'levelUp':
        ;[5, 7, 8, 10].forEach((n, i) => this.bell(note(n), 0.25 + i * 0.075, 0.32, 0.11))
        break
      case 'roundEnd':
        ;[0, 2, 4].forEach((n) => this.bell(note(n + 5), 0, 0.9, 0.07))
        break
      case 'newBest':
        ;[3, 5, 7].forEach((n, i) => this.bell(note(n), 0.35 + i * 0.1, 0.25, 0.12))
        ;[5, 7, 10].forEach((n) => this.bell(note(n), 0.7, 1.1, 0.08))
        break
      case 'void':
        break
    }
  }
}

export const sfx = new Sfx()
