import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { Store } from './store'
import { ApprovalQueue } from './queue'
import { ApprovalRequest, HookPayload, HookResponse } from './types'

export function createServer(store: Store, queue: ApprovalQueue): express.Express {
  const app = express()
  app.use(express.json())

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', pending: queue.size })
  })

  // Main hook endpoint — Claude Code sends PermissionRequest here
  app.post('/api/approve', async (req, res) => {
    const token = req.query.token as string
    if (!token) {
      res.status(401).json({ error: 'Missing token' })
      return
    }

    const chatId = store.getChatId(token)
    if (chatId === null) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    const payload = req.body as HookPayload
    const request: ApprovalRequest = {
      id: uuidv4(),
      token,
      toolName: payload.tool_name || 'Unknown',
      toolInput: payload.tool_input || {},
      sessionId: payload.session_id || 'unknown',
      cwd: payload.cwd || '',
      timestamp: Date.now(),
    }

    console.log(`[server] New approval request: ${request.toolName} from session ${request.sessionId}`)

    // This awaits until user decides or timeout
    const decision = await queue.add(chatId, request)

    const response: HookResponse = {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision,
      },
    }

    console.log(`[server] Decision for ${request.id}: ${decision.behavior}`)
    res.json(response)
  })

  return app
}
