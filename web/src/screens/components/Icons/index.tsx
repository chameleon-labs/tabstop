/**
 * The icon set. One folder per icon, so a consumer can import just the one
 * it draws and a bundler can drop the rest - a single file exporting
 * eighteen of them cannot be split by anything downstream.
 *
 * `SvgIcon` is the only `<svg>` in the set. See its own folder for the size
 * scale and why `aria-hidden` lives there rather than in each icon.
 */
export { SvgIcon, type IconProps, type IconSize } from './SvgIcon'
export { AlertCircle } from './AlertCircle'
export { AlertTriangle } from './AlertTriangle'
export { ArrowRight } from './ArrowRight'
export { Check } from './Check'
export { ChevronRight } from './ChevronRight'
export { Circle } from './Circle'
export { Copy } from './Copy'
export { ExternalLink } from './ExternalLink'
export { Globe } from './Globe'
export { Info } from './Info'
export { Mail } from './Mail'
export { Moon } from './Moon'
export { Square } from './Square'
export { Sun } from './Sun'
export { TrendingDown } from './TrendingDown'
export { Triangle } from './Triangle'
export { X } from './X'
export { Zap } from './Zap'
