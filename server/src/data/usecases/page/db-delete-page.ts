import type { DeletePage, DeletePageParams } from '../../../domain/usecases/delete-page.js'
import type { DeletePageRepository } from '../../protocols/db/page/delete-page-repository.js'

export class DbDeletePage implements DeletePage {
  constructor (private readonly deletePageRepository: DeletePageRepository) {}

  async delete ({ pageId, userId }: DeletePageParams): Promise<boolean> {
    return await this.deletePageRepository.deleteForUser(pageId, userId)
  }
}
