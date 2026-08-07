import type {UptimeProvider} from '../../data/protocols/system/uptime-provider.js';

export class NodeUptimeAdapter implements UptimeProvider {
  getUptimeInSeconds(): number {
    return process.uptime();
  }
}
