import {
  cursorLayout,
  surfaceFrontSampleAt,
  surfacePointAt,
  surfaceSampleAt,
  type SurfaceConfig,
} from './surfaces'
import type { BodyNode } from './body'
import { renderEffects, type EffectKey, type EffectPath } from './effects'
import { markingPolygons } from './markings'
import { eyeOutline, type EyeShape, type Polygon } from './shapes'

export type Quaternion = readonly [number, number, number, number]
export type Point3 = readonly [number, number, number]
export type EyeMotion = 'none' | 'microSaccades' | 'shake'
export type BodyMotion = 'none' | 'slowDrift' | 'shake'

export type Expression = {
  id: string
  semanticKey?: string
  headX: number
  headY: number
  headZ: number
  widthLeft: number
  widthRight: number
  heightLeft: number
  heightRight: number
  spacing: number
  positionXLeft: number
  positionXRight: number
  positionYLeft: number
  positionYRight: number
  leftAngle: number
  rightAngle: number
  perspective: number
  eyeMotion: EyeMotion
  bodyMotion: BodyMotion
  bodyColor?: string
  eyeColor?: string
  /** Forma de los ojos; sin valor = píldora (la forma original). */
  eyeShape?: EyeShape
  /** Detalles que acompañan a la expresión (rubor, Zzz, corazones...). */
  effects?: EffectKey[]
  /** Solo durante transiciones: opacidad de cada efecto que entra o sale. */
  effectLevels?: Partial<Record<EffectKey, number>>
  /**
   * Solo durante transiciones entre formas de ojo: factor 0..1 que cierra los
   * ojos al cambiar de forma. Es de dibujo, no de estado: no se interpola ni
   * lo toca la física de resortes del Studio.
   */
  eyeSquash?: number
}

export type ExpressionNumericField = Exclude<
  keyof Expression,
  | 'id'
  | 'semanticKey'
  | 'bodyColor'
  | 'eyeColor'
  | 'eyeMotion'
  | 'bodyMotion'
  | 'eyeShape'
  | 'effects'
  | 'effectLevels'
  | 'eyeSquash'
>

export type AvatarPose = {
  expression: Expression
  orientation: Quaternion
}

export type AvatarGeometry = {
  backPaths: string[]
  frontPaths: string[]
  backNodeIds: (string | null)[]
  frontNodeIds: (string | null)[]
  /** Color propio de cada capa (misma posición que backPaths/frontPaths); null = color del cuerpo. */
  backFills: (string | null)[]
  frontFills: (string | null)[]
  /** Estampados de la forma principal: recortados por la cabeza, debajo de los ojos. */
  markings: EffectPath[]
  headPath: string
  leftPath: string
  rightPath: string
  leftVisible: boolean
  rightVisible: boolean
  wirePaths: string[]
  /** Calcomanías sobre la cara: van recortadas por la cabeza, encima de los ojos. */
  decals: EffectPath[]
  /** Sprites flotantes: van encima de todo el cuerpo. */
  sprites: EffectPath[]
}

export type RenderAvatarOptions = {
  includeWire?: boolean
  bodyNodes?: BodyNode[]
  eyeOffset?: Readonly<{ x: number; y: number }>
  /** Reloj de los efectos animados (ms). Sin valor, los efectos se dibujan en t = 0. */
  timeMs?: number
}

export type EyeEditorGeometry = {
  visible: boolean
  selectionPath: string
  widthGuide: string
  heightGuide: string
  rotationGuide: string
  spacingGuide: string
  center: Point3
  widthHandle: Point3
  heightHandle: Point3
  rotateHandle: Point3
  sizeHandle: Point3
  spacingHandle: Point3
}

export type BodyNodeEditorGeometry = {
  center: Point3
  axes: Record<'x' | 'y' | 'z', Point3>
  rings: Record<'x' | 'y' | 'z', Point3[]>
}

export const RADIUS = 120
const FOCAL_LENGTH = 620
const QUARTER_ARC_SAMPLES = 14

export const expressionFields: ExpressionNumericField[] = [
  'headX',
  'headY',
  'headZ',
  'widthLeft',
  'widthRight',
  'heightLeft',
  'heightRight',
  'spacing',
  'positionXLeft',
  'positionXRight',
  'positionYLeft',
  'positionYRight',
  'leftAngle',
  'rightAngle',
  'perspective',
]

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export const radians = (degrees: number) => (degrees * Math.PI) / 180

export const normalizeQuaternion = ([w, x, y, z]: Quaternion): Quaternion => {
  const length = Math.hypot(w, x, y, z) || 1
  return [w / length, x / length, y / length, z / length]
}

export const multiplyQuaternions = (
  [aw, ax, ay, az]: Quaternion,
  [bw, bx, by, bz]: Quaternion
): Quaternion =>
  normalizeQuaternion([
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ])

export const quaternionFromAxisAngle = ([x, y, z]: Point3, angle: number): Quaternion => {
  const halfAngle = angle / 2
  const sine = Math.sin(halfAngle)
  return normalizeQuaternion([Math.cos(halfAngle), x * sine, y * sine, z * sine])
}

export const quaternionFromEuler = (x: number, y: number, z: number): Quaternion => {
  const xRotation = quaternionFromAxisAngle([1, 0, 0], x)
  const yRotation = quaternionFromAxisAngle([0, 1, 0], y)
  const zRotation = quaternionFromAxisAngle([0, 0, 1], z)
  return multiplyQuaternions(multiplyQuaternions(zRotation, xRotation), yRotation)
}

export const quaternionFromVectors = (from: Point3, to: Point3): Quaternion => {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2]
  const cross: Point3 = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ]
  return normalizeQuaternion([1 + dot, cross[0], cross[1], cross[2]])
}

export const quaternionToEuler = ([w, x, y, z]: Quaternion): Point3 => {
  const matrix00 = 1 - 2 * (y * y + z * z)
  const matrix01 = 2 * (x * y - z * w)
  const matrix10 = 2 * (x * y + z * w)
  const matrix11 = 1 - 2 * (x * x + z * z)
  const matrix20 = 2 * (x * z - y * w)
  const matrix21 = 2 * (y * z + x * w)
  const matrix22 = 1 - 2 * (x * x + y * y)
  const headX = Math.asin(clamp(matrix21, -1, 1))
  if (Math.abs(Math.cos(headX)) < 0.00001) return [headX, 0, Math.atan2(matrix10, matrix00)]
  return [headX, Math.atan2(-matrix20, matrix22), Math.atan2(-matrix01, matrix11)]
}

const nearestEquivalentAngle = (angle: number, current: number) => {
  let result = angle
  while (result - current > 180) result -= 360
  while (result - current < -180) result += 360
  return clamp(result, -365, 365)
}

export const expressionWithOrientation = (
  expression: Expression,
  orientation: Quaternion
): Expression => {
  const [radiansX, radiansY, radiansZ] = quaternionToEuler(orientation)
  const x = (radiansX * 180) / Math.PI
  const y = (radiansY * 180) / Math.PI
  const z = (radiansZ * 180) / Math.PI
  return {
    ...expression,
    headX: nearestEquivalentAngle(x, expression.headX),
    headY: nearestEquivalentAngle(y, expression.headY),
    headZ: nearestEquivalentAngle(z, expression.headZ),
  }
}

export const slerpQuaternion = (
  start: Quaternion,
  end: Quaternion,
  progress: number
): Quaternion => {
  let target = end
  let dot = start.reduce((total, value, index) => total + value * target[index], 0)
  if (dot < 0) {
    target = target.map(value => -value) as unknown as Quaternion
    dot = -dot
  }
  if (dot > 0.9995) {
    return normalizeQuaternion(
      start.map(
        (value, index) => value + (target[index] - value) * progress
      ) as unknown as Quaternion
    )
  }
  const angle = Math.acos(clamp(dot, -1, 1))
  const sine = Math.sin(angle)
  const startWeight = Math.sin((1 - progress) * angle) / sine
  const targetWeight = Math.sin(progress * angle) / sine
  return normalizeQuaternion(
    start.map(
      (value, index) => value * startWeight + target[index] * targetWeight
    ) as unknown as Quaternion
  )
}

export const rotateWithQuaternion = ([w, x, y, z]: Quaternion, [px, py, pz]: Point3): Point3 => {
  const tx = 2 * (y * pz - z * py)
  const ty = 2 * (z * px - x * pz)
  const tz = 2 * (x * py - y * px)
  return [
    px + w * tx + (y * tz - z * ty),
    py + w * ty + (z * tx - x * tz),
    pz + w * tz + (x * ty - y * tx),
  ]
}

const roundedRectangle = (width: number, height: number): (readonly [number, number])[] => {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const cornerRadius = Math.min(halfHeight, halfWidth)
  const points: (readonly [number, number])[] = []
  const addLine = (start: readonly [number, number], end: readonly [number, number]) => {
    const samples = Math.max(2, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 1.5))
    for (let index = 0; index < samples; index += 1) {
      const progress = index / samples
      points.push([
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress,
      ])
    }
  }
  const addArc = (centerX: number, centerY: number, startAngle: number) => {
    for (let index = 0; index < QUARTER_ARC_SAMPLES; index += 1) {
      const angle = startAngle + (index / QUARTER_ARC_SAMPLES) * (Math.PI / 2)
      points.push([
        centerX + Math.cos(angle) * cornerRadius,
        centerY + Math.sin(angle) * cornerRadius,
      ])
    }
  }
  addLine([-halfWidth + cornerRadius, -halfHeight], [halfWidth - cornerRadius, -halfHeight])
  addArc(halfWidth - cornerRadius, -halfHeight + cornerRadius, -Math.PI / 2)
  addLine([halfWidth, -halfHeight + cornerRadius], [halfWidth, halfHeight - cornerRadius])
  addArc(halfWidth - cornerRadius, halfHeight - cornerRadius, 0)
  addLine([halfWidth - cornerRadius, halfHeight], [-halfWidth + cornerRadius, halfHeight])
  addArc(-halfWidth + cornerRadius, halfHeight - cornerRadius, Math.PI / 2)
  addLine([-halfWidth, halfHeight - cornerRadius], [-halfWidth, -halfHeight + cornerRadius])
  addArc(-halfWidth + cornerRadius, -halfHeight + cornerRadius, Math.PI)
  return points
}

const project = (point: Point3, perspective: number): Point3 => {
  const denominator = FOCAL_LENGTH - point[2] * perspective
  const scale = Math.abs(denominator) < 0.0001 ? FOCAL_LENGTH / 0.0001 : FOCAL_LENGTH / denominator
  return [point[0] * scale, point[1] * scale, point[2]]
}

export const axisVector = (axis: 'x' | 'y' | 'z'): Point3 =>
  axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]

export const rotateExpressionAroundAxis = (
  expression: Expression,
  axis: 'x' | 'y' | 'z',
  deltaDegrees: number
) => {
  const startOrientation = poseFromExpression(expression).orientation
  const worldAxis = rotateWithQuaternion(startOrientation, axisVector(axis))
  const orientation = multiplyQuaternions(
    quaternionFromAxisAngle(worldAxis, radians(deltaDegrees)),
    startOrientation
  )
  return expressionWithOrientation(expression, orientation)
}

export const rotateExpressionAroundCamera = (expression: Expression, deltaRadians: number) => {
  const startOrientation = poseFromExpression(expression).orientation
  return expressionWithOrientation(
    expression,
    multiplyQuaternions(quaternionFromAxisAngle([0, 0, 1], deltaRadians), startOrientation)
  )
}

const arcballVector = ([xValue, yValue]: readonly [number, number]): Point3 => {
  const x = xValue / RADIUS
  const y = yValue / RADIUS
  const squaredLength = x * x + y * y
  if (squaredLength <= 1) return [x, y, Math.sqrt(1 - squaredLength)]
  const length = Math.sqrt(squaredLength)
  return [x / length, y / length, 0]
}

export const rotateExpressionWithArcball = (
  expression: Expression,
  startPoint: readonly [number, number],
  currentPoint: readonly [number, number]
) => {
  const startOrientation = poseFromExpression(expression).orientation
  const delta = quaternionFromVectors(arcballVector(startPoint), arcballVector(currentPoint))
  return expressionWithOrientation(expression, multiplyQuaternions(delta, startOrientation))
}

export const rotationRing = (pose: AvatarPose, axis: 'x' | 'y' | 'z', radius = 30): Point3[] =>
  Array.from({ length: 97 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const point: Point3 =
      axis === 'x' ? [0, cosine, sine] : axis === 'y' ? [cosine, 0, sine] : [cosine, sine, 0]
    const rotated = rotateWithQuaternion(pose.orientation, point)
    return [rotated[0] * radius, rotated[1] * radius, rotated[2]]
  })

export const renderBodyNodeEditor = (
  pose: AvatarPose,
  node: BodyNode,
  axisLength = 34,
  ringRadius = 26
): BodyNodeEditorGeometry => {
  const projectInHeadSpace = (point: Point3) =>
    project(rotateWithQuaternion(pose.orientation, point), pose.expression.perspective)
  const center = projectInHeadSpace(node.position)
  const localOrientation = quaternionFromEuler(
    radians(node.rotation[0]),
    radians(node.rotation[1]),
    radians(node.rotation[2])
  )
  const axes = Object.fromEntries(
    (['x', 'y', 'z'] as const).map(axis => {
      const vector = rotateWithQuaternion(localOrientation, axisVector(axis))
      return [
        axis,
        projectInHeadSpace([
          node.position[0] + vector[0] * axisLength,
          node.position[1] + vector[1] * axisLength,
          node.position[2] + vector[2] * axisLength,
        ]),
      ]
    })
  ) as BodyNodeEditorGeometry['axes']
  ;(['x', 'y', 'z'] as const).forEach(axis => {
    const endpoint = axes[axis]
    if (Math.hypot(endpoint[0] - center[0], endpoint[1] - center[1]) >= 12) return
    const fallback: Point3 =
      axis === 'x'
        ? [center[0] + 18, center[1], endpoint[2]]
        : axis === 'y'
          ? [center[0], center[1] + 18, endpoint[2]]
          : [center[0] + 14, center[1] + 14, endpoint[2]]
    axes[axis] = fallback
  })
  const rings = Object.fromEntries(
    (['x', 'y', 'z'] as const).map(axis => [
      axis,
      Array.from({ length: 65 }, (_, index) => {
        const angle = (index / 64) * Math.PI * 2
        const cosine = Math.cos(angle) * ringRadius
        const sine = Math.sin(angle) * ringRadius
        const localPoint: Point3 =
          axis === 'x' ? [0, cosine, sine] : axis === 'y' ? [cosine, 0, sine] : [cosine, sine, 0]
        const rotated = rotateWithQuaternion(localOrientation, localPoint)
        return projectInHeadSpace([
          node.position[0] + rotated[0],
          node.position[1] + rotated[1],
          node.position[2] + rotated[2],
        ])
      }),
    ])
  ) as BodyNodeEditorGeometry['rings']
  return { center, axes, rings }
}

export const translateBodyNodeAlongLocalAxis = (
  node: BodyNode,
  axis: 'x' | 'y' | 'z',
  distance: number
): BodyNode => {
  const orientation = quaternionFromEuler(
    radians(node.rotation[0]),
    radians(node.rotation[1]),
    radians(node.rotation[2])
  )
  const direction = rotateWithQuaternion(orientation, axisVector(axis))
  return {
    ...node,
    position: [
      node.position[0] + direction[0] * distance,
      node.position[1] + direction[1] * distance,
      node.position[2] + direction[2] * distance,
    ],
  }
}

export const translateBodyNodeInCameraPlane = (
  node: BodyNode,
  pose: AvatarPose,
  screenDeltaX: number,
  screenDeltaY: number
): BodyNode => {
  const cameraPosition = rotateWithQuaternion(pose.orientation, node.position)
  const denominator = FOCAL_LENGTH - cameraPosition[2] * pose.expression.perspective
  const perspectiveScale =
    Math.abs(denominator) < 0.0001 ? FOCAL_LENGTH / 0.0001 : FOCAL_LENGTH / denominator
  const [w, x, y, z] = pose.orientation
  const headDelta = rotateWithQuaternion(
    [w, -x, -y, -z],
    [screenDeltaX / perspectiveScale, screenDeltaY / perspectiveScale, 0]
  )
  return {
    ...node,
    position: [
      node.position[0] + headDelta[0],
      node.position[1] + headDelta[1],
      node.position[2] + headDelta[2],
    ],
  }
}

export const rotateBodyNodeAroundLocalAxis = (
  node: BodyNode,
  axis: 'x' | 'y' | 'z',
  deltaDegrees: number
): BodyNode => {
  const orientation = quaternionFromEuler(
    radians(node.rotation[0]),
    radians(node.rotation[1]),
    radians(node.rotation[2])
  )
  const rotated = multiplyQuaternions(
    orientation,
    quaternionFromAxisAngle(axisVector(axis), radians(deltaDegrees))
  )
  const next = quaternionToEuler(rotated).map(value => (value * 180) / Math.PI) as [
    number,
    number,
    number,
  ]
  return {
    ...node,
    rotation: next.map((value, index) => nearestEquivalentAngle(value, node.rotation[index])) as [
      number,
      number,
      number,
    ],
  }
}

const path = (points: Point3[], close = true): string => {
  if (!points.length) return ''
  const breakAt = points.findIndex(point => Number.isNaN(point[0]))
  if (breakAt >= 0) {
    return path(points.slice(0, breakAt), close) + path(points.slice(breakAt + 1), close)
  }
  return `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}${points
    .slice(1)
    .map(point => `L${point[0].toFixed(2)} ${point[1].toFixed(2)}`)
    .join('')}${close ? 'Z' : ''}`
}

export const poseFromExpression = (expression: Expression): AvatarPose => ({
  expression,
  orientation: quaternionFromEuler(
    radians(expression.headX),
    radians(expression.headY),
    radians(expression.headZ)
  ),
})

export const interpolatePose = (from: AvatarPose, to: AvatarPose, progress: number): AvatarPose => {
  const expression: Expression = { ...from.expression }
  expressionFields.forEach(field => {
    let target = to.expression[field]
    if (
      field === 'headX' ||
      field === 'headY' ||
      field === 'headZ' ||
      field === 'leftAngle' ||
      field === 'rightAngle'
    ) {
      target = nearestEquivalentAngle(target, from.expression[field])
    }
    expression[field] = from.expression[field] + (target - from.expression[field]) * progress
  })
  blendExpressionFeatures(expression, from.expression, to.expression, progress)
  return {
    expression,
    orientation: poseFromExpression(expression).orientation,
  }
}

const sameEffects = (left: readonly EffectKey[] = [], right: readonly EffectKey[] = []) =>
  left.length === right.length && left.every((key, index) => key === right[index])

/**
 * Mezcla lo que no es numérico entre dos expresiones, sobre `animated` (que
 * ya tiene los números interpolados):
 * - forma de ojos: cambia a mitad de camino, con un parpadeo que la esconde
 *   (los ojos se cierran y se abren con la forma nueva);
 * - efectos: los que salen se desvanecen en la primera mitad y los que
 *   entran aparecen en la segunda; los compartidos no se tocan.
 * Lo usan interpolatePose y las transiciones propias del Studio.
 */
export const blendExpressionFeatures = (
  animated: Expression,
  from: Expression,
  to: Expression,
  progress: number
) => {
  const t = clamp(progress, 0, 1)
  const fromShape = from.eyeShape ?? 'pill'
  const toShape = to.eyeShape ?? 'pill'
  const shape = t < 0.5 ? fromShape : toShape
  if (shape === 'pill') delete animated.eyeShape
  else animated.eyeShape = shape
  if (fromShape !== toShape && t < 1) animated.eyeSquash = Math.max(0.12, Math.abs(1 - 2 * t))
  else delete animated.eyeSquash

  const fromEffects = from.effects ?? []
  const toEffects = to.effects ?? []
  delete animated.effectLevels
  if (sameEffects(fromEffects, toEffects)) {
    if (toEffects.length) animated.effects = [...toEffects]
    else delete animated.effects
    return animated
  }
  const levels: Partial<Record<EffectKey, number>> = {}
  const keys: EffectKey[] = []
  fromEffects.forEach(key => {
    if (toEffects.includes(key)) levels[key] = 1
    else if (t < 0.5) levels[key] = 1 - 2 * t
    else return
    keys.push(key)
  })
  toEffects.forEach(key => {
    if (keys.includes(key)) return
    if (t < 0.5) return
    levels[key] = 2 * t - 1
    keys.push(key)
  })
  if (keys.length) {
    animated.effects = keys
    animated.effectLevels = levels
  } else delete animated.effects
  return animated
}

type ProjectedSurfacePoint = { point: Point3; normal: Point3 }
type LocalSurfacePoint = ProjectedSurfacePoint

const MAX_SURFACE_CACHE_ENTRIES = 24
const HEAD_LATITUDE_SAMPLES = 25
const HEAD_LONGITUDE_SAMPLES = 73
const PRIMITIVE_RING_SAMPLES = 144
const ROUNDED_PRIMITIVE_LATITUDE_SAMPLES = 33
const ROUNDED_PRIMITIVE_LONGITUDE_SAMPLES = 73
const headSamplesCache = new Map<string, Point3[]>()
const accessorySamplesCache = new Map<string, Point3[]>()
const wireSamplesCache = new Map<string, LocalSurfacePoint[][]>()

const surfaceCacheKey = (surface: SurfaceConfig) =>
  JSON.stringify([
    surface.type,
    surface.width,
    surface.height,
    surface.depth,
    surface.roundness,
    surface.morphRoundness,
    surface.tipRoundness,
    surface.baseRoundness,
    surface.profile,
  ])

/** Vértices de un prisma: el perfil escalado, en la cara delantera y la trasera. */
const prismPoints = (surface: SurfaceConfig): Point3[] =>
  (surface.profile ?? []).flatMap(([x, y]) => [
    [x * surface.width, y * surface.height, surface.depth / 2] as Point3,
    [x * surface.width, y * surface.height, -surface.depth / 2] as Point3,
  ])

const cacheSurfaceValue = <Value>(cache: Map<string, Value>, key: string, value: Value) => {
  if (cache.size >= MAX_SURFACE_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
  cache.set(key, value)
  return value
}

const localSurfacePoint = (
  surface: SurfaceConfig,
  longitude: number,
  latitude: number
): LocalSurfacePoint => surfaceSampleAt(surface, longitude, latitude)

const projectLocalSurfacePoint = (
  pose: AvatarPose,
  sample: LocalSurfacePoint
): ProjectedSurfacePoint => ({
  point: project(rotateWithQuaternion(pose.orientation, sample.point), pose.expression.perspective),
  normal: rotateWithQuaternion(pose.orientation, sample.normal),
})

const canonicalFaceCoordinates = (x: number, y: number): readonly [number, number] => {
  const longitude = x / RADIUS
  const latitude = y / RADIUS
  return [RADIUS * Math.cos(latitude) * Math.sin(longitude), RADIUS * Math.sin(latitude)]
}

const projectFacePoint = (
  pose: AvatarPose,
  surface: SurfaceConfig,
  x: number,
  y: number
): ProjectedSurfacePoint => {
  const [faceX, faceY] = canonicalFaceCoordinates(x, y)
  return projectLocalSurfacePoint(pose, surfaceFrontSampleAt(surface, faceX, faceY))
}

const eyePoints = (
  pose: AvatarPose,
  surface: SurfaceConfig,
  side: -1 | 1,
  blink: number,
  offset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 }
): ProjectedSurfacePoint[] => {
  const expression = pose.expression
  const suffix = side < 0 ? 'Left' : 'Right'
  const width = expression[`width${suffix}`]
  const restingHeight = expression[`height${suffix}`] * (expression.eyeSquash ?? 1)
  const height = 5 + (restingHeight - 5) * blink
  const centerX = (side * expression.spacing) / 2 + expression[`positionX${suffix}`] + offset.x
  const centerY = expression[`positionY${suffix}`] + offset.y
  const angle = radians(side < 0 ? expression.leftAngle : expression.rightAngle)
  const shape = expression.eyeShape ?? 'pill'
  // La píldora conserva su contorno original (mismo muestreo que siempre).
  // Las demás formas se dibujan a su alto de reposo y el parpadeo las aplasta.
  const outline: (readonly [number, number])[] =
    shape === 'pill'
      ? roundedRectangle(width, height)
      : joinSubpaths(
          densify(eyeOutline(shape, width, restingHeight)).map(polygon =>
            polygon.map(([x, y]) => [x, y * (height / restingHeight)] as const)
          )
        )
  return outline.map(([localX, localY]) => {
    if (Number.isNaN(localX)) return SUBPATH_BREAK
    const rotatedX = localX * Math.cos(angle) - localY * Math.sin(angle)
    const rotatedY = localX * Math.sin(angle) + localY * Math.cos(angle)
    return projectFacePoint(pose, surface, centerX + rotatedX, centerY + rotatedY)
  })
}

/**
 * Tamaño de cara "de referencia": con una cara de este lado o más grande las
 * expresiones se aplican tal cual (las esferas de 240 del Studio original).
 */
export const REFERENCE_FACE_SIZE = 180
export const MIN_FACE_SCALE = 0.3

/**
 * Escala de la cara de una forma principal (0.3..1). Las expresiones mueven
 * ojos en píxeles pensados para una cara grande; en caras chicas (la barra de
 * la ₿, una banda de pluma) esos cambios se multiplican por esta escala para
 * que ojos, rubor y demás se ajusten y no se salgan de la cara.
 */
export const faceScaleFor = (surface: SurfaceConfig) => {
  let size = Math.min(surface.width, surface.height)
  if (surface.profile?.length) {
    // Prisma: ancho útil de la cara ~ 4·área/perímetro (en una banda fina da ~2x
    // su ancho), corregido para que una banda diagonal no parezca ancha.
    const points = surface.profile.map(([x, y]) => [x * surface.width, y * surface.height])
    let area = 0
    let perimeter = 0
    points.forEach(([x, y], index) => {
      const [nx, ny] = points[(index + 1) % points.length]
      area += x * ny - nx * y
      perimeter += Math.hypot(nx - x, ny - y)
    })
    size = Math.min(size, ((4 * Math.abs(area / 2)) / (perimeter || 1)) * 0.6)
  }
  return Math.max(MIN_FACE_SCALE, Math.min(1, size / REFERENCE_FACE_SIZE))
}

/** Separador de subtrazos dentro de una lista de puntos (formas con varias piezas). */
const SUBPATH_BREAK: ProjectedSurfacePoint = {
  point: [Number.NaN, Number.NaN, 0],
  normal: [0, 0, 0],
}

const joinSubpaths = (polygons: Polygon[]) =>
  polygons.flatMap((polygon, index) =>
    index === 0 ? polygon : [[Number.NaN, Number.NaN] as const, ...polygon]
  )

/** Subdivide los lados largos: al proyectar sobre una superficie curva, una recta se curva. */
const densify = (polygons: Polygon[], maxSegment = 1.5): Polygon[] =>
  polygons.map(polygon =>
    polygon.flatMap((point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(next[0] - point[0], next[1] - point[1]) / maxSegment)
      )
      return Array.from({ length: steps }, (_, step) => {
        const k = step / steps
        return [point[0] + (next[0] - point[0]) * k, point[1] + (next[1] - point[1]) * k] as const
      })
    })
  )

const visiblePath = (points: ProjectedSurfacePoint[]) => {
  const segments: Point3[][] = []
  let segment: Point3[] = []
  points.forEach(({ point, normal }) => {
    if (normal[2] > 0) segment.push(point)
    else if (segment.length) {
      segments.push(segment)
      segment = []
    }
  })
  if (segment.length) segments.push(segment)
  return segments
    .filter(item => item.length > 1)
    .map(item => path(item, false))
    .join('')
}

const wirePaths = (pose: AvatarPose, surface: SurfaceConfig): string[] => {
  const key = surfaceCacheKey(surface)
  let samples = wireSamplesCache.get(key)
  if (!samples) {
    const parallels = [-60, -30, 0, 30, 60].map(latitude =>
      Array.from({ length: 73 }, (_, index) =>
        localSurfacePoint(surface, radians(-180 + index * 5), radians(latitude))
      )
    )
    const meridians = Array.from(
      { length: 12 },
      (_, longitudeIndex) => -150 + longitudeIndex * 30
    ).map(longitude =>
      Array.from({ length: 37 }, (_, index) =>
        localSurfacePoint(surface, radians(longitude), radians(-90 + index * 5))
      )
    )
    samples = cacheSurfaceValue(wireSamplesCache, key, [...parallels, ...meridians])
  }
  return samples.map(curve =>
    visiblePath(curve.map(sample => projectLocalSurfacePoint(pose, sample)))
  )
}

const projectEyePoint = (
  pose: AvatarPose,
  surface: SurfaceConfig,
  side: -1 | 1,
  localX: number,
  localY: number
): Point3 => {
  const expression = pose.expression
  const suffix = side < 0 ? 'Left' : 'Right'
  const angle = radians(side < 0 ? expression.leftAngle : expression.rightAngle)
  const rotatedX = localX * Math.cos(angle) - localY * Math.sin(angle)
  const rotatedY = localX * Math.sin(angle) + localY * Math.cos(angle)
  return projectFacePoint(
    pose,
    surface,
    (side * expression.spacing) / 2 + expression[`positionX${suffix}`] + rotatedX,
    expression[`positionY${suffix}`] + rotatedY
  ).point
}

export const renderEyeEditor = (
  pose: AvatarPose,
  surface: SurfaceConfig,
  side: -1 | 1
): EyeEditorGeometry => {
  const expression = pose.expression
  const suffix = side < 0 ? 'Left' : 'Right'
  const width = expression[`width${suffix}`]
  const height = expression[`height${suffix}`]
  const selectedSamples = eyePoints(pose, surface, side, 1)
  const selectedPoints = selectedSamples.map(sample => sample.point)
  const center = projectEyePoint(pose, surface, side, 0, 0)
  const widthHandle = projectEyePoint(pose, surface, side, width / 2 + 9, 0)
  const heightHandle = projectEyePoint(pose, surface, side, 0, -height / 2 - 9)
  const rotateHandle = projectEyePoint(pose, surface, side, 0, -height / 2 - 30)
  const sizeHandle = projectEyePoint(pose, surface, side, width / 2 + 11, height / 2 + 11)
  const leftCenter = projectEyePoint(pose, surface, -1, 0, 0)
  const rightCenter = projectEyePoint(pose, surface, 1, 0, 0)
  const spacingCenterX = (expression.positionXLeft + expression.positionXRight) / 2
  const spacingCenterY = (expression.positionYLeft + expression.positionYRight) / 2
  const spacingHandle = projectFacePoint(
    pose,
    surface,
    spacingCenterX,
    spacingCenterY + height / 2 + 34
  ).point
  const spacingMiddle: Point3 = [
    (leftCenter[0] + rightCenter[0]) / 2,
    (leftCenter[1] + rightCenter[1]) / 2,
    (leftCenter[2] + rightCenter[2]) / 2,
  ]
  const line = (from: Point3, to: Point3) => path([from, to], false)
  return {
    visible: selectedSamples.reduce((total, sample) => total + sample.normal[2], 0) > 0,
    selectionPath: path(selectedPoints),
    widthGuide: line(center, widthHandle),
    heightGuide: line(center, heightHandle),
    rotationGuide: line(heightHandle, rotateHandle),
    spacingGuide: `${line(leftCenter, rightCenter)}${line(spacingMiddle, spacingHandle)}`,
    center,
    widthHandle,
    heightHandle,
    rotateHandle,
    sizeHandle,
    spacingHandle,
  }
}

const convexHull = (points: Point3[]): Point3[] => {
  const sorted = [...points].sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const cross = (origin: Point3, first: Point3, second: Point3) =>
    (first[0] - origin[0]) * (second[1] - origin[1]) -
    (first[1] - origin[1]) * (second[0] - origin[0])
  const half = (source: Point3[]) => {
    const result: Point3[] = []
    source.forEach(point => {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop()
      result.push(point)
    })
    return result
  }
  return [...half(sorted).slice(0, -1), ...half(sorted.reverse()).slice(0, -1)]
}

const smoothClosedPath = (points: Point3[]) => {
  if (points.length < 3) return path(points)
  const pointAt = (index: number) => points[(index + points.length) % points.length]
  return `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}${points
    .map((point, index) => {
      const previous = pointAt(index - 1)
      const next = pointAt(index + 1)
      const afterNext = pointAt(index + 2)
      const firstControl: Point3 = [
        point[0] + (next[0] - previous[0]) / 6,
        point[1] + (next[1] - previous[1]) / 6,
        point[2],
      ]
      const secondControl: Point3 = [
        next[0] - (afterNext[0] - point[0]) / 6,
        next[1] - (afterNext[1] - point[1]) / 6,
        next[2],
      ]
      return `C${firstControl[0].toFixed(2)} ${firstControl[1].toFixed(2)} ${secondControl[0].toFixed(2)} ${secondControl[1].toFixed(2)} ${next[0].toFixed(2)} ${next[1].toFixed(2)}`
    })
    .join('')}Z`
}

const densifyClosedPoints = (points: Point3[], maximumDistance = 7) =>
  points.flatMap((point, index) => {
    const next = points[(index + 1) % points.length]
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(next[0] - point[0], next[1] - point[1]) / maximumDistance)
    )
    return Array.from({ length: steps }, (_, step) => {
      const progress = step / steps
      return [
        point[0] + (next[0] - point[0]) * progress,
        point[1] + (next[1] - point[1]) * progress,
        point[2] + (next[2] - point[2]) * progress,
      ] as Point3
    })
  })

const smoothOpenPath = (points: Point3[]) => {
  if (!points.length) return ''
  if (points.length === 1) return `${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`
  return points
    .slice(0, -1)
    .map((point, index) => {
      const previous = points[Math.max(0, index - 1)]
      const next = points[index + 1]
      const afterNext = points[Math.min(points.length - 1, index + 2)]
      const firstControlX = point[0] + (next[0] - previous[0]) / 6
      const firstControlY = point[1] + (next[1] - previous[1]) / 6
      const secondControlX = next[0] - (afterNext[0] - point[0]) / 6
      const secondControlY = next[1] - (afterNext[1] - point[1]) / 6
      return `C${firstControlX.toFixed(2)} ${firstControlY.toFixed(2)} ${secondControlX.toFixed(2)} ${secondControlY.toFixed(2)} ${next[0].toFixed(2)} ${next[1].toFixed(2)}`
    })
    .join('')
}

const projectLocalPoint = (pose: AvatarPose, point: Point3) =>
  project(rotateWithQuaternion(pose.orientation, point), pose.expression.perspective)

const ringPoints = (width: number, depth: number, y: number) =>
  Array.from({ length: PRIMITIVE_RING_SAMPLES + 1 }, (_, index) => {
    const angle = (index / PRIMITIVE_RING_SAMPLES) * Math.PI * 2
    return [(width / 2) * Math.sin(angle), y, (depth / 2) * Math.cos(angle)] as Point3
  })

const projectedRoundedPrimitivePath = (pose: AvatarPose, surface: SurfaceConfig) => {
  const key = surfaceCacheKey(surface)
  let localSamples = headSamplesCache.get(key)
  if (!localSamples) {
    localSamples = Array.from(
      { length: ROUNDED_PRIMITIVE_LATITUDE_SAMPLES },
      (_, latitudeIndex) => {
        const latitude =
          -Math.PI / 2 + (latitudeIndex / (ROUNDED_PRIMITIVE_LATITUDE_SAMPLES - 1)) * Math.PI
        return Array.from({ length: ROUNDED_PRIMITIVE_LONGITUDE_SAMPLES }, (_, longitudeIndex) => {
          const longitude =
            -Math.PI + (longitudeIndex / (ROUNDED_PRIMITIVE_LONGITUDE_SAMPLES - 1)) * Math.PI * 2
          return surfacePointAt(surface, longitude, latitude)
        })
      }
    ).flat()
    cacheSurfaceValue(headSamplesCache, key, localSamples)
  }
  const projected = localSamples.map(point => projectLocalPoint(pose, point))
  return smoothClosedPath(densifyClosedPoints(convexHull(projected)))
}

const projectedCylinderPath = (pose: AvatarPose, surface: SurfaceConfig) => {
  if (surface.roundness > 0 || (surface.morphRoundness ?? 0) > 0) {
    return projectedRoundedPrimitivePath(pose, surface)
  }

  const halfHeight = surface.height / 2
  const projected = [
    ...ringPoints(surface.width, surface.depth, -halfHeight),
    ...ringPoints(surface.width, surface.depth, halfHeight),
  ].map(point => projectLocalPoint(pose, point))
  return smoothClosedPath(densifyClosedPoints(convexHull(projected)))
}

const projectedCursorBodyPath = (pose: AvatarPose, surface: SurfaceConfig) => {
  const layout = cursorLayout(surface)
  const halfHeight = layout.bodyHeight / 2
  const projected = [
    ...ringPoints(layout.bodyWidth, layout.bodyDepth, layout.bodyCenterY - halfHeight),
    ...ringPoints(layout.bodyWidth, layout.bodyDepth, layout.bodyCenterY + halfHeight),
  ].map(point => projectLocalPoint(pose, point))
  return smoothClosedPath(densifyClosedPoints(convexHull(projected)))
}

const projectedCursorConePath = (pose: AvatarPose, surface: SurfaceConfig) => {
  const layout = cursorLayout(surface)
  const apex = projectLocalPoint(pose, [0, layout.coneApexY, 0])
  const base = ringPoints(surface.width, surface.depth, layout.coneBaseY).map(point =>
    projectLocalPoint(pose, point)
  )
  return smoothClosedPath(densifyClosedPoints(convexHull([...base, apex])))
}

const projectedConePath = (pose: AvatarPose, surface: SurfaceConfig) => {
  if (
    (surface.morphRoundness ?? 0) > 0 ||
    (surface.tipRoundness ?? 0) > 0 ||
    (surface.baseRoundness ?? 0) > 0
  ) {
    return projectedRoundedPrimitivePath(pose, surface)
  }

  const apex = projectLocalPoint(pose, [0, -surface.height / 2, 0])
  const base = ringPoints(surface.width, surface.depth, surface.height / 2).map(point =>
    projectLocalPoint(pose, point)
  )
  const hull = convexHull([...base, apex])
  const apexIndex = hull.findIndex(
    point => Math.hypot(point[0] - apex[0], point[1] - apex[1]) < 0.01
  )
  if (apexIndex < 0) return smoothClosedPath(hull)

  const ordered = [...hull.slice(apexIndex), ...hull.slice(0, apexIndex)]
  const baseArc = ordered.slice(1)
  if (baseArc.length < 2) return path(hull)
  return `M${apex[0].toFixed(2)} ${apex[1].toFixed(2)}L${baseArc[0][0].toFixed(2)} ${baseArc[0][1].toFixed(2)}${smoothOpenPath(baseArc)}L${apex[0].toFixed(2)} ${apex[1].toFixed(2)}Z`
}

const projectedCubePath = (pose: AvatarPose, surface: SurfaceConfig) => {
  if (surface.roundness > 0) return projectedRoundedPrimitivePath(pose, surface)

  const halfWidth = surface.width / 2
  const halfHeight = surface.height / 2
  const halfDepth = surface.depth / 2
  const vertices = [-1, 1].flatMap(x =>
    [-1, 1].flatMap(y => [-1, 1].map(z => [x * halfWidth, y * halfHeight, z * halfDepth] as Point3))
  )
  return path(convexHull(vertices.map(point => projectLocalPoint(pose, point))))
}

const projectedDiamondPath = (pose: AvatarPose, surface: SurfaceConfig) => {
  if (surface.roundness > 0) return projectedRoundedPrimitivePath(pose, surface)

  const halfWidth = surface.width / 2
  const halfHeight = surface.height / 2
  const halfDepth = surface.depth / 2
  const vertices: Point3[] = [
    [-halfWidth, 0, 0],
    [halfWidth, 0, 0],
    [0, -halfHeight, 0],
    [0, halfHeight, 0],
    [0, 0, -halfDepth],
    [0, 0, halfDepth],
  ]
  return path(convexHull(vertices.map(point => projectLocalPoint(pose, point))))
}

type ProjectedEllipse = {
  centerX: number
  centerY: number
  majorRadius: number
  minorRadius: number
  rotation: number
}

const ellipseProjection = (
  centerX: number,
  centerY: number,
  covarianceXX: number,
  covarianceXY: number,
  covarianceYY: number
): ProjectedEllipse | null => {
  const trace = covarianceXX + covarianceYY
  const difference = Math.hypot(covarianceXX - covarianceYY, covarianceXY * 2)
  const majorSquared = (trace + difference) / 2
  const minorSquared = (trace - difference) / 2
  if (majorSquared <= 0 || minorSquared <= 0) return null

  return {
    centerX,
    centerY,
    majorRadius: Math.sqrt(majorSquared),
    minorRadius: Math.sqrt(minorSquared),
    rotation: Math.atan2(covarianceXY * 2, covarianceXX - covarianceYY) / 2,
  }
}

const ellipsePath = ({
  centerX,
  centerY,
  majorRadius,
  minorRadius,
  rotation,
}: ProjectedEllipse) => {
  const rotationDegrees = (rotation * 180) / Math.PI
  const offsetX = Math.cos(rotation) * majorRadius
  const offsetY = Math.sin(rotation) * majorRadius
  const startX = centerX + offsetX
  const startY = centerY + offsetY
  const endX = centerX - offsetX
  const endY = centerY - offsetY

  return `M${startX.toFixed(2)} ${startY.toFixed(2)}A${majorRadius.toFixed(2)} ${minorRadius.toFixed(2)} ${rotationDegrees.toFixed(2)} 0 1 ${endX.toFixed(2)} ${endY.toFixed(2)}A${majorRadius.toFixed(2)} ${minorRadius.toFixed(2)} ${rotationDegrees.toFixed(2)} 0 1 ${startX.toFixed(2)} ${startY.toFixed(2)}Z`
}

const projectedEllipsoid = (
  pose: AvatarPose,
  axes: Point3,
  localCenter: Point3 = [0, 0, 0]
): ProjectedEllipse | null => {
  const rotatedAxes = [
    rotateWithQuaternion(pose.orientation, [1, 0, 0]),
    rotateWithQuaternion(pose.orientation, [0, 1, 0]),
    rotateWithQuaternion(pose.orientation, [0, 0, 1]),
  ]
  const center = rotateWithQuaternion(pose.orientation, localCenter)

  if (Math.abs(pose.expression.perspective) < 0.0001) {
    const covarianceXX = rotatedAxes.reduce(
      (total, axis, index) => total + axis[0] * axis[0] * axes[index] * axes[index],
      0
    )
    const covarianceXY = rotatedAxes.reduce(
      (total, axis, index) => total + axis[0] * axis[1] * axes[index] * axes[index],
      0
    )
    const covarianceYY = rotatedAxes.reduce(
      (total, axis, index) => total + axis[1] * axis[1] * axes[index] * axes[index],
      0
    )
    return ellipseProjection(center[0], center[1], covarianceXX, covarianceXY, covarianceYY)
  }

  const inverseAxesSquared = axes.map(axis => 1 / (axis * axis))
  const quadratic = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) =>
      rotatedAxes.reduce(
        (total, axis, index) => total + axis[row] * inverseAxesSquared[index] * axis[column],
        0
      )
    )
  )
  const focalLength = FOCAL_LENGTH / pose.expression.perspective
  const cameraOffset: Point3 = [-center[0], -center[1], focalLength - center[2]]
  const cameraNormal: Point3 = [
    quadratic[0][0] * cameraOffset[0] +
      quadratic[0][1] * cameraOffset[1] +
      quadratic[0][2] * cameraOffset[2],
    quadratic[1][0] * cameraOffset[0] +
      quadratic[1][1] * cameraOffset[1] +
      quadratic[1][2] * cameraOffset[2],
    quadratic[2][0] * cameraOffset[0] +
      quadratic[2][1] * cameraOffset[1] +
      quadratic[2][2] * cameraOffset[2],
  ]
  const cameraTerm =
    cameraOffset[0] * cameraNormal[0] +
    cameraOffset[1] * cameraNormal[1] +
    cameraOffset[2] * cameraNormal[2] -
    1
  const tangentLinear = [cameraNormal[0], cameraNormal[1], -focalLength * cameraNormal[2]]
  const rayQuadratic = [
    [quadratic[0][0], quadratic[0][1], -focalLength * quadratic[0][2]],
    [quadratic[1][0], quadratic[1][1], -focalLength * quadratic[1][2]],
    [
      -focalLength * quadratic[2][0],
      -focalLength * quadratic[2][1],
      focalLength * focalLength * quadratic[2][2],
    ],
  ]
  const conic = Array.from({ length: 3 }, (_, row) =>
    Array.from(
      { length: 3 },
      (_, column) =>
        tangentLinear[row] * tangentLinear[column] - cameraTerm * rayQuadratic[row][column]
    )
  )
  const determinant = conic[0][0] * conic[1][1] - conic[0][1] * conic[0][1]
  if (Math.abs(determinant) < 1e-12) return null

  const centerX = -(conic[1][1] * conic[0][2] - conic[0][1] * conic[1][2]) / determinant
  const centerY = (conic[0][1] * conic[0][2] - conic[0][0] * conic[1][2]) / determinant
  const centeredConstant = conic[2][2] + conic[0][2] * centerX + conic[1][2] * centerY
  const scale = -centeredConstant
  if (Math.abs(scale) < 1e-12) return null

  const shapeXX = conic[0][0] / scale
  const shapeXY = conic[0][1] / scale
  const shapeYY = conic[1][1] / scale
  const shapeDeterminant = shapeXX * shapeYY - shapeXY * shapeXY
  if (shapeDeterminant <= 0) return null

  return ellipseProjection(
    centerX,
    centerY,
    shapeYY / shapeDeterminant,
    -shapeXY / shapeDeterminant,
    shapeXX / shapeDeterminant
  )
}

const projectedEllipsoidPath = (pose: AvatarPose, surface: SurfaceConfig) => {
  const ellipse = projectedEllipsoid(pose, [
    surface.width / 2,
    surface.height / 2,
    surface.depth / 2,
  ])
  const isSphere = surface.width === surface.height && surface.height === surface.depth
  if (ellipse && isSphere) {
    const radius = (ellipse.majorRadius + ellipse.minorRadius) / 2
    return ellipsePath({
      centerX: 0,
      centerY: 0,
      majorRadius: radius,
      minorRadius: radius,
      rotation: 0,
    })
  }
  return ellipse ? ellipsePath(ellipse) : null
}

const mickeyEarPaths = (pose: AvatarPose, surface: SurfaceConfig) => {
  if (surface.type !== 'mickey') return []

  const radius = Math.min(surface.width, surface.height) * 0.23
  const depthRadius = Math.min(radius, surface.depth * 0.29)
  const centerX = surface.width * 0.37
  const centerY = -surface.height * 0.39
  const centerZ = -surface.depth * 0.12
  const axes: Point3 = [radius, radius, depthRadius]
  return [-1, 1]
    .map(side => projectedEllipsoid(pose, axes, [side * centerX, centerY, centerZ]))
    .filter((ear): ear is ProjectedEllipse => ear !== null)
    .map(ellipsePath)
}

const compositeBackPaths = (pose: AvatarPose, surface: SurfaceConfig) => {
  if (surface.type === 'mickey') return mickeyEarPaths(pose, surface)
  if (surface.type === 'cursor') return [projectedCursorConePath(pose, surface)]
  return []
}

const ellipsePoints = (ellipse: ProjectedEllipse) =>
  Array.from({ length: PRIMITIVE_RING_SAMPLES }, (_, index) => {
    const angle = (index / PRIMITIVE_RING_SAMPLES) * Math.PI * 2
    const major = Math.cos(angle) * ellipse.majorRadius
    const minor = Math.sin(angle) * ellipse.minorRadius
    return [
      ellipse.centerX + major * Math.cos(ellipse.rotation) - minor * Math.sin(ellipse.rotation),
      ellipse.centerY + major * Math.sin(ellipse.rotation) + minor * Math.cos(ellipse.rotation),
      0,
    ] as Point3
  })

const smoothHullPath = (points: Point3[]) => {
  if (points.length < 3) return path(points)
  const distances = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    return Math.hypot(next[0] - point[0], next[1] - point[1])
  })
  const sortedDistances = [...distances].sort((left, right) => left - right)
  const medianDistance = sortedDistances[Math.floor(sortedDistances.length / 2)] || 1
  const straightThreshold = Math.max(8, medianDistance * 3.5)
  const straightEdges = distances.map(distance => distance > straightThreshold)

  return `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}${points
    .map((point, index) => {
      const nextIndex = (index + 1) % points.length
      const next = points[nextIndex]
      if (straightEdges[index]) return `L${next[0].toFixed(2)} ${next[1].toFixed(2)}`
      const previous = straightEdges[(index - 1 + points.length) % points.length]
        ? point
        : points[(index - 1 + points.length) % points.length]
      const afterNext = straightEdges[nextIndex] ? next : points[(index + 2) % points.length]
      const firstControlX = point[0] + (next[0] - previous[0]) / 6
      const firstControlY = point[1] + (next[1] - previous[1]) / 6
      const secondControlX = next[0] - (afterNext[0] - point[0]) / 6
      const secondControlY = next[1] - (afterNext[1] - point[1]) / 6
      return `C${firstControlX.toFixed(2)} ${firstControlY.toFixed(2)} ${secondControlX.toFixed(2)} ${secondControlY.toFixed(2)} ${next[0].toFixed(2)} ${next[1].toFixed(2)}`
    })
    .join('')}Z`
}

const projectedCapsulePath = (pose: AvatarPose, surface: SurfaceConfig) => {
  const radiusX = surface.width / 2
  const radiusY = Math.min(radiusX, surface.height / 2)
  const radiusZ = surface.depth / 2
  const straightHalf = Math.max(0, (surface.height - radiusY * 2) / 2)
  const axes: Point3 = [radiusX, radiusY, radiusZ]
  const top = projectedEllipsoid(pose, axes, [0, straightHalf, 0])
  const bottom = projectedEllipsoid(pose, axes, [0, -straightHalf, 0])
  if (!top || !bottom) return null
  return smoothHullPath(convexHull([...ellipsePoints(top), ...ellipsePoints(bottom)]))
}

const headPath = (pose: AvatarPose, surface: SurfaceConfig) => {
  // Forma principal como prisma: contorno recto del perfil extruido. Los ojos se
  // proyectan sobre su cara delantera plana (la del cubo que la contiene).
  if (surface.profile?.length) {
    return path(
      convexHull(
        prismPoints(surface).map(point =>
          project(rotateWithQuaternion(pose.orientation, point), pose.expression.perspective)
        )
      )
    )
  }
  if (surface.type === 'sphere' || surface.type === 'mickey') {
    const exactPath = projectedEllipsoidPath(pose, surface)
    if (exactPath) return exactPath
  }

  if (surface.type === 'capsule') {
    const exactPath = projectedCapsulePath(pose, surface)
    if (exactPath) return exactPath
  }

  if (surface.type === 'cylinder') return projectedCylinderPath(pose, surface)
  if (surface.type === 'cursor') return projectedCursorBodyPath(pose, surface)
  if (surface.type === 'cone') return projectedConePath(pose, surface)
  if (surface.type === 'cube') return projectedCubePath(pose, surface)
  if (surface.type === 'diamond') return projectedDiamondPath(pose, surface)

  const key = surfaceCacheKey(surface)
  let localSamples = headSamplesCache.get(key)
  if (!localSamples) {
    localSamples = Array.from({ length: HEAD_LATITUDE_SAMPLES }, (_, latitudeIndex) => {
      const latitude = -Math.PI / 2 + (latitudeIndex / (HEAD_LATITUDE_SAMPLES - 1)) * Math.PI
      return Array.from({ length: HEAD_LONGITUDE_SAMPLES }, (_, longitudeIndex) => {
        const longitude = -Math.PI + (longitudeIndex / (HEAD_LONGITUDE_SAMPLES - 1)) * Math.PI * 2
        return surfacePointAt(surface, longitude, latitude)
      })
    }).flat()
    cacheSurfaceValue(headSamplesCache, key, localSamples)
  }
  const projectedSamples = localSamples.map(sample =>
    project(rotateWithQuaternion(pose.orientation, sample), pose.expression.perspective)
  )
  return path(convexHull(projectedSamples))
}

const accessoryPath = (pose: AvatarPose, node: BodyNode) => {
  const key = surfaceCacheKey(node.surface)
  let localSamples = accessorySamplesCache.get(key)
  if (!localSamples && node.surface.profile?.length) {
    localSamples = cacheSurfaceValue(accessorySamplesCache, key, prismPoints(node.surface))
  }
  if (!localSamples) {
    localSamples = Array.from({ length: 17 }, (_, latitudeIndex) => {
      const latitude = -Math.PI / 2 + (latitudeIndex / 16) * Math.PI
      return Array.from({ length: 49 }, (_, longitudeIndex) => {
        const longitude = -Math.PI + (longitudeIndex / 48) * Math.PI * 2
        return surfacePointAt(node.surface, longitude, latitude)
      })
    }).flat()
    cacheSurfaceValue(accessorySamplesCache, key, localSamples)
  }

  const localOrientation = quaternionFromEuler(
    radians(node.rotation[0]),
    radians(node.rotation[1]),
    radians(node.rotation[2])
  )
  const projected = localSamples.map(point => {
    const locallyRotated = rotateWithQuaternion(localOrientation, point)
    const positioned: Point3 = [
      locallyRotated[0] + node.position[0],
      locallyRotated[1] + node.position[1],
      locallyRotated[2] + node.position[2],
    ]
    return project(rotateWithQuaternion(pose.orientation, positioned), pose.expression.perspective)
  })
  const hull = convexHull(projected)
  if (
    node.surface.profile?.length ||
    ((node.surface.type === 'cube' || node.surface.type === 'diamond') &&
      node.surface.roundness <= 0)
  ) {
    return path(hull)
  }
  return smoothClosedPath(densifyClosedPoints(hull))
}

const ACCESSORY_FRONT_CROSSING_RATIO = 0.1

const accessoryCameraDepthRadius = (pose: AvatarPose, node: BodyNode) => {
  const localOrientation = quaternionFromEuler(
    radians(node.rotation[0]),
    radians(node.rotation[1]),
    radians(node.rotation[2])
  )
  const cameraDepthByAxis = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Point3[]
  ).map(
    axis => rotateWithQuaternion(pose.orientation, rotateWithQuaternion(localOrientation, axis))[2]
  )
  return Math.hypot(
    cameraDepthByAxis[0] * (node.surface.width / 2),
    cameraDepthByAxis[1] * (node.surface.height / 2),
    cameraDepthByAxis[2] * (node.surface.depth / 2)
  )
}

const accessoryLayers = (pose: AvatarPose, nodes: BodyNode[]) => {
  const layers = nodes
    .map(node => {
      const depth = rotateWithQuaternion(pose.orientation, node.position)[2]
      return {
        id: node.id,
        path: accessoryPath(pose, node),
        color: node.color ?? null,
        depth,
        front: depth > accessoryCameraDepthRadius(pose, node) * ACCESSORY_FRONT_CROSSING_RATIO,
      }
    })
    .sort((left, right) => left.depth - right.depth)
  return {
    backPaths: layers.filter(layer => !layer.front).map(layer => layer.path),
    frontPaths: layers.filter(layer => layer.front).map(layer => layer.path),
    backNodeIds: layers.filter(layer => !layer.front).map(layer => layer.id),
    frontNodeIds: layers.filter(layer => layer.front).map(layer => layer.id),
    backFills: layers.filter(layer => !layer.front).map(layer => layer.color),
    frontFills: layers.filter(layer => layer.front).map(layer => layer.color),
  }
}

export const renderAvatar = (
  pose: AvatarPose,
  surface: SurfaceConfig,
  blink = 1,
  options: RenderAvatarOptions = {}
): AvatarGeometry => {
  const leftSamples = eyePoints(pose, surface, -1, blink, options.eyeOffset)
  const rightSamples = eyePoints(pose, surface, 1, blink, options.eyeOffset)
  const left = leftSamples.map(sample => sample.point)
  const right = rightSamples.map(sample => sample.point)
  const accessories = accessoryLayers(pose, options.bodyNodes ?? [])
  const compositePaths = compositeBackPaths(pose, surface)
  const effects = effectLayers(pose, surface, blink, options)
  return {
    backPaths: [...compositePaths, ...accessories.backPaths],
    frontPaths: accessories.frontPaths,
    backNodeIds: [...compositePaths.map(() => null), ...accessories.backNodeIds],
    frontNodeIds: accessories.frontNodeIds,
    backFills: [...compositePaths.map(() => null), ...accessories.backFills],
    frontFills: accessories.frontFills,
    markings: (surface.markings ?? []).flatMap(marking => {
      const d =
        marking.shape === 'band'
          ? bandPath(pose, surface, marking.y, marking.height)
          : projectFacePolygons(pose, surface, markingPolygons(marking))
      return d ? [{ d, fill: marking.color, opacity: marking.opacity ?? 1 }] : []
    }),
    headPath: headPath(pose, surface),
    leftPath: path(left),
    rightPath: path(right),
    leftVisible: leftSamples.reduce((total, sample) => total + sample.normal[2], 0) > 0,
    rightVisible: rightSamples.reduce((total, sample) => total + sample.normal[2], 0) > 0,
    wirePaths: options.includeWire === false ? [] : wirePaths(pose, surface),
    decals: effects.decals,
    sprites: effects.sprites,
  }
}

const BAND_RING_SAMPLES = 144
const BAND_EXTENSION = 400

/**
 * Franja por latitud (marking "band"). Se calcula en pantalla: la parte visible
 * del anillo de cada latitud sobre la superficie real, y la región entre ambos
 * anillos. Los extremos se estiran hacia afuera de la silueta; el recorte por la
 * cabeza deja solo lo que corresponde. Si un borde es el polo, la región sigue
 * hasta más allá de la silueta en la dirección de ese polo.
 */
const bandPath = (pose: AvatarPose, surface: SurfaceConfig, centerY: number, spanY: number) => {
  const limit = Math.PI / 2
  const top = Math.max(-limit, Math.min(limit, (centerY - spanY / 2) / RADIUS))
  const bottom = Math.max(-limit, Math.min(limit, (centerY + spanY / 2) / RADIUS))
  const at = (longitude: number, latitude: number) =>
    projectLocalSurfacePoint(pose, surfaceSampleAt(surface, longitude, latitude))
  const visibleArc = (latitude: number) => {
    const ring = Array.from({ length: BAND_RING_SAMPLES }, (_, index) =>
      at(-Math.PI + (index / BAND_RING_SAMPLES) * Math.PI * 2, latitude)
    )
    // El arco visible se arma desde la longitud 0 (frente) hacia ambos lados.
    const front = BAND_RING_SAMPLES / 2
    if (ring[front].normal[2] <= 0)
      return ring.filter(sample => sample.normal[2] > 0).length ? null : []
    let start = front
    let end = front
    while (start > 0 && ring[start - 1].normal[2] > 0) start -= 1
    while (end < BAND_RING_SAMPLES - 1 && ring[end + 1].normal[2] > 0) end += 1
    return ring.slice(start, end + 1).map(sample => sample.point)
  }
  const atPole = (latitude: number) => Math.abs(latitude) >= limit - 1e-6
  const center = project(
    rotateWithQuaternion(pose.orientation, [0, 0, 0]),
    pose.expression.perspective
  )
  const direction = (latitude: number): Point3 => {
    const pole = at(0, latitude).point
    const length = Math.hypot(pole[0] - center[0], pole[1] - center[1]) || 1
    return [(pole[0] - center[0]) / length, (pole[1] - center[1]) / length, 0]
  }
  const extend = (arc: Point3[]) => {
    const first = arc[0]
    const last = arc[arc.length - 1]
    const length = Math.hypot(last[0] - first[0], last[1] - first[1]) || 1
    const side: Point3 = [(last[0] - first[0]) / length, (last[1] - first[1]) / length, 0]
    return [
      [first[0] - side[0] * BAND_EXTENSION, first[1] - side[1] * BAND_EXTENSION, 0] as Point3,
      ...arc,
      [last[0] + side[0] * BAND_EXTENSION, last[1] + side[1] * BAND_EXTENSION, 0] as Point3,
    ]
  }
  const beyondPole = (arc: Point3[], latitude: number) => {
    const out = direction(latitude)
    const reach = BAND_EXTENSION * 3
    return [...arc]
      .reverse()
      .map(point => [point[0] + out[0] * reach, point[1] + out[1] * reach, 0] as Point3)
  }
  const edgeTop = atPole(top) ? null : visibleArc(top)
  const edgeBottom = atPole(bottom) ? null : visibleArc(bottom)
  if (edgeTop === null && edgeBottom === null) return '' // no hay borde visible que dibujar
  if (edgeBottom && edgeBottom.length > 1 && atPole(top)) {
    const arc = extend(edgeBottom)
    return path([...arc, ...beyondPole(arc, top)])
  }
  if (edgeTop && edgeTop.length > 1 && atPole(bottom)) {
    const arc = extend(edgeTop)
    return path([...arc, ...beyondPole(arc, bottom)])
  }
  if (edgeTop && edgeBottom && edgeTop.length > 1 && edgeBottom.length > 1) {
    return path([...extend(edgeTop), ...extend(edgeBottom).reverse()])
  }
  // Ningún borde a la vista: la franja cubre toda la cara visible si su centro mira a cámara.
  const middle = at(0, (top + bottom) / 2)
  return middle.normal[2] > 0 ? 'M-1000 -1000L1000 -1000L1000 1000L-1000 1000Z' : ''
}

/**
 * Caja del personaje completo en espacio de cabeza (sin girar): forma principal
 * más piezas. Cada pieza cuenta con el radio de su lado mayor, así la caja no
 * depende de cómo esté rotada.
 */
const bodyFrame = (surface: SurfaceConfig, nodes: BodyNode[]) => {
  let minX = -surface.width / 2
  let maxX = surface.width / 2
  let minY = -surface.height / 2
  let maxY = surface.height / 2
  nodes.forEach(node => {
    const radius = Math.max(node.surface.width, node.surface.height) / 2
    minX = Math.min(minX, node.position[0] - radius)
    maxX = Math.max(maxX, node.position[0] + radius)
    minY = Math.min(minY, node.position[1] - radius)
    maxY = Math.max(maxY, node.position[1] + radius)
  })
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    halfWidth: (maxX - minX) / 2,
    halfHeight: (maxY - minY) / 2,
  }
}

/** Proyecta contornos en coordenadas de cara; omite las piezas que quedan de espaldas. */
const projectFacePolygons = (pose: AvatarPose, surface: SurfaceConfig, polygons: Polygon[]) =>
  densify(polygons)
    .map(polygon => {
      const samples = polygon.map(([x, y]) => projectFacePoint(pose, surface, x, y))
      const facing = samples.reduce((total, sample) => total + sample.normal[2], 0) > 0
      return facing ? path(samples.map(sample => sample.point)) : ''
    })
    .join('')

const effectLayers = (
  pose: AvatarPose,
  surface: SurfaceConfig,
  blink: number,
  options: RenderAvatarOptions
) => {
  const expression = pose.expression
  if (!expression.effects?.length) return { decals: [], sprites: [] }
  const offset = options.eyeOffset ?? { x: 0, y: 0 }
  const eye = (side: -1 | 1) => {
    const suffix = side < 0 ? 'Left' : 'Right'
    const restingHeight = expression[`height${suffix}`]
    return {
      x: (side * expression.spacing) / 2 + expression[`positionX${suffix}`] + offset.x,
      y: expression[`positionY${suffix}`] + offset.y,
      width: expression[`width${suffix}`],
      height: 5 + (restingHeight - 5) * blink,
    }
  }
  const frame = bodyFrame(surface, options.bodyNodes ?? [])
  return renderEffects(expression.effects, expression.effectLevels, {
    timeMs: options.timeMs ?? 0,
    eyes: { left: eye(-1), right: eye(1) },
    ...frame,
    scale: faceScaleFor(surface),
    projectDecal: polygons => projectFacePolygons(pose, surface, polygons),
    projectAnchor: (x, y, z) => {
      const rotated = rotateWithQuaternion(pose.orientation, [x, y, z])
      const projected = project(rotated, expression.perspective)
      const denominator = FOCAL_LENGTH - rotated[2] * expression.perspective
      return {
        x: projected[0],
        y: projected[1],
        scale: Math.abs(denominator) < 0.0001 ? 1 : FOCAL_LENGTH / denominator,
      }
    },
    toPath: polygons =>
      polygons.map(polygon => path(polygon.map(([x, y]) => [x, y, 0] as const))).join(''),
  })
}
