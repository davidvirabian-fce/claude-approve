export interface ApprovalRequest {
  id: string
  token: string
  toolName: string
  toolInput: Record<string, unknown>
  sessionId: string
  cwd: string
  timestamp: number
}

export interface PendingRequest {
  request: ApprovalRequest
  chatId: number
  resolve: (decision: Decision) => void
  timeout: NodeJS.Timeout
}

export interface Decision {
  behavior: 'allow' | 'deny'
  message?: string
}

export interface UserRecord {
  chatId: number
  token: string
  createdAt: number
}

export interface HookPayload {
  session_id: string
  cwd: string
  permission_mode: string
  hook_event_name: string
  tool_name: string
  tool_input: Record<string, unknown>
}

export interface HookResponse {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest'
    decision: Decision
  }
}

export interface HistoryEntry {
  requestId: string
  chatId: number
  toolName: string
  toolSummary: string
  sessionId: string
  decision: 'allow' | 'deny' | 'timeout'
  reactionTimeMs: number
  timestamp: string
}
