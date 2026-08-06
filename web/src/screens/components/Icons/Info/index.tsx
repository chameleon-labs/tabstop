import { SvgIcon, type IconProps } from '../SvgIcon'

export const Info = (props: IconProps): React.JSX.Element => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </SvgIcon>
)
