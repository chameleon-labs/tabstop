export interface MarkAlertPreviewedRepository {
  /**
   * Conditional on the preview not already being recorded and the alert not
   * having failed permanently. False means another worker won the race.
   */
  markAlertPreviewed: (alertEventId: string, previewedAt: Date) => Promise<boolean>
}
