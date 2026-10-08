// Sonidos del buddy. Por defecto se SINTETIZAN con WebAudio (no hay archivos
// que distribuir); si el usuario subió uno propio para ese evento, suena ese.
//   press   → "squish" al apretarlo
//   double  → "boing" del doble clic (animación)
//   capture → obturador de la captura de pantalla
//   answer  → "pop" cuando termina de responder

let context = null
// On web pages (the extension, the site) Chrome blocks audio until the visitor clicks
// or types on the page. Before that we stay silent instead of creating an AudioContext
// that Chrome refuses (and logs a warning for). The desktop app runs from file://.
const onWebPage = /^https?:$/.test(globalThis.location?.protocol ?? '')
let unlocked = !onWebPage
if (onWebPage) {
  // the AudioContext is born inside a real click/key press: the one moment Chrome always allows it
  const unlock = () => {
    unlocked = true
    try {
      context ??= new AudioContext()
      if (context.state === 'suspended') context.resume()
    } catch {}
    for (const type of ['pointerdown', 'keydown']) window.removeEventListener(type, unlock, true)
  }
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, true)
}
const allowed = () => unlocked

const audio = () => {
  context ??= new AudioContext()
  if (context.state === 'suspended') context.resume()
  return context
}

const customCache = new Map() // evento -> AudioBuffer | null

export const forgetCustomSounds = () => customCache.clear()

const loadCustom = async (event, fetchBytes) => {
  if (customCache.has(event)) return customCache.get(event)
  let buffer = null
  try {
    const bytes = await fetchBytes(event)
    if (bytes) buffer = await audio().decodeAudioData(new Uint8Array(bytes).buffer)
  } catch {
    buffer = null // archivo dañado: se usa el sintetizado
  }
  customCache.set(event, buffer)
  return buffer
}

const envelope = (ctx, gain, attack, decay, peak) => {
  const now = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay)
}

const noiseBuffer = (ctx, seconds) => {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1
  return buffer
}

const synth = {
  // Squish: tono que cae + ruido filtrado grave, como apretar un peluche de goma.
  press(ctx, out) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    const now = ctx.currentTime
    osc.frequency.setValueAtTime(320 + Math.random() * 60, now)
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.16)
    envelope(ctx, gain, 0.008, 0.18, 0.5)
    osc.connect(gain).connect(out)
    osc.start(now)
    osc.stop(now + 0.22)
    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer(ctx, 0.12)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    const noiseGain = ctx.createGain()
    envelope(ctx, noiseGain, 0.004, 0.1, 0.18)
    noise.connect(filter).connect(noiseGain).connect(out)
    noise.start(now)
  },
  // Boing: resorte que sube, rebota y vibra.
  double(ctx, out) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const vibrato = ctx.createOscillator()
    const depth = ctx.createGain()
    const now = ctx.currentTime
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(180, now)
    osc.frequency.exponentialRampToValueAtTime(560, now + 0.08)
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.32)
    vibrato.frequency.value = 22
    depth.gain.value = 26
    vibrato.connect(depth).connect(osc.frequency)
    envelope(ctx, gain, 0.01, 0.36, 0.42)
    osc.connect(gain).connect(out)
    osc.start(now)
    vibrato.start(now)
    osc.stop(now + 0.4)
    vibrato.stop(now + 0.4)
  },
  // Obturador: dos clics de ruido agudo.
  capture(ctx, out) {
    ;[0, 0.07].forEach(offset => {
      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer(ctx, 0.05)
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = 2500
      const gain = ctx.createGain()
      const start = ctx.currentTime + offset
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.5, start + 0.003)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.045)
      noise.connect(filter).connect(gain).connect(out)
      noise.start(start)
    })
  },
  // Aparición: "fwip" que sube + campanita.
  appear(ctx, out) {
    const now = ctx.currentTime
    const sweep = ctx.createOscillator()
    const sweepGain = ctx.createGain()
    sweep.type = 'sine'
    sweep.frequency.setValueAtTime(220, now)
    sweep.frequency.exponentialRampToValueAtTime(880, now + 0.22)
    envelope(ctx, sweepGain, 0.02, 0.24, 0.35)
    sweep.connect(sweepGain).connect(out)
    sweep.start(now)
    sweep.stop(now + 0.3)
    ;[1320, 1760].forEach((frequency, index) => {
      const bell = ctx.createOscillator()
      const gain = ctx.createGain()
      const start = now + 0.2 + index * 0.08
      bell.type = 'triangle'
      bell.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
      bell.connect(gain).connect(out)
      bell.start(start)
      bell.stop(start + 0.4)
    })
  },
  // Pop: burbuja corta ascendente.
  answer(ctx, out) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const now = ctx.currentTime
    osc.type = 'sine'
    osc.frequency.setValueAtTime(700, now)
    osc.frequency.exponentialRampToValueAtTime(1300, now + 0.06)
    envelope(ctx, gain, 0.005, 0.09, 0.4)
    osc.connect(gain).connect(out)
    osc.start(now)
    osc.stop(now + 0.12)
  },
}

let animationAudio = null
// Carpeta base de los sonidos: '' en la app de escritorio (relativo a la
// página); en la extensión, la URL chrome-extension://…/ del paquete.
let soundBase = ''
export const setSoundBase = url => {
  soundBase = url
}
const clamp = value => Math.max(0, Math.min(1, value))

// Sonidos de interfaz (CC0, dist/sounds/ui): el "bloop" de cada clic y las
// burbujas del menú. Van al volumen de clics y con una pizca de variación de
// tono para que apretarlo muchas veces siga siendo agradable.
const uiCache = new Map()
export const playUiSound = (name, config, { vary = false } = {}) => {
  if (!config || config.muted || !/^[a-z0-9-]+$/.test(name) || !allowed()) return
  const volume = clamp(config.clickVolume ?? 0.45)
  if (!volume) return
  const base = uiCache.get(name) ?? new Audio(`${soundBase}sounds/ui/${name}.ogg`)
  uiCache.set(name, base)
  const audio = base.cloneNode()
  audio.volume = volume
  if (vary) {
    audio.preservesPitch = false
    audio.playbackRate = 0.92 + Math.random() * 0.18
  }
  audio.play().catch(() => {})
}

/** El clic de siempre: una de tres gotitas al azar. */
export const playTap = config => playUiSound(`tap-${1 + Math.floor(Math.random() * 3)}`, config, { vary: true })

/**
 * Sonido de una animación (archivos CC0 en dist/sounds, uno por animación).
 * Devuelve true si sonó algo.
 */
export const playAnimationSound = (soundId, config) => {
  if (!soundId || !config || config.muted || config.animationSounds === false) return false
  if (!/^[a-z0-9-]+$/.test(soundId) || !allowed()) return false
  animationAudio?.pause()
  animationAudio = new Audio(`${soundBase}sounds/${soundId}.ogg`)
  animationAudio.volume = clamp(config.animationVolume ?? config.volume ?? 0.7)
  animationAudio.play().catch(() => {})
  return true
}

/** Reproduce el sonido de un evento. config: { muted, volume, sounds }. */
export const playSound = async (event, config, fetchBytes) => {
  if (!config || config.muted || !synth[event] || !allowed()) return
  const ctx = audio()
  const out = ctx.createGain()
  out.gain.value = Math.max(0, Math.min(1, config.volume ?? 0.7))
  out.connect(ctx.destination)
  if (config.sounds?.[event]) {
    const buffer = await loadCustom(event, fetchBytes)
    if (buffer) {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(out)
      source.start()
      return
    }
  }
  synth[event](ctx, out)
}
