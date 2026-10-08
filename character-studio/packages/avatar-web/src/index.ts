import {
  advanceAvatarPlayback,
  createAvatarPlaybackState,
  hasLiveEffects,
  MAX_BODY_NODES,
  MAX_DECAL_PATHS,
  MAX_MARKINGS,
  MAX_SPRITE_PATHS,
  pauseAvatarPlayback,
  playAvatarAnimation,
  renderAvatarDefinition,
  renderAvatarFrame,
  resolveAnimation,
  resolveExpression,
  resumeAvatarPlayback,
  sampleAvatarFrame,
  validateAvatarDefinition,
  type AnimationKey,
  type AvatarDefinition,
  type AvatarPlaybackState as CorePlaybackState,
  type AvatarRuntimeError,
  type EffectPath,
  type ExpressionKey,
} from '@bible-strong/avatar-core'

export type AvatarCommandResult = { ok: true } | { ok: false; error: AvatarRuntimeError }

export type AvatarPlaybackState = Pick<
  CorePlaybackState,
  'activeAnimation' | 'activeExpression' | 'status'
>

export type AvatarController = {
  play(animation: AnimationKey): AvatarCommandResult
  setExpression(expression: ExpressionKey): AvatarCommandResult
  /**
   * Hace que el personaje mire hacia un punto, sumado a lo que esté haciendo:
   * x de -1 (izquierda) a 1 (derecha), y de -1 (abajo) a 1 (arriba).
   * null vuelve a mirar al frente. El movimiento se suaviza solo.
   */
  lookAt(x: number | null, y?: number): void
  /**
   * Limita los cuadros por segundo (0 = sin límite, a la velocidad de la pantalla).
   * Útil cuando el avatar vive encima de otra página y no debe gastarle CPU.
   */
  setMaxFps(fps: number): void
  pause(): void
  stop(): void
  getState(): AvatarPlaybackState
  destroy(): void
}

export type CreateAvatarOptions = {
  definition: unknown
  defaultAnimation?: AnimationKey
  defaultExpression?: ExpressionKey
  autoplay?: boolean
  size?: number | string
  ariaLabel?: string
  className?: string
  onError?: (error: AvatarRuntimeError) => void
  onAnimationEnd?: (animation: AnimationKey) => void
  onExpressionChange?: (expression: ExpressionKey) => void
  /** Tope de cuadros por segundo (0 o sin definir = sin límite). */
  maxFps?: number
}

const paintEffectSlots = (elements: SVGPathElement[], paths: readonly EffectPath[]) => {
  elements.forEach((element, index) => {
    const effect = paths[index]
    element.setAttribute('d', effect?.d ?? '')
    element.setAttribute('fill', effect?.fill ?? 'none')
    element.setAttribute('opacity', effect ? effect.opacity.toFixed(3) : '0')
  })
}

const svgNamespace = 'http://www.w3.org/2000/svg'
const controlledExpressionTransitionMs = 420
const bodyPathSlots = MAX_BODY_NODES + 2
let avatarInstanceId = 0

const dimension = (size: number | string) => (typeof size === 'number' ? `${size}px` : size)

const invalidDefinitionError = (errors: readonly { path: string; message: string }[]) => {
  const first = errors[0]
  return new Error(
    first
      ? `Invalid avatar definition${first.path ? ` at ${first.path}` : ''}: ${first.message}`
      : 'Invalid avatar definition.'
  )
}

const resolveTarget = (target: string | HTMLElement) => {
  const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
  if (!element) throw new Error(`Avatar target '${target}' was not found.`)
  return element
}

const createSvgElement = <Name extends keyof SVGElementTagNameMap>(name: Name) =>
  document.createElementNS(svgNamespace, name)

const playbackSnapshot = (state: CorePlaybackState): AvatarPlaybackState => ({
  ...(state.activeAnimation ? { activeAnimation: state.activeAnimation } : {}),
  activeExpression: state.activeExpression,
  status: state.status,
})

const baseEnvironment = () => ({
  random: Math.random,
  reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
})
// Suavizado de la mirada: constante de tiempo (ms) del seguimiento.
const GAZE_SMOOTHING_MS = 110

export function createAvatar(
  target: string | HTMLElement,
  {
    definition: input,
    defaultAnimation,
    defaultExpression,
    autoplay = true,
    size = 240,
    ariaLabel = 'Procedural avatar',
    className,
    onError,
    onAnimationEnd,
    onExpressionChange,
    maxFps = 0,
  }: CreateAvatarOptions
): AvatarController {
  if (defaultAnimation !== undefined && defaultExpression !== undefined) {
    throw new Error('Choose either defaultAnimation or defaultExpression, not both.')
  }
  const validated = validateAvatarDefinition(input)
  if (!validated.ok) throw invalidDefinitionError(validated.errors)
  const definition: Readonly<AvatarDefinition> = validated.value
  const mount = resolveTarget(target)
  const host = document.createElement('span')
  host.className = ['bs-avatar', className ?? ''].filter(Boolean).join(' ')
  host.style.display = 'inline-block'
  host.style.width = dimension(size)
  host.style.height = dimension(size)
  host.setAttribute('role', 'img')
  host.setAttribute('aria-label', ariaLabel)

  const svg = createSvgElement('svg')
  svg.setAttribute('viewBox', '-150 -150 300 300')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.display = 'block'
  svg.style.width = '100%'
  svg.style.height = '100%'
  const defs = createSvgElement('defs')
  const clipPath = createSvgElement('clipPath')
  const clipId = `bs-avatar-web-${++avatarInstanceId}`
  clipPath.id = clipId
  const clipHeadPath = createSvgElement('path')
  clipPath.append(clipHeadPath)
  defs.append(clipPath)
  svg.append(defs)

  const initialScene = renderAvatarDefinition(definition)
  const backPaths = Array.from({ length: bodyPathSlots }, () => createSvgElement('path'))
  const headPath = createSvgElement('path')
  const eyeGroup = createSvgElement('g')
  eyeGroup.setAttribute('clip-path', `url(#${clipId})`)
  const leftPath = createSvgElement('path')
  const rightPath = createSvgElement('path')
  const decalPaths = Array.from({ length: MAX_DECAL_PATHS }, () => createSvgElement('path'))
  const markingPaths = Array.from({ length: MAX_MARKINGS }, () => createSvgElement('path'))
  leftPath.setAttribute('class', 'bs-avatar__eye')
  rightPath.setAttribute('class', 'bs-avatar__eye')
  eyeGroup.append(...markingPaths, leftPath, rightPath, ...decalPaths)
  const frontPaths = Array.from({ length: bodyPathSlots }, () => createSvgElement('path'))
  const spritePaths = Array.from({ length: MAX_SPRITE_PATHS }, () => createSvgElement('path'))
  const spriteGroup = createSvgElement('g')
  spriteGroup.setAttribute('class', 'bs-avatar__effects')
  spriteGroup.append(...spritePaths)
  svg.append(...backPaths, headPath, eyeGroup, ...frontPaths, spriteGroup)
  host.append(svg)
  mount.append(host)

  const reportError = (error: AvatarRuntimeError) => {
    if (onError) onError(error)
    else console.error(`[Avatar] ${error.message}`)
  }
  const paint = (scene: ReturnType<typeof renderAvatarDefinition>) => {
    clipHeadPath.setAttribute('d', scene.geometry.headPath)
    headPath.setAttribute('d', scene.geometry.headPath)
    headPath.setAttribute('fill', scene.colors.body)
    leftPath.setAttribute('d', scene.geometry.leftPath)
    leftPath.setAttribute('fill', scene.colors.eyes)
    leftPath.setAttribute('opacity', scene.geometry.leftVisible ? '1' : '0')
    rightPath.setAttribute('d', scene.geometry.rightPath)
    rightPath.setAttribute('fill', scene.colors.eyes)
    rightPath.setAttribute('opacity', scene.geometry.rightVisible ? '1' : '0')
    backPaths.forEach((element, index) => {
      element.setAttribute('d', scene.geometry.backPaths[index] ?? '')
      element.setAttribute('fill', scene.geometry.backFills[index] ?? scene.colors.body)
    })
    frontPaths.forEach((element, index) => {
      element.setAttribute('d', scene.geometry.frontPaths[index] ?? '')
      element.setAttribute('fill', scene.geometry.frontFills[index] ?? scene.colors.body)
    })
    paintEffectSlots(markingPaths, scene.geometry.markings)
    paintEffectSlots(decalPaths, scene.geometry.decals)
    paintEffectSlots(spritePaths, scene.geometry.sprites)
  }

  let playback = createAvatarPlaybackState()
  let frameRequest: number | null = null
  // with a frame cap, sleep with a timer until the next frame is due instead of
  // waking up on every screen refresh just to skip it
  let frameTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false
  let completedAnimation: AnimationKey | undefined
  let lastExpression: ExpressionKey | undefined
  let paintedFrame: ReturnType<typeof sampleAvatarFrame> | undefined
  const gaze = { x: 0, y: 0 }
  const gazeTarget = { x: 0, y: 0 }
  let gazeTime: number | null = null
  let frameBudgetMs = maxFps > 0 ? 1000 / maxFps : 0
  let lastPaint = -Infinity
  const runtimeEnvironment = () => ({
    ...baseEnvironment(),
    ...(gaze.x || gaze.y ? { gaze: { x: gaze.x, y: gaze.y } } : {}),
  })
  /** Acerca la mirada a su objetivo; devuelve true si todavía se está moviendo. */
  const stepGaze = (now: number) => {
    const dt = gazeTime === null ? 16 : Math.min(64, now - gazeTime)
    gazeTime = now
    const blend = 1 - Math.exp(-dt / GAZE_SMOOTHING_MS)
    gaze.x += (gazeTarget.x - gaze.x) * blend
    gaze.y += (gazeTarget.y - gaze.y) * blend
    const moving = Math.abs(gazeTarget.x - gaze.x) > 0.002 || Math.abs(gazeTarget.y - gaze.y) > 0.002
    if (!moving) {
      gaze.x = gazeTarget.x
      gaze.y = gazeTarget.y
      gazeTime = null
    }
    return moving
  }

  const notifyExpression = () => {
    if (lastExpression === playback.activeExpression) return
    lastExpression = playback.activeExpression
    onExpressionChange?.(playback.activeExpression)
  }
  const renderCurrent = (now: number) => {
    const environment = runtimeEnvironment()
    paintedFrame = sampleAvatarFrame(definition, playback, now, environment)
    paint(renderAvatarFrame(definition, playback, now, environment))
    notifyExpression()
  }
  const tick = (now: number) => {
    frameRequest = null
    if (destroyed) return
    // con tope de fps: se salta cuadros (con 1 ms de tolerancia por el jitter de rAF)
    if (frameBudgetMs && now - lastPaint < frameBudgetMs - 1) {
      nextFrame()
      return
    }
    lastPaint = now
    const currentAnimation = playback.activeAnimation
    const wasPlaying = playback.status === 'playing'
    const gazeMoving = stepGaze(now)
    const environment = runtimeEnvironment()
    playback = advanceAvatarPlayback(definition, playback, now, environment)
    renderCurrent(now)
    if (wasPlaying && playback.status === 'stopped' && currentAnimation) {
      if (completedAnimation !== currentAnimation) onAnimationEnd?.(currentAnimation)
      completedAnimation = currentAnimation
    }
    if (playback.status === 'playing' || gazeMoving || hasLiveEffects(definition, playback, environment)) {
      nextFrame()
    }
  }
  const nextFrame = () => {
    const wait = frameBudgetMs ? frameBudgetMs - (performance.now() - lastPaint) : 0
    if (wait > 12) {
      frameTimer = setTimeout(() => {
        frameTimer = null
        if (!destroyed) frameRequest = requestAnimationFrame(tick)
      }, wait - 6)
    } else {
      frameRequest = requestAnimationFrame(tick)
    }
  }
  const cancelFrame = () => {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest)
    if (frameTimer !== null) clearTimeout(frameTimer)
    frameRequest = null
    frameTimer = null
  }
  const schedule = () => {
    if (frameRequest === null && frameTimer === null && !destroyed) frameRequest = requestAnimationFrame(tick)
  }

  const controller: AvatarController = {
    play(animation) {
      if (
        playback.status === 'paused' &&
        playback.activeAnimation === animation &&
        playback.pausedAt !== undefined
      ) {
        playback = resumeAvatarPlayback(playback, performance.now())
        schedule()
        return { ok: true }
      }
      const now = performance.now()
      const from =
        paintedFrame ?? sampleAvatarFrame(definition, playback, now, runtimeEnvironment())
      const result = playAvatarAnimation(definition, animation, now, from)
      if (!result.ok) return { ok: false, error: result.error }
      completedAnimation = undefined
      playback = result.value
      renderCurrent(performance.now())
      schedule()
      return { ok: true }
    },
    setExpression(expression) {
      const result = resolveExpression(definition, expression)
      if (!result.ok) return { ok: false, error: result.error }
      const now = performance.now()
      const from =
        paintedFrame ?? sampleAvatarFrame(definition, playback, now, runtimeEnvironment())
      playback = {
        ...createAvatarPlaybackState(),
        activeExpression: expression,
        ...(playback.activeExpression === expression
          ? {}
          : {
              status: 'playing' as const,
              directTransition: {
                from,
                startedAt: now,
                durationMs: controlledExpressionTransitionMs,
                transition: 'smooth' as const,
              },
            }),
      }
      renderCurrent(performance.now())
      if (playback.status === 'playing') schedule()
      return { ok: true }
    },
    setMaxFps(fps) {
      frameBudgetMs = fps > 0 ? 1000 / fps : 0
    },
    lookAt(x, y = 0) {
      const clamp = (value: number) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
      gazeTarget.x = x === null ? 0 : clamp(x)
      gazeTarget.y = x === null ? 0 : clamp(y)
      schedule()
    },
    pause() {
      if (playback.status !== 'playing') return
      playback = pauseAvatarPlayback(playback, performance.now())
      cancelFrame()
    },
    stop() {
      playback = createAvatarPlaybackState()
      cancelFrame()
      paint(renderAvatarDefinition(definition))
      notifyExpression()
    },
    getState() {
      return playbackSnapshot(playback)
    },
    destroy() {
      destroyed = true
      cancelFrame()
      host.remove()
    },
  }

  if (defaultAnimation !== undefined) {
    const resolved = resolveAnimation(definition, defaultAnimation)
    if (!resolved.ok) reportError(resolved.error)
    else if (autoplay) controller.play(defaultAnimation)
    else {
      playback = {
        ...createAvatarPlaybackState(),
        activeExpression: resolved.value.steps[0]?.expression ?? 'neutral',
      }
      renderCurrent(performance.now())
    }
  } else if (defaultExpression !== undefined) {
    const resolved = resolveExpression(definition, defaultExpression)
    if (!resolved.ok) reportError(resolved.error)
    else {
      playback = { ...createAvatarPlaybackState(), activeExpression: defaultExpression }
      renderCurrent(performance.now())
    }
  } else {
    paint(initialScene)
    paintedFrame = sampleAvatarFrame(definition, playback, performance.now(), runtimeEnvironment())
    notifyExpression()
  }

  return controller
}

export type { AnimationKey, AvatarDefinition, AvatarRuntimeError, ExpressionKey }
