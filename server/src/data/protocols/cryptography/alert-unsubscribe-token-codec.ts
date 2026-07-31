export interface AlertUnsubscribeTokenCodec {
  encode: (pageId: string) => string
  /** Returns the page id only when the token is well-formed and authentic. */
  decode: (token: string) => string | null
}
