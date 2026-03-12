import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { UserRecord } from './types'

const DATA_DIR = path.join(__dirname, '..', 'data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

export class Store {
  private byToken = new Map<string, UserRecord>()
  private byChatId = new Map<number, UserRecord>()

  constructor() {
    this.load()
  }

  register(chatId: number): string {
    const existing = this.byChatId.get(chatId)
    if (existing) {
      return existing.token
    }

    const token = uuidv4()
    const record: UserRecord = { chatId, token, createdAt: Date.now() }
    this.byToken.set(token, record)
    this.byChatId.set(chatId, record)
    this.save()
    return token
  }

  getChatId(token: string): number | null {
    const record = this.byToken.get(token)
    return record ? record.chatId : null
  }

  private load(): void {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as UserRecord[]
        for (const record of data) {
          this.byToken.set(record.token, record)
          this.byChatId.set(record.chatId, record)
        }
        console.log(`[store] Loaded ${data.length} users`)
      }
    } catch (err) {
      console.error('[store] Failed to load users:', err)
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      const data = Array.from(this.byToken.values())
      fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('[store] Failed to save users:', err)
    }
  }
}
