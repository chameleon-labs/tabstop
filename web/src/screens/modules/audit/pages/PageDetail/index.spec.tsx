import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PageDetail } from './index'

const renderAtId = (id: string): void => {
  render(<RouterProvider router={createMemoryRouter(
    [{ path: '/pages/:id', element: <PageDetail /> }], { initialEntries: [`/pages/${id}`] }
  )} />)
}

describe('PageDetail', () => {
  it('reads the id out of the path rather than a prop', async () => {
    // Whoever implements #21 loads by this id. A screen that ignored the param
    // would render the same page for every row on the dashboard.
    renderAtId('42')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page 42' })).toBeVisible()
  })

  it('sets a title now, to be replaced by the page name in #21', async () => {
    renderAtId('42')
    await screen.findByRole('heading', { level: 1 })

    expect(document.title).toBe('Page · tabstop')
  })
})
