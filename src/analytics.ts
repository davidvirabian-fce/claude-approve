import fs from 'fs'
import path from 'path'
import { HistoryEntry } from './types'

const DATA_DIR = path.join(__dirname, '..', 'data')
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')

export class Analytics {
  private history: HistoryEntry[] = []

  constructor() {
    this.load()
  }

  log(entry: HistoryEntry): void {
    this.history.push(entry)
    this.save()
  }

  getStats(chatId: number, days = 7) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const entries = this.history.filter(
      (e) => e.chatId === chatId && new Date(e.timestamp).getTime() > cutoff
    )

    const approved = entries.filter((e) => e.decision === 'allow').length
    const denied = entries.filter((e) => e.decision === 'deny').length
    const timedOut = entries.filter((e) => e.decision === 'timeout').length

    const reactionTimes = entries
      .filter((e) => e.decision !== 'timeout')
      .map((e) => e.reactionTimeMs)
    const avgReactionMs =
      reactionTimes.length > 0
        ? Math.round(reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length)
        : 0

    // Top tools
    const toolCounts = new Map<string, number>()
    for (const e of entries) {
      toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1)
    }
    const topTools = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    // Unique sessions
    const sessions = new Set(entries.map((e) => e.sessionId))

    // Unique active days
    const uniqueDays = new Set(entries.map((e) => e.timestamp.split('T')[0]))

    // Today's stats
    const todayStr = new Date().toISOString().split('T')[0]
    const todayEntries = entries.filter((e) => e.timestamp.startsWith(todayStr))
    const todayApproved = todayEntries.filter((e) => e.decision === 'allow').length
    const todayDenied = todayEntries.filter((e) => e.decision !== 'allow').length

    return {
      totalRequests: entries.length,
      approved,
      denied,
      timedOut,
      avgReactionMs,
      topTools,
      sessionsCount: sessions.size,
      uniqueDays: uniqueDays.size,
      today: { total: todayEntries.length, approved: todayApproved, denied: todayDenied },
    }
  }

  getSessionActivity(chatId: number) {
    const entries = this.history.filter((e) => e.chatId === chatId)
    const sessions = new Map<string, HistoryEntry[]>()
    for (const e of entries) {
      if (!sessions.has(e.sessionId)) sessions.set(e.sessionId, [])
      sessions.get(e.sessionId)!.push(e)
    }

    const sessionSizes = Array.from(sessions.values()).map((s) => s.length)
    const avgRequestsPerSession =
      sessionSizes.length > 0
        ? Math.round(sessionSizes.reduce((a, b) => a + b, 0) / sessionSizes.length)
        : 0

    return {
      totalSessions: sessions.size,
      avgRequestsPerSession,
    }
  }

  getUserCount(): number {
    const users = new Set(this.history.map((e) => e.chatId))
    return users.size
  }

  private load(): void {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this.history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
        console.log(`[analytics] Loaded ${this.history.length} history entries`)
      }
    } catch (err) {
      console.error('[analytics] Failed to load history:', err)
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2))
    } catch (err) {
      console.error('[analytics] Failed to save history:', err)
    }
  }
}
