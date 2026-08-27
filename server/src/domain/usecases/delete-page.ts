export type DeletePageParams = {
  pageId: string;
  userId: string;
};

export interface DeletePage {
  delete: (params: DeletePageParams) => Promise<boolean>;
}
