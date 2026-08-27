import {describe, expect, it} from 'vitest';
import {UpdatePageController, type UpdatePageBody} from './update-page-controller.js';
import {mockUpdatePage, mockValidation} from '../../test/index.js';

const makeSut = (monitoringEnabled = false) => {
  const validation = mockValidation<UpdatePageBody>({monitoringEnabled});
  const updatePage = mockUpdatePage();
  return {sut: new UpdatePageController(validation, updatePage), validation, updatePage};
};

describe('UpdatePageController', () => {
  it('pauses monitoring and returns the page', async () => {
    const {sut, updatePage} = makeSut(false);

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(updatePage.update).toHaveBeenCalledWith({
      pageId: 'any-page-id',
      userId: 'user-1',
      monitoringEnabled: false,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'any-page-id',
      url: 'https://example.test/pricing',
      monitoringEnabled: false,
      createdAt: '2026-07-29T10:00:00.000Z',
    });
  });

  it('takes the user id from the request rather than trusting the body', async () => {
    const {sut, updatePage} = makeSut(true);

    await sut.handle({id: 'any-page-id', userId: 'the-session-user'});

    expect(updatePage.update).toHaveBeenCalledWith(expect.objectContaining({userId: 'the-session-user'}));
  });

  it('returns 404 for a page this account does not own', async () => {
    const {sut, updatePage} = makeSut();
    updatePage.update.mockResolvedValueOnce(null);

    const response = await sut.handle({id: 'someone-elses-page', userId: 'user-1'});

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({error: 'No page found for that id'});
  });

  it('returns 404 when no id reached the controller', async () => {
    const {sut, updatePage} = makeSut();

    expect((await sut.handle({userId: 'user-1'})).statusCode).toBe(404);
    expect(updatePage.update).not.toHaveBeenCalled();
  });

  it('returns 400 when validation rejects the body', async () => {
    const {sut, validation, updatePage} = makeSut();
    validation.validate.mockReturnValueOnce({
      error: new Error('monitoringEnabled: Required'),
    });

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(response.statusCode).toBe(400);
    expect(updatePage.update).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking the failure when the usecase throws', async () => {
    const {sut, updatePage} = makeSut();
    updatePage.update.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    const response = await sut.handle({id: 'any-page-id', userId: 'user-1'});

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('connection terminated');
  });
});
