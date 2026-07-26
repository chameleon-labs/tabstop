export const QUEUE_NAMES = {
  ping: 'ping'
} as const

export type PingPayload = {
  requestedAt: string
}
