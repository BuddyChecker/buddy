// Símbolos de marca para estampar en avatares (monedas/tokens). Son
// reconstrucciones propias hechas con curvas y primitivas —no calcos de
// archivos oficiales— en caja unitaria (-0.5..0.5, Y hacia abajo).

import { ellipse, orient, transformPolygons, type Polygon, type Vec2 } from './shapes'

const TAU = Math.PI * 2

/** Tramo Bézier cúbico muestreado (sin el punto inicial, para encadenar tramos). */
const cubic = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, samples = 14): Vec2[] =>
  Array.from({ length: samples }, (_, index) => {
    const t = (index + 1) / samples
    const u = 1 - t
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ] as const
  })

/** Encadena tramos Bézier: cada tramo es [control1, control2, destino]. */
const path = (start: Vec2, segments: [Vec2, Vec2, Vec2][]): Vec2[] => {
  const points: Vec2[] = [start]
  let current = start
  segments.forEach(([c1, c2, end]) => {
    points.push(...cubic(current, c1, c2, end))
    current = end
  })
  return points
}

/**
 * Curva Catmull-Rom que pasa por todos los puntos (tramos suaves entre
 * esquinas). Devuelve los puntos intermedios sin repetir el primero.
 */
const smooth = (points: Vec2[], samples = 10): Vec2[] => {
  const out: Vec2[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[Math.min(points.length - 1, index + 2)]
    for (let step = 1; step <= samples; step += 1) {
      const t = step / samples
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  return out
}

/**
 * Contorno hecho de tramos: cada tramo es suave por dentro y las uniones entre
 * tramos son esquinas. El último punto de un tramo es el primero del siguiente.
 */
const piece = (runs: Vec2[][]): Polygon =>
  orient(runs.flatMap((run, index) => (index === 0 ? [run[0], ...smooth(run)] : smooth(run))))

/**
 * Pluma de Robinhood (identidad 2024): tres piezas separadas por ranuras
 * finas, orientadas en diagonal hacia arriba a la derecha.
 * - Punta en chevron (arriba a la derecha): es la "flecha escondida"; su
 *   esquina interior es redondeada.
 * - Barba larga a la izquierda, que baja curva y termina en el cálamo.
 * - Pieza central, entre ambas.
 * (La versión anterior tenía una cuarta pieza chica abajo a la derecha; el
 * rediseño de 2024 la quitó.) Proporciones medidas sobre el logo, curvas propias.
 */
export const feather = (): Polygon[] => {
  const chevron = piece([
    // borde superior izquierdo, curvo hasta la cima
    [
      [-0.091, -0.286],
      [-0.01, -0.385],
      [0.081, -0.47],
      [0.23, -0.5],
      [0.339, -0.474],
    ],
    // lomo derecho, convexo, hasta el hombro
    [
      [0.339, -0.474],
      [0.37, -0.42],
      [0.373, -0.355],
      [0.363, -0.256],
    ],
    // diagonal hasta la punta inferior del chevron
    [
      [0.363, -0.256],
      [0.204, -0.052],
    ],
    // borde interior, casi vertical, hasta la esquina redondeada
    [
      [0.204, -0.052],
      [0.192, -0.19],
      [0.188, -0.29],
    ],
    [
      [0.188, -0.29],
      [0.183, -0.316],
      [0.161, -0.323],
    ],
    // borde inferior, casi recto, de vuelta a la punta izquierda
    [
      [0.161, -0.323],
      [0.03, -0.306],
      [-0.091, -0.286],
    ],
  ])

  const barb = piece([
    // borde superior, recto
    [
      [-0.127, -0.236],
      [0.115, -0.276],
    ],
    // borde interior cóncavo, largo, hasta el cálamo
    [
      [0.115, -0.276],
      [0.03, -0.18],
      [-0.06, -0.06],
      [-0.157, 0.111],
      [-0.256, 0.31],
      [-0.339, 0.498],
    ],
    // cálamo
    [
      [-0.339, 0.498],
      [-0.371, 0.5],
    ],
    // borde exterior: sube, quiebre suave y hombro
    [
      [-0.371, 0.5],
      [-0.33, 0.33],
      [-0.29, 0.185],
    ],
    [
      [-0.29, 0.185],
      [-0.305, 0.1],
      [-0.316, 0.012],
    ],
    [
      [-0.316, 0.012],
      [-0.235, -0.105],
      [-0.147, -0.22],
      [-0.127, -0.236],
    ],
  ])

  const middle = piece([
    // borde derecho, casi vertical
    [
      [0.147, -0.25],
      [0.153, -0.12],
      [0.165, 0.002],
    ],
    // borde inferior derecho, diagonal
    [
      [0.165, 0.002],
      [0.1, 0.11],
      [0.046, 0.21],
    ],
    // borde inferior, hasta la punta izquierda
    [
      [0.046, 0.21],
      [-0.08, 0.25],
      [-0.214, 0.302],
    ],
    // borde interior cóncavo (paralelo a la barba), de vuelta arriba
    [
      [-0.214, 0.302],
      [-0.147, 0.171],
      [-0.048, 0.022],
      [0.052, -0.127],
      [0.147, -0.25],
    ],
  ])

  return [chevron, barb, middle]
}

/**
 * Chispa de Claude: estallido de rayos que se afinan hacia puntas redondas,
 * con largos y ángulos levemente irregulares (el símbolo es orgánico, no un
 * asterisco perfecto), unidos por un núcleo.
 */
export const starburst = (): Polygon[] => {
  // [largo relativo, desvío angular en radianes]: fijos, el símbolo no cambia.
  const rays: [number, number][] = [
    [1.0, 0.0],
    [0.78, 0.07],
    [0.94, -0.03],
    [0.72, 0.04],
    [0.9, -0.05],
    [0.81, 0.03],
    [0.98, 0.02],
    [0.7, -0.06],
    [0.92, 0.05],
    [0.79, -0.02],
    [0.96, 0.03],
    [0.74, -0.04],
  ]
  const inner = 0.05
  const outer = 0.47
  const baseWidth = 0.11
  const tipWidth = 0.075
  const ray = (angle: number, length: number): Polygon => {
    const tip = inner + (outer - inner) * length
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const nx = -dy
    const ny = dx
    const at = (distance: number, side: number, width: number): Vec2 => [
      dx * distance + nx * side * (width / 2),
      dy * distance + ny * side * (width / 2),
    ]
    const cap = Array.from({ length: 10 }, (_, index) => {
      const a = angle - Math.PI / 2 + ((index + 1) / 11) * Math.PI
      return [
        dx * tip + Math.cos(a) * (tipWidth / 2),
        dy * tip + Math.sin(a) * (tipWidth / 2),
      ] as const
    })
    return orient([
      at(inner, -1, baseWidth),
      at(tip, -1, tipWidth),
      ...cap,
      at(tip, 1, tipWidth),
      at(inner, 1, baseWidth),
    ])
  }
  const pieces = rays.map(([length, jitter], index) =>
    ray(-Math.PI / 2 + (index / rays.length) * TAU + jitter, length)
  )
  return [orient(ellipse(0.11, 0.11, 32)), ...pieces]
}

/**
 * Nudo tipo "blossom" (OpenAI): seis anillos redondeados iguales, girados de a
 * 60° alrededor de un centro abierto, sobre una cuadrícula de seis círculos. La
 * unión de los anillos forma el hexágono entrelazado.
 */
export const knot = (): Polygon[] => {
  const loops = 6
  const width = 0.28
  const height = 0.5
  const thickness = 0.1
  const offset = 0.125
  const band = (w: number, h: number) => {
    const r = w / 2
    const points: Vec2[] = []
    const arc = (cy: number, from: number) => {
      for (let index = 0; index <= 16; index += 1) {
        const a = from + (index / 16) * Math.PI
        points.push([Math.cos(a) * r, cy + Math.sin(a) * r])
      }
    }
    arc(-(h / 2 - r), Math.PI)
    arc(h / 2 - r, 0)
    return points
  }
  const ring = (): Polygon[] => [
    orient(band(width + thickness, height + thickness)),
    [...orient(band(width - thickness, height - thickness))].reverse(),
  ]
  return Array.from({ length: loops }, (_, index) => {
    const angle = (index / loops) * TAU
    return transformPolygons(ring(), {
      x: Math.cos(angle) * offset,
      y: Math.sin(angle) * offset,
      rotate: angle + Math.PI / 2,
    })
  }).flat()
}
