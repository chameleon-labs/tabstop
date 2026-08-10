import './brand-mark.css';

export type BrandMarkSize = 'sm' | 'md';

export type BrandMarkProps = {
  /** `md` (2rem) for a page that leads with the brand, `sm` (1.5rem) beside a nav. */
  size?: BrandMarkSize;
  className?: string;
};

export const BrandMark = ({size = 'md', className}: BrandMarkProps): React.JSX.Element => (
  <span
    className={className === undefined ? 'brand-mark' : `brand-mark ${className}`}
    data-size={size}
    aria-hidden="true"
  >
    t/
  </span>
);
