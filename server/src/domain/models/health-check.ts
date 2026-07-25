export type HealthCheckModel = {
  status: 'up' | 'degraded'
  uptimeInSeconds: number
  database: 'up' | 'down'
  checkedAt: string
}
