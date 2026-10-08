// Efectos: detalles que acompañan a una expresión.
//
// - "decal": calcomanía pegada a la superficie de la cara (rubor, brillo de
//   los ojos, lágrimas, vena de enojo...). Se proyecta punto por punto como
//   los ojos, así se curva con el cuerpo y se oculta al girar.
// - "sprite": glifo que vive en el espacio 3D de la cabeza (Z de sueño,
//   corazones, estrellas en órbita...). Su ancla gira con la cabeza, pero el
//   glifo se dibuja plano de cara a la cámara, como un cartel.
//
// Todo es función pura de (expresión, tiempo): sin estado, para que los
// renderizadores (Studio, React, DOM, exportación) den exactamente lo mismo.

import {
  ellipse,
  glyphs,
  roundedRect,
  strokePolyline,
  transformPolygons,
  type GlyphName,
  type Polygon,
  type Vec2,
} from './shapes'

export const effectKeys = [
  // calcomanías
  'blush',
  'catchlight',
  'tears',
  'anger-vein',
  'freckles',
  'gloom',
  // sprites
  'zzz',
  'hearts',
  'stars',
  'sparkles',
  'notes',
  'question',
  'exclaim',
  'sweat',
  'steam',
  'idea',
  'teardrops',
  'swirl',
  'confetti',
  'zap',
  'cloud',
] as const

export type EffectKey = (typeof effectKeys)[number]

const effectKeySet = new Set<string>(effectKeys)
export const isEffectKey = (value: unknown): value is EffectKey =>
  typeof value === 'string' && effectKeySet.has(value)

export const MAX_EFFECTS_PER_EXPRESSION = 4
export const MAX_DECAL_PATHS = 12
export const MAX_SPRITE_PATHS = 32

export type EffectPath = { d: string; fill: string; opacity: number }

/** Ojos ya resueltos (en coordenadas de cara) que algunas calcomanías usan de referencia. */
export type EffectEyes = {
  left: { x: number; y: number; width: number; height: number }
  right: { x: number; y: number; width: number; height: number }
}

export type EffectContext = {
  timeMs: number
  eyes: EffectEyes
  /**
   * Marco del personaje completo (forma principal + piezas): centro y semiejes.
   * Los sprites se ubican en proporción a este marco, así rodean la silueta
   * entera aunque la cara sea una pieza chica o esté corrida del centro.
   */
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  /** Escala de la cara (ver faceScaleFor): las calcomanías se achican en caras chicas. */
  scale: number
  /** Proyecta un contorno en coordenadas de cara; devuelve '' si queda de espaldas. */
  projectDecal: (polygons: Polygon[]) => string
  /** Proyecta un punto del espacio de la cabeza (x, y, z) a pantalla, con escala de perspectiva. */
  projectAnchor: (x: number, y: number, z: number) => { x: number; y: number; scale: number }
  /** Arma el path de glifos ya en coordenadas de pantalla. */
  toPath: (polygons: Polygon[]) => string
}

const fract = (value: number) => value - Math.floor(value)
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
/** Opacidad de una partícula que nace, vive y se desvanece en su ciclo 0..1. */
const lifeFade = (phase: number) => smoothstep(0, 0.15, phase) * (1 - smoothstep(0.7, 1, phase))

const MAX_SPRITE_EXTENT = 142 // el viewBox de los paquetes es -150..150

type SpriteSpec = {
  glyph: GlyphName | (() => Polygon[])
  /** Ancla en proporción al marco del personaje (u, v) y profundidad en px. */
  u: number
  v: number
  /** Ancla absoluta en coordenadas de cabeza (reemplaza a u / v). */
  x?: number
  y?: number
  z?: number
  size: number
  rotate?: number
  opacity?: number
  fill: string
}

const sprite = (context: EffectContext, spec: SpriteSpec): EffectPath | null => {
  const opacity = spec.opacity ?? 1
  if (opacity <= 0.01) return null
  const anchor = context.projectAnchor(
    spec.x ?? context.centerX + spec.u * context.halfWidth,
    spec.y ?? context.centerY + spec.v * context.halfHeight,
    spec.z ?? 0
  )
  const polygons = typeof spec.glyph === 'function' ? spec.glyph() : glyphs[spec.glyph]()
  const size = spec.size * anchor.scale
  const x = Math.max(
    -MAX_SPRITE_EXTENT + size / 2,
    Math.min(MAX_SPRITE_EXTENT - size / 2, anchor.x)
  )
  const y = Math.max(
    -MAX_SPRITE_EXTENT + size / 2,
    Math.min(MAX_SPRITE_EXTENT - size / 2, anchor.y)
  )
  const placed = transformPolygons(polygons, { x, y, scale: size, rotate: spec.rotate ?? 0 })
  return { d: context.toPath(placed), fill: spec.fill, opacity }
}

const decal = (context: EffectContext, polygons: Polygon[], fill: string, opacity: number) => {
  const d = context.projectDecal(polygons)
  return d ? { d, fill, opacity } : null
}

const eyeSides = (eyes: EffectEyes) => [
  { eye: eyes.left, side: -1 as const },
  { eye: eyes.right, side: 1 as const },
]

// ---------------------------------------------------------------------------
// Calcomanías
// ---------------------------------------------------------------------------

const decals: Partial<Record<EffectKey, (context: EffectContext) => (EffectPath | null)[]>> = {
  blush: context => {
    const s = context.scale
    return eyeSides(context.eyes).map(({ eye, side }) =>
      decal(
        context,
        [ellipse(15 * s, 8 * s, 32, eye.x + side * 10 * s, eye.y + eye.height / 2 + 13 * s)],
        '#ff6f9c',
        0.5
      )
    )
  },
  catchlight: context =>
    eyeSides(context.eyes).map(({ eye }) =>
      decal(
        context,
        [
          ellipse(
            Math.max(eye.width * 0.2, 2.2 * context.scale),
            Math.max(eye.width * 0.2, 2.2 * context.scale),
            20,
            eye.x - eye.width * 0.18,
            eye.y - eye.height * 0.22
          ),
        ],
        '#ffffff',
        0.92
      )
    ),
  tears: context => {
    // Dos arroyos que bajan desde el borde inferior de cada ojo y crecen/pulsan.
    const grow = 0.75 + 0.25 * Math.sin((context.timeMs / 900) * Math.PI * 2)
    const s = context.scale
    return eyeSides(context.eyes).map(({ eye, side }) => {
      const top = eye.y + eye.height / 2 - 2 * s
      const length = 30 * grow * s
      const width = 7 * s
      return decal(
        context,
        [
          roundedRect(width, length, width / 2).map(
            ([x, y]) => [eye.x + side * 3 * s + x, top + length / 2 + y] as const
          ),
        ],
        '#6ec8ff',
        0.85
      )
    })
  },
  'anger-vein': context => {
    const pulse = 1 + 0.12 * Math.sin((context.timeMs / 420) * Math.PI * 2)
    return [
      decal(
        context,
        transformPolygons(glyphs.anger(), {
          x: 46 * context.scale,
          y: -56 * context.scale,
          scale: 44 * pulse * context.scale,
        }),
        // Rojo oscuro: se lee sobre cuerpos claros y también sobre el rojo de "furioso".
        '#9e0b1f',
        0.95
      ),
    ]
  },
  freckles: context =>
    eyeSides(context.eyes).map(({ eye, side }) => {
      const s = context.scale
      const cy = eye.y + eye.height / 2 + 10 * s
      const cx = eye.x + side * 8 * s
      const dots: Vec2[] = [
        [cx - 7 * s, cy],
        [cx + 1 * s, cy + 4 * s],
        [cx + 8 * s, cy - 1 * s],
      ]
      return decal(
        context,
        dots.map(([x, y]) => ellipse(3.2 * s, 3.2 * s, 12, x, y)),
        '#6b3a22',
        0.65
      )
    }),
  gloom: context => {
    // Rayas verticales de "bajón" en la frente, estilo manga.
    const s = context.scale
    const lines = [-36, -18, 0, 18, 36].map(x =>
      strokePolyline(
        [
          [x * s, -95 * s],
          [x * s, (-58 + Math.abs(x) * 0.25) * s],
        ],
        4.5 * s
      )
    )
    return [decal(context, lines, '#1f1d4a', 0.4)]
  },
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

const particles = (count: number) => Array.from({ length: count }, (_, index) => index)

const sprites: Partial<Record<EffectKey, (context: EffectContext) => (EffectPath | null)[]>> = {
  zzz: context =>
    particles(3).map(index => {
      const phase = fract(context.timeMs / 3200 + index / 3)
      return sprite(context, {
        glyph: 'z',
        u: 0.55 + phase * 0.42,
        v: -0.55 - phase * 0.55,
        z: 20,
        size: 20 + phase * 22,
        rotate: -0.25 + Math.sin(phase * Math.PI * 2) * 0.12,
        opacity: lifeFade(phase),
        fill: '#e4ebff',
      })
    }),
  hearts: context =>
    particles(4).map(index => {
      const phase = fract(context.timeMs / 2600 + index / 4)
      const side = index % 2 === 0 ? -1 : 1
      return sprite(context, {
        glyph: 'heart',
        u: side * (0.84 + 0.1 * Math.sin(phase * Math.PI * 3 + index)),
        v: 0.2 - phase * 1.2,
        z: 30,
        size: 20 + 12 * Math.sin(phase * Math.PI),
        rotate: side * 0.2,
        opacity: lifeFade(phase),
        fill: index % 3 === 0 ? '#ff8fb6' : '#ff4f8b',
      })
    }),
  stars: context =>
    particles(3).map(index => {
      const angle = (context.timeMs / 1400) * Math.PI * 2 + (index / 3) * Math.PI * 2
      const depth = Math.sin(angle)
      return sprite(context, {
        glyph: 'star',
        u: Math.cos(angle) * 0.62,
        v: -0.92 + depth * 0.1,
        z: depth * 60,
        size: 24 + depth * 6,
        rotate: angle * 0.5,
        opacity: 0.65 + (0.35 * (depth + 1)) / 2,
        fill: '#ffd23f',
      })
    }),
  sparkles: context => {
    const spots: Vec2[] = [
      [-0.85, -0.6],
      [0.9, -0.35],
      [0.75, 0.55],
      [-0.7, 0.45],
      [0.1, -1.02],
    ]
    return spots.map(([u, v], index) => {
      const phase = fract(context.timeMs / 1500 + index * 0.37)
      const twinkle = Math.sin(phase * Math.PI)
      return sprite(context, {
        glyph: 'sparkle',
        u,
        v,
        z: 40,
        size: 10 + 22 * twinkle,
        opacity: twinkle,
        fill: index % 2 === 0 ? '#fff4a8' : '#ffffff',
      })
    })
  },
  notes: context =>
    particles(3).map(index => {
      const phase = fract(context.timeMs / 2800 + index / 3)
      const side = index === 1 ? -1 : 1
      return sprite(context, {
        glyph: 'note',
        u: side * (0.86 + 0.08 * Math.sin(phase * Math.PI * 4)),
        v: -0.1 - phase * 0.9,
        z: 30,
        size: 26 + 6 * Math.sin(phase * Math.PI),
        rotate: side * 0.15 + Math.sin(phase * Math.PI * 4) * 0.15,
        opacity: lifeFade(phase),
        fill: index === 1 ? '#8fd3ff' : '#b8a4ff',
      })
    }),
  question: context => {
    const bob = Math.sin((context.timeMs / 1100) * Math.PI * 2)
    return [
      sprite(context, {
        glyph: 'question',
        u: 0.72,
        v: -0.95 + bob * 0.04,
        z: 30,
        size: 46,
        rotate: 0.18 + bob * 0.08,
        fill: '#ffffff',
      }),
    ]
  },
  exclaim: context => {
    const pop = fract(context.timeMs / 1600)
    const scale = pop < 0.18 ? 0.6 + (pop / 0.18) * 0.55 : 1.15 - smoothstep(0.18, 0.4, pop) * 0.15
    return [
      sprite(context, {
        glyph: 'exclaim',
        u: 0.66,
        v: -0.98,
        z: 30,
        size: 46 * scale,
        rotate: 0.12,
        fill: '#ffd23f',
      }),
    ]
  },
  sweat: context => {
    const phase = fract(context.timeMs / 1900)
    return [
      sprite(context, {
        glyph: 'drop',
        u: 0.9,
        v: -0.62 + phase * 0.5,
        z: 50,
        size: 26,
        opacity: lifeFade(phase),
        fill: '#7fd3ff',
      }),
    ]
  },
  steam: context =>
    particles(4).map(index => {
      const phase = fract(context.timeMs / 1500 + index / 4)
      const side = index % 2 === 0 ? -1 : 1
      return sprite(context, {
        glyph: 'cloud',
        u: side * (0.45 + phase * 0.25),
        v: -0.85 - phase * 0.25,
        z: 10,
        size: 22 + phase * 24,
        opacity: lifeFade(phase) * 0.8,
        fill: '#ffffff',
      })
    }),
  idea: context => {
    const pulse = 0.85 + 0.15 * Math.sin((context.timeMs / 700) * Math.PI * 2)
    return [
      sprite(context, { glyph: 'rays', u: 0, v: -1.02, z: 20, size: 70 * pulse, fill: '#ffe066' }),
      sprite(context, {
        glyph: 'circle',
        u: 0,
        v: -1.02,
        z: 20,
        size: 22 * pulse,
        fill: '#ffe066',
      }),
    ]
  },
  teardrops: context =>
    particles(4).map(index => {
      const phase = fract(context.timeMs / 1300 + index / 4)
      const eye = index % 2 === 0 ? context.eyes.left : context.eyes.right
      return sprite(context, {
        glyph: 'drop',
        u: 0,
        v: 0,
        x: eye.x * 1.05,
        y: eye.y + eye.height / 2 + phase * 0.7 * context.halfHeight,
        z: 90,
        size: 16,
        opacity: lifeFade(phase),
        fill: '#6ec8ff',
      })
    }),
  swirl: context => [
    sprite(context, {
      glyph: 'spiral',
      u: 0,
      v: -1.0,
      z: 10,
      size: 46,
      rotate: (context.timeMs / 900) * Math.PI * 2,
      opacity: 0.9,
      fill: '#ffffff',
    }),
  ],
  confetti: context => {
    const colors = ['#ff4f8b', '#ffd23f', '#34c77b', '#4fa3ff', '#b36bff', '#ff8a3d']
    return particles(12).map(index => {
      const phase = fract(context.timeMs / 2400 + index * 0.137)
      const column = ((index * 0.61) % 1) * 2 - 1
      return sprite(context, {
        glyph: index % 3 === 0 ? 'circle' : 'square',
        u: column * 1.05 + Math.sin(phase * Math.PI * 4 + index) * 0.06,
        v: -1.1 + phase * 2.1,
        z: index % 2 === 0 ? 60 : -40,
        size: 10 + (index % 3) * 2.5,
        rotate: phase * Math.PI * 4 + index,
        opacity: lifeFade(phase),
        fill: colors[index % colors.length],
      })
    })
  },
  zap: context =>
    particles(2).map(index => {
      const flicker = fract(context.timeMs / 450 + index * 0.5)
      return sprite(context, {
        glyph: 'bolt',
        u: index === 0 ? -0.82 : 0.84,
        v: -0.72 + index * 0.1,
        z: 30,
        size: 38,
        rotate: index === 0 ? -0.3 : 0.3,
        opacity: flicker < 0.55 ? 1 : 0.25,
        fill: '#ffe14d',
      })
    }),
  cloud: context => {
    const drift = Math.sin((context.timeMs / 2600) * Math.PI * 2)
    return [
      sprite(context, {
        glyph: 'cloud',
        u: 0.2 + drift * 0.08,
        v: -1.0,
        z: -10,
        size: 70,
        opacity: 0.92,
        fill: '#8b93a8',
      }),
      ...particles(3).map(index => {
        const phase = fract(context.timeMs / 700 + index / 3)
        return sprite(context, {
          glyph: 'drop',
          u: 0.02 + index * 0.18 + drift * 0.08,
          v: -0.86 + phase * 0.35,
          z: -10,
          size: 10,
          opacity: lifeFade(phase),
          fill: '#7fb6ff',
        })
      }),
    ]
  },
}

export const isDecalEffect = (key: EffectKey) => key in decals

export const renderEffects = (
  effects: readonly EffectKey[] | undefined,
  levels: Partial<Record<EffectKey, number>> | undefined,
  context: EffectContext
): { decals: EffectPath[]; sprites: EffectPath[] } => {
  const out = { decals: [] as EffectPath[], sprites: [] as EffectPath[] }
  if (!effects?.length) return out
  effects.slice(0, MAX_EFFECTS_PER_EXPRESSION).forEach(key => {
    const level = levels?.[key] ?? 1
    if (level <= 0.01) return
    const decalRenderer = decals[key]
    const target = decalRenderer ? out.decals : out.sprites
    const rendered = (decalRenderer ?? sprites[key])?.(context) ?? []
    rendered.forEach(path => {
      if (path) target.push({ ...path, opacity: path.opacity * level })
    })
  })
  out.decals = out.decals.slice(0, MAX_DECAL_PATHS)
  out.sprites = out.sprites.slice(0, MAX_SPRITE_PATHS)
  return out
}
