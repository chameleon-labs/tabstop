export type AccountModel = {
  id: string;
  email: string;
  /** Score points. The drop that triggers a regression alert (#14). */
  alertThreshold: number;
  createdAt: Date;
};
