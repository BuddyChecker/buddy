// Estampados: dibujos fijos impresos sobre la superficie principal del
// avatar (el ₿ de una moneda, las barras de Solana, la mitad verde de una
// píldora...). Son parte de la identidad del personaje, no de la expresión:
// se proyectan sobre la cara igual que los ojos, giran con la cabeza y se
// ocultan al darse vuelta. Se dibujan debajo de los ojos.

import { feather, knot, starburst } from './brandGlyphs'
import {
  ellipse,
  fitToBox,
  glyphs,
  roundedRect,
  strokePolyline,
  transformPolygons,
  type Polygon,
  type Vec2,
} from './shapes'

export const MAX_MARKINGS = 16
export const MAX_MARKING_POINTS = 64
/** Los estampados cubren como mucho la cara visible (radio de referencia 120 → ~±185 de arco). */
export const MARKING_EXTENT = 185

/**
 * "band": franja por latitud que envuelve TODA la forma (frente, costados y lo
 * que se vea de atrás), p. ej. la mitad de color de una cápsula. Usa `y` y
 * `height` como latitudes en el marco de la cara (y / 120 = radianes); `x` y
 * `width` no se usan. El resto se proyecta desde el frente de la cara.
 */
export const markingShapes = ['rect', 'ellipse', 'polygon', 'glyph', 'band'] as const
export type MarkingShape = (typeof markingShapes)[number]

export const markingGlyphs = [
  'bitcoin',
  'feather',
  'starburst',
  'knot',
  'heart',
  'star',
  'sparkle',
  'bolt',
  'drop',
  'note',
  'flower',
] as const
export type MarkingGlyph = (typeof markingGlyphs)[number]

export type SurfaceMarking = {
  shape: MarkingShape
  /** Solo para shape "glyph". */
  glyph?: MarkingGlyph
  /** Solo para shape "polygon": puntos en caja unitaria (-0.5..0.5), Y hacia abajo. */
  points?: [number, number][]
  /** Centro y tamaño en coordenadas de cara (mismo marco que los ojos). */
  x: number
  y: number
  width: number
  height: number
  /** Grados, sentido horario. */
  rotate?: number
  color: string
  opacity?: number
  /** Redondeo de esquinas para "rect", 0..1 (1 = píldora). */
  roundness?: number
}

/** ₿: B con dos rayas verticales arriba y abajo, en caja unitaria. */
const bitcoin = (): Polygon[] => {
  const stem = -0.2
  const width = 0.13
  const bowl = (top: number, bottom: number, right: number): Polygon => {
    const radius = (bottom - top) / 2
    const cx = right - radius
    const cy = (top + bottom) / 2
    const points: Vec2[] = [[stem, top]]
    for (let index = 0; index <= 16; index += 1) {
      const angle = -Math.PI / 2 + (index / 16) * Math.PI
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius])
    }
    points.push([stem, bottom])
    return strokePolyline(points, width)
  }
  const tick = (x: number, from: number, to: number) =>
    strokePolyline(
      [
        [x, from],
        [x, to],
      ],
      0.09
    )
  return [
    strokePolyline(
      [
        [stem, -0.36],
        [stem, 0.36],
      ],
      width
    ),
    bowl(-0.36, 0.0, 0.18),
    bowl(0.0, 0.36, 0.24),
    tick(-0.1, -0.5, -0.36),
    tick(0.06, -0.5, -0.36),
    tick(-0.1, 0.36, 0.5),
    tick(0.06, 0.36, 0.5),
  ]
}

const glyphFor = (glyph: MarkingGlyph | undefined): Polygon[] => {
  switch (glyph) {
    case 'bitcoin':
      return bitcoin()
    case 'feather':
      return feather()
    case 'starburst':
      return starburst()
    case 'knot':
      return knot()
    case 'heart':
      return glyphs.heart()
    case 'star':
      return glyphs.star()
    case 'sparkle':
      return glyphs.sparkle()
    case 'bolt':
      return glyphs.bolt()
    case 'drop':
      return glyphs.drop()
    case 'note':
      return glyphs.note()
    case 'flower':
      return glyphs.flower()
    default:
      return glyphs.circle()
  }
}

/** Contorno de un estampado en coordenadas de cara, listo para proyectar. */
export const markingPolygons = (marking: SurfaceMarking): Polygon[] => {
  let unit: Polygon[]
  switch (marking.shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(1, marking.roundness ?? 0)) * 0.5
      unit = [roundedRect(1, 1, r, 8)]
      break
    }
    case 'ellipse':
      unit = [ellipse(0.5, 0.5, 48)]
      break
    case 'polygon':
      unit = marking.points?.length ? [marking.points.map(([x, y]) => [x, y] as const)] : []
      break
    case 'band':
      return [] // se dibuja en 3D (ver bandPath en geometry.ts)
    case 'glyph':
    default:
      // Los símbolos conservan su proporción: width/height es la caja máxima.
      unit = fitToBox(glyphFor(marking.glyph), 1, 1, { contain: true })
  }
  const placed = transformPolygons(unit, {
    x: marking.x,
    y: marking.y,
    scale: marking.width,
    scaleY: marking.height,
    rotate: ((marking.rotate ?? 0) * Math.PI) / 180,
  })
  return placed.map(polygon =>
    polygon.map(
      ([x, y]) =>
        [
          Math.max(-MARKING_EXTENT, Math.min(MARKING_EXTENT, x)),
          Math.max(-MARKING_EXTENT, Math.min(MARKING_EXTENT, y)),
        ] as const
    )
  )
}

const hexColor = /^#[0-9a-f]{6}$/i
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Valida estampados guardados; descarta los inválidos en vez de fallar. */
export const parseSurfaceMarkings = (value: unknown): SurfaceMarking[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const markings = value.flatMap((item): SurfaceMarking[] => {
    const candidate = item as Partial<SurfaceMarking> | null
    if (!candidate || !markingShapes.includes(candidate.shape as MarkingShape)) return []
    if (![candidate.x, candidate.y, candidate.width, candidate.height].every(finite)) return []
    if (typeof candidate.color !== 'string' || !hexColor.test(candidate.color)) return []
    if (candidate.shape === 'glyph' && !markingGlyphs.includes(candidate.glyph as MarkingGlyph))
      return []
    const points =
      candidate.shape === 'polygon' && Array.isArray(candidate.points)
        ? candidate.points
            .filter(
              (point): point is [number, number] =>
                Array.isArray(point) && point.length === 2 && point.every(finite)
            )
            .slice(0, MAX_MARKING_POINTS)
        : undefined
    if (candidate.shape === 'polygon' && (!points || points.length < 3)) return []
    return [
      {
        shape: candidate.shape as MarkingShape,
        ...(candidate.shape === 'glyph' ? { glyph: candidate.glyph as MarkingGlyph } : {}),
        ...(points ? { points: points.map(([x, y]) => [x, y] as [number, number]) } : {}),
        x: candidate.x!,
        y: candidate.y!,
        width: candidate.width!,
        height: candidate.height!,
        ...(finite(candidate.rotate) ? { rotate: candidate.rotate } : {}),
        color: candidate.color.toLowerCase(),
        ...(finite(candidate.opacity)
          ? { opacity: Math.max(0, Math.min(1, candidate.opacity)) }
          : {}),
        ...(finite(candidate.roundness) ? { roundness: candidate.roundness } : {}),
      },
    ]
  })
  return markings.length ? markings.slice(0, MAX_MARKINGS) : undefined
}
