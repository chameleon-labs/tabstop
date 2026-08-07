import {SvgIcon, type IconProps} from '../SvgIcon';

export const Square = (props: IconProps): React.JSX.Element => (
  <SvgIcon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
  </SvgIcon>
);
