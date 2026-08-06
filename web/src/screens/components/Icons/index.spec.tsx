import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AlertCircle, Check, Globe, Zap } from './index'

const svgOf = (element: React.JSX.Element): SVGSVGElement => {
  const { container } = render(element)
  const svg = container.querySelector('svg')
  if (svg === null) throw new Error('no svg rendered')
  return svg
}

describe('the icon set', () => {
  it('hides every icon from assistive technology', () => {
    // All of them sit beside a text label, so announcing them repeats what is
    // already there. This is the attribute keeping eighteen decorative
    // graphics out of the tree of an accessibility product, and it is applied
    // in one place - so one test covers the set rather than each icon.
    for (const icon of [<Check key="c" />, <Globe key="g" />, <Zap key="z" />]) {
      expect(svgOf(icon)).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('takes its colour from the text it sits beside', () => {
    // `currentColor` rather than a token: an icon inside a danger badge and one
    // inside body copy are the same component, and the surrounding colour is
    // the only thing that knows which it is.
    expect(svgOf(<AlertCircle />)).toHaveAttribute('stroke', 'currentColor')
  })

  it('sizes both axes together, so nothing renders stretched', () => {
    const svg = svgOf(<Check size={13} />)

    expect(svg).toHaveAttribute('width', '13')
    expect(svg).toHaveAttribute('height', '13')
  })

  it('draws on the grid its paths were authored against', () => {
    // The path data is copied from a 24x24 source. A different viewBox scales
    // every icon silently rather than failing.
    expect(svgOf(<Globe />)).toHaveAttribute('viewBox', '0 0 24 24')
  })
})
