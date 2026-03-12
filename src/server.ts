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

  // Setup script endpoint — user runs: curl -sL .../setup/TOKEN | node
  app.get('/setup/:token', (req, res) => {
    const token = req.params.token
    const serverUrl = process.env.SERVER_URL || `https://${req.get('host')}`
    const script = `
const fs = require('fs');
const path = require('path');
const p = path.join(require('os').homedir(), '.claude', 'settings.json');
const dir = path.dirname(p);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
s.hooks = s.hooks || {};
s.hooks.PermissionRequest = [{ type: 'http', url: '${serverUrl}/api/approve?token=${token}' }];
fs.writeFileSync(p, JSON.stringify(s, null, 2));
console.log('Claude Approve hook configured!');
console.log('Now every Claude Code action will be sent to Telegram for approval.');
`
    res.type('application/javascript').send(script)
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
