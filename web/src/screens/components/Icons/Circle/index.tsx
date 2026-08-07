import {SvgIcon, type IconProps} from '../SvgIcon';

export const Circle = (props: IconProps): React.JSX.Element => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="10" />
  </SvgIcon>
);
