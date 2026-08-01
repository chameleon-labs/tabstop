export interface ClaimAlertPreviewRepository {
  /**
   * Claims the at-most-once preview before writing it. False means another
   * worker already claimed the event or the event failed permanently.
   */
  claimAlertPreview: (alertEventId: string, claimedAt: Date) => Promise<boolean>
}
