export interface DnsResolver {
  resolve: (hostname: string) => Promise<string[]>;
}
