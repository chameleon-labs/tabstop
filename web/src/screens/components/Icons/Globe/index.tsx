import {SvgIcon, type IconProps} from '../SvgIcon';

export const Globe = (props: IconProps): React.JSX.Element => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </SvgIcon>
);
