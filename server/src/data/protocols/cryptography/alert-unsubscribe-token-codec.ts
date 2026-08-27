export interface AlertUnsubscribeTokenCodec {
  encode: (pageId: string) => string;
  decode: (token: string) => string | null;
}
