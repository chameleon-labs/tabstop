export interface DnsResolver {
  /**
   * Every address the host answers with - A and AAAA both.
   *
   * All of them, not the first: a host answering with one public and one
   * private address is a rebinding attempt, and checking only the first would
   * wave it through.
   */
  resolve: (hostname: string) => Promise<string[]>;
}
