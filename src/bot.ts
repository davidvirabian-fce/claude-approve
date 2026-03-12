import { Bot, InlineKeyboard } from 'grammy'
import { Store } from './store'
import { ApprovalQueue } from './queue'
import { Analytics } from './analytics'
import { ApprovalRequest } from './types'

export function createBot(token: string, store: Store, queue: ApprovalQueue, analytics: Analytics): Bot {
  const bot = new Bot(token)

  const SERVER_URL = process.env.SERVER_URL || 'https://claude-approve-production.up.railway.app'

  function setupCommand(token: string): string {
    return `mkdir -p ~/.claude && node -e "const fs=require('fs');const p=require('path').join(require('os').homedir(),'.claude','settings.json');const s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};s.hooks=s.hooks||{};s.hooks.PermissionRequest=[{type:'http',url:'${SERVER_URL}/api/approve?token=${token}'}];fs.writeFileSync(p,JSON.stringify(s,null,2));console.log('Hook configured!')"
  }

  // /start — register user and show token + setup command
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id
    const authToken = store.register(chatId)

    await ctx.reply(
      `*Claude Approve*\n\n` +
        `Your token: \`${authToken}\`\n\n` +
        `Copy and paste this command in your terminal:\n\n` +
        '```\n' +
        setupCommand(authToken) + '\n' +
        '```\n\n' +
        `After that, every Claude Code action will ask for your approval here.`,
      { parse_mode: 'Markdown' }
    )
  })

  // /setup — show setup command again
  bot.command('setup', async (ctx) => {
    const chatId = ctx.chat.id
    const authToken = store.register(chatId)

    await ctx.reply(
      `Copy and paste this command in your terminal:\n\n` +
        '```\n' +
        setupCommand(authToken) + '\n' +
        '```',
      { parse_mode: 'Markdown' }
    )
  })

  // /stats — show analytics summary
  bot.command('stats', async (ctx) => {
    const chatId = ctx.chat.id
    const stats = analytics.getStats(chatId)
    const session = analytics.getSessionActivity(chatId)
    const approveRate = stats.totalRequests > 0
      ? Math.round((stats.approved / stats.totalRequests) * 100)
      : 0
    const avgSec = (stats.avgReactionMs / 1000).toFixed(1)

    const toolLines = stats.topTools
      .map(([name, count]) => `  ${name}: ${count}`)
      .join('\n')

    await ctx.reply(
      `📊 *Stats (last 7 days)*\n\n` +
        `Requests: ${stats.totalRequests}\n` +
        `✅ Approved: ${stats.approved} (${approveRate}%)\n` +
        `❌ Denied: ${stats.denied}\n` +
        `⏱ Timeout: ${stats.timedOut}\n` +
        `⚡ Avg reaction: ${avgSec}s\n\n` +
        `*Top tools:*\n${toolLines || '  (none yet)'}\n\n` +
        `Sessions: ${session.totalSessions} (avg ${session.avgRequestsPerSession} req/session)\n` +
        `Active days: ${stats.uniqueDays}\n\n` +
        `*Today:* ${stats.today.total} (${stats.today.approved} ✅, ${stats.today.denied} ❌)\n` +
        `👥 Total users: ${analytics.getUserCount()}`,
      { parse_mode: 'Markdown' }
    )
  })

  // Handle approval button callbacks
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data
    const [action, requestId] = data.split(':')

    if (action === 'approve' || action === 'deny') {
      const decision = {
        behavior: action as 'allow' | 'deny',
        ...(action === 'deny' ? { message: 'Denied via Telegram' } : {}),
      }
      // Map 'approve' to 'allow' for the hook response
      const hookDecision = {
        behavior: (action === 'approve' ? 'allow' : 'deny') as 'allow' | 'deny',
        ...(action === 'deny' ? { message: 'Denied via Telegram' } : {}),
      }

      const resolved = queue.decide(requestId, hookDecision)

      if (resolved) {
        const emoji = action === 'approve' ? '✅' : '❌'
        const label = action === 'approve' ? 'Approved' : 'Denied'
        await ctx.editMessageText(
          ctx.callbackQuery.message?.text + `\n\n${emoji} *${label}*`,
          { parse_mode: 'Markdown' }
        )
      } else {
        await ctx.answerCallbackQuery({ text: 'Request expired or already decided' })
      }
    }

    await ctx.answerCallbackQuery()
  })

  // Wire up: when new approval comes in, send Telegram message
  queue.setNotifier(async (chatId: number, request: ApprovalRequest) => {
    const toolDesc = formatToolDescription(request)
    const sessionShort = request.sessionId.substring(0, 8)
    const cwdShort = request.cwd.split('/').slice(-2).join('/')

    const keyboard = new InlineKeyboard()
      .text('✅ Approve', `approve:${request.id}`)
      .text('❌ Deny', `deny:${request.id}`)

    await bot.api.sendMessage(
      chatId,
      `🔧 *${request.toolName}*\n` +
        `${toolDesc}\n` +
        `📂 ${cwdShort} | 🔗 ${sessionShort} | ⏱ 2:00`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    )
  })

  return bot
}

function formatToolDescription(request: ApprovalRequest): string {
  const input = request.toolInput
  if (request.toolName === 'Bash' && input.command) {
    const cmd = String(input.command)
    return '```\n' + (cmd.length > 200 ? cmd.substring(0, 200) + '...' : cmd) + '\n```'
  }
  if (request.toolName === 'Edit' && input.file_path) {
    return `✏️ Edit: \`${input.file_path}\``
  }
  if (request.toolName === 'Write' && input.file_path) {
    return `📝 Write: \`${input.file_path}\``
  }
  // Generic fallback
  const summary = JSON.stringify(input).substring(0, 150)
  return `\`${summary}\``
}
