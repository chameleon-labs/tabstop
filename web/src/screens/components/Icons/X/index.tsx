import { SvgIcon, type IconProps } from '../SvgIcon'

export const X = (props: IconProps): React.JSX.Element => (
  <SvgIcon {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </SvgIcon>
)
