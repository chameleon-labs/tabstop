export interface ClaimAlertPreviewRepository {
  claimAlertPreview: (alertEventId: string, claimedAt: Date) => Promise<boolean>;
}
