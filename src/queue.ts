import { ApprovalRequest, Decision, HistoryEntry, PendingRequest } from './types'
import { Analytics } from './analytics'

const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes

export class ApprovalQueue {
  private pending = new Map<string, PendingRequest>()
  private onNewRequest?: (chatId: number, request: ApprovalRequest) => void
  private analytics?: Analytics

  setNotifier(fn: (chatId: number, request: ApprovalRequest) => void): void {
    this.onNewRequest = fn
  }

  setAnalytics(analytics: Analytics): void {
    this.analytics = analytics
  }

  add(chatId: number, request: ApprovalRequest): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id)
        this.logDecision(request, chatId, 'timeout', DEFAULT_TIMEOUT_MS)
        resolve({ behavior: 'deny', message: 'Approval timed out' })
      }, DEFAULT_TIMEOUT_MS)

      this.pending.set(request.id, { request, chatId, resolve, timeout })

      if (this.onNewRequest) {
        this.onNewRequest(chatId, request)
      }
    })
  }

  decide(requestId: string, decision: Decision): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false

    const reactionTimeMs = Date.now() - entry.request.timestamp
    clearTimeout(entry.timeout)
    this.pending.delete(requestId)
    this.logDecision(entry.request, entry.chatId, decision.behavior, reactionTimeMs)
    entry.resolve(decision)
    return true
  }

  private logDecision(
    request: ApprovalRequest,
    chatId: number,
    decision: 'allow' | 'deny' | 'timeout',
    reactionTimeMs: number
  ): void {
    if (!this.analytics) return
    const toolSummary = request.toolName === 'Bash'
      ? String(request.toolInput.command || '').substring(0, 100)
      : String(request.toolInput.file_path || JSON.stringify(request.toolInput).substring(0, 100))
    const entry: HistoryEntry = {
      requestId: request.id,
      chatId,
      toolName: request.toolName,
      toolSummary,
      sessionId: request.sessionId,
      decision,
      reactionTimeMs,
      timestamp: new Date().toISOString(),
    }
    this.analytics.log(entry)
  }

  getPending(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((e) => e.request)
  }

  get size(): number {
    return this.pending.size
  }
}
