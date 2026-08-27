export interface DeletePageRepository {
  deleteForUser: (pageId: string, userId: string) => Promise<boolean>;
}
