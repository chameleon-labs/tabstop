/**
 * Runs in the BROWSER, via `context.addInitScript`, before any page script.
 *
 * Same serialisation constraint as `runAxeInPage`: Playwright stringifies this
 * function, so it may reference nothing in this module.
 *
 * WebRTC and WebTransport are intercepted by neither `route` nor
 * `routeWebSocket`. A data channel needs no permission and will send packets
 * to whatever ICE candidate address a page supplies; WebTransport opens QUIC
 * to any host. Both are direct paths to an internal address past every check
 * in the guard. Non-configurable so a page cannot put them back.
 *
 * This covers pages and frames. Init scripts do not reach dedicated workers,
 * so a worker could still construct either - closing that needs enforcement
 * below the browser, recorded with the download gap on #16.
 */
export const DISABLE_UNINTERCEPTED_TRANSPORTS = (): void => {
  // WebTransport rides QUIC and is intercepted by neither route nor
  // routeWebSocket either, so an https page could open one straight to a
  // private endpoint on 443.
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport']) {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: false,
      writable: false,
    });
  }
};
