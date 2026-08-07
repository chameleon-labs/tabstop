import type {ReactNode, SVGProps} from 'react';

export type IconSize = 'sm' | 'md' | 'lg';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'fill' | 'stroke' | 'width' | 'height'> {
  size?: IconSize;
}

export const SvgIcon = ({
  size = 'md',
  className,
  children,
  ...props
}: IconProps & {children: ReactNode}): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className === undefined ? `icon icon--${size}` : `icon icon--${size} ${className}`}
    {...props}
  >
    {children}
  </svg>
);
