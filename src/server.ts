import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { Store } from './store'
import { ApprovalQueue } from './queue'
import { ApprovalRequest, HookPayload, HookResponse } from './types'

export type SetupConfirmNotifier = (chatId: number) => Promise<void>

export function createServer(store: Store, queue: ApprovalQueue): express.Express & { setSetupNotifier: (fn: SetupConfirmNotifier) => void } {
  const app = express() as express.Express & { setSetupNotifier: (fn: SetupConfirmNotifier) => void }
  app.use(express.json())

  let setupNotifier: SetupConfirmNotifier | null = null
  app.setSetupNotifier = (fn: SetupConfirmNotifier) => { setupNotifier = fn }

  // Health check + debug
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', pending: queue.size })
  })

  app.get('/debug/:token', (req, res) => {
    const token = req.params.token
    const chatId = store.getChatId(token)
    const mode = store.getMode(token)
    res.json({ token: token.substring(0, 8) + '...', chatId, mode })
  })

  // Setup script endpoint — user runs: curl -sL .../setup/TOKEN | node
  app.get('/setup/:token', (req, res) => {
    const token = req.params.token
    const serverUrl = process.env.SERVER_URL || `https://${req.get('host')}`
    const script = `
const fs = require('fs');
const path = require('path');
const https = require('https');
const p = path.join(require('os').homedir(), '.claude', 'settings.json');
const dir = path.dirname(p);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
s.hooks = s.hooks || {};
s.hooks.PreToolUse = [{ type: 'http', url: '${serverUrl}/api/hook?token=${token}' }];
fs.writeFileSync(p, JSON.stringify(s, null, 2));
console.log('Hook configured! Notifying Telegram...');
const req = https.request('${serverUrl}/api/setup-confirm/${token}', { method: 'POST' }, (res) => {
  if (res.statusCode === 200) console.log('Done! Check your Telegram for confirmation.');
  else console.log('Hook configured, but notification failed. You are all set anyway!');
});
req.on('error', () => console.log('Hook configured! You are all set.'));
req.end();
`
    res.type('application/javascript').send(script)
  })

  // Setup confirmation — called by setup script after hook is configured
  app.post('/api/setup-confirm/:token', async (req, res) => {
    const token = req.params.token
    const chatId = store.getChatId(token)
    if (chatId === null) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    if (setupNotifier) {
      await setupNotifier(chatId)
    }
    console.log(`[server] Setup confirmed for chatId ${chatId}`)
    res.json({ status: 'ok' })
  })

  // PreToolUse hook — fires on EVERY tool call
  app.post('/api/hook', async (req, res) => {
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

    const mode = store.getMode(token)

    // Local mode — auto-approve immediately
    if (mode === 'local') {
      res.json({})
      return
    }

    // Remote mode — send to Telegram and wait for decision
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

    console.log(`[hook] Remote approval: ${request.toolName} from session ${request.sessionId}`)

    const decision = await queue.add(chatId, request)

    if (decision.behavior === 'deny') {
      res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          decision: 'block',
          reason: decision.message || 'Denied via Telegram',
        },
      })
    } else {
      res.json({})
    }
  })

  // Legacy PermissionRequest endpoint (backward compat)
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
