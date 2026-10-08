// Página de opciones (contexto de confianza).
import { loadConfig, saveConfig } from './config.js'

const $ = selector => document.querySelector(selector)
const notifyTabs = () => chrome.runtime.sendMessage({ type: 'save-config', patch: {} }).catch(() => {})

const render = async () => {
  const config = await loadConfig()
  $('#auto-scan').checked = config.autoScan !== false
  $('#watch').checked = config.watch !== false
  $('#auto-open').checked = config.autoOpenHighRisk !== false
  const status = $('#rpc-status')
  status.className = config.rpcUrl ? 'status ok' : 'status'
  status.textContent = config.rpcUrl ? `✓ Using your RPC (${new URL(config.rpcUrl).hostname}).` : 'Using the public Solana RPC.'
}

const toggle = (selector, key) =>
  $(selector).addEventListener('change', async event => {
    await saveConfig({ [key]: event.target.checked })
    notifyTabs()
  })
toggle('#auto-scan', 'autoScan')
toggle('#watch', 'watch')
toggle('#auto-open', 'autoOpenHighRisk')

$('#rpc-form').addEventListener('submit', async event => {
  event.preventDefault()
  const value = $('#rpc-url').value.trim()
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !/(^|\.)helius-rpc\.com$|^api\.mainnet-beta\.solana\.com$/.test(url.hostname)) throw new Error()
  } catch {
    $('#rpc-status').className = 'status'
    $('#rpc-status').textContent = 'Only Helius RPCs are accepted for now (https://…helius-rpc.com).'
    return
  }
  await saveConfig({ rpcUrl: value })
  $('#rpc-url').value = ''
  render()
})
$('#rpc-clear').addEventListener('click', async () => {
  await saveConfig({ rpcUrl: '' })
  render()
})
$('#shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }))
$('#unhide').addEventListener('click', async () => {
  await saveConfig({ hiddenSites: [] })
  notifyTabs()
  $('#unhide').textContent = '✓ Done'
})

// wallet (read-only: just an address, to read balances)
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const renderWallet = async () => {
  const { wallet } = await chrome.storage.local.get('wallet')
  $('#wallet-status').className = wallet ? 'status ok' : 'status'
  $('#wallet-status').textContent = wallet ? `✓ Reading balances of ${wallet.slice(0, 4)}…${wallet.slice(-4)}` : 'No wallet added.'
}
$('#wallet-form').addEventListener('submit', async event => {
  event.preventDefault()
  const value = $('#wallet').value.trim()
  if (!SOLANA_ADDRESS.test(value)) {
    $('#wallet-status').className = 'status'
    $('#wallet-status').textContent = "That doesn't look like a Solana address."
    return
  }
  await chrome.storage.local.set({ wallet: value })
  $('#wallet').value = ''
  renderWallet()
})
$('#wallet-clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('wallet')
  renderWallet()
})

// Telegram (the background keeps the token; pages never see it)
const renderTelegram = async (note = '') => {
  const { configured } = await chrome.runtime.sendMessage({ type: 'telegram' })
  $('#telegram-status').className = configured ? 'status ok' : 'status'
  $('#telegram-status').textContent = note || (configured ? '✓ Telegram connected.' : 'Not connected.')
}
$('#telegram-form').addEventListener('submit', async event => {
  event.preventDefault()
  await chrome.runtime.sendMessage({ type: 'telegram', botToken: $('#telegram-token').value, chatId: $('#telegram-chat').value })
  $('#telegram-token').value = ''
  renderTelegram()
})
$('#telegram-test').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'telegram', test: true })
  renderTelegram(result?.ok ? '✓ Test sent: check your Telegram.' : "Couldn't send: check the token and the chat id.")
})

render()
renderWallet()
renderTelegram()
window.__optionsReady = true
