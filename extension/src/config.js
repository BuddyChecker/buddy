// Configuración de la extensión (chrome.storage.local, solo accesible desde
// contextos de confianza: el service worker y las páginas de la extensión).
// Las pestañas reciben publicConfig(): nunca la API key.

export const MAX_FAVORITES = 3

export const DEFAULTS = {
  avatarId: typeof __BUDDY_DEFAULT_AVATAR__ === 'string' ? __BUDDY_DEFAULT_AVATAR__ : 'miso',
  size: 170,
  favorites: {}, // { [avatarId]: string[] } máx. 3
  favoriteBias: 0.7,
  model: 'claude-opus-5-5',
  volume: 0.7,
  animationVolume: 0.7,
  clickVolume: 0.45,
  muted: false,
  animationSounds: true,
  idleSleepMinutes: 5,
  autoScan: true, // revisar solo al abrir la página de un token
  watch: true, // vigilar liquidez y dev mientras la página está abierta
  autoOpenHighRisk: true, // abrir el informe solo si el riesgo es alto
  momentum: true, // live alerts: new ATH, close to ATH, volume spikes
  famous: true, // the moment a famous account tweets (Elon, CZ, Trump…), the buddy says it
  learn: true, // learn in the background from fresh launches (snapshots + outcomes, stored on this PC)
  rpcUrl: '', // RPC de Solana propia (p. ej. Helius); vacío = la pública
  hiddenSites: [], // dominios donde el usuario lo escondió
  // the visitor's own in-page shortcuts (recorded in Settings, kept in chrome.storage forever)
  shortcuts: { toggle: '', report: '' },
  positions: {}, // { [dominio]: { right, bottom } }
  sounds: {}, // sonidos propios (todavía no en la extensión)
  // Servidor de Buddy (revisión de webs; vacío = todavía no desplegado).
  // Se fija al construir (BUDDY_SERVER_URL) y se puede forzar en storage para pruebas.
  serverUrl: typeof __BUDDY_SERVER__ === 'string' ? __BUDDY_SERVER__ : '',
  installId: '',
}

const PUBLIC_EXCLUDE = new Set(['installId', 'serverUrlOverride', 'rpcUrl'])

export const loadConfig = async () => {
  const stored = await chrome.storage.local.get('config')
  const config = { ...DEFAULTS, ...(stored.config ?? {}) }
  config.favorites = { ...(config.favorites ?? {}) }
  config.positions = { ...(config.positions ?? {}) }
  config.shortcuts = { ...DEFAULTS.shortcuts, ...(config.shortcuts ?? {}) }
  // La URL del servidor viene del build (no se guarda); las pruebas la pueden forzar.
  config.serverUrl = stored.config?.serverUrlOverride ?? DEFAULTS.serverUrl
  return config
}

export const saveConfig = async patch => {
  const next = { ...(await loadConfig()), ...patch }
  const { serverUrl: _fromBuild, ...persisted } = next
  await chrome.storage.local.set({ config: persisted })
  return next
}

export const publicConfig = config => {
  const out = Object.fromEntries(Object.entries(config).filter(([key]) => !PUBLIC_EXCLUDE.has(key)))
  out.shortcuts = config.shortcuts ?? {}
  return out
}

/** Marca o desmarca una favorita (máx. 3). ok: false si ya había 3. */
export const toggleFavorite = async (avatarId, key) => {
  const config = await loadConfig()
  const list = new Set(config.favorites[avatarId] ?? [])
  if (list.has(key)) list.delete(key)
  else if (list.size >= MAX_FAVORITES) return { ok: false, config }
  else list.add(key)
  return { ok: true, config: await saveConfig({ favorites: { ...config.favorites, [avatarId]: [...list] } }) }
}
