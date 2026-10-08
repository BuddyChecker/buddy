// Biblioteca de formas 2D. Todo se describe como polígonos cerrados en un
// plano local (Y hacia abajo) y recién después se proyecta: los ojos y las
// calcomanías sobre la superficie de la cara, los sprites en el espacio 3D
// de la cabeza. Un mismo contorno puede tener varios subtrazos; con la regla
// de relleno nonzero, un subtrazo en sentido contrario abre un hueco (ring).

export type Vec2 = readonly [number, number]
export type Polygon = Vec2[]

const TAU = Math.PI * 2

export const eyeShapes = [
  'pill',
  'heart',
  'star',
  'sparkle',
  'cross',
  'happy',
  'relaxed',
  'crescent',
  'diamond',
  'spiral',
  'ring',
  'square',
  'triangle',
  'flower',
] as const

export type EyeShape = (typeof eyeShapes)[number]

const eyeShapeSet = new Set<string>(eyeShapes)
export const isEyeShape = (value: unknown): value is EyeShape =>
  typeof value === 'string' && eyeShapeSet.has(value)

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

export const ellipse = (rx: number, ry: number, samples = 40, cx = 0, cy = 0): Polygon =>
  Array.from({ length: samples }, (_, index) => {
    const angle = (index / samples) * TAU
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry] as const
  })

/** Rectángulo con esquinas redondeadas de radio r (r = min(w,h)/2 da una píldora). */
export const roundedRect = (width: number, height: number, radius: number, arcSamples = 14) => {
  const hw = width / 2
  const hh = height / 2
  const r = Math.max(0, Math.min(radius, hw, hh))
  const points: Vec2[] = []
  const corner = (cx: number, cy: number, start: number) => {
    for (let index = 0; index <= arcSamples; index += 1) {
      const angle = start + (index / arcSamples) * (Math.PI / 2)
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r])
    }
  }
  corner(hw - r, -hh + r, -Math.PI / 2)
  corner(hw - r, hh - r, 0)
  corner(-hw + r, hh - r, Math.PI / 2)
  corner(-hw + r, -hh + r, Math.PI)
  return points
}

/**
 * Convierte una polilínea en un polígono de grosor fijo con puntas
 * redondeadas: así se dibujan trazos (arcos ^, espirales, signos) con
 * relleno, igual que el resto de las formas.
 */
export const strokePolyline = (points: Vec2[], width: number, capSamples = 8): Polygon => {
  if (points.length < 2) return []
  const half = width / 2
  const normals = points.map((_, index) => {
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next[0] - previous[0]
    const dy = next[1] - previous[1]
    const length = Math.hypot(dx, dy) || 1
    return [-dy / length, dx / length] as const
  })
  const left = points.map(
    ([x, y], index) => [x + normals[index][0] * half, y + normals[index][1] * half] as const
  )
  const right = points.map(
    ([x, y], index) => [x - normals[index][0] * half, y - normals[index][1] * half] as const
  )
  const cap = (center: Vec2, normal: Vec2, from: 1 | -1) => {
    const base = Math.atan2(normal[1], normal[0])
    return Array.from({ length: capSamples - 1 }, (_, index) => {
      const angle = base + from * ((index + 1) / capSamples) * Math.PI
      return [center[0] + Math.cos(angle) * half, center[1] + Math.sin(angle) * half] as const
    })
  }
  const last = points.length - 1
  return orient([
    ...left,
    ...cap(points[last], normals[last], -1),
    ...right.reverse(),
    ...cap(points[0], [-normals[0][0], -normals[0][1]], -1),
  ])
}

/** Área con signo (positiva = sentido horario con Y hacia abajo). */
export const signedArea = (polygon: Polygon) =>
  polygon.reduce((total, [x, y], index) => {
    const [nx, ny] = polygon[(index + 1) % polygon.length]
    return total + (x * ny - nx * y)
  }, 0) / 2

/**
 * Deja un polígono en sentido horario. Con relleno nonzero, dos trazos que se
 * superponen con sentidos opuestos se cancelan y abren huecos; con el mismo
 * sentido siempre se suman.
 */
export const orient = (polygon: Polygon): Polygon =>
  signedArea(polygon) < 0 ? [...polygon].reverse() : polygon

const sampleCurve = (samples: number, at: (t: number) => Vec2) =>
  Array.from({ length: samples + 1 }, (_, index) => at(index / samples))

/**
 * Escala un conjunto de polígonos para que su caja quepa en width x height,
 * centrado. Por defecto la llena exacto (puede deformar); con `contain` respeta
 * la proporción del dibujo y lo encaja entero.
 */
export const fitToBox = (
  polygons: Polygon[],
  width: number,
  height: number,
  { contain = false }: { contain?: boolean } = {}
): Polygon[] => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  polygons.forEach(polygon =>
    polygon.forEach(([x, y]) => {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    })
  )
  let sx = width / (maxX - minX || 1)
  let sy = height / (maxY - minY || 1)
  if (contain) sx = sy = Math.min(sx, sy)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return polygons.map(polygon => polygon.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy] as const))
}

export const transformPolygons = (
  polygons: Polygon[],
  {
    x = 0,
    y = 0,
    scale = 1,
    scaleY = scale,
    rotate = 0,
  }: { x?: number; y?: number; scale?: number; scaleY?: number; rotate?: number }
): Polygon[] => {
  const cos = Math.cos(rotate)
  const sin = Math.sin(rotate)
  return polygons.map(polygon =>
    polygon.map(([px, py]) => {
      const sx = px * scale
      const sy = py * scaleY
      return [x + sx * cos - sy * sin, y + sx * sin + sy * cos] as const
    })
  )
}

// ---------------------------------------------------------------------------
// Glifos en caja unitaria (aprox. -0.5..0.5). Se reutilizan para ojos y sprites.
// ---------------------------------------------------------------------------

const heart = (): Polygon[] => [
  sampleCurve(64, t => {
    const a = t * TAU
    return [
      16 * Math.sin(a) ** 3,
      -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)),
    ]
  }).slice(0, -1),
]

const star = (points = 5, inner = 0.42): Polygon[] => [
  Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 0.5 : 0.5 * inner
    const angle = -Math.PI / 2 + (index / (points * 2)) * TAU
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const
  }),
]

/** Destello de 4 puntas con lados cóncavos (astroide). */
const sparkle = (): Polygon[] => [
  sampleCurve(64, t => {
    const a = t * TAU
    return [0.5 * Math.cos(a) ** 3, 0.5 * Math.sin(a) ** 3]
  }).slice(0, -1),
]

const flower = (): Polygon[] => [
  sampleCurve(90, t => {
    const a = t * TAU
    const r = 0.5 * (0.62 + 0.38 * Math.abs(Math.cos(2.5 * a)))
    return [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r]
  }).slice(0, -1),
]

const drop = (): Polygon[] => [
  sampleCurve(48, t => {
    const a = t * TAU
    // Gota: punta arriba, panza redonda abajo.
    const x = 0.5 * Math.sin(a) * Math.sin(a / 2) ** 1.2
    const y = -0.5 * Math.cos(a)
    return [x, y]
  }).slice(0, -1),
]

const zLetter = (): Polygon[] => [
  [
    [-0.4, -0.5],
    [0.4, -0.5],
    [0.4, -0.3],
    [-0.08, 0.3],
    [0.42, 0.3],
    [0.42, 0.5],
    [-0.42, 0.5],
    [-0.42, 0.3],
    [0.06, -0.3],
    [-0.4, -0.3],
  ],
]

const note = (): Polygon[] => [
  ellipse(0.2, 0.15, 24, -0.12, 0.33),
  [
    [0.02, 0.33],
    [0.02, -0.5],
    [0.36, -0.36],
    [0.36, -0.2],
    [0.1, -0.3],
    [0.1, 0.33],
  ],
]

const question = (): Polygon[] => [
  strokePolyline(
    sampleCurve(18, t => {
      if (t < 0.72) {
        const a = Math.PI + (t / 0.72) * Math.PI * 1.35
        return [Math.cos(a) * 0.26, -0.22 + Math.sin(a) * 0.26]
      }
      const k = (t - 0.72) / 0.28
      return [0.02 * (1 - k), 0.04 + k * 0.14]
    }),
    0.16
  ),
  ellipse(0.09, 0.09, 16, 0, 0.4),
]

const exclaim = (): Polygon[] => [
  roundedRect(0.2, 0.62, 0.1).map(([x, y]) => [x, y - 0.14] as const),
  ellipse(0.1, 0.1, 16, 0, 0.4),
]

const bolt = (): Polygon[] => [
  [
    [0.1, -0.5],
    [-0.3, 0.06],
    [-0.02, 0.06],
    [-0.12, 0.5],
    [0.32, -0.08],
    [0.04, -0.08],
  ],
]

const cloud = (): Polygon[] => [
  ellipse(0.2, 0.18, 24, -0.24, 0.06),
  ellipse(0.25, 0.24, 24, 0, -0.06),
  ellipse(0.2, 0.18, 24, 0.24, 0.06),
  roundedRect(0.7, 0.24, 0.12).map(([x, y]) => [x, y + 0.12] as const),
]

const spiral = (turns = 2.2, width = 0.12): Polygon[] => [
  strokePolyline(
    sampleCurve(80, t => {
      const a = t * turns * TAU
      const r = 0.06 + t * 0.4
      return [Math.cos(a) * r, Math.sin(a) * r]
    }),
    width
  ),
]

/** Marca de enojo (cuatro esquinas curvas enfrentadas, estilo manga). */
const angerMark = (): Polygon[] =>
  [0, 1, 2, 3].map(quadrant => {
    const angle = quadrant * (Math.PI / 2)
    const arc = sampleCurve(10, t => {
      const a = angle + Math.PI * 0.12 + t * Math.PI * 0.26
      return [Math.cos(a) * 0.42, Math.sin(a) * 0.42]
    })
    return strokePolyline(
      arc.map(
        ([x, y]) =>
          [
            x * (0.6 + 0.4 * Math.abs(Math.cos(Math.atan2(y, x) * 2))),
            y * (0.6 + 0.4 * Math.abs(Math.cos(Math.atan2(y, x) * 2))),
          ] as const
      ),
      0.14
    )
  })

const rays = (count = 7, inner = 0.26, outer = 0.5): Polygon[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI + (index / (count - 1)) * Math.PI
    return strokePolyline(
      [
        [Math.cos(angle) * inner, Math.sin(angle) * inner],
        [Math.cos(angle) * outer, Math.sin(angle) * outer],
      ],
      0.09
    )
  })

export const glyphs = {
  // La curva del corazón mide ~32 unidades: se normaliza a la caja unitaria.
  heart: () => fitToBox(heart(), 1, 0.92),
  star: () => star(),
  sparkle,
  flower,
  drop,
  z: zLetter,
  note,
  question,
  exclaim,
  bolt,
  cloud,
  spiral: () => spiral(),
  anger: angerMark,
  rays: () => rays(),
  circle: () => [ellipse(0.5, 0.5, 28)],
  square: () => [roundedRect(1, 1, 0.08, 4)],
} satisfies Record<string, () => Polygon[]>

export type GlyphName = keyof typeof glyphs

// ---------------------------------------------------------------------------
// Ojos: contorno de cada forma dentro de la caja ancho x alto del ojo.
// ---------------------------------------------------------------------------

const arcStroke = (width: number, height: number, direction: 1 | -1): Polygon[] => {
  // ^ (direction 1) o ‿ (direction -1): el grosor escala con el ojo pero con límites legibles.
  const thickness = Math.max(4, Math.min(12, Math.min(width, height) * 0.42))
  const hw = width / 2 - thickness / 2
  const hh = Math.max(height / 2 - thickness / 2, 1)
  const points = sampleCurve(24, t => {
    const x = -hw + t * 2 * hw
    const k = x / (hw || 1)
    return [x, direction * (hh * (k * k) - hh / 2) * 1]
  })
  return [
    strokePolyline(
      points.map(([x, y]) => [x, y] as const),
      thickness
    ),
  ]
}

export const eyeOutline = (shape: EyeShape, width: number, height: number): Polygon[] => {
  switch (shape) {
    case 'heart':
      return fitToBox(heart(), width, height)
    case 'star':
      return fitToBox(star(), width, height)
    case 'sparkle':
      return fitToBox(sparkle(), width, height)
    case 'flower':
      return fitToBox(flower(), width, height)
    case 'diamond':
      return [
        [
          [0, -height / 2],
          [width / 2, 0],
          [0, height / 2],
          [-width / 2, 0],
        ],
      ]
    case 'triangle':
      return [
        [
          [0, -height / 2],
          [width / 2, height / 2],
          [-width / 2, height / 2],
        ],
      ]
    case 'square':
      return [roundedRect(width, height, Math.min(width, height) * 0.18, 4)]
    case 'cross': {
      const thickness = Math.max(4, Math.min(width, height) * 0.3)
      const hw = width / 2 - thickness / 2
      const hh = height / 2 - thickness / 2
      return [
        strokePolyline(
          [
            [-hw, -hh],
            [hw, hh],
          ],
          thickness
        ),
        strokePolyline(
          [
            [hw, -hh],
            [-hw, hh],
          ],
          thickness
        ),
      ]
    }
    case 'happy':
      return arcStroke(width, height, 1)
    case 'relaxed':
      return arcStroke(width, height, -1)
    case 'crescent': {
      // Párpado de luna: media elipse inferior menos una curva interna.
      const outer = sampleCurve(24, t => {
        const a = t * Math.PI
        return [Math.cos(a) * (width / 2), -height * 0.1 + Math.sin(a) * (height * 0.6)]
      })
      const inner = sampleCurve(24, t => {
        const a = Math.PI - t * Math.PI
        return [Math.cos(a) * (width / 2) * 0.96, -height * 0.1 + Math.sin(a) * (height * 0.18)]
      })
      return fitToBox([[...outer, ...inner]], width, height)
    }
    case 'spiral':
      return fitToBox(spiral(2.1, 0.14), width, height)
    case 'ring': {
      const thickness = Math.max(3, Math.min(width, height) * 0.24)
      const outer = ellipse(width / 2, height / 2, 36)
      const inner = ellipse(
        Math.max(width / 2 - thickness, 1),
        Math.max(height / 2 - thickness, 1),
        36
      ).reverse()
      return [outer, inner]
    }
    case 'pill':
    default:
      return [roundedRect(width, height, Math.min(width, height) / 2)]
  }
}
