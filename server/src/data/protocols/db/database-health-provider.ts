export interface DatabaseHealthProvider {
  isReachable: () => Promise<boolean>;
}
