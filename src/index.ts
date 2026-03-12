import dotenv from 'dotenv'
dotenv.config()

import { Store } from './store'
import { ApprovalQueue } from './queue'
import { Analytics } from './analytics'
import { createServer } from './server'
import { createBot } from './bot'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const PORT = parseInt(process.env.PORT || '3000', 10)

if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required in .env')
  process.exit(1)
}

async function main() {
  const store = new Store()
  const analytics = new Analytics()
  const queue = new ApprovalQueue()
  queue.setAnalytics(analytics)
  const bot = createBot(TELEGRAM_BOT_TOKEN!, store, queue, analytics)
  const app = createServer(store, queue)

  // Start Express server
  app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`)
    console.log(`[server] Hook URL: http://localhost:${PORT}/api/approve?token=YOUR_TOKEN`)
  })

  // Start Telegram bot
  console.log('[bot] Starting Telegram bot...')
  bot.start({
    onStart: (botInfo) => {
      console.log(`[bot] Bot @${botInfo.username} is running`)
    },
  })
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
