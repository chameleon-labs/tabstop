export const DISABLE_UNINTERCEPTED_TRANSPORTS = (): void => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport']) {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: false,
      writable: false,
    });
  }
};
