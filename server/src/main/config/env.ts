const rawPort = process.env.PORT
const parsedPort = Number(rawPort)
const hasValidPort = rawPort !== undefined && rawPort !== '' && Number.isFinite(parsedPort)

export const env = {
  port: hasValidPort ? parsedPort : 3000
}
