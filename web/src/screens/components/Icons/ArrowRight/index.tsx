import { SvgIcon, type IconProps } from '../SvgIcon'

export const ArrowRight = (props: IconProps): React.JSX.Element => (
  <SvgIcon {...props}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </SvgIcon>
)
