export type DuePage = {
  pageId: string;
  url: string;
  domain: string;
};

export type DuePageQuery = {
  dayStart: Date;
  limit: number;
  after: string | null;
};

export interface LoadDueReauditsRepository {
  loadDueForReaudit: (query: DuePageQuery) => Promise<DuePage[]>;
}
