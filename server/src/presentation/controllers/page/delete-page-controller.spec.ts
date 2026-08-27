import {describe, expect, it} from 'vitest';
import {DeletePageController} from './delete-page-controller.js';
import {mockDeletePage} from '../../test/index.js';

const makeSut = () => {
  const deletePage = mockDeletePage();
  return {sut: new DeletePageController(deletePage), deletePage};
};

describe('DeletePageController', () => {
  it('returns 204 with no body once the page is gone', async () => {
    const {sut, deletePage} = makeSut();

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(deletePage.delete).toHaveBeenCalledWith({
      pageId: 'any-page-id',
      userId: 'user-1',
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBeNull();
  });

  it('returns 404 for a page this account does not own', async () => {
    const {sut, deletePage} = makeSut();
    deletePage.delete.mockResolvedValueOnce(false);

    const response = await sut.handle({id: 'someone-elses-page', userId: 'user-1'});

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({error: 'No page found for that id'});
  });

  it('returns 404 rather than 204 for a second delete', async () => {
    const {sut, deletePage} = makeSut();
    deletePage.delete.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect((await sut.handle({id: 'p', userId: 'user-1'})).statusCode).toBe(204);
    expect((await sut.handle({id: 'p', userId: 'user-1'})).statusCode).toBe(404);
  });

  it('returns 404 when no id reached the controller', async () => {
    const {sut, deletePage} = makeSut();

    expect((await sut.handle({userId: 'user-1'})).statusCode).toBe(404);
    expect(deletePage.delete).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking the failure when the usecase throws', async () => {
    const {sut, deletePage} = makeSut();
    deletePage.delete.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('connection terminated');
  });
});
